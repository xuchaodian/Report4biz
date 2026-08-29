import express from 'express'
import * as turf from '@turf/turf'
import { aroundSearch } from '../utils/amapPoi.js'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// ===================== 空间判定 =====================
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
    for (const poly of geometry.coordinates) {
      const outer = poly[0]
      if (!pointInPolygon(pt, outer)) continue
      let inHole = false
      for (let k = 1; k < poly.length; k++) {
        if (pointInPolygon(pt, poly[k])) { inHole = true; break }
      }
      if (!inHole) return true
    }
    return false
  }
  return false
}

// ===================== 商圈数据（全量缓存） =====================
let allDistrictsCache = null

function getAllDistricts() {
  if (allDistrictsCache) return allDistrictsCache
  const db = getDb()
  const files = db.prepare(`SELECT id, name FROM shapefiles WHERE category = 'other'`).all()
  const list = []
  for (const f of files) {
    const city = String(f.name || '').replace(/\.zip$/, '').replace(/市$/, '')
    const row = db.prepare(`SELECT geojson FROM shapefiles WHERE id = ?`).get(f.id)
    if (!row || !row.geojson) continue
    let geojson
    try { geojson = JSON.parse(row.geojson) } catch (e) { continue }
    if (!geojson || !geojson.features) continue
    for (const ft of geojson.features) {
      const p = ft.properties || {}
      if (!p['名称']) continue
      list.push({
        city,
        name: p['名称'],
        province: p['省份'] || '',
        district: p['区县'] || '',
        props: p,
        geometry: ft.geometry
      })
    }
  }
  allDistrictsCache = list
  return list
}

// 定位门店所在商圈（可多命中，取面积最小/第一个）
function findDistrict(lat, lng) {
  const pt = [lng, lat]
  const all = getAllDistricts()
  for (const d of all) {
    if (pointInFeature(pt, d.geometry)) return d
  }
  return null
}

// 商圈画像向量（居住/工作/到访/高消费人群）
function districtProfileVector(d) {
  if (!d) return null
  const p = d.props
  const rich = Number(p['中产人数']) + Number(p['富裕人数']) + Number(p['富人人数'])
  return [
    Number(p['居住人数']) || 0,
    Number(p['工作人数']) || 0,
    Number(p['到访人次']) || 0,
    rich
  ]
}

