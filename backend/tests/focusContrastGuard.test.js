/**
 * 焦点指示与占位文本对比度守卫（v1.13.363 / 批次 362-②③）
 *
 * 背景（2026-11-14 核实；数字全部从源码与 EP theme-chalk 实算，不抄注释）：
 *   ② 焦点环：EP 的 `.el-button:focus-visible` 写的是
 *      `outline:2px solid var(--el-button-outline-color)`，而该变量默认
 *      = `var(--el-color-primary-light-5)` = #92b1f5，对白底仅 **2.14:1**
 *      ⇒ 低于 WCAG 1.4.11「非文本对比度 ≥3:1」。键盘用户**看得见**环，
 *        但它和背景几乎同亮度，实质上等于没有焦点指示。
 *      ⚠️ 2px 粗细本来就够（那是 2.4.13 AAA 的门槛），缺的是**颜色** ——
 *         ⛔ 不要把它当成「焦点环不够粗」去加粗，那修不好任何一个节点。
 *   ③ placeholder：EP 默认 #a8abb2 = **2.30:1**，低于 1.4.3 正文的 4.5:1。
 *      （认证页四页在 v1.13.173 已局部改成 #6b7280，本批统一到全局。）
 *
 * 🔴🔴 本文件最该记住的一条：**两条修法不对称**
 *   · `--el-text-color-placeholder` 在 EP 里**只在 :root 声明一次**，
 *     `--el-input-placeholder-color` 仅做 var() 转发，组件内没有重新声明
 *     ⇒ 写在 `html:root` 里即全站生效。
 *   · `--el-button-outline-color` 被 `.el-button` 自身声明，且五个语义变体
 *     （primary / success / warning / danger / info）又各声明一次 ⇒
 *     **元素自身声明优先于继承**，写 `:root` 会被全部盖掉，
 *     是「看着改了、其实一行都没生效」的写法。
 *     必须写 `html:root .el-button`（特异性 0,2,1 > EP 的 0,1,0）。
 *   ⇒ 于是 A 组断言「必须写在 html:root 里」，B 组断言「必须带 .el-button 前缀」，
 *      并且各自带一条**反向断言**禁止写错的形态。
 *
 * ⭐ EP 契约组（C）的意义：上面两条修法都**依赖 EP 当前的实现细节**
 *   （变量在哪一层声明、focus-visible 怎么取色）。一旦升级 EP 改了任一处，
 *   A/B 两组会**静默失效并继续绿灯**（假绿），所以这里把 EP 的前提也钉住：
 *   EP 变了就红，逼人重新评估，而不是让焦点环悄悄退回 2.14:1。
 *
 * （前端无独立测试框架，故与 brandTokenGuard / touchTargetGuard 一致挂在 backend vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/** ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，pathname 会留下百分号编码导致 ENOENT */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MAIN_SCSS = path.join(REPO_ROOT, 'frontend/src/assets/main.scss')
const EP_THEME = path.join(REPO_ROOT, 'frontend/node_modules/element-plus/theme-chalk')

// ===== 唯一权威期望值（改这里就必须同步改 main.scss，反之亦然）=====
const PLACEHOLDER = '#6b7280'      // 对白底 4.83:1
const PAGE_BG = '#ffffff'
const MIN_TEXT = 4.5               // WCAG 1.4.3 AA（正文文本）
const MIN_NONTEXT = 3.0            // WCAG 1.4.11 AA（UI 组件视觉信息）
const FOCUS_RING_VAR = 'var(--el-color-primary)'

// ===== 对比度实算（与 brandTokenGuard 同一套公式，⚠️ 不抄注释里的数字）=====
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

// ===== 源码预处理 =====
const SCSS_RAW = fs.readFileSync(MAIN_SCSS, 'utf8')
/** 剥掉块注释：注释里保留着历史色值（#a8abb2 等），不剥会造出假红 */
const SCSS = SCSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 取某条 CSS 规则的花括号内容。
 * 按字符级大括号平衡截取，而不是「读到下一个 } 行」——
 * main.scss 里有 @media / 嵌套缩写，行级判断会截错。
 * header 做字面转义后要求紧跟 `{`，所以 'html:root' 不会误命中 'html:root .el-button {'。
 */
