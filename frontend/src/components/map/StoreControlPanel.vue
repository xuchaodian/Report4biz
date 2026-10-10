<template>
  <div class="store-control-group">
    <!-- 显示门店开关 -->
    <div class="store-toggle-panel">
      <div class="store-toggle-header" @click="$emit('update:toggle-expanded', !toggleExpanded)">
        <span class="toggle-title">显示门店</span>
        <span class="toggle-arrow" :class="{ expanded: toggleExpanded }">▼</span>
      </div>
      <div v-show="toggleExpanded" class="store-toggle-body">
        <div class="toggle-row">
          <span class="toggle-label">我的门店</span>
          <el-switch :model-value="showBusiness" @update:model-value="$emit('update:show-business', $event)" />
        </div>
        <div v-show="showBusiness" class="toggle-row toggle-sub-row">
          <span class="toggle-label-sub">门店状态</span>
          <el-select
            :model-value="storeStatusFilter"
            size="small"
            style="width: 108px;"
            @update:model-value="$emit('update:store-status-filter', $event)"
          >
            <el-option label="全部" value="all" />
            <el-option label="在营" value="open" />
            <el-option label="候选" value="candidate" />
            <el-option label="在营+候选" value="open_candidate" />
            <el-option label="停业" value="closed" />
          </el-select>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">竞品门店</span>
          <el-switch :model-value="showCompetitor" @update:model-value="$emit('update:show-competitor', $event)" />
        </div>
        <div class="toggle-row">
          <span class="toggle-label">品牌门店</span>
          <el-switch :model-value="showBrand" @update:model-value="onBrandToggle" />
        </div>
        <!-- v1.13.193：品牌门店按品牌勾选 -->
        <!-- v1.13.196：打开开关不再「默认显示全部品牌」——未选择过则自动弹出本浮层让用户勾选，
             已选择过则沿用上次勾选（不再打扰）。浮层改为受控可见，供开关主动打开。 -->
        <div v-show="showBrand" class="toggle-row toggle-sub-row">
          <span class="toggle-label-sub">显示品牌</span>
          <el-popover
            :visible="brandPopVisible"
            placement="right"
            :width="248"
            trigger="click"
            popper-class="brand-layer-popover"
            @update:visible="$emit('update:brand-pop-visible', $event)"
          >
            <template #reference>
              <span class="brand-filter-btn" :class="{ 'is-empty': brandSelection.length === 0 }">
                {{ brandFilterText }}
              </span>
            </template>

            <div class="brand-pop-head">
              <span class="brand-pop-title">显示品牌</span>
              <span class="brand-pop-actions">
                <el-button link size="small" @click="selectAllBrands">全选</el-button>
                <el-button link size="small" @click="clearAllBrands">清空</el-button>
              </span>
            </div>
            <div class="brand-pop-hint">已选 {{ brandSelection.length }} / {{ brandOptions.length }}</div>
            <el-checkbox-group
              :model-value="brandSelection"
              class="brand-pop-list"
              @update:model-value="onBrandSelectionChange"
            >
              <el-checkbox
                v-for="opt in brandOptions"
                :key="opt.brand"
                :label="opt.brand"
                :value="opt.brand"
                class="brand-pop-item"
              >
                <span class="brand-pop-row">
                  <img v-if="opt.icon" :src="opt.icon" class="brand-pop-logo" :alt="opt.brand" />
                  <span v-else class="brand-pop-logo brand-pop-logo--ph">{{ opt.brand.slice(0, 1) }}</span>
                  <span class="brand-pop-name">{{ opt.brand }}</span>
                  <span class="brand-pop-num">{{ opt.count }}</span>
                </span>
              </el-checkbox>
            </el-checkbox-group>
          </el-popover>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">购物中心</span>
          <el-switch :model-value="showCenter" @update:model-value="$emit('update:show-center', $event)" />
        </div>
      </div>
    </div>

    <!-- 门店工具面板 -->
    <div class="store-tools-panel">
      <div class="store-tools-header" @click="$emit('update:tools-expanded', !toolsExpanded)">
        <span class="store-tools-title">门店工具</span>
        <span class="store-tools-arrow" :class="{ expanded: toolsExpanded }">▼</span>
      </div>
      <div v-show="toolsExpanded" class="store-tools-body">
        <!-- 添加门店 -->
        <el-tooltip content="添加门店" placement="left">
          <div class="store-tools-item" :class="{ active: activeTool === 'marker' }" @click="$emit('set-tool', 'marker')">
            <el-icon><Location /></el-icon>
            <span>添加门店</span>
          </div>
        </el-tooltip>
        <!-- 定位门店 -->
        <el-tooltip content="定位门店" placement="left">
          <div class="store-tools-item" :class="{ active: storeSearchVisible }" @click="$emit('toggle-store-search')">
            <el-icon><Search /></el-icon>
            <span>定位门店</span>
          </div>
        </el-tooltip>
        <!-- 按行政界查询 -->
        <el-tooltip content="按行政界查询" placement="left">
          <div class="store-tools-item" :class="{ active: districtVisible }" @click="$emit('toggle-district')">
            <el-icon><Flag /></el-icon>
            <span>按行政界查询</span>
          </div>
        </el-tooltip>
        <!-- 按商圈查询 -->
        <el-tooltip content="按商圈查询" placement="left">
          <div class="store-tools-item" :class="{ active: commerceVisible }" @click="$emit('toggle-commerce')">
            <el-icon><Shop /></el-icon>
            <span>按商圈查询</span>
          </div>
        </el-tooltip>
        <!-- 网点优化 -->
        <el-tooltip content="对可见门店统一生成半径圆" placement="left">
          <div class="store-tools-item" :class="{ active: showStoreCircles }" @click="handleStoreCirclesClick">
            <el-icon><Aim /></el-icon>
            <span>网点优化</span>
            <span v-if="!isVipUser" class="vip-only-tag">🔒VIP</span>
          </div>
        </el-tooltip>
        <!-- 热力图 -->
        <div class="store-tools-item" :class="{ active: showHeatmap }" @click="$emit('toggle-heatmap')">
          <el-icon><DataLine /></el-icon>
          <span>热力图</span>
        </div>
        <!-- 聚合显示 -->
        <el-tooltip content="聚合显示" placement="left">
          <div class="store-tools-item" :class="{ active: showCluster }" @click="$emit('toggle-cluster')">
            <el-icon><Grid /></el-icon>
            <span>聚合显示</span>
          </div>
        </el-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
