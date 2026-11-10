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
 *
 * ── v1.13.351：集团映射「读时继承」 ──────────────────────────────────────────
 *   问题：集团配好映射、把竞品门店同步给子公司后，子公司读到的仍是「未配置」⇒ 全量
 *     （映射表主键是 (user_id, my_brand)，配置不在同步对象里，见 syncCore.SYNC_KINDS）。
 *     4 家 zensho 子公司都是双品牌 ⇒ 滨寿司与食其家的竞品被混在一个池里算竞争分。
 *   做法：**不复制任何行**。子公司自己没配该品牌时，回退读总部账号（organizations.
 *     owner_user_id）的映射，`source='group'` 并在 meta 里回带集团名供 UI 标注。
 *   为什么读时继承而不是同步时复制（与 brandLogo.js 同一论证）：
 *     ① 集团改一次映射，子公司下次刷新即生效 —— 复制模型会冻结在复制那一刻；
 *     ② 复制会让「子公司退出集团 / 集团解散」后配置赖在成员表里清不干净；
 *     ③ 集团解散/成员被移出 ⇒ 继承立即消失，⛔ 不需要任何清理任务。
 *   三态仍然成立，且**自有显式配置永远压过继承**：
 *     · 自己有 scope 行（哪怕 map 为空 ⇒ 显式「该品牌无竞品」）⇒ 用自己的，⛔ 不被集团冲掉；
 *     · 自己没有 + 集团有 ⇒ 用集团的（source='group'）；
 *     · 两边都没有 ⇒ null ⇒ 全量（老行为，逐字节不变）。
 *   ⚠️ 「品牌必须属于该账号」这一道 owns 判定对继承**同样生效**：子公司门店里没有
 *     这个自有品牌时，即便集团配了也不继承（否则会拿一个不存在的品牌去过滤竞品）。
 *
 * ── v1.13.352：把「全量」从兜底变成**显式第四态** ────────────────────────────
 *   遗留问题：351 之后仍有一条隐形通道 —— 前端「分析品牌」下拉留空 ⇒ 不传 myBrand
 *     ⇒ resolveBrandScope 返回 none ⇒ 全量。于是「没配置」和「我要全量」在库内外
 *     长得一模一样：349 硬阻断只能把两者一起拦，或者一起放过。
 *   做法：
 *     ① 库里加 `brand_competitor_scope.mode`（'map' | 'all'）。mode='all' ⇒ 该自有
 *        品牌**显式不筛选** ⇒ compBrands=null，source='all'，349 视为「已配置」；
 *     ② 请求侧认哨兵 `myBrand='__all__'`（前端「全部品牌（不筛选）」选项）⇒
 *        同样得 compBrands=null 但 source='all'，**不再借「没传参」表达全量**；
 *     ③ `brandScopeMeta` 的 ownScopes / scopes 允许值为 **null** 表示显式全量，
 *        与「key 不存在＝未配置」严格区分（前端 scopeBrandsFor 对 null 返回 null）。
 *   ⚠️ 三态判据在 SQL 层一个字都没变：null ⇒ 不拼 WHERE ⇒ 全量；[] ⇒ `AND 1 = 0`。
 *      「显式全量」只是让「为什么是全量」变得可读、可审计。
 */
import { normalizeBrand } from './storeDedup.js'
import { memberOrgOf } from './groupScope.js'

/**
 * 「全部品牌、不按映射筛选」的请求哨兵。
 * 🔴 用全下划线包裹的保留字：真实品牌名不会长这样（_ 在品牌名里极少见且不会全为 _），
 *    且与 `__all__` 比较用的是**完全相等**，不做归一化，避免误伤「ALL」这类真品牌。
 */
export const MY_BRAND_ALL = '__all__'

export function normalizeMyBrand(v) {
  return String(v ?? '').trim()
}

