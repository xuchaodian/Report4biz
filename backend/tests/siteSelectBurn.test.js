/**
 * 智能选址 · 高消耗熔断的**行为**测试（批次 372，业主 2026-11-17 要求）
 *
 * ── 为什么不能只靠 siteSelectGuard.test.js ─────────────────────────────
 * 源码守卫能证明「那个 if 写在那儿、位置在精算之前」，但证不出「真的一次都没扣钱」。
 * 本文件真起 express、真走 `/rank` 全链路，断言：
 *   ① 没带口令时 **400 + 联通取数函数一次都没被调用** + 物理池余额一分没动
 *   ② 口令与实际消耗不一致时仍然拒绝（防「看一眼随手输个 1」）
 *   ③ 口令对上了才进入精算（用 cache 口径返回值，池不扣）
 *   ④ 默认精算点数 30 不触发熔断（否则正常生成每天都要输数字，用户会学会无脑输）
 *
 * ── 关键手法：把 fetchPointPopulation 整个 mock 掉 ─────────────────────
 * 如果哪天熔断失效（被删 / 条件写错 / 被挪到精算之后），本测试**不会**真的去打联通
 * ——那会在生产或测试环境烧真额度。mock 让「熔断失效」的代价只是一条红色断言。
 * 这是这份测试能放心跑、也能放心留在 CI 里的前提。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

// ⚠️ 必须在任何 import 之前指向临时库 —— 绝不能碰真实库
const tmpDb = path.join(os.tmpdir(), `r4b-burn-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

// vi.mock 会被 hoist 到顶部，所以 mock 函数必须先 hoisted 出来
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))
vi.mock('../src/routes/smartsteps.js', () => ({
  // site-select 只用到这个命名导出；default 给个占位，避免别的模块 import default 时炸
  default: (req, res) => res.status(404).end(),
  fetchPointPopulation: mockFetch
}))

let server, base, token
let getDb, getPoolRemaining, jwtSign
let needFromPool = 0   // 第一次探测出来的实际需求，供后续用例复用

async function call(method, p, body, tk = token) {
  const headers = {}
  if (tk) headers.Authorization = `Bearer ${tk}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + p, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, body: json }
}

/**
 * 框选：上海西区 0.15° × 0.15°（约 240 km²，未超 400 上限）
 * 步长 1000m ⇒ 约 200+ 个候选点，远多于 50，足以让 preciseTopK 顶到上限。
 */
const BBOX = [121.30, 31.15, 121.45, 31.30]

