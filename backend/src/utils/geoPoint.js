/**
 * 点与几何面的判定（v1.13.297 从 routes/districts.js 原样抽出）
 *
 * 🔴 为什么抽出来：门店体检的「落圈判定」必须与商圈洞察（/api/districts）**同一套**算法，
 *    否则同一家店在两页会落在不同商圈，客户第一反应就是「系统乱算」。
 *    项目铁律：派生/解析算法必抽单一函数共用，⛔ 不要在两处各写一份射线法。
 *
 * 坐标系：GCJ-02 平面经纬度，商圈尺度（km 级）用平面射线法足够精确。
 * ⚠️ 以下三个函数是 districts.js 原实现的逐字搬迁，行为未改。
 */

/** 射线法：点是否在单个环内 */
export function pointInPolygon(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * 点是否在要素内（Polygon / MultiPolygon，含洞判定）
 * 🔴 v1.13.276：多 part 要素按嵌套深度出 Polygon/MultiPolygon，
 *    分离面若被塞进同一个 Polygon 的后续环，会被当成洞 ⇒ 这里必须逐面判、
 *    任一面命中即算在内。
 */
export function pointInFeature(pt, geometry) {
  if (!geometry) return false
  if (geometry.type === 'Polygon') {
    const outer = geometry.coordinates[0]
    if (!pointInPolygon(pt, outer)) return false
    for (let k = 1; k < geometry.coordinates.length; k++) {
      if (pointInPolygon(pt, geometry.coordinates[k])) return false
    }
    return true
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(poly => {
      const outer = poly[0]
      if (!pointInPolygon(pt, outer)) return false
      for (let k = 1; k < poly.length; k++) {
        if (pointInPolygon(pt, poly[k])) return false
      }
      return true
    })
  }
  return false
}

/** 几何 bbox [minLng, minLat, maxLng, maxLat]；不支持的类型返回 null（调用方回退全表扫描） */
export function geometryBBox(geometry) {
  if (!geometry) return null
  const polys = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates
      : null
  if (!polys) return null
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const rings of polys) {
    for (const ring of rings) {
      for (const pt of ring) {
        const lng = pt[0], lat = pt[1]
        if (lng < minLng) minLng = lng
        if (lat < minLat) minLat = lat
        if (lng > maxLng) maxLng = lng
        if (lat > maxLat) maxLat = lat
      }
    }
  }
  if (!isFinite(minLng)) return null
  return [minLng, minLat, maxLng, maxLat]
}
