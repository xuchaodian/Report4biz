/**
 * 半径文案：1000 →「1km」、1500 →「1.5km」、500 →「500m」
 *
 * 🔴 抽成独立文件的理由（v1.13.417）：立项报告（candidateReport.js）与档位角色判定
 *    （tierRoles.js）都要拼「半径 X」的文案。原来只有 candidateReport 里一份，
 *    新增 tierRoles 时若各写一份，就会出现「报告正文 1.5km、对比表 1.50 km」这种不一致。
 *    ⇒ 单一实现，两边 import。
 */
export function radiusText(m) {
  const n = Number(m)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1000) {
    const km = n / 1000
    return `${Number.isInteger(km) ? km : km.toFixed(1)}km`
  }
  return `${Math.round(n)}m`
}
