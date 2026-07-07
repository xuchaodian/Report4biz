<template>
  <div class="poi-search-panel">
    <div class="poi-search-header" @click="$emit('update:expanded', !expanded)">
      <span class="poi-search-title">周边检索</span>
      <span class="poi-search-arrow" :class="{ expanded }">▼</span>
    </div>
    <div v-show="expanded" class="poi-search-body">
        <div class="poi-search-input">
        <el-input
          :model-value="keyword"
          placeholder="输入关键词（如：咖啡厅、餐厅）"
          size="small"
          clearable
          @update:model-value="$emit('update:keyword', $event)"
        />
      </div>
      <div class="poi-search-modes">
        <div class="poi-mode-btn" @click="$emit('circle-search')">
          <el-icon><Location /></el-icon>
          <span>半径圆</span>
        </div>
        <div class="poi-mode-btn" @click="$emit('polygon-search')">
          <el-icon><Edit /></el-icon>
          <span>多边形</span>
        </div>
        <div class="poi-mode-btn" @click="$emit('clear-search')">
          <el-icon><Delete /></el-icon>
          <span>清除</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  expanded: Boolean,
  keyword: { type: String, default: '' }
})

defineEmits(['update:expanded', 'update:keyword', 'circle-search', 'polygon-search', 'clear-search'])
</script>

<style scoped>
/* 面板展开/收起过渡动画 */
@keyframes panelFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.poi-search-body {
  animation: panelFadeIn 0.2s ease;
}

.poi-search-panel {
  position: absolute;
  top: 10px;
  right: 150px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  min-width: 110px;
  max-width: 110px;
  overflow: hidden;
  border: 2px solid #409eff;
}

.poi-search-header {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
}

.poi-search-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}

.poi-search-arrow {
  margin-left: auto;
  font-size: 10px;
  color: #fff;
  transition: transform 0.2s;
  transform: rotate(-90deg);
}

.poi-search-arrow.expanded {
  transform: rotate(0deg);
}

.poi-search-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 100%;
  box-sizing: border-box;
}

.poi-search-input {
  width: 100%;
  max-width: 100px;
  box-sizing: border-box;
}

.poi-search-input :deep(.el-input__inner) {
  border-color: #409eff;
  width: 100%;
}

.poi-search-modes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.poi-mode-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  font-size: 12px;
  cursor: pointer;
  box-sizing: border-box;
  user-select: none;
}

.poi-mode-btn:hover {
  background: #ecf5ff;
  border-color: #409eff;
  color: #409eff;
}
</style>
