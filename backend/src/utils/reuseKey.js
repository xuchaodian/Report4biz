/**
 * 联通人口数据的「复用键」判据（批次 373 从 routes/smartsteps.js 抽出）
 *
 * ── 为什么要单独一个文件 ────────────────────────────────────────────────
 * `purchases.radius` 的解析（`radiusIncludes`）与坐标容差（`REUSE_TOL_M`）是
 * **两个模块共用的判据**：
 *   · `routes/smartsteps.js::fetchPointPopulation` —— 决定「这次取数要不要花钱」
 *   · `routes/site-select.js::mergePurchasedPoints` —— 决定「哪些已购点可以免费用」
 * 两处数字一旦漂移，就会出现「并进候选时以为是免费的、真精算时又扣了钱」。
 *
 * 原本它们定义在 `smartsteps.js` 里，但那个模块会 `import config`、发 HTTP 请求，
 * 测试里常被整模块 mock 掉 —— 一旦 mock，这两个命名导出就变成 `undefined`：
 *   `planarMeters(...) <= undefined` ⇒ 恒 false（静默不合并）
 *   `radiusIncludes(...)` ⇒ TypeError（被上层 try/catch 吞掉，静默跳过）
 * **两种都是假绿**。所以抽到这个零依赖的纯函数文件里，mock 掉 smartsteps 也不影响它。
 *
 * ⚠️ 本文件⛔ 不许 import 任何业务模块（尤其 smartsteps / config），保持零依赖。
 */

/** 坐标复用容差（米）—— 业主 2026-11-09 定为 10m */
export const REUSE_TOL_M = 10

/**
 * 把 `purchases.radius` 归一成**去重升序的半径数组**。
 *
 * 容忍的真实形态（都在现网出现过）：
 *   `"[1000]"` / `"[1000,3000]"`  —— JSON 字符串，`POST /api/purchase/query` 落库的标准形态
 *   `"1000"` / `1000`             —— 裸字符串 / 裸数字（手工补数据、老版本遗留）
 *   `[1000, 3000]`                —— 已解析数组
 *   脏值（`null` / `""` / `"[abc]"` / `{}`）⇒ `[]`，⛔ 不抛异常
 *   （调用方一律按「没有可复用半径」处理；为一条脏数据让整单 estimate 报 500 才是灾难）
 *
 * 🔴 为什么必须抽成单一函数（批次 374）：
 *    `radiusIncludes`（判「这个点能不能复用」）与
 *    `mismatchRadii`（告诉用户「改回哪些半径能复用」）
 *    是**同一个解析问题的两个用途**。各写一份，一旦一边认 `"[1000,3000]"`、另一边只认裸数字，
 *    就会出现「提示说改回 3000 米能复用、真改回 3000 米又说不能复用」——
 *    比不提示更坏（用户按建议操作了，钱还是白花）。
 */
export function parseRadii(raw) {
  if (raw === null || raw === undefined || raw === '') return []
  let v = raw
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return []
    try { v = JSON.parse(s) } catch { v = Number(s) }
  }
  const list = Array.isArray(v) ? v : [v]
  const out = []
  for (const x of list) {
    const n = Number(x)
    // ⚠️ `Number('')` 是 0、`Number(null)` 也是 0 ⇒ 必须 `n > 0` 才收，
    //    否则空串会被当成「半径 0 米」混进建议列表。
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n)
  }
  return out.sort((a, b) => a - b)
}

/**
 * 判断该条已购记录的半径**是否包含**目标半径。
 *
 * 🔴 半径是取数缓存 key 的一部分：「半径不匹配就一定会重新扣费」。
 *    所以并入候选集之前必须先过这一关，否则会把注定花钱的点当成免费点。
 */
export function radiusIncludes(raw, want) {
  const w = Number(want)
  if (!Number.isFinite(w)) return false
  return parseRadii(raw).includes(w)
}
