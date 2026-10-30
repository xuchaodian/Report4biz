import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { getAuthorization } from './smartsteps.js'
import { fetchWithTimeout, SLOW_HTTP_TIMEOUT_MS } from '../utils/httpTimeout.js'
import { checkQuota, buildGateError } from '../utils/quotaGate.js'
import { getGeoObject } from '../models/geoStore.js'
import { normalizeDistrictProps, dstr } from '../utils/districtProps.js'
import { readableUserIds } from '../utils/visibleScope.js'
// v1.13.297：几何判定抽到 utils/geoPoint.js（门店体检落圈要同一套算法，⛔ 不许复制第二份射线法）
import { pointInFeature, geometryBBox } from '../utils/geoPoint.js'
import { countCompetitorsInDistrict, countMyStoresInDistrict } from '../utils/districtCount.js'
import { computeScore } from '../utils/districtScore.js'
import crypto from 'crypto'

const router = express.Router()

// v1.13.276：商圈面数据换版（2022 年度版 → 联通人口版），字段名整代更换
// （名称→商圈名、居住人数→居住、…、RecID→biz_id）。所有读取点一律先过
// normalizeDistrictProps() 归一到旧名，⛔ 不要在这里直接写 props['居住人数']。
//
// 基础数据期次：联通人口版**未标注月份** ⇒ 基线展示「联通人口版（未标注期次）」，
// 用户点「刷新最新数据」后由联通 1001 返回真实期次（形如 '202510'）覆盖。
const BASE_DATA_MONTH = ''

// v1.13.143：geojson 已外置到文件（models/geoStore.js），原先这里的
// geojsonCache（1 小时 TTL、与 shapefiles.js 的 1 分钟缓存各自为政）已删除，
// 缓存统一归 geoStore 管，避免同一个 geojson 在内存里存两份 V8 对象。

