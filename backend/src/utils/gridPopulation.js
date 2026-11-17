/**
 * 本地 1km 人口网格：索引 / 圆内面积加权 / 相对分位打分（v1.13.370 / 批次 370）
 *
 * ── 这个文件解决什么 ───────────────────────────────────────────────────
 * 智能选址的「初筛客群分」要用**免费**的本地网格人口，把免费粗排从三维（55 分尺子）
 * 提到四维（85 分尺子），否则人口密集但商圈未收录的新区会被整片埋掉、进不了精算名额。
 *
 * ── 🔴🔴 字段铁律（本项目已在这条上错过三次）──────────────────────────
 * 站内有**三套**人口数据，字段完全不同，不可互换：
 *   · `shapefiles.category='population'`（26 城 1km 网格）
 *       → 只有 `常住人口 / 本地人口 / 年龄段`，**没有工作人数、没有任何收入分档**
 *   · `shapefiles.category='population_hd'`（仅上海 ~240m）
 *       → 有 `居住人数 / 工作人数 / 到访人次 / 六档收入`（P0 ⛔ 不用，口径不可比）
 *   · 商圈面 props（`other` 经 normalizeDistrictProps）
 *       → `居住人数 / 工作人数 / 富人人数…`（只属于面，不属于网格）
 * ⇒ 本文件**只读 `props['常住人口']`**。读 `居住人数` 会恒 0，且**不报错、界面看不出来**。
 *
 * ── 为什么必须「相对分位」而不是绝对阈值（实测数据）──────────────────
 *   上海单格常住人口中位 4,095 / P90 19,602；重庆中位 196 / P90 704；宜宾 275。
 *   上海中位是重庆的 21 倍 ⇒ 一套绝对阈值必然让上海全部高分、重庆全部最低分，区分度归零。
 *
 * ── 与老接口的关系 ─────────────────────────────────────────────────────
 * `routes/shapefiles.js` 的 `/calculate-potential` 里那段面积加权
 * （`turf.polygon(geom.coordinates)` 一把梭）**不区分 MultiPolygon**，
 * 多部件网格会抛错、被 catch 吞掉、整格静默剔除。本文件按 `geom.type` 原样传 feature，
 * turf.intersect / turf.area 本身就支持 MultiPolygon ⇒ 天然正确。
 * P0 不改老接口（它有既有行为，改了要连带回归）；新代码一律走本文件。
 */

import * as turf from '@turf/turf'
import { getDb } from '../models/database.js'
import { attachGeo } from '../models/geoStore.js'
import {
  GRID_PERCENTILE_STEPS, GRID_PERCENTILE_FLOOR, GRID_CELL_M, M_PER_DEG_LAT
} from './siteSelectConfig.js'

/** 网格人口字段名（唯一约定名；各城 field_names 顺序不同，但键名一致） */
export const GRID_POP_FIELD = '常住人口'

/** 分位桶的空间索引精度（度）：0.01° ≈ 1.1km（纬向），与 1km 格边长同量级 */
const BUCKET_DEG = 0.01

/**
 * 从 shapefiles 行解析城市名（逐字搬迁自 routes/shapefiles.js:347，改为导出以便共用）。
 * 顺序：city 列 → name 里的「XX1km网格人口」→ name 去扩展名。
 */
export function resolveGridCity(row) {
  const c = String(row?.city || '').trim()
  if (c) return c
  const m = String(row?.name || '').match(/^(.+?)1?km网格人口/)
  if (m) return m[1].trim()
  return String(row?.name || '').replace(/\.zip$/i, '').trim()
}

/**
 * 按城市名找该城市的人口网格行。
 * ⚠️ 可见域口径与 shapefiles 路由一致（admin 看全量，其他账号看自己 + admin 上传的），
 *    否则同城不同账号会拿到不同的网格、分数不可比。
 * @returns {null | {id:number, name:string, city:string, fieldNames:string[]}}
 */
export function findGridRow(db, user, city) {
  const want = String(city || '').trim()
  if (!want) return null
  const isAdmin = user?.role === 'admin'
  const sql = isAdmin
    ? `SELECT id, name, city, field_names FROM shapefiles WHERE category = 'population' ORDER BY id DESC`
    : `SELECT id, name, city, field_names FROM shapefiles WHERE category = 'population'
         AND (user_id = ? OR user_id IN (SELECT id FROM users WHERE role = 'admin')) ORDER BY id DESC`
  const rows = isAdmin ? db.prepare(sql).all() : db.prepare(sql).all(user?.id)
  for (const r of rows) {
    if (resolveGridCity(r) === want) return r
  }
  return null
}

