/**
 * 窄屏（手机）地图浮层布局守卫（v1.13.367 / 批次 367）
 *
 * ── 这一批修的是什么 ────────────────────────────────────────────────────
 * 地图工作台顶部的浮层是按「≥1280px 桌面」排的一横排：
 *   地址框(left:10, w320) ← 商圈工具(right:420) ← 门店工具(right:285)
 *   ← 周边检索(right:150) ← 工具栏(right:15)，外加联通人口面板(right:570, w340)。
 * 这些数字叠加起来需要 **≥910px** 视口才不打架。手机上（390px）实测：
 *   · 商圈工具 left = -140（「商圈工具」四个字只露一半，点不到）
 *   · 联通人口面板 left = -520（整张看不见 → 付费功能在白屏）
 *   · 定位门店面板 w360 + right180 = 540 ⇒ left = -150
 *   · 门店工具 left = 9，被地址框（z-index 1400）整块压住
 * 用户报告里写的「移动端搜索框遮挡」只是最显眼的那一处。
 *
 * ── 修法（改之前先读，别绕回去）────────────────────────────────────────────
 * 1) 窄屏（≤900px）改为「地址框独占第一行 + 其余面板在右侧竖向堆叠」；
 *    纵向坐标由 MapView 的 `--narrow-stack-top` / `--narrow-stack-step` 推导，
 *    ⛔ 不许每个组件各写一个魔法 top —— 改一个忘一个就会叠在一起（C 组钉这条）。
 * 2) 位置**不能写在内联 style 里**：内联赢过 @media。所以 `useDraggable` 在窄屏
 *    直接不输出位置（F 组），让 CSS 全权接管。
 * 3) 拖拽统一到 `utils/useDraggable.js`：pointer 事件（手机能拖）+ 夹边界
 *    （拖不出屏）+ 把手 `touch-action: none`（否则 pointermove 被页面滚动 cancel，
 *    表现是「按下去纹丝不动」）。D/E 组钉住。
 *
 * ── 为什么断言里要剥注释 ──────────────────────────────────────────────────
 * G 组要断言「`.smartsteps-float-btn` 不得复活」，而本批在 MapView 里特意留了
 * 一段注释解释为什么删它 —— 不剥注释就会把这段注释判成残留（假红）。
 * D 组同理（注释里写了 `@mousedown` 这三个字）。所以统一 `stripCssComments()` +
 * `stripJsComments()`，并各自配一条**负变异**用例证明「放进注释仍然绿」。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC = path.join(REPO_ROOT, 'frontend/src')

const F = {
  mapView: path.join(SRC, 'views/MapView.vue'),
  address: path.join(SRC, 'components/map/AddressSearchPanel.vue'),
  poi: path.join(SRC, 'components/map/PoiSearchPanel.vue'),
  circle: path.join(SRC, 'components/map/BusinessCirclePanel.vue'),
  toolbar: path.join(SRC, 'components/map/MapToolbar.vue'),
  storeCtrl: path.join(SRC, 'components/map/StoreControlPanel.vue'),
  smartsteps: path.join(SRC, 'components/SmartstepsPanel.vue'),
  ai: path.join(SRC, 'components/AiAssistant.vue'),
  draggable: path.join(SRC, 'utils/useDraggable.js')
}

const read = (p) => fs.readFileSync(p, 'utf8')

/** 剥 CSS 注释（保留换行，行号不漂） */
function stripCssComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 剥 JS 行注释（`//` 开头到行尾；本仓库的字符串里不出现裸 `//` 于行首） */
function stripJsComments(src) {
  return src.split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n')
}

/**
 * SFC 全文剥注释（CSS 块注释 + JS 行注释）。
 * ⚠️ 为什么 G 组不能用 stripJsComments：MapView 的 `<style>` 里也有解释性注释
 * （例如「原先是 searchPanelPos」这种溯源说明），只剥 `//` 会把 CSS 注释里的
 * 字样当成代码 ⇒ 假红。反过来，只剥 `/* *\/` 又会漏掉脚本里的 `//` 注释。
 */
