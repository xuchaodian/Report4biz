/**
 * 联通「画像」服务码解析 —— 供立项报告用（v1.13.417）
 *
 * ── 背景 ──────────────────────────────────────────────────────────────
 * 413 的立项报告只解析 1001（人数 + 性别 + 年龄 + 话费），因为当时的口径是
 * 「报告只要人口」。但业主 2026-11-25 指出：
 *   小半径（≤500m）看的是**动态到访**，半径 1km 以上要看**静态居民画像（收入/职业/消费力）**。
 * 而收入/职业/消费力根本不在 1001 里，它们在
 *   1009 消费力指数（1~8 档）｜1010 教育｜1011 职业｜1012 人生阶段｜1013 消费水平（高/中/低）
 *   1015 资产预测（收入/有车/有房，成品区 1014/1015/1016）｜1007 月驻留次数
 * ⇒ 报告必须能读「**已购的全部服务码**」，而不是只读 1001。
 *
 * ── 口径 ──────────────────────────────────────────────────────────────
 * 上述服务码都是数组，元素带 `popu_type`（0=到访 / 1=居住 / 2=工作）。
 * 动线档看到访口径，静态档看居住口径 —— 所以一次解析出三套，由报告按角色挑。
 *
 * ── 标签从哪来 ────────────────────────────────────────────────────────
 * ⛔ 不在这里手写「白领及一般职员」「硕士」这类中文：`unicomSummaryCols.js` 的 343 行
 *    `{c: 服务码, f: 字段名, m: 含义}` 是模板固化下来的**唯一**字段字典。
 *    这里按 (code, field) 反查含义、去掉口径前缀（"居住"/"到访"/"工作"）当标签，
 *    ⇒ 字典一改标签自动跟上，不会出现「报告写本科、模板说大专」的错位。
 */
import { UNICOM_SUMMARY_COLS } from './unicomSummaryCols.js'
import { buildSummaryValues } from './unicomSummaryValues.js'

/** (code|field) → 中文含义（去口径前缀），构建一次 */
let LABEL_MAP = null
function labelMap() {
  if (LABEL_MAP) return LABEL_MAP
  LABEL_MAP = new Map()
  for (const r of UNICOM_SUMMARY_COLS) {
    if (!r || !r.c || !r.f) continue
    LABEL_MAP.set(`${r.c}|${String(r.f).toLowerCase()}`, String(r.m || '').replace(/^(到访|居住|工作)/, ''))
  }
  return LABEL_MAP
}

function labelOf(code, field) {
  return labelMap().get(`${code}|${String(field).toLowerCase()}`) || String(field)
}

/** 数值化：非数字/null ⇒ null（⛔ 不填 0，0 是有效值） */
function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 从 summary 里取一组分档 → [{field,label,value}]（只保留有值的档） */
function group(summary, code, fields) {
  const m = summary?.[code] || {}
  const out = []
  for (const f of fields) {
    const v = num(m[String(f).toLowerCase()])
    if (v === null) continue
    out.push({ field: f, label: labelOf(code, f), value: v })
  }
  return out
}

function sum(items) {
  return items.reduce((s, x) => s + x.value, 0)
}

/** 分档 → 占比（分母取该组自身合计；没有可分档人口时返回 null） */
function withPct(items) {
  const total = sum(items)
  if (!(total > 0)) return { total: 0, items: items.map((x) => ({ ...x, pct: null })) }
  return { total, items: items.map((x) => ({ ...x, pct: (x.value / total) * 100 })) }
}

