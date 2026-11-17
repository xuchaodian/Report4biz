/**
 * 智能选址 · **仅初筛模式**的行为测试（批次 375，业主 2026-11-17 要求）
 *
 * ── 业主的原始诉求 ────────────────────────────────────────────────────
 * 生产 `admin_quota.remaining_quota = 0`（平台从未采购联通配额）⇒ 页面被
 * `pool_exhausted` 挡住，用户连「这块地大概怎么样」都看不到，必须先掏钱才能试一次。
 * 而阶段 0/1（网格撒点 + 四维粗排）**本来就是免费的**，卡住它的只是 rank 里的余额闸门。
 * ⇒ 加一个 0 消耗、0 外网请求的 `/coarse` 端点。
 *
 * ── 本文件证明五件事 ───────────────────────────────────────────────────
 * ① **余额 0 也能出榜**：同一份参数，`/coarse` 200 而 `/rank` 400 `pool_exhausted`。
 * ② **一个外网请求都不发**：全局 `fetch` 换成抛错探针，`/coarse` 全程零调用。
 * ③ **尺子固定 65**：`denominator === 65`（crowd 30 + competition 25 + cannibal 10），
 *    ⛔ 不含商圈（20）—— 否则同一句「78 分」在有/无商圈图层的城市含义不同。
 * ④ **⛔ 不冒充选址评分**：响应里没有 `score` / `roughScore`，只有 `coarseScore`，
 *    且 `scored === false`。
 * ⑤ **无网格城市如实降级**：crowd 未评 ⇒ `denominatorUsed = 35` 并给 warning，
 *    ⛔ 不能拿标称 65 去解释一个只算了 2 个维度的分。
 *
 * ── 关键手法 ───────────────────────────────────────────────────────────
 * ⛔ 不 mock `smartsteps.js`：要证明的就是「这条路根本不碰联通」，
 *    一 mock 就变成「拿自己的假设验证自己的假设」。把全局 `fetch` 换成抛错探针。
 * ⚠️ 测试访问本地 express 因此不能用全局 fetch，改用 `node:http`。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-coarse-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb
/**
 * 🔴 geo 目录也必须指到临时目录。
 *    `geoStore.GEO_DIR` 默认是 `backend/uploads/shapefiles/geo` —— 本文件要造网格、
 *    必然调 `writeGeoText`，不隔离就会往**真实工程的 uploads** 里写 `<id>.geojson`，
 *    污染本地开发数据。（模块加载时求值，所以必须在动态 import 之前设置。）
 */
const tmpGeo = path.join(os.tmpdir(), `r4b-coarse-geo-${process.pid}-${Date.now()}`)
process.env.R4B_GEO_DIR = tmpGeo

let server, token, userId
let getDb, geoStoreMod

/** 外网请求探针：任何一次联通调用都算用例失败 */
const netSpy = vi.fn(() => { throw new Error('❌ 测试中不应发起外网请求') })

