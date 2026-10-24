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
            {{ s.steps.length }} 步<template v-if="vipCount(s)"> · 含 {{ vipCount(s) }} 个 VIP</template><template v-if="paidCount(s)"> · 含 {{ paidCount(s) }} 个按次付费</template>
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
            <span v-if="st.paid" class="sg-paid">按次</span>
          </div>

          <!-- 仅当前步骤展开细节，避免面板过长 -->
          <div v-if="isCurrent(i)" class="sg-step-detail">
            <p class="sg-step-why">{{ st.why }}</p>
            <p class="sg-step-how">{{ st.how }}</p>
            <!-- v1.13.260：observeOnly 步骤不由按钮代劳（如「在搜索框输入地址」），
                 只给操作提示；完成状态仍由真实结果置位 -->
            <el-button v-if="!st.observeOnly" type="primary" size="small" class="sg-step-btn"
                       @click="$emit('action', st.action)">
              {{ st.actionLabel }}
            </el-button>
            <p v-else class="sg-step-observe">
              这一步需要你在界面上自己操作，做对了会自动打勾。
            </p>
            <p v-if="st.vip && !vipActive" class="sg-step-vipnote">
              这一步需要 VIP 权限，点击后会提示如何申请
            </p>
            <!-- v1.13.259：付费步骤必须**在点按钮之前**把费用说清，⛔ 不能等用户点完再告知 -->
            <p v-if="st.paid" class="sg-step-paidnote">
              <span class="sg-step-paidnote-tag">按次收费</span>{{ st.priceNote }}
            </p>
          </div>
        </div>

        <div v-if="allDone" class="sg-finish">
          <p class="sg-finish-txt">{{ activeScene.finishNote || '这条流程走完了。' }}</p>
        </div>

        <div class="sg-foot">
          <span class="sg-back" role="button" tabindex="0" @click="activeKey = null" @keydown.enter="activeKey = null">← 换个任务</span>
          <!-- v1.13.261：情境入口 —— 用户卡住时眼睛正盯着这个面板，
               此时反馈会自动带上「哪个场景第几步」，比让他自己描述准得多 -->
          <span class="sg-feedback" role="button" tabindex="0"
                @click="feedbackVisible = true" @keydown.enter="feedbackVisible = true">没找到答案？反馈</span>
        </div>
      </div>
    </div>

    <!-- 收起态：常驻入口（v1.13.258：改 48×48 正圆 —— 与 .ai-fab / .ai-lang 同形同构同阴影） -->
    <div v-else class="sg-fab" role="button" tabindex="0"
         aria-label="怎么做？打开操作引导" title="不知道怎么用？点这里"
         @click="openGuide" @keydown.enter="openGuide">
      <el-icon class="sg-fab-icon"><QuestionFilled /></el-icon>
      <span class="sg-fab-label">引导</span>
    </div>

    <!-- 首次气泡：只对没点过的人显示 5 秒（圆形按钮放不下"怎么做"三个字，
         用它补一次可读性；关掉后写 localStorage，不再打扰） -->
    <div v-if="tipVisible" class="sg-tip" role="status">
      不知道怎么用？点这里
      <span class="sg-tip-arrow" aria-hidden="true"></span>
    </div>

    <!-- 反馈弹窗（v1.13.261）：带上当前场景与步骤 -->
    <FeedbackDialog
      v-model="feedbackVisible"
      :scene-key="activeScene?.key || ''"
      :scene-step="currentStepKey"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Close, QuestionFilled } from '@element-plus/icons-vue'
import { SCENES, getScene, countVipSteps, countPaidSteps } from '@/utils/sceneGuides.js'
// 🔴 按 uid 命名的本地存储一律走 utils/currentUser.js，⛔ 不要直接读 localStorage.getItem('userId')（会串档）
import { currentUidOr } from '@/utils/currentUser.js'
// v1.13.264 完成率埋点：只记「打开/选场景/走完」，⛔ 不记任何业务数据
import { trackGuideOpen, trackSceneStart, trackSceneFinish } from '@/utils/sceneTrack.js'
import FeedbackDialog from '@/components/FeedbackDialog.vue'

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
const paidCount = (s) => countPaidSteps(s)
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

