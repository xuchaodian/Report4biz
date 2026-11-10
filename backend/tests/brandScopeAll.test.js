/**
 * 「显式全量」第四态 + 同步品牌白名单按对象收窄 + 同步前置依赖 —— v1.13.352
 *
 * 起因（用户原话，2026-11-10）：
 *   ①「一起补吧」—— 补上 351 遗留的三个口径缺口：
 *      a) 「分析品牌」下拉留空 ⇒ 不传 myBrand ⇒ 全量（隐形通道）
 *      b) 同步 `filter.brands` 与 `competitors.brand` 语义混池：勾自有品牌静默 0 行
 *      c) 没有「我要全量、不要继承」的显式界面出口
 *   ②「从集团公司同步竞品门店前没有先同步我的门店时，会发生无法正确映射的情况吗？
 *      此时是否应该提醒请先同步我的门店？」
 *      → 会，而且**双向静默**：竞品行照常落库，但 `resolveBrandScope` 的第一道闸门
 *        `ownsMyBrand` 查的是目标账号的 `markers.brand`，没有自有门店 ⇒ 恒 false
 *        ⇒ 继承不生效 ⇒ 全量；同时 `brandScopeMeta.myBrands` 为空 ⇒ 349 补映射弹窗
 *        **也不会弹**（空品牌列表 ⇒ 不阻断）⇒ 界面看起来一切正常，只有竞争分/信号灯/
 *        AI 周边悄悄按全量算。所以必须有前置提醒（`buildPrereq`）。
 *
 * 本文件钉死的不变量：
 *   A. 第四态 `all`：库 mode='all' 或请求哨兵 `__all__` ⇒ compBrands=null 且
 *      source='all' + explicitAll=true —— 与「未配置(none)」严格区分，
 *      ⛔ 前端 349 判据必须把 all 当成**已配置**，否则用户永远过不去
 *   B. 空集（[]）仍然是 0 家，⛔ 不能被 all 混淆成全量
 *   C. 自有优先对 all 同样生效；集团 all + 自己 map ⇒ 自己赢（map 收窄）
 *   D. 品牌白名单按对象收窄：勾的牌子不属于本对象 ⇒ 本对象**不限品牌**并明示 ignored
 *      （⛔ 不是静默 0 行；也不是静默全量 —— 两者都要能被界面读出来）
 *   E. buildPlan 与 listCandidates 同口径（否则「候选 N 家」≠「预览 M 行」）
 *   F. buildPrereq：目标没有自有门店/品牌时出警告，且**只警告不阻断**
 *   G. 接线守卫：前端哨兵字面量与后端一致、scopeBrandsFor 认 null、不做「留空即全量」
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const tmpDb = path.join(os.tmpdir(), `r4b-brandall-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = p => fs.readFileSync(path.join(REPO, p), 'utf8')

const VIEW = 'frontend/src/views/CompetitorView.vue'
const SYNC_VIEW = 'frontend/src/views/DataSyncView.vue'
const SCOPE_JS = 'frontend/src/utils/brandScope.js'
const SCOPE_EDITOR = 'frontend/src/components/org/ScopeEditor.vue'

let db, server, base
let resolveBrandScope, brandScopeMeta, competitorWhere, scopeCacheKey
let MY_BRAND_ALL, isAllBrandsToken
let buildPlan, listCandidates, buildScopeMatcher, inAllowedScope
let buildPrereq
const ids = {}

async function call(method, p, { token, body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + p, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await res.json() } catch (e) { json = null }
  return { status: res.status, body: json }
}

const SCOPE_SH = { cities: ['上海'], brands: [] }
const scopeWithBrands = (brands) => ({ cities: ['上海'], brands })

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  db = dbMod.getDb()

  const cs = await import('../src/utils/competitorScope.js')
  resolveBrandScope = cs.resolveBrandScope
  brandScopeMeta = cs.brandScopeMeta
  competitorWhere = cs.competitorWhere
  scopeCacheKey = cs.scopeCacheKey
  MY_BRAND_ALL = cs.MY_BRAND_ALL
  isAllBrandsToken = cs.isAllBrandsToken

  const sc = await import('../src/utils/syncCore.js')
  buildPlan = sc.buildPlan
  listCandidates = sc.listCandidates
  buildScopeMatcher = sc.buildScopeMatcher
  inAllowedScope = sc.inAllowedScope

  const { buildPrereq: bp } = await import('../src/routes/sync.js')
  buildPrereq = bp

  // 起一个最小 HTTP 服务，只挂映射路由（与 351 同款做法：不引整个 app，避免旁路副作用）
  const express = (await import('express')).default
  const mapRouter = (await import('../src/routes/brand-competitor-map.js')).default
  const app = express()
  app.use(express.json())
  app.use('/api/brand-competitor-map', mapRouter)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`

  const { signToken } = await import('../src/utils/tokenAuth.js')
  const mkUser = (username, company) => Number(db.prepare(
    `INSERT INTO users (username, email, password, role, company) VALUES (?, ?, ?, 'user', ?)`
  ).run(username, `${username}@test.local`, 'x', company).lastInsertRowid)
  const mkStore = (uid, brand, name) => db.prepare(
    `INSERT INTO markers (user_id, brand, name, city, latitude, longitude) VALUES (?, ?, ?, '上海', 31.23, 121.47)`
  ).run(uid, brand, name)
  const mkComp = (uid, brand, name) => db.prepare(
    `INSERT INTO competitors (user_id, brand, name, city, latitude, longitude) VALUES (?, ?, ?, '上海', 31.23, 121.47)`
  ).run(uid, brand, name)
  const mkOrg = (name, owner) => Number(db.prepare(
    `INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`
  ).run(name, owner).lastInsertRowid)
  const addMember = (orgId, uid) => db.prepare(
    `INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`
  ).run(orgId, uid)
  const mapOnce = (uid, myBrand, brands, mode = 'map') => {
    db.prepare(`INSERT INTO brand_competitor_scope (user_id, my_brand, mode) VALUES (?, ?, ?)`).run(uid, myBrand, mode)
    for (const b of brands) {
      db.prepare(`INSERT INTO brand_competitor_map (user_id, my_brand, competitor_brand) VALUES (?, ?, ?)`).run(uid, myBrand, b)
    }
  }

  // ---- 集团庚：总部两品牌，一个按映射（滨寿司）、一个设成显式全量（食其家）----
  ids.hq = mkUser('ba_hq', '庚集团总部')
  ids.subNoCfg = mkUser('ba_subNoCfg', '庚-未配')
  ids.subAll = mkUser('ba_subAll', '庚-自设全量')
  ids.subMap = mkUser('ba_subMap', '庚-自配映射')
  for (const uid of [ids.hq, ids.subNoCfg, ids.subAll, ids.subMap]) {
    mkStore(uid, '滨寿司', '店A')
    mkStore(uid, '食其家', '店B')
  }
  ids.org = mkOrg('庚集团', ids.hq)
  for (const uid of [ids.subNoCfg, ids.subAll, ids.subMap]) addMember(ids.org, uid)
  mapOnce(ids.hq, '滨寿司', ['竞品A1', '竞品A2'], 'map')
  mapOnce(ids.hq, '食其家', [], 'all')            // 总部把食其家设成「不筛选」
  mapOnce(ids.subAll, '滨寿司', [], 'all')         // 成员自己把滨寿司设成全量
  mapOnce(ids.subMap, '滨寿司', ['竞品C'], 'map')   // 成员自己配了映射（应压过总部的 all）
  mapOnce(ids.subMap, '食其家', ['竞品D'], 'map')   // 成员自己配食其家 ⇒ 压过集团 all

  // ---- 同步用：源账号有自有门店 + 竞品门店；目标账号是空壳 ----
  ids.syncSrc = mkUser('ba_syncSrc', '同步源')
  ids.syncDst = mkUser('ba_syncDst', '同步目标')
  mkStore(ids.syncSrc, '滨寿司', '源自营1')
  mkStore(ids.syncSrc, '食其家', '源自营2')
  mkComp(ids.syncSrc, '寿司郎', '竞品-寿司郎')
  mkComp(ids.syncSrc, '元气寿司', '竞品-元气')

  // ---- 目标账号有门店但没填品牌（用于 markers_without_brand）----
  ids.syncDstNoBrand = mkUser('ba_dstNoBrand', '无品牌目标')
  db.prepare(
    `INSERT INTO markers (user_id, brand, name, city, latitude, longitude) VALUES (?, '', '无品牌店', '上海', 31.2, 121.4)`
  ).run(ids.syncDstNoBrand)

  // ⚠️ 每个要用 HTTP 的账号都必须在这里发一张票：漏一个 ⇒ `token` 是 undefined
  // ⇒ 请求头不带 Authorization ⇒ 只有一句「请先登录」，看起来像鉴权挂了，其实是测试自己没带票。
  const tk = (uid, username) => signToken({ id: uid, username, role: 'user', token_version: 0 })
  ids.tokens = {
    subNoCfg: tk(ids.subNoCfg, 'ba_subNoCfg'),
    subAll: tk(ids.subAll, 'ba_subAll'),
    subMap: tk(ids.subMap, 'ba_subMap'),
    hq: tk(ids.hq, 'ba_hq')
  }
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  try { fs.unlinkSync(tmpDb) } catch (e) { /* 忽略 */ }
})

