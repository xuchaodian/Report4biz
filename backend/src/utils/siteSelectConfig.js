/**
 * 智能选址（site-select）的全部可调常量 —— **单一来源**（v1.13.370 / 批次 370）
 *
 * ── 为什么单独一个文件 ─────────────────────────────────────────────────
 * 立项稿 §5.1 铁律 14：权重组只能有一份，接口回传 `weights` 给前端展示。
 * 若阈值散在 utils/siteScore.js、routes/site-select.js、前端页面三处，
 * 回测调一次阈值就要改三处 —— 这个项目已经在「两份 BRAND_CATEGORY_MAP 漂移」上栽过。
 *
 * ── 阈值的来源与状态 ───────────────────────────────────────────────────
 * 全部标注「待回测」的，都是**没有被真实门店验证过**的初值，只能在回测后收紧/放宽。
 * ⚠️ 调这些阈值**不消耗联通配额**（同参复跑命中 smartsteps_cache），所以可以放心试。
 *
 * ── 与 districtScore.js 的边界（⛔ 不要合并）────────────────────────────
 * districtScore.populationScore 的六档（3万/8万/15万/30万/50万）是**整个商圈**口径，
 * 商圈面几十 km²、人口量级百万；本功能评的是 1km 圆（3.14 km²），量级差一个数量级。
 * 直接复用会让几乎所有点恒为最低档 22 分 ⇒ 权重 30 的最大维度直接废掉。
 * 所以这里**另立** SITE_CROWD_STEPS，且⛔ 不许去改 populationScore 的阈值（商圈洞察在用）。
 */

/** 五维权重（合计 100）。立项稿 §5.1 建议值，待回测校准 */
export const SITE_WEIGHTS = Object.freeze({
  crowd: 30,        // A 客群（初筛＝本地网格相对分位｜精算＝联通绝对值）
  competition: 25,  // B 竞品密度（不含自有店）
  district: 20,     // C 商圈能级（districtScore.computeScore）
  access: 15,       // D 可达配套（P0 不接，见 P0_ACCESS_ENABLED）
  cannibal: 10      // E 自牌蚕食规避（软扣分，与饱和保护分工不同）
})

/**
 * A 维度的两个子分（合计 = SITE_WEIGHTS.crowd = 30）
 *
 * 🔴 v1.13.371（业主 2026-11-17 拍板 A 案）：A2 从「话费档位代理」换成「到访活跃」。
 *    原因见 §6.128.15 —— 话费档的分母是**联通在网用户**（不是全人口），且受家庭共享套餐/
 *    企业报销/老年低话费高资产三重误判影响，作为"购买力"的代理太弱，不配 10 分权重。
 *    ⛔ 不要再把 arpu 加回来当评分项（`arpuHighPct` 只做展示参考，见 routes 层）。
 */
export const SITE_CROWD_SUB = Object.freeze({ size: 20, visit: 10 })

/**
 * 🔴 P0 是否计算 D（可达配套）维度。
 * P0 明确**不接**：D 要按点调高德 business-count（20 点 = 20 次外部调用 + QPS 风险），
 * 而它对排序的影响远小于客群/竞品。P0 让它「未评」⇒ 按 §5.2 不进分母（分母 85），
 * 响应里 missingDims 会带 'access'，界面顶部明示。
 * P1 接入时把这里改 true 即可，评分与归一化代码不需要动。
 */
export const P0_ACCESS_ENABLED = false

/**
 * 精算 A1 阈值：1km 圆内「居住 + 工作」人口（人）→ 分。
 * 立项稿 §5.1，**待回测**（建议拿 3~5 家已知好/坏门店反推）
 */
export const SITE_CROWD_STEPS = Object.freeze([
  [80000, 95], [50000, 85], [30000, 72], [15000, 58], [5000, 40]
])
export const SITE_CROWD_FLOOR = 22

/**
 * 初筛 A1：本次框选内的**相对分位**档（不是绝对人口）。
 * 🔴 为什么必须相对：上海单格中位 4,095、重庆 196（差 21 倍），
 *    任何跨城绝对阈值都会让上海全部高分、重庆全部最低分。
 * 结构：[分位门槛, 分]，从高到低匹配。
 */
export const GRID_PERCENTILE_STEPS = Object.freeze([
  [0.90, 95], [0.70, 85], [0.50, 72], [0.25, 58]
])
export const GRID_PERCENTILE_FLOOR = 40

