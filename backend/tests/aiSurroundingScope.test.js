/**
 * AI 周边要素的**可见域**守卫 —— v1.13.339
 *
 * 起因（业主 2026-11-09 实测发现）：
 *   admin 账号在五角场点位生成 AI 选址建议，AI 说「1km 内已有 **15 家自家门店**，蚕食风险极高」，
 *   而同一份立项报告里写「商圈内自家门店 **0 家**」—— 同一页面两个数，业主直接判定「AI 算法有问题」。
 *
 * 根因：`buildSurroundingContext()` 还是 v1.13.277 **之前**的写法
 *   `isAdmin ? '全平台' : 'WHERE user_id = ?'`。
 *   277 已把 `/api/markers`、商圈计数统一改成 `readableUserIds()`（admin **刻意不放大**），
 *   但这段 AI 周边没跟着改 ⇒ admin 把**全平台 2886 家门店**当成"我的"，1km 内数到 15 家。
 *   实测数据：五角场 1km 内确有 19 家门店，但分属 7 个账号，admin 名下 **0 家**。
 *
 * ⚠️ 这个 bug 的可怕之处不是数字大，而是**把别人家的门店当成我的**喂给模型
 *    ⇒ 蚕食风险被凭空夸大 ⇒ 选址建议直接跑偏，且用户无从察觉。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** 剥掉注释再断言（否则注释里写的「旧写法 isAdmin ? 全量」会骗到扫描器） */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

const AI_RAW = read('backend/src/routes/ai.js')
const AI = strip(AI_RAW)
const MARKERS = strip(read('backend/src/routes/markers.js'))

/** 只取 buildSurroundingContext 函数体 */
function surroundingBody() {
  const i = AI.indexOf('async function buildSurroundingContext')
  expect(i).toBeGreaterThan(-1)
  // 到下一个顶层函数/注释分节为止
  const rest = AI.slice(i)
  const end = rest.indexOf('\n// =====')
  return end > 0 ? rest.slice(0, end) : rest.slice(0, 4000)
}

describe('AI 周边要素：门店/竞品计数必须按可见域（v1.13.339）', () => {
  it('🔴 不许再出现 `isAdmin ? 全量` 这种放大写法', () => {
    const body = surroundingBody()
    expect(body).not.toMatch(/isAdmin\s*\?/)
    // 也不能靠 role 判断绕开
    expect(body).not.toContain("role === 'admin'")
  })

  it('★ 必须走 readableUserIds + IN (...)（与 /api/markers 同源）', () => {
    const body = surroundingBody()
    expect(body).toContain('readableUserIds(db, userId)')
    expect(body).toContain('placeholders(scopeIds.length)')
    expect(body).toMatch(/user_id IN \(\$\{ph\}\)/)
    // 门店查询仍要排除已合并行（读路径铁律）
    expect(body).toContain('merged_into IS NULL')
  })

  it('🔴 空可见域必须返 0 家 —— ⛔ 靠 SQL 兜底（placeholders(0) 会退化成单个 ?）', () => {
    const body = surroundingBody()
    // 两处查询都要有 scopeIds.length 的三元保护
    const guards = body.match(/scopeIds\.length\s*\?/g) || []
    expect(guards.length).toBeGreaterThanOrEqual(2)
    // 不能出现无保护的 `.all(...scopeIds)` 紧跟 prepare
    expect(body).toMatch(/:\s*\[\]/)
  })

  it('调用处不再传 isAdmin（签名已收敛为 4 参）', () => {
    expect(AI).toMatch(/buildSurroundingContext\(lat, lng, radii \|\| \(radiusMeters \? \[radiusMeters\] : null\), req\.user\.id, compBrands\)/)
  })

  it('与 markers.js 的口径保持一致（同一份可见域工具，别各写一套）', () => {
    expect(MARKERS).toContain('readableUserIds')
    expect(AI).toContain("import { readableUserIds, placeholders } from '../utils/visibleScope.js'")
  })

  it('可见域工具本身：admin 不放大（回归基线，防止有人「顺手」放开）', () => {
    const VS = strip(read('backend/src/utils/visibleScope.js'))
    const i = VS.indexOf('export function visibleScope')
    const body = VS.slice(i, i + 900)
    expect(body).not.toMatch(/role\s*===\s*'admin'/)
    expect(body).toContain('ownedOrg(db, self)')
  })
})
