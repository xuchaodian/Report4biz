/**
 * 人口网格**按整格绘制**的守卫 —— v1.13.316
 *
 * 背景（两次需求反转，写清楚以免再来回）：
 *   · 313 之前：直接拿 `feature.geometry`（整格）画 ⇒ 3km 圆配 1km 网格时，
 *     圆外那 4 个角被整格填色，着色区像 7×7 方块阵，业主认为"这不是半径圆"。
 *   · 314（af0760b）：后端多返回一个 `geom`＝「格子 ∩ 统计范围」，前端改用 `geom` 画
 *     ⇒ 贴边格子被裁成圆弧碎片。
 *   · 316（本批）：业主 2026-11-04 明确「范围涉及到的网格整块显示，不要切割」
 *     ⇒ 绘制改回 `feature.geometry`（整格），`geom` 仅作回退兜底。
 *
 * 🔴🔴 本批**只改显示**：`value` 仍是 `fieldValue × coverageRatio`（面积加权）。
 *   ⛔ 不能因为"整格都画了"就把统计改成整格原值 —— 那等于把 3km 圆算成 7×7 方块。
 *   判据：同一范围的 `data.total` 在 314 / 316 必须完全一致（真机实测 5km 圆 = 1,622,091）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const MAP = path.join(REPO_ROOT, 'frontend/src/views/MapView.vue')
const ROUTE = path.join(REPO_ROOT, 'backend/src/routes/shapefiles.js')

const mapSrc = fs.readFileSync(MAP, 'utf8')
const routeSrc = fs.readFileSync(ROUTE, 'utf8')

describe('A. 网格绘制用整格几何', () => {
  it('绘制取 feature.geometry，data.geom 只作兜底', () => {
    expect(mapSrc).toContain('const geom = (feature && feature.geometry) || data.geom')
  })

  it('🔴 反向断言：不得再解构 data.geom 去画', () => {
    expect(
      /const \{ feature, value, geom \} = data/.test(mapSrc),
      '又改成用 data.geom 绘制了 —— 那是 314 的裁剪几何，会把贴边格子切成圆弧碎片'
    ).toBe(false)
  })

  it('标签与面板定位同源（都用整格，否则数字/面板会偏到裁剪碎片边上）', () => {
    expect((mapSrc.match(/\(data\.feature && data\.feature\.geometry\) \|\| data\.geom/g) || []).length)
      .toBeGreaterThanOrEqual(1)
  })
})

describe('B. 统计口径未被顺手改动', () => {
  it('后端仍按相交面积比例加权（coverageRatio 链路在）', () => {
    expect(routeSrc).toContain('const ratio = Math.min(intersectArea / polygonArea, 1)')
    expect(routeSrc).toContain('const weighted = fieldVal * ratio')
  })

  it('仍返回 coverageRatio（前端 tooltip 的「占比」与面板口径都靠它）', () => {
    expect(routeSrc).toContain('coverageRatio: ratio')
  })

  it('geom 字段仍返回（旧版前端缓存会用到它，⛔ 别直接删）', () => {
    expect(routeSrc).toContain('geom: partsToGeometry(intersectPolygonParts(intersect.geometry)) || feature.geometry')
  })
})
