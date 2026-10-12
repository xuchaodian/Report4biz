/**
 * VIP 功能门禁守卫（v1.13.208 立，v1.13.209 扩围）
 *
 * 背景 bug（2026-10-12 线上实测）：
 *   普通用户 test_xu（id=38）提交 VIP 试用申请 → 管理员在「用户管理」点通过 ⇒
 *   库内 `users.role` **确实**已变为 'trial'、`vip_until` = +30 天
 *   （`vip_applications` 该单 status='approved'，后端 routes/vipApplications.js::approve 落库正确），
 *   但该用户回到自己的账号后，点「AI 选址建议 / 开店余地 / 网点优化」**三项全被拦下**，
 *   提示「…为 VIP 用户专属功能，请联系管理员开通 VIP」。
 *
 * 根因：VIP 功能性门禁判据在 **4 个组件里各写了一份拷贝**，且都写成
 *   `role === 'vip' || role === 'admin'` —— **全部漏掉 v1.13.205 才新增的 'trial'**：
 *     · components/map/BusinessCirclePanel.vue   （开店余地）
 *     · components/map/StoreControlPanel.vue     （网点优化）
 *     · components/StoreSmartstepsDialog.vue     （AI 选址建议，2 处：按钮文案 + 点击拦截）
 *   而后端 backend/src/utils/aiQuota.js::isVipActive 在 205 已把 trial 纳入 ⇒
 *   **前后端口径分叉**：后端放行、前端拦截，用户只看得见前端的拦截。
 *   （MyAccountView.vue 那份是对的，含 trial —— 同一判据 5 份拷贝里 1 份正确，正是
 *    「多处拷贝必然分叉」的教科书案例。）
 *
 * 修法：判据收敛为 stores/user.js 的 getter `isVipActive`
 *   （`['vip','trial','admin'].includes(state.user?.role)`），4 处一律引用它，
 *   并与后端 isVipActive 保持**同口径**（vip 正式 / trial 试用 / admin 三者均放行）。
 *
 * ★ v1.13.209 扩围：**销售预测**（/sales-forecast）也升为 VIP 专属。
 *   · 前端入口角标：views/MainLayout.vue（「选址工作台」下拉里的销售预测项）
 *   · 前端页面门禁：views/SalesForecastView.vue（非 VIP 只渲染专属空态，不发请求）
 *   · 后端：routes/sales-forecast.js 的 4 个端点统一经 requireVip 放行，
 *     且**必须读库取角色**（loadAiUser + isVipActive），⛔ 不得用 `req.user` ——
 *     JWT 是签发时快照，而 approve 刻意不 bump token_version，按 JWT 判会让
 *     「前端放行、后端 403」的 208 式分叉原样重演。
 *
 * 本文件是**回归钉子**：
 *   ① 谁再就地写「含 admin 却漏 trial」的门禁 → 立刻红；
 *   ② 前后端 isVipActive 的口径被改到不一致 → 立刻红；
 *   ③ 后端销售预测门禁绕过单一判据 / 退回按 JWT 判 → 立刻红。
 * （前端无独立测试框架，故与 cspInlineHandlerGuard.test.js 等一致，挂在 backend 的 vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * 仓库根（backend/ 的上一级）。
 * ⚠️ 必须用 fileURLToPath 而不是 `new URL(...).pathname` —— 本项目路径含中文与空格，
 *    pathname 会留下百分号编码，导致 fs 报 ENOENT。
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src')

/** 递归收集源文件（目录不存在则跳过，避免因目录搬迁导致误红） */
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

/**
 * 剥离注释后再判 —— 否则「注释里举例说明旧写法」会被当成真违规。
 * 只去整行的 `//`（避免误伤 URL 里的 `//`）、块注释与 Vue 模板注释。
 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** 需要纳管的 VIP 门禁组件（相对 frontend/src） */
const GATE_FILES = [
  'components/map/BusinessCirclePanel.vue',
  'components/map/StoreControlPanel.vue',
  'components/StoreSmartstepsDialog.vue',
  'views/MyAccountView.vue',
  // v1.13.209：销售预测升为 VIP 专属 —— 菜单角标在 MainLayout，页面门禁在 SalesForecastView
  'views/SalesForecastView.vue',
  'views/MainLayout.vue',
]

