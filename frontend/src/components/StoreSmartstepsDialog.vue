<template>
  <el-dialog
    v-model="dialogVisible"
    title="联通人口数据"
    width="500px"
    draggable
    @close="onClose"
  >
    <div class="store-info" v-if="storeInfo">
      <div class="store-name-row">
        <span class="store-name">{{ storeInfo.name }}</span>
        <span v-if="storePurchases.length > 0" class="has-history" title="该门店有购买记录">⭐</span>
      </div>
      <div class="store-position">
        位置: {{ storeInfo.latitude.toFixed(6) }}, {{ storeInfo.longitude.toFixed(6) }}
      </div>
    </div>

    <!-- 已购报表按钮 -->
    <div v-if="storePurchases.length > 0" class="history-section">
      <el-button type="warning" size="small" @click="showHistoryDialog">
        📋 已购报表 ({{ storePurchases.length }})
      </el-button>
    </div>
    <div v-else class="history-section">
      <span class="no-history">该门店暂无购买记录</span>
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

  <!-- 历史报表对话框 -->
  <el-dialog
    v-model="showPurchaseHistoryDialog"
    :title="`${storeInfo?.name || ''} - 购买履历`"
    width="700px"
    draggable
  >
    <div v-if="selectedPurchase">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="数据年月">{{ selectedPurchase.city_month }}</el-descriptions-item>
        <el-descriptions-item label="购买时间">{{ formatDate(selectedPurchase.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="门店类型">{{ selectedPurchase.store_type }}</el-descriptions-item>
        <el-descriptions-item label="半径">{{ selectedPurchase.radius }}</el-descriptions-item>
      </el-descriptions>
      <div style="margin-top: 15px;">
        <el-button type="primary" @click="loadPurchaseDetail(selectedPurchase.id)">查看详情</el-button>
      </div>
    </div>
    <div v-else>
      <p style="color: #666; margin-bottom: 15px;">请选择要查看的购买记录：</p>
      <el-table :data="storePurchases" @row-click="selectPurchase" stripe highlight-current-row>
        <el-table-column prop="city_month" label="数据年月" width="100" />
        <el-table-column prop="created_at" label="购买时间" width="150" :formatter="(row) => formatDate(row.created_at)" />
        <el-table-column prop="store_type" label="门店类型" width="100" />
        <el-table-column prop="radius" label="半径" />
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="selectedPurchase = row">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </el-dialog>

  <!-- 历史详情对话框 -->
  <el-dialog
    v-model="showHistoryDetailDialog"
    :title="currentDetail?.store_name || storeInfo?.name || '订单' + currentDetail?.id"
    width="700px"
    draggable
  >
    <div v-if="detailLoading" class="detail-loading">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>加载中...</span>
    </div>
    <div v-else-if="currentDetail" class="detail-content">
      <div class="detail-info">
        <p><strong>订单ID:</strong> {{ currentDetail.id }}</p>
        <p><strong>查询时间:</strong> {{ formatDate(currentDetail.created_at) }}</p>
        <p><strong>位置:</strong> {{ currentDetail.center_lat?.toFixed(6) }}, {{ currentDetail.center_lng?.toFixed(6) }}</p>
        <p><strong>半径:</strong> {{ currentDetail.radii?.join(', ') }}米</p>
        <p><strong>数据年月:</strong> {{ currentDetail.city_month }}</p>
      </div>
      <div class="detail-result" v-if="resultData">
        <h4>📊 人口概览</h4>
        <div class="result-grid" v-html="formatResultData(resultData)"></div>
      </div>
      <div v-else class="no-result">
        <p>暂无数据（该订单配额已返还）</p>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
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

// 门店购买履历
const storePurchases = ref([])
const showPurchaseHistoryDialog = ref(false)
const selectedPurchase = ref(null)
const showHistoryDetailDialog = ref(false)

// 查看详情相关（与MyAccountView保持一致）
const detailLoading = ref(false)
const currentDetail = ref(null)
const resultData = ref(null)

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

// 加载门店购买履历
async function loadStorePurchases() {
  if (!storeInfo.value?.name) {
    storePurchases.value = []
    return
  }
  try {
    const res = await axios.get(`/api/purchase/by-store/${encodeURIComponent(storeInfo.value.name)}`)
    storePurchases.value = res.data?.purchases || []
  } catch (e) {
    console.error('加载购买履历失败:', e)
    storePurchases.value = []
  }
}

// 显示历史对话框
async function showHistoryDialog() {
  // 先加载该门店的购买履历
  await loadStorePurchases()
  
  if (storePurchases.value.length === 1) {
    // 只有一条记录，直接加载详情并显示
    loadPurchaseDetail(storePurchases.value[0].id)
  } else if (storePurchases.value.length > 1) {
    // 多条记录，显示选择列表
    selectedPurchase.value = null
    showPurchaseHistoryDialog.value = true
  } else {
    // 没有记录
    ElMessage.info('该门店暂无购买记录')
  }
}

// 选择购买记录
function selectPurchase(row) {
  selectedPurchase.value = row
}

// 加载购买详情（与MyAccountView保持一致）
async function loadPurchaseDetail(id) {
  showPurchaseHistoryDialog.value = false
  showHistoryDetailDialog.value = true
  detailLoading.value = true
  currentDetail.value = null
  resultData.value = null

  try {
    const { data } = await axios.get(`/api/purchase/${id}`)
    currentDetail.value = data
    resultData.value = data.result_data
  } catch (e) {
    console.error('加载详情失败:', e)
    ElMessage.error('加载详情失败: ' + (e.response?.data?.message || e.message))
    showHistoryDetailDialog.value = false
    return
  } finally {
    detailLoading.value = false
  }
}

// 排除的服务列表（不在详情页显示）
const excludeServices = ['1003', '1004', '1008', '1016', '1017', '1018', '1019', '1020', '1021', '1022', '1023']

// 服务名称映射（与MyAccountView完全一致）
const getServiceName = (code) => {
  const names = {
    '1001': '全量人口',
    '1002': '上网标签分布',
    '1003': '手机品牌分布',
    '1005': '每小时段人口流量',
    '1006': '每日人流量及停留时长',
    '1007': '每月到达次数分布',
    '1008': 'APP使用人数分布',
    '1009': '消费水平（富裕指数）',
    '1010': '人口教育水平',
    '1011': '人口行业分布',
    '1012': '人生阶段分布',
    '1013': '综合消费能力预测',
    '1014': '网购能力预测',
    '1015': '资产预测（收入/有车/有房）',
  }
  return names[code] || code
}

// 格式化结果显示 - 简化版：只显示7个核心指标
function formatResultData(data) {
  if (!data) return '<p>暂无数据</p>'
  
  // 如果 data 是字符串，尝试解析
  let apiResult = data
  if (typeof data === 'string') {
    try {
      apiResult = JSON.parse(data)
    } catch (e) {
      console.error('JSON解析失败:', e)
      return '<p>暂无数据</p>'
    }
  }
  
  // 如果 data 是 { apiResult: {...} } 格式
  if (apiResult && apiResult.apiResult) {
    apiResult = apiResult.apiResult
  }
  
  if (!apiResult || typeof apiResult !== 'object') return '<p>暂无数据</p>'
  if (apiResult.error) return `<p style="color:red;">❌ ${apiResult.error}</p>`

  // 只显示 1001 服务中的7个核心指标
  const coreFields = {
    'PALL_SUM': '总人口规模',
    'P0_SUM': '到访人口数',
    'P1_SUM': '居住人口数',
    'P2_SUM': '工作人口数',
    'P3_SUM': '外省到访人口数',
    'P4_SUM': '娱乐人数',
    'P5_SUM': '居住工作重合人数'
  }
  
  const data1001 = apiResult['1001']
  if (!data1001 || typeof data1001 !== 'object') return '<p>暂无数据</p>'
  
  // 构建核心指标表格
  let html = `<table class="data-table">
    <thead>
      <tr>
        <th>指标名称</th>
        <th>数值</th>
      </tr>
    </thead>
    <tbody>`
  
  for (const [key, label] of Object.entries(coreFields)) {
    // 查找匹配的值（可能带后缀，如 P0_SUM0）
    let value = null
    for (const [dataKey, dataVal] of Object.entries(data1001)) {
      if (typeof dataVal !== 'number') continue
      const match = dataKey.match(/^(P\d_SUM)\d*$/i)
      if (match && match[1].toUpperCase() === key) {
        value = dataVal
        break
      }
      if (dataKey.toUpperCase() === key) {
        value = dataVal
        break
      }
    }
    html += `<tr>
      <td>${label}</td>
      <td class="num">${value !== null ? value.toLocaleString() : '-'}</td>
    </tr>`
  }
  
  html += '</tbody></table>'
  return html
}

// 1001服务数据格式化 - 分列对比表格（与MyAccountView完全一致）
const formatP0SData = (data) => {
  // 字段名格式: prefix + digit + _ + suffix
  // 如 AGE0_0006, AGE1_6569, AGE2_70up
  // digit: 0=到访, 1=居住, 2=工作
  const typeNames = ['到访', '居住', '工作']
  
  // 定义指标排序顺序
  const sortOrder = [
    'PALL_SUM', 'P0_SUM', 'P1_SUM', 'P2_SUM', 'P3_SUM', 'P4_SUM', 'P5_SUM',
    '总人口规模', '到访人口数', '居住人口数', '工作人口数', '外省到访人口数', '娱乐人数', '居住工作重合人数',
    'MALE_SUM', 'FEMALE_SUM', '男性人数', '女性人数',
    'AGE_0006', 'AGE_0612', 'AGE_1215', 'AGE_1518', 'AGE_1924',
    '6岁以下人数', '7-12岁人数', '13-15岁人数', '16-18岁人数', '19-24岁人数',
    'AGE_2529', 'AGE_3034', 'AGE_3539', 'AGE_4044', 'AGE_4549',
    '25-29岁人数', '30-34岁人数', '35-39岁人数', '40-44岁人数', '45-49岁人数',
    'AGE_5054', 'AGE_5559', 'AGE_6064', 'AGE_6569', 'AGE_70up',
    '50-54岁人数', '55-59岁人数', '60-64岁人数', '65-69岁人数', '70岁以上人数',
    'consume_1', 'consume_2', 'consume_3',
    '月出帐金额50元以下人数', '月出帐金额50-100元人数', '月出帐金额100-150元人数',
    '月出帐金额150-200元人数', '月出帐金额200-250元人数', '月出帐金额250元以上人数'
  ]
  
  // P+数字+SUM 字段的映射（可能带数字后缀，如 P0_SUM0）
  const pSumFields = {
    'PALL_SUM': { label: '总人口规模', isSingleColumn: true },
    'P0_SUM': { label: '到访人口数', showIn: '到访' },
    'P1_SUM': { label: '居住人口数', showIn: '居住' },
    'P2_SUM': { label: '工作人口数', showIn: '工作' },
    'P3_SUM': { label: '外省到访人口数', showIn: '到访' },
    'P4_SUM': { label: '娱乐人数', showIn: '到访' },
    'P5_SUM': { label: '居住工作重合人数', isSingleColumn: true }
  }
  
  // 存储所有行: [{ baseKey, label, values: {到访, 居住, 工作}, isSingleColumn, singleValue }]
  const allRows = []
  const rowMap = new Map()  // 用于快速查找已存在的行
  
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== 'number') continue
    
    // 检查是否是 P+数字+SUM 字段（可能带后缀数字，如 P0_SUM0）
    const pSumMatch = key.match(/^(P\d_SUM)\d*$/i)
    if (pSumMatch) {
      const baseName = pSumMatch[1].toUpperCase()
      const fieldInfo = pSumFields[baseName]
      if (fieldInfo) {
        let row = rowMap.get(baseName)
        if (!row) {
          row = {
            baseKey: baseName,
            label: fieldInfo.label,
            values: { '到访': null, '居住': null, '工作': null },
            isSingleColumn: fieldInfo.isSingleColumn || false,
            singleValue: fieldInfo.isSingleColumn ? 0 : null
          }
          rowMap.set(baseName, row)
          allRows.push(row)
        }
        if (fieldInfo.isSingleColumn) {
          row.singleValue = val  // 更新为真实值
        } else {
          row.values[fieldInfo.showIn] = val  // 更新为真实值
        }
        continue
      }
    }
    
    // 检查是否是单列字段（如 PALL_SUM）
    if (key.toUpperCase() === 'PALL_SUM' || key.toUpperCase().startsWith('PALL_SUM')) {
      let row = rowMap.get('PALL_SUM')
      if (!row) {
        const label = getFieldLabel('1001', key)
        row = { 
          baseKey: 'PALL_SUM', 
          label, 
          values: { '到访': null, '居住': null, '工作': null }, 
          isSingleColumn: true,
          singleValue: val
        }
        rowMap.set('PALL_SUM', row)
        allRows.push(row)
      } else {
        row.singleValue = val
      }
      continue
    }
    
    // 直接用正则匹配 prefix + digit + _ + suffix
    const match = key.match(/^([a-zA-Z]+)(\d)_(.+)$/)
    if (match) {
      const [, prefix, digitStr, suffix] = match
      const digit = parseInt(digitStr)
      const typeName = typeNames[digit]
      if (!typeName) continue
      
      const baseKey = `${prefix}_${suffix}`
      // 查找是否已存在该 baseKey
      let row = rowMap.get(baseKey)
      if (!row) {
        const fullLabel = getFieldLabel('1001', key)
        // 去掉人群类型前缀
        let label = fullLabel
          .replace(/^(到访|居住|工作)人口/, '')
          .replace(/^(到访|居住|工作)/, '')
        if (label === '数') continue  // 过滤掉单个"数"字
        
        row = { baseKey, label, values: { '到访': null, '居住': null, '工作': null }, isSingleColumn: false }
        rowMap.set(baseKey, row)
        allRows.push(row)
      }
      row.values[typeName] = val
    } else {
      // 不是 prefix+digit+suffix 格式的字段
      let row = rowMap.get(key)
      if (!row) {
        const label = getFieldLabel('1001', key)
        if (label === key || label === '数') continue
        
        row = { baseKey: key, label, values: { '到访': null, '居住': null, '工作': null }, isSingleColumn: false }
        rowMap.set(key, row)
        allRows.push(row)
      }
      row.values['到访'] = val
    }
  }
  
  // 补充必填字段（如果API没有返回）
  for (const [key, fieldInfo] of Object.entries(pSumFields)) {
    if (!rowMap.has(key)) {
      const row = {
        baseKey: key,
        label: fieldInfo.label,
        values: { '到访': null, '居住': null, '工作': null },
        isSingleColumn: fieldInfo.isSingleColumn || false,
        singleValue: fieldInfo.isSingleColumn ? 0 : null
      }
      if (!fieldInfo.isSingleColumn) {
        row.values[fieldInfo.showIn] = 0
      }
      allRows.push(row)
      rowMap.set(key, row)
    }
  }
  
  // 按 sortOrder 排序
  const sortedRows = allRows.sort((a, b) => {
    let idxA = sortOrder.indexOf(a.baseKey)
    let idxB = sortOrder.indexOf(b.baseKey)
    if (idxA === -1) idxA = sortOrder.indexOf(a.label)
    if (idxB === -1) idxB = sortOrder.indexOf(b.label)
    if (idxA === -1 && idxB === -1) return 0
    if (idxA === -1) return 1
    if (idxB === -1) return -1
    return idxA - idxB
  })
  
  // 生成表格
  let html = `<table class="data-table cross-table">
    <thead>
      <tr>
        <th>指标名称</th>
        <th>到访</th>
        <th>居住</th>
        <th>工作</th>
      </tr>
    </thead>
    <tbody>`
  
  for (const row of sortedRows) {
    if (row.isSingleColumn) {
      // 单列显示：合并三个单元格
      html += `<tr>
        <td>${row.label}</td>
        <td colspan="3" class="num single-value">${row.singleValue !== null ? row.singleValue.toLocaleString() : '-'}</td>
      </tr>`
    } else {
      html += `<tr>
        <td>${row.label}</td>
        <td class="num">${row.values['到访'] !== null ? row.values['到访'].toLocaleString() : '-'}</td>
        <td class="num">${row.values['居住'] !== null ? row.values['居住'].toLocaleString() : '-'}</td>
        <td class="num">${row.values['工作'] !== null ? row.values['工作'].toLocaleString() : '-'}</td>
      </tr>`
    }
  }
  
  html += '</tbody></table>'
  return html
}

// 格式化数组数据
function formatArrayData(data, serviceCode) {
  if (!Array.isArray(data) || data.length === 0) return '<p>暂无数据</p>'
  
  const firstItem = data[0]
  
  // 1002: 居住/工作人口画像 {popu_type, pop_dwell, pop_work}
  if (firstItem.popu_type !== undefined && firstItem.pop_dwell !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    let totalDwell = 0, totalWork = 0
    
    let html = `<table class="data-table"><thead><tr><th>人群类型</th><th>居住人口</th><th>工作人口</th></tr></thead><tbody>`
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const typeName = typeNames[typeIdx] || `类型${item.popu_type}`
      const dwell = item.pop_dwell || 0
      const work = item.pop_work || 0
      totalDwell += dwell
      totalWork += work
      html += `<tr><td>${typeName}</td><td class="num">${dwell.toLocaleString()}</td><td class="num">${work.toLocaleString()}</td></tr>`
    }
    html += `<tr style="font-weight:bold;background:#f5f7fa;"><td>合计</td><td class="num">${totalDwell.toLocaleString()}</td><td class="num">${totalWork.toLocaleString()}</td></tr>`
    html += '</tbody></table>'
    return html
  }
  
  // 1005: 到访人口时间段分布 {popu_type, time_range, visit_count, ...}
  if (firstItem.time_range !== undefined || firstItem.hour_period !== undefined) {
    // 优先按 time_range 分组，否则按 hour_period
    const timeKey = firstItem.time_range !== undefined ? 'time_range' : 'hour_period'
    const timeLabels = firstItem.time_range !== undefined ? {
      '早高峰': '7-9点', '午间': '11-13点', '晚高峰': '17-19点', '夜间': '21-23点'
    } : {}
    
    // 按时间段分组
    const timeGroups = {}
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const time = item[timeKey] || '-'
      if (!timeGroups[time]) timeGroups[time] = []
      timeGroups[time].push(item)
    }
    
    // 获取所有人群类型
    const types = new Set()
    for (const item of data) {
      if (item.popu_type !== undefined) types.add(item.popu_type)
    }
    const typeNames = ['到访', '居住', '工作']
    
    // 生成表格
    let html = `<table class="data-table"><thead><tr><th>时间段</th>`
    for (const typeIdx of [...types]) {
      html += `<th>${typeNames[typeIdx] || typeIdx}</th>`
    }
    html += `</tr></thead><tbody>`
    
    for (const [time, items] of Object.entries(timeGroups)) {
      const label = timeLabels[time] || time
      html += `<tr><td>${label}</td>`
      for (const typeIdx of [...types]) {
        const item = items.find(i => i.popu_type === typeIdx)
        const val = item?.visit_count || 0
        html += `<td class="num">${val.toLocaleString()}</td>`
      }
      html += '</tr>'
    }
    html += '</tbody></table>'
    return html
  }
  
  // 1006: 到访频次分析 {popu_type, freq, visit_count}
  if (firstItem.freq !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const freqLabels = {
      '1': '月均1次以下', '2': '月均1-2次', '3': '月均3-4次', '4': '月均5-8次',
      '5': '月均8次以上', '6': '周均1次以下', '7': '周均1-3次', '8': '周均3-5次', '9': '周均5次以上'
    }
    
    // 获取唯一频次和人群类型
    const freqs = [...new Set(data.map(d => d.freq))].sort()
    const types = [...new Set(data.map(d => d.popu_type))].sort()
    
    let html = `<table class="data-table"><thead><tr><th>到访频次</th>`
    for (const typeIdx of types) {
      html += `<th>${typeNames[typeIdx] || typeIdx}</th>`
    }
    html += `</tr></thead><tbody>`
    
    for (const freq of freqs) {
      const label = freqLabels[freq] || `频次${freq}`
      html += `<tr><td>${label}</td>`
      for (const typeIdx of types) {
        const item = data.find(d => d.freq === freq && d.popu_type === typeIdx)
        const val = item?.visit_count || 0
        html += `<td class="num">${val.toLocaleString()}</td>`
      }
      html += '</tr>'
    }
    html += '</tbody></table>'
    return html
  }
  
  // 默认：直接显示表格（限制前20行）
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

