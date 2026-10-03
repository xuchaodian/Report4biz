/**
 * 集团品牌图标「读时继承」测试 —— v1.13.191
 *
 * 需求（用户原话，2026-10-03 16:05）：
 *   「集团公司账号在『设置图标』里上传的品牌图标，子公司账号也能用
 *     —— 子公司不必再在自己账号里重复上传一遍」
 *
 * 被测：src/utils/brandIconScope.js + GET/POST/DELETE /api/brand-icons
 *
 * 本测试要钉死的不变量：
 *   A. **自有优先**：成员自己传过该品牌 ⇒ 生效的是自己那张（source='self'）
 *   B. 成员无自有 + 集团有 ⇒ 拿到集团图标（source='group'）
 *   C. admin 上传的仍**全员可见**（source='admin'）—— 既有机制不回归
 *   D. 已解散集团不继承（dissolved_at 非空）
 *   E. 被移出集团 ⇒ 继承**立即**消失（读时判定，不需要任何清理任务）
 *   F. ⭐ 零写入：整套 GET 解析过程不写库（全表行数快照前后一致）——
 *      这是本方案与「上传时复制到各成员行」的本质区别
 *   G. 🔒 成员**删不掉**集团的图标（403）；删自己的那张后自动回退到集团图
 *   H. ⭐ 成员关闭「允许集团拉取」（allow_group_pull=0）**仍继承**
 *      —— 该开关管的是「集团能否拉走我的数据」（上行），图标下发是集团自有资产的
 *         下行展示（同 brandLogo.js 第 2 条，2026-10-03 拍板）。本用例防的就是
 *         「顺手把开关也读进来」。
 *   I. 无集团账号：只有「自己 + admin」两路（回归历史行为）
 *   J. admin 视角：仍看得到全部图标（回归）
 *   K. ⭐ **定序**：同品牌并列时按 `self → group → admin`，且列表首条＝实际生效的那条。
 *      加继承**之前**前端两处口径不一致（设置页 `.find()` 第一条胜 / 地图 `forEach`
 *      最后一条胜）且 SQL 对并列行未定序 ⇒ 谁生效是碰运气。本用例钉死新口径。
 *   L. POST 上传/更新回包带 `source:'self'`（前端 store 靠它做本地定序）
 *
 * ⚠️ 仅 L 用例会向 `backend/uploads/brand-icons/` 写一个临时文件（无接口可绕），
 *    afterAll 按 `__unittest_icon_<pid>` 前缀**无条件清理**并校验删净。
 * 通过 R4B_DB_PATH 指向 /tmp 临时库，绝不触碰真实库。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const tmpDb = path.join(os.tmpdir(), `r4b-brandicon-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

// 临时上传文件名前缀（含 pid，保证并发/残留可辨）
const TEST_BRAND = `__unittest_icon_${process.pid}`
const UPLOAD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../uploads/brand-icons')

// 1×1 透明 PNG（multer 只看 mimetype/extname，不校验图片内容）
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
)

let db, groupOwnerUserId, tagIconSource, sortByPrecedence, signToken
let server, base
const ids = {}
const tokens = {}

async function call(method, p, { token, body, form } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + p, {
    method,
    headers,
    body: form !== undefined ? form : body !== undefined ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await res.json() } catch (e) { json = null }
  return { status: res.status, body: json }
}

/** 全表行数快照 —— 用于证明"解析过程零写入" */
function snapshotCounts() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all()
  const out = {}
  for (const t of tables) out[t.name] = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get().c
  return out
}

function addIcon(userId, brand, filename) {
  return db.prepare(
    `INSERT INTO brand_icons (brand, filename, original_name, user_id) VALUES (?, ?, ?, ?)`
  ).run(brand, filename, `${filename}.orig`, userId).lastInsertRowid
}

/** 从 GET 回包取某品牌的全部行（按服务端顺序） */
function rowsOf(payload, brand) {
  return (payload.icons || []).filter(i => i.brand === brand)
}

