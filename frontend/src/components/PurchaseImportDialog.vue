<template>
  <el-dialog
    :model-value="modelValue"
    :width="dialogWidth"
    :close-on-click-modal="false"
    class="import-dialog"
    append-to-body
    :title="'📥 导入联通 Excel（外部报表批量导入）'"
    @update:model-value="onVisibleChange"
    @closed="resetAll"
  >
    <div class="imp-body">
      <!-- ① 规则说明 -->
      <div class="imp-rules">
        <p><b>导入规则</b>：文件须为统一格式报表（文件名 = 门店名_半径km_月份[yyyyMM]，如 <code>苏州新区AEON MALL_2km_202606_20260908152107.xlsx</code>）；门店名须与「我的门店」<b>精确同名</b>（匹配失败=整文件不导入）；导入<b>不扣配额</b>，成为完整购买履历。</p>
      </div>

      <!-- ② 选文件夹 -->
      <div v-if="stage === 'pick'" class="imp-step">
        <el-button type="primary" plain :loading="previewing" @click="pickFolder">
          <el-icon style="margin-right:4px"><FolderOpened /></el-icon>选择报表文件夹
        </el-button>
        <input ref="dirInputRef" type="file" webkitdirectory multiple accept=".xlsx,.XLSX" style="display:none" @change="onPick" />
        <span v-if="pickedCount > 0" class="imp-hint">已选 {{ pickedCount }} 个 .xlsx 文件</span>
        <p class="imp-hint dim">支持一次选整个文件夹批量预检（100+ 份可分批，单次最多 200 个）；已存在的「门店+半径+月份」会提示重复。</p>
      </div>

      <!-- ③ 预检报告 -->
      <div v-else-if="stage === 'preview'" class="imp-step">
        <div class="imp-summary">
          <el-tag type="success" effect="plain">可导入 {{ importableCount }}</el-tag>
          <el-tag v-if="matchFailList.length" type="danger" effect="plain">门店不匹配 {{ matchFailList.length }}</el-tag>
          <el-tag v-if="dupList.length" type="warning" effect="plain">重复 {{ dupList.length }}</el-tag>
          <el-tag v-if="parseFailList.length" type="info" effect="plain">格式不符 {{ parseFailList.length }}</el-tag>
        </div>
        <el-table ref="previewTableRef" :data="previewRows" height="360" border size="small" @selection-change="onSelChange">
          <el-table-column type="selection" width="42" :selectable="(row) => row.ok && !row.duplicate" />
          <el-table-column prop="fileName" label="文件名" min-width="220" show-overflow-tooltip />
          <el-table-column prop="storeName" label="门店名" width="160" show-overflow-tooltip />
          <el-table-column label="半径" width="80">
            <template #default="{ row }">{{ fmtRadius(row.radiusM) }}</template>
          </el-table-column>
          <el-table-column label="月份" width="90">
            <template #default="{ row }">{{ row.cityMonth || '-' }}</template>
          </el-table-column>
          <el-table-column prop="rowCount" label="指标行" width="70" align="right" />
          <el-table-column label="状态" width="180">
            <template #default="{ row }">
              <el-tag v-if="row.ok && !row.duplicate" type="success" size="small">✅ 可导入</el-tag>
              <el-tag v-else-if="row.duplicate" type="warning" size="small">⚠️ 重复已存在</el-tag>
              <el-tooltip v-else :content="row.reason || '解析失败'" placement="top">
                <el-tag type="danger" size="small">❌ {{ shortReason(row) }}</el-tag>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
        <div class="imp-actions">
          <el-button @click="stage = 'pick'; previewRows = []">← 重新选择</el-button>
          <el-button type="primary" :disabled="selectedKeys.length === 0" :loading="committing" @click="doCommit">
            确认导入选中（{{ selectedKeys.length }} 个）
          </el-button>
        </div>
      </div>

      <!-- ④ 完成汇总 -->
      <div v-else-if="stage === 'done'" class="imp-step">
        <el-alert
          :title="commitResult.imported?.length ? `导入完成：成功 ${commitResult.imported.length} 个` : '无文件导入'"
          :type="commitResult.imported?.length ? 'success' : 'info'"
          :closable="false" show-icon style="margin-bottom:12px"
        />
        <el-table v-if="commitResult.failed?.length || commitResult.skipped?.length" :data="doneRows" height="200" border size="small">
          <el-table-column prop="fileName" label="文件名" min-width="240" show-overflow-tooltip />
          <el-table-column prop="type" label="结果" width="90">
            <template #default="{ row }">
              <el-tag :type="row.type === '失败' ? 'danger' : 'warning'" size="small">{{ row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" min-width="240" />
        </el-table>
        <div class="imp-actions">
          <el-button type="primary" @click="emit('update:modelValue', false)">完成</el-button>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { FolderOpened } from '@element-plus/icons-vue'
import api from '@/utils/api'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'imported'])

