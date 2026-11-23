/**
 * 候选点位「初步分析」· 多半径对比（批次 403）
 *
 * ── 业主原话（2026-11-23）────────────────────────────────────────────────
 * 「现在『初步分析』页面里设计的是一个半径的分析结果，可以有多个半径的分析结果对比吗？」
 * 三项拍板：① 形态 A（保留完整报告 + 顶部对比表）② 只比联通能买到的三档 1/3/5km
 * ③ 对比表进 PDF。
 *
 * ── 这张表最容易出的错，不是样式，是**两套算法漂移** ────────────────────
 * 对比列如果自己另算一遍人口/竞品（而不是复用同一份模型），将来谁改了 `circlePopulation`
 * 的边界加权、或改了 `competitionScore` 的阈值，表和正文就会给出两个数 —— 而它们摆在
 * 同一张纸上，读者只会得出「这系统不可信」。
 * 🔴 所以本文件的核心用例是 B 组：**对比行的每个数字，必须与「以该半径单独请求」逐字段相等**。
 *
 * ── 其余边界 ────────────────────────────────────────────────────────────
 *   · 未评 ≠ 0：没有网格 ⇒ `circlePop: null`，⛔ 不写 0
 *   · 主半径不在三档内（500m / 800m）⇒ 必须一并进表并标 `isMain`
 *   · 已有购买的档位要标 `purchased`（复用是**同半径**语义，逐列判，不能整表一个值）
 *   · 档位来自后端常量（`UNICOM_REPORT_RADII`），⛔ 前端不许自己写死
 *
 * 环境手法与 candidateBrief.test.js 同源：真 express + 临时库 + 临时 geo 目录，
 * 网格必须 `writeGeoText` 写盘（`findGridRow` 不 SELECT geojson 列）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
// 🔴 必须**第一个 import**：ESM 静态 import 先于模块体执行，env 写在下面那行不管用，
//    `models/database.js` 会在顶层就把 dbPath 定死成仓库里的真库（见文件内说明）
import { tmpDb, tmpGeo, cleanupTmpEnv } from './_tmpDbEnv.mjs'
import http from 'node:http'

import { parseCompareRadii, buildCompareRow, BRIEF_CONST } from '../src/utils/candidateBrief.js'

let server, token, userId
let getDb, geoStoreMod

const CITY = '测试市'
const PT = { lng: 121.4300, lat: 31.1950 }
/** 0.009° 纬度 ≈ 1km */
const DEG_1KM = 0.009

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

/**
 * 造 12×12 的 1km 网格（≈12km 见方）。
 * 🔴 必须比最小要求大：5km 圆要能整圈落在网格里，否则「5km 的人口被网格边界截断」，
 *    对比表里会出现「半径翻 1.67 倍、人口只涨 1.1 倍」的假衰减。
 */
function seedGrid({ field = '常住人口', size = 12 } = {}) {
  const L0 = PT.lng - 3 * 0.0105
  const B0 = PT.lat - 3 * DEG_1KM
  const DX = 0.0105
  const DY = DEG_1KM
  const feats = []
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const lng = L0 + i * DX
      const lat = B0 + j * DY
      feats.push({
        type: 'Feature',
        properties: { [field]: 2000 + i * 1500 + j * 800 },
        geometry: {
          type: 'Polygon',
          coordinates: [[[lng, lat], [lng + DX, lat], [lng + DX, lat + DY], [lng, lat + DY], [lng, lat]]]
        }
      })
    }
  }
  const fc = JSON.stringify({ type: 'FeatureCollection', features: feats })
  const info = getDb().prepare(
    `INSERT INTO shapefiles (name, geojson, field_names, feature_count, user_id, category, city)
     VALUES (?, ?, ?, ?, ?, 'population', ?)`
  ).run(`${CITY}1km网格人口`, fc, JSON.stringify([field]), feats.length, userId, CITY)
  geoStoreMod.writeGeoText(Number(info.lastInsertRowid), fc)
}

function insertCandidateMarker(over = {}) {
  const m = {
    name: '对比测试门店', store_type: '重点候选', city: CITY, district: '测试区',
    address: '测试路 1 号', lat: PT.lat, lng: PT.lng, brand: '食其家', ...over
  }
  const info = getDb().prepare(
    `INSERT INTO markers (user_id, store_code, name, brand, store_type, city, district, address,
                          latitude, longitude, store_status, merged_into)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL)`
  ).run(userId, m.name, m.brand, m.store_type, m.city, m.district, m.address, m.lat, m.lng)
  return Number(info.lastInsertRowid)
}

