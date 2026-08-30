<template>
  <div class="sales-forecast-view">
    <el-card shadow="never" class="fc-card">
      <template #header>
        <div class="fc-header">
          <span>📈 销售预测</span>
          <span class="fc-sub">基于已开业门店真实销售，预测候选门店年销售额（引擎按样本量自动升级：L1 类比 → L2 回归 → L3 机器学习）</span>
        </div>
      </template>

      <!-- 样本量提示条 -->
      <el-alert v-if="stats && stats.samples < stats.l2" type="info" :closable="false" style="margin-bottom: 12px;">
        <template #title>
          📊 当前销售样本 {{ stats.samples }} 行（已开业店 {{ stats.stores }} 家）——距离 <b>L2 回归</b>（{{ stats.l2 }} 行）还差 <b>{{ stats.l2Gap }}</b> 行，录满后自动升级（预测更准）
          <el-button size="small" type="primary" link style="margin-left: 8px;" @click="$router.push('/data')">去录入销售 ➜</el-button>
        </template>
      </el-alert>
      <el-alert v-else-if="stats && stats.samples >= stats.l2 && stats.samples < stats.l3" type="success" :closable="false" style="margin-bottom: 12px;">
        <template #title>
          ✅ L2 回归已启用（{{ stats.samples }} 行样本）——距离 <b>L3 机器学习</b>（{{ stats.l3 }} 行）还差 {{ stats.l3Gap }} 行，持续录入可解锁开店影响模拟
          <el-button size="small" type="primary" link style="margin-left: 8px;" @click="$router.push('/data')">去录入销售 ➜</el-button>
        </template>
      </el-alert>

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

      <!-- 参照店圈定（可选精调，双轨：不圈定 = 系统全自动） -->
      <div class="fc-ref-panel">
        <div class="fc-ref-head" @click="openRefPanel">
          <span class="fc-ref-title">🔧 参照店圈定</span>
          <el-tag size="small" :type="refMode === 'custom' ? 'warning' : 'info'" style="margin-left: 8px;">
            {{ refMode === 'custom' ? '自定义（已圈定 ' + refSelected.length + ' 家）' : '系统自动推荐' }}
          </el-tag>
          <span class="fc-tip">类比基准人工化：勾选想用的参照店，预测时只在这些店里类比（不勾 = 全自动）</span>
        </div>
        <div v-if="refOpen" class="fc-ref-body">
          <div class="fc-toolbar">
            <el-input v-model="refKeyword" placeholder="搜索参照店" style="width: 200px" size="small" clearable>
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button size="small" @click="resetRefSelection">恢复系统推荐</el-button>
            <span class="fc-tip">{{ refPool.length }} 家参照店（已开业 + 有年度销售记录）· 勾选即保存到本机</span>
          </div>
          <el-table ref="refTable" :data="filteredRefPool" size="small" max-height="240" @selection-change="onRefSelect">
            <el-table-column type="selection" width="40" />
            <el-table-column prop="name" label="门店" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.name }}
                <el-tag v-if="refAutoIds.includes(row.storeId)" size="small" type="success" style="margin-left: 6px;">推荐</el-tag>
                <el-tag v-if="row.hasProfile" size="small" type="warning" style="margin-left: 4px;">联通</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="brand" label="品牌" width="90" />
            <el-table-column prop="city" label="城市" width="80" />
            <el-table-column label="坪效(元/㎡)" width="110" align="right">
              <template #default="{ row }">{{ row.pingxiao.toLocaleString() }}</template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <!-- 预测结果 -->
      <div v-if="result" class="fc-result">
        <div class="fc-result-card">
          <div class="fc-result-title">
            {{ result.candName }} · 年销售额预测
            <el-tag size="small" :type="result.engine === 'L3' ? 'warning' : result.engine === 'L2' ? 'success' : 'info'" style="margin-left: 8px;">{{ result.engine === 'L3' ? 'L3 机器学习' : result.engine === 'L2' ? 'L2 回归' : 'L1 类比' }}</el-tag>
          </div>
          <div class="fc-result-main">
            <span class="fc-amount">{{ result.predictCompWan }}</span>
            <span class="fc-unit">万元 / 年</span>
            <el-tag size="small" type="warning" style="margin-left: 10px;">置信度 ±{{ result.conf }}%</el-tag>
          </div>
          <div class="fc-result-range">参考区间：{{ result.rangeWan[0] }} ~ {{ result.rangeWan[1] }} 万元（含外卖口径）</div>
          <div class="fc-result-meta">
            <div>匹配方式：{{ result.levelName }}</div>
            <div v-if="predictRefMode">参照店：{{ predictRefMode === 'custom' ? '自定义（已圈定 ' + predictRefCount + ' 家）' : '系统自动' }}</div>
            <div v-if="result.candDistrict">商圈归属：{{ result.candDistrict.city }} · {{ result.candDistrict.name }}</div>
            <div v-if="result.radiusPopulation">常住人口：{{ fmtPop(result.radiusPopulation) }}</div>
            <div v-if="result.radiusPoints">点位环境：{{ fmtPoints(result.radiusPoints) }}</div>
            <div>参考门店 {{ result.refCount }} 家</div>
          </div>
        </div>

        <div class="fc-refs">
          <div class="fc-refs-title">{{ result.engine === 'L2' || result.engine === 'L3' ? '特征相似样本门店（真实销售）' : '类比参照门店（真实销售）' }}</div>

          <!-- L3：对周边门店影响模拟 -->
          <div v-if="result.impacts && result.impacts.length" class="fc-impact" style="margin-top: 14px;">
            <div class="fc-refs-title">对周边 {{ result.impacts.length }} 家店影响（3km 内，新店开业蚕食模拟）</div>
            <el-table :data="result.impacts" size="small" max-height="180">
              <el-table-column prop="name" label="周边门店" min-width="150" show-overflow-tooltip />
              <el-table-column prop="brand" label="品牌" width="110" />
              <el-table-column label="原坪效(元/㎡/年)" width="130" align="right">
                <template #default="{ row }">{{ row.origEff.toLocaleString() }}</template>
              </el-table-column>
              <el-table-column label="开业后坪效" width="120" align="right">
                <template #default="{ row }"><span style="color:#f56c6c;">{{ row.newEff.toLocaleString() }}</span></template>
              </el-table-column>
              <el-table-column label="下降" width="80" align="right">
                <template #default="{ row }"><span style="color:#f56c6c;font-weight:500;">-{{ row.dropPct }}%</span></template>
              </el-table-column>
            </el-table>
          </div>

          <!-- L3：预测归因（SHAP/特征重要性） -->
          <div v-if="result.importance && result.importance.length" style="margin-top: 12px; font-size: 12px; color: #666;">
            预测归因（特征重要性 Top{{ Math.min(result.importance.length, 4) }}）：{{ fmtImportance(result.importance) }}
          </div>
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
import api from '../utils/api.js'
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
// 格式化点位环境：竞品500 X家/我的门店500 X家/写字楼 500/1k/3k X家/大学 1k/3k X家/医院 X/地铁500 X站/购物中心500 X家
const fmtPoints = (p) => {
  if (!p) return ''
  const parts = []
  parts.push(`竞品500m ${p.competitors500 || 0}家`)
  if (p.myStores500) parts.push(`我的门店500m ${p.myStores500}家`)
  if (p.offices) parts.push(`写字楼 ${[500, 1000, 3000].filter(r => p.offices[r] != null).map(r => (r >= 1000 ? r / 1000 + 'km' : r + 'm') + ' ' + p.offices[r] + '栋').join('/')}`)
  if (p.universities) parts.push(`大学 ${[1000, 3000].filter(r => p.universities[r] != null).map(r => r / 1000 + 'km ' + p.universities[r] + '所').join('/')}`)
  if (p.hospitals) parts.push(`医院 ${[1000, 3000].filter(r => p.hospitals[r] != null).map(r => r / 1000 + 'km ' + p.hospitals[r] + '家').join('/')}`)
  if (p.metro500 != null) parts.push(`地铁500m ${p.metro500}站`)
  if (p.malls500 != null) parts.push(`购物中心500m ${p.malls500}家`)
  return parts.join('；')
}
// 特征归因展示：面积 58% · 商圈人口 20% · 竞争 12% ...
const FEATURE_CN = { logArea: '面积', deliveryRatio: '外卖占比', dLive: '商圈居住', dWork: '商圈工作', dVisit: '商圈客流', dRich: '高消费人群', pop1km: '1km人口', pop3km: '3km人口', pop5km: '5km人口', comp500: '竞品500m', my500: '我的门店500m', yearCode: '年份', mallCode: '商场类型', tradeCode: '商圈类型', uniPop: '联通人口', uniMale: '联通男性', uniFemale: '联通女性', uniGuest: '联通客流', uniRich: '联通富裕', uniSpend: '联通消费', hasUnicom: '联通画像' }
const fmtImportance = (imp) => {
  const total = imp.reduce((s, i) => s + (i.gain || 0), 0) || 1
  return imp.slice(0, 4).map(i => (FEATURE_CN[i.feature] || i.feature) + ' ' + Math.round((i.gain / total) * 100) + '%').join(' · ')
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

const stats = ref(null)
const loadStats = async () => {
  try {
    const d = await api.get('/sales-forecast/stats')
    if (d && d.success) stats.value = d
  } catch (e) { /* 忽略统计失败 */ }
}
const loadCandidates = async () => {
  loading.value = true
  try {
    const d = await api.get('/sales-forecast/candidates')
    candidates.value = d?.candidates || []
  } catch (e) {
    ElMessage.error('加载候选门店失败：' + (e.response?.data?.message || e.message))
  } finally {
    loading.value = false
  }
}

const handlePredict = async (row) => {
  predictingId.value = row.id
  result.value = null
  // 记录本次预测的参照模式（结果卡展示用）
  predictRefMode.value = (refMode.value === 'custom' && refSelected.value.length) ? 'custom' : 'auto'
  predictRefCount.value = refSelected.value.length
  try {
    const payload = { storeId: row.id }
    // 自定义圈定集：传入选中的参照店；自动模式不带（后端全自动）
    if (refMode.value === 'custom' && refSelected.value.length) payload.refSelection = refSelected.value
    const d = await api.post('/sales-forecast/predict', payload)
    // 用该候选店刷新面板推荐集（不改变已保存的自定义勾选）
    if (refPool.value.length) loadRefStores(row.id)
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

// ===== 参照店圈定（双轨：自动 = 系统推荐；自定义 = 用户勾选集） =====
const refOpen = ref(false)
const refPool = ref([])
const refAutoIds = ref([])
const refKeyword = ref('')
const refSelected = ref([])
const refMode = ref('auto')
const refTable = ref(null)
const predictRefMode = ref('auto')
const predictRefCount = ref(0)
let refRestoring = false
const savedKey = () => 'refSelection_' + (localStorage.getItem('userId') || '0')

const filteredRefPool = computed(() => {
  let list = refPool.value
  if (refKeyword.value) {
    const k = refKeyword.value.trim()
    list = list.filter(r => (r.name || '').includes(k) || (r.brand || '').includes(k) || (r.city || '').includes(k))
  }
  return list
})

const loadRefStores = async (storeId) => {
  try {
    const d = await api.get('/sales-forecast/ref-stores', { params: { storeId: storeId || undefined } })
    if (d && d.success) {
      refPool.value = d.pool || []
      refAutoIds.value = d.auto || []
      restoreRefSelection()
    }
  } catch (e) {
    ElMessage.error('加载参照店失败：' + (e.response?.data?.message || e.message))
  }
}

// 恢复勾选态：有已保存自定义集则恢复；否则按系统推荐勾选（不保存，仍为自动模式）
const restoreRefSelection = () => {
  refRestoring = true
  try {
    const saved = JSON.parse(localStorage.getItem(savedKey()) || 'null')
    if (saved && saved.mode === 'custom' && Array.isArray(saved.selected)) {
      refMode.value = 'custom'
      refSelected.value = saved.selected.filter(id => refPool.value.some(p => p.storeId === id))
    } else {
      refMode.value = 'auto'
      refSelected.value = [...refAutoIds.value]
    }
  } catch (e) {
    refMode.value = 'auto'
    refSelected.value = [...refAutoIds.value]
  }
  refPool.value.forEach(p => {
    refTable.value?.toggleRowSelection(p, refSelected.value.includes(p.storeId))
  })
  refRestoring = false
}

const onRefSelect = (rows) => {
  refSelected.value = rows.map(r => r.storeId)
  if (refRestoring) return
  if (refSelected.value.length) {
    refMode.value = 'custom'
    localStorage.setItem(savedKey(), JSON.stringify({ mode: 'custom', selected: refSelected.value }))
  } else {
    // 全不选 = 回到系统自动
    refMode.value = 'auto'
    localStorage.removeItem(savedKey())
  }
}

const resetRefSelection = () => {
  localStorage.removeItem(savedKey())
  refMode.value = 'auto'
  refSelected.value = []
  restoreRefSelection()
}

const openRefPanel = () => {
  refOpen.value = !refOpen.value
  if (refOpen.value && refPool.value.length === 0) loadRefStores()
}

onMounted(() => { loadStats(); loadCandidates(); loadRefStores() })
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
.fc-ref-panel {
  margin-top: 12px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
}
.fc-ref-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
}
.fc-ref-title {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}
.fc-ref-body {
  border-top: 1px dashed #e4e7ed;
  padding: 12px 14px;
}
</style>
