import { getDb } from '../models/database.js'
import { saveToCache, getAuthorization, buildCircleWkt, checkIfDataIsEmpty, initCacheTable } from '../routes/smartsteps.js'
import { AMAP_KEY } from '../config.js'
import { fetchWithTimeout, SLOW_HTTP_TIMEOUT_MS, DEFAULT_HTTP_TIMEOUT_MS } from './httpTimeout.js'
import { checkQuota, QuotaGateError } from './quotaGate.js'

// === 评分引擎配置 ===
const DEFAULT_WEIGHTS = {
  population: 0.40,
  competition: 0.25,
  support: 0.20,
  transport: 0.15
}

// 智慧足迹上游配置（与 smartsteps.js 保持一致）
const SMARTSTEPS_BASE_URL = 'https://jm-odp.smartsteps.com/febs'

// 计算最新可用数据年月（当前月-1，与前端一致）
function getLatestCityMonth() {
  const now = new Date()
  let month = now.getMonth() // 0-11
  let year = now.getFullYear()
  month -= 1
  if (month < 0) { month += 12; year -= 1 }
  return `${year}${String(month + 1).padStart(2, '0')}`
}

/**
 * 通过联通智慧足迹（1001 人口服务）获取点位人口规模
 * 优先命中缓存（免费），未命中才调上游并扣 1 次配额
 * @param {Object} [user] 调用者 { id, role }（v0.9 P0：供授权闸门判定组织成员额度）
 * @returns {{ totalPopulation: number, fromCache: boolean, quotaUsed: number } | null} 失败返回 null
 */
