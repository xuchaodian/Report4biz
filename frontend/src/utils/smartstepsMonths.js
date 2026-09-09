import api from './api'

// 可回溯月份跨度（v1.13.103 B3：月份选择放开——以「联通当前可用最新月」为锚向前回溯 N 个月，
// 不再死绑「最近 2 个月」，使 6 月及更早历史月份始终可选；联通对历史月 getData 仍受理）
const MONTH_SPAN = 12

// 月份值数组 → [{ value: 'YYYYMM', label: 'YYYY年M月' }]（保持入参顺序）
function formatMonths(values) {
  return values.map(v => {
    const y = String(v).slice(0, 4)
    const m = parseInt(String(v).slice(4, 6), 10)
    return { value: String(v), label: `${y}年${m}月` }
  })
}

// 本地估算最近 count 个月（联通不可达时的降级数据源）——以「当前自然月 −1」为最新锚向前回溯
function recentLocalMonths(count = MONTH_SPAN) {
  const now = new Date()
  const values = []
  for (let i = 1; i <= count; i++) {
    let month = now.getMonth() + 1 - i
    let year = now.getFullYear()
    if (month <= 0) {
      month += 12
      year -= 1
    }
    values.push(`${year}${String(month).padStart(2, '0')}`)
  }
  return formatMonths(values)
}

// 以列表最新月为锚向前回溯 span 个月（含锚在内共 span 个自然月），历史月补足进列表；
// 入参须为 YYYYMM 字符串数组。输出保持最新在前，长度 ≤ max(values 去重数, span)
function expandBackward(values, span = MONTH_SPAN) {
  if (!Array.isArray(values) || values.length === 0) return []
  const seen = new Set(values)
  const out = [...seen]  // 输入去重（防联通重复/乱序传入）
  // 最新 = 数值最大（YYYYMM 字典序即时间序）
  const anchor = [...values].sort().pop()
  let y = parseInt(anchor.slice(0, 4), 10)
  let m = parseInt(anchor.slice(4, 6), 10)
  // 从锚的次一月开始逐自然月回退 span-1 步（撞到已存在实测月仅跳过不入 out，但月份推进照旧）
  for (let step = 0; step < span - 1; step++) {
    m -= 1
    if (m <= 0) { m += 12; y -= 1 }
    if (y < 2000) break
    const v = `${y}${String(m).padStart(2, '0')}`
    if (!seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  out.sort().reverse() // 最新在前
  return formatMonths(out)
}

/**
 * 拉取可选数据月份（免费探测，不占调用次数）
 * 优先取后端 /api/smartsteps/months 实测值（联通 getCityMonth 当前可用月，最新在前），
 * 再以最新月为锚向前回溯 MONTH_SPAN 个月（历史月 getData 仍受理，选择放开）；
 * 失败时降级为本地估算最近 MONTH_SPAN 个月，不阻断功能。
 * @returns {Promise<Array<{value: string, label: string}>>} 最新在前
 */
export async function fetchAvailableMonths() {
  try {
    const res = await api.get('/smartsteps/months')
    if (res?.months?.length) {
      const values = res.months.map(m => String(m.value || m.month || m))
      return expandBackward(values)
    }
    console.warn('可用数据月份为空，使用本地估算:', res)
  } catch (e) {
    console.warn('获取可用数据月份失败，使用本地估算:', e?.message || e)
  }
  return recentLocalMonths()
}

export default fetchAvailableMonths
