/**
 * 开店测算（门店开店模拟器）—— 成本模型。
 *
 * 定位：销售预测回答「卖多少」，本模块回答「投多少、多久回本」。
 * 两者是「算生意 → 做决策」的两端，**数据必须同源**：
 *   ⛔ 本模块**不做任何营业额预测**。营收一律由调用方传入
 *      （前端从 `/api/sales-forecast/predict` 的 `predictComp` 直接取）。
 *      另写一套预测 = 同一家店在预测页和测算页给出两个数字，是最伤信任的 bug。
 *
 * 成本全部来自**用户输入**（默认值只是行业经验起点，可改），
 * 所以结果必须标注「成本为估算值」，⛔ 不得说成平台测算。
 *
 * ★ 变动成本率（variableRate）是**业态中立的**叫法：
 *   餐饮 = 食材成本占比，零售 = 进货成本占比 —— 计法相同，语义不同。
 *   ⛔ 不要改叫「食材成本率」，否则便利店/生鲜超市会算错口径。
 *
 * 回归钉子：tests/storeSimGuard.test.js
 * 单测：tests/storeSim.test.js
 */

/** 业态三大类 + 零售。用于给「设备投入」一个合理起点。 */
export const SIM_CATEGORY = {
  DRINK: 'drink',      // 茶饮 / 咖啡：设备以制冰机、封口机、咖啡机为主，投入最低
  FASTFOOD: 'fastfood',// 快餐 / 简餐 / 面馆：厨具 + 少量座位
  DINING: 'dining',    // 正餐 / 火锅 / 烧烤：明火、排烟、大厅座椅，投入最高
  RETAIL: 'retail'     // 零售 / 便利店 / 生鲜：货架、冷柜，无厨房
}

/**
 * 业态文本 → 大类。**有序规则，首个命中为准** —— 顺序本身就是语义：
 *   · 「小火锅快餐」「酸菜鱼快餐」必须先命中「快餐」再谈火锅，
 *     否则会被当成正餐火锅，设备投入默认值虚高一倍（用户不改就偏了）。
 *   · 空值/未收录一律落到 FASTFOOD（三类里最中性的投入档）。
 *
 * ⚠️ 归类只影响**默认值**，用户可改具体金额 —— 所以归类不精确的代价很小，
 *    但⛔ 不要因此省掉规则、一律给同一个默认值（那等于没有默认值）。
 *
 * @param {string} categoryText 业态描述，如「日式快餐（牛肉饭/丼饭）」
 * @returns {string} SIM_CATEGORY 之一
 */
export function simCategoryOf(categoryText) {
  const t = String(categoryText || '')
  if (!t) return SIM_CATEGORY.FASTFOOD

  // ① 饮品：茶饮 / 咖啡 / 饮品
  if (/茶饮|咖啡|饮品|果茶|奶茶/.test(t)) return SIM_CATEGORY.DRINK
  // ② 零售：无厨房，只有货架与冷柜
  if (/零售|便利店|超市|服饰|百货/.test(t)) return SIM_CATEGORY.RETAIL
  // ③ 快餐（须先于正餐判定：「小火锅快餐」「酸菜鱼快餐」属此类）
  if (/快餐|简餐|面馆|米线|麻辣烫|早餐|拌饭|饺子|馄饨|小吃|盖饭/.test(t)) return SIM_CATEGORY.FASTFOOD
  // ④ 正餐
  if (/正餐|火锅|自助|烧烤|酒馆|焖锅|烤鱼|牛蛙|酸菜鱼|披萨|休闲餐饮/.test(t)) return SIM_CATEGORY.DINING
  return SIM_CATEGORY.FASTFOOD
}

/** 各业态「设备+家具」默认投入（元）。只是起点，用户可改。 */
export const SIM_EQUIP_BY_CATEGORY = {
  [SIM_CATEGORY.DRINK]: 80000,
  [SIM_CATEGORY.FASTFOOD]: 150000,
  [SIM_CATEGORY.DINING]: 300000,
  [SIM_CATEGORY.RETAIL]: 150000
}

/**
 * 成本默认值。**每一项都可在界面上改**。
 *
 * 🔴 刻意不给「租金」默认值：一线城市核心商圈与三线城市社区的租金能差 10 倍，
 *    编一个数字出来，用户不改就等于拿假数据算回本 —— 宁可空着强制填。
 */
export const SIM_DEFAULTS = {
  decorPerSqm: 1500,        // 装修 元/㎡（一次性）
  franchiseFee: 0,          // 加盟费/保证金 元（一次性，自营为 0）
  setupFee: 30000,          // 开办费（证照、首期物料）元（一次性）
  rentPerSqmMonth: null,    // 租金 元/㎡/月 —— ⛔ 无默认，必须用户填
  salaryMonth: 5000,        // 人均月薪 元
  sqmPerStaff: 25,          // 每多少㎡配 1 人
  minStaff: 3,              // 最少人数（小店也得有人收银、后厨、值班）
  utilityPerSqmMonth: 30,   // 水电物业 元/㎡/月
  variableRate: 0.40,       // 变动成本率（餐饮=食材 / 零售=进货），占营业额
  commissionRate: 0.18      // 外卖平台佣金率，**只对外卖部分**计
}

