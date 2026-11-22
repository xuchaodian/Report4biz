/**
 * 立项报告「选址研判指标」守卫 —— v1.13.400
 *
 * 业主 2026-11-22 定的两句话：
 *   ① 「购买联通人口后可以在『购买履历』里查看详细的联通人口所有标签，
 *      所以在『生成立项报告』里可以把这些丰富的联通人口字段浓缩成适合选址研判的指标」；
 *   ② 「需要查看所有标签时再点击跳转打开」。
 *
 * 落地形态：
 *   · 纸面从 44 行逐档比例条（387）改成 8~9 行研判指标；
 *   · 逐档明细留在「购买履历」，纸面给一个「查看全部标签」跳转（纸外，⛔ 不在纸内）；
 *   · 1001 里一直买回来却没解析的 P3/P4/P5（外省到访 / 娱乐 / 居住工作重合）本次补上。
 *
 * 本文件钉六件事：
 *   A. 派生的每一行都必须对得上原始字段（⛔ 自创分母）
 *   B. 缺数据不产出 —— ⛔ 不填 0、⛔ 不写 0.0%（会被读成「确实是 0」）
 *   C. 上游口径异常时降级为量级，⛔ 不出「外省到访占 132%」这种假比例
 *   D. 话费高段口径与后端评分 `arpuHighPct` 逐位一致（同一件事不许两套数）
 *   E. 76 这个数字必须等于 field_labels 里 1001 的实际条数（防标签表一改纸面就说错）
 *   F. 版式：比例条已撤、指标表在纸内、跳转入口在纸外
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReportModel, buildPopulationIndicators, POP_LABEL_TOTAL } from '../../frontend/src/utils/candidateReport.js'
import { parsePopulation1001, AGE_GROUPS, ARPU_GROUPS } from '../src/utils/unicomPopulation.js'
import { arpuHighPct } from '../src/utils/siteScore.js'
import { FIELD_LABELS } from '../../frontend/src/views/field_labels.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const PAPER = read('frontend/src/components/ReportPaper.vue')
const COMP = read('frontend/src/components/CandidateReport.vue')
const PAPER_TPL = PAPER.slice(0, PAPER.indexOf('<script setup>'))
const COMP_TPL = COMP.slice(0, COMP.indexOf('<script setup>'))

const cand = {
  name: '五角场万达 3F 中庭', brand: '食其家', city: '上海', district: '杨浦区',
  address: '邯郸路 600 号', latitude: 31.30, longitude: 121.51, radius: 1000,
  area: 120, rent: 45000
}

/**
 * 一份「算术干净」的 1001 原始响应，便于逐项手算核对：
 *   P0 到访 100000 / P1 居住 20000 / P2 工作 16000 / P3 外省 12000
 *   P4 娱乐 3000 / P5 重合 4000 / 男 9800 / 女 10200
 *   age1 十五档合计 20000，前四档各 1000（0-18 岁），30-34 档 3000 最高
 *   arpu1 六档 [2000,2000,2000,4000,4000,4000] 合计 18000，高段 12000
 */
function raw1001() {
  const d = {
    p0_sum: 100000, p1_sum: 20000, p2_sum: 16000,
    p3_sum: 12000, p4_sum: 3000, p5_sum: 4000,
    male1_sum: 9800, female1_sum: 10200,
    male0_sum: 40000, female0_sum: 60000,
    male2_sum: 8000, female2_sum: 8000,
    pall_sum: 90000
  }
  const ageVals = [1000, 1000, 1000, 1000, 2500, 2500, 3000, 2500, 2000, 1500, 1000, 700, 500, 300, 500]
  AGE_GROUPS.forEach(([, code], i) => {
    d[`age1_${code}`] = ageVals[i]
    d[`age0_${code}`] = 100 + i
    d[`age2_${code}`] = 50 + i
  })
  const arpuVals = [2000, 2000, 2000, 4000, 4000, 4000]
  ARPU_GROUPS.forEach(([, sfx], i) => {
    d[`arpu1_${sfx}`] = arpuVals[i]
    d[`arpu0_${sfx}`] = 10 + i
    d[`arpu2_${sfx}`] = 20 + i
  })
  return d
}
const popOf = (dict = raw1001()) => parsePopulation1001({ '1001': dict })
const byKey = (list) => Object.fromEntries(list.map((x) => [x.key, x]))

