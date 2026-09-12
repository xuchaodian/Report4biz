// ============================================================================
// 管辖范围（scope）城市互斥校验（P0 · 集团/子公司数据同步 · 批次 C）
// ----------------------------------------------------------------------------
// 设计方案：
//   §D6  城市会不会重叠？→ **配置期互斥校验**（v0.4 由「运行时认领锁」降级而来）
//   §3.5 管辖范围变更模型（扩容零成本 / 划拨走向导）
//   §7.5 管辖范围设置抽屉（保存即互斥校验）
//   规则 11：管辖范围**只到城市级**，不提供区县细分
//
// ★ 本模块**不 import 任何模块**（纯函数 + 一个「收 db 参数」的门面函数）。
//   因此可以在生产环境直接 `import()` 做功能自检，而不会触发 getDb() 加载整库
//   （见 skill report4biz-deploy「注意事项」：路由模块绝不可在生产 import）。
//
// ★ 为什么是「配置期互斥」而不是「运行时打锁」：
//   写权唯一性由**保存时的校验**保证，运行时（同步候选计算）就无需再判
//   `claimed_by_user_id IS NULL`。收益是删掉两列（claimed_by_user_id / claimed_at）、
//   删掉改派接口与折叠 UI，候选集公式少一个条件 —— 代码与心智负担同时下降。
//
// ⚠️ 归一化只用于**比较**，不用于**存储**：scope_json 里保留用户勾选时的原样
//    （「上海市」仍存「上海市」），只有比较键会把「上海市 / 上海 / 上海 市」视为同城。
// ============================================================================

/**
 * 城市名归一化 —— 互斥比较的键。
 *   ' 上海市 '  → '上海'
 *   '上海'      → '上海'
 *   'Shanghai'  → 'Shanghai'
 * 规则：去首尾空白 + 去所有内部空白（含全角空格）+ 去结尾的「市」。
 * 不做「市辖区」「新区」等二级后缀处理 —— 管辖范围只到城市级（规则 11）。
 */
export function normalizeCity(raw) {
  if (raw === null || raw === undefined) return ''
  return String(raw)
    .replace(/[\s\u3000]+/g, '')     // 半角/全角空白
    .trim()
    .replace(/市$/, '')
}

/**
 * 解析 scope_json 的 cities（容错：损坏 JSON / 非数组 / 混入非字符串一律安全降级）。
 * @returns {string[]} 去空后的城市数组（原样，不归一化）
 */
export function parseCityList(raw) {
  let obj = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return []
    try { obj = JSON.parse(raw) } catch (e) { return [] }
  }
  if (!obj || typeof obj !== 'object') return []
  const arr = Array.isArray(obj) ? obj : obj.cities
  if (!Array.isArray(arr)) return []
  return arr.map(c => (typeof c === 'string' ? c.trim() : '')).filter(Boolean)
}

/**
 * 解析 scope_json 的 brands（同上容错）。品牌留空 = 不限（§D5）。
 */
export function parseBrandList(raw) {
  let obj = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return []
    try { obj = JSON.parse(raw) } catch (e) { return [] }
  }
  if (!obj || typeof obj !== 'object') return []
  const arr = Array.isArray(obj) ? obj : obj.brands
  if (!Array.isArray(arr)) return []
  return arr.map(b => (typeof b === 'string' ? b.trim() : '')).filter(Boolean)
}

/**
 * 构建「城市 → 占用方」映射。
 * @param {Array} members 成员列表 [{ userId, username, company, scope:{cities,brands} }]
 * @param {number|null} excludeUserId 排除的账号（通常=正在编辑的成员）
 * @returns {Map<string, {city:string,userId:number,username:string,company:string}>}
 *          键 = normalizeCity(城市)，值 = 该城市第一个占用方（含其原本写法）
 */
export function buildOccupancyMap(members, excludeUserId = null) {
  const map = new Map()
  for (const m of (members || [])) {
    if (!m) continue
    if (excludeUserId != null && Number(m.userId) === Number(excludeUserId)) continue
    const cities = (m.scope && Array.isArray(m.scope.cities)) ? m.scope.cities : []
    for (const raw of cities) {
      const key = normalizeCity(raw)
      if (!key || map.has(key)) continue      // 先到先得：同一键只记第一个占用方
      map.set(key, {
        city: raw,
        userId: m.userId,
        username: m.username || `#${m.userId}`,
        company: m.company || null
      })
    }
  }
  return map
}

/**
 * ★ 核心：找出「本次要保存的城市」中已被本组织**其他成员**占用的部分。纯函数。
 * @param {Array}  members       本组织全部成员（含 scope）
 * @param {string[]} cities      本次提交的城市
 * @param {number|null} excludeUserId 正在编辑的成员（自身占用不算冲突）
 * @returns {Array} [{ city, cityKey, userId, username, company }]
 */
export function collectConflicts(members, cities, excludeUserId = null) {
  const map = buildOccupancyMap(members, excludeUserId)
  const out = []
  const seen = new Set()
  for (const raw of (cities || [])) {
    const key = normalizeCity(raw)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const holder = map.get(key)
    if (holder) {
      out.push({
        city: raw,            // 本次提交里的写法（UI 提示语用它）
        cityKey: key,
        userId: holder.userId,
        username: holder.username,
        company: holder.company,
        heldAs: holder.city   // 占用方库里的写法（可能与本次写法不同，如「上海」vs「上海市」）
      })
    }
  }
  return out
}

/**
 * 门面：直接按 orgId 查库后做互斥校验（供 routes/orgs.js 调用）。
 * 保持「收 db 参数」而不 import database.js —— 本模块因此可被独立单测与生产自检。
 * @returns {Array} 同 collectConflicts
 */
export function findScopeConflicts(db, orgId, excludeUserId, cities) {
  const rows = db.prepare(`
    SELECT m.user_id, m.scope_json, u.username, u.company
    FROM org_members m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ?
  `).all(orgId)

  const members = rows.map(r => ({
    userId: r.user_id,
    username: r.username || `#${r.user_id}`,
    company: r.company || null,
    scope: { cities: parseCityList(r.scope_json), brands: parseBrandList(r.scope_json) }
  }))

  return collectConflicts(members, cities, excludeUserId)
}

/**
 * 组织内「城市占用表」——供 §7.5 UI 预检（GET /api/orgs/:id/scope-conflicts）。
 * @returns {{ cities: Array, members: Array }}
 *   cities  = [{ city, cityKey, userId, username, company }]  按城市去重（先到先得）
 *   members = [{ userId, username, company, cities: [], count }] 每人持有哪些城市
 */
export function describeOccupancy(db, orgId) {
  const rows = db.prepare(`
    SELECT m.user_id, m.scope_json, u.username, u.company
    FROM org_members m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ? AND m.member_role != 'owner'
    ORDER BY m.joined_at ASC, m.id ASC
  `).all(orgId)

  const members = rows.map(r => {
    const cityList = parseCityList(r.scope_json)
    return {
      userId: r.user_id,
      username: r.username || `#${r.user_id}`,
      company: r.company || null,
      // ★ 必须挂成 scope.cities —— buildOccupancyMap 读的是这个结构
      scope: { cities: cityList, brands: parseBrandList(r.scope_json) },
      cities: cityList,        // 成员视图（人 → 持有哪些城市）
      count: cityList.length
    }
  })

  const cityMap = buildOccupancyMap(members, null)
  const cities = [...cityMap.values()]
    .map(h => ({ ...h, cityKey: normalizeCity(h.city) }))
    .sort((a, b) => String(a.cityKey).localeCompare(String(b.cityKey), 'zh'))

  return { cities, members }
}
