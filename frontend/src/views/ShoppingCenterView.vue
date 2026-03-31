<template>
  <div class="shopping-center-view">
    <div class="data-header">
      <h2>购物中心</h2>
      <div class="header-actions">
        <el-button v-if="userStore.isAdmin" type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>添加
        </el-button>
        <el-button v-if="userStore.isAdmin" @click="handleImport">
          <el-icon><Upload /></el-icon>导入
        </el-button>
        <el-button v-if="userStore.isAdmin" @click="handleExport">
          <el-icon><Download /></el-icon>导出
        </el-button>
        <el-button
          v-if="userStore.isAdmin && selectedRows.length > 0"
          type="danger"
          @click="handleBatchDelete"
        >
          <el-icon><Delete /></el-icon>批量删除({{ selectedRows.length }})
        </el-button>
        <el-button v-if="userStore.isAdmin" type="danger" plain @click="handleClearAll">
          <el-icon><Delete /></el-icon>全清除
        </el-button>
      </div>
    </div>

    <div class="filter-bar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索名称/地址/编号"
        style="width: 200px"
        clearable
        @input="handleSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>

      <el-select v-model="filterCity" placeholder="按城市" style="width: 120px" clearable @change="handleSearch">
        <el-option v-for="city in cityList" :key="city" :label="city" :value="city" />
      </el-select>

      <el-select v-model="filterDistrict" placeholder="按区县" style="width: 120px" clearable @change="handleSearch">
        <el-option v-for="d in districtList" :key="d" :label="d" :value="d" />
      </el-select>

      <el-select v-model="filterCategory" placeholder="按分类" style="width: 140px" clearable @change="handleSearch">
        <el-option v-for="c in categoryList" :key="c" :label="c" :value="c" />
      </el-select>

      <el-input-number
        v-model="filterStarsMin"
        placeholder="星级≥"
        :min="0"
        :max="5"
        :precision="1"
        :step="0.5"
        controls-position="right"
        style="width: 130px"
        clearable
        @change="handleSearch"
      />

      <el-input-number
        v-model="filterCommentsMin"
        placeholder="评论数≥"
        :min="0"
        :step="100"
        controls-position="right"
        style="width: 140px"
        clearable
        @change="handleSearch"
      />

      <span class="统计">共 {{ filteredList.length }} 条数据</span>
      <el-button v-if="hasActiveFilters" type="warning" plain @click="handleClearFilters">
        <el-icon><Close /></el-icon>清除筛选
      </el-button>
    </div>

    <div class="data-table">
      <el-table
        ref="tableRef"
        :data="paginatedList"
        v-loading="store.loading"
        border
        stripe
        row-key="id"
        style="width: 100%"
        @selection-change="handleSelectionChange"
      >
        <el-table-column v-if="userStore.isAdmin" type="selection" width="45" reserve-selection />
        <el-table-column prop="store_code" label="编号" width="90" />
        <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="store_category" label="分类" width="110" />
        <el-table-column prop="city" label="城市" width="90" />
        <el-table-column prop="district" label="区县" width="90" />
        <el-table-column prop="address" label="地址" min-width="150" show-overflow-tooltip />
        <el-table-column prop="stars" label="星级" width="80" align="center">
          <template #default="{ row }">
            <span v-if="row.stars">⭐ {{ row.stars }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="comments" label="评论数" width="90" align="right">
          <template #default="{ row }">
            {{ row.comments ? row.comments.toLocaleString() : '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="rank_info" label="榜单" min-width="120" show-overflow-tooltip />
        <el-table-column label="操作" :width="userStore.isAdmin ? 120 : 60" fixed="right">
          <template #default="{ row }">
            <template v-if="userStore.isAdmin">
              <el-button type="primary" link @click="handleEdit(row)">
                <el-icon><Edit /></el-icon>
              </el-button>
              <el-button type="danger" link @click="handleDelete(row)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </template>
            <el-button type="success" link @click="handleLocate(row)">
              <el-icon><Location /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="filteredList.length"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
      />
    </div>

    <!-- 添加/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑购物中心' : '添加购物中心'" width="620px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="编号" prop="store_code">
              <el-input v-model="form.store_code" placeholder="如: SC001" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="名称" prop="name">
              <el-input v-model="form.name" placeholder="购物中心名称" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="分类" prop="store_category">
              <el-select v-model="form.store_category" placeholder="请选择" style="width: 100%" allow-create filterable>
                <el-option v-for="c in storeCategoryOptions" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态" prop="status">
              <el-select v-model="form.status" placeholder="请选择" style="width: 100%">
                <el-option v-for="s in statusList" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-divider content-position="left">地址信息</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="城市" prop="city">
              <el-input v-model="form.city" placeholder="如: 北京市" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="区县" prop="district">
              <el-input v-model="form.district" placeholder="如: 朝阳区" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="地址" prop="address">
          <el-input v-model="form.address" placeholder="详细地址" />
        </el-form-item>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="纬度" prop="latitude">
              <el-input-number v-model="form.latitude" :precision="6" :step="0.001" :min="-90" :max="90" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="经度" prop="longitude">
              <el-input-number v-model="form.longitude" :precision="6" :step="0.001" :min="-180" :max="180" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-divider content-position="left">附加信息</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="星级" prop="stars">
              <el-input-number v-model="form.stars" :precision="1" :step="0.5" :min="0" :max="5" style="width: 100%" placeholder="0~5" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="评论数" prop="comments">
              <el-input-number v-model="form.comments" :precision="0" :min="0" style="width: 100%" placeholder="评论数量" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="榜单" prop="rank_info">
          <el-input v-model="form.rank_info" type="textarea" :rows="2" placeholder="如: 大众点评必吃榜、米其林推荐等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>

    <!-- 导入对话框 -->
    <el-dialog v-model="importDialogVisible" title="导入购物中心数据" width="500px">
      <div class="import-tips">
        <p>请上传CSV格式文件，支持以下字段：</p>
        <ul>
          <li>store_code - 编号</li>
          <li>name - 名称（必填）</li>
          <li>store_category - 分类</li>
          <li>city - 城市</li>
          <li>district - 区县</li>
          <li>address - 地址</li>
          <li>stars - 星级（0~5）</li>
          <li>comments - 评论数</li>
          <li>rank_info - 榜单</li>
          <li>latitude - 纬度（必填）</li>
          <li>longitude - 经度（必填）</li>
        </ul>
        <el-link type="primary" @click="downloadTemplate">下载模板</el-link>
      </div>
      <el-upload ref="uploadRef" :auto-upload="false" :limit="1" accept=".csv" :on-change="handleFileChange" drag>
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
import { Plus, Upload, Download, Search, Edit, Delete, Location, Close } from '@element-plus/icons-vue'
import { useShoppingCenterStore } from '@/stores/shoppingCenterStore'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const store = useShoppingCenterStore()
const router = useRouter()

const storeCategoryOptions = ['购物中心', '百货商场', '奥特莱斯', '社区商业', '街边商业', '专业市场']
const statusList = ['正常', '关注', '暂停', '关闭']

const searchKeyword = ref('')
const filterCity = ref('')
const filterDistrict = ref('')
const filterCategory = ref('')
const filterStarsMin = ref('')  // 最小星级筛选
const filterCommentsMin = ref('')  // 最小评论数筛选
const currentPage = ref(1)
const pageSize = ref(20)

const syncFiltersToStore = () => {
  store.setFilters({
    searchKeyword: searchKeyword.value,
    filterCity: filterCity.value,
    filterDistrict: filterDistrict.value,
    filterCategory: filterCategory.value,
    filterStarsMin: filterStarsMin.value,
    filterCommentsMin: filterCommentsMin.value
  })
  // 同步筛选结果到 visibleIds，用于地图图层联动
  const filteredIds = filteredList.value.map(item => item.id)
  store.setVisibleIds(filteredIds.length > 0 ? filteredIds : null)
}

const dialogVisible = ref(false)
const importDialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const importing = ref(false)
const editingId = ref(null)
const uploadRef = ref(null)
const uploadFile = ref(null)
const tableRef = ref(null)
const selectedRows = ref([])

const formRef = ref(null)
const form = reactive({
  store_code: '', name: '', store_category: '', status: '正常',
  city: '', district: '', address: '',
  stars: 0, comments: 0, rank_info: '',
  latitude: 39.9042, longitude: 116.4074
})

const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  latitude: [{ required: true, message: '请输入纬度', trigger: 'blur' }],
  longitude: [{ required: true, message: '请输入经度', trigger: 'blur' }]
}

const cityList = computed(() => [...new Set(store.shoppingCenters.map(s => s.city).filter(Boolean))].sort())
const districtList = computed(() => [...new Set(store.shoppingCenters.map(s => s.district).filter(Boolean))].sort())
const categoryList = computed(() => [...new Set(store.shoppingCenters.map(s => s.store_category).filter(Boolean))].sort())

const filteredList = computed(() => {
  return store.shoppingCenters.filter(item => {
    const matchKeyword = !searchKeyword.value ||
      item.name.toLowerCase().includes(searchKeyword.value.toLowerCase()) ||
      (item.address && item.address.toLowerCase().includes(searchKeyword.value.toLowerCase())) ||
      (item.store_code && item.store_code.toLowerCase().includes(searchKeyword.value.toLowerCase()))
    const matchCity = !filterCity.value || item.city === filterCity.value
    const matchDistrict = !filterDistrict.value || item.district === filterDistrict.value
    const matchCategory = !filterCategory.value || item.store_category === filterCategory.value
    // 星级筛选：大于等于设定值
    const matchStars = !filterStarsMin.value || (item.stars && item.stars >= parseFloat(filterStarsMin.value))
    // 评论数筛选：大于等于设定值
    const matchComments = !filterCommentsMin.value || (item.comments && item.comments >= parseInt(filterCommentsMin.value))
    return matchKeyword && matchCity && matchDistrict && matchCategory && matchStars && matchComments
  })
})

const paginatedList = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredList.value.slice(start, start + pageSize.value)
})

