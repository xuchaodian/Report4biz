/**
 * 同步主链路（批次 D · v0.11）测试
 *
 * 被测：
 *   A. src/utils/syncCore.js —— 同步内核（纯函数 + db 门面）
 *      tableColumns / syncableFields / looseEqual / diffFields / inAllowedScope
 *      checkMemberSwitch / buildPlan / listCandidates / applyPlan / createBatch
 *      reverseCityByCoordinate / fillCityFallback
 *   B. src/routes/sync.js
 *      GET  /api/sync/candidates      POST /api/sync/preview
 *      POST /api/sync/commit          GET  /api/sync/batches[/:id]
 *      POST /api/sync/detach          POST /api/sync/foreign/remove
 *   C. src/routes/markers.js 的只读锁与城市兜底
 *
 * 方式：真起 express（端口 0）+ fetch 打真实 HTTP；不引 supertest（生产未装）。
 *
 * 覆盖的保证（设计方案 §8 规则总表）：
 *   规则 2  幂等     —— 重复同步不产生重复行（唯一索引 + no_change 判定）
 *   规则 3  防回环   —— 跳过 origin_user_id = 目标账号 的源行
 *   规则 4  写权唯一 —— 镜像行 sync_readonly=1，目标侧不能改/删（403）
 *   规则 6  删除传播 —— 源行消失 → 目标侧镜像列为 deleted（需确认）
 *   规则 9  审计     —— 每次同步写 sync_batches（含操作人/IP/明细）
 *   规则 11 范围约束 —— 越界行**静默丢弃并计数**
 *   规则 13 城市兜底 —— city 空则按坐标反查补全（city_source=geocoded）
 *   规则 15 原子性   —— commit 单事务，任一步失败整体回滚
 *   规则 10/24       —— 不跨组织（非成员一律拒绝）
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-sync-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let getDb, server, base, jwtSign
let core = {}
let SC = {}

const tokens = {}
const ids = {}
const rowIds = {}

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

/** 成都（远离播种数据所在的北京/上海/广州 —— 让反查断言可确定） */
const CD = { lat: 30.6588, lng: 104.0648 }
const CD2 = { lat: 30.7000, lng: 104.1000 }
const MY = { lat: 31.4675, lng: 104.6796 }   // 绵阳

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  jwtSign = (payload) => jwt.sign(payload, cfg.JWT_SECRET, { expiresIn: '1h' })

  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb
  core = await import('../src/utils/syncCore.js')
  SC = await import('../src/utils/scopeGuard.js')
  void SC

  const orgsRouter = (await import('../src/routes/orgs.js')).default
  const syncRouter = (await import('../src/routes/sync.js')).default
  const markersRouter = (await import('../src/routes/markers.js')).default

  const db = getDb()
  const seed = (username, role, quota = 0) => db.prepare(
    `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`
  ).run(username, `${username}@test.local`, 'x', role, quota).lastInsertRowid

  ids.admin = seed('admin_y', 'admin')
  ids.hq = seed('hq_y', 'user', 100)
  ids.subA = seed('subA_y', 'user', 0)
  ids.subB = seed('subB_y', 'user', 0)
  ids.outsider = seed('out_y', 'user', 0)
  ids.rbSrc = seed('rbSrc_y', 'user', 0)
  ids.rbTgt = seed('rbTgt_y', 'user', 0)

  for (const k of ['admin', 'hq', 'subA', 'subB', 'outsider']) {
    tokens[k] = makeToken({ id: ids[k], username: `${k}_y`, role: k === 'admin' ? 'admin' : 'user' })
  }

  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use('/api/orgs', orgsRouter)
  app.use('/api/sync', syncRouter)
  app.use('/api/markers', markersRouter)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`

  // 真实接口建集团 + 绑成员
  const r1 = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '批次D集团', ownerUserId: ids.hq } })
  ids.org = r1.body.org.id
  await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.hq, body: { username: 'subA_y' } })
  await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.hq, body: { username: 'subB_y' } })

  // 集团账号（hq）门店：3 条成都 + 1 条绵阳 + 1 条上海（后两条应被范围静默丢弃）
  const mk = (name, city, uid, lat, lng, brand = '萨莉亚') => db.prepare(
    `INSERT INTO markers (name, city, brand, latitude, longitude, user_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name, city, brand, lat, lng, uid).lastInsertRowid

  rowIds.h1 = mk('集团成都店1', '成都市', ids.hq, CD.lat, CD.lng)
  rowIds.h2 = mk('集团成都店2', '成都', ids.hq, CD2.lat, CD2.lng)
  rowIds.h3 = mk('集团成都店3', '成都市', ids.hq, CD.lat + 0.01, CD.lng + 0.01)
  rowIds.h4 = mk('集团绵阳店', '绵阳市', ids.hq, MY.lat, MY.lng)
  rowIds.h5 = mk('集团上海店', '上海市', ids.hq, 31.2304, 121.4737)

  // 子公司 A 自有门店（成都 2 条 + 绵阳 1 条）
  rowIds.s1 = mk('子公司A成都店1', '成都市', ids.subA, CD.lat + 0.02, CD.lng + 0.02, '萨莉亚')
  rowIds.s2 = mk('子公司A成都店2', '成都', ids.subA, CD.lat + 0.03, CD.lng + 0.03, '萨莉亚')
  rowIds.s3 = mk('子公司A绵阳店', '绵阳市', ids.subA, MY.lat + 0.01, MY.lng + 0.01)

  // 集团名下一条「由子公司 A 同步而来」的镜像 → 用于验证防回环（规则 3）
  rowIds.hSelf = db.prepare(`
    INSERT INTO markers (name, city, latitude, longitude, user_id,
                         origin_user_id, origin_row_id, origin_owner, sync_readonly)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run('回流镜像(集团侧)', '成都市', CD.lat + 0.04, CD.lng + 0.04, ids.hq, ids.subA, rowIds.s1, '子公司A').lastInsertRowid

  // 给子公司 A 设管辖范围（成都市）
  await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}/scope`, {
    token: tokens.hq,
    body: { cities: ['成都市'], brands: [] }
  })

  // 回滚测试用：一对干净账号
  rowIds.r1 = mk('回滚源1', '成都市', ids.rbSrc, CD.lat, CD.lng)
  rowIds.r2 = mk('回滚源2', '成都市', ids.rbSrc, CD.lat, CD.lng)
  db.prepare(`
    INSERT INTO markers (name, city, latitude, longitude, user_id, origin_user_id, origin_row_id, sync_readonly)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run('回滚预置镜像', '成都市', CD.lat, CD.lng, ids.rbTgt, ids.rbSrc, rowIds.r2)
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ===========================================================================

describe('① syncCore 纯函数', () => {
  it('tableColumns / syncableFields：按真实表结构取列，且排除来源与系统列', () => {
    const db = getDb()
    const cols = core.tableColumns(db, 'markers')
    expect(cols).toContain('id')
    expect(cols).toContain('city')
    expect(cols).toContain('store_status')   // 生产真库有、建表语句曾漏的列

    const f = core.syncableFields(db, 'markers')
    for (const bad of ['id', 'user_id', 'created_at', 'updated_at', 'origin_user_id', 'origin_row_id',
      'origin_owner', 'sync_batch_id', 'sync_readonly']) {
      expect(f).not.toContain(bad)
    }
    expect(f).toContain('name')
    expect(f).toContain('city')
  })

  it('looseEqual：空值等价、数字/数字串等价、不同文案不等价', () => {
    expect(core.looseEqual(null, '')).toBe(true)
    expect(core.looseEqual(undefined, null)).toBe(true)
    expect(core.looseEqual(3, '3')).toBe(true)
    expect(core.looseEqual(3.0, 3)).toBe(true)
    expect(core.looseEqual('上海市', '上海')).toBe(false)
    expect(core.looseEqual('abc', null)).toBe(false)
    expect(core.looseEqual(0, '')).toBe(false)     // 0 不是空值
  })

  it('diffFields：只报真正变化的字段', () => {
    const fields = ['name', 'city', 'seats', 'area']
    const src = { name: 'A', city: '成都市', seats: '80', area: 120 }
    const mir = { name: 'A', city: '成都', seats: 80, area: null }
    const ch = core.diffFields(fields, src, mir)
    const names = ch.map(c => c.field).sort()
    expect(names).toEqual(['area', 'city'])       // seats 只是写法不同
    expect(ch.find(c => c.field === 'city')).toMatchObject({ from: '成都', to: '成都市' })
  })

  it('inAllowedScope：范围外/城市空/品牌不匹配 → false；belong 命中 → true', () => {
    const matcher = { cityKeys: new Set(['成都']), brands: new Set(), belongUserId: 9 }
    expect(core.inAllowedScope({ city: '成都市' }, matcher)).toBe(true)
    expect(core.inAllowedScope({ city: ' 成都 ' }, matcher)).toBe(true)
    expect(core.inAllowedScope({ city: '绵阳市' }, matcher)).toBe(false)
    expect(core.inAllowedScope({ city: '' }, matcher)).toBe(false)
    expect(core.inAllowedScope({ city: '绵阳市', belong_member_user_id: 9 }, matcher)).toBe(true)

    const brandMatcher = { cityKeys: new Set(['成都']), brands: new Set(['萨莉亚']), belongUserId: null }
    expect(core.inAllowedScope({ city: '成都市', brand: '萨莉亚' }, brandMatcher)).toBe(true)
    expect(core.inAllowedScope({ city: '成都市', brand: '老乡鸡' }, brandMatcher)).toBe(false)
    expect(core.inAllowedScope({ city: '成都市', brand: '' }, brandMatcher)).toBe(false)
  })

  it('checkMemberSwitch：can_receive / allow_group_pull 分别管两个方向', () => {
    const on = { can_receive: 1, allow_group_pull: 1 }
    expect(core.checkMemberSwitch(on, core.DIRECTIONS.GROUP_TO_MEMBER).ok).toBe(true)
    expect(core.checkMemberSwitch(on, core.DIRECTIONS.MEMBER_TO_GROUP).ok).toBe(true)

    const noRecv = { can_receive: 0, allow_group_pull: 1 }
    const r1 = core.checkMemberSwitch(noRecv, core.DIRECTIONS.GROUP_TO_MEMBER)
    expect(r1.ok).toBe(false)
    expect(r1.code).toBe('member_can_receive_off')
    expect(core.checkMemberSwitch(noRecv, core.DIRECTIONS.MEMBER_TO_GROUP).ok).toBe(true)

    const noPull = { can_receive: 1, allow_group_pull: 0 }
    expect(core.checkMemberSwitch(noPull, core.DIRECTIONS.MEMBER_TO_GROUP).code).toBe('member_pull_off')
    expect(core.checkMemberSwitch(null, core.DIRECTIONS.MEMBER_TO_GROUP).code).toBe('not_member')
  })
})

describe('② buildPlan / listCandidates（规则 2 / 3 / 6 / 11）', () => {
  const planArgs = () => ({
    kind: 'markers',
    direction: core.DIRECTIONS.GROUP_TO_MEMBER,
    sourceUserId: ids.hq,
    targetUserId: ids.subA,
    scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }),
    belongUserId: ids.subA,
    keyword: ''
  })

  it('范围外的行被静默丢弃并计数（不报错、不进 items）', () => {
    const p = core.buildPlan(getDb(), planArgs())
    // 成都 3 条进候选；绵阳/上海各 1 条越界
    expect(p.counts.outOfScope).toBe(2)
    expect(p.counts.added).toBe(3)
    expect(p.items.added.length).toBe(3)
    const names = p.items.added.map(i => i.name)
    expect(names).not.toContain('集团绵阳店')
    expect(names).not.toContain('集团上海店')
  })

  it('防回环：origin_user_id = 目标账号 的源行计入 skipped(self_origin)', () => {
    const p = core.buildPlan(getDb(), planArgs())
    expect(p.counts.selfOrigin).toBe(1)
    expect(p.items.skipped.some(s => s.reason === 'self_origin' && s.rowId === rowIds.hSelf)).toBe(true)
    expect(p.items.added.some(i => i.rowId === rowIds.hSelf)).toBe(false)
  })

  it('keyword 过滤：不匹配的行计入 outOfFilter（同样是静默丢弃）', () => {
    const p = core.buildPlan(getDb(), { ...planArgs(), keyword: '成都店2' })
    expect(p.counts.added).toBe(1)
    expect(p.counts.outOfFilter).toBe(2)
  })

  it('scope 城市为空 → 一条都不同步（范围是上限，空 = 无授权）', () => {
    const p = core.buildPlan(getDb(), { ...planArgs(), scopeJson: JSON.stringify({ cities: [], brands: [] }) })
    expect(p.counts.added).toBe(0)
    expect(p.counts.outOfScope).toBeGreaterThanOrEqual(4)
  })

  it('listCandidates 与 buildPlan 同源判定（候选数 = 可新增数）', () => {
    const c = core.listCandidates(getDb(), {
      kind: 'markers', sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA
    })
    expect(c.inScope.length).toBe(3)
    expect(c.outOfScope).toBe(2)
    expect(c.selfOrigin).toBe(1)
    expect(c.inScope.every(r => r.mirrorState === 'new')).toBe(true)
  })
})

describe('③ applyPlan（规则 2 / 4 / 9 / 15）', () => {
  it('写入镜像行：user_id=目标、origin_* 齐备、sync_readonly=1、sync_batch_id=批次', () => {
    const db = getDb()
    const plan = core.buildPlan(db, {
      kind: 'markers', direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA
    })
    const batchId = core.createBatch(db, {
      orgId: ids.org, direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA, kinds: ['markers'], plan,
      params: {}, createdBy: ids.hq, ip: '127.0.0.1'
    })

    const before = db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ids.subA).n
    const r = core.applyPlan(db, { plan, batchId, sourceLabel: '批次D集团' })
    expect(r.status).toBe('success')
    expect(r.inserted).toBe(3)
    expect(r.failed).toBe(0)

    const mirrors = db.prepare(`
      SELECT * FROM markers WHERE user_id = ? AND origin_user_id = ?
    `).all(ids.subA, ids.hq)
    expect(mirrors.length).toBe(3)
    for (const m of mirrors) {
      expect(m.sync_readonly).toBe(1)
      expect(String(m.origin_owner)).toBe('批次D集团')
      expect(Number(m.sync_batch_id)).toBe(batchId)
      expect(m.origin_row_id).toBeTruthy()
    }
    // 源账号未被改动（单写者：镜像只在目标侧）
    const after = db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ids.subA).n
    expect(after).toBe(before + 3)

    // 批次审计（规则 9）
    const b = core.findBatch(db, batchId)
    expect(b.status).toBe('success')
    expect(b.inserted).toBe(3)
    expect(b.source_user_id).toBe(ids.hq)
    expect(b.target_user_id).toBe(ids.subA)
    expect(b.ip).toBe('127.0.0.1')
    expect(b.finished_at).toBeTruthy()
  })

  it('幂等（规则 2）：重复预览 → 全部 no_change，不再新增', () => {
    const db = getDb()
    const p = core.buildPlan(db, {
      kind: 'markers', direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA
    })
    expect(p.counts.added).toBe(0)
    expect(p.counts.updated).toBe(0)
    expect(p.counts.noChange).toBe(3)
    expect(p.items.skipped.filter(s => s.reason === 'no_change').length).toBe(3)
  })

  it('源侧改动 → updated 带 changes 明细（只报真正变化的字段）', () => {
    const db = getDb()
    db.prepare(`UPDATE markers SET name = ?, seats = 99 WHERE id = ?`).run('集团成都店1(改名)', rowIds.h1)
    const p = core.buildPlan(db, {
      kind: 'markers', direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA
    })
    expect(p.counts.updated).toBe(1)
    const it = p.items.updated[0]
    expect(it.rowId).toBe(rowIds.h1)
    const fields = it.changes.map(c => c.field).sort()
    expect(fields).toEqual(['name', 'seats'])
  })

  it('删除传播（规则 6）：源行消失 → 目标镜像列为 deleted', () => {
    const db = getDb()
    db.prepare(`DELETE FROM markers WHERE id = ?`).run(rowIds.h3)
    const p = core.buildPlan(db, {
      kind: 'markers', direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA
    })
    expect(p.counts.deleted).toBe(1)
    expect(p.items.deleted[0].reason).toBe('source_removed')
    expect(p.items.deleted[0].kind).toBe('markers')
  })

  it('收窄 scope **不**连带删除镜像（保守：配置动作不应销毁目标侧已有数据）', () => {
    const db = getDb()
    // 把 m1 挪出成都 → 它现在越界，但源行仍在 ⇒ 不应出现在 deleted 里
    const bak = db.prepare(`SELECT city FROM markers WHERE id = ?`).get(rowIds.h2).city
    db.prepare(`UPDATE markers SET city = '绵阳市' WHERE id = ?`).run(rowIds.h2)
    const p = core.buildPlan(db, {
      kind: 'markers', direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA
    })
    expect(p.items.deleted.map(d => d.kind && d.reason)).not.toContain('out_of_scope')
    expect(p.counts.deleted).toBe(1)   // 只有 h3 那条真的被删的
    db.prepare(`UPDATE markers SET city = ? WHERE id = ?`).run(bak, rowIds.h2)
  })

  it('excluded：用户取消勾选的行不写入', () => {
    const db = getDb()
    // 先清掉已有镜像，回到「全新」状态
    db.prepare(`DELETE FROM markers WHERE user_id = ? AND origin_user_id = ?`).run(ids.subA, ids.hq)
    const p = core.buildPlan(db, {
      kind: 'markers', direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA
    })
    expect(p.counts.added).toBe(2)   // h1 / h2（h3 已删）
    const batchId = core.createBatch(db, {
      orgId: ids.org, direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA, kinds: ['markers'], plan: p, params: {}, createdBy: ids.hq
    })
    const dropKey = p.items.added.find(i => i.rowId === rowIds.h2).key
    const r = core.applyPlan(db, { plan: p, excluded: [dropKey], batchId, sourceLabel: '批次D集团' })
    expect(r.inserted).toBe(1)
    expect(r.skipped).toBe(1)
    const left = db.prepare(`SELECT origin_row_id FROM markers WHERE user_id = ? AND origin_user_id = ?`).all(ids.subA, ids.hq)
    expect(left.length).toBe(1)
    expect(left[0].origin_row_id).toBe(rowIds.h1)
  })

  it('单事务原子性（规则 15）：中途违反唯一索引 → 本批已写入的行全部回滚', () => {
    const db = getDb()
    // 手工拼一个会在第二步撞唯一索引的计划：r2 的镜像已预置
    const fields = core.syncableFields(db, 'markers')
    const fakePlan = {
      kind: 'markers',
      sourceUserId: ids.rbSrc,
      targetUserId: ids.rbTgt,
      fields,
      items: {
        added: [
          { key: `added:${rowIds.r1}`, kind: 'markers', rowId: rowIds.r1 },
          { key: `added:${rowIds.r2}`, kind: 'markers', rowId: rowIds.r2 }   // ← 必撞 ux_markers_origin
        ],
        updated: [], deleted: [], skipped: []
      },
      counts: { added: 2, updated: 0, deleted: 0, skipped: 0 }
    }
    const batchId = core.createBatch(db, {
      orgId: ids.org, direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.rbSrc, targetUserId: ids.rbTgt, kinds: ['markers'], plan: null,
      params: {}, createdBy: ids.hq
    })

    const n0 = db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ids.rbTgt).n
    let threw = false
    try {
      core.applyPlan(db, { plan: fakePlan, batchId, sourceLabel: 'X' })
    } catch (e) { threw = true }
    expect(threw).toBe(true)

    const n1 = db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ids.rbTgt).n
    expect(n1).toBe(n0)   // r1 的插入被回滚掉了 ⇒ 一条都没多
    // 审计状态被记为 failed
    expect(core.findBatch(db, batchId).status).toBe('failed')
  })
})

describe('④ 同步接口（含权限边界）', () => {
  it('GET /candidates：越界账号被拒（规则 10/24 不跨组织）', async () => {
    const r = await call('GET', '/api/sync/candidates', { token: tokens.outsider })
    expect(r.status).toBe(404)
  })

  it('GET /candidates：集团视角拉子公司，返回范围与静默丢弃计数', async () => {
    const r = await call('GET', `/api/sync/candidates?userId=${ids.subA}&direction=member_to_group`, { token: tokens.hq })
    expect(r.status).toBe(200)
    expect(r.body.inScope.length).toBe(2)      // 子公司 A 的成都 2 条
    expect(r.body.outOfScope).toBe(1)          // 绵阳 1 条
    expect(r.body.scope.cities).toEqual(['成都市'])
  })

  it('GET /candidates：子公司本人可看「可从集团同步什么」，但不能反向发起', async () => {
    const ok = await call('GET', '/api/sync/candidates', { token: tokens.subA })
    expect(ok.status).toBe(200)
    expect(ok.body.direction).toBe('group_to_member')
    expect(ok.body.emptyScope).toBe(false)

    const bad = await call('GET', `/api/sync/candidates?userId=${ids.subA}&direction=member_to_group`, { token: tokens.subA })
    expect(bad.status).toBe(403)
  })

  it('POST /preview：只建 preview 批次，**不写** markers（默认 dry-run 的结构性保证）', async () => {
    const db = getDb()
    const before = db.prepare(`SELECT COUNT(*) AS n FROM markers`).get().n
    const r = await call('POST', '/api/sync/preview', {
      token: tokens.subA,
      body: { userId: ids.subA, direction: 'group_to_member' }
    })
    expect(r.status).toBe(200)
    expect(r.body.batchId).toBeTruthy()
    expect(r.body.counts.added).toBeGreaterThan(0)
    expect(r.body.items.added.length).toBe(r.body.counts.added)

    const after = db.prepare(`SELECT COUNT(*) AS n FROM markers`).get().n
    expect(after).toBe(before)                                   // 预览零写入
    expect(core.findBatch(db, r.body.batchId).status).toBe('preview')
    rowIds.previewBatch = r.body.batchId
  })

  it('POST /commit：正式写入并置批次为 success；重复提交 409', async () => {
    const db = getDb()
    const r = await call('POST', '/api/sync/commit', {
      token: tokens.subA, body: { batchId: rowIds.previewBatch }
    })
    expect(r.status).toBe(200)
    expect(r.body.status).toBe('success')
    expect(r.body.applied.inserted).toBeGreaterThan(0)
    expect(core.findBatch(db, rowIds.previewBatch).status).toBe('success')

    const again = await call('POST', '/api/sync/commit', {
      token: tokens.subA, body: { batchId: rowIds.previewBatch }
    })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('batch_not_preview')
  })

  it('成员开关：关闭「接收集团下发」→ preview 409', async () => {
    await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subB}`, {
      token: tokens.hq, body: { canReceive: false }
    })
    const r = await call('POST', '/api/sync/preview', {
      token: tokens.hq, body: { userId: ids.subB, direction: 'group_to_member' }
    })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('member_can_receive_off')
    await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subB}`, {
      token: tokens.hq, body: { canReceive: true }
    })
  })

  it('成员开关：关闭「允许集团拉取」→ member_to_group 409', async () => {
    await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}`, {
      token: tokens.hq, body: { allowGroupPull: false }
    })
    const r = await call('POST', '/api/sync/preview', {
      token: tokens.hq, body: { userId: ids.subA, direction: 'member_to_group' }
    })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('member_pull_off')
    await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}`, {
      token: tokens.hq, body: { allowGroupPull: true }
    })
  })

  it('GET /batches：成员只看到与自己相关的批次；集团看到全部', async () => {
    const asSub = await call('GET', '/api/sync/batches', { token: tokens.subA })
    expect(asSub.status).toBe(200)
    expect(asSub.body.view).toBe('member')
    for (const b of asSub.body.batches) {
      expect([b.sourceUserId, b.targetUserId]).toContain(ids.subA)
    }

    const asHq = await call('GET', '/api/sync/batches?includePreview=1', { token: tokens.hq })
    expect(asHq.body.view).toBe('owner')
    expect(asHq.body.batches.length).toBeGreaterThanOrEqual(asSub.body.batches.length)
  })

  it('GET /batches/:id：明细可读；非本组织成员 403', async () => {
    const ok = await call('GET', `/api/sync/batches/${rowIds.previewBatch}`, { token: tokens.hq })
    expect(ok.status).toBe(200)
    expect(ok.body.batch.id).toBe(rowIds.previewBatch)

    const bad = await call('GET', `/api/sync/batches/${rowIds.previewBatch}`, { token: tokens.outsider })
    expect(bad.status).toBe(403)
  })

  it('POST /detach：镜像行 → 自有行（清 origin_* + sync_readonly=0）', async () => {
    const db = getDb()
    const m = db.prepare(`
      SELECT * FROM markers WHERE user_id = ? AND origin_user_id IS NOT NULL LIMIT 1
    `).get(ids.subA)
    expect(m).toBeTruthy()

    const r = await call('POST', '/api/sync/detach', { token: tokens.subA, body: { kind: 'markers', ids: [m.id] } })
    expect(r.status).toBe(200)
    expect(r.body.changed).toBe(1)

    const after = db.prepare(`SELECT * FROM markers WHERE id = ?`).get(m.id)
    expect(after.origin_user_id).toBeNull()
    expect(Number(after.sync_readonly)).toBe(0)
    // 源账号那行毫发无损
    const src = db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE id = ? AND user_id = ?`).get(m.origin_row_id, ids.hq).n
    expect(src).toBe(1)
  })

  it('POST /foreign/remove：只删自己名下的副本，源账号不受影响', async () => {
    const db = getDb()
    const m = db.prepare(`
      SELECT * FROM markers WHERE user_id = ? AND origin_user_id IS NOT NULL LIMIT 1
    `).get(ids.subA)
    expect(m).toBeTruthy()
    const srcCountBefore = db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ids.hq).n

    const r = await call('POST', '/api/sync/foreign/remove', { token: tokens.subA, body: { kind: 'markers', ids: [m.id] } })
    expect(r.status).toBe(200)
    expect(r.body.changed).toBe(1)
    expect(db.prepare('SELECT 1 FROM markers WHERE id = ?').get(m.id)).toBeUndefined()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ?`).get(ids.hq).n).toBe(srcCountBefore)
  })
})

describe('⑤ 只读锁与城市兜底（markers 路由）', () => {
  it('镜像行 PUT → 403 sync_readonly（含「脱离同步」提示）', async () => {
    const db = getDb()
    let m = db.prepare(`SELECT * FROM markers WHERE user_id = ? AND sync_readonly = 1 LIMIT 1`).get(ids.subA)
    if (!m) {
      // 上一组测试可能已清空 → 重新同步一批
      const pv = await call('POST', '/api/sync/preview', { token: tokens.subA, body: { userId: ids.subA, direction: 'group_to_member' } })
      await call('POST', '/api/sync/commit', { token: tokens.subA, body: { batchId: pv.body.batchId } })
      m = db.prepare(`SELECT * FROM markers WHERE user_id = ? AND sync_readonly = 1 LIMIT 1`).get(ids.subA)
    }
    expect(m).toBeTruthy()

    const r = await call('PUT', `/api/markers/${m.id}`, { token: tokens.subA, body: { name: '试图改名' } })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('sync_readonly')
    expect(String(r.body.message)).toContain('脱离同步')
  })

  it('镜像行 DELETE → 403', async () => {
    const db = getDb()
    const m = db.prepare(`SELECT * FROM markers WHERE user_id = ? AND sync_readonly = 1 LIMIT 1`).get(ids.subA)
    const r = await call('DELETE', `/api/markers/${m.id}`, { token: tokens.subA })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('sync_readonly')
  })

  it('批量删除跳过镜像行并提示', async () => {
    const db = getDb()
    const mine = db.prepare(`SELECT id FROM markers WHERE user_id = ? AND sync_readonly = 1 LIMIT 1`).get(ids.subA)
    const own = db.prepare(`SELECT id FROM markers WHERE user_id = ? AND (sync_readonly IS NULL OR sync_readonly != 1) LIMIT 1`).get(ids.subA)
    const r = await call('POST', '/api/markers/batch-delete', {
      token: tokens.subA, body: { ids: [mine.id, own.id] }
    })
    expect(r.status).toBe(200)
    expect(r.body.skippedSynced).toBe(1)
    expect(db.prepare(`SELECT 1 FROM markers WHERE id = ?`).get(mine.id)).toBeTruthy()
    expect(db.prepare(`SELECT 1 FROM markers WHERE id = ?`).get(own.id)).toBeUndefined()
  })

  it('清空门店保留镜像行', async () => {
    const db = getDb()
    const kept = db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ? AND sync_readonly = 1`).get(ids.subA).n
    expect(kept).toBeGreaterThan(0)
    const r = await call('DELETE', '/api/markers/clear-all', { token: tokens.subA })
    expect(r.status).toBe(200)
    expect(r.body.keptSynced).toBe(kept)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM markers WHERE user_id = ? AND sync_readonly = 1`).get(ids.subA).n).toBe(kept)
  })

  it('reverseCityByCoordinate：最近邻取城市；超出半径返回 null', () => {
    const db = getDb()
    const hit = core.reverseCityByCoordinate(db, CD.lat, CD.lng)
    expect(hit).toBeTruthy()
    expect(hit.city.replace(/市$/, '')).toBe('成都')

    const far = core.reverseCityByCoordinate(db, -33.86, 151.21)   // 悉尼，池内绝无邻点
    expect(far).toBeNull()
  })

  it('POST /markers 留空 city → 按坐标反查补全并标 city_source=geocoded', async () => {
    const db = getDb()
    const r = await call('POST', '/api/markers', {
      token: tokens.subB,
      body: { name: '兜底测试店', city: '', latitude: CD.lat + 0.005, longitude: CD.lng + 0.005 }
    })
    expect(r.status).toBe(201)
    expect(r.body.marker.city.replace(/市$/, '')).toBe('成都')
    expect(r.body.marker.city_source).toBe('geocoded')

    const r2 = await call('POST', '/api/markers', {
      token: tokens.subB,
      body: { name: '手动城市店', city: '成都市', latitude: CD.lat, longitude: CD.lng }
    })
    expect(r2.body.marker.city_source).toBe('manual')
    void db
  })

  it('GET /candidates：未设范围的成员 emptyScope=true 且带引导提示', async () => {
    const r = await call('GET', `/api/sync/candidates?userId=${ids.subB}&direction=member_to_group`, { token: tokens.hq })
    expect(r.status).toBe(200)
    expect(r.body.emptyScope).toBe(true)
    expect(String(r.body.hint)).toContain('管辖范围')
    expect(r.body.inScope.length).toBe(0)
  })

  it('GET /scope-options：★ 成员本人可读（曾因只放行 owner/admin 导致子公司页面 403 空下拉）', async () => {
    const okRes = await call('GET', `/api/sync/scope-options?orgId=${ids.org}&userId=${ids.subA}`, { token: tokens.subA })
    expect(okRes.status).toBe(200)
    expect(Array.isArray(okRes.body.cities)).toBe(true)
    expect(okRes.body.selected).toEqual(['成都市'])

    // 组织外账号仍被拒（规则 10）
    const bad = await call('GET', `/api/sync/scope-options?orgId=${ids.org}`, { token: tokens.outsider })
    expect(bad.status).toBe(403)
  })

  it('POST /preview：★ 返回 targetName，供前端画正确的「源 → 目标」路径', async () => {
    const r = await call('POST', '/api/sync/preview', {
      token: tokens.hq, body: { orgId: ids.org, userId: ids.subA, direction: 'member_to_group' }
    })
    expect(r.status).toBe(200)
    // member_to_group：源=子公司、目标=集团账号，两个名字必须不同
    expect(r.body.sourceUserId).toBe(ids.subA)
    expect(r.body.targetUserId).toBe(ids.hq)
    expect(r.body.targetName).toBeTruthy()
    expect(r.body.targetName).not.toBe(r.body.sourceName)
    expect(r.body.direction).toBe('member_to_group')
  })
})

// ===========================================================================
// 批次 E：competitors 多对象 + 配额一级分配
// ===========================================================================

describe('⑦ competitors + 多类型单批次（批次 E）', () => {
  const cpIds = {}
  beforeAll(() => {
    const db = getDb()
    // 清掉 subA 名下可能存在的竞品镜像，保证断言可确定
    db.prepare(`DELETE FROM competitors WHERE user_id = ? AND origin_user_id IS NOT NULL`).run(ids.subA)
    const cp = (name, city, period = '2026Q3') => db.prepare(
      `INSERT INTO competitors (name, city, brand, latitude, longitude, user_id, period, snapshot_id)
       VALUES (?, ?, '老乡鸡', ?, ?, ?, ?, 99)`
    ).run(name, city, CD.lat, CD.lng, ids.hq, period).lastInsertRowid
    cpIds.c1 = cp('集团竞品成都1', '成都市')
    cpIds.c2 = cp('集团竞品成都2', '成都')
    cpIds.c3 = cp('集团竞品上海1', '上海市')
  })

  it('syncableFields(competitors)：排除 period/snapshot_id（规则 8 期次隔离）', () => {
    const f = core.syncableFields(getDb(), 'competitors')
    expect(f).toContain('name')
    expect(f).toContain('city')
    expect(f).not.toContain('period')
    expect(f).not.toContain('snapshot_id')
    expect(f).not.toContain('origin_user_id')
  })

  it('buildPlan(kind=competitors)：范围圈定 + 越界丢弃与 markers 同源', () => {
    const p = core.buildPlan(getDb(), {
      kind: 'competitors', direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA, keyword: ''
    })
    expect(p.counts.added).toBe(2)
    expect(p.counts.outOfScope).toBe(1)   // 上海竞品越界
    expect(p.items.added.map(i => i.name)).not.toContain('集团竞品上海1')
  })

  it('buildPlanForKinds / listCandidatesForKinds：合并多对象 + item 自带 kind + byKind 拆账', () => {
    const db = getDb()
    const p = core.buildPlanForKinds(db, {
      kinds: ['markers', 'competitors'], direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA, keyword: ''
    })
    expect(p.kinds).toEqual(['markers', 'competitors'])
    expect(p.fieldsByKind.competitors).toBeTruthy()
    expect(p.fieldsByKind.markers).toBeTruthy()
    // competitors 成都 2 条独立可确定（markers 依赖前序状态，不断言精确值）
    expect(p.counts.byKind.competitors.added).toBe(2)
    expect(p.items.added.some(i => i.kind === 'competitors' && i.name === '集团竞品成都1')).toBe(true)

    const c = core.listCandidatesForKinds(db, {
      kinds: ['markers', 'competitors'], sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA
    })
    expect(c.kinds).toEqual(['markers', 'competitors'])
    expect(c.byKind.competitors.inScope).toBe(2)
    expect(c.inScope.some(r => r.kind === 'competitors')).toBe(true)
  })

  it('applyPlan：多对象批次按 item.kind 写各自表，镜像带 origin_* 且期次不复制', () => {
    const db = getDb()
    const plan = core.buildPlanForKinds(db, {
      kinds: ['competitors'], direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA, keyword: '',
      targetLabel: '批次E集团'
    })
    expect(plan.counts.added).toBe(2)
    const batchId = core.createBatch(db, {
      orgId: ids.org, direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA, kinds: ['competitors'],
      plan, params: {}, createdBy: ids.hq, ip: '127.0.0.1'
    })
    const r = core.applyPlan(db, { plan, excluded: [], batchId, sourceLabel: '批次E集团' })
    expect(r.status).toBe('success')
    expect(r.inserted).toBe(2)

    const mirrors = db.prepare(`
      SELECT * FROM competitors WHERE user_id = ? AND origin_user_id = ?
    `).all(ids.subA, ids.hq)
    expect(mirrors.length).toBe(2)
    for (const m of mirrors) {
      expect(m.sync_readonly).toBe(1)
      expect(m.origin_owner).toBe('批次E集团')
      expect(m.period).toBeNull()       // 期次不复制（规则 8）
      expect(m.snapshot_id).toBeNull()
    }
  })

  it('幂等：competitors 重复预览 → no_change（规则 2 对竞品同样生效）', () => {
    const p = core.buildPlan(getDb(), {
      kind: 'competitors', direction: core.DIRECTIONS.GROUP_TO_MEMBER,
      sourceUserId: ids.hq, targetUserId: ids.subA,
      scopeJson: JSON.stringify({ cities: ['成都市'], brands: [] }), belongUserId: ids.subA
    })
    expect(p.counts.added).toBe(0)
    expect(p.counts.noChange).toBe(2)
  })
})

describe('⑧ mirrors kind=all + 配额一级分配（批次 E）', () => {
  it('GET /mirrors?kind=all：合并 markers + competitors，每行带 kind', async () => {
    const r = await call('GET', '/api/sync/mirrors?kind=all&limit=500', { token: tokens.subA })
    expect(r.status).toBe(200)
    expect(r.body.kinds).toEqual(['markers', 'competitors'])
    const kinds = new Set(r.body.mirrors.map(m => m.kind))
    expect(kinds.has('markers')).toBe(true)
    expect(kinds.has('competitors')).toBe(true)
    expect(r.body.mirrors.every(m => m.kind)).toBe(true)
  })

  it('GET /quota/summary：返回池概览 + 成员明细（含 grantedTotal）', async () => {
    const db = getDb()
    db.prepare(`UPDATE admin_quota SET initial_quota = 1000, remaining_quota = 800 WHERE id = 1`).run()
    const r = await call('GET', `/api/orgs/${ids.org}/quota/summary`, { token: tokens.hq })
    expect(r.status).toBe(200)
    expect(r.body.poolTotal).toBe(1000)
    expect(r.body.remaining).toBe(800)
    expect(r.body.allocatable).toBeGreaterThan(0)
    expect(Array.isArray(r.body.members)).toBe(true)
    const m = r.body.members.find(x => x.userId === ids.subA)
    expect(m).toBeTruthy()
    expect(m.grantedTotal).toBe(0)
  })

  it('POST /quota/allocate：一级分配成功，双写台账 + users.quota 增 + 不动物理池', async () => {
    const db = getDb()
    const before = db.prepare(`SELECT quota FROM users WHERE id = ?`).get(ids.subA).quota
    const remainBefore = db.prepare(`SELECT remaining_quota FROM admin_quota WHERE id = 1`).get().remaining_quota
    const grantsBefore = db.prepare(`SELECT COUNT(*) AS n FROM quota_grants`).get().n
    const histBefore = db.prepare(`SELECT COUNT(*) AS n FROM quota_history WHERE action = 'org_grant'`).get().n

    const r = await call('POST', `/api/orgs/${ids.org}/quota/allocate`, {
      token: tokens.hq, body: { toUserId: ids.subA, amount: 50, note: '测试分配' }
    })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.amount).toBe(50)
    expect(r.body.quotaBefore).toBe(before)
    expect(r.body.quotaAfter).toBe(before + 50)

    // users.quota 增（规则 21：成员额度只由分配而来）
    const after = db.prepare(`SELECT quota FROM users WHERE id = ?`).get(ids.subA).quota
    expect(after).toBe(before + 50)

    // 双写台账：quota_grants（pool_grant，from=owner）+ quota_history（action=org_grant）
    const g = db.prepare(`SELECT * FROM quota_grants WHERE to_user_id = ? ORDER BY id DESC LIMIT 1`).get(ids.subA)
    expect(g.grant_kind).toBe('pool_grant')
    expect(g.from_user_id).toBe(ids.hq)
    expect(g.amount).toBe(50)
    expect(g.quota_before).toBe(before)
    expect(g.quota_after).toBe(before + 50)

    const h = db.prepare(`SELECT * FROM quota_history WHERE user_id = ? AND action = 'org_grant' ORDER BY id DESC LIMIT 1`).get(ids.subA)
    expect(h.change_amount).toBe(50)
    expect(h.source_user_id).toBe(ids.hq)

    // 物理池不变（规则 19：分配是「额度转移」不是「配额增加」）
    const remainAfter = db.prepare(`SELECT remaining_quota FROM admin_quota WHERE id = 1`).get().remaining_quota
    expect(remainAfter).toBe(remainBefore)

    // 台账只增不删
    expect(db.prepare(`SELECT COUNT(*) AS n FROM quota_grants`).get().n).toBe(grantsBefore + 1)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM quota_history WHERE action = 'org_grant'`).get().n).toBe(histBefore + 1)
  })

  it('POST /quota/allocate：amount 非正整数 → 400', async () => {
    for (const amount of [0, -5, 2.5, 'abc']) {
      const r = await call('POST', `/api/orgs/${ids.org}/quota/allocate`, {
        token: tokens.hq, body: { toUserId: ids.subA, amount }
      })
      expect(r.status).toBe(400)
    }
  })

  it('POST /quota/allocate：受赠方不是本集团成员 → 404', async () => {
    const r = await call('POST', `/api/orgs/${ids.org}/quota/allocate`, {
      token: tokens.hq, body: { toUserId: ids.outsider, amount: 10 }
    })
    expect(r.status).toBe(404)
  })

  it('POST /quota/allocate：超出可分配 → 400 allocatable_insufficient', async () => {
    const r = await call('POST', `/api/orgs/${ids.org}/quota/allocate`, {
      token: tokens.hq, body: { toUserId: ids.subA, amount: 999999 }
    })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('allocatable_insufficient')
  })

  it('POST /quota/allocate：非 owner（成员本人）→ 403（规则 24）', async () => {
    const r = await call('POST', `/api/orgs/${ids.org}/quota/allocate`, {
      token: tokens.subA, body: { toUserId: ids.subA, amount: 10 }
    })
    expect(r.status).toBe(403)
  })
})
