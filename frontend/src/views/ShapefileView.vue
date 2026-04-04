<template>
  <div class="shapefile-view">
    <div class="header">
      <h2>Shapefile 管理</h2>
      <p class="subtitle">上传 WGS84 坐标系的 Shapefile 文件，自动转换为高德坐标并叠加显示</p>
    </div>

    <!-- 上传区域 -->
    <div class="upload-section">
      <el-upload
        class="shapefile-uploader"
        drag
        :action="`${baseURL}/api/shapefiles/upload`"
        :headers="uploadHeaders"
        :before-upload="beforeUpload"
        :on-success="handleUploadSuccess"
        :on-error="handleUploadError"
        accept=".zip"
        :show-file-list="false"
      >
        <el-icon class="upload-icon"><UploadFilled /></el-icon>
        <div class="upload-text">
          <span class="title">拖拽 ZIP 文件到此处</span>
          <span class="subtitle">或点击选择文件上传</span>
          <span class="format">支持格式：.zip（包含 .shp, .shx, .dbf 文件）</span>
        </div>
      </el-upload>
    </div>

    <!-- 文件列表 -->
    <div class="file-list" v-if="fileList.length > 0">
      <h3>已上传的文件</h3>
      <el-table :data="fileList" style="width: 100%" row-key="id">
        <el-table-column prop="name" label="文件名" min-width="200">
          <template #default="{ row }">
            <div v-if="renamingId === row.id" class="rename-inline">
              <el-input
                ref="renameInputRef"
                v-model="renameValue"
                size="small"
                style="width: 100%"
                @keyup.enter="confirmRename(row)"
                @keyup.esc="cancelRename"
              />
              <el-button type="primary" size="small" link @click="confirmRename(row)">
                <el-icon><Check /></el-icon>
              </el-button>
              <el-button type="info" size="small" link @click="cancelRename">
                <el-icon><Close /></el-icon>
              </el-button>
            </div>
            <div v-else class="filename-cell" @dblclick="startRename(row)">
              <span class="filename-text">{{ row.name }}</span>
              <el-button type="primary" size="small" link class="rename-btn" @click="startRename(row)">
                <el-icon><EditPen /></el-icon>
              </el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="feature_count" label="要素数量" width="100" align="center" />
        <el-table-column prop="created_at" label="上传时间" width="160" />
        <el-table-column label="操作" width="180" align="center">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="openQueryDialog(row)">
              <el-icon><Search /></el-icon>
              检索
            </el-button>
            <el-button type="danger" size="small" @click="handleDelete(row)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 空状态 -->
    <el-empty v-else description="暂无上传的文件" />

    <!-- 检索对话框 -->
    <el-dialog
      v-model="queryDialogVisible"
      title="数据检索"
      width="700px"
      :close-on-click-modal="false"
    >
      <div class="query-dialog-content">
        <div class="file-info" v-if="currentFile">
          <span class="file-name">{{ currentFile.name }}</span>
          <span class="feature-count">共 {{ currentFile.feature_count }} 个要素</span>
        </div>

        <!-- 检索条件列表 -->
        <div class="conditions-section">
          <div class="section-header">
            <span class="section-title">检索条件</span>
            <el-button type="primary" size="small" link @click="addCondition">
              <el-icon><Plus /></el-icon>
              添加条件
            </el-button>
          </div>

          <div v-if="conditions.length === 0" class="no-conditions">
            暂无检索条件，点击"添加条件"开始
          </div>

          <div v-else class="condition-list">
            <div v-for="(condition, index) in conditions" :key="index" class="condition-item">
              <el-select
                v-model="condition.field"
                placeholder="选择字段"
                style="width: 180px"
                @change="onFieldChange(index)"
              >
                <el-option
                  v-for="field in numericFields"
                  :key="field"
                  :label="field"
                  :value="field"
                />
              </el-select>

              <el-select v-model="condition.operator" placeholder="运算符" style="width: 100px">
                <el-option label=">" value=">" />
                <el-option label=">=" value=">=" />
                <el-option label="<" value="<" />
                <el-option label="<=" value="<=" />
                <el-option label="=" value="=" />
                <el-option label="!=" value="!=" />
              </el-select>

              <el-input-number
                v-model="condition.value"
                placeholder="数值"
                :precision="0"
                :controls="false"
                style="width: 140px"
              />

              <el-button type="danger" size="small" @click="removeCondition(index)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
        </div>

        <!-- 逻辑关系说明 -->
        <div class="logic-note">
          <el-icon><InfoFilled /></el-icon>
          <span>多个条件之间为 AND 关系（同时满足）</span>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="queryDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="executeQuery" :loading="queryLoading">
            执行检索
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 检索结果对话框 -->
    <el-dialog
      v-model="resultDialogVisible"
      title="检索结果"
      width="600px"
    >
      <div class="result-content">
        <div class="result-summary">
          <el-tag type="success" size="large">
            匹配 {{ queryResult.matched || 0 }} / {{ queryResult.total || 0 }} 个要素
          </el-tag>
        </div>

        <div class="result-actions">
          <el-button type="primary" @click="showOnMap">
            <el-icon><MapLocation /></el-icon>
            在地图上显示
          </el-button>
          <el-button @click="resultDialogVisible = false">关闭</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled, Delete, Search, Plus, InfoFilled, MapLocation, EditPen, Check, Close } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const baseURL = import.meta.env.VITE_API_BASE_URL || ''
