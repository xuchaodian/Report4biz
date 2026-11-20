<template>
  <div class="cand-page">
    <!-- 初步分析（378 · P1）：**页面内视图切换**，不是弹窗 ——
         业主拍板「页面内嵌 + 可导出 PDF」。弹窗会遮住地图，长内容还要在 62vh 里滚两层。
         ⚠️ v-else 必须紧邻这个 v-if（中间不能插注释），所以说明写在上面。 -->
    <CandidateBriefReport v-if="briefRow" :row="briefRow" @close="briefRow = null" />

    <template v-else>
    <!-- 头部 -->
    <div class="cd-head">
      <div class="cd-head-l">
        <el-button link @click="goBack"><el-icon><ArrowLeft /></el-icon>返回地图</el-button>
        <h2>候选点位</h2>
        <p class="cd-sub">
          这里列出<b>「我的门店」里门店类型为重点候选 / 一般候选的门店</b>，
          在这套流程里推进：<b>标状态 → 留一句推进记录 → 出立项报告</b>。
          四档是「待评估 / 已勘踏 / 立项 / 放弃」，<b>只本人可见</b>，不改门店台账、不影响体检与预测。
        </p>
      </div>
      <div class="cd-head-r">
        <el-button :loading="loading" @click="reload">刷新</el-button>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新建独立点位
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

    <!-- 来源构成：376 起列表有两个来源，混在一起不说明的话，用户会以为「独立点位」是脏数据 -->
    <div v-if="total && originCounts.candidate" class="cd-origins">
      其中「我的门店」候选门店 <b>{{ originCounts.store }}</b> 家
      · 独立点位 <b>{{ originCounts.candidate }}</b> 个（早先手工建/地图右键存下来、没有对应门店的）
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
        <!-- 🔴 376 起主数据源是「我的门店」⇒ 空列表的最可能原因是门店类型还没标，
             不再是「你还没存过点位」。提示必须指对地方，否则用户会一直点「新建」。 -->
        <p>还没有候选点位。</p>
        <p class="cd-empty-hint">
          去「<b>我的门店</b>」把门店的<b>门店类型</b>改成「重点候选」或「一般候选」，它就会出现在这里；
          推进阶段与流水存在这边，不改门店本身的资料。
        </p>
        <div class="cd-empty-btns">
          <el-button type="primary" @click="router.push('/data')">去我的门店设置</el-button>
          <el-button @click="openCreate">新建独立点位</el-button>
        </div>
        <p class="cd-empty-hint cd-empty-hint-sub">
          「新建独立点位」用于还没进门店台账的铺位（比如商场里刚谈的一个位置），
          它不会写进「我的门店」，只在这里推进。
        </p>
      </template>
    </div>

    <!-- 列表 -->
    <!-- 🔴 row-key 不能用 id：376 起门店驱动的行 id 可能是 null，多行 null 会让
         el-table 的行复用错乱（展开/选中/滚动位置会串行）。用 markerId 兜一层。 -->
    <el-table
      v-else
      :data="list"
      v-loading="loading"
      class="cd-table"
      :row-key="(row) => (row.id ? 'c' + row.id : 'm' + row.markerId)"
      @row-click="openDetail"
    >
      <!-- 385：品牌从「点位」列的第二行拆出来单列（业主 385 反馈：品牌挤在门店名下面两行，
           读起来像门店名的一部分）。「点位」只留名称，「品牌」紧随其后。 -->
      <el-table-column label="点位" min-width="200">
        <template #default="{ row }">
          <div class="cd-name">{{ row.name }}</div>
        </template>
      </el-table-column>
      <el-table-column label="品牌" width="120">
        <template #default="{ row }">
          <div v-if="row.brand" class="cd-one" :title="row.brand">{{ row.brand }}</div>
          <div v-else class="cd-one cd-none">—</div>
        </template>
      </el-table-column>
      <!-- 385：「位置」由两行（城市·区 / 地址）改为一行，超出省略、悬停看全文。
           单行后不再需要靠换行区分城市与地址，宽度可以收窄一些。 -->
      <el-table-column label="位置" min-width="240">
        <template #default="{ row }">
          <div class="cd-one" :title="locText(row)">{{ locText(row) }}</div>
        </template>
      </el-table-column>
      <!-- 376：门店类型来自「我的门店」；独立点位没有类型可言，显示「独立点位」而不是空白 -->
      <!-- 384：门店来源行的「不能删」解释挂在这里（原来占着操作列的位置，与来源列重复）。 -->
      <el-table-column label="来源" width="112" align="center">
        <template #default="{ row }">
          <span
            v-if="row.origin === 'store'"
            class="cd-type cd-type-store"
            title="来自「我的门店」· 不能在这里删除。要让它消失，请到「我的门店」把门店类型改回「已开业」"
          >{{ row.storeType || '候选门店' }}</span>
          <span v-else class="cd-type cd-type-solo">独立点位</span>
        </template>
      </el-table-column>
      <!-- 384：删掉「半径」列。它恒为默认 1000（门店来源行未改过就是 1km），
           既不参与筛选也不是决策依据；且初步分析只认 1/3/5km 三档（向上取档）、
           临时改半径不写回，列表值与实际取数口径本就是两套 ⇒ 留着反而误导。
           需要看点位评估半径时：详情抽屉「评估半径」、「编辑评估半径」对话框。
           ⚠️ 数据仍在 row.radius 上，openBrief() 仍靠它决定初步分析的默认半径，删的只是展示。 -->
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
      <!-- 384：删掉原「我的门店 · 不可删」灰字。理由：
           ① 「来源」列已经写明这是门店（重点候选/一般候选 vs 独立点位），再写一遍是冗余；
           ② 「没有删除按钮」本身就是可删性的表达，不需要额外占位；
           ③ 解释挂在「来源」列的 tooltip 上，信息不丢、又不占操作列空间。
           操作列宽随之回收到 196（独立点位：详情34 + 12 + 初步分析62 + 12 + 删除34 = 154，+24 padding = 178）。 -->
      <el-table-column label="操作" width="196" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
          <!-- 初步分析是 0 消耗的，所以对每行都开放（含门店视图与独立点位） -->
          <el-button link type="primary" @click.stop="openBrief(row)">初步分析</el-button>
          <!-- 🔴 来自「我的门店」的行不能删（后端也会 400）：删了门店还在，刷新就"复活" -->
          <el-button v-if="row.origin !== 'store'" link type="danger" @click.stop="remove(row)">删除</el-button>
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
          <div>
            <dt>来源</dt>
            <dd>
              <template v-if="detail.origin === 'store'">
                我的门店 · {{ detail.storeType || '候选门店' }}<span v-if="detail.storeCode" class="cd-muted">（{{ detail.storeCode }}）</span>
              </template>
              <span v-else>独立点位（未关联门店）</span>
            </dd>
          </div>
          <div><dt>品牌</dt><dd>{{ detail.brand || '—' }}</dd></div>
          <div><dt>城市 / 区县</dt><dd>{{ [detail.city, detail.district].filter(Boolean).join(' · ') || '—' }}</dd></div>
          <div class="cd-info-wide"><dt>地址</dt><dd>{{ detail.address || '—' }}</dd></div>
          <div><dt>坐标</dt><dd>{{ fmtLatLng(detail.latitude) }}, {{ fmtLatLng(detail.longitude) }}</dd></div>
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
          <!-- 🔴 顺序有意：先「初步分析」（0 消耗），再「立项报告」（可能消耗联通配额）。
               主按钮给免费的这条路 —— 产品方向是「免费层给结论、付费层给证据」。 -->
          <el-button type="primary" @click="openBrief(detail)">初步分析</el-button>
          <el-button plain :loading="reportOpening" @click="openReport">生成立项报告</el-button>
          <!-- 🔴 v1.13.386：门店来源**不显示**「编辑信息」（业主 2026-11-20 定）。
               那个弹窗对门店行只有「评估半径」一个可改项，其余字段全是门店台账（disabled），
               点开就是一片灰 ⇒ 不如不给入口。半径仍有去处：初步分析里可换（不写回），
               要改门店资料请到「我的门店」。
               ⚠️ `openEdit` 里的 `formFromStore` 分支刻意保留 —— 它是「门店字段不许写回」的护栏，
                  删掉以后万一有别的路径打开这个弹窗，就会把门店台账字段当成候选点位字段写库。 -->
          <el-button v-if="detail.origin !== 'store'" @click="openEdit">编辑信息</el-button>
          <el-button v-if="detail.origin !== 'store'" type="danger" plain @click="remove(detail)">删除点位</el-button>
          <span v-else class="cd-muted cd-detail-lock">
            来自「我的门店」：要让它从候选点位里消失，请到我的门店把门店类型改回「已开业」
          </span>
        </div>
      </div>
    </el-drawer>

    <!-- 新建 / 编辑 -->
    <el-dialog
      v-model="dialog"
      :title="formFromStore ? '编辑评估半径' : (editingId ? '编辑点位' : '新建独立点位')"
      width="560px"
      append-to-body
    >
      <!-- 🔴 门店来源只能改半径：其余字段属于门店台账，在这改不同步回门店 ⇒ 两边不一致 -->
      <el-alert
        v-if="formFromStore"
        type="info"
        :closable="false"
        show-icon
        class="cd-form-tip"
        title="这个点位来自「我的门店」"
        description="名称、品牌、地址、坐标、面积、租金都跟着门店台账走，这里只能改评估半径。要改门店资料请到「我的门店」。"
      />
      <el-form :model="form" label-width="88px" label-position="right">
        <el-form-item label="点位名称" :required="!formFromStore">
          <el-input v-model="form.name" maxlength="60" :disabled="formFromStore" placeholder="例：五角场万达 3F 中庭铺位" />
        </el-form-item>
        <el-form-item label="拟入驻品牌">
          <el-input v-model="form.brand" maxlength="40" :disabled="formFromStore" placeholder="例：食其家" />
        </el-form-item>
        <el-form-item label="城市 / 区县">
          <div class="cd-row">
            <el-input v-model="form.city" maxlength="20" :disabled="formFromStore" placeholder="上海" />
            <el-input v-model="form.district" maxlength="20" :disabled="formFromStore" placeholder="杨浦区" />
          </div>
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" maxlength="200" :disabled="formFromStore" placeholder="邯郸路 600 号" />
        </el-form-item>
        <el-form-item label="经纬度" :required="!formFromStore">
          <div class="cd-row">
            <el-input v-model="form.latitude" :disabled="formFromStore" placeholder="纬度 31.30..." />
            <el-input v-model="form.longitude" :disabled="formFromStore" placeholder="经度 121.51..." />
          </div>
          <div class="cd-tip">GCJ-02（与地图上看到的一致）；可从地图页或已有门店抄过来。</div>
        </el-form-item>
        <el-form-item label="评估半径">
          <el-input-number v-model="form.radius" :min="100" :max="50000" :step="100" />
          <span class="cd-tip-inline">米（候选点位自己用的口径，不改门店）</span>
        </el-form-item>
        <el-form-item label="面积 / 租金">
          <div class="cd-row">
            <el-input v-model="form.area" :disabled="formFromStore" placeholder="面积 ㎡" />
            <el-input v-model="form.rent" :disabled="formFromStore" placeholder="月租金 元" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ editingId ? '保存' : '创建' }}</el-button>
      </template>
    </el-dialog>

    <!-- 立项报告（P1-5）：默认不含 AI 建议，勾选后才调 AI -->
    <CandidateReport v-model="reportVisible" :candidate="detail" />
    </template>
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
import CandidateReport from '@/components/CandidateReport.vue'
import CandidateBriefReport from '@/components/CandidateBriefReport.vue'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const list = ref([])
const counts = ref({})
const total = ref(0)
// 来源构成（376）：store＝我的门店里的候选门店，candidate＝没有对应门店的独立点位
const originCounts = ref({ store: 0, candidate: 0 })
const keyword = ref('')
const filterStage = ref('')

