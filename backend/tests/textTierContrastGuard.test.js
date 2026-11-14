/**
 * 文字三级 token 与对比度守卫（v1.13.364 / 批次 364）
 *
 * 背景（数字全部从源码实算，⛔ 不抄注释）：
 *   原来三档灰是 primary #303133 / regular #606266 / secondary #909399，
 *   第三档对白底只有 **3.08:1**（页底 #f5f7fa 上 2.87），不达 WCAG 1.4.3 AA 的 4.5:1。
 *
 * 🔴🔴 本文件最该记住的一条：**这不是「把次要色调深一点」那么简单**
 *   4.5:1 的硬门槛把次要色的 CIE L* 上限压到 47.9（#6b7280 在 #f5f7fa 上恰好 4.50）。
 *   而原 regular #606266 的 L* 是 41.5 —— 两者只差 6.4。
 *   人眼看得出层次的经验阈值是 ΔL* ≈ 10，所以**只改 secondary 会把三档塌成两档**。
 *   ⇒ 修法必须同时让 regular 下沉（→ #4b5563），才能保住 15.5 / 12.1 的两级落差。
 *   守卫里因此有 D 组：断言 ΔL* ≥ 10，而不只是「每档都 ≥4.5」。
 *
 * ⚠️ 与 363 的修法**不对称**，别照抄：
 *   · `--el-text-color-placeholder` / `-primary` / `-regular` / `-secondary`
 *     在 EP 里都**只在 :root 声明一次** ⇒ 写 html:root 即全站生效；
 *   · `--el-button-outline-color` 被 .el-button 与 5 个语义变体重复声明 ⇒ 必须压到组件选择器。
 *   动 EP 变量前先数声明次数（见 F 组 EP 契约）。
 *
 * （前端无独立测试框架，故与 brandTokenGuard / touchTargetGuard / focusContrastGuard 一致挂在 backend vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/** ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，pathname 会留下百分号编码导致 ENOENT */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MAIN_SCSS = path.join(REPO_ROOT, 'frontend/src/assets/main.scss')
const SRC_DIR = path.join(REPO_ROOT, 'frontend/src')
const EP_INDEX = path.join(REPO_ROOT, 'frontend/node_modules/element-plus/theme-chalk/index.css')
const MAP_VIEW = path.join(SRC_DIR, 'views/MapView.vue')

// ===== 唯一权威期望值（改这里就必须同步改 main.scss，反之亦然）=====
const TIERS = [
  { name: 'primary', token: '--text-primary', hex: '#303133' },
  { name: 'regular', token: '--text-regular', hex: '#4b5563' },
  { name: 'secondary', token: '--text-secondary', hex: '#6b7280' }
]
const BG = { white: '#ffffff', page: '#f5f7fa', header: '#fafafa' }
const MIN_TEXT = 4.5        // WCAG 1.4.3 AA
const MIN_DELTA_L = 10      // 相邻两档的 CIE L* 落差下限（低于此肉眼难分）
const INFO_HEX = '#909399'  // 语义 info 色，⛔ 与文本色无关，不得连带改

// ===== 对比度与 L* 实算（与 focusContrastGuard / brandTokenGuard 同一套公式）=====
function relLum(hex) {
  const h = hex.replace('#', '')
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}
function contrast(a, b) {
  const [x, y] = [relLum(a), relLum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
/** CIE L*：感知明度。对比度适合判「读不读得清」，L* 适合判「看不看得出是两个档」 */
function lStar(hex) {
  const h = hex.replace('#', '')
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y
}

// ===== 源码读取 =====
const SCSS_RAW = fs.readFileSync(MAIN_SCSS, 'utf8')
/** 剥块注释：注释里保留了历史色值（#606266 / #909399 等），不剥会造出假红 */
const SCSS = SCSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(e.name)) walk(p, out) }
    else if (/\.(vue|scss|css)$/.test(e.name)) out.push(p)
  }
  return out
}
const SRC_FILES = walk(SRC_DIR)

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
  const m = new RegExp(prop.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '\\s*:\\s*([^;]+);').exec(block)
  return m ? m[1].trim() : null
}
const countOf = (src, needle) => src.split(needle).length - 1

