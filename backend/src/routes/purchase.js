import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

/**
 * 获取用户配额信息
 */
router.get('/quota', authenticate, (req, res) => {
  try {
    const db = getDb()
    const user = db.prepare('SELECT id, username, quota FROM users WHERE id = ?').get(req.user.id)
    
    if (!user) {
      return res.status(404).json({ message: '用户不存在' })
    }
    
    // 计算已使用的配额
    const usedResult = db.prepare(`
      SELECT COALESCE(SUM(quota_used), 0) as used
      FROM purchases
      WHERE user_id = ? AND status = 'active'
    `).get(req.user.id)
    
    res.json({
      total: user.quota || 0,
      used: usedResult?.used || 0,
      available: (user.quota || 0) - (usedResult?.used || 0)
    })
  } catch (error) {
    console.error('获取配额失败:', error)
    res.status(500).json({ message: '获取配额失败' })
  }
})

/**
 * 购买配额
 * 请求体: { amount: number } 购买的配额数量
 */
router.post('/buy', authenticate, (req, res) => {
  try {
    const { amount } = req.body
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: '请输入有效的购买数量' })
    }
    
    const db = getDb()
    
    // 更新用户配额
    db.prepare(`
      UPDATE users SET quota = quota + ? WHERE id = ?
    `).run(amount, req.user.id)
    
    // 获取更新后的配额
    const user = db.prepare('SELECT quota FROM users WHERE id = ?').get(req.user.id)
    
    res.json({
      message: `成功购买 ${amount} 次配额`,
      total: user.quota
    })
  } catch (error) {
    console.error('购买配额失败:', error)
    res.status(500).json({ message: '购买失败' })
  }
})

/**
 * 使用配额查询
 * 请求体: {
 *   centerLng, centerLat, radius,
 *   services: string[],
 *   cityMonth: string,
 *   quotaUsed: number  // 本次消耗的配额
 * }
 */
router.post('/use', authenticate, (req, res) => {
  try {
    const { centerLng, centerLat, radius, services, cityMonth, quotaUsed, resultData } = req.body
    
    if (quotaUsed === undefined || quotaUsed < 0) {
      return res.status(400).json({ message: '请提供正确的配额消耗数量' })
    }
    
    const db = getDb()
    
    // 检查用户可用配额
    const user = db.prepare('SELECT quota FROM users WHERE id = ?').get(req.user.id)
    const usedResult = db.prepare(`
      SELECT COALESCE(SUM(quota_used), 0) as used
      FROM purchases
      WHERE user_id = ? AND status = 'active'
    `).get(req.user.id)
    
    const available = (user.quota || 0) - (usedResult?.used || 0)
    
    if (available < quotaUsed) {
      return res.status(400).json({
        message: `配额不足，需要 ${quotaUsed} 次，当前可用 ${available} 次`
      })
    }
    
    // 创建购买记录
    const result = db.prepare(`
      INSERT INTO purchases (
        user_id, center_lng, center_lat, radius,
        city_month, services, quota_used, status, result_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      req.user.id,
      centerLng,
      centerLat,
      radius,
      cityMonth || '',
      JSON.stringify(services),
      quotaUsed,
      resultData ? JSON.stringify(resultData) : null
    )
    
    // 获取更新后的配额
    const usedAfter = db.prepare(`
      SELECT COALESCE(SUM(quota_used), 0) as used
      FROM purchases
      WHERE user_id = ? AND status = 'active'
    `).get(req.user.id)
    
    res.json({
      message: '查询成功',
      purchaseId: result.lastInsertRowid,
      quotaUsed,
      remaining: (user.quota || 0) - (usedAfter?.used || 0)
    })
  } catch (error) {
    console.error('使用配额失败:', error)
    res.status(500).json({ message: '操作失败' })
  }
})

/**
 * 获取购买历史
 */
router.get('/history', authenticate, (req, res) => {
  try {
    const db = getDb()
    const purchases = db.prepare(`
      SELECT id, center_lng, center_lat, radius, city_month, services, quota_used, created_at
      FROM purchases
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.user.id)
    
    // 解析services字段
    const formatted = purchases.map(p => ({
      ...p,
      services: p.services ? JSON.parse(p.services) : []
    }))
    
    res.json({ purchases: formatted })
  } catch (error) {
    console.error('获取历史失败:', error)
    res.status(500).json({ message: '获取历史失败' })
  }
})

/**
 * 删除购买记录（释放配额）
 */
router.delete('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDb()
    
    // 检查记录是否存在且属于当前用户
    const purchase = db.prepare(`
      SELECT * FROM purchases WHERE id = ? AND user_id = ?
    `).get(id, req.user.id)
    
    if (!purchase) {
      return res.status(404).json({ message: '记录不存在' })
    }
    
    // 软删除（改为inactive状态）
    db.prepare(`
      UPDATE purchases SET status = 'inactive' WHERE id = ?
    `).run(id)
    
    res.json({ message: '已删除' })
  } catch (error) {
    console.error('删除记录失败:', error)
    res.status(500).json({ message: '删除失败' })
  }
})

export default router
