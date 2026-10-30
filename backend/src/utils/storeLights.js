/**
 * 门店体检 · 信号灯（v1.13.299 口径重构：**门店半径骨架**）
 *
 * 为什么推倒重来（2026-10-30 业主判定 + 生产实测坐实）：
 *   v1.13.297 的三条规则全部以「商圈面」为判定单位，实测 233 家门店暴露四个硬伤：
 *     ① 覆盖率 196/233 ⇒ 16% 门店永远「无法评估」，而这批里 9 家其实与自家门店同址 <50m；
 *     ② 规则①竞争密集 34 家 **100% 同时命中规则②**，且商圈面竞争分与「门店 500m 内竞品数」
 *        相关系数 r = −0.26（负相关）⇒ 该维度不止冗余，方向都是反的；
 *     ③ 规则②自我蚕食 156 家（80%），其中 68 家最近同品牌在 800m 外、22 家在 1.5km 外，
 *        原因是商圈面 1.02~47.7 km² ⇒ 判的是「这个片区挤不挤」，不是「这家店挤不挤」；
 *     ④ 规则③客群偏离 0 命中（3 类客群占比 40.8/37.8/21.4%，20% 阈值碰不到），
 *        且基线是拿客户自己门店分布反推的，天生趋同。
 *
 * 新骨架：**以门店坐标为圆心、按半径判**，商圈面降级为「展示字段」（名称/能级/客群）。
 *
 * 规则（两条参与打分，其余为结构提示）：
 *   ① 自我蚕食  = 最近同品牌门店距离（与体检页同一份索引，⛔ 不许另算）
 *        ≤50m   同址      → 双店型则 **不计分**（大店+小店是有意为之），否则 +3
 *        ≤300m  贴身      → +3
 *        ≤800m  部分重叠  → +2
 *        >800m            → 0（不叫蚕食，只展示）
 *   ② 竞争密度  = 门店 800m 内同业态竞品数 → ≥6 家 +3 / ≥3 家 +2
 *        该城市没有竞品点位 ⇒ **不评**（⛔ 不是「0 家竞品 ⇒ 宽松」）
 *
 * 🔴 三条不能动的口径：
 *   1. 「未评」≠「低风险」。没有竞品数据就不能给绿灯，明细里写「竞争未评」。
 *   2. 双店型同址不计分 ≠ 没问题：它是客户有意的两套店型组合，硬判蚕食等于让客户去关真店。
 *   3. 阈值只有一处（本文件常量 + 返回里的 thresholds），前端文案从接口取值，⛔ 不许硬编码。
 *
 * ⚠️ 竞品口径：`competitors` 由调用方按**可见域**（readableUserIds）取好再传进来，
 *    与「商圈洞察」同一批点位；本模块只做距离计数，不碰数据库。
 */

import { buildNeighborIndex } from './storeCheckup.js'
import { pointInFeature, geometryBBox } from './geoPoint.js'
import { looksLikeDualFormat } from './storeDedup.js'

/** 同址阈值（米）：小于它的同品牌门店按「同一个门」看 */
export const SAME_ADDR_M = 50
/** 贴身阈值（米） */
export const CLOSE_M = 300
/** 部分重叠阈值（米）：超出它不再算自我蚕食 */
export const OVERLAP_M = 800

/** 竞争密度的统计半径（米） */
export const COMP_RADIUS_M = 800
/** 该半径内竞品 ≥ 它 ⇒ +2 */
export const COMP_MID = 3
/** 该半径内竞品 ≥ 它 ⇒ +3 */
export const COMP_HIGH = 6

/** 风险分级：≥5 红 / 3~4 黄 / 1~2 绿 / 0 未发现问题 */
export const RISK_HIGH = 5
export const RISK_MID = 3

/** 参与打分的两项 */
export const FLAG = { CANNIBAL: 'cannibal', COMPETITION: 'competition' }

/** 门店评估状态（现在只有两种：有坐标就能评几何，没坐标才评不了） */
export const STATUS = {
  EVALUATED: 'evaluated',
  NO_COORD: 'no_coord'
}

/** 竞争维度的覆盖状态 */
export const COMP_STATUS = {
  EVALUATED: 'evaluated',   // 该城市有竞品点位，已按半径计数
  NO_DATA: 'no_data',       // 该城市没有竞品点位（或账号没导过竞品）⇒ 不评
  NO_CITY: 'no_city'        // 门店城市为空，无法判断竞品覆盖 ⇒ 不评
}

