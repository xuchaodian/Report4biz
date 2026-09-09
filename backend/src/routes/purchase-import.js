// 外部联通人口 Excel 批量导入（v1.13.101 批次0.5）
// 背景：用户另有系统输出联通智慧足迹 Excel 报表（API 规格一致），需批量导入为本系统完整购买履历
// 规则（Report4biz_Excel联通数据批量导入方案_20260908.md v1.0）：
//   - 文件在用户电脑 → 前端 <input webkitdirectory> 选文件夹批量上传
//   - 归属=导入者账号；status='active'、quota_used=0（不扣配额，各配额口径不受影响）
//   - 文件名=正式来源（门店名_半径km_月份[yyyyMM]_[时间戳].xlsx）；封面 E21/C1/E1 交叉校验兜底
//   - 门店精确同名匹配 markers（同 user_id 或 user_id IS NULL）取 GCJ02 坐标；匹配失败=整文件零写入
//   - 整文件原子、文件间独立；preview(dry-run) → commit(落库)；指纹去重 store_name+radius+city_month+center
import express from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import * as XLSX from 'xlsx'
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const router = express.Router()

// 临时目录（uploads/ 已在 .gitignore；服务重启/超时清理）
const TMP_DIR = join(__dirname, '../../uploads/import_tmp')
if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true })
}
const TMP_TTL_MS = 30 * 60 * 1000 // 30 分钟
const MAX_FILES = 200
const MAX_FILE_SIZE = 10 * 1024 * 1024

// multer 上传：落盘到临时目录，文件名自生成（避免 originalname 中文/latin1 落盘问题）
// ---- multer originalname 编码兜底：latin1 mojibake 转回 utf8；真 utf8（含中文等 >U+00FF 字符）原样 ----
function decodeOriginalName(name) {
  if (!name) return ''
  let hasHigh = false
  let hasBeyondLatin1 = false
  for (const ch of name) {
    const c = ch.codePointAt(0)
    if (c > 0x7f) hasHigh = true
    if (c > 0xff) hasBeyondLatin1 = true
  }
  if (!hasHigh || hasBeyondLatin1) return name // 纯 ASCII 或已含真 utf8 宽字符
  // 全字符落在 0x80~0xFF → latin1 解码的 utf8 字节 → 转回
  try { return Buffer.from(name, 'latin1').toString('utf8') } catch { return name }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => {
    // 落盘名随机化（不编码原名），原名存旁路 meta，彻底规避 originalname 编码问题
    cb(null, `${Date.now()}_${req.user.id}_${Math.random().toString(36).slice(2, 10)}.xlsx`)
  }
})
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (ext !== '.xlsx') return cb(new Error('仅支持 .xlsx 格式文件'), false)
    cb(null, true)
  }
})

// ---- 文件名解析（正式来源）：门店名_半径km_月份[yyyyMM]_[购买时间戳].xlsx ----
// 例：苏州新区AEON MALL_2km_202606_20260908152107.xlsx（时间戳可忽略，仅审计）
// 店名可含空格与下划线 → 从后向前定位半径段，之前的段全归门店名
export function parseFileName(fileBase) {
  const parts = String(fileBase).split('_')
  let radiusIdx = -1
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d+(?:\.\d+)?km$/i.test(parts[i])) { radiusIdx = i; break }
  }
  if (radiusIdx < 1) {
    return { ok: false, error: '文件名不符合约定格式（应含 门店名_半径km_月份[yyyyMM]）' }
  }
  const radiusSeg = parts[radiusIdx]
  const monthSeg = parts[radiusIdx + 1]
  if (!monthSeg || !/^\d{6}$/.test(monthSeg)) {
    return { ok: false, error: `月份段缺失或不符合格式（应为 yyyyMM，如 202606）` }
  }
  // 半径之后除月份外只允许可选的时间戳段（≥10 位数字）
  if (radiusIdx + 2 < parts.length && !/^\d{10,14}$/.test(parts[radiusIdx + 2])) {
    return { ok: false, error: `文件名第 ${radiusIdx + 3} 段"${parts[radiusIdx + 2]}"不是有效时间戳，文件疑似混入` }
  }
  const storeName = parts.slice(0, radiusIdx).join('_').trim()
  if (!storeName) return { ok: false, error: '文件名缺少门店名' }
  const kmMatch = /^(\d+(?:\.\d+)?)km$/i.exec(radiusSeg)
  return { ok: true, storeName, radiusM: Math.round(parseFloat(kmMatch[1]) * 1000), cityMonth: monthSeg }
}

