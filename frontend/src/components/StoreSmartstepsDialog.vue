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
          :min="0.31"
          :max="5"
          :step="0.01"
          :precision="2"
          style="width: 100%;"
        />
      </el-form-item>
      <el-form-item label="半径2">
        <el-input-number
          v-model="queryForm.radius2"
          :min="0"
          :max="5"
          :step="0.01"
          :precision="2"
          style="width: 100%;"
        />
      </el-form-item>
      <el-form-item label="半径3">
        <el-input-number
          v-model="queryForm.radius3"
          :min="0"
          :max="5"
          :step="0.01"
          :precision="2"
          style="width: 100%;"
        />
      </el-form-item>
      <el-form-item label="半径4">
        <el-input-number
          v-model="queryForm.radius4"
          :min="0"
          :max="5"
          :step="0.01"
          :precision="2"
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
      <span>单位: 公里 ｜ 半径范围: 0.31~5 公里 ｜ 请在当月20日之后选择上月数据</span>
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

    <!-- 查询结果对话框 -->
    <el-dialog
      v-model="showQueryResultDialog"
      :title="`${storeInfo?.name || ''} - 查询结果`"
      width="800px"
      draggable
      append-to-body
      class="query-result-dialog"
    >
      <template #header>
        <span>{{ storeInfo?.name || '' }} - 查询结果</span>
        <span style="float:right;margin-right:28px;">
          <el-button type="success" size="small" :loading="exportingExcel" :disabled="!queryPurchaseId" @click="handleExportExcelResult" style="margin-right:8px;">
            📊 导出Excel
          </el-button>
          <el-button type="danger" size="small" :loading="exportingPdf" :disabled="!queryPurchaseId" @click="handleExportPDFResult">
            📄 PDF报表
          </el-button>
        </span>
      </template>
      <div v-if="queryResult" class="result-dialog-content">
        <div class="result-dialog-data" v-html="formatResult(queryResult)"></div>
      </div>
      <div v-else class="no-result">
        <p>暂无查询结果</p>
      </div>
      <template #footer>
        <el-button @click="showQueryResultDialog = false">关闭</el-button>
      </template>
    </el-dialog>

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
      <el-button type="primary" @click="executeQuery($event)" :loading="isLoading">
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
    width="800px"
    draggable
  >
    <template #header>
      <div class="dialog-header-flex">
        <span>📊 查询结果详情 - {{ currentDetail?.store_name || storeInfo?.name || '' }}</span>
        <div class="dialog-header-actions">
          <el-button type="primary" size="small" class="btn-insight" @click="handleDataInsight">
            {{ insightLoading ? '分析中...' : (insights.length > 0 ? '🔄 重新分析' : '📋 数据洞察') }}
          </el-button>
        </div>
      </div>
    </template>
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
      <!-- 数据洞察 -->
      <div v-if="insights.length > 0" class="insight-section">
        <h4>📋 数据洞察</h4>
        <div v-for="(item, idx) in insights" :key="idx" :class="['insight-item', 'insight-' + item.type]">
          <span class="insight-icon">{{ item.type === 'positive' ? '✅' : item.type === 'warning' ? '⚠️' : '💡' }}</span>
          <span class="insight-text">{{ item.text }}</span>
        </div>
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
import { ref, computed, watch, nextTick } from 'vue'
import { captureMapToCanvas, captureMapOnlyCanvas, captureShoppingCenterMap } from '@/utils/mapCapture'
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

// 查询表单 — 从 localStorage 加载预设半径值
const STORAGE_KEY = 'store_smartsteps_radii'
function loadSavedRadii() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return { radius1: 0.5, radius2: 1, radius3: 1.5, radius4: 2 } // 默认
}
const savedRadii = loadSavedRadii()
const queryForm = ref({
  radius1: savedRadii.radius1,
  radius2: savedRadii.radius2,
  radius3: savedRadii.radius3,
  radius4: savedRadii.radius4,
  cityMonth: ''
})

// 半径值变化时自动保存到 localStorage
watch(
  () => [queryForm.value.radius1, queryForm.value.radius2, queryForm.value.radius3, queryForm.value.radius4],
  ([r1, r2, r3, r4]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ radius1: r1, radius2: r2, radius3: r3, radius4: r4 }))
  },
  { deep: true }
)

// 可选月份
const availableMonths = ref([])
const quotaInfo = ref(null)
const isLoading = ref(false)
const queryResult = ref(null)
const showConfirmDialog = ref(false)
const showQueryResultDialog = ref(false) // 新增：查询结果对话框
const queryPurchaseId = ref(null) // 本次查询产生的 purchase 记录 ID（用于导出报表）
const exportingExcel = ref(false)
const exportingPdf = ref(false)

// 门店购买履历
const storePurchases = ref([])
const showPurchaseHistoryDialog = ref(false)
const selectedPurchase = ref(null)
const showHistoryDetailDialog = ref(false)

// 查看详情相关（与MyAccountView保持一致）
const detailLoading = ref(false)
const currentDetail = ref(null)
const resultData = ref(null)

// 数据洞察
const insights = ref([])
const insightLoading = ref(false)

