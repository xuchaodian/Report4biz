/**
 * 裸 `fetch` 用的鉴权头（v1.13.290）
 *
 * 由来：全局 axios 实例（`utils/api.js`）有请求拦截器自动注入 token，
 *   但 MapView / aiExecutor 里那几处 POI 代理调用是**直接 fetch**，不带 token。
 *   v1.13.281 给 `/api/geocode/*` 挂 authenticate 时，就是因为漏了这几处裸 fetch
 *   才会「一挂就 401」；当时只能退让成「poi 整组不鉴权、只给两个烧钱端点单独挂」。
 *
 * v1.13.290 起 `/api/poi/*` 整组必须登录 ⇒ 这些 fetch 必须自带 Authorization。
 *   ⛔ 不要再逐个手写 `Authorization: 'Bearer ' + ...`：散落 6 处必然漏改。
 *
 * ⚠️ token 取 `sessionStorage.token`（与 api.js / stores/user.js 保持一致），
 *    ⛔ 不是 `localStorage.token`。
 */
export function authHeaders(extra = {}) {
  const token = sessionStorage.getItem('token')
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra }
}
