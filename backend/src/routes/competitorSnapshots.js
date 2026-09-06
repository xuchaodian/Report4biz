/**
 * 竞品期次快照路由（开关店监测 · P0）
 * 挂载点：app.js `app.use('/api/competitors/snapshots', ...)` —— 必须在 /api/competitors 之前注册，
 * 否则 competitors.js 的 GET /:id 会把 'snapshots' 当 id 吞掉。
 * 设计依据：竞品季度开关店监测-实施计划 v2.2（§3 打通规则 / §5 版本识别 / §6 B+ 实体收编 / §7 API）
 */
import express from 'express'
import multer from 'multer'
import Papa from 'papaparse'
import fs from 'fs'
import { getDb, saveDatabase } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import {
  parsePeriod, enumToDisplayText, detectDataVersion,
  normalizeRows, estimateManualAdoptions, diffSnapshots, cityMissingCheck, md5OfBuffer,
  nameSimilarity
} from '../utils/competitorSnapshotCore.js'

const router = express.Router()
const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } })
const MAX_IMPORT_ROWS = 10000

/* ---------- 内部工具 ---------- */
const esc = v => v === null || v === undefined || v === '' ? 'NULL' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'NULL') : "'" + String(v).replace(/'/g, "''") + "'"
const escKeepEmpty = v => v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'"

/** 还原 multer/busboy 按 latin1 解码的中文文件名（UTF-8 字节被逐字节读成 latin1 → 乱码） */
function fixUploadedName(name) {
  if (!name) return ''
  // 已含 CJK → 无乱码
  if (/[\u4e00-\u9fff]/.test(name)) return name
  try {
    const restored = Buffer.from(name, 'latin1').toString('utf8')
    // 还原后应出现 CJK 且无 U+FFFD（replacement char 说明本来就不是 latin1 乱码）
    return /[\u4e00-\u9fff]/.test(restored) && !restored.includes('\uFFFD') ? restored : name
  } catch (e) {
    return name
  }
}

/** 读取 multer 上传文件 → {buf, content, results(parsed), originalname}；失败已响应则返回 null */
function readUploadedFile(req, res) {
  if (!req.file) { res.status(400).json({ message: '请上传文件' }); return null }
  try {
    const buf = fs.readFileSync(req.file.path)
    let content = buf.toString('utf-8')
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1) // strip BOM
    const results = Papa.parse(content, { header: true, skipEmptyLines: true })
    if (results.errors && results.errors.some(e => e.type === 'Delimiter')) {
      cleanup(req); res.status(400).json({ message: 'CSV 解析失败，请检查文件格式（分隔符/编码）' }); return null
    }
    const originalname = fixUploadedName(req.file.originalname || '')
    return { buf, content, rawRows: results.data, originalname }
  } catch (e) {
    cleanup(req)
    console.error('[snapshots] 读取上传文件失败:', e.message)
    res.status(500).json({ message: '文件读取失败: ' + e.message })
    return null
  }
}
function cleanup(req) { try { if (req.file?.path) fs.unlinkSync(req.file.path) } catch (e) { /* ignore */ } }

/** 行数上限 & 结构校验，非法时已响应返回 null */
function validateParsed(req, res, rawRows) {
  if (rawRows.length > MAX_IMPORT_ROWS) {
    cleanup(req)
    res.status(400).json({ message: `导入失败：数据行数（${rawRows.length}）超过单次上限 ${MAX_IMPORT_ROWS} 行，请拆分文件后分批导入` })
    return false
  }
  if (!rawRows.length || !Object.keys(rawRows[0] || {}).length) {
    cleanup(req)
    res.status(400).json({ message: 'CSV 无有效数据行或缺少表头，请使用模板列：store_id,brand,name,city,district,address,latitude,longitude,status' })
    return false
  }
  return true
}

