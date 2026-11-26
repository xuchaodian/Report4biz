/**
 * 商圈内门店/竞品计数 —— 决定「竞争宽松度」分（v1.13.297 从 routes/districts.js 抽出）
 *
 * 🔴 为什么抽出来：门店体检的红黄绿灯要用**同一个**「竞争宽松度」判断「竞争密集」。
 *    若体检自己再数一遍竞品/自有门店，商圈洞察显示 55 分、体检说「竞争密集」，
 *    客户会认为系统乱算。抽到 util 后两处共用同一函数、同一个 60s 缓存。
 *
 * 🔴🔴 v1.13.277 修跨账号聚合：原实现是 `SELECT ... FROM competitors` / `FROM markers`
 *    **完全没有 user_id 条件**，缓存 key 里也没有用户 ⇒ 每个账号看到的「竞品 N 家 /
 *    我的门店 M 家」都是**全平台**的。生产实测门店分属 20+ 个账号、竞品集中在 3 个账号，
 *    结果只有那 3 个账号的分是"对的"，其他账号全被别人数据算出的竞争分覆盖，
 *    而综合分里竞争占 25%（90 分与 20 分相差 17.5 分）⇒ 静默失真、且属跨用户数据聚合。
 *
 * 口径：调用方传 `visibleScope.readableUserIds()` 的结果（**唯一**读时可见域入口：
 *   自己 + 本集团允许被拉取的子公司；平台 admin 刻意不放大）。
 *   ⛔ 不要在这里手写 `user_id = ?` 或 `1=1`。
 * ⚠️ 传空数组时必须返回 0（判无权），⛔ 绝不退化成「不过滤」。
 * ⚠️ 缓存 key 必须含用户集合：否则甲用户的结果会被乙用户直接命中（同一 bug 的镜像）。
 */

import NodeCache from 'node-cache'
import { getDb } from '../models/database.js'
import { pointInFeature, geometryBBox } from './geoPoint.js'
import { competitorWhere, scopeCacheKey } from './competitorScope.js'

// H4（v1.13.106）：bbox 预筛后仅对少量候选跑射线，结果按 (bbox + 数据版本) 缓存 60s。
const districtCountCache = new NodeCache({ stdTTL: 60, checkperiod: 30 })

/**
 * 数据版本指纹：两表最新 updated_at（秒级）+ **已合并行数**
 * 🔴 为什么要加已合并行数：合并只改 merged_into 与 updated_at，**行数不变**；
 *    而 updated_at 是 `datetime('now')` 秒级精度 ⇒ 同一秒内「撤销再合并」（或两次合并）
 *    指纹完全相同 ⇒ 命中旧缓存，竞争宽松度仍是合并前的值（实测踩到过）。
 */
export function storeDataVersion(db) {
  const r = db.prepare(`
    SELECT COALESCE((SELECT MAX(updated_at) FROM competitors), '') || '|' ||
           COALESCE((SELECT MAX(updated_at) FROM markers), '') || '|' ||
           (SELECT COUNT(*) FROM markers WHERE merged_into IS NOT NULL) AS v
  `).get()
  return r?.v || ''
}

/** 可见域 id 列表 → 稳定的缓存 key 片段（排序去重，避免顺序不同导致缓存不命中） */
export function scopeKeyOf(ids) {
  return Array.from(new Set(ids.map(Number).filter(Boolean))).sort((a, b) => a - b).join('.')
}

/** 计算商圈内竞品数量（bbox SQL 预筛替代全表拉取 + 60s 缓存） */
export function countCompetitorsInDistrict(geometry, ids, compBrands = null) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const bbox = geometryBBox(geometry)
  const db = getDb()
  const ver = storeDataVersion(db)
  const cacheKey = 'comp|' + scopeKeyOf(ids) + '|' + scopeCacheKey(compBrands) + '|' + ver + '|' + (bbox ? bbox.join(',') : 'all')
  const cached = districtCountCache.get(cacheKey)
  if (cached !== undefined) return cached

  const ph = ids.map(() => '?').join(',')
  // v1.13.344：品牌过滤拼在 user_id IN 之后；未配置 brandSql='' ⇒ SQL 与老口径逐字节一致
  const { sql: brandSql, params: brandParams } = competitorWhere(compBrands)
  const rows = bbox
    ? db.prepare(`SELECT longitude, latitude FROM competitors WHERE user_id IN (${ph})${brandSql} AND (status IS NULL OR status NOT IN ('店铺已关','尚未营业')) AND longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ?`).all(...ids, ...brandParams, bbox[0], bbox[2], bbox[1], bbox[3])
    : db.prepare(`SELECT longitude, latitude FROM competitors WHERE user_id IN (${ph})${brandSql} AND (status IS NULL OR status NOT IN ('店铺已关','尚未营业'))`).all(...ids, ...brandParams)
  let count = 0
  for (const c of rows) {
    if (c.longitude && c.latitude && pointInFeature([c.longitude, c.latitude], geometry)) {
      count++
    }
  }
  districtCountCache.set(cacheKey, count)
  return count
}

