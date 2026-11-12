/**
 * 开店测算（storeSim）单元测试。
 *
 * 重点不是「函数能跑」，而是**每条口径边界都不能静默给错数**：
 *   ① 业态归类顺序（「小火锅快餐」必须落快餐，不是正餐火锅）
 *   ② 外卖佣金只对外卖部分计（不是对全部营业额）
 *   ③ 月净利为负 ⇒ 回本周期 Infinity，⛔ 不能是 0 或负数
 *   ④ 贡献毛益率 ≤0 ⇒ 结构性亏损，盈亏平衡点不存在
 *   ⑤ 负数/非数字输入 ⇒ 按 0，绝不产出负数成本
 */
import { describe, it, expect } from 'vitest'
import {
  simCategoryOf, defaultSimForm, toComputeCosts, computeSim, formatPayback,
  SIM_CATEGORY, SIM_EQUIP_BY_CATEGORY, SIM_DEFAULTS
} from '../../frontend/src/utils/storeSim.js'

describe('业态归类 simCategoryOf', () => {
  it('茶饮 / 咖啡 → drink', () => {
    expect(simCategoryOf('平价茶饮')).toBe(SIM_CATEGORY.DRINK)
    expect(simCategoryOf('咖啡饮品（快取式）')).toBe(SIM_CATEGORY.DRINK)
    expect(simCategoryOf('新中式茶饮（国风）')).toBe(SIM_CATEGORY.DRINK)
  })

  it('正餐 / 火锅 / 烧烤 → dining', () => {
    expect(simCategoryOf('火锅正餐（川渝火锅）')).toBe(SIM_CATEGORY.DINING)
    expect(simCategoryOf('烧烤正餐')).toBe(SIM_CATEGORY.DINING)
    expect(simCategoryOf('中式正餐（湘菜小炒）')).toBe(SIM_CATEGORY.DINING)
  })

  it('🔴 快餐必须先于正餐命中：「小火锅快餐」「酸菜鱼快餐」= 快餐', () => {
    expect(simCategoryOf('小火锅快餐')).toBe(SIM_CATEGORY.FASTFOOD)
    expect(simCategoryOf('酸菜鱼快餐')).toBe(SIM_CATEGORY.FASTFOOD)
  })

  it('「酸菜鱼正餐」仍是正餐（不能因含「酸菜鱼」就一律降档）', () => {
    expect(simCategoryOf('酸菜鱼正餐')).toBe(SIM_CATEGORY.DINING)
  })

  it('零售业态 → retail（无厨房，设备口径不同）', () => {
    expect(simCategoryOf('卤味熟食零售')).toBe(SIM_CATEGORY.RETAIL)
    expect(simCategoryOf('便利店')).toBe(SIM_CATEGORY.RETAIL)
    expect(simCategoryOf('生鲜超市（新零售）')).toBe(SIM_CATEGORY.RETAIL)
  })

  it('空值 / 未收录 → fastfood（三类中最中性的投入档）', () => {
    expect(simCategoryOf('')).toBe(SIM_CATEGORY.FASTFOOD)
    expect(simCategoryOf(null)).toBe(SIM_CATEGORY.FASTFOOD)
    expect(simCategoryOf('某个没见过的业态')).toBe(SIM_CATEGORY.FASTFOOD)
  })
})

