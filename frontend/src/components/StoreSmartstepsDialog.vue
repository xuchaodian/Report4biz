<template>
  <el-dialog
    v-model="dialogVisible"
    title="联通人口数据"
    width="500px"
    draggable
    @close="onClose"
  >
    <div class="store-info" v-if="storeInfo">
      <div class="store-name">{{ storeInfo.name }}</div>
      <div class="store-position">
        位置: {{ storeInfo.latitude.toFixed(6) }}, {{ storeInfo.longitude.toFixed(6) }}
      </div>
    </div>

    <el-form :model="queryForm" label-width="80px" size="small" style="margin-top: 15px;">
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
      <span>单位: 公里</span>
    </div>

    <div class="quota-section">
      <div class="quota-label">剩余次数</div>
      <div class="quota-display" v-if="quotaInfo">
        <span class="quota-number">{{ quotaInfo.available }}</span>
        <span class="quota-label">次</span>
      </div>
      <div class="quota-display" v-else>
        <span class="quota-number">-</span>
        <span class="quota-label">次</span>
      </div>
    </div>

    <!-- 查询结果 -->
    <div v-if="queryResult" class="result-section">
      <div class="result-header">
        <span class="result-title">📊 查询结果</span>
        <el-button link @click="queryResult = null">清除</el-button>
      </div>
      <div class="result-data" v-html="formatResult(queryResult)"></div>
    </div>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button 
        type="primary" 
        @click="handleQuery"
        :disabled="!canQuery || isLoading"
        :loading="isLoading"
      >
        {{ isLoading ? '查询中...' : '购买' }}
      </el-button>
    </template>
  </el-dialog>

  <!-- 购买确认对话框 -->
  <el-dialog
    v-model="showConfirmDialog"
    title="确认订单"
    width="400px"
  >
    <div class="confirm-content">
      <p>您即将购买联通人口数据查询服务：</p>
      <ul>
        <li><strong>门店:</strong> {{ storeInfo?.name }}</li>
        <li><strong>圆心位置:</strong> {{ storeInfo?.latitude.toFixed(6) }}, {{ storeInfo?.longitude.toFixed(6) }}</li>
        <li><strong>查询半径:</strong> {{ getRadiiDisplay() }}</li>
        <li><strong>数据年月:</strong> {{ selectedMonthLabel }}</li>
        <li><strong>本次扣除:</strong> {{ getQuotaToUse() }}次</li>
        <li><strong>扣除后剩余:</strong> {{ getRemainingAfterUse() }}次</li>
      </ul>
    </div>
    <template #footer>
      <el-button @click="showConfirmDialog = false">取消</el-button>
      <el-button type="primary" @click="executeQuery" :loading="isLoading">
        确认购买
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const props = defineProps({
  visible: Boolean,
  store: Object  // 门店对象，包含 latitude, longitude, name
})

const emit = defineEmits(['update:visible', 'close'])

// 对话框状态
const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

// 门店信息
const storeInfo = ref(null)

// 查询表单
const queryForm = ref({
  radius1: 1,
  radius2: 0,
  radius3: 0,
  cityMonth: ''
})

// 可选月份
const availableMonths = ref([])
const quotaInfo = ref(null)
const isLoading = ref(false)
const queryResult = ref(null)
const showConfirmDialog = ref(false)

// 计算属性
const canQuery = computed(() => {
  const hasRadius = queryForm.value.radius1 > 0 || queryForm.value.radius2 > 0 || queryForm.value.radius3 > 0
  return hasRadius && queryForm.value.cityMonth && quotaInfo.value?.available > 0
})

const selectedMonthLabel = computed(() => {
  const month = availableMonths.value.find(m => m.value === queryForm.value.cityMonth)
  return month ? month.label : ''
})

// 计算本次扣除次数（有效半径的数量）
function getQuotaToUse() {
  let count = 0
  if (queryForm.value.radius1 > 0) count++
  if (queryForm.value.radius2 > 0) count++
  if (queryForm.value.radius3 > 0) count++
  return count
}

// 计算扣除后剩余次数
function getRemainingAfterUse() {
  if (!quotaInfo.value) return '-'
  return quotaInfo.value.available - getQuotaToUse()
}

// 获取半径显示
function getRadiiDisplay() {
  const radii = []
  if (queryForm.value.radius1 > 0) radii.push(`${queryForm.value.radius1}公里`)
  if (queryForm.value.radius2 > 0) radii.push(`${queryForm.value.radius2}公里`)
  if (queryForm.value.radius3 > 0) radii.push(`${queryForm.value.radius3}公里`)
  return radii.length > 0 ? radii.join(', ') : '无'
}

// 获取有效半径（米）
function getRadiiInMeters() {
  const radii = []
  if (queryForm.value.radius1 > 0) radii.push(Math.round(queryForm.value.radius1 * 1000))
  if (queryForm.value.radius2 > 0) radii.push(Math.round(queryForm.value.radius2 * 1000))
  if (queryForm.value.radius3 > 0) radii.push(Math.round(queryForm.value.radius3 * 1000))
  return radii
}

