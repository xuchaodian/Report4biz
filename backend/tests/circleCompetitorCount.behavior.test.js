/**
 * 「半径圆内竞品数」行为测试（v1.13.421）—— 用假库验证**真的按圆筛**
 *
 * 为什么必须做行为测试而不是只做源码断言：
 *   `countCompetitorsInCircle` 只有两段逻辑 —— SQL 的 bbox 粗筛 + JS 的球面精算。
 *   源码断言能证明「写了 circleDistM」，但证明不了「bbox 命中的点会不会被圆外排除」。
 *   而 bbox 与圆的差异正是这条链路唯一的算法风险：r=2.5km 的方形对角半径是 3.5km，
 *   直接把 bbox 里的都算上，报告会把 3.5km 外的店算成「2.5km 内竞品」。
 *
 * ⚠️ 用 `vi.mock` 替换 `getDb`：真实库在测试环境不可控（生产库禁止加载）。
 *   假库的 `all()` 故意**不做任何过滤**，全部交给被测函数自己算 —— 这样
 *   「SQL 只粗筛、精算在 JS」这个分工才真的被测到。
 *
 * ⚠️⚠️ 每个用例必须用**不同的圆心**：函数带 60s 缓存（key 含坐标+半径），
 *   同一个点重复用会让后面的用例直接命中前面的结果 —— 本文件第一版就因此假红两次
 *   （A4 期望 3 得 1、B4 期望 1 得 0），全是缓存串的，不是函数错。
 */
import { describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: [], allCalls: 0 }))

vi.mock('../src/models/database.js', () => ({
  getDb: () => ({
    prepare: () => ({
      all: () => { state.allCalls += 1; return state.rows },
      get: () => ({ v: 'v1' })          // storeDataVersion 用
    })
  })
}))

const { countCompetitorsInCircle } = await import('../src/utils/districtCount.js')

/** 每个用例一个独立圆心（避开 60s 缓存），都在上海纬度带上 */
const C1 = { lat: 31.30, lng: 121.51 }
const C2 = { lat: 31.35, lng: 121.56 }
const C3 = { lat: 31.40, lng: 121.61 }
const C4 = { lat: 31.45, lng: 121.66 }
const C5 = { lat: 31.50, lng: 121.71 }
const C6 = { lat: 31.55, lng: 121.76 }
const C7 = { lat: 31.60, lng: 121.81 }
const C8 = { lat: 31.65, lng: 121.86 }
const C9 = { lat: 31.70, lng: 121.91 }

const ids = [7]

/** 以 base 为圆心，向北 dn 米、向东 de 米 */
const dLatFor = (m) => m / 111320
const dLngFor = (m) => m / (111320 * Math.cos((C1.lat * Math.PI) / 180))
const at = (base, dn, de) => ({ longitude: base.lng + de, latitude: base.lat + dn })

describe('A. 圆是真的圆（bbox 只是粗筛）', () => {
  it('A1 圆心同点 ⇒ 任何半径都算 1 家', () => {
    state.rows = [at(C1, 0, 0)]
    expect(countCompetitorsInCircle(C1.lng, C1.lat, 300, ids)).toBe(1)
  })

  it('A2 3km 外的点：1km 内不算、4km 内算', () => {
    state.rows = [at(C2, dLatFor(3000), 0)]
    expect(countCompetitorsInCircle(C2.lng, C2.lat, 1000, ids)).toBe(0)
    expect(countCompetitorsInCircle(C2.lng, C2.lat, 4000, ids)).toBe(1)
  })

  it('⭐ A3 落在 bbox 角上、直线却在圆外的点必须排除（方圆之别）', () => {
    // 该点：南北 2493m + 东西 2496m ⇒ 直线 ≈ 3528m，但它落在 2.5km 的 bbox 里
    state.rows = [at(C3, dLatFor(2493), dLngFor(2496))]
    expect(countCompetitorsInCircle(C3.lng, C3.lat, 2500, ids), '2.5km 圆内不该含 3.5km 外的点').toBe(0)
    expect(countCompetitorsInCircle(C3.lng, C3.lat, 4000, ids), '4km 圆内应该含它').toBe(1)
  })

  it('A4 多条混合：只数圆内的', () => {
    state.rows = [
      at(C4, 0, 0),                          // 0m
      at(C4, dLatFor(800), 0),               // 800m
      at(C4, 0, dLngFor(1200)),              // 1200m
      at(C4, dLatFor(5000), dLngFor(5000))   // ≈ 7km 外
    ]
    expect(countCompetitorsInCircle(C4.lng, C4.lat, 1000, ids)).toBe(2)
    expect(countCompetitorsInCircle(C4.lng, C4.lat, 2000, ids)).toBe(3)
    expect(countCompetitorsInCircle(C4.lng, C4.lat, 10000, ids)).toBe(4)
  })
})

describe('B. 判无权与非法入参（⛔ 不许退化成"过不过滤都一样"）', () => {
  it('B1 可见域为空 ⇒ 0，且**一次库都不查**', () => {
    state.rows = [at(C5, 0, 0)]
    const before = state.allCalls
    expect(countCompetitorsInCircle(C5.lng, C5.lat, 1000, [])).toBe(0)
    expect(state.allCalls).toBe(before)
  })

  it('B2 半径 ≤0 / 非数字 ⇒ 0（⛔ 不看全表）', () => {
    state.rows = [at(C6, 0, 0)]
    for (const bad of [0, -100, NaN, null, undefined, '']) {
      expect(countCompetitorsInCircle(C6.lng, C6.lat, bad, ids)).toBe(0)
    }
  })

  it('B3 坐标 (0,0) ⇒ 0（那是"没填坐标"，不是几内亚湾）', () => {
    state.rows = [at(C7, 0, 0)]
    expect(countCompetitorsInCircle(0, 0, 1000, ids)).toBe(0)
  })

  it('B4 缺经纬度的竞品行不计入', () => {
    state.rows = [
      { longitude: null, latitude: null },
      { longitude: 0, latitude: 0 },
      at(C8, 0, 0)
    ]
    expect(countCompetitorsInCircle(C8.lng, C8.lat, 1000, ids)).toBe(1)
  })
})

describe('C. 缓存：同点同半径只查一次库', () => {
  it('C1 第二次同样入参命中缓存', () => {
    state.rows = [at(C9, 0, 0)]
    const before = state.allCalls
    countCompetitorsInCircle(C9.lng, C9.lat, 1234, ids)
    const afterFirst = state.allCalls
    countCompetitorsInCircle(C9.lng, C9.lat, 1234, ids)
    expect(afterFirst).toBe(before + 1)
    expect(state.allCalls).toBe(afterFirst)
  })

  it('C2 换半径 / 换点 / 换账号集合都必须重新查（key 少一项就会串数据）', () => {
    const C10 = { lat: 31.75, lng: 121.96 }
    state.rows = [at(C10, 0, 0)]
    const base = state.allCalls
    countCompetitorsInCircle(C10.lng, C10.lat, 2000, ids)
    countCompetitorsInCircle(C10.lng, C10.lat, 2001, ids)              // 换半径
    countCompetitorsInCircle(C10.lng + 0.001, C10.lat, 2000, ids)      // 换坐标
    countCompetitorsInCircle(C10.lng, C10.lat, 2000, [8])              // 换账号集合
    expect(state.allCalls).toBeGreaterThanOrEqual(base + 4)
  })
})
