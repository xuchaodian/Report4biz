/**
 * 品牌主色 token 守卫（v1.13.354 立 B1 / v1.13.355 扩 B2）
 *
 * 背景（2026-11-12 a11y 审计）：
 *   「主色 #409eff 对比度 2.78:1，影响 7 页 68+ 节点」（WCAG 1.4.3 文本 / 1.4.11 非文本）。
 *   根因：#409eff 是 **Element Plus 的出厂默认值** —— 项目从未覆盖过
 *   `--el-color-primary`，等于「没选过色，用着默认蓝」；而同一批颜色又以硬编码形式
 *   散落在 30+ 个文件里，两边从来没有统一口径。
 *
 * B1（354）：立 `--brand-primary: #2563eb`，收敛「前景色 + 描边」。
 * B2（355）：① 用 html:root 整套覆盖 `--el-color-primary` 及 6 个派生值；
 *            ② 把残留的 `#ecf5ff / #d9ecff / #337ecc …` 等派生色硬编码收敛到 EP 变量；
 *            ③ 填充类与渐变（background / linear-gradient / box-shadow）一并迁移。
 *
 * ⛔ 四条红线：
 *   ① **UI 主色 ≠ 品牌实体色**。`'吉野家': '#409eff'` 是业务标识色，
 *      改 UI 主色时把它一起改掉 = 全站吉野家标记变色，属不可逆视觉事故（G4）。
 *   ② **不许用「全局 sed 替换十六进制」改主色**。MapView 里有按色值反查业务档位的代码
 *      （`if (color === '#409eff') filterKey = 'overlapLow'`），改色值会静默打断
 *      重叠率筛选联动（G4b）。
 *   ③ **EP 的 light-3/5/7/8/9、dark-2 是 theme-chalk 里写死的静态值**，不随
 *      `--el-color-primary` 派生。只改主色 ⇒ 底色变深、hover/disabled 仍是旧浅蓝 ⇒
 *      必须整套给（G6）。
 *   ④ **canvas / echarts / leaflet 里不能写 CSS 变量**。`itemStyle.color: 'var(--x)'`
 *      不会报错，只是静默画成黑色或上一帧颜色 —— 这类缺陷测试抓不到、界面才看得见（G10）。
 *
 * （前端无独立测试框架，故与 vipColorUnifyGuard / cspInlineHandlerGuard 一致挂在 backend vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/** ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，pathname 会留下百分号编码导致 ENOENT */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src')
const MAIN_SCSS = path.join(FRONTEND_SRC, 'assets/main.scss')

// ===== 唯一权威期望值 =====
const UI_PRIMARY = '#2563eb'   // 白底 5.17:1 / 浅底 #eaf0fd 上 4.52:1
const OLD_PRIMARY = '#409eff'  // 旧主色（EP 默认），仅允许作为「品牌实体色 / 地图语义色」存在
const BRAND_ENTITY = '#409eff' // 吉野家等品牌实体色，与 UI 主色刻意不同源
const LIGHT_9 = '#eaf0fd'      // 选中态 / tag 浅底
const MIN_TOKEN_USES = 90      // 当前 96 处，留余量；低于此值说明有人批量回退了

// EP 全套派生值（Sass mix 规则从 #2563eb 实算；light-9 上调 1 阶，见 main.scss 注释）
const EP_VARS = {
  '--el-color-primary': UI_PRIMARY,
  '--el-color-primary-light-3': '#6692f1',
  '--el-color-primary-light-5': '#92b1f5',
  '--el-color-primary-light-7': '#bed0f9',
  '--el-color-primary-light-8': '#d3e0fb',
  '--el-color-primary-light-9': LIGHT_9,
  '--el-color-primary-dark-2': '#1e4fbc',
  '--el-color-primary-rgb': '37, 99, 235',
}
// 旧 EP 派生色（B2 后应全站绝迹）
const OLD_DERIVED = ['#ecf5ff', '#d9ecff', '#a0cfff', '#b3d8ff', '#337ecc', '#66b1ff']

// ===== 对比度实算（不抄注释里的数字）=====
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