beforeAll(async () => {
  const dbMod = await import('../src/models/database.js')
  db = dbMod.getDb()

  const sc = await import('../src/utils/brandIconScope.js')
  groupOwnerUserId = sc.groupOwnerUserId
  tagIconSource = sc.tagIconSource
  sortByPrecedence = sc.sortByPrecedence

  const { signToken: st } = await import('../src/utils/tokenAuth.js')
  signToken = st

  const mkUser = (username, { role = 'user', company = null, password = 'x' } = {}) => {
    const r = db.prepare(
      `INSERT INTO users (username, email, password, role, company) VALUES (?, ?, ?, ?, ?)`
    ).run(username, `${username}@test.local`, password, role, company)
    return r.lastInsertRowid
  }
  const mkOrg = (name, ownerId, { dissolved = false } = {}) => {
    return dissolved
      ? db.prepare(`INSERT INTO organizations (name, owner_user_id, dissolved_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
          .run(name, ownerId).lastInsertRowid
      : db.prepare(`INSERT INTO organizations (name, owner_user_id) VALUES (?, ?)`)
          .run(name, ownerId).lastInsertRowid
  }
  const joinOrg = (orgId, userId, pull = 1) => {
    db.prepare(
      `INSERT INTO org_members (org_id, user_id, member_role, can_receive, allow_group_pull)
       VALUES (?, ?, 'member', 1, ?)`
    ).run(orgId, userId, pull)
  }

  // ---- 集团甲：总部有图标，两个成员（一个纯继承、一个有自有）----
  ids.hq1 = mkUser('bi_hq1', { company: '测试集团甲总部' })
  ids.subA = mkUser('bi_subA', { company: '甲-A子公司' })
  ids.subB = mkUser('bi_subB', { company: '甲-B子公司' })
  const org1 = mkOrg('测试集团甲', ids.hq1)
  joinOrg(org1, ids.subA, 1)
  joinOrg(org1, ids.subB, 1)

  // ---- 集团乙：成员刻意关闭「允许集团拉取」 ----
  ids.hq2 = mkUser('bi_hq2', { company: '测试集团乙总部' })
  ids.subC = mkUser('bi_subC', { company: '乙-C子公司' })
  const org2 = mkOrg('测试集团乙', ids.hq2)
  joinOrg(org2, ids.subC, 0)

  // ---- 集团丙：已解散（软删除立碑）----
  ids.hq4 = mkUser('bi_hq4', { company: '已解散集团总部' })
  ids.subE = mkUser('bi_subE', { company: '丙-E子公司' })
  const org4 = mkOrg('已解散集团', ids.hq4, { dissolved: true })
  joinOrg(org4, ids.subE, 1)

  // ---- 集团丁：用于「被移出集团」用例 ----
  ids.hq5 = mkUser('bi_hq5', { company: '临时集团总部' })
  ids.subG = mkUser('bi_subG', { company: '丁-G子公司' })
  const org5 = mkOrg('临时集团', ids.hq5)
  joinOrg(org5, ids.subG, 1)

  // ---- 无集团 / admin ----
  ids.outsider = mkUser('bi_outsider', { company: '散客公司' })
  ids.admin = mkUser('bi_admin', { role: 'admin', company: '平台方' })

  for (const k of ['hq1', 'subA', 'subB', 'subC', 'subE', 'subG', 'outsider']) {
    tokens[k] = signToken({ id: ids[k], username: `bi_${k}`, role: 'user', token_version: 0 })
  }
  tokens.admin = signToken({ id: ids.admin, username: 'bi_admin', role: 'admin', token_version: 0 })

  // ---- 图标数据 ----
  addIcon(ids.hq1, '甲集团品牌', 'hq1_a.png')          // 仅集团有 ⇒ subA 继承
  addIcon(ids.hq1, '三来源品牌', 'hq1_b.png')          // 集团
  addIcon(ids.subA, '三来源品牌', 'subA_b.png')        // 自有（应压过集团与 admin）
  addIcon(ids.admin, '三来源品牌', 'admin_b.png')      // 平台共用
  addIcon(ids.admin, '平台共享品牌', 'admin_c.png')    // 仅 admin ⇒ 全员可见
  addIcon(ids.hq2, '乙集团品牌', 'hq2_a.png')
  addIcon(ids.hq4, '已解散品牌', 'hq4_a.png')
  addIcon(ids.hq5, '临时集团品牌', 'hq5_a.png')
  addIcon(ids.outsider, '散客自己的品牌', 'outsider_a.png')
  ids.deletableIcon = addIcon(ids.subA, '可删品牌', 'subA_del.png')  // G2 用，删了不影响别的用例

  const express = (await import('express')).default
  const brandIconsRouter = (await import('../src/routes/brand-icons.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/brand-icons', brandIconsRouter)
  server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  if (server) await new Promise(r => server.close(r))
  // 清理 L 用例写的临时图标文件（按前缀无条件清，防残留成孤儿）
  try {
    if (fs.existsSync(UPLOAD_DIR)) {
      for (const f of fs.readdirSync(UPLOAD_DIR)) {
        if (f.startsWith(TEST_BRAND)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true })
      }
    }
  } catch (e) { /* 忽略 */ }
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

// ===========================================================================
describe('纯函数口径（brandIconScope）', () => {
  it('groupOwnerUserId：成员取到总部 id；总部自身 / 无集团 / 已解散 ⇒ null', () => {
    expect(groupOwnerUserId(db, ids.subA)).toBe(Number(ids.hq1))
    expect(groupOwnerUserId(db, ids.hq1)).toBeNull()   // 总部自身不参与继承
    expect(groupOwnerUserId(db, ids.outsider)).toBeNull()
    expect(groupOwnerUserId(db, ids.subE)).toBeNull()  // 已解散集团
  })

  it('tagIconSource：我=self / 集团=group / 其余=admin（集团优先于 admin 判定）', () => {
    const uid = Number(ids.subA)
    const gid = Number(ids.hq1)
    expect(tagIconSource({ user_id: uid }, uid, gid)).toBe('self')
    expect(tagIconSource({ user_id: gid }, uid, gid)).toBe('group')
    expect(tagIconSource({ user_id: Number(ids.admin) }, uid, gid)).toBe('admin')
    // 无集团时（groupOwnerId=null）不应把任何人误判成 group
    expect(tagIconSource({ user_id: gid }, uid, null)).toBe('admin')
  })

  it('sortByPrecedence：同品牌按 self(0) → group(1) → admin(2)，不同品牌按名称升序', () => {
    const out = sortByPrecedence([
      { id: 3, brand: 'B', source: 'admin' },
      { id: 1, brand: 'B', source: 'self' },
      { id: 2, brand: 'B', source: 'group' },
      { id: 4, brand: 'A', source: 'admin' }
    ])
    expect(out.map(i => `${i.brand}${i.id}`)).toEqual(['A4', 'B1', 'B2', 'B3'])
  })
})

// ===========================================================================
describe('GET /api/brand-icons —— 可见性', () => {
  it('F1 零写入：GET 前后全表行数快照完全一致（读时继承＝零复制）', async () => {
    const before = snapshotCounts()
    const res = await call('GET', '/api/brand-icons', { token: tokens.subA })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const after = snapshotCounts()
    expect(after).toEqual(before)
  })

  it('B1 成员看得到集团总部上传的图标，且标记 source=group', async () => {
    const { body } = await call('GET', '/api/brand-icons', { token: tokens.subA })
    const rows = rowsOf(body, '甲集团品牌')
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('group')
    expect(rows[0].user_id).toBe(Number(ids.hq1))
    expect(rows[0].filename).toBe('hq1_a.png')
  })

  it('B2 总部自己拿自己的图标＝self，且不会去继承自己集团', async () => {
    const ownerId = groupOwnerUserId(db, ids.hq1)
    expect(ownerId).toBeNull()
    const { body } = await call('GET', '/api/brand-icons', { token: tokens.hq1 })
    const rows = rowsOf(body, '甲集团品牌')
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('self')
  })

  it('C1 admin 上传的图标仍全员可见（source=admin），成员/散客都能拿到', async () => {
    for (const k of ['subA', 'outsider']) {
      const { body } = await call('GET', '/api/brand-icons', { token: tokens[k] })
      const rows = rowsOf(body, '平台共享品牌')
      expect(rows).toHaveLength(1)
      expect(rows[0].source).toBe('admin')
    }
  })

  it('A1 自有优先 + K1 定序：同品牌三来源时首条＝我的(self)，依次 group / admin', async () => {
    const { body } = await call('GET', '/api/brand-icons', { token: tokens.subA })
    const rows = rowsOf(body, '三来源品牌')
    expect(rows.map(r => r.source)).toEqual(['self', 'group', 'admin'])
    expect(rows.map(r => r.user_id)).toEqual([Number(ids.subA), Number(ids.hq1), Number(ids.admin)])
    // 首条即"实际生效的那条"
    expect(rows[0].filename).toBe('subA_b.png')
  })

  it('A2 没有自有的成员：同品牌只有集团与 admin 两条，集团在前', async () => {
    const { body } = await call('GET', '/api/brand-icons', { token: tokens.subB })
    const rows = rowsOf(body, '三来源品牌')
    expect(rows.map(r => r.source)).toEqual(['group', 'admin'])
  })

  it('D1 已解散集团不继承', async () => {
    const { body } = await call('GET', '/api/brand-icons', { token: tokens.subE })
    expect(rowsOf(body, '已解散品牌')).toHaveLength(0)
  })

  it('H1 成员关闭「允许集团拉取」仍继承（该开关只管上行拉取）', async () => {
    const { body } = await call('GET', '/api/brand-icons', { token: tokens.subC })
    const rows = rowsOf(body, '乙集团品牌')
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('group')
  })

  it('I1 无集团账号：只有「自己 + admin」两路，看不到任何集团的图标', async () => {
    const { body } = await call('GET', '/api/brand-icons', { token: tokens.outsider })
    const brands = new Set((body.icons || []).map(i => i.brand))
    expect(brands.has('散客自己的品牌')).toBe(true)
    expect(brands.has('平台共享品牌')).toBe(true)
    // 纯集团品牌：一条都不该看到
    for (const b of ['甲集团品牌', '乙集团品牌', '临时集团品牌', '已解散品牌']) {
      expect(rowsOf(body, b)).toHaveLength(0)
    }
    // 「三来源品牌」在 admin 侧也有一条 ⇒ 该条仍应可见，但**只能**看到 admin 那条
    expect(rowsOf(body, '三来源品牌').map(r => r.source)).toEqual(['admin'])
    // 总不变量：无集团账号的可见集合里不应出现任何 group 来源
    expect((body.icons || []).every(i => i.source !== 'group')).toBe(true)
  })

  it('J1 admin 视角：仍看得到全部图标（回归既有行为）', async () => {
    const { body } = await call('GET', '/api/brand-icons', { token: tokens.admin })
    const brands = new Set((body.icons || []).map(i => i.brand))
    expect(brands.has('散客自己的品牌')).toBe(true)
    expect(brands.has('甲集团品牌')).toBe(true)
    expect(brands.has('已解散品牌')).toBe(true)
  })
})

// ===========================================================================
describe('DELETE /api/brand-icons/:id —— 权限不放松', () => {
  it('G1 🔒 成员删不掉集团的图标（403），且该行仍在', async () => {
    const hqIcon = db.prepare(`SELECT * FROM brand_icons WHERE brand = '甲集团品牌'`).get()
    const res = await call('DELETE', `/api/brand-icons/${hqIcon.id}`, { token: tokens.subA })
    expect(res.status).toBe(403)
    expect(db.prepare(`SELECT COUNT(*) AS c FROM brand_icons WHERE id = ?`).get(hqIcon.id).c).toBe(1)
  })

  it('G2 成员能删自己上传的；删后该品牌回退为集团图', async () => {
    const before = await call('GET', '/api/brand-icons', { token: tokens.subA })
    expect(rowsOf(before.body, '可删品牌')[0].source).toBe('self')

    const res = await call('DELETE', `/api/brand-icons/${ids.deletableIcon}`, { token: tokens.subA })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const after = await call('GET', '/api/brand-icons', { token: tokens.subA })
    expect(rowsOf(after.body, '可删品牌')).toHaveLength(0)
  })
})

// ===========================================================================
describe('写路径与生命周期', () => {
  it('L1 POST 上传回包带 source=self（前端 store 靠它做本地定序）', async () => {
    const fd = new FormData()
    fd.append('brand', TEST_BRAND)
    fd.append('icon', new Blob([PNG_1PX], { type: 'image/png' }), 'unit.png')
    const res = await call('POST', '/api/brand-icons', { token: tokens.admin, form: fd })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.icon.source).toBe('self')
    expect(res.body.icon.user_id).toBe(Number(ids.admin))
    expect(res.body.icon.brand).toBe(TEST_BRAND)
    // 该图应立刻对成员可见，来源标 admin
    const seen = await call('GET', '/api/brand-icons', { token: tokens.subA })
    expect(rowsOf(seen.body, TEST_BRAND)[0].source).toBe('admin')
  })

  it('E1 被移出集团 ⇒ 继承立即消失（读时判定，无需清理任务）', async () => {
    const before = await call('GET', '/api/brand-icons', { token: tokens.subG })
    expect(rowsOf(before.body, '临时集团品牌')).toHaveLength(1)

    db.prepare(`DELETE FROM org_members WHERE user_id = ?`).run(ids.subG)

    const after = await call('GET', '/api/brand-icons', { token: tokens.subG })
    expect(rowsOf(after.body, '临时集团品牌')).toHaveLength(0)
  })
})
