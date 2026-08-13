<template>
  <div>
    <!-- 顶部引导条：数据未就绪时显示（可关闭，跨会话保留关闭状态） -->
    <div v-if="showBanner" class="onboarding-banner">
      <div class="banner-content">
        <el-icon class="banner-icon"><MagicStick /></el-icon>
        <span class="banner-text">
          <template v-if="!hasMyStores && !hasCompetitors">
            欢迎使用选址赢家！建议先<strong>添加我的门店</strong>，再添加<strong>竞品门店</strong>，即可开始商圈分析。
          </template>
          <template v-else-if="!hasMyStores">
            还差一步：请先<strong>添加我的门店</strong>，之后可添加竞品门店进行对比分析。
          </template>
          <template v-else-if="!hasCompetitors">
            我的门店已就绪！建议继续<strong>添加竞品门店</strong>，即可进行竞争分析。
          </template>
        </span>
        <el-button type="primary" size="small" class="banner-btn" @click="goNextStep">
          {{ !hasMyStores ? '添加我的门店' : '添加竞品门店' }}
        </el-button>
        <el-icon class="banner-close" @click="dismissBanner"><Close /></el-icon>
      </div>
    </div>

    <!-- 首次使用分步向导 -->
    <el-dialog
      v-model="wizardVisible"
      title="👋 欢迎使用选址赢家Online"
      width="560px"
      :close-on-click-modal="true"
      :show-close="true"
      modal-class="onboarding-wizard-modal"
      class="onboarding-wizard"
      @close="skipWizard"
    >
      <el-steps :active="step" align-center finish-status="success" class="wizard-steps">
        <el-step title="欢迎" />
        <el-step title="我的门店" />
        <el-step title="竞品门店" />
      </el-steps>

      <!-- Step 0: 欢迎 -->
      <div v-if="step === 0" class="wizard-body">
        <div class="wizard-hero">
          <img src="@/assets/logo.png" alt="Logo" class="wizard-logo" />
          <h2>3 步开始你的选址分析</h2>
          <p>按照引导完成数据准备，即可使用地图可视化、商圈分析、竞争分析等全部功能。</p>
        </div>
      </div>

      <!-- Step 1: 我的门店 -->
      <div v-else-if="step === 1" class="wizard-body">
        <h3 class="wizard-title">📌 第 1 步：添加我的门店</h3>
        <p class="wizard-desc">我的门店是你自己的门店数据，支持单个添加或 CSV 批量导入。</p>
        <div class="wizard-tip">
          <el-icon><InfoFilled /></el-icon>
          <span>门店数据是商圈分析、竞争分析的基础，请先录入。</span>
        </div>
        <el-button v-if="!hasMyStores" type="primary" class="wizard-action" @click="goTo('/data')">
          去添加我的门店 →
        </el-button>
        <el-tag v-else type="success" size="large" class="wizard-done">
          ✅ 已添加 {{ markerStore.markers.length }} 家门店
        </el-tag>
      </div>

      <!-- Step 2: 竞品门店 -->
      <div v-else-if="step === 2" class="wizard-body">
        <h3 class="wizard-title">📊 第 2 步：添加竞品门店</h3>
        <p class="wizard-desc">竞品门店是你的竞争品牌门店数据，用于竞争分析、开店余地评估。</p>
        <div class="wizard-tip">
          <el-icon><InfoFilled /></el-icon>
          <span>可以导入竞品品牌的全国门店，系统会自动按商圈/半径统计。</span>
        </div>
        <el-button v-if="!hasCompetitors" type="primary" class="wizard-action" @click="goTo('/competitors')">
          去添加竞品门店 →
        </el-button>
        <el-tag v-else type="success" size="large" class="wizard-done">
          ✅ 已添加 {{ competitorStore.competitors.length }} 家竞品
        </el-tag>
      </div>

      <template #footer>
        <el-button v-if="step > 0" @click="step--">上一步</el-button>
        <el-button v-if="step < 2" type="primary" @click="step++">下一步</el-button>
        <el-button v-else type="primary" @click="finishWizard">开始使用 🎉</el-button>
        <el-button text @click="skipWizard">跳过引导</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { MagicStick, Close, InfoFilled } from '@element-plus/icons-vue'
