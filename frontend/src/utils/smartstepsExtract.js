/**
 * 联通智慧足迹 result_data 解析器 —— **单一权威**（single source of truth）。
 *
 * 为什么要有这个文件（v1.13.166）：
 *   这四个解析器原本内联在 `views/MyAccountView.vue`，只有本页可用。新做的「多订单对比看板」
 *   要用**完全相同的口径**，若在别处再抄一份，迟早分裂（本项目 158 的根因就是这么来的：
 *   派生算法两处各写一份 ⇒ 一处改了另一处没改）。
 *   故抽成纯 ESM、无 Vue/DOM 依赖的模块：UI 直接 import，后端 `npm test` 也能 import 做单测
 *   （前端没有测试框架，见 tests/faqMatch.test.js 的同类做法）。
 *
 * ⚠️ 迁移是**逐字搬运**，语义一行未改；MyAccountView 改为 import 本模块。
 * ⚠️ 仍存在其它**同义副本**：`components/StoreSmartstepsDialog.vue`、`components/SmartstepsPanel.vue`
 *   各自内联了一份。本批不动它们（改动面太大），但**新逻辑一律加在这里**，别再往 .vue 里写第四份。
 *
 * 权威指标字典：`backend/src/utils/unicomSummaryCols.js`（1001/1005/1009 的字段与含义）。
 */

import { get1001Dict, pick1001, unwrapApiResult } from './smartsteps1001.js'

/**
 * 提取 result_data 里的服务数据字典（apiResult）——兼容三种格式：
 *   1) { apiResult: { 1001:…, 1005:… } }（完整结构）
 *   2) { 1001:…, 1005:… }（已剥离的裸字典）
 *   3) JSON 字符串（自动 parse）
 * @returns {object|null} 含服务号键的字典；识别不出则 null
 */
export const extractApiResult = (resultData) => {
  if (!resultData) return null
  const api = unwrapApiResult(resultData)
  if (!api || typeof api !== 'object') return null
  // 检查是否直接含服务号键（如 1001/1005/1009/1010/1011/1013/1015 等）
  const serviceKeys = Object.keys(api).filter(k => /^(100[0-9]|101[0-9]|102[0-9])$/.test(k))
  if (serviceKeys.length > 0) return api
  // 裸 1001 字典（无服务号键但含 p0_sum 等特征键）也认，交给 get1001Dict 兜底
  return get1001Dict(api) ? api : null
}

/**
 * 1001 人口明细提取。
 * 口径：P0=到访 / P1=居住 / P2=工作 / P3=外省到访 / P4=娱乐 / P5=居住工作重合 / PALL=总人口规模。
 * ⚠️ **取不到一律返回 null，不填 0** —— 0 与「无数据」在展示上是两件事，
 *   静默填 0 会让「没这个服务」看起来像「这个地方真的没人」。
 * @returns {null|{visit,live,work,out,entertain,overlap,grand}} 无 1001 字典时整体为 null
 */
export const extractPopDetail = (apiResult) => {
  // 统一 1001 解析（大小写不敏感，见 utils/smartsteps1001.js）
  const d = get1001Dict(apiResult)
  if (!d) return null
  const n = (key) => pick1001(d, key, null)
  return {
    visit: n('P0_SUM'),
    live: n('P1_SUM'),
    work: n('P2_SUM'),
    out: n('P3_SUM'),
    entertain: n('P4_SUM'),
    overlap: n('P5_SUM'),
    grand: n('PALL_SUM')
  }
}

/** 1001 汇总（旧签名，只回 到访/居住/工作；内部委派给 extractPopDetail） */
export const extractPopSums = (apiResult) => {
  const d = extractPopDetail(apiResult)
  if (!d) return null
  return { visit: d.visit, live: d.live, work: d.work }
}

/**
 * 1005 小时段到访提取（只取 day_type=0 工作日；同小时多条则累加）。
 * @returns {null|{hours:string[], values:number[], peakHour:number|null, peakVisit:number|null}}
 *          hours 形如 ['0点','1点',…]（保持与既有图表 x 轴一致的字符串格式）
 */
export const extractFlowData = (apiResult) => {
  const arr = apiResult && apiResult['1005']
  if (!Array.isArray(arr) || arr.length === 0) return null
  const hourMap = new Map()
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const hour = item.hour_period
    if (item.day_type === 0 && typeof item.hour_visit === 'number') {
      if (!hourMap.has(hour)) hourMap.set(hour, 0)
      hourMap.set(hour, hourMap.get(hour) + item.hour_visit)
    }
  }
  if (hourMap.size === 0) return null
  const sorted = [...hourMap.entries()].sort((a, b) => a[0] - b[0])
  let peakHour = null
  let peakVisit = null
  for (const [h, v] of sorted) {
    if (peakVisit === null || v > peakVisit) { peakVisit = v; peakHour = h }
  }
  return {
    hours: sorted.map(([h]) => h + '点'),
    values: sorted.map(([, v]) => v),
    peakHour,
    peakVisit
  }
}

/**
 * 1009 消费水平（富裕指数）提取 —— 兼容两种格式：
 *   格式A（旧）: {consume_1:n, consume_2:n, consume_3:n} → 低/中/高
 *   格式B（联通实际）: [{popu_type, spendpower:"1"~"8", spendpower_value}, …]
 *      → 低=spendpower≤3，中=4~5，高=≥6（popu_type 0/1/2 全人群合计）
 * @returns {null|{low:number, mid:number, high:number}}
 */
export const extractConsumeData = (apiResult) => {
  const d = apiResult && apiResult['1009']
  if (!d) return null

  // 格式B：spendpower 数组（popu_type 0/1/2 全人群合计）
  if (Array.isArray(d) && d.length > 0 && typeof d[0] === 'object' && d[0].spendpower !== undefined) {
    let low = 0, mid = 0, high = 0
    for (const item of d) {
      const v = Number(item.spendpower_value)
      if (isNaN(v)) continue
      const level = Number(item.spendpower)
      if (level <= 3) low += v
      else if (level <= 5) mid += v
      else high += v
    }
    if (low === 0 && mid === 0 && high === 0) return null
    return { low, mid, high }
  }

  // 格式A：consume_1/2/3 或 低/中/高 文本键
  if (typeof d === 'object') {
    let c1 = 0, c2 = 0, c3 = 0
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== 'number') continue
      if (/consume_1|低/i.test(k)) c1 += v
      else if (/consume_2|中/i.test(k)) c2 += v
      else if (/consume_3|高/i.test(k)) c3 += v
    }
    if (c1 === 0 && c2 === 0 && c3 === 0) return null
    return { low: c1, mid: c2, high: c3 }
  }
  return null
}

export default { extractApiResult, extractPopDetail, extractPopSums, extractFlowData, extractConsumeData }
