import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { getAuthorization } from './smartsteps.js'
import crypto from 'crypto'

const router = express.Router()

// 内存缓存：shapefileId -> { geojson, ts }
const geojsonCache = new Map()

// 智慧足迹上游配置
const SMARTSTEPS_BASE_URL = 'https://jm-odp.smartsteps.com/febs'

// 联通查询要求：0.3 ~ 80 km²
const MIN_AREA_KM2 = 0.3
const MAX_AREA_KM2 = 80

// 初始化商圈联通缓存表
function initDistrictCacheTable(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS district_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        city TEXT NOT NULL,
        name TEXT NOT NULL,
        polygon_key TEXT NOT NULL,
        city_month TEXT,
        result_data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(polygon_key, city_month)
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_dc_lookup ON district_cache(city, name, city_month)`)
  } catch (err) {
    console.error('[Districts] 初始化缓存表失败:', err)
  }
}

// GCJ-02 → WGS-84（与 smartsteps/resale 一致）
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0
  return ret
}
function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0
  return ret
}
function gcj02ToWgs84(lng, lat) {
  const a = 6378245.0, ee = 0.00669342162296594323
  let dLat = transformLat(lat - 35.0, lng - 105.0)
  let dLng = transformLng(lat - 35.0, lng - 105.0)
  const radLat = lat / 180.0 * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - ee * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI)
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI)
  return { lng: lng - dLng, lat: lat - dLat }
}

// 球面面积（km²）
function ringAreaKm2(ring) {
  if (!ring || ring.length < 3) return 0
  const R = 6371000.0
  let area = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const lon1 = ring[i][0] * Math.PI / 180, lat1 = ring[i][1] * Math.PI / 180
    const lon2 = ring[j][0] * Math.PI / 180, lat2 = ring[j][1] * Math.PI / 180
    area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2))
  }
  return Math.abs(area * R * R / 2) / 1e6
}

// 多边形质心（经纬度加权平均，商圈尺度足够）
function ringCentroid(ring) {
  let sx = 0, sy = 0
  for (const p of ring) { sx += p[0]; sy += p[1] }
  return [sx / ring.length, sy / ring.length]
}

/**
 * 外扩逻辑：面积 < 0.3 km² 的商圈，以质心为缩放中心等比放大到 0.3 km²
 * 保证请求联通 polygon 时满足面积下限要求
 */
function expandToMinArea(geometry, minKm2 = MIN_AREA_KM2) {
  if (!geometry) return geometry
  if (geometry.type === 'Polygon') {
    const outer = geometry.coordinates[0]
    const area = ringAreaKm2(outer)
    if (area >= minKm2) return geometry
    const [cx, cy] = ringCentroid(outer)
    const factor = Math.sqrt(minKm2 / (area || minKm2))
    const expanded = outer.map(p => [cx + (p[0] - cx) * factor, cy + (p[1] - cy) * factor])
    return { type: 'Polygon', coordinates: [expanded, ...geometry.coordinates.slice(1)] }
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map(poly => {
        const outer = poly[0]
        const area = ringAreaKm2(outer)
        if (area >= minKm2) return poly
        const [cx, cy] = ringCentroid(outer)
        const factor = Math.sqrt(minKm2 / (area || minKm2))
        return [[outer.map(p => [cx + (p[0] - cx) * factor, cy + (p[1] - cy) * factor]), ...poly.slice(1)]]
      })
    }
  }
  return geometry
}

/**
 * geometry（GCJ-02）→ WKT MULTIPOLYGON（WGS-84，联通要求）
 */
function buildPolygonWkt(geometry) {
  const polys = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : (geometry.type === 'MultiPolygon' ? geometry.coordinates : null)
  if (!polys) return null
  const wgsPolys = polys.map(poly => {
    const rings = poly.map(ring => {
      return ring.map(p => {
        const w = gcj02ToWgs84(p[0], p[1])
        return `${w.lng} ${w.lat}`
      }).join(',')
    })
    return `(${rings.map(r => `(${r})`).join(',')})`
  })
  return `MULTIPOLYGON (${wgsPolys.join(',')})`
}

/**
 * 调联通 getData（polygon 模式，1001 人口服务）
 */
async function queryUnicomPolygon(wkt, cityMonth) {
  const token = await getAuthorization()
  const response = await fetch(`${SMARTSTEPS_BASE_URL}/server/openApi/getData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'authorization': token },
    body: JSON.stringify({ codes: '1001', cityMonth, polygons: wkt, radius: 0 })
  })
  if (!response.ok) {
    throw new Error(`联通API调用失败: ${response.status}`)
  }
  const api = await response.json()
  if (api.code !== 200 || !api.data) {
    const detail = api.message || api.info || '未知错误'
    // 极目点不足等上游业务错误：透传可读信息
    throw new Error(`联通返回错误: ${detail}`)
  }
  return api.data
}

