/**
 * 页面根容器「自己滚」守卫（v1.13.375c）
 *
 * ── 这条守卫是被真机打出来的 ────────────────────────────────────────────
 * `MainLayout.vue:1078` 的全站约定是：
 *
 *     .main-content { flex: 1; overflow: hidden; }
 *
 * 也就是说 **滚动责任在页面自己身上**。页面根容器必须自己
 * `height:100% + overflow-y:auto`，否则内容一旦超过一屏，超出部分就**永久不可达**：
 * 不是"看不到"，而是滚轮、触摸、滚动条全都没有 —— `overflow:hidden` 连程序化
 * `scrollTop` 都不给用户用（只有脚本能改，用户改不了）。
 *
 * 375 上线「仅初筛」后做真机验证，1280×577 实测：内容高 953 / 可用高 476，
 * 「预估消耗 / 仅初筛」按钮落在 y=657 ⇒ **整块被裁且滚不动**。
 * 一个 0 消耗出榜的功能，在 768 高的笔记本上等于没上线。
 *
 * 而且这不是孤例 —— 同一套模板配方复制出了三个：
 *   · SiteSelectView `.ss-page`      （369 起就缺，375 把按钮放进被裁区才暴露）
 *   · CandidateView  `.cand-page`    （候选池表格 + 分页，必然超屏）
 *   · MarketMapView  `.market-map-view`（页头 + 640px 榜单块 + 说明）
 *
 * ── 为什么不能只写"每个页面都必须有"的笼统断言 ──────────────────────────
 * 有些页面是**故意**不滚的：DashboardView 用 `position:fixed; inset:0` 直接接管视口，
 * 内部子面板自己滚；认证类页面（`auth-container`）根本不在 `.main-content` 里。
 * 一刀切会把它们判红，然后下一个人就会去加豁免表 —— 豁免表一长，守卫就死了。
 *
 * 所以分两档：
 *   ① **通用**：凡是能在本文件 `<style>` 里找到根容器规则的页面，`height:100%` 与
 *      `overflow-y:auto|scroll` **至少得有一个**。两个都没有 ⇒ 一定不滚 ⇒ 红。
 *      （只写 `height:100%` 不带 overflow 的，可能是内部子元素自己滚，不判红。）
 *   ② **点名**：三个已知会长到一屏以上的页面，三件套必须齐（含 `box-sizing:border-box`，
 *      否则 `height:100%` + 上下 padding 会多出 60px 溢出）。
 *
 * ── 豁免必须自证 ────────────────────────────────────────────────────────
 * `EXEMPT` 不是白名单，是「请你证明自己确实接管了视口」：登记了就必须真含
 * `position:fixed`，否则照样红。这样豁免不会被拿来糊弄。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const VIEWS_DIR = path.join(REPO_ROOT, 'frontend/src/views')

/** 本文件不做"页面"看（布局壳，不是路由页面） */
const SKIP_FILES = new Set(['MainLayout.vue'])

/**
 * 豁免表：既无 height:100% 也无 overflow-y，但**有理由**。
 * ⚠️ 每条都必须是能验证的结构特征，不是"暂时先放过"。
 */
const EXEMPT = {
  'DashboardView.vue': 'position:fixed; inset:0 全屏大屏，自己接管视口（不在 .main-content 里排版）'
}

/**
 * 点名表：内容会稳定长过一屏的页面 ⇒ 三件套必须齐。
 * ⛔ 加页面进来时别只加名字：确认它真的会长，否则就是无谓的约束。
 */
const LONG_PAGES = {
  'SiteSelectView.vue': 'ss-page',
  'CandidateView.vue': 'cand-page',
  'MarketMapView.vue': 'market-map-view'
}

const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

/** 模板第一个真实元素的首个 class（跳过注释）。找不到 ⇒ null。 */
function rootClassOf(src) {
  const i = src.indexOf('<template>')
  if (i < 0) return null
  const body = stripHtmlComments(src.slice(i + '<template>'.length))
  const tag = /<([a-zA-Z][\w-]*)([^>]*)>/.exec(body)
  if (!tag) return null
  const cls = /class="([^"]*)"/.exec(tag[2])
  if (!cls) return null
  const first = cls[1].trim().split(/\s+/)[0]
  return first || null
}

