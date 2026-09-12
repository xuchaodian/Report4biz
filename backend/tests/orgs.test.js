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
