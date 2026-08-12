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
      <!-- 左列：KPI + 类型分布 -->
      <div class="ds-col ds-col-left">
        <div class="ds-panel ds-kpi-grid">
          <div v-for="k in kpiList" :key="k.label" class="ds-kpi">
            <div class="ds-kpi-num" :style="{ color: k.color }">{{ k.value }}</div>
            <div class="ds-kpi-label">{{ k.label }}</div>
          </div>
        </div>
        <div class="ds-panel ds-chart-panel">
          <div class="ds-chart-title">门店类型分布</div>
          <div ref="typeChartRef" class="ds-chart"></div>
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
          <!-- 图层开关（右上角） -->
          <div class="ds-layer-switch">
            <div class="ds-layer-level">{{ aggLevel === 'province' ? '省级聚合 · 放大查看城市' : '城市级聚合' }}</div>
            <label class="ds-layer-item">
              <span class="ds-layer-dot" style="background:#40c4ff;"></span>
              <span>我的门店</span>
              <el-switch v-model="showMyLayer" size="small" @change="renderMap" />
            </label>
            <label class="ds-layer-item">
              <span class="ds-layer-dot" style="background:#ff6b6b;"></span>
              <span>竞品门店</span>
              <el-switch v-model="showCompLayer" size="small" @change="renderMap" />
            </label>
          </div>
        </div>
      </div>

      <!-- 右列：图表 -->
      <div class="ds-col ds-col-right">
        <div class="ds-chart-grid">
          <div class="ds-panel ds-chart-panel ds-chart-panel-lg">
            <div class="ds-chart-title">门店城市 TOP10</div>
            <div ref="cityChartRef" class="ds-chart"></div>
          </div>
          <div class="ds-panel ds-chart-panel">
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
const showMyLayer = ref(true)
const showCompLayer = ref(false)  // 竞品聚合默认不显示
let clockTimer = null
let refreshTimer = null
let map = null
let chinaLayer = null
let provinceLabelLayer = null  // 省份名称标签图层（独立于底图）
let markerLayer = null
let heatLayer = null
let mapFitted = false
let chinaLoaded = false
let aggLevel = 'province'  // 当前聚合级别：province（缩小）/ city（放大）
let charts = []

// KPI 卡片（不含购物中心/品牌门店）
const kpiList = computed(() => {
  const k = data.value?.kpi || {}
  return [
    { label: '我的门店', value: k.markers ?? 0, color: '#40c4ff' },
    { label: '竞品门店', value: k.competitors ?? 0, color: '#ff6b6b' },
    { label: '覆盖城市', value: k.markerCities ?? 0, color: '#06d6a0' },
    { label: '竞品城市', value: k.compCities ?? 0, color: '#f98fb4' },
    { label: '购买次数', value: k.myPurchases ?? 0, color: '#40c4ff' },
    { label: '剩余次数', value: k.quotaRemaining ?? 0, color: '#ffd166' }
  ]
})

