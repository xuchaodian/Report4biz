import { describe, it, expect } from 'vitest'
import {
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
} from '../../frontend/src/utils/orderCompare.js'

/**
 * 多订单对比看板（v1.13.166）—— 纯逻辑单测
 *
 * 为什么放 backend/tests：
 *   前端没有测试框架，而 `orderCompare.js` / `smartstepsExtract.js` 是**纯 ESM、无 Vue/DOM 依赖**
 *   的模块，可被后端既有回归流水线（`npm test`）直接 import（与 164 的 faqMatch.test.js 同法）。
 *
 * 本批最要紧的两条被钉在这里：
 *   🔴 **缺数据必须 null、绝不填 0** —— 否则「没买该服务」被显示成「这里真的没人」。
 *   🔴 **全空列不产生最优高亮** —— 否则会把「全都没数据」显示成「第一个最好」。
 */

// ===== 造数工具（按联通真实 result_data 结构）=====

/** 1001：p0=到访 / p1=居住 / p2=工作 / p3=外省到访 / pall=总规模。传 null 表示该键缺失 */
const make1001 = (p0, p1, p2, p3, pall, lowerCase = true) => {
  const k = (n) => (lowerCase ? n.toLowerCase() : n)
  const d = {}
  if (p0 !== null) d[k('P0_SUM')] = p0
  if (p1 !== null) d[k('P1_SUM')] = p1
  if (p2 !== null) d[k('P2_SUM')] = p2
  if (p3 !== null) d[k('P3_SUM')] = p3
  if (pall !== null) d[k('PALL_SUM')] = pall
  return d
}

/** 1005：工作日 day_type=0 / 周末 day_type=1 */
const make1005 = (pairs, dayType = 0) =>
  pairs.map(([hour, visit]) => ({ day_type: dayType, hour_period: hour, hour_visit: visit }))

/** 1009：spendpower 1~8 富裕指数数组 */
const make1009 = (levels) =>
  levels.map(([level, value]) => ({ popu_type: 0, spendpower: level, spendpower_value: value }))

const order = (over = {}) => ({
  id: 1,
  store_name: 'A店',
  city: '上海',
  district: '浦东新区',
  store_type: '标准店',
  radii: [500],
  city_month: '202503',
  result_data: { apiResult: { '1001': make1001(100000, 40000, 60000, 25000, 150000) } },
  ...over
})

// ===========================================================================
describe('A. 1001 人口口径：到访/居住/工作/居住+工作/外省占比', () => {
  it('A1 小写键（联通实际响应鍵）必须取值成功', () => {
    const m = computeOrderMetrics(order())
    expect(m.visit).toBe(100000)
    expect(m.live).toBe(40000)
    expect(m.work).toBe(60000)
    expect(m.out).toBe(25000)
  })

  it('A2 大写键（模板 C 列写法）同样必须取值成功 —— 大小写不敏感', () => {
    const m = computeOrderMetrics(order({
      result_data: { apiResult: { '1001': make1001(100000, 40000, 60000, 25000, null, false) } }
    }))
    expect(m.visit).toBe(100000)
    expect(m.live).toBe(40000)
    expect(m.work).toBe(60000)
  })

  it('A3 居住+工作 = 详情页「人口规模」口径', () => {
    expect(computeOrderMetrics(order()).resident_work).toBe(100000)
  })

  it('A4 外省到访占比 = P3_SUM / P0_SUM', () => {
    expect(computeOrderMetrics(order()).out_ratio).toBeCloseTo(0.25, 6)
  })

  it('A5 result_data 为 JSON 字符串时也能解析', () => {
    const o = order({
      result_data: JSON.stringify({ apiResult: { '1001': make1001(80000, 10000, 20000, 8000, null) } })
    })
    expect(computeOrderMetrics(o).visit).toBe(80000)
  })

  it('A6 裸 1001 字典（无服务号外层）也能认', () => {
    const o = order({ result_data: { apiResult: make1001(70000, 10000, 20000, 7000, null) } })
    expect(computeOrderMetrics(o).visit).toBe(70000)
  })
})

