/**
 * 智能选址 · 纯函数层测试（v1.13.370 / 批次 370）
 *
 * 覆盖立项稿 §11 的「纯函数单测」与「相对分位守卫」两块：
 *   · 圆内人口加权（整格 / 外离 / 边界，含 **MultiPolygon**）
 *   · 相对分位（基准、缺值、全等值）
 *   · NMS 去重（边界、排序、limit）
 *   · 五维归一化（未评维度不进分母）
 *   · 分档边界（A1 / A2 / E）
 *   · 推荐理由（必须带账期、必须写「代理」）
 *   · 饱和保护的同址双店合并
 *
 * ⚠️ 这些断言都针对**纯函数**，不碰数据库、不调联通 —— 因此可以放心跑全量。
 */

import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'

import {
  buildGridIndex, circlePopulation, percentileThresholds, percentileScore,
  median, quantile, resolveGridCity, parseFieldNames, GRID_POP_FIELD
} from '../src/utils/gridPopulation.js'
import {
  enumerateGrid, bboxAreaKm2, isBboxValid, buildPointIndex,
  countWithin, nearestDistance, sameBrandEffectiveCount, nms
} from '../src/utils/potentialGrid.js'
import {
  siteCrowdScore, arpuScore, arpuHighPct, combineCrowd, cannibalScore,
  scoreSite, buildReason, accessScore
} from '../src/utils/siteScore.js'
import {
  SITE_WEIGHTS, PRECISE_TOPK, MIN_GAP, SATURATION_DEFAULT
} from '../src/utils/siteSelectConfig.js'

/** 造一个 latLon 方格 feature（边长约 1km） */
function squareFeature(lng, lat, sideDeg = 0.00899, pop = 1000) {
  const h = sideDeg / 2
  // ⚠️ 属性必须作为 turf.polygon 的第二参数传入。
  //    写成 turf.feature(turf.polygon(...), props) 会**丢掉 properties** ——
  //    那样 hasField=false、整城视同无网格，测试会莫名其妙全红。
  return turf.polygon([[
    [lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]
  ]], { [GRID_POP_FIELD]: pop })
}

describe('A. 网格字段与城市解析', () => {
  it('字段名常量必须是「常住人口」（⛔ 不是居住人数）', () => {
    expect(GRID_POP_FIELD).toBe('常住人口')
  })

  it('resolveGridCity 三种来源按优先级', () => {
    expect(resolveGridCity({ city: '上海市', name: 'xx' })).toBe('上海市')
    expect(resolveGridCity({ city: '', name: '重庆1km网格人口' })).toBe('重庆')
    expect(resolveGridCity({ city: '', name: '宜宾.zip' })).toBe('宜宾')
  })

  it('parseFieldNames 容错（数组 / JSON 字符串 / 垃圾）', () => {
    expect(parseFieldNames(['a'])).toEqual(['a'])
    expect(parseFieldNames('["a","b"]')).toEqual(['a', 'b'])
    expect(parseFieldNames('not json')).toEqual([])
    expect(parseFieldNames(null)).toEqual([])
  })
})