/** 取某个口径（0/1/2）的完整画像；该口径没有任何画像数据时返回 null */
export function buildProfile(summary, popType) {
  if (!summary || typeof summary !== 'object') return null
  const pt = Number(popType)
  if (![0, 1, 2].includes(pt)) return null
  const p = `pop${pt}_`

  // 1013 消费水平（高/中/低）
  const spend = withPct(group(summary, '1013', [`${p}p1`, `${p}p2`, `${p}p3`]))
  // 1009 消费力指数（1..8，数值越大越强）—— 算加权均值，1..8 是序数
  const indexItems = group(summary, '1009', Array.from({ length: 8 }, (_, i) => `${p}p${i + 1}`))
  const indexTotal = sum(indexItems)
  const indexAvg = indexTotal > 0
    ? indexItems.reduce((s, x) => {
      const n = Number(String(x.field).replace(/^.*p/, '')) || 0
      return s + n * x.value
    }, 0) / indexTotal
    : null
  // 1010 教育（p0 高中及以下 / p1 大专 / p2 本科 / p3 硕士 / p4 博士）
  const edu = withPct(group(summary, '1010', [`${p}p0`, `${p}p1`, `${p}p2`, `${p}p3`, `${p}p4`]))
  const eduHigh = edu.items.filter((x) => ['本科', '硕士', '博士'].some((k) => x.label.includes(k)))
  // 1011 职业（p1..p10）
  const job = withPct(group(summary, '1011', Array.from({ length: 10 }, (_, i) => `${p}p${i + 1}`)))
  // 1012 人生阶段（p1 已婚已育 / p2 已婚未育 / p3 未婚未育）
  const life = withPct(group(summary, '1012', [`${p}p1`, `${p}p2`, `${p}p3`]))
  // 1015 资产预测 → 成品区：1014 收入 / 1015 有车 / 1016 有房（各 p1..p5：高→低）
  const income = withPct(group(summary, '1014', Array.from({ length: 5 }, (_, i) => `income_${p}p${i + 1}`)))
  const car = withPct(group(summary, '1015', Array.from({ length: 5 }, (_, i) => `car_${p}p${i + 1}`)))
  const house = withPct(group(summary, '1016', Array.from({ length: 5 }, (_, i) => `house_${p}p${i + 1}`)))

  /** 概率档「高 + 中高」= 字段后缀 p1 或 p2（⛔ 不按中文标签匹配，见 spendLevel 的教训） */
  const isHighPlusField = (x) => /p[12]$/.test(String(x.field).toLowerCase())
  const pctOf = (g, pred) => {
    const hit = g.items.filter(pred)
    if (!hit.length || !(g.total > 0)) return null
    return (sum(hit) / g.total) * 100
  }
  const topJobs = job.items
    .filter((x) => x.pct !== null)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3)

  const hasAny = [spend, edu, job, life, income, car, house].some((g) => g.total > 0) || indexTotal > 0
  if (!hasAny) return null

  return {
    popType: pt,
    // 消费力（用户要的「消费力」两个来源都留着：1013 是高中低分档，1009 是 1~8 指数）
    spendLevel: {
      total: spend.total,
      // 🔴 按**字段后缀**判档，不按中文标签里的字：1013 的 m 结尾是「…人数」，
      //    用 `label.endsWith('高')` 永远不命中（实测踩过：收入只算到「中高」一档）。
      high: pctOf(spend, (x) => /p1$/.test(String(x.field).toLowerCase())),
      mid: pctOf(spend, (x) => /p2$/.test(String(x.field).toLowerCase())),
      low: pctOf(spend, (x) => /p3$/.test(String(x.field).toLowerCase())),
      items: spend.items
    },
    spendIndex: { avg: indexAvg, total: indexTotal, items: indexItems },
    // 教育
    education: { total: edu.total, bachelorPlusPct: eduHigh.length ? (sum(eduHigh) / edu.total) * 100 : null, items: edu.items },
    // 职业（用户要的「职业」）
    occupation: { total: job.total, top: topJobs, items: job.items },
    // 人生阶段（家庭客群强相关）
    lifeStage: { total: life.total, marriedWithKidsPct: pctOf(life, (x) => x.label.includes('已婚已育')), items: life.items },
    // 收入 / 资产（用户要的「收入」）
    // 1015/1014 的概率档：p1=高 p2=中高 p3=中 p4=中低 p5=低 ⇒「高+中高」= p1|p2
    income: { total: income.total, highPlusPct: pctOf(income, isHighPlusField), items: income.items },
    car: { total: car.total, highPlusPct: pctOf(car, isHighPlusField) },
    house: { total: house.total, highPlusPct: pctOf(house, isHighPlusField) }
  }
}

/**
 * 一次算出三套口径 + 已购服务码清单。
 * @param {string|object} resultData purchases.result_data
 * @returns {{visit:object|null, live:object|null, work:object|null, services:string[]}}
 */
export function buildProfiles(resultData) {
  let summary = null
  try {
    summary = buildSummaryValues(resultData)
  } catch {
    summary = null
  }
  if (!summary) return { visit: null, live: null, work: null, services: [] }
  const services = Object.keys(summary).filter((c) => Object.keys(summary[c] || {}).length > 0)
  return {
    visit: buildProfile(summary, 0),
    live: buildProfile(summary, 1),
    work: buildProfile(summary, 2),
    services
  }
}

/**
 * 月驻留次数（1007，到访口径，无 popu_type）→ 「高频回头客占比」。
 * 含义见字典：reach1=1 次 / reach2=2-4 次 / reach3=5-10 次 / reach4=11-20 次 / reach5=20 次以上。
 * ⇒ 「5 次以上」= reach3+4+5，这是判断「这个点是过路还是常来」最直接的一项。
 */
export function buildReach(resultData) {
  let summary = null
  try {
    summary = buildSummaryValues(resultData)
  } catch {
    return null
  }
  const items = group(summary, '1007', ['reach1', 'reach2', 'reach3', 'reach4', 'reach5'])
  if (!items.length) return null
  const g = withPct(items)
  if (!(g.total > 0)) return null
  const heavy = g.items.filter((x) => ['reach3', 'reach4', 'reach5'].includes(String(x.field).toLowerCase()))
  return {
    total: g.total,
    heavyPct: heavy.length ? (sum(heavy) / g.total) * 100 : null,
    items: g.items
  }
}
