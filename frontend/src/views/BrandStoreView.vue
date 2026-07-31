<template>
  <div class="brand-store-view">
    <div class="data-header">
      <h2>品牌门店</h2>
      <div class="header-actions">
        <el-button v-if="userStore.isAdmin" type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>添加品牌
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

      <el-select v-model="filterBrand" placeholder="按品牌" style="width: 200px" multiple collapse-tags collapse-tags-tooltip clearable @change="handleSearch">
        <el-option v-for="b in brandList" :key="b" :label="b" :value="b" />
      </el-select>

      <el-select v-model="filterCategory" placeholder="按分类" style="width: 140px" clearable @change="handleSearch">
        <el-option v-for="c in categoryList" :key="c" :label="c" :value="c" />
      </el-select>

      <span class="统计">共 {{ tableTotal }} 条数据</span>
      <el-button v-if="hasActiveFilters" type="warning" plain @click="handleClearFilters">
        <el-icon><Close /></el-icon>清除筛选
      </el-button>
    </div>

    <div class="data-table">
      <el-table
        ref="tableRef"
        :data="tableData"
        v-loading="tableLoading"
        border
        stripe
        row-key="id"
        style="width: 100%"
        @selection-change="handleSelectionChange"
      >
        <el-table-column v-if="userStore.isAdmin" type="selection" width="45" reserve-selection />
        <el-table-column prop="brand" label="品牌" width="120">
          <template #default="{ row }">
            {{ row.brand }}
          </template>
        </el-table-column>
        <el-table-column prop="name" label="门店名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="store_category" label="门店分类" width="120" />
        <el-table-column prop="city" label="城市" width="90" />
        <el-table-column prop="district" label="区县" width="90" />
        <el-table-column prop="address" label="地址" min-width="150" show-overflow-tooltip />
        <el-table-column prop="description" label="备注" min-width="120" show-overflow-tooltip />
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
        :total="tableTotal"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="loadBrandStoresTable"
        @size-change="loadBrandStoresTable"
      />
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑品牌门店' : '添加品牌门店'" width="600px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="编号" prop="store_code">
              <el-input v-model="form.store_code" placeholder="如: BRAND001" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="品牌" prop="brand">
              <el-input v-model="form.brand" placeholder="品牌名称" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="名称" prop="name">
              <el-input v-model="form.name" placeholder="门店名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="门店分类" prop="store_category">
              <el-select v-model="form.store_category" placeholder="请选择" style="width: 100%" allow-create filterable>
                <el-option v-for="c in storeCategoryOptions" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
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
        <el-form-item label="备注" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="备注信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialogVisible" title="导入品牌门店数据" width="500px">
      <div class="import-tips">
        <p>请上传CSV格式文件，支持以下字段：</p>
        <ul>
          <li>store_code - 门店编号</li>
          <li>brand - 品牌</li>
          <li>name - 门店名称（必填）</li>
          <li>store_category - 门店分类</li>
          <li>city - 城市</li>
          <li>district - 区县</li>
          <li>address - 地址</li>
          <li>description - 备注</li>
          <li>latitude - 纬度（必填）</li>
          <li>longitude - 经度（必填）</li>
        </ul>
        <el-link type="primary" @click="downloadTemplate">下载模板</el-link>
      </div>
      <el-upload ref="uploadRef" :auto-upload="false" :limit="1" accept=".csv" :on-change="handleFileChange" drag>
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
      </el-upload>
      <el-progress v-if="importing" :percentage="importProgress" :stroke-width="16" style="margin: 16px 0" :status="importProgress >= 100 && importStatus === 'done' ? 'success' : importStatus === 'error' ? 'exception' : undefined" />
      <div v-if="importing" style="text-align:center;font-size:13px;color:#909399;margin-bottom:8px;">{{ importStatusText }}</div>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="handleImportConfirm">确定导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Download, Search, Edit, Delete, Location, Close } from '@element-plus/icons-vue'
import { useBrandStoreStore } from '@/stores/brandStore'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const brandStoreStore = useBrandStoreStore()
const router = useRouter()

