/**
 * 联通 Excel 导入：「同类近似名一次套用」分组 —— v1.13.426
 *
 * ── 解决什么 ─────────────────────────────────────────────────────────────
 * 一次导出往往同一家店有 3~12 个文件（不同半径 / 不同月份），文件名里的门店名**一字不差**。
 * 若这家店名与「我的门店」不完全同名，425 的规则是「每个文件都得用户亲手选一次门店」——
 * 20 个文件就是 20 次相同的选择，纯体力活，且手滑选错一行的概率随次数线性上升。
 *
 * ⇒ 把「同一门店名」的文件归成一组：用户在其中一行选好门店，一键套用到同组其余文件。
 *
 * ── 🔴 为什么是「精确同名」分组，不是相似度分组 ────────────────────────────
 * `storeNameMatcher.js` 的 `scoreName` 是**名字 → 候选门店**的打分；本模块要解决的是
 * **文件 → 文件**的归类，两者判据不同。同一次导出里，同一个门店名必然是同一个字符串，
 * 所以精确相等已经覆盖全部真实场景。
 * 若改成「归一化后相等」甚至「相似度 ≥ 阈值」分组，就会出现
 * 「星空广场」和「星空广场二期」被归成一组、套用同一个门店 —— 二期是另一家店，
 * 这正是 425 整批需求最怕的错配（见 storeNameMatcher 里 80 分档的注释）。
 * 归错组不会报错，只会把人口数据写到别人店里，代价远高于让用户多点一次。
 *
 * ── 边界 ─────────────────────────────────────────────────────────────────
 * · 只对 `needConfirm`（近似名待确认）的行分组；精确命中的行本来就已定好门店，不需要套用。
 * · 单文件不成组（`rows.length < 2` 直接丢弃），避免界面上出现只含一行的「组」。
 * · 纯函数、无副作用、不碰 DOM：全部逻辑可单测，组件只负责渲染与发请求。
 */

/** 归一成「分组键」：只做去首尾空白（解析阶段已 trim，这里兜一道，⛔ 不做任何模糊归一） */
function groupKeyOf(row) {
  return String((row && row.storeName) || '').trim()
}

/**
 * 把待确认行按「门店名完全相同」分组。
 *
 * @param {Array<object>} rows 预览行（含 needConfirm / storeName）
 * @returns {Array<{key: string, storeName: string, rows: Array<object>}>}
 *          仅返回行数 ≥2 的组；按组内行数降序（大组先呈现，最省事的先给）
 */
export function groupPendingRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  /** @type {Map<string, Array<object>>} */
  const buckets = new Map()
  for (const r of list) {
    if (!r || !r.needConfirm) continue
    const k = groupKeyOf(r)
    if (!k) continue
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(r)
  }
  const groups = []
  for (const [key, groupRows] of buckets) {
    if (groupRows.length < 2) continue
    groups.push({ key, storeName: key, rows: groupRows })
  }
  groups.sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key, 'zh'))
  return groups
}

/**
 * 取「与 row 同门店名的其它待确认行」。
 *
 * @param {Array<object>} rows 全部预览行
 * @param {object} row 基准行（必须是 needConfirm 行）
 * @returns {Array<object>} 同组其它行（按预览顺序），不含 row 自己
 */
export function siblingsOf(rows, row) {
  const k = groupKeyOf(row)
  if (!k || !row || !row.needConfirm) return []
  return (Array.isArray(rows) ? rows : []).filter(
    (r) => r && r !== row && r.needConfirm && groupKeyOf(r) === k
  )
}

/**
 * 取「同组里还没选定门店」的行 —— 这些才是套用动作真正要写的目标。
 *
 * 🔴 已有**其他门店**选择的行不在此列：那是用户自己做的另一个决定，
 *    批量套用不许静默覆盖它（要改就自己去那一行改）。见组件里的 `applyToGroup`。
 *
 * @param {Array<object>} rows 全部预览行
 * @param {object} row 基准行
 * @returns {Array<object>}
 */
export function pendingSiblingsOf(rows, row) {
  return siblingsOf(rows, row).filter((r) => !r.confirmedStoreId)
}

/**
 * 同组里「已被用户选成别的门店」的行数 —— 用于在确认框里如实说明「这几行没动」。
 * @param {Array<object>} rows
 * @param {object} row 基准行
 * @returns {number}
 */
export function conflictSiblingCount(rows, row) {
  const picked = row && row.confirmedStoreId ? row.confirmedStoreId : null
  return siblingsOf(rows, row).filter((r) => r.confirmedStoreId && r.confirmedStoreId !== picked).length
}
