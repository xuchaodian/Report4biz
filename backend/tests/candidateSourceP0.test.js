/**
 * 候选点位 P0：**数据源换成「我的门店」的候选门店**（批次 376，业主 2026-11-18 要求）
 *
 * ── 业主的原始诉求 ────────────────────────────────────────────────────
 * 「候选点位读取『我的门店』中登录的『一般候选』与『重要候选』门店」
 *   ⇒ 候选点位页不再是「333 那套独立台账」，而是**门店台账里候选店的一个视图**：
 *      在「我的门店」把某家店标成重点候选/一般候选，它就该出现在候选点位页；
 *      改回「已开业」，它就该消失。
 *
 * ── 本文件证明六件事 ───────────────────────────────────────────────────
 * ① 数据源是 markers（`store_type ∈ 重点候选/一般候选`），已开业/别人的店一律不出现
 * ② 推进阶段（stage）由 store_candidates **叠加**，且能认出「同一个点位的两种写法」
 *    —— 现网真实形态：markers『浦江绿地乐和城店』(31.077159,121.496987)
 *       vs store_candidates『浦江绿地乐和城』(31.076240,121.497610)，相距 118m、差一个「店」字。
 *    按 10m 或按原文相等都关联不上，但那显然是同一家 ⇒ 判据必须是「名称归一 + 500m」。
 * ③ 一条推进记录**只能被一个门店占用**（两个同名店共用流水 = 改 A 的阶段 B 也变）
 * ④ 历史独立点位**不丢**（333~375 手工建的、地图右键存的，仍以 origin='candidate' 显示）
 * ⑤ `GET /` **纯读**（不建行不改行）—— 惰性建行只在 `POST /ensure`
 * ⑥ 关联到门店的行**不可删**（删视图 ≠ 删源数据；删了刷新就"复活"，用户会以为删不掉）
 *
 * ── 关键手法 ───────────────────────────────────────────────────────────
 * ⛔ 不 mock db、不 mock candidateLink：要证明的就是真实 SQL + 真实判据跑出来的结果。
 * ✅ 用真 express + 临时库 + node:http（与 siteSelectCoarse.test.js 同套路）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-candsrc-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let server, token, userId, otherUserId
let getDb

function call(method, p, body, tk = token) {
  return new Promise((resolve) => {
    const data = body !== undefined ? JSON.stringify(body) : null
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.address().port,
        path: p,
        method,
        headers: {
          ...(tk ? { Authorization: `Bearer ${tk}` } : {}),
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
        }
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => { raw += c })
        res.on('end', () => {
          let json = null
          try { json = JSON.parse(raw) } catch { json = null }
          resolve({ status: res.statusCode, body: json, raw })
        })
      }
    )
    req.on('error', () => resolve({ status: 0, body: null, raw: '' }))
    if (data) req.write(data)
    req.end()
  })
}

/** 造一条门店（默认重点候选、上海、坐标固定） */
function insertMarker(over = {}) {
  const m = {
    name: '测试候选门店', store_code: null, store_type: '重点候选',
    city: '上海', district: '闵行区', address: '测试路 1 号',
    lat: 31.2000, lng: 121.5000, area: null, rent: null, brand: '',
    uid: userId, merged_into: null,
    ...over
  }
  const info = getDb().prepare(
    `INSERT INTO markers (user_id, store_code, name, brand, store_type, city, district, address,
                          latitude, longitude, area, rent, store_status, merged_into)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`
  ).run(m.uid, m.store_code, m.name, m.brand, m.store_type, m.city, m.district, m.address,
    m.lat, m.lng, m.area, m.rent, m.merged_into)
  return Number(info.lastInsertRowid)
}

/** 造一条推进记录 */
function insertCand(over = {}) {
  const c = {
    name: '测试候选点位', store_code: null, stage: '待评估',
    city: '上海', district: '闵行区', address: '测试路 1 号',
    lat: 31.2000, lng: 121.5000, radius: 1000, uid: userId,
    area: null, rent: null,
    ...over
  }
  const info = getDb().prepare(
    `INSERT INTO store_candidates (user_id, store_code, name, city, district, address,
                                   latitude, longitude, radius, area, rent, stage, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`
  ).run(c.uid, c.store_code, c.name, c.city, c.district, c.address,
    c.lat, c.lng, c.radius, c.area, c.rent, c.stage)
  return Number(info.lastInsertRowid)
}

const clearMarkers = () => getDb().prepare('DELETE FROM markers').run()
function clearCands() {
  getDb().prepare('DELETE FROM candidate_notes').run()
  getDb().prepare('DELETE FROM store_candidates').run()
}

