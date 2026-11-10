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
 *   · v1.13.352：已配置成 `null`（显式全量 / mode='all'）⇒ 同 null ⇒ 全量
 *
 * 🔴 归一必须与后端 normalizeBrand 一致：压缩内部空白 + 去首尾 + 大写。
 * 🔴 映射的 key 是配置时写入的原始 my_brand，大小写/空格可能与门店 brand 不同，
 *    因此查 key 要按归一值匹配，⛔ 不能直接 hasOwnProperty(store.brand)。
 */

/**
 * 「全部品牌、不按映射筛选」的请求哨兵 —— 与后端 competitorScope.MY_BRAND_ALL 同一字面量。
 * 🔴 必须完全相等比较：真实品牌不会长成 `__all__`，但别说成"大小写不敏感"。
 */
export const MY_BRAND_ALL = '__all__'

/** 某个「分析品牌」取值是否表示「不筛选 / 全部品牌」 */
export function isAllBrandsToken(v) {
  return String(v ?? '').trim() === MY_BRAND_ALL
}

/** 品牌归一化：与后端 utils/storeDedup.js::normalizeBrand 同一规则 */
export function normBrand(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
}

/**
 * 三态取值：从 { 品牌: 集合 } 里取某个品牌，**原样返回**，不做任何兜底。
 *
 * @returns {undefined|null|string[]}
 *   undefined ⇒ 映射里**没有**这个 key（未配置）
 *   null      ⇒ 有 key 但值是 null（v1.13.352 显式全量 / mode='all'）
 *   string[]  ⇒ 已配置的竞品品牌集合（可能是 [] ⇒ 明确「无竞品」）
 *
 * 🔴🔴 三个返回值必须严格区分，⛔ 一律用 `|| []` / `?? []` 兜底 ——
 *   把 null 变成 [] 就等于把「用户选了不筛选」说成「该品牌没有竞品」：
 *   界面上会显示「按本账号映射」（应为「该品牌已设为全量」），
 *   后端拿到 [] 更会算成 0 家竞品 ⇒ 判未评。v1.13.352 真机验证就是这么翻车的。
 * ⚠️ 与 scopeBrandsFor 的分工：那个是给「算点数」用的二态接口（不区分未配置与全量），
 *   这个三态接口是给「界面要说明当前是什么口径」用的。
 */
export function pickScope(map, myBrand) {
  const key = normBrand(myBrand)
  if (!key) return undefined
  const hit = Object.keys(map || {}).find((k) => normBrand(k) === key)
  return hit === undefined ? undefined : map[hit]
}

/**
 * 取某自有品牌配置的竞品品牌集合。
 * @returns {string[]|null} null＝未配置或显式全量（都走全量）；[]＝明确空集（0 家）
 */
export function scopeBrandsFor(scopeMap, myBrand) {
  const map = scopeMap || {}
  const key = normBrand(myBrand)
  if (!key) return null
  const hit = Object.keys(map).find((k) => normBrand(k) === key)
  if (hit === undefined) return null
  const arr = map[hit]
  // 🔴 v1.13.352：值为 null ＝用户显式选了「不筛选」⇒ 全量。
  //    ⛔ 不能落到下面的 `return []`（那会被当成「明确无竞品」⇒ 0 家 ⇒ 判未评）。
  if (arr === null) return null
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
