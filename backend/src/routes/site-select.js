/**
 * 智能选址（site-select）—— 点位自动推荐 + 评分排序（v1.13.370 / 批次 370）
 *
 * ── 这个功能在做什么（一句话）──────────────────────────────────────────
 * 全站其他分析都是「你给一个点，系统评估它」；本功能是「你给一块地，系统把它切成
 * 几百个候选点、逐个打分、去重后给你 TOP N」。所以它不是新的撒点引擎 ——
 * 老的 `POST /api/shapefiles/calculate-potential`（开店余地分析）已经会筛，
 * 本功能只补「打分 + 排序 + 理由 + 一键落库」这一层。
 *
 * ── 四阶段流水线（立项稿 §4.4，顺序不可颠倒）───────────────────────────
 *   阶段 0  候选生成（免费 · 纯几何）：bbox → 网格中心点
 *   阶段 1  四维粗排（免费 · 零外部调用）
 *           ① 客群粗分：本地 1km 网格「常住人口」圆内面积加权 → 框内相对分位
 *           ② 竞品计数  ③ 自牌近邻  ④ 商圈归属
 *           → 🔴 饱和剔除（必须在查联通之前）
 *           → 排序 → 预去重 NMS（步长 500m 时必做，否则 4 倍钱买 1 份信息）
 *           → 取 TOP preciseTopK
 *   阶段 2  联通精算（付费 · 1 点 1 次配额 · 串行）
 *           🔴 客群**替换**粗分，⛔ 不平均、不叠加
 *   阶段 3  合成 → 二次 NMS（真实总分）→ TOP N
 *
 * ── 三条最容易写错的地方（每条都有守卫测试）────────────────────────────
 *   ① **饱和剔除必须在联通调用之前**：顺序反了就是"对注定出局的点花钱买人口数据"。
 *   ② **粗分绝不外泄**：初筛分是「框选内相对名次」，精算分是「绝对好坏」，不可比。
 *      透出 `roughScore` 会让用户看到"初筛第 1、最终第 8"，无法解释。
 *   ③ **未评 ≠ 0 分 ≠ 满分**：缺维度不进分母，`missingDims` 如实回传。
 *
 * ── 与 quotaGate 的关系（管理员场景的坑）──────────────────────────────
 *   `checkQuota` 对 `role === 'admin'` **直接放行**，只校验物理池 ⇒ 本功能只有管理员能用时，
 *   「账号额度」那道闸门根本不存在，点一下就是烧 `admin_quota.remaining_quota`。
 *   ⇒ 本文件在起跑前自己 `getPoolRemaining()` 前置校验（预估 × 1.2 冗余），
 *     并强制 `preciseTopK` 服务端 clamp，⛔ 不信前端传值。
 */

import express from 'express'
import * as turf from '@turf/turf'
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { attachGeo } from '../models/geoStore.js'
import { fetchPointPopulation } from './smartsteps.js'
// 🔴 复用判据从零依赖工具文件取，⛔ 不从 smartsteps.js 取：
//    测试会把 smartsteps 整模块 mock 掉，从那里命名导入会变成 undefined ⇒ B 逻辑静默失效。
import { REUSE_TOL_M, radiusIncludes } from '../utils/reuseKey.js'
import { getPoolRemaining } from '../utils/quotaPool.js'
import { readableUserIds } from '../utils/visibleScope.js'
import { resolveCompBrands, competitorWhere, isAllBrandsToken } from '../utils/competitorScope.js'
import { IN_BUSINESS_SQL, IN_BUSINESS_PARAMS } from '../utils/storeStatus.js'
import { normalizeDistrictProps } from '../utils/districtProps.js'
import { computeScore, competitionScore } from '../utils/districtScore.js'
import { normalizeBrand } from '../utils/storeDedup.js'
import {
  loadGridIndex, listGridCities, circlePopulation, percentileThresholds, percentileScore, median
} from '../utils/gridPopulation.js'
import {
  enumerateGrid, bboxAreaKm2, isBboxValid, buildPointIndex, planarMeters,
  countWithin, nearestDistance, sameBrandEffectiveCount, nms
} from '../utils/potentialGrid.js'
import {
  siteCrowdScore, visitScore, arpuHighPct, combineCrowd, cannibalScore, scoreSite, buildReason
} from '../utils/siteScore.js'
import {
  SITE_WEIGHTS, SITE_STEP_CHOICES, SITE_RADIUS_CHOICES, MAX_BBOX_AREA_KM2, MAX_GRIDS,
  PRECISE_TOPK, MIN_GAP, TOP_N, SATURATION_DEFAULT, SATURATION_RANGE,
  REGION_MEDIAN_FLOOR, P0_ACCESS_ENABLED, SITE_BURN_CONFIRM
} from '../utils/siteSelectConfig.js'

const router = express.Router()

/** 自有门店「最近距离」的搜索窗（米）—— 窗外一律视为独立（与体检 capM 同思路） */
const OWN_SEARCH_CAP_M = 20000
/** 2km 内自有门店数（响应字段 ownWithin2km 用；与饱和默认半径同值，仅作展示） */
const OWN_2KM_M = 2000

const clampInt = (v, dflt, min, max) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 饱和参数归一（缺省 = 开启 + 2000m + ≥2 家） */
function normalizeSaturation(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const radiusM = clampInt(src.radiusM, SATURATION_DEFAULT.radiusM, SATURATION_RANGE.radiusM[0], SATURATION_RANGE.radiusM[1])
  const maxOwn = clampInt(src.maxOwn, SATURATION_DEFAULT.maxOwn, SATURATION_RANGE.maxOwn[0], SATURATION_RANGE.maxOwn[1])
  return {
    enabled: src.enabled === undefined ? SATURATION_DEFAULT.enabled : !!src.enabled,
    radiusM,
    maxOwn
  }
}

