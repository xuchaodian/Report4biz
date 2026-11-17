/**
 * 智能选址 · 「框内已购点自动复用」的行为测试（批次 373，业主 2026-11-17 要求）
 *
 * ── 业主的原始问题 ────────────────────────────────────────────────────
 * 「我地图上勾画了徐家汇范围，这个范围内我已经买过 2 个位置的联通人口数据」——
 * 这笔钱能不能直接吃回来？
 *
 * ── 这个文件证明两件事 ─────────────────────────────────────────────────
 * ① **真的不花钱**：框内已购点进入精算时，`fetchPointPopulation` 命中 `purchases`
 *    直接返回 `source='purchase'`，**一次外网请求都不发**、物理池一分不动。
 * ② **真的会被评估**：这点最容易被漏掉。格距 1000m、`minGapM` 默认 800m，
 *    框内任何非格心点离最近格心都 ≤707m ⇒ 第一层 NMS 必定把它剔掉。
 *    所以 `runCoarse` 末尾有一段「已购点追加进 preciseList」的补丁，
 *    本文件的 A3 用例就是专门守它 —— 删掉那段，A3 立刻红。
 *
 * ── 关键手法 ───────────────────────────────────────────────────────────
 * ⛔ **不 mock `smartsteps.js`**（`siteSelectBurn.test.js` 是 mock 的，那里只关心熔断）。
 *    这里必须走真实的 `fetchPointPopulation`，否则「命中已购数据不扣费」根本没被执行。
 *    为防真打联通：把全局 `fetch` 换成「一调用就抛错」的探针，并统计调用次数。
 *    未命中的点会因此失败被剔除（`crowdDropped`），这正是我们要的对照。
 * ⚠️ 测试自己访问本地 express 因此**不能用全局 fetch**，改用 `node:http`。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-reuse-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let server, base, token, userId
let getDb, getPoolRemaining, jwtSign, enumerateGrid, planarMeters
/** 外网请求探针：命中已购数据时，这个函数的调用次数必须为 0 */
const netSpy = vi.fn(() => { throw new Error('❌ 测试中不应发起外网请求') })

/** 用 node:http 调本地服务（不能用全局 fetch —— 它已被替换成探针） */
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
          resolve({ status: res.statusCode, body: json })
        })
      }
    )
    req.on('error', () => resolve({ status: 0, body: null }))
    if (data) req.write(data)
    req.end()
  })
}

/**
 * 测试用框：约 3.8km × 4.45km（0.04° 见方）。
 *
 * ⚠️ 为什么不能用「只装得下一格」的小框：格心对齐绝对网格后，**框比一格还小时
 *    格心可能落在框外**（保底取的是「包含框中心的那一格」，它的格心不保证在框内）。
 *    已购点若取格心坐标，就会落在 bbox 之外 ⇒ `mergePurchasedPoints` 的框内过滤直接
 *    把它排除，用例变成测空气。这条已知行为在 `siteGridAlign.test.js` 里有记录。
 */
const BOX = [121.4000, 31.1700, 121.4400, 31.2100]

function bodyWith(over = {}) {
  return {
    bbox: BOX,
    stepM: 1000,
    radius: 1000,
    city: '上海',
    myBrand: '',
    cityMonth: '202609',
    topN: 20,
    preciseTopK: 10,
    minGapM: 800,
    saturation: { enabled: false, radiusM: 2000, maxOwn: 2 },
    ...over
  }
}

/** 一份最小合法的 1001 人口数据（`parsePopulation1001` 能解析） */
const RESULT_1001 = JSON.stringify({
  apiResult: {
    '1001': { p0_sum: '120000', p1_sum: '30000', p2_sum: '8000', pall_sum: '158000' }
  }
})
/** 只有 1005、没有 1001 的数据 —— 不该被当作「可复用人口」 */
const RESULT_NO_1001 = JSON.stringify({ apiResult: { '1005': { foo: 1 } } })

