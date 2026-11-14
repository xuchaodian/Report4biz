/**
 * 菜单命名一致性守卫（v1.13.366 / 批次 366）
 *
 * ── 这一批改了什么 ────────────────────────────────────────────────────────
 * 顶栏有一项叫「统计数据」，指向 `/shapefiles`。但那页的四个页签是
 * 常住人口 / 高精度人口 / 城市商圈 / 城市数据，整页做的是
 * **空间数据文件的上传、分级与查询**——既不是报表，也不是城市宏观统计
 * （后者在 `/city-data` 与 AI 的 `city_stats` 工具里）。
 * 本批把显示名改成「基础数据 / Base Data / 基礎データ」，
 * 并把 i18n key 从 `nav.statistics` 改成 `nav.baseData`（key 名同样会误导后来人）。
 *
 * ── 🔴🔴 本守卫最想钉死的一条：⛔ 不要顺手改 path ─────────────────────────
 * `path: 'shapefiles'` 保持不动。理由不是懒：
 *   · 书签、收藏夹、以及用户在群里发过的 `mka-online.cn/shapefiles` 全部会 404；
 *   · nginx 侧是 SPA 兜底（`try_files ... /index.html`），旧地址不会自动 301，
 *     只能靠前端 router 的 alias 兜，而 alias 又要多维护一份映射。
 * 「命名」与「地址」是两件事：本批只改**人看的名字**与 key，不动 URL。
 * ⇒ F 组专门反向断言：`path: 'base-data'` 一旦出现就红。
 *
 * ── 第二条：三语必须同时改 ────────────────────────────────────────────────
 * 站点有中/日/英三语（`i18n/locales/*.js`）。历史上最容易犯的错是
 * 「只改 zh，en/ja 留着旧的」——界面上看不出来（默认中文），
 * 切到英文的用户却会看到旧名字，而且**没有任何报错**。
 * ⇒ D 组断言三语的 nav 键集合完全相等；G 组断言值确实是对应语言（不是复制粘贴）。
 *
 * ── 关于「注释不算代码」────────────────────────────────────────────────────
 * 本批在三个 locale 里都写了「原为 statistics / 统计数据」的溯源注释，
 * 所以所有断言都先 `stripLineComments()` 再匹配；否则注释里的旧名字
 * 会被当成「残留」误报（这正是 §6.41 那条「正则扫源码必配切片自检」的反面教材：
 * 不剥注释的守卫不是更严格，而是会把正确代码判红）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const LOCALES = ['zh', 'en', 'ja'].map((l) => ({
  lang: l,
  file: path.join(REPO_ROOT, `frontend/src/i18n/locales/${l}.js`)
}))
const ROUTER = path.join(REPO_ROOT, 'frontend/src/router/index.js')
const LAYOUT = path.join(REPO_ROOT, 'frontend/src/views/MainLayout.vue')
const SHAPEFILES_ROUTE = path.join(REPO_ROOT, 'backend/src/routes/shapefiles.js')

const read = (p) => fs.readFileSync(p, 'utf8')

/** 剥掉整行 `//` 注释（i18n 文件里值不含 `//`，整行剥离足够且不会误伤） */
function stripLineComments(src) {
  return src
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
}

/** 取某个顶层对象块（如 nav / pageTitle）的正文 */
function objectBlock(src, name) {
  const s = stripLineComments(src)
  const start = s.indexOf(`${name}: {`)
  expect(start, `找不到 ${name}: { —— 定位锚点失效`).toBeGreaterThan(-1)
  const end = s.indexOf('\n  },', start)
  expect(end, `${name} 块没有闭合 —— 定位锚点失效`).toBeGreaterThan(start)
  return s.slice(start, end)
}

