<template>
  <div class="resale-view">
    <div class="page-header">
      <div>
        <h2 style="margin:0;font-size:18px;">🔑 API开放</h2>
        <p style="margin:4px 0 0;font-size:13px;color:#909399;">
          第三方调用联通人口数据（/api/v1/population）的 API Key 管理，按次计费 60 元/次，最低 100 次起充
        </p>
      </div>
      <el-button type="primary" @click="openCreateDialog">➕ 创建客户</el-button>
    </div>

    <!-- 配额池信息（与用户页共用同一批次上游配额） -->
    <div v-if="poolInfo" class="pool-banner">
      <div class="pool-item">
        <span class="pool-label">上游总配额</span>
        <span class="pool-value">{{ poolInfo.poolTotal }}</span>
      </div>
      <div class="pool-item">
        <span class="pool-label">用户页已分配</span>
        <span class="pool-value">{{ poolInfo.allocatedUsers }}</span>
      </div>
      <div class="pool-item">
        <span class="pool-label">API页已分配</span>
        <span class="pool-value">{{ poolInfo.allocatedApi }}</span>
      </div>
      <div class="pool-item">
        <span class="pool-label">测试模式余额</span>
        <span class="pool-value" style="color:#909399;">{{ poolInfo.mockBalance }}</span>
      </div>
      <div class="pool-item">
        <span class="pool-label">剩余可分配</span>
        <span class="pool-value" :style="{ color: poolInfo.available <= 100 ? '#f56c6c' : '#67c23a', fontWeight: 600 }">{{ poolInfo.available }}</span>
      </div>
      <span class="pool-tip">⚠️ 与用户页共用同一批次配额（测试模式不占用）</span>
    </div>

    <!-- 客户列表 -->
    <el-table :data="keyList" stripe border style="width:100%" v-loading="loading">
      <el-table-column label="ID" width="60" align="center">
        <template #default="{ row }">{{ row.id }}</template>
      </el-table-column>
      <el-table-column label="公司名称" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.company_name }}
          <el-tag v-if="row.mock" type="info" size="small" style="margin-left:4px;">测试</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="API Key" min-width="240">
        <template #default="{ row }">
          <el-input :model-value="row.api_key" readonly size="small" class="key-input">
            <template #append>
              <el-button @click="copyKey(row.api_key)">复制</el-button>
            </template>
          </el-input>
        </template>
      </el-table-column>
      <el-table-column label="剩余次数" width="110" align="center">
        <template #default="{ row }">
          <span :style="{ fontWeight: 600, color: row.balance <= 10 ? '#f56c6c' : '#303133' }">{{ row.balance }}</span>
        </template>
      </el-table-column>
      <el-table-column label="已用次数" width="100" align="center">
        <template #default="{ row }">{{ row.used ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
            {{ row.status === 'active' ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click="openRechargeDialog(row)">充值</el-button>
          <el-button type="warning" link size="small" @click="openUsageDialog(row)">用量</el-button>
          <el-button :type="row.status === 'active' ? 'danger' : 'success'" link size="small" @click="toggleStatus(row)">
            {{ row.status === 'active' ? '停用' : '启用' }}
          </el-button>
          <el-button type="danger" link size="small" @click="deleteKey(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 创建客户对话框 -->
    <el-dialog v-model="createDialogVisible" title="➕ 创建转售客户" width="460px" :close-on-click-modal="false">
      <el-form label-width="90px">
        <el-form-item label="公司名称" required>
          <el-input v-model="createForm.companyName" placeholder="如：某某小程序科技有限公司" maxlength="50" />
        </el-form-item>
        <el-form-item label="初始次数">
          <el-input-number v-model="createForm.initialBalance" :min="0" :step="100" style="width:200px" />
          <span style="margin-left:8px;font-size:12px;color:#909399;">可留 0，后续充值</span>
        </el-form-item>
        <el-form-item label="测试模式">
          <el-switch v-model="createForm.mock" />
          <span style="margin-left:8px;font-size:12px;color:#909399;">测试模式返回模拟数据，不调上游、不扣次数</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 充值对话框 -->
    <el-dialog v-model="rechargeDialogVisible" title="💰 充值次数" width="460px" :close-on-click-modal="false">
      <div style="margin-bottom:14px;font-size:13px;color:#606266;">
        为 <b>{{ currentClient?.company_name }}</b> 充值（当前余额 {{ currentClient?.balance }} 次）
      </div>
      <el-form label-width="90px">
        <el-form-item label="充值次数" required>
          <el-input-number v-model="rechargeAmount" :min="100" :step="100" style="width:200px" />
          <span style="margin-left:8px;font-size:12px;color:#909399;">最低 100 次起充</span>
        </el-form-item>
        <el-form-item label="应付金额">
          <span style="font-size:18px;font-weight:600;color:#f56c6c;">¥ {{ (rechargeAmount || 0) * 60 }}</span>
          <span style="margin-left:8px;font-size:12px;color:#909399;">60 元/次</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rechargeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="recharging" @click="handleRecharge">确认充值</el-button>
      </template>
    </el-dialog>

    <!-- 用量明细对话框 -->
    <el-dialog v-model="usageDialogVisible" width="720px" class="dialog-fancy" :close-on-click-modal="false">
      <template #header>
        <div class="dialog-header-fancy">
          <span class="dhf-icon" style="background:#e1f5ee;">📊</span>
          <div>
            <div class="dhf-title">用量明细</div>
            <div class="dhf-sub">第三方 API 调用记录与扣费</div>
          </div>
        </div>
      </template>
      <div style="margin-bottom:12px;font-size:13px;color:#606266;">
        客户：<b>{{ currentClient?.company_name }}</b>
      </div>
      <el-table :data="usageList" stripe border size="small" style="width:100%" max-height="380">
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="指标" min-width="120">
          <template #default="{ row }">{{ row.services }}</template>
        </el-table-column>
        <el-table-column label="位置" min-width="160">
          <template #default="{ row }">{{ row.center_lat?.toFixed(4) }}, {{ row.center_lng?.toFixed(4) }}</template>
        </el-table-column>
        <el-table-column label="半径" width="80" align="center">
          <template #default="{ row }">{{ row.radius }}m</template>
        </el-table-column>
        <el-table-column label="来源" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.from_cache ? 'info' : 'success'" size="small">{{ row.from_cache ? '缓存' : '上游' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="扣费" width="80" align="center">
          <template #default="{ row }">
            <span :style="{ color: row.cost > 0 ? '#f56c6c' : '#909399', fontWeight: 600 }">
              {{ row.cost > 0 ? '-' + row.cost + '次' : '免费' }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false)
const keyList = ref([])
const poolInfo = ref(null)

const createDialogVisible = ref(false)
const creating = ref(false)
const createForm = ref({ companyName: '', initialBalance: 0, mock: false })

const rechargeDialogVisible = ref(false)
const recharging = ref(false)
const rechargeAmount = ref(100)
const currentClient = ref(null)

const usageDialogVisible = ref(false)
const usageList = ref([])

const formatDate = (s) => {
  if (!s) return '-'
  return String(s).replace('T', ' ').slice(0, 16)
}

const loadKeys = async () => {
  loading.value = true
  try {
    const { data } = await axios.get('/api/v1/resale/keys')
    keyList.value = data.keys || []
    poolInfo.value = data.pool || null
  } catch (e) {
    ElMessage.error('加载客户列表失败: ' + (e.response?.data?.message || e.message))
  } finally {
    loading.value = false
  }
}

const copyKey = async (key) => {
  try {
    await navigator.clipboard.writeText(key)
    ElMessage.success('API Key 已复制')
  } catch (e) {
    ElMessage.error('复制失败，请手动复制')
  }
}

const openCreateDialog = () => {
  createForm.value = { companyName: '', initialBalance: 0, mock: false }
  createDialogVisible.value = true
}

const handleCreate = async () => {
  if (!createForm.value.companyName.trim()) {
    ElMessage.warning('请输入公司名称')
    return
  }
  creating.value = true
  try {
    const { data } = await axios.post('/api/v1/resale/keys', createForm.value)
    ElMessage.success(data.message || '创建成功')
    createDialogVisible.value = false
    await loadKeys()
    // 展示新 Key 供复制
    if (data.key?.api_key) {
      ElMessageBox.alert(`API Key：${data.key.api_key}\n\n请妥善保存，只显示一次！`, '创建成功', { confirmButtonText: '我已保存' })
    }
  } catch (e) {
    ElMessage.error('创建失败: ' + (e.response?.data?.message || e.message))
  } finally {
    creating.value = false
  }
}

const openRechargeDialog = (row) => {
  currentClient.value = row
  rechargeAmount.value = 100
  rechargeDialogVisible.value = true
}

const handleRecharge = async () => {
  recharging.value = true
  try {
    const { data } = await axios.post('/api/v1/resale/recharge', {
      keyId: currentClient.value.id,
      amount: rechargeAmount.value
    })
    ElMessage.success(`${data.message}（¥${data.totalCost}）`)
    rechargeDialogVisible.value = false
    await loadKeys()
  } catch (e) {
    ElMessage.error('充值失败: ' + (e.response?.data?.message || e.message))
  } finally {
    recharging.value = false
  }
}

const openUsageDialog = async (row) => {
  currentClient.value = row
  usageList.value = []
  usageDialogVisible.value = true
  try {
    const { data } = await axios.get('/api/v1/resale/usage', { params: { keyId: row.id, limit: 200 } })
    usageList.value = data.usage || []
  } catch (e) {
    ElMessage.error('加载用量失败: ' + (e.response?.data?.message || e.message))
  }
}

const toggleStatus = async (row) => {
  const action = row.status === 'active' ? '停用' : '启用'
  try {
    await ElMessageBox.confirm(`确认${action}客户「${row.company_name}」？${action === '停用' ? '停用后该 Key 将无法调用接口。' : ''}`, '提示', { type: 'warning' })
  } catch (e) {
    return
  }
  try {
    const { data } = await axios.post('/api/v1/resale/toggle-status', { keyId: row.id })
    ElMessage.success(data.message || '操作成功')
    await loadKeys()
  } catch (e) {
    ElMessage.error('操作失败: ' + (e.response?.data?.message || e.message))
  }
}

const deleteKey = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确认删除客户「${row.company_name}」？\n删除后该 Key 立即失效，且用量记录一并清除，不可恢复！`,
      '危险操作',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch (e) {
    return
  }
  try {
    const { data } = await axios.post('/api/v1/resale/delete', { keyId: row.id })
    ElMessage.success(data.message || '删除成功')
    await loadKeys()
  } catch (e) {
    ElMessage.error('删除失败: ' + (e.response?.data?.message || e.message))
  }
}

onMounted(() => {
  loadKeys()
})
</script>

<style scoped>
.resale-view {
  padding: 20px;
}

.pool-banner {
  display: flex;
  align-items: center;
  gap: 24px;
  background: linear-gradient(135deg, #f5f7fa, #eef1f6);
  border: 1px solid #e0e6ef;
  border-radius: 8px;
  padding: 12px 18px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.pool-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.pool-label {
  font-size: 11px;
  color: #909399;
}

.pool-value {
  font-size: 16px;
  color: #303133;
}

.pool-tip {
  margin-left: auto;
  font-size: 12px;
  color: #e6a23c;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.key-input {
  max-width: 300px;
}
</style>