const drawer = ref(false)
const detail = ref(null)
const notes = ref([])
const stageNote = ref('')
const remark = ref('')
const remarkLoading = ref(false)
const reportOpening = ref(false)

const reportVisible = ref(false)
// 初步分析（378）：非 null ⇒ 页面切换到报告视图。只带报告要用的四个字段，
// 不整行塞进去（列表行有 20+ 字段，报告组件不该知道「阶段/流水/来源构成」这些事）。
const briefRow = ref(null)
const dialog = ref(false)
const editingId = ref(null)
const form = ref(emptyForm())
// 编辑对象是否来自「我的门店」：是则名称/地址/坐标/面积/租金一律只读（它们属于门店台账）
const formFromStore = ref(false)
// 入口来源：manual（页面内新建）/ map（地图右键选点）—— **必须在清 query 之前捕获**，
// 否则 router.replace 之后 route.query.source 就没了，来源全落成 manual（踩过）
const entrySource = ref('manual')

/** 最近点过的阶段：只用来驱动说明框的 placeholder（「放弃」要强制写原因） */
const lastClickedStage = ref('')

function emptyForm() {
  return { name: '', brand: '', city: '', district: '', address: '', latitude: '', longitude: '', radius: 1000, area: '', rent: '' }
}

/** 库里是 UTC（SQLite CURRENT_TIMESTAMP），统一走 utils/datetime.js 转本地 */
const fmt = formatUtcDateTime

