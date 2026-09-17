/**
 * 竞品期次快照下发（v0.13 P2/R3 · 规则 35 / 36）测试
 *
 * 被测：src/utils/syncCore.js 的 §5b 特例分支
 *      （buildSnapshotPlan / listSnapshotCandidates / writeSnapshotMirror / deleteSnapshotMirror）
 *      ＋ src/routes/competitorSnapshots.js 的只读拦截
 *
 * 为什么快照要单独一套逻辑（三条断言各自锁一条）：
 *   ① **明细表没有 user_id**（靠 snapshot_id 归属）⇒ 泛化的 `WHERE user_id=?` 对它无意义；
 *      搬头表必须连带明细，删头表也必须连带明细（否则留下永久孤儿 —— 规则 36）。
 *   ② **交付单位是期次不是行**：源侧一期是「全国」，目标侧只该拿自己辖区那份
 *      ⇒ 头表 total_count 必须**按实际落库行数重算**，源侧全国口径另存 origin_*。
 *      不重算的话，子公司监测面板会出现「写着 4 家、列表只有 3 家」。
 *   ③ 判重键是**品牌 + 期次**（头表 UNIQUE(user_id,brand,period)），
 *      不是门店级业务键 —— 硬插会撞唯一索引让整个同步事务回滚。
 *
 * ⚠️ 与本文件同等重要的「不该发生的事」：
 *   · 方向：快照**只下不上**（规则 35）—— 往上拉会污染集团账号
 *   · 规则 8：快照同步**不许碰** competitors 镜像行（两者各走各的）
 *   · R5：集团下发的期次，子公司既不能删、也不能自行上传覆盖
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
// FormData / Blob 用 Node 18+ 的全局实现（node:buffer 并不导出 FormData）

const tmpDb = path.join(os.tmpdir(), `r4b-snap-${process.pid}-${Date.now()}.db`)
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

/** 直连库：造源侧快照（头表 + 明细） */
function mkSnap(db, uid, { brand, period, seq, rows }) {
  const open = rows.filter(r => r.status === 'open').length
  const sid = db.prepare(`
    INSERT INTO competitor_snapshots
      (user_id, brand, period, period_seq, source_file, data_version, total_count, open_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uid, brand, period, seq, `${brand}_${period}.csv`, null, rows.length, open).lastInsertRowid

  const ins = db.prepare(`
    INSERT INTO competitor_snapshot_rows
      (snapshot_id, store_key, name, city, district, address, latitude, longitude, status, description, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const r of rows) {
    ins.run(sid, r.key, r.name, r.city, r.district ?? null, r.address ?? null,
      r.lat ?? 31.23, r.lng ?? 121.47, r.status, r.desc ?? null, null)
  }
  return sid
}

/** 直连库：读镜像（头表 + 明细） */
function mirrorOf(db, targetUserId, sourceUserId, sourceSnapId) {
  const h = db.prepare(`
    SELECT * FROM competitor_snapshots
     WHERE user_id = ? AND origin_user_id = ? AND origin_row_id = ?
  `).get(targetUserId, sourceUserId, sourceSnapId)
  if (!h) return null
  const rows = db.prepare(`
    SELECT store_key, name, city, status FROM competitor_snapshot_rows
     WHERE snapshot_id = ? ORDER BY store_key
  `).all(h.id)
  return { header: h, rows }
}

function orphanCount(db) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM competitor_snapshot_rows
     WHERE snapshot_id NOT IN (SELECT id FROM competitor_snapshots)
  `).get().n
}

/** 走 API 预览（子公司在 member 视角点「从集团同步」） */
function previewSnapshot(token, { userId, direction = 'group_to_member', filter = {}, kinds = ['competitor_snapshots'] }) {
  return call('POST', '/api/sync/preview', { token, body: { userId, direction, kinds, filter } })
}

async function previewAndCommit(token, { userId, filter = {} }) {
  const pv = await previewSnapshot(token, { userId, filter })
  expect(pv.status).toBe(200)
  const cm = await call('POST', '/api/sync/commit', { token, body: { batchId: pv.body.batchId, excluded: [] } })
  return { pv, cm }
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
  const snapRouter = (await import('../src/routes/competitorSnapshots.js')).default

  const db = getDb()
  const seed = (username, role) => db.prepare(
    `INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, 0)`
  ).run(username, `${username}@test.local`, 'x', role).lastInsertRowid

  ids.admin = seed('sn_admin', 'admin')
  ids.hq = seed('sn_hq', 'user')       // 集团总部（泉膳中国的替身）
  ids.sub = seed('sn_sub_sh', 'user')  // 上海子公司
  ids.sub2 = seed('sn_sub_bj', 'user') // 北京子公司
  tokens.admin = makeToken({ id: ids.admin, username: 'sn_admin', role: 'admin' })
  tokens.hq = makeToken({ id: ids.hq, username: 'sn_hq', role: 'user' })
  tokens.sub = makeToken({ id: ids.sub, username: 'sn_sub_sh', role: 'user' })
  tokens.sub2 = makeToken({ id: ids.sub2, username: 'sn_sub_bj', role: 'user' })

  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use('/api/orgs', orgsRouter)
  app.use('/api/sync', syncRouter)
  app.use('/api/competitors/snapshots', snapRouter)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`

  const r1 = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '快照集团', ownerUserId: ids.hq } })
  ids.org = r1.body.org.id
  for (const u of ['sn_sub_sh', 'sn_sub_bj']) {
    await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.hq, body: { username: u } })
  }
  await call('PATCH', `/api/orgs/${ids.org}/members/${ids.sub}/scope`, {
    token: tokens.hq, body: { cities: ['上海市'], brands: [] }
  })
  await call('PATCH', `/api/orgs/${ids.org}/members/${ids.sub2}/scope`, {
    token: tokens.hq, body: { cities: ['北京市'], brands: [] }
  })

  // ---- 集团账号名下的期次档案（模拟「集团按季导入」）----
  // 老乡鸡 2026-05：全国 3 家（上海 2 / 北京 1）
  R.s1 = mkSnap(db, ids.hq, {
    brand: '老乡鸡', period: '2026-05', seq: 202605,
    rows: [
      { key: 'SN-A', name: '老乡鸡上海A', city: '上海市', status: 'open' },
      { key: 'SN-B', name: '老乡鸡上海B', city: '上海市', status: 'open' },
      { key: 'SN-C', name: '老乡鸡北京C', city: '北京市', status: 'open' }
    ]
  })
  // 老乡鸡 2026-08：全国 4 家（上海 3 / 北京 1）
  R.s2 = mkSnap(db, ids.hq, {
    brand: '老乡鸡', period: '2026-08', seq: 202608,
    rows: [
      { key: 'SN-A', name: '老乡鸡上海A', city: '上海市', status: 'open' },
      { key: 'SN-B', name: '老乡鸡上海B', city: '上海市', status: 'closed' },   // 本期闭店
      { key: 'SN-D', name: '老乡鸡上海D', city: '上海市', status: 'open' },
      { key: 'SN-E', name: '老乡鸡北京E', city: '北京市', status: 'open' }
    ]
  })
  // 米村拌饭 2026-08：全国 1 家，只在**北京** ⇒ 对上海子公司应是「本辖区 0 行、整期不下发」
  R.s3 = mkSnap(db, ids.hq, {
    brand: '米村拌饭', period: '2026-08', seq: 202608,
    rows: [{ key: 'SN-F', name: '米村北京F', city: '北京市', status: 'open' }]
  })
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ===========================================================================

