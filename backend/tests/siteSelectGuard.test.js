/**
 * 智能选址 · 源码守卫与负变异（v1.13.370 / 批次 370）
 *
 * ── 为什么要有这个文件 ─────────────────────────────────────────────────
 * 这个功能每次点击都在烧**真金白银**的联通配额，而且有四个错法「能跑通、不报错、只是结果错」：
 *   ① 饱和剔除放到付费之后 ⇒ 对注定出局的点白买人口数据
 *   ② 粗排分透出去       ⇒ 用户看到「初筛第 1、最终第 8」无法解释
 *   ③ 网格读错字段       ⇒ 全城点位恒低档，界面看不出来
 *   ④ preciseTopK 信前端 ⇒ 单次成本上限失效
 * 代码评审挡不住这四类，必须靠断言。
 *
 * ── 断言写法的三条教训（都是本项目踩过的）──────────────────────────────
 * ① `includes(选择器)` 是假绿灯 —— `.foo-X` 也会命中。要匹配完整规则头/完整表达式。
 * ② 注释会误命中 —— 解释性注释里写了旧写法，守卫会假红。必须先剥注释。
 * ③ 只断言「函数被调用」不够 —— `if (false && fn())` 会骗过。要连条件一起断言。
 *
 * ── 负变异 ─────────────────────────────────────────────────────────────
 * 每个守卫都配一次「故意改坏」，确认 audit() 会返回问题。
 * 这一步不做，守卫只是一段永远为真的代码。
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/**
 * 剥掉 JS 注释（保护字符串/模板串里的 `//`）。
 * ⚠️ 不能用裸正则 `/\*[\s\S]*?\*\//` 一把梭：字符串里出现 `/*` 会静默吃掉后面的代码
 *    （项目在 211 批次踩过，守卫因此报假红）。
 */
function stripJsComments(src) {
  let out = ''
  let i = 0
  let state = 'code'
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') { state = c === "'" ? 'single' : c === '"' ? 'double' : 'template'; out += c; i++; continue }
      out += c; i++; continue
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c } i++; continue }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i += 2; continue } i++; continue }
    // 字符串内部：原样保留，处理转义
    out += c
    if (c === '\\') { out += n || ''; i += 2; continue }
    if (state === 'single' && c === "'") state = 'code'
    else if (state === 'double' && c === '"') state = 'code'
    else if (state === 'template' && c === '`') state = 'code'
    i++
  }
  return out
}

/** 剥 HTML 注释（模板里解释性注释会误命中导航项计数之类的断言） */
function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '')
}

function loadAll() {
  return {
    siteSelect: stripJsComments(read('backend/src/routes/site-select.js')),
    gridPop: stripJsComments(read('backend/src/utils/gridPopulation.js')),
    config: stripJsComments(read('backend/src/utils/siteSelectConfig.js')),
    score: stripJsComments(read('backend/src/utils/siteScore.js')),
    mainLayout: stripHtmlComments(read('frontend/src/views/MainLayout.vue')),
    router: read('frontend/src/router/index.js'),
    // ⚠️ 模板与脚本都要剥注释：代码里有一行「② 不展示粗排分」的说明性注释，
    //    不剥会误判成「前端引用了粗排分」（本项目踩过多次的假红）。
    view: stripJsComments(stripHtmlComments(read('frontend/src/views/SiteSelectView.vue'))),
    i18nZh: read('frontend/src/i18n/locales/zh.js'),
    i18nEn: read('frontend/src/i18n/locales/en.js'),
    i18nJa: read('frontend/src/i18n/locales/ja.js'),
    smartsteps: stripJsComments(read('backend/src/routes/smartsteps.js'))
  }
}

/**
 * 全部不变量检查。返回问题列表（空数组 = 全部通过）。
 * 变异测试直接复用这个函数 —— 保证「正常代码全绿」与「改坏必红」用的是同一套断言。
 */
