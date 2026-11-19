/**
 * resale.js：对外 /api/v1/population 缓存命中不再免单（v1.13.382）
 *
 * 背景：381 批次已封住内部账号「踩到别人买过的点就白拿数据」，但**对外转售接口**
 *       （第三方 X-Api-Key）仍保留 `from_cache=1, cost=0` + `deducted:0`。
 *       缓存只该省平台的上游调用费（60 元/次），不能当客户的免单凭据。
 *
 * 被测行为：
 *  A. 客户 A 首查（真调上游）⇒ 扣 1、写缓存
 *  B. 客户 B 落在 A 买过的点上 ⇒ `fromCache:true` 但 `deducted:1`
 *     · B 余额 -1（不是白拿）
 *     · 物理池 -1（双轨同扣）
 *     · 流水写进 **B 自己** 名下，`from_cache=1, cost=1`
 *     · **上游一次都没多调**（缓存确实省了平台的钱）
 *  C. B 反复查同一点 ⇒ 每次都扣（封死「换个 Key 无限白拿」）
 *  D. 池耗尽 ⇒ 429，且**不扣 B 余额、不写流水**（闸门必须先于扣费）
 *  E. B 余额为 0 ⇒ 402（沿用既有前置校验）
 *  F. mock 测试 Key ⇒ 仍不计费（不占池、不调上游，保留联调能力）
 *  G. 源码守卫：闸门前移、缓存分支走 chargeUsageAndRecord、旧免单文案与旧 SQL 不复现
 *
 * 安全边界：绝不触真上游（mock httpTimeout）、绝不碰真库（R4B_DB_PATH 指向 /tmp）
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import express from 'express'

const tmpDb = path.join(os.tmpdir(), `r4b-resale-notfree-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb
process.env.R4B_GEO_DIR = path.join(os.tmpdir(), `r4b-resale-notfree-geo-${process.pid}`)

// 上游调用计数：只统计 getData（真正花钱的那一次）
const upstreamCalls = []

vi.mock('../src/utils/httpTimeout.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchWithTimeout: vi.fn(async (url) => {
      if (String(url).includes('getAuthorization')) {
        return { ok: true, status: 200, json: async () => ({ code: 200, data: 'tok_test_382' }) }
      }
      upstreamCalls.push(String(url))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          data: { grid: [{ lng: 121.47, lat: 31.23, value: 23456 }], total: 23456 }
        })
      }
    })
  }
})

const KEY_A = 'r4b_testkey_a_382'
const KEY_B = 'r4b_testkey_b_382'
const KEY_MOCK = 'r4b_testkey_mock_382'
const hash = (k) => crypto.createHash('sha256').update(k).digest('hex')

let dbMod
let server
let baseUrl

const q = (sql, ...p) => dbMod.getDb().prepare(sql).get(...p)
const balanceOf = (plain) => q(`SELECT balance FROM api_keys WHERE api_key = ?`, hash(plain))?.balance
const keyIdOf = (plain) => q(`SELECT id FROM api_keys WHERE api_key = ?`, hash(plain))?.id
const poolOf = () => q(`SELECT remaining_quota FROM admin_quota WHERE id = 1`)?.remaining_quota
const usageOf = (plain) =>
  q(`SELECT COUNT(*) AS c FROM api_usage WHERE api_key_id = ?`, keyIdOf(plain))?.c
const lastUsage = (plain) =>
  q(`SELECT * FROM api_usage WHERE api_key_id = ? ORDER BY id DESC LIMIT 1`, keyIdOf(plain))

async function callPopulation(key, body) {
  const res = await fetch(`${baseUrl}/api/v1/population`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
    body: JSON.stringify(body)
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json }
}

const P1 = { lng: 121.51, lat: 31.31, radius: 1000, indicators: ['population'] }
const P2 = { lng: 121.52, lat: 31.32, radius: 1000, indicators: ['population'] }

beforeAll(async () => {
  vi.resetModules()
  dbMod = await import('../src/models/database.js')
  const { default: resaleRoutes } = await import('../src/routes/resale.js')
  const { createTxScope } = dbMod
  const db = dbMod.getDb()

  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    const scope = createTxScope()
    res.on('close', () => scope.rollbackIfPending())
    scope.run(next)
  })
  app.use('/api/v1/population', resaleRoutes)

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  // 三个客户：A/B 真实模式各 5 次，mock 一个
  // ⚠️ mock Key 也必须给余额：余额校验（402）在 mock 分支**之前**，余额 0 连模拟数据都拿不到
  //    —— 这是既有行为（v1.13.382 未改），此处给 5 次以验证「mock 不扣费」本身。
  db.exec(`DELETE FROM api_usage`)
  db.exec(`DELETE FROM api_keys`)
  const ins = db.prepare(
    `INSERT INTO api_keys (company_name, api_key, balance, status, mock) VALUES (?, ?, ?, 'active', ?)`
  )
  ins.run('客户A-382', hash(KEY_A), 5, 0)
  ins.run('客户B-382', hash(KEY_B), 5, 0)
  ins.run('联调mock-382', hash(KEY_MOCK), 5, 1)
  db.exec(`UPDATE admin_quota SET remaining_quota = 100 WHERE id = 1`)
})

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r))
  vi.restoreAllMocks()
  for (const f of [tmpDb, tmpDb + '.tmp']) {
    try { fs.unlinkSync(f) } catch (e) { /* 忽略 */ }
  }
})

