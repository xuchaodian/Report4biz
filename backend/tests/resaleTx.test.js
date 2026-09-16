/**
 * resale.js 计费路径事务化 + ai.js 去重复落盘（v1.13.144）
 *
 * 被测行为（src/routes/resale.js 的 POST /api/v1/population）：
 *  1. 真实计费路径「扣客户余额 + 扣物理池 + 写流水 + 写缓存」= 4 个写点 ⇒ **落盘恰 1 次**
 *  2. 三本账同事务：任一写点失败 ⇒ 扣费**整体回滚**（不再出现「扣了钱没流水」）
 *  3. 缓存命中路径 = 单写点 ⇒ **不开事务**（开了反而 2 次落盘），仍为 1 次
 *  4. 源码守卫：routes/ai.js 不再有 db.saveNow() 调用（run() 已负责落盘）
 *
 * 安全边界：
 *  - **绝不触真上游**：mock src/utils/httpTimeout.js 的 fetchWithTimeout（联通接口按次计费）
 *  - **绝不碰真库**：R4B_DB_PATH 指向 /tmp 临时库，schema 由 initDatabase() 现建
 *  - 落盘计数探针：v1.13.142 起落盘原语是「写 .tmp → fsync → rename .db」⇒ 观测 renameSync
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import express from 'express'

const tmpDb = path.join(os.tmpdir(), `r4b-billing-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb
process.env.R4B_GEO_DIR = path.join(os.tmpdir(), `r4b-billing-geo-${process.pid}`)

// 上游 HTTP 层替换：getAuthorization 发 token；getData 返回非空业务数据（不联网）
vi.mock('../src/utils/httpTimeout.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchWithTimeout: vi.fn(async (url) => {
      if (String(url).includes('getAuthorization')) {
        return { ok: true, status: 200, json: async () => ({ code: 200, data: 'tok_test_144' }) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          data: { grid: [{ lng: 121.47, lat: 31.23, value: 12345 }], total: 12345 }
        })
      }
    })
  }
})

const API_KEY_PLAIN = 'r4b_testkey_v113144'
const KEY_HASH = crypto.createHash('sha256').update(API_KEY_PLAIN).digest('hex')

let dbMod
let server
let baseUrl
let commitSpy
let adminToken

// 只统计「落库文件」的落盘次数（rename 目标以 .db 结尾）
const dbWrites = () => commitSpy.mock.calls.filter(([, dest]) => String(dest).endsWith('.db')).length

const q = (sql, ...p) => dbMod.getDb().prepare(sql).get(...p)
const balanceOf = () => q(`SELECT balance FROM api_keys WHERE api_key = ?`, KEY_HASH)?.balance
const poolOf = () => q(`SELECT remaining_quota FROM admin_quota WHERE id = 1`)?.remaining_quota
const usageCount = () => q(`SELECT COUNT(*) AS c FROM api_usage`)?.c

async function callPopulation(body) {
  commitSpy.mockClear()
  const res = await fetch(`${baseUrl}/api/v1/population`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY_PLAIN },
    body: JSON.stringify(body)
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json, writes: dbWrites() }
}

beforeAll(async () => {
  vi.resetModules()
  commitSpy = vi.spyOn(fs, 'renameSync')

  dbMod = await import('../src/models/database.js')
  const { default: resaleRoutes, adminRouter } = await import('../src/routes/resale.js')
  const { createTxScope } = dbMod
  const db = dbMod.getDb()

  // 与 app.js 完全一致的请求级事务作用域中间件（含请求结束兜底回滚）
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    const scope = createTxScope()
    res.on('close', () => scope.rollbackIfPending())
    scope.run(next)
  })
  app.use('/api/v1/population', resaleRoutes)
  app.use('/api/v1/resale', adminRouter)

  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  // 管理员凭据（authenticate 只校验签名与 payload）
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  adminToken = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, cfg.JWT_SECRET, { expiresIn: '1h' })

  // 预置：一个真实模式客户 Key（余额 5）+ 物理池剩余 100
  db.exec(`DELETE FROM api_usage`)
  db.exec(`DELETE FROM api_keys`)
  db.prepare(`INSERT INTO api_keys (company_name, api_key, balance, status, mock) VALUES (?, ?, ?, 'active', 0)`)
    .run('测试客户-144', KEY_HASH, 5)
  db.exec(`UPDATE admin_quota SET remaining_quota = 100 WHERE id = 1`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS smartsteps_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      center_lng REAL NOT NULL,
      center_lat REAL NOT NULL,
      radius INTEGER NOT NULL,
      city_month TEXT,
      services TEXT NOT NULL,
      result_data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(center_lng, center_lat, radius, city_month, services)
    )
  `)
  db.exec(`DELETE FROM smartsteps_cache`)

  commitSpy.mockClear()
})

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r))
  vi.restoreAllMocks()
  for (const f of [tmpDb, tmpDb + '.tmp']) {
    try { fs.unlinkSync(f) } catch (e) { /* 忽略 */ }
  }
})

