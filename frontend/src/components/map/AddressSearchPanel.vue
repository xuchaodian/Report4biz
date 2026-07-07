<template>
  <!-- 左上角地址检索框 -->
  <div class="search-panel">
    <div class="search-body">
      <el-input
        v-model="keyword"
        placeholder="输入地址搜索定位"
        size="default"
        clearable
        @input="$emit('search', keyword)"
        @keyup.enter="$emit('search-enter', keyword)"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
    </div>
    <div v-if="results.length > 0" class="search-results">
      <div
        v-for="(result, index) in results"
        :key="index"
        class="search-result-item"
        @click="$emit('select-result', result)"
      >
        <div class="result-icon">
          <el-icon><LocationFilled /></el-icon>
        </div>
        <div class="result-info">
          <div class="result-name">{{ result.name || result.display_name }}</div>
          <div class="result-address">{{ result.address || result.district }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  results: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['search', 'search-enter', 'select-result'])

const keyword = ref('')

// 当外部重置keyword时同步
watch(() => props.results, (newResults) => {
  if (newResults.length === 0 && keyword.value) {
    // 不清空keyword，保持用户输入
  }
})
</script>

<style scoped>
.search-panel {
  position: absolute;
  top: 10px;
  left: 10px;
  width: 320px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  overflow: hidden;
  border: 2px solid #409eff;
}

.search-body {
  padding: 8px 12px;
}

.search-body :deep(.el-input__wrapper) {
  border-radius: 6px;
  box-shadow: none;
  border: 1px solid #dcdfe6;
  transition: all 0.2s;
}

.search-body :deep(.el-input__wrapper):hover {
  border-color: #409eff;
}

.search-body :deep(.el-input__wrapper.is-focus) {
  border-color: #409eff;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2);
}

.search-body :deep(.el-input__inner) {
  font-size: 13px;
}

.search-body :deep(.el-input__inner)::placeholder {
  color: #999;
}

.search-body :deep(.el-input__prefix) {
  color: #409eff;
}

.search-body :deep(.el-input__clear) {
  color: #999;
}

.search-body :deep(.el-input__clear):hover {
  color: #409eff;
}

.search-results {
  max-height: 300px;
  overflow-y: auto;
  border-top: 1px solid #eee;
}

.search-result-item {
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #333;
  border-bottom: 1px solid #f0f0f0;
  transition: background 0.15s;
}

.search-result-item:last-child {
  border-bottom: none;
}

.search-result-item:hover {
  background: #e6f4ff;
}

.result-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  border-radius: 50%;
  color: #409eff;
  font-size: 14px;
}

.result-info {
  flex: 1;
  min-width: 0;
}

.result-name {
  font-size: 13px;
  font-weight: 500;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-address {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
