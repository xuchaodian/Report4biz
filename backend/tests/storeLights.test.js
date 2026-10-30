/**
 * 门店体检 · 信号灯（v1.13.299 半径骨架）
 *
 * 这个文件钉的是**口径本身**，不是实现细节：
 *   · 判定单位是「门店到同品牌最近一家的距离」，⛔ 不是「在不在商圈面里」；
 *   · 同址双店型不计分（大店+小店是经营策略，判蚕食等于让客户去关真店）；
 *   · 竞争维度没有竞品点位 ⇒ 「未评」，⛔ 不许变成绿灯（0 家竞品 ≠ 竞争宽松）；
 *   · 商圈面只展示，不影响状态、不影响分数。
 *
 * 背景（生产实测 233 家：商圈面口径下 16% 门店无结论、竞争分与真实竞品数负相关 −0.26）。
 */
import { describe, it, expect } from 'vitest'
import {
  buildStoreLights, STATUS, COMP_STATUS,
  SAME_ADDR_M, CLOSE_M, OVERLAP_M, COMP_RADIUS_M, COMP_MID, COMP_HIGH, RISK_HIGH, RISK_MID
} from '../src/utils/storeLights.js'

const LAT0 = 31.2
const LNG0 = 121.4
/** 纬度方向偏移米数 → 度数（1 度纬度 ≈ 111320m） */
const dLat = (m) => m / 111320

function store(id, { lat = LAT0, lng = LNG0, city = '上海', name = '', brand = '甲', code = '', area = 0 } = {}) {
  return {
    id,
    name: name || `店${id}`,
    brand,
    city,
    store_code: code,
    store_area: area,
    latitude: lat,
    longitude: lng
  }
}

/** 造一个以 (lat,lng) 为中心、边长 side 度的方形商圈面 */
function square(name, { lat = LAT0, lng = LNG0, side = 0.02, level = '核心级', crowd = '居住主导', city = '上海' } = {}) {
  const h = side / 2
  return {
    name, city, level, crowd,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]
      ]]
    }
  }
}

/** 在门店周边生成 n 个竞品点（沿纬度方向每 60m 一个，全部落在 800m 内） */
function competitorsAround(n, { lat = LAT0, lng = LNG0, city = '上海' } = {}) {
  return Array.from({ length: n }, (_, i) => ({ latitude: lat + dLat(60 * (i + 1)), longitude: lng, city }))
}