/** 该品牌手工行（competitors 中 snapshot_id IS NULL） */
function manualRowsOf(db, userId, brand) {
  return db.prepare(
    `SELECT id, store_code, name, city, district, latitude, longitude, description
     FROM competitors WHERE user_id = ? AND brand = ? AND snapshot_id IS NULL`
  ).all(userId, brand)
}
/** 品牌已有快照（升序）；brand 空 → 取该用户全部快照（品牌聚合用） */
function snapshotsOfBrand(db, userId, brand) {
  if (!brand) {
    return db.prepare(
      `SELECT * FROM competitor_snapshots WHERE user_id = ? ORDER BY period_seq ASC`
    ).all(userId)
  }
  return db.prepare(
    `SELECT * FROM competitor_snapshots WHERE user_id = ? AND brand = ? ORDER BY period_seq ASC`
  ).all(userId, brand)
}
/** 快照行（全量） */
function snapshotRowsOf(db, snapshotId) {
  return db.prepare(
    `SELECT store_key, name, city, district, address, latitude, longitude, status, description, extra
     FROM competitor_snapshot_rows WHERE snapshot_id = ? ORDER BY store_key`
  ).all(snapshotId)
}

/** 防御性 ID 自检：与上期重叠 key 抽 3~5 条核对门店名，大面积不一致 → 疑流水序号告警 */
function idCheckWarnOf(baseRows, newRows) {
  if (!baseRows || !baseRows.length) return null
  const baseMap = new Map(baseRows.map(r => [r.store_key, r]))
  const overlap = newRows.filter(r => baseMap.has(r.store_key)).slice(0, 5)
  if (overlap.length < 3) return null
  let mismatch = 0
  for (const nr of overlap) {
    const br = baseMap.get(nr.store_key)
    if (nameSimilarity(br.name, nr.name) < 0.5) mismatch++
  }
  if (mismatch / overlap.length > 0.5) {
    return {
      level: 'warn', message: `检测到与上一期重叠的 ${overlap.length} 条记录中 ${mismatch} 条门店名不一致 —— 疑似门店 ID 为流水序号而非稳定 ID，请核对数据源`,
      sample: overlap.map(o => ({ store_key: o.store_key, baseName: baseMap.get(o.store_key)?.name, newName: o.name }))
    }
  }
  return null
}

/* ================= GET /  快照列表 / 品牌序列 ================= */
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const { brand, period } = req.query
    if (period && !brand) return res.status(400).json({ message: '查询某期快照需同时提供 brand' })
    let rows
    if (brand && period) {
      rows = db.prepare(`SELECT * FROM competitor_snapshots WHERE user_id=? AND brand=? AND period=?`).all(req.user.id, brand, period)
      if (!rows.length) return res.status(404).json({ message: '未找到该期快照' })
      const s = rows[0]
      const detailRows = snapshotRowsOf(db, s.id)
      return res.json({ snapshots: [{ ...s, rows: detailRows }] })
    }
    rows = snapshotsOfBrand(db, req.user.id, brand || '')
    // 品牌聚合
    const byBrand = {}
    for (const s of rows) {
      if (!byBrand[s.brand]) byBrand[s.brand] = []
      byBrand[s.brand].push(s)
    }
    const brands = Object.entries(byBrand).map(([b, snaps]) => {
      snaps.sort((a, b2) => a.period_seq - b2.period_seq)
      const latest = snaps[snaps.length - 1]
      return {
        brand: b,
        snapshotCount: snaps.length,
        latestPeriod: latest.period,
        latestSeq: latest.period_seq,
        latestDataVersion: latest.data_version || '',
        snapshots: snaps.map(s => ({
          id: s.id, period: s.period, period_seq: s.period_seq,
          data_version: s.data_version || '', source_file: s.source_file || '',
          total_count: s.total_count, open_count: s.open_count,
          created_at: s.created_at
        }))
      }
    })
    if (brand) {
      const hit = brands.find(x => x.brand === brand)
      return res.json({ brands: hit ? [hit] : [] })
    }
    res.json({ brands })
  } catch (e) {
    console.error('[snapshots] 列表错误:', e)
    res.status(500).json({ message: '获取快照列表失败' })
  }
})

