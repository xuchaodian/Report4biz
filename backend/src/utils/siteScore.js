/**
 * 智能选址评分：维度分 / 归一化 / 推荐理由（v1.13.370 / 批次 370）
 *
 * ── 三条不可动摇的纪律 ─────────────────────────────────────────────────
 * ① **未评 ≠ 0 分 ≠ 满分**：缺失维度不进分母，并在 `missingDims` 里如实回传。
 *    理由：把「没数据」算成 0 会系统性压低某些点位；算成满分则会给烂点绿灯。
 * ② **客群（A）不适用重归一化**：A 未评即整批拒绝（routes 层判断），
 *    否则总分只剩竞品/商圈/自牌四项，却仍显示成 0~100 的"综合分"——用缺核心证据的分去排名，不接受。
 * ③ **粗分不外泄**：初筛分是「本次框选内的相对名次」，精算分是「绝对好坏」，两者不可比。
 *    本文件只产出精算后的最终分；初筛分由 routes 层内部持有，⛔ 不进响应、⛔ 不进界面。
 *
 * ── 为什么 D 维度 P0 一律未评 ──────────────────────────────────────────
 * 见 siteSelectConfig.P0_ACCESS_ENABLED：D 要对每个点调高德 business-count，
 * 20 点 = 20 次外部调用 + QPS 风险，而它对排序影响最小。P1 接入时不改本文件
 * （accessScore 已实现，只是 routes 层不传值）。
 */

import {
  SITE_WEIGHTS, SITE_CROWD_SUB, SITE_CROWD_STEPS, SITE_CROWD_FLOOR,
  SITE_VISIT_STEPS, SITE_VISIT_FLOOR,
  ARPU_STEPS, ARPU_FLOOR, CANNIBAL_STEPS, CANNIBAL_FAR, ACCESS_STEPS, ACCESS_FLOOR
} from './siteSelectConfig.js'

/**
 * 分档打分通用实现：steps 从高到低匹配，返回第一个命中的分。
 *
 * ⚠️ 用 `>=` 而不是 `>`：人口是浮点加权和（恰等于 80000 几乎不可能），
 *    但 ARPU 是**取整百分比**（恰好 45% 很常见）——用 `>` 会让「45%」拿不到 95 分，
 *    与立项稿 §5.1 表格「≥45%→95」不符。统一 `>=` 对两类都正确。
 */
function stepScore(value, steps, floor) {
  if (!Number.isFinite(value)) return null
  for (const [bound, score] of steps) {
    if (value >= bound) return score
  }
  return floor
}

/**
 * 精算 A1：1km 圆内「居住 + 工作」人口 → 分。
 * ⚠️ 阈值来自 SITE_CROWD_STEPS（**待回测**），⛔ 不是 districtScore.populationScore 的商圈阈值。
 */
export function siteCrowdScore(pop) {
  return stepScore(pop, SITE_CROWD_STEPS, SITE_CROWD_FLOOR)
}

/**
 * 精算 A2：1km 圆内**月度到访人次** → 分（v1.13.371 起，业主 11-17 拍板 A 案）。
 *
 * 为什么换成到访：话费档的分母是「联通在网用户」而非全人口，且家庭共享套餐/企业报销/
 * 老年低话费高资产三重误判会让它反向 —— 拿它当购买力代理不配 10 分权重。
 * 到访人次衡量的是「这个点被多少人使用」，对选址比「住的人话费多高」更接近客流。
 *
 * ⚠️ 0 是**有效值**（真实无到访 ⇒ 最低档），⛔ 不要当成未评；
 *    只有 null / undefined / 空串 / 非数字 才算未评（⇒ 退回 A1，不拉低总分）。
 */
export function visitScore(visit) {
  if (visit === null || visit === undefined || visit === '') return null
  const v = Number(visit)
  if (!Number.isFinite(v)) return null
  return stepScore(v, SITE_VISIT_STEPS, SITE_VISIT_FLOOR)
}

/**
 * A2 旧口径：居住人口月话费「150 元以上」占比（%）→ 分。
 * 🔴 **自 v1.13.371 起不再参与评分**，仅保留给历史数据与展示参考。
 *    ⛔ 不要接回 A2（原因见 visitScore 上方与 siteSelectConfig.SITE_CROWD_SUB）。
 * @param {number|null} pct 0~100
 */
export function arpuScore(pct) {
  return stepScore(pct, ARPU_STEPS, ARPU_FLOOR)
}

/**
 * 从 parsePopulation1001 的结果里取「居住人口月话费 ≥150 元」占比。
 *
 * ARPU_GROUPS 顺序：50以下 / 50-100 / 100-150 / 150-200 / 200-250 / 250以上
 * ⇒ 高段 = 后三档（index 3~5）。
 *
 * @returns {number|null} 百分比；总量为 0 或结构缺失返回 null（⇒ A2 未评）
 */
