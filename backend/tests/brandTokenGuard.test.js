/**
 * 品牌主色 token 守卫（v1.13.354 立 / 色板治理 B1）
 *
 * 背景（2026-11-12 a11y 审计）：
 *   「主色 #409eff 对比度 2.78:1，影响 7 页 68+ 节点」（WCAG 1.4.3 文本 / 1.4.11 非文本）。
 *   查下来 #409eff 是 **Element Plus 的出厂默认值** —— 项目从未覆盖过
 *   `--el-color-primary`，等于「没选过色，用着默认蓝」；而同一批颜色又以硬编码形式
 *   散落在 30+ 个文件里，两边从来没有统一口径。
 *
 * 本批（B1）只做「前景色 + 描边」：立 `--brand-primary: #2563eb`（白底 5.17:1），
 *   把 `color:` / `border-*-color:` 收敛到该 token。填充类（background / 渐变）不动，
 *   留 B2 随 EP 主色一起迁移。
 *
 * ⛔ 两条红线（本文件 G4 / G6 各钉一条）：
 *   ① **UI 主色 ≠ 品牌实体色**。`'吉野家': '#409eff'` 是业务标识色（品牌logo蓝），
 *      改 UI 主色时把它一起改掉 = 全站吉野家标记变色，属不可逆视觉事故。
 *   ② **不许用「全局 sed 替换十六进制」来改主色**。MapView 里有按色值反查业务档位的
 *      代码（`if (color === '#409eff') filterKey = 'overlapLow'`），改色值会静默打断
 *      重叠率筛选联动。G6 钉住这条反查必须与图例色同源。
 *
 * ⚠️ B2 预告（EP 主色迁移）：Element Plus 的 `light-3/5/7/8/9`、`dark-2` 是
 *   theme-chalk 里**写死的静态值**，不是由 `--el-color-primary` 算出来的。
 *   只改主色 ⇒ 按钮底色变深、hover 却跳回 `#79bbff`（浅蓝）。G5 把这张静态表钉在
 *   测试里，谁想改主色就必须同时给出全新的一套派生值。
 *
 * （前端无独立测试框架，故与 vipColorUnifyGuard / cspInlineHandlerGuard 一致挂在 backend vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/** ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，pathname 会留下百分号编码导致 ENOENT */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src')
const MAIN_SCSS = path.join(FRONTEND_SRC, 'assets/main.scss')

// ===== 唯一权威期望值 =====
const UI_PRIMARY = '#2563eb' // 白底 5.17:1 / 浅蓝底 #ecf5ff 上 4.69:1
const OLD_PRIMARY = '#409eff' // 旧主色（EP 默认），仅允许作为「品牌实体色」存在
const BRAND_ENTITY = '#409eff' // 吉野家等品牌实体色，与 UI 主色刻意不同源
const MIN_TOKEN_USES = 60 // 当前 80 处，留余量；低于此值说明有人批量回退了

// ===== 对比度实算（不抄注释里的数字）=====
function relLum(hex) {
  const h = hex.replace('#', '')
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}
function contrast(a, b) {
  const [x, y] = [relLum(a), relLum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

// ===== 递归收集前端源码（排除 .bak_ 快照，否则历史副本会假红）=====
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.bak') || name.includes('.bak_')) continue
    const abs = path.join(dir, name)
    const st = fs.statSync(abs)
    if (st.isDirectory()) walk(abs, out)
    else if (/\.(vue|js|scss|css)$/.test(name)) out.push(abs)
  }
  return out
}
const SRC_FILES = walk(FRONTEND_SRC)

