/**
 * 联通智慧足迹 1001（人口基础属性）统一解析。
 *
 * 权威依据：backend/src/utils/unicomSummaryCols.js —— 1001 的取值键 = 模板 field.toLowerCase()，
 * 即实际响应键为**小写**：p0_sum / male0_sum / age0_0006 / arpu0_50 / pall_sum …（模板 C 列是大写 P0_SUM）。
 *
 * 历史问题（批次 4C-D1 收敛）：各展示入口对 1001 的取值方式不一致——
 *   · 一部分用大小写不敏感正则 findField(/^P0_SUM\d*$/i)（健壮，但 4 处重复实现）
 *   · 一部分直接硬编码小写属性 data.p0_sum（若上游返回大写则整块为 0，静默失效）
 * 本模块统一按「大小写不敏感」取值，并集中年龄/话费分组定义，杜绝上述单侧假设。
 */

// 年龄段：到访(age0_)/居住(age1_)/工作(age2_) 三套共用同一 code
export const AGE_GROUPS = [
  ['0-6岁', '0006'], ['6-12岁', '0612'], ['12-15岁', '1215'], ['15-18岁', '1518'],
  ['19-24岁', '1924'], ['25-29岁', '2529'], ['30-34岁', '3034'], ['35-39岁', '3539'],
  ['40-44岁', '4044'], ['45-49岁', '4549'], ['50-54岁', '5054'], ['55-59岁', '5559'],
  ['60-64岁', '6064'], ['65-69岁', '6569'], ['70岁+', '70up']
]

// 月出账金额区间：到访(arpu0_)/居住(arpu1_)/工作(arpu2_) 三套共用同一 suffix
export const ARPU_GROUPS = [
  ['50元以下', '50'], ['50-100元', '100'], ['100-150元', '150'],
  ['150-200元', '200'], ['200-250元', '250'], ['250元以上', 'up']
]

// 1001 字典的「特征键」判定：用于区分「传入的是 1001 dict」还是「外层 apiResult」
const P0S_MARKER = /^(p0_sum|p1_sum|pall_sum|male0_sum|female0_sum|age0_|arpu0_)/i

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 剥掉 result_data 的外壳，拿到 apiResult 对象。
 * 兼容：JSON 字符串 / { apiResult: {...} } / 已剥离的 apiResult 裸对象。
 * @returns {object|null}
 */
export function unwrapApiResult(resultData) {
  let apiResult = resultData
  if (typeof apiResult === 'string') {
    try { apiResult = JSON.parse(apiResult) } catch (e) { return null }
  }
  if (apiResult && typeof apiResult === 'object' && apiResult.apiResult) {
    apiResult = apiResult.apiResult
  }
  return apiResult && typeof apiResult === 'object' ? apiResult : null
}

/**
 * 取出 1001 字典。兼容三种传入：
 *   1) result_data（字符串 / {apiResult} 壳 / apiResult 裸对象）→ 取其 ['1001']
 *   2) 直接的 1001 dict（含 p0_sum / P0_SUM / pall_sum 等特征键）
 * @returns {object|null}
 */
export function get1001Dict(resultData) {
  const apiResult = unwrapApiResult(resultData)
  if (!apiResult) return null
  const inner = apiResult['1001']
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner
  if (P0S_MARKER.test(Object.keys(apiResult).join('|'))) return apiResult
  return null
}

/**
 * 大小写不敏感取数值字段。
 * @param {object} dict - 1001 字典
 * @param {string|RegExp} name - 精确字段名（'P0_SUM'）或自定义正则
 * @param {number} fallback - 未命中时的返回值
 * @returns {number}
 */
export function pick1001(dict, name, fallback = 0) {
  if (!dict || typeof dict !== 'object') return fallback
  const re = name instanceof RegExp ? name : new RegExp(`^${escapeRe(name)}\\d*$`, 'i')
  for (const [k, v] of Object.entries(dict)) {
    if (typeof v === 'number' && re.test(k)) return v
  }
  return fallback
}

/**
 * 统一解析 1001 人口基础属性。
 * @param {string|object} resultData - result_data / apiResult / 1001 dict 皆可
 * @returns {null|{
 *   raw: object,
 *   visit: number, live: number, work: number,
 *   out: number, entertain: number, overlap: number, grand: number,
 *   male: number[], female: number[],
 *   ages: Record<string, number[]>, arpu: Record<string, number[]>
 * }}
 */
export function parseP0S1001(resultData) {
  const d = get1001Dict(resultData)
  if (!d) return null
  const n = (name) => pick1001(d, name, 0)
  const triple = (prefix, key) => [
    n(`${prefix}0_${key}`),
    n(`${prefix}1_${key}`),
    n(`${prefix}2_${key}`)
  ]

  const ages = {}
  for (const [, code] of AGE_GROUPS) ages[code] = triple('age', code)

  const arpu = {}
  for (const [, suffix] of ARPU_GROUPS) arpu[suffix] = triple('arpu', suffix)

  return {
    raw: d,
    visit: n('P0_SUM'),
    live: n('P1_SUM'),
    work: n('P2_SUM'),
    out: n('P3_SUM'),
    entertain: n('P4_SUM'),
    overlap: n('P5_SUM'),
    grand: n('PALL_SUM'),
    male: [n('MALE0_SUM'), n('MALE1_SUM'), n('MALE2_SUM')],
    female: [n('FEMALE0_SUM'), n('FEMALE1_SUM'), n('FEMALE2_SUM')],
    ages,
    arpu
  }
}