// ===========================================================================
// A. 第四态「显式全量」
// ===========================================================================
describe('A. 显式全量（mode=all）', () => {
  it('A1 库里 mode=all ⇒ compBrands=null + source=all + explicitAll', () => {
    const r = resolveBrandScope(db, ids.subAll, '滨寿司')
    expect(r.compBrands).toBeNull()
    expect(r.source).toBe('all')
    expect(r.explicitAll).toBe(true)
    expect(r.mode).toBe('all')
  })

  it('A2 集团 mode=all 被继承 ⇒ source=group 且 explicitAll（来源与筛选方式是两个维度）', () => {
    const r = resolveBrandScope(db, ids.subNoCfg, '食其家')
    expect(r.compBrands).toBeNull()
    expect(r.source).toBe('group')
    expect(r.explicitAll).toBe(true)
    expect(r.inheritedFrom).toBe(ids.hq)
  })

  it('A3 请求哨兵 __all__ ⇒ source=all，且**不需要**门店里有这个品牌（不是真实品牌）', () => {
    const r = resolveBrandScope(db, ids.syncDst, MY_BRAND_ALL)
    expect(r.compBrands).toBeNull()
    expect(r.source).toBe('all')
    expect(r.explicitAll).toBe(true)
  })

  it('A4 全量在 SQL 层就是「不拼 WHERE」—— 与未配置逐字节相同，差异只在可读性', () => {
    const all = competitorWhere(resolveBrandScope(db, ids.subAll, '滨寿司').compBrands)
    const none = competitorWhere(resolveBrandScope(db, ids.subAll, '不存在的品牌').compBrands)
    expect(all.sql).toBe('')
    expect(all.params).toEqual([])
    expect(none.sql).toBe('')
  })

  it('A5 空集仍然是 0 家（⛔ 不能被 all 混淆成全量）', () => {
    // 成员 subMap 没碰食其家之前，食其家是集团 all；这里用 subNoCfg 的滨寿司（集团 map）对照
    const mapped = resolveBrandScope(db, ids.subNoCfg, '滨寿司')
    expect(Array.isArray(mapped.compBrands)).toBe(true)
    // 造一个显式空集：集团戊同款做法
    const uid = Number(db.prepare(
      `INSERT INTO users (username, email, password, role) VALUES ('ba_empty', 'ba_empty@t.local', 'x', 'user')`
    ).run().lastInsertRowid)
    db.prepare(`INSERT INTO markers (user_id, brand, name, city, latitude, longitude) VALUES (?, '滨寿司', '店E', '上海', 31.2, 121.4)`).run(uid)
    db.prepare(`INSERT INTO brand_competitor_scope (user_id, my_brand, mode) VALUES (?, '滨寿司', 'map')`).run(uid)
    const r = resolveBrandScope(db, uid, '滨寿司')
    expect(r.source).toBe('self')
    expect(r.compBrands).toEqual([])
    expect(competitorWhere(r.compBrands).sql).toBe(' AND 1 = 0')
    expect(scopeCacheKey(r.compBrands)).toBe('none')
  })

  it('A6 自有 all 压过集团 map（自有优先对全量同样生效）', () => {
    // subAll：滨寿司自己 all，集团 map ⇒ 应得 all
    const r = resolveBrandScope(db, ids.subAll, '滨寿司')
    expect(r.source).toBe('all')
    expect(r.compBrands).toBeNull()
  })

  it('A7 自有 map 压过集团 all（反向也成立）', () => {
    // subMap：食其家自己 map，集团 all ⇒ 应得自己的集合
    const r = resolveBrandScope(db, ids.subMap, '食其家')
    expect(r.source).toBe('self')
    expect(r.compBrands).toEqual(['竞品D'])
  })

  it('A8 meta.ownScopes 用 null 表示显式全量（与「没有这个 key」严格区分）', () => {
    const meta = brandScopeMeta(db, ids.subAll, null, resolveBrandScope(db, ids.subAll, '__all__'))
    expect(meta.ownScopes['滨寿司']).toBeNull()
    expect('食其家' in meta.ownScopes).toBe(false)
  })

  it('A9 meta.scopes 的 null 值原样下发（前端 scopeBrandsFor 认它）', () => {
    const meta = brandScopeMeta(db, ids.subAll, null, resolveBrandScope(db, ids.subAll, '__all__'))
    expect(meta.scopes['滨寿司']).toBeNull()
    expect(meta.scopes['食其家']).toBeNull()   // 集团 all 补齐进来的
  })

  it('A10 meta.fullScope 三件套：active / explicit / noMyBrands', () => {
    const all = brandScopeMeta(db, ids.subAll, null, resolveBrandScope(db, ids.subAll, '__all__'))
    expect(all.fullScope).toEqual({ active: true, explicit: true, noMyBrands: false })

    const mapped = brandScopeMeta(db, ids.subMap, ['竞品D'], resolveBrandScope(db, ids.subMap, '食其家'))
    expect(mapped.fullScope.active).toBe(false)
    expect(mapped.fullScope.explicit).toBe(false)
    expect(mapped.fullScope.noMyBrands).toBe(false)

    // 目标账号没有任何门店 ⇒ noMyBrands=true（这正是「没同步我的门店」的可观测信号）
    const empty = brandScopeMeta(db, ids.syncDst, null, resolveBrandScope(db, ids.syncDst, '__all__'))
    expect(empty.myBrands).toEqual([])
    expect(empty.fullScope.noMyBrands).toBe(true)
  })

  it('A11 349 判据：显式全量算「已配置」（scopes 里 key 存在，值为 null）', () => {
    const meta = brandScopeMeta(db, ids.subAll, null, resolveBrandScope(db, ids.subAll, '__all__'))
    // 前端 decideBrandMapPrompt 的 keySetOf 只看 key 在不在 ⇒ null 也占位
    expect(Object.keys(meta.scopes).length).toBeGreaterThan(0)
    expect(Object.keys(meta.scopes).some(k => k === '滨寿司')).toBe(true)
  })
})