// 计算最新数据月份（当前月-1）
function getLatestCityMonth() {
  const now = new Date()
  let month = now.getMonth()
  let year = now.getFullYear()
  month -= 1
  if (month < 0) { month += 12; year -= 1 }
  return `${year}${String(month + 1).padStart(2, '0')}`
}

// 1001 返回中提取总人口（pall_sum）
function extractPopulation(data) {
  try {
    const d = data && data['1001']
    return d ? (Number(d.pall_sum) || 0) : 0
  } catch (e) { return 0 }
}

/**
 * 刷新单个商圈的最新联通数据（含外扩逻辑 + 缓存 + 配额）
 * POST /api/districts/refresh  { city, name }
 */
router.post('/refresh', authenticate, async (req, res) => {
  try {
    const { city, name } = req.body
    if (!city || !name) return res.status(400).json({ message: '缺少 city 或 name' })
    const db = getDb()
    initDistrictCacheTable(db)

    // 找商圈
    const files = db.prepare(`SELECT id, name FROM shapefiles WHERE category = 'other' AND name LIKE ?`).all(`%${String(city).replace(/市$/, '')}%`)
    let feature = null
    for (const f of files) {
      const geojson = getGeojson(f.id)
      if (!geojson || !geojson.features) continue
      feature = geojson.features.find(ft => (ft.properties || {})['名称'] === name)
      if (feature) break
    }
    if (!feature) return res.status(404).json({ message: '商圈不存在' })

    // 外扩（面积 < 0.3 km² → 放大）
    const expanded = expandToMinArea(feature.geometry)
    // 转 WKT（WGS-84）
    const wkt = buildPolygonWkt(expanded)
    if (!wkt) return res.status(500).json({ message: '边界格式不支持' })

    // 缓存 key
    const cityMonth = getLatestCityMonth()
    const polygonKey = crypto.createHash('md5').update(wkt).digest('hex')

    // 1. 查缓存（同 WKT + 月份命中 → 免费）
    const cached = db.prepare(`SELECT result_data FROM district_cache WHERE polygon_key = ? AND city_month = ?`).get(polygonKey, cityMonth)
    if (cached) {
      return res.json({ success: true, fromCache: true, quotaUsed: 0, dataMonth: cityMonth, totalPopulation: extractPopulation(JSON.parse(cached.result_data)) })
    }

    // 2. 配额检查（admin_quota，每商圈 1 点）
    const quota = db.prepare(`SELECT remaining_quota FROM admin_quota WHERE id = 1`).get()
    const available = quota?.remaining_quota || 0
    if (available < 1) {
      return res.status(400).json({ success: false, message: '极目点不足，请联系管理员充值' })
    }

    // 3. 调联通（polygon 直查）
    let result
    try {
      result = await queryUnicomPolygon(wkt, cityMonth)
    } catch (e) {
      return res.status(502).json({ success: false, message: e.message })
    }

    // 4. 扣配额 + 缓存
    db.prepare(`UPDATE admin_quota SET remaining_quota = remaining_quota - 1 WHERE id = 1`).run()
    db.prepare(`INSERT OR REPLACE INTO district_cache (city, name, polygon_key, city_month, result_data) VALUES (?, ?, ?, ?, ?)`)
      .run(city, name, polygonKey, cityMonth, JSON.stringify(result))

    res.json({
      success: true,
      fromCache: false,
      quotaUsed: 1,
      remainingQuota: available - 1,
      dataMonth: cityMonth,
      totalPopulation: extractPopulation(result)
    })
  } catch (e) {
    console.error('[Districts] 刷新商圈失败:', e)
    res.status(500).json({ message: '刷新失败: ' + e.message })
  }
})

