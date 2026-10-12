/**
 * VIP 到期判据 —— 前端唯一来源（v1.13.213）
 *
 * 与后端 `backend/src/utils/aiQuota.js::isVipActive` **刻意同口径**（逐行对应）：
 *   后端：if (!user) return false
 *         if (role ∉ {vip, trial, admin}) return false
 *         if (!user.vip_until) return true                      ← 空 = 长期有效
 *         return new Date(String(user.vip_until) + 'T23:59:59') >= now
 *
 * 🔴 立此文件的背景（211/212 挂账的遗留 B）：
 *   v1.13.208 把 VIP 功能门禁收敛到 `stores/user.js::isVipActive` 时，
 *   **只搬了角色白名单、漏了 `vip_until` 有效期** ⇒ 正式 vip 到期后
 *   （`role` 恒为 'vip'、到期日已过）前端仍全放行：🔒VIP 角标不显示、
 *   销售预测不出空态，用户点进去才被**后端 403**（「能点但报错」）。
 *   ——「同一判据多处拷贝必然分叉」的又一实例，这次是**收敛过程中漏抄**。
 *
 * ⚠️ 本文件是**门禁**判据，与「VIP 徽章 / 到期日展示」语义不同，勿混用：
 *   展示层另有 5 处就地实现 —— `MyAccountView` 的 vipUntilText / vipExpired / vipDaysLeft，
 *   `UsersView` 的 isVipExpiring / isVipExpired。其中「临期（≤30 天）」是**展示档位**、
 *   不属门禁 ⇒ v1.13.213 **刻意不动**它们（动了要重跑展示回归，收益低）。
 *   若日后要收敛，请先补展示回归测试再合并。
 *
 * 守卫：`backend/tests/vipUntilParity.test.js`
 *   ① 断言本文件与后端 isVipActive 在 11 组真实样本上**逐条同输出**（行为级，非关键词匹配）；
 *   ② 断言 `stores/user.js` **不得内联重写** 'T23:59:59'（必须复用本文件）。
 */

/** 到期日按「当日 23:59:59」计 —— 与后端 aiQuota.js 一字不差 */
export const VIP_UNTIL_TIME_SUFFIX = 'T23:59:59'

/** 视为「VIP 权益」的角色 —— 即后端 isVipActive 的同一白名单 */
export const VIP_ROLES = ['vip', 'trial', 'admin']

/**
 * 到期日是否仍在有效期内。
 * @param {string|null|undefined} vipUntil 'YYYY-MM-DD'；**空 = 长期有效（不过期）**
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isVipUntilValid(vipUntil, now = new Date()) {
  if (!vipUntil) return true
  return new Date(String(vipUntil) + VIP_UNTIL_TIME_SUFFIX) >= now
}

/**
 * ★ VIP 功能门禁判据（全站唯一来源）。
 * `stores/user.js::isVipActive` 即调用本函数，与后端 `aiQuota.js::isVipActive` 同口径。
 *
 * @param {{role?:string, vip_until?:string|null}|null|undefined} user
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isVipRoleActive(user, now = new Date()) {
  if (!user) return false
  if (!VIP_ROLES.includes(user.role)) return false
  return isVipUntilValid(user.vip_until, now)
}
