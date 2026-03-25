<template>
  <div class="map-view">
    <!-- 工具栏 -->
    <div class="toolbar">
      <!-- 基础工具 -->
      <div class="tool-group">
        <el-tooltip content="测量距离" placement="bottom">
          <el-button :type="activeTool === 'measure' ? 'primary' : ''" @click="setTool('measure')">
            <el-icon><Odometer /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="测量面积" placement="bottom">
          <el-button :type="activeTool === 'area' ? 'primary' : ''" @click="setTool('area')">
            <el-icon><Aim /></el-icon>
          </el-button>
        </el-tooltip>
      </div>

      <el-divider direction="vertical" />

      <!-- 绘制工具 -->
      <div class="tool-group">
        <el-tooltip content="标注点" placement="bottom">
          <el-button :type="activeTool === 'marker' ? 'primary' : ''" @click="setTool('marker')">
            <el-icon><Location /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="绘制折线" placement="bottom">
          <el-button :type="activeTool === 'polyline' ? 'primary' : ''" @click="setTool('polyline')">
            <el-icon><Connection /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="绘制多边形" placement="bottom">
          <el-button :type="activeTool === 'polygon' ? 'primary' : ''" @click="setTool('polygon')">
            <el-icon><Coordinate /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="绘制矩形" placement="bottom">
          <el-button :type="activeTool === 'rectangle' ? 'primary' : ''" @click="setTool('rectangle')">
            <el-icon><Crop /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="绘制圆形" placement="bottom">
          <el-button :type="activeTool === 'circle' ? 'primary' : ''" @click="setTool('circle')">
            <el-icon><FullScreen /></el-icon>
          </el-button>
        </el-tooltip>
      </div>

      <el-divider direction="vertical" />

      <!-- 可视化工具 -->
      <div class="tool-group">
        <el-tooltip content="热力图" placement="bottom">
          <el-button :type="showHeatmap ? 'primary' : ''" @click="toggleHeatmap">
            <el-icon><DataLine /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="聚合显示" placement="bottom">
          <el-button :type="showCluster ? 'primary' : ''" @click="toggleCluster">
            <el-icon><Grid /></el-icon>
          </el-button>
        </el-tooltip>
      </div>

      <el-divider direction="vertical" />

      <!-- 其他工具 -->
      <div class="tool-group">
        <el-tooltip content="清除绘制" placement="bottom">
          <el-button @click="clearDrawings">
            <el-icon><Delete /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="定位数据" placement="bottom">
          <el-button @click="fitBounds">
            <el-icon><View /></el-icon>
          </el-button>
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

    <!-- 图层控制面板 -->
    <div class="layer-panel">
      <div class="panel-header">
        <span>图层控制</span>
      </div>
      <div class="panel-content">
        <div class="layer-item">
          <span>底图</span>
          <el-select v-model="baseMapType" size="small" style="width: 100px">
            <el-option label="矢量地图" value="vec" />
            <el-option label="影像地图" value="img" />
          </el-select>
        </div>
        <div class="layer-item">
          <el-switch v-model="showBusinessLayer" active-text="业务图层" />
        </div>
        <div class="layer-item">
          <span>透明度</span>
          <el-slider v-model="layerOpacity" :min="0" :max="1" :step="0.1" size="small" style="width: 100px" />
        </div>
      </div>
    </div>

    <!-- 添加/编辑点位对话框 -->
    <el-dialog
      v-model="markerDialogVisible"
      :title="editingMarker ? '编辑点位' : '添加点位'"
      width="500px"
    >
      <el-form ref="markerFormRef" :model="markerForm" :rules="markerRules" label-width="80px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="markerForm.name" placeholder="请输入点位名称" />
        </el-form-item>
        <el-form-item label="类别" prop="category">
          <el-select v-model="markerForm.category" placeholder="请选择类别" style="width: 100%">
            <el-option v-for="cat in markerStore.categories" :key="cat" :label="cat" :value="cat" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="markerForm.status" placeholder="请选择状态" style="width: 100%">
            <el-option v-for="st in markerStore.statuses" :key="st" :label="st" :value="st" />
          </el-select>
        </el-form-item>
        <el-form-item label="坐标">
          <el-input :model-value="`${markerForm.latitude?.toFixed(6)}, ${markerForm.longitude?.toFixed(6)}`" disabled />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="markerForm.description" type="textarea" :rows="3" placeholder="请输入描述信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="markerDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveMarker">确定</el-button>
      </template>
    </el-dialog>

    <!-- 鹰眼图 -->
    <div class="minimap-container">
      <div id="minimap" class="minimap" />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Location, Connection, Coordinate, Crop, FullScreen,
  Delete, View, Grid, DataLine, Odometer, Aim
} from '@element-plus/icons-vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useMarkerStore } from '@/stores/marker'
import {
  createCustomIcon, getCategoryIcon, getStatusColor,
  calculateDistance, formatDistance, calculateArea, formatArea
} from '@/utils/map'

