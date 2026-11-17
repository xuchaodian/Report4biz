/**
 * 撒点与点集空间索引（v1.13.370 / 批次 370）
 *
 * ── 职责边界 ───────────────────────────────────────────────────────────
 * 只做**纯几何**：bbox → 候选点、点集的「圆内计数 / 最近距离」。
 * ⛔ 不读库、不调接口、不认识品牌与商圈 —— 那些由 routes/site-select.js 注入。
 * 这样这一层可以被纯函数单测覆盖（含边界与量级），不必起数据库。
 *
 * ── 为什么不用 turf.booleanPointInPolygon 逐点判圆 ─────────────────────
 * 800 个候选点 × 数千竞品 × 每点建一次 turf 圆 ≈ 数十万次几何构造。
 * 圆内判定本来就是「平面距离 ≤ r」，用米制平面近似（1km 尺度误差 < 0.1%）足够，
 * 而且能把点按纬度排序后二分，只扫纬度窗内的点。
 * ⚠️ 真正需要几何精度的地方（网格与圆求交）仍在 gridPopulation.js 用 turf。
 */

import { M_PER_DEG_LAT, SITE_STEP_CHOICES } from './siteSelectConfig.js'
import { distanceMeters, looksLikeDualFormat } from './storeDedup.js'
import { SAME_ADDR_M } from './storeLights.js'

/** 两点平面距离（米） */
export function planarMeters(lng1, lat1, lng2, lat2) {
  const dx = (lng2 - lng1) * M_PER_DEG_LAT * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  const dy = (lat2 - lat1) * M_PER_DEG_LAT
  return Math.hypot(dx, dy)
}

/**
 * 框选面积（km²）—— 用等距圆柱近似。
 * 只用于「是否超过 MAX_BBOX_AREA_KM2」的护栏判断，不需要精确。
 */
export function bboxAreaKm2(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return 0
  const [w, s, e, n] = bbox.map(Number)
  if (![w, s, e, n].every(Number.isFinite)) return 0
  const midLat = (s + n) / 2
  const h = Math.abs(n - s) * M_PER_DEG_LAT / 1000
  const wd = Math.abs(e - w) * M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180) / 1000
  return Math.max(0, h * wd)
}

/** bbox 合法性：中国范围内、西南-东北顺序、非零面积 */
export function isBboxValid(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false
  const [w, s, e, n] = bbox.map(Number)
  if (![w, s, e, n].every(Number.isFinite)) return false
  if (w >= e || s >= n) return false
  // 中国大致经纬度范围（含南海）：东经 73~136、北纬 3~54
  if (w < 73 || e > 136 || s < 3 || n > 54) return false
  return true
}

/**
 * bbox → 网格中心点。
 *
 * 🔴🔴 **格心对齐「绝对经纬度网格」，⛔ 不是从 bbox 西南角起算**（批次 373，业主 2026-11-17 要求）
 *
 * 为什么必须这样（这条改动的唯一目的就是省钱）：
 *   旧口径 `lat = s + degLat * (j + 0.5)` 以框的南边界为原点 —— 用户在徐家汇拖框，
 *   这次拖到 31.1800、下次手一抖到 31.1809（差 100m），**所有格心整体平移 100m**。
 *   而联通人口数据的复用判据是「同坐标 10m 内 + 同半径」（见 smartsteps.js 取数优先级 ①），
 *   平移 100m 后 12 个点全部落空 ⇒ 范围明明重叠 95%，却整批重新扣配额。
 *   改成本函数后，格心 = 全球固定网格的整格倍数 `(k + 0.5) * deg`，**同一步长下任何框选
 *   的重叠区域都会得到逐字节相同的坐标** ⇒ 自然命中复用，拖多少次框都只付一次钱。
 *
 * ⚠️ 经向步长 `degLng` 的参考纬度**必须量化到整度**，⛔ 不能用 bbox 的 midLat：
 *   框高稍微一变 midLat 就变，cos 跟着变，经度格心立刻不对齐（纬度方向对了经度又错开）。
 *   量化到整度后，同一纬度带（±0.5°，约 55km）永远用同一个 cos，代价是格子的长宽比
 *   有 < 1% 的偏差 —— 对「圆内人口」这种用途完全无所谓。
 *
 * 口径：取**格心落在 bbox 内**的整格，覆盖整个框；框比一格还小时退化为一格（含框中心）。
 *
 * @param {number[]} bbox [lngW, latS, lngE, latN]
 * @param {number} stepM ∈ SITE_STEP_CHOICES
 * @returns {{points:Array<{lng:number,lat:number}>, cols:number, rows:number, stepM:number}}
 */
