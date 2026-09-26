<template>
  <!-- L1+L7（v1.13.175 A 档）：数据大屏是独立路由（不在 MainLayout 之下），
       此前整页无任何地标；包 <main> 让读屏用户能定位「主内容区」
       L13（v1.13.176 B 档）：补 id + tabindex="-1" —— 路由切换后
       `router.afterEach` 要把焦点送进主内容地标，而 <main> 默认不可聚焦
       （无 tabindex 时 focus() 是空操作）。id 与 MainLayout 的 `#main-content`
       同名是**刻意**的：两者分属互斥路由（`/dashboard` 与 `/` 平级、不在其 children 内），
       永不同时挂载，全站始终只有一个 `#main-content`。 -->
  <main id="main-content" class="dashboard-screen" tabindex="-1">
    <!-- 顶部标题栏 -->
    <div class="ds-header">
      <div class="ds-title-left">
        <div class="ds-logo-bar"></div>
        <h1 class="ds-title">{{ $t('dashboard.title') }}</h1>
        <!-- L6（v1.13.175 A 档）：compare.change 为 null（上上月无数据、对比基准不存在）
             时整块隐藏 —— 铁律「缺数据恒 null，绝不填假值」 -->
        <span v-if="compare && compare.change !== null && compare.change !== undefined" class="ds-compare-tag" :class="compare.change >= 0 ? 'up' : 'down'">
          {{ $t('dashboard.compareTitle') }}：{{ compare.change >= 0 ? '↑' : '↓' }}{{ Math.abs(compare.change) }}%
        </span>
      </div>
      <div class="ds-clock">
        <span class="ds-time">{{ now }}</span>
        <span class="ds-date">{{ today }}</span>
      </div>
      <div class="ds-header-right">
        <span class="ds-updated">{{ $t('dashboard.updatedAt') }} {{ updatedTime }}</span>
        <el-dropdown trigger="click" @command="(lang) => setAppLocale(lang)" class="ds-lang">
          <span class="ds-lang-trigger" :aria-label="$t('common.switchLanguage')">
            <span>{{ langShort }}</span>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="zh">中文</el-dropdown-item>
              <el-dropdown-item command="ja">日本語</el-dropdown-item>
              <el-dropdown-item command="en">English</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button size="small" class="ds-exit-btn" @click="exitScreen">
          <el-icon><Close /></el-icon>{{ $t('dashboard.back') }}
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
          <div class="ds-chart-head">
            <div class="ds-chart-title">{{ $t('dashboard.chartTypeDist') }}</div>
            <!-- R2-5①（v1.13.178 B 档）：图表的**数据表等价物**。
                 默认收起 ⇒ 驾驶舱观感零变化（弹层绝对定位、不参与布局）；<details>/<summary>
                 原生键盘可达（Enter/Space），零 JS、零后端。数据与图表同源（charts.markerTypes），
                 占比由 withShare() 单一口径算出 —— ⛔ 别每张图各写一份百分比算法（158 式分裂）。 -->
            <details class="ds-dv">
              <summary class="ds-dv-summary">{{ $t('dashboard.dataTable') }}</summary>
              <div class="ds-dv-body">
                <table class="ds-dv-table">
                  <caption class="ds-sr-only">{{ $t('dashboard.chartTypeDist') }}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{{ $t('dashboard.colName') }}</th>
                      <th scope="col">{{ $t('dashboard.colCount') }}</th>
                      <th scope="col">{{ $t('dashboard.colShare') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in typeTableRows" :key="r.name">
                      <th scope="row">{{ r.name }}</th>
                      <td>{{ r.value }}</td>
                      <td>{{ r.share }}</td>
                    </tr>
                    <tr v-if="!typeTableRows.length">
                      <td colspan="3">{{ $t('dashboard.noData') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </div>
          <div ref="typeChartRef" class="ds-chart"></div>
        </div>
      </div>

      <!-- 中列：地图 -->
      <div class="ds-col ds-col-center">
        <div class="ds-panel ds-map-panel">
          <!-- L1（v1.13.175 A 档）：地图是纯展示（zoomControl/attribution 关、底图与聚合标签
               均 interactive:false，无任何可交互标记）⇒ 给整体文本替代比暴露内部图形更有用 -->
          <div
            id="ds-map"
            ref="mapRef"
            class="ds-map"
            role="img"
            :aria-label="`门店与竞品分布地图：${$t('dashboard.kpiOperating')} ${data?.kpi?.markers ?? 0} 家，${$t('dashboard.kpiCompetitors')} ${data?.kpi?.competitors ?? 0} 家`"
          ></div>
          <div class="ds-map-overlay">
            <span class="ds-map-title">{{ $t('dashboard.chartMapTitle') }}</span>
            <span class="ds-map-sub">{{ $t('dashboard.kpiOperating') }} {{ data?.kpi?.markers ?? 0 }} · {{ $t('dashboard.kpiCompetitors') }} {{ data?.kpi?.competitors ?? 0 }}</span>
          </div>
          <!-- 图层开关（右上角） -->
          <div class="ds-layer-switch">
            <div class="ds-layer-level">{{ aggLevel === 'province' ? $t('dashboard.mapAggProvince') : $t('dashboard.mapAggCity') }}</div>
            <!-- L14（v1.13.177 B 档）：分组定名。此前 .ds-layer-group 是裸 <div>，
                 读屏只会连报 3~4 个开关，无法知道哪几个属于「我的门店」、哪几个属于「竞品」。
                 role="group" 是纯语义加法，不改任何布局/视觉 -->
            <div class="ds-layer-group" role="group" :aria-label="$t('dashboard.kpiMyStores')">
              <div class="ds-layer-group-head">
                <!-- L12（v1.13.175 A 档）：外层用 <label> 才能给 el-switch
                     提供隐式可访问名称（原 <span> ⇒ 读屏只报「开关」，不知是开哪一层）。
                     .ds-layer-item 已显式 display:flex ⇒ 换标签视觉零变化 -->
                <label class="ds-layer-item">
                  <span class="ds-layer-dot" style="background:#40c4ff;"></span>
                  <span>{{ $t('dashboard.kpiMyStores') }}</span>
                  <el-switch v-model="showMyLayer" size="small" @change="renderMap" />
                </label>
              </div>
              <div v-if="showMyLayer" class="ds-layer-subs">
                <label v-for="t in myTypeKeys" :key="t" class="ds-layer-item ds-layer-sub">
                  <span class="ds-layer-dot" :style="{ background: typeColors[t] }"></span>
                  <span>{{ t }}</span>
                  <el-switch v-model="showMyTypes[t]" size="small" @change="renderMap" />
                </label>
              </div>
            </div>
            <div class="ds-layer-group" role="group" :aria-label="$t('dashboard.kpiCompetitors')">
              <div class="ds-layer-group-head">
                <!-- L12（v1.13.175 A 档）：同上，与子项既有写法保持一致 -->
                <label class="ds-layer-item">
                  <span class="ds-layer-dot" style="background:#ff6b6b;"></span>
                  <span>{{ $t('dashboard.kpiCompetitors') }}</span>
                  <el-switch v-model="showCompLayer" size="small" @change="renderMap" />
                </label>
              </div>
              <div v-if="showCompLayer" class="ds-layer-subs">
                <label v-for="b in compBrandKeys" :key="b" class="ds-layer-item ds-layer-sub">
                  <span class="ds-layer-dot" :style="{ background: brandColors[b] }"></span>
                  <span>{{ b }}</span>
                  <el-switch v-model="showCompBrands[b]" size="small" @change="renderMap" />
                </label>
              </div>
            </div>
            <!-- R2-5②（v1.13.178 B 档）：地图标记的**文本等价物**，同时修掉「42 个假按钮」。
                 实测（生产 admin）：地图上 42 个 `.leaflet-marker-icon` 全带 `role="button" tabindex="0"`
                 （Leaflet 默认 keyboard:true），但**没有任何点击行为**；可访问名分别是省名与**裸数字**
                 （`519`/`235`/`90`…）。Tab 一路穿过地图要按 44 次，读屏听到 42 个按不动的「按钮」。
                 处置：① marker 全部 `keyboard:false`（摘掉假按钮）② 用本列表承载数据（与地图同一数据源）。
                 ⚠️ 省级名称标签是底图装饰（无数据）⇒ 只在图上可见，不入本列表。 -->
            <details class="ds-dv ds-dv-map">
              <summary class="ds-dv-summary">{{ $t('dashboard.markerList') }}（{{ markerRows.length }}）</summary>
              <div class="ds-dv-body">
                <ul class="ds-marker-list" :aria-label="$t('dashboard.markerList')">
                  <li v-for="(m, i) in markerRows" :key="i">
                    <span class="ds-marker-dot" :style="{ background: m.color }" aria-hidden="true"></span>
                    <span>{{ m.label }}</span>
                  </li>
                  <li v-if="!markerRows.length" class="ds-marker-empty">{{ $t('dashboard.noData') }}</li>
                </ul>
              </div>
            </details>
          </div>
        </div>
      </div>

      <!-- 右列：图表 -->
      <div class="ds-col ds-col-right">
        <div class="ds-chart-grid">
          <div class="ds-panel ds-chart-panel ds-chart-panel-lg">
            <div class="ds-chart-head">
              <div class="ds-chart-title">{{ $t('dashboard.chartCityTop') }}</div>
              <details class="ds-dv">
                <summary class="ds-dv-summary">{{ $t('dashboard.dataTable') }}</summary>
                <div class="ds-dv-body">
                  <table class="ds-dv-table">
                    <caption class="ds-sr-only">{{ $t('dashboard.chartCityTop') }}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{{ $t('dashboard.colName') }}</th>
                        <th scope="col">{{ $t('dashboard.colCount') }}</th>
                        <th scope="col">{{ $t('dashboard.colShare') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="r in cityTableRows" :key="r.name">
                        <th scope="row">{{ r.name }}</th>
                        <td>{{ r.value }}</td>
                        <td>{{ r.share }}</td>
                      </tr>
                      <tr v-if="!cityTableRows.length">
                        <td colspan="3">{{ $t('dashboard.noData') }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
            <div ref="cityChartRef" class="ds-chart"></div>
          </div>
          <div class="ds-panel ds-chart-panel">
            <div class="ds-chart-head">
              <div class="ds-chart-title">{{ $t('dashboard.chartBrandDist') }}</div>
              <details class="ds-dv">
                <summary class="ds-dv-summary">{{ $t('dashboard.dataTable') }}</summary>
                <div class="ds-dv-body">
                  <table class="ds-dv-table">
                    <caption class="ds-sr-only">{{ $t('dashboard.chartBrandDist') }}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{{ $t('dashboard.colName') }}</th>
                        <th scope="col">{{ $t('dashboard.colCount') }}</th>
                        <th scope="col">{{ $t('dashboard.colShare') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="r in brandTableRows" :key="r.name">
                        <th scope="row">{{ r.name }}</th>
                        <td>{{ r.value }}</td>
                        <td>{{ r.share }}</td>
                      </tr>
                      <tr v-if="!brandTableRows.length">
                        <td colspan="3">{{ $t('dashboard.noData') }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
            <div ref="brandChartRef" class="ds-chart"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部跑马灯 -->
    <div class="ds-marquee">
      <span class="ds-marquee-label">{{ $t('dashboard.marqueeLabel') }}</span>
      <div class="ds-marquee-track">
        <span class="ds-marquee-text">{{ marqueeText }}</span>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/utils/api'
import { useUserStore } from '@/stores/user'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Close } from '@element-plus/icons-vue'
import { setAppLocale } from '@/i18n'
// L2（v1.13.108）：echarts 按需引入。本项目 echarts 唯一使用者即本页
// （另一处 components/MapView.vue 为死代码，已随 4A 删除），故按需可显著缩小 vendor-echarts。
// 本页仅用 饼图(pie) + 横向柱状(bar)，组件需 grid/tooltip/legend，渲染器 Canvas。
import * as echarts from 'echarts/core'
import { PieChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, AriaComponent } from 'echarts/components'
import { LabelLayout } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  PieChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,   // L1（v1.13.175 A 档）：canvas 无文本替代 ⇒ 开 ECharts aria
  LabelLayout,
  CanvasRenderer
])

const { t, locale } = useI18n()
// 语言按钮缩写：中 / 日 / EN
const langShort = computed(() => {
  if (locale.value === 'ja') return '日'
  if (locale.value === 'en') return 'EN'
  return '中'
})
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

// 门店类型颜色（我的门店）
const typeColors = { '已开业': '#40c4ff', '重点候选': '#ffd166', '一般候选': '#9aa5b5' }
const showMyTypes = reactive({ '已开业': true, '重点候选': false, '一般候选': false })  // 默认只显示已开业
const myTypeKeys = ['已开业', '重点候选', '一般候选']
// 竞品品牌颜色（最多10色循环）
const BRAND_COLOR_POOL = ['#ff6b6b', '#9b8cff', '#06d6a0', '#ff9f43', '#f98fb4', '#48dbfb', '#feca57', '#1dd1a1', '#c8d6e5', '#ffa502']
const brandColors = {}
const showCompBrands = reactive({})
const compBrandKeys = ref([])
// R2-5②（v1.13.178）：地图标记的文本等价物。**只在 renderMap 里赋值**，与地图同一对
// myTypePoints/compBrandPoints 派生 ⇒ 不另写一套筛选逻辑（避免 158 式「两处口径分裂」）。
const markerRows = ref([])
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
// 布局：2 列网格，左列我的门店相关，右列竞品相关，省份在城市上方
const kpiList = computed(() => {
  const k = data.value?.kpi || {}
  const h = data.value?.health || {}
  return [
    { label: t('dashboard.kpiOperating'), value: k.markers ?? 0, color: '#40c4ff' },
    { label: t('dashboard.kpiCompetitors'), value: k.competitors ?? 0, color: '#ff6b6b' },
    { label: t('dashboard.kpiClosed'), value: h.closed ?? 0, color: '#40c4ff' },
    { label: t('dashboard.kpiCompBrands'), value: k.compBrandCount ?? 0, color: '#ff6b6b' },
    { label: t('dashboard.kpiMyProvinces'), value: k.markerProvCount ?? 0, color: '#40c4ff' },
    { label: t('dashboard.kpiCompProvinces'), value: k.compProvCount ?? 0, color: '#ff6b6b' },
    { label: t('dashboard.kpiMyCities'), value: k.markerCities ?? 0, color: '#40c4ff' },
    { label: t('dashboard.kpiCompCities'), value: k.compCities ?? 0, color: '#ff6b6b' }
  ]
})

const compare = computed(() => {
  const cp = data.value?.compare || {}
  return cp.lastMonth ? cp : null
})

const marqueeText = computed(() => {
  const k = data.value?.kpi || {}
  return t('dashboard.marquee', { markers: k.markers ?? 0, competitors: k.competitors ?? 0, cities: k.markerCities ?? 0, purchases: k.myPurchases ?? 0 })
})

// R2-5①（v1.13.178）：图表数据表的三列口径。**单一函数**（三个图表共用）⇒
// 占比算法只有一处，改口径不会漏改某个图。缺数据时占比给 `—` 而非 `0%`（铁律：缺数据恒 null）。
const withShare = (arr) => {
  const list = arr || []
  const total = list.reduce((s, i) => s + (Number(i.value) || 0), 0)
  return list.map(i => ({
    name: i.name,
    value: i.value,
    share: total > 0 ? `${((Number(i.value) || 0) / total * 100).toFixed(1)}%` : '—'
  }))
}
const typeTableRows = computed(() => withShare(data.value?.charts?.markerTypes))
const cityTableRows = computed(() => withShare(data.value?.charts?.markerCityTop))
const brandTableRows = computed(() => withShare(data.value?.charts?.compBrandTop))

const updateClock = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  now.value = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  today.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const fetchData = async () => {
  try {
    const res = await api.get('/dashboard/summary')
    if (res.success) {
      data.value = res
      // 初始化竞品品牌开关（品牌名→颜色/开关状态）
      const brands = res.points?.compBrandList || []
      brands.forEach((b, i) => {
        brandColors[b.name] = BRAND_COLOR_POOL[i % BRAND_COLOR_POOL.length]
        if (!(b.name in showCompBrands)) showCompBrands[b.name] = true
      })
      compBrandKeys.value = brands.map(b => b.name)
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
      // L1（v1.13.175 A 档）：给 canvas 图生成 role="img" + 中文描述供读屏读取
      aria: { enabled: true, label: { description: `门店类型分布：${types.length ? types.map(i => `${i.name} ${i.value} 家`).join('，') : '暂无数据'}` } },
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
      aria: { enabled: true, label: { description: `门店城市 TOP10：${cities.length ? cities.map(i => `${i.name} ${i.value} 家`).join('，') : '暂无数据'}` } },
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
      aria: { enabled: true, label: { description: `竞品品牌 TOP10：${brands.length ? brands.map(i => `${i.name} ${i.value} 家`).join('，') : '暂无数据'}` } },
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
        // R2-5②（v1.13.178）：省名标签是**底图装饰**（无数据、不可点）。Leaflet 默认 keyboard:true
        // 会白送 32 个 `role="button" tabindex="0"` 的假按钮 ⇒ 显式关掉（视觉零变化）。
        L.marker([center.lat, center.lng], { icon, interactive: false, keyboard: false }).addTo(provinceLabelLayer)
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

  // 按聚合级别选数据源：省级/城市级都用拆分数据（多色区分类型/品牌）
  const isProv = aggLevel === 'province'

  // 多色数据：我的门店按类型、竞品按品牌（省级用 Province 拆分数据，城市级用城市拆分数据）
  const myTypePoints = []
  const compBrandPoints = []
  const myTypeSrc = isProv ? (data.value?.points?.markerByTypeProv || []) : (data.value?.points?.markerByType || [])
  const compBrandSrc = isProv ? (data.value?.points?.compByBrandProv || []) : (data.value?.points?.compByBrand || [])
  myTypeSrc.forEach(c => {
    if (showMyLayer.value && showMyTypes[c.group_key] !== false) myTypePoints.push(c)
  })
  compBrandSrc.forEach(c => {
    if (showCompLayer.value && showCompBrands[c.group_key] !== false) compBrandPoints.push(c)
  })

  // 首次渲染：缩放地图到数据范围（后续刷新保持用户视野）
  const fitPts = myTypePoints.concat(compBrandPoints)
  if (!mapFitted && chinaLoaded && fitPts.length > 0) {
    const lats = fitPts.map(p => p.lat)
    const lngs = fitPts.map(p => p.lng)
    try {
      map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [30, 30] })
      mapFitted = true
    } catch (_) {}
  }

  // 数字标签（divIcon 显示数量），圆底按数量分级
  const sizeOf = (n) => n <= 10 ? 22 : n <= 50 ? 30 : n <= 200 ? 40 : 52
  const suffix = isProv ? '省' : '家'

  // 名称标签：省级显示省名（无碰撞），城市级 Top20 限流 + 贪心碰撞检测
  const labeledPoints = []
  if (!isProv) {
    const tryAddLabel = (c) => {
      if (!map) return
      const pt = map.latLngToContainerPoint([c.lat, c.lng])
      for (const prev of labeledPoints) {
        const dx = pt.x - prev.x
        const dy = pt.y - prev.y
        if (dx * dx + dy * dy < 30 * 30) return  // 碰撞，跳过
      }
      labeledPoints.push({ x: pt.x, y: pt.y, name: c.name || c.city })
    }
    // 按数量降序，最多标注 Top20
    const labelCandidates = fitPts
      .slice()
      .sort((a, b) => b.value - a.value)
      .slice(0, 20)
    labelCandidates.forEach(c => tryAddLabel(c))
  } else {
    // 省级：按省份名记录标签（同一省合并显示）
    fitPts.forEach(c => {
      const name = c.name
      if (!labeledPoints.some(l => l.name === name)) {
        labeledPoints.push({ name })
      }
    })
  }

  const makeIcon = (c, size, bg, borderColor) => {
    const name = c.name || c.city
    // 城市级显示名称标签；省级不显示（省名由省份标签提供，避免重复）
    const showName = !isProv && labeledPoints.some(l => l.name === name)
    return L.divIcon({
      className: 'ds-city-icon',
      html: `<div style="display:flex;align-items:center;gap:0;">
        <div style="width:${size}px;height:${size}px;line-height:${size}px;background:${bg};border:2px solid ${borderColor || '#fff'};border-radius:50%;text-align:center;font-size:${size <= 30 ? 11 : 14}px;font-weight:600;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);flex-shrink:0;">${c.value}</div>
        ${showName ? `<div style="margin-left:5px;padding:2px 7px;background:rgba(8,21,38,0.72);border:1px solid rgba(64,196,255,0.35);border-radius:4px;font-size:11px;font-weight:500;color:#cfe4ff;white-space:nowrap;line-height:1.4;">${name}</div>` : ''}
      </div>`,
      iconSize: [0, 0],
      iconAnchor: [size / 2, size / 2]
    })
  }

  // R2-5②（v1.13.178）：地图标记的文本等价物 —— 与下面真正渲染的 marker **同一对数组**派生
  //（myTypePoints/compBrandPoints 已按图层开关过滤），顺序也一致 ⇒ 可逐条与地图对账。
  const labelOf = (c) => `${c.name || c.city}（${c.group_key}）：${c.value} ${suffix}`
  markerRows.value = [
    ...myTypePoints.map(c => ({ label: labelOf(c), color: typeColors[c.group_key] || '#40c4ff' })),
    ...compBrandPoints.map(c => ({ label: labelOf(c), color: brandColors[c.group_key] || '#ff6b6b' }))
  ]

  markerLayer = L.layerGroup()
  // 多色渲染（省级/城市级统一：我的按类型、竞品按品牌）
  // ⚠️ `keyboard: false` 是**刻意**的：这些标记**没有任何点击行为**，而 Leaflet 默认会额外挂上
  //    `role="button" tabindex="0"`（可访问名还只是裸数字，如「519」）⇒ 纯属假按钮。
  //    文本等价物由上面的 markerRows 列表 ＋ 地图容器自身的 role="img" 摘要承担。
  myTypePoints.forEach(c => {
    const size = sizeOf(c.value)
    const color = typeColors[c.group_key] || '#40c4ff'
    const icon = makeIcon(c, size, color)
    L.marker([c.lat, c.lng], { icon, keyboard: false })
      .bindTooltip(labelOf(c), { direction: 'top' })
      .addTo(markerLayer)
  })
  compBrandPoints.forEach(c => {
    const size = sizeOf(c.value)
    const color = brandColors[c.group_key] || '#ff6b6b'
    const icon = makeIcon(c, size, color)
    L.marker([c.lat, c.lng], { icon, keyboard: false })
      .bindTooltip(labelOf(c), { direction: 'top' })
      .addTo(markerLayer)
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
.ds-lang-trigger {
  font-size: 12px;
  color: #9fb8d9;
  border: 1px solid rgba(140, 180, 230, 0.3);
  border-radius: 5px;
  padding: 4px 10px;
  cursor: pointer;
  transition: all 0.2s;
}
.ds-lang-trigger:hover {
  color: #40c4ff;
  border-color: rgba(64, 196, 255, 0.6);
}
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
.ds-compare-tag { font-size: 11px; font-weight: 500; margin-left: 8px; padding: 1px 8px; border-radius: 10px; }
.ds-compare-tag.up { color: #2ed573; background: rgba(46, 213, 115, 0.12); }
.ds-compare-tag.down { color: #ff6b6b; background: rgba(255, 107, 107, 0.12); }

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
  /* 兜底：面板是 position:absolute（不参与布局）⇒ 这里限高 + 内部滚动，
     保证「图层开关 + 展开后的标记列表」在任何视口下都可达（父级 .ds-map-panel 有 overflow:hidden） */
  max-height: calc(100% - 20px);
  overflow-y: auto;
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
.ds-layer-group { margin-bottom: 6px; }
.ds-layer-group:last-child { margin-bottom: 0; }
.ds-layer-group-head { border-bottom: 1px solid rgba(255, 255, 255, 0.06); padding-bottom: 4px; margin-bottom: 4px; }
.ds-layer-subs { display: flex; flex-direction: column; gap: 5px; padding-left: 4px; }
.ds-layer-sub { font-size: 11px; }
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

/* ===== 数据表折叠 / 标记列表（v1.13.178 B 档 R2-5） ===== */
/* 图表标题行：标题 + 「数据表」同排 ⇒ 收起态与改动前的标题行等高 */
.ds-chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.ds-chart-head .ds-chart-title { margin-bottom: 0; }

/* <details>/<summary>：原生语义 + 原生键盘可达（Enter/Space），零 JS、零后端 */
.ds-dv { position: relative; }
.ds-dv-summary {
  font-size: 11px;
  line-height: 1.4;
  color: #7e8ca6;
  cursor: pointer;
  list-style: none;
  padding: 2px 8px;
  border: 1px solid rgba(140, 180, 230, 0.25);
  border-radius: 4px;
  white-space: nowrap;
  transition: all 0.2s;
}
.ds-dv-summary::-webkit-details-marker { display: none; }
.ds-dv-summary:hover { color: #40c4ff; border-color: rgba(64, 196, 255, 0.6); }
.ds-dv-summary:focus-visible { outline: 2px solid #40c4ff; outline-offset: 1px; }
/* 展开态：用「实心高亮」表达状态（刻意不用 ::before 箭头 —— 伪元素文本可能进可访问名） */
.ds-dv[open] > .ds-dv-summary {
  color: #0a1a2f;
  background: #40c4ff;
  border-color: #40c4ff;
}

/* 弹层：**绝对定位** ⇒ 展开/收起不引起任何布局位移（驾驶舱里这条很关键）；
   max-height + overflow 兜住长列表 */
.ds-dv-body {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 1200;
  min-width: 176px;
  max-width: 260px;
  max-height: 220px;
  overflow: auto;
  padding: 8px 10px;
  background: rgba(10, 26, 47, 0.97);
  border: 1px solid rgba(64, 196, 255, 0.35);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
}

.ds-dv-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.ds-dv-table th,
.ds-dv-table td {
  padding: 3px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  text-align: left;
  font-weight: 400;
  color: #c6d4ea;
}
.ds-dv-table thead th { color: #7e8ca6; font-weight: 600; }
.ds-dv-table tbody th { color: #a8c6ea; font-weight: 500; }
.ds-dv-table th:not(:first-child),
.ds-dv-table td:not(:first-child) { text-align: right; }
.ds-dv-table tbody tr:last-child th,
.ds-dv-table tbody tr:last-child td { border-bottom: 0; }

/* 图层开关面板里的标记列表。
   ⚠️ 这里**刻意不用** `.ds-dv-body` 的「绝对弹层」：`.ds-map-panel` 是 overflow:hidden
   且高度受 flex 约束 ⇒ 向下弹的浮层会在地图面板下沿被裁掉，最后几条永远看不到。
   改为「面板内联展开 + 自身限高滚动」⇒ 内容恒可达、不引起任何布局位移
   （`.ds-layer-switch` 是 position:absolute，只长它自己的盒子）。 */
.ds-dv-map {
  margin-top: 2px;
  padding-top: 8px;
  border-top: 1px solid rgba(64, 196, 255, 0.2);
}
.ds-dv-map .ds-dv-summary { display: block; text-align: center; }
.ds-dv-map .ds-dv-body {
  position: static;
  min-width: 0;
  max-width: none;
  margin-top: 6px;
  max-height: min(40vh, 300px);
  overflow: auto;
}
.ds-marker-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.ds-marker-list li {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  line-height: 1.5;
  color: #b8c9e4;
  white-space: nowrap;
}
.ds-marker-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ds-marker-empty { color: #7e8ca6; }

/* 仅供读屏（原生 <table> 的 caption）：本项目首次引入，用 ds- 前缀避免与全局工具类冲突。
   ⚠️ 只对**原生 <table>** 有意义 —— EP 的 el-table 会把 caption 渲染进 .hidden-columns（见记忆铁律⑧）。 */
.ds-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