/** `<style>` 段里 `.cls { ... }` 的第一条规则块（已剥 CSS 注释）。找不到 ⇒ null。 */
function ruleBlockOf(src, cls) {
  const i = src.indexOf('<style')
  if (i < 0) return null
  const css = stripCssComments(src.slice(i))
  const re = new RegExp('\\.' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')
  const m = re.exec(css)
  return m ? m[1] : null
}

// `min-height:100%` 不算 —— 元素高度随内容长，overflow 永不触发，等于没写。
const hasHeight100 = (b) => /(?<![-a-zA-Z])height\s*:\s*100%\s*;/.test(b)
const hasOverflowY = (b) => /overflow-y\s*:\s*(?:auto|scroll)\s*;/.test(b)
const hasBorderBox = (b) => /box-sizing\s*:\s*border-box\s*;/.test(b)

function readView(file) {
  return fs.readFileSync(path.join(VIEWS_DIR, file), 'utf8')
}

/**
 * 扫描全部视图，返回 { problems, checked, skipped }。
 * checked / skipped 供自检用 —— 提取逻辑一旦失效会静默 0 违规（假绿）。
 */
function scanAll(overrides = {}) {
  const problems = []
  const checked = []
  const skipped = []

  const files = fs.readdirSync(VIEWS_DIR).filter((f) => f.endsWith('.vue')).sort()
  for (const file of files) {
    if (SKIP_FILES.has(file)) continue
    const src = Object.prototype.hasOwnProperty.call(overrides, file) ? overrides[file] : readView(file)

    const cls = rootClassOf(src)
    if (!cls) { skipped.push(`${file}: 模板无根 class`); continue }
    const block = ruleBlockOf(src, cls)
    if (block === null) {
      // 根 class 由全局样式定义（如 auth-container），或压根没写规则 ⇒ 不归本守卫管
      skipped.push(`${file}: <style> 内未定义 .${cls}`)
      continue
    }
    checked.push(file)

    const h = hasHeight100(block)
    const o = hasOverflowY(block)

    // ① 通用档：两个都没有 ⇒ 一定不滚
    if (!h && !o) {
      if (EXEMPT[file]) {
        // 豁免必须自证：真的接管了视口（position:fixed），否则照样红
        if (!/position\s*:\s*fixed\s*;/.test(block)) {
          problems.push(
            `${file} 登记为豁免（${EXEMPT[file]}），但 .${cls} 里没有 position:fixed —— 豁免不成立`
          )
        }
      } else {
        problems.push(
          `${file} 的根容器 .${cls} 既没有 height:100% 也没有 overflow-y:auto —— `
          + '父级 .main-content 是 overflow:hidden，超出部分用户永远滚不到'
        )
      }
    }

    // ② 点名档：三个已知长页面，三件套必须齐
    const want = LONG_PAGES[file]
    if (want) {
      if (want !== cls) {
        problems.push(`${file} 的根 class 变了（期望 .${want}，实际 .${cls}）—— 点名表需要同步更新`)
      } else {
        if (!h) problems.push(`${file} 的 .${cls} 缺 height:100%（页面不滚，下半屏不可达）`)
        if (!o) problems.push(`${file} 的 .${cls} 缺 overflow-y:auto（页面不滚，下半屏不可达）`)
        if (!hasBorderBox(block)) {
          problems.push(
            `${file} 的 .${cls} 缺 box-sizing:border-box —— height:100% 再加上下 padding 会多出 60px 溢出`
          )
        }
      }
    }
  }

  return { problems, checked, skipped }
}

describe('页面根容器滚动守卫（.main-content overflow:hidden 的配套约定）', () => {
  const { problems, checked, skipped } = scanAll()

  it('所有页面根容器都自己管滚动（0 个违规）', () => {
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('扫描确实是"扫到了东西"而不是静默全跳过（防提取逻辑失效假绿）', () => {
    // 当前仓库 25 个视图里，19 个能在本文件 <style> 找到根容器规则，6 个落在全局样式/未定义。
    // ⛔ 这个下限只是防"正则写坏导致 0 命中"，不是覆盖率 KPI —— 别为了凑数去改。
    expect(checked.length).toBeGreaterThanOrEqual(15)
    expect(checked).toContain('SiteSelectView.vue')
    expect(checked).toContain('CandidateView.vue')
    expect(checked).toContain('DataView.vue')
    // skipped 里不该出现三个点名页面
    for (const f of Object.keys(LONG_PAGES)) {
      expect(skipped.some((s) => s.startsWith(f))).toBe(false)
    }
  })

  it('豁免必须自证：登记全屏的页面真的写了 position:fixed', () => {
    for (const file of Object.keys(EXEMPT)) {
      const block = ruleBlockOf(readView(file), rootClassOf(readView(file)))
      expect(block, `${file} 找不到根容器规则块`).not.toBeNull()
      expect(/position\s*:\s*fixed\s*;/.test(block), `${file} 豁免理由不成立`).toBe(true)
    }
  })
})

describe('负变异：改坏必须报红', () => {
  const base = scanAll()
  const view = (file) => readView(file)
  const run = (file, src) => scanAll({ [file]: src }).problems

  /**
   * 只在 `.cls {` 之后的**第一条**规则里替换。
   * ⛔ 不能用裸 `src.replace('height: 100%;', ...)`：同一个属性在页面别处也出现时，
   *    会改到无关元素上，变异就变成"改了个不相干的地方"，测试照样绿（假绿）。
   */
  function replaceInBlock(src, cls, from, to) {
    const i = src.indexOf('.' + cls + ' {')
    if (i < 0) return src
    const j = src.indexOf(from, i)
    if (j < 0) return src
    return src.slice(0, j) + to + src.slice(j + from.length)
  }

  it('M101 删掉 .ss-page 的 height/overflow（375 原始缺陷原样复现）', () => {
    let src = view('SiteSelectView.vue')
    src = replaceInBlock(src, 'ss-page', '  height: 100%;\n', '')
    src = replaceInBlock(src, 'ss-page', '  overflow-y: auto;\n', '')
    expect(src).not.toBe(view('SiteSelectView.vue'))
    const p = run('SiteSelectView.vue', src)
    expect(p.some((x) => x.includes('height:100%'))).toBe(true)
  })

  it('M102 把 height:100% 换成 min-height:100%（看着像修了，其实 overflow 永不触发）', () => {
    const src = replaceInBlock(
      view('SiteSelectView.vue'), 'ss-page', 'height: 100%;', 'min-height: 100%;'
    )
    expect(src).not.toBe(view('SiteSelectView.vue'))
    const p = run('SiteSelectView.vue', src)
    expect(p.some((x) => x.includes('height:100%'))).toBe(true)
  })

  it('M103 删掉 .cand-page 的 overflow-y:auto（候选池下半屏不可达）', () => {
    const src = replaceInBlock(
      view('CandidateView.vue'), 'cand-page', 'overflow-y: auto; ', ''
    )
    expect(src).not.toBe(view('CandidateView.vue'))
    const p = run('CandidateView.vue', src)
    expect(p.some((x) => x.includes('overflow-y'))).toBe(true)
  })

  it('M104 删掉 .market-map-view 的 box-sizing（height:100% + padding 溢出 40px）', () => {
    const src = replaceInBlock(
      view('MarketMapView.vue'), 'market-map-view', '  box-sizing: border-box;\n', ''
    )
    expect(src).not.toBe(view('MarketMapView.vue'))
    const p = run('MarketMapView.vue', src)
    expect(p.some((x) => x.includes('box-sizing'))).toBe(true)
  })

  it('M105 通用档：一个只写 padding 的根容器照样要红（场景=把认证页挪进主布局却忘了加滚动）', () => {
    const src = [
      '<template>',
      '  <div class="auth-container">x</div>',
      '</template>',
      '',
      '<style scoped>',
      '.auth-container { padding: 20px; }',
      '</style>',
      ''
    ].join('\n')
    const p = run('LoginView.vue', src)
    expect(p.some((x) => x.includes('.auth-container'))).toBe(true)
  })

  it('M106 豁免不成立：把 DashboardView 的 position:fixed 删掉', () => {
    const src = replaceInBlock(
      view('DashboardView.vue'), 'dashboard-screen', '  position: fixed;\n', ''
    )
    expect(src).not.toBe(view('DashboardView.vue'))
    const p = run('DashboardView.vue', src)
    expect(p.some((x) => x.includes('豁免不成立'))).toBe(true)
  })

  it('基线本身是干净的（否则上面六条变异可能"本来就红"）', () => {
    expect(base.problems).toEqual([])
  })
})
