<template>
  <el-dialog
    v-model="dialogVisible"
    title="联通人口数据｜批量"
    width="550px"
    draggable
    @close="onClose"
  >
    <div class="store-list" v-if="localStores.length > 0">
      <div class="store-list-header">已选门店（{{ localStores.length }}家）</div>
      <div class="store-names">
        <el-tag
          v-for="s in localStores"
          :key="s.id"
          size="small"
          class="store-tag"
          closable
          @close="removeStore(s.id)"
        >{{ s.name }}</el-tag>
      </div>
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
      <span>单位: 公里 ｜ 数据月份以联通已产出月份为准（通常滞后1~2个月）</span>
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

    <template #footer>
      <el-button
        v-if="exportAvailable"
        type="success"
        :loading="exporting"
        @click="exportExcel"
      >
        <el-icon style="margin-right: 4px;"><Download /></el-icon>导出合并 Excel
      </el-button>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button 
        type="primary" 
        @click="handlePurchase"
        :disabled="!canQuery || isLoading"
        :loading="isLoading"
      >
        {{ isLoading ? '查询中...' : '购买' }}
      </el-button>
    </template>
  </el-dialog>

  <!-- 确认对话框 -->
  <el-dialog
    v-model="showConfirm"
    title="确认订单"
    width="450px"
  >
    <div class="confirm-content">
      <p>您即将为 <strong>{{ localStores.length }}</strong> 家门店批量购买联通人口数据：</p>
      <ul>
        <li><strong>门店数:</strong> {{ localStores.length }}家</li>
        <li><strong>查询半径:</strong> {{ getRadiiDisplay() }}</li>
        <li><strong>数据年月:</strong> {{ selectedMonthLabel }}</li>
        <li><strong>预计消耗:</strong> {{ getTotalQuota() }}次（{{ localStores.length }}家 × {{ getQuotaPerStore() }}个半径）</li>
      </ul>
    </div>
    <template #footer>
      <el-button @click="showConfirm = false">取消</el-button>
      <el-button type="primary" @click="executeBatchQuery" :loading="isLoading">
        确认购买
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Download } from '@element-plus/icons-vue'
import axios from 'axios'
import { fetchAvailableMonths } from '@/utils/smartstepsMonths'

