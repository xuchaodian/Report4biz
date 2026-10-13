/**
 * VIP 到期判据 —— 前端唯一来源
 *   · 门禁层 v1.13.213 ｜ · 展示层 v1.13.215
 *
 * 【门禁层】与后端 `backend/src/utils/aiQuota.js::isVipActive` **刻意同口径**（逐行对应）：
 *   后端：if (!user) return false
 *         if (role ∉ {vip, trial, admin}) return false
 *         if (!user.vip_until) return true                      ← 空 = 长期有效
 *         return new Date(String(user.vip_until) + 'T23:59:59') >= now
 *
 * 🔴 立此文件的背景（211/212 挂账的遗留 B）：
 *   v1.13.208 把 VIP 功能门禁收敛到 `stores/user.js::isVipActive` 时，
 *   **只搬了角色白名单、漏了 `vip_until` 有效期** ⇒ 正式 vip 到期后
 *   （role 恒为 'vip'、到期日已过）前端仍全放行：🔒VIP 角标不显示、
 *   销售预测不出空态，用户点进去才被**后端 403**（「能点但报错」）。
 *   ——「同一判据多处拷贝必然分叉」的又一实例，这次是**收敛过程中漏抄**。
 *
 * 【展示层】v1.13.215 收敛（214 遗留 ①）：
 *   213 当时**只收了门禁**，展示层仍留 5~6 处就地实现（`MyAccountView` 的
 *   vipUntilText / vipExpired / vipDaysLeft / vipExpiring 与 `UsersView` 的
 *   isVipExpiring / isVipExpired），其中硬编码 `'T23:59:59'` 4 处、角色白名单重复 2 遍。
 *   本批一并收敛到本文件 ⇒ **全前端源码里 `'T23:59:59'` 只此一处**（守卫钉死）。
 *
 * ⚠️ 🔴 两条链路的**角色白名单刻意不同**，⛔ 勿合并：
 *   · 门禁 `VIP_ROLES` = ['vip','trial','admin']      —— 与后端一字不差
 *   · 展示 `VIP_EXPIRING_ROLES` = ['vip','trial']     —— **admin 无到期概念，不参与临期/过期展示**
 *
 * 🔴 v1.13.215 的一项**有意归一化**（改行为，须记档）：
 *   旧 `UsersView::isVipExpiring` 只判 `days >= 0 && days <= 30`，**缺 `!expired` 守卫**；
 *   而 `days` 用 `Math.ceil` ⇒ 到期日的**次日整整一天**内 `days` 仍为 0
 *   （`d - now ∈ (-86400000, 0]`）⇒ 该行会**同时**标「⏰ 临期」与「❌ 已过期」。
 *   现统一为**三档互斥**（已过期 / 临期 / 正常）；`MyAccountView` 原本就带 `!vipExpired`
 *   ⇒ 两页统一到更正确的那个。本文件是唯一实现，故改一处即两页同时生效。
 *
 * 守卫：
 *   · `backend/tests/vipUntilParity.test.js`         —— 门禁侧与后端逐条同输出（212/213）
 *   · `backend/tests/vipUntilDisplayParity.test.js`  —— 展示侧与旧就地实现逐条同输出 ＋ 归一化钉子（215）
 */

/** 到期日按「当日 23:59:59」计 —— 与后端 aiQuota.js 一字不差 */
export const VIP_UNTIL_TIME_SUFFIX = 'T23:59:59'

/** 【门禁】视为「VIP 权益」的角色 —— 即后端 isVipActive 的同一白名单 */
export const VIP_ROLES = ['vip', 'trial', 'admin']

/** 【展示】参与「临期/过期」提醒的角色 —— 🔴 刻意**不含 admin**（admin 无到期概念） */
export const VIP_EXPIRING_ROLES = ['vip', 'trial']

/** 【展示】「临期」阈值（天）—— 展示档位，非门禁 */
export const VIP_EXPIRING_DAYS = 30

const DAY_MS = 86400000

