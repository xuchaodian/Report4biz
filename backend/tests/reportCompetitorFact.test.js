/**
 * 「关键信息」里的竞品事实（v1.13.421）
 *
 * ── 业主 2026-11-26 三条 ──────────────────────────────────────────────────
 *   ① 「3 行『半径 xx m 内人口』能一行显示吗」
 *   ② 「『商圈竞争评分』……名称是否应该改为『商圈评分』」
 *   ③ 「『商圈内竞品』改为『半径 xx m 内竞品』，根据所选（半径）切换显示实际数量，
 *       并移动到『半径 xx m 内到访人次』下方」
 *
 * ── 本文件钉什么 ─────────────────────────────────────────────────────────
 *   · 合并后的**人口行**：只有一个 label，三个数都在，且「到访是人次」不许丢；
 *   · 竞品行的三种状态：有数 / 0 家 / **未获取**（⚠️ 0 家是结论，未获取不是 0 家）；
 *   · 竞品行的**位置**：紧跟人口行（＝原「到访人次」那一行的位置）；
 *   · 竞品行的**半径**：跟当前人口档走，无档回退候选评估半径；
 *   · 「商圈竞争评分」已改名「商圈评分」，且注记仍写明「非该点位自身评分」。
 */
import { describe, it, expect } from 'vitest'
import { buildReportModel } from '../../frontend/src/utils/candidateReport.js'

const cand = {
  name: '五角场万达 3F 中庭', brand: '食其家', city: '上海', district: '杨浦区',
  address: '邯郸路 600 号', latitude: 31.30, longitude: 121.51, radius: 1000,
  area: 120, rent: 45000
}

/** 最小可用 1001 解析结果（只要有量级三项，hasPop 就成立） */
const pop = {
  visit: 21500, live: 8600, work: 5400, total: 30180,
  male: { live: 4200 }, female: { live: 4400 },
  ages: { live: [], work: [] },
  arpu: { live: [], work: [] }
}

const labels = (m) => m.facts.map((f) => f.label)
const findFact = (m, label) => m.facts.find((f) => f.label === label)

describe('A. 人口三行已合并为一行（需求①）', () => {
  const m = buildReportModel(cand, { district: null }, { population: pop, popMonth: '202607', popRadius: 1000 })

  it('A1 只有一条「半径 1km 内人口」，不再有居住/工作/到访三条独立行', () => {
    const ls = labels(m)
    expect(ls).toContain('半径 1km 内人口')
    expect(ls).not.toContain('半径 1km 内居住人口')
    expect(ls).not.toContain('半径 1km 内工作人口')
    expect(ls).not.toContain('半径 1km 内到访人次')
  })

  it('A2 三个数都在同一行里（合并的是版式，不是数据）', () => {
    const f = findFact(m, '半径 1km 内人口')
    expect(f.value).toContain('8,600')
    expect(f.value).toContain('5,400')
    expect(f.value).toContain('21,500')
    expect(f.value).toContain('人次')
  })

  it('A3 到访是「人次」的警告必须留在 note 里', () => {
    expect(findFact(m, '半径 1km 内人口').note).toMatch(/人次/)
    expect(findFact(m, '半径 1km 内人口').note).toMatch(/不与人数相加/)
  })

  it('A4 未取数时仍是一行，写「未获取」', () => {
    const mm = buildReportModel(cand, { district: null }, { population: null, popRadius: 0 })
    expect(findFact(mm, '半径 1km 内人口').value).toBe('未获取')
  })
})

describe('B. 竞品行：名称、位置、半径（需求③）', () => {
  it('B1 名称是「半径 X 内竞品」，⛔ 不再有「商圈内竞品」', () => {
    const m = buildReportModel(cand, { district: null }, {
      population: pop, popRadius: 1000, competitorInRadius: 3
    })
    expect(labels(m)).toContain('半径 1km 内竞品')
    expect(labels(m)).not.toContain('商圈内竞品')
    expect(findFact(m, '半径 1km 内竞品').value).toBe('3 家')
  })

  it('B2 位置紧跟人口行（原「到访人次」那一行的位置）', () => {
    const m = buildReportModel(cand, { district: null }, {
      population: pop, popRadius: 1000, competitorInRadius: 3
    })
    const ls = labels(m)
    const iPop = ls.indexOf('半径 1km 内人口')
    expect(iPop).toBeGreaterThan(-1)
    expect(ls[iPop + 1], '竞品必须紧跟人口行').toBe('半径 1km 内竞品')
  })

  it('B3 半径跟当前档走：3km 档就写「半径 3km 内竞品」', () => {
    const m = buildReportModel(cand, { district: null }, {
      population: pop, popRadius: 3000, competitorInRadius: 11
    })
    expect(findFact(m, '半径 3km 内竞品').value).toBe('11 家')
    expect(findFact(m, '半径 3km 内人口')).toBeTruthy()
  })

  it('B4 无已购档 ⇒ 回退候选评估半径，仍然是「半径 1km 内竞品」', () => {
    const m = buildReportModel(cand, { district: null }, { population: null, competitorInRadius: 0 })
    expect(findFact(m, '半径 1km 内竞品').value).toBe('0 家')
  })
})

