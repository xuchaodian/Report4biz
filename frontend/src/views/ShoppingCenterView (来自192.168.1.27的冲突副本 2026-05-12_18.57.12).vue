<template>
  <div class="shopping-center-view">
    <div class="data-header">
      <h2>购物中心</h2>
      <div class="header-actions">
        <el-button type="success" @click="openShoppingCenterCompare">
          <el-icon><DataAnalysis /></el-icon>常住人口对比
        </el-button>
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

    <!-- 人口对比对话框 -->
    <el-dialog v-model="compareVisible" title="商场常住人口对比" width="900px" draggable :show-close="true">
      <div v-if="compareStep === 1">
        <el-form label-width="100px" style="margin-bottom: 16px;">
          <el-form-item label="分析半径">
            <el-input-number v-model="compareRadius" :min="0.5" :max="10" :step="0.5" />
            <span style="margin-left: 8px;">公里</span>
          </el-form-item>
        </el-form>
        <el-alert type="info" :closable="false" style="margin-bottom: 12px">
          <template #title>请选择 2-5 家购物中心进行人口对比分析</template>
        </el-alert>
        <div style="display: flex; gap: 16px; margin-bottom: 16px;">
          <el-input v-model="compareSearchKeyword" placeholder="输入购物中心名称搜索" style="width: 300px;" clearable>
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
        </div>
        <div v-show="compareSelectedList.length > 0" style="margin-bottom: 12px;">
          <div style="font-size: 12px; color: #666; margin-bottom: 6px;">已选择 ({{ compareSelectedList.length }}/5)：</div>
          <el-tag v-for="s in compareSelectedList" :key="s.id" closable @close="removeCompareItem(s)" style="margin-right: 8px; margin-bottom: 4px;">
            {{ s.name }}
          </el-tag>
        </div>
        <div style="max-height: 280px; overflow-y: auto; border: 1px solid #ebeef5; border-radius: 4px;">
          <div v-for="item in filteredCompareList" :key="item.id"
            style="display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid #ebeef5; cursor: pointer;"
            :style="{ background: compareSelectedList.some(s => s.id === item.id) ? '#ecf5ff' : 'white' }"
            @click="toggleCompareItem(item)">
            <el-button :type="compareSelectedList.some(s => s.id === item.id) ? 'primary' : 'default'" size="small" style="margin-right: 12px;" @click.stop="toggleCompareItem(item)">
              {{ compareSelectedList.some(s => s.id === item.id) ? '已选' : '选择' }}
            </el-button>
            <div style="flex: 1;">
              <div style="font-weight: 500;">{{ item.name }}</div>
              <div style="font-size: 12px; color: #999;">{{ item.city }} {{ item.district }} | {{ item.store_category || '-' }}</div>
            </div>
          </div>
        </div>
        <div style="margin-top: 8px; font-size: 12px; color: #999;">共 {{ filteredCompareList.length }} 家购物中心</div>
      </div>

      <div v-if="compareStep === 2" style="max-height: 600px; overflow-y: auto;">
        <div v-if="compareResults.length === 2" style="display: flex; gap: 16px; margin-bottom: 16px;">
          <div style="flex: 1;">
            <el-table :data="compareTableData" border stripe size="small" max-height="400">
              <el-table-column prop="field" label="字段" width="120" fixed />
              <el-table-column v-for="(r, idx) in compareResults" :key="r.id" :label="r.name" align="right">
                <template #default="{ row }">
                  <span :style="{ color: row.maxIndex === idx ? '#f56c6c' : '#333', fontWeight: row.maxIndex === idx ? 'bold' : 'normal' }">
                    {{ row.values[idx] }}
                  </span>
                  <span v-if="row.diffs[idx]" style="color: #909399; font-size: 11px; margin-left: 4px;">{{ row.diffs[idx] }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <div style="width: 450px; height: 400px;" ref="chartRef"></div>
        </div>
        <div v-else style="margin-bottom: 16px;">
          <div style="display: flex; gap: 16px;">
            <div style="flex: 1;">
              <el-table :data="compareTableData" border stripe size="small" max-height="400">
                <el-table-column prop="field" label="字段" width="120" fixed />
                <el-table-column v-for="(r, idx) in compareResults" :key="r.id" :label="r.name" align="center">
                  <template #default="{ row }">
                    <div :style="getHeatmapCellStyle(row.nums, idx)" style="padding: 4px 8px; border-radius: 4px; font-weight: 500;">
                      {{ row.values[idx] }}
                    </div>
                  </template>
                </el-table-column>
              </el-table>
            </div>
            <div style="width: 120px; padding: 20px 10px;">
              <div style="font-size: 12px; color: #666; margin-bottom: 8px; text-align: center;">数值大小</div>
              <div style="width: 100%; height: 200px; border-radius: 4px; overflow: hidden; background: linear-gradient(to bottom, #d7191c, #fdae61, #ffffbf, #abdda4, #2b83f6);"></div>
              <div style="display: flex; justify-content: space-between; font-size: 11px; color: #666; margin-top: 4px;"><span>高</span><span>低</span></div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="compareVisible = false">关闭</el-button>
        <el-button v-if="compareStep === 1" type="primary" :disabled="compareSelectedList.length < 2" :loading="compareLoading" @click="startCompare">开始分析</el-button>
        <el-button v-if="compareStep === 2" @click="compareStep = 1">重新选择</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Download, Search, Edit, Delete, Location, Close, DataAnalysis, WarningFilled } from '@element-plus/icons-vue'
