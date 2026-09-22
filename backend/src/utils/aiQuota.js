// ============================================================================
// AI（豆包）额度与刹车 —— 唯一权威闸门
// ----------------------------------------------------------------------------
// 背景（2026-09-21 只读审计）：
//   原先的 `checkAIAccess` 判据是**联通**配额（users.quota − Σ purchases.quota_used），
//   与豆包花费毫无关系。两本账耦合出两个荒谬后果：
//     ① 联通池为 0 ⇒ AI 全站 403（连 admin 也打不开，2026-09-07 起停摆）
//     ② 联通额度给得大 ⇒ AI 顺带被放开，而 AI 侧零限制（无限速/无日上限/无熔断）
//   本文件把 AI 的可用性收回「AI 自己的账」，并补上刹车。
//
// ★ 分层：
//   L0 解耦  门槛判据 = 本文件统计的 **AI 调用次数**，与联通 quota 彻底脱钩
//   L1 额度  admin 不限 ｜ vip 1000 次/月 ｜ trial 50 次/月 ｜ 其他 100 次/月
//   L2 刹车  分钟限速 10 ｜ 日上限 100 ｜ 全局月度 token 熔断 ≈¥200 ｜ 输入截断
//
// ★ 次数口径 = `ai_usage.endpoint IN ('chat','site-advice')`
//   一次问答算 1 次。服务端工具触发的第 2 次上游记为 'chat-followup'，
//   只贡献 token 不贡献次数（否则一次问答会被算成 2 次）。
//
// ⚠️ 内存态（分钟限速）依赖单进程：线上 `webgis-backend` 为 pm2 `fork_mode` 单实例。
//    若将来改 cluster 模式，须把限速改为持久化存储。
// ⚠️ 时间边界：SQLite `CURRENT_TIMESTAMP` 存 **UTC**，因此本文件把「本地零点」
//    换算成 UTC 字符串再比较（dayStartStamp/monthStartStamp），否则日上限会在上午 8 点重置。
// ============================================================================

/** 角色 → 月度调用次数上限（`Infinity` = 不限） */
export const AI_ROLE_CALL_LIMIT = { admin: Infinity, vip: 1000, trial: 50, user: 100 }

/** 每账号每日调用次数上限 */
export const AI_DAILY_CALL_LIMIT = 100

/** 每账号每分钟调用次数上限（防脚本刷）
 *  可用环境变量 `AI_RATE_PER_MINUTE` 覆盖 —— 便于上线后在不改代码的前提下调参（放宽/收紧防刷强度）。 */
export const AI_RATE_PER_MINUTE = (() => {
  const n = Number(process.env.AI_RATE_PER_MINUTE)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10
})()

/** 单次请求 messages 总字符预算（超出则从最早的消息开始丢弃） */
export const AI_MAX_INPUT_CHARS = 12000

/** 单次请求 context 字符预算（超出直接置空，防绕过前端瘦身） */
export const AI_MAX_CONTEXT_CHARS = 4000

/** 全局月度 token 熔断阈值 —— 混合价 5.76 元/百万 tok（输入 3.2×0.8 + 输出 16×0.2）反推 ¥200 */
export const AI_GLOBAL_MONTHLY_TOKEN_CAP = 34_720_000

/** 全局月度费用熔断阈值（元，仅用于文案） */
export const AI_GLOBAL_MONTHLY_YUAN_CAP = 200

/** 计入「一次问答」的 endpoint —— 其余只贡献 token 不贡献次数 */
export const AI_COUNTED_ENDPOINTS = ['chat', 'site-advice']

// ============================================================================
// L3 降本旋钮（v1.13.162）—— 同样收敛在此文件，避免 magic number 散落在路由里
// ----------------------------------------------------------------------------
// 实测（2026-09-21 实价探针，7 次对照调用）：
//   单次调用 prompt ≈ 3889 tok、completion 67~1500 tok ⇒ **prompt 占总成本约 88%**
//   其中 systemPrompt 1573 字符 + 20 个工具 schema 7378 字符 = 固定前缀 ≈ 8951 字符
// 由此决定三件事：① 输出必须封顶（原 1500 硬编码可被撞满，实测 finish=length、耗时 26s、成本 ×2.4）
//              ② systemPrompt 里「可服务端拼接」的指令一律搬走（每次调用都省）
//              ③ 完全相同的请求直接复用结果（0 成本）
// ============================================================================

/** 单次回复的输出 token 上限（前端请求值也在此封顶） */
export const AI_MAX_OUTPUT_TOKENS = (() => {
  const n = Number(process.env.AI_MAX_OUTPUT_TOKENS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1000
})()

/** 调用方未显式指定时的默认输出上限（与前端 AiAssistant.vue 请求的 800 对齐） */
export const AI_DEFAULT_OUTPUT_TOKENS = 800

/**
 * 归一化调用方给的 max_tokens：非法/缺失 → 默认值；超上限 → 封顶。
 * 抽成单一函数供各 AI 端点共用（派生值两处各写一份迟早分裂）。
 */
export function normalizeMaxTokens(value, fallback = AI_DEFAULT_OUTPUT_TOKENS) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return Math.min(fallback, AI_MAX_OUTPUT_TOKENS)
  return Math.min(Math.floor(n), AI_MAX_OUTPUT_TOKENS)
}

