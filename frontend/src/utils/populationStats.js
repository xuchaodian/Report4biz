/**
 * 人口统计工具函数
 * 用于商圈人口分布分析和门店人口对比
 */

// 判断多边形是否与圆相交
export const isPolygonIntersectsCircle = (geom, centerLat, centerLng, radius) => {
  if (!geom) return false

  try {
    let coords = []
    if (geom.type === 'Polygon') {
      coords = geom.coordinates[0]
    } else if (geom.type === 'MultiPolygon') {
      coords = geom.coordinates[0][0]
    } else {
      return false
    }

    // 检查圆心是否在多边形内
    if (isPointInPolygon([centerLng, centerLat], coords)) {
      return true
    }

    // 检查任一顶点是否在圆内
    for (const c of coords) {
      const dist = getDistanceFromLatLng(centerLat, centerLng, c[1], c[0])
      if (dist <= radius) return true
    }

    // 检查圆是否与多边形任一边相交
    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = { lat: coords[i][1], lng: coords[i][0] }
      const p2 = { lat: coords[i + 1][1], lng: coords[i + 1][0] }
      if (circleIntersectsSegment(centerLat, centerLng, radius, p1, p2)) {
        return true
      }
    }

    return false
  } catch (e) {
    console.error('相交检测失败:', e)
    return false
  }
}

// 判断点是否在多边形内（射线法）
const isPointInPolygon = (point, polygon) => {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1]
    const xj = polygon[j][0], yj = polygon[j][1]
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

// 计算两点间距离（米）- Haversine公式
const getDistanceFromLatLng = (lat1, lng1, lat2, lng2) => {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// 圆与线段是否相交
const circleIntersectsSegment = (centerLat, centerLng, radius, p1, p2) => {
  const d = getDistanceFromLatLng(p1.lat, p1.lng, p2.lat, p2.lng)
  if (d === 0) return getDistanceFromLatLng(centerLat, centerLng, p1.lat, p1.lng) <= radius

  const t = Math.max(0, Math.min(1, (
    (centerLng - p1.lng) * (p2.lng - p1.lng) +
    (centerLat - p1.lat) * (p2.lat - p1.lat)
  ) / (d * d)))

  const closest = {
    lat: p1.lat + t * (p2.lat - p1.lat),
    lng: p1.lng + t * (p2.lng - p1.lng)
  }

  return getDistanceFromLatLng(centerLat, centerLng, closest.lat, closest.lng) <= radius
}

// 计算多边形与圆的交集面积占比
export const calculateIntersectionRatio = (geom, centerLat, centerLng, radius) => {
  if (!geom) return 0

  try {
    let coords = []
    if (geom.type === 'Polygon') {
      coords = geom.coordinates[0]
    } else if (geom.type === 'MultiPolygon') {
      coords = geom.coordinates[0][0]
    } else {
      return 0
    }

    // 检查圆心是否完全在多边形内
    if (isPointInPolygon([centerLng, centerLat], coords)) {
      return 1
    }

    // 采样点法估算交集比例
    let insideCount = 0
    const sampleCount = 100

    // 计算多边形边界框
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (const c of coords) {
      minLng = Math.min(minLng, c[0])
      maxLng = Math.max(maxLng, c[0])
      minLat = Math.min(minLat, c[1])
      maxLat = Math.max(maxLat, c[1])
    }

    const bboxArea = (maxLng - minLng) * (maxLat - minLat)
    const circleArea = Math.PI * radius * radius / (111000 * 111000)

    // 在边界框内随机采样
    for (let i = 0; i < sampleCount; i++) {
      const lng = minLng + Math.random() * (maxLng - minLng)
      const lat = minLat + Math.random() * (maxLat - minLat)
      if (isPointInPolygon([lng, lat], coords)) {
        const dist = getDistanceFromLatLng(centerLat, centerLng, lat, lng)
        if (dist <= radius) {
          insideCount++
        }
      }
    }

    // 根据采样结果估算
    return insideCount / sampleCount
  } catch (e) {
    console.error('交集比例计算失败:', e)
    return 0
  }
}

/**
 * 计算单个门店半径范围内的人口统计
 * @param {number} lat - 纬度
 * @param {number} lng - 经度
 * @param {number} radiusMeters - 半径（米）
 * @param {string} fieldName - 统计字段名
 * @param {Function} shapefileCallback - 获取shapefile数据的回调函数
 * @returns {Promise<{total: number, count: number, allFields: object}>}
 */
export const calculatePopulationByRadius = async (lat, lng, radiusMeters, fieldName, getShapefiles) => {
  const result = {
    total: 0,
    count: 0,
    allFields: {}
  }

  try {
    const shapefiles = await getShapefiles()
    if (!shapefiles || shapefiles.length === 0) {
      return result
    }

    for (const sf of shapefiles) {
      try {
        const geojson = sf.geojson || sf.data?.geojson
        if (!geojson) continue

        const features = geojson.features || []
        if (features.length === 0) continue

        for (const feature of features) {
          const geom = feature.geometry
          if (!geom) continue

          if (isPolygonIntersectsCircle(geom, lat, lng, radiusMeters)) {
            const props = feature.properties || {}
            const rawValue = parseInt(props[fieldName]) || 0
            const intersectionRatio = calculateIntersectionRatio(geom, lat, lng, radiusMeters)
            const weightedValue = Math.round(rawValue * intersectionRatio)

            result.total += weightedValue
            result.count++

            // 收集所有整数字段
            for (const [key, val] of Object.entries(props)) {
              if (key !== 'RecID' && val !== null && val !== undefined && Number.isInteger(Number(val))) {
                if (!result.allFields[key]) {
                  result.allFields[key] = 0
                }
                result.allFields[key] += Math.round(Number(val) * intersectionRatio)
              }
            }
          }
        }
      } catch (e) {
        console.error(`处理 ${sf.name} 失败:`, e)
      }
    }
  } catch (e) {
    console.error('人口统计计算失败:', e)
  }

  return result
}

/**
 * 格式化数字显示
 */
export const formatNumber = (num) => {
  if (num >= 10000) return (num / 10000).toFixed(1) + '万'
  return num.toLocaleString()
}
