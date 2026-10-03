// ============================================================================
// 集团品牌图标「读时继承」（集团/子公司 · v1.13.191）
// ----------------------------------------------------------------------------
// 业务需求（用户原话，2026-10-03 16:05）：
//   「集团公司账号在『设置图标』里上传的品牌图标，子公司账号也能用
//     —— 子公司不必再在自己账号里重复上传一遍」
//
// ★ 与 brandLogo.js（v1.13.160 公司Logo 继承）**完全同构**的决策：
//   读时解析，⛔ **不**在上传时把集团图标复制进各成员行。三个结构性理由（同 brandLogo.js）：
//     ① **冻结**：集团换了图标，成员行里还是旧图 —— 除非集团每次上传都遍历成员重写一遍
//        （写成 N 次写点，撑爆 sql.js 1.6GB 小机的落盘）。读时模型下集团改一次、
//        成员**下次刷新即变**，零同步。
//     ② **脏数据**：成员一进「设置图标」就可能改写自己那行，复制进来的集团图会被
//        当成"我自己传的"，从此再也跟不上集团。
//     ③ **清不干净**：成员退出集团 / 集团解散后，复制进来的图会**留在成员行里**继续显示。
//
// ★ 组织判定**复用** brandLogo.js 的 groupLogoFor ⇒ 「谁算集团成员、谁算总部、
//   解散怎么算」两套继承**永远一致**（⛔ 勿在这里另写一份 org_members SQL）。
//   —— 这正是项目铁律「派生/解析算法必须抽成单一函数共用」的落地。
//
// ★ 优先级（2026-10-03 拍板）：**我(self) > 集团(group) > 平台 admin**
//   理由：自有图标最贴切；集团图标比平台通用图标更具体，故压过 admin。
//   ⚠️ 加继承**之前**前端存在两处口径不一致（设置图标页 `.find()` 第一条胜 /
//      地图 `forEach` 最后一条胜），且后端 `ORDER BY brand` 对同品牌并列行**未定序**
//      ⇒ 本模块同时给出 `sortByPrecedence`，把"谁生效"钉死。前端对应
//      `frontend/src/utils/brandIcons.js` 必须用同一套 rank（跨语言各一份，靠单测钉死一致）。
//
// ★ 边界（与 brandLogo.js 同一套，勿擅改）：
//   1) 总部账号自身**不参与继承**（它本就是来源；`member_role='owner'` 一并排除）
//   2) 已解散集团不继承（`dissolved_at IS NULL`）
//   3) 被移出集团 ⇒ 继承**立即消失**（读时判定，无需任何清理任务）
//   4) ⭐ **不读 `allow_group_pull`**：该开关语义是「集团能否**拉走**我的数据」（上行读权限），
//      而图标下发是集团自有资产的**下行展示**，与数据隐私无关（同 brandLogo.js 第 2 条，非漏写）
//   5) **写路径一行未动**：上传仍写自己那行（`WHERE user_id = req.user.id`），
//      删除仍只允许删自己的（`user_id !== req.user.id` ⇒ 403）⇒ 成员**删不掉**集团的图标。
//      成员若自己传了一张，就按"自有优先"生效；删掉自己的那张 ⇒ **自动回退到集团图**。
//
// ★ 纯读保证：本模块**没有任何写操作**，也不修改传入的对象。
// ============================================================================

import { groupLogoFor } from './brandLogo.js'

/** 图标来源优先级：数字越小越优先（前端 utils/brandIcons.js 必须与之相同） */
export const ICON_SOURCE_RANK = { self: 0, group: 1, admin: 2 }

/**
 * 取「我所属集团的 owner 账号 id」——即集团品牌图标的**来源账号**。
 *
 * 复用 `brandLogo.js` 的 `groupLogoFor`（含 `org_members` 归属 + `dissolved_at IS NULL`
 * + 排除 `member_role='owner'` + `ORDER BY m.id LIMIT 1`），因此两套继承口径一致。
 * 总部账号传进来会因不在 `org_members` 而返回 null（＝它不参与继承，符合边界 1）。
 *
 * @param {object} db
 * @param {number} userId
 * @returns {number|null} 无集团 / 总部自身 / 已解散 ⇒ null
 */
export function groupOwnerUserId(db, userId) {
  const g = groupLogoFor(db, userId)
  if (!g || !g.ownerUserId) return null
  return Number(g.ownerUserId)
}

/**
 * 给一行 `brand_icons` 标上来源。
 *
 * 调用前提：该行已由路由保证属于「我 / 集团 owner / admin」三者之一
 * （见 routes/brand-icons.js 的可见性 SQL），因此除前两种外一律归为 'admin'。
 *
 * @param {{user_id:number}} row
 * @param {number} userId 当前登录者
 * @param {number|null} groupOwnerId 集团来源账号（无集团 ⇒ null）
 * @returns {'self'|'group'|'admin'}
 */
export function tagIconSource(row, userId, groupOwnerId) {
  const uid = Number(row && row.user_id)
  if (uid === Number(userId)) return 'self'
  // ⚠️ 顺序不可颠倒：集团 owner 若同时是 admin，应标 'group'（对成员而言它先"是集团"）
  if (groupOwnerId && uid === Number(groupOwnerId)) return 'group'
  return 'admin'
}

/**
 * 同品牌多条并列时定序：**brand → 优先级(self<group<admin) → id 升序**。
 *
 * 为什么要定序：`brand_icons` 有 `UNIQUE(user_id, brand)` 但没有「品牌级」唯一约束，
 * 同一品牌可能同时存在「我的 + 集团的 + admin 的」三行；而 SQL 的
 * `ORDER BY brand ASC` 对并列行**顺序未定义** ⇒ 前端 `.find()` / `forEach` 会取到不同的行。
 * 定序后：列表首条即"生效的那条"，任何消费方按顺序取都对。
 *
 * @param {Array<{brand:string, source?:string, id:number}>} icons
 */
export function sortByPrecedence(icons) {
  return icons.slice().sort((a, b) => {
    if (a.brand !== b.brand) return a.brand < b.brand ? -1 : 1
    const ra = ICON_SOURCE_RANK[a.source] ?? 9
    const rb = ICON_SOURCE_RANK[b.source] ?? 9
    if (ra !== rb) return ra - rb
    return (Number(a.id) || 0) - (Number(b.id) || 0)
  })
}