// 格式化其他服务数据（按人群类型分组）
function formatOtherData(data, serviceCode) {
  // 按人群类型分组
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
  // 显示每个分组
  for (const [type, items] of Object.entries(groups)) {
    if (Object.keys(items).length === 0) continue
    const total = Object.values(items).reduce((a, b) => a + b, 0)
    
    // 按字段名排序
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
  // 基础字段标签
  const baseLabels = {
    's0': '未知年龄', 's1': '儿童/青少年', 's2': '青年', 's3': '中年', 's4': '老年', 's5': '学生', 's6': '家庭', 's7': '商务',
    'm0': '未知性别', 'm1': '男性', 'm2': '女性',
    'pop_dwell': '居住人口', 'pop_work': '工作人口', 'visit_count': '到访人次'
  }
  
  if (baseLabels[key]) return baseLabels[key]
  
  // 服务特定标签
  const serviceLabels = {
    '1007': { 'p1': '低消费', 'p2': '中低消费', 'p3': '中消费', 'p4': '中高消费', 'p5': '高消费' },
    '1009': { 's0': '0-17岁', 's1': '18-24岁', 's2': '25-34岁', 's3': '35-44岁', 's4': '45-54岁', 's5': '55-64岁', 's6': '65岁以上' },
    '1011': { 'p1': '未婚', 'p2': '已婚' },
    '1012': { 'p1': '初中及以下', 'p2': '高中/中专', 'p3': '大专', 'p4': '本科', 'p5': '硕士', 'p6': '博士' },
    '1022': { 'p1': '低档', 'p2': '中低档', 'p3': '中档', 'p4': '中高档', 'p5': '高档' },
    '1023': { 'p1': '无车', 'p2': '有车' }
  }
  
  const labels = serviceLabels[serviceCode]
  if (labels && labels[key]) return labels[key]
  
  // 默认返回原始key
  return key
}

// 格式化日期
function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
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
    loadStorePurchases()  // 加载门店购买履历
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

.store-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.has-history {
  font-size: 16px;
  cursor: pointer;
}

.history-section {
  margin-bottom: 15px;
  padding: 10px;
  background: #fff8e6;
  border-radius: 4px;
  text-align: center;
}

.no-history {
  color: #999;
  font-size: 13px;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #999;
}

/* 详情对话框样式（与MyAccountView保持一致） */
.detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px;
  color: #666;
}

