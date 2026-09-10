// HTML 转义（v1.13.105 S-H3）：把动态文本安全插入 HTML 字符串前调用，防止存储型 XSS。
export function escapeHtml(v) {
  if (v === null || v === undefined) return ''
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default escapeHtml
