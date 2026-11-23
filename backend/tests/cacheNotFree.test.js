/**
 * 缓存 ≠ 免单（批次 381 · 业主 2026-11-19 拍板）
 *
 * ── 业主原话 ──────────────────────────────────────────────────────────
 * 「不能发生『没买过的人落在别人买过的点就能白拿数据』」
 *
 * ── 改之前是什么样 ───────────────────────────────────────────────────
 * `fetchPointPopulation` 的 ② 分支只要 `smartsteps_cache` 有同坐标同半径的记录，
 * 就 `quotaUsed: 0` 并把 population 原样返回。P3 实测的现场：
 *   A 买了 1km → B 用另一个账号探测同一点 ⇒ `source:'cache'`、不扣费、B 的履历 0 条、
 *   `/purchase/1` 404 —— 但 B 已经能看到 48,645 这个数字。
 *
 * ── 现在的口径 ───────────────────────────────────────────────────────
 * 缓存只省**平台的上游调用费**，不是**用户的免单凭据**：
 *   ① purchases（同账号 + 同半径 + 10m 内 + 能解析 1001）⇒ 0 费用（唯一免费路径）
 *   ② smartsteps_cache 命中 ⇒ 探针只回「有数据可查 + 期次」（**⛔ 不回 population**）；
 *      真取数照扣 1 次，并写**该账号自己**的 purchases 履历，只是不再调上游
 *   ③ 都没有 ⇒ 闸门 → 调上游 → 扣 1 次
 *
 * ── 测试手法 ─────────────────────────────────────────────────────────
 * 走真实 `fetchPointPopulation`（⛔ 不 mock 本模块，否则被检验的那段根本没执行），
 * 用 `vi.stubGlobal('fetch')` 拦外网并计数：`upstreamCalls` 就是「真调了几次联通」。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tmpDb = path.join(os.tmpdir(), `r4b-cachenotfree-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** 一段最小合法的联通 1001 报文（与 segment 同结构） */
const POP = { apiResult: { '1001': { p0_sum: '120000', p1_sum: '30000', p2_sum: '8000', pall_sum: '158000' } } }

let db, fetchPointPopulation
let A, B
/** 真调上游的次数（getAuthorization 的 token 请求不计） */
let upstreamCalls = 0

const PT = { lng: 121.51, lat: 31.30, radius: 1000 }

beforeAll(async () => {
  vi.stubGlobal('fetch', async (url) => {
    const u = String(url)
    if (u.includes('getAuthorization')) {
      return { ok: true, status: 200, json: async () => ({ code: 200, data: 'fake-token' }) }
    }
    upstreamCalls++
    return { ok: true, status: 200, json: async () => ({ code: 200, data: POP }) }
  })

  const dbMod = await import('../src/models/database.js')
  db = dbMod.getDb()
  fetchPointPopulation = (await import('../src/routes/smartsteps.js')).fetchPointPopulation

  db.prepare(`UPDATE admin_quota SET initial_quota = 100, remaining_quota = 10 WHERE id = 1`).run()
  const ins = (name, role, quota) => Number(db.prepare(
    `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`
  ).run(name, `${name}@test.local`, 'x', role, quota).lastInsertRowid)
  A = { id: ins('cf_a', 'admin', 10), role: 'admin' }
  B = { id: ins('cf_b', 'user', 10), role: 'user' }
})

afterAll(async () => {
  vi.unstubAllGlobals()
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
})

beforeEach(() => {
  db.prepare('DELETE FROM purchases').run()
  try { db.prepare('DELETE FROM smartsteps_cache').run() } catch { /* 表还没建 */ }
  db.prepare(`UPDATE admin_quota SET remaining_quota = 10 WHERE id = 1`).run()
  db.prepare('UPDATE users SET quota = 10').run()
  upstreamCalls = 0
})

/** A 先真买一次 ⇒ 缓存里有这个点 */
async function boughtByA() {
  const r = await fetchPointPopulation(db, A, { ...PT, storeName: 'A 的点', cityMonth: '202609' })
  expect(r.ok, '前置：A 的首次取数应成功').toBe(true)
  expect(r.body.source).toBe('fresh')
  return r
}

