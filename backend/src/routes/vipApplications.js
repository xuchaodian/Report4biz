/**
 * VIP 试用申请与审批（v1.13.205）
 * ---------------------------------------------------------------------------
 * 业务闭环：
 *   普通用户（role='user'）在「我的账户 /account」点「体验 VIP 用户」→ 填写
 *   公司名 / 所在部门 / 联系人 / 电子邮箱 / 联系电话 → 提交申请（status='pending'）。
 *   管理员在「用户管理 /users」看到待处理提示条与入口红点 → 通过 / 驳回。
 *   通过 ⇒ 该账号 role='trial' 且 vip_until = 今天 + 30 天（30 天 VIP 试用），
 *   到期由 app.js 的 6 小时定时器自动降级回 role='user'。
 *
 * 🔴 设计要点（勿改坏）
 *   ① 谁能申请：**以库内 role 为准**，而不是 JWT 载荷里的 role。
 *      middleware/auth.js 把 req.user 直接置为 decoded ⇒ JWT 里的 role 是**签发时快照**，
 *      管理员刚把某人改成 vip、该用户手上旧 token 仍写着 'user'。若按 JWT 判，会出现
 *      「已是 VIP 的人再提交一份试用申请」。故本文件一律 loadUser() 读库判定。
 *   ② 谁能审批：requireAdmin（与 users.js 同口径，判 JWT 载荷 —— 该判据的已知局限见
 *      users.js 中 v1.13.202 的注释，不在此处重复造第二套）。
 *   ③ 申请人**不能**通过任何字段自提权限 —— 本文件只写申请单，绝不写 users.role；
 *      唯一改角色的入口是下面的 approve，且必须管理员。
 *   ④ approve 是**单事务**：users.role / users.vip_until / 申请单 status 三处要么全成、
 *      要么全不动。半截状态会让用户「申请单显示已通过但账号仍是普通用户」。
 *   ⑤ 🔴 approve 必须挡「降级」：若目标账号当前已是 vip / admin（例如管理员在待审期间
 *      手工给他开了正式 VIP），审批通过会把 role 覆盖成 trial + 30 天 ⇒ **把 1 年正式
 *      VIP 砍成 30 天试用**，且无任何报错。故此处显式拦截。
 *
 * ⚠️ 幂等零迁移：vip_applications 表由 models/database.js 的 CREATE TABLE IF NOT EXISTS
 *    在启动时自动建（含 (status, created_at) / (user_id, status) 两个索引，
 *    以及 `UNIQUE(user_id) WHERE status='pending'` 的部分唯一索引兜底防重复申请）。
 */
import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { calcVipUntil } from '../utils/vipRole.js'

const router = express.Router()

