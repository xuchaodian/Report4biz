/**
 * 候选点位「初步分析」（批次 378 · P1）
 *
 * ── 这份报告存在的理由 ─────────────────────────────────────────────────
 * 业主 2026-11-18：「把地图页的『常住人口分布』『竞品分布』这些免费能力整合进来，
 * 生成一份初步分析报告」。它要替业主回答**「这个点位值不值得花钱买联通人口做精算」**，
 * 所以三条底线必须钉住：
 *   ① **0 消耗**：不调联通、不调高德、不写库（看一眼不留痕迹）
 *   ② **未评 ≠ 0**：没有网格就是「客群未评」，⛔ 不能按 0 人算，也不能给绿灯
 *   ③ **⛔ 不给总分**：单点没有可比集合，只给分项事实 + 三档结论
 *
 * ── 关键手法 ───────────────────────────────────────────────────────────
 * · 纯函数用例直接 import utils/candidateBrief.js（毫秒级，改阈值先跑这层）
 * · 接口用例用**真 express + 临时库 + 临时 geo 目录**（不 mock db，要证明真 SQL 跑得通）
 * · 网格必须 `writeGeoText` 写盘：`findGridRow` 不 SELECT geojson 列，
 *   只塞列不写盘会静默得到 0 个 feature（siteSelectCoarse 已记过这个坑）
 * · `R4B_GEO_DIR` 必须在动态 import 之前设置，否则会往真实 uploads 里写文件
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-brief-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb
const tmpGeo = path.join(os.tmpdir(), `r4b-brief-geo-${process.pid}-${Date.now()}`)
process.env.R4B_GEO_DIR = tmpGeo

import {
  cellDensity, densityThresholds, densityLevel, competitionLevel, buildVerdict, buildBriefModel,
  buildUpgradePlan, pickUnicomRadius, UPGRADE_BUYS
} from '../src/utils/candidateBrief.js'

let server, token, userId, otherUserId
let getDb, geoStoreMod

/** 测试用城市：网格与商圈面都挂在这个名字上 */
const CITY = '测试市'
const PT = { lng: 121.4300, lat: 31.1950 }

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

/** 造 6×6 的 1km 网格（人口按位置递增，让分位有区分度） */
function seedGrid({ city = CITY, field = '常住人口' } = {}) {
  const L0 = 121.3980
  const B0 = 31.1680
  const DX = 0.0105   // ≈ 1000m
  const DY = 0.0090   // ≈ 1000m
  const feats = []
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
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
  ).run(`${city}1km网格人口`, fc, JSON.stringify([field]), feats.length, userId, city)
  geoStoreMod.writeGeoText(Number(info.lastInsertRowid), fc)
  return Number(info.lastInsertRowid)
}

/** 造一个覆盖测试点的商圈面 */
function seedDistrict({ city = CITY, contained = true } = {}) {
  const w = contained ? PT.lng - 0.005 : PT.lng + 0.10
  const s = contained ? PT.lat - 0.005 : PT.lat + 0.10
  const e = w + 0.01
  const n = s + 0.01
  const fc = JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        名称: '测试商圈', 居住人数: 120000, 工作人数: 80000, 到访人次: 900000,
        中产人数: 30000, 富人人数: 5000, 小康人数: 40000, 低收入人数: 20000, 客群: '白领', 能级: '市级'
      },
      geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
    }]
  })
  const info = getDb().prepare(
    `INSERT INTO shapefiles (name, geojson, field_names, feature_count, user_id, category, city)
     VALUES (?, ?, ?, ?, ?, 'other', ?)`
  ).run(`${city}商圈面`, fc, '[]', 1, userId, city)
  geoStoreMod.writeGeoText(Number(info.lastInsertRowid), fc)
}