describe('A. 1001 补齐 P3/P4/P5（一直买回来却从没解析过的三个字段）', () => {
  it('★ 外省到访 / 娱乐 / 居住工作重合都能解析出来', () => {
    const p = popOf()
    expect(p.outProvince).toBe(12000)
    expect(p.entertain).toBe(3000)
    expect(p.liveWorkOverlap).toBe(4000)
  })

  it('🔴 字段缺失必须是 null，⛔ 不能是 0（0 会被读成「确实 0 人」）', () => {
    const d = raw1001()
    delete d.p3_sum
    delete d.p4_sum
    delete d.p5_sum
    const p = popOf(d)
    expect(p.outProvince).toBeNull()
    expect(p.entertain).toBeNull()
    expect(p.liveWorkOverlap).toBeNull()
  })

  it('字段存在且为 0 ⇒ 保留 0（有效值，不是缺失）', () => {
    const d = raw1001()
    d.p3_sum = 0
    d.p5_sum = 0
    const p = popOf(d)
    expect(p.outProvince).toBe(0)
    expect(p.liveWorkOverlap).toBe(0)
  })
})

describe('B. 指标派生对得上原始字段', () => {
  const ind = () => byKey(buildPopulationIndicators(popOf()))

  it('★ 八项主力指标全部产出', () => {
    const k = Object.keys(ind())
    for (const key of ['workLive', 'visitIntensity', 'outProvince', 'liveWorkOverlap',
      'family', 'mainAge', 'highArpu', 'gender', 'entertain']) {
      expect(k, `缺少指标 ${key}`).toContain(key)
    }
  })

  it('职住结构 = 工作 ÷ 居住（16000/20000 = 0.80 倍 ⇒ 职住均衡）', () => {
    expect(ind().workLive.value).toBe('0.80 倍')
    expect(ind().workLive.note).toContain('职住均衡')
  })

  it('到访强度 = 到访人次 ÷ 居住（100000/20000 = 5.0 倍）', () => {
    expect(ind().visitIntensity.value).toBe('5.0 倍')
    expect(ind().visitIntensity.note).toContain('人次')
  })

  it('外省到访占比 = P3 ÷ P0（12000/100000 = 12.0%）', () => {
    expect(ind().outProvince.value).toBe('12.0%')
  })

  it('职住一体度 = P5 ÷ P1（4000/20000 = 20.0%）', () => {
    expect(ind().liveWorkOverlap.value).toBe('20.0%')
  })

  it('家庭客群占比 = 居住 0-18 岁四档 ÷ 居住（4000/20000 = 20.0%）', () => {
    expect(ind().family.value).toBe('20.0%')
    expect(ind().family.note).toContain('0-18 岁')
  })

  it('主力年龄 = 居住人口占比最高的一段（30-34 岁 15.0%）', () => {
    expect(ind().mainAge.value).toBe('30-34岁 · 15.0%')
  })

  it('高话费占比 = 居住话费后三档 ÷ 全部（12000/18000 = 66.7%）', () => {
    expect(ind().highArpu.value).toBe('66.7%')
    expect(ind().highArpu.note).toContain('不是客单价')
  })

  it('居住性别比 = 男 9800 / 女 10200 ⇒ 49.0% / 51.0%', () => {
    expect(ind().gender.value).toBe('男 49.0% · 女 51.0%')
  })

  it('娱乐人数只做量级，⛔ 不折算比例', () => {
    expect(ind().entertain.value).toBe('3,000 人')
    expect(ind().entertain.value).not.toContain('%')
    expect(ind().entertain.note).toContain('不与到访人次折算比例')
  })
})