export function enumerateGrid(bbox, stepM) {
  const step = SITE_STEP_CHOICES.includes(Number(stepM)) ? Number(stepM) : 1000
  if (!isBboxValid(bbox)) return { points: [], cols: 0, rows: 0, stepM: step }

  const [w, s, e, n] = bbox.map(Number)
  const midLat = (s + n) / 2
  const midLng = (w + e) / 2
  const degLat = step / M_PER_DEG_LAT
  const refLat = Math.round(midLat)   // 🔴 量化到整度，见上方注释
  const degLng = step / (M_PER_DEG_LAT * Math.max(0.2, Math.cos((refLat * Math.PI) / 180)))

  // 绝对网格索引：格心 = (k + 0.5) * deg，k 为整数，与 bbox 无关
  let latK0 = Math.ceil(s / degLat - 0.5 - 1e-9)
  let latK1 = Math.floor(n / degLat - 0.5 + 1e-9)
  let lngK0 = Math.ceil(w / degLng - 0.5 - 1e-9)
  let lngK1 = Math.floor(e / degLng - 0.5 + 1e-9)

  // 保底：框比一格还小时，取包含框中心的那一格（否则会退化成 0 个候选点）
  if (latK1 < latK0) latK0 = latK1 = Math.round(midLat / degLat - 0.5)
  if (lngK1 < lngK0) lngK0 = lngK1 = Math.round(midLng / degLng - 0.5)

  const cols = lngK1 - lngK0 + 1
  const rows = latK1 - latK0 + 1

  const points = []
  for (let j = 0; j < rows; j++) {
    // ⚠️ 浮点必须写成 (k + 0.5) * deg 这一种形式 —— 换个等价写法（如 a + deg*j）
    //    就会因运算顺序不同产生末位差异，10m 容差虽能兜住，但「逐字节相同」才是可测的保证。
    const lat = (latK0 + j + 0.5) * degLat
    for (let i = 0; i < cols; i++) {
      const lng = (lngK0 + i + 0.5) * degLng
      points.push({ lng: Math.round(lng * 1e6) / 1e6, lat: Math.round(lat * 1e6) / 1e6 })
    }
  }
  return { points, cols, rows, stepM: step }
}

