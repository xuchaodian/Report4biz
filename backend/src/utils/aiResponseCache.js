// ============================================================================
// AI 同问短时缓存（v1.13.162 L3 降本）
// ----------------------------------------------------------------------------
// 目的：豆包侧**完全没有缓存/去重**（无 hash、无 memo、无幂等键）⇒ 同一问题问 N 次就计费 N 次。
//       本模块在**应用侧**补一层短时记忆：完全相同的请求直接复用上一次的结果，0 成本。
//
// 🔴 隐私红线：缓存 key **必须包含 userId**。
//    回答文本里可能含该账号自己的数据口径（门店数、城市分布等），
//    若不同账号共享同一条缓存 ⇒ 跨账号数据泄露。本项目明令禁止任何跨用户聚合，
//    因此 key = sha256(model + userId + messages + context + maxTokens)。
//
// ⚠️ 内存态（Map）依赖单进程：线上 `webgis-backend` 为 pm2 `fork_mode` 单实例。
//    若将来改 cluster，本缓存退化为多份独立副本（只是命中率下降，不会出错）；
//    若要跨实例共享，需换成表或 Redis。
//
// ⚠️ 陈旧度：TTL 内复用意味着**聚合类回答最多陈旧 TTL 时长**（默认 10 分钟）。
//    这是刻意的取舍（省 100% 成本 vs 容忍十分钟内的口径漂移），
//    可用 `AI_CACHE_TTL_MS=0` 一键关闭，或调小 TTL。
// ============================================================================
import crypto from 'crypto'
import { AI_CACHE_TTL_MS, AI_CACHE_MAX_ENTRIES } from './aiQuota.js'

/** key → { value, expireAt }；Map 的插入序即 LRU 序（命中时 delete+set 挪到末尾） */
const store = new Map()

let hits = 0
let misses = 0

/** 只在「有内容可比」的字段上取摘要，避免把整段对话塞进 key */
export function cacheKey({ model, userId, messages, context, maxTokens }) {
  const payload = JSON.stringify({
    m: model,
    u: userId,
    q: messages,
    c: context ?? null,
    t: maxTokens
  })
  return crypto.createHash('sha256').update(payload).digest('hex')
}

/**
 * 命中则返回值副本（附加 cached:true 便于观测），否则返回 null。
 * 过期条目顺带删除。
 */
export function getCached(key, now = Date.now()) {
  if (!key) return null
  const hit = store.get(key)
  if (!hit) { misses++; return null }
  if (hit.expireAt <= now) {
    store.delete(key)
    misses++
    return null
  }
  // LRU：挪到末尾
  store.delete(key)
  store.set(key, hit)
  hits++
  return Object.assign({}, hit.value, { cached: true })
}

/** 写入缓存；TTL<=0 时直接忽略（等于关闭） */
export function setCached(key, value, now = Date.now(), ttlMs = AI_CACHE_TTL_MS) {
  if (!key || !(ttlMs > 0)) return false
  store.delete(key)
  store.set(key, { value, expireAt: now + ttlMs })
  // LRU 淘汰：超上限时从最旧的开始丢
  while (store.size > AI_CACHE_MAX_ENTRIES) {
    const oldest = store.keys().next()
    if (oldest.done) break
    store.delete(oldest.value)
  }
  return true
}

/** 仅用于测试与运维观测 */
export function clearAiCache() {
  store.clear()
  hits = 0
  misses = 0
}

export function cacheStats() {
  return { size: store.size, hits, misses, ttlMs: AI_CACHE_TTL_MS, maxEntries: AI_CACHE_MAX_ENTRIES }
}
