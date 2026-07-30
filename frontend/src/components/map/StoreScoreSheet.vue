<template>
  <el-dialog v-model="visible" title="门店评分表" width="620px" draggable :close-on-click-modal="false" @open="initScore" @close="visible = false">
    <div v-if="loading" style="text-align:center;padding:40px;">
      <el-icon class="is-loading" :size="32"><Loading /></el-icon>
      <p style="margin-top:12px;color:#909399;">系统正在计算商圈特征...</p>
    </div>

    <template v-else>
      <div class="score-summary">
        <div class="score-circle" :class="scoreLevel(totalScore)">
          <span class="score-num">{{ totalScore }}</span>
          <span class="score-label">总分</span>
        </div>
        <div class="score-info">
          <div class="info-item"><span class="info-label">📊 联通精算人口</span></div>
        </div>
      </div>

      <el-divider content-position="left">🏙 商圈特征（系统自动）</el-divider>
      <div class="score-items">
        <div v-for="item in tradeAreaItems" :key="item.id" class="score-row auto">
          <div class="row-header">
            <span class="row-name">{{ item.name }}</span>
            <span class="row-max">/{{ item.max_score }}分</span>
          </div>
          <div class="row-body">
            <div class="row-value">{{ formatAutoValue(item) }}</div>
            <el-progress :percentage="item.final_score / item.max_score * 100" :stroke-width="14" :color="scoreColor(item.final_score, item.max_score)" :format="() => `${item.final_score}分`" />
          </div>
        </div>
      </div>

      <el-divider content-position="left">📍 立地特征（手动填写）</el-divider>
      <div class="score-items">
        <div v-for="item in siteItems" :key="item.id" class="score-row manual">
          <div class="row-header">
            <span class="row-name">{{ item.name }}</span>
            <span class="row-max">/{{ item.max_score }}分</span>
          </div>
          <div class="row-body">
            <template v-if="item.input_type === 'score'">
              <el-slider v-model="item._manual" :min="0" :max="item.max_score" :step="1" show-input style="width:100%" @change="recalcTotal" />
            </template>
            <template v-else-if="item.input_type === 'number'">
              <el-input-number v-model="item._manual" :min="0" :step="1000" :max="999999" style="width:180px" @change="recalcTotal" />
              <span v-if="item.name === '月租金(元)'" style="margin-left:8px;font-size:12px;color:#909399;">{{ rentScoreHint(item._manual) }}</span>
            </template>
            <template v-else-if="item.input_type === 'select' && item.options">
              <el-select v-model="item._manual" style="width:100%" @change="recalcTotal">
                <el-option v-for="opt in parsedOptions(item.options)" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </template>
            <el-progress v-if="item._manual !== undefined && item._manual !== null" :percentage="item._manual / item.max_score * 100" :stroke-width="14" :color="scoreColor(item._manual, item.max_score)" :format="() => `${item._manual || 0}分`" style="margin-top:6px;" />
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :loading="saving" @click="saveScore">{{ score?.status === 'completed' ? '更新评分' : '保存评分' }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const props = defineProps({})

const visible = ref(false)
const loading = ref(false)
const saving = ref(false)
const score = ref(null)
const items = ref([])
const currentLng = ref(0)
const currentLat = ref(0)
const currentAddress = ref('')

const tradeAreaItems = computed(() => items.value.filter(i => i.dimension === 'trade_area'))
const siteItems = computed(() => items.value.filter(i => i.dimension === 'site'))
const totalScore = computed(() => {
  let total = 0
  for (const item of items.value) {
    total += item.final_score || 0
  }
  return total
})

function open({ lng, lat, address, storeId } = {}) {
  currentLng.value = lng || 0
  currentLat.value = lat || 0
  currentAddress.value = address || ''
  visible.value = true
  initScore()
}

async function initScore() {
  loading.value = true
  try {
    const token = sessionStorage.getItem('token') || ''
    const res = await axios.post('/api/store-scores/scores', {
      lng: currentLng.value,
      lat: currentLat.value,
      address: currentAddress.value,
      premium: 1
    }, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const resData = res.data
    if (resData.score) {
      score.value = resData.score
      items.value = resData.details.map(d => {
        const sourceItem = resData.items.find(i => i.id === d.item_id)
        return {
          ...sourceItem,
          detailId: d.id,
          auto_value: d.auto_value,
          manual_value: d.manual_value,
          final_score: d.final_score,
          remark: d.remark,
          _manual: d.manual_value ?? getDefaultManual(sourceItem)
        }
      })
      premium.value = resData.score.premium === 1
    }
  } catch (e) {
    ElMessage.error('创建评分失败')
  }
  loading.value = false
}

function getDefaultManual(item) {
  if (item.input_type === 'score') return 0
  if (item.input_type === 'number') return 0
  if (item.input_type === 'select' && item.options) {
    const opts = JSON.parse(item.options)
    return opts[0]?.value || 0
  }
  return 0
}

function recalcTotal() {
  for (const item of items.value) {
    if (item.dimension === 'site') {
      if (item.input_type === 'score' || item.input_type === 'select') {
        item.final_score = item._manual || 0
      } else if (item.input_type === 'number') {
        item.final_score = item.name === '月租金(元)' ? calcRentScore(item._manual) : calcNumberScore(item._manual, item.max_score)
      }
    }
  }
}

function calcRentScore(rent) {
  if (!rent || rent <= 0) return 0
  if (rent <= 5000) return 10
  if (rent <= 10000) return 8
  if (rent <= 20000) return 6
  if (rent <= 30000) return 4
  return 2
}

function calcNumberScore(val, max) {
  if (!val || val <= 0) return 0
  // 默认按比例换算
  return Math.min(max, Math.round(val / 1000))
}

function rentScoreHint(rent) {
  if (!rent || rent <= 0) return ''
  const score = calcRentScore(rent)
  if (score >= 8) return '✅ 租金合理'
  if (score >= 6) return '⚠️ 租金偏高'
  return '❌ 租金太高'
}

function formatAutoValue(item) {
  if (item.auto_value === null || item.auto_value === undefined) return '—'
  if (item.data_source === 'smartsteps') return `${item.auto_value.toLocaleString()} 人`
  if (item.name.includes('密度')) return `${item.auto_value.toLocaleString()} 人/km²`
  if (item.name === '竞争强度') return `${item.auto_value} 家`
  return item.auto_value
}

async function saveScore() {
  if (!score.value) return
  saving.value = true
  try {
    const details = items.value.filter(i => i.dimension === 'site').map(i => ({
      id: i.detailId,
      itemId: i.id,
      manualValue: i._manual,
      finalScore: i.final_score
    }))

    const saveRes = await axios.put(`/api/store-scores/scores/${score.value.id}`, { details }, {
      headers: { 'Authorization': `Bearer ${sessionStorage.getItem('token') || ''}` }
    })
    const saveData = saveRes.data
    if (saveData.score) {
      score.value = saveData.score
      ElMessage.success('评分已保存')
    }
  } catch (e) {
    ElMessage.error('保存失败')
  }
  saving.value = false
}

function scoreLevel(total) {
  if (total >= 80) return 'level-high'
  if (total >= 60) return 'level-mid'
  return 'level-low'
}

function scoreColor(score, max) {
  const pct = score / max * 100
  if (pct >= 80) return '#10b981'
  if (pct >= 50) return '#f59e0b'
  return '#ef4444'
}

function parsedOptions(opts) {
  if (!opts) return []
  try { return JSON.parse(opts) } catch { return [] }
}

defineExpose({ open })
</script>

<style scoped>
.score-summary { display:flex; align-items:center; gap:20px; padding:0 0 12px; }
.score-circle { width:80px; height:80px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; flex-shrink:0; }
.score-circle.level-high { background:linear-gradient(135deg,#34d399,#10b981); }
.score-circle.level-mid { background:linear-gradient(135deg,#fbbf24,#f59e0b); }
.score-circle.level-low { background:linear-gradient(135deg,#f87171,#ef4444); }
.score-num { font-size:28px; font-weight:bold; color:#fff; line-height:1; }
.score-label { font-size:11px; color:rgba(255,255,255,0.9); }
.score-info { flex:1; font-size:13px; color:#374151; }
.info-item { margin-bottom:4px; }
.info-label { color:#909399; margin-right:6px; }
.tag-premium { color:#d97706; background:#fef3c7; padding:2px 8px; border-radius:4px; font-size:12px; }
.score-items { display:flex; flex-direction:column; gap:8px; }
.score-row { padding:8px 12px; border-radius:8px; border:1px solid #e5e7eb; }
.score-row.auto { background:#f9fafb; }
.score-row.manual { background:#fff; }
.row-header { display:flex; align-items:center; gap:4px; margin-bottom:4px; }
.row-name { font-size:13px; font-weight:500; color:#374151; }
.row-max { font-size:11px; color:#9ca3af; }
.row-body { }
.row-value { font-size:11px; color:#6b7280; margin-bottom:4px; }
:deep(.el-progress-bar) { margin-right:0; }
</style>
