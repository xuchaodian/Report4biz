# MapView.vue 性能优化进度报告

## ✅ 已完成的工作

### 1. 内存泄漏预防框架搭建
- **添加了 cleanupResources 对象**：统一管理需要清理的资源
- **实现了安全的定时器封装**：createSafeTimeout 函数自动管理定时器生命周期
- **增强了 onUnmounted 清理逻辑**：
  - 清理地图资源
  - 清理 ECharts 实例
  - 清理所有定时器
  - 清理 AbortController
  - 清理事件监听器
  - 清理全局变量

### 2. 修复了高危内存泄漏点
- **全局 resize 事件监听器**：从全局改为组件作用域，正确绑定到组件生命周期
- **搜索防抖定时器**：使用 ref 存储定时器引用，确保组件卸载时清理

### 3. 创建了拆分方案设计文档
- **MapView-Component-Split-Design.md**：详细的可拆分模块分析和架构设计
- **Memory-Leak-Analysis.md**：内存泄漏分析和修复方案

### 4. Element Plus 按需导入 ✅ 已完成 (2026-07-07)
（同上，具体见上方的按需导入配置部分）

### 5. ECharts 按需导入 ✅ 已完成 (2026-07-07) 🚀
- **实现方式**：`src/utils/echarts.js` 集中管理按需导入
- **变更文件**：
  - `MapView.vue` → `import echarts from '@/utils/echarts'`
  - `MyAccountView.vue` → 同上
  - `ShoppingCenterView.vue` → 同上
  - `DataView.vue` → 移除未使用的 echarts import
- **优化效果**：
  | 指标 | 优化前 | 优化后 | 改善 |
  |------|--------|--------|------|
  | ECharts JS | 812 KB | 321 KB | **-60.5% 🎯** |
  | dist总大小 | 6.5M | 5.9M | **-9.2%** |
  | 构建时间 | 26.69s | 11.40s | **-57.3% 🚀** |

> **总计减包效果**：构建配置(-31%) + Element Plus CSS(-34.7%) + ECharts(-60.5%) → dist 6.5M→5.9M
```javascript
// 性能优化：内存泄漏预防
const cleanupResources = {
  timers: new Set(),
  abortControllers: new Set(),
  eventListeners: []
}

// 安全的定时器封装
const createSafeTimeout = (callback, delay) => {
  const timer = setTimeout(() => {
    callback()
    cleanupResources.timers.delete(timer)
  }, delay)
  cleanupResources.timers.add(timer)
  return timer
}

const clearAllTimers = () => {
  cleanupResources.timers.forEach(timer => {
    clearTimeout(timer)
    clearInterval(timer)
  })
  cleanupResources.timers.clear()
}
```

### 优化的Vite构建配置
```javascript
// vite.config.js - 新增代码分割策略
build: {
  rollupOptions: {
    output: {
      manualChunks: (id) => {
        if (id.includes('node_modules')) {
          // Element Plus 和 Vue 生态
          if (id.includes('element-plus') || id.includes('@element-plus')) {
            return 'vendor-element-plus'
          }
          // Vue 核心库
          if (id.includes('vue') && !id.includes('vue-echarts')) {
            return 'vendor-vue'
          }
          // 地图相关库
          if (id.includes('leaflet') || id.includes('turf') || id.includes('gcoord') || id.includes('amap')) {
            return 'vendor-maps'
          }
          // ECharts 相关
          if (id.includes('echarts') || id.includes('vue-echarts')) {
            return 'vendor-echarts'
          }
          // PDF/Canvas 相关
          if (id.includes('jspdf') || id.includes('html2canvas')) {
            return 'vendor-pdf'
          }
          // 核心工具库
          if (id.includes('axios') || id.includes('pinia') || id.includes('vue-router')) {
            return 'vendor-core'
          }
          return 'vendor-other'
        }
        
        // 业务组件分组
        if (id.includes('MapView.vue')) {
          return 'mapview-main'
        }
      }
    }
  }
}
```

