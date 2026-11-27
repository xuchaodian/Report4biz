/**
 * 守卫：联通 Excel 导入记录的「详情渲染」——按报表自带中文，不猜结构（v1.13.427）
 *
 * 起因（业主 2026-11-27，youshi 账号导入后）：
 *   「查询结果详情」弹窗里除 1001 外全乱：
 *     · 分组标题变成来源不明的合计（「居住人口 1,399」其实是 3 个人的消费指数之和）
 *     · 行名被拼成「消费力指数1_到访 / 消费力指数1_居住」
 *     · 右栏一堆「有标题、画不出图形」的空图框
 *   根因：Excel 是**长表 + 自带中文**（A 码 / B 分类 / C 字段名 / D 字段含义 / E 数量），
 *   导入器只留了 A、C、E，把 B、D 整列丢掉；而详情渲染是按联通 API 的宽表
 *   （数组 + popu_type + p1..pN）写的，结构对不上就退化成"猜格式"。
 *
 * 两类用例：
 *   【运行时】真 import `utils/reportRows.js` 跑切块逻辑（这才是错的地方）；
 *   【源码】钉住后端保留 B/D、落库带 reportRows、前端走中文分支且不回退到猜格式。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const {
  POP_TYPES, splitPopLabel, cleanGroupTitle, shortBlockTitle, splitReportBlocks, groupRowsByCode
} = await import('../../frontend/src/utils/reportRows.js')

const tmpDb = path.join(os.tmpdir(), `r4b-report-rows-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4b-report-rows-xlsx-'))

let getDb, parseReportFile, db, seq = 0

/**
 * 造一份「和外部系统同构」的报表：
 *   第 1 行标题行（A1 标题 / C1 半径 / E1 月份）
 *   第 2 行表头：请求编码 / 分类 / 字段名 / 字段含义 / 数量
 *   第 3 行起数据；A 与 B 都是纵向合并（后续行为空，靠 fill-down）
 * 规格：rows = [[code, group, key, label, value], ...]
 */
function makeXlsx(rows, opts = {}) {
  const { radius = '500米', month = '202606', e21 = '周浦新田360广场店' } = opts
  const wb = XLSX.utils.book_new()
  const cover = XLSX.utils.aoa_to_sheet([['']])
  cover['E21'] = { t: 's', v: e21 }
  cover['!ref'] = 'A1:E21'
  XLSX.utils.book_append_sheet(wb, cover, '封面')

  const aoa = [['商圈数据一览', '半径：', radius, '数据时间：', month], ['请求编码', '分类', '字段名', '字段含义', '数量']]
  for (const r of rows) aoa.push([r[0], r[1], r[2], r[3], r[4] == null ? null : r[4]])
  const ds = XLSX.utils.aoa_to_sheet(aoa)
  XLSX.utils.book_append_sheet(wb, ds, '商圈数据')
  const p = path.join(tmpDir, `r${++seq}.xlsx`)
  XLSX.writeFile(wb, p)
  return p
}

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  const routeMod = await import('../src/routes/purchase-import.js')
  parseReportFile = routeMod.parseReportFile
  db = getDb()
})

