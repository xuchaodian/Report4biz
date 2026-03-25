<template>
  <div class="data-view">
    <div class="data-header">
      <h2>数据管理</h2>
      <div class="header-actions">
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>添加点位
        </el-button>
        <el-button @click="handleImport">
          <el-icon><Upload /></el-icon>导入
        </el-button>
        <el-button @click="handleExport">
          <el-icon><Download /></el-icon>导出
        </el-button>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索名称/描述"
        style="width: 200px"
        clearable
        @input="handleSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>

      <el-select v-model="filterCategory" placeholder="按类别筛选" style="width: 150px" clearable @change="handleSearch">
        <el-option v-for="cat in markerStore.categories" :key="cat" :label="cat" :value="cat" />
      </el-select>

      <el-select v-model="filterStatus" placeholder="按状态筛选" style="width: 150px" clearable @change="handleSearch">
        <el-option v-for="st in markerStore.statuses" :key="st" :label="st" :value="st" />
      </el-select>

      <span class="统计">共 {{ filteredMarkers.length }} 条数据</span>
    </div>

    <!-- 数据表格 -->
    <div class="data-table">
      <el-table
        :data="paginatedMarkers"
        v-loading="markerStore.loading"
        border
        stripe
        style="width: 100%"
      >
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column prop="category" label="类别" width="100" align="center">
          <template #default="{ row }">
            <el-tag>{{ row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="坐标" width="200">
          <template #default="{ row }">
            {{ row.latitude.toFixed(6) }}, {{ row.longitude.toFixed(6) }}
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="150" show-overflow-tooltip />
        <el-table-column prop="created_at" label="创建时间" width="160">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleEdit(row)">
              <el-icon><Edit /></el-icon>
            </el-button>
            <el-button type="danger" link @click="handleDelete(row)">
              <el-icon><Delete /></el-icon>
            </el-button>
            <el-button type="success" link @click="handleLocate(row)">
              <el-icon><Location /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 分页 -->
    <div class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="filteredMarkers.length"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
      />
    </div>

    <!-- 添加/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑点位' : '添加点位'"
      width="500px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入点位名称" />
        </el-form-item>
        <el-form-item label="类别" prop="category">
          <el-select v-model="form.category" placeholder="请选择类别" style="width: 100%">
            <el-option v-for="cat in markerStore.categories" :key="cat" :label="cat" :value="cat" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-select v-model="form.status" placeholder="请选择状态" style="width: 100%">
            <el-option v-for="st in markerStore.statuses" :key="st" :label="st" :value="st" />
          </el-select>
        </el-form-item>
        <el-form-item label="经度" prop="longitude">
          <el-input-number v-model="form.longitude" :precision="6" :step="0.001" :min="-180" :max="180" style="width: 100%" />
        </el-form-item>
        <el-form-item label="纬度" prop="latitude">
          <el-input-number v-model="form.latitude" :precision="6" :step="0.001" :min="-90" :max="90" style="width: 100%" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="请输入描述信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>

    <!-- 导入对话框 -->
    <el-dialog v-model="importDialogVisible" title="导入数据" width="400px">
      <div class="import-tips">
        <p>请上传CSV格式文件，支持以下字段：</p>
        <ul>
          <li>name - 名称（必填）</li>
          <li>category - 类别</li>
          <li>status - 状态</li>
          <li>latitude - 纬度（必填）</li>
          <li>longitude - 经度（必填）</li>
          <li>description - 描述</li>
        </ul>
        <el-link type="primary" @click="downloadTemplate">下载模板</el-link>
      </div>
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :limit="1"
        accept=".csv"
        :on-change="handleFileChange"
        drag
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
      </el-upload>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="handleImportConfirm">确定导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Download, Search, Edit, Delete, Location } from '@element-plus/icons-vue'
import { useMarkerStore } from '@/stores/marker'

const router = useRouter()
const markerStore = useMarkerStore()

// 筛选和分页
const searchKeyword = ref('')
const filterCategory = ref('')
const filterStatus = ref('')
const currentPage = ref(1)
const pageSize = ref(20)

// 弹窗状态
const dialogVisible = ref(false)
const importDialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const importing = ref(false)
const editingId = ref(null)
const uploadRef = ref(null)
const uploadFile = ref(null)

// 表单数据
const formRef = ref(null)
const form = reactive({
  name: '',
  category: '',
  status: '',
  latitude: 0,
  longitude: 0,
  description: ''
})

const rules = {
  name: [{ required: true, message: '请输入点位名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择类别', trigger: 'change' }],
  status: [{ required: true, message: '请选择状态', trigger: 'change' }],
  latitude: [{ required: true, message: '请输入纬度', trigger: 'blur' }],
  longitude: [{ required: true, message: '请输入经度', trigger: 'blur' }]
}

// 筛选后的数据
const filteredMarkers = computed(() => {
  return markerStore.markers.filter(marker => {
    const matchKeyword = !searchKeyword.value ||
      marker.name.toLowerCase().includes(searchKeyword.value.toLowerCase()) ||
      (marker.description && marker.description.toLowerCase().includes(searchKeyword.value.toLowerCase()))
    const matchCategory = !filterCategory.value || marker.category === filterCategory.value
    const matchStatus = !filterStatus.value || marker.status === filterStatus.value
    return matchKeyword && matchCategory && matchStatus
  })
})

// 分页数据
const paginatedMarkers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredMarkers.value.slice(start, end)
})

