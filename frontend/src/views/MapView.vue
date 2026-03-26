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
        <!-- 绘制折线 -->
        <el-tooltip content="绘制折线" placement="left">
          <div class="tool-item" :class="{ active: activeTool === 'polyline' }" @click="setTool('polyline')">
            <el-icon><Connection /></el-icon>
            <span>绘制折线</span>
          </div>
        </el-tooltip>
        <!-- 绘制多边形 -->
        <el-tooltip content="绘制多边形" placement="left">
          <div class="tool-item" :class="{ active: activeTool === 'polygon' }" @click="setTool('polygon')">
            <el-icon><Coordinate /></el-icon>
            <span>绘制多边形</span>
          </div>
        </el-tooltip>
        <!-- 绘制矩形 -->
        <el-tooltip content="绘制矩形" placement="left">
          <div class="tool-item" :class="{ active: activeTool === 'rectangle' }" @click="setTool('rectangle')">
            <el-icon><Crop /></el-icon>
            <span>绘制矩形</span>
          </div>
        </el-tooltip>
        <!-- 绘制圆形 -->
        <el-tooltip content="绘制圆形" placement="left">
          <div class="tool-item" :class="{ active: activeTool === 'circle' }" @click="setTool('circle')">
            <el-icon><FullScreen /></el-icon>
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
      <span v-if="currentCoords">
        经度: {{ currentCoords.lng.toFixed(6) }}&nbsp;&nbsp;
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
              <el-select v-model="markerForm.store_category" placeholder="直营/加盟" style="width: 100%">
                <el-option label="直营" value="直营" />
                <el-option label="加盟" value="加盟" />
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
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, watch, nextTick } from 'vue'
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
import {
  createCustomIcon, createSvgIcon, svgMarkerStyles, getCategoryIcon, getStatusColor, getStoreTypeColor,
  calculateDistance, formatDistance, calculateArea, formatArea
} from '@/utils/map'
import vecMapPreview from '@/assets/vec-map-preview.jpeg?url'
import imgMapPreview from '@/assets/img-map-preview.jpeg?url'

const markerStore = useMarkerStore()
const route = useRoute() // 获取路由参数

// 地图实例
let map = null
let tileLayer = null
let businessLayer = null
let markerClusterGroup = null
let heatmapLayer = null
let drawnItems = null
let measureLine = null
let measureArea = null
let measurePoints = []

// 状态变量
const activeTool = ref('')
const toolbarExpanded = ref(false) // 默认收起
const showHeatmap = ref(false)
const showCluster = ref(false)
const showBusinessLayer = ref(true)
const layerOpacity = ref(1)
const baseMapType = ref('vec')
const currentCoords = ref(null)
const measurementResult = ref('')
const markerDialogVisible = ref(false)
const editingMarker = ref(null)
const markerFormRef = ref(null)
const currentMarkerStyle = ref('store') // 当前图标样式

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

// 初始化地图
const initMap = () => {
  // 主地图 - 禁用默认缩放控件
  map = L.map('map', {
    center: [39.9042, 116.4074],
    zoom: 10,
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

  // 加载点位数据
  loadMarkers()
}

// 地址搜索
const searchAddress = async () => {
  if (!searchKeyword.value.trim()) return

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchKeyword.value)}&limit=5`,
      {
        headers: {
          'Accept-Language': 'zh-CN'
        }
      }
    )
    const data = await response.json()
    searchResults.value = data
  } catch (error) {
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
        html: '<div style="background:#f56c6c;color:white;padding:5px 10px;border-radius:4px;font-size:12px;">📍 ' + searchKeyword.value + '</div>',
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
    // 使用门店类型颜色: 已开业=绿, 重点候选=红, 一般候选=黄
    const iconColor = getStoreTypeColor(markerData.store_type)
    const icon = createSvgIcon(iconColor, currentMarkerStyle.value)

    const marker = L.marker([markerData.latitude, markerData.longitude], {
      icon,
      draggable: true
    })

    marker.bindPopup(`
      <div style="min-width: 220px; font-size: 13px;">
        <h4 style="margin: 0 0 8px 0; color: #333;">${markerData.brand || ''} ${markerData.name}</h4>
        <p style="margin: 4px 0;"><strong>编号:</strong> ${markerData.store_code || '-'}</p>
        <p style="margin: 4px 0;"><strong>类型:</strong> <span style="color: ${markerData.store_type === '已开业' ? '#67c23a' : markerData.store_type === '重点候选' ? '#f56c6c' : '#e6a23c'}">${markerData.store_type || '-'}</span></p>
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
    const iconColor = getStoreTypeColor(markerData.store_type)
    const icon = createSvgIcon(iconColor, currentMarkerStyle.value)
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
}

