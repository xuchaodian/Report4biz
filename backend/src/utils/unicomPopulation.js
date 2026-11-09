/**
 * 联通智慧足迹 1001（人口基础属性）解析 —— v1.13.340
 *
 * ── 为什么单独一个文件 ─────────────────────────────────────────────────
 * 立项报告要按**用户实际购买的联通人口**出数（业主 2026-11-09 定：
 * 「人口数据不要用商圈边界面数据，原则上用收费的联通人口配额」）。
 * 而 1001 的字段是 `p0_sum / p1_sum / p2_sum / age1_1924 / arpu2_150 …` 这种
 * 「前缀 + 人口类型位 + 分档」的拼装键，散在各处取会各错各的。
 * 本文件是**唯一**的 1001 取值口径，⛔ 别在路由里再写 `Number(d.pall_sum)`。
 *
 * ── 响应键的大小写陷阱 ────────────────────────────────────────────────
 * 模板里是大写 `P0_SUM`，真实响应是**小写** `p0_sum`（见 utils/unicomSummaryCols.js）。
 * 历史上两种假设各写一半 ⇒ 上游一换就整块取到 0 且不报错。这里一律大小写不敏感。
 *
 * ── 人口类型位（第二位的 0/1/2）──────────────────────────────────────
 *   0 = 到访   1 = 居住   2 = 工作（联通定义，三套共用同一组分档 code）
 * 所以 `age1_1924` 是「居住人口中 19-24 岁」，`arpu2_150` 是「工作人口月话费 100-150 元」。
 *
 * ── 契约 ──────────────────────────────────────────────────────────────
 * ① 解析不出来就返回 `null`（⛔ 不返一堆 0 冒充「有数据」—— 报告会据此显示「未获取」）。
 * ② 所有数值都是 Number，缺失当 0；但**总量为 0 时整体判 null**。
 * ③ 不做任何单位换算（联通原值就是「人」）。
 */

/** 年龄段（15 档，与前端 utils/smartsteps1001.js 的 AGE_GROUPS 同源） */
export const AGE_GROUPS = [
  ['0-6岁', '0006'], ['6-12岁', '0612'], ['12-15岁', '1215'], ['15-18岁', '1518'],
  ['19-24岁', '1924'], ['25-29岁', '2529'], ['30-34岁', '3034'], ['35-39岁', '3539'],
  ['40-44岁', '4044'], ['45-49岁', '4549'], ['50-54岁', '5054'], ['55-59岁', '5559'],
  ['60-64岁', '6064'], ['65-69岁', '6569'], ['70岁+', '70up']
]

/** 月出账（话费）区间（6 档，可作消费能力代理） */
export const ARPU_GROUPS = [
  ['50元以下', '50'], ['50-100元', '100'], ['100-150元', '150'],
  ['150-200元', '200'], ['200-250元', '250'], ['250元以上', 'up']
]

/** 剥外壳：兼容 JSON 字符串 / { apiResult } / apiResult 裸对象 */
function unwrap(resultData) {
  let api = resultData
  if (typeof api === 'string') {
    try { api = JSON.parse(api) } catch { return null }
  }
  if (api && typeof api === 'object' && api.apiResult && typeof api.apiResult === 'object') {
    api = api.apiResult
  }
  return api && typeof api === 'object' ? api : null
}

/** 取 1001 字典（有的返回直接是 1001 dict，没有外层 '1001' 键） */
function dict1001(api) {
  if (!api) return null
  const inner = api['1001']
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner
  // 退化情形：整个对象就是 1001 dict（含 p0_sum / pall_sum 之类的特征键）
  const keys = Object.keys(api).join('|').toLowerCase()
  if (/(^|\|)(p0_sum|pall_sum|male0_sum|age0_|arpu0_)/.test(keys)) return api
  return null
}

/** 大小写不敏感取数值（`P0_SUM` / `p0_sum` / `P0_SUM1` 都认） */
function pick(dict, name, fallback = 0) {
  if (!dict) return fallback
  const want = String(name).toLowerCase()
  for (const [k, v] of Object.entries(dict)) {
    const lk = k.toLowerCase()
    if (lk === want || lk.replace(/\d+$/, '') === want) {
      const n = Number(v)
      return Number.isFinite(n) ? n : fallback
    }
  }
  return fallback
}

/** 某一人口类型位（0到访/1居住/2工作）的分档序列 */
function seriesByPrefix(dict, prefix, groups) {
  return groups.map(([label, code]) => ({
    label,
    value: pick(dict, `${prefix}_${code}`)
  }))
}

/**
 * 解析 1001 → 报告要用的结构化人口画像。
 *
 * @param {string|object} resultData district_cache.result_data（或裸 apiResult / 1001 dict）
 * @returns {null | {
 *   visit:number, live:number, work:number, total:number,
 *   male:{live:number, work:number}, female:{live:number, work:number},
 *   ages:{live:Array<{label:string,value:number}>, work:Array<...>},
 *   arpu:{live:Array<{label:string,value:number}>, work:Array<...>}
 * }}
 */
export function parsePopulation1001(resultData) {
  const api = unwrap(resultData)
  const d = dict1001(api)
  if (!d) return null
  const n = (name) => pick(d, name)

  const visit = n('p0_sum')
  const live = n('p1_sum')
  const work = n('p2_sum')
  const total = n('pall_sum')
  // 🔴 三项全空 ⇒ 当作没有（⛔ 不返回一堆 0 让报告显示"0 人"）
  if (!visit && !live && !work && !total) return null

  return {
    visit,
    live,
    work,
    total: total || Math.max(visit, live, work),
    male: { live: n('male1_sum'), work: n('male2_sum') },
    female: { live: n('female1_sum'), work: n('female2_sum') },
    ages: {
      live: seriesByPrefix(d, 'age1', AGE_GROUPS),
      work: seriesByPrefix(d, 'age2', AGE_GROUPS)
    },
    arpu: {
      live: seriesByPrefix(d, 'arpu1', ARPU_GROUPS),
      work: seriesByPrefix(d, 'arpu2', ARPU_GROUPS)
    }
  }
}

/** 把一组 {label,value} 归一成百分比（供报告画条形）；总量为 0 返回空数组 */
export function toPercents(series) {
  if (!Array.isArray(series) || !series.length) return []
  const total = series.reduce((s, x) => s + (Number(x.value) || 0), 0)
  if (!total) return []
  return series.map((x) => ({
    label: x.label,
    value: Number(x.value) || 0,
    pct: ((Number(x.value) || 0) / total) * 100
  }))
}