function insertCandidateMarker(over = {}) {
  const m = {
    name: '测试候选门店', store_code: null, store_type: '重点候选',
    city: CITY, district: '测试区', address: '测试路 1 号',
    lat: PT.lat, lng: PT.lng, brand: '食其家', uid: userId, merged_into: null,
    store_status: '',
    ...over
  }
  const info = getDb().prepare(
    `INSERT INTO markers (user_id, store_code, name, brand, store_type, city, district, address,
                          latitude, longitude, store_status, merged_into)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(m.uid, m.store_code, m.name, m.brand, m.store_type, m.city, m.district, m.address,
    m.lat, m.lng, m.store_status, m.merged_into)
  return Number(info.lastInsertRowid)
}

/** 造一家**已开业**的自有门店（进「自有门店」索引的唯一口径） */
function insertOpenStore({ name = '已有门店', brand = '食其家', lng, lat, uid = userId } = {}) {
  const info = getDb().prepare(
    `INSERT INTO markers (user_id, name, brand, latitude, longitude, store_type, store_status, merged_into)
     VALUES (?, ?, ?, ?, ?, '已开业', '', NULL)`
  ).run(uid, name, brand, lat, lng)
  return Number(info.lastInsertRowid)
}

function insertCompetitor({ brand = '竞品A', lng, lat, status = '正常', uid = userId } = {}) {
  getDb().prepare(
    `INSERT INTO competitors (user_id, brand, name, latitude, longitude, status) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(uid, brand, `${brand}门店`, lat, lng, status)
}

function clearAll() {
  const db = getDb()
  db.prepare('DELETE FROM candidate_notes').run()
  db.prepare('DELETE FROM store_candidates').run()
  db.prepare('DELETE FROM markers').run()
  db.prepare('DELETE FROM competitors').run()
  db.prepare('DELETE FROM shapefiles').run()
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  geoStoreMod = await import('../src/models/geoStore.js')

  const db = getDb()
  // ⚠️ 用 INSERT OR IGNORE + 查回 id：beforeAll 在同一进程里可能有被重复执行的场景
  //    （实测撞过 UNIQUE constraint failed: users.email）。幂等写法比"保证只跑一次"更稳。
  db.prepare(`INSERT OR IGNORE INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('brief_admin', 'brief_admin@test.local', 'x', 'admin', 0)
  db.prepare(`INSERT OR IGNORE INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('brief_other', 'brief_other@test.local', 'x', 'user', 0)
  userId = Number(db.prepare('SELECT id FROM users WHERE email = ?').get('brief_admin@test.local').id)
  otherUserId = Number(db.prepare('SELECT id FROM users WHERE email = ?').get('brief_other@test.local').id)

  token = jwt.sign({ id: userId, username: 'brief_admin', role: 'admin' }, cfg.JWT_SECRET, { expiresIn: '1h' })

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
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
  try { fs.rmSync(tmpGeo, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

beforeEach(() => clearAll())

// ────────────────────────────────────────────────────────────────────────
// P1. 纯函数：密度换算与分档
// ────────────────────────────────────────────────────────────────────────
describe('P1. 密度换算（cellDensity）', () => {
  it('1km 整格：halfDiag 707.2 ⇒ 密度等于格人口', () => {
    const d = cellDensity({ pop: 4095, halfDiagM: 707.2 })
    expect(Math.round(d)).toBe(4095)
  })

  it('🔴 碎块按**自己的面积**折算，⛔ 不能一律按 1km²', () => {
    // 半格（面积 0.5km²）里 1000 人 ⇒ 密度 2000 人/km²，而不是 1000
    const halfArea = Math.sqrt(500000) * 0.7072
    const d = cellDensity({ pop: 1000, halfDiagM: halfArea })
    expect(Math.round(d)).toBe(2000)
  })

  it('异常几何返回 null（⛔ 不返 0 冒充「这里没人」）', () => {
    expect(cellDensity({ pop: 100, halfDiagM: 0 })).toBe(null)
    expect(cellDensity({ pop: 0, halfDiagM: 707.2 })).toBe(null)
    expect(cellDensity(null)).toBe(null)
  })
})

describe('P2. 分档文案', () => {
  const t = { n: 100, p25: 1000, p50: 2000, p70: 4000, p90: 8000, median: 2000 }

  it('四道门与智能选址同源（p90/p70/p50/p25）', () => {
    expect(densityLevel(9000, t).key).toBe('p90')
    expect(densityLevel(5000, t).key).toBe('p70')
    expect(densityLevel(3000, t).key).toBe('p50')
    expect(densityLevel(1500, t).key).toBe('p25')
    expect(densityLevel(100, t).key).toBe('low')
  })

  it('🔴 样本不足 ⇒ 未评（null），⛔ 不返回最低档', () => {
    expect(densityLevel(5000, { n: 0, p25: null, p50: null, p70: null, p90: null })).toBe(null)
    expect(densityLevel(NaN, t)).toBe(null)
  })

  it('竞争宽松度：分越低＝越密集（方向不许写反）', () => {
    expect(competitionLevel(20).key).toBe('dense')
    expect(competitionLevel(35).key).toBe('dense')
    expect(competitionLevel(55).key).toBe('busy')
    expect(competitionLevel(75).key).toBe('normal')
    expect(competitionLevel(90).key).toBe('sparse')
  })
})

// ────────────────────────────────────────────────────────────────────────
// P3. 结论规则（固定、可回溯）
// ────────────────────────────────────────────────────────────────────────
describe('P3. 三档结论', () => {
  const base = () => buildBriefModel({
    point: { name: 'X', brand: '食其家', city: CITY, lat: PT.lat, lng: PT.lng, radius: 1000 },
    grid: { covered: true, reason: '' },
    density: { circlePop: 30000, whole: 2, partial: 3, thresholds: { n: 36, p25: 2000, p50: 4000, p70: 6000, p90: 8000 } },
    comp: { count: 4, byBrand: [{ brand: '竞品A', count: 4 }] },
    own: { hasBrand: true, brand: '食其家', nearestM: 3000, nearestName: '老店', withinR: 0, radiusM: 2000, maxOwn: 2 },
    district: { covered: true, contained: true, name: '测试商圈', score: 70, crowd: '白领', level: '市级' }
  })

  it('全部过关 ⇒ go', () => {
    const m = base()
    expect(m.verdict.level).toBe('go')
    expect(m.verdict.detail).toContain('30,000 人')
  })

  it('🔴 饱和 ⇒ hold（唯一能一票否决的情形）', () => {
    const m = buildBriefModel({
      point: { name: 'X', brand: '食其家', city: CITY, lat: PT.lat, lng: PT.lng, radius: 1000 },
      grid: { covered: true, reason: '' },
      density: { circlePop: 30000, whole: 2, partial: 3, thresholds: { n: 36, p25: 2000, p50: 4000, p70: 6000, p90: 8000 } },
      comp: { count: 1, byBrand: [] },
      own: { hasBrand: true, brand: '食其家', nearestM: 400, nearestName: '老店', withinR: 2, radiusM: 2000, maxOwn: 2 },
      district: { covered: true, contained: true, name: '测试商圈', score: 70 }
    })
    expect(m.own.saturated).toBe(true)
    expect(m.verdict.level).toBe('hold')
    expect(m.verdict.title).toContain('饱和')
  })

  it('🔴 未填品牌 ⇒ 饱和永不成立（「饱和」是品牌概念）', () => {
    const m = buildBriefModel({
      point: { name: 'X', brand: '', city: CITY, lat: PT.lat, lng: PT.lng, radius: 1000 },
      grid: { covered: true, reason: '' },
      density: { circlePop: 30000, whole: 2, partial: 3, thresholds: { n: 36, p25: 2000, p50: 4000, p70: 6000, p90: 8000 } },
      comp: { count: 1, byBrand: [] },
      own: { hasBrand: false, nearestM: 400, withinR: 5, radiusM: 2000, maxOwn: 2 }
    })
    expect(m.own.saturated).toBe(false)
    expect(m.verdict.level).toBe('watch')
  })

  it('🔴 无网格 ⇒ 绝不能 go（缺核心证据还给绿灯＝用缺数据的结论做投资决策）', () => {
    const m = buildBriefModel({
      point: { name: 'X', brand: '食其家', city: '无网格市', lat: PT.lat, lng: PT.lng, radius: 1000 },
      grid: { covered: false, reason: 'no_grid_row' },
      density: null,
      comp: { count: 1, byBrand: [] },
      own: { hasBrand: true, nearestM: 5000, withinR: 0, radiusM: 2000, maxOwn: 2 },
      district: { covered: true, contained: true, name: 'D', score: 60 }
    })
    expect(m.population.covered).toBe(false)
    expect(m.population.circlePop).toBe(null)   // ⛔ 不是 0
    expect(m.verdict.level).toBe('watch')
    expect(m.risks.join('|')).toContain('暂无本地 1km 网格')
  })

  it('竞品密集 ⇒ watch，且理由带具体数字', () => {
    const m = buildBriefModel({
      point: { name: 'X', brand: '食其家', city: CITY, lat: PT.lat, lng: PT.lng, radius: 1000 },
      grid: { covered: true, reason: '' },
      density: { circlePop: 30000, whole: 2, partial: 3, thresholds: { n: 36, p25: 2000, p50: 4000, p70: 6000, p90: 8000 } },
      comp: { count: 18, byBrand: [] },
      own: { hasBrand: true, nearestM: 5000, withinR: 0, radiusM: 2000, maxOwn: 2 },
      district: { covered: true, contained: true, name: 'D', score: 60 }
    })
    expect(m.verdict.level).toBe('watch')
    expect(m.verdict.reasons.some((r) => r.includes('18 家'))).toBe(true)
  })

  it('🔴 不产出任何「总分」字段（单点没有可比集合）', () => {
    const m = base()
    for (const k of ['score', 'totalScore', 'siteScore', 'total']) {
      expect(Object.prototype.hasOwnProperty.call(m, k), `不该有 ${k}`).toBe(false)
    }
    // 分位分只作内部刻度，且必须在 population 里、名字带 percentile
    expect(m.population.percentileScore).toBe(95)
  })

  it('🔴 最近门店缺失必须是 null，⛔ 不能 Number(null)=0 显示「最近门店 0 米」', () => {
    // 生产实测（批次 378）：一个没填品牌的点位显示「最近自有门店 0 m」，
    // 实际是「20km 内没有自有门店」。根因就是 Number(null) === 0。
    const m = buildBriefModel({
      point: { name: 'X', brand: '', city: CITY, lat: PT.lat, lng: PT.lng, radius: 1000 },
      grid: { covered: true, reason: '' },
      density: { circlePop: 20000, whole: 1, partial: 2, thresholds: { n: 36, p25: 2000, p50: 4000, p70: 6000, p90: 8000 } },
      comp: { count: 0, byBrand: [] },
      own: { hasBrand: false, nearestM: null, nearestName: '', withinR: 0, radiusM: 2000, maxOwn: 2 },
      district: { covered: false, contained: false, name: '', score: null }
    })
    expect(m.own.nearestM).toBe(null)
    expect(m.own.nearestText).toBe('')
  })

  it('风险清单必须点明「没有工作/到访/收入」——字段不存在，不是精度问题', () => {
    expect(base().risks.join('|')).toContain('没有工作人数、到访人次与收入分档')
  })

  // 🔴🔴 批次 378 生产实测：没填城市的点位，报告却说「本市未上传商圈面图层 / 不在任何商圈面内」——
  //    我们**压根没加载过**商圈面（城市都不知道），这是编造事实。
  //    三种情形必须分得开：①没填城市＝没查 ②有城市但本市无图层＝缺数据 ③有图层但点位不在面内＝点位事实。
  it('🔴 没填城市 ⇒ 商圈维度只许说「没加载」，⛔ 不许说「未上传图层」或「不在面内」', () => {
    const m = buildBriefModel({
      point: { name: 'X', brand: '', city: '', lat: PT.lat, lng: PT.lng, radius: 1000 },
      grid: { covered: false, reason: 'no_city' },
      density: null,
      comp: { count: 0, byBrand: [] },
      own: { hasBrand: false, nearestM: null, nearestName: '', withinR: 0, radiusM: 2000, maxOwn: 2 },
      district: { covered: false, contained: false, name: '', score: null }
    })
    const reasons = m.verdict.reasons.join('|')
    const risks = m.risks.join('|')
    // 已由「点位未填城市，客群与商圈都无法加载」统一说明
    expect(reasons).toContain('客群与商圈都无法加载')
    expect(reasons).not.toContain('本市未上传商圈面图层')
    expect(reasons).not.toContain('不在任何商圈面内')
    expect(risks).not.toContain('不在任何商圈面内')
    expect(risks).toContain('无法加载本地 1km 网格与商圈面')
  })

  it('有城市、有点位但不在面内 ⇒ 才说「不在任何商圈面内」（含「不代表没有商圈」的限定）', () => {
    const m = buildBriefModel({
      point: { name: 'X', brand: 'B', city: CITY, lat: PT.lat, lng: PT.lng, radius: 1000 },
      grid: { covered: true, reason: '' },
      density: { circlePop: 20000, whole: 1, partial: 2, thresholds: { n: 36, p25: 2000, p50: 4000, p70: 6000, p90: 8000 } },
      comp: { count: 0, byBrand: [] },
      own: { hasBrand: true, nearestM: 3000, nearestName: 'S', withinR: 0, radiusM: 2000, maxOwn: 2 },
      district: { covered: true, contained: false, name: '', score: null }
    })
    expect(m.verdict.reasons.join('|')).toContain('不在任何商圈面内')
    expect(m.risks.join('|')).toContain('不在任何商圈面内')
  })

  it('有城市但本市无商圈面图层 ⇒ 说「未上传图层」，⛔ 不说「不在面内」', () => {
    const m = buildBriefModel({
      point: { name: 'X', brand: 'B', city: CITY, lat: PT.lat, lng: PT.lng, radius: 1000 },
      grid: { covered: true, reason: '' },
      density: { circlePop: 20000, whole: 1, partial: 2, thresholds: { n: 36, p25: 2000, p50: 4000, p70: 6000, p90: 8000 } },
      comp: { count: 0, byBrand: [] },
      own: { hasBrand: true, nearestM: 3000, nearestName: 'S', withinR: 0, radiusM: 2000, maxOwn: 2 },
      district: { covered: false, contained: false, name: '', score: null }
    })
    expect(m.verdict.reasons.join('|')).toContain('本市未上传商圈面图层')
    expect(m.verdict.reasons.join('|')).not.toContain('不在任何商圈面内')
    expect(m.risks.join('|')).not.toContain('不在任何商圈面内')
    // ⚠️ 原 `if (!district)` 是死分支（路由永远传对象而非 undefined）⇒ 这条风险从来不会出现。
    //    现在按「有城市 && 无图层」判定，风险清单才真的会提示缺数据。
    expect(m.risks.join('|')).toContain('本市未上传商圈面图层')
  })
})

// ────────────────────────────────────────────────────────────────────────
// P4. 接口：0 消耗、只读、口径可追溯
// ────────────────────────────────────────────────────────────────────────
describe('P4. GET /brief 接口', () => {
  it('有网格 ⇒ 圆内人口 > 0，密度与分档都有值', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(r.status, r.raw).toBe(200)
    const b = r.body.brief
    expect(b.population.covered).toBe(true)
    expect(b.population.circlePop).toBeGreaterThan(0)
    expect(b.population.whole + b.population.partial).toBeGreaterThan(0)
    expect(b.population.level).toBeTruthy()
    expect(b.population.density).toBeGreaterThan(0)
  })

  it('🔴 城市写「上海市」也能找到「上海」的网格（差一个字是常态数据，不是异常）', async () => {
    seedGrid({ city: '上海' })
    const mid = insertCandidateMarker({ city: '上海市' })
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(r.status, r.raw).toBe(200)
    expect(r.body.brief.population.covered, '缺一层去「市」的兜底 ⇒ 用户看到「本市暂无网格」而实际有').toBe(true)
  })

  it('无网格城市 ⇒ covered=false + 明确原因，且结论不是 go', async () => {
    const mid = insertCandidateMarker({ city: '无网格市' })
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(r.status).toBe(200)
    expect(r.body.brief.population.covered).toBe(false)
    expect(r.body.brief.population.reason).toBe('no_grid_row')
    expect(r.body.brief.verdict.level).not.toBe('go')
    expect(r.body.brief.population.missingFields).toContain('到访人次')
  })

  it('🔴 只读：门店驱动行（没有推进记录）分析后，库里的行数不变', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    const before = getDb().prepare('SELECT COUNT(*) AS n FROM store_candidates').get().n
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(r.status, r.raw).toBe(200)
    const after = getDb().prepare('SELECT COUNT(*) AS n FROM store_candidates').get().n
    expect(after, '看一眼就在库里建行 ⇒ 浏览行为变成写操作').toBe(before)
    expect(r.body.origin.kind).toBe('store')
    expect(r.body.origin.storeType).toBe('重点候选')
  })

  it('已开业的门店不能当候选点位分析（400，且说清原因）', async () => {
    const mid = insertOpenStore({ lng: PT.lng, lat: PT.lat })
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(r.status).toBe(400)
    expect(r.body.message).toContain('不是候选门店')
  })

  it('别人的点位一律 404（⛔ 用 id 探测别人有没有这个点）', async () => {
    const mid = insertCandidateMarker({ uid: otherUserId })
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(r.status).toBe(404)
  })

  it('没有 id 也没有 markerId ⇒ 400', async () => {
    const r = await call('GET', '/api/candidates/brief')
    expect(r.status).toBe(400)
  })

  it('🔴 半径可换：3km 的圆内人口 ≥ 1km（同一点位两种看法）', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    const a = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=1000`)
    const b = await call('GET', `/api/candidates/brief?markerId=${mid}&radius=3000`)
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(b.body.brief.population.circlePop).toBeGreaterThanOrEqual(a.body.brief.population.circlePop)
    expect(b.body.brief.population.circleAreaKm2).toBeCloseTo(28.27, 1)
  })

  it('缺坐标 ⇒ 400 并指出去哪补', async () => {
    // markers.latitude/longitude 是 NOT NULL ⇒ 用 (0,0) 模拟「漏填」（这是现网最常见的脏值形态）
    const mid = insertCandidateMarker({ lat: 0, lng: 0 })
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(r.status).toBe(400)
    expect(r.body.message).toContain('坐标')
  })
})

describe('P5. 竞争 / 自有门店 / 商圈', () => {
  it('竞品只数半径内、且在营的（关店与未开业不算）', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    insertCompetitor({ brand: '竞品A', lng: PT.lng + 0.002, lat: PT.lat })          // ≈190m ✅
    insertCompetitor({ brand: '竞品A', lng: PT.lng - 0.003, lat: PT.lat })          // ≈285m ✅
    insertCompetitor({ brand: '竞品B', lng: PT.lng + 0.02, lat: PT.lat })           // ≈1.9km ❌ 出圈
    insertCompetitor({ brand: '竞品C', lng: PT.lng + 0.002, lat: PT.lat + 0.001, status: '店铺已关' })

    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(r.status, r.raw).toBe(200)
    expect(r.body.brief.competition.count).toBe(2)
    expect(r.body.brief.competition.byBrand[0]).toEqual({ brand: '竞品A', count: 2 })
  })

  it('🔴 同品牌 2km 内 ≥2 家 ⇒ 饱和 ⇒ hold', async () => {
    seedGrid()
    const mid = insertCandidateMarker({ brand: '食其家' })
    insertOpenStore({ brand: '食其家', lng: PT.lng + 0.004, lat: PT.lat, name: '老店1' })
    insertOpenStore({ brand: '食其家', lng: PT.lng - 0.005, lat: PT.lat, name: '老店2' })

    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(r.body.brief.own.withinR).toBe(2)
    expect(r.body.brief.own.saturated).toBe(true)
    expect(r.body.brief.verdict.level).toBe('hold')
    expect(r.body.brief.own.nearestName).toBeTruthy()
  })

  it('别家品牌的门店不算我的饱和（⛔ 跨品牌不判）', async () => {
    seedGrid()
    const mid = insertCandidateMarker({ brand: '食其家' })
    insertOpenStore({ brand: '滨寿司', lng: PT.lng + 0.004, lat: PT.lat })
    insertOpenStore({ brand: '滨寿司', lng: PT.lng - 0.005, lat: PT.lat })

    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(r.body.brief.own.withinR).toBe(0)
    expect(r.body.brief.own.saturated).toBe(false)
  })

  it('商圈面覆盖该点 ⇒ contained + 评分；不覆盖 ⇒ 如实说未覆盖', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    seedDistrict({ contained: true })
    const a = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(a.body.brief.district.contained).toBe(true)
    expect(a.body.brief.district.name).toBe('测试商圈')
    expect(typeof a.body.brief.district.score).toBe('number')

    clearAll()
    seedGrid()
    const mid2 = insertCandidateMarker()
    seedDistrict({ contained: false })
    const b = await call('GET', `/api/candidates/brief?markerId=${mid2}`)
    expect(b.body.brief.district.contained).toBe(false)
    expect(b.body.brief.district.score).toBe(null)
  })

  it('响应带口径常量，供前端显示「2km / ≥2 家」而不硬编码', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    expect(r.body.consts.SATURATION_RADIUS_M).toBe(2000)
    expect(r.body.consts.SATURATION_MAX_OWN).toBe(2)
    expect(r.body.consts.COMPETITION_DENSE_MAX).toBe(35)
    expect(r.body.brief.provenance.cost).toContain('0 配额')
    // v1.13.379：联通可取档位也要回传（前端做升级口径提示，⛔ 自己写 [1000,3000,5000]）
    expect(r.body.consts.UNICOM_RADII).toEqual([1000, 3000, 5000])
  })

  it('🔴 报告里必须带升级建议（P2 的规则判定），且它本身不产生任何配额数字', async () => {
    seedGrid()
    const mid = insertCandidateMarker()
    const r = await call('GET', `/api/candidates/brief?markerId=${mid}`)
    const up = r.body.brief.upgrade
    expect(up).toBeTruthy()
    expect(['recommend', 'optional', 'not_now']).toContain(up.tier)
    expect(up.buys.length).toBeGreaterThan(0)
    // ⛔ 不许把「剩余配额」算进报告：那是用户状态，报告是快照（只有 quotaPerFetch 这个常量可以）
    expect(Object.keys(up).sort()).toEqual(
      ['buys', 'quotaPerFetch', 'radiusM', 'radiusNote', 'service', 'tier', 'title', 'why'].sort()
    )
  })
})

// ────────────────────────────────────────────────────────────────────────
// P6. 升级建议（P2：规则判定 —— 要不要花钱深入、按哪个半径买）
// ────────────────────────────────────────────────────────────────────────
describe('P6. 升级建议与半径映射', () => {
  const mk = (over = {}) => buildBriefModel({
    point: { name: 'X', brand: '食其家', city: CITY, lat: PT.lat, lng: PT.lng, radius: 1000, ...(over.point || {}) },
    grid: over.grid || { covered: true, reason: '' },
    density: over.density || { circlePop: 30000, whole: 2, partial: 3, thresholds: { n: 36, p25: 2000, p50: 4000, p70: 6000, p90: 8000 } },
    comp: over.comp || { count: 4, byBrand: [] },
    own: over.own || { hasBrand: true, brand: '食其家', nearestM: 3000, withinR: 0, radiusM: 2000, maxOwn: 2 },
    district: over.district || { covered: true, contained: true, name: 'D', score: 70 }
  })

  it('半径映射：同档原样、缺口向上取（⛔ 不许取更小的档）', () => {
    expect(pickUnicomRadius(1000)).toEqual({ radiusM: 1000, exact: true, covers: true })
    expect(pickUnicomRadius(3000)).toEqual({ radiusM: 3000, exact: true, covers: true })
    expect(pickUnicomRadius(500), '500m 报告要按 1km 买，否则报告里的人口买不到').toEqual({ radiusM: 1000, exact: false, covers: true })
    expect(pickUnicomRadius(1500), '1.5km 报告要按 3km 买').toEqual({ radiusM: 3000, exact: false, covers: true })
    expect(pickUnicomRadius(2000), '2km 报告要按 3km 买').toEqual({ radiusM: 3000, exact: false, covers: true })
  })

  it('🔴 报告半径 > 5km ⇒ 明说「范围小于本报告」，⛔ 不许假装覆盖', () => {
    const p = pickUnicomRadius(8000)
    expect(p.radiusM).toBe(5000)
    expect(p.covers).toBe(false)
    const m = mk({ point: { radius: 8000 } })
    expect(m.upgrade.radiusNote).toContain('小于')
  })

  it('口径说明三种情形必须分得开', () => {
    expect(mk({ point: { radius: 1000 } }).upgrade.radiusNote).toContain('一致')
    expect(mk({ point: { radius: 1500 } }).upgrade.radiusNote).toContain('包含')
    expect(mk({ point: { radius: 1500 } }).upgrade.radiusM).toBe(3000)
  })

  it('🔴 饱和 ⇒ not_now（唯一「明确不该花钱」的情形）', () => {
    const m = mk({ own: { hasBrand: true, brand: '食其家', nearestM: 400, withinR: 2, radiusM: 2000, maxOwn: 2 } })
    expect(m.verdict.level).toBe('hold')
    expect(m.upgrade.tier).toBe('not_now')
    expect(m.upgrade.why.join('|')).toContain('关一家开一家')
    // 业主拍板：仍要给 buys / 半径（按钮降级但可点，规则不替业主否决）
    expect(m.upgrade.buys.length).toBeGreaterThan(0)
    expect(m.upgrade.radiusM).toBe(1000)
  })

  it('🔴 客群未评 ⇒ recommend（免费层最无力，正是花钱最值的情形）', () => {
    const m = mk({ grid: { covered: false, reason: 'no_grid_row' }, density: null })
    expect(m.upgrade.tier).toBe('recommend')
    expect(m.upgrade.title).toContain('免费层')
    expect(m.upgrade.why.join('|')).toContain('未评')
  })

  it('🔴 没填城市 ⇒ 也说「免费层给不出」，⛔ 不许说成「本市没网格」', () => {
    const m = mk({ point: { city: '' }, grid: { covered: false, reason: 'no_city' }, density: null })
    expect(m.upgrade.tier).toBe('recommend')
    expect(m.upgrade.why.join('|')).toContain('没有填城市')
    expect(m.upgrade.why.join('|')).not.toContain('暂无本地 1km 网格')
  })

  it('密度过本市 70% 分位 ⇒ recommend（人多值得用真实到访/职住验证）', () => {
    // 圆面积 3.14 km² ⇒ 22,000 人 ≈ 7,006 人/km²，落在 p70(6000) 与 p90(8000) 之间
    const m = mk({ density: { circlePop: 22000, whole: 2, partial: 3, thresholds: { n: 36, p25: 2000, p50: 4000, p70: 6000, p90: 8000 } } })
    expect(m.population.level.key).toBe('p70')
    expect(m.upgrade.tier).toBe('recommend')
    expect(m.upgrade.title).toContain('70')
  })

  it('密度低 + 竞品不密集 ⇒ optional（先把免费层核验完）', () => {
    const m = mk({ density: { circlePop: 2000, whole: 1, partial: 1, thresholds: { n: 36, p25: 2000, p50: 4000, p70: 6000, p90: 8000 } }, comp: { count: 1, byBrand: [] } })
    expect(m.upgrade.tier).toBe('optional')
  })

  it('密度低但竞品密集 ⇒ optional，且理由点明「先看业态差异」', () => {
    const m = mk({ density: { circlePop: 2000, whole: 1, partial: 1, thresholds: { n: 36, p25: 2000, p50: 4000, p70: 6000, p90: 8000 } }, comp: { count: 20, byBrand: [] } })
    expect(m.upgrade.tier).toBe('optional')
    expect(m.upgrade.why.join('|')).toContain('业态差异')
  })

  it('🔴 买得到的字段只能来自 1001（⛔ 不许承诺没接的时段流量 1005，⛔ 不许说「收入」）', () => {
    const m = mk()
    expect(m.upgrade.service).toBe('1001')
    const text = m.upgrade.buys.join('|')
    expect(text).toContain('到访人口')
    expect(text).toContain('工作人口')
    expect(text).not.toContain('时段流量')
    expect(text).not.toContain('收入分档')
    expect(text).toContain('不是收入')
    // 常量本身也要与上面一致（防止有人只改计划不改常量）
    expect(UPGRADE_BUYS.join('|')).toBe(text)
  })

  it('一次取数消耗 1 次配额（与 fetchPointPopulation 一致，⛔ 前端不许自己写 1）', () => {
    expect(mk().upgrade.quotaPerFetch).toBe(1)
  })

  it('🔴 升级建议不许夹带「总分」或评分字段（单点没有可比集合）', () => {
    const up = mk().upgrade
    expect(JSON.stringify(up)).not.toMatch(/score|total|rank/i)
  })
})