beforeAll(async () => {
  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  const dbMod = await import('../src/models/database.js')
  getDb = dbMod.getDb

  const db = getDb()
  const u = db.prepare(`INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('cand_admin', 'cand_admin@test.local', 'x', 'admin', 0)
  userId = Number(u.lastInsertRowid)
  const u2 = db.prepare(`INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('cand_other', 'cand_other@test.local', 'x', 'user', 0)
  otherUserId = Number(u2.lastInsertRowid)

  token = jwt.sign({ id: userId, username: 'cand_admin', role: 'admin' }, cfg.JWT_SECRET, { expiresIn: '1h' })

  const express = (await import('express')).default
  const router = (await import('../src/routes/candidates.js')).default
  const app = express()
  app.use(express.json())
  app.use('/api/candidates', router)
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
})

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
})

beforeEach(() => {
  clearCands()
  clearMarkers()
})

// ────────────────────────────────────────────────────────────────────────
// S1. 数据源：只认「我的门店」里的候选店
// ────────────────────────────────────────────────────────────────────────
describe('S1. 数据源＝我的门店里的候选门店', () => {
  it('重点候选 + 一般候选都出现；已开业不出现', async () => {
    insertMarker({ name: '重点候选店 A', store_type: '重点候选' })
    insertMarker({ name: '一般候选店 B', store_type: '一般候选', lat: 31.21 })
    insertMarker({ name: '已开业店 C', store_type: '已开业', lat: 31.22 })

    const r = await call('GET', '/api/candidates')
    expect(r.status, r.raw).toBe(200)
    const names = r.body.list.map((x) => x.name).sort()
    expect(names).toEqual(['一般候选店 B', '重点候选店 A'].sort())
    expect(r.body.list.every((x) => x.origin === 'store')).toBe(true)
    // 没有推进记录 ⇒ id 为 null、stage 给默认「待评估」、stageStored=false
    expect(r.body.list.every((x) => x.id === null)).toBe(true)
    expect(r.body.list.every((x) => x.stage === '待评估')).toBe(true)
    expect(r.body.list.every((x) => x.stageStored === false)).toBe(true)
    expect(r.body.originCounts).toEqual({ store: 2, candidate: 0 })
  })

  it('🔴 别人的候选门店不出现（⛔ admin 也不放大）', async () => {
    insertMarker({ name: '我的候选店' })
    insertMarker({ name: '别人的候选店', uid: otherUserId, lat: 31.23 })

    const r = await call('GET', '/api/candidates')
    expect(r.body.list.map((x) => x.name)).toEqual(['我的候选店'])
  })

  it('🔴 user_id 为 NULL 的候选门店不出现（现网有 3 条这种数据）', async () => {
    insertMarker({ name: '有主的候选店' })
    const id = insertMarker({ name: '无主候选店', lat: 31.24 })
    getDb().prepare('UPDATE markers SET user_id = NULL WHERE id = ?').run(id)

    const r = await call('GET', '/api/candidates')
    expect(r.body.list.map((x) => x.name)).toEqual(['有主的候选店'])
  })

  it('🔴 合并软删（merged_into 非空）的候选门店不出现', async () => {
    const keep = insertMarker({ name: '保留店' })
    insertMarker({ name: '被合并的店', lat: 31.25, merged_into: keep })

    const r = await call('GET', '/api/candidates')
    expect(r.body.list.map((x) => x.name)).toEqual(['保留店'])
  })
})

