/**
 * 授权闸门测试（v0.9 P0 · 集团 / 子公司数据同步）
 *
 * 背景：`users.quota` 原先只是"显示值"、不是"限制" —— 4 个扣减入口
 * （smartsteps / districts / scoringEngine / resale）都只校验全局物理池。
 * 后果：集团给子公司分了 100 次，用完照样能继续烧全局池 → 分配没有约束力。
 *
 * 被测保证（规则 20 + 兼容开关 P8）：
 *   A. 4 张新表 / markers·competitors 8 个来源列 / quota_history.source_user_id /
 *      两个幂等唯一索引，均由 initDatabase 建立（幂等，零迁移）
 *   B. 物理池耗尽 → 所有账号（含 admin）一律拒绝
 *   C. ★ 非组织账号行为**逐字不变**（哪怕 users.quota = 0 也放行）—— 防误伤存量账号
 *   D. 组织成员额度不足 → reason='own_exhausted'，带 own/need 明细
 *   E. 组织成员额度充足 → 放行，own 与个人中心 / 管理员页同口径
 *   F. quota_gate_disabled = 1 兜底开关能关掉闸门（上线安全阀）
 *   G. 第三方 API Key（isApiKey）不触发成员闸门，行为与改动前一致
 *   H. 结构性护栏：quota_grants.amount ≤ 0 / 非法 grant_kind 在数据库层写不进去（规则 17）
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，避免触碰 backend/database/webgis.db 真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDb = path.join(os.tmpdir(), `r4b-quota-gate-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let getDb, checkQuota, buildGateError, getOwnQuota, isOrgMember, getPoolRemaining

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  const gateMod = await import('../src/utils/quotaGate.js')
  checkQuota = gateMod.checkQuota
  buildGateError = gateMod.buildGateError
  const poolMod = await import('../src/utils/quotaPool.js')
  getOwnQuota = poolMod.getOwnQuota
  isOrgMember = poolMod.isOrgMember
  getPoolRemaining = poolMod.getPoolRemaining
})

afterAll(() => {
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ---------- 构造工具 ----------
let seq = 0
function mkUser(db, { role = 'user', quota = 0 } = {}) {
  seq += 1
  const name = `t_gate_${process.pid}_${seq}`
  const r = db.prepare(
    `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`
  ).run(name, `${name}@t.local`, 'x', role, quota)
  return r.lastInsertRowid
}
function setPool(db, n) {
  db.prepare(`UPDATE admin_quota SET remaining_quota = ? WHERE id = 1`).run(n)
}
function mkOrgWithMember(db, memberId) {
  const ownerId = mkUser(db, { role: 'user', quota: 0 })
  const org = db.prepare(`INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`).run('测试集团', ownerId)
  const orgId = org.lastInsertRowid
  db.prepare(`INSERT INTO org_members (org_id, user_id, member_role) VALUES (?, ?, 'member')`).run(orgId, memberId)
  return { orgId, ownerId }
}
function addPurchase(db, userId, quotaUsed, status = 'active') {
  db.prepare(`INSERT INTO purchases (user_id, quota_used, status) VALUES (?, ?, ?)`).run(userId, quotaUsed, status)
}

// ============================================================================

describe('P0 数据模型（幂等建表，零迁移）', () => {
  it('4 张新表已建出', () => {
    const db = getDb()
    for (const t of ['organizations', 'org_members', 'sync_batches', 'quota_grants']) {
      const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(t)
      expect(row?.name, `缺少表 ${t}`).toBe(t)
    }
  })

  it('markers / competitors 各 8 个来源与归属字段齐备（列名同构）', () => {
    const db = getDb()
    const cols = ['origin_user_id', 'origin_row_id', 'origin_owner', 'sync_batch_id',
      'sync_readonly', 'belong_member_user_id', 'group_note', 'city_source']
    const m = db.exec(`PRAGMA table_info(markers)`)[0].values.map(r => r[1])
    const c = db.exec(`PRAGMA table_info(competitors)`)[0].values.map(r => r[1])
    for (const col of cols) {
      expect(m, `markers 缺列 ${col}`).toContain(col)
      expect(c, `competitors 缺列 ${col}`).toContain(col)
    }
  })

  it('quota_history 已加 source_user_id 来源列（规则 23）', () => {
    const db = getDb()
    const cols = db.exec(`PRAGMA table_info(quota_history)`)[0].values.map(r => r[1])
    expect(cols).toContain('source_user_id')
  })

  it('幂等唯一索引 ux_markers_origin / ux_competitors_origin 已建立（规则 2）', () => {
    const db = getDb()
    for (const idx of ['ux_markers_origin', 'ux_competitors_origin']) {
      const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name = ?`).get(idx)
      expect(row?.name, `缺少索引 ${idx}`).toBe(idx)
    }
  })
})

describe('授权闸门 checkQuota（规则 20）', () => {
  it('① 物理池耗尽 → 所有账号（含 admin）一律拒绝', () => {
    const db = getDb()
    setPool(db, 0)
    expect(getPoolRemaining(db)).toBe(0)
    for (const role of ['admin', 'user']) {
      const g = checkQuota(db, 1, 1, { role })
      expect(g.ok).toBe(false)
      expect(g.reason).toBe('pool_exhausted')
      expect(buildGateError(g).status).toBe(400)
    }
    setPool(db, 100)
  })

  it('② admin 放行（池充足时不查授权额度）', () => {
    const db = getDb()
    setPool(db, 50)
    const g = checkQuota(db, 1, 1, { role: 'admin' })
    expect(g.ok).toBe(true)
    expect(g.pool).toBe(50)
  })

  it('③ ★ 非组织账号行为不变：users.quota = 0 也放行（兼容开关 P8）', () => {
    const db = getDb()
    setPool(db, 50)
    const uid = mkUser(db, { role: 'user', quota: 0 })
    expect(isOrgMember(db, uid)).toBe(false)
    const g = checkQuota(db, uid, 1, { role: 'user' })
    expect(g.ok).toBe(true)
    expect(g.isOrgMember).toBe(false)
  })

  it('④ 组织成员额度不足 → own_exhausted，附 own/need 明细', () => {
    const db = getDb()
    setPool(db, 50)
    const uid = mkUser(db, { role: 'user', quota: 5 })
    mkOrgWithMember(db, uid)
    addPurchase(db, uid, 5)          // 5 次全部花掉

    expect(isOrgMember(db, uid)).toBe(true)
    expect(getOwnQuota(db, uid)).toBe(0)

    const g = checkQuota(db, uid, 1, { role: 'user' })
    expect(g.ok).toBe(false)
    expect(g.reason).toBe('own_exhausted')
    expect(g.own).toBe(0)
    expect(g.need).toBe(1)

    const err = buildGateError(g)
    expect(err.status).toBe(403)
    expect(err.body.code).toBe('own_quota_exhausted')
    expect(err.body.own).toBe(0)
  })

  it('⑤ 组织成员额度充足 → 放行，own 与两页口径一致（inactive 不计）', () => {
    const db = getDb()
    setPool(db, 50)
    const uid = mkUser(db, { role: 'user', quota: 200 })
    mkOrgWithMember(db, uid)
    addPurchase(db, uid, 20, 'active')
    addPurchase(db, uid, 7, 'inactive')   // 软删除的历史记录不计入「剩余次数」

    expect(getOwnQuota(db, uid)).toBe(180)   // 200 − 20

    const g = checkQuota(db, uid, 1, { role: 'user' })
    expect(g.ok).toBe(true)
    expect(g.own).toBe(180)
    expect(g.isOrgMember).toBe(true)
  })

  it('⑥ 兜底开关 quota_gate_disabled = 1 → 闸门关闭，放行（上线安全阀）', () => {
    const db = getDb()
    setPool(db, 50)
    const uid = mkUser(db, { role: 'user', quota: 0 })
    const { orgId } = mkOrgWithMember(db, uid)

    // 默认会被闸门拦住（quota=0 且是成员）
    expect(isOrgMember(db, uid)).toBe(true)
    expect(checkQuota(db, uid, 1, { role: 'user' }).ok).toBe(false)

    db.prepare(`UPDATE org_members SET quota_gate_disabled = 1 WHERE org_id = ? AND user_id = ?`).run(orgId, uid)
    expect(isOrgMember(db, uid)).toBe(false)
    expect(checkQuota(db, uid, 1, { role: 'user' }).ok).toBe(true)
  })

  it('⑦ 第三方 API Key（isApiKey）不触发成员闸门', () => {
    const db = getDb()
    setPool(db, 50)
    expect(checkQuota(db, null, 1, { isApiKey: true }).ok).toBe(true)

    setPool(db, 0)   // 但物理池仍是硬边界
    expect(checkQuota(db, null, 1, { isApiKey: true }).ok).toBe(false)
    setPool(db, 50)
  })

  it('⑧ need > 池剩余（批量场景）同样被拦', () => {
    const db = getDb()
    setPool(db, 3)
    const g = checkQuota(db, 1, 5, { role: 'admin' })
    expect(g.ok).toBe(false)
    expect(g.reason).toBe('pool_exhausted')
    expect(g.need).toBe(5)
    setPool(db, 50)
  })
})

describe('结构性护栏（规则 17：只增不减由数据库层保证）', () => {
  it('quota_grants.amount ≤ 0 写不进去', () => {
    const db = getDb()
    const uid = mkUser(db, { role: 'user', quota: 0 })
    const { orgId } = mkOrgWithMember(db, uid)
    const sql = `INSERT INTO quota_grants (org_id, grant_kind, from_user_id, to_user_id, amount, created_by)
                 VALUES (?, 'pool_grant', ?, ?, ?, ?)`
    expect(() => db.prepare(sql).run(orgId, uid, uid, 0, uid)).toThrow()
    expect(() => db.prepare(sql).run(orgId, uid, uid, -5, uid)).toThrow()
  })

  it('grant_kind 只接受 pool_grant / org_move（无 revoke 后门）', () => {
    const db = getDb()
    const uid = mkUser(db, { role: 'user', quota: 0 })
    const { orgId } = mkOrgWithMember(db, uid)
    expect(() => {
      db.prepare(`INSERT INTO quota_grants (org_id, grant_kind, from_user_id, to_user_id, amount, created_by)
                  VALUES (?, 'revoke', ?, ?, 1, ?)`).run(orgId, uid, uid, uid)
    }).toThrow()
  })
})