function bodyWith(over = {}) {
  return {
    bbox: BBOX,
    stepM: 1000,
    radius: 1000,
    city: '上海',
    myBrand: '',
    cityMonth: '202609',
    topN: 20,
    preciseTopK: 50,
    minGapM: 800,
    saturation: { enabled: true, radiusM: 2000, maxOwn: 2 },
    ...over
  }
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  jwtSign = (payload) => jwt.sign(payload, cfg.JWT_SECRET, { expiresIn: '1h' })

  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  const poolMod = await import('../src/utils/quotaPool.js')
  getPoolRemaining = poolMod.getPoolRemaining

  const db = getDb()
  const u = db.prepare(`INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('burn_admin', 'burn_admin@test.local', 'x', 'admin', 0)
  token = jwtSign({ id: u.lastInsertRowid, username: 'burn_admin', role: 'admin' })

  // 池子给足：确保「被拒绝」是熔断导致的，而不是 pool_exhausted
  db.prepare(`UPDATE admin_quota SET initial_quota = 5000, remaining_quota = 1000 WHERE id = 1`).run()

  // 联通取数：返回 cache 口径（quotaUsed=0）——即便熔断失效走到这里也不会扣池，
  // 但会污染「没调用过」的断言，那正是我们要抓的
  mockFetch.mockImplementation(async () => ({
    ok: true,
    body: {
      success: true,
      source: 'cache',
      radius: 1000,
      population: { live: 30000, work: 8000, visit: 500000 },
      dataMonth: '202609',
      reused: { storeName: '', purchasedAt: '' },
      quotaUsed: 0,
      message: 'test'
    }
  }))

  const express = (await import('express')).default
  const router = (await import('../src/routes/site-select.js')).default
  const app = express()
  app.use(express.json())
  app.use('/api/site-select', router)
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
})

describe('高消耗熔断 /rank', () => {
  it('先探一次真实需求（preciseTopK=50 应被服务端 clamp 到 50）', async () => {
    const r = await call('POST', '/api/site-select/estimate', bodyWith())
    expect(r.status).toBe(200)
    needFromPool = r.body.data.burnCount
    // 上限 50：即使前端传 100 也不许超过 50
    expect(r.body.data.quotaEstimate).toBeLessThanOrEqual(50)
    expect(needFromPool).toBeGreaterThan(30)
    expect(r.body.data.burnConfirm).toBe(30)
    expect(r.body.data.burnRequired).toBe(true)
  })

  it('estimate 是 0 消耗的（池余额不动、联通一次没调）', async () => {
    mockFetch.mockClear()
    const before = getPoolRemaining(getDb())
    await call('POST', '/api/site-select/estimate', bodyWith())
    expect(mockFetch).not.toHaveBeenCalled()
    expect(getPoolRemaining(getDb())).toBe(before)
  })

  it('🔴 不带 confirmBurn ⇒ 400 熔断，且联通取数一次都没发生、池余额不动', async () => {
    mockFetch.mockClear()
    const before = getPoolRemaining(getDb())
    const r = await call('POST', '/api/site-select/rank', bodyWith())

    expect(r.status).toBe(400)
    expect(r.body.code).toBe('burn_confirm_required')
    expect(r.body.need).toBe(needFromPool)
    expect(r.body.burnConfirm).toBe(30)
    // 这条才是本测试的核心：熔断必须发生在任何取数之前
    expect(mockFetch).not.toHaveBeenCalled()
    expect(getPoolRemaining(getDb())).toBe(before)
  })

  it('confirmBurn 与实际需求不一致 ⇒ 仍拒绝（输个 1 骗不过去）', async () => {
    mockFetch.mockClear()
    const before = getPoolRemaining(getDb())
    for (const bad of [1, 30, needFromPool - 1]) {
      const r = await call('POST', '/api/site-select/rank', bodyWith({ confirmBurn: bad }))
      expect(r.status, `confirmBurn=${bad} 应被拒绝`).toBe(400)
      expect(r.body.code).toBe('burn_confirm_required')
    }
    expect(mockFetch).not.toHaveBeenCalled()
    expect(getPoolRemaining(getDb())).toBe(before)
  })

  it('confirmBurn 对上才放行进入精算', async () => {
    mockFetch.mockClear()
    const r = await call('POST', '/api/site-select/rank', bodyWith({ confirmBurn: needFromPool }))
    expect(r.status).toBe(200)
    expect(r.body.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(needFromPool)
    // mock 返回 cache 口径 ⇒ 一次都没真扣
    expect(r.body.data.quota.used).toBe(0)
    expect(r.body.data.quota.fromCacheCount).toBe(needFromPool)
  })

  it('精算点数 = 默认 30 ⇒ 不触发熔断（正常生成不被打扰）', async () => {
    mockFetch.mockClear()
    const r = await call('POST', '/api/site-select/rank', bodyWith({ preciseTopK: 30 }))
    expect(r.status).toBe(200)
    expect(r.body.data.quota.estimate).toBe(30)
  })

  it('前端传 preciseTopK=100 ⇒ 服务端 clamp 到 50（单次成本天花板）', async () => {
    const r = await call('POST', '/api/site-select/estimate', bodyWith({ preciseTopK: 100 }))
    expect(r.status).toBe(200)
    expect(r.body.data.quotaEstimate).toBe(50)
  })

  it('confirmBurn 传字符串也要归一成数字（⛔ 不能因类型不同把有效确认拦掉）', async () => {
    mockFetch.mockClear()
    // 若归一化缺失，`'35' !== 35` 会把这次确认判成不一致 ⇒ 用户输对了仍被拒
    const r = await call('POST', '/api/site-select/rank', bodyWith({ confirmBurn: String(needFromPool) }))
    expect(r.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(needFromPool)
  })

  it('余额不足时优先报 pool_exhausted，不让用户先输一遍数字', async () => {
    const db = getDb()
    const original = getPoolRemaining(db)
    db.prepare(`UPDATE admin_quota SET remaining_quota = 5 WHERE id = 1`).run()
    mockFetch.mockClear()
    try {
      const r = await call('POST', '/api/site-select/rank', bodyWith())
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('pool_exhausted')
      expect(r.body.need).toBe(needFromPool)
      expect(r.body.remaining).toBe(5)
      expect(mockFetch).not.toHaveBeenCalled()
    } finally {
      db.prepare(`UPDATE admin_quota SET remaining_quota = ? WHERE id = 1`).run(original)
    }
  })
})
