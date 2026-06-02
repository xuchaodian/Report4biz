<template>
  <div class="city-data-page">
    <div class="page-header">
      <h2>城市宏观数据</h2>
      <div class="header-actions">
        <div style="display:flex;gap:8px">
          <el-upload
            v-if="userStore.isAdmin"
            action="/api/city-data/import"
            accept=".csv"
            :show-file-list="false"
            :on-success="onImportSuccess"
            :on-error="() => ElMessage.error('导入失败')"
          >
            <el-button type="primary" size="small"><el-icon><Upload /></el-icon>导入CSV</el-button>
          </el-upload>
        </div>
        <div style="display:flex;gap:8px">
          <el-button v-if="userStore.isAdmin" type="danger" size="small" @click="handleClear"><el-icon><Delete /></el-icon>一键清除</el-button>
          <el-button size="small" @click="loadData"><el-icon><Refresh /></el-icon>刷新</el-button>
        </div>
      </div>
    </div>
    <div class="page-body">
      <div v-if="loading" style="text-align:center;padding:40px;color:#909399">加载中...</div>
      <el-table v-else :data="cityData" style="width:100%" stripe border :max-height="700" size="small" @sort-change="onSortChange">
        <el-table-column prop="城市" label="城市" min-width="70" fixed sortable="custom" />
        <el-table-column prop="省份" label="省份" min-width="70" sortable="custom" />
        <el-table-column prop="等级" label="等级" min-width="60" sortable="custom" />
        <el-table-column prop="年份" label="年份" min-width="70" sortable="custom" />
        <el-table-column prop="GDP(亿元)" label="GDP(亿)" min-width="100" align="right" sortable="custom">
          <template #default="{ row }">{{ row['GDP(亿元)']?.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="增速(%)" label="增速" min-width="65" align="right" sortable="custom">
          <template #default="{ row }">{{ row['增速(%)'] }}%</template>
        </el-table-column>
        <el-table-column prop="人均GDP(元)" label="人均GDP(元)" min-width="110" align="right" sortable="custom">
          <template #default="{ row }">{{ row['人均GDP(元)']?.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="年末常住人口(万人)" label="常住人口(万)" min-width="110" align="right" sortable="custom">
          <template #default="{ row }">{{ row['年末常住人口(万人)']?.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="城镇人口(万人)" label="城镇人口(万)" min-width="100" align="right" sortable="custom">
          <template #default="{ row }">{{ row['城镇人口(万人)']?.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="城镇居民人均可支配收入(元)" label="人均可支配收入(元)" min-width="140" align="right" sortable="custom">
          <template #default="{ row }">{{ row['城镇居民人均可支配收入(元)']?.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="城镇居民人均消费支出(元)" label="人均消费支出(元)" min-width="130" align="right" sortable="custom">
          <template #default="{ row }">{{ row['城镇居民人均消费支出(元)']?.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="社会消费品零售总额(亿元)" label="社零总额(亿)" min-width="100" align="right" sortable="custom">
          <template #default="{ row }">{{ row['社会消费品零售总额(亿元)']?.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button v-if="userStore.isAdmin" size="small" type="primary" link @click="openEdit(row)"><el-icon><Edit /></el-icon>编辑</el-button>
            <el-button size="small" type="success" link @click="viewOnMap(row)"><el-icon><MapLocation /></el-icon>地图</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!loading && cityData.length === 0" style="text-align:center;padding:60px;color:#909399">
        <el-empty description="暂无数据" />
      </div>
    </div>

    <!-- 编辑对话框 -->
    <el-dialog v-model="editVisible" title="编辑城市数据" width="600px" :close-on-click-modal="false">
      <el-form :model="editForm" label-width="140px" size="small">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="城市"><el-input v-model="editForm['城市']" disabled /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="省份"><el-input v-model="editForm['省份']" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="等级"><el-input v-model="editForm['等级']" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="年份"><el-input v-model="editForm['年份']" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="GDP(亿元)"><el-input-number v-model="editForm['GDP(亿元)']" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="增速(%)"><el-input-number v-model="editForm['增速(%)']" :step="0.1" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="人均GDP(元)"><el-input-number v-model="editForm['人均GDP(元)']" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="常住人口(万)"><el-input-number v-model="editForm['年末常住人口(万人)']" :min="0" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="城镇人口(万)"><el-input-number v-model="editForm['城镇人口(万人)']" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="人均可支配收入(元)"><el-input-number v-model="editForm['城镇居民人均可支配收入(元)']" :min="0" style="width:100%" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="人均消费支出(元)"><el-input-number v-model="editForm['城镇居民人均消费支出(元)']" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="社零总额(亿)"><el-input-number v-model="editForm['社会消费品零售总额(亿元)']" :min="0" style="width:100%" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editLoading" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Upload, Delete, Edit, MapLocation } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const cityData = ref([])
const loading = ref(false)
const editVisible = ref(false)
const editLoading = ref(false)
const editForm = ref({})

onMounted(() => loadData())

const loadData = async () => {
  loading.value = true
  try {
    const res = await fetch('/api/city-data')
    const d = await res.json()
    if (d.success) cityData.value = d.data
  } catch(e) {
    console.error('[CityData] 加载失败:', e)
  } finally {
    loading.value = false
  }
}

const onImportSuccess = (res) => {
  if (res.success) { ElMessage.success('导入成功'); loadData() }
  else { ElMessage.error(res.message || '导入失败') }
}

const handleClear = async () => {
  try {
    await ElMessageBox.confirm('确定要清除所有城市宏观数据吗？此操作不可撤销！', '警告', {
      confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning'
    })
    const res = await fetch('/api/city-data', { method: 'DELETE' })
    const d = await res.json()
    if (d.success) { ElMessage.success('已清除所有数据'); loadData() }
    else { ElMessage.error(d.message || '清除失败') }
  } catch (e) { if (e !== 'cancel') console.error('[CityData] 清除失败:', e) }
}

const openEdit = (row) => {
  editForm.value = { ...row }
  editVisible.value = true
}

const viewOnMap = (row) => {
  sessionStorage.setItem('cityData_target', row['城市'])
  window.location.href = '/'
}

const saveEdit = async () => {
  editLoading.value = true
  try {
    const res = await fetch(`/api/city-data/${encodeURIComponent(editForm.value['城市'])}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm.value)
    })
    const d = await res.json()
    if (d.success) { ElMessage.success('保存成功'); editVisible.value = false; loadData() }
    else { ElMessage.error(d.message || '保存失败') }
  } catch (e) { ElMessage.error('保存失败: ' + e.message) }
  finally { editLoading.value = false }
}

const onSortChange = ({ prop, order }) => {
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
</script>

<style scoped>
.city-data-page { padding: 20px 24px; height: 100%; background: #f5f7fa; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-header h2 { margin: 0; font-size: 18px; color: #303133; }
.header-actions { display: flex; gap: 8px; }
.page-body { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); font-size: 13px; }
.page-body :deep(.el-table) { font-size: 13px; }
.page-body :deep(.el-table th.el-table__cell) { font-size: 13px; font-weight: 600; }
</style>
