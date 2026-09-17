/**
 * 登录态撤销测试（v1.13.150 · P1）
 *
 * 背景：JWT 无状态 ⇒ 原先「退出登录」只清客户端 sessionStorage，服务端无任何作废手段，
 * token 在 7 天有效期内始终可用（共享设备 / token 泄露场景的真实风险）。
 *
 * 被测保证（两个正交机制 + 零误伤）：
 *   A. jti 黑名单：登出精确撤销**本设备**；同账号其他设备不受影响；幂等；过期条目自动清理
 *   B. token_version：改密码 / 重置密码 ⇒ 该账号**全部** token 立即失效
 *   C. ⭐ 向上兼容：生产已签发的「无 jti、无 tv」老 token **上线后仍可用**
 *      （老 token 无 tv ⇒ 按 0 比对；users.token_version 默认 0 ⇒ 相等放行）
 *      若这条坏了，本版本一上线就是全员掉线事故 —— D 组用真实手签老 token 端到端验证
 *   D. 对外文案统一（不区分 revoked / stale，避免泄露失效原因）
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，避免触碰 backend/database/webgis.db 真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const tmpDb = path.join(os.tmpdir(), `r4b-tokenauth-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let express, bcrypt, jwt, ta, getDb, server, base, JWT_SECRET
let seq = 0
const uniq = () => `t_ta_${process.pid}_${++seq}`

beforeAll(async () => {
  express = (await import('express')).default
  bcrypt = (await import('bcryptjs')).default
  jwt = (await import('jsonwebtoken')).default
  ta = await import('../src/utils/tokenAuth.js')
  getDb = (await import('../src/models/database.js')).getDb
  getDb() // 触发建库
  JWT_SECRET = (await import('../src/config.js')).JWT_SECRET
  const authRouter = (await import('../src/routes/auth.js')).default
  const usersRouter = (await import('../src/routes/users.js')).default
  const { authenticate } = await import('../src/middleware/auth.js')

  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  app.use('/api/users', usersRouter)
  // 最小受保护路由：只验 authenticate 的结果，隔离业务逻辑干扰
  app.get('/api/protected', authenticate, (req, res) => res.json({ ok: true, uid: req.user.id }))

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  try { fs.rmSync(tmpDb, { force: true }) }
  catch (e) { /* 忽略 */ }
})

// ---------------------------------------------------------------- helpers
function mkUser(role = 'user', password = 'Pw123456') {
  const db = getDb()
  const name = uniq()
  const r = db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)')
    .run(name, `${name}@t.local`, bcrypt.hashSync(password, 10), role)
  return { id: Number(r.lastInsertRowid), username: name, password }
}

async function login(u, password) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u.username, password: password || u.password })
  })
  const d = await r.json()
  return { status: r.status, token: d.token }
}

const H = (token) => (token ? { Authorization: `Bearer ${token}` } : {})