/**
 * 参数解析与校验（estimate 与 rank 共用 —— 同一个请求体形状，同一套错误码）。
 * @returns {{ok:boolean, code?:string, errors?:Array, params?:object}}
 */
function parseParams(body) {
  const src = body && typeof body === 'object' ? body : {}
  const errors = []

  const bbox = Array.isArray(src.bbox) ? src.bbox.map(Number) : null
  if (!isBboxValid(bbox)) {
    errors.push({ field: 'bbox', message: '框选范围无效：需要 [西经, 南纬, 东经, 北纬]，且在中国境内' })
  } else {
    const area = bboxAreaKm2(bbox)
    if (area > MAX_BBOX_AREA_KM2) {
      errors.push({ field: 'bbox', message: `框选面积约 ${Math.round(area)} km²，超过上限 ${MAX_BBOX_AREA_KM2} km²，请缩小范围或放大步长` })
    }
  }

  const stepM = Number(src.stepM)
  if (!SITE_STEP_CHOICES.includes(stepM)) {
    errors.push({ field: 'stepM', message: '步长只支持 500 / 1000 / 2000 米' })
  }

  const radius = Number(src.radius)
  if (!SITE_RADIUS_CHOICES.includes(radius)) {
    errors.push({ field: 'radius', message: '评估半径只支持 500 / 1000 / 1500 / 3000 米' })
  }

  const cityMonth = String(src.cityMonth || '').trim()
  if (cityMonth && !/^\d{6}$/.test(cityMonth)) {
    errors.push({ field: 'cityMonth', message: '账期格式应为 YYYYMM（如 202609）' })
  }

  // 枚举格数护栏（与面积上限双保险：面积没超但步长太小同样会爆）
  if (!errors.some((e) => e.field === 'bbox' || e.field === 'stepM')) {
    const probe = enumerateGrid(bbox, stepM)
    if (probe.points.length > MAX_GRIDS) {
      errors.push({
        field: 'stepM',
        message: `将枚举 ${probe.points.length} 个候选点，超过上限 ${MAX_GRIDS}，请放大步长或缩小范围`
      })
    }
  }

  if (errors.length) {
    return { ok: false, code: 'bad_params', errors }
  }

  // 🔴 高消耗确认值（只在 rank 用；estimate 不回传它，改为回传 burnRequired/burnCount）。
  //    ⛔ 不接受「随便给个真值」—— 漏传 / 传字符串 / 传 0 一律归一成 null。
  const burnRaw = Number(src.confirmBurn)

  return {
    ok: true,
    params: {
      bbox,
      stepM,
      radius,
      city: String(src.city || '').trim(),
      myBrand: String(src.myBrand || '').trim(),
      cityMonth,
      topN: clampInt(src.topN, TOP_N.default, TOP_N.min, TOP_N.max),
      preciseTopK: clampInt(src.preciseTopK, PRECISE_TOPK.default, PRECISE_TOPK.min, PRECISE_TOPK.max),
      minGapM: clampInt(src.minGapM, MIN_GAP.default, MIN_GAP.min, MIN_GAP.max),
      saturation: normalizeSaturation(src.saturation),
      confirmBurn: Number.isFinite(burnRaw) && burnRaw > 0 ? Math.round(burnRaw) : null
    }
  }
}

/**
 * 加载商圈面（category='other'，按城市名匹配）。
 * 属性一律经 `normalizeDistrictProps` 归一 —— 商圈面有两代产物（2022 年度版 / 联通人口版），
 * 字段名不同；不归一会让 `computeScore` 拿到 undefined ⇒ 人口项恒 22 分且不报错。
 * @returns {Array<{name:string, props:object, feature:object, bbox:number[]}>}
 */
function loadDistrictPieces(db, city) {
  const key = String(city || '').trim().replace(/市$/, '')
  if (!key) return []
  let rows = []
  try {
    rows = db.prepare(`SELECT id, name, field_names FROM shapefiles WHERE category = 'other' AND name LIKE ?`).all(`%${key}%`)
  } catch {
    return []
  }
  const out = []
  for (const row of rows) {
    const withGeo = { ...row }
    try { attachGeo(withGeo) } catch { continue }
    let geo = withGeo.geojson
    if (typeof geo === 'string') {
      try { geo = JSON.parse(geo) } catch { geo = null }
    }
    for (const f of geo?.features || []) {
      const geom = f?.geometry
      if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue
      const props = normalizeDistrictProps(f.properties || {})
      let box
      try { box = turf.bbox(turf.feature(geom)) } catch { continue }
      out.push({
        name: String(props['名称'] || props['商圈名'] || '').trim(),
        props,
        feature: turf.feature(geom),
        bbox: box
      })
    }
  }
  return out
}

/** 点是否落在商圈面内（先 bbox 粗筛，再做 PIP） */
function findDistrict(pieces, lng, lat) {
  for (const p of pieces) {
    const [w, s, e, n] = p.bbox
    if (lng < w || lng > e || lat < s || lat > n) continue
    try {
      if (turf.booleanPointInPolygon(turf.point([lng, lat]), p.feature)) return p
    } catch { /* 几何异常跳过该面 */ }
  }
  return null
}

/** 框选内有效格（常住人口 > 0）的单格人口中位数 */
function medianInBbox(cells, bbox) {
  const [w, s, e, n] = bbox
  const vals = []
  for (const c of cells) {
    if (c.lng < w || c.lng > e || c.lat < s || c.lat > n) continue
    if (Number.isFinite(c.pop) && c.pop > 0) vals.push(c.pop)
  }
  return median(vals)
}

/**
 * 阶段 0 + 1：候选生成与四维粗排（**零外部调用、零配额消耗**）。
 *
 * 🔴 分位基准必须在**饱和剔除前、预去重前的全量候选点**上算（立项稿 §8 铁律 17）：
 *    在缩小后的集合上算会让分位漂移 —— 同一片地两次框选（一次开饱和、一次没开）
 *    会得到不同的分，用户必然质疑。
 */
