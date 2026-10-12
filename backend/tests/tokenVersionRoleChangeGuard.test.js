/**
 * 「改角色 ⇒ 降权必须撤销 token」守卫（v1.13.211 立 · 治本项）
 *
 * 背景（v1.13.150 起挂账的历史遗留，2026-10-12 批次 211 关闭）：
 *   middleware/auth.js 里 `req.user = decoded` ⇒ requireAdmin 等判的是 **JWT 载荷**，
 *   不是库。而 routes/users.js 的 PUT /:id 原先**只在改密码时** bumpTokenVersion，
 *   改角色不 bump ⇒
 *     管理员把某人 vip/admin 改成 user ⇒ 库里已降级，但对方手上那枚旧 token
 *     里仍写着 role:'vip'/'admin' ⇒ 最长 TOKEN_TTL(7d) 内继续按旧角色放行。
 *   也就是「后台收回权限」这个动作**实际上没有生效**，要等对方重新登录。
 *
 * 同源的第二处（本批一并修）：app.js 的 6 小时定时器把到期 trial 降为 user 时，
 *   同样不 bump ⇒ 到期用户旧 token 里的 role='trial' 还能再放行 7 天。
 *
 * 修法（分流，⛔ 不能无脑加一行 bump）：
 *   · 降权（vip→user / admin→user / vip→trial …）⇒ bump（权限立刻收回）
 *   · 提权（user→vip/trial、vip→admin …）        ⇒ 不 bump（提权不多放行任何东西，
 *     bump 反而把对方当场踢下线；前端走 GET /auth/me **读库**即可感知）
 *   · 改的是**自己** ⇒ bump 后按新角色回签一枚 token 回给前端替换（沿用 PUT /me 范式），
 *     否则管理员把自己降权会当场自锁掉线。
 *
 * 本文件是**回归钉子**：
 *   ① 谁把判据落地成「就地写位阶表」（utils/vipRole.js 之外再抄一份）→ 立刻红；
 *   ② 谁把 PUT /:id 的 revoke 条件改回只有 password（降权又被漏掉）→ 立刻红；
 *   ③ 谁删掉「改自己回签 token」或响应里的 token 字段（自降权会自锁）→ 立刻红；
 *   ④ 谁把 app.js 的到期降级里的 bump 删掉（漏洞从后门回来）→ 立刻红。
 * （前端无独立测试框架，故与 vipGateGuard / vipReviewEntryGuard 一致挂在 backend vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
// 纯函数模块（无 db / 无副作用依赖）⇒ 直接做行为断言，比 grep 源码强得多
import { ROLE_RANK, isPrivilegeDowngrade } from '../src/utils/vipRole.js'

/** ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，pathname 会留下百分号编码导致 ENOENT */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const BACKEND_SRC = path.join(REPO_ROOT, 'backend/src')
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src')

const readBackend = (rel) => fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8')
const readFrontend = (rel) => fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8')

/**
 * 安全剥离注释（逐字符扫描，字符串内部不识别注释）。
 *
 * 🔴 绝不可用 `/\*[\s\S]*?\*\//g` 这类裸正则。实测踩坑（本守卫第一版即中招）：
 *   app.js:118 的路由说明里有一句「…（/import/* 不被 purchase 子路由吞）」
 *   —— 这里的 `/*` 是**字符串里的两个字符**，不是注释起点。裸正则会从它开始，
 *   一直匹配到第 189 行那句真正的 `/* 事务已结束等情况忽略 *\/` 的结尾，
 *   把整整 70 行代码（含本守卫要检查的 TrialExpire 段）**静默吃掉**，
 *   于是断言报出「缺少 SELECT」这种**看起来像业务缺陷、实为工具误伤**的假红
 *   （更坏的方向是假绿）。⇒ 扫描时必须先进入字符串状态。
 */
