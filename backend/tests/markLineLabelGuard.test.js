/**
 * markLine（均值虚线）标签可见性守卫 —— v1.13.350
 *
 * 为什么需要这份守卫：
 *   门店对比柱状图用 `markLine: { type: 'average' }` 画两条均值虚线（蓝=门店A、绿=门店B）。
 *   label 只写了 `formatter: '均值: {c}'`，**没写 position** ⇒ 用 echarts 默认的 `'end'`，
 *   标签画在虚线的**右端外侧**。而该图的 grid 是 `right: '4%'` + `containLabel: true`，
 *   绘图区右边缘几乎贴着画布右边界（450px 宽的画布上，虚线终点在 x=407）⇒ 标签整体被裁，
 *   只剩一两个像素的字符。用户看到的是「两条虚线有，但不知道它们是多少」。
 *   同一处还有第二个坑：`{c}` 是**原始数值**（如 73700），而 y 轴刻度用「万」，
 *   于是标签与刻度单位不一致，读起来要自己换算。
 *
 * 本守卫钉三件事：
 *   A. 每个 markLine 的 label 都必须显式指定 position，且必须落在**绘图区内侧**白名单
 *      （⛔ 不许 `'end'` / `'start'`：两者都在线外侧，左右各只有 3%~4% 余量，必被裁）
 *   B. label.formatter 必须对 ≥1万 的数值做「万」换算，与 y 轴刻度同单位
 *   C. 提取器本身要自检（⛔ 裸正则失效会静默返 0 个块 ⇒ 守卫变绿灯）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const MAPVIEW = path.join(REPO, 'frontend', 'src', 'views', 'MapView.vue')

/**
 * 从源码里切出 `key: { ... }` 的完整对象块（花括号配对，跳过字符串内部）。
 * 🔴 必须跳过字符串：formatter 里写着 `'均值: {c}'`，其中的 `}` 会被裸计数骗到。
 */
function extractObjectBlocks(src, key) {
  const blocks = []
  const re = new RegExp('\\b' + key + '\\s*:\\s*\\{', 'g')
  let m
  while ((m = re.exec(src)) !== null) {
    const start = src.indexOf('{', m.index)
    let depth = 0
    let quote = null
    for (let i = start; i < src.length; i++) {
      const ch = src[i]
      if (quote) {
        if (ch === '\\') { i++; continue }
        if (ch === quote) quote = null
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          blocks.push(src.slice(start, i + 1))
          re.lastIndex = i + 1
          break
        }
      }
    }
  }
  return blocks
}

/** 只有落在绘图区**内侧**的位置才不会溢出画布 */
const SAFE_POSITIONS = [
  'insideStartTop', 'insideStartBottom',
  'insideMiddleTop', 'insideMiddleBottom',
  'insideEndTop', 'insideEndBottom'
]

const src = fs.readFileSync(MAPVIEW, 'utf8')
const blocks = extractObjectBlocks(src, 'markLine')

describe('C. 提取器自检（⛔ 防裸正则静默返 0 ⇒ 守卫假绿灯）', () => {
  it('能从源码切出至少 2 个 markLine 块（两根柱子各一条均值线）', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(2)
  })

  it('切出的块确实以 { 开头、以 } 结尾，且含 average', () => {
    for (const b of blocks) {
      expect(b.startsWith('{')).toBe(true)
      expect(b.endsWith('}')).toBe(true)
      expect(b).toContain('average')
    }
  })

  it('字符串里的 } 不会把块提前截断（formatter 含 {c}）', () => {
    const demo = `a: { markLine: { label: { formatter: '均值: {c}' } }, z: 1 }`
    const got = extractObjectBlocks(demo, 'markLine')
    expect(got).toHaveLength(1)
    expect(got[0]).toContain("formatter: '均值: {c}'")
    expect(got[0].endsWith('}')).toBe(true)
    expect(got[0]).not.toContain(', z: 1')
  })

  it('嵌套对象能完整切出（label 里的对象不被当结尾）', () => {
    const demo = `x: { markLine: { lineStyle: { type: 'dashed' }, label: { color: '#fff' } } }`
    const got = extractObjectBlocks(demo, 'markLine')
    expect(got).toHaveLength(1)
    expect(got[0]).toContain("label: { color: '#fff' }")
  })
})

/**
 * 两条均值线的标签样式必须是**同一个工厂函数**产出的。
 * 🔴 理由：position 与「万」换算这两件事一旦两处内联，改一处忘一处必然漂移
 *    （历史上 `'均值: {c}'` 就是这么在两处各复制一遍的）。
 */
const FACTORY = 'avgLineLabelStyle'
const factorySrc = (() => {
  const i = src.indexOf('const ' + FACTORY)
  if (i < 0) return ''
  const j = src.indexOf('\n})', i) // 箭头函数 `=> ({ ... })` 的收尾
  return j > 0 ? src.slice(i, j + 3) : src.slice(i, i + 1200)
})()

describe('A. 每个 markLine 的标签必须在绘图区内侧', () => {
  it('两根柱子的均值线都走同一个标签工厂（⛔ 不许各自内联）', () => {
    for (const b of blocks) {
      expect(b, 'markLine 的 label 必须由 ' + FACTORY + ' 生成').toContain('label: ' + FACTORY)
    }
  })

  it('工厂里显式指定了 position，且落在绘图区内侧白名单', () => {
    const pm = factorySrc.match(/position\s*:\s*'([A-Za-z]+)'/)
    expect(pm, '标签未写 position ⇒ 默认 end ⇒ 被画布右边界裁切').toBeTruthy()
    expect(SAFE_POSITIONS).toContain(pm[1])
  })

  it('🔴 禁止 end / start：两者都在虚线外侧，左右余量只有 3%~4%，必被裁', () => {
    const pm = factorySrc.match(/position\s*:\s*'([A-Za-z]+)'/)
    if (pm) {
      expect(pm[1]).not.toBe('end')
      expect(pm[1]).not.toBe('start')
    }
  })
})

describe('B. 标签数值与 y 轴同为「万」口径', () => {
  it('工厂的 formatter 是函数（⛔ 不许用 `均值: {c}` 字符串，无法换算单位）', () => {
    expect(factorySrc).toContain('formatter')
    expect(factorySrc).toMatch(/formatter\s*:\s*\(/)
  })

  it('formatter 对 ≥1万 做万换算（⛔ 不许直接吐 73700）', () => {
    expect(factorySrc).toContain('10000')
    expect(factorySrc).toContain('万')
  })

  it('y 轴刻度也用万（两处口径必须一致，改一处漏一处即视为回归）', () => {
    expect(src).toContain("if (val >= 10000) return (val / 10000) + '万'")
  })
})
