/**
 * 门店体检 · 商圈信号灯（v1.13.297）
 *
 * 规则与阈值来自 `Report4biz_免费门店体检_规则与实测_20261028.md`（已用 youshi 233 家实测）。
 * 本文件只钉**判定逻辑本身**，不碰数据库。
 */
import { describe, it, expect } from 'vitest'
import { buildStoreLights, STATUS, CROWD_SHARE_MIN, RISK_HIGH, RISK_MID } from '../src/utils/storeLights.js'

/** 造一个方形商圈面（边长 side 度） */
function square(name, { lat = 31.2, lng = 121.4, side = 0.02, level = '核心级', crowd = '居住主导', scoreCompetition = 55, city = '上海' } = {}) {
  const h = side / 2
  return {
    name,
    city,
    level,
    crowd,
    scoreCompetition,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]
      ]]
    }
  }
}

function store(id, { lat = 31.2, lng = 121.4, city = '上海', name = '' } = {}) {
  return { id, name: name || `店${id}`, brand: '甲', city, latitude: lat, longitude: lng }
}

describe('落圈判定', () => {
  it('面内门店进入 evaluated 并带上商圈名', () => {
    const r = buildStoreLights({ stores: [store(1)], districts: [square('南京西路')] })
    expect(r.evaluated).toBe(1)
    expect(r.blind).toBe(0)
    expect(r.lights[0].district).toBe('南京西路')
    expect(r.lights[0].status).toBe(STATUS.EVALUATED)
  })

  it('面外门店归盲区，且 riskScore 必须是 null 而不是 0', () => {
    const r = buildStoreLights({
      stores: [store(1, { lat: 31.5, lng: 121.9 })],
      districts: [square('南京西路')]
    })
    expect(r.blind).toBe(1)
    expect(r.evaluated).toBe(0)
    const l = r.lights[0]
    expect(l.status).toBe(STATUS.BLIND)
    // 🔴 关键：盲区是「没评估」，不是「0 分 ⇒ 低风险」
    expect(l.riskScore).toBeNull()
    expect(l.riskLevel).toBeNull()
    expect(r.byLevel.high + r.byLevel.mid + r.byLevel.low + r.byLevel.none).toBe(r.evaluated)
  })

  it('洞（内环）里的门店不算落圈', () => {
    const d = square('带洞商圈')
    d.geometry.coordinates.push([
      [121.395, 31.195], [121.405, 31.195], [121.405, 31.205], [121.395, 31.205], [121.395, 31.195]
    ])
    const r = buildStoreLights({ stores: [store(1, { lat: 31.2, lng: 121.4 })], districts: [d] })
    expect(r.blind).toBe(1)
  })

  it('MultiPolygon 的分离面各自算数（v1.13.276 的教训）', () => {
    const d = {
      name: '分离面商圈', city: '上海', level: '片区级', crowd: '商务主导', scoreCompetition: 55,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[121.40, 31.20], [121.41, 31.20], [121.41, 31.21], [121.40, 31.21], [121.40, 31.20]]],
          [[[121.50, 31.30], [121.51, 31.30], [121.51, 31.31], [121.50, 31.31], [121.50, 31.30]]]
        ]
      }
    }
    const r = buildStoreLights({
      stores: [store(1, { lat: 31.205, lng: 121.405 }), store(2, { lat: 31.305, lng: 121.505 })],
      districts: [d]
    })
    // 两个分离面里各一家 ⇒ 都算落圈，且构成「同商圈 2 家」
    expect(r.evaluated).toBe(2)
    expect(r.lights[0].ownInDistrict).toBe(2)
  })
})

describe('城市没有商圈面数据：⛔ 不算盲区', () => {
  it('城市无面 ⇒ noCityData，与 blind 分开计', () => {
    const r = buildStoreLights({
      stores: [store(1, { city: '乌鲁木齐', lat: 43.8, lng: 87.6 })],
      districts: [square('南京西路')]
    })
    expect(r.noCityData).toBe(1)
    expect(r.blind).toBe(0)
    expect(r.evaluated).toBe(0)
    expect(r.lights[0].status).toBe(STATUS.NO_CITY_DATA)
    expect(r.lights[0].riskScore).toBeNull()
  })
})

describe('缺坐标', () => {
  it('缺经纬度 / 0,0 归 noCoord，不参与任何统计', () => {
    const r = buildStoreLights({
      stores: [
        { id: 1, name: 'a', city: '上海', latitude: null, longitude: null },
        { id: 2, name: 'b', city: '上海', latitude: 0, longitude: 0 }
      ],
      districts: [square('南京西路')]
    })
    expect(r.noCoord).toBe(2)
    expect(r.evaluated).toBe(0)
    expect(r.blind).toBe(0)
  })
})

describe('规则① 竞争密集', () => {
  it('竞争宽松度 ≤35 记 +3；55 分不触发', () => {
    const dense = buildStoreLights({ stores: [store(1)], districts: [square('A', { scoreCompetition: 35 })] })
    expect(dense.lights[0].flags).toContain('competition')
    expect(dense.lights[0].riskScore).toBe(3)

    const loose = buildStoreLights({ stores: [store(1)], districts: [square('A', { scoreCompetition: 55 })] })
    expect(loose.lights[0].flags).not.toContain('competition')
    expect(loose.lights[0].riskScore).toBe(0)
  })
})

