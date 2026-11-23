/**
 * 记录口径 = 取数口径 = 扣费口径（批次 408 · 业主 2026-11-23 拍板）
 *
 * ── 业主原话 ──────────────────────────────────────────────────────────
 * 「把『记录只写真正查的那一档半径 + 确认框按 1 次显示 + 半径4 也发出去』一起修掉吧」
 *
 * ── 改之前是什么样（三个错位，都指向同一件事）────────────────────────
 * ① **记录写全量、实际只查一个**
 *    `POST /api/smartsteps/query` 的上游请求体是 `{ codes, cityMonth, radius, polygons }`
 *    —— 一个 `radius`、一个点，一次只查一个圆；但落库写的是 `radii`（前端 4 个框里的全部值）。
 *    ⇒ 履历写着「买了 500/1000/1500 米三档」，实际只有 500 米那一份数据。
 *    更硬的是复用链：`/api/smartsteps/population` 的判据是「同半径」，
 *    按 1500 米做立项报告会被判「已购可复用」⇒ 拿 500 米的数当 1500 米用（面积差 9 倍）。
 * ② **确认框按框数报次数**
 *    `getQuotaToUse()` 数「有几个框填了」⇒ 默认 0.5/1/1.5/2 显示「本次扣除 4 次」，
 *    后端 `QUOTA_UNIT = 1` 实扣 1 次。用户拿履历一对账永远差 3 次。
 * ③ **半径4 被吞**
 *    `getRadiiInMeters()` 只 push radius1~3 ⇒ 只填第 4 个框时 `radii = []`、
 *    `radius = undefined` ⇒ 前端按钮可点、后端 400「缺少必要参数」。
 *
 * ── 现在的口径 ───────────────────────────────────────────────────────
 *   · 一个圆 = 一次配额 = 一行 purchases（`purchases.radius` 只写 `[radius]`）
 *   · 确认框「本次扣除」恒 1，并明说「其余 N 个半径本次不取数」
 *   · 半径1~4 全部参与「谁是本次的圆」的判定（第一个非 0 的值），⛔ 不再有静默吞掉的框
 *
 * ── 测试手法 ─────────────────────────────────────────────────────────
 * A 组走真实 HTTP（temp DB + express 端口 0 + fetch 打接口），stub 掉外网后读库验记录；
 * B 组读前端 SFC 源码切片（vitest 里没有浏览器，SFC 只能做静态断言，切片是为了避免
 * 「整个文件里出现过 radius4」这种假绿灯 —— 它也可能是其它 3 个框的同款代码）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const tmpDb = path.join(os.tmpdir(), `r4b-radiusrecord-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const DIALOG = 'frontend/src/components/StoreSmartstepsDialog.vue'

/** 一段最小合法的联通响应（结构与 segment 一致） */
const ST_DATA = { apiResult: { '1001': { p0_sum: '120000', p1_sum: '30000', p2_sum: '8000', pall_sum: '158000' } } }

let db, server, base, jwtSign
let uid

/** 本机 HTTP 调用必须绕过 fetch stub，否则测的是 stub 自己（踩过一次） */
const realFetch = globalThis.fetch.bind(globalThis)

/** fetch 拦截：token 请求放行，真取数返回固定报文 */
function stubUpstream() {
  vi.stubGlobal('fetch', async (url, init) => {
    const u = String(url)
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) {
      return realFetch(url, init)
    }
    if (u.includes('getAuthorization')) {
      return { ok: true, status: 200, json: async () => ({ code: 200, data: 'fake-token' }) }
    }
    return { ok: true, status: 200, json: async () => ({ code: 200, data: ST_DATA }) }
  })
}

async function call(method, p, { token, body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await realFetch(base + p, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, body: json }
}

beforeAll(async () => {
  stubUpstream()

  const jwt = (await import('jsonwebtoken')).default
  const cfg = await import('../src/config.js')
  jwtSign = (payload) => jwt.sign(payload, cfg.JWT_SECRET, { expiresIn: '1h' })

  const { getDb } = await import('../src/models/database.js')
  db = getDb()
  // admin：checkQuota 直接放行账号额度，只校验物理池 ⇒ 这里只喂池子
  uid = Number(db.prepare(`INSERT INTO users (username, email, password, role, quota) VALUES (?, ?, ?, ?, ?)`)
    .run('radius_rec_admin', 'radius_rec@test.local', 'x', 'admin', 0).lastInsertRowid)
  db.prepare(`UPDATE admin_quota SET remaining_quota = 5 WHERE id = 1`).run()

  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use('/api/smartsteps', (await import('../src/routes/smartsteps.js')).default)
  server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  vi.unstubAllGlobals()
  if (server) await new Promise((r) => server.close(r))
  try { fs.unlinkSync(tmpDb) } catch { /* 忽略 */ }
  for (const ext of ['-journal', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDb + ext) } catch { /* 忽略 */ }
  }
})

const token = () => jwtSign({ id: uid, username: 'radius_rec_admin', role: 'admin' })

