/**
 * 管辖范围（批次 C · v0.10）测试
 *
 * 被测：
 *   A. src/utils/scopeGuard.js —— 纯函数（归一化 / 容错解析 / 冲突计算）
 *   B. src/routes/orgs.js 的 3 个 scope 接口
 *      GET   /api/orgs/:id/members/:userId/scope
 *      PATCH /api/orgs/:id/members/:userId/scope
 *      GET   /api/orgs/:id/scope-conflicts
 *   C. src/routes/sync.js 的 GET /api/sync/scope-options
 *
 * 方式：真起 express（端口 0）+ fetch 打真实 HTTP；不引 supertest（生产未装）。
 *
 * 覆盖的保证（设计方案 §8 规则总表）：
 *   · 规则 11 —— 范围只到城市级；城市候选取集团账号实际有门店的城市
 *   · 规则 12 —— **配置期互斥**：城市被本组织其他成员占用 → 409 + 占用方；
 *                归一化后比较（「上海市 / 上海 / 上海 市」视为同城）
 *   · 规则 14 —— scope_json 每次变更写 direction='scope_change' 审计批次
 *   · D5 集团设定、子公司只读 —— 成员本人**不可**写自己的范围（403）
 *   · 本批恒不写 users.quota（规则 21）
 *
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const tmpDb = path.join(os.tmpdir(), `r4b-scope-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let normalizeCity, parseCityList, parseBrandList
let buildOccupancyMap, collectConflicts, findScopeConflicts, describeOccupancy

let getDb, server, base, jwtSign
const tokens = {}
const ids = {}

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
  const guard = await import('../src/utils/scopeGuard.js')
  normalizeCity = guard.normalizeCity
  parseCityList = guard.parseCityList
  parseBrandList = guard.parseBrandList
  buildOccupancyMap = guard.buildOccupancyMap
  collectConflicts = guard.collectConflicts
  findScopeConflicts = guard.findScopeConflicts
  describeOccupancy = guard.describeOccupancy

  const orgsRouter = (await import('../src/routes/orgs.js')).default
  const syncRouter = (await import('../src/routes/sync.js')).default

  const db = getDb()
  const seed = (username, role, quota = 0) => {
    const r = db.prepare(`INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
      .run(username, `${username}@test.local`, 'x', role, quota)
    return r.lastInsertRowid
  }
  ids.admin = seed('admin_s', 'admin')
  ids.hq = seed('hq_s', 'user', 100)
  ids.subA = seed('subA_s', 'user', 0)
  ids.subB = seed('subB_s', 'user', 0)
  ids.outsider = seed('out_s', 'user', 0)

  for (const k of ['admin', 'hq', 'subA', 'subB', 'outsider']) {
    tokens[k] = makeToken({ id: ids[k], username: `${k}_s`, role: k === 'admin' ? 'admin' : 'user' })
  }

  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use('/api/orgs', orgsRouter)
  app.use('/api/sync', syncRouter)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`

  // 走真实接口建集团 + 绑成员
  const r1 = await call('POST', '/api/orgs', { token: tokens.admin, body: { name: '批次C集团', ownerUserId: ids.hq } })
  ids.org = r1.body.org.id
  await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.hq, body: { username: 'subA_s' } })
  await call('POST', `/api/orgs/${ids.org}/members`, { token: tokens.hq, body: { username: 'subB_s' } })

  // 集团账号门店：城市写法混用（带「市」/不带/含空格），用于验证归一化聚合
  let n = 0
  const mk = (city, brand, uid = null) => db.prepare(
    `INSERT INTO markers (name, city, brand, latitude, longitude, user_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`门店${++n}`, city, brand, 31.2, 121.4, uid ?? ids.hq)
  mk('上海市', '萨莉亚')
  mk('上海', '萨莉亚')
  mk(' 上海市 ', '萨莉亚')
  mk('杭州市', '萨莉亚')
  mk('杭州', '萨莉亚')
  mk('苏州', '萨莉亚')
  mk('北京市', '萨莉亚')
  // 竞品（品牌候选应合并进来）
  db.prepare(`INSERT INTO competitors (name, city, brand, latitude, longitude, user_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('竞品A', '上海市', '老乡鸡', 31.2, 121.4, ids.hq)
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ===========================================================================

describe('① scopeGuard 纯函数', () => {
  it('normalizeCity：去首尾/内部空白，去结尾「市」', () => {
    expect(normalizeCity('上海市')).toBe('上海')
    expect(normalizeCity('上海')).toBe('上海')
    expect(normalizeCity(' 上海市 ')).toBe('上海')
    expect(normalizeCity('\u3000上海市\u3000')).toBe('上海')   // 全角空格
    expect(normalizeCity('Shanghai')).toBe('Shanghai')
  })

  it('normalizeCity：空值安全，且不动非「市」后缀', () => {
    expect(normalizeCity('')).toBe('')
    expect(normalizeCity(null)).toBe('')
    expect(normalizeCity(undefined)).toBe('')
    expect(normalizeCity('北京市朝阳区')).toBe('北京市朝阳区')  // 只到城市级，不做二级归一
  })

  it('parseCityList：容错（null / 空串 / 坏 JSON / 混入非字符串）', () => {
    expect(parseCityList(null)).toEqual([])
    expect(parseCityList('')).toEqual([])
    expect(parseCityList('   ')).toEqual([])
    expect(parseCityList('not json')).toEqual([])
    expect(parseCityList('{"cities":["上海市","杭州市"]}')).toEqual(['上海市', '杭州市'])
    expect(parseCityList({ cities: ['上海市', '', null, 123] })).toEqual(['上海市'])
    expect(parseCityList('{"cities":"oops"}')).toEqual([])
    expect(parseCityList(['上海'])).toEqual(['上海'])
  })

  it('parseBrandList：同样容错', () => {
    expect(parseBrandList('{"brands":["萨莉亚"]}')).toEqual(['萨莉亚'])
    expect(parseBrandList(null)).toEqual([])
    expect(parseBrandList('oops')).toEqual([])
  })

  it('collectConflicts：命中他人占用 / 排除自身 / 归一化等价', () => {
    const members = [
      { userId: 11, username: 'subA', company: '上海公司', scope: { cities: ['上海市'], brands: [] } },
      { userId: 12, username: 'subB', company: null, scope: { cities: ['杭州市'], brands: [] } }
    ]
    // 命中 subA
    expect(collectConflicts(members, ['上海市'], null).map(c => c.userId)).toEqual([11])
    // 归一化等价：「上海」也命中
    expect(collectConflicts(members, ['上海'], null).map(c => c.userId)).toEqual([11])
    expect(collectConflicts(members, [' 上海 市 '], null).map(c => c.userId)).toEqual([11])
    // 排除自身 → 无冲突
    expect(collectConflicts(members, ['上海市'], 11)).toEqual([])
    // 未被占用 → 无冲突
    expect(collectConflicts(members, ['苏州市'], null)).toEqual([])
    // 冲突项带占用方信息（UI 要用）
    const c = collectConflicts(members, ['上海'], null)[0]
    expect(c.city).toBe('上海')
    expect(c.username).toBe('subA')
    expect(c.company).toBe('上海公司')
  })

  it('collectConflicts：同一次提交内重复城市只报一次', () => {
    const members = [{ userId: 11, username: 'subA', scope: { cities: ['上海市'] } }]
    expect(collectConflicts(members, ['上海', '上海市', '上海 '], null).length).toBe(1)
  })

  it('buildOccupancyMap：同城两家时先到先得', () => {
    const members = [
      { userId: 1, username: 'a', scope: { cities: ['上海市'] } },
      { userId: 2, username: 'b', scope: { cities: ['上海'] } }
    ]
    const map = buildOccupancyMap(members, null)
    expect(map.size).toBe(1)
    expect(map.get('上海').userId).toBe(1)
  })

  it('findScopeConflicts / describeOccupancy：收 db 参数即可工作（不依赖 database.js）', () => {
    const rows = [
      { user_id: 1, scope_json: '{"cities":["上海市"]}', username: 'a', company: 'A公司' },
      { user_id: 2, scope_json: '{"cities":["杭州市"]}', username: 'b', company: null },
      { user_id: 3, scope_json: null, username: 'c', company: null }
    ]
    const fakeDb = { prepare: () => ({ all: () => rows }) }
    const conflicts = findScopeConflicts(fakeDb, 1, 1, ['上海'])
    expect(conflicts).toEqual([])                        // 自身排除
    expect(findScopeConflicts(fakeDb, 1, 2, ['上海']).length).toBe(1)
    const occ = describeOccupancy(fakeDb, 1)
    expect(occ.cities.map(c => c.cityKey).sort()).toEqual(['上海', '杭州'])
    expect(occ.members.find(m => m.userId === 2).count).toBe(1)
  })
})

describe('② 管辖范围读写（GET / PATCH /api/orgs/:id/members/:userId/scope）', () => {
  it('未登录 → 401', async () => {
    const r = await call('GET', `/api/orgs/${ids.org}/members/${ids.subA}/scope`)
    expect(r.status).toBe(401)
  })

  it('与本组织无关的账号读 → 403（规则 1）', async () => {
    const r = await call('GET', `/api/orgs/${ids.org}/members/${ids.subA}/scope`, { token: tokens.outsider })
    expect(r.status).toBe(403)
  })

  it('成员本人可读自己的范围 → 200（§6「集团/本人可读」）', async () => {
    const r = await call('GET', `/api/orgs/${ids.org}/members/${ids.subA}/scope`, { token: tokens.subA })
    expect(r.status).toBe(200)
    expect(r.body.set).toBe(false)      // 尚未设置
    expect(r.body.scope).toBe(null)
  })

  it('总部账号读成员范围 → 200，且区分「未设置」(set=false)', async () => {
    const r = await call('GET', `/api/orgs/${ids.org}/members/${ids.subA}/scope`, { token: tokens.hq })
    expect(r.status).toBe(200)
    expect(r.body.username).toBe('subA_s')
    expect(r.body.scopeCities).toBe(0)
  })

  it('集团（总部）设定范围 → 200，读回一致', async () => {
    const r = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}/scope`, {
      token: tokens.hq,
      body: { cities: ['上海市', '杭州市'], brands: ['萨莉亚'] }
    })
    expect(r.status).toBe(200)
    expect(r.body.scope.cities).toEqual(['上海市', '杭州市'])
    expect(r.body.scope.brands).toEqual(['萨莉亚'])
    expect(r.body.changed).toBe(true)
    expect(r.body.batchId).toBeGreaterThan(0)

    const back = await call('GET', `/api/orgs/${ids.org}/members/${ids.subA}/scope`, { token: tokens.hq })
    expect(back.body.set).toBe(true)
    expect(back.body.scopeCities).toBe(2)
    expect(back.body.scopeUpdatedAt).toBeTruthy()
  })

  it('入参清洗：去空白 + 按归一化键去重', async () => {
    const r = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subB}/scope`, {
      token: tokens.hq,
      body: { cities: [' 宁波市 ', '宁波', '', null, '南京市'] }
    })
    expect(r.status).toBe(200)
    // 「宁波市」与「宁波」视为同城 → 只留首次写法
    expect(r.body.scope.cities).toEqual(['宁波市', '南京市'])
    // 还原，避免影响后续断言
    await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subB}/scope`, {
      token: tokens.hq, body: { cities: [] }
    })
  })

  it('★ 规则 12 互斥：subB 设「上海市」（已被 subA 占用）→ 409 + 占用方', async () => {
    const r = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subB}/scope`, {
      token: tokens.hq, body: { cities: ['上海市'] }
    })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('city_conflict')
    expect(r.body.conflicts[0].userId).toBe(ids.subA)
    expect(r.body.conflicts[0].username).toBe('subA_s')
    expect(r.body.message).toContain('subA_s')
  })

  it('★ 互斥按归一化比较：「上海」同样被拦', async () => {
    const r = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subB}/scope`, {
      token: tokens.hq, body: { cities: ['上海'] }
    })
    expect(r.status).toBe(409)
  })

  it('未占用城市可正常保存（互斥不误伤）', async () => {
    const r = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subB}/scope`, {
      token: tokens.hq, body: { cities: ['苏州市'] }
    })
    expect(r.status).toBe(200)
    expect(r.body.scope.cities).toEqual(['苏州市'])
  })

  it('D5：成员本人写自己的范围 → 403（子公司只读）', async () => {
    const r = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}/scope`, {
      token: tokens.subA, body: { cities: ['合肥市'] }
    })
    expect(r.status).toBe(403)
  })

  it('入参校验：没有维度 / 非数组 → 400', async () => {
    expect((await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}/scope`, {
      token: tokens.hq, body: {}
    })).status).toBe(400)
    expect((await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subA}/scope`, {
      token: tokens.hq, body: { cities: '上海市' }
    })).status).toBe(400)
  })

  it('账号不在本集团 → 404', async () => {
    const r = await call('GET', `/api/orgs/${ids.org}/members/${ids.outsider}/scope`, { token: tokens.hq })
    expect(r.status).toBe(404)
  })

  it('id 非法 → 400（不把 abc 当 0）', async () => {
    const r = await call('GET', `/api/orgs/abc/members/${ids.subA}/scope`, { token: tokens.hq })
    expect(r.status).toBe(400)
  })

  it('★ 规则 14：scope 变更写入 sync_batches（direction=scope_change，含 before/after）', async () => {
    const { getDb: g } = await import('../src/models/database.js')
    const row = g().prepare(`
      SELECT * FROM sync_batches WHERE org_id = ? AND target_user_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(ids.org, ids.subA)
    expect(row).toBeTruthy()
    expect(row.direction).toBe('scope_change')
    expect(row.status).toBe('success')
    expect(row.created_by).toBe(ids.hq)
    const detail = JSON.parse(row.detail)
    expect(detail.after.cities).toEqual(['上海市', '杭州市'])
    expect(detail.before.cities).toEqual([])
  })

  it('★ 不动 users.quota（规则 21）', async () => {
    const { getDb: g } = await import('../src/models/database.js')
    const q = g().prepare(`SELECT quota FROM users WHERE id = ?`).get(ids.subA).quota
    expect(q).toBe(0)
  })
})

describe('③ 城市占用表 GET /api/orgs/:id/scope-conflicts', () => {
  it('无关账号 → 403', async () => {
    const r = await call('GET', `/api/orgs/${ids.org}/scope-conflicts`, { token: tokens.outsider })
    expect(r.status).toBe(403)
  })

  it('总部可读：城市 → 占用方 + 人 → 城市 双视图', async () => {
    const r = await call('GET', `/api/orgs/${ids.org}/scope-conflicts`, { token: tokens.hq })
    expect(r.status).toBe(200)
    const sh = r.body.cities.find(c => c.cityKey === '上海')
    expect(sh).toBeTruthy()
    expect(sh.userId).toBe(ids.subA)

    const a = r.body.members.find(m => m.userId === ids.subA)
    expect(a.count).toBe(2)
    expect(a.cities).toEqual(['上海市', '杭州市'])
  })

  it('集团不存在 → 404', async () => {
    const r = await call('GET', '/api/orgs/999999/scope-conflicts', { token: tokens.hq })
    expect(r.status).toBe(404)
  })
})

describe('④ 管辖范围选项 GET /api/sync/scope-options', () => {
  it('未登录 → 401', async () => {
    const r = await call('GET', '/api/sync/scope-options')
    expect(r.status).toBe(401)
  })

  it('非本组织 owner/admin 带 orgId 查询 → 403', async () => {
    const r = await call('GET', `/api/sync/scope-options?orgId=${ids.org}`, { token: tokens.outsider })
    expect(r.status).toBe(403)
  })

  it('★ 城市候选 = 集团账号有门店的城市，且按归一化键聚合计数', async () => {
    const r = await call('GET', `/api/sync/scope-options?orgId=${ids.org}`, { token: tokens.hq })
    expect(r.status).toBe(200)
    const byKey = Object.fromEntries(r.body.cities.map(c => [c.key, c.count]))
    expect(byKey['上海']).toBe(3)     // 上海市 / 上海 / ' 上海市 ' 三条合并
    expect(byKey['杭州']).toBe(2)
    expect(byKey['苏州']).toBe(1)
    expect(byKey['北京']).toBe(1)
    expect(r.body.totalMarkers).toBe(7)
    // 降序：上海(3) 在杭州(2) 之前
    expect(r.body.cities[0].key).toBe('上海')
  })

  it('★ 品牌候选 = 自家门店 ∪ 竞品门店', async () => {
    const r = await call('GET', `/api/sync/scope-options?orgId=${ids.org}`, { token: tokens.hq })
    expect(r.body.brands).toContain('萨莉亚')
    expect(r.body.brands).toContain('老乡鸡')
  })

  it('传 userId 时回显该成员已选城市（含集团当前无数据的）', async () => {
    const r = await call('GET', `/api/sync/scope-options?orgId=${ids.org}&userId=${ids.subA}`, { token: tokens.hq })
    expect(r.body.selected).toEqual(['上海市', '杭州市'])
  })

  it('缺省 orgId → 取自己账号的数据（不报错）', async () => {
    const r = await call('GET', '/api/sync/scope-options', { token: tokens.outsider })
    expect(r.status).toBe(200)
    expect(r.body.orgId).toBe(null)
    expect(Array.isArray(r.body.cities)).toBe(true)
    expect(r.body.totalMarkers).toBe(0)   // outsider 无门店
  })

  it('orgId 对应集团不存在 → 404', async () => {
    const r = await call('GET', '/api/sync/scope-options?orgId=999999', { token: tokens.admin })
    expect(r.status).toBe(404)
  })
})

describe('⑤ ?force=1 历史脏数据解套出口（最后执行，跑完清场）', () => {
  it('force 可越过互斥保存，并回传 forcedConflicts + 留痕', async () => {
    const r = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subB}/scope?force=1`, {
      token: tokens.hq, body: { cities: ['上海市', '苏州市'] }
    })
    expect(r.status).toBe(200)
    expect(r.body.forced).toBe(true)
    expect(r.body.forcedConflicts.length).toBe(1)
    expect(r.body.forcedConflicts[0].cityKey).toBe('上海')
    expect(r.body.conflicts).toEqual([])     // 正常冲突列表为空 → 前端不误报红

    // 此时同城两家都被占用（脏数据形态）——占用表应能暴露
    const occ = await call('GET', `/api/orgs/${ids.org}/scope-conflicts`, { token: tokens.hq })
    const sh = occ.body.cities.find(c => c.cityKey === '上海')
    expect(sh).toBeTruthy()

    // 清场：subB 恢复空范围
    const clear = await call('PATCH', `/api/orgs/${ids.org}/members/${ids.subB}/scope`, {
      token: tokens.hq, body: { cities: [] }
    })
    expect(clear.status).toBe(200)
    expect(clear.body.scope.cities).toEqual([])
  })

  it('空数组 = 显式清空（与「未设置」在库内仍可区分）', async () => {
    const { getDb: g } = await import('../src/models/database.js')
    const m = g().prepare(`SELECT scope_json FROM org_members WHERE org_id = ? AND user_id = ?`)
      .get(ids.org, ids.subB)
    expect(m.scope_json).toBe('{"cities":[],"brands":[]}')
  })
})
