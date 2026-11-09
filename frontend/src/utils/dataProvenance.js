/**
 * 结论型页面的「数据口径卡」统一文案出口（v1.13.332 / P0 ②，2026-11-09）
 *
 * 背景：平台里有不少「分数 / 预测值 / 置信度」型结论，过去只展示结果，
 * 不说明这份结论建立在什么数据上。最容易误读的两处：
 *   • 商圈洞察：基线商圈面是「联通人口版」但**未标注期次**
 *     （backend/src/routes/districts.js 的 BASE_DATA_MONTH = ''），只有点过
 *     「刷新最新数据」才有 YYYYMM；且刷新后只回商圈总人口，居住 / 工作
 *     人口按各半近似，不是实测值。
 *   • 销售预测：store_sales 是**用户自己导入**的，样本量随账号而变；
 *     不足 50 行时回退 L1 经验类比。结果卡里的「置信度 ±N%」是按匹配档位
 *     给的经验区间，不是统计意义上的置信区间。
 *
 * ⚠️ 这里只输出「已核实的口径」，不推导新指标、不臆造期次、不写死样本数。
 *    样本量一律从 /sales-forecast/stats 动态读，避免数据变了文案还在说旧数字。
 * ⛔ 禁止引入 @/router、@/stores 或其它入口侧模块（见 vite.config.js 里
 *    app-shared 的登记理由），否则会把地图库反向拖进首屏静态闭包。
 * ⚠️ 后续给其它结论页接数据卡时，在这里加一个 xxxProvenance()，模板与样式
 *    保持跟商圈洞察 / 销售预测同结构，别在组件里另写一套口径。
 */

/** YYYYMM → 2026 年 10 月；异常值原样返回，不猜 */
function formatMonth(ym) {
  const m = /^(\d{4})(\d{2})$/.exec(String(ym || ''))
  if (!m) return String(ym || '')
  return `${m[1]} 年 ${Number(m[2])} 月`
}

/**
 * 商圈洞察页：列表评分 / 详情分数共用一条口径
 * @param {{dataMonth?: string, districtCount?: number}} p
 */
export function districtProvenance({ dataMonth, districtCount = 0 } = {}) {
  const refreshed = !!dataMonth
  return {
    items: [
      { label: '数据来源', value: refreshed ? '联通智慧足迹 1001 接口（当期人口）' : '本地商圈面基线 · 联通人口版' },
      { label: '数据期次', value: refreshed ? formatMonth(dataMonth) : '未标注（基线数据）', tone: refreshed ? 'ok' : 'warn' },
      { label: '覆盖商圈', value: districtCount > 0 ? `${districtCount} 个（当前城市）` : '未选择城市' },
      { label: '评分口径', value: '固定经验权重，非统计模型；仅供同城横向比较' }
    ],
    note: refreshed
      ? '刷新只回商圈总人口，居住 / 工作人口按各半估算，不是实测值；综合评分仍沿用基线权重。'
      : '基线数据没有月份，评分适合在同一城市内横向比较，不宜跨期解读为「增长」；点「刷新最新数据」可拉取当期人口并标出真实期次。'
  }
}

/**
 * 销售预测页：结果卡下方一条口径
 * @param {{stats?: object, result?: object}} p
 */
export function forecastProvenance({ stats, result } = {}) {
  const engine = result?.engine || ''
  const conf = result?.conf
  const items = [
    { label: '数据来源', value: '本账号导入的门店销售记录' },
    { label: '样本量', value: stats ? `${stats.samples} 行 / ${stats.stores} 家已开业店` : '读取中' },
    { label: '数据期次', value: '按录入年份，无统一期次' },
    {
      label: '当前引擎',
      value: engine ? ({ L1: 'L1 经验类比', L2: 'L2 Ridge 回归', L3: 'L3 机器学习' }[engine] || engine) : '尚未运行',
      tone: engine === 'L1' || !engine ? 'warn' : 'ok'
    }
  ]

  let note
  if (!engine) {
    const gap = stats ? `距 L2 回归（${stats.l2} 行）还差 ${stats.l2Gap} 行` : '样本量读取中'
    note = `尚未出预测结果。${gap}；以当前样本即使出结果也会回退 L1 经验类比，仅供粗略参考。出结果后显示的「置信度 ±N%」是经验参考区间，不是统计意义上的置信区间。`
  } else if (engine === 'L1') {
    const gap = stats ? `距 L2 回归（${stats.l2} 行）还差 ${stats.l2Gap} 行` : '样本量读取中'
    note = `样本不足，当前是经验类比估算：${gap}。结果仅供粗略参考，录入真实销售后引擎会自动升级。`
  } else if (engine === 'L2') {
    note = '回归结果经过按门店分组的留一交叉验证；区间仍会受样本构成影响。'
  } else {
    note = '机器学习结果经过按门店分组的交叉验证，并要求验证误差不劣于 L2；特征归因见下方。'
  }
  if (conf != null) {
    note += `「置信度 ±${conf}%」是系统给出的经验参考区间，不是统计意义上的置信区间。`
  }
  return { items, note }
}