function call(method, p, body, tk = token) {
  return new Promise((resolve) => {
    const data = body !== undefined ? JSON.stringify(body) : null
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, path: p, method, headers: {
        ...(tk ? { Authorization: `Bearer ${tk}` } : {}),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      } },
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

/** 测试框：约 3.8km × 4.45km，稳稳装下多格 */
const BOX = [121.4000, 31.1700, 121.4400, 31.2100]
const CITY = '上海'

function bodyWith(over = {}) {
  return {
    bbox: BOX,
    stepM: 1000,
    radius: 1000,
    city: CITY,
    myBrand: '',
    cityMonth: '202609',
    topN: 20,
    preciseTopK: 10,
    minGapM: 800,
    saturation: { enabled: false, radiusM: 2000, maxOwn: 2 },
    ...over
  }
}

/**
 * 造一份 1km 人口网格（6×6），覆盖测试框。
 * ⚠️ 字段名必须是 `常住人口` —— `buildGridIndex` 只认这一个键（读 `居住人数` 会恒 0 且不报错）。
 * 人口按位置递增，让「相对分位」有区分度（全同值时分位分不出高低）。
 *
 * 🔴🔴 **必须写盘**（`writeGeoText`），不能只塞 `shapefiles.geojson` 列：
 *    `gridPopulation.findGridRow` 只 SELECT `id, name, city, field_names`（不带 geojson），
 *    随后 `attachGeo` 依次尝试「磁盘文件 → 行内残留列 → 空 FeatureCollection」。
 *    因为 SQL 没取 geojson，`row.geojson` 恒 undefined ⇒ 直接被置成空集合 ⇒
 *    `buildGridIndex` 得到 0 个 feature ⇒ `covered=false` ⇒ 整个用例静默走「无网格」分支。
 *    （这正是生产上「网格莫名不生效」的同一形态，写在这里免得下次又踩。）
 */
function seedGrid(city = CITY) {
  const { writeGeoText } = geoStoreMod
  const L0 = 121.3980
  const B0 = 31.1680
  const DX = 0.0105   // ≈ 1000m（31.2° 纬向）
  const DY = 0.0090   // ≈ 1000m
  const feats = []
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const lng = L0 + i * DX
      const lat = B0 + j * DY
      feats.push({
        type: 'Feature',
        properties: { 常住人口: 2000 + i * 1500 + j * 800 },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [lng, lat], [lng + DX, lat], [lng + DX, lat + DY], [lng, lat + DY], [lng, lat]
          ]]
        }
      })
    }
  }
  const fc = JSON.stringify({ type: 'FeatureCollection', features: feats })
  const info = getDb().prepare(
    `INSERT INTO shapefiles (name, geojson, field_names, feature_count, user_id, category, city)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(`${city}1km网格人口`, fc, JSON.stringify(['常住人口']), feats.length, userId, 'population', city)
  writeGeoText(Number(info.lastInsertRowid), fc)
}

function clearGrid() {
  getDb().prepare("DELETE FROM shapefiles WHERE category = 'population'").run()
}

/** 门店：`store_type='已开业'` + `store_status=''`（空串视为正常，NULL 会被 NOT IN 排除） */
function insertStore({ name, brand, lng, lat, uid = userId }) {
  getDb().prepare(
    `INSERT INTO markers (user_id, name, brand, latitude, longitude, store_type, store_status, merged_into)
     VALUES (?, ?, ?, ?, ?, '已开业', '', NULL)`
  ).run(uid, name, brand, lat, lng)
}

function clearStores() {
  getDb().prepare('DELETE FROM markers').run()
}

function insertPurchase({ lng, lat, radius = '[1000]', uid = userId }) {
  getDb().prepare(
    `INSERT INTO purchases (user_id, store_name, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid, '测试已购点', lng, lat, radius, '202608', 1, 'active',
    JSON.stringify({ apiResult: { '1001': { p0_sum: '120000', p1_sum: '30000', p2_sum: '8000', pall_sum: '158000' } } })
  )
}

function clearPurchases() {
  getDb().prepare('DELETE FROM purchases').run()
  try { getDb().prepare('DELETE FROM smartsteps_cache').run() } catch { /* 表还没建 */ }
}

