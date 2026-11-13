/**
 * 批次 360（v1.13.360）：给 GET/HEAD 的 JSON 响应补 `Cache-Control: private, no-cache`
 *
 * ── 为什么只补这一个头，不自己造 ETag ────────────────────────────────────
 * Express 4 的 `res.send()` **默认就会**生成弱 ETag 并在命中时回 304。实测线上：
 *   ① `curl -D - https://mka-online.cn/api/city-data` ⇒ `ETag: W/"42f3-…"`（已有）
 *   ② 带上该 `If-None-Match` 再请求 ⇒ `HTTP/1.1 304 Not Modified`（已经能用）
 * 真正缺的是 **Cache-Control**：没有它，浏览器只能按启发式决定存不存、要不要复验，
 * 于是每次刷新都把整包重新下回来（首屏 `/api/brand-stores` 单包 2.7MB / 3.5 万行）。
 * ⇒ 本中间件**只做一件事**：补 `private, no-cache`，让「缓存 + 每次复验」变成确定行为。
 * ⛔ 不要在这里再写一套 ETag 生成：会和 Express 内置的重复，两边算法一旦漂移
 *    就会出现「同一份 body 两个 ETag ⇒ 永远命中不了 304、退化成全量下载」。
 *
 * ── 为什么必须是 no-cache，不是 max-age ──────────────────────────────────
 * `no-cache` ≠ 不缓存。它的语义是「**可以存，但每次用之前必须回源复验**」。
 * 对本项目是硬要求，原因有三：
 *   ① 门店/竞品/配额随时会改，给 `max-age` 就会出现「刚导入的门店 5 分钟内看不见」的假 bug；
 *   ② handler 每次都真的执行（只是 body 未变时回 304）⇒ **配额闸门、可见域、
 *      审计写入这些副作用全都照旧**，不存在「被缓存跳过计费」的风险；
 *   ③ 缓存命中优先于配额检查（§6.49 铁律）—— 一旦让浏览器替服务器挡掉请求，
 *      某些「按次计费」的 GET 端点就有绕开闸门的口子。no-cache 不提供这个口子。
 * `private` 则限定只进浏览器私有缓存，⛔ 不进任何共享代理/CDN。
 *
 * ── 三条不碰的红线（守卫 httpCache.test.js 逐条钉死）────────────────────
 * ① 路由自己设过 `Cache-Control` 的，一律不覆盖：
 *      `auth.js` 登录响应 no-store（带 token，⛔ 绝不能进缓存）、
 *      `tile-proxy.js` 瓦片 public,max-age=86400（本来就该长缓存）、
 *      `ai.js` SSE no-cache。
 * ② 非 JSON 一律不碰（含 `text/event-stream`）——SSE 一旦被加上缓存指令，
 *    中间层可能缓冲分块，直接把流式输出搞坏。
 * ③ 非 200/304 一律不碰：错误响应（401/403/500）不该被缓存，
 *    否则「登录过期」的 401 会被存下来复验。
 *
 * ── 实现取巧处：为什么包 res.end 而不是包 res.json ──────────────────────
 * 本项目 40+ 路由文件里既有 `res.json()` 也有 `res.send()`，还有直接 `res.end()`
 * 的，逐个包要改几十处、漏一处就是静默失效。`res.end` 是**所有**响应（含压缩中间件
 * 处理后的）唯一出口，且此刻 `statusCode` 与 `Content-Type` 都已定稿。
 * 包完立刻还原 `res.end`，避免同一响应被重复处理。
 */

/** 只认 JSON 系（含 `application/problem+json` 这类 `+json` 后缀） */
const JSON_CONTENT_TYPE = /^application\/(?:[\w.+-]+\/+)?[\w.+-]*json\b/i

/**
 * 是否给这次响应补缓存指令（纯函数，便于单测直接喂参数）
 * @param {object} res Express 响应对象
 * @returns {boolean}
 */
export function shouldApplyCacheControl(res) {
  if (res.headersSent) return false
  // ① 路由已自行设定（no-store / max-age / no-cache）⇒ 尊重路由，绝不覆盖
  if (res.getHeader('Cache-Control')) return false

  const status = res.statusCode
  // ③ 只处理成功响应与条件请求的 304
  if (status !== 200 && status !== 304) return false

  const ct = res.getHeader('Content-Type')
  // 304 时 Express 会主动摘掉 Content-Type（见 express/lib/response.js 的 send()），
  // 这种「没有 Content-Type 的 304」仍然是我们产生的 JSON 响应的复验结果，照补。
  if (status === 304) return true
  if (!ct) return false
  // ② 非 JSON（图片瓦片、上传文件、SSE 的 text/event-stream、HTML）一律不碰
  return JSON_CONTENT_TYPE.test(String(ct))
}

export function httpCacheHeaders(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()

  const origEnd = res.end

  res.end = function patchedEnd(...args) {
    // 立刻还原：同一响应只处理一次（也避免 handler 内部再次 end 时重复进判断）
    res.end = origEnd
    try {
      if (shouldApplyCacheControl(res)) {
        res.setHeader('Cache-Control', 'private, no-cache')
      }
    } catch {
      // 补头失败绝不能影响响应本身 —— 缓存是优化，不是功能
    }
    return origEnd.apply(this, args)
  }

  next()
}

export default httpCacheHeaders
