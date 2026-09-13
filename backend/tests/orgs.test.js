/**
 * 集团 / 子公司组织管理测试（v0.9 P0 批次 B + 解散补丁）
 *
 * 被测：src/routes/orgs.js 的 9 个接口 + requireOrgOwner 中间件
 * 方式：真起一个 express 实例（端口 0 随机）→ 用 fetch 打真实 HTTP，
 *       覆盖「权限 / 参数校验 / 冲突分支 / 事务落地」——比只测纯函数可信得多。
 *       不引入 supertest（生产未装该依赖，禁止 npm install）。
 *
 * 覆盖的保证（对应设计方案 §8 规则总表）：
 *   A. ★ 总部账号**不进 org_members** → isOrgMember(总部) === false，
 *      避免存量集团账号被授权闸门瞬间判「额度耗尽」（规则 20 兼容开关）
 *   B. 平台 admin 专属接口：普通账号 → 403（规则 16 / 24）
 *   C. requireOrgOwner：既非总部也非 admin 的账号操作 → 403（规则 1）
 *   D. 一个账号只能属于一个集团（org_members.user_id UNIQUE 的应用层拦阻）
 *   E. 解绑默认**保留**已同步行；purge 需显式指定（规则 7）
 *   F. ★ 解绑**绝不动 users.quota**（解绑释放额度属 P1.5，规则 21/22）
 *   G. /me 三种视角（总部 / 成员 / 无关账号）
 *   H. 知情确认只写一次且不可代签（合规留痕）
 *   I. ⛔ 刻意不实现的配额接口确实不存在（防后人"补全"违反铁律）
 *   J. 解散集团 = **软删除立碑**：成员未清空 → 409；解散后不可再操作、名称可复用、
 *      总部账号可再任总部、**台账（quota_grants / sync_batches）只增不删**、
 *      总部账号外来行默认「释放」而非删除（规则 7 / 17 / 21）
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-orgs-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let getDb, JWT_SECRET, isOrgMember, server, base
const tokens = {}
const ids = {}
const p15 = {}   // P1.5 专用共享状态（二级再分配 / F4 总览），不污染 ids

/** 造一个带 id/username/role 的 JWT（authenticate 只看 payload） */
function makeToken(user) {
  // 动态导入 jsonwebtoken 会与 CJS 互操作打架，这里直接复用 config 里的密钥手签
  return jwtSign({ id: user.id, username: user.username, role: user.role })
}
let jwtSign = null

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
  JWT_SECRET = cfg.JWT_SECRET
  jwtSign = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })

  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  const poolMod = await import('../src/utils/quotaPool.js')
  isOrgMember = poolMod.isOrgMember
  const orgsRouter = (await import('../src/routes/orgs.js')).default

  // 种子账号：admin / hq(总部候选) / subA、subB(子公司) / outsider(无关账号)
  const db = getDb()
  const seed = (username, role, quota = 0) => {
    const r = db.prepare(`INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
      .run(username, `${username}@test.local`, 'x', role, quota)
    return r.lastInsertRowid
  }
  ids.admin = seed('admin_t', 'admin')
  ids.hq = seed('hq_t', 'user', 500)          // 总部账号自身持有 500 额度（验证不被闸门管）
  ids.subA = seed('subA_t', 'user', 0)
  ids.subB = seed('subB_t', 'user', 0)
  ids.outsider = seed('outsider_t', 'user', 0)
  ids.lonely = seed('lonely_t', 'user', 0)    // 全程不属于任何组织（⑦ 的 role=null 用）

  for (const k of ['admin', 'hq', 'subA', 'subB', 'outsider', 'lonely']) {
    tokens[k] = makeToken({ id: ids[k], username: `${k}_t`, role: k === 'admin' ? 'admin' : 'user' })
  }

  // 起真实 HTTP 服务
  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use('/api/orgs', orgsRouter)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ---------------------------------------------------------------------------

describe('① 创建集团 POST /api/orgs（平台 admin）', () => {
  it('普通账号越权 → 403', async () => {
    const r = await call('POST', '/api/orgs', { token: tokens.outsider, body: { name: 'X' } })
    expect(r.status).toBe(403)
  })

  it('缺名称 / 名称过长 → 400', async () => {
    expect((await call('POST', '/api/orgs', { token: tokens.admin, body: {} })).status).toBe(400)
    expect((await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '   ' } })).status).toBe(400)
    expect((await call('POST', '/api/orgs', { token: tokens.admin, body: { name: 'x'.repeat(61) } })).status).toBe(400)
  })

  it('总部账号不存在 → 404', async () => {
    const r = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: 'G0', ownerUserId: 999999 } })
    expect(r.status).toBe(404)
  })

  it('创建成功 → 返回 org，且 memberCount=0', async () => {
    const r = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '华东集团', ownerUserId: ids.hq } })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.org.name).toBe('华东集团')
    expect(r.body.org.memberCount).toBe(0)
    ids.org = r.body.org.id
  })

  it('同名集团 → 409', async () => {
    const r = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '华东集团', ownerUserId: ids.subA } })
    expect(r.status).toBe(409)
  })

  it('同一账号不能带两个集团 → 409', async () => {
    const r = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '华南集团', ownerUserId: ids.hq } })
    expect(r.status).toBe(409)
  })

  it('★ 总部账号不写入 org_members，且 isOrgMember(总部)=false（防闸门误伤存量账号）', async () => {
    const db = getDb()
    const row = db.prepare(`SELECT * FROM org_members WHERE user_id = ?`).get(ids.hq)
    expect(row).toBeUndefined()
    expect(isOrgMember(db, ids.hq)).toBe(false)
  })
})

describe('② 集团列表 GET /api/orgs（平台 admin）', () => {
  it('非 admin → 403', async () => {
    expect((await call('GET', '/api/orgs', { token: tokens.hq })).status).toBe(403)
  })

  it('返回集团 + 内联成员明细（当前 0 人）', async () => {
    const r = await call('GET', '/api/orgs', { token: tokens.admin })
    expect(r.status).toBe(200)
    const org = r.body.orgs.find(o => o.id === ids.org)
    expect(org).toBeTruthy()
    expect(org.ownerName).toBe('hq_t')
    expect(org.members).toEqual([])
  })
})

describe('③ 绑定子公司 POST /api/orgs/:id/members', () => {
  it('非法 id → 400；不存在 → 404', async () => {
    expect((await call('POST', '/api/orgs/abc/members', { token: tokens.admin, body: { username: 'subA_t' } })).status).toBe(400)
    expect((await call('POST', '/api/orgs/99999/members', { token: tokens.admin, body: { username: 'subA_t' } })).status).toBe(404)
  })

  it('账号不存在 → 404；绑 admin → 400', async () => {
    expect((await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.admin, body: { username: 'nobody' } })).status).toBe(404)
    expect((await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.admin, body: { username: 'admin_t' } })).status).toBe(400)
  })

  it('绑自己集团的总部账号 → 409', async () => {
    const r = await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.admin, body: { username: 'hq_t' } })
    expect(r.status).toBe(409)
  })

  it('绑定成功（默认两个开关都开）', async () => {
    const r = await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.admin, body: { username: 'subA_t' } })
    expect(r.status).toBe(200)
    expect(r.body.member.userId).toBe(ids.subA)
    expect(r.body.member.canReceive).toBe(true)
    expect(r.body.member.allowGroupPull).toBe(true)
    expect(r.body.member.consented).toBe(false)
    expect(r.body.member.scope).toBe(null)
    expect(r.body.member.quota).toBe(0)
  })

  it('同集团重复绑 → 409；账号已是别的集团成员 → 409', async () => {
    expect((await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.admin, body: { username: 'subA_t' } })).status).toBe(409)
    // 另建一个集团，把 subA 的「已属于其他集团」分支打出来
    const g2 = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '华南集团', ownerUserId: ids.outsider } })
    expect(g2.status).toBe(200)
    const r = await call('POST', `/api/orgs/${g2.body.org.id}/members`, { token: tokens.admin, body: { username: 'subA_t' } })
    expect(r.status).toBe(409)
    expect(r.body.message).toContain('华东集团')
    ids.org2 = g2.body.org.id
  })

  it('绑定时可关掉开关', async () => {
    const r = await call('POST', `/api/orgs/${ids.org}/members`, {
      token: tokens.admin,
      body: { username: 'subB_t', canReceive: false, allowGroupPull: false }
    })
    expect(r.status).toBe(200)
    expect(r.body.member.canReceive).toBe(false)
    expect(r.body.member.allowGroupPull).toBe(false)
  })

  it('★ 总部账号本人（非 admin）也能绑成员（requireOrgOwner 放行总部）', async () => {
    // hq 是华东集团总部但不在 org_members；先解绑 subB 再让 hq 重新绑上
    await call('DELETE', `/api/orgs/${ids.org}/members/${ids.subB}`, { token: tokens.admin })
    const r = await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.hq, body: { username: 'subB_t' } })
    expect(r.status).toBe(200)
    expect(r.body.member.userId).toBe(ids.subB)
  })
})

describe('④ requireOrgOwner 组织边界（规则 1）', () => {
  it('既非总部也非 admin → 403', async () => {
    // subA 是成员，但不是总部 → 一样 403
    const a = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}`, { token: tokens.subA, body: { canReceive: false } })
    expect(a.status).toBe(403)
    const b = await call('DELETE', `/api/orgs/${ids.org}/members/${ids.subA}`, { token: tokens.outsider })
    expect(b.status).toBe(403)
    const c = await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.outsider, body: { username: 'subB_t' } })
    expect(c.status).toBe(403)
  })

  it('别的集团的总部 → 403（不能跨组织操作）', async () => {
    const r = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}`, { token: tokens.outsider, body: { canReceive: false } })
    expect(r.status).toBe(403)
  })
})

describe('⑤ 改开关 PATCH /api/orgs/:id/members/:userId', () => {
  it('不在本集团 → 404；无有效字段 → 400', async () => {
    expect((await call('PATCH', `/api/orgs/${ids.org}/members/${ids.outsider}`, { token: tokens.admin, body: { canReceive: false } })).status).toBe(404)
    expect((await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}`, { token: tokens.admin, body: {} })).status).toBe(400)
  })

  it('只传一个开关时，另一个保持不变', async () => {
    const r1 = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}`, { token: tokens.admin, body: { canReceive: false } })
    expect(r1.status).toBe(200)
    expect(r1.body.member.canReceive).toBe(false)
    expect(r1.body.member.allowGroupPull).toBe(true)
    const r2 = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}`, { token: tokens.admin, body: { canReceive: true } })
    expect(r2.body.member.canReceive).toBe(true)
  })
})