describe('A/B：别人买过的点，换个人来必须自己付钱', () => {
  it('A 首次查询：真调上游一次，A 扣 1，缓存落库', async () => {
    upstreamCalls.length = 0
    const r = await callPopulation(KEY_A, P1)

    expect(r.status).toBe(200)
    expect(r.body.success).toBe(true)
    expect(r.body.fromCache).toBe(false)
    expect(r.body.deducted).toBe(1)
    expect(upstreamCalls.length).toBe(1)

    expect(balanceOf(KEY_A)).toBe(4)
    expect(poolOf()).toBe(99)
    expect(q(`SELECT COUNT(*) AS c FROM smartsteps_cache`).c).toBe(1)
  })

  it('B 落在 A 买过的点：fromCache 仍计费 —— 扣 B 自己的余额与流水，上游不多调一次', async () => {
    upstreamCalls.length = 0
    const bUsageBefore = usageOf(KEY_B)
    const aUsageBefore = usageOf(KEY_A)

    const r = await callPopulation(KEY_B, P1)

    expect(r.status).toBe(200)
    expect(r.body.success).toBe(true)
    expect(r.body.fromCache).toBe(true)          // 确实来自缓存
    expect(r.body.deducted).toBe(1)              // ★ 但不再免单
    expect(r.body.balance).toBe(4)

    // ★ 核心：缓存只省平台的钱 —— 上游一次都没调
    expect(upstreamCalls.length).toBe(0)

    // ★ 核心：B 自己付了 1 次
    expect(balanceOf(KEY_B)).toBe(4)
    expect(poolOf()).toBe(98)
    expect(usageOf(KEY_B)).toBe(bUsageBefore + 1)
    expect(usageOf(KEY_A)).toBe(aUsageBefore)    // A 的历史不被顶替

    // 流水落 B 名下，且 from_cache=1 / cost=1（不是 cost=0）
    const row = lastUsage(KEY_B)
    expect(row.api_key_id).toBe(keyIdOf(KEY_B))
    expect(row.from_cache).toBe(1)
    expect(row.cost).toBe(1)
  })

  it('B 反复查同一点：每次都扣（不存在「第二次起白拿」）', async () => {
    upstreamCalls.length = 0
    const before = { balance: balanceOf(KEY_B), pool: poolOf() }

    const r = await callPopulation(KEY_B, P1)

    expect(r.status).toBe(200)
    expect(r.body.fromCache).toBe(true)
    expect(r.body.deducted).toBe(1)
    expect(balanceOf(KEY_B)).toBe(before.balance - 1)
    expect(poolOf()).toBe(before.pool - 1)
    expect(upstreamCalls.length).toBe(0)
  })

  it('池耗尽：缓存命中同样 429，且不扣余额、不写流水', async () => {
    const db = dbMod.getDb()
    // 先让 A 在一个新点上留下缓存（此时池还有额度）
    upstreamCalls.length = 0
    const warm = await callPopulation(KEY_A, P2)
    expect(warm.body.fromCache).toBe(false)

    const savedPool = poolOf()
    db.exec(`UPDATE admin_quota SET remaining_quota = 0 WHERE id = 1`)

    const before = { balance: balanceOf(KEY_B), usage: usageOf(KEY_B) }
    const r = await callPopulation(KEY_B, P2)

    expect(r.status).toBe(429)
    expect(balanceOf(KEY_B)).toBe(before.balance)
    expect(usageOf(KEY_B)).toBe(before.usage)
    expect(poolOf()).toBe(0)                     // 没被扣成负数

    db.exec(`UPDATE admin_quota SET remaining_quota = ${savedPool} WHERE id = 1`)
  })

  it('余额为 0：缓存命中仍 402（沿用既有前置校验）', async () => {
    const db = dbMod.getDb()
    db.prepare(`UPDATE api_keys SET balance = 0 WHERE api_key = ?`).run(hash(KEY_B))
    const poolBefore = poolOf()

    const r = await callPopulation(KEY_B, P1)

    expect(r.status).toBe(402)
    expect(poolOf()).toBe(poolBefore)

    db.prepare(`UPDATE api_keys SET balance = 3 WHERE api_key = ?`).run(hash(KEY_B))
  })

  it('mock 联调 Key：仍不计费、不占池（保留测试模式语义）', async () => {
    upstreamCalls.length = 0
    const poolBefore = poolOf()

    const r = await callPopulation(KEY_MOCK, P1)

    expect(r.status).toBe(200)
    expect(r.body.mock).toBe(true)
    expect(r.body.deducted).toBe(0)
    expect(balanceOf(KEY_MOCK)).toBe(5)
    expect(poolOf()).toBe(poolBefore)
    expect(upstreamCalls.length).toBe(0)
  })
})

