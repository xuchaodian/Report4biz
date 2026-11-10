import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { resolveBrandScope, brandScopeMeta, normalizeMyBrand } from '../utils/competitorScope.js'
// 归一函数只有一份实现，在 storeDedup.js（competitorScope.js 内部也是 import 它，未 re-export）
import { normalizeBrand } from '../utils/storeDedup.js'

/**
 * 自有品牌 → 竞品品牌集合 配置（v1.13.344）
 * ⛔ 独立前缀挂载：不能挂到 /api/competitors 下，会被 GET /:id 吞掉。
 * ⛔ 写接口必须挂 authenticate（routeAuthGuard 全局守卫会扫）。
 * ⛔ 只写本账号配置，不碰 competitors 表、不进集团同步。
 *
 * v1.13.351：**读**口径带上集团继承（写路径一字未动）。
 *   · 子公司自己没配某品牌 ⇒ 回退读总部账号的映射（utils/competitorScope.js::resolveBrandScope）；
 *   · 三个端点的返回体统一走 brandScopeMeta(..., resolveBrandScope(...))，
 *     因此 `brandScope.source` 会如实告诉前端「这份口径是自己配的还是继承的」；
 *   · ⚠️ DELETE（恢复）之后再解析一次：集团配过的话是**回落到继承**，不是回到全量 ——
 *     前端文案据此切换，别一律写「已恢复全量」。
 */
const router = express.Router()

function ownsBrand(db, userId, myBrand) {
  return !!db.prepare(
    `SELECT 1 FROM markers WHERE user_id = ? AND UPPER(TRIM(COALESCE(brand,''))) = ? AND merged_into IS NULL LIMIT 1`
  ).get(userId, normalizeBrand(myBrand))
}

// 读：账号自有品牌 / 可用竞品品牌 / 全量映射 / 本次生效口径（含继承来源）
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const sc = resolveBrandScope(db, req.user.id, req.query.myBrand)
    res.json(brandScopeMeta(db, req.user.id, sc.compBrands, sc))
  } catch (e) {
    console.error('[brand-competitor-map] 读取失败:', e.message)
    res.status(500).json({ message: '读取配置失败' })
  }
})

// 写：整体覆盖某自有品牌的竞品品牌集合（头表 + 明细，单事务）
// v1.13.352：新增 body.mode —— 'all' ＝该自有品牌**显式不筛选**（全量），
//   'map'（缺省，向后兼容 349 弹窗）＝按 competitorBrands 筛选。
//   mode='all' 时明细行会被清空：库里只留一条「意图」，不叠任何品牌。
router.put('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const myBrand = normalizeMyBrand(req.body?.myBrand)
    const raw = req.body?.competitorBrands
    const mode = req.body?.mode === 'all' ? 'all' : 'map'
    if (!myBrand) return res.status(400).json({ message: '缺少自有品牌' })
    // mode='all' 不要求传 competitorBrands（前端「不筛选」开关没有待选项）
    if (mode !== 'all' && !Array.isArray(raw)) return res.status(400).json({ message: '竞品品牌集合格式错误' })
    if (!ownsBrand(db, req.user.id, myBrand)) {
      return res.status(400).json({ message: '该品牌不在「我的门店」里' })
    }
    const clean = mode === 'all'
      ? []
      : Array.from(new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean)))
    if (clean.length > 200) return res.status(400).json({ message: '竞品品牌过多（上限 200）' })
    const esc = v => "'" + String(v).replace(/'/g, "''") + "'"
    db.beginTx()
    try {
      db.exec(`INSERT INTO brand_competitor_scope (user_id, my_brand, mode, updated_at)
               VALUES (${Number(req.user.id)}, ${esc(myBrand)}, '${mode}', datetime('now'))
               ON CONFLICT(user_id, my_brand) DO UPDATE SET mode = '${mode}', updated_at = datetime('now')`)
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
    // 保存后重新解析一次：本账号的 scope 行已存在 ⇒ source='self'（空集）或 'all'（全量）
    const sc = resolveBrandScope(db, req.user.id, myBrand)
    res.json({ success: true, ...brandScopeMeta(db, req.user.id, sc.compBrands, sc) })
  } catch (e) {
    console.error('[brand-competitor-map] 保存失败:', e.message)
    res.status(500).json({ message: '保存配置失败' })
  }
})

// 取消本账号配置 ⇒ 有集团映射时**回落到继承**，否则退回全量（老口径）
// 🔴 前端文案必须按返回的 brandScope.source 区分「恢复为继承」与「恢复全量」，
//    否则用户以为回到了全量，实际是按集团口径收窄 —— 这是最容易误导的一处。
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
    const sc = resolveBrandScope(db, req.user.id, myBrand)
    res.json({ success: true, ...brandScopeMeta(db, req.user.id, sc.compBrands, sc) })
  } catch (e) {
    console.error('[brand-competitor-map] 删除失败:', e.message)
    res.status(500).json({ message: '删除配置失败' })
  }
})

export default router