// ===========================================================================
// B. HTTP 写路径
// ===========================================================================
describe('B. PUT/GET 端点（显式全量的持久化）', () => {
  it('B1 PUT mode=all ⇒ source=all，且明细行被清空', async () => {
    const before = db.prepare(
      `SELECT COUNT(*) AS c FROM brand_competitor_map WHERE user_id = ? AND my_brand = '滨寿司'`
    ).get(ids.subMap).c
    expect(before).toBe(1)   // subMap 原本有 ['竞品C']

    const r = await call('PUT', '/api/brand-competitor-map', {
      token: ids.tokens.subMap,
      body: { myBrand: '滨寿司', competitorBrands: [], mode: 'all' }
    })
    expect(r.status).toBe(200)
    expect(r.body.brandScope.source).toBe('all')
    expect(r.body.brandScope.explicitAll).toBe(true)
    expect(r.body.ownScopes['滨寿司']).toBeNull()

    const after = db.prepare(
      `SELECT COUNT(*) AS c FROM brand_competitor_map WHERE user_id = ? AND my_brand = '滨寿司'`
    ).get(ids.subMap).c
    expect(after).toBe(0)    // 明细必须清空，否则「全量」与残留明细并存
  })

  it('B2 GET 之后仍然是 all（持久化，不是内存态）', async () => {
    const r = await call('GET', '/api/brand-competitor-map?myBrand=滨寿司', { token: ids.tokens.subMap })
    expect(r.status).toBe(200)
    expect(r.body.brandScope.source).toBe('all')
  })

  it('B3 用 mode=map 覆盖 all ⇒ 回到 self（可逆）', async () => {
    const r = await call('PUT', '/api/brand-competitor-map', {
      token: ids.tokens.subMap,
      body: { myBrand: '滨寿司', competitorBrands: ['竞品E'], mode: 'map' }
    })
    expect(r.status).toBe(200)
    expect(r.body.brandScope.source).toBe('self')
    expect(r.body.brandScope.brands).toEqual(['竞品E'])
  })

  it('B4 mode=all 也必须过「品牌属于本账号」这道闸门', async () => {
    const r = await call('PUT', '/api/brand-competitor-map', {
      token: ids.tokens.subMap,
      body: { myBrand: '根本不存在的品牌', competitorBrands: [], mode: 'all' }
    })
    expect(r.status).toBe(400)
  })

  it('B5 不传 mode 时默认 map（349 弹窗不传 ⇒ 老行为不变）', async () => {
    const r = await call('PUT', '/api/brand-competitor-map', {
      token: ids.tokens.subMap,
      body: { myBrand: '滨寿司', competitorBrands: ['竞品F'] }
    })
    expect(r.status).toBe(200)
    expect(r.body.brandScope.source).toBe('self')
    expect(r.body.brandScope.mode).toBe('map')
  })

  it('B6 请求哨兵 __all__ 走 GET ⇒ source=all（前端「全部品牌（不筛选）」）', async () => {
    const r = await call('GET', `/api/brand-competitor-map?myBrand=${MY_BRAND_ALL}`, { token: ids.tokens.subMap })
    expect(r.status).toBe(200)
    expect(r.body.brandScope.source).toBe('all')
    expect(r.body.brandScope.explicitAll).toBe(true)
  })
})

