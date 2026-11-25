/**
 * 已购半径档位 → 「该档回答什么问题」的角色判定（v1.13.417）
 *
 * ── 业主口径（2026-11-25）──────────────────────────────────────────────
 *   「小范围半径（一般小于 500m）主要看动态到访人次关联信息；
 *     半径 1km 以上侧重静态居民/工作人数、居民画像（收入、职业、消费力）」
 * 但**不设固定阈值**（业主明确否掉写死 500/1000）：
 *   同一座城市，社区型点位 300m 就到"片区"，郊区大盘 2km 还只是"一个小区"。
 *   ⇒ 改成**按档位的相对位置 + 数据校验**判定角色：
 *     · 半径最小的那一档 ⇒ 近场档（用户实际是按"近场看动线"的心态买最小档的）
 *     · 半径最大的那一档 ⇒ 片区档
 *     · 中间的 ⇒ 过渡档
 *   再用数据校验最小档是否真的"以流动为主"（到访强度在各档中的排名）：
 *     若不占优，降级为「近场参照档」，⛔ 不硬说它是动线档。
 *
 * ⚠️ 这里只判角色，**不判好坏**。⛔ 不要在这里加"建议用哪档做决策"之类结论 ——
 *    报告只陈述"这一档能回答什么问题"，拿哪档立项是用户的事。
 */

import { radiusText } from './radiusText.js'

export const TIER_ROLES = {
  flow: {
    key: 'flow',
    label: '近场动线档',
    view: 'visit',       // 该角色该看哪套口径（visit=到访人次 / live=居住）
    focus: '动态到访',
    hint: '看这一档的到访人次、到访强度、外省到访占比与到访人群结构 —— 回答「有多少人经过、从哪来、什么时段来」'
  },
  near: {
    key: 'near',
    label: '近场参照档',
    view: 'visit',
    focus: '动线（参照）',
    hint: '半径最小，但到访强度在各档中不占优 —— 只作参照，不作为动线结论的依据'
  },
  walk: {
    key: 'walk',
    label: '步行客群档',
    view: 'live',
    focus: '动线 + 常驻',
    hint: '动线与常驻客群混合：人数看居住/工作，流动看访次；两套口径都要看，别只挑一个'
  },
  static: {
    key: 'static',
    label: '片区基本盘档',
    view: 'live',
    focus: '静态居民 / 工作',
    hint: '看这一档的居住与工作人数、职住比、密度与居民画像（消费水平/职业/教育/收入资产）—— 回答「这片人是谁、有没有消费力」'
  },
  single: {
    key: 'single',
    label: '单档（无对比）',
    view: 'live',
    focus: '综合',
    hint: '该位置只买过一档，没有跨半径对比，按该档自身口径解读'
  }
}


const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 给每档写入 `role / roleLabel / roleView / roleFocus / roleHint / roleBasis / visitIntensity`
 * @param {Array<{radius:number, live:number|null, work:number|null, visit:number|null, density:number|null}>} rows
 *        必须已按半径升序
 * @returns {Array} 同一个数组（原地补字段），便于链式使用
 */
