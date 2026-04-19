<template>
  <div class="users-view">
    <div class="users-header">
      <h2>用户管理</h2>
      <div class="header-actions">
        <!-- 配额信息卡片 -->
        <div class="quota-cards">
          <div class="quota-card total">
            <span class="label">初始总配额</span>
            <span class="value">{{ quotaInfo.initialQuota }}</span>
            <el-button type="primary" link size="small" @click="showQuotaDialog">
              <el-icon><Edit /></el-icon>
            </el-button>
          </div>
          <div class="quota-card remaining">
            <span class="label">当前剩余配额</span>
            <span class="value">{{ quotaInfo.remainingQuota }}</span>
          </div>
          <div class="quota-card available">
            <span class="label">剩余可分配次数</span>
            <span class="value">{{ quotaInfo.availableQuota }}</span>
          </div>
        </div>
        <el-button type="info" @click="showMonthlyStatsDialog">
          📊 月度统计
        </el-button>
        <el-select
          v-model="filterCompany"
          placeholder="按公司筛选"
          clearable
          filterable
          style="width: 200px; margin-right: 12px"
          @change="handleFilterChange"
        >
          <el-option
            v-for="company in companyList"
            :key="company"
            :label="company"
            :value="company"
          />
        </el-select>
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>添加用户
        </el-button>
      </div>
    </div>

    <!-- 用户表格 -->
    <div class="users-table">
      <div class="table-title">用户列表</div>
      <el-table
        :data="users"
        v-loading="loading"
        border
        stripe
        style="width: 100%"
      >
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="email" label="邮箱" min-width="180" />
        <el-table-column prop="company" label="公司" min-width="150" />
        <el-table-column prop="role" label="角色" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'danger' : 'success'">
              {{ row.role === 'admin' ? '管理员' : '普通用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="usedQuota" label="消费次数" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="warning">{{ row.usedQuota ?? 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remainingQuota" label="剩余次数" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="info">{{ row.remainingQuota ?? 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="注册时间" width="160">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleEdit(row)">
              <el-icon><Edit /></el-icon>
            </el-button>
            <el-button type="warning" link @click="handleResetPassword(row)">
              <el-icon><RefreshRight /></el-icon>
            </el-button>
            <el-button
              type="danger"
              link
              :disabled="row.id === currentUserId"
              @click="handleDelete(row)"
            >
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 添加/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑用户' : '添加用户'"
      width="500px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" :disabled="isEdit" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="请输入邮箱" />
        </el-form-item>
        <el-form-item label="公司" prop="company">
          <el-input v-model="form.company" placeholder="请输入公司名称" />
        </el-form-item>
        <el-form-item v-if="!isEdit" label="密码" prop="password">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" show-password />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" placeholder="请选择角色" style="width: 100%">
            <el-option label="普通用户" value="user" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="isEdit" label="剩余次数">
          <el-input-number v-model="form.quota" :min="0" :max="9999" placeholder="分配联通人口数据配额" style="width: 100%" />
          <div class="quota-tip">剩余可分配次数: {{ quotaInfo.availableQuota }}</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>

    <!-- 编辑总配额对话框 -->
    <el-dialog v-model="quotaDialogVisible" title="设置初始总配额" width="400px">
      <el-form>
        <el-form-item label="初始总配额">
          <el-input-number v-model="editTotalQuota" :min="0" :max="999999" style="width: 100%" />
          <div class="quota-tip">从联通公司购买的总配额次数，设置后将同步调整"当前剩余配额"</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quotaDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="quotaSaving" @click="handleSaveQuota">确定</el-button>
      </template>
    </el-dialog>

    <!-- 月度使用统计对话框 -->
    <el-dialog v-model="monthlyStatsDialogVisible" title="📊 月度使用统计" width="800px">
      <div class="stats-filters">
        <el-date-picker
          v-model="statsMonth"
          type="month"
          placeholder="选择月份"
          format="YYYY-MM"
          value-format="YYYY-MM"
          style="width: 140px; margin-right: 12px"
        />
        <el-select
          v-model="statsCompany"
          placeholder="选择公司"
          clearable
          filterable
          style="width: 180px; margin-right: 12px"
        >
          <el-option
            v-for="company in companyList"
            :key="company"
            :label="company"
            :value="company"
          />
        </el-select>
        <el-button type="primary" @click="fetchMonthlyStats" :loading="statsLoading">
          查询
        </el-button>
      </div>
      <div class="stats-summary" v-if="monthlyStats.length > 0" style="margin-top: 16px">
        <div class="summary-item">
          <span class="label">用户总数：</span>
          <span class="value">{{ statsSummary.totalUsers }}</span>
        </div>
        <div class="summary-item highlight">
          <span class="label">当月使用总次数：</span>
          <span class="value">{{ statsSummary.totalMonthlyUsed }}</span>
        </div>
      </div>
      <el-table
        v-if="monthlyStats.length > 0"
        :data="monthlyStats"
        v-loading="statsLoading"
        border
        stripe
        style="width: 100%; margin-top: 16px"
      >
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="company" label="公司" min-width="150" />
        <el-table-column prop="total_quota" label="已分配次数" width="110" align="center">
          <template #default="{ row }">
            {{ row.total_quota ?? 0 }}
          </template>
        </el-table-column>
        <el-table-column prop="monthly_used" label="当月使用次数" width="120" align="center">
          <template #default="{ row }">
            <el-tag type="warning">{{ row.monthly_used ?? 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="monthly_remaining" label="当月剩余次数" width="120" align="center">
          <template #default="{ row }">
            <el-tag type="info">{{ row.monthly_remaining ?? 0 }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="!statsLoading" description="请选择月份后点击查询" style="margin: 40px 0" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, RefreshRight } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import api from '@/utils/api'

const userStore = useUserStore()

const users = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const editingId = ref(null)
const formRef = ref(null)
const filterCompany = ref('')

// 配额相关
const quotaInfo = ref({
  initialQuota: 0,    // 初始总配额
  remainingQuota: 0,  // 当前剩余配额
  allocatedQuota: 0,  // 已分配
  availableQuota: 0   // 剩余可分配次数
})
const quotaDialogVisible = ref(false)
const quotaSaving = ref(false)
const editTotalQuota = ref(0)

const form = reactive({
  username: '',
  email: '',
  company: '',
  password: '',
  role: 'user',
  quota: 0
})

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度为 3-20 个字符', trigger: 'blur' }
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 个字符', trigger: 'blur' }
  ],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }]
}