// ===== 递归收集前端源码（排除 .bak_ 快照，否则历史副本会假红）=====
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.bak') || name.includes('.bak_')) continue
    const abs = path.join(dir, name)
    const st = fs.statSync(abs)
    if (st.isDirectory()) walk(abs, out)
    else if (/\.(vue|js|scss|css)$/.test(name)) out.push(abs)
  }
  return out
}
const SRC_FILES = walk(FRONTEND_SRC)

/** 取 .vue 中某段标签（script/style）的 [start,end] 行号，找不到返回 null */
function sectionRange(lines, tag) {
  let start = -1, end = -1
  lines.forEach((l, i) => {
    if (start < 0 && new RegExp('<' + tag + '\\b').test(l)) start = i
    if (start >= 0 && end < 0 && new RegExp('</' + tag + '>').test(l)) end = i
  })
  return start < 0 ? null : { start, end }
}

/** 只在某个块内按行找匹配 */
function scanSection(rel, abs, tag, re, hits) {
  const lines = fs.readFileSync(abs, 'utf8').split('\n')
  const r = sectionRange(lines, tag)
  if (!r) return
  for (let i = r.start; i <= r.end; i++) {
    if (re.test(lines[i])) hits.push(rel + ':' + (i + 1) + '  ' + lines[i].trim().slice(0, 90))
  }
}

/** 逐行产出「非注释行」，带块注释状态机
 *  ⛔ `/*` 必须前随空白或行首 —— 否则 `accept="image/*"` 这种字符串会被当成注释开头，
 *     把整段文件吞掉（B2 迁移脚本真踩过，漏改 2 处且静默）。
 *  ⛔ 块注释状态只在 .scss 与 .vue 的 <style>/<script> 区间跟踪：
 *     <template> 里没有块注释语法，硬套会误判。 */
