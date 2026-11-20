/**
 * 分享链接 · 前端与文案守卫（v1.13.392）
 *
 * 被测：views/SharedReportView.vue、components/ReportShareDialog.vue、
 *      components/ReportPaper.vue、router/index.js、utils/mailer.js
 *
 * 这些断言全部来自**真机验证时踩到的问题**，不是凭空加的：
 *
 *   A. 公开页根容器**必须自己滚**：全局 `html,body,#app{height:100%;overflow:hidden}`
 *      （App.vue:23）⇒ 只写 min-height:100vh 时页面滚不动，实测 document.scrollHeight
 *      恒等于视口 577px，报告后 2/3 永远看不到。这是 375c 那条铁律的第三次复发。
 *   B. 公开页**必须用裸 axios**：utils/api.js 的 401 拦截器会 window.location.href='/login'，
 *      匿名访客被弹去登录页＝把内部入口暴露给外部人，链接直接失效。
 *   C. 分享面板**必须用 utils/api.js**：反过来，漏了它就没有 Authorization，401。
 *      （B/C 是相反的两条约束，必须同时钉住，否则改一处就悄悄破坏另一边。）
 *   D. 分享面板的确认文案**不许带 markdown 星号**：ElMessageBox 不解析 `**`，
 *      真机弹出过「撤销后这条链接**立即**打不开」，星号原样显示在界面上。
 *   E. 分享面板 body 要有内部滚动（非 scoped 样式）：视口 577px 时没它够不到「发送邮件」。
 *   F. 三件事必须在用户点之前就说清：免登录 / 30 天 / 可撤销。
 *   G. 路由 /s/:token 必须 requiresAuth:false ＋ noindex:true（含人口数据，不许被收录）。
 *   H. 公开读端点在后端**不许挂 authenticate**（那正是分享的意义）。
 *   I. 邮件正文不许出现配额/单价/账号信息。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const VIEW = read('frontend/src/views/SharedReportView.vue')
const DLG = read('frontend/src/components/ReportShareDialog.vue')
const PAPER = read('frontend/src/components/ReportPaper.vue')
const COMP = read('frontend/src/components/CandidateReport.vue')
const ROUTER = read('frontend/src/router/index.js')
const MAILER = read('backend/src/utils/mailer.js')
const ROUTE_BE = read('backend/src/routes/reportShares.js')

const VIEW_TPL = VIEW.slice(0, VIEW.indexOf('<script setup>'))
const VIEW_JS = VIEW.slice(VIEW.indexOf('<script setup>'))

describe('A 公开页容器必须自己滚（否则 #app 的 overflow:hidden 把报告裁掉）', () => {
  it('根容器同时有 height 与 overflow-y:auto', () => {
    const block = VIEW.match(/\.sr-page \{[\s\S]*?\}/)
    expect(block, '找不到 .sr-page 规则').toBeTruthy()
    expect(block[0]).toMatch(/height:\s*100vh/)
    expect(block[0]).toMatch(/overflow-y:\s*auto/)
    // ⛔ 只写 min-height 会「看起来对、实际滚不动」（实测 scrollHeight 恒等于视口）
    expect(block[0]).not.toMatch(/^\s*min-height:\s*100vh/m)
  })
})

describe('B/C 两处必须用**相反**的 HTTP 客户端', () => {
  it('公开页用裸 axios，⛔ 不许用 utils/api.js（否则 401 会被弹去登录页）', () => {
    expect(VIEW_JS).toMatch(/import\s+axios\s+from\s+'axios'/)
    expect(VIEW_JS).not.toContain("from '@/utils/api")
    // 且真的用它请求公开端点
    expect(VIEW_JS).toContain('/report-shares/public/')
  })

  it('分享面板用 utils/api.js（自动带 token、响应已解包）', () => {
    expect(DLG).toContain("import api from '@/utils/api.js'")
    expect(DLG).not.toMatch(/import\s+axios\s+from\s+'axios'/)
    expect(DLG).toContain("api.post('/report-shares'")
    expect(DLG).toContain('/report-shares/${share.value.id}/email')
  })
})

describe('D 确认文案不许把 markdown 星号漏到界面上', () => {
  it('ReportShareDialog / CandidateReport 的字符串里不许出现成对星号', () => {
    // 只扫字符串字面量（引号内），注释里的 ** 是合法的强调写法
    const scan = (src) => {
      const bad = []
      src.split('\n').forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        const m = line.match(/(['"`])([^'"`]*\*\*[^'"`]*)\1/)
        if (m && /[\u4e00-\u9fff]/.test(m[2])) bad.push(`${i + 1}: ${m[2].slice(0, 60)}`)
      })
      return bad
    }
    expect(scan(DLG)).toEqual([])
    expect(scan(COMP)).toEqual([])
  })
})

describe('E 分享面板 body 要有内部滚动（小屏够不到发送按钮）', () => {
  it('非 scoped 样式给 .share-dlg .el-dialog__body 加 max-height + overflow', () => {
    // el-dialog 被 teleport 到 body，scoped 的 data-v 属性不在那个节点 ⇒ 必须非 scoped
    const afterScoped = DLG.slice(DLG.lastIndexOf('<style>'))
    expect(afterScoped).toContain('.share-dlg .el-dialog__body')
    expect(afterScoped).toMatch(/max-height:\s*\d+vh/)
    expect(afterScoped).toMatch(/overflow-y:\s*auto/)
  })
})

describe('F 三件事必须在点之前说清：免登录 / 30 天 / 可撤销', () => {
  it('弹窗说明含「免登录」「30 天」「撤销」', () => {
    expect(DLG).toContain('免登录')
    expect(DLG).toContain('30 天')
    expect(DLG).toContain('撤销')
  })

  it('「更新链接」必须写明链接地址不变、已发出的照样能打开', () => {
    expect(DLG).toContain('链接地址不变')
    expect(DLG).toMatch(/已经发出去的照样能打开|已发出去的链接看到最新版/)
  })
})

describe('G 路由 /s/:token：免登录 + noindex', () => {
  it('requiresAuth 为 false', () => {
    const i = ROUTER.indexOf("path: '/s/:token'")
    expect(i).toBeGreaterThan(-1)
    const block = ROUTER.slice(i, i + 700)
    expect(block).toMatch(/requiresAuth:\s*false/)
  })

  it('noindex 为 true（页面含联通人口与商圈数据，绝不能被搜索引擎收录）', () => {
    const i = ROUTER.indexOf("path: '/s/:token'")
    const block = ROUTER.slice(i, i + 700)
    expect(block).toMatch(/noindex:\s*true/)
  })

  it('titleKey 在三套语言包里都有（⛔ 只在中文包里加）', () => {
    const i = ROUTER.indexOf("path: '/s/:token'")
    const block = ROUTER.slice(i, i + 700)
    const key = (block.match(/titleKey:\s*'([^']+)'/) || [])[1]
    expect(key).toBeTruthy()
    const leaf = key.split('.').pop()
    for (const loc of ['zh', 'en', 'ja']) {
      const src = read(`frontend/src/i18n/locales/${loc}.js`)
      expect(src, `${loc}.js 缺 ${key}`).toContain(`${leaf}:`)
    }
  })
})

describe('H 后端公开读端点不许挂 authenticate', () => {
  it('GET /public/:token 的注册行里没有 authenticate', () => {
    const i = ROUTE_BE.indexOf("router.get('/public/:token'")
    expect(i).toBeGreaterThan(-1)
    const line = ROUTE_BE.slice(i, ROUTE_BE.indexOf('\n', i))
    expect(line).not.toContain('authenticate')
  })

  it('写端点（生成/撤销/发信）都必须 authenticate', () => {
    for (const sig of ["router.post('/', authenticate", "router.delete('/:id', authenticate", "router.post('/:id/email', authenticate"]) {
      expect(ROUTE_BE, `缺少鉴权：${sig}`).toContain(sig)
    }
  })

  it('公开返回体不含 user_id / candidate_id（拿到链接的人不该知道是谁的）', () => {
    // 公开端点内 select 的字段白名单：不许把整行原样丢出去
    const seg = ROUTE_BE.slice(ROUTE_BE.indexOf("router.get('/public/:token'"), ROUTE_BE.indexOf('/** 分享链接：'))
    expect(seg).not.toMatch(/res\.json\(\s*\{?\s*\.\.\.row/)
    expect(seg).not.toContain('user_id:')
    expect(seg).not.toContain('candidate_id:')
  })
})

describe('I 邮件正文不许出现账号/配额/价格', () => {
  it('sendReportShareMail 里没有配额余额、单价、档位等字样', () => {
    const i = MAILER.indexOf('export async function sendReportShareMail')
    expect(i).toBeGreaterThan(-1)
    const fn = MAILER.slice(i, MAILER.indexOf('\n}\n', i) + 3)
    for (const bad of ['剩余', '配额', '单价', '额度', '套餐', '¥']) {
      expect(fn, `邮件正文不该出现「${bad}」`).not.toContain(bad)
    }
    // 必须写明有效期与"请勿转发"
    expect(fn).toContain('有效期')
    expect(fn).toContain('请勿转发')
  })
})

describe('J 纸面组件本身的边界', () => {
  it('ReportPaper 里不许有取数/扣费/弹窗（否则匿名页没法复用）', () => {
    // 🔴 必须先剥注释：文件头那段注释本身就在写「不许出现 axios、ElMessage…」，
    //    不剥的话这条守约会**自伤**（211 的教训：守卫扫源码必配"剥注释"）。
    const strip = (src) => src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const bare = strip(PAPER)
    for (const bad of ['axios', 'ElMessage', 'useRouter', 'quota', 'fetch(']) {
      expect(bare, `ReportPaper 不应出现 ${bad}`).not.toContain(bad)
    }
  })

  it('弹窗与分享页渲染的是**同一个**纸面组件（⛔ 各写一份）', () => {
    expect(COMP).toContain("import ReportPaper from '@/components/ReportPaper.vue'")
    expect(VIEW).toContain("import ReportPaper from '@/components/ReportPaper.vue'")
    expect(COMP).toContain('<ReportPaper')
    expect(VIEW).toContain('<ReportPaper')
  })

  it('分享面板入口在报告弹窗底部（业主定的位置），且三按钮顺序为 关闭 / 分享 / 下载 PDF', () => {
    // ⚠️ 只取 <el-button> 的**标签文本**，⛔ 不要在整段里 indexOf('下载 PDF')：
    //    footer 上方那行注释里就写着「分享放在「下载 PDF」左边」，会被误当成按钮命中。
    const start = COMP.indexOf('<template #footer>')
    const f = COMP.slice(start, COMP.indexOf('</template>', start))
    const labels = [...f.matchAll(/<el-button[^>]*>([\s\S]*?)<\/el-button>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\{\{[^}]*\}\}/g, '').trim())
      .filter(Boolean)
    expect(labels).toEqual(['关闭', '分享给同事', '下载 PDF'])
  })
})
