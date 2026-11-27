/**
 * 守卫：导入记录按「报表键名」还原系统标准结构（v1.13.428）
 *
 * 起因（业主 2026-11-27 第二次反馈）：427 把分组改对了，但**版式**仍不是系统设计——
 * 例如「每小时段人口流量」系统里是「24 行 × 5 列交叉表 + 2 张双折线图」，
 * 导入记录却是 96 行「指标名称 / 数值」+ 4 张横条图。
 *
 * 做法：报表 C 列键名自带结构（hour0_12_visit = 工作日 12 点到访），
 * 机械还原成 API 宽表再交给既有渲染。这里只测「转换结果对不对」，
 * 版式由 `formatArrayData` / `buildChartOption` 保证（源码守卫钉住必须走它们）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const { buildCompatForCode, buildCompatMap, chartsFor } =
  await import('../../frontend/src/utils/reportRows.js')

const row = (code, key, label, value) => ({ code, key, label, value, group: '' })

/** 生成 1005 的 96 行（工作日/周末 × 24 小时 × 到访/全量） */
const build1005Rows = () => {
  const out = []
  for (let day = 0; day <= 1; day++) {
    for (let h = 0; h < 24; h++) {
      out.push(row('1005', `hour${day}_${h}_visit`, `${h}-${h + 1}点小时到访人次`, 1000 + day * 100 + h))
      out.push(row('1005', `hour${day}_${h}_all`, `${h}-${h + 1}点小时全量人次`, 2000 + day * 100 + h))
    }
  }
  return out
}

/** 生成矩阵类码的行：pop 0/1/2 × level min..max */
const buildMatrixRows = (code, prefix, min, max) => {
  const out = []
  for (let pop = 0; pop <= 2; pop++) {
    for (let n = min; n <= max; n++) {
      out.push(row(code, `${prefix}${pop}_${n}`, `${['到访', '居住', '工作'][pop]}档位${n}`, pop * 1000 + n))
    }
  }
  return out
}

describe('1005 每小时段人口流量：还原成 24×2 的宽表', () => {
  const data = buildCompatForCode('1005', build1005Rows())

  it('A1 48 条（工作日/周末 × 24 小时），按 day_type、hour_period 升序', () => {
    expect(data.code).toBe('1005')
    expect(data.data).toHaveLength(48)
    expect(data.data[0]).toMatchObject({ day_type: 0, hour_period: 0 })
    expect(data.data[23]).toMatchObject({ day_type: 0, hour_period: 23 })
    expect(data.data[24]).toMatchObject({ day_type: 1, hour_period: 0 })
  })

  it('A2 到访与全量落在各自字段，不再拼成「0-1点工作日小时到访人次」', () => {
    const h12w = data.data.find((d) => d.day_type === 0 && d.hour_period === 12)
    expect(h12w).toEqual({ day_type: 0, hour_period: 12, hour_visit: 1012, hour_all: 2012 })
  })

  it('A3 只有 visit 行时 all 补 0（不臆造数值）', () => {
    const only = build1005Rows().filter((r) => r.key.endsWith('_visit'))
    const d = buildCompatForCode('1005', only)
    expect(d.data[0].hour_visit).toBe(1000)
    expect(d.data[0].hour_all).toBe(0)
  })

  it('A4 键名大小写不敏感', () => {
    const d = buildCompatForCode('1005', [row('1005', 'HOUR0_9_VISIT', '9点', 88)])
    expect(d.data.find((x) => x.hour_period === 9).hour_visit).toBe(88)
  })

  it('A5 图与系统设计一致：2 张（到访 / 全量）', () => {
    expect(chartsFor('1005', data.data)).toEqual([
      { serviceCode: '1005', chartKey: '1005-a', title: '每小时段流量 - 到访' },
      { serviceCode: '1005', chartKey: '1005-b', title: '每小时段流量 - 全量' }
    ])
  })

  it('A6 认不出 hour 键 ⇒ 返回 null（调用方退回长表，不许错版）', () => {
    expect(buildCompatForCode('1005', [row('1005', 'foo_bar', '随便', 1)])).toBeNull()
  })
})

