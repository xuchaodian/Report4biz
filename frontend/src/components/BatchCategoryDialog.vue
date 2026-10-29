<template>
  <el-dialog
    :model-value="modelValue"
    title="批量补「门店区分」"
    width="900px"
    :close-on-click-modal="false"
    @update:model-value="v => emit('update:modelValue', v)"
  >
    <el-alert type="info" :closable="false" class="bc-note">
      <template #title>
        门店区分是<b>选址形态</b>（{{ categories.join(' / ') }}），不是菜系业态。
        它只影响销售预测里「参照店类型匹配」的一个加分项 —— 填了参照店更贴近，不填也能出预测。
      </template>
    </el-alert>

    <!-- 按品牌批量：连锁客户最常用的路径（同一品牌的门店形态通常一致） -->
    <div class="bc-quick">
      <span class="bc-quick-label">按品牌批量</span>
      <el-select v-model="quickBrand" placeholder="选择品牌" filterable clearable style="width: 180px">
        <el-option v-for="b in brandOptions" :key="b.brand" :label="`${b.brand || '（无品牌）'}（${b.pending} 家）`" :value="b.brand" />
      </el-select>
      <el-select v-model="quickCat" placeholder="门店区分" style="width: 150px">
        <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
      </el-select>
      <el-button size="small" type="primary" plain :disabled="!quickBrand || !quickCat" @click="applyByBrand">
        套用到该品牌（{{ quickBrandPending }} 家）
      </el-button>
      <span class="bc-tip">只填进「还没填」的门店，不会覆盖已有值</span>
    </div>

    <!-- 逐行：勾选后统一设，或单行用下拉改 -->
    <div class="bc-bar">
      <el-input v-model="keyword" placeholder="搜索门店名/编号" aria-label="搜索门店" size="small" style="width: 200px" clearable />
      <el-checkbox v-model="showAll" size="small">同时显示已填的门店（{{ allCount - pendingCount }} 家）</el-checkbox>
      <span class="bc-tip">待补 {{ pendingCount }} 家{{ readonlyCount ? `；另有 ${readonlyCount} 家集团下发只读，不可在此修改` : '' }}</span>
    </div>

    <el-table
      :data="rows"
      size="small"
      max-height="350"
      v-loading="saving"
      :row-class-name="rowClass"
      @selection-change="onSelect"
    >
      <el-table-column type="selection" width="42" :selectable="canSelect" />
      <el-table-column label="门店" min-width="190" show-overflow-tooltip>
        <template #default="{ row }">
          <div>{{ row.name || '（未命名）' }}</div>
          <div class="bc-sub">
            {{ row.store_code || '无编号' }}
            <el-tag v-if="row.sync_readonly" size="small" type="warning" style="margin-left: 4px;">集团下发·只读</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="brand" label="品牌" width="110" show-overflow-tooltip />
      <el-table-column prop="city" label="城市" width="90" />
      <el-table-column label="当前" width="110">
        <template #default="{ row }">
          <span :class="['bc-cur', row.store_category ? '' : 'is-empty']">{{ row.store_category || '未填' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="设为" width="150">
        <template #default="{ row }">
          <el-select
            v-model="drafts[row.id]"
            size="small"
            placeholder="选择"
            :disabled="!!row.sync_readonly || saving"
            clearable
            style="width: 100%"
          >
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <div class="bc-foot">
        <div class="bc-foot-l">
          <span class="bc-tip">已勾选 {{ selected.length }} 家</span>
          <el-select v-model="bulkCat" size="small" placeholder="统一设为" style="width: 140px">
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
          <el-button size="small" :disabled="!selected.length || !bulkCat" @click="applyToSelected">应用到已勾选</el-button>
        </div>
        <div>
          <el-button @click="emit('update:modelValue', false)">取消</el-button>
          <el-button type="primary" :loading="saving" :disabled="changedCount === 0" @click="submit">
            保存（{{ changedCount }} 家）
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
/**
 * 批量补「门店区分」弹窗（v1.13.294）
 *
 * 为什么需要：体检页那一栏常年 232/233 为空，单店编辑只能一家一家点；
 *   而门店区分只有 8 个固定选项、且同品牌门店形态往往一致 ⇒ 批量是唯一可行路径。
 *
 * 🔴 三条不能动的口径：
 *   ① 候选值取 `markerStore.storeCategories`（与单店编辑同一份，⛔ 不在这里另写一份）；
 *   ② **只填空值**：无论「按品牌套用」还是「应用到已勾选」，默认都不覆盖已有值
 *      （勾选行会显式提示「将覆盖」）；清空请走单店编辑，本弹窗不提供清空；
 *   ③ 集团下发的只读镜像行照常列出但**不可勾选、不可改**，只做计数说明。
 *
 * 提交：按「目标值」分组，逐组 POST /api/markers/bulk-category（一个品类一次请求）。
 */
import { computed, reactive, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useMarkerStore } from '@/stores/marker'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  stores: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'done'])

const markerStore = useMarkerStore()
const categories = computed(() => markerStore.storeCategories || [])

const keyword = ref('')
const showAll = ref(false)
const quickBrand = ref('')
const quickCat = ref('')
const bulkCat = ref('')
const selected = ref([])
const saving = ref(false)
const drafts = reactive({})     // id → 目标门店区分（用户改动）

const isReadonly = (s) => Number(s.sync_readonly) === 1
const isEmpty = (s) => !String(s.store_category || '').trim()

