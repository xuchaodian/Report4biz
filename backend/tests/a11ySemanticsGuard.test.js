/**
 * 无障碍语义守卫（v1.13.356 立，A 档）
 *
 * 背景（2026-11-12 a11y 审计，与 brandTokenGuard 同一份报告的另一半）：
 *   B 档管「看得见」的配色对比度；A 档管「看不见」的语义 —— 视力正常 + 用鼠标的人
 *   完全感受不到差异，但读屏软件用户和纯键盘用户会被卡死。
 *
 * 本批修的四类：
 *   ① 表单控件只有 placeholder / 旁边放个 <span> 当标签 ⇒ 读屏只念「组合框」，
 *      不知道在选什么（WCAG 4.1.2 可访问名称）；
 *   ② 可滚动区域是裸 div ⇒ Tab 键永远进不去，键盘用户滚不动（WCAG 2.1.1）；
 *   ③ Element Plus 的 el-upload 触发区本身就是 div[role=button][tabindex=0]，
 *      里面再放 <el-button> ⇒ 「可聚焦元素套可聚焦元素」，Tab 停两次、读屏连报两层
 *      按钮（axe: nested-interactive）；
 *   ④ ECharts 画在 canvas 上，没有文本等价物 ⇒ 读屏一句都读不到。
 *
 * ⛔ 三条必须记住的判断：
 *   ① **图表不要手写 `role="img"` 到容器上**。ECharts 只要 `aria.enabled` 为真，
 *      渲染时会自己给容器 `setAttribute('role','img')` + `aria-label`；
 *      手写一份会被每次 setOption 覆盖 —— 看着改了，实际是死代码（G1 的判定依据）。
 *   ② **`aria: { enabled: true }` 必须配 `label.description`**。只开 enabled 而不给
 *      description 时，ECharts 在「无 series」分支会 `setAttribute('role','img')`
 *      后直接 return（见 echarts/lib/visual/aria.js setLabel），留下一个
 *      role=img 却没有名字的元素 —— 这比不设 role 更糟（G2）。
 *   ③ **不得用 `aria-hidden` + `tabindex="-1"` 掩盖嵌套交互**。焦点仍在，
 *      只是从读屏树里消失，属 WCAG 4.1.2 反面教材；正确做法是把内层换成不可聚焦元素。
 *
 * （前端无独立测试框架，故与 brandTokenGuard / vipColorUnifyGuard 一致挂在 backend vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_SRC = path.resolve(__dirname, '../../frontend/src')

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    if (entry.name.includes('.bak_')) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(abs, acc)
    else if (/\.(vue|js|scss)$/.test(entry.name)) acc.push(abs)
  }
  return acc
}

const SRC_FILES = walk(FRONTEND_SRC)
const VUE_FILES = SRC_FILES.filter(f => f.endsWith('.vue'))

const rel = abs => path.relative(FRONTEND_SRC, abs).replace(/\\/g, '/')
const read = abs => fs.readFileSync(abs, 'utf8')

/** 取 `.vue` 的 <template> 段（粗切，够用；断言只针对模板结构） */
function templateOf(src) {
  const start = src.indexOf('<template>')
  const end = src.lastIndexOf('</template>')
  if (start < 0 || end < 0 || end <= start) return ''
  return src.slice(start, end)
}

