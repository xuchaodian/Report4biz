/**
 * 「我的门店里的候选店」与「候选点位推进记录」的关联判据（v1.13.376 · P0）
 *
 * ── 为什么要这个文件 ────────────────────────────────────────────────────
 * 376 把候选点位页的数据源换成 `markers`（`store_type ∈ 重点候选/一般候选`），
 * 而 333 的推进阶段（待评估/已勘踏/立项/放弃 + 流水）存在 `store_candidates` 里。
 * 两边要叠加显示，就必须能回答一个问题：**这条门店记录，对应哪条推进记录？**
 *
 * 关联键原本想用 `store_code`，但两边**同时有 store_code 的极少**：
 *   · `markers.store_code` 可空（手工加的门店、地图右键加的点位都没有）
 *   · `store_candidates` 333 建表时**根本没有这一列**（376 才补，且只有新数据才有值）
 * ⇒ 只靠 store_code 会让绝大多数行关联不上，同一家店在页面上出现两条。
 *
 * 现网真实例子（写这段代码时在库里核到的）：
 *   markers:          id=12540  name='浦江绿地乐和城店'  store_code='SH001'  (31.077159, 121.496987)
 *   store_candidates: id=11     name='浦江绿地乐和城'    store_code=(无)      (31.076240, 121.497610)
 *   两条相距 118m、名字差一个「店」字 —— 按 10m 或按原文相等都关联不上，
 *   但它们显然是同一个点位（前者是从门店台账同步进来的，后者是当年手工录的）。
 *
 * ── 判据（按优先级，命中即返回）──────────────────────────────────────────
 *   ① `store_code` 两边都非空且相等        —— 最硬的键，有就必须用
 *   ② 归一化名称相等 且 平面距离 ≤ 500m     —— 覆盖「同一家店、名字多一个字、坐标手点偏几十米」
 *   ③ 归一化名称相等 且 城市相同（都非空）   —— 覆盖「名字对得上但坐标没填/填错」
 *   ⛔ 不做「模糊匹配 / 编辑距离 / 拼音」：错配的代价是把别人的推进记录挂到你这家店上，
 *      比「关联不上、多显示一条」严重得多 —— 后者用户一眼能看出，前者悄无声息。
 *   ⛔ 不做「只按名称相等、不限城市」：连锁品牌同名店在不同城市很常见。
 *
 * ── 为什么不在这里算距离 ────────────────────────────────────────────────
 * 项目里已有 `potentialGrid.js::planarMeters`（米制平面近似，1km 尺度误差 < 0.1%），
 * 但那个模块 import 了 config / storeDedup / storeLights —— 一旦测试里 mock 掉其中任何一个，
 * 本文件的判据就会静默失效（`undefined` 比较恒 false ＝ 假绿，373 踩过这个坑）。
 * ⇒ 距离函数由调用方**注入**（`distM`），本文件保持零依赖，可被纯函数单测直接 import。
 *
 * ⚠️ 本模块必须**零依赖**（同 reuseKey.js / candidateStage.js）。
 */

/** 关联的距离容差（米）—— 覆盖「手点地图 vs 台账地址」的常见偏差 */
export const LINK_TOL_M = 500

/**
 * 归一化门店名：用于「是不是同一个地方」的比较，⛔ 不要用它做展示。
 *
 * 规则：去全部空白 → 反复剥掉尾部的「业态/载体后辍词」→ 再判等。
 * 剥词表的顺序是**长的在前**（'候选门店' 必须先于 '候选'、'候选' 先于 '店'），
 * 否则 '星巴克望京候选点' 会先被 '候选' 截成 '星巴克望京点'，再也没机会匹配。
 *
 * 幂等：`normStoreName(normStoreName(x)) === normStoreName(x)`。
 */