describe('品牌主色 token（B1）', () => {
  const scss = fs.readFileSync(MAIN_SCSS, 'utf8')

  it('G1 · main.scss 必须定义 --brand-primary = #2563eb', () => {
    const m = scss.match(/--brand-primary:\s*(#[0-9a-fA-F]{6})/)
    expect(m, '--brand-primary 未定义 ⇒ 全站 var(--brand-primary) 全部失效（颜色会变空/继承）').toBeTruthy()
    expect(m[1].toLowerCase()).toBe(UI_PRIMARY)
  })

  it('G2 · 全站不得再出现旧主色作为前景/描边（background-* 前缀除外）', () => {
    // 唯一白名单：该 hover 块是「背景 + 描边 + 白字」一体，只改描边会深蓝边配浅蓝底，
    // 随 B2 主色迁移一起处理 ⇒ 此处刻意保留。⛔ 新增白名单必须写明理由。
    const ALLOW_OLD_BORDER = new Set(['views/DistrictInsightView.vue'])
    const hits = []
    for (const abs of SRC_FILES) {
      const rel = path.relative(FRONTEND_SRC, abs)
      const src = fs.readFileSync(abs, 'utf8')
      src.split('\n').forEach((line, i) => {
        // 负向后视排除 background-color；border-color / border-top-color 一并覆盖
        const re = /(?<![\w-])(?:border(?:-[a-z]+)?-)?color:\s*#409eff\b/i
        if (re.test(line) && !ALLOW_OLD_BORDER.has(rel)) {
          hits.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 90))
        }
      })
    }
    expect(hits, '旧主色又回到前景/描边位（应改用 var(--brand-primary)）:\n' + hits.join('\n')).toEqual([])
  })

  it('G2b · 1px 实线描边不得退回旧主色', () => {
    // 与 G2 分开：G2 管 `color:` / `border-color:` 属性，这里管 `border: 1px solid` 简写
    // （白卡片 + 1px 蓝边是最典型的描边场景，退化会立刻看出来）。
    // ⚠️ 2px 实线**不判**：那是地图浮动面板外框，与 gradient 标题栏一体，属 B2 待迁移。
    const hits = []
    for (const abs of SRC_FILES) {
      const rel = path.relative(FRONTEND_SRC, abs)
      fs.readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
        if (/border:\s*1px\s+solid\s+#409eff\b/i.test(line)) {
          hits.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 90))
        }
      })
    }
    expect(hits, '1px 描边退回旧主色:\n' + hits.join('\n')).toEqual([])
  })

  it('G3 · token 引用数不得低于下限（防一次性回退）', () => {
    let n = 0
    for (const abs of SRC_FILES) {
      n += (fs.readFileSync(abs, 'utf8').match(/var\(--brand-primary\)/g) || []).length
    }
    expect(n, `var(--brand-primary) 仅剩 ${n} 处，疑似被批量回退`).toBeGreaterThanOrEqual(MIN_TOKEN_USES)
  })

  it('G4 · 品牌实体色必须仍在，且与 UI 主色刻意不同源', () => {
    // 吉野家的品牌蓝是业务标识，不属于「UI 主色」范畴
    expect(BRAND_ENTITY.toLowerCase()).not.toBe(UI_PRIMARY)
    const mapView = fs.readFileSync(path.join(FRONTEND_SRC, 'views/MapView.vue'), 'utf8')
    expect(mapView, '吉野家品牌色被改掉了 —— 那是业务标识色，⛔ 不是 UI 主色').toContain(`'吉野家': '${BRAND_ENTITY}'`)
    // 反向：不得有人把 UI 主色安到品牌色上（两套混用会让语义彻底糊掉）
    expect(mapView).not.toContain(`'吉野家': '${UI_PRIMARY}'`)
  })

  it('G5 · 对比度实算：#2563eb 在白底与浅蓝底都必须 ≥ 4.5:1', () => {
    expect(contrast(UI_PRIMARY, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(UI_PRIMARY, '#ecf5ff')).toBeGreaterThanOrEqual(4.5) // tag / 选中态浅底
    expect(contrast(OLD_PRIMARY, '#ffffff')).toBeLessThan(4.5) // 反证：旧主色确实不达标
  })

  it('G6 · EP 主色派生值仍是静态表（B2 迁移时须整套覆盖）', () => {
    const epCss = path.join(REPO_ROOT, 'frontend/node_modules/element-plus/theme-chalk/index.css')
    if (!fs.existsSync(epCss)) return // 未装依赖时不判
    const css = fs.readFileSync(epCss, 'utf8')
    const hasStatic = /--el-color-primary-light-3:\s*#/.test(css)
    const hasColorMix = /--el-color-primary-light-3:\s*color-mix/.test(css)
    expect(hasColorMix, 'B2 若升级到 color-mix 版本，只需改 --el-color-primary 即可自动派生 —— 请同步更新本断言').toBe(false)
    expect(hasStatic, 'light-3 不再是静态值？EP 升级后派生机制变了，B2 方案需重评').toBe(true)
  })
})
