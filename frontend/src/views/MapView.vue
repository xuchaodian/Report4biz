<template>
  <div class="map-view">
    <!-- 左上角地址检索框 -->
    <div class="search-panel">
      <div class="search-box">
        <el-input
          v-model="searchKeyword"
          placeholder="输入地址搜索定位"
          size="large"
          clearable
          @input="searchAddress"
          @keyup.enter="handleEnterSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
      </div>
      <div v-if="searchResults.length > 0" class="search-results">
        <div
          v-for="(result, index) in searchResults"
          :key="index"
          class="search-result-item"
          @click="goToLocation(result)"
        >
          <div class="result-icon">
            <el-icon><LocationFilled /></el-icon>
          </div>
          <div class="result-info">
            <div class="result-name">{{ result.name || result.display_name }}</div>
            <div class="result-address">{{ result.address || result.district }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 显示门店开关 - 工具栏左侧 -->
    <div class="store-toggle-panel">
      <div class="store-toggle-header" @click="storeToggleExpanded = !storeToggleExpanded">
        <span class="toggle-title">显示门店</span>
        <span class="toggle-arrow" :class="{ expanded: storeToggleExpanded }">▼</span>
      </div>
      <div v-show="storeToggleExpanded" class="store-toggle-body">
        <div class="toggle-row">
          <span class="toggle-label">我的门店</span>
          <el-switch v-model="showBusinessLayer" />
        </div>
        <div class="toggle-row">
          <span class="toggle-label">竞品门店</span>
          <el-switch v-model="showCompetitorLayer" />
        </div>
        <div class="toggle-row">
          <span class="toggle-label">品牌门店</span>
          <el-switch v-model="showBrandStoreLayer" />
        </div>
        <div class="toggle-row">
          <span class="toggle-label">购物中心</span>
          <el-switch v-model="showShoppingCenterLayer" />
        </div>
      </div>
    </div>

    <!-- 工具栏 - 右上角收起/展开 -->
    <div class="toolbar">
      <div class="toolbar-header" @click="toolbarExpanded = !toolbarExpanded">
        <span class="toolbar-title">地图工具箱</span>
        <el-icon class="toolbar-arrow" :class="{ expanded: toolbarExpanded }">
          <ArrowRight />
        </el-icon>
      </div>
      <div v-show="toolbarExpanded" class="toolbar-body">
        <!-- 标注点 -->
        <el-tooltip content="标注点" placement="left">
          <div class="tool-item" :class="{ active: activeTool === 'marker' }" @click="setTool('marker')">
            <el-icon><Location /></el-icon>
            <span>标注点</span>
          </div>
        </el-tooltip>
        <!-- 测量距离 -->
        <el-tooltip content="测量距离" placement="left">
          <div class="tool-item" :class="{ active: activeTool === 'measure' }" @click="setTool('measure')">
            <el-icon><Odometer /></el-icon>
            <span>测量距离</span>
          </div>
        </el-tooltip>
        <!-- 测量面积 -->
        <el-tooltip content="测量面积" placement="left">
          <div class="tool-item" :class="{ active: activeTool === 'area' }" @click="setTool('area')">
            <el-icon><Aim /></el-icon>
            <span>测量面积</span>
          </div>
        </el-tooltip>
        <el-divider style="margin: 6px 0;" />
        <!-- 绘制圆形 -->
        <el-tooltip content="绘制圆形" placement="left">
          <div class="tool-item" :class="{ active: activeTool === 'circle' }" @click="setTool('circle')">
            <el-icon><Coordinate /></el-icon>
            <span>绘制圆形</span>
          </div>
        </el-tooltip>
        <el-divider style="margin: 6px 0;" />
        <!-- 热力图 -->
        <div class="tool-item" :class="{ active: showHeatmap }" @click="heatmapMenuVisible = !heatmapMenuVisible">
          <el-icon><DataLine /></el-icon>
          <span>热力图</span>
          <el-icon style="margin-left: auto; font-size: 10px;"><ArrowLeft /></el-icon>
        </div>
        <!-- 热力图样式菜单（内嵌展开） -->
        <div v-if="heatmapMenuVisible" class="heatmap-style-panel">
          <div class="panel-section-title">热力图样式</div>
          <div 
            v-for="s in heatmapStyles" 
            :key="s.name"
            class="heatmap-style-item"
            :class="{ active: heatmapStyle === s.name }"
            @click="selectHeatmapStyle(s.name)"
          >
            <div class="style-preview">
              <span v-for="(color, idx) in s.preview" :key="idx" 
                :style="{ backgroundColor: color, flex: 1, height: '8px' }"></span>
            </div>
            <span class="style-label">{{ s.label }}</span>
          </div>
          <div style="padding: 4px 0;">
            <el-button 
              :type="showHeatmap ? 'danger' : 'primary'" 
              size="small" 
              @click="toggleHeatmap" 
              style="width: 100%; font-size: 11px;"
            >
              {{ showHeatmap ? '关闭热力图' : '开启热力图' }}
            </el-button>
          </div>
        </div>
        <!-- 聚合显示 -->
        <el-tooltip content="聚合显示" placement="left">
          <div class="tool-item" :class="{ active: showCluster }" @click="toggleCluster">
            <el-icon><Grid /></el-icon>
            <span>聚合显示</span>
          </div>
        </el-tooltip>
        <!-- 图标样式（已隐藏） -->
        <el-divider style="margin: 6px 0;" />
        <!-- 清除绘制 -->
        <el-tooltip content="清除绘制" placement="left">
          <div class="tool-item" @click="clearDrawings">
            <el-icon><Delete /></el-icon>
            <span>清除绘制</span>
          </div>
        </el-tooltip>
        <!-- 定位数据 -->
        <el-tooltip content="定位数据" placement="left">
          <div class="tool-item" @click="fitBounds">
            <el-icon><View /></el-icon>
            <span>定位数据</span>
          </div>
        </el-tooltip>
      </div>
      <!-- 测量结果显示 -->
      <div v-if="measurementResult" class="measurement-result">
        {{ measurementResult }}
      </div>
    </div>

    <!-- 地图容器 -->
    <div id="map" class="map-container" />

    <!-- 坐标显示 -->
    <div class="coordinate-display">
      <span v-if="currentCityName" class="city-name">
        <el-icon><Location /></el-icon>
        {{ currentCityName }}
      </span>
      <span v-if="currentCoords">
        &nbsp;|&nbsp;经度: {{ currentCoords.lng.toFixed(6) }}&nbsp;&nbsp;
        纬度: {{ currentCoords.lat.toFixed(6) }}
      </span>
    </div>

    <!-- 图层控制面板 - 右下角 -->
    <div class="layer-switcher">
      <div class="layer-switcher-title">图层</div>
      <div class="layer-options">
        <div
          class="layer-option"
          :class="{ active: baseMapType === 'vec' }"
          @click="baseMapType = 'vec'"
        >
          <img src="/高德地图.jpeg" alt="高德" />
          <span>高德</span>
        </div>
        <div
          class="layer-option"
          :class="{ active: baseMapType === 'tencent' }"
          @click="baseMapType = 'tencent'"
        >
          <img src="/腾讯地图.jpeg" alt="腾讯" />
          <span>腾讯</span>
        </div>
        <div
          class="layer-option"
          :class="{ active: baseMapType === 'img' }"
          @click="baseMapType = 'img'"
        >
          <img src="/影像地图.jpeg" alt="影像" />
          <span>影像</span>
        </div>
      </div>
    </div>

    <!-- 缩放控件容器 -->
    <div class="zoom-control-container">
      <div class="zoom-in" @click="zoomIn">+</div>
      <div class="zoom-line"></div>
      <div class="zoom-out" @click="zoomOut">−</div>
    </div>

    <!-- 添加/编辑门店对话框 -->
    <el-dialog
      v-model="markerDialogVisible"
      :title="editingMarker ? '编辑门店' : '添加门店'"
      width="700px"
    >
      <el-form ref="markerFormRef" :model="markerForm" :rules="markerRules" label-width="90px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="门店编号" prop="store_code">
              <el-input v-model="markerForm.store_code" placeholder="如: BJ001" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="品牌" prop="brand">
              <el-input v-model="markerForm.brand" placeholder="品牌名称" />
            </el-form-item>
          </el-col>
        </el-row>
        
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="门店名称" prop="name">
              <el-input v-model="markerForm.name" placeholder="门店名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="门店类型" prop="store_type">
              <el-select v-model="markerForm.store_type" placeholder="请选择" style="width: 100%">
                <el-option label="已开业" value="已开业" />
                <el-option label="重点候选" value="重点候选" />
                <el-option label="一般候选" value="一般候选" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">地址信息</el-divider>
        
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="城市" prop="city">
              <el-input v-model="markerForm.city" placeholder="如: 北京市" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="区县" prop="district">
              <el-input v-model="markerForm.district" placeholder="如: 朝阳区" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="区域经理" prop="area_manager">
              <el-input v-model="markerForm.area_manager" placeholder="区域经理姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="电话1" prop="phone1">
              <el-input v-model="markerForm.phone1" placeholder="区域经理电话" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="店长" prop="store_manager">
              <el-input v-model="markerForm.store_manager" placeholder="店长姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="电话2" prop="phone2">
              <el-input v-model="markerForm.phone2" placeholder="店长电话" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="地址" prop="address">
          <el-input v-model="markerForm.address" placeholder="详细地址" />
        </el-form-item>

        <el-divider content-position="left">经营信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="开店日期" prop="open_date">
              <el-input v-model="markerForm.open_date" placeholder="如: 2024-01-01" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="营业时间" prop="business_hours">
              <el-input v-model="markerForm.business_hours" placeholder="如: 08:00-22:00" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="面积(㎡)" prop="area">
              <el-input-number v-model="markerForm.area" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="座位数" prop="seats">
              <el-input-number v-model="markerForm.seats" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="租金(元/月)" prop="rent">
              <el-input-number v-model="markerForm.rent" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="门店区分" prop="store_category">
              <el-select v-model="markerForm.store_category" placeholder="请选择" style="width: 100%">
                <el-option v-for="c in markerStore.storeCategories" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="联系人" prop="contact_person">
              <el-input v-model="markerForm.contact_person" placeholder="业主/联系人" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="联系电话" prop="contact_phone">
              <el-input v-model="markerForm.contact_phone" placeholder="联系电话" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="坐标">
          <el-input :model-value="`${markerForm.latitude?.toFixed(6)}, ${markerForm.longitude?.toFixed(6)}`" disabled />
        </el-form-item>

        <el-form-item label="备注" prop="description">
          <el-input v-model="markerForm.description" type="textarea" :rows="2" placeholder="备注信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="markerDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveMarker">确定</el-button>
      </template>
    </el-dialog>

    <!-- 绘制圆形对话框 -->
    <el-dialog
      v-model="circleDialogVisible"
      title="设置圆形半径"
      width="400px"
    >
      <el-form :model="circleForm" label-width="80px">
        <el-form-item label="圆心坐标">
          <el-input v-model="circleForm.centerText" disabled />
        </el-form-item>
        <el-form-item label="半径">
          <el-input-number
            v-model="circleForm.radius"
            :min="1"
            :max="50000"
            style="width: 100%;"
          />
        </el-form-item>
        <el-form-item label="单位">
          <el-radio-group v-model="circleForm.unit">
            <el-radio value="km" checked>公里</el-radio>
            <el-radio value="m">米</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="circleDialogVisible = false">取消</el-button>
        <el-button type="warning" @click="analyzeCircleStores">分析</el-button>
        <el-button type="primary" @click="confirmDrawCircle">确定</el-button>
      </template>
    </el-dialog>

    <!-- 圆形内门店分析结果对话框 -->
    <el-dialog
      v-model="circleAnalysisVisible"
      :title="circleAnalysisTitle"
      width="600px"
    >
      <div v-if="circleAnalysisData.myStores.length === 0 && circleAnalysisData.competitorStores.length === 0" class="analysis-empty">
        <el-empty description="圆形范围内没有门店" />
      </div>
      <div v-else class="analysis-content">
        <div v-if="circleAnalysisData.myStores.length > 0" class="analysis-section">
          <div class="analysis-section-title">
            <el-icon><Location /></el-icon>
            我的门店 ({{ circleAnalysisData.myStores.length }}家)
          </div>
          <el-table :data="circleAnalysisData.myStores" size="small" max-height="200">
            <el-table-column prop="name" label="门店名称" />
            <el-table-column prop="brand" label="品牌" />
            <el-table-column prop="distance" label="到圆心距离" width="120">
              <template #default="{ row }">
                {{ row.distance < 1000 ? `${row.distance.toFixed(0)}米` : `${(row.distance / 1000).toFixed(2)}公里` }}
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div v-if="circleAnalysisData.competitorStores.length > 0" class="analysis-section">
          <div class="analysis-section-title">
            <el-icon><DataLine /></el-icon>
            竞品门店 ({{ circleAnalysisData.competitorStores.length }}家)
          </div>
          <el-table :data="circleAnalysisData.competitorStores" size="small" max-height="200">
            <el-table-column prop="name" label="门店名称" />
            <el-table-column prop="brand" label="品牌" />
            <el-table-column prop="distance" label="到圆心距离" width="120">
              <template #default="{ row }">
                {{ row.distance < 1000 ? `${row.distance.toFixed(0)}米` : `${(row.distance / 1000).toFixed(2)}公里` }}
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="closeAnalysisDialog">关闭</el-button>
        <el-button type="primary" @click="showCircleOnMap">显示地图</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Location, Connection, Coordinate, Crop, FullScreen,
  Delete, View, Grid, DataLine, Odometer, Aim, Search, ArrowRight, ArrowLeft, Collection, LocationFilled
} from '@element-plus/icons-vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import 'leaflet.heat'
import { useMarkerStore } from '@/stores/marker'
import { useCompetitorStore } from '@/stores/competitor'
import { useBrandIconStore } from '@/stores/brandIcon'
import { useBrandStoreStore } from '@/stores/brandStore'
import { useShoppingCenterStore } from '@/stores/shoppingCenterStore'
import {
  createCustomIcon, createSvgIcon, createBrandImageIcon, svgMarkerStyles, getCategoryIcon, getStatusColor, getStoreTypeColor,
  calculateDistance, formatDistance, calculateArea, formatArea
} from '@/utils/map'
// 注意：public目录的中文名图片会被Vite直接复制到dist根目录

