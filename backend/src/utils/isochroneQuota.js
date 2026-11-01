/**
 * 可达范围（驾车/步行）的配额与并发闸门（v1.13.307）
 *
 * 背景（业主 2026-11-01 拍板）：可达范围按「免费给图、付费给数」开放，
 *   但高德这个 key 的 QPS 极紧（并发 2 就 10021），所以必须同时管住三件事：
 *     ① 每日次数（钱）—— 每探测一次 = 3 次高德调用，落库按天计。
 *     ② 单账号串行（连点）—— 同一账号已有探测在跑，直接 429，不排队烧钱。
 *     ③ 全局串行（QPS）—— 全程只允许 1 个探测在跑，其余排队；否则大家一起失败。
 *
 * 🔴 为什么每日次数要落库、而不是用 utils/rateLimit.js 的内存窗口：
 *   进程重启内存清零 ⇒ 等于「重启即白送额度」；而且后台完全看不到用量。
 *
 * 🔴🔴 trial 必须排在 isVipActive **之前**（同 aiQuota.js 的教训）：
 *   `isVipActive` 把 trial 也算作 VIP 权益生效，若顺序颠倒，trial 会顺着 vip 分支
 *   拿到 30 次（业主定的是 5 次）—— 不报错、不红灯，只是额度悄悄放大 6 倍。
 *   已由 tests/isochroneQuota.test.js 钉死。
 */
import { getDb } from '../models/database.js'
import { isVipActive } from './aiQuota.js'

/** 每日探测次数上限（业主定：免费/试用 5 次，VIP 30 次，管理员不限） */
export const ISO_DAILY_LIMIT = { free: 5, vip: 30 }

/**
 * 档位判定：admin / vip / free
 * ⚠️ 顺序即规则，见文件头。
 */
export function tierOf(user) {
  if (!user) return 'free'
  if (user.role === 'admin') return 'admin'
  if (user.role === 'trial') return 'free'
  return isVipActive(user) ? 'vip' : 'free'
}

/** 该用户每日上限；管理员返回 Infinity（不记账） */
export function limitFor(user) {
  const tier = tierOf(user)
  return tier === 'admin' ? Infinity : ISO_DAILY_LIMIT[tier]
}

/** 本地（Asia/Shanghai）日键 `YYYY-MM-DD` —— 与 aiQuota 的「本地当日」口径一致 */
export function dayKey(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** 今日已用次数 */
export function usedToday(userId, now = new Date()) {
  const db = getDb()
  const row = db.prepare('SELECT count FROM isochrone_usage WHERE user_id = ? AND day = ?').get(userId, dayKey(now))
  return Number(row?.count) || 0
}

/** 今日余量（管理员为 Infinity） */
export function remainingFor(user, now = new Date()) {
  const limit = limitFor(user)
  if (limit === Infinity) return { tier: 'admin', limit: Infinity, used: 0, remaining: Infinity }
  const used = usedToday(user.id, now)
  return { tier: tierOf(user), limit, used, remaining: Math.max(0, limit - used) }
}

/**
 * 扣一次额度。
 * @returns {{tier:string, limit:number, used:number, remaining:number}|null} 超限返回 null（**不扣**）
 */
export function consume(user, now = new Date()) {
  const limit = limitFor(user)
  if (limit === Infinity) return { tier: 'admin', limit: Infinity, used: 0, remaining: Infinity }

  const used = usedToday(user.id, now)
  if (used >= limit) return null

  const db = getDb()
  const day = dayKey(now)
  db.prepare(`
    INSERT INTO isochrone_usage (user_id, day, count, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1, updated_at = datetime('now')
  `).run(user.id, day)

  return { tier: tierOf(user), limit, used: used + 1, remaining: Math.max(0, limit - used - 1) }
}

// ============================================================================
// 并发闸门
// ============================================================================
const runningUsers = new Set()

/** 抢占「该账号正在探测」的锁；已被占则返回 false */
export function tryLockUser(userId) {
  if (runningUsers.has(userId)) return false
  runningUsers.add(userId)
  return true
}

export function unlockUser(userId) {
  runningUsers.delete(userId)
}

let chain = Promise.resolve()

/**
 * 全局串行执行（QPS 兜底）。
 * 🔴 高德距离测量并发 2 就 10021；这里让所有探测排成一条队，
 *    前端要显式告知「排队中」，⛔ 不要静默让用户干等。
 */
export function runSerial(task) {
  const next = chain.then(task, task)
  chain = next.then(() => {}, () => {})
  return next
}

/** 仅供测试：清空并发状态 */
export function resetIsochroneState() {
  runningUsers.clear()
  chain = Promise.resolve()
}

// ============================================================================
// 范围凭证（v1.13.307）
//
// 🔴 为什么必须有：免费档本来只允许「看轮廓 + 人口总数」，但如果放任它随手 POST
//   一个自造多边形去调 calculate-population，那 5 次/日的额度形同虚设 ——
//   客户可以无限次取样，把城市人口摸个遍，等于绕过「付费给数」。
//
// 做法：探测成功时签发一张短时凭证（内存，30 分钟，绑定 user），
//   免费档调 calculate-population 时**必须带上它**，且多边形必须与探测返回的某一档
//   逐点一致（坐标 round 到 6 位后比对）。⛔ 不做模糊匹配，避免「微调到相似」绕过。
// ============================================================================
const SCOPES = new Map()
const SCOPE_TTL_MS = 30 * 60 * 1000

function ringKey(polygon) {
  const ring = polygon?.coordinates?.[0]
  if (!Array.isArray(ring)) return ''
  return ring.map(c => `${Number(c[0]).toFixed(6)},${Number(c[1]).toFixed(6)}`).join(';')
}

function purgeExpired(now) {
  for (const [id, e] of SCOPES) {
    if (e.expires < now) SCOPES.delete(id)
  }
}

/** 探测成功后签发凭证，返回给前端（随 calculate-population 回传） */
export function issueScope(userId, bands, now = Date.now()) {
  purgeExpired(now)
  const id = `${userId}-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  SCOPES.set(id, {
    userId,
    expires: now + SCOPE_TTL_MS,
    rings: new Set((bands || []).map(b => ringKey(b.polygon)).filter(Boolean))
  })
  return id
}

/** 校验：这张凭证属于该用户、未过期，且多边形正是当时返回的某一档 */
export function verifyScope(userId, scopeId, polygon, now = Date.now()) {
  if (!scopeId) return false
  const e = SCOPES.get(scopeId)
  if (!e) return false
  if (e.userId !== userId) return false
  if (e.expires < now) {
    SCOPES.delete(scopeId)
    return false
  }
  return e.rings.has(ringKey(polygon))
}

/** 仅供测试 */
export function resetScopes() {
  SCOPES.clear()
}
