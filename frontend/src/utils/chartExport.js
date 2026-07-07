/**
 * 图表工具函数
 * 导出 ECharts 图表为图片、截图等
 */

/**
 * 导出 ECharts 图表为 PNG 图片
 * @param {Object} chartInstance - ECharts 实例
 * @param {string} filename - 文件名（不含后缀）
 */
export function exportChartImage(chartInstance, filename = 'chart') {
  if (!chartInstance) return
  const url = chartInstance.getDataURL({
    type: 'png',
    pixelRatio: 2,
    backgroundColor: '#fff'
  })
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.png`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * 批量导出多个 ECharts 图表为图片
 * @param {Array<{instance: Object, name: string}>} charts
 */
export function exportChartsAsZip(charts) {
  charts.forEach(({ instance, name }) => {
    exportChartImage(instance, name)
  })
}

export default { exportChartImage, exportChartsAsZip }