/**
 * 按面积与业态给出默认成本**表单**（展示单位：万元 / 百分比）。
 *
 * 🔴 界面单位与计算单位不是一回事 —— 表单用万元、百分比（人看得懂），
 *    `computeSim` 用元、小数（算得准）。两者由 `toComputeCosts` 单向转换，
 *    ⛔ 不要在模板里到处写 `× 10000` / `÷ 100`：散开必漏，漏一处就是 100 倍误差。
 *
 * 🔴 刻意不给「租金」默认值：一线城市核心商圈与三线城市社区的租金能差 10 倍，
 *    编一个数字出来，用户不改就等于拿假数据算回本 —— 宁可空着强制填。
 */
export function defaultSimForm({ area, category } = {}) {
  const a = Number(area) > 0 ? Number(area) : 0
  const cat = SIM_EQUIP_BY_CATEGORY[category] != null ? category : SIM_CATEGORY.FASTFOOD
  const staff = Math.max(SIM_DEFAULTS.minStaff, Math.ceil(a / SIM_DEFAULTS.sqmPerStaff) || 0)
  return {
    decorPerSqm: SIM_DEFAULTS.decorPerSqm,          // 元/㎡（一次性）
    equipWan: SIM_EQUIP_BY_CATEGORY[cat] / 10000,   // 万元（一次性）
    franchiseWan: SIM_DEFAULTS.franchiseFee / 10000,// 万元
    setupWan: SIM_DEFAULTS.setupFee / 10000,        // 万元
    rentPerSqmMonth: SIM_DEFAULTS.rentPerSqmMonth,  // 元/㎡/月 —— null，必须用户填
    staffCount: staff,
    salaryMonth: SIM_DEFAULTS.salaryMonth,          // 元/人/月
    utilityPerSqmMonth: SIM_DEFAULTS.utilityPerSqmMonth,
    variablePct: SIM_DEFAULTS.variableRate * 100,   // %
    commissionPct: SIM_DEFAULTS.commissionRate * 100
  }
}

/**
 * 表单（万元 / 百分比）→ 计算入参（元 / 小数）。**唯一的单位转换点**。
 *
 * @param {Object} form 见 defaultSimForm
 * @returns {Object} costs，可直接喂给 computeSim
 */
export function toComputeCosts(form = {}) {
  const wan = (v) => Math.round((Number(v) || 0) * 10000)
  const pct = (v) => (Number(v) || 0) / 100
  // 租金 ≤0 一律视同「未填」⇒ 触发 no_rent 提示。
  // ⚠️ 不把 0 当成「已知零租金」：租金为 0 在现实里不存在，
  //    若当成 0 会让固定成本偏低而**静默**给出偏乐观的回本周期。
  const rent = Number(form.rentPerSqmMonth)
  return {
    decorPerSqm: Number(form.decorPerSqm) || 0,
    equipTotal: wan(form.equipWan),
    franchiseFee: wan(form.franchiseWan),
    setupFee: wan(form.setupWan),
    rentPerSqmMonth: Number.isFinite(rent) && rent > 0 ? rent : null,
    staffCount: Number(form.staffCount) || 0,
    salaryMonth: Number(form.salaryMonth) || 0,
    utilityPerSqmMonth: Number(form.utilityPerSqmMonth) || 0,
    variableRate: pct(form.variablePct),
    commissionRate: pct(form.commissionPct)
  }
}

/** 数字兜底：非有限数一律按 0，负数按 0（成本项不该有负值）。 */
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
/** 比例兜底：夹到 [0, 1]。 */
const rate = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * 核心测算。纯函数、无副作用、无外部依赖 —— 可单测。
 *
 * @param {Object} input
 * @param {number} input.annualRevenue   年营业额（元）—— **必须来自销售预测**
 * @param {number} input.area            营业面积（㎡）
 * @param {number} input.deliveryShare   外卖占比（0-100）
 * @param {Object} input.costs           成本项，见 SIM_DEFAULTS
 * @param {number} [input.conf]          预测置信度（%），用于三档情形；缺省 0
 * @returns {Object} 测算结果
 */