function stripComments(src) {
  // .vue 的 HTML 注释无嵌套歧义，先整体去掉
  const s = src.replace(/<!--[\s\S]*?-->/g, '')
  let out = ''
  let i = 0
  const n = s.length
  while (i < n) {
    const ch = s[i]
    const next = s[i + 1]
    if (ch === '/' && next === '/') {                 // 行注释
      while (i < n && s[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {                 // 块注释
      i += 2
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {     // 字符串 / 模板串：整体照抄跳过
      const quote = ch
      out += ch
      i += 1
      while (i < n) {
        if (s[i] === '\\') { out += s[i] + (s[i + 1] || ''); i += 2; continue }
        out += s[i]
        if (s[i] === quote) { i += 1; break }
        i += 1
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** 按大括号配平截出函数体 */
function extractFnBody(src, signature) {
  const start = src.indexOf(signature)
  if (start === -1) return null
  const braceStart = src.indexOf('{', start)
  if (braceStart === -1) return null
  let depth = 0
  for (let i = braceStart; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return src.slice(braceStart, i + 1)
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────
describe('isPrivilegeDowngrade：位阶判据的行为契约', () => {
  it('位阶表顺序必须是 user < trial < vip < admin', () => {
    expect(ROLE_RANK.user).toBe(0)
    expect(ROLE_RANK.trial).toBeGreaterThan(ROLE_RANK.user)
    expect(ROLE_RANK.vip).toBeGreaterThan(ROLE_RANK.trial)
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.vip)
  })

  it('降权路径一律判为需要撤销（必须 bump）', () => {
    expect(isPrivilegeDowngrade('admin', 'user')).toBe(true)
    expect(isPrivilegeDowngrade('admin', 'vip')).toBe(true)
    expect(isPrivilegeDowngrade('admin', 'trial')).toBe(true)
    expect(isPrivilegeDowngrade('vip', 'user')).toBe(true)
    expect(isPrivilegeDowngrade('vip', 'trial')).toBe(true)   // 额度档位下降（AI 月额度 1000→50）
    expect(isPrivilegeDowngrade('trial', 'user')).toBe(true)
  })

  it('提权 / 平级一律判为无需撤销（不得 bump，免得把对方当场踢下线）', () => {
    expect(isPrivilegeDowngrade('user', 'vip')).toBe(false)
    expect(isPrivilegeDowngrade('user', 'trial')).toBe(false)
    expect(isPrivilegeDowngrade('trial', 'vip')).toBe(false)
    expect(isPrivilegeDowngrade('vip', 'admin')).toBe(false)
    expect(isPrivilegeDowngrade('vip', 'vip')).toBe(false)
    expect(isPrivilegeDowngrade('user', 'user')).toBe(false)
  })

  it('未知角色 fail-closed：脏值 / 新角色未进表 ⇒ 按降权处理', () => {
    expect(isPrivilegeDowngrade('vip', 'superuser')).toBe(true)   // 新角色没同步进位阶表
    expect(isPrivilegeDowngrade('whoops', 'admin')).toBe(true)
    expect(isPrivilegeDowngrade('', 'user')).toBe(false)          // 空值不算降权（role 缺失）
    expect(isPrivilegeDowngrade('user', '')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
describe('PUT /users/:id：降权撤销 + 自改回签', () => {
  const usersSrc = stripComments(readBackend('routes/users.js'))
  const body = extractFnBody(usersSrc, "router.put('/:id'")

  it('函数体切片成功（防止切片失败导致后续断言静默失效）', () => {
    expect(body, "未找到 router.put('/:id' —— 断言失效，请更新守卫").toBeTruthy()
    expect(body.length).toBeGreaterThan(1000)
  })

  it('判据复用 utils/vipRole.js::isPrivilegeDowngrade（⛔ 不就地写位阶表）', () => {
    expect(body, 'PUT /:id 必须用 isPrivilegeDowngrade 判降权').toMatch(/isPrivilegeDowngrade\(/)
    expect(
      usersSrc,
      'routes/users.js 里出现了 ROLE_RANK —— 位阶表只能有一份（utils/vipRole.js）'
    ).not.toMatch(/ROLE_RANK/)
    expect(
      usersSrc,
      'utils/vipRole.js 的 isPrivilegeDowngrade 未被 import'
    ).toMatch(/import\s*\{[^}]*isPrivilegeDowngrade[^}]*\}\s*from\s*'\.\.\/utils\/vipRole\.js'/)
  })

  it('撤销条件是「密码变更 或 降权」，不再是只有 password', () => {
    expect(body, 'revokeAllSessions 计算缺失').toMatch(/revokeAllSessions\s*=\s*[^\n]*roleDowngrade/)
    expect(body, 'bump 必须由 revokeAllSessions 控制').toMatch(/if\s*\(\s*revokeAllSessions\s*\)\s*\{/)
    expect(
      body,
      '⛔ 又变回「只有改密码才 bump」—— 降权漏洞会原样回来（这正是 v1.13.150~210 的旧 bug）'
    ).not.toMatch(/if\s*\(\s*password\s*\)\s*bumpTokenVersion/)
  })

  it('改的是自己时按新角色回签 token（否则自降权当场自锁）', () => {
    expect(body, '缺少 isSelfEdit 判据').toMatch(/isSelfEdit\s*=/)
    expect(body, '自改必须回签 token（signToken）').toMatch(/refreshedToken\s*=\s*signToken\(/)
    // 回签必须用**新角色**——用 existingUser.role 会签回旧角色，等于没生效
    expect(
      body,
      '回签 token 的角色必须是 finalRole（新值），不能用 existingUser.role'
    ).toMatch(/role:\s*finalRole/)
  })

  it('响应体把回签 token 透出给前端（否则前端无从替换本地凭据）', () => {
    expect(
      body,
      '响应里缺少 refreshedToken 透出 —— 前端拿不到新 token，自降权仍会 401'
    ).toMatch(/\.\.\.\(refreshedToken\s*\?\s*\{\s*token:\s*refreshedToken\s*\}\s*:\s*\{\s*\}\)/)
  })
})

// ─────────────────────────────────────────────────────────────
describe('app.js：trial 到期自动降级同样撤销 token', () => {
  const rawApp = readBackend('app.js')
  const appSrc = stripComments(rawApp)

  it('剥注释自检：不得把代码整段吃掉（防字符串里的 /* 误伤）', () => {
    expect(
      appSrc.length,
      '剥离后代码量异常偏小 —— 疑似字符串里的 `/*`（app.js:118 的 `/import/*`）与后文注释的 `*/` 配成一对，整段代码被删掉，后续断言会假红/假绿'
    ).toBeGreaterThan(rawApp.length * 0.5)
    expect(appSrc, '尾部 start() 调用不见了 —— 说明尾部代码被吃掉').toMatch(/start\(\)/)
  })

  it('已 import bumpTokenVersion', () => {
    expect(appSrc).toMatch(/import\s*\{\s*bumpTokenVersion\s*\}\s*from\s*'\.\/utils\/tokenAuth\.js'/)
  })

  it('降级前先取出受影响 id（UPDATE 之后就查不到了）', () => {
    const iSelect = appSrc.indexOf("SELECT id FROM users WHERE role = 'trial'")
    const iUpdate = appSrc.indexOf('UPDATE users SET role = \'user\'')
    expect(iSelect, '缺少「先查受影响账号」的 SELECT').toBeGreaterThan(-1)
    expect(iUpdate, '找不到降级 UPDATE').toBeGreaterThan(-1)
    expect(iSelect, 'SELECT 必须先于 UPDATE（否则 role 已改，无从知道该 bump 谁）').toBeLessThan(iUpdate)
  })

  it('逐个 bump 受影响账号', () => {
    expect(
      appSrc,
      '到期降级未撤销 token ⇒ 到期用户旧 token 里的 trial 角色仍能放行 7 天'
    ).toMatch(/for\s*\(\s*const u of expired\s*\)\s*bumpTokenVersion\(/)
  })

  it('位阶表不在 app.js 里再抄一份', () => {
    expect(appSrc, 'app.js 不应出现 ROLE_RANK（单一权威来源在 utils/vipRole.js）').not.toMatch(/ROLE_RANK/)
  })
})

// ─────────────────────────────────────────────────────────────
describe('前端：UsersView 应用后端回签的 token', () => {
  const usersView = stripComments(readFrontend('views/UsersView.vue'))
  const body = extractFnBody(usersView, 'const handleSave =')

  it('handleSave 切片成功', () => {
    expect(body, '未找到 handleSave —— 断言失效，请更新守卫').toBeTruthy()
  })

  it('响应带 token 时替换本地凭据并同步自身角色', () => {
    expect(body, '缺少 data.token 分支 —— 自降权后不会替换凭据，下一次请求即 401').toMatch(/if\s*\(\s*data\.token\s*\)/)
    expect(body).toMatch(/userStore\.applyToken\(/)
    expect(body, 'applyToken 之后必须 fetchUser（角色变了，导航要跟着切）').toMatch(/await\s+userStore\.fetchUser\(\)/)
  })

  it('自降权后不再无条件刷新管理列表（会弹出误导性的 403 提示）', () => {
    expect(
      body,
      '末尾必须写成 if (userStore.isAdmin) fetchUsers()；裸 fetchUsers() 会在自降权后报「获取用户列表失败」'
    ).toMatch(/if\s*\(\s*userStore\.isAdmin\s*\)\s*fetchUsers\(\)/)
    expect(body, '⛔ 裸 fetchUsers() 又回来了').not.toMatch(/\n\s*fetchUsers\(\)\s*$/m)
  })
})
