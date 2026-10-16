/**
 * v1.13.231（批次 231）—— 「隐藏资产」清理后的**防误恢复 / 防清理不彻底**守卫
 *
 * 立档背景：
 *   10-14 盘点（`Report4biz_隐藏功能盘点_20261014.md`）把「隐藏功能」定性为**两族**资产；
 *   10-16 完成 P2 决策 = **清理**（依据 `Report4biz_隐藏资产清理方案_20261016.md`，
 *   重叠评审判定 ≈80% 重叠：开店余地 + 商圈洞察已覆盖人口/竞品/配套三面）。
 *
 * 本文件守两件事：
 *   ① **误恢复**：有人（含未来的我）把路由挂载行/前端路由加回来却没读报告 ⇒ 立刻红；
 *   ② **清理不彻底**：文件删了但 import / DDL / 前端引用残留 ⇒ 立刻红。
 *
 * ⚠️ 与已删除的 `hiddenRoutesAdminGuard.test.js` 的关系：
 *   那个文件守的是「两族路由**仍在**且已收紧为 admin-only」；路由既已删除，其 B/C/D 三组
 *   失去对象，故本文件**接管其 A 组**（`requireAdmin` 中间件行为 —— 与资产去留无关、独立有效），
 *   并把 B/C/D 换成上面的「已清理」断言。
 *
 * ⚠️ 隔离：本文件 import `middleware/auth.js` ⇒ 会经 `models/database.js` 触发 `initDatabase()`，
 *   故必须**先设 `R4B_DB_PATH` 再用动态 import**（⛔ ESM 静态 import 会提升，env 会来不及设
 *   —— 这是批次 225 用真实开发库换来的教训）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tmpDb = path.join(os.tmpdir(), `r4b-hidden-removed-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

/** ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，`new URL().pathname` 会留百分号编码。 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SELF = fileURLToPath(import.meta.url)

let requireAdmin

beforeAll(async () => {
  ({ requireAdmin } = await import('../src/middleware/auth.js'))
})

afterAll(() => {
  try { fs.rmSync(tmpDb, { force: true }) } catch (e) { /* 忽略 */ }
})

function stripComments(src) {
  // ⚠️⚠️ 顺序有讲究（v1.13.231 实测踩坑）：**必须先剥行注释，再剥块注释**。
  //   反例（本文件初版就是这么写的，且**被自己的反向对照断言抓住**）：
  //     app.js 里有一句行注释
  //       `// 外部联通 Excel 批量导入须先于 /api/purchase 注册（/import/* 不被 … 吞）`
  //     其中的 `/*` 被裸的 `/\/\*[\s\S]*?\*\//g` 当成块注释开头，一路吞到后面
  //     **真正块注释**里的 `*/` ⇒ **静默吃掉约 3,180 字符真实代码**（含 /api/districts 挂载行）
  //     ⇒ 反向对照断言立刻报「/api/districts 应仍在」失败。
  //   ⇒ 这正是 211 条铁律「裸块注释正则会被字符串里的 `/*` 骗到 ⇒ 静默吃代码报假红」。
  //   先剥行注释可消除该诱因；另配 ⑯b「剥后体积不得低于 60%」作兜底自检。
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}
function read(rel) {
  const p = path.join(REPO_ROOT, rel)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}
function walk(dir, out = []) {
  const p = path.join(REPO_ROOT, dir)
  if (!fs.existsSync(p)) return out
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) walk(rel, out)
    else if (/\.(js|vue|scss)$/.test(e.name)) out.push(rel)
  }
  return out
}

// ---------- 清理清单（与清理方案 §3 一致） ----------

const REMOVED_FILES = [
  'frontend/src/views/SiteEvaluationView.vue',
  'frontend/src/components/map/SiteScoringDialog.vue',
  'frontend/src/components/map/StoreScoreSheet.vue',
  'frontend/src/components/map/CandidateListPanel.vue',
  'backend/src/routes/scoring.js',
  'backend/src/routes/store-scores.js',
  'backend/src/utils/scoringEngine.js'
]

const REMOVED_TABLES = [
  'scoring_configs', 'site_candidates', 'scoring_templates',
  'scoring_items', 'store_scores', 'score_details'
]

