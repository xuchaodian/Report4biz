<template>
  <div class="competitor-view">
    <el-tabs v-model="activeTab" class="competitor-tabs" @tab-change="handleTabChange">
      <!-- ================= Tab1 竞品列表（手工管理 + 最新期镜像） ================= -->
      <el-tab-pane label="竞品列表" name="list">
        <div class="data-header">
          <h2>竞品管理</h2>
          <div class="header-actions">
            <el-button type="primary" @click="showAddDialog">
              <el-icon><Plus /></el-icon>添加竞品
            </el-button>
            <el-button type="warning" plain @click="goToUpload">
              <el-icon><Upload /></el-icon>期次上传
            </el-button>
            <el-button @click="handleExport">
              <el-icon><Download /></el-icon>导出
            </el-button>
            <el-button
              v-if="selectedRows.length > 0"
              type="danger"
              @click="handleBatchDelete"
            >
              <el-icon><Delete /></el-icon>批量删除({{ selectedRows.length }})
            </el-button>
            <el-button type="danger" plain @click="handleClearAll">
              <el-icon><Delete /></el-icon>全清除
            </el-button>
          </div>
        </div>

    <!-- 筛选栏 -->
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

      <el-select v-model="filterTradingArea" placeholder="按商圈" style="width: 150px" clearable @change="handleSearch">
        <el-option v-for="a in tradingAreaList" :key="a" :label="a" :value="a" />
      </el-select>

      <el-select v-model="filterBrand" placeholder="按品牌" style="width: 200px" multiple collapse-tags collapse-tags-tooltip clearable @change="handleSearch">
        <el-option v-for="b in brandList" :key="b" :label="b" :value="b" />
      </el-select>

      <el-select v-model="filterCategory" placeholder="按分类" style="width: 140px" clearable @change="handleSearch">
        <el-option v-for="c in categoryList" :key="c" :label="c" :value="c" />
      </el-select>

      <el-input-number v-model="filterMinStars" :min="1" :max="5" :step="1" placeholder="最低星级" style="width: 110px" controls-position="right" @change="handleSearch" />
      <el-input-number v-model="filterMinReviews" :min="1" :step="10" placeholder="最少评论" style="width: 120px" controls-position="right" @change="handleSearch" />

      <span class="统计">共 {{ filteredCompetitors.length }} 条数据</span>
      <el-button v-if="hasActiveFilters" type="warning" plain @click="handleClearFilters">
        <el-icon><Close /></el-icon>清除筛选
      </el-button>
    </div>

    <!-- 数据表格 -->
    <div class="data-table">
      <el-table
        ref="tableRef"
        :data="paginatedCompetitors"
        v-loading="competitorStore.loading"
        border
        stripe
        row-key="id"
        style="width: 100%"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="45" reserve-selection />
        <el-table-column prop="brand" label="品牌" width="120">
          <template #default="{ row }">
            {{ row.brand }}
          </template>
        </el-table-column>
        <el-table-column prop="name" label="门店名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="store_category" label="门店分类" width="120" />
        <el-table-column prop="city" label="城市" width="90" />
        <el-table-column prop="district" label="区县" width="90" />
        <el-table-column prop="address" label="地址" min-width="150" show-overflow-tooltip />
        <el-table-column prop="trading_area" label="商圈" width="120" show-overflow-tooltip />
        <el-table-column prop="price" label="价格" width="80">
          <template #default="{ row }">
            <span>{{ row.price ? '¥' + row.price : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="rating" label="星级" width="70">
          <template #default="{ row }">
            <span>{{ row.rating ? row.rating + '⭐' : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="reviews" label="评论数" width="85">
          <template #default="{ row }">
            <span>{{ row.reviews ? row.reviews.toLocaleString() : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="taste_score" label="口味" width="65">
          <template #default="{ row }">
            <span>{{ row.taste_score ? row.taste_score : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="environment_score" label="环境" width="65">
          <template #default="{ row }">
            <span>{{ row.environment_score ? row.environment_score : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="service_score" label="服务" width="65">
          <template #default="{ row }">
            <span>{{ row.service_score ? row.service_score : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
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
        :total="filteredCompetitors.length"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
      />
    </div>
      </el-tab-pane>

      <!-- ================= Tab2 期次上传 ================= -->
      <el-tab-pane label="期次上传" name="upload">
        <SnapshotUploadPanel
          ref="uploadPanelRef"
          @imported="handleSnapshotImported"
          @goto-monitor="gotoMonitor"
        />
      </el-tab-pane>

      <!-- ================= Tab3 开关店监测 ================= -->
      <el-tab-pane label="开关店监测" name="monitor">
        <SnapshotMonitorPanel
          ref="monitorPanelRef"
          :initial-brand="monitorBrand"
          :initial-target="monitorTarget"
          @goto-upload="activeTab = 'upload'"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- 添加/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑竞品' : '添加竞品'"
      width="680px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="编号" prop="store_code">
              <el-input v-model="form.store_code" placeholder="如: COMP001" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="品牌" prop="brand">
              <el-input v-model="form.brand" placeholder="竞品品牌名称" />
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
                <el-option v-for="s in competitorStore.statuses" :key="s" :label="s" :value="s" />
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

        <el-divider content-position="left">评分信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="商圈" prop="trading_area">
              <el-input v-model="form.trading_area" placeholder="如: 人民广场商圈/徐家汇商圈" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="价格(元)" prop="price">
              <el-input-number v-model="form.price" :min="0" :max="99999" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="星级" prop="rating">
              <el-input-number v-model="form.rating" :min="0" :max="5" :step="0.1" :precision="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="评论数" prop="reviews">
              <el-input-number v-model="form.reviews" :min="0" :max="999999" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="口味" prop="taste_score">
              <el-input-number v-model="form.taste_score" :min="0" :max="5" :step="0.1" :precision="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="环境" prop="environment_score">
              <el-input-number v-model="form.environment_score" :min="0" :max="5" :step="0.1" :precision="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="服务" prop="service_score">
              <el-input-number v-model="form.service_score" :min="0" :max="5" :step="0.1" :precision="1" style="width: 100%" />
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Download, Search, Edit, Delete, Location, Close } from '@element-plus/icons-vue'
import { useCompetitorStore } from '@/stores/competitor'
import SnapshotUploadPanel from '@/components/competitor/SnapshotUploadPanel.vue'
import SnapshotMonitorPanel from '@/components/competitor/SnapshotMonitorPanel.vue'

const router = useRouter()
const competitorStore = useCompetitorStore()

// 门店分类选项
const storeCategoryOptions = ['社区店', '临街店', '商场店', '写字楼店', '交通枢纽店', '校园店', '景区店', '专业市场店']

// 筛选和分页 - 使用 store 中的筛选条件（持久化）
// 使用 ref 包装 store 中的 filters，确保响应式
const searchKeyword = ref('')
const filterCity = ref('')
const filterDistrict = ref('')
const filterTradingArea = ref('')
const filterBrand = ref([])
const filterCategory = ref('')
const filterMinStars = ref(null)
const filterMinReviews = ref(null)
const currentPage = ref(1)
const pageSize = ref(20)

// localStorage 持久化（按用户隔离，userId 从 localStorage 读取保证跨刷新稳定）
const LS_KEY = () => `competitorFilters_${localStorage.getItem('userId') || 'anon'}`
const SAVE_FIELDS = () => ({
  searchKeyword: searchKeyword.value,
  filterCity: filterCity.value,
  filterDistrict: filterDistrict.value,
  filterTradingArea: filterTradingArea.value,
  filterBrand: filterBrand.value,
  filterCategory: filterCategory.value,
  filterMinStars: filterMinStars.value,
  filterMinReviews: filterMinReviews.value,
  currentPage: currentPage.value
})
const saveFiltersToLS = () => localStorage.setItem(LS_KEY(), JSON.stringify(SAVE_FIELDS()))

const restoreFiltersFromLS = () => {
  const saved = localStorage.getItem(LS_KEY())
  if (!saved) return false
  try {
    const f = JSON.parse(saved)
    searchKeyword.value = f.searchKeyword || ''
    filterCity.value = f.filterCity || ''
    filterDistrict.value = f.filterDistrict || ''
    filterTradingArea.value = f.filterTradingArea || ''
    filterBrand.value = Array.isArray(f.filterBrand) ? f.filterBrand : (f.filterBrand ? [f.filterBrand] : [])
    filterCategory.value = f.filterCategory || ''
    filterMinStars.value = f.filterMinStars ?? null
    filterMinReviews.value = f.filterMinReviews ?? null
    currentPage.value = f.currentPage || 1
    return true
  } catch { return false }
}

const clearFiltersFromLS = () => localStorage.removeItem(LS_KEY())

// 监听 store 中 filters 的外部变化（如其他页面同步过来的筛选条件）
watch(() => competitorStore.filters, (newFilters) => {
  searchKeyword.value = newFilters.searchKeyword
  filterCity.value = newFilters.filterCity
  filterDistrict.value = newFilters.filterDistrict
  filterTradingArea.value = newFilters.filterTradingArea || ''
  filterBrand.value = Array.isArray(newFilters.filterBrand) ? newFilters.filterBrand : (newFilters.filterBrand ? [newFilters.filterBrand] : [])
  filterCategory.value = newFilters.filterCategory
}, { deep: true })

// 同步筛选条件到 store + localStorage（持久化）
const syncFiltersToStore = () => {
  competitorStore.setFilters({
    searchKeyword: searchKeyword.value,
    filterCity: filterCity.value,
    filterDistrict: filterDistrict.value,
    filterTradingArea: filterTradingArea.value,
    filterBrand: filterBrand.value,
    filterCategory: filterCategory.value
  })
  saveFiltersToLS()
}

// 组件挂载时从 store 恢复筛选条件
onMounted(() => {
  competitorStore.fetchCompetitors()
  // 优先从 localStorage 恢复（跨登录会话），其次是 store 内存
  const restored = restoreFiltersFromLS()
  if (restored) {
    competitorStore.setFilters({
      searchKeyword: searchKeyword.value,
      filterCity: filterCity.value,
      filterDistrict: filterDistrict.value,
      filterTradingArea: filterTradingArea.value,
      filterBrand: filterBrand.value,
      filterCategory: filterCategory.value
    })
  } else {
    // 从 store 恢复筛选条件
    searchKeyword.value = competitorStore.filters.searchKeyword
    filterCity.value = competitorStore.filters.filterCity
    filterDistrict.value = competitorStore.filters.filterDistrict
    filterTradingArea.value = competitorStore.filters.filterTradingArea || ''
    filterBrand.value = Array.isArray(competitorStore.filters.filterBrand)
      ? competitorStore.filters.filterBrand
      : (competitorStore.filters.filterBrand ? [competitorStore.filters.filterBrand] : [])
    filterCategory.value = competitorStore.filters.filterCategory
  }
})

// 是否有激活的筛选条件
const hasActiveFilters = computed(() => {
  return searchKeyword.value || filterCity.value || filterDistrict.value || filterTradingArea.value || filterBrand.value.length || filterCategory.value || filterMinStars.value !== null || filterMinReviews.value !== null
})

// 品牌颜色映射
const brandColorMap = {
  '大米先生': '#e6a23c',
  '谷田稻香': '#f56c6c',
  '吉野家': '#409eff',
  '老乡鸡': '#67c23a',
  '米村拌饭': '#9c27b0'
}

// 弹窗状态
const dialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const editingId = ref(null)
const tableRef = ref(null)
const selectedRows = ref([])

// Tab 结构：list=竞品列表 / upload=期次上传 / monitor=开关店监测
const activeTab = ref('list')
const uploadPanelRef = ref(null)
const monitorPanelRef = ref(null)
// 从「期次上传」跳转到「开关店监测」时携带的品牌与目标期
const monitorBrand = ref('')
const monitorTarget = ref('')

// 表单数据
const formRef = ref(null)
const form = reactive({
  store_code: '',
  brand: '',
  name: '',
  store_category: '',
  status: '正常',
  city: '',
  district: '',
  address: '',
  description: '',
  latitude: 39.9042,
  longitude: 116.4074,
  trading_area: '',
  price: 0,
  rating: 0,
  reviews: 0,
  taste_score: 0,
  environment_score: 0,
  service_score: 0
})

const rules = {
  name: [{ required: true, message: '请输入门店名称', trigger: 'blur' }],
  latitude: [{ required: true, message: '请输入纬度', trigger: 'blur' }],
  longitude: [{ required: true, message: '请输入经度', trigger: 'blur' }]
}

// 城市列表
const cityList = computed(() => {
  return [...new Set(competitorStore.competitors.map(c => c.city).filter(Boolean))].sort()
})

// 区县列表（联动城市）
const districtList = computed(() => {
  const city = filterCity.value
  return [...new Set(competitorStore.competitors.filter(c => !city || c.city === city).map(c => c.district).filter(Boolean))].sort()
})

// 商圈列表（联动城市+区县：城市→区县→商圈 三级收窄）
const tradingAreaList = computed(() => {
  const city = filterCity.value
  const district = filterDistrict.value
  return [...new Set(competitorStore.competitors
    .filter(c => (!city || c.city === city) && (!district || c.district === district))
    .map(c => c.trading_area).filter(Boolean))].sort()
})

// 城市切换时清空区县；商圈不在新城市范围时一并清空
watch(filterCity, (newCity) => {
  if (newCity && filterDistrict.value) {
    const districts = [...new Set(competitorStore.competitors.filter(c => c.city === newCity).map(c => c.district).filter(Boolean))]
    if (!districts.includes(filterDistrict.value)) filterDistrict.value = ''
  }
  if (filterTradingArea.value) {
    const areas = tradingAreaList.value
    if (!areas.includes(filterTradingArea.value)) filterTradingArea.value = ''
  }
})

// 区县切换时清空不在该区县内的商圈
watch(filterDistrict, (newDistrict) => {
  if (filterTradingArea.value) {
    const areas = tradingAreaList.value
    if (!areas.includes(filterTradingArea.value)) filterTradingArea.value = ''
  }
})

// 品牌列表
const brandList = computed(() => {
  return [...new Set(competitorStore.competitors.map(c => c.brand).filter(Boolean))].sort()
})

// 分类列表
const categoryList = computed(() => {
  return [...new Set(competitorStore.competitors.map(c => c.store_category).filter(Boolean))].sort()
})

// 筛选后的数据
const filteredCompetitors = computed(() => {
  return competitorStore.competitors.filter(comp => {
    const matchKeyword = !searchKeyword.value ||
      comp.name.toLowerCase().includes(searchKeyword.value.toLowerCase()) ||
      (comp.address && comp.address.toLowerCase().includes(searchKeyword.value.toLowerCase())) ||
      (comp.store_code && comp.store_code.toLowerCase().includes(searchKeyword.value.toLowerCase())) ||
      (comp.brand && comp.brand.toLowerCase().includes(searchKeyword.value.toLowerCase()))
    const matchCity = !filterCity.value || comp.city === filterCity.value
    const matchDistrict = !filterDistrict.value || comp.district === filterDistrict.value
    const matchTradingArea = !filterTradingArea.value || (comp.trading_area && comp.trading_area === filterTradingArea.value)
    const matchBrand = !filterBrand.value.length || filterBrand.value.includes(comp.brand)
    const matchCategory = !filterCategory.value || comp.store_category === filterCategory.value
    const matchStars = !filterMinStars.value || (comp.rating && comp.rating >= filterMinStars.value)
    const matchReviews = !filterMinReviews.value || (comp.reviews && comp.reviews >= filterMinReviews.value)
    return matchKeyword && matchCity && matchDistrict && matchTradingArea && matchBrand && matchCategory && matchStars && matchReviews
  })
})

// 分页数据
const paginatedCompetitors = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredCompetitors.value.slice(start, end)
})

const handleSearch = () => {
  currentPage.value = 1
  // 同步筛选条件到 store（持久化）
  syncFiltersToStore()
  // 计算可见ID
  syncVisibleIds()
}

const syncVisibleIds = () => {
  const hasFilter = searchKeyword.value || filterCity.value || filterDistrict.value ||
    filterBrand.value.length || filterCategory.value
  if (!hasFilter) {
    competitorStore.setVisibleIds(null)
  } else {
    competitorStore.setVisibleIds(filteredCompetitors.value.map(c => c.id))
  }
}

// 清除筛选条件
const handleClearFilters = () => {
  searchKeyword.value = ''
  filterCity.value = ''
  filterDistrict.value = ''
  filterTradingArea.value = ''
  filterBrand.value = []
  filterCategory.value = ''
  filterMinStars.value = null
  filterMinReviews.value = null
  competitorStore.clearFilters()
  clearFiltersFromLS()
  currentPage.value = 1
}

const showAddDialog = () => {
  isEdit.value = false
  editingId.value = null
  Object.assign(form, {
    store_code: '', brand: '', name: '', store_category: '',
    status: '正常', city: '', district: '', address: '',
    description: '', latitude: 39.9042, longitude: 116.4074,
    trading_area: '', price: 0, rating: 0, reviews: 0,
    taste_score: 0, environment_score: 0, service_score: 0
  })
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  editingId.value = row.id
  Object.assign(form, {
    store_code: row.store_code || '',
    brand: row.brand || '',
    name: row.name,
    store_category: row.store_category || '',
    status: row.status || '正常',
    city: row.city || '',
    district: row.district || '',
    address: row.address || '',
    description: row.description || '',
    latitude: row.latitude,
    longitude: row.longitude,
    trading_area: row.trading_area || '',
    price: row.price || 0,
    rating: row.rating || 0,
    reviews: row.reviews || 0,
    taste_score: row.taste_score || 0,
    environment_score: row.environment_score || 0,
    service_score: row.service_score || 0
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
      result = await competitorStore.updateCompetitor(editingId.value, { ...form })
    } else {
      result = await competitorStore.addCompetitor({ ...form })
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

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要删除「${row.name}」吗？`, '提示', { type: 'warning' })
    const result = await competitorStore.deleteCompetitor(row.id)
    if (result.success) {
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
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedRows.value.length} 条竞品数据吗？`, '提示', { type: 'warning' })
    const ids = selectedRows.value.map(row => row.id)
    const result = await competitorStore.batchDeleteCompetitors(ids)
    if (result.success) {
      ElMessage.success(`成功删除 ${result.count} 条数据`)
      tableRef.value?.clearSelection()
      selectedRows.value = []
      // 重置筛选条件
      competitorStore.clearFilters()
    } else {
      ElMessage.error(result.message)
    }
  } catch {}
}

const handleLocate = (row) => {
  router.push({ path: '/', query: { lat: row.latitude, lng: row.longitude, id: row.id, type: 'competitor' } })
}

const handleClearAll = async () => {
  try {
    await ElMessageBox.confirm(
      '此操作将清空所有竞品门店数据，不可恢复！确定继续吗？',
      '危险操作',
      { type: 'warning', confirmButtonText: '确定清空', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
    const result = await competitorStore.clearAllCompetitors()
    if (result.success) {
      ElMessage.success(`已清空 ${result.count} 条竞品数据`)
      tableRef.value?.clearSelection()
      selectedRows.value = []
      // 重置筛选条件
      competitorStore.clearFilters()
    } else {
      ElMessage.error(result.message)
    }
  } catch {}
}

/* ================= Tab 切换与跨 Tab 联动 ================= */
// 竞品列表头部「期次上传」按钮 → 切到 Tab2
const goToUpload = () => { activeTab.value = 'upload' }
const handleTabChange = (name) => {
  // 进入「期次上传」时刷新历史（导入后可能新增期次）
  if (name === 'upload') uploadPanelRef.value?.refreshHistory()
  // 「开关店监测」内容常驻，保留用户当前选择，无需每次重载
}
// Tab2 导入成功后：刷新列表镜像（UploadPanel 已提示详情，这里静默同步）
const handleSnapshotImported = async (payload) => {
  await competitorStore.fetchCompetitors()
  // 列表已被新镜像替换 → 清掉本地筛选态，避免残留条件看不到新数据
  handleClearFilters()
}
// Tab2「去对比」→ Tab3 并预选品牌/目标期
const gotoMonitor = (payload) => {
  monitorBrand.value = payload?.brand || ''
  monitorTarget.value = payload?.period || ''
  activeTab.value = 'monitor'
  // 等 Tab3 渲染完成后再驱动对比（组件可能尚未挂载）
  setTimeout(() => {
    if (monitorBrand.value) monitorPanelRef.value?.setComparison(monitorBrand.value, monitorTarget.value)
  }, 120)
}

const handleExport = async () => {
  const result = await competitorStore.exportCompetitors()
  if (result.success) {
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `competitors_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  }
}
</script>

<style lang="scss" scoped>
.competitor-view {
  height: 100%;
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}
// el-tabs 占满剩余高度，内容区内部滚动（MainLayout main-content 为 overflow:hidden）
.competitor-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  :deep(.el-tabs__header) { margin-bottom: 12px; }
  :deep(.el-tabs__content) {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
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
  background: white;
  border-radius: 8px;
  padding: 15px;
}
.pagination-container {
  margin-top: 15px;
  display: flex;
  justify-content: flex-end;
}
</style>
