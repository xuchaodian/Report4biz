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

/** 评分 → 星级（0~5，半星取整到 0.5） */
export function scoreToStars(score) {
  const s = Number(score)
  if (!Number.isFinite(s)) return 0
  return Math.round(Math.max(0, Math.min(100, s)) / 10) / 2
}

/**
 * 组装报告模型 —— 报告里展示什么，全由这里决定（模板只负责排版）。
 *
 * @param {object} candidate store_candidates 一行
 * @param {{district:object|null, contained:boolean, distanceM:number|null}} hit pickDistrictForPoint 的结果
 */
export function buildReportModel(candidate, hit = {}) {
  const c = candidate || {}
  const d = hit.district || null
  const contained = !!hit.contained && !!d

  const facts = []
  const risks = []

  // ── 位置 ────────────────────────────────────────────────
  facts.push({
    label: '位置',
    value: [c.city, c.district].filter(Boolean).join(' · ') || '未填写',
    note: c.address || ''
  })

  // ── 商圈画像（可能没有）────────────────────────────────
  let districtBlock = null
  if (d) {
    districtBlock = {
      name: d.name || '未命名商圈',
      contained,
      distanceM: contained ? 0 : hit.distanceM,
      score: Number(d.score) || 0,
      stars: scoreToStars(d.score),
      population: Number(d.population) || 0,
      work: Number(d.work) || 0,
      visit: Number(d.visit) || 0,
      crowd: d.crowd || '',
      level: d.level || '',
      resident: d.resident || '',
      competitorCount: Number(d.competitorCount) || 0,
      myStoreCount: Number(d.myStoreCount) || 0,
      income: d.income || null
    }
    facts.push({
      label: '所在商圈',
      value: districtBlock.name,
      note: contained ? '点位落在该商圈面内' : `点位不在任何商圈面内，此处为最近的商圈（直线约 ${fmtM(hit.distanceM)}）`
    })
  } else {
    facts.push({ label: '所在商圈', value: '未匹配到商圈', note: '该公司城市暂无商圈面数据，人口与竞争画像不可用' })
    risks.push('该点位未匹配到商圈面 —— 人口、竞争两项无数据支撑，结论仅限「登记信息」层面。')
  }

  // ── 结论（只陈述事实 + 有出处的比较）──────────────────
  if (districtBlock) {
    const b = districtBlock
    facts.push({ label: '商圈居住人口', value: b.population ? b.population.toLocaleString('zh-CN') + ' 人' : '无数据', note: populationNote(b.population) })
    facts.push({ label: '商圈工作人口', value: b.work ? b.work.toLocaleString('zh-CN') + ' 人' : '无数据', note: '' })
    facts.push({
      label: '客群 / 能级',
      value: [b.crowd, b.level].filter(Boolean).join(' · ') || '无标签',
      note: b.resident || ''
    })
    facts.push({ label: '商圈竞争评分', value: `${b.score} / 100`, note: '商圈面评分，非该点位自身评分' })

    // 竞争与自家蚕食：这是"风险"里最实的两条
    if (b.competitorCount > 0) {
      risks.push(`该商圈内已有竞品门店 ${b.competitorCount} 家，进店客流需与既有竞品分流（计数含同业态全品牌）。`)
    } else {
      facts.push({ label: '商圈内竞品', value: '0 家', note: '按当前可见范围统计' })
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
      radius: Number(c.radius) || 1000
    },
    facts,
    district: districtBlock,
    risks,
    completeness,
    /** 报告里必须明写的口径（模板直接渲染，⛔ 不要另写一份） */
    provenance: {
      source: '商圈边界：联通人口版（系统内已导入的城市商圈面）；点位与租金：用户登记',
      period: '商圈基线未标注数据期次（只有刷新过「最新数据」的商圈才有月份）',
      sample: districtBlock ? `人口为商圈面口径（${districtBlock.name}）` : '无商圈面 ⇒ 无人口样本',
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
