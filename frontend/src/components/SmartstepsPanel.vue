<template>
  <div v-if="visible" class="smartsteps-panel" :style="panelStyle" ref="panelRef">
    <div class="panel-header" style="cursor: grab;" @mousedown="startDrag">
      <span class="panel-title">📊 联通人口数据</span>
      <button class="close-btn" @click="close">×</button>
    </div>
    
    <div class="panel-content">
      <!-- 步骤1: 选择分析区域 -->
      <div class="step-section">
        <div class="step-title">① 选择分析区域</div>
        <div class="step-hint">点击地图选择位置作为圆心</div>
        <div class="center-info" v-if="circleCenter">
          <span>📍 圆心: {{ circleCenter.lat.toFixed(6) }}, {{ circleCenter.lng.toFixed(6) }}</span>
        </div>
        <el-button type="primary" @click="startSelectLocation" :loading="isSelecting">
          {{ isSelecting ? '选择中...' : '📍 选择位置' }}
        </el-button>
      </div>

      <!-- 步骤2: 设置查询参数 -->
      <div class="step-section">
        <div class="step-title">② 设置查询参数</div>
        <el-form :model="queryForm" label-width="80px" size="small">
          <el-form-item label="门店名称">
            <el-input
              v-model="queryForm.storeName"
              placeholder="请输入门店名称"
              clearable
            />
          </el-form-item>
          <el-form-item label="门店类型">
            <el-select v-model="queryForm.storeType" placeholder="选择门店类型" style="width: 100%;">
              <el-option label="已开业" value="已开业" />
              <el-option label="重点候选" value="重点候选" />
              <el-option label="一般候选" value="一般候选" />
            </el-select>
          </el-form-item>
          <el-form-item label="半径1">
            <el-input-number
              v-model="queryForm.radius1"
              :min="0.1"
              :max="10"
              :step="0.1"
              :precision="1"
              style="width: 100%;"
            />
            <span class="radius-unit">公里</span>
          </el-form-item>
          <el-form-item label="半径2">
            <el-input-number
              v-model="queryForm.radius2"
              :min="0"
              :max="10"
              :step="0.1"
              :precision="1"
              style="width: 100%;"
            />
            <span class="radius-unit">公里</span>
          </el-form-item>
          <el-form-item label="半径3">
            <el-input-number
              v-model="queryForm.radius3"
              :min="0"
              :max="10"
              :step="0.1"
              :precision="1"
              style="width: 100%;"
            />
            <span class="radius-unit">公里</span>
          </el-form-item>
          <el-form-item label="数据年月">
            <el-select v-model="queryForm.cityMonth" placeholder="选择月份" style="width: 100%;">
              <el-option
                v-for="month in availableMonths"
                :key="month.value"
                :label="month.label"
                :value="month.value"
              />
            </el-select>
          </el-form-item>
        </el-form>
        <div class="query-info">
          <span>单位: 公里 | 费用: 60元/次</span>
        </div>
      </div>

      <!-- 剩余次数 -->
      <div class="step-section">
        <div class="step-title">③ 剩余次数</div>
        <div class="quota-display" v-if="quotaInfo">
          <span class="quota-number">{{ quotaInfo.available }}</span>
          <span class="quota-label">次</span>
        </div>
        <div class="quota-display" v-else>
          <span class="quota-number">-</span>
          <span class="quota-label">次</span>
        </div>
      </div>

      <!-- 购买按钮 -->
      <div class="action-section">
        <el-button 
          type="primary" 
          class="purchase-btn"
          @click="confirmPurchase"
          :disabled="!canPurchase || isLoading"
        >
          {{ isLoading ? '🔄 处理中...' : '💳 购买' }}
        </el-button>
      </div>

      <!-- 结果展示 -->
      <div v-if="queryResult" class="result-section">
        <div class="result-header">
          <span class="result-title">📊 查询结果</span>
          <button class="clear-result" @click="queryResult = null">清除</button>
        </div>
        <div class="result-data" v-html="formatResult(queryResult)"></div>
      </div>
    </div>

    <!-- 购买确认对话框 -->
    <el-dialog
      v-model="showConfirmDialog"
      title="确认购买"
      width="400px"
    >
      <div class="confirm-content">
        <p>您即将购买联通人口数据查询服务：</p>
        <ul>
          <li><strong>门店名称:</strong> {{ queryForm.storeName || '-' }}</li>
          <li><strong>门店类型:</strong> {{ queryForm.storeType || '-' }}</li>
          <li><strong>圆心位置:</strong> {{ circleCenter?.lat.toFixed(6) }}, {{ circleCenter?.lng.toFixed(6) }}</li>
          <li><strong>查询半径:</strong> {{ getRadiiDisplay() }}</li>
          <li><strong>数据年月:</strong> {{ selectedMonthLabel }}</li>
          <li><strong>服务费用:</strong> ¥60.00</li>
        </ul>
      </div>
      <template #footer>
        <el-button @click="showConfirmDialog = false">取消</el-button>
        <el-button type="primary" @click="executePurchase" :loading="isLoading">
          确认购买并查询
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useUserStore } from '@/stores/user'

