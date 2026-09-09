import api from './api'

// 联通 getData 规格：只受理「以数据最新月为锚的最近 2 个月」数据（2026-09 实测：最新可用 202607/202606）。
// 因此可选数据年月 = 后端 /smartsteps/months 实测月（联通 getCityMonth，免费探测）截取前 AVAILABLE_TOP 项。
// 注意：不得以「日历当前月」推算（数据通常滞后约 2 个月，日历推算会让用户选到无数据月），
// 也不得向更早历史月展开（无数据月查询 = 60元/次 无效调用风险）。
const AVAILABLE_TOP = 2

// 月份值 → { value: 'YYYYMM', label: 'YYYY年M月' }；非法返回 null
function toMonthItem(v) {
  const s = String(v ?? '').trim()
  if (!/^\d{6}$/.test(s)) return null
  const y = s.slice(0, 4)
  const m = parseInt(s.slice(4, 6), 10)
  if (m < 1 || m > 12) return null
  return { value: s, label: `${y}年${m}月` }
}

// 本地估算兜底（联通探测接口不可达时，仍保证 UI 可用）：
// 按「数据通常滞后当前约 2 个月」估算，以「当前自然月 −2」为最新锚向前取 count 个，最新在前。
function recentLocalMonths(count = AVAILABLE_TOP) {
  const now = new Date()
  const out = []
  const anchor = now.getMonth() + 1 - 2 // 锚 = 当前月 −2（0/负数跨年处理）
  for (let i = 0; i < count; i++) {
    let month = anchor - i
    let year = now.getFullYear()
    if (month <= 0) {
      month += 12
      year -= 1
    }
    out.push(toMonthItem(`${year}${String(month).padStart(2, '0')}`))
  }
  return out.filter(Boolean)
}

/**
 * 拉取可选数据月份（免费探测，不占调用次数）
 * 主路径：后端 /api/smartsteps/months（联通 getCityMonth 实测可拉月，最新在前）→ 归一化后截取前 2 项。
 * 失败/为空时降级 recentLocalMonths(2)（本地估算，不阻断功能）。
 * @returns {Promise<Array<{value: string, label: string}>>} 最新在前，最多 AVAILABLE_TOP 项
 */
export async function fetchAvailableMonths() {
  try {
    const res = await api.get('/smartsteps/months')
    if (res?.months?.length) {
      const months = res.months
        .map((m) => toMonthItem(m?.value ?? m?.month ?? m))
        .filter(Boolean)
        // 后端已按 value 降序 + 去重，此处再保险一次
        .sort((a, b) => String(b.value).localeCompare(String(a.value)))
        .filter((m, i, arr) => i === 0 || m.value !== arr[i - 1].value)
        .slice(0, AVAILABLE_TOP)
      if (months.length) return months
    }
    console.warn('可用数据月份为空，使用本地估算:', res)
  } catch (e) {
    console.warn('获取可用数据月份失败，使用本地估算:', e?.message || e)
  }
  return recentLocalMonths()
}

export default fetchAvailableMonths