/**
 * B（批次 373，业主 2026-11-17 要求）：「框内已经花过钱的点」并入候选集。
 *
 * ── 为什么需要（这是纯省钱，没有任何算法上的新东西）────────────────────
 * 业主问的原话：「我地图上勾画了徐家汇范围，这个范围内我已经买过 2 个位置的联通人口数据」。
 * 事实是旧逻辑下**复用不了**：取数复用的判据是「同坐标 10m 内 + 同半径」
 * （`smartsteps.js` 取数优先级 ①），而那 2 个点是报告/单点买的，坐标与撒点格心
 * 通常差几百米 ⇒ 花过的钱一分都吃不到，本次仍然全额重扣。
 *
 * 本函数把那 2 个点**直接塞进候选集**，让它们走同一套粗排→精算：
 *   · 若进了 TOP preciseTopK ⇒ 精算时坐标完全相同 ⇒ 必定命中 `purchases` ⇒ **0 消耗**；
 *   · 若分数不够没进榜 ⇒ 不精算、也不花钱（⛔ 不因为「付过费」就强行上榜，
 *     那会把排名可信度做废 —— 付过钱只说明当初看好，不代表今天分数高）。
 *
 * ── 三条硬约束（每条都有守卫）────────────────────────────────────────
 * ① **只取本账号**：`user_id = ?`。跨账号取＝踩数据隐私红线（同 §7.2.2 拍板 A 口径）。
 * ② **半径必须匹配**（`radiusIncludes`）：半径是缓存 key 的一部分，不匹配就必然重扣，
 *    并进来只会让用户误以为「这个点免费」，实际精算时照样扣 1 次。
 * ③ **与格心 10m 内重合则去重**：同一个物理位置不能出两个候选（否则 NMS 前就重复计数，
 *    用户会看到「推荐列表里两个几乎相同的点」）。重合时把该格心标记为 `purchase` 来源。
 *
 * @returns {{points:Array<{lng:number,lat:number,src:'grid'|'purchase'}>, purchasedInBox:number}}
 */
