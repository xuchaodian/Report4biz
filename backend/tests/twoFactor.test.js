/**
 * 两步验证（TOTP）守卫 —— v1.13.321
 *
 * 起因（2026-11-06 安全审计遗留 🟠）：admin 账号只有密码一层、密码最低 6 位。
 *
 * 本文件分两类断言：
 *   【运行时】TOTP 算法必须与 RFC 6238 官方测试向量一致 —— 算错了用户根本配不上，
 *            而且失败表现是「验证码永远不正确」，极难排查。
 *   【源码】钉住几条「改回去不报错、但 2FA 直接失效」的不变量。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  base32Encode, base32Decode, hotp, currentCounter, verifyTotp,
  generateSecret, otpauthUri, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode,
} from '../src/utils/totp.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', 'src')
const R = (...p) => path.join(SRC, ...p)

const authSrc = fs.readFileSync(R('routes', 'auth.js'), 'utf8')
const tokenSrc = fs.readFileSync(R('utils', 'tokenAuth.js'), 'utf8')
const usersSrc = fs.readFileSync(R('routes', 'users.js'), 'utf8')
const auditRouteSrc = fs.readFileSync(R('routes', 'audit-log.js'), 'utf8')
const dbSrc = fs.readFileSync(R('models', 'database.js'), 'utf8')

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// ─────────────────────────────────────────────────────────────────────────────
describe('A. TOTP 必须与 RFC 6238 官方测试向量一致', () => {
  // RFC 6238 Appendix B（SHA1，secret = ascii "12345678901234567890"）
  const secretAscii = '12345678901234567890'
  const secretB32 = base32Encode(Buffer.from(secretAscii, 'ascii'))
  const secretBuf = base32Decode(secretB32)

  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ]

  for (const [t, expected] of vectors) {
    it(`T=${t} → ${expected}`, () => {
      expect(hotp(secretBuf, Math.floor(t / 30), 8)).toBe(expected)
    })
  }

  it('base32 编解码可逆', () => {
    expect(secretBuf.toString('ascii')).toBe(secretAscii)
  })

  it('base32 解码容忍空格/连字符/小写/尾部等号（用户手输的四种常见写法）', () => {
    const messy = secretB32.toLowerCase().replace(/(.{4})/g, '$1 ').trim() + '='
    expect(base32Decode(messy).toString('ascii')).toBe(secretAscii)
  })
})

describe('B. 校验的时间窗口与输入容忍度', () => {
  const secret = generateSecret()
  const buf = base32Decode(secret)
  const now = Date.now()
  const codeAt = (offsetSteps) => hotp(buf, currentCounter(now) + offsetSteps, 6)

  it('当前时间步通过', () => {
    expect(verifyTotp(codeAt(0), secret, { now })).toBe(true)
  })

  it('±1 步（±30s）容忍 —— 手机与服务器必有漂移', () => {
    expect(verifyTotp(codeAt(-1), secret, { now })).toBe(true)
    expect(verifyTotp(codeAt(1), secret, { now })).toBe(true)
  })

  it('±2 步拒绝 —— 窗口开太大等于把 6 位码的有效空间放大 5 倍', () => {
    expect(verifyTotp(codeAt(-2), secret, { now })).toBe(false)
    expect(verifyTotp(codeAt(2), secret, { now })).toBe(false)
  })

  it('容忍用户输入中的空格与连字符', () => {
    const c = codeAt(0)
    expect(verifyTotp(`${c.slice(0, 3)} ${c.slice(3)}`, secret, { now })).toBe(true)
  })

  it('非 6 位数字一律拒绝（含恢复码形态的输入走另一条分支）', () => {
    expect(verifyTotp('12345', secret, { now })).toBe(false)
    expect(verifyTotp('abcdef', secret, { now })).toBe(false)
    expect(verifyTotp('', secret, { now })).toBe(false)
    expect(verifyTotp(null, secret, { now })).toBe(false)
  })

  it('密钥非法时不抛异常、返回 false（不能让 500 暴露内部状态）', () => {
    expect(verifyTotp('123456', '这不是base32!!')).toBe(false)
  })
})

describe('C. 恢复码', () => {
  it('生成 8 张、互不重复、只含无歧义字符', () => {
    const codes = generateRecoveryCodes(8)
    expect(codes).toHaveLength(8)
    expect(new Set(codes).size).toBe(8)
    for (const c of codes) expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/)
  })

  it('哈希对大小写/空格/连字符归一（用户抄写时格式各异）', () => {
    expect(hashRecoveryCode('ABC-DEF-1234')).toBe(hashRecoveryCode('abcdef1234'))
    expect(hashRecoveryCode('ABCD EF 1234')).toBe(hashRecoveryCode('abcdef1234'))
    expect(normalizeRecoveryCode('ab-cd ef')).toBe('ABCDEF')
  })
})

describe('D. 🔴 票据不能当 token 用（否则 2FA 形同虚设）', () => {
  it('verifyTokenPayload 显式拒绝带 purpose 的载荷', () => {
    const code = stripComments(tokenSrc)
    const fn = code.slice(code.indexOf('export function verifyTokenPayload'))
    const guardIdx = fn.indexOf('decoded.purpose')
    const jtiIdx = fn.indexOf('revoked_tokens')
    expect(guardIdx, 'verifyTokenPayload 没有拒绝 purpose 载荷 —— 票据可以直接调 API').toBeGreaterThan(-1)
    expect(guardIdx, 'purpose 检查必须在最前面（在查库之前就拒）').toBeLessThan(jtiIdx)
  })

  it('signTotpTicket 的载荷不含 role（缺 role ⇒ requireAdmin 一律 403）', () => {
    const fn = tokenSrc.slice(tokenSrc.indexOf('export function signTotpTicket'))
    const body = fn.slice(0, fn.indexOf('}') + 1)
    expect(body, '票据里带了 role —— 等于把绕过 2FA 的钥匙发出去').not.toMatch(/role\s*:/)
    expect(body, '票据没有 purpose 标记，上面的拒绝逻辑就失效了').toMatch(/purpose:\s*'totp'/)
  })

  it('票据有效期很短（5 分钟，不是 7 天）', () => {
    const fn = tokenSrc.slice(tokenSrc.indexOf('export function signTotpTicket'))
    expect(fn.slice(0, 400)).toMatch(/expiresIn:\s*'5m'/)
  })
})

describe('E. 登录流程：开了 2FA 就不能直接发 token', () => {
  const code = stripComments(authSrc)

  it('totp_enabled 分支存在', () => {
    expect(code).toMatch(/if\s*\(\s*user\.totp_enabled\s*\)/)
  })

  it('🔴 该分支内 return 在 signToken 之前（顺序反了 = 直接发 token）', () => {
    const idx = code.indexOf('if (user.totp_enabled)')
    expect(idx, '找不到 2FA 登录分支').toBeGreaterThan(-1)
    // 取该分支到下一个空行块结束
    const branch = code.slice(idx, idx + 600)
    const retIdx = branch.indexOf('return res.json')
    const signIdx = branch.indexOf('signToken')
    expect(retIdx, '2FA 分支里没有 return').toBeGreaterThan(-1)
    if (signIdx > -1) {
      expect(retIdx, '2FA 分支在 return 之前就签了 token —— 2FA 等于没开').toBeLessThan(signIdx)
    }
  })

  it('返回体含 needTotp 与 ticket，且**不含 token 字段**', () => {
    const idx = code.indexOf('if (user.totp_enabled)')
    const branch = code.slice(idx, idx + 500)
    expect(branch).toContain('needTotp')
    expect(branch).toContain('ticket')
    expect(branch, '2FA 分支的响应里带了 token —— 前端直接就能拿去用').not.toMatch(/\btoken\s*:/)
  })

  it('第二步校验票据的 purpose（防「用正式 token 换 token」）', () => {
    const idx = code.indexOf("router.post('/login/totp'")
    expect(idx).toBeGreaterThan(-1)
    const body = code.slice(idx, idx + 1200)
    expect(body, '没有校验 purpose —— 任何有效 token 都能换一枚新 token').toContain("decoded?.purpose !== 'totp'")
  })

  it('🔴 票据一次性：换到 token 后必须 revoke', () => {
    const idx = code.indexOf("router.post('/login/totp'")
    const body = code.slice(idx, idx + 4000)
    expect(body, '换完 token 没作废票据 —— 同一张票可以反复试码 5 分钟').toContain('revokeToken(decoded')
  })

  it('验证码失败计入与密码同一个限流桶（否则 6 位数字可免费爆破）', () => {
    const idx = code.indexOf("router.post('/login/totp'")
    const body = code.slice(idx, idx + 4000)
    expect(body).toMatch(/peekLimit\(/)
    expect(body).toMatch(/overLimit\(/)
    expect(body).toContain('LOGIN_MAX_PER_ACCOUNT')
  })

  it('失败时写审计（audit_log 里要看得出有人试码）', () => {
    const idx = code.indexOf("router.post('/login/totp'")
    const body = code.slice(idx, idx + 4000)
    expect(body).toContain('AUDIT_ACTIONS.AUTH_TOTP_FAIL')
  })
})

describe('F. 关闭 2FA 必须同时验密码 + 验证码', () => {
  const code = stripComments(authSrc)

  it('两个校验都在', () => {
    const idx = code.indexOf("router.post('/2fa/disable'")
    expect(idx).toBeGreaterThan(-1)
    const body = code.slice(idx, idx + 1500)
    expect(body, '关闭时没验密码 —— 拿到 token 就能永久关掉第二因子').toMatch(/bcrypt\.compareSync/)
    expect(body, '关闭时没验验证码 —— 同上').toMatch(/verifyTotp\(/)
  })

  it('关闭后清掉 secret 与恢复码（不能留在库里）', () => {
    const idx = code.indexOf("router.post('/2fa/disable'")
    const body = code.slice(idx, idx + 1800)
    expect(body).toContain('totp_secret = NULL')
    expect(body).toContain('DELETE FROM totp_recovery_codes')
  })
})

describe('G. 启用流程与恢复码存储', () => {
  const code = stripComments(authSrc)

  it('setup 生成密钥但**不启用**（totp_enabled 仍写 0）', () => {
    const idx = code.indexOf("router.post('/2fa/setup'")
    const body = code.slice(idx, idx + 1200)
    expect(body).toMatch(/totp_enabled\s*=\s*0/)
  })

  it('enable 必须先验一次验证码（证明 App 里真的加上了）', () => {
    const idx = code.indexOf("router.post('/2fa/enable'")
    const body = code.slice(idx, idx + 1500)
    expect(body).toMatch(/verifyTotp\(/)
    expect(body).toContain('totp_enabled = 1')
  })

  it('恢复码只存哈希（表里没有明文列）', () => {
    expect(dbSrc).toMatch(/code_hash TEXT NOT NULL/)
    expect(dbSrc, '恢复码表出现了明文列').not.toMatch(/CREATE TABLE IF NOT EXISTS totp_recovery_codes[\s\S]{0,500}\bcode TEXT/)
  })

  it('恢复码用过标记 used_at、不删除（审计要看得出用过哪几张）', () => {
    const idx = code.indexOf("router.post('/login/totp'")
    const body = code.slice(idx, idx + 4000)
    expect(body).toContain('used_at')
    expect(body).toMatch(/UPDATE totp_recovery_codes SET used_at/)
  })
})

describe('H. 管理侧', () => {
  it('重置他人 2FA 只给 admin，且有审计', () => {
    const idx = usersSrc.indexOf("router.post('/:id/reset-2fa'")
    expect(idx, '找不到 reset-2fa 端点').toBeGreaterThan(-1)
    const decl = usersSrc.slice(idx, usersSrc.indexOf('\n', idx))
    expect(decl).toContain('authenticate')
    expect(decl).toContain('requireAdmin')
    const body = usersSrc.slice(idx, idx + 1800)
    expect(body).toContain('AUDIT_ACTIONS.AUTH_TOTP_RESET')
  })

  it('用户列表只带 totp_enabled，⛔ 不带 totp_secret', () => {
    const m = usersSrc.match(/let sql = `SELECT ([^`]*) FROM users/)
    expect(m, '找不到用户列表的 SELECT').toBeTruthy()
    expect(m[1]).toContain('totp_enabled')
    expect(m[1], '用户列表把 totp_secret 查出来了 —— 它不该离开后端').not.toContain('totp_secret')
  })

  it('审计查询接口组级挂 admin', () => {
    const code = stripComments(auditRouteSrc)
    expect(code).toMatch(/router\.use\(authenticate,\s*requireAdmin\)/)
  })

  it('审计分页有上限（防止一次拖走整张增长中的表）', () => {
    expect(auditRouteSrc).toMatch(/MAX_PAGE_SIZE\s*=\s*200/)
  })
})

/**
 * F. 2FA 设置仅管理员可用 —— v1.13.327
 *
 * 起因（业主 2026-11-07）：「非管理员账户的个人中心页面里为什么会出现『两步验证』提示？」
 * 321 把 TwoFactorCard 无条件渲染在 /account，卡片文案却是「保护**管理后台**最有效的一道防线」
 * ⇒ 普通客户看到会困惑。产品口径确认为：2FA 只用于保护管理后台。
 *
 * 这三条一起改才成立，缺一条都会露出口子：
 *   ① 前端卡片只给管理员渲染（普通用户根本看不到入口）
 *   ② 4 个设置端点 requireAdmin（绕过前端直接调也拿不到）
 *   ③ 登录链路 2 个端点**不得**加 requireAdmin（登录前没有身份，加了会锁死所有 2FA 账号）
 */
