/**
 * 候选点位「对所有登录用户可见」守卫 —— v1.13.424
 * ---------------------------------------------------------------------------
 * 沿革（别只看最后一版就动手）：
 *   · v1.13.333 上线，全免费、只本人可见；
 *   · v1.13.343 业主「这个功能还没想好」⇒ 收紧为**仅管理员**（本文件前身 `candidateAdminOnly.test.js`）；
 *   · **v1.13.424 业主「开放给所有用户」⇒ 恢复**。本文件就是把口径反过来钉住。
 *
 * 门禁一共**四处**，开放时必须**全部**摘掉（343 时代的四道，缺一处就等于半开）：
 *   ① MainLayout.vue  「选址工作台」下拉 → 候选点位
 *   ② MapView.vue     地图右键 →「加入候选点位」（带坐标深链 router.push('/candidates')）
 *   ③ router/index.js 直接输 URL /candidates
 *   ④ MapView.vue     `contextMenuAction('candidate')` 的二次拦截
 *
 * 🔴 本批最容易出错的一刀：③ 把 `requiresAdmin` 删掉却忘了加 `requiresAuth`。
 *   那一来**未登录用户**直接输 /candidates 就能打开页面（渲染出空壳、接口逐个 401）。
 *   C 组就是钉这一条：`requiresAuth: true` 必须在、`requiresAdmin` 必须不在。
 *
 * ⚠️ 后端边界（刻意，别误读）：
 *   `/api/candidates` 只挂 `authenticate`，**没有** requireAdmin —— 前端口径放开后，两者正好一致。
 *   ⛔ 不要"顺手补个 requireAdmin"：那会让普通用户页面能进、数据全 403，比不开还糟。
 *
 * 🔴 守卫自身规范（211/231 教训）：正则扫源码**必须剥注释**，否则注释里写的
 *   `v-if="userStore.isAdmin"` 会把扫描器骗成假红/假绿；且必须配「切片自检」。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

/** 剥 JS 块/行注释 + Vue HTML 注释；[^:] 保护 https:// 与字符串里的 // 字面量 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 递归列出 frontend/src 下的 .vue/.js（排除 .bak_* 历史备份） */
function frontendSources(dir = 'frontend/src') {
  const out = []
  for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${ent.name}`
    if (ent.isDirectory()) out.push(...frontendSources(rel))
    else if (/\.(vue|js)$/.test(ent.name) && !ent.name.includes('.bak')) out.push(rel)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
describe('A. 「选址工作台」下拉里的候选点位项对所有登录用户可见', () => {
  const src = stripComments(read('frontend/src/views/MainLayout.vue'))

  /** 取出候选点位那一个 el-dropdown-item 的开始标签 */
  function itemTag() {
    const items = [...src.matchAll(/<el-dropdown-item([^>]*)>/g)]
      .filter((m) => m[1].includes("$router.push('/candidates')"))
    expect(items.length, '候选点位菜单项数量异常（应为 1）').toBe(1)
    return items[0][1]
  }

  it('① 菜单项**不再**带 admin 门禁', () => {
    expect(
      itemTag(),
      '又加回了 admin 门禁 ⇒ 普通用户在「选址工作台」里看不到候选点位'
    ).not.toContain('userStore.isAdmin')
  })

  it('② 菜单项仍然存在且指向 /candidates（⛔ 别把"开放"做成"删除"）', () => {
    expect(itemTag()).toContain("$router.push('/candidates')")
    expect(src).toContain("$t('nav.candidates')")
  })

  it('③ 智能选址那条**仍然**是 admin-only（本批只放开候选点位，别顺手带上它）', () => {
    const site = [...src.matchAll(/<el-dropdown-item([^>]*)>/g)]
      .filter((m) => m[1].includes("$router.push('/site-select')"))
    expect(site.length).toBe(1)
    expect(site[0][1], '智能选址会消耗联通付费配额，⛔ 不能跟着候选点位一起放开')
      .toContain('userStore.isAdmin')
  })
})

describe('B. 地图右键「加入候选点位」同样对所有人开放', () => {
  const src = stripComments(read('frontend/src/views/MapView.vue'))

  it('④ 右键菜单项不再带 admin 门禁', () => {
    const m = /<div([^>]*)@click="contextMenuAction\('candidate'\)"/.exec(src)
    expect(m, '找不到地图右键的「加入候选点位」项').toBeTruthy()
    expect(m[1], '右键项又加了 admin 门禁 ⇒ 普通用户从地图进不去候选点位').not.toContain('isAdmin')
  })

  it('⑤ 动作分发不再二次拦截', () => {
    expect(
      src,
      "case 'candidate' 仍带 admin 判据 ⇒ 程序化触发不会跳页（与菜单口径不一致）"
    ).toMatch(/case 'candidate':\s*addCandidateFromMap\(\);/)
    expect(src).not.toMatch(/case 'candidate':\s*if \(userStore\.isAdmin\)/)
  })
})

describe('C. /candidates 深链：要登录、不要管理员', () => {
  const src = stripComments(read('frontend/src/router/index.js'))

  function block() {
    const i = src.indexOf("path: 'candidates'")
    expect(i, '找不到 candidates 路由（守卫已失锚，请同步更新）').toBeGreaterThan(-1)
    // ⚠️ 必须切到**下一条 path** 为止：固定 900 字符会把下面 site-select 的
    //    `meta: { requiresAdmin: true }` 一起扫进来 ⇒ ⑦ 假红（本批首次实现就踩了）。
    const j = src.indexOf("path: '", i + 10)
    return j > i ? src.slice(i, j) : src.slice(i, i + 400)
  }

  it('⑥ 🔴 meta 必须含 requiresAuth —— 删了 requiresAdmin 却漏了这块＝未登录也能进', () => {
    expect(block(), '未登录用户直接输 /candidates 就能打开空壳页').toMatch(/meta:\s*\{[^}]*\brequiresAuth:\s*true\b/)
  })

  it('⑦ meta 不得再有 requiresAdmin', () => {
    expect(block(), '又收紧成仅管理员').not.toMatch(/meta:\s*\{[^}]*\brequiresAdmin:\s*true\b/)
  })

  it('⑧ 全局守卫本身不能被顺手删掉（其它管理页还靠它）', () => {
    expect(src).toMatch(/to\.meta\.requiresAdmin\s*&&\s*!userStore\.isAdmin/)
    expect(src).toMatch(/to\.meta\.requiresAuth\s*&&\s*!userStore\.isLoggedIn/)
  })
})

describe('D. 立项报告仍只随候选点位页出现（别被挂到无门禁的页面上）', () => {
  it('⑨ CandidateReport 只被 CandidateView.vue 引用', () => {
    // ⚠️ 必须判 **import 语句**：377 抽出的 utils/exportPaperPdf.js 注释里提过文件名，
    //    纯字符串匹配会把它当成"引用方"（假阳性）。
    const IMPORT_RE = /(?:from\s+|import\s*\(\s*)['"][^'"]*CandidateReport\.vue['"]/
    const users = frontendSources().filter((f) => IMPORT_RE.test(read(f))).sort()
    expect(users).toEqual(['frontend/src/views/CandidateView.vue'])
  })

  it('⑩ CandidateView 只由 /candidates 一条路由加载', () => {
    const hits = [...read('frontend/src/router/index.js').matchAll(/import\('@\/views\/CandidateView\.vue'\)/g)]
    expect(hits.length, '候选点位页被挂到了第二条路由').toBe(1)
  })
})

describe('E. 前后端口径一致：接口只要求登录，不要求管理员', () => {
  it('⑪ candidates 路由组仍只挂 authenticate，⛔ 不许偷偷加 requireAdmin', () => {
    const src = stripComments(read('backend/src/routes/candidates.js'))
    expect(src).toContain('authenticate')
    expect(src, '前端已放开、后端却收紧 ⇒ 页面能进、数据全 403').not.toMatch(/router\.use\(\s*requireAdmin/)
  })

  it('⑫ 功能本体没被删（路由 / 三语词条 / 注册 / 表 / 342 回填）', () => {
    expect(read('frontend/src/router/index.js')).toContain("path: 'candidates'")
    for (const lang of ['zh', 'ja', 'en']) {
      expect(read(`frontend/src/i18n/locales/${lang}.js`), `${lang} 缺 candidates 文案`).toContain('candidates:')
    }
    expect(read('backend/src/app.js')).toContain("app.use('/api/candidates', candidateRoutes)")
    expect(read('backend/src/models/database.js')).toContain('CREATE TABLE IF NOT EXISTS store_candidates')
    expect(read('backend/src/routes/purchase.js')).toContain('LEFT JOIN store_candidates sc')
  })
})

describe('F. 守卫自检（211 教训：剥注释不能吞代码）', () => {
  it('⑬ HTML 注释被剥掉、真实模板属性保留', () => {
    const sample =
      '<!-- v-if="userStore.isAdmin" 只是历史说明 -->\n' +
      '<el-dropdown-item v-if="userStore.isAdmin">x</el-dropdown-item>'
    const out = stripComments(sample)
    expect(out).not.toContain('-->')
    expect(out, '剥注释把真实代码吞了 ⇒ 守卫会假绿').toContain('<el-dropdown-item v-if="userStore.isAdmin">')
  })

  it('⑭ 扫描器能真的看到三个源文件', () => {
    for (const f of [
      'frontend/src/views/MainLayout.vue',
      'frontend/src/views/MapView.vue',
      'frontend/src/router/index.js',
    ]) {
      expect(stripComments(read(f)).length).toBeGreaterThan(1000)
    }
  })
})