describe('① 计划：明细按成员管辖城市过滤，头表期次为交付单位', () => {
  it('上海子公司：2 期入选，明细只含上海行，北京那一期整期不下发', () => {
    const db = getDb()
    const p = core.buildSnapshotPlan(db, {
      direction: 'group_to_member',
      sourceUserId: ids.hq,
      targetUserId: ids.sub,
      scopeJson: JSON.stringify({ cities: ['上海市'], brands: [] })
    })

    expect(p.counts.added).toBe(2)          // 老乡鸡 05 / 08
    expect(p.counts.outOfScope).toBe(1)     // 米村拌饭（本辖区 0 行）
    expect(p.counts.detailRows).toBe(5)     // 2 + 3

    const may = p.items.added.find(x => x.period === '2026-05')
    const aug = p.items.added.find(x => x.period === '2026-08')
    expect(may.detailRows).toBe(2)
    expect(aug.detailRows).toBe(3)
    // 源侧全国口径必须一起带出来（UI 显示「本辖区 3 / 全国 4」）
    expect(aug.originTotalCount).toBe(4)
    expect(aug.originOpenCount).toBe(3)
    expect(aug.name).toBe('老乡鸡 2026-08')
  })

  it('北京子公司：3 期入选（含只在北京有店的米村拌饭）', () => {
    const db = getDb()
    const p = core.buildSnapshotPlan(db, {
      direction: 'group_to_member',
      sourceUserId: ids.hq,
      targetUserId: ids.sub2,
      scopeJson: JSON.stringify({ cities: ['北京市'], brands: [] })
    })
    expect(p.counts.added).toBe(3)
    expect(p.counts.detailRows).toBe(3)
  })

  it('期次收窄：filter.periods 只下发勾选的期次，且不会因此判删除', () => {
    const db = getDb()
    const p = core.buildSnapshotPlan(db, {
      direction: 'group_to_member',
      sourceUserId: ids.hq,
      targetUserId: ids.sub,
      scopeJson: JSON.stringify({ cities: ['上海市'], brands: [] }),
      periods: ['2026-08']
    })
    expect(p.counts.added).toBe(1)
    expect(p.counts.periodFiltered).toBe(1)
    expect(p.counts.deleted).toBe(0)        // ★ 被期次筛掉的期次**不是**删除条件
  })

  it('空 scope ⇒ 一行不发，但计数可见（绝不静默成功）', () => {
    const db = getDb()
    const p = core.buildSnapshotPlan(db, {
      direction: 'group_to_member',
      sourceUserId: ids.hq,
      targetUserId: ids.sub,
      scopeJson: JSON.stringify({ cities: [], brands: [] })
    })
    expect(p.counts.added).toBe(0)
    expect(p.counts.outOfScope).toBe(3)     // 三期全部计入越界，而不是「成功 0 条」
  })
})

