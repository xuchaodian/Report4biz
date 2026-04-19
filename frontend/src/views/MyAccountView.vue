<template>
  <div class="account-container">
    <el-card class="account-card">
      <template #header>
        <div class="card-header">
          <span>我的账户</span>
        </div>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="100px"
        class="account-form"
      >
        <el-form-item label="用户名">
          <el-input v-model="userStore.username" disabled />
        </el-form-item>

        <el-form-item label="公司">
          <el-input v-model="form.company" placeholder="请输入公司名称" />
        </el-form-item>

        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="请输入新邮箱" />
        </el-form-item>

        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            placeholder="请输入新密码（不修改请留空）"
            show-password
          />
        </el-form-item>

        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            show-password
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="loading" @click="handleSubmit">
            保存修改
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 剩余次数卡片 -->
    <el-card class="quota-card">
      <template #header>
        <div class="card-header">
          <span>📊 联通人口数据配额</span>
        </div>
      </template>
      <div class="quota-content">
        <div class="quota-item">
          <span class="quota-label">剩余次数</span>
          <span class="quota-value available">{{ userStore.availableQuota }}</span>
          <span class="quota-unit">次</span>
        </div>
        <div class="quota-info">
          <p>• 1个位置 + 1个半径 + 1个年月 = 1次</p>
          <p>• 每次查询扣减1次配额</p>
          <p v-if="userStore.quota">• 管理员分配: {{ userStore.quota.total }} 次</p>
          <p v-if="userStore.quota">• 已使用: {{ userStore.quota.used }} 次</p>
        </div>
        <div class="quota-actions">
          <el-button type="text" @click="refreshQuota" :loading="quotaLoading">
            🔄 刷新配额
          </el-button>
          <el-button type="text" @click="showHistoryDialog">
            📋 购买履历
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- 购买履历对话框 -->
    <el-dialog
      v-model="historyDialogVisible"
      title="📋 购买履历"
      width="1200px"
      :close-on-click-modal="false"
      class="history-dialog"
    >
      <!-- 筛选表单 -->
      <div class="history-filter">
        <el-input
          v-model="filterKeywords"
          placeholder="搜索门店名称"
          style="width: 180px"
          clearable
          @input="handleFilterChange"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select v-model="filterStoreType" placeholder="门店类型" style="width: 120px" clearable @change="handleFilterChange">
          <el-option label="已开业" value="已开业" />
          <el-option label="重点候选" value="重点候选" />
          <el-option label="一般候选" value="一般候选" />
        </el-select>
        <el-select v-model="filterCity" placeholder="城市" style="width: 120px" clearable @change="handleFilterChange">
          <el-option v-for="city in cityOptions" :key="city" :label="city" :value="city" />
        </el-select>
        <el-select v-model="filterDistrict" placeholder="区县" style="width: 120px" clearable @change="handleFilterChange">
          <el-option v-for="d in districtOptions" :key="d" :label="d" :value="d" />
        </el-select>
        <el-select v-model="filterRadius" placeholder="半径" style="width: 120px" clearable @change="handleFilterChange">
          <el-option v-for="r in radiusOptions" :key="r" :label="r" :value="r" />
        </el-select>
        <el-select v-model="filterCityMonth" placeholder="数据年月" style="width: 130px" clearable @change="handleFilterChange">
          <el-option v-for="m in cityMonthOptions" :key="m" :label="m" :value="m" />
        </el-select>
        <el-button v-if="hasActiveFilters" type="warning" plain @click="resetFilters">
          <el-icon><Close /></el-icon>清除筛选
        </el-button>
        <span class="filter-count">共 {{ filteredHistoryList.length }} 条</span>
      </div>

      <div v-if="historyLoading" class="history-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载中...</span>
      </div>
      <el-table
        v-else
        :data="filteredHistoryList"
        stripe
        border
        style="width: 100%"
        :max-height="450"
      >
        <el-table-column prop="id" label="订单ID" width="70" fixed />
        <el-table-column label="购买时间" width="150">
          <template #default="{ row }">
            {{ row.created_at ? formatDate(row.created_at) : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="门店名称" min-width="130">
          <template #default="{ row }">
            <span>{{ row.store_name || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="门店类型" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.store_type" size="small">{{ row.store_type }}</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="城市" width="90">
          <template #default="{ row }">
            <span>{{ row.city || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="区县" width="90">
          <template #default="{ row }">
            <span>{{ row.district || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="半径" width="100">
          <template #default="{ row }">
            {{ row.radius_display || (row.radius ? row.radius + '米' : '-') }}
          </template>
        </el-table-column>
        <el-table-column label="数据年月" width="90">
          <template #default="{ row }">
            {{ row.city_month || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="扣除次数" width="100" align="center">
          <template #default="{ row }">
            <span class="quota-used">{{ row.quota_used ? '-' + row.quota_used : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="剩余次数" width="100" align="center">
          <template #default="{ row }">
            <span class="quota-remaining">{{ row.remaining ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="viewPurchaseDetail(row)">
              查看结果
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 查看结果对话框 -->
    <el-dialog
      v-model="detailDialogVisible"
      :title="`📊 查询结果详情 - ${currentDetail?.store_name || '订单' + currentDetail?.id}`"
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { Loading, Location, Search, Close } from '@element-plus/icons-vue'
import axios from 'axios'
import { FIELD_LABELS } from './field_labels'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const formRef = ref(null)
const loading = ref(false)
const quotaLoading = ref(false)

// 购买履历相关
const historyDialogVisible = ref(false)
const historyLoading = ref(false)
const historyList = ref([])

// 筛选相关
const filterKeywords = ref('')
const filterStoreType = ref('')
const filterCity = ref('')
const filterDistrict = ref('')
const filterRadius = ref('')
const filterCityMonth = ref('')

// 筛选选项（从历史数据中提取）
const storeTypeOptions = ['已开业', '重点候选', '一般候选']
const cityOptions = computed(() => [...new Set(historyList.value.map(h => h.city).filter(Boolean))])
const districtOptions = computed(() => [...new Set(historyList.value.map(h => h.district).filter(Boolean))])
const radiusOptions = computed(() => [...new Set(historyList.value.map(h => h.radius_display || h.radius).filter(Boolean))])
const cityMonthOptions = computed(() => [...new Set(historyList.value.map(h => h.city_month).filter(Boolean))])

// 是否有激活的筛选条件
const hasActiveFilters = computed(() => {
  return filterKeywords.value || filterStoreType.value || filterCity.value || filterDistrict.value || filterRadius.value || filterCityMonth.value
})

// 筛选后的历史列表
const filteredHistoryList = computed(() => {
  return historyList.value.filter(h => {
    // 关键词搜索（门店名称）
    if (filterKeywords.value && !h.store_name?.toLowerCase().includes(filterKeywords.value.toLowerCase())) {
      return false
    }
    // 门店类型
    if (filterStoreType.value && h.store_type !== filterStoreType.value) {
      return false
    }
    // 城市
    if (filterCity.value && h.city !== filterCity.value) {
      return false
    }
    // 区县
    if (filterDistrict.value && h.district !== filterDistrict.value) {
      return false
    }
    // 半径
    if (filterRadius.value && h.radius_display !== filterRadius.value && h.radius !== filterRadius.value) {
      return false
    }
    // 数据年月
    if (filterCityMonth.value && h.city_month !== filterCityMonth.value) {
      return false
    }
    return true
  })
})

// 筛选变化时重置页码
const handleFilterChange = () => {
  // 如果有筛选条件，自动定位到第一页
}

// 重置筛选
const resetFilters = () => {
  filterKeywords.value = ''
  filterStoreType.value = ''
  filterCity.value = ''
  filterDistrict.value = ''
  filterRadius.value = ''
  filterCityMonth.value = ''
}

// 查看详情相关
const detailDialogVisible = ref(false)
const detailLoading = ref(false)
const currentDetail = ref(null)
const resultData = ref(null)

const form = reactive({
  email: '',
  company: '',
  newPassword: '',
  confirmPassword: ''
})

const validateConfirmPassword = (rule, value, callback) => {
  if (form.newPassword && value !== form.newPassword) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const rules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入有效的邮箱地址', trigger: 'blur' }
  ],
  newPassword: [
    { min: 6, message: '密码至少6个字符', trigger: 'blur' }
  ],
  confirmPassword: [
    { validator: validateConfirmPassword, trigger: 'blur' }
  ]
}

onMounted(async () => {
  // 填充当前邮箱和公司
  if (userStore.user?.email) {
    form.email = userStore.user.email
  }
  if (userStore.user?.company) {
    form.company = userStore.user.company
  }
  // 获取配额信息
  if (!userStore.quota) {
    await userStore.fetchQuota()
  }

  // 检查 URL 参数：如果有 storeName 或 openHistory，自动打开购买履历
  const storeName = route.query.storeName
  const openHistory = route.query.openHistory
  if (storeName || openHistory) {
    // 延迟打开对话框，确保 UI 已渲染
    setTimeout(async () => {
      await showHistoryDialog()
      // 如果有该门店的记录，高亮显示
      if (storeName && historyList.value.length > 0) {
        const targetStore = historyList.value.find(h => h.store_name === storeName)
        if (targetStore) {
          viewPurchaseDetail(targetStore)
        }
      }
      // 如果只是打开购买履历（无特定门店），不自动打开详情
      // 清除 URL 参数（避免刷新后又打开）
      router.replace({ query: {} })
    }, 500)
  }
})

// 刷新配额
const refreshQuota = async () => {
  quotaLoading.value = true
  try {
    await userStore.fetchQuota()
    ElMessage.success('配额已刷新')
  } catch {
    ElMessage.error('刷新失败')
  } finally {
    quotaLoading.value = false
  }
}

// 显示购买履历对话框
const showHistoryDialog = async () => {
  historyDialogVisible.value = true
  historyLoading.value = true
  try {
    const { data } = await axios.get('/api/purchase/history')
    historyList.value = data.purchases || []
  } catch (e) {
    console.error('加载购买履历失败:', e)
    ElMessage.error('加载购买履历失败')
    historyList.value = []
  } finally {
    historyLoading.value = false
  }
}

// 格式化日期
const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 查看购买详情
const viewPurchaseDetail = async (row) => {
  detailDialogVisible.value = true
  detailLoading.value = true
  currentDetail.value = null
  resultData.value = null
  
  try {
    const { data } = await axios.get(`/api/purchase/${row.id}`)
    currentDetail.value = data
    resultData.value = data.result_data
    // 调试：输出 monthly_reach_count 的结构
    console.log('result_data keys:', data.result_data ? Object.keys(data.result_data) : 'null')
    if (data.result_data?.apiResult) {
      const apiResult = data.result_data.apiResult
      for (const key of Object.keys(apiResult)) {
        const val = apiResult[key]
        if (Array.isArray(val) && val.length > 0) {
          console.log(`apiResult.${key} 第一条数据 keys:`, Object.keys(val[0]))
        }
      }
    }
  } catch (e) {
    console.error('加载详情失败:', e)
    ElMessage.error('加载详情失败: ' + (e.response?.data?.message || e.message))
    // 关闭对话框而不是让它显示空白内容
    detailDialogVisible.value = false
    return
  } finally {
    detailLoading.value = false
  }
}

// 排除的服务列表（不显示在结果中）
const excludeServices = ['1003', '1004', '1008', '1016', '1017', '1018', '1019', '1020', '1021', '1022', '1023']

// 服务名称映射
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

// 根据服务代码和字段名获取中文标签
const getFieldLabel = (serviceCode, fieldName) => {
  if (!FIELD_LABELS[serviceCode]) return fieldName
  const serviceFields = FIELD_LABELS[serviceCode]
  // 1. 精确匹配（区分大小写）
  if (serviceFields[fieldName]) {
    return serviceFields[fieldName]
  }
  // 2. 大小写不敏感匹配
  const upperField = fieldName.toUpperCase()
  const lowerField = fieldName.toLowerCase()
  for (const [key, label] of Object.entries(serviceFields)) {
    if (key.toUpperCase() === upperField || key.toLowerCase() === lowerField) {
      return label
    }
  }
  return fieldName // 返回原始字段名
}

// 人群类型映射（用于分组显示）
const getPopTypeLabel = (key) => {
  if (key.includes('_0') || key.startsWith('P0') || key.includes('Visit')) return '到访'
  if (key.includes('_1') || key.startsWith('P1') || key.includes('Live')) return '居住'
  if (key.includes('_2') || key.startsWith('P2') || key.includes('Work')) return '工作'
  if (key.includes('_3')) return '外省到访'
  if (key.includes('_4')) return '娱乐'
  if (key.includes('_5')) return '重合'
  return ''
}

// 格式化单个字段值
const formatDetailValue = (value) => {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0]
      if (Array.isArray(first) && first.length >= 3) {
        return `[网格数据: ${value.length}个点]`
      }
    }
    return '<详情>'
  }
  return String(value)
}

// 格式化1001服务数据（人口汇总）- 分列对比表格
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

// 格式化其他服务数据（数组格式）- 处理 popu_type/tag_value/tag_name 格式
const formatArrayData = (data, serviceCode) => {
  if (!data) return '<p>暂无数据</p>'
  if (!Array.isArray(data) || data.length === 0) return '<p>暂无数据</p>'
  
  const firstItem = data[0]
  if (!firstItem || typeof firstItem !== 'object') return '<p>暂无数据</p>'
  
  // 如果是消费水平格式 {popu_type, spendpower, spendpower_value} - 合并为交叉表
  if (firstItem.popu_type !== undefined && firstItem.spendpower !== undefined && firstItem.spendpower_value !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    
    // 创建 spendpower 到数值的映射，按 popu_type 分列
    const spendMap = new Map()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const spendLevel = item.spendpower
      if (!spendMap.has(spendLevel)) {
        spendMap.set(spendLevel, { '到访': 0, '居住': 0, '工作': 0 })
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        spendMap.get(spendLevel)[type] = item.spendpower_value || 0
      }
    }
    
    // 按消费力等级排序
    const sortedSpend = [...spendMap.entries()].sort((a, b) => a[0] - b[0])
    
    // 消费力等级标签
    const spendLabels = {
      1: '消费力指数1（最低）',
      2: '消费力指数2',
      3: '消费力指数3',
      4: '消费力指数4',
      5: '消费力指数5',
      6: '消费力指数6',
      7: '消费力指数7',
      8: '消费力指数8（最高）'
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>消费力指数</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const [level, values] of sortedSpend) {
      const label = spendLabels[level] || `消费力指数${level}`
      html += `<tr><td>${label}</td><td class="num">${values['到访'].toLocaleString()}</td><td class="num">${values['居住'].toLocaleString()}</td><td class="num">${values['工作'].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 如果是人口教育水平格式 {popu_type, fname, p0, p1, p2, p3, p4} - 合并为交叉表
  if (firstItem.popu_type !== undefined && firstItem.p0 !== undefined && firstItem.fname !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p0': '高中及以下', 'p1': '大专', 'p2': '本科', 'p3': '硕士', 'p4': '博士' }
    const pKeys = ['p0', 'p1', 'p2', 'p3', 'p4']
    
    // 创建 fname 到数值的映射，按 popu_type 分列
    const eduMap = new Map()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const fname = item.fname || '-'
      if (!eduMap.has(fname)) {
        eduMap.set(fname, { '到访': {}, '居住': {}, '工作': {} })
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            eduMap.get(fname)[type][pKey] = item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>学历</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    
    // 遍历所有教育等级
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      let toVisit = 0, residence = 0, work = 0
      
      // 汇总所有 fname 下的该教育等级数据
      for (const [fname, values] of eduMap) {
        toVisit += values['到访'][pKey] || 0
        residence += values['居住'][pKey] || 0
        work += values['工作'][pKey] || 0
      }
      
      html += `<tr><td>${label}</td><td class="num">${toVisit.toLocaleString()}</td><td class="num">${residence.toLocaleString()}</td><td class="num">${work.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 根据 serviceCode 精确匹配各服务的数据格式
  // 1012: 人生阶段分布 {popu_type, p1, p2, p3}
  if (serviceCode === '1012' && firstItem.popu_type !== undefined && firstItem.p1 !== undefined && firstItem.p3 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '已婚已育', 'p2': '已婚未育', 'p3': '未婚未育' }
    const pKeys = ['p1', 'p2', 'p3']
    
    const totals = { '到访': {}, '居住': {}, '工作': {} }
    for (const pKey of pKeys) {
      totals['到访'][pKey] = 0
      totals['居住'][pKey] = 0
      totals['工作'][pKey] = 0
    }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            totals[type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>人生阶段</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      html += `<tr><td>${label}</td><td class="num">${totals['到访'][pKey].toLocaleString()}</td><td class="num">${totals['居住'][pKey].toLocaleString()}</td><td class="num">${totals['工作'][pKey].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 1013: 综合消费能力预测 {popu_type, p1, p2, p3}
  if (serviceCode === '1013' && firstItem.popu_type !== undefined && firstItem.p1 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '消费水平高', 'p2': '消费水平中', 'p3': '消费水平低' }
    const pKeys = ['p1', 'p2', 'p3']
    
    const totals = { '到访': {}, '居住': {}, '工作': {} }
    for (const pKey of pKeys) {
      totals['到访'][pKey] = 0
      totals['居住'][pKey] = 0
      totals['工作'][pKey] = 0
    }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            totals[type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>消费能力</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      html += `<tr><td>${label}</td><td class="num">${totals['到访'][pKey].toLocaleString()}</td><td class="num">${totals['居住'][pKey].toLocaleString()}</td><td class="num">${totals['工作'][pKey].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 1014: 网购能力预测 {popu_type, p1, p2, p3, p4, p5}
  if (serviceCode === '1014' && firstItem.popu_type !== undefined && firstItem.p1 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '网购能力高', 'p2': '网购能力中高', 'p3': '网购能力中', 'p4': '网购能力中低', 'p5': '网购能力低' }
    const pKeys = ['p1', 'p2', 'p3', 'p4', 'p5']
    
    const totals = { '到访': {}, '居住': {}, '工作': {} }
    for (const pKey of pKeys) {
      totals['到访'][pKey] = 0
      totals['居住'][pKey] = 0
      totals['工作'][pKey] = 0
    }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            totals[type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>网购能力</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      html += `<tr><td>${label}</td><td class="num">${totals['到访'][pKey].toLocaleString()}</td><td class="num">${totals['居住'][pKey].toLocaleString()}</td><td class="num">${totals['工作'][pKey].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 1015: 资产预测（收入/有车/有房）{popu_type, fname, p1, p2, p3, p4, p5}
  if (serviceCode === '1015' && firstItem.popu_type !== undefined && firstItem.fname !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '预测概率高', 'p2': '预测概率中高', 'p3': '预测概率中', 'p4': '预测概率中低', 'p5': '预测概率低' }
    const pKeys = ['p1', 'p2', 'p3', 'p4', 'p5']
    
    const fnameGroups = {}
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const fname = item.fname || '-'
      if (!fnameGroups[fname]) {
        fnameGroups[fname] = { '到访': {}, '居住': {}, '工作': {} }
        for (const pKey of pKeys) {
          fnameGroups[fname]['到访'][pKey] = 0
          fnameGroups[fname]['居住'][pKey] = 0
          fnameGroups[fname]['工作'][pKey] = 0
        }
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            fnameGroups[fname][type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    const fnameConfig = {
      '收入预测': { title: '收入预测', bgClass: 'asset-income' },
      '有车预测': { title: '有车预测', bgClass: 'asset-car' },
      '有房预测': { title: '有房预测', bgClass: 'asset-house' }
    }
    
    let html = `<div class="pop-group">`
    for (const [fname, values] of Object.entries(fnameGroups)) {
      const config = fnameConfig[fname] || { title: fname, bgClass: '' }
      html += `<div class="asset-section ${config.bgClass}">
        <div class="group-header">${config.title}</div>
        <table class="data-table cross-table"><thead><tr><th>概率等级</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
      for (const pKey of pKeys) {
        const label = pLabels[pKey] || pKey
        html += `<tr><td>${label}</td><td class="num">${values['到访'][pKey].toLocaleString()}</td><td class="num">${values['居住'][pKey].toLocaleString()}</td><td class="num">${values['工作'][pKey].toLocaleString()}</td></tr>`
      }
      html += '</tbody></table></div>'
    }
    html += '</div>'
    return html
  }
  
  // 如果是人口行业分布格式 {popu_type, fname, p1, p2, ..., p10} - 合并为交叉表
  if (firstItem.popu_type !== undefined && firstItem.p1 !== undefined && firstItem.p10 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = {
      'p1': '金融从业者',
      'p2': '医务人员',
      'p3': '公务员&事业单位',
      'p4': '白领及一般职员',
      'p5': '工人及服务业人员',
      'p6': '教师',
      'p7': '农民及其他',
      'p8': '网约车司机',
      'p9': '外卖员',
      'p10': '快递员'
    }
    const pKeys = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']
    
    // 创建 fname 到数值的映射，按 popu_type 分列
    const jobMap = new Map()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const fname = item.fname || '-'
      if (!jobMap.has(fname)) {
        jobMap.set(fname, { '到访': {}, '居住': {}, '工作': {} })
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            jobMap.get(fname)[type][pKey] = item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>行业</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    
    // 遍历所有行业
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      let toVisit = 0, residence = 0, work = 0
      
      // 汇总所有 fname 下的该行业数据
      for (const [fname, values] of jobMap) {
        toVisit += values['到访'][pKey] || 0
        residence += values['居住'][pKey] || 0
        work += values['工作'][pKey] || 0
      }
      
      html += `<tr><td>${label}</td><td class="num">${toVisit.toLocaleString()}</td><td class="num">${residence.toLocaleString()}</td><td class="num">${work.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 如果是标签分布格式 {popu_type, tag_value, tag_name} - 合并为一张表
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
    
    // 按到访人数降序排序
    const sortedTags = [...tagMap.entries()].sort((a, b) => b[1]['到访'] - a[1]['到访'])
    
    // 计算总计
    const totals = { '到访': 0, '居住': 0, '工作': 0 }
    for (const [, values] of sortedTags) {
      totals['到访'] += values['到访']
      totals['居住'] += values['居住']
      totals['工作'] += values['工作']
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>标签</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const [tagName, values] of sortedTags) {
      html += `<tr><td>${tagName}</td><td class="num">${values['到访'].toLocaleString()}</td><td class="num">${values['居住'].toLocaleString()}</td><td class="num">${values['工作'].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 如果是每日人流量及停留时长格式 {day_type, day_visit, day_all, stay1, stay2, ...}
  if (firstItem.day_visit !== undefined && firstItem.day_all !== undefined && firstItem.stay1 !== undefined) {
    const dayTypes = { 0: '工作日', 1: '周末' }
    const groups = { '工作日': [], '周末': [], '其他': [] }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const dayType = dayTypes[item.day_type] || '其他'
      if (!groups[dayType]) groups[dayType] = []
      groups[dayType].push(item)
    }
    
    // 定义正确的字段顺序
    const fieldOrder = ['day_visit', 'day_all', 'stay1', 'stay2', 'stay3', 'stay4', 'stay5', 'stay6']
    const fieldLabels = {
      'day_visit': '日均到访人次',
      'day_all': '日均全量人次',
      'stay1': '停留<30分钟',
      'stay2': '停留30-60分钟',
      'stay3': '停留1-2小时',
      'stay4': '停留2-4小时',
      'stay5': '停留4-8小时',
      'stay6': '停留>8小时'
    }
    
    let html = ''
    for (const [dayType, items] of Object.entries(groups)) {
      // 跳过空数据
      if (items.length === 0) continue
      
      // 只显示工作日和周末，不显示"其他"的标题
      const showHeader = dayType !== '其他'
      
      const totalVisit = items.reduce((sum, item) => sum + (item.day_visit || 0), 0)
      const totalAll = items.reduce((sum, item) => sum + (item.day_all || 0), 0)
      
      html += `<div class="pop-group">`
      if (showHeader) {
        html += `<div class="group-header">${dayType} <span class="group-total">到访${totalVisit.toLocaleString()} / 全量${totalAll.toLocaleString()}</span></div>`
      }
      html += `<table class="data-table"><thead><tr><th>指标</th><th>数值</th></tr></thead><tbody>`
      
      for (const field of fieldOrder) {
        if (field in items[0]) {
          const values = items.map(item => item[field] || 0)
          const total = values.reduce((a, b) => a + b, 0)
          html += `<tr><td>${fieldLabels[field] || field}</td><td class="num">${total.toLocaleString()}</td></tr>`
        }
      }
      html += '</tbody></table></div>'
    }
    return html || '<p>暂无数据</p>'
  }
  
  // 如果是每月到达次数分布格式 {month, reach1/reach6, ...}
  // 检测：month 字段 + reach 开头的数字字段
  const hasReachFields = (obj) => {
    if (!obj || typeof obj !== 'object') return false
    const keys = Object.keys(obj)
    // 检查是否有 reach1-6 或 Reach1-6 等变体
    const reachNums = []
    for (const key of keys) {
      const match = key.match(/^reach(\d+)$/i)
      if (match) reachNums.push(parseInt(match[1]))
    }
    return reachNums.length > 0
  }
  
  if (hasReachFields(firstItem)) {
    // 动态检测 reach 字段并按数字排序
    const reachFields = []
    for (const key of Object.keys(firstItem)) {
      const match = key.match(/^reach(\d+)$/i)
      if (match) {
        reachFields.push({ key, num: parseInt(match[1]) })
      }
    }
    reachFields.sort((a, b) => a.num - b.num)
    
    // reach 字段名称映射（按序号）
    const reachLabels = {
      1: '月驻留1次',
      2: '月驻留2-4次',
      3: '月驻留5-10次',
      4: '月驻留11-20次',
      5: '月驻留20次以上'
    }
    
    // 按月排序（如果有 month 字段）
    const hasMonth = data.some(item => item.month !== undefined)
    const sorted = hasMonth ? [...data].sort((a, b) => (a.month || '').localeCompare(b.month || '')) : data
    
    let html = `<div class="pop-group">
      <table class="data-table"><thead><tr>`
    if (hasMonth) {
      html += `<th>月份</th>`
    }
    for (const { key, num } of reachFields) {
      html += `<th>${reachLabels[num] || key}</th>`
    }
    html += `</tr></thead><tbody>`
    
    for (const item of sorted) {
      if (hasMonth) {
        html += `<tr><td>${item.month || '-'}</td>`
      } else {
        html += `<tr>`
      }
      for (const { key } of reachFields) {
        html += `<td class="num">${(item[key] || 0).toLocaleString()}</td>`
      }
      html += '</tr>'
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 如果是小时段格式 {day_type, hour_period, hour_all, hour_visit} - 合并工作日和周末
  if (firstItem.day_type !== undefined && firstItem.hour_period !== undefined) {
    // 按小时分组
    const hourMap = new Map()
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const hour = item.hour_period
      if (!hourMap.has(hour)) {
        hourMap.set(hour, { 工作日: null, 周末: null })
      }
      const entry = hourMap.get(hour)
      if (item.day_type === 0) {
        entry.工作日 = item
      } else if (item.day_type === 1) {
        entry.周末 = item
      }
    }
    
    // 按小时排序
    const sortedHours = [...hourMap.entries()].sort((a, b) => a[0] - b[0])
    
    let html = `<div class="pop-group">
      <table class="data-table"><thead><tr><th>时段</th><th>工作日到访人次</th><th>周末到访人次</th><th>工作日全量人次</th><th>周末全量人次</th></tr></thead><tbody>`
    for (const [hour, entries] of sortedHours) {
      const weekday = entries.工作日
      const weekend = entries.周末
      html += `<tr>
        <td>${hour}点</td>
        <td class="num">${(weekday?.hour_visit || 0).toLocaleString()}</td>
        <td class="num">${(weekend?.hour_visit || 0).toLocaleString()}</td>
        <td class="num">${(weekday?.hour_all || 0).toLocaleString()}</td>
        <td class="num">${(weekend?.hour_all || 0).toLocaleString()}</td>
      </tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 默认数组格式 - 直接显示表格
  let html = `<table class="data-table"><thead><tr>`
  const headers = Object.keys(firstItem)
  for (const h of headers) {
    html += `<th>${h}</th>`
  }
  html += `</tr></thead><tbody>`
  
  for (const item of data.slice(0, 20)) {  // 限制前20行
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

// 格式化其他服务数据（按人群类型分组）- 使用完整字段映射，表格形式
const formatOtherData = (data, serviceCode) => {
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

// 格式化结果显示
const formatResultData = (data) => {
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

  let html = ''
  
  for (const [key, value] of Object.entries(apiResult)) {
    if (key === 'error') continue
    // 跳过排除列表中的服务
    if (excludeServices.includes(key)) continue
    const serviceName = getServiceName(key)
    
    // 1001 服务特殊处理 - 分列对比表格
    if (key === '1001' && typeof value === 'object' && !Array.isArray(value)) {
      html += `<div class="detail-result">
        ${formatP0SData(value)}
      </div>`
      continue
    }
    
    // 数组格式数据（如 1002, 1005 等）
    if (Array.isArray(value)) {
      html += `<div class="detail-result">
        <h4>📊 ${serviceName}</h4>
        ${formatArrayData(value, key)}
      </div>`
      continue
    }
    
    // 其他服务 - 传递服务代码以获取正确的中文标签
    if (typeof value === 'object' && !Array.isArray(value)) {
      html += `<div class="detail-result">
        <h4>📊 ${serviceName}</h4>
        ${formatOtherData(value, key)}
      </div>`
    } else if (typeof value === 'number') {
      html += `<div class="result-item">
        <span class="result-label">${serviceName}</span>
        <span class="result-value">${value.toLocaleString()}</span>
      </div>`
    }
  }
  
  return html || '<p>暂无数据</p>'
}

const handleSubmit = async () => {
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  if (!form.email && !form.newPassword && form.company === userStore.user?.company) {
    ElMessage.warning('请至少修改一项信息')
    return
  }

  loading.value = true

  try {
    const updateData = {}
    if (form.email) {
      updateData.email = form.email
    }
    if (form.newPassword) {
      updateData.password = form.newPassword
    }
    if (form.company !== undefined) {
      updateData.company = form.company
    }

    const { data } = await axios.put('/api/users/me', updateData)

    // 更新本地用户信息
    await userStore.fetchUser()

    ElMessage.success(data.message || '修改成功')

    // 清空密码字段
    form.newPassword = ''
    form.confirmPassword = ''
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '修改失败')
  } finally {
    loading.value = false
  }
}
</script>

<style lang="scss" scoped>
.account-container {
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  background: #f5f7fa;
}

.account-card {
  max-width: 600px;
  margin: 0 auto 20px auto;

  .card-header {
    font-size: 18px;
    font-weight: 600;
  }
}

.account-form {
  padding: 20px 0;
}

.quota-card {
  max-width: 600px;
  margin: 0 auto;
  
  .card-header {
    font-size: 18px;
    font-weight: 600;
  }
}

.quota-content {
  padding: 10px 0;
}

.quota-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 16px;
  padding: 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  color: white;
}

.quota-label {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
}

.quota-value {
  font-size: 48px;
  font-weight: bold;
  
  &.available {
    color: #fff;
  }
}

.quota-unit {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.9);
}

.quota-info {
  margin-bottom: 16px;

  p {
    margin: 8px 0;
    font-size: 13px;
    color: #666;
  }
}

.quota-actions {
  display: flex;
  gap: 16px;
  align-items: center;
}

.history-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: #666;
}

.location-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.coord-icon {
  cursor: pointer;
  color: #909399;
  &:hover {
    color: #409eff;
  }
}

.quota-used {
  color: #f56c6c;
  font-weight: 600;
}

.quota-remaining {
  color: #67c23a;
  font-weight: 600;
}

.history-dialog {
  .el-dialog__body {
    padding: 16px 20px;
  }
}

.history-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 6px;
  align-items: center;

  .filter-count {
    margin-left: auto;
    color: #666;
    font-size: 13px;
  }
}

.detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: #666;
}

.detail-content {
  max-height: 60vh;
  overflow-y: auto;
}

.detail-info {
  padding: 12px;
  background: #f5f7fa;
  border-radius: 6px;
  margin-bottom: 16px;
  
  p {
    margin: 8px 0;
    font-size: 14px;
    color: #666;
  }
}

.detail-result {
  h4 {
    margin: 16px 0 12px 0;
    color: #333;
    font-size: 15px;
  }
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
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* 横向对比表格样式 */
.detail-result :deep(.data-table.cross-table th),
.detail-result :deep(.data-table.cross-table td) {
  text-align: center;
  padding: 10px 16px;
  min-width: 80px;
}

/* 指标名称列右对齐 */
.detail-result :deep(.data-table.cross-table th:first-child),
.detail-result :deep(.data-table.cross-table td:first-child) {
  text-align: right;
  font-weight: 600;
  color: #764ba2;
  min-width: 180px;
}

/* 到访/居住/工作数据列宽度加大 */
.detail-result :deep(.data-table.cross-table th:not(:first-child)),
.detail-result :deep(.data-table.cross-table td:not(:first-child)) {
  min-width: 100px;
}

.detail-result :deep(.data-table.cross-table th) {
  background: linear-gradient(180deg, #f8f5fa, #f0e8f5);
}

.detail-result :deep(.data-table.cross-table .total-row td) {
  background: #f8f5fa;
  font-weight: 600;
  border-top: 2px solid #ddd;
}

/* 单列值样式（合并单元格） */
.detail-result :deep(.data-table td.single-value) {
  text-align: center !important;
  background: linear-gradient(90deg, #f8f5fa, #fff, #f8f5fa);
  font-weight: 600;
  color: #764ba2;
}

.detail-result :deep(.data-table tr.total-row td) {
  background: linear-gradient(90deg, #f8f0ff, #fff, #f8f0ff);
  font-weight: 600;
  color: #764ba2;
}

.group-header {
  font-weight: 600;
  color: #764ba2;
  margin-bottom: 8px;
  padding: 4px 8px;
  background: linear-gradient(90deg, #f8f0ff, #fff);
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
}

.group-total {
  color: #333;
  font-size: 14px;
}

/* 资产预测各部分背景色 */
.asset-section {
  margin-bottom: 12px;
  padding: 8px;
  border-radius: 6px;
}

.asset-section .data-table {
  margin-bottom: 0;
}

.asset-section .group-header {
  margin-bottom: 8px;
}

/* 收入预测 - 蓝色调 */
.asset-income {
  background: linear-gradient(135deg, #e6f3ff 0%, #b3d9ff 100%);
  border: 1px solid #8bc8ff;
}

/* 有车预测 - 浅绿色调 */
.asset-car {
  background: linear-gradient(135deg, #e6ffe6 0%, #b3ffb3 100%);
  border: 1px solid #8cff8c;
}

/* 有房预测 - 浅黄色调 */
.asset-house {
  background: linear-gradient(135deg, #fffbe6 0%, #fff3b3 100%);
  border: 1px solid #ffd966;
}

/* 资产表格表头颜色调整 */
.asset-section :deep(.data-table th) {
  background: rgba(255, 255, 255, 0.6);
}
</style>
