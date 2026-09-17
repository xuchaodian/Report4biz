/**
 * 注册防护（v1.13.149 · P0 加固）
 *
 * 背景：`POST /api/auth/register` 原先只有「字段非空 + 密码≥6 + 重名」三道校验，
 * 且全项目无 rate-limit 依赖 ⇒ 可被脚本批量注册（每次注册成本 ≈ 一次 bcrypt）。
 *
 * 三道闸门（分层，互不替代；调用顺序见 routes/auth.js）：
 *   ① IP 滑动窗口限流   —— 挡高频（每 IP 每小时 REG_MAX_PER_IP 次）
 *   ② 表单票据（HMAC）  —— 挡「直接 POST 接口」的最简脚本：
 *        票据由 GET /api/auth/register-ticket 签发，内含签发时刻，
 *        服务端据此要求「填表耗时 ≥ REG_MIN_FILL_MS」。
 *        前端在拿到票据后同步禁用按钮 REG_MIN_FILL_MS 毫秒
 *        ⇒ 正常用户**永远不会**撞到 too_fast 这条线（零摩擦）。
 *   ③ 蜜罐字段          —— 挡「读完 form 结构后逐字段填」的脚本：
 *        命中时返回**假成功**（201 + 与真成功完全同形的回执）且不落库，
 *        不让攻击者拿到「被识别」的反馈。
 *        🔴 位置必须放在**全部正常校验之后、落库之前**（见 routes/auth.js ⑤）：
 *           否则攻击者可用「故意提交畸形字段 / 已知存在的用户名」探测出
 *           哪个字段是蜜罐，进而把它从脚本里摘掉 = 防护失效。
 *           同理 id 取「MAX(id)+小随机偏移」，避免出现真注册不可能有的超大 id
 *           或连续命中返回同一个 id（两者都是可识别的破绽）。
 *
 * ⚠️ 设计约束（勿改）：
 *   - 零第三方依赖（项目 CSP 严格 `script-src 'self'`，且约定禁外链 CDN）
 *   - 票据为 **HMAC 无状态**实现 ⇒ 不落库、不进内存 Map、不怕进程重启；
 *     子密钥由持久化的 JWT_SECRET 派生（`.jwt_secret` 文件），重启后旧票据仍有效
 *   - 蜜罐 input 用 `tabindex="-1"` + `aria-hidden="true"`：既不被 Tab 聚焦、
 *     也不进读屏（符合项目 a11y 约定），同时仍留在渲染树里供脚本命中
 */
import crypto from 'crypto'
import { JWT_SECRET } from '../config.js'

/** 限流窗口：1 小时 */
export const REG_WINDOW_MS = 60 * 60 * 1000
/** 每 IP 每窗口最多注册尝试次数（含失败；5 次对正常用户远远够用） */
export const REG_MAX_PER_IP = 5
/** 票据有效期：30 分钟（超时需刷新页面重取，避免长期挂着的页面被复用） */
export const REG_TICKET_TTL_MS = 30 * 60 * 1000
/** 表单最短停留：前端同步禁用按钮，正常用户撞不到 */
export const REG_MIN_FILL_MS = 1500
/** 蜜罐字段名：刻意用无意义名，避免被浏览器自动填充/密码管理器命中 */
export const REG_HONEYPOT_FIELD = 'hp_note'

const SIG_LEN = 32
// 子密钥：由 JWT_SECRET 派生（域分离，避免与 JWT 签名共用同一用途）
const TICKET_KEY = crypto.createHmac('sha256', JWT_SECRET)
  .update('r4b/register-ticket/v1')
  .digest()

function signTicketTs(ts) {
  return crypto.createHmac('sha256', TICKET_KEY).update(String(ts)).digest('hex').slice(0, SIG_LEN)
}

/** 签发票据：`<签发毫秒时间戳>.<HMAC 前 32 位>` */
export function issueRegisterTicket(now = Date.now()) {
  return `${now}.${signTicketTs(now)}`
}

/**
 * 校验票据。
 * @returns {{ok: true, age: number} | {ok: false, reason: 'missing'|'malformed'|'bad_sig'|'too_fast'|'expired', age?: number}}
 */
export function verifyRegisterTicket(ticket, now = Date.now()) {
  const raw = String(ticket || '')
  if (!raw) return { ok: false, reason: 'missing' }

  const dot = raw.indexOf('.')
  if (dot <= 0 || dot === raw.length - 1) return { ok: false, reason: 'malformed' }

  const ts = Number(raw.slice(0, dot))
  const sig = raw.slice(dot + 1)
  if (!Number.isFinite(ts) || ts <= 0 || sig.length !== SIG_LEN) {
    return { ok: false, reason: 'malformed' }
  }

  const expect = signTicketTs(ts)
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expect, 'utf8'))) {
    return { ok: false, reason: 'bad_sig' }
  }

  const age = now - ts
  if (age < REG_MIN_FILL_MS) return { ok: false, reason: 'too_fast', age }
  if (age > REG_TICKET_TTL_MS) return { ok: false, reason: 'expired', age }
  return { ok: true, age }
}

/**
 * 取客户端 IP。生产在 nginx 之后，真实来源是 X-Forwarded-For 的第一段
 * （与「忘记密码」原实现同口径）。
 */
export function clientIpOf(req) {
  const xff = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  return xff || req?.ip || 'unknown'
}

/**
 * 票据被拒时的对外文案。**不区分 missing/malformed/bad_sig**（统一为"请求无效"），
 * 避免给脚本提供"我该补哪一步"的线索。
 */
export const REG_TICKET_MESSAGES = {
  missing: '请求无效，请刷新页面后重试',
  malformed: '请求无效，请刷新页面后重试',
  bad_sig: '请求无效，请刷新页面后重试',
  too_fast: '提交过快，请确认信息后重试',
  expired: '页面停留过久，请刷新后重试'
}