const storeCategoryOptions = ['社区店', '临街店', '商场店', '写字楼店', '交通枢纽店', '校园店', '景区店', '专业市场店']
const statusList = ['正常', '关注', '暂停', '关闭']

const searchKeyword = ref('')
const filterCity = ref('')
const filterDistrict = ref('')
const filterBrand = ref([])
const filterCategory = ref('')
const currentPage = ref(1)
const pageSize = ref(20)
const tableData = ref([])
const tableTotal = ref(0)
const tableLoading = ref(false)

const LS_KEY = () => `brandStoreFilters_${localStorage.getItem('userId') || 'anon'}`

// 保存筛选条件到 localStorage（持久化，按用户隔离）
const saveFiltersToLS = () => {
  const filters = {
    searchKeyword: searchKeyword.value,
    filterCity: filterCity.value,
    filterDistrict: filterDistrict.value,
    filterBrand: filterBrand.value,
    filterCategory: filterCategory.value,
    currentPage: currentPage.value
  }
  localStorage.setItem(LS_KEY(), JSON.stringify(filters))
}

// 从 localStorage 恢复筛选条件
const restoreFiltersFromLS = () => {
  const saved = localStorage.getItem(LS_KEY())
  if (!saved) return false
  try {
    const filters = JSON.parse(saved)
    searchKeyword.value = filters.searchKeyword || ''
    filterCity.value = filters.filterCity || ''
    filterDistrict.value = filters.filterDistrict || ''
    filterBrand.value = Array.isArray(filters.filterBrand) ? filters.filterBrand : (filters.filterBrand ? [filters.filterBrand] : [])
    filterCategory.value = filters.filterCategory || ''
    currentPage.value = filters.currentPage || 1
    return true
  } catch {
    return false
  }
}

const clearFiltersFromLS = () => {
  localStorage.removeItem(LS_KEY())
}

// 同步筛选条件到 store（用于地图 visibleIds 联动，不持久化到其他用户）
const syncFiltersToStore = () => {
  brandStoreStore.setFilters({
    searchKeyword: searchKeyword.value,
    filterCity: filterCity.value,
    filterDistrict: filterDistrict.value,
    filterBrand: filterBrand.value,
    filterCategory: filterCategory.value
  })
  saveFiltersToLS()
}

const brandColorMap = {
  '大米先生': '#e6a23c',
  '谷田稻香': '#f56c6c',
  '吉野家': '#409eff',
  '老乡鸡': '#67c23a',
  '米村拌饭': '#9c27b0'
}

const dialogVisible = ref(false)
const importDialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const importing = ref(false)
const importProgress = ref(0)
const importStatus = ref('')
const importStatusText = computed(() => {
  const map = { uploading: '上传文件中...', processing: '正在处理数据...', done: '导入完成', error: '导入失败' }
  return map[importStatus.value] || ''
})
const editingId = ref(null)
const uploadRef = ref(null)
const uploadFile = ref(null)
const tableRef = ref(null)
const selectedRows = ref([])

const formRef = ref(null)
const form = reactive({
  store_code: '', brand: '', name: '', store_category: '', status: '正常',
  city: '', district: '', address: '', description: '',
  latitude: 39.9042, longitude: 116.4074
})

const rules = {
  name: [{ required: true, message: '请输入门店名称', trigger: 'blur' }],
  latitude: [{ required: true, message: '请输入纬度', trigger: 'blur' }],
  longitude: [{ required: true, message: '请输入经度', trigger: 'blur' }]
}

const cityList = computed(() => {
  return [...new Set(brandStoreStore.brandStores.map(s => s.city).filter(Boolean))].sort()
})
const districtList = computed(() => {
  const city = filterCity.value
  return [...new Set(brandStoreStore.brandStores.filter(s => !city || s.city === city).map(s => s.district).filter(Boolean))].sort()
})

watch(filterCity, (newCity) => {
  if (newCity && filterDistrict.value) {
    const districts = [...new Set(brandStoreStore.brandStores.filter(s => s.city === newCity).map(s => s.district).filter(Boolean))]
    if (!districts.includes(filterDistrict.value)) filterDistrict.value = ''
  }
})
const brandList = computed(() => {
  return [...new Set(brandStoreStore.brandStores.map(s => s.brand).filter(Boolean))].sort()
})
const categoryList = computed(() => {
  return [...new Set(brandStoreStore.brandStores.map(s => s.store_category).filter(Boolean))].sort()
})

