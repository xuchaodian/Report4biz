/**
 * 立项报告「详细人口画像」守卫 —— v1.13.387
 *
 * 业主 2026-11-20 给这个功能定了位：
 *   ① 「生成分析报告」是**初步分析之后**的判断动作 —— 判断值得往下走，才出这份对外文档，
 *      共享或邮件发给同事与领导；
 *   ② 它必须是「在联通人口基础上的一份详细分析报告，尽可能多用联通人口的丰富数据标签」。
 *
 * 而 386 之前的实情是：1001 一次调用买回来 3 套口径（到访 0 / 居住 1 / 工作 2）
 * × (总量 + 男女 + 15 年龄档 + 6 话费档)，报告只画了「居住」那一套的几项摘要
 * ⇒ **买回来的数据有一多半没上纸**，报告跟初步分析页底的简版证据几乎没差别。
 *
 * 本文件钉七件事：
 *   A. 1001 解析必须覆盖三套口径（到访口径过去完全没解析）
 *   B. 分档进报告必须**全量**（⛔ 不许再截 top3）
 *   C. 三套口径**各自归一**，⛔ 不许混算（到访是人次，与人数不可通约）
 *   D. 除零 / 全 0 一律返 null 或空数组（⛔ 不造 0%/0% 或 NaN）
 *   E. 汇总句只陈述分布事实（⛔ 不许出现任何预测词）
 *   F. 387 删掉的两条重复 fact 不许被"顺手加回来"
 *   G. 版式：双列条形宽度＝组内占比（⛔ 不许按列内最大值归一，那会让两列看起来一样）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReportModel } from '../../frontend/src/utils/candidateReport.js'
import { parsePopulation1001, AGE_GROUPS, ARPU_GROUPS } from '../src/utils/unicomPopulation.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const COMP = read('frontend/src/components/CandidateReport.vue')
const TPL = COMP.slice(0, COMP.indexOf('<script setup>'))
const SRC = read('frontend/src/utils/candidateReport.js')

const cand = {
  name: '五角场万达 3F 中庭', brand: '食其家', city: '上海', district: '杨浦区',
  address: '邯郸路 600 号', latitude: 31.30, longitude: 121.51, radius: 1000,
  area: 120, rent: 45000
}

/** 15 档年龄、6 档话费，三套口径都给不同分布（便于验证「各自归一」） */
function series(groups, fn) {
  return groups.map(([label], i) => ({ label, value: fn(i) }))
}
function fullPop() {
  return {
    visit: 3907342, live: 399275, work: 335771, total: 410000,
    male: { visit: 2000000, live: 195000, work: 170000 },
    female: { visit: 1907342, live: 204275, work: 165771 },
    ages: {
      visit: series(AGE_GROUPS, (i) => 1000 + i * 300),
      live: series(AGE_GROUPS, (i) => 9000 + i * 1200),
      work: series(AGE_GROUPS, (i) => 500 + i * 900)
    },
    arpu: {
      visit: series(ARPU_GROUPS, (i) => 4000 + i * 700),
      live: series(ARPU_GROUPS, (i) => 9000 - i * 1100),
      work: series(ARPU_GROUPS, (i) => 600 + i * 2000)
    }
  }
}
const sumPct = (rows) => rows.reduce((s, x) => s + x.pct, 0)

