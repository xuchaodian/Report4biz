/**
 * 批次 223（v1.13.223）—— 两族「隐藏功能」路由的 P0 收紧 ＋ store-scores 自调修复
 *
 * 立档背景：
 *   盘点（Report4biz_隐藏功能盘点_20261014.md）发现两族后端资产**仍在线可访问**，
 *   而它们的前端入口自 c9fba2e(2026-08-19) 起已全部隐藏（路由注释 + 3 组件零 import）。
 *   两个 P0 风险：
 *     R1 成本放大器：`POST /api/scoring/score-batch` 此前只要 authenticate
 *        ⇒ 任意登录用户可调；MAX_GRIDS=20 且 smartsteps_cache 0 行
 *        ⇒ 单请求最坏 20×¥60＝¥1200；闸门只逐格校验 need=1（池未空时先花掉 20 次）；
 *        app.js 无全局限流 ⇒ 可重复。
 *     R2 静默降级：`store-scores.js` 的 calcAutoScores 用 HTTP **自调**
 *        `/api/smartsteps/query-population` 且未带 token ⇒ 必 401 ⇒ catch 兜底
 *        ⇒ 人口密度**恒默认 5 分**。生产库实证：该评分项 8 条明细
 *        auto_value 全 NULL、final_score 恒 5.0 —— 与 v1.13.222 修的评分引擎
 *        属**同一类 bug**（静默降级为伪造默认分）。
 *
 * 本文件覆盖四组：
 *   A. requireAdmin 中间件行为（含「漏挂 authenticate」的兜底：应为 403 而非 500）
 *   B. 两族路由挂载后 admin-only（真起 express + 真实 router + 真实 JWT）
 *      —— ④⑤ 验证 401/403/200 三态；⑥ 验证 user token 打 score-batch 被拒**且不烧配额**
 *   C. store-scores 不再伪造默认 5 分（上游异常 ⇒ 0 分 + degradedDims 外露；
 *      缓存命中 ⇒ 真实分；配额不足 ⇒ 统一闸门响应且**零副作用**）
 *   D. `app.js` 挂载顺序的源码断言（⛔ 锚定 `app.use(`，因为挂载行**上方注释**里
 *      也写了 `/api/scoring`；配「反例必须被判否」的自检，防检查器恒真＝假绿灯）
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰 backend/database/webgis.db 真实库。
 * 上游 HTTP 一律打桩（stub 全局 fetch，并**透传本地回环**），零外部网络、零真实计费。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-hidden-admin-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

const originalFetch = globalThis.fetch

let getDb, server, base, jwtSign, requireAdmin
let pool = { set(n) { getDb().prepare('UPDATE admin_quota SET remaining_quota = ? WHERE id = 1').run(n) },
             get() { return getDb().prepare('SELECT remaining_quota FROM admin_quota WHERE id = 1').get()?.remaining_quota } }
const ids = {}
const tokens = {}

function makeToken(u) {
  return jwtSign({ id: u.id, username: u.username, role: u.role })
}

async function call(method, p, { token, body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + p, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await res.json() } catch (e) { json = null }
  return { status: res.status, body: json }
}

// ---------- 上游 HTTP 打桩（透传本地回环） ----------

function jsonRes(obj, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => obj, text: async () => JSON.stringify(obj) }
}

/**
 * @param {null|((url:string)=>object)} onGetData 联通 getData 的返回；null ⇒ 正常返回人口
 */
function stubFetch(onGetData) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url)
    // ⚠️ **必须先把本地回环透传给原生 fetch** —— 本测试自身就是用 fetch 打 base URL 的，
    //    若一并拦截会自断链路（这是「真起 express + fetch 打真实 HTTP」模式的必备处理）。
    if (u.includes('127.0.0.1') || u.includes('localhost')) return originalFetch(url, opts)
    if (u.includes('getAuthorization')) return jsonRes({ code: 200, data: 'fake-token' })
    if (u.includes('restapi.amap.com')) return jsonRes({ count: '0' })
    if (u.includes('getData')) {
      return onGetData ? onGetData(u) : jsonRes({ code: 200, data: { 1001: { pall_sum: 50000 } } })
    }
    return jsonRes({})
  }
}

beforeEach(() => { stubFetch(null) })
afterEach(() => { globalThis.fetch = originalFetch })

// ---------- 构造工具 ----------

/** 与 queryPointPopulation 的缓存 key 算法保持一致（精度 1e5 四舍五入） */
function cacheKey(v) { return Math.round(v * 100000) / 100000 }

