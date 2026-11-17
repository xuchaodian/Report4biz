/**
 * 智能选址 · 「改半径重扣」的行为测试（批次 374，业主 2026-11-17 要求）
 *
 * ── 业主的原始问题 ────────────────────────────────────────────────────
 * 「把『改半径重扣』也处理掉」—— 我在地图上框了一块、花 30 次精算完，
 * 觉得半径不合适改成 1500 米又跑一遍，30 次配额全没了，界面上一个字都不提。
 *
 * ── 先说清一个改变方案性质的事实 ──────────────────────────────────────
 * 「改半径重扣」在本系统里**不是**「换个半径重扣」，多数情况是
 * 「换到一个联通侧根本不存在可复用数据的半径」：
 *   · `purchases.radius` 只可能是 `REPORT_RADII = [1000, 3000, 5000]`（报告购买端点校验）
 *   · 智能选址只能选 `SITE_RADIUS_CHOICES = [500, 1000, 1500, 3000]`
 *   · **交集只有 1000 和 3000** —— 500 和 1500 这两档，报告侧从来不卖。
 * 所以界面上⛔ 不能说「改回原半径」，必须说「改回 1000 或 3000」；
 * 也不能把 5000 当建议（选址下拉框里没有它）。
 * 这条事实由 R3、R6 两个用例守。
 *
 * ── 本文件证明四件事 ───────────────────────────────────────────────────
 * ① **不再静默**：半径不符的已购记录会被数出来（`purchasedRadiusMismatch`），
 *    并带上「那些点买过哪些半径」（`purchasedRadii`）与「改回哪一档有用」（`reusableRadii`）。
 * ② **建议必须可执行**：`reusableRadii` 已与 `SITE_RADIUS_CHOICES` 求交，
 *    绝不会出现「建议改回 5000 米」而下拉框里没有 5000。
 * ③ **预估不再偏低**：`probeReusable` 与取数侧同口径（`parsePopulation1001` 成功才算命中）。
 *    旧实现只判 `result_data` 非空 ⇒ `cacheHitGuess` 偏大 ⇒ 「预计消耗」低于实际扣费。
 * ④ **`parseRadii` 是唯一解析口径**：`"[1000]"` / `"[1000,3000]"` / 裸数字 / 脏值全部覆盖。
 *
 * ── 关键手法 ───────────────────────────────────────────────────────────
 * ⛔ 不 mock `smartsteps.js`：要证明的是「预估与实际扣费同口径」，
 *    一 mock 就变成「拿自己的假设验证自己的假设」。把全局 `fetch` 换成一调用就抛错的探针。
 * ⚠️ 测试访问本地 express 因此不能用全局 fetch，改用 `node:http`。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-radius-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let server, token, userId
let getDb, getPoolRemaining, jwtSign, enumerateGrid, parseRadii

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
 * 测试框：约 3.8km × 4.45km。
 * ⚠️ 不能用「只装得下一格」的小框 —— 格心按绝对网格取值，
 *    框比一格还小时格心可能落在框外，已购点直接被 bbox 过滤掉（见 siteGridAlign.test.js）。
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

/** 合法 1001（`parsePopulation1001` 能解析出数） */
const RESULT_1001 = JSON.stringify({
  apiResult: { '1001': { p0_sum: '120000', p1_sum: '30000', p2_sum: '8000', pall_sum: '158000' } }
})
/**
 * 有 1001 这个键、但内容为空壳 —— `LIKE '%"1001"%'` 会命中，`parsePopulation1001` 返回 null。
 * 这正是「预估偏高」的真实触发形态：旧 probeReusable 判它「可复用」，取数侧却会去扣费。
 */
const RESULT_EMPTY_1001 = JSON.stringify({ apiResult: { '1001': {} } })

function insertPurchase({ lng, lat, radius = '[1000]', result = RESULT_1001, status = 'active', uid = userId }) {
  getDb().prepare(
    `INSERT INTO purchases (user_id, store_name, center_lng, center_lat, radius, city_month, quota_used, status, result_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid, '测试已购点', lng, lat, radius, '202608', 1, status, result)
}

function clearPurchases() {
  getDb().prepare('DELETE FROM purchases').run()
  try { getDb().prepare('DELETE FROM smartsteps_cache').run() } catch { /* 表还没建 */ }
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
  const keyMod = await import('../src/utils/reuseKey.js')
  parseRadii = keyMod.parseRadii

  const db = getDb()
  const u = db.prepare(`INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('radius_admin', 'radius_admin@test.local', 'x', 'admin', 0)
  userId = Number(u.lastInsertRowid)
  token = jwtSign({ id: userId, username: 'radius_admin', role: 'admin' })
  db.prepare(`UPDATE admin_quota SET initial_quota = 5000, remaining_quota = 1000 WHERE id = 1`).run()

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
})

beforeEach(() => {
  clearPurchases()
  netSpy.mockClear()
})

