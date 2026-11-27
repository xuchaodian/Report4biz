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
        <p><b>导入规则</b>：文件须为统一格式报表（文件名 = 门店名_半径km_月份[yyyyMM]，如 <code>苏州新区AEON MALL_2km_202606_20260908152107.xlsx</code>）；门店名与「我的门店」<b>精确同名</b>的自动导入，<b>近似名称</b>会推荐候选门店、需你<b>逐个确认</b>后导入（同一门店名有多个文件时，选好一个即可<b>一次套用</b>）；导入<b>不扣配额</b>，成为完整购买履历。</p>
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
        <!-- v1.13.426：同名文件一次性套用 —— 只在「确实还有得套」时才提示，避免噪音 -->
        <div v-if="nameGroups.length && groupPendingCount > 0" class="imp-same-name">
          <AppIcon tone="warning"><InfoFilled /></AppIcon>
          <span>
            本批有 {{ nameGroups.length }} 组同名文件（{{ groupPendingCount }} 个还没选门店）：{{ groupListText }}。在其中任一行选好门店后，可一键套用到同组其他文件。
          </span>
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
                  :loading="row.searching || row.checking"
                  placeholder="请选择对应门店（可搜索）"
                  style="width: 100%"
                  @update:model-value="(v) => onPickStore(row, v)"
                >
                  <el-option v-for="o in row.options" :key="o.id" :label="optionLabel(o)" :value="o.id" />
                </el-select>
                <div v-if="row.ambiguous && !row.confirmedStoreId" class="mt-warn">存在多个相近门店，请核对地址后选择</div>
                <!-- 同组还有没选门店的文件 ⇒ 给一个「一次套用」的入口（仍是用户显式点击） -->
                <div v-if="applyTargets(row).length" class="mt-apply">
                  <el-button
                    link
                    type="primary"
                    size="small"
                    :loading="applyingKey === row.fileKey"
                    @click="applyToGroup(row)"
                  >套用到同组 {{ applyTargets(row).length }} 个文件</el-button>
                </div>
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
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderOpened, Upload, InfoFilled } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import api from '@/utils/api'
import { groupPendingRows, pendingSiblingsOf, conflictSiblingCount } from '@/utils/importNameGroup'

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
/** 正在执行「套用到同组」的那一行的 fileKey（同一个按钮的 loading） */
const applyingKey = ref('')

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
  applyingKey.value = ''
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

/* ── 同名文件分组（v1.13.426）──────────────────────────────────────────────
 * 只按「门店名完全相同」分组：同一次导出里同一家店的店名一字不差。
 * ⛔ 不许改成相似度/归一化分组 —— 「星空广场」和「星空广场二期」是**两家店**，
 *    归成一组就会把人口数据写到二期头上（判据写在 utils/importNameGroup.js 顶部）。
 */
const nameGroups = computed(() => groupPendingRows(previewRows.value))
/** 组内还没选门店的行数：为 0 说明都已经定好了，提示条就不必出现 */
const groupPendingCount = computed(() =>
  nameGroups.value.reduce((n, g) => n + g.rows.filter((r) => !r.confirmedStoreId).length, 0)
)
const groupListText = computed(() => {
  const gs = nameGroups.value
  const head = gs.slice(0, 3).map((g) => `「${g.storeName}」${g.rows.length} 个`).join('、')
  return gs.length > 3 ? `${head} 等 ${gs.length} 组` : head
})

/** 可套用的目标行：本行已选好门店、且同组还有没选门店的文件 */
function applyTargets(row) {
  if (!row || !row.needConfirm || !row.confirmedStoreId) return []
  return pendingSiblingsOf(previewRows.value, row)
}

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
    duplicate: !!o.duplicate,
    // 候选是预检时**逐候选**算过 duplicate 的；搜索结果没有这个字段 ⇒ 未知，
    // 选定后要问一次后端预核（见 verifyMapping），否则又会「预检说可导、提交跳重复」
    dupKnown: Object.prototype.hasOwnProperty.call(o, 'duplicate')
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
  // 搜索出来的门店没有「是否已有记录」标记 ⇒ 问一次后端，口径与提交完全同一处
  if (opt && !opt.dupKnown) verifyMapping(row, opt)
}

/**
 * 单行映射预核（v1.13.426）：门店可用性 + 是否同月已有记录。
 *
 * 🔴 为什么要问后端：下拉里搜出来的门店可能是「已合并/已关闭/不属本账号」，
 *    前端只看得到名字；带着这种映射去提交，用户在「完成」页才看到一堆失败。
 * ⚠️ 预核失败（网络错误）**不阻断**流程：提交时后端仍会重新校验、重新判重，
 *    最坏结果是「提交后发现被跳过」，不会写错数据。
 */
