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
          <span>单位: 公里 ｜ 请在当月10日之后选择上月数据</span>
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
        <!-- 禁用原因提示 -->
        <div class="purchase-hint" v-if="!canPurchase && !isLoading">
          <span v-if="quotaInfo && quotaInfo.available <= 0" style="color: #f56c6c;">⚠️ 配额不足，请联系管理员分配配额</span>
          <span v-else-if="!circleCenter">请先选择位置</span>
          <span v-else-if="!hasRadius">请设置至少一个半径</span>
          <span v-else>请选择数据年月</span>
        </div>
      </div>

      <!-- 结果展示 -->
      <div v-if="queryResult" class="result-section">
        <div class="result-header">
          <span class="result-title">📊 查询结果</span>
          <button class="clear-result" @click="queryResult = null">清除</button>
        </div>
        <div class="result-data" v-html="formatResultData(queryResult.data)"></div>
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
const quotaInfo = ref(null)  // 配额信息
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

// 是否有有效半径
const hasRadius = computed(() => {
  return queryForm.value.radius1 > 0 || queryForm.value.radius2 > 0 || queryForm.value.radius3 > 0
})

// 是否可以购买（只要选择了位置、半径、年月就允许点击，执行时再检查配额）
const canPurchase = computed(() => {
  return circleCenter.value && hasRadius.value && queryForm.value.cityMonth
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
    // 刷新最新配额
    await loadQuota()

    // 检查配额（配额未加载或配额不足）
    if (!quotaInfo.value || quotaInfo.value.available < 1) {
      ElMessage.error('配额不足，请联系管理员分配配额')
      isLoading.value = false
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
      services: ['1001','1002','1003','1004','1005','1006','1007','1008','1009','1010','1011','1012','1013','1014','1015','1017','1018','1019','1020','1021','1022','1023'],  // 全部服务
      cityMonth: queryForm.value.cityMonth,
      quotaUsed: 1,        // 消耗1次配额
      storeName: queryForm.value.storeName,
      storeType: queryForm.value.storeType
    })

    queryResult.value = res.data

    // 检查是否返还配额（空数据情况）
    if (res.data.refunded) {
      ElMessage.warning('该区域暂无数据，配额已返还')
    } else {
      ElMessage.success('查询成功!')
    }

    // 刷新配额
    loadQuota()
  } catch (e) {
    console.error('查询失败:', e)
    ElMessage.error(e.response?.data?.message || '查询失败')
  } finally {
    isLoading.value = false
  }
}

// 格式化结果显示 - 与购买履历保持一致
function formatResultData(data) {
  if (!data) return '<p>暂无数据</p>'
  
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch (e) {
      return '<p>暂无数据</p>'
    }
  }
  
  if (data && data.apiResult) {
    data = data.apiResult
  }
  
  if (!data || typeof data !== 'object') return '<p>暂无数据</p>'
  if (data.error) return `<p style="color:red;">❌ ${data.error}</p>`

  let html = ''
  
  for (const [key, value] of Object.entries(data)) {
    if (key === 'error') continue
    if (excludeServices.includes(key)) continue
    
    const serviceName = getServiceName(key)
    
    // 1001 服务特殊处理
    if (key === '1001' && typeof value === 'object' && !Array.isArray(value)) {
      html += `<div class="detail-result-item">
        ${formatP0SData(value)}
      </div>`
      continue
    }
    
    // 数组格式数据
    if (Array.isArray(value)) {
      html += `<div class="detail-result-item">
        <h4>📊 ${serviceName}</h4>
        ${formatArrayData(value, key)}
      </div>`
      continue
    }
    
    // 其他服务
    if (typeof value === 'object' && !Array.isArray(value)) {
      html += `<div class="detail-result-item">
        <h4>📊 ${serviceName}</h4>
        ${formatOtherData(value, key)}
      </div>`
    } else if (typeof value === 'number') {
      html += `<div class="result-item-simple">
        <span class="result-label">${serviceName}</span>
        <span class="result-value">${value.toLocaleString()}</span>
      </div>`
    }
  }
  
  return html || '<p>暂无数据</p>'
}

