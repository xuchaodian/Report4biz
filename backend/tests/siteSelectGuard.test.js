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
    // 撒点（格心绝对网格对齐）+ 复用判据（零依赖，测试 mock smartsteps 也不受影响）
    potentialGrid: stripJsComments(read('backend/src/utils/potentialGrid.js')),
    reuseKey: stripJsComments(read('backend/src/utils/reuseKey.js')),
    config: stripJsComments(read('backend/src/utils/siteSelectConfig.js')),
    score: stripJsComments(read('backend/src/utils/siteScore.js')),
    database: stripJsComments(read('backend/src/models/database.js')),
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
    // 🔴 空门店集必须报警：否则「本账号 0 家门店」会让饱和保护与自牌维度静默不生效，
    //    而界面只看到 saturatedDropped: 0 —— 看起来像「查过了、没有饱和」。
    if (!/本账号名下没有门店数据/.test(runCoarseBody)) bad('A10', '门店集为空时未给 warning（饱和保护会静默失效）')
    // 🔴🔴 自有门店必须按账号过滤（老板 11-17 拍板：维持 A 案，绝不跨用户聚合）。
    //    诱因：管理员名下 0 家门店时饱和/自牌两维恒未评，后人很容易「为了让维度生效」
    //    改成按品牌取全平台门店 —— 那是跨用户读门店，违反隐私红线。
    //    ⚠️ 断言完整 SQL 条件，只断言「含 user_id」会被 `WHERE user_id = ? OR 1=1` 骗过。
    if (!/FROM markers WHERE user_id = \? AND merged_into IS NULL/.test(f.siteSelect)) {
      bad('A11', '自有门店未按账号过滤（跨用户聚合门店违反隐私红线）')
    }
    // 🔴🔴 A2 必须是「到访活跃」，⛔ 不能退回话费代理（业主 2026-11-17 拍板 A 案）。
    //    话费档的分母是联通在网用户（不是全人口），且受家庭共享套餐/企业报销/
    //    老年低话费高资产三重误判 ⇒ 不配 10 分权重。见 §6.128.15。
    if (!/const a2 = visitScore\(pop\?\.visit\)/.test(f.siteSelect)) {
      bad('A12', '精算 A2 未使用到访活跃（visitScore）')
    }
    // ⚠️ 只拦 arpuScore（纯评分函数）；arpuHighPct 仍允许出现 —— 它只做展示参考。
    if (/arpuScore\s*\(/.test(f.siteSelect)) {
      bad('A12', '精算仍在调用 arpuScore —— 话费代理不得参与评分')
    }
    if (!/SITE_CROWD_SUB = Object\.freeze\(\{\s*size:\s*20,\s*visit:\s*10\s*\}\)/.test(f.config)) {
      bad('A12', 'SITE_CROWD_SUB 子权重不是 size:20 + visit:10')
    }
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
  // 🔴 v1.13.372（业主 2026-11-17）：上限 100 → 50。这个数就是「一次误操作最坏能烧多少」。
  //    ⚠️ 断言完整对象字面量：只匹配 `max: 50` 会被别的配置（如 SATURATION_RANGE）蒙混。
  if (!/PRECISE_TOPK = Object\.freeze\(\{\s*default:\s*30,\s*min:\s*10,\s*max:\s*50\s*\}\)/.test(f.config)) {
    bad('D2', 'preciseTopK 上限不是 50 —— 一次误操作的最坏损失失去天花板')
  }

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

  // ── P. 高消耗熔断（业主 2026-11-17 要求）────────────────────────────
  // 这一组守的是「单次能烧多少」的最后一道闸。三个错法都能跑通、界面不报错：
  //   ① 熔断放在 fetchPointPopulation 之后 ⇒ 先扣钱再拦人
  //   ② 只判 confirmBurn 非空           ⇒ 输个 1 也能过，确认变摆设
  //   ③ 前端自己硬编码阈值              ⇒ 后端调了阈值，用户点完确认仍被 400
  if (!/SITE_BURN_CONFIRM = 30/.test(f.config)) {
    bad('P1', '缺 SITE_BURN_CONFIRM = 30（默认精算点数即为确认阈值）')
  }
  const iBurn = f.siteSelect.indexOf('if (needFromPool > SITE_BURN_CONFIRM && p.confirmBurn !== needFromPool)')
  if (iBurn < 0) bad('P2', 'rank 缺少高消耗熔断判断')
  // ⚠️ 必须比 `===`，不能只判「有值」：用户输 40 而实际 45 时放行 = 确认失效
  if (!/p\.confirmBurn !== needFromPool/.test(f.siteSelect)) {
    bad('P3', '熔断未校验 confirmBurn === 实际消耗次数（只判非空会被任意数字骗过）')
  }
  if (iBurn >= 0 && iFetchCall >= 0 && iBurn > iFetchCall) {
    bad('P4', '熔断在精算之后 —— 等于先扣完配额才拦人')
  }
  if (iBurn >= 0 && iPool >= 0 && iBurn < iPool) {
    bad('P5', '熔断早于余额校验 —— 余额不足时会让用户先输一遍数字再被告知没钱')
  }
  if (!/burn_confirm_required/.test(f.siteSelect)) bad('P6', '缺 burn_confirm_required 错误码')
  if (!/burnRequired:\s*needFromPool > SITE_BURN_CONFIRM/.test(f.siteSelect)) {
    bad('P7', 'estimate 未回传 burnRequired —— 前端无从知道要不要弹输入框')
  }
  if (!/burnCount:\s*needFromPool/.test(f.siteSelect)) {
    bad('P7', 'estimate 未回传 burnCount（要用户输入的那个数字）')
  }
  // 前端：阈值与次数一律读接口，⛔ 不硬编码 30
  if (!/d\.burnRequired/.test(f.view)) {
    bad('P8', '前端未按接口 burnRequired 分流（硬编码阈值会与后端漂移 → 点确认仍被 400）')
  }
  if (!/payload\(confirmBurn\)/.test(f.view)) bad('P9', '前端未把 confirmBurn 带给 rank')
  // ⚠️ 必须锚定 preciseTopK 那个输入框：`topN` 的上限也是 50，只写 `:max="50"` 会假绿
  if (!/v-model="form\.preciseTopK"[^>]*:max="50"/.test(f.view)) {
    bad('P10', '前端精算点数输入框上限不是 50')
  }
  if (!/Number\(value\) !== need/.test(f.view)) {
    bad('P11', '前端未校验用户输入与本次消耗一致（输入框变成摆设）')
  }
  // 🔴 库不自包含的坑：现网 shapefiles.city 是手工补的，代码里从没建过它。
  //    少了这行迁移 ⇒ 新建库/灾备恢复后一选城市就 500（findGridRow 的 SELECT 带 city）。
  if (!/ALTER TABLE shapefiles ADD COLUMN city TEXT/.test(f.database)) {
    bad('P12', 'database.js 缺 shapefiles.city 迁移 —— 新建库/灾备库一选城市就 500')
  }

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

  // ── N. 「预估消耗」0 消耗，必须始终可达 ─────────────────────────────
  // 生产实测：物理池余额 0 时，若 canRun 带 `remaining > 0`，按钮直接灰掉 ⇒
  // 用户连「要花几次」都看不到，也就不知道该采购多少。
  const canRunDef = f.view.match(/const canRun = computed\(\(\) =>[^\n]*/)
  if (!canRunDef) bad('N1', '找不到 canRun 定义')
  else if (/remaining\.value\s*>\s*0/.test(canRunDef[0])) {
    bad('N1', 'canRun 把余额当门禁 —— 余额 0 时「预估消耗」会灰掉，用户看不到缺口')
  }
  if (!/还差 \$\{needPool - left\} 次/.test(f.view)) bad('N2', '余额不足时未告知缺口（应明确「还差 Z 次」并拦住 rank）')

  // ── Q. 重复付费防护（批次 373，业主 2026-11-17 要求）──────────────────
  // 业主原话：「我地图上勾画了徐家汇范围，这个范围内我已经买过 2 个位置的联通人口数据」
  // —— 旧实现里这笔钱一分吃不到。以下每一条都是「删掉就白花钱」的代码。
  //
  // Q1 已购点必须按**本账号**取。跨账号取已购数据＝踩隐私红线（同 A11 的口径）。
  //    ⚠️ 必须切片到函数体内断言：`probeReusable` 里**也有**一段
  //    `FROM purchases ... WHERE user_id = ?`，扫全文会让变异应用在第一处、
  //    而正则被第二处满足 ⇒ 负变异 M31 报假绿。
  const mpStart = f.siteSelect.indexOf('function mergePurchasedPoints(')
  const mpEnd = f.siteSelect.indexOf('function runCoarse(')
  const mpBody = mpStart >= 0 && mpEnd > mpStart ? f.siteSelect.slice(mpStart, mpEnd) : ''
  if (!mpBody) {
    bad('Q1', '缺 mergePurchasedPoints —— 框内已购点无法并入候选，花过的钱吃不到')
  } else if (!/FROM purchases[\s\S]{0,200}WHERE user_id = \?/.test(mpBody)) {
    bad('Q1', '已购点未按当前账号过滤（跨用户读已购数据违反隐私红线）')
  }
  // Q2 半径必须校验：半径是缓存 key 的一部分，不匹配就必然重新扣费。
  //    不校验会把「注定花钱的点」当免费点并入，反而误导用户。
  if (!/if \(!radiusIncludes\(row\.radius, radius\)\) continue/.test(mpBody)) {
    bad('Q2', '已购点并入时未校验半径 —— 会把注定重新扣费的点当成免费点')
  }
  // Q3 「最后一公里」：格距 1000m、minGapM 800m ⇒ 任何非格心点都会被第一层 NMS 剔掉。
  //    没有这段追加，已购点并进来了却进不了精算，B 方案等于白做。
  //    ⚠️ 必须断言 `nms(purchasedSurvivors`：只判 `purchasedSurvivors` 存在会被
  //    「声明了但循环写成空数组」骗过（负变异 M29 就是这种改法）。
  if (!/nms\(purchasedSurvivors, p\.minGapM\)/.test(f.siteSelect) || !/preciseList\.push\(c\)/.test(f.siteSelect)) {
    bad('Q3', '已购点未追加进 preciseList —— 会被 NMS 整批剔掉，并入也白并')
  }
  // Q4 经向步长的参考纬度必须**量化到整度**。用 bbox 的 midLat 会让框高变化连带改变
  //    经度步长 ⇒ 纬度对齐了经度又错开（这是最隐蔽的一种失真，负变异 M27 专门测它）。
  const grid = f.potentialGrid || ''
  if (!/const refLat = Math\.round\(midLat\)/.test(grid)) {
    bad('Q4', '经向步长的参考纬度未量化到整度 —— 框高变化会连带改变经度步长，格心对不齐')
  }
  // Q5 格心必须是绝对网格的整格倍数（⛔ 写成 `w + deg * (i + 0.5)` 就退回旧口径）
  if (!/\(\s*latK0\s*\+\s*j\s*\+\s*0\.5\s*\)\s*\*\s*degLat/.test(grid)) {
    bad('Q5', '格心未按绝对网格计算（纬度仍从 bbox 西南角起算 ⇒ 拖框差 100m 就整批重扣）')
  }
  if (!/\(\s*lngK0\s*\+\s*i\s*\+\s*0\.5\s*\)\s*\*\s*degLng/.test(grid)) {
    bad('Q5', '格心未按绝对网格计算（经度仍从 bbox 西边界起算）')
  }
  // Q6 复用判据必须从零依赖文件取。从 smartsteps 命名导入会在「整模块被 mock」时
  //    变成 undefined —— `<= undefined` 恒 false、`radiusIncludes(...)` TypeError，
  //    两种都是**静默假绿**（本项目 373 批次真实踩过）。
  if (!/import \{ REUSE_TOL_M, radiusIncludes \} from '\.\.\/utils\/reuseKey\.js'/.test(f.siteSelect)) {
    bad('Q6', '复用判据未从 utils/reuseKey.js 取 —— 从 smartsteps 取会在测试 mock 后变 undefined（静默失效）')
  }
  // Q7 已购点会被**免费追加**进精算 ⇒ `preciseCount` 可能大于用户设的「精算点数」。
  //    界面不解释，用户会以为"我设 30 怎么精算了 45"。这条守住那句解释文案。
  if (!/d\.purchasedInBox/.test(f.view)) {
    bad('Q7', '前端未使用 purchasedInBox —— 精算数多于设定值时用户无从理解')
  }

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
    // ⚠️ 锚点⛔ 用 import 语句：那是会变的（373 给它加了 REUSE_TOL_M / radiusIncludes），
    //    一变负变异就静默失配、报"假绿"。改用永不变的文件骨架做锚点。
    const body = base.siteSelect.replace(
      'const router = express.Router()',
      "const openApiUrl = '/server/openApi/getData'\nconst router = express.Router()"
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

  it('M15 门店集为空时不报警（饱和保护与自牌维度静默失效）', () => {
    const body = base.siteSelect.replace('本账号名下没有门店数据', '（静默）')
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('A10'))).toBe(true)
  })

  it('M16 把余额塞回 canRun（余额 0 时预估按钮变灰）', () => {
    const body = base.view.replace(
      'const canRun = computed(() => bboxArea.value > 0 && bboxArea.value <= 400)',
      'const canRun = computed(() => bboxArea.value > 0 && bboxArea.value <= 400 && remaining.value > 0)'
    )
    expect(mutate({ view: body }).some((p) => p.startsWith('N1'))).toBe(true)
  })

  it('M17 余额不足时静默吞掉（不告诉用户还差几次）', () => {
    const body = base.view.replace('还差 ${needPool - left} 次', '余额不足')
    expect(mutate({ view: body }).some((p) => p.startsWith('N2'))).toBe(true)
  })

  it('M18 门店改按品牌取全平台（跨用户聚合，为了让饱和/自牌维度生效）', () => {
    const body = base.siteSelect.replace(
      'FROM markers WHERE user_id = ? AND merged_into IS NULL',
      'FROM markers WHERE brand = ? AND merged_into IS NULL'
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('A11'))).toBe(true)
  })

  it('M19 A2 退回话费代理（弱代理重新占 10 分权重）', () => {
    const body = base.siteSelect.replace(
      'const a2 = visitScore(pop?.visit)',
      'const a2 = arpuScore(arpuHighPct(pop))'
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('A12'))).toBe(true)
  })

  it('M20 子权重改回 arpu（配置层偷偷退回旧口径）', () => {
    const body = base.config.replace('{ size: 20, visit: 10 }', '{ size: 20, arpu: 10 }')
    expect(mutate({ config: body }).some((p) => p.startsWith('A12'))).toBe(true)
  })

  it('M21 删掉高消耗熔断（50 次点一下就走）', () => {
    const body = base.siteSelect.replace(
      'if (needFromPool > SITE_BURN_CONFIRM && p.confirmBurn !== needFromPool) {',
      'if (false) {'
    )
    const problems = mutate({ siteSelect: body })
    expect(problems.some((p) => p.startsWith('P2'))).toBe(true)
    expect(problems.some((p) => p.startsWith('P3'))).toBe(true)
  })

  it('M22 精算上限偷偷改回 100', () => {
    const body = base.config.replace('max: 50', 'max: 100')
    expect(mutate({ config: body }).some((p) => p.startsWith('D2'))).toBe(true)
  })

  it('M23 熔断只判 confirmBurn 非空（输个 1 也能过）', () => {
    const body = base.siteSelect.replace('p.confirmBurn !== needFromPool', '!p.confirmBurn')
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('P3'))).toBe(true)
  })

  it('M24 前端不再按 burnRequired 分流（硬编码阈值会与后端漂移）', () => {
    const body = base.view.replace('if (d.burnRequired) {', 'if (false) {')
    expect(mutate({ view: body }).some((p) => p.startsWith('P8'))).toBe(true)
  })

  it('M25 前端把精算点数的 max 改回 100（后端仍是 50）', () => {
    const body = base.view.replace(
      'v-model="form.preciseTopK" :min="10" :max="50"',
      'v-model="form.preciseTopK" :min="10" :max="100"'
    )
    expect(mutate({ view: body }).some((p) => p.startsWith('P10'))).toBe(true)
  })

  it('M26 熔断挪到精算之后（先扣完钱再拦人）', () => {
    const body = base.siteSelect.replace(
      'const coarse = runCoarse(db, user, p)\n    const preciseList',
      'await fetchPointPopulation(db, user, { lng: 0, lat: 0, radius: 1 })\n    const coarse = runCoarse(db, user, p)\n    const preciseList'
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('P4'))).toBe(true)
  })

  // ── 批次 373：重复付费防护的负变异 ──────────────────────────────────
  it('M27 参考纬度不再量化到整度（框高变了经度就错开）', () => {
    const body = base.potentialGrid.replace('const refLat = Math.round(midLat)', 'const refLat = midLat')
    expect(mutate({ potentialGrid: body }).some((p) => p.startsWith('Q4'))).toBe(true)
  })

  it('M28 格心退回「从 bbox 西南角起算」（拖框 100m 就整批重扣）', () => {
    const body = base.potentialGrid.replace(
      'const lat = (latK0 + j + 0.5) * degLat',
      'const lat = s + degLat * (j + 0.5)'
    )
    expect(mutate({ potentialGrid: body }).some((p) => p.startsWith('Q5'))).toBe(true)
  })

  it('M29 删掉「已购点追加进精算」（并入了却被 NMS 剔掉，等于白做）', () => {
    const body = base.siteSelect.replace(
      'for (const c of nms(purchasedSurvivors, p.minGapM)) {',
      'for (const c of []) {'
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('Q3'))).toBe(true)
  })

  it('M30 已购点并入时不再校验半径（把注定花钱的点当免费点）', () => {
    const body = base.siteSelect.replace(
      'if (!radiusIncludes(row.radius, radius)) continue',
      'if (false) continue'
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('Q2'))).toBe(true)
  })

  it('M31 已购点改按全平台取（跨用户读已购数据＝隐私红线）', () => {
    // ⚠️ 锚点必须带上 `AND result_data LIKE`：`probeReusable` 里也有一句
    //    `WHERE user_id = ? AND status = 'active'`，用短锚点会改错地方。
    const body = base.siteSelect.replace(
      /WHERE user_id = \? AND status = 'active'(\s+)AND result_data LIKE/,
      "WHERE (user_id = ? OR 1=1) AND status = 'active'$1AND result_data LIKE"
    )
    expect(body).not.toBe(base.siteSelect)   // 变异必须真的生效，否则就是假绿
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('Q1'))).toBe(true)
  })

  it('M32 复用判据从 smartsteps 导入（测试 mock 后变 undefined，静默失效）', () => {
    const body = base.siteSelect.replace(
      "import { REUSE_TOL_M, radiusIncludes } from '../utils/reuseKey.js'",
      "import { REUSE_TOL_M, radiusIncludes } from './smartsteps.js'"
    )
    expect(mutate({ siteSelect: body }).some((p) => p.startsWith('Q6'))).toBe(true)
  })

  it('M33 前端不再解释「精算数为何多于设定值」', () => {
    const body = base.view.replaceAll('d.purchasedInBox', 'd.__gone')
    expect(mutate({ view: body }).some((p) => p.startsWith('Q7'))).toBe(true)
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
