/**
 * 当前用户标识（uid）的**唯一出口** —— v1.13.198 跨账号串档修复。
 *
 * 🔴 背景（这是个真实发生过的越权/串档事故）：
 *    `userId` 原先存在 `localStorage`（同一浏览器**全局共享**），
 *    而登录凭据 `token` 存在 `sessionStorage`（**按标签页隔离**）。
 *    两者隔离级别不匹配 ⇒ 同一浏览器开两个标签页分别登录不同账号时，
 *    **后登录者会覆盖 `localStorage.userId`**，于是**先登录那个标签页**里
 *    所有「按 uid 命名」的本地数据都会读写到**别人的命名空间**：
 *      图层品牌勾选(`brandLayerFilter_*`) / 我的门店筛选(`markerFilters_*`) /
 *      竞品筛选(`competitorFilters_*`) / 品牌门店筛选(`brandStoreFilters_*`) /
 *      参照店(`refSelection_*`) / 重叠阈值(`overlapThresholds_*`) /
 *      **AI 对话历史(`aiChatHistory_*`，隐私内容)** / 图标尺寸(`mapIconSize_*`) 等。
 *    实测：在 admin 标签页点「品牌门店」开关，写进了 `brandLayerFilter_999`
 *    （另一个账号的档），反过来该账号打开地图页会"继承"这个操作。
 *
 * 🔒 现改为**按标签页隔离**的取值链（⚠️ 顺序不可颠倒）：
 *    ① `sessionStorage.userId` —— 登录时写入、登出清除。标签页级，最可靠。
 *    ② 从 `sessionStorage.token`（JWT）解出 `id` —— 兜底旧会话（① 缺失时）。
 *    ③ 返回 `''` —— **⛔ 绝不回退到 admin(1)**。宁可退化成"匿名"，
 *       也不能把取不到 uid 的情况落到某个真实账号的命名空间上（那正是事故放大器）。
 *
 * ⚠️ 所有「按 uid 命名 storage key」的地方**必须**调本模块，⛔ 别各写一份
 *    `localStorage.getItem('userId') || 1` —— 那把未登录/取不到的情况退回了 admin 的档。
 */

/** 解析 JWT 的 payload（仅 base64url 解码，**不校验签名**——本地命名空间用途足够） */
function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.')
    if (parts.length !== 3) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(pad)
    // 逐字节转 Uint8Array 再按 UTF-8 解码，避免中文用户名等被 latin1 解坏
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder('utf-8').decode(bytes))
  } catch (e) {
    return null
  }
}

/**
 * 取当前标签页登录用户的 uid（字符串）。取不到返回 `''`。
 * @returns {string}
 */
export function getCurrentUserId() {
  // ① 标签页级缓存（登录写入 / 登出清除）—— 最可靠，且天然按标签页隔离
  try {
    const s = sessionStorage.getItem('userId')
    if (s) return String(s)
  } catch (e) {
    /* 隐私模式 / 沙箱下 sessionStorage 不可用 ⇒ 落到下一级 */
  }
  // ② 从 token 解析（sessionStorage 同样是标签页级）
  try {
    const t = sessionStorage.getItem('token')
    const p = t ? decodeJwtPayload(t) : null
    if (p && p.id !== undefined && p.id !== null && p.id !== '') return String(p.id)
  } catch (e) {
    /* 忽略 */
  }
  // ③ ⛔ 不回退 admin/localStorage —— 宁可匿名
  return ''
}

/**
 * 取 uid，取不到时用 fallback（默认 `'anon'`）。
 * 用字符串 `'anon'` 而非数字，**避免撞任何真实 uid**。
 * @param {string} [fallback]
 * @returns {string}
 */
export function currentUidOr(fallback = 'anon') {
  return getCurrentUserId() || fallback
}

/**
 * 取 uid 的数值形式（兼容既有 `Number(...)` 用法），取不到返回 0。
 * ⚠️ 仅在确实需要数字时使用（如 `brandIcons` 的来源优先级比较）。
 * @returns {number}
 */
export function getCurrentUserIdNumber() {
  const uid = getCurrentUserId()
  const n = Number(uid)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export default { getCurrentUserId, currentUidOr, getCurrentUserIdNumber }
