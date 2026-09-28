import express from 'express'
import multer from 'multer'
import fs from 'fs'
import * as XLSX from 'xlsx'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { bandByKey, bandMidYuan, parseBandInput } from '../utils/salesBand.js'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// 门店月度销售：按用户隔离；admin 可通过 ?all=1 查看【聚合】（不出金额）
// 唯一键 (user_id, store_id, year, month) → 同店同月重复提交 = 幂等覆盖

/**
 * v1.13.186：admin 的 `?all=1` 收窄为【只出聚合、不出金额】。
 *
 * 背景：原实现 `all === '1' && role === 'admin'` 会把**全部客户**的销售明细
 * （含属保密信息的 sales_amount）直接返回给平台侧，这与 `utils/visibleScope.js`
 * 写下的既有原则直接冲突 ——「admin 是平台运维角色，放开等于让平台能读所有
 * 客户的付费数据，与数据隐私最高优先级冲突」。
 *
 * 现在只回答「有多少」，**绝不回答「是多少」**：
 *   · 条数 / 账号数 / 门店数 / 年度分布 / 覆盖率 / 档位录入占比
 *   · ⛔ 不含 sales_amount 的任何形式（SUM/AVG/MAX 一律不出）
 *
 * 留痕走 pm2 日志而**不落表** —— 本项目每次 saveNow() 都是整库写盘（160MB+），
 * 为一行日志付这个代价会拖垮 2C 小机（见 database.js 的写放大注释）。
 */
function buildSalesAggregate(db) {
  const t = db.prepare(`
    SELECT COUNT(*) AS records,
           COUNT(DISTINCT user_id) AS accounts,
           COUNT(DISTINCT store_id) AS stores,
           SUM(CASE WHEN sales_band IS NOT NULL THEN 1 ELSE 0 END) AS bandRecords,
           MIN(year) AS minYear, MAX(year) AS maxYear
      FROM store_sales`).get() || {}
  const years = db.prepare(`
    SELECT year,
           COUNT(*) AS records,
           COUNT(DISTINCT store_id) AS stores,
           COUNT(DISTINCT user_id) AS accounts
      FROM store_sales GROUP BY year ORDER BY year DESC`).all()
  const openStores = (db.prepare(
    `SELECT COUNT(*) AS n FROM markers WHERE store_type = '已开业'`
  ).get() || {}).n || 0
  const withSales = t.stores || 0
  return {
    records: t.records || 0,
    accounts: t.accounts || 0,
    stores: withSales,
    bandRecords: t.bandRecords || 0,
    minYear: t.minYear || null,
    maxYear: t.maxYear || null,
    openStores,
    coverage: openStores > 0 ? Number((withSales / openStores).toFixed(4)) : null,
    years
  }
}

// 获取销售记录列表（可按门店/年/月筛选）
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const { storeId, year, month, all } = req.query
    // admin 视角：只给聚合，不给明细与金额（v1.13.186 收窄）
    if (all === '1' && req.user.role === 'admin') {
      const summary = buildSalesAggregate(db)
      console.log(`[audit][store-sales] admin 聚合查阅 user=${req.user.id} ip=${req.ip || '-'} records=${summary.records} accounts=${summary.accounts} stores=${summary.stores}`)
      return res.json({ success: true, aggregate: true, summary })
    }
    const conds = []
    const params = []
    conds.push('user_id = ?')
    params.push(req.user.id)
    if (storeId) {
      conds.push('store_id = ?')
      params.push(Number(storeId))
    }
    if (year) {
      conds.push('year = ?')
      params.push(Number(year))
    }
    if (month) {
      conds.push('month = ?')
      params.push(Number(month))
    }
    const where = conds.length ? ' WHERE ' + conds.join(' AND ') : ''
    const rows = db.prepare(`SELECT * FROM store_sales${where} ORDER BY year DESC, month DESC, id DESC`).all(...params)
    res.json({ success: true, sales: rows })
  } catch (e) {
    console.error('[store-sales] 列表失败:', e.message)
    res.status(500).json({ message: '获取销售记录失败' })
  }
})