/** 计算商圈内「我可见的门店」数量（自家门店相互蚕食：竞争宽松度计分时权重 ×2） */
export function countMyStoresInDistrict(geometry, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const bbox = geometryBBox(geometry)
  const db = getDb()
  const ver = storeDataVersion(db)
  const cacheKey = 'store|' + scopeKeyOf(ids) + '|' + ver + '|' + (bbox ? bbox.join(',') : 'all')
  const cached = districtCountCache.get(cacheKey)
  if (cached !== undefined) return cached

  const ph = ids.map(() => '?').join(',')
  // v1.13.283：排除已合并的重复门店行 —— 否则去重后竞争分不会变（"我的门店数"仍按重复行计）
  const rows = bbox
    ? db.prepare(`SELECT longitude, latitude FROM markers WHERE user_id IN (${ph}) AND merged_into IS NULL AND longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ?`).all(...ids, bbox[0], bbox[2], bbox[1], bbox[3])
    : db.prepare(`SELECT longitude, latitude FROM markers WHERE user_id IN (${ph}) AND merged_into IS NULL`).all(...ids)
  let count = 0
  for (const s of rows) {
    if (s.longitude && s.latitude && pointInFeature([s.longitude, s.latitude], geometry)) {
      count++
    }
  }
  districtCountCache.set(cacheKey, count)
  return count
}

/**
 * 计算「点位 + 半径」圆内的竞品数量（v1.13.421）
 *
 * ── 为什么要这个函数 ──────────────────────────────────────────────────────
 *   立项报告原来只有「商圈内竞品」（商圈面口径）。但报告的人口是**点位半径圆**口径，
 *   读者看到「3km 内到访 21,500 人次」下面紧跟一个「商圈内竞品 0 家」，会以为
 *   0 家是 3km 内的结论 —— 两个口径混排。业主 2026-11-26 定：改成「半径 X 内竞品」。
 *
 * ── 与 countCompetitorsInDistrict 的关系 ─────────────────────────────────
 *   同一个 WHERE（可见域 + 品牌收窄 + 排除已关/未营业），只把「是否落在面内」
 *   换成「球面距离 ≤ 半径」。⛔ 品牌收窄与可见域**必须**走同一个 competitorWhere /
 *   scopeKeyOf：两处口径漂移就会出现「商圈评分说 5 家、报告说 3 家」。
 *   ⚠️ 缓存与 districtCountCache 共用（同一个 60s TTL）；key 里必须带
 *   用户集合 + 品牌集合 + 数据版本 + 坐标 + 半径 —— 少一个就会被别人/别处的结果污染。
 *
 * ⚠️ 传空数组（判无权）时必须返回 0，⛔ 绝不退化成「不过滤」（与同文件其它计数一致）。
 * ⚠️ 距离用 Haversine 精算：bbox 只是 ±r 的粗筛，直接用 bbox 会把角落上的店算进来
 *   （r=3km 时对角误差约 40%）。
 *
 * @param {number} centerLng 圆心经度
 * @param {number} centerLat 圆心纬度
 * @param {number} radiusM   半径（米），≤0 或非法 ⇒ 0
 * @param {number[]} ids     可见域账号 id（readableUserIds 的结果）
 * @param {string[]|null} compBrands 竞品品牌集合；null/undefined ＝ 全量口径
 * @returns {number}
 */
export function countCompetitorsInCircle(centerLng, centerLat, radiusM, ids, compBrands = null) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const lng = Number(centerLng)
  const lat = Number(centerLat)
  const r = Number(radiusM)
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !(r > 0)) return 0
  if (lng === 0 && lat === 0) return 0      // (0,0) 是"没填坐标"，不是几内亚湾

  const db = getDb()
  const ver = storeDataVersion(db)
  const cacheKey = 'cir|' + scopeKeyOf(ids) + '|' + scopeCacheKey(compBrands) + '|' + ver +
    '|' + lng.toFixed(5) + ',' + lat.toFixed(5) + '|' + Math.round(r)
  const cached = districtCountCache.get(cacheKey)
  if (cached !== undefined) return cached

  // bbox 粗筛：纬度 1° ≈ 111320m；经度随 cos(lat) 收缩（夹 0.2 防止高纬除爆）
  const dLat = r / 111320
  const dLng = r / (111320 * Math.max(0.2, Math.abs(Math.cos((lat * Math.PI) / 180))))
  const ph = ids.map(() => '?').join(',')
  const { sql: brandSql, params: brandParams } = competitorWhere(compBrands)
  const rows = db.prepare(
    `SELECT longitude, latitude FROM competitors
      WHERE user_id IN (${ph})${brandSql}
        AND (status IS NULL OR status NOT IN ('店铺已关','尚未营业'))
        AND longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ?`
  ).all(...ids, ...brandParams, lng - dLng, lng + dLng, lat - dLat, lat + dLat)

  let count = 0
  for (const c of rows) {
    if (c.longitude && c.latitude && circleDistM(lat, lng, c.latitude, c.longitude) <= r) count++
  }
  districtCountCache.set(cacheKey, count)
  return count
}

/**
 * 两点球面距离（米）。只在本文件的圆内计数里用。
 * ⚠️ 不要和 siteScore / site-select 里的**平面近似**（111320 + cos）互换 ——
 *   那两处是「10m 容差够用」的场景，这里是「用户能拿尺子量的半径」，用精算。
 */
function circleDistM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