// ────────────────────────────────────────────────────────────────────────
// R1. parseRadii —— 唯一解析口径
// ────────────────────────────────────────────────────────────────────────
describe('R1. parseRadii 唯一解析口径', () => {
  it('JSON 字符串（落库标准形态）', () => {
    expect(parseRadii('[1000]')).toEqual([1000])
    expect(parseRadii('[1000,3000]')).toEqual([1000, 3000])
    // 落库顺序不保证，必须自己排序，否则建议文案是「3000 或 1000」
    expect(parseRadii('[3000,1000]')).toEqual([1000, 3000])
  })

  it('裸数字 / 裸字符串（手工补数据、老版本遗留）', () => {
    expect(parseRadii(1000)).toEqual([1000])
    expect(parseRadii('1000')).toEqual([1000])
    expect(parseRadii(' 1000 ')).toEqual([1000])
  })

  it('已解析数组', () => {
    expect(parseRadii([3000, 1000, 1000])).toEqual([1000, 3000])
  })

  it('脏值一律空数组，⛔ 不抛异常（一条脏数据不能让整单 estimate 500）', () => {
    for (const bad of [null, undefined, '', '   ', '[abc]', '{}', 'NaN', [], [null], ['']]) {
      expect(() => parseRadii(bad)).not.toThrow()
      expect(parseRadii(bad)).toEqual([])
    }
  })

  it('🔴 空串不能变成「半径 0 米」（Number("") === 0 的坑）', () => {
    expect(parseRadii('')).toEqual([])
    expect(parseRadii([0])).toEqual([])
    expect(parseRadii([''])).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────
// R2~R3. estimate：半径不符必须被数出来、说清、并给出可执行的建议
// ────────────────────────────────────────────────────────────────────────
describe('R2. 半径不符不再静默（estimate，0 消耗）', () => {
  it('空库 ⇒ 半径为 0，没有任何半径告警', async () => {
    const r = await call('POST', '/api/site-select/estimate', bodyWith())
    expect(r.status).toBe(200)
    expect(r.body.data.purchasedRadiusMismatch).toBe(0)
    expect(r.body.data.purchasedRadii).toEqual([])
    expect(r.body.data.reusableRadii).toEqual([])
    expect(r.body.data.warnings.join('|')).not.toContain('无法复用')
  })

  it('🔴 买过 3000、本次用 1000 ⇒ 数出 1 条，并建议改回 3000', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, radius: '[3000]' })

    const r = await call('POST', '/api/site-select/estimate', bodyWith({ radius: 1000 }))
    expect(r.status).toBe(200)
    const d = r.body.data
    expect(d.purchasedRadiusMismatch).toBe(1)          // ★ 旧实现这里是静默的
    expect(d.purchasedInBox).toBe(0)
    expect(d.purchasedRadii).toEqual([3000])
    expect(d.reusableRadii).toEqual([3000])
    expect(d.radius).toBe(1000)
    // 文案必须点明「本次按全额消耗」，⛔ 不能只说一句泛泛的「改半径会重扣」
    expect(d.warnings.join('|')).toContain('无法复用')
    expect(d.warnings.join('|')).toContain('全额消耗配额')
    expect(d.warnings.join('|')).toContain('3000')
  })

  it('买过 [1000,3000]、本次 1000 ⇒ 可复用，不算 mismatch', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, radius: '[1000,3000]' })

    const r = await call('POST', '/api/site-select/estimate', bodyWith({ radius: 1000 }))
    const d = r.body.data
    expect(d.purchasedInBox).toBe(1)
    expect(d.purchasedRadiusMismatch).toBe(0)
  })

  it('同框一半匹配一半不匹配 ⇒ 两个数分开报，⛔ 不互相顶掉', async () => {
    const grids = enumerateGrid(BOX, 1000).points
    insertPurchase({ lng: grids[0].lng, lat: grids[0].lat, radius: '[1000]' })
    insertPurchase({ lng: grids[5].lng, lat: grids[5].lat, radius: '[3000]' })

    const r = await call('POST', '/api/site-select/estimate', bodyWith({ radius: 1000 }))
    const d = r.body.data
    expect(d.purchasedInBox).toBe(1)
    expect(d.purchasedRadiusMismatch).toBe(1)
  })

  it('多档混合 ⇒ purchasedRadii 去重升序（文案「1000 / 3000」而不是「3000 / 1000」）', async () => {
    const grids = enumerateGrid(BOX, 1000).points
    insertPurchase({ lng: grids[0].lng, lat: grids[0].lat, radius: '[3000]' })
    insertPurchase({ lng: grids[5].lng, lat: grids[5].lat, radius: '[1000,3000]' })

    const r = await call('POST', '/api/site-select/estimate', bodyWith({ radius: 1500 }))
    const d = r.body.data
    expect(d.purchasedRadiusMismatch).toBe(2)
    expect(d.purchasedRadii).toEqual([1000, 3000])
    // 1500 报告侧不卖 ⇒ 两个建议档位都可用
    expect(d.reusableRadii).toEqual([1000, 3000])
  })
})

