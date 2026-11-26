/**
 * 立项报告的数据组装（P1-5，v1.13.337）—— **纯函数，零依赖**
 *
 * 分工：本文件只做「把已有数据算成报告要展示的东西」，不碰 DOM / 网络 / Vue。
 *   拿不到的数据一律**显式标注缺失**，⛔ 不猜、不补 0、不编期次。
 *
 * 🔴🔴 报告里不许出现的东西（写在这里防后人"顺手加")：
 *   ① **⛔ 不预测营业额 / 不做销售判断** —— `store_sales` 至今没有真实数据（合成数据已删），
 *      任何"预计日销 X 元"都是编的。报告只讲**人口 / 竞争 / 租金**这些有来源的事实。
 *   ② **⛔ 不编数据期次** —— 商圈基线本身没有期次（`districts.js::BASE_DATA_MONTH = ''`），
 *      只有点过「刷新最新数据」才有 YYYYMM。没有就写「未标注」。
 *   ③ **⛔ 不把商圈评分说成"这个点位的评分"** —— 它是**商圈面**的评分，点位只是落在里面。
 *
 * ⚠️ 守卫测试直接 import 本文件跑用例（`backend/tests/candidateReport.test.js`）。
 */

import { radiusText } from './radiusText.js'
import { assignTierRoles, tierCompareNote } from './tierRoles.js'

/** 每度经/纬度对应米数（等距近似；报告只用于"最近商圈多远"这种量级判断，不用于测量） */
const M_PER_DEG_LAT = 110540
const mPerDegLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180)

/** 射线法：点是否在环内（环＝[[lng,lat], ...]） */
export function pointInRing(lng, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > lat) !== (yj > lat)) {
      const xCross = ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      if (lng < xCross) inside = !inside
    }
  }
  return inside
}

/** Polygon 坐标（[外环, 洞1, 洞2...]）→ 在外环内且在洞外 */
function pointInPolygonCoords(lng, lat, coords) {
  if (!Array.isArray(coords) || !coords.length) return false
  if (!pointInRing(lng, lat, coords[0])) return false
  for (let i = 1; i < coords.length; i++) {
    if (pointInRing(lng, lat, coords[i])) return false
  }
  return true
}

/** 支持 Polygon / MultiPolygon（v1.13.276 起商圈数据两种都有） */
export function pointInGeometry(geom, lng, lat) {
  if (!geom || !Array.isArray(geom.coordinates)) return false
  if (geom.type === 'Polygon') return pointInPolygonCoords(lng, lat, geom.coordinates)
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some((poly) => pointInPolygonCoords(lng, lat, poly))
  }
  return false
}

/** 点到线段距离（米，等距近似） */
function distToSegmentM(lng, lat, a, b) {
  const kx = mPerDegLng(lat), ky = M_PER_DEG_LAT
  const px = lng * kx, py = lat * ky
  const ax = a[0] * kx, ay = a[1] * ky
  const bx = b[0] * kx, by = b[1] * ky
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (!len2) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 点到单个环的最近距离（米） */
export function distanceToRingM(lng, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 2) return Infinity
  let best = Infinity
  for (let i = 1; i < ring.length; i++) {
    const d = distToSegmentM(lng, lat, ring[i - 1], ring[i])
    if (d < best) best = d
  }
  // 环可能是闭合的（首末点相同）也可能不是，补一次首末连线
  const d2 = distToSegmentM(lng, lat, ring[ring.length - 1], ring[0])
  if (d2 < best) best = d2
  return best
}

/** 点到几何体的最近距离（米） */
export function distanceToGeometryM(geom, lng, lat) {
  if (!geom || !Array.isArray(geom.coordinates)) return Infinity
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  let best = Infinity
  for (const poly of polys) {
    for (const ring of poly) {
      const d = distanceToRingM(lng, lat, ring)
      if (d < best) best = d
    }
  }
  return best
}

/**
 * 找该点位对应的商圈。
 * 优先「包含该点」的商圈（取第一个；正常数据不会重叠）；否则取**最近**的一个，并给出距离。
 * ⚠️ 商圈面只覆盖上海陆域约 24%（§6.76），所以"落空"是常态而不是异常 ——
 *    调用方必须把 `contained=false` 如实展示出来，⛔ 不要伪装成"就在这个商圈里"。
 *
 * @param {Array} districts `/api/districts?city=` 返回的数组（含 geometry / score / population…）
 * @returns {{ district: object|null, contained: boolean, distanceM: number|null }}
 */
export function pickDistrictForPoint(districts, lat, lng) {
  const list = Array.isArray(districts) ? districts.filter((d) => d && d.geometry) : []
  if (!list.length) return { district: null, contained: false, distanceM: null }

  for (const d of list) {
    if (pointInGeometry(d.geometry, lng, lat)) return { district: d, contained: true, distanceM: 0 }
  }

  let best = null
  let bestD = Infinity
  for (const d of list) {
    const dist = distanceToGeometryM(d.geometry, lng, lat)
    if (dist < bestD) { bestD = dist; best = d }
  }
  return { district: best, contained: false, distanceM: Number.isFinite(bestD) ? Math.round(bestD) : null }
}

/** 人口量级话术（只说密度，⛔ 不推导营业额） */
function populationNote(pop) {
  if (!pop) return '无可比人口数据'
  if (pop >= 150000) return '高密度居住'
  if (pop >= 50000) return '中等密度居住'
  if (pop >= 15000) return '居住密度偏低'
  return '居住密度很低'
}

/**
 * 半径文案已抽到 `utils/radiusText.js`（v1.13.417）—— 档位角色判定也要用同一份，
 * 各写一份会出现「正文 1.5km、对比表 1.50 km」。此处 re-export 保持既有 import 不变。
 */