// ===========================================================================
describe('B. 🔴 缺数据必须返回 null，绝不填 0', () => {
  it('B1 完全没有 result_data ⇒ 所有指标 null（不是 0）', () => {
    const m = computeOrderMetrics(order({ result_data: null }))
    expect(m.visit).toBeNull()
    expect(m.live).toBeNull()
    expect(m.work).toBeNull()
    expect(m.resident_work).toBeNull()
    expect(m.out_ratio).toBeNull()
    expect(m.lunch_dinner).toBeNull()
    expect(m.high_ratio).toBeNull()
  })

  it('B2 有 1001 但缺 P0_SUM ⇒ 该项 null，其余照常', () => {
    const o = order({ result_data: { apiResult: { '1001': make1001(null, 40000, 60000, null, null) } } })
    const m = computeOrderMetrics(o)
    expect(m.visit).toBeNull()
    expect(m.live).toBe(40000)
    expect(m.work).toBe(60000)
    expect(m.out_ratio).toBeNull() // 分子分母都缺
  })

  it('B3 没有 1005 ⇒ 客流指标 null（不得当成 0 人次）', () => {
    const m = computeOrderMetrics(order())
    expect(m.lunch_dinner).toBeNull()
    expect(m.peak_hour).toBeNull()
    expect(m.peak_hour_text).toBe('-')
  })

  it('B4 没有 1009 ⇒ 消费指标 null', () => {
    const m = computeOrderMetrics(order())
    expect(m.high_ratio).toBeNull()
    expect(m.high_count).toBeNull()
  })

  it('B5 1005 存在但全是 weekend（day_type=1）⇒ 与无数据等价（null）', () => {
    const o = order({
      result_data: { apiResult: { '1005': make1005([[12, 5000]], 1) } }
    })
    expect(computeOrderMetrics(o).lunch_dinner).toBeNull()
  })

  it('B6 1009 全是 0 值 ⇒ null（不得产出 0% 占比）', () => {
    const o = order({ result_data: { apiResult: { '1009': make1009([[1, 0], [5, 0], [8, 0]]) } } })
    const m = computeOrderMetrics(o)
    expect(m.high_ratio).toBeNull()
    expect(m.high_count).toBeNull()
  })
})

// ===========================================================================
describe('C. 🔴 无数据不得与 0 混淆：0 是有效值、不能被当成缺失', () => {
  it('C1 到访人口真的是 0 ⇒ 保留 0（不是 null）', () => {
    const o = order({ result_data: { apiResult: { '1001': make1001(0, 0, 0, 0, null) } } })
    const m = computeOrderMetrics(o)
    expect(m.visit).toBe(0)
    expect(m.resident_work).toBe(0)
  })

  it('C2 到访为 0 时外省占比不产出（避免除零得 Infinity/NaN）', () => {
    const o = order({ result_data: { apiResult: { '1001': make1001(0, 0, 0, 5000, null) } } })
    const m = computeOrderMetrics(o)
    expect(m.out_ratio).toBeNull()
    expect(Number.isFinite(m.out_ratio) === false || m.out_ratio === null).toBe(true)
  })

  it('C3 居住/工作其一为 0、另一有值 ⇒ 居住+工作照常求和', () => {
    const o = order({ result_data: { apiResult: { '1001': make1001(1000, 0, 60000, null, null) } } })
    expect(computeOrderMetrics(o).resident_work).toBe(60000)
  })
})

// ===========================================================================
describe('D. 1005 客流：只取工作日、同小时累加、峰值取最大', () => {
  const o = order({
    result_data: {
      apiResult: {
        '1005': [
          ...make1005([[11, 1000], [12, 2000], [13, 500], [18, 3000], [3, 100]]),
          ...make1005([[20, 99999]], 1) // 周末：必须被排除
        ]
      }
    }
  })

  it('D1 午晚餐时段 = 11,12,13,17,18,19 之和（排除凌晨与周末）', () => {
    expect(computeOrderMetrics(o).lunch_dinner).toBe(6500)
    expect(LUNCH_DINNER_HOURS).toEqual([11, 12, 13, 17, 18, 19])
  })

  it('D2 峰值时段只在工作日里选（周末 99999 不得胜出）', () => {
    const m = computeOrderMetrics(o)
    expect(m.peak_hour).toBe(18)
    expect(m.peak_visit).toBe(3000)
    expect(m.peak_hour_text).toBe('18点')
  })

  it('D3 同一小时多条记录必须累加', () => {
    const o2 = order({ result_data: { apiResult: { '1005': [...make1005([[12, 100]]), ...make1005([[12, 400]])] } } })
    expect(computeOrderMetrics(o2).lunch_dinner).toBe(500)
  })
})

