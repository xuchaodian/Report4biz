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
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { fetchPointPopulation } from './smartsteps.js'
// 🔴 复用判据从零依赖工具文件取，⛔ 不从 smartsteps.js 取：
//    测试会把 smartsteps 整模块 mock 掉，从那里命名导入会变成 undefined ⇒ B 逻辑静默失效。
import { REUSE_TOL_M, radiusIncludes, parseRadii } from '../utils/reuseKey.js'
// 🔴 `probeReusable` 的「可复用」判定必须与取数侧 `fetchPointPopulation` 完全同口径：
//    取数侧要求 `parsePopulation1001(result_data)` **解析成功**才算命中已购数据，
//    只判「result_data 非空」会把「只有商圈面、没有 1001」的记录也算成可复用 ⇒ 预估偏低。
//    该文件是纯解析器（零 import），不会把 DB / express 拖进来。
import { parsePopulation1001 } from '../utils/unicomPopulation.js'
import { getPoolRemaining } from '../utils/quotaPool.js'
import { isAllBrandsToken } from '../utils/competitorScope.js'
import { loadCompetitorIndex } from '../utils/competitorPoints.js'
import { IN_BUSINESS_SQL, IN_BUSINESS_PARAMS } from '../utils/storeStatus.js'
import { computeScore, competitionScore } from '../utils/districtScore.js'
import { loadDistrictPieces, findDistrict, medianInBbox } from '../utils/districtPieces.js'
import { normalizeBrand } from '../utils/storeDedup.js'
import {
  loadGridIndex, listGridCities, circlePopulation, percentileThresholds, percentileScore
} from '../utils/gridPopulation.js'
import {
  enumerateGrid, bboxAreaKm2, isBboxValid, buildPointIndex, planarMeters,
  countWithin, nearestDistance, sameBrandEffectiveCount, nms
} from '../utils/potentialGrid.js'
import {
  siteCrowdScore, visitScore, arpuHighPct, combineCrowd, cannibalScore, scoreSite, buildReason,
  buildCoarseReason
} from '../utils/siteScore.js'
import {
  SITE_WEIGHTS, SITE_STEP_CHOICES, SITE_RADIUS_CHOICES, MAX_BBOX_AREA_KM2, MAX_GRIDS,
  PRECISE_TOPK, MIN_GAP, TOP_N, SATURATION_DEFAULT, SATURATION_RANGE,
  REGION_MEDIAN_FLOOR, P0_ACCESS_ENABLED, SITE_BURN_CONFIRM,
  COARSE_ONLY_WEIGHTS, COARSE_ONLY_DENOMINATOR
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
 * ── ④ 半径不符的记录 ⛔ 不许「静默 continue」（批次 374）──────────────────
 * 这条不是约束而是**告知义务**。旧代码一句 `if (!radiusIncludes(...)) continue` 就把它们扔了：
 * 用户改个半径，钱全重扣，界面上却一个字都不提「你框里有 5 个点本来能复用」。
 * 所以这里必须**数出来**并交回 `mismatchRadii`（那些点买过哪些半径），
 * 由 `runCoarse` 出警告、由前端弹窗给出「改用 X 米可复用」的一键入口。
 *
 * ── ⑤ 「可复用」的判据必须与取数侧完全一致（批次 374）──────────────────
 * `purchasedInBox` 是要写进用户界面的（「这 N 个点不额外消耗配额」）。
 * 而「到底免不免费」由 `fetchPointPopulation` 决定，它的四关是：
 * SQL 粗筛矩形 → 半径匹配 → 10m 内 → `parsePopulation1001` 解析成功。
 * 这里**少任何一关都会虚高**：说免费、实际扣钱，是这功能最不能犯的错。
 *
 * @returns {{
 *   points:Array<{lng:number,lat:number,src:'grid'|'purchase'}>,
 *   purchasedInBox:number,      // 半径匹配 + 1001 可解析 ⇒ 真正可免费复用的点数
 *   radiusMismatch:number,      // 半径不符、无法复用的**记录条数**
 *   mismatchRadii:number[]      // 那些记录买过的半径（去重升序，可能是选址选不到的 5000）
 * }}
 */
function mergePurchasedPoints(db, userId, radius, bbox, gridPoints) {
  const empty = {
    points: gridPoints.map((pt) => ({ ...pt, src: 'grid' })),
    purchasedInBox: 0,
    radiusMismatch: 0,
    mismatchRadii: []
  }
  let rows = []
  try {
    // ⚠️ `%"1001"%` 而不是 `%1001%`：只要含 1001 服务的已购数据，
    //    否则并进来一个「只有商圈面、没有人口」的点，精算时仍会扣费。
    // 🔴 这只是**粗筛**（字符串匹配），真正的判据在下面循环里调 `parsePopulation1001`：
    //    取数侧 `fetchPointPopulation` 就是「SQL 粗筛矩形 + 半径 + 10m + parse 成功」四关，
    //    这里少一关，「N 个不额外消耗配额」就会虚高（含 `"1001":{}` 空壳的记录会混进来）。
    rows = db.prepare(
      `SELECT center_lng, center_lat, radius, result_data FROM purchases
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
  let radiusMismatch = 0
  const mismatchRadii = new Set()
  for (const row of rows) {
    const lng = Number(row.center_lng)
    const lat = Number(row.center_lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    if (!radiusIncludes(row.radius, radius)) {
      // 🔴 不只是 `continue`：这是「改半径重扣」的现场，必须记账。
      radiusMismatch++
      for (const r of parseRadii(row.radius)) mismatchRadii.add(r)
      continue
    }
    // 🔴 与取数侧同口径：1001 解析不出来 ⇒ 精算时照样要调联通扣费，
    //    所以⛔ 不能按「可复用」并进来（否则界面说免费、实际扣钱）。
    if (!parsePopulation1001(row.result_data)) continue
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
  return {
    points: out,
    purchasedInBox,
    radiusMismatch,
    mismatchRadii: [...mismatchRadii].sort((a, b) => a - b)
  }
}

/**
 * 粗排：bbox → 候选点 → 四维打分 → 饱和剔除 → NMS → TOP preciseTopK。
 * 🔴 全程零外部调用；`fetchPointPopulation` 只在阶段 2（rank）里出现。
 *
 * @param {'precise'|'coarse'} [mode] 只影响**警告文案**（口径不同），不影响任何计算。
 *   `'coarse'` ＝ 仅初筛模式：排名只由客群/竞品决定，⛔ 不能对用户说「最终评分仍使用联通人口」，
 *   因为那个模式根本不存在"最终评分"。
 */
function runCoarse(db, user, p, mode = 'precise') {
  const coarseOnly = mode === 'coarse'
  const warnings = []
  const { points: gridPoints } = enumerateGrid(p.bbox, p.stepM)
  // 候选集 = 网格格心 + 框内已购点（批次 373）。`gridTotal` 仍只算格心，
  // ⛔ 不能把已购点算进去 —— 那个数字是给用户看「铺了多少点」，混进已购点会虚高。
  const { points, purchasedInBox, radiusMismatch, mismatchRadii } =
    mergePurchasedPoints(db, user.id, p.radius, p.bbox, gridPoints)
  const gridTotal = gridPoints.length
  if (purchasedInBox > 0) {
    const freePoints = points.filter((x) => x.src === 'purchase').length
    warnings.push(`框内命中 ${purchasedInBox} 个已购人口点，将作为候选参与排名（精算时不消耗配额）${freePoints < purchasedInBox ? `，其中 ${purchasedInBox - freePoints} 个与网格点重合已合并` : ''}；更换评估半径后将不再复用`)
  }

  // ── ④ 半径不符：把「本来能省、但因为换了半径省不到」明说出来（批次 374）────
  // 🔴 两个必须说清的事实：
  //   ① `purchases.radius` 只可能是 `REPORT_RADII = [1000,3000,5000]`（报告购买端点校验），
  //      而智能选址只能选 `SITE_RADIUS_CHOICES = [500,1000,1500,3000]` —— **交集只有 1000 和 3000**。
  //      ⇒ 用户把半径从 1000 改成 1500 时，不是「换个半径重扣」，而是**换到一个联通侧根本
  //        不存在可复用数据的半径**（1500 报告不卖）。这时⛔ 绝不能说「改回原半径」，
  //        只能告诉他「改回 1000 或 3000」。
  //   ② 已购半径里可能有 5000（报告买了、选址选不到）⇒ 它⛔ 不能进建议列表，
  //      否则用户照着改，前端 `el-select` 里根本没这个选项。
  const suggestRadii = mismatchRadii.filter((r) => SITE_RADIUS_CHOICES.includes(r))
  if (radiusMismatch > 0) {
    const bought = mismatchRadii.length ? `${mismatchRadii.join(' / ')} 米` : '未知半径'
    if (suggestRadii.length) {
      warnings.push(
        `⚠️ 框内有 ${radiusMismatch} 个点买过人口数据，但买的是 ${bought}，与当前评估半径 ${p.radius} 米不一致，这些数据无法复用 —— 本次按全额消耗配额。改用 ${suggestRadii.join(' 或 ')} 米可复用其中一部分（重新预估不消耗配额）`
      )
    } else {
      warnings.push(
        `⚠️ 框内有 ${radiusMismatch} 个点买过人口数据（半径 ${bought}），但那些半径在智能选址里选不到，与当前评估半径 ${p.radius} 米不一致 —— 本次按全额消耗配额`
      )
    }
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
    // ⚠️ 文案必须随模式变：仅初筛里没有"商圈"这一维（尺子固定 65），
    //    照抄精算那句「只由客群/竞品/商圈决定」等于告诉用户一个没发生的事。
    warnings.push(coarseOnly
      ? '本账号名下没有门店数据：「自牌蚕食」维度不生效，初筛排名只由客群/竞品决定'
      : '本账号名下没有门店数据：饱和保护与「自牌蚕食」维度都不生效，排名只由客群/竞品/商圈决定')
  } else if (hasBrand && !ownForSat.length) {
    warnings.push(`本账号名下没有「${p.myBrand}」的门店：饱和保护已跳过，自牌维度按「无自有门店」处理`)
  }

  // 竞品点集走 utils/competitorPoints.js（与候选点位初步分析共用）：
  // 可见域 + 品牌映射 + 在营过滤三段口径只能有一份，否则同一点位在两处竞品数会不一致。
  const compIndex = loadCompetitorIndex(db, user.id, p.myBrand)
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
    if (coarseOnly) {
      // 🔴 仅初筛必须说清「实际分母降到了 35」：标称 65 而只算了两个维度，不给数字就是撒谎。
      warnings.push(p.city
        ? '本城市暂无本地 1km 网格数据 ⇒ 客群维度未评，初筛只按「竞品 + 自牌距离」两项排序'
          + `（实际分母 ${COARSE_ONLY_DENOMINATOR - COARSE_ONLY_WEIGHTS.crowd}），参考价值有限`
        : '未指定城市，无法使用本地 1km 网格 ⇒ 客群维度未评，初筛只按「竞品 + 自牌距离」两项排序')
    } else if (p.city) {
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

    // ── 批次 375：仅初筛的「65 分尺子」────────────────────────────────
    // 同一批 dims 里只取 3 个**本地免费**维度，分母恒为 65（⛔ 不含商圈，跨城不漂移）。
    // ⚠️ 与 `roughScore` 是两把尺子，⛔ 不可互相比较：roughScore 分母是 85/65/55，
    //    只用于「挑哪 N 个点去花钱」；coarseScore 只在 `/coarse` 端点对外。
    const cOnly = scoreSite(
      { crowd: dims.crowd, competition: dims.competition, cannibal: dims.cannibal },
      COARSE_ONLY_WEIGHTS
    )
    c.coarseScore = Number.isFinite(cOnly.score) ? cOnly.score : null
    c.coarseDims = {
      crowd: Number.isFinite(dims.crowd) ? dims.crowd : null,
      competition: Number.isFinite(dims.competition) ? dims.competition : null,
      cannibal: Number.isFinite(dims.cannibal) ? dims.cannibal : null
    }
    c.coarseMissingDims = cOnly.missingDims

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
    // 批次 374：「改半径重扣」的两个事实字段（estimate 直接透给前端）
    radiusMismatch,
    mismatchRadii,
    reusableRadii: suggestRadii,
    crowdSource,
    regionMedianPop,
    thresholds,
    saturatedDropped,
    saturatedSamples,
    survivorsTotal: survivors.length,
    // ⚠️ 内部字段：只给 `/coarse`（仅初筛）用，⛔ 绝不能整包 `res.json` 出去 ——
    //    里面带 `roughScore`（铁律 19：粗分不外泄）与全部候选点，序列化就是外泄。
    survivors,
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
      // 🔴 半径判据必须来自 `utils/reuseKey.js`：与 `fetchPointPopulation`、`mergePurchasedPoints`
      //    共用同一份解析。这里原先自己复制了一段 JSON.parse 逻辑 —— 那不只是重复，
      //    而是「第二份口径」：`"[1000,3000]"` 这种形态一旦两边理解不同，
      //    就会出现「探测说能复用、真取数又扣钱」。
      if (!radiusIncludes(row.radius, radius)) continue
      const dLat = (Number(row.center_lat) - lat) * 111320
      const dLng = (Number(row.center_lng) - lng) * 111320 * Math.cos((lat * Math.PI) / 180)
      // ⛔ 不写 10：与 `mergePurchasedPoints` / `fetchPointPopulation` 共用同一个容差常量，
      //    否则「探测说能复用、真取数又说不能」⇒ 预估消耗与实际扣费对不上。
      if (Math.hypot(dLat, dLng) > REUSE_TOL_M) continue
      // 🔴🔴 只判 `result_data` 非空是**系统性高估**（批次 374 修）：
      //    取数侧 `fetchPointPopulation` 要求 `parsePopulation1001(row.result_data)` **解析成功**，
      //    解析不出来（只有 1005 商圈面、脏 JSON、字段全空）会继续往下查缓存/调联通。
      //    两处不一致的后果不是「多花一点」，而是**预估消耗偏低**：
      //    用户看到「预计 10 次」、实际扣 25 次 —— 恰好是这个功能最不能被怀疑的那件事。
      //    顺序讲究：半径 → 距离 → 解析。`result_data` 是整包 1001/1005 大 JSON，
      //    放在最后解析，正常情况每次探测只解 0~2 次。
      if (parsePopulation1001(row.result_data)) return 'purchase'
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
 * POST /api/site-select/coarse —— **仅初筛模式**（批次 375）· 0 消耗 · 0 外网请求
 *
 * ── 它解决什么问题 ─────────────────────────────────────────────────────
 * 2026-11-17 生产实测：物理池余额 0 ⇒ `POST /rank` 被 `pool_exhausted` 挡住，
 * 用户连"这块地大概怎么样"都看不到，必须先掏钱买配额才能试一次。
 * 而阶段 0/1（网格撒点 + 四维粗排）**本来就是免费的**，卡住它的只是 rank 里的余额闸门。
 * ⇒ 本端点把免费的阶段 0/1 单独放出来。
 *
 * ── ⛔ 四条硬边界（每条都有守卫 + 行为测试）───────────────────────────
 * ① **一个子请求都不发**：不调 `fetchPointPopulation`、不查池余额、不写库。
 *    余额 0 正是它的使用场景，任何"顺手校验一下"都会把这条路堵死。
 * ② **⛔ 不叫「选址评分」**：分数是「本次框选内的相对水平」（分母恒 65），
 *    精算分才是绝对好坏。响应里 `scored: false`，界面必须据此改口径。
 * ③ **必须说明缺什么**：本地 1km 网格只有常住人口，⛔ 无工作人数 / 收入分档 / 到访。
 * ④ **排序与出分同源**：NMS 与截断都按 `coarseScore`，⛔ 不能按 `roughScore` 排、
 *    再拿 `coarseScore` 展示 —— 那会出现「第 1 名 62 分、第 2 名 71 分」。
 */
router.post('/coarse', authenticate, requireAdmin, (req, res) => {
  try {
    const parsed = parseParams(req.body)
    if (!parsed.ok) return res.status(400).json({ success: false, code: parsed.code, errors: parsed.errors })
    const p = parsed.params
    const db = getDb()
    const user = req.user

    const coarse = runCoarse(db, user, p, 'coarse')

    // ── 排序与去重：⛔ 复用 `survivors` 原数组（里面 score 是 roughScore）──
    const picked = coarse.survivors
      .filter((c) => Number.isFinite(c.coarseScore) && Array.isArray(c.center))
      .map((c) => ({ ...c, score: c.coarseScore }))
    // 🔴🔴 已购点**不特殊追加**（与精算模式刻意不同）。
    //    精算模式追加的理由是「花了钱必须给它一次评估」；仅初筛不花钱，没有这个债。
    //    若照抄那段追加，会出现「第 12 名 55 分、第 13 名 78 分」—— 追加点排在末尾但分数更高，
    //    因为 nms 的返回顺序已固定，而追加是 push 到尾部。这个榜无法向用户解释。
    //    ⇒ 已购点与格心点**同尺同权**一起过 nms：分高自然进榜，分低就说明周边有更优点位。
    const finalList = nms(picked, p.minGapM, p.topN)

    const warnings = [...coarse.warnings]
    // 本批实际已评权重和：无网格城市只剩 35。
    // ⚠️ 这里**不再重复喊话**：「客群维度未评」那条已由 `runCoarse(mode='coarse')` 按口径推出来，
    //    再 push 一条就是生产实测见过的「同一件事说两遍」（两条 1km 网格警告并排显示）。
    const denominatorUsed = coarse.gridCovered
      ? COARSE_ONLY_DENOMINATOR
      : COARSE_ONLY_DENOMINATOR - COARSE_ONLY_WEIGHTS.crowd

    const items = finalList.map((c, idx) => {
      const raw = {
        // ⚠️ 只给网格常住人口，⛔ 不要塞 live/work/visit —— 那三个字段本次不存在，
        //    填 null 比填数字安全，但前端要按 `mode==='coarse'` 换列，不会读它们。
        gridPop: Number.isFinite(c.circlePop) ? Math.round(c.circlePop) : null,
        competitors: c.comp?.count ?? null,
        competitorBrands: c.comp?.byBrand || {},
        nearestOwnM: Number.isFinite(c.nearestOwnM) ? Math.round(c.nearestOwnM) : null,
        ownWithin2km: c.ownWithin2km,
        districtName: c.district?.name || ''
      }
      return {
        rank: idx + 1,
        center: c.center.map((x) => Math.round(x * 1e6) / 1e6),
        radius: p.radius,
        // 🔴 字段名刻意用 `coarseScore` 而不是 `score`：它不是选址评分，⛔ 不进任何"评分"口径。
        coarseScore: c.coarseScore,
        dims: c.coarseDims,
        raw,
        // 该点是不是框内已购位置（只是提示"你来过这里"，⛔ 不影响分，也不消耗配额）
        fromPurchase: !!c.fromPurchase,
        reason: buildCoarseReason(raw, { radius: p.radius, districtName: c.district?.name })
      }
    })

    return res.json({
      success: true,
      data: {
        mode: 'coarse',
        // ⛔ 界面据此禁止出现「评分」二字：本次没有联通精算，分数是相对水平
        scored: false,
        denominator: COARSE_ONLY_DENOMINATOR,
        // 本批实际已评权重和：无网格城市只剩 35 ⇒ 界面必须换成「仅竞品+自牌」口径
        denominatorUsed,
        weights: COARSE_ONLY_WEIGHTS,
        dataBasis: ['grid-1km', 'competitors', 'own-stores', 'saturation'],
        bbox: p.bbox,
        stepM: p.stepM,
        radius: p.radius,
        gridTotal: coarse.gridTotal,
        gridCovered: coarse.gridCovered,
        purchasedInBox: coarse.purchasedInBox,
        saturatedDropped: coarse.saturatedDropped,
        saturatedSamples: coarse.saturatedSamples,
        survivorsTotal: coarse.survivorsTotal,
        returned: items.length,
        warnings,
        // 🔴 明确 0 消耗：本次不查池、不扣费，`remaining` 原样带出只为界面显示一致
        quota: { estimate: 0, used: 0, fromCacheCount: 0, remaining: getPoolRemaining(db) },
        items
      }
    })
  } catch (e) {
    console.error('[site-select/coarse]', e)
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
    // 🔴 这里原先无条件推一句「更换评估半径将重新消耗配额（已购数据按半径复用）」。
    //    批次 374 删掉：对「框内什么都没买过」的用户，这句话是误导 ——
    //    听起来像「不改半径就不用扣」，而实际每次都要全额扣。
    //    半径相关的话现在一律由 `runCoarse` **按数据**出（有已购点才说，且说清能改回哪一档）。
    if (coarse.radiusMismatch > 0 && !coarse.reusableRadii.length) {
      // 已购半径全在选址选不到的档位（如报告买的 5000）⇒ 明确「没得选」，别让用户去翻下拉框
      warnings.push('提示：智能选址的评估半径只有 500 / 1000 / 1500 / 3000 米四档，与报告购买的档位不完全重合')
    }

    return res.json({
      success: true,
      data: {
        gridTotal: coarse.gridTotal,
        gridCovered: coarse.gridCovered,
        purchasedInBox: coarse.purchasedInBox,
        // ── 批次 374：「改半径重扣」三件套（前端据此弹「改用 X 米」）────────────
        radius: p.radius,                                // 当前评估半径
        purchasedRadiusMismatch: coarse.radiusMismatch,  // 框内买过、但半径不符 ⇒ 无法复用的条数
        purchasedRadii: coarse.mismatchRadii,            // 那些点实际买过的半径（可能含选址选不到的 5000）
        reusableRadii: coarse.reusableRadii,             // 建议改用的半径（已过滤为选址可选项，升序）
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