describe('F. 2FA 设置仅管理员可用', () => {
  const code = stripComments(authSrc)
  const accountVue = fs.readFileSync(
    path.resolve(HERE, '..', '..', 'frontend', 'src', 'views', 'MyAccountView.vue'),
    'utf8'
  )

  it('4 个 2FA 设置端点都挂了 requireAdmin', () => {
    const expected = [
      "router.get('/2fa/status', authenticate, requireAdmin",
      "router.post('/2fa/setup', authenticate, requireAdmin",
      "router.post('/2fa/enable', authenticate, requireAdmin",
      "router.post('/2fa/disable', authenticate, requireAdmin",
    ]
    for (const line of expected) {
      expect(code, `缺少 requireAdmin：${line.split(',')[0]}`).toContain(line)
    }
  })

  it('🔴 登录链路的 2 个端点⛔不得加 requireAdmin（会锁死所有已开 2FA 的账号）', () => {
    for (const p of ["'/login'", "'/login/totp'"]) {
      const m = code.match(new RegExp(`router\\.post\\(\\s*${p}[^\\n]*`))
      expect(m, `找不到 ${p}`).toBeTruthy()
      expect(m[0], `${p} 不该要求管理员 —— 它俩在登录前调用，不可能有管理员身份`)
        .not.toContain('requireAdmin')
    }
  })

  it('前端个人中心的 TwoFactorCard 仅管理员渲染', () => {
    const m = accountVue.match(/<TwoFactorCard[^>]*/)
    expect(m, '找不到 TwoFactorCard 引用').toBeTruthy()
    expect(m[0], 'TwoFactorCard 没有角色判断 —— 普通客户会看到「保护管理后台」这张卡')
      .toMatch(/v-if="[^"]*isAdmin/)
  })
})
