/**
 * 集团「品牌 → 竞品品牌」映射的读时继承 —— v1.13.351
 *
 * 需求（用户原话，2026-11-10）：
 *   「集团公司账号做好映射之后，子公司账号在同步竞品门店时是否也可以一并同步？」
 *   → 现状是**不能**：竞品门店行会同步过去（`brand` 原样复制），但映射表
 *     `brand_competitor_scope/map` 的主键是 `(user_id, my_brand)`、且不在
 *     `syncCore.SYNC_KINDS` 里 ⇒ 子公司读到「未配置」⇒ 退回全量 ⇒ 双品牌的竞品
 *     混在一个池里算竞争分（344 修掉的偏差在子公司侧复活）。
 *   → 本版做法：**读时继承**，零复制。子公司自己没配该品牌时，回退读总部账号
 *     （`organizations.owner_user_id`）的映射。集团改一次，子公司下次刷新即生效。
 *   用户拍板：「一次性做完 A + 349 联动」（2026-11-10 15:49）。
 *
 * 本文件钉死的不变量：
 *   A. 三态不变：未配置⇒全量 / 已配置⇒收窄 / 已配置空集⇒真 0 家
 *   B. **自有优先**：自己配过（含显式空集）就用自己的，⛔ 集团不得覆盖
 *   C. 继承只在「成员 + 未解散集团 + 总部确实配过」三条同时成立时发生
 *   D. 品牌不属于该账号（门店里没这个自有品牌）⇒ 不继承（owns 闸门对继承同样生效）
 *   E. 继承是**活的**：集团改映射立即生效；集团解散 / 成员被移出 ⇒ 立即消失，零清理任务
 *   F. **零复制**：解析过程不写库，成员表不产生任何 scope/map 行
 *   G. meta 三件套：scopes=生效口径（含继承）、ownScopes=本账号显式、inheritedScopes=集团侧
 *      ⚠️ mergeScopes 必须按**归一值**去重，否则前端 `find(归一匹配)` 会读到集团那份
 *   H. DELETE（恢复）在有集团映射时是**回落到继承**，不是回到全量 —— 前端文案据此区分
 *   I. 349 联动：继承算「已配置」，子公司不会被再拦一次去重复劳动
 *   J. 接线守卫：CompetitorView 两处判据都传 inheritedScopes、模板都挂了、赋值收口成一处
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const tmpDb = path.join(os.tmpdir(), `r4b-brandscope-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = p => fs.readFileSync(path.join(REPO, p), 'utf8')

const VIEW = 'frontend/src/views/CompetitorView.vue'
const DIALOG = 'frontend/src/components/competitor/BrandMapRequiredDialog.vue'

let db, resolveBrandScope, resolveCompBrands, brandScopeMeta, competitorWhere, scopeCacheKey
let signToken, server, base
const ids = {}
const tokens = {}

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

/** 全表行数快照 —— 证明「解析过程零写入」 */
function snapshotCounts() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all()
  const out = {}
  for (const t of tables) out[t.name] = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get().c
  return out
}

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  db = dbMod.getDb()

  const cs = await import('../src/utils/competitorScope.js')
  resolveBrandScope = cs.resolveBrandScope
  resolveCompBrands = cs.resolveCompBrands
  brandScopeMeta = cs.brandScopeMeta
  competitorWhere = cs.competitorWhere
  scopeCacheKey = cs.scopeCacheKey

  const { signToken: st } = await import('../src/utils/tokenAuth.js')
  signToken = st

  const mkUser = (username, company) => Number(db.prepare(
    `INSERT INTO users (username, email, password, role, company) VALUES (?, ?, ?, 'user', ?)`
  ).run(username, `${username}@test.local`, 'x', company).lastInsertRowid)

  const mkStore = (uid, brand, name) => db.prepare(
    `INSERT INTO markers (user_id, brand, name, city, latitude, longitude) VALUES (?, ?, ?, '上海', 31.23, 121.47)`
  ).run(uid, brand, name)

  const mkOrg = (name, owner) => Number(db.prepare(
    `INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`
  ).run(name, owner).lastInsertRowid)

  const addMember = (orgId, uid) => db.prepare(
    `INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`
  ).run(orgId, uid)

  const mapOnce = (uid, myBrand, brands) => {
    db.prepare(`INSERT INTO brand_competitor_scope (user_id, my_brand) VALUES (?, ?)`).run(uid, myBrand)
    for (const b of brands) {
      db.prepare(`INSERT INTO brand_competitor_map (user_id, my_brand, competitor_brand) VALUES (?, ?, ?)`).run(uid, myBrand, b)
    }
  }

  // ---- 集团甲：总部映射齐全，两个成员（一个未配、一个自配 + 显式空集）----
  ids.hq1 = mkUser('bs_hq1', '泉膳中国')
  ids.subA = mkUser('bs_subA', '上海泉盛')
  ids.subB = mkUser('bs_subB', '成都泉盛')
  for (const uid of [ids.hq1, ids.subA, ids.subB]) {
    mkStore(uid, '滨寿司', '店A')
    mkStore(uid, '食其家', '店B')
  }
  ids.org1 = mkOrg('泉膳中国', ids.hq1)
  addMember(ids.org1, ids.subA)
  addMember(ids.org1, ids.subB)
  mapOnce(ids.hq1, '滨寿司', ['竞品A1', '竞品A2'])
  mapOnce(ids.hq1, '食其家', ['竞品B1'])
  // 成员B：滨寿司自配（与集团不同）、食其家显式空集
  mapOnce(ids.subB, '滨寿司', ['竞品C'])
  mapOnce(ids.subB, '食其家', [])
  // 成员B 还有一个「集团没配过」的品牌，用于验证「集团没配 ⇒ 删除后真的回到全量」
  mkStore(ids.subB, '吉野家', '店B2')

  // ---- 集团乙：已解散 ----
  ids.hq2 = mkUser('bs_hq2', '已解散集团总部')
  ids.subC = mkUser('bs_subC', '乙-C')
  mkStore(ids.subC, '滨寿司', '店C')
  mkStore(ids.hq2, '滨寿司', '店H2')
  ids.org2 = mkOrg('已解散集团', ids.hq2)
  addMember(ids.org2, ids.subC)
  mapOnce(ids.hq2, '滨寿司', ['竞品X'])
  db.prepare(`UPDATE organizations SET dissolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(ids.org2)

  // ---- 集团丙：用于「被移出集团」 ----
  ids.hq3 = mkUser('bs_hq3', '临时集团总部')
  ids.subD = mkUser('bs_subD', '丙-D')
  mkStore(ids.hq3, '滨寿司', '店H3')
  mkStore(ids.subD, '滨寿司', '店D')
  ids.org3 = mkOrg('临时集团', ids.hq3)
  addMember(ids.org3, ids.subD)
  mapOnce(ids.hq3, '滨寿司', ['竞品Y'])

  // ---- 集团丁：总部配了两个品牌，但成员门店里只有滨寿司 ----
  ids.hq4 = mkUser('bs_hq4', '丁集团总部')
  ids.subE = mkUser('bs_subE', '丁-E')
  mkStore(ids.hq4, '滨寿司', '店H4a')
  mkStore(ids.hq4, '食其家', '店H4b')
  mkStore(ids.subE, '滨寿司', '店E')
  ids.org4 = mkOrg('丁集团', ids.hq4)
  addMember(ids.org4, ids.subE)
  mapOnce(ids.hq4, '滨寿司', ['竞品Z1'])
  mapOnce(ids.hq4, '食其家', ['竞品Z2'])

  // ---- 集团戊：总部把映射配成**空集**（明确「该品牌没有竞品」）----
  ids.hq5 = mkUser('bs_hq5', '戊集团总部')
  ids.subF = mkUser('bs_subF', '戊-F')
  mkStore(ids.hq5, '滨寿司', '店H5')
  mkStore(ids.subF, '滨寿司', '店F')
  ids.org5 = mkOrg('戊集团', ids.hq5)
  addMember(ids.org5, ids.subF)
  mapOnce(ids.hq5, '滨寿司', [])

  // ---- 散客（不属于任何集团）----
  ids.outsider = mkUser('bs_outsider', '散客公司')
  mkStore(ids.outsider, '滨寿司', '店O')

  for (const k of Object.keys(ids)) {
    if (typeof ids[k] !== 'number' || ['org1', 'org2', 'org3', 'org4', 'org5'].includes(k)) continue
    tokens[k] = signToken({ id: ids[k], username: `bs_${k}`, role: 'user', token_version: 0 })
  }

  const express = (await import('express')).default
  const mapRouter = (await import('../src/routes/brand-competitor-map.js')).default
  const app = express()
  app.use(express.json())
  app.use('/api/brand-competitor-map', mapRouter)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ===========================================================================
describe('A. 三态 + 自有优先（继承不得改变 344 的语义）', () => {
  it('A1 总部自己：用自己的映射，source=self', () => {
    const r = resolveBrandScope(db, ids.hq1, '滨寿司')
    expect(r.source).toBe('self')
    expect(r.compBrands).toEqual(['竞品A1', '竞品A2'])
    expect(r.inheritedFrom).toBeNull()
  })

  it('A2 成员未配 ⇒ 继承总部口径，回带集团名与总部 id', () => {
    const r = resolveBrandScope(db, ids.subA, '滨寿司')
    expect(r.source).toBe('group')
    expect(r.compBrands).toEqual(['竞品A1', '竞品A2'])
    expect(Number(r.inheritedFrom)).toBe(Number(ids.hq1))
    expect(r.inheritedFromName).toBe('泉膳中国')
  })

  it('A3 成员自配非空 ⇒ 自有优先，⛔ 集团不覆盖', () => {
    const r = resolveBrandScope(db, ids.subB, '滨寿司')
    expect(r.source).toBe('self')
    expect(r.compBrands).toEqual(['竞品C'])
  })

  it('🔴 A4 成员显式空集（scope 有行、map 无行）⇒ 空集，⛔ 不被集团口径冲掉', () => {
    const r = resolveBrandScope(db, ids.subB, '食其家')
    expect(r.source).toBe('self')
    expect(r.compBrands).toEqual([])
    // 生效 SQL 必须是「真 0 家」，⛔ 不能退化成全量
    const w = competitorWhere(r.compBrands)
    expect(w.sql).toBe(' AND 1 = 0')
    expect(scopeCacheKey(r.compBrands)).toBe('none')
  })

  it('A5 两边都没配 ⇒ null ⇒ 全量（老行为逐字节不变）', () => {
    const r = resolveBrandScope(db, ids.outsider, '滨寿司')
    expect(r.source).toBe('none')
    expect(r.compBrands).toBeNull()
    expect(competitorWhere(r.compBrands).sql).toBe('')
    expect(scopeCacheKey(r.compBrands)).toBe('all')
  })

  it('A6 品牌不属于该账号（门店里没有）⇒ 不继承，退回全量', () => {
    // 集团丁配了食其家，但成员 E 门店里只有滨寿司
    const r = resolveBrandScope(db, ids.subE, '食其家')
    expect(r.source).toBe('none')
    expect(r.compBrands).toBeNull()
  })

  it('A7 总部把映射配成空集 ⇒ 成员继承到空集（真 0 家，判未评，⛔ 不是全量）', () => {
    const r = resolveBrandScope(db, ids.subF, '滨寿司')
    expect(r.source).toBe('group')
    expect(r.compBrands).toEqual([])
    expect(competitorWhere(r.compBrands).sql).toBe(' AND 1 = 0')
  })

  it('A8 resolveCompBrands 的签名与语义一字未改（窄接口）', () => {
    expect(resolveCompBrands(db, ids.subA, '滨寿司')).toEqual(['竞品A1', '竞品A2'])
    expect(resolveCompBrands(db, ids.subB, '食其家')).toEqual([])
    expect(resolveCompBrands(db, ids.outsider, '滨寿司')).toBeNull()
    expect(resolveCompBrands(db, ids.subA, '')).toBeNull()
  })
})

// ===========================================================================
describe('B. 继承是「活的」：改动立即生效，失效零清理', () => {
  it('B1 集团改映射 ⇒ 成员立刻拿到新集合（零同步、零重登）', () => {
    db.prepare(`UPDATE brand_competitor_map SET competitor_brand = '竞品NEW' WHERE user_id = ? AND my_brand = '滨寿司' AND competitor_brand = '竞品A2'`).run(ids.hq1)
    try {
      expect(resolveBrandScope(db, ids.subA, '滨寿司').compBrands).toContain('竞品NEW')
      // 自配的成员 B 不受影响
      expect(resolveBrandScope(db, ids.subB, '滨寿司').compBrands).toEqual(['竞品C'])
    } finally {
      db.prepare(`UPDATE brand_competitor_map SET competitor_brand = '竞品A2' WHERE user_id = ? AND my_brand = '滨寿司' AND competitor_brand = '竞品NEW'`).run(ids.hq1)
    }
    expect(resolveBrandScope(db, ids.subA, '滨寿司').compBrands).toEqual(['竞品A1', '竞品A2'])
  })

  it('B2 已解散集团 ⇒ 不继承', () => {
    const r = resolveBrandScope(db, ids.subC, '滨寿司')
    expect(r.source).toBe('none')
    expect(r.compBrands).toBeNull()
  })

  it('B3 成员被移出集团 ⇒ 继承立即消失（不需要任何清理任务）', () => {
    expect(resolveBrandScope(db, ids.subD, '滨寿司').source).toBe('group')
    db.prepare(`DELETE FROM org_members WHERE org_id = ? AND user_id = ?`).run(ids.org3, ids.subD)
    expect(resolveBrandScope(db, ids.subD, '滨寿司').source).toBe('none')
    // 复原，避免影响后续用例
    db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`).run(ids.org3, ids.subD)
  })

  it('B4 总部账号**不继承自己**（它不是成员）', () => {
    // 总部配的映射读出来是 self；即便把总部误写进 org_members 也不会自继承
    const before = resolveBrandScope(db, ids.hq1, '滨寿司')
    expect(before.source).toBe('self')
    db.prepare(`INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull) VALUES (?, ?, 'member', 1, 1)`).run(ids.org1, ids.hq1)
    try {
      expect(resolveBrandScope(db, ids.hq1, '滨寿司').source).toBe('self')
    } finally {
      db.prepare(`DELETE FROM org_members WHERE org_id = ? AND user_id = ?`).run(ids.org1, ids.hq1)
    }
  })

  it('B5 allow_group_pull=0 的成员**仍然继承**（该开关只管数据上行，2026-09-21 拍板）', () => {
    db.prepare(`UPDATE org_members SET allow_group_pull = 0 WHERE org_id = ? AND user_id = ?`).run(ids.org1, ids.subA)
    try {
      expect(resolveBrandScope(db, ids.subA, '滨寿司').source).toBe('group')
    } finally {
      db.prepare(`UPDATE org_members SET allow_group_pull = 1 WHERE org_id = ? AND user_id = ?`).run(ids.org1, ids.subA)
    }
  })
})

