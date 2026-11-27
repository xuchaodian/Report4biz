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
import { authenticate } from '../middleware/auth.js'
import { rankCandidates, escapeLike } from '../utils/storeNameMatcher.js'
import { NOT_CLOSED_STATUS_SQL, NOT_CLOSED_STATUS_PARAMS } from '../utils/storeStatus.js'

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
  //
  // 🔴 v1.13.427：这张表是「长表」——A 服务码 / B 分类 / C 字段名 / D 字段含义 / E 数量。
  //    以前只读 A、C、E，**把 B 分类和 D 中文含义整列丢掉**，落库只剩 {码:{字段名:值}}。
  //    而详情弹窗的渲染全是按联通 API 的宽表（数组 + popu_type + p1..pN）写的 ⇒ 结构对不上
  //    就掉进"猜格式"分支：拿 key 里的数字猜人群、把同组数值相加当总计、查不到中文就印英文键，
  //    右栏图表还会留一堆空图框。所以这里把 B/D 一并带出来（reportRows），供前端按报表
  //    自己的中文渲染。⚠️ apiResult 一个字不改：AI/洞察/商圈评分/分享仍按原结构取数。
  const apiResult = {}
  /** @type {Array<{code:string, group:string, key:string, label:string, value:number|null}>} */
  const reportRows = []
  let curCode = null
  let curGroup = ''
  let rowCount = 0
  if (ds && ds['!ref']) {
    const range = XLSX.utils.decode_range(ds['!ref'])
    for (let r = 2; r <= range.e.r; r++) {
      const aCell = ds[XLSX.utils.encode_cell({ r, c: 0 })] // A 服务码（纵向合并，fill-down）
      if (aCell && aCell.v != null && String(aCell.v).trim() !== '') {
        const code = String(aCell.v).trim()
        if (code !== curCode) curGroup = '' // 换服务码 ⇒ 分类重新累计
        curCode = code
      }
      if (!curCode) continue
      // B 分类（纵向合并，fill-down 到本码的分组结束）
      const bCell = ds[XLSX.utils.encode_cell({ r, c: 1 })]
      if (bCell && bCell.v != null && String(bCell.v).trim() !== '') {
        curGroup = String(bCell.v).trim()
      }
      // D 字段含义（中文名，报表里 100% 有值）
      const dCell = ds[XLSX.utils.encode_cell({ r, c: 3 })]
      const label = dCell && dCell.v != null ? String(dCell.v).trim() : ''
      const cCell = ds[XLSX.utils.encode_cell({ r, c: 2 })] // C 字段键
      const eCell = ds[XLSX.utils.encode_cell({ r, c: 4 })] // E 数值
      if (!cCell || cCell.v == null) continue
      const key = String(cCell.v).trim()
      if (!key) continue

      // 数值口径与原来完全一致（去千分位逗号、空值跳过）；只是**空值行不再丢弃**，
      // 记成 value:null —— 前端按分组过滤（整组都没值就不显示），避免把 1002 那种
      // 「有字段、报表没给数」的段落渲染成 27 行"—"。
      let num = null
      if (eCell && eCell.v != null) {
        const valStr = String(eCell.v).replace(/,/g, '').trim()
        if (valStr !== '') {
          const n = Number(valStr)
          if (Number.isFinite(n)) num = n
        }
      }
      reportRows.push({ code: curCode, group: curGroup, key: key.toLowerCase(), label, value: num })

      if (num === null) continue
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
    reportRows,
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

// ---- 候选池 / 候选缩略（v1.13.425）----

/**
 * 一次查好「可作为候选的门店池」。
 *
 * 🔴 为什么做成「一次查询、多个文件共用」：一次预检最多 200 个文件，
 *    每个文件都扫一遍门店表就是 200 次全表扫描。池子在同一请求内不会变。
 *
 * 口径（三条都必须与现有读路径一致）：
 *  ① 可见域：`user_id = 本人 OR user_id IS NULL`，与 `matchStore` 完全同口径 ——
 *     ⛔ 不许换成 visibleScope（集团可见域），那是改语义，要单独拍板；
 *  ② 软删：`merged_into IS NULL`（列表类读取必须排除已合并行）；
 *  ③ 关停：排除已不经营的门店，但**保留**待开业/筹备中（开店前做人口测算很常见）。
 *
 * @returns {Array<object>} 原始行（含 id/name/city/district/address/lng/lat/store_type）
 */
export function loadStorePool(db, userId) {
  return db.prepare(`
    SELECT id, name, city, district, address, latitude, longitude, store_type, user_id
      FROM markers
     WHERE (user_id = ? OR user_id IS NULL)
       AND merged_into IS NULL
       ${NOT_CLOSED_STATUS_SQL}
  `).all(userId, ...NOT_CLOSED_STATUS_PARAMS)
}

/**
 * 候选对外只给「用户判断需要的字段」。
 * ⚠️ 不要把整行原样吐给前端：坐标、user_id 对判断没帮助，少发一点少一点歧义。
 */
function pickCandidate(c) {
  return {
    id: c.id,
    name: c.name,
    city: c.city || '',
    district: c.district || '',
    address: c.address || '',
    score: c.score,
    suggest: !!c.suggest,
    // 该门店在「同半径+同月份+同坐标」下是否已有购买记录（确认后会走「跳过重复」）
    duplicate: !!c.duplicate
  }
}

/**
 * 解析单个文件并做门店匹配/去重 → 供 preview 与 commit 共用
 *
 * ⚠️ 导出是为了让测试用**真库 + 真 xlsx** 直接跑决策分支（候选/确认/越权/判重），
 *    不是为了给别处调用；路由以外不要再引它。
 *
 * @param {number|null} confirmedStoreId 用户在前端显式选定的门店 id（近似名场景）。
 *        🔴 传来的 id **不可信**：必须重新查归属，否则请求体里夹一个别人的门店 id
 *        就能把人口数据挂到别人店上。
 * @param {Array<object>|null} pool 候选池（同一请求内复用；为空时按需懒加载）
 */
export function analyzeFile(db, userId, filePath, originalName, confirmedStoreId = null, pool = null) {
  const parsed = parseReportFile(filePath, originalName)
  if (!parsed.ok) return { ok: false, reason: parsed.error }

  let marker = null
  let confirmedByUser = false

  const wantId = Number(confirmedStoreId)
  if (confirmedStoreId !== null && confirmedStoreId !== undefined && confirmedStoreId !== '' && Number.isFinite(wantId) && wantId > 0) {
    marker = db.prepare(`
      SELECT id, name, city, district, address, latitude, longitude, store_type, user_id
        FROM markers
       WHERE id = ? AND (user_id = ? OR user_id IS NULL) AND merged_into IS NULL
    `).get(wantId, userId)
    if (!marker) {
      return { ...parsed, ok: false, reason: '确认的门店不存在或不属于当前账号', marker: null }
    }
    confirmedByUser = true
  } else {
    marker = matchStore(db, parsed.storeName, userId) // 原精确匹配，一字不改
    if (!marker) {
      const rows = Array.isArray(pool) ? pool : loadStorePool(db, userId)
      const { candidates, ambiguous } = rankCandidates(parsed.storeName, rows)
      if (candidates.length) {
        // 🔴 每个候选各自先算一次「同门店+同半径+同月份+同坐标」是否已有记录。
        //    不这么做就会出现「预检说可导入、提交却跳重复」—— 因为预检时还没有用户确认的
        //    门店名，判重只能用文件名，而提交时用的是确认后的门店名。两侧口径必须提前对齐。
        const withDup = candidates.map((c) => ({
          ...c,
          duplicate: !!findDuplicate(db, userId, c.name, parsed.radiusM, parsed.cityMonth, c.longitude, c.latitude)
        }))
        // ⚠️ 这里刻意**不给 reason**：「近似名待确认」不是失败，前端要按 needConfirm 分支渲染。
        //    但 commit 里必须补一句明确原因（见下方 needConfirm 分支），否则 failed[].reason 是空的。
        return {
          ...parsed,
          ok: false,
          needConfirm: true,
          ambiguous: !!ambiguous,
          candidates: withDup.map(pickCandidate),
          marker: null
        }
      }
      return { ...parsed, ok: false, reason: '系统无此门店（或门店不属于当前账号）', marker: null }
    }
  }

  // 🔴 去重与落库都用**确认后的门店名**（marker.name），不用解析名：
  //    否则「星空广场」和「星空广场店」两个文件名会被当成两家店，重复导入；
  //    落库名也得是门店名，`/purchase/by-store/:storeName` 才查得到。
  //    精确同名路径下两者本来就相等（matchStore 是 name 等值），行为不变。
  const dup = findDuplicate(db, userId, marker.name, parsed.radiusM, parsed.cityMonth, marker.longitude, marker.latitude)
  return { ...parsed, ok: true, marker, duplicate: !!dup, confirmedByUser }
}

// ============ 接口一：预检（dry-run，不写库） ============
router.post('/preview', authenticate, (req, res) => {
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
    const needConfirmList = []
    // 候选池一次查好，整批文件共用（200 个文件也只扫一遍门店表）
    const pool = loadStorePool(db, req.user.id)
    for (const f of req.files) {
      const original = decodeOriginalName(f.originalname) || path.basename(f.path)
      // 旁路 meta：存 utf8 原名供 commit 解析还原
      try { fs.writeFileSync(`${f.path}.meta.json`, JSON.stringify({ original }), 'utf-8') } catch { /* 忽略 */ }
      const analysis = analyzeFile(db, req.user.id, f.path, original, null, pool)
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
        duplicate: !!analysis.duplicate,
        // v1.13.425：近似门店名 —— 系统只给候选，必须用户显式选店后才可导入
        needConfirm: !!analysis.needConfirm,
        ambiguous: !!analysis.ambiguous,
        candidates: analysis.candidates || []
      })
      if (!analysis.ok && analysis.reason && analysis.reason.includes('系统无此门店')) {
        matchFailNames.push({ fileName: original, storeName: analysis.storeName || '' })
      }
      if (analysis.needConfirm) {
        needConfirmList.push({
          fileName: original,
          storeName: analysis.storeName || '',
          candidateCount: (analysis.candidates || []).length
        })
      }
      if (analysis.duplicate) {
        duplicates.push({ fileName: original, storeName: analysis.marker?.name || analysis.storeName || '', radiusM: analysis.radiusM, cityMonth: analysis.cityMonth })
      }
    }
    const summary = {
      total: files.length,
      ok: files.filter((f) => f.ok && !f.duplicate).length,
      // ⚠️ 待确认不算「解析失败」：它有完整解析结果，只是缺一步人工确认
      parseFail: files.filter((f) => !f.ok && !f.needConfirm).length,
      needConfirm: needConfirmList,
      matchFail: matchFailNames,
      duplicate: duplicates
    }
    res.json({ files, summary })
  })
})