const selectScene = (key) => {
  activeKey.value = key
  trackSceneStart(key)          // 分母：选了这个场景的人
}

// ===== 反馈入口（v1.13.261）=====
const feedbackVisible = ref(false)
// 当前步骤 key：随进度自动变，反馈时会带上「卡在哪一步」
const currentStepKey = computed(() => {
  const steps = activeScene.value?.steps || []
  const i = currentIndex.value
  return i >= 0 && steps[i] ? steps[i].key : ''
})

// ===== 首次气泡（v1.13.258）=====
// 目的：圆形按钮只能写"引导"两个字，对完全没用过的人不够自解释。
// 做法：第一次进地图页且数据已就绪时，右侧浮出 5 秒文字气泡，点过/看过即写标记，之后不再出现。
const TIP_STORAGE_KEY = () => `scene_guide_tip_${currentUidOr('anon')}`
const tipVisible = ref(false)
let tipShowTimer = null
let tipHideTimer = null

const clearTipTimers = () => {
  if (tipShowTimer) { clearTimeout(tipShowTimer); tipShowTimer = null }
  if (tipHideTimer) { clearTimeout(tipHideTimer); tipHideTimer = null }
}

const markTipSeen = () => {
  // localStorage 在隐私模式/配额满时可能抛错 —— 吞掉，气泡多做一次不等于功能坏了
  try { localStorage.setItem(TIP_STORAGE_KEY(), '1') } catch (e) { /* noop */ }
}

const hasSeenTip = () => {
  try { return localStorage.getItem(TIP_STORAGE_KEY()) === '1' } catch (e) { return true }
}

const hideTip = (markSeen = true) => {
  tipVisible.value = false
  clearTipTimers()
  if (markSeen) markTipSeen()
}

const tryShowTip = () => {
  if (!props.hasData || open.value || hasSeenTip()) return
  clearTipTimers()
  // 延迟 1.2s：避开地图首屏渲染与 OnboardingGuide 的弹窗抢注意力
  tipShowTimer = setTimeout(() => {
    if (props.hasData && !open.value) tipVisible.value = true
  }, 1200)
  tipHideTimer = setTimeout(() => hideTip(true), 6500)
}

// 用户点开引导 ⇒ 气泡已完成使命，立刻收起并记标记
const openGuide = () => {
  if (tipVisible.value) hideTip(true)
  open.value = true
  trackGuideOpen()              // 入口有没有被看见
}

// 全部步骤完成 ⇒ 记「走完整条流程」
watch(allDone, (v) => { if (v && activeScene.value) trackSceneFinish(activeScene.value.key) })

onMounted(tryShowTip)
// hasData 依赖 store 异步加载（markers/competitors），可能在 mounted 之后才变 true
watch(() => props.hasData, (v) => { if (v) tryShowTip() })
onUnmounted(clearTipTimers)
</script>

<style scoped>
.scene-guide {
  /* v1.13.257：从「左下角」移到「左上角 AI 助手 / 语言切换按钮下方」——
     原 left:12 bottom:48 在部分屏宽下会压住右下角图层面板（.layer-switcher）。
     🔴 必须用 fixed、⛔ 不能用 absolute：目标锚点 .ai-fab / .ai-lang 都是 `position: fixed`
        （见 AiAssistant.vue:440 / 471，left:18、top:180 与 236），属**视口坐标系**；
        本组件外层是地图容器，容器顶部还有 header(60) + OnboardingGuide 引导条(41) 的偏移，
        且**引导条可被用户关闭** ⇒ absolute 的偏移量是动态的，一旦对齐就会随引导条显隐错位 41px
        （首版实测：absolute+top:292 渲染成 y=393，与语言按钮间距变成 109px 而非 8px）。
     ⚠️ top:292 是锚定值 = 语言按钮底边 284 + 8px 间距。若 .ai-fab/.ai-lang 位置或尺寸变化，此处同步改。 */
  position: fixed;
  left: 18px;
  top: 292px;
  z-index: 1001;
  font-family: inherit;
}

