// ============================================================================
// 集团 / 子公司组织管理（v0.9 P0 批次 B）
// 设计方案 §6「组织管理 + 我的组织」8 个接口 · 规则总表 §8
// ----------------------------------------------------------------------------
// 本批**只做组织与人**：建集团、绑成员、改开关、解绑、我的组织、成员知情确认。
// 不涉及：管辖范围 scope 编辑（批次 C）、同步引擎（批次 D）、配额分配（P1.5）。
// 因此这里**不写任何配额增减**，成员的 users.quota 在本文件中恒为只读展示。
//
// ★ 关键设计：集团总部账号（organizations.owner_user_id）**不写入 org_members**。
//   理由：org_members 是「授权闸门」的启用开关（utils/quotaPool.js::isOrgMember，规则 20）。
//   存量集团账号（如 youshi）历史 users.quota 远小于历史消耗，一旦成为成员会被闸门
//   瞬间判「额度耗尽」而无法查询。总部账号的额度语义 = 由物理池兜底，与改动前一致。
//   ⇒ 成员集合与「总部」是两个概念：成员是原子的、可被闸门约束的账号。
//
// ★ 8 个接口（顺序铁律：本批全部为「组织结构」，不含数据搬运与配额）
//   组织管理（平台 admin）：POST /api/orgs · GET /api/orgs
//                          POST /api/orgs/:id/members · PATCH · DELETE
//   我的组织（集团/成员）：GET /api/orgs/me · POST /api/orgs/me/consent
//                          PATCH /api/orgs/me/settings
// ============================================================================

import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const router = express.Router()

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 正整数路径参数；非法返回 null（避免 SQLite 把 'abc' 当 0 处理） */
function toId(v) {
  const n = Number.parseInt(v, 10)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 归一化 scope_json —— 只到城市级（规则 11）；损坏的 JSON 视为未设置 */
function parseScope(raw) {
  if (!raw) return null
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw
    const cities = Array.isArray(o?.cities) ? o.cities.filter(Boolean) : []
    const brands = Array.isArray(o?.brands) ? o.brands.filter(Boolean) : []
    return { cities, brands }
  } catch (e) {
    return null
  }
}

/** 成员行 → 前端结构（不含 password 等敏感列） */
function serializeMember(db, m) {
  const u = db.prepare(`SELECT id, username, company, role, quota FROM users WHERE id = ?`).get(m.user_id) || {}
  const scope = parseScope(m.scope_json)
  return {
    userId: m.user_id,
    username: u.username || `(已删除 #${m.user_id})`,
    company: u.company || null,
    role: u.role || null,
    memberRole: m.member_role || 'member',
    canReceive: !!m.can_receive,
    allowGroupPull: !!m.allow_group_pull,
    // 管辖范围（批次 C 提供编辑入口；本批只读展示）
    scope,
    scopeCities: scope ? scope.cities.length : 0,
    scopeUpdatedAt: m.scope_updated_at || null,
    // 合规留痕（规则：成员本人知情确认）
    consented: !!m.consented_at,
    consentedAt: m.consented_at || null,
    // 兜底开关（§3.6 Ⅴ 上线安全阀）
    quotaGateDisabled: !!m.quota_gate_disabled,
    // 只读展示：额度增减只能由 P1.5 的分配接口完成（规则 21）
    quota: u.quota || 0,
    joinedAt: m.joined_at || null
  }
}

/** 组织行 → 前端结构 */
function serializeOrg(db, o, { withMembers = false } = {}) {
  const owner = db.prepare(`SELECT id, username, company FROM users WHERE id = ?`).get(o.owner_user_id) || {}
  const memberRows = db.prepare(`
    SELECT * FROM org_members WHERE org_id = ? AND member_role != 'owner'
    ORDER BY joined_at ASC, id ASC
  `).all(o.id)
  return {
    id: o.id,
    name: o.name,
    ownerUserId: o.owner_user_id,
    ownerName: owner.username || `(已删除 #${o.owner_user_id})`,
    ownerCompany: owner.company || null,
    memberCount: memberRows.length,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    ...(withMembers ? { members: memberRows.map(m => serializeMember(db, m)) } : {})
  }
}