function cssBlock(src, header) {
  const lit = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp('(^|\\n)[ \\t]*' + lit + '\\s*\\{').exec(src)
  if (!m) return null
  const open = src.indexOf('{', m.index)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}
/** 取规则块里某个声明的值（返回首个匹配） */
function declValue(block, prop) {
  if (!block) return null
  const m = new RegExp(prop.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '\\s*:\\s*([^;]+);').exec(block)
  return m ? m[1].trim() : null
}
/** 统计某个字符串在全文件出现的次数（剥注释后） */
function countOf(src, needle) {
  return src.split(needle).length - 1
}

const ROOT_BLOCK = cssBlock(SCSS, 'html:root')
const BUTTON_RING_BLOCK = cssBlock(SCSS, 'html:root .el-button')

// ============================================================================
describe('A. 占位文本对比度（1.4.3）', () => {
  it('html:root 段里声明了 --el-text-color-placeholder', () => {
    expect(ROOT_BLOCK, '在 main.scss 里找不到 html:root { … } 块').not.toBeNull()
    expect(declValue(ROOT_BLOCK, '--el-text-color-placeholder')).not.toBeNull()
  })

  it(`取值为 ${PLACEHOLDER}（唯一权威）`, () => {
    expect(declValue(ROOT_BLOCK, '--el-text-color-placeholder')).toBe(PLACEHOLDER)
  })

  it(`对白底对比度 ≥ ${MIN_TEXT}:1（实算，不是抄注释）`, () => {
    const v = declValue(ROOT_BLOCK, '--el-text-color-placeholder')
    const ratio = contrast(v, PAGE_BG)
    expect(ratio, `${v} 对 ${PAGE_BG} 仅 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_TEXT)
  })

  it('🔴 全项目该变量的声明值一致（认证页那处与全局不得漂移）', () => {
    // 任何一处 --el-text-color-placeholder: <色值>; 都必须等于 PLACEHOLDER。
    // 允许 var() 转发（如 --el-input-placeholder-color），只校验硬编码色值。
    const hits = [...SCSS.matchAll(/--el-text-color-placeholder\s*:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(hits.length, '至少应有一处声明').toBeGreaterThan(0)
    const hexes = hits.filter((v) => v.startsWith('#'))
    expect(hexes.length, '声明里应至少有一个硬编码色值').toBeGreaterThan(0)
    for (const h of hexes) expect(h.toLowerCase()).toBe(PLACEHOLDER)
  })

  it('⛔ 剥注释后源码里不再出现 EP 的旧值 #a8abb2', () => {
    expect(SCSS.toLowerCase()).not.toContain('#a8abb2')
  })
})

// ============================================================================
describe('B. 焦点环对比度（1.4.11）', () => {
  it('html:root .el-button 规则存在', () => {
    expect(BUTTON_RING_BLOCK, '找不到 html:root .el-button { … } 规则').not.toBeNull()
  })

  it(`取值为 ${FOCUS_RING_VAR}（走主色变量，⛔ 不硬编码色值）`, () => {
    expect(declValue(BUTTON_RING_BLOCK, '--el-button-outline-color')).toBe(FOCUS_RING_VAR)
  })

  it('🔴 选择器必须带 html:root 前缀 —— 只写 .el-button 会被各语义变体盖掉', () => {
    // EP: .el-button{--el-button-outline-color:var(--el-color-primary-light-5)}
    //     .el-button--success{--el-button-outline-color:var(--el-color-success-light-5)} …
    // 我们的规则若只有 .el-button 特异性 0,1,0，与 EP 打平且 EP 后置（运行时注入）⇒ 输。
    expect(SCSS).toMatch(/html:root\s+\.el-button\s*\{/)
  })

  it('🔴🔴 反向断言：禁止把该变量写在 :root / html:root 裸块里（无效写法，会假绿）', () => {
    const inRoot = declValue(ROOT_BLOCK, '--el-button-outline-color')
    expect(inRoot, 'html:root 裸块里的 --el-button-outline-color 会被 .el-button 自身声明覆盖，写了等于没写').toBeNull()
  })

  it('⛔ 该变量在全项目只被赋值一次（第二个赋值点＝口径分叉）', () => {
    expect(countOf(SCSS, '--el-button-outline-color:')).toBe(1)
  })

  it(`主色对白底对比度 ≥ ${MIN_NONTEXT}:1（实算）`, () => {
    const primary = declValue(ROOT_BLOCK, '--el-color-primary')
    expect(primary, 'html:root 里应有 --el-color-primary').not.toBeNull()
    const ratio = contrast(primary, PAGE_BG)
    expect(ratio, `${primary} 对 ${PAGE_BG} 仅 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_NONTEXT)
  })

  it('🔴 证明这批修的是真缺陷：EP 拿来当焦点环的 light-5 本身不达 3:1', () => {
    // 若哪天 EP 换了默认、或我们把手里的 light-5 调深到 ≥3:1，这条会红 ——
    // 那意味着「为什么要有 html:root .el-button 这条规则」的前提变了，应当重新评估而不是照抄。
    const light5 = declValue(ROOT_BLOCK, '--el-color-primary-light-5')
    expect(light5, 'html:root 里应有 --el-color-primary-light-5').not.toBeNull()
    const ratio = contrast(light5, PAGE_BG)
    expect(ratio, `light-5 ${light5} 对白底 ${ratio.toFixed(2)}:1，已达标 —— 请重新评估焦点环规则是否还需要`).toBeLessThan(MIN_NONTEXT)
  })
})