// ===========================================================================
// C. 同步品牌白名单按对象收窄
// ===========================================================================
describe('C. 品牌白名单按对象收窄（混池修复）', () => {
  it('C0 基线：不限品牌时竞品 2 家全进', () => {
    const p = buildPlan(db, {
      kind: 'competitors', direction: 'group_to_member',
      sourceUserId: ids.syncSrc, targetUserId: ids.syncDst, scopeJson: SCOPE_SH
    })
    expect(p.counts.added).toBe(2)
    expect(p.brandFilter.applied).toBe(false)
    expect(p.brandFilter.ignored).toEqual([])
  })

  it('C1 勾**自有品牌**去同步竞品 ⇒ 该对象不限品牌（⛔ 不是静默 0 行），并报出 ignored', () => {
    const p = buildPlan(db, {
      kind: 'competitors', direction: 'group_to_member',
      sourceUserId: ids.syncSrc, targetUserId: ids.syncDst,
      scopeJson: scopeWithBrands(['滨寿司'])
    })
    expect(p.counts.added).toBe(2)              // 竞品照常全进
    expect(p.brandFilter.applied).toBe(false)
    expect(p.brandFilter.ignored).toEqual(['滨寿司'])
    expect(p.counts.brandIgnored).toBe(1)
  })

  it('C2 勾**竞品品牌** ⇒ 真的生效', () => {
    const p = buildPlan(db, {
      kind: 'competitors', direction: 'group_to_member',
      sourceUserId: ids.syncSrc, targetUserId: ids.syncDst,
      scopeJson: scopeWithBrands(['寿司郎'])
    })
    expect(p.counts.added).toBe(1)
    expect(p.brandFilter.applied).toBe(true)
    expect(p.brandFilter.kept).toEqual(['寿司郎'])
  })

  it('C3 混勾（自有 + 竞品）⇒ 竞品侧只留竞品品牌，自有品牌进 ignored', () => {
    const p = buildPlan(db, {
      kind: 'competitors', direction: 'group_to_member',
      sourceUserId: ids.syncSrc, targetUserId: ids.syncDst,
      scopeJson: scopeWithBrands(['滨寿司', '寿司郎'])
    })
    expect(p.counts.added).toBe(1)
    expect(p.brandFilter.applied).toBe(true)
    expect(p.brandFilter.kept).toEqual(['寿司郎'])
    expect(p.brandFilter.ignored).toEqual(['滨寿司'])
  })

  it('C4 同一份白名单在 markers 侧反过来生效（自有品牌筛门店、竞品品牌被忽略）', () => {
    const p = buildPlan(db, {
      kind: 'markers', direction: 'group_to_member',
      sourceUserId: ids.syncSrc, targetUserId: ids.syncDst,
      scopeJson: scopeWithBrands(['滨寿司', '寿司郎'])
    })
    expect(p.counts.added).toBe(1)              // 只有「滨寿司」那家门店
    expect(p.brandFilter.applied).toBe(true)
    expect(p.brandFilter.kept).toEqual(['滨寿司'])
    expect(p.brandFilter.ignored).toEqual(['寿司郎'])
  })

  it('C5 listCandidates 与 buildPlan 同口径（候选数 = 预览数）', () => {
    const json = scopeWithBrands(['滨寿司'])
    const c = listCandidates(db, {
      kind: 'competitors', sourceUserId: ids.syncSrc, targetUserId: ids.syncDst, scopeJson: json
    })
    const p = buildPlan(db, {
      kind: 'competitors', direction: 'group_to_member',
      sourceUserId: ids.syncSrc, targetUserId: ids.syncDst, scopeJson: json
    })
    expect(c.inScope.length).toBe(p.counts.added)
    expect(c.brandFilter.applied).toBe(p.brandFilter.applied)
    expect(c.brandFilter.ignored).toEqual(p.brandFilter.ignored)
  })

  it('C6 品牌归一化：白名单写大写也能命中库里的小写（KFC / kfc）', () => {
    const uid = Number(db.prepare(
      `INSERT INTO users (username, email, password, role) VALUES ('ba_kfc', 'ba_kfc@t.local', 'x', 'user')`
    ).run().lastInsertRowid)
    // 🔴 库里刻意写小写：只归一「白名单」侧是不够的，源表品牌也必须归一
    db.prepare(`INSERT INTO markers (user_id, brand, name, city, latitude, longitude) VALUES (?, 'kfc', '店K', '上海', 31.2, 121.4)`).run(uid)
    const p = buildPlan(db, {
      kind: 'markers', direction: 'group_to_member',
      sourceUserId: uid, targetUserId: ids.syncDst, scopeJson: scopeWithBrands(['KFC'])
    })
    expect(p.counts.added).toBe(1)
    expect(p.brandFilter.applied).toBe(true)
  })

  it('C7 判定函数本身吃归一值（inAllowedScope / buildScopeMatcher 两处都不能只 trim）', () => {
    // 直接钉住判定层：上面的 C6 有两道归一互相兜底，单点变异会被另一道掩盖
    const m = buildScopeMatcher({ cities: ['上海'], brands: ['kfc'] }, null)
    expect(m.brands.has('KFC')).toBe(true)
    const hit = inAllowedScope(
      { city: '上海', brand: 'kfc' },
      { cityKeys: new Set(['上海']), brands: new Set(['KFC']) }
    )
    expect(hit).toBe(true)
  })
})