/* ================= POST /preview  解析不落库 ================= */
router.post('/preview', authenticate, upload.single('file'), (req, res) => {
  try {
    const f = readUploadedFile(req, res)
    if (!f) return
    if (!validateParsed(req, res, f.rawRows)) return

    const brand = String(req.body.brand || '').trim()
    const periodRaw = String(req.body.period || '').trim()
    const pp = parsePeriod(periodRaw)
    if (!brand) { cleanup(req); return res.status(400).json({ message: '请选择品牌' }) }
    if (!pp.valid) { cleanup(req); return res.status(400).json({ message: `期次格式无效：${periodRaw}（支持 2026-09 或 2026Q3）` }) }

    const db = getDb()
    const norm = normalizeRows(f.rawRows)
    const hasKeyColumn = Object.keys(f.rawRows[0]).some(h => /store_id|store_code|shopid|shop_id|门店id|门店编号|编号/i.test(h))
    const version = detectDataVersion(f.rawRows, f.originalname)
    const fileHash = md5OfBuffer(f.buf)
    const cleanRows = norm.rows
    const openCount = cleanRows.filter(r => r.status === 'open').length

    // 同 period 已存在？
    const existing = db.prepare(`SELECT * FROM competitor_snapshots WHERE user_id=? AND brand=? AND period=?`).get(req.user.id, brand, pp.label)
    const samePeriodExists = !!existing
    const sameHashExists = existing ? existing.file_hash === fileHash : false

    // 品牌已有最大 seq → 判定是否替换当前列表
    const snaps = snapshotsOfBrand(db, req.user.id, brand)
    const maxSeq = snaps.length ? Math.max(...snaps.map(s => s.period_seq)) : 0
    const willReplace = pp.seq >= maxSeq
    const currentListCount = db.prepare(`SELECT COUNT(*) c FROM competitors WHERE user_id=? AND brand=?`).get(req.user.id, brand).c
    const snapshotRowCount = db.prepare(`SELECT COUNT(*) c FROM competitors WHERE user_id=? AND brand=? AND snapshot_id IS NOT NULL`).get(req.user.id, brand).c

    // 手工店收编预判（B+）
    const manualRows = manualRowsOf(db, req.user.id, brand)
    const manualSummary = estimateManualAdoptions(manualRows, cleanRows)

    // ID 自检（与上一期比）
    let idCheckWarn = null
    if (snaps.length) {
      const prev = snaps.filter(s => s.period_seq < pp.seq).pop()
      if (prev) {
        const baseRows = snapshotRowsOf(db, prev.id)
        idCheckWarn = idCheckWarnOf(baseRows, cleanRows)
      }
    }

    // 无 store_key 列 → 整批拒绝（diff 无法对齐，防误判 closed）
    const blockImport = norm.noKeyCount > 0 && !hasKeyColumn
    cleanup(req)
    res.json({
      brand, period: pp.label, period_seq: pp.seq,
      total: cleanRows.length, openCount,
      noKeyCount: norm.noKeyCount, dupKeyCount: norm.dupKeyCount,
      missingCoordCount: norm.missingCoordCount, missingNameCount: norm.missingNameCount,
      hasKeyColumn, blockImport,
      dataVersion: version.dataVersion || null,
      versionSource: version.versionSource || null,
      versionInconsistent: version.versionInconsistent || false,
      suggestedPeriod: version.suggestedPeriod || null,
      samePeriodExists, sameHashExists, fileHash,
      willReplace, currentListCount, snapshotRowCount, maxSeq,
      manualSummary,
      idCheckWarn,
      sampleHead: cleanRows.slice(0, 5).map(r => ({ store_key: r.store_key, name: r.name, city: r.city, status: r.status }))
    })
  } catch (e) {
    cleanup(req)
    console.error('[snapshots] preview 错误:', e)
    res.status(500).json({ message: '预览失败: ' + e.message })
  }
})

