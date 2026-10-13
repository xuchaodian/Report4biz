/**
 * 「集团 owner」删除守卫 —— v1.13.213
 *
 * 背景：`DELETE /api/users/:id` 在本库**不会级联**（未开 `PRAGMA foreign_keys`，
 *   见 models/database.js 里 org_members 处的自述「不会报错，只会静默脏掉」）。
 *   若被删账号**仍是某「未解散」集团**的 `organizations.owner_user_id`，删除后该行 owner 悬空，
 *   而 `requireOrgOwner` 靠 `req.user.id === org.owner_user_id` 匹配 ⇒ **谁都匹配不上**
 *   ⇒ 该集团**永久无法解散 / 无法增删成员**；成员又受 `org_members.user_id UNIQUE`
 *   （一账号只能属一个集团）约束 ⇒ **再也加不进别的集团**，账号被永久锁死。
 *
 * v1.13.216 契约变更：`DELETE /users/:id` 现在**要求账号已停用**（未停用 ⇒ 400）。
 *   本文件因此统一改为「先停用 → 再删」，顺带把「owner 守卫」验成**与停用状态无关**
 *   （即"停用也不能绕过 owner 守卫"），比改动前更强。
 *
 * 本测试锁三件事：
 *   ① 源码：守卫确实存在于 DELETE /:id 分支（organizations + owner_user_id + dissolved_at IS NULL）；
 *   ② 行为：未解散集团 owner 被拒（400），**且账号仍在**（未被误删）；
 *   ③ 行为：已解散集团 owner / 普通账号 **正常可删**（不误伤 —— 这一点最容易写错）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tmpDb = path.join(os.tmpdir(), `r4b-delsowner-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

let express, getDb, server, base, db
let adminToken
const uniq = () => `t_do_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`

beforeAll(async () => {
  express = (await import('express')).default
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
/** 直接落库造账号（绕开 POST 的校验，让本测试只聚焦删除守卫） */
function makeUser(role = 'user') {
  const name = uniq()
  const r = db.prepare(
    `INSERT INTO users (username, email, password, role, company, vip_until) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name, `${name}@t.local`, 'x', role, null, null)
  return { id: r.lastInsertRowid, username: name }
}

function makeOrg(ownerUserId, orgName) {
  const r = db.prepare(
    `INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`
  ).run(orgName, ownerUserId)
  return r.lastInsertRowid
}

const delUser = async (id) => {
  const res = await fetch(`${base}/api/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

/** v1.13.216：走真实接口停用（DELETE 的前置条件），避免用 UPDATE 造假 */
const disable = async (id) => {
  const res = await fetch(`${base}/api/users/${id}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled: true })
  })
  return res.status
}

const userExists = (id) => !!db.prepare('SELECT id FROM users WHERE id = ?').get(id)

// ---------------------------------------------------------------- ① 源码
describe('源码：DELETE /users/:id 必须含集团 owner 守卫', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'backend/src/routes/users.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

  it('守卫查询存在，且用 dissolved_at IS NULL 排除已解散集团', () => {
    expect(src).toMatch(/FROM organizations WHERE owner_user_id = \? AND dissolved_at IS NULL/)
  })

  it('守卫在真正 DELETE 之前返回 400', () => {
    const guardAt = src.indexOf('FROM organizations WHERE owner_user_id')
    const delAt = src.indexOf("DELETE FROM users WHERE id = ?")
    expect(guardAt, '未找到 owner 守卫查询').toBeGreaterThan(-1)
    expect(delAt, '未找到删除语句').toBeGreaterThan(-1)
    expect(guardAt, '守卫必须排在 DELETE 之前').toBeLessThan(delAt)
    expect(src).toMatch(/ownedOrg[\s\S]{0,400}status\(400\)/)
  })
})

// ---------------------------------------------------------------- ② ③ 行为
describe('行为：未解散集团 owner 不可删；已解散 / 普通账号可删', () => {
  it('未解散集团 owner ⇒ 400，且账号仍存在（未被误删）', async () => {
    const owner = makeUser('user')
    const orgName = `集团-${uniq()}`
    makeOrg(owner.id, orgName)
    await disable(owner.id)   // 即便已停用，owner 守卫仍必须挡住

    const { status, body } = await delUser(owner.id)
    expect(status, `应被拒：${JSON.stringify(body)}`).toBe(400)
    expect(body.message).toContain(orgName)
    expect(body.message).toContain('总部账号')
    expect(userExists(owner.id), '被拒后账号必须仍在（守卫不能变成误删）').toBe(true)
  })

  it('集团已解散（立碑）⇒ 该 owner 可删（不误伤）', async () => {
    const owner = makeUser('user')
    const orgId = makeOrg(owner.id, `集团-${uniq()}`)
    db.prepare(`UPDATE organizations SET dissolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(orgId)
    await disable(owner.id)

    const { status } = await delUser(owner.id)
    expect(status).toBe(200)
    expect(userExists(owner.id)).toBe(false)
  })

  it('普通账号（不属于任何集团）⇒ 可删', async () => {
    const u = makeUser('user')
    await disable(u.id)
    const { status } = await delUser(u.id)
    expect(status).toBe(200)
    expect(userExists(u.id)).toBe(false)
  })

  it('集团「成员」（非 owner）⇒ 可删（守卫只管 owner）', async () => {
    const owner = makeUser('user')
    const member = makeUser('user')
    const orgId = makeOrg(owner.id, `集团-${uniq()}`)
    db.prepare(`INSERT INTO org_members (org_id, user_id) VALUES (?, ?)`).run(orgId, member.id)

    await disable(member.id)
    const { status } = await delUser(member.id)
    expect(status, '成员不在守卫范围内（owner_user_id 不是他）').toBe(200)
    expect(userExists(member.id)).toBe(false)
  })
})