function insertPurchase({ lng, lat, radius = '[1000]', result = RESULT_1001, status = 'active', uid = userId }) {
  getDb().prepare(
    `INSERT INTO purchases (user_id, store_name, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid, '测试已购点', lng, lat, radius, '202608', 1, status, result)
}

function clearPurchases() {
  getDb().prepare('DELETE FROM purchases').run()
  // smartsteps_cache 由 fetchPointPopulation 首次调用时才建表 ⇒ 早期用例里可能还不存在
  try { getDb().prepare('DELETE FROM smartsteps_cache').run() } catch { /* 表还没建，忽略 */ }
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  jwtSign = (payload) => jwt.sign(payload, cfg.JWT_SECRET, { expiresIn: '1h' })

  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  const poolMod = await import('../src/utils/quotaPool.js')
  getPoolRemaining = poolMod.getPoolRemaining
  const gridMod = await import('../src/utils/potentialGrid.js')
  enumerateGrid = gridMod.enumerateGrid
  planarMeters = gridMod.planarMeters

  const db = getDb()
  const u = db.prepare(`INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('reuse_admin', 'reuse_admin@test.local', 'x', 'admin', 0)
  userId = Number(u.lastInsertRowid)
  token = jwtSign({ id: userId, username: 'reuse_admin', role: 'admin' })

  db.prepare(`UPDATE admin_quota SET initial_quota = 5000, remaining_quota = 1000 WHERE id = 1`).run()

  // 🔴 把外网请求换成一调用就抛错的探针
  vi.stubGlobal('fetch', netSpy)

  const express = (await import('express')).default
  const router = (await import('../src/routes/site-select.js')).default
  const app = express()
  app.use(express.json())
  app.use('/api/site-select', router)
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r))
  vi.unstubAllGlobals()
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
})

beforeEach(() => {
  clearPurchases()
  netSpy.mockClear()
})

describe('B1. 框内已购点并入候选（estimate，0 消耗）', () => {
  it('空库 ⇒ purchasedInBox=0，且没有任何「已购」提示', async () => {
    const r = await call('POST', '/api/site-select/estimate', bodyWith())
    expect(r.status).toBe(200)
    expect(r.body.data.purchasedInBox).toBe(0)
    // ⚠️ 断言要精确到「命中 N 个已购人口点」这句：estimate 里本来就有一句
    //    「更换评估半径将重新消耗配额（已购数据按半径复用）」，用宽泛的「已购」会误报。
    expect(r.body.data.warnings.join('|')).not.toContain('已购人口点')
  })

  it('框内有 1 个同半径已购点 ⇒ purchasedInBox=1 并给出提示', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat })
    const r = await call('POST', '/api/site-select/estimate', bodyWith())
    expect(r.status).toBe(200)
    expect(r.body.data.purchasedInBox).toBe(1)
    expect(r.body.data.warnings.join('|')).toContain('已购人口点')
  })

  it('🔴 半径不匹配（存 3000、本次 1000）⇒ 不并入（否则会把注定花钱的点当免费）', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, radius: '[3000,5000]' })
    const r = await call('POST', '/api/site-select/estimate', bodyWith())
    expect(r.body.data.purchasedInBox).toBe(0)
  })

  it('radius 存成 JSON 数组但含本次半径 ⇒ 仍然并入', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, radius: '[1000,3000]' })
    const r = await call('POST', '/api/site-select/estimate', bodyWith())
    expect(r.body.data.purchasedInBox).toBe(1)
  })

  it('已购数据里没有 1001（只有 1005）⇒ 不并入', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, result: RESULT_NO_1001 })
    const r = await call('POST', '/api/site-select/estimate', bodyWith())
    expect(r.body.data.purchasedInBox).toBe(0)
  })

  it('已购点在框外 ⇒ 不并入（只评估用户圈定的范围）', async () => {
    insertPurchase({ lng: 121.60, lat: 31.40 })
    const r = await call('POST', '/api/site-select/estimate', bodyWith())
    expect(r.body.data.purchasedInBox).toBe(0)
  })

  it('已购记录 status 非 active（如已退款）⇒ 不并入', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, status: 'refunded' })
    const r = await call('POST', '/api/site-select/estimate', bodyWith())
    expect(r.body.data.purchasedInBox).toBe(0)
  })
})