export { radiusText }

/**
 * 「设置分析半径」手动输入的允许区间（米）—— v1.13.411。
 *
 * 🔴 为什么不是后端 `/brief` 的 100m~50km：
 *   · 上界 5km ＝ 联通 1001 最大档（`UNICOM_REPORT_RADII` 上界）。报告圆再大，
 *     升级购买也只能按 5km 取数（`pickUnicomRadius` 的 `covers:false`）⇒
 *     纸上摆一个买不到证据的圆，纯属自找解释成本。
 *   · 下界 0.35km ＝ 门店弹窗可买下限（`UNICOM_RADIUS_RANGE_KM.min`，409 起四处同源）。
 * ⇒ 与后端 `utils/candidateBrief.js::UNICOM_RADIUS_RANGE_KM` 同源，
 *    `candidateBriefCustomRadius.test.js` 直接比对，漂移即红。
 */
export const CUSTOM_RADIUS_MIN_M = 350
export const CUSTOM_RADIUS_MAX_M = 5000

/**
 * 手动输入的半径文本 → 米（无效返回 NaN）。
 *
 * 只认三类写法，其余一律 NaN（调用方提示并回退，⛔ 不做"猜单位"的魔法）：
 *   `2` / `1.5` / `2.0`       ⇒ 公里（业务口径，与门店弹窗「单位: 公里」一致）
 *   `2km` / `2公里` / `2千米`  ⇒ 公里
 *   `800m` / `800米`           ⇒ 米
 * ⚠️ `2000` 会被当成 2000 公里（越界）⇒ 提示文案明写「请输入公里数」，
 *    免得用户以为填米也行、然后得到一个"没看懂"的提示。
 */
export function parseRadiusInput(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return NaN
  const km = s.match(/^(\d+(?:\.\d+)?)(?:km|公里|千米)?$/)
  if (km) {
    const m = Math.round(Number(km[1]) * 1000)
    return m > 0 ? m : NaN          // `0` / `0.0` 不是半径，交给调用方当无效处理
  }
  const m = s.match(/^(\d+(?:\.\d+)?)(?:m|米)$/)
  if (m) {
    const v = Math.round(Number(m[1]))
    return v > 0 ? v : NaN
  }
  return NaN
}

/**
 * 分档序列 → 带百分比的**完整**列表（v1.13.387）
 *
 * 🔴 这里是 387 的核心：1001 一次调用买回来的分档有 3 套口径（到访 0 / 居住 1 / 工作 2）
 *   × 年龄 15 档 × 话费 6 档 = 数十个数值，而 386 之前报告只画了「居住 top3」——
 *   **花了钱买回来的数据有一多半没上纸**，也是立项报告跟初步分析拉不开差距的根因。
 *   现在整份序列都要进报告，所以这里返回全量（⛔ 不截断），由模板决定怎么排版。
 *
 * 总量为 0 返回空数组 —— ⛔ 不许画一排全 0 的条冒充"有数据"。
 */
function pctSeries(series) {
  const list = Array.isArray(series) ? series : []
  const total = list.reduce((s, x) => s + (Number(x.value) || 0), 0)
  if (!total) return []
  return list.map((x) => ({
    label: x.label,
    value: Number(x.value) || 0,
    pct: ((Number(x.value) || 0) / total) * 100
  }))
}

/** 序列里占比最高的一项（用于小结；空序列返回 null） */
function topItem(series) {
  if (!Array.isArray(series) || !series.length) return null
  return series.reduce((a, b) => (b.pct > a.pct ? b : a))
}

/**
 * 性别构成：男/女 → 人数 + 百分比。
 * ⚠️ `Number(null) === 0`、`Number(undefined) === NaN` ⇒ 一律显式兜 0，
 *    总数仍为 0 时返回 null（⛔ 不返回 0%/0% 让人以为"男女各半"）。
 */
function genderSplit(male, female) {
  const m = Number(male) || 0
  const f = Number(female) || 0
  const t = m + f
  if (!t) return null
  return { male: m, female: f, total: t, malePct: (m / t) * 100, femalePct: (f / t) * 100 }
}

/** 评分 → 星级（0~5，半星取整到 0.5） */
export function scoreToStars(score) {
  const s = Number(score)
  if (!Number.isFinite(s)) return 0
  return Math.round(Math.max(0, Math.min(100, s)) / 10) / 2
}

/**
 * 1001 的标签总数（联通「全量人口」一次返回 76 个字段）。
 *
 * 来源：`frontend/src/views/field_labels.js` 的 FIELD_LABELS['1001'] ——
 *   7 个总量（P0~P5 + PALL）+ 6 个男女人数 + 45 个年龄（15 档 × 3 口径）
 *   + 18 个话费（6 档 × 3 口径）= 76。
 * ⚠️ 写在纸面上是为了让读者知道「纸面只是摘要，完整清单在购买履历」；
 *    `backend/tests/reportIndicators.test.js` 会拿它跟 FIELD_LABELS 实际条数比对，
 *    标签表一变就红 ⇒ ⛔ 不要手改成"大概的数"。
 */
export const POP_LABEL_TOTAL = 76

/** 千分位整数（缺失 → '无数据'；0 是有效值） */
function fmtInt(v) {
  if (v === null || v === undefined || v === '') return '无数据'
  const n = Number(v)
  if (!Number.isFinite(n)) return '无数据'
  return Math.round(n).toLocaleString('zh-CN')
}

