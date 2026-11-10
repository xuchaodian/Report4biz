/**
 * v1.13.345：购买履历「周边竞品」按门店自有品牌收窄 —— HTTP 真库行为守卫
 *
 * 静态守卫只能证明接了线，本文件证明三件事：
 *   ① /purchase/:id/competitors-for-map 真的按品牌过滤（未配置仍全量）；
 *   ② 显式空集 ⇒ 0 家，⛔ 绝不退化成全量；
 *   ③ 品牌来自**该购买记录的门店**（store_name → markers.brand），
 *      而不是请求参数或登录账号 —— 两条记录分属两个品牌时必须各取各的集合。
 *
 * 与 export_excel.py 的关系：脚本走同一套 SQL 口径（store_name→markers.brand→
 * scope 头表→map 明细），脚本侧的三态已在生产库副本上用真实 xlsx 演练过，
 * 这里钉死 Node 侧同源实现。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-report-scope-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let db, server, base, token, uid, otherUid, pA, pB, pUnknown, pOther

async function call(p, { token: t, method = 'GET' } = {}) {
  const headers = {}
  if (t) headers.Authorization = `Bearer ${t}`
  const res = await fetch(base + p, { method, headers })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, body: json }
}

const brandsOf = (r) => (r.body?.competitors || []).map((c) => String(c.brand || '').trim()).sort()

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  db = dbMod.getDb()
  const { signToken } = await import('../src/utils/tokenAuth.js')

  const insUser = db.prepare(
    `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'user')`
  )
  uid = insUser.run('rpt_scope_user', 'rs@test.local', 'x').lastInsertRowid
  otherUid = insUser.run('rpt_scope_other', 'rso@test.local', 'x').lastInsertRowid
  token = signToken({ id: uid, username: 'rpt_scope_user', role: 'user', token_version: 0 })

  // 两个自有品牌，各自一家门店
  const insM = db.prepare(
    `INSERT INTO markers (user_id, name, brand, latitude, longitude, store_type) VALUES (?, ?, ?, ?, ?, '已开业')`
  )
  insM.run(uid, '甲品牌A店', '甲品牌', 31.30, 121.51)
  insM.run(uid, '乙品牌B店', '乙品牌', 31.31, 121.52)

  // 竞品 4 行：X 两行、Y 一行、Z 一行（Z 不属于任何品牌集合，用来验证收窄真的排除了它）
  const insC = db.prepare(
    `INSERT INTO competitors (user_id, name, brand, latitude, longitude, status) VALUES (?, ?, ?, ?, ?, '正常营业')`
  )
  insC.run(uid, 'X1', 'X品牌', 31.3001, 121.5101)
  insC.run(uid, 'X2', ' X品牌 ', 31.3002, 121.5102)
  insC.run(uid, 'Y1', 'Y品牌', 31.3101, 121.5201)
  insC.run(uid, 'Z1', 'Z品牌', 31.3003, 121.5103)
  insC.run(otherUid, '别人的', 'X品牌', 31.3004, 121.5104)

  const insP = db.prepare(
    `INSERT INTO purchases (user_id, store_name, store_type, center_lat, center_lng, radius, city_month, result_data, status)
     VALUES (?, ?, '已开业', ?, ?, '[1000]', '202610', '{}', 'active')`
  )
  pA = insP.run(uid, '甲品牌A店', 31.30, 121.51).lastInsertRowid
  pB = insP.run(uid, '乙品牌B店', 31.31, 121.52).lastInsertRowid
  pUnknown = insP.run(uid, '门店库里没有这家店', 31.30, 121.51).lastInsertRowid
  pOther = insP.run(otherUid, '甲品牌A店', 31.30, 121.51).lastInsertRowid

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
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
})

function setScope(myBrand, list) {
  db.prepare('DELETE FROM brand_competitor_map WHERE user_id = ? AND my_brand = ?').run(uid, myBrand)
  db.prepare('DELETE FROM brand_competitor_scope WHERE user_id = ? AND my_brand = ?').run(uid, myBrand)
  if (list === null) return // 未配置
  db.prepare('INSERT INTO brand_competitor_scope (user_id, my_brand) VALUES (?, ?)').run(uid, myBrand)
  for (const b of list) {
    db.prepare('INSERT INTO brand_competitor_map (user_id, my_brand, competitor_brand) VALUES (?, ?, ?)').run(uid, myBrand, b)
  }
}

describe('A. 未配置 ⇒ 全量（老行为不变）', () => {
  it('A1 未配置时返回账号全部在用竞品 4 家，且不含他人竞品', async () => {
    setScope('甲品牌', null)
    const r = await call(`/api/purchase/${pA}/competitors-for-map`, { token })
    expect(r.status).toBe(200)
    expect(r.body.competitors.length).toBe(4)
    expect(brandsOf(r)).toEqual(['X品牌', 'X品牌', 'Y品牌', 'Z品牌'])
  })

  it('A2 门店名在 markers 里查不到 ⇒ 安全回退全量（不得报错/空列表）', async () => {
    setScope('甲品牌', ['X品牌'])
    const r = await call(`/api/purchase/${pUnknown}/competitors-for-map`, { token })
    expect(r.status).toBe(200)
    expect(r.body.competitors.length).toBe(4)
  })
})

describe('B. 已配置 ⇒ 按门店品牌收窄', () => {
  it('B1 甲品牌→X品牌：只剩 2 行，Z/Y 被排除', async () => {
    setScope('甲品牌', ['X品牌'])
    const r = await call(`/api/purchase/${pA}/competitors-for-map`, { token })
    expect(r.status).toBe(200)
    expect(r.body.competitors.length).toBe(2)
    expect(brandsOf(r)).toEqual(['X品牌', 'X品牌'])
  })

  it('B2 同一账号两条记录分属两个品牌：各取各的集合（证明按 store_name 反查）', async () => {
    setScope('甲品牌', ['X品牌'])
    setScope('乙品牌', ['Y品牌'])
    const ra = await call(`/api/purchase/${pA}/competitors-for-map`, { token })
    const rb = await call(`/api/purchase/${pB}/competitors-for-map`, { token })
    expect(brandsOf(ra)).toEqual(['X品牌', 'X品牌'])
    expect(brandsOf(rb)).toEqual(['Y品牌'])
  })
})

describe('C. 显式空集 ⇒ 0 家（⛔ 不得退化成全量）', () => {
  it('C1 甲品牌配了空集：返回 0 家', async () => {
    setScope('甲品牌', [])
    const r = await call(`/api/purchase/${pA}/competitors-for-map`, { token })
    expect(r.status).toBe(200)
    expect(r.body.competitors.length).toBe(0)
  })

  it('C2 空集只影响该品牌，乙品牌仍按自己的集合返回', async () => {
    const r = await call(`/api/purchase/${pB}/competitors-for-map`, { token })
    expect(brandsOf(r)).toEqual(['Y品牌'])
  })
})

describe('D. 越权与隔离', () => {
  it('D1 他人的购买记录不可读（404）', async () => {
    const r = await call(`/api/purchase/${pOther}/competitors-for-map`, { token })
    expect(r.status).toBe(404)
  })

  it('D2 未登录 401', async () => {
    const r = await call(`/api/purchase/${pA}/competitors-for-map`, {})
    expect(r.status).toBe(401)
  })
})