const currentUserId = computed(() => userStore.user?.id)

// 公司列表（去重）
const companyList = computed(() => {
  const companies = users.value
    .map(u => u.company)
    .filter(c => c && c.trim())
  return [...new Set(companies)]
})

// 月度统计相关
const monthlyStatsDialogVisible = ref(false)
const statsMonth = ref('')
const statsCompany = ref('')
const statsLoading = ref(false)
const monthlyStats = ref([])
const statsSummary = ref({
  totalUsers: 0,
  totalMonthlyUsed: 0
})

const handleFilterChange = () => {
  fetchUsers()
}

// 打开月度统计对话框
const showMonthlyStatsDialog = () => {
  statsMonth.value = ''
  statsCompany.value = ''
  monthlyStats.value = []
  monthlyStatsDialogVisible.value = true
}

// 获取月度统计
const fetchMonthlyStats = async () => {
  if (!statsMonth.value) {
    ElMessage.warning('请先选择月份')
    return
  }
  statsLoading.value = true
  try {
    const params = { month: statsMonth.value }
    if (statsCompany.value) {
      params.company = statsCompany.value
    }
    const data = await api.get('/users/monthly-stats', { params })
    monthlyStats.value = data.users || []
    statsSummary.value = data.summary || { totalUsers: 0, totalMonthlyUsed: 0 }
  } catch (error) {
    ElMessage.error('获取月度统计失败')
    monthlyStats.value = []
  } finally {
    statsLoading.value = false
  }
}


const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN')
}

const fetchUsers = async () => {
  loading.value = true
  try {
    const params = {}
    if (filterCompany.value) {
      params.company = filterCompany.value
    }
    const data = await api.get('/users', { params })
    users.value = data.users
    // 更新配额信息
    if (data.quotaInfo) {
      quotaInfo.value = data.quotaInfo
    }
  } catch (error) {
    ElMessage.error('获取用户列表失败')
  } finally {
    loading.value = false
  }
}

// 显示编辑总配额对话框
const showQuotaDialog = () => {
  editTotalQuota.value = quotaInfo.value.initialQuota
  quotaDialogVisible.value = true
}