// 计算属性
const canQuery = computed(() => {
  const hasRadius = queryForm.value.radius1 > 0 || queryForm.value.radius2 > 0 || queryForm.value.radius3 > 0 || queryForm.value.radius4 > 0
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
  if (queryForm.value.radius4 > 0) count++
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
  if (queryForm.value.radius4 > 0) radii.push(`${queryForm.value.radius4}公里`)
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

// 加载可选月份（动态计算最近两个月）
function loadAvailableMonths() {
  const now = new Date()
  const months = []
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  for (let i = 1; i <= 2; i++) {
    let month = currentMonth - i
    let year = currentYear
    if (month <= 0) { month += 12; year -= 1 }
    const padded = String(month).padStart(2, '0')
    months.push({ value: `${year}${padded}`, label: `${year}年${month}月` })
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
  insights.value = []

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
const excludeServices = ['1004', '1016', '1003', '1008', '1019', '1002', '1017', '1018', '1021', '1022', '1023', '1020']

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

// 格式化结果显示 - 完整版：显示所有服务
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

    // 1006 每日人流量及停留时长 - 特殊处理
    if (key === '1006' && typeof value === 'object' && !Array.isArray(value)) {
      const labelMap = {
        'day_avg_visit': '日均到访人次',
        'day_avg_total': '日均全量人次',
        'stay_30': '停留<30分钟',
        'stay_60': '停留30-60分钟',
        'stay_120': '停留1-2小时',
        'stay_240': '停留2-4小时',
        'stay_480': '停留4-8小时'
      };
      let tableHtml = '<table class="data-table"><thead><tr><th>指标</th><th class="num">数值</th></tr></thead><tbody>';
      for (const [k, v] of Object.entries(value)) {
        const label = labelMap[k] || k;
        tableHtml += `<tr><td>${label}</td><td class="num">${(v || 0).toLocaleString()}</td></tr>`;
      }
      tableHtml += '</tbody></table>';
      html += `<div class="detail-result-item">
        <h4>${serviceName}</h4>
        ${tableHtml}
      </div>`
      continue
    }

    // 1002 上网标签分布
    if (key === '1002' && Array.isArray(value) && value.length > 0) {
      // 按 tag_value 降序排序，取前10
      const sorted = [...value]
        .filter(row => row && typeof row === 'object' && row.tag_name && row.tag_value !== undefined)
        .sort((a, b) => Number(b.tag_value) - Number(a.tag_value))
        .slice(0, 10);
      if (sorted.length > 0) {
        html += `<div class="detail-result-item">
          <div class="section-title">上网标签分布</div>
          <table class="data-table cross-table">
            <thead><tr><th>标签</th><th>到访</th><th>居住</th><th>工作</th></tr></thead>
            <tbody>
              ${sorted.map(r => `<tr><td>${r.tag_name}</td><td class="num">${Number(r.tag_value).toLocaleString()}</td><td class="num">0</td><td class="num">0</td></tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      }
      continue;
    }

    // 数组格式数据
    if (Array.isArray(value)) {
      html += `<div class="detail-result-item">
        <h4>${serviceName}</h4>
        ${formatArrayData(value, key)}
      </div>`
      continue
    }

    // 其他服务
    if (typeof value === 'object' && !Array.isArray(value)) {
      html += `<div class="detail-result-item">
        <h4>${serviceName}</h4>
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


// 1001服务数据格式化 - 完整版：三张大数字卡片 + P层级 + 性别/年龄/月出账交叉表
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

  // 三个大数字卡片
  let html = `<div style="display:flex;gap:10px;margin-bottom:12px;">
    <div style="flex:1;background:#f8f4fb;border-radius:6px;padding:10px;text-align:center;">
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
  
  // 1005: 每小时段人口流量 {day_type, hour_period, hour_all, hour_visit}
  // 横向24行表格：时段、工作日到访人次、周末到访人次、工作日全量人次、周末全量人次
  if (firstItem.day_type !== undefined && firstItem.hour_period !== undefined) {
      // 按 day_type 和 hour_period 构建数据结构
      const dataMap = {}
      for (const item of data) {
        if (!item || typeof item !== 'object') continue
        const hour = item.hour_period
        const dayType = item.day_type  // 0=工作日, 1=周末
        if (hour === undefined) continue
        if (!dataMap[hour]) {
          dataMap[hour] = { 0: { visit: 0, all: 0 }, 1: { visit: 0, all: 0 } }
        }
        dataMap[hour][dayType] = {
          visit: item.hour_visit || 0,
          all: item.hour_all || 0
        }
      }

      // 生成表格HTML
      let html = '<table class="data-table"><thead><tr><th>时段</th><th class="num">工作日到访人次</th><th class="num">周末到访人次</th><th class="num">工作日全量人次</th><th class="num">周末全量人次</th></tr></thead><tbody>'
      // 按小时排序
      const hours = Object.keys(dataMap).map(Number).sort((a, b) => a - b)
      for (const hour of hours) {
        const workday = dataMap[hour][0] || { visit: 0, all: 0 }
        const weekend = dataMap[hour][1] || { visit: 0, all: 0 }
        html += `<tr><td>${hour}点</td><td class="num">${workday.visit.toLocaleString()}</td><td class="num">${weekend.visit.toLocaleString()}</td><td class="num">${workday.all.toLocaleString()}</td><td class="num">${weekend.all.toLocaleString()}</td></tr>`
      }
      html += '</tbody></table>'
      return html
    }
  
  // 1006: 每日人流量及停留时长 {date, day_visit, day_all, stay1-stay5}
  if (firstItem.date !== undefined && firstItem.day_visit !== undefined) {
    const columnOrder = [
      { key: 'day_visit', label: '到访人次' },
      { key: 'day_all', label: '全量人次' },
      { key: 'stay1', label: '停留<30m' },
      { key: 'stay2', label: '30-60m' },
      { key: 'stay3', label: '1-2h' },
      { key: 'stay4', label: '2-4h' },
      { key: 'stay5', label: '4h+' }
    ];

    // 计算汇总数据
    const days = data.length;
    const totals = {};
    for (const col of columnOrder) {
      totals[col.key] = 0;
    }
    for (const item of data) {
      for (const col of columnOrder) {
        totals[col.key] += item[col.key] || 0;
      }
    }

    // 计算日期范围
    const dates = data.map(d => d.date).filter(Boolean).sort()
    const dateRange = dates.length > 0 ? `${dates[0]} 至 ${dates[dates.length - 1]}` : ''

    // 生成日均汇总表格
    let html = `<h4>日均汇总</h4><p style="margin:8px 0 16px 0;font-size:13px;color:#666;">数据范围：${dateRange}</p>`;
    html += '<table class="data-table"><thead><tr><th>指标</th><th class="num">日均值</th><th class="num">月度累计</th></tr></thead><tbody>';
    for (const col of columnOrder) {
      const total = totals[col.key];
      const dailyAvg = Math.round(total / days);
      html += "<tr><td>" + col.label + "</td><td class=\"num\">" + dailyAvg.toLocaleString() + "</td><td class=\"num\">" + total.toLocaleString() + "</td></tr>";
    }
    html += "</tbody></table>";

    // 生成每日明细表格
    html += "<h4>每日明细</h4>";
    html += "<table class=\"data-table\"><thead><tr><th>日期</th>";
    const detailLabels = ["到访人次", "全量人次", "停留<30m", "30-60m", "1-2h", "2-4h", "4h+"];
    for (const label of detailLabels) {
      html += "<th class=\"num\">" + label + "</th>";
    }
    html += "</tr></thead><tbody>";
    for (const item of data) {
      html += "<tr><td>" + (item.date || "-") + "</td>";
      for (const col of columnOrder) {
        const v = item[col.key];
        const display = v !== undefined ? v.toLocaleString() : "-";
        html += "<td class=\"num\">" + display + "</td>";
      }
      html += "</tr>";
    }
    html += "</tbody></table>";
    return html;
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

  // 1007: 每月到达次数分布 {popu_type, reach1, reach2, reach3, reach4, reach5}
  // 横向单行表格：到访/居住/工作 x 月驻留1次/2-4次/5-10次/11-20次/20次以上
  // 检查是否有reach相关的字段
  const hasReachField = Object.keys(firstItem).some(k => k.includes('reach'))
  if (hasReachField) {
    const typeNames = { '0': '到访', '1': '居住', '2': '工作' }
    // 找出所有reach字段并按数字排序
    const reachKeys = Object.keys(firstItem)
      .filter(k => k.includes('reach'))
      .sort((a, b) => {
        const numA = parseInt(a.replace('reach', ''))
        const numB = parseInt(b.replace('reach', ''))
        return numA - numB
      })
    // 根据reach字段数量生成对应的标签
    const reachLabelMap = {
      'reach1': '月驻留1次',
      'reach2': '月驻留2-4次', 
      'reach3': '月驻留5-10次',
      'reach4': '月驻留11-20次',
      'reach5': '月驻留20次以上'
    }
    const reachLabels = reachKeys.map(k => reachLabelMap[k] || k)
    
    // 检查是否有popu_type字段
    const hasPopuType = firstItem.popu_type !== undefined
    
    if (hasPopuType) {
      // 有popu_type：显示多列表格（到访/居住/工作）
      // 获取唯一人群类型
      const types = [...new Set(data.map(d => d.popu_type))].sort()
      
      // 生成表格HTML
      let html = '<table class="data-table"><thead><tr><th>指标</th>'
      for (const t of types) {
        html += '<th>' + (typeNames[t] || t) + '</th>'
      }
      html += '</tr></thead><tbody>'
      
      // 每种reach一行
      for (let i = 0; i < reachKeys.length; i++) {
        const key = reachKeys[i]
        const label = reachLabels[i]
        html += '<tr><td>' + label + '</td>'
        for (const t of types) {
          const item = data.find(d => d.popu_type === t)
          const val = item ? (item[key] || 0) : 0
          html += '<td class="num">' + val.toLocaleString() + '</td>'
        }
        html += '</tr>'
      }
      html += '</tbody></table>'
      return html
    } else {
      // 没有popu_type：显示单列表格
      // 生成表格HTML
      let html = '<table class="data-table"><thead><tr><th>指标</th><th>数值</th></tr></thead><tbody>'
      
      // 每种reach一行
      for (let i = 0; i < reachKeys.length; i++) {
        const key = reachKeys[i]
        const label = reachLabels[i]
        // 如果没有popu_type，假设只有一个数据项
        const val = firstItem[key] || 0
        html += '<tr><td>' + label + '</td><td class="num">' + val.toLocaleString() + '</td></tr>'
      }
      html += '</tbody></table>'
      return html
    }
  }

  // 1009: 消费水平（富裕指数） - 支持多种字段名：level/spendpower, pop_value/spendpower_value
  // 消费力指数1-8，交叉表（到访/居住/工作）
  if (serviceCode === '1009') {
    // 确定字段名映射
    const levelField = firstItem.level !== undefined ? 'level' : 
                      firstItem.spendpower !== undefined ? 'spendpower' : null
    const valueField = firstItem.pop_value !== undefined ? 'pop_value' : 
                       firstItem.spendpower_value !== undefined ? 'spendpower_value' : null
    const typeField = firstItem.popu_type !== undefined ? 'popu_type' : null
    
    if (levelField && valueField && typeField) {
      // 按消费力指数等级分组，映射到访/居住/工作
      const spendMap = {}
      for (const item of data) {
        const level = Number(item[levelField])
        if (!spendMap[level]) {
          spendMap[level] = { '到访': 0, '居住': 0, '工作': 0 }
        }
        const popuType = Number(item[typeField])
        const popValue = Number(item[valueField]) || 0
        if (popuType === 0) {
          spendMap[level]['到访'] = popValue
        } else if (popuType === 1) {
          spendMap[level]['居住'] = popValue
        } else if (popuType === 2) {
          spendMap[level]['工作'] = popValue
        }
      }

      // 消费力指数中文标签（1-8）
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

      // 生成表格HTML - 确保显示1-8所有等级
      let html = '<table class="data-table"><thead><tr><th>消费力指数</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>'

      // 强制显示1-8所有等级
      for (let level = 1; level <= 8; level++) {
        const dataRow = spendMap[level] || { '到访': 0, '居住': 0, '工作': 0 }
        const label = spendLabels[level] || `消费力指数${level}`
        html += `<tr><td>${label}</td><td class="num">${dataRow['到访'].toLocaleString()}</td><td class="num">${dataRow['居住'].toLocaleString()}</td><td class="num">${dataRow['工作'].toLocaleString()}</td></tr>`
      }

      html += '</tbody></table>'
      return html
    }
    // 如果字段名不匹配，继续执行默认表格
  }
  
  // 1010: 人口教育水平 - 去掉fname列，调整p0-p4列顺序和列名
  if (serviceCode === '1010') {
    // 检查是否有fname和p0-p4字段
    const hasFname = firstItem.fname !== undefined
    const hasP0 = firstItem.p0 !== undefined
    const hasP1 = firstItem.p1 !== undefined
    const hasP2 = firstItem.p2 !== undefined
    const hasP3 = firstItem.p3 !== undefined
    const hasP4 = firstItem.p4 !== undefined
    
    if (hasP0 && hasP1 && hasP2 && hasP3 && hasP4) {
      // 定义正确的列顺序和中文标签
      const columnOrder = [
        { key: 'p0', label: '高中及以下' },
        { key: 'p1', label: '大专' },
        { key: 'p2', label: '本科' },
        { key: 'p3', label: '硕士' },
        { key: 'p4', label: '博士' }
      ]
      
      // 生成表格HTML
      let html = '<table class="data-table"><thead><tr><th>学历</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>'
      
      // 遍历每一行数据（假设数据是按人群类型分组的）
      // 我们需要按学历分组，而不是按人群类型
      // 首先检查数据是否按popu_type分组
      const hasPopuType = firstItem.popu_type !== undefined
      
      if (hasPopuType) {
        // 数据按popu_type分组（0=到访,1=居住,2=工作）
        const eduMap = {}
        
        for (const item of data) {
          const popuType = Number(item.popu_type)
          const popuTypeLabel = popuType === 0 ? '到访' : popuType === 1 ? '居住' : '工作'
          
          for (const col of columnOrder) {
            const eduLevel = col.label
            if (!eduMap[eduLevel]) {
              eduMap[eduLevel] = { '到访': 0, '居住': 0, '工作': 0 }
            }
            eduMap[eduLevel][popuTypeLabel] = item[col.key] || 0
          }
        }
        
        // 生成表格行
        for (const col of columnOrder) {
          const eduLevel = col.label
          const rowData = eduMap[eduLevel] || { '到访': 0, '居住': 0, '工作': 0 }
          html += `<tr><td>${eduLevel}</td><td class="num">${rowData['到访'].toLocaleString()}</td><td class="num">${rowData['居住'].toLocaleString()}</td><td class="num">${rowData['工作'].toLocaleString()}</td></tr>`
        }
      } else {
        // 如果没有popu_type，假设每个数据项对应一个学历等级
        // 按p0-p4顺序显示
        for (const col of columnOrder) {
          const item = data.find(d => d[col.key] !== undefined)
          const value = item ? (item[col.key] || 0) : 0
          html += `<tr><td>${col.label}</td><td class="num">${value.toLocaleString()}</td><td class="num">0</td><td class="num">0</td></tr>`
        }
      }
      
      html += '</tbody></table>'
      return html
    }
  }
  
  // 1011: 人口行业分布 - p1-p10对应金融从业者到快递员
  if (serviceCode === '1011') {
    // 检查是否有p1-p10字段
    let hasP1toP10 = true
    for (let i = 1; i <= 10; i++) {
      if (firstItem[`p${i}`] === undefined) {
        hasP1toP10 = false
        break
      }
    }
    
    if (hasP1toP10) {
      // 行业标签映射
      const industryLabels = {
        p1: '金融从业者',
        p2: '医务人员',
        p3: '公务员&事业单位',
        p4: '白领及一般职员',
        p5: '工人及服务业人员',
        p6: '教师',
        p7: '农民及其他',
        p8: '网约车司机',
        p9: '外卖员',
        p10: '快递员'
      }
      
      // 检查是否有popu_type字段
      const hasPopuType = firstItem.popu_type !== undefined
      
      if (hasPopuType) {
        // 数据按popu_type分组（0=到访,1=居住,2=工作）
        const industryMap = {}
        
        // 初始化行业映射
        for (const key in industryLabels) {
          industryMap[industryLabels[key]] = { '到访': 0, '居住': 0, '工作': 0 }
        }
        
        // 处理每个数据项
        for (const item of data) {
          const popuType = Number(item.popu_type)
          const popuTypeLabel = popuType === 0 ? '到访' : popuType === 1 ? '居住' : '工作'
          
          // 累加每个行业的值
          for (let i = 1; i <= 10; i++) {
            const pKey = `p${i}`
            const industryName = industryLabels[pKey]
            const value = Number(item[pKey]) || 0
            industryMap[industryName][popuTypeLabel] = value
          }
        }
        
        // 生成表格HTML
        let html = '<table class="data-table"><thead><tr><th>行业</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>'
        
        // 按指定顺序显示行业
        const displayOrder = ['金融从业者', '医务人员', '公务员&事业单位', '白领及一般职员', '工人及服务业人员', '教师', '农民及其他', '网约车司机', '外卖员', '快递员']
        
        for (const industry of displayOrder) {
          const rowData = industryMap[industry] || { '到访': 0, '居住': 0, '工作': 0 }
          html += `<tr><td>${industry}</td><td class="num">${rowData['到访'].toLocaleString()}</td><td class="num">${rowData['居住'].toLocaleString()}</td><td class="num">${rowData['工作'].toLocaleString()}</td></tr>`
        }
        
        html += '</tbody></table>'
        return html
      } else {
        // 如果没有popu_type，假设每个数据项对应一个行业
        // 生成表格HTML
        let html = '<table class="data-table"><thead><tr><th>行业</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>'
        
        // 按p1-p10顺序显示
        for (let i = 1; i <= 10; i++) {
          const pKey = `p${i}`
          const industryName = industryLabels[pKey] || pKey
          const item = data.find(d => d[pKey] !== undefined)
          const value = item ? (Number(item[pKey]) || 0) : 0
          html += `<tr><td>${industryName}</td><td class="num">${value.toLocaleString()}</td><td class="num">0</td><td class="num">0</td></tr>`
        }
        
        html += '</tbody></table>'
        return html
      }
    }
  }
  
  // 1012: 人生阶段分布 - p1-p3对应已婚已育、已婚未育、未婚未育
  if (serviceCode === '1012') {
    // 检查是否有p1-p3字段
    let hasP1toP3 = true
    for (let i = 1; i <= 3; i++) {
      if (firstItem[`p${i}`] === undefined) {
        hasP1toP3 = false
        break
      }
    }
    
    if (hasP1toP3) {
      // 人生阶段标签映射
      const lifeStageLabels = {
        p1: '已婚已育',
        p2: '已婚未育', 
        p3: '未婚未育'
      }
      
      // 检查是否有popu_type字段
      const hasPopuType = firstItem.popu_type !== undefined
      
      if (hasPopuType) {
        // 数据按popu_type分组（0=到访,1=居住,2=工作）
        const stageMap = {}
        
        // 初始化人生阶段映射
        for (const key in lifeStageLabels) {
          stageMap[lifeStageLabels[key]] = { '到访': 0, '居住': 0, '工作': 0 }
        }
        
        // 处理每个数据项
        for (const item of data) {
          const popuType = Number(item.popu_type)
          const popuTypeLabel = popuType === 0 ? '到访' : popuType === 1 ? '居住' : '工作'
          
          // 累加每个人生阶段的值
          for (let i = 1; i <= 3; i++) {
            const pKey = `p${i}`
            const stageName = lifeStageLabels[pKey]
            const value = Number(item[pKey]) || 0
            stageMap[stageName][popuTypeLabel] = value
          }
        }
        
        // 生成表格HTML
        let html = '<table class="data-table"><thead><tr><th>人生阶段</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>'
        
        // 按指定顺序显示人生阶段
        const displayOrder = ['已婚已育', '已婚未育', '未婚未育']
        
        for (const stage of displayOrder) {
          const rowData = stageMap[stage] || { '到访': 0, '居住': 0, '工作': 0 }
          html += `<tr><td>${stage}</td><td class="num">${rowData['到访'].toLocaleString()}</td><td class="num">${rowData['居住'].toLocaleString()}</td><td class="num">${rowData['工作'].toLocaleString()}</td></tr>`
        }
        
        html += '</tbody></table>'
        return html
      } else {
        // 如果没有popu_type，假设每个数据项对应一个人生阶段
        // 生成表格HTML
        let html = '<table class="data-table"><thead><tr><th>人生阶段</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>'
        
        // 按p1-p3顺序显示
        for (let i = 1; i <= 3; i++) {
          const pKey = `p${i}`
          const stageName = lifeStageLabels[pKey] || pKey
          const item = data.find(d => d[pKey] !== undefined)
          const value = item ? (Number(item[pKey]) || 0) : 0
          html += `<tr><td>${stageName}</td><td class="num">${value.toLocaleString()}</td><td class="num">0</td><td class="num">0</td></tr>`
        }
        
        html += '</tbody></table>'
        return html
      }
    }
  }
  
  // 1013: 综合消费能力预测 - p1-p3对应消费水平高、中、低
  if (serviceCode === '1013') {
    // 检查是否有p1-p3字段
    let hasP1toP3 = true
    for (let i = 1; i <= 3; i++) {
      if (firstItem[`p${i}`] === undefined) {
        hasP1toP3 = false
        break
      }
    }
    
    if (hasP1toP3) {
      // 消费水平标签映射
      const consumptionLabels = {
        p1: '消费水平高',
        p2: '消费水平中', 
        p3: '消费水平低'
      }
      
      // 检查是否有popu_type字段
      const hasPopuType = firstItem.popu_type !== undefined
      
      if (hasPopuType) {
        // 数据按popu_type分组（0=到访,1=居住,2=工作）
        const levelMap = {}
        
        // 初始化消费水平映射
        for (const key in consumptionLabels) {
          levelMap[consumptionLabels[key]] = { '到访': 0, '居住': 0, '工作': 0 }
        }
        
        // 处理每个数据项
        for (const item of data) {
          const popuType = Number(item.popu_type)
          const popuTypeLabel = popuType === 0 ? '到访' : popuType === 1 ? '居住' : '工作'
          
          // 累加每个消费水平的值
          for (let i = 1; i <= 3; i++) {
            const pKey = `p${i}`
            const levelName = consumptionLabels[pKey]
            const value = Number(item[pKey]) || 0
            levelMap[levelName][popuTypeLabel] = value
          }
        }
        
        // 生成表格HTML
        let html = '<table class="data-table"><thead><tr><th>消费能力</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>'
        
        // 按指定顺序显示消费水平
        const displayOrder = ['消费水平高', '消费水平中', '消费水平低']
        
        for (const level of displayOrder) {
          const rowData = levelMap[level] || { '到访': 0, '居住': 0, '工作': 0 }
          html += `<tr><td>${level}</td><td class="num">${rowData['到访'].toLocaleString()}</td><td class="num">${rowData['居住'].toLocaleString()}</td><td class="num">${rowData['工作'].toLocaleString()}</td></tr>`
        }
        
        html += '</tbody></table>'
        return html
      } else {
        // 如果没有popu_type，假设每个数据项对应一个消费水平
        // 生成表格HTML
        let html = '<table class="data-table"><thead><tr><th>消费能力</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>'
        
        // 按p1-p3顺序显示
        for (let i = 1; i <= 3; i++) {
          const pKey = `p${i}`
          const levelName = consumptionLabels[pKey] || pKey
          const item = data.find(d => d[pKey] !== undefined)
          const value = item ? (Number(item[pKey]) || 0) : 0
          html += `<tr><td>${levelName}</td><td class="num">${value.toLocaleString()}</td><td class="num">0</td><td class="num">0</td></tr>`
        }
        
        html += '</tbody></table>'
        return html
      }
    }
  }
  
  // 1014: 网购能力预测 - p1-p5对应网购能力高、中高、中、中低、低
  if (serviceCode === '1014') {
    // 检查是否有p1-p5字段
    let hasP1toP5 = true
    for (let i = 1; i <= 5; i++) {
      if (firstItem[`p${i}`] === undefined) {
        hasP1toP5 = false
        break
      }
    }
    
    if (hasP1toP5) {
      // 网购能力标签映射
      const onlineShoppingLabels = {
        p1: '网购能力高',
        p2: '网购能力中高', 
        p3: '网购能力中',
        p4: '网购能力中低',
        p5: '网购能力低'
      }
      
      // 检查是否有popu_type字段
      const hasPopuType = firstItem.popu_type !== undefined
      
      if (hasPopuType) {
        // 数据按popu_type分组（0=到访,1=居住,2=工作）
        const abilityMap = {}
        
        // 初始化网购能力映射
        for (const key in onlineShoppingLabels) {
          abilityMap[onlineShoppingLabels[key]] = { '到访': 0, '居住': 0, '工作': 0 }
        }
        
        // 处理每个数据项
        for (const item of data) {
          const popuType = Number(item.popu_type)
          const popuTypeLabel = popuType === 0 ? '到访' : popuType === 1 ? '居住' : '工作'
          
          // 累加每个网购能力等级的值
          for (let i = 1; i <= 5; i++) {
            const pKey = `p${i}`
            const abilityName = onlineShoppingLabels[pKey]
            const value = Number(item[pKey]) || 0
            abilityMap[abilityName][popuTypeLabel] = value
          }
        }
        
        // 生成表格HTML
        let html = '<table class="data-table"><thead><tr><th>网购能力</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>'
        
        // 按指定顺序显示网购能力等级
        const displayOrder = ['网购能力高', '网购能力中高', '网购能力中', '网购能力中低', '网购能力低']
        
        for (const ability of displayOrder) {
          const rowData = abilityMap[ability] || { '到访': 0, '居住': 0, '工作': 0 }
          html += `<tr><td>${ability}</td><td class="num">${rowData['到访'].toLocaleString()}</td><td class="num">${rowData['居住'].toLocaleString()}</td><td class="num">${rowData['工作'].toLocaleString()}</td></tr>`
        }
        
        html += '</tbody></table>'
        return html
      } else {
        // 如果没有popu_type，假设每个数据项对应一个网购能力等级
        // 生成表格HTML
        let html = '<table class="data-table"><thead><tr><th>网购能力</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>'
        
        // 按p1-p5顺序显示
        for (let i = 1; i <= 5; i++) {
          const pKey = `p${i}`
          const abilityName = onlineShoppingLabels[pKey] || pKey
          const item = data.find(d => d[pKey] !== undefined)
          const value = item ? (Number(item[pKey]) || 0) : 0
          html += `<tr><td>${abilityName}</td><td class="num">${value.toLocaleString()}</td><td class="num">0</td><td class="num">0</td></tr>`
        }
        
        html += '</tbody></table>'
        return html
      }
    }
  }
  
  // 1015: 资产预测（收入/有车/有房） - 拆分成3张表格
  if (serviceCode === '1015') {
    // 检查是否有fname字段（区分收入、有车、有房）
    const hasFname = firstItem.fname !== undefined
    // 检查是否有p1-p5字段（概率等级）
    let hasP1toP5 = true
    for (let i = 1; i <= 5; i++) {
      if (firstItem[`p${i}`] === undefined) {
        hasP1toP5 = false
        break
      }
    }
    // 检查是否有popu_type字段（人群类型）
    const hasPopuType = firstItem.popu_type !== undefined
    
    if (hasP1toP5 && hasPopuType) {
      // 概率等级标签映射
      const probabilityLabels = {
        p1: '预测概率高',
        p2: '预测概率中高', 
        p3: '预测概率中',
        p4: '预测概率中低',
        p5: '预测概率低'
      }
      
      // 预测类型标签映射
      const predictionTypeLabels = {
        'income': '收入预测',
        'car': '有车预测', 
        'house': '有房预测'
      }
      
      // 按fname分组（如果存在），否则按数据项顺序分组
      let predictionGroups = {}
      
      if (hasFname) {
        // 按fname分组
        for (const item of data) {
          const fname = item.fname
          if (!predictionGroups[fname]) {
            predictionGroups[fname] = []
          }
          predictionGroups[fname].push(item)
        }
      } else {
        // 没有fname字段，假设数据项按顺序对应收入、有车、有房
        // 但需要检查数据项数量
        if (data.length >= 3) {
          // 假设前三个数据项对应收入、有车、有房
          predictionGroups = {
            'income': [data[0]],
            'car': [data[1]],
            'house': [data[2]]
          }
        } else {
          // 数据项不足，无法分组
          predictionGroups = { 'default': data }
        }
      }
      
      // 生成三张表格的HTML
      let html = ''
      
      // 按指定顺序显示预测类型：收入、有车、有房
      const displayOrder = hasFname ? Object.keys(predictionGroups).sort() : ['income', 'car', 'house']
      
      for (const groupKey of displayOrder) {
        const groupItems = predictionGroups[groupKey] || []
        if (groupItems.length === 0) continue
        
        // 获取预测类型中文名称
        const predictionName = predictionTypeLabels[groupKey] || groupKey
        
        // 为这个预测类型构建数据映射
        const probMap = {}
        
        // 初始化概率等级映射
        for (const key in probabilityLabels) {
          probMap[probabilityLabels[key]] = { '到访': 0, '居住': 0, '工作': 0 }
        }
        
        // 处理这个预测类型的每个数据项
        for (const item of groupItems) {
          const popuType = Number(item.popu_type)
          const popuTypeLabel = popuType === 0 ? '到访' : popuType === 1 ? '居住' : '工作'
          
          // 累加每个概率等级的值
          for (let i = 1; i <= 5; i++) {
            const pKey = `p${i}`
            const probName = probabilityLabels[pKey]
            const value = Number(item[pKey]) || 0
            probMap[probName][popuTypeLabel] = value
          }
        }
        
        // 生成这个预测类型的表格HTML
        html += `<h4>${predictionName}</h4>`
        html += '<table class="data-table"><thead><tr><th>概率等级</th><th class="num">到访</th><th class="num">居住</th><th class="num">工作</th></tr></thead><tbody>'
        
        // 按指定顺序显示概率等级：高、中高、中、中低、低
        const probOrder = ['预测概率高', '预测概率中高', '预测概率中', '预测概率中低', '预测概率低']
        
        for (const prob of probOrder) {
          const rowData = probMap[prob] || { '到访': 0, '居住': 0, '工作': 0 }
          html += `<tr><td>${prob}</td><td class="num">${rowData['到访'].toLocaleString()}</td><td class="num">${rowData['居住'].toLocaleString()}</td><td class="num">${rowData['工作'].toLocaleString()}</td></tr>`
        }
        
        html += '</tbody></table><br>'
      }
      
      return html
    } else {
      // 如果缺少必要字段，回退到默认表格
      // 继续执行默认表格逻辑
    }
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
    '1009': { 'p1': '消费力指数1（最低）', 'p2': '消费力指数2', 'p3': '消费力指数3', 'p4': '消费力指数4', 'p5': '消费力指数5', 'p6': '消费力指数6', 'p7': '消费力指数7', 'p8': '消费力指数8（最高）' },
    '1011': { 'p1': '未婚', 'p2': '已婚' },
    '1012': { 'p1': '已婚已育', 'p2': '已婚未育', 'p3': '未婚未育' },
    '1022': { 'p1': '低档', 'p2': '中低档', 'p3': '中档', 'p4': '中高档', 'p5': '高档' },
    '1023': { 'p1': '无车', 'p2': '有车' },
    '1013': { 'p1': '消费水平高', 'p2': '消费水平中', 'p3': '消费水平低' },
    '1014': { 'p1': '网购能力高', 'p2': '网购能力中高', 'p3': '网购能力中', 'p4': '网购能力中低', 'p5': '网购能力低' },
    '1015': { 'p1': '预测概率高', 'p2': '预测概率中高', 'p3': '预测概率中', 'p4': '预测概率中低', 'p5': '预测概率低' }
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

// 生成模拟数据（用于测试，不消耗配额）
function generateMockData() {
  // 模拟API返回的数据结构
  // 1001 人口基础属性 - 使用 formatP0SData 期望的字段名
  const p0Sum = 15000
  const pallSum = 45000
  const p3Sum = 3000
  const p4Sum = 2000
  const p5Sum = 1000
  const male0Sum = 8000
  const female0Sum = 7000
  const male1Sum = 6000
  const female1Sum = 5000
  const male2Sum = 4000
  const female2Sum = 3000

  // 年龄组字段 age0_0006, age1_0006, age2_0006 等
  const ageGroups = [
    ['0-6岁', '0006'], ['6-12岁', '0612'], ['12-15岁', '1215'], ['15-18岁', '1518'],
    ['19-24岁', '1924'], ['25-29岁', '2529'], ['30-34岁', '3034'], ['35-39岁', '3539'],
    ['40-44岁', '4044'], ['45-49岁', '4549'], ['50-54岁', '5054'], ['55-59岁', '5559'],
    ['60-64岁', '6064'], ['65-69岁', '6569'], ['70岁+', '70up']
  ]
  const ageData = {}
  for (const [label, code] of ageGroups) {
    // 生成随机但合理的数据
    ageData[`age0_${code}`] = Math.floor(Math.random() * 2000) + 500  // 到访
    ageData[`age1_${code}`] = Math.floor(Math.random() * 1500) + 300  // 居住
    ageData[`age2_${code}`] = Math.floor(Math.random() * 1000) + 200  // 工作
  }

  // 月出账金额字段 arpu0_50, arpu1_50, arpu2_50 等
  const arpuGroups = [
    ['50元以下', '50'], ['50-100元', '100'], ['100-150元', '150'],
    ['150-200元', '200'], ['200-250元', '250'], ['250元以上', 'up']
  ]
  const arpuData = {}
  for (const [label, suffix] of arpuGroups) {
    arpuData[`arpu0_${suffix}`] = Math.floor(Math.random() * 3000) + 1000  // 到访
    arpuData[`arpu1_${suffix}`] = Math.floor(Math.random() * 2000) + 500   // 居住
    arpuData[`arpu2_${suffix}`] = Math.floor(Math.random() * 1500) + 300   // 工作
  }

  // 1005 每小时段人口流量 - 使用用户提供的示例数据
  const hourData = []
  // 用户提供的正确表格数据（0-23点）
  const workdayVisit = [5416, 4867, 4769, 4718, 4760, 4885, 5113, 5631, 5718, 5692, 5796, 6537, 7511, 7125, 6659, 6611, 7154, 8176, 9213, 9233, 8695, 7729, 6771, 5937]
  const weekendVisit = [5251, 4739, 4596, 4550, 4531, 4510, 4719, 4998, 5326, 5743, 6462, 7140, 7838, 7748, 7570, 7598, 8068, 8924, 9696, 9440, 8637, 7605, 6679, 5872]
  const workdayAll = [20894, 19623, 19851, 19613, 19300, 19471, 19910, 20755, 19877, 19840, 18532, 21048, 22640, 20267, 19754, 19389, 20578, 23056, 23359, 22687, 22717, 22113, 21543, 19907]
  const weekendAll = [19954, 18946, 18970, 18963, 18632, 18712, 19028, 19305, 19740, 19541, 19938, 20807, 21719, 20992, 20095, 19888, 20665, 22105, 23196, 22720, 22287, 21544, 20944, 19336]
  for (let hour = 0; hour < 24; hour++) {
    // 工作日 (day_type = 0)
    hourData.push({
      hour_period: hour,
      day_type: 0,
      hour_visit: workdayVisit[hour],
      hour_all: workdayAll[hour]
    })
    // 周末 (day_type = 1)
    hourData.push({
      hour_period: hour,
      day_type: 1,
      hour_visit: weekendVisit[hour],
      hour_all: weekendAll[hour]
    })
  }

  // 1006 每日人流量及停留时长 - 生成31天数据（20260301-20260331）
  const dailyData1006 = []
  // 使用用户提供的日均值
  const dayVisitAvg = 38094
  const dayAllAvg = 75279
  const stay1Avg = 16309
  const stay2Avg = 21191
  const stay3Avg = 12830
  const stay4Avg = 9101
  const stay5Avg = 15846
  
  for (let day = 1; day <= 31; day++) {
    const dateStr = `202603${day.toString().padStart(2, '0')}`
    dailyData1006.push({
      date: dateStr,
      day_visit: dayVisitAvg,
      day_all: dayAllAvg,
      stay1: stay1Avg,
      stay2: stay2Avg,
      stay3: stay3Avg,
      stay4: stay4Avg,
      stay5: stay5Avg
    })
  }

  // 1007 每月到达次数分布 - 生成单列表格数据
  const monthlyReachData = [
    { reach1: 148854, reach2: 77753, reach3: 24244, reach4: 8098, reach5: 29905 }
  ]

  return {
    '1001': {
      p0_sum: p0Sum,
      pall_sum: pallSum,
      p3_sum: p3Sum,
      p4_sum: p4Sum,
      p5_sum: p5Sum,
      male0_sum: male0Sum,
      female0_sum: female0Sum,
      male1_sum: male1Sum,
      female1_sum: female1Sum,
      male2_sum: male2Sum,
      female2_sum: female2Sum,
      ...ageData,
      ...arpuData
    },
    '1005': hourData,
    '1006': dailyData1006,
    '1007': monthlyReachData,
    '1009': [
      // 消费力指数1
      { level: '1', pop_value: 1000, popu_type: 0 },
      { level: '1', pop_value: 600, popu_type: 1 },
      { level: '1', pop_value: 400, popu_type: 2 },
      // 消费力指数2
      { level: '2', pop_value: 1500, popu_type: 0 },
      { level: '2', pop_value: 900, popu_type: 1 },
      { level: '2', pop_value: 600, popu_type: 2 },
      // 消费力指数3
      { level: '3', pop_value: 2000, popu_type: 0 },
      { level: '3', pop_value: 1200, popu_type: 1 },
      { level: '3', pop_value: 800, popu_type: 2 },
      // 消费力指数4
      { level: '4', pop_value: 1800, popu_type: 0 },
      { level: '4', pop_value: 1080, popu_type: 1 },
      { level: '4', pop_value: 720, popu_type: 2 },
      // 消费力指数5
      { level: '5', pop_value: 1200, popu_type: 0 },
      { level: '5', pop_value: 720, popu_type: 1 },
      { level: '5', pop_value: 480, popu_type: 2 },
      // 消费力指数6
      { level: '6', pop_value: 800, popu_type: 0 },
      { level: '6', pop_value: 480, popu_type: 1 },
      { level: '6', pop_value: 320, popu_type: 2 },
      // 消费力指数7
      { level: '7', pop_value: 400, popu_type: 0 },
      { level: '7', pop_value: 240, popu_type: 1 },
      { level: '7', pop_value: 160, popu_type: 2 },
      // 消费力指数8
      { level: '8', pop_value: 200, popu_type: 0 },
      { level: '8', pop_value: 120, popu_type: 1 },
      { level: '8', pop_value: 80, popu_type: 2 }
    ],
    '1010': [
      // 到访人口 (popu_type: 0)
      { popu_type: 0, p0: 65387, p1: 2025, p2: 133910, p3: 18653, p4: 755 },
      // 居住人口 (popu_type: 1)
      { popu_type: 1, p0: 6523, p1: 0, p2: 12695, p3: 1874, p4: 82 },
      // 工作人口 (popu_type: 2)
      { popu_type: 2, p0: 2950, p1: 0, p2: 4973, p3: 417, p4: 208 }
    ],
    '1012': [
      // 到访人口 (popu_type: 0)
      { popu_type: 0, p1: 108403, p2: 33503, p3: 78824 },
      // 居住人口 (popu_type: 1)
      { popu_type: 1, p1: 9339, p2: 2225, p3: 9610 },
      // 工作人口 (popu_type: 2)
      { popu_type: 2, p1: 3914, p2: 1306, p3: 3328 }
    ],
    '1013': [
      // 到访人口 (popu_type: 0)
      { popu_type: 0, p1: 15432, p2: 103781, p3: 101517 },
      // 居住人口 (popu_type: 1)
      { popu_type: 1, p1: 1117, p2: 9070, p3: 10987 },
      // 工作人口 (popu_type: 2)
      { popu_type: 2, p1: 473, p2: 4413, p3: 3662 }
    ],
    '1011': [
      // 人口行业分布 - 到访人口 (popu_type: 0)
      { popu_type: 0, p1: 2604, p2: 3139, p3: 9482, p4: 36966, p5: 13206, p6: 33767, p7: 50043, p8: 54545, p9: 3643, p10: 13335 },
      // 人口行业分布 - 居住人口 (popu_type: 1)
      { popu_type: 1, p1: 414, p2: 410, p3: 2791, p4: 3248, p5: 1021, p6: 4206, p7: 5755, p8: 2247, p9: 305, p10: 777 },
      // 人口行业分布 - 工作人口 (popu_type: 2)
      { popu_type: 2, p1: 75, p2: 294, p3: 519, p4: 1306, p5: 770, p6: 1277, p7: 1617, p8: 1502, p9: 418, p10: 770 }
    ],
    '1015': [
      // 收入预测 (fname: 'income')
      { fname: 'income', popu_type: 0, p1: 33141, p2: 18566, p3: 38303, p4: 15755, p5: 114965 },
      { fname: 'income', popu_type: 1, p1: 2142, p2: 1531, p3: 3508, p4: 1011, p5: 12982 },
      { fname: 'income', popu_type: 2, p1: 705, p2: 686, p3: 1642, p4: 421, p5: 5094 },
      // 有房预测 (fname: 'house')
      { fname: 'house', popu_type: 0, p1: 13793, p2: 52521, p3: 26669, p4: 44704, p5: 83043 },
      { fname: 'house', popu_type: 1, p1: 1557, p2: 5400, p3: 1450, p4: 4573, p5: 8194 },
      { fname: 'house', popu_type: 2, p1: 663, p2: 1611, p3: 715, p4: 2325, p5: 3234 },
      // 有车预测 (fname: 'car')
      { fname: 'car', popu_type: 0, p1: 38034, p2: 78945, p3: 10645, p4: 23049, p5: 70057 },
      { fname: 'car', popu_type: 1, p1: 3454, p2: 6535, p3: 1128, p4: 1222, p5: 8835 },
      { fname: 'car', popu_type: 2, p1: 1196, p2: 2864, p3: 469, p4: 904, p5: 3115 }
    ]
  }
}

// 执行查询
async function executeQuery(event) {
  if (!storeInfo.value) return

  showConfirmDialog.value = false
  isLoading.value = true
  queryResult.value = null

  // 检查是否按下了Shift键（测试模式）
  const isTestMode = event && event.shiftKey

  try {
    if (isTestMode) {
      // 测试模式：使用模拟数据，不消耗配额
      await new Promise(resolve => setTimeout(resolve, 800)) // 模拟网络延迟
      queryResult.value = generateMockData()
      ElMessage.success('测试模式：使用模拟数据（不消耗配额）')
    } else {
      // 正常模式：调用真实API
      const radii = getRadiiInMeters()
      
      const res = await axios.post('/api/smartsteps/query', {
        centerLng: storeInfo.value.longitude,
        centerLat: storeInfo.value.latitude,
        radius: radii[0],
        radii: radii,
        // 请求全部23个服务
        services: ['1001','1003','1005','1006','1007','1008','1009','1010','1011','1012','1013','1014','1015','1019'],
        cityMonth: queryForm.value.cityMonth,
        quotaUsed: getQuotaToUse(),
        storeName: storeInfo.value.name,
        storeType: storeInfo.value.store_type || '已开业'
      })

      queryResult.value = res.data
      queryPurchaseId.value = res.data.purchaseId || null  // 保存本次查询记录ID，供导出
      if (res.data.refunded) {
        ElMessage.warning('该月份暂无数据，配额已返还')
      } else {
        ElMessage.success('查询成功!')
      }
      loadQuota()
    }
    
    // 显示查询结果对话框
    showQueryResultDialog.value = true
  } catch (e) {
    console.error('查询失败:', e)
    ElMessage.error(e.response?.data?.message || '查询失败')
  } finally {
    isLoading.value = false
  }
}

// ===== 查询结果导出 Excel / PDF（复用公共截图引擎） =====
const exportCaptureCompetitors = async (centerLat, centerLng, radius, competitors) => {
  try {
    return await captureMapToCanvas(centerLat, centerLng, radius, competitors || [], 14)
  } catch (e) { console.warn('竞品截图失败:', e) }
  return null
}

const exportCaptureShopping = async (centerLat, centerLng, centers) => {
  try {
    return await captureShoppingCenterMap(centerLat, centerLng, centers || [], 14)
  } catch (e) { console.warn('购物中心截图失败:', e) }
  return null
}

const exportCaptureMapOnly = async (centerLat, centerLng, radius) => {
  try {
    return await captureMapOnlyCanvas(centerLat, centerLng, radius)
  } catch (e) { console.warn('地图截图失败:', e) }
  return null
}

// 从 queryPurchaseId 拉取详情并导出
const exportResultReport = async (type) => {
  if (!queryPurchaseId.value) {
    ElMessage.info('本次查询未生成记录，无法导出')
    return null
  }
  try {
    const { data } = await axios.get(`/api/purchase/${queryPurchaseId.value}`)
    currentDetail.value = data
    return data
  } catch (e) {
    ElMessage.error('获取查询详情失败: ' + (e.response?.data?.message || e.message))
    return null
  }
}

const handleExportExcelResult = async () => {
  exportingExcel.value = true
  try {
    ElMessage.info('正在生成Excel报表，请稍候...')
    const detail = await exportResultReport('excel')
    if (!detail) return
    const id = queryPurchaseId.value

    // 获取地图数据并截图
    let competitorScreenshot = null, shoppingCenterScreenshot = null, mapScreenshot = null
    try {
      const [compResp, shopResp] = await Promise.all([
        axios.get(`/api/purchase/${id}/competitors-for-map`),
        axios.get(`/api/purchase/${id}/shopping-centers-for-map`)
      ])
      const mapData = compResp.data
      const centerLat = mapData.center.lat
      const centerLng = mapData.center.lng
      competitorScreenshot = await exportCaptureCompetitors(centerLat, centerLng, 3000, mapData.competitors)
      try {
        const centerList = (shopResp.data.centers && Array.isArray(shopResp.data.centers)) ? shopResp.data.centers : []
        shoppingCenterScreenshot = await exportCaptureShopping(centerLat, centerLng, centerList)
      } catch (scErr) { console.warn('购物中心截图失败:', scErr) }
      try {
        const actualRadius = Array.isArray(detail.radii) ? detail.radii[0] : 3000
        mapScreenshot = await exportCaptureMapOnly(centerLat, centerLng, actualRadius)
      } catch (mErr) { console.warn('地图截图失败:', mErr) }
    } catch (mapErr) { console.warn('地图数据获取失败:', mapErr) }

    let response
    if (competitorScreenshot || shoppingCenterScreenshot) {
      response = await axios.post(`/api/purchase/${id}/export-map-excel`, {
        competitorScreenshot, shoppingCenterScreenshot, mapScreenshot
      }, { responseType: 'blob' })
    } else {
      response = await axios.get(`/api/purchase/${id}/export-excel`, { responseType: 'blob' })
    }

    const disposition = response.headers['content-disposition']
    let fileName = `${detail.store_name || '门店'}_${detail.city_month || ''}_商圈数据.xlsx`
    if (disposition) {
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
      if (match) fileName = decodeURIComponent(match[1])
    }
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url; link.download = fileName; link.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('Excel导出成功')
  } catch (e) {
    console.error('导出Excel失败:', e)
    ElMessage.error(e.response?.data?.message || '导出Excel失败')
  } finally {
    exportingExcel.value = false
  }
}

const handleExportPDFResult = async () => {
  exportingPdf.value = true
  try {
    ElMessage.info('正在生成报表PDF，请稍候...')
    const detail = await exportResultReport('pdf')
    if (!detail) return
    const id = queryPurchaseId.value

    let competitorScreenshot = null, shoppingCenterScreenshot = null, mapScreenshot = null
    try {
      const [compResp, shopResp] = await Promise.all([
        axios.get(`/api/purchase/${id}/competitors-for-map`),
        axios.get(`/api/purchase/${id}/shopping-centers-for-map`)
      ])
      const mapData = compResp.data
      const centerLat = mapData.center.lat
      const centerLng = mapData.center.lng
      competitorScreenshot = await exportCaptureCompetitors(centerLat, centerLng, 3000, mapData.competitors)
      try {
        const centerList = (shopResp.data.centers && Array.isArray(shopResp.data.centers)) ? shopResp.data.centers : []
        shoppingCenterScreenshot = await exportCaptureShopping(centerLat, centerLng, centerList)
      } catch (scErr) { console.warn('购物中心截图失败:', scErr) }
      try {
        const actualRadius = Array.isArray(detail.radii) ? detail.radii[0] : 3000
        mapScreenshot = await exportCaptureMapOnly(centerLat, centerLng, actualRadius)
      } catch (mErr) { console.warn('地图截图失败:', mErr) }
    } catch (mapErr) { console.warn('地图数据获取失败:', mapErr) }

    const radiiStr = Array.isArray(detail.radii) ? detail.radii.join('_') + '米' : (detail.radii || '未知') + '米'
    const response = await axios.post(`/api/purchase/${id}/export-pdf-report`, {
      competitorScreenshot, shoppingCenterScreenshot, mapScreenshot,
      filename: `${detail.store_name || '门店'}_${radiiStr}_${detail.city_month || ''}_报表`
    }, { responseType: 'blob' })

    const disposition = response.headers['content-disposition']
    let pdfName = `${detail.store_name || '门店'}_${radiiStr}_${detail.city_month || ''}_报表.pdf`
    if (disposition) {
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
      if (match) pdfName = decodeURIComponent(match[1])
    }
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url; link.download = pdfName; link.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('报表PDF导出成功')
  } catch (e) {
    console.error('报表PDF导出失败:', e)
    ElMessage.error('报表PDF导出失败: ' + (e.response?.data?.message || e.message))
  } finally {
    exportingPdf.value = false
  }
}

// 格式化结果 - 与已购报表弹窗样式一致
function formatResult(data) {
  if (!data) return '<p>暂无数据</p>'
  
  // 使用与已购报表弹窗相同的格式化函数
  // 如果data包含data属性（查询结果结构），使用它
  const resultData = data.data || data
  
  // 调用已购报表弹窗的格式化函数
  return formatResultData(resultData)
}

// 关闭
function onClose() {
  queryResult.value = null
  emit('close')
}

// 从数据中通过正则匹配取值（handleDataInsight 依赖）
const findFieldValue = (data, pattern) => {
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== 'number') continue
    if (pattern.test(key)) return val
  }
  return 0
}

// ====== 数据洞察函数 ======

// 处理数据洞察
const handleDataInsight = async () => {
  if (!resultData.value) {
    ElMessage.info('暂无数据可供分析')
    return
  }
  insightLoading.value = true
  insights.value = []

  try {
    let data = resultData.value
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch (e) { data = null }
    }
    if (data && data.apiResult) {
      data = data.apiResult
    }
    if (!data || typeof data !== 'object') {
      insights.value = [{ type: 'info', text: '暂无足够数据进行分析' }]
      return
    }

    const result = []

    // 1001 全量人口分析
    if (data['1001'] && typeof data['1001'] === 'object') {
      const p0 = findFieldValue(data['1001'], /^P0_SUM\d*$/i)
      const p1 = findFieldValue(data['1001'], /^P1_SUM\d*$/i)
      const p2 = findFieldValue(data['1001'], /^P2_SUM\d*$/i)
      const p3 = findFieldValue(data['1001'], /^P3_SUM\d*$/i)
      const total = p0 + p1 + p2 + p3
      if (total > 0) {
        const liveRatio = Math.round((p1 / total) * 100)
        const workRatio = Math.round((p2 / total) * 100)
        const outPopRatio = Math.round((p3 / total) * 100)
        const male0 = findFieldValue(data['1001'], /^MALE0_SUM\d*$/i)
        const female0 = findFieldValue(data['1001'], /^FEMALE0_SUM\d*$/i)
        if (liveRatio > 40) {
          result.push({ type: 'positive', text: `居住人口占比 ${liveRatio}%，该区域为高密度居住区，适合面向居民的生活服务类业态` })
        } else if (workRatio > 40) {
          result.push({ type: 'positive', text: `工作人口占比 ${workRatio}%，该区域为商务办公区，适合面向白领的餐饮/零售业态` })
        } else {
          result.push({ type: 'info', text: `居住人口 ${liveRatio}% / 工作人口 ${workRatio}%，属于混合型商圈` })
        }
        if (outPopRatio > 15) {
          result.push({ type: 'warning', text: `外省到访人口占比 ${outPopRatio}%，区域跨省吸引力较强` })
        }
        if (male0 > 0 && female0 > 0) {
          const genderRatio = Math.round((male0 / female0) * 100)
          if (genderRatio > 120) {
            result.push({ type: 'info', text: `男性到访比例 ${genderRatio}%，以男性客流为主` })
          } else if (genderRatio < 80) {
            result.push({ type: 'info', text: `女性到访比例 ${Math.round((female0 / male0) * 100)}%，以女性客流为主` })
          }
        }
      }
    }

    // 1005 小时段分析
    if (data['1005'] && Array.isArray(data['1005']) && data['1005'].length > 0) {
      const weekdays = data['1005'].filter(d => d.day_type === 0)
      if (weekdays.length > 0) {
        const peak = weekdays.reduce((max, d) => (d.hour_visit || 0) > (max.hour_visit || 0) ? d : max, weekdays[0])
        if (peak) {
          result.push({ type: 'positive', text: `工作日客流高峰在 ${peak.hour_period} 点，建议在该时段加大推广力度` })
        }
      }
    }

    // 1010 教育水平分析
    if (data['1010'] && Array.isArray(data['1010']) && data['1010'].length > 0) {
      const visit = data['1010'].find(d => String(d.popu_type) === '0')
      if (visit) {
        const p2 = visit.p2 || 0; const p3 = visit.p3 || 0; const p4 = visit.p4 || 0
        const college = p2 + p3 + p4
        const total = (visit.p0 || 0) + (visit.p1 || 0) + college
        if (total > 0) {
          const collegeRatio = Math.round((college / total) * 100)
          if (collegeRatio > 50) {
            result.push({ type: 'positive', text: `本科及以上学历占比 ${collegeRatio}%，高学历人群集聚区域` })
          } else if (collegeRatio > 30) {
            result.push({ type: 'info', text: `本科及以上学历占比 ${collegeRatio}%，教育水平中等偏上` })
          }
        }
      }
    }

    // 1009 消费水平分析
    if (data['1009'] && Array.isArray(data['1009']) && data['1009'].length > 0) {
      const highSpend = data['1009'].filter(d => Number(d.level) >= 6 && String(d.popu_type) === '0')
      const totalSpend = data['1009'].filter(d => String(d.popu_type) === '0')
      if (totalSpend.length > 0) {
        const highTotal = highSpend.reduce((s, d) => s + (Number(d.pop_value) || 0), 0)
        const totalVal = totalSpend.reduce((s, d) => s + (Number(d.pop_value) || 0), 0)
        if (totalVal > 0) {
          const highRatio = Math.round((highTotal / totalVal) * 100)
          if (highRatio > 30) {
            result.push({ type: 'positive', text: `高消费人群（指数6-8）占比 ${highRatio}%，消费力强劲` })
          }
        }
      }
    }

    // 1006 停留时长分析
    if (data['1006'] && Array.isArray(data['1006']) && data['1006'].length > 0) {
      let stayLong = 0, stayTotal = 0
      data['1006'].forEach(d => {
        stayTotal += (d.stay1 || 0) + (d.stay2 || 0) + (d.stay3 || 0) + (d.stay4 || 0) + (d.stay5 || 0)
        stayLong += (d.stay4 || 0) + (d.stay5 || 0)
      })
      if (stayTotal > 0) {
        const longStayRatio = Math.round((stayLong / stayTotal) * 100)
        if (longStayRatio > 40) {
          result.push({ type: 'positive', text: `长时间停留（2小时以上）占比 ${longStayRatio}%，属于高粘性客流` })
        } else if (longStayRatio > 20) {
          result.push({ type: 'info', text: `长时间停留（2小时以上）占比 ${longStayRatio}%，客流粘性中等` })
        }
      }
    }

    // 1011 行业分布分析
    if (data['1011'] && Array.isArray(data['1011']) && data['1011'].length > 0) {
      const visit = data['1011'].find(d => String(d.popu_type) === '0')
      if (visit) {
        const industryLabels = ['金融从业者', '医务人员', '公务员&事业单位', '白领及一般职员', '工人及服务业人员', '教师', '农民及其他', '网约车司机', '外卖员', '快递员']
        const industryKeys = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']
        let maxVal = 0, maxIdx = -1
        industryKeys.forEach((k, i) => {
          const val = Number(visit[k]) || 0
          if (val > maxVal) { maxVal = val; maxIdx = i }
        })
        if (maxIdx >= 0) {
          result.push({ type: 'info', text: `到访人群中占比最高的行业为"${industryLabels[maxIdx]}"` })
        }
      }
    }

    insights.value = result.length > 0 ? result : [{ type: 'info', text: '暂无足够数据进行分析' }]
  } catch (e) {
    console.error('数据洞察分析失败:', e)
    insights.value = [{ type: 'info', text: '数据分析时发生错误，请稍后重试' }]
  } finally {
    insightLoading.value = false
  }
}

// 监听store变化
// 监听 store 变化，初始化门店信息
watch(() => props.store, (newStore) => {
  if (newStore) {
    storeInfo.value = { ...newStore }
    // 在 nextTick 后加载数据，确保 DOM 已更新
    nextTick(() => {
      loadAvailableMonths()
      loadQuota()
      loadStorePurchases()
    })
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

.result-dialog-content {
  max-height: 70vh;
  overflow-y: auto;
}

.no-result {
  text-align: center;
  padding: 30px;
  color: #999;
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
.result-dialog-content :deep(.data-table) {
  width: 100%;
  border-collapse: collapse !important;
  margin: 8px 0;
  font-size: 13px;
  border: 1px solid #ddd !important;
}

.result-dialog-content :deep(.data-table th),
.result-dialog-content :deep(.data-table td) {
  padding: 10px 12px;
  border: 1px solid #ddd !important;
}

.result-dialog-content :deep(.data-table th) {
  background: #f8f5fa !important;
  color: #764ba2 !important;
  font-weight: 600 !important;
}

.result-dialog-content :deep(.data-table td) {
  background: #fff !important;
  color: #333 !important;
}

.result-dialog-content :deep(.data-table tr:hover td) {
  background: #f9f9ff !important;
}

.result-dialog-content :deep(.data-table td.num) {
  text-align: right !important;
  font-family: 'Monaco', 'Menlo', monospace !important;
}

.result-dialog-content :deep(.detail-result) {
  margin-bottom: 16px;
}

.result-dialog-content :deep(.detail-result h4) {
  margin: 16px 0 10px 0;
  color: #333;
  font-size: 15px;
}

.result-dialog-content :deep(.pop-group) {
  margin-bottom: 16px;
}

.result-dialog-content :deep(.group-header) {
  font-weight: 600;
  color: #764ba2;
  margin-bottom: 8px;
}

.result-dialog-content :deep(.group-total) {
  float: right;
  color: #764ba2;
}

/* 已购报表弹窗表格样式 */
.detail-content :deep(.data-table) {
  width: 100%;
  border-collapse: collapse !important;
  margin: 8px 0;
  font-size: 13px;
  border: 1px solid #ddd !important;
}

.detail-content :deep(.data-table th),
.detail-content :deep(.data-table td) {
  padding: 10px 12px;
  border: 1px solid #ddd !important;
}

.detail-content :deep(.data-table th) {
  background: #f8f5fa !important;
  color: #764ba2 !important;
  font-weight: 600 !important;
}

.detail-content :deep(.data-table td) {
  background: #fff !important;
  color: #333 !important;
}

.detail-content :deep(.data-table tr:hover td) {
  background: #f9f9ff !important;
}

.detail-content :deep(.data-table td.num) {
  text-align: right !important;
  font-family: 'Monaco', 'Menlo', monospace !important;
}

.detail-content :deep(.detail-result) {
  margin-bottom: 16px;
}

.detail-content :deep(.detail-result h4) {
  margin: 16px 0 10px 0;
  color: #333;
  font-size: 15px;
}

.detail-content :deep(.pop-group) {
  margin-bottom: 16px;
}

.detail-content :deep(.group-header) {
  font-weight: 600;
  color: #764ba2;
  margin-bottom: 8px;
}

/* ====== 数据洞察样式（从 MyAccountView 移植）====== */

.dialog-header-flex {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 16px;
  font-weight: 600;
}

.dialog-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.btn-insight {
  --el-button-bg-color: #f08080;
  --el-button-border-color: #f08080;
  --el-button-hover-bg-color: #e06060;
  --el-button-hover-border-color: #e06060;
  --el-button-active-bg-color: #d05050;
  --el-button-active-border-color: #d05050;
}

/* 洞察区域 */
.insight-section {
  margin-bottom: 16px;
  padding: 12px;
  background: #f9f8ff;
  border: 1px solid #e8e0f0;
  border-radius: 8px;
}

.insight-section h4 {
  margin: 0 0 10px 0;
  font-size: 14px;
  color: #333;
}

.insight-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}

.insight-item:last-child {
  margin-bottom: 0;
}

.insight-positive {
  background: #f0f9eb;
  border-left: 3px solid #67c23a;
}

.insight-warning {
  background: #fef0f0;
  border-left: 3px solid #f56c6c;
}

.insight-info {
  background: #ecf5ff;
  border-left: 3px solid #409eff;
}

.insight-icon {
  flex-shrink: 0;
  font-size: 15px;
}

.insight-text {
  color: #333;
}

</style>