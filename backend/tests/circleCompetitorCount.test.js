/**
 * 「半径圆内竞品数」守卫（v1.13.421）
 *
 * ── 为什么有这条链路 ──────────────────────────────────────────────────────
 *   立项报告的「关键信息」原来只有「商圈内竞品」（**商圈面**口径），
 *   跟上面那个半径圆的人口并排摆着，读者会把「商圈内 0 家」当成「3km 内 0 家」。
 *   业主要求改成「半径 X 内竞品」，并且数量要跟着所选半径变。
 *
 * ── 这条守卫防什么 ────────────────────────────────────────────────────────
 *   ① **可见域**：竞品表是全平台共用的，不按 `readableUserIds` 过滤就是跨账号聚合
 *      （277 那次事故的同款 —— 商圈计数当时就是这么错的）。
 *   ② **品牌收窄**：必须走同一个 `competitorWhere(compBrands)`，⛔ 自己另拼 WHERE；
 *      两处口径漂移会出现「商圈评分说 5 家、报告说 3 家」。
 *   ③ **半径是圆的，不是方的**：bbox 只能当粗筛（r=3km 时对角误差约 40%），
 *      必须再用球面距离精判一次。
 *   ④ **只读**：这条链路任何写库/扣费动作都不许有（报告切档会反复调它）。
 *   ⑤ **缓存 key**：少了用户集合/品牌集合/坐标/半径中的任何一个，
 *      别人的结果会被直接命中（同样的跨账号泄露，只是发生在缓存层）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const COUNT_FILE = 'backend/src/utils/districtCount.js'
const ROUTE_FILE = 'backend/src/routes/districts.js'

/** 按大括号配平截出函数体（与 districtCountScopeGuard.test.js 同一套做法） */
function fnBody(source, signature) {
  const start = source.indexOf(signature)
  if (start === -1) return null
  const brace = source.indexOf('{', start)
  if (brace === -1) return null
  let depth = 0
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(brace, i + 1)
    }
  }
  return null
}

describe('A. countCompetitorsInCircle 实现约束', () => {
  const src = read(COUNT_FILE)
  const body = fnBody(src, 'export function countCompetitorsInCircle(')

  it('A0 函数存在', () => {
    expect(body, '缺 countCompetitorsInCircle（报告竞品数就没了数据源）').toBeTruthy()
  })

  it('A1 判无权：ids 为空必须直接 0，⛔ 不许退化成"不过滤"', () => {
    expect(body).toMatch(/!\s*Array\.isArray\(ids\)\s*\|\|\s*ids\.length\s*===\s*0\)\s*return 0/)
  })

  it('A2 必须按可见域过滤（user_id IN (?)）', () => {
    expect(body).toContain('user_id IN (${ph})')
    expect(body).toContain('ids.map(')
  })

  it('A3 品牌收窄必须复用 competitorWhere（⛔ 自己另拼 WHERE）', () => {
    expect(body).toContain('competitorWhere(compBrands)')
    expect(body).toContain('brandSql')
    expect(body).toContain('brandParams')
  })

  it('A4 排除已关/未营业（与商圈评分那份同口径）', () => {
    expect(body).toContain("status NOT IN ('店铺已关','尚未营业')")
  })

  it('A5 半径要球面精算，⛔ 只靠 bbox（方圆不分）', () => {
    expect(body).toMatch(/circleDistM\(/)
    expect(src).toMatch(/function circleDistM\(/)
    expect(src).toContain('6371000')
  })

  it('A6 缓存 key 必须含 可见域 + 品牌集 + 坐标 + 半径', () => {
    // ⚠️ key 是跨两行拼接的（模板串换行）⇒ 必须截「从赋值到取缓存」整段，
    //   只取一行会漏掉坐标/半径，进而把这条断言变成假红（本批踩过一次）。
    const from = body.indexOf('const cacheKey')
    const to = body.indexOf('districtCountCache.get', from)
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const keySeg = body.slice(from, to)
    for (const token of ['scopeKeyOf(ids)', 'scopeCacheKey(compBrands)', 'lng.toFixed(5)', 'Math.round(r)']) {
      expect(keySeg, `缓存 key 缺 ${token}`).toContain(token)
    }
    // 数据版本：门店/竞品改了要立刻失效
    expect(keySeg).toContain('ver')
  })

  it('A7 半径非法（≤0 / NaN）必须返回 0，⛔ 拿"整张表"当结果', () => {
    expect(body).toMatch(/!\(r > 0\)\)\s*return 0/)
    expect(body).toMatch(/Number\.isFinite\(lng\)/)
    expect(body).toMatch(/Number\.isFinite\(lat\)/)
  })
})

describe('B. /api/districts/competitors-in-circle 路由约束', () => {
  const src = read(ROUTE_FILE)
  const start = src.indexOf("router.get('/competitors-in-circle'")
  const body = start === -1 ? '' : src.slice(start, src.indexOf('\n})', start) + 3)

  it('B0 路由存在', () => {
    expect(start).toBeGreaterThan(-1)
  })

  it('B1 必须登录（authenticate）', () => {
    expect(src.slice(start, start + 80)).toContain('authenticate')
  })

  it('B2 只读：⛔ 不许出现任何写库语句', () => {
    for (const w of ['INSERT INTO', 'UPDATE ', 'DELETE FROM', 'saveNow', 'chargeAndRecord', 'smartsteps']) {
      expect(body, `只读接口里出现了 ${w}`).not.toContain(w)
    }
  })

  it('B3 可见域与品牌收窄必须走既有入口（⛔ 手写 user_id = ?）', () => {
    expect(body).toContain('readableUserIds(')
    expect(body).toContain('resolveCompBrands(')
    expect(body).not.toMatch(/user_id\s*=\s*\?/)
  })

  it('B4 坐标无效要 400，⛔ 静默返回 0 家（那会被当成"这里没有竞品"）', () => {
    expect(body).toContain('res.status(400)')
    expect(body).toContain('Number.isFinite(lat)')
  })

  it('B5 半径夹在合理区间，⛔ 写死 1/3/5km', () => {
    expect(body).toContain('Math.min(50000')
    expect(body).toContain('Math.max(50')
    expect(body).not.toMatch(/radius\s*===\s*(1000|3000|5000)/)
  })
})
