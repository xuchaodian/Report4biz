/**
 * 联通配额「采购申请单」闭环（v1.13.218）
 * ---------------------------------------------------------------------------
 * 业务闭环（设计文档 §4.4~§4.6）：
 *   用户在 /account 的「联通人口数据配额」卡片（或任意配额不足的提示处）提交**采购意向单**
 *   → status='pending' → 我方商务（config.js::QUOTA_NOTIFY_EMAIL）收到内部通知邮件
 *   → 管理员在「用户管理 /users」看到待处理条与红点 → 受理 / 驳回。
 *
 * 🔴 设计要点（勿改坏）
 *   ① **受理 ≠ 充值**（决策 3）：accept 只改**本表** status/reviewed_*，⛔ **绝不写 users.quota**。
 *      回款/签约核对完成后，由管理员在用户管理页「设置累计总配额」另行执行。
 *      ⚠️ 若将来要做「受理即充值」，**必须用增量写法** `quota = quota + N`，
 *         ⛔ 不要走 `PUT /users/quota` 的**差值语义**（要求每次填「原值+本次量」，极易算错）。
 *   ② **不上屏单价**（决策 4）：本表只存「采购次数」；内部通知邮件里 ⛔ 也不写价。
 *   ③ **先回响应、后发信**：SMTP socketTimeout 达 30s，且发信失败不能否定「申请已提交」这一事实
 *      ⇒ `res.status(201)` 之后才调用，且必须 `.catch()` 兜住（外部 IO 绝不进事务/阻塞响应）。
 *   ④ **以库内数据为准**读账号（⛔ 不用 `req.user.role`：JWT 是**签发时快照**）。
 *   ⑤ `pool_exhausted`（平台池空）**不落本表** —— 那是用户买也没用的事，前端只给指引不建单。
 *
 * ⚠️ 幂等零迁移：quota_purchase_requests 表与索引由 models/database.js 的
 *    CREATE TABLE/INDEX IF NOT EXISTS 在启动时自动建（含 `UNIQUE(user_id) WHERE status='pending'`）。
 *
 * 回归钉子：tests/quotaRequests.test.js
 */
import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { isMailEnabled, sendQuotaPurchaseNotice } from '../utils/mailer.js'
import { QUOTA_NOTIFY_EMAIL } from '../config.js'

const router = express.Router()