/**
 * 选址研判指标 —— 把 1001 的 76 个标签**浓缩成能直接下判断的 8~9 行**（v1.13.400）。
 *
 * 🔴 业主 2026-11-22 定：明细（15 档年龄 / 6 档话费逐档比例）在「购买履历」里本来就看得全，
 *   报告里再铺 44 行比例条只是把纸拉长，对"要不要拿这个点"没有增量信息；
 *   ⇒ 纸面只留研判口径，需要逐项核对时点「查看全部标签」跳履历。
 *
 * 🔴 每一条都必须满足三件事：
 *   ① 口径有先例或有明确字段来源（⛔ 不自创分母）；
 *   ② 缺数据 → 不产出这一条（⛔ 不填 0、不写 0.0%，那会被读成"确实是 0"）；
 *   ③ note 只陈述事实与适用的判断方向（⛔ 不许出现预计/预测/日销）。
 *
 * @param {object|null} pop parsePopulation1001 的结果
 * @returns {Array<{key:string,label:string,value:string,note:string}>}
 */
export function buildPopulationIndicators(pop) {
  if (!pop || typeof pop !== 'object') return []

  const live = numOrNull(pop.live)
  const work = numOrNull(pop.work)
  const visit = numOrNull(pop.visit)
  const out = []
  // v1.13.417：cat 区分「流动类（看完这一档能回答：多少人经过、从哪来）」与
  //   「静态类（住/工作在这的人是谁、有没有消费力）」。报告按档位角色决定哪一组展开。
  const push = (key, label, value, note, cat) => out.push({ key, label, value, note, cat: cat || 'static' })

  // ① 职住结构：工作 ÷ 居住（两套人数口径，量纲一致）
  if (live > 0 && work !== null) {
    const r = work / live
    const kind = r >= 1.2 ? '就业型' : (r <= 0.6 ? '居住型' : '职住均衡')
    push('workLive', '职住结构', `${r.toFixed(2)} 倍`,
      `工作人口 ÷ 居住人口 ⇒ ${kind}片区`, 'static')
  }

  // ② 到访强度：到访人次 ÷ 居住人口（跨口径，只做「被使用频次」的相对量）
  if (live > 0 && visit !== null) {
    push('visitIntensity', '到访强度', `${(visit / live).toFixed(1)} 倍`,
      '统计期累计到访人次 ÷ 居住人口；倍数越高，该点被使用的频次相对常住人口越高', 'flow')
  }

  // ③ 外省到访占比：P3 ÷ P0（口径同对比看板 out_ratio）
  //    ⚠️ 若上游给出 P3 > P0（口径不一致/数据异常），**不产出比例** —— 宁可少一行，
  //    也不能在对外文档里写「外省到访占 132%」。
  const outProv = numOrNull(pop.outProvince)
  if (outProv !== null && visit > 0) {
    if (outProv <= visit) {
      push('outProvince', '外省到访占比', `${((outProv / visit) * 100).toFixed(1)}%`,
        '外省到访 ÷ 到访人次；占比越高，客群辐射范围越出本地', 'flow')
    } else {
      push('outProvince', '外省到访人口', `${fmtInt(outProv)} 人`,
        '联通返回的外省到访人数；与到访人次不成子集关系，故不折算占比', 'flow')
    }
  }

  // ④ 职住一体度：P5 ÷ P1（居住与工作重合 ⇒ 就近消费的稳定客群）
  const overlap = numOrNull(pop.liveWorkOverlap)
  if (overlap !== null && live > 0) {
    if (overlap <= live) {
      push('liveWorkOverlap', '职住一体度', `${((overlap / live) * 100).toFixed(1)}%`,
        '居住与工作重合人口 ÷ 居住人口；重合度越高，就近消费的稳定客群越多', 'static')
    } else {
      push('liveWorkOverlap', '居住工作重合', `${fmtInt(overlap)} 人`,
        '联通返回的居住工作重合人数；大于居住人口时口径不可比，故不折算占比', 'static')
    }
  }

  // ⑤ 家庭客群占比：居住人口 0-18 岁四档合计 ÷ 居住
  const agesLive = Array.isArray(pop.ages?.live) ? pop.ages.live : []
  const ageSum = agesLive.reduce((s, x) => s + (Number(x?.value) || 0), 0)
  if (live > 0 && ageSum > 0) {
    const minor = agesLive.slice(0, 4).reduce((s, x) => s + (Number(x?.value) || 0), 0)
    push('family', '家庭客群占比', `${((minor / live) * 100).toFixed(1)}%`,
      '居住人口中 0-18 岁（4 个人生阶段档合计）占比；用于判断亲子 / 家庭业态适配', 'static')
  }

  // ⑥ 主力年龄：居住人口占比最高的一段（只陈述，不外推）
  //    ⚠️ 分母用**居住人口**而不是「各档合计」：与上面「家庭客群占比」同分母，
  //       否则同一张表里两行百分比各用一套分母，读者无法互相对照。
  if (live > 0 && ageSum > 0) {
    const top = agesLive.reduce((a, b) => ((Number(b?.value) || 0) > (Number(a?.value) || 0) ? b : a))
    const tv = Number(top?.value) || 0
    if (tv > 0) {
      push('mainAge', '主力年龄', `${top.label} · ${((tv / live) * 100).toFixed(1)}%`,
        '居住人口中占比最高的一段（占比分母为居住人口）', 'static')
    }
  }

  // ⑦ 高话费占比：居住人口月话费 ≥150 元（后三档）÷ 全部档
  //    口径与 backend/src/utils/siteScore.js::arpuHighPct 一致
  const arpuLive = Array.isArray(pop.arpu?.live) ? pop.arpu.live : []
  const arpuSum = arpuLive.reduce((s, x) => s + (Number(x?.value) || 0), 0)
  if (arpuLive.length >= 6 && arpuSum > 0) {
    const high = arpuLive.slice(3).reduce((s, x) => s + (Number(x?.value) || 0), 0)
    push('highArpu', '高话费占比', `${((high / arpuSum) * 100).toFixed(1)}%`,
      '居住人口月话费 150 元以上占比；话费档是联通在网用户口径的消费能力代理，不是客单价', 'static')
  }

  // ⑧ 居住性别比（单套口径，⛔ 不与到访/工作相加）
  const male = numOrNull(pop.male?.live)
  const female = numOrNull(pop.female?.live)
  if (male !== null && female !== null && male + female > 0) {
    const t = male + female
    push('gender', '居住性别比', `男 ${((male / t) * 100).toFixed(1)}% · 女 ${((female / t) * 100).toFixed(1)}%`,
      '居住人口口径（男女合计为居住人口中的有性别记录部分）', 'static')
  }

  // ⑨ 娱乐人数：只做量级，⛔ 不派生比例（无法确认与到访人次构成子集）
  const entertain = numOrNull(pop.entertain)
  if (entertain !== null) {
    push('entertain', '娱乐人数', `${fmtInt(entertain)} 人`,
      '联通按娱乐场景识别的人数，仅作量级参考，不与到访人次折算比例', 'flow')
  }

  return out
}