// ---- 格内半径解析："2.0Km"→2000、"3km"→3000；数字 <100 视为 km 否则按米 ----
export function parseRadius(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  const km = /^(\d+(?:\.\d+)?)\s*km$/i.exec(s)
  if (km) return Math.round(parseFloat(km[1]) * 1000)
  const n = Number(s.replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return n < 100 ? Math.round(n * 1000) : Math.round(n)
}

// ---- 月份解析："2026年1月"→202601、"202606"→202606 ----
export function parseMonth(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  const ym = /^(\d{4})\s*年\s*(\d{1,2})\s*月?$/.exec(s)
  if (ym) return `${ym[1]}${String(Number(ym[2])).padStart(2, '0')}`
  if (/^\d{6}$/.test(s)) return s
  return null
}

// ---- 解析单个报表文件 → { apiResult, storeName 等 } ----
export function parseReportFile(filePath, originalName) {
  const fileName = originalName || path.basename(filePath)
  const fileBase = fileName.replace(/\.xlsx$/i, '')
  const nameRes = parseFileName(fileBase)
  if (!nameRes.ok) return { ok: false, error: nameRes.error }

  const buf = fs.readFileSync(filePath)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheets = wb.Sheets || {}
  const cover = sheets['封面']
  const ds = sheets['商圈数据']

  // 封面 E21 = 门店名（兜底校验）
  let storeNameInFile = ''
  try {
    if (cover && cover['E21'] && cover['E21'].v != null) storeNameInFile = String(cover['E21'].v).trim()
  } catch { /* 忽略 */ }

  // 商圈数据 C1 = 半径 / E1 = 月份
  let radiusRaw = ''
  let monthRaw = ''
  try {
    if (ds && ds['C1'] && ds['C1'].v != null) radiusRaw = String(ds['C1'].v).trim()
    if (ds && ds['E1'] && ds['E1'].v != null) monthRaw = String(ds['E1'].v).trim()
  } catch { /* 忽略 */ }

  // 文件名优先，格内兜底
  const radiusM = nameRes.radiusM || parseRadius(radiusRaw)
  const cityMonth = nameRes.cityMonth || parseMonth(monthRaw)
  if (!radiusM) return { ok: false, error: '无法解析请求半径（文件名与表内均无效）' }
  if (!cityMonth) return { ok: false, error: '无法解析请求月份（文件名与表内均无效）' }

  // 门店名：文件名解析为主；封面 E21 交叉校验——不一致以 E21 为准并标 warning
  let storeName = nameRes.storeName
  let nameMismatchWarning = false
  if (storeNameInFile && storeNameInFile !== nameRes.storeName) {
    storeName = storeNameInFile
    nameMismatchWarning = true
  }

  // 遍历「商圈数据」第 3 行起（!ref 从第 2 行数据开始；sheet_to_json header:1）
  const apiResult = {}
  let curCode = null
  let rowCount = 0
  if (ds && ds['!ref']) {
    const range = XLSX.utils.decode_range(ds['!ref'])
    for (let r = 2; r <= range.e.r; r++) {
      const aCell = ds[XLSX.utils.encode_cell({ r, c: 0 })] // A 服务码（纵向合并，fill-down）
      if (aCell && aCell.v != null && String(aCell.v).trim() !== '') {
        curCode = String(aCell.v).trim()
      }
      if (!curCode) continue
      const cCell = ds[XLSX.utils.encode_cell({ r, c: 2 })] // C 字段键
      const eCell = ds[XLSX.utils.encode_cell({ r, c: 4 })] // E 数值
      if (!cCell || cCell.v == null) continue
      const key = String(cCell.v).trim()
      if (!key) continue
      if (!eCell || eCell.v == null) continue
      const valStr = String(eCell.v).replace(/,/g, '').trim()
      if (valStr === '') continue // 空值行（1003 截断等）跳过
      const num = Number(valStr)
      if (!Number.isFinite(num)) continue
      if (!apiResult[curCode]) apiResult[curCode] = {}
      apiResult[curCode][key.toLowerCase()] = num
      rowCount++
    }
  }

  if (rowCount === 0) {
    return { ok: false, error: '「商圈数据」无有效数据行（0 行），请检查文件内容' }
  }

  return {
    ok: true,
    fileName,
    storeName,
    storeNameFromFile: nameRes.storeName,
    nameMismatchWarning,
    radiusM,
    cityMonth,
    serviceCodes: Object.keys(apiResult),
    rowCount,
    apiResult
  }
}

// ---- 门店精确匹配（同 user_id 或未归属），返回 marker ----
export function matchStore(db, storeName, userId) {
  const marker = db.prepare(
    'SELECT id, name, latitude, longitude, store_type, user_id FROM markers WHERE name = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1'
  ).get(storeName, userId)
  return marker || null
}

// ---- 去重指纹检查 ----
export function findDuplicate(db, userId, storeName, radiusM, cityMonth, centerLng, centerLat) {
  const radiusJson = JSON.stringify([radiusM])
  const row = db.prepare(
    `SELECT id FROM purchases
     WHERE user_id = ? AND store_name = ? AND radius = ? AND city_month = ? AND status = 'active'
       AND center_lng = ? AND center_lat = ? LIMIT 1`
  ).get(userId, storeName, radiusJson, cityMonth, centerLng, centerLat)
  return row || null
}

// ---- 清理超期临时文件（每次 preview/commit 顺手执行）----
function cleanupExpired() {
  try {
    const now = Date.now()
    for (const f of fs.readdirSync(TMP_DIR)) {
      const full = join(TMP_DIR, f)
      try {
        const st = fs.statSync(full)
        if (now - st.mtimeMs > TMP_TTL_MS) fs.unlinkSync(full)
      } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
}

function removeTmpFiles(keys) {
  for (const k of keys || []) {
    try {
      const full = join(TMP_DIR, path.basename(String(k)))
      if (fs.existsSync(full) && fs.statSync(full).isFile()) fs.unlinkSync(full)
      const meta = `${full}.meta.json`
      if (fs.existsSync(meta)) fs.unlinkSync(meta)
    } catch { /* 忽略 */ }
  }
}

/** 读取 preview 时缓存的 utf8 原名（meta 旁路文件） */
function readOriginalName(diskName) {
  try {
    const metaPath = join(TMP_DIR, `${path.basename(diskName)}.meta.json`)
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      if (meta && meta.original) return meta.original
    }
  } catch { /* 忽略 */ }
  return null
}

/** 解析单个文件并做门店匹配/去重 → 供 preview 与 commit 共用 */
function analyzeFile(db, userId, filePath, originalName) {
  const parsed = parseReportFile(filePath, originalName)
  if (!parsed.ok) return { ok: false, reason: parsed.error }
  const marker = matchStore(db, parsed.storeName, userId)
  if (!marker) {
    return { ...parsed, ok: false, reason: '系统无此门店（或门店不属于当前账号）', marker: null }
  }
  const dup = findDuplicate(db, userId, parsed.storeName, parsed.radiusM, parsed.cityMonth, marker.longitude, marker.latitude)
  return { ...parsed, ok: true, marker, duplicate: !!dup }
}

// ============ 接口一：预检（dry-run，不写库） ============
router.post('/preview', authenticate, requireAdmin, (req, res) => {
  cleanupExpired()
  upload.array('files', MAX_FILES)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: '单文件不能超过10MB' })
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ message: `单次最多 ${MAX_FILES} 个文件` })
      if (err.message === '仅支持 .xlsx 格式文件') return res.status(400).json({ message: err.message })
      return res.status(400).json({ message: '上传失败: ' + err.message })
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: '未收到文件' })
    }
    const db = getDb()
    const files = []
    const matchFailNames = []
    const duplicates = []
    for (const f of req.files) {
      const original = decodeOriginalName(f.originalname) || path.basename(f.path)
      // 旁路 meta：存 utf8 原名供 commit 解析还原
      try { fs.writeFileSync(`${f.path}.meta.json`, JSON.stringify({ original }), 'utf-8') } catch { /* 忽略 */ }
      const analysis = analyzeFile(db, req.user.id, f.path, original)
      files.push({
        fileKey: f.filename,
        fileName: original,
        ok: analysis.ok,
        reason: analysis.reason || null,
        storeName: analysis.storeName || null,
        storeNameFromFile: analysis.storeNameFromFile || null,
        nameMismatchWarning: !!analysis.nameMismatchWarning,
        radiusM: analysis.radiusM || null,
        cityMonth: analysis.cityMonth || null,
        serviceCodes: analysis.serviceCodes || [],
        rowCount: analysis.rowCount || 0,
        duplicate: !!analysis.duplicate
      })
      if (!analysis.ok && analysis.reason && analysis.reason.includes('系统无此门店')) {
        matchFailNames.push({ fileName: original, storeName: analysis.storeName || '' })
      }
      if (analysis.duplicate) {
        duplicates.push({ fileName: original, storeName: analysis.storeName || '', radiusM: analysis.radiusM, cityMonth: analysis.cityMonth })
      }
    }
    const summary = {
      total: files.length,
      ok: files.filter((f) => f.ok && !f.duplicate).length,
      parseFail: files.filter((f) => !f.ok).length,
      matchFail: matchFailNames,
      duplicate: duplicates
    }
    res.json({ files, summary })
  })
})