describe('⑥ 解绑 DELETE /api/orgs/:id/members/:userId（规则 7 / 21）', () => {
  it('先造出两个方向的外来行（成员侧副本 + 集团侧镜像）', async () => {
    const db = getDb()
    // markers 有 NOT NULL: name / latitude / longitude
    const mkInsert = db.prepare(`
      INSERT INTO markers (name, latitude, longitude, user_id, origin_user_id, origin_row_id)
      VALUES (?, 31.23, 121.47, ?, ?, ?)
    `)
    mkInsert.run('集团下发的店', ids.subA, ids.hq, 1)      // 集团 → 成员（成员侧副本）
    mkInsert.run('成员带入集团', ids.hq, ids.subA, 2)      // 成员 → 集团（集团侧镜像）
    db.prepare(`INSERT INTO markers (name, latitude, longitude, user_id) VALUES (?, 31.23, 121.47, ?)`)
      .run('成员自有店', ids.subA)                          // 自己建的，解绑时绝不能被删
    // 顺便给 subA 一点额度，验证解绑不动额度
    db.prepare(`UPDATE users SET quota = 30 WHERE id = ?`).run(ids.subA)
    const c = db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ? AND origin_user_id IS NOT NULL`).get(ids.subA)
    expect(c.n).toBe(1)
  })

  it('?dryRun=1 只统计不改动', async () => {
    const r = await call('DELETE', `/api/orgs/${ids.org}/members/${ids.subA}?dryRun=1`, { token: tokens.admin })
    expect(r.status).toBe(200)
    expect(r.body.dryRun).toBe(true)
    expect(r.body.impact.memberCopies.markers).toBe(1)
    expect(r.body.impact.groupMirrors.markers).toBe(1)
    const db = getDb()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM org_members WHERE user_id = ?`).get(ids.subA).n).toBe(1)
  })

  it('★ 默认解绑：删除成员关系，但**保留**所有已同步行，且**不动 users.quota**', async () => {
    const r = await call('DELETE', `/api/orgs/${ids.org}/members/${ids.subA}`, { token: tokens.hq })
    expect(r.status).toBe(200)
    expect(r.body.purged).toBe(null)
    expect(r.body.keptByDefault).toBe(true)

    const db = getDb()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM org_members WHERE user_id = ?`).get(ids.subA).n).toBe(0)
    // 三个 marker 全在（含成员侧副本 —— 已变独立副本）
    expect(db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ids.subA).n).toBe(2)
    // 额度纹丝不动（解绑释放额度属 P1.5，规则 21）
    expect(db.prepare(`SELECT quota FROM users WHERE id = ?`).get(ids.subA).quota).toBe(30)
  })

  it('重新绑上后，显式 purge 两个方向才真删', async () => {
    expect((await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.admin, body: { username: 'subA_t' } })).status).toBe(200)
    const r = await call(
      'DELETE',
      `/api/orgs/${ids.org}/members/${ids.subA}?purgeMemberCopies=1&purgeGroupMirrors=1`,
      { token: tokens.admin }
    )
    expect(r.status).toBe(200)
    expect(r.body.purged.memberCopies.markers).toBe(1)
    expect(r.body.purged.groupMirrors.markers).toBe(1)
    const db = getDb()
    // 只剩成员自有的那 1 条
    expect(db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ids.subA).n).toBe(1)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ids.hq).n).toBe(0)
    // 额度依旧不动
    expect(db.prepare(`SELECT quota FROM users WHERE id = ?`).get(ids.subA).quota).toBe(30)
  })

  it('不是成员 → 404', async () => {
    expect((await call('DELETE', `/api/orgs/${ids.org}/members/${ids.subA}`, { token: tokens.admin })).status).toBe(404)
  })
})

describe('⑦ 我的组织 GET /api/orgs/me', () => {
  it('总部视角 → role=owner + 成员明细', async () => {
    const r = await call('GET', '/api/orgs/me', { token: tokens.hq })
    expect(r.status).toBe(200)
    expect(r.body.role).toBe('owner')
    expect(r.body.org.name).toBe('华东集团')
    expect(r.body.org.members.map(m => m.userId)).toContain(ids.subB)
  })

  it('成员视角 → role=member + 自己的开关与额度', async () => {
    const r = await call('GET', '/api/orgs/me', { token: tokens.subB })
    expect(r.status).toBe(200)
    expect(r.body.role).toBe('member')
    expect(r.body.org.id).toBe(ids.org)
    expect(r.body.member.userId).toBe(ids.subB)
    expect(typeof r.body.member.quota).toBe('number')
  })

  it('无关账号 → role=null（200，不报错）', async () => {
    const r = await call('GET', '/api/orgs/me', { token: tokens.lonely })
    expect(r.status).toBe(200)
    expect(r.body.role).toBe(null)
    expect(r.body.org).toBe(null)
  })

  it('既不是总部、也不是成员，但确实带了别的集团 → 走 owner 分支（outsider 是华南集团总部）', async () => {
    const r = await call('GET', '/api/orgs/me', { token: tokens.outsider })
    expect(r.body.role).toBe('owner')
    expect(r.body.org.name).toBe('华南集团')
  })

  it('未登录 → 401', async () => {
    expect((await call('GET', '/api/orgs/me')).status).toBe(401)
  })
})

describe('⑧ 成员知情确认 POST /api/orgs/me/consent', () => {
  it('非成员 → 404', async () => {
    expect((await call('POST', '/api/orgs/me/consent', { token: tokens.outsider })).status).toBe(404)
  })

  it('成员 → 写入 consented_at；重复调用幂等', async () => {
    const r1 = await call('POST', '/api/orgs/me/consent', { token: tokens.subB })
    expect(r1.status).toBe(200)
    expect(r1.body.alreadyConsented).toBe(false)
    expect(r1.body.consentedAt).toBeTruthy()

    const r2 = await call('POST', '/api/orgs/me/consent', { token: tokens.subB })
    expect(r2.body.alreadyConsented).toBe(true)
    expect(r2.body.consentedAt).toBe(r1.body.consentedAt)
  })
})

describe('⑨ 成员自主开关 PATCH /api/orgs/me/settings', () => {
  it('非成员 → 404；无字段 → 400', async () => {
    expect((await call('PATCH', '/api/orgs/me/settings', { token: tokens.outsider, body: { canReceive: false } })).status).toBe(404)
    expect((await call('PATCH', '/api/orgs/me/settings', { token: tokens.subB, body: {} })).status).toBe(400)
  })

  it('成员可自己关掉「可被集团拉取」，另一个开关不变', async () => {
    const before = await call('GET', '/api/orgs/me', { token: tokens.subB })
    const r = await call('PATCH', '/api/orgs/me/settings', { token: tokens.subB, body: { allowGroupPull: false } })
    expect(r.status).toBe(200)
    expect(r.body.member.allowGroupPull).toBe(false)
    expect(r.body.member.canReceive).toBe(before.body.member.canReceive)
  })
})

describe('⑩ ⛔ 刻意不实现的配额接口确实不存在（铁律 ②③ / 规则 17）', () => {
  const forbidden = [
    ['POST', `/api/orgs/${'{{ID}}'}/quota/revoke`],
    ['PUT', `/api/orgs/{{ID}}/quota`],
    ['POST', `/api/orgs/{{ID}}/quota/reallocate-from`],
    ['POST', `/api/orgs/{{ID}}/quota/transfer`],
    ['DELETE', `/api/orgs/{{ID}}/quota/ledger/1`]
  ]
  it('全部 404（若哪天变成 2xx/401，说明有人"补全"了后门）', async () => {
    for (const [m, p] of forbidden) {
      const r = await call(m, p.replace('{{ID}}', String(ids.org)), { token: tokens.admin, body: { amount: 1 } })
      expect(`${m} ${p} → ${r.status}`).toBe(`${m} ${p} → 404`)
    }
  })
})

// ---------------------------------------------------------------------------
// v0.9 补丁：解散集团（软删除立碑）
// 全部使用**本次新建的可抛弃账号/集团**，不干扰 ①~⑩ 的共享状态。
// ---------------------------------------------------------------------------

describe('⑪ 解散集团 DELETE /api/orgs/:id（软删除「立碑」）', () => {
  /** 就地造一个测试账号（不污染 beforeAll 的种子） */
  const mkUser = (username) => getDb().prepare(
    `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, 'x', 'user', 0)`
  ).run(username, `${username}@test.local`).lastInsertRowid

  let ownX, memX, ownY, tOwnX, tMemX, orgX, orgY

  it('准备：orgX（带 1 成员）/ orgY（无成员），总部账号各有一条「外来行」且带只读锁', async () => {
    ownX = mkUser('dis_ownX_t')
    memX = mkUser('dis_memX_t')
    ownY = mkUser('dis_ownY_t')
    tOwnX = makeToken({ id: ownX, username: 'dis_ownX_t', role: 'user' })
    tMemX = makeToken({ id: memX, username: 'dis_memX_t', role: 'user' })

    const a = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '待解散A', ownerUserId: ownX } })
    expect(a.status).toBe(200)
    orgX = a.body.org.id
    expect((await call('POST', `/api/orgs/${orgX}/members`, { token: tokens.admin, body: { username: 'dis_memX_t' } })).status).toBe(200)

    const b = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '待解散B', ownerUserId: ownY } })
    expect(b.status).toBe(200)
    orgY = b.body.org.id

    const db = getDb()
    const ins = db.prepare(`
      INSERT INTO markers (name, latitude, longitude, user_id, origin_user_id, origin_row_id, sync_readonly)
      VALUES (?, 31.23, 121.47, ?, ?, ?, 1)
    `)
    ins.run('前成员带入的店', ownX, memX, 1)
    ins.run('前成员带入的店B', ownY, memX, 2)
    // 总部账号的自有行：解散时绝不能被误伤
    db.prepare(`INSERT INTO markers (name, latitude, longitude, user_id) VALUES (?, 31.23, 121.47, ?)`)
      .run('总部自有店', ownX)
  })

  it('权限与参数：成员（非总部）→ 403；别的组织成员 → 403；不存在 → 404；非法 id → 400', async () => {
    expect((await call('DELETE', `/api/orgs/${orgX}`, { token: tMemX })).status).toBe(403)
    expect((await call('DELETE', `/api/orgs/${orgX}`, { token: tokens.subB })).status).toBe(403)
    expect((await call('DELETE', '/api/orgs/99999', { token: tokens.admin })).status).toBe(404)
    expect((await call('DELETE', '/api/orgs/abc', { token: tokens.admin })).status).toBe(400)
  })

  it('★ 仍有成员 → 409 + 成员清单，且集团原封不动（规则 7：删除不级联）', async () => {
    const r = await call('DELETE', `/api/orgs/${orgX}`, { token: tokens.admin })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('org_has_members')
    expect(r.body.impact.memberCount).toBe(1)
    expect(r.body.impact.members[0].username).toBe('dis_memX_t')

    const db = getDb()
    expect(db.prepare(`SELECT dissolved_at FROM organizations WHERE id = ?`).get(orgX).dissolved_at).toBe(null)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?`).get(orgX).n).toBe(1)
  })

  it('?dryRun=1 只统计不写库，且报出成员 / 外来行 / 台账规模', async () => {
    const r = await call('DELETE', `/api/orgs/${orgX}?dryRun=1`, { token: tokens.admin })
    expect(r.status).toBe(200)
    expect(r.body.dryRun).toBe(true)
    expect(r.body.impact.orgName).toBe('待解散A')
    expect(r.body.impact.memberCount).toBe(1)
    expect(r.body.impact.ownerMirrors.markers).toBe(1)

    const db = getDb()
    expect(db.prepare(`SELECT dissolved_at FROM organizations WHERE id = ?`).get(orgX).dissolved_at).toBe(null)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?`).get(orgX).n).toBe(1)
  })

  it('★ 解绑成员后可由总部本人解散；默认**释放**外来行（清 origin_* + 解除只读），不删数据', async () => {
    expect((await call('DELETE', `/api/orgs/${orgX}/members/${memX}`, { token: tokens.admin })).status).toBe(200)

    const r = await call('DELETE', `/api/orgs/${orgX}?reason=${encodeURIComponent('建错了，撤销重来')}`, { token: tOwnX })
    expect(r.status).toBe(200)
    expect(r.body.dissolvedAt).toBeTruthy()
    expect(r.body.released.markers).toBe(1)
    expect(r.body.purged).toBe(null)
    expect(r.body.ledgerKept).toBe(true)

    const db = getDb()
    const org = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(orgX)
    expect(org.dissolved_at).toBeTruthy()
    expect(org.dissolved_by).toBe(ownX)
    expect(org.dissolve_reason).toBe('建错了，撤销重来')

    // 外来行：行还在，但已变回可自由编辑的自有行
    const m = db.prepare(`SELECT * FROM markers WHERE user_id = ? AND name = ?`).get(ownX, '前成员带入的店')
    expect(m).toBeTruthy()
    expect(m.origin_user_id).toBe(null)
    expect(m.sync_readonly).toBe(0)
    // 总部自有行纹丝不动：解散后仍是 2 条
    expect(db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ownX).n).toBe(2)
    // 成员关系已清空
    expect(db.prepare(`SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?`).get(orgX).n).toBe(0)
  })

  it('解散后：不在列表、/me 归零、且不可再被任何接口操作（404，立碑生效）', async () => {
    const list = await call('GET', '/api/orgs', { token: tokens.admin })
    expect(list.body.orgs.some(o => o.id === orgX)).toBe(false)

    const me = await call('GET', '/api/orgs/me', { token: tOwnX })
    expect(me.status).toBe(200)
    expect(me.body.role).toBe(null)
    expect(me.body.org).toBe(null)

    // findOrg 只认未解散 → requireOrgOwner 404
    expect((await call('POST', `/api/orgs/${orgX}/members`, { token: tokens.admin, body: { username: 'subB_t' } })).status).toBe(404)
    expect((await call('DELETE', `/api/orgs/${orgX}`, { token: tokens.admin })).status).toBe(404)
    // 总部账号本人也不再是任何组织视角
    expect((await call('GET', '/api/orgs/me', { token: tOwnX })).body.role).toBe(null)
  })

  it('★ 解散后名称可复用、原总部账号可再任新集团总部（真正"撤销重来"）', async () => {
    const r = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '待解散A', ownerUserId: ownX } })
    expect(r.status).toBe(200)
    expect(r.body.org.id).not.toBe(orgX)
    ids.rebuilt = r.body.org.id
  })

  it('?purgeGroupMirrors=1 → 改为物理删除总部账号里的外来行（用户明确要清掉）', async () => {
    const r = await call('DELETE', `/api/orgs/${orgY}?purgeGroupMirrors=1`, { token: tokens.admin })
    expect(r.status).toBe(200)
    expect(r.body.purged.markers).toBe(1)
    expect(r.body.released).toBe(null)
    expect((await call('GET', '/api/orgs', { token: tokens.admin })).body.orgs.some(o => o.id === orgY)).toBe(false)
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ownY).n).toBe(0)
  })

  it('★ 台账只增不删：解散不动 quota_grants / sync_batches，且不留悬空 org_id（规则 17）', async () => {
    const db = getDb()
    const u = mkUser('dis_ledger_t')
    const g = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '台账集团', ownerUserId: u } })
    expect(g.status).toBe(200)
    const gid = g.body.org.id

    db.prepare(`
      INSERT INTO quota_grants (org_id, grant_kind, from_user_id, to_user_id, amount, created_by)
      VALUES (?, 'pool_grant', ?, ?, 10, ?)
    `).run(gid, u, u, ids.admin)
    db.prepare(`
      INSERT INTO sync_batches (org_id, direction, source_user_id, target_user_id, scope)
      VALUES (?, 'group_to_member', ?, ?, 'markers')
    `).run(gid, u, u)

    const dry = await call('DELETE', `/api/orgs/${gid}?dryRun=1`, { token: tokens.admin })
    expect(dry.body.impact.ledgerRows).toBe(1)
    expect(dry.body.impact.syncBatches).toBe(1)

    expect((await call('DELETE', `/api/orgs/${gid}`, { token: tokens.admin })).status).toBe(200)

    expect(db.prepare(`SELECT COUNT(*) AS n FROM quota_grants  WHERE org_id = ?`).get(gid).n).toBe(1)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM sync_batches WHERE org_id = ?`).get(gid).n).toBe(1)
    // 软删除的价值：org_id 仍指向一条真实存在的 organizations 记录（不会悬空）
    expect(db.prepare(`SELECT id FROM organizations WHERE id = ?`).get(gid)).toBeTruthy()
  })

  it('★ 解散不动 users.quota（额度回收属 P1.5，本文件恒不写配额）', async () => {
    const db = getDb()
    const u = mkUser('dis_quota_t')
    db.prepare(`UPDATE users SET quota = 77 WHERE id = ?`).run(u)
    const g = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '额度集团', ownerUserId: u } })
    expect(g.status).toBe(200)

    expect((await call('DELETE', `/api/orgs/${g.body.org.id}`, { token: tokens.admin })).status).toBe(200)
    expect(db.prepare(`SELECT quota FROM users WHERE id = ?`).get(u).quota).toBe(77)
  })
})

