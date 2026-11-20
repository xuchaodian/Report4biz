/**
 * 候选点位列表「品牌独立成列 + 位置单行」源码守卫（批次 385）
 *
 * ── 背景 ────────────────────────────────────────────────────────────────
 * 业主 385 反馈两条，都是信息层级问题：
 *   ① 品牌名原先挤在「点位」列门店名下方做第二行 ⇒ 读起来像门店名的一部分。
 *      改为独立「品牌」列，紧跟「点位」。
 *   ② 「位置」原为两行（城市·区 / 地址）⇒ 改为一行，超出省略、title 看全文。
 *
 * ── 守什么 ──────────────────────────────────────────────────────────────
 *   ① 列顺序必须是 点位 → 品牌 → 位置（品牌不许回到点位列里）
 *   ② 点位列**只放名称**：⛔ 再出现 `row.brand`
 *   ③ 位置列只渲染一处文本（locText），⛔ 拆回两行
 *   ④ locText 必须三段齐全（city / district / address），缺段跳段
 *   ⑤ 单行的样式基础不能丢：`.cd-one` 要有 nowrap + text-overflow:ellipsis
 *   ⑥ 旧 class（`.cd-name-sub` / `.cd-addr`）不许残留（死代码会误导后来人）
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

/** 剥 Vue HTML 注释 → JS 块注释 → 行注释。HTML 必须最先剥。 */
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

describe('385 候选点位：品牌独立成列 + 位置单行', () => {
  it('列顺序为 点位 → 品牌 → 位置', () => {
    const a = src.indexOf('label="点位"')
    const b = src.indexOf('label="品牌"')
    const c = src.indexOf('label="位置"')
    expect(a, '找不到「点位」列').toBeGreaterThan(-1)
    expect(b, '找不到「品牌」列（品牌可能又被挤回点位列了）').toBeGreaterThan(a)
    expect(c, '找不到「位置」列').toBeGreaterThan(b)
  })

  it('🔴「点位」列只放名称，不再渲染 row.brand', () => {
    const block = columnBlock('点位')
    expect(block).not.toContain('row.brand')
    expect(block).toContain('row.name')
  })

  it('「品牌」列渲染 row.brand，空值给占位符', () => {
    const block = columnBlock('品牌')
    expect(block).toContain('row.brand')
    expect(block).toContain('—')
  })

  it('🔴「位置」列只渲染一处文本（单行），不再拆两行', () => {
    const block = columnBlock('位置')
    const divs = block.match(/<div/g) || []
    expect(divs.length, `位置列里出现了 ${divs.length} 个 div，说明又被拆成多行了`).toBe(1)
    expect(block).toContain('locText(row)')
  })

  it('locText 三段齐全：城市 / 区 / 地址，缺段自动跳过', () => {
    const fn = (src.match(/function locText\(row\)\s*\{[\s\S]*?\n\}/) || [''])[0]
    expect(fn, '找不到 locText 实现').not.toBe('')
    expect(fn).toContain('row?.city')
    expect(fn).toContain('row?.district')
    expect(fn).toContain('row?.address')
    expect(fn).toContain('filter(Boolean)')
  })

  it('单行的样式基础在：.cd-one 要有 nowrap + 省略号', () => {
    const rule = (src.match(/\.cd-one\s*\{[^}]*\}/) || [''])[0]
    expect(rule, '找不到 .cd-one 样式').not.toBe('')
    expect(rule).toContain('white-space: nowrap')
    expect(rule).toContain('text-overflow: ellipsis')
  })

  it('旧 class 不残留（.cd-name-sub / .cd-addr 已是死代码）', () => {
    expect(src).not.toMatch(/\.cd-name-sub\s*\{/)
    expect(src).not.toMatch(/\.cd-addr\s*\{/)
  })
})

/**
 * 385 真机发现的真问题：address 常是「上海市闵行区浦锦路309弄6号」，而 city/district
 * 也是同两段 ⇒ 拼成一行变成「上海市 · 闵行区 · 上海市闵行区浦锦路309弄6号」，重复刺眼。
 * 两行显示时不明显，改一行才暴露。
 */
describe('385 位置一行显示：地址前缀去重', () => {
  it('🔴 locText 必须按 city → district 顺序剥地址前缀', () => {
    const lt = (src.match(/function locText\(row\)\s*\{[\s\S]*?\n\}/) || [''])[0]
    expect(lt, '找不到 locText 实现').not.toBe('')
    const iCity = lt.indexOf('stripAddrPrefix(addr, city)')
    const iDist = lt.indexOf('stripAddrPrefix(addr, district)')
    expect(iCity, 'locText 没有剥 city 前缀').toBeGreaterThan(-1)
    expect(iDist, 'locText 没有剥 district 前缀').toBeGreaterThan(-1)
    expect(iCity, '必须先剥 city 再剥 district（顺序反了会留下「市闵行区…」）').toBeLessThan(iDist)
  })

  it('🔴 前缀匹配必须「长的优先」：否则「上海」会把「上海市」吃掉两个字、剩「市闵行区…」', () => {
    const fn = (src.match(/function stripAddrPrefix\(addr, prefix\)\s*\{[\s\S]*?\n\}/) || [''])[0]
    expect(fn, '找不到 stripAddrPrefix 实现').not.toBe('')
    expect(fn).toContain('startsWith')
    expect(fn, '缺「按长度降序」的排序 ⇒ 短前缀会先命中').toContain('b.length - a.length')
  })

  it('「上海」与「上海市」互认（缺后缀时也要能剥掉）', () => {
    const fn = (src.match(/function stripAddrPrefix\(addr, prefix\)\s*\{[\s\S]*?\n\}/) || [''])[0]
    expect(fn, '缺「补/去行政后缀」的互认逻辑').toMatch(/\[\s*'市'\s*,\s*'区'\s*,\s*'县'\s*\]/)
  })
})
