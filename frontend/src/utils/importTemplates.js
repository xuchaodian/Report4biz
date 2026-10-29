/**
 * 导入模板下载（v1.13.292）
 *
 * 从 `/data` 的两处弹窗里抽出来，给体检页与销售预测页复用 ——
 * 这三处以前各写一遍下载逻辑，门店模板的列名还各存了一份字符串。
 *
 * ⚠️ 与 `utils/importSpecs.js` 分工：那边是**零依赖的纯数据**（守卫测试要在 Node 里 import），
 *    这边才允许碰 Blob / fetch / authHeaders 这些浏览器能力。
 *
 * 🔴 销售模板由后端 `GET /api/store-sales/template` 生成（带示例行、列宽），
 *    前端只负责下载，⛔ 不要在前端另造一份 xlsx —— 否则后端改了列、前端还是旧模板。
 */
import { authHeaders } from './authHeaders.js'
import { buildStoreTemplateCsv } from './importSpecs.js'

/** 门店台账模板（CSV，前端生成，含 BOM 以便 Excel 正确识别 UTF-8） */
export function downloadStoreTemplate() {
  const csv = buildStoreTemplateCsv()
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'store_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 销售记录模板（xlsx，后端生成）
 * @returns {Promise<boolean>} 成功返回 true；失败返回 false（调用方负责提示，别在这里弹 ElMessage）
 */
export async function downloadSalesTemplate() {
  try {
    const res = await fetch('/api/store-sales/template', { headers: authHeaders() })
    if (!res.ok) return false
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sales-import-template.xlsx'
    a.click()
    URL.revokeObjectURL(url)
    return true
  } catch (e) {
    return false
  }
}