// ---------------------------------------------------------------------------
// P1.5：二级再分配（§3.8 · 规则 26~31）+ 跨组织总览（§7.9 F4 · 规则 24）
// 全部用本次新建的可抛弃账号/集团，不干扰 ①~⑪ 的共享状态。
// ---------------------------------------------------------------------------

describe('⑫ 二级再分配 POST /api/orgs/:id/quota/reallocate（§3.8 · 规则 26~31）', () => {
  const mkUser = (username, quota = 0) => getDb().prepare(
    `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, 'x', 'user', ?)`
  ).run(username, `${username}@test.local`, quota).lastInsertRowid
  const tok = (u, name) => makeToken({ id: u, username: name, role: 'user' })
  const sumQuota = (db, us) => us.reduce(
    (s, u) => s + (db.prepare(`SELECT quota FROM users WHERE id = ?`).get(u)?.quota || 0), 0
  )
  const sumChange = (db, u) => db.prepare(
    `SELECT COALESCE(SUM(change_amount), 0) AS n FROM quota_history WHERE user_id = ?`
  ).get(u).n

  it('准备：orgA(总部300·无消耗, 2成员) / orgB(总部300·已消耗80, 1成员)', async () => {
    const db = getDb()
    p15.ownA = mkUser('re_ownA_t', 300); p15.mA1 = mkUser('re_mA1_t', 0); p15.mA2 = mkUser('re_mA2_t', 0)
    p15.ownB = mkUser('re_ownB_t', 300); p15.mB1 = mkUser('re_mB1_t', 0)
    p15.tOwnA = tok(p15.ownA, 're_ownA_t'); p15.tMA1 = tok(p15.mA1, 're_mA1_t')
    p15.tMA2 = tok(p15.mA2, 're_mA2_t'); p15.tOwnB = tok(p15.ownB, 're_ownB_t')

    const a = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '再分配集团A', ownerUserId: p15.ownA } })
    expect(a.status).toBe(200); p15.orgA = a.body.org.id
    expect((await call('POST', `/api/orgs/${p15.orgA}/members`, { token: tokens.admin, body: { username: 're_mA1_t' } })).status).toBe(200)
    expect((await call('POST', `/api/orgs/${p15.orgA}/members`, { token: tokens.admin, body: { username: 're_mA2_t' } })).status).toBe(200)

    const b = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '再分配集团B', ownerUserId: p15.ownB } })
    expect(b.status).toBe(200); p15.orgB = b.body.org.id
    expect((await call('POST', `/api/orgs/${p15.orgB}/members`, { token: tokens.admin, body: { username: 're_mB1_t' } })).status).toBe(200)

    // ownB 已消耗 80 → 可转上限 = 300 − 80 = 220（规则 30：已花掉的不许转走）
    db.prepare(`INSERT INTO purchases (user_id, quota_used, status) VALUES (?, 80, 'active')`).run(p15.ownB)
  })

  it('toUserId === 自己 → 400 self_move_forbidden（规则 27）', async () => {
    const r = await call('POST', `/api/orgs/${p15.orgA}/quota/reallocate`, {
      token: p15.tOwnA, body: { toUserId: p15.ownA, amount: 10 }
    })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('self_move_forbidden')
  })

  it('toUserId 非本组织成员 → 404', async () => {
    const r = await call('POST', `/api/orgs/${p15.orgA}/quota/reallocate`, {
      token: p15.tOwnA, body: { toUserId: p15.mB1, amount: 10 }   // mB1 属 orgB
    })
    expect(r.status).toBe(404)
  })

  it('amount 非正整数 → 400', async () => {
    for (const amount of [0, -5, 1.5, 'x']) {
      const r = await call('POST', `/api/orgs/${p15.orgA}/quota/reallocate`, {
        token: p15.tOwnA, body: { toUserId: p15.mA1, amount }
      })
      expect(`amount=${amount} → ${r.status}`).toBe(`amount=${amount} → 400`)
    }
  })

  it('★ 转出额 > 自己未消耗余额 → 400 insufficient_own_quota（附 额度/已消耗/可转 明细，规则 30）', async () => {
    const r = await call('POST', `/api/orgs/${p15.orgB}/quota/reallocate`, {
      token: p15.tOwnB, body: { toUserId: p15.mB1, amount: 221 }
    })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('insufficient_own_quota')
    expect(r.body.quota).toBe(300)
    expect(r.body.used).toBe(80)
    expect(r.body.transferable).toBe(220)
    // 边界：正好 220 应放行（本轮不改额度，仅验不被 400 拦）—— 见下一例
    const ok = await call('POST', `/api/orgs/${p15.orgB}/quota/reallocate`, {
      token: p15.tOwnB, body: { toUserId: p15.mB1, amount: 220 }
    })
    expect(ok.status).toBe(200)
    expect(ok.body.from).toEqual({ userId: p15.ownB, before: 300, after: 80 })
    expect(ok.body.to).toEqual({ userId: p15.mB1, before: 0, after: 220 })
  })

  it('★ 成功（orgA 转 100）：两方额度一增一减，且**不改变**组织总额 / 物理池 / 全池可分配（规则 28）', async () => {
    const db = getDb()
    const { getAllocatable, getPoolRemaining } = await import('../src/utils/quotaPool.js')
    const orgTotalBefore = sumQuota(db, [p15.ownA, p15.mA1, p15.mA2])
    const physBefore = getPoolRemaining(db)
    const allocBefore = getAllocatable(db)
    const fromSumBefore = sumChange(db, p15.ownA)
    const toSumBefore = sumChange(db, p15.mA1)

    const r = await call('POST', `/api/orgs/${p15.orgA}/quota/reallocate`, {
      token: p15.tOwnA, body: { toUserId: p15.mA1, amount: 100, note: 'Q3 一线补充' }
    })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.grantKind).toBe('org_move')
    expect(r.body.from).toEqual({ userId: p15.ownA, before: 300, after: 200 })
    expect(r.body.to).toEqual({ userId: p15.mA1, before: 0, after: 100 })
    expect(r.body.orgTotalUnchanged).toBe(true)
    expect(r.body.allocatableUnchanged).toBe(true)

    // 恒等式 ③：组织总授权额度不变（§3.8 Ⅲ）
    expect(sumQuota(db, [p15.ownA, p15.mA1, p15.mA2])).toBe(orgTotalBefore)
    // 恒等式 ④：物理池 / 全池可分配不变
    expect(getPoolRemaining(db)).toBe(physBefore)
    expect(getAllocatable(db)).toBe(allocBefore)
    // 逐账号对账：Σ(change_amount) 的增量 === users.quota 的增量（两侧都成立）
    expect(sumChange(db, p15.ownA) - fromSumBefore).toBe(-100)
    expect(sumChange(db, p15.mA1) - toSumBefore).toBe(100)
  })

  it('★ 双写：1 行 quota_grants(org_move) + 2 行 quota_history(org_move_out / org_move_in)（规则 29）', async () => {
    const db = getDb()
    const g = db.prepare(
      `SELECT * FROM quota_grants WHERE org_id = ? AND grant_kind = 'org_move' ORDER BY id DESC LIMIT 1`
    ).get(p15.orgA)
    expect(g).toBeTruthy()
    expect(g.from_user_id).toBe(p15.ownA)
    expect(g.to_user_id).toBe(p15.mA1)
    expect(g.amount).toBe(100)
    expect(g.from_before).toBe(300)
    expect(g.from_after).toBe(200)
    expect(g.quota_before).toBe(0)
    expect(g.quota_after).toBe(100)
    expect(g.note).toBe('Q3 一线补充')

    const out = db.prepare(
      `SELECT * FROM quota_history WHERE user_id = ? AND action = 'org_move_out' ORDER BY id DESC LIMIT 1`
    ).get(p15.ownA)
    const inn = db.prepare(
      `SELECT * FROM quota_history WHERE user_id = ? AND action = 'org_move_in' ORDER BY id DESC LIMIT 1`
    ).get(p15.mA1)
    expect(out.change_amount).toBe(-100)          // 负数流水允许（台账 CHECK 只约束 grants）
    expect(out.source_user_id).toBe(p15.ownA)
    expect(inn.change_amount).toBe(100)
    expect(inn.source_user_id).toBe(p15.ownA)     // 受赠方记「出资方」
  })

  it('非 owner（成员本人）→ 403（铁律 ③：子公司之间天然无法互转）', async () => {
    const r = await call('POST', `/api/orgs/${p15.orgA}/quota/reallocate`, {
      token: p15.tMA1, body: { toUserId: p15.mA2, amount: 10 }
    })
    expect(r.status).toBe(403)
  })

  it('★ 允许把自己转空（P11 · 规则 31）：再转 200 给 mA2 → 总部 users.quota 归 0', async () => {
    const db = getDb()
    const r = await call('POST', `/api/orgs/${p15.orgA}/quota/reallocate`, {
      token: p15.tOwnA, body: { toUserId: p15.mA2, amount: 200 }
    })
    expect(r.status).toBe(200)
    expect(r.body.from).toEqual({ userId: p15.ownA, before: 200, after: 0 })
    expect(db.prepare(`SELECT quota FROM users WHERE id = ?`).get(p15.ownA).quota).toBe(0)
    // 转空后组织总授权仍为 300（0 + 100 + 200）
    expect(sumQuota(db, [p15.ownA, p15.mA1, p15.mA2])).toBe(300)
  })
})

