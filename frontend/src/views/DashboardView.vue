<template>
  <div class="dashboard-screen">
    <!-- 顶部标题栏 -->
    <div class="ds-header">
      <div class="ds-title-left">
        <div class="ds-logo-bar"></div>
        <h1 class="ds-title">选址赢家 Online · 数据大屏</h1>
      </div>
      <div class="ds-clock">
        <span class="ds-time">{{ now }}</span>
        <span class="ds-date">{{ today }}</span>
      </div>
      <div class="ds-header-right">
        <span class="ds-updated">更新 {{ updatedTime }}</span>
        <el-button size="small" class="ds-exit-btn" @click="exitScreen">
          <el-icon><Close /></el-icon>退出大屏
        </el-button>
      </div>
    </div>

    <div class="ds-body">
      <!-- 左列：KPI 指标 -->
      <div class="ds-col ds-col-left">
        <div class="ds-panel ds-kpi-grid">
          <div v-for="k in kpiList" :key="k.label" class="ds-kpi">
            <div class="ds-kpi-num" :style="{ color: k.color }">{{ k.value }}</div>
            <div class="ds-kpi-label">{{ k.label }}</div>
          </div>
        </div>
      </div>

      <!-- 中列：地图 -->
      <div class="ds-col ds-col-center">
        <div class="ds-panel ds-map-panel">
          <div id="ds-map" ref="mapRef" class="ds-map"></div>
          <div class="ds-map-overlay">
            <span class="ds-map-title">全国门店分布</span>
            <span class="ds-map-sub">我的门店 {{ data?.kpi?.markers ?? 0 }} · 竞品 {{ data?.kpi?.competitors ?? 0 }}</span>
          </div>
        </div>
      </div>

      <!-- 右列：图表 -->
      <div class="ds-col ds-col-right">
        <div class="ds-chart-grid">
          <div class="ds-panel">
            <div class="ds-chart-title">门店类型分布</div>
            <div ref="typeChartRef" class="ds-chart"></div>
          </div>
          <div class="ds-panel">
            <div class="ds-chart-title">门店城市 TOP10</div>
            <div ref="cityChartRef" class="ds-chart"></div>
          </div>
          <div class="ds-panel">
            <div class="ds-chart-title">竞品品牌 TOP10</div>
            <div ref="brandChartRef" class="ds-chart"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部跑马灯 -->
    <div class="ds-marquee">
      <span class="ds-marquee-label">数据简报</span>
      <div class="ds-marquee-track">
        <span class="ds-marquee-text">{{ marqueeText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import axios from 'axios'
import { useUserStore } from '@/stores/user'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Close } from '@element-plus/icons-vue'
import * as echarts from 'echarts'

const userStore = useUserStore()
const data = ref(null)
const mapRef = ref(null)
const typeChartRef = ref(null)
const cityChartRef = ref(null)
const brandChartRef = ref(null)

const now = ref('')
const today = ref('')
const updatedTime = ref('--:--:--')
let clockTimer = null
let refreshTimer = null
let map = null
let markerLayer = null
let heatLayer = null
let charts = []

// KPI 卡片
const kpiList = computed(() => {
  const k = data.value?.kpi || {}
  return [
    { label: '我的门店', value: k.markers ?? 0, color: '#40c4ff' },
    { label: '竞品门店', value: k.competitors ?? 0, color: '#ff6b6b' },
    { label: '购物中心', value: k.centers ?? 0, color: '#ffd166' },
    { label: '品牌门店', value: k.brandStores ?? 0, color: '#9b8cff' },
    { label: '覆盖城市', value: k.markerCities ?? 0, color: '#06d6a0' },
    { label: '竞品城市', value: k.compCities ?? 0, color: '#f98fb4' },
    { label: '我的查询', value: k.myPurchases ?? 0, color: '#40c4ff' },
    { label: '配额剩余', value: k.quotaRemaining ?? 0, color: '#ffd166' }
  ]
})

const marqueeText = computed(() => {
  const k = data.value?.kpi || {}
  return `全国共 ${k.markers ?? 0} 家门店、${k.competitors ?? 0} 家竞品、${k.centers ?? 0} 个购物中心 · 覆盖 ${k.markerCities ?? 0} 个城市 · 累计查询 ${k.myPurchases ?? 0} 次 · 系统数据每 60 秒自动刷新`
})

const updateClock = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  now.value = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  today.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const fetchData = async () => {
  try {
    const { data: res } = await axios.get('/api/dashboard/summary')
    if (res.success) {
      data.value = res
      updatedTime.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      await nextTick()
      renderCharts()
      renderMap()
    }
  } catch (e) {
    console.error('大屏数据加载失败:', e)
  }
}

const renderCharts = () => {
  charts.forEach(c => c.dispose())
  charts = []
  const k = data.value?.kpi || {}

  // 1. 门店类型分布（饼图）
  if (typeChartRef.value) {
    const c = echarts.init(typeChartRef.value)
    const types = data.value?.charts?.markerTypes || []
    c.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      legend: { textStyle: { color: '#a8b4c8' }, bottom: 0, itemWidth: 10, itemHeight: 10 },
      series: [{
        type: 'pie',
        radius: ['35%', '65%'],
        center: ['50%', '45%'],
        itemStyle: { borderRadius: 4, borderColor: '#0a1a2f', borderWidth: 2 },
        label: { color: '#c6d4ea', fontSize: 11 },
        data: types.length ? types : [{ name: '暂无', value: 1 }]
      }]
    })
    charts.push(c)
  }

  // 2. 门店城市 TOP10（横向柱状）
  if (cityChartRef.value) {
    const c = echarts.init(cityChartRef.value)
    const cities = (data.value?.charts?.markerCityTop || []).slice().reverse()
    c.setOption({
      backgroundColor: 'transparent',
      grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'value', axisLabel: { color: '#7e8ca6' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
      yAxis: { type: 'category', data: cities.map(i => i.name), axisLabel: { color: '#a8b4c8', fontSize: 11 } },
      series: [{
        type: 'bar',
        data: cities.map(i => i.value),
        itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#1a4f8f' }, { offset: 1, color: '#40c4ff' }]), borderRadius: [0, 4, 4, 0] },
        barWidth: 12
      }]
    })
    charts.push(c)
  }

  // 3. 竞品品牌 TOP10（横向柱状）
  if (brandChartRef.value) {
    const c = echarts.init(brandChartRef.value)
    const brands = (data.value?.charts?.compBrandTop || []).slice().reverse()
    c.setOption({
      backgroundColor: 'transparent',
      grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'value', axisLabel: { color: '#7e8ca6' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
      yAxis: { type: 'category', data: brands.map(i => i.name), axisLabel: { color: '#a8b4c8', fontSize: 11 } },
      series: [{
        type: 'bar',
        data: brands.map(i => i.value),
        itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#7a2d63' }, { offset: 1, color: '#ff6b6b' }]), borderRadius: [0, 4, 4, 0] },
        barWidth: 12
      }]
    })
    charts.push(c)
  }
}

const renderMap = async () => {
  if (!mapRef.value) return
  if (!map) {
    map = L.map('ds-map', { zoomControl: false, attributionControl: false }).setView([35, 108], 4)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map)
  }
  if (markerLayer) { map.removeLayer(markerLayer); markerLayer = null }
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null }

  const k = data.value?.kpi || {}
  const myCount = Math.min(k.markers ?? 0, 300)
  const compCount = Math.min(k.competitors ?? 0, 200)

  // 随机生成分布点（基于城市中心随机撒点，大屏示意用）
  const cityCenters = [
    [39.9, 116.4], [31.23, 121.47], [23.13, 113.26], [22.54, 114.06], [30.57, 104.06],
    [30.27, 120.15], [28.68, 115.86], [32.06, 118.78], [36.65, 117.0], [34.34, 108.94],
    [29.56, 106.55], [26.65, 106.63], [24.48, 118.08], [25.03, 102.72], [43.82, 87.61]
  ]
  const rand = (c, spread) => [c[0] + (Math.random() - 0.5) * spread, c[1] + (Math.random() - 0.5) * spread]

  const myPoints = []
  for (let i = 0; i < myCount; i++) {
    const c = cityCenters[Math.floor(Math.random() * cityCenters.length)]
    myPoints.push(rand(c, 3))
  }
  const compPoints = []
  for (let i = 0; i < compCount; i++) {
    const c = cityCenters[Math.floor(Math.random() * cityCenters.length)]
    compPoints.push(rand(c, 3))
  }

  markerLayer = L.layerGroup()
  myPoints.forEach(p => {
    L.circleMarker(p, { radius: 3, color: '#40c4ff', fillColor: '#40c4ff', fillOpacity: 0.8, weight: 0 }).addTo(markerLayer)
  })
  compPoints.forEach(p => {
    L.circleMarker(p, { radius: 2.5, color: '#ff6b6b', fillColor: '#ff6b6b', fillOpacity: 0.6, weight: 0 }).addTo(markerLayer)
  })
  markerLayer.addTo(map)

  // 热力图（叠加竞品密度）
  try {
    const heat = await import('leaflet.heat')
    const allPoints = compPoints.concat(myPoints).map(p => [p[0], p[1], 0.8])
    heatLayer = heat.default(allPoints, { radius: 30, blur: 15, maxZoom: 10, minOpacity: 0.3 }).addTo(map)
  } catch (e) {
    console.warn('热力图加载失败:', e)
  }
}