const props = defineProps({
  visible: Boolean,
  map: Object
})

const emit = defineEmits(['update:visible', 'start-select'])

const userStore = useUserStore()

// 状态
const circleCenter = ref(null)
const isSelecting = ref(false)
const quotaInfo = ref(null)
const isLoading = ref(false)
const queryResult = ref(null)
const showConfirmDialog = ref(false)

// 查询表单（3个半径，单位：公里）
const queryForm = ref({
  storeName: '',
  storeType: '',
  radius1: 1,
  radius2: 0,
  radius3: 0,
  cityMonth: ''
})

// 可选月份（最近两个月）
const availableMonths = ref([])

// 拖动相关
const panelRef = ref(null)
const isDragging = ref(false)
const translateX = ref(0)
const translateY = ref(0)

// 面板样式
const panelStyle = computed(() => ({
  position: 'absolute',
  right: '570px',
  top: '10px',
  width: '340px',
  maxHeight: '80vh',
  transform: `translate(${translateX.value}px, ${translateY.value}px)`,
  zIndex: isDragging.value ? 2000 : 1001
}))

// 获取有效的半径列表（转换为米）
function getRadiiInMeters() {
  const radii = []
  if (queryForm.value.radius1 > 0) {
    radii.push(Math.round(queryForm.value.radius1 * 1000))
  }
  if (queryForm.value.radius2 > 0) {
    radii.push(Math.round(queryForm.value.radius2 * 1000))
  }
  if (queryForm.value.radius3 > 0) {
    radii.push(Math.round(queryForm.value.radius3 * 1000))
  }
  return radii
}

// 获取半径显示文本
function getRadiiDisplay() {
  const radii = []
  if (queryForm.value.radius1 > 0) {
    radii.push(`${queryForm.value.radius1}公里`)
  }
  if (queryForm.value.radius2 > 0) {
    radii.push(`${queryForm.value.radius2}公里`)
  }
  if (queryForm.value.radius3 > 0) {
    radii.push(`${queryForm.value.radius3}公里`)
  }
  return radii.length > 0 ? radii.join(', ') : '无'
}

// 选中的月份标签
const selectedMonthLabel = computed(() => {
  const month = availableMonths.value.find(m => m.value === queryForm.value.cityMonth)
  return month ? month.label : ''
})

// 是否可以购买
const canPurchase = computed(() => {
  const hasRadius = queryForm.value.radius1 > 0 || queryForm.value.radius2 > 0 || queryForm.value.radius3 > 0
  // 需要：圆心位置 + 至少一个半径 + 已选月份 + 配额充足
  return circleCenter.value && hasRadius && queryForm.value.cityMonth && quotaInfo.value?.available > 0
})