function audit(f) {
  const problems = []
  const bad = (code, msg) => problems.push(`${code}: ${msg}`)

  // ── A. 饱和剔除必须在付费之前 ──────────────────────────────────────
  const iCoarseCall = f.siteSelect.indexOf('const coarse = runCoarse(')
  const iFetchCall = f.siteSelect.indexOf('await fetchPointPopulation(')
  if (iCoarseCall < 0) bad('A1', 'rank 未调用 runCoarse')
  if (iFetchCall < 0) bad('A2', 'rank 未调用 fetchPointPopulation')
  if (iCoarseCall >= 0 && iFetchCall >= 0 && iCoarseCall > iFetchCall) {
    bad('A3', 'runCoarse 在精算之后才调用 —— 饱和剔除会变成「对注定出局的点白买人口」')
  }

  const fnStart = f.siteSelect.indexOf('function runCoarse(')
  const fnEnd = f.siteSelect.indexOf('function computeCompetition(')
  const runCoarseBody = fnStart >= 0 && fnEnd > fnStart ? f.siteSelect.slice(fnStart, fnEnd) : ''
  if (!runCoarseBody) bad('A4', '找不到 runCoarse 函数体')
  if (runCoarseBody) {
    if (runCoarseBody.includes('fetchPointPopulation')) bad('A5', 'runCoarse 内出现联通取数 —— 免费阶段不允许产生任何配额消耗')
    if (runCoarseBody.includes('checkQuota')) bad('A6', 'runCoarse 内出现配额闸门调用 —— 免费阶段不需要也不应该校验')
    if (!/satCount\s*>=\s*p\.saturation\.maxOwn/.test(runCoarseBody)) bad('A7', '缺少饱和门限判定')
    if (!/saturatedDropped\+\+/.test(runCoarseBody)) bad('A8', '饱和剔除未计数（必须回传 saturatedDropped）')
    if (!/saturatedSamples/.test(runCoarseBody)) bad('A9', '饱和剔除未给样本（前 3 个坐标）')
  }

  // ── B. 粗分绝不外泄 ───────────────────────────────────────────────
  // 键形式（`roughScore:`）才是透出；赋值（`roughScore =`）是内部使用，允许。
  if (/(^|[\s,{])roughScore\s*:/m.test(f.siteSelect)) bad('B1', '响应/对象里以键形式出现了 roughScore')
  if (/stage1Rank/.test(f.siteSelect)) bad('B2', '出现 stage1Rank（内部名次不可外泄）')
  if (/roughScore|stage1Rank|粗排分/.test(f.view)) bad('B3', '前端引用了粗排分（会出现「初筛第 1、最终第 8」的困惑）')

  // ── C. 网格只读「常住人口」────────────────────────────────────────
  if (!/GRID_POP_FIELD\s*=\s*'常住人口'/.test(f.gridPop)) bad('C1', '网格人口字段名不是「常住人口」')
  for (const wrong of ['居住人数', '工作人数', '富人人数', '中产人数', '低收入人数', '到访人次']) {
    if (f.gridPop.includes(wrong)) bad('C2', `网格代码里出现了商圈字段「${wrong}」—— 网格没有这个字段，读了恒 0 且不报错`)
  }

  // ── D. preciseTopK 服务端 clamp ───────────────────────────────────
  if (!/clampInt\(src\.preciseTopK,\s*PRECISE_TOPK\.default,\s*PRECISE_TOPK\.min,\s*PRECISE_TOPK\.max\)/.test(f.siteSelect)) {
    bad('D1', 'preciseTopK 未走服务端 clamp（⛔ 不能信前端传值，这是单次成本上限）')
  }
  if (!/max:\s*100/.test(f.config)) bad('D2', '配置里没有 preciseTopK 上限 100')

  // ── E. 无网格必须退化、不能拒绝 ───────────────────────────────────
  if (runCoarseBody && /res\.status\(\s*400/.test(runCoarseBody)) bad('E1', 'runCoarse 内出现 400 —— 无网格城市必须退化为三维，⛔ 不允许拒绝请求')
  if (!/初筛按 3 个维度进行/.test(f.siteSelect)) bad('E2', '缺少无网格城市的用户提示（顶部横幅文案）')
  if (!/crowdSource\s*=\s*'none'/.test(f.siteSelect)) bad('E3', '无网格时未把 crowdSource 置为 none')

  // ── F. 三处角色门禁 ───────────────────────────────────────────────
  for (const route of ['/rank', '/estimate']) {
    const re = new RegExp(`router\\.post\\('${route}',\\s*authenticate,\\s*requireAdmin`)
    if (!re.test(f.siteSelect)) bad('F1', `${route} 未挂 requireAdmin（343 的教训：只管可见不管可用）`)
  }
  if (!/path:\s*'site-select'/.test(f.router)) bad('F2', '路由未注册 /site-select')
  if (!/name:\s*'SiteSelect'[\s\S]{0,200}requiresAdmin:\s*true/.test(f.router)) bad('F3', '路由 meta 缺 requiresAdmin')
  // 菜单项必须在 isAdmin 条件下（取该项前后各 200 字符，避免命中别的 v-if）
  const navIdx = f.mainLayout.indexOf("$route.path === '/site-select'")
  if (navIdx < 0) bad('F4', '菜单里没有智能选址项')
  else {
    const near = f.mainLayout.slice(Math.max(0, navIdx - 260), navIdx + 40)
    if (!/v-if="userStore\.isAdmin"/.test(near)) bad('F5', '菜单项未受 userStore.isAdmin 控制')
  }
  for (const [name, src] of [['zh', f.i18nZh], ['en', f.i18nEn], ['ja', f.i18nJa]]) {
    if (!/siteSelect\s*:/.test(src)) bad('F6', `${name} 缺 nav.siteSelect 词条`)
  }

  // ── G. 配额安全 ───────────────────────────────────────────────────
  const iPool = f.siteSelect.indexOf('const remainingBefore = getPoolRemaining(db)')
  if (iPool < 0) bad('G1', 'rank 未做物理池前置校验（管理员走 checkQuota 免账号额度 ⇒ 会直接烧池）')
  if (iPool >= 0 && iFetchCall >= 0 && iPool > iFetchCall) bad('G2', '前置池校验在精算之后 —— 等于开跑才发现没余额')
  if (/Promise\.all\([\s\S]{0,200}?fetchPointPopulation/.test(f.siteSelect)) bad('G3', '并发打联通（必须串行，避免限流与配额竞争）')
  if (!/crowdDropped\+\+/.test(f.siteSelect)) bad('G4', '单点失败未计数（必须回传 crowdDropped，⛔ 静默丢弃）')
  // 单点失败后必须 continue；不许出现重试循环
  if (/while\s*\([^)]*retry/i.test(f.siteSelect)) bad('G5', '出现重试循环（单点失败不重试，避免配额翻倍）')
  if (!/remainingBefore < needFromPool/.test(f.siteSelect)) bad('G6', '池校验未与实际需要的次数比较')

  // ── H. 联通取数链路单一来源 ───────────────────────────────────────
  if (!/export async function fetchPointPopulation/.test(f.smartsteps)) bad('H1', 'smartsteps 未导出 fetchPointPopulation')
  if (/openApi\/getData/.test(f.siteSelect)) bad('H2', 'site-select 自己写了 getData 调用（⛔ 会绕过缓存命中与配额闸门）')
  if (!/from '\.\/smartsteps\.js'/.test(f.siteSelect)) bad('H3', 'site-select 未复用 smartsteps 的取数函数')

  // ── I. 评估半径必须落在联通面积约束内 ─────────────────────────────
  for (const r of [500, 1000, 1500, 3000]) {
    if (!new RegExp(`\\b${r}\\b`).test(f.config)) bad('I1', `配置缺半径 ${r}`)
  }
  // ⚠️ 必须匹配 `if (!...)` 的完整条件：只断言「函数被调用」会被 `if (false && ...)` 骗过。
  if (!/if\s*\(\s*!SITE_RADIUS_CHOICES\.includes\(radius\)\s*\)/.test(f.siteSelect)) bad('I2', '半径未按白名单校验')

  // ── L. 结果表固定列必须只在宽屏启用 ───────────────────────────────
  // 390px 实测：裸 `fixed="right"` 会让固定列压住「圆内人口」列右侧的
  // 「万人 / 占 31%（代理）」——表格看着能横向滑，但被压住的那 40px 永远滑不出来，
  // 用户读到的是半截数字。⛔ 改回裸属性即视为回归。
  if (/\sfixed="right"/.test(f.view)) {
    bad('L1', '结果表用了裸 fixed="right" —— 窄屏会压住人口列数字，必须绑定 :fixed="isNarrow ? false : \'right\'"')
  }
  if (!/:fixed="isNarrow \? false : 'right'"/.test(f.view)) bad('L2', '结果表固定列未按窄屏切换')
  if (!/max-width:\s*900px/.test(f.view)) bad('L3', '缺 900px 窄屏判断（isNarrow 与 @media 断点必须一致）')

  return problems
}

describe('A–I. 智能选址源码守卫', () => {
  const files = loadAll()

  it('正常代码必须全绿（0 个问题）', () => {
    const problems = audit(files)
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('剥注释工具本身不能把字符串里的 // 当注释（否则会误吃代码）', () => {
    const sample = "const a = 'https://x/y'\n// 注释里的 fetchPointPopulation\nconst b = 1"
    const out = stripJsComments(sample)
    expect(out).toContain("'https://x/y'")
    expect(out).not.toContain('注释里')
    expect(out).toContain('const b = 1')
  })
})

describe('J. 负变异：改坏必须报红', () => {
  const base = loadAll()
  const mutate = (patch) => {
    const f = { ...base, ...patch }
    return audit(f)
  }

  it('M1 把联通取数塞进 runCoarse（免费阶段开始花钱）', () => {
    const body = base.siteSelect.replace(
      'function runCoarse(db, user, p) {',
      'function runCoarse(db, user, p) {\n  void fetchPointPopulation;'
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('A5'))).toBe(true)
  })

  it('M2 把粗排分以键形式写进响应', () => {
    const body = base.siteSelect.replace(
      'rank: idx + 1,',
      'rank: idx + 1,\n        roughScore: it.score,'
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('B1'))).toBe(true)
  })

  it('M3 网格改用商圈字段「居住人数」', () => {
    const body = base.gridPop.replace(
      'export const GRID_POP_FIELD = ',
      "const WRONG = '居住人数'\nexport const GRID_POP_FIELD = "
    )
    expect(mutate({ gridPop: body }).some((p) => p.startsWith('C2'))).toBe(true)
  })

  it('M4 preciseTopK 直接用前端传值（去掉 clamp）', () => {
    const body = base.siteSelect.replace(
      'preciseTopK: clampInt(src.preciseTopK, PRECISE_TOPK.default, PRECISE_TOPK.min, PRECISE_TOPK.max)',
      'preciseTopK: Number(src.preciseTopK)'
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('D1'))).toBe(true)
  })

  it('M5 无网格城市直接 400 拒绝', () => {
    const body = base.siteSelect.replace(
      "crowdSource = 'none'",
      "crowdSource = 'none'; return res.status(400).json({});"
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('E1'))).toBe(true)
  })

  it('M6 菜单去掉管理员判断', () => {
    const body = base.mainLayout.replace(
      '<el-dropdown-item v-if="userStore.isAdmin" :class="{ \'dd-active\': $route.path === \'/site-select\' }"',
      '<el-dropdown-item :class="{ \'dd-active\': $route.path === \'/site-select\' }"'
    )
    expect(mutate({ mainLayout: body }).some((p) => p.startsWith('F5'))).toBe(true)
  })

  it('M7 路由去掉 requiresAdmin', () => {
    const body = base.router.replace(
      "meta: { requiresAdmin: true, titleKey: 'nav.siteSelect' }",
      "meta: { titleKey: 'nav.siteSelect' }"
    )
    expect(mutate({ router: body }).some((p) => p.startsWith('F3'))).toBe(true)
  })

  it('M8 并发打联通', () => {
    const body = base.siteSelect.replace(
      'const precise = []',
      'const precise = []\n    await Promise.all(preciseList.map((x) => fetchPointPopulation(db, user, x)))'
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('G3'))).toBe(true)
  })

  it('M9 单点失败静默丢弃不计数', () => {
    const body = base.siteSelect.replaceAll('crowdDropped++', 'void 0')
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('G4'))).toBe(true)
  })

  it('M10 site-select 自己写 getData（绕过缓存与闸门）', () => {
    const body = base.siteSelect.replace(
      'import { fetchPointPopulation } from',
      "const openApiUrl = '/server/openApi/getData'\nimport { fetchPointPopulation } from"
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('H2'))).toBe(true)
  })

  it('M11 前置池校验挪到精算之后', () => {
    const body = base.siteSelect
      .replace('const remainingBefore = getPoolRemaining(db)', 'const remainingBefore = 0')
      .replace('const need = preciseList.length', 'const need = preciseList.length;\n    const latePool = getPoolRemaining(db); void latePool;')
    const problems = mutate({ siteSelect: body })
    expect(problems.some((p) => p.startsWith('G1'))).toBe(true)
  })

  it('M12 半径不按白名单校验（用户可传 50000 米）', () => {
    const body = base.siteSelect.replace(
      'if (!SITE_RADIUS_CHOICES.includes(radius)) {',
      'if (false && !SITE_RADIUS_CHOICES.includes(radius)) {'
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('I2'))).toBe(true)
  })

  it('M13 饱和不计数（静默丢弃，界面看不出少算了）', () => {
    const body = base.siteSelect.replace('saturatedDropped++', 'void 0')
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('A8'))).toBe(true)
  })

  it('M14 结果表把固定列改回裸属性（窄屏压住人口列数字）', () => {
    const body = base.view.replace(
      `:fixed="isNarrow ? false : 'right'"`,
      'fixed="right"'
    )
    expect(mutate({ view: body }).some((p) => p.startsWith('L1'))).toBe(true)
  })
})