const markerStore = useMarkerStore()

// 地图实例
let map = null
let minimap = null
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

// 点位表单
const markerForm = reactive({
  name: '',
  category: '',
  status: '',
  latitude: 0,
  longitude: 0,
  description: ''
})

const markerRules = {
  name: [{ required: true, message: '请输入点位名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择类别', trigger: 'change' }],
  status: [{ required: true, message: '请选择状态', trigger: 'change' }]
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
  // 主地图
  map = L.map('map', {
    center: [39.9042, 116.4074],
    zoom: 10,
    zoomControl: true
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

  // 初始化鹰眼图
  nextTick(() => {
    initMinimap()
  })

  // 加载点位数据
  loadMarkers()
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

// 初始化鹰眼图
const initMinimap = () => {
  if (!document.getElementById('minimap')) return

  minimap = L.map('minimap', {
    center: map.getCenter(),
    zoom: map.getZoom() - 4,
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false
  })
  L.tileLayer(gaodeTiles.vec.url, {
    subdomains: gaodeTiles.vec.subdomains
  }).addTo(minimap)

  // 同步主地图移动
  map.on('move', () => {
    if (minimap) {
      minimap.setView(map.getCenter(), map.getZoom() - 4)
    }
  })

  // 鹰眼图矩形
  const boundsRect = L.rectangle(map.getBounds(), { color: '#409eff', weight: 2, fillOpacity: 0 })
  minimap.addLayer(boundsRect)

  map.on('moveend', () => {
    if (boundsRect) {
      boundsRect.setBounds(map.getBounds())
    }
  })
}

// 加载点位
const loadMarkers = async () => {
  await markerStore.fetchMarkers()

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

  markerStore.markers.forEach(markerData => {
    const icon = createCustomIcon(
      getStatusColor(markerData.status),
      getCategoryIcon(markerData.category)
    )

    const marker = L.marker([markerData.latitude, markerData.longitude], {
      icon,
      draggable: true
    })

    marker.bindPopup(`
      <div style="min-width: 180px">
        <h4 style="margin: 0 0 8px 0">${markerData.name}</h4>
        <p style="margin: 4px 0"><strong>类别:</strong> ${markerData.category}</p>
        <p style="margin: 4px 0"><strong>状态:</strong> <span style="color: ${getStatusColor(markerData.status)}">${markerData.status}</span></p>
        <p style="margin: 4px 0"><strong>坐标:</strong> ${markerData.latitude.toFixed(6)}, ${markerData.longitude.toFixed(6)}</p>
        ${markerData.description ? `<p style="margin: 4px 0"><strong>描述:</strong> ${markerData.description}</p>` : ''}
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
    const icon = createCustomIcon(
      getStatusColor(markerData.status),
      getCategoryIcon(markerData.category)
    )
    const marker = L.marker([markerData.latitude, markerData.longitude], { icon })
    marker.bindPopup(`<b>${markerData.name}</b><br/>${markerData.category}`)
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
    name: '',
    category: '',
    status: '',
    latitude: 0,
    longitude: 0,
    description: ''
  })
}

// 编辑点位
const editMarker = async (id) => {
  const marker = markerStore.markers.find(m => m.id === id)
  if (!marker) return

  editingMarker.value = id
  Object.assign(markerForm, {
    name: marker.name,
    category: marker.category,
    status: marker.status,
    latitude: marker.latitude,
    longitude: marker.longitude,
    description: marker.description || ''
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
  left: 50%;
  transform: translateX(-50%);
  background: white;
  padding: 8px 16px;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;

  .tool-group {
    display: flex;
    gap: 4px;
  }

  .measurement-result {
    background: #ecf5ff;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 14px;
    color: #409eff;
    font-weight: 500;
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

.layer-panel {
  position: absolute;
  top: 70px;
  right: 10px;
  background: white;
  width: 200px;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  z-index: 1000;

  .panel-header {
    padding: 12px;
    border-bottom: 1px solid #eee;
    font-weight: 500;
  }

  .panel-content {
    padding: 12px;

    .layer-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;

      &:last-child {
        margin-bottom: 0;
      }

      span {
        font-size: 13px;
        color: #666;
      }
    }
  }
}

.minimap-container {
  position: absolute;
  bottom: 10px;
  right: 10px;
  z-index: 1000;

  .minimap {
    width: 180px;
    height: 120px;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  }
}

:deep(.custom-div-icon) {
  background: transparent;
  border: none;
}
</style>