// 开始拖动
function startDrag(e) {
  if (e.target.classList.contains('close-btn') || e.target.tagName === 'BUTTON') {
    return
  }
  
  e.preventDefault()
  isDragging.value = true
  
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

// 拖动中
function onDrag(e) {
  if (!isDragging.value) return
  
  // 累加移动量到 translate
  translateX.value += e.movementX
  translateY.value += e.movementY
}

// 停止拖动
function stopDrag() {
  isDragging.value = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

// 加载可选月份
async function loadAvailableMonths() {
  const now = new Date()
  const months = []
  
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1  // 当前是4月
  
  // 当前可用数据是3月和2月
  if (currentMonth >= 4) {
    // 4月时，可提供3月和2月数据
    months.push({
      value: `${currentYear}03`,
      label: `${currentYear}年3月`
    })
    months.push({
      value: `${currentYear}02`,
      label: `${currentYear}年2月`
    })
  } else if (currentMonth >= 3) {
    // 3月时，可提供2月和1月数据
    months.push({
      value: `${currentYear}02`,
      label: `${currentYear}年2月`
    })
    months.push({
      value: `${currentYear}01`,
      label: `${currentYear}年1月`
    })
  } else {
    // 更早的月份
    months.push({
      value: `${currentYear}01`,
      label: `${currentYear}年1月`
    })
  }

  availableMonths.value = months
  if (months.length > 0) {
    queryForm.value.cityMonth = months[0].value
  }
}

// 获取配额信息
async function loadQuota() {
  try {
    const res = await axios.get('/api/purchase/quota')
    quotaInfo.value = res.data
    // 同步到全局 store
    userStore.updateQuota(res.data)
  } catch (e) {
    console.error('加载配额失败:', e)
    quotaInfo.value = { total: 0, used: 0, available: 0 }
  }
}

// 开始选择位置
function startSelectLocation() {
  if (!props.map) return
  
  isSelecting.value = true
  props.map.getContainer().style.cursor = 'crosshair'
  
  ElMessage.info('请在地图上点击选择圆心位置')
  
  const clickHandler = (e) => {
    circleCenter.value = {
      lng: e.latlng.lng,
      lat: e.latlng.lat
    }
    
    // 显示图钉标记
    showMarker(e.latlng)
    
    // 停止选择
    stopSelectLocation()
    
    ElMessage.success(`已选择位置：${e.latlng.lng.toFixed(6)}, ${e.latlng.lat.toFixed(6)}`)
  }
  
  props.map.once('click', clickHandler)
}

function stopSelectLocation() {
  isSelecting.value = false
  if (props.map) {
    props.map.getContainer().style.cursor = ''
  }
}

// 显示图钉标记
let tempMarker = null
function showMarker(latlng) {
  if (!props.map) return
  
  // 清除之前的标记
  if (tempMarker) {
    props.map.removeLayer(tempMarker)
  }
  
  const pinIcon = L.divIcon({
    html: `<div style="
      width: 20px;
      height: 28px;
      position: relative;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
    ">
      <svg viewBox="0 0 24 40" width="20" height="28" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 28 12 28s12-19 12-28c0-6.6-5.4-12-12-12z" fill="#764ba2"/>
        <circle cx="12" cy="12" r="4" fill="white"/>
      </svg>
    </div>`,
    className: '',
    iconSize: [20, 28],
    iconAnchor: [10, 28],
    popupAnchor: [0, -28]
  })
  
  tempMarker = L.marker([latlng.lat, latlng.lng], {
    icon: pinIcon,
    zIndexOffset: 1000
  }).addTo(props.map)
}

// 确认购买
function confirmPurchase() {
  if (!canPurchase.value) {
    ElMessage.warning('请先选择圆心位置和至少一个半径')
    return
  }
  showConfirmDialog.value = true
}

// 执行购买并查询
async function executePurchase() {
  if (!circleCenter.value) return
  
  showConfirmDialog.value = false
  isLoading.value = true
  queryResult.value = null
  
  try {
    // 检查配额
    if (!quotaInfo.value || quotaInfo.value.available < 1) {
      ElMessage.error('配额不足，请联系管理员分配配额')
      return
    }
    
    // 获取半径列表（米）
    const radii = getRadiiInMeters()
    
    // 调用查询API
    const res = await axios.post('/api/smartsteps/query', {
      centerLng: circleCenter.value.lng,
      centerLat: circleCenter.value.lat,
      radius: radii[0], // 使用第一个半径作为主要半径
      radii: radii,     // 传递所有半径
      services: ['1001'],  // 默认全量人口
      cityMonth: queryForm.value.cityMonth,
      quotaUsed: 1,        // 消耗1次配额
      storeName: queryForm.value.storeName,
      storeType: queryForm.value.storeType
    })
    
    queryResult.value = res.data
    ElMessage.success('查询成功!')
    
    // 刷新配额
    loadQuota()
  } catch (e) {
    console.error('查询失败:', e)
    ElMessage.error(e.response?.data?.message || '查询失败')
  } finally {
    isLoading.value = false
  }
}

// 格式化结果
function formatResult(data) {
  if (!data || !data.data) return '<p>暂无数据</p>'
  
  const result = data.data
  let html = '<div class="result-grid">'
  
  // 解析返回的数据结构
  if (typeof result === 'object') {
    for (const [key, value] of Object.entries(result)) {
      const label = getServiceName(key)
      const val = formatValue(value)
      html += `<div class="result-item">
        <span class="result-label">${label}</span>
        <span class="result-value">${val}</span>
      </div>`
    }
  }
  
  html += '</div>'
  return html || '<p>暂无数据</p>'
}

function getServiceName(code) {
  const names = {
    '1001': '全量人口',
    '1002': '居住人口',
    '1003': '工作人口',
    '1004': '到访人口'
  }
  return names[code] || code
}

function formatValue(value) {
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return value ? String(value) : '-'
}

// 关闭
function close() {
  stopSelectLocation()
  if (tempMarker && props.map) {
    props.map.removeLayer(tempMarker)
    tempMarker = null
  }
  emit('update:visible', false)
}

// 监听visible变化
watch(() => props.visible, (newVal) => {
  if (!newVal) {
    stopSelectLocation()
  } else {
    // 每次打开时刷新配额
    loadQuota()
  }
})

// 生命周期
onMounted(() => {
  loadAvailableMonths()
  loadQuota()
})

onUnmounted(() => {
  stopSelectLocation()
  if (tempMarker && props.map) {
    props.map.removeLayer(tempMarker)
  }
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
})
</script>

<style scoped>
.smartsteps-panel {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  z-index: 1001;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 15px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.panel-title {
  font-weight: bold;
  font-size: 14px;
}

.close-btn {
  background: none;
  border: none;
  color: white;
  font-size: 20px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.panel-content {
  padding: 15px;
  max-height: calc(80vh - 50px);
  overflow-y: auto;
}

.step-section {
  margin-bottom: 15px;
  padding-bottom: 15px;
  border-bottom: 1px solid #eee;
}

.step-title {
  font-weight: bold;
  color: #333;
  margin-bottom: 8px;
}

.step-hint {
  font-size: 12px;
  color: #999;
  margin-bottom: 8px;
}

.center-info {
  font-size: 12px;
  color: #666;
  margin-bottom: 8px;
  padding: 6px 10px;
  background: #f5f5f5;
  border-radius: 4px;
}

.radius-unit {
  margin-left: 8px;
  color: #999;
  font-size: 12px;
}

.query-info {
  font-size: 12px;
  color: #666;
  margin-top: 8px;
}

/* 剩余次数显示 */
.quota-display {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 10px 0;
}

.quota-number {
  font-size: 32px;
  font-weight: bold;
  color: #764ba2;
}

.quota-label {
  font-size: 14px;
  color: #666;
}

.action-section {
  margin-top: 15px;
}

.purchase-btn {
  width: 100%;
  height: 40px;
  font-size: 15px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
}

.purchase-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #5a6fd6 0%, #6a4190 100%);
}

.purchase-btn:disabled {
  background: #dcdfe6 !important;
  border-color: #dcdfe6 !important;
  color: #999 !important;
  cursor: not-allowed;
  opacity: 1 !important;
}

.result-section {
  margin-top: 15px;
  padding: 10px;
  background: #f9f9f9;
  border-radius: 4px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.result-title {
  font-weight: bold;
}

.clear-result {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 12px;
}

.result-data {
  font-size: 13px;
}

.result-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-item {
  display: flex;
  justify-content: space-between;
  padding: 8px;
  background: white;
  border-radius: 4px;
  border: 1px solid #eee;
}

.result-label {
  color: #666;
}

.result-value {
  font-weight: bold;
  color: #333;
}

/* 确认对话框 */
.confirm-content {
  padding: 10px 0;
}

.confirm-content p {
  margin-bottom: 10px;
  color: #666;
}

.confirm-content ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.confirm-content li {
  padding: 8px 0;
  border-bottom: 1px solid #eee;
}

.confirm-content li:last-child {
  border-bottom: none;
}
</style>
