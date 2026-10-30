/**
 * 门店体检 · 商圈信号灯（v1.13.297）
 *
 * 纯函数：不碰数据库、不碰网络，输入「我的门店」+「已打分的商圈面」，输出红黄绿灯。
 * 规则与阈值来自 `Report4biz_免费门店体检_规则与实测_20261028.md`（已用 youshi 233 家实测）。
 *
 * 四条规则（前三条参与打分，第四条单独成组）：
 *   ① 竞争密集  = 所在商圈竞争宽松度 ≤35（≈16 家以上同级竞品）      +3
 *   ② 自我蚕食  = 同一商圈内**本人**门店 2~3 家 → +2；≥4 家 → +3
 *   ③ 客群偏离  = 所在商圈客群在本品牌门店客群构成里占比 <20%        +2
 *   ④ 覆盖盲区  = 城市有商圈面，但门店不在任何面内 ⇒ **无法评估**，⛔ 不评分、不算低风险
 *
 * 🔴 三条不能动的口径：
 *   1. 盲区 ≠ 低风险。把「看不见」混进「没问题」是对客户撒谎，也浪费最好的付费引导点。
 *   2. 城市若根本没导入商圈面 ⇒ 归 `no_city_data`，**不算盲区** —— 那是我们的数据覆盖问题，
 *      不是客户的选址问题；混进盲区会变成「你有 2000 家店在盲区」的自证没用。
 *   3. 客群偏离必须**自适应品牌**（用客户自己已开的店反推客群构成）；否则会退化成「人人有罪」。
 *
 * ⚠️ 竞争宽松度用的是 `utils/districtScore.js::competitionScore`，与商圈洞察同一份代码；
 *    而「自我蚕食」数的是**本人**门店（本函数只拿得到本人的门店数组），两者口径不同是有意的：
 *    前者是「这条街有多挤」，后者是「你自己在这商圈开了几家」。
 */

import { pointInFeature, geometryBBox } from './geoPoint.js'
import { COMPETITION_DENSE_MAX } from './districtScore.js'

/** 客群占比低于此值 ⇒ 判「客群偏离」 */
export const CROWD_SHARE_MIN = 0.2
/** 风险分级阈值 */
export const RISK_HIGH = 6
export const RISK_MID = 3

/** 门店评估状态 */
export const STATUS = {
  EVALUATED: 'evaluated',       // 落在商圈面内，已评分
  BLIND: 'blind',               // 城市有商圈面，但门店不在任何面内 ⇒ 无法评估
  NO_CITY_DATA: 'no_city_data', // 该城市没有商圈面数据 ⇒ 不评估（不算盲区）
  NO_COORD: 'no_coord'          // 缺经纬度或 0,0 ⇒ 不参与
}

function cityKeyOf(city) {
  return String(city || '').replace(/市$/, '').trim()
}

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {object}   input
 * @param {Array}    input.stores     本人门店（含 id/name/brand/city/latitude/longitude）
 * @param {Array}    input.districts  已打分的商圈面：
 *                                    { name, city, level, crowd, geometry, scoreCompetition }
 * @param {object}  [input.opts]
 * @param {Set|Array} [input.opts.coveredCities] 有商圈面数据的城市（已去「市」）；
 *                                    不传则按 districts 里出现的城市推断
 */