describe('规则① 自我蚕食：按最近同品牌距离分档', () => {
  it('70m（贴身）记 +3 → 黄灯', () => {
    const r = buildStoreLights({
      stores: [store(1), store(2, { lat: LAT0 + dLat(70), code: 'A', area: 300 })],
      competitorCities: new Set(),
      competitors: []
    })
    const a = r.lights.find(l => l.storeId === 1)
    expect(a.selfBucket).toBe('close')
    expect(a.flags).toContain('cannibal')
    expect(a.riskScore).toBe(3)
    expect(a.riskLevel).toBe('mid')
    // 双向：两家都该被判贴身
    expect(r.rules.cannibal).toBe(2)
  })

  it('500m（部分重叠）记 +2 → 绿灯', () => {
    const r = buildStoreLights({
      stores: [store(1, { code: 'A', area: 300 }), store(2, { lat: LAT0 + dLat(500), code: 'B', area: 300 })],
      competitorCities: new Set(), competitors: []
    })
    const a = r.lights.find(l => l.storeId === 1)
    expect(a.selfBucket).toBe('overlap')
    expect(a.riskScore).toBe(2)
    expect(a.riskLevel).toBe('low')
  })

  it('5km（>800m）不计分 —— 这是老口径最大的失真点', () => {
    const r = buildStoreLights({
      stores: [store(1, { code: 'A', area: 300 }), store(2, { lat: LAT0 + dLat(5000), code: 'B', area: 300 })],
      competitorCities: new Set(), competitors: []
    })
    const a = r.lights.find(l => l.storeId === 1)
    // 老口径「同一商圈 ≥2 家」会把这两家判成自我蚕食（生产上 68 家就是这样被误判的）
    expect(a.flags).not.toContain('cannibal')
    expect(a.riskScore).toBe(0)
    expect(a.nearestM).toBeGreaterThan(4900)
  })

  it('同址双店型（编码不同 + 面积差 ≥2 倍）⛔ 不计分，但要在明细里说明', () => {
    const r = buildStoreLights({
      stores: [
        store(1, { code: '8001', area: 345 }),
        store(2, { lat: LAT0 + dLat(15), code: '2025', area: 120 })
      ],
      competitorCities: new Set(), competitors: []
    })
    const a = r.lights.find(l => l.storeId === 1)
    expect(a.selfBucket).toBe('sameDual')
    expect(a.dualFormat).toBe(true)
    expect(a.flags).not.toContain('cannibal')
    expect(a.riskScore).toBe(0)
    expect(r.rules.selfDetail.sameDual).toBe(2)
    expect(r.rules.cannibal).toBe(0)
  })

  it('同址但**同一编码**（真重复）照常记 +3', () => {
    const r = buildStoreLights({
      stores: [
        store(1, { code: '8001', area: 300 }),
        store(2, { lat: LAT0 + dLat(15), code: '8001', area: 300 })
      ],
      competitorCities: new Set(), competitors: []
    })
    const a = r.lights.find(l => l.storeId === 1)
    expect(a.selfBucket).toBe('same')
    expect(a.dualFormat).toBe(false)
    expect(a.riskScore).toBe(3)
    expect(r.rules.selfDetail.same).toBe(2)
  })

  it('跨品牌同址不参与判定', () => {
    const r = buildStoreLights({
      stores: [
        store(1, { brand: '甲', code: 'A', area: 300 }),
        store(2, { lat: LAT0 + dLat(10), brand: '乙', code: 'B', area: 100 })
      ],
      competitorCities: new Set(), competitors: []
    })
    expect(r.rules.cannibal).toBe(0)
    expect(r.lights[0].nearestM).toBeNull()
  })
})

describe('规则② 竞争密度：半径内同业态竞品', () => {
  it('800m 内 3 个竞品 ⇒ +2；6 个 ⇒ +3', () => {
    const few = buildStoreLights({
      stores: [store(1)],
      competitors: competitorsAround(COMP_MID),
      competitorCities: new Set(['上海'])
    })
    expect(few.lights[0].compStatus).toBe(COMP_STATUS.EVALUATED)
    expect(few.lights[0].compRing).toBe(COMP_MID)
    expect(few.lights[0].riskScore).toBe(2)
    expect(few.lights[0].flags).toContain('competition')

    const many = buildStoreLights({
      stores: [store(1)],
      competitors: competitorsAround(COMP_HIGH),
      competitorCities: new Set(['上海'])
    })
    expect(many.lights[0].compRing).toBe(COMP_HIGH)
    expect(many.lights[0].riskScore).toBe(3)
  })

  it('500m 外的竞品不算进 800m 环', () => {
    const r = buildStoreLights({
      stores: [store(1)],
      competitors: [{ latitude: LAT0 + dLat(COMP_RADIUS_M + 200), longitude: LNG0, city: '上海' }],
      competitorCities: new Set(['上海'])
    })
    expect(r.lights[0].compRing).toBe(0)
    expect(r.lights[0].riskScore).toBe(0)
  })

  it('🔴 账号没有竞品点位 ⇒ 未评（compRing 必须是 null，⛔ 不能是 0）', () => {
    const r = buildStoreLights({
      stores: [store(1)],
      competitors: [],
      competitorCities: new Set()
    })
    const a = r.lights[0]
    expect(a.compStatus).toBe(COMP_STATUS.NO_DATA)
    expect(a.compRing).toBeNull()
    expect(a.riskScore).toBe(0)
    // 绿灯必须自己带上「竞争未评」，否则会被读成「竞争也查过了、没问题」
    expect(a.partial).toBe(true)
    expect(r.rules.competitionPartial).toBe(1)
    expect(r.rules.competitionNoData).toBe(1)
  })

  it('城市有竞品点位、但门店周边 0 家 ⇒ 这是**已评估**的 0（合法结论，不是未评）', () => {
    const far = [{ latitude: LAT0 + dLat(9000), longitude: LNG0, city: '上海' }]
    const r = buildStoreLights({
      stores: [store(1)],
      competitors: far,
      competitorCities: new Set(['上海'])
    })
    expect(r.lights[0].compStatus).toBe(COMP_STATUS.EVALUATED)
    expect(r.lights[0].compRing).toBe(0)
    expect(r.lights[0].partial).toBe(false)
    expect(r.rules.competitionNoData).toBe(0)
  })

  it('门店城市为空 ⇒ 竞争未评（no_city），不硬算', () => {
    const r = buildStoreLights({
      stores: [store(1, { city: '' })],
      competitors: competitorsAround(6),
      competitorCities: new Set(['上海'])
    })
    expect(r.lights[0].compStatus).toBe(COMP_STATUS.NO_CITY)
    expect(r.lights[0].compRing).toBeNull()
    expect(r.rules.competitionNoCity).toBe(1)
  })
})