const hasActiveFilters = computed(() => searchKeyword.value || filterCity.value || filterDistrict.value || filterCategory.value || filterStarsMin.value || filterCommentsMin.value)

const handleSearch = () => {
  currentPage.value = 1
  syncFiltersToStore()
}

const handleClearFilters = () => {
  searchKeyword.value = ''
  filterCity.value = ''
  filterDistrict.value = ''
  filterCategory.value = ''
  filterStarsMin.value = ''
  filterCommentsMin.value = ''
  store.clearFilters()
  store.setVisibleIds(null)  // 清除地图筛选
  currentPage.value = 1
}

const showAddDialog = () => {
  isEdit.value = false
  editingId.value = null
  Object.assign(form, {
    store_code: '', name: '', store_category: '', status: '正常',
    city: '', district: '', address: '',
    stars: 0, comments: 0, rank_info: '',
    latitude: 39.9042, longitude: 116.4074
  })
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  editingId.value = row.id
  Object.assign(form, {
    store_code: row.store_code || '', name: row.name,
    store_category: row.store_category || '',
    status: row.status || '正常',
    city: row.city || '', district: row.district || '',
    address: row.address || '',
    stars: row.stars || 0, comments: row.comments || 0,
    rank_info: row.rank_info || '',
    latitude: row.latitude, longitude: row.longitude
  })
  dialogVisible.value = true
}

