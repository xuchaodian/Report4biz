<template>
  <div class="data-view">
    <div class="data-header">
      <h2>门店管理</h2>
      <div class="header-actions">
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>添加门店
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
        placeholder="搜索门店名称/地址"
        style="width: 200px"
        clearable
        @input="handleSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>

      <el-select v-model="filterStoreType" placeholder="按门店类型" style="width: 120px" clearable @change="handleSearch">
        <el-option label="已开业" value="已开业" />
        <el-option label="重点候选" value="重点候选" />
        <el-option label="一般候选" value="一般候选" />
      </el-select>

      <el-select v-model="filterCity" placeholder="按城市" style="width: 120px" clearable @change="handleSearch">
        <el-option v-for="city in cityList" :key="city" :label="city" :value="city" />
      </el-select>

      <el-select v-model="filterDistrict" placeholder="按区县" style="width: 120px" clearable @change="handleSearch">
        <el-option v-for="d in districtList" :key="d" :label="d" :value="d" />
      </el-select>

      <el-select v-model="filterStoreCategory" placeholder="按门店区分" style="width: 130px" clearable @change="handleSearch">
        <el-option v-for="c in categoryList" :key="c" :label="c" :value="c" />
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
        <el-table-column prop="store_code" label="编号" width="90" />
        <el-table-column prop="brand" label="品牌" width="100" />
        <el-table-column prop="name" label="门店名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="store_type" label="类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="getStoreTypeTag(row.store_type)">{{ row.store_type || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="city" label="城市" width="90" />
        <el-table-column prop="district" label="区县" width="90" />
        <el-table-column prop="area_manager" label="区域经理" width="100" show-overflow-tooltip />
        <el-table-column prop="phone1" label="电话1" width="120" />
        <el-table-column prop="store_manager" label="店长" width="80" />
        <el-table-column prop="area" label="面积" width="80" align="right">
          <template #default="{ row }">{{ row.area ? row.area + '㎡' : '-' }}</template>
        </el-table-column>
        <el-table-column prop="seats" label="座位" width="70" align="right">
          <template #default="{ row }">{{ row.seats || '-' }}</template>
        </el-table-column>
        <el-table-column prop="store_category" label="门店区分" width="100" align="center">
          <template #default="{ row }">{{ row.store_category || '-' }}</template>
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
      :title="isEdit ? '编辑门店' : '添加门店'"
      width="700px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="门店编号" prop="store_code">
              <el-input v-model="form.store_code" placeholder="如: BJ001" />
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
            <el-form-item label="门店名称" prop="name">
              <el-input v-model="form.name" placeholder="门店名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="门店类型" prop="store_type">
              <el-select v-model="form.store_type" placeholder="请选择" style="width: 100%">
                <el-option label="已开业" value="已开业" />
                <el-option label="重点候选" value="重点候选" />
                <el-option label="一般候选" value="一般候选" />
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

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="区域经理" prop="area_manager">
              <el-input v-model="form.area_manager" placeholder="区域经理姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="电话1" prop="phone1">
              <el-input v-model="form.phone1" placeholder="区域经理电话" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="店长" prop="store_manager">
              <el-input v-model="form.store_manager" placeholder="店长姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="电话2" prop="phone2">
              <el-input v-model="form.phone2" placeholder="店长电话" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="地址" prop="address">
          <el-input v-model="form.address" placeholder="详细地址" />
        </el-form-item>

        <el-divider content-position="left">经营信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="开店日期" prop="open_date">
              <el-input v-model="form.open_date" placeholder="如: 2024-01-01" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="营业时间" prop="business_hours">
              <el-input v-model="form.business_hours" placeholder="如: 08:00-22:00" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="面积(㎡)" prop="area">
              <el-input-number v-model="form.area" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="座位数" prop="seats">
              <el-input-number v-model="form.seats" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="租金(元/月)" prop="rent">
              <el-input-number v-model="form.rent" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="门店区分" prop="store_category">
              <el-select v-model="form.store_category" placeholder="请选择" style="width: 100%">
                <el-option v-for="c in markerStore.storeCategories" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="联系人" prop="contact_person">
              <el-input v-model="form.contact_person" placeholder="业主/联系人" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="联系电话" prop="contact_phone">
              <el-input v-model="form.contact_phone" placeholder="联系电话" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="经度" prop="longitude">
              <el-input-number v-model="form.longitude" :precision="6" :step="0.001" :min="-180" :max="180" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="纬度" prop="latitude">
              <el-input-number v-model="form.latitude" :precision="6" :step="0.001" :min="-90" :max="90" style="width: 100%" />
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

    <!-- 导入对话框 -->
    <el-dialog v-model="importDialogVisible" title="导入门店数据" width="500px">
      <div class="import-tips">
        <p>请上传CSV格式文件，支持以下字段：</p>
        <ul>
          <li>store_code - 门店编号</li>
          <li>brand - 品牌</li>
          <li>name - 门店名称（必填）</li>
          <li>store_type - 门店类型（已开业/重点候选/一般候选）</li>
          <li>city - 城市</li>
          <li>district - 区县</li>
          <li>area_manager - 区域经理</li>
          <li>phone1 - 电话1</li>
          <li>store_manager - 店长</li>
          <li>phone2 - 电话2</li>
          <li>address - 地址</li>
          <li>latitude - 纬度（必填）</li>
          <li>longitude - 经度（必填）</li>
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
const filterStoreType = ref('')
const filterCity = ref('')
const filterDistrict = ref('')
const filterStoreCategory = ref('')
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
  store_code: '',
  brand: '',
  name: '',
  store_type: '',
  city: '',
  district: '',
  area_manager: '',
  phone1: '',
  store_manager: '',
  phone2: '',
  address: '',
  open_date: '',
  business_hours: '',
  area: null,
  seats: null,
  rent: null,
  store_category: '',
  contact_person: '',
  contact_phone: '',
  description: '',
  latitude: 39.9042,
  longitude: 116.4074
})

