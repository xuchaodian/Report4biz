<template>
  <div class="competitor-view">
    <el-tabs v-model="activeTab" class="competitor-tabs" @tab-change="handleTabChange">
      <!-- ================= Tab1 竞品列表（手工管理 + 最新期镜像） ================= -->
      <el-tab-pane label="竞品列表" name="list">
        <div class="data-header">
          <h2>竞品管理</h2>
          <div class="header-actions">
            <el-select v-model="analysisBrand" clearable placeholder="分析品牌（不限）" style="width:170px" @change="onAnalysisBrandChange">
              <el-option v-for="b in myBrands" :key="b" :label="b" :value="b" />
            </el-select>
            <el-button @click="openMapConfig">品牌竞品映射</el-button>
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
        aria-label="搜索竞品门店名称、地址或编号"
        style="width: 200px"
        clearable
        @input="handleSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>

      <el-select v-model="filterCity" placeholder="按城市" aria-label="按城市筛选" style="width: 120px" clearable @change="handleSearch">
        <el-option v-for="city in cityList" :key="city" :label="city" :value="city" />
      </el-select>

      <el-select v-model="filterDistrict" placeholder="按区县" aria-label="按区县筛选" style="width: 120px" clearable @change="handleSearch">
        <el-option v-for="d in districtList" :key="d" :label="d" :value="d" />
      </el-select>

      <el-select v-model="filterTradingArea" placeholder="按商圈" aria-label="按商圈筛选" style="width: 150px" clearable @change="handleSearch">
        <el-option v-for="a in tradingAreaList" :key="a" :label="a" :value="a" />
      </el-select>

      <el-select v-model="filterBrand" placeholder="按品牌" aria-label="按品牌筛选" style="width: 200px" multiple collapse-tags collapse-tags-tooltip clearable @change="handleSearch">
        <el-option v-for="b in brandList" :key="b" :label="b" :value="b" />
      </el-select>

      <el-input-number v-model="filterMinStars" :min="1" :max="5" :step="1" placeholder="最低星级" aria-label="最低星级" style="width: 110px" controls-position="right" @change="handleSearch" />
      <el-input-number v-model="filterMinReviews" :min="1" :step="10" placeholder="最少评论" aria-label="最少评论数" style="width: 120px" controls-position="right" @change="handleSearch" />

      <span class="统计">共 {{ filteredCompetitors.length }} 条数据</span>
      <el-button v-if="hasActiveFilters" type="warning" plain @click="handleClearFilters">
        <el-icon><Close /></el-icon>清除筛选
      </el-button>
    </div>

    <!-- 数据表格 -->
    <!-- v1.13.177 A 档：区域定名（⛔ 不用 caption，见 DataView 同名注释） -->
    <div class="data-table" role="region" aria-label="竞品门店数据表">
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
        <el-table-column type="selection" width="45" reserve-selection :selectable="(row) => !isLocked(row)" />
        <el-table-column prop="brand" label="品牌" width="120">
          <template #default="{ row }">
            {{ row.brand }}
          </template>
        </el-table-column>
        <el-table-column label="对应自有品牌" width="140">
          <template #default="{ row }">
            <el-tag v-for="b in myBrandsOf(row.brand)" :key="b" size="small" type="info" style="margin-right:4px">{{ b }}</el-tag>
            <span v-if="!myBrandsOf(row.brand).length">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="门店名称" min-width="220">
          <template #default="{ row }">
            <!-- 不用 show-overflow-tooltip：它会给 .cell 加 overflow:hidden，
                 名称一长就把后面的「集团下发」标签整块裁掉。改成 flex + 名称自身
                 省略号化，标签始终可见（名称全称靠 title 悬停）。 -->
            <div class="cell-wrap">
              <span class="cell-name" :title="row.name">{{ row.name }}</span>
              <el-tag v-if="isLocked(row)" size="small" type="info" effect="plain" class="lock-tag">
                集团下发
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="营业状态" width="100" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.status || '未知' }}</span>
          </template>
        </el-table-column>
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
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <!-- v1.13.177 A 档：锁定行不整名替换，用「（已锁定）」保留功能语义 -->
            <el-tooltip :disabled="!isLocked(row)" :content="LOCK_TIP" placement="top">
              <span>
                <el-button type="primary" link :disabled="isLocked(row)" :aria-label="isLocked(row) ? '编辑竞品门店（已锁定）' : '编辑竞品门店'" @click="handleEdit(row)">
                  <el-icon><Edit /></el-icon>
                </el-button>
              </span>
            </el-tooltip>
            <el-tooltip :disabled="!isLocked(row)" :content="LOCK_TIP" placement="top">
              <span>
                <el-button type="danger" link :disabled="isLocked(row)" :aria-label="isLocked(row) ? '删除竞品门店（已锁定）' : '删除竞品门店'" @click="handleDelete(row)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </span>
            </el-tooltip>
            <el-button type="success" link @click="handleLocate(row)" title="在地图中定位" aria-label="在地图中定位该门店">
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
          @snapshot-deleted="handleSnapshotDeleted"
          @goto-monitor="gotoMonitor"
        />
      </el-tab-pane>

      <!-- ================= Tab3 开关店监测 ================= -->
      <el-tab-pane label="开关店监测" name="monitor">
        <SnapshotMonitorPanel
          ref="monitorPanelRef"
          :initial-brand="monitorBrand"
          :initial-target="monitorTarget"
          @snapshot-deleted="handleSnapshotDeleted"
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

        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="门店名称" />
        </el-form-item>

        <el-form-item label="状态" prop="status">
          <el-select v-model="form.status" placeholder="请选择" style="width: 100%">
            <el-option v-for="s in competitorStore.statuses" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>

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
            <el-form-item label="商圈" prop="trading_area">
              <el-input v-model="form.trading_area" placeholder="如: 人民广场商圈/徐家汇商圈" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="门店分类" prop="store_category">
              <el-select
                v-model="form.store_category"
                filterable
                allow-create
                default-first-option
                placeholder="如: 快餐 / 火锅 / 茶饮"
                style="width: 100%"
              >
                <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

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
            <el-form-item label="价格(元)" prop="price">
              <el-input-number v-model="form.price" :min="0" :max="99999" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="星级" prop="rating">
              <el-input-number v-model="form.rating" :min="0" :max="5" :step="0.1" :precision="1" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="评论数" prop="reviews">
          <el-input-number v-model="form.reviews" :min="0" :max="999999" style="width: 200px" />
        </el-form-item>

        <el-form-item label="备注" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="备注信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>

    <!-- v1.13.344：自有品牌 → 竞品品牌集合 配置 -->
    <el-dialog v-model="mapDialogVisible" title="品牌竞品映射" width="560px">
      <el-alert
        type="info" :closable="false" show-icon style="margin-bottom:12px"
        title="未配置＝按账号全量竞品统计；配置后按所选竞品品牌收窄"
        description="同一竞品品牌可同时配给多个自有品牌；一个都不选＝明确「该品牌无竞品」，判未评而非绿灯。"
      />
      <el-form label-width="110px">
        <el-form-item label="自有品牌">
          <el-select v-model="mapMyBrand" placeholder="选择我的门店品牌" style="width:100%" @change="onMapBrandChange">
            <el-option v-for="b in myBrands" :key="b" :label="b" :value="b" />
          </el-select>
        </el-form-item>
        <el-form-item label="竞品品牌">
          <el-select v-model="mapCompBrands" multiple filterable allow-create clearable
                     placeholder="可多选，也可输入新品牌" style="width:100%">
            <el-option v-for="b in availableCompBrands" :key="b" :label="b" :value="b" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mapDialogVisible = false">取消</el-button>
        <el-button :disabled="!mapMyBrand || !scopeMetaLoaded" @click="resetMapScope">恢复全量</el-button>
        <el-button type="primary" :loading="mapSaving" :disabled="!mapMyBrand || !scopeMetaLoaded" @click="saveMapScope">保存</el-button>
      </template>
    </el-dialog>

    <!-- v1.13.349：多品牌账号强制补映射（硬阻断，无取消键） -->
    <BrandMapRequiredDialog
      v-model="requiredMapVisible"
      :my-brands="scopeMeta.myBrands"
      :competitor-brands="scopeMeta.competitorBrands"
      :scopes="scopeMeta.scopes"
      :just-imported-brand="lastImportedCompBrand"
      :degraded="requiredMapDegraded"
      @saved="onRequiredMapSaved"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Download, Search, Edit, Delete, Location, Close } from '@element-plus/icons-vue'