function stripAllComments(src) {
  return stripJsComments(stripCssComments(src))
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

/** 取 <template> 段 */
function templateOf(vueFile) {
  const src = read(vueFile)
  const start = src.indexOf('<template>')
  // ⚠️ 必须取**最后一个** `</template>`：模板内部有 `<template #default>` / `<template v-if>`
  //    这类插槽与片段，用 indexOf 会在第一个内层闭合处截断，导致后半张模板「查不到」。
  const end = src.lastIndexOf('</template>')
  if (start < 0 || end < 0) return ''
  return src.slice(start, end)
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

/** 某文件里「窄屏」媒体块的正文合集（只认 max-width） */
function narrowBodies(vueFile) {
  return mediaBlocks(styleOf(vueFile))
    .filter((b) => /max-width/.test(b.query))
    .map((b) => b.body)
}

// ============================================================
// A 组：8 个浮层都必须有窄屏覆盖
// ============================================================
describe('A. 窄屏断点覆盖到每个浮层', () => {
  const cases = [
    { name: '地址检索框', file: F.address, sel: '.search-panel' },
    { name: '周边检索', file: F.poi, sel: '.poi-search-panel' },
    { name: '商圈工具', file: F.circle, sel: '.business-circle-panel' },
    { name: '地图工具栏', file: F.toolbar, sel: '.toolbar' },
    { name: '门店工具', file: F.storeCtrl, sel: '.store-tools-panel' },
    { name: '联通人口面板', file: F.smartsteps, sel: '.smartsteps-panel' },
    { name: 'AI 对话面板', file: F.ai, sel: '.ai-panel' },
    { name: '定位门店/行政界/商圈查询（三个共用）', file: F.mapView, sel: '.store-search-panel' }
  ]

  for (const c of cases) {
    it(`${c.name} 在窄屏媒体块里被重新定位`, () => {
      const bodies = narrowBodies(c.file)
      expect(bodies.length, `${path.basename(c.file)} 里一个 max-width 媒体块都没有`).toBeGreaterThan(0)
      // ⚠️ 必须是「选择器 + {」这个规则头，⛔ 不能用 includes：
      //    把 `.business-circle-panel` 改成 `.business-circle-panel-X` 时，
      //    includes 仍然为真 ⇒ 删了窄屏块也能通过（假绿灯，本批变异测试抓到过一次）。
      const escaped = c.sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const headRe = new RegExp(`${escaped}\\s*\\{`)
      const hit = bodies.some((b) => headRe.test(b))
      expect(hit, `${c.sel} 没有被任何窄屏媒体块重新定位`).toBe(true)
    })
  }

  it('窄屏覆盖必须同时给出宽度约束（否则只是挪了位置照样溢出）', () => {
    // 允许 width: auto（配 left+right 夹宽度）或 max-width: calc(...)
    // 只要窄屏块里重新声明了 width / max-width / min-width 即可（auto / calc / 130px 都算）
    const widthish = /(max-|min-)?width\s*:/
    for (const c of cases) {
      const bodies = narrowBodies(c.file).join('\n')
      const block = extractSelectorBlock(bodies, c.sel)
      expect(block, `${c.sel} 的窄屏块取不到`).not.toBeNull()
      expect(widthish.test(block), `${c.sel} 的窄屏块没有宽度约束`).toBe(true)
    }
  })
})

/** 从 CSS 文本里抓某个选择器的规则正文（只取第一层，够用） */
function extractSelectorBlock(css, selector) {
  const idx = css.indexOf(selector)
  if (idx < 0) return null
  const open = css.indexOf('{', idx)
  if (open < 0) return null
  const close = matchBrace(css, open)
  if (close < 0) return null
  return css.slice(open + 1, close)
}

// ============================================================
// B 组：断点值单一来源
// ============================================================
describe('B. 断点只有一个来源（900px）', () => {
  it('useDraggable 的 NARROW_QUERY 是 (max-width: 900px)', () => {
    const src = read(F.draggable)
    const m = /NARROW_QUERY\s*=\s*'([^']+)'/.exec(src)
    expect(m).toBeTruthy()
    expect(m[1]).toBe('(max-width: 900px)')
  })

  it('所有组件的窄屏媒体块都用 900px（JS 与 CSS 必须同源）', () => {
    const files = Object.values(F).filter((p) => p.endsWith('.vue'))
    const seen = []
    for (const f of files) {
      for (const b of mediaBlocks(styleOf(f))) {
        if (!/max-width/.test(b.query)) continue
        seen.push({ file: path.basename(f), query: b.query })
      }
    }
    expect(seen.length).toBeGreaterThan(3)
    const bad = seen.filter((s) => !/max-width\s*:\s*900px/.test(s.query))
    expect(bad, `这些窄屏块用了别的断点：${JSON.stringify(bad)}`).toEqual([])
  })
})