const handleSave = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    let result
    if (isEdit.value) {
      result = await store.updateShoppingCenter(editingId.value, { ...form })
    } else {
      result = await store.addShoppingCenter({ ...form })
    }
    if (result.success !== false) {
      ElMessage.success(isEdit.value ? '更新成功' : '添加成功')
      dialogVisible.value = false
    } else {
      ElMessage.error(result.message)
    }
  } finally {
    saving.value = false
  }
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要删除「${row.name}」吗？`, '提示', { type: 'warning' })
    const result = await store.deleteShoppingCenter(row.id)
    if (result.success !== false) {
      ElMessage.success('删除成功')
    } else {
      ElMessage.error(result.message)
    }
  } catch {}
}

const handleSelectionChange = (selection) => { selectedRows.value = selection }

const handleBatchDelete = async () => {
  if (selectedRows.value.length === 0) return
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedRows.value.length} 条数据吗？`, '提示', { type: 'warning' })
    const ids = selectedRows.value.map(row => row.id)
    const result = await store.batchDeleteShoppingCenters(ids)
    if (result.success) {
      ElMessage.success(`成功删除 ${result.count} 条数据`)
      tableRef.value?.clearSelection()
      selectedRows.value = []
      store.clearFilters()
      searchKeyword.value = ''
      filterCity.value = ''
      filterDistrict.value = ''
      filterCategory.value = ''
    } else {
      ElMessage.error(result.message)
    }
  } catch {}
}

