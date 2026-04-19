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
    
    // 获取运营商当前剩余配额
    const quotaRecord = db.prepare(`SELECT initial_quota, remaining_quota FROM admin_quota WHERE id = 1`).get()
    const initialQuota = quotaRecord?.initial_quota || 0
    const remainingQuota = quotaRecord?.remaining_quota || 0
    
    res.json({
      total: user.quota || 0,  // 用户已分配次数
      used: usedResult?.used || 0,  // 用户已使用次数
      available: (user.quota || 0) - (usedResult?.used || 0),  // 用户剩余次数（仅展示用）
      initialQuota,  // 初始总配额
      remainingQuota  // 运营商当前剩余配额
    })
  } catch (error) {
    console.error('获取配额失败:', error)
    res.status(500).json({ message: '获取配额失败' })
  }
})

/**
 * 购买配额（此接口已停用，配额需通过管理员从联通购买）
 */
router.post('/buy', authenticate, (req, res) => {
  try {
    // 此接口已停用，用户配额需通过管理员分配
    res.status(403).json({ 
      message: '配额购买功能已停用，请联系管理员从运营商购买配额后分配给您' 
    })
  } catch (error) {
    console.error('购买配额失败:', error)
    res.status(500).json({ message: '操作失败' })
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
    
    // 检查运营商当前剩余配额是否足够
    const quotaRecord = db.prepare(`SELECT remaining_quota FROM admin_quota WHERE id = 1`).get()
    const available = quotaRecord?.remaining_quota || 0
    
    if (available < quotaUsed) {
      return res.status(400).json({
        message: `运营商剩余配额不足，需要 ${quotaUsed} 次，当前剩余 ${available} 次。请联系管理员追加配额。`
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
    
    // 扣减运营商当前剩余配额
    db.prepare(`UPDATE admin_quota SET remaining_quota = remaining_quota - ? WHERE id = 1`).run(quotaUsed)
    
    // 获取更新后的配额
    const newQuotaRecord = db.prepare(`SELECT initial_quota, remaining_quota FROM admin_quota WHERE id = 1`).get()
    
    res.json({
      message: '查询成功',
      purchaseId: result.lastInsertRowid,
      quotaUsed,
      initialQuota: newQuotaRecord?.initial_quota || 0,
      remainingQuota: newQuotaRecord?.remaining_quota || 0
    })
  } catch (error) {
    console.error('使用配额失败:', error)
    res.status(500).json({ message: '操作失败' })
  }
})

/**
 * 获取购买历史（静态路由必须在 /:id 之前）
 */
router.get('/history', authenticate, (req, res) => {
  try {
    const db = getDb()

    // 获取用户总配额
    const user = db.prepare('SELECT quota FROM users WHERE id = ?').get(req.user.id)
    const totalQuota = user?.quota || 0

    // 查询购买记录，关联门店表获取城市和区县
    const purchases = db.prepare(`
      SELECT
        p.id,
        p.store_name,
        p.store_type,
        p.center_lng,
        p.center_lat,
        p.radius,
        p.city_month,
        p.quota_used,
        p.created_at,
        m.city,
        m.district
      FROM purchases p
      LEFT JOIN markers m ON m.name = p.store_name AND m.user_id = p.user_id
      WHERE p.user_id = ? AND p.status = 'active'
      ORDER BY p.created_at DESC
      LIMIT 100
    `).all(req.user.id)

    // 计算每条记录后的剩余配额（顺序累加，然后从总配额中减去）
    let cumulativeUsed = 0
    const formatted = purchases.map(p => {
      const previousRemaining = totalQuota - cumulativeUsed
      cumulativeUsed += p.quota_used || 0
      const currentRemaining = totalQuota - cumulativeUsed
      return {
        id: p.id,
        store_name: p.store_name || '-',
        store_type: p.store_type || '-',
        center_lng: p.center_lng,
        center_lat: p.center_lat,
        radius: p.radius,
        city_month: p.city_month,
        quota_used: p.quota_used || 0,
        remaining: currentRemaining,  // 当前剩余 = 总配额 - 累计已使用
        created_at: p.created_at,
        // 优先使用门店表的地址，如果没有则显示坐标
        city: p.city || '-',
        district: p.district || '-',
        location: (p.city || p.district) ? `${p.city || ''}${p.district || ''}`.replace(/^,|,$/g, '') : '-'
      }
    })

    // 解析半径显示
    const enriched = formatted.map(p => {
      let radiusDisplay = p.radius
      try {
        const radii = JSON.parse(p.radius)
        if (Array.isArray(radii)) {
          radiusDisplay = radii.map(r => r + '米').join(', ')
        }
      } catch (e) {}
      if (typeof radiusDisplay === 'number') {
        radiusDisplay = radiusDisplay + ' 米'
      }
      return {
        ...p,
        radius_display: radiusDisplay
      }
    })

    res.json({ purchases: enriched })
  } catch (error) {
    console.error('获取历史失败:', error)
    res.status(500).json({ message: '获取历史失败' })
  }
})

/**
 * 批量获取门店购买次数（一次查询所有门店）
 */
router.get('/store-counts', authenticate, (req, res) => {
  try {
    const db = getDb()

    // 查询所有门店的购买次数（按 store_name 分组）
    const counts = db.prepare(`
      SELECT 
        store_name,
        COUNT(*) as count
      FROM purchases
      WHERE user_id = ? AND status = 'active' AND store_name IS NOT NULL AND store_name != ''
      GROUP BY store_name
    `).all(req.user.id)

    // 转换为 {门店名称: 次数} 的格式
    const result = {}
    counts.forEach(item => {
      result[item.store_name] = item.count
    })

    res.json({ counts: result })
  } catch (error) {
    console.error('获取门店购买次数失败:', error)
    res.status(500).json({ message: '获取失败' })
  }
})

/**
 * 按门店名称查询购买履历
 */
router.get('/by-store/:storeName', authenticate, (req, res) => {
  try {
    const { storeName } = req.params
    const db = getDb()

    const purchases = db.prepare(`
      SELECT
        p.id,
        p.store_name,
        p.store_type,
        p.center_lng,
        p.center_lat,
        p.radius,
        p.city_month,
        p.quota_used,
        p.created_at,
        m.city,
        m.district
      FROM purchases p
      LEFT JOIN markers m ON m.name = p.store_name AND m.user_id = p.user_id
      WHERE p.user_id = ? AND p.store_name = ? AND p.status = 'active'
      ORDER BY p.created_at DESC
    `).all(req.user.id, storeName)

    res.json({ purchases })
  } catch (error) {
    console.error('获取门店购买履历失败:', error)
    res.status(500).json({ message: '获取失败' })
  }
})

/**
 * 获取单个购买记录详情（包含查询结果）
 */
router.get('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDb()

    const purchase = db.prepare(`
      SELECT
        p.*,
        m.city,
        m.district
      FROM purchases p
      LEFT JOIN markers m ON m.name = p.store_name AND m.user_id = p.user_id
      WHERE p.id = ? AND p.user_id = ? AND p.status = 'active'
    `).get(id, req.user.id)

    if (!purchase) {
      return res.status(404).json({ message: '记录不存在' })
    }

    // 解析 result_data
    let resultData = null
    if (purchase.result_data) {
      try {
        resultData = JSON.parse(purchase.result_data)
        // 过滤掉 1016 服务的条目
        if (Array.isArray(resultData)) {
          resultData = resultData.filter(item => item.service_code !== '1016' && item.service_code !== 1016)
        } else if (resultData && typeof resultData === 'object') {
          delete resultData['1016']
        }
      } catch (e) {
        resultData = purchase.result_data
      }
    }

    // 解析半径
    let radii = []
    try {
      radii = JSON.parse(purchase.radius)
    } catch (e) {
      radii = [purchase.radius]
    }

    res.json({
      id: purchase.id,
      store_name: purchase.store_name,
      store_type: purchase.store_type,
      center_lng: purchase.center_lng,
      center_lat: purchase.center_lat,
      radii: radii,
      city_month: purchase.city_month,
      quota_used: purchase.quota_used,
      created_at: purchase.created_at,
      city: purchase.city,
      district: purchase.district,
      result_data: resultData
    })
  } catch (error) {
    console.error('获取详情失败:', error)
    res.status(500).json({ message: '获取详情失败' })
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
