/**
 * 立项报告「只读已购联通人口」—— 批次 413
 *
 * ── 业主原话（2026-11-24）────────────────────────────────────────────────
 * 「立项报告这块，我觉得要重新设计一下了。首先大前提是在『初步分析』中购买了联通配额
 *  之后才使用『生成立项报告』。然后立项报告不要固定为 1/3/5km，以实际购买的联通人口
 *  半径为基础来生成」
 * 两个分叉的拍板：① 多档呈现＝**多档并列对比** ② 初步分析买完＝**加直达按钮**
 *
 * ── 这次改的是**安全边界**，不是样式 ──────────────────────────────────────
 * 旧实现（341~412）让报告弹窗自己 `POST /api/smartsteps/population`：
 *   · 报告能自己花钱，护栏只剩「用户点了按钮」这种前端自觉；
 *   · 半径写死 1/3/5km，而初步分析能买 0.35~5km 任意档 ⇒ 买的 1.5km 在报告里选不出来。
 * 413 起报告侧的取数链路**整条删除**，只 `GET /api/candidates/purchased-population`。
 * 🔴 所以本文件的核心是 A/B 两组：
 *   A. 该端点必须**零副作用、零费用**（跑完库里的 purchases / admin_quota / candidate_notes 一字不变）
 *   B. 它回的档位必须与取数侧 `fetchPointPopulation` 的复用判据**逐关一致**
 *      （账号 / active / 10m / 含 1001），少一关就会「报告说有数据、真取数又扣钱」。
 *
 * 环境手法与 candidateBriefCompare.test.js 同源：真 express + 临时库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
// 🔴 必须**第一个 import**：ESM 静态 import 先于模块体执行（见 _tmpDbEnv.mjs 的说明）
import { tmpDb, tmpGeo, cleanupTmpEnv } from './_tmpDbEnv.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildReportModel } from '../../frontend/src/utils/candidateReport.js'

let server, token, userId, otherId
let getDb

const CITY = '测试市'
const PT = { lng: 121.4300, lat: 31.1950 }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

function call(method, p, body, tk = token) {
  return new Promise((resolve) => {
    const data = body !== undefined ? JSON.stringify(body) : null
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.address().port,
        path: p,
        method,
        headers: {
          ...(tk ? { Authorization: `Bearer ${tk}` } : {}),
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
        }
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => { raw += c })
        res.on('end', () => {
          let json = null
          try { json = JSON.parse(raw) } catch { json = null }
          resolve({ status: res.statusCode, body: json, raw })
        })
      }
    )
    req.on('error', () => resolve({ status: 0, body: null, raw: '' }))
    if (data) req.write(data)
    req.end()
  })
}

/** 1001 的可解析最小载荷（p0=到访人次 / p1=居住 / p2=工作 / pall=全量） */
function pop1001({ visit = 12000, live = 8000, work = 3000, total = 15000 } = {}) {
  return {
    '1001': {
      p0_sum: visit, p1_sum: live, p2_sum: work, pall_sum: total,
      p3_sum: 600, p4_sum: 900, p5_sum: 2400,
      male1_sum: Math.round(live / 2), female1_sum: live - Math.round(live / 2)
    }
  }
}

function insertPurchase({ radius = 1000, uid = null, lng = PT.lng, lat = PT.lat,
  cityMonth = '202609', status = 'active', store = '已购门店', data = null } = {}) {
  const info = getDb().prepare(
    `INSERT INTO purchases (user_id, store_name, store_type, center_lng, center_lat, radius,
                            city_month, quota_used, status, result_data)
     VALUES (?, ?, 'report', ?, ?, ?, ?, 1, ?, ?)`
  ).run(uid || userId, store, lng, lat, JSON.stringify([radius]), cityMonth, status,
    JSON.stringify({ querySuccess: true, apiResult: data || pop1001() }))
  return Number(info.lastInsertRowid)
}