const markerStore = useMarkerStore()
const competitorStore = useCompetitorStore()
const brandIconStore = useBrandIconStore()
const brandStoreStore = useBrandStoreStore()
const shoppingCenterStore = useShoppingCenterStore()
const route = useRoute() // 获取路由参数

// 品牌图标映射 brand -> iconUrl
const brandIconMap = computed(() => {
  const map = {}
  brandIconStore.icons.forEach(icon => {
    map[icon.brand] = `/uploads/brand-icons/${icon.filename}`
  })
  return map
})

// 地图实例
let map = null
let tileLayer = null
let businessLayer = null
let competitorLayer = null  // 竞品门店图层
let brandStoreLayer = null  // 品牌门店图层
let brandMarkerMap = {}     // 品牌门店ID到marker的映射
let shoppingCenterLayer = null  // 购物中心图层
let shoppingCenterMarkerMap = {}  // 购物中心ID到marker的映射
let markerClusterGroup = null
let heatmapLayer = null
let drawnItems = null
let analysisCircleLayer = null  // 圆形分析专用图层
let shapefileQueryLayer = null  // Shapefile检索高亮图层
let measureLine = null
let measureArea = null
let measurePoints = []
let measureAreaPoints = []      // 测面专用点数组
let measureAreaPolygon = null   // 测面 polygon
let measureAreaLabel = null     // 测面面积标签

// 测量工具专用图层
let measureLayerGroup = null     // 所有测量元素的容器
let measurePreviewLine = null    // 鼠标移动时的预览线
let measureDotMarkers = []       // 各点的圆点标记
let measureLabelMarkers = []     // 各点的距离标签

// 状态变量
const activeTool = ref('')
const toolbarExpanded = ref(false) // 默认收起
const showHeatmap = ref(false)
const showCluster = ref(false)
const heatmapMenuVisible = ref(false)
const heatmapStyle = ref('classic')

// 热力图预设样式
const heatmapStyles = [
  {
    name: 'classic',
    label: '经典（蓝→红）',
    preview: ['#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000'],
    options: { radius: 40, blur: 10, maxZoom: 17, max: 1.0, minOpacity: 0.5, gradient: { 0.2: '#0066ff', 0.4: '#00ddff', 0.6: '#44dd44', 0.8: '#ffcc00', 1.0: '#ff3300' } }
  },
  {
    name: 'density',
    label: '密度（绿→红）',
    preview: ['#00ff00', '#7fff00', '#ffff00', '#ff7f00', '#ff0000'],
    options: { radius: 38, blur: 10, maxZoom: 17, max: 1.0, minOpacity: 0.5, gradient: { 0.1: '#22cc22', 0.4: '#88ee00', 0.6: '#ffcc00', 0.8: '#ff6600', 1.0: '#dd1100' } }
  },
  {
    name: 'cool',
    label: '冷色（深蓝→青）',
    preview: ['#000033', '#003366', '#0066cc', '#0099ff', '#00ccff'],
    options: { radius: 40, blur: 10, maxZoom: 17, max: 1.0, minOpacity: 0.5, gradient: { 0.1: '#001144', 0.3: '#0044aa', 0.6: '#0088dd', 0.8: '#22bbff', 1.0: '#66ccdd' } }
  }
]

const getCurrentHeatmapOptions = () => {
  const s = heatmapStyles.find(s => s.name === heatmapStyle.value) || heatmapStyles[0]
  return s.options
}
const showBusinessLayer = ref(true)
const showStoreLayers = ref(true)       // 总开关：控制竞品+品牌图层整体显示
const showCompetitorLayer = ref(false)  // 竞品图层显示控制（默认隐藏）
const showBrandStoreLayer = ref(false)  // 品牌门店图层显示控制（默认隐藏）
const showShoppingCenterLayer = ref(false)  // 购物中心图层显示控制（默认隐藏）
const storeToggleExpanded = ref(false) // 显示门店面板展开/收起
const layerOpacity = ref(1)
const baseMapType = ref('vec')
const currentCoords = ref(null)
const measurementResult = ref('')
const markerDialogVisible = ref(false)
const editingMarker = ref(null)
const markerFormRef = ref(null)
const currentMarkerStyle = ref('store') // 当前图标样式

// 绘制圆形相关
const circleDialogVisible = ref(false)
const circleForm = reactive({
  center: null,
  centerText: '',
  radius: 1,
  unit: 'km'
})

// 圆形内门店分析相关
const circleAnalysisVisible = ref(false)
const circleAnalysisData = reactive({
  myStores: [],
  competitorStores: [],
  myStoresFull: [],  // 完整数据（含经纬度）
  competitorStoresFull: []
})
const circleAnalysisTitle = ref('圆形内门店分析')
const circleAnalysisParams = reactive({
  center: null,
  radius: 0
})

// 分析圆形内的门店
const analyzeCircleStores = () => {
  if (!circleForm.center) return
  // 转换半径为米
  let radiusInMeters = circleForm.radius
  if (circleForm.unit === 'km') {
    radiusInMeters = radiusInMeters * 1000
  }

  const centerLat = circleForm.center.lat
  const centerLng = circleForm.center.lng

  // 获取可见的我的门店数据
  let myStoresData = markerStore.markers
  if (markerStore.visibleIds !== null && markerStore.visibleIds !== undefined) {
    myStoresData = markerStore.markers.filter(m => markerStore.visibleIds.includes(m.id))
  }

  // 分析我的门店
  const filteredMyStores = myStoresData
    .filter(store => {
      const distance = calculateDistance(centerLat, centerLng, store.latitude, store.longitude)
      return distance <= radiusInMeters
    })
  circleAnalysisData.myStoresFull = filteredMyStores
  circleAnalysisData.myStores = filteredMyStores
    .map(store => ({
      name: store.name,
      brand: store.brand || '-',
      distance: calculateDistance(centerLat, centerLng, store.latitude, store.longitude)
    }))
    .sort((a, b) => a.distance - b.distance)

  // 获取可见的竞品门店数据
  let competitorData = competitorStore.competitors
  if (competitorStore.visibleIds !== null && competitorStore.visibleIds !== undefined) {
    competitorData = competitorStore.competitors.filter(c => competitorStore.visibleIds.includes(c.id))
  }

  // 分析竞品门店
  const filteredCompetitorStores = competitorData
    .filter(store => {
      const distance = calculateDistance(centerLat, centerLng, store.latitude, store.longitude)
      return distance <= radiusInMeters
    })
  circleAnalysisData.competitorStoresFull = filteredCompetitorStores
  circleAnalysisData.competitorStores = filteredCompetitorStores
    .map(store => ({
      name: store.name,
      brand: store.brand || '-',
      distance: calculateDistance(centerLat, centerLng, store.latitude, store.longitude)
    }))
    .sort((a, b) => a.distance - b.distance)

  // 设置分析结果对话框标题
  const radiusText = circleForm.unit === 'km' ? `${circleForm.radius}公里` : `${circleForm.radius}米`
  circleAnalysisTitle.value = `半径${radiusText}圆形内门店分析`

  // 保存分析参数
  circleAnalysisParams.center = { lat: centerLat, lng: centerLng }
  circleAnalysisParams.radius = radiusInMeters

  circleAnalysisVisible.value = true
}

// 关闭分析对话框（同时关闭圆形设置对话框）
const closeAnalysisDialog = () => {
  circleAnalysisVisible.value = false
  circleDialogVisible.value = false
}

// 在地图上显示分析圆形和门店
const showCircleOnMap = () => {
  if (!map || !circleAnalysisParams.center || !circleAnalysisParams.radius) return

  // 关闭对话框
  circleAnalysisVisible.value = false

  // 清除之前的分析图层
  if (analysisCircleLayer) {
    map.removeLayer(analysisCircleLayer)
  }
  analysisCircleLayer = new L.LayerGroup()
  analysisCircleLayer.addTo(map)

  // 绘制圆形
  const circle = L.circle([circleAnalysisParams.center.lat, circleAnalysisParams.center.lng], {
    radius: circleAnalysisParams.radius,
    color: '#f56c6c',
    fillColor: '#f56c6c',
    fillOpacity: 0.2,
    weight: 2
  })
  analysisCircleLayer.addLayer(circle)

  // 绘制圆心标记
  const centerMarker = L.marker([circleAnalysisParams.center.lat, circleAnalysisParams.center.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div style="background:#fff;color:#f56c6c;width:14px;height:14px;border:2px solid #f56c6c;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    })
  })
  analysisCircleLayer.addLayer(centerMarker)

  // 添加圆形内的我的门店标记
  circleAnalysisData.myStoresFull.forEach((store, index) => {
    const marker = L.marker([store.latitude, store.longitude], {
      icon: createCustomIcon(getStatusColor(store.store_type), currentMarkerStyle.value)
    })
    marker.bindPopup(`<b>${store.name}</b><br>品牌: ${store.brand || '-'}<br>距圆心: ${store.distance < 1000 ? `${store.distance.toFixed(0)}米` : `${(store.distance / 1000).toFixed(2)}公里`}`)
    analysisCircleLayer.addLayer(marker)
  })

  // 添加圆形内的竞品门店标记
  const competitorBrandColors = {
    '大米先生': '#e6a23c',
    '谷田稻香': '#f56c6c',
    '吉野家': '#409eff',
    '老乡鸡': '#67c23a',
    '米村拌饭': '#9c27b0',
    '其他': '#ff9800'
  }
  const getCompBrandColor = (brand) => {
    if (!brand) return competitorBrandColors['其他']
    for (const key in competitorBrandColors) {
      if (brand.includes(key) || key.includes(brand)) {
        return competitorBrandColors[key]
      }
    }
    return competitorBrandColors['其他']
  }

  circleAnalysisData.competitorStoresFull.forEach((store) => {
    const brandColor = getCompBrandColor(store.brand)
    const marker = L.marker([store.latitude, store.longitude], {
      icon: createCustomIcon(brandColor, 'dot')
    })
    marker.bindPopup(`<b>${store.name}</b><br>品牌: ${store.brand || '-'}<br>距圆心: ${store.distance < 1000 ? `${store.distance.toFixed(0)}米` : `${(store.distance / 1000).toFixed(2)}公里`}`)
    analysisCircleLayer.addLayer(marker)
  })

  // 调整视图以包含所有元素
  const allPoints = [
    [circleAnalysisParams.center.lat, circleAnalysisParams.center.lng],
    ...circleAnalysisData.myStoresFull.map(s => [s.latitude, s.longitude]),
    ...circleAnalysisData.competitorStoresFull.map(s => [s.latitude, s.longitude])
  ]
  if (allPoints.length > 1) {
    map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] })
  } else {
    map.setView([circleAnalysisParams.center.lat, circleAnalysisParams.center.lng], 14)
  }

  ElMessage.success('已在地图上显示分析结果')
}