/** 字段长度上限（服务端兜底，防超长文本把库撑起来）；与前端表单 maxlength 同口径 */
const FIELD_MAX = {
  company: 100,
  department: 100,
  contact_name: 60,
  contact_email: 120,
  contact_phone: 30,
  purpose: 200,
  expect_date: 20
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** 联系电话：允许数字、+、-、空格、括号与分机号（'转'/'#'），6~24 位（与 VIP 申请同口径） */
const PHONE_RE = /^[0-9+\-() #转ext.]{6,24}$/i

/** 以库内数据为准读取账号（⛔ 不要用 req.user.role 代替，见文件头 ④） */
function loadUser(db, id) {
  const uid = Number(id)
  if (!uid) return null
  return db.prepare('SELECT id, username, email, role, company FROM users WHERE id = ?').get(uid) || null
}

/** 取审核人显示名（优先 JWT 载荷，缺失则回库查） */
function reviewerName(db, req) {
  if (req.user && req.user.username) return String(req.user.username)
  const u = loadUser(db, req.user?.id)
  return u ? u.username : ''
}

/**
 * 申请人所属集团 id —— 便于我方判断走哪条商务线。
 *   集团成员 ⇒ org_members.org_id；集团总部 ⇒ organizations.owner_user_id（总部**不写** org_members）；
 *   独立账号 ⇒ null。
 */
function orgIdOf(db, userId) {
  const uid = Number(userId)
  if (!uid) return null
  try {
    const m = db.prepare('SELECT org_id FROM org_members WHERE user_id = ?').get(uid)
    if (m && m.org_id) return Number(m.org_id)
    const o = db.prepare(
      `SELECT id FROM organizations WHERE owner_user_id = ? AND dissolved_at IS NULL ORDER BY id LIMIT 1`
    ).get(uid)
    if (o && o.id) return Number(o.id)
  } catch (e) {
    // org 相关表缺失/结构异常不应阻断采购申请（辅助字段而已）
    console.warn('[quota-requests] 解析 org_id 失败:', e.message)
  }
  return null
}

// ===========================================================================
// 普通用户侧
// ===========================================================================

/**
 * 提交配额采购申请
 * body: { company, department, contact_name, contact_email, contact_phone, want_amount, purpose?, expect_date? }
 * 已有 pending ⇒ 400（防重复）。
 */
router.post('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const me = loadUser(db, req.user?.id)
    if (!me) return res.status(404).json({ message: '账号不存在' })

    const company = String(req.body?.company ?? '').trim()
    const department = String(req.body?.department ?? '').trim()
    const contactName = String(req.body?.contact_name ?? '').trim()
    const contactEmail = String(req.body?.contact_email ?? '').trim()
    const contactPhone = String(req.body?.contact_phone ?? '').trim()
    const purpose = String(req.body?.purpose ?? '').trim()
    const expectDate = String(req.body?.expect_date ?? '').trim()
    const wantAmountRaw = req.body?.want_amount

    const missing = []
    if (!company) missing.push('公司名')
    if (!department) missing.push('所在部门')
    if (!contactName) missing.push('联系人')
    if (!contactEmail) missing.push('电子邮箱')
    if (!contactPhone) missing.push('联系电话')
    if (wantAmountRaw === undefined || wantAmountRaw === null || wantAmountRaw === '') missing.push('采购次数')
    if (missing.length) {
      return res.status(400).json({ message: `请填写：${missing.join('、')}` })
    }

    const wantAmount = Number(wantAmountRaw)
    if (!Number.isInteger(wantAmount) || wantAmount < 1) {
      return res.status(400).json({ message: '采购次数必须为不小于 1 的整数' })
    }
    if (wantAmount > 1000000) {
      return res.status(400).json({ message: '采购次数过大，请与商务直接联系' })
    }

    const fields = {
      company, department, contact_name: contactName, contact_email: contactEmail,
      contact_phone: contactPhone, purpose, expect_date: expectDate
    }
    for (const [k, max] of Object.entries(FIELD_MAX)) {
      if (fields[k] && fields[k].length > max) {
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
      `SELECT id, created_at FROM quota_purchase_requests WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`
    ).get(me.id)
    if (pending) {
      return res.status(400).json({ message: '您已提交过采购申请，请等待我方联系', requestId: pending.id })
    }

    const orgId = orgIdOf(db, me.id)

    let result
    try {
      result = db.prepare(`
        INSERT INTO quota_purchase_requests
          (user_id, org_id, username, company, department, contact_name, contact_email, contact_phone,
           want_amount, purpose, expect_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        me.id, orgId, me.username, company, department, contactName, contactEmail, contactPhone,
        wantAmount, purpose || null, expectDate || null
      )
    } catch (e) {
      // 部分唯一索引 ux_quota_req_pending 兜底（并发下才会走到；单进程下正常不触发）
      if (String(e.message || '').includes('UNIQUE')) {
        return res.status(400).json({ message: '您已提交过采购申请，请等待我方联系' })
      }
      throw e
    }

    const created = db.prepare('SELECT * FROM quota_purchase_requests WHERE id = ?').get(result.lastInsertRowid)

    res.status(201).json({ message: '申请已提交，我方将与您联系确认合同与付款事宜', request: created })

    // ---- 以下为「已提交」之后的副作用，绝不影响上面的响应 ----
    // ⚠️ 先回响应、后发信：① SMTP socketTimeout 30s，await 会让用户干等；
    //    ② 发信失败不应影响「申请已提交」这个既成事实。
    if (isMailEnabled()) {
      sendQuotaPurchaseNotice({
        to: QUOTA_NOTIFY_EMAIL,
        requestId: created.id,
        applicant: me.username,
        company,
        department,
        contactName,
        contactEmail,
        contactPhone,
        wantAmount,
        purpose,
        expectDate,
        createdAt: created.created_at
      }).catch((e) => {
        console.error('[quota-requests] 内部通知邮件发送失败:', e?.message || e)
      })
    } else {
      console.warn('[quota-requests] 邮件未配置，跳过内部通知（站内单已落库）')
    }
  } catch (error) {
    console.error('[quota-requests] 提交采购申请失败:', error)
    res.status(500).json({ message: '提交采购申请失败' })
  }
})

/**
 * 我的采购申请（取最近一条）—— 供 /account 决定按钮/状态展示：
 *   无申请 ⇒ null；pending ⇒ 「已提交，等待我方联系」；rejected ⇒ 显示理由并允许重新申请；
 *   accepted ⇒ 已受理（⛔ 不等于已到账，充值另行）。
 */
router.get('/mine', authenticate, (req, res) => {
  try {
    const db = getDb()
    const me = loadUser(db, req.user?.id)
    if (!me) return res.status(404).json({ message: '账号不存在' })

    const request = db.prepare(
      `SELECT id, status, company, department, contact_name, contact_email, contact_phone,
              want_amount, purpose, expect_date, created_at, reviewed_at, reviewed_by_name, review_note
         FROM quota_purchase_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1`
    ).get(me.id) || null

    res.json({ request })
  } catch (error) {
    console.error('[quota-requests] 读取我的采购申请失败:', error)
    res.status(500).json({ message: '读取采购申请失败' })
  }
})

// ===========================================================================
// 管理端
// ===========================================================================

/**
 * 待处理数量 —— 入口红点专用（轻量，只回一个数）。
 * ⚠️ 路由顺序：必须排在 `GET /` 与动态段之前。
 */
router.get('/pending-count', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const pendingCount = db.prepare(
      `SELECT COUNT(*) AS c FROM quota_purchase_requests WHERE status = 'pending'`
    ).get()?.c || 0
    res.json({ pendingCount })
  } catch (error) {
    console.error('[quota-requests] 统计待处理失败:', error)
    res.status(500).json({ message: '统计待处理采购申请失败' })
  }
})

/**
 * 申请列表（管理员）。query: status=pending|accepted|rejected|all（默认 all）、limit（默认 200，上限 500）
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
      if (!['pending', 'accepted', 'rejected'].includes(status)) {
        return res.status(400).json({ message: 'status 取值不合法' })
      }
      where.push('a.status = ?')
      params.push(status)
      wherePlain = 'WHERE status = ?'
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    // 联表取**当前**账号信息（role 可能已变），申请单里的 username 是提交时快照
    const requests = db.prepare(`
      SELECT a.*, u.role AS current_role, u.username AS current_username, u.company AS current_company,
             u.quota AS current_quota
        FROM quota_purchase_requests a
        LEFT JOIN users u ON u.id = a.user_id
        ${whereSql}
       ORDER BY a.status = 'pending' DESC, a.id DESC
       LIMIT ?
    `).all(...params, limit)

    const pendingCount = db.prepare(
      `SELECT COUNT(*) AS c FROM quota_purchase_requests WHERE status = 'pending'`
    ).get()?.c || 0
    // ⚠️ 计数走单表，**不能**复用带 `a.` 别名的 whereSql（该查询无别名 ⇒ 直接 SQL 报错）
    const total = db.prepare(`SELECT COUNT(*) AS c FROM quota_purchase_requests ${wherePlain}`).get(...params)?.c || 0

    res.json({ requests, pendingCount, total })
  } catch (error) {
    console.error('[quota-requests] 读取申请列表失败:', error)
    res.status(500).json({ message: '读取申请列表失败' })
  }
})

/**
 * 受理申请 —— **仅标记已受理，不充值**（决策 3）。
 * 🔴 本处理函数只写 quota_purchase_requests 一行 ⇒ 单条 UPDATE 自身即原子，无需事务。
 *    ⛔ 绝不出现任何 `UPDATE users ... SET quota`（回归钉子：tests/quotaRequests.test.js）。
 */
router.post('/:id/accept', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const row = db.prepare('SELECT * FROM quota_purchase_requests WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ message: '申请不存在' })
    if (row.status !== 'pending') {
      return res.status(400).json({ message: `该申请已处理（当前状态：${row.status}），请刷新后查看` })
    }

    const reviewer = reviewerName(db, req)
    db.prepare(`
      UPDATE quota_purchase_requests
         SET status = 'accepted', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, reviewed_by_name = ?
       WHERE id = ?
    `).run(Number(req.user?.id) || null, reviewer, row.id)

    const updated = db.prepare('SELECT * FROM quota_purchase_requests WHERE id = ?').get(row.id)
    res.json({
      message: `已受理 ${row.username || ''} 的采购申请。充值请在「用户管理」页单独执行。`.trim(),
      request: updated,
      quotaUnchanged: true
    })
  } catch (error) {
    console.error('[quota-requests] 受理采购申请失败:', error)
    res.status(500).json({ message: '受理采购申请失败' })
  }
})

/**
 * 驳回申请。body: { review_note? } —— 理由会展示给申请人（可据此重新申请）。
 * 只改申请单状态，**不动** users 任何字段。
 */
router.post('/:id/reject', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const row = db.prepare('SELECT * FROM quota_purchase_requests WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ message: '申请不存在' })
    if (row.status !== 'pending') {
      return res.status(400).json({ message: `该申请已处理（当前状态：${row.status}），请刷新后查看` })
    }

    const note = String(req.body?.review_note ?? '').trim().slice(0, 200)
    const reviewer = reviewerName(db, req)

    db.prepare(`
      UPDATE quota_purchase_requests
         SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, reviewed_by_name = ?, review_note = ?
       WHERE id = ?
    `).run(Number(req.user?.id) || null, reviewer, note || null, row.id)

    res.json({ message: `已驳回 ${row.username || ''} 的采购申请`.trim() })
  } catch (error) {
    console.error('[quota-requests] 驳回采购申请失败:', error)
    res.status(500).json({ message: '驳回采购申请失败' })
  }
})

export default router
