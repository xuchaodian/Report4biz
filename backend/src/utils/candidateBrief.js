/**
 * 候选点位「初步分析」模型（v1.13.378 · P1）
 *
 * ── 这个文件解决什么 ───────────────────────────────────────────────────
 * 业主原话：「把分布在地图页面中的『常住人口分布』、『竞品分布』等免费功能整合进来后
 * 生成一份初步分析报告」。它要回答四个问题：**这里人多不多 / 竞争挤不挤 /
 * 离我自己的店多近 / 在不在商圈里** —— 全部用站内已有、**0 消耗**的数据。
 *
 * ── 🔴🔴 三条不能破的边界 ───────────────────────────────────────────────
 * ① **一个外部请求都不许发**：本文件是纯计算（不 import axios / 不 import smartsteps /
 *    不 import 高德代理）。联通人口是**付费**的，属于 P2「决定深入」之后才发生的事。
 *    守卫 `tests/candidateBriefGuard.test.js` 会扫源码，注释里写接口名也会被剥掉，别想绕。
 * ② **⛔ 不给「总分」**：智能选址的初筛分是「本次框选内的相对名次」，离开那个框就没有意义。
 *    单点报告没有可比集合 ⇒ 只给**分项事实 + 三档结论**，⛔ 不编一个 0~100 的总分。
 *    （项目已在这条上吃过亏：375 的「65 分制」被当成绝对分，见 MEMORY §6.132。）
 * ③ **未评 ≠ 0 分**：城市没有 1km 网格就是「客群未评」，⛔ 不能按 0 人算，
 *    也不能因此给绿灯或红灯 —— 只能是「需核验」。
 *
 * ── 人口口径：为什么用「密度分位」而不是圆内人口绝对值 ──────────────────
 * 单点没有「一批候选点」可以算相对分位（智能选址有 800 个格心，这里只有一个点）。
 * 但**逐格人口密度**本身就是全城分布：把圆内人口折成「每 km² 多少人」，
 * 就能直接放进本市网格的密度分布里取分位 ⇒ 上海与宜宾也能用同一套话术。
 *   圆密度 = 圆内常住人口 ÷ 圆面积(km²)
 *   格密度 = 该格常住人口 ÷ 该格实际面积(km²)   ← 面积由 halfDiagM 反推，见 cellDensity()
 * ⚠️ 分档仍是 p90/p70/p50/p25 四道门（与智能选址 GRID_PERCENTILE_STEPS 同源），
 *    ⛔ 不要在这里另立一套阈值，否则同一片地在两个页面会得到不同的「密集/稀疏」。
 *
 * ── 与「立项报告」的分工 ────────────────────────────────────────────────
 * 初步分析 = 免费数据 + 三档结论，目的是**判断值不值得花钱**（导出 PDF 可带走过会）。
 * 立项报告 = 含联通人口（付费）、AI 建议（付费）、地图截图，目的是**立项存档**。
 * ⇒ 两份报告的「商圈评分」「竞品数」必须同口径，所以都走 computeScore / countWithin。
 */
import {
  GRID_PERCENTILE_STEPS, GRID_PERCENTILE_FLOOR, SATURATION_DEFAULT
} from './siteSelectConfig.js'
import { percentileScore, percentileThresholds } from './gridPopulation.js'
import { competitionScore, COMPETITION_DENSE_MAX } from './districtScore.js'

/** 1km² 的平方米数（格密度换算用） */
const M2_PER_KM2 = 1e6
/** buildGridIndex 里 halfDiagM = sqrt(area) × 0.7072（半对角线/边长），这里反推面积 */
const HALF_DIAG_FACTOR = 0.7072

/**
 * 单格人口密度（人/km²）。
 *
 * 🔴 必须除以**该格自己的面积**，不能一律按 1km² 算：
 *    ① MultiPolygon 的每个 part 都是碎块，人口已按面积分摊，面积也必须跟着分摊；
 *    ② 城市边缘的格会被行政区裁掉一角，按 1km² 算会把密度系统性做低。
 *    面积由 buildGridIndex 存下的 `halfDiagM` 反推（`halfDiagM = sqrt(area) × 0.7072`），
 *    ⛔ 不要改成重新读几何算 turf.area —— 那会把 7.5 万格重算一遍，单点报告等不起。
 *
 * @returns {number|null} 密度；几何异常返回 null（⛔ 不返 0 冒充「这里没人」）
 */
