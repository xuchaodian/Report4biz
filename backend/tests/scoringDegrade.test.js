/**
 * 评分引擎「配额不足 / 上游异常」两类降级的回归钉子
 * （v1.13.222 · 批次 218 遗留项 ①）
 *
 * 立档背景：
 *   人口评分（`queryPointPopulation`）此前在**配额不足**时 `return null`，
 *   上层按「数据缺失」处理 ⇒ `calcPopulationScore(null)` 返回默认 60 分
 *   ⇒ 人口（权重 0.40）是**编造**的，而用户拿到一个看似合理的综合评分去做开店决策。
 *   更隐蔽的是 `scoreBatch` 用 `Promise.allSettled` 却只 push fulfilled
 *   ⇒ rejected 被**静默丢弃**（少点位且无提示）。
 *
 * 本批确立的两条语义边界（⛔ 不得回退）：
 *   A. 「配额不足」= 用户**可行动**（去采购）⇒ 抛 QuotaGateError，由路由转统一响应，
 *      前端走 requireQuota 引导。**绝不**降级为默认分。
 *   B. 「上游失败 / 空数据 / 异常」= 用户**无从行动** ⇒ 照常出分，但必须
 *      `degradedDims` 显式标注 + `degradeReason` 说明原因（前端据此提示）。
 *
 * 另外两条防回归：
 *   C. 缓存命中**在配额检查之前**返回 ⇒ 配额为 0 但全缓存命中时仍应正常出分
 *      （批量场景尤其重要，否则会把"免费的历史数据"也一并拒掉）。
 *   D. scoreBatch 中任一点配额不足 ⇒ **整批抛错**（缺人口的排序不可信），
 *      但**不得**因个别点而丢掉其它已成功的点（非 gate 类失败仍照常收录）。
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，避免触碰 backend/database/webgis.db 真实库。
 * 上游 HTTP 一律打桩（stub 全局 fetch），本测试**零外部网络、零真实计费**。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDb = path.join(os.tmpdir(), `r4b-scoring-degrade-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let getDb, scoreLocation, scoreBatch, initCacheTable, QuotaGateError

const originalFetch = globalThis.fetch

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  const engMod = await import('../src/utils/scoringEngine.js')
  scoreLocation = engMod.scoreLocation
  scoreBatch = engMod.scoreBatch
  const ssMod = await import('../src/routes/smartsteps.js')
  initCacheTable = ssMod.initCacheTable
  const gateMod = await import('../src/utils/quotaGate.js')
  QuotaGateError = gateMod.QuotaGateError
})

afterAll(() => {
  globalThis.fetch = originalFetch
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ---------- 上游 HTTP 打桩 ----------

/** 构造一个最小 Response 替身 */
function jsonRes(obj, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj)
  }
}

/**
 * 装上 fetch 桩。
 * @param {(url:string)=>object} onGetData 针对联通 getData 的返回（默认返回正常人口）
 */
function stubFetch(onGetData) {
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('getAuthorization')) return jsonRes({ code: 200, data: 'fake-token' })
    if (u.includes('restapi.amap.com')) return jsonRes({ count: '0' })   // 高德 POI
    if (u.includes('getData')) {
      return onGetData ? onGetData(u) : jsonRes({ code: 200, data: { 1001: { pall_sum: 50000 } } })
    }
    return jsonRes({})
  }
}

