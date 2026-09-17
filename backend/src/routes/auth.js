import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { getDb } from '../models/database.js'
import { JWT_SECRET, APP_BASE_URL } from '../config.js'
import { sendPasswordResetMail, isMailEnabled } from '../utils/mailer.js'
import { overLimit } from '../utils/rateLimit.js'
import {
  signToken, verifyTokenPayload, revokeToken, bumpTokenVersion, currentTokenVersion,
  SESSION_EXPIRED_MESSAGE
} from '../utils/tokenAuth.js'
import {
  issueRegisterTicket, verifyRegisterTicket, clientIpOf,
  REG_WINDOW_MS, REG_MAX_PER_IP, REG_MIN_FILL_MS, REG_HONEYPOT_FIELD, REG_TICKET_MESSAGES
} from '../utils/registerGuard.js'

const router = express.Router()

// ============================================================================
// 注册防护（v1.13.149 · P0）
//
// 三道闸门（分层，详见 utils/registerGuard.js 顶部说明）：
//   ① IP 滑动窗口限流  ② 表单票据（HMAC 无状态）  ③ 蜜罐字段
//
// 🔒 顺序刻意如此，勿调换（①限流 → ②票据 → ③字段 → ④重名 → ⑤蜜罐 → ⑥落库）：
//   限流必须最先 ⇒ 超频请求不消耗任何后续资源（bcrypt 尤其贵）；
//   蜜罐必须**最后**（在全部正常校验之后、落库之前）⇒ 填与不填蜜罐，攻击者可观察的
//   一切（状态码/文案/耗时/id 量级）完全一致，他就无法用「故意提交畸形字段」或
//   「故意用一个已知存在的用户名」反推出哪个字段是蜜罐。
// ============================================================================

// 蜜罐假回执专用的 id 游标（见下方 ⑤）：保证连续命中返回递增且不重复的 id
let honeypotIdCursor = 0

// 领取注册票据（公开）：证明「确实打开过注册页」，抬高纯 POST 脚本的门槛。
// 无状态、无 IO、无副作用，故不额外限流（额度由 /register 侧把住）。
router.get('/register-ticket', (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ ticket: issueRegisterTicket(), minFillMs: REG_MIN_FILL_MS })
})

// 注册
router.post('/register', async (req, res) => {
  try {
    const body = req.body || {}
    const ip = clientIpOf(req)

    // ① IP 限流
    if (overLimit(`reg:ip:${ip}`, REG_MAX_PER_IP, REG_WINDOW_MS)) {
      console.warn('[auth][register] IP 限流命中:', ip)
      res.set('Retry-After', String(Math.ceil(REG_WINDOW_MS / 1000)))
      return res.status(429).json({ message: '注册请求过于频繁，请稍后再试' })
    }

    const { username, email, password } = body

    // ② 表单票据
    const tk = verifyRegisterTicket(body.ticket)
    if (!tk.ok) {
      if (tk.reason === 'too_fast' || tk.reason === 'expired') {
        console.warn('[auth][register] 票据被拒:', tk.reason, ip)
      }
      return res.status(400).json({
        message: REG_TICKET_MESSAGES[tk.reason] || REG_TICKET_MESSAGES.missing,
        code: `ticket_${tk.reason}`
      })
    }

    // ③ 字段校验（文案与历史逐字一致，勿改）
    if (!username || !email || !password) {
      return res.status(400).json({ message: '请填写所有必填字段' })
    }

    if (password.length < 6) {
      return res.status(400).json({ message: '密码至少6个字符' })
    }

    const db = getDb()

    // ④ 检查用户名是否存在
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email)
    if (existingUser) {
      return res.status(400).json({ message: '用户名或邮箱已存在' })
    }

    // ⑤ 蜜罐：位置刻意放在**全部正常校验之后、落库之前**。
    //    ⇒ 填不填蜜罐，攻击者能观察到的一切（状态码 / 文案 / 耗时 / id 量级）都无差别，
    //      他就无法用「故意提交畸形字段」或「故意用一个已知存在的用户名」去反推
    //      「哪个字段是蜜罐」（若蜜罐提前拦截，这两种探测会得到与他预期不同的回执而暴露）。
    if (String(body[REG_HONEYPOT_FIELD] || '').trim()) {
      console.warn('[auth][register] 蜜罐命中（疑似脚本）:', ip, String(username).slice(0, 32))
      try { bcrypt.hashSync(String(password), 10) } catch (e) { /* 忽略 */ } // 抹平 bcrypt 耗时
      // id 取「MAX(id) 之后的自增游标」：与真实自增同量级、严格递增且**绝不重复**
      // （若每次都返回同一个随机 id，或返回 6 位数 id，都成了可识别的破绽）
      const maxId = Number(db.prepare('SELECT MAX(id) AS m FROM users').get()?.m || 0)
      if (honeypotIdCursor <= maxId) honeypotIdCursor = maxId + 1
      const fakeId = honeypotIdCursor++
      return res.status(201).json({
        message: '注册成功',
        user: { id: fakeId, username, email, role: 'user' }
      })
    }

    // ⑥ 加密并落库
    const hashedPassword = bcrypt.hashSync(password, 10)

    const result = db.prepare(`
      INSERT INTO users (username, email, password, role)
      VALUES (?, ?, ?, ?)
    `).run(username, email, hashedPassword, 'user')

    res.status(201).json({
      message: '注册成功',
      user: {
        id: result.lastInsertRowid,
        username,
        email,
        role: 'user'
      }
    })
  } catch (error) {
    console.error('注册错误:', error)
    res.status(500).json({ message: '注册失败' })
  }
})