// 门店近 N 月销售历史（趋势用）
router.get('/stores/:storeId/history', authenticate, (req, res) => {
  try {
    const db = getDb()
    const storeId = Number(req.params.storeId)
    const months = Math.min(Number(req.query.months) || 12, 60)
    // 先校验门店归属（admin 或本人）
    const store = db.prepare('SELECT id, user_id FROM markers WHERE id = ?').get(storeId)
    if (!store) return res.status(404).json({ message: '门店不存在' })
    if (req.user.role !== 'admin' && store.user_id !== req.user.id) {
      return res.status(403).json({ message: '无权查看该门店' })
    }
    // ⚠️ v1.13.186：admin 对**非自己名下**门店不再返回金额 —— 原实现在这里只做
    // 「admin 放行」判断，平台侧仍可逐店读明文金额，与 `?all=1` 是同一扇门的
    // 另一条缝，一并收窄。保留「有没有记录」这一事实（排查仍够用），但不给数值。
    if (req.user.role === 'admin' && Number(store.user_id) !== Number(req.user.id)) {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM store_sales WHERE store_id = ?').get(storeId) || {}).n || 0
      console.log(`[audit][store-sales] admin 查阅他店历史被收窄 user=${req.user.id} store=${storeId} ip=${req.ip || '-'} rows=${n}`)
      return res.json({
        success: true, storeId, restricted: true, recordCount: n,
        yearTotal: null, curYear: new Date().getFullYear(), series: [], annual: null,
        message: '销售数据仅门店归属账号可见'
      })
    }
    const rows = db.prepare(
      `SELECT year, month, sales_amount, store_area, delivery_ratio, customer_count, sales_band
       FROM store_sales WHERE store_id = ? ORDER BY year, month`
    ).all(storeId)
    // 汇总本年累计 + 近 N 月序列
    const now = new Date()
    const curYear = now.getFullYear()
    // 年度记录（month=0）优先：存在年度记录则直接用，否则汇总月度
    const annualRec = rows.find(r => r.year === curYear && r.month === 0)
    let yearTotal = annualRec ? annualRec.sales_amount : 0
    if (!annualRec) {
      rows.forEach(r => { if (r.year === curYear && r.month > 0) yearTotal += r.sales_amount })
    }
    // 年度记录（跨年展示用）：最近完整年份优先（当年-1，当年未结束不算完整），无则取最新
    const annuals = rows.filter(r => r.month === 0).sort((a, b) => b.year - a.year)
    const latestAnnual = annuals.find(a => a.year === curYear - 1) || annuals[0] || null
    const monthKey = (y, m) => y * 12 + m
    const nowKey = curYear * 12 + (now.getMonth() + 1)
    const series = []
    for (let k = nowKey - months + 1; k <= nowKey; k++) {
      const y = Math.floor((k - 1) / 12)
      const m = ((k - 1) % 12) + 1
      const hit = rows.find(r => r.year === y && r.month === m)
      // band：档位录入时非 null ⇒ 前端须展示区间并标注「档位估值」（salesAmount 只是中点）
      series.push({ year: y, month: m, salesAmount: hit ? hit.sales_amount : null, storeArea: hit ? hit.store_area : null, band: hit ? (hit.sales_band || null) : null })
    }
    res.json({
      success: true, storeId, yearTotal, curYear, series,
      annual: latestAnnual ? { year: latestAnnual.year, salesAmount: latestAnnual.sales_amount, storeArea: latestAnnual.store_area, deliveryRatio: latestAnnual.delivery_ratio, band: latestAnnual.sales_band || null } : null
    })
  } catch (e) {
    console.error('[store-sales] 历史失败:', e.message)
    res.status(500).json({ message: '获取销售历史失败' })
  }
})

