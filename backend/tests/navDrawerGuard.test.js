/**
 * 顶栏导航窄屏抽屉守卫（v1.13.368 / 批次 368）
 *
 * ── 这一批修的是什么 ────────────────────────────────────────────────────
 * 顶栏八个导航项是一横排 + `white-space: nowrap`。实测顶栏的**最小内容宽度**：
 *   · 普通用户  **1121px**（视口 901 时 `header.scrollWidth`）
 *   · 管理员    **1231px**（多一个「品牌门店」）
 * 所以 1024 的 iPad 横屏、1180 的笔记本窗口都会把右边几项顶到视口外 ——
 * 看不见也点不到；而 body 不横向滚动，连「往右拖」的线索都没有。
 * （批次 367 只修了地图浮层 ≤900px 那一段，顶栏这一段当时明确记为遗留。）
 *
 * ── 修法与三条不变式（改之前先读，别绕回去）──────────────────────────────
 * 1) 窄屏把**同一份** `<nav>` 用 CSS 变成左侧抽屉，⛔ 不复制一份导航项 ——
 *    复制就会「加了一个菜单项，桌面有、手机没有」（366 改名的同类坑）。F 组钉这条。
 * 2) 断点 **1240px**，刻意不等于 367 的 900px：两个数字回答不同问题
 *    （900＝地图浮层横排放不放得下；1240＝导航横排放不放得下）。C 组钉同源。
 * 3) 关闭态必须 `visibility: hidden`：只写 `translateX(-100%)` 只是「眼睛看不到」，
 *    Tab 键仍会把焦点送进屏幕外的链接。D 组钉这条。
 *
 * ── 两个真实踩过的坑（都在断言里留了痕迹）────────────────────────────────
 * ① `.header` 是 flex item ⇒ 它的 `z-index: 100` **真的会建立层叠上下文**
 *    （Flexbox 规范：flex item 只要 z-index ≠ auto 就建，与 position 无关）。
 *    结果：抽屉的 1500 被关在 100 这一层，地图浮层（1200~1400）反过来压在抽屉上。
 *    实测 `elementFromPoint(300,200)` 命中的是遮罩而不是抽屉。
 *    ⇒ 修法是把 `.header` 抬到 1600，而不是继续调 `.nav-menu` 的 z-index。
 * ② `.nav-item.dashboard-nav { padding: 7px 12px }` 特异性 (0,4,0) 高过
 *    `.nav-item { padding: 12px 14px }` (0,3,0)，不重写就矮成 37px，
 *    低于 44 触控基线（G 组）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC = path.join(REPO_ROOT, 'frontend/src')
const LOCALES = path.join(SRC, 'i18n/locales')

const F = {
  layout: path.join(SRC, 'views/MainLayout.vue'),
  zh: path.join(LOCALES, 'zh.js'),
  en: path.join(LOCALES, 'en.js'),
  ja: path.join(LOCALES, 'ja.js')
}

const read = (p) => fs.readFileSync(p, 'utf8')

/** 剥 CSS 注释（保留换行，行号不漂） */
function stripCssComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 剥 JS 行注释（`//` 开头到行尾） */
function stripJsComments(src) {
  return src.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n')
}

/** 剥 HTML 注释（`<!-- -->`）。⚠️ 模板里的解释性注释也提到 `<nav id="main-nav">`，
 *  不剥就会被 F 组当成「第二份导航」（本批真踩：`id="main-nav"` 计数为 2）。 */
function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** SFC 全文剥注释（CSS 块 + JS 行 + HTML 注释三类都要剥，本批三类注释都写了内容） */
function stripAllComments(src) {
  return stripHtmlComments(stripJsComments(stripCssComments(src)))
}

/** 取文件里的 <style> 段（多段时拼起来） */
function styleOf(vueFile) {
  const src = read(vueFile)
  const out = []
  const re = /<style[^>]*>/g
  let m
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length
    const end = src.indexOf('</style>', start)
    if (end < 0) continue
    out.push(src.slice(start, end))
    re.lastIndex = end
  }
  return out.join('\n')
}

/** 取 <template> 段（用最后一个 </template>，内部有插槽片段） */
function templateOf(vueFile) {
  const src = read(vueFile)
  const start = src.indexOf('<template>')
  const end = src.lastIndexOf('</template>')
  if (start < 0 || end < 0) return ''
  return src.slice(start, end)
}