// 排除的服务列表（去掉1003手机品牌、1008到访交通方式、1019市外来源）
const excludeServices = ['1016', '1003', '1008', '1019']

// 服务名称映射
function getServiceName(code) {
  const names = {
    '1001': '人口基础属性',
    '1002': '上网标签分布 TOP10',
    '1004': '居住人口画像',
    '1005': '每小时段人口流量',
    '1006': '到访频次分析',
    '1007': '每月到达次数分布',
    '1009': '消费水平（富裕度指数）',
    '1010': '消费业态偏好',
    '1011': '人口婚姻状态',
    '1012': '人口学历分析',
    '1013': '综合消费能力预测',
    '1014': '网购能力预测',
    '1015': '资产预测',
    '1017': '消费品牌偏好',
    '1018': '餐饮消费偏好',
    '1020': '省内来源分布',
    '1021': '市内来源分布',
    '1022': '消费档次分布',
    '1023': '家庭汽车情况'
  }
  return names[code] || `服务${code}`
}

// 1001服务数据格式化（人口基础属性）
function formatP0SData(data) {
  if (!data || typeof data !== 'object') return '<p>数据格式错误</p>'

  const visitTotal = data.p0_sum || 0
  const grandTotal = data.pall_sum || 0
  // 居住人数 = 居住人口男+女
  const dwellTotal = (data.male1_sum || 0) + (data.female1_sum || 0)
  // 工作人数 = 工作人口男+女
  const workTotal = (data.male2_sum || 0) + (data.female2_sum || 0)

  // 年龄段（age0_=到访，age1_=居住，age2_=工作）
  const ageGroups = [
    ['0-6岁', '0006'], ['6-12岁', '0612'], ['12-15岁', '1215'], ['15-18岁', '1518'],
    ['19-24岁', '1924'], ['25-29岁', '2529'], ['30-34岁', '3034'], ['35-39岁', '3539'],
    ['40-44岁', '4044'], ['45-49岁', '4549'], ['50-54岁', '5054'], ['55-59岁', '5559'],
    ['60-64岁', '6064'], ['65-69岁', '6569'], ['70岁+', '70up']
  ]

  // P层级（去掉P1/P2，去掉前缀，只显示中文名称）
  const pLevels = [
    ['总人口规模', grandTotal],
    ['外省到访人数', data.p3_sum || 0],
    ['娱乐人数', data.p4_sum || 0],
    ['居住工作重合人数', data.p5_sum || 0],
  ]

  // 三个大数字
  let html = `<div style="display:flex;gap:10px;margin-bottom:12px;">
    <div style="flex:1;background:#f0f2f5;border-radius:6px;padding:10px;text-align:center;">
      <div style="font-size:22px;font-weight:bold;color:#764ba2;">${visitTotal.toLocaleString()}</div>
      <div style="font-size:11px;color:#999;margin-top:2px;">到访人数</div>
    </div>
    <div style="flex:1;background:#e8f4fd;border-radius:6px;padding:10px;text-align:center;">
      <div style="font-size:22px;font-weight:bold;color:#409eff;">${dwellTotal.toLocaleString()}</div>
      <div style="font-size:11px;color:#999;margin-top:2px;">居住人数</div>
    </div>
    <div style="flex:1;background:#fce8f3;border-radius:6px;padding:10px;text-align:center;">
      <div style="font-size:22px;font-weight:bold;color:#f56c9e;">${workTotal.toLocaleString()}</div>
      <div style="font-size:11px;color:#999;margin-top:2px;">工作人数</div>
    </div>
  </div>`

  // P层级表格（表头改为"其他人口"）
  html += `<table class="data-table"><thead><tr><th>其他人口</th><th class="num">人数</th></tr></thead><tbody>`
  for (const [label, val] of pLevels) {
    html += `<tr><td>${label}</td><td class="num">${val.toLocaleString()}</td></tr>`
  }
  html += `</tbody></table>`

  // 性别分布
  const maleV = data.male0_sum || 0
  const femaleV = data.female0_sum || 0
  const maleD = data.male1_sum || 0
  const femaleD = data.female1_sum || 0
  const maleW = data.male2_sum || 0
  const femaleW = data.female2_sum || 0
  html += `<div style="font-size:12px;font-weight:bold;color:#666;margin-top:12px;margin-bottom:6px;">性别分布</div>`
  html += `<table class="data-table"><thead><tr><th>性别</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>`
  html += `<tr><td>男性人数</td><td class="num">${maleV.toLocaleString()}</td><td class="num">${maleD.toLocaleString()}</td><td class="num">${maleW.toLocaleString()}</td></tr>`
  html += `<tr><td>女性人数</td><td class="num">${femaleV.toLocaleString()}</td><td class="num">${femaleD.toLocaleString()}</td><td class="num">${femaleW.toLocaleString()}</td></tr>`
  html += `</tbody></table>`

  // 年龄分布
  html += `<div style="font-size:12px;font-weight:bold;color:#666;margin-top:12px;margin-bottom:6px;">年龄段分布</div>`
  html += `<table class="data-table"><thead><tr><th>年龄段</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>`
  for (const [label, code] of ageGroups) {
    const v0 = data[`age0_${code}`] || 0
    const v1 = data[`age1_${code}`] || 0
    const v2 = data[`age2_${code}`] || 0
    if (v0 + v1 + v2 === 0) continue
    html += `<tr><td>${label}</td><td class="num">${v0.toLocaleString()}</td><td class="num">${v1.toLocaleString()}</td><td class="num">${v2.toLocaleString()}</td></tr>`
  }
  html += `</tbody></table>`

  // 月出账金额（改为三列：到访/居住/工作）
  const arpuGroups = [
    ['50元以下', '50'], ['50-100元', '100'], ['100-150元', '150'],
    ['150-200元', '200'], ['200-250元', '250'], ['250元以上', 'up']
  ]
  html += `<div style="font-size:12px;font-weight:bold;color:#666;margin-top:12px;margin-bottom:6px;">月出账金额</div>`
  html += `<table class="data-table"><thead><tr><th>话费区间</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>`
  for (const [label, suffix] of arpuGroups) {
    const v0 = data[`arpu0_${suffix}`] || 0
    const v1 = data[`arpu1_${suffix}`] || 0
    const v2 = data[`arpu2_${suffix}`] || 0
    if (v0 + v1 + v2 === 0) continue
    html += `<tr><td>${label}</td><td class="num">${v0.toLocaleString()}</td><td class="num">${v1.toLocaleString()}</td><td class="num">${v2.toLocaleString()}</td></tr>`
  }
  html += `</tbody></table>`

  return html
}

