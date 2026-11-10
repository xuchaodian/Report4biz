// ============================================================================
// 「我所属的集团」唯一判定 groupScope（v1.13.351）
// ----------------------------------------------------------------------------
// 为什么单独抽一个模块：
//   集团资产「读时继承」的范式在系统里已有两处 ——
//     · v1.13.156 `visibleScope.js`   集团读子公司数据
//     · v1.13.160 `brandLogo.js`      子公司继承集团品牌 Logo
//     · v1.13.351 `competitorScope.js` 子公司继承集团「品牌→竞品」映射
//   三处都要回答同一个问题：**这个账号属于哪一家未解散的集团、总部是谁**。
//   若各写一份 SQL，`member_role != 'owner'` / `dissolved_at IS NULL` /
//   「总部账号不进 org_members」这三条口径迟早漂移（本项目已因此吃过多次亏）。
//   故把它收成一份实现，`brandLogo.js` 也改为调用本模块。
//
// 三条硬口径（与 routes/orgs.js / visibleScope.js 同源，勿擅改）：
//   ① 只认 `dissolved_at IS NULL`：解散 = 软删除立碑，立碑后集团关系一起失效。
//   ② `member_role = 'owner'` 的成员行**不算成员**：总部账号本身就是资产源，
//      让它继承自己等于自指。
//   ③ 总部账号**刻意不写 org_members**（见 routes/orgs.js 文件头：写入会让
//      isOrgMember 误判成子公司，触发 quota-exhausted 假阳性）⇒ 总部调用本函数
//      天然返回 null，无需额外判断。
//   ④ 一个账号只能属于一个集团（`org_members.user_id` UNIQUE），故 LIMIT 1 安全。
//
// ⚠️ 本模块零业务 import（只收 db 参数），可在生产直接 `import()` 自检。
// ⚠️ 纯读：没有任何写操作。
// ============================================================================

/**
 * 取「我作为成员所属的未解散集团」。
 *
 * @param {object} db
 * @param {number} userId 任一账号 id（总部账号会因不在 org_members 而返回 null）
 * @returns {{orgId:number, orgName:string, ownerUserId:number, ownerName:string}|null}
 *          null = 不属于任何有效集团（散客 / 总部 / 已被移出 / 集团已解散）
 */
export function memberOrgOf(db, userId) {
  const uid = Number(userId)
  if (!uid) return null

  const row = db.prepare(`
    SELECT o.id                                                                  AS orgId,
           o.name                                                                AS orgName,
           o.owner_user_id                                                       AS ownerUserId,
           COALESCE(NULLIF(TRIM(u.company), ''), u.username, '#' || o.owner_user_id) AS ownerName
      FROM org_members m
      JOIN organizations o ON o.id = m.org_id AND o.dissolved_at IS NULL
      LEFT JOIN users u    ON u.id = o.owner_user_id
     WHERE m.user_id = ?
       AND COALESCE(m.member_role, 'member') != 'owner'
     ORDER BY m.id ASC
     LIMIT 1
  `).get(uid) || null

  if (!row) return null
  // 防御：脏数据里可能出现「owner 自己也被写成普通成员」的情况，此时不继承自己
  if (Number(row.ownerUserId) === uid) return null
  return {
    orgId: Number(row.orgId),
    orgName: row.orgName || null,
    ownerUserId: Number(row.ownerUserId),
    ownerName: row.ownerName || null
  }
}

/** 展示名：优先集团名（用户在界面上认的是「泉膳中国」，不是总部公司全称） */
export function groupDisplayName(g) {
  if (!g) return null
  return g.orgName || g.ownerName || null
}
