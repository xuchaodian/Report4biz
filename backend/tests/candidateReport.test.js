/**
 * 立项报告数据层守卫 —— v1.13.337（P1-5）
 *
 * 这份报告会**发给业主/老板看**，所以「不许编」比「好看」重要得多。
 * 本文件钉三件事：
 *   A. 几何判定正确（点位在不在商圈面里、不在时取最近的那个并给出距离）
 *   B. 缺数据要如实说缺（⛔ 不补 0 冒充有数据）
 *   C. 🔴 **报告里不许出现预测类表述**（`store_sales` 至今无真实数据，任何"预计营业额"都是编的）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pointInRing, pointInGeometry, distanceToRingM,
  pickDistrictForPoint, scoreToStars, buildReportModel, fmtM
} from '../../frontend/src/utils/candidateReport.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** 正方形面：lng 121.50~121.52，lat 31.29~31.31 */
const square = {
  type: 'Polygon',
  coordinates: [[[121.50, 31.29], [121.52, 31.29], [121.52, 31.31], [121.50, 31.31], [121.50, 31.29]]]
}
/** 带洞的面：中间挖掉 121.505~121.515 / 31.295~31.305 */
const withHole = {
  type: 'Polygon',
  coordinates: [
    [[121.50, 31.29], [121.52, 31.29], [121.52, 31.31], [121.50, 31.31], [121.50, 31.29]],
    [[121.505, 31.295], [121.515, 31.295], [121.515, 31.305], [121.505, 31.305], [121.505, 31.295]]
  ]
}

const district = (name, geom, extra = {}) => ({
  name, geometry: geom, score: 74, population: 196440, work: 88000, visit: 12000,
  crowd: '商务主导', level: '核心级', resident: '', competitorCount: 3, myStoreCount: 1,
  income: { low: 10, midLow: 20, wellOff: 30, mid: 25, affluent: 10, rich: 5 },
  ...extra
})

describe('A. 点在面内的判定（含洞）', () => {
  it('环内 / 环外', () => {
    expect(pointInRing(121.51, 31.30, square.coordinates[0])).toBe(true)
    expect(pointInRing(121.60, 31.30, square.coordinates[0])).toBe(false)
  })

  it('Polygon 内含洞：洞里不算在面内', () => {
    expect(pointInGeometry(withHole, 121.51, 31.30)).toBe(false)
    expect(pointInGeometry(withHole, 121.502, 31.292)).toBe(true)
  })

  it('MultiPolygon：任一面命中即可', () => {
    const multi = { type: 'MultiPolygon', coordinates: [square.coordinates, [[[122.0, 31.0], [122.01, 31.0], [122.01, 31.01], [122.0, 31.01], [122.0, 31.0]]]] }
    expect(pointInGeometry(multi, 121.51, 31.30)).toBe(true)
    expect(pointInGeometry(multi, 122.005, 31.005)).toBe(true)
    expect(pointInGeometry(multi, 121.9, 31.3)).toBe(false)
  })

  it('点到环的距离是米级量级（0.01 度经度 ≈ 950m @31°N）', () => {
    const d = distanceToRingM(121.53, 31.30, square.coordinates[0])
    expect(d).toBeGreaterThan(800)
    expect(d).toBeLessThan(1100)
  })
})

describe('B. 取商圈：包含优先，否则取最近并给距离', () => {
  it('点在面内 ⇒ contained=true、distance=0', () => {
    const r = pickDistrictForPoint([district('五角场', square)], 31.30, 121.51)
    expect(r.contained).toBe(true)
    expect(r.distanceM).toBe(0)
    expect(r.district.name).toBe('五角场')
  })

  it('不在任何面内 ⇒ 取最近的一个，且 contained=false（⛔ 不许伪装成就落在这个商圈里）', () => {
    const far = district('人民广场', { type: 'Polygon', coordinates: [[[121.46, 31.22], [121.48, 31.22], [121.48, 31.24], [121.46, 31.24], [121.46, 31.22]]] })
    const r = pickDistrictForPoint([district('五角场', square), far], 31.40, 121.60)
    expect(r.contained).toBe(false)
    expect(r.distanceM).toBeGreaterThan(0)
    expect(r.district).toBeTruthy()
  })

  it('无商圈数据 ⇒ district=null（报告要如实说"未匹配"）', () => {
    expect(pickDistrictForPoint([], 31.3, 121.5).district).toBeNull()
    expect(pickDistrictForPoint(null, 31.3, 121.5).district).toBeNull()
  })

  it('评分转星级：74 → 3.5 星；100 → 5；脏值 → 0', () => {
    expect(scoreToStars(74)).toBe(3.5)
    expect(scoreToStars(100)).toBe(5)
    expect(scoreToStars(0)).toBe(0)
    expect(scoreToStars(null)).toBe(0)
  })

  it('米数显示：<1000 用 m，≥1000 用 km', () => {
    expect(fmtM(320)).toBe('320 m')
    expect(fmtM(1500)).toBe('1.5 km')
    expect(fmtM(null)).toBe('未知')
  })
})

