<template>
  <div class="map-view">
    <!-- 左上角地址检索框 -->
    <div class="search-panel">
      <div class="search-body">
        <el-input
          v-model="searchKeyword"
          placeholder="输入地址搜索定位"
          size="default"
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

    <!-- 周边检索面板 -->
    <div class="poi-search-panel">
      <div class="poi-search-header" @click="poiSearchExpanded = !poiSearchExpanded">
        <span class="poi-search-title">周边检索</span>
        <span class="poi-search-arrow" :class="{ expanded: poiSearchExpanded }">▼</span>
      </div>
      <div v-show="poiSearchExpanded" class="poi-search-body">
        <div class="poi-search-input">
          <el-input
            v-model="poiKeywords"
            placeholder="输入关键词（如：咖啡厅、餐厅）"
            size="small"
            clearable
          />
        </div>
        <div class="poi-search-modes">
          <div class="poi-mode-btn" @click="startCircleSearch">
            <el-icon><Location /></el-icon>
            <span>半径圆</span>
          </div>
          <div class="poi-mode-btn" @click="startPolygonSearch">
            <el-icon><Edit /></el-icon>
            <span>多边形</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 商圈工具面板 -->
    <div class="business-circle-panel">
      <div class="business-circle-header" @click="businessCircleExpanded = !businessCircleExpanded">
        <span class="business-circle-title">商圈工具</span>
        <span class="business-circle-arrow" :class="{ expanded: businessCircleExpanded }">▼</span>
      </div>
      <div v-show="businessCircleExpanded" class="business-circle-body">
        <div class="business-circle-btn" @click="setTool('circle')">
          <el-icon><Coordinate /></el-icon>
          <span>商圈内点位</span>
        </div>
        <div class="business-circle-btn" @click="openPopulationDistribution">
          <el-icon><DataAnalysis /></el-icon>
          <span>商圈人口分布</span>
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
        <!-- 热力图 -->
        <div class="tool-item" :class="{ active: showHeatmap }" @click="toggleHeatmap">
          <el-icon><DataLine /></el-icon>
          <span>热力图</span>
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

    <!-- AI 助手 -->
    <AiAssistant
      ref="aiAssistantRef"
      :context="aiContext"
      @execute="handleAiExecute"
    />

    <!-- POI搜索结果 -->
    <PoiResultPanel
      :visible="poiResultVisible"
      :pois="poiResults"
      :map="map"
      @close="closePoiResults"
    />

    <!-- POI位置选择提示 -->
    <div v-if="poiPickLocationMode" class="poi-pick-location-overlay">
      <div class="poi-pick-location-hint">
        <el-icon><LocationFilled /></el-icon>
        <span>请在地图上点击选择搜索中心点</span>
        <el-button size="small" text @click="cancelPoiPickLocation">取消</el-button>
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
      :title="circleDialogMode === 'population' ? '商圈人口分布' : '设置圆形半径'"
      width="420px"
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
        <!-- 统计字段选择（仅商圈人口分布模式显示） -->
        <el-form-item v-if="circleDialogMode === 'population'" label="统计字段">
          <el-select
            v-model="selectedPopulationField"
            placeholder="选择统计字段"
            style="width: 100%;"
            :disabled="populationFieldOptions.length === 0"
          >
            <el-option
              v-for="field in populationFieldOptions"
              :key="field"
              :label="field"
              :value="field"
            />
          </el-select>
          <div v-if="populationFieldOptions.length === 0" style="font-size: 12px; color: #999; margin-top: 4px;">
            正在扫描数据文件...
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="circleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="circleDialogMode === 'population' ? analyzePopulationDistribution() : analyzeCircleStores()">
          {{ circleDialogMode === 'population' ? '分析' : '确定' }}
        </el-button>
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
  Delete, View, Grid, DataLine, Odometer, Aim, Search, ArrowRight, ArrowLeft, Collection, LocationFilled, Edit
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
import { useUserStore } from '@/stores/user'
import AiAssistant from '@/components/AiAssistant.vue'
import PoiResultPanel from '@/components/PoiResultPanel.vue'
import { executeTool } from '@/utils/aiExecutor'
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
const userStore = useUserStore()
const route = useRoute()

// AI 助手
const aiAssistantRef = ref(null)
const aiContext = computed(() => ({
  markers_count: markerStore.markers.length,
  competitors_count: competitorStore.competitors.length,
  cities: [...new Set(markerStore.markers.map(m => m.city).filter(Boolean))].slice(0, 10),
  brands: [...new Set(markerStore.markers.map(m => m.brand).filter(Boolean))].slice(0, 10)
}))

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
let allStoreClusterGroup = null  // 所有门店统一聚合图层
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
let circleSearchActive = false  // 防止重复触发半径搜索

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
const circleDialogMode = ref('stores') // 'stores'=商圈内点位, 'population'=商圈人口分布
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

// 商圈人口分布相关
let populationLayerGroup = null  // 人口分布图层组
const populationFieldOptions = ref([])  // 可选的统计字段列表
const selectedPopulationField = ref('')  // 用户选择的统计字段

// POI搜索结果
const poiResultVisible = ref(false)
const poiResults = ref([])
const poiMarkers = ref([])
let poiCenterMarker = null    // POI中心点标记
let poiRadiusCircle = null   // POI搜索半径圆
let poiCenterPoint = null     // POI中心点坐标

// 周边检索面板
const poiSearchExpanded = ref(false)
const poiKeywords = ref('')

// 商圈工具面板
const businessCircleExpanded = ref(false)

// 半径圆搜索状态
const pendingCircleSearch = ref(null) // { lat, lng }
let tempCircleMarker = null

// 多边形搜索状态
const pendingPolygonSearch = ref(false)
let tempPolygonLayer = null
let tempPolygonPoints = []
let tempPolygonMarker = null
let poiSearchRadius = 2000    // POI搜索半径（米）
let updateMarkers = null      // 标记更新函数

// 多边形点击处理函数（全局定义，以便在 finishPolygonSearch 中正确移除监听）
const addPolygonPoint = (e) => {
  tempPolygonPoints.push(e.latlng)
  tempPolygonLayer.setLatLngs(tempPolygonPoints)
  if (updateMarkers) updateMarkers()
  // 每次点击后更新按钮位置
  if (completeBtnElement) {
    const bounds = L.latLngBounds(tempPolygonPoints)
    const center = bounds.getCenter()
    const point = map.latLngToContainerPoint(center)
    completeBtnElement.style.top = `${Math.max(80, point.y - 100)}px`
    completeBtnElement.style.left = `${Math.min(point.x - 50, window.innerWidth - 150)}px`
    completeBtnElement.style.right = 'auto'
  }
}

// POI位置选择模式（用户需点击地图）
const poiPickLocationMode = ref(false)
const poiPendingSearch = ref(null) // 待执行的搜索参数

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

// 商圈人口分布 - 打开对话框
const openPopulationDistribution = async () => {
  if (!map) return
  
  // 关闭商圈工具面板
  businessCircleExpanded.value = false
  
  // 设置为人口分布模式
  circleDialogMode.value = 'population'
  
  // 重置表单
  circleForm.center = null
  circleForm.centerText = ''
  circleForm.radius = 2
  circleForm.unit = 'km'
  
  // 重置字段选项
  populationFieldOptions.value = []
  selectedPopulationField.value = ''
  
  // 加载统计字段选项
  try {
    const userId = localStorage.getItem('userId') || 1
    const listRes = await fetch(`/api/shapefiles?userId=${userId}`)
    const listData = await listRes.json()
    const shapefiles = Array.isArray(listData) ? listData : (listData.data || [])
    
    const allFields = new Set()
    
    for (const sf of shapefiles.slice(0, 5)) {  // 最多检查5个文件
      try {
        const sfRes = await fetch(`/api/shapefiles/${sf.id}`, {
          headers: { 'x-user-id': userId }
        })
        const sfData = await sfRes.json()
        const geojson = sfData.data?.geojson || sfData.geojson
        
        if (geojson && geojson.features && geojson.features.length > 0) {
          const fields = findAllIntegerFields(geojson.features)
          fields.forEach(f => allFields.add(f))
        }
      } catch (e) {
        console.error(`获取 ${sf.name} 字段失败:`, e)
      }
    }
    
    // 过滤掉 RecID，并按优先级排序
    const filteredFields = Array.from(allFields)
      .filter(f => f !== 'RecID')
      .sort((a, b) => {
        // 优先选择 常住人口
        if (a === '常住人口') return -1
        if (b === '常住人口') return 1
        return 0
      })
    
    populationFieldOptions.value = filteredFields
    if (populationFieldOptions.value.length > 0) {
      // 默认选择 常住人口，如果不存在则选择第一个
      const defaultField = populationFieldOptions.value.find(f => f === '常住人口') 
        || populationFieldOptions.value[0]
      selectedPopulationField.value = defaultField
    }
  } catch (e) {
    console.error('加载统计字段失败:', e)
  }
  
  // 提示用户点击地图
  ElMessage.info('请在地图上点击选择圆心位置')
  
  // 设置鼠标为十字光标
  const originalCursor = map.getContainer().style.cursor
  map.getContainer().style.cursor = 'crosshair'
  
  // 添加一次性地图点击监听
  map.once('click', (e) => {
    // 恢复原始光标
    map.getContainer().style.cursor = originalCursor
    
    circleForm.center = e.latlng
    circleForm.centerText = `${e.latlng.lng.toFixed(6)}, ${e.latlng.lat.toFixed(6)}`
    ElMessage.success(`已选择位置：${circleForm.centerText}`)
    // 用户点击地图后，才打开对话框
    circleDialogVisible.value = true
  })
}

