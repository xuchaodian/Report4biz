<template>
  <div class="map-view">
    <!-- 左上角地址检索框 -->
    <div class="search-panel">
      <el-input
        v-model="searchKeyword"
        placeholder="输入地址搜索定位..."
        size="default"
        @keyup.enter="searchAddress"
      >
        <template #append>
          <el-button :icon="Search" @click="searchAddress" />
        </template>
      </el-input>
      <div v-if="searchResults.length > 0" class="search-results">
        <div
          v-for="(result, index) in searchResults"
          :key="index"
          class="search-result-item"
          @click="goToLocation(result)"
        >
          <el-icon><Location /></el-icon>
          <span>{{ result.display_name }}</span>
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
        <el-tooltip content="热力图" placement="left">
          <div class="tool-item" :class="{ active: showHeatmap }" @click="toggleHeatmap">
            <el-icon><DataLine /></el-icon>
            <span>热力图</span>
          </div>
        </el-tooltip>
        <!-- 聚合显示 -->
        <el-tooltip content="聚合显示" placement="left">
          <div class="tool-item" :class="{ active: showCluster }" @click="toggleCluster">
            <el-icon><Grid /></el-icon>
            <span>聚合显示</span>
          </div>
        </el-tooltip>
        <!-- 图标样式 -->
        <el-tooltip content="图标样式" placement="left">
          <el-popover placement="left" :width="200" trigger="click">
            <template #reference>
              <div class="tool-item">
                <el-icon><Collection /></el-icon>
                <span>图标样式</span>
              </div>
            </template>
            <div class="marker-style-selector">
              <div 
                v-for="style in markerStyleOptions" 
                :key="style.value"
                class="style-option"
                :class="{ active: currentMarkerStyle === style.value }"
                @click="changeMarkerStyle(style.value)"
              >
                <span class="style-icon">{{ style.icon }}</span>
                <span>{{ style.label }}</span>
              </div>
            </div>
          </el-popover>
        </el-tooltip>
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
          <img :src="vecMapPreview" alt="矢量" />
          <span>标准</span>
        </div>
        <div
          class="layer-option"
          :class="{ active: baseMapType === 'img' }"
          @click="baseMapType = 'img'"
        >
          <img :src="imgMapPreview" alt="影像" />
          <span>影像</span>
        </div>
      </div>
    </div>

    <!-- 显示门店开关（整合竞品+品牌） -->
    <div class="store-toggle-panel">
      <div class="store-toggle-header" @click="storeToggleExpanded = !storeToggleExpanded">
        <span style="font-size: 12px; font-weight: 500;">显示门店</span>
        <el-switch v-model="showStoreLayers" @click.stop />
        <span class="toggle-arrow" :class="{ expanded: storeToggleExpanded }">▼</span>
      </div>
      <div v-show="storeToggleExpanded" class="store-toggle-body">
        <div class="toggle-row">
          <span class="toggle-label">竞品</span>
          <el-switch v-model="showCompetitorLayer" />
        </div>
        <div class="toggle-row">
          <span class="toggle-label">品牌</span>
          <el-switch v-model="showBrandStoreLayer" />
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
        <el-button type="primary" @click="confirmDrawCircle">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Location, Connection, Coordinate, Crop, FullScreen,
  Delete, View, Grid, DataLine, Odometer, Aim, Search, ArrowRight, Collection
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
import {
  createCustomIcon, createSvgIcon, createBrandImageIcon, svgMarkerStyles, getCategoryIcon, getStatusColor, getStoreTypeColor,
  calculateDistance, formatDistance, calculateArea, formatArea
} from '@/utils/map'
import vecMapPreview from '@/assets/vec-map-preview.jpeg?url'
import imgMapPreview from '@/assets/img-map-preview.jpeg?url'

const markerStore = useMarkerStore()
const competitorStore = useCompetitorStore()
const brandIconStore = useBrandIconStore()
const brandStoreStore = useBrandStoreStore()
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
let markerClusterGroup = null
let heatmapLayer = null
let drawnItems = null
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
const showBusinessLayer = ref(true)
const showStoreLayers = ref(true)       // 总开关：控制竞品+品牌图层整体显示
const showCompetitorLayer = ref(true)  // 竞品图层显示控制
const showBrandStoreLayer = ref(true)  // 品牌门店图层显示控制
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

// 高德地图瓦片配置
const gaodeTiles = {
  vec: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: [1, 2, 3, 4]
  },
  img: {
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: [1, 2, 3, 4]
  }
}

// 默认位置（北京）
const DEFAULT_LAT = 39.9042
const DEFAULT_LNG = 116.4074
const DEFAULT_CITY = '北京市'

