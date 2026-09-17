/**
 * 注册防护测试（v1.13.149 · P0 加固）
 *
 * 背景：`POST /api/auth/register` 原先只有「字段非空 + 密码≥6 + 重名」三道校验，
 * 无 IP 限流 / 无验证码 / 无蜜罐 / 无提交耗时检测，且全项目无 rate-limit 依赖
 * ⇒ 可被脚本批量注册（每次注册成本 ≈ 一次 bcrypt）。
 *
 * 被测保证（三道闸门 + 零误伤）：
 *   A. 票据（HMAC 无状态）：签发/校验闭环；missing / malformed / bad_sig / too_fast / expired
 *      五种拒绝路径各自可判；**篡改签名必须被拒**（timingSafeEqual 生效）
 *   B. IP 限流：窗口内第 REG_MAX_PER_IP+1 次起返回 429（且带 Retry-After）
 *   C. 蜜罐：命中 ⇒ **201 假成功**且**不落库**（不给攻击者「被识别」的反馈）
 *   D. 正常用户路径：拿票 → 停留 ≥REG_MIN_FILL_MS → 201 真成功且落库
 *   E. ⭐ 零误伤：正常路径全绿，且**票据校验在字段校验之前**不影响原有错误文案
 *      （缺字段仍回「请填写所有必填字段」、密码短仍回「密码至少6个字符」）
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，避免触碰 backend/database/webgis.db 真实库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDb = path.join(os.tmpdir(), `r4b-regguard-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let guard, rate, getDb, server, base

beforeAll(async () => {
  const express = (await import('express')).default
  guard = await import('../src/utils/registerGuard.js')
  rate = await import('../src/utils/rateLimit.js')
  getDb = (await import('../src/models/database.js')).getDb
  getDb() // 触发建库
  const authRouter = (await import('../src/routes/auth.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// 每个用例用干净的限流桶，避免相互串扰
beforeEach(() => rate.resetRateLimits())

let seq = 0
const uniq = () => `t_reg_${process.pid}_${++seq}`

function validTicket(ageMs = 3000) {
  return guard.issueRegisterTicket(Date.now() - ageMs)
}

/** 发一次注册请求（默认 IP 独立于其他用例） */
function postRegister(body, ip = '10.9.9.9') {
  return fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify(body)
  })
}

function userExists(username) {
  return !!getDb().prepare('SELECT id FROM users WHERE username = ?').get(username)
}

