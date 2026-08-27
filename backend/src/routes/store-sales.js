import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// 门店月度销售：按用户隔离；admin 可通过 ?all=1 查看全部
// 唯一键 (user_id, store_id, year, month) → 同店同月重复提交 = 幂等覆盖

// 获取销售记录列表（可按门店/年/月筛选）
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const { storeId, year, month, all } = req.query
    const conds = []
    const params = []
    if (!(all === '1' && req.user.role === 'admin')) {
      conds.push('user_id = ?')
      params.push(req.user.id)
    }
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
    const rows = db.prepare(
      `SELECT year, month, sales_amount, store_area, delivery_ratio, customer_count
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
      series.push({ year: y, month: m, salesAmount: hit ? hit.sales_amount : null, storeArea: hit ? hit.store_area : null })
    }
    res.json({
      success: true, storeId, yearTotal, curYear, series,
      annual: latestAnnual ? { year: latestAnnual.year, salesAmount: latestAnnual.sales_amount, storeArea: latestAnnual.store_area, deliveryRatio: latestAnnual.delivery_ratio } : null
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
      (user_id, store_id, store_name, brand, city, year, month, sales_amount, store_area, delivery_ratio, customer_count, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, store_id, year, month) DO UPDATE SET
        sales_amount = excluded.sales_amount,
        store_area = excluded.store_area,
        delivery_ratio = excluded.delivery_ratio,
        customer_count = excluded.customer_count,
        remark = excluded.remark,
        updated_at = CURRENT_TIMESTAMP`)

    const results = []
    let okCount = 0
    for (const it of items) {
      const storeId = Number(it.storeId)
      const year = Number(it.year)
      // month=0 表示年度汇总记录（按年录入）；1-12 为月度
      const month = it.month === undefined || it.month === null || it.month === '' ? 0 : Number(it.month)
      const amount = Number(it.salesAmount)
      if (!storeId || !year || isNaN(month) || month < 0 || month > 12 || isNaN(amount)) {
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
        it.remark || null
      )
      okCount++
      results.push({ storeId, year, month, ok: true })
    }
    db.saveNow && db.saveNow()
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

export default router
