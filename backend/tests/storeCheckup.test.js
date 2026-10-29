/**
 * 门店位置体检 · 几何计算守卫（v1.13.291）
 *
 * 这里钉的都是「错了会让客户做错决定」的口径：
 *   ① ⛔ 跨品牌不参与判定（同账号多品牌 / 同商场双品牌同址是常态）
 *   ② 「≤50m 同品牌」只标 `dualFormat` 提示复核，**不得**变成合并建议
 *   ③ 缺坐标的店不进几何，但必须在 `noCoord` 里被数出来（不能静默消失）
 *   ④ 分布桶之和必须等于「有坐标门店数」，否则饼图/直方图会骗人
 *   ⑤ 中位数空集返 null（⛔ 不是 0）
 */
import { describe, it, expect } from 'vitest'
import {
  buildStoreCheckup, bucketOfDistance, bucketOfArea, median,
  DISTANCE_BUCKETS, AREA_BUCKETS
} from '../src/utils/storeCheckup.js'

const BASE = { latitude: 31.23, longitude: 121.47 }
// 纬度 +0.001° ≈ 111m；+0.01° ≈ 1.11km
const at = (dLat) => ({ latitude: BASE.latitude + dLat, longitude: BASE.longitude })

const store = (id, brand, dLat, extra = {}) => ({
  id, name: `店${id}`, brand, store_code: `C${id}`, store_area: 100,
  city: '上海', address: '某路 1 号', store_type: '已开业',
  ...at(dLat), ...extra
})

describe('bucketOfDistance / bucketOfArea：分档边界左闭右开', () => {
  it('距离分档', () => {
    expect(bucketOfDistance(0)).toBe('same')
    expect(bucketOfDistance(49.9)).toBe('same')
    expect(bucketOfDistance(50)).toBe('close')      // 50 归下一档
    expect(bucketOfDistance(299)).toBe('close')
    expect(bucketOfDistance(300)).toBe('overlap')
    expect(bucketOfDistance(799)).toBe('overlap')
    expect(bucketOfDistance(800)).toBe('weak')
    expect(bucketOfDistance(1999)).toBe('weak')
    expect(bucketOfDistance(2000)).toBe('alone')
  })

  it('面积分档', () => {
    expect(bucketOfArea(119)).toBe('xs')
    expect(bucketOfArea(120)).toBe('s')
    expect(bucketOfArea(200)).toBe('m')
    expect(bucketOfArea(350)).toBe('l')
  })

  it('中位数：偶数取平均，空集返 null（⛔ 不是 0）', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(median(null)).toBeNull()
  })

  it('分档表与报告口径一致（5 档距离 / 4 档面积）', () => {
    expect(DISTANCE_BUCKETS.map(b => b.key)).toEqual(['same', 'close', 'overlap', 'weak', 'alone'])
    expect(AREA_BUCKETS.map(b => b.key)).toEqual(['xs', 's', 'm', 'l'])
  })
})

describe('buildStoreCheckup：跨品牌必须不参与', () => {
  it('两家不同品牌完全同址 ⇒ 无最近距离、无复核对', () => {
    const r = buildStoreCheckup([
      store(1, '滨寿司', 0),
      store(2, '食其家', 0) // 同坐标、不同品牌
    ])
    expect(r.counts.pairs).toBe(0)
    expect(r.counts.sameAddrPairs).toBe(0)
    expect(r.medianNearestM).toBeNull()          // 彼此不算邻居
    expect(r.bucketCounts.alone).toBe(2)         // 都算「基本独立」
  })
})

describe('buildStoreCheckup：同品牌同址 → 只提示不合并', () => {
  it('编码不同 + 面积比 ≥2 ⇒ dualFormat，且不计入 suspected', () => {
    const r = buildStoreCheckup([
      store(1, '优事', 0, { store_code: '8001', store_area: 380 }),
      store(2, '优事', 0, { store_code: '2001', store_area: 110 })
    ])
    expect(r.counts.pairs).toBe(1)
    expect(r.counts.sameAddrPairs).toBe(1)
    expect(r.counts.sameAddrStores).toBe(2)
    expect(r.pairs[0].dualFormat).toBe(true)
    expect(r.counts.dualFormatPairs).toBe(1)
    expect(r.counts.suspectedPairs).toBe(0)
    // ⛔ 结果里不得出现任何「建议合并」字段
    expect(Object.keys(r.pairs[0])).not.toContain('mergeable')
  })

  it('编码相同 ⇒ 不是双店型（更像重复），标 suspected 交人工', () => {
    const r = buildStoreCheckup([
      store(1, '优事', 0, { store_code: 'SAME', store_area: 120 }),
      store(2, '优事', 0, { store_code: 'SAME', store_area: 118 })
    ])
    expect(r.pairs[0].dualFormat).toBe(false)
    expect(r.counts.suspectedPairs).toBe(1)
  })

  it('面积缺失不判双店型（退回疑似，交人工）', () => {
    const r = buildStoreCheckup([
      store(1, '优事', 0, { store_code: '8001' }),
      store(2, '优事', 0, { store_code: '2001', store_area: null })
    ])
    expect(r.pairs[0].dualFormat).toBe(false)
  })
})