// ============ 接口二：正式导入（落库；整文件原子、文件间独立） ============
router.post('/commit', authenticate, (req, res) => {
  cleanupExpired()
  const fileKeys = Array.isArray(req.body?.fileKeys) ? req.body.fileKeys : []
  if (fileKeys.length === 0) return res.status(400).json({ message: '请提供要导入的文件' })
  if (fileKeys.length > MAX_FILES) return res.status(400).json({ message: `单次最多 ${MAX_FILES} 个文件` })

  // v1.13.425：近似门店名的用户确认结果 { [fileKey(落盘名)]: storeId }
  // ⚠️ 这里是**不可信输入**：id 存在性/归属一律在 analyzeFile 里重新查（防篡改请求体越权）。
  const rawConfirm = req.body?.confirmMap
  const confirmMap = (rawConfirm && typeof rawConfirm === 'object' && !Array.isArray(rawConfirm)) ? rawConfirm : {}

  const db = getDb()
  const imported = []
  const skipped = []
  const failed = []
  const storeNameOfFile = {}
  const missingTmp = []
  // 候选池一次查好，整批共用
  const pool = loadStorePool(db, req.user.id)

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
      const confirmedId = Object.prototype.hasOwnProperty.call(confirmMap, diskName) ? confirmMap[diskName] : null
      const analysis = analyzeFile(db, req.user.id, full, original, confirmedId, pool)
      if (!analysis.ok) {
        // ⚠️ needConfirm 行若走到这里（没选门店却提交、或选的门店已失效），
        //    必须给一句能看懂的原因 —— 否则前端「原因」列是空白，用户完全不知道该怎么办。
        failed.push({
          fileName: original,
          reason: analysis.needConfirm
            ? '该文件名与门店不同名，请先在预检里选择对应门店后再导入'
            : analysis.reason
        })
        // 🔴 needConfirm 是「缺一步人工确认」，不是废文件：**留着**让用户选完门店再提交，
        //    删了就变成「点了提交才发现，还得重新选文件夹上传一遍」。
        //    其它失败（解析错误/越权/元数据缺失）重试也没用，照旧清理。
        if (!analysis.needConfirm) removeTmpFiles([diskName])
        continue
      }
      if (analysis.duplicate) {
        skipped.push({
          fileName: original,
          storeName: analysis.marker.name,
          radiusM: analysis.radiusM,
          cityMonth: analysis.cityMonth,
          reason: '重复（同门店+半径+月份+坐标已存在）'
        })
        removeTmpFiles([diskName])
        continue
      }
      // 落库：quota_used=0 / status='active' / radius 存数组 JSON（与 smartsteps 一致）
      // store_name 用**确认后的门店名**（精确同名时两者相等，行为不变）
      const insertResult = db.prepare(`
        INSERT INTO purchases (
          user_id, store_name, store_type, center_lng, center_lat, radius,
          city_month, quota_used, status, result_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', ?)
      `).run(
        req.user.id,
        analysis.marker.name,
        analysis.marker.store_type || '',
        analysis.marker.longitude,
        analysis.marker.latitude,
        JSON.stringify([analysis.radiusM]),
        analysis.cityMonth,
        // importMeta：本批**不改库**，但「这条履历是从哪个文件名、哪个门店确认来的」
        // 必须留痕，否则事后发现挂错店完全查不回去。历史行没有这个键，读侧按缺失处理。
        JSON.stringify({
          querySuccess: true,
          apiResult: analysis.apiResult,
          // v1.13.427：报表原生「分类 + 中文含义 + 数值」逐行快照（长表原貌）。
          // 详情弹窗优先用它渲染（中文分组与行名都来自报表本身，不靠猜）；
          // apiResult 保持不变，AI/洞察/评分/分享不受影响。老记录没有这个键 ⇒ 走旧渲染。
          reportRows: analysis.reportRows || [],
          refunded: false,
          importMeta: {
            fileName: original,
            parsedStoreName: analysis.storeName,      // 文件名/E21 解析出来的原名
            storeName: analysis.marker.name,          // 真正落库的门店名
            storeId: analysis.marker.id,
            confirmedByUser: !!analysis.confirmedByUser
          }
        })
      )
      storeNameOfFile[diskName] = analysis.marker.name
      imported.push({
        fileKey: diskName,
        fileName: original,
        purchaseId: insertResult.lastInsertRowid,
        storeName: analysis.marker.name,
        parsedStoreName: analysis.storeName,
        radiusM: analysis.radiusM,
        cityMonth: analysis.cityMonth,
        rowCount: analysis.rowCount,
        nameMismatchWarning: !!analysis.nameMismatchWarning,
        confirmedByUser: !!analysis.confirmedByUser
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

// ============ 接口三：门店搜索（近似名兜底，v1.13.425） ============
// 用途：相似度算不出来的场景（改名、换址、差三个字以上）让用户自己在下拉里搜。
// ⛔ 不做自动匹配，只把「本人可见门店」的名字/地址列出来供人判断。
// 只读、不写库、不扣配额。口径与候选池完全一致（同可见域、同软删、同关停过滤）。
const STORE_SEARCH_LIMIT = 50
router.get('/stores', authenticate, (req, res) => {
  const q = String(req.query.q == null ? '' : req.query.q).trim()
  if (!q) return res.status(400).json({ message: '请输入门店名关键字' })
  if (q.length > 30) return res.status(400).json({ message: '关键字过长（最多 30 字）' })
  const db = getDb()
  // 🔴 LIKE 必须转义：门店名本身可能含 `_`（文件名规则就是 门店名_半径km_月份）
  const like = `%${escapeLike(q)}%`
  const rows = db.prepare(`
    SELECT id, name, city, district, address
      FROM markers
     WHERE (user_id = ? OR user_id IS NULL)
       AND merged_into IS NULL
       ${NOT_CLOSED_STATUS_SQL}
       AND name LIKE ? ESCAPE '\\'
     ORDER BY name
     LIMIT ${STORE_SEARCH_LIMIT}
  `).all(req.user.id, ...NOT_CLOSED_STATUS_PARAMS, like)
  res.json({ stores: rows, total: rows.length, limit: STORE_SEARCH_LIMIT })
})

// ============ 接口四：映射预核（只读，v1.13.426） ============
// 用途：前端把「某个门店」套用到若干文件后，**逐文件**确认这件事的后端结论 ——
//   ① 该门店是否仍存在、仍属于当前账号（未被删/被合并/被划走）；
//   ② 该门店 + 该文件的半径/月份/坐标 是否已有记录（＝提交时会被跳过）。
//
// 🔴 为什么不复用 preview 里 candidates[].duplicate 就完事：
//    候选自带的 duplicate 只覆盖「候选列表里那 5 个门店」。用户在下拉里**搜索**出来的门店
//    （score<70，压根不在候选里）没有这个标记，前端只能当「未知」—— 于是又回到
//    425 修掉的那个坑：预检说可导入、提交却跳重复，用户白等一场。
//
// 🔴 为什么直接调 analyzeFile 而不是另写一套判重 SQL：
//    判重口径（同门店名 + 同半径 + 同月份 + 同坐标）只能有一处实现。这里再写一份，
//    将来改口径必然漂移 ⇒「预核说能导、提交说重复」。宁可多重解析一次 xlsx（文件小、
//    ≤200 个、且只在用户点选时触发），也不许分叉口径。
// ⚠️ 只读：不写库、不扣配额、不删临时文件（用户可能还要继续改）。
const CHECK_MAX_ITEMS = 200
router.post('/check-mapping', authenticate, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  if (items.length === 0) return res.status(400).json({ message: '请提供待核对的映射' })
  if (items.length > CHECK_MAX_ITEMS) return res.status(400).json({ message: `单次最多 ${CHECK_MAX_ITEMS} 条` })

  const db = getDb()
  const pool = loadStorePool(db, req.user.id)

  const results = items.map((it) => {
    const fileKey = String(it?.fileKey == null ? '' : it.fileKey)
    const diskName = path.basename(fileKey) // 防 ../ 穿越，与 commit 同口径
    const full = join(TMP_DIR, diskName)
    if (!diskName || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return { fileKey, ok: false, reason: '文件不存在或已过期，请重新预检' }
    }
    const original = readOriginalName(diskName)
    if (!original) return { fileKey, ok: false, reason: '文件元数据缺失，请重新预检' }

    // ⚠️ storeId 是**不可信输入**：归属校验在 analyzeFile 内部（与 commit 完全同一条路）
    const a = analyzeFile(db, req.user.id, full, original, it?.storeId, pool)
    if (!a.ok) {
      return {
        fileKey,
        ok: false,
        needConfirm: !!a.needConfirm,
        reason: a.needConfirm
          ? '该文件名与门店不同名，请先在预检里选择对应门店后再导入'
          : a.reason || '该门店不可用'
      }
    }
    return {
      fileKey,
      ok: true,
      storeName: a.marker.name,
      radiusM: a.radiusM,
      cityMonth: a.cityMonth,
      duplicate: !!a.duplicate
    }
  })

  res.json({ results, total: results.length })
})

export default router
