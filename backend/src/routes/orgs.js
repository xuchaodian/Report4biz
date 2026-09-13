// ============================================================================
// 集团 / 子公司组织管理（v0.9 P0 批次 B → v0.10 批次 C 追加管辖范围）
// 设计方案 §6「组织管理 + 我的组织 + 管辖范围」接口 · 规则总表 §8
// ----------------------------------------------------------------------------
// 批次 B：组织与人（建集团、绑成员、改开关、解绑、我的组织、成员知情确认）。
// 批次 C（v0.10）：**管辖范围 scope 增设/读取 + 城市互斥校验**（本文件末 3 个接口）。
// 批次 E（v0.12）：**配额一级分配收口**（summary 总览 + allocate 分配 + 双写台账）——
//   这是「最小可用出口」，补齐批次 A 闸门已上线但分配 UI 未做的半成品状态；
//   二级再分配（reallocate）与跨组织总览（F4）仍待 P1.5 完整版。
// 仍不含：同步引擎（批次 D 已落 routes/sync.js）、划拨向导（P2）。
// 成员 users.quota 的**增减只由本文件末尾的分配接口**完成；其余组织接口恒为只读展示。
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
//
// ★ v0.9 补丁：新增第 9 个接口 DELETE /api/orgs/:id（解散集团，软删除「立碑」）。
//   起因：设计方案 §6 / §7.1 从未设计集团级撤销 —— 建错集团（选错总部账号、写错名字）
//         在批次 B 上线后**没有任何出口**，只能改库。生产 0 集团时未暴露，但一旦建真集团即锁死。
//   语义：requireOrgOwner（本组织 owner 或平台 admin）+「成员数必须为 0」硬门槛
//         + ?dryRun=1 先算影响面 + dissolved_at/dissolved_by/dissolve_reason 审计留痕。
//   详见本文件末 DELETE /:id 路由上方注释。
//
// ★ v0.10 批次 C：新增第 10~12 个接口（管辖范围）
//   GET    /api/orgs/:id/members/:userId/scope   读（集团 / 该成员本人可读）
//   PATCH  /api/orgs/:id/members/:userId/scope   集团设定 { cities[], brands[] }
//   GET    /api/orgs/:id/scope-conflicts         组织内城市占用表（UI 预检）
//   配套：utils/scopeGuard.js（城市互斥，纯函数、无 import，可在生产直接自检）
//         GET /api/sync/scope-options 在 routes/sync.js（批次 D 的同名文件）
//   铁律：
//     · 规则 11 —— 范围**只到城市级**，不细分区县
//     · 规则 12 —— 保存时**配置期互斥**：城市被本组织其他成员占用 → 409 + 占用方
//                  运行时不再打认领锁（D6 推论：写权唯一由配置期保证）
//     · 规则 14 —— scope_json **每次变更写一条 direction='scope_change' 批次**（审计留痕）
//     · 本接口**不改 users.quota、不动台账**（规则 21 / 17）
//   ?force=1 出口：仅用于「同城已被两家占用」的历史脏数据解套（否则双方都改不动），
//                  执行后会写 console.warn 审计并在响应里回传 forcedConflicts。
// ============================================================================

import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import {
  findScopeConflicts,
  describeOccupancy,
  parseCityList,
  parseBrandList,
  normalizeCity
} from '../utils/scopeGuard.js'
import { getPoolInfo, getPoolRemaining, getOwnQuota, getOwnQuotaDetail, getAllocatable } from '../utils/quotaPool.js'

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

/**
 * 取组织（**只认未解散的**）。
 * 解散 = 软删除立碑（organizations.dissolved_at），因此所有按 id 取组织的地方
 * 都天然把已解散集团当作「不存在」—— requireOrgOwner 会对它返回 404，
 * 已解散集团因此无法再被绑成员/改开关/解绑，也不会出现在 GET /api/orgs 列表里。
 */
function findOrg(db, id) {
  return db.prepare(`SELECT * FROM organizations WHERE id = ? AND dissolved_at IS NULL`).get(id) || null
}

function findMember(db, orgId, userId) {
  return db.prepare(`SELECT * FROM org_members WHERE org_id = ? AND user_id = ?`).get(orgId, userId) || null
}

/**
 * 统计某账号名下「由同步而来」的外来行（markers / competitors）。
 * 用于解散集团时算影响面 / 释放 / 清理。
 */
function countForeignRows(db, userId) {
  const r = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM markers     WHERE user_id = ? AND origin_user_id IS NOT NULL) AS markers,
      (SELECT COUNT(*) FROM competitors WHERE user_id = ? AND origin_user_id IS NOT NULL) AS competitors
  `).get(userId, userId)
  return { markers: (r && r.markers) || 0, competitors: (r && r.competitors) || 0 }
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

/**
 * requireOrgOwnerOrSelf —— 在 requireOrgOwner 基础上额外放行「该成员本人」。
 * 用途：管辖范围**读取**（§6「集团/本人可读」）。写入一律走 requireOrgOwner。
 */
function requireOrgOwnerOrSelf(req, res, next) {
  try {
    const db = getDb()
    const orgId = toId(req.params.id)
    if (!orgId) return res.status(400).json({ message: '集团 id 无效' })

    const org = findOrg(db, orgId)
    if (!org) return res.status(404).json({ message: '集团不存在' })

    const userId = toId(req.params.userId)
    const isPlatformAdmin = req.user?.role === 'admin'
    const isOwner = org.owner_user_id === req.user?.id
    const isSelf = !!userId && userId === req.user?.id
    if (!isPlatformAdmin && !isOwner && !isSelf) {
      console.warn(
        `[orgs] 组织边界拒绝(scope读) user=${req.user?.id} org=${orgId} `
        + `${req.method} ${req.originalUrl} ip=${req.ip}`
      )
      return res.status(403).json({ message: '无权限查看该成员管辖范围' })
    }
    req.org = org
    next()
  } catch (error) {
    console.error('管辖范围权限校验失败:', error)
    res.status(500).json({ message: '管辖范围权限校验失败' })
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

    const owned = db.prepare(`
      SELECT * FROM organizations WHERE owner_user_id = ? AND dissolved_at IS NULL ORDER BY id LIMIT 1
    `).get(uid)
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
 * 已解散（dissolved_at 非空）的集团不在列表中 —— 解散即从 UI 消失，审计留痕在库里。
 */
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM organizations WHERE dissolved_at IS NULL ORDER BY created_at DESC, id DESC
    `).all()
    res.json({ orgs: rows.map(o => serializeOrg(db, o, { withMembers: true })) })
  } catch (error) {
    console.error('获取集团列表失败:', error)
    res.status(500).json({ message: '获取集团列表失败' })
  }
})

