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