/** 数值或 null（区分 0 与"没有"；0 是有效值） */
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 组装报告模型 —— 报告里展示什么，全由这里决定（模板只负责排版）。
 *
 * 🔴🔴 v1.13.341：**人口数据一律来自联通的按次配额（1001），而且是「点位 + 半径」口径**，
 *   ⛔ 既不用商圈边界面属性，也不用商圈面多边形取数。
 *   业主 2026-11-09 定：①「人口不要用商圈边界面数据，用收费的联通人口配额」；
 *   ②「要与『我的门店』里购买过联通人口的门店打通」⇒ 只有**半径口径**能复用已购数据
 *   （purchases 存的就是 point + radius），商圈面口径永远复用不上、只能重复付费。
 *   ⇒ 没取到就是 `hasPop=false`，报告如实写「未获取（需购买联通人口配额）」，
 *     **绝不回落到商圈面的 pop/work/visit**。
 *   ⚠️ 口径分工（报告里已分开标注）：
 *     · 人口 = 点位半径 X 内（圆，联通 1001）
 *     · 评分 / 竞品 / 自家门店 / 客群能级 = 商圈面基线
 *     ⛔ 两者覆盖范围不同，绝不许互相冒充。
 *
 * @param {object} candidate store_candidates 一行
 * @param {{district:object|null, contained:boolean, distanceM:number|null}} hit pickDistrictForPoint 的结果
 * @param {{population?:object|null, popMonth?:string, popRadius?:number, brandScope?:object|null,
 *          tiers?:Array<{radius:number, cityMonth:string, population:object}>|null}} opts
 *        联通 1001 解析结果、期次、半径（米）；`tiers`（v1.13.413）＝该位置**已购**的各档人口
 *        （原样来自 `GET /api/candidates/purchased-population` 的 `tiers`，用于多档对比表）
 *        · `brandScope`（v1.13.346）：`/api/districts` 返回的 `{ configured, brands }`，
 *          决定「商圈内竞品」的注记怎么写 —— 未指定品牌 / 未配置映射 / 已按映射收窄，三态必须分开写。
 */
