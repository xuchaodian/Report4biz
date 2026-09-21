/**
 * AI（豆包）额度与刹车测试 —— v1.13.161
 *
 * 需求（用户原话，2026-09-21）：
 *   「我需要控制用户AI助手（地图界面左侧AI助手按钮）耗费的豆包AI费用」
 *   三项拍板（2026-09-21 用户确认）：
 *     ① 额度口径 = 按角色分层给次数
 *     ② 刹车档位 = 保守档（10 次/分 · 100 次/日 · 全局月度熔断 ¥200）
 *     ③ 实施范围 = L0 解耦 + L1 额度 + L2 刹车
 *
 * 被测：src/utils/aiQuota.js + src/routes/ai.js
 *
 * 本测试要钉死的不变量：
 *   A. 额度分层：admin 不限 / vip 1000 / trial 50 / 其他 100；**vip 过期按普通用户**
 *   B. 时间边界：月/日的「本地零点」正确换算成 UTC 串（否则日上限会在上午 8 点重置）
 *   C. ⭐ 次数口径：一次问答算 **1 次** —— 服务端工具触发的上游续轮
 *      (chat-followup / site-advice-extra) 与历史 NULL 行**都不计入**
 *   D. ⭐⭐ **L0 解耦**：`users.quota = 0`、`purchases` 0 行时 AI **仍然可用**。
 *      这是本次改造的核心 —— 旧代码在此场景下必然 403「剩余次数为0」，
 *      导致全站（含 admin）自 2026-09-07 起停摆。
 *   E. L1 额度：用满即拒（403 monthly_exhausted），跨月自动重置
 *   F. L2 日上限：VIP 月额度未满但当日满 100 次 ⇒ 拒，且提示为「今日」
 *   G. L2 分钟限速：第 11 次拒（429），60 秒后自动恢复，**admin 同样受限速约束**
 *   H. L2 全局熔断：全站本月 token 超阈值 ⇒ 非 admin 一律拒；**admin 豁免**（便于排查/关停）
 *   I. 输入截断：超预算时从最早消息丢起；单条超预算保留尾部；非数组不炸
 *   J. /site-advice 一致性：与 AI 助手共用同一额度闸门，且 VIP 门禁行为保持不变
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库；
 * 上游（火山方舟 / 高德）全部打桩，**绝不发出真实外网请求**。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-aiquota-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb
// 限速档位由 aiQuota.js 读环境变量决定；测试里压到 3，让「命中限速」用例只需 4 次请求。
// ⚠️ 必须在动态 import aiQuota.js **之前**设置。
process.env.AI_RATE_PER_MINUTE = '3'

// ---- 上游打桩：本套测试只验证「闸门」，不碰外网 ----
vi.mock('../src/utils/httpTimeout.js', () => ({
  DEFAULT_HTTP_TIMEOUT_MS: 15000,
  STREAM_HEAD_TIMEOUT_MS: 15000,
  fetchWithTimeout: vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      choices: [{ message: { role: 'assistant', content: '好的，已为您处理。' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1800, completion_tokens: 300 }
    })
  })),
  fetchStreamWithTimeout: vi.fn()
}))
vi.mock('../src/utils/amapPoi.js', () => ({
  aroundSearch: vi.fn(async () => [])
}))

let db, signToken
let aiCallLimitFor, isVipActive, describeLimit, tokensToYuan
let monthStartStamp, dayStartStamp, resetRateBuckets, checkAiBudget, loadAiUser
let truncateMessages, slimContext, normalizeMaxTokens
let clearAiCache
let AI_ROLE_CALL_LIMIT, AI_DAILY_CALL_LIMIT, AI_RATE_PER_MINUTE, AI_GLOBAL_MONTHLY_TOKEN_CAP
let server, base

const ids = {}
const tokens = {}

async function call(method, p, { token, body } = {}, retry = true) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res
  try {
    res = await fetch(base + p, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
  } catch (e) {
    // 全量套件并行跑时本机偶发 ECONNRESET（socket 资源竞争），非被测行为 —— 重试一次
    if (retry) return call(method, p, { token, body }, false)
    throw e
  }
  let json = null
  try { json = await res.json() } catch (e) { json = null }
  return { status: res.status, body: json }
}

/** 造一条 ai_usage 行（默认落在「现在」，即本月今日） */
function addUsage(userId, endpoint, tokens = 2500) {
  db.prepare(`INSERT INTO ai_usage (user_id, tokens_used, endpoint) VALUES (?, ?, ?)`)
    .run(userId, tokens, endpoint)
}