// ===========================================================================
describe('E. 1009 消费：spendpower 分档（≤3低 / 4-5中 / ≥6高）', () => {
  it('E1 高消费 = spendpower≥6，占比分母为三段合计', () => {
    const o = order({ result_data: { apiResult: { '1009': make1009([[2, 10000], [4, 20000], [7, 30000]]) } } })
    const m = computeOrderMetrics(o)
    expect(m.high_count).toBe(30000)
    expect(m.high_ratio).toBeCloseTo(0.5, 6)
  })

  it('E2 边界：spendpower=5 归中段、=6 归高段', () => {
    const o = order({ result_data: { apiResult: { '1009': make1009([[5, 100], [6, 100], [3, 100]]) } } })
    const m = computeOrderMetrics(o)
    expect(m.high_count).toBe(100)      // 仅 spendpower=6 计入高
    expect(m.high_ratio).toBeCloseTo(1 / 3, 6)
  })

  it('E3 兼容旧格式 consume_1/2/3', () => {
    const o = order({ result_data: { apiResult: { '1009': { consume_1: 100, consume_2: 200, consume_3: 100 } } } })
    const m = computeOrderMetrics(o)
    expect(m.high_count).toBe(100)
    expect(m.high_ratio).toBeCloseTo(0.25, 6)
  })
})

// ===========================================================================
describe('F. 🔴 最优高亮：全空列不得高亮任何格子', () => {
  const rows = () => buildCompareRows([
    order({ id: 1, store_name: 'A', result_data: { apiResult: { '1001': make1001(100, 10, 10, null, null) } } }),
    order({ id: 2, store_name: 'B', result_data: { apiResult: { '1001': make1001(300, 10, 10, null, null) } } }),
    order({ id: 3, store_name: 'C', result_data: { apiResult: { '1001': make1001(200, 10, 10, null, null) } } })
  ])

  it('F1 bestValue 取最大 / 取最小', () => {
    expect(bestValue([100, 300, 200], 'max')).toBe(300)
    expect(bestValue([100, 300, 200], 'min')).toBe(100)
  })

  it('F2 bestValue 忽略 null，但全 null 时返回 null', () => {
    expect(bestValue([null, 300, null], 'max')).toBe(300)
    expect(bestValue([null, null], 'max')).toBeNull()
    expect(bestValue([], 'max')).toBeNull()
  })

  it('F3 到访人口列：最大者（B=300）高亮，其余不高亮', () => {
    const r = rows()
    expect(isBestAt(r, r[1], 'visit')).toBe(true)
    expect(isBestAt(r, r[2], 'visit')).toBe(false)
    expect(isBestAt(r, r[0], 'visit')).toBe(false)
  })

  it('F4 并列最优时全部高亮', () => {
    const r = buildCompareRows([
      order({ id: 1, store_name: 'A', result_data: { apiResult: { '1001': make1001(500, 1, 1, null, null) } } }),
      order({ id: 2, store_name: 'B', result_data: { apiResult: { '1001': make1001(500, 1, 1, null, null) } } })
    ])
    expect(isBestAt(r, r[0], 'visit')).toBe(true)
    expect(isBestAt(r, r[1], 'visit')).toBe(true)
  })

  it('F5 全列无数据的列（午晚餐到访）⇒ 谁都不高亮', () => {
    const r = rows()
    for (const row of r) {
      expect(isBestAt(r, row, 'lunch_dinner')).toBe(false)
    }
  })

  it('F6 非评比列（半径/数据月/峰值）永不产生最优', () => {
    const r = rows()
    for (const key of ['radii_text', 'city_month_text', 'peak_hour_text']) {
      for (const row of r) expect(isBestAt(r, row, key)).toBe(false)
    }
  })

  it('F7 列定义里 radius/月份/峰值 的 best 必须为 null（防后人误改）', () => {
    const nonRanked = ['radii_text', 'city_month_text', 'peak_hour_text']
    for (const key of nonRanked) {
      const col = COMPARE_COLUMNS.find(c => c.key === key)
      expect(col, `列 ${key} 应存在`).toBeTruthy()
      expect(col.best).toBeNull()
    }
  })
})