export function arpuHighPct(pop) {
  const live = pop?.arpu?.live
  if (!Array.isArray(live) || live.length < 6) return null
  const vals = live.map((x) => Number(x?.value) || 0)
  const total = vals.reduce((s, v) => s + v, 0)
  if (!(total > 0)) return null
  const high = vals.slice(3).reduce((s, v) => s + v, 0)
  return Math.round((high / total) * 1000) / 10
}

/**
 * A 维度合成：A1（规模，权重 20）+ A2（到访活跃，权重 10）→ 0~100。
 * A2 缺失时退回 A1（⛔ 不按 0 拉低总分）。
 * ⚠️ 子权重的键名是 `size` / `visit`（旧版是 `arpu`）—— 改键名是为了让"谁在算分"一目了然。
 */
export function combineCrowd(a1, a2) {
  if (Number.isFinite(a1) && Number.isFinite(a2)) {
    const { size, visit } = SITE_CROWD_SUB
    return Math.round((a1 * size + a2 * visit) / (size + visit))
  }
  if (Number.isFinite(a1)) return a1
  return null
}

/**
 * E 自牌蚕食规避：最近同品牌距离（米）→ 分（**越远越好**）。
 * ⚠️ 方向与体检相反：体检判「风险高低」（越近越差），这里判「点位好坏」（越远越好），
 *    但门槛必须是同一组 300/800（项目铁律：不让客户看到两套阈值）。
 */
export function cannibalScore(distM) {
  if (!Number.isFinite(distM)) return CANNIBAL_FAR // 半径内查不到 ⇒ 视为独立（还不是"未评"）
  for (const [bound, score] of CANNIBAL_STEPS) {
    if (distM <= bound) return score
  }
  return CANNIBAL_FAR
}

/** D 可达配套：周边 POI 总量 → 分（P0 不启用，保留 P1） */
export function accessScore(count) {
  return stepScore(count, ACCESS_STEPS, ACCESS_FLOOR)
}

/**
 * 五维（P0 实际四维）加权归一化。
 *
 * 总分 = Σ(维度分 × 权重) / Σ(已评维度权重) × 100
 * 分母只算已评维度 ⇒ 缺数据时总分仍是 0~100 可比。
 *
 * @param {object} dims {crowd, competition, district, access, cannibal}，未评为 null/undefined
 * @param {object} [weights] 缺省 SITE_WEIGHTS（接口回传同一份，⛔ 前后端各写一份）
 * @returns {{score:number|null, coverage:object, missingDims:string[], denominator:number}}
 */
export function scoreSite(dims, weights = SITE_WEIGHTS) {
  const d = dims || {}
  const coverage = {}
  const missingDims = []
  let weighted = 0
  let denominator = 0

  for (const key of Object.keys(weights)) {
    const v = d[key]
    const ok = Number.isFinite(v)
    coverage[key] = ok
    if (ok) {
      weighted += v * weights[key]
      denominator += weights[key]
    } else {
      missingDims.push(key)
    }
  }

  return {
    score: denominator > 0 ? Math.round(weighted / denominator) : null,
    coverage,
    missingDims,
    denominator
  }
}

/** 万为单位（1 位小数；<1 万时直接给整数人） */
export function fmtWan(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)} 万`
  return `${Math.round(v)} 人`
}

/** 公里（2 位小数；>=10km 给 1 位） */
export function fmtKm(m) {
  const v = Number(m) || 0
  const km = v / 1000
  return `${km >= 10 ? km.toFixed(1) : km.toFixed(2)}km`
}

/**
 * 到访人次（带单位）。
 * ⚠️ 不能直接复用 fmtWan：它产出「9569 人」，再拼「人次」会变成「9569 人人次」。
 */
export function fmtVisitCount(v) {
  const n = Number(v) || 0
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)} 万人次`
  return `${Math.round(n)} 人次`
}

/**
 * 商圈短语：`名称` 可能自带「商圈」后缀。
 * 🔴 2026-11-17 生产实测：`districtName = "彭浦新村商圈"`，旧写法机械拼成
 *    「位于「彭浦新村商圈」商圈」—— 生成日志里一眼能看到，但界面上很容易被当成排版问题忽略。
 * ⛔ 不要在调用处各自 `+ '商圈'`，两处（精算/初筛）必须共用这一份。
 */
function districtPhrase(name) {
  const n = String(name || '').trim()
  if (!n) return ''
  return /商圈$/.test(n) ? `位于「${n}」` : `位于「${n}」商圈`
}

/**
 * 推荐理由（**确定性生成，不调 LLM**）。
 * 每条都必须在系统里可复核 —— 数字直接来自 raw，⛔ 不许出现「潜力巨大」这类话术。
 *
 * @param {object} raw 见 routes/site-select.js 的 items[].raw
 * @param {object} meta { radius, cityMonth, districtName, districtScore }
 * @returns {string[]} 2~4 句
 */
