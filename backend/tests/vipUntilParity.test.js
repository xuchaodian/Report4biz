/**
 * VIP 门禁「前后端同口径」守卫 —— v1.13.213
 *
 * 背景（211/212 挂账的遗留 B）：
 *   后端 `utils/aiQuota.js::isVipActive` **读 vip_until 有效期**：
 *     `if (!user.vip_until) return true; return new Date(String(user.vip_until) + 'T23:59:59') >= now`
 *   而前端 `stores/user.js::isVipActive`（v1.13.208 抽出的「全站唯一来源」）**只看角色**：
 *     `['vip','trial','admin'].includes(state.user?.role)`
 *   ⇒ **正式 vip 到期后**（role 恒 'vip'、vip_until 已过）：
 *     前端 6 处门禁全部放行（`MainLayout` 的 🔒VIP 角标不显示、销售预测空态不出现），
 *     用户点进去才被**后端 403** ⇒「能点但报错」。
 *
 * 🔴 为什么这条缺陷能长期存活 —— 老守卫是**假绿灯**：
 *   `vipGateGuard.test.js` 里那个 describe 名叫「前后端 isVipActive 口径必须一致」，
 *   实际只断言了**两端源码里的角色白名单字面量**：
 *     · 前端须含 `['vip','trial','admin']`
 *     · 后端须含 `role !== 'vip' && role !== 'trial' && role !== 'admin'`
 *   ⇒ **`vip_until` 有效期判定完全不在断言域** ⇒ 漏读该字段，测试照样全绿。
 *   「宣称的安全网」远大于「实际覆盖」。
 *
 * 本文件改做**行为级**断言：把两侧判据都用**同一批真实样本**跑一遍，逐条比对输出。
 * 关键点：**断言的是「两侧一致」，不是「某种业务语义」** —— 这样既不越界规定产品行为，
 *   又能把任何一侧的漂移立刻钉红。另对 B 的核心样本（vip 已过期）单独钉死为 false。
 *
 * 本文件是回归钉子：
 *   ① 前端门禁退回「只看角色」→ 立刻红；
 *   ② 两侧判据在任一真实样本上输出不同 → 立刻红；
 *   ③ 前端又内联重写到期表达式（绕开 utils/vipUntil.js）→ 立刻红；
 *   ④ `PUT /users/me` 回包再丢 vip_until（会让门禁在「保存个人资料」之后静默失效）→ 立刻红。
 *
 * 前端无独立测试框架，故与 cspInlineHandlerGuard.test.js / vipColorUnifyGuard.test.js 一致，
 * 挂在 backend 的 vitest 下（跨目录读前端源码 + dynamic import 前端纯函数）。
 */
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 🔴 必须在 import 任何后端模块**之前**把库路径指到临时文件。
 *   原因：`utils/aiQuota.js` 会拉起 `models/database.js`，而后者**顶层**就 `await initDatabase()`
 *   ⇒ 不设本变量就会打开真实 dev 库并可能写盘。本测试只需要纯函数，不需要库内容。
 */