export function buildStoreLights({ stores = [], districts = [], opts = {} } = {}) {
  const list = Array.isArray(stores) ? stores : []
  const dists = Array.isArray(districts) ? districts : []

  const covered = opts.coveredCities
    ? new Set(Array.from(opts.coveredCities).map(cityKeyOf))
    : new Set(dists.map(d => cityKeyOf(d.city)).filter(Boolean))

  // 预计算 bbox：面内判定先过 bbox，省掉绝大多数射线计算
  const prep = dists.map((d, idx) => ({
    idx,
    name: d.name || `商圈${idx + 1}`,
    city: cityKeyOf(d.city),
    level: d.level || '',
    crowd: d.crowd || '',
    geometry: d.geometry,
    scoreCompetition: toNum(d.scoreCompetition),
    bbox: geometryBBox(d.geometry)
  }))

  // ① 每店落圈（bbox 预筛 + 射线法；重叠时取第一个命中，与商圈列表顺序一致）
  const placed = new Map()     // storeIndex → prep idx
  const status = new Array(list.length)
  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    const lat = toNum(s.latitude ?? s.lat)
    const lng = toNum(s.longitude ?? s.lng)
    if (lat == null || lng == null || (lat === 0 && lng === 0)) {
      status[i] = STATUS.NO_COORD
      continue
    }
    const ck = cityKeyOf(s.city)
    if (ck && covered.size && !covered.has(ck)) {
      // 该城市没有商圈面 ⇒ 不评估（⛔ 不算盲区）
      status[i] = STATUS.NO_CITY_DATA
      continue
    }
    const pt = [lng, lat]
    let hit = -1
    for (const d of prep) {
      if (!d.bbox) continue
      if (lng < d.bbox[0] || lng > d.bbox[2] || lat < d.bbox[1] || lat > d.bbox[3]) continue
      if (pointInFeature(pt, d.geometry)) { hit = d.idx; break }
    }
    if (hit >= 0) {
      placed.set(i, hit)
      status[i] = STATUS.EVALUATED
    } else {
      status[i] = STATUS.BLIND
    }
  }

  // ② 每个商圈内有几家「本人门店」（自我蚕食用）
  const ownByDistrict = new Map()   // prep idx → count
  for (const idx of placed.values()) ownByDistrict.set(idx, (ownByDistrict.get(idx) || 0) + 1)

  // ③ 品牌客群基线：从自己已落圈的店反推，占比 <20% 的客群算「偏离」
  const crowdCount = new Map()
  for (const idx of placed.values()) {
    const c = prep[idx].crowd || ''
    if (!c) continue
    crowdCount.set(c, (crowdCount.get(c) || 0) + 1)
  }
  const crowdJudged = Array.from(crowdCount.values()).reduce((a, b) => a + b, 0)
  const crowdBaseline = Array.from(crowdCount.entries())
    .map(([crowd, n]) => ({
      crowd,
      n,
      share: crowdJudged ? n / crowdJudged : 0,
      deviation: crowdJudged ? n / crowdJudged < CROWD_SHARE_MIN : false
    }))
    .sort((a, b) => b.n - a.n)

  // ④ 逐店打分
  const lights = []
  const byLevel = { high: 0, mid: 0, low: 0, none: 0 }
  const rule = { competition: 0, cannibal: 0, crowd: 0 }
  const cannibalDistrictCount = new Map()   // 商圈名 → 家数（只统计 ≥2 家的）

  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    const base = {
      storeId: s.id,
      name: s.name || '',
      brand: s.brand || '',
      city: s.city || '',
      lat: toNum(s.latitude ?? s.lat),
      lng: toNum(s.longitude ?? s.lng),
      status: status[i]
    }

    if (status[i] !== STATUS.EVALUATED) {
      // ⛔ 不评分：不是 0 分，是「这一项没做」
      lights.push({ ...base, riskScore: null, riskLevel: null, flags: [], district: '' })
      continue
    }

    const d = prep[placed.get(i)]
    const own = ownByDistrict.get(d.idx) || 1
    const flags = []
    let score = 0

    if (d.scoreCompetition != null && d.scoreCompetition <= COMPETITION_DENSE_MAX) {
      flags.push('competition')
      score += 3
      rule.competition++
    }
    if (own >= 4) {
      flags.push('cannibal')
      score += 3
      rule.cannibal++
      cannibalDistrictCount.set(d.name, own)
    } else if (own >= 2) {
      flags.push('cannibal')
      score += 2
      rule.cannibal++
      cannibalDistrictCount.set(d.name, own)
    }
    const deviated = crowdBaseline.some(b => b.crowd === d.crowd && b.deviation)
    if (deviated) {
      flags.push('crowd')
      score += 2
      rule.crowd++
    }

    const level = score >= RISK_HIGH ? 'high' : score >= RISK_MID ? 'mid' : score > 0 ? 'low' : 'none'
    byLevel[level]++

    lights.push({
      ...base,
      district: d.name,
      districtLevel: d.level,
      crowd: d.crowd,
      competitionScore: d.scoreCompetition,
      ownInDistrict: own,
      riskScore: score,
      riskLevel: level,
      flags
    })
  }

  // 高 → 低；同分时竞争越挤越靠前
  lights.sort((a, b) => {
    const ra = a.riskScore == null ? -1 : a.riskScore
    const rb = b.riskScore == null ? -1 : b.riskScore
    if (rb !== ra) return rb - ra
    const ca = a.competitionScore == null ? 999 : a.competitionScore
    const cb = b.competitionScore == null ? 999 : b.competitionScore
    if (ca !== cb) return ca - cb
    return String(a.name).localeCompare(String(b.name), 'zh')
  })

  const countStatus = (st) => status.filter(x => x === st).length
  const cannibalTop = Array.from(cannibalDistrictCount.entries())
    .map(([district, count]) => ({ district, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    total: list.length,
    evaluated: byLevel.high + byLevel.mid + byLevel.low + byLevel.none,
    blind: countStatus(STATUS.BLIND),
    noCityData: countStatus(STATUS.NO_CITY_DATA),
    noCoord: countStatus(STATUS.NO_COORD),
    byLevel,
    rules: {
      competition: rule.competition,
      cannibal: rule.cannibal,
      cannibalDistricts: cannibalDistrictCount.size,
      cannibalTop,
      crowd: rule.crowd,
      blind: countStatus(STATUS.BLIND)
    },
    crowdBaseline,
    thresholds: {
      competitionMax: COMPETITION_DENSE_MAX,
      crowdShareMin: CROWD_SHARE_MIN,
      riskHigh: RISK_HIGH,
      riskMid: RISK_MID
    },
    districtCount: dists.length,
    coveredCities: Array.from(covered),
    lights
  }
}
