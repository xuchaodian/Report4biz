import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config.js'
import { getDb } from '../models/database.js'
import { verifyTokenPayload, SESSION_EXPIRED_MESSAGE } from '../utils/tokenAuth.js'

// 验证Token中间件
//
// v1.13.150：签名校验（无状态）之后追加**服务端撤销校验**（有状态，见 utils/tokenAuth.js）：
//   ① jti 是否已被登出拉黑   ② payload.tv 是否等于 users.token_version
// 任一不过 ⇒ 401（前端 api 拦截器会清 token 并跳登录页）。
// ⚠️ 兼容：无 jti / 无 tv 的老 token 一律放行，避免上线瞬间全员掉线。
export function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: '请先登录' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, JWT_SECRET)

    const chk = verifyTokenPayload(decoded, getDb())
    if (!chk.ok) {
      // 只在服务端留痕，对外不区分原因（revoked / stale 都回同一句）
      if (chk.reason === 'revoked' || chk.reason === 'stale') {
        console.warn(`[auth] token 已被撤销(${chk.reason}): user=${decoded?.id}`)
      }
      return res.status(401).json({ message: SESSION_EXPIRED_MESSAGE })
    }

    req.user = decoded
    next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token无效或已过期' })
    }
    return res.status(500).json({ message: '认证失败' })
  }
}

// 验证管理员权限中间件
export function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: '需要管理员权限' })
  }
  next()
}