describe('VIP 门禁：不得就地写含 admin 却漏 trial 的判据', () => {
  const targets = collect(FRONTEND_SRC, ['.vue', '.js'])

  it('扫描范围非空（防止目录搬迁后守卫静默失效）', () => {
    expect(targets.length).toBeGreaterThan(30)
    for (const rel of GATE_FILES) {
      expect(targets.some((f) => f.endsWith(rel.split('/').pop()))).toBe(true)
    }
  })

  it('同一行内同时判 vip 与 admin 时，必须一并覆盖 trial', () => {
    const hits = []
    for (const f of targets) {
      const src = stripComments(fs.readFileSync(f, 'utf8'))
      src.split('\n').forEach((line, i) => {
        const hasVip = /===\s*['"]vip['"]/.test(line)
        const hasAdmin = /===\s*['"]admin['"]/.test(line)
        const hasTrial = /['"]trial['"]/.test(line) || /isVipActive/.test(line)
        if (hasVip && hasAdmin && !hasTrial) {
          hits.push(`${path.relative(REPO_ROOT, f)}:${i + 1}: ${line.trim().slice(0, 140)}`)
        }
      })
    }
    expect(
      hits,
      `发现「判了 vip 与 admin、却漏掉 trial」的 VIP 门禁写法（会让 VIP 试用用户被误拦）：\n` +
        `${hits.join('\n')}\n` +
        `修法：改用 userStore.isVipActive（stores/user.js）。`
    ).toEqual([])
  })

  it('6 个 VIP 门禁文件全部引用 isVipActive 单一判据', () => {
    const missing = []
    for (const rel of GATE_FILES) {
      const p = path.join(FRONTEND_SRC, rel)
      if (!fs.existsSync(p)) {
        missing.push(`${rel}（文件不存在）`)
        continue
      }
      if (!/isVipActive/.test(fs.readFileSync(p, 'utf8'))) missing.push(rel)
    }
    expect(missing, `以下文件未走 isVipActive 单一判据：\n${missing.join('\n')}`).toEqual([])
  })
})

describe('VIP 门禁：前后端 isVipActive 口径必须一致', () => {
  const store = fs.readFileSync(path.join(FRONTEND_SRC, 'stores/user.js'), 'utf8')
  const aiQuota = fs.readFileSync(path.join(REPO_ROOT, 'backend/src/utils/aiQuota.js'), 'utf8')

  it('前端 getter 覆盖 vip / trial / admin 三角色', () => {
    expect(store).toMatch(/isVipActive\s*:\s*\(state\)\s*=>\s*\[\s*'vip'\s*,\s*'trial'\s*,\s*'admin'\s*\]/)
  })

  it('后端 isVipActive 覆盖 vip / trial / admin 三角色', () => {
    expect(aiQuota).toMatch(
      /user\.role\s*!==\s*'vip'\s*&&\s*user\.role\s*!==\s*'trial'\s*&&\s*user\.role\s*!==\s*'admin'/
    )
  })

  it('后端「AI 选址建议」门禁确实走 isVipActive（而非就地判等）', () => {
    const ai = fs.readFileSync(path.join(REPO_ROOT, 'backend/src/routes/ai.js'), 'utf8')
    expect(ai).toMatch(/isVipActive\(\s*loadAiUser\(/)
  })

  it('后端「销售预测」4 个端点全部走 requireVip + 读库取角色（禁用 JWT 快照）', () => {
    const sf = stripComments(fs.readFileSync(path.join(REPO_ROOT, 'backend/src/routes/sales-forecast.js'), 'utf8'))
    // ① 判据必须复用单一函数，不得就地判等
    expect(sf).toMatch(/isVipActive\(/)
    // ② 必须现查库（req.user 是签发时快照：approve 不 bump token_version，
    //    改角色后旧 token 里的 role 仍是 user ⇒ 按 JWT 判会让试用用户被后端 403）
    expect(sf).toMatch(/loadAiUser\(\s*getDb\(\)\s*,\s*req\.user\?\.id\s*\)/)
    // ③ 4 个端点（candidates / stats / ref-stores / predict）一个都不能漏
    const gated = sf.match(/authenticate,\s*requireVip/g) || []
    expect(gated.length, '销售预测端点未全部挂 requireVip').toBe(4)
  })

  it('trial 的 AI 月额度必须小于 vip（防止「功能门禁」被误写成「计费档位」）', () => {
    // 205 的既有约定：功能门禁放行 trial，但额度按试用档计。
    // 若有人把 trial 分支从 aiCallLimitFor 里删掉，trial 会顺着 isVipActive 拿到 vip 的 1000 次
    // ⇒ 静默放大 20 倍、账单变贵。此处与 aiQuota.test.js 形成双保险。
    expect(aiQuota).toMatch(/user\.role\s*===\s*'trial'\s*\)\s*return\s+AI_ROLE_CALL_LIMIT\.trial/)
    expect(aiQuota).toMatch(/trial:\s*50/)
    expect(aiQuota).toMatch(/vip:\s*1000/)
  })
})