const pendingCount = computed(() => props.stores.filter((s) => !isReadonly(s) && isEmpty(s)).length)
const readonlyCount = computed(() => props.stores.filter((s) => isReadonly(s) && isEmpty(s)).length)
const allCount = computed(() => props.stores.length)

const rows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return props.stores
    .filter((s) => showAll.value || isEmpty(s))
    .filter((s) => {
      if (!kw) return true
      return String(s.name || '').toLowerCase().includes(kw) || String(s.store_code || '').toLowerCase().includes(kw)
    })
    .slice(0, 500)   // 与后端上限一致，避免提交时被拒
})

/** 品牌聚合：只统计「可改且未填」的家数，作为「套用」的实际影响面 */
const brandOptions = computed(() => {
  const map = new Map()
  for (const s of props.stores) {
    if (isReadonly(s)) continue
    const key = String(s.brand || '').trim()
    const rec = map.get(key) || { brand: key, pending: 0, total: 0 }
    rec.total++
    if (isEmpty(s)) rec.pending++
    map.set(key, rec)
  }
  return [...map.values()].filter((b) => b.pending > 0).sort((a, b) => b.pending - a.pending)
})
const quickBrandPending = computed(() => brandOptions.value.find((b) => b.brand === quickBrand.value)?.pending || 0)

const changedCount = computed(() => rows.value.filter((r) => {
  const v = drafts[r.id]
  return v && v !== String(r.store_category || '').trim()
}).length)

const canSelect = (row) => !isReadonly(row)

function onSelect(list) { selected.value = list }
function rowClass({ row }) { return isReadonly(row) ? 'is-readonly' : '' }

/** 按品牌套用：只填该品牌**未填**的门店，绝不覆盖已有值 */
function applyByBrand() {
  if (!quickBrand.value || !quickCat.value) return
  const targets = props.stores.filter((s) => !isReadonly(s) && isEmpty(s) && String(s.brand || '').trim() === quickBrand.value)
  if (targets.length === 0) { ElMessage.warning('该品牌没有待补的门店'); return }
  for (const s of targets) drafts[s.id] = quickCat.value
  ElMessage.success(`已标记 ${targets.length} 家「${quickBrand.value || '（无品牌）'}」门店，确认后点保存`)
}

/** 应用到已勾选：这条会覆盖已勾选行的现有值（勾选是显式动作，可以改） */
function applyToSelected() {
  if (!selected.value.length || !bulkCat.value) return
  const writable = selected.value.filter((s) => !isReadonly(s))
  if (writable.length === 0) { ElMessage.warning('勾选的门店均为集团下发只读'); return }
  const overwrite = writable.filter((s) => !isEmpty(s) && s.store_category !== bulkCat.value).length
  for (const s of writable) drafts[s.id] = bulkCat.value
  ElMessage.success(overwrite > 0
    ? `已标记 ${writable.length} 家，其中 ${overwrite} 家会覆盖原值`
    : `已标记 ${writable.length} 家，确认后点保存`)
}

async function submit() {
  const groups = new Map()
  for (const r of rows.value) {
    const v = drafts[r.id]
    if (!v) continue
    if (v === String(r.store_category || '').trim()) continue
    if (isReadonly(r)) continue
    if (!groups.has(v)) groups.set(v, [])
    groups.get(v).push(r.id)
  }
  if (groups.size === 0) { ElMessage.warning('没有需要保存的改动'); return }

  saving.value = true
  let updated = 0
  let skippedReadonly = 0
  let notFound = 0
  const failed = []
  try {
    for (const [cat, ids] of groups) {
      try {
        const { data } = await axios.post('/api/markers/bulk-category', { ids, storeCategory: cat })
        updated += data?.updated || 0
        skippedReadonly += data?.skippedReadonly || 0
        notFound += data?.notFound || 0
        // 成功的清掉草稿，避免重复提交
        for (const id of ids) delete drafts[id]
      } catch (e) {
        failed.push({ cat, message: e?.response?.data?.message || '提交失败' })
      }
    }

    if (failed.length === 0) {
      const extra = []
      if (skippedReadonly) extra.push(`${skippedReadonly} 家只读跳过`)
      if (notFound) extra.push(`${notFound} 家无权修改`)
      ElMessage.success(`已更新 ${updated} 家门店区分${extra.length ? `（${extra.join('，')}）` : ''}`)
      emit('done', updated)
      emit('update:modelValue', false)
    } else {
      ElMessage.error(`部分失败：${failed.map((f) => `「${f.cat}」${f.message}`).join('；')}${updated ? `（已成功 ${updated} 家）` : ''}`)
      emit('done', updated)
    }
  } finally {
    saving.value = false
  }
}

// 每次打开清空草稿与勾选：否则上一次没保存的选择会「幽灵」带到下次
watch(() => props.modelValue, (open) => {
  if (!open) return
  for (const k of Object.keys(drafts)) delete drafts[k]
  selected.value = []
  quickBrand.value = ''
  quickCat.value = ''
  bulkCat.value = ''
  keyword.value = ''
})
</script>

<style scoped>
.bc-note { margin-bottom: 12px; }
.bc-quick { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; padding: 10px 12px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; }
.bc-quick-label { font-size: 13px; color: #374151; font-weight: 600; }
.bc-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.bc-tip { font-size: 12px; color: #909399; }
.bc-sub { font-size: 11px; color: #909399; margin-top: 2px; }
.bc-cur.is-empty { color: #b91c1c; }
.bc-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.bc-foot-l { display: flex; align-items: center; gap: 8px; }
:deep(.is-readonly) td { background: #fafafa; color: #9ca3af; }
</style>
