/**
 * 批量补「门店区分」接口守卫（v1.13.294）
 *
 * 被测：`POST /api/markers/bulk-category`
 *
 * 为什么单独钉这一组：这是本系统**第一个能一次改几百行**的门店写接口。
 * 写错了不是「显示不对」，而是客户 200 多家门店的字段被批量刷错，
 * 且没有任何报错 —— 事后只能靠备份回滚。所以这几条必须由测试兜住：
 *
 *   ① **只能改自己名下**：别人账号的 id 混进来既不能报错中断整批，也绝不能被改；
 *   ② **集团下发的只读镜像行**（sync_readonly=1）跳过并计数，不整批 403
 *      （批量里混几十家镜像行很常见，一刀切拒绝用户无从下手）；
 *      但若目标**全是**只读行 ⇒ 403 + code=sync_readonly（与单店语义一致）；
 *   ③ **已合并行**（merged_into 非空）不能被改 —— 它在界面上已不可见；
 *   ④ **不允许把品类刷成空**（本接口只用于「补」，清空走单店编辑）；
 *   ⑤ **只改差异行**：已经是目标值的跳过，不白刷 updated_at（否则增量同步全量误报）；
 *   ⑥ 上限 500，超了直接 400（防止一次误操作整库）。
 *
 * 方式与 scope.test.js 一致：R4B_DB_PATH 指临时库 + 真起 express + fetch 打真实 HTTP。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const tmpDb = path.join(os.tmpdir(), `r4b-bulkcat-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let getDb, server, base, jwtSign
let tokenA, tokenB
let uidA, uidB
const rowIds = {}

function call(method, p, { token, body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
    .then(async (res) => {
      let json = null
      try { json = await res.json() } catch (e) { json = null }
      return { status: res.status, body: json }
    })
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  jwtSign = (payload) => jwt.sign(payload, cfg.JWT_SECRET, { expiresIn: '1h' })

  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  const markersRouter = (await import('../src/routes/markers.js')).default

  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use('/api/markers', markersRouter)
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`

  const db = getDb()
  const cols = db.prepare('PRAGMA table_info(markers)').all().map((c) => c.name)
  const ensure = (name, ddl) => { if (!cols.includes(name)) db.run(`ALTER TABLE markers ADD COLUMN ${ddl}`) }
  ensure('sync_readonly', 'sync_readonly INTEGER DEFAULT 0')
  ensure('merged_into', 'merged_into INTEGER')
  ensure('origin_owner', 'origin_owner TEXT')
  ensure('origin_user_id', 'origin_user_id INTEGER')

  const seedUser = (username) => db.prepare(
    `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`
  ).run(username, `${username}@test.local`, 'x', 'user', 0).lastInsertRowid
  uidA = seedUser('bulkcat_a')
  uidB = seedUser('bulkcat_b')
  tokenA = jwtSign({ id: uidA, username: 'bulkcat_a', role: 'user' })
  tokenB = jwtSign({ id: uidB, username: 'bulkcat_b', role: 'user' })

  const ins = db.prepare(
    `INSERT INTO markers (name, latitude, longitude, user_id, store_category, sync_readonly, merged_into, origin_owner)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const mk = (key, uid, { cat = null, readonly = 0, merged = null, owner = null } = {}) => {
    rowIds[key] = ins.run(`店-${key}`, 31.23, 121.47, uid, cat, readonly, merged, owner).lastInsertRowid
  }
  mk('a1', uidA)
  mk('a2', uidA)
  mk('a3', uidA, { cat: '商场店' })                  // 已有值：用于验证「只改差异行」
  mk('aReadonly', uidA, { readonly: 1, owner: '集团总部' })
  mk('aMerged', uidA, { merged: 1 })                 // 已合并：不可改
  mk('b1', uidB)                                     // 别人的店
  db.saveNow && db.saveNow()
})

afterAll(async () => {
  await new Promise((r) => server.close(r))
  try { fs.unlinkSync(tmpDb) } catch (e) { /* 忽略 */ }
})

async function catOf(id) {
  return getDb().prepare('SELECT store_category, sync_readonly, merged_into FROM markers WHERE id = ?').get(id)
}

