<template>
  <div class="district-view">
    <!-- 页头 -->
    <div class="dv-header">
      <div>
        <h2 style="margin:0;font-size:18px;">🏙️ {{ $t('nav.districtInsight') }}</h2>
        <p style="margin:4px 0 0;font-size:13px;color:#909399;">
          综合评分 = 人口规模 40% + 消费能力 25% + 竞争强度 25% + 客流活跃 10%（数据基准 2022-04）
        </p>
      </div>
      <div class="dv-header-right">
        <el-tag type="warning" effect="light" size="small">数据时间 2022-04</el-tag>
        <el-button size="small" :disabled="compareList.length < 2" style="margin-left:10px;" @click="openCompare">
          📊 商圈对比{{ compareList.length > 0 ? ` (${compareList.length})` : '' }}
        </el-button>
      </div>
    </div>

    <div class="dv-body">
      <!-- 左：城市 + 商圈列表 -->
      <div class="dv-side">
        <el-select v-model="selectedCity" placeholder="选择城市" filterable style="width:100%" @change="onCityChange">
          <el-option-group v-for="g in cityGroups" :key="g.tier" :label="g.tier">
            <el-option v-for="c in g.cities" :key="c.name" :value="c.name" :label="`${c.name}（${c.districtCount} 商圈）`" />
          </el-option-group>
        </el-select>

        <div v-if="districts.length > 0" class="dv-list">
          <div class="dv-list-head">
            <span>共 {{ districts.length }} 个商圈（按评分排序）</span>
            <el-checkbox v-model="selectAll" @change="toggleSelectAll">全选对比</el-checkbox>
          </div>
          <div class="dv-list-body">
            <div
              v-for="d in districts"
              :key="d.name"
              class="dv-item"
              :class="{ active: selectedDistrict?.name === d.name }"
              @click="selectDistrict(d)"
            >
              <div class="dv-item-head">
                <el-checkbox :model-value="isCompared(d.name)" @click.stop @change="val => toggleCompare(d, val)" />
                <span class="dv-item-name">{{ d.name }}</span>
                <span class="dv-item-score" :style="{ color: scoreColor(d.score) }">{{ d.score }}</span>
              </div>
              <div class="dv-item-meta">
                <span>{{ d.district || d.city }}</span>
                <span>竞品 {{ d.competitorCount }}</span>
                <span>人口 {{ formatNum(d.population + d.work) }}</span>
              </div>
            </div>
          </div>
        </div>
        <el-empty v-else-if="selectedCity" description="该城市暂无商圈数据" :image-size="60" />
      </div>

      <!-- 右：地图 -->
      <div class="dv-map-wrap">
        <div id="dv-map" ref="mapRef" class="dv-map"></div>
        <!-- 商圈详情卡 -->
        <div v-if="selectedDistrict" class="dv-detail">
          <div class="dv-detail-head">
            <b>{{ selectedDistrict.name }}</b>
            <el-tag size="small" :type="scoreTagType(selectedDistrict.score)" effect="dark">{{ selectedDistrict.score }} 分</el-tag>
            <el-button text size="small" style="margin-left:auto;" @click="selectedDistrict = null">✕</el-button>
          </div>
          <div class="dv-detail-info">
            <span>{{ selectedDistrict.province }} · {{ selectedDistrict.city }} · {{ selectedDistrict.district || '-' }}</span>
            <span style="color:#f56c6c;font-size:11px;">数据时间 2022-04</span>
          </div>
          <div class="dv-dims">
            <div v-for="dim in dims" :key="dim.key" class="dv-dim">
              <span class="dv-dim-label">{{ dim.label }}</span>
              <el-progress :percentage="selectedDistrict[dim.key]" :color="dim.color" :stroke-width="8" :show-text="false" style="flex:1;" />
              <b style="width:32px;text-align:right;" :style="{ color: dim.color }">{{ selectedDistrict[dim.key] }}</b>
            </div>
          </div>
          <div class="dv-facts">
            <div class="dv-fact"><span>居住人口</span><b>{{ formatNum(selectedDistrict.population) }}</b></div>
            <div class="dv-fact"><span>工作人口</span><b>{{ formatNum(selectedDistrict.work) }}</b></div>
            <div class="dv-fact"><span>到访人次</span><b>{{ formatNum(selectedDistrict.visit) }}</b></div>
            <div class="dv-fact"><span>竞品门店</span><b>{{ selectedDistrict.competitorCount }} 家</b></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 对比弹窗 -->
    <el-dialog v-model="compareVisible" title="📊 商圈对比" width="860px" :close-on-click-modal="false">
      <el-table :data="compareList" size="small" border stripe>
        <el-table-column prop="name" label="商圈" width="130" fixed />
        <el-table-column label="综合评分" width="90" align="center">
          <template #default="{ row }">
            <b :class="{ 'dv-best': isBest(row, 'score') }" :style="{ color: scoreColor(row.score) }">{{ row.score }}</b>
          </template>
        </el-table-column>
        <el-table-column label="人口规模" width="100" align="right">
          <template #default="{ row }">
            <span :class="{ 'dv-best': isBest(row, 'popTotal') }">{{ formatNum(row.population + row.work) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="居住" width="90" align="right">
          <template #default="{ row }">
            <span :class="{ 'dv-best': isBest(row, 'population') }">{{ formatNum(row.population) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="工作" width="90" align="right">
          <template #default="{ row }">
            <span :class="{ 'dv-best': isBest(row, 'work') }">{{ formatNum(row.work) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="到访人次" width="100" align="right">
          <template #default="{ row }">
            <span :class="{ 'dv-best': isBest(row, 'visit') }">{{ formatNum(row.visit) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="竞品数" width="80" align="center">
          <template #default="{ row }">
            <span :class="{ 'dv-best': isLowest(row, 'competitorCount') }">{{ row.competitorCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="数据" width="80" align="center">
          <template #default><el-tag size="small" type="warning">2022-04</el-tag></template>
        </el-table-column>
      </el-table>
      <p style="font-size:12px;color:#909399;margin:8px 0 0;">
        <span class="dv-best" style="padding:1px 6px;border-radius:4px;">绿色高亮</span> = 该列最优值（评分/人口/居住/工作/到访取最高，竞品数取最低）
      </p>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import api from '@/utils/api'
import { ElMessage } from 'element-plus'

const mapRef = ref(null)
let map = null
let districtLayer = null

const cities = ref([])
const selectedCity = ref('')
const districts = ref([])
const selectedDistrict = ref(null)
const compareList = ref([])
const compareVisible = ref(false)
const selectAll = ref(false)

const TIER_ORDER = { '一线城市': 0, '新一线城市': 1, '二三线城市': 2 }
const cityGroups = computed(() => {
  const groups = {}
  for (const c of cities.value) {
    if (!groups[c.tier]) groups[c.tier] = []
    groups[c.tier].push(c)
  }
  return Object.entries(groups)
    .sort((a, b) => (TIER_ORDER[a[0]] ?? 9) - (TIER_ORDER[b[0]] ?? 9))
    .map(([tier, cs]) => ({ tier, cities: cs }))
})

const dims = [
  { key: 'scorePopulation', label: '人口规模', color: '#378ADD' },
  { key: 'scoreConsumption', label: '消费能力', color: '#1D9E75' },
  { key: 'scoreCompetition', label: '竞争强度', color: '#7F77DD' },
  { key: 'scoreActivity', label: '客流活跃', color: '#D4537E' }
]

function scoreColor(s) {
  if (s >= 75) return '#67c23a'
  if (s >= 50) return '#e6a23c'
  return '#f56c6c'
}
function scoreTagType(s) {
  if (s >= 75) return 'success'
  if (s >= 50) return 'warning'
  return 'danger'
}
function formatNum(n) {
  if (n == null) return '-'
  return Number(n).toLocaleString()
}

// 对比表格：该列数值最高（竞品外的指标）
function isBest(row, field) {
  if (compareList.value.length < 2) return false
  let max = -Infinity
  for (const c of compareList.value) {
    const v = field === 'popTotal' ? (c.population + c.work) : (c[field] ?? 0)
    if (v > max) max = v
  }
  const rv = field === 'popTotal' ? (row.population + row.work) : (row[field] ?? 0)
  return rv === max && max > -Infinity
}
// 竞品数：数值最低最优
function isLowest(row, field) {
  if (compareList.value.length < 2) return false
  let min = Infinity
  for (const c of compareList.value) {
    const v = c[field] ?? Infinity
    if (v < min) min = v
  }
  return (row[field] ?? Infinity) === min && min < Infinity
}

onMounted(async () => {
  initMap()
  await loadCities()
  // 默认选中第一个一线城市
  const first = cities.value.find(c => c.tier === '一线城市') || cities.value[0]
  if (first) {
    selectedCity.value = first.name
    await loadDistricts(first.name)
  }
})
onBeforeUnmount(() => { if (map) map.remove() })

function initMap() {
  map = L.map(mapRef.value, { center: [31.2304, 121.4737], zoom: 11, zoomControl: true })
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', {
    subdomains: [1, 2, 3, 4],
    maxZoom: 18,
    attribution: '&copy; 高德地图',
    className: 'gaode-gray-tiles'
  }).addTo(map)
}

async function loadCities() {
  try {
    const res = await api.get('/districts/cities')
    cities.value = res.cities || []
  } catch (e) {
    ElMessage.error('加载城市列表失败')
  }
}

async function onCityChange(city) {
  await loadDistricts(city)
}

async function loadDistricts(city) {
  selectedDistrict.value = null
  compareList.value = []
  try {
    const res = await api.get('/districts', { params: { city } })
    districts.value = res.districts || []
    renderDistricts()
    if (districts.value.length > 0) {
      // 定位到该城市中心（取前几个商圈的平均坐标）
      const pts = districts.value.slice(0, 5).map(d => {
        const c = firstCoord(d.geometry)
        return c ? [c[1], c[0]] : null
      }).filter(Boolean)
      if (pts.length > 0 && map) {
        const bounds = L.latLngBounds(pts)
        map.fitBounds(bounds, { padding: [30, 30] })
      }
    }
  } catch (e) {
    ElMessage.error('加载商圈失败: ' + (e.response?.data?.message || e.message))
  }
}

function firstCoord(geometry) {
  if (!geometry) return null
  if (geometry.type === 'Polygon') return geometry.coordinates[0][0]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates[0][0][0]
  return null
}

function renderDistricts() {
  if (!map) return
  if (districtLayer) map.removeLayer(districtLayer)
  districtLayer = L.layerGroup().addTo(map)
  for (const d of districts.value) {
    const color = scoreColor(d.score)
    const layer = L.geoJSON(d.geometry, {
      style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.18 }
    })
    layer.on('click', () => selectDistrict(d))
    layer.bindTooltip(`${d.name} · ${d.score}分`, { sticky: true })
    layer.addTo(districtLayer)
  }
}

function selectDistrict(d) {
  selectedDistrict.value = d
  if (map) {
    const pts = [firstCoord(d.geometry)]
    if (pts[0]) map.fitBounds(L.latLngBounds([pts[0][1], pts[0][0]]), { padding: [40, 40], maxZoom: 14 })
  }
}

function isCompared(name) {
  return compareList.value.some(c => c.name === name)
}
function toggleCompare(d, checked) {
  if (checked) {
    if (compareList.value.length >= 5) { ElMessage.warning('最多对比 5 个商圈'); return }
    compareList.value.push(d)
  } else {
    compareList.value = compareList.value.filter(c => c.name !== d.name)
  }
}
function toggleSelectAll(val) {
  compareList.value = val ? districts.value.slice(0, 5) : []
}
function openCompare() {
  if (compareList.value.length < 2) { ElMessage.warning('请至少选择 2 个商圈'); return }
  compareVisible.value = true
}
</script>

<style scoped>
.district-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 14px 18px;
  box-sizing: border-box;
  background: #f5f7fa;
}
.dv-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.dv-body {
  flex: 1;
  display: flex;
  gap: 12px;
  min-height: 0;
}
.dv-side {
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.dv-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}
.dv-list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  font-size: 12px;
  color: #909399;
  border-bottom: 1px solid #f0f2f5;
}
.dv-list-body {
  flex: 1;
  overflow-y: auto;
}
.dv-item {
  padding: 8px 12px;
  border-bottom: 1px solid #f5f7fa;
  cursor: pointer;
}
.dv-item:hover { background: #f7f9fc; }
.dv-item.active { background: #e6f1fb; }
.dv-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dv-item-name {
  flex: 1;
  font-size: 13px;
  color: #303133;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dv-item-score {
  font-size: 15px;
  font-weight: 700;
}
.dv-item-meta {
  display: flex;
  gap: 10px;
  margin: 4px 0 0 26px;
  font-size: 11px;
  color: #909399;
}
.dv-map-wrap {
  flex: 1;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  background: #fff;
}
.dv-map {
  width: 100%;
  height: 100%;
}
:deep(.gaode-gray-tiles) {
  img {
    filter: grayscale(100%) brightness(1.05);
  }
}
.dv-detail {
  position: absolute;
  right: 14px;
  top: 14px;
  width: 300px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  padding: 12px 14px;
  z-index: 800;
}
.dv-detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}
.dv-detail-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 6px 0 10px;
  font-size: 12px;
  color: #909399;
}
.dv-dim {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.dv-dim-label {
  width: 56px;
  font-size: 12px;
  color: #606266;
}
.dv-facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}
.dv-fact {
  background: #f7f9fc;
  border-radius: 6px;
  padding: 6px 8px;
  text-align: center;
}
.dv-fact span { display: block; font-size: 11px; color: #909399; }
.dv-fact b { font-size: 13px; color: #303133; }
:deep(.dv-best) {
  background: #e1f5ee !important;
  color: #0f6e56 !important;
  font-weight: 600;
  border-radius: 4px;
  padding: 1px 5px;
  display: inline-block;
}
</style>