// 识别多边形要素的中心点
const getFeatureCenter = (feature) => {
  const geom = feature.geometry
  if (!geom) return null
  
  let coords = []
  if (geom.type === 'Polygon') {
    coords = geom.coordinates[0]
  } else if (geom.type === 'MultiPolygon') {
    coords = geom.coordinates[0][0]
  } else {
    return null
  }
  
  if (!coords || coords.length === 0) return null
  
  const lng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length
  const lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length
  return { lat, lng }
}

// 自动识别整数型统计字段（返回所有符合条件的字段列表）
const findAllIntegerFields = (features) => {
  if (!features || features.length === 0) return []
  
  const fieldCount = {}  // 统计每个字段出现整数值的次数
  
  // 检查前20个要素
  const sampleSize = Math.min(20, features.length)
  for (let i = 0; i < sampleSize; i++) {
    const props = features[i].properties || {}
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === '') continue
      
      // 检查是否为整数（允许0和负数）
      const num = parseFloat(value)
      if (!isNaN(num) && Number.isInteger(num)) {
        fieldCount[key] = (fieldCount[key] || 0) + 1
      }
    }
  }
  
  // 找到所有出现次数>=50%的整数型字段
  const validFields = []
  for (const [field, count] of Object.entries(fieldCount)) {
    if (count >= sampleSize * 0.5) {
      validFields.push(field)
    }
  }
  
  return validFields
}

// 获取单个整数型字段（兼容旧函数）
const findIntegerField = (features) => {
  const fields = findAllIntegerFields(features)
  return fields.length > 0 ? fields[0] : null
}

// WGS84转GCJ-02 (标准算法)
const wgs84ToGcj02 = (lng, lat) => {
  const PI = 3.1415926535897932384626
  const a = 6378245.0
  const ee = 0.00669342162296594323
  
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  
  const radLat = lat / 180.0 * PI
  let magic = Math.sin(radLat)
  magic = 1 - ee * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI)
  dLat = (dLat * 180.0) / (a * (1 - ee) / (magic * sqrtMagic) * PI)
  
  const mgLat = lat + dLat
  const mgLng = lng + dLng
  
  return [mgLng, mgLat]
}

const transformLat = (x, y) => {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0
  return ret
}

const transformLng = (x, y) => {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0
  return ret
}

// 转换坐标数组
const transformCoords = (coords) => {
  if (typeof coords[0] === 'number') {
    const [gcjLng, gcjLat] = wgs84ToGcj02(coords[0], coords[1])
    return [gcjLng, gcjLat]
  } else {
    return coords.map(c => transformCoords(c))
  }
}

