<template>
  <!--
    v1.13.349：品牌竞品映射「强制补齐」弹窗
    🔴 硬阻断：⛔ 不能有 X、⛔ 不能点遮罩关、⛔ 不能 ESC 关、⛔ 不能有「取消/稍后」按钮。
    唯一出口是「全部保存」；唯一的例外是配置接口不可用（degraded）时允许关闭，
    否则用户会被永久锁在这个弹窗里 —— 比口径放宽更糟。
  -->
  <el-dialog
    v-model="visible"
    title="请先完成品牌竞品映射"
    width="640px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    append-to-body
  >
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
      title="「我的门店」有多个品牌时，必须为每个品牌指定它的竞品品牌"
      description="不配置＝按账号全量竞品统计，会把别的品牌的竞品也算进来，导致竞争分偏低、门店信号灯被误点亮。"
    />

    <div v-if="degraded" class="map-req__degraded">
      <el-alert
        type="error"
        :closable="false"
        show-icon
        title="映射配置读取失败，暂时无法完成设置"
        description="为避免把你已有的配置覆盖成空，本次先不强制。请稍后刷新页面重试。"
      />
    </div>

    <div v-else class="map-req__list">
      <div v-for="(row, idx) in rows" :key="row.myBrand" class="map-req__row">
        <div class="map-req__head">
          <span class="map-req__brand">{{ row.myBrand }}</span>
          <el-tag size="small" type="info" effect="plain">自有品牌 {{ idx + 1 }}/{{ rows.length }}</el-tag>
          <el-tag v-if="row.seeded" size="small" type="success" effect="plain">已预选本次导入的竞品品牌</el-tag>
        </div>
        <el-form label-width="86px" label-position="left" class="map-req__form">
          <el-form-item label="竞品品牌">
            <el-select
              v-model="row.compBrands"
              multiple
              filterable
              allow-create
              default-first-option
              clearable
              :disabled="row.none"
              placeholder="可多选，也可输入新品牌"
              style="width: 100%"
            >
              <el-option v-for="b in competitorBrands" :key="b" :label="b" :value="b" />
            </el-select>
          </el-form-item>
          <el-form-item label=" ">
            <el-checkbox v-model="row.none" @change="onToggleNone(row)">
              该品牌暂无竞品（保存为空集，计入「未评」而不会判为健康）
            </el-checkbox>
          </el-form-item>
        </el-form>
      </div>
    </div>

    <template #footer>
      <div class="map-req__footer">
        <span v-if="!degraded" class="map-req__progress">
          已完成 {{ summary.decided }} / {{ summary.total }}
          <template v-if="summary.pending > 0">（还需 {{ summary.pending }} 个品牌）</template>
        </span>
        <span v-else class="map-req__progress">配置接口不可用</span>
        <div>
          <el-button v-if="degraded" @click="visible = false">关闭</el-button>
          <el-button
            v-else
            type="primary"
            :loading="saving"
            :disabled="!summary.complete"
            @click="handleSaveAll"
          >
            全部保存
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/utils/api.js'
import { buildRequiredMapDraft, summarizeDraft, buildSavePayload } from '@/utils/brandMapPrompt.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  myBrands: { type: Array, default: () => [] },
  competitorBrands: { type: Array, default: () => [] },
  /** 已有配置：{ 自有品牌: [竞品品牌...] }，配成 [] 也算已配置 */
  scopes: { type: Object, default: () => ({}) },
  /**
   * v1.13.351：集团侧的映射。集团配过的品牌算「已配置」⇒ 不会出现在本弹窗里。
   * 透传它是为了判据**双保险**：某天后端不再合并继承时，子公司也不会被重复阻断。
   */
  inheritedScopes: { type: Object, default: () => ({}) },
  /** 本次导入的**竞品品牌**（competitors.brand），只用于预勾选 */
  justImportedBrand: { type: String, default: '' },
  /** 配置接口读取失败 ⇒ 允许关闭，⛔ 不得把用户锁死 */
  degraded: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})

const rows = ref([])
const saving = ref(false)

// 每次打开都重建草稿：映射可能在别处被改过，⛔ 不要复用上一次的残值
watch(
  () => props.modelValue,
  open => {
    if (open) rebuild()
  }
)
function rebuild() {
  rows.value = buildRequiredMapDraft({
    myBrands: props.myBrands,
    scopes: props.scopes,
    inheritedScopes: props.inheritedScopes,
    justImportedBrand: props.justImportedBrand
  })
}

const summary = computed(() => summarizeDraft(rows.value))

// 勾「暂无竞品」⇒ 清空已选，避免「勾了空集又留着品牌」这种自相矛盾的存量
function onToggleNone(row) {
  if (row.none) row.compBrands = []
}

async function handleSaveAll() {
  if (!summary.value.complete) return
  saving.value = true
  const failed = []
  try {
    // 逐个提交：单品牌 PUT 是「整体覆盖」语义，⛔ 不能用批量接口（后端也只有单个）
    for (const row of rows.value) {
      try {
        await api.put('/brand-competitor-map', buildSavePayload(row))
      } catch (e) {
        failed.push({ myBrand: row.myBrand, message: e?.response?.data?.message || e.message || '保存失败' })
      }
    }
    if (failed.length) {
      const names = failed.map(f => f.myBrand).join('、')
      ElMessage.error(`以下品牌保存失败，请重试：${names}`)
      rebuild()
      return
    }
    ElMessage.success('映射已保存，竞品统计按新集合收窄')
    emit('saved')
    visible.value = false
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.map-req__list { max-height: 430px; overflow-y: auto; }
.map-req__row { border: 1px solid #ebeef5; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
.map-req__head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.map-req__brand { font-weight: 600; font-size: 14px; }
.map-req__form :deep(.el-form-item) { margin-bottom: 6px; }
.map-req__footer { display: flex; align-items: center; justify-content: space-between; }
.map-req__progress { font-size: 12px; color: #909399; }
.map-req__degraded { padding: 4px 0; }
</style>
