/**
 * 多订单对比看板 —— 纯逻辑（无 Vue / DOM 依赖，可被后端 vitest 直接 import 做单测）。
 *
 * 口径**全部**复用既有实现，不自创（v1.13.166）：
 *   · 人口规模 = 居住 + 工作      —— 与「商圈评分」详情页同口径
 *   · 客流活跃 = 工作日午晚餐时段(11-13、17-19) 到访合计 —— 同详情页
 *   · 消费能力 = 1009 高消费人数占比（spendpower≥6 / 全部） —— 同详情页
 *   · 外省到访占比 = P3_SUM / P0_SUM（派生比例，非原字段）
 *
 * 🔴 本模块最重要的一条铁律：**取不到就返回 null，绝不填 0**。
 *   0 与「无数据」是两件事：静默填 0 会让「这笔订单没买 1005 服务」看起来像
 *   「这个位置真的没人经过」，直接把用户决策带偏。UI 侧据此显示「无数据」灰字。
 */

import { extractApiResult, extractPopDetail, extractFlowData, extractConsumeData } from './smartstepsExtract.js'

/** 午晚餐时段（工作日）：11-13 点 + 17-19 点 —— 与详情页「客流活跃度」口径一致 */
export const LUNCH_DINNER_HOURS = [11, 12, 13, 17, 18, 19]

/**
 * 对比表列定义。
 * type: 'num' 千分位整数 | 'pct' 百分比 | 'text' 原样
 * best: 'max' 取最大为最优 | 'min' 取最小为最优 | null 不评最优
 * ⚠️ 半径、数据月份、峰值时段是**口径信息**，不参与最优评比（否则会误导成「半径越大越好」）。
 */
export const COMPARE_COLUMNS = [
  { key: 'radii_text', label: '半径', type: 'text', best: null },
  { key: 'city_month_text', label: '数据月', type: 'text', best: null },
  { key: 'visit', label: '到访人口', type: 'num', best: 'max' },
  { key: 'live', label: '居住人口', type: 'num', best: 'max' },
  { key: 'work', label: '工作人口', type: 'num', best: 'max' },
  { key: 'resident_work', label: '居住+工作', type: 'num', best: 'max' },
  { key: 'out_ratio', label: '外省到访占比', type: 'pct', best: 'max' },
  { key: 'lunch_dinner', label: '午晚餐到访', type: 'num', best: 'max' },
  { key: 'peak_hour_text', label: '工作日峰值', type: 'text', best: null },
  { key: 'high_ratio', label: '高消费占比', type: 'pct', best: 'max' }
]

/** '202503' → '2025-03'；取不到 → '-' */
export const formatCityMonth = (v) => {
  const s = String(v == null ? '' : v).trim()
  if (!/^\d{6}$/.test(s)) return s || '-'
  return `${s.slice(0, 4)}-${s.slice(4, 6)}`
}

/**
 * 归一化半径：兼容 radii 数组 / radius 数字 / radius 的 JSON 字符串 / radius_display 文本。
 * @returns {number[]} 升序去重后的半径数组；识别不出则空数组
 */
