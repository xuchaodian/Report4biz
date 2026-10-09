<template>
  <div class="shapefile-view">
    <el-tabs v-model="activeTab" @tab-change="onTabChange" class="shapefile-tabs">
      <el-tab-pane label="常住人口" name="population">
        <!-- 上传区域（仅管理员可见） -->
        <div class="upload-section" v-if="userStore.isAdmin">
          <el-upload
            class="shapefile-uploader"
            drag
            :action="`${baseURL}/api/shapefiles/upload`"
            :headers="uploadHeaders"
            :data="{ category: 'population' }"
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

        <!-- 文件列表（按城市分级） -->
        <ShapefileTierList
          :files="populationFiles"
          :headers="uploadHeaders"
          @query="openQueryDialog"
          @changed="loadFileList('population')"
        />
      </el-tab-pane>

      <!-- 「高精度人口」仅管理员可见（250m 网格，尚在试点：普通/VIP 账户暂不展示） -->
      <el-tab-pane v-if="userStore.isAdmin" label="高精度人口" name="population_hd">
        <!-- 上传区域（仅管理员可见） -->
        <div class="upload-section" v-if="userStore.isAdmin">
          <el-upload
            class="shapefile-uploader"
            drag
            :action="`${baseURL}/api/shapefiles/upload`"
            :headers="uploadHeaders"
            :data="{ category: 'population_hd' }"
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

        <!-- 文件列表（按城市分级）——250m 网格单城约 10.8 万要素，刻意不提供检索 -->
        <ShapefileTierList
          :files="hdFiles"
          :headers="uploadHeaders"
          :show-query="false"
          @changed="loadFileList('population_hd')"
        />
      </el-tab-pane>

      <el-tab-pane label="城市商圈" name="other">
        <!-- 上传区域（仅管理员可见） -->
        <div class="upload-section" v-if="userStore.isAdmin">
          <el-upload
            class="shapefile-uploader"
            drag
            :action="`${baseURL}/api/shapefiles/upload`"
            :headers="uploadHeaders"
            :data="{ category: 'other' }"
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

        <!-- 文件列表（按城市分级） -->
        <ShapefileTierList
          :files="otherFiles"
          :headers="uploadHeaders"
          @query="openQueryDialog"
          @changed="loadFileList('other')"
        />
      </el-tab-pane>

      <el-tab-pane label="城市数据" name="citydata">
        <!-- 操作栏 -->
        <div class="upload-section" style="display:flex;justify-content:space-between">
          <div style="display:flex;gap:8px;align-items:center">
            <el-upload
              v-if="userStore.isAdmin"
              action="/api/city-data/import"
              accept=".csv"
              :show-file-list="false"
              :on-success="onCityDataImportSuccess"
              :on-error="() => ElMessage.error('导入失败')"
            >
              <el-button type="primary" size="small"><el-icon><Upload /></el-icon>导入CSV</el-button>
            </el-upload>
            <el-button type="primary" link @click="$router.push('/city-data')" style="font-size:14px">
              <el-icon><FullScreen /></el-icon>全屏查看
            </el-button>
            <span v-if="userStore.isAdmin" style="font-size:12px;color:#909399">支持CSV格式，列名需与现有字段一致</span>
          </div>
          <div style="display:flex;gap:8px">
            <el-button v-if="userStore.isAdmin" type="danger" size="small" @click="handleClearCityData"><el-icon><Delete /></el-icon>一键清除</el-button>
          </div>
        </div>
        <!-- 数据表格 -->
        <div class="file-list" v-if="cityData.length > 0">

          <el-table :data="cityData" style="width:100%" stripe border :max-height="600" size="small" @sort-change="onCityDataSort">
            <el-table-column prop="城市" label="城市" min-width="80" fixed sortable="custom" />
            <el-table-column prop="年份" label="年份" min-width="70" sortable="custom" />
            <el-table-column prop="GDP(亿元)" label="GDP(亿)" min-width="100" align="right" sortable="custom">
              <template #default="{ row }">{{ row['GDP(亿元)'] != null ? Math.round(Number(row['GDP(亿元)'])) : '-' }}</template>
            </el-table-column>
            <el-table-column prop="增速(%)" label="增速" min-width="70" align="right" sortable="custom">
              <template #default="{ row }">{{ row['增速(%)'] != null ? Number(row['增速(%)']).toFixed(1) + '%' : '-' }}</template>
            </el-table-column>
            <el-table-column prop="人均GDP(元)" label="人均GDP(元)" min-width="110" align="right" sortable="custom">
              <template #default="{ row }">{{ row['人均GDP(元)'] != null ? Math.round(Number(row['人均GDP(元)'])).toLocaleString() : '-' }}</template>
            </el-table-column>
            <el-table-column prop="年末常住人口(万人)" label="常住人口(万)" min-width="110" align="right" sortable="custom">
              <template #default="{ row }">{{ row['年末常住人口(万人)'] != null ? Math.round(Number(row['年末常住人口(万人)'])) : '-' }}</template>
            </el-table-column>
            <el-table-column prop="城镇居民人均可支配收入(元)" label="人均可支配收入(元)" min-width="140" align="right" sortable="custom">
              <template #default="{ row }">{{ row['城镇居民人均可支配收入(元)'] != null ? Math.round(Number(row['城镇居民人均可支配收入(元)'])).toLocaleString() : '-' }}</template>
            </el-table-column>
            <el-table-column prop="社会消费品零售总额(亿元)" label="社零总额(亿)" min-width="100" align="right" sortable="custom">
              <template #default="{ row }">{{ row['社会消费品零售总额(亿元)'] != null ? Math.round(Number(row['社会消费品零售总额(亿元)'])) : '-' }}</template>
            </el-table-column>
          </el-table>
        </div>
        <el-empty v-else description="暂无数据" />
      </el-tab-pane>
    </el-tabs>

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
              <el-select v-model="condition.field" placeholder="选择字段" style="width: 180px" @change="onFieldChange(index)">
                <el-option v-for="field in numericFields" :key="field" :label="field" :value="field" />
              </el-select>
              <el-select v-model="condition.operator" placeholder="运算符" style="width: 100px">
                <el-option label=">" value=">" />
                <el-option label=">=" value=">=" />
                <el-option label="<" value="<" />
                <el-option label="<=" value="<=" />
                <el-option label="=" value="=" />
                <el-option label="!=" value="!=" />
              </el-select>
              <el-input-number v-model="condition.value" placeholder="数值" :precision="0" :controls="false" style="width: 140px" />
              <el-button type="danger" size="small" @click="removeCondition(index)" title="删除该条件" aria-label="删除该筛选条件">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
        </div>

        <div class="logic-note">
          <el-icon><InfoFilled /></el-icon>
          <span>多个条件之间为 AND 关系（同时满足）</span>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <div class="dialog-footer-left" v-if="queryResult.matched > 0">
            <el-tag type="success" size="default">匹配 {{ queryResult.matched }} / {{ queryResult.total }} 个要素</el-tag>
            <el-button type="primary" size="default" @click="showOnMap" style="margin-left: 10px;">
              <el-icon><MapLocation /></el-icon>显示地图
            </el-button>
          </div>
          <div class="dialog-footer-right">
            <el-button @click="queryDialogVisible = false">关闭</el-button>
            <el-button type="primary" @click="executeQuery" :loading="queryLoading">执行检索</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <!-- 检索结果对话框 -->
    <el-dialog v-model="resultDialogVisible" title="检索结果" width="600px">
      <div class="result-content">
        <div class="result-summary">
          <el-tag type="success" size="large">
            匹配 {{ queryResult.matched || 0 }} / {{ queryResult.total || 0 }} 个要素
          </el-tag>
        </div>
        <div class="result-actions">
          <el-button type="primary" @click="showOnMap">
            <el-icon><MapLocation /></el-icon>在地图上显示
          </el-button>
          <el-button @click="resultDialogVisible = false">关闭</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
