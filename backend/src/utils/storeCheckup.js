/**
 * 门店位置体检（v1.13.291）—— **纯几何结构**，不评价门店好坏
 *
 * 设计取舍（2026-10-28 业主改判，见记忆「门店体检＝几何为主」）：
 *   ⛔ 不拿商圈面当判定骨架 —— 上海 177 个商圈面只覆盖约 24% 陆域，单面 1.02~47.7 km²，
 *      用作「在不在商圈里」的判据会把大片门店误判到边界外。
 *   ✅ 以**门店坐标 + 距离**为骨架；商圈画像（客群/能级）只作增强显示，本模块不涉及。
 *
 * 铁律：
 *   · ⛔ **跨品牌不判**：同一账号多品牌（泉膳的滨寿司 + 食其家）、同一商场双品牌同址都是常态。
 *   · ⛔ **「≤50m 同品牌」≠ 重复**：youshi 13 组同址实为「8xxx 大店 + 2xxx 小店」两套店型，
 *     故本模块只把它们标成 `dualFormat` 提示复核，**不做合并建议**（合并＝删客户真实门店）。
 *   · 计算全量、展示分批：本模块一次算完，分页由路由做。
 *   · 最近同品牌距离只在 `capM`（默认 20km）内搜索：沿纬度做窄窗扫描，避免 O(n²) 全量比。
 *     ⚠️ `capM` 会**影响中位数**：搜索窗内的孤立店若被排除，中位数会被系统性拉小
 *     （实测 5km 时 youshi 中位 886m，放到 20km 才是报告里的 1.09km）。
 *     ⇒ 默认给足 20km，并把 `medianBasis`（参与中位数的门店数）一起返回，
 *     让界面能说清「中位是拿多少家算的」。
 */
import { distanceMeters, normalizeBrand, looksLikeDualFormat } from './storeDedup.js'

/** 最近同品牌距离分档（米，左闭右开）—— 与《位置体检报告 v3》一致 */
export const DISTANCE_BUCKETS = [
  { key: 'same', label: '同址', lt: 50, hint: '<50m' },
  { key: 'close', label: '贴身', lt: 300, hint: '50–300m' },
  { key: 'overlap', label: '部分重叠', lt: 800, hint: '300–800m' },
  { key: 'weak', label: '弱重叠', lt: 2000, hint: '0.8–2km' },
  { key: 'alone', label: '基本独立', lt: Infinity, hint: '>2km' }
]

/** 面积分档（㎡，左闭右开） */
export const AREA_BUCKETS = [
  { key: 'xs', label: '<120㎡', lt: 120 },
  { key: 's', label: '120–200㎡', lt: 200 },
  { key: 'm', label: '200–350㎡', lt: 350 },
  { key: 'l', label: '≥350㎡', lt: Infinity }
]

export function bucketOfDistance(d) {
  for (const b of DISTANCE_BUCKETS) if (d < b.lt) return b.key
  return 'alone'
}

export function bucketOfArea(a) {
  for (const b of AREA_BUCKETS) if (a < b.lt) return b.key
  return 'l'
}

/** 中位数；空数组返回 null（⛔ 不是 0 —— 0 会被误读成「全都是同址」） */
export function median(nums) {
  if (!nums || !nums.length) return null
  const arr = [...nums].sort((x, y) => x - y)
  const mid = arr.length >> 1
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2
}

const AREA_M_PER_DEG_LAT = 111320

/**
 * @param {Array} stores 门店行（id/name/brand/store_code/store_area/latitude/longitude/…）
 * @param {object} [opts]
 * @param {number} [opts.nearM=300]  「需复核」阈值：同品牌最近距离 ≤ 它才列进清单
 * @param {number} [opts.capM=20000] 最近距离搜索上限（超过一律算「基本独立」）
 * @returns {object} 汇总 + 需复核对（已按距离升序）
 */
