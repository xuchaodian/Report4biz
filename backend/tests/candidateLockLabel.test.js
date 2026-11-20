/**
 * 候选点位「操作列」删除/锁标记 源码守卫（批次 383）
 *
 * ── 为什么要守 ──────────────────────────────────────────────────────────
 * 门店来源的点位不能删（删了门店还在、刷新复活，后端也 400 兜底）。产品上用一句灰字
 * 占住「删除」的位置，靠 hover tooltip 解释原因。
 *
 * 旧文案是「门店视图」—— 四个字读起来像**可点的视图入口**，用户点下去没反应，
 * 属于文案失败而非功能缺失（已由业主确认改掉）。这组断言钉死三件事：
 *
 *   ① 文案必须自解释：「我的门店」说明来源、「不可删」说明限制
 *   ② 锁标记**不可点**（无 @click）—— 一旦绑了事件就成了假入口
 *   ③ 🔴 列宽必须容得下三段内容：`详情 34 + 12 + 初步分析 62 + 12 + 灰字 94 = 214`，
 *      而 el-table 的 `.cell` 左右各 12px padding ⇒ 列宽 ≥ **238**。
 *      232 那次真实事故：可用 208 < 需要 214 ⇒ `nowrap` 溢出 6px，
 *      `align=center` 把溢出的灰字向左推、**盖住「初步分析」按钮**（截图可见）。
 *      这是「改文案忘改列宽」的典型，静态测试能提前抓住。
 *
 * 🔴 守卫自身规范：扫源码必须剥注释，否则注释里的旧文案会让断言假红。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const VIEW = 'frontend/src/views/CandidateView.vue'

const raw = fs.readFileSync(path.join(REPO, VIEW), 'utf8')

/** 剥 Vue HTML 注释 → JS 块注释 → 行注释。HTML 必须最先剥（见 candidateBriefGuard 里的血泪说明）。 */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const src = strip(raw)

/** 截出「操作」列声明到该列 </el-table-column> 之间的模板片段。 */
function operationColumnBlock() {
  const start = src.indexOf('label="操作"')
  expect(start, '找不到「操作」列声明').toBeGreaterThan(-1)
  const end = src.indexOf('</el-table-column>', start)
  expect(end, '「操作」列没有闭合标签').toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('383 候选点位操作列：门店来源不可删的灰字', () => {
  it('文案自解释：出现「我的门店 · 不可删」，旧文案「门店视图」不再作为可见文本', () => {
    const block = operationColumnBlock()
    expect(block).toContain('我的门店 · 不可删')
    // 旧文案只允许出现在注释里（已被 strip 剥掉），渲染文本里不许再有
    expect(block).not.toMatch(/>\s*门店视图\s*</)
  })

  it('锁标记不是按钮：span 上没有任何点击绑定（假入口比不显示更糟）', () => {
    const block = operationColumnBlock()
    const m = block.match(/<span[^>]*class="cd-lock"[^>]*>/)
    expect(m, '找不到 cd-lock 的 span 标签').not.toBeNull()
    expect(m[0]).not.toContain('@click')
    expect(m[0]).not.toContain('@keyup')
    expect(m[0]).not.toContain('tabindex')
  })

  it('tooltip 只留操作指引（来源与限制已在字面上，不再重复）', () => {
    const block = operationColumnBlock()
    const m = block.match(/<span[^>]*class="cd-lock"[^>]*>/)
    const title = (m[0].match(/title="([^"]*)"/) || [])[1] || ''
    expect(title).toContain('我的门店')
    expect(title).toContain('已开业')
    expect(title, 'tooltip 不该再重复「不可删」——字面已经写了').not.toContain('不可删')
  })

  it('独立点位仍然可删：删除按钮保留 @click.stop="remove(row)"，且按 origin 互斥', () => {
    const block = operationColumnBlock()
    expect(block).toMatch(/v-if="row\.origin !== 'store'"/)
    expect(block).toMatch(/@click\.stop="remove\(row\)"[^>]*>删除</)
    // v-else 落在同一个槽位上（否则两个会同时出现）
    expect(block).toMatch(/<span v-else class="cd-lock"/)
  })

  it('🔴 列宽 ≥ 238（214 内容 + 24 padding），防「改文案忘改列宽」导致灰字压住按钮', () => {
    const block = operationColumnBlock()
    const w = Number((block.match(/label="操作"\s+width="(\d+)"/) || [])[1])
    expect(w, '解析不出操作列 width').toBeGreaterThan(0)
    expect(w, `操作列宽 ${w} 太窄：详情34 + 12 + 初步分析62 + 12 + 灰字94 = 214，加左右 padding 24 ⇒ 至少 238`)
      .toBeGreaterThanOrEqual(238)
  })

  it('.cd-lock 必须 nowrap 且与按钮保持 12px 间距（对齐 el-button 的默认 margin）', () => {
    const rule = (src.match(/\.cd-lock\s*\{[^}]*\}/) || [''])[0]
    expect(rule).toContain('white-space: nowrap')
    expect(rule).toContain('margin-left: 12px')
  })
})
