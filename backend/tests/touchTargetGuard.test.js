/**
 * 触控目标尺寸守卫（v1.13.362 立，批次 361-A）
 *
 * 背景：2026-11-13 生产实测 `/data` 的「操作」列，5 个图标按钮各 **20×20**
 *   （`.el-button.is-link` 的 `padding:2px` + 16px 图标），间距 12px。
 *   WCAG 2.5.8（Target Size (Minimum)，AA）要求 ≥24×24 ⇒ 判失败。
 *   纯键盘/读屏用户感觉不到，但触屏与手抖用户会反复误点（删除按钮就在最右边）。
 *
 * 修复分两层，**两层都必须靠 CSS 实现且互斥**：
 *   ① 所有指针：伪元素把热区外扩到 32×32 —— 桌面端视觉与布局零变化；
 *   ② `@media (pointer: coarse)`：真放大到 44×44（2.5.5 AAA），并撤销 ① 的外扩。
 *
 * ⛔ 最值钱的三条判断（破坏任一条都不是"少个样式"，而是"更容易误点"）：
 *   ① **外扩必须撤销**。①的 6px 是按 20px 按钮 + 12px 间距算的；按钮真长到 44px 后
 *      若仍外扩 6px，相邻热区会**重叠 8px** —— 重叠区里点谁都可能落到邻键上，
 *      比小按钮 Worse（2.5.8 明确要求目标之间不重叠）。
 *   ② **列宽必须走绑定**。EP 把列宽写成 `<col style="width:220px">`，行内 style 压不过
 *      普通 CSS；想靠 CSS 在触屏下收窄列宽是**改不动的死代码**。
 *   ③ **列宽与网格必须算术自洽**：内容宽 = 3×44 + 2×gap，列宽 = 内容宽 + 24（cell 左右 padding）。
 *      三者任一被改动而另两个没跟 ⇒ 要么按钮被 `overflow:hidden` 裁掉，要么白留一截空列。
 *
 * （前端无独立测试框架，与 a11ySemanticsGuard / brandTokenGuard 一致挂在 backend vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_SRC = path.resolve(__dirname, '../../frontend/src')
const DATA_VIEW = path.join(FRONTEND_SRC, 'views/DataView.vue')

const src = fs.readFileSync(DATA_VIEW, 'utf8')

/** 粗切 <template> 段（够用：断言只看标签属性） */
function templateOf(s) {
  const start = s.indexOf('<template>')
  const end = s.lastIndexOf('</template>')
  return start >= 0 && end > start ? s.slice(start, end) : ''
}
/** 粗切最后一个 <style> 段（DataView 只有一个 scoped 块） */
function styleOf(s) {
  const start = s.indexOf('<style')
  const end = s.lastIndexOf('</style>')
  return start >= 0 && end > start ? s.slice(start, end) : ''
}
/** 取 `@media (pointer: coarse) { … }` 的完整块（按花括号配平，避免被嵌套规则截断） */
function coarseMediaBlock(css) {
  const at = css.indexOf('@media (pointer: coarse)')
  if (at < 0) return ''
  const open = css.indexOf('{', at)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(at, i + 1)
    }
  }
  return ''
}

const TEMPLATE = templateOf(src)
const STYLE = styleOf(src)
const COARSE = coarseMediaBlock(STYLE)

describe('361-A 操作列触控目标 · 模板接线', () => {
  it('操作列带 class-name="op-cell"（样式块的唯一锚点）', () => {
    expect(TEMPLATE).toMatch(/<el-table-column[^>]*label="操作"[^>]*class-name="op-cell"/)
  })

  it('列宽走 :width 绑定，不得写死 width="220"', () => {
    // ⛔ 写死的话触屏收窄根本不生效（EP 用行内 style 写 <col>，CSS 压不过）
    expect(TEMPLATE).toMatch(/<el-table-column[^>]*:width="actionColWidth"[^>]*fixed="right"/)
    expect(TEMPLATE).not.toMatch(/<el-table-column[^>]*label="操作"[^>]*\swidth="\d+"/)
  })

  it('仍保留 fixed="right"（外扩热区依赖列宽内余量，右固定不能丢）', () => {
    expect(TEMPLATE).toMatch(/label="操作"[^>]*fixed="right"/)
  })
})

