<template>
  <div class="snapshot-monitor-panel">
    <!-- 品牌与期次选择 -->
    <el-card shadow="never" class="block-card">
      <template #header>
        <div class="card-head">
          开关店监测
          <span class="sub-hint">选择品牌与两期快照，系统自动比对「营业中」门店的新增/关闭/状态变化</span>
        </div>
      </template>
      <div class="sel-bar">
        <el-select
          v-model="brand"
          filterable
          placeholder="选择品牌"
          style="width: 220px"
          @change="handleBrandChange"
        >
          <el-option v-for="b in brandOptions" :key="b.brand" :label="b.brand" :value="b.brand">
            <span>{{ b.brand }}</span>
            <span style="float: right; color: #909399; font-size: 12px">
              {{ b.snapshotCount }} 期 · 最新 {{ b.latestPeriod }}
            </span>
          </el-option>
        </el-select>

        <template v-if="brand">
          <span class="arrow">对比</span>
          <el-select v-model="basePeriod" placeholder="基准期(旧)" style="width: 180px" @change="fetchDiff">
            <el-option v-for="s in periodOptions" :key="'b' + s.period" :label="s.period" :value="s.period">
              <span>{{ s.period }}</span>
              <span style="float: right; color: #909399; font-size: 12px">{{ s.data_version || '未标版本' }}</span>
            </el-option>
          </el-select>
          <span class="arrow">→</span>
          <el-select v-model="targetPeriod" placeholder="目标期(新)" style="width: 180px" @change="fetchDiff">
            <el-option v-for="s in periodOptions" :key="'t' + s.period" :label="s.period" :value="s.period">
              <span>{{ s.period }}</span>
              <span style="float: right; color: #909399; font-size: 12px">{{ s.data_version || '未标版本' }}</span>
            </el-option>
          </el-select>
          <el-button type="primary" :loading="loading" @click="fetchDiff">
            <el-icon><Search /></el-icon> 开始比对
          </el-button>
          <el-button v-if="!loading && diffData" type="success" plain @click="exportDiff">
            <el-icon><Download /></el-icon> 导出变更明细 CSV
          </el-button>
          <el-button v-if="!loading && diffData" @click="exportSnapshot">
            <el-icon><Download /></el-icon> 导出本期快照
          </el-button>
        </template>

        <el-button v-if="!brand" type="primary" plain style="margin-left: 12px" @click="$emit('goto-upload')">
          <el-icon><Upload /></el-icon> 去上传期次
        </el-button>
      </div>
    </el-card>

    <!-- 期次状态条（双标签：period + data_version） -->
    <el-card v-if="brand && periodOptions.length" shadow="never" class="block-card">
      <template #header>
        <div class="card-head">
          {{ brand }} · 期次档案（{{ periodOptions.length }} 期）
          <el-button size="small" style="margin-left: 8px" @click="loadSeries">
            <el-icon><Refresh /></el-icon> 刷新
          </el-button>
        </div>
      </template>
      <div class="timeline">
        <div
          v-for="s in periodOptions"
          :key="s.id"
          class="tl-item"
          :class="{ active: s.period === targetPeriod }"
          @click="pickPair(s.period)"
        >
          <div class="tl-period">{{ s.period }}</div>
          <el-tag size="small" :type="s.period === targetPeriod ? 'primary' : 'info'" effect="plain">{{ s.data_version || '未标版本' }}</el-tag>
          <div class="tl-count">{{ s.open_count }} 营 / {{ s.total_count }} 总</div>
          <div class="tl-time">{{ shortTime(s.created_at) }}</div>
        </div>
      </div>
    </el-card>

    <!-- 空态 -->
    <el-card v-else-if="brand" shadow="never" class="block-card">
      <el-empty description="该品牌暂无期次快照档案，请先到「期次上传」导入首期" :image-size="70">
        <el-button type="primary" @click="$emit('goto-upload')">去上传</el-button>
      </el-empty>
    </el-card>

    <!-- 比对结果 -->
    <template v-if="diffData && !diffData.diffUnavailable">
      <!-- 自洽校验 -->
      <el-alert
        v-if="diffData.selfCheck"
        :type="diffData.selfCheck.pass ? 'success' : 'error'"
        :closable="false"
        show-icon
        :title="diffData.selfCheck.pass ? '自洽校验通过' : '自洽校验未通过！'"
        :description="diffData.selfCheck.msg"
        style="margin-bottom: 12px"
      />
      <!-- 城市缺失警告 -->
      <el-alert
        v-for="(w, i) in diffData.cityWarns || []"
        :key="i"
        type="warning"
        :closable="false"
        show-icon
        :title="`【${w.city}】${w.reason}（上期 ${w.baseOpen} → 本期 ${w.targetOpen}）`"
        style="margin-bottom: 12px"
      />

      <!-- 统计卡 -->
      <div class="stat-cards">
        <div class="stat-card opened">
          <div class="stat-title">新增开店</div>
          <div class="stat-num">{{ diffData.openedCount }}</div>
          <div class="stat-sub">上期无 → 本期营业</div>
        </div>
        <div class="stat-card closed">
          <div class="stat-title">关闭门店</div>
          <div class="stat-num">{{ diffData.closedCount }}</div>
          <div class="stat-sub">上期营业 → 本期消失/关闭</div>
        </div>
        <div class="stat-card net" :class="{ neg: diffData.netChange < 0 }">
          <div class="stat-title">净变化</div>
          <div class="stat-num">{{ diffData.netChange > 0 ? '+' : '' }}{{ diffData.netChange }}</div>
          <div class="stat-sub">开 - 关</div>
        </div>
        <div class="stat-card kept">
          <div class="stat-title">留存门店</div>
          <div class="stat-num">{{ diffData.keptCount }}</div>
          <div class="stat-sub">两期均在营</div>
        </div>
        <div class="stat-card base">
          <div class="stat-title">在营总数</div>
          <div class="stat-num small">{{ diffData.base?.openCount }} → {{ diffData.target?.openCount }}</div>
          <div class="stat-sub">基准期 → 目标期</div>
        </div>
      </div>

      <!-- 变更明细表 -->
      <el-card shadow="never" class="block-card">
        <template #header>
          <div class="card-head">
            变更明细
            <el-radio-group v-model="changeFilter" size="small" style="margin-left: 12px">
              <el-radio-button :value="'all'">全部</el-radio-button>
              <el-radio-button :value="'opened'">新增 {{ diffData.openedCount }}</el-radio-button>
              <el-radio-button :value="'closed'">关闭 {{ diffData.closedCount }}</el-radio-button>
              <el-radio-button :value="'statusChanged'">状态变化 {{ diffData.statusChanged?.length || 0 }}</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <el-table :data="pagedChanges" v-loading="loading" border stripe size="small" style="width: 100%" max-height="520">
          <el-table-column label="#" type="index" width="50" />
          <el-table-column label="类型" width="100">
            <template #default="{ row }">
              <el-tag :type="row.type === 'opened' ? 'success' : row.type === 'closed' ? 'danger' : 'warning'" size="small">
                {{ row.type === 'opened' ? '新增' : row.type === 'closed' ? '关闭' : '状态变化' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="store_key" label="门店ID" width="120" show-overflow-tooltip />
          <el-table-column prop="name" label="门店名称" min-width="170" show-overflow-tooltip />
          <el-table-column prop="city" label="城市" width="90" />
          <el-table-column prop="district" label="区县" width="90" />
          <el-table-column label="状态变化" min-width="140">
            <template #default="{ row }">
              <span v-if="row.type === 'opened'" style="color: #67c23a">— → 营业中</span>
              <span v-else-if="row.type === 'closed'" style="color: #f56c6c">营业中 → {{ row._closed ? '已消失' : statusText(row.to) }}</span>
              <span v-else style="color: #e6a23c">{{ statusText(row.from) }} → {{ statusText(row.to) }}</span>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="pagedChanges.length === 0" style="text-align: center; color: #909399; padding: 20px">该类型暂无变更记录</div>
      </el-card>
    </template>

    <el-card v-else-if="diffData && diffData.diffUnavailable" shadow="never" class="block-card">
      <el-alert type="info" :closable="false" show-icon :title="diffData.message || '暂无可对比'">
        <template #default>
          当前品牌仅有一期或无更早基准期。上传相邻期次后即可看到开店/闭店监测结果。
          <el-button type="primary" link @click="$emit('goto-upload')">去上传期次</el-button>
        </template>
      </el-alert>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Download, Upload, Refresh } from '@element-plus/icons-vue'
import { useCompetitorStore } from '@/stores/competitor'

const emit = defineEmits(['goto-upload'])
const competitorStore = useCompetitorStore()

const props = defineProps({
  initialBrand: { type: String, default: '' },
  initialTarget: { type: String, default: '' }
})

/* ---------------- 状态 ---------------- */
const series = ref([])          // 当前品牌快照序列（升序）
const brands = ref([])          // 品牌聚合
const brand = ref('')
const basePeriod = ref('')
const targetPeriod = ref('')
const diffData = ref(null)
const loading = ref(false)
const changeFilter = ref('all')

const brandOptions = computed(() => brands.value)
const periodOptions = computed(() => series.value)

/* ---------------- 数据加载 ---------------- */
// keepBrand：传入则跳转该品牌；缺省沿用当前选中（用于 Tab 切回时刷新，不打断用户选择）
const loadBrands = async (keepBrand = '') => {
  const res = await competitorStore.listSnapshotBrands()
  if (!res.success) { ElMessage.error(res.message); return }
  brands.value = res.data.brands || []
  const target = keepBrand || brand.value || props.initialBrand || brands.value[0]?.brand || ''
  if (target) {
    brand.value = target
    await loadSeries(target)
  }
}
// 刷新：保持当前品牌，仅重拉序列与对比
const refresh = async () => {
  if (!brand.value) return loadBrands()
  await loadSeries(brand.value)
}

const loadSeries = async (b) => {
  const targetBrand = b || brand.value
  if (!targetBrand) return
  const res = await competitorStore.listBrandSnapshots(targetBrand)
  if (!res.success) { ElMessage.error(res.message); return }
  series.value = (res.data.brands?.[0]?.snapshots || []).slice().sort((a, b) => a.period_seq - b.period_seq)
  if (!series.value.length) { diffData.value = null; return }
  // 默认：最新一期为目标，前一期为基准（initialTarget 失效时回退最新）
  if (series.value.length >= 2) {
    let want = props.initialTarget || series.value[series.value.length - 1].period
    let ti = series.value.findIndex(s => s.period === want)
    if (ti < 0) { want = series.value[series.value.length - 1].period; ti = series.value.length - 1 }
    targetPeriod.value = want
    const bi = ti > 0 ? ti - 1 : series.value.length - 2
    basePeriod.value = series.value[Math.max(bi, 0)].period
    if (targetPeriod.value === basePeriod.value) {
      basePeriod.value = series.value[series.value.length - 2]?.period || ''
    }
    fetchDiff()
  } else {
    targetPeriod.value = series.value[0].period
    basePeriod.value = ''
    diffData.value = { diffUnavailable: true, message: '该品牌仅此一期，暂无对比' }
  }
}

const handleBrandChange = (b) => { diffData.value = null; loadSeries(b) }

/* 点击期次：若点目标期则设为目标，否则目标保持最新、点击期为基准 */
const pickPair = (p) => {
  if (targetPeriod.value === p) return
  if (series.value.length < 2) return
  // 点击的期作为基准，目标自动切到它之后的相邻期（或保持最新）
  const idx = series.value.findIndex(s => s.period === p)
  const next = series.value[idx + 1]
  basePeriod.value = p
  if (next && targetPeriod.value !== p) targetPeriod.value = next.period
  if (targetPeriod.value === basePeriod.value) {
    targetPeriod.value = series.value[series.value.length - 1].period
  }
  fetchDiff()
}

/* ---------------- 比对 ---------------- */
const fetchDiff = async () => {
  if (!brand.value || !targetPeriod.value || !basePeriod.value) return
  if (targetPeriod.value === basePeriod.value) {
    ElMessage.warning('基准期与目标期不能相同，请选择不同期次')
    return
  }
  loading.value = true
  try {
    const res = await competitorStore.diffSnapshots({
      brand: brand.value,
      target: targetPeriod.value,
      base: basePeriod.value
    })
    if (!res.success) { ElMessage.error(res.message || '比对失败'); return }
    diffData.value = res.data
  } finally {
    loading.value = false
  }
}

/* ---------------- 明细合并 ---------------- */
const changeRows = computed(() => {
  if (!diffData.value || diffData.value.diffUnavailable) return []
  const rows = []
  for (const r of diffData.value.opened || []) rows.push({ type: 'opened', ...r })
  for (const r of diffData.value.closed || []) rows.push({ type: 'closed', ...r })
  for (const r of diffData.value.statusChanged || []) rows.push({ type: 'statusChanged', ...r })
  return rows
})

const filteredChanges = computed(() => {
  if (changeFilter.value === 'all') return changeRows.value
  return changeRows.value.filter(r => r.type === changeFilter.value)
})

const pagedChanges = computed(() => filteredChanges.value)

const statusText = (s) => ({
  open: '营业中', paused: '暂停营业', closed: '已闭店', pending: '未开业', unknown: '未知'
}[s] || s || '未知')

/* ---------------- 导出 ---------------- */
const exportDiff = async () => {
  const res = await competitorStore.exportDiffCsv({
    brand: brand.value, target: targetPeriod.value, base: basePeriod.value
  })
  if (!res.success) { ElMessage.error(res.message); return }
  saveBlob(res.blob, `${brand.value}_变更明细_${basePeriod.value}__${targetPeriod.value}.csv`)
}

const exportSnapshot = async () => {
  const res = await competitorStore.exportSnapshotCsv({ brand: brand.value, period: targetPeriod.value })
  if (!res.success) { ElMessage.error(res.message); return }
  saveBlob(res.blob, `${brand.value}_${targetPeriod.value}_快照.csv`)
}

const saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const shortTime = (t) => {
  if (!t) return ''
  const s = String(t).includes('T') ? t : t.replace(' ', 'T')
  const dt = new Date(s)
  if (isNaN(dt)) return t
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/* ---------------- 对外暴露（供父组件从 Tab2 跳转） ---------------- */
defineExpose({ loadBrands, refresh, setComparison: async (b, period) => {
  await loadBrands(b)
  if (period && series.value.some(s => s.period === period)) {
    targetPeriod.value = period
    const idx = series.value.findIndex(s => s.period === period)
    basePeriod.value = series.value[idx > 0 ? idx - 1 : series.value.length - 2]?.period || ''
    if (basePeriod.value && basePeriod.value !== targetPeriod.value) fetchDiff()
    else ElMessage.info('该期之前无基准期，请选择更早基准期')
  }
} })

/* ---------------- 挂载 ---------------- */
onMounted(() => { loadBrands() })

// 监听外部跳转参数
watch(() => props.initialBrand, (nv) => { if (nv && nv !== brand.value) loadBrands(nv) })
watch(() => props.initialTarget, (nv) => { if (nv) { targetPeriod.value = nv; if (diffData.value) fetchDiff() } })
</script>

<style lang="scss" scoped>
.snapshot-monitor-panel {
  .block-card { margin-bottom: 16px; border-radius: 8px; }
  .card-head {
    display: flex; align-items: center; font-weight: 600; font-size: 14px;
    .sub-hint { font-size: 12px; color: #909399; font-weight: 400; margin-left: 10px; }
  }
  .sel-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    .arrow { color: #909399; font-size: 13px; } }
  .timeline {
    display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px;
    .tl-item {
      flex: 0 0 auto; width: 150px; border: 1px solid #ebeef5; border-radius: 6px;
      padding: 8px 10px; cursor: pointer; background: #fafafa; text-align: left;
      &:hover { border-color: #c6e2ff; }
      &.active { border-color: #409eff; background: #ecf5ff; }
      .tl-period { font-weight: 700; font-size: 15px; color: #303133; }
      .tl-count { font-size: 12px; color: #666; margin-top: 3px; }
      .tl-time { font-size: 11px; color: #bbb; margin-top: 2px; }
    }
  }
  .stat-cards {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 16px;
    .stat-card {
      border-radius: 8px; padding: 16px; color: #fff; text-align: center;
      .stat-title { font-size: 13px; opacity: .9; }
      .stat-num { font-size: 30px; font-weight: 700; margin: 6px 0; &.small { font-size: 20px; line-height: 36px; } }
      .stat-sub { font-size: 12px; opacity: .8; }
      &.opened { background: linear-gradient(135deg, #67c23a, #529b2e); }
      &.closed { background: linear-gradient(135deg, #f56c6c, #d84343); }
      &.net { background: linear-gradient(135deg, #409eff, #2468c5);
        &.neg { background: linear-gradient(135deg, #909399, #6b6f76); } }
      &.kept { background: linear-gradient(135deg, #909399, #73777f); }
      &.base { background: linear-gradient(135deg, #a97dd8, #8a5fc0); }
    }
  }
}
</style>
