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
        :title="alertTitle"
        :description="alertDesc"
      />

      <!--
        候选为空 = 集团账号还没导入门店 ⇒ 下拉空、且（成员自设时）任何城市都会被
        规则 34 判 400。这是「正式启用前的过渡态」，必须明说，否则用户只会看到
        「一个城市都选不了」而不知道为什么（v0.13 R1）。
      -->
      <el-alert
        v-if="!loading && !(options.cities || []).length"
        type="warning"
        :closable="false"
        show-icon
        style="margin-top:12px;"
        :title="emptyCandidateTitle"
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
              <!-- 划拨仅集团 owner 可发起；成员自设模式下不展示这个入口 -->
              <el-button
                v-if="!selfMode"
                size="small"
                text
                type="primary"
                @click="openTransfer(c)"
              >发起划拨</el-button>
            </div>
            <div class="conflict-foot">
              <template v-if="selfMode">
                一城一家、先到先得 —— 请改选其他城市。若该城市确应由你管辖，
                请联系集团总部发起「辖区划拨」。
              </template>
              <template v-else>
                请改选其他城市，或先走划拨流程把「{{ localConflicts[0].city }}」转给本子公司
                （划拨会自动完成存量迁移与双方范围互调）。
              </template>
            </div>
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

  <!-- 辖区划拨向导（P2）：把冲突城市从占用方改判给本成员 -->
  <TransferWizard
    v-model="transfer.open"
    :org-id="orgId"
    :to-member="member"
    :from-user-id="transfer.fromUserId"
    :cities="transfer.cities"
    @done="onTransferDone"
  />
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/utils/api'
import TransferWizard from './TransferWizard.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  orgId: { type: [Number, String], default: null },
  // { userId, username, company }
  member: { type: Object, default: null },
  /**
   * v0.13 R1：`true` = 子公司**自助**设置自己的范围。
   * 差异（三处，全部因写权限边界不同）：
   *   ① 不再展示「发起划拨」—— 划拨仅集团 owner 可发起（`requireOrgOwner`）
   *   ② 冲突时没有「强制保存」出口 —— 成员传 `?force=1` 后端直接 403 `force_not_allowed`
   *      （否则成员可用 force 抢注他人已占城市，与「先到先得」矛盾）
   *   ③ 文案由"代设"口吻改为"自设"口吻
   */
  selfMode: { type: Boolean, default: false }
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
  if (props.selfMode) return '我的管辖范围'
  const who = props.member?.username || '子公司'
  return `${who} · 管辖范围`
})

const alertTitle = computed(() => (props.selfMode
  ? '管辖范围 = 你能同步到的「上限」'
  : '管辖范围 = 该子公司可同步的「上限」'))

const emptyCandidateTitle = computed(() => (props.selfMode
  ? '集团尚未导入门店数据，暂无可选城市 —— 请联系集团总部先在集团账号导入全国门店清单，导入后下拉即可选择'
  : '集团账号当前没有任何门店数据，城市候选为空 —— 请先在集团账号导入门店清单'))

const alertDesc = computed(() => (props.selfMode
  ? '只能同步落在本范围内的门店，范围之外的行不会出现在候选里。'
    + '城市只能选「集团确有门店的城市」，且一城一家、先到先得。保存后立即生效。'
  : '子公司只能同步落在本范围内的门店；范围之外的行不会出现在候选里。'
    + '只到城市级，不细分区县。保存后立即生效（下次同步即按新范围计算候选）。'))

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

  // 成员自设：没有 force 权限（后端 403 force_not_allowed）—— 直接拦住，别让用户白跑一趟
  if (props.selfMode) {
    ElMessage.error(`城市「${c.city}」已被「${holder}」占用，请先改选其他城市（一城一家、先到先得）`)
    return
  }
  ElMessageBox.confirm(
    `城市「${c.city}」当前归属「${holder}」，正常保存会被拒绝（规则：城市互斥）。`
    + '如确需修正历史数据（同城两家），可强制保存并留痕。',
    '所选城市已被其他成员占用',
    { type: 'warning', confirmButtonText: '强制保存', cancelButtonText: '返回修改' }
  ).then(() => doSave(true)).catch(() => { /* 用户取消 */ })
}

/**
 * 辖区划拨向导（P2 · §3.5 Ⅱ / §7.7）
 * 入口 = 冲突行上的「发起划拨」：把该城市从占用方改判给本成员（受让方）。
 */
const transfer = ref({ open: false, fromUserId: null, cities: [] })

function openTransfer(conflict) {
  if (!conflict?.userId) return
  transfer.value = { open: true, fromUserId: conflict.userId, cities: [conflict.city] }
}

/**
 * 划拨完成回调。
 * ★ 后端在 commit 里已把该城市从原持有方 scope 移除、并入本成员 scope
 *   ⇒ 必须重新拉取（覆盖本地编辑态），否则界面仍显示「冲突」而用户会再点一次保存。
 *   同时把用户**尚未保存的其他选择**保留下来（排除刚被划拨的城市 —— 它在 reload 后
 *   会自然出现在本成员的范围里）。
 */
async function onTransferDone() {
  const pending = [...cities.value].filter(
    c => !localConflicts.value.some(x => x.cityKey === normCity(c))
  )
  await load()
  for (const c of pending) {
    if (!cities.value.some(x => normCity(x) === normCity(c))) cities.value.push(c)
  }
  ElMessage.success('划拨完成：该城市已转给本子公司，双方管辖范围已自动更新')
  emit('saved')
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
