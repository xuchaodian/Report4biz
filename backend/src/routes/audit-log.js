/**
 * 审计日志查询接口（v1.13.321）
 *
 * 只有两个端点，**全是 admin 专属** ⇒ 这里可以（也应该）用组级挂载。
 * ⚠️ 对比 city-data.js：那边 GET 要公开、写接口要 admin，所以**不能**组级挂载
 *    （组级会把 GET 一起关掉）。判断依据永远是「本文件里有没有需要公开的端点」。
 *
 * 分页约定：page 从 1 开始，pageSize 上限 200（防止一次拖走整张表 ——
 * 审计表会长期增长，不设上限的话前端「导出全部」这类误操作会卡死 sql.js 的整库序列化）。
 */
import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { AUDIT_ACTIONS } from '../utils/auditLog.js'

const router = express.Router()

// 组级：本文件的每一条都需要 admin
router.use(authenticate, requireAdmin)

const MAX_PAGE_SIZE = 200

/** 动作码清单（给前端筛选下拉用，⛔ 不要让前端自己维护一份） */
router.get('/actions', (req, res) => {
  res.json({
    success: true,
    actions: Object.entries(AUDIT_ACTIONS).map(([key, value]) => ({ key, value })),
  })
})

/**
 * GET /api/audit-log
 * query: page, pageSize, actor, action, targetType, targetId, from, to
 *   · actor      按**操作人用户名**模糊匹配（actor_name 是快照，改名后仍按当时名字查得到）
 *   · action     精确匹配动作码（见 GET /actions）
 *   · from/to    按 created_at 比较，格式 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss`（**UTC**）
 *                ⚠️ 库里存的是 sql.js 的 CURRENT_TIMESTAMP，即 UTC 无时区标记；
 *                   前端展示时须当 UTC 解析再本地化，否则会差 8 小时。
 */
router.get('/', (req, res) => {
  try {
    const db = getDb()

    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize, 10) || 50))
    const offset = (page - 1) * pageSize

    const conds = []
    const params = []

    if (req.query.actor) {
      conds.push('actor_name LIKE ?')
      params.push(`%${String(req.query.actor).trim()}%`)
    }
    if (req.query.action) {
      conds.push('action = ?')
      params.push(String(req.query.action))
    }
    if (req.query.targetType) {
      conds.push('target_type = ?')
      params.push(String(req.query.targetType))
    }
    if (req.query.targetId) {
      conds.push('target_id = ?')
      params.push(String(req.query.targetId))
    }
    if (req.query.from) {
      conds.push('created_at >= ?')
      params.push(String(req.query.from))
    }
    if (req.query.to) {
      // 只给日期时补到当天末尾，否则 `<= 2026-11-06` 会把当天全漏掉
      const to = String(req.query.to)
      conds.push('created_at <= ?')
      params.push(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to} 23:59:59` : to)
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

    const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_log ${where}`).get(...params)?.c || 0
    const rows = db
      .prepare(`SELECT id, actor_id, actor_name, actor_role, action, target_type, target_id, detail, ip, user_agent, created_at FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset)

    // detail 是 JSON 串；解析失败就原样返回（宁可显示原文也不要整条消失）
    const list = rows.map((r) => {
      let parsed = null
      if (r.detail) {
        try { parsed = JSON.parse(r.detail) } catch (e) { parsed = { _raw: r.detail } }
      }
      return { ...r, detail: parsed }
    })

    res.json({ success: true, total, page, pageSize, rows: list })
  } catch (error) {
    console.error('[audit-log] 查询失败:', error)
    res.status(500).json({ success: false, message: '查询失败' })
  }
})

/** 概览：最近 7 天各动作条数（给页面顶部的小统计用） */
router.get('/summary', (req, res) => {
  try {
    const db = getDb()
    const rows = db
      .prepare(`
        SELECT action, COUNT(*) AS c
          FROM audit_log
         WHERE created_at >= datetime('now', '-7 days')
         GROUP BY action
         ORDER BY c DESC
      `)
      .all()
    const total = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get()?.c || 0
    res.json({ success: true, total, last7Days: rows })
  } catch (error) {
    console.error('[audit-log] 统计失败:', error)
    res.status(500).json({ success: false, message: '统计失败' })
  }
})

export default router
