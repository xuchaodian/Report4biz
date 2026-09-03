<template>
  <div class="snapshot-upload-panel">
    <!-- ① 基本信息 -->
    <el-card shadow="never" class="block-card">
      <template #header>
        <div class="card-head">
          <span class="step-badge">①</span> 基本信息
        </div>
      </template>
      <div class="upload-form">
        <el-form label-width="90px" label-position="right">
          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="品牌" required>
                <el-select
                  v-model="brand"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择或输入品牌"
                  style="width: 100%"
                  @change="handleBrandChange"
                >
                  <el-option
                    v-for="b in brandOptions"
                    :key="b"
                    :label="b"
                    :value="b"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="期次" required>
                <el-input
                  v-model="period"
                  placeholder="如 2026Q3 或 2026-09"
                  clearable
                  style="width: 100%"
                >
                  <template #append>
                    <el-tooltip content="填入系统建议的最近期次" placement="top">
                      <el-button :disabled="!suggestedPeriod" @click="period = suggestedPeriod">
                        建议:{{ suggestedPeriod || '--' }}
                      </el-button>
                    </el-tooltip>
                  </template>
                </el-input>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="数据版本">
                <el-input
                  v-model="dataVersion"
                  placeholder="如 2026年9月版（可选）"
                  clearable
                  style="width: 100%"
                />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </div>
    </el-card>

    <!-- ② 选择文件 -->
    <el-card shadow="never" class="block-card">
      <template #header>
        <div class="card-head">
          <span class="step-badge">②</span> 选择快照文件
          <el-link type="primary" :underline="false" style="margin-left: 12px" @click="downloadTemplate">
            下载上传模板
          </el-link>
        </div>
      </template>
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :limit="1"
        accept=".csv,text/csv"
        :on-change="handleFileChange"
        :on-remove="handleFileRemove"
        :on-exceed="handleExceed"
        drag
        style="width: 100%"
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">将 CSV 文件拖到此处，或<em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">
            必需列：store_id / store_code（稳定门店ID）、name、brand、city、district、latitude、longitude、status（营业中/已闭店等）。可选列：trading_area（商圈）、price、rating、reviews。单文件 ≤5MB。
          </div>
        </template>
      </el-upload>
      <div style="margin-top: 16px; display: flex; gap: 10px; align-items: center">
        <el-button type="primary" :loading="previewing" :disabled="!canPreview" @click="handlePreview">
          <el-icon><Search /></el-icon> 解析预览
        </el-button>
        <el-button v-if="previewData" @click="resetPreview">
          <el-icon><Refresh /></el-icon> 重新解析
        </el-button>
        <span v-if="fileName" class="file-name">
          <el-icon><Document /></el-icon> {{ fileName }}
        </span>
      </div>
    </el-card>

    <!-- ③ 预览结果 -->
    <el-card v-if="previewData" shadow="never" class="block-card">
      <template #header>
        <div class="card-head">
          <span class="step-badge">③</span> 预览与确认
        </div>
      </template>

      <!-- 阻断性错误 -->
      <el-alert
        v-if="previewData.blockImport"
        type="error"
        :closable="false"
        show-icon
        title="无法导入：缺少稳定门店ID列"
        :description="`检测到 ${previewData.noKeyCount} 行没有 store_id/store_code —— 缺少稳定 ID 会导致开关店比对误判为闭店，请补齐后重传`"
        style="margin-bottom: 14px"
      />

      <!-- ID 自检警告 -->
      <el-alert
        v-if="previewData.idCheckWarn"
        type="warning"
        :closable="false"
        show-icon
        :title="previewData.idCheckWarn.message"
        style="margin-bottom: 14px"
      >
        <div v-if="previewData.idCheckWarn.sample?.length" style="font-size: 12px; margin-top: 4px">
          示例：<span v-for="(s, i) in previewData.idCheckWarn.sample" :key="i" style="margin-right: 10px">
            [{{ s.store_key }}] {{ s.baseName }} → {{ s.newName }}
          </span>
        </div>
      </el-alert>

      <!-- 期次冲突 / 列表影响 -->
      <el-alert
        v-if="previewData.sameHashExists"
        type="info"
        :closable="false"
        show-icon
        title="该期快照已存在且内容一致（同哈希），可跳过导入"
        style="margin-bottom: 14px"
      />
      <el-alert
        v-else-if="previewData.samePeriodExists"
        type="warning"
        :closable="false"
        show-icon
        title="该期次已存在但文件内容不同 —— 导入将覆盖该期并重建明细"
        style="margin-bottom: 14px"
      />
      <el-alert
        :type="previewData.willReplace ? 'success' : 'info'"
        :closable="false"
        show-icon
        :title="previewData.willReplace
          ? `本期为最新期（≥ 品牌已有最大期次 ${previewData.maxSeq || '--'}），导入后将同步替换「竞品列表」镜像`
          : `本期早于品牌最新期，仅作为历史归档导入，不会改动当前竞品列表`"
        style="margin-bottom: 14px"
      />

      <!-- 统计概览 -->
      <el-row :gutter="12" class="stat-row">
        <el-col :span="4"><div class="stat-box"><div class="stat-num">{{ previewData.total }}</div><div class="stat-label">总行数</div></div></el-col>
        <el-col :span="4"><div class="stat-box"><div class="stat-num">{{ previewData.openCount }}</div><div class="stat-label">营业中</div></div></el-col>
        <el-col :span="4"><div class="stat-box"><div class="stat-num warn">{{ previewData.noKeyCount }}</div><div class="stat-label">缺门店ID</div></div></el-col>
        <el-col :span="4"><div class="stat-box"><div class="stat-num warn">{{ previewData.dupKeyCount }}</div><div class="stat-label">重复ID</div></div></el-col>
        <el-col :span="4"><div class="stat-box"><div class="stat-num warn">{{ previewData.missingCoordCount }}</div><div class="stat-label">缺坐标</div></div></el-col>
        <el-col :span="4"><div class="stat-box"><div class="stat-num">{{ previewData.missingNameCount }}</div><div class="stat-label">缺名称</div></div></el-col>
      </el-row>

      <!-- 版本识别 -->
      <div v-if="previewData.dataVersion || previewData.versionSource" class="version-line">
        <el-tag type="info" effect="plain">数据版本识别：{{ previewData.dataVersion || '(空)' }}</el-tag>
        <el-tag type="warning" effect="plain" style="margin-left: 8px">
          来源：{{ versionSourceText(previewData.versionSource) }}
        </el-tag>
        <el-tag v-if="previewData.versionInconsistent" type="danger" effect="plain" style="margin-left: 8px">
          版本列存在多值，请核对
        </el-tag>
        <el-button v-if="previewData.suggestedPeriod && !previewData.dataVersion" size="small" style="margin-left: 8px" @click="applySuggestion">
          采用建议期次 {{ previewData.suggestedPeriod }}
        </el-button>
      </div>

      <!-- 样本行 -->
      <div v-if="previewData.sampleHead?.length" style="margin-top: 12px">
        <div class="sub-title">文件前 5 行示例</div>
        <el-table :data="previewData.sampleHead" size="small" border max-height="180" style="width: 100%">
          <el-table-column prop="store_key" label="ID" width="110" />
          <el-table-column prop="name" label="门店名" min-width="160" show-overflow-tooltip />
          <el-table-column prop="city" label="城市" width="90" />
          <el-table-column prop="status" label="状态(解析后)" width="120" />
        </el-table>
      </div>

      <!-- 手工店收编（B+） -->
      <div v-if="manualSummary.items.length" style="margin-top: 12px">
        <div class="sub-title">
          手工店收编建议（B+）
          <span class="sub-hint">
            {{ brand }} 当前有 {{ manualSummary.summary.total }} 家手工店：自动匹配
            <b class="auto">{{ manualSummary.summary.autoCount }}</b> 家 / 疑似
            <b class="maybe">{{ manualSummary.summary.maybeCount }}</b> 家 / 保留
            <b class="keep">{{ manualSummary.summary.keepCount }}</b> 家
          </span>
        </div>
        <el-table
          :data="manualSummary.items"
          size="small"
          border
          max-height="260"
          style="width: 100%"
        >
          <el-table-column label="收编" width="80">
            <template #default="{ row }">
              <el-checkbox
                :model-value="adoptChecked.has(row.manualId)"
                :disabled="row.level === 'keep' || !row.csvMatch"
                @change="(v) => toggleAdopt(row, v)"
              />
            </template>
          </el-table-column>
          <el-table-column label="判定" width="90">
            <template #default="{ row }">
              <el-tag :type="levelTag(row.level)" size="small">{{ levelText(row.level) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="manualName" label="当前手工店" min-width="160" show-overflow-tooltip />
          <el-table-column label="匹配到 CSV 店" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.csvMatch ? `${row.csvMatch.name}（${row.csvMatch.store_key}）` : '-' }}
            </template>
          </el-table-column>
          <el-table-column label="距离(m)" width="90">
            <template #default="{ row }">{{ row.dist < Infinity ? row.dist : '-' }}</template>
          </el-table-column>
          <el-table-column label="店名相似" width="90">
            <template #default="{ row }">{{ row.nameSim ? row.nameSim.toFixed(2) : '-' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110">
            <template #default="{ row }">
              <el-button
                v-if="row.level === 'keep'"
                link
                type="info"
                size="small"
                @click="ElMessage.info('「保留」店与 CSV 无匹配候选，无法收编，将保留为手工店')"
              >为什么保留</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="sub-hint" style="margin-top: 6px">
          勾选 = 将该手工店并入 CSV 对应门店（备注自动合并），并从「竞品列表」删除手工记录；仅本期导入生效。
        </div>
      </div>

      <div style="margin-top: 18px; text-align: right">
        <el-button type="primary" size="large" :loading="importing" :disabled="!canImport" @click="handleImport">
          <el-icon><Upload /></el-icon> 确认导入{{ previewData.willReplace ? '（同步竞品列表）' : '' }}
        </el-button>
      </div>
    </el-card>

    <!-- ④ 历史期次 -->
    <el-card shadow="never" class="block-card">
      <template #header>
        <div class="card-head">
          <span class="step-badge">④</span> 该品牌历史期次
          <el-button size="small" style="margin-left: 8px" :loading="historyLoading" @click="refreshHistory">
            <el-icon><Refresh /></el-icon> 刷新
          </el-button>
        </div>
      </template>
      <el-empty v-if="!history.length && !historyLoading" description="该品牌暂无期次快照，上传首期后此处将展示档案" :image-size="60" />
      <div v-else class="history-list">
        <div v-for="s in history" :key="s.id" class="history-item">
          <div class="his-left">
            <div class="his-period">{{ s.period }}<el-tag size="small" type="info" effect="plain" style="margin-left: 8px">{{ s.data_version || '未标版本' }}</el-tag></div>
            <div class="his-meta">
              <span>共 {{ s.total_count }} 行</span>
              <span style="margin-left: 12px">营业 {{ s.open_count }}</span>
              <span style="margin-left: 12px">来源：{{ s.source_file || '-' }}</span>
              <span style="margin-left: 12px">{{ formatTime(s.created_at) }}</span>
            </div>
          </div>
          <div class="his-right">
            <el-button size="small" @click="exportOne(s)">
              <el-icon><Download /></el-icon> 导出该期
            </el-button>
            <el-button size="small" type="primary" plain @click="$emit('goto-monitor', { brand, period: s.period })">
              去对比
            </el-button>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload, Download, Search, Refresh, Document } from '@element-plus/icons-vue'