/**
 * GET /api/orgs/quota/overview —— 管理员跨组织配额总览（§7.9 F4）
 * ★ 仅平台 admin（规则 24：跨组织可见性边界；集团 owner 只看本组织）
 * ★ 只读：**不提供**任何"调低/收回"入口 —— 避免成为绕过铁律 ② 的后门
 *   （真要兜底走 PUT /api/users/:id + force，那有独立审计）
 *
 * 三层聚合：组织 → 总部/成员 → 台账。解决 §3.7 的盲区 ②（"分配出去了多少 vs 池子还剩多少"分不清）。
 *
 * 口径说明（实施期补齐，原文档树未单列总部）：
 *   · 组织级「已分配」= Σ 该组织各账号 users.quota（**含总部**）——
 *     设计文档的 ASCII 树只画了成员，但总部额度若不纳入聚合，`poolTotal` 恒等式会凭空少一块。
 *     因此把总部作为组织第一行（isOwner=true）纳入，组织级 = Σ(总部 + 成员)。
 *   · 「已消耗」= Σ active 的 quota_used；「未消耗」= Σ max(0, quota − used)（§7.9 口径）
 *   · 「台账分配」= Σ quota_grants.amount（append-only 台账口径，可与 users.quota 交叉对账）
 *   · 平台直配 = 既非任何未解散组织的总部、也非其成员的账号
 *   · reconcile 自检：allocatedUsers == Σ组织quotaTotal + direct.allocated（不等即数据异常）
 *
 * ⚠️ 路由必须注册在 /:id 之前，否则 '/quota/overview' 会被 /:id 前缀吞掉。
 */