export function normStoreName(raw) {
  let s = String(raw ?? '').replace(/\s+/g, '')
  if (!s) return ''
  // 长词在前；最多剥 3 轮（'星巴克望京候选门店店' 这类手抖叠加）
  const SUFFIX = [
    '候选门店', '候选点位', '候选点', '候选', '旗舰店', '专营店', '分店', '门店', '铺位', '铺面', '店面', '店'
  ]
  for (let round = 0; round < 3; round += 1) {
    let changed = false
    for (const suf of SUFFIX) {
      if (s.length > suf.length && s.endsWith(suf)) {
        s = s.slice(0, -suf.length)
        changed = true
        break // 每轮只剥一个，再从最长开始试（保证 '候选门店' 不被 '门店' 抢先）
      }
    }
    if (!changed) break
  }
  return s
}

/** 两个字符串「都非空且相等」（null/''/undefined 一律不算命中） */
function sameFilled(a, b) {
  const x = String(a ?? '').trim()
  const y = String(b ?? '').trim()
  return !!x && !!y && x === y
}

/**
 * 把一条门店记录（marker）与候选池里的记录做匹配。
 * @param {object} marker   markers 行（需 store_code / name / city / latitude / longitude）
 * @param {object[]} candidates  store_candidates 行（同上字段 + id）
 * @param {(lng1:number,lat1:number,lng2:number,lat2:number)=>number} distM  距离函数（米）
 * @returns {object|null}  命中的 candidate 行；未命中 ⇒ null
 */
export function matchCandidate(marker, candidates, distM) {
  if (!marker || !Array.isArray(candidates) || !candidates.length) return null

  // ① store_code：两侧都要有值才算数（空 == 空 不是「同一个」）
  const code = String(marker.store_code ?? '').trim()
  if (code) {
    const hit = candidates.find((c) => String(c.store_code ?? '').trim() === code)
    if (hit) return hit
  }

  const name = normStoreName(marker.name)
  if (!name) return null

  // ② 名称归一相等 + 500m 内
  const sameName = candidates.filter((c) => normStoreName(c.name) === name)
  if (!sameName.length) return null

  const lat = Number(marker.latitude)
  const lng = Number(marker.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lng) && typeof distM === 'function') {
    let best = null
    let bestD = Infinity
    for (const c of sameName) {
      const clat = Number(c.latitude)
      const clng = Number(c.longitude)
      if (!Number.isFinite(clat) || !Number.isFinite(clng)) continue
      const d = distM(lng, lat, clng, clat)
      if (Number.isFinite(d) && d <= LINK_TOL_M && d < bestD) { best = c; bestD = d }
    }
    if (best) return best
    // 同名但没有一个在 500m 内 ⇒ 往下走③（可能坐标填错）
  }

  // ③ 名称归一相等 + 同城（两边城市都非空且相等）
  const city = String(marker.city ?? '').trim()
  if (city) {
    const hit = sameName.find((c) => sameFilled(c.city, city))
    if (hit) return hit
  }

  return null
}

/**
 * 批量关联：markers 与 store_candidates 一对一配对。
 *
 * 🔴 **一条 candidate 只能被一个 marker 占用**：否则两个同名门店（同城开了两家）
 *    会共用同一份推进流水，改 A 的阶段 B 也跟着变 —— 那是最难排查的一类 bug。
 *    所以按 markers 的顺序贪心分配，已被占用的 candidate 不再参与后续匹配。
 *
 * @returns {{ pairs: {marker:object, candidate:object}[], orphans: object[] }}
 *   pairs   —— 关联成功的对（顺序同入参 markers）
 *   orphans —— 没有任何 marker 认领的 candidate（＝历史独立点位，仍要在列表里显示）
 */
export function linkAll(markers, candidates, distM) {
  const pool = Array.isArray(candidates) ? candidates.slice() : []
  const pairs = []
  const used = new Set()

  for (const m of Array.isArray(markers) ? markers : []) {
    const free = pool.filter((c) => !used.has(c.id))
    const hit = matchCandidate(m, free, distM)
    if (hit) {
      used.add(hit.id)
      pairs.push({ marker: m, candidate: hit })
    }
  }
  const orphans = pool.filter((c) => !used.has(c.id))
  return { pairs, orphans }
}