import { useMarkerStore } from '@/stores/marker'
import { useCompetitorStore } from '@/stores/competitor'

const router = useRouter()
const markerStore = useMarkerStore()
const competitorStore = useCompetitorStore()

const wizardVisible = ref(false)
const step = ref(0)
const showBanner = ref(false)
const bannerClosed = ref(false)

// 引导完成标记 key（按用户隔离）
const guideDoneKey = () => `guide_done_${localStorage.getItem('userId') || 'anon'}`
// 引导条关闭标记 key（按用户隔离）
const bannerClosedKey = () => `guide_banner_closed_${localStorage.getItem('userId') || 'anon'}`

const hasMyStores = computed(() => markerStore.markers.length > 0)
const hasCompetitors = computed(() => competitorStore.competitors.length > 0)
const dataReady = computed(() => hasMyStores.value && hasCompetitors.value)

// 初始化：预取数据并判断引导状态
onMounted(async () => {
  bannerClosed.value = localStorage.getItem(bannerClosedKey()) === '1'
  // 并行预取数据（已加载则跳过）
  if (markerStore.markers.length === 0) await markerStore.fetchMarkers()
  if (competitorStore.competitors.length === 0) await competitorStore.fetchCompetitors()

  // 数据未就绪 → 显示顶部引导条
  showBanner.value = !dataReady.value && !bannerClosed.value

  // 首次使用（数据未就绪且未看过向导）→ 弹出分步向导
  const done = localStorage.getItem(guideDoneKey())
  if (!dataReady.value && !done) {
    wizardVisible.value = true
  }
})

// 数据就绪后自动隐藏引导条
watch(dataReady, (ready) => {
  if (ready) showBanner.value = false
})

const goNextStep = () => {
  if (!hasMyStores.value) {
    router.push('/data')
  } else {
    router.push('/competitors')
  }
}

const goTo = (path) => {
  router.push(path)
  wizardVisible.value = false
  // 跳转后不打断向导流程，返回时重新评估（保持简单：关闭向导）
}

const dismissBanner = () => {
  showBanner.value = false
  localStorage.setItem(bannerClosedKey(), '1')
}

const finishWizard = () => {
  wizardVisible.value = false
  localStorage.setItem(guideDoneKey(), '1')
  ElMessage.success('引导完成，开始使用！')
}

const skipWizard = () => {
  wizardVisible.value = false
  localStorage.setItem(guideDoneKey(), '1')
  ElMessage.info('已跳过引导，可随时在个人中心查看使用帮助')
}
</script>

<style scoped>
.onboarding-banner {
  background: linear-gradient(90deg, #e8f3ff 0%, #f0f7ff 100%);
  border-bottom: 1px solid #d6e6f7;
  padding: 8px 16px;
  display: flex;
  align-items: center;
}
.banner-content {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
}
.banner-icon {
  color: #409eff;
  font-size: 18px;
  flex-shrink: 0;
}
.banner-text {
  flex: 1;
  font-size: 13px;
  color: #333;
}
.banner-text strong {
  color: #409eff;
}
.banner-btn {
  flex-shrink: 0;
}
.banner-close {
  cursor: pointer;
  color: #909399;
  flex-shrink: 0;
  font-size: 16px;
}
.banner-close:hover {
  color: #333;
}

.wizard-steps {
  margin: 8px 0 24px;
}
.wizard-body {
  text-align: center;
  padding: 8px 16px 16px;
}
.wizard-hero h2 {
  margin: 12px 0 8px;
  color: #303133;
}
.wizard-hero p {
  color: #909399;
  font-size: 13px;
  margin: 0 auto;
  max-width: 420px;
  line-height: 1.7;
}
.wizard-logo {
  width: 64px;
  height: auto;
  border-radius: 12px;
}
.wizard-title {
  margin: 4px 0 8px;
  color: #303133;
}
.wizard-desc {
  color: #606266;
  font-size: 13px;
  margin: 0 0 16px;
}
.wizard-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f4f8fe;
  border: 1px solid #d6e6f7;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: #606266;
  text-align: left;
  margin-bottom: 20px;
}
.wizard-tip .el-icon {
  color: #409eff;
  flex-shrink: 0;
}
.wizard-action {
  min-width: 180px;
}
.wizard-done {
  font-size: 14px;
  padding: 8px 16px;
}
</style>