describe('resale.js 计费路径：4 写点合并为单事务（v1.13.144）', () => {
  it('真实调用：落盘恰 1 次，且余额/池/流水三本账同步入账', async () => {
    const before = { balance: balanceOf(), pool: poolOf(), usage: usageCount() }

    const r = await callPopulation({ lng: 121.47, lat: 31.23, radius: 1000, indicators: ['population'] })

    expect(r.status).toBe(200)
    expect(r.body.success).toBe(true)
    expect(r.body.deducted).toBe(1)

    // ★ 核心断言：扣余额 + 扣池 + 写流水 + 写缓存 = 1 次落盘（改动前为 4 次）
    expect(r.writes).toBe(1)

    // 三本账同时入账（同一次 saveDatabase ⇒ 同一份磁盘快照）
    expect(balanceOf()).toBe(before.balance - 1)
    expect(poolOf()).toBe(before.pool - 1)
    expect(usageCount()).toBe(before.usage + 1)

    // 缓存与账目同事务写入（下次同参数命中缓存）
    const cached = q(`SELECT COUNT(*) AS c FROM smartsteps_cache WHERE center_lng = ?`, 121.47)
    expect(cached.c).toBe(1)
  })

  it('原子性：第 3 个写点失败 ⇒ 前两笔扣减整体回滚，不会「扣了钱没流水」', async () => {
    const before = { balance: balanceOf(), pool: poolOf(), usage: usageCount() }
    expect(before.balance).toBe(4)
    expect(before.pool).toBe(99)

    // 制造 INSERT api_usage 失败（表名临时隐藏），此时前两笔 UPDATE 已在事务内
    dbMod.getDb().exec(`ALTER TABLE api_usage RENAME TO api_usage_hidden`)
    let r
    try {
      r = await callPopulation({ lng: 121.48, lat: 31.24, radius: 1000, indicators: ['population'] })
    } finally {
      dbMod.getDb().exec(`ALTER TABLE api_usage_hidden RENAME TO api_usage`)
      dbMod.getDb().saveNow()
    }

    expect(r.status).toBe(500)

    // ★ 核心断言：扣费与扣池已回滚，账目自洽（无「孤儿扣费」）
    expect(balanceOf()).toBe(before.balance)
    expect(poolOf()).toBe(before.pool)
    expect(usageCount()).toBe(before.usage)
  })

  it('缓存命中：单写点不开事务 ⇒ 仍 1 次落盘，且不扣余额/不扣池', async () => {
    dbMod.getDb()
      .prepare(`INSERT OR REPLACE INTO smartsteps_cache (center_lng, center_lat, radius, city_month, services, result_data) VALUES (?, ?, ?, NULL, ?, ?)`)
      .run(121.49, 31.25, 1000, '1001', JSON.stringify({ cached: true, mark: 'hit' }))

    const before = { balance: balanceOf(), pool: poolOf() }
    const r = await callPopulation({ lng: 121.49, lat: 31.25, radius: 1000, indicators: ['population'] })

    expect(r.status).toBe(200)
    expect(r.body.fromCache).toBe(true)
    expect(r.body.message).toContain('未消耗次数')  // 缓存命中分支响应不含 deducted 字段，以 fromCache+文案表达
    expect(r.writes).toBe(1)
    expect(balanceOf()).toBe(before.balance)
    expect(poolOf()).toBe(before.pool)
  })

  it('删除客户：删流水 + 删 Key 同事务 ⇒ 1 次落盘，不留孤儿用量记录', async () => {
    const db = dbMod.getDb()
    const ins = db
      .prepare(`INSERT INTO api_keys (company_name, api_key, balance, status, mock) VALUES (?, ?, ?, 'active', 0)`)
      .run('待删除客户-144', crypto.randomBytes(16).toString('hex'), 3)
    const keyId = ins.lastInsertRowid
    const insUsage = db.prepare(
      `INSERT INTO api_usage (api_key_id, services, center_lng, center_lat, radius, from_cache, cost) VALUES (?, ?, ?, ?, ?, 1, 0)`
    )
    insUsage.run(keyId, '1001', 1, 1, 1000)
    insUsage.run(keyId, '1001', 2, 2, 1000)
    expect(q(`SELECT COUNT(*) AS c FROM api_usage WHERE api_key_id = ?`, keyId).c).toBe(2)

    commitSpy.mockClear()
    const res = await fetch(`${baseUrl}/api/v1/resale/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ keyId })
    })

    expect(res.status).toBe(200)
    expect(dbWrites()).toBe(1)  // ★ 两删合并为 1 次落盘（改动前为 2 次）
    expect(q(`SELECT COUNT(*) AS c FROM api_keys WHERE id = ?`, keyId).c).toBe(0)
    expect(q(`SELECT COUNT(*) AS c FROM api_usage WHERE api_key_id = ?`, keyId).c).toBe(0)
  })
})

describe('ai.js 去重复落盘（v1.13.144）', () => {
  it('不再出现 db.saveNow() 调用（run() 已在非事务态自动落盘）', () => {
    const src = fs.readFileSync(new URL('../src/routes/ai.js', import.meta.url), 'utf8')
    const calls = src.split('\n').filter((l) => l.includes('db.saveNow()') && !l.trim().startsWith('//'))
    expect(calls).toEqual([])
  })
})