// 批量 upsert（单条或多条）：[{storeId, year, month, salesAmount, storeArea?, customerCount?, remark?}]
router.post('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    let items = req.body && req.body.items ? req.body.items : req.body
    if (!Array.isArray(items)) items = [items]
    if (items.length === 0) return res.status(400).json({ message: '没有要保存的数据' })

    const upsert = db.prepare(`INSERT INTO store_sales
      (user_id, store_id, store_name, brand, city, year, month, sales_amount, store_area, delivery_ratio, customer_count, sales_band, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, store_id, year, month) DO UPDATE SET
        sales_amount = excluded.sales_amount,
        store_area = excluded.store_area,
        delivery_ratio = excluded.delivery_ratio,
        customer_count = excluded.customer_count,
        sales_band = excluded.sales_band,
        remark = excluded.remark,
        updated_at = CURRENT_TIMESTAMP`)

    const results = []
    let okCount = 0
    // H3/S1-A：批量保存包事务——N 条 upsert 从 N 次整库落盘收敛为 1 次（commitTx 统一落盘）
    db.beginTx()
    try {
      for (const it of items) {
        const storeId = Number(it.storeId)
        const year = Number(it.year)
        // month=0 表示年度汇总记录（按年录入）；1-12 为月度
        const month = it.month === undefined || it.month === null || it.month === '' ? 0 : Number(it.month)
        // v1.13.186：档位录入（salesBand）优先于精确值。
        // 档位命中 ⇒ 金额取【区间中点】落库（下游销售预测/坪效零改动），
        // 同时把 key 记进 sales_band，供展示端标注「档位估值」。
        // ⛔ 给了无法识别的档位时【直接报错】，绝不静默落回精确值 ——
        //    否则用户以为存了档位、实际存了精确值，属静默语义漂移（比报错危险得多）。
        let band = null
        const rawBand = it.salesBand
        if (rawBand !== undefined && rawBand !== null && String(rawBand).trim() !== '') {
          band = bandByKey(rawBand)
          if (!band) {
            results.push({ storeId, ok: false, reason: `未知档位：${rawBand}` })
            continue
          }
        }
        const amount = band ? bandMidYuan(band.key) : Number(it.salesAmount)
        // ⚠️ 沿用原判据 isNaN（保留「允许 0」的既有语义），只额外挡住 Infinity
        if (!storeId || !year || isNaN(month) || month < 0 || month > 12 || isNaN(amount) || !Number.isFinite(amount)) {
          results.push({ storeId, ok: false, reason: '参数不完整或格式错误' })
          continue
        }
        // 门店归属校验 + 快照字段
        const store = db.prepare('SELECT id, name, brand, city, user_id FROM markers WHERE id = ?').get(storeId)
        if (!store) {
          results.push({ storeId, ok: false, reason: '门店不存在' })
          continue
        }
        if (req.user.role !== 'admin' && store.user_id !== req.user.id) {
          results.push({ storeId, ok: false, reason: '无权操作该门店' })
          continue
        }
        const dr = it.deliveryRatio !== undefined && it.deliveryRatio !== null && it.deliveryRatio !== '' ? Number(it.deliveryRatio) : null
        upsert.run(
          req.user.id, storeId,
          store.name || '', store.brand || '', store.city || '',
          year, month,
          amount,
          it.storeArea !== undefined && it.storeArea !== null && it.storeArea !== '' ? Number(it.storeArea) : (store.store_area || null),
          (dr !== null && dr >= 0 && dr <= 100) ? Math.round(dr) : null,
          it.customerCount !== undefined && it.customerCount !== null && it.customerCount !== '' ? Number(it.customerCount) : null,
          band ? band.key : null,
          it.remark || null
        )
        okCount++
        results.push({ storeId, year, month, ok: true })
      }
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }
    res.json({ success: true, ok: okCount, total: items.length, results })
  } catch (e) {
    console.error('[store-sales] 保存失败:', e.message)
    res.status(500).json({ message: '保存销售记录失败', detail: e.message })
  }
})

// 删除单条记录（仅自己的）
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const id = Number(req.params.id)
    const row = db.prepare('SELECT id, user_id FROM store_sales WHERE id = ?').get(id)
    if (!row) return res.status(404).json({ message: '记录不存在' })
    if (req.user.role !== 'admin' && row.user_id !== req.user.id) {
      return res.status(403).json({ message: '无权删除' })
    }
    db.prepare('DELETE FROM store_sales WHERE id = ?').run(id)
    db.saveNow && db.saveNow()
    res.json({ success: true })
  } catch (e) {
    console.error('[store-sales] 删除失败:', e.message)
    res.status(500).json({ message: '删除失败' })
  }
})

// 下载 Excel 导入模板（含示例行）
router.get('/template', authenticate, (req, res) => {
  try {
    const data = [
      ['门店编号', '门店名称', '年份', '年销售额(万元)', '销售档位', '面积(㎡)', '外卖占比(%)', '备注'],
      ['2508', '周浦新田360广场店', 2026, 600, '', 120, 40, '示例行（导入前请删除）。销售档位可选填：< 200 万 / 200 – 400 万 / 400 – 600 万 / 600 – 1000 万 / 1000 – 2000 万 / > 2000 万；填了档位则忽略「年销售额」']
    ]
    const ws = XLSX.utils.aoa_to_sheet(data)
    ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 40 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '销售录入')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="sales-import-template.xlsx"')
    res.send(buf)
  } catch (e) {
    console.error('[store-sales] 模板生成失败:', e.message)
    res.status(500).json({ message: '模板生成失败' })
  }
})

