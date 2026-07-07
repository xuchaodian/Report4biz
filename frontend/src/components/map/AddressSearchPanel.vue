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
  top: 15px;
  left: 15px;
  z-index: 1000;
  width: 320px;
  max-height: calc(100vh - 100px);
  display: flex;
  flex-direction: column;
}

.search-body {
  flex-shrink: 0;
}

.search-results {
  background: #fff;
  border-radius: 0 0 8px 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  max-height: 460px;
  overflow-y: auto;
  margin-top: 2px;
}

.search-result-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.2s;
  border-bottom: 1px solid #f0f0f0;
}

.search-result-item:last-child {
  border-bottom: none;
}

.search-result-item:hover {
  background: #f5f7fa;
}

.result-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: #409eff;
  font-size: 16px;
}

.result-info {
  flex: 1;
  min-width: 0;
}

.result-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-address {
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
