<template>
  <div class="file-list" v-if="files.length > 0">
    <div v-for="tier in TIERS" :key="tier.name">
      <div v-if="grouped[tier.name].length > 0" class="tier-section">
        <h3>
          <el-tag :type="tier.tagType" round>{{ tier.name }}</el-tag>
          <span class="tier-count">{{ grouped[tier.name].length }}个文件</span>
        </h3>
        <div class="table-wrap">
          <el-table :data="grouped[tier.name]" style="width: 100%" row-key="id">
            <el-table-column prop="name" label="文件名" min-width="200">
              <template #default="{ row }">
                <div v-if="renamingId === row.id" class="rename-inline">
                  <el-input
                    :ref="setRenameInput"
                    v-model="renameValue"
                    size="small"
                    style="width: 100%"
                    @keyup.enter="confirmRename(row)"
                    @keyup.esc="cancelRename"
                  />
                  <el-button type="primary" size="small" link @click="confirmRename(row)" title="确认重命名" aria-label="确认重命名"><el-icon><Check /></el-icon></el-button>
                  <el-button type="info" size="small" link @click="cancelRename" title="取消重命名" aria-label="取消重命名"><el-icon><Close /></el-icon></el-button>
                </div>
                <div v-else class="filename-cell" @dblclick="startRename(row)">
                  <span class="filename-text">{{ row.name }}</span>
                  <el-button type="primary" size="small" link class="rename-btn" @click="startRename(row)" title="重命名文件" aria-label="重命名文件"><el-icon><EditPen /></el-icon></el-button>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="feature_count" label="要素数量" width="100" align="center" />
            <el-table-column prop="created_at" label="上传时间" width="160" />
            <el-table-column label="操作" :width="showQuery ? 180 : 110" align="center">
              <template #default="{ row }">
                <el-button v-if="showQuery" type="primary" size="small" @click="emit('query', row)"><el-icon><Search /></el-icon>检索</el-button>
                <el-button
                  v-if="row.user_id == userStore.user?.id"
                  type="danger"
                  size="small"
                  @click="handleDelete(row)"
                  title="删除文件"
                  aria-label="删除该图层文件"
                ><el-icon><Delete /></el-icon></el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </div>
  </div>
  <el-empty v-else :description="emptyText" />
</template>

<script setup>
/**
 * shapefile 文件列表（按城市分级分组）—— v1.13.194 抽出。
 *
 * 抽出的原因：ShapefileView 里「常住人口」「城市商圈」两个 tab 的表格是**逐字重复**的
 * （各 3 段 × 约 22 行，合计约 130 行）；新增「高精度人口」会成为第三份。
 * 三份结构/列完全一致，任何一处改动（列宽、操作按钮、aria）都要改三遍 ⇒ 收敛为单一组件。
 *
 * ⚠️ showQuery=false 用于「高精度人口」：250m 网格单城 10.8 万要素 / 95MB，
 *    检索接口会先把整个 geojson 解析一遍再全量回传浏览器（`GET /:id` + `/query` 各自全量），
 *    在服务器上是两次 95MB JSON.parse，在前端是近百 MB 载荷 ⇒ 该 tab 刻意不提供检索。
 */
import { ref, computed, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Search, EditPen, Check, Close } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const props = defineProps({
  files: { type: Array, default: () => [] },
  headers: { type: Object, default: () => ({}) },
  showQuery: { type: Boolean, default: true },
  emptyText: { type: String, default: '暂无上传的文件' }
})

const emit = defineEmits(['query', 'changed'])

const userStore = useUserStore()
const baseURL = import.meta.env.VITE_API_BASE_URL || ''

// 城市分级定义（与分级顺序一致，模板按此顺序渲染）
const TIERS = [
  { name: '一线城市', tagType: 'danger' },
  { name: '新一线城市', tagType: 'warning' },
  { name: '二三线城市', tagType: 'info' }
]

const CITY_TIERS = {
  '一线城市': ['北京', '上海', '广州', '深圳'],
  '新一线城市': ['成都', '杭州', '重庆', '武汉', '苏州', '西安', '南京', '长沙', '郑州', '天津', '合肥', '青岛', '东莞', '宁波', '佛山']
}

function getCityTier(name) {
  if (!name) return '二三线城市'
  for (const [tier, cities] of Object.entries(CITY_TIERS)) {
    if (cities.some(city => name.includes(city))) return tier
  }
  return '二三线城市'
}

const grouped = computed(() => {
  const groups = { '一线城市': [], '新一线城市': [], '二三线城市': [] }
  for (const f of props.files) groups[getCityTier(f.name)].push(f)
  return groups
})

// 重命名
const renamingId = ref(null)
const renameValue = ref('')
const renameInputRef = ref(null)

// ⚠️ 函数式 ref：模板里的 el-input 处在 v-for + 表格插槽上下文中，
//    写 `ref="renameInputRef"` 会被收集成数组，`.focus()` 随之失效。
//    函数式写法只保留当前真正渲染的那一个（同一时刻只可能有一行在重命名）。
const setRenameInput = (el) => { if (el) renameInputRef.value = el }

const startRename = async (row) => {
  renamingId.value = row.id
  renameValue.value = row.name
  await nextTick()
  renameInputRef.value?.focus?.()
}

const cancelRename = () => {
  renamingId.value = null
}

const confirmRename = async (row) => {
  const newName = renameValue.value.trim()
  if (!newName) {
    ElMessage.warning('文件名不能为空')
    return
  }
  if (newName === row.name) {
    renamingId.value = null
    return
  }
  try {
    const response = await fetch(`${baseURL}/api/shapefiles/${row.id}/rename`, {
      method: 'PUT',
      headers: { ...props.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    })
    const result = await response.json()
    if (result.success) {
      row.name = newName
      ElMessage.success('重命名成功')
    } else {
      ElMessage.error(result.message || '重命名失败')
    }
  } catch (error) {
    ElMessage.error('重命名失败')
  } finally {
    renamingId.value = null
  }
}

const handleDelete = async (row) => {
  // 确认框与接口调用写在同一处（v1.13.185 铁律：不能指望调用方补确认）
  try {
    await ElMessageBox.confirm(`确定要删除 "${row.name}" 吗？`, '提示', { type: 'warning' })
  } catch (e) {
    return // 用户取消
  }
  try {
    const response = await fetch(`${baseURL}/api/shapefiles/${row.id}`, {
      method: 'DELETE',
      headers: props.headers
    })
    const result = await response.json()
    if (result.success) {
      ElMessage.success('删除成功')
      emit('changed')
    } else {
      ElMessage.error(result.message || '删除失败')
    }
  } catch (error) {
    ElMessage.error('删除失败')
  }
}
</script>

<style scoped>
.file-list {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

/* 城市分组样式 */
.tier-section {
  margin-bottom: 32px;
}

.tier-section h3 {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  color: #303133;
}

.tier-count {
  font-weight: normal;
  font-size: 13px;
  color: #999;
}

.table-wrap {
  margin-top: 0;
}

.filename-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: default;

  .filename-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename-btn {
    opacity: 0;
    transition: opacity 0.2s;
    padding: 0 4px;
    flex-shrink: 0;
  }

  &:hover .rename-btn {
    opacity: 1;
  }
}

.rename-inline {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
