/**
 * 外置 GeoJSON 存储（v1.13.143）
 *
 * ── 为什么要把 geojson 搬出主库 ────────────────────────────────────────
 * `shapefiles` 表 42 行里，geojson 原文合计 133MB（26 条人口网格 130MB + 16 条
 * 商圈面 2.9MB），占主库 166MB 的 ~89%，且是**写完就不再变的静态数据**。
 *
 * 而 sql.js 的落盘是「整库导出」：`saveDatabase()` 会把整个 DB 序列化成
 * Uint8Array 再写盘。于是「改一个用户」这种与 geojson 毫无关系的操作，也要
 * 搬运 166MB ⇒ 反复 GB 级高阶内存分配 ⇒ 2C/1.6GB 机器上触发内核
 * proactive compaction、`kcompactd0` 卡死整机（详见 v1.13.142 事故）。
 *
 * 把 geojson 落成文件、主库该列一律留空串占位后，主库降到 ~20MB，
 * 单次落盘搬运量降 ~88%，且与业务语义完全无关（读写路径封装在本模块）。
 *
 * ── 存储契约（改动前请先读）──────────────────────────────────────────
 * ① 文件路径：`<backend>/uploads/shapefiles/geo/<id>.geojson`（UTF-8 明文）
 * ② **文件是唯一真源**；`shapefiles.geojson` 迁移后恒为 `''`
 *    （该列是 `TEXT NOT NULL`，故不能置 NULL，用空串占位）
 * ③ 写入一律「临时文件 → fsync → rename」，与 `saveDatabase()` 同款原子写
 * ④ 新增/删除 shapefile 时必须同步 `writeGeoText` / `removeGeoFile`
 * ⑤ 文件缺失 ⇒ 记 error 日志（属数据损坏），并降级为空 FeatureCollection，
 *    避免调用方 `JSON.parse(undefined)` 抛 500
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 与 routes/shapefiles.js 里 multer 的 destination 同一父目录
const GEO_DIR = process.env.R4B_GEO_DIR || path.join(__dirname, '../../uploads/shapefiles/geo')

// ── 缓存预算 ──────────────────────────────────────────────────────────
// 服务器只有 1.6GB 内存，最大的单文件（重庆1km网格人口）原文 30MB、
// JSON.parse 后 V8 对象约 3~4 倍。所以：
//   · 文本缓存按**真实字节数**做 LRU（读磁盘只发生一次）
//   · 解析对象**只缓存小文件**（原文 ≤4MB，16 个商圈面全在内），
//     人口网格每次现解析 —— 用一点 CPU 换掉 OOM/compaction 风险
const TEXT_CACHE_MAX_BYTES = 64 * 1024 * 1024
const TEXT_CACHE_MAX_ENTRIES = 24
const OBJ_CACHE_MAX_TEXT_BYTES = 4 * 1024 * 1024
const OBJ_CACHE_MAX_ENTRIES = 16

const EMPTY_FEATURE_COLLECTION = '{"type":"FeatureCollection","features":[]}'

const textCache = new Map() // id -> { text, bytes, hits }
const objCache = new Map()  // id -> { obj }
const missingWarned = new Set()
let textCacheBytes = 0

function ensureDir() {
  if (!fs.existsSync(GEO_DIR)) fs.mkdirSync(GEO_DIR, { recursive: true })
}

export function geoDir() {
  return GEO_DIR
}

export function geoFilePath(id) {
  return path.join(GEO_DIR, `${id}.geojson`)
}

export function hasGeoFile(id) {
  try {
    return fs.statSync(geoFilePath(id)).isFile()
  } catch (e) {
    return false
  }
}

// LRU：命中时把 key 挪到 Map 末尾（Map 保持插入序），淘汰时从头部取
function touchText(key) {
  const hit = textCache.get(key)
  textCache.delete(key)
  textCache.set(key, hit)
  return hit
}

function putTextCache(key, text) {
  const bytes = Buffer.byteLength(text, 'utf8')
  const prev = textCache.get(key)
  if (prev) {
    textCacheBytes -= prev.bytes
    textCache.delete(key)
  }
  textCache.set(key, { text, bytes })
  textCacheBytes += bytes
  while (
    (textCacheBytes > TEXT_CACHE_MAX_BYTES || textCache.size > TEXT_CACHE_MAX_ENTRIES) &&
    textCache.size > 1 // 至少留一条，避免单个超大文件把缓存彻底清空
  ) {
    const oldestKey = textCache.keys().next().value
    textCacheBytes -= textCache.get(oldestKey).bytes
    textCache.delete(oldestKey)
  }
}

/**
 * 读 geojson 原文（UTF-8）。文件不存在返回 null（并去重记一次 error）。
 */