/** 请求的 myBrand 是否为「显式全量」哨兵 */
export function isAllBrandsToken(v) {
  return String(v ?? '').trim() === MY_BRAND_ALL
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

/** 该账号是否「门店里真有这个自有品牌」（继承与自有共用的第一道闸门） */
function ownsMyBrand(db, userId, brand) {
  return !!db.prepare(
    `SELECT 1 FROM markers WHERE user_id = ? AND UPPER(TRIM(COALESCE(brand,''))) = ? AND merged_into IS NULL LIMIT 1`
  ).get(userId, normalizeBrand(brand))
}

/**
 * 读某账号对某自有品牌的显式配置。
 * @returns {null|{mode:'map'|'all', brands:string[]}}
 *   null = 该账号**没有**这个品牌的 scope 行（≠ 全量，也 ≠ 空集）
 *   mode='all' ⇒ 用户主动选了「不筛选」，brands 恒为空数组（明细行已被清掉）
 */
function readBrandMap(db, userId, brand) {
  const scoped = db.prepare(
    `SELECT mode FROM brand_competitor_scope WHERE user_id = ? AND my_brand = ?`
  ).get(userId, brand)
  if (!scoped) return null
  const mode = String(scoped.mode || 'map') === 'all' ? 'all' : 'map'
  if (mode === 'all') return { mode, brands: [] }
  const rows = db.prepare(
    `SELECT competitor_brand FROM brand_competitor_map WHERE user_id = ? AND my_brand = ? ORDER BY competitor_brand`
  ).all(userId, brand)
  return { mode, brands: rows.map(r => String(r.competitor_brand || '')).filter(Boolean) }
}

/**
 * 🔴 解析「本次请求生效」的竞品品牌集合 —— **带来源**的完整版（v1.13.351 / 352）。
 *
 * 调用方要区分「这次是全量、还是按映射收窄」时用它；只关心 SQL 片段的用
 * resolveCompBrands()（签名与语义一字未改，内部就是调本函数取 compBrands）。
 *
 * @returns {{compBrands:null|string[], source:'self'|'group'|'all'|'none',
 *            explicitAll:boolean, mode:'map'|'all',
 *            inheritedFrom:number|null, inheritedFromName:string|null}}
 *   source='none'  ⇒ compBrands=null ⇒ 全量，但**是「还没配」的全量**（349 要拦）
 *   source='all'   ⇒ compBrands=null ⇒ 全量，且是**用户显式选的**（349 放过）
 *     · 请求侧：myBrand=MY_BRAND_ALL 哨兵；或库里该品牌 mode='all'
 *   source='self'  ⇒ 本账号自己配的（含显式空集 []）
 *   source='group' ⇒ 继承总部账号的配置（零复制，集团改则立即生效）；
 *                    总部该品牌 mode='all' 时 compBrands=null 且 explicitAll=true
 *   ⚠️ explicitAll 与 source 是**两个维度**：前者说「这个口径是不是不筛选」，
 *      后者说「这个口径是怎么来的」。只有 source='all' 才等于「用户主动全量」。
 */
export function resolveBrandScope(db, userId, myBrand) {
  const none = {
    compBrands: null, source: 'none', explicitAll: false, mode: 'map',
    inheritedFrom: null, inheritedFromName: null
  }
  const raw = normalizeMyBrand(myBrand)
  if (!raw) return none

  // ① 请求哨兵：显式「全部品牌、不按映射筛选」。
  //    🔴 必须在 ownsMyBrand 之前判 —— 哨兵不是真实品牌，过不了「门店里有」这道闸门。
  if (isAllBrandsToken(raw)) {
    return { ...none, source: 'all', explicitAll: true, mode: 'all' }
  }

  const brand = raw
  // 品牌必须真的属于该账号，避免前端乱传落到「显式空集」
  if (!ownsMyBrand(db, userId, brand)) return none

  // ② 自有优先：自己配过就用自己的，⛔ 集团再怎么配也不覆盖（显式空集同样算「配过」）
  const own = readBrandMap(db, userId, brand)
  if (own) {
    if (own.mode === 'all') {
      return { ...none, source: 'all', explicitAll: true, mode: 'all' }
    }
    return { ...none, compBrands: own.brands, source: 'self', mode: 'map' }
  }

  // ③ 读时继承：只对「成员账号 + 未解散集团 + 总部确实配过」生效
  const g = memberOrgOf(db, userId)
  if (!g) return none
  const inherited = readBrandMap(db, g.ownerUserId, brand)
  if (!inherited) return none
  const base = {
    inheritedFrom: g.ownerUserId,
    inheritedFromName: g.orgName || g.ownerName || null
  }
  if (inherited.mode === 'all') {
    return { ...none, ...base, source: 'group', explicitAll: true, mode: 'all' }
  }
  return { ...none, ...base, compBrands: inherited.brands, source: 'group', mode: 'map' }
}

/**
 * 解析本次请求生效的竞品品牌集合（向后兼容的窄接口）。
 * @returns {null|string[]} null = 未配置（退回全量）；数组 = 已配置（可为空数组）
 */
export function resolveCompBrands(db, userId, myBrand) {
  return resolveBrandScope(db, userId, myBrand).compBrands
}

/**
 * 读某账号的**全部**显式配置：{ 自有品牌: [竞品品牌...] | null }。
 *   · 键存在 + 数组（可为 []）⇒ 已配置，按映射筛选（[] = 明确「没有竞品」）
 *   · 键存在 + **null**          ⇒ v1.13.352 显式全量（mode='all'）
 *   · 键不存在                    ⇒ 未配置
 */
function readAllScopes(db, userId) {
  const scopeRows = db.prepare(
    `SELECT my_brand, mode FROM brand_competitor_scope WHERE user_id = ?`
  ).all(userId)
  const mapRows = db.prepare(
    `SELECT my_brand, competitor_brand FROM brand_competitor_map WHERE user_id = ? ORDER BY my_brand, competitor_brand`
  ).all(userId)
  const out = {}
  for (const r of mapRows) {
    const k = String(r.my_brand)
    if (!out[k]) out[k] = []
    out[k].push(String(r.competitor_brand || ''))
  }
  for (const r of scopeRows) {
    const b = String(r.my_brand)
    // 🔴 mode='all' 必须**覆盖**掉先前的明细（PUT 已清过明细，这里再兜一次，
    //    防止历史脏数据让「显式全量」被读成「有 3 个竞品」）。
    if (String(r.mode || 'map') === 'all') out[b] = null
    else if (!out[b]) out[b] = []
  }
  return out
}

/**
 * 合并「继承 + 自有」，自有优先。
 * 🔴 必须按**归一值**去重，不能只比字面 key：自己配「滨寿司」、集团配「 滨寿司 」时
 *   两个 key 会同时留下，而前端 scopeBrandsFor 用 `Object.keys().find(归一匹配)` 取第一个命中的
 *   ⇒ 会读到集团那份，自有优先当场失效。
 */
function mergeScopes(inheritedScopes, ownScopes) {
  const out = { ...inheritedScopes }
  for (const [k, v] of Object.entries(ownScopes)) {
    const nk = normalizeBrand(k)
    for (const ik of Object.keys(out)) {
      if (normalizeBrand(ik) === nk) delete out[ik]
    }
    out[k] = v
  }
  return out
}

/**
 * 供前端配置页与列表展示的全貌（不参与 SQL）
 *
 * ⚠️ `scopes` 是**生效口径**（自有优先 + 集团继承补齐），不是「本账号显式配置」。
 *   这样 GET /api/competitors 下发的 brandScope.scopes 在 MapView / DataView /
 *   商圈洞察 / 竞争雷达等所有读点上都自动带上继承，⛔ 不必逐页去合并（逐页改必漏一个）。
 *   要区分「这条是谁配的」看 ownScopes / inheritedScopes / brandScope.source。
 *
 * @param {object} db
 * @param {number} userId
 * @param {null|string[]} compBrands resolveBrandScope().compBrands
 * @param {{source?:string, inheritedFrom?:number|null, inheritedFromName?:string|null}} [extra]
 *   ⚠️ 想区分「这份口径是自己配的还是继承的」，调用方**必须**把 resolveBrandScope() 的结果整体
 *      传进来；不传时只能按 compBrands 是否数组兜底标成 self/none（列表页不关心来源，够用）。
 */
export function brandScopeMeta(db, userId, compBrands, extra = {}) {
  const myBrands = db.prepare(
    `SELECT DISTINCT brand FROM markers WHERE user_id = ? AND merged_into IS NULL AND brand IS NOT NULL AND brand != '' ORDER BY brand`
  ).all(userId).map(r => String(r.brand))
  const competitorBrands = db.prepare(
    `SELECT DISTINCT brand FROM competitors WHERE user_id = ? AND brand IS NOT NULL AND brand != '' ORDER BY brand`
  ).all(userId).map(r => String(r.brand))

  const ownScopes = readAllScopes(db, userId)

  // 集团侧可继承的映射：限「自己门店里真有这个品牌」的，⛔ 不要把无关品牌塞给前端。
  // 🔴 刻意**不排除**自有已配的品牌：前端要靠它回答「删掉我这条配置会不会回落到集团口径」
  //    （配置弹窗按钮文案与提示据此切换）。自有优先由下面的 mergeScopes 保证。
  const g = memberOrgOf(db, userId)
  const inheritedScopes = {}
  if (g) {
    const ownerScopes = readAllScopes(db, g.ownerUserId)
    const myKeys = new Set(myBrands.map(normalizeBrand))
    for (const [k, v] of Object.entries(ownerScopes)) {
      if (!myKeys.has(normalizeBrand(k))) continue
      inheritedScopes[k] = v
    }
  }

  const source = extra.source || (Array.isArray(compBrands) ? 'self' : 'none')
  return {
    myBrands,
    competitorBrands,
    scopes: mergeScopes(inheritedScopes, ownScopes),   // 生效口径（自有优先，缺的由集团补）
    ownScopes,                                          // 本账号显式配置（值为 null ⇒ 显式全量）
    inheritedScopes,                                    // 集团侧的配置（限本账号门店里有的品牌）
    inherit: {
      available: !!g,
      orgName: g?.orgName || null,
      ownerUserId: g?.ownerUserId || null,
      ownerName: g?.ownerName || null
    },
    // v1.13.352：把「为什么是全量」讲清楚，前端据此决定要不要提示/拦人
    fullScope: {
      // true ⇒ 本次是全量口径；false ⇒ 按映射筛选（含显式空集，那种是 0 家）
      active: !Array.isArray(compBrands),
      // true ⇒ 用户明确选了「不筛选」（库 mode='all' 或哨兵），349 视为已配置
      explicit: !!extra.explicitAll,
      // true ⇒ 该账号一个自有品牌都没有（没同步「我的门店」或门店没填品牌）
      //   ⇒ 竞品无法按品牌分池，竞争分/信号灯/AI 周边都会按全量算
      noMyBrands: myBrands.length === 0
    },
    brandScope: {
      configured: Array.isArray(compBrands) || !!extra.explicitAll,
      brands: Array.isArray(compBrands) ? compBrands : null,
      key: scopeCacheKey(compBrands),
      source,
      explicitAll: !!extra.explicitAll,
      mode: extra.mode || (Array.isArray(compBrands) ? 'map' : (extra.explicitAll ? 'all' : 'map')),
      inheritedFrom: extra.inheritedFrom ?? null,
      inheritedFromName: extra.inheritedFromName ?? null
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
