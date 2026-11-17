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
 * `purchases.radius` 存的是 **JSON 字符串**（`"[1000]"` 或 `"[1000,3000]"`，见 /query 落库），
 * 也可能是裸数字/裸字符串。这里统一判断「是否包含目标半径」。
 *
 * 🔴 半径是取数缓存 key 的一部分：「半径不匹配就一定会重新扣费」。
 *    所以并入候选集之前必须先过这一关，否则会把注定花钱的点当成免费点。
 */
export function radiusIncludes(raw, want) {
  if (raw === null || raw === undefined || raw === '') return false
  let v = raw
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { v = Number(raw) }
  }
  if (typeof v === 'number') return Number(v) === Number(want)
  if (Array.isArray(v)) return v.map(Number).includes(Number(want))
  return false
}