/** 取 feature 的解析后属性（field_names 可能是 JSON 字符串） */
export function parseFieldNames(raw) {
  if (Array.isArray(raw)) return raw
  try {
    const v = JSON.parse(raw || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** 平面近似距离（米）—— 1km 尺度足够；只用于整格/外离的粗判，边界格仍走 turf */
function planarMeters(lng1, lat1, lng2, lat2) {
  const dx = (lng2 - lng1) * M_PER_DEG_LAT * Math.cos((lat1 * Math.PI) / 180)
  const dy = (lat2 - lat1) * M_PER_DEG_LAT
  return Math.hypot(dx, dy)
}

function bucketKey(lng, lat) {
  return `${Math.floor(lng / BUCKET_DEG)}:${Math.floor(lat / BUCKET_DEG)}`
}

/**
 * 构造网格索引。
 *
 * 🔴 铁律：**分位计算前必须过滤 `常住人口 = 0` 的格**（立项稿 §5.3.1 铁律 6）。
 *    重庆 75,825 格里只有 59,862 格 > 0，其余是山区/水域；不过滤会把中位数拉低、分位失真。
 *    过滤 0 值不影响「圆内人口求和」（0 的贡献就是 0），只影响分位与中位数。
 *
 * @param {Array} features GeoJSON features（来自 population 网格文件）
 * @returns {{covered:boolean, hasField:boolean, cells:Array, bucket:Map, skipped:number}}
 */
export function buildGridIndex(features) {
  const list = Array.isArray(features) ? features : []
  const cells = []
  const bucket = new Map()
  let hasField = false
  let skipped = 0

  for (const f of list) {
    const props = f?.properties || {}
    if (!hasField && Object.prototype.hasOwnProperty.call(props, GRID_POP_FIELD)) hasField = true
    const pop = Number(props[GRID_POP_FIELD])
    if (!Number.isFinite(pop) || pop <= 0) { skipped++; continue }
    const geom = f?.geometry
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) { skipped++; continue }

    // 🔴🔴 MultiPolygon 必须**逐 part 拆开**入索引，不能整体质心。
    //    SHP 的多 part 要素在行政区/网格数据里很常见（记忆铁律：SHP 多 part 出 Polygon/MultiPolygon）。
    //    若用整体质心：两个相隔 6km 的碎块会被当成一个"位于中间的巨块"，
    //    候选点明明压在其中一个碎块上也判定为外离 ⇒ 静默少算人口。
    //    （老接口是另一种错：turf.polygon(geom.coordinates) 直接抛错、整格被 catch 丢掉。）
    //    人口按**面积比例**分摊到各 part，圆内求和才与整体一致。
    const parts = []
    if (geom.type === 'Polygon') {
      parts.push({ geometry: geom, share: 1 })
    } else {
      let totalArea = 0
      const areas = geom.coordinates.map((coords) => {
        try {
          const a = turf.area(turf.polygon(coords))
          totalArea += Number.isFinite(a) && a > 0 ? a : 0
          return Number.isFinite(a) && a > 0 ? a : 0
        } catch { return 0 }
      })
      geom.coordinates.forEach((coords, i) => {
        const share = totalArea > 0 ? areas[i] / totalArea : 1 / geom.coordinates.length
        if (!(share > 0)) return
        try {
          parts.push({ geometry: turf.polygon(coords).geometry, share })
        } catch { /* 单 part 几何异常 ⇒ 跳过该 part（其余 part 仍可用） */ }
      })
    }

    for (const part of parts) {
      let center
      try {
        // ⚠️ 这里**不做** turf.polygon(geom.coordinates) 那种硬包装（老接口的 MultiPolygon bug）。
        //    每个 part 已是 Polygon，直接 feature 化。
        center = turf.centerOfMass(turf.feature(part.geometry)).geometry.coordinates
      } catch {
        skipped++
        continue
      }
      if (!Array.isArray(center) || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) {
        skipped++
        continue
      }

      // 外接半径（米）：面积 → 边长 → 半对角线。1km 方格 ≈ 707m。
      let halfDiagM = (GRID_CELL_M / 2) * Math.SQRT2
      try {
        const areaM2 = turf.area(turf.feature(part.geometry))
        if (Number.isFinite(areaM2) && areaM2 > 0) halfDiagM = Math.sqrt(areaM2) * 0.7072
      } catch { /* 用标称半对角线兜底 */ }

      const cell = {
        lng: center[0],
        lat: center[1],
        pop: pop * part.share,
        geom: part.geometry,
        halfDiagM,
        multi: geom.type === 'MultiPolygon',
        _feat: null
      }
      cells.push(cell)
      const k = bucketKey(cell.lng, cell.lat)
      let arr = bucket.get(k)
      if (!arr) { arr = []; bucket.set(k, arr) }
      arr.push(cell)
    }
  }

  return {
    covered: cells.length > 0 && hasField,
    hasField,
    cells,
    bucket,
    skipped
  }
}

/** 惰性构造 turf feature（边界格算交叠时才需要） */
function cellFeature(cell) {
  if (!cell._feat) cell._feat = turf.feature(cell.geom)
  return cell._feat
}

/**
 * 圆内人口 = Σ(格常住人口 × 交叠比例)
 *
 * 三档判定（立项稿 §4.4.1，性能关键 —— 避免每格都跑 turf.intersect）：
 *   ① d + halfDiag ≤ r  ⇒ 整格计入，ratio = 1
 *   ② d - halfDiag ≥ r  ⇒ 完全在外，ratio = 0
 *   ③ 中间（边界格，约 1~2 个）⇒ turf.intersect 算面积比
 *
 * @returns {{pop:number, whole:number, partial:number}}
 */
export function circlePopulation(index, lng, lat, radiusM) {
  const r = Number(radiusM)
  if (!index || !index.covered || !Number.isFinite(r) || r <= 0) return { pop: 0, whole: 0, partial: 0 }
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { pop: 0, whole: 0, partial: 0 }

  const dLat = r / M_PER_DEG_LAT
  const dLng = r / (M_PER_DEG_LAT * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
  const i0 = Math.floor((lng - dLng) / BUCKET_DEG), i1 = Math.floor((lng + dLng) / BUCKET_DEG)
  const j0 = Math.floor((lat - dLat) / BUCKET_DEG), j1 = Math.floor((lat + dLat) / BUCKET_DEG)

  let pop = 0, whole = 0, partial = 0
  let circleFeat = null

  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const arr = index.bucket.get(`${i}:${j}`)
      if (!arr) continue
      for (const cell of arr) {
        const d = planarMeters(lng, lat, cell.lng, cell.lat)
        if (d + cell.halfDiagM <= r) { pop += cell.pop; whole++; continue }
        if (d - cell.halfDiagM >= r) continue
        // 边界格：真算面积比
        try {
          if (!circleFeat) circleFeat = turf.circle([lng, lat], r / 1000, { steps: 64, units: 'kilometers' })
          const feat = cellFeature(cell)
          const inter = turf.intersect(turf.featureCollection([feat, circleFeat]))
          if (!inter) continue
          const cellArea = turf.area(feat)
          if (!(cellArea > 0)) continue
          const ratio = Math.min(turf.area(inter) / cellArea, 1)
          pop += cell.pop * ratio
          partial++
        } catch {
          // 几何异常 ⇒ 该格不计（⛔ 不按全格算，避免虚高）
        }
      }
    }
  }
  return { pop, whole, partial }
}

/** 中位数（空集返回 null —— ⛔ 不返 0 冒充「有值」） */
export function median(nums) {
  const arr = (Array.isArray(nums) ? nums : []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!arr.length) return null
  const mid = arr.length >> 1
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2
}

/** 线性插值分位（p ∈ [0,1]）；空集返回 null */
export function quantile(nums, p) {
  const arr = (Array.isArray(nums) ? nums : []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!arr.length) return null
  const pos = Math.min(Math.max(Number(p) || 0, 0), 1) * (arr.length - 1)
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  if (lo === hi) return arr[lo]
  return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo)
}