/** 平台物理池归零 —— 本功能的核心使用场景 */
function drainPool() {
  getDb().prepare('UPDATE admin_quota SET initial_quota = 0, remaining_quota = 0 WHERE id = 1').run()
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  geoStoreMod = await import('../src/models/geoStore.js')

  const db = getDb()
  const u = db.prepare(`INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('coarse_admin', 'coarse_admin@test.local', 'x', 'admin', 0)
  userId = Number(u.lastInsertRowid)
  token = jwt.sign({ id: userId, username: 'coarse_admin', role: 'admin' }, cfg.JWT_SECRET, { expiresIn: '1h' })

  vi.stubGlobal('fetch', netSpy)

  const express = (await import('express')).default
  const router = (await import('../src/routes/site-select.js')).default
  const app = express()
  app.use(express.json())
  app.use('/api/site-select', router)
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
})

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r))
  vi.unstubAllGlobals()
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
  try { fs.rmSync(tmpGeo, { recursive: true, force: true }) } catch { /* 忽略 */ }
})

beforeEach(() => {
  clearPurchases()
  clearStores()
  clearGrid()
  seedGrid()
  drainPool()
  netSpy.mockClear()
})

// ────────────────────────────────────────────────────────────────────────
// C1. 核心价值：余额 0 也能出榜
// ────────────────────────────────────────────────────────────────────────
describe('C1. 余额 0 时仅初筛可用（本功能存在的唯一理由）', () => {
  it('🔴 同一份参数：/coarse 200 出榜，/rank 400 pool_exhausted', async () => {
    const c = await call('POST', '/api/site-select/coarse', bodyWith())
    expect(c.status, JSON.stringify(c.body)).toBe(200)
    expect(c.body.data.returned).toBeGreaterThan(0)

    const r = await call('POST', '/api/site-select/rank', bodyWith())
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('pool_exhausted')

    // 两条路都没发过一个外网请求（余额不足在精算前就返回）
    expect(netSpy).not.toHaveBeenCalled()
  })

  it('🔴 全程零外网、零扣费：quota.used = 0 且池余额不动', async () => {
    const before = getDb().prepare('SELECT remaining_quota FROM admin_quota WHERE id = 1').get().remaining_quota
    const c = await call('POST', '/api/site-select/coarse', bodyWith())
    expect(c.status).toBe(200)
    expect(c.body.data.quota.used).toBe(0)
    expect(c.body.data.quota.estimate).toBe(0)
    expect(netSpy).not.toHaveBeenCalled()
    const after = getDb().prepare('SELECT remaining_quota FROM admin_quota WHERE id = 1').get().remaining_quota
    expect(after).toBe(before)
  })

  it('池里有钱也照跑、照样 0 消耗（⛔ 不能"有余额就偷偷精算"）', async () => {
    getDb().prepare('UPDATE admin_quota SET initial_quota = 5000, remaining_quota = 1200 WHERE id = 1').run()
    netSpy.mockClear()
    const c = await call('POST', '/api/site-select/coarse', bodyWith())
    expect(c.status).toBe(200)
    expect(c.body.data.quota.used).toBe(0)
    expect(netSpy).not.toHaveBeenCalled()
    expect(getDb().prepare('SELECT remaining_quota FROM admin_quota WHERE id = 1').get().remaining_quota).toBe(1200)
  })
})

// ────────────────────────────────────────────────────────────────────────
// C2. 「65 分尺子」的口径
// ────────────────────────────────────────────────────────────────────────
describe('C2. 尺子固定 65，且不冒充选址评分', () => {
  it('denominator = 65，weights 只有三项且不含 district/access', async () => {
    const c = await call('POST', '/api/site-select/coarse', bodyWith())
    expect(c.status).toBe(200)
    const d = c.body.data
    expect(d.denominator).toBe(65)
    expect(d.denominatorUsed).toBe(65)
    expect(Object.keys(d.weights).sort()).toEqual(['cannibal', 'competition', 'crowd'])
    // 商圈即使有图层也⛔ 不进初筛尺子 —— 否则同一句「78 分」在有/无商圈的城市含义不同
    expect(d.weights.district).toBeUndefined()
    expect(d.weights.access).toBeUndefined()
  })

  it('🔴 scored:false，且响应里没有 score / roughScore（铁律 19 的仅初筛口径）', async () => {
    const c = await call('POST', '/api/site-select/coarse', bodyWith())
    expect(c.body.data.scored).toBe(false)
    expect(c.body.data.mode).toBe('coarse')

    // 逐字段检查：item 上只有 coarseScore，没有 score / roughScore
    for (const it of c.body.data.items) {
      expect(it.score).toBeUndefined()
      expect(it.roughScore).toBeUndefined()
      expect(Number.isFinite(it.coarseScore)).toBe(true)
    }
    // 整包文本里也不许出现这两个键名（防将来"顺手透一个"）
    expect(c.raw).not.toContain('roughScore')
    expect(c.raw).not.toContain('"score"')
  })

  it('🔴 排序与出分同源：coarseScore 单调不增', async () => {
    const c = await call('POST', '/api/site-select/coarse', bodyWith({ topN: 20 }))
    const scores = c.body.data.items.map((x) => x.coarseScore)
    expect(scores.length).toBeGreaterThan(1)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1])
    }
  })

  it('理由句说「本地网格底图，未查联通」，且⛔ 不出现工作/到访/话费', async () => {
    const c = await call('POST', '/api/site-select/coarse', bodyWith())
    const all = c.body.data.items.flatMap((x) => x.reason).join('|')
    expect(all).toContain('未查联通')
    for (const banned of ['工作', '到访', '话费']) {
      expect(all).not.toContain(banned)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────
// C3. 无网格城市如实降级
// ────────────────────────────────────────────────────────────────────────
describe('C3. 无本地网格的城市必须降级并说明', () => {
  it('🔴 denominatorUsed = 35 + warning，⛔ 不拿标称 65 解释一个只算两维的分', async () => {
    clearGrid()   // 城市没网格
    const c = await call('POST', '/api/site-select/coarse', bodyWith())
    expect(c.status, JSON.stringify(c.body)).toBe(200)
    const d = c.body.data
    expect(d.gridCovered).toBe(false)
    expect(d.denominator).toBe(65)        // 尺子标称值不变
    expect(d.denominatorUsed).toBe(35)    // 本批实际（65 - 客群 30）
    expect(d.warnings.join('|')).toContain('客群维度未评')
    // 仍然出榜（竞品 + 自牌两项免费维度），只是参考价值下降
    expect(d.returned).toBeGreaterThan(0)
    expect(netSpy).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────
// C4. 饱和剔除仍然生效（免费，且必须在任何付费步骤之前）
// ────────────────────────────────────────────────────────────────────────
describe('C4. 饱和保护在仅初筛里照常生效', () => {
  it('同品牌门店超门限的点被剔除，且全程零外网', async () => {
    // 3 家「测试牌」挤在框内西北角 ⇒ 该片点位 2km 内同品牌 ≥ 2 家 ⇒ 饱和
    for (let i = 0; i < 3; i++) {
      insertStore({ name: `测试店${i}`, brand: '测试牌', lng: 121.402 + i * 0.001, lat: 31.172 + i * 0.001 })
    }
    const c = await call('POST', '/api/site-select/coarse', bodyWith({
      myBrand: '测试牌',
      saturation: { enabled: true, radiusM: 2000, maxOwn: 2 }
    }))
    expect(c.status, JSON.stringify(c.body)).toBe(200)
    expect(c.body.data.saturatedDropped).toBeGreaterThan(0)
    expect(netSpy).not.toHaveBeenCalled()
  })

  it('未指定品牌 ⇒ 饱和跳过并如实 warning（⛔ 静默）', async () => {
    const c = await call('POST', '/api/site-select/coarse', bodyWith({
      myBrand: '',
      saturation: { enabled: true, radiusM: 2000, maxOwn: 2 }
    }))
    expect(c.body.data.warnings.join('|')).toContain('饱和保护已跳过')
  })
})

// ────────────────────────────────────────────────────────────────────────
// C5. 已购点：同尺同权参与，不特殊追加
// ────────────────────────────────────────────────────────────────────────
describe('C5. 已购点与格心点同尺同权', () => {
  it('框内已购点计入 purchasedInBox 且不产生额外消耗', async () => {
    insertPurchase({ lng: 121.4205, lat: 31.1905 })
    const c = await call('POST', '/api/site-select/coarse', bodyWith())
    expect(c.status, JSON.stringify(c.body)).toBe(200)
    expect(c.body.data.purchasedInBox).toBe(1)
    expect(c.body.data.quota.used).toBe(0)
    expect(netSpy).not.toHaveBeenCalled()
    // 仍保持单调 —— 正是「不特殊追加」要守的性质（追加点会被 push 到末尾但分更高）
    const scores = c.body.data.items.map((x) => x.coarseScore)
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1])
  })

  it('半径不符的已购点不计入免费额度（复用判据不能被初筛绕过）', async () => {
    insertPurchase({ lng: 121.4205, lat: 31.1905, radius: '[3000]' })
    const c = await call('POST', '/api/site-select/coarse', bodyWith({ radius: 1000 }))
    expect(c.body.data.purchasedInBox).toBe(0)
    expect(c.body.data.warnings.join('|')).toContain('无法复用')
  })
})

// ────────────────────────────────────────────────────────────────────────
// C6. 参数校验与非管理员闸门
// ────────────────────────────────────────────────────────────────────────
describe('C6. 参数与权限', () => {
  it('框选面积超限 ⇒ 400（与 estimate/rank 同一套错误码）', async () => {
    const c = await call('POST', '/api/site-select/coarse', bodyWith({ bbox: [110, 20, 120, 30] }))
    expect(c.status).toBe(400)
    // ⚠️ 校验失败统一是 `bad_params`，具体哪一条在 `errors[]` 里 —— ⛔ 不要凭空发明 bbox_too_large
    expect(c.body.code).toBe('bad_params')
    expect(JSON.stringify(c.body.errors)).toContain('bbox')
  })

  it('半径不在允许档位 ⇒ 400', async () => {
    const c = await call('POST', '/api/site-select/coarse', bodyWith({ radius: 777 }))
    expect(c.status).toBe(400)
    expect(c.body.code).toBe('bad_params')
  })

  it('未登录 ⇒ 401（⛔ 建成公开端点）', async () => {
    const c = await call('POST', '/api/site-select/coarse', bodyWith(), null)
    expect(c.status).toBe(401)
  })
})
