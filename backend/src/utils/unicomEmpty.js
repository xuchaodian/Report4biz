/**
 * 联通返回数据「是否为空」判据 —— **唯一实现**（v1.13.416）
 *
 * ── 为什么单独一个文件 ────────────────────────────────────────────────
 * 扣费口径是「上游成功 **且** 有数据才扣」，所以这个判据直接等于**钱**。
 * 原先有两份几乎同名、语义却不同的实现：
 *   · `routes/smartsteps.js`（门店/单点购买，扣 admin_quota 池）
 *   · `routes/resale.js`（对外 API Key，扣 api_keys.balance）
 * 两份都对「元数据字段」没有区分，导致同一个坑要在两个地方各踩一次。
 * ⇒ 按项目铁律（派生/判定算法必须抽成单一函数共用）合并到这里，两处只 import。
 *
 * ── 修掉的两个真实漏网（2026-11-25 实测复现）──────────────────────────
 * ① `{ error: '上游返回错误码: 500' }` 旧实现 `if (data.error) return false`
 *    ⇒ 判「非空」⇒ **扣 1 次**。上游 `code=200` 但 `data` 里带 error 的形态就会中招。
 * ② 数组元素里的**序号/分类字段**被当成数据：
 *    `{ '1005': [{ day_type: 0, hour: 1, visit: 0 }] }` 旧实现遇到 `hour:1` 就判「有数据」
 *    ⇒ 某点位该月无数据、每小时 visit 全 0 ⇒ **扣 1 次配额、拿回一堆 0**。
 *    同理 `date:'2026-06-01'` 这种字符串会被 `parseFloat` 解析成 2026 ⇒ 误判非空。
 *
 * ── 判定规则（从外到内）──────────────────────────────────────────────
 * · null/undefined ⇒ 空
 * · 数字 ⇒ 0 为空，非 0 非空
 * · 字符串 ⇒ **只有纯数字字符串**（`-?\d+(\.\d+)?`）才参与判定；`'2026-06-01'`/中文/名称一律不算数据
 * · 数组 ⇒ 空数组为空；否则**每个元素都空**才算空（不再因为元素长度 > 0 就判有数据）
 * · 对象 ⇒
 *     - 含 `error` ⇒ 空（上游报错＝这次没拿到可用数据，与 `querySuccess=false` 同待遇）
 *     - 空对象 ⇒ 空
 *     - **有度量键就用度量键判**（`p0_sum`/`*_sum`/`visit`/`stay1..5`/`reach1..5`/`age1_*`/`arpu2_*`…）
 *       —— 这样 `{day_type, hour, visit}` 只看 visit
 *     - 没有度量键 ⇒ 退化：忽略元数据键（hour/day_type/date/id/type…）后看其余值
 *     - 全空 ⇒ 空
 *
 * ⚠️ 方向性：本函数返回 true（空）⇒ **不扣费**。所以任何拿不准的情形都往「空」判，
 *    宁可少收一次钱，也不要出现「扣了配额却没数据」——后者是客户投诉，前者只是账目偏保守。
 */

/** 元数据键：序号 / 分类 / 日期 / 标识，不参与「有没有数据」的判定 */
const META_KEYS = new Set([
  'hour', 'hour_slot', 'slot', 'day_type', 'daytype', 'index', 'idx', 'id', 'seq', 'sort', 'order', 'rank',
  'date', 'day', 'month', 'year', 'week', 'weekday', 'city_month', 'citymonth',
  'radius', 'type', 'code', 'status', 'stage', 'level',
  'popu_type', 'sex', 'gender', 'age_type', 'arpu_type', 'name', 'label'
])

/**
 * 度量键：一旦对象里出现任何一个，就**只**按这些键判定（其余键视为维度/元数据）。
 * 覆盖住已用到的服务：1001(p*_sum/pall/male/female/age/arpu)、1005/1006(visit/stay)、
 * 1007(reach)、1009~1015(金额/人数/预测值)、1019/1020/1021(人数)。
 */
const METRIC_RE = /(^p\d+_|^pall|_sum$|^sum$|visit|_all$|_num$|^num$|^count$|_count$|_cnt$|^total$|_total$|^stay\d|reach\d|_avg$|_ratio$|_rate$|^male\d|^female\d|^age\d+_|^arpu\d+_)/i

/** 取「可用于判定的数字」：只认 number 与**纯数字字符串**（日期/名称一律返回 null） */
function numOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.trim()
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null
  }
  return null
}

/**
 * @param {any} data 上游返回的数据（或 purchases.result_data 里的 apiResult）
 * @returns {boolean} true = 全空/无可用数据 ⇒ 调用方**不得扣费**
 */
export function checkIfDataIsEmpty(data) {
  if (data === null || data === undefined) return true

  const n = numOf(data)
  if (n !== null) return n === 0
  // 非数字标量：字符串（日期/名称/中文）、布尔、函数等 ⇒ 都不算「数据」
  if (typeof data !== 'object') return true

  if (Array.isArray(data)) {
    if (data.length === 0) return true
    return data.every((item) => checkIfDataIsEmpty(item))
  }

  // 对象：上游报错优先判空（与 querySuccess=false 同待遇，⛔ 不要因为「有 error 字段」就认为有数据）
  if (data.error) return true

  const keys = Object.keys(data)
  if (keys.length === 0) return true

  const metricKeys = keys.filter((k) => METRIC_RE.test(k))
  const scope = metricKeys.length
    ? metricKeys
    : keys.filter((k) => !META_KEYS.has(String(k).toLowerCase()))

  // 整个对象只剩元数据（如 { day_type:0, hour:1 }）⇒ 没有任何度量 ⇒ 空
  if (scope.length === 0) return true

  return scope.every((k) => checkIfDataIsEmpty(data[k]))
}
