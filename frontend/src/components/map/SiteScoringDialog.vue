<template>
  <el-dialog v-model="visible" title="门店潜力评分" width="520px" draggable :close-on-click-modal="false" @open="initConfig" @close="visible = false">
    <el-form label-width="100px">
      <el-form-item label="选择区域">
        <el-radio-group v-model="areaType">
          <el-radio value="viewport">当前视野</el-radio>
          <el-radio value="circle">绘制圆形</el-radio>
          <el-radio value="city">按城市</el-radio>
        </el-radio-group>
        <div v-if="areaType === 'city'" style="margin-top: 8px;">
          <el-select v-model="selectedCity" placeholder="选择城市" filterable style="width:100%">
            <el-option v-for="c in cities" :key="c" :label="c" :value="c" />
          </el-select>
        </div>
      </el-form-item>

      <el-form-item label="评分配置">
        <el-select v-model="configId" placeholder="选择配置" style="width:100%" @change="onConfigChange">
          <el-option v-for="cfg in configs" :key="cfg.id" :label="cfg.name" :value="cfg.id" />
        </el-select>
      </el-form-item>

      <el-divider content-position="left">权重设置</el-divider>

      <el-form-item label="人口权重 α">
        <el-slider v-model="weights.population" :min="0" :max="1" :step="0.05" show-input style="width:100%" />
      </el-form-item>
      <el-form-item label="竞争权重 β">
        <el-slider v-model="weights.competition" :min="0" :max="1" :step="0.05" show-input style="width:100%" />
      </el-form-item>
      <el-form-item label="配套权重 γ">
        <el-slider v-model="weights.support" :min="0" :max="1" :step="0.05" show-input style="width:100%" />
      </el-form-item>
      <el-form-item label="交通权重 δ">
        <el-slider v-model="weights.transport" :min="0" :max="1" :step="0.05" show-input style="width:100%" />
      </el-form-item>

      <el-divider content-position="left">其他参数</el-divider>

      <el-form-item label="分析半径">
        <el-input-number v-model="radiusKm" :min="0.5" :max="5" :step="0.5" style="width:100%" /> km
      </el-form-item>
      <el-form-item label="竞争饱和阈值">
        <el-input-number v-model="competitionThreshold" :min="1" :max="50" style="width:100%" /> 家
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button @click="saveConfig">保存配置</el-button>
      <el-button type="primary" :loading="scoring" @click="startScoring">开始评分</el-button>
    </template>
  </el-dialog>

  <!-- 候选结果面板 -->
  <CandidateListPanel
    v-if="candidates.length > 0"
    :candidates="candidates"
    :loading="scoring"
    @close="candidates = []"
    @locate="locateCandidate"
    @save="saveCandidates"
  />
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import CandidateListPanel from './CandidateListPanel.vue'

const props = defineProps({
  cities: { type: Array, default: () => [] }
})

const emit = defineEmits([
  'start-scoring',
  'locate-candidate',
  'save-candidates'
])

const visible = ref(false)
const areaType = ref('viewport')
const selectedCity = ref('')
const configId = ref(null)
const configs = ref([])
const scoring = ref(false)
const candidates = ref([])

const weights = reactive({
  population: 0.40,
  competition: 0.25,
  support: 0.20,
  transport: 0.15
})
const radiusKm = ref(1.0)
const competitionThreshold = ref(10)

// 归一化权重
watch(weights, () => {
  const total = weights.population + weights.competition + weights.support + weights.transport
  if (Math.abs(total - 1) > 0.01) {
    // 自动归一化
    if (total > 0) {
      weights.population = Math.round(weights.population / total * 100) / 100
      weights.competition = Math.round(weights.competition / total * 100) / 100
      weights.support = Math.round(weights.support / total * 100) / 100
      weights.transport = Math.round(weights.transport / total * 100) / 100
    }
  }
}, { deep: true })

function open() {
  visible.value = true
}

async function initConfig() {
  try {
    const res = await fetch('/api/scoring/configs')
    const data = await res.json()
    configs.value = data.configs || []
    if (configs.value.length > 0) {
      configId.value = configs.value[0].id
      applyConfig(configs.value[0])
    }
  } catch (e) {
    console.error('[Scoring] 加载配置失败:', e)
  }
}

function onConfigChange(id) {
  const cfg = configs.value.find(c => c.id === id)
  if (cfg) applyConfig(cfg)
}

function applyConfig(cfg) {
  weights.population = cfg.weight_population
  weights.competition = cfg.weight_competition
  weights.support = cfg.weight_support
  weights.transport = cfg.weight_transport
  radiusKm.value = cfg.radius_km
  competitionThreshold.value = cfg.competition_threshold
}

async function saveConfig() {
  try {
    const res = await fetch('/api/scoring/configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '自定义配置',
        weightPopulation: weights.population,
        weightCompetition: weights.competition,
        weightSupport: weights.support,
        weightTransport: weights.transport,
        radiusKm: radiusKm.value,
        competitionThreshold: competitionThreshold.value
      })
    })
    const data = await res.json()
    if (data.config) {
      configs.value.push(data.config)
      configId.value = data.config.id
      ElMessage.success('配置已保存')
    }
  } catch (e) {
    ElMessage.error('保存配置失败')
  }
}

async function startScoring() {
  if (areaType.value === 'city' && !selectedCity.value) {
    ElMessage.warning('请选择城市')
    return
  }
  scoring.value = true
  candidates.value = []
  emit('start-scoring', {
    areaType: areaType.value,
    city: selectedCity.value,
    configId: configId.value,
    weights: { ...weights },
    radiusKm: radiusKm.value,
    competitionThreshold: competitionThreshold.value
  })
}

// 接收评分结果
function setResults(results) {
  candidates.value = results
  scoring.value = false
}

function locateCandidate(c) {
  emit('locate-candidate', c)
}

function saveCandidates() {
  emit('save-candidates', candidates.value)
}

defineExpose({ open, setResults, visible })
</script>
