/**
 * 候选点位页「返回地图」位置守卫（批次 401）
 *
 * ── 为什么改 ────────────────────────────────────────────────────────────
 * 401 之前「← 返回地图」挂在 `.cd-head-l` 最上面，孤零零地压在标题和三行说明
 * 之上；右侧 `.cd-head-r` 则是「刷新 / 新建独立点位」两个动作按钮。
 * 业主的要求是：页面上所有「可点」的东西集中在同一簇，返回放到刷新左侧。
 *
 * ── 守什么 ──────────────────────────────────────────────────────────────
 *   ① 返回地图**在** `.cd-head-r` 里，且排在「刷新」之前（顺序不能乱）
 *   ② `.cd-head-l` 里**不再有**它（防止两处都写、或改回去只改一半）
 *   ③ `.cd-head-r` 必须 `align-items: center` —— 组里混了 link 型文字按钮，
 *      默认 stretch 会让它和实体按钮上下错位（纯实体按钮时看不出来）
 *   ④ `@click="goBack"` 不能丢（挪位置时最容易连带删掉绑定）
 *   ⑤ `.cd-head-l` 的第一个元素是 `<h2>`（标题复位到顶端，不再被按钮顶下去）
 *
 * 🔴 守卫自身规范：扫源码先剥注释 —— 本次改动的说明注释里就写着「返回地图」
 *    和 `.cd-head-r`，不剥会把注释当代码，断言假绿。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const VIEW = 'frontend/src/views/CandidateView.vue'

const raw = fs.readFileSync(path.join(REPO, VIEW), 'utf8')

/** 剥 Vue HTML 注释 → JS 块注释 → 行注释（HTML 必须最先剥）。 */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const src = strip(raw)

/** 截出 `class="xxx"` 所在元素到其闭合 `</div>` 之间的片段（该容器内只有按钮，无嵌套 div）。 */
function headBlock(cls) {
  const i = src.indexOf(`class="${cls}"`)
  expect(i, `找不到 .${cls} 容器`).toBeGreaterThan(-1)
  const end = src.indexOf('</div>', i)
  expect(end, `.${cls} 没有闭合 </div>`).toBeGreaterThan(i)
  return src.slice(i, end)
}

describe('候选点位页头 · 返回地图位置（v1.13.401）', () => {
  const RIGHT = headBlock('cd-head-r')
  const LEFT = headBlock('cd-head-l')

  it('① 返回地图在右侧动作组里，且排在「刷新」之前', () => {
    expect(RIGHT).toContain('返回地图')
    const iBack = RIGHT.indexOf('返回地图')
    const iReload = RIGHT.indexOf('刷新')
    expect(iReload, '右侧动作组里找不到「刷新」').toBeGreaterThan(-1)
    expect(iBack, '返回地图必须排在刷新左侧（DOM 顺序＝视觉顺序）').toBeLessThan(iReload)
  })

  it('② 左侧标题块里不再有返回地图（改位置不能两处都留）', () => {
    expect(LEFT).not.toContain('返回地图')
  })

  it('③ 右侧动作组 align-items: center（link 按钮与实体按钮垂直居中）', () => {
    const rule = (src.match(/\.cd-head-r\s*\{[^}]*\}/) || [''])[0]
    expect(rule, '找不到 .cd-head-r 样式规则').not.toBe('')
    expect(rule).toContain('align-items: center')
  })

  it('④ @click="goBack" 绑定没在挪动中丢掉', () => {
    expect(RIGHT).toMatch(/@click="goBack"/)
    expect(src).toMatch(/function goBack\(|const goBack\s*=/)
  })

  it('⑤ 标题回到左侧块首位（不再被按钮顶下去）', () => {
    const first = LEFT.indexOf('<h2>')
    const firstTag = LEFT.search(/<(el-button|div|h2|p)\b/)
    expect(first, '左侧块里找不到 <h2>').toBeGreaterThan(-1)
    expect(first, '左侧块第一个元素必须是 <h2>').toBe(firstTag)
  })

  it('⑥ 返回地图只出现一次（防止两处都渲染）', () => {
    const n = src.split('返回地图').length - 1
    expect(n).toBe(1)
  })
})