describe('② 提交：镜像计数按本辖区实际落库行数重算', () => {
  it('上海子公司同步 2 期：头表计数=本辖区，明细只落上海行', async () => {
    const db = getDb()
    const { pv, cm } = await previewAndCommit(tokens.sub, { userId: ids.sub })

    expect(pv.status).toBe(200)
    expect(pv.body.counts.added).toBe(2)
    expect(cm.status).toBe(200)
    expect(cm.body.applied.inserted).toBe(2)
    expect(cm.body.applied.snapshotRows).toBe(5)   // 明细行数要与「N 期」分开报

    const m1 = mirrorOf(db, ids.sub, ids.hq, R.s1)
    const m2 = mirrorOf(db, ids.sub, ids.hq, R.s2)
    expect(m1).toBeTruthy()
    expect(m2).toBeTruthy()

    // 头表计数 = 本辖区；全国口径另存
    expect(m2.header.total_count).toBe(3)
    expect(m2.header.open_count).toBe(2)            // SN-B 是 closed
    expect(m2.header.origin_total_count).toBe(4)
    expect(m2.header.origin_open_count).toBe(3)
    expect(Number(m2.header.sync_readonly)).toBe(1)
    expect(m2.header.origin_user_id).toBe(ids.hq)

    // 明细：只有上海的行，北京的行一行都没进来
    expect(m2.rows.map(r => r.store_key)).toEqual(['SN-A', 'SN-B', 'SN-D'])
    expect(m2.rows.every(r => r.city === '上海市')).toBe(true)
    expect(m1.rows.map(r => r.store_key)).toEqual(['SN-A', 'SN-B'])

    // 米村拌饭（本辖区无行）不该生成空档案
    expect(db.prepare(`
      SELECT COUNT(*) AS n FROM competitor_snapshots WHERE user_id = ? AND brand = '米村拌饭'
    `).get(ids.sub).n).toBe(0)

    expect(orphanCount(db)).toBe(0)
  })
})