/** 剥掉地址开头已含的城市/区前缀。
 *  385 实测：address 常是「上海市闵行区浦锦路309弄6号」，而 city/district 也是同两段
 *  ⇒ 拼成一行就变成「上海市 · 闵行区 · 上海市闵行区浦锦路309弄6号」，重复刺眼。
 *  「上海」与「上海市」、「闵行」与「闵行区」互认，按**长的优先**匹配（否则「上海」会把
 *  「上海市」吃半个字、剩下「市闵行区…」）。 */
function stripAddrPrefix(addr, prefix) {
  if (!addr || !prefix) return addr
  const forms = new Set([prefix])
  if (/[市县区省]$/.test(prefix)) forms.add(prefix.slice(0, -1))
  else ['市', '区', '县'].forEach((s) => forms.add(prefix + s))
  const candidates = [...forms].filter(Boolean).sort((a, b) => b.length - a.length)
  for (const f of candidates) {
    if (addr.startsWith(f)) return addr.slice(f.length).trim()
  }
  return addr
}

/** 列表「位置」列的一行文本：城市 · 区 · 地址，缺哪段跳哪段。全空给「—」。
 *  385：原来分两行显示（城市·区 / 地址），业主反馈一行更好读；地址过长靠 CSS 省略 + title 看全文。 */