const exitScreen = () => {
  window.close()
  // 兜底：新窗口关不掉就跳回首页
  if (!window.closed) {
    window.location.href = '/'
  }
}

const handleKey = (e) => {
  if (e.key === 'Escape') exitScreen()
}

onMounted(async () => {
  updateClock()
  clockTimer = setInterval(updateClock, 1000)
  await fetchData()
  refreshTimer = setInterval(fetchData, 60000)
  window.addEventListener('keydown', handleKey)
})

onBeforeUnmount(() => {
  clearInterval(clockTimer)
  clearInterval(refreshTimer)
  window.removeEventListener('keydown', handleKey)
  charts.forEach(c => c.dispose())
  if (map) { try { map.remove() } catch(e) {} }
})
</script>

<style scoped>
.dashboard-screen {
  position: fixed;
  inset: 0;
  background: linear-gradient(160deg, #0a1a2f 0%, #0d2440 45%, #0a1a2f 100%);
  color: #e6f0ff;
  display: flex;
  flex-direction: column;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  overflow: hidden;
}

/* 顶部 */
.ds-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 28px;
  border-bottom: 1px solid rgba(64, 196, 255, 0.2);
  background: rgba(10, 26, 47, 0.8);
  flex-shrink: 0;
}

.ds-title-left { display: flex; align-items: center; gap: 12px; }
.ds-logo-bar {
  width: 6px; height: 30px; border-radius: 3px;
  background: linear-gradient(180deg, #40c4ff, #06d6a0);
}
.ds-title { font-size: 22px; font-weight: 600; letter-spacing: 3px; margin: 0; color: #e6f0ff; }

.ds-clock { display: flex; flex-direction: column; align-items: center; line-height: 1.2; }
.ds-time { font-size: 26px; font-weight: 600; color: #40c4ff; font-family: 'Courier New', monospace; letter-spacing: 2px; }
.ds-date { font-size: 12px; color: #7e8ca6; }

.ds-header-right { display: flex; align-items: center; gap: 12px; }
.ds-updated { font-size: 12px; color: #7e8ca6; }
.ds-exit-btn { background: rgba(64, 196, 255, 0.15); border: 1px solid rgba(64, 196, 255, 0.4); color: #40c4ff; }

/* 主体 */
.ds-body {
  flex: 1;
  display: flex;
  gap: 14px;
  padding: 14px 28px;
  min-height: 0;
}

.ds-col { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.ds-col-left { width: 220px; flex-shrink: 0; }
.ds-col-center { flex: 1; min-width: 0; }
.ds-col-right { width: 330px; flex-shrink: 0; }

.ds-panel {
  background: rgba(16, 42, 76, 0.55);
  border: 1px solid rgba(64, 196, 255, 0.15);
  border-radius: 8px;
  padding: 14px;
  box-shadow: inset 0 0 30px rgba(64, 196, 255, 0.04);
}

/* KPI */
.ds-kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ds-kpi {
  text-align: center;
  padding: 14px 6px;
  background: rgba(10, 26, 47, 0.6);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.ds-kpi-num { font-size: 26px; font-weight: 700; font-family: 'Courier New', monospace; }
.ds-kpi-label { font-size: 12px; color: #8fa3c0; margin-top: 4px; }

/* 地图 */
.ds-map-panel { flex: 1; position: relative; padding: 0; overflow: hidden; min-height: 0; }
.ds-map { width: 100%; height: 100%; min-height: 300px; background: #0a1a2f; }
.ds-map :deep(.leaflet-tile-pane) { filter: invert(1) hue-rotate(190deg) saturate(0.6) brightness(0.9); }
.ds-map :deep(.leaflet-container) { background: #0a1a2f; }
.ds-map-overlay {
  position: absolute;
  top: 10px; left: 10px;
  z-index: 1000;
  padding: 8px 14px;
  background: rgba(10, 26, 47, 0.8);
  border: 1px solid rgba(64, 196, 255, 0.3);
  border-radius: 6px;
}
.ds-map-title { display: block; font-size: 14px; font-weight: 600; color: #40c4ff; }
.ds-map-sub { display: block; font-size: 11px; color: #8fa3c0; margin-top: 2px; }

/* 图表 */
.ds-chart-grid { display: flex; flex-direction: column; gap: 14px; flex: 1; min-height: 0; }
.ds-chart-grid .ds-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ds-chart-title { font-size: 13px; font-weight: 600; color: #b8c9e4; margin-bottom: 6px; }
.ds-chart { flex: 1; min-height: 0; }

/* 跑马灯 */
.ds-marquee {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 28px;
  border-top: 1px solid rgba(64, 196, 255, 0.2);
  background: rgba(10, 26, 47, 0.8);
  flex-shrink: 0;
}
.ds-marquee-label {
  font-size: 12px;
  color: #40c4ff;
  border: 1px solid rgba(64, 196, 255, 0.4);
  padding: 2px 10px;
  border-radius: 999px;
  flex-shrink: 0;
}
.ds-marquee-track { overflow: hidden; flex: 1; white-space: nowrap; }
.ds-marquee-text {
  display: inline-block;
  font-size: 13px;
  color: #8fa3c0;
  animation: ds-marquee 25s linear infinite;
}
@keyframes ds-marquee {
  0% { transform: translateX(100%); }
  100% { transform: translateX(-100%); }
}
</style>
