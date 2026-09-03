import api from './api'

// 本地估算最近 count 个月（联通不可达时的降级数据源）
// 返回 [{ value: 'YYYYMM', label: 'YYYY年M月' }]，最新在前
function recentLocalMonths(count = 2) {
  const now = new Date()
  const months = []
  for (let i = 1; i <= count; i++) {
    let month = now.getMonth() + 1 - i
    let year = now.getFullYear()
    if (month <= 0) {
      month += 12
      year -= 1
    }
    const value = `${year}${String(month).padStart(2, '0')}`
    months.push({ value, label: `${year}年${month}月` })
  }
  return months
}

/**
 * 拉取联通 getData 可用数据月份（免费探测，不占调用次数）
 * 优先取后端 /api/smartsteps/months 实测值（避免选到无数据月份白烧 60元/次），
 * 失败时降级为本地估算的最近两个月，不阻断功能。
 * @returns {Promise<Array<{value: string, label: string}>>} 最新在前
 */
export async function fetchAvailableMonths() {
  try {
    const res = await api.get('/smartsteps/months')
    if (res?.months?.length) {
      return res.months
    }
    console.warn('可用数据月份为空，使用本地估算:', res)
  } catch (e) {
    console.warn('获取可用数据月份失败，使用本地估算:', e?.message || e)
  }
  return recentLocalMonths()
}

export default fetchAvailableMonths