async function queryPointPopulation(db, lng, lat, radiusM, user) {
  const services = ['1001']
  const cityMonth = getLatestCityMonth()
  const servicesStr = '1001'

  try {
    initCacheTable(db)
    // 1. 宽松缓存匹配：同坐标+半径命中任意月份的历史数据（极目点不足时优先用真实历史数据，免费）
    const precision = 100000
    const lngKey = Math.round(lng * precision) / precision
    const latKey = Math.round(lat * precision) / precision
    const cachedRow = db.prepare(`
      SELECT result_data FROM smartsteps_cache
      WHERE center_lng = ? AND center_lat = ? AND radius = ?
        AND services LIKE '%1001%'
      ORDER BY city_month DESC, id DESC LIMIT 1
    `).get(lngKey, latKey, radiusM)
    if (cachedRow) {
      const cached = JSON.parse(cachedRow.result_data)
      const total = Number(cached['1001']?.pall_sum) || 0
      if (total > 0) {
        return { totalPopulation: total, fromCache: true, quotaUsed: 0, radiusM }
      }
    }

    // 2. 检查配额（v0.9 P0：统一走授权闸门 —— 物理池 + 成员授权额度）
    //    ★ v1.13.222（批次 218 遗留项 ①）：配额不足**不再 return null**。
    //      早先 return null 会被上层按「数据缺失」处理 ⇒ calcPopulationScore 给默认 60 分
    //      ⇒ 人口（权重 0.40）是编造的，用户却拿到一个看似合理的综合评分去做决策。
    //      现改为抛出 QuotaGateError，由路由 buildGateError 转成统一响应，
    //      前端据此走 requireQuota 引导（剩余次数 + 采购入口）。
    const gate = checkQuota(db, user?.id, 1, { role: user?.role })
    if (!gate.ok) {
      throw new QuotaGateError(gate)
    }

    // 3. 调上游 1001
    const token = await getAuthorization()
    const wkt = buildCircleWkt(lng, lat, radiusM)
    const response = await fetchWithTimeout(`${SMARTSTEPS_BASE_URL}/server/openApi/getData`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': token },
      body: JSON.stringify({ codes: '1001', cityMonth, radius: radiusM, polygons: wkt })
    }, SLOW_HTTP_TIMEOUT_MS)
    // ★ v1.13.222：以下「上游异常」类失败**不再静默 return null**，改为带 degraded 标记返回。
    //   与上文「配额不足」区分对待 —— 配额不足用户**可行动**（去采购）⇒ 抛错引导；
    //   上游失败/空数据用户**无从行动**（网络抖动、或该点确实无人口数据）⇒ 网络抖动时
    //   若也直接报错，会让评分功能在抖动期整站不可用，故照常出分但**显式标注降级**。
    //   前端据 degradedDims 显示「人口数据不可用」提示条，不再让用户以为分数是全量可信的。
    if (!response.ok) {
      console.warn('[Scoring] 人口上游调用失败:', response.status)
      return { totalPopulation: null, degraded: true, degradeReason: 'upstream_failed', radiusM }
    }
    const apiResponse = await response.json()
    if (apiResponse.code !== 200 || !apiResponse.data) {
      console.warn('[Scoring] 人口上游返回异常:', apiResponse.code)
      return { totalPopulation: null, degraded: true, degradeReason: 'upstream_failed', radiusM }
    }
    const result = apiResponse.data

    // 4. 空数据不扣配额
    if (checkIfDataIsEmpty(result)) {
      console.warn('[Scoring] 人口上游返回空数据，不扣配额')
      return { totalPopulation: null, degraded: true, degradeReason: 'upstream_empty', radiusM }
    }

    // 5. 扣配额 + 缓存
    db.prepare('UPDATE admin_quota SET remaining_quota = remaining_quota - 1 WHERE id = 1').run()
    saveToCache(db, lng, lat, radiusM, cityMonth, services, result)

    const total = Number(result['1001']?.pall_sum) || 0
    return { totalPopulation: total, fromCache: false, quotaUsed: 1, radiusM }
  } catch (e) {
    // ⛔ 闸门拒绝必须**穿透**本 catch —— 它属「配额不足」而非「数据缺失」，
    //   若在此被吞掉就退化成本批要修的那个静默降级（见本函数上文注释）。
    if (e?.isQuotaGate) throw e
    console.warn('[Scoring] 人口查询异常:', e.message)
    return { totalPopulation: null, degraded: true, degradeReason: 'exception', radiusM }
  }
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
export async function scoreLocation({ lng, lat, radius = 1000, weights = DEFAULT_WEIGHTS, competitionThreshold = 10, city, user }) {
  const db = getDb()
  const userId = user?.id
  const isAdmin = (user?.role === 'admin' || userId === 1) ? 1 : 0

  // 1. 人口指数
  //    ⚠️ 配额不足时 queryPointPopulation 会**抛 QuotaGateError**（不在此捕获，直穿到路由）；
  //       能走到下面说明要么命中缓存、要么调用成功、要么是「上游异常」类降级。
  const popResult = await queryPointPopulation(db, lng, lat, radius, user)
  const popScore = calcPopulationScore(popResult)
  const populationTotal = popResult?.totalPopulation ?? null
  const popDegraded = popResult?.degraded === true

  // 2. 竞争指数（周边有效竞品；用户隔离：admin全量特权，普通用户仅自己名下竞品）
  const compCount = await countCompetitors(db, lng, lat, radius, userId, isAdmin)
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
    populationDensity: populationTotal,  // 半径内总人口（来自联通1001）；降级时为 null
    // ★ v1.13.222：降级维度**显式外露**（当前只可能是 'population'）。
    //   ⛔ 前端不得靠 `populationDensity == null` 反推 —— 那与「该点人口确实为 0」
    //     不可区分。也正因如此，`degradeReason` 一并返回，便于区分
    //     upstream_failed（网络/上游异常）与 upstream_empty（该点确实无数据）。
    degradedDims: popDegraded ? ['population'] : [],
    degradeReason: popDegraded ? (popResult?.degradeReason || null) : null
  }
}

/**
 * 批量评分（用于网格列表）
 */
