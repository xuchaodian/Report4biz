<template>
  <div class="org-panel">
    <!-- 工具条 -->
    <div class="org-toolbar">
      <el-select
        v-model="activeOrgId"
        placeholder="选择集团"
        style="width: 220px"
        :disabled="!orgs.length"
        @change="onSelectOrg"
      >
        <el-option v-for="o in orgs" :key="o.id" :label="o.name" :value="o.id">
          <span>{{ o.name }}</span>
          <span class="opt-dim">{{ o.memberCount }} 家</span>
        </el-option>
      </el-select>
      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon> 新建集团
      </el-button>
      <el-button text :loading="loading" @click="loadOrgs">
        <el-icon><RefreshRight /></el-icon> 刷新
      </el-button>

      <span v-if="activeOrg" class="org-meta">
        <el-tag size="small" type="info" effect="plain">总部 {{ activeOrg.ownerName }}</el-tag>
        <el-tag size="small" effect="plain">子公司 {{ activeOrg.memberCount }}</el-tag>
        <span class="dim">创建于 {{ fmtTime(activeOrg.createdAt) }}</span>
      </span>

      <!-- 解散集团：刻意推到工具条最右、用纯文字危险色，与「新建集团」拉开距离防误点 -->
      <el-button
        v-if="activeOrg"
        class="org-dissolve"
        text
        type="danger"
        @click="openDissolve"
      >
        <el-icon><Delete /></el-icon> 解散集团
      </el-button>
    </div>

    <!-- 空态 -->
    <el-empty
      v-if="!orgs.length"
      description="还没有集团。先「新建集团」把集团总部账号立成集团，再把各子公司账号绑进来。"
      :image-size="90"
    />

    <!-- 成员表 -->
    <template v-else-if="activeOrg">
      <div class="member-head">
        <span class="title">
          子公司成员
          <span class="dim">（共 {{ activeOrg.members.length }} 家；总部账号不在此列，其额度由平台池统一兜底）</span>
        </span>
        <el-button type="primary" plain size="small" @click="openAddMember">
          <el-icon><Plus /></el-icon> 添加子公司
        </el-button>
      </div>

      <el-table :data="activeOrg.members" border stripe size="small" empty-text="该集团还没有子公司">
        <el-table-column type="index" label="#" width="48" align="center" />
        <el-table-column label="账号" min-width="160">
          <template #default="{ row }">
            <div class="cell-name">
              <span class="name">{{ row.username }}</span>
              <span v-if="row.company" class="name-card">{{ row.company }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="可接收下发" width="110" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.canReceive"
              :loading="toggling === row.userId"
              @change="(v) => toggleField(row, 'canReceive', v)"
            />
          </template>
        </el-table-column>
        <el-table-column label="可被集团拉取" width="120" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.allowGroupPull"
              :loading="toggling === row.userId"
              @change="(v) => toggleField(row, 'allowGroupPull', v)"
            />
          </template>
        </el-table-column>
        <el-table-column label="管辖范围" min-width="150">
          <template #default="{ row }">
            <el-tooltip v-if="row.scope" :content="row.scope.cities.join('、')" placement="top">
              <el-tag size="small" type="success" effect="plain">{{ row.scopeCities }} 个城市</el-tag>
            </el-tooltip>
            <el-tag v-else size="small" type="info" effect="plain">未设置</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="知情确认" width="110" align="center">
          <template #default="{ row }">
            <el-tooltip v-if="row.consented" :content="`成员本人确认于 ${fmtTime(row.consentedAt)}`" placement="top">
              <el-tag size="small" type="success" effect="plain">已确认</el-tag>
            </el-tooltip>
            <el-tooltip v-else content="等待成员本人在「数据同步」页点击确认（合规留痕，不可代签）" placement="top">
              <el-tag size="small" type="warning" effect="plain">待确认</el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="已分配额度" width="100" align="right">
          <template #default="{ row }">
            <span class="mono">{{ row.quota }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right" align="center">
          <template #default="{ row }">
            <el-tooltip content="管辖范围设置随下一批次（ScopeEditor）上线" placement="top">
              <span>
                <el-button size="small" text disabled>设置范围</el-button>
              </span>
            </el-tooltip>
            <el-button size="small" text type="danger" @click="openUnbind(row)">解绑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <!-- 新建集团 -->
    <el-dialog v-model="createVisible" title="新建集团" width="480px" append-to-body :close-on-click-modal="false">
      <el-form label-width="92px">
        <el-form-item label="集团名称" required>
          <el-input v-model="createForm.name" maxlength="60" placeholder="如：华东集团" />
        </el-form-item>
        <el-form-item label="总部账号" required>
          <el-select
            v-model="createForm.ownerUserId"
            filterable
            placeholder="选择集团总部账号"
            style="width: 100%"
            :loading="usersLoading"
          >
            <el-option
              v-for="u in candidateOwners"
              :key="u.id"
              :label="`${u.username}${u.company ? ' · ' + u.company : ''}`"
              :value="u.id"
            />
          </el-select>
          <div class="form-tip">
            总部账号<b>不会</b>成为「组织成员」，其可用额度仍由平台配额池统一兜底 ——
            避免存量账号因历史消耗大于额度而被授权闸门拦下。
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 添加子公司 -->
    <el-dialog v-model="addVisible" title="添加子公司" width="480px" append-to-body :close-on-click-modal="false">
      <el-form label-width="110px">
        <el-form-item label="子公司账号" required>
          <el-select
            v-model="addForm.username"
            filterable
            placeholder="选择账号"
            style="width: 100%"
            :loading="usersLoading"
          >
            <el-option
              v-for="u in candidateMembers"
              :key="u.id"
              :label="`${u.username}${u.company ? ' · ' + u.company : ''}`"
              :value="u.username"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="可接收下发">
          <el-switch v-model="addForm.canReceive" />
          <span class="form-tip inline">集团可把门店/竞品数据同步到该账号</span>
        </el-form-item>
        <el-form-item label="可被集团拉取">
          <el-switch v-model="addForm.allowGroupPull" />
          <span class="form-tip inline">集团可把该账号的数据拉回总部</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitAddMember">添加</el-button>
      </template>
    </el-dialog>

    <!-- 解绑（先算影响面再确认） -->
    <el-dialog v-model="unbindVisible" title="解绑子公司" width="560px" append-to-body :close-on-click-modal="false">
      <div v-loading="impactLoading">
        <p class="unbind-lead">
          即将把 <b>{{ unbindTarget?.username }}</b> 从集团「{{ activeOrg?.name }}」中解绑。
          <b>已同步的数据默认全部保留</b>（自动转为该账号的独立副本），只有下面显式勾选的才会被清理。
        </p>
        <el-checkbox v-model="unbindForm.purgeMemberCopies" :disabled="!impact.memberCopies.total">
          清理该成员账号中由集团同步来的副本（门店 {{ impact.memberCopies.markers }} 条 / 竞品 {{ impact.memberCopies.competitors }} 条）
        </el-checkbox>
        <el-checkbox v-model="unbindForm.purgeGroupMirrors" :disabled="!impact.groupMirrors.total">
          清理集团账号中来自该成员的镜像（门店 {{ impact.groupMirrors.markers }} 条 / 竞品 {{ impact.groupMirrors.competitors }} 条）
        </el-checkbox>
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          class="unbind-note"
          title="解绑不会改动该账号的已分配额度"
          description="额度回收属于配额分配流程，系统不在解绑时静默清零，以免与分配台账对不上账。"
        />
      </div>
      <template #footer>
        <el-button @click="unbindVisible = false">取消</el-button>
        <el-button type="danger" :loading="saving" @click="submitUnbind">确认解绑</el-button>
      </template>
    </el-dialog>

    <!-- 解散集团（先算影响面再确认；v0.9 补丁） -->
    <el-dialog v-model="dissolveVisible" title="解散集团" width="580px" append-to-body :close-on-click-modal="false">
      <div v-loading="impactLoading">
        <p class="unbind-lead">
          即将解散集团 <b>{{ activeOrg?.name }}</b>（总部 <b>{{ activeOrg?.ownerName }}</b>）。
          解散后该集团会从列表中消失，界面<b>无法撤销</b>（如需重建请再走一次「新建集团」）。
        </p>

        <el-alert
          v-if="dissolveImpact.memberCount > 0"
          type="error"
          :closable="false"
          show-icon
          class="unbind-note"
          title="集团下还有子公司，不能解散"
          :description="`请先在成员表里逐个解绑这些账号，再回来解散：${dissolveMemberNames}`"
        />
        <el-alert
          v-else
          type="info"
          :closable="false"
          show-icon
          class="unbind-note"
          title="解散不删除任何门店 / 竞品数据"
          description="平台配额台账与同步审计按 append-only 规则完整保留；总部账号的已分配额度也不会在解散时被清算。"
        />

        <template v-if="dissolveImpact.memberCount === 0">
          <el-checkbox v-model="dissolveForm.purgeGroupMirrors" :disabled="!dissolveImpact.ownerMirrors.total">
            改为<b>删除</b>总部账号中由子公司同步来的镜像
            （门店 {{ dissolveImpact.ownerMirrors.markers }} 条 / 竞品 {{ dissolveImpact.ownerMirrors.competitors }} 条）
          </el-checkbox>
          <div class="form-tip">
            默认<b>保留</b>这些数据：解除只读锁并转为总部账号的自有行 —— 不丢数据，且不会留下删不掉的行。
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="dissolveVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="saving"
          :disabled="dissolveImpact.memberCount > 0"
          @click="submitDissolve"
        >确认解散</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '@/utils/api'

const orgs = ref([])
const activeOrgId = ref(null)
const users = ref([])
const loading = ref(false)
const usersLoading = ref(false)
const saving = ref(false)
const toggling = ref(null)

const createVisible = ref(false)
const addVisible = ref(false)
const unbindVisible = ref(false)
const dissolveVisible = ref(false)
const impactLoading = ref(false)

const createForm = ref({ name: '', ownerUserId: null })
const addForm = ref({ username: '', canReceive: true, allowGroupPull: true })
const unbindTarget = ref(null)
const unbindForm = ref({ purgeMemberCopies: false, purgeGroupMirrors: false })
const impact = ref({
  memberCopies: { markers: 0, competitors: 0, total: 0 },
  groupMirrors: { markers: 0, competitors: 0, total: 0 }
})

// 解散集团（v0.9 补丁）：dryRun 影响面
const dissolveForm = ref({ purgeGroupMirrors: false })
const dissolveImpact = ref({
  memberCount: 0,
  members: [],
  ownerMirrors: { markers: 0, competitors: 0, total: 0 },
  ledgerRows: 0,
  syncBatches: 0
})

const activeOrg = computed(() => orgs.value.find(o => o.id === activeOrgId.value) || null)

/** 解散被拦下时提示「还需要先解绑哪些账号」 */
const dissolveMemberNames = computed(() =>
  (dissolveImpact.value.members || []).map(m => m.username).join('、')
)

/** 总部候选：排除平台 admin、已是他家总部 / 已属其他集团的账号 */
const orgOwnerIds = computed(() => new Set(orgs.value.map(o => o.ownerUserId)))
const memberIds = computed(() => new Set(orgs.value.flatMap(o => (o.members || []).map(m => m.userId))))
const candidateOwners = computed(() =>
  users.value.filter(u => u.role !== 'admin' && !orgOwnerIds.value.has(u.id) && !memberIds.value.has(u.id))
)
const candidateMembers = computed(() =>
  users.value.filter(u => u.role !== 'admin' && !orgOwnerIds.value.has(u.id) && !memberIds.value.has(u.id))
)

function fmtTime(t) {
  if (!t) return '-'
  const s = String(t).replace('T', ' ')
  return s.length > 16 ? s.slice(0, 16) : s
}

function errMsg(e, fallback) {
  return e?.response?.data?.message || fallback
}

async function loadOrgs(keepSelection = true) {
  loading.value = true
  try {
    const res = await api.get('/orgs')
    orgs.value = res.orgs || []
    if (!keepSelection || !orgs.value.some(o => o.id === activeOrgId.value)) {
      activeOrgId.value = orgs.value[0]?.id ?? null
    }
  } catch (e) {
    ElMessage.error(errMsg(e, '加载集团列表失败'))
  } finally {
    loading.value = false
  }
}

async function loadUsers() {
  usersLoading.value = true
  try {
    const res = await api.get('/users')
    users.value = res.users || []
  } catch (e) {
    ElMessage.error(errMsg(e, '加载账号列表失败'))
  } finally {
    usersLoading.value = false
  }
}

function onSelectOrg() { /* 数据已在列表里，切换即渲染 */ }

function openCreate() {
  createForm.value = { name: '', ownerUserId: null }
  createVisible.value = true
  if (!users.value.length) loadUsers()
}

async function submitCreate() {
  if (!createForm.value.name.trim()) return ElMessage.warning('请填写集团名称')
  if (!createForm.value.ownerUserId) return ElMessage.warning('请选择总部账号')
  saving.value = true
  try {
    const res = await api.post('/orgs', {
      name: createForm.value.name.trim(),
      ownerUserId: createForm.value.ownerUserId
    })
    ElMessage.success(`集团「${res.org.name}」已创建`)
    createVisible.value = false
    await loadOrgs(false)
    activeOrgId.value = res.org.id
  } catch (e) {
    ElMessage.error(errMsg(e, '创建集团失败'))
  } finally {
    saving.value = false
  }
}

function openAddMember() {
  addForm.value = { username: '', canReceive: true, allowGroupPull: true }
  addVisible.value = true
  if (!users.value.length) loadUsers()
}

async function submitAddMember() {
  if (!addForm.value.username) return ElMessage.warning('请选择子公司账号')
  saving.value = true
  try {
    await api.post(`/orgs/${activeOrgId.value}/members`, { ...addForm.value })
    ElMessage.success('已绑定子公司')
    addVisible.value = false
    await loadOrgs()
  } catch (e) {
    ElMessage.error(errMsg(e, '绑定子公司失败'))
  } finally {
    saving.value = false
  }
}

async function toggleField(row, field, value) {
  toggling.value = row.userId
  try {
    const res = await api.patch(`/orgs/${activeOrgId.value}/members/${row.userId}`, { [field]: value })
    const m = res.member
    row.canReceive = m.canReceive
    row.allowGroupPull = m.allowGroupPull
    ElMessage.success('已更新')
  } catch (e) {
    ElMessage.error(errMsg(e, '更新失败'))
    await loadOrgs()
  } finally {
    toggling.value = null
  }
}

async function openUnbind(row) {
  unbindTarget.value = row
  unbindForm.value = { purgeMemberCopies: false, purgeGroupMirrors: false }
  unbindVisible.value = true
  impactLoading.value = true
  try {
    const res = await api.delete(`/orgs/${activeOrgId.value}/members/${row.userId}`, { params: { dryRun: 1 } })
    const imp = res.impact || {}
    const mc = imp.memberCopies || {}
    const gm = imp.groupMirrors || {}
    impact.value = {
      memberCopies: { markers: mc.markers || 0, competitors: mc.competitors || 0, total: (mc.markers || 0) + (mc.competitors || 0) },
      groupMirrors: { markers: gm.markers || 0, competitors: gm.competitors || 0, total: (gm.markers || 0) + (gm.competitors || 0) }
    }
  } catch (e) {
    ElMessage.error(errMsg(e, '计算解绑影响失败'))
    unbindVisible.value = false
  } finally {
    impactLoading.value = false
  }
}

async function submitUnbind() {
  saving.value = true
  try {
    await api.delete(`/orgs/${activeOrgId.value}/members/${unbindTarget.value.userId}`, {
      params: {
        purgeMemberCopies: unbindForm.value.purgeMemberCopies ? 1 : 0,
        purgeGroupMirrors: unbindForm.value.purgeGroupMirrors ? 1 : 0
      }
    })
    ElMessage.success('已解绑')
    unbindVisible.value = false
    await loadOrgs()
  } catch (e) {
    ElMessage.error(errMsg(e, '解绑失败'))
  } finally {
    saving.value = false
  }
}

/**
 * 解散集团（v0.9 补丁）—— 先 dryRun 算影响面，再让用户确认。
 * 后端有「成员数必须为 0」硬门槛，这里提前把结果摆出来并把确认按钮置灰，
 * 避免用户填完才吃 409（同时也解释了"为什么不能解散"）。
 */
async function openDissolve() {
  dissolveForm.value = { purgeGroupMirrors: false }
  dissolveImpact.value = {
    memberCount: 0,
    members: [],
    ownerMirrors: { markers: 0, competitors: 0, total: 0 },
    ledgerRows: 0,
    syncBatches: 0
  }
  dissolveVisible.value = true
  impactLoading.value = true
  try {
    const res = await api.delete(`/orgs/${activeOrgId.value}`, { params: { dryRun: 1 } })
    const imp = res.impact || {}
    const om = imp.ownerMirrors || {}
    dissolveImpact.value = {
      memberCount: imp.memberCount || 0,
      members: imp.members || [],
      ownerMirrors: {
        markers: om.markers || 0,
        competitors: om.competitors || 0,
        total: (om.markers || 0) + (om.competitors || 0)
      },
      ledgerRows: imp.ledgerRows || 0,
      syncBatches: imp.syncBatches || 0
    }
  } catch (e) {
    ElMessage.error(errMsg(e, '计算解散影响失败'))
    dissolveVisible.value = false
  } finally {
    impactLoading.value = false
  }
}

async function submitDissolve() {
  const name = activeOrg.value?.name
  saving.value = true
  try {
    const res = await api.delete(`/orgs/${activeOrgId.value}`, {
      params: { purgeGroupMirrors: dissolveForm.value.purgeGroupMirrors ? 1 : 0 }
    })
    const handled = res.released
      ? (res.released.markers || 0) + (res.released.competitors || 0)
      : (res.purged ? (res.purged.markers || 0) + (res.purged.competitors || 0) : 0)
    ElMessage.success(
      `集团「${name}」已解散` + (handled ? `（已处理 ${handled} 条镜像数据）` : '')
    )
    dissolveVisible.value = false
    await loadOrgs(false)
  } catch (e) {
    ElMessage.error(errMsg(e, '解散集团失败'))
    await loadOrgs()
  } finally {
    saving.value = false
  }
}

onMounted(loadOrgs)

defineExpose({ reload: loadOrgs })
</script>

<style lang="scss" scoped>
.org-panel {
  padding: 4px 2px;
}

.org-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.org-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 4px;
}

.org-dissolve {
  margin-left: auto;
}

.opt-dim {
  float: right;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.member-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;

  .title {
    font-weight: 600;
    color: var(--el-text-color-primary);
  }
}

.dim {
  color: var(--el-text-color-secondary);
  font-weight: 400;
  font-size: 12px;
}

.cell-name {
  display: flex;
  align-items: center;
  gap: 6px;

  .name {
    font-weight: 500;
  }

  .name-card {
    font-size: 11px;
    line-height: 16px;
    padding: 0 6px;
    border-radius: 9px;
    background: var(--el-fill-color-light);
    color: var(--el-text-color-regular);
  }
}

.mono {
  font-variant-numeric: tabular-nums;
}

.form-tip {
  margin-top: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--el-text-color-secondary);

  &.inline {
    margin: 0 0 0 10px;
    display: inline;
  }
}

.unbind-lead {
  margin: 0 0 12px;
  line-height: 20px;
  color: var(--el-text-color-regular);
}

.unbind-note {
  margin-top: 12px;
}

:deep(.el-checkbox) {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
</style>