describe('③ 幂等：源侧没动 ⇒ 全判 no_change，零写入', () => {
  it('再同步一次：added=0 / skipped=2 / detailRows=0', async () => {
    const db = getDb()
    const m2Before = mirrorOf(db, ids.sub, ids.hq, R.s2)
    const beforeHeader = m2Before.header
    const beforeRowIds = db.prepare(`
      SELECT id FROM competitor_snapshot_rows WHERE snapshot_id = ? ORDER BY id
    `).all(beforeHeader.id).map(r => r.id)

    const pv = await previewSnapshot(tokens.sub, { userId: ids.sub })
    expect(pv.status).toBe(200)
    expect(pv.body.counts.added).toBe(0)
    expect(pv.body.counts.skipped).toBe(2)
    expect(pv.body.counts.detailRows).toBe(0)      // ★ 没变就不重灌上千行
    expect(pv.body.items.skipped.every(x => x.reason === 'no_change')).toBe(true)

    const cm = await call('POST', '/api/sync/commit', { token: tokens.sub, body: { batchId: pv.body.batchId, excluded: [] } })
    expect(cm.body.applied.inserted).toBe(0)
    expect(cm.body.applied.updated).toBe(0)
    expect(cm.body.applied.snapshotRows).toBe(0)

    // ★ 「值未变就不写」的铁证：头表 updated_at 未动、明细行 id 完全没变
    //   （若走「删了再插一遍」，行 id 必然漂移）
    const m2 = mirrorOf(db, ids.sub, ids.hq, R.s2)
    expect(m2.header.updated_at).toBe(beforeHeader.updated_at)
    expect(db.prepare(`
      SELECT id FROM competitor_snapshot_rows WHERE snapshot_id = ? ORDER BY id
    `).all(m2.header.id).map(r => r.id)).toEqual(beforeRowIds)
    expect(m2.rows.length).toBe(3)
  })
})

describe('④ 源侧改一期 ⇒ 更新并替换明细 + 重算计数', () => {
  it('集团给 2026-08 加一家上海店 ⇒ updated=1，镜像明细变 4 行', async () => {
    const db = getDb()
    db.prepare(`
      INSERT INTO competitor_snapshot_rows
        (snapshot_id, store_key, name, city, latitude, longitude, status)
      VALUES (?, 'SN-G', '老乡鸡上海G', '上海市', 31.24, 121.48, 'open')
    `).run(R.s2)
    db.prepare(`UPDATE competitor_snapshots SET total_count = 5, open_count = 4 WHERE id = ?`).run(R.s2)

    const pv = await previewSnapshot(tokens.sub, { userId: ids.sub })
    expect(pv.body.counts.added).toBe(0)
    expect(pv.body.counts.updated).toBe(1)
    const up = pv.body.items.updated[0]
    expect(up.period).toBe('2026-08')
    expect(up.detailRows).toBe(4)
    expect(up.detailChanged).toBe(true)

    const cm = await call('POST', '/api/sync/commit', { token: tokens.sub, body: { batchId: pv.body.batchId, excluded: [] } })
    expect(cm.body.applied.updated).toBe(1)

    const m2 = mirrorOf(db, ids.sub, ids.hq, R.s2)
    expect(m2.rows.map(r => r.store_key)).toEqual(['SN-A', 'SN-B', 'SN-D', 'SN-G'])
    expect(m2.header.total_count).toBe(4)
    expect(m2.header.origin_total_count).toBe(5)
    expect(orphanCount(db)).toBe(0)
  })
})

describe('⑤ 删除传播：源期次没了 ⇒ 镜像头+明细一起走（规则 36）', () => {
  it('集团撤掉 2026-05 ⇒ 镜像头表与明细**都不留残骸**', async () => {
    const db = getDb()
    const before = mirrorOf(db, ids.sub, ids.hq, R.s1)
    expect(before.rows.length).toBe(2)

    db.prepare(`DELETE FROM competitor_snapshot_rows WHERE snapshot_id = ?`).run(R.s1)
    db.prepare(`DELETE FROM competitor_snapshots WHERE id = ?`).run(R.s1)

    const pv = await previewSnapshot(tokens.sub, { userId: ids.sub })
    expect(pv.body.counts.deleted).toBe(1)

    const cm = await call('POST', '/api/sync/commit', { token: tokens.sub, body: { batchId: pv.body.batchId, excluded: [] } })
    expect(cm.body.applied.deleted).toBe(1)

    expect(mirrorOf(db, ids.sub, ids.hq, R.s1)).toBe(null)
    // ★ 关键断言：明细必须一起删。靠 ON DELETE CASCADE 会失效
    //   （sqlite/sql.js 默认 foreign_keys=OFF），所以内核显式逐表删。
    expect(db.prepare(`SELECT COUNT(*) AS n FROM competitor_snapshot_rows WHERE snapshot_id = ?`).get(before.header.id).n).toBe(0)
    expect(orphanCount(db)).toBe(0)
  })
})

