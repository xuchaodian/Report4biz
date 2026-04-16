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
      <div v-if="historyLoading" class="history-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载中...</span>
      </div>
      <el-table
        v-else
        :data="historyList"
        stripe
        border
        style="width: 100%"
        :max-height="500"
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
          <h4>📊 查询数据</h4>
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
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { Loading, Location } from '@element-plus/icons-vue'
import axios from 'axios'

const userStore = useUserStore()
const formRef = ref(null)
const loading = ref(false)
const quotaLoading = ref(false)

// 购买履历相关
const historyDialogVisible = ref(false)
const historyLoading = ref(false)
const historyList = ref([])

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
  } catch (e) {
    console.error('加载详情失败:', e)
    ElMessage.error('加载详情失败')
  } finally {
    detailLoading.value = false
  }
}

// 格式化结果显示
const formatResultData = (data) => {
  if (!data) return '<p>暂无数据</p>'
  
  const apiResult = data.apiResult
  if (!apiResult) return '<p>暂无数据</p>'
  
  // 如果是错误信息
  if (apiResult.error) {
    return `<p style="color:red;">❌ ${apiResult.error}</p>`
  }
  
  let html = ''
  if (typeof apiResult === 'object' && apiResult !== null) {
    for (const [key, value] of Object.entries(apiResult)) {
      if (key === 'error') continue
      const label = getServiceName(key)
      const displayValue = formatDetailValue(value)
      html += `<div class="result-item">
        <span class="result-label">${label}（${key}）</span>
        <span class="result-value">${displayValue}</span>
      </div>`
    }
  }
  
  return html || '<p>暂无数据</p>'
}

// 格式化单个字段值
const formatDetailValue = (value) => {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    // 检查是否是简单对象
    if (value && typeof value.total === 'number') return String(value.total)
    if (value && typeof value.value === 'number') return String(value.value)
    if (value && typeof value.count === 'number') return String(value.count)
    // 数组且第一个元素是坐标数组
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

// 获取服务名称
const getServiceName = (code) => {
  const names = {
    '1001': '全量人口', '1002': '居住人口', '1003': '工作人口', '1004': '到访人口',
    '1005': '每小时段人口流量', '1006': '人口属性分析', '1007': '消费水平分布',
    '1008': '年龄段分布', '1009': '性别比例', '1010': '收入水平分布',
    '1011': '家庭状况分布', '1012': '出行方式分布', '1013': '居住地分布',
    '1014': '工作地分布', '1015': '工作日/周末对比', '1016': '日均人流热度',
    '1017': '月均人流热度', '1018': '月到访频次', '1019': '市外来源分布',
    '1020': '省内来源分布', '1021': '市内来源分布', '1022': '停留时长分布',
    '1023': '全量人口(全)'
  }
  return names[code] || code
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
</style>