function insertCandidateMarker(over = {}) {
  const m = {
    name: '已购测试门店', store_type: '重点候选', city: CITY, district: '测试区',
    address: '测试路 1 号', lat: PT.lat, lng: PT.lng, brand: '食其家', ...over
  }
  const info = getDb().prepare(
    `INSERT INTO markers (user_id, store_code, name, brand, store_type, city, district, address,
                          latitude, longitude, store_status, merged_into)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL)`
  ).run(userId, m.name, m.brand, m.store_type, m.city, m.district, m.address, m.lat, m.lng)
  return Number(info.lastInsertRowid)
}

/** 造一条「独立点位」（origin:'candidate'，没有关联门店）—— 用来测 `?id=` 入参 */
function insertStandaloneCandidate() {
  const info = getDb().prepare(
    `INSERT INTO store_candidates (user_id, name, brand, city, district, address,
                                   latitude, longitude, radius, stage)
     VALUES (?, '独立候选点', '食其家', ?, '测试区', '测试路 2 号', ?, ?, 1000, '待评估')`
  ).run(userId, CITY, PT.lat, PT.lng)
  return Number(info.lastInsertRowid)
}

function clearAll() {
  const db = getDb()
  db.prepare('DELETE FROM candidate_notes').run()
  db.prepare('DELETE FROM store_candidates').run()
  db.prepare('DELETE FROM markers').run()
  db.prepare('DELETE FROM purchases').run()
  db.prepare('DELETE FROM shapefiles').run()
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb

  const db = getDb()
  db.prepare(`INSERT OR IGNORE INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('buy_admin', 'buy_admin@test.local', 'x', 'admin', 0)
  userId = Number(db.prepare('SELECT id FROM users WHERE email = ?').get('buy_admin@test.local').id)
  db.prepare(`INSERT OR IGNORE INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('buy_other', 'buy_other@test.local', 'x', 'user', 0)
  otherId = Number(db.prepare('SELECT id FROM users WHERE email = ?').get('buy_other@test.local').id)
  token = jwt.sign({ id: userId, username: 'buy_admin', role: 'admin' }, cfg.JWT_SECRET, { expiresIn: '1h' })

  const express = (await import('express')).default
  const router = (await import('../src/routes/candidates.js')).default
  const app = express()
  app.use(express.json())
  app.use('/api/candidates', router)
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
})

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r))
  cleanupTmpEnv()
})

beforeEach(() => clearAll())