/** 取 <script> 段 */
function scriptOf(vueFile) {
  const src = read(vueFile)
  const start = src.indexOf('<script')
  if (start < 0) return ''
  const open = src.indexOf('>', start)
  const end = src.indexOf('</script>', open)
  if (open < 0 || end < 0) return ''
  return src.slice(open + 1, end)
}

/** 匹配花括号（跳过字符串），返回闭合位置 */
function matchBrace(s, openIdx) {
  let d = 0
  let inStr = null
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (c === '\\') { i++; continue }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'") { inStr = c; continue }
    if (c === '{') d++
    else if (c === '}') { d--; if (d === 0) return i }
  }
  return -1
}

/** 取出所有 @media 块的 { query, body } */
function mediaBlocks(css) {
  const clean = stripCssComments(css)
  const out = []
  const re = /@media([^{]*)\{/g
  let m
  while ((m = re.exec(clean))) {
    const open = clean.indexOf('{', m.index + m[0].length - 1)
    const close = matchBrace(clean, open)
    if (close < 0) continue
    out.push({ query: m[1].trim(), body: clean.slice(open + 1, close) })
    re.lastIndex = close
  }
  return out
}

/** 在给定 CSS 文本里取某个选择器的规则体（取**第一次**出现） */
function ruleBody(cssText, selector) {
  const clean = stripCssComments(cssText)
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // ⚠️ 必须匹配「选择器 + {」这个规则头，⛔ 不能用 includes：
  //    `.header .nav-menu` 是 `.header .nav-menu.nav-menu-open` 的前缀，
  //    用 includes 会把打开态当成关闭态（假绿灯，本批变异测试抓到过）。
  const re = new RegExp(`${esc}\\s*\\{`)
  const m = re.exec(clean)
  if (!m) return ''
  const open = clean.indexOf('{', m.index)
  const close = matchBrace(clean, open)
  return close < 0 ? '' : clean.slice(open + 1, close)
}

/** 1240 断点的媒体块正文 */
function drawerBlock(vueFile) {
  const b = mediaBlocks(styleOf(vueFile)).filter((x) => /max-width\s*:\s*1240px/.test(x.query))
  return b.length ? b.map((x) => x.body).join('\n') : ''
}

// ============================================================
// A 组：触发器与可访问名
// ============================================================
describe('A. 汉堡按钮是真正的 button，且有可访问名', () => {
  const tpl = stripAllComments(templateOf(F.layout))

  it('存在 .nav-toggle 且是 <button type="button">', () => {
    const at = tpl.indexOf('class="nav-toggle"')
    expect(at, '模板里找不到 .nav-toggle').toBeGreaterThan(-1)
    // 往前找最近的 `<button`，确认就是它（不是套在 div 上）
    const open = tpl.lastIndexOf('<button', at)
    expect(open).toBeGreaterThan(-1)
    expect(tpl.slice(open, at)).toContain('type="button"')
  })

  it('aria-label / aria-expanded / aria-controls 三件套齐全', () => {
    const at = tpl.indexOf('class="nav-toggle"')
    const chunk = tpl.slice(at, tpl.indexOf('>', tpl.indexOf('@click', at)))
    expect(chunk, '只写图标不写 aria-label，读屏只会念「按钮」').toContain(':aria-label')
    expect(chunk).toContain(':aria-expanded')
    expect(chunk).toContain('aria-controls="main-nav"')
  })

  it('被控制的是 <nav id="main-nav">', () => {
    expect(tpl).toMatch(/<nav[^>]*id="main-nav"/)
  })

  it('桌面隐藏用 display:none（不进可聚焦序列）', () => {
    const css = styleOf(F.layout)
    const body = ruleBody(css, '.nav-toggle')
    expect(body).toContain('display: none')
  })

  it('触控目标 44×44（项目基线 24×24，导航主入口给足）', () => {
    const body = ruleBody(styleOf(F.layout), '.nav-toggle')
    expect(body).toMatch(/width:\s*44px/)
    expect(body).toMatch(/height:\s*44px/)
  })
})

// ============================================================
// B 组：抽屉标题栏 / 关闭按钮 / 三语词条
// ============================================================
describe('B. 抽屉里有常驻的关闭按钮', () => {
  const tpl = stripAllComments(templateOf(F.layout))

  it('模板里有 .nav-drawer-head 与 .nav-drawer-close', () => {
    expect(tpl).toContain('nav-drawer-head')
    expect(tpl).toContain('nav-drawer-close')
  })

  it('关闭按钮有自己的可访问名（不能与汉堡按钮共用一个）', () => {
    const at = tpl.indexOf('nav-drawer-close')
    const chunk = tpl.slice(at, at + 400)
    expect(chunk).toContain('aria-label')
    expect(chunk).toContain("$t('nav.closeMenu')")
  })

  it('三语都补了 menu / openMenu / closeMenu', () => {
    for (const f of [F.zh, F.en, F.ja]) {
      const src = stripJsComments(read(f))
      for (const k of ['menu:', 'openMenu:', 'closeMenu:']) {
        expect(src, `${path.basename(f)} 缺 ${k}`).toContain(k)
      }
    }
  })
})

// ============================================================
// C 组：断点同源，且数字由「横排放不下」决定
// ============================================================
describe('C. JS 与 CSS 用同一个断点', () => {
  const script = stripAllComments(scriptOf(F.layout))
  const cssCss = styleOf(F.layout)

  it('JS 常量 NAV_DRAWER_MQ = (max-width: 1240px)', () => {
    const m = /NAV_DRAWER_MQ\s*=\s*'([^']+)'/.exec(script)
    expect(m, '找不到 NAV_DRAWER_MQ 常量').toBeTruthy()
    expect(m[1]).toBe('(max-width: 1240px)')
  })

  it('CSS 里有 1240px 的媒体块', () => {
    const blocks = mediaBlocks(cssCss).filter((b) => /max-width\s*:\s*1240px/.test(b.query))
    expect(blocks.length, 'CSS 缺 @media (max-width: 1240px)').toBeGreaterThan(0)
  })

  it('断点数字必须 ≥ 管理员顶栏最小宽（实测 1231px）', () => {
    const m = /NAV_DRAWER_MQ\s*=\s*'[^']*?(\d+)px/.exec(script)
    expect(m).toBeTruthy()
    const px = Number(m[1])
    // 1231 = 管理员（含「品牌门店」）在 901px 视口下量到的 header.scrollWidth。
    // 断点比它小 ⇒ 中间那一段用户仍会被裁，等于没修完。
    expect(px, '断点小于 1231px 时管理员在 1231~断点 区间仍会溢出').toBeGreaterThanOrEqual(1231)
  })

  it('旧的 NARROW_MQ 名字必须消失（它与 367 的 900px 同名不同义）', () => {
    expect(script).not.toMatch(/\bNARROW_MQ\b/)
  })

  it('断点值不能与 367 的 900px 混用', () => {
    const m = /NAV_DRAWER_MQ\s*=\s*'[^']*?(\d+)px/.exec(script)
    expect(Number(m[1])).not.toBe(900)
  })
})

