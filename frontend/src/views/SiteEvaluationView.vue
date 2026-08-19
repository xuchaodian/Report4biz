<template>
  <div class="site-eval-view">
    <!-- 页头 -->
    <div class="se-header">
      <div>
        <h2 style="margin:0;font-size:18px;">🎯 选址评估</h2>
        <p style="margin:4px 0 0;font-size:13px;color:#909399;">
          点击地图选点，一键评估开店潜力 —— 人口 / 竞争 / 配套 / 交通 4 维加权评分（人口数据来自联通智慧足迹）
        </p>
      </div>
      <div class="se-header-right">
        <el-button size="small" @click="loadCandidates">
          <el-icon><FolderOpened /></el-icon>&nbsp;我的候选点位
        </el-button>
      </div>
    </div>

    <div class="se-body">
      <!-- 左：地图 -->
      <div class="se-map-wrap">
        <div id="se-map" ref="mapRef" class="se-map"></div>
        <div class="se-map-tip" v-if="!selectedPoint">
          <el-icon><Pointer /></el-icon>
          <span>点击地图任意位置选择待评估点位</span>
        </div>
        <div class="se-point-info" v-if="selectedPoint">
          <span class="se-point-coord">{{ selectedPoint.lng.toFixed(6) }}, {{ selectedPoint.lat.toFixed(6) }}</span>
          <el-button size="small" type="primary" :loading="scoring" @click="startScore" style="margin-left:8px;">
            <el-icon><MagicStick /></el-icon>&nbsp;开始评估
          </el-button>
        </div>
      </div>

      <!-- 右：设置 + 结果 -->
      <div class="se-panel">
        <el-card shadow="never" class="se-card">
          <template #header><b>⚙️ 评分设置</b></template>
          <div class="se-form">
            <div class="se-form-item">
              <label>人口权重 α</label>
              <el-slider v-model="weights.population" :min="0" :max="1" :step="0.05" show-input />
            </div>
            <div class="se-form-item">
              <label>竞争权重 β</label>
              <el-slider v-model="weights.competition" :min="0" :max="1" :step="0.05" show-input />
            </div>
            <div class="se-form-item">
              <label>配套权重 γ</label>
              <el-slider v-model="weights.support" :min="0" :max="1" :step="0.05" show-input />
            </div>
            <div class="se-form-item">
              <label>交通权重 δ</label>
              <el-slider v-model="weights.transport" :min="0" :max="1" :step="0.05" show-input />
            </div>
            <div class="se-form-row">
              <div>
                <label>分析半径</label>
                <el-select v-model="radiusKm" style="width:100%">
                  <el-option v-for="r in [0.5, 1, 2, 3, 5]" :key="r" :label="r + ' km'" :value="r" />
                </el-select>
              </div>
              <div>
                <label>竞争饱和阈值</label>
                <el-input-number v-model="competitionThreshold" :min="1" :max="50" style="width:100%" />
              </div>
            </div>
            <div class="se-quota-tip">
              <el-icon><Odometer /></el-icon>
              预计消耗 <b>1</b> 次配额（同点位已查询过则缓存命中，免费）
            </div>
          </div>
        </el-card>

        <!-- 评分结果 -->
        <el-card v-if="result" shadow="never" class="se-card se-result-card">
          <template #header><b>📊 评估结果</b></template>
          <div class="se-total">
            <div class="se-total-score" :style="{ color: totalColor }">{{ result.score }}</div>
            <div class="se-total-label">综合评分</div>
          </div>
          <div class="se-dims">
            <div v-for="d in dims" :key="d.key" class="se-dim">
              <div class="se-dim-head">
                <span>{{ d.label }}</span>
                <b :style="{ color: d.color }">{{ result[d.valueKey] }}</b>
              </div>
              <el-progress :percentage="result[d.valueKey]" :color="d.color" :stroke-width="10" :show-text="false" />
            </div>
          </div>
          <div class="se-facts">
            <div class="se-fact"><span>人口规模</span><b>{{ (result.populationDensity ?? 0).toLocaleString() }} 人</b></div>
            <div class="se-fact"><span>半径内竞品</span><b>{{ result.competitorCount }} 家</b></div>
            <div class="se-fact"><span>配套 POI</span><b>{{ result.poiCount }} 个</b></div>
          </div>
          <el-button type="primary" style="width:100%;margin-top:12px;" @click="saveCandidate">
            <el-icon><FolderAdd /></el-icon>&nbsp;保存为候选点位
          </el-button>
        </el-card>
      </div>
    </div>

    <!-- 我的候选弹窗 -->
    <el-dialog v-model="candDialogVisible" title="🗂️ 我的候选点位" width="720px">
      <el-table :data="candList" size="small" border stripe max-height="420">
        <el-table-column type="index" label="#" width="45" />
        <el-table-column label="综合评分" width="90" align="center">
          <template #default="{ row }">
            <b :style="{ color: scoreColor(row.score) }">{{ row.score }}</b>
          </template>
        </el-table-column>
        <el-table-column label="坐标" min-width="150">
          <template #default="{ row }">{{ row.lng.toFixed(5) }}, {{ row.lat.toFixed(5) }}</template>
        </el-table-column>
        <el-table-column prop="population_density" label="人口规模" width="100" align="right">
          <template #default="{ row }">{{ (row.population_density ?? 0).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="competitor_count" label="竞品数" width="80" align="right" />
        <el-table-column label="评分时间" width="120">
          <template #default="{ row }">{{ (row.created_at || '').slice(0, 10) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="flyToCandidate(row)">定位</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="candList.length === 0" style="text-align:center;padding:24px;color:#909399;">暂无候选点位</div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/utils/api'
