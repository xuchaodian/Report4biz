/**
 * i18n 品牌锚点 / `<html lang>` / 弹窗可访问名 守卫 —— v1.13.318
 *
 * 业主 2026-11-04 提的三条（都是日文演示时会被看见的问题）：
 *   ① 日文界面产品名被机翻成「選地Winオンライン」（英文也是「SiteWin Online」）
 *      ⇒ 违反「产品锚点＝选址赢家Online」，品牌错位。
 *   ② 切到日文后 `<html lang>` 仍是 `zh-CN` ⇒ 屏幕阅读器用中文语音读日文。
 *   ③ 导出报表弹窗用 `#header` 自定义标题，EP 的 `aria-labelledby` 指向未渲染的
 *      `.el-dialog__title` ⇒ 无障碍层面等于「无标题」。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRAND_NAME } from '../../frontend/src/i18n/brand.js'
import zh from '../../frontend/src/i18n/locales/zh.js'
import ja from '../../frontend/src/i18n/locales/ja.js'
import en from '../../frontend/src/i18n/locales/en.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8')

describe('A. 品牌名在三语里都是同一锚点', () => {
  it('BRAND_NAME 就是产品锚点', () => {
    expect(BRAND_NAME).toBe('选址赢家Online')
  })

  it('三语 login.title 完全等于 BRAND_NAME', () => {
    expect(zh.login.title).toBe(BRAND_NAME)
    expect(ja.login.title).toBe(BRAND_NAME)
    expect(en.login.title).toBe(BRAND_NAME)
  })

  it('🔴 语言包里不得再出现机翻译名', () => {
    for (const [name, src] of [
      ['zh', read('frontend/src/i18n/locales/zh.js')],
      ['ja', read('frontend/src/i18n/locales/ja.js')],
      ['en', read('frontend/src/i18n/locales/en.js')]
    ]) {
      expect(src.includes('選地'), `${name} 语言包里还有「選地」`).toBe(false)
      expect(src.includes('SiteWin'), `${name} 语言包里还有「SiteWin」`).toBe(false)
      expect(src.includes('オンライン'), `${name} 语言包里还有「オンライン」`).toBe(false)
    }
  })

  it('三语都引用常量（⛔ 不各自写字符串）', () => {
    for (const f of ['zh', 'ja', 'en']) {
      const src = read(`frontend/src/i18n/locales/${f}.js`)
      expect(src).toContain("import { BRAND_NAME } from '../brand.js'")
      expect(src).toContain('title: BRAND_NAME')
    }
  })
})

describe('B. 切语言时同步 <html lang>', () => {
  const indexSrc = read('frontend/src/i18n/index.js')

  it('有语言 → lang 的映射（中文必须带地区）', () => {
    expect(indexSrc).toContain("const HTML_LANG = { zh: 'zh-CN', ja: 'ja', en: 'en' }")
  })

  it('🔴 setAppLocale 里必须调用 syncHtmlLang', () => {
    const m = indexSrc.match(/export function setAppLocale[\s\S]{0,400}?\n\}/)
    expect(m, '找不到 setAppLocale').toBeTruthy()
    expect(m[0], 'setAppLocale 没同步 <html lang> —— 切日文后仍是 zh-CN').toContain('syncHtmlLang(locale)')
  })

  it('启动时也同步一次（localStorage 存 ja，index.html 写死 zh-CN）', () => {
    expect(indexSrc).toContain('syncHtmlLang(savedLang)')
  })

  it('⚠️ 用 typeof document 判空（`document?.` 在 Node 里仍会 ReferenceError）', () => {
    expect(indexSrc).toContain("typeof document === 'undefined'")
    expect(/document\?\.documentElement/.test(indexSrc)).toBe(false)
  })

  it('index.html 的初始值仍是 zh-CN（默认中文，运行时再按 savedLang 纠正）', () => {
    expect(read('frontend/index.html')).toMatch(/<html[^>]*lang="zh-CN"/)
  })
})

describe('C. 导出报表弹窗要有可访问名', () => {
  const layout = read('frontend/src/views/MainLayout.vue')
  const tag = (layout.match(/<el-dialog v-model="exportDialogVisible"[^>]*>/) || [''])[0]

  it('带 title（EP 用它生成外层 role=dialog 的 aria-label）', () => {
    expect(tag, '找不到导出报表弹窗').toBeTruthy()
    expect(
      tag,
      '导出弹窗没有 title ⇒ 外层 .el-overlay-dialog 没有可访问名，屏幕阅读器只会念「对话框」'
    ).toContain('title="导出报表"')
  })

  it('🔴 不要用 aria-label 代替 title —— 它会落到内层 .el-dialog，而 role=dialog 在外层', () => {
    expect(
      tag.includes('aria-label'),
      'aria-label 加在 el-dialog 上无效（实测落到内层 .el-dialog）；正确的是传 title'
    ).toBe(false)
  })

  it('视觉标题仍在（自定义 header 未被删掉）', () => {
    expect(layout).toContain('<span class="dlg-title">')
  })
})
