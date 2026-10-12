/**
 * 「VIP 配色统一 + 过期态达标」守卫（v1.13.212 立）
 *
 * 背景（2026-10-12 及之前的遗留②）：
 *   1) 个人中心 `.vip-badge` 的 `.app-icon` 是**无条件**深金 ⇒「已过期」态
 *      底色/文字/边框都转红了，图标仍顶着金字（红底金字）。
 *   2) 同一个「VIP 身份」全站两套色：个人中心金色，后台 `.vip-role-tag` 紫色
 *      （且试用档还是 EP primary 蓝）⇒ 看起来像两种身份。
 *   3) 顺带实测出：两态文字色 #f56c6c(2.61:1) / #e6a23c(2.04:1) 本身就不过
 *      WCAG AA(4.5:1)，而 main.scss 的 a11y B 档（v1.13.176）当时只修了
 *      el-tag，**漏了这个自建徽章**。
 *
 * 修法：统一到「深金 #8a5e00」——⛔ 不能用徽章旧色 #b8860b，它 on #fff7e6 只有
 *   3.05:1，且 #b8860b 在任何浅底上都到不了 4.5（它本身过亮），不能当统一基准。
 *   红/橙告警取 main.scss a11y B 档已定的同款达标值 #b91c1c / #916012。
 *
 * 本文件是**回归钉子**，四条线各自会红：
 *   ① 谁把前后台 VIP 金改成两个不同值（又分叉）→ 红
 *   ② 谁把金色改回 #b8860b / 紫色改回 #7c3aed → 红
 *   ③ 谁删掉「图标随状态变色」的两条规则，或让图标色与同态文字色不一致 → 红
 *   ④ 谁把颜色改成一个对比度 < 4.5:1 的值 → 红（测试内**实算**，不是抄注释里的数字）
 * （前端无独立测试框架，故与 vipGateGuard / tokenVersionRoleChangeGuard 一致挂在 backend vitest 下。）
 *
 * ⚠️ 设计取舍：本文件**不用**「剥注释后再全文正则」的路子 —— 上一批（211）在那条路上
 *   踩过坑（裸正则把字符串里的 `/import/*` 与真块注释配成对，静默吃掉 70 行 → 假绿）。
 *   这里改为**按选择器做花括号配对切片**，只断言规则体内那几行声明；注释天然在体外，
 *   既不会被误判、也不会自伤（注释里恰好写着 #b8860b / #7c3aed 这些「反面例子」）。
 *   另配「切片自检」，防止 indexOf 落空后把空串当通过。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/** ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，pathname 会留下百分号编码导致 ENOENT */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src')

const readFrontend = (rel) => fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8')

const ACCOUNT = 'views/MyAccountView.vue'
const USERS = 'views/UsersView.vue'

// ===== 期望值（唯一权威）=====
const GOLD = '#8a5e00' // VIP 家族统一金（文字＝图标）
const DANGER = '#b91c1c' // 已过期（与 main.scss a11y B 档同值）
const WARN = '#916012' // 30 天内到期（同上）

/**
 * 按选择器做花括号配对，取出规则体（不含注释——注释在体外）。
 * @returns {string|null} 规则体；找不到配对则返回 null
 */
function styleBlock(src, selector) {
  const start = src.indexOf(selector)
  if (start === -1) return null
  const open = src.indexOf('{', start)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}