export async function scoreBatch(grids, config, user) {
  const results = []
  const weights = {
    population: config.weight_population,
    competition: config.weight_competition,
    support: config.weight_support,
    transport: config.weight_transport
  }

  // 配额保护：批量评分最多 20 个点位（每点最多耗 1 次配额，缓存命中免费）
  const MAX_GRIDS = 20
  const targetGrids = grids.slice(0, MAX_GRIDS)

  // 分批处理，避免一次请求太多
  const batchSize = 5
  for (let i = 0; i < targetGrids.length; i += batchSize) {
    const batch = targetGrids.slice(i, i + batchSize)
    const promises = batch.map(g =>
      scoreLocation({
        lng: g.lng, lat: g.lat,
        radius: Math.round((config.radius_km || 1) * 1000),
        weights,
        competitionThreshold: config.competition_threshold || 10,
        city: g.city,
        user
      }).then(s => ({ ...s, lng: g.lng, lat: g.lat, address: g.address || '', gridId: g.gridId || '' }))
    )
    const batchResults = await Promise.allSettled(promises)
    // ★ v1.13.222：原实现只 push fulfilled、**rejected 被静默丢弃** ⇒
    //   既少了点位又没有任何提示（「静默降级」的另一种形态，同样在本批修掉）。
    //   现在区分两类失败：
    //     · 配额不足（isQuotaGate）⇒ **整批抛错**。批量结果用于 `sort` 横向排序选最优，
    //       若部分点位缺人口（0.40 权重）则排序不可信 ⇒ 交路由统一走采购引导。
    //     · 其余异常 ⇒ 已在 scoreLocation 内降级为带标记的结果并被 fulfilled 收录；
    //       此处真抛出的（理论上不该有）仍忽略，避免个别点位毁掉整批。
    //   ⚠️ 全缓存命中场景不受影响：缓存分支在配额检查**之前**返回，不抛错。
    let gateError = null
    batchResults.forEach(r => {
      if (r.status === 'fulfilled') results.push(r.value)
      else if (r.reason?.isQuotaGate && !gateError) gateError = r.reason
    })
    if (gateError) throw gateError
  }

  return results.sort((a, b) => b.score - a.score)
}

// === 各维度评分函数 ===

function calcPopulationScore(popResult) {
  try {
    if (!popResult || !popResult.totalPopulation) {
      // 上游失败 / 空数据 / 降级 → 默认中等分 60（**占位分，非真实评估**）。
      // ⚠️ v1.13.222：**配额不足已不再走本分支** —— 那条路现在抛 QuotaGateError，
      //   连分数都不会产生。走到这里的都是「上游异常」类降级，且 scoreLocation 会
      //   同步置 degradedDims=['population'] 并透出 degradeReason，
      //   前端据此提示 ⇒ 这 60 分不再是**静默**的魔法值，而是**有标注的占位分**。
      return 60
    }

    const total = popResult.totalPopulation
    // 分档：按半径内总人口规模（pall_sum）相对评估
    // 1km 半径参考值：>8万 极旺 / 5-8万 旺 / 3-5万 中上 / 1.5-3万 中 / <1.5万 弱
    // 半径越大阈值按面积比例放大
    const areaScale = (popResult.radiusM ? popResult.radiusM : 1000) / 1000
    const areaScale2 = areaScale ** 2
    if (total > 80000 * areaScale2) return 95
    if (total > 50000 * areaScale2) return 85
    if (total > 30000 * areaScale2) return 72
    if (total > 15000 * areaScale2) return 55
    if (total > 7000 * areaScale2) return 40
    return 25
  } catch (e) {
    console.warn('[Scoring] 人口评分失败:', e.message)
    return 50
  }
}

function countCompetitors(db, lng, lat, radiusM, userId, isAdmin) {
  try {
    // 使用近似计算（1度≈111km）
    const latDelta = radiusM / 111000
    const lngDelta = radiusM / (111000 * Math.cos(lat * Math.PI / 180))

    const rows = db.prepare(`
      SELECT COUNT(*) as cnt FROM competitors
      WHERE (status IS NULL OR status NOT IN ('店铺已关','尚未营业'))
        AND latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
        AND (user_id = ? OR ? = 1)
    `).get(
      lat - latDelta, lat + latDelta,
      lng - lngDelta, lng + lngDelta,
      userId, isAdmin
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
    const apiKey = AMAP_KEY

    // 搜索办公楼
    const officeRes = await fetchWithTimeout(
      `https://restapi.amap.com/v3/place/around?key=${apiKey}&location=${lng},${lat}&radius=${radiusM}&types=050000&offset=20&page=1`, {}, DEFAULT_HTTP_TIMEOUT_MS
    ).then(r => r.json()).catch(() => ({ count: 0 }))

    // 搜索地铁站
    const metroRes = await fetchWithTimeout(
      `https://restapi.amap.com/v3/place/around?key=${apiKey}&location=${lng},${lat}&radius=${radiusM}&types=150500&offset=20&page=1`, {}, DEFAULT_HTTP_TIMEOUT_MS
    ).then(r => r.json()).catch(() => ({ count: 0 }))

    // 搜索住宅小区
    const resiRes = await fetchWithTimeout(
      `https://restapi.amap.com/v3/place/around?key=${apiKey}&location=${lng},${lat}&radius=${radiusM}&types=120300&offset=20&page=1`, {}, DEFAULT_HTTP_TIMEOUT_MS
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
