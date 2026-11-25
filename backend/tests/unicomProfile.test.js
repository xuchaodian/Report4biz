/**
 * 417 守卫：画像服务码解析（1009 消费力 / 1010 教育 / 1011 职业 / 1012 人生阶段 /
 *                        1013 消费水平 / 1015 收入资产 / 1007 月驻留）
 *
 * 业主 2026-11-25：「半径 1km 以上侧重静态居民工作人数、居民画像（收入、职业等、消费力等信息）」
 * ⇒ 报告不再只解析 1001。本测试钉住：
 *   ① 三套口径（到访/居住/工作）各算各的，⛔ 不混用；
 *   ② 标签来自 `unicomSummaryCols.js` 的字段字典（不手写中文，避免"报告说本科、模板说大专"）；
 *   ③ 缺码/缺字段一律 null，⛔ 不补 0 冒充"确实是 0 人"。
 */
import { describe, it, expect } from 'vitest'
import { buildProfiles, buildProfile, buildReach } from '../src/utils/unicomProfile.js'

/** 只带 1001 的最小 result_data（= 413 立项报告当初的形态） */
const ONLY_1001 = {
  querySuccess: true,
  apiResult: { '1001': { p0_sum: 21500, p1_sum: 8600, p2_sum: 5400, pall_sum: 30180 } }
}

/** 全套画像码（居住口径 popu_type=1） */
const FULL = {
  querySuccess: true,
  apiResult: {
    '1001': { p0_sum: 21500, p1_sum: 8600, p2_sum: 5400, pall_sum: 30180 },
    '1009': Array.from({ length: 8 }, (_, i) => ({ popu_type: 1, spendpower: String(i + 1), spendpower_value: 400 + i * 160 })),
    '1010': [{ popu_type: 1, p0: 2100, p1: 2400, p2: 3100, p3: 800, p4: 200 }],
    '1011': [{ popu_type: 1, p1: 600, p2: 300, p3: 500, p4: 2700, p5: 1900, p6: 400, p7: 1200, p8: 300, p9: 400, p10: 300 }],
    '1012': [{ popu_type: 1, p1: 3900, p2: 2100, p3: 2600 }],
    '1013': [{ popu_type: 1, p1: 2100, p2: 4400, p3: 2100 }],
    '1015': [
      { fname: '收入预测', popu_type: 1, p1: 1600, p2: 1900, p3: 2600, p4: 1500, p5: 1000 },
      { fname: '有车预测', popu_type: 1, p1: 1400, p2: 1500, p3: 2400, p4: 1800, p5: 1500 },
      { fname: '有房预测', popu_type: 1, p1: 2200, p2: 1700, p3: 2100, p4: 1400, p5: 1200 }
    ],
    '1007': [{ reach1: 900, reach2: 1500, reach3: 2200, reach4: 1400, reach5: 800 }]
  }
}

describe('只有 1001（413 的老形态）', () => {
  it('画像全部为 null，服务码清单只有 1001', () => {
    const p = buildProfiles(ONLY_1001)
    expect(p.services).toEqual(['1001'])
    expect(p.live).toBe(null)
    expect(p.visit).toBe(null)
    expect(p.work).toBe(null)
  })

  it('入口不改写调用方：拿不到数据就 null，⛔ 不返回空壳对象', () => {
    expect(buildProfile({}, 1)).toBe(null)
    expect(buildProfile(null, 1)).toBe(null)
  })
})

describe('全套画像码（居住口径）', () => {
  const p = buildProfiles(FULL)

  it('服务码清单覆盖到 1009/1010/1011/1012/1013/1014/1015/1016', () => {
    for (const c of ['1001', '1007', '1009', '1010', '1011', '1012', '1013', '1014', '1015', '1016']) {
      expect(p.services).toContain(c)
    }
  })

  it('消费水平 高/中/低 占比相加 ≈ 100%（1013）', () => {
    const s = p.live.spendLevel
    expect(s.total).toBe(8600)
    expect(s.high + s.mid + s.low).toBeCloseTo(100, 5)
    expect(s.mid).toBeCloseTo(51.16, 1)
  })

  it('消费力指数是 1~8 加权均值（1009）', () => {
    const avg = p.live.spendIndex.avg
    expect(avg).toBeGreaterThan(1)
    expect(avg).toBeLessThanOrEqual(8)
  })

  it('教育：本科及以上 = 本科+硕士+博士（1010）', () => {
    // (3100+800+200)/8600
    expect(p.live.education.bachelorPlusPct).toBeCloseTo(((3100 + 800 + 200) / 8600) * 100, 1)
    expect(p.live.education.items.map((x) => x.label)).toContain('本科')
  })

  it('职业：Top3 按占比降序，标签来自字段字典（1011）', () => {
    const top = p.live.occupation.top
    expect(top).toHaveLength(3)
    expect(top[0].label).toContain('白领')
    expect(top[0].pct).toBeGreaterThan(top[1].pct)
  })

  it('人生阶段：已婚已育占比（1012）', () => {
    expect(p.live.lifeStage.marriedWithKidsPct).toBeCloseTo((3900 / 8600) * 100, 1)
  })

  it('收入/有车/有房：取「高 + 中高」两档（1015 → 成品区 1014/1015/1016）', () => {
    expect(p.live.income.highPlusPct).toBeCloseTo(((1600 + 1900) / 8600) * 100, 1)
    expect(p.live.car.highPlusPct).toBeCloseTo(((1400 + 1500) / 8600) * 100, 1)
    expect(p.live.house.highPlusPct).toBeCloseTo(((2200 + 1700) / 8600) * 100, 1)
  })

  it('🔴 三套口径各算各的：只给了居住数据 ⇒ 到访/工作口径为 null', () => {
    expect(p.visit).toBe(null)
    expect(p.work).toBe(null)
  })
})

describe('月驻留频次（1007，到访口径）', () => {
  it('5 次以上 = reach3+4+5 占比', () => {
    const r = buildReach(FULL)
    expect(r.total).toBe(6800)
    expect(r.heavyPct).toBeCloseTo(((2200 + 1400 + 800) / 6800) * 100, 1)
  })

  it('没有 1007 ⇒ null（不编造）', () => {
    expect(buildReach(ONLY_1001)).toBe(null)
  })
})

describe('缺失与异常', () => {
  it('缺 1013 但有其它的码 ⇒ 消费水平为 0/null，其它照算', () => {
    const rd = JSON.parse(JSON.stringify(FULL))
    delete rd.apiResult['1013']
    const p = buildProfiles(rd)
    expect(p.live.spendLevel.total).toBe(0)
    expect(p.live.spendLevel.high).toBe(null)
    expect(p.live.education.bachelorPlusPct).not.toBe(null)
  })

  it('result_data 是坏 JSON 串 ⇒ 全 null，不抛错', () => {
    const p = buildProfiles('{不是合法 json')
    expect(p.services).toEqual([])
    expect(p.live).toBe(null)
  })

  it('画像分档全为 0 ⇒ 该口径视为没有画像', () => {
    const rd = { apiResult: { '1013': [{ popu_type: 1, p1: 0, p2: 0, p3: 0 }] } }
    expect(buildProfile(rd.apiResult, 1)).toBe(null)
  })
})
