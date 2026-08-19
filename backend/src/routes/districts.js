import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// 内存缓存：shapefileId -> { geojson, ts }
const geojsonCache = new Map()

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
    const files = db.prepare(`SELECT id, name FROM shapefiles WHERE category = 'other' AND name LIKE ?`).all(`%${city}%`)
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
    const files = db.prepare(`SELECT id, name FROM shapefiles WHERE category = 'other' AND name LIKE ?`).all(`%${city}%`)
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