// H4 缓存 / 数据版本指纹 / 商圈内竞品与门店计数已迁到 utils/districtCount.js（v1.13.297）
// —— 门店体检的红黄绿灯要判断「竞争密集」，必须与本文件共用同一份计数与缓存。

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
 *
 * 🔴 v1.13.276：MultiPolygon **只取主体面**（外环面积最大的那块）再判面积/外扩。
 *   原因：联通人口版商圈大量是「主城区 + 若干飞地/碎片」的多面要素（实测上海 177 个
 *   商圈里 50 个多环，附加环 178 个中 172 个是分离面）。若逐块外扩，一次请求会变成
 *   十几个 ≥0.3km² 的离散色块 ⇒ 联通按这个 polygon 统计出来的人口既不等于商圈实际，
 *   也不可解释，而且用户看到的是"刷新成功"。取主体面是这里唯一自洽的口径：
 *   联通 1001 的入参本来就是「一个 0.3km² 以上的连续面」。
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
    const dominant = geometry.coordinates.reduce((best, poly) =>
      ringAreaKm2(poly[0]) > ringAreaKm2(best[0]) ? poly : best
    )
    return expandToMinArea({ type: 'Polygon', coordinates: dominant }, minKm2)
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
  const response = await fetchWithTimeout(`${SMARTSTEPS_BASE_URL}/server/openApi/getData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'authorization': token },
    body: JSON.stringify({ codes: '1001', cityMonth, polygons: wkt, radius: 0 })
  }, SLOW_HTTP_TIMEOUT_MS)
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

    // 2. 配额检查（v0.9 P0：统一走授权闸门 —— 物理池 + 成员授权额度；每商圈 1 点）
    const gate = checkQuota(db, req.user?.id, 1, { role: req.user?.role })
    if (!gate.ok) {
      // v1.13.217：改走统一闸门错误 —— 此前这里**自己拼了一套文案**（第 6 处拷贝），
      //   且 code 用的是后端内部 reason（'own_exhausted'），与 buildGateError 的
      //   'own_quota_exhausted' **不一致** ⇒ 前端按 code 分流会漏掉本端点。
      //   ownStatus 显式传 400：本端点历史上两分支都是 400，不改既有状态码语义。
      const err = buildGateError(gate, { service: '极目点', ownStatus: 400 })
      return res.status(err.status).json({ success: false, ...err.body })
    }

    // 3. 调联通（polygon 直查）
    let result
    try {
      result = await queryUnicomPolygon(wkt, cityMonth)
    } catch (e) {
      console.error('[Districts] 联通多边形人口查询失败:', e)
      return res.status(502).json({ success: false, message: '人口数据服务暂不可用，请稍后重试' })
    }

    // 4. 扣配额 + 缓存（同事务，杜绝"扣了配额没缓存 / 有缓存没扣"不一致，v1.13.106）
    db.beginTx()
    try {
      db.prepare(`UPDATE admin_quota SET remaining_quota = remaining_quota - 1 WHERE id = 1`).run()
      db.prepare(`INSERT OR REPLACE INTO district_cache (city, name, polygon_key, city_month, result_data) VALUES (?, ?, ?, ?, ?)`)
        .run(city, name, polygonKey, cityMonth, JSON.stringify(result))
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

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
    res.status(500).json({ message: '刷新失败，请稍后重试' })
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
  // v1.13.143：geojson 外置到文件，缓存由 geoStore 统一管理（调用点无需改动）
  const db = getDb()
  const row = db.prepare(`SELECT id FROM shapefiles WHERE id = ?`).get(id)
  if (!row) return null
  return getGeoObject(id)
}

function parseCityName(filename) {
  return (filename || '').replace(/商圈/g, '').replace(/区域/g, '').replace(/\.zip/g, '').trim() || filename
}

// 几何判定 / 商圈内计数 / 评分 = utils/{geoPoint,districtCount,districtScore}.js（v1.13.297）
// ⚠️ 门店体检的「落圈判定」与「竞争密集」用的就是这三份，与本文件**同源**；
//    ⛔ 别在这里或体检里再写一套射线法/阈值。

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
    // v1.13.277：门店/竞品计数按「我可见的账号集合」统计（自己 + 集团允许拉取的子公司），
    // 整单算一次，逐商圈复用 —— ⛔ 不要放进循环里调（每个商圈一次多两跳查询）
    const scopeIds = readableUserIds(db, req.user.id)
    const files = db.prepare(`SELECT id, name FROM shapefiles WHERE category = 'other' AND name LIKE ?`).all(`%${String(city).replace(/市$/, '')}%`)
    if (files.length === 0) return res.json({ districts: [] })

    const districts = []
    for (const f of files) {
      const geojson = getGeojson(f.id)
      if (!geojson || !geojson.features) continue
      for (const feature of geojson.features) {
        // v1.13.276：字段名整代更换，必须先归一再取数（否则评分/画像静默归零）
        const props = normalizeDistrictProps(feature.properties || {})
        const name = props['名称'] || props['name'] || '未命名商圈'
        const compCount = countCompetitorsInDistrict(feature.geometry, scopeIds)
        const myStoreCount = countMyStoresInDistrict(feature.geometry, scopeIds)
        const scores = computeScore(props, compCount, myStoreCount)
        districts.push({
          name,
          myStoreCount,
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
          // v1.13.276：联通人口版新增的三列画像标签（旧版数据没有 ⇒ 空串，前端不渲染）
          crowd: dstr(props, '客群'),
          level: dstr(props, '能级'),
          resident: dstr(props, '居民类'),
          competitorCount: compCount,
          dataMonth: BASE_DATA_MONTH,
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
    // v1.13.277：同列表接口 —— 计数按可见域（自己 + 集团允许拉取的子公司）
    const scopeIds = readableUserIds(db, req.user.id)
    const files = db.prepare(`SELECT id, name FROM shapefiles WHERE category = 'other' AND name LIKE ?`).all(`%${String(city).replace(/市$/, '')}%`)
    for (const f of files) {
      const geojson = getGeojson(f.id)
      if (!geojson || !geojson.features) continue
      const feature = geojson.features.find(ft => {
        // v1.13.276：名称在联通人口版里叫「商圈名」⇒ 判等前必须归一，否则详情永远 404
        const props = normalizeDistrictProps(ft.properties || {})
        return (props['名称'] || '') === name
      })
      if (feature) {
        const props = normalizeDistrictProps(feature.properties || {})
        const compCount = countCompetitorsInDistrict(feature.geometry, scopeIds)
        const myStoreCount = countMyStoresInDistrict(feature.geometry, scopeIds)
        const scores = computeScore(props, compCount, myStoreCount)
        // 商圈内购物中心（bbox 预筛 + polygon 包含判定，取前 10；H4 免全表拉取）
        const scBbox = geometryBBox(feature.geometry)
        const centers = scBbox
          ? db.prepare(`SELECT name, city, district, address, latitude, longitude, stars, comments FROM shopping_centers WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`).all(scBbox[1], scBbox[3], scBbox[0], scBbox[2])
          : db.prepare(`SELECT name, city, district, address, latitude, longitude, stars, comments FROM shopping_centers WHERE latitude IS NOT NULL AND latitude != 0 AND longitude IS NOT NULL AND longitude != 0`).all()
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
            crowd: dstr(props, '客群'),
            level: dstr(props, '能级'),
            resident: dstr(props, '居民类'),
            competitorCount: compCount,
            myStoreCount,
            shoppingCenters: inDistrict.slice(0, 10),
            shoppingCenterCount: inDistrict.length,
            dataMonth: BASE_DATA_MONTH,
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