// 更新图层显示
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
}

// 监控图层显示状态
watch([showBusinessLayer, showHeatmap, showCluster, layerOpacity], () => {
  updateLayerDisplay()
  if (businessLayer) {
    businessLayer.setStyle({ opacity: layerOpacity.value, fillOpacity: layerOpacity.value * 0.3 })
  }
})

// 设置工具
const setTool = (tool) => {
  if (activeTool.value === tool) {
    activeTool.value = ''
    if (map) map.getContainer().style.cursor = ''
    measurePoints = []
    measurementResult.value = ''
    return
  }
  activeTool.value = tool

  // 设置光标
  if (['marker', 'polyline', 'polygon', 'rectangle', 'circle', 'measure', 'area'].includes(tool)) {
    map.getContainer().style.cursor = 'crosshair'
  }
}

// 地图点击处理
const handleMapClick = (e) => {
  if (!activeTool.value || !map) return

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

// 测量距离
const handleMeasure = (lat, lng) => {
  measurePoints.push([lat, lng])

  if (measurePoints.length === 1) {
    measurementResult.value = '点击选择终点'
  } else if (measurePoints.length === 2) {
    const distance = calculateDistance(
      measurePoints[0][0], measurePoints[0][1],
      measurePoints[1][0], measurePoints[1][1]
    )
    measurementResult.value = `距离: ${formatDistance(distance)}`

    // 绘制测量线
    if (measureLine) map.removeLayer(measureLine)
    measureLine = L.polyline(measurePoints, {
      color: '#f56c6c',
      weight: 3,
      dashArray: '5, 10'
    }).addTo(map)

    measurePoints = []
    setTimeout(() => {
      activeTool.value = ''
      measurementResult.value = ''
    }, 2000)
  }
}

// 测量面积
const handleAreaMeasure = (lat, lng) => {
  measurePoints.push([lat, lng])

  if (measurePoints.length < 3) {
    measurementResult.value = `已选择 ${measurePoints.length} 个点，还需 ${3 - measurePoints.length} 个`
  }

  if (measurePoints.length >= 3) {
    if (measureArea) map.removeLayer(measureArea)

    measureArea = L.polygon(measurePoints, {
      color: '#67c23a',
      fillColor: '#67c23a',
      fillOpacity: 0.3
    }).addTo(map)

    const area = calculateArea(measurePoints.map(p => ({ lat: p[0], lng: p[1] })))
    measurementResult.value = `面积: ${formatArea(area)} (双击结束)`

    map.once('dblclick', () => {
      measurePoints = []
      activeTool.value = ''
      measurementResult.value = ''
    })
  }
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
  const circle = L.circle(e.latlng, {
    radius: 1000,
    color: '#409eff',
    fillColor: '#409eff',
    fillOpacity: 0.3
  }).addTo(map)
  drawnItems.addLayer(circle)
  activeTool.value = ''
  measurementResult.value = ''
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
  if (measureLine) map.removeLayer(measureLine)
  if (measureArea) map.removeLayer(measureArea)
  if (drawnItems) drawnItems.clearLayers()
  measurePoints = []
  measurementResult.value = ''
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
  nextTick(() => {
    initMap()

    // 检查是否有门店跳转参数
    const { lat, lng } = route.query

    // 延迟处理，等待点位数据加载
    setTimeout(() => {
      if (lat && lng) {
        // 跳转到指定位置
        map.setView([parseFloat(lat), parseFloat(lng)], 16)
        ElMessage.success('已跳转到门店位置')
      }
    }, 1500)
  })

  // 添加地图点击事件监听
  setTimeout(() => {
    if (map) {
      map.on('click', handleMapClick)
    }
  }, 500)
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
  right: 70px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  overflow: hidden;

  .toolbar-header {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f5f7fa;
    border-bottom: 1px solid #eee;

    .toolbar-title {
      font-size: 13px;
      font-weight: 500;
      color: #333;
    }

    .toolbar-arrow {
      transition: transform 0.3s;
      font-size: 14px;
      color: #666;

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
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.2s;
      white-space: nowrap;

      .el-icon {
        font-size: 16px;
        flex-shrink: 0;
      }

      span {
        font-size: 13px;
        color: #333;
      }

      &:hover {
        background: #f5f7fa;
      }

      &.active {
        background: #ecf5ff;
        span {
          color: #409eff;
        }
        .el-icon {
          color: #409eff;
        }
      }
    }

    .el-divider {
      margin: 6px 0;
    }
  }

  .measurement-result {
    background: #ecf5ff;
    padding: 4px 12px;
    font-size: 14px;
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
