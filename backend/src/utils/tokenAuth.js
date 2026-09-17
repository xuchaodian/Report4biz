/**
 * 登录态撤销（v1.13.150 · P1）
 *
 * 背景：JWT 是无状态的 —— 原先「退出登录」只在客户端清 sessionStorage，
 * 服务端**没有任何作废手段**；token 一旦泄露（或共享设备上没关浏览器），
 * 在 7 天有效期内始终可用。这是「共享设备会话安全」的真正落点。
 *
 * 两个**正交**机制（刻意分开，各管一件事，不要合并）：
 *
 *   ① jti 黑名单（revoked_tokens 表）—— 精确撤销**单个** token。
 *      用途：「退出登录」只让**本设备**下线，同账号其他设备不受影响。
 *      （多设备并存是常态，用全局失效去实现登出会误伤其他设备。）
 *
 *   ② token_version（users.token_version 列）—— 撤销该账号**全部**已签发 token。
 *      用途：改密码 / 管理员重置密码 / 忘记密码重置。密码变了，旧密码签出的
 *      会话就都该作废（含「密码被盗 → 改密码求救」这一核心场景）。
 *      实现：签发时把当时版本号写进 payload.tv，校验时与库里现值比对。
 *
 * 🔴 兼容性铁律（勿删，删了上线瞬间会全员掉线）：
 *   生产库已签发大量「无 jti、无 tv」的老 token。
 *     - 无 jti ⇒ 黑名单查不到 ⇒ 放行（老 token 无法被单点撤销，可接受）
 *     - 无 tv  ⇒ 视为 0，与 users.token_version 默认值 0 相等 ⇒ 放行
 *   若不做这个回退，本版本一上线所有在线用户会被 401 踢下线。
 *
 * ⚠️ 性能：本模块每次请求做 1~2 次内存查询（sql.js 全内存库，无 IO）。
 *    黑名单表绝大多数时候为空，主键点查成本可忽略。
 */
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config.js'

/** 默认有效期（与历史一致，可通过环境变量覆盖） */
export const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '7d'

/** 登录态失效的统一对外文案（不区分具体原因，避免向攻击者泄露细节） */
export const SESSION_EXPIRED_MESSAGE = '登录状态已失效，请重新登录'

/** 黑名单兜底 TTL：payload 缺 exp 时按 7 天算（正常不会走到） */
const FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 签发 token。
 * @param {object} user 至少含 { id, username, role }，可选 token_version
 * @param {number} [tokenVersion] 显式指定版本号（不传则取 user.token_version，再兜底 0）
 */
export function signToken(user, tokenVersion) {
  const tv = Number(tokenVersion ?? user?.token_version ?? 0) || 0
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      tv,                              // ② 账号级版本快照
      jti: crypto.randomUUID()         // ① 单 token 标识（登出时入黑名单）
    },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  )
}

/**
 * 校验已解码的 payload 是否仍然有效（jwt.verify 之外的业务层校验）。
 * @returns {{ ok: boolean, reason?: 'invalid'|'revoked'|'user_gone'|'stale' }}
 */
export function verifyTokenPayload(decoded, db) {
  if (!decoded || decoded.id === undefined || decoded.id === null) {
    return { ok: false, reason: 'invalid' }
  }

  // ① jti 黑名单（老 token 没有 jti ⇒ 跳过）
  if (decoded.jti) {
    const hit = db.prepare('SELECT 1 AS x FROM revoked_tokens WHERE jti = ?').get(String(decoded.jti))
    if (hit) return { ok: false, reason: 'revoked' }
  }

  // ② 账号级版本
  const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(decoded.id)
  if (!row) return { ok: false, reason: 'user_gone' }
  const current = Number(row.token_version || 0)
  const minted = Number(decoded.tv ?? 0) || 0   // ⚠️ 老 token 无 tv ⇒ 0
  if (minted !== current) return { ok: false, reason: 'stale' }

  return { ok: true }
}

/**
 * 撤销单个 token（退出登录）。
 * 无 jti 的老 token 无法单点撤销 ⇒ 返回 false（调用方无需报错，客户端照样清本地）。
 * @returns {boolean} 是否真的写入了黑名单
 */
export function revokeToken(decoded, db, now = Date.now()) {
  const jti = decoded?.jti ? String(decoded.jti) : ''
  if (!jti) return false

  const expiresAt = decoded?.exp ? Number(decoded.exp) * 1000 : now + FALLBACK_TTL_MS

  // 两次写（INSERT + 过期清理）⇒ 包事务：N 次落盘压成 1 次（见落盘铁律）
  db.beginTx()
  try {
    db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)')
      .run(jti, decoded?.id ?? null, expiresAt)
    // 惰性清理：登出是低频动作，顺手把自然过期的条目删掉，免去额外定时任务
    db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(now)
    db.commitTx()
  } catch (e) {
    db.rollbackTx()
    throw e
  }
  return true
}

/**
 * 账号级失效：版本号 +1 ⇒ 该账号此前签发的**所有** token 立即失效。
 * 用于改密码 / 管理员重置密码 / 忘记密码重置。
 * ⚠️ 单次写，**不要**包事务（包了反而多一次落盘，见落盘铁律）。
 */
export function bumpTokenVersion(db, userId) {
  db.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(userId)
}

/** 读取账号当前版本号（改密码后需要给「本人」重签一个 token 用） */
export function currentTokenVersion(db, userId) {
  return Number(db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId)?.token_version || 0)
}

/** 黑名单当前条目数（运维/测试观测用） */
export function revokedCount(db) {
  return Number(db.prepare('SELECT COUNT(*) AS c FROM revoked_tokens').get()?.c || 0)
}