describe('风险分级', () => {
  it('贴身(+3) + 竞品 6 家(+3) ⇒ 红', () => {
    const r = buildStoreLights({
      stores: [store(1), store(2, { lat: LAT0 + dLat(70), code: 'B', area: 300 })],
      competitors: competitorsAround(COMP_HIGH),
      competitorCities: new Set(['上海'])
    })
    const a = r.lights.find(l => l.storeId === 1)
    expect(a.riskScore).toBe(6)
    expect(a.riskScore).toBeGreaterThanOrEqual(RISK_HIGH)
    expect(a.riskLevel).toBe('high')
    expect(a.flags).toEqual(expect.arrayContaining(['cannibal', 'competition']))
  })

  it('两项都不命中 ⇒ none；分数 3 是黄、2 是绿', () => {
    const none = buildStoreLights({ stores: [store(1)], competitorCities: new Set(), competitors: [] })
    expect(none.lights[0].riskLevel).toBe('none')
    expect(RISK_MID).toBe(3)
  })

  it('高风险排在前面，缺坐标的排最后', () => {
    const r = buildStoreLights({
      stores: [
        store(1),
        { id: 2, name: '缺坐标', brand: '甲', city: '上海', latitude: null, longitude: null },
        store(3, { lat: LAT0 + dLat(70), code: 'B', area: 300 })
      ],
      competitorCities: new Set(), competitors: []
    })
    expect(r.lights.map(l => l.storeId)).toEqual([1, 3, 2])
  })
})

describe('商圈面只是展示字段', () => {
  it('落在面外仍然「已评估」（不再有灰灯/盲区）', () => {
    const r = buildStoreLights({
      stores: [store(1, { lat: 31.9, lng: 121.9 })],
      districts: [square('南京西路')],
      competitorCities: new Set(), competitors: []
    })
    expect(r.lights[0].status).toBe(STATUS.EVALUATED)
    expect(r.lights[0].district).toBe('')
    expect(r.lights[0].districtCovered).toBe(false)
    expect(r.blind).toBe(0)
  })

  it('落在面内只补名称/能级/客群，不影响分数', () => {
    const inside = buildStoreLights({
      stores: [store(1)], districts: [square('南京西路')],
      competitorCities: new Set(), competitors: []
    })
    const outside = buildStoreLights({
      stores: [store(1)], districts: [],
      competitorCities: new Set(), competitors: []
    })
    expect(inside.lights[0].district).toBe('南京西路')
    expect(inside.lights[0].riskScore).toBe(outside.lights[0].riskScore)
  })
})