describe('A. 后端：purchases.radius 只写真正取数的那一档', () => {
  it('前端填 4 个框（radii 全量）⇒ 记录只有第一个圆', async () => {
    const r = await call('POST', '/api/smartsteps/query', {
      token: token(),
      body: {
        centerLng: 121.4737,
        centerLat: 31.2304,
        radius: 500,
        // 前端会把 4 个框都发过来 —— 这正是老实现写坏记录的入口
        radii: [500, 1000, 1500, 2000],
        services: ['1001'],
        cityMonth: '202609',
        storeName: '口径测试门店A',
        storeType: '已开业'
      }
    })
    expect(r.status).toBe(200)
    expect(r.body.success).toBe(true)
    expect(r.body.quotaUsed).toBe(1)

    const row = db.prepare(`SELECT radius, quota_used, status FROM purchases WHERE store_name = ?`)
      .get('口径测试门店A')
    expect(row).toBeTruthy()
    // 记录口径 = 取数口径：只有 500 米
    expect(row.radius).toBe('[500]')
    expect(row.quota_used).toBe(1)
    expect(row.status).toBe('active')
  })

  it('扣费口径同时是 1 次：池子 5 → 4', () => {
    const pool = db.prepare(`SELECT remaining_quota FROM admin_quota WHERE id = 1`).get()
    expect(Number(pool.remaining_quota)).toBe(4)
  })

  it('只填第 4 个框时（前端把半径4 当 radius 发）⇒ 记录就是那一档', async () => {
    const r = await call('POST', '/api/smartsteps/query', {
      token: token(),
      body: {
        // 换坐标：否则命中 smartsteps_cache 直接返回，不写 purchases（那是 381 的另一条口径）
        centerLng: 121.5001,
        centerLat: 31.2501,
        radius: 2000,
        radii: [2000],
        services: ['1001'],
        cityMonth: '202609',
        storeName: '口径测试门店B',
        storeType: '已开业'
      }
    })
    expect(r.status).toBe(200)
    expect(r.body.quotaUsed).toBe(1)

    const row = db.prepare(`SELECT radius FROM purchases WHERE store_name = ?`).get('口径测试门店B')
    expect(row.radius).toBe('[2000]')
  })

  it('反向断言：⛔ 不许回潮 `radii || [radius]`（那正是「记录写全量」的写法）', () => {
    const src = read('backend/src/routes/smartsteps.js')
    expect(src).not.toContain('radii || [radius]')
    // 落入 INSERT 的必须是单元素数组
    expect(src).toMatch(/JSON\.stringify\(\[radius\]\)/)
  })
})

describe('B. 前端弹窗：确认框按 1 次、4 个框都不吞', () => {
  const src = read(DIALOG)
  /** 取某个顶层函数的函数体（到行首 `}` 为止）—— 避免整文件匹配造成假绿灯 */
  const fnBody = (name) => {
    const i = src.indexOf(`function ${name}(`)
    expect(i, `${DIALOG} 里找不到 ${name}()`).toBeGreaterThan(-1)
    const end = src.indexOf('\n}', i)
    expect(end).toBeGreaterThan(i)
    return src.slice(i, end)
  }

  it('getQuotaToUse 恒为 1（不再数「填了几个框」）', () => {
    const body = fnBody('getQuotaToUse')
    expect(body).toContain('QUERY_QUOTA_COST')
    expect(body).not.toContain('count++')
    // 常量本身就是 1，与后端 QUOTA_UNIT 对齐
    expect(src).toMatch(/const\s+QUERY_QUOTA_COST\s*=\s*1\b/)
  })

  it('getRadiiInMeters 覆盖半径1~4（半径4 不再被吞）', () => {
    const body = fnBody('getRadiiInMeters')
    for (const k of ['radius1', 'radius2', 'radius3', 'radius4']) {
      expect(body, `${k} 没进 getRadiiInMeters`).toContain(k)
    }
    // 去重：初步分析的预填半径常与 localStorage 里的旧值撞车
    expect(body).toContain('includes')
  })

  it('确认框显示的是「本次真正取数的那个圆」，并说明其余半径不取数', () => {
    const s = src.indexOf('购买确认对话框')
    const e = src.indexOf('历史报表对话框', s)
    expect(s).toBeGreaterThan(-1)
    expect(e).toBeGreaterThan(s)
    const block = src.slice(s, e)
    expect(block).toContain('primaryRadiusText')     // 只显示主半径
    expect(block).toContain('extraRadiusCount')      // 其余 N 个不取数
    expect(block).not.toContain('getRadiiDisplay')   // 别再罗列全部半径冒充「都查了」
  })

  it('表单下明确写出「只查第一个非 0 的半径」', () => {
    expect(src).toMatch(/本次取数只查第一个非 0 的半径/)
  })

  it('getRadiiDisplay 已无残留（已被主半径 + 提示替代）', () => {
    expect(src).not.toContain('getRadiiDisplay')
  })
})