export function cellDensity(cell) {
  const halfDiag = Number(cell?.halfDiagM)
  const pop = Number(cell?.pop)
  if (!Number.isFinite(halfDiag) || halfDiag <= 0) return null
  if (!Number.isFinite(pop) || pop <= 0) return null
  const areaM2 = (halfDiag / HALF_DIAG_FACTOR) ** 2
  if (!(areaM2 > 0)) return null
  return (pop / areaM2) * M2_PER_KM2
}

/**
 * 全城网格的密度分位门槛（**与请求无关，只与城市网格有关** ⇒ 同城任意点位口径一致）。
 * @param {Array} cells buildGridIndex 产出的 cells
 * @returns {{n:number, p25:number|null, p50:number|null, p70:number|null, p90:number|null, median:number|null}}
 */
export function densityThresholds(cells) {
  const list = Array.isArray(cells) ? cells : []
  const vals = []
  for (const c of list) {
    const d = cellDensity(c)
    if (Number.isFinite(d)) vals.push(d)
  }
  return percentileThresholds(vals)
}

/**
 * 密度分档（四道门，与 GRID_PERCENTILE_STEPS 同源）。
 * ⚠️ 返回 `null` 表示**未评**（样本不足），调用方必须按「客群未评」处理。
 */
export function densityLevel(density, t) {
  if (!Number.isFinite(density) || !t || !Number.isFinite(t.p50)) return null
  if (Number.isFinite(t.p90) && density >= t.p90) {
    return { key: 'p90', label: '高密度', note: '高于本市 90% 的网格' }
  }
  if (Number.isFinite(t.p70) && density >= t.p70) {
    return { key: 'p70', label: '较高密度', note: '高于本市 70% 的网格' }
  }
  if (density >= t.p50) {
    return { key: 'p50', label: '中等密度', note: '高于本市一半的网格' }
  }
  if (Number.isFinite(t.p25) && density >= t.p25) {
    return { key: 'p25', label: '较低密度', note: '低于本市一半的网格' }
  }
  return { key: 'low', label: '低密度', note: '低于本市 75% 的网格' }
}

/**
 * 竞争宽松度文案。
 * 阈值来自 districtScore.competitionScore（90/75/55/35/20），⛔ 不另写一套数字。
 * 注意方向：**分越高＝竞争越少**（v1.13.277 更名原因，人人都看反过）。
 */
export function competitionLevel(score) {
  const s = Number(score)
  if (!Number.isFinite(s)) return null
  if (s <= COMPETITION_DENSE_MAX) return { key: 'dense', label: '密集', note: '同级竞品密集，除非业态差异化明显，否则不建议深入' }
  if (s <= 55) return { key: 'busy', label: '偏多', note: '竞品偏多但未到密集，需要看业态差异' }
  if (s <= 75) return { key: 'normal', label: '正常', note: '竞品数量处于常见区间' }
  return { key: 'sparse', label: '稀疏', note: '半径内同级竞品很少' }
}

/** 半径文案（1000 →「1km」）；⛔ 前端另有一份 utils/candidateReport.js::radiusText，改口径要一起改 */
export function radiusText(m) {
  const n = Number(m)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1000) {
    const km = n / 1000
    return `${Number.isInteger(km) ? km : km.toFixed(1)}km`
  }
  return `${Math.round(n)}m`
}

/**
 * 竞品口径说明 —— **指标可解释性**（业主价值排序第 3）。
 * 「12 家竞品」在两种口径下含义完全不同：按本品牌映射收窄 = 同级竞争；
 * 全量 = 什么店都算。报告必须说清是哪一种，否则这个数字没法用来做判断。
 *
 * @param {object|null} scope resolveBrandScope() 的结果
 * @param {string} brand 自有品牌
 */