describe('⑬ 跨组织配额总览 GET /api/orgs/quota/overview（§7.9 F4 · 规则 24）', () => {
  it('非 admin → 403（跨组织可见性边界：集团 owner 也不可见）', async () => {
    expect((await call('GET', '/api/orgs/quota/overview', { token: tokens.hq })).status).toBe(403)
    expect((await call('GET', '/api/orgs/quota/overview', { token: p15.tOwnA })).status).toBe(403)
  })

  it('未登录 → 401', async () => {
    expect((await call('GET', '/api/orgs/quota/overview')).status).toBe(401)
  })

  it('admin → 200，返回 pool / orgs / direct / reconcile', async () => {
    const r = await call('GET', '/api/orgs/quota/overview', { token: tokens.admin })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.pool.poolTotal).toBeGreaterThanOrEqual(0)
    expect(typeof r.body.pool.remaining).toBe('number')
    expect(typeof r.body.pool.allocatable).toBe('number')
    expect(Array.isArray(r.body.orgs)).toBe(true)
    expect(r.body.direct).toBeTruthy()
    expect(r.body.reconcile).toBeTruthy()
  })

  it('★ 恒等式自检：allocatedUsers === Σ组织 quotaTotal + 平台直配（reconcile.ok）', async () => {
    const r = await call('GET', '/api/orgs/quota/overview', { token: tokens.admin })
    const { reconcile, pool } = r.body
    expect(reconcile.allocatedUsers).toBe(pool.allocatedUsers)
    expect(reconcile.expected).toBe(reconcile.sumOrgQuota + reconcile.directAllocated)
    expect(reconcile.diff).toBe(0)
    expect(reconcile.ok).toBe(true)
  })

  it('★ 再分配集团A 出现在总览：已分配 300 / 台账拆 一级0 + 二级300 / 总部为第一行', async () => {
    const r = await call('GET', '/api/orgs/quota/overview', { token: tokens.admin })
    const o = r.body.orgs.find(x => x.orgId === p15.orgA)
    expect(o).toBeTruthy()
    expect(o.quotaTotal).toBe(300)                  // ⑫ 转出 300 后：0 + 100 + 200
    expect(o.grantedMove).toBe(300)                 // 全部来自二级再分配
    expect(o.grantedPool).toBe(0)                   // 无一级分配
    expect(o.grantedTotal).toBe(300)
    expect(o.grantCount).toBe(2)                    // ⑫ 两次 org_move
    expect(o.lastGrantAt).toBeTruthy()
    expect(o.members[0].isOwner).toBe(true)
    expect(o.members[0].userId).toBe(p15.ownA)
    // 组织级 = Σ(总部 + 成员)
    const sumQuota = o.members.reduce((s, m) => s + m.quota, 0)
    expect(o.quotaTotal).toBe(sumQuota)
  })

  it('★ 组织成员行带 quota / used / unconsumed（未消耗 = max(0, 额度 − 已消耗)）', async () => {
    const r = await call('GET', '/api/orgs/quota/overview', { token: tokens.admin })
    const o = r.body.orgs.find(x => x.orgId === p15.orgB)
    expect(o).toBeTruthy()
    const ownerRow = o.members.find(m => m.isOwner)
    expect(ownerRow.quota).toBe(80)                 // 300 − 220 已转出
    expect(ownerRow.used).toBe(80)                  // 已消耗
    expect(ownerRow.unconsumed).toBe(0)             // max(0, 80 − 80)
    const m1 = o.members.find(m => m.userId === p15.mB1)
    expect(m1.quota).toBe(220)
    expect(m1.used).toBe(0)
    expect(m1.unconsumed).toBe(220)
    expect(o.quotaTotal).toBe(300)
    expect(o.consumed).toBe(80)
    expect(o.unconsumed).toBe(220)
  })

  it('★ 只读：不提供任何"调低/收回"入口（规则 24 的接口层体现）', async () => {
    const r = await call('PUT', `/api/orgs/${p15.orgA}/quota`, { token: tokens.admin, body: { amount: 1 } })
    expect(r.status).toBe(404)
    const r2 = await call('POST', `/api/orgs/${p15.orgA}/quota/revoke`, { token: tokens.admin, body: { amount: 1 } })
    expect(r2.status).toBe(404)
  })
})
