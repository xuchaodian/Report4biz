<template>
  <div class="business-circle-panel">
    <div class="business-circle-header" @click="$emit('update:expanded', !expanded)">
      <span class="business-circle-title">商圈工具</span>
      <span class="business-circle-arrow" :class="{ expanded }">▼</span>
    </div>
    <div v-show="expanded" class="business-circle-body">
      <div class="business-circle-btn" :class="{ active: activeTool === 'circle' }" @click="$emit('set-tool', 'circle')">
        <el-icon><Coordinate /></el-icon>
        <span>商圈内点位</span>
      </div>
      <div class="business-circle-btn" :class="{ active: envScoreActive }" @click="$emit('env-score')">
        <el-icon><Star /></el-icon>
        <span>周边商业配套</span>
      </div>
      <div class="business-circle-btn" @click="$emit('population-dist')">
        <el-icon><DataAnalysis /></el-icon>
        <span>常住人口分布</span>
      </div>
      <div class="business-circle-btn" @click="$emit('population-compare')">
        <el-icon><DataAnalysis /></el-icon>
        <span>常住人口对比</span>
      </div>
      <div class="business-circle-btn" @click="$emit('toggle-smartsteps')" title="智慧足迹人口分析">
        <el-icon><DataAnalysis /></el-icon>
        <span>联通人口</span>
      </div>
      <div class="business-circle-btn" :class="{ active: potentialVisible }" @click="handlePotentialClick">
        <el-icon><DataAnalysis /></el-icon>
        <span>开店余地</span>
        <span v-if="!isVipUser" class="vip-only-tag">🔒VIP</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const emit = defineEmits([
  'update:expanded',
  'set-tool',
  'env-score',
  'population-dist',
  'population-compare',
  'toggle-smartsteps',
  'toggle-potential'
])
// VIP 门禁：开店余地仅 VIP 用户可用（管理员视为 VIP）
const isVipUser = computed(() => userStore.user?.role === 'vip' || userStore.user?.role === 'admin')
const handlePotentialClick = () => {
  if (!isVipUser.value) {
    ElMessage.warning('🔒 开店余地为 VIP 用户专属功能，请联系管理员开通 VIP')
    return
  }
  emit('toggle-potential')
}

defineProps({
  expanded: Boolean,
  activeTool: { type: String, default: '' },
  potentialVisible: Boolean,
  envScoreActive: Boolean
})
</script>

<style scoped>
.business-circle-panel {
  position: absolute;
  top: 10px;
  right: 420px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  min-width: 110px;
  overflow: hidden;
  border: 2px solid #ff8800;
}

.business-circle-header {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(135deg, #ff8800 0%, #cc6600 100%);
}

.business-circle-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}

.business-circle-arrow {
  margin-left: auto;
  font-size: 10px;
  color: #fff;
  transition: transform 0.2s;
  transform: rotate(-90deg);
}

.business-circle-arrow.expanded {
  transform: rotate(0deg);
}

.business-circle-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.business-circle-btn {
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

.business-circle-btn:hover {
  background: #fff4e6;
  border-color: #ff8800;
  color: #ff8800;
}

.business-circle-btn.active {
  background: #fff4e6;
  border-color: #ff8800;
  color: #ff8800;
}

/* VIP 专属角标 */
.vip-only-tag {
  font-size: 9px;
  color: #fff;
  background: #7c3aed;
  border-radius: 8px;
  padding: 1px 5px;
  margin-left: 4px;
  white-space: nowrap;
  line-height: 14px;
}
</style>