/** 同问短时缓存 TTL（毫秒）；0 = 关闭缓存。可用 `AI_CACHE_TTL_MS` 覆盖。 */
export const AI_CACHE_TTL_MS = (() => {
  const raw = process.env.AI_CACHE_TTL_MS
  if (raw === undefined || raw === '') return 10 * 60 * 1000
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10 * 60 * 1000
})()

/** 同问缓存最多保留的条目数（LRU 淘汰，防内存无界增长） */
export const AI_CACHE_MAX_ENTRIES = 200

// ============================================================================
// 提问留痕旋钮（v1.13.165）—— 数据驱动 FAQ 的前置采集
// ----------------------------------------------------------------------------
// 前端「本机操作指引」（faqMatch.js）命中即在浏览器本地返回，请求到不了服务端，
// 所以服务端能记下的**天然只有「FAQ 没拦住的问法」** —— 这正是补条目的候选池。
// 单条按 AI_QUESTION_MAX_CHARS 截断：问法一般 <40 字，超出基本是**粘进来的表格/地址清单**，
// 截断既不丢问法本身，也防把库撑大（库是整库落盘的 sql.js，行长直接换算成磁盘写量）。
// ============================================================================

/** 单条提问落库的字符上限（超出截断）—— 可用 `AI_QUESTION_MAX_CHARS` 覆盖 */
export const AI_QUESTION_MAX_CHARS = (() => {
  const n = Number(process.env.AI_QUESTION_MAX_CHARS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500
})()

/** 混合单价（元/token）：输入 3.2、输出 16 元每百万，按 80/20 入出比折算 */
const YUAN_PER_TOKEN_BLENDED = (0.8 * 3.2 + 0.2 * 16) / 1_000_000

const pad2 = (n) => String(n).padStart(2, '0')

/** Date → SQLite 风格 UTC 字符串 `YYYY-MM-DD HH:MM:SS` */
function toUtcStamp(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
}

/** 本地当月 1 日 00:00 对应的 UTC 字符串 */
export function monthStartStamp(now = new Date()) {
  return toUtcStamp(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0))
}

/** 本地当日 00:00 对应的 UTC 字符串 */
export function dayStartStamp(now = new Date()) {
  return toUtcStamp(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0))
}

/**
 * VIP 是否在有效期内（管理员视为 VIP）。
 * ★ 原为 `routes/ai.js` 内联两份逻辑，按项目铁律抽成单一函数供多处共用。
 */
export function isVipActive(user, now = new Date()) {
  if (!user) return false
  if (user.role !== 'vip' && user.role !== 'admin') return false
  if (!user.vip_until) return true
  return new Date(String(user.vip_until) + 'T23:59:59') >= now
}

export function isAdmin(user) {
  return !!user && user.role === 'admin'
}

/** 角色 → 月额度（vip 已过期按普通用户对待） */
export function aiCallLimitFor(user) {
  if (isAdmin(user)) return Infinity
  if (isVipActive(user)) return AI_ROLE_CALL_LIMIT.vip
  if (user && user.role === 'trial') return AI_ROLE_CALL_LIMIT.trial
  return AI_ROLE_CALL_LIMIT.user
}

/** 额度文案：不限 / N 次 */
export function describeLimit(limit) {
  return limit === Infinity ? '不限' : `${limit} 次`
}

/**
 * 读取闸门所需的用户字段（每次都现查，保证改角色/改到期日立即生效）。
 * @returns {{id:number, username:string, role:string, vip_until:string|null}|null}
 */
export function loadAiUser(db, userId) {
  const uid = Number(userId)
  if (!uid) return null
  return db.prepare('SELECT id, username, role, vip_until FROM users WHERE id = ?').get(uid) || null
}

function countedSql() {
  return AI_COUNTED_ENDPOINTS.map(() => '?').join(',')
}

/** 本月已用次数（只数「一次问答」，followup 不计） */
export function getMonthlyCalls(db, userId, now = new Date()) {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM ai_usage
      WHERE user_id = ? AND created_at >= ? AND endpoint IN (${countedSql()})`
  ).get(userId, monthStartStamp(now), ...AI_COUNTED_ENDPOINTS)
  return row?.n || 0
}

/** 今日已用次数 */
export function getDailyCalls(db, userId, now = new Date()) {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM ai_usage
      WHERE user_id = ? AND created_at >= ? AND endpoint IN (${countedSql()})`
  ).get(userId, dayStartStamp(now), ...AI_COUNTED_ENDPOINTS)
  return row?.n || 0
}

