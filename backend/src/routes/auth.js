import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { getDb } from '../models/database.js'
import { JWT_SECRET, APP_BASE_URL } from '../config.js'
import { sendPasswordResetMail, isMailEnabled } from '../utils/mailer.js'

const router = express.Router()

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body

    if (!username || !email || !password) {
      return res.status(400).json({ message: '请填写所有必填字段' })
    }

    if (password.length < 6) {
      return res.status(400).json({ message: '密码至少6个字符' })
    }

    const db = getDb()

    // 检查用户名是否存在
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email)
    if (existingUser) {
      return res.status(400).json({ message: '用户名或邮箱已存在' })
    }

    // 加密密码
    const hashedPassword = bcrypt.hashSync(password, 10)

    // 创建用户
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

    // 生成JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )

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
const resetHits = new Map()

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

// 滑动窗口限流（进程内；pm2 单实例 fork 模式下足够）
function overLimit(key, max) {
  const now = Date.now()
  const arr = (resetHits.get(key) || []).filter((t) => now - t < RESET_WINDOW_MS)
  if (arr.length >= max) {
    resetHits.set(key, arr)
    return true
  }
  arr.push(now)
  resetHits.set(key, arr)
  return false
}

// 定期清理过期限流记录，避免 Map 无限增长（unref 不阻塞进程退出）
const resetHitsCleaner = setInterval(() => {
  const now = Date.now()
  for (const [k, arr] of resetHits) {
    const keep = arr.filter((t) => now - t < RESET_WINDOW_MS)
    if (keep.length) resetHits.set(k, keep)
    else resetHits.delete(k)
  }
}, 10 * 60 * 1000)
if (resetHitsCleaner.unref) resetHitsCleaner.unref()

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

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown'
    if (overLimit(`ip:${ip}`, RESET_MAX_PER_IP) || overLimit(`em:${email}`, RESET_MAX_PER_EMAIL)) {
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
