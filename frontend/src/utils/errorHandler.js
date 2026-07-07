/**
 * 通用错误处理工具
 * 统一处理 API 错误，区分错误类型，显示友好提示
 */
import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * 判断错误类型
 */
function getErrorType(error) {
  if (!error) return 'unknown'
  // 网络错误：fetch 超时、断网
  if (error instanceof TypeError && (error.message.includes('NetworkError') || error.message.includes('Failed to fetch') || error.message.includes('网络'))) {
    return 'network'
  }
  // 超时
  if (error.name === 'AbortError' || error.message?.includes('abort') || error.message?.includes('timeout')) {
    return 'timeout'
  }
  // HTTP 错误（通过 status 判断）
  if (error.status) {
    if (error.status >= 500) return 'server'
    if (error.status === 404) return 'notfound'
    if (error.status === 401 || error.status === 403) return 'auth'
    if (error.status >= 400) return 'client'
  }
  return 'unknown'
}

/**
 * 获取错误类型对应的友好提示
 */
function getErrorMessage(type, context = '') {
  const prefix = context ? `${context} ` : ''
  const messages = {
    network: `${prefix}网络连接异常，请检查网络后重试`,
    timeout: `${prefix}请求超时，请稍后重试`,
    server: `${prefix}服务器繁忙，请稍后重试`,
    notfound: `${prefix}请求的资源不存在`,
    auth: `${prefix}权限不足，请重新登录`,
    client: `${prefix}请求参数有误`,
    unknown: `${prefix}操作失败，请稍后重试`
  }
  return messages[type] || messages.unknown
}

/**
 * 处理 API 错误
 * @param {Error|Object} error - 错误对象
 * @param {Object} options - 配置
 * @param {string} options.context - 错误上下文描述（如"加载门店数据"）
 * @param {Function} options.onRetry - 重试回调
 * @param {boolean} options.showRetry - 是否显示重试按钮（默认 true）
 * @param {boolean} options.silent - 静默模式，不显示任何提示
 */
export function handleApiError(error, options = {}) {
  const { context = '', onRetry, showRetry = true, silent = false } = options

  const type = getErrorType(error)
  const message = getErrorMessage(type, context)

  if (!silent) {
    if (showRetry && onRetry) {
      ElMessageBox.confirm(`${message}，是否重试？`, '操作失败', {
        confirmButtonText: '重试',
        cancelButtonText: '取消',
        type: 'warning'
      }).then(() => {
        onRetry()
      }).catch(() => {
        // 用户取消，不做处理
      })
    } else {
      ElMessage.error(message)
    }
  }

  // 返回错误类型便于调用方做额外处理
  return { type, message }
}

/**
 * 简化的错误提示（不带重试）
 */
export function showError(context = '操作失败') {
  return (error) => {
    handleApiError(error, { context, showRetry: false })
  }
}

export default { handleApiError, showError }