describe('B2. 复用真的不花钱（rank，真实 fetchPointPopulation）', () => {
  it('🔴 已购点正好落在格心 ⇒ 该次精算命中 purchases，不联网、不计消耗', async () => {
    const grids = enumerateGrid(BOX, 1000).points
    const g = grids[0]
    insertPurchase({ lng: g.lng, lat: g.lat })
    const before = getPoolRemaining(getDb())

    const r = await call('POST', '/api/site-select/rank', bodyWith())
    expect(r.status).toBe(200)
    expect(r.body.success).toBe(true)

    // 池一分没动
    expect(getPoolRemaining(getDb())).toBe(before)
    expect(r.body.data.quota.used).toBe(0)
    // 恰有 1 次是「复用」而非「新查」—— 这就是那个已购点
    expect(r.body.data.quota.fromCacheCount).toBe(1)

    // 其余格心没有人口数据 ⇒ 确实尝试联网并被探针拦下（对照组，证明上面那条不是因为「没查就成功」）
    expect(netSpy.mock.calls.length, '未命中的格心应尝试联网').toBeGreaterThan(0)
    expect(netSpy.mock.calls.length).toBeLessThan(grids.length)

    // 结果里该点被标为 purchase 来源
    const hit = r.body.data.items.find((it) => it.dataSource === 'purchase')
    expect(hit, '结果中应含 dataSource=purchase 的点').toBeTruthy()
    expect(hit.center[0]).toBeCloseTo(Number(g.lng.toFixed(6)), 5)
    expect(hit.center[1]).toBeCloseTo(Number(g.lat.toFixed(6)), 5)
  })

  it('🔴 已购点离格心 400m（会被第一层 NMS 剔掉）⇒ 仍被追加进精算', async () => {
    // 这条专守「最后一公里」补丁：删掉 runCoarse 末尾的追加逻辑，本用例立刻红
    const g = enumerateGrid(BOX, 1000).points[0]
    const lng = g.lng
    const lat = g.lat + 400 / 111320     // 正北 400m，离该格心 400m < minGapM 800
    insertPurchase({ lng, lat })

    const r = await call('POST', '/api/site-select/rank', bodyWith())
    expect(r.status).toBe(200)

    // 精算点数 = 至多 preciseTopK(10) 个格心 + 1 个追加的已购点
    expect(r.body.data.coarseTopK).toBeGreaterThanOrEqual(10)
    expect(r.body.data.coarseTopK).toBeLessThanOrEqual(11)
    expect(netSpy.mock.calls.length, '未命中的格心应尝试联网').toBeGreaterThan(0)
    expect(r.body.data.quota.used).toBe(0)

    const hit = r.body.data.items.find((it) => it.dataSource === 'purchase')
    expect(hit, '离格心 400m 的已购点也必须出现在结果里').toBeTruthy()
    // 坐标必须是已购点原始坐标（不能被「吸附到格心」）
    expect(hit.center[1]).toBeCloseTo(Number(lat.toFixed(6)), 5)
  })

  it('已购点之间太近 ⇒ 只评估一个（不做成「复读机」）', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat })
    insertPurchase({ lng: g.lng + 0.0002, lat: g.lat + 0.0002 })   // 约 26m 外
    const r = await call('POST', '/api/site-select/rank', bodyWith())
    expect(r.status).toBe(200)
    const purchaseItems = r.body.data.items.filter((it) => it.dataSource === 'purchase')
    expect(purchaseItems.length).toBe(1)
  })
})
