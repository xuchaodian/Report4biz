/**
 * ECharts 按需导入配置
 * 只导入实际使用的图表类型和组件，减少打包体积
 *
 * 🔴 铁律（v1.13.347）：这份 `use([...])` 就是**唯一注册表**。
 *    echarts 5 对未注册的类型/坐标系**不抛错、不白屏**，只在控制台 warn 后静默不画，
 *    所以漏一个的后果是「图框空着、数字正常」，几乎不会有人报障。历史两次踩坑：
 *      1. 竞品雷达两图（radar 系列 + radar 坐标系 + polar 坐标系）空白了多个版本；
 *      2. 门店对比图的均值虚线（MarkLine 组件）从未画出来过。
 *    ⇒ 新增任何图表/坐标系/标注前，先看 `frontend/src/**` 里用了什么，登记到这里，
 *      然后跑 `backend/tests/echartsRegistrationGuard.test.js`（它会扫全站用法比对本表）。
 *    ⛔ 不许为了"减体积"删这里的项 —— 删了不会报错，只会静默空白。
 */
import { init, dispose, use, graphic } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart, PieChart, RadarChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  RadarComponent,
  PolarComponent,
  MarkLineComponent
} from 'echarts/components'

// 注册使用的渲染器和组件
use([
  CanvasRenderer,
  BarChart,
  LineChart,
  PieChart,
  RadarChart,        // 竞品雷达「品牌构成」系列
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  RadarComponent,    // 竞品雷达的极坐标雷达框（indicator / axisName）
  PolarComponent,    // 竞品雷达「8 方向分布」玫瑰图（polar + angleAxis / radiusAxis）
  MarkLineComponent  // 门店对比图的平均值虚线
])

// 导出与全量 echarts 兼容的 API
export default {
  init,
  dispose,
  graphic,  // 渐变等图形工具（LinearGradient 等）
  // 保持与现有代码的兼容性
  // setOption 通过实例调用
}