/**
 * 相对分位门槛（**必须在饱和剔除前、预去重前的全量候选格上算**）。
 * 🔴 立项稿 §8 铁律 17：在缩小后的集合上算会让样本漂移 ——
 *    同一片地两次框选（一次开了饱和、一次没开）会得到不同分，用户必然质疑。
 */
export function percentileThresholds(values) {
  const list = (Array.isArray(values) ? values : []).filter((x) => Number.isFinite(x))
  return {
    n: list.length,
    p25: quantile(list, 0.25),
    p50: quantile(list, 0.50),
    p70: quantile(list, 0.70),
    p90: quantile(list, 0.90),
    median: median(list)
  }
}

/**
 * 圆内人口 → 相对分位分（95/85/72/58/40）。
 * 门槛缺失（样本不足）时返回 null ⇒ 调用方按「该维度未评」处理，⛔ 不给满分也不给 0 分。
 */
export function percentileScore(value, thresholds) {
  if (!Number.isFinite(value) || !thresholds || !Number.isFinite(thresholds.p50)) return null
  for (const [pct, score] of GRID_PERCENTILE_STEPS) {
    const bound = pct === 0.90 ? thresholds.p90 : pct === 0.70 ? thresholds.p70 : pct === 0.50 ? thresholds.p50 : thresholds.p25
    if (Number.isFinite(bound) && value >= bound) return score
  }
  return GRID_PERCENTILE_FLOOR
}