// VIP 门禁：网点优化仅 VIP 用户可用（管理员视为 VIP）
const isVipUser = computed(() => userStore.user?.role === 'vip' || userStore.user?.role === 'admin')
const handleStoreCirclesClick = () => {
  if (!isVipUser.value) {
    ElMessage.warning('网点优化为 VIP 用户专属功能，请联系管理员开通 VIP')
    return
  }
  emit('toggle-store-circles')
}
const emit = defineEmits([
  'update:toggle-expanded',
  'update:tools-expanded',
  'update:show-business',
  'update:show-competitor',
  'update:show-brand',
  'update:show-center',
  'update:store-status-filter',
  'update:brand-selection',
  'update:brand-pop-visible',
  'set-tool',
  'toggle-store-search',
  'toggle-district',
  'toggle-commerce',
  'toggle-store-circles',
  'toggle-heatmap',
  'toggle-cluster'
])

const props = defineProps({
  toggleExpanded: Boolean,
  toolsExpanded: Boolean,
  showBusiness: Boolean,
  showCompetitor: Boolean,
  showBrand: Boolean,
  showCenter: Boolean,
  storeStatusFilter: { type: String, default: 'all' },
  activeTool: { type: String, default: '' },
  storeSearchVisible: Boolean,
  districtVisible: Boolean,
  commerceVisible: Boolean,
  showStoreCircles: Boolean,
  showHeatmap: Boolean,
  showCluster: Boolean,
  // v1.13.193：品牌门店「显示品牌」复选——选项 [{ brand, count, icon }] 与当前勾选
  brandOptions: { type: Array, default: () => [] },
  brandSelection: { type: Array, default: () => [] },
  // v1.13.196：浮层受控可见（供点开关时主动弹出）+ 是否已选择过（决定「首次弹窗 / 沿用上次」）
  brandPopVisible: Boolean,
  brandInitialized: Boolean
})

// v1.13.193：按钮文案
const brandFilterText = computed(() => {
  const total = props.brandOptions.length
  const sel = props.brandSelection.length
  if (total === 0) return '无品牌'
  if (sel === 0) return '未选择品牌'
  if (sel >= total) return '全部品牌'
  return `已选 ${sel} 个`
})

const selectAllBrands = () => emit('update:brand-selection', props.brandOptions.map(o => o.brand))
const clearAllBrands = () => emit('update:brand-selection', [])
const onBrandSelectionChange = (val) => emit('update:brand-selection', Array.isArray(val) ? val : [])