// 图标样式选项
const markerStyleOptions = [
  { value: 'store', label: '店铺', icon: '🏪' },
  { value: 'pin', label: '图钉', icon: '📍' },
  { value: 'dot', label: '圆点', icon: '🔵' },
  { value: 'diamond', label: '菱形', icon: '🔷' },
  { value: 'flag', label: '旗帜', icon: '🚩' },
  { value: 'star', label: '星形', icon: '⭐' }
]

// 地址搜索
const searchKeyword = ref('')
const searchResults = ref([])

// 当前城市名称
const currentCityName = ref('')

// 点位表单 - 门店管理
const markerForm = reactive({
  // 基础信息
  store_code: '',
  brand: '',
  name: '',
  store_type: '',
  // 地址信息
  city: '',
  district: '',
  area_manager: '',
  phone1: '',
  store_manager: '',
  phone2: '',
  address: '',
  // 经营信息
  open_date: '',
  business_hours: '',
  area: null,
  seats: null,
  rent: null,
  store_category: '',
  // 联系信息
  contact_person: '',
  contact_phone: '',
  description: '',
  // 系统字段
  latitude: 0,
  longitude: 0,
  status: '正常'
})

const markerRules = {
  name: [{ required: true, message: '请输入门店名称', trigger: 'blur' }],
  store_type: [{ required: true, message: '请选择门店类型', trigger: 'change' }]
}

// 底图瓦片配置
const baseMapTiles = {
  vec: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',
    subdomains: [1, 2, 3, 4]
  },
  img: {
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: [1, 2, 3, 4]
  },
  tencent: {
    url: 'https://rt{s}.map.gtimg.com/realtimerender?z={z}&x={x}&y={y}&type=vector&style=0',
    subdomains: ['0', '1', '2', '3']
  }
}

// 腾讯地图专用TileLayer（处理Y轴转换：TMS坐标系 y = 2^z - 1 - leaflet_y）
L.TencentTileLayer = L.TileLayer.extend({
  getTileUrl: function(tilePoint) {
    const z = tilePoint.z
    const x = tilePoint.x
    const y = Math.pow(2, z) - 1 - tilePoint.y
    const s = this._getSubdomain(tilePoint)
    const url = this._url
      .replace('{s}', s)
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y)
    return url
  }
})

L.tencentTileLayer = function(url, options) {
  return new L.TencentTileLayer(url, options)
}

// 默认位置（北京）
const DEFAULT_LAT = 39.9042
const DEFAULT_LNG = 116.4074
const DEFAULT_CITY = '北京市'

// 获取IP位置
const getLocationByIP = async () => {
  try {
    // 使用后端API进行IP定位
    const response = await fetch('/api/geocode/ip-location')
    const data = await response.json()
    if (data.success) {
      return {
        lat: data.lat,
        lng: data.lng,
        city: data.city || DEFAULT_CITY
      }
    }
  } catch (error) {
    console.log('IP定位失败，使用默认位置')
  }
  return null
}

// 初始化地图
const initMap = async () => {
  // 先获取IP位置
  const ipLocation = await getLocationByIP()
  const centerLat = ipLocation ? ipLocation.lat : DEFAULT_LAT
  const centerLng = ipLocation ? ipLocation.lng : DEFAULT_LNG
  const currentCity = ipLocation ? ipLocation.city : DEFAULT_CITY

  // 更新城市显示
  currentCityName.value = currentCity

  // 主地图 - 禁用默认缩放控件
  map = L.map('map', {
    center: [centerLat, centerLng],
    zoom: 12,
    zoomControl: false
  })

  // 加载底图
  loadBaseMap()

  // 初始化绘制层
  drawnItems = new L.FeatureGroup()
  map.addLayer(drawnItems)

  // 鼠标移动显示坐标
  map.on('mousemove', (e) => {
    currentCoords.value = e.latlng
  })

      // 地图点击事件（在map创建完成后立即绑定，避免async竞态问题）
  map.on('click', handleMapClick)
  // 双击通过两次click间隔自己判断（Leaflet的dblclick事件不可靠）

  // 加载点位数据
  loadMarkers()
  // 加载竞品门店
  loadCompetitors()
  // 加载品牌门店
  loadBrandStores()
  // 加载购物中心
  loadShoppingCenters()
}

// 地址搜索（使用高德地图API，支持模糊检索）
let searchTimer = null
const searchAddress = async () => {
  if (!searchKeyword.value.trim()) {
    searchResults.value = []
    return
  }

  // 清除之前的定时器，实现防抖
  if (searchTimer) {
    clearTimeout(searchTimer)
  }

  searchTimer = setTimeout(async () => {
    try {
      const keyword = searchKeyword.value.trim()
      // 使用后端高德搜索建议API
      const response = await fetch(`/api/geocode/suggest?keyword=${encodeURIComponent(keyword)}`)
      const data = await response.json()
      if (data.success && data.results && data.results.length > 0) {
        searchResults.value = data.results
      } else {
        searchResults.value = []
      }
    } catch (error) {
      console.error('搜索错误:', error)
      searchResults.value = []
    }
  }, 300) // 300ms 防抖
}

// 回车键直接跳转到第一个结果
const handleEnterSearch = () => {
  if (searchResults.value.length > 0) {
    goToLocation(searchResults.value[0])
  }
}

// 跳转到搜索位置
const goToLocation = (result) => {
  if (map && result.lat && result.lon) {
    map.setView([parseFloat(result.lat), parseFloat(result.lon)], 16)
    // 添加临时标记
    const marker = L.marker([parseFloat(result.lat), parseFloat(result.lon)], {
      icon: L.divIcon({
        className: 'temp-marker',
        html: '<div style="background:#f56c6c;color:white;padding:5px 10px;border-radius:4px;font-size:12px;">📍 ' + (result.name || searchKeyword.value) + '</div>',
        iconSize: [120, 30]
      })
    }).addTo(map)
    // 3秒后移除
    setTimeout(() => map.removeLayer(marker), 3000)
  }
  searchResults.value = []
}

// 缩放控制
const zoomIn = () => {
  if (map) map.zoomIn()
}

const zoomOut = () => {
  if (map) map.zoomOut()
}

// 加载底图
const loadBaseMap = () => {
  if (!map) return
  try {
    if (tileLayer) {
      map.removeLayer(tileLayer)
    }
    const config = baseMapTiles[baseMapType.value]
    
    // 腾讯地图使用自定义TileLayer处理Y轴转换
    if (baseMapType.value === 'tencent') {
      tileLayer = L.tencentTileLayer(config.url, {
        subdomains: config.subdomains,
        maxZoom: 18,
        minZoom: 3
      })
    } else {
      tileLayer = L.tileLayer(config.url, {
        subdomains: config.subdomains,
        maxZoom: 18,
        minZoom: 3
      })
    }
    map.addLayer(tileLayer)
  } catch (e) {
    console.error('[loadBaseMap] 加载底图失败:', e)
  }
}

// 监控底图切换
watch(baseMapType, loadBaseMap)