// ===========================================================================
// D. 同步前置依赖（未同步我的门店）
// ===========================================================================
describe('D. buildPrereq：竞品依赖自有门店', () => {
  it('D1 目标没有自有门店 + 勾了竞品 ⇒ 出 competitors_without_markers（warning）', () => {
    const r = buildPrereq(db, {
      kinds: ['competitors'], sourceUserId: ids.syncSrc, targetUserId: ids.syncDst
    })
    expect(r.target.markers).toBe(0)
    const w = r.warnings.find(x => x.code === 'competitors_without_markers')
    expect(w).toBeTruthy()
    expect(w.level).toBe('warning')
    // 必须讲清后果，而不是只说「请先同步」
    expect(w.message).toMatch(/分池/)
  })

  it('D2 同时勾了门店 ⇒ 警告降级为「落库后才会生效」，⛔ 不劝退', () => {
    const r = buildPrereq(db, {
      kinds: ['markers', 'competitors'], sourceUserId: ids.syncSrc, targetUserId: ids.syncDst
    })
    const w = r.warnings.find(x => x.code === 'competitors_without_markers')
    expect(w).toBeTruthy()
    expect(w.title).toMatch(/下一次刷新|落库/)
  })

  it('D3 目标有门店但没填品牌 ⇒ markers_without_brand', () => {
    const r = buildPrereq(db, {
      kinds: ['competitors'], sourceUserId: ids.syncSrc, targetUserId: ids.syncDstNoBrand
    })
    expect(r.target.markers).toBe(1)
    expect(r.target.myBrands).toBe(0)
    expect(r.warnings.some(x => x.code === 'markers_without_brand')).toBe(true)
  })

  it('D4 目标已有品牌 ⇒ 无「缺骨架」类警告', () => {
    const r = buildPrereq(db, {
      kinds: ['competitors'], sourceUserId: ids.syncSrc, targetUserId: ids.subNoCfg
    })
    expect(r.target.markers).toBeGreaterThan(0)
    expect(r.target.myBrands).toBeGreaterThan(0)
    expect(r.warnings.some(x => x.code === 'competitors_without_markers' || x.code === 'markers_without_brand')).toBe(false)
  })

  it('D5 只同步「我的门店」⇒ 不产生任何竞品相关警告', () => {
    const r = buildPrereq(db, {
      kinds: ['markers'], sourceUserId: ids.syncSrc, targetUserId: ids.syncDst
    })
    expect(r.warnings.some(x => x.code.startsWith('competitors_'))).toBe(false)
  })

  it('D6 映射不随同步下发这条要明说（否则子公司以为集团漏配）', () => {
    const r = buildPrereq(db, {
      kinds: ['competitors'], sourceUserId: ids.hq, targetUserId: ids.syncDst
    })
    expect(r.source.mapRows).toBeGreaterThan(0)
    const w = r.warnings.find(x => x.code === 'map_not_synced')
    expect(w).toBeTruthy()
    expect(w.level).toBe('info')
  })
})