describe('K. 接口约定（前端 ←→ 后端字段名必须一致）', () => {
  const files = loadAll()

  it('前端读取的响应字段都在后端返回里（防拼写漂移）', () => {
    const backendKeys = [
      'gridTotal', 'gridCovered', 'coarseCrowdSource', 'regionMedianPop',
      'saturatedDropped', 'crowdDropped', 'returned', 'warnings',
      'quota', 'weights', 'coverage', 'missingDims', 'items'
    ]
    for (const k of backendKeys) {
      expect(files.siteSelect).toContain(k)
    }
    const viewKeys = ['result.gridTotal', 'result.saturatedDropped', 'result.crowdDropped', 'result.missingDims']
    for (const k of viewKeys) {
      expect(files.view).toContain(k)
    }
  })

  it('前端不读 `roughScore` / `stage1Rank` / `coarsePopulation`（已删字段）', () => {
    expect(files.view).not.toContain('coarsePopulation')
  })

  it('存为候选必须带 source=site-select（否则回看不知道点位从哪来）', () => {
    expect(files.view).toContain("source: 'site-select'")
  })

  it('支付前必明：前端必须先调 estimate 再调 rank', () => {
    const iEst = files.view.indexOf('/api/site-select/estimate')
    const iRank = files.view.indexOf('/api/site-select/rank')
    expect(iEst).toBeGreaterThan(-1)
    expect(iRank).toBeGreaterThan(iEst)
    // estimate 的返回值必须被拼进确认弹窗
    expect(files.view).toContain('预计消耗')
  })
})
