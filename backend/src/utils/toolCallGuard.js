/**
 * AI 工具调用折叠守卫 —— 单一权威（v1.13.169）
 *
 * 目的：把「同一轮里 同名 + 同参」的重复工具调用折叠为**一次执行**。
 *
 * 背景（2026-09-23 探针实测）：
 *   `doubao-seed-2-1-pro-260915`（v1.13.168 起线上模型）对**服务端只读工具**会偶发重复调用
 *   —— 例：问「对比上海和北京的人口」时 `query_city_data` 被调 2 次（3/3 复现）；
 *   旧模型 `doubao-seed-2-0-pro-260215` 未观察到该行为。
 *   而前端 `components/AiAssistant.vue:389` 是**逐个 `emit('execute', tc)`、无去重**，
 *   服务端 `routes/ai.js` 也是逐条执行 ⇒ 重复项会被重复执行（重复读库 / 重复弹窗 / 重复打高德）。
 *
 * ⚠️ 收益边际（别夸大）：折叠的是**执行**，不是 token —— 上游已经把 tool_calls 返回并计费，
 *    所以本模块**不省钱**。它省的是「服务端重复读库」「前端重复弹窗/重复导航/重复 POI 调用」，
 *    以及消除一类结构性缺口（前端无去重）。详见
 *    `workbuddy过程文件/Report4biz_AI工具调用折叠守卫_方案_20260923.md`。
 *
 * 🔴 铁律一：只折叠「完全等价」的调用。
 *    参数不同的同名调用**必须保留** —— 那是合法用法
 *    （例：「对比上海和北京的人口」会合法地产生两次 `query_city_data`，两次 city 不同）。
 *    失败方向必须是「不折叠」（＝退回改动前行为），绝不允许「错折叠」。
 *
 * 🔴 铁律二：折叠「执行」≠ 折叠「id」。
 *    OpenAI 协议的续轮要求**每个 `tool_call_id` 都有对应的 tool 消息**，
 *    少一条上游直接 400。所以调用方必须用 `aliasOf` 把重复项**映射回首条结果**，
 *    保持结果列表与原始 `tool_calls` **严格 1:1**。见 `routes/ai.js` 的 `toolResults` 构造。
 */

/**
 * 稳定序列化：递归按键名排序，消除 JSON key 顺序差异造成的假不等。
 * 不做任何类型归一（`"2"` 与 `2` 视为不同）—— 宁可少折叠，不可错折叠。
 */
export function canonicalArgs(args) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((o, k) => { o[k] = norm(v[k]); return o }, {})
    }
    return v
  }
  try {
    return JSON.stringify(norm(args === undefined ? {} : args))
  } catch (e) {
    return String(args)
  }
}

/**
 * 取「参数指纹」。上游 `function.arguments` 是 **JSON 字符串**，
 * 而前端/内部流转时可能是**对象** ⇒ 两种入参都必须能吃。
 * 非法 JSON 不抛异常，退化为原文比较（保守：可能少折叠，但不会错折叠）。
 */
function argsKey(raw) {
  if (typeof raw === 'string') {
    try {
      return canonicalArgs(JSON.parse(raw || '{}'))
    } catch (e) {
      return raw.trim()
    }
  }
  return canonicalArgs(raw)
}

/**
 * 折叠同一轮里「同名 + 同参」的重复工具调用。
 *
 * @param {Array} toolCalls 上游返回的 `choice.message.tool_calls`（原样传入，不做改造）
 * @returns {{ unique: Array, aliasOf: Map<string,string>, collapsed: number }}
 *   unique    首次出现的调用，**保持原顺序**、**对象原样**
 *   aliasOf   被折叠的 `tool_call.id` → 首次出现的 `tool_call.id`
 *   collapsed 折叠掉的条数（0 = 无重复）
 */
export function dedupeToolCalls(toolCalls) {
  const list = Array.isArray(toolCalls) ? toolCalls : []
  const unique = []
  const aliasOf = new Map()
  const firstIdByKey = new Map()

  for (const tc of list) {
    const key = `${tc?.function?.name}\u0000${argsKey(tc?.function?.arguments)}`
    const firstId = firstIdByKey.get(key)
    if (firstId !== undefined) {
      aliasOf.set(tc.id, firstId)
    } else {
      firstIdByKey.set(key, tc.id)
      unique.push(tc)
    }
  }

  return { unique, aliasOf, collapsed: list.length - unique.length }
}