function findOrg(db, id) {
  return db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(id) || null
}

function findMember(db, orgId, userId) {
  return db.prepare(`SELECT * FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, userId) || null
}

/**
 * requireOrgOwner —— 仅「本组织 owner」或平台 admin（规则 16 / 24）。
 * 成功后把组织行挂在 req.org，后续 handler 复用，避免重复查询。
 * 403 时写一条组织边界日志（规则 1：越界须审计）。
 */
function requireOrgOwner(req, res, next) {
  try {
    const db = getDb()
    const orgId = toId(req.params.id)
    if (!orgId) return res.status(400).json({ message: '集团 id 无效' })

    const org = findOrg(db, orgId)
    if (!org) return res.status(404).json({ message: '集团不存在' })

    const isPlatformAdmin = req.user?.role === 'admin'
    const isOwner = org.owner_user_id === req.user?.id
    if (!isPlatformAdmin && !isOwner) {
      console.warn(
        `[orgs] 组织边界拒绝 user=${req.user?.id} org=${orgId} `
        + `${req.method} ${req.originalUrl} ip=${req.ip}`
      )
      return res.status(403).json({ message: '无权限操作该集团（仅集团总部账号或平台管理员）' })
    }
    req.org = org
    next()
  } catch (error) {
    console.error('组织权限校验失败:', error)
    res.status(500).json({ message: '组织权限校验失败' })
  }
}

// ===========================================================================
// 我的组织（集团 / 成员通用）—— 必须注册在 /:id 之前，避免被吞
// ===========================================================================

/**
 * GET /api/orgs/me
 * 集团视角 → { role:'owner', org, members[] }
 * 成员视角 → { role:'member', org, member }
 * 都不是   → { role:null }（用 200 而非 404：前端首屏判断更简单）
 */
router.get('/me', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = req.user?.id

    const owned = db.prepare(`SELECT * FROM organizations WHERE owner_user_id = ? ORDER BY id LIMIT 1`).get(uid)
    if (owned) {
      return res.json({ role: 'owner', org: serializeOrg(db, owned, { withMembers: true }), member: null })
    }

    const mine = db.prepare(`SELECT * FROM org_members WHERE user_id = ? LIMIT 1`).get(uid)
    if (mine) {
      const org = findOrg(db, mine.org_id)
      if (!org) return res.json({ role: null, org: null, member: null })
      return res.json({ role: 'member', org: serializeOrg(db, org), member: serializeMember(db, mine) })
    }

    res.json({ role: null, org: null, member: null })
  } catch (error) {
    console.error('获取我的组织失败:', error)
    res.status(500).json({ message: '获取我的组织失败' })
  }
})

/**
 * POST /api/orgs/me/consent
 * 成员本人知情确认（写 consented_at，只写一次）。合规留痕，不可由集团代签。
 */
router.post('/me/consent', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = req.user?.id
    const mine = db.prepare(`SELECT * FROM org_members WHERE user_id = ? LIMIT 1`).get(uid)
    if (!mine) return res.status(404).json({ message: '当前账号不属于任何集团' })
    if (mine.consented_at) {
      return res.json({ ok: true, alreadyConsented: true, consentedAt: mine.consented_at })
    }

    db.beginTx()
    try {
      db.prepare(`
        UPDATE org_members SET consented_at = CURRENT_TIMESTAMP WHERE org_id = ? AND user_id = ?
      `).run(mine.org_id, uid)
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    const after = findMember(db, mine.org_id, uid)
    res.json({ ok: true, alreadyConsented: false, consentedAt: after?.consented_at || null })
  } catch (error) {
    console.error('知情确认失败:', error)
    res.status(500).json({ message: '知情确认失败' })
  }
})

/**
 * PATCH /api/orgs/me/settings
 * 成员自行调整「可接收集团下发 / 可被集团拉取」。注意：成员**不能**改管辖范围
 * （范围由集团设定，规则：D5 集团设定子公司只读）。
 */
router.patch('/me/settings', authenticate, (req, res) => {
  try {
    const db = getDb()
    const uid = req.user?.id
    const mine = db.prepare(`SELECT * FROM org_members WHERE user_id = ? LIMIT 1`).get(uid)
    if (!mine) return res.status(404).json({ message: '当前账号不属于任何集团' })

    const has = (k) => Object.prototype.hasOwnProperty.call(req.body || {}, k)
    const canReceive = has('canReceive') ? (req.body.canReceive ? 1 : 0) : mine.can_receive
    const allowGroupPull = has('allowGroupPull') ? (req.body.allowGroupPull ? 1 : 0) : mine.allow_group_pull

    if (!has('canReceive') && !has('allowGroupPull')) {
      return res.status(400).json({ message: '没有需要修改的开关' })
    }

    db.beginTx()
    try {
      db.prepare(`UPDATE org_members SET can_receive = ?, allow_group_pull = ? WHERE org_id = ? AND user_id = ?`)
        .run(canReceive, allowGroupPull, mine.org_id, uid)
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    res.json({ ok: true, member: serializeMember(db, findMember(db, mine.org_id, uid)) })
  } catch (error) {
    console.error('修改组织设置失败:', error)
    res.status(500).json({ message: '修改组织设置失败' })
  }
})

// ===========================================================================
// 组织管理（平台 admin）
// ===========================================================================

/**
 * GET /api/orgs —— 集团列表（含成员明细）
 * 成员规模为个位数~几十，直接内联返回，省一次往返（不再单开 /api/orgs/:id/members）。
 */
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM organizations ORDER BY created_at DESC, id DESC
    `).all()
    res.json({ orgs: rows.map(o => serializeOrg(db, o, { withMembers: true })) })
  } catch (error) {
    console.error('获取集团列表失败:', error)
    res.status(500).json({ message: '获取集团列表失败' })
  }
})

