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
      </el-table>
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

const handleSubmit = async () => {
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  if (!form.email && !form.newPassword) {
    ElMessage.warning('请至少填写邮箱或新密码')
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
</style>
