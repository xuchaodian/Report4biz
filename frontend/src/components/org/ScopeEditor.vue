<template>
  <el-drawer
    v-model="visible"
    :title="drawerTitle"
    size="560px"
    :close-on-click-modal="false"
    append-to-body
  >
    <div v-loading="loading" class="scope-editor">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="管辖范围 = 该子公司可同步的「上限」"
        description="子公司只能同步落在本范围内的门店；范围之外的行不会出现在候选里。只到城市级，不细分区县。保存后立即生效（下次同步即按新范围计算候选）。"
      />

      <el-form label-position="top" class="scope-form">
        <el-form-item>
          <template #label>
            <span class="lab">城市</span>
            <span class="dim">多选 / 支持搜索；括号内为集团在该城市的门店数</span>
          </template>
          <el-select
            v-model="cities"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            :max-collapse-tags="6"
            placeholder="选择城市"
            style="width: 100%"
          >
            <el-option
              v-for="c in cityOptions"
              :key="c.key"
              :label="c.name"
              :value="c.name"
            >
              <span class="opt-name">{{ c.name }}</span>
              <span class="opt-right">
                <span v-if="c.count" class="opt-count">{{ c.count }} 家</span>
                <span v-else-if="c.missing" class="opt-missing">集团暂无门店</span>
                <span v-if="occupancy.get(c.key)" class="opt-taken">
                  已被 {{ occupancy.get(c.key).company || occupancy.get(c.key).username }} 占用
                </span>
              </span>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item v-if="localConflicts.length">
          <el-alert
            type="error"
            :closable="false"
            show-icon
            :title="`有 ${localConflicts.length} 个所选城市已被本组织其他成员占用`"
          >
            <div v-for="c in localConflicts" :key="c.cityKey" class="conflict-row">
              城市 <b>{{ c.city }}</b> 当前归属「{{ c.company || c.username }}」
              <el-tooltip content="划拨向导随 P2 批次上线" placement="top">
                <span><el-button size="small" text type="primary" disabled>发起划拨</el-button></span>
              </el-tooltip>
            </div>
            <div class="conflict-foot">请改选其他城市，或先走划拨流程把该城市转给本子公司。</div>
          </el-alert>
        </el-form-item>

        <el-form-item>
          <template #label>
            <span class="lab">品牌</span>
            <span class="dim">留空 = 不限</span>
          </template>
          <el-select
            v-model="brands"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            placeholder="不限"
            style="width: 100%"
          >
            <el-option v-for="b in options.brands" :key="b" :label="b" :value="b" />
          </el-select>
        </el-form-item>
      </el-form>

      <div class="estimate">
        预计可同步：集团当前有 <b>{{ estimate }}</b> 家门店落在所选城市范围内
        <span v-if="cities.length" class="dim">（覆盖 {{ cities.length }} 个城市）</span>
      </div>
      <div v-if="!cities.length" class="estimate-tip">
        未选择任何城市 = 该子公司暂无可同步范围（不会拉到任何门店）。
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存范围</el-button>
    </template>
  </el-drawer>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/utils/api'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  orgId: { type: [Number, String], default: null },
  // { userId, username, company }
  member: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const loading = ref(false)
const saving = ref(false)
const cities = ref([])
const brands = ref([])
const options = ref({ cities: [], brands: [] })
const occupancyMembers = ref([])

/**
 * 城市归一化 —— ★ 与后端 `backend/src/utils/scopeGuard.js::normalizeCity` 保持镜像。
 * 前后端各存一份是刻意的（前端不能 import 后端模块）；**改一侧必须同步另一侧**，
 * 否则前端预检与后端 409 的判定会出现分歧。
 */
const normCity = (s) => String(s ?? '').replace(/[\s\u3000]+/g, '').trim().replace(/市$/, '')

const drawerTitle = computed(() => {
  const who = props.member?.username || '子公司'
  return `${who} · 管辖范围`
})

/** 城市候选 = 集团有门店的城市 ∪ 该成员已选但集团暂无门店的城市（后者要能回显） */
const cityOptions = computed(() => {
  const list = (options.value.cities || []).map(c => ({ ...c }))
  const known = new Set(list.map(c => c.key))
  for (const name of cities.value) {
    const key = normCity(name)
    if (!key || known.has(key)) continue
    known.add(key)
    list.push({ name, key, count: 0, missing: true })
  }
  return list
})