function locText(row) {
  const city = String(row?.city ?? '').trim()
  const district = String(row?.district ?? '').trim()
  let addr = String(row?.address ?? '').trim()
  addr = stripAddrPrefix(addr, city)
  addr = stripAddrPrefix(addr, district)
  return [city, district, addr].filter(Boolean).join(' · ') || '—'
}

/** 经纬度展示：null/NaN 一律「—」（⛔ 不能让 `null.toFixed` 把整个抽屉炸掉） */
function fmtLatLng(v) {
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n.toFixed(6) : '—'
}

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
    originCounts.value = data.originCounts || { store: 0, candidate: 0 }
  } catch (e) {
    errorMsg.value = e?.response?.data?.message || '加载候选点位失败'
    list.value = []
    originCounts.value = { store: 0, candidate: 0 }
  } finally {
    loading.value = false
  }
}

/**
 * 🔴🔴 写操作前必须确保这行有 `store_candidates.id`（376）。
 *
 * 列表现在以「我的门店」驱动，**刚标成候选的门店还没有推进记录**（`id === null`）。
 * 后端 `POST /ensure` 幂等建行（已有就返回原件），拿到 id 之后
 * /stage、/notes、/:id、DELETE 这些老接口一条都不用改。
 *
 * ⚠️ 只在**真要写**的时候调（改阶段 / 记一笔 / 出报告 / 编辑），
 *    ⛔ 不要放进 `openDetail` 或 `reload`：读一眼就在库里留一行，等于把浏览行为变成写操作。
 */
