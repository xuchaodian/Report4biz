import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { getDb } from '../models/database.js'
import { CITY_TO_PROVINCE } from '../data/city-provinces.js'
import { CITY_TAGS } from '../data/city-tags.js'
import { CITY_GEO } from '../data/city-geo.js'
import { authenticate } from '../middleware/auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const router = express.Router()

// 城市宏观数据（GDP/人口/社零等）
const cityDataPath = path.join(__dirname, '../data/city_data.json')

// 评分权重默认值（存 market_map_config 表，可在前端调整）
const DEFAULT_WEIGHTS = {
  marketSize: 0.30,      // 市场规模：常住人口 × 社零
  competition: 0.25,     // 竞争强度（反向）：竞品密度越低分越高
  brandGap: 0.25,        // 品牌空白度：本品牌渗透率越低分越高
  consumption: 0.20      // 消费潜力：人均可支配收入 + 人均消费支出
}

// 读取权重配置（数据库优先，无则默认；归一化保证总和为 1）
function getWeights(db) {
  try {
    const row = db.prepare(`SELECT weights FROM market_map_config WHERE id = 1`).get()
    if (row?.weights) {
      const parsed = JSON.parse(row.weights)
      const w = { ...DEFAULT_WEIGHTS, ...parsed }
      const sum = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0)
      if (sum > 0) {
        Object.keys(w).forEach(k => { w[k] = Number(w[k]) / sum })
      }
      return w
    }
  } catch (e) {
    console.warn('[MarketMap] 读取权重配置失败，用默认值:', e.message)
  }
  return { ...DEFAULT_WEIGHTS }
}

// 归一化工具：将值映射到 0-100（min-max）
const normalize = (val, min, max) => {
  if (max === min) return 50
  return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100))
}

// 城市名归一化（去掉"市"后缀）
const normCity = (c) => String(c || '').replace(/市$/, '')

const toProvince = (city) => {
  const c = normCity(city)
  return CITY_TO_PROVINCE[c] || c
}

// 读取城市宏观数据
function loadCityData() {
  try {
    const raw = fs.readFileSync(cityDataPath, 'utf-8')
    return JSON.parse(raw)
  } catch (e) {
    console.error('[MarketMap] city_data.json 读取失败:', e)
    return []
  }
}

/**
 * GET /api/market-map/opportunity
 * 城市市场机会评分榜
 */