describe('B. 圆内人口加权', () => {
  it('候选点落在格中心 ⇒ 整格计入', () => {
    const idx = buildGridIndex([squareFeature(121.5, 31.3, 0.00899, 1000)])
    expect(idx.covered).toBe(true)
    const r = circlePopulation(idx, 121.5, 31.3, 1000)
    expect(r.pop).toBeCloseTo(1000, 0)
    expect(r.whole).toBe(1)
    expect(r.partial).toBe(0)
  })

  it('候选点远离 ⇒ 比例 0（⛔ 不误算）', () => {
    const idx = buildGridIndex([squareFeature(121.5, 31.3)])
    const r = circlePopulation(idx, 122.5, 31.3, 1000)
    expect(r.pop).toBe(0)
  })

  it('边界格走 turf.intersect，比例在 (0,1) 之间', () => {
    const idx = buildGridIndex([squareFeature(121.5, 31.3)])
    // 圆心在格东边界外 200m ⇒ 只覆盖一部分
    const r = circlePopulation(idx, 121.5 + 0.00899 / 2 + 0.002, 31.3, 1000)
    expect(r.partial).toBeGreaterThan(0)
    expect(r.pop).toBeGreaterThan(0)
    expect(r.pop).toBeLessThan(1000)
  })

  it('🔴 MultiPolygon 不抛错、且按各 part 面积求和（老接口在这里会静默丢格）', () => {
    // 两个相距约 6km 的方格组成 MultiPolygon —— 若按 turf.polygon(coordinates) 硬包装会抛错
    const a = turf.polygon([[
      [121.49, 31.29], [121.50, 31.29], [121.50, 31.30], [121.49, 31.30], [121.49, 31.29]
    ]])
    const b = turf.polygon([[
      [121.54, 31.29], [121.55, 31.29], [121.55, 31.30], [121.54, 31.30], [121.54, 31.29]
    ]])
    const multi = turf.multiPolygon([a.geometry.coordinates, b.geometry.coordinates], { [GRID_POP_FIELD]: 2000 })
    const idx = buildGridIndex([multi])
    expect(idx.covered).toBe(true)
    // 圆心落在 a 的中心 ⇒ 只覆盖一个 part ≈ 一半
    const r = circlePopulation(idx, 121.495, 31.295, 700)
    expect(r.pop).toBeGreaterThan(0)
    expect(r.pop).toBeLessThan(2000)
  })

  it('过滤 0 值格：不影响求和，但不进分位样本', () => {
    const idx = buildGridIndex([
      squareFeature(121.5, 31.3, 0.00899, 0),
      squareFeature(121.52, 31.3, 0.00899, 500)
    ])
    expect(idx.cells.length).toBe(1)
    expect(idx.skipped).toBe(1)
    expect(idx.cells[0].pop).toBe(500)
  })

  it('缺「常住人口」字段 ⇒ hasField=false（调用方据此判定无网格）', () => {
    const f = turf.feature(turf.polygon([[[121.49, 31.29], [121.50, 31.29], [121.50, 31.30], [121.49, 31.30], [121.49, 31.29]]]), { 居住人数: 800 })
    const idx = buildGridIndex([f])
    expect(idx.hasField).toBe(false)
    expect(idx.covered).toBe(false)
  })

  it('未构建索引时安全返回 0', () => {
    expect(circlePopulation(null, 121, 31, 1000).pop).toBe(0)
  })
})

describe('C. 相对分位', () => {
  it('median / quantile 空集返回 null（⛔ 不返 0 冒充有值）', () => {
    expect(median([])).toBe(null)
    expect(quantile([], 0.5)).toBe(null)
  })

  it('分位门槛与打分：高值 95 / 低值 40', () => {
    const vals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const t = percentileThresholds(vals)
    expect(t.p50).toBeCloseTo(55, 0)
    expect(percentileScore(100, t)).toBe(95)
    expect(percentileScore(1, t)).toBe(40)
  })

  it('全等值样本：所有点同分（不因"相对"而人为拉开）', () => {
    const t = percentileThresholds([500, 500, 500])
    expect(percentileScore(500, t)).toBe(95)   // >= p90 = 500
  })

  it('样本不足（<2）时 p50 仍有值但门槛退化，打分仍确定', () => {
    const t = percentileThresholds([700])
    expect(t.p50).toBe(700)
    expect(percentileScore(700, t)).toBe(95)
    expect(percentileScore(100, t)).toBe(40)
  })

  it('空样本 ⇒ 门槛为 null ⇒ 打分返回 null（该维度未评，⛔ 不给分）', () => {
    const t = percentileThresholds([])
    expect(percentileScore(100, t)).toBe(null)
  })
})