const props = defineProps({
  visible: Boolean,
  stores: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:visible', 'close'])

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const queryForm = ref({ radius1: 1, radius2: 0, radius3: 0, cityMonth: '' })
const localStores = ref([])
// 从props同步门店列表，开启时拷贝一份用于本地编辑
watch(() => props.stores, (val) => {
  localStores.value = [...val]
}, { immediate: true })

function removeStore(id) {
  localStores.value = localStores.value.filter(s => s.id !== id)
}
const availableMonths = ref([])
const quotaInfo = ref(null)
const isLoading = ref(false)
const showConfirm = ref(false)
const exportAvailable = ref(false)   // 本次批量购买成功后开放导出
const exporting = ref(false)
const exportPayload = ref(null)      // 快照：导出时精确对应本次购买组合（防表单被改）

// 计算属性
const canQuery = computed(() => {
  const hasRadius = queryForm.value.radius1 > 0 || queryForm.value.radius2 > 0 || queryForm.value.radius3 > 0
  return hasRadius && queryForm.value.cityMonth && quotaInfo.value?.available > 0
})

const selectedMonthLabel = computed(() => {
  const month = availableMonths.value.find(m => m.value === queryForm.value.cityMonth)
  return month ? month.label : ''
})

function getQuotaPerStore() {
  let count = 0
  if (queryForm.value.radius1 > 0) count++
  if (queryForm.value.radius2 > 0) count++
  if (queryForm.value.radius3 > 0) count++
  return count
}

function getTotalQuota() {
  return getQuotaPerStore() * localStores.value.length
}

function getRadiiDisplay() {
  const radii = []
  if (queryForm.value.radius1 > 0) radii.push(`${queryForm.value.radius1}公里`)
  if (queryForm.value.radius2 > 0) radii.push(`${queryForm.value.radius2}公里`)
  if (queryForm.value.radius3 > 0) radii.push(`${queryForm.value.radius3}公里`)
  return radii.length > 0 ? radii.join(', ') : '无'
}

function getRadiiInMeters() {
  const radii = []
  if (queryForm.value.radius1 > 0) radii.push(Math.round(queryForm.value.radius1 * 1000))
  if (queryForm.value.radius2 > 0) radii.push(Math.round(queryForm.value.radius2 * 1000))
  if (queryForm.value.radius3 > 0) radii.push(Math.round(queryForm.value.radius3 * 1000))
  return radii
}

// 加载可选月份（优先取联通 getCityMonth 实测可用月份，失败降级本地最近两月）
async function loadAvailableMonths() {
  availableMonths.value = await fetchAvailableMonths()
  if (availableMonths.value.length > 0) queryForm.value.cityMonth = availableMonths.value[0].value
}

async function loadQuota() {
  try {
    const res = await axios.get('/api/purchase/quota')
    quotaInfo.value = res.data
  } catch (e) {
    quotaInfo.value = { total: 0, used: 0, available: 0 }
  }
}

// 点击购买：先检查配额，再弹出确认
function handlePurchase() {
  const total = getTotalQuota()
  if (!quotaInfo.value || quotaInfo.value.available < total) {
    ElMessage.warning(`剩余次数不足！需要 ${total} 次，当前剩余 ${quotaInfo.value?.available || 0} 次`)
    return
  }
  showConfirm.value = true
}

// 按门店×半径逐次请求，每次1个半径，确保购买履历中每条记录对应一个半径
async function executeBatchQuery() {
  showConfirm.value = false
  isLoading.value = true

  try {
    const radii = getRadiiInMeters()
    let successCount = 0
    let failCount = 0

    for (const store of localStores.value) {
      for (const r of radii) {
        try {
          const res = await axios.post('/api/smartsteps/query', {
            centerLng: store.longitude,
            centerLat: store.latitude,
            radius: r,
            radii: [r],
            services: ['1001','1003','1005','1006','1007','1008','1009','1010','1011','1012','1013','1014','1015','1019'],
            cityMonth: queryForm.value.cityMonth,
            quotaUsed: 1,
            storeName: store.name,
            storeType: store.store_type || '已开业'
          })
          if (res.data.refunded) {
            console.log(`[批量购买] ${store.name} 半径${r}m: 暂无数据（已返还配额）`)
            failCount++
          } else {
            successCount++
          }
        } catch (e) {
          console.error(`[批量购买] ${store.name} 半径${r}m 失败:`, e)
          failCount++
        }
      }
    }

    if (successCount > 0) {
      ElMessage.success(`批量查询完成：成功获取 ${successCount} 次，无数据 ${failCount} 次（不消耗配额）`)
      loadQuota()
      // 快照本次组合 → 开放「导出合并 Excel」
      exportPayload.value = {
        stores: localStores.value.map(s => ({ name: s.name, lng: s.longitude, lat: s.latitude })),
        radii: radii,
        cityMonth: queryForm.value.cityMonth
      }
      exportAvailable.value = true
    } else if (failCount > 0) {
      ElMessage.warning('批量查询完成，所选月份数据全部为空，配额已全部返还')
      loadQuota()
    } else {
      ElMessage.error('全部查询失败')
    }
  } catch (e) {
    ElMessage.error('批量查询失败: ' + e.message)
  } finally {
    isLoading.value = false
  }
}

// 导出合并 Excel：把本次批量购买的每个「门店×半径」购买履历渲染成一张 xlsx（内容=查询结果详情页）
// 数据源为已购买履历（purchases.result_data），不重复调用联通 API、不消耗配额
async function exportExcel() {
  if (!exportPayload.value) return
  exporting.value = true
  try {
    const payload = exportPayload.value
    const res = await axios.post('/api/purchase/export-merged', payload, { responseType: 'blob', timeout: 120000 })
    const fileName = `批量购买_${payload.cityMonth}_${payload.stores.length}店${payload.radii.length}半径.xlsx`
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    ElMessage.success(`已导出 ${fileName}（含 ${payload.stores.length * payload.radii.length} 个门店×半径组合）`)
  } catch (e) {
    ElMessage.error('导出失败: ' + (e.response?.data?.message || e.message))
  } finally {
    exporting.value = false
  }
}

function onClose() {
  exportAvailable.value = false
  exportPayload.value = null
  emit('close')
}

watch(() => props.visible, (val) => {
  if (val) {
    nextTick(() => {
      loadAvailableMonths()
      loadQuota()
    })
  }
}, { immediate: true })
</script>

<style scoped>
.store-list {
  padding: 10px 15px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 10px;
}
.store-list-header {
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
}
.store-names {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.store-tag {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
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
  font-size: 13px;
  color: #666;
  margin-bottom: 4px;
}
.quota-number {
  font-size: 28px;
  font-weight: bold;
  color: #409eff;
}
.quota-display .quota-label {
  font-size: 14px;
  color: #999;
  margin-left: 4px;
}
.confirm-content ul {
  padding-left: 20px;
  line-height: 2;
}
</style>