// 分析人口分布 - 使用用户选择的统计字段
const analyzePopulationDistribution = async () => {
  if (!circleForm.center) {
    ElMessage.warning('请先在地图上点击选择位置')
    return
  }
  
  // 检查是否已选择统计字段
  if (!selectedPopulationField.value) {
    ElMessage.warning('请等待数据文件扫描完成')
    return
  }
  
  try {
    const userId = localStorage.getItem('userId') || 1
    const radiusInMeters = circleForm.unit === 'km' 
      ? circleForm.radius * 1000 
      : circleForm.radius
    
    const centerLat = circleForm.center.lat
    const centerLng = circleForm.center.lng
    
    // 使用用户选择的字段
    const fieldName = selectedPopulationField.value
    
    // 1. 获取用户所有shapefile
    ElMessage.info('正在扫描数据文件...')
    const listRes = await fetch(`/api/shapefiles?userId=${userId}`)
    const listData = await listRes.json()
    const shapefiles = Array.isArray(listData) ? listData : (listData.data || [])
    
    if (shapefiles.length === 0) {
      ElMessage.warning('没有找到上传的数据文件，请先上传shp文件')
      return
    }
    
    // 2. 遍历每个shapefile，找出圆形范围内的多边形，并收集所有整型字段
    const allMatchingData = []  // 收集所有匹配的数据
    const allIntegerFields = {}  // 收集所有整型字段的统计值
    
    for (const sf of shapefiles) {
      try {
        const sfRes = await fetch(`/api/shapefiles/${sf.id}`, {
          headers: { 'x-user-id': userId }
        })
        const sfData = await sfRes.json()
        
        // geojson存储在sfData.data.geojson中
        const geojson = sfData.data?.geojson || sfData.geojson
        
        if (!geojson) continue
        
        const features = geojson.features || []
        if (features.length === 0) continue
        
        // 过滤圆形范围内的多边形（检测多边形是否与圆相交）
        for (const feature of features) {
          const geom = feature.geometry
          if (!geom) continue
          
          // 检测多边形是否与圆相交（中心点在圆内 OR 边界穿过圆 OR 圆心在多边形内）
          if (isPolygonIntersectsCircle(geom, centerLat, centerLng, radiusInMeters)) {
            // 计算多边形与圆的交集面积比例
            const intersectionRatio = calculateIntersectionRatio(geom, centerLat, centerLng, radiusInMeters)
            
            const value = parseInt(feature.properties?.[fieldName]) || 0
            allMatchingData.push({
              feature,
              value: Math.round(value * intersectionRatio),  // 按面积占比计算
              originalValue: value,
              intersectionRatio,
              fieldName,
              shapefileName: sf.name,
              geom: geom
            })
            
            // 收集所有整型字段的值（按面积占比计算）
            const props = feature.properties || {}
            for (const [key, val] of Object.entries(props)) {
              if (val !== null && val !== undefined && Number.isInteger(Number(val))) {
                if (!allIntegerFields[key]) {
                  allIntegerFields[key] = { total: 0, count: 0, originalTotal: 0 }
                }
                const weightedValue = Math.round(Number(val) * intersectionRatio)
                allIntegerFields[key].total += weightedValue
                allIntegerFields[key].originalTotal += Number(val)
                allIntegerFields[key].count++
              }
            }
          }
        }
      } catch (e) {
        console.error(`处理 ${sf.name} 失败:`, e)
      }
    }
    
    if (allMatchingData.length === 0) {
      ElMessage.warning(`在 ${circleForm.radius}${circleForm.unit} 范围内没有找到有效的多边形`)
      return
    }
    
    // 3. 计算统计信息
    const values = allMatchingData.map(d => d.value)
    const total = values.reduce((sum, v) => sum + v, 0)
    const minVal = Math.min(...values)
    const maxVal = Math.max(...values)
    
    // 4. 改进颜色分级：使用分位数分级（quantile classification）
    // 确保每个颜色级别有相似数量的多边形，区分度更好
    const colors = ['#2b83f6', '#abdda4', '#ffffbf', '#fdae61', '#d7191c']  // 蓝-绿-黄-橙-红，更直观
    const sortedValues = [...values].sort((a, b) => a - b)
    
    // 计算分位数阈值（把数据分成5等份）
    const getQuantile = (arr, q) => {
      const pos = (arr.length - 1) * q
      const base = Math.floor(pos)
      const rest = pos - base
      if (arr[base + 1] !== undefined) {
        return arr[base] + rest * (arr[base + 1] - arr[base])
      }
      return arr[base]
    }
    
    // 5级分位数阈值：0%, 20%, 40%, 60%, 80%, 100%
    const thresholds = [
      getQuantile(sortedValues, 0),
      getQuantile(sortedValues, 0.2),
      getQuantile(sortedValues, 0.4),
      getQuantile(sortedValues, 0.6),
      getQuantile(sortedValues, 0.8),
      getQuantile(sortedValues, 1)
    ]
    
    const getColorByValue = (value) => {
      if (value <= thresholds[1]) return colors[0]
      if (value <= thresholds[2]) return colors[1]
      if (value <= thresholds[3]) return colors[2]
      if (value <= thresholds[4]) return colors[3]
      return colors[4]
    }
    
    // 5. 清除之前的图层并绘制
    if (populationLayerGroup) {
      map.removeLayer(populationLayerGroup)
    }
    populationLayerGroup = L.layerGroup().addTo(map)
    
    allMatchingData.forEach((data, index) => {
      const { feature, value, geom } = data
      const color = getColorByValue(value)
      
      // GeoJSON坐标已经是GCJ-02，直接使用
      let latlngs = []
      if (geom.type === 'Polygon') {
        latlngs = geom.coordinates[0].map(c => [c[1], c[0]])  // [lng, lat] -> [lat, lng]
      } else if (geom.type === 'MultiPolygon') {
        latlngs = geom.coordinates[0][0].map(c => [c[1], c[0]])
      }
      
      if (latlngs.length > 0) {
        const polygon = L.polygon(latlngs, {
          color: '#ff7800',
          weight: 1,
          fillColor: color,
          fillOpacity: 0.7
        })
        
        const props = feature.properties || {}
        polygon.bindPopup(`
          <div style="font-size: 12px; min-width: 140px;">
            <strong>${props.name || props.NAME || `区域 ${index + 1}`}</strong><br/>
            <span style="color: #666;">${fieldName}:</span> 
            <strong style="color: #e6a23c;">${value.toLocaleString()}</strong><br/>
            <span style="color: #999; font-size: 11px;">
              占总计: ${(value / total * 100).toFixed(1)}%
            </span>
          </div>
        `)
        
        populationLayerGroup.addLayer(polygon)
        
        // 在多边形中心添加数值标签
        const polyCenter = getFeatureCenter(feature)
        if (polyCenter) {
          // 格式化数值
          let displayValue = value
          if (value >= 10000) {
            displayValue = (value / 10000).toFixed(1) + '万'
          } else if (value >= 1000) {
            displayValue = value.toLocaleString()
          }
          
          const labelMarker = L.marker([polyCenter.lat, polyCenter.lng], {
            icon: L.divIcon({
              className: 'population-label',
              html: `<div style="
                background: rgba(255,255,255,0.9);
                border: 1px solid ${color};
                border-radius: 4px;
                padding: 2px 6px;
                font-size: 11px;
                font-weight: bold;
                color: #333;
                white-space: nowrap;
                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                text-align: center;
              ">${displayValue}</div>`,
              iconSize: [60, 20],
              iconAnchor: [30, 10]
            })
          })
          populationLayerGroup.addLayer(labelMarker)
        }
      }
    })
    
    // 6. 绘制圆形边界
    const circle = L.circle([centerLat, centerLng], {
      radius: radiusInMeters,
      color: '#ff7800',
      fillColor: '#ff7800',
      fillOpacity: 0.1,
      weight: 4,  // 加粗边框
      dashArray: '8, 4'  // 增加虚线间距使边框更明显
    })
    populationLayerGroup.addLayer(circle)
    
    // 7. 绘制统计信息面板（位于多边形最右侧外侧）
    // 1. 收集所有多边形顶点的边界
    const allPoints = []
    allMatchingData.forEach(data => {
      const geom = data.geom
      if (geom.type === 'Polygon') {
        geom.coordinates[0].forEach(c => allPoints.push([c[1], c[0]])) // [lng,lat] -> [lat,lng]
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(poly => poly[0].forEach(c => allPoints.push([c[1], c[0]])))
      }
    })
    
    // 2. 找到经度最大的点（最右侧）
    let rightMostLng = centerLng
    let rightMostLat = centerLat
    allPoints.forEach(p => {
      if (p[1] > rightMostLng) {
        rightMostLng = p[1]
        rightMostLat = p[0]
      }
    })
    
    // 3. 在最右侧点偏移200像素（使用经纬度直接计算）
    const panelOffsetLng = 0.003 // 约300米
    const panelLatLng = [rightMostLat, rightMostLng + panelOffsetLng]
    
    // 构建统计信息HTML（恢复原始紧凑样式）
    const formatNumber = (num) => {
      if (num >= 10000) {
        return (num / 10000).toFixed(1) + '万'
      }
      return num.toLocaleString()
    }
    
    // 定义字段显示顺序
    const fieldOrder = ['常住人口', '本地人口', '0-14岁', '15-59岁', '60-64岁', '65岁以上']
    
    // 生成统计面板HTML
    let statsHtml = `<div style="background:rgba(255,255,255,0.95);border:2px solid #ff7800;border-radius:8px;padding:8px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.3);min-width:130px;cursor:grab;user-select:none;">`
    statsHtml += `<div style="font-size:12px;font-weight:bold;color:#ff7800;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:4px;">📊 统计信息</div>`
    statsHtml += `<div style="font-size:10px;color:#999;margin-bottom:4px;">共${allMatchingData.length}个区域</div>`
    
    // 按指定顺序显示所有整型字段
    const allFields = Object.entries(allIntegerFields)
    
    // 排序：先按指定顺序，然后按原始值总和排序
    allFields.sort((a, b) => {
      const idxA = fieldOrder.indexOf(a[0])
      const idxB = fieldOrder.indexOf(b[0])
      if (idxA !== -1 && idxB !== -1) return idxA - idxB
      if (idxA !== -1) return -1
      if (idxB !== -1) return 1
      return b[1].originalTotal - a[1].originalTotal
    })
    
    // 显示最多6个字段（包括当前选择字段）
    const displayFields = allFields.slice(0, 6)
    
    displayFields.forEach(([key, data]) => {
      const isCurrentField = key === fieldName
      statsHtml += `<div style="font-size:11px;${isCurrentField ? 'color:#e6a23c;font-weight:bold;' : 'color:#666;'}margin-top:3px;">
        ${key}: <span style="${isCurrentField ? 'color:#e6a23c;' : 'color:#409eff;font-weight:bold;'}">${formatNumber(data.total)}</span>
      </div>`
    })
    
    // 添加面积占比说明和拖动提示
    statsHtml += `<div style="margin-top:6px;padding-top:4px;border-top:1px dashed #eee;font-size:9px;color:#aaa;">*按面积占比计算</div>`
    statsHtml += `<div style="margin-top:4px;font-size:9px;color:#ff7800;text-align:center;">📋 可拖动调整位置</div>`
    
    statsHtml += `</div>`
    
    const panelWidth = 150 // 面板宽度(px)
    const panelMarker = L.marker([panelLatLng[0], panelLatLng[1]], {
      icon: L.divIcon({
        className: 'draggable-panel',
        html: statsHtml,
        iconSize: [panelWidth, 'auto'],
        iconAnchor: [0, 0]  // 左上角对齐
      }),
      draggable: true  // 启用拖动
    })
    // 拖动时更新位置
    panelMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng()
      console.log('面板拖动到:', pos.lat, pos.lng)
    })
    populationLayerGroup.addLayer(panelMarker)
    
    // 8. 调整视图 - 使用圆形边界作为默认
    try {
      const circleBounds = L.circle([centerLat, centerLng], { radius: radiusInMeters }).getBounds()
      if (allMatchingData.length > 0 && populationLayerGroup.getLayers().length > 0) {
        const layerBounds = populationLayerGroup.getBounds()
        if (layerBounds && layerBounds.isValid && layerBounds.isValid()) {
          map.fitBounds(layerBounds, { padding: [50, 50] })
          return
        }
      }
      map.fitBounds(circleBounds, { padding: [50, 50] })
    } catch (e) {
      console.error('调整视图失败:', e)
      map.setView([centerLat, centerLng], 12)
    }
    
    // 9. 显示结果
    ElMessage.success(`找到 ${allMatchingData.length} 个多边形，${fieldName} 合计: ${total.toLocaleString()}`)
    
    // 关闭对话框
    circleDialogVisible.value = false
    
  } catch (error) {
    console.error('分析人口分布失败:', error)
    ElMessage.error('分析失败：' + error.message)
  }
}

// 计算两点之间的距离（米）- 使用Haversine公式
const getDistanceFromLatLng = (lat1, lng1, lat2, lng2) => {
  const R = 6371000 // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// 检测点是否在圆形内（使用球面距离）
const isPointInCircle = (pointLat, pointLng, centerLat, centerLng, radius) => {
  return getDistanceFromLatLng(centerLat, centerLng, pointLat, pointLng) <= radius
}

// 检测多边形是否与圆相交
const isPolygonIntersectsCircle = (geom, centerLat, centerLng, radius) => {
  let polygons = []
  
  if (geom.type === 'Polygon') {
    polygons = geom.coordinates
  } else if (geom.type === 'MultiPolygon') {
    polygons = geom.coordinates.flat()
  } else {
    return false
  }
  
  for (const ring of polygons) {
    for (const coord of ring) {
      // 检查多边形的每个顶点是否在圆内
      const [lng, lat] = coord
      if (isPointInCircle(lat, lng, centerLat, centerLng, radius)) {
        return true
      }
    }
    
    // 检查圆心是否在多边形内（射线法）
    if (isPointInPolygon(centerLng, centerLat, ring)) {
      return true
    }
  }
  
  // 检查多边形边是否与圆相交
  for (const ring of polygons) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [lng1, lat1] = ring[i]
      const [lng2, lat2] = ring[i + 1]
      if (isLineIntersectsCircle(lat1, lng1, lat2, lng2, centerLat, centerLng, radius)) {
        return true
      }
    }
  }
  
  return false
}