afterAll(() => {
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

describe('A. 切块：按报表「分类 + 中文含义」分组', () => {
  it('A1 人群前缀成规模（≥2 种且无杂项）⇒ 一个分类拆成 到访/居住/工作 三块', () => {
    const blocks = splitReportBlocks([
      { group: '消费水平', label: '到访消费力指数1(最低)', value: 12015 },
      { group: '消费水平', label: '到访消费力指数2', value: 80035 },
      { group: '消费水平', label: '居住消费力指数1(最低)', value: 880 },
      { group: '消费水平', label: '工作消费力指数1(最低)', value: 299 }
    ])
    expect(blocks.map((b) => b.title)).toEqual(['到访人口', '居住人口', '工作人口'])
    expect(blocks[0].items[0]).toEqual({ label: '消费力指数1(最低)', value: 12015 })
    // 🔴 行名里不许再带「到访」——那是分组信息，重复出现就是业主看到的"拼接名"
    expect(blocks[0].items.map((i) => i.label)).toEqual(['消费力指数1(最低)', '消费力指数2'])
  })

  it('A2 人群词在句中/句尾（1005 时段、1007 括号）⇒ 不拆，保持原分类与中文名', () => {
    const blocks = splitReportBlocks([
      { group: '每小时段人口流量 工作日到访', label: '0-1点工作日小时到访人次', value: 8697 },
      { group: '每小时段人口流量 工作日到访', label: '1-2点工作日小时到访人次', value: 8665 },
      { group: '每月到达次数分布', label: '月驻留次数为1次的人数(到访)', value: 148854 }
    ])
    expect(blocks.map((b) => b.title)).toEqual(['每小时段人口流量 工作日到访', '每月到达次数分布'])
    expect(blocks[0].items[0].label).toBe('0-1点工作日小时到访人次')
  })

  it('A3 只有一种人群词 ⇒ 不拆（避免整段只剩「到访人口」一块，白丢分类名）', () => {
    const blocks = splitReportBlocks([
      { group: '有房预测_到访', label: '到访有房预测概率高人数', value: 10435 },
      { group: '有房预测_到访', label: '到访有房预测概率中高人数', value: 38517 }
    ])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].title).toBe('有房预测_到访')
    expect(blocks[0].items[0].label).toBe('到访有房预测概率高人数')
  })

  it('🔴 A4 报表没给值的行直接丢掉：整码无值 ⇒ 空数组（不出空表 / 空图框）', () => {
    const blocks = splitReportBlocks([
      { group: '上网标签分布', label: '到访网上购物标签人数', value: null },
      { group: '上网标签分布', label: '到访时政要闻标签人数', value: null }
    ])
    expect(blocks).toEqual([])
  })

  it('A5 分类里的换行要拍平（报表 B 列常写成「每小时段人口流量\\n工作日到访」）', () => {
    const blocks = splitReportBlocks([
      { group: '每小时段人口流量\n工作日到访', label: '0-1点', value: 1 }
    ])
    expect(blocks[0].title).toBe('每小时段人口流量 工作日到访')
    expect(cleanGroupTitle('  人口汇总 \n ')).toBe('人口汇总')
  })

  it('A6 分类缺失 ⇒ 用「报表明细」兜底，不许出现空标题', () => {
    const blocks = splitReportBlocks([{ group: '', label: '到访人口数', value: 5 }])
    expect(blocks[0].title).toBe('报表明细')
  })
})

describe('B. 小工具', () => {
  it('B1 splitPopLabel 只认行首人群词', () => {
    expect(splitPopLabel('到访消费力指数1')).toEqual({ pop: '到访', text: '消费力指数1' })
    expect(splitPopLabel('0-1点工作日小时到访人次')).toEqual({ pop: '', text: '0-1点工作日小时到访人次' })
    expect(splitPopLabel('')).toEqual({ pop: '', text: '' })
    expect(POP_TYPES).toEqual(['到访', '居住', '工作'])
  })

  it('🔴 B2 shortBlockTitle 去掉服务名前缀（否则标题出现「A · A 工作日到访」）', () => {
    expect(shortBlockTitle('每小时段人口流量', '每小时段人口流量 工作日到访')).toBe('工作日到访')
    expect(shortBlockTitle('消费水平（富裕指数）', '消费水平')).toBe('消费水平')
    expect(shortBlockTitle('每日人流量及停留时长', '每日人流量及停留时长')).toBe('每日人流量及停留时长')
  })

  it('B3 groupRowsByCode 保序 + 排除表生效', () => {
    const g = groupRowsByCode([
      { code: '1001', value: 1 }, { code: '1016', value: 2 }, { code: '1001', value: 3 }, { code: '1003', value: 4 }
    ], ['1003'])
    expect(g.map((x) => x.code)).toEqual(['1001', '1016'])
    expect(g[0].rows).toHaveLength(2)
  })
})

