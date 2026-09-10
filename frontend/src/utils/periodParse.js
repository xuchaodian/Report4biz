/**
 * 期次（period）解析 —— 仅用于「期次上传」向导的自动预填
 *
 * ⚠ 本文件与 backend/src/utils/competitorSnapshotCore.js 的 parseYearMonthLabel
 *   保持一致（后端负责权威识别，前端只做选文件时的即时预填）。
 *   改任何一侧的规则时，必须同步另一侧。
 *
 * 支持写法：`2026年9月` / `2026-09` / `2026/9` / `2026Q3` / `202609`（裸 YYYYMM）
 * 后两种允许带前后缀与扩展名（如 `米村拌饭202609.csv`）
 */

/** 从任意文本提取年月 → { year, month, quarter } | null
 *  `quarter` 仅在命中显式季度写法（含 Q）时给出，否则为 null（与后端契约一致）
 */
export function parseYearMonthLabel(text) {
  const t = String(text || '')
  // 前两条按月做范围校验：越界（如 2026-13）视为识别失败，避免产出非法期次
  let m = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/)
  if (m) { const mo = +m[2]; if (mo >= 1 && mo <= 12) return { year: +m[1], month: mo, quarter: null } }
  m = t.match(/(\d{4})[-\/](\d{1,2})/)
  if (m) { const mo = +m[2]; if (mo >= 1 && mo <= 12) return { year: +m[1], month: mo, quarter: null } }
  // 季度写法：允许文件名前后缀（米村拌饭2026Q3.csv）
  m = t.match(/(\d{4})\s*Q([1-4])(?!\d)/i)
  if (m) return { year: +m[1], month: +m[2] * 3, quarter: +m[2] }
  // 裸 YYYYMM（米村拌饭202609.csv）；前面要求非数字边界，避免从长数字串中截取
  m = t.match(/(?:^|\D)(\d{4})(0[1-9]|1[0-2])/)
  if (m) return { year: +m[1], month: +m[2], quarter: null }
  return null
}

/** 年月 → 默认月度期次 '2026-09' */
export function toMonthPeriod(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * 从文件名推测期次
 * @param {string} fileName 例：米村拌饭202609.csv
 * @returns {string} '2026-09'；无法识别时返回 ''
 */
export function guessPeriodFromFilename(fileName) {
  const ym = parseYearMonthLabel(fileName)
  return ym ? toMonthPeriod(ym.year, ym.month) : ''
}