describe('D. 撒点与点索引', () => {
  it('bbox 合法性（中国境内 / 顺序 / 零面积）', () => {
    expect(isBboxValid([121.4, 31.2, 121.6, 31.35])).toBe(true)
    expect(isBboxValid([121.6, 31.2, 121.4, 31.35])).toBe(false)  // 顺序反
    expect(isBboxValid([200, 31, 201, 32])).toBe(false)           // 境外
    expect(isBboxValid([121.4, 31.2, 121.4, 31.35])).toBe(false)  // 零宽度
    expect(isBboxValid(null)).toBe(false)
  })

  it('bbox 面积换算（0.2°×0.15° 在 31°N ≈ 328 km²）', () => {
    const a = bboxAreaKm2([121.4, 31.2, 121.6, 31.35])
    expect(a).toBeGreaterThan(280)
    expect(a).toBeLessThan(360)
  })

  it('枚举：格数 = cols × rows，中心点都在 bbox 内', () => {
    const bbox = [121.40, 31.20, 121.46, 31.26]
    const g = enumerateGrid(bbox, 1000)
    expect(g.cols).toBeGreaterThan(0)
    expect(g.rows).toBeGreaterThan(0)
    expect(g.points.length).toBe(g.cols * g.rows)
    for (const p of g.points) {
      expect(p.lng).toBeGreaterThan(bbox[0])
      expect(p.lng).toBeLessThan(bbox[2])
      expect(p.lat).toBeGreaterThan(bbox[1])
      expect(p.lat).toBeLessThan(bbox[3])
    }
  })

  it('步长翻倍 ⇒ 格数约减少到 1/4', () => {
    const bbox = [121.40, 31.20, 121.52, 31.32]
    const g1 = enumerateGrid(bbox, 500)
    const g2 = enumerateGrid(bbox, 1000)
    const ratio = g1.points.length / g2.points.length
    expect(ratio).toBeGreaterThan(3)
    expect(ratio).toBeLessThan(5)
  })

  it('非法 bbox ⇒ 空结果（不抛错）', () => {
    expect(enumerateGrid(null, 1000).points.length).toBe(0)
  })

  it('圆内计数与品牌分布', () => {
    const idx = buildPointIndex([
      { brand: '肯德基', longitude: 121.5000, latitude: 31.3000 },
      { brand: '肯德基', longitude: 121.5010, latitude: 31.3000 },
      { brand: '麦当劳', longitude: 121.5020, latitude: 31.3000 },
      { brand: '远店', longitude: 121.9000, latitude: 31.3000 }
    ])
    const r = countWithin(idx, 121.5000, 31.3000, 1000)
    expect(r.count).toBe(3)
    expect(r.byBrand['肯德基']).toBe(2)
    expect(r.byBrand['麦当劳']).toBe(1)
  })

  it('(0,0) 脏坐标不参与索引', () => {
    const idx = buildPointIndex([{ brand: 'x', longitude: 0, latitude: 0 }])
    expect(idx.arr.length).toBe(0)
  })

  it('最近距离：窗外返回 null（⛔ 不返 Infinity 让上层误用）', () => {
    const idx = buildPointIndex([{ brand: 'a', longitude: 121.52, latitude: 31.3 }])
    expect(nearestDistance(idx, 121.5, 31.3, 50000)).toBeGreaterThan(1000)
    expect(nearestDistance(idx, 121.5, 31.3, 500)).toBe(null)
  })
})

describe('E. 饱和保护：同址双店型合并', () => {
  const store = (id, lng, lat, area, code) => ({
    id, brand: 'youshi', longitude: lng, latitude: lat, store_area: area, store_code: code
  })

  it('两家相距 1200m 同名品牌 ⇒ 计 2 家', () => {
    const stores = [store(1, 121.500, 31.300, 200, 'A1'), store(2, 121.512, 31.300, 200, 'A2')]
    const idx = buildPointIndex(stores)
    expect(sameBrandEffectiveCount(idx, 121.506, 31.300, 2000)).toBe(2)
  })

  it('🔴 同址（30m）双店型（编码不同 + 面积比 ≥2）⇒ 只计 1 家', () => {
    const stores = [store(1, 121.5000, 31.3000, 60, 'S1'), store(2, 121.5003, 31.3000, 300, 'S2')]
    const idx = buildPointIndex(stores)
    expect(sameBrandEffectiveCount(idx, 121.5000, 31.3000, 2000)).toBe(1)
  })

  it('同址但编码相同（同一条记录录两遍）⇒ 不按双店型合并，计 2 家（交给清洗流程）', () => {
    const stores = [store(1, 121.5000, 31.3000, 60, 'SAME'), store(2, 121.5003, 31.3000, 300, 'SAME')]
    const idx = buildPointIndex(stores)
    expect(sameBrandEffectiveCount(idx, 121.5000, 31.3000, 2000)).toBe(2)
  })

  it('面积缺失 ⇒ 不判双店型（suspected 走人工），计 2 家', () => {
    const stores = [store(1, 121.5000, 31.3000, 0, 'X1'), store(2, 121.5003, 31.3000, 0, 'X2')]
    const idx = buildPointIndex(stores)
    expect(sameBrandEffectiveCount(idx, 121.5000, 31.3000, 2000)).toBe(2)
  })

  it('半径外的店不计', () => {
    const stores = [store(1, 121.5000, 31.3000, 200, 'A1'), store(2, 121.5500, 31.3000, 200, 'A2')]
    const idx = buildPointIndex(stores)
    expect(sameBrandEffectiveCount(idx, 121.5000, 31.3000, 2000)).toBe(1)
  })
})

