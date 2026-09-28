/**
 * 半径展示口径一致性测试 —— v1.13.183
 *
 * 立项背景（2026-09-28 徐工提问引出）：
 *   门店弹窗「已购报表」的半径列显示成 **`[2000]`** —— 因为 `GET /by-store/:storeName`
 *   从未产出 `radius_display`，前端只能直接渲染 `purchases.radius` 原始 JSON 串；
 *   而 `GET /history` 一直有 `radius_display`（`2000米`）。
 *
 * 修法（遵守项目铁律「**派生/解析算法必须抽成单一函数共用**」，158 根因）：
 *   把原先只内联在 `/history` 的解析逻辑抽成 `formatRadiusDisplay()`，两接口共用。
 *
 * ★ 本文件的作用：在 **HTTP 层**钉死「两个接口对同一行数据的 `radius_display` 必须逐字相同」。
 *   这正是本次 bug 的本质（**两接口口径不一致**），也是未来任何人改动其一时的防线。
 *
 * ⚠️ 已知的**有意差异**（相对抽取前的 `/history` 内联版）：
 *   内联版数字分支写作 `radius + ' 米'`（带空格），新函数统一为 `'米'`（无空格），
 *   与数组分支 `'2000米'` 的写法一致 ⇒ 故下方 L3 断言 `'1500米'`（非 `'1500 米'`）。
 *   生产两条 INSERT 路径都写 JSON 串，该分支仅在存量/手工数据上可达。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-radius-parity-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

const STORE = '半径口径测试店'
let db, signToken, server, base, uid, token

async function call(p, { token: t } = {}) {
  const headers = {}
  if (t) headers.Authorization = `Bearer ${t}`
  const res = await fetch(base + p, { headers })
  let json = null
  try { json = await res.json() } catch (e) { json = null }
  return { status: res.status, body: json }
}

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  db = dbMod.getDb()
  const { signToken: st } = await import('../src/utils/tokenAuth.js')
  signToken = st

  // ---- 造账号 + 门店（marker）+ 3 条购买记录（覆盖三种 radius 存量形态）----
  uid = db.prepare(
    `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'user')`
  ).run('rp_user', 'rp@test.local', 'x').lastInsertRowid
  token = signToken({ id: uid, username: 'rp_user', role: 'user', token_version: 0 })

  db.prepare(
    `INSERT INTO markers (user_id, name, latitude, longitude, store_type, city, district)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(uid, STORE, 31.23, 121.47, '测试', '上海市', '浦东新区')

  const insP = db.prepare(`
    INSERT INTO purchases
      (user_id, store_name, store_type, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', ?)
  `)
  const payload = (n) => JSON.stringify({ querySuccess: true, apiResult: { 1001: { resident: n } } })
  // L1 单半径 JSON 串（两条 INSERT 路径的真实形态）
  insP.run(uid, STORE, '测试', 121.47, 31.23, JSON.stringify([2000]), '202607', payload(1000))
  // L2 多半径 JSON 串
  insP.run(uid, STORE, '测试', 121.47, 31.23, JSON.stringify([500, 1000]), '202606', payload(900))
  // L3 纯数字（利用 radius 列的 INTEGER 亲和性 → 落库为 number，覆盖数字分支）
  insP.run(uid, STORE, '测试', 121.47, 31.23, '1500', '202605', payload(800))

  const express = (await import('express')).default
  const purchaseRouter = (await import('../src/routes/purchase.js')).default
  const app = express()
  app.use(express.json())
  app.use('/api/purchase', purchaseRouter)
  server = http.createServer(app)
  await new Promise((res) => server.listen(0, '127.0.0.1', res))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

describe('radius_display 口径：/history 与 /by-store 必须一致（v1.13.183）', () => {
  let byHistory = []
  let byStore = []

  it('两个接口都能取到该门店的 3 条记录', async () => {
    const h = await call('/api/purchase/history', { token })
    expect(h.status).toBe(200)
    byHistory = (h.body.purchases || []).filter((p) => p.store_name === STORE)
    expect(byHistory.length).toBe(3)

    const s = await call(`/api/purchase/by-store/${encodeURIComponent(STORE)}`, { token })
    expect(s.status).toBe(200)
    byStore = s.body.purchases || []
    expect(byStore.length).toBe(3)
  })

  it('🔴 逐行对比：两接口的 radius_display 完全相同（本次 bug 的本质）', () => {
    const histMap = new Map(byHistory.map((p) => [p.id, p.radius_display]))
    expect(byStore.length).toBe(histMap.size)
    const mismatched = byStore.filter((p) => p.radius_display !== histMap.get(p.id))
    expect(mismatched).toEqual([])
  })

  it('L1 单半径 JSON 串 → 「2000米」', () => {
    const row = byStore.find((p) => p.radius === '[2000]')
    expect(row).toBeTruthy()
    expect(row.radius_display).toBe('2000米')
  })

  it('L2 多半径 JSON 串 → 「500米, 1000米」', () => {
    const row = byStore.find((p) => p.radius === '[500,1000]')
    expect(row).toBeTruthy()
    expect(row.radius_display).toBe('500米, 1000米')
  })

  it('L3 纯数字（数字分支）→ 「1500米」（有意统一为不带空格，见文件头说明）', () => {
    const row = byStore.find((p) => Number(p.radius) === 1500)
    expect(row).toBeTruthy()
    expect(row.radius_display).toBe('1500米')
  })

  it('回归钉子：任何一条 radius_display 都不含 [ 或 ]，且不为 undefined', () => {
    for (const p of byStore) {
      expect(p.radius_display).toBeTruthy()
      expect(String(p.radius_display)).not.toContain('[')
      expect(String(p.radius_display)).not.toContain(']')
    }
  })

  it('回归钉子：/by-store 必须真的带上 radius_display 字段（曾经缺失）', () => {
    for (const p of byStore) {
      expect(Object.prototype.hasOwnProperty.call(p, 'radius_display')).toBe(true)
    }
  })
})
