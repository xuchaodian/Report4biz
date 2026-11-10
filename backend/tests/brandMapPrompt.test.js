/**
 * 品牌竞品映射「强制补齐」判据 + 接线守卫 —— v1.13.349
 *
 * 背景（这条最容易记反）：
 *   344 定义三态 —— 未配置 ⇒ 全量；已配置非空 ⇒ 收窄；已配置空集 ⇒ 真 0 家（判未评，绝不变绿灯）。
 *   348 只弹一个「要不要去设置」的确认框，点「暂不设置」就过 ⇒ 未配置的品牌继续吃全量，
 *   等于没治。349 改成：多品牌账号**必须**把每个品牌的映射配出结论才能关窗，且每次进页复查。
 *
 * 本文件钉五件事：
 *   A. 只在「≥2 个自有品牌 且 存在未配置品牌」时强制 —— 单品牌、全配好，一律不打扰
 *   B. 「已配置」以 **key 是否存在** 为准，配成空数组也算已配置（⛔ 不能用「值非空」判断）
 *   C. 草稿 / 结论判定 / 请求体三个纯函数的边界（尤其 none ⇒ 显式空集）
 *   D. 组件真的硬阻断（⛔ 无 X、⛔ 点遮罩不关、⛔ ESC 不关、⛔ 无取消/稍后按钮）
 *   E. CompetitorView 两个触发点都接着（导入后 + 进页复查），⛔ 防以后被顺手删掉
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decideBrandMapPrompt,
  buildRequiredMapDraft,
  isRowDecided,
  summarizeDraft,
  buildSavePayload
} from '../../frontend/src/utils/brandMapPrompt.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const VIEW = 'frontend/src/views/CompetitorView.vue'
const DIALOG = 'frontend/src/components/competitor/BrandMapRequiredDialog.vue'

/** 剥掉 JS 注释：docblock 里提到函数名会造成「假绿灯」 */
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
/** 只取 <template> … <script setup> 之间的模板片段，并剥掉 HTML 注释 */
function templateOf(src) {
  const a = src.indexOf('<template>')
  const b = src.indexOf('<script setup')
  const tpl = a >= 0 && b > a ? src.slice(a, b) : ''
  return tpl.replace(/<!--[\s\S]*?-->/g, '')
}
/** 从某个起点开始，按花括号配平取出一个代码块（用于断言函数体内部） */
function extractBlock(src, startIdx) {
  const open = src.indexOf('{', startIdx)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return src.slice(open)
}

describe('A. 什么时候必须强制补映射', () => {
  const scopes = (keys) => Object.fromEntries(keys.map(k => [k, ['某竞品']]))

  it('没有自有品牌：不强制', () => {
    const d = decideBrandMapPrompt({ myBrands: [], scopes: {} })
    expect(d.required).toBe(false)
    expect(d.reason).toBe('single-brand')
  })

  it('单品牌账号：不强制（不存在多品牌混算）', () => {
    const d = decideBrandMapPrompt({ myBrands: ['优事'], scopes: {} })
    expect(d.required).toBe(false)
    expect(d.missing).toEqual([])
  })

  it('两个品牌都已配置：不强制', () => {
    const d = decideBrandMapPrompt({ myBrands: ['滨寿司', '食其家'], scopes: scopes(['滨寿司', '食其家']) })
    expect(d.required).toBe(false)
    expect(d.reason).toBe('all-configured')
  })

  it('两个品牌缺一个：强制，且只点名缺的那个', () => {
    const d = decideBrandMapPrompt({ myBrands: ['滨寿司', '食其家'], scopes: scopes(['滨寿司']) })
    expect(d.required).toBe(true)
    expect(d.reason).toBe('missing-scope')
    expect(d.missing).toEqual(['食其家'])
    expect(d.total).toBe(2)
  })

  it('🔴 配成空数组算「已配置」，⛔ 不能当成未配置反复骚扰', () => {
    const d = decideBrandMapPrompt({ myBrands: ['滨寿司', '食其家'], scopes: { 滨寿司: [], 食其家: ['食其家'] } })
    expect(d.required).toBe(false)
  })

  it('归一化：映射 key 的大小写/空白差异不算未配置', () => {
    const d = decideBrandMapPrompt({ myBrands: ['Bin Sushi'], scopes: { ' bin   sushi ': ['x'] } })
    expect(d.required).toBe(false)
  })

  it('同名品牌去重后仍算单品牌 ⇒ 不强制', () => {
    const d = decideBrandMapPrompt({ myBrands: ['优事', ' 优事 ', '优事'], scopes: {} })
    expect(d.total).toBe(1)
    expect(d.required).toBe(false)
  })

  it('入参不被修改', () => {
    const myBrands = ['滨寿司', '食其家']
    const s = { 滨寿司: ['A'] }
    const snapshot = JSON.stringify({ myBrands, s })
    decideBrandMapPrompt({ myBrands, scopes: s })
    expect(JSON.stringify({ myBrands, s })).toBe(snapshot)
  })
})