// ===========================================================================
describe('G. 半径归一化与口径一致性', () => {
  it('G1 radii 数组 / radius 数字 / JSON 字符串 / radius_display 文本 都能归一化', () => {
    expect(normalizeRadii({ radii: [1000, 500] })).toEqual([500, 1000])
    expect(normalizeRadii({ radius: 800 })).toEqual([800])
    expect(normalizeRadii({ radius: '[500,1000]' })).toEqual([500, 1000])
    expect(normalizeRadii({ radius_display: '500米, 1000米' })).toEqual([500, 1000])
  })

  it('G2 取不到半径 ⇒ 空数组、展示为 "-"', () => {
    expect(normalizeRadii({})).toEqual([])
    expect(formatRadii({})).toBe('-')
  })

  it('G3 半径指纹：多半径（500+1000）与单半径（500）**不同口径**', () => {
    expect(radiusSignature({ radii: [500, 1000] })).toBe('500,1000')
    expect(radiusSignature({ radii: [500] })).toBe('500')
    expect(radiusSignature({ radii: [500] })).not.toBe(radiusSignature({ radii: [500, 1000] }))
  })

  it('G4 半径全同 ⇒ consistent=true', () => {
    const r = checkRadiusConsistency([{ radii: [500] }, { radius: 500 }, { radius: '500' }])
    expect(r.consistent).toBe(true)
    expect(r.groups).toHaveLength(1)
  })

  it('G5 存在不同半径 ⇒ consistent=false，并按口径分组列出店名', () => {
    const r = checkRadiusConsistency([
      { store_name: 'A', radii: [500] },
      { store_name: 'B', radii: [1000] },
      { store_name: 'C', radii: [500] }
    ])
    expect(r.consistent).toBe(false)
    expect(r.groups).toHaveLength(2)
    expect(r.groups.find(g => g.signature === '500').labels).toEqual(['A', 'C'])
  })
})

// ===========================================================================
describe('H. 展示与 CSV 导出', () => {
  it('H1 formatCell：null/空 ⇒ 「无数据」；百分比四舍五入；数字千分位', () => {
    expect(formatCell(null, 'num')).toBe('无数据')
    expect(formatCell('', 'pct')).toBe('无数据')
    expect(formatCell(0, 'num')).toBe('0')
    expect(formatCell(0.256, 'pct')).toBe('26%')
    expect(formatCell(1234567, 'num')).toBe('1,234,567')
  })

  it('H2 formatCityMonth：YYYYMM → YYYY-MM，异常原样/占位', () => {
    expect(formatCityMonth('202503')).toBe('2025-03')
    expect(formatCityMonth(202512)).toBe('2025-12')
    expect(formatCityMonth(null)).toBe('-')
  })

  it('H3 CSV 表头含全部列标签；缺失值导出为空字符串（便于 Excel 统计）', () => {
    const rows = buildCompareRows([
      order({ id: 1, store_name: 'A', city: '上海', district: '浦东新区' })
    ])
    const csv = buildCompareCsv(rows)
    const [head, body] = csv.split('\r\n')
    expect(head).toBe('门店,城市/区县,' + COMPARE_COLUMNS.map(c => c.label).join(','))
    expect(body.startsWith('A,上海 浦东新区,500米,2025-03,100000')).toBe(true)
    // 该单缺 1005/1009 ⇒ 末三列：午晚餐到访=''、工作日峰值='-'（文本占位）、高消费占比=''
    const cells = body.split(',')
    expect(cells[cells.length - 1]).toBe('')   // 高消费占比：无数据 ⇒ 空串
    expect(cells[cells.length - 2]).toBe('-')  // 工作日峰值：无数据 ⇒ 文本占位
    expect(cells[cells.length - 3]).toBe('')   // 午晚餐到访：无数据 ⇒ 空串
    expect(cells[cells.length - 4]).toBe('25%') // 外省到访占比：有值 ⇒ 百分比
  })

  it('H4 CSV 转义：含逗号/引号的店名必须加引号且内部引号翻倍', () => {
    const rows = buildCompareRows([order({ id: 9, store_name: 'A,B"C店' })])
    const body = buildCompareCsv(rows).split('\r\n')[1]
    expect(body.startsWith('"A,B""C店"')).toBe(true)
  })
})

// ===========================================================================
describe('I. 端到端：buildCompareRows 行结构与顺序', () => {
  it('I1 行结构与入参顺序一致，且带齐展示字段', () => {
    const rows = buildCompareRows([
      order({ id: 11, store_name: '甲店', city: '上海', district: '静安区', store_type: '旗舰店' }),
      order({ id: 12, store_name: '乙店', city: '北京', district: '朝阳区', store_type: '标准店' })
    ])
    expect(rows.map(r => r.name)).toEqual(['甲店', '乙店'])
    expect(rows[0]).toMatchObject({
      id: 11,
      subtitle: '上海 静安区',
      store_type: '旗舰店',
      radii_text: '500米',
      city_month_text: '2025-03'
    })
    expect(rows[0].visit).toBe(100000)
  })

  it('I2 缺门店名时回退为「订单+id」，不产出 undefined', () => {
    const rows = buildCompareRows([order({ id: 77, store_name: '' })])
    expect(rows[0].name).toBe('订单77')
  })

  it('I3 空数组不抛错', () => {
    expect(buildCompareRows([])).toEqual([])
    expect(buildCompareRows()).toEqual([])
  })
})
