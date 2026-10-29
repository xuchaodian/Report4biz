/**
 * 门店台账去重（v1.13.282）
 *
 * 背景：连锁客户的门店台账常常同一条记录出现两次（不同系统导出、名字写法不同：
 *   「文峰广场」/「文峰」、「静安大融城」/「上海静安大融城」）。做门店体检时若不去重，
 *   所有"自我蚕食"结论都会被这些 0m 的假重复污染（实测 youshi 233 条里有 8 组）。
 *
 * 🔴🔴 铁律：**去重与蚕食都只在同一品牌内判定。**
 *   同一账号可以导入多个品牌（实测泉膳 5 个账号各有「滨寿司」+「食其家」），
 *   同一个商场里同时开两个品牌是正常策略，坐标常常**完全相同**（实测 user 26 内至少 15 组）。
 *   ⇒ 跨品牌同址**既不算重复，也不算蚕食**，本函数直接不报。
 *
 * 业务口径：
 *   · 候选组（candidate）：同品牌 + 距离 ≤ epsM（默认 50m）⇒ 用并查集合成一组（支持链式 A≈B≈C）
 *   · 邻近（nearby）     ：同品牌 + epsM < 距离 ≤ nearM（默认 300m）⇒ 成对返回，可能是真蚕食
 *   · 品牌为空：无法确认同品牌 ⇒ **不判重复**，只作为 nearby 返回并标 `brandUnknown`
 *
 * 🔴🔴 v1.13.289 给候选组加了**定性**（`kind`），因为「≤50m 同品牌」并不等于重复：
 *   · `duplicate`  —— 全组共用一个非空门店编码 ⇒ 同一条记录录了两遍，可合并
 *   · `dualFormat` —— 编码不同 + 面积比 ≥2 ⇒ **同一商场的大店 + 小店**，禁止合并
 *                     （实测 youshi 233 条里 13 组全是这种：8xxx 大店 + 2xxx 小店，面积比 2.3~6.3）
 *   · `suspected`  —— 判不了（面积缺失、面积接近但编码不同）⇒ 提示人工，可合并
 *   只有 `mergeable === true` 的组才允许走 POST /merge，后端另有二次拦截。
 *
 * ⚠️ 距离用 haversine（米）。台帐量级到万级时，O(n²) 会卡死 ⇒ 这里按网格分桶，
 *    只比较相邻 9 格。`maxStores` 兜底防止异常大表把内存打爆。
 */

const EARTH_R = 6371008.8

/** 两点球面距离（米）。参数形如 { longitude, latitude } */
export function distanceMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const dLat = lat2 - lat1
  const dLon = toRad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 品牌归一化：去首尾空白、合并内部空白、大小写不敏感 */