beforeEach(() => {
  stubFetch(null)
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

// ---------- 构造工具 ----------

let seq = 0
function mkUser(db, { role = 'user', quota = 0 } = {}) {
  seq += 1
  const name = `t_score_${process.pid}_${seq}`
  const r = db.prepare(
    `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`
  ).run(name, `${name}@t.local`, 'x', role, quota)
  return r.lastInsertRowid
}
function mkOrgWithMember(db, memberId) {
  const ownerId = mkUser(db, { role: 'user', quota: 0 })
  const org = db.prepare(`INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`).run('评分测试集团', ownerId)
  const orgId = org.lastInsertRowid
  db.prepare(`INSERT INTO org_members (org_id, user_id, member_role) VALUES (?, ?, 'member')`).run(orgId, memberId)
  return { orgId, ownerId }
}
function setPool(db, n) {
  db.prepare(`UPDATE admin_quota SET remaining_quota = ? WHERE id = 1`).run(n)
}
function getPool(db) {
  return db.prepare(`SELECT remaining_quota FROM admin_quota WHERE id = 1`).get()?.remaining_quota
}

/** 与 queryPointPopulation 的缓存 key 算法保持一致（精度 1e5 四舍五入） */
function cacheKey(v) {
  return Math.round(v * 100000) / 100000
}

/** 预置一条人口缓存（services='1001'） */
function seedCache(db, lng, lat, radiusM, pallSum) {
  initCacheTable(db)
  db.prepare(
    `INSERT OR REPLACE INTO smartsteps_cache (center_lng, center_lat, radius, city_month, services, result_data)
     VALUES (?, ?, ?, '202509', '1001', ?)`
  ).run(cacheKey(lng), cacheKey(lat), radiusM, JSON.stringify({ 1001: { pall_sum: pallSum } }))
}

const DEFAULT_WEIGHTS = { population: 0.40, competition: 0.25, support: 0.20, transport: 0.15 }

/** 断言一个 promise 以 QuotaGateError 拒绝，返回该错误便于细查 */
async function expectGateReject(promise) {
  let caught = null
  try {
    await promise
  } catch (e) {
    caught = e
  }
  expect(caught, '期望抛出 QuotaGateError，但正常返回了').toBeTruthy()
  expect(caught.isQuotaGate, '异常应带 isQuotaGate 标记').toBe(true)
  expect(caught).toBeInstanceOf(QuotaGateError)
  return caught
}

// ============================================================================
// A. 配额不足 ⇒ 抛错（绝不降级为默认分）
// ============================================================================

describe('A. 配额不足 → 抛 QuotaGateError（不产出分数）', () => {
  it('① 组织成员额度耗尽（own_exhausted）→ 抛错且带 gate 明细', async () => {
    const db = getDb()
    setPool(db, 100)
    const uid = mkUser(db, { role: 'user', quota: 5 })
    mkOrgWithMember(db, uid)
    // 5 次全部用掉 ⇒ 个人可用额度 0
    db.prepare(`INSERT INTO purchases (user_id, quota_used, status) VALUES (?, 5, 'active')`).run(uid)

    const err = await expectGateReject(scoreLocation({
      lng: 121.1001, lat: 31.1001, radius: 1000, weights: DEFAULT_WEIGHTS, user: { id: uid, role: 'user' }
    }))
    expect(err.gate.ok).toBe(false)
    expect(err.gate.reason).toBe('own_exhausted')
    expect(err.gate.own).toBe(0)
    expect(err.gate.need).toBe(1)
  })

  it('② 物理池耗尽（pool_exhausted）→ 抛错（admin 也不能绕过）', async () => {
    const db = getDb()
    setPool(db, 0)
    const err = await expectGateReject(scoreLocation({
      lng: 121.2002, lat: 31.2002, radius: 1000, weights: DEFAULT_WEIGHTS, user: { id: 1, role: 'admin' }
    }))
    expect(err.gate.reason).toBe('pool_exhausted')
    expect(err.gate.pool).toBe(0)
    setPool(db, 100)
  })

  it('③ 抛错发生在调用上游**之前** ⇒ 未扣减物理池（不烧钱）', async () => {
    const db = getDb()
    setPool(db, 50)
    const before = getPool(db)
    const uid = mkUser(db, { role: 'user', quota: 1 })
    mkOrgWithMember(db, uid)
    db.prepare(`INSERT INTO purchases (user_id, quota_used, status) VALUES (?, 1, 'active')`).run(uid)

    await expectGateReject(scoreLocation({
      lng: 121.2502, lat: 31.2502, radius: 1000, weights: DEFAULT_WEIGHTS, user: { id: uid, role: 'user' }
    }))
    expect(getPool(db), '闸门拒绝不得消耗物理池').toBe(before)
  })
})

// ============================================================================
// B. 上游异常 ⇒ 出分但显式标注降级
// ============================================================================

describe('B. 上游异常 → 出分但 degradedDims 显式标注', () => {
  it('④ 上游 500 → degradeReason=upstream_failed，且仍返回可用分数', async () => {
    const db = getDb()
    setPool(db, 100)
    stubFetch(() => jsonRes({ err: 'boom' }, { ok: false, status: 500 }))

    const r = await scoreLocation({
      lng: 121.3003, lat: 31.3003, radius: 1000, weights: DEFAULT_WEIGHTS, user: { id: 1, role: 'admin' }
    })
    expect(r.degradedDims).toContain('population')
    expect(r.degradeReason).toBe('upstream_failed')
    expect(r.populationDensity).toBeNull()
    expect(typeof r.score, '降级时仍应出分（用户无从行动，报错会让抖动期整站不可用）').toBe('number')
  })

  it('⑤ 上游返回空数据 → degradeReason=upstream_empty，且不扣配额', async () => {
    const db = getDb()
    setPool(db, 100)
    const before = getPool(db)
    // 全 0 数值 ⇒ checkIfDataIsEmpty 判空
    stubFetch(() => jsonRes({ code: 200, data: { 1001: { pall_sum: 0 } } }))

    const r = await scoreLocation({
      lng: 121.4004, lat: 31.4004, radius: 1000, weights: DEFAULT_WEIGHTS, user: { id: 1, role: 'admin' }
    })
    expect(r.degradedDims).toContain('population')
    expect(r.degradeReason).toBe('upstream_empty')
    expect(getPool(db), '空数据不扣配额').toBe(before)
  })

  it('⑥ 上游正常 → degradedDims 为空（不得误报降级）', async () => {
    const db = getDb()
    setPool(db, 100)
    stubFetch(() => jsonRes({ code: 200, data: { 1001: { pall_sum: 50000 } } }))

    const r = await scoreLocation({
      lng: 121.5005, lat: 31.5005, radius: 1000, weights: DEFAULT_WEIGHTS, user: { id: 1, role: 'admin' }
    })
    expect(r.degradedDims).toEqual([])
    expect(r.degradeReason).toBeNull()
    expect(r.populationDensity).toBe(50000)
  })
})

// ============================================================================
// C. 缓存命中优先于配额检查（免费路径不得被误伤）
// ============================================================================

describe('C. 缓存命中 → 不检查配额、不算降级', () => {
  it('⑦ 配额为 0 但缓存命中 ⇒ 仍正常出分（缓存免费）', async () => {
    const db = getDb()
    setPool(db, 0)                       // 物理池也空
    seedCache(db, 121.6006, 31.6006, 1000, 77000)

    const r = await scoreLocation({
      lng: 121.6006, lat: 31.6006, radius: 1000, weights: DEFAULT_WEIGHTS, user: { id: 1, role: 'admin' }
    })
    expect(r.degradedDims).toEqual([])
    expect(r.populationDensity).toBe(77000)
    expect(getPool(db), '缓存命中不得扣配额').toBe(0)
    setPool(db, 100)
  })
})

// ============================================================================
// D. scoreBatch 的错误处理
// ============================================================================

describe('D. scoreBatch：gate 失败整批抛，其余不丢点', () => {
  const batchConfig = {
    weight_population: 0.40, weight_competition: 0.25,
    weight_support: 0.20, weight_transport: 0.15,
    radius_km: 1.0, competition_threshold: 10
  }

  it('⑧ 任一点配额不足 → 整批抛错（缺人口的排序不可信）', async () => {
    const db = getDb()
    setPool(db, 100)
    const uid = mkUser(db, { role: 'user', quota: 1 })
    mkOrgWithMember(db, uid)
    db.prepare(`INSERT INTO purchases (user_id, quota_used, status) VALUES (?, 1, 'active')`).run(uid)

    const err = await expectGateReject(scoreBatch(
      [{ lng: 121.7007, lat: 31.7007 }, { lng: 121.7107, lat: 31.7107 }],
      batchConfig,
      { id: uid, role: 'user' }
    ))
    expect(err.gate.reason).toBe('own_exhausted')
  })

  it('⑨ 全部缓存命中且配额为 0 → **不抛错**，正常返回（免费历史数据不应被拒）', async () => {
    const db = getDb()
    setPool(db, 0)
    const grids = [{ lng: 121.8008, lat: 31.8008 }, { lng: 121.8108, lat: 31.8108 }]
    for (const g of grids) seedCache(db, g.lng, g.lat, 1000, 42000)

    const results = await scoreBatch(grids, batchConfig, { id: 1, role: 'admin' })
    expect(results.length, '两个点都应返回，不得被静默丢弃').toBe(2)
    for (const r of results) {
      expect(r.degradedDims).toEqual([])
      expect(r.populationDensity).toBe(42000)
    }
    setPool(db, 100)
  })

  it('⑩ 个别点上游异常 → 仍收录该点（带降级标记），不因个别失败丢点', async () => {
    const db = getDb()
    setPool(db, 100)
    // 全部上游失败 ⇒ 两点都应被收录（degraded），而非被 allSettled 静默丢弃
    stubFetch(() => jsonRes({ err: 'x' }, { ok: false, status: 502 }))

    const results = await scoreBatch(
      [{ lng: 121.9009, lat: 31.9009 }, { lng: 121.9109, lat: 31.9109 }],
      batchConfig,
      { id: 1, role: 'admin' }
    )
    expect(results.length, '上游异常类失败的点位应被收录（带降级标记）而非丢弃').toBe(2)
    for (const r of results) {
      expect(r.degradedDims).toContain('population')
      expect(r.degradeReason).toBe('upstream_failed')
    }
  })
})
