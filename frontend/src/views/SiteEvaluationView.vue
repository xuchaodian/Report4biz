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

    <!-- 门店来源 -->
    <div class="se-source">
      <div class="se-source-item">
        <span class="se-source-label">评估点位</span>
        <el-select
          v-model="selectedStoreId"
          placeholder="从我的门店选择（重要候选 → 一般候选 → 现有门店）"
          filterable
          clearable
          style="width: 380px"
          @change="onSelectStore"
        >
          <el-option-group v-for="g in storeGroups" :key="g.label" :label="g.label">
            <el-option
              v-for="s in g.stores"
              :key="s.id"
              :value="s.id"
              :label="s.name + '（' + (s.city || '') + '）'"
            >
              <span>{{ s.name }}</span>
              <span style="float:right;color:#909399;font-size:12px;">{{ s.city }} {{ s.district }}</span>
            </el-option>
          </el-option-group>
        </el-select>
        <el-button size="default" :type="storeMode === 'map' ? 'primary' : 'default'" @click="switchToMapMode">
          <el-icon><Pointer /></el-icon>&nbsp;地图选点
        </el-button>
      </div>
      <div class="se-source-item se-quota">
        <el-tag :type="quotaAvailable > 0 ? 'success' : 'danger'" effect="light" size="large">
          <el-icon><Odometer /></el-icon>
          &nbsp;剩余次数：<b>{{ quotaAvailable }}</b>
        </el-tag>
        <span v-if="quotaAvailable < 1" class="se-quota-warn">⚠️ 余额不足，请联系管理员分配配额</span>
      </div>
    </div>

    <div class="se-body">
      <!-- 左：地图 -->
      <div class="se-map-wrap">
        <div id="se-map" ref="mapRef" class="se-map"></div>
        <div class="se-map-tip" v-if="!selectedPoint">
          <el-icon><Pointer /></el-icon>
          <span>从上方「我的门店」选择评估点位，或点击「地图选点」在地图上选</span>
        </div>
        <div class="se-point-info" v-if="selectedPoint">
          <span class="se-point-coord">{{ selectedPoint.storeName || selectedPoint.lng.toFixed(6) + ', ' + selectedPoint.lat.toFixed(6) }}</span>
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
import { ElMessage, ElMessageBox } from 'element-plus'
import { Pointer, MagicStick, FolderOpened, FolderAdd, Odometer } from '@element-plus/icons-vue'

const mapRef = ref(null)
let map = null
let pointMarker = null
let radiusCircle = null

const selectedPoint = ref(null)
const scoring = ref(false)
const result = ref(null)

// 门店来源
const myStores = ref([])
const selectedStoreId = ref(null)
const storeMode = ref('store')   // 'store' = 从我的门店选点, 'map' = 地图选点
const quotaAvailable = ref(0)

// 门店分组排序：重要候选 → 一般候选 → 现有门店（已开业）
const STORE_ORDER = { '重点候选': 2, '一般候选': 1, '已开业': 0 }
const storeGroups = computed(() => {
  const groups = {}
  for (const s of myStores.value) {
    const type = s.store_type || '未分类'
    if (!groups[type]) groups[type] = []
    groups[type].push(s)
  }
  return Object.entries(groups)
    .sort((a, b) => (STORE_ORDER[b[0]] ?? -1) - (STORE_ORDER[a[0]] ?? -1))
    .map(([label, stores]) => ({ label, stores }))
})

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
  loadStores()
  loadQuota()
})
onBeforeUnmount(() => {
  if (map) map.remove()
})

// 加载我的门店（按 重要候选→一般候选→现有门店 展示由 storeGroups computed 控制）
async function loadStores() {
  try {
    const res = await api.get('/markers')
    const list = res.markers || res.data || (Array.isArray(res) ? res : [])
    myStores.value = (Array.isArray(list) ? list : []).filter(s => s.latitude && s.longitude)
  } catch (e) {
    console.warn('加载我的门店失败:', e.message)
  }
}

// 加载用户剩余次数
async function loadQuota() {
  try {
    const res = await api.get('/purchase/quota')
    quotaAvailable.value = res.available ?? 0
  } catch (e) {
    console.warn('加载配额失败:', e.message)
  }
}

// 从门店列表选中点位
function onSelectStore(id) {
  if (!id) return
  const store = myStores.value.find(s => s.id === id)
  if (!store) return
  storeMode.value = 'store'
  selectedStoreId.value = id
  selectedPoint.value = { lng: store.longitude, lat: store.latitude, storeName: store.name, storeType: store.store_type }
  result.value = null
  drawPoint()
}

// 切到地图选点模式
function switchToMapMode() {
  storeMode.value = 'map'
  selectedStoreId.value = null
  ElMessage.info('请在地图上点击选择待评估点位')
}

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
  if (!selectedPoint.value) { ElMessage.warning('请先选择评估点位（从我的门店选择或地图选点）'); return }
  // 配额检查
  if (quotaAvailable.value < 1) {
    ElMessage.warning('余额不足：剩余次数为 0，请联系管理员分配配额')
    return
  }
  // 确认提示：从剩余次数扣除
  const pointDesc = selectedPoint.value.storeName || `${selectedPoint.value.lng.toFixed(5)}, ${selectedPoint.value.lat.toFixed(5)}`
  try {
    await ElMessageBox.confirm(
      `评估点位：${pointDesc}\n\n本次评估将从「剩余次数」中扣除 1 次（当前剩余 ${quotaAvailable.value} 次；同点位已查询过则缓存命中，不扣次数）。\n确定开始评估吗？`,
      '确认评估',
      { confirmButtonText: '确定评估', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return  // 用户取消
  }

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
      // 刷新剩余次数（扣除后）
      if (res.quotaUsed > 0) {
        quotaAvailable.value = Math.max(0, quotaAvailable.value - res.quotaUsed)
        ElMessage.success(`评估完成（消耗 ${res.quotaUsed} 次配额，剩余 ${quotaAvailable.value} 次）`)
      } else {
        ElMessage.success('评估完成（缓存命中，未消耗配额）')
      }
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
        poiCount: result.value.poiCount,
        address: selectedPoint.value.storeName || ''
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
  margin-bottom: 10px;
}
.se-source {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}
.se-source-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.se-source-label {
  font-size: 13px;
  color: #606266;
  font-weight: 600;
}
.se-quota {
  gap: 10px;
}
.se-quota-warn {
  font-size: 12px;
  color: #f56c6c;
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
