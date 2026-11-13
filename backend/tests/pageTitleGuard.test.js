/**
 * 批次 360（v1.13.360）守卫：标签页标题（document.title）
 *
 * 为什么要有这份守卫：
 *   ① 标题是「20+ 个页面共用一套格式」的东西，靠人肉 each-page 写 document.title
 *      必然漏几页；漏了不会报错、只会让标签页停在上一个页面名字，极难发现。
 *   ② titleKey 写错一个字母（`pageTitle.notFound` → `pageTitle.notfound`）时
 *      vue-i18n **不会报错**，只会把键名原样当文案显示 —— 标签页变成
 *      「pageTitle.notfound - 选址赢家Online」。所以必须逐键在三语里验存在。
 *   ③ 最容易的假绿是「applyTitle 写了但排在 `!from.name` 提前 return 之后」：
 *      一切导航都能测通，唯独**首屏**（直接输 URL / 刷新 / 从收藏夹进）永远没标题。
 *      而这恰恰是收藏夹场景的全部价值。故单独钉死调用顺序。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { formatTitle, SITE_TITLE } from '../../frontend/src/utils/pageTitle.js'
import { BRAND_NAME } from '../../frontend/src/i18n/brand.js'
import zh from '../../frontend/src/i18n/locales/zh.js'
import ja from '../../frontend/src/i18n/locales/ja.js'
import en from '../../frontend/src/i18n/locales/en.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND_SRC = join(HERE, '../../frontend/src')

/**
 * 剥注释（⛔ 不能用裸 `/\*[\s\S]*?\*\//`：字符串里出现 `/*` 会吞掉大段代码并报假红）
 * 做法：先按行去掉 `//` 行注释（只认行首空白后的 `//` 或行内 ` //`），再剥块注释。
 */