describe('B. 待补映射草稿', () => {
  it('不需要强制时返回空数组', () => {
    expect(buildRequiredMapDraft({ myBrands: ['优事'], scopes: {} })).toEqual([])
  })

  it('每个未配置品牌一行，顺序跟随 myBrands', () => {
    const rows = buildRequiredMapDraft({ myBrands: ['乙', '甲', '丙'], scopes: { 甲: ['x'] } })
    expect(rows.map(r => r.myBrand)).toEqual(['乙', '丙'])
    expect(rows.every(r => Array.isArray(r.compBrands) && r.compBrands.length === 0)).toBe(true)
    expect(rows.every(r => r.none === false)).toBe(true)
  })

  it('🔴 本次导入的**竞品品牌**预勾进去（348 曾拿它跟自有品牌比 ⇒ 恒不命中）', () => {
    const rows = buildRequiredMapDraft({ myBrands: ['滨寿司', '食其家'], scopes: {}, justImportedBrand: '食其家2号' })
    expect(rows.map(r => r.compBrands)).toEqual([['食其家2号'], ['食其家2号']])
    expect(rows.every(r => r.seeded === true)).toBe(true)
  })

  it('没有导入品牌时草稿为空选、seeded=false', () => {
    const rows = buildRequiredMapDraft({ myBrands: ['A', 'B'], scopes: {}, justImportedBrand: '   ' })
    expect(rows.every(r => r.compBrands.length === 0 && r.seeded === false)).toBe(true)
  })

  it('已配置的品牌不出现在草稿里', () => {
    const rows = buildRequiredMapDraft({ myBrands: ['A', 'B', 'C'], scopes: { B: [] } })
    expect(rows.map(r => r.myBrand)).toEqual(['A', 'C'])
  })
})

describe('C. 结论判定与请求体', () => {
  it('勾了「暂无竞品」＝有结论', () => {
    expect(isRowDecided({ myBrand: 'A', compBrands: [], none: true })).toBe(true)
  })
  it('选了竞品品牌＝有结论', () => {
    expect(isRowDecided({ myBrand: 'A', compBrands: ['x'], none: false })).toBe(true)
  })
  it('空选且没勾「暂无竞品」＝未决', () => {
    expect(isRowDecided({ myBrand: 'A', compBrands: [], none: false })).toBe(false)
    expect(isRowDecided(null)).toBe(false)
  })

  it('summarizeDraft 的 complete 只有全部有结论才为真', () => {
    const rows = [
      { myBrand: 'A', compBrands: ['x'], none: false },
      { myBrand: 'B', compBrands: [], none: false }
    ]
    expect(summarizeDraft(rows)).toMatchObject({ total: 2, decided: 1, pending: 1, complete: false })
    rows[1].none = true
    expect(summarizeDraft(rows)).toMatchObject({ total: 2, decided: 2, pending: 0, complete: true })
  })

  it('空草稿不算 complete（⛔ 防止无行可配时按钮亮着）', () => {
    expect(summarizeDraft([]).complete).toBe(false)
  })

  it('🔴 none=true ⇒ 提交显式空集（不是「不提交」）', () => {
    expect(buildSavePayload({ myBrand: 'A', compBrands: ['x', 'y'], none: true }))
      .toEqual({ myBrand: 'A', competitorBrands: [] })
  })

  it('提交前做 trim + 去重 + 去空', () => {
    const p = buildSavePayload({ myBrand: ' A ', compBrands: [' x ', 'X', '', 'y'], none: false })
    expect(p).toEqual({ myBrand: 'A', competitorBrands: ['x', 'X', 'y'] })
  })

  it('buildSavePayload 不修改入参', () => {
    const row = { myBrand: 'A', compBrands: [' x '], none: false }
    buildSavePayload(row)
    expect(row.compBrands).toEqual([' x '])
  })
})

