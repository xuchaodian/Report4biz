/**
 * VIP 到期「展示层」单一入口守卫 —— v1.13.215
 *
 * 背景（214 遗留 ①）：
 *   `utils/vipUntil.js`（v1.13.213）当时**只收了门禁判据**，**展示层**仍留 5~6 处就地实现：
 *     · `MyAccountView`：vipUntilText / vipExpired / vipDaysLeft / vipExpiring
 *     · `UsersView`    ：isVipExpiring / isVipExpired / form.vipUntilText 的「长期有效」回退
 *   其中硬编码 `'T23:59:59'` **4 处**、角色白名单 `role!=='vip'&&role!=='trial'` **重复 2 遍**
 *   ⇒ 「同一判据多处拷贝必然分叉」的第 N 次温床。v1.13.213 的注释原话是
 *   「若日后要收敛，请先补展示回归测试再合并」—— **本文件即那个测试**。
 *
 * 🔴 本批含**两项有意变化**（必读，否则会把它们误判成回归）：
 *   【A. 归一化】旧 `UsersView::isVipExpiring` 只判 `days >= 0 && days <= 30`，**缺 `!expired` 守卫**；
 *      而 `days` 用 `Math.ceil` ⇒ **到期日的次日整整一天内 `days` 仍为 0**
 *      （`d - now ∈ (-86400000, 0]`）⇒ 该行**同时**显示「⏰ 临期」与「❌ 已过期」。
 *      新版统一为**三档互斥**（已过期 / 临期 / 正常）；`MyAccountView` 原本就带 `!vipExpired`
 *      ⇒ 两页统一到更正确的那个。
 *   【B. 加固】旧实现遇**非法日期串**时 `Math.ceil(NaN)` ⇒ `NaN` ⇒ 模板显示「剩余 NaN 天」；
 *      新版 `vipDaysRemaining` 统一返回 `null`。
 *   两者都用「声明的差异集」钉死：任何**其它**差异会立即变红。
 *
 * 前端无独立测试框架，故与 vipUntilParity.test.js 一致，挂在 backend 的 vitest 下
 * （跨目录读前端源码 + dynamic import 前端纯函数）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * ⚠️ 必须用 fileURLToPath 而不是 `new URL(...).pathname` —— 本项目路径含中文与空格，
 *    pathname 会留下百分号编码，导致 fs 报 ENOENT。
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src')

const VIP_UTIL = path.join(FRONTEND_SRC, 'utils/vipUntil.js')
const MY_ACCOUNT = path.join(FRONTEND_SRC, 'views/MyAccountView.vue')
const USERS_VIEW = path.join(FRONTEND_SRC, 'views/UsersView.vue')

const read = (p) => fs.readFileSync(p, 'utf8')

/** 剥注释再断言 —— 否则注释里的「举例」会自伤（v1.13.208 踩过） */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** 递归收集源码文件（跳过 node_modules / dist*） */
function collect(dir, exts, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('dist.')) continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) collect(p, exts, out)
    else if (exts.some((e) => name.endsWith(e))) out.push(p)
  }
  return out
}

const loadUtil = async () => {
  expect(fs.existsSync(VIP_UTIL), `缺少前端单一判据文件：${VIP_UTIL}`).toBe(true)
  return import(pathToFileURL(VIP_UTIL).href)
}

// ---------------------------------------------------------------------------
// 旧实现 oracle —— 逐字复刻 v1.13.214 时的就地代码，作为「行为不变」的基准
// ---------------------------------------------------------------------------
const SUF = 'T23:59:59'
const DAY = 86400000

