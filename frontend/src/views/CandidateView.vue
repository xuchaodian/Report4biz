<template>
  <div class="cand-page">
    <!-- 头部 -->
    <div class="cd-head">
      <div class="cd-head-l">
        <el-button link @click="goBack"><el-icon><ArrowLeft /></el-icon>返回地图</el-button>
        <h2>候选点位</h2>
        <p class="cd-sub">
          还没开的点位：<b>存下来 → 标状态 → 留一句推进记录</b>。
          四档是「待评估 / 已勘踏 / 立项 / 放弃」，<b>只本人可见</b>，不进门店台账、不影响体检与预测。
        </p>
      </div>
      <div class="cd-head-r">
        <el-button :loading="loading" @click="reload">刷新</el-button>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新建点位
        </el-button>
      </div>
    </div>

    <!-- 四档统计（点一下即筛选，再点取消） -->
    <div class="cd-stages">
      <button
        v-for="s in STAGES"
        :key="s"
        class="cd-stage"
        :class="{ active: filterStage === s }"
        :style="{ '--sc': stageMeta(s).color }"
        :title="stageMeta(s).desc"
        @click="toggleStage(s)"
      >
        <span class="cd-stage-n">{{ counts[s] || 0 }}</span>
        <span class="cd-stage-t">{{ s }}</span>
      </button>
      <div class="cd-total">
        共 <b>{{ total }}</b> 个点位
        <a v-if="filterStage" class="cd-clear" @click="clearFilter">清除筛选</a>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="cd-tools">
      <el-input
        v-model="keyword"
        placeholder="搜名称 / 地址 / 品牌"
        clearable
        style="width: 280px"
        @keyup.enter="reload"
        @clear="reload"
      >
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-button @click="reload">查询</el-button>
    </div>

    <div v-if="errorMsg" class="cd-error">
      <el-icon><WarningFilled /></el-icon>{{ errorMsg }}
    </div>

    <!-- 空态：分两种，别让用户以为是坏了 -->
    <div v-else-if="!loading && !list.length" class="cd-empty">
      <template v-if="filterStage || keyword">
        <p>这个条件下没有点位。</p>
        <el-button link type="primary" @click="clearFilter">清除筛选</el-button>
      </template>
      <template v-else>
        <p>还没有候选点位。</p>
        <p class="cd-empty-hint">在地图页<b>右键</b>物色到的位置 →「加入候选点位」，或者点下面的「新建点位」手填。</p>
        <el-button type="primary" @click="openCreate">新建第一个点位</el-button>
      </template>
    </div>

    <!-- 列表 -->
    <el-table
      v-else
      :data="list"
      v-loading="loading"
      class="cd-table"
      row-key="id"
      @row-click="openDetail"
    >
      <el-table-column label="点位" min-width="200">
        <template #default="{ row }">
          <div class="cd-name">{{ row.name }}</div>
          <div v-if="row.brand" class="cd-name-sub">{{ row.brand }}</div>
        </template>
      </el-table-column>
      <el-table-column label="位置" min-width="220">
        <template #default="{ row }">
          <div>{{ [row.city, row.district].filter(Boolean).join(' · ') || '—' }}</div>
          <div v-if="row.address" class="cd-addr">{{ row.address }}</div>
        </template>
      </el-table-column>
      <el-table-column label="半径" width="90" align="right">
        <template #default="{ row }">{{ row.radius >= 1000 ? (row.radius / 1000) + ' km' : row.radius + ' m' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110" align="center">
        <template #default="{ row }">
          <span class="cd-badge" :style="{ color: stageMeta(row.stage).color, background: stageMeta(row.stage).bg }">
            {{ row.stage }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="最近更新" width="160">
        <template #default="{ row }">{{ fmt(row.updated_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
          <el-button link type="danger" @click.stop="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 详情抽屉 -->
    <el-drawer v-model="drawer" :title="detail?.name || '点位详情'" size="520px">
      <div v-if="detail" class="cd-detail">
        <div class="cd-detail-top">
          <span class="cd-badge" :style="{ color: stageMeta(detail.stage).color, background: stageMeta(detail.stage).bg }">
            {{ detail.stage }}
          </span>
          <span class="cd-detail-hint">{{ stageMeta(detail.stage).desc }}</span>
        </div>

        <dl class="cd-info">
          <div><dt>品牌</dt><dd>{{ detail.brand || '—' }}</dd></div>
          <div><dt>城市 / 区县</dt><dd>{{ [detail.city, detail.district].filter(Boolean).join(' · ') || '—' }}</dd></div>
          <div class="cd-info-wide"><dt>地址</dt><dd>{{ detail.address || '—' }}</dd></div>
          <div><dt>坐标</dt><dd>{{ detail.latitude.toFixed(6) }}, {{ detail.longitude.toFixed(6) }}</dd></div>
          <div><dt>评估半径</dt><dd>{{ detail.radius }} m</dd></div>
          <div><dt>面积</dt><dd>{{ detail.area ? detail.area + ' ㎡' : '—' }}</dd></div>
          <div><dt>月租金</dt><dd>{{ detail.rent ? detail.rent + ' 元' : '—' }}</dd></div>
          <div v-if="detail.drop_reason" class="cd-info-wide">
            <dt>放弃原因</dt><dd class="cd-drop">{{ detail.drop_reason }}</dd>
          </div>
        </dl>

        <div class="cd-sec">
          <h3>推进阶段</h3>
          <div class="cd-stage-actions">
            <el-button
              v-for="s in STAGES"
              :key="s"
              size="small"
              :disabled="s === detail.stage"
              :plain="s !== detail.stage"
              :style="s === detail.stage ? {} : { color: stageMeta(s).color, borderColor: stageMeta(s).color }"
              @click="changeStage(s)"
            >
              {{ s }}
            </el-button>
          </div>
          <el-input
            v-model="stageNote"
            type="textarea"
            :rows="2"
            maxlength="500"
            show-word-limit
            :placeholder="lastClickedStage === '放弃' ? '标记为「放弃」时必须说明原因' : '可选：写一句这次推进的说明（会记进流水）'"
            class="cd-note-input"
          />
          <div class="cd-sec-foot">
            <span class="cd-muted">流水只追加不改写，写错了就再写一条。</span>
          </div>
        </div>

        <div class="cd-sec">
          <h3>推进流水 <span class="cd-muted">({{ notes.length }})</span></h3>
          <el-timeline v-if="notes.length" class="cd-timeline">
            <el-timeline-item
              v-for="n in notes"
              :key="n.id"
              :timestamp="fmt(n.created_at)"
              placement="top"
            >
              <div v-if="n.from_stage || n.to_stage" class="cd-note-stage">
                {{ n.from_stage || '—' }} → <b :style="{ color: stageMeta(n.to_stage).color }">{{ n.to_stage }}</b>
              </div>
              <div class="cd-note-text">{{ n.note }}</div>
            </el-timeline-item>
          </el-timeline>
          <p v-else class="cd-muted">还没有记录。</p>

          <div class="cd-remark">
            <el-input
              v-model="remark"
              type="textarea"
              :rows="2"
              maxlength="500"
              show-word-limit
              placeholder="补一条记录（例：业主报价 8 元/㎡/天，等总部审批）"
            />
            <el-button type="primary" :loading="remarkLoading" @click="addRemark">记一笔</el-button>
          </div>
        </div>

        <div class="cd-detail-actions">
          <el-button @click="openEdit">编辑信息</el-button>
          <el-button type="danger" plain @click="remove(detail)">删除点位</el-button>
        </div>
      </div>
    </el-drawer>

    <!-- 新建 / 编辑 -->
    <el-dialog v-model="dialog" :title="editingId ? '编辑点位' : '新建候选点位'" width="560px" append-to-body>
      <el-form :model="form" label-width="88px" label-position="right">
        <el-form-item label="点位名称" required>
          <el-input v-model="form.name" maxlength="60" placeholder="例：五角场万达 3F 中庭铺位" />
        </el-form-item>
        <el-form-item label="拟入驻品牌">
          <el-input v-model="form.brand" maxlength="40" placeholder="例：食其家" />
        </el-form-item>
        <el-form-item label="城市 / 区县">
          <div class="cd-row">
            <el-input v-model="form.city" maxlength="20" placeholder="上海" />
            <el-input v-model="form.district" maxlength="20" placeholder="杨浦区" />
          </div>
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" maxlength="200" placeholder="邯郸路 600 号" />
        </el-form-item>
        <el-form-item label="经纬度" required>
          <div class="cd-row">
            <el-input v-model="form.latitude" placeholder="纬度 31.30..." />
            <el-input v-model="form.longitude" placeholder="经度 121.51..." />
          </div>
          <div class="cd-tip">GCJ-02（与地图上看到的一致）；可从地图页或已有门店抄过来。</div>
        </el-form-item>
        <el-form-item label="评估半径">
          <el-input-number v-model="form.radius" :min="100" :max="50000" :step="100" />
          <span class="cd-tip-inline">米</span>
        </el-form-item>
        <el-form-item label="面积 / 租金">
          <div class="cd-row">
            <el-input v-model="form.area" placeholder="面积 ㎡" />
            <el-input v-model="form.rent" placeholder="月租金 元" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ editingId ? '保存' : '创建' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { ArrowLeft, Plus, Search, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { STAGES, stageMeta } from '@/utils/candidateStage.js'
import { formatUtcDateTime } from '@/utils/datetime.js'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const list = ref([])
const counts = ref({})
const total = ref(0)
const keyword = ref('')
const filterStage = ref('')

const drawer = ref(false)
const detail = ref(null)
const notes = ref([])
const stageNote = ref('')
const remark = ref('')
const remarkLoading = ref(false)

const dialog = ref(false)
const editingId = ref(null)
const form = ref(emptyForm())

/** 最近点过的阶段：只用来驱动说明框的 placeholder（「放弃」要强制写原因） */
const lastClickedStage = ref('')

function emptyForm() {
  return { name: '', brand: '', city: '', district: '', address: '', latitude: '', longitude: '', radius: 1000, area: '', rent: '' }
}

/** 库里是 UTC（SQLite CURRENT_TIMESTAMP），统一走 utils/datetime.js 转本地 */
const fmt = formatUtcDateTime

function goBack() {
  router.push('/')
}

async function reload() {
  loading.value = true
  errorMsg.value = ''
  try {
    const { data } = await axios.get('/api/candidates', {
      params: { stage: filterStage.value || undefined, keyword: keyword.value || undefined }
    })
    list.value = data.list || []
    counts.value = data.counts || {}
    total.value = data.total || 0
  } catch (e) {
    errorMsg.value = e?.response?.data?.message || '加载候选点位失败'
    list.value = []
  } finally {
    loading.value = false
  }
}

function toggleStage(s) {
  filterStage.value = filterStage.value === s ? '' : s
  reload()
}

function clearFilter() {
  filterStage.value = ''
  keyword.value = ''
  reload()
}

async function openDetail(row) {
  try {
    const { data } = await axios.get(`/api/candidates/${row.id}`)
    detail.value = data.candidate
    notes.value = data.notes || []
    stageNote.value = ''
    lastClickedStage.value = ''
    remark.value = ''
    drawer.value = true
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '加载详情失败')
  }
}

/** 阶段按钮：先把意图记下来（驱动 placeholder），再要求填说明后提交 */
async function changeStage(stage) {
  lastClickedStage.value = stage
  if (stage === '放弃' && !stageNote.value.trim()) {
    ElMessage.warning('标记为「放弃」时要写一句原因')
    return
  }
  try {
    const { data } = await axios.patch(`/api/candidates/${detail.value.id}/stage`, {
      stage,
      note: stageNote.value.trim(),
      drop_reason: stage === '放弃' ? stageNote.value.trim() : ''
    })
    detail.value = data.candidate
    notes.value = data.notes || []
    stageNote.value = ''
    lastClickedStage.value = ''
    ElMessage.success(`已改为「${stage}」`)
    reload()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '更新阶段失败')
  }
}