describe('D. 弹窗必须真的硬阻断', () => {
  const src = read(DIALOG)
  const tpl = templateOf(src)
  const js = stripJsComments(src)

  it('切片自检：模板片段必须真的取到内容，且 HTML 注释被剥掉', () => {
    expect(tpl.length).toBeGreaterThan(500)
    expect(tpl).toContain('el-dialog')
    // 文件头注释里写着「⛔ 不能有取消/稍后按钮」，若注释没剥干净会污染下面的断言
    expect(src).toContain('不能有「取消/稍后」按钮')
    expect(tpl).not.toContain('不能有「取消/稍后」按钮')
  })

  it('三个关闭途径全部禁掉：X / 点遮罩 / ESC', () => {
    expect(tpl).toMatch(/:show-close="false"/)
    expect(tpl).toMatch(/:close-on-click-modal="false"/)
    expect(tpl).toMatch(/:close-on-press-escape="false"/)
  })

  it('🔴 按钮里不存在「取消 / 稍后 / 暂不设置 / 跳过」这类逃生口', () => {
    // 只看**按钮文案**：说明性文字里出现「请稍后刷新」是正常的，⛔ 不要用整段模板做包含判断
    const btnTexts = [...tpl.matchAll(/<el-button\b[^>]*>([\s\S]*?)<\/el-button>/g)]
      .map(m => m[1].replace(/<[^>]*>/g, '').trim())
    expect(btnTexts.length).toBeGreaterThan(0)
    for (const word of ['取消', '稍后', '暂不设置', '跳过']) {
      expect(btnTexts.some(t => t.includes(word))).toBe(false)
    }
  })

  it('有「暂无竞品」出口（否则用户会为过关乱勾）', () => {
    expect(tpl).toContain('暂无竞品')
    expect(tpl).toContain('el-checkbox')
    expect(tpl).toMatch(/:disabled="row\.none"/)
  })

  it('勾「暂无竞品」必须同时清空已选（⛔ 别留下「空集 + 还选着品牌」的自相矛盾状态）', () => {
    const idx = js.indexOf('function onToggleNone')
    expect(idx).toBeGreaterThan(-1)
    expect(extractBlock(js, idx)).toMatch(/row\.compBrands\s*=\s*\[\]/)
  })

  it('保存走 PUT /brand-competitor-map，且逐行提交', () => {
    expect(js).toContain("api.put('/brand-competitor-map'")
    expect(js).toContain('buildSavePayload')
    expect(js).toMatch(/for \(const row of rows\.value\)/)
  })

  it('配置接口不可用时必须能关（⛔ 不能把用户永久锁在无法保存的窗里）', () => {
    expect(js).toContain('degraded')
    expect(tpl).toMatch(/v-if="degraded"/)
    expect(tpl).toContain('关闭')
  })
})

describe('E. CompetitorView 两个触发点都接着', () => {
  const src = read(VIEW)
  const tpl = templateOf(src)
  const js = stripJsComments(src)

  it('切片自检：注释被剥（docblock 里提到函数名不算接线）', () => {
    expect(src).toContain('openRequiredBrandMap')
    expect(js).toContain('openRequiredBrandMap')
    // 剥注释后仍应保留正文中的真实调用
    expect(js).toContain('async function openRequiredBrandMap')
  })

  it('① 导入成功后调用', () => {
    const idx = js.indexOf('const handleSnapshotImported')
    expect(idx).toBeGreaterThan(-1)
    const body = extractBlock(js, idx)
    expect(body).toContain('openRequiredBrandMap(')
  })

  it('② setup 级进页复查（顶格调用，不是藏在某个函数里）', () => {
    expect(js).toMatch(/^checkRequiredBrandMapOnEnter\(\)/m)
    expect(js).toContain('async function checkRequiredBrandMapOnEnter')
  })

  it('模板挂了强制弹窗，并把 scopes / 导入品牌透传下去', () => {
    expect(tpl).toContain('<BrandMapRequiredDialog')
    expect(tpl).toContain(':scopes="scopeMeta.scopes"')
    expect(tpl).toContain(':just-imported-brand="lastImportedCompBrand"')
    expect(tpl).toContain('@saved="onRequiredMapSaved"')
  })

  it('🔴 348 的可跳过确认框已彻底移除（防回退）', () => {
    expect(js).not.toContain('buildBrandMapPromptText')
    expect(js).not.toContain('暂不设置')
    expect(js).not.toContain('立即设置')
  })

  it('进页复查在元数据读不到时必须静默（⛔ 不要每次进页弹一个什么也做不了的窗）', () => {
    const idx = js.indexOf('async function checkRequiredBrandMapOnEnter')
    const body = extractBlock(js, idx)
    expect(body).toContain('if (!scopeMetaLoaded.value) return')
    expect(body).not.toContain('requiredMapDegraded.value = true')
  })
})
