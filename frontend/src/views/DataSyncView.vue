<template>
  <div class="data-sync-view">
    <el-card shadow="never" class="ds-card">
      <template #header>
        <div class="ds-header">
          <span class="ds-title">🔗 数据同步</span>
          <span class="ds-sub">
            集团 ↔ 子公司「按需手动同步」：先预览、后确认，每次留痕可审计。
            管辖范围由集团设定，同步过来的门店为只读镜像。
          </span>
        </div>
      </template>

      <div v-if="loadingOrg" class="ds-loading">正在读取组织信息…</div>

      <el-empty
        v-else-if="!role"
        :image-size="90"
        description="当前账号不属于任何集团"
      >
        <div class="ds-empty-tip">
          数据同步用于「集团总部 ↔ 子公司」之间按管辖范围同步门店数据。<br>
          账号归属由平台管理员在「用户管理 → 集团 / 子公司」中绑定。
        </div>
      </el-empty>

      <template v-else>
        <!-- 组织信息条 -->
        <div class="ds-orgbar">
          <span class="ds-orgname">{{ orgName }}</span>
          <el-tag size="small" :type="isMember ? 'info' : 'success'" effect="plain">
            {{ isMember ? '子公司' : '集团总部' }}
          </el-tag>
          <span v-if="!isMember" class="ds-orgmeta">成员 {{ members.length }} 个</span>
          <span v-else class="ds-orgmeta">
            管辖范围 {{ scopeCities.length ? scopeCities.join(' / ') : '未设置' }}
          </span>
          <el-button size="small" text type="primary" style="margin-left:auto" @click="loadAll">刷新</el-button>
        </div>

        <!-- ① 从集团同步（仅子公司） -->
        <div v-if="isMember" class="ds-block">
          <div class="ds-block-head">
            <span class="ds-block-title">① 从集团同步</span>
            <span class="ds-block-note">把集团授权给你的门店同步到本账号（只读镜像，由集团维护）</span>
          </div>

          <el-alert
            v-if="!scopeCities.length"
            type="warning"
            :closable="false"
            show-icon
            style="margin-bottom:12px;"
          >
            <template #title>
              尚未为你设置管辖范围 —— 没有任何数据可同步。请联系集团管理员在「用户管理 → 集团 / 子公司 → 设置范围」里勾选城市。
            </template>
          </el-alert>

          <el-alert
            v-else-if="!canReceive"
            type="warning"
            :closable="false"
            show-icon
            style="margin-bottom:12px;"
          >
            <template #title>你已关闭「接收集团下发」，集团无法向你下发数据。</template>
          </el-alert>

          <template v-else>
            <div class="ds-filter">
              <span class="ds-label">数据范围</span>
              <el-checkbox v-model="kinds.markers">我的门店</el-checkbox>
              <el-checkbox v-model="kinds.competitors">竞品门店</el-checkbox>

              <span class="ds-label" style="margin-left:16px;">本次筛选</span>
              <el-select
                v-model="filter.cities"
                multiple
                collapse-tags
                collapse-tags-tooltip
                clearable
                placeholder="全部管辖城市"
                size="small"
                style="width:220px;"
              >
                <el-option
                  v-for="c in filterCityOptions"
                  :key="c.key"
                  :label="`${c.name}（${c.count}）`"
                  :value="c.name"
                />
              </el-select>
              <el-select
                v-model="filter.brands"
                multiple
                collapse-tags
                collapse-tags-tooltip
                clearable
                placeholder="全部品牌"
                size="small"
                style="width:170px;"
              >
                <el-option v-for="b in scopeBrandOptions" :key="b" :label="b" :value="b" />
              </el-select>
              <el-input
                v-model="filter.keyword"
                placeholder="门店名 / 编号 / 地址"
                clearable
                size="small"
                style="width:190px;"
              />
              <el-button size="small" @click="loadCandidates">查候选</el-button>
            </div>

            <div class="ds-candbar">
              <span>候选 <b class="ds-num">{{ candidateSummary.inScope }}</b> 家</span>
              <span v-if="candidateSummary.outOfScope" class="ds-muted">
                · 范围外丢弃 {{ candidateSummary.outOfScope }} 条
              </span>
              <span v-if="candidateSummary.outOfFilter" class="ds-muted">
                · 筛选外丢弃 {{ candidateSummary.outOfFilter }} 条
              </span>
              <span v-if="candidateSummary.selfOrigin" class="ds-muted">
                · 防回环跳过 {{ candidateSummary.selfOrigin }} 条
              </span>
              <span v-if="lastSync" class="ds-muted" style="margin-left:auto;">上次同步：{{ lastSync }}</span>
            </div>

            <div class="ds-actions">
              <el-button type="primary" size="small" :loading="previewing" @click="doPreview">预览</el-button>
              <span class="ds-muted">预览不会写入数据；确认同步才真正落地</span>
            </div>
          </template>
        </div>

        <!-- ② 从子公司同步（仅集团/管理员） -->
        <div v-if="!isMember" class="ds-block">
          <div class="ds-block-head">
            <span class="ds-block-title">② 从子公司同步</span>
            <span class="ds-block-note">集团主动拉取子公司数据（子公司可自行关闭「允许集团拉取」）</span>
          </div>

          <div v-if="!members.length" class="ds-muted" style="padding:6px 0;">
            本集团还没有成员。请先在「用户管理 → 集团 / 子公司」里绑定子公司账号。
          </div>

          <template v-else>
            <div class="ds-filter">
              <span class="ds-label">选择子公司</span>
              <el-select v-model="targetMember" placeholder="请选择要拉取的子公司" size="small" style="width:260px;">
                <el-option
                  v-for="m in members"
                  :key="m.userId"
                  :label="memberLabel(m)"
                  :value="m.userId"
                  :disabled="!canPull(m)"
                />
              </el-select>
              <span class="ds-label" style="margin-left:16px;">数据范围</span>
              <el-checkbox v-model="kinds.markers">我的门店</el-checkbox>
              <el-checkbox v-model="kinds.competitors">竞品门店</el-checkbox>
            </div>

            <el-alert
              v-if="targetMember && !targetScopeCities.length"
              type="warning"
              :closable="false"
              show-icon
              style="margin-bottom:12px;"
            >
              <template #title>
                该子公司尚未设置管辖范围 —— 无可拉取的行。请先点「设置范围」勾选城市。
              </template>
            </el-alert>

            <div v-if="targetMember && targetScopeCities.length" class="ds-candbar">
              <span>该子公司管辖范围：{{ targetScopeCities.join(' / ') }}</span>
              <span class="ds-muted">· 仅该范围内的行会被同步（越界自动丢弃）</span>
            </div>

            <div class="ds-actions">
              <el-button
                type="primary"
                size="small"
                :loading="previewing"
                :disabled="!targetMember"
                @click="doPreview"
              >预览</el-button>
              <span class="ds-muted">一次只预览一个子公司；集团总部账号自己的数据不会被改动</span>
            </div>
          </template>
        </div>

        <!-- ③ 预览明细 -->
        <div v-if="preview" class="ds-block ds-preview">
          <div class="ds-block-head">
            <span class="ds-block-title">③ 预览明细</span>
            <span class="ds-block-note">
              批次 #{{ preview.batchId }} ·
              {{ preview.direction === 'group_to_member' ? '集团 → 子公司' : '子公司 → 集团' }} ·
              {{ previewPath }}
            </span>
          </div>

          <div class="ds-counts">
            <el-tag type="success" effect="dark" size="small">新增 {{ preview.counts.added }}</el-tag>
            <el-tag type="primary" effect="dark" size="small">更新 {{ preview.counts.updated }}</el-tag>
            <el-tag type="danger" effect="dark" size="small">删除 {{ preview.counts.deleted }}</el-tag>
            <el-tag type="info" size="small">跳过 {{ preview.counts.skipped }}</el-tag>
            <span v-if="preview.counts.outOfScope" class="ds-muted">
              范围外静默丢弃 {{ preview.counts.outOfScope }} 条
            </span>
          </div>

          <el-alert
            v-if="preview.counts.deleted"
            type="error"
            :closable="false"
            show-icon
            style="margin-bottom:10px;"
          >
            <template #title>
              有 {{ preview.counts.deleted }} 行「源侧已删除」的镜像将被一并删除（删除传播）。
              如不希望删除，请在下方取消勾选对应行。
            </template>
          </el-alert>

          <el-table
            v-if="previewRows.length"
            ref="previewTableRef"
            :data="previewRows"
            size="small"
            max-height="360"
            style="width:100%;"
            row-key="key"
            @selection-change="onPreviewSelection"
          >
            <el-table-column type="selection" width="42" :selectable="() => true" />
            <el-table-column label="动作" width="82">
              <template #default="{ row }">
                <el-tag :type="actionTagType(row.action)" size="small" effect="plain">{{ actionLabel(row.action) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="90">
              <template #default="{ row }">{{ kindLabel(row.kind) }}</template>
            </el-table-column>
            <el-table-column prop="name" label="门店名称" min-width="150" show-overflow-tooltip />
            <el-table-column prop="store_code" label="门店编号" width="100" show-overflow-tooltip />
            <el-table-column prop="city" label="城市" width="90" show-overflow-tooltip />
            <el-table-column label="说明" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.action === 'deleted'" class="ds-danger">源侧已删除</span>
                <span v-else-if="row.action === 'updated'" class="ds-changes">{{ changeText(row) }}</span>
                <span v-else class="ds-muted">新增到目标账号</span>
              </template>
            </el-table-column>
          </el-table>
          <div v-else class="ds-muted" style="padding:8px 0;">
            本批次没有需要写入的变更（全部为「无变化」或「防回环跳过」）。
          </div>

          <div class="ds-actions" style="margin-top:12px;">
            <el-button size="small" @click="preview = null">取消</el-button>
            <el-button
              type="primary"
              size="small"
              :loading="committing"
              :disabled="!previewRows.length"
              @click="doCommit"
            >确认同步（{{ checkedCount }} 行）</el-button>
          </div>
        </div>

        <!-- ④ 我已同步的数据（外来副本） -->
        <div class="ds-block">
          <div class="ds-block-head">
            <span class="ds-block-title">④ 我已同步到的数据</span>
            <span class="ds-block-note">来自其他账号的只读镜像；本账号不能直接改/删</span>
          </div>
          <div v-if="!mirrors.length" class="ds-muted" style="padding:6px 0;">
            本账号名下暂无外来数据。
          </div>
          <template v-else>
            <div class="ds-candbar">
              <span>共 <b class="ds-num">{{ mirrors.length }}</b> 行</span>
              <span v-for="g in mirrorBySource" :key="g.name" class="ds-muted">· {{ g.name }} {{ g.count }}</span>
            </div>
            <el-table :data="mirrors" size="small" max-height="240" style="width:100%">
              <el-table-column label="类型" width="90">
                <template #default="{ row }">{{ kindLabel(row.kind) }}</template>
              </el-table-column>
              <el-table-column prop="name" label="门店名称" min-width="150" show-overflow-tooltip />
              <el-table-column prop="city" label="城市" width="90" show-overflow-tooltip />
              <el-table-column prop="origin_owner" label="来源账号" width="150" show-overflow-tooltip />
              <el-table-column label="操作" width="190">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="doDetach(row)">脱离同步</el-button>
                  <el-button link type="danger" size="small" @click="doRemoveForeign(row)">移除副本</el-button>
                </template>
              </el-table-column>
            </el-table>
            <div class="ds-muted" style="margin-top:6px;">
              「脱离同步」→ 转为本账号自有行，此后不再被来源覆盖；「移除副本」→ 只删本账号这一份，来源数据不受影响。
            </div>
          </template>
        </div>

        <!-- ⑤ 同步历史 -->
        <div class="ds-block">
          <div class="ds-block-head">
            <span class="ds-block-title">⑤ 同步历史</span>
            <span class="ds-block-note">每次确认同步都会留痕（含操作人 / IP / 逐行明细）</span>
          </div>
          <div v-if="!history.length" class="ds-muted" style="padding:6px 0;">暂无同步记录。</div>
          <el-table v-else :data="history" size="small" max-height="300" style="width:100%">
            <el-table-column prop="createdAt" label="时间" width="160" />
            <el-table-column label="方向" width="130">
              <template #default="{ row }">
                {{ row.direction === 'group_to_member' ? '集团 → 子公司' : '子公司 → 集团' }}
              </template>
            </el-table-column>
            <el-table-column label="增 / 改 / 删" width="130">
              <template #default="{ row }">
                <span class="ds-ok">+{{ row.inserted }}</span> /
                <span class="ds-warn">{{ row.updated }}</span> /
                <span class="ds-danger">-{{ row.deleted }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="skipped" label="跳过" width="70" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="statusTagType(row.status)" size="small" effect="plain">{{ statusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="90">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="showBatch(row)">详情</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- ⑥ 配额分配（仅集团总部） -->
        <div v-if="!isMember" class="ds-block">
          <div class="ds-block-head">
            <span class="ds-block-title">⑥ 配额分配</span>
            <span class="ds-block-note">从「全池可分配」向子公司分配联通配额（只增不减 · 双写台账 · 不动物理池）</span>
          </div>
          <div v-if="loadingQuota" class="ds-muted" style="padding:6px 0;">正在读取配额…</div>
          <template v-else-if="quota">
            <div class="ds-quota-pool">
              <div class="ds-quota-card">
                <span class="ds-quota-label">上游总配额</span>
                <b class="ds-quota-num">{{ quota.poolTotal }}</b>
              </div>
              <div class="ds-quota-card">
                <span class="ds-quota-label">当前剩余</span>
                <b class="ds-quota-num">{{ quota.remaining }}</b>
              </div>
              <div class="ds-quota-card ds-quota-hl">
                <span class="ds-quota-label">可分配</span>
                <b class="ds-quota-num">{{ quota.allocatable }}</b>
              </div>
              <div class="ds-quota-card">
                <span class="ds-quota-label">已占用</span>
                <b class="ds-quota-num">{{ quota.occupied }}</b>
              </div>
            </div>
            <div v-if="!quota.members.length" class="ds-muted" style="padding:6px 0;">
              本集团还没有成员，无法分配。请先在「用户管理 → 集团 / 子公司」绑定子公司账号。
            </div>
            <el-table v-else :data="quota.members" size="small" max-height="300" style="width:100%; margin-top:10px;">
              <el-table-column prop="name" label="子公司" min-width="160" show-overflow-tooltip />
              <el-table-column prop="quota" label="当前配额" width="90" />
              <el-table-column prop="used" label="已消耗" width="80" />
              <el-table-column prop="remain" label="剩余" width="80" />
              <el-table-column prop="grantedTotal" label="累计获赠" width="90" />
              <el-table-column label="操作" width="80">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="openAllocate(row)">分配</el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
          <div v-else class="ds-muted" style="padding:6px 0;">暂无配额信息。</div>
        </div>
      </template>
    </el-card>

    <!-- 配额分配弹窗（一级分配 · 只增不减） -->
    <el-dialog v-model="allocateDialog.visible" title="分配配额" width="440px" append-to-body>
      <div class="ds-allocate-head">
        向 <b>{{ allocateDialog.memberName }}</b> 分配联通配额
        <span class="ds-muted">（一级分配 · 只增不减 · 双写台账）</span>
      </div>
      <el-form label-width="86px" style="margin-top:14px;">
        <el-form-item label="可分配余额">
          <b class="ds-quota-num">{{ quota?.allocatable ?? 0 }}</b>
          <span class="ds-muted" style="margin-left:8px;">全池可分配上限</span>
        </el-form-item>
        <el-form-item label="分配额度">
          <el-input-number
            v-model="allocateDialog.amount"
            :min="1"
            :max="Math.max(1, quota?.allocatable ?? 1)"
            :step="1"
            step-strictly
            controls-position="right"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="allocateDialog.note" placeholder="可选，如「华东区 Q3 配额」" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="allocateDialog.visible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="allocating" @click="doAllocate">确认分配</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '@/utils/api'

const loadingOrg = ref(true)
const role = ref(null)          // 'owner' | 'member' | null
const orgId = ref(null)
const orgName = ref('')
const members = ref([])
const myMember = ref(null)

const scopeCities = ref([])
const scopeBrands = ref([])
const cityOptions = ref([])     // [{name, key, count}]
const brandOptions = ref([])

const filter = ref({ cities: [], brands: [], keyword: '' })
const kinds = ref({ markers: true, competitors: false })
const selectedKinds = computed(() => Object.keys(kinds.value).filter(k => kinds.value[k]))
const kindsParam = computed(() => selectedKinds.value.join(','))
const candidateSummary = ref({ inScope: 0, outOfScope: 0, outOfFilter: 0, selfOrigin: 0 })
const targetMember = ref(null)
const targetScopeCities = ref([])

const previewTableRef = ref(null)
const preview = ref(null)
const checkedKeys = ref([])
const previewing = ref(false)
const committing = ref(false)

const mirrors = ref([])
const mirrorBySource = ref([])
const history = ref([])
const lastSync = ref('')

const quota = ref(null)
const loadingQuota = ref(false)
const allocateDialog = ref({ visible: false, userId: null, memberName: '', amount: 1, note: '' })
const allocating = ref(false)

const isMember = computed(() => role.value === 'member')
const canReceive = computed(() => Number(myMember.value?.canReceive ?? 1) !== 0)
const canPull = (m) => Number(m?.allowGroupPull ?? 1) !== 0

const filterCityOptions = computed(() => {
  const allow = new Set(scopeCities.value)
  const opts = cityOptions.value.filter(c => allow.has(c.name))
  return opts.length ? opts : cityOptions.value.filter(c => allow.has(c.key) || allow.has(c.name))
})
const scopeBrandOptions = computed(() => {
  if (!scopeBrands.value.length) return brandOptions.value
  const allow = new Set(scopeBrands.value)
  return brandOptions.value.filter(b => allow.has(b))
})

const previewRows = computed(() => {
  if (!preview.value) return []
  const { added, updated, deleted } = preview.value.items
  return [
    ...added.map(i => ({ ...i, action: 'added' })),
    ...updated.map(i => ({ ...i, action: 'updated' })),
    ...deleted.map(i => ({ ...i, action: 'deleted' }))
  ]
})
const checkedCount = computed(() => checkedKeys.value.length)

// 预览标题的「源 → 目标」路径（按方向取名字，避免 member_to_group 时显示成「子公司 → 子公司」）
const previewPath = computed(() => {
  const p = preview.value
  if (!p) return ''
  return p.direction === 'group_to_member'
    ? `${p.sourceName} → ${p.memberName}`
    : `${p.sourceName} → ${p.targetName || '集团'}`
})

function memberLabel (m) {
  const n = m.company || m.username || `#${m.userId}`
  const tag = canPull(m) ? '' : '（已关闭集团拉取）'
  const scope = (m.scope?.cities || []).length ? ` · ${m.scope.cities.length} 城` : ' · 未设范围'
  return `${n}${scope}${tag}`
}

function changeText (row) {
  return (row.changes || []).map(c => `${c.field}: ${fmt(c.from)} → ${fmt(c.to)}`).join('；')
}
const fmt = (v) => (v === null || v === undefined || v === '') ? '空' : String(v)

const actionLabel = (a) => ({ added: '新增', updated: '更新', deleted: '删除' }[a] || a)
const actionTagType = (a) => ({ added: 'success', updated: 'primary', deleted: 'danger' }[a] || 'info')
const statusLabel = (s) => ({
  success: '成功', partial: '部分成功', failed: '失败', preview: '预览', rolled_back: '已回滚'
}[s] || s)
const statusTagType = (s) => ({ success: 'success', partial: 'warning', failed: 'danger' }[s] || 'info')
const KIND_LABEL = { markers: '我的门店', competitors: '竞品门店' }
const kindLabel = (k) => KIND_LABEL[k] || '未知'

// ⚠️ utils/api.js 的响应拦截器已经返回 `response.data`，
//    所以 api.get/post 的返回值**就是响应体**，不能再取 `.data`（曾因此整页空态）
async function safeGet (url, params) {
  return api.get(url, params ? { params } : undefined)
}

async function loadAll () {
  loadingOrg.value = true
  try {
    const me = await safeGet('/orgs/me')
    role.value = me.role || null
    if (!role.value) return

    orgId.value = me.org.id
    orgName.value = me.org.name
    // ⚠️ 集团视角的成员表挂在 org.members 下（不是顶层 me.members）——批次 D 踩过：
    //    读错层级会让集团页显示「成员 0 个 / 本集团还没有成员」，从而根本没入口拉取子公司
    members.value = me.role === 'owner' ? (me.org?.members || []) : []
    myMember.value = me.role === 'member' ? me.member : null
    if (me.role === 'member') {
      scopeCities.value = me.member?.scope?.cities || []
      scopeBrands.value = me.member?.scope?.brands || []
    }

    // 下拉选项是「锦上添花」——单独 try，避免它失败把后面的候选/历史一起带崩
    try {
      const opts = await safeGet('/sync/scope-options', { orgId: orgId.value, userId: isMember.value ? undefined : targetMember.value })
      cityOptions.value = opts.cities || []
      brandOptions.value = opts.brands || []
    } catch (e) {
      console.error('读取下拉选项失败:', e)
      ElMessage.warning('读取管辖范围选项失败，下拉可能为空')
    }

    if (isMember.value) await loadCandidates()
    await Promise.all([loadMirrors(), loadHistory()])
    if (!isMember.value) await loadQuota()
  } catch (e) {
    console.error('读取组织信息失败:', e)
    ElMessage.error('读取组织信息失败')
  } finally {
    loadingOrg.value = false
  }
}

async function loadCandidates () {
  if (isMember.value) {
    try {
      const d = await safeGet('/sync/candidates', { kind: kindsParam.value, direction: 'group_to_member', cities: filter.value.cities.join(','), brands: filter.value.brands.join(','), keyword: filter.value.keyword })
      candidateSummary.value = {
        inScope: d.inScope.length, outOfScope: d.outOfScope, outOfFilter: d.outOfFilter, selfOrigin: d.selfOrigin
      }
    } catch (e) {
      console.error('查询候选失败:', e)
    }
  }
}

async function loadTargetScope () {
  targetScopeCities.value = []
  if (!targetMember.value) return
  try {
    const d = await safeGet(`/orgs/${orgId.value}/members/${targetMember.value}/scope`)
    targetScopeCities.value = d.scope?.cities || []
  } catch (e) {
    console.error('读取子公司管辖范围失败:', e)
  }
}

async function doPreview () {
  previewing.value = true
  try {
    const body = isMember.value
      ? { userId: myMember.value.userId, direction: 'group_to_member', kinds: selectedKinds.value, filter: filter.value }
      : { userId: targetMember.value, direction: 'member_to_group', kinds: selectedKinds.value, filter: { keyword: '' } }
    const d = await api.post('/sync/preview', body)
    preview.value = d
    checkedKeys.value = [
      ...d.items.added.map(i => i.key),
      ...d.items.updated.map(i => i.key),
      ...d.items.deleted.map(i => i.key)
    ]
    // ★ 让表格自身的勾选态与 checkedKeys 一致（默认全选）。
    //   只设 checkedKeys 不动表格 → 复选框全显示未勾选，但按钮写「N 行」；
    //   用户随手点一行会瞬间掉到「1 行」（UI 验证时实际踩到）。
    await nextTick()
    previewTableRef.value?.toggleAllSelection?.()
    if (!previewRows.value.length) {
      ElMessage.info('没有需要同步的变更（数据已是最新）')
    } else {
      ElMessage.success(`已生成预览：批次 #${d.batchId}`)
    }
  } catch (e) {
    const msg = e?.response?.data?.message || '生成预览失败'
    ElMessage.error(msg)
  } finally {
    previewing.value = false
  }
}

function onPreviewSelection (rows) {
  checkedKeys.value = rows.map(r => r.key)
}

async function doCommit () {
  try {
    await ElMessageBox.confirm(
      `将按预览结果写入 ${checkedCount.value} 行变更（其中删除 ${preview.value.counts.deleted} 行）。` +
      '写入在同一事务内完成，任一步失败整体回滚。确认继续？',
      '确认同步', { type: 'warning' }
    )
  } catch (e) { return }   // 用户取消

  committing.value = true
  try {
    const all = [...preview.value.items.added, ...preview.value.items.updated, ...preview.value.items.deleted].map(i => i.key)
    const excluded = all.filter(k => !checkedKeys.value.includes(k))
    const d = await api.post('/sync/commit', { batchId: preview.value.batchId, excluded })
    ElMessage.success(
      `同步完成：新增 ${d.applied.inserted} / 更新 ${d.applied.updated} / 删除 ${d.applied.deleted}` +
      (d.applied.failed ? ` / 失败 ${d.applied.failed}` : '')
    )
    preview.value = null
    await refreshAndReload()
  } catch (e) {
    const msg = e?.response?.data?.message || '提交同步失败（已整体回滚）'
    ElMessage.error(msg)
  } finally {
    committing.value = false
  }
}

async function refreshAndReload () {
  await Promise.all([loadCandidates(), loadMirrors(), loadHistory()])
  return role.value
}

async function loadMirrors () {
  try {
    const d = await safeGet('/sync/mirrors', { kind: 'all', limit: 500 })
    mirrors.value = d.mirrors || []
    mirrorBySource.value = d.bySource || []
  } catch (e) {
    console.error('读取外来副本失败:', e)
  }
}

async function loadHistory () {
  try {
    const d = await safeGet('/sync/batches', { limit: 30 })
    history.value = d.batches || []
    if (history.value.length) {
      const b = history.value[0]
      lastSync.value = `${b.createdAt} · 新增 ${b.inserted} / 更新 ${b.updated}`
    }
  } catch (e) {
    console.error('读取同步历史失败:', e)
  }
}

async function doDetach (row) {
  try {
    await ElMessageBox.confirm(
      `「${row.name}」将脱离同步，成为本账号自有门店，此后不再被「${row.origin_owner}」覆盖。确认？`,
      '脱离同步', { type: 'warning' }
    )
  } catch (e) { return }
  try {
    const d = await api.post('/sync/detach', { kind: row.kind || 'markers', ids: [row.id] })
    ElMessage.success(d.message || '已脱离同步')
    await Promise.all([loadMirrors(), loadHistory()])
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '脱离同步失败')
  }
}

async function doRemoveForeign (row) {
  try {
    await ElMessageBox.confirm(
      `将从本账号移除副本「${row.name}」。来源账号「${row.origin_owner}」的数据不受影响，但下次同步会再次下发。确认？`,
      '移除副本', { type: 'warning' }
    )
  } catch (e) { return }
  try {
    const d = await api.post('/sync/foreign/remove', { kind: row.kind || 'markers', ids: [row.id] })
    ElMessage.success(d.message || '已移除')
    await loadMirrors()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '移除失败')
  }
}

async function showBatch (row) {
  try {
    const d = await safeGet(`/sync/batches/${row.id}`)
    const p = d.batch?.planned
    const lines = [
      `批次 #${d.batch.id}`,
      `方向：${d.batch.direction === 'group_to_member' ? '集团 → 子公司' : '子公司 → 集团'}`,
      `${d.sourceName} → ${d.targetName}`,
      `状态：${statusLabel(d.batch.status)}`,
      p ? `计划：新增 ${p.added} / 更新 ${p.updated} / 删除 ${p.deleted} / 跳过 ${p.skipped}` : '',
      `结果：新增 ${d.batch.inserted} / 更新 ${d.batch.updated} / 删除 ${d.batch.deleted} / 失败 ${d.batch.failed}`,
      `操作人 ID：${d.batch.createdBy}　IP：${d.batch.ip || '-'}`,
      `时间：${d.batch.createdAt} → ${d.batch.finishedAt || '-'}`
    ].filter(Boolean)
    await ElMessageBox.alert(lines.join('<br>'), '批次详情', { dangerouslyUseHTMLString: true })
  } catch (e) {
    ElMessage.error('读取批次详情失败')
  }
}

// ---- 配额分配（仅集团总部）----
async function loadQuota () {
  if (isMember.value) return
  loadingQuota.value = true
  try {
    quota.value = await safeGet(`/orgs/${orgId.value}/quota/summary`)
  } catch (e) {
    console.error('读取配额总览失败:', e)
    quota.value = null
  } finally {
    loadingQuota.value = false
  }
}

function openAllocate (m) {
  allocateDialog.value = {
    visible: true,
    userId: m.userId,
    memberName: m.name,
    amount: 1,
    note: ''
  }
}

async function doAllocate () {
  const amount = Number(allocateDialog.value.amount)
  const allocatable = quota.value?.allocatable ?? 0
  if (!Number.isInteger(amount) || amount <= 0) {
    ElMessage.warning('分配额度必须是正整数')
    return
  }
  if (amount > allocatable) {
    ElMessage.warning(`可分配余额不足：当前可分配 ${allocatable} 次`)
    return
  }
  try {
    await ElMessageBox.confirm(
      `向「${allocateDialog.value.memberName}」分配 ${amount} 次配额（只增不减 · 双写台账 · 不动物理池）。确认？`,
      '确认分配', { type: 'warning' }
    )
  } catch (e) { return }   // 用户取消

  allocating.value = true
  try {
    const d = await api.post(`/orgs/${orgId.value}/quota/allocate`, {
      toUserId: allocateDialog.value.userId,
      amount,
      note: allocateDialog.value.note || undefined
    })
    ElMessage.success(`已向「${allocateDialog.value.memberName}」分配 ${d.amount} 次配额`)
    allocateDialog.value.visible = false
    await loadQuota()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '分配配额失败')
  } finally {
    allocating.value = false
  }
}

onMounted(loadAll)

// 切换子公司 → 读它的管辖范围（决定「可拉取范围」提示与越界丢弃口径）
watch(targetMember, () => { preview.value = null; loadTargetScope() })
</script>

<style scoped>
.data-sync-view { padding: 16px; }
.ds-card { max-width: 1180px; margin: 0 auto; }
.ds-header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.ds-title { font-size: 16px; font-weight: 500; }
.ds-sub { font-size: 12px; color: #909399; }
.ds-loading { padding: 24px; color: #909399; text-align: center; }
.ds-empty-tip { font-size: 12px; color: #909399; line-height: 1.8; }

.ds-orgbar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; margin-bottom: 16px;
  background: #f5f7fa; border-radius: 8px;
}
.ds-orgname { font-size: 14px; font-weight: 500; }
.ds-orgmeta { font-size: 12px; color: #606266; }

.ds-block { border-top: 1px solid #ebeef5; padding: 14px 0 4px; }
.ds-block:first-of-type { border-top: none; }
.ds-block-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.ds-block-title { font-size: 14px; font-weight: 500; }
.ds-block-note { font-size: 12px; color: #909399; }

.ds-filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.ds-label { font-size: 12px; color: #606266; }

.ds-candbar { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #303133; margin-bottom: 10px; flex-wrap: wrap; }
.ds-num { color: #409eff; }
.ds-muted { font-size: 12px; color: #909399; }
.ds-ok { color: #67c23a; }
.ds-warn { color: #e6a23c; }
.ds-danger { color: #f56c6c; }
.ds-changes { font-size: 12px; color: #606266; }
.ds-actions { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.ds-preview { background: #fafcff; border-radius: 8px; padding: 14px 12px; }
.ds-counts { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }

.ds-quota-pool { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.ds-quota-card {
  flex: 1; min-width: 120px; padding: 12px 14px;
  background: #f5f7fa; border-radius: 8px;
  display: flex; flex-direction: column; gap: 4px;
}
.ds-quota-card.ds-quota-hl { background: #ecf5ff; border: 1px solid #d9ecff; }
.ds-quota-label { font-size: 12px; color: #909399; }
.ds-quota-num { font-size: 20px; color: #303133; font-weight: 600; }
.ds-quota-hl .ds-quota-num { color: #409eff; }
.ds-allocate-head { font-size: 14px; color: #303133; }

</style>
