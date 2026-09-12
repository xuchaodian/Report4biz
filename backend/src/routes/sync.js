// ============================================================================
// 数据同步（v0.10 起 · 集团/子公司数据同步）
// ----------------------------------------------------------------------------
// 批次 C（v0.10）只落一个接口：
//   GET /api/sync/scope-options   管辖范围可选项（城市 + 品牌 + 门店计数）
//
// 批次 D 将在此文件补齐同步主链路（§6）：
//   GET  /api/sync/candidates   候选（按 scope 圈定，越界静默丢弃并计数 —— 规则 11）
//   POST /api/sync/preview      先看后写（批次 id + 增减改明细）
//   POST /api/sync/commit       正式写入
//   GET  /api/sync/batches      历史批次（审计）
//   GET  /api/sync/batches/:id  批次详情
//   POST /api/sync/batches/:id/rollback   回滚（P2）
//   POST /api/sync/detach/:kind/:id  · DELETE /api/sync/foreign/:kind/:id
//   PATCH /api/sync/belong      集团批量改「归属公司」
//
// ★ 分文件而不是塞进 orgs.js 的原因：路径前缀就是 /api/sync（设计方案 §6），
//   而 orgs.js 挂在 /api/orgs 上；把 /scope-options 放进 orgs.js 会与 /:id 抢段位。
// ============================================================================

import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { normalizeCity, parseCityList } from '../utils/scopeGuard.js'

const router = express.Router()

/**
 * GET /api/sync/scope-options?orgId=&userId=
 * 管辖范围抽屉（§7.5）的下拉数据源。
 *
 * 入参：
 *   orgId   可选。给出时选项取**集团总部账号**名下的数据，并校验调用者是
 *           本组织 owner 或平台 admin；缺省时退化为「取自己账号的数据」。
 *   userId  可选。用于回显该成员当前已选城市（selected），便于前端提示
 *           「已选但集团当前无门店」的城市。
 *
 * 返回：
 *   cities  [{ name, key, count }]  城市候选（按门店数降序）
 *   brands  string[]                品牌候选（markers.brand ∪ competitors.brand）
 *   totalMarkers                    集团账号门店总数（用于「预计可同步」）
 *   selected                        该成员当前 scope 里的城市（回显用）
 *
 * ★ 城市候选为什么取「集团账号 markers 里出现过的城市」而不是行政区划全集：
 *   scope 的语义是「集团能同步给子公司哪些城市」（§D4 两层圈定），
 *   集团根本没有门店的城市设了也没有任何行可同步，反而把下拉框撑到几千项。
 *   只到城市级、不细分区县 —— 规则 11。
 */
router.get('/scope-options', authenticate, (req, res) => {
  try {
    const db = getDb()
    const orgIdRaw = Number.parseInt(req.query?.orgId, 10)
    let org = null
    let sourceUserId = req.user?.id

    if (Number.isInteger(orgIdRaw) && orgIdRaw > 0) {
      org = db.prepare(`
        SELECT * FROM organizations WHERE id = ? AND dissolved_at IS NULL
      `).get(orgIdRaw)
      if (!org) return res.status(404).json({ message: '集团不存在' })

      const isAdmin = req.user?.role === 'admin'
      const isOwner = org.owner_user_id === req.user?.id
      if (!isAdmin && !isOwner) {
        return res.status(403).json({ message: '无权限查看该集团的管辖范围选项' })
      }
      sourceUserId = org.owner_user_id   // 选项取自集团账号名下的数据
    }

    // ---- 城市候选：按归一化键聚合（「上海市 / 上海」视为同城）----
    const cityRows = db.prepare(`
      SELECT city, COUNT(*) AS n
        FROM markers
       WHERE user_id = ? AND city IS NOT NULL AND TRIM(city) != ''
       GROUP BY city
       ORDER BY n DESC
    `).all(sourceUserId)

    const cityMap = new Map()
    for (const r of cityRows) {
      const key = normalizeCity(r.city)
      if (!key) continue
      const hit = cityMap.get(key)
      if (hit) {
        hit.count += r.n
      } else {
        cityMap.set(key, { name: String(r.city).trim(), key, count: r.n })
      }
    }
    const cities = [...cityMap.values()].sort((a, b) => b.count - a.count)

    // ---- 品牌候选：自家门店 ∪ 竞品门店 ----
    const brandSet = new Set()
    const pushBrands = (rows) => {
      for (const r of rows) {
        const b = String(r.brand ?? '').trim()
        if (b) brandSet.add(b)
      }
    }
    pushBrands(db.prepare(`
      SELECT DISTINCT brand FROM markers
       WHERE user_id = ? AND brand IS NOT NULL AND TRIM(brand) != ''
    `).all(sourceUserId))
    pushBrands(db.prepare(`
      SELECT DISTINCT brand FROM competitors
       WHERE user_id = ? AND brand IS NOT NULL AND TRIM(brand) != ''
    `).all(sourceUserId))
    const brands = [...brandSet].sort((a, b) => a.localeCompare(b, 'zh'))

    // ---- 该成员当前已选（回显用；集团无数据的已选城市也应能显示出来）----
    let selected = []
    const memberUserId = Number.parseInt(req.query?.userId, 10)
    if (org && Number.isInteger(memberUserId) && memberUserId > 0) {
      const m = db.prepare(`
        SELECT scope_json FROM org_members WHERE org_id = ? AND user_id = ?
      `).get(org.id, memberUserId)
      selected = parseCityList(m?.scope_json)
    }

    res.json({
      ok: true,
      orgId: org ? org.id : null,
      sourceUserId,
      cities,
      brands,
      totalMarkers: cities.reduce((s, c) => s + c.count, 0),
      selected,
      note: '城市候选 = 集团账号「我的门店」中出现过的城市；管辖范围只到城市级（规则 11）'
    })
  } catch (error) {
    console.error('获取管辖范围选项失败:', error)
    res.status(500).json({ message: '获取管辖范围选项失败' })
  }
})

export default router