// ============================================================
// C 组：纵向堆叠序号不重复（否则面板会叠在一起）
// ============================================================
describe('C. 右侧竖排的纵向序号唯一', () => {
  /** 从窄屏块里解析「第几位」：显式 `* N` ⇒ N；只引用 stack-top ⇒ 0 */
  const stackIndex = (vueFile, sel) => {
    const bodies = narrowBodies(vueFile).join('\n')
    const block = extractSelectorBlock(bodies, sel)
    if (!block) return null
    const topDecl = /top\s*:\s*([^;]+);/.exec(block)
    if (!topDecl) return null
    const expr = topDecl[1]
    const m = /var\(--narrow-stack-step[^)]*\)\s*\*\s*(\d+)/.exec(expr)
    if (m) return Number(m[1])
    if (/var\(--narrow-stack-top/.test(expr)) return 0
    return null
  }

  const stack = [
    { name: '门店工具', file: F.storeCtrl, sel: '.store-tools-panel' },
    { name: '商圈工具', file: F.circle, sel: '.business-circle-panel' },
    { name: '周边检索', file: F.poi, sel: '.poi-search-panel' },
    { name: '地图工具栏', file: F.toolbar, sel: '.toolbar' }
  ]

  it('4 个面板的序号正好是 0/1/2/3，一个不多一个不少', () => {
    const idx = stack.map((s) => ({ name: s.name, i: stackIndex(s.file, s.sel) }))
    for (const it of idx) expect(it.i, `${it.name} 的窄屏 top 没走堆叠变量`).not.toBeNull()
    const sorted = idx.map((x) => x.i).sort((a, b) => a - b)
    expect(sorted).toEqual([0, 1, 2, 3])
  })

  it('堆叠参数定义在 .map-view 上，步长 ≥ 44px（收起态 header 高度）', () => {
    const css = stripCssComments(styleOf(F.mapView))
    const block = extractSelectorBlock(css, '.map-view')
    expect(block).not.toBeNull()
    expect(block).toMatch(/--narrow-stack-top\s*:\s*\d+px/)
    const step = /--narrow-stack-step\s*:\s*(\d+)px/.exec(block)
    expect(step).toBeTruthy()
    expect(Number(step[1])).toBeGreaterThanOrEqual(44)
    // 首个面板必须排在地址框（top:8 + 高约 52）之下
    const topv = /--narrow-stack-top\s*:\s*(\d+)px/.exec(block)
    expect(Number(topv[1])).toBeGreaterThanOrEqual(60)
  })
})

