<template>
  <div class="sales-forecast-view">
    <el-card shadow="never" class="fc-card">
      <template #header>
        <div class="fc-header">
          <span>📈 销售预测</span>
          <span class="fc-sub">基于已开业门店真实销售，类比预测候选门店年销售额（L1 类比法）</span>
        </div>
      </template>

      <!-- 候选门店选择 -->
      <div class="fc-toolbar">
        <el-input v-model="keyword" placeholder="搜索候选门店" style="width: 220px" clearable>
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="filterCity" placeholder="按城市" style="width: 150px" clearable>
          <el-option v-for="c in cityList" :key="c" :label="c" :value="c" />
        </el-select>
        <el-select v-model="filterBought" placeholder="已购联通人口" style="width: 160px" clearable>
          <el-option label="已购联通人口" value="1" />
          <el-option label="未购买" value="0" />
        </el-select>
        <span class="fc-tip">{{ filteredCandidates.length }} 个候选门店（重点候选/一般候选）</span>
      </div>

      <el-table :data="filteredCandidates" v-loading="loading" max-height="380" size="small">
        <el-table-column prop="storeCode" label="编号" width="90" />
        <el-table-column prop="name" label="门店名称" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.name }}
            <el-tag v-if="row.hasProfile && row.radii.length" size="small" type="success" style="margin-left: 6px;">已购联通人口（{{ row.radii.map(r => r + 'm').join('、') }}）</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="city" label="城市" width="90" />
        <el-table-column prop="storeType" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.storeType === '重点候选' ? 'danger' : 'warning'">{{ row.storeType }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="storeArea" label="面积(㎡)" width="90" align="right">
          <template #default="{ row }">{{ row.storeArea || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button type="primary" size="small" :loading="predictingId === row.id" @click="handlePredict(row)">预测</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 预测结果 -->
      <div v-if="result" class="fc-result">
        <div class="fc-result-card">
          <div class="fc-result-title">{{ result.candName }} · 年销售额预测</div>
          <div class="fc-result-main">
            <span class="fc-amount">{{ result.predictCompWan }}</span>
            <span class="fc-unit">万元 / 年</span>
            <el-tag size="small" type="warning" style="margin-left: 10px;">置信度 ±{{ result.conf }}%</el-tag>
          </div>
          <div class="fc-result-range">参考区间：{{ result.rangeWan[0] }} ~ {{ result.rangeWan[1] }} 万元（含外卖口径）</div>
          <div class="fc-result-meta">
            <div>匹配方式：{{ result.levelName }}</div>
            <div v-if="result.candDistrict">商圈归属：{{ result.candDistrict.city }} · {{ result.candDistrict.name }}</div>
            <div v-if="result.radiusPopulation">常住人口：{{ fmtPop(result.radiusPopulation) }}</div>
            <div>参考门店 {{ result.refCount }} 家</div>
          </div>
        </div>

        <div class="fc-refs">
          <div class="fc-refs-title">类比参照门店（真实销售）</div>
          <el-table :data="result.refs" size="small" max-height="220">
            <el-table-column prop="name" label="门店" min-width="160" show-overflow-tooltip />
            <el-table-column prop="city" label="城市" width="80" />
            <el-table-column prop="area" label="面积(㎡)" width="90" align="right" />
            <el-table-column prop="year" label="年份" width="70" align="center" />
            <el-table-column label="年销售(万)" width="110" align="right">
              <template #default="{ row }">{{ (row.salesAmount / 10000).toFixed(1) }}</template>
            </el-table-column>
            <el-table-column label="坪效(元/㎡)" width="110" align="right">
              <template #default="{ row }">{{ row.pingxiao.toLocaleString() }}</template>
            </el-table-column>
            <el-table-column v-if="result.refs.some(r => r.sim != null)" label="相似度" width="80" align="center">
              <template #default="{ row }">{{ row.sim != null ? row.sim + '%' : '-' }}</template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <el-empty v-else-if="!loading && filteredCandidates.length === 0" description="暂无候选门店（重点候选/一般候选）" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'

const loading = ref(false)
const candidates = ref([])
const keyword = ref('')
const filterCity = ref('')
const filterBought = ref('')
const predictingId = ref(null)
const result = ref(null)
// 格式化三档常住人口：1km 12.3万 / 3km 45.6万 / 5km 89.0万
const fmtPop = (pop) => {
  if (!pop) return ''
  const w = (v) => (v / 10000).toFixed(1) + '万'
  const parts = []
  if (pop['1000']) parts.push('1km ' + w(pop['1000']))
  if (pop['3000']) parts.push('3km ' + w(pop['3000']))
  if (pop['5000']) parts.push('5km ' + w(pop['5000']))
  return parts.join(' / ')
}

const cityList = computed(() => [...new Set(candidates.value.map(c => c.city).filter(Boolean))])

const filteredCandidates = computed(() => {
  let list = candidates.value
  if (keyword.value) {
    const k = keyword.value.trim()
    list = list.filter(c => (c.name || '').includes(k) || (c.storeCode || '').includes(k))
  }
  if (filterCity.value) list = list.filter(c => c.city === filterCity.value)
  if (filterBought.value === '1') list = list.filter(c => c.hasProfile)
  if (filterBought.value === '0') list = list.filter(c => !c.hasProfile)
  return list
})

const loadCandidates = async () => {
  loading.value = true
  try {
    const res = await axios.get('/api/sales-forecast/candidates')
    candidates.value = res.data?.candidates || []
  } catch (e) {
    ElMessage.error('加载候选门店失败：' + (e.response?.data?.message || e.message))
  } finally {
    loading.value = false
  }
}

const handlePredict = async (row) => {
  predictingId.value = row.id
  result.value = null
  try {
    const res = await axios.post('/api/sales-forecast/predict', { storeId: row.id })
    const d = res.data
    if (d.success && d.status === 'ok') {
      result.value = d
    } else {
      ElMessage.warning(d.message || '暂时无法预测')
    }
  } catch (e) {
    ElMessage.error('预测失败：' + (e.response?.data?.message || e.message))
  } finally {
    predictingId.value = null
  }
}

onMounted(loadCandidates)
</script>

<style scoped>
.sales-forecast-view {
  padding: 16px;
  max-width: 1080px;
  margin: 0 auto;
}
.fc-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 16px;
  font-weight: 500;
}
.fc-sub {
  font-size: 12px;
  color: #909399;
  font-weight: 400;
}
.fc-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.fc-tip {
  font-size: 12px;
  color: #909399;
  margin-left: auto;
}
.fc-result {
  margin-top: 16px;
  border-top: 1px dashed #e0e0e0;
  padding-top: 16px;
}
.fc-result-card {
  background: #f5f7fa;
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 14px;
}
.fc-result-title {
  font-size: 14px;
  color: #555;
  margin-bottom: 8px;
}
.fc-result-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.fc-amount {
  font-size: 32px;
  font-weight: 500;
  color: #409eff;
}
.fc-unit {
  font-size: 14px;
  color: #666;
}
.fc-result-range {
  font-size: 13px;
  color: #666;
  margin-top: 4px;
}
.fc-result-meta {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: 12px;
  color: #909399;
}
.fc-refs-title {
  font-size: 13px;
  color: #333;
  margin-bottom: 8px;
  font-weight: 500;
}
</style>