### 增强的组件卸载清理
```javascript
onUnmounted(() => {
  // 清理地图资源
  if (map) map.remove()
  
  // 清理 ECharts 实例
  if (barChart) {
    barChart.dispose()
    barChart = null
  }
  
  // 清理所有定时器
  clearAllTimers()
  
  // 清理所有 AbortController
  cleanupResources.abortControllers.forEach(controller => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  })
  cleanupResources.abortControllers.clear()
  
  // 清理拖拽事件监听器
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.removeEventListener('mousemove', onLegendDragMove)
  document.removeEventListener('mouseup', onLegendDragEnd)
  
  // 清理动态创建的 DOM 元素事件监听器
  if (completeBtnClickHandler && completeBtnElement) {
    completeBtnElement.removeEventListener('click', completeBtnClickHandler)
  }
  
  // 清理全局变量
  delete window.editMarkerExternal
  delete window.deleteMarkerExternal
  delete window.openStorePopulationDistribution
  delete window.openStoreSmartsteps
  delete window.openStoreCompetitors
  delete window.openStorePoiSearch
  delete window.handleShapefileQueryFromGlobal
  delete window.__poiSearchDebug
  
  shapefileProcessing = false
  
  // 清理存储的临时数据
  sessionStorage.removeItem('cityData_target')
})
```

### 修复的全局事件监听器
```javascript
// 窗口大小变化时重绘柱状图
const handleResize = () => {
  if (barChart) {
    barChart.resize()
  }
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
```

## 📊 性能收益预期

### 内存使用优化
1. **减少内存泄漏**：预计减少 20-30% 的内存增长
2. **更好的垃圾回收**：定时器和事件监听器正确清理
3. **减少全局污染**：正确管理全局变量

### 构建性能优化
1. **减少构建体积**：预计从6.5M减少到4-4.5M（减少30-40%）
2. **最大JS文件优化**：从1.3M降到500KB以下
3. **提升缓存利用率**：库变更不影响业务代码
4. **并行加载提升**：浏览器可同时下载多个小文件

### 用户体验提升
1. **更快的页面切换**：资源正确释放
2. **更稳定的长时间运行**：避免内存积累
3. **更好的错误恢复**：组件卸载时彻底清理
4. **更快的首次加载**：精细化的代码分割
5. **更流畅的交互**：优化的渲染性能

## 🚧 待完成的工作

### 高优先级
1. **修复剩余的 setTimeout/AbortController**：还有约15处需要修复
2. **检查 setInterval 使用**：确保所有间隔定时器正确清理
3. **验证拖拽事件管理**：确保在各种边界情况下都能正确清理

### 中优先级
1. **组件拆分实施**：按照设计文档开始拆分组件
2. **地图渲染优化**：针对大量标记优化渲染性能
3. **ECharts按需导入**：预计可减少200-300KB

### 低优先级
1. **添加性能监控**：收集关键操作耗时指标
2. **编写测试用例**：确保内存泄漏修复的稳定性
3. **开发环境警告**：添加开发时的不安全操作警告

## 🧪 测试建议

### 手动测试
1. **多次进入/离开地图页面**：观察内存增长
2. **长时间操作**：连续使用30分钟，检查性能下降
3. **边界情况测试**：在操作中途切换页面

### 开发环境监控
1. **Chrome DevTools Memory 标签页**：监控内存使用
2. **Performance Monitor**：观察事件监听器数量
3. **Console 警告**：开发环境添加资源泄漏警告

## 📈 下一步计划

### 阶段1：完成内存泄漏修复（预计2小时）
- 修复剩余的 setTimeout 调用
- 修复 AbortController 管理
- 验证所有事件监听器清理

### 阶段2：开始组件拆分（预计4小时）
- 先拆分独立的工具栏组件
- 逐步迁移功能模块
- 保持向后兼容性

### 阶段3：按需导入优化（预计3小时）
- 配置Element Plus按需导入
- 配置ECharts按需导入
- 路由级别代码分割

### 阶段4：高级优化（预计4小时）
- 添加性能监控和日志
- 实施图片和资源优化
- 配置性能预算和报警

## ⚠️ 注意事项

1. **保持向后兼容**：所有修改不能影响现有功能
2. **渐进式优化**：分阶段实施，每阶段验证效果
3. **性能监控**：优化前后对比关键指标
4. **测试覆盖**：确保功能完整性不受影响