describe('C. 缺数据不产出（⛔ 不填 0 / ⛔ 不写 0.0%）', () => {
  it('没有人口数据 ⇒ 空数组（纸面整块不渲染）', () => {
    expect(buildPopulationIndicators(null)).toEqual([])
    expect(buildPopulationIndicators({})).toEqual([])
  })

  it('只有总量、没有任何分档 ⇒ 只产出能算的那几项，⛔ 不出现 0.0%', () => {
    const list = buildPopulationIndicators({ live: 1000, work: 500, visit: 8000 })
    const text = JSON.stringify(list)
    expect(text).not.toContain('0.0%')
    expect(text).not.toContain('NaN')
    expect(text).not.toContain('null')
    // 职住 / 到访强度能算；家庭、主力年龄、高话费、性别算不出 ⇒ 不得出现
    const k = list.map((x) => x.key)
    expect(k).toContain('workLive')
    expect(k).toContain('visitIntensity')
    expect(k).not.toContain('family')
    expect(k).not.toContain('mainAge')
    expect(k).not.toContain('highArpu')
    expect(k).not.toContain('gender')
  })

  it('居住为 0 ⇒ 所有以居住为分母的指标一律不产出（⛔ Infinity）', () => {
    const d = raw1001()
    d.p1_sum = 0
    const list = buildPopulationIndicators(popOf(d))
    const text = JSON.stringify(list)
    expect(text).not.toContain('Infinity')
    expect(list.map((x) => x.key)).not.toContain('workLive')
    expect(list.map((x) => x.key)).not.toContain('family')
  })
})

describe('D. 上游口径异常时降级为量级（⛔ 不出假比例）', () => {
  it('P3 > P0 ⇒ 不产出百分比，改展示人数并说明口径不可比', () => {
    const d = raw1001()
    d.p3_sum = 130000          // 比到访人次还多，明显不是子集
    const it = byKey(buildPopulationIndicators(popOf(d))).outProvince
    expect(it.value).toContain('人')
    expect(it.value).not.toContain('%')
    expect(it.note).toContain('不折算占比')
  })

  it('P5 > P1 ⇒ 同样降级，⛔ 不写「重合占 200%」', () => {
    const d = raw1001()
    d.p5_sum = 40000
    const it = byKey(buildPopulationIndicators(popOf(d))).liveWorkOverlap
    expect(it.value).toContain('人')
    expect(it.value).not.toContain('%')
  })
})

describe('E. 与既有口径必须同值（同一件事不许两套数）', () => {
  it('🔴 高话费占比与后端评分 arpuHighPct 一致到 0.1%', () => {
    const pop = popOf()
    const mine = Number(byKey(buildPopulationIndicators(pop)).highArpu.value.replace('%', ''))
    const theirs = arpuHighPct(pop)       // 0~100，一位小数
    expect(mine).toBeCloseTo(theirs, 1)
  })

  it('🔴 POP_LABEL_TOTAL 必须等于 field_labels 里 1001 的实际条数', () => {
    const actual = Object.keys(FIELD_LABELS['1001']).length
    expect(POP_LABEL_TOTAL, `纸面写的是 ${POP_LABEL_TOTAL}，标签表实际 ${actual} 项`).toBe(actual)
  })
})

describe('F. 纸面文案只陈述事实（⛔ 预测 / ⛔ 批注符号）', () => {
  const all = () => {
    const m = buildReportModel(cand, { district: null }, { population: popOf(), popRadius: 1000 })
    return [...m.population.indicators.flatMap((x) => [x.label, x.value, x.note])].join('\n')
  }

  it('不许出现预测 / 营业额 / 客流预估类词', () => {
    const t = all()
    for (const bad of ['预计', '预测', '日销', '月销', '翻台', '坪效预估', '客流量预计']) {
      expect(t, `指标出现「${bad}」`).not.toContain(bad)
    }
  })

  it('不许出现给开发看的批注符号（这份纸是外发文档）', () => {
    const t = all() + PAPER_TPL.replace(/<!--[\s\S]*?-->/g, '')
    for (const bad of ['⛔', '🔴', '⚠️', '✅']) {
      expect(t, `出现了批注符号「${bad}」`).not.toContain(bad)
    }
  })

  it('buildReportModel 必须把指标与标签总数一起交给纸面', () => {
    const m = buildReportModel(cand, { district: null }, { population: popOf(), popRadius: 1000 })
    expect(Array.isArray(m.population.indicators)).toBe(true)
    expect(m.population.indicators.length).toBeGreaterThanOrEqual(8)
    expect(m.population.labelTotal).toBe(POP_LABEL_TOTAL)
  })
})