// ===================== 门店画像（联通 result_data） =====================
function storeProfileVector(db, storeName) {
  const row = db.prepare(
    `SELECT result_data FROM purchases WHERE store_name = ? AND result_data IS NOT NULL AND result_data != '' ORDER BY id DESC LIMIT 1`
  ).get(storeName)
  if (!row || !row.result_data) return null
  try {
    const d = JSON.parse(row.result_data)
    const api = (d && d.apiResult) || d
    if (!api || typeof api !== 'object') return null
    const p1001 = api['1001'] || {}
    const pop = Number(p1001.pall_sum) || 0
    const male = Number(p1001.male2_sum) || 0
    const female = Number(p1001.female2_sum) || 0
    // 消费力：1013 消费（结构不定，尽量取总数值字段）
    let spend = 0
    const p1013 = api['1013']
    if (p1013 && typeof p1013 === 'object') {
      const vals = Object.values(p1013).filter(v => typeof v === 'number' && !isNaN(v))
      spend = vals.length ? vals.reduce((a, b) => a + b, 0) : 0
    }
    if (pop === 0 && spend === 0) return null
    return [pop, male, female, spend]
  } catch (e) {
    return null
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ===================== 参照池 =====================
// ===================== 半径常住人口（免费网格数据 1/3/5km） =====================
const popGeoCache = new Map()      // shapefileId -> { geojson, ts }
const popResultCache = new Map()   // `${id}_${lat}_${lng}_${radius}` -> { total, ts }
const POP_GEO_TTL = 10 * 60 * 1000
const POP_RESULT_TTL = 5 * 60 * 1000
// 定位城市人口网格（category='population'，name 含城市名）
function getPopShapefile(db, city) {
  const name = String(city || '').replace(/市$/, '')
  if (!name) return null
  return db.prepare(`SELECT id, name FROM shapefiles WHERE category = 'population' AND name LIKE ?`).get(`%${name}%`) || null
}
// 计算点位 1km/3km/5km 半径内常住人口（turf 圆 + 面积加权，与 /api/shapefiles/calculate-population 同款）
function calcRadiusPopulation(db, lat, lng, city) {
  const radii = [1000, 3000, 5000]
  const out = {}
  if (!lat || !lng) return out
  const sf = getPopShapefile(db, city)
  if (!sf) return out
  let geojson = null
  const cached = popGeoCache.get(sf.id)
  if (cached && Date.now() - cached.ts < POP_GEO_TTL) {
    geojson = cached.geojson
  } else {
    const row = db.prepare('SELECT geojson FROM shapefiles WHERE id = ?').get(sf.id)
    geojson = row ? JSON.parse(row.geojson) : null
    if (geojson) {
      popGeoCache.set(sf.id, { geojson, ts: Date.now() })
      if (popGeoCache.size > 5) popGeoCache.delete(popGeoCache.keys().next().value)
    }
  }
  if (!geojson || !geojson.features) return out
  for (const radius of radii) {
    const ck = `${sf.id}_${lat}_${lng}_${radius}`
    const rc = popResultCache.get(ck)
    if (rc && Date.now() - rc.ts < POP_RESULT_TTL) { out[radius] = rc.total; continue }
    const circle = turf.circle([lng, lat], radius / 1000, { steps: 64, units: 'kilometers' })
    const circleBbox = turf.bbox(circle)
    let total = 0
    for (const feature of geojson.features) {
      const props = feature.properties || {}
      const val = parseFloat(props['常住人口'])
      if (isNaN(val) || val <= 0) continue
      try {
        const fBbox = turf.bbox(feature)
        if (fBbox[0] > circleBbox[2] || fBbox[2] < circleBbox[0] || fBbox[1] > circleBbox[3] || fBbox[3] < circleBbox[1]) continue
      } catch (e) { /* 包围盒失败，回退完整计算 */ }
      const geom = feature.geometry
      if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue
      try {
        if (geom.type === 'Polygon') {
          const inter = turf.intersect(turf.featureCollection([turf.polygon(geom.coordinates), circle]))
          if (!inter) continue
          const polyArea = turf.area(feature)
          const interArea = turf.area(inter)
          total += val * Math.min(interArea / polyArea, 1)
        } else {
          for (const coords of geom.coordinates) {
            try {
              const sub = turf.polygon(coords)
              const subInter = turf.intersect(turf.featureCollection([sub, circle]))
              if (!subInter) continue
              const subArea = turf.area(sub)
              const subInterArea = turf.area(subInter)
              total += val * Math.min(subInterArea / subArea, 1)
            } catch (e) { /* 单子多边形失败跳过 */ }
          }
        }
      } catch (e) { /* 相交失败跳过 */ }
    }
    out[radius] = Math.round(total)
    popResultCache.set(ck, { total: out[radius], ts: Date.now() })
    if (popResultCache.size > 500) popResultCache.delete(popResultCache.keys().next().value)
  }
  return out
}
function popVector(pop) {
  return [pop[1000] || 0, pop[3000] || 0, pop[5000] || 0]
}

// ===================== 半径点位信息（竞品/门店 DB + 高德 POI） =====================
const poiCache = new Map()   // `${kw}_${radius}_${lat}_${lng}` -> { count, ts }
const POI_TTL = 24 * 60 * 60 * 1000
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// 高德周边检索（带 24h 缓存 + 串行 300ms 防 QPS 超限 + 独立降级）
async function amapCount(lng, lat, radius, kw) {
  const key = `${kw}_${radius}_${lat.toFixed(4)}_${lng.toFixed(4)}`
  const hit = poiCache.get(key)
  if (hit && Date.now() - hit.ts < POI_TTL) return hit.count
  try {
    const amap = await aroundSearch(lng, lat, radius, kw)
    const count = (amap && amap.count) ? parseInt(amap.count) : 0
    poiCache.set(key, { count, ts: Date.now() })
    if (poiCache.size > 2000) poiCache.delete(poiCache.keys().next().value)
    return count
  } catch (e) {
    console.error(`[sales-forecast] 高德检索失败 ${kw}@${radius}m:`, e.message)
    return null
  }
}
// 半径点位信息：竞品/我的门店（DB 快算）+ 写字楼/大学/医院/地铁/购物中心（高德）
async function calcRadiusPoints(db, lat, lng) {
  const out = { competitors500: 0, myStores500: 0, offices: {}, universities: {}, hospitals: {}, metro500: null, malls500: null }
  if (!lat || !lng) return out
  const R = 6371000
  const dist = (la, lo) => {
    const dLat = (la - lat) * Math.PI / 180
    const dLng = (lo - lng) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(la * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(a))
  }
  try {
    const comps = db.prepare('SELECT latitude, longitude FROM competitors WHERE latitude IS NOT NULL AND longitude IS NOT NULL').all()
    const myStores = db.prepare('SELECT latitude, longitude FROM markers WHERE latitude IS NOT NULL AND longitude IS NOT NULL').all()
    out.competitors500 = comps.filter(c => dist(c.latitude, c.longitude) <= 500).length
    out.myStores500 = myStores.filter(s => dist(s.latitude, s.longitude) <= 500).length
  } catch (e) {
    console.error('[sales-forecast] DB 点位统计失败:', e.message)
  }
  // 高德 POI（串行 + 300ms 间隔防 QPS 超限）
  try {
    for (const r of [500, 1000, 3000]) {
      out.offices[r] = await amapCount(lng, lat, r, '写字楼')
      await sleep(300)
    }
    for (const r of [1000, 3000]) {
      out.universities[r] = await amapCount(lng, lat, r, '大学')
      await sleep(300)
      out.hospitals[r] = await amapCount(lng, lat, r, '医院')
      await sleep(300)
    }
    out.metro500 = await amapCount(lng, lat, 500, '地铁站')
    await sleep(300)
    out.malls500 = await amapCount(lng, lat, 500, '购物中心')
  } catch (e) {
    console.error('[sales-forecast] 高德点位统计失败:', e.message)
  }
  return out
}

function getReferenceStores(db, userId, isAdmin) {
  const curYear = new Date().getFullYear()
  const targetYear = curYear - 1 // 最近完整年份
  const ms = db.prepare(
    isAdmin ? `SELECT * FROM markers` : `SELECT * FROM markers WHERE user_id = ?`
  ).all(...(isAdmin ? [] : [userId]))
  // 已开业门店（非候选）
  const open = ms.filter(m => m.store_type === '已开业')
  if (open.length === 0) return []
  const sales = db.prepare(`SELECT * FROM store_sales WHERE month = 0`).all()
  const refs = []
  for (const m of open) {
    const recs = sales.filter(s => s.store_id === m.id)
    if (recs.length === 0) continue
    // 最近完整年份优先，无则最新
    const sorted = [...recs].sort((a, b) => b.year - a.year)
    const rec = sorted.find(s => s.year === targetYear) || sorted[0]
    const area = rec.store_area || m.store_area || m.area || null
    if (!area || area <= 0 || !rec.sales_amount || rec.sales_amount <= 0) continue
    const d = findDistrict(m.latitude, m.longitude)
    refs.push({
      storeId: m.id,
      name: m.name,
      brand: m.brand,
      city: m.city,
      mallType: m.mall_type,
      tradeAreaType: m.trade_area_type,
      storeCategory: m.store_category,
      lat: m.latitude,
      lng: m.longitude,
      area,
      year: rec.year,
      salesAmount: rec.sales_amount,
      deliveryRatio: rec.delivery_ratio != null ? Number(rec.delivery_ratio) : null,
      district: d,
      districtProfile: districtProfileVector(d)
    })
  }
  return refs
}

// 三类型匹配打分（已填维度参与，返回匹配字段数）
function typeMatchScore(cand, ref) {
  let score = 0
  if (cand.mallType && ref.mallType && cand.mallType === ref.mallType) score++
  if (cand.tradeAreaType && ref.tradeAreaType && cand.tradeAreaType === ref.tradeAreaType) score++
  if (cand.storeCategory && ref.storeCategory && cand.storeCategory === ref.storeCategory) score++
  return score
}

// 参照坪效（综合 + 有效）
function refPingxiao(r) {
  const comp = r.salesAmount / r.area // 综合坪效（元/㎡/年）
  let eff = comp
  if (r.deliveryRatio != null && r.deliveryRatio >= 0) {
    eff = r.salesAmount * (1 - r.deliveryRatio / 100) / r.area
  }
  return { comp, eff }
}

// ===================== 候选门店列表 =====================
router.get('/candidates', authenticate, (req, res) => {
  try {
    const db = getDb()
    const isAdmin = req.user.role === 'admin'
    const ms = db.prepare(
      isAdmin ? `SELECT * FROM markers` : `SELECT * FROM markers WHERE user_id = ?`
    ).all(...(isAdmin ? [] : [req.user.id]))
    const cands = ms.filter(m => m.store_type === '重点候选' || m.store_type === '一般候选')
    // 已购联通数据：门店名 → 半径列表（多个半径逗号展示）
    const boughtRows = db.prepare(
      `SELECT store_name, radius FROM purchases WHERE ${isAdmin ? '1=1' : 'user_id = ?'} AND status = 'active' AND result_data IS NOT NULL AND result_data != ''`
    ).all(...(isAdmin ? [] : [req.user.id]))
    const boughtMap = {}
    for (const b of boughtRows) {
      let rs = []
      try { rs = JSON.parse(b.radius || '[]') } catch (e) { rs = [] }
      if (!Array.isArray(rs)) rs = [rs]
      rs = rs.map(Number).filter(n => n > 0 && !isNaN(n))
      if (rs.length === 0) continue
      if (!boughtMap[b.store_name]) boughtMap[b.store_name] = []
      boughtMap[b.store_name] = [...new Set([...boughtMap[b.store_name], ...rs])].sort((a, b) => a - b)
    }
    const list = cands.map(m => ({
      id: m.id,
      storeCode: m.store_code,
      name: m.name,
      brand: m.brand,
      city: m.city,
      district: m.district,
      storeType: m.store_type,
      storeArea: m.store_area || m.area || null,
      mallType: m.mall_type,
      tradeAreaType: m.trade_area_type,
      storeCategory: m.store_category,
      hasProfile: !!boughtMap[m.name] && boughtMap[m.name].length > 0,
      radii: boughtMap[m.name] || []
    }))
    res.json({ success: true, candidates: list })
  } catch (e) {
    console.error('[sales-forecast] candidates 失败:', e.message)
    res.status(500).json({ message: '获取候选门店失败' })
  }
})

// ===================== 预测 =====================
// ===================== L2 回归（Ridge · log坪效 · LOOCV） =====================
const DELIVERY_RATIO_MAP = {
  '霸王茶姬': 65, '茶百道': 65, '蜜雪冰城': 70, '瑞幸咖啡': 60, '库迪咖啡': 60,
  '肯德基': 45, '麦当劳': 45, '华莱士': 55, '正新鸡排': 70,
  '食其家': 40, '吉野家': 40, '老乡鸡': 35, '大米先生': 45, '米村拌饭': 35, '谷田稻香': 45, '杨国福': 50, '张亮麻辣烫': 50,
  '西塔老太太': 15, '海底捞': 15, '呷哺呷哺': 20, '外婆家': 10, '绿茶餐厅': 10
}
// 半径 500m 内竞品/我的门店数（DB 快算）
function countNearby(db, lat, lng, radius) {
  const R = 6371000
  const dist = (la, lo) => {
    const dLat = (la - lat) * Math.PI / 180
    const dLng = (lo - lng) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(la * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(a))
  }
  try {
    const comps = db.prepare('SELECT latitude, longitude FROM competitors WHERE latitude IS NOT NULL AND longitude IS NOT NULL').all()
    const my = db.prepare('SELECT latitude, longitude FROM markers WHERE latitude IS NOT NULL AND longitude IS NOT NULL').all()
    return { comp: comps.filter(x => dist(x.latitude, x.longitude) <= radius).length, my: my.filter(x => dist(x.latitude, x.longitude) <= radius).length }
  } catch (e) { return { comp: 0, my: 0 } }
}
// 特征行（训练样本与候选店同构）：[log面积, 外卖占比, 商圈4维, 半径人口3档, 竞品500, 我的门店500, 年份码, 商场类型码, 商圈类型码]
function buildX(store, area, dr, dv, pop, nearby, year, mallCode, tradeCode) {
  return [
    Math.log(area), dr,
    dv[0] || 0, dv[1] || 0, dv[2] || 0, dv[3] || 0,
    pop[1000] || 0, pop[3000] || 0, pop[5000] || 0,
    nearby.comp, nearby.my,
    year - 2020,
    mallCode, tradeCode
  ]
}
// 构建训练集：该用户已开业店 × 有销售记录的年份（年度记录 month=0 + 月度按年聚合），不跨用户
function buildTrainingSet(db, userId, isAdmin) {
  const ms = db.prepare(isAdmin ? `SELECT * FROM markers` : `SELECT * FROM markers WHERE user_id = ?`).all(...(isAdmin ? [] : [userId]))
  const open = ms.filter(m => m.store_type === '已开业')
  const annual = db.prepare(`SELECT store_id, year, SUM(sales_amount) AS amount, MAX(delivery_ratio) AS dr, AVG(store_area) AS area FROM store_sales WHERE month > 0 GROUP BY store_id, year`).all()
  const y0 = db.prepare(`SELECT * FROM store_sales WHERE month = 0`).all()
  const mallSet = new Set(), tradeSet = new Set()
  const cands = []
  for (const m of open) {
    if (!m.latitude || !m.longitude) continue
    const baseArea = m.store_area || m.area
    if (!baseArea || baseArea <= 0) continue
    const recs = []
    y0.filter(s => s.store_id === m.id).forEach(r => recs.push({ year: r.year, amount: r.sales_amount, dr: r.delivery_ratio, area: r.store_area || baseArea }))
    annual.filter(s => s.store_id === m.id).forEach(r => recs.push({ year: r.year, amount: r.amount, dr: r.dr, area: r.area || baseArea }))
    for (const rec of recs) {
      if (!rec.amount || rec.amount <= 0 || rec.area <= 0) continue
      cands.push({ store: m, rec })
      if (m.mall_type) mallSet.add(m.mall_type)
      if (m.trade_area_type) tradeSet.add(m.trade_area_type)
    }
  }
  const MALL_CODES = new Map([...mallSet].map((v, i) => [v, i + 1]))
  const TRADE_CODES = new Map([...tradeSet].map((v, i) => [v, i + 1]))
  const rows = []
  for (const { store: m, rec } of cands) {
    const d = findDistrict(m.latitude, m.longitude)
    const dv = d ? districtProfileVector(d) : [0, 0, 0, 0]
    const pop = calcRadiusPopulation(db, m.latitude, m.longitude, m.city)
    const nearby = countNearby(db, m.latitude, m.longitude, 500)
    const dr = rec.dr != null && rec.dr !== '' ? Number(rec.dr) : (DELIVERY_RATIO_MAP[m.brand] ?? 35)
    rows.push({
      store: m, year: rec.year, area: rec.area, salesAmount: rec.amount, deliveryRatio: dr,
      X: buildX(m, rec.area, dr, dv, pop, nearby, rec.year, MALL_CODES.get(m.mall_type) || 0, TRADE_CODES.get(m.trade_area_type) || 0),
      y: Math.log(rec.amount / rec.area)
    })
  }
  return rows
}
// ===== 最小矩阵运算 =====
function matMul(A, B) {
  const m = A.length, n = A[0].length, p = B[0].length
  const C = Array.from({ length: m }, () => new Array(p).fill(0))
  for (let i = 0; i < m; i++) for (let k = 0; k < n; k++) { const a = A[i][k]; if (!a) continue; for (let j = 0; j < p; j++) C[i][j] += a * B[k][j] }
  return C
}
function matTrans(A) { return A[0].map((_, j) => A.map(r => r[j])) }
function matInv(A) {
  const n = A.length
  const aug = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col; r < n; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r
    if (Math.abs(aug[pivot][col]) < 1e-12) throw new Error('矩阵奇异')
    ;[aug[col], aug[pivot]] = [aug[pivot], aug[col]]
    const pv = aug[col][col]
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pv
    for (let r = 0; r < n; r++) { if (r === col) continue; const f = aug[r][col]; for (let j = 0; j < 2 * n; j++) aug[r][j] -= f * aug[col][j] }
  }
  return aug.map(row => row.slice(n))
}
// Ridge 回归（特征 z-score 标准化 + 截距列 + L2 正则），返回可预测模型
function ridgeFitStd(Xraw, y, lambda = 1) {
  const n = Xraw.length, d = Xraw[0].length
  const mean = new Array(d).fill(0), std = new Array(d).fill(1)
  for (let j = 0; j < d; j++) { let s = 0; for (let i = 0; i < n; i++) s += Xraw[i][j]; mean[j] = s / n }
  for (let j = 0; j < d; j++) { let s = 0; for (let i = 0; i < n; i++) s += (Xraw[i][j] - mean[j]) ** 2; std[j] = Math.sqrt(s / n) || 1 }
  const X = Xraw.map(r => [1, ...r.map((v, j) => (v - mean[j]) / std[j])])
  const Xt = matTrans(X)
  const XtX = matMul(Xt, X)
  for (let i = 1; i < XtX.length; i++) XtX[i][i] += lambda
  const Xty = Xt.map(row => [row.reduce((s, v, k) => s + v * y[k], 0)])
  const beta = matMul(matInv(XtX), Xty).map(r => r[0])
  return {
    mean, std, beta,
    predictRaw(x) { const xs = x.map((v, j) => (v - this.mean[j]) / this.std[j]); return this.beta[0] + xs.reduce((s, v, i) => s + v * this.beta[i + 1], 0) }
  }
}
// LOOCV：留一交叉验证 → MAPE + 残差百分比 std（置信度）
function loocvL2(rows, lambda = 1) {
  const errs = []
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i)
    const model = ridgeFitStd(train.map(r => r.X), train.map(r => r.y), lambda)
    const predEff = Math.exp(model.predictRaw(rows[i].X))
    const actEff = Math.exp(rows[i].y)
    errs.push(Math.abs(predEff - actEff) / actEff)
  }
  const mape = errs.reduce((a, b) => a + b, 0) / errs.length
  const sd = Math.sqrt(errs.reduce((a, b) => a + (b - mape) ** 2, 0) / errs.length)
  return { mape, residStd: sd }
}

