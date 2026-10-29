/**
 * 门店合并/撤销的守卫（v1.13.283）
 *
 * 合并是**软删**（只写 merged_into，不删行）。这个设计有两条必须同时成立的前提：
 *   ① 所有**统计/分析类**查询都要加 `merged_into IS NULL`，否则合并等于没合并；
 *   ② 单行读取/更新/删除 **不能**加，否则用户看不到也撤销不了已合并的行。
 * 另外三条业务红线：同品牌、距离阈值、有销售记录不合并。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8')

const markersSrc = read('backend/src/routes/markers.js')
const districtsSrc = read('backend/src/routes/districts.js')
const forecastSrc = read('backend/src/routes/sales-forecast.js')
const dbSrc = read('backend/src/models/database.js')

/** 取包含某片段的那一行 */
const lineWith = (src, needle) => src.split('\n').find((l) => l.includes(needle)) || ''

describe('建表迁移', () => {
  it('markers 增加 merged_into / merged_at 两列', () => {
    expect(dbSrc).toContain('ALTER TABLE markers ADD COLUMN merged_into INTEGER')
    expect(dbSrc).toContain('ALTER TABLE markers ADD COLUMN merged_at DATETIME')
  })
})

describe('合并接口的三条业务红线', () => {
  it('必须校验同品牌（跨品牌合并＝删掉客户真实的一家店）', () => {
    const i = markersSrc.indexOf("router.post('/merge'")
    const body = markersSrc.slice(i, i + 4000)
    expect(body.includes('normalizeBrand')).toBe(true)
    expect(body.includes('品牌不同')).toBe(true)
  })

  it('必须校验距离阈值', () => {
    const i = markersSrc.indexOf("router.post('/merge'")
    const body = markersSrc.slice(i, i + 4000)
    expect(body.includes('distanceMeters')).toBe(true)
    expect(body.includes('超过')).toBe(true)
  })

  it('有销售记录必须拒绝合并（409），不做隐性数据丢失', () => {
    const i = markersSrc.indexOf("router.post('/merge'")
    const body = markersSrc.slice(i, i + 4000)
    expect(body.includes('FROM store_sales')).toBe(true)
    expect(body.includes('409')).toBe(true)
  })

  it('写操作必须在事务里，并且 touch 保留行（否则商圈计数缓存不失效）', () => {
    const i = markersSrc.indexOf("router.post('/merge'")
    const body = markersSrc.slice(i, i + 4000)
    expect(body.includes('db.beginTx()')).toBe(true)
    expect(body.includes('db.commitTx()')).toBe(true)
    expect(body.includes('UPDATE markers SET updated_at')).toBe(true)
  })
})

describe('路由顺序（同 /duplicates 的坑）', () => {
  it('/merge 与 /unmerge 都必须定义在 GET /:id 之前', () => {
    const idIdx = markersSrc.indexOf("router.get('/:id'")
    expect(idIdx).toBeGreaterThan(-1)
    expect(markersSrc.indexOf("router.post('/merge'")).toBeLessThan(idIdx)
    expect(markersSrc.indexOf("router.post('/unmerge'")).toBeLessThan(idIdx)
  })
})

describe('读路径必须排除已合并行（否则合并等于没合并）', () => {
  it('门店列表 + 总数', () => {
    expect(lineWith(markersSrc, 'FROM markers WHERE user_id = ? AND merged_into IS NULL ORDER BY')).not.toBe('')
    expect(lineWith(markersSrc, 'COUNT(*) AS c FROM markers WHERE user_id = ? AND merged_into IS NULL')).not.toBe('')
  })

  it('商圈内的「我的门店」计数（影响竞争分）', () => {
    const i = districtsSrc.indexOf('function countMyStoresInDistrict')
    const body = districtsSrc.slice(i, i + 1600)
    const hits = (body.match(/merged_into IS NULL/g) || []).length
    expect(hits, `countMyStoresInDistrict 里只有 ${hits} 处带 merged_into，应为 2（bbox 分支 + 全量分支）`).toBe(2)
  })

  it('销售预测的训练集与统计', () => {
    const train = lineWith(forecastSrc, 'function buildTrainingSet')
    const trainBody = forecastSrc.slice(forecastSrc.indexOf(train), forecastSrc.indexOf(train) + 600)
    expect(trainBody.includes('merged_into IS NULL')).toBe(true)
    expect(lineWith(forecastSrc, "store_type = '已开业' AND merged_into IS NULL")).not.toBe('')
  })
})

describe('单行接口不能排除已合并行（否则撤销不了）', () => {
  it('GET /:id 不带 merged_into 过滤', () => {
    const line = lineWith(markersSrc, "'SELECT * FROM markers WHERE id = ? AND user_id = ?'")
    expect(line).not.toBe('')
    expect(line.includes('merged_into')).toBe(false)
  })

  it('/unmerge 自己按 merged_into IS NOT NULL 找行（专挑被合并的）', () => {
    const i = markersSrc.indexOf("router.post('/unmerge'")
    const body = markersSrc.slice(i, i + 1800)
    expect(body.includes('merged_into IS NOT NULL')).toBe(true)
    expect(body.includes('SET merged_into = NULL')).toBe(true)
  })
})

// ============================================================================
// 双店型二次拦截（v1.13.289）
//
// UI 已经不给双店型组合并入口，但接口必须自己拒绝 —— 否则绕过 UI 直接打接口
// 就能把「同一商场的大店 + 小店」合并掉，属灾难性数据丢失。
// ============================================================================
describe('双店型禁止合并（接口侧兜底）', () => {
  const body = () => {
    const i = markersSrc.indexOf("router.post('/merge'")
    return markersSrc.slice(i, i + 6000)
  }

  it('必须调用 looksLikeDualFormat 并给出可读原因', () => {
    expect(body().includes('looksLikeDualFormat')).toBe(true)
    expect(body().includes('两个店型')).toBe(true)
  })

  it('⚠️ SELECT 必须带 store_code / store_area —— 少了它判据恒为 false，拦截静默失效', () => {
    const sel = markersSrc.split('\n').find((l) => l.includes('SELECT id, name, brand, store_code, store_area')) || ''
    expect(sel, '合并查询没取 store_code/store_area ⇒ 双店型拦截永远不会触发').not.toBe('')
  })

  it('/duplicates 的返回里带上 kind / mergeable（前端据此隐藏合并按钮）', () => {
    const src = read('backend/src/utils/storeDedup.js')
    expect(src.includes("kind: cls.kind")).toBe(true)
    expect(src.includes('mergeable: cls.kind !== ')).toBe(true)
  })
})
