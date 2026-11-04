import { createI18n } from 'vue-i18n'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import ja from 'element-plus/es/locale/lang/ja'
import en from 'element-plus/es/locale/lang/en'
import zhMessages from './locales/zh'
import jaMessages from './locales/ja'
import enMessages from './locales/en'

// 语言持久化（默认中文）
const savedLang = localStorage.getItem('app_lang') || 'zh'

export const SUPPORTED_LOCALES = [
  { key: 'zh', label: '中文', short: '中', ep: zhCn },
  { key: 'ja', label: '日本語', short: '日', ep: ja },
  { key: 'en', label: 'English', short: 'EN', ep: en }
]

export const i18n = createI18n({
  legacy: false,           // Composition API 模式
  globalInjection: true,   // 模板里可直接用 $t
  locale: savedLang,
  fallbackLocale: 'zh',
  messages: {
    zh: zhMessages,
    ja: jaMessages,
    en: enMessages
  }
})

/**
 * 语言 → `<html lang>` 的映射（v1.13.318）
 *
 * 🔴 为什么必须同步：屏幕阅读器与浏览器断词规则都按 `<html lang>` 选语音/词典。
 *   原来切到日文只改了 vue-i18n 的 locale，`<html lang>` 仍是 `index.html` 里写死的
 *   `zh-CN` ⇒ **用中文语音朗读日文界面**（a11y 缺陷，业主 2026-11-04 指出）。
 * ⚠️ 中文必须写 `zh-CN`（带地区），日文只写 `ja`、英文只写 `en`。
 */
const HTML_LANG = { zh: 'zh-CN', ja: 'ja', en: 'en' }

/**
 * 同步 `<html lang>`。
 * ⚠️ 用 `typeof document !== 'undefined'` 而不是 `document?.` —— 后者在 Node（vitest）
 *    里仍会抛 ReferenceError，而本模块会被源码守卫直接 import。
 */
function syncHtmlLang(locale) {
  if (typeof document === 'undefined' || !document.documentElement) return
  document.documentElement.lang = HTML_LANG[locale] || 'zh-CN'
}

// 启动即同步一次：localStorage 存的是 ja 时，index.html 里写死的 zh-CN 是错的
syncHtmlLang(savedLang)

// 切换语言（同时更新 localStorage、Element Plus locale 与 <html lang>）
export function setAppLocale(locale) {
  if (!SUPPORTED_LOCALES.some(l => l.key === locale)) locale = 'zh'
  i18n.global.locale.value = locale
  localStorage.setItem('app_lang', locale)
  syncHtmlLang(locale)
}

export function getEpLocale(locale) {
  return (SUPPORTED_LOCALES.find(l => l.key === locale) || SUPPORTED_LOCALES[0]).ep
}
