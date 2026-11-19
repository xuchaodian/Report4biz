/**
 * 候选点位「升级取数」源码守卫（批次 379 · P2）
 *
 * ── 守什么 ──────────────────────────────────────────────────────────────
 * P2 把「花钱买联通人口」搬到了初步分析页下方。这是整个功能里唯一会**扣配额**的路径，
 * 一旦被后人改坏，症状是「换了个半径就悄悄扣一次」「点一下没确认就扣钱」——
 * 功能测试很难覆盖（要真花钱），只能靠源码守卫钉死：
 *
 *   ① 自动探测（onMounted / watch）**只能** `probeOnly: true` —— 少了它就等于自动扣费
 *   ② 真正取数只能由**按钮点击**触发，且必须先弹确认框，文案里必须出现「消耗」「剩余」
 *   ③ 配额不足必须走 `utils/quotaContact.js::requireQuota`（⛔ 自己写联系方式）
 *   ④ 半径只认后端 `plan.radiusM`（联通只支持 1/3/5km）—— 前端 ⛔ 自己定档
 *   ⑤ 初步分析（`CandidateBriefReport.vue`）必须**保持 0 消耗**：付费代码只在子组件里，
 *      ⛔ 不许为了「顺手加个功能」把 G6 那条守卫放宽
 *   ⑥ 联通档位只有一份（`siteSelectConfig.UNICOM_REPORT_RADII`），
 *      ⛔ 不许在路由/前端再写一份 `[1000, 3000, 5000]`
 *
 * 🔴 守卫自身规范（211/231）：正则扫源码**必须剥注释**，且必须配负变异证明「改坏会红」。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** 剥 Vue HTML 注释 → JS 块注释 → 行注释（顺序不可换，见 candidateBriefGuard 的踩坑记录） */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const UPGRADE_RAW = read('frontend/src/components/CandidateBriefUpgrade.vue')
const UPGRADE = strip(UPGRADE_RAW)
const BRIEF = strip(read('frontend/src/components/CandidateBriefReport.vue'))
const SMARTSTEPS = strip(read('backend/src/routes/smartsteps.js'))
const CONFIG = strip(read('backend/src/utils/siteSelectConfig.js'))
const BRIEF_UTIL = strip(read('backend/src/utils/candidateBrief.js'))
const PDF_UTIL = strip(read('frontend/src/utils/exportPaperPdf.js'))

/** 取某函数体（从 `function xxx(` 到下一个顶层 `async function` / `function` / `onMounted`） */
function body(src, startAnchor, endAnchor) {
  const i = src.indexOf(startAnchor)
  if (i < 0) return ''
  const j = src.indexOf(endAnchor, i + startAnchor.length)
  return src.slice(i, j < 0 ? src.length : j)
}

/**
 * 取「一个大括号块」（`onMounted(` / `watch(` 这类调用用）。
 *
 * 🔴 不能用「从头切到文件尾」：`onMounted` 若被挪到 `fetchPopulation` **前面**，
 *    切片会把后面的函数定义也算进来 ⇒ 正确写法被判红（假红比漏报更伤，会逼人删守卫）。
 */
function blockOf(src, anchor) {
  const i = src.indexOf(anchor)
  if (i < 0) return ''
  const open = src.indexOf('{', i)
  if (open < 0) return ''
  let depth = 0
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++
    else if (src[k] === '}') {
      depth--
      if (depth === 0) return src.slice(i, k + 1)
    }
  }
  return src.slice(i)
}

describe('U1. 升级面板存在且被报告页引用（取不到就静默假绿）', () => {
  it('组件与引用都在，且内容非空', () => {
    expect(UPGRADE.length).toBeGreaterThan(1500)
    expect(BRIEF).toContain("from '@/components/CandidateBriefUpgrade.vue'")
    expect(BRIEF).toContain('<CandidateBriefUpgrade')
  })

  it('🔴 升级面板必须在纸张之外（打印出来不该有按钮，PDF 也不该带它）', () => {
    const iFoot = BRIEF.indexOf('class="bf-foot"')
    const iComp = BRIEF.indexOf('<CandidateBriefUpgrade')
    expect(iFoot).toBeGreaterThan(0)
    expect(iComp, '升级面板被塞进纸张里 ⇒ 会进 PDF').toBeGreaterThan(iFoot)
    expect(PDF_UTIL, '导出工具里出现了付费面板的类名 ⇒ 它被算进切页范围').not.toContain('bu-panel')
  })
})