// —— 旧 MyAccountView ——
const oldVipDaysLeft = (u, now) => (!u ? null : Math.ceil((new Date(String(u) + SUF) - now) / DAY))
const oldVipExpired = (u, now) => (!u ? false : new Date(String(u) + SUF) < now)
const oldVipExpiring = (u, now) => {
  const d = oldVipDaysLeft(u, now)
  return d !== null && !oldVipExpired(u, now) && d >= 0 && d <= 30
}
const oldVipUntilText = (u) => {
  if (!u) return '长期有效'
  const d = new Date(String(u))
  if (isNaN(d.getTime())) return String(u).slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
// —— 旧 UsersView（🔴 缺 !expired，即被归一化的那一版）——
const oldUsersViewExpiring = (row, now) => {
  if ((row.role !== 'vip' && row.role !== 'trial') || !row.vip_until) return false
  const until = new Date(String(row.vip_until) + SUF)
  const days = Math.ceil((until - now) / DAY)
  return days >= 0 && days <= 30
}
const oldUsersViewExpired = (row, now) => {
  if ((row.role !== 'vip' && row.role !== 'trial') || !row.vip_until) return false
  return new Date(String(row.vip_until) + SUF) < now
}

/** 固定「现在」，让所有边界可复现 */
const NOW = new Date('2026-10-13T10:00:00')

/** 声明的差异样本（⛔ 不得扩大） */
const NORM_SAMPLE = '到期日次日(days=0 但已过期) ← 归一化点'
const BAD_DATE_SAMPLE = '非法日期串'

const SAMPLES = [
  { name: '无到期日(长期有效)', vip_until: null },
  { name: '远期未过期', vip_until: '2030-01-01' },
  { name: NORM_SAMPLE, vip_until: '2026-10-12' },
  { name: '今天到期(临期)', vip_until: '2026-10-13' },
  { name: '明天到期', vip_until: '2026-10-14' },
  { name: '临期边界=30 天', vip_until: '2026-11-11' },
  { name: '超出边界=31 天', vip_until: '2026-11-12' },
  { name: '早已过期', vip_until: '2020-01-01' },
  { name: BAD_DATE_SAMPLE, vip_until: 'not-a-date' }
]

// ---------------------------------------------------------------------------
// ① 源码级：展示层不得再内联到期表达式
// ---------------------------------------------------------------------------
describe('展示层：不得再内联到期表达式（必须复用 utils/vipUntil.js）', () => {
  it('MyAccountView 不得内联 T23:59:59，且必须 import utils/vipUntil', () => {
    const src = stripComments(read(MY_ACCOUNT))
    expect(src, 'MyAccountView 又抄了一份到期表达式').not.toMatch(/T23:59:59/)
    expect(src, 'MyAccountView 必须 import utils/vipUntil').toMatch(/utils\/vipUntil/)
  })

  it('UsersView 不得内联 T23:59:59，且必须 import utils/vipUntil', () => {
    const src = stripComments(read(USERS_VIEW))
    expect(src, 'UsersView 又抄了一份到期表达式').not.toMatch(/T23:59:59/)
    expect(src, 'UsersView 必须 import utils/vipUntil').toMatch(/utils\/vipUntil/)
  })

  it('UsersView 不得再内联「仅 vip/trial 参与展示」的角色白名单', () => {
    const src = stripComments(read(USERS_VIEW))
    expect(
      src,
      "出现 row.role !== 'vip' && row.role !== 'trial' ⇒ 角色档位又抄了一份"
    ).not.toMatch(/row\.role\s*!==\s*'vip'\s*&&\s*row\.role\s*!==\s*'trial'/)
  })

  it('全前端源码中 T23:59:59 只允许出现在 utils/vipUntil.js 一处', () => {
    const files = collect(FRONTEND_SRC, ['.js', '.vue'])
    const hits = files
      .filter((p) => p !== VIP_UTIL)
      .filter((p) => /T23:59:59/.test(stripComments(read(p))))
      .map((p) => path.relative(FRONTEND_SRC, p))
    expect(hits, `到期表达式又扩散到这些文件（应只有 utils/vipUntil.js）:\n${hits.join('\n')}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ② 行为级：新单一口径 ≡ 旧就地实现（逐条比对）
// ---------------------------------------------------------------------------
describe('展示层：新单一口径与旧实现逐条同输出', () => {
  it('utils/vipUntil.js 必须导出展示层 6 个成员与 2 个常量', async () => {
    const m = await loadUtil()
    for (const k of [
      'vipDaysRemaining',
      'isVipExpiredFor',
      'isVipExpiringFor',
      'formatVipUntil',
      'isVipExpiringByRole',
      'isVipExpiredByRole'
    ]) {
      expect(typeof m[k], `必须导出 ${k}`).toBe('function')
    }
    expect(m.VIP_EXPIRING_ROLES, '必须导出 VIP_EXPIRING_ROLES').toEqual(['vip', 'trial'])
    expect(m.VIP_EXPIRING_DAYS, '必须导出 VIP_EXPIRING_DAYS').toBe(30)
  })

  it('vipDaysRemaining ≡ 旧 vipDaysLeft（合法样本全部一致）', async () => {
    const m = await loadUtil()
    const diff = SAMPLES.filter((s) => s.name !== BAD_DATE_SAMPLE).filter(
      (s) => m.vipDaysRemaining(s.vip_until, NOW) !== oldVipDaysLeft(s.vip_until, NOW)
    )
    expect(diff.map((s) => s.name), '剩余天数算法漂移').toEqual([])
  })

  it('🔴 加固（已声明）：非法日期串 ⇒ 剩余天数返回 null（旧实现为 NaN）', async () => {
    const m = await loadUtil()
    expect(Number.isNaN(oldVipDaysLeft('not-a-date', NOW)), '旧实现确实产 NaN').toBe(true)
    expect(m.vipDaysRemaining('not-a-date', NOW), '新实现归一为 null').toBe(null)
    expect(m.isVipExpiredFor('not-a-date', NOW), '非法串不判过期').toBe(false)
    expect(m.isVipExpiringFor('not-a-date', NOW), '非法串不判临期').toBe(false)
  })

  it('isVipExpiredFor ≡ 旧 vipExpired（全部样本）', async () => {
    const m = await loadUtil()
    const diff = SAMPLES.filter((s) => m.isVipExpiredFor(s.vip_until, NOW) !== oldVipExpired(s.vip_until, NOW))
    expect(diff.map((s) => s.name), '过期判据漂移').toEqual([])
  })

  it('isVipExpiringFor ≡ 旧 MyAccountView::vipExpiring（含 !expired，全部样本）', async () => {
    const m = await loadUtil()
    const diff = SAMPLES.filter((s) => m.isVipExpiringFor(s.vip_until, NOW) !== oldVipExpiring(s.vip_until, NOW))
    expect(diff.map((s) => s.name), '临期判据漂移').toEqual([])
  })

  it('formatVipUntil ≡ 旧 vipUntilText（全部样本）', async () => {
    const m = await loadUtil()
    const diff = SAMPLES.filter((s) => m.formatVipUntil(s.vip_until) !== oldVipUntilText(s.vip_until))
    expect(diff.map((s) => s.name), '到期日文案漂移').toEqual([])
  })

  it('isVipExpiredByRole ≡ 旧 UsersView::isVipExpired（四角色 × 全样本，零差异）', async () => {
    const m = await loadUtil()
    const diff = []
    for (const role of ['vip', 'trial', 'admin', 'user']) {
      for (const s of SAMPLES) {
        const row = { role, vip_until: s.vip_until }
        if (m.isVipExpiredByRole(row, NOW) !== oldUsersViewExpired(row, NOW)) diff.push(`${role}/${s.name}`)
      }
    }
    expect(diff, '带角色的过期判据漂移').toEqual([])
  })

  it('isVipExpiringByRole ≡ 旧 UsersView::isVipExpiring，差异**只允许**是已声明的归一化', async () => {
    const m = await loadUtil()
    const diff = []
    for (const role of ['vip', 'trial', 'admin', 'user']) {
      for (const s of SAMPLES) {
        const row = { role, vip_until: s.vip_until }
        const nv = m.isVipExpiringByRole(row, NOW)
        const ov = oldUsersViewExpiring(row, NOW)
        if (nv !== ov) diff.push(`${role}/${s.name}: 新=${nv} 旧=${ov}`)
      }
    }
    // ⚠️ 这条是**唯一**允许的差异：vip 与 trial 在「到期日次日」被归一化掉
    expect(diff, '除已声明的归一化外，不允许任何其它差异').toEqual([
      `vip/${NORM_SAMPLE}: 新=false 旧=true`,
      `trial/${NORM_SAMPLE}: 新=false 旧=true`
    ])
  })
})

// ---------------------------------------------------------------------------
// ③ 归一化钉子：把「有意变化」本身钉死
// ---------------------------------------------------------------------------
describe('🔴 归一化钉子：三档必须互斥（已过期 / 临期 / 正常）', () => {
  it('days=0 但已过期 ⇒ 判「已过期」，⛔ 不得同时判「临期」', async () => {
    const m = await loadUtil()
    expect(m.vipDaysRemaining('2026-10-12', NOW), '算术仍是 0（复现旧实现的成因）').toBe(0)
    expect(m.isVipExpiredFor('2026-10-12', NOW)).toBe(true)
    expect(m.isVipExpiringFor('2026-10-12', NOW), '归一化点：必须为 false').toBe(false)
    expect(oldUsersViewExpiring({ role: 'vip', vip_until: '2026-10-12' }, NOW), '旧实现确实为 true').toBe(true)
  })

  it('真的今天到期 ⇒ 仍须判「临期」（不得被归一化误伤）', async () => {
    const m = await loadUtil()
    expect(m.isVipExpiredFor('2026-10-13', NOW)).toBe(false)
    expect(m.isVipExpiringFor('2026-10-13', NOW)).toBe(true)
  })

  it('31 天 ⇒ 不临期；30 天 ⇒ 临期（阈值边界）', async () => {
    const m = await loadUtil()
    expect(m.vipDaysRemaining('2026-11-11', NOW)).toBe(30)
    expect(m.isVipExpiringFor('2026-11-11', NOW)).toBe(true)
    expect(m.vipDaysRemaining('2026-11-12', NOW)).toBe(31)
    expect(m.isVipExpiringFor('2026-11-12', NOW)).toBe(false)
  })

  it('剩余天数不得返回 -0（Math.ceil 的坑，已归一）', async () => {
    const m = await loadUtil()
    expect(Object.is(m.vipDaysRemaining('2026-10-12', NOW), -0), '不得是 -0').toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ④ 角色档位：admin 刻意不参与「到期提醒」展示
// ---------------------------------------------------------------------------
describe('角色档位：admin 不参与临期/过期展示（与门禁白名单刻意不同）', () => {
  it('VIP_ROLES（门禁，含 admin）≠ VIP_EXPIRING_ROLES（展示，不含 admin）', async () => {
    const m = await loadUtil()
    expect(m.VIP_ROLES, '门禁白名单含 admin').toEqual(['vip', 'trial', 'admin'])
    expect(m.VIP_EXPIRING_ROLES, '展示白名单不含 admin').toEqual(['vip', 'trial'])
  })

  it('admin 即便带日期，也不得被判临期/过期展示', async () => {
    const m = await loadUtil()
    const row = { role: 'admin', vip_until: '2020-01-01' }
    expect(m.isVipExpiringByRole(row, NOW)).toBe(false)
    expect(m.isVipExpiredByRole(row, NOW)).toBe(false)
    // ⚠️ 门禁侧与后端一字不差：「**空** vip_until ⇒ 长期有效」；但若 admin 被写了一个
    //    历史过期日期，同样按过期处理 —— 这是**既有语义**（非本批引入），
    //    跨端一致性由 vipUntilParity.test.js 的 11 组样本钉死。
    expect(m.isVipRoleActive({ role: 'admin', vip_until: null }, NOW), 'admin 无到期日 ⇒ 放行').toBe(true)
    expect(m.isVipRoleActive({ role: 'admin', vip_until: '2030-01-01' }, NOW), 'admin 未过期 ⇒ 放行').toBe(true)
    expect(m.isVipRoleActive(row, NOW), 'admin 带历史过期值 ⇒ 与后端一致地不放行').toBe(false)
  })
})