/**
 * 竞品按距离分三圈埋：
 *   ~0.7km（只在 1km 圆里）/ ~1.8km（1、3km）/ ~3.8km（三档都在）
 * ⇒ 竞品数随半径严格递增（2 / 4 / 6），能一眼看出「表是不是真的按半径重算」
 */
function seedCompetitors() {
  const at = (km, brand, dLng = 0) => {
    getDb().prepare(
      `INSERT INTO competitors (user_id, brand, name, latitude, longitude, status) VALUES (?, ?, ?, ?, ?, '正常')`
    ).run(userId, brand, `${brand}门店`, PT.lat + km * DEG_1KM, PT.lng + dLng)
  }
  at(0.7, '竞品A')
  // ⚠️ 第二家必须真的落在 1km 内：`at(0.8, ..., 0.008)` 会到 ~1.1km（0.008° 经度
  //    在 31°N 约 762m，叠加 0.8km 纬度就是 1.1km），实测把 1km 档算成了 1 家。
  at(0.5, '竞品A', 0.005)
  at(1.8, '竞品A')
  at(1.9, '竞品A', 0.008)
  at(3.8, '竞品A')
  at(3.9, '竞品A', 0.008)
}

function insertPurchase({ radius = 1000 } = {}) {
  const data = JSON.stringify({ '1001': { p0_sum: 1200, p1_sum: 800, p2_sum: 300, pall_sum: 2300 } })
  getDb().prepare(
    `INSERT INTO purchases (user_id, store_name, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
     VALUES (?, '对比测试已购', ?, ?, ?, '202609', 1, 'active', ?)`
  ).run(userId, PT.lng, PT.lat, JSON.stringify([radius]), data)
}