/**
 * 本组织「城市 → 占用方」映射（**排除自己**、先到先得）。
 * 与后端 `buildOccupancyMap(members, excludeUserId)` 同口径。
 */
const occupancy = computed(() => {
  const map = new Map()
  const selfId = Number(props.member?.userId)
  for (const m of occupancyMembers.value) {
    if (Number(m.userId) === selfId) continue
    for (const c of (m.cities || [])) {
      const key = normCity(c)
      if (!key || map.has(key)) continue
      map.set(key, { city: c, userId: m.userId, username: m.username, company: m.company })
    }
  }
  return map
})

/** 实时冲突：当前所选城市里、已被本组织其他成员占用的部分 */
const localConflicts = computed(() => {
  const out = []
  const seen = new Set()
  for (const name of cities.value) {
    const key = normCity(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const holder = occupancy.value.get(key)
    if (holder) out.push({ city: name, cityKey: key, ...holder })
  }
  return out
})

/** 预计可同步门店数 = Σ(所选城市在集团账号下的门店数) */
const estimate = computed(() => {
  let n = 0
  for (const name of cities.value) {
    const key = normCity(name)
    const hit = (options.value.cities || []).find(c => c.key === key)
    if (hit) n += hit.count || 0
  }
  return n
})

function errMsg(e, fallback) {
  return e?.response?.data?.message || fallback
}

async function load() {
  if (!props.orgId || !props.member?.userId) return
  loading.value = true
  try {
    const [optRes, scopeRes, conflictRes] = await Promise.all([
      api.get('/sync/scope-options', { params: { orgId: props.orgId, userId: props.member.userId } }),
      api.get(`/orgs/${props.orgId}/members/${props.member.userId}/scope`),
      api.get(`/orgs/${props.orgId}/scope-conflicts`)
    ])
    options.value = {
      cities: optRes?.cities || [],
      brands: optRes?.brands || []
    }
    const sc = scopeRes?.scope || { cities: [], brands: [] }
    cities.value = [...(sc.cities || [])]
    brands.value = [...(sc.brands || [])]
    occupancyMembers.value = conflictRes?.members || []
  } catch (e) {
    ElMessage.error(errMsg(e, '加载管辖范围失败'))
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => { if (open) load() }
)

function submit() {
  if (!props.orgId || !props.member?.userId) return
  const conflicts = localConflicts.value
  if (!conflicts.length) return doSave(false)

  const c = conflicts[0]
  const holder = c.company || c.username
  ElMessageBox.confirm(
    `城市「${c.city}」当前归属「${holder}」，正常保存会被拒绝（规则：城市互斥）。`
    + '如确需修正历史数据（同城两家），可强制保存并留痕。',
    '所选城市已被其他成员占用',
    { type: 'warning', confirmButtonText: '强制保存', cancelButtonText: '返回修改' }
  ).then(() => doSave(true)).catch(() => { /* 用户取消 */ })
}

async function doSave(force) {
  saving.value = true
  try {
    const res = await api.patch(
      `/orgs/${props.orgId}/members/${props.member.userId}/scope`,
      { cities: cities.value, brands: brands.value },
      force ? { params: { force: 1 } } : undefined
    )
    ElMessage.success(res?.forced ? '已强制保存（已写入审计留痕）' : '管辖范围已保存')
    emit('saved')
    visible.value = false
  } catch (e) {
    if (e?.response?.status === 409) {
      ElMessage.error(errMsg(e, '存在城市占用冲突，请改选其他城市'))
    } else {
      ElMessage.error(errMsg(e, '保存管辖范围失败'))
    }
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.scope-editor {
  padding-bottom: 8px;
}

.scope-form {
  margin-top: 18px;
}

.lab {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.dim {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-weight: 400;
  font-size: 12px;
}

.opt-name {
  float: left;
}

.opt-right {
  float: right;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.opt-count {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.opt-missing {
  color: var(--el-color-warning);
  font-size: 12px;
}

.opt-taken {
  color: var(--el-color-danger);
  font-size: 12px;
}

.conflict-row {
  line-height: 26px;
}

.conflict-foot {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.estimate {
  margin-top: 4px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.estimate b {
  color: var(--el-color-primary);
  font-variant-numeric: tabular-nums;
}

.estimate-tip {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
