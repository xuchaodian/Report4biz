/**
 * ECharts 按需注册覆盖守卫 —— v1.13.347
 *
 * 为什么需要这份守卫：
 *   `frontend/src/utils/echarts.js` 走的是**按需注册**（`use([...])`），只有登记过的图表类型
 *   与坐标系/组件才会被渲染。echarts 5 对未注册的类型**不抛错、不白屏**，只 console warn 后
 *   静默不画 —— 于是「竞品雷达」两图在生产上空白了不知多少版，谁都没报障，因为弹窗头部
 *   统计数字（圈内竞品数/品牌数/平均距离）全是正常的，只有下面两个 300px 白框是空的。
 *   同源的第二次踩坑：门店对比图的 `markLine`（均值虚线）也没注册，柱子正常、虚线永不出现。
 *
 * 本守卫钉三件事：
 *   A. 全站源码里出现的每一个 series type / 坐标系 / 标注组件，都必须在 use([...]) 里登记过
 *   B. 登记名必须是 echarts 包里真实存在的导出（防手抖拼错，如 PolarComponet）
 *   C. 正则本身要能自检（⛔ 裸正则失效会静默返 0 ⇒ 守卫变绿灯）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const FRONTEND_SRC = path.join(REPO, 'frontend', 'src')

/** series.type → 需要的图表注册名 */
const CHART_OF_TYPE = {
  bar: 'BarChart',
  line: 'LineChart',
  pie: 'PieChart',
  radar: 'RadarChart',
  scatter: 'ScatterChart',
  effectScatter: 'EffectScatterChart',
  gauge: 'GaugeChart',
  funnel: 'FunnelChart',
  map: 'MapChart',
  heatmap: 'HeatmapChart',
  graph: 'GraphChart',
  boxplot: 'BoxplotChart',
  candlestick: 'CandlestickChart',
  sankey: 'SankeyChart',
  sunburst: 'SunburstChart',
  treemap: 'TreemapChart',
  themeRiver: 'ThemeRiverChart',
  pictorialBar: 'PictorialBarChart',
  lines: 'LinesChart',
  parallel: 'ParallelChart',
  custom: 'CustomChart'
}

/**
 * option 顶层键 → 需要的组件注册名。
 * 只挑「罕见且一漏就是空白/少画」的键；title/legend/tooltip/grid 这类几乎每个 option 都有，
 * 扫它们只会制造误报噪音，且它们早已登记。
 */
const COMPONENT_OF_KEY = {
  radar: 'RadarComponent',
  polar: 'PolarComponent',
  angleAxis: 'PolarComponent',
  radiusAxis: 'PolarComponent',
  markLine: 'MarkLineComponent',
  markPoint: 'MarkPointComponent',
  markArea: 'MarkAreaComponent',
  dataZoom: 'DataZoomComponent',
  visualMap: 'VisualMapComponent',
  toolbox: 'ToolboxComponent',
  brush: 'BrushComponent',
  geo: 'GeoComponent',
  calendar: 'CalendarComponent',
  timeline: 'TimelineComponent',
  graphic: 'GraphicComponent',
  dataset: 'DatasetComponent',
  parallel: 'ParallelComponent',
  parallelAxis: 'ParallelComponent',
  singleAxis: 'SingleAxisComponent'
}