function clearAll() {
  const db = getDb()
  db.prepare('DELETE FROM candidate_notes').run()
  db.prepare('DELETE FROM store_candidates').run()
  db.prepare('DELETE FROM markers').run()
  db.prepare('DELETE FROM competitors').run()
  db.prepare('DELETE FROM shapefiles').run()
  db.prepare('DELETE FROM purchases').run()
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  geoStoreMod = await import('../src/models/geoStore.js')

  const db = getDb()
  db.prepare(`INSERT OR IGNORE INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('cmp_admin', 'cmp_admin@test.local', 'x', 'admin', 0)
  userId = Number(db.prepare('SELECT id FROM users WHERE email = ?').get('cmp_admin@test.local').id)
  token = jwt.sign({ id: userId, username: 'cmp_admin', role: 'admin' }, cfg.JWT_SECRET, { expiresIn: '1h' })

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
// A. 纯函数：档位解析（最容易埋 bug 的一层）
// ────────────────────────────────────────────────────────────────────────
describe('A. parseCompareRadii', () => {
  it('🔴 测试库必须是临时库（别再写进仓库里的 database/webgis.db）', () => {
    // 2026-11-23 实测事故：env 写在静态 import 之后不管用，测试的 clearAll() 把
    // 本机开发库的门店删空了。这里把「跑在临时库上」本身钉成断言。
    expect(process.env.R4B_DB_PATH).toBe(tmpDb)
    expect(tmpDb).not.toContain('/Report4biz/backend/database/')
  })

  it('默认就是联通三档，升序', () => {
    expect(parseCompareRadii('', 1000)).toEqual([1000, 3000, 5000])
    expect(parseCompareRadii(null, 1000)).toEqual([1000, 3000, 5000])
  })

  it('去重 + 升序（前端传乱序/重复不能影响列顺序）', () => {
    expect(parseCompareRadii('5000,1000,1000,3000', 1000)).toEqual([1000, 3000, 5000])
  })

  it('🔴 主半径不在档位里 ⇒ 必须补进表并保持升序', () => {
    expect(parseCompareRadii('', 500)).toEqual([500, 1000, 3000, 5000])
    expect(parseCompareRadii('1000,3000', 800)).toEqual([800, 1000, 3000])
  })

  it('非法值被丢掉，全非法 ⇒ 回退联通三档', () => {
    expect(parseCompareRadii('abc,,0,-5', 1000)).toEqual([1000, 3000, 5000])
  })

  it('越界按边界夹住（不产生 0 米或 100 公里的圆）', () => {
    expect(parseCompareRadii('1', 1000, { min: 100, max: 50000 })).toEqual([100, 1000])
    expect(parseCompareRadii('999999', 1000, { min: 100, max: 50000 })).toEqual([1000, 50000])
  })

  it('列数上限（防止 ?radii= 塞 30 个把报告拉爆）', () => {
    const many = Array.from({ length: 30 }, (_, i) => (i + 1) * 100).join(',')
    const out = parseCompareRadii(many, 1000, { maxCount: 5 })
    expect(out.length).toBeLessThanOrEqual(5)
    // 主半径永远不能因为截断而消失（表里看不到自己正在看的圆，比少一列严重）
    const withMain = parseCompareRadii(many, 7777, { maxCount: 5 })
    expect(withMain.length).toBeLessThanOrEqual(5)
    expect(withMain).toContain(7777)
  })
})

// ────────────────────────────────────────────────────────────────────────
// B. 纯函数：对比行（缺值必须 null，⛔ 不能变 0）
// ────────────────────────────────────────────────────────────────────────
describe('B. buildCompareRow', () => {
  const model = (over = {}) => ({
    point: { radius: 3000 },
    population: { covered: true, reason: '', circlePop: 12345, density: 436.6, level: { key: 'p70', label: '较高密度' } },
    competition: { count: 4, level: { key: 'moderate', label: '适中' } },
    verdict: { level: 'watch', title: '证据不全或存在短板，建议先核验' },
    ...over
  })

  it('挑出随半径变的三项 + 结论', () => {
    const row = buildCompareRow(model(), [])
    expect(row.radiusM).toBe(3000)
    expect(row.population.circlePop).toBe(12345)
    expect(row.population.density).toBe(436.6)
    expect(row.population.level.label).toBe('较高密度')
    expect(row.competition.count).toBe(4)
    expect(row.verdict.level).toBe('watch')
  })

  it('🔴 客群未评 ⇒ circlePop/density 是 null，⛔ 不是 0', () => {
    const row = buildCompareRow(model({
      population: { covered: false, reason: 'no_grid_row', circlePop: null, density: null, level: null }
    }), [])
    expect(row.population.covered).toBe(false)
    expect(row.population.circlePop).toBe(null)
    expect(row.population.density).toBe(null)
    expect(row.population.level).toBe(null)
  })

  it('已购按**同半径**逐列判（1km 买过不等于 3km 能复用）', () => {
    const one = buildCompareRow(model({ point: { radius: 1000 } }), [1000])
    const three = buildCompareRow(model({ point: { radius: 3000 } }), [1000])
    expect(one.purchased).toBe(true)
    expect(three.purchased, '踩过：复用是同半径语义，⛔ 整表一个 purchased').toBe(false)
  })

  it('unicom 口径带上（点位自带 800m ⇒ 按 1km 买，exact=false）', () => {
    const row = buildCompareRow(model({ point: { radius: 800 } }), [])
    expect(row.unicom.radiusM).toBe(1000)
    expect(row.unicom.exact).toBe(false)
    expect(buildCompareRow(model({ point: { radius: 5000 } }), []).unicom.exact).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────
// C. 接口：结构
// ────────────────────────────────────────────────────────────────────────
describe('C. 接口返回结构', () => {
  it('默认三列 1/3/5km，恰有一列是主半径', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=3000`)
    expect(r.status, r.raw).toBe(200)

    const cmp = r.body.compare
    expect(cmp.rows.map((x) => x.radiusM)).toEqual([1000, 3000, 5000])
    expect(cmp.mainRadius).toBe(3000)
    expect(cmp.rows.filter((x) => x.isMain).map((x) => x.radiusM)).toEqual([3000])
    expect(cmp.unicomRadii).toEqual([...BRIEF_CONST.UNICOM_RADII])
    expect(cmp.source).toBe('unicom-tiers')
  })

  it('人口与竞品随半径单调不减（半径变大不可能人更少、竞品更少）', async () => {
    seedGrid()
    seedCompetitors()
    const mid = insertCandidateMarker()
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=1000`)
    const rows = r.body.compare.rows
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].population.circlePop).toBeGreaterThanOrEqual(rows[i - 1].population.circlePop)
      expect(rows[i].competition.count).toBeGreaterThanOrEqual(rows[i - 1].competition.count)
    }
    // 竞品埋点：0.7~0.9km 两家、1.8~1.9km 两家、3.8~3.9km 两家
    expect(rows.map((x) => x.competition.count)).toEqual([2, 4, 6])
  })

  it('主半径 500m ⇒ 表里必须有它且标 isMain（不能"报告的圆在表里找不到"）', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=500`)
    expect(r.body.compare.rows.map((x) => x.radiusM)).toEqual([500, 1000, 3000, 5000])
    expect(r.body.compare.rows.find((x) => x.isMain).radiusM).toBe(500)
  })
})