/** 申请单字段长度上限（服务端兜底，防超长文本把库撑起来） */
const FIELD_MAX = {
  company: 100,
  department: 100,
  contact_name: 60,
  contact_email: 120,
  contact_phone: 30
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** 联系电话：允许数字、+、-、空格、括号与分机号（'转'/'#'），6~24 位 */
const PHONE_RE = /^[0-9+\-() #转ext.]{6,24}$/i

/** 以库内数据为准读取账号（⛔ 不要用 req.user.role 代替，见文件头 ①） */
function loadUser(db, id) {
  const uid = Number(id)
  if (!uid) return null
  return db.prepare('SELECT id, username, email, role, vip_until FROM users WHERE id = ?').get(uid) || null
}

/** 取审核人显示名（优先 JWT 载荷，缺失则回库查） */
function reviewerName(db, req) {
  if (req.user && req.user.username) return String(req.user.username)
  const u = loadUser(db, req.user?.id)
  return u ? u.username : ''
}

// ===========================================================================
// 普通用户侧
// ===========================================================================

/**
 * 提交 VIP 试用申请
 * body: { company, department, contact_name, contact_email, contact_phone }
 * 仅 role='user' 可申请；已有 pending ⇒ 400（防重复）。
 */
router.post('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const me = loadUser(db, req.user?.id)
    if (!me) return res.status(404).json({ message: '账号不存在' })

    if (me.role !== 'user') {
      const label = me.role === 'admin' ? '管理员' : me.role === 'vip' ? 'VIP 用户' : 'VIP 试用用户'
      return res.status(400).json({ message: `当前账号身份为${label}，无需提交 VIP 试用申请` })
    }

    const company = String(req.body?.company ?? '').trim()
    const department = String(req.body?.department ?? '').trim()
    const contactName = String(req.body?.contact_name ?? '').trim()
    const contactEmail = String(req.body?.contact_email ?? '').trim()
    const contactPhone = String(req.body?.contact_phone ?? '').trim()

    const missing = []
    if (!company) missing.push('公司名')
    if (!department) missing.push('所在部门')
    if (!contactName) missing.push('联系人')
    if (!contactEmail) missing.push('电子邮箱')
    if (!contactPhone) missing.push('联系电话')
    if (missing.length) {
      return res.status(400).json({ message: `请填写：${missing.join('、')}` })
    }

    for (const [k, max] of Object.entries(FIELD_MAX)) {
      const v = { company, department, contact_name: contactName, contact_email: contactEmail, contact_phone: contactPhone }[k]
      if (v.length > max) {
        return res.status(400).json({ message: `字段过长：${k} 最多 ${max} 个字符` })
      }
    }
    if (!EMAIL_RE.test(contactEmail)) {
      return res.status(400).json({ message: '电子邮箱格式不正确' })
    }
    if (!PHONE_RE.test(contactPhone)) {
      return res.status(400).json({ message: '联系电话格式不正确' })
    }

    const pending = db.prepare(
      `SELECT id, created_at FROM vip_applications WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`
    ).get(me.id)
    if (pending) {
      return res.status(400).json({ message: '您已提交过申请，请等待管理员审核', applicationId: pending.id })
    }

    let result
    try {
      result = db.prepare(`
        INSERT INTO vip_applications
          (user_id, username, company, department, contact_name, contact_email, contact_phone, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(me.id, me.username, company, department, contactName, contactEmail, contactPhone)
    } catch (e) {
      // 部分唯一索引 ux_vip_app_pending 兜底（并发下才会走到；单进程下正常不触发）
      if (String(e.message || '').includes('UNIQUE')) {
        return res.status(400).json({ message: '您已提交过申请，请等待管理员审核' })
      }
      throw e
    }

    const created = db.prepare('SELECT * FROM vip_applications WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ message: '申请已提交，请等待管理员审核', application: created })
  } catch (error) {
    console.error('[vip-applications] 提交申请失败:', error)
    res.status(500).json({ message: '提交申请失败' })
  }
})

/**
 * 我的申请（取最近一条）—— 供 /account 决定按钮/状态展示：
 *   无申请 ⇒ null；pending ⇒ 显示「已提交，等待审核」；rejected ⇒ 显示理由并允许重新申请；
 *   approved ⇒ 已生效（正常情况下此时 role 已是 trial）。
 */
router.get('/mine', authenticate, (req, res) => {
  try {
    const db = getDb()
    const me = loadUser(db, req.user?.id)
    if (!me) return res.status(404).json({ message: '账号不存在' })

    const application = db.prepare(
      `SELECT id, status, company, department, contact_name, contact_email, contact_phone,
              created_at, reviewed_at, reviewed_by_name, review_note
         FROM vip_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    ).get(me.id) || null

    res.json({ role: me.role, application })
  } catch (error) {
    console.error('[vip-applications] 读取我的申请失败:', error)
    res.status(500).json({ message: '读取申请失败' })
  }
})

// ===========================================================================
// 管理端
// ===========================================================================

/**
 * 待处理数量 —— 入口红点专用（轻量，只回一个数）。
 * ⚠️ 路由顺序：必须排在 `GET /:id` 之类的动态段之前（本文件无动态 GET，但保留此位置以防将来新增）。
 */
router.get('/pending-count', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const pendingCount = db.prepare(`SELECT COUNT(*) AS c FROM vip_applications WHERE status = 'pending'`).get()?.c || 0
    res.json({ pendingCount })
  } catch (error) {
    console.error('[vip-applications] 统计待处理失败:', error)
    res.status(500).json({ message: '统计待处理申请失败' })
  }
})