router.get('/quota/overview', authenticate, requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const pool = getPoolInfo(db)
    const remaining = getPoolRemaining(db)
    const allocatable = getAllocatable(db)

    // 一次性取全量非 admin 账号的额度与消耗（避免逐组织 N+1）
    const acctRows = db.prepare(`
      SELECT u.id, u.username, u.company, u.role, u.quota,
             COALESCE(pu.used, 0) AS used
        FROM users u
        LEFT JOIN (SELECT user_id, SUM(quota_used) AS used FROM purchases
                    WHERE status = 'active' GROUP BY user_id) pu ON pu.user_id = u.id
       WHERE u.role != 'admin'
    `).all() || []
    const acctById = new Map(acctRows.map(r => [r.id, r]))

    // 台账聚合：按 (org, to_user) 拆分一级/二级
    const grantRows = db.prepare(`
      SELECT org_id, to_user_id,
             SUM(amount) AS granted,
             SUM(CASE WHEN grant_kind = 'pool_grant' THEN amount ELSE 0 END) AS granted_pool,
             SUM(CASE WHEN grant_kind = 'org_move'   THEN amount ELSE 0 END) AS granted_move
        FROM quota_grants GROUP BY org_id, to_user_id
    `).all() || []
    const grantByOrgTo = new Map(grantRows.map(g => [`${g.org_id}:${g.to_user_id}`, g]))
    const lastGrantRows = db.prepare(`
      SELECT org_id, MAX(created_at) AS last_at, COUNT(*) AS cnt
        FROM quota_grants GROUP BY org_id
    `).all() || []
    const lastGrantByOrg = new Map(lastGrantRows.map(r => [r.org_id, r]))

    // 成员行（按组织归组，保持绑定顺序）
    const memberRows = db.prepare(`
      SELECT org_id, user_id FROM org_members ORDER BY org_id, joined_at ASC, id ASC
    `).all() || []
    const membersByOrg = new Map()
    for (const m of memberRows) {
      if (!membersByOrg.has(m.org_id)) membersByOrg.set(m.org_id, [])
      membersByOrg.get(m.org_id).push(m.user_id)
    }

    const orgRows = db.prepare(`
      SELECT * FROM organizations WHERE dissolved_at IS NULL ORDER BY created_at ASC, id ASC
    `).all() || []

    // 防御性去重：同一账号理论上不会被两个组织占用（创建/绑定均有拦截），
    // 但历史脏数据下若出现，只计入首个组织，避免 Σ 双计破坏恒等式。
    const claimed = new Set()
    let duplicates = 0

    const orgs = orgRows.map(o => {
      const owner = acctById.get(o.owner_user_id)
      const rows = []

      const pushRow = (uid, displayName, isOwner) => {
        const counted = !claimed.has(uid)
        if (counted) claimed.add(uid)
        else duplicates += 1

        const a = acctById.get(uid) || {}
        const g = grantByOrgTo.get(`${o.id}:${uid}`) || {}
        const quota = a.quota || 0
        const used = a.used || 0
        rows.push({
          userId: uid,
          name: displayName,
          isOwner: !!isOwner,
          counted,
          quota,
          used,
          unconsumed: Math.max(0, quota - used),
          grantedTotal: g.granted || 0,
          grantedPool: g.granted_pool || 0,
          grantedMove: g.granted_move || 0
        })
      }

      pushRow(
        o.owner_user_id,
        owner?.company || owner?.username || `(已删除 #${o.owner_user_id})`,
        true
      )
      for (const uid of (membersByOrg.get(o.id) || [])) {
        const a = acctById.get(uid)
        pushRow(uid, a?.company || a?.username || `(已删除 #${uid})`, false)
      }

      const sum = (k) => rows.reduce((s, r) => s + (r.counted ? (r[k] || 0) : 0), 0)
      const lg = lastGrantByOrg.get(o.id)

      return {
        orgId: o.id,
        name: o.name,
        ownerUserId: o.owner_user_id,
        ownerName: owner?.username || `(已删除 #${o.owner_user_id})`,
        memberCount: rows.length - 1,
        quotaTotal: sum('quota'),
        consumed: sum('used'),
        unconsumed: sum('unconsumed'),
        grantedTotal: sum('grantedTotal'),
        grantedPool: sum('grantedPool'),
        grantedMove: sum('grantedMove'),
        lastGrantAt: lg?.last_at || null,
        grantCount: lg?.cnt || 0,
        members: rows
      }
    })

    // 平台直配：未被任何未解散组织认领的账号
    const direct = { allocated: 0, consumed: 0, unconsumed: 0, accountCount: 0 }
    for (const a of acctRows) {
      if (claimed.has(a.id)) continue
      direct.allocated += a.quota || 0
      direct.consumed += a.used || 0
      direct.unconsumed += Math.max(0, (a.quota || 0) - (a.used || 0))
      direct.accountCount += 1
    }

    const sumOrgQuota = orgs.reduce((s, o) => s + o.quotaTotal, 0)
    const expected = sumOrgQuota + direct.allocated

    res.json({
      ok: true,
      pool: {
        poolTotal: pool.poolTotal,
        remaining,
        occupied: pool.occupied,
        allocatedUsers: pool.allocatedUsers,
        allocatedApi: pool.allocatedApi,
        allocatable,
        // 「已分配未消耗」全平台口径（§7.9 顶部卡片）
        unconsumedTotal: orgs.reduce((s, o) => s + o.unconsumed, 0) + direct.unconsumed
      },
      orgs,
      direct,
      // 自检：全池 allocatedUsers 必须 == Σ组织 + 平台直配
      reconcile: {
        allocatedUsers: pool.allocatedUsers,
        sumOrgQuota,
        directAllocated: direct.allocated,
        expected,
        diff: pool.allocatedUsers - expected,
        duplicates,
        ok: pool.allocatedUsers === expected
      },
      generatedAt: new Date().toISOString()
    })
  } catch (error) {
    console.error('获取跨组织配额总览失败:', error)
    res.status(500).json({ message: '获取跨组织配额总览失败' })
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

    // 同名检查只看「未解散」的 —— 已解散集团的名字可被新集团重新使用
    const dup = db.prepare(`SELECT id FROM organizations WHERE name = ? AND dissolved_at IS NULL`).get(name)
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

    // 只拦「未解散」的集团：解散后该账号可再次出任新集团总部
    const asOwner = db.prepare(`SELECT id, name FROM organizations WHERE owner_user_id = ? AND dissolved_at IS NULL`).get(owner.id)
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

    const asOwner = db.prepare(`SELECT id, name FROM organizations WHERE owner_user_id = ? AND dissolved_at IS NULL`).get(target.id)
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

// ===========================================================================
// 管辖范围（scope）—— 批次 C · v0.10
// 规则 11（只到城市级）/ 规则 12（配置期互斥）/ 规则 14（变更留痕）
// ===========================================================================

/** 城市入参清洗：去空白 → 长度限制 → 按归一化键去重（保留首次出现的原样写法） */
function cleanCityList(arr) {
  const out = []
  const seen = new Set()
  for (const raw of (Array.isArray(arr) ? arr : [])) {
    const s = String(raw ?? '').trim()
    if (!s || s.length > 30) continue
    const key = normalizeCity(s)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/** 品牌入参清洗（品牌留空 = 不限；不做大小写/后缀归一，保持用户原样） */
function cleanBrandList(arr) {
  const out = []
  const seen = new Set()
  for (const raw of (Array.isArray(arr) ? arr : [])) {
    const s = String(raw ?? '').trim()
    if (!s || s.length > 40 || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/** scope_json → 前端结构；**null 表示「未设置」**（与设置为空数组区分，见 §D5） */
function serializeScope(m) {
  if (!m || !m.scope_json) return null
  return { cities: parseCityList(m.scope_json), brands: parseBrandList(m.scope_json) }
}

/**
 * 规则 14：scope_json 每次变更写一条 direction='scope_change' 批次。
 * 划拨（transfer）也走这张表，两者同为「范围类变更」的审计依据。
 */
function recordScopeChange(db, { orgId, actorId, targetUserId, before, after, ip }) {
  const r = db.prepare(`
    INSERT INTO sync_batches
      (org_id, direction, source_user_id, target_user_id, scope, total,
       inserted, updated, deleted, skipped, failed, status, detail, created_by, ip, finished_at)
    VALUES (?, 'scope_change', ?, ?, ?, ?, 0, 0, 0, 0, 0, 'success', ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    orgId, actorId, targetUserId,
    after.cities.join(','), after.cities.length,
    JSON.stringify({ before, after }), actorId, ip || null
  )
  return r.lastInsertRowid
}

/**
 * GET /api/orgs/:id/members/:userId/scope
 * 读某成员的管辖范围（§6：集团 / 本人可读）。
 * 同时回传 conflicts —— 当前范围里**已被本组织其他成员占用**的城市，
 * 这是唯一能让「历史脏数据」在 UI 上暴露的出口。
 */
router.get('/:id/members/:userId/scope', authenticate, requireOrgOwnerOrSelf, (req, res) => {
  try {
    const db = getDb()
    const org = req.org
    const userId = toId(req.params.userId)
    if (!userId) return res.status(400).json({ message: '账号 id 无效' })

    const m = findMember(db, org.id, userId)
    if (!m) return res.status(404).json({ message: '该账号不在本集团中' })

    const scope = serializeScope(m)
    const set = !!m.scope_json
    const cities = scope ? scope.cities : []
    const u = db.prepare(`SELECT username, company FROM users WHERE id = ?`).get(userId) || {}

    res.json({
      ok: true,
      orgId: org.id,
      userId,
      username: u.username || `(已删除 #${userId})`,
      company: u.company || null,
      scope,
      set,
      scopeCities: cities.length,
      scopeUpdatedAt: m.scope_updated_at || null,
      conflicts: findScopeConflicts(db, org.id, userId, cities)
    })
  } catch (error) {
    console.error('读取管辖范围失败:', error)
    res.status(500).json({ message: '读取管辖范围失败' })
  }
})

/**
 * PATCH /api/orgs/:id/members/:userId/scope —— 集团设定管辖范围（§7.5）
 * body { cities?, brands? }（未提供的维度保持原值）
 *
 * 四道校验：
 *   ① 权限 requireOrgOwner（成员本人**不可**改自己的范围 —— D5「集团设定、子公司只读」）
 *   ② 入参清洗：去空白、限长、按归一化键去重
 *   ③ ★ 规则 12 配置期互斥：城市被本组织其他成员占用 → 409 + 占用方
 *      （这是「写权唯一」的保证，运行时因此无需再打认领锁）
 *   ④ 规则 14：写 direction='scope_change' 审计批次
 *
 * ?force=1：仅用于**历史脏数据解套** —— 若同城已被两家占用，双方都会被对方卡住而
 *   永远改不动任何一方。此时允许显式强制保存，但会 console.warn 留痕并在响应回传
 *   forcedConflicts。正常流程不应使用。
 */
router.patch('/:id/members/:userId/scope', authenticate, requireOrgOwner, (req, res) => {
  try {
    const db = getDb()
    const org = req.org
    const userId = toId(req.params.userId)
    if (!userId) return res.status(400).json({ message: '账号 id 无效' })

    const m = findMember(db, org.id, userId)
    if (!m) return res.status(404).json({ message: '该账号不在本集团中' })

    const has = (k) => Object.prototype.hasOwnProperty.call(req.body || {}, k)
    if (!has('cities') && !has('brands')) {
      return res.status(400).json({ message: '没有需要修改的管辖范围' })
    }
    if (has('cities') && req.body.cities !== null && !Array.isArray(req.body.cities)) {
      return res.status(400).json({ message: 'cities 必须是数组' })
    }
    if (has('brands') && req.body.brands !== null && !Array.isArray(req.body.brands)) {
      return res.status(400).json({ message: 'brands 必须是数组' })
    }

    const before = {
      cities: parseCityList(m.scope_json),
      brands: parseBrandList(m.scope_json)
    }
    const cities = has('cities') ? cleanCityList(req.body.cities) : before.cities
    const brands = has('brands') ? cleanBrandList(req.body.brands) : before.brands
    const after = { cities, brands }

    // ③ 配置期互斥（规则 12）
    const conflicts = findScopeConflicts(db, org.id, userId, cities)
    const force = req.query?.force === '1' || req.query?.force === 'true'
    if (conflicts.length && !force) {
      const c = conflicts[0]
      const holder = c.company || c.username || `#${c.userId}`
      return res.status(409).json({
        code: 'city_conflict',
        message: `城市「${c.city}」当前归属「${holder}」，请先走划拨流程或改选其他城市`,
        conflicts
      })
    }

    let batchId = null
    db.beginTx()
    try {
      db.prepare(`
        UPDATE org_members
           SET scope_json = ?, scope_updated_at = CURRENT_TIMESTAMP
         WHERE org_id = ? AND user_id = ?
      `).run(JSON.stringify(after), org.id, userId)

      // ④ 规则 14 变更留痕
      batchId = recordScopeChange(db, {
        orgId: org.id,
        actorId: req.user?.id,
        targetUserId: userId,
        before,
        after,
        ip: req.ip
      })
      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    if (conflicts.length) {
      console.warn(
        `[orgs] 管辖范围强制保存(force) org=${org.id} member=${userId} by=${req.user?.id} `
        + `conflicts=${JSON.stringify(conflicts.map(c => c.city))} ip=${req.ip}`
      )
    }

    const after_m = findMember(db, org.id, userId)
    res.json({
      ok: true,
      orgId: org.id,
      userId,
      scope: after,
      set: true,
      scopeCities: cities.length,
      scopeUpdatedAt: after_m?.scope_updated_at || null,
      changed: JSON.stringify(before) !== JSON.stringify(after),
      conflicts: [],
      forcedConflicts: conflicts,
      forced: force && conflicts.length > 0,
      batchId
    })
  } catch (error) {
    console.error('保存管辖范围失败:', error)
    res.status(500).json({ message: '保存管辖范围失败' })
  }
})

/**
 * GET /api/orgs/:id/scope-conflicts —— 组织内城市占用表（§7.5 UI 预检）
 * 返回 cities（城市 → 占用方）+ members（人 → 持有哪些城市）。
 * 只读，不涉及任何写入。
 */
router.get('/:id/scope-conflicts', authenticate, requireOrgOwner, (req, res) => {
  try {
    const db = getDb()
    const org = req.org
    const occupancy = describeOccupancy(db, org.id)
    res.json({
      ok: true,
      orgId: org.id,
      ownerUserId: org.owner_user_id,
      ...occupancy
    })
  } catch (error) {
    console.error('获取城市占用表失败:', error)
    res.status(500).json({ message: '获取城市占用表失败' })
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

/**
 * DELETE /api/orgs/:id —— 解散集团（**软删除 / 立碑**，v0.9 补丁）
 * ----------------------------------------------------------------------------
 * 为什么要有它：设计方案 §6 与 §7.1 只设计了「建集团 / 绑成员 / 解绑成员」，
 * **没有集团级撤销**。批次 B 上线后，选错总部账号或写错集团名的集团无法从 UI 撤销，
 * 只能改库 —— 本接口补上这个出口。
 *
 * 四道闸：
 *   ① 权限：requireOrgOwner（本组织 owner 或平台 admin），与解绑成员同一把锁
 *   ② 硬门槛：**成员数必须为 0**。仍有子公司时返回 409 + 成员清单，强制「先逐个解绑」。
 *      理由：每个成员都牵涉「他带来的数据保留还是清理」的决策（规则 7 删除不级联），
 *      级联解绑会把决定权从用户手里拿走；逐个解绑时每个都能单独看 dryRun 影响面。
 *   ③ ?dryRun=1：只算影响面、不写库（UI 先展示后确认）
 *   ④ 软删除：写 dissolved_at / dissolved_by / dissolve_reason，**不物理删行**
 *      —— quota_grants 与 sync_batches 是 append-only 台账且引用 org_id，
 *         物理删会留下悬空 org_id（本库未开 PRAGMA foreign_keys，不报错但会静默脏掉）。
 *      软删除后：台账引用始终有效、解散可追溯、同名集团可重建、总部账号可再次出任总部。
 *
 * 总部账号名下「外来行」的处理（user_id=总部 且 origin_user_id IS NOT NULL）：
 *   · 默认 **释放（release）**：清 origin_user_id/origin_row_id/origin_owner/sync_batch_id 且
 *     置 sync_readonly=0 → 这些行变回总部账号可自由编辑/删除的自有行（**不丢数据**）。
 *     ⚠️ 为什么不像解绑成员那样默认「保留锁定」：解绑时集团还在、成员可能再绑回来；
 *        解散后集团**永久不存在**，再留 sync_readonly=1 就等于给用户留下
 *        一批「删不掉也改不了」的死行。**勿改成默认保留。**
 *   · ?purgeGroupMirrors=1 → 改为物理删除这些行（用户明确要清掉时用）。
 *
 * 绝不触碰：
 *   · quota_grants / quota_history / sync_batches —— 台账只增不删（规则 17）
 *   · 别人的账号里的副本 —— 那是别人的数据，解散本组织无权处置
 *   · users.quota —— 额度回收属于配额分配范畴（P1.5），本文件恒不写配额
 */
router.delete('/:id', authenticate, requireOrgOwner, (req, res) => {
  try {
    const db = getDb()
    const org = req.org
    const q = req.query || {}
    const dryRun = q.dryRun === '1' || q.dryRun === 'true'
    const purgeGroupMirrors = q.purgeGroupMirrors === '1' || q.purgeGroupMirrors === 'true'
    const reason = String(req.body?.reason ?? q.reason ?? '').trim().slice(0, 200) || null

    // ---- 影响面（dryRun 与实际执行共用同一套统计，避免"预览与执行不一致"）----
    const memberRows = db.prepare(`
      SELECT m.user_id, u.username, u.company
      FROM org_members m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? AND m.member_role != 'owner'
      ORDER BY m.joined_at ASC, m.id ASC
    `).all(org.id)

    const ownerMirrors = countForeignRows(db, org.owner_user_id)
    const ledgerRows = (db.prepare(`SELECT COUNT(*) AS n FROM quota_grants  WHERE org_id = ?`).get(org.id) || {}).n || 0
    const batchRows = (db.prepare(`SELECT COUNT(*) AS n FROM sync_batches WHERE org_id = ?`).get(org.id) || {}).n || 0

    const impact = {
      orgId: org.id,
      orgName: org.name,
      ownerUserId: org.owner_user_id,
      memberCount: memberRows.length,
      members: memberRows.map(m => ({
        userId: m.user_id,
        username: m.username || `(已删除 #${m.user_id})`,
        company: m.company || null
      })),
      // 默认释放 / 可改为清除；两个数量都会原样回给 UI
      ownerMirrors,
      // 以下台账**保留不删**，仅告知规模（append-only）
      ledgerRows,
      syncBatches: batchRows
    }

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, impact })
    }

    // ---- 硬门槛：成员必须已清空 ----
    if (memberRows.length > 0) {
      return res.status(409).json({
        code: 'org_has_members',
        message: `集团下仍有 ${memberRows.length} 个子公司，请先逐个解绑后再解散`,
        impact
      })
    }

    // ---- 执行 ----
    let released = null
    let purged = null

    db.beginTx()
    try {
      if (purgeGroupMirrors) {
        const a = db.prepare(`DELETE FROM markers     WHERE user_id = ? AND origin_user_id IS NOT NULL`).run(org.owner_user_id)
        const b = db.prepare(`DELETE FROM competitors WHERE user_id = ? AND origin_user_id IS NOT NULL`).run(org.owner_user_id)
        purged = { markers: a.changes, competitors: b.changes }
      } else if (ownerMirrors.markers > 0 || ownerMirrors.competitors > 0) {
        const a = db.prepare(`
          UPDATE markers
             SET origin_user_id = NULL, origin_row_id = NULL, origin_owner = NULL,
                 sync_batch_id = NULL, sync_readonly = 0
           WHERE user_id = ? AND origin_user_id IS NOT NULL
        `).run(org.owner_user_id)
        const b = db.prepare(`
          UPDATE competitors
             SET origin_user_id = NULL, origin_row_id = NULL, origin_owner = NULL,
                 sync_batch_id = NULL, sync_readonly = 0
           WHERE user_id = ? AND origin_user_id IS NOT NULL
        `).run(org.owner_user_id)
        released = { markers: a.changes, competitors: b.changes }
      }

      // 防御性清成员（正常已为 0；总部账号本就不在 org_members 中）
      db.prepare(`DELETE FROM org_members WHERE org_id = ? AND member_role != 'owner'`).run(org.id)

      db.prepare(`
        UPDATE organizations
           SET dissolved_at = CURRENT_TIMESTAMP, dissolved_by = ?, dissolve_reason = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND dissolved_at IS NULL
      `).run(req.user?.id ?? null, reason, org.id)

      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    const after = db.prepare(`SELECT dissolved_at FROM organizations WHERE id = ?`).get(org.id) || {}

    // 审计：解散是最重的一次组织操作，必须留痕（谁 / 何时 / 哪个集团 / 外来行怎么处理的 / 为什么）
    const mirrorAction = released
      ? `released=${JSON.stringify(released)}`
      : (purged ? `purged=${JSON.stringify(purged)}` : 'mirrors=none')
    console.warn(
      `[orgs] 集团解散 org=${org.id}「${org.name}」owner=${org.owner_user_id} by=${req.user?.id} `
      + `${mirrorAction} reason=${reason || '-'} ip=${req.ip}`
    )

    res.json({
      ok: true,
      dryRun: false,
      dissolvedAt: after.dissolved_at || null,
      impact,
      released,
      purged,
      ledgerKept: true,
      message: '集团已解散（配额台账与同步审计按 append-only 规则保留）'
    })
  } catch (error) {
    console.error('解散集团失败:', error)
    res.status(500).json({ message: '解散集团失败' })
  }
})

// ===========================================================================
// 配额分配（P1.5 · 批次 E「最小可用一级分配出口」）
// ---------------------------------------------------------------------------
// 为什么「最小可用」也要先做：批次 A 已上线授权闸门（quotaGate），但正式 P1.5
// 分配 UI 未做 → 一旦把真子公司绑成成员，该账号立即被闸门拦下且系统内无分配入口。
// 本批先补「一级分配」收口（summary 总览 + allocate 分配 + 双写台账），
// 二级再分配（reallocate）与跨组织总览（F4）留待 P1.5 完整版。
//
// 一级分配（pool_grant）四条铁律（设计方案 §3.6）：
//   ① from 恒 = 本组织 owner（不可由入参指定）—— 结构上杜绝「指定出资方」
//   ② amount 必须 > 0 整数，只累加 —— quota_grants 有 CHECK(amount>0) 兜底
//   ③ 扣「全池可分配」getAllocatable()，不动任何人的已持额度、不动物理池 remaining
//   ④ 双写台账：quota_grants（append-only）+ quota_history(action='org_grant')
//      —— 缺任一条，purchase.js:86 的「累计配额」会对不上账（规则 22/23）
// ===========================================================================

/**
 * GET /api/orgs/:id/quota/summary —— 集团视角配额总览（§6）
 * 返回池概览 + 各成员「已分配 / 已消耗 / 剩余 / 累计获赠」+ 调用者自己的额度三分量。
 * 只读；仅组织 owner 或平台 admin。
 *
 * ★ self 字段（P1.5）：调用者自己的 {quota,used,transferable} —— 二级再分配
 *   「我的额度转给子公司」弹窗的上限直接取它，**不由前端自算**（规则 30 前后端同口径）。
 */
router.get('/:id/quota/summary', authenticate, requireOrgOwner, (req, res) => {
  try {
    const db = getDb()
    const org = req.org
    const pool = getPoolInfo(db)
    const remaining = getPoolRemaining(db)
    const allocatable = getAllocatable(db)

    const memberRows = db.prepare(`
      SELECT m.user_id, u.username, u.company, u.quota,
             COALESCE(pu.used, 0) AS used,
             COALESCE(g.granted, 0) AS granted,
             COALESCE(g.granted_pool, 0) AS granted_pool,
             COALESCE(g.granted_move, 0) AS granted_move
        FROM org_members m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN (SELECT user_id, SUM(quota_used) AS used FROM purchases
                    WHERE status = 'active' GROUP BY user_id) pu ON pu.user_id = m.user_id
        LEFT JOIN (
          SELECT to_user_id,
                 SUM(amount) AS granted,
                 SUM(CASE WHEN grant_kind = 'pool_grant' THEN amount ELSE 0 END) AS granted_pool,
                 SUM(CASE WHEN grant_kind = 'org_move'   THEN amount ELSE 0 END) AS granted_move
            FROM quota_grants WHERE org_id = ? GROUP BY to_user_id
        ) g ON g.to_user_id = m.user_id
       WHERE m.org_id = ? AND m.member_role != 'owner'
       ORDER BY m.joined_at ASC, m.id ASC
    `).all(org.id, org.id) || []

    const members = memberRows.map(x => {
      const quota = x.quota || 0
      const used = x.used || 0
      return {
        userId: x.user_id,
        name: x.company || x.username || `#${x.user_id}`,
        username: x.username || null,
        company: x.company || null,
        quota,
        used,
        remain: Math.max(0, quota - used),
        // 累计获赠（台账口径）：一级池分配 / 二级组内再分配，分开列便于台账对账（§7.8）
        grantedTotal: x.granted || 0,
        grantedPool: x.granted_pool || 0,
        grantedMove: x.granted_move || 0
      }
    })

    // 调用者（owner/admin）自己的额度三分量 —— 二级再分配上限的唯一来源
    const self = getOwnQuotaDetail(db, req.user?.id)

    res.json({
      ok: true,
      orgId: org.id,
      ownerUserId: org.owner_user_id,
      isOwner: org.owner_user_id === req.user?.id,
      poolTotal: pool.poolTotal,
      occupied: pool.occupied,
      allocatedUsers: pool.allocatedUsers,
      allocatedApi: pool.allocatedApi,
      remaining,
      allocatable,
      self,
      members
    })
  } catch (error) {
    console.error('获取配额总览失败:', error)
    res.status(500).json({ message: '获取配额总览失败' })
  }
})

/**
 * POST /api/orgs/:id/quota/allocate —— 一级分配（池 → 成员，§6 / §3.6）
 * body { toUserId, amount, note? }
 *
 * 校验链（顺序即优先级）：
 *   ① requireOrgOwner（仅本组织 owner / 平台 admin）
 *   ② toUserId ∈ 本组织成员（排除总部账号，总部不写 org_members）
 *   ③ amount 正整数（只增；quota_grants 的 CHECK(amount>0) 做最后兜底）
 *   ④ amount ≤ getAllocatable()（防超卖不变量 Ⅰ）
 * 写入（单事务，任一步失败整体回滚）：
 *   · users.quota += amount
 *   · quota_grants  +1 行（pool_grant，from=owner，quota_before/after 对账）
 *   · quota_history +1 行（action='org_grant'，source_user_id=owner）
 * ★ 不动 admin_quota.remaining_quota（物理池），不动 owner 自己 users.quota。
 */
router.post('/:id/quota/allocate', authenticate, requireOrgOwner, (req, res) => {
  try {
    const db = getDb()
    const org = req.org
    const toUserId = toId(req.body?.toUserId)
    const amount = Number(req.body?.amount)

    if (!toUserId) return res.status(400).json({ message: '缺少受赠成员 toUserId' })
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ message: '分配额度必须是正整数' })
    }

    const m = findMember(db, org.id, toUserId)
    if (!m) return res.status(404).json({ message: '该账号不是本集团成员' })

    const allocatable = getAllocatable(db)
    if (amount > allocatable) {
      return res.status(400).json({
        code: 'allocatable_insufficient',
        message: `可分配余额不足：可分配 ${allocatable}，本次 ${amount}`,
        allocatable
      })
    }

    const note = String(req.body?.note || '').trim().slice(0, 200) || null
    const ownerId = org.owner_user_id

    let quotaBefore = 0
    let quotaAfter = 0
    let grantId = null

    db.beginTx()
    try {
      quotaBefore = db.prepare(`SELECT quota FROM users WHERE id = ?`).get(toUserId)?.quota || 0
      quotaAfter = quotaBefore + amount

      db.prepare(`UPDATE users SET quota = quota + ? WHERE id = ?`).run(amount, toUserId)

      const g = db.prepare(`
        INSERT INTO quota_grants
          (org_id, grant_kind, from_user_id, to_user_id, amount, note, created_by, ip,
           quota_before, quota_after)
        VALUES (?, 'pool_grant', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(org.id, ownerId, toUserId, amount, note, req.user?.id, req.ip || null, quotaBefore, quotaAfter)
      grantId = g.lastInsertRowid

      db.prepare(`
        INSERT INTO quota_history
          (user_id, old_quota, new_quota, change_amount, action, source_user_id)
        VALUES (?, ?, ?, ?, 'org_grant', ?)
      `).run(toUserId, quotaBefore, quotaAfter, amount, ownerId)

      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    console.warn(
      `[orgs] 配额一级分配 org=${org.id} owner=${ownerId} to=${toUserId} `
      + `amount=${amount} by=${req.user?.id} ip=${req.ip}`
    )

    res.json({
      ok: true,
      grantId,
      orgId: org.id,
      toUserId,
      amount,
      quotaBefore,
      quotaAfter,
      allocatable: Math.max(0, allocatable - amount),
      note
    })
  } catch (error) {
    console.error('分配配额失败:', error)
    res.status(500).json({ message: '分配配额失败' })
  }
})

/**
 * POST /api/orgs/:id/quota/reallocate —— 二级再分配（成员 → 成员，§3.8 / §6）
 * body { toUserId, amount, note? }        ★ 签名里【没有 fromUserId】
 *
 * 语义：把**自己已持有**的额度转一点给本组织某个子公司。
 *   与一级分配（allocate）的本质差异（§3.8 Ⅰ）：
 *     一级 = 把池子里"还没发出去"的钱发下去 → 扣「全池可分配」、发起人自己的额度不变
 *     二级 = 把"已经发到我手里"的钱再分出去 → **不扣**「全池可分配」，只扣出资方自己的额度
 *
 * 结构性保证（能用签名/约束表达的绝不靠 if，§3.8 Ⅳ）：
 *   ① 出资方恒 = req.user.id —— 请求体无 fromUserId，想扣别人必须先改签名（可 review 发现）
 *   ② requireOrgOwner —— 非 owner 连进门资格都没有 ⇒ 子公司之间天然无法互转（铁律 ③）
 *   ③ toUserId === 自己 → 400 self_move_forbidden
 *   ④ 转出上限 = 未消耗余额 max(0, users.quota − Σquota_used)（规则 30 · P10 已定案）
 *      —— 已花掉的次数不可转走；超额 400 insufficient_own_quota 并回传明细
 *   ⑤ 保留 CHECK(amount > 0)：记账用**一条 org_move（正数）**，不写 −N/+N 两条
 *      —— 一旦允许负数，"不可扣减"就只剩接口层 if 了（§3.8 Ⅳ 末段）
 *
 * 写入（单事务）：from.quota −= amount、to.quota += amount、
 *   quota_grants +1 行（org_move，含 from_before/from_after）、
 *   quota_history +2 行（出资方 org_move_out −N / 受赠方 org_move_in +N）（规则 29）
 * ★ 不扣「全池可分配」、不动 physical remaining_quota、不动组织总授权额度 Σusers.quota（规则 28）
 * ★ 不设最低保留值：允许把自己转空（P11 · 规则 31），仅前端升级危险态提示。
 */
router.post('/:id/quota/reallocate', authenticate, requireOrgOwner, (req, res) => {
  try {
    const db = getDb()
    const org = req.org
    const fromUserId = req.user?.id               // ★ 恒为调用者
    const toUserId = toId(req.body?.toUserId)
    const amount = Number(req.body?.amount)

    if (!toUserId) return res.status(400).json({ message: '缺少转入成员 toUserId' })
    if (toUserId === fromUserId) {
      return res.status(400).json({
        code: 'self_move_forbidden',
        message: '不能转给自己'
      })
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ message: '转出额度必须是正整数' })
    }

    const m = findMember(db, org.id, toUserId)
    if (!m) return res.status(404).json({ message: '该账号不是本集团成员' })

    // 转出上限 = 出资方未消耗余额（规则 30）。已花掉的次数不可转走。
    const detail = getOwnQuotaDetail(db, fromUserId)
    if (amount > detail.transferable) {
      return res.status(400).json({
        code: 'insufficient_own_quota',
        message: `可转出余额不足：额度 ${detail.quota} − 已消耗 ${detail.used} = 可转 ${detail.transferable}，本次 ${amount}`,
        quota: detail.quota,
        used: detail.used,
        transferable: detail.transferable
      })
    }

    const note = String(req.body?.note || '').trim().slice(0, 200) || null

    let fromBefore = 0
    let fromAfter = 0
    let toBefore = 0
    let toAfter = 0
    let grantId = null

    db.beginTx()
    try {
      fromBefore = db.prepare(`SELECT quota FROM users WHERE id = ?`).get(fromUserId)?.quota || 0
      toBefore = db.prepare(`SELECT quota FROM users WHERE id = ?`).get(toUserId)?.quota || 0
      fromAfter = fromBefore - amount
      toAfter = toBefore + amount

      db.prepare(`UPDATE users SET quota = quota - ? WHERE id = ?`).run(amount, fromUserId)
      db.prepare(`UPDATE users SET quota = quota + ? WHERE id = ?`).run(amount, toUserId)

      const g = db.prepare(`
        INSERT INTO quota_grants
          (org_id, grant_kind, from_user_id, to_user_id, amount, note, created_by, ip,
           quota_before, quota_after, from_before, from_after)
        VALUES (?, 'org_move', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(org.id, fromUserId, toUserId, amount, note, req.user?.id, req.ip || null,
             toBefore, toAfter, fromBefore, fromAfter)
      grantId = g.lastInsertRowid

      // 双写流水：两条，使两侧的 cumulativeTotal = Σ(change_amount) 都与 users.quota 对账通过
      db.prepare(`
        INSERT INTO quota_history
          (user_id, old_quota, new_quota, change_amount, action, source_user_id)
        VALUES (?, ?, ?, ?, 'org_move_out', ?)
      `).run(fromUserId, fromBefore, fromAfter, -amount, fromUserId)

      db.prepare(`
        INSERT INTO quota_history
          (user_id, old_quota, new_quota, change_amount, action, source_user_id)
        VALUES (?, ?, ?, ?, 'org_move_in', ?)
      `).run(toUserId, toBefore, toAfter, amount, fromUserId)

      db.commitTx()
    } catch (txError) {
      try { db.rollbackTx() } catch (e) { /* 忽略 */ }
      throw txError
    }

    console.warn(
      `[orgs] 配额二级再分配 org=${org.id} from=${fromUserId} to=${toUserId} `
      + `amount=${amount} (${fromBefore}->${fromAfter} / ${toBefore}->${toAfter}) by=${req.user?.id} ip=${req.ip}`
    )

    res.json({
      ok: true,
      grantId,
      orgId: org.id,
      grantKind: 'org_move',
      from: { userId: fromUserId, before: fromBefore, after: fromAfter },
      to: { userId: toUserId, before: toBefore, after: toAfter },
      amount,
      note,
      // 恒等式：再分配不改变组织总授权额度、不改变全池可分配（§3.8 Ⅲ 恒等式 ③④）
      orgTotalUnchanged: true,
      allocatableUnchanged: true
    })
  } catch (error) {
    console.error('组内再分配失败:', error)
    res.status(500).json({ message: '组内再分配失败' })
  }
})

// ===========================================================================
// ⛔ 以下接口「刻意不实现」（设计方案 §6 末段；勿"补全"）：
//   POST   /api/orgs/:id/quota/revoke            收回已分配配额        → 违反铁律 ②
//   PUT    /api/orgs/:id/quota                   设置式覆盖（可调低）   → 违反铁律 ②
//   POST   /api/orgs/:id/quota/reallocate-from   带 fromUserId 的再分配 → 扣他人额度后门
//   POST   /api/orgs/:id/quota/transfer          横向转调 A→B          → 违反铁律 ③
//   DELETE /api/orgs/:id/quota/ledger/:grantId   删台账              → 台账 append-only
// 另：本文件不提供"改成员 users.quota"的 set 入口（规则 21：成员额度只由分配而来）。
// ★ P1.5 已实现「二级再分配」：POST /:id/quota/reallocate（出资方恒为调用者，见上）。
//   注意它与上面的 reallocate-from **不是同一个东西** —— 后者带 fromUserId 可扣他人，永久禁止。
// ===========================================================================

export default router