import { useCompetitorStore } from '@/stores/competitor'
import { currentUidOr } from '@/utils/currentUser.js'
import { normBrand } from '@/utils/brandScope.js'
import { decideBrandMapPrompt } from '@/utils/brandMapPrompt.js'
import api from '@/utils/api'
import SnapshotUploadPanel from '@/components/competitor/SnapshotUploadPanel.vue'
import SnapshotMonitorPanel from '@/components/competitor/SnapshotMonitorPanel.vue'
import BrandMapRequiredDialog from '@/components/competitor/BrandMapRequiredDialog.vue'

const router = useRouter()
const competitorStore = useCompetitorStore()

// ===== v1.13.344：分析品牌 + 品牌竞品映射 =====
const BRAND_LS_KEY = () => `competitorAnalysisBrand_${currentUidOr('anon')}`
const analysisBrand = ref('')
const mapDialogVisible = ref(false)
const mapSaving = ref(false)
const mapMyBrand = ref('')
const mapCompBrands = ref([])
const scopeMeta = ref({ myBrands: [], competitorBrands: [], scopes: {} })
// 元数据读取失败时禁止保存：否则弹窗回显为空，一次「保存」就会把已有映射覆盖成空集
const scopeMetaLoaded = ref(false)
// v1.13.349：强制补映射弹窗（硬阻断）—— 声明必须早于 setup 级复查调用
const requiredMapVisible = ref(false)
const requiredMapDegraded = ref(false)
const lastImportedCompBrand = ref('')
const myBrands = computed(() => (scopeMeta.value.myBrands?.length ? scopeMeta.value.myBrands : competitorStore.myBrands) || [])
const availableCompBrands = computed(() => (scopeMeta.value.competitorBrands?.length ? scopeMeta.value.competitorBrands : competitorStore.competitorBrands) || [])