import { useShoppingCenterStore } from '@/stores/shoppingCenterStore'
import { useUserStore } from '@/stores/user'
import { formatNumber } from '@/utils/populationStats'
import * as echarts from 'echarts'

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
  uploadRef.value?.clearFiles()
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

// ===== 商场常住人口对比 =====
const compareVisible = ref(false)
const compareStep = ref(1)
const compareSearchKeyword = ref('')
const compareRadius = ref(2)
const compareLoading = ref(false)
const compareResults = ref([])
const compareTableData = ref([])
const chartRef = ref(null)
let compareChart = null
const compareSelectedList = ref([])

const filteredCompareList = computed(() => {
  const kw = compareSearchKeyword.value.toLowerCase()
  const selectedIds = new Set(compareSelectedList.value.map(s => s.id))
  const result = [...compareSelectedList.value]
  store.shoppingCenters.forEach(m => {
    if (!selectedIds.has(m.id)) {
      if (!kw || m.name?.toLowerCase().includes(kw) || m.brand?.toLowerCase().includes(kw)) {
        result.push(m)
      }
    }
  })
  return result
})

const removeCompareItem = (item) => {
  compareSelectedList.value = compareSelectedList.value.filter(s => s.id !== item.id)
}

const toggleCompareItem = (item) => {
  const idx = compareSelectedList.value.findIndex(s => s.id === item.id)
  if (idx >= 0) {
    compareSelectedList.value = compareSelectedList.value.filter((_, i) => i !== idx)
  } else if (compareSelectedList.value.length < 5) {
    compareSelectedList.value = [...compareSelectedList.value, { ...item }]
  }
}

const openShoppingCenterCompare = () => {
  compareStep.value = 1
  compareSearchKeyword.value = ''
  compareRadius.value = 2
  compareSelectedList.value = []
  compareResults.value = []
  compareTableData.value = []
  compareVisible.value = true
}

const startCompare = async () => {
  if (compareSelectedList.value.length < 2) {
    ElMessage.warning('请至少选择2家购物中心')
    return
  }
  const items = [...compareSelectedList.value]
  compareLoading.value = true
  compareResults.value = []
  compareTableData.value = []

  try {
    const userId = localStorage.getItem('userId') || 1
    const listRes = await fetch(`/api/shapefiles`, { headers: { 'x-user-id': userId } })
    const listData = await listRes.json()
    const shapefiles = Array.isArray(listData) ? listData : (listData.data || [])

    if (shapefiles.length === 0) {
      ElMessage.warning('没有找到上传的shp数据文件')
      compareLoading.value = false
      return
    }

    const radiusMeters = compareRadius.value * 1000
    const results = []

    for (const item of items) {
      const lat = item.latitude
      const lng = item.longitude
      if (!lat || !lng) { ElMessage.warning(`"${item.name}" 缺少坐标`); continue }

      // === 从 MapView 复制城市提取 + shapefile 匹配逻辑 ===
      const extractCityFromStore = (s) => {
        if (s.city && s.city.trim()) return s.city.trim()
        const cityMatch = s.name?.match(/^([\u4e00-\u9fa5]+)/)
        if (cityMatch) return cityMatch[1]
        return null
      }
      const findShapefileForCity = (cityName, allSf) => {
        if (!cityName) return allSf[0]
        let matched = allSf.find(sf => sf.city === cityName)
        if (matched) return matched
        matched = allSf.find(sf =>
          (sf.city && sf.city.includes(cityName)) || (cityName.includes(sf.city))
        )
        if (matched) return matched
        console.warn(`未找到城市[${cityName}]对应的shapefile，使用第一个: ${allSf[0].name}`)
        return allSf[0]
      }

      const storeCity = extractCityFromStore(item)
      const targetSf = findShapefileForCity(storeCity, shapefiles)

      const sfRes = await fetch(`/api/shapefiles/${targetSf.id}`, { headers: { 'x-user-id': userId } })
      const sfData = await sfRes.json()
      const geojson = sfData.data?.geojson || sfData.geojson

      let statField = null
      if (geojson?.features?.length > 0) {
        const props = geojson.features[0].properties || {}
        for (const [key, val] of Object.entries(props)) {
          if (key !== 'RecID') {
            const numVal = Number(val)
            if (!isNaN(numVal) && Number.isInteger(numVal)) { statField = key; break }
          }
        }
      }

      if (!statField) { ElMessage.warning(`"${item.name}" 对应的数据文件未找到有效统计字段`); continue }

      const res = await fetch('/api/shapefiles/calculate-population', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ lat, lng, radius: radiusMeters, fieldName: statField, city: targetSf.city })
      })
      if (!res.ok) throw new Error(`API错误: ${res.status}`)
      const apiResult = await res.json()
      console.log(`[人口对比] ${item.name}: total=${apiResult.data.total}, count=${apiResult.data.count}, fields=${Object.keys(apiResult.data.allFields || {})}`)
      results.push({
        ...item, city: storeCity, shapefileName: targetSf.name,
        total: apiResult.data.total, statField,
        allFields: apiResult.data.allFields
      })
    }

    if (results.length < 2) { ElMessage.warning('有效购物中心数量不足'); compareLoading.value = false; return }

    compareResults.value = results
    const primaryField = results[0].statField
    const excludeFields = ['RecID', 'recid', 'FID', 'fid', 'id', 'ID', 'OBJECTID', 'Shape_Area', 'Shape_Length']
    const fieldNames = [primaryField, ...Object.keys(results[0].allFields || {}).filter(k => k !== primaryField && !excludeFields.includes(k))]

    compareTableData.value = fieldNames.map(field => {
      const values = results.map(r => field === r.statField ? formatNumber(r.total) : formatNumber(r.allFields?.[field] || 0))
      const nums = results.map(r => field === r.statField ? r.total : (r.allFields?.[field] || 0))
      const maxVal = Math.max(...nums)
      const maxIndex = nums.indexOf(maxVal)
      const diffs = nums.map((v, i) => i === maxIndex ? '' : '-' + formatNumber(Math.abs(v - maxVal)))
      return { field, values, nums, maxIndex, diffs }
    })

    compareStep.value = 2
    if (results.length === 2) { await nextTick(); renderCompareChart() }

  } catch (e) {
    console.error('人口对比分析失败:', e)
    ElMessage.error('分析失败：' + e.message)
  } finally {
    compareLoading.value = false
  }
}

