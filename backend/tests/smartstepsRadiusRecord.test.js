/**
 * 记录口径 = 取数口径 = 扣费口径（批次 408 立规，409 扩到多圆）
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
 *   · 🔴 409（业主 2026-11-23 追问）：**填几个半径就买几个圆** —— 前端逐圆下单，
 *     N 个框连发 N 次 `/query`，每次一个 `radius`、各落一行、各扣 1 次；确认框按 N 显示。
 *     上游 getData 一次只受理一个 radius，所以「一次买 4 个」在服务端看就是 4 次调用，
 *     与 `BatchSmartstepsDialog`（门店×半径）同一个套路。
 *   · 半径1~4 全部参与（第一个非 0 不再有特权），⛔ 不再有静默吞掉的框
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

  it('一次买 4 个圆（前端逐圆下单）⇒ 4 行记录、池子扣 4 次', async () => {
    // 单独把池子拉到 10，便于精确断言「买了 4 个 ⇒ 6」
    db.prepare(`UPDATE admin_quota SET remaining_quota = 10 WHERE id = 1`).run()
    const radii = [400, 600, 900, 1200]
    for (const r of radii) {
      const res = await call('POST', '/api/smartsteps/query', {
        token: token(),
        body: {
          // 每个圆换一个坐标，避开 smartsteps_cache（同点同半径同月会免费返回、不写履历）
          centerLng: 121.6 + r / 100000,
          centerLat: 31.3 + r / 100000,
          radius: r,
          radii: [r],
          services: ['1001'],
          cityMonth: '202609',
          storeName: `口径测试门店C-${r}`,
          storeType: '已开业'
        }
      })
      expect(res.status).toBe(200)
      expect(res.body.quotaUsed).toBe(1)
    }
    const rows = db.prepare(`SELECT radius, quota_used FROM purchases WHERE store_name LIKE '口径测试门店C-%' ORDER BY id`).all()
    expect(rows.map((x) => x.radius)).toEqual(radii.map((r) => `[${r}]`))
    expect(rows.every((x) => x.quota_used === 1)).toBe(true)
    const pool = db.prepare(`SELECT remaining_quota FROM admin_quota WHERE id = 1`).get()
    expect(Number(pool.remaining_quota)).toBe(6)
  })

  it('反向断言：⛔ 不许回潮 `radii || [radius]`（那正是「记录写全量」的写法）', () => {
    const src = read('backend/src/routes/smartsteps.js')
    expect(src).not.toContain('radii || [radius]')
    // 落入 INSERT 的必须是单元素数组
    expect(src).toMatch(/JSON\.stringify\(\[radius\]\)/)
  })
})

describe('B. 前端弹窗：填几个半径就买几个圆（409）', () => {
  const src = read(DIALOG)
  /** 取某个顶层函数的函数体（到行首 `}` 为止）—— 避免整文件匹配造成假绿灯 */
  const fnBody = (name) => {
    const i = src.indexOf(`function ${name}(`)
    expect(i, `${DIALOG} 里找不到 ${name}()`).toBeGreaterThan(-1)
    const end = src.indexOf('\n}', i)
    expect(end).toBeGreaterThan(i)
    return src.slice(i, end)
  }

  it('getQuotaToUse = 本次要买的圆数（不再恒 1）', () => {
    const body = fnBody('getQuotaToUse')
    expect(body).toContain('purchaseRadii')
    // 反向：408 的「恒 1 次」不许回潮 —— 那时后端一次只发一个圆
    expect(src, '408 的常量还在 ⇒ render 仍会显示「扣 1 次」').not.toContain('QUERY_QUOTA_COST')
  })

  it('下单前要求「剩余次数 ≥ 圆数」，不是有 1 次就放行', () => {
    const i = src.indexOf('const canQuery = computed')
    expect(i).toBeGreaterThan(-1)
    const line = src.slice(i, src.indexOf('\n', i))
    expect(line, 'canQuery 必须比到「够买 N 个圆」').toContain('getQuotaToUse()')
  })

  it('确认框列全部半径 + 共几个圆 + 扣几次，⚠️ 写明命中缓存不扣费', () => {
    const s = src.indexOf('购买确认对话框')
    const e = src.indexOf('历史报表对话框', s)
    expect(s).toBeGreaterThan(-1)
    expect(e).toBeGreaterThan(s)
    const block = src.slice(s, e)
    expect(block).toContain('radiiConfirmText')   // 列全部半径
    expect(block).toContain('getQuotaToUse()')    // 扣 N 次
    expect(block).toContain('命中缓存')            // 实际扣费 ≤ 框数，必须说明
    // 反向：408 的「其余 N 个不取数」不许回潮
    expect(block).not.toContain('本次不取数')
    expect(block).not.toContain('primaryRadiusText')
    expect(block).not.toContain('extraRadiusCount')
  })

  it('次数不够买满时，灰按钮旁边必须说清差几次（⛔ 只给一个 disabled）', () => {
    // canQuery 要求 available ≥ 圆数 ⇒ 有 2 次、填 4 个框时按钮是灰的；
    // 只在 available<=0 才提示的话，用户面对灰按钮无从判断。
    expect(src).toContain('quotaInfo.available < getQuotaToUse()')
    expect(src).toContain('本次需扣')
    expect(src).toContain('请减少半径框')
  })

  it('radiiConfirmText 里带「共 N 个圆」，且用、分隔两位小数', () => {
    const i = src.indexOf('const radiiConfirmText')
    expect(i).toBeGreaterThan(-1)
    const block = src.slice(i, src.indexOf('\n})', i))
    expect(block).toContain('个圆')
    expect(block).toContain("toFixed(2)")
    expect(block).toContain("'、'")
  })

  it('executeQuery 逐圆下单：一次请求一个 radius，⛔ 不再把 4 个框塞进一个请求', () => {
    const fn = fnBody('executeQuery')
    expect(fn, '没有逐圆循环 ⇒ 4 个框只会买第一个').toMatch(/for \(let i = 0; i < radii\.length; i\+\+\)/)
    expect(fn).toContain('radius: r')
    expect(fn).toContain('radii: [r]')
    expect(fn).not.toContain('radius: radii[0]')
    expect(fn).toContain('purchaseProgress')
    // 中途被闸门拒掉时，剩下的圆必须显式标未购买（⛔ 静默少买）
    expect(fn).toContain('未购买')
  })

  it('结果框按半径切换：一个圆一套数据，导出跟着切', () => {
    expect(src).toContain('const queryResults = ref([])')
    expect(src).toContain('const activeRadius = ref(0)')
    const i = src.indexOf('查询结果对话框')
    const block = src.slice(i, src.indexOf('购买确认对话框', i))
    expect(block).toContain('activeResult')
    expect(block).toContain('queryResults.length > 1')
    // 导出必须用「当前选中半径」的记录，⛔ 不能用最后一次请求的
    expect(src).toContain('const queryPurchaseId = computed')
  })

  it('表单下写明「填几个就买几个、各扣 1 次」', () => {
    expect(src).toMatch(/填几个半径就买几个圆/)
    // 反向：408 的单一圆文案不许回潮
    expect(src).not.toMatch(/本次取数只查第一个非 0 的半径/)
  })

  it('半径下限 0.35（门店弹窗与地图面板同源，⛔ 不许再出现 0.31）', () => {
    expect(src).toContain(':min="0.35"')
    expect(src).toContain('0.35~5 公里')
    expect(src).not.toContain(':min="0.31"')
    const panel = read('frontend/src/components/SmartstepsPanel.vue')
    expect(panel).toContain(':min="0.35"')
    expect(panel).toContain('0.35~5 公里')
    // 批量购买弹窗同样走 /query，下限也得是 0.35（老值 0.1 会被后端面积校验 400）
    const batch = read('frontend/src/components/BatchSmartstepsDialog.vue')
    expect(batch).toContain(':min="0.35"')
  })

  it('getRadiiDisplay / primaryRadiusText 无残留（别罗列半径冒充「都查了」）', () => {
    expect(src).not.toContain('getRadiiDisplay')
    expect(src).not.toContain('primaryRadiusText')
  })
})