/**
 * POST /api/orgs —— 创建集团 { name, ownerUserId | ownerUsername }
 * 总部账号约束：
 *   · 必须存在
 *   · 不能已是别的集团的总部（一个账号只能带一个集团）
 *   · 不能已是别的集团的成员（否则「既是成员又是总部」会让闸门/范围语义打架）
 * ★ 不写 org_members（见文件头说明）
 */
router.post('/', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ message: '请填写集团名称' })
    if (name.length > 60) return res.status(400).json({ message: '集团名称过长（≤60 字）' })

    const dup = db.prepare(`SELECT id FROM organizations WHERE name = ?`).get(name)
    if (dup) return res.status(409).json({ message: '同名集团已存在' })

    // 总部账号：优先 ownerUserId，其次 ownerUsername
    let owner = null
    if (req.body?.ownerUserId !== undefined && req.body?.ownerUserId !== null) {
      const oid = toId(req.body.ownerUserId)
      if (!oid) return res.status(400).json({ message: '总部账号 id 无效' })
      owner = db.prepare(`SELECT id, username, company, role FROM users WHERE id = ?`).get(oid)
    } else if (req.body?.ownerUsername) {
      owner = db.prepare(`SELECT id, username, company, role FROM users WHERE username = ?`)
        .get(String(req.body.ownerUsername).trim())
    }
    if (!owner) return res.status(404).json({ message: '总部账号不存在' })

    const asOwner = db.prepare(`SELECT id, name FROM organizations WHERE owner_user_id = ?`).get(owner.id)
    if (asOwner) return res.status(409).json({ message: `该账号已是集团「${asOwner.name}」的总部` })
    const asMember = db.prepare(`SELECT org_id FROM org_members WHERE user_id = ?`).get(owner.id)
    if (asMember) return res.status(409).json({ message: '该账号已是其他集团的成员，不能作为总部账号' })

    let orgId = null
    db.beginTx()
    try {
      const r = db.prepare(`INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`).run(name, owner.id)
      orgId = r.lastInsertRowid
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    res.json({ ok: true, org: serializeOrg(db, findOrg(db, orgId), { withMembers: true }) })
  } catch (error) {
    console.error('创建集团失败:', error)
    res.status(500).json({ message: '创建集团失败' })
  }
})

/**
 * POST /api/orgs/:id/members —— 绑定子公司账号
 * body { username, canReceive=1, allowGroupPull=1 }
 * 约束：平台 admin 不可作为子公司；一个账号只能属于一个集团（org_members.user_id UNIQUE）。
 */
