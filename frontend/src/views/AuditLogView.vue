<template>
  <div class="audit-page">
    <div class="audit-head">
      <h2>操作审计</h2>
      <div class="audit-stats">
        <span class="stat-item">全部记录 <strong>{{ total }}</strong></span>
        <span class="stat-divider" />
        <span class="stat-item">近 7 天 <strong>{{ last7Total }}</strong></span>
      </div>
    </div>

    <div class="audit-filters">
      <el-input
        v-model="filters.actor"
        placeholder="操作人用户名"
        clearable
        class="filter-input"
        aria-label="按操作人用户名筛选"
        @change="reload"
        @clear="reload"
      />
      <el-select
        v-model="filters.action"
        placeholder="全部动作"
        clearable
        class="filter-select"
        aria-label="按动作筛选"
        @change="reload"
      >
        <el-option v-for="a in actionOptions" :key="a.value" :label="a.label" :value="a.value" />
      </el-select>
      <el-select
        v-model="filters.targetType"
        placeholder="全部对象"
        clearable
        class="filter-select"
        aria-label="按对象类型筛选"
        @change="reload"
      >
        <el-option label="用户" value="user" />
        <el-option label="配额池" value="admin_quota" />
        <el-option label="城市数据" value="city_data" />
      </el-select>
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        class="filter-date"
        aria-label="按日期范围筛选"
        @change="reload"
      />
      <el-button :loading="loading" @click="reload">刷新</el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="rows"
      size="small"
      border
      stripe
      class="audit-table"
      empty-text="还没有审计记录"
    >
      <el-table-column label="时间" width="164">
        <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
      </el-table-column>

      <el-table-column label="操作人" width="150">
        <template #default="{ row }">
          <span class="actor">{{ row.actor_name || '（系统）' }}</span>
          <el-tag v-if="row.actor_role" size="small" effect="plain" class="role-tag">
            {{ roleLabel(row.actor_role) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="动作" width="150">
        <template #default="{ row }">
          <el-tag :type="actionTagType(row.action)" size="small" effect="light">
            {{ actionLabel(row.action) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="对象" width="130">
        <template #default="{ row }">
          <span class="target">{{ targetLabel(row.target_type, row.target_id) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="详情" min-width="260">
        <template #default="{ row }">
          <span class="detail">{{ formatDetail(row.detail) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="IP" width="130">
        <template #default="{ row }">
          <span class="ip">{{ normalizeIp(row.ip) }}</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="audit-pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[20, 50, 100, 200]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        background
        @current-change="fetchRows"
        @size-change="reload"
      />
    </div>
  </div>
</template>

<script setup>
/**
 * 操作审计页面 —— v1.13.321
 *
 * 数据源 GET /api/audit-log（仅 admin；后端组级挂 authenticate+requireAdmin）。
 *
 * ⚠️ 时间显示有一个坑：库里 created_at 是 sql.js 的 CURRENT_TIMESTAMP，
 *    即 **UTC 且没有时区标记**（'2026-11-06 01:57:51'）。
 *    直接 new Date() 会被当成本地时间 ⇒ 差 8 小时。
 *    所以必须补 'Z' 再解析（见 formatTime）。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'

const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const loading = ref(false)
const last7Total = ref(0)
const actionOptions = ref([])

const filters = reactive({ actor: '', action: '', targetType: '' })
const dateRange = ref(null)

/** 动作码 → 中文（后端只给码，展示层负责翻译；⛔ 不要把这个表拿去和后端比对） */
const ACTION_LABELS = {
  'user.create': '创建用户',
  'user.update': '修改用户',
  'user.disable': '停用账号',
  'user.enable': '恢复账号',
  'user.delete': '删除账号',
  'user.reset_password': '重置密码',
  'quota.pool': '调整配额池',
  'vip.review': 'VIP 审批',
  'citydata.clear': '清空城市数据',
  'citydata.import': '导入城市数据',
  'citydata.upsert': '新增/覆盖城市',
  'citydata.update': '编辑城市数据',
  'auth.totp_enable': '开启两步验证',
  'auth.totp_disable': '关闭两步验证',
  'auth.totp_fail': '两步验证失败',
  'auth.totp_reset': '重置他人两步验证',
}

const ROLE_LABELS = { admin: '管理员', vip: 'VIP', trial: '试用', user: '普通用户' }

const actionLabel = (a) => ACTION_LABELS[a] || a || '-'
const roleLabel = (r) => ROLE_LABELS[r] || r

/** 高风险动作给红色，常规给蓝色 —— 扫一眼就能定位「谁动了钱和权限」 */
const actionTagType = (a) => {
  if (!a) return 'info'
  if (/fail/i.test(a)) return 'danger'
  if (/delete|clear|reset|disable|quota|totp_reset/i.test(a)) return 'danger'
  if (/enable|create/i.test(a)) return 'success'
  return 'primary'
}

const targetLabel = (type, id) => {
  if (!type) return '-'
  const t = { user: '用户', admin_quota: '配额池', city_data: '城市数据' }[type] || type
  return id ? `${t} #${id}` : t
}

/**
 * detail 是 `{ field: { from, to } }` 或 `{ key: value }`。
 * 渲染成 `field: from → to`，比直接甩 JSON 可读得多。
 */
const formatDetail = (detail) => {
  if (!detail) return '—'
  if (typeof detail !== 'object') return String(detail)
  const parts = []
  for (const [k, v] of Object.entries(detail)) {
    if (v && typeof v === 'object' && 'from' in v && 'to' in v) {
      parts.push(`${k}: ${fmt(v.from)} → ${fmt(v.to)}`)
    } else if (typeof v === 'object') {
      parts.push(`${k}: ${JSON.stringify(v)}`)
    } else {
      parts.push(`${k}: ${fmt(v)}`)
    }
  }
  return parts.length ? parts.join('；') : '—'
}

const fmt = (v) => {
  if (v === null || v === undefined || v === '') return '空'
  if (typeof v === 'boolean') return v ? '是' : '否'
  return String(v)
}

/** 库里是 UTC 无时区标记，必须补 Z；否则整体差 8 小时 */
const formatTime = (s) => {
  if (!s) return '-'
  const d = new Date(String(s).replace(' ', 'T') + 'Z')
  if (isNaN(d.getTime())) return s
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const normalizeIp = (ip) => {
  if (!ip) return '-'
  return String(ip).replace(/^::ffff:/, '')
}

const buildQuery = () => {
  const q = { page: page.value, pageSize: pageSize.value }
  if (filters.actor) q.actor = filters.actor
  if (filters.action) q.action = filters.action
  if (filters.targetType) q.targetType = filters.targetType
  if (dateRange.value?.length === 2) {
    q.from = dateRange.value[0]
    q.to = dateRange.value[1]
  }
  return q
}

const fetchRows = async () => {
  loading.value = true
  try {
    const { data } = await axios.get('/api/audit-log', { params: buildQuery() })
    rows.value = data.rows || []
    total.value = data.total || 0
  } catch (e) {
    if (e.response?.status !== 401) ElMessage.error('读取审计日志失败')
  } finally {
    loading.value = false
  }
}

const fetchSummary = async () => {
  try {
    const { data } = await axios.get('/api/audit-log/summary')
    last7Total.value = (data.last7Days || []).reduce((s, x) => s + (x.c || 0), 0)
  } catch (e) { /* 统计失败不影响主表 */ }
}

const loadActions = async () => {
  try {
    const { data } = await axios.get('/api/audit-log/actions')
    actionOptions.value = (data.actions || []).map((a) => ({
      value: a.value,
      label: ACTION_LABELS[a.value] || a.value,
    }))
  } catch (e) { /* 下拉拿不到就用空列表，不阻塞主表 */ }
}

/** 改筛选条件后必须回到第 1 页 —— 否则会停在「超出总数的页码」看到空表 */
const reload = () => {
  page.value = 1
  fetchRows()
}

onMounted(() => {
  loadActions()
  fetchSummary()
  fetchRows()
})
</script>

<style scoped>
.audit-page {
  padding: 20px 24px;
  height: 100%;
  overflow-y: auto;
  background: #f5f7fa;
}
.audit-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 14px;
}
.audit-head h2 {
  margin: 0;
  font-size: 19px;
  color: #1f2d3d;
}
.audit-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #5a6b80;
}
.stat-item strong {
  color: #1f2d3d;
  font-size: 15px;
}
.stat-divider {
  width: 1px;
  height: 14px;
  background: #dcdfe6;
}
.audit-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.filter-input {
  width: 180px;
}
.filter-select {
  width: 170px;
}
.filter-date {
  width: 260px;
}
.audit-table {
  background: #fff;
  border-radius: 6px;
}
.actor {
  color: #1f2d3d;
}
.role-tag {
  margin-left: 6px;
  transform: scale(0.9);
}
.target {
  color: #5a6b80;
  font-size: 12px;
}
.detail {
  font-size: 12px;
  color: #5a6b80;
  word-break: break-all;
  line-height: 1.5;
}
.ip {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: #909399;
}
.audit-pager {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}
</style>
