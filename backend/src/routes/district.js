/**
 * 高德行政区域边界查询代理路由
 *
 * 调用高德行政区域查询 API，获取城市/区县的边界坐标及面积排名
 */

import express from 'express'
import axios from 'axios'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// 高德 WebService API Key
const KEY = '8e22ba2cec83bc554753a47842383949'
const AMAP_URL = 'https://restapi.amap.com/v3/config/district'
const EARTH_RADIUS = 6371.0 // km

// 计算多边形面积（经纬度 → 平方公里）
function calcArea(boundaries) {
  let total = 0
  for (const ring of boundaries) {
    if (ring.length < 3) continue
    let area = 0
    const n = ring.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const lat1 = ring[i][0] * Math.PI / 180
      const lat2 = ring[j][0] * Math.PI / 180
      const lng1 = ring[i][1] * Math.PI / 180
      const lng2 = ring[j][1] * Math.PI / 180
      area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2))
    }
    total += Math.abs(area) * EARTH_RADIUS * EARTH_RADIUS / 2
  }
  return Math.round(total)
}

// 解析高德 polyline
function parsePolyline(polyline) {
  const boundaries = []
  if (!polyline) return boundaries
  const parts = polyline.split('|')
  for (const part of parts) {
    const points = part.split(';')
    const coords = points.map(p => {
      const [lng, lat] = p.split(',')
      return [parseFloat(lat), parseFloat(lng)]
    })
    if (coords.length > 2) boundaries.push(coords)
  }
  return boundaries
}

// 查询高德 API
async function queryAmap(params) {
  const res = await axios.get(AMAP_URL, {
    params: { key: KEY, output: 'JSON', ...params },
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Report4biz/1.0)' }
  })
  return res.data
}

/**
 * GET /api/district/boundary?keywords=浦东新区
 * 查询边界 + 面积 + 同城市面积排名
 */
router.get('/boundary', async (req, res) => {
  try {
    const { keywords } = req.query
    if (!keywords) {
      return res.status(400).json({ success: false, error: '缺少 keywords 参数' })
    }

    // 1. 查询目标区域
    const mainData = await queryAmap({ keywords, subdistrict: 0, extensions: 'all' })
    if (mainData.status !== '1' || !mainData.districts?.length) {
      return res.json({ success: false, error: mainData.info || '未找到该行政区划' })
    }

    const district = mainData.districts[0]
    const boundaries = parsePolyline(district.polyline || '')
    const area = calcArea(boundaries)
    const level = district.level

    // 2. 获取省名（用于显示"广东省珠海市"或"上海市闵行区"）
    let cityName = ''
    if (level === 'district' || level === 'city') {
      try {
        const provAdcode = Math.floor(parseInt(district.adcode) / 10000) * 10000
        const provData = await queryAmap({ keywords: String(provAdcode), subdistrict: 1, extensions: 'base' })
        if (provData.districts?.[0]?.name) cityName = provData.districts[0].name
      } catch (e) {
        // 省名获取失败不影响主数据
      }
    }

    // 3. 返回结果
    const [centerLng, centerLat] = (district.center || '').split(',').map(Number) || [0, 0]

    res.json({
      success: true,
      data: {
        name: district.name,
        adcode: district.adcode,
        level,
        cityName,
        center: [centerLat || 0, centerLng || 0],
        boundaries,
        area
      }
    })
  } catch (error) {
    console.error('[District] 查询失败:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// 射线法判断点是否在多边形内（ring 格式：[lng, lat]）
function pointInPoly(lng, lat, ring) {
  // 射线法（处理顶点相交问题）
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]

    // 只处理跨越水平线的边（严格处理顶点避免重复计数）
    if ((yi > lat) !== (yj > lat)) {
      const intersectLng = (xj - xi) * (lat - yi) / (yj - yi) + xi
      if (lng < intersectLng) {
        inside = !inside
      }
    }
  }
  return inside
}

/**
 * POST /api/district/store-counts
 * 统计行政边界内的各类型门店数量（从数据库直接读取，无视筛选）
 * Body: { boundaries: [[[lat,lng],...]] }  — Leaflet 格式 [lat, lng]
 */
router.post('/store-counts', authenticate, async (req, res) => {
  try {
    const { boundaries } = req.body
    if (!boundaries?.length) {
      return res.status(400).json({ success: false, error: '缺少 boundaries 参数' })
    }

    // 将 [lat, lng] 转为 [lng, lat]
    const rings = boundaries.map(ring => ring.map(p => [p[1], p[0]]))

    const db = getDb()

    // 1. 我的门店 — 含状态信息（仅统计当前用户的门店）
    const allMarkers = db.prepare('SELECT id, name, latitude, longitude, store_status FROM markers WHERE user_id = ?').all(req.user.id)
    let myStoreTotal = 0
    let closedCount = 0
    const closedKeywords = ['闭店', '停业', '歇业', '休业', '结业', '暂停营业']
    for (const m of allMarkers) {
      if (m.latitude && m.longitude) {
        for (const ring of rings) {
          if (pointInPoly(m.longitude, m.latitude, ring)) {
            myStoreTotal++
            if (m.store_status && closedKeywords.some(kw => m.store_status.includes(kw))) {
              closedCount++
            }
            break
          }
        }
      }
    }

    // 2. 竞品门店 — 按品牌分组
    const allCompetitors = db.prepare('SELECT id, name, brand, latitude, longitude FROM competitors WHERE user_id = ?').all(req.user.id)
    const brandCounts = {}
    for (const c of allCompetitors) {
      if (c.latitude && c.longitude) {
        for (const ring of rings) {
          if (pointInPoly(c.longitude, c.latitude, ring)) {
            const brand = c.brand || '未知品牌'
            brandCounts[brand] = (brandCounts[brand] || 0) + 1
            break
          }
        }
      }
    }

    // 3. 购物中心（管理员共享数据，不按用户过滤）
    const allShopping = db.prepare('SELECT id, name, latitude, longitude FROM shopping_centers').all()
    let shoppingTotal = 0
    for (const s of allShopping) {
      if (s.latitude && s.longitude) {
        for (const ring of rings) {
          if (pointInPoly(s.longitude, s.latitude, ring)) {
            shoppingTotal++
            break
          }
        }
      }
    }

    res.json({
      success: true,
      data: {
        myStores: { total: myStoreTotal, closed: closedCount },
        competitors: brandCounts,
        shoppingCenters: shoppingTotal
      }
    })
  } catch (error) {
    console.error('[District] 门店统计失败:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
