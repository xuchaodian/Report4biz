/**
 * 「门店区分」（store_category）选项的**唯一来源** —— v1.13.313
 *
 * 背景：这个清单原来在 4 处各写一遍：
 *   ① `stores/marker.js` 的 `storeCategories`（我的门店 / 数据页 / 批量补区分都读它）
 *   ② `views/BrandStoreView.vue` 的 `storeCategoryOptions`（品牌门店下拉）
 *   ③ `utils/importSpecs.js` 里那串说明文案（客户照着填导入模板）
 *   ④ 后端 `ai/tools.js` 的 `filter_markers` 工具描述（AI 认哪些词）
 * ⇒ 加一个选项要改 4 处，漏一处就是「我的门店能选、品牌门店选不到」这种不一致。
 *
 * 语义：store_category 是**选址形态**，⛔ 不是菜系业态
 *   （详见 `backend/src/routes/markers.js` 批量补区分那段的注释）。
 *
 * 🔴 后端 `ai/tools.js` 是**另一份**（跨包无法 import），改这里时同步那边；
 *   守卫 `backend/tests/storeCategoryOptions.test.js` 会比对两边，漏了会红。
 */
export const STORE_CATEGORIES = [
  '社区店',
  '临街店',
  '商场店',
  '写字楼店',
  '交通枢纽店',
  '校园店',
  '景区店',
  '专业市场店',
  '履约店'
]

/** 文案拼接用（导入说明等），保证与选项同源 */
export const STORE_CATEGORIES_TEXT = STORE_CATEGORIES.join('/')