const filteredBrandStores = computed(() => {
  // 仅用于 visibleIds 同步（基于 store 全量数据）
  return brandStoreStore.brandStores.filter(store => {
    const matchKeyword = !searchKeyword.value ||
      store.name.toLowerCase().includes(searchKeyword.value.toLowerCase()) ||
      (store.address && store.address.toLowerCase().includes(searchKeyword.value.toLowerCase())) ||
      (store.store_code && store.store_code.toLowerCase().includes(searchKeyword.value.toLowerCase())) ||
      (store.brand && store.brand.toLowerCase().includes(searchKeyword.value.toLowerCase()))
    const matchCity = !filterCity.value || store.city === filterCity.value
    const matchDistrict = !filterDistrict.value || store.district === filterDistrict.value
    const matchBrand = !filterBrand.value.length || filterBrand.value.includes(store.brand)
    const matchCategory = !filterCategory.value || store.store_category === filterCategory.value
    return matchKeyword && matchCity && matchDistrict && matchBrand && matchCategory
  })
})

// 服务端分页加载表格数据
const loadBrandStoresTable = async () => {
  tableLoading.value = true
  try {
    const params = new URLSearchParams({
      page: currentPage.value, pageSize: pageSize.value,
      keyword: searchKeyword.value, city: filterCity.value,
      district: filterDistrict.value, brand: filterBrand.value.join(','),
      category: filterCategory.value
    })
    const token = sessionStorage.getItem('token')
    const r = await fetch(`/api/brand-stores?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const d = await r.json()
    if (d.success) { tableData.value = d.data; tableTotal.value = d.total }
    else if (d.brandStores) { tableData.value = d.brandStores; tableTotal.value = d.brandStores.length }
  } catch(e) { console.error('[BrandStore] 加载失败:', e) }
  finally { tableLoading.value = false }
}

const handleSearch = () => {
  currentPage.value = 1
  syncFiltersToStore()
  syncVisibleIds()
  loadBrandStoresTable()
}

const syncVisibleIds = () => {
  const hasFilter = searchKeyword.value || filterCity.value || filterDistrict.value ||
    filterBrand.value || filterCategory.value
  if (!hasFilter) {
    brandStoreStore.setVisibleIds(null)
  } else {
    brandStoreStore.setVisibleIds(filteredBrandStores.value.map(s => s.id))
  }
}

// 是否有激活的筛选条件
const hasActiveFilters = computed(() => {
  return searchKeyword.value || filterCity.value || filterDistrict.value || filterBrand.value.length || filterCategory.value
})

// 清除筛选条件
const handleClearFilters = () => {
  searchKeyword.value = ''
  filterCity.value = ''
  filterDistrict.value = ''
  filterBrand.value = []
  filterCategory.value = ''
  brandStoreStore.clearFilters()
  clearFiltersFromLS()
  currentPage.value = 1
  loadBrandStoresTable()
}
const showAddDialog = () => {
  isEdit.value = false
  editingId.value = null
  Object.assign(form, {
    store_code: '', brand: '', name: '', store_category: '', status: '正常',
    city: '', district: '', address: '', description: '',
    latitude: 39.9042, longitude: 116.4074
  })
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  editingId.value = row.id
  Object.assign(form, {
    store_code: row.store_code || '', brand: row.brand || '', name: row.name,
    store_category: row.store_category || '',
    status: row.status || '正常', city: row.city || '', district: row.district || '',
    address: row.address || '', description: row.description || '',
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
      result = await brandStoreStore.updateBrandStore(editingId.value, { ...form })
    } else {
      result = await brandStoreStore.addBrandStore({ ...form })
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
    const result = await brandStoreStore.deleteBrandStore(row.id)
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
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedRows.value.length} 条品牌门店数据吗？`, '提示', { type: 'warning' })
    const ids = selectedRows.value.map(row => row.id)
    const result = await brandStoreStore.batchDeleteBrandStores(ids)
    if (result.success) {
      ElMessage.success(`成功删除 ${result.count} 条数据`)
      tableRef.value?.clearSelection()
      selectedRows.value = []
      // 重置筛选条件
      searchKeyword.value = ''
      filterCity.value = ''
      filterDistrict.value = ''
      filterBrand.value = []
      filterCategory.value = ''
      brandStoreStore.setVisibleIds(null)
    } else {      ElMessage.error(result.message)
    }
  } catch {}
}

