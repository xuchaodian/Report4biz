/**
 * v1.13.345：竞品品牌映射「第二批」源码守卫（A 批购买履历 + B 批网点优化）
 *
 * 背景（344 遗留的四处口径缺口，本批只收 A/B）：
 *   A. 购买履历 Excel/PDF 的「竞品列表」sheet 由 export_excel.py 直连磁盘库
 *      整表 `SELECT * FROM competitors WHERE user_id = ?` 取，**完全绕过**映射；
 *      单条/批量/合并/PDF 四种导出都汇到这一个脚本 ⇒ 只要改脚本即可全覆盖。
 *   B. 网点优化的「门店竞争数 / 竞品雷达 / 机会区」读的是前端共享池
 *      (competitorStore.activeCompetitors)，是「竞品页选的那个品牌」的全局口径，
 *      A 店会拿 B 品牌的竞品算竞争 ⇒ 必须按每家门店自身的 brand 分池。
 *
 * 本守卫钉死：
 *   A1~A4：脚本内自解品牌（store_name→markers.brand→scope 头表→map 明细）、
 *           空集走 1 = 0、旧库容错回退、/competitors-for-map 用**行所属账号**解配置；
 *   B1~B7：归一与集合解析只此一份（utils/brandScope.js）、DataView 不再自带副本、
 *           网点优化只对「我的门店」分池、我的门店元素必须带 brand、
 *           机会区改显式下拉、竞争品牌下拉取全量、雷达与竞争数同源。
 *
 * ⚠️ 注释必须剥掉再断言；.py 额外剔除整行 `#` 注释（行尾注释仍保留，故断言用代码片段）。
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

/** .py 未走 JS 注释语法：额外剔除「整行 # 注释」，避免解释性文字骗到扫描器 */
function stripPy(s) {
  return strip(s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'))
}

const src = (p) => (exists(p) ? strip(read(p)) : '')
const py = (p) => (exists(p) ? stripPy(read(p)) : '')

const P = {
  exportPy: 'backend/export_excel.py',
  purchase: 'backend/src/routes/purchase.js',
  brandScope: 'frontend/src/utils/brandScope.js',
  mapView: 'frontend/src/views/MapView.vue',
  dataView: 'frontend/src/views/DataView.vue'
}

describe('A. 购买履历报表（A 批）', () => {
  it('A1 export_excel.py 新增品牌解析函数，串起 markers 与两张映射表', () => {
    const p = py(P.exportPy)
    expect(p, '缺少 resolve_comp_brands').toContain('def resolve_comp_brands(')
    expect(p, '品牌必须从购买记录所属门店反查').toContain(
      'FROM markers WHERE user_id = ? AND name = ? AND merged_into IS NULL'
    )
    expect(p, '必须用头表区分「未配置」与「显式空集」').toContain('FROM brand_competitor_scope')
    expect(p).toContain('FROM brand_competitor_map')
  })

  it('A2 竞品查询按品牌收窄；显式空集必须 1 = 0（⛔ 不得退化成全量）', () => {
    const p = py(P.exportPy)
    expect(p).toContain('comp_brands')
    expect(p, '空集分支缺失 ⇒ 配了空集反而变全量').toContain('sql += " AND 1 = 0"')
    expect(p).toContain("UPPER(TRIM(COALESCE(brand,''))) IN (")
  })

  it('A3 旧库无映射表时容错回退全量（⛔ 不得抛错断掉整份导出）', () => {
    const p = py(P.exportPy)
    expect(p).toMatch(/except sqlite3\.Error/)
    expect(p, '未配置/查不到品牌必须回退 None').toContain('return None')
  })

  it('A4 /competitors-for-map 复用单一口径，且用「行所属账号」解配置', () => {
    const c = src(P.purchase)
    expect(c).toContain('resolveCompBrands')
    expect(c).toContain('competitorWhere')
    expect(c, '需要 store_name 才能反查品牌').toMatch(
      /SELECT user_id, store_name, center_lng, center_lat FROM purchases/
    )
    expect(c, '集团 owner 导出子公司记录时，必须用行所属账号的映射').toContain(
      'resolveCompBrands(db, purchase.user_id'
    )
  })
})

describe('B. 网点优化（B 批）', () => {
  it('B1 抽出 utils/brandScope.js：归一与集合解析只此一份', () => {
    expect(exists(P.brandScope), '缺少 utils/brandScope.js').toBe(true)
    const u = src(P.brandScope)
    for (const fn of ['normBrand', 'scopeBrandsFor', 'brandAllowed', 'groupByBrand', 'compPointsForBrand']) {
      expect(u, '缺少 ' + fn).toContain('export function ' + fn)
    }
  })

  it('B2 DataView 改用共享 util，⛔ 不再自带 norm 副本', () => {
    const d = src(P.dataView)
    expect(d, '必须走共享口径').toContain("from '@/utils/brandScope")
    expect(d, '局部 norm 副本会与 util 漂移').not.toContain("const norm = v => String(v ?? '').replace")
    expect(d).toContain('brandAllowed(')
  })

  it('B3 网点优化「门店竞争数」按门店自身品牌分池，且只对「我的门店」分池', () => {
    const m = src(P.mapView)
    expect(m, '只对「我的门店」按自有品牌分池').toContain("store._type === '我的门店'")
    expect(m).toContain('scopeBrandsFor(')
    expect(m, '需预分组避免 O(门店×竞品) 重复归一').toContain('groupByBrand(')
    expect(m, '⛔ 必须真的在循环里用分池结果，只定义不调用等于没改').toContain('const compPool = compPoolFor(store)')
    expect(m).toContain('for (const p of compPool)')
  })

  it('B4 「我的门店」元素必须带 brand，否则无法分池', () => {
    expect(src(P.mapView)).toContain("_type: '我的门店', city: m.city || '', brand: m.brand || ''")
  })

  it('B5 机会区改为显式「分析品牌」下拉，⛔ 不再隐式继承竞品页', () => {
    const m = src(P.mapView)
    expect(m).toContain('opportunityBrand')
    expect(m).toContain('v-model="opportunityBrand"')
    expect(m, '⛔ 下拉必须真的参与取数，否则只是摆设').toContain('oppPoints = compPointsForBrand(')
    expect(m, '后续网格统计必须用收窄后的点集').toContain('oppPoints.forEach(')
  })

  it('B6 竞争品牌下拉选项取全量竞品品牌（收窄后仍能选到被排除的品牌）', () => {
    expect(src(P.mapView)).toContain('competitorStore.competitorBrands')
  })

  it('B7 竞品雷达与竞争数同源（同一分池口径）', () => {
    const m = src(P.mapView)
    expect(m).toMatch(/function openCompetitionRadar\([\s\S]{0,900}(compPointsForBrand|scopeBrandsFor)\(/)
  })
})

describe('C. 扫描器有效性自检', () => {
  it('C1 关键文件均可读且长度合理（防止路径写错导致空串假绿）', () => {
    expect(src(P.exportPy).length).toBeGreaterThan(3000)
    expect(src(P.purchase).length).toBeGreaterThan(20000)
    expect(src(P.mapView).length).toBeGreaterThan(100000)
    expect(src(P.dataView).length).toBeGreaterThan(50000)
  })

  it('C2 未配置路径必须显式判 None，不得无条件拼品牌条件', () => {
    expect(py(P.exportPy)).toContain('if comp_brands is not None')
  })
})