const ROOT_BLOCK = cssBlock(SCSS, ':root')
const EP_BLOCK = cssBlock(SCSS, 'html:root')

// ============================================================================
describe('A. 三级 token 定义（1.4.3）', () => {
  it('三档 token 都在 :root 里声明', () => {
    expect(ROOT_BLOCK, '找不到 :root { … } 块').not.toBeNull()
    for (const t of TIERS) expect(declValue(ROOT_BLOCK, t.token), `缺 ${t.token}`).toBe(t.hex)
  })

  it(`三档在三种底色上全部 ≥ ${MIN_TEXT}:1（实算）`, () => {
    for (const t of TIERS) {
      for (const [label, bg] of Object.entries(BG)) {
        const r = contrast(t.hex, bg)
        expect(r, `${t.name} ${t.hex} 对 ${label} ${bg} 仅 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_TEXT)
      }
    }
  })

  it(`🔴 最紧的一项：secondary 在页底 ${BG.page} 上仍 ≥ ${MIN_TEXT}:1（⛔ 再浅 1 个数位就塌）`, () => {
    // 这是选 #6b7280 而不是 #73767a 的唯一理由：#73767a 在白底 4.56 达标、在页底只有 4.25。
    const r = contrast(TIERS[2].hex, BG.page)
    expect(r, `secondary 在 ${BG.page} 上 ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_TEXT)
  })

  it('🔴 证明「只改次要色」不可行：#73767a 在页底必然不达标（这条把取舍钉死）', () => {
    const r = contrast('#73767a', BG.page)
    expect(r, `#73767a 在页底 ${r.toFixed(2)}:1 —— 若已达标，说明页底色改了，需重新评估取色`).toBeLessThan(MIN_TEXT)
  })

  it('⛔ 语义 info 色未被连带改动（站内 44 处 type="info" 靠它）', () => {
    expect(declValue(ROOT_BLOCK, '--info-color')).toBe(INFO_HEX)
  })
})

// ============================================================================
describe('B. EP 文字变量接管', () => {
  it('html:root 里三个 --el-text-color-* 都指向 token（⛔ 不写死色值）', () => {
    expect(EP_BLOCK, '找不到 html:root { … } 块').not.toBeNull()
    expect(declValue(EP_BLOCK, '--el-text-color-primary')).toBe('var(--text-primary)')
    expect(declValue(EP_BLOCK, '--el-text-color-regular')).toBe('var(--text-regular)')
    expect(declValue(EP_BLOCK, '--el-text-color-secondary')).toBe('var(--text-secondary)')
  })

  it('🔴 反向断言：禁止把这三个变量写在 :root 裸块里', () => {
    // 与 363 的 --el-button-outline-color 不同，这三个变量在 EP 里只在 :root 声明一次，
    // 写 :root 其实也生效；但本项目已确立「EP 变量统一写 html:root」的约定（按需注入会盖 :root），
    // 两处并存＝口径分叉，必须禁止。
    for (const t of ['--el-text-color-primary', '--el-text-color-regular', '--el-text-color-secondary']) {
      expect(declValue(ROOT_BLOCK, t), `${t} 不应出现在 :root 裸块`).toBeNull()
    }
  })

  it('⛔ 每个变量全项目只被赋值一次（第二个赋值点＝口径分叉）', () => {
    for (const t of ['--el-text-color-regular:', '--el-text-color-secondary:']) {
      expect(countOf(SCSS, t), `${t} 出现多次`).toBe(1)
    }
  })

  it('⛔ --el-text-color-disabled 刻意不动（1.4.3 对 inactive 组件豁免）', () => {
    expect(SCSS).not.toContain('--el-text-color-disabled:')
  })

  it('⛔ --el-color-info 未被改动（改它会连带 44 处 info 标签）', () => {
    expect(SCSS).not.toContain('--el-color-info:')
  })
})

// ============================================================================
describe('C. 源码白名单：色值只能出现在该出现的位置', () => {
  /** 取 .vue 的三段（用于区分 模板 / 脚本 / 样式） */
  function splitVue(text) {
    const tpl = /<template>([\s\S]*?)<\/template>/.exec(text)
    const styles = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    const scripts = [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
    return { tpl: tpl ? tpl[1] : '', styles, scripts }
  }

  const bad = []
  for (const f of SRC_FILES) {
    const rel = path.relative(SRC_DIR, f)
    const raw = fs.readFileSync(f, 'utf8')
    const noComment = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    // ① CSS 属性位的旧色值必须清零（含 <style> 与内联 style 里的 color:）
    //    ⚠️ 用 (^|[^-\w]) 而不是 lookbehind：ripgrep 无 PCRE2 时不支持 (?<=)，保持一致口径
    for (const hex of ['#909399', '#606266']) {
      const re = new RegExp('(^|[^-\\w])color\\s*:\\s*' + hex, 'i')
      noComment.split('\n').forEach((line, i) => {
        if (re.test(line)) bad.push(`${rel}:${i + 1} 仍有 color: ${hex} → ${line.trim().slice(0, 80)}`)
      })
    }

    if (!f.endsWith('.vue')) continue
    const { tpl, styles } = splitVue(noComment)

    // ② 模板里 #909399 只允许出现在 background（图例圆点）
    for (const part of [tpl, styles]) {
      for (const line of part.split('\n')) {
        if (!line.includes('#909399')) continue
        if (/background|border/i.test(line)) continue
        bad.push(`${rel} 模板/样式里的 #909399 非背景用途 → ${line.trim().slice(0, 80)}`)
      }
    }

    // ③ 内联 style 里的带引号色值也要清零（:style="{ color: '#909399' }"）
    for (const hex of ['#909399', '#606266']) {
      const re = new RegExp("(color\\s*:\\s*)(['\"])" + hex + '\\2', 'i')
      if (re.test(tpl)) bad.push(`${rel} 模板 :style 绑定里仍有 ${hex}`)
    }
  }

  it('CSS 属性位 / 模板绑定里不再有 #909399 与 #606266', () => {
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('⛔ 反向断言：background / border-color 里的 #909399 必须保留（证明没做全局 sed）', () => {
    // 这三处是「语义灰」不是文本灰，跟着改就会动到图例圆点 / 统计条渐变 / 描边。
    const users = fs.readFileSync(path.join(SRC_DIR, 'views/UsersView.vue'), 'utf8')
    expect(users, 'UsersView 的 border-color: #909399 被误改').toContain('border-color: #909399')
    const snap = fs.readFileSync(path.join(SRC_DIR, 'components/competitor/SnapshotMonitorPanel.vue'), 'utf8')
    expect(snap, 'SnapshotMonitorPanel 的渐变被误改').toContain('linear-gradient(135deg, #909399')
    const map = fs.readFileSync(MAP_VIEW, 'utf8')
    expect(map, 'MapView 图例圆点的 background 被误改').toContain('background:#909399')
  })

  it('⛔ 反向断言：JS 图表配置里的引号色值不得换成 var()（canvas 不认 CSS 变量）', () => {
    const map = fs.readFileSync(MAP_VIEW, 'utf8')
    expect(map, 'ECharts axisLabel 的色值被换成了 var()，canvas 里不会解析').toContain("axisLabel: { color: '#909399'")
    expect(map, 'ECharts 的柱状图轴色被改了').toContain("axisLabel: { color: '#606266'")
    const js = fs.readFileSync(path.join(SRC_DIR, 'utils/map.js'), 'utf8')
    expect(js, 'utils/map.js 的语义 info 色被改了').toContain("info: '#909399'")
  })
})

// ============================================================================
describe('D. 视觉层级没被压平（本批真正的取舍）', () => {
  const L = TIERS.map((t) => lStar(t.hex))

  it('三档 L* 严格递增（浅→深顺序不能乱）', () => {
    expect(L[0]).toBeLessThan(L[1])
    expect(L[1]).toBeLessThan(L[2])
  })

  it(`🔴 相邻两档 ΔL* ≥ ${MIN_DELTA_L}（低于此人眼分不出是两个层级）`, () => {
    for (let i = 0; i < 2; i++) {
      const d = L[i + 1] - L[i]
      expect(d, `${TIERS[i].name}→${TIERS[i + 1].name} 只有 ${d.toFixed(1)}`).toBeGreaterThanOrEqual(MIN_DELTA_L)
    }
  })

  it('🔴 证明「只改次要色」会把层级压到 6.4（这条解释为什么必须一起下沉 regular）', () => {
    // 若哪天有人把 regular 改回 #606266，B 组仍会绿（对比度够 6.11），但层级会塌 ——
    // 这条守着「为什么 regular 必须动」这件事本身。
    const d = lStar('#6b7280') - lStar('#606266')
    expect(d, `#606266→#6b7280 落差 ${d.toFixed(1)}，已 ≥10 —— 说明可以只改次要色了，请重新评估`).toBeLessThan(MIN_DELTA_L)
  })
})

// ============================================================================
describe('E. 极小字号（比颜色更硬的问题）', () => {
  const mapSrc = fs.readFileSync(MAP_VIEW, 'utf8')

  it('MapView 里不再有 8px / 9px 字号', () => {
    const hits = mapSrc.split('\n')
      .map((l, i) => ({ l, i: i + 1 }))
      .filter((x) => /font-size:\s*(8|9)(\.5)?px/.test(x.l))
    expect(hits.map((h) => `${h.i}: ${h.l.trim().slice(0, 70)}`)).toEqual([])
  })

  it('🔴 用 token 着色的文字不得同时是 <11px（这条把「改了色但字太小」钉死）', () => {
    const bad = []
    for (const f of SRC_FILES) {
      const lines = fs.readFileSync(f, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!line.includes('var(--text-')) return
        if (/font-size:\s*(8|9|10)(\.5)?px/.test(line)) bad.push(`${path.relative(SRC_DIR, f)}:${i + 1}`)
      })
    }
    expect(bad).toEqual([])
  })

  it('⛔ 10px 的弹窗表格刻意保留（3 列 nowrap，提到 11px 会横向溢出）', () => {
    // 若有人把这两张表也提到 11px，这条会红 —— 那时必须先在真机上确认弹窗没被撑破。
    const tables = mapSrc.split('\n').filter((l) => /font-size:10px/.test(l) && /border-collapse/.test(l))
    expect(tables.length, '弹窗表格的字号策略变了').toBe(2)
  })
})

// ============================================================================
const hasEP = fs.existsSync(EP_INDEX)

describe.skipIf(!hasEP)('F. EP 契约（升级 EP 后前提变了就必须重新评估）', () => {
  const epIndex = hasEP ? fs.readFileSync(EP_INDEX, 'utf8') : ''

  it('三个文本色变量在 EP 里各只在 :root 声明一次（html:root 覆盖能生效的前提）', () => {
    // 若 EP 改成组件内重复声明，B 组仍绿但界面不变 —— 这正是本条存在的理由。
    for (const v of ['--el-text-color-primary:', '--el-text-color-regular:', '--el-text-color-secondary:']) {
      expect(countOf(epIndex, v), `${v} 在 EP 里声明了多次`).toBe(1)
    }
  })

  it('--el-text-color-secondary 确实被 EP 大量内部组件消费（这就是改动面的来源）', () => {
    // 少于 20 说明 EP 改了实现，副作用面评估要重做。
    expect(countOf(epIndex, 'var(--el-text-color-secondary)')).toBeGreaterThanOrEqual(20)
  })

  it('EP 默认的 secondary 就是 #909399（证明改之前确实是 3.08:1）', () => {
    expect(epIndex).toContain('--el-text-color-secondary:#909399')
  })
})