const rules = {
  name: [{ required: true, message: '请输入门店名称', trigger: 'blur' }],
  latitude: [{ required: true, message: '请输入纬度', trigger: 'blur' }],
  longitude: [{ required: true, message: '请输入经度', trigger: 'blur' }]
}

// 城市列表
const cityList = computed(() => {
  const cities = [...new Set(markerStore.markers.map(m => m.city).filter(Boolean))]
  return cities.sort()
})

// 区县列表
const districtList = computed(() => {
  const districts = [...new Set(markerStore.markers.map(m => m.district).filter(Boolean))]
  return districts.sort()
})

// 门店区分列表
const categoryList = computed(() => {
  const categories = [...new Set(markerStore.markers.map(m => m.store_category).filter(Boolean))]
  return categories.sort()
})

// 筛选后的数据
const filteredMarkers = computed(() => {
  return markerStore.markers.filter(marker => {
    const matchKeyword = !searchKeyword.value ||
      marker.name.toLowerCase().includes(searchKeyword.value.toLowerCase()) ||
      (marker.address && marker.address.toLowerCase().includes(searchKeyword.value.toLowerCase())) ||
      (marker.store_code && marker.store_code.toLowerCase().includes(searchKeyword.value.toLowerCase()))
    const matchType = !filterStoreType.value || marker.store_type === filterStoreType.value
    const matchCity = !filterCity.value || marker.city === filterCity.value
    const matchDistrict = !filterDistrict.value || marker.district === filterDistrict.value
    const matchCategory = !filterStoreCategory.value || marker.store_category === filterStoreCategory.value
    return matchKeyword && matchType && matchCity && matchDistrict && matchCategory
  })
})

// 分页数据
const paginatedMarkers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredMarkers.value.slice(start, end)
})

// 门店类型标签
const getStoreTypeTag = (type) => {
  const typeMap = {
    '已开业': 'success',
    '重点候选': 'warning',
    '一般候选': 'info'
  }
  return typeMap[type] || ''
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
    store_code: '',
    brand: '',
    name: '',
    store_type: '已开业',
    city: '',
    district: '',
    area_manager: '',
    phone1: '',
    store_manager: '',
    phone2: '',
    address: '',
    open_date: '',
    business_hours: '',
    area: null,
    seats: null,
    rent: null,
    store_category: '',
    contact_person: '',
    contact_phone: '',
    description: '',
    latitude: 39.9042,
    longitude: 116.4074
  })
  dialogVisible.value = true
}

// 编辑
const handleEdit = (row) => {
  isEdit.value = true
  editingId.value = row.id
  Object.assign(form, {
    store_code: row.store_code || '',
    brand: row.brand || '',
    name: row.name,
    store_type: row.store_type || '',
    city: row.city || '',
    district: row.district || '',
    area_manager: row.area_manager || '',
    phone1: row.phone1 || '',
    store_manager: row.store_manager || '',
    phone2: row.phone2 || '',
    address: row.address || '',
    open_date: row.open_date || '',
    business_hours: row.business_hours || '',
    area: row.area || null,
    seats: row.seats || null,
    rent: row.rent || null,
    store_category: row.store_category || '',
    contact_person: row.contact_person || '',
    contact_phone: row.contact_phone || '',
    description: row.description || '',
    latitude: row.latitude,
    longitude: row.longitude
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
    await ElMessageBox.confirm(`确定要删除门店「${row.name}」吗？`, '提示', {
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
    a.download = `stores_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  }
}

// 下载模板
const downloadTemplate = () => {
  const template = `store_code,brand,name,store_type,city,district,area_manager,phone1,store_manager,phone2,address,open_date,business_hours,area,seats,rent,store_category,contact_person,contact_phone,latitude,longitude,description
BJ001,星巴克,星巴克国贸店,已开业,北京市,朝阳区,李明,13800138001,王芳,13800138002,国贸大厦一层,2023-01-15,07:00-22:00,200,80,50000,直营,张总,13900139001,39.9088,116.4610,CBD核心区
BJ002,星巴克,星巴克望京候选,重点候选,北京市,朝阳区,李明,13800138001,,,,,180,70,42000,加盟,陈总,13900139003,39.9965,116.4710,重点跟进`
  const blob = new Blob([template], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'store_template.csv'
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
  padding: 15px;
  background: #f5f7fa;
  border-radius: 4px;

  p {
    margin: 0 0 10px 0;
    font-weight: bold;
  }

  ul {
    margin: 0;
    padding-left: 20px;
    font-size: 13px;
    color: #666;
  }
}
</style>
