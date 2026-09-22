// ============================================================================
// AI 提问留痕（v1.13.165）—— 数据驱动「本机操作指引（FAQ）」的前置
// ----------------------------------------------------------------------------
// 需求（用户原话，2026-09-22）：
//   「FAQ 命中率数据驱动 — 新增『提问原文落库』吧」
//
// 背景：v1.13.163/164 的 FAQ 是在**浏览器本地**匹配的 —— 命中即返回卡片，
//       **一个请求都不发**（也不消耗豆包额度）。代价是服务端对命中情况完全无感：
//         · 命中了多少条、命中率多少 ⇒ 服务端拿不到（分母在浏览器里）
//         · 哪些问法**没被拦住** ⇒ 以前也拿不到（只在 pm2 日志里一闪而过）
//       本模块先补上后者 —— 因为「该补哪条指引」正是靠**没拦住的问法**来发现。
//
// ★ 本表记的是什么：**通过了额度闸门、且问法非空的 /api/ai/chat 请求**。
//   等价于「FAQ 没拦住的真实提问」，即：
//     候选池   = 本表按主题归并后的高频问法
//     漏拦率   = 本表里「本就该由指引回答」的问法占比（人工判读，见附录 §6.17）
//   绝对命中率仍**需要前端上报**（见「遗留」），本模块刻意不引入任何新请求。
//
// 🔴 隐私边界（本项目最高优先级红线：禁止跨账号数据聚合，含匿名化）：
//     ① 只存**提问文本**，不存 context 内容 —— context 里可能带门店/城市等业务数据，
//        这里只用 has_context 记「有没有带」；
//     ② 不存 IP / UA / 回答内容 / 工具调用明细；
//     ③ **本期不提供任何跨账号的原文读取接口**：汇总只走「归并后的问法模式」，
//        原始行仅在本机库内、由 owner 侧只读分析（与 156 可见域同一克制思路）。
//
// ⚠️ 落点位置有讲究（调用方必须遵守，routes/ai.js 已注明）：
//     闸门之后（被 403/429 拒的请求零写入，「空 body 连打」仍是零成本验证手段）
//     → body 校验之后（无问法不落库）
//     → 同问缓存之前（**重复提问也要留痕**：重复本身就是「该加指引」的最强信号）
//     → 调上游之前（上游失败也留痕）
//
// ⚠️ 副作用：写入走 sql.js `run()` ⇒ 非事务态自动整库落盘（同 ai_usage 记账）。
//     量级可控：每账号日上限 100 次（AI_DAILY_CALL_LIMIT），即最坏 100 行/账号/日。
// ============================================================================
import { AI_QUESTION_MAX_CHARS } from './aiQuota.js'

/** 把 content（字符串 / 多段块数组）拍平成纯文本 */
function contentToText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(p => (typeof p === 'string' ? p : (p && typeof p.text === 'string' ? p.text : '')))
      .join(' ')
  }
  return ''
}

/**
 * 取「最后一次用户发言」作为问法原文。
 * 取最后一条而非第一条：续问（"那再看上海的"）才是本次真正要执行的意图，
 * 且它同样是「FAQ 该不该拦」的判据来源。
 * @param {Array} messages 已过 truncateMessages 的对话数组
 * @returns {string} 未归一化的原文（无用户发言时返回 ''）
 */
export function extractQuestion(messages) {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'user') continue
    const text = contentToText(m.content)
    if (text) return text
  }
  return ''
}

/**
 * 归一化 + 截断：折掉换行/连续空白（问法本质是一行），超长只留前 N 字符。
 * 只留**前**段而非后段：粘进来的长文（地址清单、表格）尾部才是噪声，问法总在头部。
 */
export function normalizeQuestion(text, maxChars = AI_QUESTION_MAX_CHARS) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  return t.length > maxChars ? t.slice(0, maxChars) : t
}

/**
 * 落库一条提问留痕。
 * @param {Object} db   sql.js 库句柄（由调用方传入，便于测试与手动挂载）
 * @param {Object} opt
 * @param {number} opt.userId
 * @param {string} [opt.endpoint='chat']
 * @param {Array}  [opt.messages]  已过 truncateMessages 的对话
 * @param {Object} [opt.context]   **只取「有没有」，内容不入库**
 * @returns {{len:number, msgCount:number, hasContext:number}|null} 落库成功返回概要，跳过/失败返回 null
 */
export function logAiQuestion(db, { userId, endpoint = 'chat', messages, context } = {}) {
  try {
    const uid = Number(userId)
    if (!db || !uid) return null

    // 空 / 纯空白问法不落库 ⇒ 与「闸门先于 body 校验」配合，空 body 连打 0 写入
    const text = normalizeQuestion(extractQuestion(messages))
    if (!text) return null

    const ep = String(endpoint || 'chat')
    const msgCount = Array.isArray(messages) ? messages.length : 0
    const hasContext = context && typeof context === 'object' && Object.keys(context).length > 0 ? 1 : 0

    db.prepare(
      `INSERT INTO ai_questions (user_id, endpoint, question_text, question_len, msg_count, has_context)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uid, ep, text, text.length, msgCount, hasContext)

    // ⚠️ 只打长度与计数，**绝不打原文** —— pm2 日志会落盘并轮转，
    //    用户问法（含门店/城市）不该顺着日志流出库外。
    console.log(`[AI-Q] user=${uid} endpoint=${ep} len=${text.length} turns=${msgCount} ctx=${hasContext}`)
    return { len: text.length, msgCount, hasContext }
  } catch (e) {
    // 🔴 留痕失败绝不影响主流程：AI 问答的可用性优先于统计。
    //    （典型失败：老库缺表 —— 本地库未随代码升级时会出现，属可接受降级）
    console.error('[AI] 记录提问失败:', e.message)
    return null
  }
}