describe('1009 消费水平：还原成 spendpower 交叉表', () => {
  const d = buildCompatForCode('1009', buildMatrixRows('1009', 'spendpower', 1, 8))

  it('B1 3 个人群 × 8 档 = 24 条，spendpower 为字符串（与 API 同口径）', () => {
    expect(d.code).toBe('1009')
    expect(d.data).toHaveLength(24)
    expect(d.data[0]).toEqual({ popu_type: 0, spendpower: '1', spendpower_value: 1 })
    expect(d.data[23]).toEqual({ popu_type: 2, spendpower: '8', spendpower_value: 2008 })
  })

  it('B2 缺档位补 0，保证表里 8 档齐全', () => {
    const sparse = [row('1009', 'spendpower0_1', '到访消费力指数1', 5)]
    const r = buildCompatForCode('1009', sparse)
    expect(r.data).toHaveLength(8)
    expect(r.data.map((x) => x.spendpower)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(r.data[7].spendpower_value).toBe(0)
  })

  it('B3 图与系统一致：居住+工作、到访', () => {
    expect(chartsFor('1009', d.data).map((c) => c.chartKey)).toEqual(['1009-a', '1009-b'])
  })
})

describe('1010 / 1011：交叉表所需字段齐备', () => {
  it('C1 1010 带 fname 且 p0..p4 齐全（否则会掉进默认数组表印英文键）', () => {
    const d = buildCompatForCode('1010', buildMatrixRows('1010', 'edu', 0, 4))
    expect(d.code).toBe('1010')
    expect(d.data).toHaveLength(3)
    expect(d.data[0]).toMatchObject({ popu_type: 0, fname: '学历', p0: 0, p4: 4 })
    expect(chartsFor('1010', d.data).map((c) => c.chartKey)).toEqual(['1010-a', '1010-b'])
  })

  it('C2 1011 补到 p1..p10（行业表分支要求 p10 存在）', () => {
    const d = buildCompatForCode('1011', buildMatrixRows('1011', 'job', 1, 10))
    expect(d.data[0].p1).toBe(1)
    expect(d.data[0].p10).toBe(10)
    expect(chartsFor('1011', d.data).map((c) => c.chartKey)).toEqual(['1011-a', '1011-b'])
  })
})

describe('1012 / 1013 / 1014', () => {
  it('D1 1012 人生阶段：3 条 × p1..p3 + 1 张图', () => {
    const d = buildCompatForCode('1012', buildMatrixRows('1012', 'child', 1, 3))
    expect(d.data).toHaveLength(3)
    expect(d.data[0]).toMatchObject({ popu_type: 0, p1: 1, p2: 2, p3: 3 })
    expect(chartsFor('1012', d.data)).toHaveLength(1)
  })

  it('D2 1013 综合消费能力：p1..p3', () => {
    const d = buildCompatForCode('1013', buildMatrixRows('1013', 'consume', 1, 3))
    expect(d.data[0]).toMatchObject({ popu_type: 0, p1: 1, p2: 2, p3: 3 })
    expect(chartsFor('1013', d.data)).toHaveLength(1)
  })

  it('D3 1014 网购能力：p1..p5，但设计里 1014 的图是隐藏的 ⇒ 0 张', () => {
    const d = buildCompatForCode('1014', buildMatrixRows('1014', 'cnsmablt', 1, 5))
    expect(d.data[0]).toMatchObject({ popu_type: 0, p5: 5 })
    expect(chartsFor('1014', d.data)).toEqual([])
  })
})

describe('1015 资产预测：收入/有车/有房按 fname 分组', () => {
  const rows = [
    ...buildMatrixRows('1015', 'income', 1, 5),
    ...buildMatrixRows('1015', 'car', 1, 5),
    ...buildMatrixRows('1015', 'house', 1, 5)
  ]
  const d = buildCompatForCode('1015', rows)

  it('E1 3 个 fname × 3 个人群 = 9 条，fname 用系统认得的三个名字', () => {
    expect(d.data).toHaveLength(9)
    expect([...new Set(d.data.map((x) => x.fname))]).toEqual(['收入预测', '有车预测', '有房预测'])
    expect(d.data[0]).toMatchObject({ popu_type: 0, fname: '收入预测', p1: 1, p5: 5 })
  })

  it('E2 图与系统一致：到访 / 居住 / 工作 三张', () => {
    expect(chartsFor('1015', d.data).map((c) => c.chartKey)).toEqual(['1015-a', '1015-b', '1015-c'])
  })

  it('E3 老导出把三种资产拆到 1014/1015/1016 ⇒ 合并成一段 1015', () => {
    const split = [
      ...buildMatrixRows('1014', 'income', 1, 5),
      ...buildMatrixRows('1015', 'car', 1, 5)
    ]
    const map = buildCompatMap(split)
    expect(map).toHaveLength(1)
    expect(map[0].code).toBe('1015')
    expect(map[0].sources).toEqual(['1014', '1015'])
    expect([...new Set(map[0].data.map((x) => x.fname))]).toEqual(['收入预测', '有车预测'])
  })
})

describe('1007 每月到达次数 / 1006 每日流量', () => {
  it('F1 1007 收成一条 reach1..5，配 1 张图', () => {
    const rows = [1, 2, 3, 4, 5].map((n) => row('1007', `reach${n}`, `月驻留${n}`, n * 10))
    const d = buildCompatForCode('1007', rows)
    expect(d.data).toEqual([{ reach1: 10, reach2: 20, reach3: 30, reach4: 40, reach5: 50 }])
    expect(chartsFor('1007', d.data)).toHaveLength(1)
  })

  it('F2 1006 只出「日均值」一张图：报表没有逐日数据，月度累计会算错', () => {
    const rows = [
      row('1006', 'day_visit', '每日到访人次（月均）', 44728),
      row('1006', 'day_all', '每日出现总人次（月均）', 74621),
      row('1006', 'stay1', '驻留小于1小时人次（月均）', 22567)
    ]
    const d = buildCompatForCode('1006', rows)
    expect(d.data).toHaveLength(1)
    expect(d.data[0]).toMatchObject({ day_visit: 44728, day_all: 74621, stay1: 22567 })
    expect(chartsFor('1006', d.data).map((c) => c.chartKey)).toEqual(['1006-a'])
  })

  it('F3 1006 兼容另一种导出版本：day_avg_visit / stay_30 …', () => {
    const rows = [
      row('1006', 'day_avg_visit', '日均到访人次', 21045),
      row('1006', 'day_avg_total', '日均全量人次', 36568),
      row('1006', 'stay_30', '停留<30分钟', 7851),
      row('1006', 'stay_480', '停留4-8小时', 9074)
    ]
    const d = buildCompatForCode('1006', rows)
    expect(d.data[0]).toMatchObject({
      day_visit: 21045, day_all: 36568, stay1: 7851, stay5: 9074
    })
  })
})

describe('1002 上网标签：标签名取报表 D 列', () => {
  it('G1 去掉人群前缀与结尾「人数」', () => {
    const rows = [
      row('1002', 'webtag0_1', '到访网上购物标签人数', 378195),
      row('1002', 'webtag1_1', '居住网上购物标签人数', 1200)
    ]
    const d = buildCompatForCode('1002', rows)
    expect(d.data[0]).toEqual({ popu_type: 0, tag_name: '网上购物标签', tag_value: 378195 })
    expect(d.data[1]).toEqual({ popu_type: 1, tag_name: '网上购物标签', tag_value: 1200 })
    expect(chartsFor('1002', d.data).map((c) => c.chartKey)).toEqual(['1002-a', '1002-b'])
  })
})

describe('兜底与边界', () => {
  it('H1 未知码 / 混了两种前缀 ⇒ null，调用方走中文长表', () => {
    expect(buildCompatForCode('9999', [row('9999', 'foo', '随便', 1)])).toBeNull()
    const mixed = [
      row('1009', 'spendpower0_1', 'a', 1),
      row('1009', 'edu0_1', 'b', 2)
    ]
    expect(buildCompatForCode('1009', mixed)).toBeNull()
  })

  it('H2 空值行不参与（不把 null 当 0）', () => {
    expect(buildCompatForCode('1005', [row('1005', 'hour0_1_visit', 'x', null)])).toBeNull()
  })

  it('H3 buildCompatMap 跳过排除码', () => {
    const rows = [...build1005Rows(), ...buildMatrixRows('1016', 'house', 1, 5)]
    const map = buildCompatMap(rows, ['1016'])
    expect(map.map((m) => m.code)).toEqual(['1005'])
  })

  it('H4 表与图共用同一份数据（不各算一套）', () => {
    const map = buildCompatMap(build1005Rows())
    expect(map[0].charts).toHaveLength(2)
    expect(map[0].charts.every((c) => c.serviceCode === '1005')).toBe(true)
  })
})

describe('源码守卫：两处共用同一套渲染（v1.13.429 抽成共享模块）', () => {
  const VIEW = read('frontend/src/views/MyAccountView.vue')
  const HTML = read('frontend/src/utils/purchaseResultHtml.js')
  const CHARTS = read('frontend/src/utils/purchaseCharts.js')
  const STORE = read('frontend/src/components/StoreSmartstepsDialog.vue')

  it('I1 左栏：导入分支先取 buildCompatMap，命中即调 formatArrayData', () => {
    const start = HTML.indexOf('const formatReportRows')
    const seg = HTML.slice(start, HTML.indexOf('const formatResultData', start))
    expect(seg).toContain('buildCompatMap(rows, excludeServices)')
    expect(seg).toContain('formatArrayData(compat.data, compat.code)')
    expect(seg).toContain('getServiceName(compat.code)')
  })

  it('I2 右栏：标准结构的图带 compatData，初始化时走 buildChartOption', () => {
    expect(CHARTS).toContain('compatData: compat.data')
    const start = VIEW.indexOf('const initAllCharts')
    const seg = VIEW.slice(start, VIEW.indexOf('// 提炼联通数据摘要', start))
    expect(seg).toContain('buildChartOption(item.serviceCode, item.compatData, item.chartKey)')
    expect(seg).toContain('buildImportBarOption(item)')
  })

  it('I3 导入分支仍保留中文长表兜底（认不出的码不能整段消失）', () => {
    expect(HTML).toContain('splitReportBlocks(codeRows)')
  })

  it('I4 不许再给 1006 出「月度累计」图（报表没有逐日数据）', () => {
    const start = CHARTS.indexOf('const buildImportChartList')
    const seg = CHARTS.slice(start, CHARTS.indexOf('const buildImportBarOption', start))
    expect(seg).not.toContain('1006-b')
  })

  it('I5 两处必须 import 同一份：不许在视图/门店弹窗里各写一套渲染器', () => {
    expect(VIEW).toContain("from '@/utils/purchaseResultHtml'")
    expect(VIEW).toContain("from '@/utils/purchaseCharts'")
    expect(STORE).toContain("from '@/utils/purchaseResultHtml'")
    expect(STORE).toContain("from '@/utils/purchaseCharts'")
    expect(VIEW).not.toContain('const formatArrayData')
    expect(STORE).not.toContain('function formatArrayData')
    expect(STORE).not.toContain('function formatResultData')
  })

  it('I6 门店「已购报表」必须是左表＋右图（与购买履历同款），并初始化图表', () => {
    expect(STORE).toContain('result-two-col')
    expect(STORE).toContain('chartList.value = buildChartListFrom(data.result_data)')
    expect(STORE).toContain('buildChartOption(item.serviceCode, item.compatData, item.chartKey)')
    expect(STORE).toContain('class="result-charts"')
  })
})

describe('导入记录 1002 图表明细（业主 2026-11-27 追加）', () => {
  const CHARTS = read('frontend/src/utils/purchaseCharts.js')
  const HTML = read('frontend/src/utils/purchaseResultHtml.js')

  it('J1 设计基准不变：普通记录的 1002 仍是 3 张图（到访/居住/工作）', () => {
    const rows = [0, 1, 2].flatMap((p) => ([
      { code: '1002', key: `webtag${p}_1`, label: `${['到访', '居住', '工作'][p]}网上购物标签人数`, value: 100 + p, group: '' }
    ]))
    const d = buildCompatForCode('1002', rows)
    expect(chartsFor('1002', d.data).map((c) => c.chartKey)).toEqual(['1002-a', '1002-b', '1002-c'])
  })

  it('J2 导入记录：右栏跳过 1002，但左栏表照常保留', () => {
    const start = CHARTS.indexOf('// 导入记录不出图的码')
    const seg = CHARTS.slice(start, CHARTS.indexOf('const buildImportBarOption', start))
    expect(seg).toContain("const IMPORT_NO_CHART_CODES = ['1002']")
    expect(seg).toContain('if (IMPORT_NO_CHART_CODES.includes(ch.serviceCode)) continue')
    // 跳过只发生在图循环里；表格那一侧（formatReportRows）不受影响
    const fmt = HTML.slice(HTML.indexOf('const formatReportRows'), HTML.indexOf('const formatResultData'))
    expect(fmt).not.toContain('IMPORT_NO_CHART_CODES')
  })
})
