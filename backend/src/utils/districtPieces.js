/**
 * 商圈面加载与点归属判定（v1.13.378 从 routes/site-select.js 原样抽出）
 *
 * ── 为什么抽出来 ────────────────────────────────────────────────────────
 * 智能选址（批次 370）需要「这个点落在哪个商圈面里」，候选点位的初步分析报告
 * （批次 378）需要同一件事。若两份各写一遍，同一点位在两个页面会显示不同的商圈名与评分，
 * 客户只会问「到底哪个对」。项目铁律：派生/解析算法必抽单一函数共用。
 *
 * ── 与前端 candidateReport.js 的分工 ─────────────────────────────────────
 * 前端那份（`pickDistrictForPoint` / `distanceToGeometryM`）服务的是**立项报告弹窗**：
 * 它拿 `/api/districts?city=` 的全量面自己判 PIP，还能给「最近商圈多少米」。
 * 本文件（后端）只判「在不在面内」+ 取属性，**⛔ 不算最近距离** ——
 * 两套距离实现（射线线段法 vs turf）会有几米到几十米的差，同一点位的两个报告
 * 分别写「320m」和「347m」，比不给这个数更糟。要距离就调前端那份，保持单一来源。
 *
 * ⚠️ 商圈面只覆盖上海陆域约 24%（§6.76），「落空」是常态而非异常 ——
 *    调用方必须把 `contained=false` 如实展示，⛔ 不要伪装成「就在这个商圈里」。
 */
import * as turf from '@turf/turf'
import { attachGeo } from '../models/geoStore.js'
import { normalizeDistrictProps } from './districtProps.js'
import { median } from './gridPopulation.js'

/**
 * 加载商圈面（category='other'，按城市名模糊匹配）。
 *
 * 属性一律经 `normalizeDistrictProps` 归一 —— 商圈面有两代产物（2022 年度版 / 联通人口版），
 * 字段名不同；不归一会让 `computeScore` 拿到 undefined ⇒ 人口项恒 22 分且不报错。
 *
 * 🔴 城市名用 `LIKE %key%` 且剥掉尾部「市」：shapefiles.name 里既有「上海商圈」也有
 *    「上海市商圈」，精确相等会一个都匹配不上。
 *
 * @returns {Array<{name:string, props:object, feature:object, bbox:number[]}>}
 */
export function loadDistrictPieces(db, city) {
  const key = String(city || '').trim().replace(/市$/, '')
  if (!key) return []
  let rows = []
  try {
    rows = db.prepare(`SELECT id, name, field_names FROM shapefiles WHERE category = 'other' AND name LIKE ?`).all(`%${key}%`)
  } catch {
    return []
  }
  const out = []
  for (const row of rows) {
    const withGeo = { ...row }
    try { attachGeo(withGeo) } catch { continue }
    let geo = withGeo.geojson
    if (typeof geo === 'string') {
      try { geo = JSON.parse(geo) } catch { geo = null }
    }
    for (const f of geo?.features || []) {
      const geom = f?.geometry
      if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue
      const props = normalizeDistrictProps(f.properties || {})
      let box
      try { box = turf.bbox(turf.feature(geom)) } catch { continue }
      out.push({
        name: String(props['名称'] || props['商圈名'] || '').trim(),
        props,
        feature: turf.feature(geom),
        bbox: box
      })
    }
  }
  return out
}

/** 点是否落在某个商圈面内（先 bbox 粗筛，再做 PIP）；命中返回该面，否则 null */
export function findDistrict(pieces, lng, lat) {
  for (const p of pieces) {
    const [w, s, e, n] = p.bbox
    if (lng < w || lng > e || lat < s || lat > n) continue
    try {
      if (turf.booleanPointInPolygon(turf.point([lng, lat]), p.feature)) return p
    } catch { /* 几何异常跳过该面 */ }
  }
  return null
}

/** 框选内有效格（常住人口 > 0）的单格人口中位数（智能选址「区域密度提示」用） */
export function medianInBbox(cells, bbox) {
  const [w, s, e, n] = bbox
  const vals = []
  for (const c of cells) {
    if (c.lng < w || c.lng > e || c.lat < s || c.lat > n) continue
    if (Number.isFinite(c.pop) && c.pop > 0) vals.push(c.pop)
  }
  return median(vals)
}