// 🔴 归一函数只有一份：utils/brandScope.js::normBrand（与后端 normalizeBrand 同规则）
function myBrandsOf(compBrand) {
  const k = normBrand(compBrand)
  const scopes = competitorStore.brandScopeMap || {}
  return Object.keys(scopes).filter(b => (scopes[b] || []).some(x => normBrand(x) === k))
}
async function loadScopeMeta() {
  try {
    // utils/api.js 的响应拦截器已返回 response.data ⇒ 这里直接拿响应体，⛔ 不能再解一层 { data }
    const data = await api.get('/brand-competitor-map')
    scopeMeta.value = { myBrands: data.myBrands || [], competitorBrands: data.competitorBrands || [], scopes: data.scopes || {} }
    scopeMetaLoaded.value = true
  } catch (e) { scopeMetaLoaded.value = false /* 配置接口不可用时静默降级为老行为 */ }
}
async function openMapConfig() {
  await loadScopeMeta() // 先拉到最新映射再回显，避免竞态把已有配置显示成空
  mapMyBrand.value = analysisBrand.value || (myBrands.value[0] || '')
  onMapBrandChange()
  mapDialogVisible.value = true
}
function onMapBrandChange() {
  const s = scopeMeta.value.scopes || {}
  mapCompBrands.value = Object.prototype.hasOwnProperty.call(s, mapMyBrand.value) ? [...(s[mapMyBrand.value] || [])] : []
}
async function saveMapScope() {
  if (!scopeMetaLoaded.value) { ElMessage.error('配置读取失败，已阻止保存以免覆盖现有配置'); return }
  mapSaving.value = true
  try {
    const data = await api.put('/brand-competitor-map', { myBrand: mapMyBrand.value, competitorBrands: mapCompBrands.value })
    scopeMeta.value = { myBrands: data.myBrands || [], competitorBrands: data.competitorBrands || [], scopes: data.scopes || {} }
    await competitorStore.fetchCompetitors(true)
    ElMessage.success('已保存；该品牌的竞品统计按新集合收窄')
    mapDialogVisible.value = false
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally { mapSaving.value = false }
}
async function resetMapScope() {
  if (!scopeMetaLoaded.value) { ElMessage.error('配置读取失败，已阻止操作'); return }
  try {
    const data = await api.delete('/brand-competitor-map', { params: { myBrand: mapMyBrand.value } })
    scopeMeta.value = { myBrands: data.myBrands || [], competitorBrands: data.competitorBrands || [], scopes: data.scopes || {} }
    await competitorStore.fetchCompetitors(true)
    ElMessage.success('已恢复全量口径')
    mapDialogVisible.value = false
  } catch (e) { ElMessage.error(e?.response?.data?.message || '操作失败') }
}
async function onAnalysisBrandChange(v) {
  try { localStorage.setItem(BRAND_LS_KEY(), String(v || '')) } catch (e) { /* 隐私模式降级 */ }
  await competitorStore.setMyBrand(v || '')
}
// 恢复上次选择（按 uid 命名空间，⛔ 不共用 localStorage.userId）
try { analysisBrand.value = localStorage.getItem(BRAND_LS_KEY()) || '' } catch (e) { /* 忽略 */ }
competitorStore.filters.myBrand = analysisBrand.value
// v1.13.349：进页复查「有没有品牌没配映射」—— 硬阻断唯一的缺口是用户关标签页，靠这条补上
checkRequiredBrandMapOnEnter()

// 筛选和分页 - 使用 store 中的筛选条件（持久化）
// 使用 ref 包装 store 中的 filters，确保响应式
const searchKeyword = ref('')
const filterCity = ref('')
const filterDistrict = ref('')
const filterTradingArea = ref('')
const filterBrand = ref([])
const filterMinStars = ref(null)
const filterMinReviews = ref(null)
const currentPage = ref(1)
const pageSize = ref(20)

// localStorage 持久化（按用户隔离，userId 从 localStorage 读取保证跨刷新稳定）
const LS_KEY = () => `competitorFilters_${currentUidOr('anon')}`
const SAVE_FIELDS = () => ({
  searchKeyword: searchKeyword.value,
  filterCity: filterCity.value,
  filterDistrict: filterDistrict.value,
  filterTradingArea: filterTradingArea.value,
  filterBrand: filterBrand.value,
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
}, { deep: true })

// 同步筛选条件到 store + localStorage（持久化）
const syncFiltersToStore = () => {
  competitorStore.setFilters({
    searchKeyword: searchKeyword.value,
    filterCity: filterCity.value,
    filterDistrict: filterDistrict.value,
    filterTradingArea: filterTradingArea.value,
    filterBrand: filterBrand.value
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
      filterBrand: filterBrand.value
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
  }
})

// 是否有激活的筛选条件
const hasActiveFilters = computed(() => {
  return searchKeyword.value || filterCity.value || filterDistrict.value || filterTradingArea.value || filterBrand.value.length || filterMinStars.value !== null || filterMinReviews.value !== null
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

// ★ 集团下发镜像行（sync_readonly=1）：由集团账号统一维护，本账号只读。
//   前端置灰 + tooltip 说明来源；后端 blockedBySyncLock 仍会 403 兜底（双拦截）。
const isLocked = (row) => Number(row && row.sync_readonly) === 1
const LOCK_TIP = '由集团统一维护，只读'

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
  status: '正常营业',
  city: '',
  district: '',
  address: '',
  store_category: '',
  description: '',
  latitude: 39.9042,
  longitude: 116.4074,
  trading_area: '',
  price: 0,
  rating: 0,
  reviews: 0
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

// 门店分类列表（动态取自现有竞品，供「添加/编辑竞品」弹窗的门店分类下拉，兼容上传模板的自由文本分类如「快餐」）
const categoryOptions = computed(() => {
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
    const matchStars = !filterMinStars.value || (comp.rating && comp.rating >= filterMinStars.value)
    const matchReviews = !filterMinReviews.value || (comp.reviews && comp.reviews >= filterMinReviews.value)
    return matchKeyword && matchCity && matchDistrict && matchTradingArea && matchBrand && matchStars && matchReviews
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
    filterBrand.value.length
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
    store_code: '', brand: '', name: '',
    status: '正常营业', city: '', district: '', address: '',
    store_category: '', description: '', latitude: 39.9042, longitude: 116.4074,
    trading_area: '', price: 0, rating: 0, reviews: 0
  })
  dialogVisible.value = true
}

const handleEdit = (row) => {
  if (isLocked(row)) { ElMessage.warning(`「${row.name}」${LOCK_TIP}`); return }
  isEdit.value = true
  editingId.value = row.id
  Object.assign(form, {
    store_code: row.store_code || '',
    brand: row.brand || '',
    name: row.name,
    status: row.status || '正常营业',
    city: row.city || '',
    district: row.district || '',
    address: row.address || '',
    store_category: row.store_category || '',
    description: row.description || '',
    latitude: row.latitude,
    longitude: row.longitude,
    trading_area: row.trading_area || '',
    price: row.price || 0,
    rating: row.rating || 0,
    reviews: row.reviews || 0
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
  if (isLocked(row)) { ElMessage.warning(`「${row.name}」${LOCK_TIP}`); return }
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
  // ★ 防御：只读镜像行不可删（勾选框已 :selectable 屏蔽，此处兜底）
  const deletable = selectedRows.value.filter(row => !isLocked(row))
  if (deletable.length === 0) { ElMessage.warning('所选数据均为集团下发，只读不可删除'); return }
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${deletable.length} 条竞品数据吗？`, '提示', { type: 'warning' })
    const ids = deletable.map(row => row.id)
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
      '此操作将清空所有<b>自有</b>竞品门店数据，不可恢复！<br/>集团下发的镜像竞品会被保留。',
      '危险操作',
      {
        type: 'warning',
        dangerouslyUseHTMLString: true,
        confirmButtonText: '确定清空',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
    const result = await competitorStore.clearAllCompetitors()
    if (result.success) {
      // 后端会在保留只读镜像行时回传完整说明文案，直接用
      ElMessage.success(result.message || `已清空 ${result.count} 条竞品数据`)
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
// Tab2 导入成功后：刷新列表镜像（UploadPanel 已提示详情，这里静默同步；导入后强制绕过 H2 新鲜期）
const handleSnapshotImported = async (payload) => {
  await competitorStore.fetchCompetitors(true)
  // 列表已被新镜像替换 → 清掉本地筛选态，避免残留条件看不到新数据
  handleClearFilters()
  // v1.13.349：刚灌进新品牌竞品的时刻，正是最该把品牌竞品映射配掉的时刻（强制）
  await openRequiredBrandMap(payload?.brand)
}

/**
 * v1.13.349：多品牌账号必须完成「品牌竞品映射」（取代 348 的可跳过确认框）。
 *
 * 为什么必须：344 起竞品按自有品牌分池统计，但**未配置映射的品牌退回全量**。
 *   「我的门店」有 2 个以上品牌时，A 的竞品与 B 的竞品被加在一起 ⇒ 竞争分被压低、
 *   门店信号灯被别业态点亮。348 弹的是「要不要去设置」，点「暂不设置」就过 ⇒ 等于没治。
 *
 * 触发时机（两处，缺一不可）：
 *   ① 导入成功后 → openRequiredBrandMap()（justImportedBrand = 本次导入的**竞品品牌**，用于预勾选）
 *   ② 每次进入竞品页 → checkRequiredBrandMapOnEnter()（关标签页能绕过任何前端阻断）
 *
 * 🔴 判据全在 utils/brandMapPrompt.js（单测钉死），本文件只负责「拉元数据 → 开窗」。
 * 🔴 进页复查时元数据读不到 ⇒ **静默**（下次进页再查），⛔ 不要每次进页都弹一个什么也做不了的窗。
 * 🔴 导入后元数据读不到 ⇒ 弹 degraded 窗**告知一次**（用户刚以为配完了，得让他知道没检查成）。
 */
async function openRequiredBrandMap(justImportedBrand = '') {
  try {
    await loadScopeMeta() // 先拉最新映射：刚导入的竞品品牌会出现在 availableCompBrands 里
    if (!scopeMetaLoaded.value) {
      requiredMapDegraded.value = true
      lastImportedCompBrand.value = ''
      requiredMapVisible.value = true
      return
    }
    const d = decideBrandMapPrompt({
      myBrands: scopeMeta.value.myBrands,
      scopes: scopeMeta.value.scopes
    })
    if (!d.required) return
    requiredMapDegraded.value = false
    lastImportedCompBrand.value = String(justImportedBrand || '')
    requiredMapVisible.value = true
  } catch (e) {
    /* 拉元数据异常不阻断导入主流程；下次进页会再复查一次 */
  }
}

async function checkRequiredBrandMapOnEnter() {
  try {
    await loadScopeMeta()
    if (!scopeMetaLoaded.value) return
    const d = decideBrandMapPrompt({
      myBrands: scopeMeta.value.myBrands,
      scopes: scopeMeta.value.scopes
    })
    if (!d.required) return
    requiredMapDegraded.value = false
    lastImportedCompBrand.value = ''
    requiredMapVisible.value = true
  } catch (e) {
    /* 静默：进页复查失败不打扰 */
  }
}

// 弹窗保存成功：重新拉映射 + 刷新竞品列表（计数口径变了）
async function onRequiredMapSaved() {
  await loadScopeMeta()
  await competitorStore.fetchCompetitors(true)
}
// Tab2 删除期次后：若删到最新期（镜像被移除）则同步刷新竞品列表（强制绕过 H2 新鲜期）
const handleSnapshotDeleted = async (payload) => {
  if (!payload || !payload.listReverted) return
  await competitorStore.fetchCompetitors(true)
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
.lock-tag {
  flex: 0 0 auto;
  height: 18px;
  padding: 0 5px;
  font-size: 11px;
  line-height: 18px;
}
/* ★ 名称单元格：flex + min-width:0 ⇒ 名称可省略号化，标签/星级永不压缩 */
.cell-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cell-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pagination-container {
  margin-top: 15px;
  display: flex;
  justify-content: flex-end;
}
</style>