describe('361-A 操作列触控目标 · 第①层（所有指针，零布局变化）', () => {
  it('🔴 选择器必须写成 `td.op-cell`，不得裸写 `.op-cell`', () => {
    // 生产实测（2026-11-13）：EP 的 class-name **同时落在表头 <th> 上** ——
    // 页面上共 21 个 .op-cell ＝ 20 行 + 1 个表头。裸写的话 coarse 的 display:grid
    // 会把「操作」二字塞进 44px 的第一列（表头无按钮却按按钮网格排版）。
    expect(STYLE).not.toMatch(/:deep\(\.op-cell\)/)
    expect(STYLE).toMatch(/:deep\(td\.op-cell\)/)
  })

  it('按钮补了 position:relative（EP 基线没有，不补伪元素会跑到祖先身上）', () => {
    expect(STYLE).toMatch(/:deep\(td\.op-cell\)\s*\.el-button\s*\{[^}]*position:\s*relative/)
  })

  it('伪元素外扩 6px（20 + 6×2 = 32，正好吃满 12px 间距的一半）', () => {
    expect(STYLE).toMatch(/:deep\(td\.op-cell\)\s*\.el-button::after\s*\{[^}]*inset:\s*-6px/)
  })

  it('外扩不得超出 cell 的 12px padding（否则被 .cell 的 overflow:hidden 裁掉）', () => {
    // 反证：只要不是 6px 就必须重新算列宽余量，这里把假设钉死
    const m = STYLE.match(/\.el-button::after\s*\{[^}]*inset:\s*-(\d+)px/)
    expect(m).toBeTruthy()
    expect(Number(m[1])).toBe(6)
    expect(Number(m[1])).toBeLessThanOrEqual(12)
  })

  it('🔴 操作列的 .cell 放开裁切（不放开 ⇒ 垂直只剩 23px，命中区退化成 30×24，卡在 AA 的 24 边界）', () => {
    // 实测（2026-11-13 生产 /data）：td 上下各 8px padding，41px 行高里 cell 只剩 23px，
    // overflow:hidden 把伪元素的垂直外扩裁掉 ⇒ 30×24。放开后是 30×30。
    expect(STYLE).toMatch(/:deep\(td\.op-cell\)\s*\.cell\s*\{\s*overflow:\s*visible/)
  })
})

describe('361-A 操作列触控目标 · 第②层（coarse pointer）', () => {
  it('存在 @media (pointer: coarse) 块', () => {
    expect(COARSE).not.toBe('')
  })

  it('按钮真放大到 44×44（WCAG 2.5.5 AAA）', () => {
    expect(COARSE).toMatch(/min-width:\s*44px/)
    expect(COARSE).toMatch(/height:\s*44px/)
  })

  it('3 列网格，每列 44px', () => {
    expect(COARSE).toMatch(/grid-template-columns:\s*repeat\(3,\s*44px\)/)
  })

  it('grid 里清掉 EP 的 margin-left:12px（否则 140 的内容宽被撑破）', () => {
    expect(COARSE).toMatch(/margin-left:\s*0/)
  })

  it('🔴 撤销第①层的伪元素外扩（不撤 ⇒ 相邻 44px 热区重叠 8px，比小按钮更糟）', () => {
    expect(COARSE).toMatch(/\.el-button::after\s*\{[^}]*content:\s*none/)
  })
})

describe('361-A 操作列触控目标 · 列宽算术自洽', () => {
  it('列宽常量 = 3×44 + 2×gap + 24(padding)，与 CSS 里的 44 / gap 同源', () => {
    // 从源码解析，而不是抄期望值 —— 改 44 或 gap 而忘了改列宽时，这条会红
    const btn = Number((COARSE.match(/repeat\(3,\s*(\d+)px\)/) || [])[1])
    const gap = Number((COARSE.match(/gap:\s*(\d+)px/) || [])[1])
    const CELL_PADDING_X = 12 // .el-table--default .cell { padding: 0 12px }
    const declared = Number((src.match(/ACTION_COL_WIDTH_COARSE\s*=\s*(\d+)/) || [])[1])

    expect(btn).toBe(44)
    expect(gap).toBeGreaterThan(0)
    expect(declared).toBe(3 * btn + 2 * gap + CELL_PADDING_X * 2)
  })

  it('桌面端列宽仍是 220（本次不改桌面布局）', () => {
    expect(src).toMatch(/ACTION_COL_WIDTH_FINE\s*=\s*220/)
  })

  it('两种指针类型都有取值，computed 不会返回 undefined', () => {
    expect(src).toMatch(/isCoarsePointer\.value\s*\?\s*ACTION_COL_WIDTH_COARSE\s*:\s*ACTION_COL_WIDTH_FINE/)
  })
})

describe('361-A 操作列触控目标 · 媒体查询监听健壮性', () => {
  it('matchMedia 做了环境判空（SSR / 老 WebView 不得抛错）', () => {
    expect(src).toMatch(/typeof window\s*!==\s*'undefined'/)
    expect(src).toMatch(/typeof window\.matchMedia\s*===\s*'function'/)
  })

  it('同时兼容 addEventListener 与已废弃的 addListener', () => {
    expect(src).toMatch(/coarsePointerMq\.addEventListener/)
    expect(src).toMatch(/coarsePointerMq\.addListener/)
  })
})