describe('无障碍语义（A 档 v1.13.356）', () => {
  it('G1 · 每个 echarts.init 都必须开启 aria（canvas 无文本等价物）', () => {
    const hits = []
    for (const abs of VUE_FILES) {
      const src = read(abs)
      const initCnt = (src.match(/echarts\.init\(/g) || []).length
      if (!initCnt) continue
      // 两种写法都算：对象字面量 `aria: { enabled: true` 与后续注入 `option.aria = { ... enabled: true`
      const literalCnt = (src.match(/aria:\s*\{\s*enabled:\s*true/g) || []).length
      const assignCnt = (src.match(/\.aria\s*=\s*\{[^}]*enabled:\s*true/gs) || []).length
      const covered = literalCnt + assignCnt
      if (covered < initCnt) {
        hits.push(`${rel(abs)}  echarts.init ${initCnt} 处 / 开启 aria ${covered} 处`)
      }
    }
    expect(hits, '有图表没开 aria ⇒ 读屏读不到内容（ECharts 会在 aria.enabled 时自动写 role="img" + 描述）:\n' + hits.join('\n')).toEqual([])
  })

  it('G2 · 开启 aria 时必须同时给 label.description（否则留下无名 role=img）', () => {
    const hits = []
    for (const abs of VUE_FILES) {
      const src = read(abs)
      // 逐个 aria 开启点向后 300 字符内必须出现 description
      const re = /aria:\s*\{\s*enabled:\s*true/g
      let m
      while ((m = re.exec(src))) {
        const window = src.slice(m.index, m.index + 300)
        if (!/description\s*:/.test(window)) {
          const line = src.slice(0, m.index).split('\n').length
          hits.push(`${rel(abs)}:${line}  aria 开启但无 label.description`)
        }
      }
      const re2 = /\.aria\s*=\s*\{[^}]*enabled:\s*true[^}]*\}/gs
      let m2
      while ((m2 = re2.exec(src))) {
        if (!/description\s*:/.test(m2[0])) {
          const line = src.slice(0, m2.index).split('\n').length
          hits.push(`${rel(abs)}:${line}  option.aria 赋值但无 label.description`)
        }
      }
    }
    expect(hits, 'ECharts 无 series 时会「先设 role=img 再 return」，结果是无名称的 img:\n' + hits.join('\n')).toEqual([])
  })

  it('G3 · /district-insight 分析品牌下拉必须有 aria-label', () => {
    const abs = path.join(FRONTEND_SRC, 'views/DistrictInsightView.vue')
    const src = read(abs)
    // 找到绑定 analysisBrand 的那个 el-select 开标签
    const m = src.match(/<el-select[^>]*v-model="analysisBrand"[^>]*>/s)
    expect(m, 'DistrictInsightView 里找不到 analysisBrand 下拉').toBeTruthy()
    expect(m[0], '分析品牌下拉缺 aria-label（原名称只写在 placeholder 里，读屏不进输入框读不到）').toMatch(/aria-label=/)
  })

  it('G4 · /data 销售录入年份下拉必须有 aria-label', () => {
    const abs = path.join(FRONTEND_SRC, 'views/DataView.vue')
    const src = read(abs)
    const m = src.match(/<el-select[^>]*v-model="saleYear"[^>]*>/s)
    expect(m, 'DataView 里找不到 saleYear 下拉').toBeTruthy()
    // 旁边的 <span>年份</span> 只是视觉标签，没有 for/id 关联 ⇒ 必须 aria-label
    expect(m[0], '年份下拉缺 aria-label（旁边的 <span>年份</span> 不构成可访问名称）').toMatch(/aria-label=/)
  })

  it('G5 · 可滚动面板 .mm-left 必须可聚焦且有名（Tab 能进、读屏能报）', () => {
    const abs = path.join(FRONTEND_SRC, 'views/MarketMapView.vue')
    const src = read(abs)
    const m = src.match(/<div[^>]*class="mm-left"[^>]*>/s)
    expect(m, '找不到 .mm-left 开标签').toBeTruthy()
    const tag = m[0]
    expect(tag, '.mm-left 有 overflow-y:auto 却不可聚焦 ⇒ 键盘用户滚不动（WCAG 2.1.1）').toMatch(/tabindex="0"/)
    expect(tag, '.mm-left 缺 role=region（有 aria-label 也必须配 role 才成「区域」语义）').toMatch(/role="region"/)
    expect(tag, '.mm-left 缺 aria-label（role=region 没有名称等于没报出这是什么）').toMatch(/aria-label=/)
    // 焦点环：加 tabindex 却不给可见焦点样式，等于让键盘用户「猜自己在哪」（WCAG 2.4.7）。
    // ⚠️ 必须连 outline 声明一起断言 —— 只匹配 `.mm-left:focus-visible` 这个选择器名字，
    //    会被 `.mm-left:focus-visible-disabled {` 之类的变体骗过（变异测试 M6 踩过：假绿灯）。
    expect(src, '.mm-left 有 tabindex 但 :focus-visible 规则里没有 outline（键盘用户看不到焦点在哪）')
      .toMatch(/\.mm-left:focus-visible\s*\{[^}]*outline\s*:/)
  })

  it('G6 · el-upload 内不得出现可聚焦元素（防嵌套交互回归）', () => {
    const hits = []
    for (const abs of VUE_FILES) {
      const src = read(abs)
      const re = /<el-upload\b([\s\S]*?)<\/el-upload>/g
      let m
      while ((m = re.exec(src))) {
        const body = m[1]
        // 只看 slot 内容（第一个 > 之后）
        // ⚠️ 必须先剥 HTML 注释：注释里写「原 <el-button> ⇒ 嵌套交互」会被当成真代码
        //    报假红（真踩过）。剥注释后剩下的才是实际渲染进 DOM 的元素。
        const slot = body.slice(body.indexOf('>') + 1).replace(/<!--[\s\S]*?-->/g, '')
        const bad = []
        if (/<el-button\b/.test(slot)) bad.push('el-button')
        if (/<button\b/.test(slot)) bad.push('<button>')
        if (/<a\s[^>]*href/.test(slot)) bad.push('<a href>')
        if (/tabindex="0"/.test(slot)) bad.push('tabindex="0"')
        if (/aria-hidden="true"/.test(slot)) bad.push('aria-hidden（掩盖而非修复）')
        if (bad.length) {
          const line = src.slice(0, m.index).split('\n').length
          hits.push(`${rel(abs)}:${line}  el-upload 内出现 ${bad.join(' / ')}`)
        }
      }
    }
    expect(hits, 'el-upload 触发区本身已是 div[role=button][tabindex=0]，内层再放可聚焦元素 = nested-interactive:\n' + hits.join('\n')).toEqual([])
  })

  it('G7 · 禁止用「图表容器手写 role="img"」代替 ECharts aria（会被 setOption 覆盖）', () => {
    const hits = []
    for (const abs of VUE_FILES) {
      const tpl = templateOf(read(abs))
      // 找模板里带 ref="xxxChart" 的自闭合 div 上是否有手写 role="img"
      const re = /<div[^>]*ref="[a-zA-Z]*Chart[a-zA-Z]*"[^>]*>/g
      let m
      while ((m = re.exec(tpl))) {
        if (/role="img"/.test(m[0])) {
          const line = tpl.slice(0, m.index).split('\n').length
          hits.push(`${rel(abs)}  模板 <template> 内第 ${line} 行 图表容器手写 role="img"`)
        }
      }
    }
    expect(hits, '图表容器的 role="img" 必须由 ECharts 在 aria.enabled 时自己写；手写的会被每次 setOption 覆盖成死代码:\n' + hits.join('\n')).toEqual([])
  })
})