// 加载点位
const loadMarkers = async () => {
  // 确保地图已初始化
  if (!map) {
    console.log('[loadMarkers] 地图未初始化，跳过')
    return
  }
  
  console.log('=== loadMarkers 开始 ===')
  await markerStore.fetchMarkers()
  console.log('门店数据:', markerStore.markers)

  // 清除原有图层
  if (businessLayer) {
    try { map.removeLayer(businessLayer) } catch(e) {}
  }
  if (markerClusterGroup) {
    try { map.removeLayer(markerClusterGroup) } catch(e) {}
  }
  if (heatmapLayer) {
    try { map.removeLayer(heatmapLayer) } catch(e) {}
  }

  // 根据 visibleIds 过滤可见数据
  const visibleIds = markerStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? markerStore.markers
    : markerStore.markers.filter(m => visibleIds.includes(m.id))

  // 创建点位图层
  businessLayer = L.layerGroup()

  console.log('开始创建标记点, 数量:', dataToShow.length)

  dataToShow.forEach(markerData => {
    console.log('创建标记:', markerData.name, '坐标:', markerData.latitude, markerData.longitude)
    // 有品牌图标优先用图片图标，否则用门店类型颜色 SVG
    const brandIconUrl = brandIconMap.value[markerData.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl)
      : createSvgIcon(getStoreTypeColor(markerData.store_type), currentMarkerStyle.value)

    const marker = L.marker([markerData.latitude, markerData.longitude], {
      icon,
      draggable: true
    })

    marker.bindPopup(`
      <div style="min-width: 220px; font-size: 13px;">
        <h4 style="margin: 0 0 8px 0; color: #333;">${markerData.brand || ''} ${markerData.name}</h4>
        <p style="margin: 4px 0;"><strong>编号:</strong> ${markerData.store_code || '-'}</p>
        <p style="margin: 4px 0;"><strong>类型:</strong> <span style="color: ${markerData.store_type === '已开业' ? '#67c23a' : markerData.store_type === '重点候选' ? '#f56c6c' : '#e6a23c'}">${markerData.store_type || '-'}</span></p>
        <p style="margin: 4px 0;"><strong>门店区分:</strong> <span style="color: ${markerData.store_category === '社区店' ? '#909399' : markerData.store_category === '临街店' ? '#67c23a' : markerData.store_category === '商场店' ? '#f56c6c' : markerData.store_category === '写字楼店' ? '#409eff' : markerData.store_category === '交通枢纽店' ? '#e6a23c' : markerData.store_category === '校园店' ? '#9c27b0' : markerData.store_category === '景区店' ? '#ff9800' : markerData.store_category === '专业市场店' ? '#00bcd4' : '#333'}">${markerData.store_category || '-'}</span></p>
        <p style="margin: 4px 0;"><strong>地址:</strong> ${(markerData.city || '') + (markerData.district || '') + (markerData.address || '-')}</p>
        <p style="margin: 4px 0;"><strong>区域经理:</strong> ${markerData.area_manager || '-'} ${markerData.phone1 || ''}</p>
        <p style="margin: 4px 0;"><strong>店长:</strong> ${markerData.store_manager || '-'} ${markerData.phone2 || ''}</p>
        ${markerData.area ? `<p style="margin: 4px 0;"><strong>面积:</strong> ${markerData.area}㎡</p>` : ''}
        ${markerData.seats ? `<p style="margin: 4px 0;"><strong>座位:</strong> ${markerData.seats}个</p>` : ''}
        ${markerData.rent ? `<p style="margin: 4px 0;"><strong>租金:</strong> ¥${markerData.rent.toLocaleString()}/月</p>` : ''}
        ${markerData.open_date ? `<p style="margin: 4px 0;"><strong>开业:</strong> ${markerData.open_date}</p>` : ''}
        ${markerData.business_hours ? `<p style="margin: 4px 0;"><strong>营业:</strong> ${markerData.business_hours}</p>` : ''}
        ${markerData.description ? `<p style="margin: 4px 0;"><strong>备注:</strong> ${markerData.description}</p>` : ''}
        <div style="margin-top: 10px; display: flex; gap: 8px;">
          <button onclick="window.editMarkerExternal(${markerData.id})" style="padding: 4px 12px; cursor: pointer; background: #409eff; color: white; border: none; border-radius: 4px;">编辑</button>
          <button onclick="window.deleteMarkerExternal(${markerData.id})" style="padding: 4px 12px; cursor: pointer; background: #f56c6c; color: white; border: none; border-radius: 4px;">删除</button>
        </div>
      </div>
    `)

    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      // 停止事件传播，防止触发地图拖动
      L.DomEvent.stopPropagation(e)
    })

    // 拖拽结束更新坐标
    marker.on('dragend', async (e) => {
      const latlng = e.target.getLatLng()
      // 检查位置是否真的变化了（阈值约11米）
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - markerData.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - markerData.longitude) > threshold

      if (latChanged || lngChanged) {
        // 位置有变化，询问用户确认
        const confirmed = await ElMessageBox.confirm(
          `确定要移动 "${markerData.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await markerStore.updateMarker(markerData.id, {
            latitude: latlng.lat,
            longitude: latlng.lng
          })
          ElMessage.success('坐标已更新')
        } else {
          // 用户取消，恢复原位置
          marker.setLatLng([markerData.latitude, markerData.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })

    businessLayer.addLayer(marker)
  })

  // 聚合模式
  markerClusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false
  })

  dataToShow.forEach(markerData => {
    const brandIconUrl = brandIconMap.value[markerData.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl)
      : createSvgIcon(getStoreTypeColor(markerData.store_type), currentMarkerStyle.value)
    const marker = L.marker([markerData.latitude, markerData.longitude], { icon })
    marker.bindPopup(`<b>${markerData.brand || ''} ${markerData.name}</b><br/>${markerData.store_type || '-'}`)
    markerClusterGroup.addLayer(marker)
  })

  // 热力图
  const heatmapData = dataToShow.map(m => [m.latitude, m.longitude, 1])
  heatmapLayer = L.heatLayer(heatmapData, getCurrentHeatmapOptions())

  // 根据显示模式添加图层
  updateLayerDisplay()

  // 确保竞品图层在门店图层下方（如果竞品图层已创建）
  if (competitorLayer && map.hasLayer(competitorLayer)) {
    updateCompetitorDisplay()
  }
}

// 重载门店图层（供 watcher 调用）
const reloadBusinessLayer = () => {
  if (!map) {
    console.log('[reloadBusinessLayer] 地图未初始化，跳过')
    return
  }
  if (!businessLayer) return
  const wasOnMap = map.hasLayer(businessLayer)
  try { map.removeLayer(businessLayer) } catch(e) {}
  // 重新构建图层（从 store 取最新数据+过滤）
  const visibleIds = markerStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? markerStore.markers
    : markerStore.markers.filter(m => visibleIds.includes(m.id))

  businessLayer = L.layerGroup()
  dataToShow.forEach(markerData => {
    const brandIconUrl = brandIconMap.value[markerData.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl)
      : createSvgIcon(getStoreTypeColor(markerData.store_type), currentMarkerStyle.value)
    const marker = L.marker([markerData.latitude, markerData.longitude], { icon, draggable: true })
    marker.bindPopup(`<b>${markerData.brand || ''} ${markerData.name}</b><br/>${markerData.store_type || '-'}`)
    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })
    marker.on('dragend', async (e) => {
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - markerData.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - markerData.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动 "${markerData.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await markerStore.updateMarker(markerData.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('坐标已更新')
        } else {
          marker.setLatLng([markerData.latitude, markerData.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })
    businessLayer.addLayer(marker)
  })

  // 热力图
  if (heatmapLayer) { try { map.removeLayer(heatmapLayer) } catch(e) {} }
  const hmData = dataToShow.map(m => [m.latitude, m.longitude, 1])
  heatmapLayer = L.heatLayer(hmData, getCurrentHeatmapOptions())
  if (wasOnMap) {
    if (showHeatmap.value) {
      map.addLayer(heatmapLayer)
    } else {
      map.addLayer(businessLayer)
    }
  }
  updateLayerDisplay()
}

// 加载竞品门店
const loadCompetitors = async () => {
  // 确保地图已初始化
  if (!map) {
    console.log('[loadCompetitors] 地图未初始化，跳过')
    return
  }
  
  await competitorStore.fetchCompetitors()
  console.log('竞品数据:', competitorStore.competitors)
  console.log('竞品数量:', competitorStore.competitors?.length || 0)

  // 清除原有竞品图层
  if (competitorLayer) {
    map.removeLayer(competitorLayer)
    competitorLayer = null
  }

  // 如果没有竞品数据，跳过
  if (!competitorStore.competitors || competitorStore.competitors.length === 0) {
    console.log('没有竞品数据')
    return
  }

  // 根据 visibleIds 过滤
  const visibleIds = competitorStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? competitorStore.competitors
    : competitorStore.competitors.filter(c => visibleIds.includes(c.id))

  // 创建竞品图层
  competitorLayer = L.layerGroup()

  // 竞品品牌颜色映射（避免暗色系，使用鲜艳颜色）
  const brandColors = {
    '大米先生': '#e6a23c',   // 橙色
    '谷田稻香': '#f56c6c',   // 红色
    '吉野家': '#409eff',     // 蓝色
    '老乡鸡': '#67c23a',     // 绿色
    '米村拌饭': '#9c27b0',   // 紫色
    '其他': '#ff9800'        // 橙色
  }

  // 根据品牌获取颜色
  const getBrandColor = (brand) => {
    if (!brand) return brandColors['其他']
    // 遍历品牌映射查找匹配
    for (const key in brandColors) {
      if (brand.includes(key) || key.includes(brand)) {
        return brandColors[key]
      }
    }
    return brandColors['其他']
  }

  dataToShow.forEach(comp => {
    console.log('创建竞品标记:', comp.name, comp.latitude, comp.longitude)
    // 有品牌图标优先用图片图标，否则用颜色圆点
    const brandColor = getBrandColor(comp.brand)
    const brandIconUrl = brandIconMap.value[comp.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl)
      : createSvgIcon(brandColor, 'dot', 1.2)

    const marker = L.marker([comp.latitude, comp.longitude], {
      icon,
      draggable: true
    })

    marker.bindPopup(`
      <div style="min-width: 200px; font-size: 13px;">
        <h4 style="margin: 0 0 8px 0; color: ${brandColor};">🏪 ${comp.brand || ''} ${comp.name}</h4>
        <p style="margin: 4px 0;"><strong>类型:</strong> <span style="color: ${brandColor};">竞品</span></p>
        <p style="margin: 4px 0;"><strong>编号:</strong> ${comp.store_code || '-'}</p>
        <p style="margin: 4px 0;"><strong>地址:</strong> ${(comp.city || '') + (comp.district || '') + (comp.address || '-')}</p>
        ${comp.contact_person ? `<p style="margin: 4px 0;"><strong>联系人:</strong> ${comp.contact_person} ${comp.contact_phone || ''}</p>` : ''}
        ${comp.description ? `<p style="margin: 4px 0;"><strong>备注:</strong> ${comp.description}</p>` : ''}
      </div>
    `)

    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })

    // 拖拽结束更新坐标
    marker.on('dragend', async (e) => {
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - comp.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - comp.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动竞品 "${comp.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await competitorStore.updateCompetitor(comp.id, {
            latitude: latlng.lat,
            longitude: latlng.lng
          })
          ElMessage.success('竞品坐标已更新')
        } else {
          marker.setLatLng([comp.latitude, comp.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })

    competitorLayer.addLayer(marker)
  })

  console.log('竞品图层创建完成, competitorLayer:', !!competitorLayer)
  // 根据显示模式添加竞品图层
  updateCompetitorDisplay()
}

// 重载竞品图层（供 watcher 调用）
const reloadCompetitorLayer = () => {
  if (!map || !competitorStore.competitors || competitorStore.competitors.length === 0) return
  const visibleIds = competitorStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? competitorStore.competitors
    : competitorStore.competitors.filter(c => visibleIds.includes(c.id))

  const wasOnMap = map.hasLayer(competitorLayer)
  if (competitorLayer) { try { map.removeLayer(competitorLayer) } catch(e) {} }

  competitorLayer = L.layerGroup()
  const brandColors = {
    '大米先生': '#e6a23c', '谷田稻香': '#f56c6c', '吉野家': '#409eff',
    '老乡鸡': '#67c23a', '米村拌饭': '#9c27b0', '其他': '#ff9800'
  }
  const getBrandColor = (brand) => {
    if (!brand) return brandColors['其他']
    for (const key in brandColors) {
      if (brand.includes(key) || key.includes(brand)) return brandColors[key]
    }
    return brandColors['其他']
  }

  dataToShow.forEach(comp => {
    const brandColor = getBrandColor(comp.brand)
    const brandIconUrl = brandIconMap.value[comp.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl)
      : createSvgIcon(brandColor, 'dot', 1.2)
    const marker = L.marker([comp.latitude, comp.longitude], { icon, draggable: true })
    marker.bindPopup(`<div style="min-width:200px;font-size:13px;"><h4 style="margin:0 0 8px 0;color:${brandColor};">🏪 ${comp.brand || ''} ${comp.name}</h4><p style="margin:4px 0;"><strong>类型:</strong> <span style="color:${brandColor};">竞品</span></p><p style="margin:4px 0;"><strong>地址:</strong> ${(comp.city || '') + (comp.district || '') + (comp.address || '-')}</p></div>`)
    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })
    marker.on('dragend', async (e) => {
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - comp.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - comp.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动竞品 "${comp.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await competitorStore.updateCompetitor(comp.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('竞品坐标已更新')
        } else {
          marker.setLatLng([comp.latitude, comp.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })
    competitorLayer.addLayer(marker)
  })

  if (wasOnMap && showCompetitorLayer.value) {
    map.addLayer(competitorLayer)
    competitorLayer.bringToBack()
  }
}

// 竞品开关切换处理
const onCompetitorToggleChange = (value) => {
  console.log('竞品开关切换:', value)
  updateCompetitorDisplay()
}

// 更新竞品图层显示
const updateCompetitorDisplay = () => {
  console.log('updateCompetitorDisplay called, showCompetitorLayer:', showCompetitorLayer.value)
  
  if (!map) {
    console.log('地图未初始化')
    return
  }
  
  if (!competitorLayer) {
    console.log('竞品图层未创建，跳过')
    return
  }

  if (showCompetitorLayer.value) {
    // 直接添加图层，不管之前状态如何
    try {
      map.addLayer(competitorLayer)
      console.log('竞品图层已添加')
      
      // 确保竞品在门店下方
      if (businessLayer && map.hasLayer(businessLayer)) {
        try {
          competitorLayer.bringToBack()
        } catch (e) {
          console.log('bringToBack 失败（非致命）:', e.message)
        }
      }
    } catch (e) {
      console.log('添加图层失败:', e.message)
    }
  } else {
    // 直接移除图层
    try {
      map.removeLayer(competitorLayer)
      console.log('竞品图层已移除')
    } catch (e) {
      console.log('移除图层失败:', e.message)
    }
  }
}

// 加载品牌门店
const loadBrandStores = async () => {
  // 确保地图已初始化
  if (!map) {
    console.log('[loadBrandStores] 地图未初始化，跳过')
    return
  }
  
  await brandStoreStore.fetchBrandStores()
  console.log('品牌门店数据:', brandStoreStore.brandStores)

  if (brandStoreLayer) {
    map.removeLayer(brandStoreLayer)
    brandStoreLayer = null
  }

  if (!brandStoreStore.brandStores || brandStoreStore.brandStores.length === 0) {
    console.log('没有品牌门店数据')
    return
  }

  // 根据 visibleIds 过滤
  const visibleIds = brandStoreStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? brandStoreStore.brandStores
    : brandStoreStore.brandStores.filter(s => visibleIds.includes(s.id))

  brandStoreLayer = L.layerGroup()
  brandMarkerMap = {}  // 清空映射表

  dataToShow.forEach(store => {
    const brandIconUrl = brandIconMap.value[store.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl)
      : createSvgIcon(store.icon_color || '#409eff', 'diamond', 1)

    const marker = L.marker([store.latitude, store.longitude], { icon, draggable: true })

    marker.bindPopup(`
      <div style="min-width: 200px; font-size: 13px;">
        <h4 style="margin: 0 0 8px 0; color: ${store.icon_color || '#409eff'};">🏪 ${store.brand || ''} ${store.name}</h4>
        <p style="margin: 4px 0;"><strong>类型:</strong> <span style="color: ${store.icon_color || '#409eff'};">品牌门店</span></p>
        <p style="margin: 4px 0;"><strong>编号:</strong> ${store.store_code || '-'}</p>
        <p style="margin: 4px 0;"><strong>地址:</strong> ${(store.city || '') + (store.district || '') + (store.address || '-')}</p>
        ${store.contact_person ? `<p style="margin: 4px 0;"><strong>联系人:</strong> ${store.contact_person} ${store.contact_phone || ''}</p>` : ''}
        ${store.description ? `<p style="margin: 4px 0;"><strong>备注:</strong> ${store.description}</p>` : ''}
      </div>
    `)

    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })

    marker.on('dragend', async (e) => {
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - store.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - store.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动品牌门店 "${store.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await brandStoreStore.updateBrandStore(store.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('品牌门店坐标已更新')
        } else {
          marker.setLatLng([store.latitude, store.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })

    brandStoreLayer.addLayer(marker)
    brandMarkerMap[store.id] = marker  // 保存到映射表
  })

  updateBrandStoreDisplay()
}

// 重载品牌门店图层（供 watcher 调用）
const reloadBrandStoreLayer = () => {
  if (!map || !brandStoreStore.brandStores || brandStoreStore.brandStores.length === 0) return
  const visibleIds = brandStoreStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? brandStoreStore.brandStores
    : brandStoreStore.brandStores.filter(s => visibleIds.includes(s.id))

  const wasOnMap = map.hasLayer(brandStoreLayer)
  if (brandStoreLayer) { try { map.removeLayer(brandStoreLayer) } catch(e) {} }

  brandStoreLayer = L.layerGroup()
  brandMarkerMap = {}

  dataToShow.forEach(store => {
    const brandIconUrl = brandIconMap.value[store.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl)
      : createSvgIcon(store.icon_color || '#409eff', 'diamond', 1)
    const marker = L.marker([store.latitude, store.longitude], { icon, draggable: true })
    marker.bindPopup(`<div style="min-width:200px;font-size:13px;"><h4 style="margin:0 0 8px 0;color:${store.icon_color || '#409eff'};">🏪 ${store.brand || ''} ${store.name}</h4><p style="margin:4px 0;"><strong>类型:</strong> <span style="color:${store.icon_color || '#409eff'};">品牌门店</span></p><p style="margin:4px 0;"><strong>地址:</strong> ${(store.city || '') + (store.district || '') + (store.address || '-')}</p></div>`)
    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })
    marker.on('dragend', async (e) => {
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - store.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - store.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动品牌门店 "${store.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await brandStoreStore.updateBrandStore(store.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('品牌门店坐标已更新')
        } else {
          marker.setLatLng([store.latitude, store.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })
    brandStoreLayer.addLayer(marker)
    brandMarkerMap[store.id] = marker
  })

  if (wasOnMap && showBrandStoreLayer.value) {
    map.addLayer(brandStoreLayer)
    brandStoreLayer.bringToBack()
  }
}

// 品牌门店开关切换处理
const onBrandStoreToggleChange = () => {
  updateBrandStoreDisplay()
}

// 更新品牌门店图层显示
const updateBrandStoreDisplay = () => {
  if (!map) return
  if (!brandStoreLayer) return

  if (showBrandStoreLayer.value) {
    try { map.addLayer(brandStoreLayer) } catch(e) {}
    try { brandStoreLayer.bringToBack() } catch(e) {}
  } else {
    try { map.removeLayer(brandStoreLayer) } catch(e) {}
  }
}

// 加载购物中心
const loadShoppingCenters = async () => {
  if (!map) {
    console.log('[loadShoppingCenters] 地图未初始化，跳过')
    return
  }

  await shoppingCenterStore.fetchShoppingCenters()
  console.log('购物中心数据:', shoppingCenterStore.shoppingCenters)

  if (shoppingCenterLayer) {
    map.removeLayer(shoppingCenterLayer)
    shoppingCenterLayer = null
  }

  if (!shoppingCenterStore.shoppingCenters || shoppingCenterStore.shoppingCenters.length === 0) {
    console.log('没有购物中心数据')
    return
  }

  const visibleIds = shoppingCenterStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? shoppingCenterStore.shoppingCenters
    : shoppingCenterStore.shoppingCenters.filter(s => visibleIds.includes(s.id))

  shoppingCenterLayer = L.layerGroup()
  shoppingCenterMarkerMap = {}

  dataToShow.forEach(store => {
    const icon = createSvgIcon(store.icon_color || '#e6a23c', 'pin', 1.3)

    const popupContent = `
      <div style="min-width: 200px; font-size: 13px;">
        <h4 style="margin: 0 0 8px 0; color: ${store.icon_color || '#e6a23c'};">🏬 ${store.name}</h4>
        <p style="margin: 4px 0;"><strong>类型:</strong> <span style="color: ${store.icon_color || '#e6a23c'};">购物中心</span></p>
        <p style="margin: 4px 0;"><strong>编号:</strong> ${store.store_code || '-'}</p>
        <p style="margin: 4px 0;"><strong>分类:</strong> ${store.store_category || '-'}</p>
        <p style="margin: 4px 0;"><strong>地址:</strong> ${(store.city || '') + (store.district || '') + (store.address || '-')}</p>
        ${store.stars ? `<p style="margin: 4px 0;"><strong>星级:</strong> ⭐ ${store.stars}</p>` : ''}
        ${store.comments ? `<p style="margin: 4px 0;"><strong>评论数:</strong> ${store.comments.toLocaleString()}</p>` : ''}
        ${store.rank_info ? `<p style="margin: 4px 0;"><strong>榜单:</strong> ${store.rank_info}</p>` : ''}
      </div>
    `

    const marker = L.marker([store.latitude, store.longitude], { icon, draggable: true })
    marker.bindPopup(popupContent)

    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })

    marker.on('dragend', async (e) => {
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - store.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - store.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动购物中心 "${store.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await shoppingCenterStore.updateShoppingCenter(store.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('购物中心坐标已更新')
        } else {
          marker.setLatLng([store.latitude, store.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })

    shoppingCenterLayer.addLayer(marker)
    shoppingCenterMarkerMap[store.id] = marker
  })

  updateShoppingCenterDisplay()
}

// 重载购物中心图层
const reloadShoppingCenterLayer = () => {
  if (!map || !shoppingCenterStore.shoppingCenters || shoppingCenterStore.shoppingCenters.length === 0) return
  const visibleIds = shoppingCenterStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? shoppingCenterStore.shoppingCenters
    : shoppingCenterStore.shoppingCenters.filter(s => visibleIds.includes(s.id))

  const wasOnMap = map.hasLayer(shoppingCenterLayer)
  if (shoppingCenterLayer) { try { map.removeLayer(shoppingCenterLayer) } catch(e) {} }

  shoppingCenterLayer = L.layerGroup()
  shoppingCenterMarkerMap = {}

  dataToShow.forEach(store => {
    const icon = createSvgIcon(store.icon_color || '#e6a23c', 'pin', 1.3)
    const marker = L.marker([store.latitude, store.longitude], { icon, draggable: true })
    marker.bindPopup(`<div style="min-width:200px;font-size:13px;"><h4 style="margin:0 0 8px 0;color:${store.icon_color || '#e6a23c'};">🏬 ${store.name}</h4><p style="margin:4px 0;"><strong>地址:</strong> ${(store.city || '') + (store.district || '') + (store.address || '-')}</p>${store.stars ? `<p style="margin:4px 0;"><strong>星级:</strong> ⭐ ${store.stars}</p>` : ''}${store.comments ? `<p style="margin:4px 0;"><strong>评论数:</strong> ${store.comments.toLocaleString()}</p>` : ''}</div>`)
    marker.on('mousedown', (e) => { L.DomEvent.stopPropagation(e) })
    marker.on('dragend', async (e) => {
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - store.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - store.longitude) > threshold
      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动购物中心 "${store.name}" 到新位置吗？`,
          '确认移动', { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
        ).then(() => true).catch(() => false)
        if (confirmed) {
          await shoppingCenterStore.updateShoppingCenter(store.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('购物中心坐标已更新')
        } else {
          marker.setLatLng([store.latitude, store.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })
    shoppingCenterLayer.addLayer(marker)
    shoppingCenterMarkerMap[store.id] = marker
  })

  if (wasOnMap && showShoppingCenterLayer.value) {
    map.addLayer(shoppingCenterLayer)
    shoppingCenterLayer.bringToBack()
  }
}

// 更新购物中心图层显示
const updateShoppingCenterDisplay = () => {
  if (!map || !shoppingCenterLayer) return

  if (showShoppingCenterLayer.value) {
    try { map.addLayer(shoppingCenterLayer) } catch(e) {}
    try { shoppingCenterLayer.bringToBack() } catch(e) {}
  } else {
    try { map.removeLayer(shoppingCenterLayer) } catch(e) {}
  }
}

const updateLayerDisplay = () => {
  if (!map) return

  // 移除所有业务图层
  try {
    if (businessLayer && map.hasLayer(businessLayer)) map.removeLayer(businessLayer)
    if (markerClusterGroup && map.hasLayer(markerClusterGroup)) map.removeLayer(markerClusterGroup)
    if (heatmapLayer && map.hasLayer(heatmapLayer)) map.removeLayer(heatmapLayer)
  } catch(e) {}

  if (!showBusinessLayer.value) return

  if (showHeatmap.value && heatmapLayer) {
    try { map.addLayer(heatmapLayer) } catch(e) {}
  } else if (showCluster.value && markerClusterGroup) {
    try { map.addLayer(markerClusterGroup) } catch(e) {}
  } else if (businessLayer) {
    try { map.addLayer(businessLayer) } catch(e) {}
  }

  // 确保门店图层始终显示在竞品和品牌门店图层上方
  try {
    if (competitorLayer && map.hasLayer(competitorLayer)) competitorLayer.bringToBack()
    if (brandStoreLayer && map.hasLayer(brandStoreLayer)) brandStoreLayer.bringToBack()
    if (shoppingCenterLayer && map.hasLayer(shoppingCenterLayer)) shoppingCenterLayer.bringToBack()
  } catch(e) {}
}

// 监控竞品图层开关
watch(showCompetitorLayer, () => {
  updateCompetitorDisplay()
})

// 监控品牌门店图层开关
watch(showBrandStoreLayer, () => {
  updateBrandStoreDisplay()
})

// 监控购物中心图层开关
watch(showShoppingCenterLayer, () => {
  updateShoppingCenterDisplay()
})

// 监听各 store 的 visibleIds 变化，联动地图筛选显示
watch(() => markerStore.visibleIds, () => {
  if (map) reloadBusinessLayer()
})
watch(() => competitorStore.visibleIds, () => {
  if (map) reloadCompetitorLayer()
})
watch(() => brandStoreStore.visibleIds, () => {
  if (map) reloadBrandStoreLayer()
})
watch(() => shoppingCenterStore.visibleIds, () => {
  if (map) reloadShoppingCenterLayer()
})

// 监控图层显示状态（不包括竞品开关，由 @change 事件处理）
watch([showBusinessLayer, showHeatmap, showCluster, layerOpacity], () => {
  updateLayerDisplay()
  if (businessLayer) {
    businessLayer.setStyle({ opacity: layerOpacity.value, fillOpacity: layerOpacity.value * 0.3 })
  }
})

// 设置工具
const setTool = (tool) => {
  if (activeTool.value === tool) {
    // 再次点击同一工具 → 取消当前测量，不清空 drawnItems（保留已完成的结果）
    activeTool.value = ''
    if (map) map.getContainer().style.cursor = ''
    if (tool === 'measure') stopMeasure()
    if (tool === 'area') stopAreaMeasure()
    measurePoints = []
    measurementResult.value = ''
    return
  }
  // 切换工具时清理上一个测量状态
  if (activeTool.value === 'measure') stopMeasure()
  if (activeTool.value === 'area') stopAreaMeasure()
  // 重新选择同一工具时不清空 drawnItems（drawnItems 由 clearDrawings 统一清空）
  activeTool.value = tool

  // 设置光标
  if (['marker', 'polyline', 'polygon', 'rectangle', 'circle', 'measure', 'area'].includes(tool)) {
    map.getContainer().style.cursor = 'crosshair'
  }
}

// 地图点击处理（通过两次click间隔自己判断双击，绕过Leaflet的dblclick限制）
let lastClickTime = 0
const handleMapClick = (e) => {
  if (!activeTool.value || !map) return

  const now = Date.now()
  const isDoubleClick = (now - lastClickTime) < 300  // 300ms内连续点击视为双击
  lastClickTime = now

  console.log('DEBUG click 触发, activeTool=', activeTool.value, 'isDoubleClick=', isDoubleClick)

  if (isDoubleClick && (activeTool.value === 'measure' || activeTool.value === 'area')) {
    // 双击 → 结束测量
    if (activeTool.value === 'measure') {
      finishMeasure()
    } else if (activeTool.value === 'area') {
      // 直接把图层从map移到drawnItems，不要调用stopAreaMeasure（它会清null）
      if (measureAreaPolygon) {
        map.removeLayer(measureAreaPolygon)
        drawnItems.addLayer(measureAreaPolygon)
        measureAreaPolygon = null  // 必须设为null，否则下次测量会错误移除drawnItems中的面
      }
      if (measureAreaLabel) {
        map.removeLayer(measureAreaLabel)
        drawnItems.addLayer(measureAreaLabel)
        measureAreaLabel = null  // 必须设为null
      }
      measureAreaPoints = []
      activeTool.value = ''
      measurementResult.value = ''
    }
    return
  }

  // 单击 → 执行对应工具
  if (activeTool.value !== 'measure') {
    executeClick(e)
  } else {
    // 测距工具也用延迟防止意外
    handleMeasure(e.latlng.lat, e.latlng.lng)
  }
}

const executeClick = (e) => {
  const { lat, lng } = e.latlng

  switch (activeTool.value) {
    case 'marker':
      markerForm.latitude = lat
      markerForm.longitude = lng
      markerDialogVisible.value = true
      break

    case 'measure':
      handleMeasure(lat, lng)
      break

    case 'area':
      handleAreaMeasure(lat, lng)
      break

    case 'polyline':
      handleDrawPolyline(lat, lng)
      break

    case 'polygon':
      handleDrawPolygon(lat, lng)
      break

    case 'rectangle':
      handleDrawRectangle(e)
      break

    case 'circle':
      handleDrawCircle(e)
      break
  }
}

// ============ 测量距离（仿高德地图多段累计测距）============

// 计算累计总距离（米）
const getTotalDistance = (points) => {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += calculateDistance(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
  }
  return total
}

// 清空测量图层
const clearMeasureLayers = () => {
  if (measureLayerGroup) {
    measureLayerGroup.clearLayers()
  }
  if (measurePreviewLine) {
    map.removeLayer(measurePreviewLine)
    measurePreviewLine = null
  }
  measureDotMarkers = []
  measureLabelMarkers = []
}

// 停止测量（取消，不保留结果）
const stopMeasure = () => {
  map.off('mousemove', onMeasureMouseMove)
  if (measureLayerGroup) map.removeLayer(measureLayerGroup)
  if (measurePreviewLine) { map.removeLayer(measurePreviewLine); measurePreviewLine = null }
  measurePoints = []
  measureDotMarkers = []
  measureLabelMarkers = []
  measureLayerGroup = null
  measurementResult.value = ''
  if (map) map.getContainer().style.cursor = ''
}

// 停止测面
const stopAreaMeasure = () => {
  if (measureAreaPolygon) { map.removeLayer(measureAreaPolygon); measureAreaPolygon = null }
  if (measureAreaLabel) { map.removeLayer(measureAreaLabel); measureAreaLabel = null }
  measureAreaPoints = []
  measurementResult.value = ''
}

// 鼠标移动预览线
const onMeasureMouseMove = (e) => {
  if (measurePoints.length === 0) return
  const last = measurePoints[measurePoints.length - 1]
  const cur = [e.latlng.lat, e.latlng.lng]

  if (measurePreviewLine) map.removeLayer(measurePreviewLine)
  measurePreviewLine = L.polyline([last, cur], {
    color: '#3388ff',
    weight: 2,
    dashArray: '6, 6',
    opacity: 0.8
  }).addTo(map)

  // 更新提示
  const dist = calculateDistance(last[0], last[1], cur[0], cur[1])
  const total = getTotalDistance(measurePoints) + dist
  measurementResult.value = `当前段: ${formatDistance(dist)} | 总计: ${formatDistance(total)} | 双击结束`
}

// 点击添加测量点
const handleMeasure = (lat, lng) => {
  // 初始化图层组
  if (!measureLayerGroup) {
    measureLayerGroup = L.layerGroup().addTo(map)
  }

  measurePoints.push([lat, lng])
  const idx = measurePoints.length - 1

  // 画点（圆点）
  const dot = L.circleMarker([lat, lng], {
    radius: idx === 0 ? 6 : 5,
    color: '#fff',
    weight: 2,
    fillColor: idx === 0 ? '#3388ff' : '#ff6b6b',
    fillOpacity: 1
  }).addTo(measureLayerGroup)
  measureDotMarkers.push(dot)

  if (idx === 0) {
    // 第一个点：仅提示
    measurementResult.value = '单击添加点，双击结束测量'
    // 注册鼠标移动预览
    map.on('mousemove', onMeasureMouseMove)

    // 起点标签
    const startLabel = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#fff;color:#333;padding:3px 7px;border-radius:3px;font-size:11px;white-space:nowrap;border:1px solid #ccc;box-shadow:0 1px 4px rgba(0,0,0,0.2);display:inline-block;">起点</div>`,
        iconSize: null,
        iconAnchor: [-8, 10]
      }),
      interactive: false
    }).addTo(measureLayerGroup)
    measureLabelMarkers.push(startLabel)
  } else {
    // 画线段
    const segment = L.polyline([measurePoints[idx - 1], measurePoints[idx]], {
      color: '#3388ff',
      weight: 3,
      opacity: 0.9
    }).addTo(measureLayerGroup)

    // 本段距离 & 累计
    const segDist = calculateDistance(
      measurePoints[idx - 1][0], measurePoints[idx - 1][1],
      lat, lng
    )
    const totalDist = getTotalDistance(measurePoints)

    // 节点标签
    const label = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#fff;color:#333;padding:3px 7px;border-radius:3px;font-size:11px;white-space:nowrap;border:1px solid #ccc;box-shadow:0 1px 4px rgba(0,0,0,0.2);line-height:1.6;display:inline-block;">
          <div>${formatDistance(segDist)}</div>
          <div style="color:#555;font-size:10px;">累计 ${formatDistance(totalDist)}</div>
        </div>`,
        iconSize: null,
        iconAnchor: [-8, 10]
      }),
      interactive: false
    }).addTo(measureLayerGroup)
    measureLabelMarkers.push(label)

    measurementResult.value = `已量 ${formatDistance(totalDist)} | 单击继续添加点 | 双击结束`
  }
}

// 双击结束测量
const finishMeasure = () => {
  if (measurePoints.length < 2) {
    stopMeasure()
    activeTool.value = ''
    return
  }

  // 停止预览
  map.off('mousemove', onMeasureMouseMove)
  if (measurePreviewLine) { map.removeLayer(measurePreviewLine); measurePreviewLine = null }

  const totalDist = getTotalDistance(measurePoints)

  // 终点标记
  if (measureLayerGroup) {
    const last = measurePoints[measurePoints.length - 1]
    L.circleMarker(last, {
      radius: 7,
      color: '#fff',
      weight: 2,
      fillColor: '#ff4500',
      fillOpacity: 1
    }).addTo(measureLayerGroup)

    L.marker(last, {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#fff;color:#333;padding:4px 10px;border-radius:3px;font-size:12px;font-weight:bold;white-space:nowrap;border:1px solid #409eff;box-shadow:0 1px 4px rgba(0,0,0,0.2);display:inline-block;">
          总计: ${formatDistance(totalDist)}
        </div>`,
        iconSize: null,
        iconAnchor: [-8, -4]
      }),
      interactive: false
    }).addTo(measureLayerGroup)
  }

  measurementResult.value = `测量完成，总距离: ${formatDistance(totalDist)}`

  // drawnItems 保留测量结果
  if (drawnItems && measureLayerGroup) {
    // 将测量图层移入 drawnItems（清除时统一清）
    drawnItems.addLayer(measureLayerGroup)
    measureLayerGroup = null
  }

  measurePoints = []
  measureDotMarkers = []
  measureLabelMarkers = []
  activeTool.value = ''
  map.getContainer().style.cursor = ''

  setTimeout(() => { measurementResult.value = '' }, 4000)
}

