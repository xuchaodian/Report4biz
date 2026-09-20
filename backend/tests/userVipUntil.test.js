/**
 * VIP 到期日（vip_until）写入测试 —— v1.13.158
 *
 * 背景：`POST /api/users`（新建用户）的 INSERT **漏了 vip_until 列**，而 `PUT /api/users/:id`
 * （编辑）会写。于是「新建时直接选 VIP用户/VIP试用」的账号 role 写进去了、vip_until 却是 NULL。
 * 生产实测踩到 3 行（泉膳集团 zensho_bj_01 / zensho_cn_hq / zensho_gz_01，2026-09-16 同一批新建）。
 *
 * 同一个 NULL 在三处的解释互相矛盾，是本缺陷最麻烦的地方：
 *   ① 后端 AI 门禁（routes/ai.js）：`!vip_until || 未过期` ⇒ 视为**有效**
 *   ② 我的账户（MyAccountView.vue）：`if (!u) return true` ⇒ 显示**已过期**（红色，误导客户要续费）
 *   ③ 用户管理列表（UsersView.vue）：要求 vip_until 为真 ⇒ 显示 **—**
 *
 * 派生风险（本测试 F 组专门锁）：`app.js` 的试用降级定时任务是
 *   `UPDATE users SET role='user', vip_until=NULL WHERE role='trial' AND vip_until IS NOT NULL AND vip_until < ?`
 * ⇒ **vip_until 为 NULL 的 trial 永远匹配不到** ⇒ 永久免费 VIP。
 *
 * 被测保证：
 *   A. POST 建号：vip → +365 天；trial → +30 天；user/不传 → NULL
 *   B. 建号返回体与列表接口都带上 vip_until（前端「VIP到期日」列的数据源）
 *   C. PUT 改角色：→vip/trial 写入；→user 清除
 *   D. PUT 未传 role（只改邮箱等）⇒ 既有 VIP 权值不被误动
 *   E. PUT 再次保存 vip（role 未变）⇒ 按「自保存之日起续期 1 年」刷新
 *   F. ⭐ 降级守卫：新建的 trial 其 vip_until 必须非空，且降级 SQL 对过期 trial 生效
 *   G. 全库不变量：不得存在 role ∈ {vip, trial} 而 vip_until 为空的账号
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDb = path.join(os.tmpdir(), `r4b-vipuntil-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let express, getDb, server, base, seq = 0
const uniq = () => `t_vu_${process.pid}_${++seq}`

beforeAll(async () => {
  express = (await import('express')).default
  getDb = (await import('../src/models/database.js')).getDb
  getDb() // 触发建库（并种入默认 admin/admin123）
  const authRouter = (await import('../src/routes/auth.js')).default
  const usersRouter = (await import('../src/routes/users.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  app.use('/api/users', usersRouter)
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ---------------------------------------------------------------- helpers
const iso = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 24 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}
const DAYS_VIP = 365
const DAYS_TRIAL = 30

let adminToken

async function loginAdmin() {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  })
  const d = await r.json()
  return d.token || (d.data || {}).token
}

const H = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const POST = (p, t, body) => fetch(`${base}${p}`, { method: 'POST', headers: H(t), body: JSON.stringify(body ?? {}) })
const PUT = (p, t, body) => fetch(`${base}${p}`, { method: 'PUT', headers: H(t), body: JSON.stringify(body ?? {}) })
const GET = (p, t) => fetch(`${base}${p}`, { headers: H(t) })

async function createUser(role, extra = {}) {
  const name = uniq()
  const body = { username: name, email: `${name}@t.local`, password: 'Pw123456', ...extra }
  if (role !== undefined) body.role = role
  const r = await POST('/api/users', adminToken, body)
  const d = await r.json()
  return { status: r.status, id: d.user && d.user.id, user: d.user }
}

async function listUsers() {
  const r = await GET('/api/users', adminToken)
  const d = await r.json()
  return d.users
}

async function vipUntilOf(id) {
  const users = await listUsers()
  const u = users.find((x) => x.id === id)
  return u ? u.vip_until : undefined
}

beforeAll(async () => {
  adminToken = await loginAdmin()
  if (!adminToken) throw new Error('测试前置失败：默认 admin/admin123 未种入或登录不稳')
})

// ------------------------------------------------------------------ A / B
describe('A. POST 新建用户必须按角色写入 vip_until（本缺陷的修复点）', () => {
  it('A1 新建 role=vip ⇒ vip_until = 今天 + 365 天', async () => {
    const { status, user } = await createUser('vip')
    expect(status).toBe(201)
    expect(user.role).toBe('vip')
    expect(user.vip_until).toBe(iso(DAYS_VIP))
  })

  it('A2 新建 role=trial ⇒ vip_until = 今天 + 30 天', async () => {
    const { status, user } = await createUser('trial')
    expect(status).toBe(201)
    expect(user.role).toBe('trial')
    expect(user.vip_until).toBe(iso(DAYS_TRIAL))
  })

  it('A3 新建 role=user ⇒ vip_until 为空（不得凭空给到期日）', async () => {
    const { status, user } = await createUser('user')
    expect(status).toBe(201)
    expect(user.vip_until).toBeNull()
  })

  it('A4 不传 role（默认普通用户）⇒ vip_until 为空', async () => {
    const { status, user } = await createUser(undefined)
    expect(status).toBe(201)
    expect(user.role).toBe('user')
    expect(user.vip_until).toBeNull()
  })

  it('B1 ★ 列表接口回读的 vip_until 与建号时一致（前端「VIP到期日」列的数据源）', async () => {
    const { id } = await createUser('vip')
    expect(await vipUntilOf(id)).toBe(iso(DAYS_VIP))
    const { id: tid } = await createUser('trial')
    expect(await vipUntilOf(tid)).toBe(iso(DAYS_TRIAL))
  })
})

// --------------------------------------------------------------------- C
describe('C. PUT 改角色：写入 / 清除', () => {
  it('C1 普通用户 → vip：写入 +365 天', async () => {
    const { id } = await createUser('user')
    expect(await vipUntilOf(id)).toBeNull()
    const r = await PUT(`/api/users/${id}`, adminToken, { role: 'vip' })
    expect(r.status).toBe(200)
    expect(await vipUntilOf(id)).toBe(iso(DAYS_VIP))
  })

  it('C2 普通用户 → trial：写入 +30 天', async () => {
    const { id } = await createUser('user')
    await PUT(`/api/users/${id}`, adminToken, { role: 'trial' })
    expect(await vipUntilOf(id)).toBe(iso(DAYS_TRIAL))
  })

  it('C3 vip → 普通用户：到期日被清除（不留残留 VIP 权值）', async () => {
    const { id } = await createUser('vip')
    expect(await vipUntilOf(id)).toBe(iso(DAYS_VIP))
    await PUT(`/api/users/${id}`, adminToken, { role: 'user' })
    expect(await vipUntilOf(id)).toBeNull()
  })
})

// --------------------------------------------------------------------- D / E
describe('D/E. PUT 的权值刷新语义', () => {
  it('D1 未传 role（只改邮箱）⇒ 既有 vip_until 不被误动', async () => {
    const { id } = await createUser('vip')
    const before = await vipUntilOf(id)
    const r = await PUT(`/api/users/${id}`, adminToken, { email: `e_${uniq()}@t.local` })
    expect(r.status).toBe(200)
    expect(await vipUntilOf(id)).toBe(before)
  })

  it('D2 未传 role 改普通用户密码 ⇒ 不凭空造出 vip_until', async () => {
    const { id } = await createUser('user')
    await PUT(`/api/users/${id}`, adminToken, { password: 'Pw654321' })
    expect(await vipUntilOf(id)).toBeNull()
  })

  it('E1 保留 vip 角色再次保存 ⇒ 按「自保存之日起 1 年」续期', async () => {
    const { id } = await createUser('vip')
    const r = await PUT(`/api/users/${id}`, adminToken, { role: 'vip' })
    expect(r.status).toBe(200)
    expect(await vipUntilOf(id)).toBe(iso(DAYS_VIP))
  })
})

// --------------------------------------------------------------------- F
describe('F. ⭐ 降级守卫：trial 必须可被到期降级（否则＝永久免费 VIP）', () => {
  it('F1 新建的 trial，其 vip_until 必须非空 —— 否则 app.js 的降级 SQL 永远匹配不到', async () => {
    const { id } = await createUser('trial')
    const until = await vipUntilOf(id)
    expect(until).toBeTruthy()
    // 降级 SQL 的前提条件（app.js:169 的 WHERE 子句）必须成立
    expect(until).not.toBeNull()
    expect(String(until)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('F2 已过期的 trial 会被降级 SQL 命中并清空（复刻定时任务的语句）', async () => {
    const { id } = await createUser('trial')
    const db = getDb()
    // 直接把到期日改成昨天，模拟"试用已到期"
    db.prepare('UPDATE users SET vip_until = ? WHERE id = ?').run(iso(-1), id)
    const today = new Date().toISOString().slice(0, 10)
    const r = db.prepare(
      "UPDATE users SET role = 'user', vip_until = NULL WHERE role = 'trial' AND vip_until IS NOT NULL AND vip_until < ?"
    ).run(today)
    expect(r.changes).toBeGreaterThanOrEqual(1)
    const users = await listUsers()
    const u = users.find((x) => x.id === id)
    expect(u.role).toBe('user')
    expect(u.vip_until).toBeNull()
  })
})

// --------------------------------------------------------------------- G
describe('G. 全库不变量', () => {
  it('G1 不得存在 role ∈ {vip, trial} 而 vip_until 为空的账号', async () => {
    const users = await listUsers()
    const bad = users.filter((u) => ['vip', 'trial'].includes(u.role) && !u.vip_until)
    expect(bad.map((u) => u.username)).toEqual([])
  })
})
