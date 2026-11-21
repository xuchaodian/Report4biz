/**
 * 开关店分析看板 → 官网展示链路静态守卫（v1.13.394 / 市场大盘数据看板）
 *
 * 链路：switch_data.json（用户提供的 demo 数据，品牌级聚合统计）→ build_switch.py
 *       → 三语独立页 /switch-analysis/index.html。
 *
 * 钉死的不变量（改链路前必读）：
 *   A. 数据 schema：switch_data.json 有 meta/timeline/brands/city_top，品牌/城市数 > 0，6 期。
 *   B. 来源隐去（业主 2026-11-21 拍板）：三语页面⛔不得出现「大众点评/点评ID/点评」。
 *   C. 本地 echarts：⛔ jsdelivr/CDN，必须 /assets/echarts.min.js（境内不稳+隐私）。
 *   D. 三语落点：三语都生成独立页，UI 文案三语、品牌/城市名保留中文原文。
 *   E. 数据内嵌：const DATA 内嵌、五图表节点在、备案号在。
 *   F. 转化 CTA：页尾 chains → 免费体检页（主域，免登录）。
 *   G. 首页入口：_source_zh.html 有 section + 页脚链接，sitemap 有 /switch-analysis/ monthly。
 *   H. nginx 落点提醒：build_switch.py 必须写明 ^~ + alias（否则被末尾 location / 301 弹回主域）。
 *
 * ⚠️ 正则扫源码必配切片自检：对「不得出现」的判据先剥注释再断言（注释里出现来源字样是正常的）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')
const exists = p => fs.existsSync(path.join(ROOT, p))

const DATA = 'homepage/switch_data.json'
const BUILD = 'homepage/build_switch.py'
const SRC = 'homepage/_source_zh.html'
const SITEMAP = 'homepage/sitemap.xml'
const PAGES = {
  zh: 'homepage/switch-analysis/index.html',
  en: 'homepage/en/switch-analysis/index.html',
  ja: 'homepage/ja/switch-analysis/index.html',
}

// 剥 HTML 注释 + JS/CSS 注释，避免注释里的来源字样造成假红
function stripComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('开关店分析看板守卫', () => {
  it('A 组：数据 schema 完整（meta/timeline/brands/city_top）', () => {
    const d = JSON.parse(read(DATA))
    expect(d).toHaveProperty('meta.periods')
    expect(d).toHaveProperty('timeline')
    expect(d).toHaveProperty('brands')
    expect(d).toHaveProperty('city_top')
    expect(d.meta.periods.length).toBe(6)
    expect(d.brands.length).toBeGreaterThan(100)
    expect(d.city_top.length).toBeGreaterThan(0)
    // 每期字段完整
    for (const t of d.timeline) {
      for (const k of ['period', 'total', 'new', 'closed', 'net']) {
        expect(t).toHaveProperty(k)
      }
    }
  })

  it('B 组：来源隐去（业主拍板，三语页面可见文本不得出现点评字样）', () => {
    for (const [lang, p] of Object.entries(PAGES)) {
      const visible = stripComments(read(p)) + read(p.replace('index.html', 'switch.js'))
      for (const kw of ['大众点评', '点评ID', '点评']) {
        expect(visible, `${lang} 页面与脚本不应出现「${kw}」`).not.toContain(kw)
      }
      // 中性口径在（说明数据来源但不点名）
      expect(visible, `${lang} 应有中性口径说明`).toMatch(/快照|snapshot|スナップショット/)
    }
  })

  it('C 组：本地 echarts + 主脚本外置（CSP script-src self ⛔ 内联 script 会被静默拦掉）', () => {
    const build = stripComments(read(BUILD))
    expect(build).toContain('/assets/echarts.min.js')
    for (const [lang, p] of Object.entries(PAGES)) {
      const h = read(p)
      expect(h, `${lang} 必须引用本地 echarts`).toContain('/assets/echarts.min.js')
      expect(h, `${lang} 禁 CDN jsdelivr`).not.toContain('jsdelivr')
      expect(h, `${lang} 禁 CDN cdn.`).not.toContain('cdn.')
      // 🔴 主脚本必须外置：CSP script-src 'self' 下内联 <script> 整段被拒 ⇒ 图表/KPI/表格全失效
      expect(h, `${lang} 主脚本应外链 switch.js`).toContain('src="./switch.js"')
      expect(h, `${lang} 禁内联 const DATA`).not.toContain('const DATA = {')
      const jsPath = p.replace('index.html', 'switch.js')
      expect(exists(jsPath), `${lang} switch.js 应存在`).toBe(true)
      const js = read(jsPath)
      expect(js, `${lang} JS 应含数据`).toContain('const DATA = {')
      expect(js, `${lang} JS 应含事件委托`).toContain("addEventListener('click'")
    }
  })

  it('D 组：三语落点齐全，品牌/城市名保留中文原文', () => {
    for (const p of Object.values(PAGES)) expect(exists(p), p).toBe(true)
    const zh = read(PAGES.zh), en = read(PAGES.en), ja = read(PAGES.ja)
    // 品牌名三语都在（数据不翻译，数据在外置 JS 里）
    for (const p of Object.values(PAGES)) expect(read(p.replace('index.html', 'switch.js'))).toContain('蜜雪冰城')
    // UI 三语差异（各语言有自己的 h1）
    expect(zh).toMatch(/<h1>连锁品牌开关店分析/)
    expect(en).toMatch(/<h1>Chain Brand Store Openings/)
    expect(ja).toMatch(/<h1>チェーンブランド/)
    // 三语 lang 属性
    expect(zh).toContain('<html lang="zh-CN">')
    expect(en).toContain('<html lang="en">')
    expect(ja).toContain('<html lang="ja">')
  })

  it('E 组：数据在 JS + 五图表节点 + 备案号 + 官网主色', () => {
    for (const [lang, p] of Object.entries(PAGES)) {
      const h = read(p)
      const js = read(p.replace('index.html', 'switch.js'))
      expect(js, `${lang} 数据应在外置 JS`).toContain('const DATA = {')
      expect(js, `${lang} JS 应含品牌数据`).toContain('蜜雪冰城')
      for (const id of ['trendChart', 'flowChart', 'totalChart', 'rankChart', 'cityChart']) {
        expect(h, `${lang} 缺图表 ${id}`).toContain(id)
      }
      expect(h, `${lang} 缺备案号`).toContain('沪ICP备2026010607号-1')
      expect(h, `${lang} 主色应统一官网蓝`).toContain('--brand:#1e6fff')
      expect(h, `${lang} 禁旧 demo 紫`).not.toContain('#534AB7')
    }
  })

  it('F 组：页尾转化 CTA → 免费体检（主域免登录）', () => {
    for (const [lang, p] of Object.entries(PAGES)) {
      const h = read(p)
      expect(h, `${lang} 应有免费体检链接`).toContain('mka-online.cn/free-checkup')
      // CTA 按钮存在（中/英/日任一）
      expect(h, `${lang} 应有 CTA 区`).toMatch(/class="cta"/)
    }
  })

  it('G 组：首页入口 section + 页脚链接 + sitemap monthly', () => {
    const src = stripComments(read(SRC))
    expect(src, '首页缺看板入口 section').toContain('id="switch-analysis"')
    expect(src, '首页缺看板入口链接').toContain('href="/switch-analysis/"')
    const sm = read(SITEMAP)
    // 先切块再定位（⛔ 从首个 <url> 贪吃会吞入前面条目的 monthly 造成假绿）
    const blocks = sm.match(/<url>[\s\S]*?<\/url>/g) || []
    const blk = blocks.find(b => b.includes('/switch-analysis/')) || ''
    expect(blk, 'sitemap 缺 /switch-analysis/').toContain('/switch-analysis/')
    expect(blk, '/switch-analysis/ 应 monthly').toMatch(/<changefreq>monthly<\/changefreq>/)
  })

  it('H 组：构建脚本写明 nginx ^~ + alias 提醒', () => {
    const build = stripComments(read(BUILD))
    expect(build, '应提醒 nginx 用 ^~ + alias').toMatch(/\^~[\s\S]{0,80}alias|alias[\s\S]{0,80}\^~/)
  })
})
