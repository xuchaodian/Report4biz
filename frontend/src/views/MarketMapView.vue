<template>
  <div class="market-map-view">
    <!-- 页头 -->
    <div class="mm-header">
      <div>
        <h2 style="margin:0;font-size:18px;">🗺️ 市场地图</h2>
        <p style="margin:4px 0 0;font-size:13px;color:#909399;">
          城市市场机会评分：市场规模 × 竞争强度 × 品牌空白 × 消费潜力，找出值得进入的城市
        </p>
      </div>
      <div class="mm-legend">
        <span class="mm-legend-item"><i style="background:#67c23a"></i>优先进入 ≥75</span>
        <span class="mm-legend-item"><i style="background:#e6a23c"></i>可观察 50-74</span>
        <span class="mm-legend-item"><i style="background:#f56c6c"></i>谨慎 &lt;50</span>
      </div>
    </div>

    <!-- 数据概览 -->
    <div class="mm-kpi-row" v-if="summary">
      <div class="mm-kpi"><div class="mm-kpi-num">{{ summary.totalCities }}</div><div class="mm-kpi-label">覆盖城市</div></div>
      <div class="mm-kpi"><div class="mm-kpi-num c-green">{{ summary.priority }}</div><div class="mm-kpi-label">优先进入</div></div>
      <div class="mm-kpi"><div class="mm-kpi-num c-amber">{{ summary.watch }}</div><div class="mm-kpi-label">可观察</div></div>
      <div class="mm-kpi"><div class="mm-kpi-num c-red">{{ summary.caution }}</div><div class="mm-kpi-label">谨慎</div></div>
      <div class="mm-kpi"><div class="mm-kpi-num">{{ summary.provinceCount }}</div><div class="mm-kpi-label">涉及省份</div></div>
    </div>

    <div class="mm-body">
      <!-- 视图切换 -->
      <div class="mm-view-tabs">
        <div class="mm-tab" :class="{ active: viewMode === 'map' }" @click="switchView('map')">
          <el-icon><MapLocation /></el-icon>省份地图
        </div>
        <div class="mm-tab" :class="{ active: viewMode === 'list' }" @click="switchView('list')">
          <el-icon><Rank /></el-icon>省份榜单
        </div>
      </div>

      <!-- 左：省份机会地图/榜单 -->
      <div class="mm-left">
        <div class="mm-panel-title">省份机会指数 <span class="mm-sub">(省内最优城市)</span></div>
        <div v-show="viewMode === 'map'" class="mm-prov-map" v-loading="loading">
          <div id="province-map" ref="provinceMapEl" class="province-map-container"></div>
        </div>
        <div v-show="viewMode === 'list'" class="mm-prov-list" v-loading="loading">
          <div v-for="p in provinces" :key="p.province" class="mm-prov-item" :class="{ selected: selectedProvince === p.province }" @click="selectProvince(p.province)">
            <div class="mm-prov-rank">{{ p.rank }}</div>
            <div class="mm-prov-name">{{ p.province }}</div>
            <div class="mm-prov-bar">
              <div class="mm-prov-fill" :style="{ width: p.opportunity + '%', background: levelColor(p.level) }"></div>
            </div>
            <div class="mm-prov-score">{{ p.opportunity }}</div>
            <div class="mm-prov-level" :style="{ color: levelColor(p.level) }">{{ p.level }}</div>
          </div>
        </div>
      </div>

      <!-- 右：城市机会 Top 榜 -->
      <div class="mm-right">
        <div class="mm-panel-title">城市机会排行榜</div>
        <el-table :data="filteredCities" stripe border size="small" :max-height="640" style="width:100%" @row-click="openCityDetail" class="mm-table">
          <el-table-column type="index" label="#" width="42" align="center" />
          <el-table-column prop="city" label="城市" min-width="70" />
          <el-table-column prop="province" label="省份" width="70" />
          <el-table-column prop="population" label="人口(万)" width="80" align="right" sortable />
          <el-table-column prop="myStores" label="我的店" width="70" align="right" sortable />
          <el-table-column prop="compStores" label="竞品" width="70" align="right" sortable />
          <el-table-column label="市场机会" width="130" align="center">
            <template #default="{ row }">
              <div class="mm-cell-score">
                <div class="mm-cell-bar"><div class="mm-cell-fill" :style="{ width: row.opportunity + '%', background: levelColor(row.level) }"></div></div>
                <span class="mm-cell-num" :style="{ color: levelColor(row.level) }">{{ row.opportunity }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="建议" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.level === '优先进入' ? 'success' : (row.level === '可观察' ? 'warning' : 'danger')" size="small">{{ row.level }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 城市详情抽屉 -->
    <el-drawer v-model="detailVisible" :title="selectedCity ? selectedCity.city + ' 市场分析' : ''" size="420px">
      <template v-if="selectedCity">
        <!-- 总分 -->
        <div class="mm-detail-score" :style="{ borderColor: levelColor(selectedCity.level) }">
          <div class="mm-detail-num" :style="{ color: levelColor(selectedCity.level) }">{{ selectedCity.opportunity }}</div>
          <div class="mm-detail-level" :style="{ color: levelColor(selectedCity.level) }">{{ selectedCity.level }}</div>
          <div class="mm-detail-tip">市场机会综合评分（0-100）</div>
        </div>

        <!-- 四维评分 -->
        <div class="mm-detail-dim-title">评分维度明细</div>
        <div class="mm-dim" v-for="dim in dims" :key="dim.key">
          <div class="mm-dim-head">
            <span>{{ dim.label }}</span>
            <span class="mm-dim-weight">权重 {{ Math.round(dim.weight * 100) }}%</span>
            <span class="mm-dim-val" :style="{ color: dimScoreColor(dim.key) }">{{ selectedCity.scores[dim.key] }}</span>
          </div>
          <div class="mm-dim-bar">
            <div class="mm-dim-fill" :style="{ width: selectedCity.scores[dim.key] + '%', background: dimScoreColor(dim.key) }"></div>
          </div>
          <div class="mm-dim-desc">{{ dim.desc }}</div>
        </div>

        <!-- 城市基本面 -->
        <div class="mm-detail-dim-title">城市基本面</div>
        <div class="mm-facts">
          <div class="mm-fact"><span>常住人口</span><b>{{ selectedCity.population.toLocaleString() }} 万</b></div>
          <div class="mm-fact"><span>GDP</span><b>{{ selectedCity.gdp.toLocaleString() }} 亿</b></div>
          <div class="mm-fact"><span>社零总额</span><b>{{ selectedCity.retail.toLocaleString() }} 亿</b></div>
          <div class="mm-fact"><span>人均可支配收入</span><b>{{ selectedCity.income.toLocaleString() }} 元</b></div>
          <div class="mm-fact"><span>人均消费支出</span><b>{{ selectedCity.expense.toLocaleString() }} 元</b></div>
          <div class="mm-fact"><span>城市等级</span><b>{{ selectedCity.level || '-' }}</b></div>
          <div class="mm-fact"><span>我的门店</span><b>{{ selectedCity.myStores }} 家</b></div>
          <div class="mm-fact"><span>竞品门店</span><b>{{ selectedCity.compStores }} 家</b></div>
          <div class="mm-fact"><span>品牌门店</span><b>{{ selectedCity.brandStores }} 家</b></div>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import api from '@/utils/api'
import { ElMessage } from 'element-plus'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const loading = ref(false)
const cities = ref([])
const provinces = ref([])
const selectedProvince = ref('')
const detailVisible = ref(false)
const selectedCity = ref(null)
const viewMode = ref('map')
const provinceMapEl = ref(null)
let provinceMap = null
let geoLayer = null
let chinaGeoJson = null

const WEIGHTS = { marketSize: 0.30, competition: 0.25, brandGap: 0.25, consumption: 0.20 }

const levelColor = (lvl) => {
  if (lvl === '优先进入') return '#67c23a'
  if (lvl === '可观察') return '#e6a23c'
  return '#f56c6c'
}

const dimScoreColor = (key) => {
  const map = { marketSize: '#378ADD', competition: '#7F77DD', brandGap: '#1D9E75', consumption: '#D4537E' }
  return map[key] || '#909399'
}

const dims = computed(() => [
  { key: 'marketSize', label: '市场规模', weight: WEIGHTS.marketSize, desc: '常住人口 × 社零总额（越大越好）' },
  { key: 'competition', label: '竞争强度', weight: WEIGHTS.competition, desc: '竞品密度越低分越高（蓝海机会）' },
  { key: 'brandGap', label: '品牌空白度', weight: WEIGHTS.brandGap, desc: '本品牌渗透率越低越空白，机会越大' },
  { key: 'consumption', label: '消费潜力', weight: WEIGHTS.consumption, desc: '人均可支配收入 + 消费支出（购买力）' }
])

const summary = computed(() => {
  if (!cities.value.length) return null
  return {
    totalCities: cities.value.length,
    priority: cities.value.filter(c => c.level === '优先进入').length,
    watch: cities.value.filter(c => c.level === '可观察').length,
    caution: cities.value.filter(c => c.level === '谨慎').length,
    provinceCount: new Set(cities.value.map(c => c.province)).size
  }
})

const filteredCities = computed(() => {
  if (!selectedProvince.value) return cities.value
  return cities.value.filter(c => c.province === selectedProvince.value)
})

const switchView = async (mode) => {
  viewMode.value = mode
  if (mode === 'map') {
    await nextTick()
    initProvinceMap()
  }
}

const selectProvince = (prov) => {
  selectedProvince.value = prov === selectedProvince.value ? '' : prov
}

const openCityDetail = (row) => {
  selectedCity.value = row
  detailVisible.value = true
}

// ===== 省份地图着色（高德瓦片 + 高德行政区划 GeoJSON） =====
const colorForScore = (score) => {
  if (score >= 75) return '#67c23a'
  if (score >= 50) return '#e6a23c'
  return '#f56c6c'
}

const provinceScoreMap = computed(() => {
  const m = {}
  provinces.value.forEach(p => { m[p.province] = p.opportunity })
  return m
})

const initProvinceMap = async () => {
  if (!provinceMapEl.value) return
  if (provinceMap) { provinceMap.invalidateSize(); return }

  // 高德瓦片（合规：高德官方瓦片服务，与主地图一致）
  provinceMap = L.map('province-map', {
    center: [35.8, 104.0],
    zoom: 4,
    minZoom: 3,
    maxZoom: 7,
    zoomControl: false,
    attributionControl: false,
    scrollWheelZoom: false
  })
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', {
    subdomains: [1, 2, 3, 4],
    maxZoom: 18
  }).addTo(provinceMap)

  // 加载中国省级行政区划 GeoJSON（高德数据，合规含台湾）
  if (!chinaGeoJson) {
    try {
      const resp = await fetch('/china.json')
      chinaGeoJson = await resp.json()
    } catch (e) {
      ElMessage.error('省份边界数据加载失败')
      return
    }
  }

  // 按机会分着色
  const scoreMap = provinceScoreMap.value
  geoLayer = L.geoJSON(chinaGeoJson, {
    style: (feature) => {
      const name = feature.properties?.name || ''
      const score = scoreMap[name]
      const base = score ? colorForScore(score) : '#dcdfe6'
      return {
        color: '#fff',
        weight: 1,
        fillColor: base,
        fillOpacity: score ? 0.65 : 0.35
      }
    },
    onEachFeature: (feature, layer) => {
      const name = feature.properties?.name || ''
      const score = scoreMap[name]
      layer.on('click', () => {
        // 点击省份 → 筛选城市榜 + 高亮
        selectedProvince.value = selectedProvince.value === name ? '' : name
        // 重置样式
        geoLayer.eachLayer(l => {
          const n = l.feature?.properties?.name || ''
          const s = scoreMap[n]
          l.setStyle({
            color: '#fff',
            weight: 1,
            fillColor: s ? colorForScore(s) : '#dcdfe6',
            fillOpacity: n === selectedProvince.value ? 0.95 : (s ? 0.65 : 0.35)
          })
        })
      })
      // Tooltip
      layer.bindTooltip(`${name}${score !== undefined ? ' · 机会 ' + score + ' 分' : ''}`, {
        sticky: true,
        className: 'mm-tooltip'
      })
    }
  }).addTo(provinceMap)
  // 计算陆地边界 fit；容器 264x590 较窄，fitBounds 计算的 zoom 偏小，
  // 所以改为：陆地边界的中点 + 手动算合适 zoom（4 适合窄容器展示中国全境）
  const landBounds = L.latLngBounds([])
  geoLayer.eachLayer(l => {
    const name = l.feature?.properties?.name || ''
    if (!name) return
    const b = l.getBounds()
    if (b.isValid()) landBounds.extend(b)
  })
  if (landBounds.isValid()) {
    const center = landBounds.getCenter()
    // 窄列下 zoom 4 显示中国全境 + 9 段线；点击省份后再 zoom in
    provinceMap.setView([center.lat, center.lng], 4)
  } else {
    provinceMap.setView([35.5, 105], 4)
  }
}