router.get('/opportunity', (req, res) => {
  try {
    const db = getDb()
    const WEIGHTS = getWeights(db)
    const cityData = loadCityData()

    // 1. 我的门店按城市计数（全部门店，用于品牌渗透/空白度）
    const markerRows = db.prepare(`
      SELECT city, COUNT(*) AS c FROM markers
      WHERE city IS NOT NULL AND city != ''
      GROUP BY city
    `).all()

    // 2. 竞品按城市计数
    const compRows = db.prepare(`
      SELECT city, COUNT(*) AS c FROM competitors
      WHERE city IS NOT NULL AND city != '' AND (status IS NULL OR status NOT IN ('店铺已关','尚未营业'))
      GROUP BY city
    `).all()

    // 3. 品牌门店（brand_stores）按城市计数（用于品牌渗透基准）
    const brandRows = db.prepare(`
      SELECT city, COUNT(*) AS c FROM brand_stores
      WHERE city IS NOT NULL AND city != ''
      GROUP BY city
    `).all()

    const markerByCity = {}
    markerRows.forEach(r => { markerByCity[normCity(r.city)] = (markerByCity[normCity(r.city)] || 0) + r.c })
    const compByCity = {}
    compRows.forEach(r => { compByCity[normCity(r.city)] = (compByCity[normCity(r.city)] || 0) + r.c })
    const brandByCity = {}
    brandRows.forEach(r => { brandByCity[normCity(r.city)] = (brandByCity[normCity(r.city)] || 0) + r.c })

    // 4. 计算每个城市的四维原始值
    const rawList = cityData.map(d => {
      const city = normCity(d['城市'])
      const pop = Number(d['年末常住人口(万人)']) || 0
      const retail = Number(d['社会消费品零售总额(亿元)']) || 0
      const income = Number(d['城镇居民人均可支配收入(元)']) || 0
      const expense = Number(d['城镇居民人均消费支出(元)']) || 0
      const gdp = Number(d['GDP(亿元)']) || 0

      const myStores = markerByCity[city] || 0
      const compStores = compByCity[city] || 0
      const brandStores = brandByCity[city] || 0

      return {
        city,
        province: toProvince(city),
        level: d['等级'] || '',
        year: d['年份'] || '',
        population: pop,
        gdp,
        gdpGrowth: Number(d['增速(%)']) || 0,
        retail,
        income,
        expense,
        myStores,
        compStores,
        brandStores,
        // 原始指标
        marketSizeRaw: pop * (retail > 0 ? Math.log1p(retail) : 1),  // 人口 × ln(社零)
        compDensity: compStores / (pop || 1),   // 竞品密度（家/万人）
        brandGapRaw: pop > 0 ? myStores / pop : 0,  // 本品牌渗透率（家/万人）——越低越空白
        consumptionRaw: (income + expense) / 2
      }
    })

    // 5. 归一化四维分数（跨所有城市 min-max）
    const mSize = rawList.map(x => x.marketSizeRaw)
    const cDens = rawList.map(x => x.compDensity)
    const bGap = rawList.map(x => x.brandGapRaw)
    const cSum = rawList.map(x => x.consumptionRaw)
    const minmax = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr) })
    const mR = minmax(mSize), cR = minmax(cDens), bR = minmax(bGap), cR2 = minmax(cSum)

    const scored = rawList.map(x => {
      // 市场规模分（越大越高）
      const marketScore = normalize(x.marketSizeRaw, mR.min, mR.max)
      // 竞争强度分（密度越低越高——竞争少=机会）
      const compScore = 100 - normalize(x.compDensity, cR.min, cR.max)
      // 品牌空白度分（本品牌渗透率越低越空白=机会高）
      const gapScore = 100 - normalize(x.brandGapRaw, bR.min, bR.max)
      // 消费潜力分（收入+支出越高越好）
      const consumeScore = normalize(x.consumptionRaw, cR2.min, cR2.max)

      const opportunity = Math.round(
        WEIGHTS.marketSize * marketScore +
        WEIGHTS.competition * compScore +
        WEIGHTS.brandGap * gapScore +
        WEIGHTS.consumption * consumeScore
      )

      const level = opportunity >= 75 ? '优先进入' : (opportunity >= 50 ? '可观察' : '谨慎')

      return {
        city: x.city,
        province: x.province,
        level: x.level,
        year: x.year,
        tags: CITY_TAGS[x.city] || [],
        areaKm2: CITY_GEO[x.city]?.areaKm2 || null,
        districts: CITY_GEO[x.city]?.districts ?? null,
        population: Math.round(x.population),
        gdp: Math.round(x.gdp),
        gdpGrowth: x.gdpGrowth,
        retail: Math.round(x.retail),
        income: Math.round(x.income),
        expense: Math.round(x.expense),
        myStores: x.myStores,
        compStores: x.compStores,
        brandStores: x.brandStores,
        scores: {
          marketSize: Math.round(marketScore),
          competition: Math.round(compScore),
          brandGap: Math.round(gapScore),
          consumption: Math.round(consumeScore)
        },
        opportunity,
        level
      }
    })

    // 6. 排序：机会分从高到低
    scored.sort((a, b) => b.opportunity - a.opportunity)

    // 7. 省份聚合（取省内最高分作为省份代表色）
    const provAgg = {}
    scored.forEach(s => {
      if (!provAgg[s.province] || s.opportunity > provAgg[s.province].opportunity) {
        provAgg[s.province] = { province: s.province, opportunity: s.opportunity, level: s.level, cityCount: (provAgg[s.province]?.cityCount || 0) }
      }
      provAgg[s.province].cityCount++
    })
    const provinces = Object.values(provAgg).sort((a, b) => b.opportunity - a.opportunity)

    res.json({
      success: true,
      weights: WEIGHTS,
      totalCities: scored.length,
      cities: scored,
      provinces
    })
  } catch (e) {
    console.error('[MarketMap] 机会评分失败:', e)
    res.status(500).json({ success: false, message: e.message })
  }
})

/**
 * GET /api/market-map/weights
 * 获取当前评分权重
 */
router.get('/weights', (req, res) => {
  try {
    const db = getDb()
    res.json({ success: true, weights: getWeights(db) })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
})

/**
 * PUT /api/market-map/weights
 * 更新评分权重（仅管理员）
 * Body: { weights: { marketSize, competition, brandGap, consumption } }
 */
router.put('/weights', authenticate, (req, res) => {
  try {
    const { weights } = req.body || {}
    if (!weights || typeof weights !== 'object') {
      return res.status(400).json({ success: false, message: '缺少权重参数' })
    }
    const merged = { ...DEFAULT_WEIGHTS, ...weights }
    // 校验每个权重为非负数字
    for (const k of Object.keys(DEFAULT_WEIGHTS)) {
      const v = Number(merged[k])
      if (isNaN(v) || v < 0) {
        return res.status(400).json({ success: false, message: `权重 ${k} 无效` })
      }
      merged[k] = v
    }
    const sum = Object.values(merged).reduce((a, b) => a + b, 0)
    if (sum <= 0) {
      return res.status(400).json({ success: false, message: '权重总和必须大于 0' })
    }
    // 归一化到总和 1
    Object.keys(merged).forEach(k => { merged[k] = Number((merged[k] / sum).toFixed(4)) })

    const db = getDb()
    db.prepare(`UPDATE market_map_config SET weights = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(JSON.stringify(merged))
    res.json({ success: true, weights: merged, message: '权重已更新' })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
})

export default router
