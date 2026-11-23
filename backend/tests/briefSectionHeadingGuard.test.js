/**
 * 初步分析「分节标题条」守卫（v1.13.405 · 批次 405）
 *
 * ── 业主原话 ──────────────────────────────────────────────────────────────
 * 「初步分析页面全是文字看起来不是很清楚，一、二 这样的大标题能用背景色（灰色）之类区分开吗」
 * ⇒ 六节大标题加灰底标题条，正文一行不动。这个改动**没有功能风险**，风险全在
 * 「后来人觉得灰色有点重，随手调浅一点」——调浅会把 PDF 切页切出一条被劈开的灰线。
 *
 * ── 守什么（每条都对应一次真实的失手路径）────────────────────────────────
 *   ① 标题条必须用**真实 background + border**。⛔ 伪元素画条：屏幕上有、导出的
 *      PDF 里整个消失（391 的比例条、403 的表格线都栽在这上面，`html2canvas` 不认伪元素）。
 *   ② 灰底色值必须**浅于纸白但深于 236**。`utils/exportPaperPdf.js::findCutY` 把
 *      「RGB 三通道都 >236」的像素行当**空白行**去切页 —— #f2f3f5(242,243,245) 正是
 *      这种「看起来很浅、却在切页判据里等于白」的坑，切在标题条中间就是一条断头灰线。
 *   ③ 标题与说明文字在灰底上都得 ≥ 4.5:1（WCAG 1.4.3 AA）。原来说明文字用的 #8a9099
 *      在白底 3.22、在灰底只有 2.67 ⇒ 换底色必须连带把说明文字加深。
 *   ④ 负 margin 外扩不许超过纸面 padding（否则标题条伸到纸外，PDF 边缘被裁）。
 *   ⑤ 六节 h2 的「一、二、三…」序号不许丢 —— 标题条的意义就是让人按序号定位，
 *      去掉序号后灰条只剩「分段」不复「可指称」。
 *
 * 🔴 本文件同样遵守项目守卫规范：正则扫源码**必剥注释**（注释里刻意留了反例色值
 *    #f2f3f5 / #eef0f3，不剥会把注释当代码 ⇒ 假红），并且必须配负变异证明「改坏会红」。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，pathname 会留下百分号编码导致 ENOENT */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const VUE_PATH = path.join(REPO, 'frontend/src/components/CandidateBriefReport.vue')
const PDF_PATH = path.join(REPO, 'frontend/src/utils/exportPaperPdf.js')

/** 剥注释：HTML 注释先剥（里面常含 `/*` 字面量，顺序反了会一路吃到样式里） */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const SRC = strip(fs.readFileSync(VUE_PATH, 'utf8'))
const RAW = fs.readFileSync(VUE_PATH, 'utf8')
const PDF_UTIL = fs.readFileSync(PDF_PATH, 'utf8')

// ===== 源码切分（与 textTierContrastGuard 同一套写法）=====
function splitVue(text) {
  // ⚠️ 贪婪取到**最后一个** </template>：正文里还有 `<template v-if>` 内层标签，
  //    非贪婪会截在第一个 </template>，把六节正文整段切掉（403 的 UI 测试踩过）。
  const tpl = /<template>([\s\S]*)<\/template>/.exec(text)
  const styles = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
  return { tpl: tpl ? tpl[1] : '', css: styles }
}

/** 按字符级大括号平衡取规则块（行级判断会被 @media / 嵌套截错） */
function cssBlock(src, header) {
  const lit = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp('(^|\\n)[ \\t]*' + lit + '\\s*\\{').exec(src)
  if (!m) return null
  const open = src.indexOf('{', m.index)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i) }
  }
  return null
}
function declValue(block, prop) {
  if (!block) return null
  const m = new RegExp('(^|[;{\\s])' + prop.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '\\s*:\\s*([^;]+);').exec(block)
  return m ? m[2].trim() : null
}

// ===== 颜色实算（与 textTierContrastGuard / focusContrastGuard 同一套公式）=====
const hexToRgb = (hex) => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
function relLum(hex) {
  const lin = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}