export function computeSim(input = {}) {
  const area = num(input.area)
  const annualRevenue = num(input.annualRevenue)
  const c = input.costs || {}

  // ---- 变化成本率：外卖佣金只对外卖部分计 ----
  const deliveryShare = Math.min(100, Math.max(0, Number(input.deliveryShare) || 0))
  const variableRate = rate(c.variableRate)
  const commissionRate = rate(c.commissionRate)
  const commissionShare = (deliveryShare / 100) * commissionRate
  // 贡献毛益率：每 1 元营业额，扣掉变动成本与外卖佣金后剩下多少
  const contribRate = 1 - variableRate - commissionShare

  // ---- 一次性投入 ----
  const oneTime = {
    decor: Math.round(num(c.decorPerSqm) * area),
    equip: Math.round(num(c.equipTotal)),
    franchise: Math.round(num(c.franchiseFee)),
    setup: Math.round(num(c.setupFee))
  }
  const oneTimeTotal = oneTime.decor + oneTime.equip + oneTime.franchise + oneTime.setup

  // ---- 月度固定成本 ----
  const monthly = {
    rent: Math.round(num(c.rentPerSqmMonth) * area),
    staff: Math.round(num(c.staffCount) * num(c.salaryMonth)),
    utility: Math.round(num(c.utilityPerSqmMonth) * area)
  }
  const monthlyFixed = monthly.rent + monthly.staff + monthly.utility
  const annualFixed = monthlyFixed * 12

  // ---- 年度损益 ----
  const annualVariable = Math.round(annualRevenue * variableRate)
  const annualCommission = Math.round(annualRevenue * commissionShare)
  const annualNet = annualRevenue - annualVariable - annualCommission - annualFixed
  const monthlyNet = annualNet / 12

  // ---- 回本周期（月）----
  // 月净利 <= 0 ⇒ 永远回不了本，返回 Infinity 由展示层写「无法回本」，
  // ⛔ 不能返回 0 或负数（会被误读成「立刻回本」）。
  const paybackMonths = monthlyNet > 0 ? oneTimeTotal / monthlyNet : Infinity

  // ---- 盈亏平衡（月营业额）----
  // 贡献毛益率 <= 0 ⇒ 结构性亏损：卖得越多亏得越多，不存在平衡点。
  const monthlyRevenue = annualRevenue / 12
  const breakEvenMonthlyRevenue = contribRate > 0 ? monthlyFixed / contribRate : Infinity
  const safetyMargin = monthlyRevenue > 0 && Number.isFinite(breakEvenMonthlyRevenue)
    ? (monthlyRevenue - breakEvenMonthlyRevenue) / monthlyRevenue
    : (contribRate > 0 ? 0 : -1)

  // ---- 三档情形：按预测置信区间给悲观/中性/乐观 ----
  const conf = Math.min(100, Math.max(0, Number(input.conf) || 0)) / 100
  const scenario = (mult) => {
    const rev = annualRevenue * mult
    const net = rev - rev * variableRate - rev * commissionShare - annualFixed
    const mNet = net / 12
    return {
      annualRevenue: Math.round(rev),
      annualNet: Math.round(net),
      paybackMonths: mNet > 0 ? oneTimeTotal / mNet : Infinity
    }
  }
  const scenarios = {
    low: scenario(1 - conf),
    mid: scenario(1),
    high: scenario(1 + conf)
  }

  // ---- 提示（结构化，文案由调用方决定，⛔ 不在这里拼中文长句）----
  const warnings = []
  if (!annualRevenue) warnings.push('no_revenue')
  if (!area) warnings.push('no_area')
  if (!num(c.rentPerSqmMonth)) warnings.push('no_rent')          // 租金未填 ⇒ 固定成本偏低，回本偏乐观
  if (contribRate <= 0) warnings.push('negative_contribution')
  else if (annualNet <= 0) warnings.push('negative_net')

  return {
    ok: annualRevenue > 0 && area > 0,
    area,
    annualRevenue,
    deliveryShare,
    variableRate,
    commissionRate,
    contribRate,
    oneTime,
    oneTimeTotal,
    monthly,
    monthlyFixed,
    annualFixed,
    annualVariable,
    annualCommission,
    annualNet,
    monthlyNet,
    paybackMonths,
    monthlyRevenue,
    breakEvenMonthlyRevenue,
    safetyMargin,
    scenarios,
    warnings
  }
}

/**
 * 回本周期的展示口径（唯一实现）。
 * ⚠️ 与 `computeSim` 分开：函数只算数，转换成人话集中在展示层一个函数，
 *    否则「无法回本」「不到一个月」这类分支会在多个模板里各写一遍并迅速分叉。
 *
 * @param {number} months
 * @returns {{ text: string, tone: 'good'|'warn'|'bad' }}
 */
export function formatPayback(months) {
  if (!Number.isFinite(months)) return { text: '无法回本（月净利为负）', tone: 'bad' }
  if (months <= 0) return { text: '已回本', tone: 'good' }
  if (months < 1) return { text: '不到 1 个月', tone: 'good' }
  const m = Math.round(months)
  // 24 个月（2 年）是餐饮业常用的心理红线，超过即需要谨慎
  const tone = m <= 12 ? 'good' : m <= 24 ? 'warn' : 'bad'
  return { text: `${m} 个月（约 ${(m / 12).toFixed(1)} 年）`, tone }
}
