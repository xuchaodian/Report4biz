<template>
  <div class="brand-icon-view">
    <div class="data-header">
      <h2>品牌管理</h2>
      <div class="header-tip">
        <span>已设置 {{ setCount }} / {{ allBrands.length }} 个品牌</span>
      </div>
    </div>

    <!-- 说明 -->
    <div class="tip-box">
      <el-icon><InfoFilled /></el-icon>
      <span>上传品牌 Logo 后，地图上该品牌所有门店/竞品将自动显示对应图标。您上传的图标仅自己可见。支持 JPG、PNG、GIF、WebP、SVG 格式。可在下方调节您自己的默认图标大小或单个品牌的大小（所有设置仅对您当前账号生效，不影响其他用户）。</span>
    </div>

    <!-- 地图图标大小 -->
    <div class="icon-size-box">
      <div class="icon-size-label">
        <el-icon><Aim /></el-icon>
        <span>我的默认图标大小</span>
        <el-tag size="small" type="warning">{{ iconSize }}px</el-tag>
      </div>
      <el-slider
        v-model="iconSize"
        :min="20"
        :max="48"
        :step="2"
        show-stops
        style="flex:1;"
      />
      <span class="icon-size-tip">调整后刷新地图生效（拖动地图时松手会锁定，不误触图标）</span>
    </div>

    <!-- 品牌列表 -->
    <div class="brand-list">
      <div
        v-for="brand in allBrands"
        :key="brand"
        class="brand-item"
        :class="{ 'has-icon': hasIcon(brand) }"
      >
        <div class="brand-info">
          <!-- 品牌圆点 -->
          <span
            class="brand-dot"
            :style="{ backgroundColor: brandColorMap[brand] || '#409eff' }"
          ></span>
          <span class="brand-name">{{ brand }}</span>
        </div>

        <div class="brand-icon-area">
          <!-- 已设置图标：显示预览 -->
          <div v-if="hasIcon(brand)" class="icon-preview">
            <img
              :src="getIconUrl(brand)"
              :alt="brand"
              class="preview-img"
            />
            <span class="icon-label" :class="{ 'my-icon': isMyIcon(brand) }">
              {{ isMyIcon(brand) ? '我的' : '共享' }}
            </span>
          </div>
          <!-- 未设置：显示上传按钮 -->
          <div v-else class="no-icon">
            <span>未设置</span>
          </div>
        </div>

        <div class="brand-actions">
          <!-- 单品牌图标大小 -->
          <el-select
            v-model="iconSizeMap[brand]"
            size="small"
            style="width: 100px;"
            :placeholder="'使用我的默认 ' + (globalIconSize || 32) + 'px'"
          >
            <el-option label="使用我的默认" :value="0" />
            <el-option v-for="s in sizeOptions" :key="s" :label="s + 'px'" :value="s" />
          </el-select>
          <!-- 上传/更换图标（只能操作自己门店和竞品门店的品牌） -->
          <el-upload
            ref="uploadRefs"
            :show-file-list="false"
            :before-upload="(file) => beforeUpload(file, brand)"
            :http-request="(opt) => handleUpload(opt, brand)"
            accept="image/*"
          >
            <el-button size="small" :type="hasIcon(brand) ? 'default' : 'primary'">
              <el-icon><Upload /></el-icon>
              {{ hasIcon(brand) ? (isMyIcon(brand) ? '更换' : '覆盖') : '上传图标' }}
            </el-button>
          </el-upload>

          <!-- 删除图标（只能删除自己上传的） -->
          <el-button
            v-if="hasIcon(brand) && isMyIcon(brand)"
            size="small"
            type="danger"
            @click="handleDelete(brand)"
          >
            <el-icon><Delete /></el-icon>
            删除
          </el-button>
        </div>
      </div>

      <!-- 无品牌时 -->
      <el-empty v-if="allBrands.length === 0" description="暂无品牌数据，请先在门店管理或竞品管理中添加品牌信息" />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, Delete, InfoFilled, Aim } from '@element-plus/icons-vue'
import { useBrandIconStore } from '@/stores/brandIcon'
import { useMarkerStore } from '@/stores/marker'
import { useCompetitorStore } from '@/stores/competitor'
import { useBrandStoreStore } from '@/stores/brandStore'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
// 图标大小按用户隔离（key 带 userId，各账号设置互不影响）
const iconUid = () => localStorage.getItem('userId') || 'guest'
const iconSizeKey = () => `mapIconSize_${iconUid()}`
const brandIconSizeKey = (brand) => `mapIconSize_${brand}_${iconUid()}`

// 地图图标大小（我的默认大小，按账号隔离，localStorage 持久化，默认 32px）
const iconSize = ref(Number(localStorage.getItem(iconSizeKey())) || 32)
watch(iconSize, (v) => {
  localStorage.setItem(iconSizeKey(), String(v))
})
const globalIconSize = computed(() => iconSize.value)
// 可选的图标大小档位
const sizeOptions = [20, 24, 28, 32, 36, 40, 44, 48]
// 单品牌图标大小映射（0 = 跟随我的默认大小；localStorage: mapIconSize_<brand>_<uid> 持久化）
const iconSizeMap = reactive({})
const ensureIconSizeMap = (brands) => {
  brands.forEach(b => {
    if (iconSizeMap[b] === undefined) {
      iconSizeMap[b] = Number(localStorage.getItem(brandIconSizeKey(b))) || 0
    }
  })
}
watch(iconSizeMap, (v) => {
  Object.keys(v).forEach(b => {
    if (v[b] && v[b] > 0) localStorage.setItem(brandIconSizeKey(b), String(v[b]))
  })
}, { deep: true })
const brandIconStore = useBrandIconStore()
const markerStore = useMarkerStore()
const competitorStore = useCompetitorStore()
const brandStoreStore = useBrandStoreStore()

