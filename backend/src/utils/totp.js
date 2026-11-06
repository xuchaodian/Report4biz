/**
 * TOTP（RFC 6238）—— 零依赖实现（v1.13.321）
 *
 * 为什么自己写而不装库：本项目**刻意零额外依赖**（registerGuard.js 头注有说明），
 * 且 TOTP 算法本身只有 ~80 行（HMAC-SHA1 + 动态截断），Node 内置 crypto 足够。
 * 装一个 otpauth 库反而多一个供应链面 —— 对这个功能来说不划算。
 *
 * 兼容性：Google Authenticator / 微软 Authenticator / 1Password / Authy 全部支持
 * 标准 6 位、30 秒、SHA1（这也是 RFC 默认值，各家默认期望值）。
 *
 * ⚠️ 三个容易写错的地方（本文件已在实现里处理，改动时留意）：
 *   ① base32 **不带 padding**，用户手输时要容忍空格/小写/漏掉的 '='
 *   ② 计数器是**8 字节大端**，不是 4 字节（4 字节会在 2038 年后溢出，且部分 App 不认）
 *   ③ 动态截断取 offset 的**低 4 位**，并且要与 0x7fffffff 相与（去掉符号位）
 */
import crypto from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const DIGITS = 6
const PERIOD_SECONDS = 30
/** 允许前后各 1 个时间步（±30s），抵消手机与服务器的时间漂移 */
const DEFAULT_WINDOW = 1

/** 随机密钥（20 字节 = 160 bit，RFC 4226 推荐长度）→ base32，无 padding */
export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes))
}

export function base32Encode(buf) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/**
 * base32 → Buffer。
 * ⚠️ 必须容忍用户的输入习惯：小写、空格、连字符、尾部 '='（Authenticator 显示的格式各异）。
 */
export function base32Decode(str) {
  const clean = String(str || '')
    .toUpperCase()
    .replace(/[\s\-=]/g, '')
  let bits = 0
  let value = 0
  const out = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error('密钥包含非 base32 字符')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** HOTP：counter 为 8 字节大端 */
export function hotp(secretBuf, counter, digits = DIGITS) {
  const buf = Buffer.alloc(8)
  // ③ 8 字节大端；用 BigInt 避免 > 2^32 时的精度问题
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return String(code % 10 ** digits).padStart(digits, '0')
}

/** 当前时间步 */
export function currentCounter(now = Date.now(), period = PERIOD_SECONDS) {
  return Math.floor(now / 1000 / period)
}

/**
 * 校验用户输入的 6 位码。
 *
 * @param {string} code    用户输入（容许空格/连字符）
 * @param {string} secret  base32 密钥
 * @param {object} [opts]
 * @param {number} [opts.window]  前后容忍的时间步数，默认 1（±30s）
 * @param {number} [opts.now]     指定时间（测试用）
 * @returns {boolean}
 */
export function verifyTotp(code, secret, opts = {}) {
  try {
    const { window = DEFAULT_WINDOW, now = Date.now() } = opts
    const input = String(code || '').replace(/[\s-]/g, '')
    if (!/^\d{6}$/.test(input)) return false
    const secretBuf = base32Decode(secret)
    if (!secretBuf.length) return false

    const counter = currentCounter(now)
    // 🔴 必须做**常量时间**比较：普通 === 会因提前返回泄露"前几位对上了"
    //   （虽然 TOTP 6 位空间很小、实际风险有限，但这是免费的正确性）
    for (let d = -window; d <= window; d++) {
      const expected = hotp(secretBuf, counter + d)
      if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input))) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * 生成 otpauth:// URI，供 Authenticator 扫码或手动添加。
 * ⚠️ 本版**不生成二维码图片**（项目无 QR 依赖）。前端展示密钥 + URI，
 *    用户在 App 里选「手动输入密钥」即可 —— 零依赖且不泄露给第三方。
 */
export function otpauthUri(secret, account, issuer = '选址赢家Online') {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** 恢复码：10 位、去掉易混字符（0/O/1/I/l），分组显示便于抄写 */
export function generateRecoveryCodes(count = 8) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const codes = []
  for (let i = 0; i < count; i++) {
    let s = ''
    const bytes = crypto.randomBytes(10)
    for (let j = 0; j < 10; j++) s += alphabet[bytes[j] % alphabet.length]
    codes.push(s)
  }
  return codes
}

/** 恢复码入库前哈希（与密码同思路：即使库泄露也不能直接拿去登录） */
export function hashRecoveryCode(code) {
  return crypto
    .createHash('sha256')
    .update(String(code || '').toUpperCase().replace(/[\s-]/g, ''))
    .digest('hex')
}

/** 归一化用户输入的恢复码（大小写、空格、连字符） */
export function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[\s-]/g, '')
}
