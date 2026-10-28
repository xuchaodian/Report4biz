/**
 * 门店台账去重算法单测（v1.13.282）
 *
 * 这是**纯函数单测**（不连数据库）。核心要守住的一条业务铁律：
 *   去重与蚕食都只在同一品牌内判定 —— 同一账号多品牌、同商场双品牌同址是常态，
 *   坐标常常完全相同。跨品牌若被判成重复，客户真实的两家店会被合并，属灾难性错误。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { findStoreDuplicates, distanceMeters, normalizeBrand } from '../src/utils/storeDedup.js'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const markersSrc = fs.readFileSync(path.join(REPO_ROOT, 'backend/src/routes/markers.js'), 'utf8')

const LAT0 = 31.2
const LNG0 = 121.4
// 该纬度下 1° 纬度 ≈ 111.32km ⇒ 用纬度偏移构造精确距离
const mToLat = (m) => m / 111320

let seq = 0
function store(name, brand, distM = 0, extra = {}) {
  seq += 1
  return {
    id: seq,
    name,
    brand,
    city: '上海',
    district: '徐汇区',
    address: '',
    longitude: LNG0,
    latitude: LAT0 + mToLat(distM),
    status: '正常',
    ...extra
  }
}

function resetSeq() { seq = 0 }

describe('距离与品牌归一化', () => {
  it('同点距离为 0', () => {
    const a = { longitude: LNG0, latitude: LAT0 }
    expect(distanceMeters(a, a)).toBe(0)
  })

  it('纬度偏移 100m 时距离约 100m（容差 1m）', () => {
    const a = { longitude: LNG0, latitude: LAT0 }
    const b = { longitude: LNG0, latitude: LAT0 + mToLat(100) }
    expect(Math.abs(distanceMeters(a, b) - 100)).toBeLessThan(1)
  })

  it('品牌归一化：去空白、大小写不敏感', () => {
    expect(normalizeBrand(' 优事 ')).toBe('优事')
    expect(normalizeBrand('优事  寿司')).toBe('优事 寿司')
    expect(normalizeBrand('abc')).toBe(normalizeBrand('ABC'))
    expect(normalizeBrand(null)).toBe('')
  })
})

describe('重复判定：同品牌才算', () => {
  it('同品牌 + 同坐标 ⇒ 合并成 1 组', () => {
    resetSeq()
    const r = findStoreDuplicates([store('文峰广场', '优事'), store('文峰', '优事')])
    expect(r.duplicateGroups).toHaveLength(1)
    expect(r.duplicateGroups[0].size).toBe(2)
    expect(r.duplicateGroups[0].maxDistanceM).toBe(0)
    expect(r.stats.redundantRecords).toBe(1)
  })

  it('🔴 跨品牌 + 同坐标 ⇒ 一条都不报（双品牌同址是正常策略）', () => {
    resetSeq()
    const r = findStoreDuplicates([store('静安大融城店', '滨寿司'), store('上海静安大融城', '食其家')])
    expect(r.duplicateGroups).toHaveLength(0)
    expect(r.nearbyPairs).toHaveLength(0)
  })

  it('🔴 跨品牌 + 78m ⇒ 同样不报', () => {
    resetSeq()
    const r = findStoreDuplicates([store('中环百联店', '滨寿司', 0), store('中环百联', '食其家', 78)])
    expect(r.duplicateGroups).toHaveLength(0)
    expect(r.nearbyPairs).toHaveLength(0)
  })

  it('品牌写法只差空白 ⇒ 仍算同品牌', () => {
    resetSeq()
    const r = findStoreDuplicates([store('A店', ' 优事 '), store('A店 ', '优事')])
    expect(r.duplicateGroups).toHaveLength(1)
  })

  it('同品牌 40m ⇒ 算重复（≤ eps 50m）', () => {
    resetSeq()
    const r = findStoreDuplicates([store('金虹桥商场店', '优事', 0), store('金虹桥', '优事', 40)])
    expect(r.duplicateGroups).toHaveLength(1)
    expect(r.duplicateGroups[0].maxDistanceM).toBeGreaterThanOrEqual(39)
    expect(r.duplicateGroups[0].maxDistanceM).toBeLessThanOrEqual(41)
  })
})

describe('链式合并（并查集）', () => {
  it('A-B 40m、B-C 40m ⇒ 三家并成一组（哪怕 A-C 有 80m）', () => {
    resetSeq()
    const r = findStoreDuplicates([
      store('店A', '优事', 0),
      store('店B', '优事', 40),
      store('店C', '优事', 80)
    ])
    expect(r.duplicateGroups).toHaveLength(1)
    expect(r.duplicateGroups[0].size).toBe(3)
    expect(r.stats.redundantRecords).toBe(2)
  })

  it('链式合并后，组内成员不再出现在邻近对里', () => {
    resetSeq()
    const r = findStoreDuplicates([
      store('店A', '优事', 0),
      store('店B', '优事', 40),
      store('店C', '优事', 280)
    ])
    expect(r.duplicateGroups[0].size).toBe(2)
    // C 与 A 相距 280m、与 B 相距 240m ⇒ 两个邻近对（都跨出了重复组）
    expect(r.nearbyPairs).toHaveLength(2)
    expect(r.nearbyPairs[0].distanceM).toBeGreaterThanOrEqual(239)   // B–C 最近
    expect(r.nearbyPairs[0].distanceM).toBeLessThanOrEqual(241)
  })
})

describe('邻近判定（可能是真蚕食）', () => {
  it('同品牌 78m ⇒ 进邻近对，不算重复', () => {
    resetSeq()
    const r = findStoreDuplicates([store('三林新达汇店', '优事', 0), store('三林信诚MO印象汇', '优事', 78)])
    expect(r.duplicateGroups).toHaveLength(0)
    expect(r.nearbyPairs).toHaveLength(1)
    expect(r.nearbyPairs[0].distanceM).toBeGreaterThanOrEqual(77)
    expect(r.nearbyPairs[0].distanceM).toBeLessThanOrEqual(79)
    expect(r.nearbyPairs[0].brandUnknown).toBe(false)
  })

  it('同品牌 320m（> near 300m）⇒ 不报', () => {
    resetSeq()
    const r = findStoreDuplicates([store('店A', '优事', 0), store('店B', '优事', 320)])
    expect(r.duplicateGroups).toHaveLength(0)
    expect(r.nearbyPairs).toHaveLength(0)
  })

  it('epsM/nearM 可调：nearM 放大到 500m 后 320m 就会报出来', () => {
    resetSeq()
    const r = findStoreDuplicates([store('店A', '优事', 0), store('店B', '优事', 320)], { nearM: 500 })
    expect(r.nearbyPairs).toHaveLength(1)
  })
})

describe('品牌缺失与脏数据', () => {
  it('两条都无品牌 + 同坐标 ⇒ 不判重复，只作 brandUnknown 邻近对', () => {
    resetSeq()
    const r = findStoreDuplicates([store('未知店1', ''), store('未知店2', '')])
    expect(r.duplicateGroups).toHaveLength(0)
    expect(r.nearbyPairs).toHaveLength(1)
    expect(r.nearbyPairs[0].brandUnknown).toBe(true)
  })

  it('一条有品牌一条无品牌 ⇒ 不判重复，作 brandUnknown 邻近对', () => {
    resetSeq()
    const r = findStoreDuplicates([store('店A', '优事'), store('店B', '')])
    expect(r.duplicateGroups).toHaveLength(0)
    expect(r.nearbyPairs).toHaveLength(1)
  })

  it('坐标为 0,0 的记录被跳过并计入 skipped', () => {
    resetSeq()
    const r = findStoreDuplicates([
      { id: 9001, name: '脏数据', brand: '优事', longitude: 0, latitude: 0 },
      store('正常店', '优事')
    ])
    expect(r.stats.total).toBe(2)
    expect(r.stats.valid).toBe(1)
    expect(r.stats.skipped).toBe(1)
    expect(r.duplicateGroups).toHaveLength(0)
  })

  it('单条门店不会匹配到自己', () => {
    resetSeq()
    const r = findStoreDuplicates([store('孤店', '优事')])
    expect(r.stats.distinctStores).toBe(1)
    expect(r.duplicateGroups).toHaveLength(0)
    expect(r.nearbyPairs).toHaveLength(0)
  })

  it('空数组安全返回', () => {
    const r = findStoreDuplicates([])
    expect(r.stats.total).toBe(0)
    expect(r.duplicateGroups).toHaveLength(0)
  })
})

describe('容量保护', () => {
  it('超过 maxStores ⇒ truncated=true 且不计算（不抛错）', () => {
    resetSeq()
    const r = findStoreDuplicates([store('A', '优事'), store('B', '优事')], { maxStores: 1 })
    expect(r.stats.truncated).toBe(true)
    expect(r.duplicateGroups).toHaveLength(0)
  })

  it('stats 汇总：233 条 8 组重复 ⇒ 独立门店 = 233 - 冗余条数', () => {
    resetSeq()
    const stores = []
    // ⚠️ 8 组重复必须各自在不同坐标上，否则会全部并成一组（同点即同组）
    for (let i = 0; i < 8; i += 1) {
      stores.push(store(`重复店${i}-A`, '优事', 20000 + i * 2000))
      stores.push(store(`重复店${i}-B`, '优事', 20000 + i * 2000))
    }
    for (let i = 0; i < 217; i += 1) stores.push(store(`独立店${i}`, '优事', 100000 + i * 200))
    const r = findStoreDuplicates(stores)
    expect(r.stats.total).toBe(233)
    expect(r.duplicateGroups).toHaveLength(8)
    expect(r.stats.redundantRecords).toBe(8)
    expect(r.stats.distinctStores).toBe(225)
  })
})

describe('路由顺序（经典坑）', () => {
  it('GET /duplicates 必须定义在 GET /:id 之前，否则会被当成 id 抢先匹配', () => {
    const dupIdx = markersSrc.indexOf("router.get('/duplicates'")
    const idIdx = markersSrc.indexOf("router.get('/:id'")
    expect(dupIdx, '未找到 /duplicates 路由').toBeGreaterThan(-1)
    expect(idIdx, '未找到 /:id 路由').toBeGreaterThan(-1)
    expect(dupIdx < idIdx, '/duplicates 定义在 /:id 之后 ⇒ 访问时会 404').toBe(true)
  })

  it('/duplicates 必须登录（台账数据按账号隔离）', () => {
    const line = markersSrc.split('\n').find((l) => l.includes("router.get('/duplicates'")) || ''
    expect(line.includes('authenticate')).toBe(true)
  })
})
