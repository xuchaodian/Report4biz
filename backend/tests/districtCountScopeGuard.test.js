/**
 * 商圈计数「跨账号聚合」守卫（v1.13.277）
 *
 * 背景：`districts.js` 里算「竞争宽松度」用的两个计数函数，原实现是
 *   `SELECT longitude, latitude FROM competitors` / `FROM markers`
 *   —— **完全没有 user_id 条件**，且计数缓存 key 里也没有用户。
 *
 * 后果（生产实测）：
 *   · 门店分属 20+ 个账号、竞品集中在 3 个账号 ⇒ 每个账号看到的「竞品 N 家 / 我的门店 M 家」
 *     都是**全平台**的数字；只有那几个真正上传过数据的账号看着"刚好对"。
 *   · 竞争占综合分 25%（90 分与 20 分差 17.5 分）⇒ 静默失真 + 跨用户数据聚合。
 *   · 缓存 key 不含用户 ⇒ 即使 SQL 补了过滤，甲乙用户看同一商圈仍会互相命中缓存。
 *
 * 本文件是**回归钉子**：谁把 user_id 条件删了、把缓存 key 里的可见域去掉、
 * 或者让空数组退化成「不过滤」，测试立刻红。
 *
 * v1.13.297：这两个函数从 routes/districts.js 迁到 utils/districtCount.js
 *   （门店体检的红黄绿灯要判断「竞争密集」，必须和商圈洞察共用同一份计数）。
 *   ⇒ 断言目标改为新文件；口径要求一字未松。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，
 *    `new URL(...).pathname` 会留下百分号编码，导致 fs 报 ENOENT。
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ROUTE_FILE = path.join(REPO_ROOT, 'backend/src/routes/districts.js')
const src = fs.readFileSync(ROUTE_FILE, 'utf8')
// 计数函数本体（v1.13.297 起在这里）
const COUNT_FILE = path.join(REPO_ROOT, 'backend/src/utils/districtCount.js')
const countSrc = fs.readFileSync(COUNT_FILE, 'utf8')
// 门店体检的红黄绿灯路由
const MARKERS_FILE = path.join(REPO_ROOT, 'backend/src/routes/markers.js')
const markersSrc = fs.readFileSync(MARKERS_FILE, 'utf8')

/** 按大括号配平截出函数体 */
function extractFnBody(source, signature) {
  const start = source.indexOf(signature)
  if (start === -1) return null
  const braceStart = source.indexOf('{', start)
  if (braceStart === -1) return null
  let depth = 0
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(braceStart, i + 1)
    }
  }
  return null
}

describe('商圈内竞品计数：必须按可见域过滤', () => {
  const body = extractFnBody(countSrc, 'export function countCompetitorsInDistrict(')

  it('函数存在且接收 ids（可见域）参数', () => {
    expect(body, '未找到 countCompetitorsInDistrict —— 断言失效，请更新守卫').toBeTruthy()
    expect(
      countSrc.includes('export function countCompetitorsInDistrict(geometry, ids)'),
      '函数签名缺少 ids 参数 —— 计数无法按可见域收敛'
    ).toBe(true)
  })

  it('两条 SQL（bbox 分支 / 全量分支）都带 user_id IN', () => {
    const hits = (body.match(/user_id IN \(\$\{ph\}\)/g) || []).length
    expect(hits, `只有 ${hits} 条 SQL 带 user_id IN，应为 2（bbox 分支 + 全量分支）`).toBe(2)
    expect(
      body.includes('FROM competitors WHERE (status IS NULL'),
      '出现「不带 user_id 的竞品裸查询」—— 会把全平台竞品算进单个账号的竞争分'
    ).toBe(false)
  })

  it('空可见域必须返回 0，不得退化成「不过滤」', () => {
    expect(
      body.includes('ids.length === 0) return 0'),
      '缺少空数组护栏 —— 传 [] 时可能拼出 `IN ()` 或退化成全表'
    ).toBe(true)
  })

  it('缓存 key 含可见域（否则跨账号互相命中）', () => {
    expect(
      body.includes("'comp|' + scopeKeyOf(ids)"),
      "缓存 key 未拼 scopeKeyOf(ids) —— 甲用户的计数会被乙用户直接命中"
    ).toBe(true)
  })
})

