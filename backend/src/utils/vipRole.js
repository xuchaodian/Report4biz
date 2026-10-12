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
