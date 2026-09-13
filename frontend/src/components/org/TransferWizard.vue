<template>
  <el-dialog
    v-model="visible"
    title="管辖范围变更向导 · 辖区划拨"
    width="660px"
    :close-on-click-modal="false"
    append-to-body
  >
    <div v-loading="loading" class="tw">
      <!-- 城市与双方 -->
      <div class="tw-head">
        <div class="tw-cities">
          <el-tag v-for="c in cities" :key="c" size="small" effect="plain" class="tw-city">{{ c }}</el-tag>
        </div>
        <div class="tw-arrow">
          <span class="tw-who">{{ fromName || '原持有方' }}</span>
          <span class="tw-arrow-icon">→</span>
          <span class="tw-who tw-to">{{ toName || '受让方' }}</span>
        </div>
      </div>

      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="划拨 = 把同一批门店的归属「改判」给新公司，不是复制一份"
        description="门店行 ID 不变，历史销售与预测数据连续（引用不断链）；原持有方自建的门店不会被搬走。"
      />

      <div class="tw-sec">① 影响面（只读预览）</div>
      <ul v-if="counts" class="tw-impact">
        <li>
          「{{ fromName }}」名下
          <b>{{ counts.markers }}</b> 家门店（{{ cities.join('、') }}）
          <span v-if="counts.competitors" class="tw-dim">/ 竞品门店 <b>{{ counts.competitors }}</b> 条</span>
        </li>
        <li>
          关联销售记录 <b>{{ counts.storeSales }}</b> 条（store_sales）
          <span class="tw-dim">随门店一同迁移 —— 漏迁会让销售预测「凭空消失」</span>
        </li>
        <li>集团侧镜像 <b>{{ counts.groupMirrors }}</b> 行（origin 指向 {{ fromName }}）</li>
        <li>
          联通购买履历 <b>{{ counts.purchases }}</b> 单
          <span class="tw-dim">→ 不迁移（购买单归属购买方账号）</span>
        </li>
      </ul>
      <div v-else-if="!loading" class="tw-empty">{{ error || '没有可划拨的数据。' }}</div>

      <div class="tw-sec">② 存量处理方式</div>
      <el-radio-group v-model="mode" class="tw-modes">
        <el-radio value="transfer">
          迁移 —— 门店直接改判给 {{ toName }}，行 ID 不变，历史销售与预测数据连续（已定案）
        </el-radio>
        <el-radio value="coexist" disabled>共存 —— 集团统计会重复计数（未实现）</el-radio>
        <el-radio value="purge" disabled>清理 —— 历史销售数据会丢失（未实现）</el-radio>
      </el-radio-group>

      <div class="tw-sec">③ 执行后</div>
      <div class="tw-note">
        划拨**不会自动撤销**：可在「数据同步 → ⑤ 同步历史」找到该批次回滚。
        若新公司已开始维护这批数据，回滚会覆盖其修改（届时会有二次提示）。
      </div>
      <div class="tw-note tw-note-sub">
        执行后双方管辖范围会自动互调（{{ fromName }} 移除该城 / {{ toName }} 并入该城），
        因此**无需再手动保存范围** —— 否则原持有方再同步会凭空重建一份重复副本。
      </div>

      <div v-if="error" class="tw-err">{{ error }}</div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :disabled="!canSubmit"
        :loading="submitting"
        @click="submit"
      >
        执行划拨
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/utils/api'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  orgId: { type: [Number, String], default: null },
  // 受让方：{ userId, username, company }
  toMember: { type: Object, default: null },
  // 原持有方 userId（通常来自 scope 冲突里的占用方）
  fromUserId: { type: [Number, String], default: null },
  // 本次要划拨的城市（原样写法）
  cities: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'done'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const loading = ref(false)
const submitting = ref(false)
const mode = ref('transfer')
const counts = ref(null)
const byKind = ref(null)
const batchId = ref(null)
const fromName = ref('')
const toName = ref('')
const error = ref('')

const cities = computed(() => (props.cities || []).filter(Boolean))
const canSubmit = computed(() => !!batchId.value && !loading.value && !error.value)

function errMsg(e, fallback) {
  return e?.response?.data?.message || fallback
}

async function load() {
  counts.value = null
  batchId.value = null
  error.value = ''
  if (!props.orgId || !props.toMember?.userId || !props.fromUserId) {
    error.value = '缺少必要参数（集团 / 受让方 / 原持有方）'
    return
  }
  if (!cities.value.length) {
    error.value = '请先选择要划拨的城市'
    return
  }
  loading.value = true
  try {
    const r = await api.post(`/orgs/${props.orgId}/transfer/preview`, {
      fromUserId: Number(props.fromUserId),
      toUserId: Number(props.toMember.userId),
      cities: cities.value,
      kinds: ['markers', 'competitors']
    })
    counts.value = r?.counts || null
    byKind.value = r?.byKind || null
    batchId.value = r?.batchId || null
    fromName.value = r?.fromName || ''
    toName.value = r?.toName || ''
  } catch (e) {
    error.value = errMsg(e, '读取划拨影响面失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => { if (open) load() }
)

function submit() {
  if (!canSubmit.value) return
  const n = counts.value?.markers || 0
  ElMessageBox.confirm(
    `将把 ${n} 家门店及相关销售记录的所有权从 ${fromName.value} 转给 ${toName.value}，`
    + `${toName.value} 无需再同步。此操作不可自动撤销（可在「同步历史」回滚）。`,
    '确认执行划拨',
    { type: 'warning', confirmButtonText: '执行划拨', cancelButtonText: '取消' }
  ).then(doSubmit).catch(() => { /* 用户取消 */ })
}

async function doSubmit() {
  submitting.value = true
  try {
    const r = await api.post(`/orgs/${props.orgId}/transfer/commit`, {
      batchId: batchId.value,
      mode: mode.value
    })
    ElMessage.success(r?.message || '划拨已完成')
    emit('done', r)
    visible.value = false
  } catch (e) {
    ElMessage.error(errMsg(e, '执行划拨失败（已整体回滚）'))
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.tw { padding-bottom: 4px; }

.tw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.tw-cities { display: flex; flex-wrap: wrap; gap: 6px; }
.tw-city { font-variant-numeric: tabular-nums; }

.tw-arrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.tw-arrow-icon { color: var(--el-color-primary); font-weight: 700; }
.tw-who { font-weight: 600; }
.tw-to { color: var(--el-color-primary); }

.tw-sec {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.tw-impact {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 24px;
}
.tw-impact b { color: var(--el-color-primary); font-variant-numeric: tabular-nums; }
.tw-dim { margin-left: 6px; color: var(--el-text-color-secondary); font-size: 12px; }

.tw-modes { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.tw-modes :deep(.el-radio) { height: auto; margin-right: 0; }

.tw-note {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 20px;
}
.tw-note-sub { margin-top: 4px; }

.tw-empty {
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.tw-err {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: 13px;
}
</style>
