/**
 * 「品牌 → 业态」的**用户记忆** —— v1.13.422
 *
 * ── 为什么需要这个模块 ──────────────────────────────────────────────────────
 * 业态的第一来源是 `utils/storeBrand.js` 里的白名单 `BRAND_CATEGORY_MAP`（34 个品牌，
 * 代码常量、要发版才能加）。白名单没命中时用户要手填一句业态。
 * 问题是：立项报告弹窗**关掉就清空** `categoryInput`（避免串到下一个点位），
 * 于是同一个品牌下次开报告又得重填一遍 —— 业主 2026-11-26 就卡在这里。
 *
 * ⇒ 用户填过的业态按「品牌」记在本机，下次自动带出、可直接改。
 *   ⛔ 这**不是**往白名单里写：白名单是全局的、影响所有账号；用户填的只作用于他自己。
 *
 * ── 🔴 为什么 key 必须带 uid ────────────────────────────────────────────────
 * 198 那次串档事故的原因就是「localStorage 全局 + 按 uid 命名却手写 uid」。
 * 本模块的 key 一律 `brandCategory_<uid>`，uid 只从 `utils/currentUser.js` 取
 * （⛔ 不许写 `localStorage.getItem('userId')`，也⛔ 不许兜底成 admin）。
 * 取不到 uid（未登录 / 隐私模式）⇒ **不读也不写**，退化成"没有记忆"，
 * 宁可让用户多填一次，也不能把业态写进别人的档。
 *
 * ── 边界 ──────────────────────────────────────────────────────────────────
 * · 最多保留 `MAX_ENTRIES` 条，超出丢最早写入的（对象字符串键保持插入顺序，
 *   写入时「先删再插」⇒ 顺序＝最近使用时间）。
 * · 业态只是描述性文本，不是凭据；但本地存储可能被禁用（隐私模式）⇒ 全部 try/catch，
 *   失败就当没记住，⛔ 不许因此中断 AI 流程。
 */

import { getCurrentUserId } from './currentUser.js'

const PREFIX = 'brandCategory_'
const MAX_ENTRIES = 80
const MAX_LEN = 30

/** storage key；取不到 uid 返回空串（调用方据此跳过读写） */
function storageKey() {
  const uid = getCurrentUserId()
  return uid ? PREFIX + uid : ''
}

/**
 * 读出该用户的全部记忆（`{ 品牌: 业态 }`）。
 * 解析失败 / 非对象 ⇒ 空对象，⛔ 不抛错。
 * @returns {Record<string, string>}
 */
export function loadBrandCategories() {
  const key = storageKey()
  if (!key) return {}
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    /** @type {Record<string, string>} */
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      if (typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim()) out[k] = v
    }
    return out
  } catch (e) {
    return {}
  }
}

/**
 * 取某个品牌上次填过的业态。
 * @param {string} brand 已提取的品牌主体名（`resolveBrandCategory().brand`，
 *   ⛔ 不要传整条门店名 —— 「食其家(上海五角场店)」和「食其家」应该共用一条记忆）
 * @returns {string} 没记过返回空串
 */
export function getSavedCategory(brand) {
  const b = String(brand || '').trim()
  if (!b) return ''
  return loadBrandCategories()[b] || ''
}

/**
 * 记住某个品牌的业态（覆盖旧值，并刷新为"最近使用"）。
 * @param {string} brand
 * @param {string} category
 * @returns {boolean} 是否写入成功（存储不可用时不报错，只返回 false）
 */
export function saveCategory(brand, category) {
  const b = String(brand || '').trim()
  const c = String(category || '').trim().slice(0, MAX_LEN)
  const key = storageKey()
  if (!b || !c || !key) return false
  try {
    const m = loadBrandCategories()
    delete m[b]          // 先删再插 ⇒ 排到末尾＝最近使用
    m[b] = c
    const keys = Object.keys(m)
    while (keys.length > MAX_ENTRIES) delete m[keys.shift()]
    localStorage.setItem(key, JSON.stringify(m))
    return true
  } catch (e) {
    return false
  }
}

/**
 * 忘掉某个品牌的业态（供"我填错了"这类入口使用）。
 * ⚠️ 目前 UI 没有调用它 —— 保留是因为删记忆比改记忆更需要一个明确出口，
 *    将来加「清空业态记忆」按钮时直接用，⛔ 不要在组件里手写 localStorage.removeItem。
 */
export function forgetCategory(brand) {
  const b = String(brand || '').trim()
  const key = storageKey()
  if (!b || !key) return false
  try {
    const m = loadBrandCategories()
    if (!(b in m)) return false
    delete m[b]
    localStorage.setItem(key, JSON.stringify(m))
    return true
  } catch (e) {
    return false
  }
}
