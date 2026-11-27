/**
 * 联通 Excel 导入记录：「报表原生长表」→ 分组结构 —— v1.13.427
 *
 * ── 背景（业主 2026-11-27 报的问题） ──────────────────────────────────────
 * 外部系统导出的这份 Excel 是**长表**：`A 请求编码 / B 分类 / C 字段名 / D 字段含义 / E 数量`，
 * 每一行都自带中文含义（实测 343 行里 D 列 100% 有值）。
 *
 * 而「查询结果详情」弹窗的所有专属渲染都是按**联通 API 的宽表结构**写的
 * （数组 + `popu_type` + `p1..pN`）。导入数据的结构对不上，就掉进"猜格式"分支：
 * 拿 key 里的数字猜人群、把同组数值相加当总计、查不到中文就印英文键 ⇒
 * 分组错位（「居住人口 1,399」其实是 3 个人的消费指数之和）、行名被拼成
 * 「消费力指数1_到访」、右栏留一堆空图框。
 *
 * ── 本模块的做法 ─────────────────────────────────────────────────────────
 * 不猜、不维护手工映射表：**直接用报表自己的中文**（B 分类 + D 含义）把长表切块。
 *  - 第一大层：B 分类（「人口汇总」「性别结构」「每小时段人口流量 工作日到访」…）
 *  - 第二层：人群（到访 / 居住 / 工作）。只在标签**以人群词开头**且成规模时才拆，
 *    否则 1005 那种「0-1点工作日小时到访人次」会被切碎。
 *  - 数值为 null 的行直接丢弃：报表没给数（如 1002 全码为空）就不出空表。
 *
 * ⚠️ 纯函数、无副作用：组件只负责拼 HTML（含转义），逻辑在这里可单测。
 */

export const POP_TYPES = ['到访', '居住', '工作']

/** 把「到访/居住/工作」前缀从中文含义里剥出来（1009~1016 都是这种写法） */
export function splitPopLabel(label) {
  const s = String(label == null ? '' : label).trim()
  for (const t of POP_TYPES) {
    if (s.startsWith(t)) return { pop: t, text: s.slice(t.length).trim() || s }
  }
  return { pop: '', text: s }
}

/** 分类名规整：报表里常带换行（「每小时段人口流量\n工作日到访」） */
export function cleanGroupTitle(g) {
  return String(g == null ? '' : g).replace(/\s+/g, ' ').trim()
}

/**
 * 去掉「服务名」前缀后的短标题。
 * 例：服务名「每小时段人口流量」+ 分类「每小时段人口流量 工作日到访」⇒「工作日到访」
 *     （否则图表标题会变成「每小时段人口流量 · 每小时段人口流量 工作日到访」）
 */
export function shortBlockTitle(codeName, title) {
  const t = cleanGroupTitle(title)
  const n = cleanGroupTitle(codeName)
  if (n && t.startsWith(n)) {
    const rest = t.slice(n.length).replace(/^[\s·:：\-_]+/, '')
    return rest || t
  }
  return t
}

/**
 * 把同一服务码的长表切成若干块（保留报表顺序）。
 *
 * @param {Array<{label?:string, key?:string, group?:string, value:number|null}>} rows
 * @returns {Array<{title:string, items:Array<{label:string, value:number}>}>}
 *          整码无数值 ⇒ 返回空数组（调用方据此整段不渲染，不出空表）
 */
export function splitReportBlocks(rows) {
  const groups = new Map()
  const order = []
  for (const r of rows || []) {
    if (!r || r.value == null || !Number.isFinite(Number(r.value))) continue
    const g = cleanGroupTitle(r.group) || '报表明细'
    if (!groups.has(g)) { groups.set(g, []); order.push(g) }
    groups.get(g).push(r)
  }

  const blocks = []
  for (const g of order) {
    const items = groups.get(g)
    const byPop = new Map()
    for (const it of items) {
      const { pop, text } = splitPopLabel(it.label || it.key)
      if (!byPop.has(pop)) byPop.set(pop, [])
      byPop.get(pop).push({ label: text, value: Number(it.value) })
    }
    const pops = POP_TYPES.filter((t) => byPop.has(t))
    const rest = byPop.get('') || []
    if (pops.length >= 2 && rest.length === 0) {
      // 纯人群维度 ⇒ 一个分类拆成 2~3 块；块标题只用人群（服务名已在段首标题里）
      for (const p of pops) blocks.push({ title: `${p}人口`, items: byPop.get(p) })
    } else {
      blocks.push({
        title: g,
        items: items.map((it) => ({ label: it.label || it.key, value: Number(it.value) }))
      })
    }
  }
  return blocks
}