import { useCompetitorStore } from '@/stores/competitor'

const emit = defineEmits(['imported', 'goto-monitor'])
const competitorStore = useCompetitorStore()

/* ---------------- 表单状态 ---------------- */
const brand = ref('')
const period = ref('')
const dataVersion = ref('')
const suggestedPeriod = ref('')
const fileName = ref('')
const uploadRef = ref(null)
const rawFile = ref(null)

const previewing = ref(false)
const importing = ref(false)
const previewData = ref(null)
const manualSummary = reactive({ summary: { total: 0, autoCount: 0, maybeCount: 0, keepCount: 0 }, items: [] })
const adoptChecked = ref(new Set())

const history = ref([])
const historyLoading = ref(false)

/* ---------------- 品牌候选（竞品列表品牌 + 快照品牌） ---------------- */
const brandOptions = computed(() => {
  const set = new Set()
  competitorStore.competitors.forEach(c => { if (c.brand) set.add(c.brand) })
  snapshotBrandsCache.value.forEach(b => set.add(b.brand))
  return [...set].sort()
})
const snapshotBrandsCache = ref([])

const canPreview = computed(() => brand.value && period.value && rawFile.value)
const canImport = computed(() => previewData.value && !previewData.value.blockImport && !previewData.value.sameHashExists)

