/**
 * 自有品牌 → 竞品品牌集合：HTTP 层 + 临时真库行为守卫（v1.13.344）
 *
 * 静态源码守卫只能证明「接了线」，本文件证明 SQL 真的过滤、以及三条兜底语义：
 *   · 未配置 / 品牌不属于该账号 ⇒ 全量（老行为逐字节不变）
 *   · 已配置但集合为空 ⇒ 0 家，⛔ 绝不退化成全量（否则「无竞品」会被判绿灯）
 *   · 同一竞品品牌可配给多个自有品牌；竞品点位只存一份
 * 顺带钉死：写接口未登录 401、品牌不属于账号 400、跨账号竞品不可见。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-brand-scope-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let db, server, base, uid, otherUid, token

async function call(p, { token: t, method = 'GET', body } = {}) {
  const headers = {}
  if (t) headers.Authorization = `Bearer ${t}`
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + p, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, body: json }
}

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  db = dbMod.getDb()
  const { signToken } = await import('../src/utils/tokenAuth.js')

  const insUser = db.prepare(
    `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'user')`
  )
  uid = insUser.run('brand_scope_user', 'bs@test.local', 'x').lastInsertRowid
  otherUid = insUser.run('brand_scope_other', 'bso@test.local', 'x').lastInsertRowid
  token = signToken({ id: uid, username: 'brand_scope_user', role: 'user', token_version: 0 })

  // 三个自有品牌：两个配竞品、第三个配「显式空集」
  const insM = db.prepare(
    `INSERT INTO markers (user_id, name, brand, latitude, longitude, store_type) VALUES (?, ?, ?, ?, ?, '已开业')`
  )
  insM.run(uid, '滨寿司A店', '滨寿司', 31.30, 121.51)
  insM.run(uid, '食其家A店', '食其家', 31.31, 121.52)
  insM.run(uid, '小山宗A店', '小山宗', 31.32, 121.53)

  // 竞品 4 行（3 个竞品品牌）+ 另一账号 1 行（验证隔离没被破坏）
  const insC = db.prepare(
    `INSERT INTO competitors (user_id, name, brand, latitude, longitude, status) VALUES (?, ?, ?, ?, ?, '正常营业')`
  )
  insC.run(uid, '老乡鸡1', '老乡鸡', 31.301, 121.511)
  insC.run(uid, '老乡鸡2', ' 老乡鸡 ', 31.302, 121.512) // 前后空格：归一后仍应命中
  insC.run(uid, '大米先生1', '大米先生', 31.303, 121.513)
  insC.run(uid, '鱼跃1', '鱼跃', 31.304, 121.514)
  insC.run(otherUid, '别人的竞品', '西塔老太太', 31.305, 121.515)

  const express = (await import('express')).default
  const competitorsRouter = (await import('../src/routes/competitors.js')).default
  const mapRouter = (await import('../src/routes/brand-competitor-map.js')).default
  const app = express()
  app.use(express.json())
  app.use('/api/competitors', competitorsRouter)
  app.use('/api/brand-competitor-map', mapRouter)
  server = http.createServer(app)
  await new Promise((res) => server.listen(0, '127.0.0.1', res))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
})

describe('A. 未配置＝全量（上线零风险）', () => {
  it('A1 映射元数据给出全部自有品牌，且 configured=false', async () => {
    const r = await call('/api/brand-competitor-map', { token })
    expect(r.status).toBe(200)
    expect(r.body.myBrands).toEqual(['小山宗', '滨寿司', '食其家'])
    expect(r.body.brandScope.configured).toBe(false)
  })

  it('A2 未配置时 GET /competitors 仍是账号全量 4 家，且不含别人的竞品', async () => {
    const r = await call('/api/competitors', { token })
    expect(r.status).toBe(200)
    expect(r.body.competitors.length).toBe(4)
    expect(r.body.competitors.some(c => c.brand === '西塔老太太')).toBe(false)
    expect(r.body.brandScope.brandScope.configured).toBe(false)
  })

  it('A3 乱传不存在的品牌 ⇒ 退回全量（⛔ 不能落到「显式空集」）', async () => {
    const r = await call('/api/competitors?myBrand=' + encodeURIComponent('不存在的品牌'), { token })
    expect(r.body.competitors.length).toBe(4)
  })

  it('A4 写接口未登录必须 401', async () => {
    const r = await call('/api/brand-competitor-map', {
      method: 'PUT', body: { myBrand: '滨寿司', competitorBrands: ['老乡鸡'] }
    })
    expect(r.status).toBe(401)
  })

  it('A5 配置不属于该账号的品牌必须 400', async () => {
    const r = await call('/api/brand-competitor-map', {
      token, method: 'PUT', body: { myBrand: '星巴克', competitorBrands: ['老乡鸡'] }
    })
    expect(r.status).toBe(400)
  })
})

describe('B. 配置后按自有品牌分池', () => {
  it('B1 滨寿司 → [老乡鸡]：列表只剩 2 家，且空格写法也命中（归一）', async () => {
    const w = await call('/api/brand-competitor-map', {
      token, method: 'PUT', body: { myBrand: '滨寿司', competitorBrands: ['老乡鸡'] }
    })
    expect(w.status).toBe(200)
    const r = await call('/api/competitors?myBrand=' + encodeURIComponent('滨寿司'), { token })
    expect(r.status).toBe(200)
    expect(r.body.competitors.length).toBe(2)
    expect(r.body.competitors.every(c => String(c.brand).trim() === '老乡鸡')).toBe(true)
    expect(r.body.brandScope.brandScope.configured).toBe(true)
  })

  it('B2 食其家 → [大米先生]：同账号另一品牌拿到另一套竞品', async () => {
    await call('/api/brand-competitor-map', {
      token, method: 'PUT', body: { myBrand: '食其家', competitorBrands: ['大米先生'] }
    })
    const r = await call('/api/competitors?myBrand=' + encodeURIComponent('食其家'), { token })
    expect(r.body.competitors.length).toBe(1)
    expect(r.body.competitors[0].brand).toBe('大米先生')
  })

  it('B3 显式空集 ≠ 全量：小山宗配 [] ⇒ 0 家（⛔ 不许变绿灯）', async () => {
    await call('/api/brand-competitor-map', {
      token, method: 'PUT', body: { myBrand: '小山宗', competitorBrands: [] }
    })
    const r = await call('/api/competitors?myBrand=' + encodeURIComponent('小山宗'), { token })
    expect(r.body.competitors.length).toBe(0)
    expect(r.body.brandScope.brandScope.configured).toBe(true)
  })

  it('B4 不传 myBrand 仍是全量 4 家（其它页面零改动）', async () => {
    const r = await call('/api/competitors', { token })
    expect(r.body.competitors.length).toBe(4)
  })

  it('B5 同一竞品品牌可配给多个自有品牌，点位不复制', async () => {
    await call('/api/brand-competitor-map', {
      token, method: 'PUT', body: { myBrand: '食其家', competitorBrands: ['老乡鸡', '大米先生'] }
    })
    const a = await call('/api/competitors?myBrand=' + encodeURIComponent('滨寿司'), { token })
    const b = await call('/api/competitors?myBrand=' + encodeURIComponent('食其家'), { token })
    expect(a.body.competitors.length).toBe(2)
    expect(b.body.competitors.length).toBe(3)
    const total = await call('/api/competitors', { token })
    expect(total.body.competitors.length).toBe(4) // 竞品点位始终只存一份
  })
})

describe('C. P1 导出与空间查询同口径', () => {
  it('C1 /export 按 myBrand 过滤（res 仍是裸数组）', async () => {
    const r = await call('/api/competitors/export?myBrand=' + encodeURIComponent('滨寿司'), { token })
    expect(r.status).toBe(200)
    expect(Array.isArray(r.body)).toBe(true)
    expect(r.body.length).toBe(2)
  })

  it('C2 /query/bounds 按 myBrand 过滤', async () => {
    const q = 'north=32&south=30&east=122&west=121&myBrand=' + encodeURIComponent('滨寿司')
    const r = await call('/api/competitors/query/bounds?' + q, { token })
    expect(r.status).toBe(200)
    expect(r.body.count).toBe(2)
  })

  it('C3 /query/bounds 在显式空集下返回 0 家', async () => {
    const q = 'north=32&south=30&east=122&west=121&myBrand=' + encodeURIComponent('小山宗')
    const r = await call('/api/competitors/query/bounds?' + q, { token })
    expect(r.body.count).toBe(0)
  })
})

describe('D. 可逆：取消配置即回到全量老口径', () => {
  it('D1 DELETE 后 brandScope.configured=false 且列表回到 4 家', async () => {
    const d = await call('/api/brand-competitor-map?myBrand=' + encodeURIComponent('滨寿司'), { token, method: 'DELETE' })
    expect(d.status).toBe(200)
    const r = await call('/api/competitors?myBrand=' + encodeURIComponent('滨寿司'), { token })
    expect(r.body.competitors.length).toBe(4)
    expect(r.body.brandScope.brandScope.configured).toBe(false)
  })
})
