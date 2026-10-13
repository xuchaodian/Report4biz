/**
 * 联通配额「采购申请单」闭环 —— v1.13.218（设计 §4.4~§4.6）
 *
 * 蓝本：routes/vipApplications.js（6 端点 ＋ 部分唯一索引 ＋ 库内角色为准）
 *       utils/mailer.js（内部通知邮件）＋ config.js（QUOTA_NOTIFY_EMAIL）
 *
 * 🔴 本文件锁定的**关键验收点**：
 *   ① accept 只有**一处写**（申请单行），⛔ **绝不写 `users.quota`**（决策 3：仅受理，充值另行动作）；
 *   ② 内部通知邮件必须「**先回响应、后发信**」＋ `.catch()` 兜住 ⇒ 发信失败/未配置都不能让用户提交变 500；
 *   ③ 邮件正文 ⛔ 不含单价/金额（决策 4：成本 ≠ 售价）；
 *   ④ 已有 pending 再提交 ⇒ 400（存储层部分唯一索引 + 路由友好提示双保险）；
 *   ⑤ 非管理员访问管理端端点 ⇒ 403。
 *
 * ⚠️ 两条项目铁律（来自 208/211 教训）：
 *   - **只做字面量匹配＝假绿灯** ⇒ 源码断言必须落在**使用点/切片**上，且配**切片自检**（anchor 必须命中），
 *     否则正则被删代码后照样"通过"（211：裸 `/\*[\s\S]*?\*\//` 被字符串里的 `/*` 骗到 ⇒ 静默吃掉代码、报假红）。
 *   - 行为断言必须真跑 HTTP，而不是只读源码。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------- 邮件模块替身
// 用替身而非真 SMTP：既避免真连（socketTimeout 30s 会拖死用例），又能分别模拟
// 「邮件未配置」与「发信失败」两种负向场景。
const { mailMock } = vi.hoisted(() => ({
  mailMock: {
    isMailEnabled: vi.fn(() => false),
    sendQuotaPurchaseNotice: vi.fn(() => Promise.resolve({ messageId: 'x' })),
    sendPasswordResetMail: vi.fn(() => Promise.resolve({ messageId: 'x' })),
    verifyMailer: vi.fn(() => Promise.resolve(true))
  }
}))
vi.mock('../src/utils/mailer.js', () => mailMock)

const tmpDb = path.join(os.tmpdir(), `r4b-quotareq-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const B = (...p) => path.join(REPO_ROOT, 'backend', ...p)
const read = (rel) => fs.readFileSync(B(rel), 'utf-8')

/** 去注释。⚠️ 只用于"该文件里有没有某锚点"，不做切片自检。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/**
 * 取 [from, to) 之间的切片并做**自检**：
 *   - from 必须在；to 若给了也必须在（否则切片会一路吃到文件尾 —— 静默放大，报假绿）
 *   - 结果长度必须 > 0
 * 任一不满足直接抛 ⇒ 让"锚点被改动"变成**响亮的失败**，而不是悄悄通过。
 */
function slice(src, from, to) {
  const i = src.indexOf(from)
  if (i === -1) throw new Error(`切片起点未命中（源码可能已改）: ${from}`)
  const j = to ? src.indexOf(to, i + from.length) : -1
  if (to && j === -1) throw new Error(`切片终点未命中: ${to}`)
  const out = to ? src.slice(i, j) : src.slice(i)
  if (!out.trim()) throw new Error(`切片为空: ${from}`)
  return out
}

let express, bcrypt, getDb, server, base, db
let adminToken