describe('A. 1001 解析覆盖三套口径（0=到访 / 1=居住 / 2=工作）', () => {
  it('到访口径的性别/年龄/话费也必须解析出来（386 之前整段丢弃）', () => {
    const d = { p0_sum: 100, p1_sum: 200, p2_sum: 300 }
    for (const [, code] of AGE_GROUPS) { d[`age0_${code}`] = 1; d[`age1_${code}`] = 2; d[`age2_${code}`] = 3 }
    for (const [, sfx] of ARPU_GROUPS) { d[`arpu0_${sfx}`] = 4; d[`arpu1_${sfx}`] = 5; d[`arpu2_${sfx}`] = 6 }
    d.male0_sum = 40; d.female0_sum = 60
    const p = parsePopulation1001({ '1001': d })
    expect(p.male.visit).toBe(40)
    expect(p.female.visit).toBe(60)
    expect(p.ages.visit.length).toBe(15)
    expect(p.arpu.visit.length).toBe(6)
    // 三套用各自前缀，⛔ 不是同一套复制三份
    expect(p.ages.visit[0].value).toBe(1)
    expect(p.ages.live[0].value).toBe(2)
    expect(p.ages.work[0].value).toBe(3)
    expect(p.arpu.work[0].value).toBe(6)
  })

  it('到访口径缺失时返 0 / 空序列，不抛错也不冒充有数据', () => {
    const d = { p1_sum: 200 }
    for (const [, code] of AGE_GROUPS) d[`age1_${code}`] = 5
    const p = parsePopulation1001({ '1001': d })
    expect(p.male.visit).toBe(0)
    expect(p.ages.visit.every((x) => x.value === 0)).toBe(true)
  })
})

