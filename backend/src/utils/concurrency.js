/**
 * concurrency.js — 有界并发执行工具
 *
 * 用于把「循环内 await 逐条串行」的批处理改为有界并发，避免两类问题：
 *   ① 串行太慢（如批量导出逐条起 python 子进程）
 *   ② 无界 Promise.all 打爆小内存机（生产 2 vCPU / 1.6G）
 *
 * 语义：
 *   - 按输入顺序返回结果数组（results[i] 对应 items[i]）
 *   - 同时最多 limit 个 worker 在跑（limit 会被夹到 [1, items.length]）
 *   - worker 抛错会中断整个批次并向上抛出（调用方自行 try/catch 决定是否容错）
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit 并发上限
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : []
  const n = list.length
  if (n === 0) return []

  const concurrency = Math.max(1, Math.min(Number(limit) || 1, n))
  const results = new Array(n)
  let cursor = 0

  async function runner() {
    while (true) {
      const i = cursor++
      if (i >= n) return
      results[i] = await worker(list[i], i)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runner()))
  return results
}

export default { mapWithConcurrency }