/** 递归收集目录下的 .vue / .js（跳过 node_modules 与构建产物） */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      walk(p, out)
    } else if (/\.(vue|js|mjs)$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

/** 从 echarts.js 抽出 use([...]) 里登记过的标识符（支持多处 use 调用） */
export function parseRegisteredIdentifiers(src) {
  const out = new Set()
  const callRe = /\buse\s*\(\s*\[([\s\S]*?)\]\s*\)/g
  let m
  while ((m = callRe.exec(src)) !== null) {
    // 🔴 必须先剥注释：数组里常写成 `RadarChart,   // 说明`，
    //    不剥的话按逗号切分会把下一项连注释当成一个 token 丢掉（比漏注册更阴的假绿灯）
    const body = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
    for (const tok of body.split(',')) {
      const id = tok.trim()
      if (/^[A-Za-z_$][\w$]*$/.test(id)) out.add(id)
    }
  }
  return out
}

/** 从源码文本收集「需要哪些注册项」——纯函数，便于用自造文本自检 */
export function collectRequired(sourceText) {
  const charts = new Set()
  const comps = new Set()
  const hits = { series: 0, component: 0 }

  // A. series type：只认带引号的对象字面量写法，避免和 el-button type="primary" 混淆
  const typeRe = /\btype\s*:\s*'([A-Za-z]+)'/g
  let m
  while ((m = typeRe.exec(sourceText)) !== null) {
    const need = CHART_OF_TYPE[m[1]]
    if (need) { charts.add(need); hits.series++ }
  }

  // B. 坐标系 / 标注组件键：`radar: {` 这种写法
  for (const [key, comp] of Object.entries(COMPONENT_OF_KEY)) {
    const keyRe = new RegExp(`\\b${key}\\s*:`, 'g')
    if (keyRe.test(sourceText)) { comps.add(comp); hits.component++ }
  }

  return { charts, comps, hits }
}

/** 读取全部前端源码（含 echarts.js 自身以外） */
function readFrontendSources() {
  const files = walk(FRONTEND_SRC)
  return files.map(f => ({ file: path.relative(REPO, f), text: fs.readFileSync(f, 'utf8') }))
}

const ECHARTS_UTIL = 'frontend/src/utils/echarts.js'

describe('A. 正则自检（⛔ 防裸正则静默返 0）', () => {
  it('collectRequired 能从自造文本里认出 radar 系列与 polar/radar 坐标系', () => {
    const fake = `
      chart.setOption({
        radar: { indicator: [] },
        polar: { radius: '60%' },
        series: [
          { type: 'radar', data: [] },
          { type: 'bar', coordinateSystem: 'polar' },
          { type: 'pie', data: [] }
        ]
      })
    `
    const r = collectRequired(fake)
    expect(r.charts.has('RadarChart')).toBe(true)
    expect(r.charts.has('BarChart')).toBe(true)
    expect(r.charts.has('PieChart')).toBe(true)
    expect(r.comps.has('RadarComponent')).toBe(true)
    expect(r.comps.has('PolarComponent')).toBe(true)
    // 三条 type + 两个组件键
    expect(r.hits.series).toBe(3)
    expect(r.hits.component).toBe(2)
  })

  it('collectRequired 不会把 el-button type="primary" 误判成图表类型', () => {
    const r = collectRequired(`<el-button type="primary">保存</el-button><el-tag type="success" />`)
    expect(r.charts.size).toBe(0)
  })

  it('parseRegisteredIdentifiers 能解析出 use([...]) 里的全部标识符', () => {
    const src = `import { init } from 'echarts/core'\nuse([CanvasRenderer, BarChart, TitleComponent])\n`
    const ids = parseRegisteredIdentifiers(src)
    expect([...ids].sort()).toEqual(['BarChart', 'CanvasRenderer', 'TitleComponent'])
  })

  it('parseRegisteredIdentifiers 对「没有 use 调用」的文本返回空集（可被下游断言抓住）', () => {
    expect(parseRegisteredIdentifiers('const x = 1').size).toBe(0)
  })

  it('parseRegisteredIdentifiers 能穿透行尾注释与块注释（⛔ 否则会吞掉下一项）', () => {
    const src = [
      'use([',
      '  BarChart,     // 柱状图',
      '  RadarChart,   // 雷达图',
      '  /* 块注释里的 PolarComponent 不算 */',
      '  MarkLineComponent',
      '])'
    ].join('\n')
    const ids = [...parseRegisteredIdentifiers(src)].sort()
    expect(ids).toEqual(['BarChart', 'MarkLineComponent', 'RadarChart'])
    // 反向证明：不剥注释的话 PolarComponent 会被当成一项混进来或被吞
    expect(ids).not.toContain('PolarComponent')
  })
})

describe('B. 源码扫描结果非空（⛔ 防扫描器失效）', () => {
  it('前端源码里确实扫到了 series 类型与组件键', () => {
    const sources = readFrontendSources()
    expect(sources.length).toBeGreaterThan(50)
    const total = { series: 0, component: 0 }
    for (const s of sources) {
      const r = collectRequired(s.text)
      total.series += r.hits.series
      total.component += r.hits.component
    }
    // 现实基线远高于此；只用来证明扫描器真的在工作
    expect(total.series).toBeGreaterThan(20)
    expect(total.component).toBeGreaterThan(0)
  })
})

describe('C. 注册表覆盖全部用法', () => {
  const registered = parseRegisteredIdentifiers(
    fs.readFileSync(path.join(REPO, ECHARTS_UTIL), 'utf8')
  )
  const sources = readFrontendSources()

  it('utils/echarts.js 的 use([...]) 至少登记了 8 项（解析器没瞎）', () => {
    expect(registered.size).toBeGreaterThanOrEqual(8)
  })

  it('每个 series type 都有对应的图表注册', () => {
    const missing = new Map() // 注册名 → 出现它的文件
    for (const s of sources) {
      const r = collectRequired(s.text)
      for (const need of r.charts) {
        if (!registered.has(need)) {
          if (!missing.has(need)) missing.set(need, new Set())
          missing.get(need).add(s.file)
        }
      }
    }
    expect([...missing.entries()].map(([k, v]) => `${k} (${[...v].join(', ')})`)).toEqual([])
  })

  it('每个坐标系/标注组件都有对应的组件注册', () => {
    const missing = new Map()
    for (const s of sources) {
      const r = collectRequired(s.text)
      for (const need of r.comps) {
        if (!registered.has(need)) {
          if (!missing.has(need)) missing.set(need, new Set())
          missing.get(need).add(s.file)
        }
      }
    }
    expect([...missing.entries()].map(([k, v]) => `${k} (${[...v].join(', ')})`)).toEqual([])
  })
})

describe('D. 注册名必须是 echarts 包里真实存在的导出（防拼错）', () => {
  // ⚠️ 不用 require('echarts/charts')：CJS 入口会连带装载全量实现，首次 ≈9s，回归明显变慢。
  //    直接解析 `node_modules/echarts/lib/export/*.js` 的 `export { install as XxxChart }` 文本，
  //    毫秒级；用「导出条数下限」断言防止解析器失效后变成假绿灯。
  const exportCache = new Map()

  function loadExports(entry) {
    if (exportCache.has(entry)) return exportCache.get(entry)
    const file = path.join(REPO, 'frontend', 'node_modules', 'echarts', 'lib', 'export', `${entry}.js`)
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (e) {
      throw new Error(
        `无法读取 ${file}（${e.message}）：请先在 frontend 目录执行 npm install，` +
        '否则本用例会因依赖缺失而失去意义'
      )
    }
    const out = new Set()
    const re = /^\s*export\s*\{([^}]*)\}/gm
    let m
    while ((m = re.exec(text)) !== null) {
      for (const part of m[1].split(',')) {
        const t = part.trim()
        if (!t) continue
        const alias = t.match(/\bas\s+([A-Za-z_$][\w$]*)$/)
        out.add(alias ? alias[1] : t.split(/\s+/)[0])
      }
    }
    exportCache.set(entry, out)
    return out
  }

  it('导出清单解析器本身能拿到足够多的名字（⛔ 防解析失效）', () => {
    const charts = loadExports('charts')
    const comps = loadExports('components')
    expect(charts.size).toBeGreaterThanOrEqual(15)
    expect(comps.size).toBeGreaterThanOrEqual(30)
    // 抽两个确定存在的名字，证明解析出的确实是 echarts 的真实导出
    expect(charts.has('RadarChart')).toBe(true)
    expect(comps.has('PolarComponent')).toBe(true)
  })

  it('use([...]) 里每一项都能在 echarts/charts 或 echarts/components 找到同名导出', () => {
    const charts = loadExports('charts')
    const comps = loadExports('components')
    // 渲染器不在上面两个入口里，单独放行
    const RENDERERS = new Set(['CanvasRenderer', 'SVGRenderer'])
    const registered = parseRegisteredIdentifiers(
      fs.readFileSync(path.join(REPO, ECHARTS_UTIL), 'utf8')
    )
    const unknown = [...registered].filter(
      id => !RENDERERS.has(id) && !charts.has(id) && !comps.has(id)
    )
    expect(unknown).toEqual([])
  }, 30000)
})
