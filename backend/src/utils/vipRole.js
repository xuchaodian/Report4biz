/**
 * VIP 角色口径 —— 单一权威来源（v1.13.205）
 *
 * 为什么单独抽一个文件：
 *   这份「角色 → 到期日」的映射原先只写在 routes/users.js 里，且历史上曾
 *   在 POST 与 PUT **两处各写一遍并因此分叉出过 bug**（v1.13.158 才合并）。
 *   v1.13.205 新增「VIP 试用申请审批」链路（routes/vipApplications.js 通过后
 *   同样要写 role='trial' + vip_until），若不抽出来就会产生**第三份拷贝**。
 *   ⇒ 凡是要按角色算到期日的地方，一律 import 本模块，不得再就地复制。
 *
 * 🔴 与 tests/userVipUntil.test.js 的 G1 全库不变量绑定：
 *   凡 role ∈ {vip, trial} 的行，vip_until 必须非空 —— 否则 app.js 的 trial 到期
 *   降级 SQL（`WHERE role='trial' AND vip_until IS NOT NULL AND vip_until < ?`）
 *   永远匹配不到，账号会**永久白嫖 VIP**。故任何把角色置为 vip/trial 的写路径，
 *   都必须用 calcVipUntil(role) 的返回值一起写 vip_until。
 */

/** 各角色对应的有效天数：vip → 1 年；trial → 30 天（VIP 试用）。其他角色 → 无到期日。 */
export const VIP_DAYS = { vip: 365, trial: 30 }

/**
 * 按角色计算到期日（YYYY-MM-DD）。
 * @param {string} role 'vip' | 'trial' | 其他
 * @returns {string|null} 今天 + VIP_DAYS[role] 天；角色不在表内则 null
 */
export const calcVipUntil = (role) => {
  const days = VIP_DAYS[role]
  if (!days) return null
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * 角色权限位阶（v1.13.211 · 单一权威来源）
 *
 *   user(0) < trial(1) < vip(2) < admin(3)
 *
 * 用途：判断一次「改角色」到底是**降权**还是**提权**。
 *
 * 🔴 为什么必须区分：middleware/auth.js 里 `req.user = decoded` ⇒ requireAdmin 等
 *    判的是 **JWT 载荷**，不是库。所以「把某人从 vip/admin 改回 user」若不同时把
 *    该账号的 token_version +1，旧 token 里的旧角色会在 **TOKEN_TTL=7d** 内继续放行
 *    —— 后台点了「收回权限」，对方其实还在用。这就是 v1.13.150 起挂账的治本项。
 *
 * ⚠️ trial 与 vip 位阶**刻意不同**：功能门禁上两者等价（isVipActive 均放行），但
 *    额度档位不同（AI 月额度 trial 50 次 / vip 1000 次）⇒ `vip → trial` 属降权，要撤。
 *    反之 `trial → vip` 是提权，不必撤（提权不会多放行任何东西）。
 */
export const ROLE_RANK = { user: 0, trial: 1, vip: 2, admin: 3 }

/**
 * 改角色是否为降权（⇒ 需要撤销该账号**全部**已签发 token）。
 *
 * @param {string} fromRole 库内当前角色
 * @param {string} toRole   即将写入的角色
 * @returns {boolean}
 *
 * 未知角色（脏值 / 拼写错 / 新增了角色却没同步进 ROLE_RANK）一律按**降权**处理：
 * fail-closed —— 宁可多踢一次让对方重登，也不能漏撤把权限留在手里 7 天。
 */
export function isPrivilegeDowngrade(fromRole, toRole) {
  if (!fromRole || !toRole) return false
  if (fromRole === toRole) return false
  const from = ROLE_RANK[fromRole]
  const to = ROLE_RANK[toRole]
  if (from === undefined || to === undefined) return true
  return to < from
}
