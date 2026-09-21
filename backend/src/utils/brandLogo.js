// ============================================================================
// 集团品牌 Logo 读时继承（集团/子公司 · v1.13.160）
// ----------------------------------------------------------------------------
// 业务需求（用户原话，2026-09-21）：
//   「集团公司账号在个人-设置图标里上传的品牌logo对子公司账号也可见
//     （子公司无需再重复上传品牌logo）」
//
// ★ 为什么用「读时解析」而不是「上传时把 logo 复制进各子公司行」（关键决策）：
//   两个模型都能满足需求，但复制模型有三个结构性坏处：
//     ① **冻结**：集团换了品牌 Logo，子公司行里存的还是旧图 —— 除非集团每次上传
//        都遍历组织成员重写一遍（写成 N 次写点，撑爆 sql.js 1.6GB 小机的落盘）。
//        读时模型下，集团改一次、子公司**下次刷新即变**，零同步。
//     ② **脏数据**：`users.logo` 会被前端「我的账户」当成"我自己传的 logo"，
//        子公司一点保存就把继承来的图**写进自己那行**，从此再也跟不上集团。
//     ③ **清不干净**：子公司退出集团 / 集团解散后，复制进来的图会**留在成员行里**
//        继续显示 —— 等于品牌资产脱离了集团关系还赖着不走。
//   本项目已有同构先例：v1.13.156 的「读时可见域」visibleScope.js 用同一思路
//   解决集团读子公司数据，同样做到**零 DDL、零复制、写路径一行未动**。
//
// ★ 数据来源为什么是「总部账号的 users.logo」而不是给 organizations 加列：
//   `organizations` 没有 logo 列，且总部账号**刻意不写 org_members**
//   （见 routes/orgs.js 文件头：写入会让 isOrgMember 误判成"子公司"，触发
//     quota-exhausted 假阳性）。因此集团品牌 Logo 的自然归属就是
//   `organizations.owner_user_id` 指向的那个账号 —— 集团总部本人在「个人-设置」
//   里传的那张图，也正是用户口中的「集团公司账号上传的品牌logo」。
//   据此**不需要任何 DDL**：不新增表、不新增列、不做迁移。
//
// ★ 已拍板的边界（2026-09-21，勿擅改）：
//   1) **自有优先**：子公司自己传过 logo 就用它自己的，集团只补空缺。
//      理由：不覆盖任何存量数据（现网 zensho_sh_01 已有自有 Logo，须保持原样）。
//   2) **`allow_group_pull` 不影响继承**：该开关的语义是「集团能否**拉取**本账号的
//      数据」（上行读权限），而品牌 Logo 是集团自有资产的**下行展示**，与数据隐私
//      无关。故本模块**刻意不读** `org_members.allow_group_pull` —— 不是漏写。
//   3) 总部账号自身**不参与继承**（它本来就是品牌源）；`member_role='owner'` 的成员行
//      一并排除，与 visibleScope/orgs.js 同口径。
//   4) 已解散集团不继承（`dissolved_at IS NULL`，与 `ownedOrg`/`findOrg` 同口径）。
//
// ★ 本模块**不 import 任何模块**（只收 db 参数），因此可在生产直接 `import()` 自检，
//   不会把真库读进内存（同 visibleScope / scopeGuard / syncCore 的做法）。
//
// ★ 纯读保证：本模块**没有任何写操作**，也不修改传入的 user 对象。
// ============================================================================

/** 归一：空白字符串等同「没传」，统一收敛为 null */
const normLogo = (v) => (v && String(v).trim() ? v : null)

/**
 * 取「我所属的未解散集团」及其品牌 Logo 来源。
 *
 * @param {object} db
 * @param {number} userId 任一账号 id（总部传进来会因不在 org_members 而返回 null）
 * @returns {{orgId:number, orgName:string, ownerUserId:number, ownerName:string, logo:string|null}|null}
 *          `logo` 为 null = 集团存在但还没上传品牌 Logo（调用方据此决定是否继承）
 */
export function groupLogoFor(db, userId) {
  const uid = Number(userId)
  if (!uid) return null

  const row = db.prepare(`
    SELECT o.id                                                            AS orgId,
           o.name                                                          AS orgName,
           o.owner_user_id                                                 AS ownerUserId,
           u.logo                                                          AS logo,
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
  return { ...row, logo: normLogo(row.logo) }
}

/**
 * ★ 核心：解析「某账号实际应展示的品牌 Logo」。
 *
 *   自有 logo 非空   → 用自有的（source = 'self'）
 *   自有为空 + 集团有 → 用集团的（source = 'group'，并回带集团名供 UI 提示）
 *   都没有           → null（前端维持「无 Logo」，与历史行为一致）
 *
 * ⚠️ 返回的是**新增字段**，**不覆盖** `user.logo`：
 *   `user.logo` 必须保持「本人上传的 logo」这一原义 —— 前端「我的账户」用它做
 *   「有没有改动」的比对基准，一旦被替换成继承值，子公司保存任何字段都会把集团
 *   的图复制进自己那行（见文件头 ② 脏数据）。
 *
 * @returns {{logo_effective:string|null, logo_source:'self'|'group'|null, logo_group_name:string|null}}
 */
export function resolveLogo(db, user) {
  const own = normLogo(user?.logo)
  if (own) {
    return { logo_effective: own, logo_source: 'self', logo_group_name: null }
  }

  const group = groupLogoFor(db, user?.id)
  if (group && group.logo) {
    return {
      logo_effective: group.logo,
      logo_source: 'group',
      // 提示语用「集团名」而非总部公司全称：用户在界面上认的是集团（如「泉膳中国」）
      logo_group_name: group.orgName || group.ownerName || null
    }
  }

  return { logo_effective: null, logo_source: null, logo_group_name: null }
}

/**
 * 把解析结果挂到用户对象上（**返回新对象，不改原对象**）。
 * 用于所有「把当前登录用户回给前端」的接口，保证三处口径完全一致。
 */
export function withResolvedLogo(db, user) {
  if (!user) return user
  return { ...user, ...resolveLogo(db, user) }
}