describe('默认表单与单位转换', () => {
  it('人数按面积推算，且不低于最少人数', () => {
    // 40㎡ / 25 = 1.6 → ceil 2，但最少 3 人
    expect(defaultSimForm({ area: 40, category: SIM_CATEGORY.FASTFOOD }).staffCount).toBe(3)
    // 200㎡ / 25 = 8
    expect(defaultSimForm({ area: 200, category: SIM_CATEGORY.FASTFOOD }).staffCount).toBe(8)
  })

  it('🔴 租金无默认值（地域差异太大，编一个数就是骗人）', () => {
    expect(defaultSimForm({ area: 100, category: SIM_CATEGORY.FASTFOOD }).rentPerSqmMonth)
      .toBe(null)
    expect(SIM_DEFAULTS.rentPerSqmMonth).toBe(null)
  })

  it('设备投入按业态分档：茶饮 < 快餐 < 正餐', () => {
    expect(SIM_EQUIP_BY_CATEGORY[SIM_CATEGORY.DRINK])
      .toBeLessThan(SIM_EQUIP_BY_CATEGORY[SIM_CATEGORY.FASTFOOD])
    expect(SIM_EQUIP_BY_CATEGORY[SIM_CATEGORY.FASTFOOD])
      .toBeLessThan(SIM_EQUIP_BY_CATEGORY[SIM_CATEGORY.DINING])
  })

  it('未知业态归到快餐档，不抛错', () => {
    expect(defaultSimForm({ area: 100, category: 'whatever' }).equipWan)
      .toBe(SIM_EQUIP_BY_CATEGORY[SIM_CATEGORY.FASTFOOD] / 10000)
  })

  it('🔴 万元 → 元、百分比 → 小数，转换只此一处', () => {
    const c = toComputeCosts({
      decorPerSqm: 1500, equipWan: 15, franchiseWan: 2, setupWan: 3,
      rentPerSqmMonth: 200, staffCount: 4, salaryMonth: 5000, utilityPerSqmMonth: 30,
      variablePct: 40, commissionPct: 18
    })
    expect(c.equipTotal).toBe(150000)
    expect(c.franchiseFee).toBe(20000)
    expect(c.setupFee).toBe(30000)
    expect(c.variableRate).toBeCloseTo(0.4, 10)
    expect(c.commissionRate).toBeCloseTo(0.18, 10)
    expect(c.decorPerSqm).toBe(1500)   // 元/㎡ 不换算
  })

  it('租金留空保持 null（不能转成 0 冒充「已填」）', () => {
    expect(toComputeCosts({}).rentPerSqmMonth).toBe(null)
    expect(toComputeCosts({ rentPerSqmMonth: '' }).rentPerSqmMonth).toBe(null)
    expect(toComputeCosts({ rentPerSqmMonth: '0' }).rentPerSqmMonth).toBe(null) // 0 也视同未填
  })

  it('表单默认值 → 计算入参 整链自洽（不出现 100 倍误差）', () => {
    const form = defaultSimForm({ area: 100, category: SIM_CATEGORY.FASTFOOD })
    const c = toComputeCosts(form)
    expect(c.equipTotal).toBe(SIM_EQUIP_BY_CATEGORY[SIM_CATEGORY.FASTFOOD])
    expect(c.variableRate).toBeCloseTo(SIM_DEFAULTS.variableRate, 10)
    expect(c.commissionRate).toBeCloseTo(SIM_DEFAULTS.commissionRate, 10)
  })
})