const loadData = async () => {
  loading.value = true
  try {
    const res = await api.get('/market-map/opportunity')
    if (res.success) {
      cities.value = res.cities || []
      provinces.value = (res.provinces || []).map((p, i) => ({ ...p, rank: i + 1 }))
      if (res.weights) Object.assign(WEIGHTS, res.weights)
      await nextTick()
      if (viewMode.value === 'map') initProvinceMap()
    } else {
      ElMessage.error(res.message || '加载失败')
    }
  } catch (e) {
    ElMessage.error('加载市场地图失败: ' + (e.response?.data?.message || e.message))
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

onBeforeUnmount(() => {
  if (provinceMap) {
    provinceMap.remove()
    provinceMap = null
  }
})
</script>

<style scoped>
.market-map-view {
  padding: 20px;
}
.mm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.mm-legend {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: #606266;
}
.mm-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}
.mm-legend-item i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}

.mm-kpi-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}
.mm-kpi {
  flex: 1;
  background: #f7f9fc;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 14px;
  text-align: center;
}
.mm-kpi-num {
  font-size: 22px;
  font-weight: 500;
  color: #303133;
}
.mm-kpi-num.c-green { color: #67c23a; }
.mm-kpi-num.c-amber { color: #e6a23c; }
.mm-kpi-num.c-red { color: #f56c6c; }
.mm-kpi-label {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.mm-body {
  display: flex;
  gap: 16px;
}
.mm-view-tabs {
  position: absolute;
  left: 20px;
  margin-top: 46px;
  display: flex;
  gap: 4px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 3px;
  z-index: 10;
}
.mm-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  font-size: 13px;
  color: #606266;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.mm-tab:hover { color: #409eff; }
.mm-tab.active {
  background: #409eff;
  color: #fff;
}
.mm-left {
  width: 380px;
  flex-shrink: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 14px;
  height: 640px;
  overflow: hidden;
}
.mm-prov-map {
  width: 100%;
  height: 590px;
  border-radius: 8px;
  overflow: hidden;
}
.province-map-container {
  width: 100%;
  height: 100%;
}
.mm-tooltip {
  font-size: 12px;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
.mm-right {
  flex: 1;
  min-width: 0;
}
.mm-panel-title {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 12px;
}
.mm-sub {
  font-size: 11px;
  color: #c0c4cc;
  font-weight: 400;
}

.mm-prov-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.mm-prov-item:hover { background: #f5f7fa; }
.mm-prov-item.selected { background: #e6f1fb; }
.mm-prov-rank {
  width: 22px;
  text-align: center;
  font-size: 13px;
  color: #909399;
  font-weight: 500;
}
.mm-prov-name {
  width: 70px;
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-prov-bar {
  flex: 1;
  height: 8px;
  background: #f0f2f7;
  border-radius: 4px;
  overflow: hidden;
}
.mm-prov-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s;
}
.mm-prov-score {
  width: 28px;
  text-align: right;
  font-size: 13px;
  font-weight: 500;
  color: #303133;
}
.mm-prov-level {
  width: 52px;
  text-align: right;
  font-size: 12px;
}

.mm-table :deep(.el-table__row) {
  cursor: pointer;
}
.mm-cell-score {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mm-cell-bar {
  flex: 1;
  height: 8px;
  background: #f0f2f7;
  border-radius: 4px;
  overflow: hidden;
}
.mm-cell-fill {
  height: 100%;
  border-radius: 4px;
}
.mm-cell-num {
  font-size: 13px;
  font-weight: 500;
  width: 26px;
  text-align: right;
}

.mm-detail-score {
  border: 2px solid #67c23a;
  border-radius: 12px;
  padding: 20px;
  text-align: center;
  margin-bottom: 18px;
  background: #fafcff;
}
.mm-detail-num {
  font-size: 42px;
  font-weight: 500;
  line-height: 1;
}
.mm-detail-level {
  font-size: 15px;
  margin-top: 6px;
  font-weight: 500;
}
.mm-detail-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 6px;
}
.mm-detail-dim-title {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  margin: 14px 0 10px;
}
.mm-dim {
  margin-bottom: 12px;
}
.mm-dim-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #303133;
  margin-bottom: 5px;
}
.mm-dim-weight {
  font-size: 11px;
  color: #c0c4cc;
}
.mm-dim-val {
  margin-left: auto;
  font-weight: 500;
  font-size: 14px;
}
.mm-dim-bar {
  height: 8px;
  background: #f0f2f7;
  border-radius: 4px;
  overflow: hidden;
}
.mm-dim-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s;
}
.mm-dim-desc {
  font-size: 11px;
  color: #b0b4bb;
  margin-top: 4px;
}
.mm-facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.mm-fact {
  background: #f7f9fc;
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mm-fact span {
  font-size: 11px;
  color: #909399;
}
.mm-fact b {
  font-size: 13px;
  color: #303133;
}
</style>