async function ensureRow(row) {
  if (row?.id) return { ...row }
  if (!row?.markerId) throw new Error('该点位缺少关联信息，请刷新后重试')
  const { data } = await axios.post('/api/candidates/ensure', { markerId: row.markerId })
  const id = data?.candidate?.id
  if (!id) throw new Error('建立推进记录失败')
  const merged = {
    ...row,
    ...data.candidate,
    origin: row.origin,
    markerId: row.markerId,
    storeType: row.storeType,
    storeCode: row.storeCode
  }
  // 同步回列表：否则用户再点一次会重复 ensure（幂等但会闪）
  const hit = list.value.find((x) => x.markerId === row.markerId && !x.id)
  if (hit) Object.assign(hit, { id, stage: merged.stage, stageStored: true })
  return merged
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

/**
 * 打开详情。
 * 🔴 读操作**不建行**（376）：只是看一眼不该在库里留痕迹。
 *    需要 id 的动作（改阶段 / 记一笔 / 出报告 / 编辑）各自调 `ensureRow`。
 * ⚠️ 没有 id 时 `notes` 就是空 —— 界面显示「还没有记录」，这是**真话**（该门店确实没推进过）。
 */
async function openDetail(row) {
  detail.value = { ...row }
  notes.value = []
  stageNote.value = ''
  lastClickedStage.value = ''
  remark.value = ''
  drawer.value = true
  if (!row.id) return
  try {
    const { data } = await axios.get(`/api/candidates/${row.id}`)
    // 🔴 展示字段一律取 `row`（与列表同构，值来自门店台账），
    //    ⛔ 不用 `candidate` 的同名字段：那是 store_candidates 里当年手工录的旧值，
    //    现网两者确实不同（门店台账「浦锦路309弄6号」vs 候选表「江月路」），
    //    混用会出现「列表显示一个地址、点开变另一个地址」。
    //    `candidate` 仍整体铺开，因为立项报告读的是它的下划线字段（drop_reason 等）。
    const base = data.row || data.candidate || {}
    detail.value = {
      ...data.candidate,
      name: base.name,
      city: base.city,
      district: base.district,
      address: base.address,
      latitude: base.latitude,
      longitude: base.longitude,
      area: base.area,
      rent: base.rent,
      radius: base.radius,
      storeType: base.storeType || row.storeType,
      storeCode: base.storeCode || row.storeCode,
      origin: row.origin,
      markerId: row.markerId
    }
    notes.value = data.notes || []
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
    const row = await ensureRow(detail.value)
    detail.value = { ...detail.value, id: row.id }
    const { data } = await axios.patch(`/api/candidates/${row.id}/stage`, {
      stage,
      note: stageNote.value.trim(),
      drop_reason: stage === '放弃' ? stageNote.value.trim() : ''
    })
    detail.value = { ...detail.value, ...data.candidate }
    notes.value = data.notes || []
    stageNote.value = ''
    lastClickedStage.value = ''
    ElMessage.success(`已改为「${stage}」`)
    reload()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '更新阶段失败')
  }
}

async function addRemark() {
  const note = remark.value.trim()
  if (!note) return ElMessage.warning('先写点什么')
  remarkLoading.value = true
  try {
    const row = await ensureRow(detail.value)
    detail.value = { ...detail.value, id: row.id }
    const { data } = await axios.post(`/api/candidates/${row.id}/notes`, { note })
    notes.value = data.notes || []
    remark.value = ''
    await reload()
    ElMessage.success('已记一笔')
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '添加备注失败')
  } finally {
    remarkLoading.value = false
  }
}

