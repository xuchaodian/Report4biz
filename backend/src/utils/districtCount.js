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
export function countCompetitorsInDistrict(geometry, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const bbox = geometryBBox(geometry)
  const db = getDb()
  const ver = storeDataVersion(db)
  const cacheKey = 'comp|' + scopeKeyOf(ids) + '|' + ver + '|' + (bbox ? bbox.join(',') : 'all')
  const cached = districtCountCache.get(cacheKey)
  if (cached !== undefined) return cached

  const ph = ids.map(() => '?').join(',')
  const rows = bbox
    ? db.prepare(`SELECT longitude, latitude FROM competitors WHERE user_id IN (${ph}) AND (status IS NULL OR status NOT IN ('店铺已关','尚未营业')) AND longitude BETWEEN ? AND ? AND latitude BETWEEN ? AND ?`).all(...ids, bbox[0], bbox[2], bbox[1], bbox[3])
    : db.prepare(`SELECT longitude, latitude FROM competitors WHERE user_id IN (${ph}) AND (status IS NULL OR status NOT IN ('店铺已关','尚未营业'))`).all(...ids)
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