/**
 * 批量造 ai_usage 行。⚠️ 必须包事务：非事务态下每次 run() 都会整库落盘
 * （见 database.js 落盘铁律），造几百行会白写几百遍磁盘。
 */
function insertUsageBatch(userId, endpoint, n, tokens, atSql) {
  if (n <= 0) return
  db.beginTx()
  try {
    const stmt = db.prepare(
      `INSERT INTO ai_usage (user_id, tokens_used, endpoint, created_at) VALUES (?, ?, ?, ${atSql})`
    )
    for (let i = 0; i < n; i++) stmt.run(userId, tokens, endpoint)
  } finally {
    db.commitTx()
  }
}

/** 本月的 N 行 */
function addUsageMany(userId, endpoint, n, tokens = 2500) {
  insertUsageBatch(userId, endpoint, n, tokens, 'CURRENT_TIMESTAMP')
}

/** **上个月**的 N 行（跨月重置用例） */
function addUsageManyPrevMonth(userId, endpoint, n, tokens = 2500) {
  insertUsageBatch(userId, endpoint, n, tokens, `datetime('now','-35 days')`)
}

function usageCount(userId, endpoint) {
  if (endpoint === undefined) {
    return db.prepare(`SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ?`).get(userId).c
  }
  return db.prepare(`SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ? AND endpoint = ?`).get(userId, endpoint).c
}