// ============================================================================
const EP_INDEX = path.join(EP_THEME, 'index.css')
const EP_BUTTON = path.join(EP_THEME, 'el-button.css')
const hasEP = fs.existsSync(EP_INDEX) && fs.existsSync(EP_BUTTON)

describe.skipIf(!hasEP)('C. EP 契约（升级 EP 后前提变了就必须重新评估）', () => {
  const epIndex = hasEP ? fs.readFileSync(EP_INDEX, 'utf8') : ''
  const epButton = hasEP ? fs.readFileSync(EP_BUTTON, 'utf8') : ''

  it('--el-text-color-placeholder 在 EP 里只在 :root 声明一次（全局覆盖能生效的前提）', () => {
    // 若 EP 改成组件内声明（如 .el-input 里再写一遍），我们在 html:root 的覆盖就会被盖掉，
    // A 组仍会绿灯但界面不变 —— 这正是本条存在的理由。
    expect(countOf(epIndex, '--el-text-color-placeholder:')).toBe(1)
  })

  it('--el-input-placeholder-color 只是 var() 转发（不是硬编码色值）', () => {
    expect(epIndex).toContain('--el-input-placeholder-color:var(--el-text-color-placeholder)')
  })

  it('EP 的 .el-button 自身声明了 --el-button-outline-color（所以不能只改 :root）', () => {
    expect(epButton).toContain('--el-button-outline-color:var(--el-color-primary-light-5)')
  })

  it('EP 的语义变体也各自声明一次（这就是 :root 覆盖会被盖掉的实证）', () => {
    expect(epButton).toContain('--el-button-outline-color:var(--el-color-success-light-5)')
    expect(epButton).toContain('--el-button-outline-color:var(--el-color-warning-light-5)')
    expect(epButton).toContain('--el-button-outline-color:var(--el-color-danger-light-5)')
  })

  it('EP 的焦点环确实取该变量 + 2px solid（改成别的写法则本批修法失效）', () => {
    expect(epButton).toContain('.el-button:focus-visible{outline:2px solid var(--el-button-outline-color)')
  })
})