// 测量面积
const handleAreaMeasure = (lat, lng) => {
  console.log('DEBUG handleAreaMeasure clicked, lat=', lat, 'lng=', lng, 'areaPoints=', measureAreaPoints.length)
  measureAreaPoints.push([lat, lng])
  const n = measureAreaPoints.length

  if (n < 3) {
    measurementResult.value = `已选择 ${n} 个点，还需 ${3 - n} 个`
    return
  }

  // 双击结束逻辑在 handleMapClick 内通过300ms间隔判断，不再单独绑定

  // 计算面积
  const area = calculateArea(measureAreaPoints.map(p => ({ lat: p[0], lng: p[1] })))
  const areaStr = formatArea(area)
  measurementResult.value = `面积: ${areaStr} | 单击继续加点 | 双击结束`

  // 绘制 polygon
  if (measureAreaPolygon) map.removeLayer(measureAreaPolygon)
  measureAreaPolygon = L.polygon(measureAreaPoints, {
    color: '#409eff',
    fillColor: '#409eff',
    fillOpacity: 0.2,
    weight: 2
  }).addTo(map)

  // 在 polygon 中心显示面积标签
  if (measureAreaLabel) map.removeLayer(measureAreaLabel)
  const center = measureAreaPolygon.getBounds().getCenter()
  measureAreaLabel = L.marker(center, {
    icon: L.divIcon({
      className: '',
      html: `<div style="background:#fff;color:#333;padding:5px 12px;border-radius:4px;font-size:13px;font-weight:bold;white-space:nowrap;border:1px solid #409eff;box-shadow:0 2px 6px rgba(0,0,0,0.2);display:inline-block;">
        面积: ${areaStr}
      </div>`,
      iconSize: null,
      iconAnchor: [0, 0]
    }),
    interactive: false
  }).addTo(map)
}