async function addRemark() {
  const note = remark.value.trim()
  if (!note) return ElMessage.warning('先写点什么')
  remarkLoading.value = true
  try {
    const { data } = await axios.post(`/api/candidates/${detail.value.id}/notes`, { note })
    notes.value = data.notes || []
    remark.value = ''
    await reload()
    ElMessage.success('已记一笔')
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '添加备注失败')
  } finally {
    remarkLoading.value = false
  }
}

function openCreate() {
  editingId.value = null
  form.value = emptyForm()
  dialog.value = true
}

function openEdit() {
  const d = detail.value
  editingId.value = d.id
  form.value = {
    name: d.name, brand: d.brand || '', city: d.city || '', district: d.district || '',
    address: d.address || '', latitude: String(d.latitude), longitude: String(d.longitude),
    radius: d.radius, area: d.area ?? '', rent: d.rent ?? ''
  }
  dialog.value = true
}

async function save() {
  const f = form.value
  if (!f.name.trim()) return ElMessage.warning('请填写点位名称')
  if (!f.latitude || !f.longitude) return ElMessage.warning('请填写经纬度')
  saving.value = true
  const payload = {
    name: f.name, brand: f.brand, city: f.city, district: f.district, address: f.address,
    latitude: f.latitude, longitude: f.longitude, radius: f.radius,
    area: f.area === '' ? null : f.area,
    rent: f.rent === '' ? null : f.rent
  }
  try {
    if (editingId.value) {
      await axios.patch(`/api/candidates/${editingId.value}`, payload)
      ElMessage.success('已保存')
      dialog.value = false
      if (detail.value?.id === editingId.value) await openDetail({ id: editingId.value })
      await reload()
    } else {
      const { data } = await axios.post('/api/candidates', { ...payload, source: route.query.source || 'manual' })
      ElMessage.success('已创建')
      dialog.value = false
      await reload()
      if (data?.candidate?.id) await openDetail({ id: data.candidate.id })
    }
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `删除「${row.name}」？推进流水会一并删除，不可恢复。`,
      '删除候选点位',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch (e) {
    return
  }
  try {
    await axios.delete(`/api/candidates/${row.id}`)
    ElMessage.success('已删除')
    if (detail.value?.id === row.id) {
      drawer.value = false
      detail.value = null
    }
    await reload()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '删除失败')
  }
}

