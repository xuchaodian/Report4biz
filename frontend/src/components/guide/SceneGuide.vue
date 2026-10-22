<template>
  <div v-if="hasData" class="scene-guide">
    <!-- 展开态：场景列表 / 步骤清单 -->
    <div v-if="open" class="sg-panel">
      <div class="sg-head">
        <span class="sg-head-title">{{ activeScene ? activeScene.title : '按任务开始' }}</span>
        <el-icon class="sg-close" role="button" tabindex="0" aria-label="关闭引导"
                 @click="open = false" @keydown.enter="open = false"><Close /></el-icon>
      </div>

      <!-- ① 场景列表 -->
      <div v-if="!activeScene" class="sg-list">
        <p class="sg-list-hint">不知道从哪下手？选一个任务，跟着步骤走。</p>
        <div v-for="s in scenes" :key="s.key" class="sg-scene" role="button" tabindex="0"
             @click="selectScene(s.key)" @keydown.enter="selectScene(s.key)">
          <div class="sg-scene-row">
            <span class="sg-scene-title">{{ s.title }}</span>
            <span class="sg-scene-dur">{{ s.duration }}</span>
          </div>
          <div class="sg-scene-sub">{{ s.summary }}</div>
          <div class="sg-scene-meta">
            {{ s.steps.length }} 步<template v-if="vipCount(s)"> · 含 {{ vipCount(s) }} 个 VIP 步骤</template>
          </div>
        </div>
      </div>

      <!-- ② 步骤清单 -->
      <div v-else class="sg-body">
        <div class="sg-progress">
          <div class="sg-progress-track"><i class="sg-progress-fill" :style="{ width: pct + '%' }"></i></div>
          <span class="sg-progress-txt">{{ doneCount }} / {{ activeScene.steps.length }}</span>
        </div>

        <div v-for="(st, i) in activeScene.steps" :key="st.key" class="sg-step" :class="{ 'is-done': done[st.key], 'is-now': isCurrent(i) }">
          <div class="sg-step-head">
            <span class="sg-step-no">
              <template v-if="done[st.key]">✓</template>
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="sg-step-title">{{ st.title }}</span>
            <span v-if="st.vip" class="sg-vip">VIP</span>
          </div>

          <!-- 仅当前步骤展开细节，避免面板过长 -->
          <div v-if="isCurrent(i)" class="sg-step-detail">
            <p class="sg-step-why">{{ st.why }}</p>
            <p class="sg-step-how">{{ st.how }}</p>
            <el-button type="primary" size="small" class="sg-step-btn" @click="$emit('action', st.action)">
              {{ st.actionLabel }}
            </el-button>
            <p v-if="st.vip && !vipActive" class="sg-step-vipnote">
              这一步需要 VIP 权限，点击后会提示如何申请
            </p>
          </div>
        </div>

        <div v-if="allDone" class="sg-finish">
          <p class="sg-finish-txt">这条流程走完了。想换城市再来一遍，直接重新选范围即可。</p>
        </div>

        <div class="sg-foot">
          <span class="sg-back" role="button" tabindex="0" @click="activeKey = null" @keydown.enter="activeKey = null">← 换个任务</span>
        </div>
      </div>
    </div>

    <!-- 收起态：常驻入口 -->
    <div v-else class="sg-fab" role="button" tabindex="0" @click="open = true" @keydown.enter="open = true">
      <el-icon><QuestionFilled /></el-icon>
      <span>怎么做？</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Close, QuestionFilled } from '@element-plus/icons-vue'
import { SCENES, getScene, countVipSteps } from '@/utils/sceneGuides.js'

const props = defineProps({
  /** 各步骤完成状态，由 MapView 依据**真实操作结果**置位（key 与配置里的 step.key 一致） */
  done: { type: Object, default: () => ({}) },
  /** 当前用户是否有 VIP 权限 —— 仅用于提前提示，门禁仍由 utils/vipGate.js 统一负责 */
  vipActive: { type: Boolean, default: false },
  /** 数据未就绪时不显示入口（与首次使用向导 OnboardingGuide 互斥） */
  hasData: { type: Boolean, default: false }
})

defineEmits(['action'])

const scenes = SCENES
const open = ref(false)
const activeKey = ref(null)
const activeScene = computed(() => getScene(activeKey.value))

const vipCount = (s) => countVipSteps(s)
const doneCount = computed(() =>
  (activeScene.value?.steps || []).filter(s => props.done[s.key]).length)
const allDone = computed(() =>
  !!activeScene.value && doneCount.value === activeScene.value.steps.length)
