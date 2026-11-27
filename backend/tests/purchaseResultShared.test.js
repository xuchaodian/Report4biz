/**
 * 守卫：详情渲染只有一份实现（v1.13.429）
 *
 * 业主 2026-11-27 要求：「购买履历 → 查询结果详情」与「地图 → 门店 → 联通人口 → 已购报表」
 * 必须同一个设计。做法是把表格/图表抽到 utils/purchaseResultHtml.js 与 utils/purchaseCharts.js，
 * 两处 import 同一份。本文件跑**真函数**，钉住输出（源码守卫在 importReportCompat/importReportRows）。
 */
import { describe, it, expect } from 'vitest'

const { formatResultData, excludeServices } =
  await import('../../frontend/src/utils/purchaseResultHtml.js')
const { buildChartListFrom } =
  await import('../../frontend/src/utils/purchaseCharts.js')

const row = (code, key, label, value) => ({ code, key, label, value, group: '' })

/** 一段 1005（工作日/周末 × 2 小时）+ 1002（3 人群各 1 条）+ 1009（3 人群 × 2 档） */
const buildImportRecord = () => {
  const rows = [
    row('1001', 'p0_sum', '到访人口数', 1000),
    row('1001', 'p1_sum', '居住人口数', 200),
    row('1001', 'p2_sum', '工作人口数', 100)
  ]
  for (let day = 0; day <= 1; day++) {
    for (let h = 0; h < 2; h++) {
      rows.push(row('1005', `hour${day}_${h}_visit`, `${h}点小时到访人次`, 1000 + day * 10 + h))
      rows.push(row('1005', `hour${day}_${h}_all`, `${h}点小时全量人次`, 2000 + day * 10 + h))
    }
  }
  for (let p = 0; p <= 2; p++) {
    rows.push(row('1002', `webtag${p}_1`, `${['到访', '居住', '工作'][p]}网上购物标签人数`, 300 + p))
  }
  for (let p = 0; p <= 2; p++) {
    for (let n = 1; n <= 8; n++) {
      rows.push(row('1009', `spendpower${p}_${n}`, `${['到访', '居住', '工作'][p]}消费力指数${n}`, p * 100 + n))
    }
  }
  return {
    apiResult: {
      '1001': { p0_sum: 1000, p1_sum: 200, p2_sum: 100 },
      '1005': { hour0_0_visit: 1000 },
      '1002': { webtag0_1: 300 },
      '1009': { spendpower0_1: 1 }
    },
    reportRows: rows
  }
}

describe('导入记录：左表用系统标准结构', () => {
  const html = formatResultData(buildImportRecord())

  it('A1 1005 出 24 行交叉表的表头（不是 96 行「指标/数值」）', () => {
    expect(html).toContain('每小时段人口流量')
    expect(html).toContain('<th>时段</th>')
    expect(html).toContain('工作日到访人次')
    expect(html).toContain('周末全量人次')
  })

  it('A2 1002 表还在（只是不出图），用的是标签交叉表', () => {
    expect(html).toContain('上网标签分布')
    expect(html).toContain('网上购物标签')
    expect(html).not.toContain('webtag0_1')
  })

  it('A3 1009 是「消费力指数 × 到访/居住/工作」交叉表，不打印原始键名', () => {
    expect(html).toContain('消费力指数1（最低）')
    expect(html).not.toContain('spendpower0_1')
  })

  it('A4 1001 仍走四列透视（formatP0SData），不受重构影响', () => {
    expect(html).toContain('指标名称')
    expect(html).toContain('到访人口数')
    expect(html).toContain('居住人口数')
  })
})

describe('导入记录：右图按设计出，且 1002 不出图', () => {
  const list = buildChartListFrom(buildImportRecord())

  it('B1 1005 出「到访 / 全量」两张，与普通记录同名', () => {
    const titles = list.filter((c) => c.serviceCode === '1005').map((c) => c.title)
    expect(titles).toEqual(['每小时段流量 - 到访', '每小时段流量 - 全量'])
  })

  it('B2 1002 一张都不出（业主 2026-11-27 拍板），但其它码不受影响', () => {
    expect(list.some((c) => c.serviceCode === '1002')).toBe(false)
    expect(list.some((c) => c.serviceCode === '1009')).toBe(true)
  })

  it('B3 图数据随卡片带上（compatData），不依赖 apiResult 结构', () => {
    const c = list.find((x) => x.chartKey === '1005-a')
    expect(Array.isArray(c.compatData)).toBe(true)
    expect(c.compatData[0]).toMatchObject({ day_type: 0, hour_period: 0, hour_visit: 1000 })
  })
})

describe('普通购买记录：口径不变（回归）', () => {
  const api = {
    '1001': { p0_sum: 100, p1_sum: 20, p2_sum: 10, age0_0006: 5, male0_sum: 60, female0_sum: 40 },
    '1009': [
      { popu_type: 0, spendpower: '1', spendpower_value: 10 },
      { popu_type: 1, spendpower: '1', spendpower_value: 5 }
    ],
    '1015': [{ fname: '收入预测', popu_type: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 }],
    '1007': [{ reach1: 1, reach2: 2, reach3: 3, reach4: 4, reach5: 5 }]
  }
  const html = formatResultData({ apiResult: api })
  const list = buildChartListFrom({ apiResult: api })

  it('C1 表格仍是 1001 透视 + 各码交叉表', () => {
    expect(html).toContain('到访人口数')
    expect(html).toContain('消费力指数')
    expect(html).toContain('收入预测')
    expect(html).toContain('月驻留1次')
  })

  it('C2 图表清单与设计一致：1001×4 + 1009×2 + 1015×3 + 1007×1', () => {
    const ids = list.map((c) => c.chartKey)
    expect(ids.filter((k) => k.startsWith('1001-'))).toHaveLength(4)
    expect(ids.filter((k) => k.startsWith('1009-'))).toHaveLength(2)
    expect(ids.filter((k) => k.startsWith('1015-'))).toHaveLength(3)
    expect(ids).toContain('1007')
  })

  it('C3 普通记录没有 compatData/importBars（仍走原 apiResult 取数）', () => {
    expect(list.every((c) => !c.compatData && !c.importBars)).toBe(true)
  })
})

describe('排除表口径', () => {
  it('D1 1002 不在排除表里（表要显示，只是导入记录不出图）', () => {
    expect(excludeServices).not.toContain('1002')
    expect(excludeServices).toContain('1003')
    expect(excludeServices).toContain('1016')
  })
})
