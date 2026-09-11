<template>
  <div class="users-view">
    <div class="users-header">
      <h2>用户管理</h2>
      <div class="header-actions">
        <!-- 配额信息卡片 -->
        <div class="quota-cards">
          <div class="quota-card total">
            <el-tooltip content="从联通采购的累计总次数（含历史采购），不是本次/本批采购量" placement="top">
              <span class="label">累计总配额</span>
            </el-tooltip>
            <span class="value">{{ quotaInfo.initialQuota }}</span>
            <el-button type="primary" link size="small" @click="showQuotaDialog">
              <el-icon><Edit /></el-icon>
            </el-button>
            <el-tooltip content="查看历次向联通采购的明细" placement="top">
              <el-button type="primary" link size="small" class="purchase-link" @click="showPurchaseDialog">采购履历</el-button>
            </el-tooltip>
          </div>
          <div class="quota-card remaining">
            <span class="label">当前剩余配额</span>
            <span class="value">{{ quotaInfo.remainingQuota }}</span>
          </div>
          <div class="quota-card api">
            <span class="label">API开放页已占</span>
            <span class="value">{{ quotaInfo.apiAllocatedQuota }}</span>
          </div>
          <div class="quota-card pool">
            <span class="label">全池剩余可分配</span>
            <span class="value">{{ quotaInfo.poolAvailableQuota }}</span>
          </div>
          <div class="quota-card consumed">
            <span class="label">消费总次数</span>
            <span class="value">{{ totalConsumed }}</span>
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
        <el-table-column prop="username" label="用户名" min-width="120">
          <template #default="{ row }">
            <span v-if="row.role === 'vip'">👑 </span>{{ row.username }}
          </template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱" min-width="180" />
        <el-table-column prop="company" label="公司" min-width="150" />
        <el-table-column prop="role" label="角色" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'danger' : row.role === 'vip' ? undefined : row.role === 'trial' ? 'primary' : 'info'" :class="{ 'vip-role-tag': row.role === 'vip' }">
              {{ row.role === 'admin' ? '管理员' : row.role === 'vip' ? 'VIP用户' : row.role === 'trial' ? 'VIP试用' : '普通用户' }}
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
        <el-table-column prop="created_at" label="注册时间" width="110">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column prop="vip_until" label="VIP到期日" width="110" align="center">
          <template #default="{ row }">
            <span v-if="row.role === 'vip' && row.vip_until" :class="{ 'vip-expiring': isVipExpiring(row), 'vip-expired': isVipExpired(row) }">
              {{ isVipExpiring(row) ? '⏰ ' : isVipExpired(row) ? '❌ ' : '' }}{{ formatDate(row.vip_until) }}
            </span>
            <span v-else style="color: #c0c4cc;">—</span>
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
            <el-option label="VIP试用" value="trial" />
            <el-option label="VIP用户" value="vip" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.role === 'vip' || form.role === 'trial'" label="VIP到期">
          <div style="width: 100%;">
            <div class="quota-tip" style="color: #e6a23c;">{{ form.role === 'trial' ? '🎁 VIP 试用自保存之日起 30 天，到期后自动恢复为普通用户' : '👑 自保存之日起自动续期 1 年（管理员未将其改为普通用户则持续有效）' }}</div>
            <div v-if="form.vipUntilText" style="font-size: 12px; color: #909399; margin-top: 4px;">当前 VIP 到期日：{{ form.vipUntilText }}</div>
          </div>
        </el-form-item>
        <el-form-item v-if="isEdit" label="剩余次数">
          <el-input-number v-model="form.remaining" :min="0" :max="9999" placeholder="输入用户新的剩余次数" style="width: 100%" />
          <div class="quota-tip">
            <div>当前剩余次数: {{ form.remaining }}</div>
            <div>已使用次数: {{ form.usedQuota }}</div>
            <div>系统剩余可分配(全池): {{ quotaInfo.poolAvailableQuota }} <span style="color:#909399;">（已扣除 API 开放页占用 {{ quotaInfo.apiAllocatedQuota }} 次）</span></div>
            <div style="color: #67c23a; margin-top: 4px;">输入新的剩余次数，系统将自动换算为配额总数</div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>

    <!-- 编辑总配额对话框 -->
    <el-dialog v-model="quotaDialogVisible" title="设置累计总配额" width="460px">
      <el-form>
        <el-form-item label="累计总配额">
          <el-input-number v-model="editTotalQuota" :min="0" :max="999999" style="width: 100%" />
          <div class="quota-tip">从联通公司采购的<b>累计</b>总次数（含历史采购）。本次若新买了 N 次，请填「原值 + N」</div>
        </el-form-item>
        <div class="quota-preview" :class="previewDeltaState">
          <div class="qp-row">
            <span class="qp-label">保存后「当前剩余配额」</span>
            <span class="qp-value">{{ previewRemaining }}</span>
            <span class="qp-delta">{{ previewDeltaText }}</span>
          </div>
          <div class="qp-hint">{{ previewHint }}</div>
        </div>
        <el-form-item label="采购备注" v-if="previewDelta > 0" style="margin-top: 14px;">
          <el-input v-model="purchaseNote" maxlength="60" show-word-limit placeholder="选填，如「第 2 批 · 2400 次 · 单价 xx 元」" />
          <div class="quota-tip">本次将记入「采购履历」，便于日后对账</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quotaDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="quotaSaving" @click="handleSaveQuota">确定</el-button>
      </template>
    </el-dialog>

    <!-- 配额采购履历对话框（v1.13.115） -->
    <el-dialog v-model="purchaseDialogVisible" title="配额采购履历" width="760px">
      <div class="purchase-summary" v-if="purchaseSummary">
        <div class="ps-item">
          <span class="ps-label">累计总配额</span>
          <span class="ps-value">{{ purchaseSummary.initialQuota }}</span>
        </div>
        <div class="ps-item">
          <span class="ps-label">已记录采购</span>
          <span class="ps-value">{{ purchaseSummary.totalAmount }}</span>
        </div>
        <div class="ps-item">
          <span class="ps-label">采购笔数</span>
          <span class="ps-value">{{ purchaseSummary.count }}</span>
        </div>
        <div class="ps-item baseline" v-if="purchaseSummary.baselineAmount > 0">
          <el-tooltip content="累计总配额中，早于「采购履历」功能上线、无明细记录的部分" placement="top">
            <span class="ps-label">上线前已有</span>
          </el-tooltip>
          <span class="ps-value">{{ purchaseSummary.baselineAmount }}</span>
        </div>
      </div>

      <div class="purchase-table-wrap" v-loading="purchaseLoading">
        <el-table v-if="purchaseRows.length > 0" :data="purchaseRows" size="small" max-height="380" border>
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column prop="created_at" label="时间" width="160" />
          <el-table-column prop="amount" label="本次采购" width="110" align="center">
            <template #default="{ row }">
              <el-tag type="success">+{{ row.amount }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="剩余变化" width="150" align="center">
            <template #default="{ row }">
              <span class="qrange">{{ row.quota_before }}</span>
              <span class="qarrow">→</span>
              <span class="qrange after">{{ row.quota_after }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="note" label="备注" min-width="140">
            <template #default="{ row }">
              <span v-if="row.note">{{ row.note }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column prop="created_by_name" label="操作人" width="110" align="center">
            <template #default="{ row }">
              {{ row.created_by_name || '—' }}
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else :description="purchaseLoading ? '加载中…' : '暂无采购记录（功能上线前的采购无明细）'" style="margin: 24px 0" />
      </div>

      <template #footer>
        <el-button @click="purchaseDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 月度使用统计对话框 -->
    <el-dialog v-model="monthlyStatsDialogVisible" width="800px" class="dialog-fancy">
      <template #header>
        <div class="dialog-header-fancy">
          <span class="dhf-icon" style="background:#e6f1fb;">📊</span>
          <div>
            <div class="dhf-title">月度使用统计</div>
            <div class="dhf-sub">用户月度 token 与配额使用</div>
          </div>
        </div>
      </template>
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
const originalRemaining = ref(0) // 编辑前原始剩余次数
const formRef = ref(null)
const filterCompany = ref('')

// 配额相关
const quotaInfo = ref({
  initialQuota: 0,        // 初始总配额
  remainingQuota: 0,      // 当前剩余配额（读 admin_quota.remaining_quota 列，全口径实时）
  allocatedQuota: 0,      // 已分配给用户页的额度
  availableQuota: 0,      // 仅用户页口径剩余可分配（保留字段）
  apiAllocatedQuota: 0,   // API 开放页已分配（真实模式余额合计，mock 不占池）
  poolAvailableQuota: 0   // 全池剩余可分配 = 总配额 − 用户页已分配 − API页已分配（分配校验权威）
})
// 所有用户消费次数的总和
const totalConsumed = computed(() =>
  users.value.reduce((sum, u) => sum + (u.usedQuota || 0), 0)
)
const quotaDialogVisible = ref(false)
const quotaSaving = ref(false)
const editTotalQuota = ref(0)
const purchaseNote = ref('')

// 采购履历（v1.13.115）—— 池级采购台账 quota_purchases 的只读视图
const purchaseDialogVisible = ref(false)
const purchaseLoading = ref(false)
const purchaseRows = ref([])
const purchaseSummary = ref(null)

// 弹窗实时预览：与后端 PUT /users/quota 完全同一算法（避免"前端允许提交、后端结果不符"的割裂）
//   后端 users.js：newRemaining = max(0, currentRemaining + (输入值 − currentInitial))
const previewDelta = computed(() =>
  (Number(editTotalQuota.value) || 0) - (quotaInfo.value.initialQuota || 0)
)
const previewRemaining = computed(() =>
  Math.max(0, (quotaInfo.value.remainingQuota || 0) + previewDelta.value)
)
const previewDeltaState = computed(() =>
  previewDelta.value > 0 ? 'up' : (previewDelta.value < 0 ? 'down' : 'flat')
)
const previewDeltaText = computed(() => {
  const d = previewDelta.value
  if (d > 0) return `+${d}`
  if (d < 0) return `${d}`
  return '不变'
})
const previewHint = computed(() => {
  const d = previewDelta.value
  if (d > 0) return `本次新增 ${d} 次，剩余同步 +${d}`
  if (d < 0) return `⚠ 输入值小于当前累计值，保存后剩余将减少 ${Math.abs(d)} 次`
  return '⚠ 输入值等于当前累计值，保存后剩余不变；若刚采购了新配额，请填「原值 + 本次采购量」'
})

const form = reactive({
  username: '',
  email: '',
  company: '',
  password: '',
  role: 'user',
  quota: 0,
  usedQuota: 0,
  remaining: 0,
  vipUntilText: null
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
  if (isNaN(date.getTime())) return String(dateStr).slice(0, 10)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// VIP 是否即将到期（30 天内；含 VIP 试用）
const isVipExpiring = (row) => {
  if ((row.role !== 'vip' && row.role !== 'trial') || !row.vip_until) return false
  const until = new Date(String(row.vip_until) + 'T23:59:59')
  const now = new Date()
  const days = Math.ceil((until - now) / 86400000)
  return days >= 0 && days <= 30
}
const isVipExpired = (row) => {
  if ((row.role !== 'vip' && row.role !== 'trial') || !row.vip_until) return false
  return new Date(String(row.vip_until) + 'T23:59:59') < new Date()
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
  purchaseNote.value = ''
  quotaDialogVisible.value = true
}

// 保存总配额
const handleSaveQuota = async () => {
  quotaSaving.value = true
  try {
    const data = await api.put('/users/quota', {
      totalQuota: editTotalQuota.value,
      note: purchaseNote.value
    })
    quotaInfo.value = data.quotaInfo
    quotaDialogVisible.value = false
    const added = data.purchaseRecorded || 0
    ElMessage.success(added > 0 ? `总配额已更新，本次采购 ${added} 次已记入履历` : '总配额已更新')
    // 若弹窗开着，同步刷新履历列表
    if (purchaseDialogVisible.value) loadPurchases()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '更新失败')
  } finally {
    quotaSaving.value = false
  }
}

// 加载采购履历
const loadPurchases = async () => {
  purchaseLoading.value = true
  try {
    const data = await api.get('/users/quota/purchases')
    purchaseRows.value = data.purchases || []
    purchaseSummary.value = data.summary || null
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '获取采购履历失败')
    purchaseRows.value = []
    purchaseSummary.value = null
  } finally {
    purchaseLoading.value = false
  }
}

// 显示采购履历对话框
const showPurchaseDialog = () => {
  purchaseDialogVisible.value = true
  loadPurchases()
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
  // 显示剩余次数（admin 显示 0）
  const editRemaining = row.role === 'admin' ? 0 : (row.remainingQuota ?? 0)
  Object.assign(form, {
    username: row.username,
    email: row.email,
    company: row.company || '',
    password: '',
    role: row.role,
    quota: row.quota || 0,
    usedQuota: row.usedQuota || 0,
    remaining: editRemaining,
    vipUntilText: row.vip_until ? formatDate(row.vip_until) : null
  })
  originalRemaining.value = editRemaining
  dialogVisible.value = true
}

const handleSave = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  if (isEdit.value) {
    const newRemaining = form.remaining || 0
    const oldRemaining = originalRemaining.value
    const diff = newRemaining - oldRemaining
    if (diff !== 0) {
      const action = diff > 0 ? '增加' : '减少'
      try {
        await ElMessageBox.confirm(
          `本次${action} ${Math.abs(diff)} 次，是否继续？`,
          '确认修改',
          { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
        )
      } catch {
        return // 用户取消
      }
    }
  }

  saving.value = true
  try {
    if (isEdit.value) {
      // 将输入"剩余次数"作为配额总数提交（usedQuota已在purchases表中独立记录，不重复计算）
      const totalQuota = (form.remaining || 0)
      const updateData = { email: form.email, role: form.role, company: form.company, quota: totalQuota }
      // VIP 到期时间由后端自动计算（设为 VIP → 自保存日起续期 1 年；改为非 VIP → 清除）
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

        .label { color: #409eff; cursor: help; border-bottom: 1px dashed currentColor; }
        .value { color: #409eff; font-weight: bold; font-size: 18px; }
      }

      &.api {
        border-color: #b37feb;
        background: linear-gradient(135deg, #f5f0ff 0%, #efe8ff 100%);

        .label { color: #8a5cd6; }
        .value { color: #8a5cd6; font-weight: bold; font-size: 18px; }
      }

      &.pool {
        border-color: #67c23a;
        background: linear-gradient(135deg, #f0f9eb 0%, #e8f5e0 100%);

        .label { color: #67c23a; }
        .value { color: #67c23a; font-weight: bold; font-size: 18px; }
      }

      &.remaining {
        border-color: #909399;
        background: linear-gradient(135deg, #f4f4f5 0%, #f9f9fa 100%);

        .label { color: #909399; }
        .value { color: #909399; font-weight: bold; font-size: 18px; }
      }

      &.consumed {
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

  b { color: #606266; }
}

/* 累计总配额弹窗：保存后的剩余配额实时预览（A+B 改动） */
.quota-preview {
  padding: 10px 12px;
  border-radius: 8px;
  background: #f4f4f5;
  border: 1px solid #dcdfe6;
  line-height: 1.5;

  .qp-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }

  .qp-label { font-size: 13px; color: #606266; }
  .qp-value { font-size: 20px; font-weight: bold; color: #303133; }
  .qp-delta { font-size: 13px; color: #909399; }
  .qp-hint { margin-top: 4px; font-size: 12px; color: #909399; }

  &.up {
    background: #f0f9eb;
    border-color: #67c23a;

    .qp-value { color: #67c23a; }
    .qp-delta { color: #529b2e; }
    .qp-hint { color: #529b2e; }
  }

  &.down {
    background: #fef0f0;
    border-color: #f56c6c;

    .qp-value { color: #f56c6c; }
    .qp-delta { color: #c45656; }
    .qp-hint { color: #c45656; }
  }

  &.flat {
    background: #fdf6ec;
    border-color: #e6a23c;

    .qp-delta { color: #e6a23c; }
    .qp-hint { color: #b88230; }
  }
}

/* VIP 到期提醒：30 天内橙色，已过期红色 */
.vip-expiring { color: #e6a23c; font-weight: 600; }
.vip-expired { color: #f56c6c; font-weight: 600; }

/* VIP 角色：紫色 */
.vip-role-tag {
  background: #f3e8ff;
  border-color: #d8b4fe;
  color: #7c3aed;
}

/* ===== 配额采购履历（v1.13.115）===== */
.purchase-link {
  font-size: 12px !important;
  padding: 0 2px !important;
  height: auto !important;
}

.purchase-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.purchase-summary .ps-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 96px;
  padding: 8px 14px;
  border-radius: 8px;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
}

.purchase-summary .ps-item.baseline {
  background: #fdf6ec;
  border-color: #f3d19e;
}

.purchase-summary .ps-label {
  font-size: 12px;
  color: #909399;
}

.purchase-summary .ps-item.baseline .ps-label {
  color: #b88230;
  cursor: help;
  border-bottom: 1px dashed currentColor;
}

.purchase-summary .ps-value {
  font-size: 18px;
  font-weight: bold;
  color: #303133;
}

.purchase-summary .ps-item.baseline .ps-value {
  color: #b88230;
}

.purchase-table-wrap {
  min-height: 120px;
}

.qrange {
  color: #909399;
}

.qrange.after {
  color: #67c23a;
  font-weight: 600;
}

.qarrow {
  margin: 0 6px;
  color: #c0c4cc;
}

.muted {
  color: #c0c4cc;
}
</style>
