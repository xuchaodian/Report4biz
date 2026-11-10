import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { resolveCompBrands, brandScopeMeta, normalizeMyBrand } from '../utils/competitorScope.js'
// 归一函数只有一份实现，在 storeDedup.js（competitorScope.js 内部也是 import 它，未 re-export）
import { normalizeBrand } from '../utils/storeDedup.js'

/**
 * 自有品牌 → 竞品品牌集合 配置（v1.13.344）
 * ⛔ 独立前缀挂载：不能挂到 /api/competitors 下，会被 GET /:id 吞掉。
 * ⛔ 写接口必须挂 authenticate（routeAuthGuard 全局守卫会扫）。
 * ⛔ 只写本账号配置，不碰 competitors 表、不进集团同步。
 */
const router = express.Router()

function ownsBrand(db, userId, myBrand) {
  return !!db.prepare(
    `SELECT 1 FROM markers WHERE user_id = ? AND UPPER(TRIM(COALESCE(brand,''))) = ? AND merged_into IS NULL LIMIT 1`
  ).get(userId, normalizeBrand(myBrand))
}

// 读：账号自有品牌 / 可用竞品品牌 / 全量映射 / 本次生效口径
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const compBrands = resolveCompBrands(db, req.user.id, req.query.myBrand)
    res.json(brandScopeMeta(db, req.user.id, compBrands))
  } catch (e) {
    console.error('[brand-competitor-map] 读取失败:', e.message)
    res.status(500).json({ message: '读取配置失败' })
  }
})

// 写：整体覆盖某自有品牌的竞品品牌集合（头表 + 明细，单事务）
router.put('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const myBrand = normalizeMyBrand(req.body?.myBrand)
    const raw = req.body?.competitorBrands
    if (!myBrand) return res.status(400).json({ message: '缺少自有品牌' })
    if (!Array.isArray(raw)) return res.status(400).json({ message: '竞品品牌集合格式错误' })
    if (!ownsBrand(db, req.user.id, myBrand)) {
      return res.status(400).json({ message: '该品牌不在「我的门店」里' })
    }
    const clean = Array.from(new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean)))
    if (clean.length > 200) return res.status(400).json({ message: '竞品品牌过多（上限 200）' })
    const esc = v => "'" + String(v).replace(/'/g, "''") + "'"
    db.beginTx()
    try {
      db.exec(`INSERT INTO brand_competitor_scope (user_id, my_brand, updated_at)
               VALUES (${Number(req.user.id)}, ${esc(myBrand)}, datetime('now'))
               ON CONFLICT(user_id, my_brand) DO UPDATE SET updated_at = datetime('now')`)
      db.exec(`DELETE FROM brand_competitor_map WHERE user_id = ${Number(req.user.id)} AND my_brand = ${esc(myBrand)}`)
      for (const b of clean) {
        db.exec(`INSERT OR IGNORE INTO brand_competitor_map (user_id, my_brand, competitor_brand)
                 VALUES (${Number(req.user.id)}, ${esc(myBrand)}, ${esc(b)})`)
      }
      db.commitTx()
    } catch (txErr) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txErr
    }
    res.json({ success: true, ...brandScopeMeta(db, req.user.id, clean) })
  } catch (e) {
    console.error('[brand-competitor-map] 保存失败:', e.message)
    res.status(500).json({ message: '保存配置失败' })
  }
})

// 取消配置 ⇒ 退回全量（老口径）
router.delete('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const myBrand = normalizeMyBrand(req.query.myBrand)
    if (!myBrand) return res.status(400).json({ message: '缺少自有品牌' })
    const esc = v => "'" + String(v).replace(/'/g, "''") + "'"
    db.beginTx()
    try {
      db.exec(`DELETE FROM brand_competitor_map WHERE user_id = ${Number(req.user.id)} AND my_brand = ${esc(myBrand)}`)
      db.exec(`DELETE FROM brand_competitor_scope WHERE user_id = ${Number(req.user.id)} AND my_brand = ${esc(myBrand)}`)
      db.commitTx()
    } catch (txErr) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txErr
    }
    res.json({ success: true, ...brandScopeMeta(db, req.user.id, null) })
  } catch (e) {
    console.error('[brand-competitor-map] 删除失败:', e.message)
    res.status(500).json({ message: '删除配置失败' })
  }
})

export default router