// 品牌颜色（用于未设置图标时的圆点颜色）
const brandColorMap = {
  '大米先生': '#e6a23c',
  '谷田稻香': '#f56c6c',
  '吉野家': '#409eff',
  '老乡鸡': '#67c23a',
  '米村拌饭': '#9c27b0'
}

// 合并所有品牌（显示我的门店、竞品门店和品牌门店的品牌）
const allBrands = computed(() => {
  const markerBrands = (markerStore.markers || []).map(m => m.brand).filter(Boolean)
  const competitorBrands = (competitorStore.competitors || []).map(c => c.brand).filter(Boolean)
  const brandStoreBrands = (brandStoreStore.brandStores || []).map(b => b.brand).filter(Boolean)
  
  // 合并所有品牌
  return [...new Set([...markerBrands, ...competitorBrands, ...brandStoreBrands])].sort()
})

// 已设置图标的品牌数量
const setCount = computed(() => {
  return allBrands.value.filter(b => hasIcon(b)).length
})

// 判断品牌是否有图标
const hasIcon = (brand) => {
  return !!brandIconStore.icons.find(i => i.brand === brand)
}

// 判断图标是否是当前用户上传的
const isMyIcon = (brand) => {
  const icon = brandIconStore.icons.find(i => i.brand === brand)
  return icon ? icon.user_id === userStore.user?.id : false
}

// 获取图标 URL
const getIconUrl = (brand) => {
  const icon = brandIconStore.icons.find(i => i.brand === brand)
  return icon ? `/uploads/brand-icons/${icon.filename}` : ''
}

// 上传前校验
const beforeUpload = (file, brand) => {
  const isImage = file.type.startsWith('image/')
  const isLt2M = file.size / 1024 / 1024 < 2

  if (!isImage) {
    ElMessage.error('只能上传图片文件！')
    return false
  }
  if (!isLt2M) {
    ElMessage.error('图片大小不能超过 2MB！')
    return false
  }
  return true
}

// 上传图标
const handleUpload = async (opt, brand) => {
  try {
    const result = await brandIconStore.uploadBrandIcon(brand, opt.file)
    if (result.success) {
      ElMessage.success(`${brand} 图标${hasIcon(brand) ? '更新' : '上传'}成功`)
    } else {
      ElMessage.error(result.message || '上传失败')
    }
  } catch (error) {
    ElMessage.error('上传失败，请重试')
  }
}

// 删除图标
const handleDelete = async (brand) => {
  const icon = brandIconStore.icons.find(i => i.brand === brand)
  if (!icon) return

  try {
    await ElMessageBox.confirm(`确定要删除「${brand}」的图标吗？`, '提示', {
      type: 'warning'
    })
    const result = await brandIconStore.deleteBrandIcon(icon.id)
    if (result.success) {
      ElMessage.success('删除成功')
    } else {
      ElMessage.error(result.message || '删除失败')
    }
  } catch {
    // 用户取消
  }
}

onMounted(async () => {
  await Promise.all([
    brandIconStore.fetchBrandIcons(),
    markerStore.fetchMarkers(),
    competitorStore.fetchCompetitors(),
    brandStoreStore.fetchBrandStores()
  ])
  // 初始化单品牌图标大小映射
  ensureIconSizeMap(allBrands.value)
})
</script>

<style lang="scss" scoped>
.brand-icon-view {
  height: 100%;
  padding: 20px;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.data-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;

  h2 {
    margin: 0;
    font-size: 18px;
    color: #333;
  }

  .header-tip {
    color: #666;
    font-size: 14px;
  }
}

.tip-box {
  background: #ecf5ff;
  border: 1px solid #d9ecff;
  border-radius: 6px;
  padding: 10px 15px;
  margin-bottom: 15px;
  display: flex;
  align-items: center;
  gap: 8px;  font-size: 13px;
  color: #409eff;

  .el-icon {
    flex-shrink: 0;
  }
}

.brand-list {
  flex: 1;
  overflow-y: auto;
}

.brand-item {
  background: white;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 20px;
  transition: box-shadow 0.2s;

  &:hover {
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  }

  &.has-icon {
    background: linear-gradient(135deg, #f0f9ff 0%, #ffffff 100%);
    border: 1px solid #e0f2fe;
  }
}

.brand-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 140px;
  flex-shrink: 0;

  .brand-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .brand-name {
    font-weight: 500;
    font-size: 15px;
    color: #333;
  }
}

.brand-icon-area {
  flex-shrink: 0;
  width: 70px;
  height: 70px;
  border-radius: 8px;
  border: 1px dashed #dcdfe6;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  .icon-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;

    .preview-img {
      width: 48px;
      height: 48px;
      object-fit: contain;
      border-radius: 4px;
    }

    .icon-label {
      font-size: 11px;
      color: #909399;
      
      &.my-icon {
        color: #67c23a;
      }
    }
  }

  .no-icon {
    span {
      font-size: 12px;
      color: #c0c4cc;
    }
  }
}

.brand-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.icon-size-box {
  background: #fffbe6;
  border: 1px solid #ffe58f;
  border-radius: 6px;
  padding: 12px 15px;
  margin-bottom: 15px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.icon-size-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}
.icon-size-tip {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
}
</style>

.icon-size-box {
  background: #fffbe6;
  border: 1px solid #ffe58f;
  border-radius: 6px;
  padding: 12px 15px;
  margin-bottom: 15px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.icon-size-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}
.icon-size-tip {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
}