// ────────────────────────────────────────────────────────────────────────
describe('0. 环境自检', () => {
  it('跑在临时库上（⛔ 别再写进仓库里的 database/webgis.db）', () => {
    expect(process.env.R4B_DB_PATH).toBe(tmpDb)
    expect(fs.existsSync(tmpDb)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────
describe('A. GET /purchased-population —— 零副作用、零费用', () => {
  it('没买过 ⇒ 200 + purchasedCount 0 + tiers 空（⛔ 不是 404）', async () => {
    const mid = insertCandidateMarker()
    const r = await call('GET', `/api/candidates/purchased-population?markerId=${mid}`)
    expect(r.status).toBe(200)
    expect(r.body.purchasedCount).toBe(0)
    expect(r.body.tiers).toEqual([])
  })

  it('🔴🔴 调用前后 purchases / admin_quota / candidate_notes 一字不变', async () => {
    const mid = insertCandidateMarker()
    insertPurchase({ radius: 1000 })
    const db = getDb()
    const snap = () => JSON.stringify({
      p: db.prepare('SELECT id,user_id,radius,city_month,status,quota_used,result_data FROM purchases ORDER BY id').all(),
      q: db.prepare('SELECT * FROM admin_quota').all(),
      n: db.prepare('SELECT id,candidate_id,note FROM candidate_notes ORDER BY id').all(),
      c: db.prepare('SELECT id,stage FROM store_candidates ORDER BY id').all()
    })
    const before = snap()
    const r = await call('GET', `/api/candidates/purchased-population?markerId=${mid}`)
    expect(r.status).toBe(200)
    expect(r.body.purchasedCount).toBe(1)
    expect(snap(), '只读端点写了库 —— 报告页又能产生副作用了').toBe(before)
  })

  it('🔴 不扣配额（剩余次数不变）', async () => {
    const mid = insertCandidateMarker()
    insertPurchase({ radius: 3000 })
    const db = getDb()
    const before = Number(db.prepare('SELECT remaining_quota FROM admin_quota WHERE id = 1').get()?.remaining_quota ?? -1)
    await call('GET', `/api/candidates/purchased-population?markerId=${mid}`)
    const after = Number(db.prepare('SELECT remaining_quota FROM admin_quota WHERE id = 1').get()?.remaining_quota ?? -1)
    expect(after).toBe(before)
  })

  it('🔴 端点源码里⛔ 不许出现任何计费/写入语句', () => {
    const SRC = read('backend/src/routes/candidates.js')
    const i = SRC.indexOf("router.get('/purchased-population'")
    expect(i).toBeGreaterThan(-1)
    const end = SRC.indexOf('/** 详情 + 流水', i)
    expect(end).toBeGreaterThan(i)
    const body = SRC.slice(i, end)
    for (const bad of ['checkQuota', 'chargeAndRecord', 'INSERT INTO', 'UPDATE ', 'beginTx']) {
      expect(body, `只读端点里出现了 ${bad}`).not.toContain(bad)
    }
  })

  it('🔴 路由必须注册在 GET /:id 之前（否则 /purchased-population 被当成 id）', () => {
    const SRC = read('backend/src/routes/candidates.js')
    const own = SRC.indexOf("router.get('/purchased-population'")
    const byId = SRC.indexOf("router.get('/:id'")
    expect(own).toBeGreaterThan(-1)
    expect(byId).toBeGreaterThan(-1)
    expect(own, '/purchased-population 注册晚于 /:id ⇒ 一定 404').toBeLessThan(byId)
  })
})

// ────────────────────────────────────────────────────────────────────────
describe('B. 档位判定必须与取数侧逐关一致', () => {
  it('多档按半径升序返回，每档都带 1001 解析结果 + 期次 + purchaseId', async () => {
    const mid = insertCandidateMarker()
    // 故意乱序插入，检验排序
    insertPurchase({ radius: 5000, cityMonth: '202608' })
    insertPurchase({ radius: 1000, cityMonth: '202609' })
    insertPurchase({ radius: 1500, cityMonth: '202607' })

    const r = await call('GET', `/api/candidates/purchased-population?markerId=${mid}`)
    expect(r.status).toBe(200)
    expect(r.body.purchasedCount).toBe(3)
    expect(r.body.tiers.map((t) => t.radius)).toEqual([1000, 1500, 5000])
    for (const t of r.body.tiers) {
      expect(t.population.live).toBe(8000)
      expect(t.population.work).toBe(3000)
      expect(t.population.visit).toBe(12000)
      expect(t.cityMonth).toBeTruthy()
      expect(t.purchaseId).toBeGreaterThan(0)
    }
  })

  it('🔴 别账号的购买不算（复用是按账号的）', async () => {
    const mid = insertCandidateMarker()
    insertPurchase({ radius: 1000, uid: otherId })
    const r = await call('GET', `/api/candidates/purchased-population?markerId=${mid}`)
    expect(r.body.purchasedCount, '把别人的购买算成自己的 ⇒ 会承诺"免费"却扣钱').toBe(0)
  })

  it('🔴 status 不是 active 的购买不算（作废/退款的不算）', async () => {
    const mid = insertCandidateMarker()
    insertPurchase({ radius: 1000, status: 'refunded' })
    const r = await call('GET', `/api/candidates/purchased-population?markerId=${mid}`)
    expect(r.body.purchasedCount).toBe(0)
  })

  it('🔴 只有 1005 没有 1001 的购买不算（解析不出人口）', async () => {
    const mid = insertCandidateMarker()
    insertPurchase({ radius: 1000, data: { '1005': { a: 1 } } })
    const r = await call('GET', `/api/candidates/purchased-population?markerId=${mid}`)
    expect(r.body.purchasedCount).toBe(0)
  })

  it('🔴 10m 容差：同址算命中，偏 ~50m 不算', async () => {
    const mid = insertCandidateMarker()
    // 纬度 0.0003° ≈ 33m（粗筛框内），0.0009° ≈ 100m
    insertPurchase({ radius: 1000, lat: PT.lat + 0.00005 })   // ≈5.5m ⇒ 命中
    insertPurchase({ radius: 3000, lat: PT.lat + 0.0009 })    // ≈100m ⇒ 不命中
    const r = await call('GET', `/api/candidates/purchased-population?markerId=${mid}`)
    expect(r.body.tiers.map((t) => t.radius)).toEqual([1000])
  })

  it('同一半径买过两次 ⇒ 只留**最新**那条（期次/id 取最新，⛔ 取最早）', async () => {
    const mid = insertCandidateMarker()
    insertPurchase({ radius: 1000, cityMonth: '202605', store: '旧的那笔' })
    const newest = insertPurchase({ radius: 1000, cityMonth: '202609', store: '新的那笔' })
    const r = await call('GET', `/api/candidates/purchased-population?markerId=${mid}`)
    expect(r.body.tiers.length).toBe(1)
    expect(r.body.tiers[0].cityMonth).toBe('202609')
    expect(r.body.tiers[0].purchaseId).toBe(newest)
    expect(r.body.tiers[0].storeName).toBe('新的那笔')
  })

  it('一条记录的 radius 是数组（老数据形态）⇒ 逐档展开，共用同一份人口', async () => {
    const mid = insertCandidateMarker()
    getDb().prepare(
      `INSERT INTO purchases (user_id, store_name, store_type, center_lng, center_lat, radius,
                              city_month, quota_used, status, result_data)
       VALUES (?, '套餐', 'report', ?, ?, '[1000,3000]', '202609', 1, 'active', ?)`
    ).run(userId, PT.lng, PT.lat, JSON.stringify({ querySuccess: true, apiResult: pop1001({ live: 4321 }) }))
    const r = await call('GET', `/api/candidates/purchased-population?markerId=${mid}`)
    expect(r.body.tiers.map((t) => t.radius)).toEqual([1000, 3000])
    expect(r.body.tiers.every((t) => t.population.live === 4321)).toBe(true)
  })

  it('⭐ 支持 ?id=（独立点位，没有关联门店）', async () => {
    const cid = insertStandaloneCandidate()
    insertPurchase({ radius: 2000 })
    const r = await call('GET', `/api/candidates/purchased-population?id=${cid}`)
    expect(r.status).toBe(200)
    expect(r.body.tiers.map((t) => t.radius)).toEqual([2000])
  })

  it('缺 id 与 markerId ⇒ 400（拒绝理由必须与 /brief 一致）', async () => {
    const a = await call('GET', '/api/candidates/purchased-population')
    const b = await call('GET', '/api/candidates/brief')
    expect(a.status).toBe(400)
    expect(b.status).toBe(400)
    expect(a.body.message).toBe(b.body.message)
  })

  it('门店不是候选类型 ⇒ 400（与 /brief 同一条判据）', async () => {
    const mid = insertCandidateMarker({ store_type: '已开业' })
    const a = await call('GET', `/api/candidates/purchased-population?markerId=${mid}`)
    const b = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(a.status).toBe(400)
    expect(b.status).toBe(400)
    expect(a.body.message).toBe(b.body.message)
  })
})

// ────────────────────────────────────────────────────────────────────────
describe('C. /brief 回传 purchasedRadii（初步分析直达按钮的判据）', () => {
  it('买过 ⇒ 回传升序半径数组；没买过 ⇒ 空数组', async () => {
    const mid = insertCandidateMarker()
    const r1 = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=1000`)
    expect(r1.status).toBe(200)
    expect(r1.body.purchasedRadii).toEqual([])

    insertPurchase({ radius: 1500 })
    insertPurchase({ radius: 1000 })
    const r2 = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=1000`)
    expect(r2.status).toBe(200)
    expect(r2.body.purchasedRadii).toEqual([1000, 1500])
  })

  it('🔴 判据单一来源：readPurchasedRadii 必须走 readPurchasedEntries（⛔ 各写一份 SQL）', () => {
    const SRC = read('backend/src/routes/candidates.js')
    const i = SRC.indexOf('function readPurchasedRadii')
    expect(i).toBeGreaterThan(-1)
    const body = SRC.slice(i, i + 600)
    expect(body).toContain('readPurchasedEntries(')
    expect(body, '又写了一份 FROM purchases 查询 ⇒ 两份判据必然漂移').not.toContain('FROM purchases')
  })
})

// ────────────────────────────────────────────────────────────────────────
describe('D. buildReportModel —— 多档并列对比', () => {
  const cand = {
    name: '已购测试门店', brand: '食其家', city: CITY, district: '测试区',
    address: '测试路 1 号', latitude: PT.lat, longitude: PT.lng, radius: 1000,
    area: 120, rent: 45000
  }
  const tier = (radius, live, work, visit, cityMonth = '202609') => ({
    radius, cityMonth, population: { live, work, visit, total: live + work }
  })

  it('两档 ⇒ has=true，逐档算密度与职住比，当前档 isMain', () => {
    const m = buildReportModel(cand, {}, {
      population: { live: 8000, work: 3000, visit: 12000, total: 15000 },
      popRadius: 1000,
      tiers: [tier(1000, 8000, 3000, 12000), tier(3000, 60000, 20000, 90000)]
    })
    expect(m.tiers.has).toBe(true)
    expect(m.tiers.count).toBe(2)
    expect(m.tiers.rows.map((r) => r.radius)).toEqual([1000, 3000])
    expect(m.tiers.rows[0].isMain).toBe(true)
    expect(m.tiers.rows[1].isMain).toBe(false)

    // 密度＝居住人口 ÷ 圆面积（km²）—— 与「居住人口」列同源，⛔ 掺本地网格会自相矛盾
    const d1 = 8000 / (Math.PI * 1 * 1)
    expect(m.tiers.rows[0].density).toBe(Math.round(d1 * 10) / 10)
    expect(m.tiers.rows[1].density).toBe(Math.round((60000 / (Math.PI * 9)) * 10) / 10)
    // 职住比
    expect(m.tiers.rows[0].workLiveRatio).toBeCloseTo(3000 / 8000, 6)
    // 放大一圈的净效果（只陈述变化，⛔ 不外推营业额）
    expect(m.tiers.summary.join('')).toMatch(/居住人口/)
    expect(m.tiers.summary.join('')).toMatch(/密度/)
    expect(m.tiers.summary.join('')).not.toMatch(/预计|预测|日销/)
  })

  it('一档 ⇒ has=false（一行数据的"对比表"没有信息量）', () => {
    const m = buildReportModel(cand, {}, { population: null, popRadius: 1000, tiers: [tier(1000, 8000, 3000, 12000)] })
    expect(m.tiers.has).toBe(false)
    expect(m.tiers.rows.length).toBe(1)
  })

  it('没传 tiers ⇒ has=false、rows 空（旧调用/旧快照不许崩）', () => {
    const m = buildReportModel(cand, {}, { population: null })
    expect(m.tiers.has).toBe(false)
    expect(m.tiers.rows).toEqual([])
    expect(m.tiers.summary).toEqual([])
  })

  it('缺 live 的档 ⇒ 密度与职住比是 null，⛔ 写 0', () => {
    const m = buildReportModel(cand, {}, {
      popRadius: 1000,
      tiers: [tier(1000, 8000, 3000, 12000), { radius: 3000, cityMonth: '202609', population: { live: null, work: null, visit: 5 } }]
    })
    const r = m.tiers.rows.find((x) => x.radius === 3000)
    expect(r.density).toBeNull()
    expect(r.workLiveRatio).toBeNull()
  })

  it('口径页脚要写清「每列各按自己那个半径取数」', () => {
    const m = buildReportModel(cand, {}, {
      population: { live: 8000, work: 3000, visit: 12000, total: 15000 },
      popRadius: 1000,
      tiers: [tier(1000, 8000, 3000, 12000), tier(3000, 60000, 20000, 90000)]
    })
    expect(m.provenance.sample).toContain('对比表每列')
  })
})

// ────────────────────────────────────────────────────────────────────────
describe('E. 前端入口：买过才给按钮，没买过指路', () => {
  it('初步分析页有「生成立项报告」，判据是 purchasedRadii', () => {
    const V = read('frontend/src/components/CandidateBriefReport.vue')
    expect(V).toContain('生成立项报告')
    expect(V).toContain('purchasedRadii')
    // ⛔ 不许用 disabled 拦（灰按钮点不动、用户不知道原因）
    expect(V).toMatch(/@click="onOpenReport"/)
    expect(V).not.toMatch(/生成立项报告<\/el-button>[\s\S]{0,80}:disabled="!purchasedRadii/)
  })

  it('买完必须重新拉一次 /brief（否则买完按钮还是灰的）', () => {
    const V = read('frontend/src/components/CandidateBriefReport.vue')
    const U = read('frontend/src/components/CandidateBriefUpgrade.vue')
    expect(V).toContain('@refresh="load"')
    expect(U).toContain("emit('refresh')")
  })

  it('列表页开报告前先查已购，没有就引导去初步分析', () => {
    const V = read('frontend/src/views/CandidateView.vue')
    expect(V).toContain('ensureHasPopulation')
    expect(V).toContain('/api/candidates/purchased-population')
    expect(V).toContain('去初步分析')
    // 闸门必须在 ensureRow **之前**（没买过就不该建一行推进记录）
    const fn = V.indexOf('async function openReport()')
    const body = V.slice(fn, fn + 600)
    const iGate = body.indexOf('ensureHasPopulation')
    const iEnsure = body.indexOf('await ensureRow(')
    expect(iGate).toBeGreaterThan(-1)
    expect(iEnsure).toBeGreaterThan(-1)
    expect(iGate, '先建行再判闸门 ⇒ 没买过的点位也留下推进记录').toBeLessThan(iEnsure)
  })

  it('🔴 报告弹窗必须挂在 briefRow 分支之外，否则「直达」点了什么都不发生', () => {
    // 413 实测踩到的真 bug：`<CandidateReport>` 原先写在 `<template v-else>` 里（只属于列表分支），
    // 而「初步分析 → 生成立项报告」的直达链路里 `briefRow` 仍然非空 ⇒ 组件**没被渲染**，
    // `reportVisible = true` 变成没人搭理的变量：请求全打完了（POST /ensure + GET /:id）、
    // 控制台零报错、界面上零变化 —— 最难查的一类"静默无效"。
    const V = read('frontend/src/views/CandidateView.vue')
    expect(V).toContain('<CandidateReport')

    // 用配对计数取 `v-else` 分支的真正范围（页面里还有一堆 `<template #default>` 内联插槽，
    // 靠"组件后面是不是紧跟 </template>"会误判，必须数嵌套深度）
    const start = V.indexOf('<template v-else>')
    expect(start, '找不到 `v-else` 分支，模板结构变了，请同步更新本用例').toBeGreaterThan(-1)
    let depth = 1
    let i = start + '<template v-else>'.length
    let end = -1
    const re = /<template\b|<\/template>/g
    re.lastIndex = i
    let m
    while ((m = re.exec(V))) {
      if (m[0] === '</template>') { depth -= 1; if (depth === 0) { end = m.index; break } } else { depth += 1 }
    }
    expect(end, '`v-else` 分支没有配套收尾，模板结构坏了').toBeGreaterThan(-1)
    expect(V.slice(start, end), '报告组件被关在 v-else 分支里 ⇒ 初步分析页直达时它不会被渲染')
      .not.toContain('<CandidateReport')

    // ⛔ 也不许用「清 briefRow 把用户甩回列表」来绕过这个问题
    const fn = V.indexOf('async function launchReportFromBrief')
    const body = V.slice(fn, fn + 700)
    expect(body, '直达后不该把用户甩回列表页').not.toContain('briefRow.value = null')
  })
})