/* 收起态入口（v1.13.258：与 .ai-fab / .ai-lang 完全同形同构）
   参照 AiAssistant.vue:471 .ai-fab —— 48×48 正圆 / 渐变底 / 白字 / 同参数发光阴影 / hover 放大 1.08。
   颜色取橙：本系统「商圈工具」面板主色就是 #ff8800 橙，语义一致，且与 AI(靛紫)、语言(蓝青) 区分明确。 */
.sg-fab {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #f59e0b, #ea580c);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: none;
  box-shadow: 0 4px 16px rgba(234, 88, 12, 0.45);
  transition: all 0.25s;
  user-select: none;
}
.sg-fab:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 20px rgba(234, 88, 12, 0.55);
}
.sg-fab-icon {
  font-size: 16px;
  line-height: 1;
}
.sg-fab-label {
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  margin-top: 2px;
}

/* 首次气泡：贴在圆的右侧，左指小三角 */
.sg-tip {
  position: absolute;
  left: 58px;
  top: 9px;
  z-index: 2;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  font-size: 12px;
  color: #303133;
  white-space: nowrap;
  animation: sg-tip-in 0.25s ease-out;
}
.sg-tip-arrow {
  position: absolute;
  left: -5px;
  top: 50%;
  margin-top: -5px;
  width: 9px;
  height: 9px;
  background: #fff;
  border-left: 1px solid #ebeef5;
  border-bottom: 1px solid #ebeef5;
  transform: rotate(45deg);
}
@keyframes sg-tip-in {
  from { opacity: 0; transform: translateX(-4px); }
  to { opacity: 1; transform: translateX(0); }
}

/* 面板 */
.sg-panel {
  width: 300px;
  /* v1.13.257：改用 top 定位后，72vh 会从 292px 起算溢出屏幕底部（900 屏 => 292+648 > 900）
     ⇒ 按「视口高 − 顶部锚点 − 底部余量」计算，矮屏仍可滚动 */
  max-height: calc(100vh - 330px);
  display: flex;
  flex-direction: column;
  background: #fff;
  /* v1.13.258：对齐 AiAssistant.vue:511 的 .ai-panel（border-radius:16 / 0 8px 40px），
     ⛔ 原来 8px + 0 4px 20px 会让展开面板与 AI 面板质感差一截 */
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18);
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
/* 按次付费角标（v1.13.259）：用红不用橙 —— 橙色已是入口主色，且"花钱"比"权限"更需要警示 */
.sg-paid {
  font-size: 9px;
  color: #fff;
  background: #b91c1c;
  border-radius: 8px;
  padding: 1px 5px;
  line-height: 14px;
  flex-shrink: 0;
}

/* 付费说明块：比 vipnote 更重（底色 + 标签），因为这是**真花钱** */
.sg-step-paidnote {
  margin: 6px 0 0;
  padding: 6px 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 4px;
  font-size: 11px;
  color: #b91c1c;
  line-height: 1.6;
}
.sg-step-paidnote-tag {
  display: inline-block;
  margin-right: 4px;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: #b91c1c;
  border-radius: 3px;
  padding: 0 4px;
}

/* VIP 专属角标 */
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
/* observeOnly 步骤的提示（替代按钮） */
.sg-step-observe {
  margin: 0;
  padding: 6px 8px;
  background: #f5f7fa;
  border: 1px dashed #dcdfe6;
  border-radius: 4px;
  font-size: 11px;
  color: #909399;
  line-height: 1.6;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sg-feedback {
  font-size: 11px;
  color: #909399;
  cursor: pointer;
}
.sg-feedback:hover {
  color: #409eff;
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
