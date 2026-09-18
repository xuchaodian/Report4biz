/**
 * 只读可见域（集团/子公司 · v1.13.156）测试
 *
 * 被测：
 *   A. src/utils/visibleScope.js —— visibleScope / readableUserIds / scopeSummary
 *   B. src/routes/purchase.js 读端点的放宽与**越权防线**
 *
 * 背景（用户原话，2026-09-10 设计方案 §1 场景 3）：
 *   「集团公司站在全局视角需要统一分析各子公司购买的联通人口……
 *     在购买履历里看到各子公司的购买履历并根据需要导出 excel 或 pdf」
 *
 * 本测试要钉死的不变量：
 *   ① 普通账号（无组织）    → 可见域 === [自己]
 *   ② 集团 owner            → 可见域 === [自己, 成员…]
 *   ③ 成员本人              → 可见域 === [自己]（**看不到同集团其他成员**）
 *   ④ 成员关闭 allow_group_pull → 立即从可见域消失（尊重成员开关，与 syncCore.checkMemberSwitch 同语义）
 *   ⑤ 已解散集团（dissolved_at 非空）→ owner 只见自己（立碑后不再放大）
 *   ⑥ 跨组织                → A 集团 owner 绝看不到 B 集团成员
 *   ⑦ 平台 admin 不属于任何集团 → 只见自己（**刻意不放大**：admin 不是客户数据的所有者）
 *   ⑧ 越权读单行            → 非可见域账号按 id 直取 → 404（不得 200）
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-vscope-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let visibleScope, readableUserIds, isReadableUser, scopeSummary
let getDb, server, base, jwtSign
const tokens = {}
const ids = {}

function makeToken(user) {
  return jwtSign({ id: user.id, username: user.username, role: user.role })
}

async function call(method, p, { token, body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + p, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await res.json() } catch (e) { json = null }
  return { status: res.status, body: json }
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  jwtSign = (payload) => jwt.sign(payload, cfg.JWT_SECRET, { expiresIn: '1h' })

  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb

  const vs = await import('../src/utils/visibleScope.js')
  visibleScope = vs.visibleScope
  readableUserIds = vs.readableUserIds
  isReadableUser = vs.isReadableUser
  scopeSummary = vs.scopeSummary

  const purchaseRouter = (await import('../src/routes/purchase.js')).default

  const db = getDb()
  const seed = (username, role, quota = 0, company = null) => {
    const r = db.prepare(
      `INSERT INTO users (username, email, password, role, quota, company) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(username, `${username}@test.local`, 'x', role, quota, company)
    return r.lastInsertRowid
  }
  ids.admin = seed('admin_v', 'admin')
  ids.hq = seed('hq_v', 'user', 100, '总部公司')
  ids.subA = seed('subA_v', 'user', 0, '华东子公司')
  ids.subB = seed('subB_v', 'user', 0, '华南子公司')
  ids.outsider = seed('out_v', 'user', 0, '外部公司')
  ids.outsiderMember = seed('outm_v', 'user', 0, '外部成员')

  for (const k of ['admin', 'hq', 'subA', 'subB', 'outsider', 'outsiderMember']) {
    tokens[k] = makeToken({ id: ids[k], username: `${k}_v`, role: k === 'admin' ? 'admin' : 'user' })
  }

  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use('/api/purchase', purchaseRouter)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`

  // 直接建组织/成员（避免与 orgs 接口的互斥校验耦合，本测试只关心可见域）
  const org = db.prepare(`INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`)
    .run('可见域测试集团', ids.hq)
  ids.org = org.lastInsertRowid
  db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`)
    .run(ids.org, ids.subA)
  db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`)
    .run(ids.org, ids.subB)

  // 第二个集团（用于「已解散」与「跨组织」用例）
  const org2 = db.prepare(`INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`)
    .run('外部集团', ids.outsider)
  ids.org2 = org2.lastInsertRowid
  db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`)
    .run(ids.org2, ids.outsiderMember)

  // 购买履历：总部 1 条 + 成员 A 2 条 + 成员 B 1 条 + 外部成员 1 条
  let n = 0
  const mkPurchase = (uid, storeName, quotaUsed = 0, month = '202608') => db.prepare(
    `INSERT INTO purchases (user_id, store_name, store_type, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
     VALUES (?, ?, '已开业', 121.5, 31.2, ?, ?, ?, 'active', ?)`
  ).run(uid, storeName, JSON.stringify([1000]), month, quotaUsed, JSON.stringify({ apiResult: { '1001': { pall_sum: 100 + (++n) } } }))

  ids.purchaseHq = mkPurchase(ids.hq, '总部门店', 1).lastInsertRowid
  ids.purchaseSubA1 = mkPurchase(ids.subA, '华东门店一', 1).lastInsertRowid
  ids.purchaseSubA2 = mkPurchase(ids.subA, '华东门店二', 1).lastInsertRowid
  ids.purchaseSubB = mkPurchase(ids.subB, '华南门店', 1).lastInsertRowid
  ids.purchaseOut = mkPurchase(ids.outsiderMember, '外部门店', 1).lastInsertRowid
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ===========================================================================

describe('① visibleScope 纯口径', () => {
  it('无组织账号 ⇒ 只见自己（行为与改造前完全一致）', () => {
    expect(readableUserIds(getDb(), ids.subA)).toEqual([ids.subA])
    expect(readableUserIds(getDb(), ids.admin)).toEqual([ids.admin])
  })

  it('集团 owner ⇒ 自己 + 全部成员', () => {
    const s = visibleScope(getDb(), ids.hq)
    expect(s.isOrgOwner).toBe(true)
    expect(s.ids).toEqual([ids.hq, ids.subA, ids.subB])
    expect(s.members.map(m => m.name)).toEqual(['华东子公司', '华南子公司'])
  })

  it('成员本人 ⇒ 只见自己（看不到同集团其他成员）', () => {
    expect(readableUserIds(getDb(), ids.subA)).toEqual([ids.subA])
    expect(isReadableUser(getDb(), ids.subA, ids.subB)).toBe(false)
  })

  it('跨组织 ⇒ 本集团 owner 看不到外部集团成员', () => {
    expect(readableUserIds(getDb(), ids.hq)).not.toContain(ids.outsiderMember)
    expect(readableUserIds(getDb(), ids.outsider)).not.toContain(ids.subA)
  })

  it('成员关闭 allow_group_pull ⇒ 立即从可见域消失', () => {
    const db = getDb()
    db.prepare(`UPDATE org_members SET allow_group_pull = 0 WHERE org_id = ? AND user_id = ?`).run(ids.org, ids.subB)
    try {
      expect(readableUserIds(getDb(), ids.hq)).toEqual([ids.hq, ids.subA])
      const s = scopeSummary(db, ids.hq)
      expect(s.blockedByPullOff.map(x => x.name)).toEqual(['华南子公司'])
    } finally {
      db.prepare(`UPDATE org_members SET allow_group_pull = 1 WHERE org_id = ? AND user_id = ?`).run(ids.org, ids.subB)
    }
    // 恢复后回到原样
    expect(readableUserIds(getDb(), ids.hq)).toEqual([ids.hq, ids.subA, ids.subB])
  })

  it('已解散集团（dissolved_at 非空）⇒ owner 不再放大', () => {
    const db = getDb()
    expect(readableUserIds(getDb(), ids.outsider)).toEqual([ids.outsider, ids.outsiderMember])
    db.prepare(`UPDATE organizations SET dissolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(ids.org2)
    expect(readableUserIds(getDb(), ids.outsider)).toEqual([ids.outsider])
  })
})

describe('② GET /api/purchase/visible-scope', () => {
  it('owner 视角：isOrgOwner=true，sources 覆盖自己 + 2 名成员', async () => {
    const r = await call('GET', '/api/purchase/visible-scope', { token: tokens.hq })
    expect(r.status).toBe(200)
    expect(r.body.isOrgOwner).toBe(true)
    expect(r.body.visibleCount).toBe(3)
    expect(r.body.sources.map(s => s.userId)).toEqual([ids.hq, ids.subA, ids.subB])
    expect(r.body.sources[0].isSelf).toBe(true)
    expect(r.body.sources[0].name).toBe('本账号')
    expect(r.body.sources[1].name).toBe('华东子公司')
  })

  it('成员视角：isOrgOwner=false，sources 只有自己', async () => {
    const r = await call('GET', '/api/purchase/visible-scope', { token: tokens.subA })
    expect(r.status).toBe(200)
    expect(r.body.isOrgOwner).toBe(false)
    expect(r.body.visibleCount).toBe(1)
    expect(r.body.sources).toHaveLength(1)
  })
})

describe('③ GET /api/purchase/history 可见域 + 来源标注', () => {
  it('集团 owner 看到自己 + 成员的购买履历，逐行带来源', async () => {
    const r = await call('GET', '/api/purchase/history', { token: tokens.hq })
    expect(r.status).toBe(200)
    const rows = r.body.purchases || []
    // 总部 1 + 华东 2 + 华南 1；外部成员 1 条**不得**出现
    expect(rows).toHaveLength(4)
    expect(rows.map(x => x.id)).not.toContain(ids.purchaseOut)

    const own = rows.find(x => x.id === ids.purchaseHq)
    expect(own.is_self).toBe(true)
    expect(own.owner_name).toBe('本账号')

    const sub = rows.find(x => x.id === ids.purchaseSubA1)
    expect(sub.is_self).toBe(false)
    expect(sub.owner_name).toBe('华东子公司')

    expect(Array.isArray(r.body.sources)).toBe(true)
    expect(r.body.sources).toHaveLength(3)
  })

  it('成员只看到自己的购买履历', async () => {
    const r = await call('GET', '/api/purchase/history', { token: tokens.subA })
    expect(r.status).toBe(200)
    const rows = r.body.purchases || []
    expect(rows).toHaveLength(2)
    expect(rows.every(x => x.is_self)).toBe(true)
    expect(rows.map(x => x.id).sort()).toEqual([ids.purchaseSubA1, ids.purchaseSubA2].sort())
  })

  it('外部账号完全看不到本集团数据', async () => {
    const r = await call('GET', '/api/purchase/history', { token: tokens.outsider })
    expect(r.status).toBe(200)
    const rowIds = (r.body.purchases || []).map(x => x.id)
    for (const id of [ids.purchaseHq, ids.purchaseSubA1, ids.purchaseSubB]) {
      expect(rowIds).not.toContain(id)
    }
  })
})

describe('④ 单行越权防线（GET /api/purchase/:id）', () => {
  it('owner 可打开成员的记录，并带来源', async () => {
    const r = await call('GET', `/api/purchase/${ids.purchaseSubA1}`, { token: tokens.hq })
    expect(r.status).toBe(200)
    expect(r.body.store_name).toBe('华东门店一')
    expect(r.body.is_self).toBe(false)
    expect(r.body.owner_name).toBe('华东子公司')
  })

  it('成员拿不到同集团其他成员的记录（404 而非 200）', async () => {
    const r = await call('GET', `/api/purchase/${ids.purchaseSubB}`, { token: tokens.subA })
    expect(r.status).toBe(404)
  })

  it('外部账号拿不到本集团的记录（404 而非 200）', async () => {
    for (const id of [ids.purchaseHq, ids.purchaseSubA1, ids.purchaseSubB]) {
      const r = await call('GET', `/api/purchase/${id}`, { token: tokens.outsider })
      expect(r.status).toBe(404)
    }
  })

  it('成员关闭 allow_group_pull 后，owner 立刻读不到其记录', async () => {
    const db = getDb()
    db.prepare(`UPDATE org_members SET allow_group_pull = 0 WHERE org_id = ? AND user_id = ?`).run(ids.org, ids.subA)
    try {
      const r = await call('GET', `/api/purchase/${ids.purchaseSubA1}`, { token: tokens.hq })
      expect(r.status).toBe(404)
    } finally {
      db.prepare(`UPDATE org_members SET allow_group_pull = 1 WHERE org_id = ? AND user_id = ?`).run(ids.org, ids.subA)
    }
    const back = await call('GET', `/api/purchase/${ids.purchaseSubA1}`, { token: tokens.hq })
    expect(back.status).toBe(200)
  })
})

describe('⑤ 配额端点**不放宽**（规则 21/30 铁律）', () => {
  it('owner 的 /purchase/quota 只统计自己的 quota_used', async () => {
    const r = await call('GET', '/api/purchase/quota', { token: tokens.hq })
    expect(r.status).toBe(200)
    // 总部自己买了 1 次；成员 A/B 各买 1~2 次要**绝不计入**总部账上
    expect(r.body.used).toBe(1)
    expect(r.body.cumulativeUsed).toBe(1)
  })

  it('/purchase/quota-history 仍是账号自己的台账', async () => {
    const r = await call('GET', '/api/purchase/quota-history', { token: tokens.hq })
    expect(r.status).toBe(200)
    expect(Array.isArray(r.body.history)).toBe(true)
  })
})
