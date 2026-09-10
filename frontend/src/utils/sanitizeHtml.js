// HTML 消毒工具（v1.13.105 S-H3）
// 用法：v-html 渲染任何可能含外部数据（联通 result_data / Excel 导入单元格 / 上游 tag / 门店名等）的 HTML
// 前，统一过 sanitizeHtml 剥离 <script>/on*/javascript: 等，保留表格/样式等展示所需标签。
// 覆盖：SharedPurchaseView / StoreSmartstepsDialog(×2) / MyAccountView / SmartstepsPanel 的 format* v-html 输出。
import DOMPurify from 'dompurify'

export function sanitizeHtml(html) {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: [] // 不额外放行任何属性
  })
}

export default sanitizeHtml