// 图标只保留本文件模板实际用到的：检索 / 重命名图标已随表格移入 ShapefileTierList
import { UploadFilled, Delete, Plus, InfoFilled, MapLocation } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import ShapefileTierList from '@/components/shapefile/ShapefileTierList.vue'

const router = useRouter()
const baseURL = import.meta.env.VITE_API_BASE_URL || ''
const userStore = useUserStore()

// Tab 切换
const activeTab = ref('population')

const populationFiles = ref([])
const hdFiles = ref([])
const otherFiles = ref([])
const cityData = ref([])
const uploadHeaders = {
  'x-user-id': userStore.user?.id || 1,
  'Authorization': `Bearer ${userStore.token}`
}

// 说明：城市分级分组（一线 / 新一线 / 二三线）、行内重命名、行内删除
// 已全部收敛到 ShapefileTierList 组件（三个 tab 复用同一份实现，原来重复了两份、约 130 行）。
// 「高精度人口」= category `population_hd`：250m 网格，单城约 10.8 万要素 / geojson 约 95MB。
// 数据量决定了它刻意不提供检索（:show-query="false"），也不参与任何地图图层与人口计算。

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
    loadFileList(activeTab.value)
  } else {
    ElMessage.error(response.message || '上传失败')
  }
}

// 上传失败
const handleUploadError = (error) => {
  ElMessage.error('上传失败: ' + (error.message || '未知错误'))
}