const tmpDb = path.join(os.tmpdir(), `r4b-vipuntil-parity-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

afterAll(() => {
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

/**
 * 仓库根（backend/ 的上一级）。
 * ⚠️ 必须用 fileURLToPath 而不是 `new URL(...).pathname` —— 本项目路径含中文与空格，
 *    pathname 会留下百分号编码，导致 fs 报 ENOENT。
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src')

const STORE = path.join(FRONTEND_SRC, 'stores/user.js')
const VIP_UTIL = path.join(FRONTEND_SRC, 'utils/vipUntil.js')
const AI_QUOTA = path.join(REPO_ROOT, 'backend/src/utils/aiQuota.js')
const USERS_ROUTE = path.join(REPO_ROOT, 'backend/src/routes/users.js')

/** 剥掉注释再断言 —— 否则注释里的「举例」会自伤（v1.13.208 踩过） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const read = (p) => fs.readFileSync(p, 'utf8')

// ---------------------------------------------------------------------------
// ① 源码级：前端门禁不得只看角色
// ---------------------------------------------------------------------------
describe('前端 VIP 门禁：判据必须含 vip_until 有效期', () => {
  const src = stripComments(read(STORE))

  it('stores/user.js::isVipActive 必须复用 utils/vipUntil.js 的单一判据（不得内联白名单）', () => {
    // ⚠️ 只断言**语义**，不规定写法：getter 写成单行箭头还是多行花括号都行。
    //    否则测试会退化成「代码风格检查」（本次首版断言即犯此错）。
    const line = src.split('\n').find((l) => /isVipActive\s*:\s*\(state\)\s*=>/.test(l))
    expect(line, '未找到 isVipActive getter').toBeTruthy()
    expect(line, '必须调用 isVipRoleActive(state.user) —— 门禁判据的唯一来源').toMatch(
      /isVipRoleActive\(state\.user\)/
    )
    expect(line, '不得再内联角色白名单（那正是遗留 B 的形态）').not.toMatch(/'vip'/)
  })

  it('stores/user.js 不得内联重写到期的日期表达式（必须复用 utils/vipUntil.js）', () => {
    expect(src, '出现 T23:59:59 字面量 ⇒ 又抄了一份到期表达式').not.toMatch(/T23:59:59/)
    expect(src, '必须 import utils/vipUntil.js').toMatch(/utils\/vipUntil/)
  })
})

// ---------------------------------------------------------------------------
// ② 行为级：同一批样本，两侧逐条同输出
// ---------------------------------------------------------------------------
const SAMPLES = [
  { name: 'vip 未过期',          u: { role: 'vip',   vip_until: '2030-01-01' } },
  { name: 'vip 已过期 ← 遗留B',  u: { role: 'vip',   vip_until: '2020-01-01' } },
  { name: 'vip 无到期日(长期)',  u: { role: 'vip',   vip_until: null } },
  { name: 'trial 未过期',        u: { role: 'trial', vip_until: '2030-01-01' } },
  { name: 'trial 已过期',        u: { role: 'trial', vip_until: '2020-01-01' } },
  { name: 'trial 无到期日',      u: { role: 'trial', vip_until: null } },
  { name: 'admin 无到期日',      u: { role: 'admin', vip_until: null } },
  { name: 'admin 有历史过期值',  u: { role: 'admin', vip_until: '2020-01-01' } },
  { name: 'user 却带未来日期',   u: { role: 'user',  vip_until: '2030-01-01' } },
  { name: 'user 普通',           u: { role: 'user',  vip_until: null } },
  { name: '空用户',              u: null }
]

describe('前后端 VIP 门禁：行为级同口径', () => {
  it('utils/vipUntil.js 必须导出纯函数 isVipRoleActive', async () => {
    expect(fs.existsSync(VIP_UTIL), `缺少前端单一判据文件：${VIP_UTIL}`).toBe(true)
    const mod = await import(pathToFileURL(VIP_UTIL).href)
    expect(typeof mod.isVipRoleActive, '必须导出 isVipRoleActive').toBe('function')
  })

  it('同一批样本：前端 isVipRoleActive ≡ 后端 isVipActive（逐条比对）', async () => {
    const front = await import(pathToFileURL(VIP_UTIL).href)
    const back = await import(pathToFileURL(AI_QUOTA).href)
    const f = front.isVipRoleActive
    const b = back.isVipActive

    const diff = []
    for (const s of SAMPLES) {
      const fv = f(s.u)
      const bv = b(s.u)
      if (fv !== bv) diff.push(`  · ${s.name}：前端=${fv} / 后端=${bv}`)
    }
    expect(diff, `前后端口径分叉（前端应以后端为基准）：\n${diff.join('\n')}`).toEqual([])
  })

  it('B 的核心样本钉死：正式 vip 已过期 ⇒ 前端必须判 false（不得放行）', async () => {
    const front = await import(pathToFileURL(VIP_UTIL).href)
    expect(front.isVipRoleActive({ role: 'vip', vip_until: '2020-01-01' })).toBe(false)
    expect(front.isVipRoleActive({ role: 'trial', vip_until: '2020-01-01' })).toBe(false)
    // 未过期 / 无到期日 仍须放行
    expect(front.isVipRoleActive({ role: 'vip', vip_until: '2030-01-01' })).toBe(true)
    expect(front.isVipRoleActive({ role: 'vip', vip_until: null })).toBe(true)
  })

  it('三角色覆盖：vip / trial / admin 有效期内均放行、已过期均与后端一致', async () => {
    // v1.13.213：本条**接住**被移走的那条字面量断言。
    // 原先 vipGateGuard.test.js 只断言「getter 源码里字面写着 ['vip','trial','admin']」，
    // 属字面量匹配、对 vip_until 无感（遗留 B 正是因此长期绿着）。
    // 这里改用**行为**验证，且比原断言更强 —— 同时覆盖「已过期」侧。
    const front = await import(pathToFileURL(VIP_UTIL).href)
    const back = await import(pathToFileURL(AI_QUOTA).href)
    for (const role of ['vip', 'trial', 'admin']) {
      expect(front.isVipRoleActive({ role, vip_until: '2030-01-01' }), `${role} 有效期内`).toBe(true)
      expect(front.isVipRoleActive({ role, vip_until: null }), `${role} 无到期日`).toBe(true)
      // 过期侧只要求「与后端一致」，不在此处规定业务语义
      expect(front.isVipRoleActive({ role, vip_until: '2020-01-01' }), `${role} 已过期`).toBe(
        back.isVipActive({ role, vip_until: '2020-01-01' })
      )
    }
  })

  it('后端判据本身未漂移（表达式结构守卫）', () => {
    const src = stripComments(read(AI_QUOTA))
    expect(src).toMatch(/if\s*\(\s*!user\.vip_until\s*\)\s*return\s+true/)
    expect(src).toMatch(/new Date\(String\(user\.vip_until\)\s*\+\s*'T23:59:59'\)\s*>=\s*now/)
  })
})

// ---------------------------------------------------------------------------
// ③ 数据通路：PUT /users/me 必须回带 vip_until
// ---------------------------------------------------------------------------
describe('vip_until 数据通路：PUT /users/me 不得丢字段', () => {
  const src = stripComments(read(USERS_ROUTE))

  it('PUT /users/me 回带的 user 必须含 vip_until', () => {
    expect(
      src,
      'PUT /users/me 的 SELECT 缺 vip_until ⇒ 用户保存一次个人资料，前端 user 就丢该字段，\n' +
        '门禁会回退到「长期有效」而静默失效。必须补上。'
    ).toMatch(/SELECT id, username, email, role, vip_until, company, logo, created_at FROM users/)
  })

  it('不得再出现缺 vip_until 的那个 SELECT 变体', () => {
    expect(src).not.toMatch(/SELECT id, username, email, role, company, logo, created_at FROM users/)
  })
})
