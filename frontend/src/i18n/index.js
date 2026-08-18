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

// 切换语言（同时更新 localStorage 和 Element Plus locale）
export function setAppLocale(locale) {
  if (!SUPPORTED_LOCALES.some(l => l.key === locale)) locale = 'zh'
  i18n.global.locale.value = locale
  localStorage.setItem('app_lang', locale)
}

export function getEpLocale(locale) {
  return (SUPPORTED_LOCALES.find(l => l.key === locale) || SUPPORTED_LOCALES[0]).ep
}
