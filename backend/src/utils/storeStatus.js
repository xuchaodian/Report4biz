// ============================================================================
// 门店「在营」口径 —— **单一真源**（v1.13.240）
// ----------------------------------------------------------------------------
// 谁在用：
//   ① routes/dashboard.js  仪表盘 KPI「我的门店 / 覆盖城市 / 覆盖省份」
//   ② routes/shapefiles.js calculate-potential「我的门店数」
// ⛔ 不要在路由里另写一份 status 列表 / SQL 片段：两处口径一旦分叉，
//    「大屏说 39 家在营、开店余地说 41 家」这种对不上账的问题极难排查。
//
// 口径定义（与业主 2026-10-17 拍板一致）：
//   在营 = store_type = '已开业' 且 store_status 不属于以下异常状态
//   ⚠️ 空串 '' 视为正常（存量数据大量为空串，NOT IN 对 '' 为真，符合预期）；
//      NULL 会被 `NOT IN` 判为 NULL ⇒ 被排除（与仪表盘既有行为一致）。
// ============================================================================

/** 异常经营状态（停业/歇业/关闭等），大屏与开店余地共用 */
export const ABNORMAL_STORE_STATUS = ['闭店', '停业', '歇业', '关闭', '停业整顿', '未知', '待开业', '筹备中']

/** `AND store_status NOT IN (?,…)` —— 参数用 ABNORMAL_STORE_STATUS（顺序一致） */
export const ABNORMAL_STATUS_SQL = `AND store_status NOT IN (${ABNORMAL_STORE_STATUS.map(() => '?').join(',')})`

/** `AND store_type = '已开业'` */
export const OPEN_ONLY_SQL = `AND store_type = '已开业'`

/** 「在营」完整条件（拼在 WHERE 之后；参数顺序：...ABNORMAL_STORE_STATUS） */
export const IN_BUSINESS_SQL = `${OPEN_ONLY_SQL} ${ABNORMAL_STATUS_SQL}`

/** 与 IN_BUSINESS_SQL 配套的参数 */
export const IN_BUSINESS_PARAMS = [...ABNORMAL_STORE_STATUS]
