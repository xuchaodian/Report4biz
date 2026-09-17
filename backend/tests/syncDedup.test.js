/**
 * 业务键判重（v0.13 R2 · 规则 34）测试
 *
 * 被测：src/utils/syncCore.js 的 businessKeyOf / buildBusinessKeyIndex
 *      以及 buildPlan / listCandidates / applyPlan 的判重分支。
 *
 * 为什么需要它：指针匹配（user_id + origin_user_id + origin_row_id）只能回答
 * 「这行是不是从那边来的」，回答不了「这是不是同一家门店」。于是三处会重复：
 *   · 目标账号自己录过某店，而这店源侧本来就有
 *   · 两家账号都录了同一家店
 *   · 划拨之后新持有方又录了一遍
 *
 * 判重策略（**先到先得**）：
 *   命中目标账号已有行 ⇒ 记 items.duplicate + counts.duplicate，**不写入**。
 *   ⛔ 绝不静默丢弃（静默丢弃是本系统踩过的坑）—— 预览里必须逐条列出来。
 *
 * ⚠️ 判重键的两条自保设计（都有对应断言）：
 *   ① store_code 带 **brand 前缀** —— 竞品表 6 个品牌各有一套门店编号，
 *      只比 code 会把「老乡鸡 #900」和「米村拌饭 #900」判成同一家 ⇒ **漏同步＝丢数据**
 *   ② name+city+address 要求 name 非空且 city/address 至少有一个 ——
 *      只有名字的键（「星巴克」）太弱，连锁品牌必然误判
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-dedup-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let getDb, server, base, jwtSign
let core = {}

const tokens = {}
const ids = {}
const R = {}

function makeToken(user) {
  return jwtSign({ id: user.id, username: user.username, role: user.role })
}

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

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  jwtSign = (payload) => jwt.sign(payload, cfg.JWT_SECRET, { expiresIn: '1h' })

  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  core = await import('../src/utils/syncCore.js')

  const orgsRouter = (await import('../src/routes/orgs.js')).default
  const syncRouter = (await import('../src/routes/sync.js')).default

  const db = getDb()
  const seed = (username, role) => db.prepare(
    `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, 0)`
  ).run(username, `${username}@test.local`, 'x', role).lastInsertRowid

  ids.admin = seed('dd_admin', 'admin')
  ids.hq = seed('dd_hq', 'user')
  ids.sub = seed('dd_sub', 'user')
  for (const k of ['admin', 'hq', 'sub']) {
    tokens[k] = makeToken({ id: ids[k], username: `dd_${k}`, role: k === 'admin' ? 'admin' : 'user' })
  }

  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use('/api/orgs', orgsRouter)
  app.use('/api/sync', syncRouter)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`

  const r1 = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '判重集团', ownerUserId: ids.hq } })
  ids.org = r1.body.org.id
  await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.hq, body: { username: 'dd_sub' } })

  // 名字统一带 DEDUP 前缀，避开自动播种数据的干扰
  const mk = (uid, o) => db.prepare(`
    INSERT INTO markers (name, store_code, brand, city, address, latitude, longitude, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    o.name, o.code ?? null, o.brand ?? 'DEDUP品牌', o.city,
    o.address ?? null, o.lat ?? 31.3, o.lng ?? 120.6, uid
  ).lastInsertRowid

  // ---- 集团账号名下（源）----
  R.g1 = mk(ids.hq, { name: 'DEDUP集团店1', code: 'S001', city: '苏州市' })
  R.g2 = mk(ids.hq, { name: 'DEDUP集团店2', code: null, city: '苏州市', address: '人民路1号' })
  R.g3 = mk(ids.hq, { name: 'DEDUP集团店3', code: 'S003', brand: '老乡鸡', city: '苏州市' })
  R.g4 = mk(ids.hq, { name: 'DEDUP集团店4', code: 'S003', brand: '米村拌饭', city: '苏州市' })
  R.g5 = mk(ids.hq, { name: 'DEDUP集团店5', code: 'S900', brand: '老乡鸡', city: '苏州市' })
  R.g6 = mk(ids.hq, { name: 'DEDUP集团店6', code: 'S900', brand: '老乡鸡', city: '苏州市' })
  R.gNoKey = mk(ids.hq, { name: 'DEDUP无键店', code: null, city: '苏州市' })   // 只有名字 ⇒ 不判重

  // ---- 子公司自建（目标）----
  R.s1 = mk(ids.sub, { name: 'DEDUP子公司自建1', code: 'S001', city: '苏州市' })
  // 故意用「苏州」（不带市）+ 首尾空格的地址，验证归一化
  R.s2 = mk(ids.sub, { name: 'DEDUP集团店2', code: null, city: '苏州', address: '  人民路1号  ' })

  await call('PATCH', `/api/orgs/${ids.org}/members/${ids.sub}/scope`, {
    token: tokens.hq, body: { cities: ['苏州市'], brands: [] }
  })
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ===========================================================================

describe('① businessKeyOf 纯函数', () => {
  it('store_code 优先，且带 brand 前缀（防跨品牌撞号）', () => {
    expect(core.businessKeyOf({ store_code: 'S001', brand: '老乡鸡', name: 'X', city: '苏州市' }))
      .toEqual({ key: 'code:老乡鸡|s001', by: 'store_code' })
    // 同 code 不同 brand ⇒ 不同键（否则会把两家不同的店判成同一家 = 漏同步丢数据）
    const k1 = core.businessKeyOf({ store_code: 'S900', brand: '老乡鸡' })
    const k2 = core.businessKeyOf({ store_code: 'S900', brand: '米村拌饭' })
    expect(k1.key).not.toBe(k2.key)
  })

  it('回退 name+city+address：归一化大小写/空白，城市按 normalizeCity 归一', () => {
    const a = core.businessKeyOf({ name: 'DEDUP集团店2', city: '苏州', address: '  人民路1号 ' })
    const b = core.businessKeyOf({ name: ' dedup集团店2 ', city: '苏州市', address: '人民路1号' })
    expect(a.key).toBe(b.key)
    expect(a.by).toBe('name_city_address')
  })

  it('信息量不足 ⇒ null（宁可不判，也不误判）', () => {
    expect(core.businessKeyOf({ name: '', city: '苏州市', address: '人民路1号' })).toBe(null)
    expect(core.businessKeyOf({ name: 'DEDUP孤零零' })).toBe(null)                  // 只有名字
    expect(core.businessKeyOf({ name: 'DEDUP孤零零', city: '', address: '' })).toBe(null)
    expect(core.businessKeyOf(null)).toBe(null)
    // 只有 name+city 就够（address 可缺）
    expect(core.businessKeyOf({ name: 'DEDUP甲', city: '苏州市' })).toBeTruthy()
    // 只有 name+address 也够
    expect(core.businessKeyOf({ name: 'DEDUP甲', address: '人民路1号' })).toBeTruthy()
  })
})

describe('② buildPlan：判重命中目标账号已有行（先到先得，不写入）', () => {
  it('group_to_member 预览：命中自建行 ⇒ 计入 duplicate 且带命中详情', () => {
    const db = getDb()
    const p = core.buildPlan(db, {
      kind: 'markers',
      direction: 'group_to_member',
      sourceUserId: ids.hq,
      targetUserId: ids.sub,
      scopeJson: JSON.stringify({ cities: ['苏州市'], brands: [] })
    })

    // 集团 7 行：g1 命中 s1（store_code）、g2 命中 s2（name+city+address）、
    //           g6 与同批的 g5 同键 ⇒ 第 2 条判重、gNoKey 无键 ⇒ 照常新增
    const dupNames = p.items.duplicate.map(i => i.name).sort()
    expect(dupNames).toEqual(['DEDUP集团店1', 'DEDUP集团店2', 'DEDUP集团店6'])
    expect(p.counts.duplicate).toBe(3)

    // store_code 命中：命中的是「目标账号自建行」
    const d1 = p.items.duplicate.find(i => i.name === 'DEDUP集团店1')
    expect(d1.by).toBe('store_code')
    expect(d1.matchedRowId).toBe(R.s1)
    expect(d1.matchedIsLocal).toBe(true)          // 目标账号自己录的
    expect(d1.matchedOriginUserId).toBe(null)

    // name+city+address 命中（跨「苏州 / 苏州市」与地址空格差异）
    const d2 = p.items.duplicate.find(i => i.name === 'DEDUP集团店2')
    expect(d2.by).toBe('name_city_address')
    expect(d2.matchedRowId).toBe(R.s2)

    // 同批内自重复：g5 先到（added），g6 后到（duplicate），且没有目标行 id
    const d3 = p.items.duplicate.find(i => i.name === 'DEDUP集团店6')
    expect(d3.by).toBe('store_code')
    expect(d3.matchedRowId).toBe(null)             // 命中对象是本批新增行，尚未落库

    // 跨品牌同 code 不误判 ⇒ g3 / g4 都该是「新增」
    //   ⚠️ 别用 Array.sort() 排序后比较：JS 默认按 UTF-16 码位排，中文顺序不是拼音
    const addedNames = new Set(p.items.added.map(i => i.name))
    expect(addedNames).toEqual(new Set(['DEDUP集团店3', 'DEDUP集团店4', 'DEDUP集团店5', 'DEDUP无键店']))
    expect(p.counts.added).toBe(4)

    // total 含 duplicate（否则预览里分项加总对不上）
    expect(p.counts.total).toBe(p.counts.added + p.counts.updated + p.counts.deleted
      + p.counts.skipped + p.counts.duplicate)
  })

  it('listCandidates 与 buildPlan 同源：mirrorState=duplicate + duplicateOfRowId', () => {
    const db = getDb()
    const c = core.listCandidates(db, {
      kind: 'markers', sourceUserId: ids.hq, targetUserId: ids.sub,
      scopeJson: JSON.stringify({ cities: ['苏州市'], brands: [] })
    })
    expect(c.duplicate).toBe(3)
    const hit = c.inScope.find(i => i.name === 'DEDUP集团店1')
    expect(hit.mirrorState).toBe('duplicate')
    expect(hit.duplicated).toBe(true)
    expect(hit.duplicateOfRowId).toBe(R.s1)
    // 无键行仍是 new
    expect(c.inScope.find(i => i.name === 'DEDUP无键店').mirrorState).toBe('new')
  })

  it('★ commit：duplicate **一行都不写**，目标账号自建行原封不动', async () => {
    const db = getDb()
    const before = db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ids.sub).n
    const s1Before = db.prepare(`SELECT name, store_code, updated_at FROM markers WHERE id = ?`).get(R.s1)

    const pv = await call('POST', '/api/sync/preview', {
      token: tokens.sub, body: { direction: 'group_to_member', kind: 'markers', filter: {} }
    })
    expect(pv.status).toBe(200)
    expect(pv.body.counts.duplicate).toBe(3)

    const cm = await call('POST', '/api/sync/commit', { token: tokens.sub, body: { batchId: pv.body.batchId } })
    expect(cm.status).toBe(200)
    expect(cm.body.applied.inserted).toBe(4)          // 只有 4 条新增
    expect(cm.body.applied.duplicate).toBe(3)         // 3 条疑似重复被记录（未写入）

    // 目标账号行数 = 原有 2 + 新增 4（3 条被判重的**没有**被写进来）
    expect(db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ids.sub).n).toBe(before + 4)
    // 自建行内容零改动（判重只提示，绝不改写命中对象）
    const s1After = db.prepare(`SELECT name, store_code, updated_at FROM markers WHERE id = ?`).get(R.s1)
    expect(s1After).toEqual(s1Before)

    // 批次审计：skipped 列把 duplicate 一并计入（它是「没同步成」的行）
    const b = db.prepare(`SELECT status, inserted, skipped, detail FROM sync_batches WHERE id = ?`).get(pv.body.batchId)
    expect(b.status).toBe('success')
    expect(b.inserted).toBe(4)
    expect(b.skipped).toBeGreaterThanOrEqual(3)
    const detail = JSON.parse(b.detail)
    expect(detail.applied.some(x => x.action === 'duplicate_skip')).toBe(true)
  })
})

describe('③ member_to_group：子公司自建行若集团已有 ⇒ 判重（先到先得）', () => {
  it('集团拉取时，目标账号（集团）已有同店 ⇒ 不新增、不覆盖集团数据', async () => {
    const db = getDb()
    // 上一轮已把 g3/g4/g5/gNoKey 同步到子公司 ⇒ 子公司名下那些是「集团来源的镜像」，
    // 会被防回环（规则 3）跳过；真正参与上传的只有 s1 / s2 两条自建行。
    const pv = await call('POST', '/api/sync/preview', {
      token: tokens.hq, body: { direction: 'member_to_group', userId: ids.sub, kind: 'markers', filter: {} }
    })
    expect(pv.status).toBe(200)
    // s1 撞集团 g1（code S001）、s2 撞集团 g2（name+city+address）
    expect(pv.body.counts.duplicate).toBe(2)
    expect(pv.body.counts.added).toBe(0)
    expect(pv.body.counts.selfOrigin).toBeGreaterThanOrEqual(4)   // 集团来源的镜像被防回环跳过

    // 反向扫描不得把它们判成删除（源行都还在）
    expect(pv.body.counts.deleted).toBe(0)

    const g1 = db.prepare(`SELECT name FROM markers WHERE id = ?`).get(R.g1)
    expect(g1.name).toBe('DEDUP集团店1')             // 集团侧数据未被覆盖
  })
})
