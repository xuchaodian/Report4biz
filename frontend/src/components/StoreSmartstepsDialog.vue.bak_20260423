spawn ssh -o StrictHostKeyChecking=no root@47.103.216.151 cat /var/www/Report4biz/frontend/src/components/StoreSmartstepsDialog.vue

root@47.103.216.151's password: 
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
        ð 已购报表 ({{ storePurchases.length }})
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
        <span class="result-title">ð 查询结果</span>
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
        <h4>ð 人口概览</h4>
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
const excludeServices = ['1004', '1016', '1003', '1008', '1019', '1002']

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
      services: ['1001','1003','1005','1006','1007','1008','1009','1010','1011','1012','1013','1014','1015','1017','1018','1019','1020','1021','1022','1023'],
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