const uniq = () => `t_qr_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
const PASSWORD = 'pw_' + Math.random().toString(36).slice(2, 10)

// ================================================================ ① 源码守卫
describe('源码：建表/配置/邮件/路由/挂载', () => {
  it('database.js 幂等建 quota_purchase_requests ＋ 3 个索引（含 pending 部分唯一索引）', () => {
    const s = read('src/models/database.js')
    expect(s).toContain('CREATE TABLE IF NOT EXISTS quota_purchase_requests')
    expect(s).toMatch(/CREATE INDEX IF NOT EXISTS \w+ ON quota_purchase_requests\(status, created_at/)
    expect(s).toMatch(/CREATE INDEX IF NOT EXISTS \w+ ON quota_purchase_requests\(user_id, status\)/)
    // 🔴 存储层兜底防重复提交
    expect(s).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON quota_purchase_requests\(user_id\)\s+WHERE status = 'pending'/
    )
  })

  it('config.js 有 QUOTA_NOTIFY_EMAIL 且进入 export 列表', () => {
    const s = strip(read('src/config.js'))
    expect(s).toContain('QUOTA_NOTIFY_EMAIL')
    // 使用点断言：必须出现在 export { ... } 里（只声明不导出＝假绿灯）
    const exp = slice(s, 'export {', '}')
    expect(exp).toContain('QUOTA_NOTIFY_EMAIL')
  })

  it('mailer.js 导出 sendQuotaPurchaseNotice，且正文不含单价/金额', () => {
    const s = read('src/utils/mailer.js')
    expect(s).toContain('export async function sendQuotaPurchaseNotice')
    const body = slice(s, 'export async function sendQuotaPurchaseNotice')
    // 决策 4：邮件里 ⛔ 不落价
    expect(body).not.toMatch(/单价|金额|¥|￥|报价/)
    expect(body).toContain('escapeHtml')
    expect(body).toContain('subject')
  })

  it('quotaRequests.js 有 6 个端点', () => {
    const s = read('src/routes/quotaRequests.js')
    for (const r of [
      "router.post('/'",
      "router.get('/mine'",
      "router.get('/pending-count'",
      "router.get('/'",
      "router.post('/:id/accept'",
      "router.post('/:id/reject'"
    ]) {
      expect(s).toContain(r)
    }
  })

  it('🔴 accept 切片内绝不写 users（决策 3 的核心）', () => {
    const s = read('src/routes/quotaRequests.js')
    // 切片自检：起点/终点都在
    const seg = slice(s, "router.post('/:id/accept'", "router.post('/:id/reject'")
    expect(seg.length).toBeGreaterThan(200) // 自检：确实切到了一段实现体
    expect(seg).toMatch(/UPDATE\s+quota_purchase_requests/i) // 自检：它确实在改申请单
    expect(seg).not.toMatch(/UPDATE\s+users\b/i)
    expect(seg).not.toMatch(/users\s+SET\s+quota/i)
  })

  it('🔴 通知邮件「先回响应、后发信」：调用排在 INSERT 之后，且带 .catch 且不 await', () => {
    const s = read('src/routes/quotaRequests.js')
    const seg = slice(s, "router.post('/'", "router.get('/mine'")
    const iIns = seg.indexOf('INSERT INTO quota_purchase_requests')
    const iSend = seg.indexOf('sendQuotaPurchaseNotice')
    const iRes = seg.search(/res\.status\(201\)/)
    expect(iIns).toBeGreaterThan(-1)   // 自检
    expect(iSend).toBeGreaterThan(-1)  // 自检
    expect(iRes).toBeGreaterThan(-1)   // 自检
    expect(iRes).toBeLessThan(iSend)   // 先回响应
    expect(iIns).toBeLessThan(iSend)   // 后发信（外部 IO 绝不进事务前的写路径）
    // 不 await + 必 .catch
    expect(seg).not.toMatch(/await\s+sendQuotaPurchaseNotice/)
    const after = seg.slice(iSend, iSend + 400)
    expect(after).toContain('.catch(')
    // 未配置时要能走 else 告警分支（不得因为未配置而 500）
    expect(seg).toContain('isMailEnabled()')
  })

  it('app.js 挂在独立前缀 /api/quota-requests', () => {
    const s = read('src/app.js')
    expect(s).toContain("'/api/quota-requests'")
  })
})

// ================================================================ ② 端点行为
// ⚠️ beforeAll 必须收在**本 describe 内**：若放文件顶层，它一旦抛错会把
//   上面的「源码守卫」用例一起判成 skipped ⇒ 看不到源码断言自己是不是真在断言。
describe('端点行为（真跑 HTTP）', () => {
  beforeAll(async () => {
    express = (await import('express')).default
    bcrypt = (await import('bcryptjs')).default
    getDb = (await import('../src/models/database.js')).getDb
    db = getDb() // 触发建库（含 default admin/admin123）
    const authRouter = (await import('../src/routes/auth.js')).default
    const quotaRouter = (await import('../src/routes/quotaRequests.js')).default

    const app = express()
    app.use(express.json())
    app.use('/api/auth', authRouter)
    app.use('/api/quota-requests', quotaRouter)
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
    if (server) await new Promise((resolve) => server.close(resolve))
    try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
  })

/** 直接落库造账号（绕开注册校验；密码固定以便走真实登录） */
function makeUser(role = 'user', quota = 100) {
  const name = uniq()
  const email = `${name}@t.local`
  const r = db.prepare(
    `INSERT INTO users (username, email, password, role, company, quota) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name, email, bcrypt.hashSync(PASSWORD, 4), role, '测试公司', quota)
  return { id: r.lastInsertRowid, username: name, email }
}

