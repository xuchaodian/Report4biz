/**
 * 候选点位「初步分析」源码守卫（批次 378 · P1）
 *
 * ── 守什么 ──────────────────────────────────────────────────────────────
 * 这份报告的全部价值建立在「**0 消耗、只看不算**」上。它一旦被后人改坏，症状是
 * 「悄悄扣了配额」或「点一下就在库里多一行」，功能测试很难覆盖到，只能靠源码守卫钉死：
 *
 *   ① `GET /brief` 里**一个外部请求都不许有** —— 联通人口是付费的，属于 P2 之后的事
 *   ② `GET /brief` 必须**纯读** —— 不建行、不写流水（门店驱动的行 id 为 null，很容易
 *      顺手 `POST /ensure` 一下，那就把「看一眼」变成了写操作）
 *   ③ 路由顺序：`/brief` 必须在 `/:id` 之前，否则 `/brief` 会被当成 id
 *   ④ 纯计算模块 `utils/candidateBrief.js` 零 IO 依赖（可被纯函数单测直接 import）
 *   ⑤ 饱和阈值只能来自 siteSelectConfig，⛔ 不许在路由或前端硬编码 2000/2
 *   ⑥ 竞品取数必须走 `utils/competitorPoints.js`（与智能选址同一份），
 *      ⛔ 不许在候选点位里再写一条竞品 SQL —— 那会让同一点位在两处显示不同竞品数
 *
 * 🔴 守卫自身规范（211/231 教训）：正则扫源码**必须剥注释**，
 *    并且必须配负变异证明「改坏会红」。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/**
 * 剥 JS 块/行注释 + Vue HTML 注释；[^:] 保护 https:// 这类字面量。
 *
 * 🔴 **HTML 注释必须最先剥**：Vue 文件的 HTML 注释里常写着 `/api/smartsteps/*`
 *    这类字面量，先跑 `/* *\/` 会从那个 `/*` 一路吃到 CSS 里的 `*\/`，
 *    把 `-->` 一起吃掉 ⇒ HTML 注释匹配失败、整段注释留在"干净"源码里 ⇒ 断言假红/假绿。
 *    （本文件第一版就这么红过，记在这里免得下次又踩。）
 */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const ROUTE = strip(read('backend/src/routes/candidates.js'))
const BRIEF = strip(read('backend/src/utils/candidateBrief.js'))
const COMP_POINTS = strip(read('backend/src/utils/competitorPoints.js'))
const CONFIG = strip(read('backend/src/utils/siteSelectConfig.js'))
const SITE = strip(read('backend/src/routes/site-select.js'))

/** 取 [start, end) 之间的源码；找不到起点返回 ''（让断言直接红，而不是静默通过） */
function slice(src, startMark, endMark) {
  const i = src.indexOf(startMark)
  if (i < 0) return ''
  if (!endMark) return src.slice(i)
  const j = src.indexOf(endMark, i + startMark.length)
  return src.slice(i, j < 0 ? src.length : j)
}

/** 顶层函数体（到下一个顶层 `}` 或空行 + 注释块） */
function fnBody(src, name) {
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) return ''
  let depth = 0
  let started = false
  for (let k = i; k < src.length; k++) {
    const ch = src[k]
    if (ch === '{') { depth++; started = true }
    else if (ch === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1) }
  }
  return ''
}

// ⚠️ 切片的起止锚**必须是代码**，不能是注释 —— `strip()` 已经把注释删了，
//    用注释当锚会 indexOf 返回 -1 ⇒ 切片一直延到文件末尾（本文件第一版就这么假绿过）。
const BRIEF_ROUTE = slice(ROUTE, "router.get('/brief'", "router.get('/:id'")
const DETAIL_ROUTE = slice(ROUTE, "router.get('/:id'", "router.post('/'")