const userStore = useUserStore()

const fileList = ref([])
const uploadHeaders = {
  'x-user-id': userStore.user?.id || 1
}

// 重命名相关
const renamingId = ref(null)
const renameValue = ref('')
const renameInputRef = ref(null)

// 检索相关
const queryDialogVisible = ref(false)
const resultDialogVisible = ref(false)
const currentFile = ref(null)
const numericFields = ref([])
const conditions = ref([])
const queryLoading = ref(false)
const queryResult = ref({ total: 0, matched: 0, features: [] })

// 上传前检查
const beforeUpload = (file) => {
  const isZip = file.name.toLowerCase().endsWith('.zip')
  const isLt50M = file.size / 1024 / 1024 < 50

  if (!isZip) {
    ElMessage.error('只支持上传 ZIP 格式文件！')
    return false
  }
  if (!isLt50M) {
    ElMessage.error('文件大小不能超过 50MB！')
    return false
  }
  return true
}

// 上传成功
const handleUploadSuccess = (response) => {
  if (response.success) {
    ElMessage.success(response.message || '上传成功')
    loadFileList()
  } else {
    ElMessage.error(response.message || '上传失败')
  }
}

// 上传失败
const handleUploadError = (error) => {
  ElMessage.error('上传失败: ' + (error.message || '未知错误'))
}

// 加载文件列表
const loadFileList = async () => {
  try {
    const response = await fetch(`${baseURL}/api/shapefiles`, {
      headers: uploadHeaders
    })
    const result = await response.json()
    if (result.data) {
      fileList.value = result.data
    }
  } catch (error) {
    console.error('加载文件列表失败:', error)
  }
}

// 开始重命名
const startRename = async (row) => {
  renamingId.value = row.id
  renameValue.value = row.name
  await nextTick()
  renameInputRef.value?.focus()
}

// 确认重命名
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
      headers: { ...uploadHeaders, 'Content-Type': 'application/json' },
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

// 取消重命名
const cancelRename = () => {
  renamingId.value = null
}