// 绘制折线
const handleDrawPolyline = (lat, lng) => {
  measurePoints.push([lat, lng])

  if (measurePoints.length === 1) {
    measurementResult.value = '继续点击添加点，右键结束'
  }

  if (measurePoints.length >= 2) {
    if (measureLine) map.removeLayer(measureLine)
    measureLine = L.polyline(measurePoints, {
      color: '#409eff',
      weight: 3
    }).addTo(map)

    drawnItems.addLayer(measureLine)
  }

  map.once('contextmenu', () => {
    measurePoints = []
    measurementResult.value = ''
    activeTool.value = ''
  })
}

// 绘制多边形
const handleDrawPolygon = (lat, lng) => {
  measurePoints.push([lat, lng])

  if (measurePoints.length < 3) {
    measurementResult.value = `已选择 ${measurePoints.length} 个点，还需 ${3 - measurePoints.length} 个`
  }

  if (measurePoints.length >= 3) {
    if (measureArea) map.removeLayer(measureArea)
    measureArea = L.polygon(measurePoints, {
      color: '#409eff',
      fillColor: '#409eff',
      fillOpacity: 0.3
    }).addTo(map)

    drawnItems.addLayer(measureArea)
    measurePoints = []
    measurementResult.value = ''
    activeTool.value = ''
  }
}