function* codeLines(abs) {
  const rel = path.relative(FRONTEND_SRC, abs)
  const lines = fs.readFileSync(abs, 'utf8').split('\n')
  const ranges = []
  if (rel.endsWith('.vue')) {
    const sc = sectionRange(lines, 'script')
    const st = sectionRange(lines, 'style')
    if (sc) ranges.push(sc)
    if (st) ranges.push(st)
  } else {
    ranges.push({ start: 0, end: lines.length - 1 })
  }
  const inRange = (i) => ranges.some((r) => i >= r.start && i <= r.end)
  let inBlock = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const tracked = inRange(i)
    const before = inBlock
    if (tracked) {
      const opens = (line.match(/(^|\s)\/\*/g) || []).length
      const closes = (line.match(/\*\//g) || []).length
      if (opens > closes) inBlock = true
      else if (closes > 0) inBlock = false
    }
    const isLineComment = /^\s*(\/\/|\*|<!--)/.test(line)
    if (before || inBlock || isLineComment) continue
    yield { no: i + 1, line }
  }
}

describe('品牌主色 token（B1 + B2）', () => {
  const scss = fs.readFileSync(MAIN_SCSS, 'utf8')

  it('G1 · main.scss 必须定义 --brand-primary = #2563eb', () => {
    const m = scss.match(/--brand-primary:\s*(#[0-9a-fA-F]{6})/)
    expect(m, '--brand-primary 未定义 ⇒ 全站 var(--brand-primary) 全部失效（颜色会变空/继承）').toBeTruthy()
    expect(m[1].toLowerCase()).toBe(UI_PRIMARY)
  })

  it('G2 · 全站不得再出现旧主色作为前景/描边（background-* 前缀除外）', () => {
    // 唯一白名单：dv-center-tag 的 hover 是「背景 + 描边 + 白字」一体，
    // 那段已在 B2 迁移完毕；此处置空，新白名单必须写明理由。
    const ALLOW_OLD_BORDER = new Set([])
    const hits = []
    for (const abs of SRC_FILES) {
      const rel = path.relative(FRONTEND_SRC, abs)
      const src = fs.readFileSync(abs, 'utf8')
      src.split('\n').forEach((line, i) => {
        const re = /(?<![\w-])(?:border(?:-[a-z]+)?-)?color:\s*#409eff\b/i
        if (re.test(line) && !ALLOW_OLD_BORDER.has(rel)) {
          hits.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 90))
        }
      })
    }
    expect(hits, '旧主色又回到前景/描边位（应改用 var(--brand-primary)）:\n' + hits.join('\n')).toEqual([])
  })

  it('G2b · 实线描边（含 2px 面板外框）不得退回旧主色', () => {
    // B1 时 2px 曾被排除（与未迁移的 gradient 标题栏一体）；B2 两者都已迁移，故纳入
    const hits = []
    for (const abs of SRC_FILES) {
      const rel = path.relative(FRONTEND_SRC, abs)
      fs.readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
        if (/border:\s*\d+px\s+solid\s+#409eff\b/i.test(line)) {
          hits.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 90))
        }
      })
    }
    expect(hits, '实线描边退回旧主色:\n' + hits.join('\n')).toEqual([])
  })

  it('G3 · token 引用数不得低于下限（防一次性回退）', () => {
    let n = 0
    for (const abs of SRC_FILES) {
      n += (fs.readFileSync(abs, 'utf8').match(/var\(--brand-primary\)/g) || []).length
    }
    expect(n, `var(--brand-primary) 仅剩 ${n} 处，疑似被批量回退`).toBeGreaterThanOrEqual(MIN_TOKEN_USES)
  })

  it('G4 · 品牌实体色必须仍在，且与 UI 主色刻意不同源', () => {
    expect(BRAND_ENTITY.toLowerCase()).not.toBe(UI_PRIMARY)
    const mapView = fs.readFileSync(path.join(FRONTEND_SRC, 'views/MapView.vue'), 'utf8')
    expect(mapView, '吉野家品牌色被改掉了 —— 那是业务标识色，⛔ 不是 UI 主色').toContain(`'吉野家': '${BRAND_ENTITY}'`)
    expect(mapView).not.toContain(`'吉野家': '${UI_PRIMARY}'`)
  })

  it('G4b · 按色值反查业务档位的代码必须与图例色同源（改色会静默断筛选）', () => {
    const mapView = fs.readFileSync(path.join(FRONTEND_SRC, 'views/MapView.vue'), 'utf8')
    // 这条反查一旦与图例色脱钩，重叠率筛选会静默失效（点图例没反应，且不报错）
    expect(mapView, '重叠率按色值反查被改动 —— 必须与 overlapLow 图例色保持一致').toContain(
      `if (color === '${OLD_PRIMARY}') filterKey = 'overlapLow'`
    )
  })

  it('G5 · 对比度实算：主色在白底/浅底、白字在主色上都必须 ≥ 4.5:1', () => {
    expect(contrast(UI_PRIMARY, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(UI_PRIMARY, LIGHT_9)).toBeGreaterThanOrEqual(4.5) // tag / 选中态浅底
    expect(contrast('#ffffff', UI_PRIMARY)).toBeGreaterThanOrEqual(4.5) // 白字按钮
    expect(contrast('#0d579c', LIGHT_9)).toBeGreaterThanOrEqual(4.5) // primary tag 文字
    expect(contrast(OLD_PRIMARY, '#ffffff')).toBeLessThan(4.5) // 反证：旧主色确实不达标
  })

  it('G6 · EP 主色必须是整套覆盖（light-3/5/7/8/9 + dark-2 + rgb），缺一个 hover 就跳色', () => {
    const block = scss.match(/html:root\s*\{([\s\S]*?)\n\}/)
    expect(block, '⛔ 未找到 html:root 覆盖块 —— EP 变量没被接管，主按钮仍是 #409eff').toBeTruthy()
    const body = block[1]
    for (const [name, want] of Object.entries(EP_VARS)) {
      const m = body.match(new RegExp(name + ':\\s*([^;]+);'))
      expect(m, `⛔ ${name} 未覆盖 —— EP 会用它自己的静态值（浅蓝），与深蓝主色割裂`).toBeTruthy()
      expect(m[1].trim().toLowerCase(), `${name} 值不对`).toBe(want.toLowerCase())
    }
  })

  it('G7 · 覆盖选择器必须是 html:root（EP 样式按需注入，纯 :root 会被后插入的样式盖住）', () => {
    // 单独断言，不并入 G6：这两个失败原因完全不同（值写错 vs 特异性不够）
    expect(scss, '必须用 html:root 而非 :root —— 同样的特异性会被后注入的 EP 组件样式覆盖').toMatch(/html:root\s*\{/)
    // 反向：不许在普通 :root 里再定义一次 --el-color-primary（两处定义 = 拼加载顺序）
    const plainRoot = scss.match(/(?:^|\n):root\s*\{([\s\S]*?)\n\}/)
    if (plainRoot) {
      expect(plainRoot[1], ':root 里不要定义 --el-color-primary，统一放 html:root').not.toMatch(/--el-color-primary:/)
    }
  })

  it('G8 · 旧 EP 派生色（#ecf5ff 等）不得再以硬编码出现', () => {
    const hits = []
    for (const abs of SRC_FILES) {
      const rel = path.relative(FRONTEND_SRC, abs)
      for (const { no, line } of codeLines(abs)) {
        for (const c of OLD_DERIVED) {
          if (new RegExp(c, 'i').test(line)) {
            hits.push(rel + ':' + no + '  [' + c + '] ' + line.trim().slice(0, 80))
          }
        }
      }
    }
    expect(hits, 'EP 派生色又被写死了（应改用 var(--el-color-primary-light-N) / 或 JS 内用实算字面值）:\n' + hits.join('\n')).toEqual([])
  })

  it('G9 · <style> 内不得再用旧主色做填充/渐变', () => {
    // 只扫 <style> 与 .scss：template 内联 style 里还有分级图例色（业务语义，刻意保留），
    // script 里的 marker / echarts 色同理 —— 那两类由 G4b 与人工评审把关。
    // 唯一白名单：竞品快照的统计卡片渐变是**报表语义色组**（开店绿/关店红/净增蓝/保留灰/基数紫），
    // 蓝色成员与主色同值纯属巧合，不该被品牌色绑架。
    const ALLOW = new Set(['components/competitor/SnapshotMonitorPanel.vue'])
    const hits = []
    for (const abs of SRC_FILES) {
      const rel = path.relative(FRONTEND_SRC, abs)
      if (ALLOW.has(rel)) continue
      if (rel.endsWith('.scss')) {
        fs.readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
          if (/(?:background|linear-gradient|box-shadow)[^;]*#409eff/i.test(line)) {
            hits.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 90))
          }
        })
      } else if (rel.endsWith('.vue')) {
        scanSection(rel, abs, 'style', /(?:background|linear-gradient|box-shadow)[^;]*#409eff/i, hits)
      }
    }
    expect(hits, '填充/渐变退回旧主色:\n' + hits.join('\n')).toEqual([])
  })

  it('G10 · echarts 配置项里不得出现 CSS 变量（canvas 不解析，会静默失效）', () => {
    // ⚠️ 判定边界刻意收窄到「echarts 配置键」：
    //    <script> 里拼 HTML 字符串（html: `…`, innerHTML, L.divIcon）最终进真实 DOM，
    //    那里写 var(--brand-primary) 是**有效**的（B1 已有 5 处这种写法，不必改）。
    //    真正会静默失效的是进 canvas 的值 —— 它们必然出现在这些键后面。
    const ECHARTS_KEY = /(?:itemStyle|lineStyle|areaStyle|emphasis|axisLine|axisLabel|splitLine|splitArea|shadowColor|shadowBlur)\s*:[^\n]*var\(--/
    const hits = []
    for (const abs of SRC_FILES) {
      const rel = path.relative(FRONTEND_SRC, abs)
      if (!rel.endsWith('.vue')) continue
      const lines = fs.readFileSync(abs, 'utf8').split('\n')
      const r = sectionRange(lines, 'script')
      if (!r) continue
      for (let i = r.start; i <= r.end; i++) {
        if (ECHARTS_KEY.test(lines[i])) hits.push(rel + ':' + (i + 1) + '  ' + lines[i].trim().slice(0, 100))
      }
    }
    expect(hits, 'echarts 配置里写了 CSS 变量 —— canvas 不解析，不会报错、只会画成黑或上一帧颜色:\n' + hits.join('\n')).toEqual([])
  })
})