function mergePurchasedPoints(db, userId, radius, bbox, gridPoints) {
  const empty = { points: gridPoints.map((pt) => ({ ...pt, src: 'grid' })), purchasedInBox: 0 }
  let rows = []
  try {
    // ⚠️ `%"1001"%` 而不是 `%1001%`：只要含 1001 服务的已购数据，
    //    否则并进来一个「只有商圈面、没有人口」的点，精算时仍会扣费。
    rows = db.prepare(
      `SELECT center_lng, center_lat, radius FROM purchases
        WHERE user_id = ? AND status = 'active'
          AND result_data LIKE '%"1001"%'
          AND center_lng BETWEEN ? AND ? AND center_lat BETWEEN ? AND ?
        LIMIT 500`
    ).all(userId, bbox[0], bbox[2], bbox[1], bbox[3])
  } catch {
    return empty   // 表不存在/字段缺失 ⇒ 退化成「不含已购点」，⛔ 不能让选址整单失败
  }

  const out = empty.points
  let purchasedInBox = 0
  for (const row of rows) {
    if (!radiusIncludes(row.radius, radius)) continue
    const lng = Number(row.center_lng)
    const lat = Number(row.center_lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    purchasedInBox++
    let merged = false
    for (const pt of out) {
      if (pt.src === 'purchase') continue
      if (planarMeters(pt.lng, pt.lat, lng, lat) <= REUSE_TOL_M) {
        pt.src = 'purchase'    // 已有格心就在这个点上 ⇒ 只改来源标记，不新增候选
        merged = true
        break
      }
    }
    if (!merged) out.push({ lng, lat, src: 'purchase' })
  }
  return { points: out, purchasedInBox }
}

/**
 * 粗排：bbox → 候选点 → 四维打分 → 饱和剔除 → NMS → TOP preciseTopK。
 * 🔴 全程零外部调用；`fetchPointPopulation` 只在阶段 2（rank）里出现。
 */
function runCoarse(db, user, p) {
  const warnings = []
  const { points: gridPoints } = enumerateGrid(p.bbox, p.stepM)
  // 候选集 = 网格格心 + 框内已购点（批次 373）。`gridTotal` 仍只算格心，
  // ⛔ 不能把已购点算进去 —— 那个数字是给用户看「铺了多少点」，混进已购点会虚高。
  const { points, purchasedInBox } = mergePurchasedPoints(db, user.id, p.radius, p.bbox, gridPoints)
  const gridTotal = gridPoints.length
  if (purchasedInBox > 0) {
    const freePoints = points.filter((x) => x.src === 'purchase').length
    warnings.push(`框内命中 ${purchasedInBox} 个已购人口点，将作为候选参与排名（精算时不消耗配额）${freePoints < purchasedInBox ? `，其中 ${purchasedInBox - freePoints} 个与网格点重合已合并` : ''}`)
  }

  // ── 本地网格（初筛客群）────────────────────────────────────────────
  const grid = loadGridIndex(db, user, p.city)
  const gridCovered = grid.covered
  let regionMedianPop = null
  let thresholds = null
  if (gridCovered) {
    regionMedianPop = medianInBbox(grid.index.cells, p.bbox)
  }

  // ── 门店与竞品（各建一次索引）──────────────────────────────────────
  const ownAll = db.prepare(
    `SELECT id, name, brand, store_code, store_area, latitude, longitude, store_status
       FROM markers WHERE user_id = ? AND merged_into IS NULL ${IN_BUSINESS_SQL}`
  ).all(user.id, ...IN_BUSINESS_PARAMS)

  const hasBrand = !!p.myBrand && !isAllBrandsToken(p.myBrand)
  const brandKey = hasBrand ? normalizeBrand(p.myBrand) : ''
  // 饱和保护与 E 维度都按「同品牌」判；没有指定品牌时退化：
  //   · 饱和保护 **跳过**（"饱和"是品牌概念，拿全品牌判会把别的品牌店算成本品牌饱和）
  //   · E 维度用全部自有门店（保守：离任何自有店都远才好），文案改称「自有门店」
  const ownForSat = hasBrand ? ownAll.filter((s) => normalizeBrand(s.brand) === brandKey) : ownAll
  const ownForE = ownForSat
  const ownLabel = hasBrand ? '同品牌' : '自有门店'

  // 🔴 空门店集必须如实说，⛔ 不能回 `saturatedDropped: 0` 让人以为「查过了、没有饱和」。
  //    2026-11-17 生产实测：唯一可用的管理员账号（user_id=1）名下 **0 家门店**，
  //    而「食其家」在上海有 390 家 —— 那些门店属于别的账号。
  //    按本账号取门店是本功能既有口径（数据隐私：⛔ 不做跨账号聚合），但**结果必须写明白**，
  //    否则饱和保护与「自牌蚕食」维度会「静默不生效」：能跑通、不报错、只是这两个维度白算。
  if (!ownAll.length) {
    warnings.push('本账号名下没有门店数据：饱和保护与「自牌蚕食」维度都不生效，排名只由客群/竞品/商圈决定')
  } else if (hasBrand && !ownForSat.length) {
    warnings.push(`本账号名下没有「${p.myBrand}」的门店：饱和保护已跳过，自牌维度按「无自有门店」处理`)
  }

  const scopeIds = readableUserIds(db, user.id)
  const { sql: compBrandSql, params: compBrandParams } = competitorWhere(resolveCompBrands(db, user.id, p.myBrand))
  const comps = scopeIds.length
    ? db.prepare(
      `SELECT id, brand, latitude, longitude FROM competitors
        WHERE user_id IN (${scopeIds.map(() => '?').join(',')})${compBrandSql}
          AND (status IS NULL OR status NOT IN ('店铺已关', '尚未营业'))`
    ).all(...scopeIds, ...compBrandParams)
    : []

  const compIndex = buildPointIndex(comps)
  const ownIndex = buildPointIndex(ownForE)
  const satIndex = buildPointIndex(ownForSat)
  const districts = loadDistrictPieces(db, p.city)

  // ── 每点：圆内网格人口 → 竞品 → 商圈 → 自有最近距离 ────────────────
  const coarse = []
  for (const pt of points) {
    const circlePop = gridCovered ? circlePopulation(grid.index, pt.lng, pt.lat, p.radius).pop : null
    const comp = countWithin(compIndex, pt.lng, pt.lat, p.radius)
    const dist = districts.length ? findDistrict(districts, pt.lng, pt.lat) : null

    let districtScoreVal = null
    let districtName = ''
    if (dist) {
      districtName = dist.name
      // C 用商圈综合分（内含 40% 人口 + 25% 消费，来自**商圈购买时**的联通人口）。
      // compCount 用本点圆内竞品数 —— 比"整个商圈"更贴近该点位，且零额外开销。
      try { districtScoreVal = computeScore(dist.props, comp.count, 0).score } catch { districtScoreVal = null }
    }

    const nearestOwnM = ownForE.length
      ? nearestDistance(ownIndex, pt.lng, pt.lat, OWN_SEARCH_CAP_M)
      : null
    // 饱和判据只在「指定了品牌 + 开关打开」时生效；2km 内家数（展示用）单独算 ——
    // ⚠️ 不能拿 satCount 冒充 ownWithin2km：用户可把 satRadiusM 改成 1500，
    //    那时 satCount 是 1.5km 内的家数，塞进「2km 内 N 家」就是撒谎。
    const satCount = hasBrand ? sameBrandEffectiveCount(satIndex, pt.lng, pt.lat, p.saturation.radiusM) : null
    const ownWithin2km = ownForE.length
      ? sameBrandEffectiveCount(satIndex, pt.lng, pt.lat, OWN_2KM_M)
      : 0

    coarse.push({
      center: [pt.lng, pt.lat],
      // 批次 373：该候选来自「框内已购点」⇒ 精算时必定命中 purchases（0 消耗）。
      // ⚠️ 只作内部标记，⛔ 不进粗分、⛔ 不影响排序（付过钱不等于今天分数高）。
      fromPurchase: pt.src === 'purchase',
      circlePop,
      comp,
      district: dist ? { name: districtName, score: districtScoreVal } : null,
      nearestOwnM,
      satCount,
      ownWithin2km,
      saturated: false
    })
  }

  // ── 相对分位（基准 = 全部候选点）────────────────────────────────────
  let crowdSource = 'none'
  if (gridCovered) {
    const pops = coarse.map((c) => c.circlePop).filter((v) => Number.isFinite(v))
    thresholds = percentileThresholds(pops)
    if (thresholds && Number.isFinite(thresholds.p50)) {
      crowdSource = 'grid'
      for (const c of coarse) c.crowdGrid = percentileScore(c.circlePop, thresholds)
    } else {
      warnings.push('本地网格在该范围内无有效人口格，初筛按 3 个维度进行')
    }
    if (Number.isFinite(regionMedianPop) && regionMedianPop < REGION_MEDIAN_FLOOR) {
      warnings.push('该区域人口密度偏低，建议扩大范围或更换区域')
    }
  } else {
    if (p.city) {
      warnings.push('本城市暂无本地 1km 网格数据，初筛按 3 个维度进行；最终评分仍使用联通人口')
    } else {
      warnings.push('未指定城市，无法使用本地网格初筛；最终评分仍使用联通人口')
    }
  }

  // ── 粗分 → 饱和剔除 → 排序 ────────────────────────────────────────
  let saturatedDropped = 0
  const saturatedSamples = []
  const survivors = []

  for (const c of coarse) {
    const dims = {
      crowd: Number.isFinite(c.crowdGrid) ? c.crowdGrid : null,
      competition: Number.isFinite(c.comp.count) ? computeCompetition(c.comp.count) : null,
      district: c.district && Number.isFinite(c.district.score) ? c.district.score : null,
      access: null,   // P0 不接 D 维度（见 siteSelectConfig.P0_ACCESS_ENABLED）
      cannibal: cannibalScore(c.nearestOwnM)
    }
    const { score } = scoreSite(dims, SITE_WEIGHTS)
    c.roughScore = Number.isFinite(score) ? score : 0
    // NMS 只认 `score` 字段；这里是**粗排分**，只用于内部排序与预去重。
    // 🔴 铁律 19：这个值⛔ 不进响应、⛔ 不进界面（初筛第 1、最终第 8 无法向用户解释）。
    c.score = c.roughScore

    if (hasBrand && p.saturation.enabled && Number.isFinite(c.satCount) && c.satCount >= p.saturation.maxOwn) {
      c.saturated = true
      saturatedDropped++
      if (saturatedSamples.length < 3) {
        saturatedSamples.push({
          center: c.center.map((x) => Math.round(x * 1e6) / 1e6),
          ownWithinR: c.satCount,
          radiusM: p.saturation.radiusM
        })
      }
      continue
    }
    survivors.push(c)
  }

  if (!hasBrand && p.saturation.enabled) {
    warnings.push('未指定自有品牌，饱和保护已跳过（饱和按品牌判定）')
  }

  // 排序 + 预去重（步长 500m 时相邻 4 格是同一片人，不预去重＝4 倍钱买 1 份信息）
  const ranked = nms(survivors, p.minGapM)
  const preciseList = ranked.slice(0, p.preciseTopK)

  // ── B 的最后一公里：已购点必须真的进入精算 ──────────────────────────
  // 🔴 不补这一段，B 就是白做。原因：格距 1000m 而 `minGapM` 默认 800m，
  //    框内**任何非格心点**离最近格心都 ≤ 707m（半对角线）⇒ 必定被上面的 NMS 剔掉。
  //    而「报告里单点买的点」坐标是门店地址，几乎不会正好落在格心上。
  //    于是：钱花过了、候选也并进来了，最后一秒被去重丢掉 —— 用户什么都得不到。
  //
  // 口径：已购点**必定获得一次评估**（它们不消耗配额），但：
  //   ① 追加数量上限 = ⌈preciseTopK / 2⌉ —— ⛔ 不能让「买过的点」把 TOP 名额全占满，
  //      那会把这个功能从「发现新点位」变成「复读你买过的点」；
  //   ② 已购点之间也要过一遍 NMS —— 用户可能在同一片买了相邻的 3 个点，
  //      三个都评估就是 3 条几乎一样的推荐；
  //   ③ 追加点放在列表**末尾**（不插队）：排序仍是分数说了算，
  //      「付过费」只在「是否评估」上生效，⛔ 不在「排名先后」上生效。
  const purchasedSurvivors = survivors.filter((c) => c.fromPurchase)
  if (purchasedSurvivors.length) {
    const extraCap = Math.max(1, Math.ceil(p.preciseTopK / 2))
    let extraAdded = 0
    for (const c of nms(purchasedSurvivors, p.minGapM)) {
      if (extraAdded >= extraCap) break
      if (preciseList.includes(c)) continue
      preciseList.push(c)
      extraAdded++
    }
  }

  return {
    gridTotal,
    gridCovered,
    purchasedInBox,
    crowdSource,
    regionMedianPop,
    thresholds,
    saturatedDropped,
    saturatedSamples,
    survivorsTotal: survivors.length,
    preciseList,
    warnings,
    ownLabel,
    hasBrand
  }
}

/** B 维度：竞品宽松度（沿用 districtScore.competitionScore 的阈值，自有门店数传 0 —— 自有另由 E 计） */
function computeCompetition(compCount) {
  // 直接引用既有阈值实现，⛔ 不在这里重写一套数字
  // （competitionScore 的第二参数是"我的门店数"，传 0 表示不含自有 —— E 维度单独算）
  return competitionScore(compCount, 0)
}

/**
 * 只读探测「该点是否已有可复用人口数据」—— 用于 estimate 的 `cacheHitGuess`。
 * ⚠️ 只查 purchases / smartsteps_cache，**不调用联通、不扣配额**。
 *    与 `fetchPointPopulation` 的 ①② 同口径；实际消耗以 fetchPointPopulation 为准
 *    （它会在真正取数时再做一次判定，可能因期间新增数据而更省）。
 */
function probeReusable(db, user, lng, lat, radius) {
  try {
    const box = 0.0003
    const rows = db.prepare(
      `SELECT radius, center_lng, center_lat, result_data FROM purchases
        WHERE user_id = ? AND status = 'active' AND result_data IS NOT NULL
          AND center_lat BETWEEN ? AND ? AND center_lng BETWEEN ? AND ? LIMIT 200`
    ).all(user.id, lat - box, lat + box, lng - box, lng + box)
    for (const row of rows) {
      let r = row.radius
      if (typeof r === 'string') { try { r = JSON.parse(r) } catch { r = Number(row.radius) } }
      const hitRadius = Array.isArray(r) ? r.map(Number).includes(Number(radius)) : Number(r) === Number(radius)
      if (!hitRadius) continue
      const dLat = (Number(row.center_lat) - lat) * 111320
      const dLng = (Number(row.center_lng) - lng) * 111320 * Math.cos((lat * Math.PI) / 180)
      // ⛔ 不写 10：与 `mergePurchasedPoints` / `fetchPointPopulation` 共用同一个容差常量，
      //    否则「探测说能复用、真取数又说不能」⇒ 预估消耗与实际扣费对不上。
      if (Math.hypot(dLat, dLng) > REUSE_TOL_M) continue
      if (row.result_data) return 'purchase'
    }
  } catch { /* 探测失败按未命中处理 */ }

  try {
    const precision = 100000
    const lngKey = Math.round(lng * precision) / precision
    const latKey = Math.round(lat * precision) / precision
    const cached = db.prepare(
      `SELECT 1 AS ok FROM smartsteps_cache
        WHERE center_lng = ? AND center_lat = ? AND radius = ? AND services LIKE '%1001%' LIMIT 1`
    ).get(lngKey, latKey, radius)
    if (cached) return 'cache'
  } catch { /* 同上 */ }

  return null
}

/**
 * GET /api/site-select/cities —— 有本地 1km 网格的城市（供城市下拉与默认框选）
 *
 * 返回每城 bbox，前端据此给一个默认框（否则用户不可能手输经纬度四至）。
 * 只读、无外部调用、零配额。
 */
router.get('/cities', authenticate, requireAdmin, (req, res) => {
  try {
    const cities = listGridCities(getDb(), req.user)
    return res.json({ success: true, data: { cities } })
  } catch (e) {
    console.error('[site-select/cities]', e)
    return res.status(500).json({ success: false, code: 'internal', message: e.message })
  }
})

/**
 * GET /api/site-select/quota —— 本功能可用的**物理池**剩余次数
 *
 * 🔴 为什么不用 `GET /api/purchase/quota`：那个返回的是 `users.quota`（账号被分配的额度），
 *    而本功能只有管理员能用、`checkQuota` 对 admin 直接放行只校验物理池 ⇒
 *    管理员很可能「账号额度 0 次但池里有 1200 次」。拿账号额度当门禁会让按钮永久禁用。
 *    与 §9.2 的判据保持同一来源（getPoolRemaining）。
 */
router.get('/quota', authenticate, requireAdmin, (req, res) => {
  try {
    return res.json({ success: true, data: { remaining: getPoolRemaining(getDb()) } })
  } catch (e) {
    console.error('[site-select/quota]', e)
    return res.status(500).json({ success: false, code: 'internal', message: e.message })
  }
})

/**
 * POST /api/site-select/estimate —— 二次确认弹窗的数据来源（**只算不查，0 消耗**）
 *
 * 产品铁律：付费前必明「消耗 X / 剩余 Y」，且⛔ 文案不含单价、只报次数。
 */
router.post('/estimate', authenticate, requireAdmin, (req, res) => {
  try {
    const parsed = parseParams(req.body)
    if (!parsed.ok) return res.status(400).json({ success: false, code: parsed.code, errors: parsed.errors })
    const p = parsed.params
    const db = getDb()
    const user = req.user

    const coarse = runCoarse(db, user, p)

    // 只读探测可复用数据 → 更接近真实的消耗预估（⛔ 不宣称"一定命中"）
    let cacheHitGuess = 0
    for (const c of coarse.preciseList) {
      if (probeReusable(db, user, c.center[0], c.center[1], p.radius)) cacheHitGuess++
    }

    const preciseCount = coarse.preciseList.length
    const remaining = getPoolRemaining(db)
    const needFromPool = Math.max(0, preciseCount - cacheHitGuess)
    const warnings = [...coarse.warnings]
    if (preciseCount > 0) warnings.push('更换评估半径将重新消耗配额（已购数据按半径复用）')

    return res.json({
      success: true,
      data: {
        gridTotal: coarse.gridTotal,
        gridCovered: coarse.gridCovered,
        purchasedInBox: coarse.purchasedInBox,
        coarseCrowdSource: coarse.crowdSource,
        regionMedianPop: coarse.regionMedianPop,
        saturatedDropped: coarse.saturatedDropped,
        saturatedSamples: coarse.saturatedSamples,
        survivorsTotal: coarse.survivorsTotal,
        preciseCount,
        quotaEstimate: preciseCount,
        cacheHitGuess,
        // 🔴 高消耗熔断的**唯一真值来源**（前端 ⛔ 不要硬编码 30）：
        //    burnCount   = 本次真正会从池里扣几次（已扣掉可复用点）
        //    burnConfirm = 触发确认的阈值
        //    burnRequired= 是否需要用户亲手输入 burnCount
        burnCount: needFromPool,
        burnConfirm: SITE_BURN_CONFIRM,
        burnRequired: needFromPool > SITE_BURN_CONFIRM,
        remaining,
        belowTopN: coarse.survivorsTotal < p.topN,
        weights: SITE_WEIGHTS,
        warnings
      }
    })
  } catch (e) {
    console.error('[site-select/estimate]', e)
    return res.status(500).json({ success: false, code: 'internal', message: e.message })
  }
})

/**
 * POST /api/site-select/rank —— 四阶段流水线主端点
 */
router.post('/rank', authenticate, requireAdmin, async (req, res) => {
  try {
    const parsed = parseParams(req.body)
    if (!parsed.ok) return res.status(400).json({ success: false, code: parsed.code, errors: parsed.errors })
    const p = parsed.params
    const db = getDb()
    const user = req.user

    // ── 阶段 0 + 1（免费）──────────────────────────────────────────
    const coarse = runCoarse(db, user, p)
    const preciseList = coarse.preciseList

    if (!preciseList.length) {
      return res.json({
        success: true,
        data: {
          bbox: p.bbox,
          stepM: p.stepM,
          gridTotal: coarse.gridTotal,
          gridCovered: coarse.gridCovered,
          coarseCrowdSource: coarse.crowdSource,
          regionMedianPop: coarse.regionMedianPop,
          saturatedDropped: coarse.saturatedDropped,
          saturatedSamples: coarse.saturatedSamples,
          coarseTopK: 0,
          crowdDropped: 0,
          returned: 0,
          warnings: [...coarse.warnings, '该范围内没有可评估的点位，请扩大框选范围或放宽饱和门限'],
          quota: { estimate: 0, used: 0, fromCacheCount: 0, remaining: getPoolRemaining(db) },
          weights: SITE_WEIGHTS,
          coverage: {},
          missingDims: Object.keys(SITE_WEIGHTS),
          items: []
        }
      })
    }

    // ── 配额前置校验（🔴 管理员走 checkQuota 免账号额度 ⇒ 必须自己查物理池）──
    // ⚠️ 只对「真正要调上游的点」要求余额：命中已购/缓存的点不扣费，
    //    按全量 need 卡会把「30 个点里 25 个命中缓存」的可执行请求误拒。
    const need = preciseList.length
    let cacheHitGuess = 0
    for (const c of preciseList) {
      if (probeReusable(db, user, c.center[0], c.center[1], p.radius)) cacheHitGuess++
    }
    const needFromPool = Math.max(0, need - cacheHitGuess)
    const remainingBefore = getPoolRemaining(db)
    if (remainingBefore < needFromPool) {
      return res.status(400).json({
        success: false,
        code: 'pool_exhausted',
        message: `联通人口剩余 ${remainingBefore} 次，本次需 ${needFromPool} 次（${cacheHitGuess} 点可复用已购数据），请先采购或缩小范围（减少精算点数/框选范围）`,
        remaining: remainingBefore,
        need: needFromPool
      })
    }

    // ── 🔴🔴 高消耗熔断（业主 2026-11-17）──────────────────────────────
    // 放在余额校验**之后**：余额不足是更硬的问题，不该让用户先输一遍数字再被告知钱不够。
    //
    // 🔴 必须比对 `p.confirmBurn === needFromPool`，⛔ 不能只判「有值」：
    //    用户在弹窗里看到 40 并输了 40，但若这期间参数被改（或 estimate 与 rank 之间
    //    缓存被别的请求写入），实际 needFromPool 变成 45 —— 此时放行等于把确认做成装饰。
    //    不一致就再拒一次，让前端用新数字重弹。
    //
    // ⚠️ 本闸门只挡「单次大额」。改半径/换框选重跑 4 次 ×30 = 120 次挡不住，
    //    那是另一个问题（小样试跑 / 累计熔断），见立项稿 §13.3 待办。
    if (needFromPool > SITE_BURN_CONFIRM && p.confirmBurn !== needFromPool) {
      return res.status(400).json({
        success: false,
        code: 'burn_confirm_required',
        message: `本次将从联通人口池消耗 ${needFromPool} 次（超过默认精算点数 ${SITE_BURN_CONFIRM} 次），需二次确认`,
        need: needFromPool,
        remaining: remainingBefore,
        burnConfirm: SITE_BURN_CONFIRM,
        confirmBurn: needFromPool
      })
    }

    // ── 阶段 2：联通精算（串行 · 1 点 1 次 · 单点失败不重试）──────────
    const precise = []
    let quotaUsed = 0
    let fromCacheCount = 0
    let crowdDropped = 0
    let gateBlocked = null

    for (let i = 0; i < preciseList.length; i++) {
      const c = preciseList[i]
      const r = await fetchPointPopulation(db, user, {
        lng: c.center[0],
        lat: c.center[1],
        radius: p.radius,
        cityMonth: p.cityMonth,
        storeName: `选址评估-${i + 1}`,
        storeType: 'site-select'
      })

      if (!r.ok) {
        const code = r.body?.code || ''
        // 配额闸门 / 额度不足 ⇒ **整批中止**（⛔ 不允许"跳过该点继续跑"，
        // 那会输出一份"客群只剩几个点"的残缺排序，看起来像正常结果）
        if (code === 'pool_quota_exhausted' || code === 'own_quota_exhausted') {
          gateBlocked = { code, message: r.body?.message || '配额不足', status: r.status || 400 }
          break
        }
        // 单点失败（联通超时/无数据）⇒ 剔除该点，计入 crowdDropped
        crowdDropped++
        continue
      }

      const body = r.body || {}
      const pop = body.population
      if (body.source === 'fresh') quotaUsed += 1
      else fromCacheCount += 1

      const sizePop = (Number(pop?.live) || 0) + (Number(pop?.work) || 0)
      // 🔴 居住+工作都为 0 ⇒ 客群未评 ⇒ **剔除该点**（⛔ 不按 0 分算，那会把好点位排到最后）
      if (!(sizePop > 0)) { crowdDropped++; continue }

      const a1 = siteCrowdScore(sizePop)
      // A2 = 到访活跃（v1.13.371 起，业主 11-17 拍板 A 案）
      // ⚠️ pop.visit 可能是字符串（1001 返回 "9569"）或 0（真实无到访，⇒ 最低档）；
      //    visitScore 内部区分「0 = 有效值」与「null/缺字段 = 未评」，这里⛔ 不要再 `|| 0`。
      const a2 = visitScore(pop?.visit)
      // 话费占比从此只做展示参考，⛔ 不进分（旧口径，见 siteSelectConfig.ARPU_STEPS）
      const highPct = arpuHighPct(pop)
      c.precise = {
        live: Number(pop.live) || 0,
        work: Number(pop.work) || 0,
        visit: Number.isFinite(Number(pop?.visit)) && pop?.visit !== null && pop?.visit !== undefined
          ? Number(pop.visit) : null,
        arpuHighPct: highPct,
        a1,
        a2,
        crowd: combineCrowd(a1, a2),
        // purchase = 命中框内已购数据（0 消耗）/ cache = 同点同半径已查过 / fresh = 本次真扣
        dataSource: body.source || '',
        dataMonth: body.dataMonth || ''
      }
      precise.push(c)
    }

    if (gateBlocked) {
      return res.status(gateBlocked.status || 400).json({
        success: false,
        code: gateBlocked.code === 'own_quota_exhausted' ? 'own_quota_exhausted' : 'pool_exhausted',
        message: gateBlocked.message,
        quota: { estimate: need, used: quotaUsed, fromCacheCount, remaining: getPoolRemaining(db) }
      })
    }

    // 客群整批未评 ⇒ 整批拒绝（客群是核心维度，缺了排序无意义）
    if (!precise.length) {
      return res.status(400).json({
        success: false,
        code: 'city_not_covered',
        message: '联通未返回可用人口数据，无法生成推荐（本次未消耗配额或已按实际调用计费）',
        quota: { estimate: need, used: quotaUsed, fromCacheCount, remaining: getPoolRemaining(db) }
      })
    }

    // ── A2 到访分档自检（v1.13.371）──────────────────────────────────
    // 阈值用上海 hd 数据标定，且**假设**联通 p0_sum 同为月度到访。假设若不成立，
    // 全批会挤在同一档 —— 那等于 A2 白占 10 分权重，必须如实告知（⛔ 不能静默）。
    const visitScores = [...new Set(precise.map((c) => c.precise.a2).filter((v) => Number.isFinite(v)))]
    if (precise.length >= 5 && visitScores.length === 0) {
      coarse.warnings.push('联通未返回到访人次：本次客群仅按人口规模评分（到访活跃未评）')
    } else if (precise.length >= 5 && visitScores.length === 1) {
      coarse.warnings.push(
        `本次所有点的「到访活跃」得分相同（${visitScores[0]} 分）—— 分档阈值可能与联通实际量级不匹配，`
        + '排序主要由人口/竞品/商圈决定；阈值见 siteSelectConfig.SITE_VISIT_STEPS（待真实数据回测）'
      )
    }

    // ── 阶段 3：合成 → 二次 NMS（真实总分）→ TOP N ───────────────────
    const scored = precise.map((c) => {
      const dims = {
        crowd: Number.isFinite(c.precise.crowd) ? c.precise.crowd : null,
        competition: Number.isFinite(c.comp.count) ? computeCompetition(c.comp.count) : null,
        district: c.district && Number.isFinite(c.district.score) ? c.district.score : null,
        // P0 不接 D 维度（见 siteSelectConfig.P0_ACCESS_ENABLED）⇒ 恒未评 → 不进分母
        access: null,
        cannibal: cannibalScore(c.nearestOwnM)
      }
      const { score, coverage, missingDims } = scoreSite(dims, SITE_WEIGHTS)
      const month = p.cityMonth || c.precise.dataMonth || ''
      return {
        center: c.center,
        score: Number.isFinite(score) ? score : 0,
        dims,
        coverage,
        missingDims,
        crowdInfo: c.precise,
        comp: c.comp,
        district: c.district,
        nearestOwnM: c.nearestOwnM,
        ownWithin2km: c.ownWithin2km,
        // purchase/cache = 该点 0 消耗；前端据此打「已购数据」标签。
        // 🔴 这不是分数，可以透；⛔ 但 roughScore 仍然绝不外泄（铁律 19）。
        dataSource: c.precise.dataSource,
        radius: p.radius,
        cityMonth: month
      }
    })

    const finalList = nms(scored, p.minGapM, p.topN)

    const items = finalList.map((it, idx) => {
      const raw = {
        live: it.crowdInfo.live,
        work: it.crowdInfo.work,
        visit: it.crowdInfo.visit,
        arpuHighPct: it.crowdInfo.arpuHighPct,
        competitors: it.comp.count,
        competitorBrands: it.comp.byBrand,
        nearestOwnM: Number.isFinite(it.nearestOwnM) ? Math.round(it.nearestOwnM) : null,
        ownWithin2km: it.ownWithin2km,
        districtName: it.district?.name || ''
        // 🔴 铁律 19：这里⛔ 不放 roughScore / stage1Rank / 粗人口 —— 粗分是框选内相对名次，
        //    透出去必然引发"初筛第 1、最终第 8"的质疑。只给精算后的五维分与原始人口数。
      }
      return {
        rank: idx + 1,
        center: it.center.map((x) => Math.round(x * 1e6) / 1e6),
        radius: it.radius,
        score: it.score,
        dims: {
          crowd: Number.isFinite(it.dims.crowd) ? it.dims.crowd : null,
          competition: Number.isFinite(it.dims.competition) ? it.dims.competition : null,
          district: Number.isFinite(it.dims.district) ? it.dims.district : null,
          access: null,
          cannibal: Number.isFinite(it.dims.cannibal) ? it.dims.cannibal : null
        },
        raw,
        // 该点人口数据的来源：purchase（框内已购，0 消耗）/ cache（同点同半径查过）/ fresh（本次扣费）
        dataSource: it.dataSource || '',
        reason: buildReason(raw, {
          radius: it.radius,
          cityMonth: it.cityMonth,
          districtName: it.district?.name,
          districtScore: it.district?.score
        })
      }
    })

    // 覆盖状态：以最终列表为准（逐点可能不同，取"是否全部未评"给出整体口径）
    const coverage = {
      crowd: items.every((x) => x.dims.crowd !== null),
      competition: items.every((x) => x.dims.competition !== null),
      district: items.every((x) => x.dims.district !== null),
      access: P0_ACCESS_ENABLED,
      cannibal: items.every((x) => x.dims.cannibal !== null)
    }
    const missingDims = Object.keys(coverage).filter((k) => !coverage[k])

    return res.json({
      success: true,
      data: {
        bbox: p.bbox,
        stepM: p.stepM,
        gridTotal: coarse.gridTotal,
        gridCovered: coarse.gridCovered,
        purchasedInBox: coarse.purchasedInBox,
        coarseCrowdSource: coarse.crowdSource,
        regionMedianPop: coarse.regionMedianPop,
        saturatedDropped: coarse.saturatedDropped,
        saturatedSamples: coarse.saturatedSamples,
        coarseTopK: need,
        crowdDropped,
        returned: items.length,
        warnings: coarse.warnings,
        quota: {
          estimate: need,
          cacheHitGuess,
          used: quotaUsed,
          fromCacheCount,
          remaining: getPoolRemaining(db)
        },
        weights: SITE_WEIGHTS,
        coverage,
        missingDims,
        items
      }
    })
  } catch (e) {
    console.error('[site-select/rank]', e)
    return res.status(500).json({ success: false, code: 'internal', message: e.message })
  }
})

export default router