describe('核心测算 computeSim', () => {
  // 标准算例：年营收 300 万、100㎡、外卖 40%
  const base = () => ({
    annualRevenue: 3000000,
    area: 100,
    deliveryShare: 40,
    conf: 20,
    costs: {
      decorPerSqm: 1500, equipTotal: 150000, franchiseFee: 0, setupFee: 30000,
      rentPerSqmMonth: 200, staffCount: 4, salaryMonth: 5000, utilityPerSqmMonth: 30,
      variableRate: 0.40, commissionRate: 0.18
    }
  })

  it('一次性投入 = 装修×面积 + 设备 + 加盟 + 开办', () => {
    const r = computeSim(base())
    expect(r.oneTime.decor).toBe(150000)   // 1500 × 100
    expect(r.oneTime.equip).toBe(150000)
    expect(r.oneTime.franchise).toBe(0)
    expect(r.oneTime.setup).toBe(30000)
    expect(r.oneTimeTotal).toBe(330000)
  })

  it('月固定成本 = 租金 + 人力 + 水电物业', () => {
    const r = computeSim(base())
    expect(r.monthly.rent).toBe(20000)    // 200 × 100
    expect(r.monthly.staff).toBe(20000)   // 4 × 5000
    expect(r.monthly.utility).toBe(3000)  // 30 × 100
    expect(r.monthlyFixed).toBe(43000)
    expect(r.annualFixed).toBe(516000)
  })

  it('🔴 外卖佣金只对外卖部分计（40% × 18% = 7.2%）', () => {
    const r = computeSim(base())
    expect(r.commissionRate).toBe(0.18)
    // 不是 300万 × 18% = 54万，而是 300万 × 7.2% = 21.6万
    expect(r.annualCommission).toBe(216000)
  })

  it('年净利与回本周期口径闭合', () => {
    const r = computeSim(base())
    expect(r.annualVariable).toBe(1200000)                 // 300万 × 40%
    expect(r.annualNet).toBe(3000000 - 1200000 - 216000 - 516000) // 1,068,000
    expect(r.monthlyNet).toBe(89000)
    expect(r.paybackMonths).toBeCloseTo(330000 / 89000, 4) // ≈ 3.71 个月
  })

  it('盈亏平衡月营业额与安全边际', () => {
    const r = computeSim(base())
    // 贡献毛益率 = 1 - 0.40 - 0.072 = 0.528
    expect(r.contribRate).toBeCloseTo(0.528, 6)
    expect(r.breakEvenMonthlyRevenue).toBeCloseTo(43000 / 0.528, 2)
    expect(r.safetyMargin).toBeCloseTo((250000 - 43000 / 0.528) / 250000, 4)
  })

  it('三档情形：悲观 < 中性 < 乐观（回本周期反向）', () => {
    const r = computeSim(base())
    expect(r.scenarios.low.annualNet).toBeLessThan(r.scenarios.mid.annualNet)
    expect(r.scenarios.mid.annualNet).toBeLessThan(r.scenarios.high.annualNet)
    expect(r.scenarios.low.paybackMonths).toBeGreaterThan(r.scenarios.mid.paybackMonths)
    expect(r.scenarios.mid.paybackMonths).toBeGreaterThan(r.scenarios.high.paybackMonths)
  })

  it('🔴 月净利为负 ⇒ 回本周期 Infinity（⛔ 不是 0、不是负数）', () => {
    const bad = base()
    bad.annualRevenue = 300000   // 30 万营收扛不住 51.6 万固定成本
    const r = computeSim(bad)
    expect(r.monthlyNet).toBeLessThan(0)
    expect(r.paybackMonths).toBe(Infinity)
    expect(r.warnings).toContain('negative_net')
  })

  it('🔴 贡献毛益率 ≤0 ⇒ 结构性亏损，盈亏平衡点不存在', () => {
    const bad = base()
    bad.deliveryShare = 100
    bad.costs.variableRate = 0.90
    bad.costs.commissionRate = 0.20   // 0.90 + 0.20 = 1.10 > 1
    const r = computeSim(bad)
    expect(r.contribRate).toBeLessThanOrEqual(0)
    expect(r.breakEvenMonthlyRevenue).toBe(Infinity)
    expect(r.warnings).toContain('negative_contribution')
  })

  it('一次性投入为 0 ⇒ 回本周期 0（已回本），不是 Infinity', () => {
    const z = base()
    z.costs.decorPerSqm = 0
    z.costs.equipTotal = 0
    z.costs.setupFee = 0
    z.costs.franchiseFee = 0
    const r = computeSim(z)
    expect(r.oneTimeTotal).toBe(0)
    expect(r.paybackMonths).toBe(0)
  })

  it('租金未填 ⇒ 明确给出 no_rent 提示（结果偏乐观，不能静默）', () => {
    const nr = base()
    nr.costs.rentPerSqmMonth = null
    const r = computeSim(nr)
    expect(r.monthly.rent).toBe(0)
    expect(r.warnings).toContain('no_rent')
  })

  it('缺营业额 / 缺面积 ⇒ ok=false 并给对应提示', () => {
    const a = computeSim({ ...base(), annualRevenue: 0 })
    expect(a.ok).toBe(false)
    expect(a.warnings).toContain('no_revenue')

    const b = computeSim({ ...base(), area: 0 })
    expect(b.ok).toBe(false)
    expect(b.warnings).toContain('no_area')
  })

  it('负数与非数字输入按 0 处理，绝不产出负数成本', () => {
    const r = computeSim({
      annualRevenue: 3000000, area: 100, deliveryShare: -20,
      costs: {
        decorPerSqm: -1500, equipTotal: -100, franchiseFee: 'abc', setupFee: -1,
        rentPerSqmMonth: -200, staffCount: -5, salaryMonth: NaN, utilityPerSqmMonth: -30,
        variableRate: 5, commissionRate: -1
      }
    })
    expect(r.oneTimeTotal).toBe(0)
    expect(r.monthlyFixed).toBe(0)
    expect(r.deliveryShare).toBe(0)
    expect(r.variableRate).toBe(1)      // 夹到 [0,1]
    expect(r.commissionRate).toBe(0)
    expect(r.oneTimeTotal).toBeGreaterThanOrEqual(0)
  })

  it('外卖占比超过 100 被夹到 100，不会算出负贡献', () => {
    const r = computeSim({ ...base(), deliveryShare: 300 })
    expect(r.deliveryShare).toBe(100)
    expect(r.contribRate).toBeCloseTo(1 - 0.4 - 0.18, 6)
  })
})

describe('回本周期展示 formatPayback', () => {
  it('Infinity → 无法回本 / bad（⛔ 不能显示成 0 个月）', () => {
    expect(formatPayback(Infinity)).toEqual({ text: '无法回本（月净利为负）', tone: 'bad' })
    expect(formatPayback(NaN)).toEqual({ text: '无法回本（月净利为负）', tone: 'bad' })
  })

  it('12 个月内 good / 12-24 个月 warn / 超 24 个月 bad', () => {
    expect(formatPayback(3.7).tone).toBe('good')
    expect(formatPayback(3.7).text).toContain('4 个月')
    expect(formatPayback(18).tone).toBe('warn')
    expect(formatPayback(36).tone).toBe('bad')
  })

  it('不到 1 个月单独成句（不能四舍五入成 0 个月）', () => {
    expect(formatPayback(0.4).text).toBe('不到 1 个月')
  })
})