// ============ 接口二：正式导入（落库；整文件原子、文件间独立） ============
router.post('/commit', authenticate, requireAdmin, (req, res) => {
  cleanupExpired()
  const fileKeys = Array.isArray(req.body?.fileKeys) ? req.body.fileKeys : []
  if (fileKeys.length === 0) return res.status(400).json({ message: '请提供要导入的文件' })
  if (fileKeys.length > MAX_FILES) return res.status(400).json({ message: `单次最多 ${MAX_FILES} 个文件` })

  const db = getDb()
  const imported = []
  const skipped = []
  const failed = []
  const storeNameOfFile = {}
  const missingTmp = []

  db.beginTx()
  try {
    for (const key of fileKeys) {
      const diskName = path.basename(String(key))
      const full = join(TMP_DIR, diskName)
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        missingTmp.push(key)
        failed.push({ fileName: '未知(文件缺失/已过期)', reason: '文件不存在或已过期，请重新预检' })
        continue
      }
      // 原名从 meta 读取（preview 时存下 utf8 原名）
      const original = readOriginalName(diskName)
      if (!original) {
        failed.push({ fileName: diskName, reason: '文件元数据缺失，请重新预检' })
        removeTmpFiles([diskName])
        continue
      }
      const analysis = analyzeFile(db, req.user.id, full, original)
      if (!analysis.ok) {
        failed.push({ fileName: original, reason: analysis.reason })
        removeTmpFiles([diskName])
        continue
      }
      if (analysis.duplicate) {
        skipped.push({ fileName: original, storeName: analysis.storeName, radiusM: analysis.radiusM, cityMonth: analysis.cityMonth, reason: '重复（同门店+半径+月份+坐标已存在）' })
        removeTmpFiles([diskName])
        continue
      }
      // 落库：quota_used=0 / status='active' / radius 存数组 JSON（与 smartsteps 一致）
      const insertResult = db.prepare(`
        INSERT INTO purchases (
          user_id, store_name, store_type, center_lng, center_lat, radius,
          city_month, quota_used, status, result_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', ?)
      `).run(
        req.user.id,
        analysis.storeName,
        analysis.marker.store_type || '',
        analysis.marker.longitude,
        analysis.marker.latitude,
        JSON.stringify([analysis.radiusM]),
        analysis.cityMonth,
        JSON.stringify({ querySuccess: true, apiResult: analysis.apiResult, refunded: false })
      )
      storeNameOfFile[diskName] = analysis.storeName
      imported.push({
        fileKey: diskName,
        fileName: original,
        purchaseId: insertResult.lastInsertRowid,
        storeName: analysis.storeName,
        radiusM: analysis.radiusM,
        cityMonth: analysis.cityMonth,
        rowCount: analysis.rowCount,
        nameMismatchWarning: !!analysis.nameMismatchWarning
      })
      removeTmpFiles([diskName])
    }
    db.commitTx()
  } catch (e) {
    try { db.rollbackTx() } catch { /* 忽略 */ }
    return res.status(500).json({ message: '批量落库失败（已整体回滚，未写入任何文件）: ' + e.message })
  }

  res.json({
    imported,
    skipped,
    failed,
    summary: {
      imported: imported.length,
      skipped: skipped.length,
      failed: failed.length,
      failedFiles: failed.map((f) => f.fileName),
      skippedFiles: skipped.map((f) => f.fileName)
    }
  })
})

export default router
