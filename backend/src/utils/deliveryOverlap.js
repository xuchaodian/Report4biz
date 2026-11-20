/**
 * 外卖配送圈重叠判据（v1.13.390）—— 纯几何、假设半径、⛔ 非实测
 *
 * 背景：竞品报告 P0「补配送半径重叠判据」（样板销售武器组，海外 Sweetgreen 做法）。
 * 🔴 系统无「门店配送半径」字段（全仓库零匹配）⇒ ⛔ 不能伪装成实测数据。
 *    本模块只做「给定假设半径 R 下的两圈重叠率」几何示意，供案例页/内容固化口径。
 *    输出一律带 assumed:true 与 caveat 文案，防止被当成真实经营数据引用。
 *
 * 铁律：
 *   · 免费层/内容页只给「几何重叠率」结论，⛔ 不调付费接口、不烧联通配额。
 *   · ⛔ 不用重叠率直接下「一定蚕食」结论——距离近≠蚕食，商场内外/楼层/动线都会影响，
 *     最终必须回到销售数据验证（与 storeCheckup 的「距离近≠一定蚕食」同口径）。
 *   · 半径来源单一常量 DEFAULT_DELIVERY_RADIUS_M，改它要同步案例页（守卫钉死一致性）。
 *   · 派生算法单一实现：案例页 SVG、文案数字都从本函数取值，⛔ 各写各的。
 */

/** 假设的外卖配送半径（米）—— ⛔ 非实测，仅为典型量级示意 */
export const DEFAULT_DELIVERY_RADIUS_M = 3000

/** 重叠率分档（ratio = 相交面积 / 单圈面积，左闭右开，降序） */
export const OVERLAP_TIERS = [
  { key: 'high', label: '高度重叠', min: 0.6 },
  { key: 'mid', label: '部分重叠', min: 0.3 },
  { key: 'low', label: '基本独立', min: 0 }
]

export function tierOfOverlap(ratio) {
  for (const t of OVERLAP_TIERS) if (ratio >= t.min) return t.key
  return 'low'
}

/**
 * 两等半径圆相交面积（m²）
 * A = 2R²·acos(d/2R) − (d/2)·√(4R²−d²)
 *   d ≥ 2R ⇒ 不相交(0)；d = 0 ⇒ 完全重合(πR²)
 */
export function circleOverlapArea(R, d) {
  if (!(R > 0) || !Number.isFinite(d) || d < 0) return 0
  if (d >= 2 * R) return 0
  if (d === 0) return Math.PI * R * R
  const a = 2 * R * R * Math.acos(d / (2 * R))
  const b = (d / 2) * Math.sqrt(4 * R * R - d * d)
  return Math.max(0, a - b)
}

/**
 * 配送圈重叠判据（等半径示意）
 * @param {number} distanceM 两门店球面直线距离（米）
 * @param {number} [radiusM] 假设配送半径，默认 DEFAULT_DELIVERY_RADIUS_M
 * @returns {{distanceM:number,radiusM:number,assumed:true,overlapAreaM2:number,
 *            overlapRatio:number,ratioPct:number,tier:string,tierLabel:string,caveat:string}}
 */
export function deliveryOverlap(distanceM, radiusM = DEFAULT_DELIVERY_RADIUS_M) {
  const d = Number.isFinite(distanceM) && distanceM >= 0 ? distanceM : 0
  const R = Number.isFinite(radiusM) && radiusM > 0 ? radiusM : DEFAULT_DELIVERY_RADIUS_M
  const area = circleOverlapArea(R, d)
  const full = Math.PI * R * R
  const ratio = full > 0 ? Math.min(1, area / full) : 0
  const tier = tierOfOverlap(ratio)
  return {
    distanceM: d,
    radiusM: R,
    assumed: true,
    overlapAreaM2: Math.round(area),
    overlapRatio: Math.round(ratio * 1000) / 1000,
    ratioPct: Math.round(ratio * 100),
    tier,
    tierLabel: (OVERLAP_TIERS.find(t => t.key === tier) || OVERLAP_TIERS[OVERLAP_TIERS.length - 1]).label,
    caveat: '假设配送半径下的几何示意，非实测；距离近≠一定蚕食，需销售数据验证。'
  }
}
