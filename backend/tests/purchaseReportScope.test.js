/**
 * 「报告取数」记录的口径分流守卫 —— v1.13.342
 *
 * 立项背景（业主 2026-11-09 三问之②）：报告里新购买的联通人口会进「购买履历」吗？
 * 会 —— `POST /api/smartsteps/population` 付费成功后在同一事务写 `purchases` 行，
 * `store_type='report'`。但这条记录**不是门店购买**，暴露出三处副作用：
 *   ① `LEFT JOIN markers` 取不到城市/区县/编号（候选点位在独立表 store_candidates）⇒ 订单号退化；
 *   ② `/store-counts` 按 store_name 分组 ⇒ 候选点位被当门店计入 DataView 的购买次数/星级；
 *   ③ `result_data` 只有 1001 ⇒ 详情图表 / 343 指标宽表 / 对比看板大面积空白。
 *
 * 本文件在 **HTTP 层 + 临时真库** 钉死收口结果（不是只扫源码字符串）：
 *   · `/history` 要能看到 report 行（可追溯），但必须标明来源、回填城市、RPT 订单号；
 *   · 所有「按门店」读点必须排除 report 行；
 *   · `/quota` **不排除**（确实扣了 1 次配额，排掉就是少记账）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import {
  REPORT_STORE_TYPE, STORE_ONLY_SQL,
  isReportPurchase, storeTypeLabel, storedServiceCodes
} from '../src/utils/purchaseScope.js'

const tmpDb = path.join(os.tmpdir(), `r4b-report-scope-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const STORE = '口径测试门店'
const CAND = '五角场万达3F候选点'
let db, signToken, server, base, uid, token
let storePurchaseId, reportId, sameNameReportId

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
  const { signToken: st } = await import('../src/utils/tokenAuth.js')
  signToken = st

  uid = db.prepare(
    `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'user')`
  ).run('rpt_scope_user', 'rpt_scope@test.local', 'x').lastInsertRowid
  token = signToken({ id: uid, username: 'rpt_scope_user', role: 'user', token_version: 0 })

  // 已登记门店（markers 里才有 city / district / store_code）
  db.prepare(
    `INSERT INTO markers (user_id, name, latitude, longitude, store_type, city, district, store_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid, STORE, 31.30, 121.51, '已开业', '上海市', '杨浦区', 'SH001')

  // 候选点位在**独立表**，不在 markers（这正是副作用①的根因）
  db.prepare(
    `INSERT INTO store_candidates (user_id, name, city, district, latitude, longitude, radius, stage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid, CAND, '上海市', '杨浦区', 31.301, 121.511, 1000, '待评估')

  const insP = db.prepare(`
    INSERT INTO purchases
      (user_id, store_name, store_type, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', ?)
  `)
  const fullResult = JSON.stringify({ querySuccess: true, apiResult: { 1001: { p1_sum: 100 }, 1002: [] } })
  const reportResult = JSON.stringify({ querySuccess: true, apiResult: { 1001: { p1_sum: 100 } }, refunded: false })

  storePurchaseId = insP.run(uid, STORE, '已开业', 121.51, 31.30, '[1000]', '202609', fullResult).lastInsertRowid
  reportId = insP.run(uid, CAND, REPORT_STORE_TYPE, 121.511, 31.301, '[1000]', '202609', reportResult).lastInsertRowid
  // 🔴 关键反例：与门店**同名**的 report 行 —— 若门店口径没排除，会被算成第 2 次购买
  sameNameReportId = insP.run(uid, STORE, REPORT_STORE_TYPE, 121.51, 31.30, '[3000]', '202609', reportResult).lastInsertRowid

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

describe('A. 单一口径工具（纯函数）', () => {
  it('report 判型与展示文案', () => {
    expect(isReportPurchase('report')).toBe(true)
    expect(isReportPurchase('REPORT')).toBe(false)
    expect(isReportPurchase(null)).toBe(false)
    expect(storeTypeLabel('report')).toBe('报告取数')
    expect(storeTypeLabel('已开业')).toBe('已开业')
  })

  it('🔴 门店口径 SQL 必须带 p. 别名（JOIN markers 时裸列名会歧义）、且不放走存量空值', () => {
    expect(STORE_ONLY_SQL).toContain('p.store_type')
    expect(STORE_ONLY_SQL).toContain('IS NULL OR')
    expect(STORE_ONLY_SQL).toContain("'report'")
  })

  it('服务码解析兼容三种外壳', () => {
    expect(storedServiceCodes({ apiResult: { 1001: {}, 1002: [] } })).toEqual(['1001', '1002'])
    expect(storedServiceCodes({ 1001: {} })).toEqual(['1001'])
    expect(storedServiceCodes(JSON.stringify({ apiResult: { 1001: {} } }))).toEqual(['1001'])
    expect(storedServiceCodes([{ service_code: '1001' }])).toEqual(['1001'])
    expect(storedServiceCodes('not json')).toEqual([])
    expect(storedServiceCodes(null)).toEqual([])
  })
})

describe('B. /history：report 行可见且标注来源（⛔ 不许排除）', () => {
  it('三条记录都在，report 行带 is_report / 中文类型 / RPT 订单号', async () => {
    const r = await call('/api/purchase/history', { token })
    expect(r.status).toBe(200)
    const list = r.body.purchases || []
    expect(list.length).toBe(3)

    const rep = list.find((x) => x.id === reportId)
    expect(rep).toBeTruthy()
    expect(rep.is_report).toBe(true)
    expect(rep.store_type_label).toBe('报告取数')
    expect(rep.order_no).toMatch(/^RPT\d{8}\d{3}$/)
    expect(rep.source_note).toContain('1001')

    const store = list.find((x) => x.id === storePurchaseId)
    expect(store.is_report).toBe(false)
    expect(store.store_type_label).toBe('已开业')
  })

  it('🔴 副作用①：候选点位的城市/区县从 store_candidates 回填，不再是空', async () => {
    const r = await call('/api/purchase/history', { token })
    const rep = (r.body.purchases || []).find((x) => x.id === reportId)
    expect(rep.city).toBe('上海市')
    expect(rep.district).toBe('杨浦区')
  })

  it('🔴 同名的 report 行不许顶掉门店行，也不许把履历放大成多行', async () => {
    const r = await call('/api/purchase/history', { token })
    const list = r.body.purchases || []
    expect(list.length).toBe(3)
    expect(list.filter((x) => x.store_name === STORE).length).toBe(2)
  })
})

describe('C. 门店口径读点必须排除 report（副作用②）', () => {
  it('🔴 /store-counts：同名 report 行不许虚增门店购买次数', async () => {
    const r = await call('/api/purchase/store-counts', { token })
    expect(r.status).toBe(200)
    const counts = r.body.counts || {}
    expect(counts[STORE].count).toBe(1)          // 若没排除 ⇒ 2
    expect(counts[CAND]).toBeUndefined()          // 候选点位根本不该出现在门店计数里
    expect(Object.keys(counts)).toEqual([STORE])
  })

  it('🔴 /by-store：门店弹窗「已购报表」只回门店那条', async () => {
    const r = await call(`/api/purchase/by-store/${encodeURIComponent(STORE)}`, { token })
    expect(r.status).toBe(200)
    const list = r.body.purchases || []
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(storePurchaseId)
  })

  it('🔴 /quota 不排除：三条都扣了配额，必须照实记账', async () => {
    const r = await call('/api/purchase/quota', { token })
    expect(r.status).toBe(200)
    expect(r.body.used).toBe(3)
  })
})

describe('D. /:id 详情：说明「只有 1001」，而不是让用户以为报表坏了（副作用③）', () => {
  it('report 详情回传 is_report / services / source_note，并回填城市', async () => {
    const r = await call(`/api/purchase/${reportId}`, { token })
    expect(r.status).toBe(200)
    expect(r.body.is_report).toBe(true)
    expect(r.body.store_type_label).toBe('报告取数')
    expect(r.body.services).toEqual(['1001'])
    expect(r.body.source_note).toContain('1001')
    expect(r.body.city).toBe('上海市')
    expect(r.body.district).toBe('杨浦区')
  })

  it('门店详情不受影响：is_report=false、服务码含 1002', async () => {
    const r = await call(`/api/purchase/${storePurchaseId}`, { token })
    expect(r.status).toBe(200)
    expect(r.body.is_report).toBe(false)
    expect(r.body.services).toEqual(['1001', '1002'])
    expect(r.body.city).toBe('上海市')
  })

  it('同名的 report 详情也能打开（不因排除口径而 404）', async () => {
    const r = await call(`/api/purchase/${sameNameReportId}`, { token })
    expect(r.status).toBe(200)
    expect(r.body.is_report).toBe(true)
  })
})

describe('E. 源码守卫：判据只有一份，且分流位置正确', () => {
  const P = read('backend/src/routes/purchase.js')
  const block = (from, to) => {
    const i = P.indexOf(from)
    expect(i, `找不到 ${from}`).toBeGreaterThan(-1)
    const j = P.indexOf(to, i)
    return P.slice(i, j > i ? j : i + 4000)
  }

  it('三处门店口径读点都引用 STORE_ONLY_SQL', () => {
    for (const [from, to] of [
      ["router.get('/store-counts'", "router.get('/by-store/"],
      ["router.get('/by-store/", '/**\n * 批量导出为 ZIP'],
      ["router.post('/export-merged'", 'export default router']
    ]) {
      const seg = block(from, to)
      expect(seg, `${from} 必须排除 report`).toContain('STORE_ONLY_SQL')
      // ⚠️ 没有 p 别名 ⇒ /by-store 的 JOIN 会让裸 store_type 变成 ambiguous 而 500
      expect(seg, `${from} 必须用 p 别名`).toContain('FROM purchases p')
    }
  })

  it('🔴 /history 与 /quota 不许引用 STORE_ONLY_SQL（履历可追溯、配额照实记账）', () => {
    expect(block("router.get('/history'", "router.get('/visible-scope'")).not.toContain('STORE_ONLY_SQL')
    expect(block("router.get('/quota'", "router.get('/quota-history'")).not.toContain('STORE_ONLY_SQL')
  })

  it('🔴 不许在 purchase.js 里就地写死 report 字面量（判据必须走 util）', () => {
    expect(P).not.toContain("store_type = 'report'")
    expect(P).not.toContain("store_type <> 'report'")
  })

  it('前端两处履历/导出弹窗都要渲染 is_report 标识', () => {
    const A = read('frontend/src/views/MyAccountView.vue')
    const B = read('frontend/src/views/MainLayout.vue')
    expect(A).toContain('row.is_report')
    expect(A).toContain('currentDetail?.is_report')
    expect(B).toContain('row.is_report')
  })
})
