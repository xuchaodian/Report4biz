/**
 * 立项报告「加入 AI 选址建议」提示区 守卫 —— v1.13.423
 *
 * 业主 2026-11-26：「隐藏页面上方显示的『勾选后消耗 1 次 AI 调用（约 ¥0.02），需额外等待十几秒；默认不包含』」
 *
 * 本批把常显改成悬停提示（`el-tooltip`），并顺带修掉一个**违规**：
 *   那句里写着「约 ¥0.02」，与产品铁律「⛔ 文案不含单价」直接冲突 ——
 *   截图、对外演示、给客户看屏幕时都会把成本暴露出去。
 *
 * 🔴 藏起来 ≠ 不说：铁律「付费前必明消耗」仍然成立，所以「消耗 1 次 AI 调用」留在 tooltip 里。
 * 🔴 非 VIP 那一支**必须继续常显** —— 它是「点了才知道为什么」的唯一出口（同 §6.41 的教训）。
 * 🔴 勾选框**必须继续可点**（不做 disabled）—— 见下方 D 组，别为了"没提示了"把它禁用。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const COMP = read('frontend/src/components/CandidateReport.vue')

/** 剥注释：注释里写着「约 ¥0.02」是为了说明为什么删，⛔ 不能因此把自己判红 */
function strip(s) {
  return String(s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
const CODE = strip(COMP)

/** 工具条左半段：`<div class="rp-bar-l">` 到它的第一个闭合 `</div>`（该层没有嵌套 div） */
function barSeg() {
  const a = CODE.indexOf('<div class="rp-bar-l">')
  expect(a, '找不到 .rp-bar-l 工具条').toBeGreaterThan(-1)
  const b = CODE.indexOf('</div>', a)
  expect(b).toBeGreaterThan(a)
  return CODE.slice(a, b)
}
/** aiHint 定义段 */
function hintSeg() {
  const a = CODE.indexOf('const aiHint')
  expect(a, '找不到 aiHint').toBeGreaterThan(-1)
  const b = CODE.indexOf('const username', a)
  return b > a ? CODE.slice(a, b) : CODE.slice(a, a + 500)
}

describe('A. 单价必须从可见文案里消失（铁律「文案不含单价」）', () => {
  it('A1 剥注释后整文件不含 ¥0.02', () => {
    expect(CODE).not.toContain('¥0.02')
    expect(CODE).not.toContain('0.02')
  })

  it('A2 也不许换成别的写法把单价带回来（¥ / 元 / 角）', () => {
    const seg = barSeg() + hintSeg()
    expect(seg).not.toMatch(/[¥￥]/)
    expect(seg).not.toMatch(/约\s*[\d.]+\s*元/)
  })
})

describe('B. 不再在工具条上常显那句长提示', () => {
  it('B1 工具条里不允许再出现「勾选后消耗…」常显文案', () => {
    const seg = barSeg()
    expect(seg).not.toContain('需额外等待十几秒')
    expect(seg).not.toContain('默认不包含</template>')
    // 旧写法整句（含 v-else 分支）必须消失
    expect(COMP).not.toContain('勾选后消耗 1 次 AI 调用（约 ¥0.02）')
  })

  it('B2 🔴 非 VIP 提示必须继续常显（⛔ 不许跟着一起藏）', () => {
    const seg = barSeg()
    expect(seg).toContain('v-if="!isVip"')
    expect(seg).toContain('仅限 VIP 用户')
  })
})

describe('C. 信息不丢：改成悬停提示，且「消耗几次」必须还在', () => {
  it('C1 勾选框被 el-tooltip 包住并绑定 aiHint', () => {
    const seg = barSeg()
    expect(seg).toContain('<el-tooltip')
    expect(seg).toContain(':content="aiHint"')
  })

  it('C2 aiHint 里必须写明「消耗 1 次 AI 调用」（藏起来 ≠ 不说）', () => {
    expect(hintSeg()).toContain('消耗 1 次 AI 调用')
  })

  it('C3 非 VIP 的悬停提示要指向「怎么申请」，而不是只说不能用', () => {
    const h = hintSeg()
    expect(h).toContain('VIP 专属')
    expect(h).toContain('申请')
  })
})

describe('D. 勾选框必须仍然可点（⛔ 别为了"没提示了"改成 disabled）', () => {
  it('D1 el-checkbox 只有 :disabled="aiLoading"，没有写死 disabled', () => {
    const seg = barSeg()
    expect(seg).toMatch(/<el-checkbox[^>]*:model-value="wantAi"[^>]*>/)
    const tag = /<el-checkbox[^>]*>/.exec(seg)[0]
    expect(tag).toContain(':disabled="aiLoading"')
    // 裸 disabled（不带 : 也不带 =）＝写死禁用 ⇒ 用户点不动、看不到原因
    expect(tag).not.toMatch(/\sdisabled(?!\s*=)/)
  })

  it('D2 onWantAiChange 仍是唯一入口，且非 VIP 会弹「去我的账户申请」', () => {
    const a = CODE.indexOf('async function onWantAiChange')
    expect(a).toBeGreaterThan(-1)
    const seg = CODE.slice(a, a + 1200)
    expect(seg).toContain('ElMessageBox.confirm')
    expect(seg).toContain('我的账户')
  })
})