// ────────────────────────────────────────────────────────────────────────
// S2. stage 叠加：能认出「同一个点位的两种写法」
// ────────────────────────────────────────────────────────────────────────
describe('S2. 推进阶段叠加（关联判据）', () => {
  it('🔴 现网真实形态：名字差一个「店」字 + 相距 118m ⇒ 必须合成一行', async () => {
    const mid = insertMarker({
      name: '浦江绿地乐和城店', store_code: 'SH001',
      lat: 31.0771591634692, lng: 121.496987342834
    })
    const cid = insertCand({
      name: '浦江绿地乐和城', city: '上海',
      lat: 31.07624, lng: 121.49761, stage: '已勘踏'
    })

    const r = await call('GET', '/api/candidates')
    expect(r.body.list.length, '同一家店被列成了两条 ⇒ 用户看到重复').toBe(1)
    const row = r.body.list[0]
    expect(row.name).toBe('浦江绿地乐和城店')   // 展示用门店台账的名字
    expect(row.stage).toBe('已勘踏')             // 阶段来自叠加
    expect(row.stageStored).toBe(true)
    expect(row.id).toBe(cid)
    expect(row.markerId).toBe(mid)
    expect(row.origin).toBe('store')
  })

  it('store_code 相同 ⇒ 即使名字完全不同也关联（最硬的键优先）', async () => {
    insertMarker({ name: '门店台账叫这个', store_code: 'SH999', lat: 31.10, lng: 121.40 })
    const cid = insertCand({ name: '旧叫法完全不同', store_code: 'SH999', lat: 31.90, lng: 121.90, stage: '立项' })

    const r = await call('GET', '/api/candidates')
    expect(r.body.list.length).toBe(1)
    expect(r.body.list[0].id).toBe(cid)
    expect(r.body.list[0].stage).toBe('立项')
  })

  it('同名但相距很远、城市也不同 ⇒ ⛔ 不关联合（宁可多一行，不能错配）', async () => {
    insertMarker({ name: '星巴克望京店', city: '北京', lat: 39.99, lng: 116.47 })
    insertCand({ name: '星巴克望京店', city: '上海', lat: 31.20, lng: 121.50, stage: '立项' })

    const r = await call('GET', '/api/candidates')
    // 一条门店（待评估）+ 一条独立点位（立项）
    expect(r.body.list.length).toBe(2)
    const byOrigin = Object.fromEntries(r.body.list.map((x) => [x.origin, x]))
    expect(byOrigin.store.stage).toBe('待评估')
    expect(byOrigin.candidate.stage).toBe('立项')
  })

  it('同名 + 同城 + 坐标缺失 ⇒ 走「同城」兜底关联上', async () => {
    insertMarker({ name: '五角场万达店', city: '上海', lat: 31.30, lng: 121.51 })
    const cid = insertCand({ name: '五角场万达', city: '上海', lat: 31.90, lng: 121.90, stage: '已勘踏' })

    const r = await call('GET', '/api/candidates')
    expect(r.body.list.length).toBe(1)
    expect(r.body.list[0].id).toBe(cid)
  })

  it('🔴 一条推进记录只能被一个门店占用（两个同名店不共用流水）', async () => {
    insertMarker({ name: '同一品牌同一店', city: '上海', lat: 31.20, lng: 121.50 })
    insertMarker({ name: '同一品牌同一店', city: '上海', lat: 31.20, lng: 121.50 })
    const cid = insertCand({ name: '同一品牌同一店', city: '上海', lat: 31.20, lng: 121.50, stage: '立项' })

    const r = await call('GET', '/api/candidates')
    expect(r.body.list.length).toBe(2)
    const linked = r.body.list.filter((x) => x.id === cid)
    expect(linked.length, '同一份流水被两个门店共用 ⇒ 改 A 的阶段 B 也会变').toBe(1)
    expect(r.body.list.filter((x) => x.id === null).length).toBe(1)
  })

  it('面积/租金优先取门店台账，台账没填才回落到候选点位手填的值', async () => {
    insertMarker({ name: '台账有值店', area: 120, rent: 30000 })
    insertCand({ name: '台账有值', area: 80, rent: 20000, lat: 31.2001, lng: 121.5001 })

    insertMarker({ name: '台账空值店', area: null, rent: null, lat: 31.30 })
    insertCand({ name: '台账空值', area: 66, rent: 18000, lat: 31.3001, lng: 121.5001 })

    const r = await call('GET', '/api/candidates')
    const a = r.body.list.find((x) => x.name === '台账有值店')
    const b = r.body.list.find((x) => x.name === '台账空值店')
    expect(a.area).toBe(120)
    expect(a.rent).toBe(30000)
    expect(b.area).toBe(66)
    expect(b.rent).toBe(18000)
  })
})

// ────────────────────────────────────────────────────────────────────────
// S3. 历史独立点位不丢
// ────────────────────────────────────────────────────────────────────────
describe('S3. 历史独立点位仍显示', () => {
  it('没有对应门店的推进记录 ⇒ origin=candidate，仍列出', async () => {
    const cid = insertCand({ name: '地图选点 11-09 19:45', city: '', stage: '待评估' })
    const r = await call('GET', '/api/candidates')
    expect(r.body.list.length).toBe(1)
    expect(r.body.list[0].origin).toBe('candidate')
    expect(r.body.list[0].id).toBe(cid)
    expect(r.body.list[0].markerId).toBe(null)
    expect(r.body.originCounts).toEqual({ store: 0, candidate: 1 })
  })
})