describe('C. 「0 家」与「未获取」是两件事（本项目 6.128 老坑）', () => {
  it('C1 明确传 0 ⇒ 0 家（这是结论）', () => {
    const m = buildReportModel(cand, { district: null }, { population: pop, popRadius: 1000, competitorInRadius: 0 })
    const f = findFact(m, '半径 1km 内竞品')
    expect(f.value).toBe('0 家')
    expect(f.note).not.toMatch(/未获取|未返回/)
  })

  it('C2 传 null ⇒ 未获取，⛔ 绝不许写成 0 家（Number(null) === 0）', () => {
    const m = buildReportModel(cand, { district: null }, { population: pop, popRadius: 1000, competitorInRadius: null })
    const f = findFact(m, '半径 1km 内竞品')
    expect(f.value).toBe('未获取')
    expect(f.value).not.toContain('0')
  })

  it('C3 完全不传 ⇒ 未获取', () => {
    const m = buildReportModel(cand, { district: null }, { population: pop, popRadius: 1000 })
    expect(findFact(m, '半径 1km 内竞品').value).toBe('未获取')
  })
})

describe('D. 竞品口径注记仍要说清数了哪些品牌（346 的透明度要求）', () => {
  it('D1 有数时 note 带口径；0 家时同样带（不能只在有竞品时才说清）', () => {
    for (const n of [0, 5]) {
      const m = buildReportModel(cand, { district: null }, {
        population: pop, popRadius: 1000, competitorInRadius: n,
        brandScope: { configured: true, brands: ['老乡鸡'] }
      })
      expect(findFact(m, '半径 1km 内竞品').note).toContain('已按品牌映射收窄')
      expect(findFact(m, '半径 1km 内竞品').note).toContain('老乡鸡')
    }
  })

  it('D2 有竞品时风险句用同一个半径口径（⛔ 不许写回「该商圈内」）', () => {
    const m = buildReportModel(cand, { district: null }, {
      population: pop, popRadius: 1000, competitorInRadius: 5,
      brandScope: { configured: true, brands: ['老乡鸡'] }
    })
    const t = m.risks.join('|')
    expect(t).toContain('半径 1km 内已有竞品门店 5 家')
    expect(t).not.toContain('该商圈内已有竞品门店')
  })
})

describe('E. 「商圈竞争评分」→「商圈评分」（需求②）', () => {
  // 有一点商圈面数据（只要 name/score 即可，不需要真实几何）
  const hit = {
    district: { name: '五角场', score: 78, crowd: '职住均衡', level: '社区级', resident: '', competitorCount: 9, myStoreCount: 0 },
    contained: true,
    distanceM: 0
  }
  const m = buildReportModel(cand, hit, { population: pop, popRadius: 1000, competitorInRadius: 2 })

  it('E1 新名字在，旧名字不在', () => {
    expect(labels(m)).toContain('商圈评分')
    expect(labels(m)).not.toContain('商圈竞争评分')
  })

  it('E2 注记仍写明「商圈面 / 非该点位自身评分」', () => {
    const f = findFact(m, '商圈评分')
    expect(f.value).toBe('78 / 100')
    expect(f.note).toContain('非该点位自身评分')
    expect(f.note).toContain('商圈面')
  })

  it('E3 商圈面那个竞品数（9 家）不许再出现在 facts 里 —— 一份报告只能有一个竞品口径', () => {
    const vs = m.facts.map((f) => f.value).join('|')
    expect(vs).not.toContain('9 家')
    expect(findFact(m, '半径 1km 内竞品').value).toBe('2 家')
  })
})