import { ElMessage } from 'element-plus'
import { Pointer, MagicStick, FolderOpened, FolderAdd, Odometer } from '@element-plus/icons-vue'

const mapRef = ref(null)
let map = null
let pointMarker = null
let radiusCircle = null

const selectedPoint = ref(null)
const scoring = ref(false)
const result = ref(null)

const weights = reactive({ population: 0.40, competition: 0.25, support: 0.20, transport: 0.15 })
const radiusKm = ref(1)
const competitionThreshold = ref(10)

// 权重自动归一化
watch(weights, () => {
  const total = weights.population + weights.competition + weights.support + weights.transport
  if (Math.abs(total - 1) > 0.01 && total > 0) {
    weights.population = Math.round(weights.population / total * 100) / 100
    weights.competition = Math.round(weights.competition / total * 100) / 100
    weights.support = Math.round(weights.support / total * 100) / 100
    weights.transport = Math.round(weights.transport / total * 100) / 100
  }
}, { deep: true })

const dims = [
  { key: 'population', label: '人口规模', valueKey: 'scorePopulation', color: '#378ADD' },
  { key: 'competition', label: '竞争强度', valueKey: 'scoreCompetition', color: '#7F77DD' },
  { key: 'support', label: '商业配套', valueKey: 'scoreSupport', color: '#1D9E75' },
  { key: 'transport', label: '交通便利', valueKey: 'scoreTransport', color: '#D4537E' }
]
const totalColor = computed(() => scoreColor(result.value?.score ?? 0))
function scoreColor(s) {
  if (s >= 75) return '#67c23a'
  if (s >= 50) return '#e6a23c'
  return '#f56c6c'
}

// 候选
const candDialogVisible = ref(false)
const candList = ref([])

onMounted(() => {
  initMap()
})
onBeforeUnmount(() => {
  if (map) map.remove()
})

function initMap() {
  map = L.map(mapRef.value, { center: [31.2304, 121.4737], zoom: 11, zoomControl: true })
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', {
    subdomains: [1, 2, 3, 4],
    maxZoom: 18,
    attribution: '&copy; 高德地图'
  }).addTo(map)
  // 点击取点
  map.on('click', (e) => {
    selectedPoint.value = { lng: e.latlng.lng, lat: e.latlng.lat }
    result.value = null
    drawPoint()
  })
}

