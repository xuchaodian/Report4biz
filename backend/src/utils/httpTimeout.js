/**
 * httpTimeout.js — 第三方 HTTP 调用统一超时封装（L6）
 *
 * 背景：后端大量 `await fetch(url, ...)` 未设超时，上游（联通智慧足迹 / 高德 /
 * 火山方舟）挂起时请求会永久 pending，占住 node 连接与内存，极端情况拖垮进程。
 *
 * 提供两个语义不同的包装：
 *   - fetchWithTimeout      ：总超时（含响应体读取）——用于一次性 JSON 接口
 *   - fetchStreamWithTimeout：仅「连接 + 首字节」超时，拿到响应头后即解除计时，
 *                             不打断 SSE 流式响应体——用于流式接口
 *
 * 调用方若自行传入 options.signal，则原样透传、不覆盖（尊重调用方控制）。
 */

export const DEFAULT_HTTP_TIMEOUT_MS = 15000
/** 上游付费/慢接口（联通 getData）建议值 */
export const SLOW_HTTP_TIMEOUT_MS = 60000
/** 流式接口「首字节」超时建议值 */
export const STREAM_HEAD_TIMEOUT_MS = 30000

/** 总超时：整个请求（含 body）必须在 timeoutMs 内完成 */
export function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS) {
  if (options && options.signal) return fetch(url, options)
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
}

/**
 * 流式超时：只对「连接 + 响应头」计时；`await fetch` 返回后立即解除，
 * 因此不会中断后续 SSE 数据块的读取。
 */
export async function fetchStreamWithTimeout(url, options = {}, timeoutMs = STREAM_HEAD_TIMEOUT_MS) {
  if (options && options.signal) return fetch(url, options)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`请求超时(${timeoutMs}ms)`)), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

export default { fetchWithTimeout, fetchStreamWithTimeout, DEFAULT_HTTP_TIMEOUT_MS, SLOW_HTTP_TIMEOUT_MS, STREAM_HEAD_TIMEOUT_MS }
