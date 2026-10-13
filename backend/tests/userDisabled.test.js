/**
 * 账号「停用」能力 —— v1.13.216
 *
 * 背景：本库**未开** `PRAGMA foreign_keys`（见 models/database.js 里 org_members 处的自述
 *   「不会报错，只会静默脏掉」）⇒ `DELETE /api/users/:id` **不级联**，只留孤儿行。
 *   生产只读实测（2026-10-13）：`users` id 跨 1..39 却只有 31 行 ⇒ 历史**已删 8 个账号**，
 *   留下 `markers` **754** ＋ `competitors` **499** ＝ **1253 行孤儿**（其余 9 张表为 0）。
 *
 * 本批（语义 S2）不改 DELETE 的级联，而是新增**可逆的「停用」**作为默认动作：
 *   ⭐ 停用 ＝ **单条 UPDATE** 一次完成「改名释放 ＋ 记原值 ＋ bump 版本」⇒ 1 次写，无需事务
 *      （分开写＝3 次写，按「同请求写点 ≥2 才包事务」就得包事务；合成一条更省一次落盘）
 *   ⭐ 为什么必须改写 username/email：两者在 users 表上是 `UNIQUE NOT NULL`（database.js:75-76）
 *      ⇒ 不改写则同名/同邮箱**永远无法重新注册**；且 email 为 NOT NULL，连置空都不行。
 *      改写后原值存入 `disabled_prev_*`，恢复时还原。
 *   ⭐ DELETE 保留但加「必须已停用」前置 ⇒ 堵住老路径（不再产生新孤儿），
 *      并给 S3 的「对已停用账号彻底删除」留好现成接口。
 *
 * 本测试锁 7 件事：
 *   ① 源码：三列幂等 ALTER；verifyTokenPayload 含 disabled 判据；PATCH /:id/status 存在；
 *      login 的 disabled 闸门必须排在 signToken **之前**；DELETE 的 gate 排在 DELETE 语句之前
 *   ② 停用后库内字段全对（disabled_at / prev 两列 / username / email / token_version +1）
 *   ③ 停用后**旧 token 立即失效**（不只是"不能登录" —— 已签发的也当场作废）
 *   ④ 停用后登录被拒，且文案与「密码错」**逐字一致**（防账号枚举）
 *   ⑤ 停用释放 username/email ⇒ 同名同邮箱可重新注册
 *   ⑥ 恢复还原原名；原名已被占用 ⇒ 400 不静默；缺 prev 记录 ⇒ 400 不静默
 *   ⑦ 守卫：不能停用自己 / 不能停用最后一个管理员；DELETE 要求先停用
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tmpDb = path.join(os.tmpdir(), `r4b-disabled-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

let express, bcrypt, getDb, server, base, db
let adminToken
const uniq = () => `t_dis_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
const PASSWORD = 'pw_' + Math.random().toString(36).slice(2, 10)

beforeAll(async () => {
  express = (await import('express')).default
  bcrypt = (await import('bcryptjs')).default
  getDb = (await import('../src/models/database.js')).getDb
  db = getDb() // 触发建库（并种入默认 admin/admin123）
  const authRouter = (await import('../src/routes/auth.js')).default
  const usersRouter = (await import('../src/routes/users.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  app.use('/api/users', usersRouter)
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`

  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })
  adminToken = (await r.json()).token
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ---------------------------------------------------------------- helpers
/** 直接落库造账号（绕开 POST 校验，本测试只聚焦停用语义）。密码固定为 PASSWORD 以便走真实登录。 */
function makeUser(role = 'user') {
  const name = uniq()
  const email = `${name}@t.local`
  const r = db.prepare(
    `INSERT INTO users (username, email, password, role, company, vip_until) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name, email, bcrypt.hashSync(PASSWORD, 4), role, null, null)
  return { id: r.lastInsertRowid, username: name, email }
}

const rowOf = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id)

const login = async (username, password) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const me = async (token) => {
  const res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const patchStatus = async (id, disabled) => {
  const res = await fetch(`${base}/api/users/${id}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled })
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const delUser = async (id) => {
  const res = await fetch(`${base}/api/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

// ---------------------------------------------------------------- ① 源码
describe('源码：三列 ALTER / 鉴权判据 / 新接口 / login 闸门位置 / DELETE gate', () => {
  const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  const dbSrc = strip(fs.readFileSync(path.join(REPO_ROOT, 'backend/src/models/database.js'), 'utf8'))
  const tokenSrc = strip(fs.readFileSync(path.join(REPO_ROOT, 'backend/src/utils/tokenAuth.js'), 'utf8'))
  const usersSrc = strip(fs.readFileSync(path.join(REPO_ROOT, 'backend/src/routes/users.js'), 'utf8'))
  const authSrc = strip(fs.readFileSync(path.join(REPO_ROOT, 'backend/src/routes/auth.js'), 'utf8'))

  it('database.js 三列幂等 ALTER 齐全', () => {
    expect(dbSrc).toMatch(/ALTER TABLE users ADD COLUMN disabled_at/)
    expect(dbSrc).toMatch(/ALTER TABLE users ADD COLUMN disabled_prev_username/)
    expect(dbSrc).toMatch(/ALTER TABLE users ADD COLUMN disabled_prev_email/)
  })

  it('verifyTokenPayload 读 disabled_at 并返回 reason=disabled（且与 token_version 同一次查询）', () => {
    expect(tokenSrc).toMatch(/reason:\s*'disabled'/)
    // ⭐ 必须是同一个 SELECT 里带出来，不能多加一次查询
    expect(tokenSrc).toMatch(/SELECT[\s\S]{0,80}disabled_at[\s\S]{0,80}FROM users WHERE id = \?/)
  })

  it('PATCH /:id/status 存在，且挂 authenticate + requireAdmin', () => {
    expect(usersSrc).toMatch(/router\.patch\(\s*'\/:id\/status'\s*,\s*authenticate\s*,\s*requireAdmin/)
  })

  it('count 口径：停用自己 / 最后一个管理员的守卫排在真正 UPDATE 之前', () => {
    const at = usersSrc.indexOf("router.patch('/:id/status'")
    expect(at, '未找到 PATCH /:id/status').toBeGreaterThan(-1)
    const tail = usersSrc.slice(at)
    expect(tail, '缺「不能停用自己」守卫').toMatch(/req\.user\.id/)
    expect(tail, '缺「最后一个管理员」守卫').toMatch(/SELECT COUNT\(\*\) AS c FROM users WHERE role = 'admin'/)
    const upd = tail.indexOf('UPDATE users')
    const selfGuard = tail.indexOf('req.user.id')
    expect(selfGuard, '守卫必须排在 UPDATE 之前').toBeLessThan(upd)
  })

  it('login 的 disabled 闸门必须排在 signToken **之前**（否则仍会签发 token）', () => {
    const loginAt = authSrc.indexOf("router.post('/login'")
    expect(loginAt).toBeGreaterThan(-1)
    const tail = authSrc.slice(loginAt)
    const gateAt = tail.indexOf('user.disabled_at')
    const signAt = tail.indexOf('signToken(user')
    expect(gateAt, 'login 里未见 user.disabled_at 闸门').toBeGreaterThan(-1)
    expect(signAt, '未找到 signToken').toBeGreaterThan(-1)
    expect(gateAt, 'disabled 闸门必须在 signToken 之前').toBeLessThan(signAt)
  })

  it('DELETE 的「须先停用」gate 排在 DELETE FROM users 之前', () => {
    const delAt = usersSrc.indexOf("router.delete('/:id'")
    expect(delAt).toBeGreaterThan(-1)
    const tail = usersSrc.slice(delAt)
    const gateAt = tail.indexOf('disabled_at')
    const sqlAt = tail.indexOf('DELETE FROM users WHERE id = ?')
    expect(gateAt, 'DELETE 分支未见 disabled_at gate').toBeGreaterThan(-1)
    expect(sqlAt).toBeGreaterThan(-1)
    expect(gateAt, 'gate 必须排在 DELETE 之前').toBeLessThan(sqlAt)
  })
})

// ---------------------------------------------------------------- ② 停用落库
describe('行为：停用一条 UPDATE 把五件事一次做完', () => {
  it('disabled_at / prev 两列 / username / email / token_version 全对', async () => {
    const u = makeUser('user')
    const before = rowOf(u.id)

    const { status, body } = await patchStatus(u.id, true)
    expect(status, `停用应成功：${JSON.stringify(body)}`).toBe(200)

    const after = rowOf(u.id)
    expect(after.disabled_at, 'disabled_at 必须落值').toBeTruthy()
    expect(after.disabled_prev_username).toBe(u.username)
    expect(after.disabled_prev_email).toBe(u.email)
    expect(after.username).toBe(`__disabled_${u.id}`)
    expect(after.email).toBe(`__disabled_${u.id}@disabled.invalid`)
    expect(Number(after.token_version)).toBe(Number(before.token_version || 0) + 1)
  })

  it('幂等边界：重复停用 ⇒ 400；恢复未停用账号 ⇒ 400', async () => {
    const u = makeUser('user')
    await patchStatus(u.id, true)
    const twice = await patchStatus(u.id, true)
    expect(twice.status).toBe(400)

    const v = makeUser('user')
    const bad = await patchStatus(v.id, false)
    expect(bad.status).toBe(400)
  })

  it('disabled 非布尔 ⇒ 400（不接受 "true" 字符串 / 空值）', async () => {
    const u = makeUser('user')
    const res = await fetch(`${base}/api/users/${u.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: 'true' })
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------- ③④ 会话与登录
describe('行为：停用后旧 token 立即失效 + 登录被拒（文案不泄露）', () => {
  it('已签发的 token 当场作废（verifyTokenPayload 判 disabled）', async () => {
    const u = makeUser('user')
    const ok = await login(u.username, PASSWORD)
    expect(ok.status, '前置：应先能正常登录').toBe(200)
    expect((await me(ok.body.token)).status).toBe(200)

    await patchStatus(u.id, true)

    const after = await me(ok.body.token)
    expect(after.status, '停用后旧 token 必须立即 401').toBe(401)
  })

  it('停用后登录被拒，且与「密码错」文案**逐字一致**', async () => {
    const u = makeUser('user')
    await patchStatus(u.id, true)

    const disabled = await login(u.username, PASSWORD)   // 用**正确**密码也不行
    expect(disabled.status).toBe(401)

    const u2 = makeUser('user')
    const wrongPw = await login(u2.username, 'definitely-wrong')
    expect(wrongPw.status).toBe(401)

    expect(disabled.body.message, '停用文案不得与密码错不同（防账号枚举）')
      .toBe(wrongPw.body.message)
  })
})

// ---------------------------------------------------------------- ⑤ 释放
describe('行为：停用释放 username/email（UNIQUE NOT NULL 下唯一可行做法）', () => {
  it('同名 + 同邮箱可重新注册', async () => {
    const u = makeUser('user')
    await patchStatus(u.id, true)

    // 直接落库验证 UNIQUE 不再冲突（走 register 需票据，与本测试焦点无关）
    expect(() => db.prepare(
      `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'user')`
    ).run(u.username, u.email, 'x')).not.toThrow()
  })
})

// ---------------------------------------------------------------- ⑥ 恢复
describe('行为：恢复', () => {
  it('还原原名与原邮箱，且可重新登录', async () => {
    const u = makeUser('user')
    await patchStatus(u.id, true)
    const { status } = await patchStatus(u.id, false)
    expect(status).toBe(200)

    const after = rowOf(u.id)
    expect(after.disabled_at).toBeNull()
    expect(after.username).toBe(u.username)
    expect(after.email).toBe(u.email)
    expect(after.disabled_prev_username).toBeNull()
    expect(after.disabled_prev_email).toBeNull()
    expect((await login(u.username, PASSWORD)).status, '恢复后应能重新登录').toBe(200)
  })

  it('原用户名已被新账号占用 ⇒ 400，且**不静默改名**', async () => {
    const u = makeUser('user')
    await patchStatus(u.id, true)

    db.prepare(`INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'user')`)
      .run(u.username, `${uniq()}@t.local`, 'x')

    const { status, body } = await patchStatus(u.id, false)
    expect(status).toBe(400)
    expect(body.message).toMatch(/用户名|邮箱|占用/)
    expect(rowOf(u.id).disabled_at, '被拒后必须仍是停用态（不能半成功）').toBeTruthy()
  })

  it('缺 prev 记录（历史脏行）⇒ 400 不静默', async () => {
    const u = makeUser('user')
    // 模拟「只有 disabled_at、没有 prev」的脏数据
    db.prepare(`UPDATE users SET disabled_at = ?, username = ?, email = ? WHERE id = ?`)
      .run('2026-01-01T00:00:00.000Z', `__disabled_${u.id}`, `__disabled_${u.id}@disabled.invalid`, u.id)

    const { status } = await patchStatus(u.id, false)
    expect(status, '无法还原时必须报错，不能把账号恢复成一个坏名字').toBe(400)
  })
})

// ---------------------------------------------------------------- ⑦ 守卫
describe('行为：停用守卫 + DELETE 前置', () => {
  it('不能停用自己', async () => {
    const meRow = db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get()
    const { status } = await patchStatus(meRow.id, true)
    expect(status).toBe(400)
    expect(rowOf(meRow.id).disabled_at, '被拒后不得被停用').toBeNull()
  })

  it('不能停用系统中唯一的管理员', async () => {
    // ⚠️ 关键：唯一管理员必须**不是登录者自己**，否则先被「不能停用自己」拦下，
    //    这条用例就变成在验另一条守卫（假绿灯）。
    const sole = makeUser('admin')
    db.prepare(`UPDATE users SET role = 'user' WHERE username = 'admin'`).run()  // 默认 admin 降级
    expect(db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get().c,
      '前置：必须只剩一个管理员').toBe(1)

    const { status, body } = await patchStatus(sole.id, true)
    expect(status, '唯一管理员不可停用').toBe(400)
    expect(body.message, '必须是「最后一个管理员」守卫拦下的').toMatch(/管理员/)
    expect(rowOf(sole.id).disabled_at, '被拒后不得被停用').toBeNull()
  })

  it('DELETE 要求先停用：未停用 ⇒ 400；已停用 ⇒ 200', async () => {
    const u = makeUser('user')
    const blocked = await delUser(u.id)
    expect(blocked.status, '未停用直接删应被拒').toBe(400)
    expect(blocked.body.message).toMatch(/停用|删除|孤儿/)
    expect(rowOf(u.id), '被拒后账号必须仍在').toBeTruthy()

    await patchStatus(u.id, true)
    const ok = await delUser(u.id)
    expect(ok.status, '已停用后允许物理删除').toBe(200)
    expect(rowOf(u.id)).toBeUndefined()
  })
})