describe('缺坐标与分布自洽', () => {
  it('缺经纬度 / 0,0 归 no_coord，风险分必须是 null', () => {
    const r = buildStoreLights({
      stores: [
        { id: 1, name: 'a', brand: '甲', city: '上海', latitude: null, longitude: null },
        { id: 2, name: 'b', brand: '甲', city: '上海', latitude: 0, longitude: 0 }
      ],
      competitorCities: new Set(), competitors: []
    })
    expect(r.noCoord).toBe(2)
    expect(r.evaluated).toBe(0)
    expect(r.lights.every(l => l.riskScore === null)).toBe(true)
    expect(r.lights.every(l => l.status === STATUS.NO_COORD)).toBe(true)
  })

  it('各状态家数之和 == 门店总数', () => {
    const r = buildStoreLights({
      stores: [
        store(1), store(2, { lat: LAT0 + dLat(70), code: 'B', area: 300 }),
        { id: 3, name: 'c', brand: '甲', city: '上海', latitude: null, longitude: null }
      ],
      competitorCities: new Set(), competitors: []
    })
    expect(r.evaluated + r.noCoord).toBe(3)
    expect(r.total).toBe(3)
    expect(r.byLevel.high + r.byLevel.mid + r.byLevel.low + r.byLevel.none).toBe(r.evaluated)
  })

  it('空输入不抛错', () => {
    const r = buildStoreLights({})
    expect(r.total).toBe(0)
    expect(r.lights).toEqual([])
    expect(r.districtCount).toBe(0)
  })
})

describe('扎堆组（替代老口径的「同商圈 8 家」）', () => {
  it('三店两两 ≤800m 连通成一团，count = 3', () => {
    const r = buildStoreLights({
      stores: [
        store(1, { code: 'A', area: 300 }),
        store(2, { lat: LAT0 + dLat(400), code: 'B', area: 300 }),
        store(3, { lat: LAT0 + dLat(750), code: 'C', area: 300 })
      ],
      competitorCities: new Set(), competitors: []
    })
    expect(r.rules.cannibalDistricts).toBe(1)
    expect(r.rules.clusters[0].count).toBe(3)
    expect(r.rules.cannibalTop[0].count).toBe(3)
  })

  it('相距 5km 的两家不成团', () => {
    const r = buildStoreLights({
      stores: [store(1), store(2, { lat: LAT0 + dLat(5000) })],
      competitorCities: new Set(), competitors: []
    })
    expect(r.rules.cannibalDistricts).toBe(0)
    expect(r.rules.clusters).toEqual([])
  })
})

describe('阈值只有一处来源', () => {
  it('接口返回的 thresholds 与导出常量一致（前端文案从接口取值，⛔ 不硬编码）', () => {
    const r = buildStoreLights({ stores: [], competitors: [], competitorCities: new Set() })
    expect(r.thresholds).toMatchObject({
      sameAddrM: SAME_ADDR_M,
      closeM: CLOSE_M,
      overlapM: OVERLAP_M,
      compRadiusM: COMP_RADIUS_M,
      compMid: COMP_MID,
      compHigh: COMP_HIGH,
      riskHigh: RISK_HIGH,
      riskMid: RISK_MID
    })
  })

  it('接口可以按业态覆盖竞争阈值（实测优事：800m 内 p90 只有 3 家，固定 16 家永不触发）', () => {
    const r = buildStoreLights({
      stores: [store(1)],
      competitors: competitorsAround(3),
      competitorCities: new Set(['上海']),
      opts: { compMid: 2, compHigh: 3 }
    })
    expect(r.lights[0].riskScore).toBe(3)
    expect(r.thresholds.compHigh).toBe(3)
  })
})