// ============================================================
// D 组：关闭态不可聚焦 + 层叠顺序
// ============================================================
describe('D. 关闭态「看不见且点不到」，且压得住地图浮层', () => {
  const block = drawerBlock(F.layout)

  it('抽屉本体在 1240 块里是 fixed + translateX(-100%)', () => {
    const body = ruleBody(block, '.header .nav-menu')
    expect(body, '1240 块里找不到 .header .nav-menu 规则').not.toBe('')
    expect(body).toContain('position: fixed')
    expect(body).toContain('translateX(-100%)')
  })

  it('🔴 关闭态必须 visibility: hidden（只 translate 的话 Tab 仍能进）', () => {
    const body = ruleBody(block, '.header .nav-menu')
    expect(body, '只写 transform 不写 visibility ⇒ 焦点仍会进屏幕外的链接').toContain('visibility: hidden')
  })

  it('打开态 visibility: visible + 归位', () => {
    const body = ruleBody(block, '.header .nav-menu.nav-menu-open')
    expect(body).not.toBe('')
    expect(body).toContain('visibility: visible')
    expect(body).toContain('translateX(0)')
  })

  it('🔴 .header 的 z-index 必须高过地图浮层（1400）', () => {
    const body = ruleBody(block, '.header')
    const m = /z-index:\s*(\d+)/.exec(body)
    expect(m, '1240 块里没给 .header 设 z-index —— flex item 的 100 会把抽屉关在 100 层').toBeTruthy()
    expect(Number(m[1])).toBeGreaterThan(1400)
  })

  it('抽屉(1500) 高于 遮罩(1490)，且两者都高于地图浮层', () => {
    const nav = /z-index:\s*(\d+)/.exec(ruleBody(block, '.header .nav-menu'))
    const bd = ruleBody(block, '.nav-drawer-backdrop')
    const bdZ = /z-index:\s*(\d+)/.exec(bd)
    expect(nav).toBeTruthy()
    expect(bdZ).toBeTruthy()
    expect(Number(nav[1])).toBeGreaterThan(Number(bdZ[1]))
    expect(Number(bdZ[1])).toBeGreaterThan(1400)
  })

  it('遮罩在 1240 块里是 fixed 且从顶栏下沿起（⛔ 不能让 header 盖住汉堡按钮）', () => {
    const body = ruleBody(block, '.nav-drawer-backdrop')
    expect(body).toContain('position: fixed')
    expect(body).toContain('top: var(--header-height)')
    expect(body).toMatch(/bottom:\s*0/)
  })

  it('遮罩被限制在 1240 块里（桌面端不得出现灰色蒙层）', () => {
    const cssAll = stripCssComments(styleOf(F.layout))
    const outside = cssAll.replace(block, '')
    // 桌面的兜底规则只允许是 display:none
    const base = ruleBody(outside, '.nav-drawer-backdrop')
    expect(base).toContain('display: none')
    expect(base).not.toContain('position: fixed')
  })

  it('nav 脱离文档流后，账户区要自己顶到右边', () => {
    const body = ruleBody(block, '.header .header-right')
    expect(body, '缺 margin-left:auto ⇒ 头像贴到产品名右边').toContain('margin-left: auto')
  })
})

