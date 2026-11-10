/**
 * v1.13.344：自有品牌 → 竞品品牌集合（P0+P1）源码守卫
 *
 * 背景：账号下可能有多个自有品牌（生产实测 user 4/18/25/26/27 都是滨寿司 + 食其家）。
 *   竞品表 competitors.brand 是「竞品品牌」，读路径却是 WHERE user_id IN (...) 的账号单池，
 *   A 的竞品和 B 的竞品会被相加 ⇒ 商圈竞争分 / 体检信号灯 / AI 周边全部偏红。
 *
 * 本守卫钉死三件事：
 *   ① 数据层：两张表（头表区分「未配置」与「显式空集」）+ 单一 util + 配置 API 挂载；
 *   ② 读路径：P0 四个结论型 + P1 展示导出都必须走同一份 competitorWhere；
 *   ③ 不变量：未配置＝退回全量（老行为逐字节不变）、空集≠全量、缓存 key 含品牌、
 *      可见域 readableUserIds 不变、admin 不放大、写接口挂鉴权。
 *
 * ⚠️ 注释必须剥掉再断言，否则注释里的旧写法会骗到扫描器（假绿灯）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(REPO, p))
const src = (p) => (exists(p) ? strip(read(p)) : '')

/** 剥注释：块注释 + 行注释（保护 https:// 这类带冒号的斜杠） */
function strip(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const P = {
  db: 'backend/src/models/database.js',
  util: 'backend/src/utils/competitorScope.js',
  route: 'backend/src/routes/brand-competitor-map.js',
  app: 'backend/src/app.js',
  districtCount: 'backend/src/utils/districtCount.js',
  districts: 'backend/src/routes/districts.js',
  markers: 'backend/src/routes/markers.js',
  ai: 'backend/src/routes/ai.js',
  competitors: 'backend/src/routes/competitors.js',
  dashboard: 'backend/src/routes/dashboard.js',
  shapefiles: 'backend/src/routes/shapefiles.js',
  storeCompetitor: 'frontend/src/stores/competitor.js',
  competitorView: 'frontend/src/views/CompetitorView.vue',
  districtView: 'frontend/src/views/DistrictInsightView.vue',
  checkupView: 'frontend/src/views/StoreCheckupView.vue',
  dataView: 'frontend/src/views/DataView.vue'
}

describe('A. 数据层与单一口径', () => {
  it('A1 新增两张表：scope 头表 + map 明细表', () => {
    const d = src(P.db)
    expect(d).toContain('CREATE TABLE IF NOT EXISTS brand_competitor_scope')
    expect(d).toContain('CREATE TABLE IF NOT EXISTS brand_competitor_map')
    expect(d).toContain('UNIQUE(user_id, my_brand, competitor_brand)')
  })

  it('A2 新增 utils/competitorScope.js 并导出四个单一口径函数', () => {
    expect(exists(P.util), '缺少 competitorScope.js').toBe(true)
    const u = src(P.util)
    for (const fn of ['resolveCompBrands', 'competitorWhere', 'scopeCacheKey', 'brandScopeMeta']) {
      expect(u).toContain('export function ' + fn)
    }
    expect(u).toContain("from './storeDedup.js'")
  })

  it('A3 配置 API 独立前缀挂载，且写接口挂 authenticate', () => {
    expect(exists(P.route), '缺少 brand-competitor-map.js').toBe(true)
    expect(src(P.app)).toContain("app.use('/api/brand-competitor-map'")
    const r = src(P.route)
    const writes = r.match(/router\.(post|put|patch|delete)\(/g) || []
    expect(writes.length, '至少要有写接口').toBeGreaterThan(0)
    // 每个写接口都要挂 authenticate（routeAuthGuard 会另行全局扫描，这里钉死本文件）
    for (const m of r.matchAll(/router\.(post|put|patch|delete)\([^)]*\)/g)) {
      expect(m[0], '写接口未挂 authenticate：' + m[0]).toContain('authenticate')
    }
  })

  it('A4 映射表不进集团同步品牌候选集', () => {
    const sync = src('backend/src/routes/sync.js')
    expect(sync).not.toContain('brand_competitor_map')
  })
})

describe('B. P0 结论型读路径（未配置时必须与老口径一致）', () => {
  it('B1 districtCount：签名带 compBrands、缓存 key 含 scopeCacheKey、SQL 品牌条件后置', () => {
    const d = src(P.districtCount)
    expect(d).toContain('countCompetitorsInDistrict(geometry, ids, compBrands')
    expect(d).toContain("'comp|' + scopeKeyOf(ids)")
    expect(d).toContain("+ scopeCacheKey(compBrands)")
    expect(d).toContain('competitorWhere(')
    // 反向：品牌条件必须拼在 user_id IN 之后（保住 districtCountScopeGuard 的 240 字符窗口）
    expect(d).toMatch(/user_id IN \(\$\{ph\}\)\$\{brandSql\}/)
  })

  it('B2 districts.js 两个 GET 都解析 brand 并透传第三参', () => {
    const d = src(P.districts)
    expect(d).toContain('resolveCompBrands(')
    expect((d.match(/countCompetitorsInDistrict\(feature\.geometry, scopeIds, compBrands\)/g) || []).length).toBe(2)
    expect(d).toContain('brandScope')
  })

  it('B3 markers.js 体检竞品取数走同一份 competitorWhere', () => {
    const m = src(P.markers)
    expect(m).toContain('competitorWhere(')
    expect(m).toContain('resolveCompBrands(')
    expect(m).toMatch(/FROM competitors[\s\S]{0,240}?user_id IN/)
  })

  it('B4 ai.js 周边上下文透传品牌，且 /site-advice 用已有 brand 字段', () => {
    const a = src(P.ai)
    expect(a).toContain('buildSurroundingContext(lat, lng, radii, userId, compBrands')
    expect(a).toContain('resolveCompBrands(')
    expect(a).toMatch(/buildSurroundingContext\([\s\S]{0,240}?compBrands\)/)
  })
})

describe('C. P1 展示与导出读路径', () => {
  it('C1 /api/competitors 三个读端点支持 myBrand 并返回 brandScope', () => {
    const c = src(P.competitors)
    // v1.13.351 起列表端点改用 resolveBrandScope（带 source 的完整版，内部复用同一份解析），
    // 断言放宽到两个入口，但仍要求**三个读端点都必须走统一解析**（⛔ 不许各写一份）
    expect((c.match(/resolve(?:CompBrands|BrandScope)\(/g) || []).length).toBeGreaterThanOrEqual(3)
    expect(c).toContain('myBrand')
    expect(c).toContain('brandScope')
    // 反向扫描：⛔ 不许在路由里手写 `AND brand IN (...)`（344 的单一实现铁律）
    expect(c).not.toMatch(/UPPER\(TRIM\(COALESCE\(brand/i)
  })

  it('C2 dashboard 缓存 key 含品牌，避免 A/B 互相命中', () => {
    const d = src(P.dashboard)
    expect(d).toContain('scopeCacheKey(')
    expect(d).toMatch(/cacheKey[\s\S]{0,160}scopeCacheKey/)
  })

  it('C3 shapefiles 开店余地竞品补 user_id（原为全平台裸查询）', () => {
    const s = src(P.shapefiles)
    expect(s).toMatch(/FROM competitors WHERE user_id IN/)
    expect(s).toContain('readableUserIds(')
  })

  it('C4 前端 store 带 myBrand 且新鲜期 key 含品牌', () => {
    const s = src(P.storeCompetitor)
    expect(s).toContain('myBrand')
    expect(s).toContain('lastMyBrand')
    expect(s).toContain('brandScopeMap')
  })

  it('C5 CompetitorView 有分析品牌下拉 + 配置弹窗 + 对应自有品牌列', () => {
    const v = read(P.competitorView)
    expect(v).toContain('analysisBrand')
    expect(v).toContain('对应自有品牌')
    expect(v).toContain('openMapConfig')
  })

  it('C6 商圈洞察列表与详情都拼 brand，避免两处分数不一致', () => {
    const v = src(P.districtView)
    expect(v).toContain('analysisBrand')
    expect(v).toContain('/api/districts/detail')
    expect(v).toMatch(/detail\?[^\n]*brand=/)
  })

  it('C7 门店体检 lights 与 report 都拼 brand', () => {
    const v = src(P.checkupView)
    expect(v).toContain('analysisBrand')
    expect(v).toContain('/api/markers/checkup/lights')
    expect(v).toContain('/api/markers/checkup/report')
  })

  it('C8 圆分析按门店品牌匹配映射，不再用账号全池', () => {
    const v = src(P.dataView)
    expect(v).toContain('brandScopeMap')
    expect(v).toContain('storeBrand')
  })
})

describe('D. 不变量与扫描有效性', () => {
  it('D1 未配置＝全量、空集≠全量（纯函数）', async () => {
    if (!exists(P.util)) throw new Error('competitorScope.js 尚未创建')
    const m = await import('../src/utils/competitorScope.js')
    expect(m.scopeCacheKey(null)).toBe('all')
    expect(m.scopeCacheKey([])).toBe('none')
    expect(m.scopeCacheKey(['老乡鸡'])).not.toBe(m.scopeCacheKey(['大米先生']))
    expect(m.competitorWhere(null).sql).toBe('')
    expect(m.competitorWhere([]).sql).toContain('1 = 0')
    expect(m.competitorWhere(['老乡鸡']).sql).toContain('IN (')
  })

  it('D2 normalizeBrand 归一（大小写/空白不敏感）', async () => {
    if (!exists(P.util)) throw new Error('competitorScope.js 尚未创建')
    const m = await import('../src/utils/competitorScope.js')
    expect(m.competitorWhere([' 老乡鸡 ']).params[0]).toBe('老乡鸡')
    expect(m.competitorWhere(['Starbucks']).params[0]).toBe('STARBUCKS')
  })

  it('D3 可见域与已合并行不变量仍在', () => {
    expect(src(P.districts)).toContain('readableUserIds')
    expect(src(P.markers)).toContain('readableUserIds(db, userId)')
    expect(src(P.districtCount)).toContain('merged_into IS NULL')
  })

  it('D4 扫描器有效：能识别到当前真实的竞品查询（防假绿灯）', () => {
    const all = [P.districtCount, P.markers, P.ai, P.competitors, P.dashboard]
      .map(src).join('\n')
    expect((all.match(/FROM competitors/g) || []).length).toBeGreaterThanOrEqual(5)
  })
})

describe('E. 两处真实缺陷的回归钉死', () => {
  it('E1 配置路由的归一函数来自 storeDedup（competitorScope 未 re-export，误引必 500）', () => {
    const r = src(P.route)
    expect(r).toContain("import { normalizeBrand } from '../utils/storeDedup.js'")
    const imports = r.match(/import \{[^}]*\} from '\.\.\/utils\/competitorScope\.js'/g) || []
    expect(imports.some(l => l.includes('normalizeBrand')), '不可从 competitorScope 导入 normalizeBrand').toBe(false)
  })

  it('E2 静态子路径 /export、/query/bounds 必须早于 GET /:id', () => {
    const c = src(P.competitors)
    const atExport = c.indexOf("router.get('/export'")
    const atBounds = c.indexOf("router.get('/query/bounds'")
    const atId = c.indexOf("router.get('/:id'")
    expect(atExport).toBeGreaterThan(-1)
    expect(atBounds).toBeGreaterThan(-1)
    expect(atId).toBeGreaterThan(-1)
    expect(atExport, '/export 被 GET /:id 吞掉会返回 404').toBeLessThan(atId)
    expect(atBounds).toBeLessThan(atId)
  })
})

describe('F. 配置页：拦截器口径与「不许静默覆盖」闸门', () => {
  it('F1 344 新增的 api 调用不得二次解包 { data }（utils/api 拦截器已返回 response.data）', () => {
    for (const p of [P.competitorView, P.districtView]) {
      expect(src(p), p + ' 出现二次解包，配置元数据会恒为 undefined').not.toMatch(/const \{ data \} = await api\./)
    }
  })

  it('F2 打开弹窗先拉元数据；未加载成功禁止保存/恢复全量', () => {
    const v = src(P.competitorView)
    expect(v).toContain('scopeMetaLoaded')
    expect(v).toMatch(/async function openMapConfig\(\)[\s\S]{0,200}await loadScopeMeta\(\)/)
    expect(v).toMatch(/async function saveMapScope\(\)[\s\S]{0,200}scopeMetaLoaded/)
    expect(v).toMatch(/async function resetMapScope\(\)[\s\S]{0,200}scopeMetaLoaded/)
    expect(v).toContain(':disabled="!mapMyBrand || !scopeMetaLoaded"')
  })
})