describe('C. 后端：报表的 B/D 两列必须留住', () => {
  it('🔴 C1 parseReportFile 带出 reportRows，含 分类/中文含义/数值（含空值行）', () => {
    const p = makeXlsx([
      ['1001', '人口汇总', 'P0_SUM', '到访人口数', 170881],
      [null, null, 'P1_SUM', '居住人口数', 11877],
      [null, '性别结构', 'MALE0_SUM', '到访男性数', 90918],
      ['1002', '上网标签分布', 'WebTag0_1', '到访网上购物标签人数', null]
    ])
    const r = parseReportFile(p, '周浦新田360广场店_0.5km_202606.xlsx')
    expect(r.ok).toBe(true)
    expect(r.reportRows).toHaveLength(4)
    expect(r.reportRows[0]).toEqual({
      code: '1001', group: '人口汇总', key: 'p0_sum', label: '到访人口数', value: 170881
    })
    // B 列纵向合并 ⇒ 第二行靠 fill-down 仍是「人口汇总」
    expect(r.reportRows[1].group).toBe('人口汇总')
    expect(r.reportRows[2].group).toBe('性别结构')
    // 报表没给值的行留在 reportRows 里（value:null），但不进 apiResult
    expect(r.reportRows[3].value).toBeNull()
    expect(r.apiResult['1002']).toBeUndefined()
  })

  it('🔴 C2 换服务码 ⇒ 分类重新累计（不能把上一个码的分类带过去）', () => {
    const p = makeXlsx([
      ['1001', '人口汇总', 'P0_SUM', '到访人口数', 1],
      ['1009', null, 'pop0_p1', '到访消费力指数1', 2]
    ])
    const r = parseReportFile(p, 'x_0.5km_202606.xlsx')
    expect(r.reportRows[1].group).toBe('')
  })

  it('C3 apiResult 口径不变：键小写、去千分位、空值跳过（AI/洞察/评分仍读它）', () => {
    const p = makeXlsx([
      ['1001', '人口汇总', 'P0_SUM', '到访人口数', '170,881'],
      ['1001', '人口汇总', 'P1_SUM', '居住人口数', null]
    ])
    const r = parseReportFile(p, 'x_0.5km_202606.xlsx')
    expect(r.apiResult['1001']).toEqual({ p0_sum: 170881 })
    expect(r.rowCount).toBe(1)
  })
})

describe('D. 源码守卫：前端不许回退到"猜格式"', () => {
  const VIEW = read('frontend/src/views/MyAccountView.vue')
  const UTIL = read('frontend/src/utils/reportRows.js')
  const BACK = read('backend/src/routes/purchase-import.js')
  const strip = (s) => String(s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const VIEW_CODE = strip(VIEW)

  const slice = (src, a, b) => {
    const i = src.indexOf(a)
    expect(i, `找不到标记：${a}`).toBeGreaterThan(-1)
    const j = b ? src.indexOf(b, i) : -1
    return j > i ? src.slice(i, j) : src.slice(i, i + 3000)
  }

  it('D1 后端必须读 B(分类) 与 D(字段含义) 两列', () => {
    expect(BACK).toContain('c: 1')   // B 分类
    expect(BACK).toContain('c: 3')   // D 字段含义
    expect(BACK).toMatch(/reportRows\.push\(/)
  })

  it('D2 落库必须带 reportRows，且 apiResult 原样保留', () => {
    const seg = slice(BACK, 'reportRows: analysis.reportRows || []')
    expect(seg).toContain('reportRows: analysis.reportRows || []')
    expect(BACK).toContain('apiResult: analysis.apiResult')
  })

  it('🔴 D3 详情：有 reportRows 才走中文分支，且 1001 仍走原来的四列透视', () => {
    const seg = slice(VIEW_CODE, 'const formatResultData = (data) => {', 'if (!apiResult || typeof apiResult !==')
    expect(seg).toContain('return formatReportRows(reportRows, apiResult)')
    const fmt = slice(VIEW_CODE, 'const formatReportRows', 'const buildImportChartList')
    expect(fmt).toContain("code === '1001'")
    expect(fmt).toContain('formatP0SData')
    // 走中文分支后不许再调"猜格式"的通用渲染
    expect(fmt).not.toContain('formatOtherData')
  })

  it('🔴 D4 图表：能还原结构的走 compatData（复用系统图表），认不出的才用 importBars 兜底', () => {
    const cl = slice(VIEW_CODE, 'const buildImportChartList', 'const buildImportBarOption')
    expect(cl).toContain('compatData: compat.data')
    expect(cl).toContain('importBars')
    const init = slice(VIEW_CODE, 'const initAllCharts', 'const buildChartOption')
    expect(init).toContain('item.compatData')
    expect(init).toContain('buildChartOption(item.serviceCode, item.compatData, item.chartKey)')
    expect(init).toContain('buildImportBarOption(item)')
    expect(init).toContain('if (!item.compatData && !item.importBars && !rawData) continue')
  })

  it('🔴 D5 label 来自用户 Excel ⇒ 进 v-html 前必须转义', () => {
    expect(VIEW_CODE).toContain('const escHtml')
    const fmt = slice(VIEW_CODE, 'const formatReportRows', 'const buildImportChartList')
    expect(fmt).toContain('escHtml(it.label)')
    expect(fmt).toContain('escHtml(codeName)')
  })

  it('D6 切块算法只许有一份：组件用 util，不许在组件里再写一遍', () => {
    expect(VIEW_CODE).toContain("from '@/utils/reportRows'")
    expect(VIEW_CODE).not.toContain('const splitReportBlocks')
    expect(UTIL).toContain('export function splitReportBlocks')
  })
})
