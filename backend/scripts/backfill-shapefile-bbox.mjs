#!/usr/bin/env node
/**
 * 补算 shapefiles 的 minx/miny/maxx/maxy（v1.13.308）
 *
 * 为什么要它：
 *   calculate-population 不传 shapefileId 时要取该 category 下**全部**文件，
 *   26 个人口文件共 313MB / 32.8 万要素，逐个 JSON.parse ⇒ 单档 4 秒。
 *   有了 bbox 就能在 SQL 里先筛掉不相交的城市（通常只剩 1~2 个文件）。
 *
 * 🔴 为什么只输出 SQL、不直接改库：
 *   本项目的库是 sql.js（整份库在进程内存里，定时回写）。
 *   用 CLI / 独立脚本直接写 webgis.db，会被 backend 进程的内存副本覆盖回去
 *   （307 批实测：CLI 删完 count=0，几秒后接口又读到旧值）。
 *   所以流程必须是：跑本脚本产出 SQL → pm2 stop → sqlite3 执行 → pm2 start。
 *
 * 用法：
 *   node scripts/backfill-shapefile-bbox.mjs > /tmp/bbox.sql
 *   pm2 stop webgis-backend
 *   sqlite3 database/webgis.db < /tmp/bbox.sql
 *   pm2 start webgis-backend
 *
 * 参数（可选，按序）：
 *   --db  <path>   默认 backend/database/webgis.db
 *   --geo <dir>    默认 backend/uploads/shapefiles/geo
 *   --cat <name>   默认 population（逗号分隔可多个）
 */
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BACKEND = path.resolve(HERE, '..')

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const DB = arg('db', path.join(BACKEND, 'database', 'webgis.db'))
const GEO = arg('geo', path.join(BACKEND, 'uploads', 'shapefiles', 'geo'))
const CATS = arg('cat', 'population').split(',').map(s => s.trim()).filter(Boolean)

/** 递归取坐标对的 bbox（只认前两位，忽略高程） */
function grow(bbox, coords) {
  if (!Array.isArray(coords) || coords.length === 0) return
  if (typeof coords[0] === 'number') {
    const x = coords[0]
    const y = coords[1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (bbox[0] === null || x < bbox[0]) bbox[0] = x
    if (bbox[1] === null || y < bbox[1]) bbox[1] = y
    if (bbox[2] === null || x > bbox[2]) bbox[2] = x
    if (bbox[3] === null || y > bbox[3]) bbox[3] = y
    return
  }
  for (const c of coords) grow(bbox, c)
}

// sqlite3 CLI 不支持参数绑定（`?` 会被当成字面量直接语法错），
// 这里只接类别名（内部常量），仍然做一次转义以防手滑传进引号。
const catList = CATS.map(c => `'${c.replace(/'/g, "''")}'`).join(',')
const listing = execFileSync(
  'sqlite3',
  ['-readonly', '-separator', '|', DB,
    `SELECT id, name, category, IFNULL(minx,'') FROM shapefiles WHERE category IN (${catList}) ORDER BY id`],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
).trim()

if (!listing) {
  console.error('没有找到需要补算的文件')
  process.exit(0)
}

const rows = listing.split('\n').map(l => {
  const [id, name, category, has] = l.split('|')
  return { id: Number(id), name, category, filled: has !== '' }
})

console.log(`-- backfill shapefile bbox  ${new Date().toISOString()}`)
console.log(`-- 待处理 ${rows.length} 个文件（已有 bbox 的会重算，保持幂等）`)
console.log('BEGIN;')

let done = 0
let skipped = 0
for (const r of rows) {
  const file = path.join(GEO, `${r.id}.geojson`)
  if (!fs.existsSync(file)) {
    console.error(`-- ⚠️ 跳过 id=${r.id} ${r.name}：文件不存在 ${file}`)
    skipped++
    continue
  }
  const bytes = fs.statSync(file).size
  const t0 = Date.now()
  let bbox = [null, null, null, null]
  try {
    // 逐个文件串行解析：单文件最大 32MB（重庆），V8 解析后约 100~150MB。
    // ⛔ 不要并发 —— 1.6GB 机器上两个大文件同时 parse 就会触发 swap。
    const geo = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const f of geo.features || []) {
      if (f && f.geometry) grow(bbox, f.geometry.coordinates)
    }
  } catch (e) {
    console.error(`-- ⚠️ 跳过 id=${r.id} ${r.name}：解析失败 ${e.message}`)
    skipped++
    continue
  }
  if (bbox[0] === null) {
    console.error(`-- ⚠️ 跳过 id=${r.id} ${r.name}：没有任何有效坐标`)
    skipped++
    continue
  }
  const ms = Date.now() - t0
  console.error(
    `-- id=${r.id} ${r.name} ${(bytes / 1048576).toFixed(1)}MB ` +
    `[${bbox.map(v => v.toFixed(4)).join(',')}] ${ms}ms`
  )
  console.log(
    `UPDATE shapefiles SET minx=${bbox[0]}, miny=${bbox[1]}, maxx=${bbox[2]}, maxy=${bbox[3]} WHERE id=${r.id};`
  )
  done++
}

console.log('COMMIT;')
console.error(`-- 完成：写入 ${done} 个，跳过 ${skipped} 个`)
