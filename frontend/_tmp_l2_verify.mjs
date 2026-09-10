import * as echarts from 'echarts/core'
import { PieChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { LabelLayout } from 'echarts/features'
import { SVGRenderer } from 'echarts/renderers'

// 与 DashboardView.vue 的注册完全一致（外加 SSR 渲染所需的 SVGRenderer）
echarts.use([PieChart, BarChart, GridComponent, TooltipComponent, LegendComponent, LabelLayout, SVGRenderer])

const warns = []
const origWarn = console.warn
console.warn = (...a) => { warns.push(a.join(' ')) }

function test(name, option) {
  warns.length = 0
  try {
    const c = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 })
    c.setOption(option)
    const svg = c.renderToSVGString()
    const ok = svg.includes('<svg') && svg.length > 800
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  (svg ' + svg.length + ' bytes)' + (warns.length ? '  warns=' + warns.length : ''))
    if (warns.length) warns.slice(0, 2).forEach(w => console.log('       warn: ' + w.slice(0, 140)))
    return ok
  } catch (e) {
    console.log('ERROR ' + name + ': ' + e.message)
    return false
  }
}

let all = true
// 1. DashboardView 图表1：门店类型分布（饼图）
all = test('pie 门店类型分布', {
  backgroundColor: 'transparent',
  tooltip: { trigger: 'item' },
  legend: { bottom: 0, itemWidth: 10, itemHeight: 10 },
  series: [{ type: 'pie', radius: ['35%', '65%'], center: ['50%', '45%'],
    itemStyle: { borderRadius: 4 }, data: [{ name: '直营', value: 12 }, { name: '加盟', value: 30 }] }]
}) && all
// 2. DashboardView 图表2：门店城市 TOP10（横向柱状 + graphic.LinearGradient）
all = test('bar 城市TOP10(LinearGradient)', {
  backgroundColor: 'transparent',
  grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'value' },
  yAxis: { type: 'category', data: ['上海', '北京', '广州', '深圳'] },
  series: [{ type: 'bar', data: [30, 25, 20, 15], barWidth: 14,
    itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#1a4f8f' }, { offset: 1, color: '#40c4ff' }]), borderRadius: [0, 4, 4, 0] },
    label: { show: true, position: 'right' } }]
}) && all
// 3. DashboardView 图表3：竞品品牌 TOP10
all = test('bar 竞品品牌TOP10', {
  backgroundColor: 'transparent',
  grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'value' },
  yAxis: { type: 'category', data: ['老乡鸡', '大米先生', '米村拌饭'] },
  series: [{ type: 'bar', data: [40, 30, 20], barWidth: 12,
    itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#7a2d63' }, { offset: 1, color: '#ff6b6b' }]) } }]
}) && all

console.log('')
console.log('graphic.LinearGradient 可用: ' + (typeof (echarts.graphic && echarts.graphic.LinearGradient) === 'function'))
console.log('init 可用: ' + (typeof echarts.init === 'function'))
console.log(all ? '\n=== L2 全部通过 ===' : '\n=== L2 存在失败 ===')
console.warn = origWarn