/**
 * A2 到访活跃：联通 1001 `p0_sum`（1km 圆内月度到访人次）→ 分。
 *
 * ── 阈值怎么来的（⛔ 不是拍脑袋）────────────────────────────────────
 * 用站内 `population_hd`（上海 240m 网格，2025-03 版，107,960 格）的「到访人次」实测分布标定：
 *   P10 77 / P25 456 / P50 2,456 / P75 13,126 / P90 48,886 / P99 231,923（max 231 万）
 * 1km 圆 ≈ 54.5 个 240m 格 ⇒ 圆量级：中位约 13 万、P75 约 72 万、P90 约 266 万。
 * 取整后得下面五档（与 A1 的 95/85/72/58/40 同结构，便于文案统一）。
 *
 * ── 🔴 两个必须知道的假设 ────────────────────────────────────────────
 * ① **口径假设**：hd「到访人次」与联通 `p0_sum` 同为月度到访人次，可直接比。
 *    ⚠️ 若联通实际给的是「日均」，全批会挤在同一档 —— routes 层有 `visitSpread` 自检会报警，
 *    届时只需改本表，不必动评分逻辑。
 * ② **跨城假设**：本表是**上海**标定的绝对值。小城市（宜宾/绵阳）1km 圆到访天然低一个量级，
 *    可能整体落到 floor。⚠️ 这与 A1 的 `SITE_CROWD_STEPS` 是**同一个系统性问题**（绝对值跨城不可比），
 *    见立项稿 §13.2 第 8 条「精算阈值待回测」。不要在 A2 单点上打补丁 —— 回测时 A1/A2 一起改。
 */
export const SITE_VISIT_STEPS = Object.freeze([
  [2000000, 95], [800000, 85], [300000, 72], [100000, 58], [30000, 40]
])
export const SITE_VISIT_FLOOR = 30

/**
 * A2 旧口径「话费档位代理」（⛔ 自 v1.13.371 起**不再参与评分**，只保留数据与展示）。
 *
 * 保留理由：`arpuHighPct` 仍要在结果里作为参考信息给客户看（"这里的人话费 150+ 占 31%"），
 * 且历史结果/报告可能引用该字段。⛔ 但不要再把它接回 A2 —— 见 SITE_CROWD_SUB 上方说明。
 */
export const ARPU_STEPS = Object.freeze([
  [45, 95], [35, 80], [25, 65], [15, 50]
])
export const ARPU_FLOOR = 35

/** E 自牌蚕食：最近同品牌距离（米）→ 分（越远越好）。阈值与体检同组 300/800 */
export const CANNIBAL_STEPS = Object.freeze([
  [50, 20], [300, 40], [800, 70]
])
export const CANNIBAL_FAR = 95

/** D 可达配套：周边 POI 总量 → 分（P0 未启用，保留给 P1） */
export const ACCESS_STEPS = Object.freeze([
  [50, 95], [30, 80], [15, 60], [5, 40]
])
export const ACCESS_FLOOR = 20

/** 撒点：允许的步长（米） */
export const SITE_STEP_CHOICES = Object.freeze([500, 1000, 2000])

/**
 * 允许的评估半径（米）。
 * 🔴 联通硬约束：圆面积必须落在 0.3~80 km²（smartsteps.js:427）。
 *    500→0.79 / 1000→3.14 / 1500→7.07 / 3000→28.27 —— 全部合规。
 */
export const SITE_RADIUS_CHOICES = Object.freeze([500, 1000, 1500, 3000])

/** 框选面积上限（km²）：超过则要求缩范围或放大步长（否则单次计算过重） */
export const MAX_BBOX_AREA_KM2 = 400

/** 单次枚举格数上限：超过 400 并提示（性能护栏，与 MAX_BBOX_AREA_KM2 双保险） */
export const MAX_GRIDS = 800

/**
 * 精算点数：默认 30（= 出 TOP 20 的理论下限 20 + 10 冗余），服务端强制 clamp。
 *
 * 🔴 v1.13.372（业主 2026-11-17）：上限 **100 → 50**。
 *    TOP 20 用 30 已足够，50 是冗余上限；上限就是「一次误操作最多能烧掉多少」的天花板。
 *    100 次相当于池里 1200 次的 8%，且用户把输入框从 30 拖到 100 时没有任何阻力。
 */
export const PRECISE_TOPK = Object.freeze({ default: 30, min: 10, max: 50 })

/**
 * 🔴🔴 单次高消耗确认阈值（业主 2026-11-17 要求做的「熔断」）。
 *
 * 语义：本次**真正要从物理池扣减**的次数 > 本值时，`POST /rank` 必须收到
 * `confirmBurn === needFromPool` 才执行，否则一律 400 `burn_confirm_required`。
 *
 * ── 为什么阈值取 30（= PRECISE_TOPK.default），而不是别的数 ──────────────
 * 规则可以一句话讲清：**默认值不需要输数字，任何超过默认值的调整都必须亲手确认。**
 * 取 50 之类的数会出现「31~50 这段悄悄能烧」，正好是用户最可能误拖的区间；
 * 取 10 会让每次正常生成都要输数字，用户学会无脑输，保护反而失效。
 *
 * ⚠️ 本值是**绝对值**，不是「占剩余池的比例」。比例会让「池里 100 次跑 30 次（30%）」
 *    也要确认，而「池里 1200 次跑 50 次（4%）」反而不确认 —— 与「防止大扣」的意图相反：
 *    真正危险的是池子快见底时还大额消耗，那种情况由 `pool_exhausted` 前置校验兜住。
 *
 * ⚠️ 前端 ⛔ 不要硬编码 30，一律读 `POST /estimate` 回传的 `burnConfirm` / `burnRequired`。
 */
