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
 *   · 重复（duplicate）：同品牌 + 距离 ≤ epsM（默认 50m）⇒ 用并查集合成一组（支持链式 A≈B≈C）
 *   · 邻近（nearby）   ：同品牌 + epsM < 距离 ≤ nearM（默认 300m）⇒ 成对返回，可能是真蚕食
 *   · 品牌为空：无法确认同品牌 ⇒ **不判重复**，只作为 nearby 返回并标 `brandUnknown`
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
    duplicateGroups.push({
      brand: group[0].brand || '',
      size: group.length,
      maxDistanceM: Math.round(maxD),
      stores: group.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
    })
  }
  duplicateGroups.sort((a, b) => b.size - a.size || a.maxDistanceM - b.maxDistanceM)

  // 邻近对里去掉已经被并进同一重复组的（否则同一家店会被报两次）
  const prunedNearby = nearbyPairs
    .filter((p) => find(p.stores[0].id) !== find(p.stores[1].id))
    .sort((a, b) => a.distanceM - b.distanceM)

  stats.duplicateGroups = duplicateGroups.length
  stats.duplicateStores = duplicateGroups.reduce((n, g) => n + g.size, 0)
  stats.redundantRecords = duplicateGroups.reduce((n, g) => n + g.size - 1, 0)
  stats.nearbyPairs = prunedNearby.length
  stats.distinctStores = stats.valid - stats.redundantRecords

  return { duplicateGroups, nearbyPairs: prunedNearby, stats }
}
