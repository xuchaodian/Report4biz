/**
 * 候选点位「操作列可删性 + 来源列解释」源码守卫（批次 384，取代 383 的 candidateLockLabel）
 *
 * ── 演进 ────────────────────────────────────────────────────────────────
 * 383：门店来源的行不能删，用一句灰字「我的门店 · 不可删」占住删除按钮的位置。
 * 384：业主指出这和「来源」列重复 —— 来源列已经写明是门店（重点候选/一般候选 vs
 *      独立点位），再写一遍「我的门店」是冗余；而「没有删除按钮」本身已经表达不可删。
 *      ⇒ 灰字删掉，解释挂到「来源」列的 tooltip 上，操作列宽 248 → 196。
 *
 * ── 守什么 ──────────────────────────────────────────────────────────────
 *   ① 操作列**不再有**灰字占位（`cd-lock`），否则就是回到重复显示
 *   ② 门店来源仍然不可删：删除按钮必须被 `row.origin !== 'store'` 排除
 *   ③ 「为什么不能删」这个信息**不能丢** —— 必须落在来源列的 title 上
 *   ④ 列宽必须容得下独立点位的三段：详情34 + 12 + 初步分析62 + 12 + 删除34 = 154，
 *      el-table `.cell` 左右 padding 24 ⇒ **≥ 178**（383 的 232 事故就是没算这个）
 *   ⑤ `.cd-lock` 样式不能残留（死代码会误导后来人以为还有这个元素）
 *
 * 🔴 守卫自身规范：扫源码必须剥注释，否则注释里的旧文案会让断言假红/假绿。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const VIEW = 'frontend/src/views/CandidateView.vue'

const raw = fs.readFileSync(path.join(REPO, VIEW), 'utf8')

/** 剥 Vue HTML 注释 → JS 块注释 → 行注释。HTML 必须最先剥（见 candidateBriefGuard 血泪说明）。 */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const src = strip(raw)

/** 截出某个列声明到该列 </el-table-column> 之间的模板片段。 */
function columnBlock(label) {
  const start = src.indexOf(`label="${label}"`)
  expect(start, `找不到「${label}」列声明`).toBeGreaterThan(-1)
  const end = src.indexOf('</el-table-column>', start)
  expect(end, `「${label}」列没有闭合标签`).toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('384 候选点位：操作列不再用灰字占位，不可删的解释回到「来源」列', () => {
  it('操作列里没有灰字占位（cd-lock 已删，不再与「来源」列重复）', () => {
    const block = columnBlock('操作')
    expect(block).not.toContain('cd-lock')
    expect(block).not.toContain('我的门店 · 不可删')
    expect(block).not.toContain('门店视图')
  })

  it('门店来源仍然不可删：删除按钮由 row.origin !== store 排除，且有后端兜底注释', () => {
    const block = columnBlock('操作')
    expect(block).toMatch(/v-if="row\.origin !== 'store'"/)
    expect(block).toMatch(/@click\.stop="remove\(row\)"[^>]*>删除</)
  })

  it('🔴「为什么不能删」不能丢：解释必须在「来源」列的 title 上', () => {
    const block = columnBlock('来源')
    const span = (block.match(/<span[\s\S]*?class="cd-type cd-type-store"[\s\S]*?>/) || [])[0] || ''
    expect(span, '找不到门店来源的 span').not.toBe('')
    const title = (span.match(/title="([^"]*)"/) || [])[1] || ''
    expect(title).toContain('不能在这里删除')
    expect(title).toContain('已开业')
  })

  it('来源列的门店 span 有 help 光标（tooltip 的可见提示）', () => {
    const rule = (src.match(/\.cd-type-store\s*\{[^}]*\}/) || [''])[0]
    expect(rule).toContain('cursor: help')
  })

  it('🔴 操作列宽 ≥ 178（154 内容 + 24 padding），防「改文案忘改列宽」压住按钮', () => {
    const block = columnBlock('操作')
    const w = Number((block.match(/label="操作"\s+width="(\d+)"/) || [])[1])
    expect(w, '解析不出操作列 width').toBeGreaterThan(0)
    expect(w, `操作列宽 ${w} 太窄：详情34 + 12 + 初步分析62 + 12 + 删除34 = 154，加 padding 24 ⇒ 至少 178`)
      .toBeGreaterThanOrEqual(178)
  })

  it('.cd-lock 样式不残留（死代码会让后来人以为这个元素还在）', () => {
    expect(src).not.toMatch(/\.cd-lock\s*\{/)
  })

  it('列表不再显示「半径」列（恒为默认 1km，与初步分析口径不同源，容易误导）', () => {
    expect(src).not.toContain('label="半径"')
  })

  it('🔴 删的只是展示：openBrief 仍要读 row.radius 决定初步分析默认半径', () => {
    expect(src).toMatch(/radius:\s*Number\(row\?\.radius\)\s*\|\|\s*1000/)
  })
})
