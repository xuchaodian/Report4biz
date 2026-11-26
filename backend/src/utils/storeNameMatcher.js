/**
 * 门店名「近似匹配」核心（v1.13.425）
 *
 * 场景：联通 Excel 文件名里的门店名与「我的门店」不同名 —— 文件名叫「星空广场」、
 * 门店叫「星空广场店」—— 现在的实现是 SQL 精确等值（purchase-import.js matchStore），
 * 不等就整文件零导入，用户只能改名重传。
 *
 * ⚠️ 本模块**只负责打分与排序**，不做任何「自动采用」：候选只推荐，必须由用户显式确认。
 *    写错门店名会让该门店的购买履历、报告取数全错，代价远大于让用户多点一次。
 *
 * ── 🔴 归一化绝不在这里重写 ──────────────────────────────────────────────
 *   `competitorSnapshotCore.js` 已有 `normalizeStoreName`（去全角/标点/内部空格/尾部店缀）
 *   与 `levenshtein`，竞品快照的名址对齐一直在用。项目铁律「派生算法必抽单一函数共用」：
 *   这里直接 import，⛔ 不许 fork 第二份 normalize（两份必然漂移，将来「导入认成一家、
 *   竞品快照认成两家」这种扯不清的 bug 就是这么来的）。
 *   ⚠️ 也**不要**为了「连锁店」去改那个共享后缀表 —— 那会连带改变竞品对齐结果；
 *      「星空广场连锁店」vs「星空广场」由包含档（80 分）覆盖，够用了。
 *
 * ── 分档为什么这么定（改之前先读这段） ────────────────────────────────────
 *   100 归一化后相等：只差店缀/空格/全半角 ⇒ 语义上几乎必然是同一家 ⇒ 可预置选中
 *    92 编辑距离 1（短名 ≥4）：错一个字 ⇒ 仍是候选，但**不预置**，必须手选
 *    80 包含关系（短名占比 ≥40%）：⛔ 这一档以前在方案里给 92 分，会被
 *       「星空广场」→「星空广场二期」命中 —— 二期是**另一家店**，却拿到 ≥90 变成
 *       「高置信默认选中」。这正是本需求最怕的错配，所以包含档最高只给 80、永不预置。
 *    70 编辑距离 2（短名 ≥4）：勉强算候选，靠用户判断
 *    <70 不入选
 *
 * ⚠️ 纯函数模块：无 DB / 无 fs。候选池由调用方一次性查好传进来（见 purchase-import.js），
 *    这样一次预检 100 个文件也只需要扫一遍门店表。
 */
import { normalizeStoreName, levenshtein } from './competitorSnapshotCore.js'

/** 入候选的最低分（<70 直接丢弃，不让噪声进下拉） */
export const CANDIDATE_MIN_SCORE = 70
/** 下拉里最多给几个相似候选（可再搜全部，所以不需要长列表） */
export const CANDIDATE_LIMIT = 5
/** 唯一候选达到这个分数才「预置选中」（复选框仍由用户亲手勾，见 6.170.2） */
export const SUGGEST_SCORE = 100
/** Top1 与 Top2 分差小于该值 ⇒ 视为「存在多个相近门店」，前端高亮提示 */
export const AMBIGUOUS_GAP = 5
/** 中文名短于这个长度不参与打分（「店」「A」这类会跟谁都像） */
const MIN_NAME_LEN = 2
/** 编辑距离档要求的最短长度：4 字以内的名，编辑距离 1 就换了个意思 */
const EDIT_MIN_LEN = 4
/** 包含档要求「短名 / 长名」的最低占比：2 字名撞 6 字名多半是巧合 */
const CONTAINS_MIN_RATIO = 0.4

/**
 * 归一化（薄封装，只为让调用方不必知道底层实现在哪）。
 * ⚠️ 名字里带 ForMatch 是刻意的：提醒后来人「这是匹配用的归一化，不是展示用的」。
 */
export function normalizeForMatch(name) {
  return normalizeStoreName(name)
}

/**
 * 两个门店名的相似度打分（0~100，非连续分档）。
 *
 * @param {string} a 待匹配名（Excel 解析出的门店名）
 * @param {string} b 候选名（markers.name）
 * @returns {number} 0 / 70 / 80 / 92 / 100
 */
export function scoreName(a, b) {
  const na = normalizeForMatch(a)
  const nb = normalizeForMatch(b)
  // 归一化后为空（原名只有店缀/标点）或过短 ⇒ 不参与打分
  if (!na || !nb) return 0
  if (na.length < MIN_NAME_LEN || nb.length < MIN_NAME_LEN) return 0

  if (na === nb) return 100

  const minLen = Math.min(na.length, nb.length)
  const maxLen = Math.max(na.length, nb.length)

  // 包含（前缀只是包含的特例）—— 限定占比，避免「星空」命中「星空广场二期」
  if ((na.includes(nb) || nb.includes(na)) && minLen / maxLen >= CONTAINS_MIN_RATIO) {
    return 80
  }

  const dist = levenshtein(na, nb)
  if (minLen >= EDIT_MIN_LEN) {
    if (dist === 1) return 92
    if (dist === 2) return 70
  }
  return 0
}

/**
 * 为一个解析出的门店名，从候选池里挑出 top N 并标记 suggest / ambiguous。
 *
 * @param {string} parsedName Excel 解析出的门店名（**必须是封面 E21 覆盖后的最终名**：
 *        文件名与 E21 不一致时以 E21 为准，候选若按文件名算，用户看到的候选和实际依据不一致）
 * @param {Array<object>} pool 候选池（已按可见域/软删/营业状态过滤好，见 purchase-import.js）
 * @returns {{candidates: Array<object>, ambiguous: boolean, matched: number}}
 *          `candidates[].score` 分数、`.suggest` 是否可预置选中
 */
export function rankCandidates(parsedName, pool) {
  const rows = Array.isArray(pool) ? pool : []
  const scored = []
  for (const row of rows) {
    const score = scoreName(parsedName, row && row.name)
    if (score >= CANDIDATE_MIN_SCORE) scored.push({ ...row, score })
  }
  // 同分时按名称排，保证同样的输入每次给同样的顺序（便于截图比对与测试）
  scored.sort((x, y) => y.score - x.score || String(x.name).localeCompare(String(y.name), 'zh'))

  const candidates = scored.slice(0, CANDIDATE_LIMIT)
  const ambiguous = candidates.length >= 2 &&
    (candidates[0].score - candidates[1].score) < AMBIGUOUS_GAP

  for (const c of candidates) {
    // 🔴 预置 ≠ 导入：只是把下拉预填成这家，复选框仍要用户亲手勾（见 §6.170.2）
    c.suggest = c.score >= SUGGEST_SCORE && !ambiguous
  }
  return { candidates, ambiguous, matched: scored.length }
}

/**
 * 转义 SQL LIKE 的通配符，配合 `... LIKE ? ESCAPE '\'` 使用。
 *
 * 🔴 为什么必须转义：`parseFileName` 用 `parts.slice(0, radiusIdx).join('_')` 拼店名
 *    ⇒ **门店名本身就可以含下划线**（`星空_广场_2km_202606.xlsx`）。SQLite 的 LIKE 里
 *    `_` 是「任意单字符」、`%` 是任意串 ⇒ 不转义会大量误召回，用户看到一堆不相干的店。
 * ⚠️ 反斜杠必须**先**转义，否则会把后加的转义符再转一遍。
 *
 * @param {string} str 原始文本
 * @returns {string}
 */
export function escapeLike(str) {
  return String(str == null ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}