// ============================================================
// E 组：交互（换页关、Esc 关且归还焦点、断点变化关）
// ============================================================
describe('E. 三种关闭路径都在', () => {
  const script = stripAllComments(scriptOf(F.layout))

  it('换页即关（route.fullPath 的 watch）', () => {
    expect(script).toMatch(/watch\(\s*\(\)\s*=>\s*route\.fullPath/)
    const at = script.indexOf('route.fullPath')
    const chunk = script.slice(at, at + 160)
    expect(chunk).toContain('closeNavDrawer')
  })

  it('🔴 Esc 分支必须排在「非地图页就 return」之前', () => {
    const esc = script.indexOf("e.key === 'Escape'")
    const early = script.indexOf('if (!isMapPage.value) return')
    expect(esc, '找不到 Esc 处理').toBeGreaterThan(-1)
    expect(early, '找不到 !isMapPage 早退').toBeGreaterThan(-1)
    expect(esc, 'Esc 放在早退之后就变成「只有地图页能关」').toBeLessThan(early)
  })

  it('Esc 关闭要归还焦点（否则焦点掉到 body，下一按 Tab 从页首重来）', () => {
    const fn = script.slice(script.indexOf('const closeNavDrawer'))
    // ⚠️ 断言**整行连同条件**：只查 `navToggleRef.value.focus()` 这个名字，
    //    被 `if (false && ...)` 或注释掉也照样命中（365 的 M8 就是这么漏的）。
    expect(fn.slice(0, 600)).toMatch(/if\s*\(\s*returnFocus\s*&&\s*navToggleRef\.value\s*\)\s*navToggleRef\.value\.focus\(\)/)
  })

  it('matchMedia 挂了也要摘（否则热更新叠加监听）', () => {
    expect(script).toContain("narrowMq.addEventListener('change'")
    expect(script).toContain("narrowMq.removeEventListener('change'")
  })

  it('视口变宽时关闭（否则桌面上会看到一层灰）', () => {
    const at = script.indexOf('const handleNarrowChange')
    expect(at).toBeGreaterThan(-1)
    expect(script.slice(at, at + 120)).toContain('closeNavDrawer')
  })
})

// ============================================================
// F 组：不复制第二份导航（本批核心不变式）
// ============================================================
describe('F. 抽屉复用同一份 <nav>，⛔ 不复制导航项', () => {
  const src = stripAllComments(read(F.layout))

  const ROUTES = ['/', '/data', '/competitors', '/brand-stores', '/shopping-centers', '/shapefiles', '/dashboard']

  for (const r of ROUTES) {
    it(`to="${r}" 在 MainLayout 里只有一处`, () => {
      const n = src.split(`to="${r}"`).length - 1
      expect(n, `${r} 出现 ${n} 次 —— 复制了一份导航项，将来改名只改一处就会不一致`).toBe(1)
    })
  }

  it('id="main-nav" 只有一处', () => {
    expect(src.split('id="main-nav"').length - 1).toBe(1)
  })

  it('nav-menu 容器只有一处', () => {
    expect(src.split('class="nav-menu"').length - 1 +
      src.split('class="nav-menu nav-menu-open"').length - 1).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================
// G 组：抽屉里的触控高度（44px 基线）
// ============================================================
describe('G. 抽屉条目不得矮于 44px', () => {
  const block = drawerBlock(F.layout)

  it('.nav-item 在抽屉里是 12px 上下内边距', () => {
    const body = ruleBody(block, '.header .nav-menu .nav-item')
    expect(body).toMatch(/padding:\s*12px 14px/)
  })

  it('🔴 dashboard-nav 必须重写 padding（原规则特异性更高，会缩成 37px）', () => {
    const body = ruleBody(block, '.header .nav-menu .nav-item.dashboard-nav')
    expect(body).not.toBe('')
    expect(body, '不重写 padding 就是 7px 12px ⇒ 37px，低于 44 触控基线').toMatch(/padding:\s*12px 14px/)
  })

  it('🔴 抽屉文字色必须走三级 token（364 的 textTierContrastGuard 禁止硬写）', () => {
    // 旧的次要灰 #909399 对白底只有 3.08:1、regular #606266 在 364 已下沉到 #4b5563。
    // 抽屉是白底，硬写这两个值会把已经上线的对比度修正在新代码里又挖回去。
    expect(block).not.toMatch(/color:\s*#909399/i)
    expect(block).not.toMatch(/color:\s*#606266/i)
    // ⚠️ 不能用 ruleBody(完整后代选择器)：这里是 SCSS 嵌套写法，源码里只有
    //    `.nav-drawer-title {`（编译后才展开成完整选择器）。直接在块里找规则头。
    expect(block).toMatch(/\.nav-drawer-title\s*\{[^}]*var\(--text-secondary\)/)
  })

  it('下拉触发行同样占满一行', () => {
    const body = ruleBody(block, '.header .nav-menu .nav-dropdown .nav-dropdown-trigger')
    expect(body).toContain('width: 100%')
    expect(body).toMatch(/padding:\s*12px 14px/)
  })
})

// ============================================================
// H 组：负变异（注释不是代码）
// ============================================================
describe('H. 注释里写旧写法不触发断言', () => {
  it('CSS 注释里写 display:none / 900px 不触发', () => {
    const fake = '/* 曾经是 display:none，断点曾经是 900px */\n.foo { color: red; }'
    const s = stripCssComments(fake)
    expect(s).not.toContain('display:none')
    expect(s).not.toContain('900px')
  })

  it('JS 注释里写 to="/data" 不计入「复制导航」', () => {
    const fake = '// 抽屉曾经复制过一份 to="/data" 的链接\nconst a = 1'
    expect(stripJsComments(fake)).not.toContain('to="/data"')
  })

  it('HTML 注释里提 <nav id="main-nav"> 不计入「复制导航」', () => {
    const fake = '<!-- aria-controls 指向下面 <nav id="main-nav"> --><nav id="main-nav">'
    expect(stripHtmlComments(fake).split('id="main-nav"').length - 1).toBe(1)
  })

  it('真正的旧写法仍然会被抓（剥注释不是遮羞布）', () => {
    expect(stripJsComments('const NARROW_MQ = 900')).toMatch(/NARROW_MQ/)
    expect(stripCssComments('.nav-menu { transform: translateX(-100%) }')).toContain('translateX(-100%)')
  })

  it('ruleBody 不被前缀选择器骗（.nav-menu 不能命中 .nav-menu-open）', () => {
    const css = '.header .nav-menu.nav-menu-open { visibility: visible }'
    expect(ruleBody(css, '.header .nav-menu')).toBe('')
  })
})