function contrast(a, b) {
  const [x, y] = [relLum(a), relLum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
function lStar(hex) {
  const lin = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y
}

// ===== 判据抽成纯函数，便于负变异（断言逻辑本身要被证明会红）=====
const PAPER_BG = '#ffffff'
const MIN_CONTRAST = 4.5
const CUT_WHITE = 236          // exportPaperPdf.findCutY 的「空白行」阈值：三通道都 > 236
const MIN_L_GAP = 6            // 底色与纸白的 CIE L* 落差下限（低于此肉眼分不出「有条」）
const PAPER_PAD_X = 34         // .bf-paper padding: 26px 34px 20px

function auditHeading(vueSrc) {
  const out = []
  const { tpl, css } = splitVue(vueSrc)

  const hd = cssBlock(css, '.bf-sec-hd')
  if (!hd) { out.push('找不到 .bf-sec-hd 规则块（分节标题条被删了？）'); return out }

  // ① 真实背景 + 左侧竖条（伪元素在 PDF 里会消失）
  const bg = declValue(hd, 'background') || declValue(hd, 'background-color')
  if (!bg) out.push('.bf-sec-hd 没有背景色 ⇒ 六节又变回「一片文字」')
  if (!declValue(hd, 'border-left')) out.push('.bf-sec-hd 没有左侧竖条（分段更弱）')
  if (/(^|\n)\s*\.bf-sec-hd::?(before|after)\b/.test(css)) {
    out.push('.bf-sec-hd 用伪元素画了装饰 ⇒ 导出 PDF 时 html2canvas 会整块丢掉')
  }

  // ②③ 底色：既要看得出（L* 落差），又不能被切页算法当成空白行
  const hx = bg && /#([0-9a-fA-F]{6})/.exec(bg)
  let bgHex = null
  if (bg && !hx) out.push(`.bf-sec-hd 的 background 不是 6 位 hex（${bg}）⇒ 本守卫无法实算对比度`)
  if (hx) {
    bgHex = '#' + hx[1].toLowerCase()
    const rgb = hexToRgb(bgHex)
    if (rgb.every((v) => v > CUT_WHITE)) {
      out.push(
        `.bf-sec-hd 底色 ${bgHex} 的 RGB(${rgb.join(',')}) 三通道都 >${CUT_WHITE} ⇒ ` +
        '导出 PDF 时 findCutY 会把它当空白行，可能切在标题条中间（断头灰线）'
      )
    }
    const gap = lStar(PAPER_BG) - lStar(bgHex)
    if (gap < MIN_L_GAP) out.push(`.bf-sec-hd 底色 ${bgHex} 与纸白只差 ${gap.toFixed(1)} 个 L* ⇒ 分段看不出来`)

    // 标题与说明文字都要在灰底上读得清
    const titleHex = declValue(cssBlock(css, '.bf-sec-hd h2') || '', 'color') || '#1f2329'
    const noteHex = declValue(cssBlock(css, '.bf-sec-note') || '', 'color')
    const t = contrast(titleHex, bgHex)
    if (t < MIN_CONTRAST) out.push(`标题 ${titleHex} 在底色 ${bgHex} 上仅 ${t.toFixed(2)}:1`)
    if (!noteHex) out.push('.bf-sec-note 没有显式 color ⇒ 会继承到看不清的灰')
    else {
      const n = contrast(noteHex, bgHex)
      if (n < MIN_CONTRAST) {
        out.push(
          `说明文字 ${noteHex} 在底色 ${bgHex} 上仅 ${n.toFixed(2)}:1（<${MIN_CONTRAST}）⇒ ` +
          '换底色时必须连带把它加深'
        )
      }
    }
  }

  // ④ 外扩不许超出纸面 padding（否则伸到纸外被裁）
  const margin = declValue(hd, 'margin') || ''
  const negs = [...margin.matchAll(/-\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
  for (const n of negs) {
    if (n > PAPER_PAD_X) out.push(`.bf-sec-hd 的负 margin ${n}px 超过纸面 padding ${PAPER_PAD_X}px ⇒ 标题条伸出纸外`)
  }

  // ⑤ 六节序号
  const ordinals = [...tpl.matchAll(/<h2>\s*([一二三四五六七八九十]+)、/g)].map((m) => m[1])
  if (ordinals.length < 6) {
    out.push(`带序号的大标题只有 ${ordinals.length} 个（应 ≥6：一~六）⇒ 靠序号定位的能力没了`)
  }

  return out
}

// ============================================================================
describe('A. 标题条存在且是真背景（⛔ 伪元素）', () => {
  it('源码切分取到了（取不到就静默假绿）', () => {
    const { tpl, css } = splitVue(SRC)
    expect(tpl.length).toBeGreaterThan(3000)
    expect(css.length).toBeGreaterThan(3000)
    expect(tpl).toContain('bf-sec-hd')
  })

  it('audit 零问题（当前实现合规）', () => {
    expect(auditHeading(SRC)).toEqual([])
  })

  it('⛔ 不许用 ::before / ::after 画标题条（PDF 里会消失）', () => {
    const { css } = splitVue(SRC)
    expect(css).not.toMatch(/\.bf-sec-hd::?(before|after)/)
    // 反向证明：把伪元素塞进去，audit 必须报出来
    const bad = SRC.replace('.bf-sec-hd {', '.bf-sec-hd::before { content: ""; }\n.bf-sec-hd {')
    expect(auditHeading(bad).join('\n')).toContain('伪元素')
  })
})

describe('B. 🔴 灰底不许调浅（导出工具的切页判据会把「很浅的灰」当白）', () => {
  it('当前底色三通道至少一个 ≤ 236（不会被 findCutY 当空白行）', () => {
    const { css } = splitVue(SRC)
    const hd = cssBlock(css, '.bf-sec-hd')
    const hex = /#([0-9a-fA-F]{6})/.exec(declValue(hd, 'background'))[1]
    const rgb = hexToRgb('#' + hex)
    expect(rgb.some((v) => v <= CUT_WHITE), `RGB(${rgb.join(',')}) 全 >${CUT_WHITE}`).toBe(true)
  })

  it('🔴 这条解释了为什么不能用更好看的 #f2f3f5 / #eef0f3（把取舍钉死）', () => {
    // ⚠️ 不要往这个列表里塞 #eceef1(236,238,241) —— 它 R=236 恰好不满足 `>236`，
    //    判不成空白行。但它离阈值只差 1 个数位，任何一次「再浅一点」就翻车 ⇒ 不作为选项。
    for (const light of ['#f2f3f5', '#eef0f3', '#f5f6f8', '#fafafa']) {
      const rgb = hexToRgb(light)
      expect(rgb.every((v) => v > CUT_WHITE), `${light} 竟然没被判成空白行 —— 说明切页判据变了，需重新评估`).toBe(true)
    }
  })

  it('导出工具确实按「三通道 >236 = 空白行」切页（守卫前提，⛔ 别改成别的阈值而不改本文件）', () => {
    expect(PDF_UTIL).toContain('data[i] > 236')
    expect(PDF_UTIL).toContain('data[i + 1] > 236')
    expect(PDF_UTIL).toContain('data[i + 2] > 236')
  })

  it('把底色改浅成 #f2f3f5 ⇒ audit 必须红', () => {
    const { css } = splitVue(SRC)
    const cur = declValue(cssBlock(css, '.bf-sec-hd'), 'background')
    const bad = SRC.replace(`background: ${cur};`, 'background: #f2f3f5;')
    expect(bad).not.toBe(SRC)
    expect(auditHeading(bad).join('\n')).toMatch(/三通道都 >236/)
  })
})

describe('C. 对比度：标题与说明文字在灰底上都 ≥ 4.5:1', () => {
  const { css } = splitVue(SRC)
  const hd = cssBlock(css, '.bf-sec-hd')
  const bgHex = /#([0-9a-fA-F]{6})/.exec(declValue(hd, 'background'))[0]
  const titleHex = declValue(cssBlock(css, '.bf-sec-hd h2'), 'color')
  const noteHex = declValue(cssBlock(css, '.bf-sec-note'), 'color')

  it('标题 ≥ 10:1（不是刚好过线，留足余量）', () => {
    expect(contrast(titleHex, bgHex), `${titleHex} on ${bgHex}`).toBeGreaterThanOrEqual(10)
  })

  it('🔴 说明文字 ≥ 4.5:1（原来的 #8a9099 在灰底只有 2.67 ⇒ 必须加深）', () => {
    const r = contrast(noteHex, bgHex)
    expect(r, `${noteHex} on ${bgHex} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it('🔴 这条守着「为什么说明文字必须跟着改」：#8a9099 在灰底不达标', () => {
    const r = contrast('#8a9099', bgHex)
    expect(r, `#8a9099 在 ${bgHex} 上 ${r.toFixed(2)}:1 —— 若已达标说明底色变了，请重新评估取色`).toBeLessThan(MIN_CONTRAST)
    // 反向：把它改回去，audit 必须红
    const bad = SRC.replace(`.bf-sec-note { font-size: 11.5px; color: ${noteHex}; }`, '.bf-sec-note { font-size: 11.5px; color: #8a9099; }')
    expect(bad).not.toBe(SRC)
    expect(auditHeading(bad).join('\n')).toContain('#8a9099')
  })
})

describe('D. 外扩不溢出纸张 · 纵向预算 · 序号不丢', () => {
  it('负 margin 不超过纸面 padding（34px）', () => {
    const { css } = splitVue(SRC)
    const negs = [...(declValue(cssBlock(css, '.bf-sec-hd'), 'margin') || '').matchAll(/-\s*(\d+)px/g)].map((m) => Number(m[1]))
    expect(negs.length).toBeGreaterThan(0)
    for (const n of negs) expect(n).toBeLessThanOrEqual(PAPER_PAD_X)
  })

  it('🔴 每节标题区纵向占位 ≤ 44px（否则纸面越过 1496px，PDF 多一张白纸）', () => {
    // 推导：A4 可用高 285mm ÷ MIN_READABLE 0.72 = 395.8mm；794px 宽纸面 1px = 0.26455mm
    //      ⇒ 纸面高 ≤ 1496px 才缩得进一页。本批第一版 padding 5/5 + margin 8 时纸面 1531px
    //      ⇒ 实测导出成「一张正文 + 一张 1588×40 纯白尾页」（改前一页 1455px）。
    // 改前每节占位 = secMarginTop 14 + 行高 20 + marginBottom 7 = 41px；
    // 现在 = 10 + 4 + 20 + 4 + 6 = 44px（净 +3/节 × 7 = 21 ⇒ 实测纸面 1476px，缩放 0.730，一页）。
    const { css } = splitVue(SRC)
    const px = (v) => Number(String(v || '0').match(/-?\d+(?:\.\d+)?/)?.[0] || 0)
    const hd = cssBlock(css, '.bf-sec-hd')
    const pad = declValue(hd, 'padding') || ''      // "4px 10px 4px 7px"
    const nums = [...pad.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    expect(nums.length).toBeGreaterThanOrEqual(2, 'padding 至少要有上下两值')
    const padT = nums[0]
    const padB = nums.length >= 3 ? nums[2] : nums[0]
    const secTop = px(declValue(cssBlock(css, '.bf-sec'), 'margin-top'))
    const hdBot = px(declValue(hd, 'margin-bottom'))
    const perSection = secTop + padT + 20 + padB + hdBot   // 20 = h2 行高（14px 字号实测）
    expect(perSection, `每节占位 ${perSection}px（sec.margin-top ${secTop} + padding ${padT}/${padB} + 行高 20 + margin-bottom ${hdBot}）`)
      .toBeLessThanOrEqual(44)
  })

  it('🔴 六节 h2 都带「一、二、三…」序号（标题条要靠序号可指称）', () => {
    const { tpl } = splitVue(SRC)
    const ordinals = [...tpl.matchAll(/<h2>\s*([一二三四五六七八九十]+)、/g)].map((m) => m[1])
    expect(ordinals.length, `实际 ${ordinals.length} 个：${ordinals.join('/')}`).toBeGreaterThanOrEqual(6)
    expect(ordinals.slice(0, 6).join('')).toBe('一二三四五六')
  })

  it('⛔ 别顺手给 .bf-sec 改名（已由 candidateBriefGuard G6 与 exportPaperPdf 共同依赖）', () => {
    expect(PDF_UTIL).toContain('.bf-sec')
    expect([...SRC.matchAll(/class="bf-sec"/g)].length).toBeGreaterThanOrEqual(4)
  })

  it('负变异：删掉底色 / 抹掉序号 ⇒ 各自报红', () => {
    const { css } = splitVue(SRC)
    const cur = declValue(cssBlock(css, '.bf-sec-hd'), 'background')
    const noBg = SRC.replace(`background: ${cur}; `, '')
    expect(noBg).not.toBe(SRC)
    expect(auditHeading(noBg).join('\n')).toContain('没有背景色')

    const noOrdinal = SRC.replace('<h2>一、客群', '<h2>客群')
    expect(noOrdinal).not.toBe(SRC)
    expect(auditHeading(noOrdinal).join('\n')).toContain('带序号的大标题只有 5 个')
  })
})

describe('E. 注释里的反例色值不许污染守卫（剥注释生效）', () => {
  it('注释确实被剥掉了（.bf-sec-hd 上方的三条硬约束只应存在于注释里）', () => {
    expect(RAW).toContain('三条硬约束')
    expect(SRC).not.toContain('三条硬约束')
  })

  it('文件里另一处合法使用 #f2f3f5（.bf-wrap 页底）说明「按色值全局扫」不可行', () => {
    // 这条是给后来人的提醒：⛔ 别写「全文件不许出现 #f2f3f5」那种断言 ——
    // .bf-wrap 的页底本来就是它，会把正常代码判成违规（假红）。判据必须落到 .bf-sec-hd 块内。
    expect(SRC).toContain('background: #f2f3f5')
  })
})
