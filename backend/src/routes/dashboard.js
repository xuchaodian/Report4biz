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
    // 异常状态过滤（所有门店查询共用）
    const ABNORMAL_STATUS_SQL = `AND store_status NOT IN (${ABNORMAL_STATUS.map(() => '?').join(',')})`
    // 已开门店过滤（KPI 我的门店/覆盖城市/覆盖省份 统一为「仅已开业」口径，与地图/TOP10 一致）
    const OPEN_ONLY_SQL = `AND store_type = '已开业'`
    const markersCount = db.prepare(`SELECT COUNT(*) AS c FROM markers WHERE 1=1 ${ABNORMAL_STATUS_SQL} ${OPEN_ONLY_SQL}`).get(...ABNORMAL_STATUS)?.c || 0
    const competitorsCount = db.prepare('SELECT COUNT(*) AS c FROM competitors').get()?.c || 0
    const centersCount = db.prepare('SELECT COUNT(*) AS c FROM shopping_centers').get()?.c || 0
    const brandStoresCount = db.prepare('SELECT COUNT(*) AS c FROM brand_stores').get()?.c || 0

    // 我的门店覆盖城市数（仅已开业）
    const markerCities = db.prepare(`SELECT COUNT(DISTINCT city) AS c FROM markers WHERE city IS NOT NULL AND city != "" ${ABNORMAL_STATUS_SQL} ${OPEN_ONLY_SQL}`).get(...ABNORMAL_STATUS)?.c || 0
    // 竞品覆盖城市数
    const compCities = db.prepare('SELECT COUNT(DISTINCT city) AS c FROM competitors WHERE city IS NOT NULL AND city != ""').get()?.c || 0
    // 我的门店覆盖省份数（仅已开业；城市→省份映射后去重）
    const markerProvCount = new Set(
      db.prepare(`SELECT DISTINCT city FROM markers WHERE city IS NOT NULL AND city != "" ${ABNORMAL_STATUS_SQL} ${OPEN_ONLY_SQL}`).all(...ABNORMAL_STATUS)
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
    // 省级聚合源：我的门店仅「已开业」（与城市级默认视图、城市TOP10口径一致）
    const markerOpenCitiesAgg = db.prepare(`
      SELECT rtrim(city, '市') AS name,
             COUNT(*) AS value,
             ROUND(AVG(latitude), 4) AS lat,
             ROUND(AVG(longitude), 4) AS lng
      FROM markers
      WHERE latitude IS NOT NULL AND latitude != 0 AND longitude IS NOT NULL AND longitude != 0
        AND city IS NOT NULL AND city != ''
        AND store_type = '已开业'
        AND store_status NOT IN (${ABNORMAL_STATUS.map(() => '?').join(',')})
      GROUP BY rtrim(city, '市') ORDER BY value DESC LIMIT 200
    `).all(...ABNORMAL_STATUS)
    const markerProvAgg = aggToProvince(markerOpenCitiesAgg)
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

    // ===== 省级拆分聚合（按省份 + 类型/品牌分组） =====
    const aggToProvinceGrouped = (rows) => {
      const keyOf = (r) => r.group_key + '|' + toProvince(r.city || r.name)
      const map = {}
      rows.forEach(r => {
        const k = keyOf(r)
        if (!map[k]) {
          map[k] = { name: toProvince(r.city || r.name), group_key: r.group_key, value: 0, latSum: 0, lngSum: 0, cnt: 0 }
        }
        map[k].value += r.value
        map[k].latSum += r.lat * r.value
        map[k].lngSum += r.lng * r.value
        map[k].cnt += r.value
      })
      return Object.values(map)
        .map(p => ({ name: p.name, group_key: p.group_key, value: p.value, lat: Math.round(p.latSum / p.cnt * 10000) / 10000, lng: Math.round(p.lngSum / p.cnt * 10000) / 10000 }))
        .sort((a, b) => b.value - a.value)
    }
    const markerByTypeProv = aggToProvinceGrouped(markerByType)
    const compByBrandProv = aggToProvinceGrouped(compByBrand)
    // 竞品品牌 TOP10（前端只显示主要品牌颜色）
    const compBrandList = db.prepare('SELECT brand AS name, COUNT(*) AS value FROM competitors WHERE brand IS NOT NULL AND brand != "" GROUP BY brand ORDER BY value DESC LIMIT 10').all()

    // ===== 用户购买/配额 =====
    const quota = db.prepare('SELECT remaining_quota FROM admin_quota WHERE id = 1').get()
    const myPurchases = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(quota_used),0) AS used FROM purchases WHERE user_id = ? AND status = "active"').get(userId)

    // ===== 门店健康度（在营 / 闭店 / 闭店率）=====
    // 口径与地图/TOP10 统一：store_type='已开业'，在营=状态非异常，闭店=闭店/停业/歇业等
    const ABNORMAL_STATUS_HEALTH = ['闭店', '停业', '歇业', '关闭', '停业整顿', '结业', '未知', '待开业', '筹备中']
    const healthRow = db.prepare(`
      SELECT
        SUM(CASE WHEN store_status NOT IN (${ABNORMAL_STATUS_HEALTH.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS operating,
        SUM(CASE WHEN store_status IN (${ABNORMAL_STATUS_HEALTH.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS closed,
        COUNT(*) AS total
      FROM markers
      WHERE store_type = '已开业'
    `).get(...ABNORMAL_STATUS_HEALTH, ...ABNORMAL_STATUS_HEALTH)
    const operating = healthRow?.operating || 0
    const closed = healthRow?.closed || 0
    const health = {
      operating,
      closed,
      other: Math.max(0, (healthRow?.total || 0) - operating - closed),
      closedRate: (operating + closed) > 0 ? Math.round(closed / (operating + closed) * 1000) / 10 : 0
    }
    // 按城市闭店率 TOP10（已开业口径；门店量 ≥3 且闭店 >0，避免样本噪音）
    const cityHealth = db.prepare(`
      SELECT rtrim(city, '市') AS city,
        SUM(CASE WHEN store_status NOT IN (${ABNORMAL_STATUS_HEALTH.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS operating,
        SUM(CASE WHEN store_status IN (${ABNORMAL_STATUS_HEALTH.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS closed
      FROM markers
      WHERE city IS NOT NULL AND city != '' AND store_type = '已开业'
      GROUP BY rtrim(city, '市')
    `).all(...ABNORMAL_STATUS_HEALTH, ...ABNORMAL_STATUS_HEALTH)
      .map(r => ({ city: r.city, operating: r.operating || 0, closed: r.closed || 0, rate: ((r.operating || 0) + (r.closed || 0)) >= 3 ? Math.round((r.closed || 0) / ((r.operating || 0) + (r.closed || 0)) * 1000) / 10 : 0 }))
      .filter(r => r.closed > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10)

    // ===== 对比期环比（上月 vs 上上月，按 created_at 录入门店；避免本月未结束误导） =====
    const _now = new Date()
    const _ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const lastMonth = _ym(new Date(_now.getFullYear(), _now.getMonth() - 1, 1))   // 上月（完整月）
    const prevMonth = _ym(new Date(_now.getFullYear(), _now.getMonth() - 2, 1))   // 上上月（完整月）
    const newLastMonth = db.prepare(`SELECT COUNT(*) AS c FROM markers WHERE substr(created_at, 1, 7) = ?`).get(lastMonth)?.c || 0
    const newPrevMonth = db.prepare(`SELECT COUNT(*) AS c FROM markers WHERE substr(created_at, 1, 7) = ?`).get(prevMonth)?.c || 0
    // 近 12 个月门店数据趋势（created_at 口径，格式统一且覆盖全）
    const months = []
    for (let i = 11; i >= 0; i--) {
      months.push(_ym(new Date(_now.getFullYear(), _now.getMonth() - i, 1)))
    }
    const trendRows = db.prepare(`
      SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS c FROM markers
      WHERE substr(created_at, 1, 7) >= ?
      GROUP BY substr(created_at, 1, 7)
    `).all(months[0])
    const trendMap = Object.fromEntries(trendRows.map(r => [r.m, r.c]))
    const storeTrend = months.map(m => ({ month: m, count: trendMap[m] || 0 }))
    const compare = {
      lastMonth,
      prevMonth,
      newLastMonth,
      newPrevMonth,
      change: newPrevMonth > 0 ? Math.round((newLastMonth - newPrevMonth) / newPrevMonth * 1000) / 10 : (newLastMonth > 0 ? 100 : 0),
      storeTrend
    }

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
      health,
      cityHealth,
      compare,
      points: {
        markers: markerCitiesAgg,
        competitors: compCitiesAgg,
        markersProv: markerProvAgg,
        competitorsProv: compProvAgg,
        markerByType,
        compByBrand,
        markerByTypeProv,
        compByBrandProv,
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
