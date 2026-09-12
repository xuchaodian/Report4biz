// ============================================================================
// 配额池 / 账号授权额度的统一读取入口（P0 · 集团/子公司数据同步）
// ----------------------------------------------------------------------------
// 背景：全系统有 4 处会扣减联通配额（smartsteps / districts / scoringEngine /
// resale），它们原先各自 `SELECT remaining_quota FROM admin_quota` 做门禁。
// 本文件把这些散落读取收敛到一处，供：
//   · utils/quotaGate.js  —— 授权闸门（规则 20）
//   · routes/resale.js    —— 预算池展示（原 getPoolInfo 的宿主）
// 共用。
//
// ⚠️ 不要从 routes/resale.js 反向 import getPoolInfo —— 会造成
//    resale.js → quotaGate.js → resale.js 的循环依赖。
//    resale.js 已改为从本文件 import 并继续 re-export（保持 users.js 兼容）。
// ============================================================================

/**
 * 上游预算池信息（用户页分配与 API 开放页共用同一批联通配额）
 * 池已占用 = Σ(users.quota) + Σ(api_keys.balance，仅真实模式)
 * 注意：测试模式（mock=1）的 key 不调上游、不消耗配额，不计入池占用
 */
export function getPoolInfo(db) {
  const quotaRecord = db.prepare(`SELECT initial_quota FROM admin_quota WHERE id = 1`).get()
  const poolTotal = quotaRecord?.initial_quota || 0
  const allocatedUsers = db.prepare(`SELECT COALESCE(SUM(quota), 0) as total FROM users WHERE role != 'admin'`).get()?.total || 0
  const allocatedApi = db.prepare(`SELECT COALESCE(SUM(balance), 0) as total FROM api_keys WHERE COALESCE(mock, 0) = 0`).get()?.total || 0
  const mockBalance = db.prepare(`SELECT COALESCE(SUM(balance), 0) as total FROM api_keys WHERE COALESCE(mock, 0) = 1`).get()?.total || 0
  const occupied = allocatedUsers + allocatedApi
  return {
    poolTotal,           // 上游总配额（当前批次）
    allocatedUsers,      // 用户页已分配
    allocatedApi,        // API 开放页已分配（真实模式余额合计）
    mockBalance,         // 测试模式余额（不占池）
    occupied,            // 池已占用
    available: Math.max(0, poolTotal - occupied)  // 剩余可分配
  }
}

/**
 * 物理池「当前剩余配额」——与联通结算的上游真实余额。
 * ★ 这是唯一能真正决定"上游还能不能被调用"的数字：
 *   4 个扣减入口的原生门禁读的就是它；向子公司分配配额**不会**改变它（规则 19）。
 */
export function getPoolRemaining(db) {
  return db.prepare(`SELECT remaining_quota FROM admin_quota WHERE id = 1`).get()?.remaining_quota || 0
}

/**
 * 集团「可分配余额」—— 防超卖的不变量 Ⅰ（设计方案 §3.6 Ⅳ）：
 *   allocatable = max(0, min(
 *     poolTotal − occupied,                ← 现有口径（「发了多少」）
 *     remaining − Σ非admin未消耗授权         ← 物理口径（「池里还剩多少」）
 *   ))
 * 其中「未消耗授权」= max(0, users.quota − Σ active quota_used)，按非 admin 账号合计。
 * ★ 一级分配（pool_grant）只允许扣这个数 —— 从结构上杜绝超卖，而不是靠接口层 if。
 *   两个口径取 min()：未消耗时两式相等、无行为变化；已消耗后物理口径更严。
 */
export function getAllocatable(db) {
  const pool = getPoolInfo(db)
  const remaining = getPoolRemaining(db)
  const unconsumed = db.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN u.quota > COALESCE(pu.used, 0)
           THEN u.quota - COALESCE(pu.used, 0) ELSE 0 END
    ), 0) AS n
      FROM users u
      LEFT JOIN (SELECT user_id, SUM(quota_used) AS used FROM purchases
                  WHERE status = 'active' GROUP BY user_id) pu ON pu.user_id = u.id
     WHERE u.role != 'admin'
  `).get()?.n || 0
  return Math.max(0, Math.min(pool.available, remaining - unconsumed))
}

/**
 * 账号「未消耗授权余额」= max(0, users.quota − Σ(active 的 quota_used))
 * ★ 与个人中心「剩余次数」(routes/purchase.js) 及管理员页「剩余次数」(routes/users.js)
 *   同一口径（v1.13.116 起两页已对齐）。
 */
export function getOwnQuota(db, userId) {
  if (!userId) return 0
  const own = db.prepare(`SELECT quota FROM users WHERE id = ?`).get(userId)?.quota || 0
  const used = db.prepare(`
    SELECT COALESCE(SUM(quota_used), 0) AS u FROM purchases
    WHERE user_id = ? AND status = 'active'
  `).get(userId)?.u || 0
  return Math.max(0, own - used)
}

/**
 * 账号是否为「受管辖的组织成员」——决定授权闸门是否生效（兼容开关 P8）。
 * ★ 仅在 org_members 有行、且未被兜底开关 quota_gate_disabled 关闭时返回 true。
 *   非组织账号（存量 youshi / xucd 等）恒为 false → 行为与改动前完全一致，
 *   避免"历史 users.quota 远小于历史消耗"的账号突然配额耗尽。
 */
export function isOrgMember(db, userId) {
  if (!userId) return false
  try {
    const row = db.prepare(`
      SELECT 1 AS ok FROM org_members
      WHERE user_id = ? AND COALESCE(quota_gate_disabled, 0) = 0
      LIMIT 1
    `).get(userId)
    return !!row
  } catch (e) {
    // org_members 表尚未建立（老库首启窗口）→ 视为非成员
    return false
  }
}
