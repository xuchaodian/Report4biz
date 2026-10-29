<template>
  <el-dialog
    :model-value="modelValue"
    title="导入字段说明"
    width="820px"
    :close-on-click-modal="false"
    @update:model-value="v => emit('update:modelValue', v)"
  >
    <p class="ig-lead">
      体检和销售预测的结论上限，取决于下面这两张表填到什么程度。
      字段清单与模板直接来自系统实际解析的列，<b>不是另写一份说明</b>——按模板填，导入不会因为列名不对而失败。
    </p>

    <div ref="contentRef">
    <el-tabs v-model="activeTab">
      <!-- ============ 门店台账 ============ -->
      <el-tab-pane name="store">
        <template #label>
          <span class="ig-tab">门店台账（CSV）</span>
        </template>
        <p class="ig-why">
          决定<b>几何体检</b>能算多细：<b>名称 + 经纬度</b>必填，缺了这家店连间距都算不了；
          <b>面积</b>与<b>品类</b>决定能不能分大店/小店、能不能按业态横向比较。
        </p>
        <el-table :data="storeFields" size="small" max-height="330" :row-class-name="storeRowClass">
          <el-table-column label="列名" width="190">
            <template #default="{ row }">
              <code class="ig-code">{{ row.key }}</code>
              <div class="ig-label">{{ row.label }}</div>
            </template>
          </el-table-column>
          <el-table-column label="必填" width="72" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.required" size="small" type="danger">必填</el-tag>
              <span v-else class="ig-opt">选填</span>
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="320">
            <template #default="{ row }"><span class="ig-note">{{ row.note }}</span></template>
          </el-table-column>
        </el-table>
        <div class="ig-foot">
          <el-button size="small" @click="onDownloadStore">
            <AppIcon class="icon-text"><Download /></AppIcon>下载模板（CSV）
          </el-button>
          <el-button size="small" type="primary" plain @click="emit('go', 'store')">
            <AppIcon class="icon-text"><Upload /></AppIcon>去门店管理导入
          </el-button>
          <span class="ig-hint">中文乱码时用 Excel「另存为 CSV UTF-8」，或直接用下载的模板改。</span>
        </div>
      </el-tab-pane>

      <!-- ============ 销售记录 ============ -->
      <el-tab-pane name="sales">
        <template #label>
          <span class="ig-tab">销售记录（Excel）</span>
        </template>
        <p class="ig-why">
          决定<b>能不能判断赚不赚钱</b>。{{ unlockHints.sales }}。
          按<b>门店编号</b>匹配到门店（编号找不到再用名称），同店同年重复导入会覆盖。
        </p>
        <el-table :data="salesFields" size="small" max-height="300" :row-class-name="salesRowClass">
          <el-table-column label="表头" width="190">
            <template #default="{ row }">
              <code class="ig-code">{{ row.key }}</code>
              <div v-if="row.label !== row.key" class="ig-label">{{ row.label }}</div>
            </template>
          </el-table-column>
          <el-table-column label="必填" width="72" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.required" size="small" type="danger">必填</el-tag>
              <span v-else class="ig-opt">选填</span>
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="320">
            <template #default="{ row }"><span class="ig-note">{{ row.note }}</span></template>
          </el-table-column>
        </el-table>

        <div class="ig-band">
          <div class="ig-band-h">
            「年销售额」和「销售档位」<b>二选一</b>——不想把具体营业额填进系统时，只填档位，系统按区间中点参与测算，误差略大但能参与建模。
          </div>
          <div class="ig-band-list">
            <el-tag v-for="b in bandOptions" :key="b.value" size="small" type="info">{{ b.label }}</el-tag>
          </div>
        </div>

        <div class="ig-foot">
          <el-button size="small" @click="onDownloadSales">
            <AppIcon class="icon-text"><Download /></AppIcon>下载模板（Excel）
          </el-button>
          <el-button size="small" type="primary" plain @click="emit('go', 'sales')">
            <AppIcon class="icon-text"><EditPen /></AppIcon>去门店管理录入
          </el-button>
          <span class="ig-hint">销售数据仅本人可见；平台只统计条数、看不到金额。</span>
        </div>
      </el-tab-pane>
    </el-tabs>
    </div>
  </el-dialog>
</template>