export const SITE_BURN_CONFIRM = 30

/** NMS 去重最小间隔（米），请求可调 */
export const MIN_GAP = Object.freeze({ default: 800, min: 400, max: 2000 })

/** 默认 TOP N */
export const TOP_N = Object.freeze({ default: 20, min: 1, max: 50 })

/**
 * 饱和保护默认值（业主 2026-11-16 确认要做）
 * ⚠️ 2000m 是**本功能新增判据**：
 *    storeLights.js 只有 300/800 双环（CLOSE_M/OVERLAP_M）；
 *    storeCheckup.js 的 RING_RADII 里另有 2000，是「体检距离分布」用的，
 *    与本功能的「饱和判定」语义不同（一个是统计口径、一个是硬剔除门限）。
 *    取 2km 的理由：1km 太近（相邻商圈不算饱和）、3km 太远（会砍掉合理扩张）。
 */
export const SATURATION_DEFAULT = Object.freeze({ enabled: true, radiusM: 2000, maxOwn: 2 })
export const SATURATION_RANGE = Object.freeze({ radiusM: [1000, 5000], maxOwn: [1, 5] })

/** 区域人口密度提示线（单格常住人口中位，人/格）。低于它 ⇒ 追加 warning */
export const REGION_MEDIAN_FLOOR = 1000

/**
 * 初筛分母（精算模式的内部排序用，⛔ 不外泄，见立项稿 §5.2 / 铁律 19）
 * 有网格+商圈 85｜有网格无商圈 65｜无网格 55
 * 实现上不直接读这几个数，而是由「已评维度权重求和」自动算出；这里只做文档与守卫锚点。
 */
export const COARSE_DENOMINATOR = Object.freeze({ gridWithDistrict: 85, gridNoDistrict: 65, noGrid: 55 })

/**
 * 🔴 **仅初筛模式**（批次 375，业主 2026-11-17 要求）—— 「65 分尺子」。
 *
 * ── 它是什么 ───────────────────────────────────────────────────────────
 * 不调联通、不消耗任何配额，只用**本地免费数据**（1km 网格常住人口 ＋ 竞品库 ＋ 自有门店
 * ＋ 饱和剔除）出一个候选榜，让用户在池余额为 0 时也能先看到"这块地大概怎么样"。
 *
 * ── 为什么是这三个维度、固定分母 65 ────────────────────────────────────
 * 现有 `scoreSite` 把总分归一到「已评维度权重和」，分母会在 **85 / 65 / 55** 之间跳：
 *   有商圈图层 85｜无商圈图层 65｜无网格城市 55
 * ⇒ 同一句「初筛 78 分」在上海（有商圈）和宜宾（无商圈）含义不同，这正是"不可解释"的来源。
 * 仅初筛的定位是**同一把尺子横向比**，所以：
 *   ① ⛔ 不含商圈（20 分）：它依赖本市有没有上传商圈图层，跨城必然缺失 ⇒ 尺子会漂移；
 *   ② ⛔ 不含可达配套（15 分）：P0 本就不接（见 P0_ACCESS_ENABLED）；
 *   ③ 只留 crowd(30) + competition(25) + cannibal(10) ＝ **分母恒为 65**。
 *
 * ── ⛔ 三条不能破的边界 ────────────────────────────────────────────────
 * ① **不叫「选址评分」**：粗分是「本次框选内的相对水平」，精算分才是绝对好坏。
 *    界面上必须写「初筛相对分」，并说明"精算后才有绝对分"。
 * ② **必须说明缺什么**：本地 1km 网格只有常住人口，⛔ 无工作人数、⛔ 无收入分档、⛔ 无到访；
 *    这是字段不存在，不是精度下降（§6.128.15）。不写清楚，用户会把它当完整选址结论。
 * ③ **⛔ 一个子请求都不许发**：`/coarse` 里不得出现 `fetchPointPopulation` 或任何外网调用，
 *    也不得查池余额（余额 0 正是它的使用场景）。守卫 + 行为测试双保险。
 */
export const COARSE_ONLY_WEIGHTS = Object.freeze({
  crowd: 30,
  competition: 25,
  cannibal: 10
})

/** 仅初筛的固定分母（＝ COARSE_ONLY_WEIGHTS 之和；⛔ 手写 65，一律用它） */
export const COARSE_ONLY_DENOMINATOR = Object.values(COARSE_ONLY_WEIGHTS).reduce((s, v) => s + v, 0)

/** 1km 网格的标称边长（米）—— 圆内加权的「整格/外离」判定用它推半对角线 */
export const GRID_CELL_M = 1000

/** 每度纬度对应米数（与 storeCheckup.js 同值，避免两套换算） */
export const M_PER_DEG_LAT = 111320

/** 缓存/请求里 1001 的服务码 */
export const SERVICE_1001 = '1001'
