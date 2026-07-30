import { getDb } from '../models/database.js'

// === 评分引擎配置 ===
const DEFAULT_WEIGHTS = {
  population: 0.40,
  competition: 0.25,
  support: 0.20,
  transport: 0.15
}

/**
 * 对指定区域进行门店潜力评分
 * @param {Object} params
 * @param {number} params.lng - 中心经度
 * @param {number} params.lat - 中心纬度
 * @param {number} params.radius - 分析半径(米)
 * @param {Object} params.weights - 权重配置
 * @param {number} params.competitionThreshold - 竞品饱和阈值
 * @param {string} params.city - 城市名
 * @returns {Object} 评分结果
 */
export async function scoreLocation({ lng, lat, radius = 1000, weights = DEFAULT_WEIGHTS, competitionThreshold = 10, city }) {
  const db = getDb()

  // 1. 人口指数
  const popScore = await calcPopulationScore(db, lng, lat, radius, city)

  // 2. 竞争指数
  const compCount = await countCompetitors(db, lng, lat, radius)
  const compScore = calcCompetitionScore(compCount, competitionThreshold)

  // 3. 配套指数 + 交通指数
  const poiResult = await fetchPOIScores(lng, lat, radius)
  const { supportScore, transportScore, poiCount } = poiResult

  // 4. 加权汇总
  const total = Math.round(
    weights.population * popScore +
    weights.competition * compScore +
    weights.support * supportScore +
    weights.transport * transportScore
  )

  return {
    score: total,
    scorePopulation: Math.round(popScore),
    scoreCompetition: Math.round(compScore),
    scoreSupport: Math.round(supportScore),
    scoreTransport: Math.round(transportScore),
    competitorCount: compCount,
    poiCount,
    populationDensity: null  // 由人口数据计算
  }
}

/**
 * 批量评分（用于网格列表）
 */
export async function scoreBatch(grids, config) {
  const results = []
  const weights = {
    population: config.weight_population,
    competition: config.weight_competition,
    support: config.weight_support,
    transport: config.weight_transport
  }

  // 分批处理，避免一次请求太多
  const batchSize = 20
  for (let i = 0; i < grids.length; i += batchSize) {
    const batch = grids.slice(i, i + batchSize)
    const promises = batch.map(g =>
      scoreLocation({
        lng: g.lng, lat: g.lat,
        radius: Math.round((config.radius_km || 1) * 1000),
        weights,
        competitionThreshold: config.competition_threshold || 10,
        city: g.city
      }).then(s => ({ ...s, lng: g.lng, lat: g.lat, address: g.address || '', gridId: g.gridId || '' }))
    )
    const batchResults = await Promise.allSettled(promises)
    batchResults.forEach(r => {
      if (r.status === 'fulfilled') results.push(r.value)
    })
  }

  return results.sort((a, b) => b.score - a.score)
}

// === 各维度评分函数 ===

async function calcPopulationScore(db, lng, lat, radiusM, city) {
  try {
    // 从shapefiles中获取人口数据（复用现有数据）
    const rows = db.prepare(`
      SELECT SUM(CAST(properties AS REAL)) as total FROM shapefiles
      WHERE category = 'population' AND city = ?
    `).get(city)

    // 如果没有人口数据，返回默认中等分
    if (!rows || !rows.total) return 60

    // 简易分档：通过shapefile的网格数量和总人口估算
    const gridCount = (db.prepare(`
      SELECT COUNT(*) as cnt FROM shapefiles WHERE category = 'population' AND city = ?
    `).get(city))?.cnt || 1

    const avgDensity = rows.total / gridCount
    // 基准密度参考值可调，这里按经验值
    if (avgDensity > 5000) return 90
    if (avgDensity > 3000) return 75
    if (avgDensity > 1500) return 60
    if (avgDensity > 500) return 40
    return 20
  } catch (e) {
    console.warn('[Scoring] 人口评分失败:', e.message)
    return 50
  }
}

function countCompetitors(db, lng, lat, radiusM) {
  try {
    // 使用近似计算（1度≈111km）
    const latDelta = radiusM / 111000
    const lngDelta = radiusM / (111000 * Math.cos(lat * Math.PI / 180))

    const rows = db.prepare(`
      SELECT COUNT(*) as cnt FROM competitors
      WHERE latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
    `).get(
      lat - latDelta, lat + latDelta,
      lng - lngDelta, lng + lngDelta
    )
    return rows?.cnt || 0
  } catch (e) {
    console.warn('[Scoring] 竞争评分失败:', e.message)
    return 0
  }
}

function calcCompetitionScore(count, threshold) {
  return Math.round(Math.max(0, 100 * (1 - count / threshold)))
}

async function fetchPOIScores(lng, lat, radiusM) {
  try {
    // 使用原生 fetch（Node 18+）
    const apiKey = '8e22ba2cec83bc554753a47842383949'

    // 搜索办公楼
    const officeRes = await fetch(
      `https://restapi.amap.com/v3/place/around?key=${apiKey}&location=${lng},${lat}&radius=${radiusM}&types=050000&offset=20&page=1`
    ).then(r => r.json()).catch(() => ({ count: 0 }))

    // 搜索地铁站
    const metroRes = await fetch(
      `https://restapi.amap.com/v3/place/around?key=${apiKey}&location=${lng},${lat}&radius=${radiusM}&types=150500&offset=20&page=1`
    ).then(r => r.json()).catch(() => ({ count: 0 }))

    // 搜索住宅小区
    const resiRes = await fetch(
      `https://restapi.amap.com/v3/place/around?key=${apiKey}&location=${lng},${lat}&radius=${radiusM}&types=120300&offset=20&page=1`
    ).then(r => r.json()).catch(() => ({ count: 0 }))

    const officeCount = parseInt(officeRes.count || 0)
    const metroCount = parseInt(metroRes.count || 0)
    const resiCount = parseInt(resiRes.count || 0)
    const poiTotal = officeCount + metroCount + resiCount

    // 配套评分：办公楼+住宅越多分越高
    const supportScore = Math.min(100, (officeCount * 3 + resiCount * 2) / 2)

    // 交通评分：地铁站权重高
    const transportScore = Math.min(100, metroCount * 20 + (poiTotal > 0 ? 10 : 0))

    return { supportScore, transportScore, poiCount: poiTotal }
  } catch (e) {
    console.warn('[Scoring] POI评分失败:', e.message)
    return { supportScore: 50, transportScore: 50, poiCount: 0 }
  }
}