// 加载可选月份
function loadAvailableMonths() {
  const now = new Date()
  const months = []
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1  // 4月

  // 当前可用数据是3月和2月
  if (currentMonth >= 4) {
    // 4月时，可提供3月和2月数据
    months.push({ value: `${currentYear}03`, label: `${currentYear}年3月` })
    months.push({ value: `${currentYear}02`, label: `${currentYear}年2月` })
  } else if (currentMonth >= 3) {
    // 3月时，可提供2月和1月数据
    months.push({ value: `${currentYear}02`, label: `${currentYear}年2月` })
    months.push({ value: `${currentYear}01`, label: `${currentYear}年1月` })
  } else {
    // 更早的月份
    months.push({ value: `${currentYear}01`, label: `${currentYear}年1月` })
  }

  availableMonths.value = months
  if (months.length > 0) {
    queryForm.value.cityMonth = months[0].value
  }
}

// 加载配额
async function loadQuota() {
  try {
    const res = await axios.get('/api/purchase/quota')
    quotaInfo.value = res.data
  } catch (e) {
    console.error('加载配额失败:', e)
    quotaInfo.value = { total: 0, used: 0, available: 0 }
  }
}

// 查询按钮点击
function handleQuery() {
  if (!canQuery.value) {
    ElMessage.warning('请设置查询参数或检查配额')
    return
  }
  showConfirmDialog.value = true
}

// 执行查询
async function executeQuery() {
  if (!storeInfo.value) return

  showConfirmDialog.value = false
  isLoading.value = true
  queryResult.value = null

  try {
    const radii = getRadiiInMeters()
    
    const res = await axios.post('/api/smartsteps/query', {
      centerLng: storeInfo.value.longitude,
      centerLat: storeInfo.value.latitude,
      radius: radii[0],
      radii: radii,
      // 请求全部23个服务
      services: ['1001','1002','1003','1004','1005','1006','1007','1008','1009','1010','1011','1012','1013','1014','1015','1017','1018','1019','1020','1021','1022','1023'],
      cityMonth: queryForm.value.cityMonth,
      quotaUsed: getQuotaToUse(),
      storeName: storeInfo.value.name,
      storeType: storeInfo.value.store_type || '已开业'
    })

    queryResult.value = res.data
    ElMessage.success('查询成功!')
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
  
  if (typeof result === 'object') {
    for (const [key, value] of Object.entries(result)) {
      const label = getServiceName(key)
      
      // 根据数据类型格式化显示
      if (typeof value === 'object' && value !== null) {
        // 对象类型，展开显示
        let subHtml = ''
        for (const [subKey, subVal] of Object.entries(value)) {
          subHtml += `<div style="font-size:11px;padding:2px 0;border-bottom:1px dashed #eee;">
            <span style="color:#999;">${subKey}:</span>
            <span style="font-weight:normal;">${subVal}</span>
          </div>`
        }
        html += `<div class="result-item result-object">
          <span class="result-label">${label}</span>
          <div class="result-object-content">${subHtml}</div>
        </div>`
      } else {
        // 基本类型，直接显示
        const val = formatValue(value)
        html += `<div class="result-item">
          <span class="result-label">${label}</span>
          <span class="result-value">${val}</span>
        </div>`
      }
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
    '1004': '到访人口',
    '1005': '每小时段人口流量',
    '1006': '人口属性分析',
    '1007': '消费水平分布',
    '1008': '年龄段分布',
    '1009': '性别比例',
    '1010': '收入水平分布',
    '1011': '家庭状况分布',
    '1012': '出行方式分布',
    '1013': '居住地分布',
    '1014': '工作地分布',
    '1015': '工作日/周末对比',

    '1017': '月均人流热度',
    '1018': '月到访频次',
    '1019': '市外来源分布',
    '1020': '省内来源分布',
    '1021': '市内来源分布',
    '1022': '停留时长分布',
    '1023': '全量人口(全)'
  }
  return names[code] || code
}

function formatValue(value) {
  if (typeof value === 'object') return JSON.stringify(value)
  return value ? String(value) : '-'
}

// 关闭
function onClose() {
  queryResult.value = null
  emit('close')
}

// 监听store变化
watch(() => props.store, (newStore) => {
  if (newStore) {
    storeInfo.value = { ...newStore }
    loadAvailableMonths()
    loadQuota()
  }
}, { immediate: true })
</script>

<style scoped>
.store-info {
  padding: 10px 15px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 15px;
}

.store-name {
  font-weight: bold;
  font-size: 15px;
  color: #333;
  margin-bottom: 4px;
}

.store-position {
  font-size: 12px;
  color: #666;
}

.radius-unit {
  margin-left: 8px;
  color: #999;
  font-size: 12px;
}

.query-info {
  font-size: 12px;
  color: #666;
  margin-bottom: 15px;
}

.quota-section {
  padding: 10px 0;
  border-top: 1px solid #eee;
}

.quota-label {
  font-size: 12px;
  color: #666;
  margin-bottom: 5px;
}

.quota-display {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.quota-number {
  font-size: 28px;
  font-weight: bold;
  color: #764ba2;
}

.quota-label {
  font-size: 14px;
  color: #666;
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

.result-object {
  flex-direction: column;
  gap: 8px;
}

.result-object-content {
  width: 100%;
  padding: 8px;
  background: #f8f8f8;
  border-radius: 4px;
}

.result-label {
  color: #666;
}

.result-value {
  font-weight: bold;
  color: #333;
}

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