/**
 * 读取某城市的网格索引（含 geojson 文件加载）。
 * @returns {{covered:boolean, hasField:boolean, index:object|null, row:object|null, reason:string}}
 *   reason: '' | 'no_grid_row'（不在 26 城）| 'no_field'（缺常住人口字段）| 'empty'（全 0）
 */
export function loadGridIndex(db, user, city) {
  const row = findGridRow(db, user, city)
  if (!row) return { covered: false, hasField: false, index: null, row: null, reason: 'no_grid_row' }

  const fieldNames = parseFieldNames(row.field_names)
  // 铁律 3：缺「常住人口」字段 ⇒ 该城市视同无网格（⛔ 不可按 0 分算）
  if (fieldNames.length && !fieldNames.includes(GRID_POP_FIELD)) {
    return { covered: false, hasField: false, index: null, row, reason: 'no_field' }
  }

  const withGeo = { ...row }
  attachGeo(withGeo)
  let geojson = null
  try {
    geojson = typeof withGeo.geojson === 'string' ? JSON.parse(withGeo.geojson) : withGeo.geojson
  } catch {
    geojson = null
  }
  const index = buildGridIndex(geojson?.features || [])
  if (!index.covered) {
    return { covered: false, hasField: index.hasField, index: null, row, reason: index.hasField ? 'empty' : 'no_field' }
  }
  return { covered: true, hasField: true, index, row, reason: '' }
}

/** 便捷：直接拿 db（避免调用方各自 import getDb 造成循环依赖） */
export function gridIndexForCity(user, city) {
  return loadGridIndex(getDb(), user, city)
}

/**
 * 列出「有本地 1km 网格」的城市（供前端城市下拉 + 自动填充框选范围）。
 *
 * 为什么需要它：用户不可能手输经纬度四至。有了每城的 bbox，前端可以先给一个
 * 「该城市范围内 4km×4km」的默认框，用户再在地图上微调 —— 否则这个功能没人用得下去。
 *
 * ⚠️ 同城多份文件时取 **id 最大**（最近一次上传），与 findGridRow 同口径，
 *    否则下拉里的 bbox 与实际参与计算的网格可能不是同一份。
 *
 * @returns {Array<{city:string, id:number, featureCount:number, bbox:number[]|null}>}
 */
export function listGridCities(db, user) {
  const isAdmin = user?.role === 'admin'
  const select = `SELECT id, name, city, feature_count, minx, miny, maxx, maxy FROM shapefiles WHERE category = 'population'`
  const sql = isAdmin
    ? `${select} ORDER BY id DESC`
    : `${select} AND (user_id = ? OR user_id IN (SELECT id FROM users WHERE role = 'admin')) ORDER BY id DESC`
  let rows = []
  try {
    rows = isAdmin ? db.prepare(sql).all() : db.prepare(sql).all(user?.id)
  } catch {
    return []
  }

  const byCity = new Map()
  for (const r of rows) {
    const city = resolveGridCity(r)
    if (!city || byCity.has(city)) continue   // 已按 id DESC 排序 ⇒ 首次出现即最新
    const bbox = [r.minx, r.miny, r.maxx, r.maxy]
    const hasBox = bbox.every((x) => Number.isFinite(Number(x)))
    byCity.set(city, {
      city,
      id: r.id,
      featureCount: Number(r.feature_count) || 0,
      bbox: hasBox ? bbox.map(Number) : null
    })
  }
  return [...byCity.values()].sort((a, b) => a.city.localeCompare(b.city, 'zh-CN'))
}
