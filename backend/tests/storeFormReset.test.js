/**
 * 415 守卫：「我的门店」新增表单不许继承上一次编辑的那家店的值。
 *
 * 背景（真实缺陷，不是假想）：
 *   DataView.vue 原来有两份字段清单 —— `reactive({...})` 一份、`showAddDialog()` 里手写一份。
 *   手写那份漏了 store_area / frontage / store_status / mall_type / trade_area_type，
 *   还写着一个死键 `area`（模板绑的是 `store_area`）。
 *   ⇒ 先编辑 A 店再点「新增」，新店会带着 A 店的面积/门幅/门店状态/商场类型/商圈类型，
 *     全流程零提示，用户是在报表里看到两家店一模一样才发现。
 *
 * 本守卫只做一件事：**模板里绑定的每个 form.X 都必须在 EMPTY_STORE_FORM 里有初值**。
 * 以后谁加控件忘加初值，这里直接红，不用再等人肉发现。
 *
 * ⚠️ 正则扫源码必须配「切片自检」：抽出来的键集合若为空，说明切片写错了，
 *    否则断言会以「空集 ⊆ 任何集合」的形式静默通过 —— 正是 211 踩过的假绿灯。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const VUE = path.resolve(__dirname, '../../frontend/src/views/DataView.vue')
const SOURCE = fs.readFileSync(VUE, 'utf8')

/** 剥 HTML 注释（模板里的说明文字会含 form.xxx，不剥会误判成控件绑定） */
function stripHtmlComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '')
}

/** 取 SFC 模板区：第一个 <template> 到最后一个 </template>（页面里还有 <template #default> 等嵌套） */
function templateBlock(src) {
  const start = src.indexOf('<template>')
  const end = src.lastIndexOf('</template>')
  expect(start, 'DataView.vue 找不到 <template>').toBeGreaterThan(-1)
  expect(end, 'DataView.vue 找不到 </template>').toBeGreaterThan(start)
  return src.slice(start, end)
}

/** 取 EMPTY_STORE_FORM 的键集合 */
function emptyFormKeys(src) {
  const i = src.indexOf('const EMPTY_STORE_FORM = {')
  expect(i, 'DataView.vue 找不到 EMPTY_STORE_FORM').toBeGreaterThan(-1)
  const block = src.slice(i, src.indexOf('\n}', i))
  const keys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
  expect(keys.length, 'EMPTY_STORE_FORM 解析出 0 个键 —— 切片或缩进变了').toBeGreaterThan(10)
  return keys
}

/** 取 showAddDialog 函数体 */
function showAddBlock(src) {
  const i = src.indexOf('const showAddDialog = ')
  expect(i, 'DataView.vue 找不到 showAddDialog').toBeGreaterThan(-1)
  const block = src.slice(i, src.indexOf('\n}', i))
  expect(block.length, 'showAddDialog 切片过短 —— 切片逻辑失效').toBeGreaterThan(30)
  return block
}

describe('「我的门店」新增表单重置（415）', () => {
  const tpl = stripHtmlComments(templateBlock(SOURCE))
  const bound = [...new Set([...tpl.matchAll(/form\.(\w+)/g)].map((m) => m[1]))]
  const keys = emptyFormKeys(SOURCE)

  it('模板绑定字段解析非空（切片自检）', () => {
    expect(bound.length).toBeGreaterThan(8)
    expect(bound).toContain('store_area')
    expect(bound).toContain('rent')
  })

  it('🔴 模板里每个 form.X 都必须在 EMPTY_STORE_FORM 里有初值', () => {
    const missing = bound.filter((k) => !keys.includes(k))
    expect(missing, `这些控件没有初值 ⇒ 新增时会继承上一次编辑的值：${missing.join(', ')}`).toEqual([])
  })

  it('showAddDialog 必须复用 EMPTY_STORE_FORM，不许再手写字段清单', () => {
    const blk = showAddBlock(SOURCE)
    expect(blk).toContain('Object.assign(form, EMPTY_STORE_FORM)')
    // 手写清单的特征：形如 `    store_code: ''` 四空格缩进的键值对
    const handWritten = [...blk.matchAll(/^\s{4}\w+: /gm)]
    expect(handWritten.length, 'showAddDialog 里又出现了手写的字段清单').toBe(0)
  })

  it('新增默认门店类型仍是「已开业」（不要悄悄变成「请选择」）', () => {
    const blk = SOURCE.slice(SOURCE.indexOf('const EMPTY_STORE_FORM = {'))
    const seg = blk.slice(0, blk.indexOf('\n}'))
    expect(seg).toMatch(/store_type: '已开业'/)
  })

  it('月租金初值为 null，且语义写明是整店月租（元/月）而非单价', () => {
    expect(keys).toContain('rent')
    const i = SOURCE.indexOf('const EMPTY_STORE_FORM = {')
    const seg = SOURCE.slice(i, SOURCE.indexOf('\n}', i))
    expect(seg).toMatch(/rent: null/)
    // 注释里的口径声明（防后人把它当「元/㎡/月」用）
    const before = SOURCE.slice(Math.max(0, i - 1400), i)
    expect(before).toContain('元/月')
  })

  it('🔴 编辑回填租金必须用 ??（0 元租金不能被 || 吞成空值）', () => {
    const i = SOURCE.indexOf('const handleEdit = ')
    expect(i, '找不到 handleEdit').toBeGreaterThan(-1)
    const blk = SOURCE.slice(i, SOURCE.indexOf('\n}', i))
    expect(blk).toMatch(/rent: row\.rent \?\? null/)
    expect(blk, 'rent 回填退回 `row.rent || null` ⇒ 租金 0 会被静默变空').not.toMatch(/rent: row\.rent \|\| null/)
  })
})