// 保存总配额
const handleSaveQuota = async () => {
  quotaSaving.value = true
  try {
    const data = await api.put('/users/quota', { totalQuota: editTotalQuota.value })
    quotaInfo.value = data.quotaInfo
    quotaDialogVisible.value = false
    ElMessage.success('总配额已更新')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '更新失败')
  } finally {
    quotaSaving.value = false
  }
}

const showAddDialog = () => {
  isEdit.value = false
  editingId.value = null
  Object.assign(form, {
    username: '',
    email: '',
    company: '',
    password: '',
    role: 'user',
    quota: 0
  })
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  editingId.value = row.id
  // 管理员账号的 quota 字段显示为 0（配额从 admin_quota 表管理）
  const editQuota = row.role === 'admin' ? 0 : (row.quota ?? 0)
  Object.assign(form, {
    username: row.username,
    email: row.email,
    company: row.company || '',
    password: '',
    role: row.role,
    quota: editQuota
  })
  dialogVisible.value = true
}

const handleSave = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    if (isEdit.value) {
      const updateData = { email: form.email, role: form.role, company: form.company, quota: form.quota }
      if (form.password) {
        updateData.password = form.password
      }
      const data = await api.put(`/users/${editingId.value}`, updateData)
      ElMessage.success('更新成功')
      // 更新配额信息
      if (data.quotaInfo) {
        quotaInfo.value = data.quotaInfo
      }
    } else {
      await api.post('/users', { ...form })
      ElMessage.success('添加成功')
    }
    dialogVisible.value = false
    fetchUsers()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '操作失败')
  } finally {
    saving.value = false
  }
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要删除用户「${row.username}」吗？`, '提示', {
      type: 'warning'
    })
    await api.delete(`/users/${row.id}`)
    ElMessage.success('删除成功')
    fetchUsers()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }
}

const handleResetPassword = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要重置用户「${row.username}」的密码吗？重置后密码为「123456」。`, '重置密码', {
      type: 'warning',
      confirmButtonText: '确定重置',
      cancelButtonText: '取消'
    })
    await api.post(`/users/${row.id}/reset-password`)
    ElMessage.success('密码已重置为 123456')
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '重置失败')
    }
  }
}

onMounted(() => {
  fetchUsers()
})
</script>

<style lang="scss" scoped>
.users-view {
  height: 100%;
  padding: 20px;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.users-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;

  h2 {
    margin: 0;
    font-size: 18px;
    color: #333;
  }

  .header-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .quota-cards {
    display: flex;
    gap: 16px;
    margin-right: auto;

    .quota-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 8px;
      background: white;
      border: 1px solid #dcdfe6;

      &.total {
        border-color: #409eff;
        background: linear-gradient(135deg, #ecf5ff 0%, #f0f7ff 100%);

        .label { color: #409eff; }
        .value { color: #409eff; font-weight: bold; font-size: 18px; }
      }

      &.available {
        border-color: #67c23a;
        background: linear-gradient(135deg, #f0f9eb 0%, #e8f5e0 100%);

        .label { color: #67c23a; }
        .value { color: #67c23a; font-weight: bold; font-size: 18px; }
      }

      &.remaining {
        border-color: #e6a23c;
        background: linear-gradient(135deg, #fdf6ec 0%, #fef0e0 100%);

        .label { color: #e6a23c; }
        .value { color: #e6a23c; font-weight: bold; font-size: 18px; }
      }

      .label {
        font-size: 13px;
        white-space: nowrap;
      }

      .value {
        min-width: 40px;
        text-align: center;
      }
    }
  }
}

.users-table {
  flex: 1;
  background: white;
  border-radius: 8px;
  padding: 15px;
  overflow: auto;

  .table-title {
    font-size: 15px;
    font-weight: 600;
    color: #333;
    margin-bottom: 12px;
  }
}

.stats-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.stats-summary {
  display: flex;
  gap: 24px;
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 6px;

  .summary-item {
    display: flex;
    align-items: center;
    font-size: 14px;

    .label {
      color: #606266;
    }

    .value {
      font-weight: 600;
      color: #303133;
    }

    &.highlight .value {
      color: #e6a23c;
      font-size: 16px;
    }
  }
}

.quota-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}
</style>