/** 直接问闸门（不起 HTTP） */
function gate(userId, now = new Date()) {
  return checkAiBudget(db, loadAiUser(db, userId), now)
}

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  db = dbMod.getDb()

  const q = await import('../src/utils/aiQuota.js')
  aiCallLimitFor = q.aiCallLimitFor
  isVipActive = q.isVipActive
  describeLimit = q.describeLimit
  tokensToYuan = q.tokensToYuan
  monthStartStamp = q.monthStartStamp
  dayStartStamp = q.dayStartStamp
  resetRateBuckets = q.resetRateBuckets
  checkAiBudget = q.checkAiBudget
  loadAiUser = q.loadAiUser
  truncateMessages = q.truncateMessages
  slimContext = q.slimContext
  normalizeMaxTokens = q.normalizeMaxTokens
  // v1.13.162：同问缓存是模块级内存态 ⇒ 必须在用例间清空，否则命中缓存会跳过记账、造成假绿/假红
  clearAiCache = (await import('../src/utils/aiResponseCache.js')).clearAiCache
  AI_ROLE_CALL_LIMIT = q.AI_ROLE_CALL_LIMIT
  AI_DAILY_CALL_LIMIT = q.AI_DAILY_CALL_LIMIT
  AI_RATE_PER_MINUTE = q.AI_RATE_PER_MINUTE
  AI_GLOBAL_MONTHLY_TOKEN_CAP = q.AI_GLOBAL_MONTHLY_TOKEN_CAP

  const { signToken: st } = await import('../src/utils/tokenAuth.js')
  signToken = st

  // ⭐ 所有账号的联通配额一律为 0，且 purchases 表保持 0 行 ——
  //    这是「L0 解耦」的试金石：旧代码在此必然全员 403。
  const mkUser = (username, role = 'user', vipUntil = null) => {
    const r = db.prepare(
      `INSERT INTO users (username, email, password, role, vip_until, quota) VALUES (?, ?, ?, ?, ?, 0)`
    ).run(username, `${username}@test.local`, 'x', role, vipUntil)
    return r.lastInsertRowid
  }

  ids.admin = mkUser('aq_admin', 'admin')
  ids.free = mkUser('aq_free', 'user')
  ids.free2 = mkUser('aq_free2', 'user')
  ids.vip = mkUser('aq_vip', 'vip', '2027-01-01')
  ids.vipNoExpiry = mkUser('aq_vip_ne', 'vip', null)
  ids.vipExpired = mkUser('aq_vip_exp', 'vip', '2020-01-01')
  ids.trial = mkUser('aq_trial', 'trial')
  ids.ghost = mkUser('aq_ghost', 'user')        // 只用来承载「全局熔断」的 token 量

  for (const k of Object.keys(ids)) {
    tokens[k] = signToken({ id: ids[k], username: `aq_${k}`, role: 'user', token_version: 0 })
  }

  const express = (await import('express')).default
  const aiRouter = (await import('../src/routes/ai.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/ai', aiRouter)
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

beforeEach(() => {
  db.prepare(`DELETE FROM ai_usage`).run()
  resetRateBuckets()
  clearAiCache()
})

// 每个用例都先自证前提：联通配额为 0
function assertQuotaIsZero() {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE quota != 0`).get()
  expect(row.c).toBe(0)
  expect(db.prepare(`SELECT COUNT(*) AS c FROM purchases`).get().c).toBe(0)
}

// ===========================================================================
describe('A 额度分层（L1）', () => {
  it('A1 admin 不限量', () => {
    expect(aiCallLimitFor({ id: ids.admin, role: 'admin' })).toBe(Infinity)
  })

  it('A2 vip（未过期）→ 1000 次/月', () => {
    expect(aiCallLimitFor({ id: ids.vip, role: 'vip', vip_until: '2027-01-01' })).toBe(AI_ROLE_CALL_LIMIT.vip)
  })

  it('A3 ⭐ vip 已过期 ⇒ 降级为普通用户额度（100 次/月）', () => {
    expect(aiCallLimitFor({ id: ids.vipExpired, role: 'vip', vip_until: '2020-01-01' })).toBe(AI_ROLE_CALL_LIMIT.user)
    expect(isVipActive({ role: 'vip', vip_until: '2020-01-01' })).toBe(false)
  })

  it('A4 trial → 50 次/月', () => {
    expect(aiCallLimitFor({ id: ids.trial, role: 'trial' })).toBe(AI_ROLE_CALL_LIMIT.trial)
  })

  it('A5 普通 user → 100 次/月', () => {
    expect(aiCallLimitFor({ id: ids.free, role: 'user' })).toBe(AI_ROLE_CALL_LIMIT.user)
  })

  it('A6 vip 无到期日 ⇒ 视为长期有效', () => {
    expect(isVipActive({ role: 'vip', vip_until: null })).toBe(true)
    expect(aiCallLimitFor({ id: ids.vipNoExpiry, role: 'vip', vip_until: null })).toBe(AI_ROLE_CALL_LIMIT.vip)
  })

  it('A7 未知角色 ⇒ 按普通用户额度兜底（不放大）', () => {
    expect(aiCallLimitFor({ id: 999, role: 'whoever' })).toBe(AI_ROLE_CALL_LIMIT.user)
  })

  it('A8 角色为准：user 即使写了 vip_until 也不算 VIP', () => {
    expect(isVipActive({ role: 'user', vip_until: '2030-01-01' })).toBe(false)
  })

  it('A9 文案与换算', () => {
    expect(describeLimit(Infinity)).toBe('不限')
    expect(describeLimit(100)).toBe('100 次')
    // 混合价 5.76 元/百万 tok ⇒ 100 万 tok ≈ ¥5.76
    expect(tokensToYuan(1_000_000)).toBeCloseTo(5.76, 6)
  })
})

// ===========================================================================
describe('B 时间边界换算（UTC 存储 vs 本地零点）', () => {
  it('B1 格式为 SQLite 风格 UTC 串', () => {
    expect(monthStartStamp()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(dayStartStamp()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('B2 dayStartStamp 解释为 UTC 后 = 本地当日零点（不是上午 8 点）', () => {
    const local = new Date(2026, 8, 21, 14, 30, 0)
    const parsed = new Date(dayStartStamp(local).replace(' ', 'T') + 'Z')
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(8)
    expect(parsed.getDate()).toBe(21)
    expect(parsed.getHours()).toBe(0)
    expect(parsed.getMinutes()).toBe(0)
  })

  it('B3 monthStartStamp 解释为 UTC 后 = 本地当月 1 日零点', () => {
    const local = new Date(2026, 8, 21, 14, 30, 0)
    const parsed = new Date(monthStartStamp(local).replace(' ', 'T') + 'Z')
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(8)
    expect(parsed.getDate()).toBe(1)
    expect(parsed.getHours()).toBe(0)
  })
})

// ===========================================================================
describe('C ⭐ 次数口径：一次问答 = 1 次', () => {
  it('C1 endpoint=chat 计 1 次', () => {
    addUsage(ids.free, 'chat')
    expect(gate(ids.free).monthlyCalls).toBe(1)
  })

  it('C2 endpoint=chat-followup 不计入额度（只贡献 token）', () => {
    addUsage(ids.free, 'chat')
    addUsage(ids.free, 'chat-followup')
    expect(gate(ids.free).monthlyCalls).toBe(1)
    expect(gate(ids.free).dailyCalls).toBe(1)
  })

  it('C3 endpoint=site-advice 计 1 次', () => {
    addUsage(ids.free, 'site-advice')
    expect(gate(ids.free).monthlyCalls).toBe(1)
  })

  it('C4 endpoint=site-advice-extra 不计入额度', () => {
    addUsage(ids.free, 'site-advice')
    addUsage(ids.free, 'site-advice-extra')
    expect(gate(ids.free).monthlyCalls).toBe(1)
  })

  it('C5 历史行 endpoint=NULL 不计入（上线即从零起算）', () => {
    addUsage(ids.free, null)
    addUsage(ids.free, null)
    expect(gate(ids.free).monthlyCalls).toBe(0)
  })

  it('C6 混合场景：1 次问答 + 续轮 + 历史行 ⇒ 只算 1 次', () => {
    addUsage(ids.free, 'chat')
    addUsage(ids.free, 'chat-followup')
    addUsage(ids.free, 'chat-followup')
    addUsage(ids.free, null)
    expect(gate(ids.free).monthlyCalls).toBe(1)
  })
})

// ===========================================================================
describe('D ⭐⭐ L0 解耦：联通配额为 0 时 AI 仍然可用', () => {
  it('D0 前提自证：全站 quota 为 0、purchases 0 行', () => {
    assertQuotaIsZero()
  })

  it('D1 普通用户 quota=0 ⇒ 闸门放行（旧代码此处必 403「剩余次数为0」）', () => {
    const r = gate(ids.free)
    expect(r.allowed).toBe(true)
    expect(r.limit).toBe(AI_ROLE_CALL_LIMIT.user)
    expect(r.monthlyCalls).toBe(0)
  })

  it('D2 admin quota=0 ⇒ 放行且不限量（旧代码连 admin 也打不开）', () => {
    const r = gate(ids.admin)
    expect(r.allowed).toBe(true)
    expect(r.unlimited).toBe(true)
  })

  it('D3 vip / trial / 过期 vip 在 quota=0 时均放行', () => {
    expect(gate(ids.vip).allowed).toBe(true)
    expect(gate(ids.trial).allowed).toBe(true)
    expect(gate(ids.vipExpired).allowed).toBe(true)
  })

  it('D4 ⭐ 端到端：POST /api/ai/chat 在 quota=0 时返回 200（不再 403）', async () => {
    const r = await call('POST', '/api/ai/chat', {
      token: tokens.free,
      body: { messages: [{ role: 'user', content: '开启热力图' }] }
    })
    expect(r.status).toBe(200)
    expect(r.body.type).toBe('text')
  })

  it('D5 端到端：该次问答在 ai_usage 落 1 行且 endpoint=chat', async () => {
    await call('POST', '/api/ai/chat', {
      token: tokens.free,
      body: { messages: [{ role: 'user', content: '定位到上海' }] }
    })
    expect(usageCount(ids.free, 'chat')).toBe(1)
    expect(usageCount(ids.free)).toBe(1)
  })

  it('D6 端到端：返回文案不再出现「剩余次数为0」这类联通口径措辞', async () => {
    addUsage(ids.free, 'chat', 2500)
    const r = await call('POST', '/api/ai/chat', {
      token: tokens.free,
      body: { messages: [{ role: 'user', content: '你好' }] }
    })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.body)).not.toContain('剩余次数为0')
  })
})

// ===========================================================================
describe('E L1 额度：用满即拒、跨月重置', () => {
  it('E1 普通用户已用 99 次 ⇒ 仍放行', () => {
    for (let i = 0; i < 99; i++) addUsage(ids.free, 'chat')
    const r = gate(ids.free)
    expect(r.allowed).toBe(true)
    expect(r.monthlyCalls).toBe(99)
  })

  it('E2 普通用户已用 100 次 ⇒ 403 monthly_exhausted', () => {
    for (let i = 0; i < AI_ROLE_CALL_LIMIT.user; i++) addUsage(ids.free, 'chat')
    const r = gate(ids.free)
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('monthly_exhausted')
    expect(r.message).toContain('额度已用完')
  })

  it('E3 ⭐ 已满 100 行但其中 60 行是 followup ⇒ 实际只算 40 次 ⇒ 放行', () => {
    for (let i = 0; i < 40; i++) addUsage(ids.free, 'chat')
    for (let i = 0; i < 60; i++) addUsage(ids.free, 'chat-followup')
    const r = gate(ids.free)
    expect(r.allowed).toBe(true)
    expect(r.monthlyCalls).toBe(40)
  })

  it('E4 上月用满 100 次 ⇒ 本月不受影响（跨月重置）', () => {
    addUsageManyPrevMonth(ids.free, 'chat', 100)
    const r = gate(ids.free)
    expect(r.allowed).toBe(true)
    expect(r.monthlyCalls).toBe(0)
  })

  it('E5 过期 vip 按普通额度计：用满 100 次即拒', () => {
    for (let i = 0; i < 100; i++) addUsage(ids.vipExpired, 'chat')
    const r = gate(ids.vipExpired)
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('monthly_exhausted')
  })

  it('E6 未过期 vip 用满 100 次撞的是「日上限」而非「月额度」（证明 vip 额度 1000 > 100）', () => {
    addUsageMany(ids.vip, 'chat', 100)
    const r = gate(ids.vip)
    expect(r.allowed).toBe(false)
    // 月额度检查排在日上限之前；若 vip 月额度被误设成 100，这里会先拿到 monthly_exhausted
    expect(r.code).toBe('daily_exhausted')
  })

  it('E7 trial 用满 50 次即拒', () => {
    for (let i = 0; i < 50; i++) addUsage(ids.trial, 'chat')
    const r = gate(ids.trial)
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('monthly_exhausted')
  })

  it('E8 端到端：额度耗尽时返回 403 且带 code', async () => {
    for (let i = 0; i < 100; i++) addUsage(ids.free2, 'chat')
    const r = await call('POST', '/api/ai/chat', {
      token: tokens.free2,
      body: { messages: [{ role: 'user', content: '你好' }] }
    })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('monthly_exhausted')
  })

  it('E9 admin 用量远超普通额度（200 次，同时越过日上限）仍不限量', () => {
    addUsageMany(ids.admin, 'chat', 200)
    const r = gate(ids.admin)
    expect(r.allowed).toBe(true)
    expect(r.unlimited).toBe(true)
  })
})

// ===========================================================================
describe('F L2 刹车：每日上限', () => {
  it('F1 VIP 今日已用 100 次（月额度 1000 未满）⇒ 403 daily_exhausted', () => {
    for (let i = 0; i < AI_DAILY_CALL_LIMIT; i++) addUsage(ids.vip, 'chat')
    const r = gate(ids.vip)
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('daily_exhausted')
  })

  it('F2 提示为「今日」而非「本月」（先撞日上限就先说日）', () => {
    for (let i = 0; i < AI_DAILY_CALL_LIMIT; i++) addUsage(ids.vip, 'chat')
    expect(gate(ids.vip).message).toContain('今日')
  })

  it('F3 今日 99 次 ⇒ 放行', () => {
    for (let i = 0; i < 99; i++) addUsage(ids.vip, 'chat')
    expect(gate(ids.vip).allowed).toBe(true)
  })

  it('F4 上月的 100 次不影响今日计数', () => {
    addUsageManyPrevMonth(ids.vip, 'chat', 100)
    const r = gate(ids.vip)
    expect(r.allowed).toBe(true)
    expect(r.dailyCalls).toBe(0)
  })
})

// ===========================================================================
describe('G L2 刹车：分钟限速', () => {
  it('G1 连续 10 次放行，第 11 次命中限速', () => {
    const now = new Date()
    for (let i = 0; i < AI_RATE_PER_MINUTE; i++) {
      expect(checkAiBudget(db, loadAiUser(db, ids.free), now).allowed).toBe(true)
    }
    const r = checkAiBudget(db, loadAiUser(db, ids.free), now)
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('rate_limited')
  })

  it('G2 命中限速时给出 1~60 秒的可重试时间', () => {
    const now = new Date()
    for (let i = 0; i < AI_RATE_PER_MINUTE; i++) checkAiBudget(db, loadAiUser(db, ids.free), now)
    const r = checkAiBudget(db, loadAiUser(db, ids.free), now)
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(r.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('G3 60 秒后自动恢复', () => {
    const t0 = new Date()
    for (let i = 0; i < AI_RATE_PER_MINUTE; i++) checkAiBudget(db, loadAiUser(db, ids.free), t0)
    expect(checkAiBudget(db, loadAiUser(db, ids.free), t0).allowed).toBe(false)
    const later = new Date(t0.getTime() + 61_000)
    expect(checkAiBudget(db, loadAiUser(db, ids.free), later).allowed).toBe(true)
  })

  it('G4 ⭐ admin 同样受限速约束（限速防脚本，与额度无关）', () => {
    const now = new Date()
    for (let i = 0; i < AI_RATE_PER_MINUTE; i++) checkAiBudget(db, loadAiUser(db, ids.admin), now)
    const r = checkAiBudget(db, loadAiUser(db, ids.admin), now)
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('rate_limited')
  })

  it('G5 端到端：命中限速返回 429（可重试语义）', async () => {
    const body = { messages: [{ role: 'user', content: '你好' }] }
    let last = null
    for (let i = 0; i < AI_RATE_PER_MINUTE + 1; i++) {
      last = await call('POST', '/api/ai/chat', { token: tokens.admin, body })
    }
    expect(last.status).toBe(429)
    expect(last.body.code).toBe('rate_limited')
  })

  it('G6 限速按账号隔离：A 被限不影响 B', () => {
    const now = new Date()
    for (let i = 0; i < AI_RATE_PER_MINUTE; i++) checkAiBudget(db, loadAiUser(db, ids.free), now)
    expect(checkAiBudget(db, loadAiUser(db, ids.free), now).allowed).toBe(false)
    expect(checkAiBudget(db, loadAiUser(db, ids.free2), now).allowed).toBe(true)
  })
})

// ===========================================================================
describe('H L2 刹车：全局月度熔断', () => {
  it('H1 全站本月 token 超阈值 ⇒ 普通用户 403 global_budget', () => {
    addUsage(ids.ghost, null, AI_GLOBAL_MONTHLY_TOKEN_CAP)
    const r = gate(ids.free)
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('global_budget')
  })

  it('H2 同一状态下 vip 也被拦（熔断是全局止损）', () => {
    addUsage(ids.ghost, null, AI_GLOBAL_MONTHLY_TOKEN_CAP)
    expect(gate(ids.vip).allowed).toBe(false)
  })

  it('H3 ⭐ admin 豁免熔断（需能进入排查与关停）', () => {
    addUsage(ids.ghost, null, AI_GLOBAL_MONTHLY_TOKEN_CAP)
    expect(gate(ids.admin).allowed).toBe(true)
  })

  it('H4 文案含预算金额与恢复说明', () => {
    addUsage(ids.ghost, null, AI_GLOBAL_MONTHLY_TOKEN_CAP)
    const m = gate(ids.free).message
    expect(m).toContain('预算上限')
    expect(m).toContain('下月 1 日')
  })

  it('H5 阈值以下不熔断', () => {
    addUsage(ids.ghost, null, AI_GLOBAL_MONTHLY_TOKEN_CAP - 1)
    expect(gate(ids.free).allowed).toBe(true)
  })

  it('H6 上月的巨量 token 不计入本月熔断', () => {
    insertUsageBatch(ids.ghost, null, 1, AI_GLOBAL_MONTHLY_TOKEN_CAP * 3, `datetime('now','-35 days')`)
    expect(gate(ids.free).allowed).toBe(true)
  })
})

// ===========================================================================
describe('I L2 刹车：输入预算截断', () => {
  it('I1 超预算时从最早的消息丢起，保留最近的', () => {
    const msgs = [
      { role: 'user', content: 'x'.repeat(6000) },
      { role: 'assistant', content: 'y'.repeat(6000) },
      { role: 'user', content: 'z'.repeat(6000) }
    ]
    const out = truncateMessages(msgs, 12000)
    expect(out.length).toBe(2)
    expect(out[out.length - 1].content.startsWith('z')).toBe(true)
    expect(out[0].content.startsWith('y')).toBe(true)
  })

  it('I2 单条即超预算 ⇒ 保留其尾部而非整条丢弃', () => {
    const out = truncateMessages([{ role: 'user', content: 'A'.repeat(100) + '问题在末尾' }], 20)
    expect(out.length).toBe(1)
    expect(out[0].content.length).toBe(20)
    expect(out[0].content.endsWith('问题在末尾')).toBe(true)
  })

  it('I3 预算充足时原样返回', () => {
    const msgs = [{ role: 'user', content: '你好' }]
    expect(truncateMessages(msgs, 12000)).toEqual(msgs)
  })

  it('I4 非数组入参 ⇒ 空数组（不炸 500）', () => {
    expect(truncateMessages(undefined)).toEqual([])
    expect(truncateMessages(null)).toEqual([])
    expect(truncateMessages('nope')).toEqual([])
  })

  it('I5 丢弃非字符串 content 的脏条目', () => {
    const out = truncateMessages([{ role: 'user', content: null }, { role: 'user', content: 'ok' }], 12000)
    expect(out.length).toBe(1)
    expect(out[0].content).toBe('ok')
  })

  it('I6 slimContext：超预算直接置空，正常体原样保留', () => {
    expect(slimContext({ a: 1 })).toEqual({ a: 1 })
    expect(slimContext({ big: 'x'.repeat(5000) })).toBeNull()
    expect(slimContext(null)).toBeNull()
    expect(slimContext('nope')).toBeNull()
  })

  it('I7 端到端：超长历史被截断后仍正常返回 200', async () => {
    const msgs = []
    for (let i = 0; i < 40; i++) msgs.push({ role: 'user', content: 'x'.repeat(1000) })
    msgs.push({ role: 'user', content: '最后的问题' })
    const r = await call('POST', '/api/ai/chat', { token: tokens.free, body: { messages: msgs } })
    expect(r.status).toBe(200)
  })

  it('I8 端到端：messages 为空 ⇒ 400 而非 500', async () => {
    const r = await call('POST', '/api/ai/chat', { token: tokens.free, body: { messages: [] } })
    expect(r.status).toBe(400)
  })
})

// ===========================================================================
describe('J /site-advice 与 AI 助手共用同一闸门', () => {
  it('J1 非 VIP ⇒ 403 VIP 专属文案（原行为保留）', async () => {
    const r = await call('POST', '/api/ai/site-advice', {
      token: tokens.free,
      body: { storeName: '测试店', brand: '测试品牌' }
    })
    expect(r.status).toBe(403)
    expect(r.body.message).toContain('VIP')
  })

  it('J2 过期 vip ⇒ 同样按非 VIP 拒绝', async () => {
    const r = await call('POST', '/api/ai/site-advice', {
      token: tokens.vipExpired,
      body: { storeName: '测试店', brand: '测试品牌' }
    })
    expect(r.status).toBe(403)
    expect(r.body.message).toContain('VIP')
  })

  it('J3 ⭐ 额度闸门先于 VIP 门禁：过期 VIP 且额度耗尽 ⇒ 得到额度文案而非 VIP 文案', async () => {
    // 与 J2 对照：同一账号（过期 vip）在 0 次用量时得到 VIP 文案（J2），
    // 用满 100 次后得到的是**额度**文案 —— 证明额度闸门排在 VIP 门禁之前。
    addUsageMany(ids.vipExpired, 'chat', AI_ROLE_CALL_LIMIT.user)
    const r = await call('POST', '/api/ai/site-advice', {
      token: tokens.vipExpired,
      body: { storeName: '测试店', brand: '测试品牌' }
    })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('monthly_exhausted')
  })

  it('J4 VIP 且额度充足 ⇒ 通过两道门并可正常返回', async () => {
    const r = await call('POST', '/api/ai/site-advice', {
      token: tokens.vip,
      body: { storeName: '测试店', brand: '测试品牌' }
    })
    expect(r.status).toBe(200)
    expect(r.body.success).toBe(true)
  })

  it('J5 site-advice 的消耗同样计入额度（共用一本账）', async () => {
    await call('POST', '/api/ai/site-advice', {
      token: tokens.vip,
      body: { storeName: '测试店', brand: '测试品牌' }
    })
    expect(usageCount(ids.vip, 'site-advice')).toBe(1)
    expect(gate(ids.vip).monthlyCalls).toBe(1)
  })

  it('J6 端到端：quota=0 的 VIP 也能用（L0 解耦对 site-advice 同样成立）', () => {
    assertQuotaIsZero()
    expect(gate(ids.vip).allowed).toBe(true)
  })
})

// ===========================================================================
describe('K 未认证与边界', () => {
  it('K1 无 token ⇒ 401（不可绕过鉴权白嫖）', async () => {
    const r = await call('POST', '/api/ai/chat', {
      body: { messages: [{ role: 'user', content: '你好' }] }
    })
    expect(r.status).toBe(401)
  })

  it('K2 账号不存在 ⇒ 闸门拒绝而非放行', () => {
    const r = checkAiBudget(db, null)
    expect(r.allowed).toBe(false)
    expect(r.code).toBe('user_missing')
  })

  it('K3 loadAiUser 能取到闸门所需字段', () => {
    const u = loadAiUser(db, ids.vip)
    expect(u.role).toBe('vip')
    expect(u.vip_until).toBe('2027-01-01')
  })
})