const dirInputRef = ref(null)
const previewTableRef = ref(null)
const stage = ref('pick') // pick | preview | done
const previewing = ref(false)
const committing = ref(false)
const previewRows = ref([])
const selectedKeys = ref([])
const commitResult = ref({ imported: [], skipped: [], failed: [] })
const pickedCount = ref(0)

const dialogWidth = computed(() => (stage.value === 'preview' ? '1100px' : '640px'))

function onVisibleChange(v) {
  emit('update:modelValue', v)
}
function resetAll() {
  stage.value = 'pick'
  previewRows.value = []
  selectedKeys.value = []
  commitResult.value = { imported: [], skipped: [], failed: [] }
  pickedCount.value = 0
  if (dirInputRef.value) dirInputRef.value.value = ''
}

function pickFolder() {
  if (dirInputRef.value) dirInputRef.value.click()
}

const importableCount = computed(() => previewRows.value.filter((r) => r.ok && !r.duplicate).length)
const matchFailList = computed(() => previewRows.value.filter((r) => !r.ok && r.reason?.includes('系统无此门店')))
const dupList = computed(() => previewRows.value.filter((r) => r.duplicate))
const parseFailList = computed(() => previewRows.value.filter((r) => !r.ok && !r.reason?.includes('系统无此门店')))

function fmtRadius(m) {
  if (!m) return '-'
  return m >= 1000 ? (m % 1000 === 0 ? m / 1000 + 'km' : (m / 1000).toFixed(1).replace(/\.0$/, '') + 'km') : m + 'm'
}
function shortReason(row) {
  const r = row.reason || '解析失败'
  return r.length > 12 ? r.slice(0, 12) + '…' : r
}

async function onPick(e) {
  const files = Array.from(e.target.files || [])
    .filter((f) => /\.xlsx$/i.test(f.name))
  if (files.length === 0) {
    ElMessage.warning('未找到 .xlsx 报表文件')
    return
  }
  pickedCount.value = files.length
  previewing.value = true
  const fd = new FormData()
  for (const f of files) fd.append('files', f)
  try {
    const data = await api.post('/purchase/import/preview', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180000
    })
    previewRows.value = data.files || []
    stage.value = 'preview'
    if (!previewRows.value.length) ElMessage.warning('预检无结果')
    await nextTick()
    // 默认勾选全部可导入行
    if (previewTableRef.value) {
      for (const row of previewRows.value) {
        if (row.ok && !row.duplicate) previewTableRef.value.toggleRowSelection(row, true)
      }
    }
  } catch (err) {
    ElMessage.error('预检失败：' + (err?.response?.data?.message || err.message || '网络错误'))
  } finally {
    previewing.value = false
  }
}

function onSelChange(rows) {
  selectedKeys.value = rows.map((r) => r.fileKey)
}

async function doCommit() {
  if (!selectedKeys.value.length) return
  committing.value = true
  try {
    const data = await api.post('/purchase/import/commit', { fileKeys: selectedKeys.value }, { timeout: 300000 })
    commitResult.value = data
    stage.value = 'done'
    emit('imported', data)
    const n = data.imported?.length || 0
    ElMessage.success(`导入完成：成功 ${n} 个${data.failed?.length ? `，失败 ${data.failed.length} 个` : ''}${data.skipped?.length ? `，跳过重复 ${data.skipped.length} 个` : ''}`)
  } catch (err) {
    ElMessage.error('导入失败：' + (err?.response?.data?.message || err.message || '网络错误'))
  } finally {
    committing.value = false
  }
}

const doneRows = computed(() => {
  const rows = []
  for (const f of commitResult.value.failed || []) rows.push({ fileName: f.fileName, type: '失败', reason: f.reason })
  for (const f of commitResult.value.skipped || []) rows.push({ fileName: f.fileName, type: '跳过', reason: f.reason || '重复' })
  return rows
})
</script>

<style scoped>
.imp-body { display: flex; flex-direction: column; gap: 12px; }
.imp-rules {
  background: #f5f7fa; border: 1px solid #ebeef5; border-radius: 6px;
  padding: 10px 14px; font-size: 12.5px; color: #606266; line-height: 1.7;
}
.imp-rules code { background: #eef1f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; color: #476582; }
.imp-step { display: flex; flex-direction: column; gap: 12px; }
.imp-hint { margin-left: 12px; color: #67c23a; font-size: 13px; }
.imp-hint.dim { color: #909399; font-size: 12.5px; margin: 0; }
.imp-summary { display: flex; gap: 8px; flex-wrap: wrap; }
.imp-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
</style>