// ===========================================================================
// E. 接线守卫（源码级）
// ===========================================================================
describe('E. 接线守卫', () => {
  it('E1 前后端哨兵字面量必须一致', () => {
    const backend = read('backend/src/utils/competitorScope.js')
    const frontend = read(SCOPE_JS)
    expect(MY_BRAND_ALL).toBe('__all__')
    expect(backend).toMatch(/MY_BRAND_ALL = '__all__'/)
    expect(frontend).toMatch(/MY_BRAND_ALL = '__all__'/)
  })

  it('E2 scopeBrandsFor 必须显式处理 null（⛔ 落到「非数组 ⇒ []」会把全量读成 0 家）', () => {
    const src = read(SCOPE_JS)
    expect(src).toMatch(/if \(arr === null\) return null/)
    // 顺序断言：null 判断必须在 Array.isArray 之前
    expect(src.indexOf('arr === null')).toBeLessThan(src.indexOf('if (!Array.isArray(arr)) return []'))
  })

  it('E3 分析品牌下拉必须有显式「全部品牌」选项（⛔ 靠留空表达全量）', () => {
    const src = read(VIEW)
    expect(src).toMatch(/MY_BRAND_ALL/)
    expect(src).toMatch(/全部品牌/)
    expect(src).toMatch(/<el-option label="全部品牌（不筛选）"/)
  })

  it('E4 映射弹窗必须有「不筛选（全量）」出口', () => {
    const src = read(VIEW)
    expect(src).toMatch(/mapExplicitAll/)
    expect(src).toMatch(/不筛选（全部竞品）/)
    expect(src).toMatch(/mode: 'all'/)
  })

  it('E5 349 判据不能把显式全量当成未配置（否则用户过不去）', () => {
    const src = read(VIEW)
    // brandSourceOf 必须把 pickScope 的 null（显式全量）判成 'all'，
    // ⛔ 不能落到「没有这个 key」的 none 分支 —— 那样 349 会一直弹。
    expect(src).toMatch(/=== null\) return 'all'/)
    const prompt = read('frontend/src/utils/brandMapPrompt.js')
    // 判据是「key 在不在」，不是「值非空」—— 与 null 兼容
    expect(prompt).toMatch(/Object\.keys\(map \|\| \{\}\)/)
  })

  it('E6 同步页品牌下拉必须分组（⛔ 自有品牌混进竞品筛选池）', () => {
    const src = read(SYNC_VIEW)
    expect(src).toMatch(/brandGroupOptions/)
    expect(src).toMatch(/el-option-group/)
    expect(src).toMatch(/我的门店品牌/)
    expect(src).toMatch(/竞品品牌/)
  })

  it('E7 同步页必须展示前置依赖警告与品牌忽略提示', () => {
    const src = read(SYNC_VIEW)
    expect(src).toMatch(/prereqWarnings/)
    expect(src).toMatch(/brandFilterHint/)
    expect(src).toMatch(/品牌筛选已忽略/)
  })

  it('E8 管辖范围编辑器也用分组候选（同一份 scope-options）', () => {
    const src = read(SCOPE_EDITOR)
    expect(src).toMatch(/brandGroups/)
    expect(src).toMatch(/el-option-group/)
  })

  it('E9 buildPlan / listCandidates 都必须调 narrowBrandFilter（⛔ 只改一处会候选≠预览）', () => {
    const src = read('backend/src/utils/syncCore.js')
    const hits = src.match(/narrowBrandFilter\(db, sourceUserId, kind, matcher\.brands\)/g) || []
    expect(hits.length).toBe(2)
  })

  it('E10 品牌归一只有一份实现（syncCore 不得自己 trim+toUpperCase 造轮子）', () => {
    const src = read('backend/src/utils/syncCore.js')
    expect(src).toMatch(/import \{ normalizeBrand \} from '\.\/storeDedup\.js'/)
    expect(src).not.toMatch(/toUpperCase\(\)\s*===?\s*String\(b\)/)
  })

  it('E11 算出来的东西必须真的**发出去**（prereq / brandFilterByKind 两处端点都回传）', () => {
    // 这一条是被自己的实现坑出来的：buildPrereq / brandFilterByKind 都算对了，
    // 但 /preview 当时只回传 counts，前端 applyBrandFilterReport(undefined) 静默变空 ——
    // 「函数有单测」不等于「界面上看得见」。
    const src = read('backend/src/routes/sync.js')
    const prereqHits = src.match(/prereq: buildPrereq\(db, \{ kinds, sourceUserId/g) || []
    expect(prereqHits.length).toBe(2)     // /candidates + /preview
    expect(src).toMatch(/brandFilterByKind: plan\.brandFilterByKind/)
  })
})

// ===========================================================================
// F. 前端三态取值 —— **真跑**，不靠正则（正则守卫在这里救不了）
// ===========================================================================
describe('F. 前端 pickScope 三态（undefined / null / []）', () => {
  let pickScope, scopeBrandsFor, isAllBrandsToken
  beforeAll(async () => {
    // 这个 util 是无依赖纯 ESM，可以在 node 里直接跑；⛔ 不要用正则断言代替
    const m = await import('../../frontend/src/utils/brandScope.js')
    pickScope = m.pickScope
    scopeBrandsFor = m.scopeBrandsFor
    isAllBrandsToken = m.isAllBrandsToken
  })

  it('F1 没配 ⇒ undefined；显式全量 ⇒ null；明确无竞品 ⇒ []（三者不可混）', () => {
    const map = { 滨寿司: ['竞品A'], 食其家: null, 吉野家: [] }
    expect(pickScope(map, '滨寿司')).toEqual(['竞品A'])
    expect(pickScope(map, '食其家')).toBeNull()          // ⛔ 不能被兜成 []
    expect(pickScope(map, '吉野家')).toEqual([])
    expect(pickScope(map, '没这个品牌')).toBeUndefined()
  })

  it('F2 归一匹配：首尾空格/大小写不同也能取到，且原样返回 null', () => {
    // ⚠️ normBrand 只压缩内部空白 + 去首尾，⛔ 不删除字符间的空格
    // （「食 其 家」与「食其家」是两个品牌名，别指望它帮你模糊匹配）
    expect(pickScope({ ' 食其家 ': null }, '食其家')).toBeNull()
    expect(pickScope({ kfc: ['竞品A'] }, 'KFC')).toEqual(['竞品A'])
  })

  it('F3 scopeBrandsFor 把 null 与「未配置」都视为全量（二态接口）', () => {
    expect(scopeBrandsFor({ 食其家: null }, '食其家')).toBeNull()
    expect(scopeBrandsFor({}, '食其家')).toBeNull()
    expect(scopeBrandsFor({ 吉野家: [] }, '吉野家')).toEqual([])   // ← 这个不能被并进 null
  })

  it('F4 哨兵只认全等（前端与后端同一字面量）', () => {
    expect(isAllBrandsToken('__all__')).toBe(true)
    expect(isAllBrandsToken(' __all__ ')).toBe(true)
    expect(isAllBrandsToken('__ALL__')).toBe(false)
    expect(isAllBrandsToken('滨寿司')).toBe(false)
  })

  it('F5 视图里不许再自带一份 pickScope（`|| []` 兜底会把全量读成 0 家）', () => {
    const src = read(VIEW)
    expect(src).toMatch(/import \{[^}]*pickScope[^}]*\} from '@\/utils\/brandScope\.js'/)
    expect(src).not.toMatch(/function pickScope\(/)
  })
})