function cityKeyOf(city) {
  return String(city || '').replace(/市$/, '').trim()
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const AREA_M_PER_DEG_LAT = 111320

/**
 * 半径内竞品计数（按纬度分桶，避免「每店扫全量竞品」的 O(n·m)）
 * @param {Array} stores  有坐标的门店（含 latitude/longitude）
 * @param {Array} points  竞品点 [{ latitude, longitude }]
 * @param {number} radiusM
 * @returns {Map<string, number>} storeId → 半径内竞品数
 */
function countCompetitorsInRing(stores, points, radiusM) {
  const out = new Map()
  if (!points.length) return out

  const BUCKET_DEG = 0.02 // ≈2.2km，足够覆盖 800m 半径
  const buckets = new Map()
  for (const p of points) {
    const lat = Number(p?.latitude ?? p?.lat)
    const lng = Number(p?.longitude ?? p?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const key = Math.floor(lat / BUCKET_DEG)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push([lat, lng])
  }

  const R = 6371000
  const rad = Math.PI / 180
  const spanDeg = radiusM / AREA_M_PER_DEG_LAT + BUCKET_DEG

  for (const s of stores) {
    const lat = Number(s.latitude)
    const lng = Number(s.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    let n = 0
    const from = Math.floor((lat - spanDeg) / BUCKET_DEG)
    const to = Math.floor((lat + spanDeg) / BUCKET_DEG)
    for (let k = from; k <= to; k++) {
      const bucket = buckets.get(k)
      if (!bucket) continue
      for (const [plat, plng] of bucket) {
        const dLat = (plat - lat) * rad
        const dLng = (plng - lng) * rad
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(plat * rad) * Math.sin(dLng / 2) ** 2
        if (2 * R * Math.asin(Math.sqrt(h)) <= radiusM) n++
      }
    }
    out.set(String(s.id), n)
  }
  return out
}

/** 同品牌 ≤OVERLAP_M 的连通组（把「一坨」门店找出来，替代原来的「同商圈 8 家」） */
function findClusters(pairs, storeById, limit = 5) {
  const parent = new Map()
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)))
      x = parent.get(x)
    }
    return x
  }
  const ensure = (x) => { if (!parent.has(x)) parent.set(x, x) }
  const union = (a, b) => {
    ensure(a); ensure(b)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const p of pairs) union(String(p.aId), String(p.bId))

  const groups = new Map()
  for (const id of parent.keys()) {
    const r = find(id)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(id)
  }

  const clusters = []
  for (const ids of groups.values()) {
    if (ids.length < 2) continue
    const rows = ids.map(id => storeById.get(id)).filter(Boolean)
    if (rows.length < 2) continue
    const lats = rows.map(r => Number(r.latitude)).filter(Number.isFinite)
    const lngs = rows.map(r => Number(r.longitude)).filter(Number.isFinite)
    const cityCount = new Map()
    for (const r of rows) {
      const c = cityKeyOf(r.city) || '未知'
      cityCount.set(c, (cityCount.get(c) || 0) + 1)
    }
    const city = [...cityCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
    clusters.push({
      count: rows.length,
      city,
      names: rows.slice(0, 3).map(r => r.name || `#${r.id}`),
      centerLat: lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : null,
      centerLng: lngs.length ? lngs.reduce((a, b) => a + b, 0) / lngs.length : null
    })
  }
  return clusters.sort((a, b) => b.count - a.count).slice(0, limit)
}

/**
 * @param {object} input
 * @param {Array}  input.stores            本人门店（id/name/brand/city/latitude/longitude/store_code/store_area）
 * @param {Array}  [input.competitors]     可见域内竞品点位 [{ latitude, longitude, city }]
 * @param {Set|Array} [input.competitorCities] 有竞品点位的城市（去「市」）；不传按 competitors 推断
 * @param {Array}  [input.districts]       **仅用于展示**的商圈面 [{ name, city, level, crowd, geometry }]
 * @param {object} [input.opts]            可选阈值覆盖（测试与按业态校准用）
 */
