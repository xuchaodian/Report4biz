import express from 'express'
import bcrypt from 'bcryptjs'
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const router = express.Router()

// 获取用户列表（包含配额信息）
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const { company } = req.query
    
    let sql = `SELECT id, username, email, role, company, quota, created_at FROM users`
    const params = []
    
    if (company) {
      sql += ` WHERE company LIKE ?`
      params.push(`%${company}%`)
    }
    
    sql += ` ORDER BY created_at DESC`
    
    const users = db.prepare(sql).all(...params)

    // 计算已分配的配额总和（不包括管理员）
    const allocatedResult = db.prepare(`SELECT COALESCE(SUM(quota), 0) as total FROM users WHERE role != 'admin'`).get()
    const allocatedQuota = allocatedResult?.total || 0

    // 获取管理员设置的总配额
    const quotaRecord = db.prepare(`SELECT total_quota FROM admin_quota WHERE id = 1`).get()
    const totalQuota = quotaRecord?.total_quota || 0

    // 剩余可分配 = 总配额 - 已分配
    const availableQuota = Math.max(0, totalQuota - allocatedQuota)

    res.json({ 
      users,
      quotaInfo: {
        totalQuota,
        allocatedQuota,
        availableQuota
      }
    })
  } catch (error) {
    console.error('获取用户列表错误:', error)
    res.status(500).json({ message: '获取用户列表失败' })
  }
})

// 更新总配额（管理员手动设置）
router.put('/quota', authenticate, requireAdmin, (req, res) => {
  try {
    const { totalQuota } = req.body
    
    if (totalQuota === undefined || totalQuota < 0) {
      return res.status(400).json({ message: '请输入有效的总配额数值' })
    }

    const db = getDb()

    // 计算已分配的配额总和（不包括管理员）
    const allocatedResult = db.prepare(`SELECT COALESCE(SUM(quota), 0) as total FROM users WHERE role != 'admin'`).get()
    const allocatedQuota = allocatedResult?.total || 0

    // 更新总配额
    db.prepare(`UPDATE admin_quota SET total_quota = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(parseInt(totalQuota))

    // 剩余可分配 = 总配额 - 已分配
    const availableQuota = Math.max(0, totalQuota - allocatedQuota)

    res.json({
      message: '总配额已更新',
      quotaInfo: {
        totalQuota: parseInt(totalQuota),
        allocatedQuota,
        availableQuota
      }
    })
  } catch (error) {
    console.error('更新总配额错误:', error)
    res.status(500).json({ message: '更新总配额失败' })
  }
})

// 创建用户
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const { username, email, password, role, company } = req.body

    if (!username || !email || !password) {
      return res.status(400).json({ message: '请填写所有必填字段' })
    }

    if (password.length < 6) {
      return res.status(400).json({ message: '密码至少6个字符' })
    }

    const db = getDb()

    // 检查用户名或邮箱是否已存在
    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email)
    if (existing) {
      return res.status(400).json({ message: '用户名或邮箱已存在' })
    }

    // 加密密码
    const hashedPassword = bcrypt.hashSync(password, 10)

    // 创建用户
    const result = db.prepare(`
      INSERT INTO users (username, email, password, role, company)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, email, hashedPassword, role || 'user', company || '')

    const user = db.prepare('SELECT id, username, email, role, company, created_at FROM users WHERE id = ?').get(result.lastInsertRowid)

    res.status(201).json({
      message: '用户创建成功',
      user
    })
  } catch (error) {
    console.error('创建用户错误:', error)
    res.status(500).json({ message: '创建用户失败' })
  }
})

// 用户修改自己的信息（只需要登录，不需要 admin）
router.put('/me', authenticate, (req, res) => {
  try {
    const { email, password, company } = req.body
    const userId = req.user.id

    const db = getDb()

    // 检查用户是否存在
    const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!existingUser) {
      return res.status(404).json({ message: '用户不存在' })
    }

    // 更新用户信息
    const updates = []
    const params = []

    if (email) {
      // 检查邮箱是否被其他用户使用
      const emailExists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, userId)
      if (emailExists) {
        return res.status(400).json({ message: '该邮箱已被其他用户使用' })
      }
      updates.push('email = ?')
      params.push(email)
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ message: '密码至少6个字符' })
      }
      updates.push('password = ?')
      params.push(bcrypt.hashSync(password, 10))
    }

    if (company !== undefined) {
      updates.push('company = ?')
      params.push(company)
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: '没有需要更新的字段' })
    }

    params.push(userId)
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)

    const user = db.prepare('SELECT id, username, email, role, company, created_at FROM users WHERE id = ?').get(userId)

    res.json({
      message: '修改成功',
      user
    })
  } catch (error) {
    console.error('修改个人信息错误:', error)
    res.status(500).json({ message: '修改失败' })
  }
})