/** 二分：第一个 ≥ target 的下标 */
function lowerBound(arr, target) {
  let lo = 0, hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 二分：第一个 > target 的下标 */
function upperBound(arr, target) {
  let lo = 0, hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * 点集索引：按纬度排序 + 二分扫窗。
 * 点可以是 `{lng,lat}`，也可以是任意带 `longitude/latitude` 的行（门店/竞品）。
 */
export function buildPointIndex(points) {
  const arr = []
  for (const p of Array.isArray(points) ? points : []) {
    const lng = Number(p?.lng ?? p?.longitude)
    const lat = Number(p?.lat ?? p?.latitude)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    // (0,0) 是「没填坐标」的常见脏值（与 storeCheckup / competitorScope 同口径）
    if (lng === 0 && lat === 0) continue
    arr.push({ src: p, lng, lat })
  }
  arr.sort((a, b) => a.lat - b.lat)
  return { arr, lats: arr.map((x) => x.lat) }
}

/** 扫出以 (lng,lat) 为中心、radiusM 为半径的纬度窗内命中点 */
function scanWindow(index, lng, lat, radiusM, cb) {
  if (!index || !index.arr.length) return
  const dLat = radiusM / M_PER_DEG_LAT
  const lo = lowerBound(index.lats, lat - dLat)
  const hi = upperBound(index.lats, lat + dLat)
  for (let i = lo; i < hi; i++) {
    const it = index.arr[i]
    const d = planarMeters(lng, lat, it.lng, it.lat)
    if (d <= radiusM) cb(it, d)
  }
}

/**
 * 圆内计数（可带品牌分布）。
 * @returns {{count:number, byBrand:Object<string,number>}}
 */
export function countWithin(index, lng, lat, radiusM) {
  let count = 0
  const byBrand = {}
  scanWindow(index, lng, lat, radiusM, (it) => {
    count++
    const b = String(it.src?.brand || '').trim() || '未知'
    byBrand[b] = (byBrand[b] || 0) + 1
  })
  return { count, byBrand }
}

/**
 * 半径内最近点的距离（米）；无命中返回 null。
 * capM 之外的不算（与体检「搜索窗」同思路：窗外一律「基本独立」）。
 */
export function nearestDistance(index, lng, lat, capM) {
  let best = null
  scanWindow(index, lng, lat, capM, (it, d) => {
    if (best === null || d < best) best = d
  })
  return best
}

/**
 * 饱和保护：半径内**同品牌在营门店**的有效家数。
 *
 * 🔴 双店型同址不计两家（立项稿 §4.5 铁律 3）：
 *    同址「大店 + 小店」是客户有意的布局（`storeDedup.looksLikeDualFormat`：
 *    编码不同 + 面积比 ≥2）。若算两家，会把自己有意的布局判成「已饱和」。
 *    判据与距离阈值全部复用既有实现，⛔ 不另写一套（项目铁律：派生算法单一来源）。
 *
 * @param {Array} sameBrandStores 已按品牌过滤过、且在营的门店行
 * @param {object} index buildPointIndex(sameBrandStores)
 * @returns {number} 有效家数（同址双店型合并为 1）
 */
export function sameBrandEffectiveCount(index, lng, lat, radiusM) {
  const inRange = []
  scanWindow(index, lng, lat, radiusM, (it, d) => { inRange.push({ store: it.src, d }) })
  if (!inRange.length) return 0
  inRange.sort((a, b) => a.d - b.d)

  const kept = []
  for (const item of inRange) {
    let merged = false
    for (const k of kept) {
      if (distanceMeters(k, item.store) <= SAME_ADDR_M && looksLikeDualFormat(k, item.store)) {
        merged = true
        break
      }
    }
    if (!merged) kept.push(item.store)
  }
  return kept.length
}

/**
 * NMS（非极大值抑制）：按分数降序扫描，取一点后剔除其 minGapM 内的其他候选。
 *
 * 🔴 全流程会调用两次，顺序不可颠倒（立项稿 §4.4）：
 *    ① 预去重（阶段 1，用**粗排分**）—— 目的是省配额，
 *       步长 500m 时相邻 4 格是同一片人，不去重等于用 4 次钱买 1 份信息
 *    ② 二次去重（阶段 3，用**精算总分**）—— 目的是让 TOP N 彼此不重叠
 *
 * @param {Array} items 每项需有 `center:[lng,lat]` 与 `score:number`
 * @param {number} minGapM
 * @param {number} limit 最多返回多少条（0/undefined = 不限）
 */
export function nms(items, minGapM, limit = 0) {
  const list = (Array.isArray(items) ? items : [])
    .filter((x) => x && Array.isArray(x.center) && Number.isFinite(x.score))
    .slice()
    .sort((a, b) => b.score - a.score)
  const gap = Number.isFinite(minGapM) && minGapM > 0 ? minGapM : 0
  const kept = []
  for (const it of list) {
    if (limit > 0 && kept.length >= limit) break
    const [lng, lat] = it.center
    let blocked = false
    for (const k of kept) {
      if (planarMeters(lng, lat, k.center[0], k.center[1]) < gap) { blocked = true; break }
    }
    if (!blocked) kept.push(it)
  }
  return kept
}
