/**
 * 联通 1001 人口解析守卫 —— v1.13.340
 *
 * 背景：立项报告的人口数据从「商圈边界面属性」改为「用户购买的联通人口配额」，
 * 所以这份解析就是报告人口页的唯一数据源。它错了，整页数字就错了。
 *
 * 钉四件事：
 *   A. 人口类型位不能搞反（0=到访 / 1=居住 / 2=工作）—— 搞反了没人看得出来
 *   B. 大小写都能取（模板写 P0_SUM，真实响应是 p0_sum）
 *   C. 取不到就返 null（⛔ 不返一堆 0 让报告显示「0 人」）
 *   D. 分档序列（年龄 15 段 / 话费 6 档）标签与取值一一对应
 */
import { describe, it, expect } from 'vitest'
import { parsePopulation1001, toPercents, AGE_GROUPS, ARPU_GROUPS } from '../src/utils/unicomPopulation.js'

/** 一份贴近真实的 1001 返回（小写键） */
function sampleLower() {
  const d = {
    p0_sum: 39073425,   // 到访
    p1_sum: 399275,     // 居住
    p2_sum: 335771,     // 工作
    pall_sum: 410000,
    male1_sum: 195000, female1_sum: 204275,
    male2_sum: 170000, female2_sum: 165771
  }
  for (const [, code] of AGE_GROUPS) { d[`age1_${code}`] = 1000; d[`age2_${code}`] = 800 }
  for (const [, suffix] of ARPU_GROUPS) { d[`arpu1_${suffix}`] = 500; d[`arpu2_${suffix}`] = 400 }
  return d
}

describe('A. 人口类型位：0=到访 / 1=居住 / 2=工作', () => {
  it('★ p0_sum 是到访、p1_sum 是居住、p2_sum 是工作（⛔ 不许搞反）', () => {
    const p = parsePopulation1001({ '1001': sampleLower() })
    expect(p.visit).toBe(39073425)
    expect(p.live).toBe(399275)
    expect(p.work).toBe(335771)
    expect(p.total).toBe(410000)
  })

  it('居住/工作的性别分别取 male1/female1 与 male2/female2', () => {
    const p = parsePopulation1001({ '1001': sampleLower() })
    expect(p.male.live).toBe(195000)
    expect(p.female.live).toBe(204275)
    expect(p.male.work).toBe(170000)
    expect(p.female.work).toBe(165771)
  })
})

describe('B. 大小写不敏感（模板 P0_SUM vs 真实 p0_sum）', () => {
  it('全大写键同样能取到', () => {
    const up = {}
    for (const [k, v] of Object.entries(sampleLower())) up[k.toUpperCase()] = v
    const p = parsePopulation1001({ '1001': up })
    expect(p.visit).toBe(39073425)
    expect(p.live).toBe(399275)
    expect(p.work).toBe(335771)
  })

  it('带数字后缀的键（P0_SUM1）也认', () => {
    const p = parsePopulation1001({ '1001': { P0_SUM1: 123, P1_SUM1: 456 } })
    expect(p.visit).toBe(123)
    expect(p.live).toBe(456)
  })
})

describe('C. 三种入参外壳都能解析', () => {
  it('{ apiResult: { 1001: {...} } }', () => {
    expect(parsePopulation1001({ apiResult: { '1001': sampleLower() } }).live).toBe(399275)
  })
  it('JSON 字符串', () => {
    expect(parsePopulation1001(JSON.stringify({ apiResult: { '1001': sampleLower() } })).live).toBe(399275)
  })
  it('裸 1001 dict（没有外层 key）', () => {
    expect(parsePopulation1001(sampleLower()).live).toBe(399275)
  })
})

describe('D. 取不到就返 null（⛔ 不返 0 冒充有数据）', () => {
  it('空对象 / null / 空串 ⇒ null', () => {
    expect(parsePopulation1001(null)).toBeNull()
    expect(parsePopulation1001('')).toBeNull()
    expect(parsePopulation1001({})).toBeNull()
    expect(parsePopulation1001({ '1005': [] })).toBeNull()
  })

  it('四项全 0 ⇒ null（上游失败时常见）', () => {
    expect(parsePopulation1001({ '1001': { p0_sum: 0, p1_sum: 0, p2_sum: 0, pall_sum: 0 } })).toBeNull()
  })

  it('只有 pall_sum 时 total 用它，且不凭空造 live/work', () => {
    const p = parsePopulation1001({ '1001': { pall_sum: 8888 } })
    expect(p.total).toBe(8888)
    expect(p.live).toBe(0)
    expect(p.work).toBe(0)
  })

  it('坏 JSON 字符串 ⇒ null（不抛）', () => {
    expect(parsePopulation1001('{not json')).toBeNull()
  })
})

describe('E. 分档序列：标签与取值一一对应', () => {
  it('年龄 15 段、话费 6 档', () => {
    const p = parsePopulation1001({ '1001': sampleLower() })
    expect(p.ages.live.length).toBe(15)
    expect(p.ages.work.length).toBe(15)
    expect(p.arpu.live.length).toBe(6)
    expect(p.arpu.work.length).toBe(6)
    expect(p.ages.live[4]).toEqual({ label: '19-24岁', value: 1000 })
    expect(p.arpu.live[2]).toEqual({ label: '100-150元', value: 500 })
  })

  it('居住与工作用不同前缀（age1_ / age2_），⛔ 不是同一套', () => {
    const p = parsePopulation1001({ '1001': sampleLower() })
    expect(p.ages.live.every((x) => x.value === 1000)).toBe(true)
    expect(p.ages.work.every((x) => x.value === 800)).toBe(true)
  })
})

describe('F. toPercents', () => {
  it('归一成百分比，总和 100', () => {
    const out = toPercents([{ label: 'a', value: 1 }, { label: 'b', value: 3 }])
    expect(out[1].pct).toBe(75)
    expect(out.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 6)
  })
  it('总量为 0 返回空数组（⛔ 不要让报告画出全 0 的条）', () => {
    expect(toPercents([{ label: 'a', value: 0 }])).toEqual([])
    expect(toPercents(null)).toEqual([])
  })
})
