/**
 * 自定义可达范围测试 —— v1.13.308
 *
 * 背景：手调过顶点的轮廓刷新即丢（只存在内存里），业主希望存下来下次直接载入。
 * 本批加了 custom_ranges 表 + 4 个接口。
 *
 * 本测试要钉死的不变量（错了都不会报错，只会悄悄放行/串数据）：
 *   A. 免费/试用档一律 403 need_vip —— 保存/载入这条路**不经探测**，
 *      而探测才是签发 scopeId 的地方；一旦放开，5 次/日当场作废。
 *   B. 归属隔离：只能读/删自己的。只按 id 查（不带 user_id）＝ 换个 id 就能读别人的范围。
 *   C. 路由顺序：这 4 个端点必须排在 `GET /:id` 之前，
 *      否则 /custom-ranges 会被当成 shapefileId 吃掉（项目老坑，见记忆铁律）。
 *   D. 输入校验：非 Polygon / 顶点过少 / 名称超长 都要 400，不能半截入库。
 *
 * 方式与 scope.test.js 一致：真起 express（端口 0）+ fetch 打真实 HTTP。
 * 走 R4B_DB_PATH 指向 /tmp 临时库，不碰真实库，不打外网。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')

const tmpDb = path.join(os.tmpdir(), `r4b-crange-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let getDb, server, base, jwtSign
const ids = {}
const tokens = {}

/** 一个合法的方形多边形（上海人民广场附近） */
function square(d = 0.01) {
  return {
    type: 'Polygon',
    coordinates: [[
      [121.47 - d, 31.23 - d],
      [121.47 + d, 31.23 - d],
      [121.47 + d, 31.23 + d],
      [121.47 - d, 31.23 + d],
      [121.47 - d, 31.23 - d]
    ]]
  }
}

