import express from 'express'
import bcrypt from 'bcryptjs'
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { getPoolInfo } from './resale.js'

const router = express.Router()

// 获取用户列表（包含配额信息）
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const { company } = req.query
    
    let sql = `SELECT id, username, email, role, vip_until, company, quota, created_at FROM users`
    const params = []
    
    if (company) {
      sql += ` WHERE company LIKE ?`
      params.push(`%${company}%`)
    }
    
    sql += ` ORDER BY created_at DESC`
    
    const users = db.prepare(sql).all(...params)

    // 为每个用户计算配额信息
    const usersWithQuota = users.map(user => {
      // 一次查询取三个聚合（避免 N+1 恶化）：
      //   usedActive  当前消费（仅 active）—— 表格「消费次数」
      //   usedAll     累计消费（含 inactive）—— 表格「累计使用」
      //   cumAllocated 累计分配（quota_history 代数和的净购买）—— 表格「累计配额」
      // 口径与个人中心 GET /purchase/quota（purchase.js:70-88）逐字一致，保证两页对得上
      const agg = db.prepare(`
        SELECT
          COALESCE((SELECT SUM(quota_used) FROM purchases WHERE user_id = ? AND status = 'active'), 0) AS usedActive,
          COALESCE((SELECT SUM(quota_used) FROM purchases WHERE user_id = ?), 0) AS usedAll,
          COALESCE((SELECT SUM(change_amount) FROM quota_history WHERE user_id = ?), 0) AS cumAllocated
      `).get(user.id, user.id, user.id)
      const usedQuota = agg?.usedActive || 0
      const cumulativeUsed = agg?.usedAll || 0
      // 与 purchase.js:88 同口径：Σ 为 0 时回落到 users.quota（老账号无 quota_history 基线记录）
      const cumulativeTotal = agg?.cumAllocated || (user.quota || 0)

      if (user.role === 'admin') {
        // admin 用户不显示剩余配额（由 quotaInfo 统一提供）
        return { ...user, remainingQuota: null, usedQuota, cumulativeTotal, cumulativeUsed }
      }
      const remainingQuota = Math.max(0, (user.quota || 0) - usedQuota)
      return { ...user, remainingQuota, usedQuota, cumulativeTotal, cumulativeUsed }
    })

    // 计算已分配的配额总和（不包括管理员）
    const allocatedResult = db.prepare(`SELECT COALESCE(SUM(quota), 0) as total FROM users WHERE role != 'admin'`).get()
    const allocatedQuota = allocatedResult?.total || 0

    // 获取初始总配额与权威剩余配额（v1.13.103 B2：直接读 remaining_quota 列——
    // 该列由 smartsteps/purchase/districts 每次真实上游查询实时 -N，含「区域洞察」
    // （只扣列不写 purchases 履历）。原「initial − Σactive 履历」口径统计不进区域洞察
    // 消费 → 卡片持续虚高；改列后与顶栏「剩余 N 次」、purchase.js:62 同一权威来源）
    const quotaRecord = db.prepare(`SELECT initial_quota, remaining_quota FROM admin_quota WHERE id = 1`).get()
    const initialQuota = quotaRecord?.initial_quota || 0
    const remainingQuota = Math.max(0, quotaRecord?.remaining_quota || 0)

    // 剩余可分配 = 初始总配额 - 已分配（与用户实际使用无关）
    const availableQuota = Math.max(0, initialQuota - allocatedQuota)

    // API 开放页已分配（真实模式余额合计，测试模式不占池）——共用同一批次配额
    const apiAllocatedResult = db.prepare(`SELECT COALESCE(SUM(balance), 0) as total FROM api_keys WHERE COALESCE(mock, 0) = 0`).get()
    const apiAllocatedQuota = apiAllocatedResult?.total || 0
    // 全池剩余可分配 = 总配额 - 用户页已分配 - API 页已分配
    const poolAvailableQuota = Math.max(0, initialQuota - allocatedQuota - apiAllocatedQuota)

    res.json({ 
      users: usersWithQuota,
      quotaInfo: {
        initialQuota,     // 初始总配额（我手动输入的值）
        remainingQuota,   // 当前剩余配额（实际可查询的次数）
        allocatedQuota,   // 已分配给用户的次数
        availableQuota,   // 剩余可分配次数（仅用户页口径）
        apiAllocatedQuota,   // API 开放页已分配（第三方余额合计）
        poolAvailableQuota   // 全池剩余可分配（用户页+API页共用）
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

    // 获取当前数据用于计算
    const currentQuota = db.prepare(`SELECT initial_quota, remaining_quota FROM admin_quota WHERE id = 1`).get()
    const currentInitial = currentQuota?.initial_quota || 0
    const currentRemaining = currentQuota?.remaining_quota || 0

    // 计算已分配的配额总和（不包括管理员）
    const allocatedResult = db.prepare(`SELECT COALESCE(SUM(quota), 0) as total FROM users WHERE role != 'admin'`).get()
    const allocatedQuota = allocatedResult?.total || 0

    // 计算新的 remaining_quota
    // 规则：新增配额时，remaining_quota 也要增加
    const quotaDiff = parseInt(totalQuota) - currentInitial
    const newRemaining = Math.max(0, currentRemaining + quotaDiff)

    // 本次「真实采购量」= 剩余的实际增量（v1.13.115）
    // 只有 >0 才是采购；≤0（原值重存 / 回调）不记采购履历。
    // 注意用「剩余增量」而非 quotaDiff：极端情况下 newRemaining 会被 Math.max(0,…) 截断，
    // 用实际增量才能保证 quota_before + amount === quota_after 自洽。
    const purchaseAmount = newRemaining - currentRemaining

    // 更新初始总配额和当前剩余配额 + 采购留痕（同事务）
    db.beginTx()
    try {
      db.prepare(`UPDATE admin_quota SET initial_quota = ?, remaining_quota = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
        .run(parseInt(totalQuota), newRemaining)

      if (purchaseAmount > 0) {
        // ⚠️ 写 quota_purchases，**绝不**写 quota_history（后者是账号级台账，见 database.js 注释）
        db.prepare(`
          INSERT INTO quota_purchases (amount, quota_before, quota_after, note, created_by, created_by_name)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          purchaseAmount,
          currentRemaining,
          newRemaining,
          (req.body?.note || '').toString().trim() || null,
          req.user?.id ?? null,
          req.user?.username ?? null
        )
      }

      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    // 剩余可分配 = 初始总配额 - 已分配
    const availableQuota = Math.max(0, parseInt(totalQuota) - allocatedQuota)
    // API 开放页占用与全池口径（与 GET / 一致，前端整体赋值需全字段）
    const apiAllocatedResult = db.prepare(`SELECT COALESCE(SUM(balance), 0) as total FROM api_keys WHERE COALESCE(mock, 0) = 0`).get()
    const apiAllocatedQuota = apiAllocatedResult?.total || 0
    const poolAvailableQuota = Math.max(0, parseInt(totalQuota) - allocatedQuota - apiAllocatedQuota)

    res.json({
      message: '总配额已更新',
      purchaseRecorded: purchaseAmount > 0 ? purchaseAmount : 0,   // >0 表示本次记入采购履历
      quotaInfo: {
        initialQuota: parseInt(totalQuota),
        remainingQuota: newRemaining,
        allocatedQuota,
        availableQuota,
        apiAllocatedQuota,
        poolAvailableQuota
      }
    })
  } catch (error) {
    console.error('更新总配额错误:', error)
    res.status(500).json({ message: '更新总配额失败' })
  }
})

