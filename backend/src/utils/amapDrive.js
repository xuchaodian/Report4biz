/**
 * 驾车耗时探测（v1.13.302）
 *
 * 为什么不是「等时圈接口」：
 *   高德 Web 服务**没有**驾车等时圈/到达圈接口 —— `AMap.ArrivalRange` 是**公交**到达圈
 *   （地铁/公交，≤60 分钟），拿它算「开车 10 分钟」是错的。自驾可达范围只能自己探。
 *
 * 实测出来的调用约定（2026-10-31 生产机实测，别凭文档猜）：
 *   · `v3/distance?type=1` = 驾车，返回 distance(米) + duration(秒)，**按常规路况估算**（不含实时拥堵）
 *   · `destination` 只能 1 个；`origins` 可以用 `|` 拼多个
 *   · 🔴 `origins` **上限 100 个**：传 150 个不报错，`count` 直接回 100 —— 静默截断。
 *     所以必须自己分片，且**逐片校验返回条数与顺序**：一旦错位，
 *     A 点的时间会被算到 B 点头上，图上看着正常、数字全错。
 *
 * ⚠️ 本模块只负责「问时间」，不碰数据库、不碰几何；可达范围的多边形在 routes/shapefiles.js 里拼。
 */
import { AMAP_KEY } from '../config.js'

/** 单次调用允许的起点数（实测上限，⛔ 不要调大） */
export const MAX_ORIGINS_PER_CALL = 100

/** 驾车 */
export const DRIVE_TYPE = 1

/**
 * 两次调用的最小间隔（毫秒）
 * 🔴 生产实测（2026-10-31）：这个 key 的 QPS 很低，连续两次分片调用就吃
 *    `CUQPS_HAS_EXCEEDED_THE_LIMIT`(10021)。所以必须自己节流，不能靠"串行就没事"。
 */
export const MIN_CALL_GAP_MS = 400

/** 遇到 QPS 超限时的退避重试次数 */
const QPS_RETRY = 2

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class DriveProbeError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'DriveProbeError'
    this.code = code
    this.detail = detail
  }
}

const AMAP_DISTANCE_URL = 'https://restapi.amap.com/v3/distance'

/**
 * 批量探测「若干起点 → 一个终点」的驾车耗时
 *
 * @param {object} input
 * @param {{lng:number, lat:number}} input.origin 终点（我们的分析中心）
 * @param {Array<{lng:number, lat:number}>} input.points 起点（探测点），顺序与返回一一对应
 * @param {number} [input.type=1] 1=驾车 / 0=直线 / 3=步行
 * @param {number} [input.timeoutMs=8000] 单片超时
 * @returns {Promise<{durations:Array<number|null>, distances:Array<number|null>, calls:number, failed:number}>}
 */
export async function probeDriveDuration({ origin, points, type = DRIVE_TYPE, timeoutMs = 8000 }) {
  if (!AMAP_KEY) throw new DriveProbeError('NO_KEY', '服务端未配置高德 Key')
  if (!origin || !Number.isFinite(origin.lng) || !Number.isFinite(origin.lat)) {
    throw new DriveProbeError('BAD_ORIGIN', '终点坐标无效')
  }
  const list = Array.isArray(points) ? points : []
  if (!list.length) return { durations: [], distances: [], calls: 0, failed: 0 }

  const durations = new Array(list.length).fill(null)
  const distances = new Array(list.length).fill(null)
  let calls = 0
  let failed = 0
  let lastCallAt = 0

  for (let start = 0; start < list.length; start += MAX_ORIGINS_PER_CALL) {
    const chunk = list.slice(start, start + MAX_ORIGINS_PER_CALL)
    const origins = chunk
      .map(p => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`)
      .join('|')
    const url = `${AMAP_DISTANCE_URL}?type=${type}&origins=${origins}`
      + `&destination=${Number(origin.lng).toFixed(6)},${Number(origin.lat).toFixed(6)}&key=${AMAP_KEY}`

    let payload
    let attempt = 0
    for (;;) {
      // 节流：保证两次上游调用之间有最小间隔（实测 QPS 很紧）
      const wait = MIN_CALL_GAP_MS - (Date.now() - lastCallAt)
      if (wait > 0) await sleep(wait)
      lastCallAt = Date.now()

      // 每次尝试都用自己的超时器：重试时不能沿用上一次的计时
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const resp = await fetch(url, { signal: controller.signal })
        payload = await resp.json()
      } catch (e) {
        clearTimeout(timer)
        throw new DriveProbeError('UPSTREAM', '高德距离测量请求失败', String(e?.message || e))
      }
      clearTimeout(timer)

      // QPS 超限 ⇒ 退避后重试（不改参数、不多计费，只是等一等）
      if (payload?.infocode === '10021' && attempt < QPS_RETRY) {
        attempt += 1
        await sleep(600 * attempt)
        continue
      }
      break
    }
    calls += 1

    if (payload?.status !== '1') {
      // 配额 / Key 权限 / 参数问题都要让上层看得见原因，⛔ 不要吞成「0 秒」
      throw new DriveProbeError(
        payload?.infocode === '10003' ? 'OVER_QUOTA' : 'UPSTREAM',
        `高德距离测量返回错误：${payload?.info || '未知'}（${payload?.infocode || '-'}）`,
        payload
      )
    }

    const results = Array.isArray(payload.results) ? payload.results : []
    // 🔴 条数必须等于本片起点数：少一条就说明被截断/错位，宁可整片判失败也不许错配
    if (results.length !== chunk.length) {
      failed += chunk.length
      continue
    }
    // 按 origin_id 归位（服务端返回顺序理论上与请求一致，但不赌）
    for (const r of results) {
      const idx = Number(r.origin_id) - 1
      if (!Number.isInteger(idx) || idx < 0 || idx >= chunk.length) continue
      // 🔴 高德对不可达/失败的点可能回空串：`Number('')` 是 0，
      //   而 0 秒会被当成「立刻可达」⇒ 混进所有时间档。必须显式排除空值与非正数。
      const durRaw = r.duration
      const distRaw = r.distance
      const dur = (durRaw === '' || durRaw == null) ? NaN : Number(durRaw)
      const dist = (distRaw === '' || distRaw == null) ? NaN : Number(distRaw)
      if (Number.isFinite(dur) && dur > 0) durations[start + idx] = dur
      if (Number.isFinite(dist) && dist >= 0) distances[start + idx] = dist
    }
  }

  return { durations, distances, calls, failed }
}
