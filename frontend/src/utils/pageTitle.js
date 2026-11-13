/**
 * 页面标题拼装（批次 360 / v1.13.360）
 *
 * ── 为什么单独立个函数 ────────────────────────────────────────────────
 * 标题格式（`页面名 - 品牌名`）会被**守卫测试**直接断言，而 `router/index.js`
 * 引了 pinia store 与 vue-router，在 Node 里 import 会连带跑起浏览器 API
 * （`i18n/index.js` 模块顶层就读 `localStorage`）⇒ 守卫只能退化成「扫源码字符串」，
 * 而扫字符串正是本批次要防的假绿来源（`predictComp` 前缀那次教训）。
 * 抽成纯函数后守卫可以**真的调用它**，格式改动立刻被测到。
 *
 * ⚠️ 品牌名只从 `i18n/brand.js` 取：⛔ 不许在这里写第二份字面量（品牌锚点铁律）。
 * ⚠️ 这里刻意用**相对路径**而不是 `@/`：`backend/tests` 下的守卫测试直接 import 本文件，
 *    而 backend 侧没有配 `@` 别名（vitest 无配置文件）。改回 `@/` 会让守卫 import 失败。
 */
import { BRAND_NAME } from '../i18n/brand.js'

/** 兜底标题：与 `index.html` 里的站点标题一致（保持「没有页面名时」的既有行为） */
export const SITE_TITLE = `${BRAND_NAME} - WebGIS 商业智能分析平台`

/**
 * @param {string} pageName 已翻译的页面名（空串/未定义 ⇒ 用站点标题兜底）
 * @returns {string}
 */
export function formatTitle(pageName) {
  const name = String(pageName || '').trim()
  return name ? `${name} - ${BRAND_NAME}` : SITE_TITLE
}

export default formatTitle