describe('C. 报告模型：只陈述有出处的事实', () => {
  const cand = {
    name: '五角场万达 3F 中庭', brand: '食其家', city: '上海', district: '杨浦区',
    address: '邯郸路 600 号', latitude: 31.30, longitude: 121.51, radius: 1000,
    area: 120, rent: 45000, stage: '已勘踏'
  }

  it('有商圈时：商圈画像、人口、评分、竞争齐全', () => {
    const hit = pickDistrictForPoint([district('五角场', square)], cand.latitude, cand.longitude)
    const m = buildReportModel(cand, hit)
    expect(m.district.name).toBe('五角场')
    expect(m.district.contained).toBe(true)
    expect(m.district.population).toBe(196440)
    const labels = m.facts.map((f) => f.label)
    expect(labels).toContain('商圈居住人口')
    expect(labels).toContain('商圈竞争评分')
    expect(labels).toContain('租金水平')
    // 租金单价 = 45000 / 120 = 375.0
    expect(m.facts.find((f) => f.label === '租金水平').value).toBe('375.0 元/㎡/月')
  })

  it('同商圈已有自家门店 ⇒ 必须出一条自我蚕食风险', () => {
    const hit = pickDistrictForPoint([district('五角场', square)], cand.latitude, cand.longitude)
    const m = buildReportModel(cand, hit)
    expect(m.risks.join('|')).toMatch(/自我蚕食/)
  })

  it('🔴 无商圈时如实说"未匹配"，并明确人口/竞争不可用（⛔ 不补 0 冒充）', () => {
    const m = buildReportModel(cand, { district: null, contained: false, distanceM: null })
    expect(m.district).toBeNull()
    expect(m.facts.find((f) => f.label === '所在商圈').value).toBe('未匹配到商圈')
    expect(m.risks.join('|')).toMatch(/未匹配到商圈面/)
    expect(m.provenance.sample).toContain('无商圈面')
  })

  it('缺面积/租金 ⇒ 进风险清单，且不编租金单价', () => {
    const bare = { ...cand, area: null, rent: null }
    const m = buildReportModel(bare, { district: null })
    expect(m.facts.some((f) => f.label === '租金水平')).toBe(false)
    expect(m.risks.join('|')).toMatch(/面积未填写/)
    expect(m.risks.join('|')).toMatch(/月租金未填写/)
    expect(m.completeness).toContain('面积')
  })

  it('🔴🔴 报告里不许出现预测/营业额类表述（store_sales 无真实数据，任何预测都是编的）', () => {
    const hit = pickDistrictForPoint([district('五角场', square)], cand.latitude, cand.longitude)
    const text = JSON.stringify(buildReportModel(cand, hit))
    for (const bad of ['预计', '预测销售', '预计营业额', '日销', '月销', '翻台', '坪效预估']) {
      expect(text, `报告模型里出现了「${bad}」——无销售数据支撑，⛔ 不许写`).not.toContain(bad)
    }
  })

  it('🔴 期次不许编：没刷新过就是"未标注"，且不出现具体年月', () => {
    const hit = pickDistrictForPoint([district('五角场', square)], cand.latitude, cand.longitude)
    const m = buildReportModel(cand, hit)
    expect(m.provenance.period).toContain('未标注')
    expect(m.provenance.period).not.toMatch(/\d{4}\s*年\s*\d{1,2}\s*月/)
  })

  it('评分口径必须写明"是商圈面评分、非点位自身评分"', () => {
    const hit = pickDistrictForPoint([district('五角场', square)], cand.latitude, cand.longitude)
    const m = buildReportModel(cand, hit)
    const scoreFact = m.facts.find((f) => f.label === '商圈竞争评分')
    expect(scoreFact.note).toContain('非该点位自身评分')
  })
})