const renderCompareChart = () => {
  if (!chartRef.value || compareResults.value.length !== 2) return
  if (compareChart) compareChart.dispose()
  compareChart = echarts.init(chartRef.value)
  const [r1, r2] = compareResults.value
  const uniqueFields = [...new Set(compareResults.value.flatMap(r => [r.statField, ...Object.keys(r.allFields || {})]))].filter(f => f !== 'RecID')

  compareChart.setOption({
    title: { text: `${r1.name} vs ${r2.name}`, left: 'center', textStyle: { fontSize: 14, fontWeight: 'bold' } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => { let r = `<b>${params[0].axisValue}</b><br/>`; params.forEach(p => { r += `${p.marker} ${p.seriesName}: <b>${formatNumber(p.value)}</b><br/>` }); return r } },
    legend: { data: [r1.name, r2.name], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '15%', top: '15%', containLabel: true },
    xAxis: { type: 'category', data: uniqueFields, axisLabel: { rotate: 15, fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { formatter: (val) => val >= 10000 ? (val / 10000) + '万' : val } },
    series: [
      { name: r1.name, type: 'bar', barGap: '5%', itemStyle: { color: '#409EFF' }, data: uniqueFields.map(f => f === r1.statField ? r1.total : (r1.allFields?.[f] || 0)), label: { show: true, position: 'top', formatter: (p) => formatNumber(p.value), fontSize: 10 } },
      { name: r2.name, type: 'bar', barGap: '5%', itemStyle: { color: '#67C23A' }, data: uniqueFields.map(f => f === r2.statField ? r2.total : (r2.allFields?.[f] || 0)), label: { show: true, position: 'top', formatter: (p) => formatNumber(p.value), fontSize: 10 } }
    ]
  })
}

function getHeatmapCellStyle(nums, idx) {
  if (!nums || nums.length === 0) return { background: '#f5f5f5', color: '#333' }
  const validNums = nums.map(n => Math.abs(Number(n) || 0))
  const maxVal = Math.max(...validNums)
  const minVal = Math.min(...validNums)
  const range = maxVal - minVal
  if (range === 0) return { background: '#e0e0e0', color: '#333' }
  const normalized = (validNums[idx] - minVal) / range
  const r = Math.round(43 + (215 - 43) * normalized)
  const g = Math.round(131 + (25 - 131) * normalized)
  const b = Math.round(246 + (28 - 246) * normalized)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return { background: `rgb(${r}, ${g}, ${b})`, color: brightness > 150 ? '#333' : '#fff' }
}

// 窗口resize时重绘图表
window.addEventListener('resize', () => { if (compareChart) compareChart.resize() })
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
