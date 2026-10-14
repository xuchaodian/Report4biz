/**
 * 「人口分布分析」面板的字段显示顺序 —— **单一入口**（v1.13.229）
 *
 * 业务要求（业主 2026-10-14 指定）：
 *   居住人数 → 工作人数 → 到访人次 → 男性人数 → 女性人数
 *   → 低收入 → 中等收入 → 中产 → 小康 → 富裕 → 富人
 *
 * ⚠️ 未列在本表中的字段（例如将来新数据源带来的字段）**一律排在最后**，并按中文拼音序兜底 ——
 *   这样「新增字段」既不会打乱已确认的顺序，也不会被静默丢掉。
 * ⚠️ 本表只决定**展示顺序**；不参与计算、不做筛选。
 *   过滤「分年龄人口」是另一件事，见 `utils/ageField.js`（两者职责正交）。
 * ⚠️ 本模块**不得**静态引用 `@/router` 等入口 chunk 内模块（会反向提升首屏依赖，见 214 立档）。
 *
 * 回归钉子：`backend/tests/hdPopulationDistribution.test.js`（⑨，行为断言）
 */

/** 已确认的字段展示顺序（按业务重要性排序，⛔ 改动前先与业主确认） */
export const POPULATION_FIELD_ORDER = Object.freeze([
  '居住人数',
  '工作人数',
  '到访人次',
  '男性人数',
  '女性人数',
  '低收入',
  '中等收入',
  '中产',
  '小康',
  '富裕',
  '富人'
])

/**
 * 按上表顺序排序（**不修改入参**；未列出的字段排在最后，同组内按中文拼音序）。
 * @param {string[]} fields 字段名数组
 * @returns {string[]} 新数组（已排序）
 */
export function sortByPopulationPriority(fields) {
  const list = Array.isArray(fields) ? fields.slice() : []
  return list.sort((a, b) => {
    const ia = POPULATION_FIELD_ORDER.indexOf(a)
    const ib = POPULATION_FIELD_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return String(a).localeCompare(String(b), 'zh')
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

export default sortByPopulationPriority
