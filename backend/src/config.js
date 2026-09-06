// 统一配置加载模块
// 1) 若存在 backend/.env，则将其加载进 process.env（极简解析，无第三方依赖）
// 2) 解析安全的 JWT_SECRET：优先取环境变量；否则读取/生成一个持久化的随机密钥
//    （存放在 .gitignore 已忽略的 .jwt_secret 文件里，避免公开默认值，同时保证重启后 token 不失效）
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const backendRoot = path.join(__dirname, '..')

// ---- 轻量 .env 加载 ----
function loadEnvFile() {
  const envPath = path.join(backendRoot, '.env')
  if (!fs.existsSync(envPath)) return
  try {
    const content = fs.readFileSync(envPath, 'utf-8')
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      // 去掉成对引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
  } catch (e) {
    console.error('[config] 读取 .env 失败:', e.message)
  }
}
loadEnvFile()

// ---- JWT_SECRET 解析 ----
const secretFile = path.join(backendRoot, '.jwt_secret')

function getJwtSecret() {
  // 1) 环境变量优先
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return process.env.JWT_SECRET
  }

  // 2) 读取持久化随机密钥
  try {
    if (fs.existsSync(secretFile)) {
      const s = fs.readFileSync(secretFile, 'utf-8').trim()
      if (s && s.length >= 32) return s
    }
  } catch (e) { /* 忽略读取错误 */ }

  // 3) 生成并持久化一个随机密钥
  const secret = crypto.randomBytes(48).toString('hex')
  try {
    fs.writeFileSync(secretFile, secret, { mode: 0o600 })
  } catch (e) {
    console.error('[config] 无法持久化 JWT 密钥，将使用一次性随机密钥（重启后 token 失效）:', e.message)
  }
  return secret
}

const JWT_SECRET = getJwtSecret()

// ---- 第三方服务密钥（统一从环境变量 / backend/.env 读取，禁止在源码写死） ----
// 若缺失，对应服务调用会失效并在调用处给出明确提示（由各使用方判断是否容忍）。
// 生产环境务必通过系统环境变量或 backend/.env 提供。
const AMAP_KEY = process.env.AMAP_KEY || ''
const TENCENT_LBS_KEY = process.env.TENCENT_LBS_KEY || ''
const ARK_API_KEY = process.env.ARK_API_KEY || ''
const SMARTSTEPS_API_KEY = process.env.SMARTSTEPS_API_KEY || ''
const PURCHASE_SHARE_SECRET = process.env.PURCHASE_SHARE_SECRET || 'Report4biz_share_2026'

// 启动时提示缺失的第三方密钥（不阻断启动，便于发现漏配）
const missingKeys = []
if (!AMAP_KEY) missingKeys.push('AMAP_KEY(高德)')
if (!TENCENT_LBS_KEY) missingKeys.push('TENCENT_LBS_KEY(腾讯位置)')
if (!ARK_API_KEY) missingKeys.push('ARK_API_KEY(豆包)')
if (!SMARTSTEPS_API_KEY) missingKeys.push('SMARTSTEPS_API_KEY(联通智慧足迹)')
if (missingKeys.length) {
  console.warn('[config] 未配置第三方密钥: ' + missingKeys.join(', ') + '。请在 backend/.env 或环境变量中配置，否则对应服务将不可用。')
}

export { JWT_SECRET, AMAP_KEY, TENCENT_LBS_KEY, ARK_API_KEY, SMARTSTEPS_API_KEY, PURCHASE_SHARE_SECRET }

