<template>
  <el-dialog
    :model-value="modelValue"
    :width="dialogWidth"
    :close-on-click-modal="false"
    class="import-dialog"
    append-to-body
    @update:model-value="onVisibleChange"
    @closed="resetAll"
  >
    <template #header>
      <span class="dlg-title"><AppIcon><Upload /></AppIcon>导入联通 Excel（外部报表批量导入）</span>
    </template>
    <div class="imp-body">
      <!-- ① 规则说明 -->
      <div class="imp-rules">
        <p><b>导入规则</b>：文件须为统一格式报表（文件名 = 门店名_半径km_月份[yyyyMM]，如 <code>苏州新区AEON MALL_2km_202606_20260908152107.xlsx</code>）；门店名与「我的门店」<b>精确同名</b>的自动导入，<b>近似名称</b>会推荐候选门店、需你<b>逐个确认</b>后导入；导入<b>不扣配额</b>，成为完整购买履历。</p>
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
          <el-tag v-if="needConfirmList.length" type="warning" effect="plain">待确认 {{ needConfirmList.length }}</el-tag>
          <el-tag v-if="matchFailList.length" type="danger" effect="plain">门店不匹配 {{ matchFailList.length }}</el-tag>
          <el-tag v-if="dupList.length" type="warning" effect="plain">重复 {{ dupList.length }}</el-tag>
          <el-tag v-if="parseFailList.length" type="info" effect="plain">格式不符 {{ parseFailList.length }}</el-tag>
        </div>
        <el-table ref="previewTableRef" :data="previewRows" height="380" border size="small" @selection-change="onSelChange">
          <el-table-column type="selection" width="42" :selectable="canSelect" />
          <el-table-column prop="fileName" label="文件名" min-width="200" show-overflow-tooltip />
          <el-table-column prop="storeName" label="门店名（解析）" width="150" show-overflow-tooltip />
          <!-- v1.13.425：近似名要用户自己选门店。⛔ 系统只推荐，绝不替用户认店 -->
          <el-table-column label="匹配门店" min-width="270">
            <template #default="{ row }">
              <template v-if="row.ok">
                <span class="mt-exact">{{ row.storeName }}</span>
                <el-tag size="small" type="success" effect="plain" class="mt-tag">精确</el-tag>
              </template>
              <template v-else-if="row.needConfirm">
                <el-select
                  :model-value="row.confirmedStoreId || null"
                  size="small"
                  filterable
                  remote
                  clearable
                  :remote-method="(q) => searchStores(row, q)"
                  :loading="row.searching"
                  placeholder="请选择对应门店（可搜索）"
                  style="width: 100%"
                  @update:model-value="(v) => onPickStore(row, v)"
                >
                  <el-option v-for="o in row.options" :key="o.id" :label="optionLabel(o)" :value="o.id" />
                </el-select>
                <div v-if="row.ambiguous && !row.confirmedStoreId" class="mt-warn">存在多个相近门店，请核对地址后选择</div>
              </template>
              <span v-else class="mt-dash">—</span>
            </template>
          </el-table-column>
          <el-table-column label="半径" width="78">
            <template #default="{ row }">{{ fmtRadius(row.radiusM) }}</template>
          </el-table-column>
          <el-table-column label="月份" width="86">
            <template #default="{ row }">{{ row.cityMonth || '-' }}</template>
          </el-table-column>
          <el-table-column prop="rowCount" label="指标行" width="70" align="right" />
          <el-table-column label="状态" width="190">
            <template #default="{ row }">
              <el-tag v-if="row.duplicate" type="warning" size="small">⚠️ 重复已存在</el-tag>
              <el-tag v-else-if="row.ok" type="success" size="small">✅ 可导入</el-tag>
              <el-tag v-else-if="row.needConfirm && row.confirmedStoreId && row.confirmedDuplicate" type="info" size="small">⚠️ 该门店同月已有记录</el-tag>
              <el-tag v-else-if="row.needConfirm && row.confirmedStoreId" type="warning" size="small">⚠️ 已确认，请勾选</el-tag>
              <el-tag v-else-if="row.needConfirm" type="warning" size="small">⚠️ 待确认门店</el-tag>
              <el-tooltip v-else :content="row.reason || '解析失败'" placement="top">
                <el-tag type="danger" size="small">❌ {{ shortReason(row) }}</el-tag>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
        <div class="imp-actions">
          <el-button @click="stage = 'pick'; previewRows = []">← 重新选择</el-button>
          <el-button v-if="confirmedNotPicked > 0" @click="checkAllConfirmed">勾选全部已确认行（{{ confirmedNotPicked }}）</el-button>
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
import { FolderOpened, Upload } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
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