/**
 * 申请列表（管理员）。query: status=pending|approved|rejected|all（默认 all）、limit（默认 200，上限 500）
 * 返回 pendingCount 便于前端提示条与列表一次拿全。
 */
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const status = String(req.query?.status || 'all')
    const limitRaw = parseInt(req.query?.limit, 10)
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200

    const where = []
    const params = []
    let wherePlain = ''      // 不带表别名的版本（用于单表 COUNT）
    if (status !== 'all') {
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ message: 'status 取值不合法' })
      }
      where.push('a.status = ?')
      params.push(status)
      wherePlain = 'WHERE status = ?'
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    // 联表取**当前**账号信息（role 可能已变），申请单里的 username 是提交时快照
    const applications = db.prepare(`
      SELECT a.*, u.role AS current_role, u.username AS current_username, u.vip_until AS current_vip_until
        FROM vip_applications a
        LEFT JOIN users u ON u.id = a.user_id
        ${whereSql}
       ORDER BY a.status = 'pending' DESC, a.id DESC
       LIMIT ?
    `).all(...params, limit)

    const pendingCount = db.prepare(`SELECT COUNT(*) AS c FROM vip_applications WHERE status = 'pending'`).get()?.c || 0
    // ⚠️ 计数走单表，**不能**复用带 `a.` 别名的 whereSql（该查询无别名 ⇒ 直接 SQL 报错）
    const total = db.prepare(`SELECT COUNT(*) AS c FROM vip_applications ${wherePlain}`).get(...params)?.c || 0

    res.json({ applications, pendingCount, total })
  } catch (error) {
    console.error('[vip-applications] 读取申请列表失败:', error)
    res.status(500).json({ message: '读取申请列表失败' })
  }
})

/**
 * 通过申请 ⇒ 该账号变为 30 天 VIP 试用（role='trial' + vip_until=今天+30d）
 * 🔴 单事务 + 降级拦截，见文件头 ④⑤。
 */
router.post('/:id/approve', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const app = db.prepare('SELECT * FROM vip_applications WHERE id = ?').get(req.params.id)
    if (!app) return res.status(404).json({ message: '申请不存在' })
    if (app.status !== 'pending') {
      return res.status(400).json({ message: `该申请已处理（当前状态：${app.status}），请刷新后查看` })
    }

    const target = loadUser(db, app.user_id)
    if (!target) return res.status(404).json({ message: '申请人账号已不存在' })

    // 🔴 降级拦截：不能把正式 VIP / 管理员覆盖成 30 天试用
    if (target.role === 'vip' || target.role === 'admin') {
      const label = target.role === 'admin' ? '管理员' : '正式 VIP 用户'
      return res.status(400).json({
        message: `该账号当前已是${label}，通过试用申请会将其降级为 30 天试用，已阻止。如无需处理请驳回该申请。`
      })
    }

    const vipUntil = calcVipUntil('trial')   // 今天 + 30 天（与新建「VIP试用」同一口径）
    if (!vipUntil) {
      // 理论上不可达：VIP_DAYS.trial 为常量 30。留着是为了「口径被改动」时立刻炸出来而非静默写 null。
      return res.status(500).json({ message: 'VIP 试用天数未配置' })
    }

    const reviewer = reviewerName(db, req)
    db.beginTx()
    try {
      db.prepare(`UPDATE users SET role = 'trial', vip_until = ? WHERE id = ?`).run(vipUntil, target.id)
      db.prepare(`
        UPDATE vip_applications
           SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, reviewed_by_name = ?
         WHERE id = ?
      `).run(Number(req.user?.id) || null, reviewer, app.id)
      db.commitTx()   // 内含统一落盘
    } catch (e) {
      try { db.rollbackTx() } catch (e2) { /* 事务已结束等情况忽略 */ }
      throw e
    }

    const user = db.prepare('SELECT id, username, email, role, vip_until FROM users WHERE id = ?').get(target.id)
    res.json({ message: `已通过：${target.username} 已成为 VIP 试用用户（有效期至 ${vipUntil}）`, user })
  } catch (error) {
    console.error('[vip-applications] 通过申请失败:', error)
    res.status(500).json({ message: '通过申请失败' })
  }
})

/**
 * 驳回申请。body: { review_note? } —— 理由会展示给申请人（可据此重新申请）。
 * 只改申请单状态，**不动** users 任何字段。
 */
router.post('/:id/reject', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const app = db.prepare('SELECT * FROM vip_applications WHERE id = ?').get(req.params.id)
    if (!app) return res.status(404).json({ message: '申请不存在' })
    if (app.status !== 'pending') {
      return res.status(400).json({ message: `该申请已处理（当前状态：${app.status}），请刷新后查看` })
    }

    const note = String(req.body?.review_note ?? '').trim().slice(0, 200)
    const reviewer = reviewerName(db, req)

    db.prepare(`
      UPDATE vip_applications
         SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, reviewed_by_name = ?, review_note = ?
       WHERE id = ?
    `).run(Number(req.user?.id) || null, reviewer, note || null, app.id)

    res.json({ message: `已驳回 ${app.username || ''} 的申请`.trim() })
  } catch (error) {
    console.error('[vip-applications] 驳回申请失败:', error)
    res.status(500).json({ message: '驳回申请失败' })
  }
})

export default router