describe('G. 版式：比例条已撤、指标表在纸内、跳转入口在纸外', () => {
  it('🔴 387 的 44 行逐档比例条必须撤掉（业主 11-22 改口：明细去履历看）', () => {
    expect(PAPER_TPL).not.toContain('rp-pop-cols')
    expect(PAPER_TPL).not.toContain('rp-pb-row')
    expect(PAPER).not.toContain('.rp-pb-track')
    // 36 档年龄/话费的双列块与小结列表也不该再渲染
    expect(PAPER_TPL).not.toContain('rp-pop-sum')
  })

  it('★ 纸内必须是指标表，且标明「只是摘要」；「去哪看明细」由调用方决定', () => {
    expect(PAPER_TPL).toContain('class="rp-ind"')
    expect(PAPER_TPL).toContain('选址研判指标')
    expect(PAPER_TPL).toContain('项标签')
    // 🔴 纸面是共用组件：匿名分享页传空 hint —— 访客没有购买履历，⛔ 不能写死文案
    expect(PAPER).toContain('detailHint')
    expect(COMP).toContain('detail-hint="完整清单见购买履历"')
  })

  it('🔴 分享页（匿名）不许承诺「见购买履历」—— 访客没有账号', () => {
    const SHARED = read('frontend/src/views/SharedReportView.vue')
    expect(SHARED).toContain('<ReportPaper')
    // 分享页不得传 detail-hint（传了就是在纸上承诺他打不开的东西）
    expect(SHARED).not.toContain('detail-hint')
    expect(SHARED).not.toContain('完整清单见购买履历')
  })

  it('量级四栏仍在（领导先看数，再看指标）', () => {
    expect(PAPER_TPL).toContain('rp-kv-4')
    expect(PAPER_TPL).toContain('联通全量人口')
  })

  it('🔴 纸面组件里不许出现路由跳转（392 的免登录分享页要复用它）', () => {
    expect(PAPER).not.toContain('useRouter')
    expect(PAPER).not.toContain('router.push')
    expect(PAPER).not.toContain("path: '/account'")
  })

  it('★ 「查看全部标签」在纸外取数条里，且带 purchase=<id> 精确跳转', () => {
    expect(COMP_TPL).toContain('查看全部标签')
    // 必须在 rp-popbar 段内（纸外），不能在 rp-scroll 里的纸面组件上
    const barStart = COMP_TPL.indexOf('class="rp-popbar"')
    const barEnd = COMP_TPL.indexOf('class="rp-cat"')
    expect(barStart).toBeGreaterThan(-1)
    expect(barEnd).toBeGreaterThan(barStart)
    const bar = COMP_TPL.slice(barStart, barEnd > barStart ? barEnd : barStart + 3000)
    expect(bar).toContain('查看全部标签')
    expect(COMP).toContain("path: '/account'")
    expect(COMP).toContain('purchase: String(id)')
  })

  it('入口只在拿到 purchaseId 时出现（⛔ 没取数就跳过去看空页）', () => {
    expect(COMP_TPL).toMatch(/v-if="popData && popPurchaseId"/)
  })
})

describe('H. 履历页按 id 精确打开（⛔ 按门店名会命中同名多条）', () => {
  const ACC = read('frontend/src/views/MyAccountView.vue')

  it('支持 purchase 查询参数并优先于 storeName', () => {
    expect(ACC).toContain('route.query.purchase')
    const i = ACC.indexOf('const purchaseParam = route.query.purchase')
    expect(i).toBeGreaterThan(-1)
    const seg = ACC.slice(i, i + 900)
    expect(seg).toContain('viewPurchaseDetail')
    expect(seg.indexOf('purchaseParam')).toBeLessThan(seg.indexOf('storeName'))
  })

  it('列表里找不到该 id 时也要按 id 打开详情（集团可见域/翻页场景）', () => {
    const i = ACC.indexOf('const purchaseParam = route.query.purchase')
    const seg = ACC.slice(i, i + 900)
    expect(seg).toMatch(/hit \|\| \{ id: idNum \}/)
  })
})