export function buildReportModel(candidate, hit = {}, opts = {}) {
  const c = candidate || {}
  const d = hit.district || null
  const contained = !!hit.contained && !!d
  const pop = opts.population || null      // 联通 1001：{ visit, live, work, total, male, female, ages, arpu }
  const popMonth = opts.popMonth || ''
  const popRadius = Number(opts.popRadius) || 0   // 米；0 = 未指定（旧调用）

  const facts = []
  const risks = []

  // ── 多档并列对比（v1.13.413）─────────────────────────────────────────────
  // 业主 2026-11-24：「立项报告不要固定为 1/3/5km，以实际购买的联通人口半径为基础」，
  //   多档呈现形态选「多档并列对比」（纸面像初步分析那样排一张对比表，主档给完整正文）。
  //
  // 🔴 数据从哪来：`GET /api/candidates/purchased-population` 直接回**已购档 + 1001 原始结构**。
  //   报告侧没有任何取数请求 ⇒ 人口一项不可能产生费用（护栏在后端结构上）。
  // 🔴 为什么只比「人口类」指标：竞品数/商圈评分是**商圈面**口径（面数据没法按圆重算），
  //   摆进这张按半径排的表里，读者会以为换半径它们也会变 ⇒ 与正文自相矛盾。
  // 🔴 密度必须用**同一份联通人口**算（`live ÷ 圆面积`），⛔ 不要掺本地 1km 网格的常住人口：
  //   两个数据源混在一张表里，读者拿「密度 × 面积」一算就跟「居住人口」列对不上。
  //
  // ⚠️ 只有 1 档时 `has=false` —— 一行数据的"对比表"没有信息量，正文已经说清了。
  const tierRows = (Array.isArray(opts.tiers) ? opts.tiers : [])
    .map((t) => {
      const r = Number(t?.radius) || 0
      if (!(r > 0)) return null
      const p = t?.population || null
      // 🔴 `Number(null) === 0`（本项目踩过一次的经典坑，§6.128）：直接写
      //    `Number(p.live) || 0` 会把「这个档没有居住人口字段」变成「0 人」，
      //    再除一圈面积就得出「密度 0 人/km²」——那是**假的结论**，不是缺数据。
      //    ⇒ 必须显式判空，缺失一律 null（纸面渲染成「—」）。
      const num = (v) => {
        if (v === null || v === undefined || v === '') return null
        const n = Number(v)
        return Number.isFinite(n) ? n : null
      }
      const live = p ? num(p.live) : null
      const work = p ? num(p.work) : null
      const visit = p ? num(p.visit) : null
      const areaKm2 = (Math.PI * r * r) / 1e6
      return {
        radius: r,
        radiusText: radiusText(r),
        isMain: r === popRadius,
        popMonth: String(t?.cityMonth || ''),
        live,
        work,
        visit,
        // 职住比只做两套**人数**口径的比值（到访是人次，⛔ 不参与任何比值）
        workLiveRatio: (live !== null && live > 0 && work !== null ? work / live : null),
        density: (live !== null && areaKm2 > 0 ? Math.round((live / areaKm2) * 10) / 10 : null),
        // v1.13.417：该档画像（visit/live/work 三套口径）与这一档实际买到的服务码。
        // 报告「居民画像」块按角色挑口径（动线档读到访、静态档读居住），此处原样带下去。
        profile: t?.profile || null,
        services: Array.isArray(t?.services) ? t.services : [],
        reach: t?.reach || null
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.radius - b.radius)

  // v1.13.417：给每档判「角色」（近场动线 / 步行客群 / 片区基本盘）。
  // 🔴 判据在 utils/tierRoles.js —— 按**档位相对位置 + 到访强度校验**，⛔ 不写死 500m/1km：
  //    同城不同业态，300m 可能是"片区"、2km 可能还只是"一个小区"。
  assignTierRoles(tierRows)

  const tierBlock = {
    has: tierRows.length >= 2,
    count: tierRows.length,
    mainRadius: popRadius,
    rows: tierRows,
    /** 可比性说明（纸面必印）：绝对值随半径膨胀，只有密度/职住比/到访强度能横向比 */
    note: tierCompareNote(tierRows),
    /**
     * 放大一圈的净效果（只陈述两个已购档之间的变化，⛔ 不外推营业额/客流）。
     * 为什么值得写：人口绝对值**一定**随半径变大，光看那一列等于「5km 永远赢」；
     * 密度与职住比才是能横向比的量 ⇒ 用一句话把两列的变化讲明白。
     */
    summary: []
  }
  if (tierRows.length >= 2) {
    const pct = (from, to) => (from !== null && from > 0 && to !== null ? ((to - from) / from) * 100 : null)
    const fmt = (v) => (v !== null ? v.toLocaleString('zh-CN') : '—')
    // 🔴 v1.13.417：原来只比「最小档 → 最大档」两句，3 档以上中间档在纸上没有任何文字解读。
    //    ⇒ 改成**逐段相邻对比**（N 档写 N-1 句），每段带上两端角色，读者才知道这段在回答什么问题。
    for (let i = 1; i < tierRows.length; i++) {
      const a = tierRows[i - 1]
      const b = tierRows[i]
      // ⚠️ 两端都必须有居住人口才写这段：缺一头就没有"放大多少"可谈，
      //    硬拼会得到「null → 60,000 人」或者 `null.toLocaleString()` 直接抛错。
      if (a.live === null || b.live === null) continue
      const popPct = pct(a.live, b.live)
      const denPct = pct(a.density, b.density)
      const intenPct = pct(a.visitIntensity, b.visitIntensity)
      tierBlock.summary.push(
        `从 ${a.radiusText}（${a.roleLabel}）到 ${b.radiusText}（${b.roleLabel}）：居住人口 ${fmt(a.live)} → ${fmt(b.live)} 人` +
        (popPct !== null ? `（${popPct >= 0 ? '+' : ''}${popPct.toFixed(0)}%）` : '') +
        `，人口密度 ${fmt(a.density)} → ${fmt(b.density)} 人/km²` +
        (denPct !== null ? `（${denPct >= 0 ? '+' : ''}${denPct.toFixed(0)}%）` : '') +
        (intenPct !== null
          ? `，到访强度 ${a.visitIntensity.toFixed(1)} → ${b.visitIntensity.toFixed(1)} 倍（${intenPct >= 0 ? '+' : ''}${intenPct.toFixed(0)}%）`
          : '') +
        '。'
      )
    }
    if (tierBlock.summary.length) {
      tierBlock.summary.push(
        '半径越大人口越多是必然的；密度被摊薄多少、到访强度下降多少，才说明这片客群有多集中、这个点更像「路过」还是「目的地」。'
      )
    }
  }

  // ── 位置 ────────────────────────────────────────────────
  facts.push({
    label: '位置',
    value: [c.city, c.district].filter(Boolean).join(' · ') || '未填写',
    note: c.address || ''
  })

  // ── 人口（点位 + 半径圆，联通 1001）—— 🔴 v1.13.342 与商圈面**完全解耦** ──
  //    337 首版把人口三项塞在 `districtBlock` 里，而 `districtBlock` 只在匹配到商圈面时才创建：
  //    ⇒ 该城市没有商圈面数据时，即使花配额买到了联通人口，报告纸面也看不到人口。
  //    340 换了数据源、341 换了半径口径，都没拆这个容器。人口口径本来就是「点 + 半径圆」，
  //    与任何商圈面无关 ⇒ 必须独立成块、**恒存在**，`hasPop` 只反映「有没有取到联通数据」。
  //
  //    🔴🔴 v1.13.387（业主 2026-11-20）：「报告原则上是在联通人口基础上的一份详细分析报告，
  //    尽可能多用联通人口数据的丰富数据标签」。1001 一次调用就能拿到**三套口径**
  //    （0=到访人次 / 1=居住 / 2=工作）× (总量 + 男女人数 + 15 年龄段 + 6 话费档)，
  //    386 之前只用了「居住」那一套的三项摘要 ⇒ 白买。这里全量铺开。
  //    ⚠️ 但**口径不能混**：到访是「人次」，居住/工作才是「人」—— 三套结论要分开写。
  // v1.13.417：当前档（纸面正文那一档）的角色与画像 —— 决定这一块「侧重讲什么」。
  //   动线档读到访口径画像（这一档的人群是"路过的人"），静态档读居住口径（"住在这的人"）。
  const curTier = tierRows.find((r) => r.radius === popRadius) || null
  const curProfile = curTier
    ? ((curTier.roleView === 'visit' ? curTier.profile?.visit : curTier.profile?.live) || null)
    : null

  const populationBlock = {
    hasPop: !!pop,
    population: pop ? Number(pop.live) || 0 : null,
    work: pop ? Number(pop.work) || 0 : null,
    visit: pop ? Number(pop.visit) || 0 : null,
    popTotal: pop ? Number(pop.total) || 0 : null,
    popMonth,
    popRadius,
    /** 性别构成：三套口径各一组（无数据的那套为 null，模板据此隐藏） */
    gender: {
      visit: pop ? genderSplit(pop.male?.visit, pop.female?.visit) : null,
      live: pop ? genderSplit(pop.male?.live, pop.female?.live) : null,
      work: pop ? genderSplit(pop.male?.work, pop.female?.work) : null
    },
    /** 年龄结构：15 档全量（带百分比），无数据的口径为空数组 */
    ages: {
      visit: pop ? pctSeries(pop.ages?.visit) : [],
      live: pop ? pctSeries(pop.ages?.live) : [],
      work: pop ? pctSeries(pop.ages?.work) : []
    },
    /** 月话费档：6 档全量（消费能力代理，⛔ 不是客单价） */
    arpu: {
      visit: pop ? pctSeries(pop.arpu?.visit) : [],
      live: pop ? pctSeries(pop.arpu?.live) : [],
      work: pop ? pctSeries(pop.arpu?.work) : []
    },
    /**
     * 职住比 = 工作人口 ÷ 居住人口。
     * ⚠️ 只做两套**人数**口径的比值（同一期次、同一半径，量纲一致）；
     *    ⛔ 不拿「到访人次」做任何比值 —— 它是统计期累计人次，与人数不可通约。
     */
    workLiveRatio: pop && Number(pop.live) > 0
      ? (Number(pop.work) || 0) / Number(pop.live)
      : null,
    /**
     * 🔴 v1.13.400：纸面只画这几行研判指标（8~9 行），
     *   ⛔ 不再画 15 档年龄 / 6 档话费的逐档比例条（那是 387 的做法，业主 11-22 改口）。
     *   逐档明细在「购买履历」里看得全，纸面重复一遍只会把报告拉长一页半。
     *   派生逻辑全在 `buildPopulationIndicators`（纯函数，后端测试直接 import）。
     */
    indicators: pop ? buildPopulationIndicators(pop) : [],
    /**
     * 该档角色（v1.13.417）：近场动线 / 步行客群 / 片区基本盘 —— 决定这一块侧重讲什么。
     * ⚠️ 角色是按**档位相对位置**判的（见 utils/tierRoles.js），不写死 500m/1km。
     */
    role: curTier?.role || null,
    roleLabel: curTier?.roleLabel || '',
    roleHint: curTier?.roleHint || '',
    roleFocus: curTier?.roleFocus || '',
    roleBasis: curTier?.roleBasis || '',
    /**
     * 居民画像（来自 1009 消费力/1010 教育/1011 职业/1012 人生阶段/1013 消费水平/1015 收入资产）。
     * 只买了 1001 的位置为 null ⇒ 纸面不出画像块（⛔ 不拿话费档冒充收入）。
     */
    profile: curProfile,
    /**
     * 这一档实际买到的服务码 —— 只留给**内部/快照**用，⛔ 纸面不再显示（v1.13.418：
     * 报告是给业主看的，服务码是计费标识，读者看到只会问"1001 是什么"）。
     */
    profileServices: curTier?.services || [],
    /** 月驻留次数（1007，到访口径）→ 高频回头客占比 */
    reach: curTier?.reach || null,
    /** 1001 标签总数 —— 纸面用它说明「这里只是摘要」 */
    labelTotal: POP_LABEL_TOTAL,
    /** 描述性小结（只陈述分布事实，⛔ 不推导营业额/客流预测） */
    summary: []
  }

  // 人口小结：职住结构 / 主力年龄 / 主力话费档 / 到访主力人群
  //   🔴 全是「占比最高的一段」这种陈述，不排序、不加权、不外推。
  //   ⚠️ v1.13.400 起**纸面不再渲染 summary**（改成上方的 indicators 表，两者信息重复），
  //      但这段仍必须保留：仓库里三个后端测试断言它的措辞口径，
  //      且它是"可复核的事实陈述"，将来 AI 提示词也会用到。⛔ 不要因为纸面看不到就删。
  if (populationBlock.hasPop) {
    const b = populationBlock
    const ratio = b.workLiveRatio
    if (ratio !== null) {
      const kind = ratio >= 1.2 ? '就业型' : (ratio <= 0.6 ? '居住型' : '职住均衡')
      b.summary.push(
        `职住结构：工作人口为居住人口的 ${ratio.toFixed(2)} 倍 ⇒ ${kind}片区（${b.work.toLocaleString('zh-CN')} 人就业 / ${b.population.toLocaleString('zh-CN')} 人居住）`
      )
    }
    const la = topItem(b.ages.live)
    if (la) b.summary.push(`居住人口以「${la.label}」为主，占 ${la.pct.toFixed(1)}%`)
    const wa = topItem(b.ages.work)
    if (wa) b.summary.push(`工作人口以「${wa.label}」为主，占 ${wa.pct.toFixed(1)}%`)
    const lp = topItem(b.arpu.live)
    if (lp) b.summary.push(`居住人口月话费集中在「${lp.label}」，占 ${lp.pct.toFixed(1)}%（消费能力代理，非客单价）`)
    const va = topItem(b.ages.visit)
    if (va) b.summary.push(`到访人次以「${va.label}」人群为主，占 ${va.pct.toFixed(1)}%（人次口径，不等于人数）`)
    const vp = topItem(b.arpu.visit)
    if (vp) b.summary.push(`到访人次月话费集中在「${vp.label}」，占 ${vp.pct.toFixed(1)}%`)
  }

  // ── 商圈画像（商圈面基线；可能没有）─────────────────────
  //    ⛔ 这里只放商圈面字段，**人口不进这个块**（否则又会随商圈面有无而消失）
  let districtBlock = null
  if (d) {
    districtBlock = {
      name: d.name || '未命名商圈',
      contained,
      distanceM: contained ? 0 : hit.distanceM,
      score: Number(d.score) || 0,
      stars: scoreToStars(d.score),
      crowd: d.crowd || '',
      level: d.level || '',
      resident: d.resident || '',
      competitorCount: Number(d.competitorCount) || 0,
      myStoreCount: Number(d.myStoreCount) || 0
    }
    facts.push({
      label: '所在商圈',
      value: districtBlock.name,
      note: contained ? '点位落在该商圈面内' : `点位不在任何商圈面内，此处为最近的商圈（直线约 ${fmtM(hit.distanceM)}）`
    })
  } else {
    // 🔴 人口与商圈面无关 ⇒ 这里只能说「竞争画像不可用」，⛔ 不许说人口不可用
    facts.push({
      label: '所在商圈',
      value: '未匹配到商圈',
      note: '该公司城市暂无商圈面数据，竞争画像（评分 / 竞品 / 自家门店）不可用'
    })
    risks.push('该点位未匹配到商圈面 —— 竞争一项无数据支撑；人口按点位半径独立取数，不受影响。')
  }

  // ── 人口结论（独立于商圈面：无商圈面也要照常出）──────────
  if (populationBlock.hasPop) {
    const b = populationBlock
    // 联通 1001 三件套：到访 / 居住 / 工作（⚠️ 到访是**人次**，与另两项不同量纲）
    // 🔴 标签必须带「半径」，因为这是 point+radius 口径，不是商圈面口径（v1.13.341）
    const rTxt = radiusText(b.popRadius)
    const rPrefix = rTxt ? `半径 ${rTxt} 内` : '半径内'
    const srcNote = `联通人口${b.popMonth ? ' ' + b.popMonth : ''} · 点位半径口径（圆）`
    facts.push({
      label: `${rPrefix}居住人口`,
      value: `${b.population.toLocaleString('zh-CN')} 人`,
      note: `${srcNote} · ${populationNote(b.population)}`
    })
    facts.push({ label: `${rPrefix}工作人口`, value: `${b.work.toLocaleString('zh-CN')} 人`, note: srcNote })
    facts.push({
      label: `${rPrefix}到访人次`,
      value: `${b.visit.toLocaleString('zh-CN')} 人次`,
      note: '统计期内累计到访次数，不等于人数，不可与居住/工作相加'
    })
    if (b.gender.live) {
      facts.push({
        label: '居住性别比',
        value: `男 ${b.gender.live.malePct.toFixed(1)}% · 女 ${b.gender.live.femalePct.toFixed(1)}%`,
        note: '联通人口 · 居住人口口径'
      })
    }
    // 🔴 v1.13.387：原来这里还有「主要年龄段」「主要月话费档」两条 top3 摘要 ——
    //    报告新增人口结构区块后会**全量 15 档 / 6 档**画出来，这两条就成了同一批数字的第三次出现。
    //    ⇒ 已删除。结构进区块，表格只留量级（居住/工作/到访三项 + 性别比）。
    //    ⚠️ 别按"以前这里有"就加回来：那是 387 之前的写法。
  } else {
    // 没买/没取到就如实说，⛔ 不拿商圈面属性顶上
    facts.push({
      label: '半径内人口',
      value: '未获取',
      note: '需购买联通人口配额后按「点位 + 半径」取数（同一位置同半径买过的自动复用、不重复扣费）'
    })
    risks.push('本报告尚未获取联通人口数据 —— 人口规模、性别、年龄与消费档位均缺失，人口相关结论不成立。')
  }

  // ── 商圈面基线结论（只在有商圈面时才有）──────────────────
  if (districtBlock) {
    const b = districtBlock
    // v1.13.346：竞品口径注记 —— 「N 家竞品」这三个字必须说清是数了哪些品牌。
    //   🔴 旧文案写死「计数含同业态全品牌」，一旦按品牌映射收窄，这句话就成了假话；
    //      而立项报告是对外文档，口径写错比数字难看严重得多 ⇒ 必须按实际口径生成。
    const bs = opts.brandScope || null
    let compScopeNote
    if (!c.brand) {
      compScopeNote = '未指定自有品牌，竞品按全量统计（含全部竞品品牌）'
    } else if (!bs || !bs.configured) {
      compScopeNote = `自有品牌「${c.brand}」未配置竞品映射，竞品按全量统计（含全部竞品品牌）`
    } else {
      const list = (Array.isArray(bs.brands) ? bs.brands : []).filter(Boolean)
      compScopeNote = list.length
        ? `已按品牌映射收窄：仅统计 ${list.join(' / ')}（自有品牌「${c.brand}」）`
        : `已按品牌映射收窄：自有品牌「${c.brand}」配置的竞品集合为空`
    }
    facts.push({
      label: '客群 / 能级',
      value: [b.crowd, b.level].filter(Boolean).join(' · ') || '无标签',
      note: [b.resident, '商圈面基线标签'].filter(Boolean).join(' · ')
    })
    facts.push({ label: '商圈竞争评分', value: `${b.score} / 100`, note: '商圈面评分，非该点位自身评分' })

    // 竞争与自家蚕食：这是"风险"里最实的两条
    if (b.competitorCount > 0) {
      risks.push(`该商圈内已有竞品门店 ${b.competitorCount} 家，进店客流需与既有竞品分流（${compScopeNote}）。`)
    } else {
      facts.push({ label: '商圈内竞品', value: '0 家', note: compScopeNote })
    }
    if (b.myStoreCount > 0) {
      risks.push(`同商圈内已有自家门店 ${b.myStoreCount} 家 —— 存在自我蚕食风险，需与现有门店做商圈切分。`)
    }
  }

  // ── 租金与面积（登记值，不做"贵不贵"判断）─────────────
  const area = Number(c.area)
  const rent = Number(c.rent)
  if (area > 0 && rent > 0) {
    const perSqm = rent / area
    facts.push({
      label: '租金水平',
      value: `${perSqm.toFixed(1)} 元/㎡/月`,
      note: `月租 ${rent.toLocaleString('zh-CN')} 元 ÷ 面积 ${area} ㎡（登记值，未含物业/抽成）`
    })
    risks.push('租金为登记值，未含物业费、推广费与抽成 —— 实际成本口径请与合同核对。')
  } else {
    if (!area) risks.push('面积未填写 —— 无法判断坪效与租金单价。')
    if (!rent) risks.push('月租金未填写 —— 无法判断成本压力。')
  }

  // ── 数据完备度（放在报告里，比藏起来诚实）─────────────
  const gaps = []
  if (!c.brand) gaps.push('品牌')
  if (!area) gaps.push('面积')
  if (!rent) gaps.push('月租金')
  if (!c.address) gaps.push('地址')
  const completeness = gaps.length ? `缺：${gaps.join('、')}` : '登记字段齐全'

  return {
    title: '选址立项报告',
    projectName: c.name || '未命名点位',
    brand: c.brand || '',
    stage: c.stage || '',
    generatedAt: new Date(),
    coordinate: {
      lat: Number(c.latitude),
      lng: Number(c.longitude),
      /**
       * 🔴 v1.13.420：这里＝**图上实际画的那个圈**，必须跟当前人口档一致。
       *   改前固定用 `c.radius`（候选点位的评估半径）⇒ 切到 3km 档时纸面同时出现
       *   「位置示意 · 半径 1.0 km」和「人口数据 · 半径 3km 内」两套半径，
       *   读图的人会拿 1km 的圈当 3km 数据的证据（真实踩过，2026-11-26 实测确认图不重画）。
       *   ⚠️ 回退顺序：当前档 → 候选评估半径 → 1000（旧调用没传档位时行为不变）。
       */
      radius: popRadius || Number(c.radius) || 1000
    },
    facts,
    district: districtBlock,
    population: populationBlock,
    /**
     * 多档并列对比（v1.13.413）：`{ has, count, mainRadius, rows[], summary[] }`。
     * `has=false`（0 档或 1 档）时纸面不渲染这张表。
     */
    tiers: tierBlock,
    risks,
    completeness,
    /** 报告里必须明写的口径（模板直接渲染，⛔ 不要另写一份） */
    provenance: {
      source: populationBlock.hasPop
        // 人口与商圈面**分属两个来源、两套口径**，必须分开写，⛔ 不能糊成一句"联通数据"
        ? `人口：联通人口（点位半径${populationBlock.popRadius ? ' ' + radiusText(populationBlock.popRadius) : ''} 内，按次配额）；商圈评分/竞争：商圈面基线；点位与租金：用户登记`
        : '人口未获取（需购买联通人口配额）；商圈评分/竞争：商圈面基线；点位与租金：用户登记',
      period: populationBlock.hasPop
        ? (popMonth ? `联通人口期次 ${popMonth}` : '联通人口未返回期次')
        : '人口无期次（未取数）；商圈基线未标注数据期次',
      sample: populationBlock.hasPop
        ? `人口为点位半径${radiusText(populationBlock.popRadius) || ''} 内的圆口径，非商圈面口径；评分与竞争计数为商圈面（${districtBlock?.name || '未匹配商圈面'}）口径` +
          (tierBlock.has ? `；对比表每列各按自己那个半径的圆单独取数（已购 ${tierBlock.rows.map((r) => r.radiusText).join(' / ')}）` : '')
        : '人口未取数 ⇒ 无人口样本；评分与竞争为商圈面口径',
      confidence: '本报告不含销售预测；人口与竞争为存量数据，不代表实时客流'
    }
  }
}

/** 米数友好显示 */
export function fmtM(m) {
  // ⚠️ 先挡 null/undefined/空串：`Number(null) === 0`，否则「未知」会被显示成「0 m」
  if (m === null || m === undefined || m === '') return '未知'
  const n = Number(m)
  if (!Number.isFinite(n)) return '未知'
  return n >= 1000 ? `${(n / 1000).toFixed(1)} km` : `${Math.round(n)} m`
}
