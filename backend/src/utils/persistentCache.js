/**
 * 文件持久化的 TTL 缓存（v1.13.107 S3）
 *
 * 背景：sales-forecast.js 的三个缓存（popGeoCache / popResultCache / poiCache）原本是纯内存 Map，
 * 后端进程一重启（部署/崩溃/pm2 reload）全部失效 → 首查要重新解析人口网格 GeoJSON、
 * 重跑 turf 相交计算、重新调用高德 POI（付费 + QPS 限频）。改为落盘持久化后重启即命中。
 *
 * 语义与内存 Map 保持一致：
 *   - 读取时按 `ts + ttl` 判定过期（过期即删除并返回 undefined）
 *   - 超出 maxSize 淘汰「最旧」（Map 的插入顺序即写入顺序）
 *   - 落盘为 debounce 异步写（默认 1.5s），避免高频小写入打满 I/O
 *   - 写入用 `tmp + rename` 原子替换，避免进程中途被杀留下半截 JSON
 *   - 进程退出（含 pm2 的 SIGINT/SIGTERM）时同步 flush 一次
 *
 * 存盘位置：backend/data/cache/<name>.json（`data/` 已在 .gitignore 中排除）
 * 单测可用 R4B_CACHE_DIR 覆盖目录，避免污染真实缓存。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = process.env.R4B_CACHE_DIR
  ? path.resolve(process.env.R4B_CACHE_DIR)
  : path.resolve(__dirname, '../../data/cache')

// 所有实例登记于此，进程退出时统一 flush
const instances = []
let exitHooked = false

function hookExit() {
  if (exitHooked) return
  exitHooked = true
  process.on('exit', () => {
    for (const c of instances) {
      try { c.flush() } catch (e) { /* 退出阶段尽力而为 */ }
    }
  })
}

export class PersistentCache {
  /**
   * @param {string} name    缓存名（同时作为文件名）
   * @param {object} opts
   * @param {number} opts.ttl      过期毫秒数（<=0 表示永不过期）
   * @param {number} [opts.maxSize=1000] 最大条目数
   * @param {number} [opts.saveDelay=1500] 落盘 debounce 毫秒
   */
  constructor(name, { ttl, maxSize = 1000, saveDelay = 1500 } = {}) {
    this.name = name
    this.ttl = ttl
    this.maxSize = maxSize
    this.saveDelay = saveDelay
    this.file = path.join(CACHE_DIR, `${name}.json`)
    this.map = new Map()
    this._timer = null
    instances.push(this)
    hookExit()
    this._load()
  }

  _load() {
    try {
      if (!fs.existsSync(this.file)) return
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      const now = Date.now()
      const fresh = []
      let dropped = 0
      for (const [k, entry] of Object.entries(raw.entries || {})) {
        if (!entry || typeof entry.ts !== 'number') { dropped++; continue }
        if (this.ttl > 0 && now - entry.ts >= this.ttl) { dropped++; continue }
        fresh.push([k, entry])
      }
      // 按写入时间升序恢复，保证 maxSize 淘汰「最旧」语义正确
      fresh.sort((a, b) => a[1].ts - b[1].ts)
      this.map = new Map(fresh)
      if (fresh.length || dropped) {
        console.log(`[cache:${this.name}] 载入 ${fresh.length} 项（丢弃过期 ${dropped} 项）`)
      }
    } catch (e) {
      console.warn(`[cache:${this.name}] 载入失败，按空缓存继续:`, e.message)
      this.map = new Map()
    }
  }

  _scheduleSave() {
    if (this._timer) return
    this._timer = setTimeout(() => {
      this._timer = null
      this.flush()
    }, this.saveDelay)
    if (this._timer.unref) this._timer.unref()
  }

  /** 立即同步落盘（原子替换） */
  flush() {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true })
      const entries = {}
      for (const [k, v] of this.map) entries[k] = v
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), entries }))
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.warn(`[cache:${this.name}] 落盘失败:`, e.message)
    }
  }

  /** 命中返回 entry（{ v, ts }），未命中/已过期返回 undefined */
  get(key) {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (this.ttl > 0 && Date.now() - entry.ts >= this.ttl) {
      this.map.delete(key)
      return undefined
    }
    return entry
  }

  set(key, value) {
    this.map.set(key, { v: value, ts: Date.now() })
    while (this.map.size > this.maxSize) {
      this.map.delete(this.map.keys().next().value)
    }
    this._scheduleSave()
  }

  clear() {
    this.map.clear()
    this._scheduleSave()
  }

  get size() {
    return this.map.size
  }
}

export default PersistentCache