export function competitionScopeText(scope, brand) {
  if (!scope) return ''
  const b = String(brand || '').trim()
  if (scope.source === 'none') {
    return b ? `「${b}」未配置竞品映射：竞品按全量统计` : '点位未填品牌：竞品按全量统计'
  }
  if (scope.source === 'all') return `「${b}」已设为「全部品牌」：竞品按全量统计`
  const list = Array.isArray(scope.brands) ? scope.brands.filter(Boolean) : []
  const from = scope.source === 'group' ? '（继承集团配置）' : ''
  if (!list.length) return `「${b}」的竞品映射为空：不统计任何竞品${from}`
  return `按「${b}」的竞品映射收窄：${list.join('、')}${from}`
}

/**
 * 三档结论（**固定规则、可回溯**；业主 2026-11-18 拍板：不引入模型判断）。
 *
 * 优先级：hold（硬红灯）> watch（有短板/证据不足）> go（值得深入）。
 * 🔴 hold 只由**饱和**触发：同品牌 2km 内 ≥2 家是唯一「明确不该深入」的情形；
 *    竞品密集、商圈未覆盖这些都只是「需要核验」，不该替业主做否决。
 * 🔴 客群未评 ⇒ **绝不能 go**：核心证据缺失时给绿灯，等于用缺数据的结论支持投资决策。
 *
 * @param {object} m buildBriefModel 的中间结果
 * @returns {{level:'hold'|'watch'|'go', title:string, detail:string, reasons:string[]}}
 */
export function buildVerdict(m) {
  const reasons = []

  if (m.own?.saturated) {
    return {
      level: 'hold',
      title: '同品牌已饱和，先别急着深入',
      detail: `${radiusText(m.saturation?.radiusM || SATURATION_DEFAULT.radiusM)} 内已有 ${m.own.withinR} 家同品牌门店，`
        + '新点位大概率与自家门店互相蚕食。除非这是「关一家开一家」的替换计划，否则不建议继续投入评估成本。',
      reasons: [`${radiusText(m.saturation?.radiusM || SATURATION_DEFAULT.radiusM)} 内同品牌 ${m.own.withinR} 家（门限 ${m.saturation?.maxOwn ?? SATURATION_DEFAULT.maxOwn} 家）`]
    }
  }

  if (!m.population?.covered) {
    reasons.push(m.population?.reason === 'no_city'
      ? '点位未填城市，客群与商圈都无法加载'
      : '本市暂无本地 1km 网格，客群规模无法评估')
  }
  if (!m.own?.hasBrand) {
    reasons.push('点位未填品牌：竞品口径为全量、「同品牌距离」退化为「任意自有门店」')
  }
  if (m.competition?.level?.key === 'dense') {
    reasons.push(`半径内竞品 ${m.competition.count} 家，竞争宽松度 ${m.competition.score} 分（≤${COMPETITION_DENSE_MAX} 为密集）`)
  }
  // 🔴 「本市没有商圈面图层」与「点位不落在任何面里」是两件事，⛔ 不能共用一句文案：
  //    前者是数据缺失（缺图层），后者是点位事实（商圈面只覆盖部分陆域）。
  // 🔴 第三种情形（本轮实测补）：**点位没填城市** ⇒ 商圈面压根没被加载过，
  //    此时报「本市未上传商圈面图层」是假事实（我们连查都没查），
  //    而上面第 173 行已说明「客群与商圈都无法加载」⇒ 这里跳过，不重复也不编造。
  const noCity = m.population?.reason === 'no_city' || !m.point?.city
  if (noCity) {
    // 已由「点位未填城市，客群与商圈都无法加载」覆盖
  } else if (!m.district || !m.district.covered) {
    reasons.push('本市未上传商圈面图层，商圈维度未评')
  } else if (!m.district.contained) {
    reasons.push('不在任何商圈面内（商圈面只覆盖部分陆域，不代表这里没有商圈）')
  }
  if (m.population?.covered && Number(m.population.circlePop) === 0) {
    reasons.push('半径内未落到任何人口格，可能位于城市边缘、水域或新区未覆盖')
  }

  // 有明确短板 ⇒ 需核验（不给绿灯，也不否决）
  if (reasons.length) {
    return {
      level: 'watch',
      title: '证据不全或存在短板，建议先核验',
      detail: '以下任一项确认后再决定是否购买联通人口做精算，可以省下不必要的配额。',
      reasons
    }
  }

  // 全部过关才给绿灯
  return {
    level: 'go',
    title: '客群与竞争结构都过关，值得深入',
    detail: `半径内常住人口约 ${m.population.circlePopText}（${m.population.level.note}），`
      + `同级竞品 ${m.competition.count} 家、竞争${m.competition.level.label}，`
      + `${m.own.nearestM === null ? '半径内没有自有门店' : `最近自有门店 ${m.own.nearestText}`}。`
      + '下一步可以按点位半径向联通取人口（会明确告知消耗几次配额）。',
    reasons: []
  }
}