describe('源码守卫：口径不再漂移回「缓存免单」', () => {
  const src = fs.readFileSync(new URL('../src/routes/resale.js', import.meta.url), 'utf8')

  // 只取「1. 查缓存 → 2. 调用上游」之间的缓存分支，避免被 mock 分支里的同名字样骗到
  const cacheBranch = (() => {
    const a = src.indexOf('// 1. 查缓存')
    const b = src.indexOf('// 2. 调用上游')
    return a >= 0 && b > a ? src.slice(a, b) : ''
  })()

  it('缓存分支存在且走统一计费实现', () => {
    expect(cacheBranch.length).toBeGreaterThan(100)
    expect(cacheBranch).toContain('chargeUsageAndRecord(')
    expect(cacheBranch).toContain('deducted: 1')
    expect(cacheBranch).toContain('fromCache: true')
  })

  it('缓存分支不再自写 cost=0 的流水（免单痕迹）', () => {
    expect(cacheBranch).not.toContain('INSERT INTO api_usage')
    expect(cacheBranch).not.toContain("未消耗次数")
    expect(cacheBranch).toContain('仍计入 1 次')
  })

  it('统一计费函数同时扣余额与物理池，且 cost 恒为 1', () => {
    const a = src.indexOf('function chargeUsageAndRecord')
    const b = src.indexOf('// ===== 检测空数据 =====')
    const fn = a >= 0 && b > a ? src.slice(a, b) : ''
    expect(fn).toContain('UPDATE api_keys SET balance = balance - 1')
    expect(fn).toContain('UPDATE admin_quota SET remaining_quota = remaining_quota - 1')
    expect(fn).toContain('fromCache ? 1 : 0')
    // 流水 cost 列写死 1（本函数只用于「已确定要计费」的路径）
    expect(fn).toMatch(/from_cache, cost\)\s*VALUES \(\?, \?, \?, \?, \?, \?, \?, 1\)/)
    // 计费失败必须整体回滚
    expect(fn).toContain('db.rollbackTx()')
  })

  it('闸门必须排在缓存查询之前（否则池可被扣成负数）', () => {
    const gateAt = src.indexOf("checkQuota(db, null, 1, { isApiKey: true })")
    const cacheAt = src.indexOf('// 1. 查缓存')
    expect(gateAt).toBeGreaterThan(0)
    expect(cacheAt).toBeGreaterThan(0)
    expect(gateAt).toBeLessThan(cacheAt)
  })

  it('真调上游分支也复用同一计费函数（不再各写一份）', () => {
    const a = src.indexOf('// 5. 计费 + 记录 + 写缓存')
    const b = src.indexOf('} catch (e) {', a)
    const branch = a >= 0 && b > a ? src.slice(a, b) : ''
    expect(branch).toContain('chargeUsageAndRecord(')
    expect(branch).toContain('writeCache: true')
    // 全文件只应有一个「扣余额」写点（在 chargeUsageAndRecord 内）
    const balanceUpdates = src.split('\n')
      .filter((l) => l.includes('SET balance = balance - 1') && !l.trim().startsWith('//'))
    expect(balanceUpdates.length).toBe(1)
  })
})