// 城市分级（与前端 MapView/ShapefileView 保持一致）
const CITY_TIERS = {
  '一线城市': ['北京', '上海', '广州', '深圳'],
  '新一线城市': ['成都', '杭州', '重庆', '武汉', '苏州', '西安', '南京', '长沙', '郑州', '天津', '合肥', '青岛', '东莞', '宁波', '佛山']
}
function getCityTier(name) {
  if (!name) return '二三线城市'
  for (const [tier, cities] of Object.entries(CITY_TIERS)) {
    if (cities.some(c => name.includes(c))) return tier
  }
  return '二三线城市'
}

function getGeojson(id) {
  const cached = geojsonCache.get(id)
  if (cached && Date.now() - cached.ts < 60 * 60 * 1000) return cached.geojson
  const db = getDb()
  const row = db.prepare(`SELECT geojson FROM shapefiles WHERE id = ?`).get(id)
  if (!row) return null
  const geojson = JSON.parse(row.geojson)
  geojsonCache.set(id, { geojson, ts: Date.now() })
  return geojson
}

function parseCityName(filename) {
  return (filename || '').replace(/商圈/g, '').replace(/区域/g, '').replace(/\.zip/g, '').trim() || filename
}

// Point-in-Polygon（射线法，GCJ-02 平面坐标，商圈尺度足够精确）
function pointInPolygon(pt, ring) {
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

function pointInFeature(pt, geometry) {
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

// 计算商圈内竞品数量
function countCompetitorsInDistrict(geometry) {
  const db = getDb()
  const competitors = db.prepare(`SELECT longitude, latitude FROM competitors`).all()
  let count = 0
  for (const c of competitors) {
    if (c.longitude && c.latitude && pointInFeature([c.longitude, c.latitude], geometry)) {
      count++
    }
  }
  return count
}

// 收入分层加权（用于消费能力分：富人/富裕/中产/小康/中等收入/低收入）
function incomeScore(props) {
  const weights = [
    ['富人人数', 100], ['富裕人数', 85], ['中产人数', 70],
    ['小康人数', 55], ['中等收入人', 40], ['低收入人数', 25]
  ]
  let total = 0, sum = 0
  for (const [key, w] of weights) {
    const v = Number(props[key]) || 0
    total += v * w
    sum += v
  }
  if (sum === 0) return 50
  return Math.round(total / sum)
}

// 人口规模分（居住+工作，分档）
function populationScore(props) {
  const pop = (Number(props['居住人数']) || 0) + (Number(props['工作人数']) || 0)
  if (pop > 500000) return 95
  if (pop > 300000) return 85
  if (pop > 150000) return 72
  if (pop > 80000) return 58
  if (pop > 30000) return 40
  return 22
}

// 竞品强度分（商圈内竞品越少越高）
function competitionScore(count) {
  if (count <= 3) return 90
  if (count <= 8) return 75
  if (count <= 15) return 55
  if (count <= 30) return 35
  return 20
}

// 商圈综合评分：人口 40% + 消费 25% + 竞品 25% + 到访活跃 10%
function computeScore(props, compCount) {
  const p = populationScore(props)
  const c = competitionScore(compCount)
  const i = incomeScore(props)
  const visit = Number(props['到访人次']) || 0
  const v = visit > 3000000 ? 95 : visit > 1500000 ? 80 : visit > 500000 ? 60 : visit > 100000 ? 40 : 20
  const total = Math.round(p * 0.40 + i * 0.25 + c * 0.25 + v * 0.10)
  return { score: total, scorePopulation: p, scoreConsumption: i, scoreCompetition: c, scoreActivity: v }
}

/**
 * 城市列表（含商圈数，按分级分组）
 */
router.get('/cities', authenticate, (req, res) => {
  try {
    const db = getDb()
    const files = db.prepare(`SELECT id, name, feature_count FROM shapefiles WHERE category = 'other' ORDER BY name`).all()
    const cityMap = {}
    for (const f of files) {
      const cityName = parseCityName(f.name)
      if (!cityMap[cityName]) cityMap[cityName] = { name: cityName, fileIds: [], districtCount: 0 }
      cityMap[cityName].fileIds.push(f.id)
      cityMap[cityName].districtCount += f.feature_count || 0
    }
    const cities = Object.values(cityMap).map(c => ({ ...c, tier: getCityTier(c.name) }))
    cities.sort((a, b) => b.districtCount - a.districtCount)
    res.json({ cities })
  } catch (e) {
    console.error('[Districts] 城市列表失败:', e)
    res.status(500).json({ message: '获取城市列表失败' })
  }
})

/**
 * 商圈列表（按城市，含画像/评分/竞品数/边界）
 * GET /api/districts?city=上海
 */
router.get('/', authenticate, (req, res) => {
  try {
    const { city } = req.query
    if (!city) return res.status(400).json({ message: '缺少城市参数' })
    const db = getDb()
    const files = db.prepare(`SELECT id, name FROM shapefiles WHERE category = 'other' AND name LIKE ?`).all(`%${String(city).replace(/市$/, '')}%`)
    if (files.length === 0) return res.json({ districts: [] })

    const districts = []
    for (const f of files) {
      const geojson = getGeojson(f.id)
      if (!geojson || !geojson.features) continue
      for (const feature of geojson.features) {
        const props = feature.properties || {}
        const name = props['名称'] || props['name'] || '未命名商圈'
        const compCount = countCompetitorsInDistrict(feature.geometry)
        const scores = computeScore(props, compCount)
        districts.push({
          name,
          city: props['城市'] || city,
          province: props['省份'] || '',
          district: props['区县'] || '',
          population: Number(props['居住人数']) || 0,
          work: Number(props['工作人数']) || 0,
          visit: Number(props['到访人次']) || 0,
          income: {
            low: Number(props['低收入人数']) || 0,
            midLow: Number(props['中等收入人']) || 0,
            wellOff: Number(props['小康人数']) || 0,
            mid: Number(props['中产人数']) || 0,
            affluent: Number(props['富裕人数']) || 0,
            rich: Number(props['富人人数']) || 0
          },
          competitorCount: compCount,
          dataMonth: '202204',  // 数据基准 2022-04
          ...scores,
          geometry: feature.geometry
        })
      }
    }
    districts.sort((a, b) => b.score - a.score)
    res.json({ districts, total: districts.length })
  } catch (e) {
    console.error('[Districts] 商圈列表失败:', e)
    res.status(500).json({ message: '获取商圈列表失败' })
  }
})

/**
 * 商圈详情（单商圈，含完整画像）
 * GET /api/districts/detail?city=上海&name=南京西路
 */
router.get('/detail', authenticate, (req, res) => {
  try {
    const { city, name } = req.query
    if (!city || !name) return res.status(400).json({ message: '缺少参数' })
    const db = getDb()
    const files = db.prepare(`SELECT id, name FROM shapefiles WHERE category = 'other' AND name LIKE ?`).all(`%${String(city).replace(/市$/, '')}%`)
    for (const f of files) {
      const geojson = getGeojson(f.id)
      if (!geojson || !geojson.features) continue
      const feature = geojson.features.find(ft => {
        const props = ft.properties || {}
        return (props['名称'] || '') === name
      })
      if (feature) {
        const props = feature.properties || {}
        const compCount = countCompetitorsInDistrict(feature.geometry)
        const scores = computeScore(props, compCount)
        // 商圈内购物中心（polygon 包含判定，取前 10）
        const centers = db.prepare(`SELECT name, city, district, address, latitude, longitude FROM shopping_centers WHERE latitude IS NOT NULL AND latitude != 0 AND longitude IS NOT NULL AND longitude != 0`).all()
        const inDistrict = []
        for (const c of centers) {
          if (pointInFeature([c.longitude, c.latitude], feature.geometry)) {
            inDistrict.push(c)
          }
        }
        inDistrict.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'))
        return res.json({
          district: {
            name,
            city: props['城市'] || city,
            province: props['省份'] || '',
            district: props['区县'] || '',
            population: Number(props['居住人数']) || 0,
            work: Number(props['工作人数']) || 0,
            visit: Number(props['到访人次']) || 0,
            income: props,
            competitorCount: compCount,
            shoppingCenters: inDistrict.slice(0, 10),
            shoppingCenterCount: inDistrict.length,
            dataMonth: '202204',
            ...scores,
            geometry: feature.geometry
          }
        })
      }
    }
    res.status(404).json({ message: '商圈不存在' })
  } catch (e) {
    console.error('[Districts] 商圈详情失败:', e)
    res.status(500).json({ message: '获取商圈详情失败' })
  }
})

export default router
