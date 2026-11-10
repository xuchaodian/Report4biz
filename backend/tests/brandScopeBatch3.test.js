/**
 * v1.13.346：竞品品牌映射「第三批」源码守卫（C1 立项报告 + C3 开店余地）
 *
 * 背景（345 收尾后复核出的两处「后端早备好、前端没传」）：
 *   C1 立项报告：`/api/districts?city=&brand=` 自 344 起就支持 brand
 *      （districts.js 取 req.query.brand → resolveCompBrands → countCompetitorsInDistrict），
 *      但 `CandidateReport.vue` 调接口时只传了 city ⇒ 报告里的「商圈内竞品」
 *      永远是全量口径，与 345 刚统一的按品牌口径对不上。
 *      ⚠️ 该调用用的是**裸 axios**（不是 utils/api.js），响应未解包 ⇒ `const { data }` 是对的。
 *   C3 开店余地：`/api/shapefiles/calculate-potential` 自 344 起就读 req.body.myBrand
 *      （resolveCompBrands 收窄竞品集合），但前端从未传过 ⇒ 该分支恒为全量。
 *
 * 本守卫钉死：
 *   C1-1~C1-4：立项报告把 candidate.brand 传下去、读回 brandScope、
 *              交给 buildReportModel、报告按三态写口径注记；
 *   C3-1~C3-4：开店余地有「分析品牌」、提交时传 myBrand、
 *              映射生效时竞争品牌选项随之收窄（防交集恒 0）、切品牌清空已勾选。
 *
 * ⚠️ 注释必须剥掉再断言，否则解释性文字会把缺失的代码「挡住」。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(REPO, p))

/** 剥注释：块注释 + 行注释（保护 https:// 这类带冒号的斜杠） */
function strip(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const src = (p) => (exists(p) ? strip(read(p)) : '')

const P = {
  report: 'frontend/src/components/CandidateReport.vue',
  reportUtil: 'frontend/src/utils/candidateReport.js',
  mapView: 'frontend/src/views/MapView.vue',
  districts: 'backend/src/routes/districts.js',
  shapefiles: 'backend/src/routes/shapefiles.js'
}

describe('C1. 立项报告按候选点位品牌收窄', () => {
  it('C1-1 调 /api/districts 时必须把 candidate.brand 一起传下去', () => {
    const s = src(P.report)
    expect(s, '文件缺失或路径写错').toContain("axios.get('/api/districts'")
    // 同一处 params 里必须出现 brand，且取的是候选点位自己的品牌
    expect(s, '未传 brand ⇒ 报告竞品永远是全量口径').toMatch(
      /axios\.get\('\/api\/districts',\s*\{\s*params:\s*\{[^}]*brand[^}]*\}\s*\}/
    )
    expect(s, 'brand 必须来自 candidate，而不是别处的全局状态').toMatch(
      /brand:\s*props\.candidate\.brand/
    )
  })

  it('C1-2 必须读回 brandScope（后端 344 起已返回），否则无法区分「未配置」与「已收窄」', () => {
    const s = src(P.report)
    expect(s, '未接收 brandScope').toMatch(/data\.brandScope/)
    expect(s, 'brandScope 必须落成响应式状态供报告使用').toMatch(/brandScope\s*=\s*ref\(/)
  })

  it('C1-3 brandScope 必须真正传给 buildReportModel（只存不用＝假接线）', () => {
    const s = src(P.report)
    expect(s, 'buildReportModel 调用里没有 brandScope').toMatch(
      /buildReportModel\([^)]*\{[\s\S]{0,220}?brandScope/
    )
  })

  it('C1-4 报告必须按三态写口径注记（未指定 / 未配置 / 已收窄）', () => {
    const u = src(P.reportUtil)
    expect(u, '未读取 opts.brandScope').toMatch(/opts\.brandScope/)
    expect(u, '缺少「未指定自有品牌」注记').toContain('未指定自有品牌')
    expect(u, '缺少「未配置竞品映射」注记').toContain('未配置竞品映射')
    expect(u, '缺少「已按品牌映射收窄」注记').toContain('已按品牌映射收窄')
  })
})

describe('C3. 开店余地传 myBrand', () => {
  it('C3-1 对话框必须有「分析品牌」入口，且选项来自我的品牌', () => {
    const s = src(P.mapView)
    expect(s, '缺少分析品牌 ref').toMatch(/const\s+potentialBrand\s*=\s*ref\(/)
    expect(s, '缺少「分析品牌」表单项').toContain('分析品牌')
  })

  it('C3-2 提交时必须把 myBrand 传给 calculate-potential', () => {
    const s = src(P.mapView)
    expect(s, '请求体没有 myBrand ⇒ 后端收窄分支恒不走').toMatch(
      /myBrand:\s*potentialBrand\.value/
    )
  })

  it('C3-3 映射生效时竞争品牌选项必须收窄（否则勾到映射外 ⇒ 交集恒 0）', () => {
    const s = src(P.mapView)
    const opts = s.match(/const\s+potentialCompBrandOptions\s*=\s*computed\(([\s\S]*?)\n\}\)/)
    expect(opts, '未找到 potentialCompBrandOptions 定义').toBeTruthy()
    expect(opts[1], '竞争品牌选项未受分析品牌影响').toMatch(/potentialBrand\.value/)
    expect(opts[1], '必须走 utils/brandScope.js 的统一口径').toMatch(/scopeBrandsFor/)
  })

  it('C3-4 切换分析品牌必须清空已勾选的竞争品牌（防止旧选择跨品牌残留）', () => {
    const s = src(P.mapView)
    expect(s, '缺少切换品牌的清理逻辑').toMatch(
      /watch\(\s*potentialBrand[\s\S]{0,300}?potentialCompBrands\.value\s*=\s*\[\]/
    )
  })

  it('C3-5 映射为空集时必须有显式提示（否则「0 家竞品」会被当成好消息）', () => {
    const s = src(P.mapView)
    expect(s, '缺少空集判定').toMatch(/const\s+potentialScopeEmpty\s*=\s*computed\(/)
    expect(s, '空集时页面没有任何提示').toContain('竞品数恒为 0')
  })
})

describe('C. 扫描器自检（防路径写错造成的假绿）', () => {
  it('C-1 四个被守卫的文件都必须非空且体量合理', () => {
    for (const p of [P.report, P.reportUtil, P.mapView, P.districts, P.shapefiles]) {
      const raw = exists(p) ? read(p) : ''
      expect(raw.length, `${p} 缺失或过短`).toBeGreaterThan(1200)
    }
  })

  it('C-2 后端两个接口必须确实支持品牌参数（前端传了才有意义）', () => {
    const d = src(P.districts)
    expect(d, 'districts 不再读 brand').toMatch(/req\.query[\s\S]{0,60}brand|brand\s*\}\s*=\s*req\.query/)
    expect(d, 'districts 未接映射解析').toContain('resolveCompBrands')
    const sh = src(P.shapefiles)
    expect(sh, 'calculate-potential 不再读 myBrand').toMatch(/req\.body\.myBrand/)
  })
})