/** 地图右键选点的默认点位名：带日期时间，免得用户面对一个必填空格 */
function defaultMapName() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `地图选点 ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

onMounted(() => {
  reload()
  // 深链预填：地图页右键「加入候选点位」会带 lat / lng / source=map 过来（v1.13.335）
  const q = route.query
  if (q.lat && q.lng) {
    form.value = {
      ...emptyForm(),
      latitude: String(q.lat),
      longitude: String(q.lng),
      name: String(q.name || defaultMapName())
    }
    dialog.value = true
    // 🔴 预填后立刻清掉 query：否则关掉弹窗一刷新又弹一次（同 DataView 认 ?sale=1 的处理）
    router.replace({ path: '/candidates' })
  }
})
</script>

<style scoped>
.cand-page { padding: 20px 24px 40px; max-width: 1280px; margin: 0 auto; }
.cd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.cd-head-l h2 { margin: 4px 0 6px; font-size: 20px; font-weight: 500; }
.cd-sub { margin: 0; font-size: 13px; line-height: 1.7; color: #606266; max-width: 720px; }
.cd-head-r { display: flex; gap: 8px; flex-shrink: 0; }

.cd-stages { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.cd-stage {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  min-width: 104px; padding: 8px 14px; border-radius: 8px; cursor: pointer;
  background: #fff; border: 1px solid #e4e7ed; transition: all .15s;
}
.cd-stage:hover { border-color: var(--sc); }
.cd-stage.active { border-color: var(--sc); box-shadow: 0 0 0 2px color-mix(in srgb, var(--sc) 18%, transparent); }
.cd-stage-n { font-size: 18px; font-weight: 500; color: var(--sc); line-height: 1.2; }
.cd-stage-t { font-size: 12px; color: #606266; }
.cd-total { margin-left: auto; font-size: 13px; color: #606266; }
.cd-total b { color: #303133; }
.cd-clear { margin-left: 8px; color: #409eff; cursor: pointer; }

.cd-tools { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.cd-error { display: flex; align-items: center; gap: 6px; padding: 10px 12px; background: #fef0f0; color: #f56c6c; border-radius: 6px; font-size: 13px; }
.cd-empty { padding: 56px 0; text-align: center; color: #606266; font-size: 14px; }
.cd-empty p { margin: 0 0 8px; }
.cd-empty-hint { font-size: 13px; color: #909399; }

.cd-table { cursor: pointer; }
.cd-name { font-size: 14px; color: #303133; }
.cd-name-sub { font-size: 12px; color: #909399; margin-top: 2px; }
.cd-addr { font-size: 12px; color: #909399; margin-top: 2px; }
.cd-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; line-height: 1.6; }

.cd-detail-top { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.cd-detail-hint { font-size: 12px; color: #909399; }
.cd-info { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin: 0 0 18px; }
.cd-info > div { min-width: 0; }
.cd-info-wide { grid-column: 1 / -1; }
.cd-info dt { font-size: 12px; color: #909399; margin-bottom: 2px; }
.cd-info dd { margin: 0; font-size: 13px; color: #303133; word-break: break-all; }
.cd-drop { color: #f56c6c; }

.cd-sec { margin-bottom: 20px; }
.cd-sec h3 { font-size: 14px; font-weight: 500; margin: 0 0 10px; color: #303133; }
.cd-stage-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.cd-note-input { margin-bottom: 6px; }
.cd-sec-foot { font-size: 12px; color: #909399; }
.cd-muted { font-size: 12px; color: #909399; font-weight: 400; }
.cd-timeline { padding-left: 2px; }
.cd-note-stage { font-size: 12px; color: #606266; margin-bottom: 2px; }
.cd-note-text { font-size: 13px; color: #303133; line-height: 1.6; }
.cd-remark { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.cd-detail-actions { display: flex; gap: 8px; padding-top: 8px; border-top: 1px solid #ebeef5; }

.cd-row { display: flex; gap: 8px; width: 100%; }
.cd-tip { font-size: 12px; color: #909399; line-height: 1.6; margin-top: 4px; }
.cd-tip-inline { margin-left: 8px; font-size: 12px; color: #909399; }
</style>