/**
 * C 组：地图「商圈工具 → 联通人口」那张侧面板（SmartstepsPanel.vue）。
 *
 * 409 时这张面板是**唯一**还写着「每次只取第一个非 0 的半径」的地方 —— 等于把上游
 * 「一次一个 radius」的限制摊给用户，与门店弹窗「填几个买几个」自相矛盾。
 * 410 把它也改成逐圆下单。本组钉死三件事：
 *   ① 旧文案不许回潮（那是「只买一个圆」的承诺）
 *   ② 一次请求只发一个 radius（⛔ 不能把 4 个框塞进一个请求，上游会只认第一个）
 *   ③ 配额闸门按圆数，且不够时必须有内联出口（⛔ 只给灰按钮）
 * ⚠️ 这里只做源码切片断言；「4 个圆 ⇒ 4 行 purchases」由 A 组的真实 HTTP 用例覆盖
 *   （两个入口走的是同一个 POST /api/smartsteps/query）。
 */
describe('C. 地图侧面板：与弹窗口径一致（410）', () => {
  const PANEL = 'frontend/src/components/SmartstepsPanel.vue'
  const src = read(PANEL)
  /**
   * 🔴 断言前必须剥注释：409 的历史文案**就写在文件注释里**（记录「当时为什么那么写」），
   *   不剥的话「旧文案不许回潮」这条会对着注释报假红（211 的「正则扫源码必配切片」同源坑）。
   *   ⛔ 只剥三种注释，不碰字符串 —— 文案断言的对象是用户能看到的字面量。
   */
  const code = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const fnBody = (name) => {
    const i = code.indexOf(`function ${name}(`)
    expect(i, `${PANEL} 里找不到 ${name}()`).toBeGreaterThan(-1)
    const end = code.indexOf('\n}', i)
    expect(end).toBeGreaterThan(i)
    return code.slice(i, end)
  }

  it('表单下写明「填几个就买几个、各扣 1 次」，⛔ 不再把上游限制摊给用户', () => {
    expect(code).toMatch(/填几个半径就买几个圆/)
    // 反向断言（本批的核心）：这两句都是「只买一个圆」的承诺，留着就是骗人
    expect(code, '409 的「只取第一个非 0 半径」文案回潮').not.toMatch(/每次只取第一个非 0 的半径/)
    expect(code, '把用户往别的入口赶的提示已无必要').not.toMatch(/要一次买多个半径，请用/)
  })

  it('getQuotaToUse = 本次要买的圆数', () => {
    expect(fnBody('getQuotaToUse')).toContain('getRadiiInMeters')
    expect(code).not.toContain('QUERY_QUOTA_COST')
  })

  it('getRadiiInMeters 收全 4 个框并去重（⛔ 吞半径4 / ⛔ 同值买两遍）', () => {
    const body = fnBody('getRadiiInMeters')
    // 4 个框都要在循环里（408 只收 1~3，只填第 4 个框时 radii=[] ⇒ 后端 400）
    for (const r of ['radius1', 'radius2', 'radius3', 'radius4']) expect(body).toContain(r)
    expect(body, '不去重会拿同一个圆买两遍、白扣一次').toContain('!radii.includes(m)')
  })

  it('下单前要求「剩余次数 ≥ 圆数」，不是有 1 次就放行', () => {
    const i = code.indexOf('const canPurchase = computed')
    expect(i).toBeGreaterThan(-1)
    const block = code.slice(i, code.indexOf('\n})', i))
    expect(block, 'canPurchase 必须比到「够买 N 个圆」').toContain('getQuotaToUse()')
  })

  it('executePurchase 逐圆下单：一次请求一个 radius', () => {
    const fn = fnBody('executePurchase')
    expect(fn, '没有逐圆循环 ⇒ 4 个框只会买第一个').toMatch(/for \(let i = 0; i < radii\.length; i\+\+\)/)
    expect(fn).toContain('radius: r')
    expect(fn).toContain('radii: [r]')
    expect(fn, '409 前的老写法：拿 radii[0] 当唯一半径').not.toContain('radius: radii[0]')
    expect(fn).toContain('purchaseProgress')
    // 中途被闸门拒掉时，剩下的圆必须显式标未购买（⛔ 静默少买）
    expect(fn).toContain('未购买')
  })

  it('确认框列全部半径 + 共几个圆 + 扣几次，⚠️ 写明命中缓存不扣费', () => {
    // ⚠️ 锚点不能用「购买确认对话框」—— 那是 HTML 注释，上面已被剥掉
    const s = code.indexOf('v-model="showConfirmDialog"')
    const e = code.indexOf('</template>', s)
    expect(s).toBeGreaterThan(-1)
    expect(e).toBeGreaterThan(s)
    const block = code.slice(s, e)
    expect(block).toContain('radiiConfirmText')
    expect(block).toContain('getQuotaToUse()')
    expect(block).toContain('扣除后剩余')
    expect(block, '缓存命中不扣费必须写明（/query 与 /population 口径不同）').toContain('命中缓存')
    // 反向：旧的「罗列半径」写法
    expect(block).not.toContain('getRadiiDisplay')
  })

  it('结果区按半径切换：一个圆一套数据', () => {
    expect(code).toContain('const queryResults = ref([])')
    expect(code).toContain('const activeRadius = ref(0)')
    expect(code).toContain('const activeResult = computed')
    // 同样不能用注释当锚点：结果区 → 确认框 之间的模板
    const s = code.indexOf('v-if="queryResults.length"')
    const block = code.slice(s, code.indexOf('v-model="showConfirmDialog"', s))
    expect(s).toBeGreaterThan(-1)
    expect(block).toContain('activeResult')
    expect(block).toContain('queryResults.length > 1')
    // 老的单条 queryResult 引用不许回潮
    expect(code, '仍在读单条 queryResult').not.toMatch(/\bqueryResult\.(data|refunded)\b|\{\{ queryResult \}\}/)
  })

  it('次数不够买满时，灰按钮旁边必须说清差几次（⛔ 只给一个 disabled）', () => {
    expect(code).toContain('quotaInfo.available < getQuotaToUse()')
    expect(code).toContain('本次需扣')
    expect(code).toContain('请减少半径框')
  })

  it('购买按钮按圆数给文案（4 个框 ⇒ 「购买（4 次）」）', () => {
    expect(code).toContain('购买（${getQuotaToUse()} 次）')
  })
})