// ============================================================================
// A. 票据纯函数
// ============================================================================
describe('A. 表单票据（HMAC 无状态）', () => {
  it('A1 签发的票据在停留足够后可校验通过', () => {
    const t = guard.issueRegisterTicket(Date.now() - 3000)
    const r = guard.verifyRegisterTicket(t)
    expect(r.ok).toBe(true)
    expect(r.age).toBeGreaterThanOrEqual(guard.REG_MIN_FILL_MS)
  })

  it('A2 缺失 / 空串 ⇒ reason=missing', () => {
    expect(guard.verifyRegisterTicket(undefined)).toMatchObject({ ok: false, reason: 'missing' })
    expect(guard.verifyRegisterTicket('')).toMatchObject({ ok: false, reason: 'missing' })
  })

  it('A3 格式错乱 ⇒ reason=malformed', () => {
    for (const bad of ['abc', 'no-dot', '.abc', '123.', 'x.y', `${Date.now()}.short`]) {
      expect(guard.verifyRegisterTicket(bad)).toMatchObject({ ok: false, reason: 'malformed' })
    }
  })

  it('A4 ★ 篡改签名 ⇒ reason=bad_sig（timingSafeEqual 生效）', () => {
    const t = guard.issueRegisterTicket(Date.now() - 3000)
    const [ts, sig] = t.split('.')
    const flipped = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0')
    expect(guard.verifyRegisterTicket(`${ts}.${flipped}`)).toMatchObject({ ok: false, reason: 'bad_sig' })
  })

  it('A5 ★ 篡改时间戳 ⇒ reason=bad_sig（签名与 ts 绑定）', () => {
    const t = guard.issueRegisterTicket(Date.now() - 3000)
    const sig = t.split('.')[1]
    const forgedTs = Number(t.split('.')[0]) - 999999
    expect(guard.verifyRegisterTicket(`${forgedTs}.${sig}`)).toMatchObject({ ok: false, reason: 'bad_sig' })
  })

  it('A6 停留过短 ⇒ reason=too_fast', () => {
    const t = guard.issueRegisterTicket(Date.now())
    expect(guard.verifyRegisterTicket(t)).toMatchObject({ ok: false, reason: 'too_fast' })
  })

  it('A7 超过 TTL ⇒ reason=expired', () => {
    const t = guard.issueRegisterTicket(Date.now() - guard.REG_TICKET_TTL_MS - 1000)
    expect(guard.verifyRegisterTicket(t)).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('A8 每个拒绝路径都有对外文案（且 missing/malformed/bad_sig 统一措辞，不泄露线索）', () => {
    const m = guard.REG_TICKET_MESSAGES
    expect(m.missing).toBe(m.malformed)
    expect(m.malformed).toBe(m.bad_sig)
    for (const k of ['missing', 'malformed', 'bad_sig', 'too_fast', 'expired']) {
      expect(typeof m[k]).toBe('string')
      expect(m[k].length).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// B. HTTP 端到端
// ============================================================================
describe('B. 领取票据接口', () => {
  it('B1 GET /register-ticket 返回可用票据 + minFillMs', async () => {
    const r = await fetch(`${base}/api/auth/register-ticket`)
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toContain('no-store')
    const d = await r.json()
    expect(typeof d.ticket).toBe('string')
    expect(d.ticket.split('.').length).toBe(2)
    expect(d.minFillMs).toBe(guard.REG_MIN_FILL_MS)
    // 刚签发的票据必然「太快」，需等前端的 1.5s 闸门放行
    expect(guard.verifyRegisterTicket(d.ticket)).toMatchObject({ ok: false, reason: 'too_fast' })
  })

  it('B2 票据是一次性的时间凭证：等够时间后即通过', async () => {
    const r = await fetch(`${base}/api/auth/register-ticket`)
    const d = await r.json()
    // 用「同一票据 + 时间推进」模拟前端等待完成（避免真 sleep 1.5s）
    const ts = Number(d.ticket.split('.')[0])
    expect(guard.verifyRegisterTicket(d.ticket, ts + guard.REG_MIN_FILL_MS)).toMatchObject({ ok: true })
  })
})

describe('C. 正常用户路径（零摩擦）', () => {
  it('C1 拿票 → 停留足够 → 201 真成功且落库', async () => {
    const name = uniq()
    const r = await postRegister({ username: name, email: `${name}@t.local`, password: 'ZhenXia1984', ticket: validTicket() })
    expect(r.status).toBe(201)
    const d = await r.json()
    expect(d.message).toBe('注册成功')
    expect(typeof d.user.id).toBe('number')
    expect(userExists(name)).toBe(true)
  })

  it('C2 原有校验文案不变（票据通过后仍按原顺序报错）', async () => {
    const r1 = await postRegister({ username: '', email: '', password: '', ticket: validTicket() })
    expect(r1.status).toBe(400)
    expect((await r1.json()).message).toBe('请填写所有必填字段')

    const name = uniq()
    const r2 = await postRegister({ username: name, email: `${name}@t.local`, password: '123', ticket: validTicket() })
    expect(r2.status).toBe(400)
    expect((await r2.json()).message).toBe('密码至少6个字符')

    const r3 = await postRegister({ username: name, email: `${name}@t.local`, password: 'ZhenXia1984', ticket: validTicket() })
    expect(r3.status).toBe(201)
    const r4 = await postRegister({ username: name, email: `${name}@t.local`, password: 'ZhenXia1984', ticket: validTicket() })
    expect(r4.status).toBe(400)
    expect((await r4.json()).message).toBe('用户名或邮箱已存在')
  })
})

describe('D. 闸门②③：票据与蜜罐', () => {
  it('D1 无票（最简脚本直接 POST）⇒ 400 ticket_missing，且不落库', async () => {
    const name = uniq()
    const r = await postRegister({ username: name, email: `${name}@t.local`, password: 'ZhenXia1984' })
    expect(r.status).toBe(400)
    const d = await r.json()
    expect(d.code).toBe('ticket_missing')
    expect(d.message).toBe('请求无效，请刷新页面后重试')
    expect(userExists(name)).toBe(false)
  })

  it('D2 伪造签名 ⇒ 400 ticket_bad_sig，且不落库', async () => {
    const name = uniq()
    const t = validTicket()
    const bad = `${t.split('.')[0]}.${'0'.repeat(32)}`
    const r = await postRegister({ username: name, email: `${name}@t.local`, password: 'ZhenXia1984', ticket: bad })
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('ticket_bad_sig')
    expect(userExists(name)).toBe(false)
  })

  it('D3 停留过短（机器速度提交）⇒ 400 ticket_too_fast，且不落库', async () => {
    const name = uniq()
    const r = await postRegister({
      username: name, email: `${name}@t.local`, password: 'ZhenXia1984',
      ticket: guard.issueRegisterTicket(Date.now())
    })
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('ticket_too_fast')
    expect(userExists(name)).toBe(false)
  })

  it('D4 票据过期 ⇒ 400 ticket_expired，且不落库', async () => {
    const name = uniq()
    const r = await postRegister({
      username: name, email: `${name}@t.local`, password: 'ZhenXia1984',
      ticket: guard.issueRegisterTicket(Date.now() - guard.REG_TICKET_TTL_MS - 60000)
    })
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('ticket_expired')
    expect(userExists(name)).toBe(false)
  })

  it('D5 ★ 蜜罐命中 ⇒ 201 假成功（与真回执同形）但**不落库**', async () => {
    const name = uniq()
    const r = await postRegister({
      username: name, email: `${name}@t.local`, password: 'ZhenXia1984',
      ticket: validTicket(), [guard.REG_HONEYPOT_FIELD]: 'http://spam.example'
    })
    expect(r.status).toBe(201)
    const d = await r.json()
    expect(d.message).toBe('注册成功')          // 回执与真成功无法区分
    expect(d.user).toMatchObject({ username: name, role: 'user' })
    expect(userExists(name)).toBe(false)         // ⭐ 关键：没有真的建号
  })

  it('D6 蜜罐为空串/空白 ⇒ 视为未命中，正常走完', async () => {
    const name = uniq()
    const r = await postRegister({
      username: name, email: `${name}@t.local`, password: 'ZhenXia1984',
      ticket: validTicket(), [guard.REG_HONEYPOT_FIELD]: '   '
    })
    expect(r.status).toBe(201)
    expect(userExists(name)).toBe(true)
  })

  it('D7 ★ 蜜罐位于全部正常校验之后 ⇒ 用「已存在的用户名」也探测不出蜜罐', async () => {
    const name = uniq()
    const r0 = await postRegister({ username: name, email: `${name}@t.local`, password: 'ZhenXia1984', ticket: validTicket() })
    expect(r0.status).toBe(201)

    // 同样的用户名 + 蜜罐：回执必须与真注册一致（400 已存在），而不是 201
    const r = await postRegister({
      username: name, email: `${name}@t.local`, password: 'ZhenXia1984',
      ticket: validTicket(), [guard.REG_HONEYPOT_FIELD]: 'probe'
    })
    expect(r.status).toBe(400)
    expect((await r.json()).message).toBe('用户名或邮箱已存在')
  })

  it('D8 ★ 蜜罐 + 畸形字段 ⇒ 回执与真注册逐字一致（400 必填）', async () => {
    const r = await postRegister({
      username: '', email: '', password: '',
      ticket: validTicket(), [guard.REG_HONEYPOT_FIELD]: 'probe'
    })
    expect(r.status).toBe(400)
    expect((await r.json()).message).toBe('请填写所有必填字段')

    const name = uniq()
    const r2 = await postRegister({
      username: name, email: `${name}@t.local`, password: '123',
      ticket: validTicket(), [guard.REG_HONEYPOT_FIELD]: 'probe'
    })
    expect(r2.status).toBe(400)
    expect((await r2.json()).message).toBe('密码至少6个字符')
  })

  it('D9 ★ 蜜罐回执 id 与真实自增同量级、递增且不重复（无可识别破绽）', async () => {
    const db = getDb()
    const before = Number(db.prepare('SELECT MAX(id) AS m FROM users').get()?.m || 0)

    const ids = []
    for (let i = 0; i < 3; i++) {
      const name = uniq()
      const r = await postRegister({
        username: name, email: `${name}@t.local`, password: 'ZhenXia1984',
        ticket: validTicket(), [guard.REG_HONEYPOT_FIELD]: 'probe'
      })
      expect(r.status).toBe(201)
      ids.push((await r.json()).user.id)
      expect(userExists(name)).toBe(false) // 始终不落库
    }

    // 与真实自增同量级（既不是 6 位数「假 id」，也不会离 maxId 太远）
    for (const id of ids) {
      expect(id).toBeGreaterThan(before)
      expect(id).toBeLessThan(before + 20)
    }
    // 严格递增、互不重复（真自增绝不会重复）
    expect(ids[1]).toBeGreaterThan(ids[0])
    expect(ids[2]).toBeGreaterThan(ids[1])
    expect(new Set(ids).size).toBe(3)
  })

  it('D10 蜜罐命中不消耗真用户 id（下一个真注册仍拿到 maxId+1）', async () => {
    const name = uniq()
    await postRegister({
      username: 'ghost', email: 'ghost@t.local', password: 'ZhenXia1984',
      ticket: validTicket(), [guard.REG_HONEYPOT_FIELD]: 'probe'
    })
    const db = getDb()
    const before = Number(db.prepare('SELECT MAX(id) AS m FROM users').get()?.m || 0)

    const r = await postRegister({ username: name, email: `${name}@t.local`, password: 'ZhenXia1984', ticket: validTicket() })
    expect(r.status).toBe(201)
    expect((await r.json()).user.id).toBe(before + 1) // 未被蜜罐游标污染
  })
})

describe('E. 闸门①：IP 限流', () => {
  it('E1 窗口内前 REG_MAX_PER_IP 次放行（走业务校验），之后一律 429', async () => {
    const ip = '10.1.2.3'
    const seen = []
    for (let i = 0; i < guard.REG_MAX_PER_IP; i++) {
      const name = uniq()
      const r = await postRegister(
        { username: name, email: `${name}@t.local`, password: 'ZhenXia1984', ticket: validTicket() }, ip
      )
      seen.push(r.status)
    }
    expect(seen).toEqual(Array(guard.REG_MAX_PER_IP).fill(201))

    const r = await postRegister({ username: uniq(), email: 'x@t.local', password: 'ZhenXia1984', ticket: validTicket() }, ip)
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toBe('3600')
    expect((await r.json()).message).toContain('过于频繁')
  })

  it('E2 限流按 IP 隔离（另一 IP 不受影响）', async () => {
    const name = uniq()
    const r = await postRegister(
      { username: name, email: `${name}@t.local`, password: 'ZhenXia1984', ticket: validTicket() }, '10.4.4.4'
    )
    expect(r.status).toBe(201)
  })

  it('E3 限流先于蜜罐执行（超频时连假成功都不给，省下一次 bcrypt）', async () => {
    const ip = '10.5.5.5'
    for (let i = 0; i < guard.REG_MAX_PER_IP; i++) {
      await postRegister({ username: uniq(), email: 'y@t.local', password: 'ZhenXia1984', ticket: validTicket() }, ip)
    }
    const r = await postRegister(
      { username: uniq(), email: 'y@t.local', password: 'ZhenXia1984', ticket: validTicket(), [guard.REG_HONEYPOT_FIELD]: 'x' }, ip
    )
    expect(r.status).toBe(429)
  })

  it('E4 注册与忘记密码的限流桶互相隔离（key 命名空间 reg: / reset:）', () => {
    const ip = '10.6.6.6'
    for (let i = 0; i < guard.REG_MAX_PER_IP; i++) {
      rate.overLimit(`reg:ip:${ip}`, guard.REG_MAX_PER_IP, guard.REG_WINDOW_MS)
    }
    // 注册桶已封顶
    expect(rate.overLimit(`reg:ip:${ip}`, guard.REG_MAX_PER_IP, guard.REG_WINDOW_MS)).toBe(true)
    // 但忘记密码的桶是另一套 key ⇒ 不受影响
    expect(rate.overLimit(`reset:ip:${ip}`, 10, 15 * 60 * 1000)).toBe(false)
  })

  it('E5 resetRateLimits() 能清空（运维误封后解封路径）', () => {
    const ip = '10.7.7.7'
    for (let i = 0; i < guard.REG_MAX_PER_IP; i++) {
      rate.overLimit(`reg:ip:${ip}`, guard.REG_MAX_PER_IP, guard.REG_WINDOW_MS)
    }
    expect(rate.overLimit(`reg:ip:${ip}`, guard.REG_MAX_PER_IP, guard.REG_WINDOW_MS)).toBe(true)
    rate.resetRateLimits()
    expect(rate.overLimit(`reg:ip:${ip}`, guard.REG_MAX_PER_IP, guard.REG_WINDOW_MS)).toBe(false)
  })
})