// 格式化数组数据
function formatArrayData(data, serviceCode) {
  if (!Array.isArray(data) || data.length === 0) return '<p>暂无数据</p>'

  const firstItem = data[0]

  // 1002: 上网标签分布 TOP15（标签/到访/居住/工作）- 按popu_type分组合并
  if (firstItem.popu_type !== undefined && firstItem.tag_value !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const groups = { '到访': [], '居住': [], '工作': [], '其他': [] }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (!groups[type]) groups[type] = []
      groups[type].push(item)
    }
    
    // 创建标签到数值的映射
    const tagMap = new Map()
    for (const [type, items] of Object.entries(groups)) {
      if (items.length === 0) continue
      for (const item of items) {
        const tagName = item.tag_name || '-'
        if (!tagMap.has(tagName)) {
          tagMap.set(tagName, { '到访': 0, '居住': 0, '工作': 0 })
        }
        tagMap.get(tagName)[type] = item.tag_value || 0
      }
    }
    
    // 按到访人数降序排序，取前10
    const sortedTags = [...tagMap.entries()].sort((a, b) => b[1]['到访'] - a[1]['到访']).slice(0, 10)
    
    let html = `<table class="data-table"><thead><tr><th>标签</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>`
    for (const [tagName, values] of sortedTags) {
      html += `<tr><td>${tagName}</td><td class="num">${values['到访'].toLocaleString()}</td><td class="num">${values['居住'].toLocaleString()}</td><td class="num">${values['工作'].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table>'
    return html
  }

  // 1005: 每小时段人口流量（时段/工作日到访/周末到访/工作日全量/周末全量）
  if (firstItem.hour_period !== undefined) {
    const hourMap = {}
    for (const item of data) {
      const h = item.hour_period
      if (!hourMap[h]) {
        hourMap[h] = { workday_visit: 0, weekend_visit: 0, workday_all: 0, weekend_all: 0 }
      }
      // day_type=0 是工作日，day_type=1 是周末
      if (item.day_type === 0) {
        hourMap[h].workday_visit = item.hour_visit
        hourMap[h].workday_all = item.hour_all
      } else {
        hourMap[h].weekend_visit = item.hour_visit
        hourMap[h].weekend_all = item.hour_all
      }
    }
    const sortedHours = Object.keys(hourMap).map(Number).sort((a, b) => a - b)
    let html = `<table class="data-table"><thead><tr><th>时段</th><th class="num">工作日到访人次</th><th class="num">周末到访人次</th><th class="num">工作日全量人次</th><th class="num">周末全量人次</th></tr></thead><tbody>`
    for (const h of sortedHours) {
      const d = hourMap[h]
      html += `<tr><td>${h}:00</td><td class="num">${d.workday_visit.toLocaleString()}</td><td class="num">${d.weekend_visit.toLocaleString()}</td><td class="num">${d.workday_all.toLocaleString()}</td><td class="num">${d.weekend_all.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table>'
    return html
  }

  // 1007: 每月到达次数分布
  if (firstItem.reach1 !== undefined) {
    const reachLabels = [
      ['1次', 'reach1'],
      ['2-4次', 'reach2'],
      ['5-10次', 'reach3'],
      ['11-20次', 'reach4'],
      ['20次以上', 'reach5']
    ]
    let html = `<table class="data-table"><thead><tr><th>月驻留次数</th><th class="num">人数</th></tr></thead><tbody>`
    for (const [label, key] of reachLabels) {
      const val = data[key] || 0
      if (val === 0) continue
      html += `<tr><td>${label}</td><td class="num">${val.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table>'
    return html
  }

  // 1009: 消费水平（富裕度指数）- 按spendpower分组合并到访/居住/工作
  if (firstItem.spendpower !== undefined) {
    const spendLabels = { '1': '极低', '2': '低', '3': '中低', '4': '中', '5': '中高', '6': '高', '7': '极高', '8': '超高' }
    const groups = { '到访': {}, '居住': {}, '工作': {}, '其他': {} }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeNames = ['到访', '居住', '工作']
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (!groups[type]) groups[type] = {}
      groups[type][item.spendpower] = item.spendpower_value || 0
    }
    
    // 获取所有消费等级
    const allSpendLevels = new Set()
    for (const items of Object.values(groups)) {
      for (const level of Object.keys(items)) {
        allSpendLevels.add(level)
      }
    }
    const sortedLevels = [...allSpendLevels].sort((a, b) => Number(a) - Number(b))
    
    let html = `<table class="data-table"><thead><tr><th>消费能力</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>`
    for (const level of sortedLevels) {
      const label = spendLabels[level] || `等级${level}`
      const v0 = groups['到访'][level] || 0
      const v1 = groups['居住'][level] || 0
      const v2 = groups['工作'][level] || 0
      if (v0 + v1 + v2 === 0) continue
      html += `<tr><td>${label}</td><td class="num">${v0.toLocaleString()}</td><td class="num">${v1.toLocaleString()}</td><td class="num">${v2.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table>'
    return html
  }

  // 默认表格
  let html = `<table class="data-table"><thead><tr>`
  const headers = Object.keys(firstItem)
  for (const h of headers) {
    html += `<th>${h}</th>`
  }
  html += `</tr></thead><tbody>`
  
  for (const item of data.slice(0, 20)) {
    html += '<tr>'
    for (const h of headers) {
      const val = item[h]
      const display = typeof val === 'number' ? val.toLocaleString() : (val ?? '-')
      html += `<td class="num">${display}</td>`
    }
    html += '</tr>'
  }
  html += '</tbody></table>'
  return html
}

// 格式化其他服务数据
function formatOtherData(data, serviceCode) {
  const groups = { '到访': {}, '居住': {}, '工作': {}, '其他': {} }
  
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== 'number') continue
    const type = getPopTypeLabel(key)
    if (type && groups[type]) {
      groups[type][key] = val
    } else {
      groups['其他'][key] = val
    }
  }
  
  let html = ''
  for (const [type, items] of Object.entries(groups)) {
    if (Object.keys(items).length === 0) continue
    const total = Object.values(items).reduce((a, b) => a + b, 0)
    const sortedItems = Object.entries(items).sort((a, b) => a[0].localeCompare(b[0]))
    
    html += `<div class="pop-group">
      <div class="group-header">${type}人口 <span class="group-total">${total.toLocaleString()}</span></div>
      <table class="data-table"><thead><tr><th>指标名称</th><th>数值</th></tr></thead><tbody>`
    for (const [key, val] of sortedItems) {
      const label = getFieldLabel(serviceCode, key)
      html += `<tr><td>${label}</td><td class="num">${val.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
  }
  return html
}

// 获取人群类型标签
function getPopTypeLabel(key) {
  const suffix = key.slice(-1)
  const map = { '0': '到访', '1': '居住', '2': '工作' }
  return map[suffix]
}

// 获取字段中文标签
function getFieldLabel(serviceCode, key) {
  const baseLabels = {
    's0': '未知年龄', 's1': '儿童/青少年', 's2': '青年', 's3': '中年', 's4': '老年', 's5': '学生', 's6': '家庭', 's7': '商务',
    'm0': '未知性别', 'm1': '男性', 'm2': '女性',
    'pop_dwell': '居住人口', 'pop_work': '工作人口', 'visit_count': '到访人次'
  }
  return baseLabels[key] || key
}

function formatValue(value) {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
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

.purchase-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #e6a23c;
  text-align: center;
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

/* 结果详情样式 - 与购买履历一致 */
.detail-result-item {
  margin-bottom: 15px;
  padding: 10px;
  background: white;
  border-radius: 4px;
}

.detail-result-item h4 {
  margin: 0 0 10px 0;
  font-size: 13px;
  color: #764ba2;
}

.result-item-simple {
  display: flex;
  justify-content: space-between;
  padding: 8px;
  background: white;
  border-radius: 4px;
  border: 1px solid #eee;
  margin-bottom: 5px;
}

.pop-group {
  margin-bottom: 10px;
}

.group-header {
  font-size: 12px;
  color: #666;
  margin-bottom: 5px;
  display: flex;
  justify-content: space-between;
}

.group-total {
  font-weight: bold;
  color: #764ba2;
}

/* 数据表格样式 */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-top: 5px;
}

.data-table th,
.data-table td {
  padding: 6px 8px;
  text-align: left;
  border: 1px solid #ebeef5;
}

.data-table th {
  background: #f5f7fa;
  color: #606266;
  font-weight: 600;
}

.data-table tbody tr:hover {
  background: #f5f7fa;
}

.data-table .num {
  text-align: right;
  font-family: 'Monaco', 'Menlo', monospace;
}
</style>