// ============================================================================
// A. requireAdmin 中间件行为（迁移自 hiddenRoutesAdminGuard.test.js 的 A 组）
// ============================================================================

describe('A. requireAdmin 中间件（与资产去留无关，独立有效）', () => {
  function fakeRes() {
    return { statusCode: null, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
  }

  it('① req.user 缺失（漏挂 authenticate）→ 403 而非 TypeError/500', () => {
    const res = fakeRes()
    let nexted = false
    requireAdmin({}, res, () => { nexted = true })
    expect(nexted).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it('② role=user → 403', () => {
    const res = fakeRes()
    let nexted = false
    requireAdmin({ user: { id: 2, role: 'user' } }, res, () => { nexted = true })
    expect(nexted).toBe(false)
    expect(res.statusCode).toBe(403)
  })

  it('③ role=admin → 放行', () => {
    const res = fakeRes()
    let nexted = false
    requireAdmin({ user: { id: 1, role: 'admin' } }, res, () => { nexted = true })
    expect(nexted).toBe(true)
    expect(res.statusCode).toBeNull()
  })
})

// ============================================================================
// B. 7 个源文件必须已删除
// ============================================================================

describe('B. 清理面：7 个源文件必须不存在', () => {
  for (const f of REMOVED_FILES) {
    it(`已删：${f}`, () => {
      expect(
        fs.existsSync(path.join(REPO_ROOT, f)),
        `${f} 又出现了 —— 若是有意恢复，请先读 Report4biz_隐藏资产清理方案_20261016.md（恢复即重新暴露 R1）`
      ).toBe(false)
    })
  }
})

// ============================================================================
// C. 后端挂载与 import 不得残留
// ============================================================================

describe('C. app.js：两族路由的 import 与挂载行必须已移除', () => {
  const appSrc = stripComments(read('backend/src/app.js'))

  it('④ 无 scoringRoutes / storeScoresRoutes 的 import', () => {
    expect(appSrc, "仍 import './routes/scoring.js'").not.toMatch(/from\s*'\.\/routes\/scoring\.js'/)
    expect(appSrc, "仍 import './routes/store-scores.js'").not.toMatch(/from\s*'\.\/routes\/store-scores\.js'/)
    expect(appSrc, 'app.js 仍存在 scoringRoutes 标识').not.toContain('scoringRoutes')
    expect(appSrc, 'app.js 仍存在 storeScoresRoutes 标识').not.toContain('storeScoresRoutes')
  })

  it('⑤ 无 /api/scoring 与 /api/store-scores 的 app.use 挂载行', () => {
    expect(appSrc, '仍挂载 /api/scoring').not.toMatch(/app\.use\(\s*'\/api\/scoring'/)
    expect(appSrc, '仍挂载 /api/store-scores').not.toMatch(/app\.use\(\s*'\/api\/store-scores'/)
    // 反向对照：别的挂载行必须还在（否则说明断言写宽了、恒真）
    expect(appSrc, '反向对照失败：/api/districts 应仍在').toMatch(/app\.use\(\s*'\/api\/districts'/)
  })
})

// ============================================================================
// D. database.js 的 6 张表 DDL 必须已移除
// ============================================================================

describe('D. database.js：6 张死表的 DDL 必须已移除', () => {
  const dbSrc = stripComments(read('backend/src/models/database.js'))

  for (const t of REMOVED_TABLES) {
    it(`DDL 已删：${t}`, () => {
      expect(
        dbSrc,
        `database.js 仍有 CREATE TABLE IF NOT EXISTS ${t} —— 新部署会被重新建表`
      ).not.toContain(`CREATE TABLE IF NOT EXISTS ${t} (`)
    })
  }

  it('⑨ 反向对照：核心表 DDL 必须仍在（防断言写宽成恒真）', () => {
    for (const keep of ['users', 'markers', 'competitors']) {
      expect(dbSrc, `反向对照失败：${keep} 的 DDL 应当仍在`).toContain(`CREATE TABLE IF NOT EXISTS ${keep} (`)
    }
  })
})

// ============================================================================
// E. 全仓不得残留悬空引用（剥注释后判）
// ============================================================================

describe('E. 悬空引用清扫（剥注释后判，⛔ 注释里的"历史说明"不算违规）', () => {
  const BACKEND_TOKENS = /scoringEngine|site_candidates|score_details|scoreLocation|scoreBatch/
  const TEST_TOKENS = /scoringEngine|site_candidates|score_details|SiteEvaluationView/
  const FRONTEND_TOKENS = /scoringEngine|site_candidates|score_details|SiteEvaluationView/

  it('⑩ backend/src 无悬空引用', () => {
    const bad = []
    for (const rel of walk('backend/src')) {
      if (BACKEND_TOKENS.test(stripComments(read(rel)))) bad.push(rel)
    }
    expect(bad, `backend/src 仍有对已清理资产的引用：${bad.join(', ')}`).toEqual([])
  })

  it('⑪ backend/tests 无悬空引用（跳过本文件自身）', () => {
    const bad = []
    for (const rel of walk('backend/tests')) {
      if (path.join(REPO_ROOT, rel) === SELF) continue
      if (TEST_TOKENS.test(stripComments(read(rel)))) bad.push(rel)
    }
    expect(bad, `backend/tests 仍有对已清理资产的引用：${bad.join(', ')}`).toEqual([])
  })

  it('⑫ frontend/src 无悬空引用', () => {
    const bad = []
    for (const rel of walk('frontend/src')) {
      if (FRONTEND_TOKENS.test(stripComments(read(rel)))) bad.push(rel)
    }
    expect(bad, `frontend/src 仍有对已清理资产的引用：${bad.join(', ')}`).toEqual([])
  })
})

// ============================================================================
// F. 前端路由与入口页
// ============================================================================

describe('F. 前端：路由不得复活，且必须留下"已清理"说明', () => {
  const routerRaw = read('frontend/src/router/index.js')
  const routerSrc = stripComments(routerRaw)

  it('⑬ 剥注释后不得再有 site-evaluation 路由', () => {
    expect(routerSrc, "router 里 site-evaluation 路由复活了").not.toContain("path: 'site-evaluation'")
    expect(routerSrc, 'router 里仍 import SiteEvaluationView').not.toContain('SiteEvaluationView')
  })

  it('⑭ 原注释位必须留下「已清理」标记（防后人只看到一片空白）', () => {
    expect(
      routerRaw,
      'router/index.js 丢失了 v1.13.231 的「已清理」说明 —— 后人会不知道这一族为何消失'
    ).toContain('v1.13.231')
  })

  it('⑮ index.html 不再引用 SiteEvaluationView', () => {
    expect(read('frontend/index.html'), 'index.html 注释里仍列举 SiteEvaluationView').not.toContain('SiteEvaluationView')
  })
})

// ============================================================================
// G. 自检（211 教训：剥注释的检查器必须自证不吞代码、不恒真）
// ============================================================================

describe('G. 守卫自检', () => {
  it('⑯ stripComments 只剥注释、不吞代码', () => {
    const sample = [
      '// scoringEngine=注释里',
      '/* scoringEngine=块注释 */',
      "const keep = 'scoringEngine=真实代码'",
    ].join('\n')
    const out = stripComments(sample)
    expect(out.includes('// scoringEngine'), 'stripComments 未剥掉行注释').toBe(false)
    expect(
      (out.match(/scoringEngine/g) || []).length,
      'stripComments 自检失败：注释未被剥净，或把真实代码一起剥掉了'
    ).toBe(1)
  })

  it('⑯b 剥注释后体积不得低于原始 60%（防「静默吃代码」的兜底红线）', () => {
    // 立档：本批初版 stripComments 因顺序错误，把 app.js 吃掉了 3,180 字符（约 38%）
    // ⇒ 单靠「拿某一行断言它还在」只能守住**已知**的锚点，故补一条**体积**红线：
    //   若未来某文件的字符串/注释再次诱骗正则吞掉代码，本条会先红。
    for (const rel of [
      'backend/src/app.js',
      'backend/src/models/database.js',
      'frontend/src/router/index.js'
    ]) {
      const raw = read(rel)
      const stripped = stripComments(raw)
      const ratio = stripped.length / raw.length
      expect(
        ratio,
        `${rel} 剥注释后仅剩 ${(ratio * 100).toFixed(1)}% —— 极可能是块注释正则吞掉了真实代码（211 教训）`
      ).toBeGreaterThan(0.6)
    }
  })
})
