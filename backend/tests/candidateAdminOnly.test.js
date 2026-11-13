/**
 * 候选点位 / 立项报告「仅管理员可见」门禁守卫 —— v1.13.343
 * ---------------------------------------------------------------------------
 * 业主 2026-11-09 拍板：这个功能还没想好，先设置成**仅管理员账号可见**。
 *   ⛔ 不是删除、不是禁用：代码 / 后端 API / store_candidates 表 / 三语词条 / 数据全部保留，
 *      恢复时只需摘掉下面几处 `v-if` 与 `meta.requiresAdmin`。
 *
 * 门禁面（三处用户可达入口，缺一处就等于没下线）：
 *   ① MainLayout.vue  「选址工作台」下拉 → 候选点位
 *   ② MapView.vue     地图右键 →「加入候选点位」（会 router.push('/candidates') 带坐标深链）
 *   ③ router/index.js 直接输 URL /candidates ⇒ meta.requiresAdmin → 全局守卫 next('/')
 *   ④ MapView.vue     contextMenuAction 的 case 'candidate' 二次拦截（纵深防御）
 *
 * 立项报告（P1-5 一页成稿）只挂在 CandidateView.vue 的「生成立项报告」按钮上，
 *   ⛔ 没有独立入口 ⇒ 页面变成 admin-only 后报告自然一并 admin-only。
 *   本守卫 D 组钉住这个依赖关系：以后谁把 CandidateReport 挂到别的页面上，这里立刻红。
 *
 * ⚠️ 边界（刻意，别误读成「已受保护」）：
 *   本批**只做 UI/路由门禁**，后端 /api/candidates 仍只挂 authenticate，
 *   已登录的非管理员直接构造 HTTP 请求仍可读写**自己的**候选点位。
 *   这不是越权（数据本来就是他自己的），但也不等于「功能被禁用」。
 *   若业主要求连 API 也只对 admin 开放，需在 candidates.js 组级加 requireAdmin
 *   并同步改 candidateWorkflow.test.js 的测试身份 + 本文件 E 组说明。
 *
 * 🔴 守卫自身规范（211/231 教训）：正则扫源码**必须剥注释**（含 HTML 注释），
 *   否则注释里写的 `v-if="userStore.isAdmin"` 会骗过扫描器报假绿灯；
 *   且必须配「切片自检」证明剥注释没有把模板代码一起吞掉。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

/** 剥 JS 块/行注释 + Vue HTML 注释；[^:] 保护 https:// 与 '...' 里的 // 字面量 */
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
describe('A. 「选址工作台」下拉里的候选点位项仅管理员可见', () => {
  const src = stripComments(read('frontend/src/views/MainLayout.vue'))

  it('① 候选点位 el-dropdown-item 带 v-if="userStore.isAdmin"', () => {
    expect(
      src,
      '菜单项缺少 admin 门禁 ⇒ 普通用户仍能在「选址工作台」里看到并点进候选点位'
    // v-if 与 $router.push 都在**开始标签内部**（@click 属性里），⛔ 别把后者写到 > 之后
    ).toMatch(
      /<el-dropdown-item[^>]*v-if="userStore\.isAdmin"[^>]*\$router\.push\('\/candidates'\)[^>]*>/
    )
  })

  it('② 只存在一份候选点位菜单项，且它带门禁（防复制出第二份裸入口）', () => {
    const items = [...src.matchAll(/<el-dropdown-item([^>]*)>([\s\S]*?)<\/el-dropdown-item>/g)]
      .filter((m) => m[0].includes("$route.path === '/candidates'") || m[2].includes('nav.candidates'))
    expect(items.length, '候选点位菜单项数量异常').toBe(1)
    expect(items[0][1]).toContain('v-if="userStore.isAdmin"')
  })
})

describe('B. 地图右键「加入候选点位」仅管理员可见', () => {
  const src = stripComments(read('frontend/src/views/MapView.vue'))

  it('③ 右键菜单项带 v-if="userStore.isAdmin"', () => {
    expect(
      src,
      '地图右键项缺少 admin 门禁 ⇒ 普通用户仍能从地图跳进候选点位页（带坐标深链）'
    ).toMatch(/v-if="userStore\.isAdmin"[\s\S]{0,220}contextMenuAction\('candidate'\)/)
  })

  it('④ 动作分发二次拦截：非管理员不得触发 addCandidateFromMap', () => {
    expect(
      src,
      "case 'candidate' 没有 admin 判据 ⇒ 程序化触发 contextMenuAction('candidate') 仍会跳页"
    ).toMatch(/case 'candidate':\s*if \(userStore\.isAdmin\) addCandidateFromMap\(\); break/)
  })
})