export const normalizeRadii = (order = {}) => {
  const raw = order.radii !== undefined && order.radii !== null ? order.radii : order.radius
  const push = (acc, v) => {
    const n = Number(v)
    if (!isNaN(n) && n > 0) acc.push(n)
  }
  const out = []
  if (Array.isArray(raw)) {
    raw.forEach(v => push(out, v))
  } else if (typeof raw === 'number') {
    push(out, raw)
  } else if (typeof raw === 'string' && raw !== '') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) parsed.forEach(v => push(out, v))
      else push(out, parsed)
    } catch (e) {
      const m = raw.match(/\d+(?:\.\d+)?/g)
      if (m) m.forEach(v => push(out, v))
    }
  }
  if (!out.length) {
    const m = String(order.radius_display || '').match(/\d+(?:\.\d+)?/g)
    if (m) m.forEach(v => push(out, v))
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

/** 半径展示文本：'500/1000米'；取不到 '-'
 *  ⚠️ 与 normalizeRadii 必须成对使用，避免文本与判据不一致（本项目反复踩过的坑）。 */
export const formatRadii = (order = {}) => {
  const r = normalizeRadii(order)
  return r.length ? r.join('/') + '米' : '-'
}

/** 半径一致性指纹：排序后 join —— 用于判断两笔订单是否同口径 */
export const radiusSignature = (order = {}) => normalizeRadii(order).join(',')

/**
 * 单笔订单 → 扁平指标对象（缺数据一律 null）。
 * @param {object} order - 至少含 result_data；可含 radii/radius/radius_display/city_month
 * @returns {object} 指标对象（含归一化后的 radii_text / city_month_text / peak_hour_text）
 */
export const computeOrderMetrics = (order = {}) => {
  const api = extractApiResult(order.result_data)
  const pop = extractPopDetail(api)
  const flow = extractFlowData(api)
  const cons = extractConsumeData(api)

  const visit = pop ? pop.visit : null
  const live = pop ? pop.live : null
  const work = pop ? pop.work : null

  // 人口规模 = 居住 + 工作（详情页口径）；两者都为 null 时才算无数据
  const residentWork = (live === null && work === null) ? null : (live || 0) + (work || 0)

  // 外省到访占比：分母为 0 或缺失时不产出（不做 0 除法）
  const out = pop ? pop.out : null
  const outRatio = (visit !== null && visit > 0 && out !== null) ? out / visit : null

  // 客流：午晚餐时段合计（工作日）
  let lunchDinner = null
  if (flow && flow.values.length) {
    lunchDinner = flow.values.reduce((acc, v, i) => {
      const h = parseInt(flow.hours[i], 10)
      return LUNCH_DINNER_HOURS.includes(h) ? acc + v : acc
    }, 0)
  }

  // 消费：高消费占比；合计为 0 时不产出
  let highRatio = null
  let highCount = null
  if (cons) {
    const total = cons.low + cons.mid + cons.high
    if (total > 0) { highRatio = cons.high / total; highCount = cons.high }
  }

  return {
    visit,
    live,
    work,
    resident_work: residentWork,
    out,
    out_ratio: outRatio,
    lunch_dinner: lunchDinner,
    high_count: highCount,
    high_ratio: highRatio,
    peak_hour: flow ? flow.peakHour : null,
    peak_visit: flow ? flow.peakVisit : null,
    peak_hour_text: (flow && flow.peakHour !== null) ? `${flow.peakHour}点` : '-',
    radii_text: formatRadii(order),
    city_month_text: formatCityMonth(order.city_month)
  }
}

/**
 * 多笔订单 → 对比表行。
 * @returns {Array<object>} 每行 = { id, name, city, district, store_type, owner_name, is_self,
 *                                   subtitle, ...指标 } ，顺序与入参一致
 */
export const buildCompareRows = (orders = []) => {
  return orders.map(o => {
    const m = computeOrderMetrics(o)
    return {
      id: o.id,
      name: o.store_name || ('订单' + o.id),
      subtitle: [o.city, o.district].filter(Boolean).join(' ') || '-',
      store_type: o.store_type || '-',
      owner_name: o.owner_name || '',
      is_self: o.is_self !== false,
      order_no: o.order_no || '',
      lng: o.center_lng,
      lat: o.center_lat,
      ...m
    }
  })
}

/**
 * 取一列的最优值（用于「每列最优高亮」）。
 * ⚠️ 全列无数据 → 返回 null，UI 不得高亮任何格子（否则会把「全都没数据」显示成「第一个最好」）。
 * @param {Array<number|null>} values
 * @param {'max'|'min'} mode
 */
export const bestValue = (values = [], mode = 'max') => {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v))
  if (!nums.length) return null
  return mode === 'min' ? Math.min(...nums) : Math.max(...nums)
}

/** 该行是否持有某列最优（并列时**都高亮**，与商圈对比弹窗的既有做法一致） */
export const isBestAt = (rows = [], row, key) => {
  const col = COMPARE_COLUMNS.find(c => c.key === key)
  if (!col || !col.best) return false
  const best = bestValue(rows.map(r => r[key]), col.best)
  if (best === null) return false
  return row[key] === best
}

/**
 * 半径口径一致性检查。
 * @returns {{consistent:boolean, signatures:string[], groups:Array<{signature:string, labels:string[]}>}}
 */
export const checkRadiusConsistency = (orders = []) => {
  const sigs = orders.map(o => radiusSignature(o))
  const groups = []
  const seen = new Map()
  orders.forEach((o, i) => {
    const sig = sigs[i]
    if (!seen.has(sig)) {
      const g = { signature: sig, labels: [] }
      seen.set(sig, g)
      groups.push(g)
    }
    seen.get(sig).labels.push(o.store_name || ('订单' + o.id))
  })
  return { consistent: groups.length <= 1, signatures: sigs, groups }
}

// ===== 展示与导出 =====

/** 单元格展示文本（'无数据' 而不是 0） */
export const formatCell = (value, type) => {
  if (value === null || value === undefined || value === '') return '无数据'
  if (type === 'pct') return Math.round(value * 100) + '%'
  if (type === 'num') return Number(value).toLocaleString('zh-CN')
  return String(value)
}

/** CSV 单字段转义（含逗号/引号/换行时加引号，内部引号翻倍） */
const csvField = (v) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 对比表 → CSV 文本（不含 BOM；调用方自行决定是否加 '\ufeff' 以适配 Excel）。
 * 缺失值导出为空字符串（Excel 里比「无数据」更好做筛选/统计）。
 */
export const buildCompareCsv = (rows = [], columns = COMPARE_COLUMNS) => {
  const header = ['门店', '城市/区县', ...columns.map(c => c.label)]
  const lines = [header.map(csvField).join(',')]
  for (const r of rows) {
    const cells = [
      r.name,
      r.subtitle,
      ...columns.map(c => {
        const v = r[c.key]
        if (v === null || v === undefined || v === '') return ''
        if (c.type === 'pct') return Math.round(v * 100) + '%'
        if (c.type === 'num') return String(v)
        return v
      })
    ]
    lines.push(cells.map(csvField).join(','))
  }
  return lines.join('\r\n')
}

export default {
  COMPARE_COLUMNS,
  LUNCH_DINNER_HOURS,
  formatCityMonth,
  normalizeRadii,
  formatRadii,
  radiusSignature,
  computeOrderMetrics,
  buildCompareRows,
  bestValue,
  isBestAt,
  checkRadiusConsistency,
  formatCell,
  buildCompareCsv
}