/**
 * 打开初步分析（0 消耗）。
 * 🔴 这里**不调 ensureRow**：后端 `GET /brief` 接受 markerId，门店驱动的行
 *    （id 为 null）也能直接分析。看一眼就在库里建一行，等于把浏览变成写操作。
 * 关掉抽屉再切视图：抽屉是 fixed 层，留着会盖在新视图上面。
 */
function openBrief(row) {
  briefRow.value = {
    id: row?.id ?? null,
    markerId: row?.markerId ?? null,
    name: row?.name || '',
    origin: row?.origin || '',
    radius: Number(row?.radius) || 1000
  }
  drawer.value = false
}

/**
 * 出立项报告：需要 id（报告导出会写一条留痕流水）⇒ 先 ensure。
 * ⚠️ 这里建行是合理的：用户已经决定要为这个点位出一份报告，那就是"推进了一步"。
 */
async function openReport() {
  reportOpening.value = true
  try {
    const row = await ensureRow(detail.value)
    detail.value = { ...detail.value, id: row.id }
    reportVisible.value = true
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '打开报告失败')
  } finally {
    reportOpening.value = false
  }
}

function openCreate() {
  editingId.value = null
  formFromStore.value = false
  form.value = emptyForm()
  dialog.value = true
}

/**
 * 编辑信息。
 * 🔴 来自「我的门店」的行**只允许改评估半径**：名称/品牌/城市/地址/坐标/面积/租金
 *    都是门店台账的字段，在这里改一份不会同步回门店（376 刻意不做双向写），
 *    改完两边不一致，比不让改更糟。所以弹窗里其余字段全部 disabled 并说明去哪改。
 */
async function openEdit() {
  try {
    const d = await ensureRow(detail.value)
    detail.value = { ...detail.value, id: d.id }
    editingId.value = d.id
    formFromStore.value = detail.value.origin === 'store'
    form.value = {
      name: d.name,
      brand: d.brand || '',
      city: d.city || '',
      district: d.district || '',
      address: d.address || '',
      latitude: d.latitude === null || d.latitude === undefined ? '' : String(d.latitude),
      longitude: d.longitude === null || d.longitude === undefined ? '' : String(d.longitude),
      radius: d.radius,
      area: d.area ?? '',
      rent: d.rent ?? ''
    }
    dialog.value = true
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '打开编辑失败')
  }
}

