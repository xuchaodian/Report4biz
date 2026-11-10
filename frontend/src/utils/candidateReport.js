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

/** 半径文案：1000 →「1km」、1500 →「1.5km」、500 →「500m」 */
export function radiusText(m) {
  const n = Number(m)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1000) {
    const km = n / 1000
    return `${Number.isInteger(km) ? km : km.toFixed(1)}km`
  }
  return `${Math.round(n)}m`
}

/** 取序列里占比最高的前 n 项（用于报告里"主要年龄段/主要消费档"） */
function topSeries(series, n = 3) {
  const list = Array.isArray(series) ? series.filter((x) => Number(x.value) > 0) : []
  if (!list.length) return []
  const total = list.reduce((s, x) => s + Number(x.value), 0)
  return list
    .slice()
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, n)
    .map((x) => ({ label: x.label, value: Number(x.value), pct: total ? (Number(x.value) / total) * 100 : 0 }))
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
 * @param {{population?:object|null, popMonth?:string, popRadius?:number, brandScope?:object|null}} opts 联通 1001 解析结果、期次、半径（米）
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
  const populationBlock = {
    hasPop: !!pop,
    population: pop ? Number(pop.live) || 0 : null,
    work: pop ? Number(pop.work) || 0 : null,
    visit: pop ? Number(pop.visit) || 0 : null,
    popTotal: pop ? Number(pop.total) || 0 : null,
    popMonth,
    popRadius,
    gender: pop
      ? {
          liveMale: Number(pop.male?.live) || 0,
          liveFemale: Number(pop.female?.live) || 0
        }
      : null,
    topAges: pop ? topSeries(pop.ages?.live, 3) : [],
    topArpu: pop ? topSeries(pop.arpu?.live, 3) : []
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
    const srcNote = `联通智慧足迹${b.popMonth ? ' ' + b.popMonth : ''} · 点位半径口径（圆）`
    facts.push({
      label: `${rPrefix}居住人口`,
      value: `${b.population.toLocaleString('zh-CN')} 人`,
      note: `${srcNote} · ${populationNote(b.population)}`
    })
    facts.push({ label: `${rPrefix}工作人口`, value: `${b.work.toLocaleString('zh-CN')} 人`, note: srcNote })
    facts.push({
      label: `${rPrefix}到访人次`,
      value: `${b.visit.toLocaleString('zh-CN')} 人次`,
      note: '统计期内累计到访次数，⛔ 不等于人数，不可与居住/工作相加'
    })
    if (b.gender && (b.gender.liveMale || b.gender.liveFemale)) {
      const m = b.gender.liveMale
      const f = b.gender.liveFemale
      const t = m + f
      facts.push({
        label: '居住性别比',
        value: t ? `男 ${((m / t) * 100).toFixed(1)}% · 女 ${((f / t) * 100).toFixed(1)}%` : '无数据',
        note: '联通智慧足迹 · 居住人口口径'
      })
    }
    if (b.topAges.length) {
      facts.push({
        label: '主要年龄段',
        value: b.topAges.map((x) => `${x.label} ${x.pct.toFixed(0)}%`).join(' · '),
        note: '联通智慧足迹 · 居住人口前 3 段'
      })
    }
    if (b.topArpu.length) {
      facts.push({
        label: '主要月话费档',
        value: b.topArpu.map((x) => `${x.label} ${x.pct.toFixed(0)}%`).join(' · '),
        note: '联通智慧足迹 · 话费档可作消费能力代理，非实际客单价'
      })
    }
  } else {
    // 没买/没取到就如实说，⛔ 不拿商圈面属性顶上
    facts.push({
      label: '半径内人口',
      value: '未获取',
      note: '需购买联通人口配额后按「点位 + 半径」取数（若该位置已购买过则自动复用、不重复扣费）'
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
      radius: Number(c.radius) || 1000
    },
    facts,
    district: districtBlock,
    population: populationBlock,
    risks,
    completeness,
    /** 报告里必须明写的口径（模板直接渲染，⛔ 不要另写一份） */
    provenance: {
      source: populationBlock.hasPop
        // 人口与商圈面**分属两个来源、两套口径**，必须分开写，⛔ 不能糊成一句"联通数据"
        ? `人口：联通智慧足迹 1001（点位半径${populationBlock.popRadius ? ' ' + radiusText(populationBlock.popRadius) : ''} 内，按次配额）；商圈评分/竞争：商圈面基线；点位与租金：用户登记`
        : '人口未获取（需购买联通人口配额）；商圈评分/竞争：商圈面基线；点位与租金：用户登记',
      period: populationBlock.hasPop
        ? (popMonth ? `联通人口期次 ${popMonth}` : '联通人口未返回期次')
        : '人口无期次（未取数）；商圈基线未标注数据期次',
      sample: populationBlock.hasPop
        ? `人口为点位半径${radiusText(populationBlock.popRadius) || ''} 内的圆口径，⛔ 非商圈面口径；评分与竞争计数为商圈面（${districtBlock?.name || '未匹配商圈面'}）口径`
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