describe('批量补门店区分', () => {
  it('正常批量：改到自己的店，返回 updated 数', async () => {
    const res = await call('POST', '/api/markers/bulk-category', {
      token: tokenA,
      body: { ids: [rowIds.a1, rowIds.a2], storeCategory: '临街店' }
    })
    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(2)
    expect(res.body.skippedReadonly).toBe(0)
    expect((await catOf(rowIds.a1)).store_category).toBe('临街店')
    expect((await catOf(rowIds.a2)).store_category).toBe('临街店')
  })

  it('别人的门店：计数为 notFound，且**绝不能被改**', async () => {
    const res = await call('POST', '/api/markers/bulk-category', {
      token: tokenA,
      body: { ids: [rowIds.b1, rowIds.a1], storeCategory: '社区店' }
    })
    expect(res.status).toBe(200)
    expect(res.body.notFound).toBe(1)       // b1 不属于 A
    expect(res.body.updated).toBe(1)        // 只有 a1
    expect((await catOf(rowIds.b1)).store_category).toBeNull()
    expect((await catOf(rowIds.a1)).store_category).toBe('社区店')
  })

  it('只读镜像行：跳过并计数，同批里可写的照常改', async () => {
    const res = await call('POST', '/api/markers/bulk-category', {
      token: tokenA,
      body: { ids: [rowIds.aReadonly, rowIds.a2], storeCategory: '写字楼店' }
    })
    expect(res.status).toBe(200)
    expect(res.body.skippedReadonly).toBe(1)
    expect(res.body.updated).toBe(1)
    expect((await catOf(rowIds.aReadonly)).store_category).toBeNull()
    expect((await catOf(rowIds.a2)).store_category).toBe('写字楼店')
  })

  it('目标全是只读行 ⇒ 403 + code=sync_readonly（与单店语义一致）', async () => {
    const res = await call('POST', '/api/markers/bulk-category', {
      token: tokenA,
      body: { ids: [rowIds.aReadonly], storeCategory: '商场店' }
    })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('sync_readonly')
    expect(String(res.body.message)).toContain('集团总部')
  })

  it('已合并行不能被改（界面上已不可见）', async () => {
    const res = await call('POST', '/api/markers/bulk-category', {
      token: tokenA,
      body: { ids: [rowIds.aMerged], storeCategory: '景区店' }
    })
    expect(res.status).toBe(404)
    expect((await catOf(rowIds.aMerged)).store_category).toBeNull()
  })

  it('只改差异行：值已相同的跳过，不白刷 updated_at', async () => {
    const res = await call('POST', '/api/markers/bulk-category', {
      token: tokenA,
      body: { ids: [rowIds.a3, rowIds.a1], storeCategory: '商场店' }
    })
    expect(res.status).toBe(200)
    expect(res.body.unchanged).toBe(1)   // a3 本来就是商场店
    expect(res.body.updated).toBe(1)     // a1 是社区店 → 商场店
  })

  it('⛔ 不允许把品类刷成空（本接口只用于补，清空走单店编辑）', async () => {
    const res = await call('POST', '/api/markers/bulk-category', {
      token: tokenA,
      body: { ids: [rowIds.a1], storeCategory: '   ' }
    })
    expect(res.status).toBe(400)
    expect((await catOf(rowIds.a1)).store_category).toBe('商场店')  // 未被清空
  })

  it('超过 500 家直接 400（防一次误操作整库）', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => 900000 + i)
    const res = await call('POST', '/api/markers/bulk-category', {
      token: tokenA,
      body: { ids, storeCategory: '社区店' }
    })
    expect(res.status).toBe(400)
    expect(String(res.body.message)).toContain('500')
  })

  it('未登录 401', async () => {
    const res = await call('POST', '/api/markers/bulk-category', {
      body: { ids: [rowIds.a1], storeCategory: '社区店' }
    })
    expect(res.status).toBe(401)
  })

  it('B 账号看不到 A 的任何改动（user_id 过滤写死在 SQL 里）', async () => {
    const res = await call('POST', '/api/markers/bulk-category', {
      token: tokenB,
      body: { ids: [rowIds.a1], storeCategory: '校园店' }
    })
    expect(res.status).toBe(404)
    expect((await catOf(rowIds.a1)).store_category).toBe('商场店')
  })
})

describe('源码口径（防后续重构把约束写丢）', () => {
  const src = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/routes/markers.js'),
    'utf8'
  )
  const slice = (() => {
    const i = src.indexOf("router.post('/bulk-category'")
    expect(i).toBeGreaterThan(-1)
    const rest = src.slice(i)
    const next = rest.search(/\nrouter\.(get|post|put|delete)\(/)
    const body = next > 0 ? rest.slice(0, next) : rest
    // 剥整行注释：注释里引用了同样的 SQL 片段，不剥会把注释当实现
    return body.split('\n').filter((l) => {
      const s = l.trim()
      return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*'))
    }).join('\n')
  })()

  it('SELECT 与 UPDATE 都必须带 user_id 过滤', () => {
    const selects = slice.match(/FROM markers[\s\S]{0,200}?user_id = \?/g) || []
    expect(selects.length, '查询没有 user_id 过滤 = 能改别人的店').toBeGreaterThan(0)
    expect(slice).toMatch(/UPDATE markers[\s\S]{0,200}?user_id = \?/)
  })

  it('必须排除已合并行，并在 UPDATE 侧再拦一次只读行', () => {
    expect(slice).toMatch(/merged_into IS NULL/)
    expect(slice).toMatch(/sync_readonly <> 1|sync_readonly != 1/)
  })

  it('路由必须定义在 GET /:id 之前（否则先被参数路由吃掉）', () => {
    const bulk = src.indexOf("router.post('/bulk-category'")
    const byId = src.indexOf("router.get('/:id'")
    expect(bulk).toBeGreaterThan(-1)
    expect(byId).toBeGreaterThan(-1)
    expect(bulk).toBeLessThan(byId)
  })
})