describe('buildStoreCheckup：计数与分布自洽', () => {
  it('缺坐标不进几何，但必须被数出来', () => {
    const r = buildStoreCheckup([
      store(1, '优事', 0),
      { id: 2, name: '无坐标', brand: '优事', latitude: null, longitude: null },
      { id: 3, name: '零值坐标', brand: '优事', latitude: 0, longitude: 0 }
    ])
    expect(r.counts.total).toBe(3)
    expect(r.counts.withCoord).toBe(1)
    expect(r.counts.noCoord).toBe(2)
    // 分布桶之和 == 有坐标门店数（否则图表会骗人）
    const sum = Object.values(r.bucketCounts).reduce((a, b) => a + b, 0)
    expect(sum).toBe(r.counts.withCoord)
  })

  it('最近距离只取同品牌最近一家', () => {
    const r = buildStoreCheckup([
      store(1, '优事', 0),
      store(2, '优事', 0.001),  // 与 1 ≈111m ⇒ 两家最近都在 close
      store(3, '优事', 0.01)    // 与 2 ≈1.0km（离 1 的 1.11km 更远）⇒ weak
    ])
    expect(r.bucketCounts.same).toBe(0)
    expect(r.bucketCounts.close).toBe(2) // 1 和 2 互为最近（≈111m）
    expect(r.bucketCounts.weak).toBe(1)  // 3 的最近是 2（≈1.0km），不是 1
    expect(r.counts.pairs).toBe(1)       // 只有 1-2 在 300m 内
    const sum = Object.values(r.bucketCounts).reduce((a, b) => a + b, 0)
    expect(sum).toBe(r.counts.withCoord)
  })

  it('nearM 收紧后清单变短（阈值可控）', () => {
    const rows = [store(1, '优事', 0), store(2, '优事', 0.002)] // ≈222m
    const wide = buildStoreCheckup(rows, { nearM: 300 })
    const tight = buildStoreCheckup(rows, { nearM: 100 })
    expect(wide.counts.pairs).toBe(1)
    expect(tight.counts.pairs).toBe(0)
    // 但「最近距离」与分布不随 nearM 变
    expect(wide.bucketCounts.close).toBe(tight.bucketCounts.close)
  })

  it('默认搜索窗足够大：11km 的同品牌邻居仍进中位数（窗口设小会把中位拉小）', () => {
    const r = buildStoreCheckup([store(1, '优事', 0), store(2, '优事', 0.1)]) // ≈11km
    expect(r.counts.noNeighbor).toBe(0)
    expect(r.medianBasis).toBe(2)
    expect(r.medianNearestM).toBeGreaterThan(10000)
  })

  it('超过 capM 视为基本独立（不再算精确距离）', () => {
    const r = buildStoreCheckup([
      store(1, '优事', 0),
      store(2, '优事', 0.1) // ≈11km > capM 5km
    ], { capM: 5000 })
    expect(r.counts.pairs).toBe(0)
    expect(r.bucketCounts.alone).toBe(2)
  })

  it('面积分档只统计有面积的店', () => {
    const r = buildStoreCheckup([
      store(1, '优事', 0, { store_area: 90 }),
      store(2, '优事', 0.05, { store_area: 380 }),
      store(3, '优事', 0.09, { store_area: null })
    ])
    expect(r.counts.withArea).toBe(2)
    expect(r.counts.noArea).toBe(1)
    expect(r.areaBuckets.xs).toBe(1)
    expect(r.areaBuckets.l).toBe(1)
  })

  it('空台账不抛错', () => {
    const r = buildStoreCheckup([])
    expect(r.counts.total).toBe(0)
    expect(r.medianNearestM).toBeNull()
    expect(r.pairs).toEqual([])
  })
})