// 检测圆心是否在多边形内（射线法）
const isPointInPolygon = (x, y, ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

// 检测线段是否与圆相交
const isLineIntersectsCircle = (lat1, lng1, lat2, lng2, centerLat, centerLng, radius) => {
  // Haversine距离函数内联
  const dist = (p1lat, p1lng, p2lat, p2lng) => {
    const R = 6371000
    const dLat = (p2lat - p1lat) * Math.PI / 180
    const dLng = (p2lng - p1lng) * Math.PI / 180
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(p1lat * Math.PI / 180) * Math.cos(p2lat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2)
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
  
  // 检查线段两个端点是否在圆内
  if (dist(lat1, lng1, centerLat, centerLng) <= radius) return true
  if (dist(lat2, lng2, centerLat, centerLng) <= radius) return true
  
  // 检查线段是否穿过圆的边界
  const d = dist(lat1, lng1, lat2, lng2)
  if (d === 0) return false
  
  // 计算线段到圆心的最近点
  const t = Math.max(0, Math.min(1, 
    ((centerLat - lat1) * (lat2 - lat1) + (centerLng - lng1) * (lng2 - lng1)) / 
    (Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2))
  ))
  const closestLat = lat1 + t * (lat2 - lat1)
  const closestLng = lng1 + t * (lng2 - lng1)
  
  return dist(closestLat, closestLng, centerLat, centerLng) <= radius
}

// 计算多边形面积（平方米）- 使用球面近似公式
const calculatePolygonArea = (ring) => {
  if (!ring || ring.length < 3) return 0
  
  let area = 0
  const n = ring.length
  const R = 6371000  // 地球半径（米）
  
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[(i + 1) % n]
    
    const lat1Rad = lat1 * Math.PI / 180
    const lat2Rad = lat2 * Math.PI / 180
    const lng1Rad = lng1 * Math.PI / 180
    const lng2Rad = lng2 * Math.PI / 180
    
    area += (lng2Rad - lng1Rad) * (2 + Math.sin(lat1Rad) + Math.sin(lat2Rad))
  }
  
  area = Math.abs(area * R * R / 2)
  return area
}

