// ============================================================================
// 只读可见域 visibleScope（集团/子公司 · v1.13.156）
// ----------------------------------------------------------------------------
// 解决的业务问题（用户原话，2026-09-10 设计方案 §1 场景 3）：
//   「集团公司站在全局视角需要统一分析各子公司购买的联通人口……
//     在购买履历里看到各子公司的购买履历并根据需要导出 excel 或 pdf，
//     以及在系统里做各类分析（比如相似店，门店对比等）。
//     同步到集团公司账号的联通人口**注意不能构建配额**」
//
// ★ 为什么用「读时可见域」而不是同步内核的「复制行」模型（关键决策）：
//   设计方案原案给 purchases 定的是「元数据复制 + origin_purchase_id 回源」。
//   实测后改判，理由逐条：
//     ① `purchases` **没有 city 列** ⇒ 泛化同步路径直接坏掉：
//        `syncCore.buildBusinessKeyIndex()` 会 SELECT name/store_code/brand/city/address
//        （列不存在 ⇒ SQL 报错）；`inAllowedScope()` 要求 row.city（syncCore.js:270）
//        ⇒ 恒 false ⇒ `inserted=0` 但批次仍报 `success`（静默空转）。
//        要它就得单开特例分支，泛化复用拿不到 ⇒ 「消费端零改动」的收益不成立。
//     ② `result_data` 单条可达 MB 级，sql.js 每次 `run()` 全库落盘 ⇒ 复制大字段会
//        撑爆 1.6GB 小机；而既然大字段本来就要回源，复制元数据行只剩「SQL 零改动」
//        这一个收益，却要付 5 列 + 1 索引 + 删除传播 + 只读锁扩表的代价。
//     ③ 🔴 `quota_used` 是雷：全库有 6 处 `Σ quota_used FROM purchases`（quotaPool
//        /orgs/purchase/users/ai）在算「已消耗 / 未消耗余额 / 规则 30 可转出上限」。
//        复制行一旦带上源值就会让集团侧账目虚增。不复制则结构上不可能发生。
//     ④ 复制行的三个收益在「购买履历」上全都不适用：集团**本来就不该改**成员
//        的购买凭证（不可变历史），也不需要「脱离同步」。
//
// ★ 本方案的结构性优势：写路径**一行未动**。所有写接口仍是 `WHERE user_id = req.user.id`
//   ⇒ 集团在物理上不可能改到成员的行，比 `sync_readonly=1` 这一层软锁更硬。
//
// ★ 权限边界（与 145 的提权漏洞同类，必须守住）：
//   放大范围**只对「未解散集团的 owner」**生效。
//     · 平台 admin   —— **不放大**（保持既有语义：admin 也只读自己名下数据）。
//        理由：admin 是平台运维角色，放开等于让平台能读所有客户的付费数据，
//        与「数据隐私最高优先级」冲突；需要跨组织总览时走专用只读接口（§7.9）。
//     · 集团成员     —— **不放大**（只看自己），层级模型：子公司之间互相不可见。
//     · 其它任何账号 —— 只看自己。
//   ⚠️ 成员可自行关闭「允许集团拉取」（`org_members.allow_group_pull = 0`）——
//      读 = 拉取，故必须尊重该开关（与 syncCore.checkMemberSwitch 同一语义）。
//      默认值为 1（允许），因此存量账号行为不变。
//
// ★ 本模块零业务 import：只收 db 参数，不 import database.js ⇒ 可在生产直接
//   `import('./visibleScope.js')` 自检，不会把真库读进内存（同 scopeGuard/syncCore）。
// ============================================================================

/**
 * 取「我作为 owner 的未解散集团」。解散 = 软删除立碑（`dissolved_at`），
 * 因此已解散集团天然返回 null —— 与 routes/orgs.js `findOrg` 同口径。
 * @returns {object|null}
 */
export function ownedOrg(db, userId) {
  if (!userId) return null
  return db.prepare(`
    SELECT id, name, owner_user_id FROM organizations
     WHERE owner_user_id = ? AND dissolved_at IS NULL
     ORDER BY id ASC LIMIT 1
  `).get(userId) || null
}