export function buildStoreLights({
  stores = [],
  competitors = [],
  competitorCities = null,
  districts = [],
  opts = {}
} = {}) {
  const list = Array.isArray(stores) ? stores : []
  const comps = Array.isArray(competitors) ? competitors : []
  const dists = Array.isArray(districts) ? districts : []

  const compRadiusM = Number.isFinite(opts.compRadiusM) && opts.compRadiusM > 0 ? opts.compRadiusM : COMP_RADIUS_M
  const compMid = Number.isFinite(opts.compMid) ? opts.compMid : COMP_MID
  const compHigh = Number.isFinite(opts.compHigh) ? opts.compHigh : COMP_HIGH
  const riskHigh = Number.isFinite(opts.riskHigh) ? opts.riskHigh : RISK_HIGH
  const riskMid = Number.isFinite(opts.riskMid) ? opts.riskMid : RISK_MID

  // ① 同品牌近邻索引（与体检页**同一份算法**）：pairs 要覆盖到 OVERLAP_M 才能连簇
  const idx = buildNeighborIndex(list, { nearM: OVERLAP_M, capM: 20000, rings: [CLOSE_M, OVERLAP_M] })

  // ② 半径内竞品数（只为「城市有竞品点位」的门店算）
  const coveredCompCities = competitorCities
    ? new Set(Array.from(competitorCities).map(cityKeyOf).filter(Boolean))
    : new Set(comps.map(c => cityKeyOf(c?.city)).filter(Boolean))
  const compCounts = countCompetitorsInRing(idx.pts.map(p => p.s), comps, compRadiusM)

  // ③ 商圈面只为展示：预筛 bbox 后做射线法
  const prep = dists.map((d, i) => ({
    idx: i,
    name: d.name || `商圈${i + 1}`,
    city: cityKeyOf(d.city),
    level: d.level || '',
    crowd: d.crowd || '',
    geometry: d.geometry,
    bbox: geometryBBox(d.geometry)
  }))

  const lights = []
  const byLevel = { high: 0, mid: 0, low: 0, none: 0 }
  const selfDetail = { same: 0, sameDual: 0, close: 0, overlap: 0, far: 0 }
  const compStat = { hit: 0, evaluated: 0, noData: 0, noCity: 0 }
  let cannibalHit = 0
  let partialCount = 0

  for (const s of list) {
    const lat = toNum(s.latitude ?? s.lat)
    const lng = toNum(s.longitude ?? s.lng)
    const base = {
      storeId: s.id,
      name: s.name || '',
      brand: s.brand || '',
      city: s.city || '',
      lat,
      lng
    }

    if (lat == null || lng == null || (lat === 0 && lng === 0)) {
      // 没坐标 ⇒ 几何层也评不了；⛔ 不是「0 分」
      lights.push({
        ...base, status: STATUS.NO_COORD, nearestM: null, nearestName: '',
        selfBucket: '', dualFormat: false, peers800: 0,
        compRing: null, compStatus: COMP_STATUS.NO_DATA,
        riskScore: null, riskLevel: null, flags: [],
        district: '', districtLevel: '', crowd: '', districtCovered: false
      })
      continue
    }

    // —— 规则① 自我蚕食（最近同品牌距离）——
    const e = idx.byId.get(String(s.id))
    const nearestM = e && Number.isFinite(e.nearestM) ? Math.round(e.nearestM) : null
    const peers800 = e ? Number(e.ring[OVERLAP_M] || 0) : 0
    const dualFormat = !!(e?.nearestStore && Number(e.nearestM) <= SAME_ADDR_M && looksLikeDualFormat(s, e.nearestStore))

    let selfBucket = 'far'
    let selfScore = 0
    if (nearestM == null) {
      selfBucket = 'far'
      selfDetail.far++
    } else if (nearestM <= SAME_ADDR_M) {
      if (dualFormat) {
        // 同址双店型：客户有意的「大店+小店」组合，⛔ 不计分（判蚕食等于让他去关真店）
        selfBucket = 'sameDual'
        selfDetail.sameDual++
      } else {
        selfBucket = 'same'
        selfScore = 3
        selfDetail.same++
      }
    } else if (nearestM <= CLOSE_M) {
      selfBucket = 'close'
      selfScore = 3
      selfDetail.close++
    } else if (nearestM <= OVERLAP_M) {
      selfBucket = 'overlap'
      selfScore = 2
      selfDetail.overlap++
    } else {
      selfBucket = 'far'
      selfDetail.far++
    }

    // —— 规则② 竞争密度（半径内同业态竞品）——
    const ck = cityKeyOf(s.city)
    let compStatus
    let compRing = null
    if (!ck) {
      compStatus = COMP_STATUS.NO_CITY
    } else if (!coveredCompCities.has(ck)) {
      compStatus = COMP_STATUS.NO_DATA
    } else {
      compStatus = COMP_STATUS.EVALUATED
      compRing = compCounts.get(String(s.id)) ?? 0
    }

    let compScore = 0
    if (compStatus === COMP_STATUS.EVALUATED) {
      compStat.evaluated++
      if (compRing >= compHigh) compScore = 3
      else if (compRing >= compMid) compScore = 2
      if (compScore > 0) compStat.hit++
    } else if (compStatus === COMP_STATUS.NO_CITY) compStat.noCity++
    else compStat.noData++

    const flags = []
    if (selfScore > 0) { flags.push(FLAG.CANNIBAL); cannibalHit++ }
    if (compScore > 0) flags.push(FLAG.COMPETITION)

    const score = selfScore + compScore
    const level = score >= riskHigh ? 'high' : score >= riskMid ? 'mid' : score > 0 ? 'low' : 'none'
    byLevel[level]++
    if (compStatus !== COMP_STATUS.EVALUATED) partialCount++

    // —— 商圈画像：**只展示**，不参与打分、不影响状态 ——
    let district = ''
    let districtLevel = ''
    let crowd = ''
    for (const d of prep) {
      if (d.city && ck && d.city !== ck) continue
      if (!d.bbox) continue
      if (lng < d.bbox[0] || lng > d.bbox[2] || lat < d.bbox[1] || lat > d.bbox[3]) continue
      if (pointInFeature([lng, lat], d.geometry)) {
        district = d.name
        districtLevel = d.level
        crowd = d.crowd
        break
      }
    }

    lights.push({
      ...base,
      status: STATUS.EVALUATED,
      nearestM,
      nearestName: e?.nearestStore?.name || '',
      selfBucket,
      dualFormat,
      peers800,
      compRing,
      compStatus,
      // 🔴 「部分未评」：几何评了、竞争没评。渲染绿灯时必须带上这句，
      //   否则客户会把这盏绿灯读成「竞争也查过了、没问题」。
      partial: compStatus !== COMP_STATUS.EVALUATED,
      riskScore: score,
      riskLevel: level,
      flags,
      district,
      districtLevel,
      crowd,
      districtCovered: !!district
    })
  }

  // 高 → 低；同分时最近同品牌越近越靠前；再同则按名字
  lights.sort((a, b) => {
    const ra = a.riskScore == null ? -1 : a.riskScore
    const rb = b.riskScore == null ? -1 : b.riskScore
    if (rb !== ra) return rb - ra
    const na = a.nearestM == null ? 1e9 : a.nearestM
    const nb = b.nearestM == null ? 1e9 : b.nearestM
    if (na !== nb) return na - nb
    return String(a.name).localeCompare(String(b.name), 'zh')
  })

  const storeById = new Map(list.map(s => [String(s.id), s]))
  const clusters = findClusters(idx.pairs, storeById)

  const evaluated = byLevel.high + byLevel.mid + byLevel.low + byLevel.none

  return {
    total: list.length,
    evaluated,
    noCoord: list.length - evaluated,
    // 兼容旧调用方：这两个概念已经没有「灰灯」含义，恒 0，别再拿来当「无法评估」
    blind: 0,
    noCityData: 0,
    byLevel,
    rules: {
      // 自我蚕食
      cannibal: cannibalHit,
      selfDetail,
      clusters,
      // 竞争密度
      competition: compStat.hit,
      competitionEvaluated: compStat.evaluated,
      competitionNoData: compStat.noData,
      competitionNoCity: compStat.noCity,
      // 已评估但竞争维度没评的家数（绿灯文案必须带出来，⛔ 别让人读成「全都查过了」）
      competitionPartial: partialCount,
      // 旧字段（导出模板还在用），语义已改为「未评竞争的家数」
      cannibalDistricts: clusters.length,
      cannibalTop: clusters.map(c => ({ district: c.names[0], count: c.count })),
      crowd: 0
    },
    crowdBaseline: [],
    thresholds: {
      sameAddrM: SAME_ADDR_M,
      closeM: CLOSE_M,
      overlapM: OVERLAP_M,
      compRadiusM,
      compMid,
      compHigh,
      riskHigh,
      riskMid,
      // 旧字段：导出/前端还在读，值已无意义
      competitionMax: null,
      crowdShareMin: null
    },
    districtCount: dists.length,
    competitorPoints: comps.length,
    lights
  }
}