// 加载文件列表
const loadFileList = async (category) => {
  try {
    const url = category ? `${baseURL}/api/shapefiles?category=${category}` : `${baseURL}/api/shapefiles`
    const response = await fetch(url, { headers: uploadHeaders })
    const result = await response.json()
    if (result.data) {
      if (category === 'population') {
        populationFiles.value = result.data
      } else if (category === 'population_hd') {
        hdFiles.value = result.data
      } else if (category === 'other') {
        otherFiles.value = result.data
      }
    }
  } catch (error) {
    console.error('加载文件列表失败:', error)
  }
}

// Tab 切换
const onTabChange = (tab) => {
  // 二道闸门：「高精度人口」tab 对非管理员已 v-if 隐藏，此处防御未来重构时被直接调用
  if (tab === 'population_hd' && !userStore.isAdmin) return
  if (tab === 'citydata') {
    loadCityData()
  } else {
    loadFileList(tab)
  }
}

// 加载城市宏观数据
const loadCityData = async () => {
  try {
    const res = await fetch('/api/city-data')
    const d = await res.json()
    if (d.success) cityData.value = d.data
  } catch(e) {
    console.error('[CityData] 加载失败:', e)
  }
}

// CSV 导入成功回调
const onCityDataImportSuccess = (res) => {
  if (res.success) {
    ElMessage.success('导入成功')
    loadCityData()
  } else {
    ElMessage.error(res.message || '导入失败')
  }
}

// 一键清除城市数据
const handleClearCityData = async () => {
  try {
    await ElMessageBox.confirm('确定要清除所有城市宏观数据吗？此操作不可撤销！', '警告', {
      confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning'
    })
    const res = await fetch('/api/city-data', { method: 'DELETE' })
    const d = await res.json()
    if (d.success) {
      ElMessage.success('已清除所有数据')
      loadCityData()
    } else {
      ElMessage.error(d.message || '清除失败')
    }
  } catch (e) {
    if (e !== 'cancel') console.error('[CityData] 清除失败:', e)
  }
}