<script setup>
/**
 * 导入字段说明弹窗（v1.13.292）
 *
 * 体检页「数据完备度」与销售预测页「样本量提示」共用同一个说明面板，
 * 字段清单来自 `utils/importSpecs.js`（与后端真正解析的列同源，有守卫测试钉住）。
 *
 * ⛔ 不要在调用方再写一份字段清单 —— 三套说法一定会漂移。
 *
 * 事件：
 *   go('store')   → 门店导入入口（/data）
 *   go('sales')   → 销售录入入口（/data?sale=1）
 *   go('geocode') → 地址解析入口（/data?geocode=1），由调用方决定是否用
 */
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Upload, EditPen } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import {
  STORE_IMPORT_FIELDS,
  SALES_IMPORT_FIELDS,
  UNLOCK_HINTS
} from '@/utils/importSpecs.js'
import { SALES_BAND_OPTIONS } from '@/utils/salesBand.js'
import { downloadStoreTemplate, downloadSalesTemplate } from '@/utils/importTemplates.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  tab: { type: String, default: 'store' },        // store | sales
  highlight: { type: String, default: '' }        // 要高亮的字段 key（如 store_area）
})
const emit = defineEmits(['update:modelValue', 'go'])

const activeTab = ref(props.tab)
const storeFields = STORE_IMPORT_FIELDS
const salesFields = SALES_IMPORT_FIELDS
const bandOptions = SALES_BAND_OPTIONS
const unlockHints = UNLOCK_HINTS

const contentRef = ref(null)

// 每次打开都回到调用方指定的页签：否则上次看销售、这次想开门店，会停在旧页签
// 同时把高亮行滚进视野：表格高 330px 只露 5 行，直接定位到 store_area 这类靠后的字段时，
// 停在顶部会让人以为「没定位到」（293 真机截图发现）
watch(() => props.modelValue, async (open) => {
  if (!open) return
  activeTab.value = props.tab
  await nextTick()
  scrollToFocus()
})

/**
 * 把高亮行滚进视野。
 *
 * 🔴 两个真机踩出来的坑（293，别再用更「简洁」的写法）：
 *   ① `nextTick` 时 el-table 的行**还没渲染完** ⇒ 查不到行、静默不滚；
 *   ② `row.scrollIntoView()` 虽然被调到了，却会被 el-table 首帧布局**重置回 scrollTop=0**
 *      （实测打桩：调用 1 次、行仍在视窗外）。
 * ⇒ 所以：自己算偏移直接设 `scrollTop`，并**多轮校验**直到真的进入视野为止。
 *
 * ⚠️ 两个页签的表格都在 DOM 里（未激活的只是隐藏）⇒ 只认可见的那行，否则会滚错页签。
 * ⚠️ 真正的滚动容器是 `.el-scrollbar__wrap`，不是 `.el-table__body-wrapper`（后者 scrollTop 恒 0）。
 */
function scrollToFocus(attempt = 0) {
  const row = contentRef.value?.querySelector('tr.is-focus')
  if (row && row.offsetParent !== null) {
    const scroller = row.closest('.el-scrollbar__wrap') || row.closest('.el-table__body-wrapper')
    if (scroller) {
      const r = row.getBoundingClientRect()
      const c = scroller.getBoundingClientRect()
      const visible = r.top >= c.top - 1 && r.bottom <= c.bottom + 1
      if (!visible) scroller.scrollTop += (r.top - c.top) - (c.height - r.height) / 2
      // 布局可能随后重置 ⇒ 再校验几轮（已进入视野时这里只是空转，不再改动）
      if (attempt < 6) setTimeout(() => scrollToFocus(attempt + 1), 120)
      return
    }
  }
  if (attempt < 8) setTimeout(() => scrollToFocus(attempt + 1), 80)
}

const focusKey = computed(() => String(props.highlight || '').trim())
const storeRowClass = ({ row }) => (row.key === focusKey.value ? 'is-focus' : '')
const salesRowClass = ({ row }) => (row.key === focusKey.value ? 'is-focus' : '')

async function onDownloadStore() {
  try {
    downloadStoreTemplate()
  } catch (e) {
    ElMessage.error('模板下载失败')
  }
}

async function onDownloadSales() {
  const ok = await downloadSalesTemplate()
  if (!ok) ElMessage.error('模板下载失败，请稍后重试或到「门店管理 → 录入销售」里下载')
}
</script>

<style scoped>
.ig-lead { margin: 0 0 10px; font-size: 13px; color: #4b5563; line-height: 1.7; }
.ig-why { margin: 6px 0 10px; font-size: 13px; color: #4b5563; line-height: 1.7; }
.ig-tab { font-size: 13px; }

.ig-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; color: #1f2937; background: #f3f4f6;
  padding: 1px 5px; border-radius: 4px;
}
.ig-label { font-size: 12px; color: #6b7280; margin-top: 3px; }
.ig-opt { font-size: 12px; color: #9ca3af; }
.ig-note { font-size: 12px; color: #4b5563; line-height: 1.6; }

.ig-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.ig-hint { font-size: 12px; color: #909399; }

.ig-band { margin-top: 12px; padding: 10px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; }
.ig-band-h { font-size: 12px; color: #92400e; line-height: 1.7; }
.ig-band-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }

/* 调用方指定要高亮的那一行（体检页的「缺面积」「缺品类」会直接定位过来） */
:deep(.is-focus) td { background: #eff6ff !important; }
</style>