// 登录
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(400).json({ message: '请输入用户名和密码' })
    }

    const db = getDb()

    // 查找用户
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
    if (!user) {
      return res.status(401).json({ message: '用户名或密码错误' })
    }

    // 验证密码
    const isValid = bcrypt.compareSync(password, user.password)
    if (!isValid) {
      return res.status(401).json({ message: '用户名或密码错误' })
    }

    // 生成JWT（v1.13.150：内嵌 jti + 账号版本快照 tv，便于服务端撤销，见 utils/tokenAuth.js）
    const token = signToken(user, user.token_version)

    res.json({
      message: '登录成功',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        vip_until: user.vip_until || null,
        company: user.company,
        logo: user.logo || null,
        quota: user.quota
      }
    })
  } catch (error) {
    console.error('登录错误:', error)
    res.status(500).json({ message: '登录失败' })
  }
})

// ============================================================================
// 退出登录（v1.13.150）
//
// 语义：把**当前这一枚** token 拉黑（按 jti），同账号其他设备不受影响。
//   - 账号级失效（改密码踢掉全部设备）走 users.token_version，不在本接口职责内。
//   - 老 token（无 jti）无法单点撤销 ⇒ 仍返回 200，前端照常清本地；
//     老 token 会随用户重新登录被替换，最长 7 天后自然过期。
//
// 🔒 为什么**不挂 authenticate 中间件**（刻意为之，勿"修正"）：
//   1) 登出必须**幂等** —— 多标签页/重复点击时，token 已在黑名单，
//      若走 authenticate 会先被 401 挡下；而前端 401 拦截器会跳登录页/弹"登录已过期"，
//      用户明明在主动登出却看到报错。这里一律 200，由前端清本地后跳 /login。
//   2) 无鉴权不放宽攻击面：拉黑依据是 token 自身的 jti，攻击者不持有该 token
//      就无从得知其 jti；伪造 token 验签失败直接跳过（不产生任何写入），
//      故本接口**无法被用于撤销他人会话**，也无写入放大。
// ============================================================================
router.post('/logout', (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : ''
    if (!token) {
      return res.json({ message: '已退出登录', revoked: false })   // 无会话可撤
    }

    let decoded
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch (e) {
      // 过期 / 伪造 / 已被撤销：没有可撤销的有效会话，照样回 200（登出幂等）
      return res.json({ message: '已退出登录', revoked: false })
    }

    return res.json({ message: '已退出登录', revoked: revokeToken(decoded, getDb()) })
  } catch (error) {
    console.error('退出登录错误:', error)
    // ⚠️ 服务端拉黑失败也不能阻断客户端登出；用 revoked:false 标记并由日志留痕
    return res.json({ message: '已退出登录', revoked: false })
  }
})

// 获取当前用户信息
router.get('/me', (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: '未登录' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, JWT_SECRET)

    const db = getDb()

    // 服务端撤销校验（与 middleware/auth.js 一致，勿漏：本接口不走 authenticate 中间件）
    const chk = verifyTokenPayload(decoded, db)
    if (!chk.ok) {
      return res.status(401).json({ message: SESSION_EXPIRED_MESSAGE })
    }
    const user = db.prepare('SELECT id, username, email, role, vip_until, company, logo, quota, created_at FROM users WHERE id = ?').get(decoded.id)

    if (!user) {
      return res.status(404).json({ message: '用户不存在' })
    }

    res.json({ user })
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token无效或已过期' })
    }
    console.error('获取用户信息错误:', error)
    res.status(500).json({ message: '获取用户信息失败' })
  }
})

// ============================================================================
// 忘记密码 / 重置密码（v1.13.130）
//
// 链路：用户提交邮箱 → 签发一次性令牌（仅存 sha256 哈希，明文只在邮件里）
//      → 邮件发出 https://<域名>/reset-password?token=… → 用户设新密码
//
// 🔒 安全约束（刻意设计，勿改）：
//   1) 防账号枚举：邮箱不存在 / 邮件发送失败，都返回**同一句 200 回执**；
//      否则攻击者可据响应差异探测哪些邮箱已注册。
//   2) 令牌一次性：用后立即 used_at；同账号只保留最新一条有效令牌。
//   3) 令牌 30 分钟过期；库内不存明文令牌。
//   4) 滑动窗口限流（按邮箱 + 按 IP），防邮件配额被刷爆。
// ============================================================================
const RESET_TTL_MIN = 30
const RESET_WINDOW_MS = 15 * 60 * 1000
const RESET_MAX_PER_EMAIL = 3
const RESET_MAX_PER_IP = 10
const FORGOT_UNIFORM_MSG = '如果该邮箱已注册，我们已发送密码重置链接，请查收邮件（也请检查垃圾邮件箱）。'

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