// 样本统计（前端提示用）：已开业店数 + 已录入销售样本行数（店×年）+ L2/L3 门槛
router.get('/stats', authenticate, (req, res) => {
  try {
    const db = getDb()
    const isAdmin = req.user.role === 'admin'
    const userId = req.user.id
    const stores = db.prepare(
      isAdmin ? `SELECT COUNT(*) c FROM markers WHERE store_type = '已开业'`
              : `SELECT COUNT(*) c FROM markers WHERE user_id = ? AND store_type = '已开业'`
    ).get(...(isAdmin ? [] : [userId])).c
    const samples = db.prepare(
      `SELECT COUNT(*) c FROM (
         SELECT s.store_id, s.year FROM store_sales s JOIN markers m ON s.store_id = m.id
         WHERE ${isAdmin ? '1=1' : 'm.user_id = ?'} AND m.store_type = '已开业'
         GROUP BY s.store_id, s.year
       )`
    ).get(...(isAdmin ? [] : [userId])).c
    const l2 = 50, l3 = 300
    res.json({ success: true, stores, samples, l2, l3, l2Gap: Math.max(l2 - samples, 0), l3Gap: Math.max(l3 - samples, 0) })
  } catch (e) {
    console.error('[sales-forecast] stats 失败:', e.message)
    res.status(500).json({ message: '样本统计失败' })
  }
})