/* ---------------- 文件 ---------------- */
const handleFileChange = (file) => {
  rawFile.value = file.raw
  fileName.value = file.name
  // 换文件后旧预览失效
  if (previewData.value) resetPreview(false)
}
const handleFileRemove = () => {
  rawFile.value = null
  fileName.value = ''
  resetPreview(false)
}
const handleExceed = () => ElMessage.warning('仅支持上传一个文件，请先移除已有文件')
const downloadTemplate = () => {
  const csv = 'store_id,brand,name,store_category,city,district,trading_area,address,price,rating,reviews,status,latitude,longitude\n' +
    'CS1001,大米先生,大米先生人民广场店,快餐,上海市,黄浦区,人民广场商圈,人民大道100号,28,4.2,860,营业中,31.2304,121.4737\n' +
    'CS1002,大米先生,大米先生静安寺店,快餐,上海市,静安区,静安寺商圈,南京西路1601号,30,4.4,1200,营业中,31.2230,121.4450\n' +
    'CS1003,大米先生,大米先生徐家汇店,快餐,上海市,徐汇区,徐家汇商圈,肇嘉浜路1111号,29,4.1,640,已闭店,31.1920,121.4360'
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'competitor_snapshot_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/* ---------------- 预览 ---------------- */
const handlePreview = async () => {
  previewing.value = true
  try {
    const res = await competitorStore.previewSnapshot({ brand: brand.value, period: period.value, file: rawFile.value })
    if (!res.success) {
      ElMessage.error(res.message || '解析失败')
      return
    }
    previewData.value = res.data
    suggestedPeriod.value = res.data.suggestedPeriod || ''
    // 版本识别结果回填（用户未手填时）
    if (res.data.dataVersion && !dataVersion.value) dataVersion.value = res.data.dataVersion
    manualSummary.items = res.data.manualSummary?.items || []
    manualSummary.summary = res.data.manualSummary?.summary || { total: 0, autoCount: 0, maybeCount: 0, keepCount: 0 }
    // 默认勾选 auto
    adoptChecked.value = new Set(manualSummary.items.filter(i => i.level === 'auto' && i.csvMatch).map(i => i.manualId))
    if (res.data.blockImport) {
      ElMessage.error('文件缺少稳定门店 ID 列，无法导入')
    } else if (res.data.sameHashExists) {
      ElMessage.info('该期快照已存在且内容一致')
    } else {
      ElMessage.success(`解析成功：共 ${res.data.total} 行（其中营业 ${res.data.openCount} 行）`)
    }
  } finally {
    previewing.value = false
  }
}

const resetPreview = (clearAll = true) => {
  previewData.value = null
  manualSummary.items = []
  manualSummary.summary = { total: 0, autoCount: 0, maybeCount: 0, keepCount: 0 }
  adoptChecked.value = new Set()
  if (clearAll) { suggestedPeriod.value = ''; dataVersion.value = '' }
}

const toggleAdopt = (row, val) => {
  const s = new Set(adoptChecked.value)
  if (val) s.add(row.manualId)
  else s.delete(row.manualId)
  adoptChecked.value = s
}

const levelText = l => ({ auto: '自动匹配', maybe: '疑似匹配', keep: '保留' }[l] || l)
const levelTag = l => ({ auto: 'success', maybe: 'warning', keep: 'info' }[l] || 'info')
const versionSourceText = s => ({ column: 'CSV版本列', filename: '文件名', '': '未识别（可手填）' }[s] || s)

/* ---------------- 导入 ---------------- */
const handleImport = async () => {
  importing.value = true
  try {
    const res = await competitorStore.importSnapshot({
      brand: brand.value,
      period: period.value,
      file: rawFile.value,
      adoptIds: [...adoptChecked.value],
      dataVersion: dataVersion.value || null
    })
    if (!res.success) {
      ElMessage.error(res.data?.message || res.message || '导入失败')
      return
    }
    const d = res.data || {}
    ElMessage.success(d.message || `导入成功（${d.total} 条）`)
    emit('imported', { brand: brand.value, period: period.value, ...d })
    resetPreview(true)
    rawFile.value = null
    fileName.value = ''
    uploadRef.value?.clearFiles()
    refreshHistory()
  } finally {
    importing.value = false
  }
}

/* ---------------- 历史期次 ---------------- */
const refreshHistory = async () => {
  if (!brand.value) { history.value = []; return }
  historyLoading.value = true
  try {
    const res = await competitorStore.listBrandSnapshots(brand.value)
    if (res.success) {
      history.value = (res.data.brands?.[0]?.snapshots || []).slice().reverse()
    }
  } finally {
    historyLoading.value = false
  }
}

const handleBrandChange = () => { resetPreview(true); refreshHistory() }

const exportOne = async (s) => {
  const res = await competitorStore.exportSnapshotCsv({ brand: brand.value, period: s.period })
  if (!res.success) { ElMessage.error(res.message); return }
  saveBlob(res.blob, `${brand.value}_${s.period}.csv`)
}

const saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const formatTime = (t) => {
  if (!t) return ''
  const s = String(t).includes('T') ? t : t.replace(' ', 'T')
  const dt = new Date(s)
  if (isNaN(dt)) return t
  const p = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`
}

const applySuggestion = () => {
  period.value = suggestedPeriod.value
  ElMessage.success(`已填入建议期次 ${suggestedPeriod.value}`)
}

/* ---------------- 挂载 ---------------- */
onMounted(async () => {
  // 拉快照品牌缓存 + 竞品品牌
  const res = await competitorStore.listSnapshotBrands()
  if (res.success) {
    snapshotBrandsCache.value = res.data.brands || []
    const withBrand = res.data.brands?.find(b => b.brand)
    if (withBrand) { brand.value = withBrand.brand; refreshHistory() }
  }
})

defineExpose({ refreshHistory, setBrand: (b) => { brand.value = b; refreshHistory() } })
</script>

<style lang="scss" scoped>
.snapshot-upload-panel {
  .block-card { margin-bottom: 16px; border-radius: 8px; }
  .card-head {
    display: flex; align-items: center; font-weight: 600; font-size: 14px;
    .step-badge {
      display: inline-flex; width: 22px; height: 22px; border-radius: 50%;
      background: #409eff; color: #fff; font-size: 12px; align-items: center;
      justify-content: center; margin-right: 8px;
    }
  }
  .file-name { color: #666; font-size: 13px; display: inline-flex; align-items: center; gap: 4px; }
  .stat-row {
    .stat-box {
      background: #f5f7fa; border-radius: 6px; padding: 10px 0; text-align: center;
      .stat-num { font-size: 22px; font-weight: 700; color: #303133;
        &.warn { color: #e6a23c; } }
      .stat-label { font-size: 12px; color: #909399; margin-top: 2px; }
    }
  }
  .version-line { margin-top: 12px; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
  .sub-title { font-size: 13px; font-weight: 600; color: #303133; margin-bottom: 8px; }
  .sub-hint { font-size: 12px; color: #909399; font-weight: 400; margin-left: 8px;
    b.auto { color: #67c23a; } b.maybe { color: #e6a23c; } b.keep { color: #909399; } }
  .history-list {
    .history-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 12px; border: 1px solid #ebeef5; border-radius: 6px; margin-bottom: 8px;
      background: #fafafa;
      &:hover { border-color: #c6e2ff; background: #f5faff; }
      .his-left {
        .his-period { font-weight: 600; font-size: 14px; color: #303133; }
        .his-meta { font-size: 12px; color: #909399; margin-top: 3px; }
      }
    }
  }
}
</style>