// 限流器已抽到 utils/rateLimit.js（v1.13.149 起与「注册」共用同一套桶）

// 申请重置：发送一次性重置链接
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()

    if (!email) {
      return res.status(400).json({ message: '请输入邮箱' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: '请输入正确的邮箱格式' })
    }

    // 邮件通道未配置属于「全局」问题，不泄露任何具体账号信息
    if (!isMailEnabled()) {
      return res.status(503).json({ message: '邮件服务未配置，请联系管理员' })
    }

    const ip = clientIpOf(req)
    if (overLimit(`reset:ip:${ip}`, RESET_MAX_PER_IP, RESET_WINDOW_MS) ||
        overLimit(`reset:em:${email}`, RESET_MAX_PER_EMAIL, RESET_WINDOW_MS)) {
      return res.status(429).json({ message: '请求过于频繁，请稍后再试' })
    }

    const db = getDb()
    const user = db.prepare('SELECT id, username, email FROM users WHERE LOWER(email) = ?').get(email)

    // ⚠️ 防账号枚举：账号不存在时同样返回 200 + 同一句文案
    if (!user) {
      return res.json({ message: FORGOT_UNIFORM_MSG })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = Date.now() + RESET_TTL_MIN * 60 * 1000

    // 同账号只保留最新一条有效令牌：先作废此前所有未用令牌
    db.beginTx()
    try {
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
        .run(Date.now(), user.id)
      db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip) VALUES (?, ?, ?, ?)')
        .run(user.id, sha256(token), expiresAt, ip)
      db.commitTx()
    } catch (e) {
      db.rollbackTx()
      throw e
    }

    const link = `${APP_BASE_URL}/reset-password?token=${token}`
    try {
      const info = await sendPasswordResetMail({
        to: user.email,
        username: user.username,
        link,
        expiresMinutes: RESET_TTL_MIN
      })
      console.log('[auth] 重置密码邮件已发送:', user.email, info?.messageId || '')
    } catch (e) {
      // ⚠️ 发送失败也不能改回执（否则又变成账号枚举信道），只落日志
      console.error('[auth] 重置密码邮件发送失败:', user.email, e.message)
    }

    return res.json({ message: FORGOT_UNIFORM_MSG })
  } catch (error) {
    console.error('忘记密码处理错误:', error)
    return res.status(500).json({ message: '请求处理失败，请稍后重试' })
  }
})

// 重置页进入时预检令牌：让用户一进来就知道链接是否还有效（不必等填完密码才报错）
router.get('/reset-password/check', (req, res) => {
  try {
    const token = String(req.query.token || '')
    if (!token) {
      return res.json({ valid: false, message: '链接不完整，请重新申请' })
    }

    const db = getDb()
    const row = db.prepare('SELECT expires_at, used_at FROM password_resets WHERE token_hash = ?')
      .get(sha256(token))

    if (!row) return res.json({ valid: false, message: '链接无效，请重新申请' })
    if (row.used_at) return res.json({ valid: false, message: '该链接已被使用，请重新申请' })
    if (Number(row.expires_at) <= Date.now()) return res.json({ valid: false, message: '链接已过期，请重新申请' })

    return res.json({ valid: true })
  } catch (error) {
    console.error('校验重置令牌错误:', error)
    return res.status(500).json({ valid: false, message: '校验失败，请稍后重试' })
  }
})

// 提交新密码：校验令牌 → 改密码 → 令牌一次性作废
router.post('/reset-password', (req, res) => {
  try {
    const token = String(req.body?.token || '')
    const password = String(req.body?.password || '')

    if (!token || !password) {
      return res.status(400).json({ message: '参数不完整' })
    }
    if (password.length < 6) {
      return res.status(400).json({ message: '密码至少6个字符' })
    }

    const db = getDb()
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(token))

    if (!row) return res.status(400).json({ message: '链接无效或已过期，请重新申请' })
    if (row.used_at) return res.status(400).json({ message: '该链接已被使用，请重新申请' })
    if (Number(row.expires_at) <= Date.now()) {
      return res.status(400).json({ message: '链接已过期，请重新申请' })
    }

    const hashedPassword = bcrypt.hashSync(password, 10)
    const now = Date.now()

    db.beginTx()
    try {
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, row.user_id)
      // 一次性：本条置为已用，同时作废该用户其余未用令牌
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
        .run(now, row.user_id)
      // v1.13.150：密码已变 ⇒ 该账号此前签发的**所有** token 立即作废
      //（「密码被盗 → 重置密码求救」场景的核心价值；老 token 无 tv ⇒ 按 0 比对会失配 ⇒ 同样被踢）
      bumpTokenVersion(db, row.user_id)
      db.commitTx()
    } catch (e) {
      db.rollbackTx()
      throw e
    }

    return res.json({ message: '密码已重置，请使用新密码登录' })
  } catch (error) {
    console.error('重置密码错误:', error)
    return res.status(500).json({ message: '重置密码失败，请稍后重试' })
  }
})

export default router
