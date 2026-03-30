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
      <el-table :data="fileList" style="width: 100%">
        <el-table-column prop="name" label="文件名" min-width="200" />
        <el-table-column prop="feature_count" label="要素数量" width="100" align="center" />
        <el-table-column prop="field_names" label="字段" min-width="150">
          <template #default="{ row }">
            <el-tag v-for="field in (row.field_names || [])" :key="field" size="small" class="field-tag">
              {{ field }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="上传时间" width="160" />
        <el-table-column label="操作" width="180" align="center">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="loadAndDisplay(row)">
              <el-icon><MapLocation /></el-icon>
              显示
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
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled, MapLocation, Delete } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const baseURL = import.meta.env.VITE_API_BASE_URL || ''
const userStore = useUserStore()

const fileList = ref([])
const uploadHeaders = {
  'x-user-id': userStore.user?.id || 1
}

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

// 加载并显示
const loadAndDisplay = async (row) => {
  try {
    const response = await fetch(`${baseURL}/api/shapefiles/${row.id}`, {
      headers: uploadHeaders
    })
    const result = await response.json()
    if (result.data) {
      // 通过事件将 GeoJSON 发送到地图
      window.dispatchEvent(new CustomEvent('displayShapefile', {
        detail: {
          id: row.id,
          name: row.name,
          geojson: result.data.geojson
        }
      }))
      ElMessage.success(`已加载 "${row.name}"，请到地图查看显示效果`)
    }
  } catch (error) {
    ElMessage.error('加载失败: ' + error.message)
  }
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
</style>