/**
 * 组装初步分析模型。
 *
 * @param {object} input
 * @param {object} input.point   { name, brand, city, district, address, lat, lng, radius }
 * @param {object} input.grid    { covered, reason, index } | null（loadGridIndex 的返回子集）
 * @param {object} input.density { thresholds, circlePop, whole, partial } | null
 * @param {object} input.comp    { count, byBrand: Array<{brand,count}> } | null
 * @param {object} input.own     { hasBrand, nearestM, nearestName, nearestCode, withinR, radiusM, maxOwn }
 * @param {object} input.district { name, contained, score, crowd, level, competitorCount } | null
 * @returns {object} 报告模型（**只含事实与结论，不含任何猜测值**）
 */
export function buildBriefModel(input = {}) {
  const point = input.point || {}
  const grid = input.grid || null
  const den = input.density || null
  const comp = input.comp || null
  const own = input.own || {}
  const district = input.district || null

  const radiusM = Number(point.radius) || 1000
  const circleAreaKm2 = (Math.PI * radiusM * radiusM) / M2_PER_KM2

  // ── 客群 ────────────────────────────────────────────────────────────
  const population = {
    covered: !!grid?.covered,
    // 'no_city'（点位没有城市）| 'no_grid_row'（该城不在 26 城）| 'no_field' | 'empty'
    reason: grid?.covered ? '' : (grid?.reason || (point.city ? 'no_grid_row' : 'no_city')),
    radiusM,
    circleAreaKm2: Math.round(circleAreaKm2 * 100) / 100,
    circlePop: null,
    circlePopText: '—',
    whole: 0,
    partial: 0,
    density: null,
    level: null,
    thresholds: den?.thresholds || null,
    // 🔴 字段不存在，不是精度问题（§6.128.15）：本地 1km 网格只有「常住人口」
    missingFields: ['工作人数', '到访人次', '收入分档']
  }

  if (population.covered && den && Number.isFinite(den.circlePop)) {
    population.circlePop = Math.round(den.circlePop)
    population.circlePopText = `${Math.round(den.circlePop).toLocaleString('zh-CN')} 人`
    population.whole = Number(den.whole) || 0
    population.partial = Number(den.partial) || 0
    population.density = Math.round((den.circlePop / circleAreaKm2) * 10) / 10
    population.level = densityLevel(den.circlePop / circleAreaKm2, den.thresholds)
    // 分位分只作「内部刻度」，⛔ 不对外当总分用（见文件头 ②）
    population.percentileScore = percentileScore(den.circlePop / circleAreaKm2, den.thresholds)
  }

  // ── 竞争 ────────────────────────────────────────────────────────────
  const compCount = Number(comp?.count)
  const competition = {
    radiusM,
    count: Number.isFinite(compCount) ? compCount : null,
    byBrand: (Array.isArray(comp?.byBrand) ? comp.byBrand : []).slice(0, 8),
    score: Number.isFinite(compCount) ? competitionScore(compCount, 0) : null,
    level: Number.isFinite(compCount) ? competitionLevel(competitionScore(compCount, 0)) : null,
    // 口径（按品牌映射收窄 / 全量）—— 报告里必须显示，否则这个数字不可解释
    scope: comp?.scope || null,
    scopeText: competitionScopeText(comp?.scope, point.brand)
  }

  // ── 自有门店 / 饱和 ─────────────────────────────────────────────────
  // 🔴🔴 `Number(null) === 0`：直接写 `Number.isFinite(Number(own.nearestM))` 会把
  //      「半径内没有门店」（null）变成「最近门店 0 米」—— 生产实测踩到（批次 378，
  //      一个没有品牌的点位显示「最近自有门店 0 m」）。必须先判空再转数。
  const nearRaw = own.nearestM
  const nearestM = nearRaw === null || nearRaw === undefined || nearRaw === ''
    ? null
    : (Number.isFinite(Number(nearRaw)) ? Math.round(Number(nearRaw)) : null)
  const ownOut = {
    hasBrand: !!own.hasBrand,
    brand: String(own.brand || ''),
    nearestM,
    nearestName: String(own.nearestName || ''),
    nearestCode: String(own.nearestCode || ''),
    withinR: Number(own.withinR) || 0,
    saturated: false
  }
  ownOut.nearestText = ownOut.nearestM === null ? '' : `${ownOut.nearestM} m`
  const satRadius = Number(own.radiusM) || SATURATION_DEFAULT.radiusM
  const satMax = Number(own.maxOwn) || SATURATION_DEFAULT.maxOwn
  // 饱和度只在「指定了品牌」时成立 —— 「饱和」是品牌概念，拿全品牌判会把别人的店算成自己的饱和
  ownOut.saturated = ownOut.hasBrand && ownOut.withinR >= satMax

  const out = {
    point: {
      name: String(point.name || ''),
      brand: String(point.brand || ''),
      city: String(point.city || ''),
      district: String(point.district || ''),
      address: String(point.address || ''),
      lat: Number(point.lat),
      lng: Number(point.lng),
      radius: radiusM
    },
    population,
    competition,
    own: ownOut,
    district,
    saturation: { radiusM: satRadius, maxOwn: satMax },
    // 数据来源声明（PDF 页脚要用，⛔ 不许写成「联通数据」）
    provenance: {
      source: '本地 1km 网格（常住人口）+ 站内竞品库 + 我的门店 + 商圈面',
      cost: '本次分析未调用联通/高德，0 配额消耗',
      populationField: '常住人口（本地网格）'
    }
  }

  out.verdict = buildVerdict({ ...out, saturation: out.saturation })

  // ── 风险与待确认（每条都对应一个可核验的事实）──────────────────────
  const risks = []
  if (!Number.isFinite(out.point.lat) || !Number.isFinite(out.point.lng)) {
    risks.push('点位没有有效坐标，无法做任何空间分析')
  }
  if (!out.point.city) risks.push('点位未填城市：无法加载本地 1km 网格与商圈面')
  if (population.reason === 'no_grid_row' && out.point.city) {
    risks.push(`「${out.point.city}」暂无本地 1km 网格人口（目前仅 26 个城市有），客群规模未评`)
  }
  if (population.reason === 'no_field') risks.push('该城市网格缺少「常住人口」字段，客群规模未评')
  if (population.reason === 'empty') risks.push('该城市网格全部为 0，客群规模未评')
  if (population.covered && population.circlePop === 0) {
    risks.push('半径内未落到任何人口格 —— 可能是城市边缘/水域，也可能该片区网格未覆盖（⛔ 不等于没人）')
  }
  if (!out.own.hasBrand) risks.push('点位未填品牌：竞品按全量统计、自牌蚕食无法评估')
  // 🔴 只有**真的看过商圈面**（covered）才谈得上「不在任何商圈面内」；
  //    没填城市时 district.covered=false 只是「没加载」，⛔ 不能读成「不在面内」（第 334 行已说明原因）。
  if (district && district.covered && !district.contained) risks.push('该点位不在任何商圈面内；商圈评分缺失不代表商圈不存在')
  // 「本市没有商圈面图层」只有在**知道是哪个市**时才成立；没填城市已由第 334 行统一说明。
  // ⚠️ 原写法 `if (!district)` 实际是死分支 —— 路由永远传对象（covered:false），不是 undefined。
  if (out.point.city && (!district || !district.covered)) risks.push('本市未上传商圈面图层，商圈维度未评')
  risks.push('本地网格只有常住人口，没有工作人数、到访人次与收入分档 —— 客流活性需购买联通人口后才能评估')
  out.risks = risks

  return out
}

/** 供路由层直接用的常量（⛔ 前端不许硬编码这几个数） */
export const BRIEF_CONST = Object.freeze({
  GRID_PERCENTILE_STEPS,
  GRID_PERCENTILE_FLOOR,
  COMPETITION_DENSE_MAX,
  SATURATION_RADIUS_M: SATURATION_DEFAULT.radiusM,
  SATURATION_MAX_OWN: SATURATION_DEFAULT.maxOwn
})
