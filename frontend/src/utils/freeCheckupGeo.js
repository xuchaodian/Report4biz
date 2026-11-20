/**
 * 免登录「门店自助体检」的纯前端几何计算
 *
 * 边界（产品铁律，⛔ 不要越界）：
 *   · 只在浏览器本地算，⛔ 不调后端、⛔ 不烧联通/高德配额、⛔ 不落库、⛔ 不跨用户聚合。
 *   · 地图点选只能拿到坐标 ⇒ 只给可靠结论：贴邻清单、直线距离、距离分档、同址预警。
 *   · 双店型判定需要「门店编码 + 面积」，点选拿不到 ⇒ ⛔ 不在这里判，统一标「需补面积核实」，
 *     引导注册后进完整体检页确认（避免把真双店型误报成蚕食、导致客户误合并真店）。
 *
 * 口径来源：与后端 `backend/src/utils/storeCheckup.js` 的 DISTANCE_BUCKETS / nearM 一致。
 *   ⚠️ 前后端运行环境不同（node ESM vs 浏览器），无法直接共用 import，故在此复刻；
 *   守卫测试 freeCheckupGuard.test.js 钉死分档常量一致，防口径漂移。
 */

/** 距离分档，顺序与后端 DISTANCE_BUCKETS 完全一致 */
export const DISTANCE_BUCKETS = [
  { key: 'same', label: '同址', hint: '<50m', max: 50 },
  { key: 'close', label: '贴身', hint: '50–300m', max: 300 },
  { key: 'overlap', label: '部分重叠', hint: '300–800m', max: 800 },
  { key: 'weak', label: '弱重叠', hint: '800m–2km', max: 2000 },
  { key: 'alone', label: '基本独立', hint: '>2km', max: Infinity }
]

/** 「需复核」阈值：≤300m 的同品牌对进清单（与后端 nearM 默认一致） */
export const NEAR_M = 300

/** 球面直线距离（Haversine），与后端 storeDedup.distanceMeters 同口径 */
export function distanceMeters(a, b) {
  const R = 6371008.8
  const rad = d => d * Math.PI / 180
  const lat1 = rad(a.lat)
  const lat2 = rad(b.lat)
  const dLat = lat2 - lat1
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function bucketOfDistance(d) {
  return DISTANCE_BUCKETS.find(b => d < b.max) || DISTANCE_BUCKETS[DISTANCE_BUCKETS.length - 1]
}

/**
 * 由点选坐标构建体检结果
 * @param {Array<{id:number,lat:number,lng:number}>} points
 * @returns {{points:Array, nearPairs:Array, sameAddrPairs:Array, bucketCounts:Object,
 *            nearestStats:Object, total:number}}
 */
export function buildFreeCheckup(points) {
  const pts = (points || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  const bucketCounts = Object.fromEntries(DISTANCE_BUCKETS.map(b => [b.key, 0]))
  const nearPairs = []
  const nearest = new Map(pts.map(p => [p.id, Infinity]))

  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = distanceMeters(pts[i], pts[j])
      const bucket = bucketOfDistance(d)
      bucketCounts[bucket.key]++
      nearest.set(pts[i].id, Math.min(nearest.get(pts[i].id), d))
      nearest.set(pts[j].id, Math.min(nearest.get(pts[j].id), d))
      if (d <= NEAR_M) {
        nearPairs.push({
          a: pts[i],
          b: pts[j],
          distance: d,
          bucket: bucket.key,
          sameAddr: d < 50
        })
      }
    }
  }

  nearPairs.sort((x, y) => x.distance - y.distance)
  const sameAddrPairs = nearPairs.filter(p => p.sameAddr)

  const vals = [...nearest.values()].filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  const medianNearestM = vals.length
    ? Math.round(vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2)
    : null

  return {
    points: pts,
    nearPairs,
    sameAddrPairs,
    bucketCounts,
    nearestStats: {
      medianNearestM,
      noNeighbor: [...nearest.values()].filter(v => !Number.isFinite(v)).length
    },
    total: pts.length
  }
}