// ────────────────────────────────────────────────────────────────────────
// S4. GET 纯读 + 筛选/计数
// ────────────────────────────────────────────────────────────────────────
describe('S4. GET 是纯读；筛选与计数', () => {
  it('🔴 调 5 次 GET 不改库（不建行、不改 stage）', async () => {
    insertMarker({ name: '候选店甲' })
    insertMarker({ name: '候选店乙', lat: 31.30 })
    const before = getDb().prepare('SELECT COUNT(*) AS c FROM store_candidates').get().c
    for (let i = 0; i < 5; i += 1) await call('GET', '/api/candidates')
    const after = getDb().prepare('SELECT COUNT(*) AS c FROM store_candidates').get().c
    expect(after, 'GET 偷偷建了行 ⇒ 缓存/预取/爬虫都会变成写操作').toBe(before)
  })

  it('计数按全量算，⛔ 不随筛选变空', async () => {
    insertMarker({ name: '店一' })
    insertMarker({ name: '店二', lat: 31.30 })
    const cid = insertCand({ name: '独立点', lat: 31.40, stage: '立项' })

    const all = await call('GET', '/api/candidates')
    expect(all.body.counts['待评估']).toBe(2)
    expect(all.body.counts['立项']).toBe(1)
    expect(all.body.total).toBe(3)

    const only = await call('GET', `/api/candidates?stage=${encodeURIComponent('立项')}`)
    expect(only.body.list.length).toBe(1)
    expect(only.body.list[0].id).toBe(cid)
    // 计数仍是全量
    expect(only.body.counts['待评估']).toBe(2)
    expect(only.body.counts['立项']).toBe(1)
  })

  it('keyword 大小写不敏感、命中名称/地址/品牌任一', async () => {
    insertMarker({ name: 'Starbucks 望京店', brand: 'STARBUCKS' })
    insertMarker({ name: '别的店', brand: '别的品牌', address: 'Starbucks 隔壁', lat: 31.30 })
    insertMarker({ name: '无关店', brand: '无关', address: '无关路', lat: 31.40 })

    const r = await call('GET', '/api/candidates?keyword=starbucks')
    expect(r.status).toBe(200)
    expect(r.body.list.length).toBe(2)
    expect(r.body.total).toBe(3)  // total 恒为全量
  })
})

// ────────────────────────────────────────────────────────────────────────
// S5. POST /ensure：惰性建行、幂等、只对候选门店
// ────────────────────────────────────────────────────────────────────────
describe('S5. POST /ensure（惰性建推进记录）', () => {
  it('第一次创建、第二次幂等返回同一条', async () => {
    const mid = insertMarker({ name: '要推进的候选店', store_code: 'SH777', city: '上海', district: '杨浦区', address: '邯郸路 600 号' })

    const r1 = await call('POST', '/api/candidates/ensure', { markerId: mid })
    expect(r1.status, r1.raw).toBe(200)
    expect(r1.body.created).toBe(true)
    expect(r1.body.candidate.store_code).toBe('SH777')
    expect(r1.body.candidate.name).toBe('要推进的候选店')
    expect(r1.body.candidate.city).toBe('上海')
    expect(r1.body.candidate.stage).toBe('待评估')
    // 建行必须留一条建档流水
    expect(r1.body.notes.length).toBe(1)
    expect(r1.body.notes[0].note).toContain('我的门店')

    const r2 = await call('POST', '/api/candidates/ensure', { markerId: mid })
    expect(r2.status).toBe(200)
    expect(r2.body.created).toBe(false)
    expect(r2.body.candidate.id).toBe(r1.body.candidate.id)
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM store_candidates').get().c).toBe(1)
  })

  it('已有推进记录时 ensure 不新建，且顺手回填缺失的 store_code', async () => {
    const mid = insertMarker({ name: '浦江绿地乐和城店', store_code: 'SH001', lat: 31.0771591634692, lng: 121.496987342834 })
    const cid = insertCand({ name: '浦江绿地乐和城', lat: 31.07624, lng: 121.49761, stage: '已勘踏' })

    const r = await call('POST', '/api/candidates/ensure', { markerId: mid })
    expect(r.status).toBe(200)
    expect(r.body.created).toBe(false)
    expect(r.body.candidate.id).toBe(cid)
    expect(r.body.candidate.store_code, '关联上却没回填 store_code ⇒ 下次还得靠名称匹配').toBe('SH001')
    // 回填不碰 updated_at（补个关联键不是"推进了一步"）
    const row = getDb().prepare('SELECT stage FROM store_candidates WHERE id = ?').get(cid)
    expect(row.stage).toBe('已勘踏')
  })

  it('⛔ 非候选门店（已开业）调 ensure ⇒ 400', async () => {
    const mid = insertMarker({ name: '已开业店', store_type: '已开业' })
    const r = await call('POST', '/api/candidates/ensure', { markerId: mid })
    expect(r.status).toBe(400)
    expect(r.body.message).toContain('不是候选门店')
  })

  it('⚠️ 别人的门店调 ensure ⇒ 404（不区分"不存在"与"不是你的"）', async () => {
    const mid = insertMarker({ name: '别人的店', uid: otherUserId })
    const r = await call('POST', '/api/candidates/ensure', { markerId: mid })
    expect(r.status).toBe(404)
  })

  it('缺 markerId ⇒ 400', async () => {
    const r = await call('POST', '/api/candidates/ensure', {})
    expect(r.status).toBe(400)
  })
})

