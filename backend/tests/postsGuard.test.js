/**
 * 公众号文章 → 官网展示链路静态守卫（v1.13.391 / 提高官网活跃度）
 *
 * 链路：sync_posts.py 抓公开 og meta → posts.json → build_posts.py 注入三语首页卡片 + /insights/ 列表页。
 * 只做「卡片 + 跳微信原文」，第一阶段不镜像正文（版权/排版/视频失效风险）。
 *
 * 钉死的不变量（改链路前必读）：
 *   A. 数据 schema：posts.json 有 account/cadence/updated/posts，每篇含 id/title/date/url（cover 可空）。
 *   B. 构建幂等：build_posts.py 用「成对标记」START/END 包裹卡片区（⛔ 单占位符 replace 一次即消失 ⇒
 *      每周更新填不进首页），MARK_RE 必须同时含首尾标记。
 *   C. 抓取边界：sync_posts.py 只取 og meta（不抓正文）、封面转存本地破 qpic 防盗链、去重+倒序+上限。
 *   D. XSS：卡片标题/摘要必须经 html.escape（否则文章标题含 <script> 会破版）。
 *   E. 三语：三语首页都注入卡片区，列表页有备案号、canonical 指 /insights/、原文链接是 mp.weixin.qq.com。
 *   F. sitemap 含 /insights/ 且 changefreq=weekly（匹配每周三节奏）。
 *   G. nginx 落点：/insights/ 必须 ^~ + alias（否则被末尾 location / 301 弹回主域 SPA）。
 *
 * ⚠️ 正则扫源码必配切片自检：对「不得出现」的判据（如禁止抓正文）先剥注释再断言。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const exists = p => fs.existsSync(path.join(ROOT, p))

const JSON_F = 'homepage/posts.json'
const SYNC = 'homepage/sync_posts.py'
const BUILD = 'homepage/build_posts.py'
const SRC = 'homepage/_source_zh.html'
const INSIGHTS = 'homepage/insights/index.html'
const SITEMAP = 'homepage/sitemap.xml'
const NGINX_NOTE = 'homepage/build_posts.py'

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/#.*$/gm, '')
}

describe('公众号文章展示链路守卫', () => {
  it('A 组：posts.json schema 完整', () => {
    const d = JSON.parse(read(JSON_F))
    expect(d, '缺 account').toHaveProperty('account')
    expect(d, '缺 cadence').toHaveProperty('cadence')
    expect(d, '缺 updated').toHaveProperty('updated')
    expect(Array.isArray(d.posts), 'posts 必须是数组').toBe(true)
    for (const p of d.posts) {
      for (const k of ['id', 'title', 'date', 'url']) {
        expect(p, `文章缺 ${k}`).toHaveProperty(k)
      }
      expect(p.url, '原文链接必须指向微信').toMatch(/^https:\/\/mp\.weixin\.qq\.com\//)
    }
  })

  it('B 组：build_posts 用成对标记（可重复覆盖），非单占位符', () => {
    const build = stripComments(read(BUILD))
    expect(build, '缺 START 标记').toMatch(/POSTS_CARDS_START/)
    expect(build, '缺 END 标记').toMatch(/POSTS_CARDS_END/)
    expect(build, '标记必须做成含首尾的正则').toMatch(/MARK_RE/)
    // 单占位符写法（replace 一次即消失）不得复活
    expect(build, '⛔ 禁止退回单占位符 PLACEHOLDER replace').not.toMatch(/PLACEHOLDER\s*=|replace\(PLACEHOLDER/)
    // 源头也必须是成对标记
    const src = read(SRC)
    expect(src).toMatch(/<!--POSTS_CARDS_START-->/)
    expect(src).toMatch(/<!--POSTS_CARDS_END-->/)
  })

  it('C 组：sync_posts 只抓 og meta、封面转存、去重倒序有上限', () => {
    const code = stripComments(read(SYNC))
    // 只取公开 og/name meta，不解析正文（第一阶段不镜像）
    expect(code, '应抓 og:title').toMatch(/og:title/)
    expect(code, '应抓 og:description').toMatch(/og:description/)
    expect(code, '应抓 og:image').toMatch(/og:image/)
    expect(code, '封面必须下载到本地目录').toMatch(/assets["',\s]*posts|os\.path\.join\(HERE.*assets/)
    // 去重 + 上限 + 倒序
    expect(code, '应去重').toMatch(/known|seen/)
    expect(code, '应有条数上限 MAX_POSTS').toMatch(/MAX_POSTS/)
    expect(code, '应按日期倒序').toMatch(/sort\([\s\S]{0,80}reverse/)
  })

  it('D 组：卡片标题/摘要经 html.escape 防 XSS', () => {
    const build = read(BUILD)
    expect(build, '必须有 html.escape 封装').toMatch(/html\.escape|def esc/)
    // 标题与摘要插值必须走 esc()
    const cardFn = (build.match(/def card_html[\s\S]*?\ndef cards_block/) || [''])[0]
    expect(cardFn, '标题未转义').toMatch(/esc\(p\.get\(["']title/)
    expect(cardFn, '摘要未转义').toMatch(/esc\(p\.get\(["']summary/)
  })

  it('E 组：三语首页 + 列表页渲染落点齐全', () => {
    for (const p of ['homepage/index.html', 'homepage/en/index.html', 'homepage/ja/index.html']) {
      const h = read(p)
      expect(h, `${p} 缺卡片标记（构建未跑？）`).toMatch(/POSTS_CARDS_START/)
      expect(h, `${p} 缺最新动态 section`).toMatch(/id="insights"/)
    }
    expect(exists(INSIGHTS), '列表页不存在').toBe(true)
    const page = read(INSIGHTS)
    expect(page).toMatch(/<link rel="canonical" href="https:\/\/www\.mka-online\.cn\/insights\/">/)
    expect(page, '列表页缺备案号').toMatch(/沪ICP备2026010607号-1/)
    expect(page, '列表页缺返回官网').toMatch(/href="https:\/\/www\.mka-online\.cn\/"/)
    expect(page, '列表页缺免费体检入口').toMatch(/\/free-checkup/)
  })

  it('F 组：sitemap 收录 /insights/ 且 weekly', () => {
    const sm = read(SITEMAP)
    expect(sm).toMatch(/<loc>https:\/\/www\.mka-online\.cn\/insights\/<\/loc>/)
    // 🔴 先按 <url> 切块再定位：直接从首个 <url> 起非贪婪匹配会把前面几条的 weekly 吞进来 ⇒ 假绿
    const blocks = sm.match(/<url>[\s\S]*?<\/url>/g) || []
    const block = blocks.find(b => b.includes('/insights/')) || ''
    expect(block, '/insights/ 应 weekly').toMatch(/<changefreq>weekly<\/changefreq>/)
  })

  it('G 组：nginx 落点说明存在（^~ + alias，防被 301 弹回主域）', () => {
    const note = read(NGINX_NOTE)
    // 构建脚本注释里应写明 /insights/ 需要 ^~ + alias（部署检查清单）
    expect(note, '缺 /insights/ nginx 落点提醒').toMatch(/insights/)
  })
})