// v1.13.196：点「品牌门店」开关。
// - 关 ⇒ 收起浮层；
// - 开且从未选择过 ⇒ 自动弹出「显示品牌」浮层，并把勾选置空（阻止「默认显示全部品牌」）；
// - 开且已选择过 ⇒ 直接沿用上次勾选，不再打扰。
const onBrandToggle = (val) => {
  emit('update:show-brand', val)
  if (!val) {
    emit('update:brand-pop-visible', false)
    return
  }
  if (!props.brandInitialized) {
    emit('update:brand-pop-visible', true)
    emit('update:brand-selection', [])
  }
}
</script>

<style scoped>
.store-control-group {
  /* 不作定位参考，让子元素直接相对于 .map-view 定位 */
}

/* 显示门店开关 - 左下角 */
.store-toggle-panel {
  position: absolute;
  z-index: 1001;
  bottom: 60px;
  left: 10px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  border: 2px solid #409eff;
  min-width: 100px;
}

.store-toggle-header {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
}

.toggle-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}

.toggle-arrow {
  margin-left: auto;
  font-size: 10px;
  color: #fff;
  transition: transform 0.2s;
  transform: rotate(-90deg);
}

.toggle-arrow.expanded {
  transform: rotate(0deg);
}

.store-toggle-body {
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.toggle-row.toggle-sub-row {
  padding-left: 14px;
  margin-top: 4px;
}
.toggle-label-sub {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
}

.toggle-label {
  font-size: 12px;
  color: #606266;
}

.toggle-row :deep(.el-switch) {
  --el-switch-off-color: #c0c4cc;
  font-size: 12px;
}

/* 门店工具面板 - 右上角 */
.store-tools-panel {
  position: absolute;
  z-index: 1001;
  top: 10px;
  right: 285px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  border: 2px solid #409eff;
  min-width: 96px;
}

.store-tools-header {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
}

.store-tools-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
}

.store-tools-arrow {
  margin-left: auto;
  font-size: 10px;
  color: #fff;
  transition: transform 0.2s;
  transform: rotate(-90deg);
}

.store-tools-arrow.expanded {
  transform: rotate(0deg);
}

.store-tools-body {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.store-tools-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: #606266;
  transition: all 0.15s;
}

.store-tools-item:hover {
  background: #ecf5ff;
  color: #409eff;
}

.store-tools-item.active {
  background: #ecf5ff;
  color: #409eff;
  font-weight: 600;
}

/* VIP 专属角标 */
.vip-only-tag {
  font-size: 9px;
  color: #fff;
  background: #7c3aed;
  border-radius: 8px;
  padding: 1px 5px;
  margin-left: 4px;
  white-space: nowrap;
  line-height: 14px;
}

/* v1.13.193：品牌门店「显示品牌」按钮 */
.brand-filter-btn {
  font-size: 12px;
  padding: 1px 8px;
  border: 1px solid #409eff;
  border-radius: 4px;
  color: #409eff;
  background: #fff;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.brand-filter-btn:hover {
  background: #ecf5ff;
}

.brand-filter-btn.is-empty {
  border-color: #e6a23c;
  color: #e6a23c;
}

.brand-filter-btn.is-empty:hover {
  background: #fdf6ec;
}

/* 弹层内部（元素在本组件模板内 ⇒ scoped 命中；EP 内部结构用 :deep 穿透） */
.brand-pop-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px 6px;
  border-bottom: 0.5px solid #ebeef5;
}

.brand-pop-title {
  font-size: 12px;
  font-weight: 600;
  color: #606266;
}

.brand-pop-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.brand-pop-hint {
  padding: 6px 4px 2px;
  font-size: 12px;
  color: #909399;
}

.brand-pop-list {
  display: block;
  max-height: 260px;
  overflow-y: auto;
}

.brand-pop-item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 28px;
  margin-right: 0;
}

.brand-pop-item :deep(.el-checkbox__label) {
  flex: 1;
  min-width: 0;
  padding-left: 8px;
  overflow: visible;
}

.brand-pop-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.brand-pop-logo {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  object-fit: contain;
  background: #f5f7fa;
  flex: 0 0 auto;
}

.brand-pop-logo--ph {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #909399;
}

.brand-pop-name {
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brand-pop-num {
  margin-left: auto;
  font-size: 12px;
  color: #c0c4cc;
}
</style>

<style>
/* el-popover 默认 teleport 到 body ⇒ 外层样式必须非 scoped；
   已用 brand-layer-popover 前缀限定作用域，不影响其它弹层。 */
.brand-layer-popover.el-popover.el-popper {
  padding: 8px 10px 6px;
}
</style>
