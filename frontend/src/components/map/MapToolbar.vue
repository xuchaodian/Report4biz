<template>
  <!-- 工具栏 - 右上角收起/展开 -->
  <div class="toolbar">
    <div class="toolbar-header" @click="$emit('update:expanded', !expanded)">
      <span class="toolbar-title">地图工具箱</span>
      <el-icon class="toolbar-arrow" :class="{ expanded: expanded }">
        <ArrowRight />
      </el-icon>
    </div>
    <div v-show="expanded" class="toolbar-body">
      <!-- 测量距离 -->
      <el-tooltip content="测量距离" placement="left">
        <div class="tool-item" :class="{ active: activeTool === 'measure' }" @click="$emit('set-tool', 'measure')">
          <el-icon><Odometer /></el-icon>
          <span>测量距离</span>
        </div>
      </el-tooltip>
      <!-- 测量面积 -->
      <el-tooltip content="测量面积" placement="left">
        <div class="tool-item" :class="{ active: activeTool === 'area' }" @click="$emit('set-tool', 'area')">
          <el-icon><Aim /></el-icon>
          <span>测量面积</span>
        </div>
      </el-tooltip>
      <!-- 城市商圈 -->
      <el-tooltip content="城市商圈" placement="left">
        <div class="tool-item" :class="{ active: cityTradeAreaLayerActive }" @click="$emit('open-city-trade-area')">
          <el-icon><MapLocation /></el-icon>
          <span>城市商圈</span>
        </div>
      </el-tooltip>
      <el-divider style="margin: 6px 0;" />
      <!-- 清除绘制 -->
      <el-tooltip content="清除绘制" placement="left">
        <div class="tool-item" @click="$emit('clear-drawings')">
          <el-icon><Delete /></el-icon>
          <span>清除绘制</span>
        </div>
      </el-tooltip>
    </div>
    <!-- 测量结果显示 -->
    <div v-if="measurementResult" class="measurement-result">
      {{ measurementResult }}
    </div>
  </div>
</template>

<script setup>
defineProps({
  expanded: {
    type: Boolean,
    default: false
  },
  activeTool: {
    type: String,
    default: ''
  },
  cityTradeAreaLayerActive: {
    type: Boolean,
    default: false
  },
  measurementResult: {
    type: String,
    default: ''
  }
})

defineEmits(['update:expanded', 'set-tool', 'open-city-trade-area', 'clear-drawings'])
</script>

<style scoped>
.toolbar {
  position: absolute;
  top: 10px;
  right: 15px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  overflow: hidden;
  border: 2px solid #409eff;
}

.toolbar-header {
  padding: 10px 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
}

.toolbar-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}

.toolbar-arrow {
  transition: transform 0.3s;
  font-size: 14px;
  color: #fff;
}

.toolbar-arrow.expanded {
  transform: rotate(90deg);
}

.toolbar-body {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: relative;
}

.tool-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  border: 1px solid transparent;
}

.tool-item :deep(.el-icon) {
  font-size: 16px;
  flex-shrink: 0;
}

.tool-item span {
  font-size: 12px;
  color: #333;
}

.tool-item:hover,
.tool-item.active {
  background: #ecf5ff;
  border-color: #409eff;
}

.tool-item.active span {
  color: #409eff;
}

.toolbar-body :deep(.el-divider) {
  margin: 4px 0;
}

.measurement-result {
  background: #ecf5ff;
  padding: 4px 10px;
  font-size: 12px;
  color: #409eff;
  font-weight: 500;
  text-align: center;
  border-top: 1px solid #eee;
}
</style>
