/**
 * 商圈评分（v1.13.297 从 routes/districts.js 原样抽出）
 *
 * 🔴 为什么抽出来：门店体检的「红黄绿灯」要用**同一个竞争宽松度分**判断「竞争密集」。
 *    若体检自己再写一套阈值函数，商圈洞察显示 55 分、体检说「竞争密集」，客户会认为系统乱算。
 *    项目铁律：派生算法必抽单一函数共用。
 *
 * ⚠️ 以下四个函数是 districts.js 原实现的逐字搬迁，评分口径与权重一字未改：
 *    综合分 = 人口 40% + 消费 25% + 竞争 25% + 到访活跃 10%
 */

/** 收入分层加权（用于消费能力分：富人/富裕/中产/小康/中等收入/低收入） */
export function incomeScore(props) {
  const weights = [
    ['富人人数', 100], ['富裕人数', 85], ['中产人数', 70],
    ['小康人数', 55], ['中等收入人', 40], ['低收入人数', 25]
  ]
  let total = 0, sum = 0
  for (const [key, w] of weights) {
    const v = Number(props[key]) || 0
    total += v * w
    sum += v
  }
  if (sum === 0) return 50
  return Math.round(total / sum)
}

/** 人口规模分（居住+工作，分档） */
export function populationScore(props) {
  const pop = (Number(props['居住人数']) || 0) + (Number(props['工作人数']) || 0)
  if (pop > 500000) return 95
  if (pop > 300000) return 85
  if (pop > 150000) return 72
  if (pop > 80000) return 58
  if (pop > 30000) return 40
  return 22
}

/**
 * 竞争宽松度分（v1.13.277 更名：原名「竞争强度」但分越高＝竞争越少，人人看反）
 * 口径：n = 竞品数 + 我的门店数 × 2（自家门店之间互相蚕食，比竞品更该避），n 越小分越高
 */
export function competitionScore(compCount, myStoreCount = 0) {
  const count = (compCount || 0) + (myStoreCount || 0) * 2
  if (count <= 3) return 90
  if (count <= 8) return 75
  if (count <= 15) return 55
  if (count <= 30) return 35
  return 20
}

/** 商圈综合评分：人口 40% + 消费 25% + 竞品 25% + 到访活跃 10% */
export function computeScore(props, compCount, myStoreCount = 0) {
  const p = populationScore(props)
  const c = competitionScore(compCount, myStoreCount)
  const i = incomeScore(props)
  const visit = Number(props['到访人次']) || 0
  const v = visit > 3000000 ? 95 : visit > 1500000 ? 80 : visit > 500000 ? 60 : visit > 100000 ? 40 : 20
  const total = Math.round(p * 0.40 + i * 0.25 + c * 0.25 + v * 0.10)
  return { score: total, scorePopulation: p, scoreConsumption: i, scoreCompetition: c, scoreActivity: v }
}

/**
 * 竞争宽松度 ≤35 即「竞争密集」（体检规则 ①）
 * 35 分对应 n=16~30（竞品数 + 自有×2）⇒ 文案说「16 家以上同级竞品」。
 * ⚠️ 阈值写在这里而不是散在调用点：改口径只改一处。
 */
export const COMPETITION_DENSE_MAX = 35