describe('⑥ 规则 8：快照同步不碰 competitors 镜像行', () => {
  it('竞品门店镜像行数在快照同步前后不变', async () => {
    const db = getDb()
    // 集团侧一家竞品门店 → 通过 competitors 对象单独下发（与快照是两条独立链路）
    db.prepare(`
      INSERT INTO competitors (name, brand, city, latitude, longitude, user_id)
      VALUES ('老乡鸡上海A', '老乡鸡', '上海市', 31.23, 121.47, ?)
    `).run(ids.hq)

    await call('POST', '/api/sync/commit', {
      token: tokens.sub,
      body: {
        batchId: (await previewSnapshot(tokens.sub, {
          userId: ids.sub, kinds: ['competitors']
        })).body.batchId,
        excluded: []
      }
    })
    const after1 = db.prepare(`SELECT COUNT(*) AS n FROM competitors WHERE user_id = ?`).get(ids.sub).n
    expect(after1).toBe(1)

    // ★ 再跑一次**确实会写入**的快照同步（新期次 2026-11）——空跑的同步证明不了什么，
    //   必须让快照链路真的产生 insert，再看 competitors 有没有被牵连
    mkSnap(db, ids.hq, {
      brand: '老乡鸡', period: '2026-11', seq: 202611,
      rows: [
        { key: 'SN-A', name: '老乡鸡上海A', city: '上海市', status: 'open' },
        { key: 'SN-Z', name: '老乡鸡上海Z', city: '上海市', status: 'open' }
      ]
    })
    const { cm } = await previewAndCommit(tokens.sub, { userId: ids.sub })
    expect(cm.body.applied.inserted).toBe(1)              // 快照链路确实写了
    expect(cm.body.applied.snapshotRows).toBe(2)

    const after2 = db.prepare(`SELECT COUNT(*) AS n FROM competitors WHERE user_id = ?`).get(ids.sub).n
    expect(after2).toBe(1)
    // 也确认快照镜像行没有被 competitors 那边牵连
    expect(db.prepare(`SELECT COUNT(*) AS n FROM competitor_snapshots WHERE user_id = ?`).get(ids.sub).n).toBe(2)
  })
})

describe('⑦ 规则 35：快照只下不上（显式 400，不静默空转）', () => {
  it('member_to_group + 快照对象 ⇒ 400 kind_direction_not_allowed', async () => {
    const r = await call('POST', '/api/sync/preview', {
      token: tokens.hq,
      body: { userId: ids.sub, direction: 'member_to_group', kinds: ['competitor_snapshots'], filter: {} }
    })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('kind_direction_not_allowed')
  })

  it('内核自保：直接调用 buildSnapshotPlan 也不产出任何项', () => {
    const db = getDb()
    const p = core.buildSnapshotPlan(db, {
      direction: 'member_to_group', sourceUserId: ids.sub, targetUserId: ids.hq
    })
    expect(p.counts.directionBlocked).toBe(1)
    expect(p.items.added.length).toBe(0)
    expect(p.counts.total).toBe(0)
  })
})

describe('⑧ R5：集团下发的期次，子公司既不能删也不能覆盖', () => {
  it('DELETE 集团下发的快照 ⇒ 403 snapshot_readonly', async () => {
    const db = getDb()
    const m = mirrorOf(db, ids.sub, ids.hq, R.s2)
    const r = await call('DELETE', `/api/competitors/snapshots/${m.header.id}`, { token: tokens.sub })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('snapshot_readonly')
    // 确实没被删
    expect(mirrorOf(db, ids.sub, ids.hq, R.s2)).toBeTruthy()
  })

  it('子公司自己上传同品牌期次 ⇒ 403（否则会撞 UNIQUE(user_id,brand,period)）', async () => {
    const fd = new FormData()
    fd.append('brand', '老乡鸡')
    fd.append('period', '2026-08')
    fd.append('file', new Blob([
      'store_id,name,city,status\nSN-A,老乡鸡上海A,上海市,open\n'
    ], { type: 'text/csv' }), 'x.csv')

    const res = await fetch(base + '/api/competitors/snapshots/preview', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.sub}` },
      body: fd
    })
    expect(res.status).toBe(403)
    const j = await res.json()
    expect(['period_group_managed', 'brand_group_managed']).toContain(j.code)
  })

  it('子公司删自己上传的（非镜像）快照仍允许', async () => {
    const db = getDb()
    const own = mkSnap(db, ids.sub, {
      brand: '自建品牌', period: '2026-07', seq: 202607,
      rows: [{ key: 'OWN-1', name: '自建店1', city: '上海市', status: 'open' }]
    })
    const r = await call('DELETE', `/api/competitors/snapshots/${own}`, { token: tokens.sub })
    expect(r.status).toBe(200)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM competitor_snapshots WHERE id = ?`).get(own).n).toBe(0)
  })
})