// ────────────────────────────────────────────────────────────────────────
// D. 🔴🔴 核心不变量：对比行 == 单独请求同一半径
// ────────────────────────────────────────────────────────────────────────
describe('D. 对比列与单半径请求必须逐字段一致（防两套算法漂移）', () => {
  it('三档各自核对 circlePop / density / 竞品数 / 结论', async () => {
    seedGrid()
    seedCompetitors()
    const mid = insertCandidateMarker()

    const multi = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=1000`)
    expect(multi.status, multi.raw).toBe(200)

    for (const row of multi.body.compare.rows) {
      const one = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=${row.radiusM}`)
      expect(one.status, one.raw).toBe(200)
      const b = one.body.brief
      const where = `${row.radiusM}m 档`
      expect(row.population.circlePop, `${where} 人口与单半径请求不一致`).toBe(b.population.circlePop)
      expect(row.population.density, `${where} 密度不一致`).toBe(b.population.density)
      expect(row.competition.count, `${where} 竞品数不一致`).toBe(b.competition.count)
      expect(row.verdict.level, `${where} 结论不一致`).toBe(b.verdict.level)
      expect(row.verdict.title).toBe(b.verdict.title)
      expect(row.radiusM).toBe(b.point.radius)
    }
  })

  it('主报告本身也取自同一批模型（brief.point.radius === compare.mainRadius）', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=3000&radii=1000,5000`)
    expect(r.body.brief.point.radius).toBe(3000)
    const main = r.body.compare.rows.find((x) => x.isMain)
    expect(main.radiusM).toBe(3000)
    expect(main.population.circlePop).toBe(r.body.brief.population.circlePop)
    expect(main.competition.count).toBe(r.body.brief.competition.count)
  })
})

// ────────────────────────────────────────────────────────────────────────
// E. 未评、已购、成本
// ────────────────────────────────────────────────────────────────────────
describe('E. 边界：未评 / 已购 / 0 消耗', () => {
  it('🔴 没有网格 ⇒ 三列全是未评，circlePop 一律 null（⛔ 不是 0）', async () => {
    const mid = insertCandidateMarker({ city: '无网格市' })
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=1000`)
    expect(r.status, r.raw).toBe(200)
    for (const row of r.body.compare.rows) {
      expect(row.population.covered).toBe(false)
      expect(row.population.circlePop).toBe(null)
      expect(row.population.density).toBe(null)
      expect(row.population.level).toBe(null)
      expect(row.population.reason).toBe('no_grid_row')
    }
  })

  it('已购 1km ⇒ 只有 1km 列标 purchased', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    insertPurchase({ radius: 1000 })
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=1000`)
    const rows = r.body.compare.rows
    expect(rows.find((x) => x.radiusM === 1000).purchased).toBe(true)
    expect(rows.find((x) => x.radiusM === 3000).purchased).toBe(false)
    expect(rows.find((x) => x.radiusM === 5000).purchased).toBe(false)
  })

  it('多算两档不产生任何扣费：purchases 行数与配额都不变', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    const before = getDb().prepare('SELECT COUNT(*) n FROM purchases').get().n
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=1000`)
    expect(r.status, r.raw).toBe(200)
    expect(getDb().prepare('SELECT COUNT(*) n FROM purchases').get().n).toBe(before)
    expect(r.body.brief.provenance.cost).toContain('0 配额消耗')
  })

  it('响应里不许出现 NaN / Infinity（JSON 只能给 null）', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=1000`)
    expect(r.raw).not.toMatch(/NaN|Infinity/)
  })
})