const handleLocate = (row) => {
  router.push({ path: '/', query: { lat: row.latitude, lng: row.longitude, id: row.id, type: 'brandStore' } })
}

const handleClearAll = async () => {
  try {
    const hasFilter = hasActiveFilters.value
    const targetIds = hasFilter ? filteredBrandStores.value.map(m => m.id) : null
    const count = targetIds?.length || brandStoreStore.brandStores.length
    const msg = hasFilter
      ? `将删除当前筛选条件下的 ${count} 条品牌门店数据，不可恢复！确定继续吗？`
      : `此操作将清空所有 ${count} 条品牌门店数据，不可恢复！确定继续吗？`

    await ElMessageBox.confirm(msg, '危险操作',
      { type: 'warning', confirmButtonText: '确定清空', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )

    let result
    if (hasFilter && targetIds.length > 0) {
      result = await brandStoreStore.batchDeleteBrandStores(targetIds)
    } else {
      result = await brandStoreStore.clearAllBrandStores()
    }

    if (result.success) {
      ElMessage.success(`已清除 ${result.count} 条品牌门店数据`)
      tableRef.value?.clearSelection()
      selectedRows.value = []
      if (!hasFilter) {
        searchKeyword.value = ''
        filterCity.value = ''
        filterDistrict.value = ''
        filterBrand.value = []
        filterCategory.value = ''
        brandStoreStore.setVisibleIds(null)
      }
    } else {      ElMessage.error(result.message)
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
  importProgress.value = 0
  importStatus.value = 'uploading'
  try {
    const onProgress = (event) => {
      const pct = Math.round((event.loaded / event.total) * 100)
      importProgress.value = pct
      // 上传完成后切换为"处理中"状态
      if (pct >= 100 && importStatus.value === 'uploading') {
        importStatus.value = 'processing'
      }
    }
    const result = await brandStoreStore.importBrandStores(uploadFile.value, onProgress)
    if (result.success !== false) {
      importStatus.value = 'done'
      ElMessage.success(result.message)
      setTimeout(() => { importDialogVisible.value = false }, 800)
      await brandStoreStore.fetchBrandStores()
    } else {
      importStatus.value = 'error'
      ElMessage.error(result.message)
    }
  } catch (e) {
    importStatus.value = 'error'
    ElMessage.error('导入失败: ' + (e.message || '未知错误'))
  } finally {
    importing.value = false
  }
}

const handleExport = async () => {
  const result = await brandStoreStore.exportBrandStores()
  if (result.success !== false) {
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `brand_stores_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  }
}

const downloadTemplate = () => {
  const template = `store_code,brand,name,store_category,city,district,address,description,latitude,longitude
BRAND001,某品牌,某品牌门店,商场店,北京市,朝阳区,示例地址,关注门店,39.9088,116.4610`
  const blob = new Blob([template], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'brand_store_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  console.log('🏪 BrandStoreView 已加载！')
  // 尝试从 localStorage 恢复上次的筛选条件（跨登录会话持久化）
  const restored = restoreFiltersFromLS()
  if (restored) {
    // 恢复成功后同步到 store 和 visibleIds
    brandStoreStore.setFilters({
      searchKeyword: searchKeyword.value,
      filterCity: filterCity.value,
      filterDistrict: filterDistrict.value,
      filterBrand: filterBrand.value,
      filterCategory: filterCategory.value
    })
    syncVisibleIds()
  } else {
    // 无持久化记录时保持筛选为空
    brandStoreStore.clearFilters()
  }
  await brandStoreStore.fetchBrandStores()
  console.log('✅ 门店列表加载完成')
  loadBrandStoresTable()
})

</script>

<style lang="scss" scoped>
.brand-store-view {
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