router.post('/:id/members', authenticate, requireOrgOwner, (req, res) => {
  try {
    const db = getDb()
    const org = req.org
    const username = String(req.body?.username || '').trim()
    if (!username) return res.status(400).json({ message: '请填写子公司账号' })

    const target = db.prepare(`SELECT id, username, company, role FROM users WHERE username = ?`).get(username)
    if (!target) return res.status(404).json({ message: `账号「${username}」不存在` })
    if (target.role === 'admin') {
      return res.status(400).json({ message: '平台管理员账号不能绑定为子公司' })
    }

    const asOwner = db.prepare(`SELECT id, name FROM organizations WHERE owner_user_id = ?`).get(target.id)
    if (asOwner) {
      return res.status(409).json({ message: `该账号是集团「${asOwner.name}」的总部账号，不能作为子公司` })
    }

    const existing = db.prepare(`SELECT * FROM org_members WHERE user_id = ?`).get(target.id)
    if (existing) {
      if (existing.org_id === org.id) {
        return res.status(409).json({ message: `账号「${username}」已在本集团中` })
      }
      const other = findOrg(db, existing.org_id)
      return res.status(409).json({ message: `账号「${username}」已属于集团「${other?.name || existing.org_id}」` })
    }

    const has = (k) => Object.prototype.hasOwnProperty.call(req.body || {}, k)
    const canReceive = has('canReceive') ? (req.body.canReceive === false ? 0 : 1) : 1
    const allowGroupPull = has('allowGroupPull') ? (req.body.allowGroupPull === false ? 0 : 1) : 1

    db.beginTx()
    try {
      db.prepare(`
        INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull)
        VALUES (?, ?, 'member', ?, ?)
      `).run(org.id, target.id, canReceive, allowGroupPull)
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    res.json({ ok: true, member: serializeMember(db, findMember(db, org.id, target.id)) })
  } catch (error) {
    console.error('绑定子公司失败:', error)
    res.status(500).json({ message: '绑定子公司失败' })
  }
})

/**
 * PATCH /api/orgs/:id/members/:userId —— 改开关
 * 仅允许改 canReceive / allowGroupPull；**不提供**改 member_role、不提供改 quota
 * （额度只能由 P1.5 的分配接口增减，规则 21）。
 */
router.patch('/:id/members/:userId', authenticate, requireOrgOwner, (req, res) => {
  try {
    const db = getDb()
    const org = req.org
    const userId = toId(req.params.userId)
    if (!userId) return res.status(400).json({ message: '账号 id 无效' })

    const m = findMember(db, org.id, userId)
    if (!m) return res.status(404).json({ message: '该账号不在本集团中' })

    const has = (k) => Object.prototype.hasOwnProperty.call(req.body || {}, k)
    if (!has('canReceive') && !has('allowGroupPull')) {
      return res.status(400).json({ message: '没有需要修改的开关' })
    }
    const canReceive = has('canReceive') ? (req.body.canReceive ? 1 : 0) : m.can_receive
    const allowGroupPull = has('allowGroupPull') ? (req.body.allowGroupPull ? 1 : 0) : m.allow_group_pull

    db.beginTx()
    try {
      db.prepare(`UPDATE org_members SET can_receive = ?, allow_group_pull = ? WHERE org_id = ? AND user_id = ?`)
        .run(canReceive, allowGroupPull, org.id, userId)
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    res.json({ ok: true, member: serializeMember(db, findMember(db, org.id, userId)) })
  } catch (error) {
    console.error('修改成员开关失败:', error)
    res.status(500).json({ message: '修改成员开关失败' })
  }
})

/**
 * DELETE /api/orgs/:id/members/:userId —— 解绑子公司
 * 规则 7（删除不级联）：**默认保留**已同步的行（变独立副本）；清理必须显式指定。
 *   ?dryRun=1            只统计，不删任何东西（UI 先算影响面再确认）
 *   purgeMemberCopies=1  删除「该成员账号里」由集团同步来的副本
 *                        （markers/competitors WHERE user_id=成员 AND origin_user_id IS NOT NULL）
 *   purgeGroupMirrors=1  删除「集团账号里」来自该成员的镜像（origin_user_id=成员）
 * ★ 本接口**不动 users.quota**：解绑释放额度属于配额分配范畴（P1.5），
 *   若在这里顺手把额度清零，会与分配台账 quota_grants 对不上账（规则 22/29）。
 */
router.delete('/:id/members/:userId', authenticate, requireOrgOwner, (req, res) => {
  try {
    const db = getDb()
    const org = req.org
    const userId = toId(req.params.userId)
    if (!userId) return res.status(400).json({ message: '账号 id 无效' })

    const m = findMember(db, org.id, userId)
    if (!m) return res.status(404).json({ message: '该账号不在本集团中' })
    if (m.member_role === 'owner') {
      return res.status(400).json({ message: '总部账号不是成员，无法解绑（如需变更请重建集团）' })
    }

    const q = req.query || {}
    const dryRun = q.dryRun === '1' || q.dryRun === 'true'
    const purgeMemberCopies = q.purgeMemberCopies === '1' || q.purgeMemberCopies === 'true'
    const purgeGroupMirrors = q.purgeGroupMirrors === '1' || q.purgeGroupMirrors === 'true'

    // 影响面：两条方向的外来行各有多少（默认全保留）
    const memberCopies = (db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM markers     WHERE user_id = ? AND origin_user_id IS NOT NULL) AS markers,
        (SELECT COUNT(*) FROM competitors WHERE user_id = ? AND origin_user_id IS NOT NULL) AS competitors
    `).get(userId, userId)) || { markers: 0, competitors: 0 }
    const groupMirrors = (db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM markers     WHERE user_id = ? AND origin_user_id = ?) AS markers,
        (SELECT COUNT(*) FROM competitors WHERE user_id = ? AND origin_user_id = ?) AS competitors
    `).get(org.owner_user_id, userId, org.owner_user_id, userId)) || { markers: 0, competitors: 0 }

    const impact = {
      memberCopies: { markers: memberCopies.markers || 0, competitors: memberCopies.competitors || 0 },
      groupMirrors: { markers: groupMirrors.markers || 0, competitors: groupMirrors.competitors || 0 }
    }

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, impact })
    }

    let purged = null
    db.beginTx()
    try {
      if (purgeMemberCopies) {
        const a = db.prepare(`DELETE FROM markers     WHERE user_id = ? AND origin_user_id IS NOT NULL`).run(userId)
        const b = db.prepare(`DELETE FROM competitors WHERE user_id = ? AND origin_user_id IS NOT NULL`).run(userId)
        purged = { memberCopies: { markers: a.changes, competitors: b.changes } }
      }
      if (purgeGroupMirrors) {
        const a = db.prepare(`DELETE FROM markers     WHERE user_id = ? AND origin_user_id = ?`).run(org.owner_user_id, userId)
        const b = db.prepare(`DELETE FROM competitors WHERE user_id = ? AND origin_user_id = ?`).run(org.owner_user_id, userId)
        purged = { ...(purged || {}), groupMirrors: { markers: a.changes, competitors: b.changes } }
      }
      db.prepare(`DELETE FROM org_members WHERE org_id = ? AND user_id = ?`).run(org.id, userId)
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    res.json({ ok: true, dryRun: false, impact, purged, keptByDefault: !purgeMemberCopies })
  } catch (error) {
    console.error('解绑子公司失败:', error)
    res.status(500).json({ message: '解绑子公司失败' })
  }
})

// ===========================================================================
// ⛔ 以下接口「刻意不实现」（设计方案 §6 末段；勿"补全"）：
//   POST   /api/orgs/:id/quota/revoke            收回已分配配额        → 违反铁律 ②
//   PUT    /api/orgs/:id/quota                   设置式覆盖（可调低）   → 违反铁律 ②
//   POST   /api/orgs/:id/quota/reallocate-from   带 fromUserId 的再分配 → 扣他人额度后门
//   POST   /api/orgs/:id/quota/transfer          横向转调 A→B          → 违反铁律 ③
//   DELETE /api/orgs/:id/quota/ledger/:grantId   删台账              → 台账 append-only
// 另：本文件不提供"改成员 users.quota"的任何入口（规则 21：成员额度只由分配而来）。
// ===========================================================================

export default router