describe('D. 源码约束（报告组件不许自己另算一套）', () => {
  const COMP = read('frontend/src/components/CandidateReport.vue')
  const STRIPPED = COMP.replace(/<!--[\s\S]*?-->/g, '')

  it('组件只消费 utils/candidateReport.js，⛔ 不内联结论文案', () => {
    expect(COMP).toContain("from '@/utils/candidateReport.js'")
    expect(STRIPPED).not.toContain('自我蚕食')   // 这类判断只在 util 里
  })

  it('🔴 AI 建议默认关闭（wantAi 初值 false）—— 不勾就不花钱', () => {
    expect(STRIPPED).toMatch(/const wantAi = ref\(false\)/)
  })

  it('AI 建议必须过 VIP 门禁（⛔ 不就地写 role 判等）', () => {
    expect(COMP).toContain('userStore.isVipActive')
    expect(STRIPPED).not.toMatch(/role\s*===\s*['"]vip['"]/)
  })

  it('🔴 地图截图的返回类型要兼容（captureMapOnlyCanvas 返回 dataURL 字符串，不是 canvas）', () => {
    // 踩过：当成 canvas 用 res.toDataURL ⇒ undefined ⇒ 被 if 静默跳过 ⇒ 报告地图空白且无报错
    expect(COMP).toContain('captureMapOnlyCanvas')
    expect(COMP).toMatch(/typeof res === 'string'/)
    expect(COMP).toContain("typeof res.toDataURL === 'function'")
  })

  it('🔴 PDF 必须严格 A4 纵向（⛔ 不许回到按内容高度自定义纸张）', () => {
    expect(COMP).toContain('A4_H = 297')
    expect(COMP).toMatch(/format: \[A4_W, A4_H\]/)
    // 旧写法：按内容高度出纸 ⇒ 一张超长页
    expect(COMP).not.toMatch(/format: \[imgWidth, imgHeight/)
    expect(COMP).toMatch(/availH \/ rawH/)
  })

  it('🔴 缩放不下就分页，⛔ 不许一路缩到 4~5pt（业主 2026-11-09 定「含 AI 出两页」）', () => {
    // 可读阈值必须存在且为 0.72（低于此正文字号 ≈4~5pt）
    expect(COMP).toMatch(/MIN_READABLE = 0\.72/)
    expect(COMP).toContain('MIN_READABLE')
    // 必须真的有分页：addPage + 切点找空白行
    expect(COMP).toContain('pdf.addPage')
    expect(COMP).toContain('findCutY')
    // 分页必须走「均分缩放」，⛔ 不是把一张缩到很小的图查成 N 页
    expect(COMP).toMatch(/\(rawH \/ pages\) \/ availH/)
    // 页数要有兜底上限（防止异常高度出几十页）
    expect(COMP).toContain('MAX_PAGES')
  })

  it('🔴 地图图必须固定 height 才能用 object-fit（否则高度被压、宽度不变 ⇒ 圆变椭圆）', () => {
    // 2026-11-09 真机：半径 1km 的正圆在报告里显示成横向椭圆
    const m = COMP.match(/\.rp-map img \{[^}]*\}/)
    expect(m).toBeTruthy()
    const rule = m[0]
    expect(rule).toContain('object-fit: cover')
    // 固定高度（不是 height:auto + max-height 那种假裁切）
    expect(rule).toMatch(/height:\s*\d+px/)
    expect(rule).not.toMatch(/height:\s*auto/)
    expect(rule).not.toContain('max-height')
  })


  it('🔴 切点候选必须是区块级（⛔ 不许把标题留在上页、正文翻到下页）', () => {
    // 实测踩到：候选里收了 `.rp-ai-body` ⇒ 切点落在「AI 选址建议」标题与正文之间
    const fn = COMP.slice(COMP.indexOf('function collectCutCandidates'), COMP.indexOf('function pickCutY'))
    expect(fn).toBeTruthy()
    const sel = fn.match(/querySelectorAll\('([^']+)'\)/)
    expect(sel).toBeTruthy()
    expect(sel[1]).toContain('.rp-sec')
    expect(sel[1]).toContain('.rp-table tr')
    expect(sel[1]).not.toContain('.rp-ai-body')
    // 调色板：DOM 边界优先于像素扫描
    expect(COMP).toContain('pickCutY')
    expect(COMP).toMatch(/cuts\.filter/)
  })

  it('导出走 html2canvas + jsPDF 动态 import（不把 pdf 库拖进首屏）', () => {
    expect(COMP).toContain("await import('html2canvas')")
    expect(COMP).toContain("await import('jspdf')")
  })
})
