/**
 * 「报告取数」与「门店购买」的口径分流 —— v1.13.342
 *
 * 背景：`POST /api/smartsteps/population`（立项报告人口，v1.13.341）真正付费成功后，
 * 会在同一事务写一条 `purchases` 行，`store_type='report'`。这样设计是**必要的**：
 *   ① 购买履历要能追溯这笔消费；② 报告下次能按「点 + 半径」复用它，不重复扣费。
 *
 * 但它**不是门店购买**：
 *   · `store_name` 是候选点位名，而候选点位在独立表 `store_candidates`，不在 `markers`；
 *     ⇒ `LEFT JOIN markers` 取不到城市/区县/门店编号，订单号会退化成裸点位名。
 *   · 按 `store_name` 分组的门店统计会把它当一家店，虚增「购买次数 / 星级」。
 *   · `result_data` 只有 1001（人口）一项服务，没有门店商圈报表的 1002~1013 全套指标；
 *     ⇒ 详情图表 / 343 指标宽表 / 订单对比看板会大面积空白，用户以为「报表坏了」。
 *
 * ⇒ 所有「按门店」统计 / 关联 / 汇总的读点必须排除它；
 *   `/history` 与 `/quota` **不排除**（前者要可追溯，后者确实扣了 1 次配额）。
 *
 * 🔴 项目铁律「派生/解析算法必抽单一函数共用」：判据只在这一个文件里，
 *    各路由一律用 `STORE_ONLY_SQL` / `isReportPurchase()`，⛔ 不许就地写 'report' 字面量。
 */

export const REPORT_STORE_TYPE = 'report'

/**
 * 门店口径 SQL 片段 —— ⚠️ **三处读点的 FROM 一律写成 `FROM purchases p`**。
 * 必须带 `p.` 前缀：`/by-store` 会 `LEFT JOIN markers m`，而 markers 也有 `store_type` 列，
 * 裸列名会直接报 `ambiguous column name: store_type`（v1.13.342 HTTP 层测试抓到）。
 * 用 `IS NULL OR <>` 而不是 `= 'xxx'`：存量行的 store_type 允许为空，不能把它误排除。
 */
export const STORE_ONLY_SQL = `(p.store_type IS NULL OR p.store_type <> '${REPORT_STORE_TYPE}')`

/** 该行是不是「立项报告人口取数」 */
export function isReportPurchase(storeType) {
  return String(storeType || '') === REPORT_STORE_TYPE
}

/** 展示用类型名：报告取数显示中文，其余保持原值（已开业 / 重点候选 / 一般候选 …） */
export function storeTypeLabel(storeType) {
  return isReportPurchase(storeType) ? '报告取数' : (storeType || '')
}

/** 报告取数行的来源说明（履历 / 详情共用，⛔ 不在两个组件里各写一份文案） */
export const REPORT_SOURCE_NOTE =
  '立项报告人口取数（候选点位）· 仅含联通 1001 人口服务，不含门店商圈全套指标；报表导出与对比看板的其余指标为空属正常。'

/**
 * 从 `purchases.result_data` 里取出实际包含的服务码。
 * 兼容三种存量外壳：{ apiResult: {...} } / 裸 { '1001': ... } / 数组。
 * 用途：详情里说明「为什么这张表没有客流 / 消费指标」—— 不是坏了，是只买了人口服务。
 */
export function storedServiceCodes(resultData) {
  let obj = resultData
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj) } catch { return [] }
  }
  if (!obj || typeof obj !== 'object') return []
  const api = (obj.apiResult && typeof obj.apiResult === 'object') ? obj.apiResult : obj
  if (Array.isArray(api)) {
    return api.map((x) => String(x?.service_code ?? '')).filter(Boolean)
  }
  return Object.keys(api).filter((k) => /^\d{4}$/.test(k)).sort()
}