const pct = computed(() =>
  activeScene.value ? Math.round(doneCount.value / activeScene.value.steps.length * 100) : 0)

// 当前步骤 = 第一个未完成项；全部完成时返回 -1（不再展开任何一步）
const currentIndex = computed(() => {
  const steps = activeScene.value?.steps || []
  for (let i = 0; i < steps.length; i++) {
    if (!props.done[steps[i].key]) return i
  }
  return -1
})
const isCurrent = (i) => currentIndex.value === i

const selectScene = (key) => { activeKey.value = key }
</script>

<style scoped>
.scene-guide {
  position: absolute;
  left: 12px;
  bottom: 48px;
  z-index: 1001;
  font-family: inherit;
}

/* 收起态入口 */
.sg-fab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.14);
  font-size: 13px;
  color: #303133;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s, color 0.15s;
}
.sg-fab:hover {
  border-color: #409eff;
  color: #409eff;
}
.sg-fab .el-icon {
  color: #409eff;
  font-size: 15px;
}

/* 面板 */
.sg-panel {
  width: 300px;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.sg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}
.sg-head-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  flex: 1;
}
.sg-close {
  font-size: 14px;
  color: #909399;
  cursor: pointer;
}
.sg-close:hover {
  color: #303133;
}

/* 场景列表 */
.sg-list {
  padding: 10px 12px 12px;
  overflow-y: auto;
}
.sg-list-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}
.sg-scene {
  padding: 9px 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.sg-scene:hover {
  border-color: #409eff;
  background: #f4f8fe;
}
.sg-scene-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.sg-scene-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.sg-scene-dur {
  font-size: 11px;
  color: #c0c4cc;
  margin-left: auto;
}
.sg-scene-sub {
  font-size: 12px;
  color: #606266;
  margin-top: 3px;
  line-height: 1.5;
}
.sg-scene-meta {
  font-size: 11px;
  color: #909399;
  margin-top: 5px;
}

/* 步骤清单 */
.sg-body {
  overflow-y: auto;
  padding: 10px 12px 12px;
}
.sg-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.sg-progress-track {
  flex: 1;
  height: 3px;
  background: #ebeef5;
  border-radius: 2px;
  overflow: hidden;
}
.sg-progress-fill {
  display: block;
  height: 100%;
  background: #409eff;
  transition: width 0.25s;
}
.sg-progress-txt {
  font-size: 11px;
  color: #909399;
  flex-shrink: 0;
}

.sg-step {
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 7px 8px;
  margin-bottom: 4px;
}
.sg-step.is-now {
  border-color: #b3d8ff;
  background: #f4f8fe;
}
.sg-step-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.sg-step-no {
  width: 17px;
  height: 17px;
  border-radius: 50%;
  border: 1px solid #dcdfe6;
  color: #c0c4cc;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
}
.sg-step.is-done .sg-step-no {
  border-color: #67c23a;
  background: #67c23a;
  color: #fff;
}
.sg-step.is-now .sg-step-no {
  border-color: #409eff;
  color: #409eff;
}
.sg-step-title {
  font-size: 12px;
  color: #303133;
  line-height: 1.5;
}
.sg-step.is-done .sg-step-title {
  color: #c0c4cc;
  text-decoration: line-through;
}
.sg-vip {
  font-size: 9px;
  color: #fff;
  background: #8a5e00;
  border-radius: 8px;
  padding: 1px 5px;
  line-height: 14px;
  flex-shrink: 0;
}

.sg-step-detail {
  margin: 6px 0 2px 24px;
}
.sg-step-why {
  margin: 0 0 4px;
  font-size: 11px;
  color: #606266;
  line-height: 1.6;
}
.sg-step-how {
  margin: 0 0 8px;
  font-size: 11px;
  color: #909399;
  line-height: 1.6;
}
.sg-step-btn {
  width: 100%;
}
.sg-step-vipnote {
  margin: 6px 0 0;
  font-size: 11px;
  color: #b88230;
  line-height: 1.5;
}

.sg-finish {
  margin-top: 8px;
  padding: 8px 10px;
  background: #f0f9eb;
  border: 1px solid #e1f3d8;
  border-radius: 6px;
}
.sg-finish-txt {
  margin: 0;
  font-size: 11px;
  color: #529b2e;
  line-height: 1.6;
}

.sg-foot {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #ebeef5;
}
.sg-back {
  font-size: 11px;
  color: #909399;
  cursor: pointer;
}
.sg-back:hover {
  color: #409eff;
}
</style>