// ===========================================================================
describe('C. 零复制：解析不写库', () => {
  it('C1 反复解析后全表行数不变，成员没有产生任何 scope/map 行', () => {
    const before = snapshotCounts()
    for (let i = 0; i < 5; i++) {
      resolveBrandScope(db, ids.subA, '滨寿司')
      resolveBrandScope(db, ids.subA, '食其家')
      resolveBrandScope(db, ids.subE, '滨寿司')
      brandScopeMeta(db, ids.subA, null)
    }
    expect(snapshotCounts()).toEqual(before)
    expect(db.prepare(`SELECT COUNT(*) AS c FROM brand_competitor_scope WHERE user_id = ?`).get(ids.subA).c).toBe(0)
    expect(db.prepare(`SELECT COUNT(*) AS c FROM brand_competitor_map WHERE user_id = ?`).get(ids.subA).c).toBe(0)
  })
})

// ===========================================================================
describe('D. meta 口径：scopes / ownScopes / inheritedScopes 三者分工', () => {
  it('D1 成员未配 ⇒ scopes（生效口径）含继承，ownScopes 为空', () => {
    const info = resolveBrandScope(db, ids.subA, '滨寿司')
    const m = brandScopeMeta(db, ids.subA, info.compBrands, info)
    expect(m.ownScopes).toEqual({})
    expect(m.scopes['滨寿司']).toEqual(['竞品A1', '竞品A2'])
    expect(m.inheritedScopes['滨寿司']).toEqual(['竞品A1', '竞品A2'])
    expect(m.inherit.available).toBe(true)
    expect(m.inherit.orgName).toBe('泉膳中国')
    expect(m.brandScope.source).toBe('group')
  })

  it('D2 成员自配 ⇒ scopes 里该品牌是自有那份（自有优先），ownScopes 记录来源', () => {
    const info = resolveBrandScope(db, ids.subB, '滨寿司')
    const m = brandScopeMeta(db, ids.subB, info.compBrands, info)
    expect(m.scopes['滨寿司']).toEqual(['竞品C'])
    expect(m.ownScopes['滨寿司']).toEqual(['竞品C'])
    // inheritedScopes 仍保留集团那份（前端靠它判断「删掉自己的会不会回落到集团」）
    expect(m.inheritedScopes['滨寿司']).toEqual(['竞品A1', '竞品A2'])
    expect(m.brandScope.source).toBe('self')
  })

  it('D3 inheritedScopes 只含「本账号门店里真有」的品牌（丁集团多配的食其家不外溢）', () => {
    const m = brandScopeMeta(db, ids.subE, null)
    expect(m.scopes['滨寿司']).toEqual(['竞品Z1'])
    expect(m.scopes['食其家']).toBeUndefined()
    expect(m.inheritedScopes['食其家']).toBeUndefined()
  })

  it('D4 🔴 归一重名去重：自有「 滨寿司 」与集团「滨寿司」不得同时留在 scopes 里', () => {
    // 自有写法带空格、集团写法不带 ⇒ 字面 key 不同、归一后相同。
    // scopeBrandsFor 用 Object.keys().find(归一匹配) 取第一个命中的，若两份都留着会读到集团那份。
    db.prepare(`INSERT INTO brand_competitor_scope (user_id, my_brand) VALUES (?, ?)`).run(ids.subE, ' 滨寿司 ')
    db.prepare(`INSERT INTO brand_competitor_map (user_id, my_brand, competitor_brand) VALUES (?, ?, ?)`).run(ids.subE, ' 滨寿司 ', '竞品OWN')
    try {
      const m = brandScopeMeta(db, ids.subE, null)
      const keys = Object.keys(m.scopes).filter(k => k.replace(/\s+/g, '').toUpperCase() === '滨寿司')
      expect(keys.length).toBe(1)
      expect(m.scopes[keys[0]]).toEqual(['竞品OWN'])   // 自有优先：⛔ 不能是集团的竞品Z1
    } finally {
      db.prepare(`DELETE FROM brand_competitor_map WHERE user_id = ? AND my_brand = ' 滨寿司 '`).run(ids.subE)
      db.prepare(`DELETE FROM brand_competitor_scope WHERE user_id = ? AND my_brand = ' 滨寿司 '`).run(ids.subE)
    }
  })

  it('D5 散客 / 总部：inherit.available 说明有没有集团可继承', () => {
    expect(brandScopeMeta(db, ids.outsider, null).inherit.available).toBe(false)
    expect(brandScopeMeta(db, ids.hq1, null).inherit.available).toBe(false)  // 总部不是成员
    expect(brandScopeMeta(db, ids.subA, null).inherit.available).toBe(true)
  })
})