describe('B. 分档进报告必须全量（⛔ 不许再截 top3）', () => {
  it('★ 15 档年龄 / 6 档话费，三套口径全部保留', () => {
    const m = buildReportModel(cand, { district: null }, { population: fullPop(), popRadius: 1000 })
    const b = m.population
    expect(b.hasPop).toBe(true)
    for (const k of ['visit', 'live', 'work']) {
      expect(b.ages[k].length, `ages.${k} 被截断了`).toBe(15)
      expect(b.arpu[k].length, `arpu.${k} 被截断了`).toBe(6)
    }
    expect(b.ages.live[4].label).toBe('19-24岁')
  })

  it('🔴 源码里不许再有 top3 截断写法', () => {
    // 386 之前的实现：topSeries(series, 3) 只取前三段塞进 facts
    expect(SRC).not.toMatch(/topSeries\s*\(/)
    expect(SRC).not.toMatch(/slice\(0,\s*3\)/)
  })
})

describe('C. 三套口径各自归一并列，⛔ 不混算', () => {
  const b = () => buildReportModel(cand, { district: null }, { population: fullPop(), popRadius: 1000 }).population

  it('每套年龄分档各自加总 100%（不是三套合起来归一）', () => {
    const p = b()
    for (const k of ['visit', 'live', 'work']) {
      expect(sumPct(p.ages[k]), `ages.${k} 未独立归一`).toBeCloseTo(100, 6)
      expect(sumPct(p.arpu[k]), `arpu.${k} 未独立归一`).toBeCloseTo(100, 6)
    }
    // 三套分布不同 ⇒ 归一后不该一模一样
    expect(p.ages.live[0].pct).not.toBeCloseTo(p.ages.work[0].pct, 3)
  })

  it('🔴 职住比只用「人数」两套口径，⛔ 绝不掺到访人次', () => {
    const p = b()
    // 335771 / 399275
    expect(p.workLiveRatio).toBeCloseTo(335771 / 399275, 6)
    // 若掺了 visit(3907342) 会是一个 > 1 的离谱值
    expect(p.workLiveRatio).toBeLessThan(1)
    // 源码守卫：计算式里不许出现 visit
    const i = SRC.indexOf('workLiveRatio')
    const seg = SRC.slice(i, i + 200)
    expect(seg).not.toContain('visit')
  })

  it('性别三套口径各自独立，男女占比加起来 100%', () => {
    const p = b()
    for (const k of ['visit', 'live', 'work']) {
      expect(p.gender[k]).toBeTruthy()
      expect(p.gender[k].malePct + p.gender[k].femalePct).toBeCloseTo(100, 6)
    }
    expect(p.gender.live.total).toBe(195000 + 204275)
  })
})

describe('D. 除零 / 全 0 一律 null 或空（⛔ 不造 0%/0% 或 NaN）', () => {
  it('居住为 0 时职住比为 null（⛔ Infinity / NaN）', () => {
    const pop = fullPop()
    pop.live = 0
    pop.male.live = 0
    pop.female.live = 0
    const p = buildReportModel(cand, { district: null }, { population: pop }).population
    expect(p.workLiveRatio).toBeNull()
    expect(Number.isFinite(p.workLiveRatio)).toBe(false)
  })

  it('性别全 0 ⇒ null（⛔ 不能显示成"男 0% · 女 0%"）', () => {
    const pop = fullPop()
    pop.male.work = 0
    pop.female.work = 0
    const p = buildReportModel(cand, { district: null }, { population: pop }).population
    expect(p.gender.work).toBeNull()
    expect(p.summary.join('|')).not.toContain('男 0.0%')
  })

  it('某套分档全 0 ⇒ 空数组（⛔ 不画一排 0% 的条）', () => {
    const pop = fullPop()
    pop.arpu.work = series(ARPU_GROUPS, () => 0)
    const p = buildReportModel(cand, { district: null }, { population: pop }).population
    expect(p.arpu.work).toEqual([])
    expect(p.arpu.live.length).toBe(6)
  })

  it('没取数时三套结构全空，且 hasPop=false', () => {
    const p = buildReportModel(cand, { district: null }).population
    expect(p.hasPop).toBe(false)
    expect(p.ages.live).toEqual([])
    expect(p.arpu.live).toEqual([])
    expect(p.gender.live).toBeNull()
    expect(p.workLiveRatio).toBeNull()
    expect(p.summary).toEqual([])
  })
})

describe('E. 汇总句只陈述分布事实（⛔ 不许预测）', () => {
  const text = () => buildReportModel(cand, { district: null }, { population: fullPop() }).population.summary.join('\n')

  it('★ 该有的结论都有：职住结构 / 主力年龄 / 话费档 / 到访人群', () => {
    const t = text()
    expect(t).toContain('职住结构')
    expect(t).toContain('居住人口以')
    expect(t).toContain('工作人口以')
    expect(t).toContain('到访人次以')
    expect(t).toMatch(/消费能力代理/)
  })

  it('🔴🔴 不许出现预测 / 营业额 / 客流预估类词（store_sales 无真实数据）', () => {
    const t = text()
    for (const bad of ['预计', '预测', '日销', '月销', '翻台', '坪效预估', '客流量预计']) {
      expect(t, `人口小结出现了「${bad}」`).not.toContain(bad)
    }
  })

  it('到访口径的结论必须带上「人次」提示（⛔ 不能让人读成人数）', () => {
    const line = text().split('\n').find((l) => l.includes('到访人次以'))
    expect(line).toBeTruthy()
    expect(line).toMatch(/人次口径|不等于人数/)
  })
})

describe('F. 387 删掉的两条重复 fact 不许加回来', () => {
  it('「主要年龄段」「主要月话费档」已并入人口结构区块，表格里不许再出现', () => {
    const m = buildReportModel(cand, { district: null }, { population: fullPop() })
    const labels = m.facts.map((f) => f.label)
    expect(labels).not.toContain('主要年龄段')
    expect(labels).not.toContain('主要月话费档')
  })

  it('量级三项（居住/工作/到访）仍必须在表格里 —— 领导先看数，再看结构', () => {
    const m = buildReportModel(cand, { district: null }, { population: fullPop(), popRadius: 1000 })
    const labels = m.facts.map((f) => f.label)
    expect(labels).toContain('半径 1km 内居住人口')
    expect(labels).toContain('半径 1km 内工作人口')
    expect(labels).toContain('半径 1km 内到访人次')
  })
})


describe('G. 版式：双列比例条', () => {
  it('年龄与话费都用双列布局', () => {
    expect(TPL).toContain('rp-pop-cols')
    // 两个结构块各一处
    expect((TPL.match(/class="rp-pop-cols"/g) || []).length).toBe(2)
  })

  it('🔴 条形宽度必须等于组内占比本身，⛔ 不许按列内最大值归一', () => {
    // 归一写法会让「居住」和「工作」两列的最长条都撑满 ⇒ 两列看起来分布一样
    expect(TPL).toContain("Math.min(100, r.pct) + '%'")
    expect(TPL).not.toMatch(/maxPct/)
    expect(TPL).not.toMatch(/r\.pct\s*\/\s*\w+Max/)
  })

  it('到访量级必须用 numVisit（人次），⛔ 不许复用 num()', () => {
    expect(TPL).toMatch(/numVisit\(model\.population\.visit\)/)
  })

  it('全量人口一格必须标注是联通全量口径（⛔ 不可与居住/工作相加）', () => {
    expect(TPL).toContain('联通全量人口')
  })

  it('比例条的底色必须是真的 CSS 背景（PDF 走 html2canvas 截 DOM）', () => {
    const m = COMP.match(/\.rp-pb-track \{[^}]*\}/)
    expect(m).toBeTruthy()
    expect(m[0]).toContain('background')
  })

  /**
   * 🔴🔴 v1.13.391 真机暴露的事故：比例条最初起名 `.rp-bar / .rp-bar-l`，
   *   与顶部工具条**同名**⇒ 后定义的 `.rp-bar-l { width: 54px }` 把工具条的
   *   `flex: 1; min-width: 0` 覆盖掉，「加入 AI 选址建议」那行的提示文字被挤成
   *   每行两三个字的竖条。纯代码看不出、单测也看不出，只有截图才现形。
   *   ⇒ 钉死：这两个类名在整个文件里只允许各有一条样式定义。
   */
  it('🔴 新类名不许与既有工具条撞名（.rp-bar / .rp-bar-l 各只能定义一次）', () => {
    const count = (sel) => (COMP.match(new RegExp(`\\${sel} \\{`, 'g')) || []).length
    expect(count('.rp-bar'), '.rp-bar 被重复定义了').toBe(1)
    expect(count('.rp-bar-l'), '.rp-bar-l 被重复定义了').toBe(1)
    // 比例条必须用独立前缀
    expect(COMP).toContain('.rp-pb-row {')
    expect(COMP).toContain('.rp-pb-track {')
    // 模板里工具条仍必须是 rp-bar（⛔ 被顺手改成比例条的类名）
    expect(TPL).toContain('<div class="rp-bar">')
    expect(TPL).toContain('<div class="rp-bar-l">')
  })

  /**
   * 🔴 v1.13.391：报告变长后纵向滚动成为常态，而 880px 弹窗的内宽只剩 770px < 纸张 794px
   *   ⇒ 每次都会同时出现横向滚动条（溢出 24px）。这是 337 起就存在的老缺陷，
   *   内容一变长才暴露出来。这里钉住「弹窗必须留够纸张宽度」。
   */
  it('🔴 弹窗宽度必须容得下 794px 纸张（否则纵向滚动时冒出横向滚动条）', () => {
    const w = Number((COMP.match(/width="(\d+)px"/) || [])[1])
    expect(w, '弹窗宽度没读到').toBeGreaterThanOrEqual(910)
    // 纸张宽度 794 不动（A4 比例的依据）
    const paper = COMP.match(/\.rp-paper \{[\s\S]*?width:\s*(\d+)px/)
    expect(Number(paper[1])).toBe(794)
  })
})

describe('H. 对外文档不许出现代码批注符号（391 真机发现 ⛔ 漏进正文）', () => {
  /**
   * 🔴 这份报告是**发给同事和领导的外发文档**。`⛔` 是给开发看的"禁止"标记，
   *   出现在「性别构成（各口径独立统计，⛔ 不可相加）」这种正文里像乱码。
   *    真机截图才看出来 —— 单测和代码 review 都过了。
   */
  const BAD = ['⛔', '🔴', '⚠️', '✅']

  it('报告模型渲染出来的每一个字符串都不带批注符号', () => {
    const m = buildReportModel(cand, { district: null }, { population: fullPop(), popRadius: 1000 })
    const texts = [
      ...m.facts.flatMap((f) => [f.label, f.value, f.note]),
      ...m.risks,
      ...m.population.summary,
      ...Object.values(m.provenance),
      m.completeness, m.title, m.projectName
    ].filter((x) => typeof x === 'string')
    for (const t of texts) {
      for (const b of BAD) expect(t, `正文出现了批注符号「${b}」：${t.slice(0, 40)}`).not.toContain(b)
    }
  })

  it('模板正文（剥掉注释后）同样不许出现批注符号', () => {
    const stripped = TPL.replace(/<!--[\s\S]*?-->/g, '')
    for (const b of BAD) expect(stripped, `模板正文出现了「${b}」`).not.toContain(b)
  })
})