describe('R3. 建议必须在选址下拉框里真的能选（交集，⛔ 不是全部已购半径）', () => {
  it('🔴 买过 5000（报告卖、选址不卖）⇒ 不给建议，并明说档位不重合', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, radius: '[5000]' })

    const r = await call('POST', '/api/site-select/estimate', bodyWith({ radius: 1000 }))
    const d = r.body.data
    expect(d.purchasedRadiusMismatch).toBe(1)
    expect(d.purchasedRadii).toEqual([5000])       // 如实告诉他买过 5000
    expect(d.reusableRadii).toEqual([])            // ★ 但⛔ 不能建议「改回 5000」
    expect(d.warnings.join('|')).toContain('选不到')
    expect(d.warnings.join('|')).toContain('500 / 1000 / 1500 / 3000')
  })

  it('买过 [3000,5000] ⇒ 建议里只留 3000（5000 过滤掉）', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, radius: '[3000,5000]' })

    const r = await call('POST', '/api/site-select/estimate', bodyWith({ radius: 1000 }))
    const d = r.body.data
    expect(d.purchasedRadii).toEqual([3000, 5000])
    expect(d.reusableRadii).toEqual([3000])
  })

  it('选址四档全部可作为建议（500 / 1500 也是合法建议 —— 它们只是报告侧不卖，选址侧能选）', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, radius: '[500,1500]' })

    const r = await call('POST', '/api/site-select/estimate', bodyWith({ radius: 1000 }))
    expect(r.body.data.reusableRadii).toEqual([500, 1500])
  })
})

// ────────────────────────────────────────────────────────────────────────
// R4~R5. 预估与实际扣费同口径（probeReusable 修高估）
// ────────────────────────────────────────────────────────────────────────
describe('R4. probeReusable 不再高估「可复用」（预估 ⛔ 低于实际扣费）', () => {
  it('🔴 1001 空壳 ⇒ 不算可复用（旧实现只判 result_data 非空，会多算一次）', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, radius: '[1000]', result: RESULT_EMPTY_1001 })

    const r = await call('POST', '/api/site-select/estimate', bodyWith({ radius: 1000 }))
    const d = r.body.data
    // 空壳 1001 既不该算「可复用」，也不该被并进候选（否则界面说免费、实际扣钱）
    expect(d.purchasedInBox, '1001 空壳不能算「不额外消耗配额」').toBe(0)
    expect(d.cacheHitGuess, '1001 空壳不能算「可复用已购数据」').toBe(0)
  })

  it('合法 1001 ⇒ 确实算可复用（对照组，证明上一条不是「永远为 0」）', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, radius: '[1000]', result: RESULT_1001 })

    const r = await call('POST', '/api/site-select/estimate', bodyWith({ radius: 1000 }))
    const d = r.body.data
    expect(d.purchasedInBox).toBe(1)
    expect(d.cacheHitGuess).toBeGreaterThanOrEqual(1)
  })

  it('半径不符的已购点 ⛔ 不算可复用（否则预估偏低、实际扣费）', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, radius: '[3000]' })

    const r = await call('POST', '/api/site-select/estimate', bodyWith({ radius: 1000 }))
    expect(r.body.data.cacheHitGuess).toBe(0)
  })
})

describe('R5. estimate 全程零消耗', () => {
  it('预估不扣池、不联网（改半径这件事本身不花钱，只有真正生成才花）', async () => {
    const g = enumerateGrid(BOX, 1000).points[0]
    insertPurchase({ lng: g.lng, lat: g.lat, radius: '[3000]' })
    const before = getPoolRemaining(getDb())

    const r = await call('POST', '/api/site-select/estimate', bodyWith({ radius: 1500 }))
    expect(r.status).toBe(200)
    expect(getPoolRemaining(getDb())).toBe(before)
    expect(netSpy).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────
// R6. rank 侧也要说 —— 用户绕过 estimate 直接调接口时不能失声
// ────────────────────────────────────────────────────────────────────────
describe('R6. rank 的 warnings 同样带上半径不一致', () => {
  it('直接调 rank（未经 estimate）也会告知半径不符', async () => {
    // 同一框内混合两种已购：一个 1000（能复用，保证 rank 不会因「全部点位取数失败」而 400）、
    // 一个 3000（半径不符）。真实场景就是这样混着的，也正好证明两件事能同时成立。
    const grids = enumerateGrid(BOX, 1000).points
    insertPurchase({ lng: grids[0].lng, lat: grids[0].lat, radius: '[1000]' })
    insertPurchase({ lng: grids[5].lng, lat: grids[5].lat, radius: '[3000]' })

    const r = await call('POST', '/api/site-select/rank', bodyWith({ radius: 1000 }))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    // ① 半径不符要说
    expect(r.body.data.warnings.join('|')).toContain('无法复用')
    // ② 同框里那个半径匹配的点照样免费进了结果
    expect(r.body.data.quota.fromCacheCount).toBeGreaterThanOrEqual(1)
    expect(r.body.data.items.some((it) => it.dataSource === 'purchase')).toBe(true)
    // ③ 半径不符的点没有免费数据可用 ⇒ 其余格心确实尝试联网（被探针拦下）
    expect(netSpy.mock.calls.length).toBeGreaterThan(0)
  })
})