/**
 * 集团内「可被 owner 只读拉取」的成员行。
 *
 * 过滤三条件：
 *   · `member_role != 'owner'` —— 总部账号本身不作为成员行参与（与 serializeOrg 同口径）
 *   · `allow_group_pull != 0`  —— 成员自行关闭「允许集团拉取」后立即生效
 *   · 账号必须仍存在（users JOIN，防悬空成员）
 */
export function pullableMembers(db, orgId) {
  if (!orgId) return []
  return db.prepare(`
    SELECT m.user_id AS userId,
           COALESCE(NULLIF(TRIM(u.company), ''), u.username, '#' || m.user_id) AS name,
           u.username AS username,
           COALESCE(m.allow_group_pull, 1) AS allowGroupPull,
           COALESCE(m.can_receive, 1) AS canReceive
      FROM org_members m
      LEFT JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ? AND COALESCE(m.member_role, 'member') != 'owner'
     ORDER BY m.joined_at ASC, m.id ASC
  `).all(orgId) || []
}

/**
 * 可见域的**唯一权威入口**。
 * @returns {{ ids:number[], self:number, org:object|null, members:Array, isOrgOwner:boolean }}
 *   `ids` 恒包含自己；`members` 是集团成员明细（非 owner 时为空数组）。
 */
export function visibleScope(db, viewerUserId) {
  const self = Number(viewerUserId)
  const out = { ids: [self], self, org: null, members: [], isOrgOwner: false }
  if (!self) return out

  const org = ownedOrg(db, self)
  if (!org) return out

  const members = pullableMembers(db, org.id)
  const ids = [self]
  for (const m of members) {
    if (Number(m.userId) === self) continue
    if (Number(m.allowGroupPull ?? 1) === 0) continue   // 成员已拒绝被拉取
    ids.push(Number(m.userId))
  }
  return { ids, self, org, members, isOrgOwner: true }
}

/** 只要 id 列表（多数读端点的用法） */
export function readableUserIds(db, viewerUserId) {
  return visibleScope(db, viewerUserId).ids
}

/** 单个目标账号是否在我的可见域内（单行访问必须先用它把门） */
export function isReadableUser(db, viewerUserId, targetUserId) {
  const t = Number(targetUserId)
  if (!t) return false
  return readableUserIds(db, viewerUserId).includes(t)
}

/** 可见行标注：userId → 展示名（自己标「本账号」） */
export function selfLabel() {
  return '本账号'
}

/**
 * 为一批可见 user id 生成「来源」标注表。
 * @returns {Map<number, {userId:number, name:string, isSelf:boolean}>}
 */
export function sourceLabels(db, viewerUserId, ids) {
  const self = Number(viewerUserId)
  const map = new Map()
  const list = Array.isArray(ids) && ids.length ? ids : [self]
  const stmt = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(company), ''), username, '#' || id) AS name
      FROM users WHERE id = ?
  `)
  for (const raw of list) {
    const id = Number(raw)
    if (!id) continue
    const isSelf = id === self
    const hit = stmt.get(id)
    map.set(id, {
      userId: id,
      name: isSelf ? selfLabel() : (hit?.name || `#${id}`),
      isSelf
    })
  }
  return map
}

/** SQL 占位符便捷函数（`IN (?,?,?)`） */
export function placeholders(n) {
  return new Array(Math.max(1, n)).fill('?').join(',')
}

/**
 * 回传给前端的可见域摘要（供 UI 渲染「来源」下拉与标注）。
 * ⚠️ 只回展示名与开关，**不回配额、不回任何业务数据**。
 */
export function scopeSummary(db, viewerUserId) {
  const s = visibleScope(db, viewerUserId)
  return {
    isOrgOwner: s.isOrgOwner,
    orgName: s.org?.name || null,
    visibleCount: s.ids.length,
    sources: s.ids.map(id => {
      const hit = id === s.self
        ? { name: selfLabel() }
        : (db.prepare(`SELECT COALESCE(NULLIF(TRIM(company), ''), username, '#' || id) AS name FROM users WHERE id = ?`).get(id) || {})
      return { userId: id, name: hit.name || `#${id}`, isSelf: id === s.self }
    }),
    // 已知但被成员关闭「允许集团拉取」而**不在**可见域内的成员（UI 提示用）
    blockedByPullOff: s.members
      .filter(m => Number(m.allowGroupPull ?? 1) === 0)
      .map(m => ({ userId: m.userId, name: m.name }))
  }
}
