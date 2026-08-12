import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { CITY_TO_PROVINCE } from '../data/city-provinces.js'

const router = express.Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 数据大屏聚合接口
 * GET /api/dashboard/summary
 * 返回大屏所需的全部 KPI 与图表数据（一次拉取）
 */
router.get('/summary', authenticate, async (req, res) => {
  try {
    const db = getDb()
    const userId = req.user.id

    // 异常经营状态（停业/歇业/关闭等，大屏聚合排除）
    const ABNORMAL_STATUS = ['闭店', '停业', '歇业', '关闭', '停业整顿', '未知', '待开业', '筹备中']

    // 城市→省份映射
    const toProvince = (city) => {
      const c = String(city || '').replace(/市$/, '')
      return CITY_TO_PROVINCE[c] || c
    }

    // ===== KPI 指标 =====
    // 我的门店总数（排除异常状态：闭店/停业/歇业/关闭等）
    const ABNORMAL_STATUS_SQL = `AND store_status NOT IN (${ABNORMAL_STATUS.map(() => '?').join(',')})`
    const markersCount = db.prepare(`SELECT COUNT(*) AS c FROM markers WHERE 1=1 ${ABNORMAL_STATUS_SQL}`).get(...ABNORMAL_STATUS)?.c || 0
    const competitorsCount = db.prepare('SELECT COUNT(*) AS c FROM competitors').get()?.c || 0
    const centersCount = db.prepare('SELECT COUNT(*) AS c FROM shopping_centers').get()?.c || 0
    const brandStoresCount = db.prepare('SELECT COUNT(*) AS c FROM brand_stores').get()?.c || 0

    // 我的门店覆盖城市数（同样排除异常状态）
    const markerCities = db.prepare(`SELECT COUNT(DISTINCT city) AS c FROM markers WHERE city IS NOT NULL AND city != "" ${ABNORMAL_STATUS_SQL}`).get(...ABNORMAL_STATUS)?.c || 0
    // 竞品覆盖城市数
    const compCities = db.prepare('SELECT COUNT(DISTINCT city) AS c FROM competitors WHERE city IS NOT NULL AND city != ""').get()?.c || 0
    // 我的门店覆盖省份数（城市→省份映射后去重）
    const markerProvCount = new Set(
      db.prepare(`SELECT DISTINCT city FROM markers WHERE city IS NOT NULL AND city != "" ${ABNORMAL_STATUS_SQL}`).all(...ABNORMAL_STATUS)
        .map(r => toProvince(r.city))
    ).size
    // 竞品覆盖省份数
    const compProvCount = new Set(
      db.prepare('SELECT DISTINCT city FROM competitors WHERE city IS NOT NULL AND city != ""').all()
        .map(r => toProvince(r.city))
    ).size

    // 我的门店类型分布（排除异常状态）
    const markerTypes = db.prepare(`SELECT store_type AS name, COUNT(*) AS value FROM markers WHERE 1=1 ${ABNORMAL_STATUS_SQL} GROUP BY store_type ORDER BY value DESC LIMIT 8`).all(...ABNORMAL_STATUS)

    // 我的门店城市 TOP10（仅已开业门店；城市归一化：去掉"市"后缀，合并 上海/上海市；排除异常状态）
    const cityRows = db.prepare(`SELECT city, COUNT(*) AS c FROM markers WHERE city IS NOT NULL AND city != "" AND store_type = '已开业' ${ABNORMAL_STATUS_SQL} GROUP BY city`).all(...ABNORMAL_STATUS)
    const cityAgg = {}
    cityRows.forEach(r => {
      const key = String(r.city).replace(/市$/, '')
      cityAgg[key] = (cityAgg[key] || 0) + r.c
    })
    const markerCityTop = Object.entries(cityAgg)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)

    // 竞品品牌 TOP10
    const compBrandTop = db.prepare('SELECT brand AS name, COUNT(*) AS value FROM competitors WHERE brand IS NOT NULL AND brand != "" GROUP BY brand ORDER BY value DESC LIMIT 10').all()

    // 我的门店/竞品 近30天新增（无时间字段则给最近7天趋势占位）
    const trend = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000)
      trend.push({ date: `${d.getMonth() + 1}/${d.getDate()}`, my: 0, comp: 0 })
    }

    // ===== 城市级聚合（按 rtrim(city,'市') 归一化合并 南京/南京市 → 南京） =====
    const markerCitiesAgg = db.prepare(`
      SELECT rtrim(city, '市') AS name,
             COUNT(*) AS value,
             ROUND(AVG(latitude), 4) AS lat,
             ROUND(AVG(longitude), 4) AS lng
      FROM markers
      WHERE latitude IS NOT NULL AND latitude != 0 AND longitude IS NOT NULL AND longitude != 0
        AND city IS NOT NULL AND city != ''
        AND store_status NOT IN (${ABNORMAL_STATUS.map(() => '?').join(',')})
      GROUP BY rtrim(city, '市') ORDER BY value DESC LIMIT 200
    `).all(...ABNORMAL_STATUS)
    const compCitiesAgg = db.prepare(`
      SELECT rtrim(city, '市') AS name,
             COUNT(*) AS value,
             ROUND(AVG(latitude), 4) AS lat,
             ROUND(AVG(longitude), 4) AS lng
      FROM competitors
      WHERE latitude IS NOT NULL AND latitude != 0 AND longitude IS NOT NULL AND longitude != 0
        AND city IS NOT NULL AND city != ''
      GROUP BY rtrim(city, '市') ORDER BY value DESC LIMIT 200
    `).all()

    // ===== 省级聚合（按城市→省份映射汇总 + 省代表坐标） =====
    const aggToProvince = (rows) => {
      const provMap = {}
      rows.forEach(r => {
        const prov = toProvince(r.name)
        if (!provMap[prov]) provMap[prov] = { name: prov, value: 0, latSum: 0, lngSum: 0, cnt: 0 }
        provMap[prov].value += r.value
        provMap[prov].latSum += r.lat * r.value
        provMap[prov].lngSum += r.lng * r.value
        provMap[prov].cnt += r.value
      })
      return Object.values(provMap)
        .map(p => ({ name: p.name, value: p.value, lat: Math.round(p.latSum / p.cnt * 10000) / 10000, lng: Math.round(p.lngSum / p.cnt * 10000) / 10000 }))
        .sort((a, b) => b.value - a.value)
    }
    const markerProvAgg = aggToProvince(markerCitiesAgg)
    const compProvAgg = aggToProvince(compCitiesAgg)

    // ===== 按类型/品牌拆分的城市级聚合（用于地图多色区分） =====
    // 我的门店按 store_type 拆分（已开业/重点候选/一般候选）
    const markerByType = db.prepare(`
      SELECT rtrim(city, '市') AS city, store_type AS group_key, COUNT(*) AS value,
             ROUND(AVG(latitude), 4) AS lat, ROUND(AVG(longitude), 4) AS lng
      FROM markers
      WHERE latitude IS NOT NULL AND latitude != 0 AND longitude IS NOT NULL AND longitude != 0
        AND city IS NOT NULL AND city != ''
        AND store_status NOT IN (${ABNORMAL_STATUS.map(() => '?').join(',')})
      GROUP BY rtrim(city, '市'), store_type
    `).all(...ABNORMAL_STATUS)
    // 竞品按品牌拆分（仅取品牌 TOP10 防止过多）
    const compByBrand = db.prepare(`
      SELECT rtrim(city, '市') AS city, brand AS group_key, COUNT(*) AS value,
             ROUND(AVG(latitude), 4) AS lat, ROUND(AVG(longitude), 4) AS lng
      FROM competitors
      WHERE latitude IS NOT NULL AND latitude != 0 AND longitude IS NOT NULL AND longitude != 0
        AND city IS NOT NULL AND city != ''
        AND brand IS NOT NULL AND brand != ''
      GROUP BY rtrim(city, '市'), brand
    `).all()
    // 竞品品牌 TOP10（前端只显示主要品牌颜色）
    const compBrandList = db.prepare('SELECT brand AS name, COUNT(*) AS value FROM competitors WHERE brand IS NOT NULL AND brand != "" GROUP BY brand ORDER BY value DESC LIMIT 10').all()

    // ===== 用户购买/配额 =====
    const quota = db.prepare('SELECT remaining_quota FROM admin_quota WHERE id = 1').get()
    const myPurchases = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(quota_used),0) AS used FROM purchases WHERE user_id = ? AND status = "active"').get(userId)

    // ===== 城市宏观数据（JSON 文件）=====
    let cityData = []
    try {
      const raw = fs.readFileSync(path.join(__dirname, '../data/city_data.json'), 'utf-8')
      const parsed = JSON.parse(raw)
      cityData = Array.isArray(parsed) ? parsed : (parsed.cities || [])
    } catch (e) {
      console.warn('读取城市数据失败:', e.message)
    }

    res.json({
      success: true,
      kpi: {
        markers: markersCount,
        competitors: competitorsCount,
        centers: centersCount,
        brandStores: brandStoresCount,
        markerCities,
        compCities,
        markerProvCount,
        compProvCount,
        quotaRemaining: quota?.remaining_quota ?? 0,
        myPurchases: myPurchases?.c ?? 0,
        myQuotaUsed: myPurchases?.used ?? 0
      },
      charts: {
        markerTypes,
        markerCityTop,
        compBrandTop,
        trend
      },
      points: {
        markers: markerCitiesAgg,
        competitors: compCitiesAgg,
        markersProv: markerProvAgg,
        competitorsProv: compProvAgg,
        markerByType,
        compByBrand,
        compBrandList
      },
      cityData: cityData.slice(0, 50),
      updatedAt: new Date().toISOString()
    })
  } catch (e) {
    console.error('大屏数据聚合失败:', e)
    res.status(500).json({ error: e.message })
  }
})

export default router
