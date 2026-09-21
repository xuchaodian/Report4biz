/**
 * 集团品牌 Logo 读时继承测试 —— v1.13.160
 *
 * 需求（用户原话，2026-09-21）：
 *   「集团公司账号在个人-设置图标里上传的品牌logo对子公司账号也可见
 *     （子公司无需再重复上传品牌logo）」
 *
 * 被测：src/utils/brandLogo.js + 三个「回当前登录用户」的接口
 *   · POST /api/auth/login
 *   · GET  /api/auth/me
 *   · PUT  /api/users/me
 *
 * 本测试要钉死的不变量：
 *   A. 总部账号（集团 logo 的来源）不参与继承，行为与改动前完全一致
 *   B. 成员无自有 logo + 集团有 → 拿到集团 logo（source='group'，回带集团名）
 *   C. 成员**已有自有 logo** → 自有优先（source='self'），集团不覆盖
 *   D. 集团存在但总部没传 logo → 不继承（effective = null，与历史行为一致）
 *   E. 已解散集团不继承（dissolved_at 非空）
 *   F. 被移出集团 ⇒ 继承**立即**消失（读时判定，不需要任何清理任务）
 *   G. 集团换 logo ⇒ 成员**立刻**拿到新图（零同步、零重登）
 *   H. ⭐ 成员关闭「允许集团拉取」（allow_group_pull=0）**仍继承**
 *      —— 该开关管的是「集团能否拉走我的数据」（上行），logo 是集团自有资产的
 *         下行展示（2026-09-21 拍板）。本用例防的就是「顺手把开关也读进来」。
 *   I. ⭐ **零复制**：整套解析过程不写库 —— 成员行 users.logo 必须仍是 NULL，
 *      全表行数快照前后一致。这是本方案与「上传时复制到各成员」的本质区别：
 *      一旦把集团图复制进成员行，集团换图成员就再也跟不上。
 *   J. 三个端点口径一致（都带 logo_effective / logo_source / logo_group_name）
 *   K. 成员自己上传 / 清空 logo ⇒ source 在 self 与 group 之间正确切换
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import bcrypt from 'bcryptjs'

const tmpDb = path.join(os.tmpdir(), `r4b-brandlogo-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

const LOGO_HQ1 = 'data:image/png;base64,AAA_GROUP_ONE'
const LOGO_SUBB = 'data:image/png;base64,BBB_OWN_SUBB'
const LOGO_HQ2 = 'data:image/png;base64,CCC_GROUP_TWO'
const LOGO_HQ4 = 'data:image/png;base64,DDD_DISSOLVED'
const LOGO_HQ5 = 'data:image/png;base64,EEE_TEMP_GROUP'

let db, groupLogoFor, resolveLogo, withResolvedLogo, signToken
let server, base
const ids = {}
const tokens = {}

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

/** 全表行数快照 —— 用于证明"解析过程零写入" */
function snapshotCounts() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all()
  const out = {}
  for (const t of tables) out[t.name] = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get().c
  return out
}

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  db = dbMod.getDb()

  const bl = await import('../src/utils/brandLogo.js')
  groupLogoFor = bl.groupLogoFor
  resolveLogo = bl.resolveLogo
  withResolvedLogo = bl.withResolvedLogo

  const { signToken: st } = await import('../src/utils/tokenAuth.js')
  signToken = st

  const mkUser = (username, { role = 'user', company = null, logo = null, password = 'x' } = {}) => {
    const r = db.prepare(
      `INSERT INTO users (username, email, password, role, company, logo) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(username, `${username}@test.local`, password, role, company, logo)
    return r.lastInsertRowid
  }

  // ---- 集团甲：总部有 logo，两个成员（一个无自有、一个有自有）----
  ids.hq1 = mkUser('bl_hq1', { company: '测试集团甲总部', logo: LOGO_HQ1 })
  ids.subA = mkUser('bl_subA', { company: '甲-A子公司' })                       // 无自有 logo
  ids.subB = mkUser('bl_subB', { company: '甲-B子公司', logo: LOGO_SUBB })       // 有自有 logo
  const org1 = db.prepare(`INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`)
    .run('测试集团甲', ids.hq1).lastInsertRowid
  db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`).run(org1, ids.subA)
  db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`).run(org1, ids.subB)

  // ---- 集团乙：成员**关闭了「允许集团拉取」** ----
  ids.hq2 = mkUser('bl_hq2', { company: '测试集团乙总部', logo: LOGO_HQ2 })
  ids.subC = mkUser('bl_subC', { company: '乙-C子公司' })
  const org2 = db.prepare(`INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`)
    .run('测试集团乙', ids.hq2).lastInsertRowid
  db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 0)`).run(org2, ids.subC)

  // ---- 集团丙：总部**还没传** logo ----
  ids.hq3 = mkUser('bl_hq3', { company: '无Logo集团总部' })
  ids.subD = mkUser('bl_subD', { company: '丙-D子公司' })
  const org3 = db.prepare(`INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`)
    .run('无Logo集团', ids.hq3).lastInsertRowid
  db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`).run(org3, ids.subD)

  // ---- 集团丁：**已解散**（软删除立碑）----
  ids.hq4 = mkUser('bl_hq4', { company: '已解散集团总部', logo: LOGO_HQ4 })
  ids.subE = mkUser('bl_subE', { company: '丁-E子公司' })
  const org4 = db.prepare(`INSERT INTO organizations (name, owner_user_id, dissolved_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
    .run('已解散集团', ids.hq4).lastInsertRowid
  db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`).run(org4, ids.subE)
  ids.org4 = org4

  // ---- 集团戊：用于「被移出集团」用例 ----
  ids.hq5 = mkUser('bl_hq5', { company: '临时集团总部', logo: LOGO_HQ5 })
  ids.subG = mkUser('bl_subG', { company: '戊-G子公司' })
  const org5 = db.prepare(`INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`)
    .run('临时集团', ids.hq5).lastInsertRowid
  db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`).run(org5, ids.subG)
  ids.org5 = org5

  // ---- 无集团账号 ----
  ids.outsider = mkUser('bl_outsider', { company: '散客公司' })

  // ---- 登录用账号（真密码；刻意不属于任何集团，用于验证"无集团"分支）----
  ids.loginSub = mkUser('bl_login_sub', {
    company: '登录子账号',
    password: bcrypt.hashSync('pw123456', 10)
  })

  for (const k of ['hq1', 'subA', 'subB', 'subC', 'subD', 'subE', 'subG', 'outsider', 'loginSub']) {
    tokens[k] = signToken({ id: ids[k], username: `bl_${k}`, role: 'user', token_version: 0 })
  }

  const express = (await import('express')).default
  const authRouter = (await import('../src/routes/auth.js')).default
  const usersRouter = (await import('../src/routes/users.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  app.use('/api/users', usersRouter)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ===========================================================================
describe('A/B/C/D/E/F 解析口径（resolveLogo 纯函数）', () => {
  it('A1 总部账号（集团 logo 来源）不参与继承：用自己的 logo', () => {
    const r = resolveLogo(db, { id: ids.hq1, logo: LOGO_HQ1 })
    expect(r.logo_source).toBe('self')
    expect(r.logo_effective).toBe(LOGO_HQ1)
    expect(r.logo_group_name).toBeNull()
  })

  it('A2 总部账号没传 logo 时，不会去继承别人的（返回 null）', () => {
    const r = resolveLogo(db, { id: ids.hq3, logo: null })
    expect(r.logo_source).toBeNull()
    expect(r.logo_effective).toBeNull()
  })

  it('A3 总部账号**不会**继承自己集团（它本就是来源，拿自己那张）', () => {
    expect(groupLogoFor(db, ids.hq1)).toBeNull()
  })

  it('B1 成员无自有 logo ⇒ 继承集团 logo，并回带集团名', () => {
    const r = resolveLogo(db, { id: ids.subA, logo: null })
    expect(r.logo_source).toBe('group')
    expect(r.logo_effective).toBe(LOGO_HQ1)
    expect(r.logo_group_name).toBe('测试集团甲')
  })

  it('B2 groupLogoFor 能取到集团与总部信息（供 UI 提示与排查）', () => {
    const g = groupLogoFor(db, ids.subA)
    expect(g.orgName).toBe('测试集团甲')
    expect(g.ownerUserId).toBe(Number(ids.hq1))
    expect(g.logo).toBe(LOGO_HQ1)
  })

  it('C1 成员**已有自有 logo** ⇒ 自有优先，集团不覆盖', () => {
    const r = resolveLogo(db, { id: ids.subB, logo: LOGO_SUBB })
    expect(r.logo_source).toBe('self')
    expect(r.logo_effective).toBe(LOGO_SUBB)
  })

  it('C2 自有 logo 为空字符串 ⇒ 视为"没传"，仍应继承', () => {
    const r = resolveLogo(db, { id: ids.subA, logo: '   ' })
    expect(r.logo_source).toBe('group')
    expect(r.logo_effective).toBe(LOGO_HQ1)
  })

  it('D1 集团存在但总部没传 logo ⇒ 不继承（effective 为 null）', () => {
    const r = resolveLogo(db, { id: ids.subD, logo: null })
    expect(r.logo_source).toBeNull()
    expect(r.logo_effective).toBeNull()
  })

  it('E1 已解散集团 ⇒ 不继承（立碑后品牌关系一起失效）', () => {
    const r = resolveLogo(db, { id: ids.subE, logo: null })
    expect(r.logo_source).toBeNull()
    expect(r.logo_effective).toBeNull()
    expect(groupLogoFor(db, ids.subE)).toBeNull()
  })

  it('F 无集团账号 ⇒ 不继承', () => {
    const r = resolveLogo(db, { id: ids.outsider, logo: null })
    expect(r.logo_source).toBeNull()
    expect(r.logo_effective).toBeNull()
  })

  it('H ⭐成员关闭「允许集团拉取」仍继承 logo（该开关只管数据上行，2026-09-21 拍板）', () => {
    const r = resolveLogo(db, { id: ids.subC, logo: null })
    expect(r.logo_source).toBe('group')
    expect(r.logo_effective).toBe(LOGO_HQ2)
  })

  it('J 纯函数：不修改传入的 user 对象', () => {
    const u = { id: ids.subA, username: 'bl_subA', logo: null }
    const keysBefore = Object.keys(u).sort()
    withResolvedLogo(db, u)
    expect(u.logo).toBeNull()
    expect(Object.keys(u).sort()).toEqual(keysBefore)
  })
})

// ===========================================================================
describe('G/F 读时特性（无需同步、无需清理任务）', () => {
  it('G1 集团换 logo ⇒ 成员立刻拿到新图（成员行一个字节没动）', () => {
    const NEW = 'data:image/png;base64,ZZZ_NEW_GROUP_ONE'
    db.prepare(`UPDATE users SET logo = ? WHERE id = ?`).run(NEW, ids.hq1)
    try {
      expect(resolveLogo(db, { id: ids.subA, logo: null }).logo_effective).toBe(NEW)
    } finally {
      db.prepare(`UPDATE users SET logo = ? WHERE id = ?`).run(LOGO_HQ1, ids.hq1)
    }
    expect(resolveLogo(db, { id: ids.subA, logo: null }).logo_effective).toBe(LOGO_HQ1)
  })

  it('F1 被移出集团 ⇒ 继承立即消失（无需任何清理任务）', () => {
    expect(resolveLogo(db, { id: ids.subG, logo: null }).logo_source).toBe('group')
    db.prepare(`DELETE FROM org_members WHERE org_id = ? AND user_id = ?`).run(ids.org5, ids.subG)
    expect(resolveLogo(db, { id: ids.subG, logo: null }).logo_source).toBeNull()
    // 复原，避免影响后续用例
    db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`).run(ids.org5, ids.subG)
  })

  it('E2 集团被解散 ⇒ 继承随之消失', () => {
    db.prepare(`UPDATE organizations SET dissolved_at = NULL WHERE id = ?`).run(ids.org4)
    expect(resolveLogo(db, { id: ids.subE, logo: null }).logo_source).toBe('group')
    db.prepare(`UPDATE organizations SET dissolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(ids.org4)
    expect(resolveLogo(db, { id: ids.subE, logo: null }).logo_source).toBeNull()
  })

  it('I ⭐零复制：解析过程不写库 —— 成员行 logo 仍为 NULL，全表行数快照一致', () => {
    const before = snapshotCounts()
    for (let i = 0; i < 5; i++) {
      resolveLogo(db, { id: ids.subA, logo: null })
      resolveLogo(db, { id: ids.subB, logo: LOGO_SUBB })
      groupLogoFor(db, ids.subA)
    }
    const after = snapshotCounts()
    expect(after).toEqual(before)
    expect(db.prepare(`SELECT logo FROM users WHERE id = ?`).get(ids.subA).logo).toBeNull()
    expect(db.prepare(`SELECT logo FROM users WHERE id = ?`).get(ids.subD).logo).toBeNull()
  })
})

// ===========================================================================
describe('J/K 三个读端点口径一致', () => {
  it('J1 GET /api/auth/me：返回 logo_effective/source/group_name，且 logo 仍是自有原值', async () => {
    const { status, body } = await call('GET', '/api/auth/me', { token: tokens.subA })
    expect(status).toBe(200)
    expect(body.user.logo).toBeNull()                       // 自有原义不变
    expect(body.user.logo_source).toBe('group')
    expect(body.user.logo_effective).toBe(LOGO_HQ1)
    expect(body.user.logo_group_name).toBe('测试集团甲')
  })

  it('J2 GET /api/auth/me：有自有 logo 的成员 → source=self', async () => {
    const { body } = await call('GET', '/api/auth/me', { token: tokens.subB })
    expect(body.user.logo).toBe(LOGO_SUBB)
    expect(body.user.logo_source).toBe('self')
    expect(body.user.logo_effective).toBe(LOGO_SUBB)
  })

  it('J3 GET /api/auth/me：无集团账号 → source 为 null（行为与改动前一致）', async () => {
    const { body } = await call('GET', '/api/auth/me', { token: tokens.outsider })
    expect(body.user.logo_source).toBeNull()
    expect(body.user.logo_effective).toBeNull()
  })

  it('J4 POST /api/auth/login：登录返回体同样带上三个字段', async () => {
    const { status, body } = await call('POST', '/api/auth/login', {
      body: { username: 'bl_login_sub', password: 'pw123456' }
    })
    expect(status).toBe(200)
    expect(body.token).toBeTruthy()
    expect(body.user).toHaveProperty('logo_effective')
    expect(body.user).toHaveProperty('logo_source')
    expect(body.user).toHaveProperty('logo_group_name')
    expect(body.user.logo_source).toBeNull()   // 该账号不属于任何集团
  })

  it('K1 PUT /api/users/me 只改公司名 ⇒ 不会被误判成改了 logo，集团图**不会**被复制进本账号', async () => {
    const { status, body } = await call('PUT', '/api/users/me', {
      token: tokens.subA,
      body: { company: '甲-A子公司（改名后）' }
    })
    expect(status).toBe(200)
    expect(body.user.logo_source).toBe('group')
    expect(db.prepare(`SELECT logo FROM users WHERE id = ?`).get(ids.subA).logo).toBeNull()
  })

  it('K2 成员自己上传 logo ⇒ 切到 self；清空 ⇒ 回到 group 继承', async () => {
    const OWN = 'data:image/png;base64,SUB_A_OWN'
    const up = await call('PUT', '/api/users/me', { token: tokens.subA, body: { logo: OWN } })
    expect(up.body.user.logo_source).toBe('self')
    expect(up.body.user.logo_effective).toBe(OWN)

    const back = await call('PUT', '/api/users/me', { token: tokens.subA, body: { logo: '' } })
    expect(back.body.user.logo_source).toBe('group')
    expect(back.body.user.logo_effective).toBe(LOGO_HQ1)
    // 清空写入的是空串（不是 NULL），两种形态都必须被视为"没传 logo"
    expect(String(db.prepare(`SELECT logo FROM users WHERE id = ?`).get(ids.subA).logo || '')).toBe('')
  })

  it('I2 ⭐端点层零复制：连打 /me 后全表行数快照与成员 logo 均不变', async () => {
    const before = snapshotCounts()
    const logosBefore = db.prepare(`SELECT id, logo FROM users ORDER BY id`).all()
    for (let i = 0; i < 3; i++) {
      await call('GET', '/api/auth/me', { token: tokens.subA })
      await call('GET', '/api/auth/me', { token: tokens.subC })
    }
    expect(snapshotCounts()).toEqual(before)
    expect(db.prepare(`SELECT id, logo FROM users ORDER BY id`).all()).toEqual(logosBefore)
  })
})