export function assignTierRoles(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows || []

  const n = rows.length
  // 到访强度 = 到访人次 ÷ 居住人口（「这个点被使用的频次相对常住人口有多高」）
  for (const r of rows) {
    const live = numOrNull(r.live)
    const visit = numOrNull(r.visit)
    r.visitIntensity = (live !== null && live > 0 && visit !== null) ? visit / live : null
  }
  // 到访强度排名（含 null 的不参与排名）
  const ranked = rows
    .filter((r) => r.visitIntensity !== null)
    .sort((a, b) => b.visitIntensity - a.visitIntensity)
  const rankOf = (row) => {
    const i = ranked.indexOf(row)
    return i < 0 ? null : i + 1
  }

  const put = (row, roleKey, basis) => {
    const meta = TIER_ROLES[roleKey]
    row.role = meta.key
    row.roleLabel = meta.label
    row.roleView = meta.view
    row.roleFocus = meta.focus
    row.roleHint = meta.hint
    row.roleBasis = basis
  }

  if (n === 1) {
    put(rows[0], 'single', `该位置仅买过 ${radiusText(rows[0].radius)} 这一档`)
    return rows
  }

  const first = rows[0]
  const last = rows[n - 1]
  const fRank = rankOf(first)
  const fIntensity = first.visitIntensity
  // 最小档是否真的"以流动为主"：它是各档里到访强度最高的，或并列最高
  const firstIsFlow = fIntensity !== null && fRank === 1
  const firstBasis = fIntensity !== null
    ? `半径最小（${radiusText(first.radius)}）；到访强度 ${fIntensity.toFixed(1)} 倍，在 ${ranked.length} 档中排第 ${fRank || '—'}`
    : `半径最小（${radiusText(first.radius)}）；该档缺少到访/居住数据，无法验证流动属性`
  put(first, firstIsFlow ? 'flow' : 'near', firstBasis)

  // ── 片区侧从哪一档开始：**密度峰值档及其以上** ──────────────────────
  // 业主口径「1km 以上侧重静态」，但不许写死 1km ⇒ 用数据找"静态人口最集中"的那一档：
  //   密度先随半径上升、过了峰值开始被摊薄 —— 峰值档就是"这片人住得最密"的尺度，
  //   从它开始再看更大的圈，看的就是片区基本盘而不是近场客群了。
  // ⚠️ 密度全缺时退回"只有最大档是片区档"（最保守），⛔ 不要瞎猜。
  let peakIdx = -1
  let peakD = -Infinity
  rows.forEach((r, i) => {
    const d = numOrNull(r.density)
    if (d !== null && d > peakD) { peakD = d; peakIdx = i }
  })
  const staticFrom = peakIdx >= 0 ? Math.max(peakIdx, 1) : n - 1
  const peakRow = peakIdx >= 0 ? rows[peakIdx] : null

  for (let i = 1; i < n; i++) {
    const r = rows[i]
    const d = numOrNull(r.density)
    const dTxt = d !== null ? d.toLocaleString('zh-CN') : '—'
    if (i >= staticFrom) {
      let basis
      if (i === peakIdx) {
        basis = `半径 ${radiusText(r.radius)}；密度 ${dTxt} 人/km²，为各档最高 ⇒ 静态人口最集中，从这一档起看片区基本盘`
      } else if (peakRow && d !== null && peakD > 0) {
        const pct = ((d - peakD) / peakD) * 100
        basis = `半径 ${radiusText(r.radius)}；密度 ${dTxt} 人/km²，较密度峰值档（${radiusText(peakRow.radius)}）${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`
      } else {
        basis = `半径 ${radiusText(r.radius)}；密度 ${dTxt} 人/km²`
      }
      put(r, 'static', basis)
    } else {
      put(r, 'walk', `介于近场与片区之间；密度 ${dTxt} 人/km²`)
    }
  }

  return rows
}

/**
 * 对比表的「可比性」说明（N 档通用）。
 * 🔴 为什么必须写：人口绝对值**一定**随半径变大而变大，光看那一列等于「最大档永远赢」；
 *    能横向比的只有密度、职住比、到访强度。这句话要印在纸上，否则读者会误读。
 */
export function tierCompareNote(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return ''
  const roles = rows.map((r) => r.roleLabel).join(' → ')
  // ⚠️ 纸面是纯文本渲染（Vue 插值，不解析 markdown）⇒ ⛔ 不要在这里写 `**加粗**`，星号会原样印出来
  return `档位角色：${roles}。居住/工作/到访的「绝对值」随半径增大必然变大，不可直接跨档比较；`
    + '可横向比较的是「人口密度、职住比、到访强度」这三项（已消除半径规模差异）。'
}