function GET(p, token) {
  return fetch(`${base}${p}`, { headers: H(token) })
}
function POST(p, token, body) {
  return fetch(`${base}${p}`, {
    method: 'POST',
    headers: { ...H(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  })
}
function PUT(p, token, body) {
  return fetch(`${base}${p}`, {
    method: 'PUT',
    headers: { ...H(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  })
}

/** 不带 jti / tv 的「老 token」——模拟本版本上线前生产已签发的存量 token */
function legacyToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

// ============================================================================
// A. 纯函数层
// ============================================================================
describe('A. tokenAuth 纯函数', () => {
  it('A1 signToken 内嵌 jti 与账号版本快照 tv', () => {
    const u = mkUser()
    const t = jwt.decode(ta.signToken(u, 0))
    expect(typeof t.jti).toBe('string')
    expect(t.jti.length).toBeGreaterThan(10)
    expect(t.tv).toBe(0)
    expect(t.id).toBe(u.id)
  })

  it('A2 正常 token 通过校验', () => {
    const u = mkUser()
    const db = getDb()
    const decoded = jwt.decode(ta.signToken(u, ta.currentTokenVersion(db, u.id)))
    expect(ta.verifyTokenPayload(decoded, db)).toEqual({ ok: true })
  })

  it('A3 ★ 老 token（无 jti / 无 tv）在版本 0 时通过 —— 上线不踢人', () => {
    const u = mkUser()
    const db = getDb()
    const decoded = jwt.decode(legacyToken(u))
    expect(decoded.jti).toBeUndefined()
    expect(decoded.tv).toBeUndefined()
    expect(ta.verifyTokenPayload(decoded, db)).toEqual({ ok: true })
  })

  it('A4 ★ 老 token 在账号改密（bump）后被判定 stale', () => {
    const u = mkUser()
    const db = getDb()
    const decoded = jwt.decode(legacyToken(u))
    ta.bumpTokenVersion(db, u.id)
    expect(ta.verifyTokenPayload(decoded, db)).toMatchObject({ ok: false, reason: 'stale' })
  })

  it('A5 revokeToken 后该 jti 被判定 revoked', () => {
    const u = mkUser()
    const db = getDb()
    const decoded = jwt.decode(ta.signToken(u, 0))
    expect(ta.verifyTokenPayload(decoded, db)).toEqual({ ok: true })
    expect(ta.revokeToken(decoded, db)).toBe(true)
    expect(ta.verifyTokenPayload(decoded, db)).toMatchObject({ ok: false, reason: 'revoked' })
  })

  it('A6 无 jti 的老 token 无法单点撤销（返回 false 且不写表）', () => {
    const db = getDb()
    const before = ta.revokedCount(db)
    expect(ta.revokeToken(jwt.decode(legacyToken(mkUser())), db)).toBe(false)
    expect(ta.revokedCount(db)).toBe(before)
  })

  it('A7 用户已被删除 ⇒ user_gone', () => {
    const u = mkUser()
    const db = getDb()
    const decoded = jwt.decode(ta.signToken(u, 0))
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id)
    expect(ta.verifyTokenPayload(decoded, db)).toMatchObject({ ok: false, reason: 'user_gone' })
  })

  it('A8 空 payload / 无 id ⇒ invalid', () => {
    const db = getDb()
    expect(ta.verifyTokenPayload(null, db)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(ta.verifyTokenPayload({ username: 'x' }, db)).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('A9 重复撤销同一 token 幂等（不产生重复行）', () => {
    const u = mkUser()
    const db = getDb()
    const decoded = jwt.decode(ta.signToken(u, 0))
    ta.revokeToken(decoded, db)
    const n = ta.revokedCount(db)
    ta.revokeToken(decoded, db)
    expect(ta.revokedCount(db)).toBe(n)
  })

  it('A10 惰性清理：撤销动作会顺手删掉已过期的黑名单行', () => {
    const db = getDb()
    // 手工塞一条早已过期的条目（模拟 7 天前登出的会话）
    db.prepare('INSERT INTO revoked_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)')
      .run('expired-' + uniq(), null, Date.now() - 86400000)
    const u = mkUser()
    ta.revokeToken(jwt.decode(ta.signToken(u, 0)), db)
    expect(db.prepare(`SELECT COUNT(*) AS c FROM revoked_tokens WHERE jti LIKE 'expired-%'`).get().c).toBe(0)
  })

  it('A11 bumpTokenVersion 只影响目标账号', () => {
    const a = mkUser(); const b = mkUser()
    const db = getDb()
    const ta1 = jwt.decode(ta.signToken(a, 0))
    const tb1 = jwt.decode(ta.signToken(b, 0))
    ta.bumpTokenVersion(db, a.id)
    expect(ta.verifyTokenPayload(ta1, db)).toMatchObject({ ok: false })
    expect(ta.verifyTokenPayload(tb1, db)).toEqual({ ok: true })
  })
})

// ============================================================================
// B. HTTP 端到端：登录 / 登出
// ============================================================================
describe('B. 退出登录（jti 黑名单）', () => {
  it('B1 登录返回的 token 可访问受保护接口', async () => {
    const u = mkUser()
    const { status, token } = await login(u)
    expect(status).toBe(200)
    expect(typeof token).toBe('string')
    expect((await GET('/api/protected', token)).status).toBe(200)
  })

  it('B2 ★ 登出后同一枚 token 立即 401（服务端真的撤销了）', async () => {
    const u = mkUser()
    const { token } = await login(u)
    const r = await POST('/api/auth/logout', token)
    expect(r.status).toBe(200)
    expect((await r.json()).revoked).toBe(true)
    expect((await GET('/api/protected', token)).status).toBe(401)
  })

  it('B3 ★★ 登出只影响本设备：同账号另一枚 token 不受影响（不误伤多设备）', async () => {
    const u = mkUser()
    const a = (await login(u)).token
    const b = (await login(u)).token
    expect(a).not.toBe(b)

    await POST('/api/auth/logout', a)
    expect((await GET('/api/protected', a)).status).toBe(401)   // 登出的那台：下线
    expect((await GET('/api/protected', b)).status).toBe(200)   // 另一台：照常
  })

  it('B4 登出幂等：同一 token 重复登出仍回 200', async () => {
    const u = mkUser()
    const { token } = await login(u)
    expect((await POST('/api/auth/logout', token)).status).toBe(200)
    expect((await POST('/api/auth/logout', token)).status).toBe(200)
  })

  it('B5 ★ 无 token / 伪造 token 调登出 ⇒ 200 幂等，且一次写入都不发生（无攻击放大面）', async () => {
    const db = getDb()
    const before = ta.revokedCount(db)

    const r1 = await POST('/api/auth/logout', null)
    expect(r1.status).toBe(200)
    expect((await r1.json()).revoked).toBe(false)

    const forged = jwt.sign({ id: 1, username: 'x', role: 'admin', jti: 'forged-jti' }, 'wrong-secret', { expiresIn: '1h' })
    const r2 = await POST('/api/auth/logout', forged)
    expect(r2.status).toBe(200)
    expect((await r2.json()).revoked).toBe(false)

    expect(ta.revokedCount(db)).toBe(before)
    expect(db.prepare('SELECT 1 AS x FROM revoked_tokens WHERE jti = ?').get('forged-jti')).toBeUndefined()
  })

  it('B5b 无 jti 的老 token 登出 ⇒ 200，revoked=false（无法单点撤销，但不报错）', async () => {
    const u = mkUser()
    const r = await POST('/api/auth/logout', legacyToken(u))
    expect(r.status).toBe(200)
    expect((await r.json()).revoked).toBe(false)
  })

  it('B6 撤销失败不影响客户端清理：回执含 revoked 字段供前端判断', async () => {
    const u = mkUser()
    const { token } = await login(u)
    expect((await (await POST('/api/auth/logout', token)).json())).toHaveProperty('revoked')
  })
})

// ============================================================================
// C. HTTP 端到端：改密码 / 重置密码 ⇒ 全量失效
// ============================================================================
describe('C. 账号级失效（token_version）', () => {
  it('C1 ★ 用户改自己密码：旧 token 全失效，本人拿到新 token 继续用', async () => {
    const u = mkUser()
    const a = (await login(u)).token   // 本设备
    const b = (await login(u)).token   // 另一台设备

    const r = await PUT('/api/users/me', a, { password: 'NewPw123456' })
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(typeof d.token).toBe('string')   // 本人新 token

    expect((await GET('/api/protected', a)).status).toBe(401)   // 旧的本设备 token 也失效
    expect((await GET('/api/protected', b)).status).toBe(401)   // 另一台设备被踢
    expect((await GET('/api/protected', d.token)).status).toBe(200) // 新 token 可用
  })

  it('C2 只改邮箱不改密码 ⇒ 会话不受影响（不误伤）', async () => {
    const u = mkUser()
    const a = (await login(u)).token
    const r = await PUT('/api/users/me', a, { email: `${uniq()}@t.local` })
    expect(r.status).toBe(200)
    expect((await r.json()).token).toBeUndefined()
    expect((await GET('/api/protected', a)).status).toBe(200)
  })

  it('C3 ★ 管理员重置他人密码 ⇒ 目标用户所有会话立即失效', async () => {
    const admin = mkUser('admin')
    const victim = mkUser()
    const adminTok = (await login(admin)).token
    const vTok1 = (await login(victim)).token
    const vTok2 = (await login(victim)).token

    const r = await POST(`/api/users/${victim.id}/reset-password`, adminTok)
    expect(r.status).toBe(200)

    expect((await GET('/api/protected', vTok1)).status).toBe(401)
    expect((await GET('/api/protected', vTok2)).status).toBe(401)
    // 管理员自己不受影响
    expect((await GET('/api/protected', adminTok)).status).toBe(200)
  })

  it('C4 ★ 忘记密码→重置链接改密 ⇒ 该账号所有 token 作废', async () => {
    const u = mkUser()
    const tok = (await login(u)).token
    const raw = crypto.randomBytes(32).toString('hex')
    getDb().prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
      .run(u.id, sha256(raw), Date.now() + 600000)

    const r = await POST('/api/auth/reset-password', null, { token: raw, password: 'BrandNew123' })
    expect(r.status).toBe(200)
    expect((await GET('/api/protected', tok)).status).toBe(401)

    // 新密码可登录（确认改密真的生效，不是"锁死"）
    const again = await login(u, 'BrandNew123')
    expect(again.status).toBe(200)
    expect((await GET('/api/protected', again.token)).status).toBe(200)
  })

  it('C5 管理员重置后旧密码无法登录、默认密码可登录', async () => {
    const admin = mkUser('admin')
    const victim = mkUser()
    const adminTok = (await login(admin)).token
    await POST(`/api/users/${victim.id}/reset-password`, adminTok)

    expect((await login(victim, victim.password)).status).toBe(401)
    expect((await login(victim, '123456')).status).toBe(200)
  })
})

// ============================================================================
// D. ⭐ 存量老 token 兼容（上线安全网）
// ============================================================================
describe('D. 老 token 兼容性', () => {
  it('D1 ★ 无 jti / 无 tv 的老 token 正常可用（上线瞬间不掉线）', async () => {
    const u = mkUser()
    const old = legacyToken(u)
    expect((await GET('/api/protected', old)).status).toBe(200)
    expect((await GET('/api/auth/me', old)).status).toBe(200)   // /me 不走中间件，单独验一遍
  })

  it('D2 老 token 在账号改密后被踢（旧密码签出的会话不该活着）', async () => {
    const u = mkUser()
    const old = legacyToken(u)
    expect((await GET('/api/protected', old)).status).toBe(200)
    ta.bumpTokenVersion(getDb(), u.id)
    expect((await GET('/api/protected', old)).status).toBe(401)
  })

  it('D3 ★ 撤销/失效的对外文案统一，不泄露原因', async () => {
    const u = mkUser()
    // revoked
    const t1 = (await login(u)).token
    await POST('/api/auth/logout', t1)
    const m1 = (await (await GET('/api/protected', t1)).json()).message
    // stale
    const t2 = (await login(u)).token
    ta.bumpTokenVersion(getDb(), u.id)
    const m2 = (await (await GET('/api/protected', t2)).json()).message

    expect(m1).toBe(ta.SESSION_EXPIRED_MESSAGE)
    expect(m2).toBe(ta.SESSION_EXPIRED_MESSAGE)
  })

  it('D4 无 Authorization 头仍是原来的「请先登录」（行为不回归）', async () => {
    const r = await GET('/api/protected', null)
    expect(r.status).toBe(401)
    expect((await r.json()).message).toBe('请先登录')
  })

  it('D5 伪造签名 token 仍是「Token无效或已过期」', async () => {
    const bad = jwt.sign({ id: 1, username: 'x', role: 'user' }, 'wrong-secret', { expiresIn: '1h' })
    const r = await GET('/api/protected', bad)
    expect(r.status).toBe(401)
    expect((await r.json()).message).toBe('Token无效或已过期')
  })
})
