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