// 绘制矩形
const handleDrawRectangle = (e) => {
  if (!map) return
  const bounds = L.latLngBounds(e.latlng, e.latlng)
  const rect = L.rectangle(bounds, {
    color: '#409eff',
    fillColor: '#409eff',
    fillOpacity: 0.3
  }).addTo(map)
  drawnItems.addLayer(rect)
  activeTool.value = ''
  measurementResult.value = ''
}

// 绘制圆形
const handleDrawCircle = (e) => {
  if (!map) return
  // 记录圆心，打开对话框让用户设置半径
  circleForm.center = e.latlng
  circleForm.centerText = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`
  circleForm.radius = 1
  circleForm.unit = 'km'
  circleDialogVisible.value = true
}

// 确认绘制圆形
const confirmDrawCircle = () => {
  if (!circleForm.center) return
  // 转换半径单位
  let radius = circleForm.radius
  if (circleForm.unit === 'km') {
    radius = radius * 1000  // 公里转米
  }
  // 绘制圆形
  const circle = L.circle(circleForm.center, {
    radius: radius,
    color: '#409eff',
    fillColor: '#409eff',
    fillOpacity: 0.3
  }).addTo(map)
  drawnItems.addLayer(circle)
  // 在圆心添加图标
  const centerIcon = L.marker(circleForm.center, {
    icon: L.divIcon({
      className: '',
      html: `<div style="background:#fff;color:#409eff;width:12px;height:12px;border:2px solid #409eff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    })
  }).addTo(map)
  drawnItems.addLayer(centerIcon)
  circleDialogVisible.value = false
  activeTool.value = ''
  measurementResult.value = ''
  ElMessage.success(`已绘制圆形，半径 ${circleForm.radius}${circleForm.unit === 'm' ? '米' : '公里'}`)
}

// 切换热力图
const toggleHeatmap = () => {
  if (!map) return
  showHeatmap.value = !showHeatmap.value
  if (showHeatmap.value) showCluster.value = false
  heatmapMenuVisible.value = false
  if (showHeatmap.value) {
    try { map.addLayer(heatmapLayer) } catch(e) {}
    try {
      if (businessLayer && map.hasLayer(businessLayer)) {
        heatmapLayer.bringToBack()
      }
    } catch(e) {}
  } else {
    try {
      if (map.hasLayer(heatmapLayer)) map.removeLayer(heatmapLayer)
      if (businessLayer && !map.hasLayer(businessLayer)) {
        map.addLayer(businessLayer)
      }
    } catch(e) {}
  }
}

// 选择热力图样式
const selectHeatmapStyle = (styleName) => {
  heatmapStyle.value = styleName
  // 重新加载热力图
  reloadBusinessLayer()
}

// 切换聚合
const toggleCluster = () => {
  showCluster.value = !showCluster.value
  if (showCluster.value) showHeatmap.value = false
}

// 清除绘制
const clearDrawings = () => {
  if (!map) {
    console.log('[clearDrawings] 地图未初始化')
    return
  }
  if (activeTool.value === 'measure') stopMeasure()
  if (activeTool.value === 'area') stopAreaMeasure()
  try {
    if (measureLine) { map.removeLayer(measureLine); measureLine = null }
    if (measureArea) { map.removeLayer(measureArea); measureArea = null }
    if (measureLayerGroup) { map.removeLayer(measureLayerGroup); measureLayerGroup = null }
    if (drawnItems) drawnItems.clearLayers()
    // 清除分析圆形图层
    if (analysisCircleLayer) {
      map.removeLayer(analysisCircleLayer)
      analysisCircleLayer = null
    }
    // 清除Shapefile检索高亮图层
    if (shapefileQueryLayer) {
      map.removeLayer(shapefileQueryLayer)
      shapefileQueryLayer = null
    }
  } catch (e) {
    console.error('[clearDrawings] 清除图层失败:', e)
  }
  measurePoints = []
  measureAreaPoints = []
  measurementResult.value = ''
  activeTool.value = ''
  ElMessage.success('已清除')
}

// 切换图标样式
const changeMarkerStyle = (style) => {
  currentMarkerStyle.value = style
  loadMarkers() // 重新加载标记以应用新样式
  ElMessage.success(`已切换为${markerStyleOptions.find(s => s.value === style)?.label}样式`)
}

// 处理Shapefile检索结果高亮显示（稳定版）
let shapefileProcessing = false  // 防止重复处理

const handleShapefileQuery = (event) => {
  try {
    const { id, name, geojson, matched, displayFields } = event.detail

    console.log('[Shapefile Query] 收到请求:', { name, matched, displayFields, mapReady: !!map })

    // 首先检查 map 是否存在
    if (!map) {
      console.log('[Shapefile Query] 地图未初始化，等待...')
      setTimeout(() => {
        if (map) {
          handleShapefileQuery(event)
        } else {
          ElMessage.warning('地图初始化失败，请刷新页面')
        }
      }, 2000)
      return
    }

    // 防止重复处理
    if (shapefileProcessing) {
      console.log('[Shapefile Query] 正在处理中，跳过')
      return
    }

    // 检查数据
    if (!geojson || typeof geojson !== 'object') {
      ElMessage.error('Shapefile 数据格式错误')
      return
    }

    const features = geojson.features || []
    if (features.length === 0) {
      ElMessage.warning('没有匹配的要素')
      return
    }

    // 清除之前的高亮图层
    if (shapefileQueryLayer) {
      try {
        map.removeLayer(shapefileQueryLayer)
      } catch (e) {
        console.error('[Shapefile Query] 清除旧图层失败:', e)
      }
      shapefileQueryLayer = null
    }

    console.log('[Shapefile Query] 开始处理，共', features.length, '个要素')

    // 标记开始处理
    shapefileProcessing = true
    ElMessage.info(`正在加载 ${features.length} 个要素...`)

    // 创建图层组
    shapefileQueryLayer = L.layerGroup()

    // 使用递归分批处理，每批10个，避免阻塞
    const BATCH_SIZE = 10
    let currentIndex = 0

    const processBatch = () => {
      // 确保 map 仍然存在
      if (!map) {
        console.log('[Shapefile Query] 地图已失效，停止处理')
        shapefileProcessing = false
        return
      }

      if (currentIndex >= features.length) {
        // 全部处理完成，调整视图
        console.log('[Shapefile Query] 处理完成')
        shapefileProcessing = false

        // 确保图层已添加到地图
        try {
          if (!map.hasLayer(shapefileQueryLayer)) {
            shapefileQueryLayer.addTo(map)
          }
        } catch (e) {
          console.error('[Shapefile Query] 添加图层失败:', e)
        }

        // 调整视图
        setTimeout(() => {
          try {
            if (map && shapefileQueryLayer && shapefileQueryLayer.getLayers().length > 0) {
              const bounds = shapefileQueryLayer.getBounds()
              if (bounds && bounds.isValid && bounds.isValid()) {
                map.fitBounds(bounds, { padding: [50, 50] })
              }
            }
          } catch (e) {
            console.error('[Shapefile Query] 调整视图失败:', e)
          }
        }, 100)

        ElMessage.success(`已高亮显示 "${name}" 中的 ${matched} 个匹配要素（橙色边界线）`)
        return
      }

      // 处理当前批次
      const endIndex = Math.min(currentIndex + BATCH_SIZE, features.length)
      console.log(`[Shapefile Query] 处理批次 ${currentIndex + 1}-${endIndex}/${features.length}`)

      for (let i = currentIndex; i < endIndex; i++) {
        const feature = features[i]
        const geometry = feature.geometry
        if (!geometry) continue

        try {
          const coords = geometry.coordinates
          const geomType = geometry.type
          const props = feature.properties || {}

          // 构建属性显示文本
          const propsText = Object.entries(props)
            .filter(([_, v]) => v !== null && v !== undefined && v !== '')
            .slice(0, 8)
            .map(([k, v]) => `<b>${k}</b>: ${v}`)
            .join('<br>')

          const addPolygon = (ring, featureProps) => {
            try {
              const latlngs = ring.map(coord => L.latLng(coord[1], coord[0]))
              if (latlngs.length < 3) return

              // 加粗边界线：weight 从 2 改为 5
              const polyline = L.polyline(latlngs, {
                color: '#ff6600',
                weight: 5,
                opacity: 0.9
              })

              polyline.bindPopup(`
                <div style="font-size:12px; max-width: 280px;">
                  <b style="color:#e6a23c;">${name}</b><br>
                  <hr style="margin: 6px 0;">
                  ${propsText}
                </div>
              `)

              shapefileQueryLayer.addLayer(polyline)

              // 在 Polygon 中心位置显示数值
              const polygon = L.polygon(latlngs)
              const center = polygon.getBounds().getCenter()

              // 只显示检索条件中指定的字段（displayFields）
              let displayValues = []

              if (displayFields && displayFields.length > 0) {
                // 用户指定了显示字段，只显示这些字段
                displayValues = displayFields
                  .filter(field => field in (featureProps || {}))
                  .map(field => {
                    const v = featureProps[field]
                    if (v === null || v === undefined || v === '') return null
                    // 支持数字和字符串数字
                    const num = typeof v === 'number' ? v : Number(v)
                    if (isNaN(num)) return null
                    // 显示整数
                    return `${field}: ${Math.round(num)}`
                  })
                  .filter(v => v !== null)
              } else {
                // 没有指定字段，回退到显示所有数值字段
                displayValues = Object.entries(featureProps || {})
                  .filter(([_, v]) => {
                    if (v === null || v === undefined || v === '') return false
                    if (typeof v === 'number' && !isNaN(v)) return true
                    if (typeof v === 'string') {
                      const num = Number(v)
                      return !isNaN(num) && v.trim() !== ''
                    }
                    return false
                  })
                  .slice(0, 3)
                  .map(([k, v]) => {
                    const num = typeof v === 'number' ? v : Number(v)
                    return `${k}: ${Math.round(num)}`
                  })
              }

              if (displayValues.length > 0) {
                const numericValue = displayValues.join('<br>')
                const labelIcon = L.divIcon({
                  className: 'shapefile-query-label',
                  html: `<div style="
                    background: rgba(255, 102, 0, 0.85);
                    color: white;
                    padding: 6px 10px;
                    border-radius: 4px;
                    font-size: 13px;
                    font-weight: bold;
                    text-align: center;
                    white-space: nowrap;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                    line-height: 1.5;
                    min-width: 80px;
                  ">${numericValue}</div>`,
                  iconSize: [140, 50],
                  iconAnchor: [70, 25]
                })
                const labelMarker = L.marker(center, { icon: labelIcon })
                shapefileQueryLayer.addLayer(labelMarker)
              }
            } catch (e) {
              console.error('[Shapefile Query] 添加多边形失败:', e)
            }
          }

          if (geomType === 'Polygon') {
            coords.forEach(ring => addPolygon(ring, props))
          } else if (geomType === 'MultiPolygon') {
            coords.forEach(polygon => polygon.forEach(ring => addPolygon(ring, props)))
          }
        } catch (e) {
          console.error('[Shapefile Query] 处理 feature 失败:', e)
        }
      }

      currentIndex = endIndex

      // 使用 requestAnimationFrame 让浏览器喘口气，然后继续下一批
      if (currentIndex < features.length) {
        requestAnimationFrame(() => {
          setTimeout(processBatch, 50)
        })
      } else {
        // 最后一帧
        requestAnimationFrame(() => {
          processBatch()
        })
      }
    }

    // 延迟开始处理，确保地图已准备好
    setTimeout(processBatch, 500)

  } catch (error) {
    shapefileProcessing = false
    console.error('[Shapefile Query] 显示失败:', error)
    ElMessage.error('显示失败: ' + error.message)
  }
}

// 定位数据范围
const fitBounds = () => {
  if (markerStore.markers.length === 0) {
    ElMessage.warning('暂无点位数据')
    return
  }

  const bounds = L.latLngBounds(
    markerStore.markers.map(m => [m.latitude, m.longitude])
  )
  map.fitBounds(bounds, { padding: [50, 50] })
}