const login = async (username, password = PASSWORD) => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, token: body.token, body }
}

const post = (token, body, p = '/') =>
  fetch(`${base}/api/quota-requests${p}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))

const get = (token, p = '/') =>
  fetch(`${base}/api/quota-requests${p}`, { headers: { Authorization: `Bearer ${token}` } })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))

const validBody = (over = {}) => ({
  company: '测试公司',
  department: '拓展部',
  contact_name: '张三',
  contact_email: 'zhangsan@t.local',
  contact_phone: '13800000000',
  want_amount: 100,
  purpose: '门店评估用',
  expect_date: '2026-11-01',
  ...over
})

const reqRow = (id) => db.prepare('SELECT * FROM quota_purchase_requests WHERE id = ?').get(id)

describe('提交（POST /）', () => {
  it('缺必填 ⇒ 400 并逐项点名', async () => {
    const u = makeUser()
    const { token } = await login(u.username)
    const r = await post(token, { company: 'X' })
    expect(r.status).toBe(400)
    expect(r.body.message).toMatch(/所在部门|联系人|电子邮箱|联系电话|期望/)
  })

  it('邮箱/电话格式错 ⇒ 400', async () => {
    const u = makeUser()
    const { token } = await login(u.username)
    expect((await post(token, validBody({ contact_email: 'nope' }))).status).toBe(400)
    expect((await post(token, validBody({ contact_phone: '1' }))).status).toBe(400)
  })

  it('want_amount 非正整数 ⇒ 400', async () => {
    const u = makeUser()
    const { token } = await login(u.username)
    expect((await post(token, validBody({ want_amount: 0 }))).status).toBe(400)
    expect((await post(token, validBody({ want_amount: -5 }))).status).toBe(400)
    expect((await post(token, validBody({ want_amount: 1.5 }))).status).toBe(400)
  })

  it('正常提交 ⇒ 201 落库（status=pending）；GET /mine 回显', async () => {
    const u = makeUser()
    const { token } = await login(u.username)
    const r = await post(token, validBody())
    expect(r.status).toBe(201)
    const row = reqRow(r.body.request.id)
    expect(row.status).toBe('pending')
    expect(row.user_id).toBe(u.id)
    expect(row.want_amount).toBe(100)
    expect(row.username).toBe(u.username)

    const mine = await get(token, '/mine')
    expect(mine.status).toBe(200)
    expect(mine.body.request.status).toBe('pending')
  })

  it('🔴 已有 pending 再提交 ⇒ 400，且不产生第二行', async () => {
    const u = makeUser()
    const { token } = await login(u.username)
    expect((await post(token, validBody())).status).toBe(201)
    const again = await post(token, validBody())
    expect(again.status).toBe(400)
    const cnt = db.prepare(
      `SELECT COUNT(*) AS c FROM quota_purchase_requests WHERE user_id = ?`
    ).get(u.id).c
    expect(cnt).toBe(1)
  })
})

describe('邮件通道（负向）', () => {
  it('邮件未配置 ⇒ 仍 201 落库，不返回 500', async () => {
    mailMock.isMailEnabled.mockReturnValue(false)
    mailMock.sendQuotaPurchaseNotice.mockClear()
    const u = makeUser()
    const { token } = await login(u.username)
    const r = await post(token, validBody())
    expect(r.status).toBe(201)
    expect(reqRow(r.body.request.id)).toBeTruthy()
    expect(mailMock.sendQuotaPurchaseNotice).not.toHaveBeenCalled()
  })

  it('🔴 发信失败 ⇒ 接口仍 201（.catch 兜住，先回响应后发信）', async () => {
    mailMock.isMailEnabled.mockReturnValue(true)
    mailMock.sendQuotaPurchaseNotice.mockImplementation(() => Promise.reject(new Error('SMTP BOOM')))
    const u = makeUser()
    const { token } = await login(u.username)
    const r = await post(token, validBody())
    expect(r.status).toBe(201)
    expect(reqRow(r.body.request.id)).toBeTruthy()
    // 给未捕获的 reject 一个落定机会，确认没有把异常冒到请求链上
    await new Promise((res) => setTimeout(res, 20))
    mailMock.isMailEnabled.mockReturnValue(false)
  })

  it('邮件已配置且成功 ⇒ 201，且以 QUOTA_NOTIFY_EMAIL 为收件人', async () => {
    mailMock.isMailEnabled.mockReturnValue(true)
    mailMock.sendQuotaPurchaseNotice.mockImplementation(() => Promise.resolve({ messageId: 'ok' }))
    const u = makeUser()
    const { token } = await login(u.username)
    const r = await post(token, validBody())
    expect(r.status).toBe(201)
    await new Promise((res) => setTimeout(res, 20))
    const call = mailMock.sendQuotaPurchaseNotice.mock.calls.at(-1)?.[0]
    expect(call?.to).toBe('jyo@youshi-tech.com')
    expect(call?.wantAmount).toBe(100)
    // ⛔ 不传价：payload 里不得出现任何价格键
    expect(Object.keys(call || {})).not.toContain('price')
    expect(Object.keys(call || {})).not.toContain('amount')
    mailMock.isMailEnabled.mockReturnValue(false)
  })
})

describe('管理端（权限 ＋ 受理语义）', () => {
  it('非管理员访问管理端端点 ⇒ 403', async () => {
    const u = makeUser()
    const { token } = await login(u.username)
    expect((await get(token, '/pending-count')).status).toBe(403)
    expect((await get(token, '/')).status).toBe(403)
    expect((await post(token, {}, '/1/accept')).status).toBe(403)
    expect((await post(token, {}, '/1/reject')).status).toBe(403)
  })

  it('管理员可读列表与待处理计数', async () => {
    const u = makeUser()
    const { token } = await login(u.username)
    await post(token, validBody())
    const cnt = await get(adminToken, '/pending-count')
    expect(cnt.status).toBe(200)
    expect(cnt.body.pendingCount).toBeGreaterThan(0)
    const list = await get(adminToken, '/?status=pending')
    expect(list.status).toBe(200)
    expect(Array.isArray(list.body.requests)).toBe(true)
    expect(list.body.pendingCount).toBeGreaterThan(0)
  })

  it('🔴🔴 accept 后 users.quota 必须**未变**（决策 3：仅受理、充值另行）', async () => {
    const u = makeUser('user', 777)
    const { token } = await login(u.username)
    const created = await post(token, validBody({ want_amount: 50 }))
    const before = db.prepare('SELECT quota FROM users WHERE id = ?').get(u.id).quota

    const acc = await post(adminToken, {}, `/${created.body.request.id}/accept`)
    expect(acc.status).toBe(200)

    const after = db.prepare('SELECT quota FROM users WHERE id = ?').get(u.id).quota
    expect(after).toBe(before)                    // 🔴 核心
    expect(reqRow(created.body.request.id).status).toBe('accepted')
    expect(reqRow(created.body.request.id).reviewed_by_name).toBeTruthy()

    // 受理后用户侧状态可回显
    const mine = await get(token, '/mine')
    expect(mine.body.request.status).toBe('accepted')
  })

  it('accept 已处理的单 ⇒ 400（不静默重复受理）', async () => {
    const u = makeUser()
    const { token } = await login(u.username)
    const created = await post(token, validBody())
    expect((await post(adminToken, {}, `/${created.body.request.id}/accept`)).status).toBe(200)
    expect((await post(adminToken, {}, `/${created.body.request.id}/accept`)).status).toBe(400)
  })

  it('reject 带理由 ⇒ 用户侧能看到理由，且可重新申请', async () => {
    const u = makeUser()
    const { token } = await login(u.username)
    const created = await post(token, validBody())
    const rej = await post(adminToken, { review_note: '数量请走年度合同' }, `/${created.body.request.id}/reject`)
    expect(rej.status).toBe(200)
    const mine = await get(token, '/mine')
    expect(mine.body.request.status).toBe('rejected')
    expect(mine.body.request.review_note).toContain('年度合同')
    // 驳回后重新申请不再被 pending 唯一索引挡住
    expect((await post(token, validBody())).status).toBe(201)
  })

  it('不存在的单 ⇒ 404', async () => {
    expect((await post(adminToken, {}, '/99999999/accept')).status).toBe(404)
    expect((await post(adminToken, {}, '/99999999/reject')).status).toBe(404)
  })
})
})