async function verifyMapping(row, opt) {
  const seq = ++row.checkSeq
  row.checking = true
  try {
    const data = await api.post('/purchase/import/check-mapping', {
      items: [{ fileKey: row.fileKey, storeId: opt.id }]
    })
    if (seq !== row.checkSeq || row.confirmedStoreId !== opt.id) return // 期间用户又改了，丢弃
    const r = (data.results || [])[0]
    if (!r || !r.ok) {
      row.confirmedStoreId = null
      row.selectedOption = null
      row.confirmedDuplicate = false
      previewTableRef.value?.toggleRowSelection(row, false)
      ElMessage.warning(r?.reason || '该门店不可用，请重新选择')
      return
    }
    const fresh = { ...opt, duplicate: !!r.duplicate, dupKnown: true }
    row.selectedOption = fresh
    row.options = row.options.map((o) => (o.id === fresh.id ? fresh : o))
    row.confirmedDuplicate = !!r.duplicate
  } catch { /* 忽略：提交会重新校验 */ } finally {
    if (seq === row.checkSeq) row.checking = false
  }
}

/** 把「某门店」写进某一行（套用/单行选择共用同一套字段，避免两处口径不同） */
function applyStoreToRow(target, opt, duplicate) {
  const o = { ...opt, duplicate: !!duplicate, dupKnown: true }
  target.confirmedStoreId = o.id
  target.selectedOption = o
  target.confirmedDuplicate = !!duplicate
  // el-select 只认 options 里的项，缺了就会显示成裸 id
  if (!target.options.some((x) => x.id === o.id)) target.options.unshift(o)
}

/**
 * 一键套用到同组其他文件（v1.13.426）。
 *
 * 🔴 一次点击＝一次显式授权：先弹确认框；⛔ 不顺手替用户勾选复选框
 *    （「映射到哪家店」和「要不要导入」是两件事，425 已定：勾选必须用户亲手）。
 * 🔴 已选了**别的**门店的行不覆盖：那是用户自己的另一个决定，批量动作不许静默改掉。
 */
async function applyToGroup(row) {
  const targets = applyTargets(row)
  if (!targets.length) return
  const opt = row.selectedOption || row.options.find((o) => o.id === row.confirmedStoreId)
  if (!opt) return
  const others = conflictSiblingCount(previewRows.value, row)
  const head = targets.slice(0, 3).map((t) => t.fileName).join('、')
  const more = targets.length > 3 ? ` 等 ${targets.length} 个` : ''
  try {
    await ElMessageBox.confirm(
      `将「${opt.name}」套用到同组另外 ${targets.length} 个文件（${head}${more}）？` +
        (others ? `另有 ${others} 个已选了别的门店，不会被覆盖。` : '') +
        '套用后仍需勾选这些行才会导入。',
      '套用到同名文件',
      { confirmButtonText: '套用', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 用户取消
  }
  const storeId = row.confirmedStoreId
  applyingKey.value = row.fileKey
  try {
    // 逐文件问后端：同一门店落到不同半径/月份，重复结论各不相同，只能一个个核
    const data = await api.post('/purchase/import/check-mapping', {
      items: targets.map((t) => ({ fileKey: t.fileKey, storeId }))
    })
    const byKey = new Map()
    for (const r of data.results || []) byKey.set(r.fileKey, r)
    let applied = 0
    let dupCount = 0
    let failed = 0
    for (const t of targets) {
      const r = byKey.get(t.fileKey)
      if (!r || !r.ok) { failed++; continue }
      applyStoreToRow(t, opt, r.duplicate)
      applied++
      if (r.duplicate) dupCount++
    }
    if (!applied) {
      ElMessage.warning('套用失败：这些文件已过期或门店不可用，请重新预检')
      return
    }
    const dupTip = dupCount ? `，其中 ${dupCount} 个该门店同半径同月份已有记录（提交会跳过）` : ''
    const badTip = failed ? `，${failed} 个失败` : ''
    ElMessage.success(`已套用 ${applied} 个${dupTip}${badTip}；勾选这些行后再点「确认导入选中」`)
  } catch (err) {
    ElMessage.error('套用失败：' + (err?.response?.data?.message || err.message || '网络错误'))
  } finally {
    applyingKey.value = ''
  }
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
        searchSeq: 0,
        checking: false,
        checkSeq: 0
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
.imp-same-name {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 7px 10px; border-radius: 6px; line-height: 1.6;
  background: #fdf6ec; border: 1px solid #faecd8;
  color: #b8860b; font-size: 12.5px;
}
.imp-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

/* 匹配门店列 */
.mt-exact { color: var(--text-regular); margin-right: 6px; }
.mt-tag { vertical-align: middle; }
.mt-dash { color: var(--text-secondary); }
.mt-warn { margin-top: 2px; font-size: 11.5px; line-height: 1.4; color: #e6a23c; }
.mt-apply { margin-top: 2px; line-height: 1.2; }
.mt-apply .el-button { padding: 0; height: auto; font-size: 12px; }
</style>
