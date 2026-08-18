<template>
  <div class="market-map-view">
    <!-- 页头 -->
    <div class="mm-header">
      <div>
        <h2 style="margin:0;font-size:18px;">🔍 {{ $t('cityInsight.title') }}</h2>
        <p style="margin:4px 0 0;font-size:13px;color:#909399;">
          {{ $t('cityInsight.desc') }}
        </p>
      </div>
      <div class="mm-header-right">
        <div class="mm-legend">
          <span class="mm-legend-item"><i style="background:#67c23a"></i>{{ $t('cityInsight.legendPriority') }}</span>
          <span class="mm-legend-item"><i style="background:#e6a23c"></i>{{ $t('cityInsight.legendWatch') }}</span>
          <span class="mm-legend-item"><i style="background:#f56c6c"></i>{{ $t('cityInsight.legendCaution') }}</span>
        </div>
        <el-button size="small" style="margin-left:14px;" @click="weightDialogVisible = true">
          <el-icon><Setting /></el-icon>&nbsp;{{ $t('cityInsight.weightSetting') }}
        </el-button>
      </div>
    </div>

    <!-- 权重设置对话框 -->
    <el-dialog v-model="weightDialogVisible" :title="'⚙️ ' + $t('cityInsight.weightDialogTitle')" width="480px" :close-on-click-modal="false">
      <div style="font-size:12px;color:#909399;margin-bottom:14px;">
        {{ $t('cityInsight.weightDialogDesc') }}
      </div>
      <div v-for="dim in weightDims" :key="dim.key" class="mm-weight-row">
        <div class="mm-weight-head">
          <span class="mm-weight-label">{{ dim.label }}</span>
          <span class="mm-weight-pct">{{ Math.round(weightForm[dim.key] * 100) }}%</span>
        </div>
        <el-slider v-model="weightForm[dim.key]" :min="0" :max="1" :step="0.05" :show-tooltip="false" @change="onWeightChange" />
      </div>
      <div style="font-size:12px;color:#909399;margin-top:8px;">
        {{ $t('cityInsight.weightTotal') }}：<b style="color:#303133;">{{ Math.round(weightTotal * 100) }}%</b>
        <span v-if="Math.abs(weightTotal - 1) > 0.001" style="color:#e6a23c;">{{ $t('cityInsight.willNormalize') }}</span>
      </div>
      <template #footer>
        <el-button @click="weightDialogVisible = false">{{ $t('cityInsight.cancel') }}</el-button>
        <el-button @click="resetWeights">{{ $t('cityInsight.resetDefault') }}</el-button>
        <el-button type="primary" :loading="weightSaving" @click="saveWeights">{{ $t('cityInsight.saveApply') }}</el-button>
      </template>
    </el-dialog>

    <!-- 数据概览 -->
    <div class="mm-kpi-row" v-if="summary">
      <div class="mm-kpi"><div class="mm-kpi-num">{{ summary.totalCities }}</div><div class="mm-kpi-label">{{ $t('cityInsight.kpiCities') }}</div></div>
      <div class="mm-kpi"><div class="mm-kpi-num c-green">{{ summary.priority }}</div><div class="mm-kpi-label">{{ $t('cityInsight.kpiPriority') }}</div></div>
      <div class="mm-kpi"><div class="mm-kpi-num c-amber">{{ summary.watch }}</div><div class="mm-kpi-label">{{ $t('cityInsight.kpiWatch') }}</div></div>
      <div class="mm-kpi"><div class="mm-kpi-num c-red">{{ summary.caution }}</div><div class="mm-kpi-label">{{ $t('cityInsight.kpiCaution') }}</div></div>
      <div class="mm-kpi"><div class="mm-kpi-num">{{ summary.provinceCount }}</div><div class="mm-kpi-label">{{ $t('cityInsight.kpiProvinces') }}</div></div>
    </div>

    <div class="mm-body">
      <!-- 左：省份机会榜单 -->
      <div class="mm-left">
        <div class="mm-panel-title">{{ $t('cityInsight.provinceTitle') }} <span class="mm-sub">{{ $t('cityInsight.provinceSub') }}</span></div>
        <div class="mm-prov-list" v-loading="loading">
          <div v-for="p in provinces" :key="p.province" class="mm-prov-item" :class="{ selected: selectedProvince === p.province }" @click="selectProvince(p.province)">
            <div class="mm-prov-rank">{{ p.rank }}</div>
            <div class="mm-prov-name">{{ p.province }}</div>
            <div class="mm-prov-bar">
              <div class="mm-prov-fill" :style="{ width: p.opportunity + '%', background: levelColor(p.level) }"></div>
            </div>
            <div class="mm-prov-score">{{ p.opportunity }}</div>
            <div class="mm-prov-level" :style="{ color: levelColor(p.level) }">{{ levelText(p.level) }}</div>
          </div>
        </div>
      </div>

      <!-- 右：城市机会 Top 榜 -->
      <div class="mm-right">
        <div class="mm-panel-title">{{ $t('cityInsight.cityRank') }}</div>
        <el-table :data="filteredCities" stripe border size="small" :max-height="640" style="width:100%" @row-click="openCityDetail" class="mm-table">
          <el-table-column type="index" label="#" width="42" align="center" />
          <el-table-column :label="$t('cityInsight.colCity')" min-width="150">
            <template #default="{ row }">
              <div class="mm-city-cell">
                <span class="mm-city-name">{{ row.city }}</span>
                <span v-for="t in (row.tags || [])" :key="t" class="mm-city-tag">{{ t }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="province" :label="$t('cityInsight.colProvince')" width="70" />
          <el-table-column :label="$t('cityInsight.colArea')" width="90" align="right" sortable prop="areaKm2">
            <template #default="{ row }">{{ row.areaKm2 ? row.areaKm2.toLocaleString() : '-' }}</template>
          </el-table-column>
          <el-table-column :label="$t('cityInsight.colDistricts')" width="80" align="right" sortable prop="districts">
            <template #default="{ row }">{{ row.districts !== null ? row.districts + ' 个' : '-' }}</template>
          </el-table-column>
          <el-table-column :label="$t('cityInsight.colGdp')" width="90" align="right" sortable prop="gdp">
            <template #default="{ row }">{{ row.gdp ? row.gdp.toLocaleString() : '-' }}</template>
          </el-table-column>
          <el-table-column :label="$t('cityInsight.colGdpGrowth')" width="90" align="right" sortable prop="gdpGrowth">
            <template #default="{ row }">
              <span v-if="row.gdpGrowth !== undefined" :style="{ color: row.gdpGrowth >= 0 ? '#67c23a' : '#f56c6c' }">
                {{ row.gdpGrowth >= 0 ? '+' : '' }}{{ row.gdpGrowth }}%
              </span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column prop="population" :label="$t('cityInsight.colPopulation')" width="80" align="right" sortable />
          <el-table-column prop="myStores" :label="$t('cityInsight.colMyStores')" width="70" align="right" sortable />
          <el-table-column prop="compStores" :label="$t('cityInsight.colCompStores')" width="70" align="right" sortable />
          <el-table-column :label="$t('cityInsight.colOpportunity')" width="130" align="center">
            <template #default="{ row }">
              <div class="mm-cell-score">
                <div class="mm-cell-bar"><div class="mm-cell-fill" :style="{ width: row.opportunity + '%', background: levelColor(row.level) }"></div></div>
                <span class="mm-cell-num" :style="{ color: levelColor(row.level) }">{{ row.opportunity }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="$t('cityInsight.colSuggestion')" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.level === '优先进入' ? 'success' : (row.level === '可观察' ? 'warning' : 'danger')" size="small">{{ levelText(row.level) }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 城市详情抽屉 -->
    <el-drawer v-model="detailVisible" :title="selectedCity ? selectedCity.city + ' · ' + $t('cityInsight.detailTitle') : ''" size="420px">
      <template v-if="selectedCity">
        <!-- 总分 -->
        <div class="mm-detail-score" :style="{ borderColor: levelColor(selectedCity.level) }">
          <div class="mm-detail-num" :style="{ color: levelColor(selectedCity.level) }">{{ selectedCity.opportunity }}</div>
          <div class="mm-detail-level" :style="{ color: levelColor(selectedCity.level) }">{{ levelText(selectedCity.level) }}</div>
          <div class="mm-detail-tip">{{ $t('cityInsight.detailScoreTip') }}</div>
        </div>

        <!-- 四维评分 -->
        <div class="mm-detail-dim-title">{{ $t('cityInsight.dimTitle') }}</div>
        <div class="mm-dim" v-for="dim in dims" :key="dim.key">
          <div class="mm-dim-head">
            <span>{{ dim.label }}</span>
            <span class="mm-dim-weight">{{ $t('cityInsight.weight') }} {{ Math.round(dim.weight * 100) }}%</span>
            <span class="mm-dim-val" :style="{ color: dimScoreColor(dim.key) }">{{ selectedCity.scores[dim.key] }}</span>
          </div>
          <div class="mm-dim-bar">
            <div class="mm-dim-fill" :style="{ width: selectedCity.scores[dim.key] + '%', background: dimScoreColor(dim.key) }"></div>
          </div>
          <div class="mm-dim-desc">{{ dim.desc }}</div>
        </div>

        <!-- 城市基本面 -->
        <div class="mm-detail-dim-title">{{ $t('cityInsight.facts') }}</div>
        <div class="mm-facts">
          <div class="mm-fact"><span>{{ $t('cityInsight.factArea') }}</span><b>{{ selectedCity.areaKm2 ? selectedCity.areaKm2.toLocaleString() + ' km²' : '-' }}</b></div>
          <div class="mm-fact"><span>{{ $t('cityInsight.factDistricts') }}</span><b>{{ selectedCity.districts !== null ? selectedCity.districts + ' 个' : '-' }}</b></div>
          <div class="mm-fact"><span>{{ $t('cityInsight.factPopulation') }}</span><b>{{ selectedCity.population.toLocaleString() }} 万</b></div>
          <div class="mm-fact"><span>{{ $t('cityInsight.factGdp') }}</span><b>{{ selectedCity.gdp.toLocaleString() }} 亿</b></div>
          <div class="mm-fact"><span>{{ $t('cityInsight.factRetail') }}</span><b>{{ selectedCity.retail.toLocaleString() }} 亿</b></div>
          <div class="mm-fact"><span>{{ $t('cityInsight.factIncome') }}</span><b>{{ selectedCity.income.toLocaleString() }} 元</b></div>
          <div class="mm-fact"><span>{{ $t('cityInsight.factExpense') }}</span><b>{{ selectedCity.expense.toLocaleString() }} 元</b></div>
          <div class="mm-fact"><span>{{ $t('cityInsight.factLevel') }}</span><b>{{ selectedCity.level || '-' }}</b></div>
          <div class="mm-fact"><span>{{ $t('cityInsight.factMyStores') }}</span><b>{{ selectedCity.myStores }} 家</b></div>
          <div class="mm-fact"><span>{{ $t('cityInsight.factCompStores') }}</span><b>{{ selectedCity.compStores }} 家</b></div>
          <div class="mm-fact"><span>{{ $t('cityInsight.factBrandStores') }}</span><b>{{ selectedCity.brandStores }} 家</b></div>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/utils/api'
import { ElMessage } from 'element-plus'

const { t } = useI18n()

const loading = ref(false)
const cities = ref([])
const provinces = ref([])
const selectedProvince = ref('')
const detailVisible = ref(false)
const selectedCity = ref(null)

const DEFAULT_WEIGHTS = { marketSize: 0.30, competition: 0.25, brandGap: 0.25, consumption: 0.20 }
const WEIGHTS = { ...DEFAULT_WEIGHTS }

// 权重维度（label 随语言）
const weightDims = computed(() => [
  { key: 'marketSize', label: t('cityInsight.weightMarket') },
  { key: 'competition', label: t('cityInsight.weightCompetition') },
  { key: 'brandGap', label: t('cityInsight.weightBrandGap') },
  { key: 'consumption', label: t('cityInsight.weightConsumption') }
])

// 权重设置
const weightDialogVisible = ref(false)
const weightSaving = ref(false)
const weightForm = reactive({ ...DEFAULT_WEIGHTS })
const weightTotal = computed(() => Object.values(weightForm).reduce((a, b) => a + (Number(b) || 0), 0))

const onWeightChange = () => {
  // 拖动时无需保存，仅显示总和提示
}

const saveWeights = async () => {
  weightSaving.value = true
  try {
    const res = await api.put('/market-map/weights', { weights: { ...weightForm } })
    if (res.success) {
      Object.assign(WEIGHTS, res.weights)
      Object.assign(weightForm, res.weights)
      ElMessage.success(res.message || t('cityInsight.weightSaved'))
      weightDialogVisible.value = false
      await loadData()
    } else {
      ElMessage.error(res.message || '保存失败')
    }
  } catch (e) {
    ElMessage.error(t('cityInsight.weightSaveFail') + ': ' + (e.response?.data?.message || e.message))
  } finally {
    weightSaving.value = false
  }
}

const resetWeights = () => {
  Object.assign(weightForm, DEFAULT_WEIGHTS)
}

const levelColor = (lvl) => {
  if (lvl === '优先进入') return '#67c23a'
  if (lvl === '可观察') return '#e6a23c'
  return '#f56c6c'
}

// 等级显示文案（业务值保持中文，展示层按语言翻译）
const levelText = (lvl) => {
  if (lvl === '优先进入') return t('cityInsight.legendPriority').replace(' ≥75', '')
  if (lvl === '可观察') return t('cityInsight.legendWatch').replace(' 50-74', '')
  return t('cityInsight.legendCaution').replace(' <50', '')
}

const dimScoreColor = (key) => {
  const map = { marketSize: '#378ADD', competition: '#7F77DD', brandGap: '#1D9E75', consumption: '#D4537E' }
  return map[key] || '#909399'
}

const dims = computed(() => [
  { key: 'marketSize', label: '市场规模', weight: WEIGHTS.marketSize, desc: '常住人口 × 社零总额（越大越好）' },
  { key: 'competition', label: '竞争强度', weight: WEIGHTS.competition, desc: '竞品密度越低分越高（蓝海机会）' },
  { key: 'brandGap', label: '品牌空白度', weight: WEIGHTS.brandGap, desc: '本品牌渗透率越低越空白，机会越大' },
  { key: 'consumption', label: '消费潜力', weight: WEIGHTS.consumption, desc: '人均可支配收入 + 消费支出（购买力）' }
])

const summary = computed(() => {
  if (!cities.value.length) return null
  return {
    totalCities: cities.value.length,
    priority: cities.value.filter(c => c.level === '优先进入').length,
    watch: cities.value.filter(c => c.level === '可观察').length,
    caution: cities.value.filter(c => c.level === '谨慎').length,
    provinceCount: new Set(cities.value.map(c => c.province)).size
  }
})

const filteredCities = computed(() => {
  if (!selectedProvince.value) return cities.value
  return cities.value.filter(c => c.province === selectedProvince.value)
})

const selectProvince = (prov) => {
  selectedProvince.value = prov === selectedProvince.value ? '' : prov
}

const openCityDetail = (row) => {
  selectedCity.value = row
  detailVisible.value = true
}

const loadData = async () => {
  loading.value = true
  try {
    const res = await api.get('/market-map/opportunity')
    if (res.success) {
      cities.value = res.cities || []
      provinces.value = (res.provinces || []).map((p, i) => ({ ...p, rank: i + 1 }))
      if (res.weights) {
        Object.assign(WEIGHTS, res.weights)
        Object.assign(weightForm, res.weights)
      }
    } else {
      ElMessage.error(res.message || '加载失败')
    }
  } catch (e) {
    ElMessage.error(t('cityInsight.loadFail') + ': ' + (e.response?.data?.message || e.message))
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<style scoped>
.market-map-view {
  padding: 20px;
}
.mm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.mm-header-right {
  display: flex;
  align-items: center;
}
.mm-weight-row {
  margin-bottom: 6px;
}
.mm-weight-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #303133;
  margin-bottom: 2px;
}
.mm-weight-label {
  font-size: 13px;
}
.mm-weight-pct {
  font-weight: 500;
  color: #409eff;
}
.mm-legend {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: #606266;
}
.mm-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}
.mm-legend-item i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}

.mm-kpi-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}
.mm-kpi {
  flex: 1;
  background: #f7f9fc;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 14px;
  text-align: center;
}
.mm-kpi-num {
  font-size: 22px;
  font-weight: 500;
  color: #303133;
}
.mm-kpi-num.c-green { color: #67c23a; }
.mm-kpi-num.c-amber { color: #e6a23c; }
.mm-kpi-num.c-red { color: #f56c6c; }
.mm-kpi-label {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.mm-body {
  display: flex;
  gap: 16px;
}
.mm-left {
  width: 300px;
  flex-shrink: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 14px;
  height: 640px;
  overflow-y: auto;
}
.mm-right {
  flex: 1;
  min-width: 0;
}
.mm-panel-title {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 12px;
}
.mm-sub {
  font-size: 11px;
  color: #c0c4cc;
  font-weight: 400;
}

.mm-prov-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.mm-prov-item:hover { background: #f5f7fa; }
.mm-prov-item.selected { background: #e6f1fb; }
.mm-prov-rank {
  width: 22px;
  text-align: center;
  font-size: 13px;
  color: #909399;
  font-weight: 500;
}
.mm-prov-name {
  width: 70px;
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-prov-bar {
  flex: 1;
  height: 8px;
  background: #f0f2f7;
  border-radius: 4px;
  overflow: hidden;
}
.mm-prov-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s;
}
.mm-prov-score {
  width: 28px;
  text-align: right;
  font-size: 13px;
  font-weight: 500;
  color: #303133;
}
.mm-prov-level {
  width: 52px;
  text-align: right;
  font-size: 12px;
}

.mm-table :deep(.el-table__row) {
  cursor: pointer;
}
.mm-city-cell {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.mm-city-name {
  font-size: 13px;
  color: #303133;
  font-weight: 500;
  flex-shrink: 0;
}
.mm-city-tag {
  flex-shrink: 0;
  font-size: 11px;
  color: #409eff;
  background: #ecf5ff;
  border: 1px solid #d9ecff;
  border-radius: 3px;
  padding: 0 5px;
  line-height: 16px;
  white-space: nowrap;
}
.mm-cell-score {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mm-cell-bar {
  flex: 1;
  height: 8px;
  background: #f0f2f7;
  border-radius: 4px;
  overflow: hidden;
}
.mm-cell-fill {
  height: 100%;
  border-radius: 4px;
}
.mm-cell-num {
  font-size: 13px;
  font-weight: 500;
  width: 26px;
  text-align: right;
}

.mm-detail-score {
  border: 2px solid #67c23a;
  border-radius: 12px;
  padding: 20px;
  text-align: center;
  margin-bottom: 18px;
  background: #fafcff;
}
.mm-detail-num {
  font-size: 42px;
  font-weight: 500;
  line-height: 1;
}
.mm-detail-level {
  font-size: 15px;
  margin-top: 6px;
  font-weight: 500;
}
.mm-detail-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 6px;
}
.mm-detail-dim-title {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  margin: 14px 0 10px;
}
.mm-dim {
  margin-bottom: 12px;
}
.mm-dim-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #303133;
  margin-bottom: 5px;
}
.mm-dim-weight {
  font-size: 11px;
  color: #c0c4cc;
}
.mm-dim-val {
  margin-left: auto;
  font-weight: 500;
  font-size: 14px;
}
.mm-dim-bar {
  height: 8px;
  background: #f0f2f7;
  border-radius: 4px;
  overflow: hidden;
}
.mm-dim-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s;
}
.mm-dim-desc {
  font-size: 11px;
  color: #b0b4bb;
  margin-top: 4px;
}
.mm-facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.mm-fact {
  background: #f7f9fc;
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mm-fact span {
  font-size: 11px;
  color: #909399;
}
.mm-fact b {
  font-size: 13px;
  color: #303133;
}
</style>
