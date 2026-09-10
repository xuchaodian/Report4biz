/**
 * 列表接口可选分页解析（v1.13.107 M4）
 *
 * 设计原则：**向后兼容**。这些列表接口同时被地图图层（需要全量坐标）与管理端表格消费，
 * 因此默认（不传 limit）必须维持原「全量返回」语义，分页为**显式 opt-in**。
 *
 * 用法：
 *   const { limit, offset, wantTotal } = parsePaging(req.query)
 *   if (limit) { sql += ' LIMIT ? OFFSET ?'; params.push(limit, offset) }
 *
 * 约定：
 *   - limit 缺失 / 非数字 / <=0  → limit = 0（调用方不加 LIMIT，即全量）
 *   - limit 上限 maxLimit（默认 2000），防一次拉爆
 *   - offset 非法 → 0
 *   - total=1 / true / withTotal=1 → 调用方附带总数
 */
export function parsePaging(query = {}, { maxLimit = 2000 } = {}) {
  const rawLimit = parseInt(query.limit, 10)
  const rawOffset = parseInt(query.offset, 10)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : 0
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0
  const wantTotal = query.total === '1' || query.total === 'true' || query.withTotal === '1'
  return { limit, offset, wantTotal }
}

export default parsePaging