describe('G1. 🔴 初步分析一个外部请求都不许发', () => {
  it('路由切片取到了（取不到就静默假绿）', () => {
    expect(BRIEF_ROUTE.length).toBeGreaterThan(600)
    expect(BRIEF_ROUTE).toContain('buildBriefModel')
  })

  it('不含任何付费取数入口', () => {
    for (const bad of ['fetchPointPopulation', 'smartsteps', 'amap', 'AMAP', 'business-count', 'target=_blank']) {
      expect(BRIEF_ROUTE, `brief 里出现了 ${bad} ⇒ 初步分析变成了付费功能`).not.toContain(bad)
    }
  })

  it('不含 axios / fetch / http.request（本端点只查本地库）', () => {
    for (const bad of ['axios', 'fetch(', 'http.request', 'https.request', 'node:http']) {
      expect(BRIEF_ROUTE, `brief 里出现了 ${bad}`).not.toContain(bad)
    }
  })

  it('纯计算模块零 IO 依赖（否则纯函数单测会被拖起数据库/网络）', () => {
    const imports = [...BRIEF.matchAll(/^import\s[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(imports.length).toBeGreaterThan(0)
    for (const mod of imports) {
      expect(mod, `candidateBrief 不该依赖 ${mod}`).toMatch(/^\.\/(siteSelectConfig|gridPopulation|districtScore)\.js$/)
    }
    expect(BRIEF).not.toContain('getDb')
    expect(BRIEF).not.toContain('fetch')
  })
})

describe('G2. 🔴 初步分析必须纯读（看一眼不留痕迹）', () => {
  it('没有写语句', () => {
    for (const bad of ['INSERT INTO', 'UPDATE ', 'DELETE FROM', 'saveNow', 'beginTx', 'commitTx']) {
      expect(BRIEF_ROUTE, `brief 里出现了 ${bad} ⇒ 只读端点变成了写操作`).not.toContain(bad)
    }
  })

  it('门店驱动的行（id 为 null）靠 markerId 分析，⛔ 不调 /ensure', () => {
    expect(BRIEF_ROUTE).toContain('markerId')
    expect(BRIEF_ROUTE, '/ensure 是写入口，读端点不许调').not.toContain('/ensure')
    expect(BRIEF_ROUTE).not.toContain('ensureRow')
  })

  it('路由顺序：/brief 必须在 /:id 之前（否则被当成 id）', () => {
    const iBrief = ROUTE.indexOf("router.get('/brief'")
    const iDetail = ROUTE.indexOf("router.get('/:id'")
    expect(iBrief).toBeGreaterThan(0)
    expect(iDetail).toBeGreaterThan(0)
    expect(iBrief, '/brief 注册在 /:id 之后 ⇒ 永远匹配不到').toBeLessThan(iDetail)
  })
})

describe('G3. 口径不许分叉', () => {
  it('竞品取数走 utils/competitorPoints.js（与智能选址同一份）', () => {
    expect(ROUTE).toContain("from '../utils/competitorPoints.js'")
    expect(BRIEF_ROUTE).toContain('loadCompetitorIndex(')
    // ⛔ 候选点位里不许再写一条竞品 SQL —— 两套 SQL 迟早出现两个数字
    expect(BRIEF_ROUTE, 'brief 里自写了竞品 SQL').not.toContain('FROM competitors')
  })

  it('智能选址也必须走同一个 util（否则这份 util 只是摆设）', () => {
    expect(SITE).toContain('loadCompetitorIndex(')
    expect(SITE, '选址路由里还留着竞品 SQL 副本').not.toContain('FROM competitors')
  })

  it('商圈面加载与智能选址共用 districtPieces.js', () => {
    expect(ROUTE).toContain("from '../utils/districtPieces.js'")
    expect(SITE).toContain("from '../utils/districtPieces.js'")
    expect(ROUTE, 'brief 里重写了一份 loadDistrictPieces').not.toContain('function loadDistrictPieces')
    expect(SITE, '选址里重写了一份 loadDistrictPieces').not.toContain('function loadDistrictPieces')
  })

  it('饱和阈值只能来自 config（⛔ 硬编码 2000 / 2）', () => {
    expect(CONFIG).toContain('SATURATION_DEFAULT')
    expect(BRIEF_ROUTE).toContain('SATURATION_DEFAULT')
    expect(BRIEF_ROUTE, 'brief 里硬编码了 2000').not.toMatch(/=\s*2000\b(?!\s*\))/)
    expect(BRIEF_ROUTE, 'brief 里硬编码了饱和门限 2').not.toMatch(/withinR\s*>=\s*2\b/)
  })

  it('「市」字兜底存在（库里网格名来自文件名，门店台账常带「市」）', () => {
    const body = fnBody(ROUTE, 'gridForCity')
    expect(body, '找不到 gridForCity').toBeTruthy()
    expect(body).toContain("replace(/市$/, '')")
  })
})

describe('G4. 未评 ≠ 0（结论不许拿缺数据当证据）', () => {
  it('无网格时 circlePop 必须是 null，⛔ 不是 0', () => {
    expect(BRIEF).toContain('circlePop: null')
  })

  it('无网格 ⇒ 结论不可能是 go', () => {
    const body = fnBody(BRIEF, 'buildVerdict')
    expect(body).toBeTruthy()
    // 客群未评必须进 reasons（⇒ watch），且在「全过关才给 go」之前
    const iMissing = body.indexOf('本市暂无本地 1km 网格')
    const iGo = body.indexOf("level: 'go'")
    expect(iMissing).toBeGreaterThan(0)
    expect(iGo).toBeGreaterThan(iMissing)
  })

  it('不产出总分字段（单点没有可比集合）', () => {
    expect(BRIEF).not.toMatch(/^\s*totalScore:/m)
    expect(BRIEF).not.toMatch(/^\s*siteScore:/m)
  })
})

describe('G5. 负变异：改坏必须报红（证明上面不是假绿）', () => {
  /**
   * 断言逻辑抽成纯函数，再拿「改坏的样本」跑一遍 —— 这样证明的是**断言会红**，
   * 而不是「字符串替换生效了」。只断言坏样本含坏 token 等于没测（本项目 231 踩过）。
   */
  const forbidden = (src, list) => list.filter((b) => src.includes(b))
  const PAID = ['fetchPointPopulation', 'smartsteps', 'amap', 'AMAP', 'business-count']
  const NET = ['axios', 'fetch(', 'http.request', 'https.request', 'node:http']
  const WRITE = ['INSERT INTO', 'UPDATE ', 'DELETE FROM', 'saveNow', 'beginTx', 'commitTx']
  const mutate = (src, from, to) => src.replace(from, to)

  it('M301 给 brief 塞一句 fetchPointPopulation ⇒ 付费断言会红', () => {
    expect(forbidden(BRIEF_ROUTE, PAID)).toEqual([])
    const bad = mutate(BRIEF_ROUTE, 'const grid = gridForCity', 'const _x = fetchPointPopulation\n    const grid = gridForCity')
    expect(forbidden(bad, PAID)).toEqual(['fetchPointPopulation'])
  })

  it('M302 给 brief 塞一条 INSERT ⇒ 纯读断言会红', () => {
    expect(forbidden(BRIEF_ROUTE, WRITE)).toEqual([])
    const bad = mutate(BRIEF_ROUTE, 'const brief = buildBriefModel', "db.prepare('INSERT INTO x VALUES (1)').run()\n    const brief = buildBriefModel")
    expect(forbidden(bad, WRITE)).toEqual(['INSERT INTO'])
  })

  it('M303 把 /brief 移到 /:id 之后 ⇒ 顺序断言会红', () => {
    const briefBeforeDetail = (src) => {
      const a = src.indexOf("router.get('/brief'")
      const b = src.indexOf("router.get('/:id'")
      return a > 0 && b > 0 && a < b
    }
    expect(briefBeforeDetail(ROUTE)).toBe(true)
    expect(briefBeforeDetail("router.get('/:id', authenticate, x)\nrouter.get('/brief', authenticate, y)")).toBe(false)
  })

  it('M304 在 brief 里自写竞品 SQL ⇒ 口径分叉断言会红', () => {
    expect(forbidden(BRIEF_ROUTE, ['FROM competitors'])).toEqual([])
    const bad = mutate(BRIEF_ROUTE, 'const cnt = countWithin', "db.prepare('SELECT id FROM competitors').all()\n    const cnt = countWithin")
    expect(forbidden(bad, ['FROM competitors'])).toEqual(['FROM competitors'])
  })

  it('M305 关掉外部网络探针的断言仍是双向的（NET 列表非空且当前干净）', () => {
    expect(NET.length).toBeGreaterThan(0)
    expect(forbidden(BRIEF_ROUTE, NET)).toEqual([])
    expect(forbidden(`${BRIEF_ROUTE}\nconst r = await axios.post('/x')`, NET)).toEqual(['axios'])
  })

  it('M306 把饱和判据改成恒定 false ⇒ 源码形态断言会红', () => {
    const RULE = 'ownOut.saturated = ownOut.hasBrand && ownOut.withinR >= satMax'
    expect(BRIEF).toContain(RULE)
    const bad = BRIEF.replace(RULE, 'ownOut.saturated = false')
    expect(bad).not.toContain(RULE)
    expect(bad).toContain('ownOut.saturated = false')
  })
})

// ────────────────────────────────────────────────────────────────────────
// G6. 前端：初步分析页不许自己调付费接口、必须共用 PDF 导出
// ────────────────────────────────────────────────────────────────────────
const BRIEF_VUE_RAW = read('frontend/src/components/CandidateBriefReport.vue')
const BRIEF_VUE = strip(BRIEF_VUE_RAW)
const CAND_VIEW = strip(read('frontend/src/views/CandidateView.vue'))
const REPORT_VUE = strip(read('frontend/src/components/CandidateReport.vue'))
const PDF_UTIL = strip(read('frontend/src/utils/exportPaperPdf.js'))

describe('G6. 前端初步分析：0 消耗 + 共用导出', () => {
  it('切片取到了（取不到就静默假绿）', () => {
    expect(BRIEF_VUE.length).toBeGreaterThan(2000)
    expect(BRIEF_VUE).toContain('/api/candidates/brief')
  })

  it('⛔ 不许调联通 / 高德（要花钱的取数只能在立项报告里走确认流程）', () => {
    for (const bad of ['/api/smartsteps', 'fetchPointPopulation', '/api/amap', '/api/poi', 'probeOnly']) {
      expect(BRIEF_VUE, `初步分析页出现了 ${bad} ⇒ 0 消耗被破坏`).not.toContain(bad)
    }
  })

  it('只调 /api/candidates/brief 一个接口', () => {
    const calls = [...BRIEF_VUE.matchAll(/axios\.(get|post|patch|delete)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[2])
    expect(calls.length).toBeGreaterThan(0)
    expect([...new Set(calls)], '初步分析页调了别的接口').toEqual(['/api/candidates/brief'])
  })

  it('PDF 导出必须走共用 util（⛔ 各自复制一套分页逻辑）', () => {
    expect(BRIEF_VUE, '初步分析页没 import 共用导出').toContain("from '@/utils/exportPaperPdf.js'")
    expect(REPORT_VUE, '立项报告没改走共用导出（两份实现必然分叉）').toContain("from '@/utils/exportPaperPdf.js'")
    expect(BRIEF_VUE, '初步分析页自己 import 了 html2canvas').not.toContain('html2canvas')
    expect(REPORT_VUE, '立项报告自己 import 了 html2canvas').not.toContain('html2canvas')
    expect(PDF_UTIL).toContain('MIN_READABLE')
    expect(PDF_UTIL).toContain('MAX_PAGES')
  })

  it('纸张内的区块必须带 .bf-sec / .bf-foot（切页锚点，改了 PDF 会切到字中间）', () => {
    const secs = [...BRIEF_VUE.matchAll(/class="bf-sec"/g)].length
    expect(secs, '纸张里少于 4 个 .bf-sec ⇒ 切页只能靠像素扫描').toBeGreaterThanOrEqual(4)
    expect(BRIEF_VUE).toContain('class="bf-foot"')
    expect(PDF_UTIL, '导出工具必须认 .bf-sec / .bf-foot').toContain('.bf-sec')
  })

  it('🔴 打开初步分析 ⛔ 不调 ensureRow（看一眼不该在库里建行）', () => {
    const i = CAND_VIEW.indexOf('function openBrief(')
    expect(i).toBeGreaterThan(0)
    // ⚠️ 终点必须锚**代码**（注释已被 strip 删掉，拿 '/**' 当锚会 indexOf 返回 -1 ⇒ 切到文件尾）
    const body = CAND_VIEW.slice(i, CAND_VIEW.indexOf('async function openReport(', i))
    expect(body, 'openBrief 里出现了 ensureRow').not.toContain('ensureRow')
    expect(body, 'openBrief 里出现了 axios').not.toContain('axios')
    expect(body, '开门店视图的抽屉后再切视图 ⇒ 抽屉会盖在新视图上').toContain('drawer.value = false')
  })

  it('入口顺序：初步分析放在立项报告之前（先免费看，再决定花钱）', () => {
    const iBrief = CAND_VIEW.indexOf('openBrief(detail)')
    const iReport = CAND_VIEW.indexOf('openReport')
    expect(iBrief).toBeGreaterThan(0)
    expect(iReport).toBeGreaterThan(0)
    expect(iBrief, '「生成立项报告」排在「初步分析」前面 ⇒ 用户会先花钱').toBeLessThan(iReport)
  })

  it('页面内嵌：报告视图与列表视图同一个页面（⛔ 别改成 el-dialog）', () => {
    expect(CAND_VIEW).toContain('<CandidateBriefReport')
    expect(CAND_VIEW, '初步分析被做成了弹窗（业主拍板要页面内嵌）').not.toMatch(/<el-dialog[^>]*brief/i)
  })
})
