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
  pickDistrictForPoint, scoreToStars, buildReportModel, fmtM, radiusText
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

  it('有商圈时：商圈名/评分/竞争齐全，但人口**未取联通就为空**', () => {
    const hit = pickDistrictForPoint([district('五角场', square)], cand.latitude, cand.longitude)
    const m = buildReportModel(cand, hit)
    expect(m.district.name).toBe('五角场')
    expect(m.district.contained).toBe(true)
    // 🔴 v1.13.340：人口只认联通配额数据 —— 商圈面上的 population 不许回落到报告
    expect(m.district.hasPop).toBe(false)
    expect(m.district.population).toBeNull()
    const labels = m.facts.map((f) => f.label)
    expect(labels).toContain('半径内人口')
    expect(m.facts.find((f) => f.label === '半径内人口').value).toBe('未获取')
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
    expect(m.provenance.sample).toContain('无人口样本')
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

/**
 * G. 🔴🔴 报告人口必须来自**联通按次配额**（v1.13.340，业主 2026-11-09 定）
 *
 * 原来人口取的是商圈边界面的属性（`居住/工作/到访` 三列）。业主否掉了：
 * 「人口数据不要用商圈边界面数据，原则上用收费的联通人口配额」。
 * 这里钉三件事：
 *   ① 没取到联通数据 ⇒ hasPop=false，**⛔ 不回落到商圈面的 population**
 *   ② 取到了 ⇒ 只用联通的值（哪怕商圈面另有数值）
 *   ③ 打开报告**不许**自动扣配额（只有用户点按钮才能 POST /smartsteps/population）
 */
describe('G. 人口只认联通配额，且与「我的门店」打通（点位+半径口径）', () => {
  const cand = {
    name: '五角场万达 3F 中庭', brand: '食其家', city: '上海', district: '杨浦区',
    address: '邯郸路 600 号', latitude: 31.30, longitude: 121.51, radius: 1000,
    area: 120, rent: 45000
  }
  const pop = {
    visit: 39073425, live: 399275, work: 335771, total: 410000,
    male: { live: 195000, work: 170000 }, female: { live: 204275, work: 165771 },
    ages: { live: [{ label: '19-24岁', value: 90000 }, { label: '25-29岁', value: 70000 }, { label: '30-34岁', value: 50000 }], work: [] },
    arpu: { live: [['50元以下', 5000], ['50-100元', 15000], ['100-150元', 9000], ['150-200元', 3000], ['200-250元', 1000], ['250元以上', 500]].map(([label, value]) => ({ label, value })), work: [] }
  }

  it('🔴 没取联通数据时，不许拿商圈面的 population 顶上去', () => {
    const hit = pickDistrictForPoint([district('五角场', square)], cand.latitude, cand.longitude)
    const m = buildReportModel(cand, hit)
    expect(m.district.hasPop).toBe(false)
    expect(m.district.population).toBeNull()
    expect(m.district.work).toBeNull()
    expect(m.district.visit).toBeNull()
    expect(JSON.stringify(m)).not.toContain('196440')
    expect(m.facts.find((f) => f.label === '半径内人口').value).toBe('未获取')
    expect(m.risks.join('|')).toMatch(/尚未获取联通人口数据/)
  })

  it('★ 取到联通数据 ⇒ 三项 + 期次 + **半径口径标签**', () => {
    const hit = pickDistrictForPoint([district('五角场', square)], cand.latitude, cand.longitude)
    const m = buildReportModel(cand, hit, { population: pop, popMonth: '202510', popRadius: 1000 })
    expect(m.district.hasPop).toBe(true)
    expect(m.district.population).toBe(399275)
    expect(m.district.popRadius).toBe(1000)
    expect(JSON.stringify(m)).not.toContain('196440')   // 商圈面那条仍未出现
    expect(m.provenance.period).toContain('202510')

    // 🔴 标签必须写清「半径」，⛔ 不许写「商圈居住人口」（那是另一套口径）
    const labels = m.facts.map((f) => f.label)
    expect(labels).toContain('半径 1km 内居住人口')
    expect(labels).toContain('半径 1km 内工作人口')
    expect(labels).toContain('半径 1km 内到访人次')
    expect(labels).not.toContain('商圈居住人口')
    expect(m.facts.find((f) => f.label === '半径 1km 内到访人次').note).toMatch(/人次|人数/)
  })

  it('半径文案：1km / 3km / 500m', () => {
    expect(radiusText(1000)).toBe('1km')
    expect(radiusText(3000)).toBe('3km')
    expect(radiusText(1500)).toBe('1.5km')
    expect(radiusText(500)).toBe('500m')
    expect(radiusText(null)).toBe('')
  })

  it('口径页脚必须把「人口=半径」与「评分=商圈面」分开写', () => {
    const hit = pickDistrictForPoint([district('五角场', square)], cand.latitude, cand.longitude)
    const m = buildReportModel(cand, hit, { population: pop, popMonth: '202510', popRadius: 3000 })
    expect(m.provenance.source).toContain('点位半径 3km')
    expect(m.provenance.source).toContain('商圈面基线')
    expect(m.provenance.sample).toMatch(/圆口径/)
    expect(m.provenance.sample).toMatch(/非商圈面口径/)
  })
})

describe('H. 打通「我的门店」已购数据（后端取数优先级）', () => {
  const SS = read('backend/src/routes/smartsteps.js')

  it('🔴 顺序必须是 purchases → cache → 配额闸门（复用优先，⛔ 先拦配额）', () => {
    const i = SS.indexOf("router.post('/population'")
    expect(i).toBeGreaterThan(-1)
    const body = SS.slice(i, SS.indexOf('export default router', i))
    const iP = body.indexOf('FROM purchases')
    const iC = body.indexOf('smartsteps_cache')
    const iG = body.indexOf('checkQuota(')
    expect(iP).toBeGreaterThan(-1)
    expect(iC).toBeGreaterThan(iP)
    // 🔴 闸门必须在**两个复用都试过之后**才出现 —— 提前一步就会把"能免费复用"的用户挡在门外
    expect(iG).toBeGreaterThan(iP)
    expect(iG).toBeGreaterThan(iC)
  })

  it('🔴 坐标容差 10m（业主 2026-11-09 定），SQL 只做矩形粗筛 + haversine 精判', () => {
    expect(SS).toContain('REUSE_TOL_M = 10')
    expect(SS).toContain('distMeters(')
    // 粗筛框必须存在（否则全表拉 transactions 太慢）
    expect(SS).toMatch(/center_lat BETWEEN \? AND \?/)
  })

  it('半径只开放 1/3/5km 三档（面积 3.1/28.3/78.5 km²，都在联通 0.3~80 限制内）', () => {
    expect(SS).toContain('REPORT_RADII = [1000, 3000, 5000]')
    // 前端选项必须与后端一致
    const comp = read('frontend/src/components/CandidateReport.vue')
    expect(comp).toContain('RADIUS_OPTIONS = [1000, 3000, 5000]')
  })

  it('purchases.radius 存的是 JSON 字符串，必须解析后比对（⛔ 用 LIKE 会误命中）', () => {
    expect(SS).toContain('radiusIncludes')
    expect(SS).toContain('JSON.parse')
  })

  it('🔴 probeOnly 必须只查复用 —— ⛔ 不碰闸门、不调上游', () => {
    const i = SS.indexOf('if (body.probeOnly)')
    expect(i).toBeGreaterThan(-1)
    const body = SS.slice(i, SS.indexOf('// ── ③', i))
    expect(body).toContain("source: 'none'")
    expect(body).not.toContain('checkQuota')
    expect(body).not.toContain('getData')
  })

  it('🔴 复用不要求同月份（过期就重新收费＝坑用户），但必须回传期次', () => {
    const i = SS.indexOf("router.post('/population'")
    const body = SS.slice(i, i + 6000)
    expect(body).toContain('dataMonth: row.city_month')
    expect(body).toContain('dataMonth: cached.city_month')
    // 查已购时不许出现 city_month = ? 这种同月限制
    const purchaseQuery = body.slice(body.indexOf('FROM purchases') - 400, body.indexOf('FROM purchases'))
    expect(purchaseQuery).not.toMatch(/city_month\s*=\s*\?/)
  })

  it('取到数据必须同时写 purchases 与 cache（否则下次不能复用）', () => {
    const i = SS.indexOf("router.post('/population'")
    const body = SS.slice(i, i + 6000)
    expect(body).toContain('INSERT INTO purchases')
    expect(body).toContain('saveToCache')
  })

  it('上游成功但无数据 ⇒ 不扣费（与 /query 的空数据返还同口径）', () => {
    const i = SS.indexOf("router.post('/population'")
    const body = SS.slice(i, i + 6000)
    expect(body).toMatch(/联通未返回可用人口数据（本次未消耗配额）/)
  })
})

describe('I. 前端交互（探测免费 / 不预检配额 / VIP 拦截）', () => {
  const COMP = read('frontend/src/components/CandidateReport.vue')

  it('🔴 打开报告只做 probeOnly 探测，⛔ 不调会扣费的取数', () => {
    const i = COMP.indexOf('async function onOpened')
    const body = COMP.slice(i, COMP.indexOf('async function renderMap', i))
    expect(body).toContain('probePopulation')
    expect(body).not.toContain('fetchPopulation')
    const p = COMP.indexOf('async function probePopulation')
    const pBody = COMP.slice(p, COMP.indexOf('async function onRadiusChange', p))
    expect(pBody).toContain('probeOnly: true')
    expect(pBody).not.toContain('checkQuota')
  })

  it('🔴 前端不许预检配额 —— 否则「能免费复用」也被拦掉', () => {
    const i = COMP.indexOf('async function fetchPopulation')
    const body = COMP.slice(i, i + 2600)
    // 不能在弹确认之前就跑 available < 1 的分支
    const confirmIdx = body.indexOf('ElMessageBox.confirm')
    const precheckIdx = body.indexOf('available < 1')
    expect(confirmIdx).toBeGreaterThan(-1)
    expect(precheckIdx === -1 || precheckIdx > confirmIdx,
      '配额预检不能挡在确认框之前：复用是免费的，池空时也可能取到数据').toBe(true)
  })

  it('切换半径必须清空已取数据（⛔ 别把 1km 的数挂到 3km 标签下）', () => {
    expect(COMP).toMatch(/watch\(popRadius/)
    const i = COMP.indexOf('watch(popRadius')
    const body = COMP.slice(i, i + 300)
    expect(body).toContain('popData.value = null')
  })

  it('配额不足走统一引导出口（⛔ 不就地写联系方式）', () => {
    expect(COMP).toContain('requireQuota')
    expect(COMP).toContain('QUOTA_REASON')
    expect(COMP).not.toMatch(/138\s*1779\s*1741/)
    expect(COMP).not.toContain('jyo@youshi-tech.com')
  })

  it('AI 勾选必须拦住非 VIP 并给出申请路径（⛔ 不能只把 checkbox 禁用）', () => {
    expect(COMP).toContain('onWantAiChange')
    expect(COMP).toContain('VIP 专属')
    expect(COMP).toContain('/account')
    expect(COMP).not.toMatch(/:disabled="!isVip\s*\|\|/)
  })
})


/**
 * J. 341 收尾：改写 G/H/I 组时曾把 340 的两条守卫一起删掉 ⇒ 这里补回并钉死。
 *    ⚠️ 教训：换端点/换取数口径时，**只删「已不适用的」断言**，别把同文件里 unrelated 的守卫一起替换掉。
 */
describe('J. 341 收尾：守卫不许在改写中丢失', () => {
  const DS = read('backend/src/routes/districts.js')
  const COMP2 = read('frontend/src/components/CandidateReport.vue')

  it('🔴 商圈定位必须先归一化字段名（340 修的真 bug：换版城市刷新必 404）', () => {
    const i = DS.indexOf('function resolveBoundary')
    expect(i).toBeGreaterThan(-1)
    const body = DS.slice(i, i + 900)
    expect(body).toContain('normalizeDistrictProps')
    expect(body).not.toContain("(ft.properties || {})['名称']")
  })

  it('🔴 refresh 两条返回分支都要带完整 1001 人口', () => {
    const i = DS.indexOf("router.post('/refresh'")
    expect(i).toBeGreaterThan(-1)
    const body = DS.slice(i, i + 4000)
    expect((body.match(/population: parsePopulation1001\(/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('⭐ radiusText 只有一份：组件必须 import，⛔ 不许本地再写一份（派生函数单一来源）', () => {
    expect(COMP2).toContain('buildReportModel, fmtM, radiusText')
    expect(COMP2).not.toMatch(/const radiusText\s*=/)
  })

  it('🔴 切换半径要自动免费重探（否则「已购数据自动复用」失效）', () => {
    expect(COMP2).toContain('@change="onRadiusChange"')
    const i = COMP2.indexOf('async function onRadiusChange')
    expect(i).toBeGreaterThan(-1)
    const body = COMP2.slice(i, i + 400)
    expect(body).toContain('nextTick()')
    expect(body).toContain('probePopulation()')
  })

  it('🔴 探测要有序号防竞态（切半径后旧请求不许回填）', () => {
    expect(COMP2).toContain('seq !== probeSeq')
  })
})