describe('U2. 自动探测只能是 probeOnly（否则换个半径就扣钱）', () => {
  it('probeReuse 里必须 probeOnly: true', () => {
    const fn = body(UPGRADE, 'async function probeReuse(', 'async function loadQuota(')
    expect(fn.length, '切片失败（锚点被改名？）').toBeGreaterThan(200)
    expect(fn, '探测请求少了 probeOnly ⇒ 后端会走闸门真取数').toContain('probeOnly: true')
    // 非 probe 的取数会带 cityMonth / storeName —— 探测里出现它们说明混进了付费请求
    expect(fn, '探测请求里带了 cityMonth ⇒ 这不是 probe').not.toContain('cityMonth')
    expect(fn, '探测请求里带了 storeName ⇒ 这不是 probe').not.toContain('storeName')
  })

  it('🔴 onMounted 只许「探测 + 读配额」，⛔ 不许开局就取数', () => {
    const fn = blockOf(UPGRADE, 'onMounted(')
    expect(fn.length, '切片失败（锚点被改名？）').toBeGreaterThan(20)
    expect(fn).toContain('probeReuse()')
    expect(fn).toContain('loadQuota()')
    expect(fn, 'onMounted 里调了 fetchPopulation ⇒ 打开页面就扣配额').not.toContain('fetchPopulation')
  })

  it('🔴 换半径的 watch 也只能重探，不能取数', () => {
    const fn = blockOf(UPGRADE, "watch(() => props.plan?.radiusM")
    expect(fn.length, '切片失败（watch 被改名？）').toBeGreaterThan(20)
    expect(fn).toContain('probeReuse()')
    expect(fn, '换半径就自动取数 ⇒ 用户只是看看口径就被扣费').not.toContain('fetchPopulation')
  })
})

describe('U3. 取数只能点按钮 + 必须先确认（且明示成本）', () => {
  it('按钮绑定到 fetchPopulation', () => {
    expect(UPGRADE).toContain('@click="fetchPopulation"')
  })

  it('🔴 确认框必须出现「消耗」与「剩余」', () => {
    const fn = body(UPGRADE, 'async function fetchPopulation(', 'onMounted(')
    expect(fn.length).toBeGreaterThan(300)
    expect(fn).toContain('ElMessageBox.confirm')
    expect(fn, '确认文案没写「消耗」⇒ 用户不知道要花钱').toContain('消耗')
    expect(fn, '确认文案没写「剩余」⇒ 用户不知道还剩几次').toContain('剩余')
    // 确认在前、请求在后（顺序反了＝先扣钱再问）
    expect(fn.indexOf('ElMessageBox.confirm')).toBeLessThan(fn.indexOf("axios.post('/api/smartsteps/population'"))
  })

  it('按钮文案本身也要带次数（⛔ 藏在确认框里才算）', () => {
    expect(UPGRADE).toContain('quotaPerFetch')
    expect(UPGRADE).toMatch(/次配额/)
  })
})

describe('U4. 配额不足统一走 requireQuota（⛔ 自己写联系方式）', () => {
  it('import 并使用共用工具', () => {
    expect(UPGRADE).toContain("from '@/utils/quotaContact.js'")
    expect(UPGRADE).toContain('requireQuota(')
    expect(UPGRADE).toContain('QUOTA_REASON.OWN')
    expect(UPGRADE).toContain('QUOTA_REASON.POOL')
  })

  it('⛔ 组件里不许出现手机号 / 微信号之类的兜底联系方式', () => {
    expect(UPGRADE).not.toMatch(/1[3-9]\d{9}/)
    expect(UPGRADE).not.toContain('加微信')
  })
})

describe('U5. 半径只认后端（联通只支持 1/3/5km）', () => {
  it('⛔ 前端不许出现联通档位字面量', () => {
    expect(UPGRADE, '组件里硬编码了联通档位 ⇒ 与后端漂移').not.toMatch(/\[\s*1000\s*,\s*3000\s*,\s*5000\s*\]/)
  })

  it('两处 POST 的 radius 都取自 plan.radiusM', () => {
    const hits = [...UPGRADE.matchAll(/radius:\s*Number\(props\.plan\?\.radiusM\)/g)]
    expect(hits.length, 'POST 的 radius 没走 plan.radiusM').toBe(2)
  })
})

