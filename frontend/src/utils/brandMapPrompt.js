/**
 * 自有品牌 → 竞品品牌映射：**强制补齐**的判定与草稿（v1.13.349，取代 348 的可跳过提示）
 *
 * 背景：344 起「未配置＝按账号全量竞品」，但多品牌账号导入竞品后往往不配映射，
 *   于是 A 品牌的商圈把 B 品牌的竞品一起算进来 ⇒ 竞争分被压低、信号灯被别业态点亮。
 *   348 只是弹个「要不要去设置」的确认框，用户点「暂不设置」就过 ⇒ 口径静默放宽。
 *   349 改为硬阻断：未配完不让关窗，且每次进竞品页复查。
 *
 * 铁律：
 *   · 「已配置」判据＝scopes **或 inheritedScopes** 里存在该 key，⛔ 不是「值非空」。
 *     配成 [] 是「该品牌确实没有竞品」的明确表达（⇒ 0 家 ⇒ 判未评，绝不变绿灯）。
 *   · v1.13.351：**继承来的映射算已配置**。集团配好映射、把竞品门店同步给子公司后，
 *     子公司不该被再拦一次去重复劳动；否则 349 的硬阻断会变成「集团配一遍、每个子公司
 *     再各配一遍」的负担，而子公司配置页对集团口径本来就没有信息增量。
 *     ⚠️ 这是**双保险**：后端下发的 scopes 已是「生效口径（含继承）」，正常路径下
 *        不传 inheritedScopes 也不会误弹；单独传它，是为了防止将来有人把 scopes 改回
 *        「只看自有配置」时弹窗复活。
 *   · 未配置品牌由本模块唯一产出，组件只渲染，⛔ 不许在组件里另写一份判据。
 *   · 归一化只用 utils/brandScope.js::normBrand（与后端 storeDedup.js::normalizeBrand 同规则）。
 *   · 本模块只产出「要保存什么」，⛔ 不碰网络请求（便于纯函数测试）。
 */
import { normBrand } from './brandScope.js'

function normalizeMyBrands(myBrands) {
  const out = []
  const seen = new Set()
  for (const raw of myBrands || []) {
    const b = String(raw ?? '').trim()
    if (!b) continue
    const k = normBrand(b)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(b)
  }
  return out
}

/** { 品牌: [...] } → 归一 key 集合（判「有没有配过」只看 key 在不在） */
function keySetOf(map) {
  return new Set(Object.keys(map || {}).map(k => normBrand(k)))
}

/**
 * 是否需要强制补映射。
 * @param {object} p
 * @param {string[]} p.myBrands 「我的门店」里的自有品牌
 * @param {object} p.scopes 生效口径（后端下发的 scopes，通常已含继承）
 * @param {object} [p.inheritedScopes] 集团侧映射（仅用于「继承也算配置好」的双保险）
 * @returns {{required:boolean, missing:string[], inherited:string[], total:number,
 *            reason:'single-brand'|'all-configured'|'missing-scope'}}
 */
export function decideBrandMapPrompt({ myBrands, scopes, inheritedScopes } = {}) {
  const brands = normalizeMyBrands(myBrands)
  // 单品牌账号不存在「按品牌分池」的问题 ⇒ 不打扰
  if (brands.length < 2) {
    return { required: false, missing: [], inherited: [], total: brands.length, reason: 'single-brand' }
  }
  const ownKeys = keySetOf(scopes)
  const inheritKeys = keySetOf(inheritedScopes)
  const missing = brands.filter(b => !ownKeys.has(normBrand(b)) && !inheritKeys.has(normBrand(b)))
  // 当前**确实靠继承**生效的品牌（自有没配、集团有）—— 供 UI 标注「继承自集团」
  const inherited = brands.filter(b => !ownKeys.has(normBrand(b)) && inheritKeys.has(normBrand(b)))
  if (missing.length === 0) {
    return { required: false, missing: [], inherited, total: brands.length, reason: 'all-configured' }
  }
  return { required: true, missing, inherited, total: brands.length, reason: 'missing-scope' }
}

/**
 * 生成待补映射草稿（每个未配置自有品牌一行）。
 * ⚠️ justImportedBrand 是**竞品品牌**（competitors.brand，来自导入快照的品牌），
 *    不是自有品牌 ⇒ 只用来「预勾选」，⛔ 不要拿去和 myBrands 比（348 就是错在这里）。
 */
export function buildRequiredMapDraft({ myBrands, scopes, inheritedScopes, justImportedBrand } = {}) {
  const d = decideBrandMapPrompt({ myBrands, scopes, inheritedScopes })
  if (!d.required) return []
  const seed = String(justImportedBrand ?? '').trim()
  return d.missing.map(myBrand => ({
    myBrand,
    compBrands: seed ? [seed] : [],
    none: false,
    seeded: !!seed
  }))
}

/** 单行是否已有结论：勾了「暂无竞品」或 至少选了一个竞品品牌 */
export function isRowDecided(row) {
  if (!row) return false
  if (row.none === true) return true
  return Array.isArray(row.compBrands) && row.compBrands.length > 0
}

/** 汇总进度，complete 决定「全部保存」是否可点 */
export function summarizeDraft(rows) {
  const list = Array.isArray(rows) ? rows : []
  const decided = list.filter(isRowDecided).length
  return { total: list.length, decided, pending: list.length - decided, complete: list.length > 0 && decided === list.length }
}

/** 单行 → PUT /brand-competitor-map 的请求体（none ⇒ 显式空集） */
export function buildSavePayload(row) {
  const none = row?.none === true
  const compBrands = none
    ? []
    : Array.from(new Set((row?.compBrands || []).map(v => String(v ?? '').trim()).filter(Boolean)))
  return { myBrand: String(row?.myBrand ?? '').trim(), competitorBrands: compBrands }
}