function seedCache(db, lng, lat, radiusM, pallSum) {
  db.prepare(
    `INSERT OR REPLACE INTO smartsteps_cache (center_lng, center_lat, radius, city_month, services, result_data)
     VALUES (?, ?, ?, '202509', '1001', ?)`
  ).run(cacheKey(lng), cacheKey(lat), radiusM, JSON.stringify({ 1001: { pall_sum: pallSum } }))
}

function countScores(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM store_scores').get().n
}

/**
 * 前置校验并返回「餐饮通用」模板 id（含 10 个评分项）。
 *
 * ⭐ v1.13.225：`database.js` 的默认模板播种**已修复**。
 *   原实现在**全新库上静默失效**（两张表建出来但恒 0 行、无任何报错）—— 根因是
 *   sql.js 1.14.1 的 `Statement.get()`：① 传**散参**（非数组）绑定不上；
 *   ② **空结果返回 `[]`（truthy！）** ⇒ `!templateExists` 恒为 false。
 *   修复改用 `stmt.bind([...]) → stmt.step()`（`step()` 返回 boolean）。详见
 *   `tests/scoringTemplateSeed.test.js`（该修复的专属守卫）。
 *
 *   故本测试**不再自带种子**，改为直接消费 initDatabase 的播种结果
 *   ⇒ 本文件同时成为该修复的**下游消费者验证**：一旦播种回退，此处立刻报「模板缺失」。
 *
 *   ⚠️ 历史：223 立档时此处自带种子并断言「空表自增必为 1（空表自增应从 1 起）」——
 *     225 修复后播种先占了 id=1，该断言随之失效，故随种子一并移除。
 *
 * @returns {number} 模板 id
 */
function requireSeedTemplate(db) {
  const tpl = db.prepare(`SELECT id FROM scoring_templates WHERE name = '餐饮通用'`).get()
  if (!tpl) {
    throw new Error('测试前置失败：库中无「餐饮通用」评分模板 —— initDatabase 的默认播种未生效'
      + '（v1.13.225 修复被回退？见 tests/scoringTemplateSeed.test.js）')
  }
  const n = db.prepare('SELECT COUNT(*) AS n FROM scoring_items WHERE template_id = ?').get(tpl.id).n
  if (n !== 10) {
    throw new Error(`测试前置失败：模板 ${tpl.id} 应含 10 个评分项，实际 ${n}`)
  }
  return tpl.id
}