/** 取声明值（`color` 不会误命中 `border-color`：前置字符是 `-`，不满足边界） */
function decl(block, prop) {
  const m = block.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+);`))
  return m ? m[1].trim() : null
}

const hexes = (s) => (s || '').match(/#[0-9a-f]{6}/gi) || []

// ===== WCAG 2.x 相对亮度 / 对比度（实算，非引用）=====
const srgb = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255)
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
function luminance(h) {
  const [r, g, b] = srgb(h).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}
const AA = 4.5

// ===== 切片 =====
const account = readFrontend(ACCOUNT)
const users = readFrontend(USERS)

const badge = styleBlock(account, '.vip-badge {')
const badgeIcon = styleBlock(account, '.vip-badge .app-icon {')
const badgeExpired = styleBlock(account, '.vip-badge.vip-expired {')
const badgeExpiring = styleBlock(account, '.vip-badge.vip-expiring {')
const badgeExpiredIcon = styleBlock(account, '.vip-badge.vip-expired .app-icon {')
const badgeExpiringIcon = styleBlock(account, '.vip-badge.vip-expiring .app-icon {')

const roleTag = styleBlock(users, '.vip-role-tag {')
const usedExpired = styleBlock(users, '.vip-expired {')
const usedExpiring = styleBlock(users, '.vip-expiring {')

describe('VIP 配色统一（v1.13.212）· 切片自检', () => {
  it('9 个规则块全部取到，且各自含 color 声明（防 indexOf 落空当通过）', () => {
    const blocks = {
      badge,
      badgeIcon,
      badgeExpired,
      badgeExpiring,
      badgeExpiredIcon,
      badgeExpiringIcon,
      roleTag,
      usedExpired,
      usedExpiring,
    }
    for (const [name, b] of Object.entries(blocks)) {
      expect(b, `${name} 未取到规则体（选择器改了？）`).toBeTruthy()
      expect(b.length, `${name} 规则体异常（过短/过长）`).toBeGreaterThan(10)
      expect(decl(b, 'color'), `${name} 缺 color 声明`).toBeTruthy()
    }
  })
})

describe('VIP 配色统一（v1.13.212）· 前后台同一个金', () => {
  it('个人中心徽章与后台角色标签用同一个金（含大小写归一）', () => {
    const a = decl(badge, 'color').toLowerCase()
    const b = decl(roleTag, 'color').toLowerCase()
    expect(a, '前后台 VIP 金分叉了').toBe(b)
    expect(a).toBe(GOLD)
  })

  it('⛔ 金色不得退回 #b8860b（on #fff7e6 仅 3.05:1，过不了 AA）', () => {
    expect(decl(badge, 'color').toLowerCase()).not.toBe('#b8860b')
    expect(decl(roleTag, 'color').toLowerCase()).not.toBe('#b8860b')
    expect(badge.toLowerCase()).not.toContain('#b8860b')
    expect(roleTag.toLowerCase()).not.toContain('#b8860b')
  })

  it('⛔ 后台角色标签不得退回紫色（#7c3aed / #f3e8ff / #d8b4fe）', () => {
    const body = roleTag.toLowerCase()
    for (const bad of ['#7c3aed', '#f3e8ff', '#d8b4fe']) {
      expect(body, `角色标签又出现了旧的紫 ${bad}`).not.toContain(bad)
    }
  })

  it('试用（trial）也走金色角色标签 —— 列表列 + 审核弹窗两处都要覆盖', () => {
    // 精确匹配属性值本身，避免命中到注释里那句「trial 也纳入 .vip-role-tag」
    expect(users).toMatch(
      /:class="\{ 'vip-role-tag': row\.role === 'vip' \|\| row\.role === 'trial' \}"/
    )
    expect(users).toMatch(
      /:class="\{ 'vip-role-tag': row\.current_role === 'vip' \|\| row\.current_role === 'trial' \}"/
    )
  })
})

describe('VIP 配色统一（v1.13.212）· 图标随状态变色', () => {
  it('基础态：图标与文字同色（不再是「文字金、图标另一个金」）', () => {
    expect(decl(badgeIcon, 'color').toLowerCase()).toBe(decl(badge, 'color').toLowerCase())
  })

  it('已过期态：文字与图标同为 DANGER', () => {
    expect(decl(badgeExpired, 'color').toLowerCase()).toBe(DANGER)
    expect(decl(badgeExpiredIcon, 'color').toLowerCase()).toBe(DANGER)
  })

  it('临期态：文字与图标同为 WARN', () => {
    expect(decl(badgeExpiring, 'color').toLowerCase()).toBe(WARN)
    expect(decl(badgeExpiringIcon, 'color').toLowerCase()).toBe(WARN)
  })

  it('★ 反向保护：带状态的选择器权重必须压过无条件那条（否则图标恒金=修复失效）', () => {
    // `.vip-badge.vip-expired .app-icon` = 3 类 + scope 属性 ⇒ 比
    // `.vip-badge .app-icon`（2 类 + 属性）高，故与书写顺序无关。这里只钉住「真的写成了复合类」。
    expect(account).toContain('.vip-badge.vip-expired .app-icon {')
    expect(account).toContain('.vip-badge.vip-expiring .app-icon {')
  })
})

describe('VIP 配色统一（v1.13.212）· 对比度实算 ≥ 4.5:1', () => {
  it('个人中心徽章：文字压在金渐变的两端都达标', () => {
    const fg = decl(badge, 'color')
    const stops = hexes(decl(badge, 'background'))
    expect(stops.length, '徽章 background 应能解析出渐变的两端色').toBeGreaterThanOrEqual(2)
    for (const bg of stops) {
      const v = contrast(fg, bg)
      expect(v, `${fg} on ${bg} = ${v.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('已过期 / 临期态：文字压自家浅底达标（a11y B 档漏掉的自建徽章）', () => {
    for (const [block, label] of [
      [badgeExpired, '已过期'],
      [badgeExpiring, '临期'],
    ]) {
      const fg = decl(block, 'color')
      const bg = hexes(decl(block, 'background'))[0]
      const v = contrast(fg, bg)
      expect(v, `${label} ${fg} on ${bg} = ${v.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('后台角色标签：文字压自家浅底达标', () => {
    const fg = decl(roleTag, 'color')
    const bg = hexes(decl(roleTag, 'background'))[0]
    const v = contrast(fg, bg)
    expect(v, `${fg} on ${bg} = ${v.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
  })

  it('后台「VIP到期日」两态文字压在表格白底上达标', () => {
    for (const [block, label] of [
      [usedExpired, '已过期'],
      [usedExpiring, '临期'],
    ]) {
      const fg = decl(block, 'color')
      const v = contrast(fg, '#ffffff')
      expect(v, `${label} ${fg} on #fff = ${v.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
    }
  })
})