export function normalizeBrand(b) {
  return String(b ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
}

/** 门店编码（去空白）。这是判断「同一条记录录了两遍」最硬的证据 */
export function storeCodeOf(s) {
  const v = s?.storeCode ?? s?.store_code ?? ''
  return String(v ?? '').trim()
}

/** 门店面积（㎡）；无效/缺失返回 0 */
export function storeAreaOf(s) {
  const v = s?.storeArea ?? s?.store_area
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 双店型判据的面积比阈值（大店/小店）。实测 youshi 的 17 组落在 2.3~6.3 倍 */
export const DUAL_FORMAT_RATIO = 2

/**
 * 这两家是不是「同一商场里的大店 + 小店」（双店型同址）。
 *
 * 🔴🔴 这是 v1.13.289 修的一个灾难性误判：原先「同品牌 + ≤50m ⇒ 重复」，
 *   实测 youshi 233 条里的 13 组同址门店**门店编码全不同、面积比 2.3~6.3 倍**
 *   （8xxx 大店 298~657㎡ + 2xxx 小店 29~216㎡，两段中间有 82㎡ 空档）。
 *   它们是真店：同一商场里堂食/MEGA 店 + 外卖/档口店。按重复合并掉 = 删客户真实门店。
 *
 * 判据（顺序不能反）：
 *   · 两者编码都非空且**相同** ⇒ 不是双店型（更像重复），返回 false
 *   · 任一面积缺失 ⇒ 无法算比 ⇒ 返回 false（交人工，不当双店型处理）
 *   · 面积比 ≥ ratio ⇒ 双店型
 */
export function looksLikeDualFormat(a, b, ratio = DUAL_FORMAT_RATIO) {
  const ca = storeCodeOf(a)
  const cb = storeCodeOf(b)
  if (ca && cb && ca === cb) return false
  const aa = storeAreaOf(a)
  const ab = storeAreaOf(b)
  if (!aa || !ab) return false
  return Math.max(aa, ab) / Math.min(aa, ab) >= ratio
}

/**
 * 给一个「同品牌 + 彼此 ≤epsM」的连通组定性。
 *
 * @returns {{kind:'duplicate'|'dualFormat'|'suspected', codes:string[], areas:number[], reason:string}}
 *   duplicate  —— 全组共用一个非空编码（同一条记录录了两遍），可合并
 *   dualFormat —— 两两都是「编码不同 + 面积比 ≥2」，是同一商场的大店 + 小店，**禁止合并**
 *   suspected  —— 其余（面积缺失、面积接近但编码不同…），提示人工判断，可合并
 */
export function classifyStoreGroup(group, ratio = DUAL_FORMAT_RATIO) {
  const codes = group.map(storeCodeOf).filter(Boolean)
  const uniq = [...new Set(codes)]
  const areas = group.map(storeAreaOf).filter((a) => a > 0)

  // ① 全组共用一个编码 ⇒ 强证据
  if (uniq.length === 1 && codes.length === group.length) {
    return { kind: 'duplicate', codes: uniq, areas, reason: `门店编码相同（${uniq[0]}）` }
  }

  // ② 两两都是双店型 ⇒ 整组是双店型
  let allDual = group.length >= 2
  for (let i = 0; i < group.length && allDual; i += 1) {
    for (let j = i + 1; j < group.length; j += 1) {
      if (!looksLikeDualFormat(group[i], group[j], ratio)) { allDual = false; break }
    }
  }
  if (allDual) {
    const lo = Math.min(...areas)
    const hi = Math.max(...areas)
    return {
      kind: 'dualFormat',
      codes: uniq,
      areas,
      reason: `编码不同 + 面积 ${lo}㎡ / ${hi}㎡（${(hi / lo).toFixed(1)} 倍）⇒ 大店 + 小店`
    }
  }

  // ③ 判不了 ⇒ 交人工（可合并，但提示要看一眼）
  const hint = areas.length === group.length
    ? `面积 ${Math.min(...areas)}~${Math.max(...areas)}㎡，编码不同`
    : '面积或编码缺失'
  return { kind: 'suspected', codes: uniq, areas, reason: hint }
}

function validCoord(s) {
  const lng = Number(s.longitude)
  const lat = Number(s.latitude)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false
  if (lng === 0 && lat === 0) return false          // 0,0 是常见占位脏数据
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return false
  return true
}

function pick(s) {
  return {
    id: s.id,
    name: s.name || '',
    brand: s.brand || '',
    storeCode: s.store_code || s.storeCode || '',
    city: s.city || '',
    district: s.district || '',
    address: s.address || '',
    longitude: Number(s.longitude),
    latitude: Number(s.latitude),
    status: s.status || '',
    storeArea: s.store_area ?? s.storeArea ?? null
  }
}

/**
 * 找出门店台账里的重复组与邻近对。
 *
 * @param {Array<object>} stores 门店行（markers 表的行，字段可以是 snake_case 或 camelCase）
 * @param {object} [opts]
 * @param {number} [opts.epsM=50]    ≤ 该距离且同品牌 ⇒ 判为重复
 * @param {number} [opts.nearM=300]  epsM < 距离 ≤ 该值且同品牌 ⇒ 判为邻近
 * @param {number} [opts.maxStores=50000] 超过则拒绝计算（返回 truncated 标记，不抛错）
 * @returns {{duplicateGroups:Array, nearbyPairs:Array, stats:object}}
 */
export function findStoreDuplicates(stores, opts = {}) {
  const epsM = Number(opts.epsM) > 0 ? Number(opts.epsM) : 50
  const nearM = Number(opts.nearM) > 0 ? Number(opts.nearM) : 300
  const maxStores = Number(opts.maxStores) > 0 ? Number(opts.maxStores) : 50000

  const all = Array.isArray(stores) ? stores : []
  const valid = all.filter(validCoord).map(pick)
  const stats = {
    total: all.length,
    valid: valid.length,
    skipped: all.length - valid.length,
    truncated: false,
    epsM,
    nearM
  }
  if (valid.length > maxStores) {
    stats.truncated = true
    return { duplicateGroups: [], nearbyPairs: [], stats }
  }

  // 网格分桶（同一桶内 + 相邻 8 桶才可能是近邻）
  const cellDeg = nearM / 111320 * 1.5            // 略放大，保证跨格也能命中
  const grid = new Map()
  const cellKey = (lng, lat) => `${Math.floor(lng / cellDeg)}|${Math.floor(lat / cellDeg)}`
  for (const s of valid) {
    const k = cellKey(s.longitude, s.latitude)
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(s)
  }

  // 并查集：把「同品牌 + ≤epsM」的连通块合成一组
  const parent = new Map(valid.map((s) => [s.id, s.id]))
  const find = (x) => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n }
    return r
  }
  const union = (a, b) => {
    const ra = find(a); const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  const nearbyPairs = []
  const dupEdges = new Set()
  const seen = new Set()   // 已处理过的 id 对，避免相邻格重复扫描

  for (const s of valid) {
    const cx = Math.floor(s.longitude / cellDeg)
    const cy = Math.floor(s.latitude / cellDeg)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = grid.get(`${cx + dx}|${cy + dy}`)
        if (!bucket) continue
        for (const o of bucket) {
          if (o.id === s.id) continue
          const pairKey = s.id < o.id ? `${s.id}|${o.id}` : `${o.id}|${s.id}`
          if (seen.has(pairKey)) continue
          seen.add(pairKey)

          const brandA = normalizeBrand(s.brand)
          const brandB = normalizeBrand(o.brand)
          const sameBrand = brandA !== '' && brandA === brandB
          const brandUnknown = brandA === '' || brandB === ''
          // 🔴 跨品牌一律不报（双品牌同址是正常策略）；品牌缺失也不判重复
          if (!sameBrand && !brandUnknown) continue

          const d = distanceMeters(s, o)
          if (d > nearM) continue

          if (sameBrand && d <= epsM) {
            dupEdges.add(pairKey)
            union(s.id, o.id)
          } else if (sameBrand || brandUnknown) {
            // 同品牌的 epsM~nearM 之间，或品牌缺失的近距离对
            nearbyPairs.push({
              distanceM: Math.round(d),
              brandUnknown,
              // 邻近对永远不给合并入口，但标出双店型便于 UI 解释（实测 157/159/255/278m 也是大店+小店）
              kind: brandUnknown
                ? 'brandUnknown'
                : (looksLikeDualFormat(s, o) ? 'dualFormat' : 'nearby'),
              mergeable: false,
              stores: [s, o]
            })
          }
        }
      }
    }
  }

  // 按并查集根聚合重复组（≥2 条的根才算重复）
  const buckets = new Map()
  for (const s of valid) {
    const root = find(s.id)
    if (!buckets.has(root)) buckets.set(root, [])
    buckets.get(root).push(s)
  }
  const duplicateGroups = []
  for (const group of buckets.values()) {
    if (group.length < 2) continue
    // 组内最大距离：用来告诉用户"这组内部最远差多少米"
    let maxD = 0
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        maxD = Math.max(maxD, distanceMeters(group[i], group[j]))
      }
    }
    const sorted = group.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
    // 🔴 定性：重复 / 双店型 / 待确认。双店型**不可合并**（见 looksLikeDualFormat 注释）
    const cls = classifyStoreGroup(sorted)
    duplicateGroups.push({
      brand: group[0].brand || '',
      size: group.length,
      maxDistanceM: Math.round(maxD),
      kind: cls.kind,
      mergeable: cls.kind !== 'dualFormat',
      reason: cls.reason,
      storeCodes: cls.codes,
      storeAreas: cls.areas,
      stores: sorted
    })
  }
  // 排序：可合并的在前；同类里「编码相同」最硬（直接可判），其次待确认，最后双店型
  // ⛔ 双店型排最后，避免用户第一眼就点到「合并不是给它们用的」那一组
  const KIND_RANK = { duplicate: 0, suspected: 1, dualFormat: 2 }
  duplicateGroups.sort((a, b) => Number(b.mergeable) - Number(a.mergeable)
    || (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9)
    || b.size - a.size
    || a.maxDistanceM - b.maxDistanceM)

  // 邻近对里去掉已经被并进同一重复组的（否则同一家店会被报两次）
  const prunedNearby = nearbyPairs
    .filter((p) => find(p.stores[0].id) !== find(p.stores[1].id))
    .sort((a, b) => a.distanceM - b.distanceM)

  stats.duplicateGroups = duplicateGroups.length
  // 按定性拆开统计：双店型**不算冗余**（它们是两家真店），不能从独立门店数里扣
  const mergeable = duplicateGroups.filter((g) => g.mergeable)
  const dual = duplicateGroups.filter((g) => g.kind === 'dualFormat')
  stats.mergeableGroups = mergeable.length
  stats.dualFormatGroups = dual.length
  stats.dualFormatStores = dual.reduce((n, g) => n + g.size, 0)
  stats.duplicateStores = duplicateGroups.reduce((n, g) => n + g.size, 0)
  stats.redundantRecords = mergeable.reduce((n, g) => n + g.size - 1, 0)
  stats.nearbyPairs = prunedNearby.length
  stats.distinctStores = stats.valid - stats.redundantRecords

  return { duplicateGroups, nearbyPairs: prunedNearby, stats }
}
