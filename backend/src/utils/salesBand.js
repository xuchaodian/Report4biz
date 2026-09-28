// ============================================================================
// 销售录入「档位」定义 —— 前后端共用口径的单一来源（v1.13.186）
//
// ⚠️⚠️ 本文件与 `frontend/src/utils/salesBand.js` 必须【逐项一致】：
//   key / label / min / max / mid 五项全部相同。
//   守卫测试 `backend/tests/salesBandGuard.test.js` 会直接 import 两侧模块比对，
//   任一侧改了另一侧没跟 ⇒ 测试失败。
//   为什么允许「两份」：前后端不同语言、前端不能 import 后端模块（vite 打包边界）。
//   为什么必须「守卫」：158 的教训是派生/解析逻辑必须单一函数共用；
//   183 的教训是「同字段两接口口径不一致」会出假值。跨语言无法共用，
//   就用守卫测试把一致性钉死——这是本条口径的兜底手段。
//
// 单位约定：`min` / `max` / `mid` 一律为【万元】（与前端录入框、Excel 模板一致）。
//   落库时由 `bandMidYuan()` 转成【元】写进 store_sales.sales_amount。
//
// 存储语义（store_sales.sales_band）：
//   NULL     = 用户填的是精确值（sales_amount 就是用户填的数）
//   非 NULL  = 用户选的是档位（sales_amount 存【区间中点】，仅供下游做量级计算）
//   ⇒ 下游（销售预测 L1/L2、坪效）**零改动**，需要时再用 sales_band 判断是否为估值。
//
// 为什么档位够用：销售预测走的是 L1「找量级相近的类比店」+ L2 `log(坪效)` 回归，
//   对绝对值的精度不敏感——档位中点的误差远小于跨城市/跨商圈的差异。
// ============================================================================

/**
 * 档位定义表。`mid` 取区间中点（万元）；`gt2000` 无上界，
 * 保守取 2500（略高于下界 2000，宁可低估不可高估）。
 */
export const SALES_BANDS = [
  { key: 'lt200',      label: '< 200 万',       min: 0,    max: 200,  mid: 100 },
  { key: 'b200_400',   label: '200 – 400 万',   min: 200,  max: 400,  mid: 300 },
  { key: 'b400_600',   label: '400 – 600 万',   min: 400,  max: 600,  mid: 500 },
  { key: 'b600_1000',  label: '600 – 1000 万',  min: 600,  max: 1000, mid: 800 },
  { key: 'b1000_2000', label: '1000 – 2000 万', min: 1000, max: 2000, mid: 1500 },
  { key: 'gt2000',     label: '> 2000 万',      min: 2000, max: null, mid: 2500 }
]

/** 按 key 取档位定义；未知 key 返回 null（调用方须拒绝写入，⛔ 不要静默降级成精确值） */
export function bandByKey(key) {
  if (key === undefined || key === null) return null
  const k = String(key).trim()
  if (!k) return null
  return SALES_BANDS.find(b => b.key === k) || null
}

/** key → 区间中点（元）。未知 key 返回 null */
export function bandMidYuan(key) {
  const b = bandByKey(key)
  return b ? b.mid * 10000 : null
}

/** key → 展示用文案（如「400 – 600 万」）。未知 key 原样返回 null */
export function bandLabel(key) {
  const b = bandByKey(key)
  return b ? b.label : null
}

/**
 * 解析用户手输 / Excel 单元格里的档位文本 → key。
 * 依次尝试：① key 原文  ② label 归一化（统一短横线、去空格/万字）  ③ `下限-上限` 数字对
 * 识别不了返回 null —— ⛔ 不要猜、不要模糊匹配单个数字（边界值会落错档）。
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