// 保存点位
const saveMarker = async () => {
  const valid = await markerFormRef.value.validate().catch(() => false)
  if (!valid) return

  let result
  if (editingMarker.value) {
    result = await markerStore.updateMarker(editingMarker.value, { ...markerForm })
  } else {
    result = await markerStore.addMarker({ ...markerForm })
  }

  if (result.success) {
    ElMessage.success(editingMarker.value ? '更新成功' : '添加成功')
    markerDialogVisible.value = false
    loadMarkers()
    resetMarkerForm()
  } else {
    ElMessage.error(result.message)
  }
}

// 重置表单
const resetMarkerForm = () => {
  editingMarker.value = null
  Object.assign(markerForm, {
    store_code: '',
    brand: '',
    name: '',
    store_type: '',
    city: '',
    district: '',
    area_manager: '',
    phone1: '',
    store_manager: '',
    phone2: '',
    address: '',
    open_date: '',
    business_hours: '',
    area: null,
    seats: null,
    rent: null,
    store_category: '',
    contact_person: '',
    contact_phone: '',
    description: '',
    latitude: 0,
    longitude: 0,
    status: '正常'
  })
}

// 编辑门店
const editMarker = async (id) => {
  const marker = markerStore.markers.find(m => m.id === id)
  if (!marker) return

  editingMarker.value = id
  Object.assign(markerForm, {
    store_code: marker.store_code || '',
    brand: marker.brand || '',
    name: marker.name,
    store_type: marker.store_type || '',
    city: marker.city || '',
    district: marker.district || '',
    area_manager: marker.area_manager || '',
    phone1: marker.phone1 || '',
    store_manager: marker.store_manager || '',
    phone2: marker.phone2 || '',
    address: marker.address || '',
    open_date: marker.open_date || '',
    business_hours: marker.business_hours || '',
    area: marker.area || null,
    seats: marker.seats || null,
    rent: marker.rent || null,
    store_category: marker.store_category || '',
    contact_person: marker.contact_person || '',
    contact_phone: marker.contact_phone || '',
    description: marker.description || '',
    latitude: marker.latitude,
    longitude: marker.longitude,
    status: marker.status || '正常'
  })
  markerDialogVisible.value = true
}

// 删除点位
const deleteMarker = async (id) => {
  const result = await markerStore.deleteMarker(id)
  if (result.success) {
    ElMessage.success('删除成功')
    loadMarkers()
  } else {
    ElMessage.error(result.message)
  }
}

// 暴露给window供弹窗调用
onMounted(() => {
  window.editMarkerExternal = editMarker
  window.deleteMarkerExternal = deleteMarker

  // 暴露Shapefile检索结果显示函数
  window.handleShapefileQueryFromGlobal = () => {
    if (window.shapefileQueryResult) {
      handleShapefileQuery({ detail: window.shapefileQueryResult })
      delete window.shapefileQueryResult
    }
  }

  // 等待DOM渲染完成后初始化地图
  nextTick(async () => {
    // 先加载品牌图标
    await brandIconStore.fetchBrandIcons()

    // 确保 initMap 完成（使用 await）
    await initMap()

    console.log('[MapView] 地图初始化完成')

    // 检查是否有门店跳转参数
    const { lat, lng, id, type } = route.query

    // 延迟处理，等待点位数据加载
    setTimeout(() => {
      if (!map) {
        console.error('[MapView] 地图未初始化')
        return
      }
      
      if (lat && lng) {
        // 跳转到指定位置
        try {
          map.setView([parseFloat(lat), parseFloat(lng)], 16)
          ElMessage.success('已跳转到门店位置')

          // 如果是品牌门店，打开 popup
          if (type === 'brandStore' && id && brandMarkerMap[id]) {
            brandMarkerMap[id].openPopup()
          }
        } catch (e) {
          console.error('[MapView] 跳转位置失败:', e)
        }
      }

      // 检查是否有Shapefile检索结果需要显示
      // 只有在地图完全准备好后才处理
      if (window.shapefileQueryResult && map) {
        console.log('[MapView] 检测到Shapefile检索结果，开始处理')
        try {
          handleShapefileQuery({ detail: window.shapefileQueryResult })
        } catch (e) {
          console.error('[MapView] 处理Shapefile结果失败:', e)
          ElMessage.error('显示检索结果失败')
        }
        // 清除全局变量避免重复显示
        delete window.shapefileQueryResult
      }
    }, 500)  // 减少等待时间，因为 initMap 已经 await 了
  })
})

onUnmounted(() => {
  if (map) map.remove()
  delete window.editMarkerExternal
  delete window.deleteMarkerExternal
  delete window.handleShapefileQueryFromGlobal
})
</script>

<style lang="scss" scoped>
.map-view {
  width: 100%;
  height: 100%;
  position: relative;
}

.toolbar {
  position: absolute;
  top: 10px;
  right: 10px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  overflow: hidden;
  border: 2px solid #409eff;

  .toolbar-header {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
    border-bottom: 1px solid #eee;

    .toolbar-title {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
    }

    .toolbar-arrow {
      transition: transform 0.3s;
      font-size: 14px;
      color: #fff;

      &.expanded {
        transform: rotate(90deg);
      }
    }
  }

  .toolbar-body {
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    position: relative;

    .tool-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
      border: 1px solid transparent;

      .el-icon {
        font-size: 16px;
        flex-shrink: 0;
      }

      span {
        font-size: 12px;
        color: #333;
      }

      &:hover {
        background: #ecf5ff;
        border-color: #409eff;
      }

      &.active {
        background: #ecf5ff;
        border-color: #409eff;
        span {
          color: #409eff;
        }
        .el-icon {
          color: #409eff;
        }
      }
    }

    .el-divider {
      margin: 4px 0;
    }

    .heatmap-style-panel {
      background: #f8f9fa;
      border: 1px solid #e4e7ed;
      border-radius: 6px;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 150px;

      .panel-section-title {
        font-size: 11px;
        font-weight: 600;
        color: #666;
        padding: 2px 4px;
        margin-bottom: 2px;
      }

      .heatmap-style-item {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 5px 6px;
        border-radius: 4px;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.2s;

        .style-preview {
          display: flex;
          border-radius: 3px;
          overflow: hidden;
          height: 8px;
          width: 100%;
        }

        .style-label {
          font-size: 11px;
          color: #555;
        }

        &:hover {
          background: #ecf5ff;
          border-color: #c6e2ff;
        }

        &.active {
          background: #ecf5ff;
          border-color: #409eff;
          .style-label {
            color: #409eff;
            font-weight: 600;
          }
        }
      }
    }
  }

  .measurement-result {
    background: #ecf5ff;
    padding: 4px 10px;
    font-size: 12px;
    color: #409eff;
    font-weight: 500;
    text-align: center;
    border-top: 1px solid #eee;
  }
}

// 圆形内门店分析
.analysis-empty {
  padding: 20px 0;
}

.analysis-content {
  .analysis-section {
    margin-bottom: 16px;

    &:last-child {
      margin-bottom: 0;
    }

    .analysis-section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      color: #409eff;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #eee;
    }
  }
}

// 图标样式选择器
.marker-style-selector {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  
  .style-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 4px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    border: 1px solid #eee;
    
    &:hover {
      background: #f5f7fa;
      border-color: #409eff;
    }
    
    &.active {
      background: #ecf5ff;
      border-color: #409eff;
      color: #409eff;
    }
    
    .style-icon {
      font-size: 20px;
      margin-bottom: 4px;
    }
    
    span:last-child {
      font-size: 12px;
    }
  }
}

// SVG 图标容器样式
:deep(.custom-svg-marker) {
  background: transparent !important;
  border: none !important;
}

.custom-marker-svg {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
  transition: transform 0.2s;
  
  &:hover {
    transform: scale(1.1);
  }
}

.map-container {
  width: 100%;
  height: 100%;
}

.coordinate-display {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: rgba(255, 255, 255, 0.9);
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  color: #666;
  z-index: 1000;
  display: flex;
  align-items: center;

  .city-name {
    color: #409eff;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

.layer-switcher {
  position: absolute;
  bottom: 10px;
  right: 10px;
  background: white;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;

  .layer-switcher-title {
    padding: 6px 10px;
    font-size: 12px;
    color: #666;
    border-bottom: 1px solid #eee;
  }

  .layer-options {
    display: flex;
    padding: 6px;

    .layer-option {
      width: 52px;
      height: 52px;
      margin-right: 6px;
      border-radius: 4px;
      overflow: hidden;
      cursor: pointer;
      border: 2px solid transparent;
      position: relative;

      &:last-child {
        margin-right: 0;
      }

      &:hover {
        border-color: #409eff;
      }

      &.active {
        border-color: #409eff;
      }

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      span {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.5);
        color: white;
        font-size: 10px;
        text-align: center;
        padding: 2px 0;
      }
    }
  }
}

// 显示门店开关 - 样式参考地图工具箱
.store-toggle-panel {
  position: absolute;
  top: 10px;
  right: 160px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  min-width: 100px;
  overflow: hidden;
  border: 2px solid #409eff;
}

.store-toggle-header {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
  border-bottom: 1px solid #eee;

  .toggle-title {
    font-size: 13px;
    font-weight: 600;
    color: #fff;
  }

  .toggle-arrow {
    margin-left: auto;
    font-size: 10px;
    color: #fff;
    transition: transform 0.2s;
    transform: rotate(-90deg);

    &.expanded {
      transform: rotate(0deg);
    }
  }
}

.store-toggle-body {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;

    .toggle-label {
      font-size: 12px;
      color: #606266;
    }

    .el-switch {
      --el-switch-off-color: #c0c4cc;
      font-size: 12px;
    }
  }
}

// 自定义缩放控件 - 在图层控制上方
.zoom-control-container {
  position: absolute;
  bottom: 110px;
  right: 10px;
  background: white;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  z-index: 1001;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  .zoom-in,
  .zoom-out {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 18px;
    color: #333;
    font-weight: bold;
    background: white;
    transition: background 0.2s;

    &:hover {
      background: #f5f5f5;
    }
  }

  .zoom-line {
    width: 32px;
    height: 1px;
    background: #eee;
  }
}

.search-panel {
  position: absolute;
  top: 10px;
  left: 10px;
  width: 360px;
  z-index: 1000;

  .search-box {
    position: relative;
    
    ::deep(.el-input__wrapper) {
      padding: 6px 12px;
      border-radius: 8px;
      box-shadow: 0 0 0 2px #1677ff33, 0 2px 8px rgba(0, 0, 0, 0.15);
      border: none;
      transition: all 0.2s;
      
      &:hover {
        box-shadow: 0 0 0 2px #1677ff55, 0 2px 8px rgba(0, 0, 0, 0.2);
      }
      
      &.is-focus {
        box-shadow: 0 0 0 2px #1677ff, 0 2px 8px rgba(0, 0, 0, 0.25);
      }
    }
    
    ::deep(.el-input__inner) {
      font-size: 14px;
      height: 28px;
      
      &::placeholder {
        color: #999;
      }
    }
    
    ::deep(.el-input__prefix) {
      color: #1677ff;
    }
    
    ::deep(.el-input__clear) {
      color: #999;
      
      &:hover {
        color: #666;
      }
    }
  }

  .search-results {
    background: white;
    border-radius: 8px;
    margin-top: 6px;
    max-height: 360px;
    overflow-y: auto;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    border: 1px solid #e8e8e8;

    .search-result-item {
      padding: 10px 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: #333;
      border-bottom: 1px solid #f0f0f0;
      transition: background 0.15s;

      &:last-child {
        border-bottom: none;
      }

      &:hover {
        background: #e6f4ff;
      }

      .result-icon {
        flex-shrink: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f5f5f5;
        border-radius: 50%;
        color: #1677ff;
        font-size: 14px;
      }

      .result-info {
        flex: 1;
        min-width: 0;

        .result-name {
          font-size: 14px;
          font-weight: 500;
          color: #333;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .result-address {
          font-size: 12px;
          color: #999;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
    }
  }
}

:deep(.custom-div-icon) {
  background: transparent;
  border: none;
}

// Shapefile 检索结果数值标签
:global(.shapefile-query-label) {
  background: transparent !important;
  border: none !important;
}
</style>