// 获取IP位置
const getLocationByIP = async () => {
  try {
    const response = await fetch('http://ip-api.com/json/?fields=status,country,city,lat,lon')
    const data = await response.json()
    if (data.status === 'success') {
      return {
        lat: data.lat,
        lng: data.lon,
        city: data.city || data.country || DEFAULT_CITY
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
}

// 地址搜索（使用 ArcGIS World Geocoding API）
const searchAddress = async () => {
  if (!searchKeyword.value.trim()) return

  try {
    const keyword = searchKeyword.value.trim()
    // 使用 ArcGIS World Geocoding（免费，无需 API Key）
    const response = await fetch(
      `https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(keyword)}&f=json&maxLocations=5`
    )
    const data = await response.json()
    console.log('搜索结果:', data)
    if (data.candidates && data.candidates.length > 0) {
      // 转换 ArcGIS 数据格式
      searchResults.value = data.candidates.map(item => ({
        lat: item.location.y,
        lon: item.location.x,
        display_name: item.address,
        name: item.address
      }))
    } else {
      ElMessage.warning('未找到相关地址')
      searchResults.value = []
    }
  } catch (error) {
    console.error('搜索错误:', error)
    ElMessage.error('搜索失败，请重试')
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
  if (tileLayer) {
    map.removeLayer(tileLayer)
  }
  const config = gaodeTiles[baseMapType.value]
  tileLayer = L.tileLayer(config.url, {
    subdomains: config.subdomains,
    maxZoom: 18,
    minZoom: 3
  })
  map.addLayer(tileLayer)
}

// 监控底图切换
watch(baseMapType, loadBaseMap)

// 加载点位
const loadMarkers = async () => {
  console.log('=== loadMarkers 开始 ===')
  await markerStore.fetchMarkers()
  console.log('门店数据:', markerStore.markers)

  // 清除原有图层
  if (businessLayer) {
    map.removeLayer(businessLayer)
  }
  if (markerClusterGroup) {
    map.removeLayer(markerClusterGroup)
  }
  if (heatmapLayer) {
    map.removeLayer(heatmapLayer)
  }

  // 创建点位图层
  businessLayer = L.layerGroup()

  console.log('开始创建标记点, 数量:', markerStore.markers.length)

  markerStore.markers.forEach(markerData => {
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

    // 拖拽结束更新坐标
    marker.on('dragend', async (e) => {
      const latlng = e.target.getLatLng()
      await markerStore.updateMarker(markerData.id, {
        latitude: latlng.lat,
        longitude: latlng.lng
      })
      ElMessage.success('坐标已更新')
    })

    businessLayer.addLayer(marker)
  })

  // 聚合模式
  markerClusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false
  })

  markerStore.markers.forEach(markerData => {
    const brandIconUrl = brandIconMap.value[markerData.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl)
      : createSvgIcon(getStoreTypeColor(markerData.store_type), currentMarkerStyle.value)
    const marker = L.marker([markerData.latitude, markerData.longitude], { icon })
    marker.bindPopup(`<b>${markerData.brand || ''} ${markerData.name}</b><br/>${markerData.store_type || '-'}`)
    markerClusterGroup.addLayer(marker)
  })

  // 热力图
  const heatmapData = markerStore.markers.map(m => [m.latitude, m.longitude, 1])
  heatmapLayer = L.heatLayer(heatmapData, {
    radius: 25,
    blur: 15,
    maxZoom: 17,
    gradient: {
      0.2: 'blue',
      0.4: 'cyan',
      0.6: 'lime',
      0.8: 'yellow',
      1.0: 'red'
    }
  })

  // 根据显示模式添加图层
  updateLayerDisplay()
  
  // 确保竞品图层在门店图层下方（如果竞品图层已创建）
  if (competitorLayer && map.hasLayer(competitorLayer)) {
    updateCompetitorDisplay()
  }
}

// 加载竞品门店
const loadCompetitors = async () => {
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

  competitorStore.competitors.forEach(comp => {
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

    // 拖拽结束更新坐标
    marker.on('dragend', async (e) => {
      const latlng = e.target.getLatLng()
      await competitorStore.updateCompetitor(comp.id, {
        latitude: latlng.lat,
        longitude: latlng.lng
      })
      ElMessage.success('竞品坐标已更新')
    })

    competitorLayer.addLayer(marker)
  })

  console.log('竞品图层创建完成, competitorLayer:', !!competitorLayer)
  // 根据显示模式添加竞品图层
  updateCompetitorDisplay()
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

  brandStoreLayer = L.layerGroup()
  brandMarkerMap = {}  // 清空映射表

  brandStoreStore.brandStores.forEach(store => {
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

    marker.on('dragend', async (e) => {
      const latlng = e.target.getLatLng()
      await brandStoreStore.updateBrandStore(store.id, { latitude: latlng.lat, longitude: latlng.lng })
      ElMessage.success('品牌门店坐标已更新')
    })

    brandStoreLayer.addLayer(marker)
    brandMarkerMap[store.id] = marker  // 保存到映射表
  })

  updateBrandStoreDisplay()
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
    map.addLayer(brandStoreLayer)
    brandStoreLayer.bringToBack()
  } else {
    map.removeLayer(brandStoreLayer)
  }
}


const updateLayerDisplay = () => {
  if (!map) return

  // 移除所有业务图层
  if (map.hasLayer(businessLayer)) map.removeLayer(businessLayer)
  if (map.hasLayer(markerClusterGroup)) map.removeLayer(markerClusterGroup)
  if (map.hasLayer(heatmapLayer)) map.removeLayer(heatmapLayer)

  if (!showBusinessLayer.value) return

  if (showHeatmap.value) {
    map.addLayer(heatmapLayer)
  } else if (showCluster.value) {
    map.addLayer(markerClusterGroup)
  } else {
    map.addLayer(businessLayer)
  }

  // 确保门店图层始终显示在竞品和品牌门店图层上方
  if (map.hasLayer(competitorLayer)) competitorLayer.bringToBack()
  if (map.hasLayer(brandStoreLayer)) brandStoreLayer.bringToBack()
}

// 监控竞品图层开关
watch(showCompetitorLayer, () => {
  updateCompetitorDisplay()
})

// 监控总开关：显示门店
watch(showStoreLayers, (val) => {
  if (!val) {
    // 关闭时同时隐藏竞品和品牌图层
    showCompetitorLayer.value = false
    showBrandStoreLayer.value = false
  } else {
    // 打开时恢复两者
    showCompetitorLayer.value = true
    showBrandStoreLayer.value = true
  }
})

// 监控品牌门店图层开关
watch(showBrandStoreLayer, () => {
  updateBrandStoreDisplay()
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
  showHeatmap.value = !showHeatmap.value
  if (showHeatmap.value) showCluster.value = false
}

// 切换聚合
const toggleCluster = () => {
  showCluster.value = !showCluster.value
  if (showCluster.value) showHeatmap.value = false
}

// 清除绘制
const clearDrawings = () => {
  if (activeTool.value === 'measure') stopMeasure()
  if (activeTool.value === 'area') stopAreaMeasure()
  if (measureLine) { map.removeLayer(measureLine); measureLine = null }
  if (measureArea) { map.removeLayer(measureArea); measureArea = null }
  if (measureLayerGroup) { map.removeLayer(measureLayerGroup); measureLayerGroup = null }
  if (drawnItems) drawnItems.clearLayers()
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

  // 等待DOM渲染完成后初始化地图
  nextTick(async () => {
    // 先加载品牌图标
    await brandIconStore.fetchBrandIcons()
    initMap()

    // 检查是否有门店跳转参数
    const { lat, lng, id, type } = route.query

    // 延迟处理，等待点位数据加载
    setTimeout(() => {
      if (lat && lng) {
        // 跳转到指定位置
        map.setView([parseFloat(lat), parseFloat(lng)], 16)
        ElMessage.success('已跳转到门店位置')

        // 如果是品牌门店，打开 popup
        if (type === 'brandStore' && id && brandMarkerMap[id]) {
          brandMarkerMap[id].openPopup()
        }
      }
    }, 1500)
  })
})

onUnmounted(() => {
  if (map) map.remove()
  delete window.editMarkerExternal
  delete window.deleteMarkerExternal
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

// 显示门店开关（整合竞品+品牌）
.store-toggle-panel {
  position: absolute;
  bottom: 205px;
  right: 10px;
  background: white;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1001;
  min-width: 100px;
  overflow: hidden;
}

.store-toggle-header {
  padding: 7px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  background: #f5f7fa;
  border-bottom: 1px solid #ebeef5;

  .toggle-arrow {
    margin-left: auto;
    font-size: 10px;
    color: #909399;
    transition: transform 0.2s;
    transform: rotate(-90deg);

    &.expanded {
      transform: rotate(0deg);
    }
  }

  .el-switch {
    --el-switch-off-color: #409eff;
    font-size: 12px;
  }
}

.store-toggle-body {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;

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
  width: 320px;
  z-index: 1000;

  .search-results {
    background: white;
    border-radius: 4px;
    margin-top: 4px;
    max-height: 300px;
    overflow-y: auto;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);

    .search-result-item {
      padding: 10px 12px;
      cursor: pointer;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 13px;
      color: #666;
      border-bottom: 1px solid #eee;

      &:last-child {
        border-bottom: none;
      }

      &:hover {
        background: #f5f7fa;
        color: #409eff;
      }

      .el-icon {
        flex-shrink: 0;
        margin-top: 2px;
      }

      span {
        line-height: 1.4;
      }
    }
  }
}

:deep(.custom-div-icon) {
  background: transparent;
  border: none;
}
</style>