describe('F. NMS 去重', () => {
  it('相距 500m 的两点，gap 800 ⇒ 只留高分', () => {
    const out = nms([
      { center: [121.5000, 31.3000], score: 80 },
      { center: [121.5058, 31.3000], score: 90 }   // ≈500m
    ], 800)
    expect(out.length).toBe(1)
    expect(out[0].score).toBe(90)
  })

  it('相距 1200m ⇒ 都保留', () => {
    const out = nms([
      { center: [121.5000, 31.3000], score: 80 },
      { center: [121.5138, 31.3000], score: 90 }
    ], 800)
    expect(out.length).toBe(2)
    expect(out[0].score).toBe(90)   // 降序
  })

  it('limit 生效（取前 N）', () => {
    const out = nms([
      { center: [121.5000, 31.3000], score: 80 },
      { center: [121.5200, 31.3000], score: 90 },
      { center: [121.5400, 31.3000], score: 70 }
    ], 500, 2)
    expect(out.length).toBe(2)
  })

  it('score 非法的项被丢弃（⛔ 不静默按 0 分排到末尾）', () => {
    const out = nms([
      { center: [121.5000, 31.3000], score: NaN },
      { center: [121.5200, 31.3000], score: 60 }
    ], 800)
    expect(out.length).toBe(1)
  })
})

describe('G. 分档打分边界', () => {
  it('A1 人口规模：阈值两侧', () => {
    expect(siteCrowdScore(80000)).toBe(95)
    expect(siteCrowdScore(79999)).toBe(85)
    expect(siteCrowdScore(5000)).toBe(40)
    expect(siteCrowdScore(4999)).toBe(22)
    expect(siteCrowdScore(0)).toBe(22)
    expect(siteCrowdScore(NaN)).toBe(null)
  })

  it('A2 消费力：45% 命中 95（文档是 ≥，不是 >）', () => {
    expect(arpuScore(45)).toBe(95)
    expect(arpuScore(44.9)).toBe(80)
    expect(arpuScore(15)).toBe(50)
    expect(arpuScore(1)).toBe(35)
    expect(arpuScore(null)).toBe(null)
  })

  it('arpuHighPct：只算居住人口的后三档（≥150 元）', () => {
    const pop = {
      arpu: {
        live: [
          { label: '50元以下', value: 10 }, { label: '50-100元', value: 20 },
          { label: '100-150元', value: 20 }, { label: '150-200元', value: 25 },
          { label: '200-250元', value: 15 }, { label: '250元以上', value: 10 }
        ]
      }
    }
    // 高段 = 25+15+10 = 50 / 100 = 50%
    expect(arpuHighPct(pop)).toBe(50)
  })

  it('arpuHighPct：总量 0 / 结构缺失 ⇒ null（⇒ A2 未评，⛔ 不按 0 分）', () => {
    expect(arpuHighPct({ arpu: { live: Array(6).fill({ label: 'x', value: 0 }) } })).toBe(null)
    expect(arpuHighPct({})).toBe(null)
    expect(arpuHighPct({ arpu: { live: [1, 2] } })).toBe(null)
  })

  it('A 合成：A2 缺失时退回 A1（⛔ 不按 0 拉低）', () => {
    expect(combineCrowd(90, 80)).toBe(87)     // (90*20 + 80*10)/30 = 86.67
    expect(combineCrowd(90, null)).toBe(90)
    expect(combineCrowd(null, 80)).toBe(null)
  })

  it('E 自牌蚕食：越远越好，且阈值是 300/800', () => {
    expect(cannibalScore(30)).toBe(20)
    expect(cannibalScore(300)).toBe(40)
    expect(cannibalScore(800)).toBe(70)
    expect(cannibalScore(5000)).toBe(95)
    expect(cannibalScore(null)).toBe(95)   // 窗内查不到 ⇒ 视为独立
  })

  it('D 可达配套分档（P0 未启用，但函数必须可用）', () => {
    expect(accessScore(50)).toBe(95)
    expect(accessScore(3)).toBe(20)
    expect(accessScore(null)).toBe(null)
  })
})