// 状态标签类型
const getStatusType = (status) => {
  const typeMap = {
    '正常': 'success',
    '告警': 'danger',
    '维护': 'warning',
    '停用': 'info'
  }
  return typeMap[status] || ''
}

// 格式化日期
const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN')
}

// 搜索
const handleSearch = () => {
  currentPage.value = 1
}

// 显示添加弹窗
const showAddDialog = () => {
  isEdit.value = false
  editingId.value = null
  Object.assign(form, {
    name: '',
    category: '门店',
    status: '正常',
    latitude: 39.9042,
    longitude: 116.4074,
    description: ''
  })
  dialogVisible.value = true
}

// 编辑
const handleEdit = (row) => {
  isEdit.value = true
  editingId.value = row.id
  Object.assign(form, {
    name: row.name,
    category: row.category,
    status: row.status,
    latitude: row.latitude,
    longitude: row.longitude,
    description: row.description || ''
  })
  dialogVisible.value = true
}

// 保存
const handleSave = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    let result
    if (isEdit.value) {
      result = await markerStore.updateMarker(editingId.value, { ...form })
    } else {
      result = await markerStore.addMarker({ ...form })
    }

    if (result.success) {
      ElMessage.success(isEdit.value ? '更新成功' : '添加成功')
      dialogVisible.value = false
    } else {
      ElMessage.error(result.message)
    }
  } finally {
    saving.value = false
  }
}

// 删除
const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要删除点位「${row.name}」吗？`, '提示', {
      type: 'warning'
    })
    const result = await markerStore.deleteMarker(row.id)
    if (result.success) {
      ElMessage.success('删除成功')
    } else {
      ElMessage.error(result.message)
    }
  } catch {
    // 用户取消
  }
}

// 定位
const handleLocate = (row) => {
  router.push({ path: '/', query: { lat: row.latitude, lng: row.longitude, id: row.id } })
}

// 导入
const handleImport = () => {
  uploadFile.value = null
  importDialogVisible.value = true
}

// 文件变化
const handleFileChange = (file) => {
  uploadFile.value = file.raw
}

// 确认导入
const handleImportConfirm = async () => {
  if (!uploadFile.value) {
    ElMessage.warning('请选择文件')
    return
  }

  importing.value = true
  try {
    const result = await markerStore.importMarkers(uploadFile.value)
    if (result.success) {
      ElMessage.success(`成功导入 ${result.count} 条数据`)
      importDialogVisible.value = false
    } else {
      ElMessage.error(result.message)
    }
  } finally {
    importing.value = false
  }
}

// 导出
const handleExport = async () => {
  const result = await markerStore.exportMarkers()
  if (result.success) {
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `markers_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  }
}

// 下载模板
const downloadTemplate = () => {
  const template = `name,category,status,latitude,longitude,description
示例门店,门店,正常,39.9042,116.4074,位于北京市中心
示例设备,设备,正常,39.9142,116.4174,生产设备A01`
  const blob = new Blob([template], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'marker_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  markerStore.fetchMarkers()
})
</script>

<style lang="scss" scoped>
.data-view {
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
  margin-bottom: 20px;

  h2 {
    margin: 0;
    font-size: 18px;
    color: #333;
  }

  .header-actions {
    display: flex;
    gap: 10px;
  }
}

.filter-bar {
  background: white;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 15px;
  display: flex;
  align-items: center;
  gap: 15px;

  .统计 {
    margin-left: auto;
    color: #666;
    font-size: 14px;
  }
}

.data-table {
  flex: 1;
  background: white;
  border-radius: 8px;
  padding: 15px;
  overflow: auto;
}

.pagination-container {
  margin-top: 15px;
  display: flex;
  justify-content: flex-end;
}

.import-tips {
  margin-bottom: 20px;

  p {
    margin-bottom: 10px;
    color: #666;
  }

  ul {
    margin: 0;
    padding-left: 20px;
    color: #999;
    font-size: 13px;

    li {
      margin-bottom: 5px;
    }
  }

  .el-link {
    margin-top: 10px;
  }
}
</style>