async function save() {
  const f = form.value
  // 门店来源只提交半径；其余字段disabled，但这里再挡一次（防有人用 devtools 改了再提交）
  if (!formFromStore.value && !f.name.trim()) return ElMessage.warning('请填写点位名称')
  if (!formFromStore.value && (!f.latitude || !f.longitude)) return ElMessage.warning('请填写经纬度')
  saving.value = true
  const payload = formFromStore.value
    ? { radius: f.radius }
    : {
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
      if (detail.value?.id === editingId.value) await openDetail({ ...detail.value, id: editingId.value })
      await reload()
    } else {
      const { data } = await axios.post('/api/candidates', { ...payload, source: entrySource.value })
      ElMessage.success('已创建')
      dialog.value = false
      await reload()
      if (data?.candidate?.id) await openDetail({ ...data.candidate, origin: 'candidate', markerId: null })
    }
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(row) {
  // 🔴 门店视图不能删：删了门店还在，刷新就"复活"，用户会反复点（后端同样 400 兜底）
  if (row.origin === 'store') {
    return ElMessage.warning('这个点位来自「我的门店」，不能在这里删除。要让它消失，请到我的门店把门店类型改回「已开业」。')
  }
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
    entrySource.value = String(q.source || 'map')
    formFromStore.value = false
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
/* 🔴 375c：这三行与 SiteSelectView 的 `.ss-page` 是同一个缺陷（同一套模板配方复制出来的）。
   父级 `.main-content` 是 `overflow:hidden`，页面不自己滚 ⇒ 超出部分永远不可达。
   候选池是一张会长的表（分页 20 条 + 头部 + 筛选），1366×768 下必然超屏。 */
.cand-page { height: 100%; overflow-y: auto; box-sizing: border-box; padding: 20px 24px 40px; max-width: 1280px; margin: 0 auto; }
.cd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.cd-head-l h2 { margin: 4px 0 6px; font-size: 20px; font-weight: 500; }
.cd-sub { margin: 0; font-size: 13px; line-height: 1.7; color: var(--text-regular); max-width: 720px; }
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
.cd-stage-t { font-size: 12px; color: var(--text-regular); }
.cd-total { margin-left: auto; font-size: 13px; color: var(--text-regular); }
.cd-total b { color: #303133; }
.cd-clear { margin-left: 8px; color: var(--brand-primary); cursor: pointer; }

.cd-tools { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.cd-error { display: flex; align-items: center; gap: 6px; padding: 10px 12px; background: #fef0f0; color: #f56c6c; border-radius: 6px; font-size: 13px; }
.cd-empty { padding: 56px 0; text-align: center; color: var(--text-regular); font-size: 14px; }
.cd-empty p { margin: 0 0 8px; }
.cd-empty-hint { font-size: 13px; color: var(--text-secondary); line-height: 1.8; max-width: 560px; margin: 0 auto 8px !important; }
.cd-empty-hint-sub { font-size: 12px; margin-top: 14px !important; }
.cd-empty-btns { display: flex; gap: 10px; justify-content: center; margin-top: 14px; }

/* 来源构成（376）：两个来源混在一张表里，必须先说明白 */
.cd-origins { margin: -4px 0 12px; font-size: 12px; color: var(--text-secondary); }
.cd-origins b { color: #303133; font-weight: 500; }

.cd-table { cursor: pointer; }
.cd-name { font-size: 14px; color: #303133; }
/* 385：单行 + 省略号。el-table 的 .cell 默认 word-break:break-all，这里必须 nowrap 才不折行；
   截断部分靠 title 悬停看全文。 */
.cd-one { font-size: 13px; color: #303133; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cd-none { color: var(--text-secondary); }
.cd-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; line-height: 1.6; }
.cd-type { font-size: 12px; color: #303133; }
.cd-type-solo { color: var(--text-secondary); }
/* 384：门店来源行的「不能删」解释移到这一列，靠 tooltip 承载，故给 help 光标作提示 */
.cd-type-store { cursor: help; }
.cd-detail-lock { display: block; margin-top: 8px; line-height: 1.7; }
.cd-form-tip { margin-bottom: 14px; }

.cd-detail-top { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.cd-detail-hint { font-size: 12px; color: var(--text-secondary); }
.cd-info { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin: 0 0 18px; }
.cd-info > div { min-width: 0; }
.cd-info-wide { grid-column: 1 / -1; }
.cd-info dt { font-size: 12px; color: var(--text-secondary); margin-bottom: 2px; }
.cd-info dd { margin: 0; font-size: 13px; color: #303133; word-break: break-all; }
.cd-drop { color: #f56c6c; }

.cd-sec { margin-bottom: 20px; }
.cd-sec h3 { font-size: 14px; font-weight: 500; margin: 0 0 10px; color: #303133; }
.cd-stage-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.cd-note-input { margin-bottom: 6px; }
.cd-sec-foot { font-size: 12px; color: var(--text-secondary); }
.cd-muted { font-size: 12px; color: var(--text-secondary); font-weight: 400; }
.cd-timeline { padding-left: 2px; }
.cd-note-stage { font-size: 12px; color: var(--text-regular); margin-bottom: 2px; }
.cd-note-text { font-size: 13px; color: #303133; line-height: 1.6; }
.cd-remark { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.cd-detail-actions { display: flex; gap: 8px; padding-top: 8px; border-top: 1px solid #ebeef5; }

.cd-row { display: flex; gap: 8px; width: 100%; }
.cd-tip { font-size: 12px; color: var(--text-secondary); line-height: 1.6; margin-top: 4px; }
.cd-tip-inline { margin-left: 8px; font-size: 12px; color: var(--text-secondary); }
</style>
