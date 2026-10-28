/**
 * 进程内滑动窗口限流器（v1.13.149）
 *
 * 由来：原先只在 auth.js 的「忘记密码」里内联了一个 overLimit()，
 * 注册接口无任何限流。本次提升为公共设施，「注册」与「忘记密码」共用同一套桶。
 *
 * 语义：按 key 维度的**滑动窗口**（非固定窗口），max = 窗口内允许次数。
 *   - 未超限 ⇒ 记录本次并返回 false
 *   - 已超限 ⇒ **不再记录**（避免数组无界增长）并返回 true
 *
 * ⚠️ 部署前提：pm2 **单实例**（fork 模式）。多实例（cluster）下计数不共享，
 *    实际额度会被放大 N 倍。若将来改 cluster，需换成库表计数。
 */
const MAX_WINDOW_MS = 60 * 60 * 1000 // 清理周期取「最大窗口」，容忍调用方使用更短窗口
const hits = new Map()

export function overLimit(key, max, windowMs = MAX_WINDOW_MS) {
  const now = Date.now()
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs)
  if (arr.length >= max) {
    hits.set(key, arr)
    return true
  }
  arr.push(now)
  hits.set(key, arr)
  return false
}

/**
 * **只读**判断是否已超限（不记录本次）。
 *
 * 用途（v1.13.182 · 登录限流）：需要「先于昂贵操作（bcrypt）拦截」、
 * 但又**不能把成功请求也算进配额**时使用 —— 调用方自己决定何时 `overLimit()` 记账。
 * 典型写法：
 *   if (peekLimit(k, max, win)) return 429          // 拦截在前，省掉 bcrypt
 *   ...若业务失败... overLimit(k, max, win)          // 只有失败才记账
 *
 * ⚠️ 与 `overLimit` 的语义差异：本函数**不写入**，连续调用不改变计数。
 */
export function peekLimit(key, max, windowMs = MAX_WINDOW_MS) {
  const now = Date.now()
  const arr = hits.get(key) || []
  return arr.filter((t) => now - t < windowMs).length >= max
}

// 定期清理过期限流记录，避免 Map 无限增长（unref 不阻塞进程退出）
const cleaner = setInterval(() => {
  const now = Date.now()
  for (const [k, arr] of hits) {
    const keep = arr.filter((t) => now - t < MAX_WINDOW_MS)
    if (keep.length) hits.set(k, keep)
    else hits.delete(k)
  }
}, 10 * 60 * 1000)
if (cleaner.unref) cleaner.unref()

/**
 * 清空全部计数。测试用；运维侧「误封后手动解封」亦可调用（重启进程等效）。
 */
export function resetRateLimits() {
  hits.clear()
}

/** 当前桶数量（探针用，便于确认清理器工作正常） */
export function rateLimitBuckets() {
  return hits.size
}

// ============================================================================
// Express 中间件封装（v1.13.281）
//
// 由来：`/api/geocode/*` 与 `/api/poi/*` 原先**既无鉴权也无任何速度上限**，
//   直接裸调服务端 `AMAP_KEY` ⇒ 谁都能白嫖，且能把高德配额刷爆（`batch-geocode`
//   一次可解析上百条地址，`business-count`/`environment-score` 每次都真实烧 POI 配额）。
//
// ⚠️ 这是**限速**，不是鉴权。未登录时只能按 IP 计，换 IP 即可绕过 ——
//    ⛔ 不要拿它替代 `authenticate`。
// ⚠️ 复用上面的 `overLimit` 桶（滑动窗口 + 定时清理），⛔ 不要另建一套计数器。
// ============================================================================

/** 取客户端 IP（已在 nginx 反代之后，优先 X-Forwarded-For 第一跳） */
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) {
    const first = String(xff).split(',')[0]
    if (first && first.trim()) return first.trim()
  }
  const real = req.headers['x-real-ip']
  if (real) return String(real).trim()
  const raw = req.connection?.remoteAddress || req.socket?.remoteAddress || ''
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw
}

/**
 * 生成限流中间件。
 * @param {object} opts
 * @param {number} opts.max        窗口内允许次数（必填，刻意不给默认值 —— 让调用处必须想清楚）
 * @param {number} [opts.windowMs] 窗口长度，默认 1 分钟
 * @param {string} [opts.name]     桶名前缀，便于排障区分是哪条链路在限流
 * @param {(req)=>string} [opts.keyGen] 自定义 key（默认：登录按 userId，未登录按 IP）
 */
export function rateLimit({ max, windowMs = 60 * 1000, name = 'rl', keyGen } = {}) {
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error('rateLimit 必须先给一个正数 max')
  }
  return function rateLimitMw(req, res, next) {
    const who = keyGen ? keyGen(req) : (req.user?.id ? 'u' + req.user.id : 'ip:' + clientIp(req))
    const key = name + '|' + who
    if (overLimit(key, max, windowMs)) {
      const retryAfter = Math.max(1, Math.ceil(windowMs / 1000))
      console.warn(`[rate-limit:${name}] 命中限流 ${who}（上限 ${max}/${Math.round(windowMs / 1000)}s）`)
      res.set('Retry-After', String(retryAfter))
      return res.status(429).json({ message: `请求过于频繁，请稍后再试（${max} 次 / ${Math.round(windowMs / 1000)} 秒）` })
    }
    next()
  }
}