// ===========================================================================
describe('E. HTTP：配置接口如实回报「这份口径是谁配的」', () => {
  it('E1 GET：成员继承 ⇒ brandScope.source=group，inheritedScopes 有值', async () => {
    const { status, body } = await call('GET', '/api/brand-competitor-map?myBrand=滨寿司', { token: tokens.subA })
    expect(status).toBe(200)
    expect(body.brandScope.source).toBe('group')
    expect(body.brandScope.inheritedFromName).toBe('泉膳中国')
    expect(body.scopes['滨寿司']).toEqual(['竞品A1', '竞品A2'])
    expect(body.ownScopes).toEqual({})
  })

  it('E2 PUT：子公司在继承口径上点保存 ⇒ 变成本账号独立配置（source=self）', async () => {
    const { status, body } = await call('PUT', '/api/brand-competitor-map', {
      token: tokens.subA,
      body: { myBrand: '滨寿司', competitorBrands: ['竞品A1'] }
    })
    expect(status).toBe(200)
    expect(body.brandScope.source).toBe('self')
    expect(body.ownScopes['滨寿司']).toEqual(['竞品A1'])
    expect(resolveBrandScope(db, ids.subA, '滨寿司').compBrands).toEqual(['竞品A1'])
  })

  it('🔴 E3 DELETE：集团配过 ⇒ 删掉自有配置是**回落到继承**，不是回到全量', async () => {
    const { status, body } = await call('DELETE', '/api/brand-competitor-map?myBrand=滨寿司', { token: tokens.subA })
    expect(status).toBe(200)
    expect(body.brandScope.source).toBe('group')
    expect(body.brandScope.configured).toBe(true)
    expect(body.scopes['滨寿司']).toEqual(['竞品A1', '竞品A2'])
    expect(body.ownScopes).toEqual({})
  })

  it('E4 DELETE：集团没配 ⇒ 真的回到全量（source=none）', async () => {
    // 吉野家：集团甲没配过 ⇒ 删掉自己的配置后应回到全量，而不是继承
    await call('PUT', '/api/brand-competitor-map', {
      token: tokens.subB,
      body: { myBrand: '吉野家', competitorBrands: ['竞品K'] }
    })
    expect(resolveBrandScope(db, ids.subB, '吉野家').source).toBe('self')
    const { status, body } = await call('DELETE', '/api/brand-competitor-map?myBrand=吉野家', { token: tokens.subB })
    expect(status).toBe(200)
    expect(body.brandScope.source).toBe('none')
    expect(body.brandScope.configured).toBe(false)
    expect(resolveBrandScope(db, ids.subB, '吉野家').compBrands).toBeNull()
  })

  it('E5 写接口仍然只写本账号（不碰总部的行）', async () => {
    const hqBefore = db.prepare(`SELECT competitor_brand FROM brand_competitor_map WHERE user_id = ? AND my_brand = '滨寿司' ORDER BY competitor_brand`).all(ids.hq1)
    await call('PUT', '/api/brand-competitor-map', {
      token: tokens.subE,
      body: { myBrand: '滨寿司', competitorBrands: ['竞品Z1', '竞品Z9'] }
    })
    const hqAfter = db.prepare(`SELECT competitor_brand FROM brand_competitor_map WHERE user_id = ? AND my_brand = '滨寿司' ORDER BY competitor_brand`).all(ids.hq1)
    expect(hqAfter).toEqual(hqBefore)
    expect(db.prepare(`SELECT COUNT(*) AS c FROM brand_competitor_map WHERE user_id = ? AND my_brand = '滨寿司'`).get(ids.subE).c).toBe(2)
  })
})