const purchasesOf = (uid) => db.prepare(
  'SELECT id, user_id, radius, city_month, quota_used, status FROM purchases WHERE user_id = ? ORDER BY id'
).all(uid)

describe('B1. 跨账号：缓存只省上游，不省用户的钱', () => {
  it('A 首次取数 ⇒ fresh / 扣 1 次 / 真调上游 1 次 / 写缓存', async () => {
    const r = await boughtByA()
    expect(r.body.quotaUsed).toBe(1)
    expect(upstreamCalls).toBe(1)
    expect(db.prepare('SELECT COUNT(*) n FROM smartsteps_cache').get().n).toBe(1)
    expect(purchasesOf(A.id)).toHaveLength(1)
  })

  it('🔴 B 探测同一点 ⇒ source=cache，但 population 必须为 null（不许白看数字）', async () => {
    await boughtByA()
    const r = await fetchPointPopulation(db, B, { ...PT, probeOnly: true })
    expect(r.ok).toBe(true)
    expect(r.body.source).toBe('cache')
    expect(r.body.population).toBeNull()
    expect(r.body.quotaUsed).toBe(0)
    // 期次可以给（帮用户判断新鲜度），但任何人口数字都不许出现
    expect(r.body.dataMonth).toBe('202609')
    const dump = JSON.stringify(r.body)
    for (const v of ['120000', '30000', '8000', '158000']) expect(dump).not.toContain(v)
  })

  it('🔴 B 真取数 ⇒ 扣 1 次 + 写 B 自己的履历，且**不再调上游**', async () => {
    await boughtByA()
    const before = upstreamCalls
    const r = await fetchPointPopulation(db, B, { ...PT, storeName: 'B 的点' })

    expect(r.ok).toBe(true)
    expect(r.body.source).toBe('cache')        // 数据来自缓存
    expect(r.body.quotaUsed).toBe(1)           // 但仍计费
    expect(r.body.remainingQuota).toBe(8)
    expect(upstreamCalls).toBe(before)         // 上游一次都没多调

    const rows = purchasesOf(B.id)
    expect(rows, 'B 必须有一条自己的购买履历').toHaveLength(1)
    expect(rows[0].status).toBe('active')
    expect(db.prepare(`SELECT remaining_quota r FROM admin_quota WHERE id = 1`).get().r).toBe(8)
  })

  it('B 买过之后再探测 ⇒ 命中 purchase，0 消耗且能看到数据', async () => {
    await boughtByA()
    await fetchPointPopulation(db, B, { ...PT, storeName: 'B 的点' })
    const r = await fetchPointPopulation(db, B, { ...PT, probeOnly: true })
    expect(r.body.source).toBe('purchase')
    expect(r.body.quotaUsed).toBe(0)
    expect(Number(r.body.population?.visit)).toBe(120000)
  })

  it('池已耗尽 ⇒ B 拿不到缓存数据（闸门在返回数据之前）', async () => {
    await boughtByA()
    db.prepare(`UPDATE admin_quota SET remaining_quota = 0 WHERE id = 1`).run()
    const r = await fetchPointPopulation(db, B, { ...PT, storeName: 'B 的点' })
    expect(r.ok).toBe(false)
    expect(purchasesOf(B.id), '被闸门拦下就不能留履历').toHaveLength(0)
  })

  it('缓存损坏（解析不出 1001）⇒ 不当作命中，退回 ③ 调上游', async () => {
    await boughtByA()
    db.prepare(`UPDATE smartsteps_cache SET result_data = ?`).run(JSON.stringify({ apiResult: { '1005': { foo: 1 } } }))
    const r = await fetchPointPopulation(db, B, { ...PT, storeName: 'B 的点' })
    expect(r.ok).toBe(true)
    expect(r.body.source).toBe('fresh')   // ⛔ 不能把 1005 当人口数据给出去
    expect(r.body.quotaUsed).toBe(1)
  })
})