export function buildReason(raw, meta = {}) {
  const r = raw || {}
  const out = []
  const radius = Number(meta.radius) || 1000

  // ① 人口（必须带账期 —— 联通「12 个月新鲜度」是既有口径，不写账期用户无法判断新旧）
  if (Number.isFinite(r.live) || Number.isFinite(r.work)) {
    const month = meta.cityMonth ? `（联通 ${meta.cityMonth}）` : ''
    out.push(`半径 ${radius}m 内居住 ${fmtWan(r.live)} + 工作 ${fmtWan(r.work)}${month}`)
  }
  // ② 到访活跃（v1.13.371 起参与 A2 打分，必须出现在理由里）
  // ⚠️ 话费占比（r.arpuHighPct）自 371 起**不进分** ⇒ ⛔ 不要写进理由，
  //    否则客户会以为"话费高所以排名高"（理由只讲真正参与打分的因素）。
  if (Number.isFinite(r.visit)) {
    out.push(`半径 ${radius}m 内月度到访 ${fmtVisitCount(r.visit)}`)
  }
  // ③ 竞品
  if (Number.isFinite(r.competitors)) {
    const brands = r.competitorBrands && typeof r.competitorBrands === 'object'
      ? Object.entries(r.competitorBrands).sort((a, b) => b[1] - a[1]).slice(0, 2)
        .map(([b, n]) => `${b} ${n}`).join(' / ')
      : ''
    out.push(r.competitors > 0
      ? `${radius}m 内竞品 ${r.competitors} 家${brands ? `（${brands}）` : ''}`
      : `${radius}m 内无竞品`)
  }
  // ④ 自有品牌
  if (Number.isFinite(r.nearestOwnM)) {
    out.push(`800m 内无同品牌门店，最近 ${fmtKm(r.nearestOwnM)}${Number.isFinite(r.ownWithin2km) ? `；2km 内 ${r.ownWithin2km} 家` : ''}`)
  } else if (Number.isFinite(r.ownWithin2km)) {
    out.push(`800m 内无同品牌门店；2km 内 ${r.ownWithin2km} 家`)
  }
  // ⑤ 商圈
  if (meta.districtName) {
    out.push(`${districtPhrase(meta.districtName)}${Number.isFinite(meta.districtScore) ? `（综合 ${meta.districtScore} 分）` : ''}`)
  }

  return out.filter(Boolean).slice(0, 4)
}

/**
 * **仅初筛模式**的推荐理由（批次 375）—— ⛔ 不能复用 `buildReason`。
 *
 * 为什么必须分开写：`buildReason` 讲的是联通 1001 的「居住 / 工作 / 月度到访」，
 * 而仅初筛一个子请求都不发，手里只有本地 1km 网格的**常住人口**。
 * 用同一句话术会直接摧毁「0 消耗」这个承诺 —— 用户看到「居住 8.2 万」会认为查过联通。
 * ⇒ 这里只用「常住人口（本地网格底图，未查联通）」这一个口径，
 *   且⛔ 不出现「工作」「到访」「话费」任何联通字段名。
 *
 * @param {object} raw {gridPop, competitors, competitorBrands, nearestOwnM, ownWithin2km, districtName}
 * @param {object} meta {radius}
 * @returns {string[]} 1~4 句
 */
export function buildCoarseReason(raw, meta = {}) {
  const r = raw || {}
  const radius = Number(meta.radius) || 1000
  const out = []

  // ① 常住人口：⚠️ 先判 isFinite，`fmtWan(null)` 会输出「0 人」，
  //    那在无网格城市会变成"这里没人"的假结论。
  if (Number.isFinite(r.gridPop)) {
    out.push(`半径 ${radius}m 内常住 ${fmtWan(r.gridPop)}（本地 1km 网格底图，未查联通）`)
  }
  // ② 竞品
  if (Number.isFinite(r.competitors)) {
    const brands = r.competitorBrands && typeof r.competitorBrands === 'object'
      ? Object.entries(r.competitorBrands).sort((a, b) => b[1] - a[1]).slice(0, 2)
        .map(([b, n]) => `${b} ${n}`).join(' / ')
      : ''
    out.push(r.competitors > 0
      ? `${radius}m 内竞品 ${r.competitors} 家${brands ? `（${brands}）` : ''}`
      : `${radius}m 内无竞品`)
  }
  // ③ 自有门店（与精算口径同一组 300/800，⛔ 不给客户两套阈值）
  if (Number.isFinite(r.nearestOwnM)) {
    out.push(`800m 内无同品牌门店，最近 ${fmtKm(r.nearestOwnM)}${Number.isFinite(r.ownWithin2km) ? `；2km 内 ${r.ownWithin2km} 家` : ''}`)
  } else if (Number.isFinite(r.ownWithin2km)) {
    out.push(`800m 内无同品牌门店；2km 内 ${r.ownWithin2km} 家`)
  }
  // ④ 商圈（只做位置说明 —— 商圈分不进初筛尺子，⛔ 不要在这里报分数，否则等于暗示它参与了）
  if (meta.districtName) out.push(districtPhrase(meta.districtName))

  return out.filter(Boolean).slice(0, 4)
}