// 更新用户
router.put('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const { email, password, role, company, quota } = req.body
    const userId = req.params.id

    const db = getDb()

    // 检查用户是否存在
    const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!existingUser) {
      return res.status(404).json({ message: '用户不存在' })
    }

    // 如果要更新配额，需要检查配额限制
    if (quota !== undefined) {
      const newQuota = parseInt(quota) || 0
      
      // 计算当前已分配的配额（不包括当前用户）
      const allocatedResult = db.prepare(`SELECT COALESCE(SUM(quota), 0) as total FROM users WHERE role != 'admin' AND id != ?`).get(userId)
      const currentAllocated = allocatedResult?.total || 0

      // 获取总配额
      const quotaRecord = db.prepare(`SELECT total_quota FROM admin_quota WHERE id = 1`).get()
      const totalQuota = quotaRecord?.total_quota || 0

      // 可用配额 = 总配额 - 其他用户已分配的配额
      const availableQuota = Math.max(0, totalQuota - currentAllocated)

      // 如果新配额大于可用配额，拒绝
      if (newQuota > availableQuota) {
        return res.status(400).json({ 
          message: `分配失败：超出可用配额。${newQuota} > ${availableQuota}（可用配额 = 总配额 ${totalQuota} - 已分配给其他用户的 ${currentAllocated}）` 
        })
      }
    }

    // 更新用户信息
    const updates = []
    const params = []

    if (email) {
      updates.push('email = ?')
      params.push(email)
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ message: '密码至少6个字符' })
      }
      updates.push('password = ?')
      params.push(bcrypt.hashSync(password, 10))
    }

    if (role) {
      updates.push('role = ?')
      params.push(role)
    }

    if (company !== undefined) {
      updates.push('company = ?')
      params.push(company)
    }

    if (quota !== undefined) {
      updates.push('quota = ?')
      params.push(parseInt(quota) || 0)
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: '没有需要更新的字段' })
    }

    params.push(userId)
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)

    // 返回更新后的配额信息
    const allocatedResult = db.prepare(`SELECT COALESCE(SUM(quota), 0) as total FROM users WHERE role != 'admin'`).get()
    const allocatedQuota = allocatedResult?.total || 0
    const quotaRecord = db.prepare(`SELECT total_quota FROM admin_quota WHERE id = 1`).get()
    const totalQuota = quotaRecord?.total_quota || 0

    const user = db.prepare('SELECT id, username, email, role, company, quota, created_at FROM users WHERE id = ?').get(userId)

    res.json({
      message: '用户更新成功',
      user,
      quotaInfo: {
        totalQuota,
        allocatedQuota,
        availableQuota: Math.max(0, totalQuota - allocatedQuota)
      }
    })
  } catch (error) {
    console.error('更新用户错误:', error)
    res.status(500).json({ message: '更新用户失败' })
  }
})

// 删除用户
router.delete('/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const userId = req.params.id

    const db = getDb()

    // 检查用户是否存在
    const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!existingUser) {
      return res.status(404).json({ message: '用户不存在' })
    }

    // 不能删除自己
    if (existingUser.id === req.user.id) {
      return res.status(400).json({ message: '不能删除自己的账号' })
    }

    // 删除用户
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)

    res.json({ message: '用户删除成功' })
  } catch (error) {
    console.error('删除用户错误:', error)
    res.status(500).json({ message: '删除用户失败' })
  }
})

// 重置密码
router.post('/:id/reset-password', authenticate, requireAdmin, (req, res) => {
  try {
    const userId = req.params.id
    const db = getDb()

    const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!existingUser) {
      return res.status(404).json({ message: '用户不存在' })
    }

    const hashedPassword = bcrypt.hashSync('123456', 10)
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId)

    res.json({ message: '密码已重置为 123456' })
  } catch (error) {
    console.error('重置密码错误:', error)
    res.status(500).json({ message: '重置密码失败' })
  }
})

export default router
