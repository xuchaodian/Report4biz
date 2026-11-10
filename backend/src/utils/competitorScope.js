/**
 * 自有品牌 → 竞品品牌集合：**唯一读口径**（v1.13.344）
 *
 * 背景：markers.brand 是自有品牌，competitors.brand 是竞品品牌，两个语义。
 *   账号下有多个自有品牌时（生产实测滨寿司 + 食其家），竞品却按 user_id 单池取数，
 *   A 的竞品与 B 的竞品被相加 ⇒ 商圈竞争分 / 体检信号灯 / AI 周边一起偏红。
 *
 * 铁律：
 *   · ⛔ 派生/解析算法只允许一份实现 —— 所有竞品读路径都必须走 competitorWhere()，
 *     不许各处手写 `AND brand IN (...)`（与 storeMergeReadPaths 同一治理思路）。
 *   · 未配置 / 品牌不属于该账号 ⇒ 返回 null ⇒ competitorWhere 出空 SQL ⇒ 老行为逐字节不变。
 *   · 已配置但集合为空 ⇒ 出 `AND 1 = 0` ⇒ 真 0 家，判「未评」，⛔ 绝不退化成绿灯。
 *   · 缓存 key 必须含 scopeCacheKey()，否则 A 会命中 B 的计数（277 缓存 bug 的同构）。
 *   · 可见域 readableUserIds() 由调用方负责，本模块不碰 user_id 放大。
 */
import { normalizeBrand } from './storeDedup.js'

export function normalizeMyBrand(v) {
  return String(v ?? '').trim()
}

/** 缓存 key 片段：null=未配置(全量) / []=显式空集 / 数组=已配置 */
export function scopeCacheKey(compBrands) {
  if (!Array.isArray(compBrands)) return 'all'
  if (compBrands.length === 0) return 'none'
  return 'b:' + Array.from(new Set(compBrands.map(normalizeBrand))).sort().join('.')
}

/**
 * 生成竞品品牌过滤 SQL 片段。
 * @param {null|string[]} compBrands resolveCompBrands() 的结果
 * @param {string} alias 表别名（不带点），用于 JOIN 场景
 * @returns {{sql: string, params: string[]}} sql 以 ' AND ' 开头，可直接拼在 WHERE 条件之后
 */
export function competitorWhere(compBrands, alias = '') {
  if (!Array.isArray(compBrands)) return { sql: '', params: [] }
  const col = alias ? `${alias}.brand` : 'brand'
  const keys = Array.from(new Set(compBrands.map(normalizeBrand).filter(Boolean)))
  if (keys.length === 0) return { sql: ' AND 1 = 0', params: [] }
  return {
    sql: ` AND UPPER(TRIM(COALESCE(${col},''))) IN (${keys.map(() => '?').join(',')})`,
    params: keys
  }
}

/**
 * 解析本次请求生效的竞品品牌集合。
 * @returns {null|string[]} null = 未配置（退回全量）；数组 = 已配置（可为空数组）
 */
export function resolveCompBrands(db, userId, myBrand) {
  const brand = normalizeMyBrand(myBrand)
  if (!brand) return null
  // 品牌必须真的属于该账号，避免前端乱传落到「显式空集」
  const owns = db.prepare(
    `SELECT 1 FROM markers WHERE user_id = ? AND UPPER(TRIM(COALESCE(brand,''))) = ? AND merged_into IS NULL LIMIT 1`
  ).get(userId, normalizeBrand(brand))
  if (!owns) return null
  const scoped = db.prepare(
    `SELECT 1 FROM brand_competitor_scope WHERE user_id = ? AND my_brand = ?`
  ).get(userId, brand)
  if (!scoped) return null
  const rows = db.prepare(
    `SELECT competitor_brand FROM brand_competitor_map WHERE user_id = ? AND my_brand = ? ORDER BY competitor_brand`
  ).all(userId, brand)
  return rows.map(r => String(r.competitor_brand || '')).filter(Boolean)
}

/** 供前端配置页与列表展示的全貌（不参与 SQL） */
export function brandScopeMeta(db, userId, compBrands) {
  const myBrands = db.prepare(
    `SELECT DISTINCT brand FROM markers WHERE user_id = ? AND merged_into IS NULL AND brand IS NOT NULL AND brand != '' ORDER BY brand`
  ).all(userId).map(r => String(r.brand))
  const competitorBrands = db.prepare(
    `SELECT DISTINCT brand FROM competitors WHERE user_id = ? AND brand IS NOT NULL AND brand != '' ORDER BY brand`
  ).all(userId).map(r => String(r.brand))
  const scopeRows = db.prepare(
    `SELECT my_brand FROM brand_competitor_scope WHERE user_id = ?`
  ).all(userId).map(r => String(r.my_brand))
  const mapRows = db.prepare(
    `SELECT my_brand, competitor_brand FROM brand_competitor_map WHERE user_id = ? ORDER BY my_brand, competitor_brand`
  ).all(userId)
  const scopes = {}
  for (const r of mapRows) {
    const k = String(r.my_brand)
    if (!scopes[k]) scopes[k] = []
    scopes[k].push(String(r.competitor_brand || ''))
  }
  for (const b of scopeRows) if (!scopes[b]) scopes[b] = []
  return {
    myBrands,
    competitorBrands,
    scopes,
    brandScope: {
      configured: Array.isArray(compBrands),
      brands: Array.isArray(compBrands) ? compBrands : null,
      key: scopeCacheKey(compBrands)
    }
  }
}


/**
 * 字面量版：给「参数顺序已被多处复用」的老 SQL 用（dashboard 12 处 .all(userId, isAdmin)）。
 * 内部仍走 competitorWhere 同一份归一逻辑，品牌名由本函数转义，⛔ 不许业务里另写一份 IN。
 */
export function competitorWhereLiteral(compBrands, alias = '') {
  const w = competitorWhere(compBrands, alias)
  if (!w.sql) return ''
  if (w.params.length === 0) return ' AND 1 = 0'
  const col = alias ? `${alias}.brand` : 'brand'
  const lits = w.params.map(v => "'" + String(v).replace(/'/g, "''") + "'").join(',')
  return ` AND UPPER(TRIM(COALESCE(${col},''))) IN (${lits})`
}