// 删除
const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要删除 "${row.name}" 吗？`, '提示', {
      type: 'warning'
    })

    const response = await fetch(`${baseURL}/api/shapefiles/${row.id}`, {
      method: 'DELETE',
      headers: uploadHeaders
    })
    const result = await response.json()
    if (result.success) {
      ElMessage.success('删除成功')
      loadFileList()
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

// 打开检索对话框
const openQueryDialog = async (row) => {
  currentFile.value = row
  conditions.value = []
  queryResult.value = { total: 0, matched: 0, features: [] }
  queryDialogVisible.value = true

  // 获取数值字段列表
  try {
    const response = await fetch(`${baseURL}/api/shapefiles/${row.id}/fields`, {
      headers: uploadHeaders
    })
    const result = await response.json()
    if (result.success && result.data) {
      numericFields.value = result.data.numericFields || []
      if (numericFields.value.length === 0) {
        ElMessage.warning('该文件中未检测到数值字段')
      }
    }
  } catch (error) {
    console.error('获取字段列表失败:', error)
    ElMessage.error('获取字段信息失败')
  }
}

// 字段变化时重置运算符和值
const onFieldChange = (index) => {
  conditions.value[index].operator = '>'
  conditions.value[index].value = null
}

// 添加条件
const addCondition = () => {
  if (numericFields.value.length === 0) {
    ElMessage.warning('该文件没有可用的数值字段')
    return
  }
  conditions.value.push({
    field: numericFields.value[0],
    operator: '>',
    value: null
  })
}

// 移除条件
const removeCondition = (index) => {
  conditions.value.splice(index, 1)
}

// 执行检索
const executeQuery = async () => {
  if (!currentFile.value) return

  // 验证条件
  const validConditions = conditions.value.filter(c => 
    c.field && c.operator && c.value !== null && c.value !== undefined
  )

  if (validConditions.length === 0) {
    ElMessage.warning('请至少添加一个有效的检索条件')
    return
  }

  queryLoading.value = true
  try {
    const response = await fetch(`${baseURL}/api/shapefiles/${currentFile.value.id}/query`, {
      method: 'POST',
      headers: {
        ...uploadHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ conditions: validConditions })
    })
    const result = await response.json()
    
    if (result.success) {
      queryResult.value = result.data
      resultDialogVisible.value = true
      queryDialogVisible.value = false
      
      if (result.data.matched === 0) {
        ElMessage.info('没有匹配的数据')
      } else {
        ElMessage.success(`找到 ${result.data.matched} 个匹配要素`)
      }
    } else {
      ElMessage.error(result.message || '检索失败')
    }
  } catch (error) {
    console.error('检索失败:', error)
    ElMessage.error('检索失败: ' + error.message)
  } finally {
    queryLoading.value = false
  }
}

// 在地图上显示
const showOnMap = () => {
  if (!currentFile.value || !queryResult.value.features || queryResult.value.features.length === 0) {
    ElMessage.warning('没有可显示的数据')
    return
  }

  // 提取检索条件中的字段名（用于地图上显示标签）
  const displayFields = conditions.value
    .filter(c => c.field && c.value !== null && c.value !== undefined && c.value !== '')
    .map(c => c.field)

  // 将检索结果传递给地图页面
  const geojson = {
    type: 'FeatureCollection',
    features: queryResult.value.features
  }

  // 直接在全局存储检索结果
  window.shapefileQueryResult = {
    id: currentFile.value.id,
    name: currentFile.value.name,
    geojson: geojson,
    matched: queryResult.value.matched,
    displayFields: displayFields  // 只显示这些字段的值
  }

  // 先跳转到地图页面
  router.push('/')

  // 延迟关闭对话框，避免干扰页面跳转
  setTimeout(() => {
    resultDialogVisible.value = false
  }, 100)
}

onMounted(() => {
  loadFileList()
})
</script>

<style scoped>
.shapefile-view {
  padding: 20px;
  max-width: 1000px;
  margin: 0 auto;
}

.header {
  margin-bottom: 24px;
}

.header h2 {
  margin: 0 0 8px 0;
  font-size: 20px;
  color: #303133;
}

.subtitle {
  color: #909399;
  font-size: 14px;
  margin: 0;
}

.upload-section {
  margin-bottom: 24px;
}

.shapefile-uploader {
  width: 100%;
}

.shapefile-uploader :deep(.el-upload-dragger) {
  padding: 40px 20px;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  background: #fafafa;
  transition: all 0.3s;
}

.shapefile-uploader :deep(.el-upload-dragger:hover) {
  border-color: #409eff;
  background: #ecf5ff;
}

.upload-icon {
  font-size: 48px;
  color: #409eff;
  margin-bottom: 16px;
}

.upload-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.upload-text .title {
  font-size: 16px;
  font-weight: 500;
  color: #303133;
}

.upload-text .subtitle {
  font-size: 14px;
  color: #606266;
}

.upload-text .format {
  font-size: 12px;
  color: #909399;
  margin-top: 8px;
}

.file-list {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.file-list h3 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: #303133;
}

.field-tag {
  margin-right: 4px;
  margin-bottom: 4px;
}

/* 检索对话框样式 */
.query-dialog-content {
  padding: 10px 0;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 6px;
  margin-bottom: 20px;
}

.file-info .file-name {
  font-weight: 500;
  color: #303133;
}

.file-info .feature-count {
  color: #909399;
  font-size: 14px;
}

.conditions-section {
  margin-bottom: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-title {
  font-weight: 500;
  color: #303133;
}

.no-conditions {
  padding: 24px;
  text-align: center;
  color: #909399;
  background: #fafafa;
  border-radius: 6px;
  border: 1px dashed #dcdfe6;
}

.condition-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.condition-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 6px;
}

.logic-note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #fdf6ec;
  border-radius: 6px;
  color: #e6a23c;
  font-size: 14px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* 结果对话框样式 */
.result-content {
  padding: 20px 0;
}

.result-summary {
  text-align: center;
  margin-bottom: 24px;
}

.result-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
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