/** 块内所有 4 空格缩进的键（值里的内容不会匹配，因为要求行首恰好 4 空格 + 标识符 + 冒号） */
function keysOf(block) {
  return [...block.matchAll(/^ {4}([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map((m) => m[1])
}

/** 取某个键的值（单引号字符串） */
function valueOf(block, key) {
  const m = block.match(new RegExp(`^ {4}${key}\\s*:\\s*'([^']*)'`, 'm'))
  return m ? m[1] : null
}

const localeSrc = Object.fromEntries(LOCALES.map(({ lang, file }) => [lang, read(file)]))
const navBlock = Object.fromEntries(
  Object.entries(localeSrc).map(([lang, src]) => [lang, objectBlock(src, 'nav')])
)

const EXPECTED = { zh: '基础数据', en: 'Base Data', ja: '基礎データ' }

describe('A. 三语的 baseData 词条', () => {
  for (const lang of ['zh', 'en', 'ja']) {
    it(`${lang}: nav.baseData 存在且为「${EXPECTED[lang]}」`, () => {
      expect(valueOf(navBlock[lang], 'baseData')).toBe(EXPECTED[lang])
    })
  }

  it('三语都已删除 nav.statistics（反向断言，防「只加不减」留死键）', () => {
    for (const lang of ['zh', 'en', 'ja']) {
      expect(keysOf(navBlock[lang])).not.toContain('statistics')
    }
  })
})

describe('B. 引用点全部改到 nav.baseData', () => {
  const routerSrc = read(ROUTER)
  const layoutSrc = read(LAYOUT)

  it('路由 /shapefiles 的 meta.titleKey 是 nav.baseData', () => {
    const at = routerSrc.indexOf("path: 'shapefiles'")
    expect(at, 'router 里找不到 path: shapefiles').toBeGreaterThan(-1)
    // 从 path 往后截 260 字符，覆盖到该 route 对象的 meta 行
    const chunk = routerSrc.slice(at, at + 260)
    expect(chunk).toContain("meta: { titleKey: 'nav.baseData' }")
  })

  it('router 与 MainLayout 里都不再有 nav.statistics', () => {
    expect(stripLineComments(routerSrc)).not.toContain('nav.statistics')
    expect(stripLineComments(layoutSrc)).not.toContain('nav.statistics')
  })

  it('顶栏 /shapefiles 那一项的文本用 nav.baseData', () => {
    const at = layoutSrc.indexOf('to="/shapefiles"')
    expect(at, 'MainLayout 里找不到 /shapefiles 的 router-link').toBeGreaterThan(-1)
    const chunk = layoutSrc.slice(at, layoutSrc.indexOf('</router-link>', at))
    expect(chunk).toContain("$t('nav.baseData')")
  })
})

describe('C. 全仓无 nav.statistics 残留', () => {
  it('frontend/src 与 backend/src 内不存在 nav.statistics 字符串', () => {
    const roots = [
      path.join(REPO_ROOT, 'frontend/src'),
      path.join(REPO_ROOT, 'backend/src')
    ]
    const hits = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (/\.(js|vue)$/.test(entry.name)) {
          // 同样先剥注释：本批在 router/locale 里写了溯源注释
          if (stripLineComments(read(full)).includes('nav.statistics')) hits.push(full)
        }
      }
    }
    roots.forEach(walk)
    expect(hits, `以下文件仍在用已删除的 key：\n${hits.join('\n')}`).toEqual([])
  })

  it('后端 /api/shapefiles/upload 的 403 文案不再叫「统计数据」', () => {
    const src = read(SHAPEFILES_ROUTE)
    const at = src.indexOf("return res.status(403).json({ message: '仅管理员可以上传")
    expect(at, '找不到 403 文案 —— 定位锚点失效').toBeGreaterThan(-1)
    const line = src.slice(at, src.indexOf('\n', at))
    expect(line).toContain('基础数据')
    expect(line).not.toContain('统计数据')
  })
})

describe('D. 三语 nav 键集合完全一致', () => {
  it('zh / en / ja 的 nav 键集合相等（防「只改一种语言」）', () => {
    const zh = keysOf(navBlock.zh).sort()
    const en = keysOf(navBlock.en).sort()
    const ja = keysOf(navBlock.ja).sort()
    expect(en, `en 与 zh 的 nav 键不一致：缺 ${zh.filter((k) => !en.includes(k))} / 多 ${en.filter((k) => !zh.includes(k))}`).toEqual(zh)
    expect(ja, `ja 与 zh 的 nav 键不一致：缺 ${zh.filter((k) => !ja.includes(k))} / 多 ${ja.filter((k) => !zh.includes(k))}`).toEqual(zh)
  })

  it('探测：把 baseData 从 en 删掉后，键集合断言确实会不等（自检解析器有效性）', () => {
    // 这一条不是重复断言，而是证明上面的「相等」不是因为解析器把三语都解析成空数组
    const keys = keysOf(navBlock.zh)
    expect(keys.length).toBeGreaterThan(10)
    expect(keys).toContain('baseData')
  })
})

describe('E. pageTitle 不重复定义（遵循 zh.js 里那条约定）', () => {
  it('pageTitle 块内没有 baseData / statistics', () => {
    for (const lang of ['zh', 'en', 'ja']) {
      const keys = keysOf(objectBlock(localeSrc[lang], 'pageTitle'))
      expect(keys).not.toContain('baseData')
      expect(keys).not.toContain('statistics')
    }
  })
})

describe('F. 路径未变（⛔ 改 path 会让书签与外部链接 404）', () => {
  const routerSrc = read(ROUTER)

  it("仍存在 path: 'shapefiles'", () => {
    expect(routerSrc).toContain("path: 'shapefiles'")
  })

  it("不存在 path: 'base-data'（反向断言）", () => {
    expect(routerSrc).not.toContain("path: 'base-data'")
    expect(routerSrc).not.toContain('path: "base-data"')
  })
})

describe('G. 三语的值确实是对应语言（防复制粘贴漏翻译）', () => {
  const CJK = /[\u4e00-\u9fff]/
  const KANA = /[\u3040-\u30ff]/

  it('zh 是中文且不含假名', () => {
    const v = valueOf(navBlock.zh, 'baseData')
    expect(CJK.test(v)).toBe(true)
    expect(KANA.test(v)).toBe(false)
  })

  it('ja 含假名', () => {
    expect(KANA.test(valueOf(navBlock.ja, 'baseData'))).toBe(true)
  })

  it('en 是纯 ASCII（不含中日文字符）', () => {
    const v = valueOf(navBlock.en, 'baseData')
    expect(/^[\x20-\x7e]+$/.test(v)).toBe(true)
    expect(CJK.test(v)).toBe(false)
  })
})
