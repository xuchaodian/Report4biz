import express from 'express'
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
router.post('/predict', authenticate, (req, res) => {
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

    const candRef = {
      brand: cand.brand,
      city: cand.city,
      mallType: cand.mall_type,
      tradeAreaType: cand.trade_area_type,
      storeCategory: cand.store_category,
      districtName: candDistrict ? candDistrict.name : null,
      districtCity: candDistrict ? candDistrict.city : null
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

    // L2 同商圈 + 同类型
    if (level === 0 && candDistrict) {
      const hits = refs.filter(r => r.district && r.district.name === candDistrict.name && typeMatchScore(candRef, r) > 0)
      if (hits.length >= MIN_REFS) {
        const scored = hits.map(r => ({ ref: r, sim: typeMatchScore(candRef, r) })).sort((a, b) => b.sim - a.sim)
        matched = scored.slice(0, 10)
        level = 2
        levelName = `同商圈「${candDistrict.name}」+ 同类型门店（基于 ${matched.length} 家）`
      }
    }

    // L3 同类型（同城跨商圈）
    if (level === 0) {
      const hits = refs.filter(r => r.city === candRef.city && typeMatchScore(candRef, r) > 0)
      if (hits.length >= MIN_REFS) {
        const scored = hits.map(r => ({ ref: r, sim: typeMatchScore(candRef, r) })).sort((a, b) => b.sim - a.sim)
        matched = scored.slice(0, 10)
        level = 3
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
            level = 4
            levelName = `商圈画像相似度（基于 ${matched.length} 家，跨商圈匹配）`
          }
        }
      }
    }

    // L5 同城市
    if (level === 0) {
      const hits = refs.filter(r => r.city === candRef.city)
      if (hits.length >= MIN_REFS) {
        matched = hits.slice(0, 10).map(r => ({ ref: r }))
        level = 5
        levelName = `同城市「${candRef.city}」门店（基于 ${matched.length} 家）`
      }
    }

    // L6 全国兜底
    if (level === 0) {
      matched = refs.slice(0, 10).map(r => ({ ref: r }))
      level = 6
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
    const confByLevel = { 1: 0.15, 2: 0.2, 3: 0.25, 4: 0.3, 5: 0.35, 6: 0.4 }
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
      level,
      levelName,
      candName: cand.name,
      candArea,
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
