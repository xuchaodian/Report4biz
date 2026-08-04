# MapView.vue 内存泄漏分析报告

## 🔍 发现的问题

### 1. 全局事件监听器未移除
**严重程度**: 🔴 **高危**
**位置**: 第7800行
```javascript
window.addEventListener('resize', () => { ... })
```
**问题**: 全局 window 事件监听器在组件卸载时未移除，会导致重复添加监听器

### 2. 拖拽事件监听器管理
**严重程度**: 🟡 **中危**
**位置**: 第6378-6379行、第6402-6403行
```javascript
document.addEventListener('mousemove', onDragMove)
document.addEventListener('mouseup', onDragEnd)
```
**问题**: 虽然在第6389-6391行、第6414-6415行有移除，但可能存在异常情况导致未移除

### 3. 定时器清理不完全
**严重程度**: 🟡 **中危**
**位置**: 多个 setTimeout 调用
**问题**: 部分 setTimeout 在异步操作中被创建，但清理逻辑可能不完整

### 4. DOM 元素事件监听器
**严重程度**: 🟢 **低危**
**位置**: 第7113行
```javascript
completeBtnElement.addEventListener('click', (e) => { ... })
```
**问题**: 动态创建的 DOM 元素事件监听器需要手动清理

## 🛠️ 修复方案

### 方案1：使用 Vue 3 的生命周期钩子
```javascript
import { onUnmounted } from 'vue'

// 在 setup 中
onUnmounted(() => {
  // 清理所有定时器和事件监听器
})
```

### 方案2：使用 ref 存储定时器引用
```javascript
const timers = ref([])

// 创建定时器时
const timer = setTimeout(() => { ... }, 1000)
timers.value.push(timer)

// 清理时
onUnmounted(() => {
  timers.value.forEach(timer => clearTimeout(timer))
  timers.value = []
})
```

### 方案3：封装安全的定时器工具
```javascript
// utils/safe-timer.js
export function createSafeTimer(callback, delay, onCleanup) {
  const timer = setTimeout(() => {
    callback()
    if (onCleanup) onCleanup()
  }, delay)
  
  return {
    clear: () => {
      clearTimeout(timer)
      if (onCleanup) onCleanup()
    }
  }
}
```

## 📋 具体修复步骤

### 第1步：添加组件卸载清理钩子
在 MapView.vue 的 `<script setup>` 顶部添加：

```javascript
import { onUnmounted } from 'vue'

// 存储需要清理的资源
const cleanupResources = {
  timers: [],
  eventListeners: [],
  abortControllers: []
}
```

### 第2步：修复全局 resize 事件监听器
将第7800行的全局监听改为组件作用域：

```javascript
// 替换第7800-7804行
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

### 第3步：增强拖拽事件清理
确保拖拽事件在任何情况下都能正确清理：

```javascript
const cleanupDragEvents = () => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.removeEventListener('mousemove', onLegendDragMove)
  document.removeEventListener('mouseup', onLegendDragEnd)
}

onUnmounted(() => {
  cleanupDragEvents()
})
```

### 第4步：修复动态 DOM 元素事件监听器
对第7113行的动态监听器添加清理：

```javascript
let completeBtnClickHandler = null

// 在创建按钮时
completeBtnClickHandler = (e) => {
  console.log('[Polygon Search] 按钮被点击')
  e.stopPropagation()
  e.preventDefault()
  finishPolygonSearch()
}
completeBtnElement.addEventListener('click', completeBtnClickHandler)

// 在清理时
if (completeBtnClickHandler && completeBtnElement) {
  completeBtnElement.removeEventListener('click', completeBtnClickHandler)
}
```

## 🧪 测试验证方案

### 手动测试
1. 多次进入/离开 MapView 页面
2. 使用 Chrome DevTools Memory 标签页检查内存增长
3. 使用 Performance Monitor 观察事件监听器数量

### 自动化测试建议
```javascript
// 测试用例示例
describe('Memory leak prevention', () => {
  it('should clean up all event listeners on unmount', () => {
    const wrapper = mount(MapView)
    const initialListeners = getEventListenersCount()
    
    wrapper.unmount()
    const finalListeners = getEventListenersCount()
    
    expect(finalListeners).toBeLessThanOrEqual(initialListeners)
  })
})
```

## 📊 性能监控指标

修复后应监控以下指标：
1. **内存使用量**: 页面长时间运行后的内存增长
2. **事件监听器数量**: 进入/离开页面后的变化
3. **定时器数量**: 确保没有残留的定时器
4. **页面响应速度**: 避免内存泄漏导致的性能下降

## ⏱️ 实施时间估计

**阶段1（紧急修复）**: 2小时
- 添加 onUnmounted 清理钩子
- 修复全局 resize 事件监听器

**阶段2（全面检查）**: 4小时
- 检查所有定时器清理
- 修复拖拽事件管理
- 修复动态 DOM 事件监听器

**阶段3（预防措施）**: 3小时
- 封装安全工具函数
- 添加开发环境警告
- 编写测试用例