// 城市数据排序
const onCityDataSort = ({ prop, order }) => {
  if (!prop || !order) return
  cityData.value.sort((a, b) => {
    const va = a[prop], vb = b[prop]
    if (va == null) return 1
    if (vb == null) return -1
    const isNum = typeof va === 'number' || !isNaN(parseFloat(va))
    if (isNum && typeof va !== 'string') {
      return order === 'ascending' ? va - vb : vb - va
    }
    return order === 'ascending'
      ? String(va).localeCompare(String(vb), 'zh-CN')
      : String(vb).localeCompare(String(va), 'zh-CN')
  })
}

// 打开检索对话框
const openQueryDialog = async (row) => {
  currentFile.value = row
  conditions.value = []
  queryResult.value = { total: 0, matched: 0, features: [] }

  // 先获取数值字段列表，再打开对话框
  try {
    const response = await fetch(`${baseURL}/api/shapefiles/${row.id}/fields`, {
      headers: uploadHeaders
    })
    const result = await response.json()
    if (result.success && result.data) {
      // 过滤掉 RecID、OBJECTID、FID 等系统字段
      const excludeFields = ['recid', 'objectid', 'fid', 'objectid_1']
      let fields = (result.data.numericFields || []).filter(f =>
        !excludeFields.includes(f.toLowerCase())
      )
      // 如果 API 返回空，尝试从文件列表的 field_names 中获取
      if (fields.length === 0 && row.field_names && row.field_names.length > 0) {
        fields = row.field_names.filter(f =>
          !excludeFields.includes(f.toLowerCase())
        )
      }
      numericFields.value = fields
    } else {
      // API 失败时从 fileList 取字段
      numericFields.value = (row.field_names || []).filter(f =>
        !['recid', 'objectid', 'fid', 'objectid_1'].includes(f.toLowerCase())
      )
    }
  } catch (error) {
    console.error('获取字段列表失败:', error)
    // 网络错误时从 fileList 取字段
    numericFields.value = (row.field_names || []).filter(f =>
      !['recid', 'objectid', 'fid', 'objectid_1'].includes(f.toLowerCase())
    )
  }

  // 字段加载完成后再打开对话框
  queryDialogVisible.value = true

  if (numericFields.value.length === 0) {
    ElMessage.warning('该文件中未检测到数值字段')
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
  // 默认选择"常住人口"（如果存在），否则选择第一个字段
  const defaultField = numericFields.value.includes('常住人口') ? '常住人口' : numericFields.value[0]
  conditions.value.push({
    field: defaultField,
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

  // 自动将"名称"/"name"字段加入显示（如果数据中存在）
  const firstFeature = queryResult.value.features[0]
  const featureProps = firstFeature?.properties || {}
  const nameField = ['名称', 'name', 'Name', 'NAME'].find(f => f in featureProps)
  if (nameField && !displayFields.includes(nameField)) {
    displayFields.unshift(nameField)
  }

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
    displayFields: displayFields
  }

  // 跳转到地图页面
  queryDialogVisible.value = false
  router.push('/')

  // 启动轮询：等待地图准备好后处理显示（最长10秒）
  let pollTimer = setInterval(() => {
    const fn = window.handleShapefileQueryFromGlobal
    if (fn && fn()) {
      clearInterval(pollTimer)
    }
  }, 500)
  setTimeout(() => { clearInterval(pollTimer) }, 10000)
}

onMounted(() => {
  loadFileList('population')
})
</script>

<style scoped>
.shapefile-view {
  padding: 20px;
  max-width: 1000px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
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
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.dialog-footer-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dialog-footer-right {
  display: flex;
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
/* 说明：城市分组列表 / 行内重命名 的样式已随结构移入 ShapefileTierList.vue（scoped），
   此处原先的 .filename-cell / .rename-inline / .tier-section / .tier-count / .table-wrap
   已无模板匹配 ⇒ 删除，避免三份样式各自漂移。 */

/* Tab 样式 */
.shapefile-tabs {
  margin-top: 0;
}
.shapefile-tabs :deep(.el-tabs__header) {
  margin-bottom: 20px;
}
</style>