describe('商圈内自家门店计数：必须按可见域过滤', () => {
  const body = extractFnBody(countSrc, 'export function countMyStoresInDistrict(')

  it('函数存在且接收 ids 参数', () => {
    expect(body, '未找到 countMyStoresInDistrict —— 断言失效，请更新守卫').toBeTruthy()
    expect(
      countSrc.includes('export function countMyStoresInDistrict(geometry, ids)'),
      '函数签名缺少 ids 参数'
    ).toBe(true)
  })

  it('两条 SQL 都带 user_id IN，且无裸查询', () => {
    const hits = (body.match(/user_id IN \(\$\{ph\}\)/g) || []).length
    expect(hits, `只有 ${hits} 条 SQL 带 user_id IN，应为 2`).toBe(2)
    expect(
      body.includes('FROM markers WHERE longitude BETWEEN'),
      '出现「不带 user_id 的门店裸查询」—— "我的门店"会变成"全平台门店"'
    ).toBe(false)
  })

  it('缓存 key 含可见域', () => {
    expect(body.includes("'store|' + scopeKeyOf(ids)"), '缓存 key 未拼 scopeKeyOf(ids)').toBe(true)
  })
})

describe('可见域的来源与传参', () => {
  it('统一走 visibleScope.readableUserIds（唯一读时可见域入口）', () => {
    expect(
      src.includes("import { readableUserIds } from '../utils/visibleScope.js'"),
      '未从 utils/visibleScope.js 引入 readableUserIds —— ⛔ 不要在业务里手写 user_id 过滤策略'
    ).toBe(true)
    expect(
      src.includes('readableUserIds(db, req.user.id)'),
      '未调用 readableUserIds(db, req.user.id)'
    ).toBe(true)
  })

  it('列表与详情两个消费点都把 scopeIds 传下去', () => {
    expect(
      src.includes('countCompetitorsInDistrict(feature.geometry, scopeIds)'),
      '列表/详情调用未传 scopeIds'
    ).toBe(true)
    expect(
      src.includes('countMyStoresInDistrict(feature.geometry, scopeIds)'),
      '列表/详情调用未传 scopeIds'
    ).toBe(true)
    expect(
      src.includes('countCompetitorsInDistrict(feature.geometry)'),
      '仍有调用点漏传 scopeIds'
    ).toBe(false)
  })
})

describe('门店体检信号灯：必须复用同一份计数（v1.13.297）', () => {
  it('markers.js 从 utils/districtCount.js 引入计数，而不是自己写 SQL', () => {
    expect(
      markersSrc.includes("from '../utils/districtCount.js'"),
      '门店体检路由未复用 districtCount —— 会与商圈洞察算出两个不同的竞争宽松度'
    ).toBe(true)
    expect(
      /FROM\s+competitors/i.test(markersSrc),
      'markers.js 里出现 competitors 查询 —— 「竞品数」必须走同一份计数，否则两页数字会打架'
    ).toBe(false)
  })

  it('districts.js 不再自带计数实现（避免又长回两份）', () => {
    expect(
      /function countCompetitorsInDistrict/.test(src),
      'districts.js 又出现本地计数函数 —— 请改回 import，否则门店体检那侧会悄悄漂移'
    ).toBe(false)
  })

  it('信号灯判定用的竞争阈值来自 districtScore（单一来源）', () => {
    const lightsSrc = fs.readFileSync(path.join(REPO_ROOT, 'backend/src/utils/storeLights.js'), 'utf8')
    expect(
      lightsSrc.includes("from './districtScore.js'") && /COMPETITION_DENSE_MAX/.test(lightsSrc),
      '信号灯未引用 COMPETITION_DENSE_MAX —— 阈值若各写一份，改口径必然漏改'
    ).toBe(true)
  })
})

describe('体检三处（页面/信号灯/导出）必须共用同一份取数与计算（v1.13.298）', () => {
  it('门店字段 SELECT 只出现一次（⛔ 导出不许自己再查一遍库）', () => {
    const n = (markersSrc.match(/store_type, store_category, sync_readonly/g) || []).length
    expect(n, '门店字段 SELECT 出现多次 ⇒ 页面与导出的数字会漂移').toBe(1)
  })

  it('销售记录统计只出现一次', () => {
    const n = (markersSrc.match(/FROM store_sales s/g) || []).length
    expect(n, '销售记录统计重复 ⇒ 完备度可能出现两个口径').toBe(1)
  })

  it('三个 checkup 路由都定义在 GET /:id 之前', () => {
    const idIdx = markersSrc.indexOf("router.get('/:id'")
    expect(idIdx).toBeGreaterThan(-1)
    for (const p of ["router.get('/checkup',", "router.get('/checkup/lights'", "router.get('/checkup/report'"]) {
      const i = markersSrc.indexOf(p)
      expect(i, `未找到 ${p}`).toBeGreaterThan(-1)
      expect(i, `${p} 定义在 GET /:id 之后 ⇒ 会被当成 id 命中`).toBeLessThan(idIdx)
    }
  })
})