// 多了一列「匹配门店」，预览态加宽（列宽合计约 1120 + 内边距）
const dialogWidth = computed(() => (stage.value === 'preview' ? '1200px' : '640px'))

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

/** 可导入＝精确命中，或「近似名但用户已选定门店」；重复的永远不算 */
const importableCount = computed(() =>
  previewRows.value.filter((r) => !r.duplicate && !r.confirmedDuplicate && (r.ok || !!r.confirmedStoreId)).length
)
const needConfirmList = computed(() => previewRows.value.filter((r) => r.needConfirm))
/** 已选好门店、但还没勾选的行数 —— 用来提示「还有 N 个等你勾」 */
const confirmedNotPicked = computed(() =>
  previewRows.value.filter((r) => r.needConfirm && r.confirmedStoreId && !r.confirmedDuplicate && !r.duplicate &&
    !selectedKeys.value.includes(r.fileKey)).length
)
const matchFailList = computed(() =>
  previewRows.value.filter((r) => !r.ok && !r.needConfirm && r.reason?.includes('系统无此门店'))
)
const dupList = computed(() => previewRows.value.filter((r) => r.duplicate || (r.needConfirm && r.confirmedDuplicate)))
// ⚠️ 必须排除 needConfirm：它 reason 为空，不排除会被算进「格式不符」
const parseFailList = computed(() =>
  previewRows.value.filter((r) => !r.ok && !r.needConfirm && !r.reason?.includes('系统无此门店'))
)

/** 行是否可勾选：精确命中，或已确认门店且该门店没有已有记录；重复行不可 */
function canSelect(row) {
  return !row.duplicate && (!!row.ok || (!!row.confirmedStoreId && !row.confirmedDuplicate))
}

function fmtRadius(m) {
  if (!m) return '-'
  return m >= 1000 ? (m % 1000 === 0 ? m / 1000 + 'km' : (m / 1000).toFixed(1).replace(/\.0$/, '') + 'km') : m + 'm'
}
function shortReason(row) {
  const r = row.reason || '解析失败'
  return r.length > 12 ? r.slice(0, 12) + '…' : r
}

/** 候选/搜索结果统一成下拉选项 */
function toOption(o) {
  return {
    id: o.id,
    name: o.name,
    city: o.city || '',
    district: o.district || '',
    address: o.address || '',
    // 该门店同半径同月份已有记录（确认后会被跳过）—— 候选自带，搜索结果没有
    duplicate: !!o.duplicate
  }
}
function optionLabel(o) {
  const place = [o.city, o.district, o.address].filter(Boolean).join(' · ')
  const dup = o.duplicate ? ' · 已有同月记录' : ''
  return place ? `${o.name}（${place}）${dup}` : `${o.name}${dup}`
}

/** 合并选项：去重 + 保住当前已选那条（搜索换页后不能把已选值弄丢） */
function mergeOptions(row, list) {
  const seen = new Set()
  const out = []
  for (const o of list) {
    if (!o || seen.has(o.id)) continue
    seen.add(o.id)
    out.push(o)
  }
  if (row.confirmedStoreId && !seen.has(row.confirmedStoreId) && row.selectedOption) {
    out.unshift(row.selectedOption)
  }
  return out
}

/** 下拉里搜本账号全部门店（相似度算不出来时的兜底） */
async function searchStores(row, q) {
  const keyword = String(q || '').trim()
  if (!keyword) {
    row.options = mergeOptions(row, row.candidates.map(toOption))
    return
  }
  const seq = ++row.searchSeq
  row.searching = true
  try {
    const data = await api.get('/purchase/import/stores', { params: { q: keyword } })
    if (seq !== row.searchSeq) return // 过期结果丢弃（快速连打时后发先至）
    const hits = (data.stores || []).map(toOption)
    row.options = mergeOptions(row, [...row.candidates.map(toOption), ...hits])
  } catch (err) {
    if (seq === row.searchSeq) {
      ElMessage.error('门店搜索失败：' + (err?.response?.data?.message || err.message || '网络错误'))
    }
  } finally {
    if (seq === row.searchSeq) row.searching = false
  }
}

