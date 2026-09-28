// ============================================================================
// 销售录入「档位」定义 —— 与后端 `backend/src/utils/salesBand.js` 同口径
//
// ⚠️⚠️ 两侧必须【逐项一致】：key / label / min / max / mid 五项全部相同。
//   守卫测试 `backend/tests/salesBandGuard.test.js` 会直接 import 两个模块比对，
//   任一侧改了另一侧没跟 ⇒ 测试失败。改这里请同步改后端那一份。
//
// 单位：min / max / mid 一律【万元】（与录入框、Excel 模板一致）；
//   提交给后端时传 key（`salesBand`），由后端换算成元存储。
//
// 存储语义：store_sales.sales_band 为 NULL 表示精确值录入；
//   非 NULL 表示档位录入，此时 sales_amount 是【区间中点】—— 前端展示
//   这类行必须走 `bandLabel()` 显示区间并标注「档位估值」，⛔ 不要把中点
//   当成精确值直接显示成「500 万」。
// ============================================================================

/** 档位定义表（与后端同口径，勿单独改动） */
export const SALES_BANDS = [
  { key: 'lt200',      label: '< 200 万',       min: 0,    max: 200,  mid: 100 },
  { key: 'b200_400',   label: '200 – 400 万',   min: 200,  max: 400,  mid: 300 },
  { key: 'b400_600',   label: '400 – 600 万',   min: 400,  max: 600,  mid: 500 },
  { key: 'b600_1000',  label: '600 – 1000 万',  min: 600,  max: 1000, mid: 800 },
  { key: 'b1000_2000', label: '1000 – 2000 万', min: 1000, max: 2000, mid: 1500 },
  { key: 'gt2000',     label: '> 2000 万',      min: 2000, max: null, mid: 2500 }
]

/** 按 key 取档位定义；未知 key 返回 null */
export function bandByKey(key) {
  if (key === undefined || key === null) return null
  const k = String(key).trim()
  if (!k) return null
  return SALES_BANDS.find(b => b.key === k) || null
}

/** key → 区间中点（万元）。前端一般不用（展示要走 label 显示区间） */
export function bandMidWan(key) {
  const b = bandByKey(key)
  return b ? b.mid : null
}

/** key → 展示用区间文案（如「400 – 600 万」） */
export function bandLabel(key) {
  const b = bandByKey(key)
  return b ? b.label : null
}

/** el-select 用的选项数组（label / value 直供） */
export const SALES_BAND_OPTIONS = SALES_BANDS.map(b => ({ label: b.label, value: b.key }))

/**
 * 解析用户手输 / Excel 单元格里的档位文本 → key（与后端同规则）。
 * 识别不了返回 null，不要猜。
 */
export function parseBandInput(raw) {
  if (raw === undefined || raw === null) return null
  const s = String(raw).trim()
  if (!s) return null

  const direct = SALES_BANDS.find(b => b.key === s)
  if (direct) return direct.key

  const norm = (t) => t.replace(/[–—~～−]/g, '-').replace(/\s+/g, '')
  const byLabel = SALES_BANDS.find(b => norm(b.label) === norm(s))
  if (byLabel) return byLabel.key

  const m = norm(s).replace(/万元|万/g, '').match(/^(\d+)-(\d+)$/)
  if (m) {
    const lo = Number(m[1])
    const hi = Number(m[2])
    const hit = SALES_BANDS.find(b => b.min === lo && b.max === hi)
    if (hit) return hit.key
  }
  return null
}