/**
 * 到期日归一到「当日 23:59:59」的 Date。
 * @param {string|null|undefined} vipUntil 'YYYY-MM-DD'
 * @returns {Date|null} 空值或非法串 ⇒ null
 */
export function vipUntilEndOfDay(vipUntil) {
  if (!vipUntil) return null
  const d = new Date(String(vipUntil) + VIP_UNTIL_TIME_SUFFIX)
  return isNaN(d.getTime()) ? null : d
}

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

// ---------------------------------------------------------------------------
// 展示层（v1.13.215 收敛）—— 三档互斥：已过期 / 临期 / 正常
// ---------------------------------------------------------------------------

/**
 * 距到期还有几天（向上取整）。**空值/非法 ⇒ null**（= 长期有效，不参与提醒）。
 * 🔴 非法日期串 ⇒ null（旧就地实现返回 `NaN` ⇒ 模板会显示「剩余 NaN 天」）—— 本批**有意加固**。
 * @param {string|null|undefined} vipUntil
 * @param {Date} [now]
 * @returns {number|null}
 */
export function vipDaysRemaining(vipUntil, now = new Date()) {
  const d = vipUntilEndOfDay(vipUntil)
  if (!d) return null
  const n = Math.ceil((d - now) / DAY_MS)
  // ⚠️ `Math.ceil` 在 `(-DAY_MS, 0)` 区间返回 **-0**（到期日次日即如此）；
  //    归一为 0，避免 `Object.is` / JSON 序列化层面的意外（`-0 !== 0` 为 false，不影响比较）。
  return n === 0 ? 0 : n
}

/**
 * 是否已过期。空值/非法 ⇒ false。
 * ⚠️ 仅 `VIP_EXPIRING_ROLES` 的角色需要判此项；admin 请勿用（用 `isVipExpiredByRole` 会自动挡掉）。
 * @param {string|null|undefined} vipUntil
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isVipExpiredFor(vipUntil, now = new Date()) {
  const d = vipUntilEndOfDay(vipUntil)
  if (!d) return false
  return d < now
}

/**
 * 是否临期（`0 ≤ 剩余 ≤ VIP_EXPIRING_DAYS`）**且未过期**。
 * 🔴 `!isVipExpiredFor` 这一步是本批的**归一化**：`Math.ceil` 会让「到期日次日」的
 *    剩余天数仍为 0 ⇒ 不加此守卫就会出现「既临期又已过期」的矛盾态。
 * @param {string|null|undefined} vipUntil
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isVipExpiringFor(vipUntil, now = new Date()) {
  const days = vipDaysRemaining(vipUntil, now)
  if (days === null || days < 0 || days > VIP_EXPIRING_DAYS) return false
  return !isVipExpiredFor(vipUntil, now)
}

/**
 * 到期日展示文案。
 *   空值 ⇒ '长期有效'（与站点既有文案一致，属 UI 文案）；非法串 ⇒ 原串前 10 位；正常 ⇒ 'YYYY-MM-DD'
 * @param {string|null|undefined} vipUntil
 * @returns {string}
 */
export function formatVipUntil(vipUntil) {
  if (!vipUntil) return '长期有效'
  const d = new Date(String(vipUntil))
  if (isNaN(d.getTime())) return String(vipUntil).slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * 带角色档位的「临期」判据（列表行用）。角色 ∉ `VIP_EXPIRING_ROLES` ⇒ 恒 false（admin 即此类）。
 * @param {{role?:string, vip_until?:string|null}|null|undefined} user
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isVipExpiringByRole(user, now = new Date()) {
  if (!user || !VIP_EXPIRING_ROLES.includes(user.role)) return false
  return isVipExpiringFor(user.vip_until, now)
}

/**
 * 带角色档位的「已过期」判据（列表行用）。角色 ∉ `VIP_EXPIRING_ROLES` ⇒ 恒 false。
 * @param {{role?:string, vip_until?:string|null}|null|undefined} user
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isVipExpiredByRole(user, now = new Date()) {
  if (!user || !VIP_EXPIRING_ROLES.includes(user.role)) return false
  return isVipExpiredFor(user.vip_until, now)
}