/** 全站本月 token 总量（熔断用） */
export function getGlobalMonthlyTokens(db, now = new Date()) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(tokens_used), 0) AS n FROM ai_usage WHERE created_at >= ?`
  ).get(monthStartStamp(now))
  return row?.n || 0
}

/** token → 元（估算，仅供文案与熔断换算） */
export function tokensToYuan(tokens) {
  return (Number(tokens) || 0) * YUAN_PER_TOKEN_BLENDED
}

// ---- 分钟限速（进程内滑动窗口；重启即清空，与项目既有 warnedLevels 同思路） ----
const rateBuckets = new Map()

/** 仅供测试：清空限速状态 */
export function resetRateBuckets() {
  rateBuckets.clear()
}

/**
 * 滑动窗口限速。**命中即记账**（被拒的请求也占额度，避免重试风暴）。
 * @returns {{ok:true}|{ok:false, retryAfterSec:number}}
 */
export function checkRate(userId, nowMs = Date.now()) {
  const arr = (rateBuckets.get(userId) || []).filter((ts) => nowMs - ts < 60_000)
  if (arr.length >= AI_RATE_PER_MINUTE) {
    rateBuckets.set(userId, arr)
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((60_000 - (nowMs - arr[0])) / 1000)) }
  }
  arr.push(nowMs)
  rateBuckets.set(userId, arr)
  return { ok: true }
}

/**
 * 按字符预算截断对话历史：从**最近**往前累加，超预算即停（近端上下文优先）。
 * 单条即超预算时保留其**尾部**（用户的提问通常在末尾），而不是整条丢弃。
 */
export function truncateMessages(messages, maxChars = AI_MAX_INPUT_CHARS) {
  if (!Array.isArray(messages)) return []
  const kept = []
  let total = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || typeof m.content !== 'string') continue
    const len = m.content.length
    if (total + len > maxChars) {
      if (kept.length === 0) {
        kept.unshift({ ...m, content: m.content.slice(-maxChars) })
      }
      break
    }
    total += len
    kept.unshift(m)
  }
  return kept
}

/** context 瘦身：超预算直接置空（前端本就只传 3 个字段，此处防绕过） */
export function slimContext(context, maxChars = AI_MAX_CONTEXT_CHARS) {
  if (!context || typeof context !== 'object') return null
  try {
    return JSON.stringify(context).length > maxChars ? null : context
  } catch (e) {
    return null
  }
}

function deny(code, message, extra = {}) {
  return { allowed: false, code, message, ...extra }
}

/**
 * ★ 唯一主闸门。判定顺序（顺序有意义）：
 *   账号存在 → 全局熔断（admin 豁免）→ 月额度 → 日上限 → 分钟限速（记账）
 * 把限速放在最后，是为了让「额度用尽」的提示稳定可复现，不被打成「操作太快」。
 *
 * @param {Object} db
 * @param {Object|null} user  `loadAiUser()` 的结果
 * @param {Date}   [now]
 * @returns {{allowed:true, role:string, limit:number, unlimited:boolean,
 *            monthlyCalls:number, dailyCalls:number, globalTokens:number}
 *          | {allowed:false, code:string, message:string, retryAfterSec?:number}}
 */
export function checkAiBudget(db, user, now = new Date()) {
  if (!user) return deny('user_missing', '账号不存在')

  const globalTokens = getGlobalMonthlyTokens(db, now)
  if (!isAdmin(user) && globalTokens >= AI_GLOBAL_MONTHLY_TOKEN_CAP) {
    return deny(
      'global_budget',
      `本月全站 AI 用量已达预算上限（约 ¥${AI_GLOBAL_MONTHLY_YUAN_CAP}），AI 助手已临时停用，下月 1 日自动恢复。如需继续使用请联系管理员。`
    )
  }

  const limit = aiCallLimitFor(user)

  if (limit === Infinity) {
    const rate = checkRate(user.id, now.getTime())
    if (!rate.ok) {
      return deny('rate_limited', `AI 助手每分钟最多 ${AI_RATE_PER_MINUTE} 次，请 ${rate.retryAfterSec} 秒后再试`, { retryAfterSec: rate.retryAfterSec })
    }
    return {
      allowed: true,
      role: user.role,
      limit,
      unlimited: true,
      monthlyCalls: getMonthlyCalls(db, user.id, now),
      dailyCalls: getDailyCalls(db, user.id, now),
      globalTokens
    }
  }

  const monthlyCalls = getMonthlyCalls(db, user.id, now)
  if (monthlyCalls >= limit) {
    return deny(
      'monthly_exhausted',
      `本月 AI 助手额度已用完（${limit} 次），下月 1 日自动重置。`
    )
  }

  const dailyCalls = getDailyCalls(db, user.id, now)
  if (dailyCalls >= AI_DAILY_CALL_LIMIT) {
    return deny(
      'daily_exhausted',
      `今日 AI 助手使用已达上限（${AI_DAILY_CALL_LIMIT} 次），请明天再试。`
    )
  }

  const rate = checkRate(user.id, now.getTime())
  if (!rate.ok) {
    return deny('rate_limited', `AI 助手每分钟最多 ${AI_RATE_PER_MINUTE} 次，请 ${rate.retryAfterSec} 秒后再试`, { retryAfterSec: rate.retryAfterSec })
  }

  return { allowed: true, role: user.role, limit, unlimited: false, monthlyCalls, dailyCalls, globalTokens }
}