describe('规则② 自我蚕食', () => {
  it('同商圈 2 家记 +2，4 家记 +3', () => {
    const two = buildStoreLights({
      stores: [store(1, { lat: 31.2, lng: 121.4 }), store(2, { lat: 31.201, lng: 121.401 })],
      districts: [square('A')]
    })
    expect(two.lights[0].ownInDistrict).toBe(2)
    expect(two.rules.cannibal).toBe(2)
    expect(two.lights[0].riskScore).toBe(2)
    expect(two.byLevel.low).toBe(2)

    const four = buildStoreLights({
      stores: [1, 2, 3, 4].map(i => store(i, { lat: 31.2 + i * 0.0005, lng: 121.4 + i * 0.0005 })),
      districts: [square('A')]
    })
    expect(four.lights[0].ownInDistrict).toBe(4)
    expect(four.lights[0].riskScore).toBe(3)
    expect(four.rules.cannibalTop[0]).toEqual({ district: 'A', count: 4 })
  })

  it('不同商圈各 1 家 ⇒ 不触发自我蚕食', () => {
    const r = buildStoreLights({
      stores: [store(1, { lat: 31.2, lng: 121.4 }), store(2, { lat: 31.4, lng: 121.7 })],
      districts: [square('A'), square('B', { lat: 31.4, lng: 121.7 })]
    })
    expect(r.rules.cannibal).toBe(0)
    expect(r.rules.cannibalTop).toEqual([])
  })
})

describe('规则③ 客群偏离（自适应品牌）', () => {
  it('三类客群各占 1/3 ⇒ 全部不偏离（全客群覆盖型品牌，⛔ 不硬找茬）', () => {
    const ds = [
      square('A', { lat: 31.2, lng: 121.4, crowd: '居住主导' }),
      square('B', { lat: 31.4, lng: 121.4, crowd: '职住均衡' }),
      square('C', { lat: 31.6, lng: 121.4, crowd: '商务主导' })
    ]
    const r = buildStoreLights({
      stores: [store(1, { lat: 31.2 }), store(2, { lat: 31.4 }), store(3, { lat: 31.6 })],
      districts: ds
    })
    expect(r.rules.crowd).toBe(0)
    expect(r.crowdBaseline.map(b => b.share)).toEqual([1 / 3, 1 / 3, 1 / 3].map(x => expect.closeTo(x, 5)))
  })

  it('某客群占比 <20% ⇒ 该商圈的门店记偏离 +2', () => {
    // 5 家居住在 A，1 家在 B（商务）⇒ B 占 1/6 < 20%
    const stores = [1, 2, 3, 4, 5].map(i => store(i, { lat: 31.2 + i * 0.0003, lng: 121.4 }))
    stores.push(store(6, { lat: 31.4, lng: 121.4 }))
    const r = buildStoreLights({
      stores,
      districts: [
        square('A', { lat: 31.2, lng: 121.4, crowd: '居住主导' }),
        square('B', { lat: 31.4, lng: 121.4, crowd: '商务主导' })
      ]
    })
    const b = r.lights.find(l => l.district === 'B')
    expect(b.flags).toContain('crowd')
    expect(b.riskScore).toBe(2)
    const baseline = r.crowdBaseline.find(x => x.crowd === '商务主导')
    expect(baseline.share).toBeLessThan(CROWD_SHARE_MIN)
    expect(baseline.deviation).toBe(true)
  })
})

describe('风险分级与排序', () => {
  it('竞争密集 + 自有 ≥4 家 ⇒ 6 分判「高」', () => {
    const stores = [1, 2, 3, 4].map(i => store(i, { lat: 31.2 + i * 0.0005, lng: 121.4 }))
    const r = buildStoreLights({ stores, districts: [square('金桥', { scoreCompetition: 20 })] })
    expect(r.lights[0].riskScore).toBe(RISK_HIGH)
    expect(r.lights[0].riskLevel).toBe('high')
    expect(r.byLevel.high).toBe(4)
  })

  it('只有竞争密集（3 分）判「中」，两家中又各只有 1 家落同一商圈时不叠加', () => {
    const r = buildStoreLights({ stores: [store(1)], districts: [square('A', { scoreCompetition: 35 })] })
    expect(r.lights[0].riskScore).toBe(RISK_MID)
    expect(r.lights[0].riskLevel).toBe('mid')
  })

  it('高风险排在前面，未评估的排最后', () => {
    const r = buildStoreLights({
      stores: [
        store(1, { lat: 31.9, lng: 121.9 }),                                  // 面外 ⇒ 未评估
        store(2, { lat: 31.2, lng: 121.4 }),                                  // 落在拥挤商圈
        store(3, { lat: 31.4, lng: 121.4 })                                   // 落在宽松商圈
      ],
      districts: [
        square('拥挤', { lat: 31.2, lng: 121.4, scoreCompetition: 20 }),
        square('宽松', { lat: 31.4, lng: 121.4, scoreCompetition: 90 })
      ]
    })
    expect(r.lights.map(l => l.storeId)).toEqual([2, 3, 1])
  })
})

describe('分布自洽', () => {
  it('各状态家数之和 == 门店总数', () => {
    const r = buildStoreLights({
      stores: [
        store(1, { lat: 31.2, lng: 121.4 }),
        store(2, { lat: 31.5, lng: 121.9 }),
        store(3, { city: '乌鲁木齐', lat: 43.8, lng: 87.6 }),
        { id: 4, name: 'd', city: '上海', latitude: null, longitude: null }
      ],
      districts: [square('A')]
    })
    expect(r.evaluated + r.blind + r.noCityData + r.noCoord).toBe(4)
    expect(r.total).toBe(4)
  })

  it('空输入不抛错', () => {
    const r = buildStoreLights({})
    expect(r.total).toBe(0)
    expect(r.lights).toEqual([])
    expect(r.districtCount).toBe(0)
  })
})