describe('C. /candidates 深链受 requiresAdmin 守卫', () => {
  const src = stripComments(read('frontend/src/router/index.js'))

  it('⑤ candidates 路由块含 meta: { requiresAdmin: true }', () => {
    const i = src.indexOf("path: 'candidates'")
    expect(i, '找不到 candidates 路由（守卫已失锚，请同步更新）').toBeGreaterThan(-1)
    const block = src.slice(i, i + 320)
    // ⚠️ 原来写的是 `meta:\s*\{\s*requiresAdmin:\s*true\s*\}` —— 要求 requiresAdmin 是
    //   meta 里的**唯一**键。v1.13.360 给每条路由补 `titleKey` 后 meta 变成
    //   `{ requiresAdmin: true, titleKey: 'nav.candidates' }`，这条只是**格式**断了、
    //   权限本身没变，却报红。⇒ 放宽成「meta 对象内出现 requiresAdmin: true」，
    //   语义不变（仍要求同一个 meta 对象里含该键且为 true），且不再被后续加键误伤。
    expect(block, '直接输 /candidates 不受守卫保护').toMatch(/meta:\s*\{[^}]*\brequiresAdmin:\s*true\b/)
  })

  it('⑥ 全局守卫仍按 requiresAdmin 把非管理员弹回首页', () => {
    expect(src).toMatch(/to\.meta\.requiresAdmin\s*&&\s*!userStore\.isAdmin/)
    expect(src).toMatch(/next\('\/'\)/)
  })
})

describe('D. 立项报告随页面一起 admin-only（无独立入口）', () => {
  it('⑦ CandidateReport 只被 CandidateView.vue 引用', () => {
    const users = frontendSources()
      .filter((f) => read(f).includes('CandidateReport.vue'))
      .sort()
    expect(
      users,
      'CandidateReport 被挂到了别的页面 ⇒ 该页面若非 admin-only，报告会绕过门禁'
    ).toEqual(['frontend/src/views/CandidateView.vue'])
  })

  it('⑧ CandidateView 只由 /candidates 路由加载', () => {
    const routerSrc = read('frontend/src/router/index.js')
    const hits = [...routerSrc.matchAll(/import\('@\/views\/CandidateView\.vue'\)/g)]
    expect(hits.length, '候选点位页被挂到了第二条路由').toBe(1)
  })
})

describe('E. 可逆性不变量：本批只是「收紧可见性」，不是删功能', () => {
  it('⑨ 路由、三语词条、后端注册、表、342 回填都还在', () => {
    expect(read('frontend/src/router/index.js')).toContain("path: 'candidates'")
    for (const lang of ['zh', 'ja', 'en']) {
      expect(read(`frontend/src/i18n/locales/${lang}.js`), `${lang} 缺 candidates 文案`).toContain('candidates:')
    }
    expect(read('backend/src/app.js')).toContain("app.use('/api/candidates', candidateRoutes)")
    expect(read('backend/src/models/database.js')).toContain('CREATE TABLE IF NOT EXISTS store_candidates')
    // 342：购买履历 report 型从 store_candidates 回填城市/区县，别被顺手删掉
    expect(read('backend/src/routes/purchase.js')).toContain('LEFT JOIN store_candidates sc')
  })

  it('⑩ 后端 candidates 仍只挂 authenticate（本批刻意不动后端，见文件头边界说明）', () => {
    const src = stripComments(read('backend/src/routes/candidates.js'))
    expect(src).toContain('authenticate')
    expect(src, '若已收紧到 API 层，请同步更新本守卫与文件头边界说明').not.toMatch(/router\.use\(\s*requireAdmin/)
  })
})

describe('F. 守卫自检（211 教训：剥注释不能吞代码）', () => {
  it('⑪ HTML 注释被剥掉、真实模板属性保留', () => {
    const sample =
      '<!-- v-if="userStore.isAdmin" 只是说明 -->\n' +
      '<el-dropdown-item v-if="userStore.isAdmin">x</el-dropdown-item>'
    const out = stripComments(sample)
    expect(out).not.toContain('-->')
    expect(out, '剥注释把真实代码吞了 ⇒ 守卫会假绿').toContain(
      '<el-dropdown-item v-if="userStore.isAdmin">'
    )
  })

  it('⑫ 扫描器能真的看到三个源文件', () => {
    for (const f of [
      'frontend/src/views/MainLayout.vue',
      'frontend/src/views/MapView.vue',
      'frontend/src/router/index.js',
    ]) {
      expect(stripComments(read(f)).length).toBeGreaterThan(1000)
    }
  })
})