// 计算多边形与圆的交集面积比例（使用采样方法）
const calculateIntersectionRatio = (geom, centerLat, centerLng, radius) => {
  // 获取多边形的外边界
  let outerRing = null
  if (geom.type === 'Polygon') {
    outerRing = geom.coordinates[0]
  } else if (geom.type === 'MultiPolygon') {
    // 使用第一个多边形的外边界
    outerRing = geom.coordinates[0][0]
  }
  
  if (!outerRing) return 0
  
  // 计算多边形总面积
  const polygonArea = calculatePolygonArea(outerRing)
  if (polygonArea === 0) return 0
  
  // 计算圆的面积
  const circleArea = Math.PI * radius * radius
  
  // 如果圆面积大于多边形面积，直接用多边形面积估算
  if (circleArea > polygonArea * 2) {
    // 检查多边形是否完全在圆内
    let allInside = true
    for (const coord of outerRing) {
      const [lng, lat] = coord
      if (getDistanceFromLatLng(centerLat, centerLng, lat, lng) > radius) {
        allInside = false
        break
      }
    }
    if (allInside) return 1.0
  }
  
  // 使用采样方法估算交集面积
  // 获取多边形的边界框
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of outerRing) {
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }
  
  // 将经纬度边界转换为米
  const centerLngM = centerLng
  const lngDiff = maxLng - minLng
  const latDiff = maxLat - minLat
  
  // 采样点数量（越多越精确但越慢）
  const samples = 200
  let insidePolygon = 0
  let insideBoth = 0
  
  for (let i = 0; i < samples; i++) {
    // 在边界框内随机生成点
    const sampleLng = minLng + Math.random() * lngDiff
    const sampleLat = minLat + Math.random() * latDiff
    
    // 检查点是否在多边形内
    if (isPointInPolygon(sampleLng, sampleLat, outerRing)) {
      insidePolygon++
      
      // 检查点是否在圆内
      if (getDistanceFromLatLng(centerLat, centerLng, sampleLat, sampleLng) <= radius) {
        insideBoth++
      }
    }
  }
  
  // 如果采样点太少，返回保守估计
  if (insidePolygon < 10) {
    return 0.5  // 假设一半面积在圆内
  }
  
  // 返回交集面积占多边形面积的比例
  return insideBoth / insidePolygon
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

  // 如果"我的门店"图层已开启，则不重复显示（避免标记重叠）
  const showMyStores = !showBusinessLayer.value
  
  // 添加圆形内的我的门店标记（如果图层未开启则显示）
  if (showMyStores) {
    circleAnalysisData.myStoresFull.forEach((store, index) => {
      // 优先使用品牌图标，否则使用当前图标样式
      const brandIconUrl = brandIconMap.value[store.brand]
      const icon = brandIconUrl 
        ? createBrandImageIcon(brandIconUrl) 
        : createCustomIcon(getStatusColor(store.store_type), currentMarkerStyle.value)
      const marker = L.marker([store.latitude, store.longitude], { icon })
      marker.bindPopup(`<b>${store.name}</b><br>品牌: ${store.brand || '-'}<br>距圆心: ${store.distance < 1000 ? `${store.distance.toFixed(0)}米` : `${(store.distance / 1000).toFixed(2)}公里`}`)
      analysisCircleLayer.addLayer(marker)
    })
  }

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
    // 优先使用品牌图标，否则使用颜色圆点图标
    const brandIconUrl = brandIconMap.value[store.brand]
    const icon = brandIconUrl ? createBrandImageIcon(brandIconUrl) : createSvgIcon(brandColor, 'dot', 1.2)
    const marker = L.marker([store.latitude, store.longitude], { icon })
    marker.bindPopup(`<b>${store.name}</b><br>品牌: ${store.brand || '-'}<br>距圆心: ${store.distance < 1000 ? `${store.distance.toFixed(0)}米` : `${(store.distance / 1000).toFixed(2)}公里`}`)
    analysisCircleLayer.addLayer(marker)
  })

  // 调整视图以包含所有元素（根据是否显示我的门店来决定）
  const myStorePoints = showMyStores 
    ? circleAnalysisData.myStoresFull.map(s => [s.latitude, s.longitude])
    : []
  const allPoints = [
    [circleAnalysisParams.center.lat, circleAnalysisParams.center.lng],
    ...myStorePoints,
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

  // 主地图 - 使用简化的投影（适合国内地图）
  // 高德/腾讯/影像地图都使用GCJ-02坐标系
  map = L.map('map', {
    center: [centerLat, centerLng],
    zoom: 12,
    zoomControl: false,
    // 关键：设置适合中国地图的坐标系统
    zoomSnap: 0.5,
    worldCopyJump: false
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

  // 地图加载完成后修正尺寸（解决容器隐藏后显示的定位问题）
  setTimeout(() => {
    if (map) map.invalidateSize({ pan: false })
  }, 100)

  // 加载点位数据
  await loadMarkers()
  // 加载竞品门店
  await loadCompetitors()
  // 加载品牌门店
  await loadBrandStores()
  // 加载购物中心
  await loadShoppingCenters()
  
  // 如果初始状态是聚合模式，需要构建聚合图层
  if (showCluster.value) {
    buildAllStoreCluster()
  }
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
    // 高德地图添加className用于CSS灰度处理
    const tileClassName = baseMapType.value === 'vec' ? 'gaode-gray-tiles' : ''
    if (baseMapType.value === 'tencent') {
      tileLayer = L.tencentTileLayer(config.url, {
        subdomains: config.subdomains,
        maxZoom: 18,
        minZoom: 3,
        className: tileClassName
      })
    } else {
      tileLayer = L.tileLayer(config.url, {
        subdomains: config.subdomains,
        maxZoom: 18,
        minZoom: 3,
        className: tileClassName
      })
    }
    map.addLayer(tileLayer)
    
    // 底图切换后修正地图尺寸
    setTimeout(() => {
      if (map) map.invalidateSize({ pan: false })
    }, 100)
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

  // 热力图（经典样式：蓝→红）
  const heatmapData = dataToShow.map(m => [m.latitude, m.longitude, 1])
  heatmapLayer = L.heatLayer(heatmapData, { radius: 40, blur: 10, maxZoom: 17, max: 1.0, minOpacity: 0.5, gradient: { 0.2: '#0066ff', 0.4: '#00ddff', 0.6: '#44dd44', 0.8: '#ffcc00', 1.0: '#ff3300' } })

  // 根据显示模式添加图层
  updateLayerDisplay()

  // 确保竞品图层在门店图层下方（如果竞品图层已创建）
  if (competitorLayer && map.hasLayer(competitorLayer)) {
    updateCompetitorDisplay()
  }
}

// 构建所有门店统一聚合图层
const buildAllStoreCluster = () => {
  console.log('[聚合] buildAllStoreCluster 开始')
  console.log('[聚合] 当前选择: 我的门店=', showBusinessLayer.value, '竞品=', showCompetitorLayer.value, '品牌门店=', showBrandStoreLayer.value, '购物中心=', showShoppingCenterLayer.value)
  if (!map) return
  
  if (allStoreClusterGroup) {
    try { map.removeLayer(allStoreClusterGroup) } catch(e) {}
  }
  
  allStoreClusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false
  })
  
  let totalCount = 0
  
  // 1. 我的门店（只有开关开启时才聚合）
  if (showBusinessLayer.value && markerStore.markers && markerStore.markers.length > 0) {
    const visibleIds = markerStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? markerStore.markers.filter(m => visibleIds.includes(m.id))
      : markerStore.markers
    console.log('[聚合] 我的门店:', data.length)
    data.forEach(m => {
      if (m.latitude && m.longitude) {
        const brandIconUrl = brandIconMap.value[m.brand]
        const icon = brandIconUrl ? createBrandImageIcon(brandIconUrl) : createSvgIcon(getStoreTypeColor(m.store_type), 'dot', 1.2)
        const marker = L.marker([m.latitude, m.longitude], { icon })
        marker.bindPopup(`<b>我的门店</b><br/>${m.brand || ''} ${m.name}<br/>${(m.city || '') + (m.district || '') + (m.address || '-')}`)
        allStoreClusterGroup.addLayer(marker)
        totalCount++
      }
    })
  }
  
  // 2. 竞品门店（只有开关开启时才聚合）
  if (showCompetitorLayer.value && competitorStore.competitors && competitorStore.competitors.length > 0) {
    const brandColors = { '大米先生': '#e6a23c', '谷田稻香': '#f56c6c', '吉野家': '#409eff', '老乡鸡': '#67c23a', '米村拌饭': '#9c27b0', '其他': '#ff9800' }
    const getBrandColor = (brand) => {
      if (!brand) return brandColors['其他']
      for (const key in brandColors) { if (brand.includes(key) || key.includes(brand)) return brandColors[key] }
      return brandColors['其他']
    }
    const visibleIds = competitorStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? competitorStore.competitors.filter(c => visibleIds.includes(c.id))
      : competitorStore.competitors
    console.log('[聚合] 竞品门店:', data.length)
    data.forEach(c => {
      if (c.latitude && c.longitude) {
        const brandIconUrl = brandIconMap.value[c.brand]
        const icon = brandIconUrl ? createBrandImageIcon(brandIconUrl) : createSvgIcon(getBrandColor(c.brand), 'dot', 1.2)
        const marker = L.marker([c.latitude, c.longitude], { icon })
        marker.bindPopup(`<div style="color:${getBrandColor(c.brand)}"><b>竞品</b><br/>${c.brand || ''} ${c.name}<br/>${(c.city || '') + (c.district || '') + (c.address || '-')}</div>`)
        allStoreClusterGroup.addLayer(marker)
        totalCount++
      }
    })
  }
  
  // 3. 品牌门店（只有开关开启时才聚合）
  if (showBrandStoreLayer.value && brandStoreStore.brandStores && brandStoreStore.brandStores.length > 0) {
    console.log('[聚合] 品牌门店原始:', brandStoreStore.brandStores?.length || 0)
    const visibleIds = brandStoreStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? brandStoreStore.brandStores.filter(s => visibleIds.includes(s.id))
      : brandStoreStore.brandStores
    console.log('[聚合] 品牌门店:', data.length)
    data.forEach(s => {
      if (s.latitude && s.longitude) {
        const brandColor = s.icon_color || '#888888'
        const brandIconUrl = brandIconMap.value[s.brand]
        const icon = brandIconUrl ? createBrandImageIcon(brandIconUrl) : createSvgIcon(brandColor, 'dot', 1.2)
        const marker = L.marker([s.latitude, s.longitude], { icon })
        marker.bindPopup(`<div style="color:${brandColor}"><b>品牌门店</b><br/>${s.brand || ''} ${s.name}<br/>${(s.city || '') + (s.district || '') + (s.address || '-')}</div>`)
        allStoreClusterGroup.addLayer(marker)
        totalCount++
      }
    })
  }
  
  // 4. 购物中心（只有开关开启时才聚合）
  if (showShoppingCenterLayer.value && shoppingCenterStore.shoppingCenters && shoppingCenterStore.shoppingCenters.length > 0) {
    const visibleIds = shoppingCenterStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? shoppingCenterStore.shoppingCenters.filter(s => visibleIds.includes(s.id))
      : shoppingCenterStore.shoppingCenters
    console.log('[聚合] 购物中心:', data.length)
    data.forEach(s => {
      if (s.latitude && s.longitude) {
        const icon = createSvgIcon('#9370db', 'star', 1.5)
        const marker = L.marker([s.latitude, s.longitude], { icon })
        marker.bindPopup(`<div style="color:#9370db"><b>购物中心</b><br/>${s.name}<br/>${s.grade || ''} ${s.address || ''}</div>`)
        allStoreClusterGroup.addLayer(marker)
        totalCount++
      }
    })
  }
  
  console.log('[聚合] 总计:', totalCount)
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

  // 热力图模式下重新构建（统一由buildAllStoreHeatmap处理）
  if (showHeatmap.value) {
    buildAllStoreHeatmap()
  }
  
  if (wasOnMap) {
    if (showHeatmap.value && heatmapLayer) {
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
  
  // 聚合模式下同步更新聚合图层
  if (showCluster.value) buildAllStoreCluster()
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
  
  // 聚合模式下同步更新聚合图层
  if (showCluster.value) buildAllStoreCluster()
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
  
  // 聚合模式下同步更新聚合图层
  if (showCluster.value) buildAllStoreCluster()
}

const updateLayerDisplay = () => {
  if (!map) return

  console.log('[updateLayerDisplay] showCluster:', showCluster.value, 'showHeatmap:', showHeatmap.value)

  // 移除所有业务图层
  try {
    if (businessLayer && map.hasLayer(businessLayer)) map.removeLayer(businessLayer)
    if (markerClusterGroup && map.hasLayer(markerClusterGroup)) map.removeLayer(markerClusterGroup)
    if (allStoreClusterGroup && map.hasLayer(allStoreClusterGroup)) map.removeLayer(allStoreClusterGroup)
    if (heatmapLayer && map.hasLayer(heatmapLayer)) map.removeLayer(heatmapLayer)
    // 聚合或热力图模式下隐藏其他门店图层
    if (showCluster.value || showHeatmap.value) {
      if (competitorLayer && map.hasLayer(competitorLayer)) map.removeLayer(competitorLayer)
      if (brandStoreLayer && map.hasLayer(brandStoreLayer)) map.removeLayer(brandStoreLayer)
      if (shoppingCenterLayer && map.hasLayer(shoppingCenterLayer)) map.removeLayer(shoppingCenterLayer)
    }
  } catch(e) {}

  // 聚合模式优先显示聚合图层
  if (showCluster.value && allStoreClusterGroup) {
    console.log('[updateLayerDisplay] 显示聚合图层')
    try { map.addLayer(allStoreClusterGroup) } catch(e) {}
    return
  }

  // 热力图模式显示热力图
  if (showHeatmap.value && heatmapLayer) {
    console.log('[updateLayerDisplay] 显示热力图')
    try { map.addLayer(heatmapLayer) } catch(e) {}
    return
  }

  // 关闭聚合/热力图模式后，重新添加独立图层
  if (showCompetitorLayer.value && competitorLayer) {
    try { map.addLayer(competitorLayer) } catch(e) {}
  }
  if (showBrandStoreLayer.value && brandStoreLayer) {
    try { map.addLayer(brandStoreLayer) } catch(e) {}
  }
  if (showShoppingCenterLayer.value && shoppingCenterLayer) {
    try { map.addLayer(shoppingCenterLayer) } catch(e) {}
  }

  if (!showBusinessLayer.value) {
    console.log('[updateLayerDisplay] showBusinessLayer为false，直接返回')
    return
  }

  if (businessLayer) {
    console.log('[updateLayerDisplay] 显示普通门店图层')
    try { map.addLayer(businessLayer) } catch(e) {}
  }

  // 确保图层顺序正确
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
  if (showCluster.value) buildAllStoreCluster()
})
watch(() => brandStoreStore.visibleIds, () => {
  if (map) reloadBrandStoreLayer()
  if (showCluster.value) buildAllStoreCluster()
})
watch(() => shoppingCenterStore.visibleIds, () => {
  if (map) reloadShoppingCenterLayer()
  if (showCluster.value) buildAllStoreCluster()
})

// 监听门店开关变化，聚合/热力图模式下重新构建
watch([showBusinessLayer, showCompetitorLayer, showBrandStoreLayer, showShoppingCenterLayer], () => {
  if (showCluster.value) {
    buildAllStoreCluster()
    updateLayerDisplay()
  } else if (showHeatmap.value) {
    buildAllStoreHeatmap()
    updateLayerDisplay()
  }
})

// 监控图层显示状态（不包括竞品开关，由 @change 事件处理）
watch([showBusinessLayer, showHeatmap, showCluster, layerOpacity], () => {
  if (showCluster.value) buildAllStoreCluster()
  else if (showHeatmap.value) buildAllStoreHeatmap()
  updateLayerDisplay()
  // 只在非聚合模式下对 businessLayer 调用 setStyle（markerClusterGroup 不支持此方法）
  if (businessLayer && !showCluster.value && businessLayer.setStyle) {
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
  // POI位置选择模式
  if (poiPickLocationMode.value && poiPendingSearch.value) {
    cancelPoiPickLocation()
    executePoiSearchAtLocation(e.latlng.lat, e.latlng.lng)
    return
  }
  
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

// 构建所有门店热力图
const buildAllStoreHeatmap = () => {
  console.log('[热力图] buildAllStoreHeatmap 开始')
  console.log('[热力图] 当前选择: 我的门店=', showBusinessLayer.value, '竞品=', showCompetitorLayer.value, '品牌门店=', showBrandStoreLayer.value, '购物中心=', showShoppingCenterLayer.value)
  
  if (!map) return
  
  // 移除旧热力图
  if (heatmapLayer) {
    try { map.removeLayer(heatmapLayer) } catch(e) {}
  }
  
  const hmData = []
  
  // 1. 我的门店（只有开关开启时才包含）
  if (showBusinessLayer.value && markerStore.markers && markerStore.markers.length > 0) {
    const visibleIds = markerStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? markerStore.markers.filter(m => visibleIds.includes(m.id))
      : markerStore.markers
    data.forEach(m => {
      if (m.latitude && m.longitude) {
        hmData.push([m.latitude, m.longitude, 1])
      }
    })
    console.log('[热力图] 我的门店:', data.length)
  }
  
  // 2. 竞品门店（只有开关开启时才包含）
  if (showCompetitorLayer.value && competitorStore.competitors && competitorStore.competitors.length > 0) {
    const visibleIds = competitorStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? competitorStore.competitors.filter(c => visibleIds.includes(c.id))
      : competitorStore.competitors
    data.forEach(c => {
      if (c.latitude && c.longitude) {
        hmData.push([c.latitude, c.longitude, 1])
      }
    })
    console.log('[热力图] 竞品门店:', data.length)
  }
  
  // 3. 品牌门店（只有开关开启时才包含）
  if (showBrandStoreLayer.value && brandStoreStore.brandStores && brandStoreStore.brandStores.length > 0) {
    const visibleIds = brandStoreStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? brandStoreStore.brandStores.filter(s => visibleIds.includes(s.id))
      : brandStoreStore.brandStores
    data.forEach(s => {
      if (s.latitude && s.longitude) {
        hmData.push([s.latitude, s.longitude, 1])
      }
    })
    console.log('[热力图] 品牌门店:', data.length)
  }
  
  // 4. 购物中心（只有开关开启时才包含）
  if (showShoppingCenterLayer.value && shoppingCenterStore.shoppingCenters && shoppingCenterStore.shoppingCenters.length > 0) {
    const visibleIds = shoppingCenterStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? shoppingCenterStore.shoppingCenters.filter(s => visibleIds.includes(s.id))
      : shoppingCenterStore.shoppingCenters
    data.forEach(s => {
      if (s.latitude && s.longitude) {
        hmData.push([s.latitude, s.longitude, 1])
      }
    })
    console.log('[热力图] 购物中心:', data.length)
  }
  
  console.log('[热力图] 总计:', hmData.length)
  
  if (hmData.length > 0) {
    heatmapLayer = L.heatLayer(hmData, { radius: 40, blur: 10, maxZoom: 17, max: 1.0, minOpacity: 0.5, gradient: { 0.2: '#0066ff', 0.4: '#00ddff', 0.6: '#44dd44', 0.8: '#ffcc00', 1.0: '#ff3300' } })
  }
}

// 切换热力图
const toggleHeatmap = () => {
  if (!map) return
  showHeatmap.value = !showHeatmap.value
  console.log('[toggleHeatmap] showHeatmap:', showHeatmap.value)
  
  if (showHeatmap.value) {
    showCluster.value = false
    console.log('[toggleHeatmap] 构建热力图')
    buildAllStoreHeatmap()
    if (heatmapLayer) {
      try { map.addLayer(heatmapLayer) } catch(e) {}
    }
    try {
      if (businessLayer && map.hasLayer(businessLayer)) {
        heatmapLayer.bringToBack()
      }
    } catch(e) {}
  } else {
    try {
      if (heatmapLayer && map.hasLayer(heatmapLayer)) map.removeLayer(heatmapLayer)
    } catch(e) {}
  }
  
  // 更新图层显示
  updateLayerDisplay()
}

// 切换聚合
const toggleCluster = () => {
  console.log('[toggleCluster] 开始, 当前showCluster:', showCluster.value)
  showCluster.value = !showCluster.value
  console.log('[toggleCluster] 切换后showCluster:', showCluster.value)
  if (showCluster.value) {
    showHeatmap.value = false
    console.log('[toggleCluster] 开始构建聚合图层')
    buildAllStoreCluster()
  }
  // 无论开启还是关闭聚合，都需要更新图层显示
  console.log('[toggleCluster] 调用updateLayerDisplay')
  updateLayerDisplay()
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

// ===== AI 助手 Function Calling 执行器（委托给 aiExecutor.js） =====
const handleAiExecute = async (toolCall) => {
  try {
    const result = await executeTool(toolCall.name, toolCall.args, {
      map,
      markerStore, competitorStore, brandStoreStore, shoppingCenterStore,
      showCompetitorLayer, showBrandStoreLayer, showShoppingCenterLayer, showBusinessLayer,
      showHeatmap, showCluster,
      toggleHeatmap, toggleCluster, clearDrawings, setTool
    })
    
    // 需要用户选择位置
    if (result?.require_user_location) {
      poiPendingSearch.value = {
        keywords: result.keywords,
        radius: result.radius
      }
      poiPickLocationMode.value = true
      
      // 在AI对话框中显示提示
      if (aiAssistantRef.value) {
        const hintMsg = result.location_hint 
          ? `无法定位"${result.location_hint}"，请在地图上点击选择搜索中心点`
          : '请在地图上点击选择搜索中心点'
        aiAssistantRef.value.addFeedback(hintMsg)
      }
      
      // 显示提示消息
      if (result.location_hint) {
        ElMessage.warning(`无法定位"${result.location_hint}"，请在地图上点击选择搜索中心点`)
      } else {
        ElMessage.info('请在地图上点击选择搜索中心点')
      }
      return
    }
    
    if (result?.message) {
      ElMessage.success(result.message)
    }
    
    // 处理POI搜索结果
    if (result?.type === 'poi') {
      poiResults.value = result.pois || []
      poiResultVisible.value = true
      
      // 如果有搜索中心点，先 flyTo 过去让用户感知到"已定位到目标地点"
      if (result.centerLat && result.centerLng) {
        map.flyTo([result.centerLat, result.centerLng], 15, { animate: true, duration: 1.2 })
        // 短暂延迟后再展示完整范围（含所有POI结果）
        setTimeout(() => {
          showPoiOnMap(result.pois, result.centerLat, result.centerLng, result.radius)
        }, 1300)
      } else {
        showPoiOnMap(result.pois, result.centerLat, result.centerLng, result.radius)
      }
    }
  } catch (err) {
    console.error('[AI Execute]', err)
    // 静默失败：只打印日志，不弹出 toast，避免与成功的工具调用产生混乱提示
  }
}

// 在地图上显示POI标记
const showPoiOnMap = (pois, centerLat, centerLng, radius) => {
  console.log('[showPoiOnMap] 调用参数:', { pois: pois?.length, centerLat, centerLng, radius })
  
  // 清除之前的POI标记
  poiMarkers.value.forEach(m => map.removeLayer(m))
  poiMarkers.value = []
  
  // 清除之前的中心点标记和半径圆
  if (poiCenterMarker) {
    map.removeLayer(poiCenterMarker)
    poiCenterMarker = null
  }
  if (poiRadiusCircle) {
    map.removeLayer(poiRadiusCircle)
    poiRadiusCircle = null
  }
  
  if (!pois || pois.length === 0) {
    console.log('[showPoiOnMap] 没有POI数据')
    return
  }
  
  const bounds = []
  
  // 如果提供了中心点，绘制中心点标记和半径圆
  console.log('[showPoiOnMap v3] 检查中心点条件:', { centerLat, centerLng, condition: !!(centerLat && centerLng) })
  if (centerLat && centerLng) {
    poiCenterPoint = { lat: centerLat, lng: centerLng }
    poiSearchRadius = radius || 2000
    console.log('[showPoiOnMap v3] 绘制紫色虚线大圆，半径:', poiSearchRadius, '米')
    
    // 绘制搜索半径圆（紫色虚线大圆）
    poiRadiusCircle = L.circle([centerLat, centerLng], {
      radius: poiSearchRadius,
      color: '#6366f1',
      fillColor: '#6366f1',
      fillOpacity: 0.1,
      weight: 2,
      dashArray: '5, 5'
    }).addTo(map)
    
    // 绘制中心点标记（红色图钉）
    poiCenterMarker = L.marker([centerLat, centerLng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="position:relative;width:32px;height:40px;">
          <svg width="32" height="40" viewBox="0 0 32 40" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
            <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 24 16 24s16-12 16-24C32 7.163 24.837 0 16 0z" fill="#ef4444" stroke="#fff" stroke-width="2"/>
            <circle cx="16" cy="16" r="6" fill="#fff"/>
          </svg>
        </div>`,
        iconSize: [32, 40],
        iconAnchor: [16, 40]
      })
    }).addTo(map)
    
    bounds.push([centerLat, centerLng])
  }
  
  pois.forEach((poi, index) => {
    if (!poi.location) return
    const [lng, lat] = poi.location.split(',').map(Number)
    if (isNaN(lat) || isNaN(lng)) return
    
    bounds.push([lat, lng])
    
    const icon = L.divIcon({
      html: `<div style="background:#6366f1;color:#fff;padding:4px 8px;border-radius:12px;font-size:11px;font-weight:500;box-shadow:0 2px 8px rgba(0,0,0,0.2);white-space:nowrap;">${index + 1}</div>`,
      className: 'poi-marker',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    })
    
    const marker = L.marker([lat, lng], { icon }).addTo(map)
    marker.bindPopup(`
      <div style="min-width:180px;">
        <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${poi.name}</div>
        <div style="color:#666;font-size:12px;margin-bottom:2px;">${poi.address || ''}</div>
        <div style="color:#999;font-size:11px;">${poi.city}${poi.district}</div>
        ${poi.distance ? `<div style="color:#f56c6c;font-size:11px;margin-top:4px;">距中心: ${poi.distance}米</div>` : ''}
        ${poi.tel ? `<div style="color:#409eff;font-size:11px;margin-top:2px;">电话：${poi.tel}</div>` : ''}
      </div>
    `)
    
    poiMarkers.value.push(marker)
  })
  
  // 调整视野（包含中心点和所有POI，同时确保显示完整的圆）
  if (bounds.length > 0) {
    let targetBounds
    
    // 如果有圆心，创建包含圆范围的边界框
    if (centerLat && centerLng && radius) {
      const circleBounds = L.circle([centerLat, centerLng], { radius }).getBounds()
      if (bounds.length === 1) {
        // 只有圆心一个点，直接使用圆的范围
        map.fitBounds(circleBounds, { padding: [50, 50] })
        return
      } else {
        // 合并 POI 边界和圆的边界
        const poiBounds = L.latLngBounds(bounds)
        targetBounds = circleBounds.extend(poiBounds)
      }
    } else {
      targetBounds = L.latLngBounds(bounds)
    }
    
    if (bounds.length === 1 && !radius) {
      map.setView(bounds[0], 15)
    } else {
      map.fitBounds(targetBounds, { padding: [50, 50] })
    }
  }
}

// 开始半径圆搜索
const startCircleSearch = () => {
  if (circleSearchActive) {
    ElMessage.warning('搜索正在进行中，请稍候')
    return
  }
  if (!poiKeywords.value.trim()) {
    ElMessage.warning('请输入搜索关键词')
    return
  }
  circleSearchActive = true
  
  // 关闭面板
  poiSearchExpanded.value = false
  
  // 提示用户点击地图
  ElMessage.info('请在地图上点击选择圆心位置')
  
  // 清除之前的临时标记
  if (tempCircleMarker) {
    map.removeLayer(tempCircleMarker)
    tempCircleMarker = null
  }
  
  // =============================================
  // 半径圆搜索功能 - 2026-04-04 FIX v3
  // =============================================
  // 监听地图点击
  map.once('click', async (e) => {
    const { lat, lng } = e.latlng
    console.log('[Circle Search v3] 点击地图, 坐标:', lat, lng)
    
    // 临时标记圆心
    tempCircleMarker = L.circle([lat, lng], {
      radius: 50,
      color: '#f59e0b',
      fillColor: '#fbbf24',
      fillOpacity: 0.3,
      weight: 2
    }).addTo(map)
    
    // 弹出半径输入框
    let radiusKm = null
    try {
      const { value } = await ElMessageBox.prompt('请输入搜索半径（公里）', '设置半径', {
        confirmButtonText: '搜索',
        cancelButtonText: '取消',
        inputValue: '2',
        inputPattern: /^\d+(\.\d+)?$/,
        inputErrorMessage: '请输入有效的数字'
      })
      console.log('[Circle Search] ElMessageBox 确认, value:', value)
      radiusKm = parseFloat(value) || 2
    } catch (err) {
      console.log('[Circle Search] ElMessageBox 取消或错误:', err)
      radiusKm = null
    }
    
    // 清除临时标记
    if (tempCircleMarker) {
      map.removeLayer(tempCircleMarker)
      tempCircleMarker = null
    }
    
    if (radiusKm === null) {
      circleSearchActive = false
      return
    }
    
    const radiusM = Math.round(radiusKm * 1000)
    console.log('[Circle Search v2] 用户输入半径:', radiusKm, '公里 =', radiusM, '米')
    
    // 清除临时圆
    if (tempCircleMarker) {
      map.removeLayer(tempCircleMarker)
      tempCircleMarker = null
    }
    
    // 立即绘制正确的搜索范围圆（紫色虚线），使用全局变量
    if (poiRadiusCircle) {
      map.removeLayer(poiRadiusCircle)
    }
    poiRadiusCircle = L.circle([lat, lng], {
      radius: radiusM,
      color: '#6366f1',
      fillColor: '#6366f1',
      fillOpacity: 0.1,
      weight: 2,
      dashArray: '5, 5'
    }).addTo(map)
    console.log('[Circle Search] 已绘制搜索圆，半径:', radiusM, '米')
    
    // 执行周边搜索
    try {
      console.log('[Circle Search] 开始请求 API, 关键词:', poiKeywords.value.trim())
      const loadingMsg = ElMessage({ type: 'loading', message: '搜索中...', duration: 0 })
      const response = await fetch('/api/poi/around', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lng,
          lat,
          radius: radiusM,
          keywords: poiKeywords.value.trim()
        })
      })
      const result = await response.json()
      loadingMsg.close()
      
      if (result.error) {
        ElMessage.error(result.error)
        circleSearchActive = false
        return
      }
      
      poiResults.value = result.pois || []
      poiResultVisible.value = true
      // 显示结果，包含中心点和半径
      showPoiOnMap(result.pois, lat, lng, radiusM)
      ElMessage.success(`找到 ${result.count} 个结果`)
      circleSearchActive = false
    } catch (err) {
      loadingMsg.close()
      console.error('[Circle Search]', err)
      ElMessage.error('搜索失败')
      circleSearchActive = false
    }
  })
}

// 开始多边形搜索
const startPolygonSearch = () => {
  if (!poiKeywords.value.trim()) {
    ElMessage.warning('请输入搜索关键词')
    return
  }
  
  // 关闭面板
  poiSearchExpanded.value = false
  
  // 清除之前的临时元素
  if (tempPolygonLayer) {
    map.removeLayer(tempPolygonLayer)
    tempPolygonLayer = null
  }
  if (tempPolygonMarker) {
    map.removeLayer(tempPolygonMarker)
    tempPolygonMarker = null
  }
  tempPolygonPoints = []
  
  // 提示用户
  ElMessage.info('请在地图上点击绘制多边形（至少3个点），完成后点击确定')
  
  // 创建临时多边形层
  tempPolygonLayer = L.polygon([], {
    color: '#10b981',
    fillColor: '#34d399',
    fillOpacity: 0.2,
    weight: 2,
    dashArray: '5, 5'
  }).addTo(map)
  
  // 临时标记点
  updateMarkers = () => {
    if (tempPolygonMarker) {
      map.removeLayer(tempPolygonMarker)
    }
    if (tempPolygonPoints.length > 0) {
      const markers = tempPolygonPoints.map((p, i) => 
        L.circleMarker(p, { radius: 6, color: '#10b981', fillColor: '#fff', fillOpacity: 1 })
          .bindPopup(`点${i + 1}`)
          .addTo(map)
      )
      tempPolygonMarker = L.layerGroup(markers)
    }
  }
  
  // 监听地图点击
  map.on('click', addPolygonPoint)
  
  // 显示完成按钮
  showPolygonCompleteButton()
}

let completeBtn = null
let completeBtnElement = null
const showPolygonCompleteButton = () => {
  console.log('[Polygon Search] 显示完成按钮')
  // 先移除旧的按钮
  if (completeBtn) {
    map.removeControl(completeBtn)
    completeBtn = null
  }
  if (completeBtnElement && completeBtnElement.parentNode) {
    completeBtnElement.parentNode.removeChild(completeBtnElement)
    completeBtnElement = null
  }
  
  // 创建按钮
  completeBtnElement = document.createElement('button')
  completeBtnElement.id = 'polygon-complete-btn'
  completeBtnElement.textContent = '完成绘制'
  completeBtnElement.style.cssText = `
    position: fixed !important;
    background: #10b981 !important;
    color: white !important;
    border: none !important;
    padding: 12px 24px !important;
    border-radius: 6px !important;
    cursor: pointer !important;
    font-size: 15px !important;
    font-weight: bold !important;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.5) !important;
    z-index: 999999 !important;
  `
  
  // 使用 addEventListener 确保点击有效
  completeBtnElement.addEventListener('click', (e) => {
    console.log('[Polygon Search] 按钮被点击')
    e.stopPropagation()
    e.preventDefault()
    finishPolygonSearch()
  })
  
  document.body.appendChild(completeBtnElement)
  
  // 计算多边形中心，动态定位按钮
  if (tempPolygonPoints.length >= 2) {
    // 计算多边形边界
    const bounds = L.latLngBounds(tempPolygonPoints)
    const center = bounds.getCenter()
    // 将地图中心坐标转换为屏幕像素位置
    const point = map.latLngToContainerPoint(center)
    // 按钮放在中心点偏上，避免遮挡多边形
    completeBtnElement.style.top = `${Math.max(80, point.y - 100)}px`
    completeBtnElement.style.left = `${Math.min(point.x - 50, window.innerWidth - 150)}px`
    completeBtnElement.style.right = 'auto'
  } else {
    // 默认位置
    completeBtnElement.style.top = '80px'
    completeBtnElement.style.right = '20px'
    completeBtnElement.style.left = 'auto'
  }
  
  console.log('[Polygon Search] 按钮已添加到body')
}

const finishPolygonSearch = async () => {
  // 移除点击监听
  map.off('click', addPolygonPoint)
  
  // 移除完成按钮
  if (completeBtn) {
    map.removeControl(completeBtn)
    completeBtn = null
  }
  if (completeBtnElement) {
    document.body.removeChild(completeBtnElement)
    completeBtnElement = null
  }
  
  if (tempPolygonPoints.length < 3) {
    ElMessage.warning('多边形至少需要3个点')
    // 清除临时元素
    if (tempPolygonLayer) { map.removeLayer(tempPolygonLayer); tempPolygonLayer = null }
    if (tempPolygonMarker) { map.removeLayer(tempPolygonMarker); tempPolygonMarker = null }
    tempPolygonPoints = []
    return
  }
  
  // 清除临时标记
  if (tempPolygonMarker) {
    map.removeLayer(tempPolygonMarker)
    tempPolygonMarker = null
  }
  
  // 构建多边形坐标数组（后端期望 [{lng, lat}, ...] 格式）
  const polygonCoords = tempPolygonPoints.map(p => ({ lng: p.lng, lat: p.lat }))
  
  // 执行多边形搜索
  let loadingMsg = null
  try {
    loadingMsg = ElMessage({ type: 'loading', message: '搜索中...', duration: 0 })
    const response = await fetch('/api/poi/polygon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: polygonCoords,
        keywords: poiKeywords.value.trim()
      })
    })
    const result = await response.json()
    loadingMsg.close()
    
    if (result.error) {
      ElMessage.error(result.error)
      return
    }
    
    poiResults.value = result.pois || []
    poiResultVisible.value = true
    // 多边形搜索不在地图上显示中心点和半径圆
    showPoiOnMap(result.pois, null, null, null)
    ElMessage.success(`找到 ${result.count} 个结果`)
  } catch (err) {
    if (loadingMsg) loadingMsg.close()
    console.error('[Polygon Search]', err)
    ElMessage.error('搜索失败')
  }
}

// 关闭POI结果面板
const closePoiResults = () => {
  poiResultVisible.value = false
  // 清除地图上的POI标记
  poiMarkers.value.forEach(m => map.removeLayer(m))
  poiMarkers.value = []
  // 清除中心点标记和半径圆
  if (poiCenterMarker) {
    map.removeLayer(poiCenterMarker)
    poiCenterMarker = null
  }
  if (poiRadiusCircle) {
    map.removeLayer(poiRadiusCircle)
    poiRadiusCircle = null
  }
  poiCenterPoint = null
  poiResults.value = []
}

// POI位置选择模式：在地图上选点后执行搜索
const executePoiSearchAtLocation = async (lat, lng) => {
  const pending = poiPendingSearch.value
  if (!pending) return
  
  try {
    const response = await fetch('/api/poi/around', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lng,
        lat,
        radius: pending.radius || 2000,
        keywords: pending.keywords
      })
    })
    const result = await response.json()
    
    if (result.error) {
      ElMessage.error(result.error)
      return
    }
    
    poiResults.value = result.pois || []
    poiResultVisible.value = true
    showPoiOnMap(result.pois, lat, lng, pending.radius || 2000)
    ElMessage.success(`在指定位置周边找到 ${result.count} 个POI`)
  } catch (err) {
    console.error('[POI Search]', err)
    ElMessage.error('POI搜索失败')
  } finally {
    poiPendingSearch.value = null
    poiPickLocationMode.value = false
  }
}

// 取消POI位置选择模式
const cancelPoiPickLocation = () => {
  poiPickLocationMode.value = false
  poiPendingSearch.value = null
  if (map) map.getContainer().style.cursor = ''
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
// 强制引用POI搜索函数，确保打包时不被移除
window.__poiSearchDebug = { startCircleSearch, startPolygonSearch, poiSearchExpanded, poiKeywords }

// 导出POI搜索函数供模板使用
const _poiFunctions = { startCircleSearch, startPolygonSearch }

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
  right: 15px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  overflow: hidden;
  border: 2px solid #409eff;

  .toolbar-header {
    padding: 10px 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);

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

// 周边检索面板样式
.poi-search-panel {
  position: absolute;
  top: 10px;
  right: 287px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  min-width: 110px;
  max-width: 110px;
  overflow: hidden;
  border: 2px solid #409eff;

  .poi-search-header {
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
    background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);

    .poi-search-title {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
    }

    .poi-search-arrow {
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

  .poi-search-body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 100%;
    box-sizing: border-box;

    .poi-search-input {
      width: 100%;
      max-width: 100px;
      box-sizing: border-box;

      .el-input__inner {
        border-color: #409eff;
        width: 100%;
      }
    }

    .poi-search-modes {
      display: flex;
      flex-direction: column;
      gap: 6px;

      .poi-mode-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 7px 10px;
        border: 1px solid #dcdfe6;
        border-radius: 4px;
        background: #fff;
        color: #606266;
        font-size: 12px;
        cursor: pointer;
        box-sizing: border-box;
        user-select: none;

        &:hover {
          background: #ecf5ff;
          border-color: #409eff;
          color: #409eff;
        }

        .el-icon {
          font-size: 14px;
          flex-shrink: 0;
        }

        span {
          line-height: 1;
        }
      }
    }
  }
}

// 商圈工具面板样式
.business-circle-panel {
  position: absolute;
  top: 10px;
  right: 420px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  min-width: 110px;
  overflow: hidden;
  border: 2px solid #ff8800;

  .business-circle-header {
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
    background: linear-gradient(135deg, #ff8800 0%, #cc6600 100%);

    .business-circle-title {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
    }

    .business-circle-arrow {
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

  .business-circle-body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;

    .business-circle-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 7px 10px;
      border: 1px solid #dcdfe6;
      border-radius: 4px;
      background: #fff;
      color: #606266;
      font-size: 12px;
      cursor: pointer;
      box-sizing: border-box;
      user-select: none;

      &:hover {
        background: #fff4e6;
        border-color: #ff8800;
        color: #ff8800;
      }

      .el-icon {
        font-size: 14px;
        flex-shrink: 0;
      }

      span {
        line-height: 1;
      }
    }
  }
}

// 显示门店开关 - 样式参考地图工具箱
.store-toggle-panel {
  position: absolute;
  top: 10px;
  right: 152px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  min-width: 100px;
  overflow: hidden;
  border: 2px solid #409eff;
}

.store-toggle-header {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);

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
  padding: 6px 12px;
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
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  overflow: hidden;
  border: 2px solid #409eff;

  .search-body {
    padding: 8px 12px;

    ::deep(.el-input__wrapper) {
      border-radius: 6px;
      box-shadow: none;
      border: 1px solid #dcdfe6;
      transition: all 0.2s;

      &:hover {
        border-color: #409eff;
      }

      &.is-focus {
        border-color: #409eff;
        box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2);
      }
    }

    ::deep(.el-input__inner) {
      font-size: 13px;

      &::placeholder {
        color: #999;
      }
    }

    ::deep(.el-input__prefix) {
      color: #409eff;
    }

    ::deep(.el-input__clear) {
      color: #999;

      &:hover {
        color: #409eff;
      }
    }
  }

  .search-results {
    max-height: 300px;
    overflow-y: auto;
    border-top: 1px solid #eee;

    .search-result-item {
      padding: 10px 12px;
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
        color: #409eff;
        font-size: 14px;
      }

      .result-info {
        flex: 1;
        min-width: 0;

        .result-name {
          font-size: 13px;
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

// 地图瓦片灰度效果（只针对高德地图，保留marker图标）
:deep(.gaode-gray-tiles) {
  img {
    filter: grayscale(100%) brightness(1.05);
  }
}
</style>

// POI位置选择提示
.poi-pick-location-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1002;
  pointer-events: none;
}

.poi-pick-location-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(64, 158, 255, 0.95);
  color: white;
  border-radius: 8px;
  font-size: 14px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  pointer-events: auto;

  .el-icon {
    font-size: 18px;
    animation: poi-pulse 1.5s ease-in-out infinite;
  }

  span {
    flex: 1;
  }

  .el-button {
    color: white;
    padding: 2px 8px;

    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  }
}

@keyframes poi-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.1); }
}