// 获取配额采购履历（v1.13.115，仅平台 admin）
// 池级台账：每次「向联通采购 / 上调累计总配额」记一行；纯读接口。
router.get('/quota/purchases', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 500)

    const rows = db.prepare(`
      SELECT id, amount, quota_before, quota_after, note, created_by, created_by_name, created_at
      FROM quota_purchases
      ORDER BY id DESC
      LIMIT ?
    `).all(limit)

    const sumRow = db.prepare(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total FROM quota_purchases
    `).get()

    const quotaRecord = db.prepare(`SELECT initial_quota FROM admin_quota WHERE id = 1`).get()
    const initialQuota = quotaRecord?.initial_quota || 0

    res.json({
      purchases: rows,
      summary: {
        count: sumRow?.cnt || 0,
        totalAmount: sumRow?.total || 0,
        initialQuota,
        // 本表建立之前的采购量（无明细），仅作提示，不参与任何计算
        baselineAmount: Math.max(0, initialQuota - (sumRow?.total || 0))
      }
    })
  } catch (error) {
    console.error('获取采购履历错误:', error)
    res.status(500).json({ message: '获取采购履历失败' })
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
    const { email, password, company, logo } = req.body
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

    if (logo !== undefined) {
      updates.push('logo = ?')
      params.push(logo)
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: '没有需要更新的字段' })
    }

    params.push(userId)
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)

    const user = db.prepare('SELECT id, username, email, role, company, logo, created_at FROM users WHERE id = ?').get(userId)

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
    const { email, password, role, vip_until, company, quota } = req.body
    const userId = req.params.id

    const db = getDb()

    // 检查用户是否存在
    const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    if (!existingUser) {
      return res.status(404).json({ message: '用户不存在' })
    }

    // 如果要更新配额，检查配额限制（设定模式）
    if (quota !== undefined) {
      const newQuota = parseInt(quota) || 0
      const currentUserQuota = existingUser.quota || 0
      const diff = newQuota - currentUserQuota  // 正=追加，负=减少

      // 只有在增加时才需要检查可用配额
      if (diff > 0) {
        // v1.13.103 B2-C：与 resale.js 同一单一预算池口径（getPoolInfo）——
        // 池剩余 = 总配额 − Σ(users.quota, 非admin) − Σ(api_keys.balance, mock=0)。
        // 原校验只减用户页已分配、漏减 API 开放页占用 → 用户页可超额分配，
        // 两页总和可超买入批次总额（超额部分实际无上游额度支撑）
        const pool = getPoolInfo(db)
        if (diff > pool.available) {
          return res.status(400).json({
            message: `分配失败：超出可用配额。需追加 ${diff} 次，当前可用 ${pool.available} 次（总配额 ${pool.poolTotal}，用户页已分配 ${pool.allocatedUsers}，API 开放页已分配 ${pool.allocatedApi}）`
          })
        }
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

    // VIP 到期：设为 VIP → 自保存日起算自动续期 1 年；设为 VIP 试用 → 自保存日起算 30 天；未改为其他角色则每次保存自动延续；改为其他角色 → 清除
    const finalRole = role !== undefined ? role : existingUser.role
    if (finalRole === 'vip') {
      const vipUntil = new Date(Date.now() + 365 * 24 * 3600 * 1000)
      updates.push('vip_until = ?')
      params.push(vipUntil.toISOString().slice(0, 10))
    } else if (finalRole === 'trial') {
      const vipUntil = new Date(Date.now() + 30 * 24 * 3600 * 1000)
      updates.push('vip_until = ?')
      params.push(vipUntil.toISOString().slice(0, 10))
    } else if (role !== undefined && finalRole !== 'vip' && finalRole !== 'trial') {
      updates.push('vip_until = ?')
      params.push(null)
    }

    if (quota !== undefined) {
      // 设定模式：直接设为输入值
      const newQuota = parseInt(quota) || 0
      const oldQuota = existingUser.quota || 0
      const changeAmount = newQuota - oldQuota
      updates.push('quota = ?')
      params.push(newQuota)
      // 记录配额变更历史（用于累计配额统计）
      try {
        db.prepare(`
          INSERT INTO quota_history (user_id, old_quota, new_quota, change_amount, action)
          VALUES (?, ?, ?, ?, ?)
        `).run(userId, oldQuota, newQuota, changeAmount, changeAmount >= 0 ? 'increase' : 'decrease')
      } catch (e) {
        console.error('写入配额历史失败:', e)
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: '没有需要更新的字段' })
    }

    params.push(userId)
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)

    // 返回更新后的配额信息（含 API 页占用与全池口径，前端整体赋值需全字段）
    const allocatedResult = db.prepare(`SELECT COALESCE(SUM(quota), 0) as total FROM users WHERE role != 'admin'`).get()
    const allocatedQuota = allocatedResult?.total || 0
    const quotaRecord = db.prepare(`SELECT initial_quota, remaining_quota FROM admin_quota WHERE id = 1`).get()
    const initialQuota = quotaRecord?.initial_quota || 0
    const remainingQuota = quotaRecord?.remaining_quota || 0
    const apiAllocatedResult = db.prepare(`SELECT COALESCE(SUM(balance), 0) as total FROM api_keys WHERE COALESCE(mock, 0) = 0`).get()
    const apiAllocatedQuota = apiAllocatedResult?.total || 0
    const availableQuota = Math.max(0, initialQuota - allocatedQuota)
    const poolAvailableQuota = Math.max(0, initialQuota - allocatedQuota - apiAllocatedQuota)

    const user = db.prepare('SELECT id, username, email, role, company, quota, created_at FROM users WHERE id = ?').get(userId)

    res.json({
      message: '用户更新成功',
      user,
      quotaInfo: {
        initialQuota,
        remainingQuota,
        allocatedQuota,
        availableQuota,
        apiAllocatedQuota,
        poolAvailableQuota
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

// 获取月度使用统计
router.get('/monthly-stats', authenticate, requireAdmin, (req, res) => {
  try {
    const { month, company } = req.query
    
    if (!month) {
      return res.status(400).json({ message: '请选择月份' })
    }
    
    const db = getDb()
    
    // 解析月份，获取起始和结束日期
    const [year, monthNum] = month.split('-')
    const startDate = `${year}-${monthNum}-01`
    const endDate = monthNum === '12' 
      ? `${parseInt(year) + 1}-01-01` 
      : `${year}-${String(parseInt(monthNum) + 1).padStart(2, '0')}-01`
    
    // 构建查询：获取该公司所有用户的月度使用情况
    let sql = `
      SELECT 
        u.id,
        u.username,
        u.email,
        u.company,
        u.quota as total_quota,
        COALESCE(SUM(p.quota_used), 0) as monthly_used,
        u.quota - COALESCE(SUM(p.quota_used), 0) as monthly_remaining
      FROM users u
      LEFT JOIN purchases p ON u.id = p.user_id 
        AND p.status = 'active'
        AND p.created_at >= ?
        AND p.created_at < ?
    `
    
    const params = [startDate, endDate]
    
    // 如果选择了公司，按公司筛选
    if (company) {
      sql += ` WHERE u.company LIKE ?`
      params.push(`%${company}%`)
    }
    
    sql += ` GROUP BY u.id ORDER BY u.created_at DESC`
    
    const users = db.prepare(sql).all(...params)
    
    // 计算汇总
    const totalMonthlyUsed = users.reduce((sum, u) => sum + (u.monthly_used || 0), 0)
    
    res.json({
      month,
      users: users.map(u => ({
        ...u,
        monthly_used: u.monthly_used || 0,
        monthly_remaining: Math.max(0, u.monthly_remaining || 0)
      })),
      summary: {
        totalUsers: users.length,
        totalMonthlyUsed
      }
    })
  } catch (error) {
    console.error('获取月度统计错误:', error)
    res.status(500).json({ message: '获取月度统计失败' })
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
