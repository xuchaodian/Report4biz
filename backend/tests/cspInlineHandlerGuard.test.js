/**
 * CSP 内联事件属性守卫（v1.13.184）
 *
 * 背景 bug：地图页「门店图标 → 弹窗」里的 7 个按钮（编辑/删除/联通人口/相似店/
 * 人口分布/竞品分布/周边检索）**点击毫无反应**，且页面无任何报错。
 *
 * 根因：主站 nginx 自 v1.13.139 起下发 CSP `script-src 'self'`
 *   （既无 'unsafe-inline'、也无 'unsafe-hashes'）。
 *   按 CSP 规范，这会拦掉**所有内联事件处理器** —— 浏览器在「给元素设置内联事件属性」
 *   这一步就拒绝编译，于是：
 *     · DOM 上 `onclick` 属性看起来还在（`hasAttribute('onclick') === true`）
 *     · 但 `el.onclick` 恒为 `null`，点击什么都不发生
 *     · 页面无报错、无提示，只有控制台一条 securitypolicyviolation ⇒ 极难排查
 *   实测（生产 mka-online.cn，同一页面、同一时刻、两个按钮对照）：
 *     addEventListener 版点一次 fired = 1
 *     innerHTML 内联版   点一次 fired = 0（且 typeof el.onclick === 'object' 即 null）
 *
 * 修法：Leaflet 动态拼的 HTML 只输出 `data-*` 属性，事件由地图容器级委托分发
 *   （MapView.vue 的 onLeafletHtmlClick；Leaflet 的 disableClickPropagation 只拦
 *    mousedown/touchstart/dblclick/contextmenu，**不拦 click** ⇒ 委托成立）。
 *   ⛔ 不要靠给 CSP 加 'unsafe-inline' 来修：那是把整站 XSS 防线拆掉换几个按钮。
 *
 * 本文件是**回归钉子**：一旦有人再往模板/模板字符串里写内联事件属性，测试立刻红。
 * （前端无独立测试框架，故与 faqMatch/orderCompare 等一致，挂在 backend 的 vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * 仓库根（backend/ 的上一级）。
 * ⚠️ 必须用 fileURLToPath 而不是 `new URL(...).pathname` —— 本项目路径含中文与空格，
 *    pathname 会留下 %E5%BE%AE… 百分号编码，导致 fs 报 ENOENT。
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FRONTEND = path.join(REPO_ROOT, 'frontend')

/** 递归收集存在的文件（目录不存在则跳过，避免因目录搬迁导致误红） */
function collect(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name.startsWith('dist.')) continue
      collect(full, exts, acc)
    } else if (exts.some((e) => ent.name.endsWith(e))) {
      acc.push(full)
    }
  }
  return acc
}

/** 全部需要纳管的源文件：SPA 源码 + 入口 HTML + 公开静态资源 + 独立营销主页 */
function scanTargets() {
  return [
    ...collect(path.join(FRONTEND, 'src'), ['.vue', '.js', '.mjs']),
    ...collect(path.join(FRONTEND, 'public'), ['.html', '.js']),
    ...collect(path.join(REPO_ROOT, 'homepage'), ['.html', '.js']),
    path.join(FRONTEND, 'index.html'),
  ].filter((f) => fs.existsSync(f))
}

/**
 * 内联事件属性。带引号的写法是绝对主流，故只认「名字 + 可选空白 + = + 引号」，
 * 以把说明性注释里出现的 `onclick` 字样排除在外（本项目注释里确有提及）。
 */
const INLINE_HANDLER_RE =
  /[\s"'`<>/]on(?:click|change|input|error|load|submit|mouseover|mouseout|mouseenter|mouseleave|focus|blur|keydown|keyup|keypress|dblclick|contextmenu|mousedown|mouseup)\s*=\s*["'`]/gi

/** javascript: 伪协议（同样被 CSP script-src 拦，且属遗留反模式） */
const JS_URL_RE = /\b(?:href|src)\s*=\s*["'`]\s*javascript:/gi

describe('CSP：模板中不得出现内联事件属性', () => {
  const targets = scanTargets()

  it('扫描范围非空（防止目录搬迁后守卫静默失效）', () => {
    expect(targets.length).toBeGreaterThan(50)
    expect(targets.some((f) => f.endsWith('MapView.vue'))).toBe(true)
  })

  it('frontend + homepage 全量源文件中内联事件属性为 0 处', () => {
    const hits = []
    for (const f of targets) {
      const src = fs.readFileSync(f, 'utf8')
      for (const line of src.split('\n')) {
        INLINE_HANDLER_RE.lastIndex = 0
        if (INLINE_HANDLER_RE.test(line)) {
          hits.push(`${path.relative(REPO_ROOT, f)}: ${line.trim().slice(0, 120)}`)
        }
      }
    }
    expect(hits, `发现内联事件属性（会被 CSP script-src 'self' 静默拦掉）：\n${hits.join('\n')}`).toEqual([])
  })

  it('没有 javascript: 伪协议链接', () => {
    const hits = []
    for (const f of targets) {
      const src = fs.readFileSync(f, 'utf8')
      JS_URL_RE.lastIndex = 0
      if (JS_URL_RE.test(src)) hits.push(path.relative(REPO_ROOT, f))
    }
    expect(hits, `发现 javascript: 链接：${hits.join(', ')}`).toEqual([])
  })
})

describe('CSP：门店弹窗必须走 data-* + 事件委托', () => {
  const mapView = fs.readFileSync(path.join(FRONTEND, 'src/views/MapView.vue'), 'utf8')

  it('MapView 已在地图容器上注册 click 委托', () => {
    expect(mapView).toMatch(/addEventListener\(\s*['"]click['"]\s*,\s*onLeafletHtmlClick\s*\)/)
    // 防重复绑定的标记位必须还在（组件二次挂载否则会双触发）
    expect(mapView).toMatch(/__r4bLeafletDelegated/)
  })

  it('门店弹窗 7 个按钮全部改走 data-store-act', () => {
    const acts = [...mapView.matchAll(/data-store-act="([a-z_-]+)"/g)].map((m) => m[1]).sort()
    expect(acts).toEqual([
      'competitors', 'delete', 'edit', 'poi', 'population', 'similar', 'smartsteps',
    ].sort())
  })

  it('委托分发器的 switch 覆盖且仅覆盖这 7 个动作', () => {
    const fnStart = mapView.indexOf('function onLeafletHtmlClick')
    expect(fnStart).toBeGreaterThan(-1)
    // 取到下一个顶层函数声明之前，避免把别处的 case 算进来
    const rest = mapView.slice(fnStart)
    const fnBody = rest.slice(0, rest.indexOf('\nfunction ', 1) === -1 ? rest.length : rest.indexOf('\nfunction ', 1))
    const cases = [...fnBody.matchAll(/case\s+'([a-z_-]+)'\s*:/g)].map((m) => m[1]).sort()
    expect(cases).toEqual([
      'competitors', 'delete', 'edit', 'poi', 'population', 'similar', 'smartsteps',
    ].sort())
  })

  it('测量结果标签的清除入口已改走 data-measure-act（原内联 onclick 会失效）', () => {
    expect(mapView).toMatch(/data-measure-act="clear"/)
    expect(mapView).toMatch(/closest\(\s*'\[data-measure-act="clear"\]'\s*\)/)
  })
})