// ────────────────────────────────────────────────────────────────────────
// S6. 删除：关联门店的行不可删
// ────────────────────────────────────────────────────────────────────────
describe('S6. 关联到门店的行不可删（视图 ≠ 源数据）', () => {
  it('🔴 DELETE 关联行 ⇒ 400 且数据还在', async () => {
    insertMarker({ name: '浦江绿地乐和城店', store_code: 'SH001', lat: 31.0771591634692, lng: 121.496987342834 })
    const cid = insertCand({ name: '浦江绿地乐和城', lat: 31.07624, lng: 121.49761, stage: '已勘踏' })

    const r = await call('DELETE', `/api/candidates/${cid}`)
    expect(r.status, '删掉了会刷新复活，用户会反复点').toBe(400)
    expect(r.body.message).toContain('我的门店')
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM store_candidates WHERE id = ?').get(cid).c).toBe(1)
  })

  it('独立点位可以正常删除', async () => {
    const cid = insertCand({ name: '独立点位', lat: 31.40 })
    const r = await call('DELETE', `/api/candidates/${cid}`)
    expect(r.status, r.raw).toBe(200)
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM store_candidates WHERE id = ?').get(cid).c).toBe(0)
  })
})

// ────────────────────────────────────────────────────────────────────────
// S7. 详情带出关联门店
// ────────────────────────────────────────────────────────────────────────
describe('S7. 详情接口带出关联门店', () => {
  it('GET /:id 返回 marker（前端靠它显示门店类型、判断能否删）', async () => {
    const mid = insertMarker({ name: '浦江绿地乐和城店', store_code: 'SH001', store_type: '重点候选', lat: 31.0771591634692, lng: 121.496987342834 })
    const cid = insertCand({ name: '浦江绿地乐和城', store_code: 'SH001', lat: 31.07624, lng: 121.49761 })

    const r = await call('GET', `/api/candidates/${cid}`)
    expect(r.status).toBe(200)
    expect(r.body.marker).toBeTruthy()
    expect(r.body.marker.id).toBe(mid)
    expect(r.body.marker.store_type).toBe('重点候选')
  })

  it('独立点位的详情 marker 为 null', async () => {
    const cid = insertCand({ name: '独立点位', lat: 31.40 })
    const r = await call('GET', `/api/candidates/${cid}`)
    expect(r.status).toBe(200)
    expect(r.body.marker).toBeFalsy()
  })

  it('🔴 详情返回与列表同构的 row：展示字段取门店台账，⛔ 不能用候选表里的旧值', async () => {
    // 现网真实形态：门店台账地址「浦锦路309弄6号」，候选表里是当年手录的「江月路」
    insertMarker({ name: '浦江绿地乐和城店', address: '浦锦路309弄6号', area: 120, rent: 30000 })
    const cid = insertCand({ name: '浦江绿地乐和城', address: '江月路', area: 80, rent: 20000, lat: 31.2001, lng: 121.5001 })

    const list = await call('GET', '/api/candidates')
    const listRow = list.body.list.find((x) => x.id === cid)

    const r = await call('GET', `/api/candidates/${cid}`)
    expect(r.status).toBe(200)
    expect(r.body.row, '没返回 row ⇒ 前端只能拿 candidate 的旧值，列表与详情地址会不一致').toBeTruthy()
    expect(r.body.row.address).toBe('浦锦路309弄6号')
    expect(r.body.row.name).toBe('浦江绿地乐和城店')
    expect(r.body.row.area).toBe(120)
    // 与列表行逐字段一致（同构）
    expect(r.body.row.address).toBe(listRow.address)
    expect(r.body.row.name).toBe(listRow.name)
    expect(r.body.row.radius).toBe(listRow.radius)
    // candidate 保持原样：立项报告读的是它的下划线字段（drop_reason 等），⛔ 不能覆盖
    expect(r.body.candidate.address).toBe('江月路')
    expect(r.body.candidate.drop_reason).toBe('')
  })
})
