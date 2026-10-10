/**
 * 品牌图标「同一品牌该用哪一条」的**唯一判定** —— v1.13.191
 *
 * 背景：加集团继承**之前**，同一品牌就可能有多条并列记录（我传的 / admin 传的），
 * 而两处消费点的取法**不一致**：
 *   · `BrandIconView.vue` 用 `.find()`  ⇒ **第一条胜**
 *   · `MapView.vue`      用 `forEach`  ⇒ **最后一条胜**
 * 且后端 `ORDER BY brand` 对并列行**未定序** ⇒「谁生效」原本是碰运气。
 *
 * 加集团继承后并列来源变成 3 个，必须先定序。本模块把判定收敛成**一处**：
 *
 *      我(self)  >  集团(group)  >  平台 admin
 *
 * 顺序理由：自有最贴切；集团图标比平台通用图标更具体，故压过 admin。
 * ⚠️ 后端 `backend/src/utils/brandIconScope.js` 的 `ICON_SOURCE_RANK` 必须是同一套顺序
 *    （跨语言各一份，靠 `backend/tests/brandIconInherit.test.js` 的 K1 用例钉死）。
 *
 * 后端 `GET /api/brand-icons` 每行回带 `source`（'self' | 'group' | 'admin'）。
 * 缺该字段时（旧后端 / 未刷新）**退回旧口径**：「我的」优先，其余一律当共享 ——
 * 这样即使只回滚了后端也不会算错。
 */

/** 来源优先级：数字越小越优先（与后端 brandIconScope.js 保持一致） */
import { getCurrentUserIdNumber } from './currentUser.js'

export const SOURCE_RANK = { self: 0, group: 1, admin: 2 }

/** 非浏览器环境（如将来做 SSR/单测）读不到 localStorage ⇒ 返回 0 */
export function currentSelfId() {
  try {
    return getCurrentUserIdNumber()
  } catch (e) {
    return 0
  }
}

/**
 * 归一「一行图标的来源」。
 * ⚠️ 这是**缺 `source` 时的唯一兜底点**，其它地方一律调它，⛔ 别各写一份判断。
 * @returns {'self'|'group'|'admin'}
 */
export function resolveSource(icon, selfId) {
  const s = icon && icon.source
  if (s && SOURCE_RANK[s] !== undefined) return s
  return Number(icon && icon.user_id) === Number(selfId) ? 'self' : 'admin'
}

/** 一行图标的优先级数字（越小越优先） */
export function iconRank(icon, selfId) {
  return SOURCE_RANK[resolveSource(icon, selfId)]
}

/** 图标文件 URL（缺 filename ⇒ 空串，调用方据此不渲染） */
export function iconUrl(icon) {
  return icon && icon.filename ? `/uploads/brand-icons/${icon.filename}` : ''
}

/**
 * 把接口返回的扁平列表收敛成 `{ 品牌: 生效的那一行 }`。
 *
 * 同品牌多条时的取舍：先比优先级，再比 `id`（大者＝最近上传）—— 保证**确定性**，
 * 而不是「碰运气看 SQL 返回顺序」。
 *
 * @param {Array} icons GET /api/brand-icons 的 icons
 * @param {number} selfId 当前登录账号 id（`currentSelfId()`）
 */
export function buildIconMap(icons, selfId) {
  const map = {}
  for (const icon of icons || []) {
    if (!icon || !icon.brand) continue
    const cur = map[icon.brand]
    if (!cur) {
      map[icon.brand] = icon
      continue
    }
    const r = iconRank(icon, selfId)
    const cr = iconRank(cur, selfId)
    if (r < cr || (r === cr && (Number(icon.id) || 0) > (Number(cur.id) || 0))) {
      map[icon.brand] = icon
    }
  }
  return map
}

/** 取某品牌的生效图标（无 ⇒ null）。已有 `byBrand` 映射时优先直接查表，别反复调它。 */
export function pickIcon(icons, brand, selfId) {
  return buildIconMap(icons, selfId)[brand] || null
}
