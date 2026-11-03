/**
 * 「门店区分」选项单一来源守卫 —— v1.13.313
 *
 * 背景：这个清单原来在 4 处各写一遍 ——
 *   ① `stores/marker.js`（我的门店 / 数据页 / 批量补区分）
 *   ② `views/BrandStoreView.vue`（品牌门店下拉）
 *   ③ `utils/importSpecs.js`（导入说明文案，客户照着填模板）
 *   ④ 后端 `ai/tools.js`（AI 筛选时认哪些词）
 * ⇒ 加一个选项要改 4 处，漏一处就是「我的门店能选、品牌门店选不到」。
 *
 * 本守卫钉住：
 *   A. `utils/storeCategory.js` 是唯一来源，且「履约店」必须在**最后**（业主指定）。
 *   B. 前端两处下拉不得再出现硬编码清单（反向断言）。
 *   C. 导入说明文案必须与选项同源（由常量派生，改一处即同步）。
 *   D. 后端 AI 工具描述（跨包，只能手写）必须包含全部选项 —— 漏了 AI 就听不懂这个词。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORE_CATEGORIES, STORE_CATEGORIES_TEXT } from '../../frontend/src/utils/storeCategory.js'
import { STORE_IMPORT_FIELDS } from '../../frontend/src/utils/importSpecs.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8')

describe('A. 唯一来源与顺序', () => {
  it('选项数＝9（8 个原有 ＋ 履约店）', () => {
    expect(STORE_CATEGORIES.length).toBe(9)
  })

  it('🔴「履约店」必须在最后一位（业主明确要求放在专业市场店后面）', () => {
    expect(STORE_CATEGORIES[STORE_CATEGORIES.length - 1]).toBe('履约店')
    expect(STORE_CATEGORIES.indexOf('专业市场店')).toBe(STORE_CATEGORIES.length - 2)
  })

  it('原有 8 项一个都没少、顺序未变', () => {
    expect(STORE_CATEGORIES.slice(0, 8)).toEqual([
      '社区店', '临街店', '商场店', '写字楼店', '交通枢纽店', '校园店', '景区店', '专业市场店'
    ])
  })

  it('无重复值', () => {
    expect(new Set(STORE_CATEGORIES).size).toBe(STORE_CATEGORIES.length)
  })
})

describe('B. 前端下拉不再各自硬编码', () => {
  it('stores/marker.js 引用常量，不再内联数组', () => {
    const src = read('frontend/src/stores/marker.js')
    expect(src).toContain('storeCategories: [...STORE_CATEGORIES]')
    expect(
      /storeCategories:\s*\[\s*'社区店'/.test(src),
      '我的门店的选项又变回硬编码了 —— 加新选项会漏'
    ).toBe(false)
  })

  it('BrandStoreView 引用常量，不再内联数组', () => {
    const src = read('frontend/src/views/BrandStoreView.vue')
    expect(src).toContain('const storeCategoryOptions = STORE_CATEGORIES')
    expect(
      /storeCategoryOptions\s*=\s*\[\s*'社区店'/.test(src),
      '品牌门店的选项又变回硬编码了 —— 会与我的门店不一致'
    ).toBe(false)
  })
})

describe('C. 导入说明与选项同源', () => {
  it('store_category 的说明里包含全部 9 个选项', () => {
    const f = STORE_IMPORT_FIELDS.find(x => x.key === 'store_category')
    expect(f, '导入字段清单里找不到 store_category').toBeTruthy()
    for (const c of STORE_CATEGORIES) expect(f.note).toContain(c)
  })

  it('文案由常量派生（改选项即同步，无需改文案）', () => {
    const src = read('frontend/src/utils/importSpecs.js')
    expect(src).toContain("import { STORE_CATEGORIES_TEXT } from './storeCategory.js'")
    expect(src).toContain('${STORE_CATEGORIES_TEXT}')
  })

  it('🔴 必须用相对路径引入（@/ 是 Vite alias，Node 守卫解析不了）', () => {
    const src = read('frontend/src/utils/importSpecs.js')
    expect(src.includes("from '@/utils/storeCategory.js'"), 'importSpecs 用了 @/ alias ⇒ 守卫会在 Node 里 import 失败').toBe(false)
  })
})

describe('D. 后端 AI 工具描述（跨包，手写）', () => {
  const tools = read('backend/src/ai/tools.js')

  it('filter_markers 的 store_category 描述包含全部选项', () => {
    const m = tools.match(/description: '门店分类：([^']+)'/)
    expect(m, '找不到门店分类描述（守卫已失锚）').toBeTruthy()
    const listed = m[1].split('|').map(s => s.trim())
    expect(listed).toEqual(STORE_CATEGORIES)
    expect(listed).toContain('履约店')
  })

  it('文案格式与常量拼接一致（防止只有个数对、顺序不同）', () => {
    expect(tools).toContain(STORE_CATEGORIES_TEXT.replace(/\//g, ' | '))
  })
})