// Excel 批量导入（门店编号优先匹配，名称兜底；按当前用户过滤）
router.post('/import', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请上传 Excel 文件' })
  const userId = req.user.id
  const isAdmin = req.user.role === 'admin'
  try {
    const db = getDb()
    const wb = XLSX.read(fs.readFileSync(req.file.path), { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    if (rows.length === 0) return res.status(400).json({ message: 'Excel 无有效数据行' })

    // 当前用户的门店索引（admin 看全部）
    const stores = db.prepare(
      isAdmin
        ? 'SELECT id, store_code, name, brand, city, store_area FROM markers'
        : 'SELECT id, store_code, name, brand, city, store_area FROM markers WHERE user_id = ?'
    ).all(...(isAdmin ? [] : [userId]))

    const upsert = db.prepare(`INSERT INTO store_sales
      (user_id, store_id, store_name, brand, city, year, month, sales_amount, store_area, delivery_ratio, sales_band, remark)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, store_id, year, month) DO UPDATE SET
        sales_amount = excluded.sales_amount,
        store_area = excluded.store_area,
        delivery_ratio = excluded.delivery_ratio,
        sales_band = excluded.sales_band,
        remark = excluded.remark,
        updated_at = CURRENT_TIMESTAMP`)

    const findStore = (code, name) => {
      const codeHits = code ? stores.filter(s => s.store_code === code) : []
      if (codeHits.length === 1) return { store: codeHits[0] }
      if (codeHits.length > 1) return { err: '门店编号重复，请用门店名称' }
      const nameHits = name ? stores.filter(s => s.name === name) : []
      if (nameHits.length === 1) return { store: nameHits[0] }
      if (nameHits.length > 1) return { err: '门店名称重复，请补充编号' }
      return { err: `未找到门店（编号：${code || '空'}，名称：${name || '空'}）` }
    }

    const results = []
    let okCount = 0
    // H3/S1-A：Excel 批量导入包事务——逐行 upsert 从逐次落盘收敛为 1 次，任一行失败整体回滚
    db.beginTx()
    try {
      rows.forEach((r, idx) => {
        const rowNo = idx + 2
        const code = String(r['门店编号'] || '').trim()
        const name = String(r['门店名称'] || '').trim()
        const year = Number(r['年份'])
        const amountW = Number(r['年销售额(万元)'])
        const bandRaw = String(r['销售档位'] || '').trim()
        const areaRaw = String(r['面积(㎡)'] || '').trim()
        const drRaw = String(r['外卖占比(%)'] || '').trim()
        const remark = String(r['备注'] || '').trim() || null

        if (!code && !name) { results.push({ row: rowNo, reason: '门店编号与名称均为空' }); return }
        const matched = findStore(code, name)
        if (matched.err) { results.push({ row: rowNo, reason: matched.err }); return }
        if (!year || year < 2000 || year > 2100) { results.push({ row: rowNo, reason: `年份无效：${r['年份']}` }); return }
        // v1.13.186：档位列优先——填了档位就忽略「年销售额」（给不想上传精确值的用户一条路）。
        // ⛔ 档位文本识别不了时直接报错，不静默退回按精确值处理。
        let bandKey = null
        if (bandRaw) {
          bandKey = parseBandInput(bandRaw)
          if (!bandKey) { results.push({ row: rowNo, reason: `销售档位无法识别（可填：< 200 万 / 200 – 400 万 / 400 – 600 万 / 600 – 1000 万 / 1000 – 2000 万 / > 2000 万）：${bandRaw}` }); return }
        }
        if (!bandKey && (isNaN(amountW) || amountW <= 0)) { results.push({ row: rowNo, reason: `年销售额无效（需>0，或改填「销售档位」）：${r['年销售额(万元)']}` }); return }
        let dr = null
        if (drRaw !== '') {
          dr = Number(drRaw)
          if (isNaN(dr) || dr < 0 || dr > 100) { results.push({ row: rowNo, reason: `外卖占比无效（0-100）：${drRaw}` }); return }
          dr = Math.round(dr)
        }
        const area = areaRaw !== '' ? Number(areaRaw) : (matched.store.store_area || null)
        const amountYuan = bandKey ? bandMidYuan(bandKey) : Math.round(amountW * 10000)
        upsert.run(userId, matched.store.id, matched.store.name || '', matched.store.brand || '', matched.store.city || '',
          year, amountYuan, isNaN(area) ? null : area, dr, bandKey, remark)
        okCount++
        results.push({ row: rowNo, ok: true })
      })
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    try { fs.unlinkSync(req.file.path) } catch (e) {}
    const fails = results.filter(r => !r.ok)
    res.json({ success: true, ok: okCount, total: rows.length, results: fails })
  } catch (e) {
    console.error('[store-sales] 导入失败:', e.message)
    try { fs.unlinkSync(req.file.path) } catch (e2) {}
    res.status(500).json({ message: '导入失败：' + e.message })
  }
})

export default router