/** 用户选定门店：只记值，**不自动勾选**（必须用户亲手点复选框） */
function onPickStore(row, id) {
  if (id === null || id === undefined || id === '') {
    row.confirmedStoreId = null
    row.selectedOption = null
    row.confirmedDuplicate = false
    // 取消选择时把已勾的摘掉，避免提交一条没有门店的行
    previewTableRef.value?.toggleRowSelection(row, false)
    return
  }
  row.confirmedStoreId = id
  const opt = row.options.find((o) => o.id === id) || null
  row.selectedOption = opt
  // 该门店同半径同月份已有记录 ⇒ 提示且不可勾选（提交也只会被跳过）
  row.confirmedDuplicate = !!(opt && opt.duplicate)
  if (opt && !row.options.some((o) => o.id === id)) row.options.unshift(opt)
}

/** 一次勾选所有「已选好门店」的行（仍是一次显式动作，只是省掉逐个点） */
function checkAllConfirmed() {
  const t = previewTableRef.value
  if (!t) return
  let n = 0
  for (const row of previewRows.value) {
    if (!row.ok && row.confirmedStoreId && !row.duplicate && !row.confirmedDuplicate) {
      t.toggleRowSelection(row, true)
      n++
    }
  }
  if (!n) ElMessage.info('没有已选好门店的待确认文件')
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
    previewRows.value = (data.files || []).map((r) => {
      const candidates = Array.isArray(r.candidates) ? r.candidates : []
      const row = {
        ...r,
        candidates,
        options: candidates.map(toOption),
        confirmedStoreId: null,
        selectedOption: null,
        confirmedDuplicate: false,
        searching: false,
        searchSeq: 0
      }
      // 唯一高置信候选（归一化后同名）⇒ 预置选中；⛔ 不预置勾选
      const sug = candidates.find((c) => c.suggest)
      if (r.needConfirm && sug) {
        row.confirmedStoreId = sug.id
        row.selectedOption = toOption(sug)
        row.confirmedDuplicate = !!sug.duplicate
      }
      return row
    })
    stage.value = 'preview'
    if (!previewRows.value.length) ElMessage.warning('预检无结果')
    await nextTick()
    // 默认勾选**只有**精确命中的行：近似名的必须用户自己决定
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
  // 提交前再兜一道：勾了近似名行却没选门店 ⇒ 直接挡住（后端也会拒，但别让用户白等）
  const missing = previewRows.value.filter(
    (r) => selectedKeys.value.includes(r.fileKey) && r.needConfirm && !r.confirmedStoreId
  )
  if (missing.length) {
    ElMessage.warning(`请先为 ${missing.length} 个近似门店选择对应门店`)
    return
  }
  const confirmMap = {}
  for (const row of previewRows.value) {
    if (row.confirmedStoreId) confirmMap[row.fileKey] = row.confirmedStoreId
  }
  committing.value = true
  try {
    const data = await api.post('/purchase/import/commit', { fileKeys: selectedKeys.value, confirmMap }, { timeout: 300000 })
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
  padding: 10px 14px; font-size: 12.5px; color: var(--text-regular); line-height: 1.7;
}
.imp-rules code { background: #eef1f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; color: #476582; }
.imp-step { display: flex; flex-direction: column; gap: 12px; }
.imp-hint { margin-left: 12px; color: #67c23a; font-size: 13px; }
.imp-hint.dim { color: var(--text-secondary); font-size: 12.5px; margin: 0; }
.imp-summary { display: flex; gap: 8px; flex-wrap: wrap; }
.imp-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

/* 匹配门店列 */
.mt-exact { color: var(--text-regular); margin-right: 6px; }
.mt-tag { vertical-align: middle; }
.mt-dash { color: var(--text-secondary); }
.mt-warn { margin-top: 2px; font-size: 11.5px; line-height: 1.4; color: #e6a23c; }
</style>
