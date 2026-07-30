<template>
  <div class="candidate-panel" :class="{ collapsed: collapsed }">
    <div class="panel-header">
      <span class="panel-title">候选点位 Top {{ candidates.length }}</span>
      <div class="panel-actions">
        <el-button type="primary" size="small" @click="$emit('save')">💾 保存</el-button>
        <el-button size="small" @click="collapsed = !collapsed">{{ collapsed ? '展开' : '收起' }}</el-button>
        <el-button size="small" @click="$emit('close')">✕</el-button>
      </div>
    </div>

    <div v-if="!collapsed" class="panel-body" v-loading="loading">
      <div
        v-for="(c, i) in candidates"
        :key="i"
        class="candidate-item"
        :class="{ active: activeIndex === i }"
        @click="onSelect(c, i)"
      >
        <div class="candidate-rank">#{{ i + 1 }}</div>
        <div class="candidate-info">
          <div class="candidate-score">
            <div class="score-bar" :style="{ width: c.score + '%' }" :class="scoreClass(c.score)"></div>
            <span class="score-text">{{ c.score }}</span>
          </div>
          <div class="candidate-dims">
            <span class="dim">人{{ c.scorePopulation }}</span>
            <span class="dim">竞{{ c.scoreCompetition }}</span>
            <span class="dim">配{{ c.scoreSupport }}</span>
            <span class="dim">交{{ c.scoreTransport }}</span>
          </div>
          <div class="candidate-addr">{{ c.address || `${c.lat?.toFixed(4)}, ${c.lng?.toFixed(4)}` }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  candidates: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'locate', 'save'])

const collapsed = ref(false)
const activeIndex = ref(-1)

function onSelect(c, idx) {
  activeIndex.value = idx
  emit('locate', c)
}

function scoreClass(score) {
  if (score >= 80) return 'score-high'
  if (score >= 60) return 'score-mid'
  return 'score-low'
}
</script>

<style scoped>
.candidate-panel {
  position: fixed; top: 240px; right: 18px;
  width: 280px; background: #fff; border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  z-index: 1100; overflow: hidden;
  border: 1px solid #e5e7eb;
}
.candidate-panel.collapsed { width: auto; }
.panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff; font-size: 13px; font-weight: 600; gap: 6px;
}
.panel-title { white-space: nowrap; }
.panel-actions { display: flex; gap: 4px; }
:deep(.panel-actions .el-button) {
  padding: 2px 6px; font-size: 11px; min-height: 22px;
}
.panel-body { max-height: 400px; overflow-y: auto; padding: 6px; }
.candidate-item {
  display: flex; gap: 8px; padding: 8px; border-radius: 6px;
  cursor: pointer; transition: all 0.15s;
  border: 1px solid transparent; margin-bottom: 4px;
}
.candidate-item:hover, .candidate-item.active {
  background: #f5f3ff; border-color: #c4b5fd;
}
.candidate-rank {
  width: 28px; height: 28px; border-radius: 50%;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff; font-size: 12px; font-weight: bold;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.candidate-info { flex: 1; min-width: 0; }
.candidate-score { position: relative; height: 16px; background: #f3f4f6; border-radius: 4px; overflow: hidden; margin-bottom: 3px; }
.score-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
.score-high { background: linear-gradient(90deg, #34d399, #10b981); }
.score-mid { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
.score-low { background: linear-gradient(90deg, #f87171, #ef4444); }
.score-text { position: absolute; right: 4px; top: 0; font-size: 10px; font-weight: bold; color: #374151; line-height: 16px; }
.candidate-dims { display: flex; gap: 4px; margin-bottom: 2px; }
.dim { font-size: 10px; color: #909399; background: #f3f4f6; padding: 1px 4px; border-radius: 3px; }
.candidate-addr { font-size: 11px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