// ===========================================================================
describe('F. 349 联动：继承算「已配置」，不再重复阻断', () => {
  let decideBrandMapPrompt, buildRequiredMapDraft
  beforeAll(async () => {
    const m = await import('../../frontend/src/utils/brandMapPrompt.js')
    decideBrandMapPrompt = m.decideBrandMapPrompt
    buildRequiredMapDraft = m.buildRequiredMapDraft
  })

  it('F1 两品牌都靠继承 ⇒ 不强制', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家'],
      scopes: {},
      inheritedScopes: { 滨寿司: ['x'], 食其家: ['y'] }
    })
    expect(d.required).toBe(false)
    expect(d.reason).toBe('all-configured')
    expect(d.inherited).toEqual(['滨寿司', '食其家'])
  })

  it('F2 双保险：scopes 为空只传 inheritedScopes 也不强制', () => {
    const d = decideBrandMapPrompt({ myBrands: ['A', 'B'], scopes: {}, inheritedScopes: { A: [], B: ['y'] } })
    expect(d.required).toBe(false)
  })

  it('F3 一个继承 + 一个真没配 ⇒ 只点名真没配的那个', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家'],
      scopes: {},
      inheritedScopes: { 滨寿司: ['x'] }
    })
    expect(d.required).toBe(true)
    expect(d.missing).toEqual(['食其家'])
    expect(d.inherited).toEqual(['滨寿司'])
  })

  it('F4 草稿只列未配置品牌（继承的不进草稿）', () => {
    const rows = buildRequiredMapDraft({
      myBrands: ['A', 'B'],
      scopes: {},
      inheritedScopes: { A: ['x'] },
      justImportedBrand: '竞品Q'
    })
    expect(rows.map(r => r.myBrand)).toEqual(['B'])
  })

  it('F5 自有优先在判据里成立：自己配的不会被继承的 key 顶掉', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['A', 'B'],
      scopes: { A: [], B: ['x'] },
      inheritedScopes: { A: ['y'] }
    })
    expect(d.required).toBe(false)
    expect(d.inherited).toEqual([])  // A 是自配（空集），不算继承
  })
})

