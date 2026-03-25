import L from 'leaflet'

// 自定义图标颜色配置
const colors = {
  default: '#409eff',
  success: '#67c23a',
  warning: '#e6a23c',
  danger: '#f56c6c',
  info: '#909399'
}

// 创建自定义图标
export function createCustomIcon(color = 'default', icon = '📍') {
  const bgColor = colors[color] || color
  
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div class="custom-marker" style="background-color: ${bgColor}">${icon}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  })
}

// 标注图标配置
export function getCategoryIcon(category) {
  const iconMap = {
    '门店': '🏪',
    '设备': '⚙️',
    '人员': '👤',
    '仓库': '📦',
    '站点': '📡'
  }
  return iconMap[category] || '📍'
}

// 获取状态颜色
export function getStatusColor(status) {
  const colorMap = {
    '正常': '#67c23a',
    '告警': '#f56c6c',
    '维护': '#e6a23c',
    '停用': '#909399'
  }
  return colorMap[status] || '#409eff'
}

// 格式化坐标
export function formatCoordinate(num, precision = 6) {
  return parseFloat(num).toFixed(precision)
}

// 计算距离 (米)
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000 // 地球半径 (米)
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

// 格式化距离
export function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} 米`
  }
  return `${(meters / 1000).toFixed(2)} 公里`
}

// 计算面积 (平方米)
export function calculateArea(points) {
  if (points.length < 3) return 0
  
  let area = 0
  const n = points.length
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].lng * points[j].lat
    area -= points[j].lng * points[i].lat
  }
  
  area = Math.abs(area) / 2
  
  // 简化的经纬度到平方米的转换
  const avgLat = points.reduce((sum, p) => sum + p.lat, 0) / n
  const metersPerDegreeLat = 111320
  const metersPerDegreeLng = 111320 * Math.cos(avgLat * Math.PI / 180)
  
  return area * metersPerDegreeLat * metersPerDegreeLng
}

// 格式化面积
export function formatArea(sqm) {
  if (sqm < 10000) {
    return `${Math.round(sqm)} 平方米`
  }
  return `${(sqm / 10000).toFixed(2)} 平方公里`
}

// 判断点是否在多边形内
export function isPointInPolygon(point, polygon) {
  let inside = false
  const x = point.lng, y = point.lat
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat
    const xj = polygon[j].lng, yj = polygon[j].lat
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  
  return inside
}

// 判断点是否在圆内
export function isPointInCircle(point, center, radius) {
  const distance = calculateDistance(point.lat, point.lng, center.lat, center.lng)
  return distance <= radius
}

// 获取当前鼠标位置坐标
export function getMouseCoordinate(e, map) {
  const latlng = e.latlng
  return {
    lat: latlng.lat,
    lng: latlng.lng
  }
}

// 导出样式配置
export const drawStyles = {
  polyline: {
    color: '#409eff',
    weight: 3,
    opacity: 0.8
  },
  polygon: {
    color: '#409eff',
    fillColor: '#409eff',
    fillOpacity: 0.3,
    weight: 2
  },
  rectangle: {
    color: '#409eff',
    fillColor: '#409eff',
    fillOpacity: 0.3,
    weight: 2
  },
  circle: {
    color: '#409eff',
    fillColor: '#409eff',
    fillOpacity: 0.3,
    weight: 2
  }
}
