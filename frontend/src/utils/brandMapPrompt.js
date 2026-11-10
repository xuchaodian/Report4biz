/**
 * v1.13.348：竞品导入后「该不该提示去配置品牌竞品映射」的**唯一判据**
 *
 * 为什么需要提示：
 *   344 起，自有品牌 → 竞品品牌集合是「按品牌分池」统计的。但**未配置映射的品牌会退回全量**，
 *   于是「我的门店」有 2 个以上品牌时（生产实测：滨寿司 + 食其家），A 的竞品与 B 的竞品会被
 *   加在一起 ⇒ 商圈竞争分、体检信号灯、AI 周边一起偏红。用户导入完竞品门店，正是他刚把
 *   「新品牌竞品」灌进来的时刻，也是他最可能在此时配置映射的时刻 —— 过了这个点就忘了。
 *
 * 判据三条（少一条都是噪音）：
 *   1. 自有品牌 **≥2 个** —— 单品牌不存在「多品牌竞品混算」，⛔ 不打扰
 *   2. 存在**未配置**映射的品牌 —— 全都配过了就是纯噪音，⛔ 不打扰
 *   3. 配置接口读失败时调用方直接跳过（⛔ 不能因为拉不到元数据就弹空对话框）
 *
 * 🔴 「已配置」= scopes 里存在该品牌的 key，**包括配成空数组**（明确「该品牌无竞品」）。
 *    所以判断必须看 key 在不在，⛔ 不能用「值非空」当已配置。
 * 🔴 品牌归一必须与后端 normalizeBrand 一致（压缩空白 + 去首尾 + 大写），
 *    映射 key 是配置时写入的原值，大小写常与 markers.brand 不同。
 */
import { normBrand } from './brandScope.js'

/**
 * @param {object} p
 * @param {string[]} p.myBrands          我的门店全部自有品牌（后端 brandScopeMeta.myBrands）
 * @param {object} p.scopes              已配置映射 { 自有品牌: [竞品品牌...] }
 * @param {string} [p.justImportedBrand] 本次刚导入竞品的自有品牌（期次上传时用户已选）
 * @returns {{prompt:boolean, missing:string[], preferred:string, justImportedMissing:boolean,
 *            total:number, reason:string}}
 */
export function decideBrandMapPrompt({ myBrands, scopes, justImportedBrand } = {}) {
  const brands = Array.from(
    new Set((myBrands || []).map(b => String(b ?? '').trim()).filter(Boolean))
  )

  if (brands.length < 2) {
    return { prompt: false, missing: [], preferred: '', justImportedMissing: false, total: brands.length, reason: 'single-brand' }
  }

  const map = scopes || {}
  const configured = new Set(Object.keys(map).map(k => normBrand(k)))
  const missing = brands.filter(b => !configured.has(normBrand(b)))

  if (missing.length === 0) {
    return { prompt: false, missing: [], preferred: '', justImportedMissing: false, total: brands.length, reason: 'all-configured' }
  }

  const imported = normBrand(justImportedBrand)
  const hit = imported ? missing.find(b => normBrand(b) === imported) : null

  return {
    prompt: true,
    missing,
    preferred: hit || missing[0],
    justImportedMissing: !!hit,
    total: brands.length,
    reason: 'missing-scope'
  }
}

/**
 * 弹窗文案。与判据分离，便于单测钉文案（⛔ 不许出现「预计/预估」这类词，
 * 这里给的是机制说明，不是业绩承诺）。
 */
export function buildBrandMapPromptText(d) {
  const list = (d.missing || []).join('、')
  const head = d.justImportedMissing
    ? `本次导入的自有品牌「${d.preferred}」还没有配置竞品映射。`
    : `你的账号下有 ${d.total} 个自有品牌，其中「${list}」还没有配置竞品映射。`
  return head +
    '未配置时该品牌会按账号下全部竞品统计，多个品牌的竞品会混在一起，' +
    '竞争分与门店信号的判定容易偏红。现在去设置吗？'
}