// ===========================================================================
describe('G. 接线守卫：前端真的把继承接上了', () => {
  const stripJsComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const templateOf = src => {
    const a = src.indexOf('<template>')
    const b = src.indexOf('<script setup')
    return (a >= 0 && b > a ? src.slice(a, b) : '').replace(/<!--[\s\S]*?-->/g, '')
  }

  it('G1 CompetitorView 两处判据都传 inheritedScopes', () => {
    const js = stripJsComments(read(VIEW))
    const hits = [...js.matchAll(/decideBrandMapPrompt\(\{[\s\S]*?\}\)/g)].map(m => m[0])
    expect(hits.length).toBeGreaterThanOrEqual(2)
    for (const h of hits) expect(h).toContain('inheritedScopes')
  })

  it('G2 模板把 inheritedScopes 传给强制弹窗', () => {
    const tpl = templateOf(read(VIEW))
    expect(tpl).toContain(':inherited-scopes="scopeMeta.inheritedScopes"')
    // 349 的原有透传不能被顺手删掉
    expect(tpl).toContain(':scopes="scopeMeta.scopes"')
  })

  it('G3 配置弹窗能看出「这是继承来的」并且按钮文案会切换', () => {
    const tpl = templateOf(read(VIEW))
    expect(tpl).toContain('mapBrandSource')
    expect(tpl).toContain('resetMapLabel')
    expect(tpl).toContain('inheritName')
  })

  it('G4 🔴 元数据赋值收口到 applyScopeMeta（三处都不许再手写字段赋值）', () => {
    const js = stripJsComments(read(VIEW))
    expect(js).toContain('function applyScopeMeta')
    const assigns = [...js.matchAll(/scopeMeta\.value\s*=\s*\{/g)]
    // 只允许 applyScopeMeta 内部那一处
    expect(assigns.length).toBe(1)
    const applyCalls = [...js.matchAll(/applyScopeMeta\(/g)]
    expect(applyCalls.length).toBeGreaterThanOrEqual(4) // 定义 1 + 读/存/恢复 3
  })

  it('G5 恢复按钮真的按来源禁用/换文案（⛔ 不能一律「恢复全量」）', () => {
    const tpl = templateOf(read(VIEW))
    expect(tpl).toMatch(/mapBrandSource === 'group'/)
    const js = stripJsComments(read(VIEW))
    expect(js).toContain("已是集团口径")
    expect(js).toContain('恢复为集团口径')
  })

  it('G6 强制弹窗组件透传 inheritedScopes 给判据', () => {
    const js = stripJsComments(read(DIALOG))
    expect(js).toContain('inheritedScopes')
    expect(js).toMatch(/buildRequiredMapDraft\(\{[\s\S]*?inheritedScopes/)
  })
})