describe('H. 归一化：未评维度不进分母', () => {
  it('五维全评 ⇒ 分母 100', () => {
    const r = scoreSite({ crowd: 90, competition: 80, district: 70, access: 60, cannibal: 50 })
    expect(r.denominator).toBe(100)
    expect(r.score).toBe(Math.round((90 * 30 + 80 * 25 + 70 * 20 + 60 * 15 + 50 * 10) / 100))
    expect(r.missingDims).toEqual([])
  })

  it('商圈未评 ⇒ 分母 80，且不因缺数据被压低', () => {
    const r = scoreSite({ crowd: 90, competition: 80, district: null, access: 60, cannibal: 50 })
    expect(r.denominator).toBe(80)
    expect(r.missingDims).toEqual(['district'])
    expect(r.coverage.district).toBe(false)
    // 同分维度下，缺 C 不会让总分掉下去（因为分母同步缩小）
    expect(r.score).toBe(Math.round((90 * 30 + 80 * 25 + 60 * 15 + 50 * 10) / 80))
  })

  it('P0 实际形态（无 D、商圈未覆盖）⇒ 分母 65（30+25+10）', () => {
    const r = scoreSite({ crowd: 90, competition: 80, district: null, access: null, cannibal: 50 })
    expect(r.denominator).toBe(65)
    expect(r.missingDims.sort()).toEqual(['access', 'district'])
  })

  it('全未评 ⇒ score 为 null（⛔ 不返 0）', () => {
    const r = scoreSite({})
    expect(r.score).toBe(null)
    expect(r.denominator).toBe(0)
  })

  it('权重取自配置（单一来源），合计 100', () => {
    const sum = Object.values(SITE_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBe(100)
  })
})

describe('I. 推荐理由', () => {
  const raw = {
    live: 142000, work: 44000, arpuHighPct: 31.4,
    competitors: 5, competitorBrands: { 肯德基: 3, 麦当劳: 2 },
    nearestOwnM: 1420, ownWithin2km: 0, districtName: '五角场'
  }

  it('🔴 人口句必须带账期', () => {
    const r = buildReason(raw, { radius: 1000, cityMonth: '202609', districtName: '五角场', districtScore: 78 })
    expect(r[0]).toContain('1000m')
    expect(r[0]).toContain('14.2 万')
    expect(r[0]).toContain('202609')
  })

  it('🔴 消费力句必须写「代理」', () => {
    const r = buildReason(raw, { radius: 1000, cityMonth: '202609' })
    const line = r.find((x) => x.includes('话费'))
    expect(line).toContain('代理')
  })

  it('竞品句带品牌构成；0 家时明确写「无竞品」', () => {
    const r = buildReason(raw, { radius: 1000 })
    expect(r.some((x) => x.includes('竞品 5 家') && x.includes('肯德基'))).toBe(true)
    const r2 = buildReason({ ...raw, competitors: 0, competitorBrands: {} }, { radius: 1000 })
    expect(r2.some((x) => x.includes('无竞品'))).toBe(true)
  })

  it('⛔ 不出现无数据支撑的话术', () => {
    const r = buildReason(raw, { radius: 1000, cityMonth: '202609', districtName: '五角场', districtScore: 78 })
    const text = r.join('')
    expect(text).not.toContain('潜力巨大')
    expect(text).not.toContain('极佳')
    expect(text).not.toContain('绝佳')
  })

  it('最多 4 句（避免长文案淹没表格）', () => {
    const r = buildReason(raw, { radius: 1000, cityMonth: '202609', districtName: '五角场', districtScore: 78 })
    expect(r.length).toBeLessThanOrEqual(4)
  })
})

describe('J. 配置常量护栏（防误改）', () => {
  it('preciseTopK 上限 100、下限 10（单次成本上限）', () => {
    expect(PRECISE_TOPK.min).toBe(10)
    expect(PRECISE_TOPK.max).toBe(100)
  })

  it('minGap 默认 800（1km 网格 + 1km 半径必须去重）', () => {
    expect(MIN_GAP.default).toBe(800)
  })

  it('饱和默认 2km / ≥2 家', () => {
    expect(SATURATION_DEFAULT.radiusM).toBe(2000)
    expect(SATURATION_DEFAULT.maxOwn).toBe(2)
    expect(SATURATION_DEFAULT.enabled).toBe(true)
  })
})