describe('U6. 初步分析页必须保持 0 消耗', () => {
  it('报告页仍然一个付费接口都不碰', () => {
    for (const bad of ['/api/smartsteps', 'probeOnly', '/api/amap', '/api/poi', 'fetchPointPopulation']) {
      expect(BRIEF, `初步分析页出现了 ${bad} ⇒ 0 消耗被破坏`).not.toContain(bad)
    }
    const calls = [...BRIEF.matchAll(/axios\.(get|post|patch|delete)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[2])
    expect([...new Set(calls)]).toEqual(['/api/candidates/brief'])
  })

  it('🔴 付费面板不许自己写库 / 不许渲染历史购买记录', () => {
    expect(UPGRADE).not.toContain('/api/candidates/ensure')
    expect(UPGRADE).not.toContain('/api/purchase/history')
  })
})

describe('U7. 联通档位只有一份来源', () => {
  it('配置里有 UNICOM_REPORT_RADII', () => {
    expect(CONFIG).toContain('UNICOM_REPORT_RADII')
    expect(CONFIG).toMatch(/UNICOM_REPORT_RADII\s*=\s*Object\.freeze\(\[1000,\s*3000,\s*5000\]\)/)
  })

  it('smartsteps 改成 import，⛔ 不再自己写字面量', () => {
    expect(SMARTSTEPS).toContain('UNICOM_REPORT_RADII')
    expect(SMARTSTEPS, '路由里又有硬编码档位 ⇒ 与配置漂移').not.toMatch(/const REPORT_RADII = \[/)
  })

  it('candidateBrief 用同一个常量做映射', () => {
    expect(BRIEF_UTIL).toContain('UNICOM_REPORT_RADII')
    expect(BRIEF_UTIL, '半径映射自己写字面量 ⇒ 联通开新档时会漏').not.toMatch(/\[\s*1000\s*,\s*3000\s*,\s*5000\s*\]/)
  })
})

describe('U8. 负变异：证明上面的断言真会红', () => {
  /** 与守卫同构的最小判据集合：拿坏样本跑一遍，必须被点名 */
  const forbidden = (src) => {
    const bad = []
    if (blockOf(src, 'onMounted(').includes('fetchPopulation(')) bad.push('onMounted-fetch')
    if (blockOf(src, 'watch(').includes('fetchPopulation(')) bad.push('watch-fetch')
    if (!/probeOnly:\s*true/.test(src)) bad.push('no-probeOnly')
    if (!/ElMessageBox\.confirm/.test(src)) bad.push('no-confirm')
    if (!/requireQuota\(/.test(src)) bad.push('no-requireQuota')
    if (/\[\s*1000\s*,\s*3000\s*,\s*5000\s*\]/.test(src)) bad.push('hardcoded-radii')
    return bad
  }

  it('坏样本必须逐条被点名（不然守卫只是「写了个正则」）', () => {
    const sample = `
      onMounted(() => { fetchPopulation() })
      watch(() => x, () => { fetchPopulation() })
      axios.post('/api/smartsteps/population', { radius: Number(props.plan?.radiusM) })
      const R = [1000, 3000, 5000]
      alert('加微信 13800138000')
    `
    expect(forbidden(sample)).toEqual([
      'onMounted-fetch', 'watch-fetch', 'no-probeOnly', 'no-confirm', 'no-requireQuota', 'hardcoded-radii'
    ])
  })

  it('好样本必须全过（避免守卫把正确写法也判红）', () => {
    const ok = `
      onMounted(() => { probeReuse(); loadQuota() })
      watch(() => props.plan?.radiusM, () => { probeReuse() })
      async function probeReuse(){ axios.post('/api/smartsteps/population', { radius: Number(props.plan?.radiusM), probeOnly: true }) }
      async function fetchPopulation(){ await ElMessageBox.confirm('消耗 1 次 / 剩余 N 次'); await requireQuota(code) }
    `
    expect(forbidden(ok)).toEqual([])
  })
})