/** 取某评分记录中「人口密度」这一明细的 final_score / auto_value */
function popDetail(db, scoreId) {
  const item = db.prepare(`SELECT id FROM scoring_items WHERE name = '人口密度'`).get()
  if (!item) return null
  return db.prepare(`SELECT auto_value, final_score FROM score_details WHERE score_id = ? AND item_id = ?`)
    .get(scoreId, item.id)
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  jwtSign = (payload) => jwt.sign(payload, cfg.JWT_SECRET, { expiresIn: '1h' })

  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb

  const authMod = await import('../src/middleware/auth.js')
  requireAdmin = authMod.requireAdmin
  const authenticate = authMod.authenticate

  const scoringRouter = (await import('../src/routes/scoring.js')).default
  const storeScoresRouter = (await import('../src/routes/store-scores.js')).default
  const { initCacheTable } = await import('../src/routes/smartsteps.js')

  const db = getDb()
  initCacheTable(db)
  requireSeedTemplate(db)   // ⭐ v1.13.225：播种已修复 ⇒ 改为消费 initDatabase 的播种结果（见上方注释）

  const seed = (username, role) => {
    const r = db.prepare(`INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, 0)`)
      .run(username, `${username}@t.local`, 'x', role)
    return r.lastInsertRowid
  }
  ids.admin = seed('admin_h', 'admin')
  ids.user = seed('user_h', 'user')
  tokens.admin = makeToken({ id: ids.admin, username: 'admin_h', role: 'admin' })
  tokens.user = makeToken({ id: ids.user, username: 'user_h', role: 'user' })

  // ⚠️ 复现 app.js 的**真实挂载语义**：`authenticate, requireAdmin` 串联（顺序不可颠倒）。
  //    app.js 自身是否真的这样写，由 D 组源码断言另行覆盖（两者缺一不可）。
  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use('/api/scoring', authenticate, requireAdmin, scoringRouter)
  app.use('/api/store-scores', authenticate, requireAdmin, storeScoresRouter)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ============================================================================
// A. requireAdmin 中间件行为
// ============================================================================

describe('A. requireAdmin 中间件', () => {
  function fakeRes() {
    return { statusCode: null, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  }

  it('① req.user 缺失（漏挂 authenticate）→ 403 而非 TypeError/500', () => {
    const res = fakeRes()
    let nexted = false
    requireAdmin({}, res, () => { nexted = true })
    expect(nexted).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it('② role=user → 403', () => {
    const res = fakeRes()
    let nexted = false
    requireAdmin({ user: { id: 2, role: 'user' } }, res, () => { nexted = true })
    expect(nexted).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it('③ role=admin → 放行', () => {
    const res = fakeRes()
    let nexted = false
    requireAdmin({ user: { id: 1, role: 'admin' } }, res, () => { nexted = true })
    expect(nexted).toBe(true)
    expect(res.statusCode).toBeNull()
  })
})

// ============================================================================
// B. 两族路由 admin-only（真起 express + 真实 JWT）
// ============================================================================

describe('B. /api/scoring 与 /api/store-scores 收紧为 admin-only', () => {
  it('④ GET /api/scoring/configs：无 token 401 / user 403 / admin 200', async () => {
    const noTok = await call('GET', '/api/scoring/configs')
    expect(noTok.status, '未认证应 401（证明 authenticate 排在 requireAdmin 之前）').toBe(401)

    const asUser = await call('GET', '/api/scoring/configs', { token: tokens.user })
    expect(asUser.status).toBe(403)

    const asAdmin = await call('GET', '/api/scoring/configs', { token: tokens.admin })
    expect(asAdmin.status).toBe(200)
  })

  it('⑤ GET /api/store-scores/templates：无 token 401 / user 403 / admin 200', async () => {
    const noTok = await call('GET', '/api/store-scores/templates')
    expect(noTok.status).toBe(401)

    const asUser = await call('GET', '/api/store-scores/templates', { token: tokens.user })
    expect(asUser.status).toBe(403)

    const asAdmin = await call('GET', '/api/store-scores/templates', { token: tokens.admin })
    expect(asAdmin.status).toBe(200)
  })

  it('⑥ user token 打 score-batch 被拒 403，且**不消耗物理池**（R1 堵口验证）', async () => {
    const db = getDb()
    pool.set(100)
    const before = pool.get()

    const r = await call('POST', '/api/scoring/score-batch', {
      token: tokens.user,
      body: {
        grids: Array.from({ length: 20 }, (_, i) => ({ lng: 121.4 + i * 0.01, lat: 31.2 })),
        config: {
          weight_population: 0.40, weight_competition: 0.25,
          weight_support: 0.20, weight_transport: 0.15,
          radius_km: 1.0, competition_threshold: 10
        }
      }
    })
    expect(r.status, '非 admin 必须在中间件层被拒（不得进入 20 格批量链路）').toBe(403)
    expect(pool.get(), '被拒请求不得消耗任何物理池').toBe(before)
  })
})

// ============================================================================
// C. store-scores 不再伪造默认 5 分（R2）
// ============================================================================

describe('C. store-scores 人口密度走统一口径（⛔ 不再默认 5 分）', () => {
  it('⑦ 上游失败 → 出分但人口密度 final_score=0（⛔ 非 5）＋ degradedDims 外露', async () => {
    const db = getDb()
    pool.set(100)
    stubFetch(() => jsonRes({ err: 'boom' }, { ok: false, status: 500 }))

    const r = await call('POST', '/api/store-scores/scores', {
      token: tokens.admin,
      body: { lng: 122.7001, lat: 32.7001, address: '降级测试点' }
    })
    expect(r.status).toBe(201)
    expect(r.body.degradedDims, '上游异常必须显式外露降级维度').toContain('population')
    expect(r.body.degradeReason).toBe('upstream_failed')

    const d = popDetail(db, r.body.score.id)
    expect(d, '人口密度明细应存在').toBeTruthy()
    expect(d.auto_value, '降级时不得伪造人口值').toBeNull()
    expect(d.final_score, '⛔ 关键：不得再是伪造的默认 5 分').toBe(0)
  })

  it('⑧ 缓存命中 → 人口密度取真实值（77000/300 封顶 15）且不算降级', async () => {
    const db = getDb()
    pool.set(100)
    const before = pool.get()
    const lng = 122.8002, lat = 32.8002
    seedCache(db, lng, lat, 1000, 77000)

    const r = await call('POST', '/api/store-scores/scores', {
      token: tokens.admin,
      body: { lng, lat, address: '缓存命中点' }
    })
    expect(r.status).toBe(201)
    expect(r.body.degradedDims).toEqual([])
    expect(r.body.degradeReason).toBeNull()

    const d = popDetail(db, r.body.score.id)
    expect(d.auto_value).toBe(77000)
    expect(d.final_score).toBe(15)
    expect(pool.get(), '缓存命中不得扣配额').toBe(before)
  })

  it('⑨ 配额不足（池 0 且无缓存）→ 400 pool_quota_exhausted，且**零副作用**（不写任何行）', async () => {
    const db = getDb()
    pool.set(0)
    const before = countScores(db)

    const r = await call('POST', '/api/store-scores/scores', {
      token: tokens.admin,
      body: { lng: 122.9003, lat: 32.9003, address: '池空点' }
    })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('pool_quota_exhausted')
    expect(r.body.success).toBe(false)
    expect(countScores(db), '★ 自动评分前移 ⇒ 配额不足时不得留下孤儿 draft 记录').toBe(before)
    pool.set(100)
  })
})

// ============================================================================
// D. app.js 挂载顺序的源码断言（配自检，防「检查器恒真」假绿灯）
// ============================================================================

describe('D. app.js 挂载顺序源码断言', () => {
  /**
   * 从源码里取出 `app.use('<prefix>', …)` 的中间件名序列。
   * ⚠️ **必须锚定 `app.use(`** —— ⛔ 不可用 `line.includes(prefix)`：
   *    本文件挂载行**上方的注释**里也写了 `/api/scoring`，宽松匹配会命中注释行
   *    （v1.13.211「正则扫源码被字符串骗到」的同类教训）。
   */
  function mountMiddlewares(src, prefix) {
    const lines = src.split('\n')
    const hits = lines.filter(l => /^\s*app\.use\(/.test(l) && l.includes(`'${prefix}'`))
    if (hits.length !== 1) return { hits: hits.length, middlewares: null }
    const line = hits[0]
    const after = line.slice(line.indexOf(`'${prefix}'`) + prefix.length + 2)
    return {
      hits: 1,
      middlewares: after.split(',').map(s => s.replace(/[)();\s]/g, '')).filter(Boolean)
    }
  }

  const appSrc = fs.readFileSync(path.join(import.meta.dirname, '../src/app.js'), 'utf8')

  it('⑩ 两条挂载行均为 authenticate → requireAdmin → router（顺序正确）', () => {
    for (const [prefix, routerName] of [['/api/scoring', 'scoringRoutes'], ['/api/store-scores', 'storeScoresRoutes']]) {
      const r = mountMiddlewares(appSrc, prefix)
      expect(r.hits, `${prefix} 应恰好有一条 app.use 挂载行（命中 ${r.hits} 条）`).toBe(1)
      expect(r.middlewares).toEqual(['authenticate', 'requireAdmin', routerName])
    }
  })

  it('⑪ 自检：反例（缺 requireAdmin）必须被判否 ⇒ 证明检查器不是恒真', () => {
    const bad = "app.use('/api/scoring', scoringRoutes)"
    const r = mountMiddlewares(bad, '/api/scoring')
    expect(r.hits).toBe(1)
    expect(r.middlewares).toEqual(['scoringRoutes'])
    expect(r.middlewares.includes('requireAdmin'), '缺少 requireAdmin 的写法必须能被识别出来').toBe(false)
  })

  it('⑫ 自检：顺序颠倒（requireAdmin 在 authenticate 之前）必须能被识别', () => {
    const bad = "app.use('/api/store-scores', requireAdmin, authenticate, storeScoresRoutes)"
    const r = mountMiddlewares(bad, '/api/store-scores')
    expect(r.middlewares.indexOf('requireAdmin')).toBeLessThan(r.middlewares.indexOf('authenticate'))
  })

  it('⑬ app.js 已 import authenticate 与 requireAdmin', () => {
    expect(appSrc).toMatch(/import\s*\{[^}]*\bauthenticate\b[^}]*\}\s*from\s*'\.\/middleware\/auth\.js'/)
    expect(appSrc).toMatch(/import\s*\{[^}]*\brequireAdmin\b[^}]*\}\s*from\s*'\.\/middleware\/auth\.js'/)
  })
})
