/**
 * v1.13.345：自有品牌 → 竞品品牌集合 的**前端唯一口径**
 *
 * 背景：344 之后，`brandScopeMap`（{自有品牌: [竞品品牌...]}）由 GET /api/competitors
 *   的 brandScope.scopes 下发。多个页面都要用「这个自有品牌该算哪些竞品」，若各写一份
 *   归一化/集合判断，必然漂移（DataView 曾自带一份 norm 副本）。
 *
 * 三条语义（与后端 utils/competitorScope.js 严格对齐）：
 *   · 未配置（scopes 里没有该品牌）      ⇒ null  ⇒ **全量**（老行为）
 *   · 已配置且集合非空                    ⇒ string[] ⇒ 只算这些竞品品牌
 *   · 已配置但一个都没选                  ⇒ []    ⇒ **真 0 家**（⛔ 不得当成全量）
 *
 * 🔴 归一必须与后端 normalizeBrand 一致：压缩内部空白 + 去首尾 + 大写。
 * 🔴 映射的 key 是配置时写入的原始 my_brand，大小写/空格可能与门店 brand 不同，
 *    因此查 key 要按归一值匹配，⛔ 不能直接 hasOwnProperty(store.brand)。
 */

/** 品牌归一化：与后端 utils/storeDedup.js::normalizeBrand 同一规则 */
export function normBrand(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
}

/**
 * 取某自有品牌配置的竞品品牌集合。
 * @returns {string[]|null} null＝未配置（全量）；[]＝明确空集（0 家）
 */
export function scopeBrandsFor(scopeMap, myBrand) {
  const map = scopeMap || {}
  const key = normBrand(myBrand)
  if (!key) return null
  const hit = Object.keys(map).find((k) => normBrand(k) === key)
  if (hit === undefined) return null
  const arr = map[hit]
  if (!Array.isArray(arr)) return []
  return arr.map((x) => String(x ?? '').trim()).filter(Boolean)
}

/** 该竞品品牌是否属于某自有品牌的集合；未配置 ⇒ 一律 true（全量） */
export function brandAllowed(scopeMap, myBrand, compBrand) {
  const allowed = scopeBrandsFor(scopeMap, myBrand)
  if (allowed === null) return true
  const k = normBrand(compBrand)
  return allowed.some((b) => normBrand(b) === k)
}

/**
 * 竞品点位按归一品牌分组，供「按店分池」时避免逐点重算归一值。
 * @param {Array<{brand?:string}>} points
 * @returns {Map<string, Array>} normBrand → points[]
 */
export function groupByBrand(points) {
  const m = new Map()
  for (const p of points || []) {
    const k = normBrand(p && p.brand)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(p)
  }
  return m
}

/**
 * 取某自有品牌可见的竞品点位。
 * @returns {Array|null} null＝未配置（调用方应继续用全量数组，避免无谓复制）
 */
export function compPointsForBrand(grouped, scopeMap, myBrand) {
  const allowed = scopeBrandsFor(scopeMap, myBrand)
  if (allowed === null) return null
  const out = []
  for (const b of allowed) {
    const arr = grouped.get(normBrand(b))
    if (arr && arr.length) out.push(...arr)
  }
  return out
}