function drawPoint() {
  if (!selectedPoint.value || !map) return
  const { lng, lat } = selectedPoint.value
  if (pointMarker) map.removeLayer(pointMarker)
  if (radiusCircle) map.removeLayer(radiusCircle)
  const customIcon = L.divIcon({
    className: 'se-point-icon',
    html: '<div class="se-point-dot"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  })
  pointMarker = L.marker([lat, lng], { icon: customIcon }).addTo(map)
  radiusCircle = L.circle([lat, lng], {
    radius: radiusKm.value * 1000,
    color: '#409eff',
    weight: 1.5,
    fillColor: '#409eff',
    fillOpacity: 0.06
  }).addTo(map)
  map.flyTo([lat, lng], Math.max(map.getZoom(), 13))
}

watch(radiusKm, () => { if (selectedPoint.value) drawPoint() })

async function startScore() {
  if (!selectedPoint.value) { ElMessage.warning('请先在地图上选择点位'); return }
  scoring.value = true
  try {
    const res = await api.post('/scoring/score-point', {
      lng: selectedPoint.value.lng,
      lat: selectedPoint.value.lat,
      radius: radiusKm.value,
      competitionThreshold: competitionThreshold.value,
      city: ''
    })
    if (res.success) {
      result.value = res
      ElMessage.success('评估完成' + (res.quotaUsed ? `（消耗 ${res.quotaUsed} 次配额）` : '（缓存命中，未消耗配额）'))
    } else {
      ElMessage.error(res.message || '评估失败')
    }
  } catch (e) {
    ElMessage.error('评估失败: ' + (e.response?.data?.message || e.message))
  } finally {
    scoring.value = false
  }
}

async function saveCandidate() {
  if (!result.value || !selectedPoint.value) return
  try {
    const res = await api.post('/scoring/candidates', {
      candidates: [{
        lng: selectedPoint.value.lng,
        lat: selectedPoint.value.lat,
        score: result.value.score,
        scorePopulation: result.value.scorePopulation,
        scoreCompetition: result.value.scoreCompetition,
        scoreSupport: result.value.scoreSupport,
        scoreTransport: result.value.scoreTransport,
        populationDensity: result.value.populationDensity ?? 0,
        competitorCount: result.value.competitorCount,
        poiCount: result.value.poiCount
      }]
    })
    ElMessage.success(res.message || '已保存')
  } catch (e) {
    ElMessage.error('保存失败: ' + (e.response?.data?.message || e.message))
  }
}

async function loadCandidates() {
  candDialogVisible.value = true
  try {
    const res = await api.get('/scoring/candidates', { params: { size: 50 } })
    candList.value = res.candidates || []
  } catch (e) {
    ElMessage.error('加载失败: ' + (e.response?.data?.message || e.message))
  }
}

function flyToCandidate(row) {
  if (map) {
    map.flyTo([row.lat, row.lng], 14)
    selectedPoint.value = { lng: row.lng, lat: row.lat }
    drawPoint()
  }
  candDialogVisible.value = false
}
</script>

<style scoped>
.site-eval-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 14px 18px;
  box-sizing: border-box;
  background: #f5f7fa;
}
.se-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.se-body {
  flex: 1;
  display: flex;
  gap: 12px;
  min-height: 0;
}
.se-map-wrap {
  flex: 1;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  background: #fff;
}
.se-map {
  width: 100%;
  height: 100%;
}
.se-map-tip {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #dcdfe6;
  border-radius: 20px;
  padding: 6px 16px;
  font-size: 13px;
  color: #606266;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 800;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  pointer-events: none;
}
.se-point-info {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  padding: 8px 14px;
  display: flex;
  align-items: center;
  z-index: 800;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
}
.se-point-coord {
  font-size: 12px;
  color: #606266;
  font-family: monospace;
}
.se-panel {
  width: 340px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.se-card {
  border-radius: 8px;
  border: none;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}
.se-form-item { margin-bottom: 12px; }
.se-form-item label, .se-form-row label {
  display: block;
  font-size: 12px;
  color: #606266;
  margin-bottom: 6px;
}
.se-form-row {
  display: flex;
  gap: 10px;
}
.se-form-row > div { flex: 1; }
.se-quota-tip {
  margin-top: 10px;
  padding: 8px 10px;
  background: #f0f7ff;
  border-radius: 6px;
  font-size: 12px;
  color: #409eff;
  display: flex;
  align-items: center;
  gap: 6px;
}
.se-total {
  text-align: center;
  padding: 6px 0 10px;
}
.se-total-score {
  font-size: 52px;
  font-weight: 700;
  line-height: 1.1;
}
.se-total-label {
  font-size: 13px;
  color: #909399;
  margin-top: 2px;
}
.se-dims {
  border-top: 1px dashed #ebeef5;
  padding-top: 10px;
}
.se-dim { margin-bottom: 10px; }
.se-dim-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #606266;
  margin-bottom: 4px;
}
.se-facts {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.se-fact {
  flex: 1;
  background: #f7f9fc;
  border-radius: 6px;
  padding: 8px;
  text-align: center;
}
.se-fact span {
  display: block;
  font-size: 11px;
  color: #909399;
}
.se-fact b {
  font-size: 13px;
  color: #303133;
}
:deep(.se-point-dot) {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #409eff;
  border: 3px solid #fff;
  box-shadow: 0 0 0 2px #409eff, 0 2px 6px rgba(0,0,0,0.3);
}
</style>
