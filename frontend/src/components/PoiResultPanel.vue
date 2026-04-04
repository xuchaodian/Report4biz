<template>
  <div v-if="visible" class="poi-result-panel">
    <div class="panel-header">
      <span class="title">POI搜索结果</span>
      <span class="count">{{ pois.length }} 个</span>
      <el-button link @click="close">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>
    <div class="panel-content">
      <div
        v-for="poi in pois"
        :key="poi.id"
        class="poi-item"
        @click="focusOn(poi)"
      >
        <div class="poi-name">{{ poi.name }}</div>
        <div class="poi-address">{{ poi.address || poi.city + poi.district }}</div>
        <div class="poi-type">{{ poi.type }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Close } from '@element-plus/icons-vue'

const props = defineProps({
  visible: Boolean,
  pois: Array,
  map: Object
})

const emit = defineEmits(['close'])

const focusOn = (poi) => {
  if (poi.location && props.map) {
    const [lng, lat] = poi.location.split(',').map(Number)
    props.map.setView([lat, lng], 16)
  }
}

const close = () => {
  emit('close')
}
</script>

<style scoped>
.poi-result-panel {
  position: fixed;
  top: 180px;
  right: 18px;
  width: 300px;
  max-height: 400px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  z-index: 1200;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  gap: 8px;
}

.title {
  font-weight: 600;
  color: #333;
}

.count {
  font-size: 12px;
  color: #666;
  background: #f5f5f5;
  padding: 2px 8px;
  border-radius: 10px;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.poi-item {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.poi-item:hover {
  background: #f0f7ff;
}

.poi-name {
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
}

.poi-address {
  font-size: 12px;
  color: #666;
  margin-bottom: 2px;
}

.poi-type {
  font-size: 11px;
  color: #999;
}
</style>