async function call(method, p, { token, body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + p, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await res.json() } catch (e) { json = null }
  return { status: res.status, body: json }
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  jwtSign = (payload) => jwt.sign(payload, cfg.JWT_SECRET, { expiresIn: '1h' })

  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb

  const router = (await import('../src/routes/shapefiles.js')).default
  const app = express()
  app.use(express.json({ limit: '50mb' }))
  app.use('/api/shapefiles', router)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`

  const db = getDb()
  const seed = (username, role) => {
    const r = db.prepare(
      `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, 0)`
    ).run(username, `${username}@test.local`, 'x', role)
    return r.lastInsertRowid
  }
  ids.vipA = seed('vipA_cr', 'vip')
  ids.vipB = seed('vipB_cr', 'vip')
  ids.free = seed('free_cr', 'user')
  ids.trial = seed('trial_cr', 'trial')

  // vip 必须让 isVipActive 为真（role=vip 且 vip_until 未过期）
  const far = '2099-12-31'
  db.prepare(`UPDATE users SET vip_until = ? WHERE id IN (?, ?)`).run(far, ids.vipA, ids.vipB)
  db.prepare(`UPDATE users SET vip_until = ? WHERE id = ?`).run(far, ids.trial)

  for (const [k, id] of Object.entries(ids)) {
    const row = db.prepare(`SELECT id, username, role, vip_until FROM users WHERE id = ?`).get(id)
    tokens[k] = jwtSign({ id: row.id, username: row.username, role: row.role })
  }
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
})

describe('A. 免费/试用档必须被拦（403 need_vip）', () => {
  it('免费用户不能保存', async () => {
    const r = await call('POST', '/api/shapefiles/custom-ranges', {
      token: tokens.free,
      body: { name: 'x', mode: 'drive', centerLat: 31.23, centerLng: 121.47, bands: { 10: square() } }
    })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('need_vip')
  })

  it('试用档同样不能保存（trial 按免费计）', async () => {
    const r = await call('POST', '/api/shapefiles/custom-ranges', {
      token: tokens.trial,
      body: { name: 'x', mode: 'drive', centerLat: 31.23, centerLng: 121.47, bands: { 10: square() } }
    })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('need_vip')
  })

  it('免费用户不能列表', async () => {
    const r = await call('GET', '/api/shapefiles/custom-ranges', { token: tokens.free })
    expect(r.status).toBe(403)
  })
})

describe('B. VIP 可保存 / 列表 / 详情 / 删除', () => {
  let savedId = null

  it('保存返回 id', async () => {
    const r = await call('POST', '/api/shapefiles/custom-ranges', {
      token: tokens.vipA,
      body: {
        name: '人民广场 10-15 分钟',
        mode: 'drive',
        centerLat: 31.2304,
        centerLng: 121.4737,
        fieldName: '常住人口',
        bands: { 10: square(), 15: square(0.02) }
      }
    })
    expect(r.status).toBe(200)
    expect(r.body.success).toBe(true)
    expect(r.body.id).toBeGreaterThan(0)
    savedId = r.body.id
  })

  it('列表有这一条，且不回多边形本体', async () => {
    const r = await call('GET', '/api/shapefiles/custom-ranges', { token: tokens.vipA })
    expect(r.status).toBe(200)
    const row = r.body.data.find(x => x.id === savedId)
    expect(row).toBeTruthy()
    expect(row.minutes).toEqual([10, 15])
    // 🔴 列表不能把 bands 带出来：20 个范围 × 每档 720 顶点会撑成 MB 级响应
    expect(row.bands).toBeUndefined()
  })

  it('详情带多边形，两档齐全且首尾闭合', async () => {
    const r = await call('GET', `/api/shapefiles/custom-ranges/${savedId}`, { token: tokens.vipA })
    expect(r.status).toBe(200)
    expect(Object.keys(r.body.data.bands).sort()).toEqual(['10', '15'])
    const ring = r.body.data.bands['10'].coordinates[0]
    expect(ring.length).toBe(5)
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('🔴 另一个 VIP 读不到（只按 id 查就会串数据）', async () => {
    const r = await call('GET', `/api/shapefiles/custom-ranges/${savedId}`, { token: tokens.vipB })
    expect(r.status).toBe(404)
  })

  it('🔴 另一个 VIP 删不掉', async () => {
    const r = await call('DELETE', `/api/shapefiles/custom-ranges/${savedId}`, { token: tokens.vipB })
    expect(r.status).toBe(404)
    // 确认真的还在
    const still = await call('GET', `/api/shapefiles/custom-ranges/${savedId}`, { token: tokens.vipA })
    expect(still.status).toBe(200)
  })

  it('本人可以删', async () => {
    const r = await call('DELETE', `/api/shapefiles/custom-ranges/${savedId}`, { token: tokens.vipA })
    expect(r.status).toBe(200)
    const gone = await call('GET', `/api/shapefiles/custom-ranges/${savedId}`, { token: tokens.vipA })
    expect(gone.status).toBe(404)
  })
})

describe('C. 输入校验（⛔ 不半截入库）', () => {
  const post = (body, token = tokens.vipA) =>
    call('POST', '/api/shapefiles/custom-ranges', { token, body })

  it('名称必填', async () => {
    const r = await post({ name: '  ', mode: 'drive', centerLat: 31.2, centerLng: 121.4, bands: { 10: square() } })
    expect(r.status).toBe(400)
  })

  it('名称超 40 字', async () => {
    const r = await post({ name: 'x'.repeat(41), mode: 'drive', centerLat: 31.2, centerLng: 121.4, bands: { 10: square() } })
    expect(r.status).toBe(400)
  })

  it('bands 不是 Polygon', async () => {
    const r = await post({
      name: 'a', mode: 'drive', centerLat: 31.2, centerLng: 121.4,
      bands: { 10: { type: 'LineString', coordinates: [] } }
    })
    expect(r.status).toBe(400)
  })

  it('顶点少于 4 个', async () => {
    const r = await post({
      name: 'a', mode: 'drive', centerLat: 31.2, centerLng: 121.4,
      bands: { 10: { type: 'Polygon', coordinates: [[[121.4, 31.2], [121.5, 31.3], [121.4, 31.2]]] } }
    })
    expect(r.status).toBe(400)
  })

  it('缺圆心', async () => {
    const r = await post({ name: 'a', mode: 'drive', bands: { 10: square() } })
    expect(r.status).toBe(400)
  })
})

describe('D. 路由顺序守卫（这 4 个端点必须在 GET /:id 之前）', () => {
  it('源码顺序：custom-ranges 出现在 router.get(\'/:id\') 之前', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'backend/src/routes/shapefiles.js'), 'utf8')
    const iCustom = src.indexOf("router.get('/custom-ranges'")
    const iById = src.indexOf("router.get('/:id'")
    expect(iCustom).toBeGreaterThan(0)
    expect(iById).toBeGreaterThan(0)
    expect(
      iCustom,
      'custom-ranges 排到了 GET /:id 后面 —— 会被当成 shapefileId 吃掉（列表查不到、删除删错东西）'
    ).toBeLessThan(iById)
  })
})
