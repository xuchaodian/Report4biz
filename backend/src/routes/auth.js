import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { getDb } from '../models/database.js'

const router = express.Router()
const JWT_SECRET = process.env.JWT_SECRET || 'geomanger-secret-key-2024'

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
        company: user.company,
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
    const user = db.prepare('SELECT id, username, email, role, company, quota, created_at FROM users WHERE id = ?').get(decoded.id)

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

export default router