/**
 * 按服务码分组（保持报表里的出现顺序）。
 * @param {Array<object>} rows
 * @param {string[]} excludeCodes 不参与展示的服务码（与详情弹窗既有排除表一致）
 * @returns {Array<{code:string, rows:Array<object>}>}
 */
export function groupRowsByCode(rows, excludeCodes = []) {
  const byCode = new Map()
  const order = []
  for (const r of rows || []) {
    if (!r || r.code == null || r.code === '') continue
    const code = String(r.code)
    if (excludeCodes.includes(code)) continue
    if (!byCode.has(code)) { byCode.set(code, []); order.push(code) }
    byCode.get(code).push(r)
  }
  return order.map((code) => ({ code, rows: byCode.get(code) }))
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.13.428：按报表键名还原「系统标准宽表结构」，直接复用既有渲染
//
// 427 用 B/D 中文出「指标 / 数值」两列表：分组对了，但**版式**仍与系统其它记录不同。
// 例如 1005，系统设计是「一张 24 行 × 5 列交叉表 + 2 张双折线图」，
// 导入记录却成了 96 行「指标 / 数值」+ 4 张横条图。
//
// 报表 C 列键名本身就带结构（`hour0_12_visit` = 工作日 12 点 · 到访），
// 所以这里**机械地**还原成联通 API 的宽表结构，再交给系统原有的
// `formatArrayData` / `buildChartOption` 渲染 ⇒ 版式、图例、图型与其它记录一致。
//
// 只做「键名 → 字段」的确定性转换，不猜含义：
//   1005 hour{0|1}_{hour}_{visit|all}   1007 reach{n}      1006 day_visit/day_all/stayN
//   1002 webtag{pop}_{n}                1009 spendpower{pop}_{level}
//   1010 edu{pop}_{level}               1011 job{pop}_{level}
//   1012 child{pop}_{level}             1013 consume{pop}_{level}
//   1014 cnsmablt{pop}_{level}          1015 income|car|house{pop}_{level}
// 认不出的码/键名返回 null ⇒ 调用方退回 427 的中文长表渲染（宁可朴素，不可错版）。
// ─────────────────────────────────────────────────────────────────────────────

/** 键名里的人群索引：0=到访 1=居住 2=工作（与 API 的 popu_type 同口径） */
const POP_NAMES = ['到访', '居住', '工作']

/** 报表「字段名」→ 矩阵前缀：前缀决定目标结构与最大档位 */
const MATRIX_PREFIX = {
  spendpower: { code: '1009', min: 1, max: 8, kind: 'spend' },
  edu: { code: '1010', min: 0, max: 4, kind: 'p', fname: '学历' },
  job: { code: '1011', min: 1, max: 10, kind: 'p' },
  child: { code: '1012', min: 1, max: 3, kind: 'p' },
  consume: { code: '1013', min: 1, max: 3, kind: 'p' },
  cnsmablt: { code: '1014', min: 1, max: 5, kind: 'p' },
  income: { code: '1015', min: 1, max: 5, kind: 'p', fname: '收入预测' },
  car: { code: '1015', min: 1, max: 5, kind: 'p', fname: '有车预测' },
  house: { code: '1015', min: 1, max: 5, kind: 'p', fname: '有房预测' }
}

const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const keyOf = (r) => String((r && r.key) || '').trim().toLowerCase()

/**
 * 1005：hour{0|1}_{hour}_{visit|all} → [{day_type, hour_period, hour_visit, hour_all}]
 * day_type 0=工作日 1=周末（API 同口径）。缺 all/visit 的行按 0 补，不臆造。
 */
function compat1005(items) {
  const map = new Map()
  for (const r of items) {
    const m = /^hour([01])_(\d{1,2})_(visit|all)$/.exec(keyOf(r))
    if (!m) continue
    const v = toNum(r.value)
    if (v == null) continue
    const day = Number(m[1])
    const hour = Number(m[2])
    const k = `${day}-${hour}`
    if (!map.has(k)) map.set(k, { day_type: day, hour_period: hour, hour_visit: 0, hour_all: 0 })
    const it = map.get(k)
    if (m[3] === 'visit') it.hour_visit = v
    else it.hour_all = v
  }
  if (!map.size) return null
  const data = [...map.values()].sort(
    (a, b) => a.day_type - b.day_type || a.hour_period - b.hour_period
  )
  return { code: '1005', data }
}

/**
 * 1002：webtag{pop}_{n} → [{popu_type, tag_name, tag_value}]
 * tag_name 取报表 D 列：去掉人群前缀与结尾「人数」，不用代码里那张老标签表
 * （报表版本会变，硬编码表迟早对不上）。
 */
function compat1002(items) {
  const data = []
  for (const r of items) {
    const m = /^webtag(\d)_(\d+)$/.exec(keyOf(r))
    const v = toNum(r.value)
    if (!m || v == null) continue
    let name = String(r.label || '').trim()
    for (const p of POP_NAMES) {
      if (name.startsWith(p)) { name = name.slice(p.length); break }
    }
    name = name.replace(/人数$/, '').trim()
    if (!name) name = String(r.key || '')
    data.push({ popu_type: Number(m[1]), tag_name: name, tag_value: v })
  }
  return data.length ? { code: '1002', data } : null
}

/**
 * 1006：报表只给「月均」7 个值（无逐日明细）⇒ 还原成一条 day_type 缺省的对象，
 * 走系统同一张「指标 / 数值」表与 1006-a「日均值」图。
 * 兼容两种导出键名：day_visit/day_all/stay1..5 与 day_avg_visit/day_avg_total/stay_30..
 */
function compat1006(items) {
  const alias = { day_avg_visit: 'day_visit', day_avg_total: 'day_all', day_avg_all: 'day_all' }
  const stayAlias = {
    stay_30: 'stay1', stay_60: 'stay2', stay_120: 'stay3', stay_240: 'stay4', stay_480: 'stay5'
  }
  const direct = new Set(['day_visit', 'day_all'])
  const obj = {}
  for (const r of items) {
    const k = keyOf(r)
    const v = toNum(r.value)
    if (v == null) continue
    const field = alias[k] || stayAlias[k]
      || (direct.has(k) ? k : null)
      || (/^stay\d+$/.test(k) ? k : null)
    if (!field) continue
    obj[field] = v
  }
  if (obj.day_visit === undefined && obj.day_all === undefined && obj.stay1 === undefined) return null
  return { code: '1006', data: [obj] }
}

/** 1007：reach1..n → [{reach1..reachN}] */
function compat1007(items) {
  const obj = {}
  let hit = 0
  for (const r of items) {
    const m = /^reach(\d+)$/.exec(keyOf(r))
    const v = toNum(r.value)
    if (!m || v == null) continue
    obj[`reach${Number(m[1])}`] = v
    hit++
  }
  return hit ? { code: '1007', data: [obj] } : null
}

/**
 * 1009~1015：{prefix}{pop}_{level} → 标准宽表
 *  - spend：每档一条 {popu_type, spendpower, spendpower_value}（1009 的表/图按此逐档取）
 *  - p：每个 pop 一条 {popu_type, p1..pN}（缺失档位补 0，保证表里档位齐全且分支能命中）
 */
function compatMatrix(items) {
  const buckets = new Map() // prefix → Map<pop, Map<level, value>>
  for (const r of items) {
    const m = /^(spendpower|edu|job|child|consume|cnsmablt|income|car|house)(\d)_(\d+)$/.exec(keyOf(r))
    if (!m) continue
    const v = toNum(r.value)
    if (v == null) continue
    if (!buckets.has(m[1])) buckets.set(m[1], new Map())
    const pops = buckets.get(m[1])
    const pop = Number(m[2])
    if (!pops.has(pop)) pops.set(pop, new Map())
    pops.get(pop).set(Number(m[3]), v)
  }
  if (!buckets.size) return null

  // 同一码里可能并存多种前缀：资产预测 = income / car / house 三段（老导出甚至拆到
  // 1014/1015/1016）。只要它们指向同一个目标码就一起还原，各段靠 fname 区分。
  const metas = [...buckets.keys()].map((p) => MATRIX_PREFIX[p]).filter(Boolean)
  if (metas.length !== buckets.size) return null
  const codes = new Set(metas.map((m) => m.code))
  if (codes.size !== 1) return null // 比如 spendpower + edu 混在一个码里 ⇒ 结构说不清
  const code = metas[0].code

  const data = []
  for (const [prefix, pops] of buckets) {
    const meta = MATRIX_PREFIX[prefix]
    for (const pop of [...pops.keys()].sort((a, b) => a - b)) {
      const levels = pops.get(pop)
      if (meta.kind === 'spend') {
        for (let n = meta.min; n <= meta.max; n++) {
          data.push({ popu_type: pop, spendpower: String(n), spendpower_value: levels.get(n) || 0 })
        }
      } else {
        const item = { popu_type: pop }
        if (meta.fname) item.fname = meta.fname // 教育/资产的表按 fname 分组，缺了会掉进兜底
        for (let n = meta.min; n <= meta.max; n++) item[`p${n}`] = levels.get(n) || 0
        data.push(item)
      }
    }
  }
  return { code, data }
}

/** 单个服务码 → 标准结构；认不出返回 null */
export function buildCompatForCode(code, rows) {
  const items = (rows || []).filter((r) => r && toNum(r.value) != null)
  if (!items.length) return null
  switch (String(code)) {
    case '1002': return compat1002(items)
    case '1005': return compat1005(items)
    case '1006': return compat1006(items)
    case '1007': return compat1007(items)
    default: {
      const m = compatMatrix(items)
      // 前缀决定目标码：老导出把「收入/有车/有房」拆成 1014/1015/1016，这里统一回 1015
      return m ? { code: m.code, data: m.data } : null
    }
  }
}

/** 该人群是否有非零值（决定要不要出这张图，避免空图框） */
function hasPop(data, pop, skip = ['popu_type', 'spendpower', 'fname']) {
  return data.some((d) => d.popu_type === pop && Object.keys(d).some(
    (k) => !skip.includes(k) && Number(d[k]) > 0
  ))
}

/**
 * 图表清单：与系统原有 `buildChartList` 逐条对齐（标题、chartKey 都照抄），
 * 只按「报表能给的数据」裁剪——报表没有逐日明细就不出「月度累计」图。
 */
export function chartsFor(code, data) {
  const c = String(code)
  const item = (chartKey, title) => ({ serviceCode: c, chartKey, title })
  if (c === '1002') {
    return [
      hasPop(data, 0) && item('1002-a', '上网标签分布 - 到访'),
      hasPop(data, 1) && item('1002-b', '上网标签分布 - 居住'),
      hasPop(data, 2) && item('1002-c', '上网标签分布 - 工作')
    ].filter(Boolean)
  }
  if (c === '1005') {
    return [item('1005-a', '每小时段流量 - 到访'), item('1005-b', '每小时段流量 - 全量')]
  }
  // 1006 报表只有月均值：-b「月度累计」需要逐日数据，报表给不了 ⇒ 只出 -a
  if (c === '1006') return [item('1006-a', '每日人流量 - 日均值')]
  if (c === '1007') return [item('1007', '每月到达次数分布')]
  if (c === '1009') {
    return [
      (hasPop(data, 1) || hasPop(data, 2)) && item('1009-a', '消费水平 - 居住+工作'),
      hasPop(data, 0) && item('1009-b', '消费水平 - 到访')
    ].filter(Boolean)
  }
  if (c === '1010') {
    return [
      (hasPop(data, 1) || hasPop(data, 2)) && item('1010-a', '教育水平 - 居住+工作'),
      hasPop(data, 0) && item('1010-b', '教育水平 - 到访')
    ].filter(Boolean)
  }
  if (c === '1011') {
    return [
      (hasPop(data, 1) || hasPop(data, 2)) && item('1011-a', '行业分布 - 居住+工作'),
      hasPop(data, 0) && item('1011-b', '行业分布 - 到访')
    ].filter(Boolean)
  }
  if (c === '1012') return [item('1012', '人生阶段分布')]
  if (c === '1013') return [item('1013', '综合消费能力预测')]
  if (c === '1014') return [] // 系统里 1014 的图本来就是隐藏的
  if (c === '1015') {
    return [
      hasPop(data, 0) && item('1015-a', '资产预测 - 到访'),
      hasPop(data, 1) && item('1015-b', '资产预测 - 居住'),
      hasPop(data, 2) && item('1015-c', '资产预测 - 工作')
    ].filter(Boolean)
  }
  return []
}

/** 同一目标码被多个源码拆开时合并数据（老导出：1014/1015/1016 = 收入/有车/有房） */
function mergeCompat(code, a, b) {
  if (code === '1015' || code === '1002') {
    const seen = new Set(a.map((d) => `${d.popu_type}|${d.fname || d.tag_name || ''}`))
    return a.concat(b.filter((d) => !seen.has(`${d.popu_type}|${d.fname || d.tag_name || ''}`)))
  }
  const byPop = new Map(a.map((d) => [d.popu_type, d]))
  for (const d of b) byPop.set(d.popu_type, d)
  return [...byPop.values()].sort((x, y) => x.popu_type - y.popu_type)
}

/**
 * 整条记录 → 标准结构清单（按报表里首次出现的顺序）。
 * @returns {Array<{code:string, data:Array<object>, charts:Array<{serviceCode,chartKey,title}>, sources:string[]}>}
 */
export function buildCompatMap(rows, excludeCodes = []) {
  const entries = []
  const byTarget = new Map()
  for (const { code, rows: codeRows } of groupRowsByCode(rows, excludeCodes)) {
    const c = buildCompatForCode(code, codeRows)
    if (!c) continue
    const found = byTarget.get(c.code)
    if (found) {
      found.data = mergeCompat(c.code, found.data, c.data)
      found.sources.push(code)
    } else {
      const entry = { code: c.code, data: c.data, charts: [], sources: [code] }
      byTarget.set(c.code, entry)
      entries.push(entry)
    }
  }
  for (const e of entries) e.charts = chartsFor(e.code, e.data)
  return entries
}