describe('B2. 源码守卫（防回退成「缓存白拿」）', () => {
  /** 剥注释：先 HTML 注释、再块注释、再行注释（顺序不可换，见 candidateBriefGuard 踩坑） */
  function strip(src) {
    return src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  }
  /** 在**原始**源码上按注释锚点切片（strip 之后锚点就没了） */
  function sliceRaw(src, startMark, endMark) {
    const i = src.indexOf(startMark)
    if (i < 0) return ''
    const j = src.indexOf(endMark, i + startMark.length)
    return j > i ? src.slice(i, j) : ''
  }

  const SS_RAW = read('backend/src/routes/smartsteps.js')
  const SS = strip(SS_RAW)
  const SEL = strip(read('backend/src/routes/site-select.js'))
  const UPGRADE = strip(read('frontend/src/components/CandidateBriefUpgrade.vue'))
  const REPORT = strip(read('frontend/src/components/CandidateReport.vue'))

  it('锚点没有漂移（切片非空）', () => {
    expect(sliceRaw(SS_RAW, '── ② 命中平台缓存', '── ③ 都没有')).not.toBe('')
  })

  it('🔴 缓存分支的探针必须 population: null（回了数据就是白拿）', () => {
    const block = strip(sliceRaw(SS_RAW, '── ② 命中平台缓存', '── ③ 都没有'))
    expect(block).toContain('population: null')
    // 探针里唯一能返回 pop 的地方在 chargeAndRecord 之后的正式返回
    const probePart = block.slice(0, block.indexOf('if (apiResult)'))
    expect(probePart, 'probeOnly 分支提前 return 时不许带 population: pop').not.toContain('population: pop')
  })

  it('🔴 缓存分支真取数必须 quotaUsed: 1 且走 chargeAndRecord', () => {
    const block = strip(sliceRaw(SS_RAW, '── ② 命中平台缓存', '── ③ 都没有'))
    expect(block).toContain('chargeAndRecord(')
    expect(block).toContain('quotaUsed: 1')
    expect(block).not.toContain('quotaUsed: 0,\n            message: \'已命中')
  })

  it('⛔ 旧的「命中缓存不消耗配额」文案不许再出现', () => {
    for (const bad of ['已命中同位置缓存，本次未消耗配额', '已命中同位置缓存']) {
      expect(SS).not.toContain(bad)
      expect(REPORT).not.toContain(bad)
    }
  })

  it('🔴 site-select 的 probeReusable 不许再把缓存算成可复用', () => {
    const i = SEL.indexOf('function probeReusable')
    expect(i).toBeGreaterThan(-1)
    const end = SEL.indexOf('\n}', i)
    const fn = SEL.slice(i, end)
    expect(fn, 'probeReusable 只能查 purchases').not.toContain('smartsteps_cache')
  })

  /**
   * v1.13.407：初步分析面板**不再自己取数**，购买动作交给门店弹窗
   * （`StoreSmartstepsDialog` → `/api/smartsteps/query`）。
   *
   * ⇒ 原来那两条「前端必须有 reusable / cacheReady」的断言随之失效：
   *   面板里已经没有这两个态了，留着只会逼人把死代码写回去。
   *
   * 🔴 但要看清这次**没有**推翻什么：381 的「缓存照扣」约束的是
   *    `/api/smartsteps/population`（`fetchPointPopulation` → `chargeAndRecord`），
   *    那条后端守卫仍在（上面 194-199 两条）。报告页只是换了一个入口，
   *    `/population` 依旧被智能选址等链路使用，口径不变。
   */
  it('前端不再自己判「可复用 / 缓存命中」——计费口径只在弹窗一处（v1.13.407）', () => {
    expect(UPGRADE, '面板里又长出 reusable ⇒ 与弹窗的扣费说明两套口径').not.toContain('const reusable = computed')
    expect(UPGRADE, '面板里又长出 cacheReady ⇒ 同上').not.toContain('cacheReady')
    expect(UPGRADE, '购买入口必须指向门店弹窗').toContain('StoreSmartstepsDialog')
  })

  it('门店报告页的「本次未消耗配额」必须按实际 quotaUsed 决定', () => {
    expect(REPORT).toContain('popQuotaUsed')
    // 不许再无条件写死「· 本次未消耗配额」
    expect(REPORT).not.toContain('· 本次未消耗配额\n')
  })
})