export function buildStoreCheckup(stores, opts = {}) {
  const nearM = Number.isFinite(opts.nearM) && opts.nearM > 0 ? opts.nearM : 300
  const capM = Number.isFinite(opts.capM) && opts.capM > nearM ? opts.capM : 20000
  const list = Array.isArray(stores) ? stores : []

  const pts = []
  let noCoord = 0
  for (const s of list) {
    const latitude = Number(s?.latitude)
    const longitude = Number(s?.longitude)
    // 0,0 是「没填坐标」的常见脏值，按缺失处理（几内亚湾不是我们的市场）
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
      noCoord++
      continue
    }
    pts.push({ s, latitude, longitude, brand: normalizeBrand(s.brand) })
  }

  pts.sort((x, y) => x.latitude - y.latitude)

  const nearest = new Map() // storeId -> 米
  const pairs = []
  const capDeg = capM / AREA_M_PER_DEG_LAT

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    for (let j = i + 1; j < pts.length; j++) {
      const b = pts[j]
      if (b.latitude - a.latitude > capDeg) break // 纬度已超出搜索窗，后面的更远
      if (!a.brand || a.brand !== b.brand) continue // ⛔ 跨品牌不判
      const d = distanceMeters(a, b)
      if (d > capM) continue
      const ka = String(a.s.id)
      const kb = String(b.s.id)
      if (!nearest.has(ka) || d < nearest.get(ka)) nearest.set(ka, d)
      if (!nearest.has(kb) || d < nearest.get(kb)) nearest.set(kb, d)
      if (d <= nearM) {
        pairs.push({
          aId: a.s.id, bId: b.s.id,
          aName: a.s.name, bName: b.s.name,
          aCode: a.s.store_code ?? a.s.storeCode ?? '', bCode: b.s.store_code ?? b.s.storeCode ?? '',
          aArea: Number(a.s.store_area ?? a.s.storeArea) || 0, bArea: Number(b.s.store_area ?? b.s.storeArea) || 0,
          city: a.s.city || b.s.city || '',
          address: a.s.address || b.s.address || '',
          // v1.13.295：带出两边坐标，前端才能「一键在地图上看这两家到底多近」
          //（体检页的人工复核 90% 是在问「这是同一个门还是隔壁门」，只看距离数字判断不了）
          aLat: Number(a.s.latitude) || null, aLng: Number(a.s.longitude) || null,
          bLat: Number(b.s.latitude) || null, bLng: Number(b.s.longitude) || null,
          distance: Math.round(d),
          // 编码不同 + 面积比 ≥2 ⇒ 同一商场两套店型（禁合并，只能「确认是两家」）
          dualFormat: looksLikeDualFormat(a.s, b.s)
        })
      }
    }
  }

  pairs.sort((x, y) => x.distance - y.distance)

  const bucketCounts = Object.fromEntries(DISTANCE_BUCKETS.map(b => [b.key, 0]))
  let hasNeighbor = 0
  for (const d of nearest.values()) {
    bucketCounts[bucketOfDistance(d)]++
    hasNeighbor++
  }
  // 搜索窗内没找到同品牌 ⇒ 必然是「>2km 基本独立」，按桶计入（⛔ 不能漏计，否则分布和≠有坐标门店数）
  bucketCounts.alone += pts.length - hasNeighbor

  const areaBuckets = Object.fromEntries(AREA_BUCKETS.map(b => [b.key, 0]))
  let withArea = 0
  for (const s of list) {
    const a = Number(s?.store_area ?? s?.storeArea)
    if (!Number.isFinite(a) || a <= 0) continue
    areaBuckets[bucketOfArea(a)]++
    withArea++
  }

  const sameAddrPairs = pairs.filter(p => p.distance < 50)
  const sameAddrStores = new Set()
  for (const p of sameAddrPairs) { sameAddrStores.add(String(p.aId)); sameAddrStores.add(String(p.bId)) }

  return {
    nearM,
    capM,
    counts: {
      total: list.length,
      withCoord: pts.length,
      noCoord,
      withArea,
      noArea: list.length - withArea,
      pairs: pairs.length,
      sameAddrPairs: sameAddrPairs.length,
      sameAddrStores: sameAddrStores.size,
      dualFormatPairs: pairs.filter(p => p.dualFormat).length,
      suspectedPairs: pairs.filter(p => !p.dualFormat).length,
      noNeighbor: pts.length - nearest.size
    },
    bucketCounts,
    // 中位数只对「搜索窗内找到过同品牌邻居」的门店有意义；noNeighbor 要显式返回，
    // 否则界面会把「20km 内都没有同品牌」的店当成「算过了」。
    medianBasis: nearest.size,
    noNeighbor: pts.length - nearest.size,
    medianNearestM: (() => {
      const m = median([...nearest.values()])
      return m == null ? null : Math.round(m)
    })(),
    areaBuckets,
    pairs
  }
}
