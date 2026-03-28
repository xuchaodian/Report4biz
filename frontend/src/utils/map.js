import L from 'leaflet'

// 自定义图标颜色配置
const colors = {
  default: '#409eff',
  success: '#67c23a',
  warning: '#e6a23c',
  danger: '#f56c6c',
  info: '#909399'
}

// SVG 地图标记样式
export const svgMarkerStyles = {
  // 经典地图钉
  pin: (color) => `
    <svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
        </filter>
      </defs>
      <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 26 16 26s16-14 16-26C32 7.163 24.837 0 16 0z" 
            fill="${color}" filter="url(#shadow)"/>
      <circle cx="16" cy="16" r="8" fill="white" opacity="0.9"/>
      <circle cx="16" cy="16" r="5" fill="${color}"/>
    </svg>
  `,
  
  // 店铺标记
  store: (color) => `
    <svg width="36" height="44" viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadowStore" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="2" flood-opacity="0.35"/>
        </filter>
      </defs>
      <!-- 标记头部 -->
      <path d="M18 0C8.059 0 0 8.059 0 18c0 6 3 11.4 7.5 14.7L18 44l10.5-11.3C33 29.4 36 24 36 18 36 8.059 27.941 0 18 0z" 
            fill="${color}" filter="url(#shadowStore)"/>
      <!-- 白色圆形背景 -->
      <circle cx="18" cy="17" r="10" fill="white"/>
      <!-- 店铺图标 -->
      <path d="M18 9l-8 4v6h5v3h6v-3h5v-6l-8-4zm0 3l4 2v3h-8v-3l4-2z" fill="${color}"/>
    </svg>
  `,
  
  // 简约圆点
  dot: (color) => `
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadowDot" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.4"/>
        </filter>
      </defs>
      <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2" filter="url(#shadowDot)"/>
      <circle cx="12" cy="12" r="5" fill="white" opacity="0.85"/>
    </svg>
  `,
  
  // 菱形标记
  diamond: (color) => `
    <svg width="32" height="38" viewBox="0 0 32 38" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadowDiamond" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
        </filter>
      </defs>
      <path d="M16 0L32 16L16 38L0 16L16 0z" fill="${color}" filter="url(#shadowDiamond)"/>
      <path d="M16 6L26 16L16 30L6 16L16 6z" fill="white" opacity="0.3"/>
      <circle cx="16" cy="16" r="4" fill="white"/>
    </svg>
  `,
  
  // 旗帜标记
  flag: (color) => `
    <svg width="28" height="40" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadowFlag" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-opacity="0.3"/>
        </filter>
      </defs>
      <!-- 旗杆 -->
      <rect x="5" y="8" width="3" height="32" fill="#666"/>
      <circle cx="6.5" cy="6" r="4" fill="${color}"/>
      <!-- 旗帜 -->
      <path d="M8 8h16l-3 8 3 8H8V8z" fill="${color}" filter="url(#shadowFlag)"/>
      <path d="M10 12h8M10 16h6M10 20h8" stroke="white" stroke-width="1.5" opacity="0.6"/>
    </svg>
  `,
  
  // 星形标记
  star: (color) => `
    <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadowStar" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.3"/>
        </filter>
      </defs>
      <polygon points="18,2 22,14 34,14 24,22 28,34 18,26 8,34 12,22 2,14 14,14" 
               fill="${color}" filter="url(#shadowStar)"/>
      <polygon points="18,8 20,14 26,14 21,18 23,24 18,20 13,24 15,18 10,14 16,14" 
               fill="white" opacity="0.4"/>
    </svg>
  `
}

// 创建自定义 SVG 图标
export function createCustomIcon(color = 'default', icon = '📍') {
  const bgColor = colors[color] || color
  const svgContent = svgMarkerStyles.store(bgColor)
  
  return L.divIcon({
    className: 'custom-svg-marker',
    html: `<div class="custom-marker-svg">${svgContent}</div>`,
    iconSize: [36, 44],
    iconAnchor: [18, 44],
    popupAnchor: [0, -44]
  })
}

// 创建带样式的 SVG 图标
// sizeScale: 缩放比例，默认1，竞品用0.7
export function createSvgIcon(color, style = 'store', sizeScale = 1) {
  const svgContent = svgMarkerStyles[style] ? svgMarkerStyles[style](color) : svgMarkerStyles.store(color)
  
  const sizeMap = {
    pin: [32, 42],
    store: [36, 44],
    dot: [24, 24],
    diamond: [32, 38],
    flag: [28, 40],
    star: [36, 36]
  }
  
  const baseSize = sizeMap[style] || [36, 44]
  const size = [baseSize[0] * sizeScale, baseSize[1] * sizeScale]
  
  return L.divIcon({
    className: 'custom-svg-marker',
    html: `<div class="custom-marker-svg" style="transform: scale(${sizeScale})">${svgContent}</div>`,
    iconSize: baseSize,  // 保持原始大小用于定位
    iconAnchor: [baseSize[0] / 2, baseSize[1]],
    popupAnchor: [0, -baseSize[1]]
  })
}

// 旧函数保持兼容
export function createOldIcon(color = 'default', icon = '📍') {
  const bgColor = colors[color] || color

  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div class="custom-marker" style="background-color: ${bgColor}">${icon}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  })
}

// 创建品牌图片图标 (32×32px)
export function createBrandImageIcon(url) {
  return L.divIcon({
    className: 'custom-brand-marker',
    html: `<img src="${url}" width="32" height="32" style="border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.35);" />`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
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

// 获取门店类型颜色
export function getStoreTypeColor(storeType) {
  const colorMap = {
    '已开业': '#67c23a',  // 绿色
    '重点候选': '#f56c6c', // 红色
    '一般候选': '#e6a23c'   // 黄色
  }
  return colorMap[storeType] || '#409eff'
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