.detail-content {
  max-height: 70vh;
  overflow-y: auto;
}

.detail-info {
  padding: 12px;
  background: #f5f7fa;
  border-radius: 6px;
  margin-bottom: 16px;
}

.detail-info p {
  margin: 8px 0;
  font-size: 14px;
  color: #666;
}

.detail-result h4 {
  margin: 16px 0 12px 0;
  color: #333;
  font-size: 15px;
}

.result-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #eee;
  border-radius: 4px;
}

.result-label {
  color: #764ba2;
  font-weight: 600;
  font-size: 13px;
}

.result-value {
  color: #333;
  font-weight: 500;
}

.no-result {
  text-align: center;
  padding: 30px;
  color: #999;
}

.pop-group {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px dashed #eee;
}

.pop-group:last-child {
  border-bottom: none;
}

/* 表格样式 - 使用 :deep() 穿透 v-html */
.detail-result :deep(.data-table) {
  width: 100%;
  border-collapse: collapse !important;
  margin: 8px 0;
  font-size: 13px;
  border: 1px solid #ddd !important;
}

.detail-result :deep(.data-table th),
.detail-result :deep(.data-table td) {
  padding: 10px 12px;
  border: 1px solid #ddd !important;
}

.detail-result :deep(.data-table th) {
  background: #f8f5fa;
  color: #764ba2;
  font-weight: 600;
}

.detail-result :deep(.data-table td) {
  background: #fff;
  color: #333;
}

.detail-result :deep(.data-table tr:hover td) {
  background: #f9f9ff;
}

.detail-result :deep(.data-table td.num) {
  text-align: right;
  font-family: 'Monaco', 'Menlo', monospace;
}

.detail-result :deep(.detail-result) {
  margin-bottom: 16px;
}

.detail-result :deep(.detail-result h4) {
  margin: 16px 0 10px 0;
  color: #333;
  font-size: 15px;
}

.detail-result :deep(.pop-group) {
  margin-bottom: 16px;
}

.detail-result :deep(.group-header) {
  font-weight: 600;
  color: #764ba2;
  margin-bottom: 8px;
}

.detail-result :deep(.group-total) {
  float: right;
  color: #764ba2;
}
</style>