const handleLocate = (row) => {
  router.push({ path: '/', query: { lat: row.latitude, lng: row.longitude, id: row.id, type: 'shoppingCenter' } })
}

const handleClearAll = async () => {
  try {
    await ElMessageBox.confirm(
      '此操作将清空所有购物中心数据，不可恢复！确定继续吗？',
      '危险操作',
      { type: 'warning', confirmButtonText: '确定清空', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
    const result = await store.clearAllShoppingCenters()
    if (result.success) {
      ElMessage.success(`已清空 ${result.count} 条购物中心数据`)
      tableRef.value?.clearSelection()
      selectedRows.value = []
    } else {
      ElMessage.error(result.message)
    }
  } catch {}
}

const handleImport = () => {
  uploadFile.value = null
  importDialogVisible.value = true
}
const handleFileChange = (file) => { uploadFile.value = file.raw }

const handleImportConfirm = async () => {
  if (!uploadFile.value) { ElMessage.warning('请选择文件'); return }
  importing.value = true
  try {
    const result = await store.importShoppingCenters(uploadFile.value)
    if (result.success !== false) {
      ElMessage.success(result.message)
      importDialogVisible.value = false
      await store.fetchShoppingCenters()
    } else {
      ElMessage.error(result.message)
    }
  } finally {
    importing.value = false
  }
}

const handleExport = async () => {
  const result = await store.exportShoppingCenters()
  if (result.success !== false) {
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shopping_centers_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  }
}

const downloadTemplate = () => {
  const template = `store_code,name,store_category,city,district,address,stars,comments,rank_info,latitude,longitude
SC001,某购物中心,购物中心,北京市,朝阳区,示例地址,4.5,12000,大众点评必吃榜,39.9088,116.4610`
  const blob = new Blob([template], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'shopping_center_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  store.fetchShoppingCenters()
  // 进入页面时重置筛选条件，避免管理员的筛选状态影响其他用户
  searchKeyword.value = ''
  filterCity.value = ''
  filterDistrict.value = ''
  filterCategory.value = ''
  filterStarsMin.value = ''
  filterCommentsMin.value = ''
  store.clearFilters()
  store.setVisibleIds(null)  // 重置地图图层显示
})
</script>

<style lang="scss" scoped>
.shopping-center-view {
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
  h2 { margin: 0; font-size: 18px; color: #333; }
  .header-actions { display: flex; gap: 10px; }
}
.filter-bar {
  background: white;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 15px;
  display: flex;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
  .统计 { margin-left: auto; color: #666; font-size: 14px; }
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
  padding: 15px;
  background: #f5f7fa;
  border-radius: 4px;
  p { margin: 0 0 10px 0; font-weight: bold; }
  ul { margin: 0; padding-left: 20px; font-size: 13px; color: #666; }
}
</style>
