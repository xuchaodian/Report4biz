/**
 * 免登录「同品牌蚕食免费体检」静态守卫（v1.13.378 / 获客 P0）
 *
 * 这一批新增了官网入口 → 免登录页 `/free-checkup` → 地图点选 → 纯前端算贴邻。
 * 守卫钉死五条不变量，防止后续改动把获客钩子的边界踩穿：
 *
 *   A. 路由必须免登录（requiresAuth:false）——否则官网点进来直接弹登录页，钩子失效。
 *   B. 页面必须纯前端：⛔ 不 import axios / 不调 /api —— 一旦调后端就有成本与隐私风险。
 *   C. ⛔ 不得在本页判「双店型 / 合并 / 重复」——点选只有坐标没面积编码，判了就是误报，
 *      会把客户的真实双店型门店误标成蚕食（项目铁律：≤50m 同品牌≠重复）。
 *   D. 几何分档常量必须与后端 storeCheckup.js 完全一致（50/300/800/2000），防口径漂移。
 *   E. 官网三语入口都在，且指向绝对地址主域 /free-checkup。
 *
 * ⚠️ 正则扫源码必配切片自检（§6.41）：本守卫只断言「必须出现的正向结构」，
 *    对「不得出现」的判据（B/C）先剥注释再匹配，且给出命中片段，避免假绿。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

const ROUTER = 'frontend/src/router/index.js'
const VIEW = 'frontend/src/views/FreeCheckupView.vue'
const GEO = 'frontend/src/utils/freeCheckupGeo.js'
const BE_GEO = 'backend/src/utils/storeCheckup.js'
const HP_ZH = 'homepage/index.html'
const HP_EN = 'homepage/en/index.html'
const HP_JA = 'homepage/ja/index.html'
const LOCALES = ['zh', 'en', 'ja'].map(l => `frontend/src/i18n/locales/${l}.js`)

/** 剥掉 // 行注释与 /* *\/ 块注释，避免注释里的字样触发误判 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('免费体检页 · 免登录与纯前端边界', () => {
  const router = read(ROUTER)
  const view = stripComments(read(VIEW))

  it('A 组：/free-checkup 路由存在且明确免登录', () => {
    // 🔴 必须先精确定位 path 再双向截块：用 /\{\s*\/\/[\s\S]*?path/ 会从文件里
    //    第一个注释块贪吃到目标，把前几条路由都吞进来 ⇒ 任何一条 requiresAuth:false
    //    都能让它假绿（§6.42 正则扫源码假绿灯同款坑）。
    const at = router.indexOf("path: '/free-checkup'")
    expect(at, '找不到 /free-checkup 路由').toBeGreaterThan(-1)
    const open = router.lastIndexOf('{', at)
    const close = router.indexOf('\n  }', at)
    expect(close, '路由块未闭合').toBeGreaterThan(open)
    const block = router.slice(open, close)
    expect(block).toMatch(/requiresAuth:\s*false/)
    expect(block).toMatch(/FreeCheckupView\.vue/)
    expect(block).not.toMatch(/requiresAuth:\s*true/)
  })

  it('B 组：页面不调后端、不 import axios、不出现 /api/', () => {
    expect(view, '⛔ 免费页不得 import axios').not.toMatch(/import\s+axios/)
    expect(view, '⛔ 免费页不得出现 /api/ 接口调用').not.toMatch(/\/api\//)
    expect(view, '⛔ 免费页不得用 fetch').not.toMatch(/\bfetch\s*\(/)
    // 页面只应从本地几何工具取数
    expect(view).toMatch(/from\s+['"]@\/utils\/freeCheckupGeo\.js['"]/)
  })

  it('C 组：⛔ 不得在本页判定双店型/合并/重复', () => {
    // 只禁「代码层判定标志」——「双店型」作为引导注册的名词是正确文案（见下），不能误杀。
    const forbidden = ['dualFormat', 'findStoreDuplicates', 'looksLikeDualFormat', '确认是两家', 'mergeScopes', 'merged_into']
    for (const kw of forbidden) {
      expect(view, `⛔ 免登录页不应出现「${kw}」判据`).not.toContain(kw)
    }
    // 正向：必须明说「仅凭坐标无法区分」+ 引导补面积/编码
    expect(view).toMatch(/仅凭坐标无法区分/)
    expect(view).toMatch(/补编码与面积|补面积/)
  })

  it('D 组：几何分档常量与后端一致', () => {
    const fe = read(GEO)
    const be = read(BE_GEO)
    // 后端的四个阈值 50/300/800/2000 必须在前端几何里逐个出现
    const feNums = (fe.match(/max:\s*\d+/g) || []).join(',')
    expect(feNums, '前端分档阈值应为 50/300/800/2000').toBe('max: 50,max: 300,max: 800,max: 2000')
    for (const n of [50, 300, 800, 2000]) {
      expect(be, `后端应仍含 ${n} 分档`).toMatch(new RegExp(`lt:\\s*${n}\\b`))
    }
    expect(fe).toMatch(/NEAR_M\s*=\s*300/)
  })

  it('E 组：官网三语均有体检入口且指向主域', () => {
    for (const [name, f] of [['zh', HP_ZH], ['en', HP_EN], ['ja', HP_JA]]) {
      const html = read(f)
      expect(html, `${name} 官网缺体检入口`).toMatch(/href="https:\/\/mka-online\.cn\/free-checkup"/)
    }
  })

  it('F 组：三语 pageTitle.freeCheckup 键都在', () => {
    for (const f of LOCALES) {
      const src = stripComments(read(f))
      expect(src, `${f} 缺 pageTitle.freeCheckup`).toMatch(/freeCheckup:\s*['"]/)
    }
  })

  // ── G 组：v1.13.387 可分享 PDF ──────────────────────────────────────────
  // 报告要发微信群/朋友圈，最怕两件事：① 悄悄调后端烧配额 ② 把精确坐标印在纸上泄露门店位置。
  // B 组已钉死整页零网络，这里再钉报告内容本身，防后续有人往纸张里塞经纬度/地址。
  it('G 组：导出走统一 PDF 工具、报告不含精确坐标、保留隐私与入口', () => {
    expect(view, '应复用统一 PDF 工具（A4/分页规则同源）').toMatch(/from\s+['"]@\/utils\/exportPaperPdf\.js['"]/)
    expect(view, '应有导出调用').toMatch(/exportPaperPdf\s*\(/)
    expect(view, '应有导出按钮').toMatch(/导出可分享\s*PDF/)
    // 切页锚点：⛔ 改名会让统一工具找不到安全切页点，把表格行切成两半
    expect(view, '报告应带 bf-sec 切页锚点').toMatch(/class="[^"]*\bbf-sec\b/)
    expect(view, '报告应带 bf-foot 切页锚点').toMatch(/class="[^"]*\bbf-foot\b/)

    // 🔴 纸张正文（从 fc-report-stage 起）禁止出现坐标/地址字段——分享出去不泄露门店位置
    const stageAt = view.indexOf('fc-report-stage')
    expect(stageAt, '找不到报告纸张').toBeGreaterThan(-1)
    // 🔴 必须切到 </template> 为止：整页 script 里有 `lat: e.latlng.lat`（地图点选用），
    //    扫到文件末尾会把合法的取坐标代码误判成「报告泄露坐标」⇒ 假红。
    const paper = view.slice(stageAt, view.indexOf('</template>', stageAt))
    for (const kw of ['p.lat', 'p.lng', 'toFixed(6)', 'reverseGeocode', 'geocode', 'formatted_address', '详细地址']) {
      expect(paper, `⛔ 报告纸张不得印「${kw}」（会泄露门店精确位置）`).not.toContain(kw)
    }
    expect(paper, '报告必须写隐私声明（未上传/未存储）').toMatch(/未上传|不离开这台设备/)
    expect(paper, '报告必须带官网入口，才能自传播').toMatch(/mka-online\.cn\/free-checkup/)
    expect(paper, '报告必须保留「免费层只看距离」的边界').toMatch(/只用坐标回答/)
  })

  // ── H 组：v1.13.388 报告二维码 ──────────────────────────────────────────
  // 「看到报告 → 扫码自测」是获客闭环的最后一环。守卫钉死四条：
  //   ① 动态 import（⛔ 静态 import 会把 qrcode 打进首屏 chunk，踩首屏闭包铁律）
  //   ② 二维码内容 = 官网体检页 URL（与报告文字入口同源，扫出来必须能自测）
  //   ③ 本地 toDataURL 生成 + <img :src>（⛔ 外链图片会发请求且跨域污染 canvas）
  //   ④ 二维码真在报告纸张里（不是只生成了没放上去）
  it('H 组：报告二维码本地生成、内容指向官网、动态加载不进首屏', () => {
    expect(view, '二维码必须动态 import（静态 import 会进首屏）').toMatch(/await\s+import\(\s*['"]qrcode['"]\s*\)/)
    expect(view, '⛔ 不得静态 import qrcode（会打进首屏 chunk）').not.toMatch(/import\s+QRCode\s+from\s+['"]qrcode['"]/)
    // 🔴 URL 断言必须用未剥注释的原文：stripComments 会把 `https://` 里的 `//` 当成行注释切断。
    expect(read(VIEW), '二维码落地页必须是官网体检页').toMatch(/REPORT_QR_URL\s*=\s*['"]https:\/\/mka-online\.cn\/free-checkup['"]/)
    expect(view, '必须由 qrcode 本地生成 data URL').toMatch(/QRCode\.toDataURL\s*\(\s*REPORT_QR_URL/)

    const stageAt = view.indexOf('fc-report-stage')
    const paper = view.slice(stageAt, view.indexOf('</template>', stageAt))
    expect(paper, '报告里必须有二维码图片').toMatch(/class="fc-rp-qr"/)
    expect(paper, '二维码应绑定本地生成的 data URL').toMatch(/:src="qrDataUrl"/)
    expect(paper, '⛔ 报告图片不得用外链 src（会发请求+跨域污染 canvas）').not.toMatch(/<img[^>]+src=["']https?:/)
    expect(paper, '报告应提示扫码自测').toMatch(/扫码/)
  })
})
