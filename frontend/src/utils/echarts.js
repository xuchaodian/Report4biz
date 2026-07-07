/**
 * ECharts 按需导入配置
 * 只导入实际使用的图表类型和组件，减少打包体积
 */
import { init, dispose, use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, PieChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
} from 'echarts/components'

// 注册使用的渲染器和组件
use([CanvasRenderer, BarChart, PieChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent])

// 导出与全量 echarts 兼容的 API
export default {
  init,
  dispose,
  // 保持与现有代码的兼容性
  // setOption 通过实例调用
}