export function readGeoText(id) {
  const key = String(id)
  const hit = textCache.get(key)
  if (hit) return touchText(key).text

  let text
  try {
    text = fs.readFileSync(geoFilePath(key), 'utf8')
  } catch (e) {
    if (!missingWarned.has(key)) {
      missingWarned.add(key)
      console.error(
        `[geoStore] geojson 文件缺失 id=${key} path=${geoFilePath(key)}` +
        `（主库该列已外置，文件即唯一真源；本次降级为空 FeatureCollection）` +
        (e.code === 'ENOENT' ? '' : ` err=${e.message}`)
      )
    }
    return null
  }
  putTextCache(key, text)
  return text
}

/**
 * 原子写 geojson 文件。返回写入字节数。
 */
export function writeGeoText(id, text) {
  const key = String(id)
  ensureDir()
  const target = geoFilePath(key)
  const tmp = `${target}.tmp`
  const buf = Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf8')

  const fd = fs.openSync(tmp, 'w')
  try {
    let written = 0
    while (written < buf.length) {
      written += fs.writeSync(fd, buf, written, buf.length - written)
    }
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, target)

  clearGeoCache(key)
  const str = buf.toString('utf8')
  putTextCache(key, str)
  return buf.length
}

/**
 * 删除 geojson 文件。返回是否真的删掉了。
 */
export function removeGeoFile(id) {
  const key = String(id)
  clearGeoCache(key)
  try {
    fs.unlinkSync(geoFilePath(key))
    return true
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`[geoStore] 删除 geojson 文件失败 id=${key}:`, e.message)
    }
    return false
  }
}

export function clearGeoCache(id) {
  const key = String(id)
  const prev = textCache.get(key)
  if (prev) {
    textCacheBytes -= prev.bytes
    textCache.delete(key)
  }
  objCache.delete(key)
  missingWarned.delete(key)
}

/**
 * 取解析后的 GeoJSON 对象（带缓存）。取不到返回 null。
 * `fallbackText` 可选：调用方若顺手查到了主库残留列，可作兜底。
 */
export function getGeoObject(id, fallbackText) {
  const key = String(id)
  const hit = objCache.get(key)
  if (hit) return hit.obj

  let text = readGeoText(key)
  let bytes = 0
  if (text === null) {
    if (!fallbackText) return null
    text = fallbackText
  }
  bytes = Buffer.byteLength(text, 'utf8')

  let obj
  try {
    obj = JSON.parse(text)
  } catch (e) {
    console.error(`[geoStore] geojson 解析失败 id=${key}:`, e.message)
    return null
  }

  // 只缓存小文件（原文 ≤4MB），大的人口网格每次现解析
  if (bytes <= OBJ_CACHE_MAX_TEXT_BYTES) {
    objCache.set(key, { obj })
    while (objCache.size > OBJ_CACHE_MAX_ENTRIES) {
      objCache.delete(objCache.keys().next().value)
    }
  }
  return obj
}

/**
 * 单行回填 `row.geojson`（字符串）。row 需含 `id`。
 * 原库里 `row.geojson` 是 SELECT 出来的列，本函数保持同样的字段名与语义，
 * 使调用点改动最小。若该行确实没有文件也没残留列 ⇒ 空 FeatureCollection。
 */
export function attachGeo(row) {
  if (!row) return row
  const text = readGeoText(row.id)
  if (text !== null) {
    row.geojson = text
  } else if (row.geojson) {
    // 文件缺失但有主库残留列：用它（迁移中途/手工误删的兜底）
  } else {
    row.geojson = EMPTY_FEATURE_COLLECTION
  }
  return row
}

export function attachGeoAll(rows) {
  if (Array.isArray(rows)) {
    for (const row of rows) attachGeo(row)
  }
  return rows
}

/**
 * 供诊断用：主库有行但文件缺失的 shapefile id 列表（正常应为空）。
 */
export function missingGeoFiles(ids) {
  const missing = []
  for (const id of ids || []) {
    if (!hasGeoFile(id)) missing.push(id)
  }
  return missing
}

export function geoCacheStats() {
  return {
    dir: GEO_DIR,
    textEntries: textCache.size,
    textBytes: textCacheBytes,
    objEntries: objCache.size,
    missingWarned: [...missingWarned]
  }
}