router.post('/predict', authenticate, async (req, res) => {
  try {
    const db = getDb()
    const storeId = Number(req.body.storeId)
    if (!storeId) return res.status(400).json({ message: '缺少 storeId' })
    const isAdmin = req.user.role === 'admin'
    const cand = db.prepare(
      isAdmin ? `SELECT * FROM markers WHERE id = ?` : `SELECT * FROM markers WHERE id = ? AND user_id = ?`
    ).get(storeId, ...(isAdmin ? [] : [req.user.id]))
    if (!cand) return res.status(404).json({ message: '门店不存在' })
    if (cand.store_type !== '重点候选' && cand.store_type !== '一般候选') {
      return res.status(400).json({ message: '仅支持对候选门店（重点候选/一般候选）预测' })
    }

    const candDistrict = findDistrict(cand.latitude, cand.longitude)
    const candProfile = storeProfileVector(db, cand.name)
    const candArea = cand.store_area || cand.area
    const candDr = null // 候选店暂无销售记录，用业态默认（前端传或按品牌查 DELIVERY_RATIO_MAP）

    const refs = getReferenceStores(db, req.user.id, isAdmin)
    if (refs.length === 0) {
      return res.json({ success: true, status: 'insufficient', message: '暂无参照门店（需要已开业门店录入年度销售数据）' })
    }

    // 候选店半径常住人口（免费网格 1/3/5km，结果卡片展示 + 降级链第 2 级画像匹配）
    const candPop = calcRadiusPopulation(db, cand.latitude, cand.longitude, cand.city)
    // 候选店半径点位信息（竞品/我的门店 DB + 写字楼/大学/医院/地铁/购物中心 高德 POI）
    const candPoints = await calcRadiusPoints(db, cand.latitude, cand.longitude)

    const candRef = {
      brand: cand.brand,
      city: cand.city,
      mallType: cand.mall_type,
      tradeAreaType: cand.trade_area_type,
      storeCategory: cand.store_category,
      districtName: candDistrict ? candDistrict.name : null,
      districtCity: candDistrict ? candDistrict.city : null
    }

    // ===== L2 回归（样本 ≥ 50 且 LOOCV MAPE 优于 L1 经验 35%，否则回退 L1） =====
    try {
      const trainSet = buildTrainingSet(db, req.user.id, isAdmin)
      console.log('[sales-forecast] L2 trainSet =', trainSet.length)
      if (trainSet.length >= 50) {
        const cv = loocvL2(trainSet, 1)
        console.log('[sales-forecast] L2 LOOCV mape =', cv.mape.toFixed(3), 'residStd =', cv.residStd.toFixed(3))
        if (cv.mape < 0.35) {
          const model = ridgeFitStd(trainSet.map(r => r.X), trainSet.map(r => r.y), 1)
          const dv = candDistrict ? districtProfileVector(candDistrict) : [0, 0, 0, 0]
          const nearby = countNearby(db, cand.latitude, cand.longitude, 500)
          const dr = DELIVERY_RATIO_MAP[cand.brand] ?? 35
          const candX = buildX(cand, candArea, dr, dv, candPop, nearby, new Date().getFullYear(), 0, 0)
          const predLog = model.predictRaw(candX)
          const predictComp = Math.round(Math.exp(predLog) * candArea)
          const predictEff = predictComp
          const cs = candX.map((v, j) => (v - model.mean[j]) / model.std[j])
          const top5 = trainSet
            .map(r => ({ ref: r, d2: r.X.reduce((s, v, j) => s + ((v - model.mean[j]) / model.std[j] - cs[j]) ** 2, 0) }))
            .sort((a, b) => a.d2 - b.d2)
            .slice(0, 5)
          const refList = top5.map(({ ref }) => ({
            name: ref.store.name, brand: ref.store.brand, city: ref.store.city,
            area: ref.area, year: ref.year, salesAmount: ref.salesAmount,
            pingxiao: Math.round(ref.salesAmount / ref.area), sim: null
          }))
          const confPct = Math.max(10, Math.min(Math.round(cv.residStd * 100), 50))
          return res.json({
            success: true, status: 'ok', level: 8, engine: 'L2',
            levelName: 'L2 回归模型（基于 ' + trainSet.length + ' 条门店×年样本，LOOCV MAPE ' + (cv.mape * 100).toFixed(1) + '%）',
            candName: cand.name, candArea,
            radiusPopulation: candPop, radiusPoints: candPoints,
            predictComp, predictEff,
            predictCompWan: (predictComp / 10000).toFixed(1),
            predictEffWan: (predictEff / 10000).toFixed(1),
            conf: confPct,
            rangeWan: [Math.round(predictComp / 10000 * (1 - confPct / 100)), Math.round(predictComp / 10000 * (1 + confPct / 100))],
            refCount: top5.length, refs: refList,
            candDistrict: candDistrict ? { city: candDistrict.city, name: candDistrict.name } : null
          })
        }
      }
    } catch (e) {
      console.error('[sales-forecast] L2 失败回退 L1:', e.message)
    }

    // ===== 6 级降级链匹配 =====
    const MIN_REFS = 3
    let matched = [] // { ref, level }
    let level = 0
    let levelName = ''

    // L1 门店画像相似度（双方购联通数据）
    if (candProfile) {
      const scored = refs
        .map(r => ({ r, sim: cosineSimilarity(candProfile, storeProfileVector(db, r.name)) }))
        .filter(x => x.sim > 0.5)
        .sort((a, b) => b.sim - a.sim)
      if (scored.length >= MIN_REFS) {
        matched = scored.slice(0, 10).map(x => ({ ref: x.r, sim: x.sim }))
        level = 1
        levelName = `门店画像相似度（基于 ${matched.length} 家购联通数据门店）`
      }
    }

    // L2 半径人口画像相似度（免费网格常住人口 1/3/5km，联通数据少时的免费替代画像）
    if (level === 0 && (candPop[1000] || candPop[3000] || candPop[5000])) {
      const scored = []
      for (const r of refs) {
        const rPop = calcRadiusPopulation(db, r.lat, r.lng, r.city)
        if (!(rPop[1000] || rPop[3000] || rPop[5000])) continue
        const sim = cosineSimilarity(popVector(candPop), popVector(rPop))
        if (sim > 0.5) scored.push({ ref: r, sim })
      }
      scored.sort((a, b) => b.sim - a.sim)
      if (scored.length >= MIN_REFS) {
        matched = scored.slice(0, 10)
        level = 2
        levelName = `半径人口画像相似度（基于 ${matched.length} 家，1/3/5km 常住人口）`
      }
    }

    // L3 同商圈 + 同类型
    if (level === 0 && candDistrict) {
      const hits = refs.filter(r => r.district && r.district.name === candDistrict.name && typeMatchScore(candRef, r) > 0)
      if (hits.length >= MIN_REFS) {
        const scored = hits.map(r => ({ ref: r, sim: typeMatchScore(candRef, r) })).sort((a, b) => b.sim - a.sim)
        matched = scored.slice(0, 10)
        level = 3
        levelName = `同商圈「${candDistrict.name}」+ 同类型门店（基于 ${matched.length} 家）`
      }
    }

    // L4 同类型（同城跨商圈）
    if (level === 0) {
      const hits = refs.filter(r => r.city === candRef.city && typeMatchScore(candRef, r) > 0)
      if (hits.length >= MIN_REFS) {
        const scored = hits.map(r => ({ ref: r, sim: typeMatchScore(candRef, r) })).sort((a, b) => b.sim - a.sim)
        matched = scored.slice(0, 10)
        level = 4
        levelName = `同城同类型门店（${candRef.city}，基于 ${matched.length} 家）`
      }
    }

    // L4 商圈画像相似度 Top-N
    if (level === 0) {
      const withDp = refs.filter(r => r.districtProfile)
      if (withDp.length >= MIN_REFS) {
        const cdp = candDistrict ? districtProfileVector(candDistrict) : null
        if (cdp) {
          const scored = withDp
            .map(r => ({ ref: r, sim: cosineSimilarity(cdp, r.districtProfile) }))
            .filter(x => x.sim > 0.3)
            .sort((a, b) => b.sim - a.sim)
          if (scored.length >= MIN_REFS) {
            matched = scored.slice(0, 10)
            level = 5
            levelName = `商圈画像相似度（基于 ${matched.length} 家，跨商圈匹配）`
          }
        }
      }
    }

    // L6 同城市
    if (level === 0) {
      const hits = refs.filter(r => r.city === candRef.city)
      if (hits.length >= MIN_REFS) {
        matched = hits.slice(0, 10).map(r => ({ ref: r }))
        level = 6
        levelName = `同城市「${candRef.city}」门店（基于 ${matched.length} 家）`
      }
    }

    // L7 全国兜底
    if (level === 0) {
      matched = refs.slice(0, 10).map(r => ({ ref: r }))
      level = 7
      levelName = `全国同业态门店（基于 ${matched.length} 家，数据有限）`
    }

    if (matched.length === 0) {
      return res.json({ success: true, status: 'insufficient', message: '无可用参照门店' })
    }

    // ===== 坪效预测 =====
    const pingxiaos = matched.map(({ ref }) => {
      const { comp, eff } = refPingxiao(ref)
      // 候选店模式未知（无销售记录），默认用综合坪效；未来可传外卖模式
      return { comp, eff }
    })
    const compValues = pingxiaos.map(p => p.comp).sort((a, b) => a - b)
    const effValues = pingxiaos.map(p => p.eff).sort((a, b) => a - b)
    const median = (arr) => arr.length ? arr[Math.floor(arr.length / 2)] : 0
    const compMedian = median(compValues)
    const effMedian = median(effValues)
    // 综合坪效预测（含外卖）+ 有效坪效预测（堂食口径）
    const predictComp = Math.round(compMedian * candArea)
    const predictEff = Math.round(effMedian * candArea)

    // 置信度（按匹配级 + 样本数）
    const confByLevel = { 1: 0.15, 2: 0.2, 3: 0.25, 4: 0.3, 5: 0.35, 6: 0.4, 7: 0.45 }
    let conf = confByLevel[level] || 0.4
    if (matched.length < 5) conf = Math.min(conf + 0.1, 0.5)

    const refList = matched.map(({ ref, sim }) => ({
      name: ref.name,
      brand: ref.brand,
      city: ref.city,
      area: ref.area,
      year: ref.year,
      salesAmount: ref.salesAmount,
      pingxiao: Math.round(refPingxiao(ref).comp),
      sim: sim != null ? Math.round(sim * 100) : null
    }))

    res.json({
      success: true,
      status: 'ok',
      engine: 'L1',
      level,
      levelName,
      candName: cand.name,
      candArea,
      radiusPopulation: candPop,
      radiusPoints: candPoints,
      predictComp,   // 预测年销售额（元，综合口径含外卖）
      predictEff,    // 预测年销售额（元，堂食有效口径）
      predictCompWan: (predictComp / 10000).toFixed(1),
      predictEffWan: (predictEff / 10000).toFixed(1),
      conf: Math.round(conf * 100),
      rangeWan: [Math.round(predictComp / 10000 * (1 - conf)), Math.round(predictComp / 10000 * (1 + conf))],
      refCount: matched.length,
      refs: refList,
      candDistrict: candDistrict ? { city: candDistrict.city, name: candDistrict.name } : null
    })
  } catch (e) {
    console.error('[sales-forecast] predict 失败:', e.message)
    res.status(500).json({ message: '预测失败：' + e.message })
  }
})

export default router