// ============================================================
// D 组：拖拽必须是 pointer 事件
// ============================================================
describe('D. 拖拽用 pointer 事件（触屏可拖）', () => {
  it('MapView 的检索面板把手用 @pointerdown，且不再有 @mousedown', () => {
    const tpl = templateOf(F.mapView)
    expect((tpl.match(/@pointerdown="onSearchPanelDragStart"/g) || []).length).toBe(3)
    expect(tpl).not.toMatch(/@mousedown="onDragStart"/)
  })

  it('门店商圈图例把手用 @pointerdown', () => {
    const tpl = templateOf(F.mapView)
    expect(tpl).toMatch(/@pointerdown="onLegendDragStart"/)
    expect(tpl).not.toMatch(/@mousedown="onLegendDragStart"/)
  })

  it('联通人口面板把手用 @pointerdown', () => {
    const tpl = templateOf(F.smartsteps)
    expect(tpl).toMatch(/@pointerdown="startDrag"/)
    expect(tpl).not.toMatch(/@mousedown="startDrag"/)
  })

  it('useDraggable 注册并清理 pointer 三件套（含 pointercancel）', () => {
    const src = read(F.draggable)
    for (const ev of ['pointermove', 'pointerup', 'pointercancel']) {
      const add = src.split(`window.addEventListener('${ev}'`).length - 1
      const del = src.split(`window.removeEventListener('${ev}'`).length - 1
      expect(add, `${ev} 没注册`).toBeGreaterThan(0)
      expect(del, `${ev} 没清理`).toBeGreaterThan(0)
    }
  })

  it('拖拽有边界夹取（不能拖出容器）', () => {
    const src = read(F.draggable)
    expect(src).toMatch(/Math\.max\(EDGE/)
    expect(src).toMatch(/hostRect\.width\s*-\s*w\s*-\s*EDGE/)
  })
})

// ============================================================
// E 组：把手必须 touch-action: none
// ============================================================
describe('E. 拖拽把手 touch-action: none（否则手机上拖不动）', () => {
  it('.store-search-header 的 CSS 里有 touch-action: none', () => {
    const css = stripCssComments(styleOf(F.mapView))
    const block = extractSelectorBlock(css, '.store-search-header')
    expect(block).not.toBeNull()
    expect(block).toMatch(/touch-action\s*:\s*none/)
  })

  it('门店商圈图例把手（内联样式）带 touchAction', () => {
    const tpl = templateOf(F.mapView)
    expect(tpl).toMatch(/touchAction:\s*'none'/)
  })

  it('联通人口面板把手（内联样式）带 touch-action', () => {
    expect(templateOf(F.smartsteps)).toMatch(/touch-action:\s*none/)
  })
})

// ============================================================
// F 组：窄屏不得输出内联位置（内联会赢过 @media）
// ============================================================
describe('F. 窄屏时 useDraggable 不输出内联位置', () => {
  it('style computed 开头就是「窄屏 ⇒ 返回空对象」', () => {
    const src = read(F.draggable)
    const i = src.indexOf('const style = computed(')
    expect(i).toBeGreaterThan(0)
    const body = src.slice(i, i + 420)
    expect(body).toMatch(/if\s*\(\s*narrow\.value\s*\)\s*return\s*\{\s*\}/)
    // 反着写等于把桌面也废了
    expect(body).not.toMatch(/if\s*\(\s*!\s*narrow\.value\s*\)\s*return\s*\{\s*\}/)
  })

  it('narrow 是响应式镜像（断点变化要能重算，不能只在模块加载时读一次）', () => {
    const src = read(F.draggable)
    expect(src).toMatch(/const narrow = ref\(/)
    expect(src).toMatch(/addEventListener\('change'/)
  })
})

// ============================================================
// G 组：不得回退到旧写法 / 死样式不得复活
// ============================================================
describe('G. 旧的拖拽状态与死样式不得回来', () => {
  const mapJs = () => stripAllComments(read(F.mapView))

  it('MapView 不再有手写的 searchPanelPos / legendPanelPos', () => {
    const s = mapJs()
    expect(s).not.toMatch(/searchPanelPos/)
    expect(s).not.toMatch(/legendPanelPos/)
  })

  it('MapView 不再有 onDragStart / onDragMove / onDragEnd 这类旧函数', () => {
    const s = mapJs()
    expect(s).not.toMatch(/const onDragStart\s*=/)
    expect(s).not.toMatch(/const onLegendDragMove\s*=/)
  })

  it('.smartsteps-float-btn 死样式不得复活（模板里没有任何引用）', () => {
    // 模板与样式都要查；注释已剥掉 ⇒ 解释性注释不算「复活」
    const tpl = templateOf(F.mapView)
    expect(tpl).not.toMatch(/smartsteps-float-btn/)
    const css = stripCssComments(styleOf(F.mapView))
    expect(css).not.toMatch(/\.smartsteps-float-btn/)
  })
})

// ============================================================
// H 组：负变异 —— 注释里出现这些字样，守卫必须仍然绿
// ============================================================
describe('H. 注释不算代码（负变异）', () => {
  it('CSS 注释里写 .smartsteps-float-btn 不触发 G 组', () => {
    const fake = '/* 已删除 .smartsteps-float-btn，别加回来 */\n.foo { color: red; }'
    expect(stripCssComments(fake)).not.toMatch(/\.smartsteps-float-btn/)
  })

  it('JS 行注释里写 searchPanelPos / @mousedown 不触发 G/D 组', () => {
    const fake = "// 原来是 searchPanelPos，改成 useDraggable；模板曾是 @mousedown=\"onDragStart\"\nconst a = 1"
    const s = stripJsComments(fake)
    expect(s).not.toMatch(/searchPanelPos/)
    expect(s).not.toMatch(/@mousedown/)
  })

  it('真正的旧写法仍然会被抓（剥注释不是万能的遮羞布）', () => {
    expect(stripJsComments('const searchPanelPos = ref({})')).toMatch(/searchPanelPos/)
    expect(stripCssComments('.store-search-panel { top: 60px }')).toMatch(/\.store-search-panel/)
  })
})