const marqueeText = computed(() => {
  const k = data.value?.kpi || {}
  return `全国共 ${k.markers ?? 0} 家门店、${k.competitors ?? 0} 家竞品 · 覆盖 ${k.markerCities ?? 0} 个城市 · 累计购买 ${k.myPurchases ?? 0} 次 · 系统数据每小时自动刷新`
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

  // 2. 门店城市 TOP10（横向柱状，完整显示 10 个城市）
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
        barWidth: 14,
        label: { show: true, position: 'right', color: '#8fa3c0', fontSize: 10 }
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

// 灰色中国地图 + 省级/城市级聚合数字标签
const renderMap = async () => {
  if (!mapRef.value) return
  if (!map) {
    map = L.map('ds-map', { zoomControl: false, attributionControl: false, preferCanvas: true }).setView([35, 108], 4)
    map.on('zoomend', () => {
      // 省级 ↔ 城市级切换：zoom < 5.5 省级，>= 5.5 城市级
      const level = map.getZoom() < 5.5 ? 'province' : 'city'
      if (level !== aggLevel) {
        aggLevel = level
        renderMap()
      }
    })
  }
  // 加载中国省界底图（灰色，一次性）
  if (!chinaLoaded) {
    try {
      const res = await fetch('/china.json')
      const geo = await res.json()
      // 排除香港、澳门不显示名称
      const HIDE_NAMES = ['香港特别行政区', '澳门特别行政区']
      // 先建底图层（onEachFeature 里不能引用 chinaLayer，会因未赋值抛错导致地图消失）
      chinaLayer = L.geoJSON(geo, {
        style: {
          color: 'rgba(140,160,190,0.9)',
          weight: 0.8,
          fillColor: 'rgba(30,55,90,0.55)',
          fillOpacity: 0.6
        },
        interactive: false
      }).addTo(map)
      // 底图创建完成后，按每个省份多边形的实际几何中心放置名称标签
      provinceLabelLayer = L.layerGroup()
      chinaLayer.eachLayer(layer => {
        const name = layer.feature?.properties?.name
        if (!name || HIDE_NAMES.includes(name)) return
        // 几何中心 = 实际多边形 bounds 中心（比 properties.center 更准）
        const center = layer.getBounds().getCenter()
        const icon = L.divIcon({
          className: 'ds-province-label',
          html: `<div class="ds-province-label-text">${name}</div>`,
          iconSize: [88, 24],
          iconAnchor: [44, 12]
        })
        L.marker([center.lat, center.lng], { icon, interactive: false }).addTo(provinceLabelLayer)
      })
      provinceLabelLayer.addTo(map)
      chinaLoaded = true
      map.setView([35, 108], 4)
      mapFitted = false  // 底图就绪后重新按数据fitBounds
    } catch (e) {
      console.warn('中国底图加载失败:', e)
    }
  }
  // 切换聚合级别时同步显隐省份名（省级视图显示，城市级隐藏避免叠标签）
  if (provinceLabelLayer) {
    const show = aggLevel === 'province'
    provinceLabelLayer.eachLayer(l => {
      const el = l.getElement?.()
      if (el) el.style.display = show ? '' : 'none'
    })
  }
  if (markerLayer) { map.removeLayer(markerLayer); markerLayer = null }
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null }

  // 按聚合级别选数据源：province 用省级聚合，city 用城市级聚合
  const isProv = aggLevel === 'province'
  const myPoints = (isProv ? data.value?.points?.markersProv : data.value?.points?.markers || []).filter(c => showMyLayer.value)
  const compPoints = (isProv ? data.value?.points?.competitorsProv : data.value?.points?.competitors || []).filter(c => showCompLayer.value)

  // 首次渲染：缩放地图到数据范围（后续刷新保持用户视野）
  if (!mapFitted && chinaLoaded && myPoints.length + compPoints.length > 0) {
    const allPts = myPoints.concat(compPoints)
    const lats = allPts.map(p => p.lat)
    const lngs = allPts.map(p => p.lng)
    try {
      map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [30, 30] })
      mapFitted = true
    } catch (_) {}
  }

  // 数字标签（divIcon 显示数量），圆底按数量分级
  const sizeOf = (n) => n <= 10 ? 22 : n <= 50 ? 30 : n <= 200 ? 40 : 52
  const suffix = isProv ? '省' : '家'

  // 城市名标签：Top20 限流 + 贪心碰撞检测（屏幕距离 < 30px 跳过）
  const labeledPoints = []
  const tryAddLabel = (c) => {
    if (isProv) return  // 省级视图不显示城市名
    if (!map) return
    const pt = map.latLngToContainerPoint([c.lat, c.lng])
    for (const prev of labeledPoints) {
      const dx = pt.x - prev.x
      const dy = pt.y - prev.y
      if (dx * dx + dy * dy < 30 * 30) return  // 碰撞，跳过
    }
    labeledPoints.push({ x: pt.x, y: pt.y, name: c.name })
  }
  // 按数量降序，最多标注 Top20
  const labelCandidates = myPoints.concat(compPoints)
    .slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, 20)
  labelCandidates.forEach(c => tryAddLabel(c))

  const makeIcon = (c, size, bg) => {
    const showName = !isProv && labeledPoints.some(l => l.name === c.name)
    return L.divIcon({
      className: 'ds-city-icon',
      html: `<div style="display:flex;align-items:center;gap:0;">
        <div style="width:${size}px;height:${size}px;line-height:${size}px;background:${bg};border:2px solid #fff;border-radius:50%;text-align:center;font-size:${size <= 30 ? 11 : 14}px;font-weight:600;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);flex-shrink:0;">${c.value}</div>
        ${showName ? `<div style="margin-left:5px;padding:2px 7px;background:rgba(8,21,38,0.72);border:1px solid rgba(64,196,255,0.35);border-radius:4px;font-size:11px;font-weight:500;color:#cfe4ff;white-space:nowrap;line-height:1.4;">${c.name}</div>` : ''}
      </div>`,
      iconSize: [0, 0],
      iconAnchor: [size / 2, size / 2]
    })
  }

  markerLayer = L.layerGroup()
  myPoints.forEach(c => {
    const size = sizeOf(c.value)
    const icon = makeIcon(c, size, 'rgba(64,196,255,0.85)')
    L.marker([c.lat, c.lng], { icon }).bindTooltip(`${c.name}：${c.value} ${suffix}`, { direction: 'top' }).addTo(markerLayer)
  })
  compPoints.forEach(c => {
    const size = sizeOf(c.value)
    const icon = makeIcon(c, size, 'rgba(255,107,107,0.8)')
    L.marker([c.lat, c.lng], { icon }).bindTooltip(`${c.name}：${c.value} ${suffix}`, { direction: 'top' }).addTo(markerLayer)
  })
  if (markerLayer.getLayers().length > 0) {
    markerLayer.addTo(map)
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
  refreshTimer = setInterval(fetchData, 3600000)  // 1 小时刷新一次
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
.ds-col-left { width: 260px; flex-shrink: 0; }
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
.ds-map { width: 100%; height: 100%; min-height: 300px; background: #081526; }
.ds-map :deep(.leaflet-container) { background: #081526; }
.ds-map :deep(.leaflet-control-attribution) { display: none; }

/* 省份名称标签 */
.ds-province-label {
  display: flex;
  align-items: center;
  justify-content: center;
}
.ds-province-label-text {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(8, 21, 38, 0.6);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #a8c6ea;
  text-align: center;
  white-space: nowrap;
  writing-mode: horizontal-tb;
  text-orientation: mixed;
  line-height: 1.4;
  pointer-events: none;
}
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

/* 图层开关（右上角） */
.ds-layer-switch {
  position: absolute;
  top: 10px; right: 10px;
  z-index: 1000;
  background: rgba(10, 26, 47, 0.85);
  border: 1px solid rgba(64, 196, 255, 0.3);
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ds-layer-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #b8c9e4;
  cursor: pointer;
  white-space: nowrap;
}
.ds-layer-level {
  font-size: 11px;
  color: #40c4ff;
  border-bottom: 1px solid rgba(64, 196, 255, 0.2);
  padding-bottom: 6px;
  margin-bottom: 2px;
}
.ds-layer-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.ds-layer-item :deep(.el-switch) { --el-switch-on-color: #40c4ff; }

/* 图表 */
.ds-chart-grid { display: flex; flex-direction: column; gap: 14px; flex: 1; min-height: 0; }
.ds-chart-grid .ds-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ds-chart-panel-lg { flex: 1.5 !important; }
.ds-chart-title { font-size: 13px; font-weight: 600; color: #b8c9e4; margin-bottom: 6px; }
.ds-chart { flex: 1; min-height: 0; }

/* 左列饼图面板：固定高度（否则 echarts 容器高度为 0 不渲染） */
.ds-col-left .ds-chart-panel {
  flex: 0 0 auto;
  height: 280px;
}
.ds-col-left .ds-chart-panel .ds-chart {
  height: 230px;
  flex: none;
}

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