/* ================= POST /import  正式落库（§3 事务 + §6 收编） ================= */
router.post('/import', authenticate, upload.single('file'), (req, res) => {
  try {
    const f = readUploadedFile(req, res)
    if (!f) return
    if (!validateParsed(req, res, f.rawRows)) return

    const brand = String(req.body.brand || '').trim()
    const periodRaw = String(req.body.period || '').trim()
    const pp = parsePeriod(periodRaw)
    let adoptIds = []
    try { adoptIds = JSON.parse(req.body.adoptIds || '[]') } catch (e) { adoptIds = [] }
    if (!brand) { cleanup(req); return res.status(400).json({ message: '请选择品牌' }) }
    if (!pp.valid) { cleanup(req); return res.status(400).json({ message: `期次格式无效：${periodRaw}` }) }
    if (!Array.isArray(adoptIds)) adoptIds = []

    const db = getDb()
    const norm = normalizeRows(f.rawRows)
    const cleanRows = norm.rows
    const openCount = cleanRows.filter(r => r.status === 'open').length
    const fileHash = md5OfBuffer(f.buf)

    // 硬性校验
    if (norm.noKeyCount > 0) {
      cleanup(req)
      return res.status(400).json({ message: `检测到 ${norm.noKeyCount} 行缺少门店 ID（store_id/store_code 列）——缺少稳定 ID 会导致开关店比对误判为闭店，请补齐后重传` })
    }

    // 同 period 且 hash 相同 → 无变化
    const existing = db.prepare(`SELECT * FROM competitor_snapshots WHERE user_id=? AND brand=? AND period=?`).get(req.user.id, brand, pp.label)
    if (existing && existing.file_hash === fileHash) {
      cleanup(req)
      return res.json({ unchanged: true, snapshotId: existing.id, message: '该期快照已存在且内容一致，无需重复导入' })
    }

    const snaps = snapshotsOfBrand(db, req.user.id, brand)
    const maxSeqBefore = snaps.length ? Math.max(...snaps.map(s => s.period_seq)) : 0
    const syncList = pp.seq >= maxSeqBefore // 上传期 ≥ 品牌最新期 → 打通替换当前列表（含首建档/重传最新期）

    // 事务内：仅当收编通过才 fallthrough
    let snapshotId = null, adopted = 0, descMerged = 0, deletedSnapshotRows = 0, mirroredCount = 0
    const changedRows = () => db.exec('SELECT changes() AS c')[0].values[0][0]
    db.exec('BEGIN TRANSACTION')
    try {
      // 1. upsert 快照批次
      const now = `datetime('now')`
      if (existing) {
        db.exec(`UPDATE competitor_snapshots SET total_count=${cleanRows.length}, open_count=${openCount}, file_hash=${esc(fileHash)}, source_file=${esc(f.originalname)}, data_version=${esc(req.body.data_version || null)}, updated_at=${now} WHERE id=${existing.id}`)
        snapshotId = existing.id
        // 2. 清旧明细
        db.exec(`DELETE FROM competitor_snapshot_rows WHERE snapshot_id=${snapshotId}`)
        deletedSnapshotRows = changedRows()
      } else {
        db.exec(`INSERT INTO competitor_snapshots (user_id, brand, period, period_seq, source_file, data_version, total_count, open_count, file_hash, created_at, updated_at)
                 VALUES (${req.user.id}, ${esc(brand)}, ${esc(pp.label)}, ${pp.seq}, ${esc(f.originalname)}, ${esc(req.body.data_version || null)}, ${cleanRows.length}, ${openCount}, ${esc(fileHash)}, ${now}, ${now})`)
        snapshotId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
      }

      if (syncList) {
        // ---- 3. 实体收编（B+）：先对手工行做收编预判，按 adoptIds 删除手工行、合并备注到 CSV 行 ----
        const manualRows = manualRowsOf(db, req.user.id, brand)
        const adoptEst = estimateManualAdoptions(manualRows, cleanRows)
        const adoptIdSet = new Set(adoptIds.map(Number))
        if (manualRows.length && adoptIdSet.size) {
          for (const item of adoptEst.items) {
            if (!adoptIdSet.has(item.manualId)) continue
            if (item.level === 'keep' || !item.csvMatch) continue // 无匹配候选不可收编
            const mn = manualRows.find(x => x.id === item.manualId)
            const csvRow = cleanRows.find(r => r.store_key === item.csvMatch.store_key)
            if (mn && csvRow) {
              // 备注合并：手工备注非空且 CSV 侧为空 → 迁入
              if (mn.description && !csvRow.description) { csvRow.description = mn.description; descMerged++ }
              db.exec(`DELETE FROM competitors WHERE id=${mn.id} AND user_id=${req.user.id} AND snapshot_id IS NULL`)
              adopted++
            }
          }
        }
        // ---- 4. 清旧快照镜像行（手工行保留）----
        db.exec(`DELETE FROM competitors WHERE user_id=${req.user.id} AND brand=${esc(brand)} AND snapshot_id IS NOT NULL`)
        deletedSnapshotRows += changedRows()
        // ---- 5. 写入新镜像（仅坐标完整行；缺坐标行只进快照溯源，地图/列表不需要）----
        const insertSql = `INSERT INTO competitors (store_code, brand, name, store_type, store_category, city, district, address, description, latitude, longitude, status, icon_color, user_id, industry, trading_area, price, rating, reviews, taste_score, environment_score, service_score, period, snapshot_id, created_at, updated_at)
          VALUES (`
        for (const r of cleanRows) {
          if (r.latitude === null || r.longitude === null) continue
          const statusText = enumToDisplayText(r.status)
          const vals = [
            esc(r.store_key), esc(brand), esc(r.name), esc(r.store_type || '竞品'), esc(r.category),
            esc(r.city), esc(r.district), esc(r.address), escKeepEmpty(r.description),
            r.latitude, r.longitude,
            esc(statusText), `'#f56c6c'`, req.user.id,
            esc(r.industry), esc(r.trading_area), r.price, r.rating, r.reviews, 0, 0, 0,
            esc(pp.label), snapshotId, `datetime('now')`, `datetime('now')`
          ].join(',')
          db.exec(insertSql + vals + ')')
          mirroredCount++
        }
      }
      // ---- 6. 明细落库 ----
      const rowSql = `INSERT INTO competitor_snapshot_rows (snapshot_id, store_key, name, city, district, address, latitude, longitude, status, extra, created_at) VALUES (`
      for (const r of cleanRows) {
        const vals = [
          snapshotId, esc(r.store_key), esc(r.name), esc(r.city), esc(r.district), esc(r.address),
          r.latitude === null ? 'NULL' : r.latitude, r.longitude === null ? 'NULL' : r.longitude,
          esc(r.status), esc(r.extra), `datetime('now')`
        ].join(',')
        db.exec(rowSql + vals + ')')
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      cleanup(req)
      console.error('[snapshots] import 事务失败:', e)
      return res.status(500).json({ message: '导入落库失败，已回滚: ' + e.message })
    }
    saveDatabase()
    cleanup(req)

    console.log(`[snapshots] import OK brand=${brand} period=${pp.label} rows=${cleanRows.length} syncList=${syncList} adopted=${adopted}`)
    res.json({
      snapshotId, brand, period: pp.label, total: cleanRows.length, openCount,
      mirroredCount: syncList ? mirroredCount : 0,
      overwritten: !!existing, deletedSnapshotRows,
      listReplaced: syncList, adopted, descMerged,
      message: `成功导入 ${cleanRows.length} 条（${pp.label}）` + (syncList ? '，竞品列表已更新为最新期' : '，历史归档未改动当前列表')
    })
  } catch (e) {
    cleanup(req)
    console.error('[snapshots] import 错误:', e)
    res.status(500).json({ message: '导入失败: ' + e.message })
  }
})

/* ================= GET /diff  ================= */
router.get('/diff', authenticate, (req, res) => {
  try {
    const db = getDb()
    const brand = String(req.query.brand || '').trim()
    const targetP = String(req.query.target || '').trim()
    if (!brand || !targetP) return res.status(400).json({ message: '需提供 brand 与 target 期次' })
    const tp = parsePeriod(targetP)
    if (!tp.valid) return res.status(400).json({ message: `target 期次无效：${targetP}` })

    const snaps = snapshotsOfBrand(db, req.user.id, brand)
    if (!snaps.length) return res.status(404).json({ message: `品牌「${brand}」暂无快照档案` })
    const targetSnap = snaps.find(s => s.period_seq === tp.seq)
    if (!targetSnap) return res.status(404).json({ message: `该品牌不存在 ${targetP} 期快照` })

    let baseSnap = null
    if (req.query.base) {
      const bp = parsePeriod(String(req.query.base))
      if (!bp.valid) return res.status(400).json({ message: 'base 期次无效' })
      baseSnap = snaps.find(s => s.period_seq === bp.seq) || null
    } else {
      // 缺省 = 紧邻上一归档期
      baseSnap = [...snaps].reverse().find(s => s.period_seq < tp.seq) || null
    }
    if (!baseSnap) {
      return res.status(200).json({ brand, target: targetP, diffUnavailable: true, message: '该品牌仅此一期或需指定更早基准期，暂无对比' })
    }
    const baseRows = snapshotRowsOf(db, baseSnap.id)
    const targetRows = snapshotRowsOf(db, targetSnap.id)
    const diff = diffSnapshots(baseRows, targetRows)
    const cityWarns = cityMissingCheck(baseRows, targetRows)
    res.json({
      brand,
      base: { period: baseSnap.period, data_version: baseSnap.data_version, openCount: diff.baseOpenCount, seq: baseSnap.period_seq },
      target: { period: targetSnap.period, data_version: targetSnap.data_version, openCount: diff.targetOpenCount, seq: targetSnap.period_seq },
      intervalPeriods: tp.seq - baseSnap.period_seq,
      openedCount: diff.openedCount, closedCount: diff.closedCount, netChange: diff.netChange, keptCount: diff.keptCount,
      opened: diff.opened, closed: diff.closed, statusChanged: diff.statusChanged,
      selfCheck: diff.selfCheck, cityWarns
    })
  } catch (e) {
    console.error('[snapshots] diff 错误:', e)
    res.status(500).json({ message: '对比失败: ' + e.message })
  }
})

/* ================= 导出工具 ================= */
function sendCsv(res, fileName, rows, columns) {
  const csv = Papa.unparse({ fields: columns, data: rows })
  const buf = Buffer.concat([Buffer.from('\uFEFF', 'utf-8'), Buffer.from(csv, 'utf-8')]) // UTF-8-SIG
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  res.send(buf)
}

/* ================= GET /export  某期快照全量 CSV ================= */
router.get('/export', authenticate, (req, res) => {
  try {
    const db = getDb()
    const brand = String(req.query.brand || '').trim()
    const period = String(req.query.period || '').trim()
    if (!brand || !period) return res.status(400).json({ message: '需提供 brand 与 period' })
    const s = db.prepare(`SELECT * FROM competitor_snapshots WHERE user_id=? AND brand=? AND period=?`).get(req.user.id, brand, period)
    if (!s) return res.status(404).json({ message: '未找到该期快照' })
    const rows = snapshotRowsOf(db, s.id)
    const displayRows = rows.map(r => ({
      store_id: r.store_key, name: r.name, brand, city: r.city, district: r.district,
      address: r.address, latitude: r.latitude, longitude: r.longitude,
      status: r.status, status_display: enumToDisplayText(r.status)
    }))
    const dv = s.data_version ? '_' + s.data_version : ''
    sendCsv(res, `${brand}_${s.period}${dv}.csv`, displayRows,
      ['store_id', 'name', 'brand', 'city', 'district', 'address', 'latitude', 'longitude', 'status', 'status_display'])
  } catch (e) {
    console.error('[snapshots] export 错误:', e)
    res.status(500).json({ message: '导出失败' })
  }
})

/* ================= GET /export-diff  变更明细 CSV ================= */
router.get('/export-diff', authenticate, (req, res) => {
  try {
    const db = getDb()
    const brand = String(req.query.brand || '').trim()
    const targetP = String(req.query.target || '').trim()
    if (!brand || !targetP) return res.status(400).json({ message: '需提供 brand 与 target' })
    const tp = parsePeriod(targetP)
    const snaps = snapshotsOfBrand(db, req.user.id, brand)
    const targetSnap = snaps.find(s => s.period_seq === tp.seq)
    if (!targetSnap) return res.status(404).json({ message: '未找到目标期快照' })
    let baseSnap
    if (req.query.base) baseSnap = snaps.find(s => s.period_seq === parsePeriod(String(req.query.base)).seq)
    else baseSnap = [...snaps].reverse().find(s => s.period_seq < tp.seq)
    if (!baseSnap) return res.status(400).json({ message: '无基准期可对比' })

    const diff = diffSnapshots(snapshotRowsOf(db, baseSnap.id), snapshotRowsOf(db, targetSnap.id))
    const out = []
    for (const r of diff.opened) out.push({ change_type: '新增', ...rowToCsv(r) })
    for (const r of diff.closed) out.push({ change_type: '关闭', ...rowToCsv(r) })
    for (const r of diff.statusChanged) out.push({ change_type: '状态变化', store_id: r.store_key, name: r.name, city: r.city, from_status: r.from, to_status: r.to })
    const dv = targetSnap.data_version ? '_' + targetSnap.data_version : ''
    sendCsv(res, `${brand}_diff_${baseSnap.period}__${targetSnap.period}${dv}.csv`, out,
      ['change_type', 'store_id', 'name', 'city', 'district', 'address', 'latitude', 'longitude', 'status', 'from_status', 'to_status'])
  } catch (e) {
    console.error('[snapshots] export-diff 错误:', e)
    res.status(500).json({ message: '导出失败' })
  }
})
function rowToCsv(r) {
  return {
    store_id: r.store_key, name: r.name, city: r.city, district: r.district,
    address: r.address, latitude: r.latitude, longitude: r.longitude, status: r.status
  }
}

/* ================= DELETE /:id  删除某期快照（撤回误传，v1.13.95） =================
 * 语义：级联三步清理 ——
 *   ① competitors 中 snapshot_id=该期的镜像行（竞品列表若正显示该期则一并移除，手工行 snapshot_id IS NULL 不受影响）
 *   ② competitor_snapshot_rows 该期明细
 *   ③ competitor_snapshots 头表
 * 归属：per-user 隔离（仅删自己名下，与列表可见性一致）；事务化 + saveDatabase 兜底
 */
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: '无效的快照 ID' })

    const snap = db.prepare(`SELECT * FROM competitor_snapshots WHERE id = ? AND user_id = ?`).get(id, req.user.id)
    if (!snap) return res.status(404).json({ message: '未找到该期快照或无权删除' })

    // 是否最新期（最新期镜像正占据竞品列表；历史期镜像在导入更新期时已被清空）
    const snaps = snapshotsOfBrand(db, req.user.id, snap.brand)
    const maxSeq = snaps.length ? Math.max(...snaps.map(s => s.period_seq)) : 0
    const isLatest = snap.period_seq === maxSeq
    const remainingAfter = snaps.filter(s => s.id !== id)

    let removedMirrored = 0
    db.exec('BEGIN TRANSACTION')
    try {
      // ① 清该期镜像行（competitors.snapshot_id=该期；手工行 NULL 不碰）
      db.exec(`DELETE FROM competitors WHERE user_id=${req.user.id} AND snapshot_id=${id}`)
      removedMirrored = db.exec('SELECT changes() AS c')[0].values[0][0]
      // ② 清该期明细
      db.exec(`DELETE FROM competitor_snapshot_rows WHERE snapshot_id=${id}`)
      // ③ 清头表
      db.exec(`DELETE FROM competitor_snapshots WHERE id=${id} AND user_id=${req.user.id}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      console.error('[snapshots] delete 事务失败:', e)
      return res.status(500).json({ message: '删除失败，已回滚: ' + e.message })
    }
    saveDatabase()

    const listReverted = isLatest && removedMirrored > 0
    console.log(`[snapshots] delete OK id=${id} brand=${snap.brand} period=${snap.period} seq=${snap.period_seq} isLatest=${isLatest} mirrored=${removedMirrored}`)
    res.json({
      message: `已删除 ${snap.period} 期快照${listReverted ? '，竞品列表中的该期镜像门店已同步移除，可重新上传正确文件' : ''}`,
      id, brand: snap.brand, period: snap.period, period_seq: snap.period_seq,
      isLatest, listReverted, removedMirrored,
      remainingCount: remainingAfter.length
    })
  } catch (e) {
    console.error('[snapshots] delete 错误:', e)
    res.status(500).json({ message: '删除失败' })
  }
})

export default router