function stripComments(src) {
  return src
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

const routerRaw = readFileSync(join(FRONTEND_SRC, 'router/index.js'), 'utf8')
const routerSrc = stripComments(routerRaw)

describe('① 路由表：每条路由都必须有 meta.titleKey', () => {
  it('自检：剥注释后源码仍然完整（防「剥注释把代码吃掉」造成假绿）', () => {
    expect(routerSrc.length).toBeGreaterThan(routerRaw.length * 0.5)
    expect(routerSrc).toContain('createRouter')
    expect(routerSrc).toContain("path: '/login'")
    expect(routerSrc).toContain("name: 'NotFound'")
  })

  it('① `name:` 数量与 `titleKey:` 数量一致（每条具名路由都挂了标题键）', () => {
    const names = routerSrc.match(/\bname: '/g) || []
    const keys = routerSrc.match(/\btitleKey:/g) || []
    expect(names.length).toBeGreaterThanOrEqual(24) // 现状 25 条；防有人把整块路由删了还绿
    expect(keys.length).toBe(names.length)
  })

  it('② 404 路由也有标题（软 404 页最容易漏）', () => {
    const notFound = routerSrc.slice(routerSrc.indexOf("name: 'NotFound'"))
    expect(notFound).toMatch(/titleKey:\s*'pageTitle\.notFound'/)
  })

  it('③ ⛔ 不许在 meta 里写中文定值（三语站点写死中文 ⇒ 日文/英文界面标题仍是中文）', () => {
    expect(routerSrc).not.toMatch(/meta:\s*\{[^}]*\btitle:\s*['"]/)
    // 反证：真正的写法是 titleKey，不是 title
    expect(routerSrc).toMatch(/titleKey:\s*'[a-zA-Z.]+'/)
  })
})

describe('② 三语词条：每个 titleKey 都必须能在中文/日文/英文里解析出文案', () => {
  const keys = [...new Set(
    (routerSrc.match(/titleKey:\s*'([^']+)'/g) || []).map(m => m.replace(/titleKey:\s*'/, '').replace(/'$/, ''))
  )]

  const resolve = (messages, path) =>
    path.split('.').reduce((acc, seg) => (acc && typeof acc === 'object' ? acc[seg] : undefined), messages)

  it('② 至少提取到 24 个键（提取逻辑本身要有效，否则下面三条会空跑变假绿）', () => {
    expect(keys.length).toBeGreaterThanOrEqual(24)
    expect(keys).toContain('pageTitle.notFound')
    expect(keys).toContain('nav.map')
  })

  for (const [lang, messages] of [['zh', zh], ['ja', ja], ['en', en]]) {
    it(`② ${lang} 语言包里每个键都有非空文案`, () => {
      const missing = keys.filter(k => {
        const v = resolve(messages, k)
        return typeof v !== 'string' || v.trim() === ''
      })
      expect(missing, `${lang} 缺失词条：${missing.join(', ')}`).toEqual([])
    })
  }

  it('② 键名不许自己变成文案（vue-i18n 解析失败时会把键名原样输出）', () => {
    for (const k of keys) {
      const v = resolve(zh, k)
      expect(v).not.toBe(k)
      expect(v).not.toContain('pageTitle.')
      expect(v).not.toContain('nav.')
    }
  })
})

describe('③ 写入时机：首屏也必须生效', () => {
  it('③ applyTitle(to) 必须排在 `if (!from.name) return` **之前**', () => {
    // 🔴 必须用「行首缩进 + 行尾」锚定**调用语句**，不能用 indexOf('applyTitle(to)')：
    //   函数定义那行 `function applyTitle(to) {` 里也含 `applyTitle(to)` 这个子串，
    //   于是 indexOf 永远返回函数定义的位置（永远在最前面）⇒ 顺序断言恒真、变异逃逸。
    //   这是本仓的老毛病（`predictComp` 是 `predictCompWan` 的前缀那次同源）。
    const callIdx = routerSrc.search(/^[ \t]+applyTitle\(to\)[ \t]*$/m)
    const earlyReturnIdx = routerSrc.search(/if \(!from\.name\) return/)
    expect(callIdx, 'afterEach 里没有调用 applyTitle(to)').toBeGreaterThan(-1)
    expect(earlyReturnIdx).toBeGreaterThan(-1)
    expect(callIdx, 'applyTitle 排在了 `!from.name` 提前 return 之后 ⇒ 首屏永远没有标题')
      .toBeLessThan(earlyReturnIdx)
  })

  it('③ 切语言时同步刷新标题（watch locale）', () => {
    expect(routerSrc).toMatch(/watch\(\s*\(\)\s*=>\s*i18n\.global\.locale\.value/)
    expect(routerSrc).toMatch(/applyTitle\(router\.currentRoute\.value\)/)
  })

  it('③ 标题格式只能有一处定义：views 里不许自己写 document.title', () => {
    const viewsDir = join(FRONTEND_SRC, 'views')
    const offenders = readdirSync(viewsDir)
      .filter(f => f.endsWith('.vue'))
      .filter(f => stripComments(readFileSync(join(viewsDir, f), 'utf8')).includes('document.title'))
    expect(offenders, `这些页面在自行改标题：${offenders.join(', ')}`).toEqual([])
  })
})

describe('④ formatTitle 纯函数（格式真的被测到，而不是扫字符串）', () => {
  it('④ 有页面名 ⇒ `页面名 - 品牌名`', () => {
    expect(formatTitle('我的门店')).toBe('我的门店 - 选址赢家Online')
  })

  it('④ 无页面名 ⇒ 站点标题兜底（改造前 index.html 的原值，不是空白）', () => {
    expect(formatTitle('')).toBe(SITE_TITLE)
    expect(formatTitle(undefined)).toBe(SITE_TITLE)
    expect(formatTitle(null)).toBe(SITE_TITLE)
    expect(SITE_TITLE).toBe('选址赢家Online - WebGIS 商业智能分析平台')
  })

  it('④ 前后空白要裁掉（词条里多打一个空格不该出现在标签页）', () => {
    expect(formatTitle('  地图  ')).toBe('地图 - 选址赢家Online')
  })

  it('④ 品牌名只从 i18n/brand.js 取，不许第二份字面量', () => {
    const src = readFileSync(join(FRONTEND_SRC, 'utils/pageTitle.js'), 'utf8')
    expect(src).toContain("from '../i18n/brand.js'")
    // ⛔ 除了那一处 import，文件里不应再出现品牌名硬编码
    expect(src.includes(`'${BRAND_NAME}'`)).toBe(false)
    expect(SITE_TITLE.startsWith(BRAND_NAME)).toBe(true)
  })
})
