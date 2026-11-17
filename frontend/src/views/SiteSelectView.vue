<template>
  <div class="ss-page">
    <!-- ── 头部 ───────────────────────────────────────────────────────── -->
    <div class="ss-head">
      <div class="ss-head-l">
        <h2>
          智能选址
          <el-tag size="small" type="warning" effect="plain">仅管理员</el-tag>
        </h2>
        <p class="ss-sub">
          框选一块地 → 系统按步长铺出候选点 → <b>免费</b>用竞品/商圈/自有门店/本地网格人口粗排
          → 只对前 N 个点查<b>联通人口</b>精算 → 去重后给出 TOP 推荐。
          <br />
          花钱的只有最后一步，且<b>点确认前就能看到要花几次</b>。
        </p>
      </div>
      <div class="ss-head-r">
        <el-button :loading="loadingCities" @click="loadCities">刷新城市</el-button>
      </div>
    </div>

    <!-- ── 配额状态（三态：可用 / 余额不足 / 未采购）──────────────────── -->
    <el-alert
      v-if="quotaAlert"
      class="ss-quota"
      :type="quotaAlert.type"
      :closable="false"
      show-icon
      :title="quotaAlert.title"
      :description="quotaAlert.desc"
    />

    <!-- ── 参数表单 ───────────────────────────────────────────────────── -->
    <div class="ss-card">
      <el-form :model="form" label-width="92px" label-position="left" class="ss-form">
        <div class="ss-grid">
          <el-form-item label="城市">
            <el-select v-model="form.city" filterable clearable placeholder="用于本地网格初筛（可留空）" class="ss-w-full">
              <el-option v-for="c in cities" :key="c.city" :label="`${c.city}（${c.featureCount} 格）`" :value="c.city" />
            </el-select>
          </el-form-item>

          <el-form-item label="自有品牌">
            <el-select v-model="form.myBrand" clearable placeholder="不选 = 全量（饱和保护不生效）" class="ss-w-full">
              <el-option label="全部品牌（不筛选）" :value="''" />
              <el-option v-for="b in myBrands" :key="b" :label="b" :value="b" />
            </el-select>
          </el-form-item>

          <el-form-item label="账号额度">
            <div class="ss-inline">
              <span class="ss-num">{{ remaining }}</span>
              <span class="ss-muted">次（平台联通人口余额）</span>
            </div>
          </el-form-item>

          <el-form-item label="框选范围" class="ss-span-2">
            <div class="ss-bbox">
              <!--
                ⚠️ 标签用「最西/最南/最东/最北」，⛔ 不能写「西经/南纬/东经/北纬」。
                    四个输入装的是**四至边界值**（minx/miny/maxx/maxy），不是经纬度方向。
                    而「西经 121.35」「南纬 31.18」在中文里读作「西半球经度 121.35」「南半球纬度 31.18」
                    —— 与字段含义正好相反（上海是东经 121.35、北纬 31.18），
                    用户会以为自己填错了半球。北纬/东经两格数值巧合读得通，反而更容易蒙混过关。
              -->
              <label class="ss-bbox-f">
                <span>最西</span>
                <el-input-number v-model="form.west" :step="0.01" :precision="4" :controls="false" size="small" />
              </label>
              <label class="ss-bbox-f">
                <span>最南</span>
                <el-input-number v-model="form.south" :step="0.01" :precision="4" :controls="false" size="small" />
              </label>
              <label class="ss-bbox-f">
                <span>最东</span>
                <el-input-number v-model="form.east" :step="0.01" :precision="4" :controls="false" size="small" />
              </label>
              <label class="ss-bbox-f">
                <span>最北</span>
                <el-input-number v-model="form.north" :step="0.01" :precision="4" :controls="false" size="small" />
              </label>
              <span class="ss-muted">约 {{ bboxArea }} km²</span>
            </div>
          </el-form-item>

          <el-form-item label="步长">
            <el-select v-model="form.stepM" class="ss-w-full">
              <el-option :value="500" label="500 米（更密，预去重后仍有冗余）" />
              <el-option :value="1000" label="1000 米（推荐）" />
              <el-option :value="2000" label="2000 米（更省算力）" />
            </el-select>
          </el-form-item>

          <el-form-item label="评估半径">
            <el-select v-model="form.radius" class="ss-w-full">
              <el-option v-for="r in RADII" :key="r" :value="r" :label="`${r} 米`" />
            </el-select>
          </el-form-item>

          <el-form-item label="联通账期">
            <el-select v-model="form.cityMonth" clearable placeholder="默认最新可用" class="ss-w-full">
              <el-option v-for="m in months" :key="m.value" :label="m.label" :value="m.value" />
            </el-select>
          </el-form-item>

          <el-form-item label="精算点数">
            <el-input-number v-model="form.preciseTopK" :min="10" :max="50" :step="5" class="ss-w-full" />
            <div class="ss-hint">
              决定本次最多花几次（上限 50）。30 = 出 TOP 20 的下限 20 + 10 冗余；超过 30 需手动输入次数确认。
            </div>
          </el-form-item>

          <el-form-item label="推荐条数">
            <el-input-number v-model="form.topN" :min="1" :max="50" :step="5" class="ss-w-full" />
          </el-form-item>

          <el-form-item label="最小间隔">
            <el-input-number v-model="form.minGapM" :min="400" :max="2000" :step="100" class="ss-w-full" />
            <div class="ss-hint">去重距离：两条推荐不会靠得比它更近。</div>
          </el-form-item>

          <el-form-item label="饱和保护">
            <div class="ss-inline">
              <el-switch v-model="form.satEnabled" />
              <el-input-number v-model="form.satRadiusM" :min="1000" :max="5000" :step="500" size="small" :disabled="!form.satEnabled" />
              <span class="ss-muted">米内 ≥</span>
              <el-input-number v-model="form.satMaxOwn" :min="1" :max="5" size="small" :disabled="!form.satEnabled" />
              <span class="ss-muted">家即剔除</span>
            </div>
            <div v-if="!form.myBrand" class="ss-hint ss-warn">
              未选择自有品牌 ⇒ 饱和保护会跳过（「饱和」按品牌判定）
            </div>
          </el-form-item>
        </div>
      </el-form>

      <div class="ss-actions">
        <el-button type="primary" :loading="estimating" :disabled="!canRun" @click="runEstimate">
          预估消耗
        </el-button>
        <span v-if="estimateInfo" class="ss-muted">
          将精算 {{ estimateInfo.preciseCount }} 点 · 预计消耗 {{ estimateInfo.quotaEstimate - estimateInfo.cacheHitGuess }} 次
          （{{ estimateInfo.cacheHitGuess }} 点可复用已购数据）· 剩余 {{ estimateInfo.remaining }} 次
        </span>
        <span v-else class="ss-muted">先点「预估消耗」，确认后再真正执行</span>
      </div>
    </div>

    <!-- ── 结果提示条 ─────────────────────────────────────────────────── -->
    <div v-if="result" class="ss-notes">
      <el-alert
        v-for="(w, i) in result.warnings || []"
        :key="`w${i}`"
        :title="w"
        type="warning"
        :closable="false"
        show-icon
        class="ss-note-item"
      />
      <el-alert
        v-if="result.saturatedDropped > 0"
        :title="`已按饱和保护剔除 ${result.saturatedDropped} 个点位（半径内同品牌门店已达门限）`"
        type="info"
        :closable="false"
        show-icon
        class="ss-note-item"
      />
      <el-alert
        v-if="result.crowdDropped > 0"
        :title="`${result.crowdDropped} 个点位联通无有效人口数据，已剔除（未按 0 分参与排名）`"
        type="info"
        :closable="false"
        show-icon
        class="ss-note-item"
      />
      <el-alert
        v-if="(result.missingDims || []).length"
        :title="`本次未评维度：${missingLabel}`"
        type="info"
        :closable="false"
        show-icon
        class="ss-note-item"
      />
      <div class="ss-quota-used">
        本次消耗 <b>{{ result.quota.used }}</b> 次
        <span v-if="result.quota.fromCacheCount">（{{ result.quota.fromCacheCount }} 点命中已购/缓存，未扣费）</span>
        · 剩余 <b>{{ result.quota.remaining }}</b> 次
      </div>
    </div>

    <!-- ── 结果表 ─────────────────────────────────────────────────────── -->
    <div v-if="result" class="ss-card ss-result">
      <div class="ss-result-head">
        <span>
          共 {{ result.gridTotal }} 个候选点 → 精算 {{ result.coarseTopK }} 个 → 推荐
          <b>{{ result.returned }}</b> 个
        </span>
        <span class="ss-muted">
          权重 客群 {{ result.weights.crowd }} / 竞品 {{ result.weights.competition }} / 商圈
          {{ result.weights.district }} / 配套 {{ result.weights.access }} / 自牌 {{ result.weights.cannibal }}
        </span>
      </div>

      <el-table v-loading="ranking" :data="result.items" stripe size="small" class="ss-table">
        <el-table-column prop="rank" label="#" width="48" />
        <el-table-column label="评分" width="110">
          <template #default="{ row }">
            <div class="ss-score">{{ row.score }}</div>
            <div class="ss-dims">
              <span :title="`客群 ${fmtDim(row.dims.crowd)}`">客{{ fmtDim(row.dims.crowd) }}</span>
              <span :title="`竞品 ${fmtDim(row.dims.competition)}`">竞{{ fmtDim(row.dims.competition) }}</span>
              <span :title="`商圈 ${fmtDim(row.dims.district)}`">商{{ fmtDim(row.dims.district) }}</span>
              <span :title="`自牌 ${fmtDim(row.dims.cannibal)}`">自{{ fmtDim(row.dims.cannibal) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="圆内人口 / 到访" width="170">
          <template #default="{ row }">
            <div>居住 {{ fmtWan(row.raw.live) }}</div>
            <div>工作 {{ fmtWan(row.raw.work) }}</div>
            <div class="ss-visit">到访 {{ fmtVisit(row.raw.visit) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="竞品" width="110">
          <template #default="{ row }">
            <div>{{ row.raw.competitors }} 家</div>
            <div class="ss-muted ss-ellipsis">{{ brandText(row.raw.competitorBrands) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="最近自有店" width="100">
          <template #default="{ row }">
            <span v-if="row.raw.nearestOwnM !== null">{{ fmtKm(row.raw.nearestOwnM) }}</span>
            <span v-else class="ss-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="商圈" width="120">
          <template #default="{ row }">
            <span v-if="row.raw.districtName">{{ row.raw.districtName }}</span>
            <span v-else class="ss-muted">未覆盖</span>
            <div v-if="row.dims.district !== null" class="ss-muted">{{ row.dims.district }} 分</div>
          </template>
        </el-table-column>
        <!-- 坐标宽度 176：`31.21800, 121.42000` 共 20 字符，等宽字体下单行约 144px，
             加单元格左右 padding 24px ⇒ 150 会折成两行（真机 1440 实测）。 -->
        <el-table-column label="坐标" width="176">
          <template #default="{ row }">
            <span class="ss-mono">{{ row.center[1].toFixed(5) }}, {{ row.center[0].toFixed(5) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="为什么推荐" min-width="240">
          <template #default="{ row }">
            <ul class="ss-reason">
              <li v-for="(r, i) in row.reason" :key="i">{{ r }}</li>
            </ul>
          </template>
        </el-table-column>
        <!--
          🔴 `fixed="right"` 必须**只在宽屏**启用。390px 实测：固定列会盖住「圆内人口」列
             右侧的「万人 / 占 31%（代理）」等数字 —— 表面上表格能横向滚动，
             但被固定列压住的那 40px 永远滑不出来，用户读到的是半截数字。
             ⚠️ 绑定的是 prop（不是内联样式），不会像 §6.126 那样盖过 @media。
        -->
        <el-table-column label="操作" width="104" :fixed="isNarrow ? false : 'right'">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="saveCandidate(row)">存为候选</el-button>
          </template>
        </el-table-column>
      </el-table>

      <p class="ss-foot-note">
        推荐只给「这块地里哪个位置最好」，不替你决定开不开店。每个数字都能在系统里复核：
        人口来自联通（账期见理由句）、竞品来自竞品库、商圈分来自商圈洞察同一套算法。
      </p>
    </div>

    <!-- ── 空态 ───────────────────────────────────────────────────────── -->
    <el-empty v-if="!result && !ranking && !estimating" description="填好参数后点「预估消耗」开始" />
  </div>
</template>

<script setup>
/**
 * 智能选址（v1.13.370 / 批次 370）—— 仅管理员
 *
 * ── 这个页面的三个「不能省」──────────────────────────────────────────
 * ① **二次确认**：点「预估消耗」只算不查（0 消耗），把「消耗 X / 剩余 Y」摆到用户面前，
 *    确认后才真正调联通。这是「付费前必明」那条产品铁律的落点。
 * ② **不展示粗排分**：接口刻意不返回 roughScore。初筛分是"框选内相对名次"，
 *    精算分是"绝对好坏"，两者不可比 —— 展示出来必然出现"初筛第 1、最终第 8"。
 * ③ **未评维度要明示**：P0 不接「可达配套」（D），商圈也可能没覆盖，
 *    顶部提示条必须说清"这次少算了哪一维"，⛔ 不能让用户以为五维都算了。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'

const RADII = [500, 1000, 1500, 3000]
const DEFAULT_BOX_KM = 4   // 选城市后默认给 4km × 4km 的框

const cities = ref([])
const myBrands = ref([])
const months = ref([])
const remaining = ref(0)

const loadingCities = ref(false)
const estimating = ref(false)
const ranking = ref(false)
const result = ref(null)
const estimateInfo = ref(null)

/**
 * 窄屏标记（与下方 @media (max-width: 900px) 同断点）。
 * 唯一用途：窄屏时取消结果表的「固定右列」——否则固定列会压住人口列数字（390px 实测）。
 * ⚠️ 断点写 900 是因为本页表单本身就在 900 塌成一列；⛔ 不要改叫 1240：
 *    1240 是顶栏抽屉的断点，与本页表格无关。
 */
const isNarrow = ref(false)
let narrowMq = null
function onNarrowChange(e) {
  isNarrow.value = !!e.matches
}

const form = reactive({
  city: '',
  myBrand: '',
  west: 121.44,
  south: 31.28,
  east: 121.48,
  north: 31.32,
  stepM: 1000,
  radius: 1000,
  cityMonth: '',
  preciseTopK: 30,
  topN: 20,
  minGapM: 800,
  satEnabled: true,
  satRadiusM: 2000,
  satMaxOwn: 2
})

const bbox = computed(() => [form.west, form.south, form.east, form.north])

const bboxArea = computed(() => {
  const [w, s, e, n] = bbox.value.map(Number)
  if (![w, s, e, n].every(Number.isFinite) || w >= e || s >= n) return 0
  const midLat = (s + n) / 2
  const h = Math.abs(n - s) * 111.32
  const wd = Math.abs(e - w) * 111.32 * Math.cos((midLat * Math.PI) / 180)
  return Math.round(h * wd)
})

/**
 * 🔴 「预估消耗」必须**始终可点**（只要框选合法），⛔ 不要把 `remaining > 0` 当前置条件。
 *    2026-11-17 生产实测：平台物理池余额 0，按旧写法按钮直接灰掉 ⇒ 用户**看不到「要花几次」**，
 *    也就不知道该采购多少 —— 而 `POST /estimate` 本来就不查联通、不扣配额。
 *    正确做法：预估照跑，把「需要 X / 剩余 Y / 还差 Z」摆出来，再拦住 rank。
 */
const canRun = computed(() => bboxArea.value > 0 && bboxArea.value <= 400)

const quotaAlert = computed(() => {
  if (remaining.value > 0) return null
  return {
    type: 'warning',
    title: '联通人口余额为 0，暂时无法生成推荐',
    desc: '仍可点「预估消耗」查看本次要花几次（不扣费、不调联通），再按缺口采购。'
  }
})

const missingLabel = computed(() => {
  const map = { crowd: '客群', competition: '竞品', district: '商圈（点位不在任何商圈面内）', access: '可达配套（P0 未接入）', cannibal: '自牌蚕食' }
  return (result.value?.missingDims || []).map((k) => map[k] || k).join('、')
})

onMounted(async () => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    narrowMq = window.matchMedia('(max-width: 900px)')
    isNarrow.value = narrowMq.matches
    // addEventListener 在旧 Safari 上叫 addListener —— 用特性检测，别直接调
    if (narrowMq.addEventListener) narrowMq.addEventListener('change', onNarrowChange)
    else if (narrowMq.addListener) narrowMq.addListener(onNarrowChange)
  }
  await Promise.all([loadCities(), loadMyBrands(), loadMonths(), loadQuota()])
})

onBeforeUnmount(() => {
  if (!narrowMq) return
  if (narrowMq.removeEventListener) narrowMq.removeEventListener('change', onNarrowChange)
  else if (narrowMq.removeListener) narrowMq.removeListener(onNarrowChange)
  narrowMq = null
})

async function loadCities() {
  loadingCities.value = true
  try {
    const { data } = await axios.get('/api/site-select/cities')
    cities.value = data?.data?.cities || []
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '城市列表加载失败')
  } finally {
    loadingCities.value = false
  }
}

/** 自有品牌：复用竞品页的 meta（limit=1 只要 brandScope，不拉全量竞品） */
async function loadMyBrands() {
  try {
    const { data } = await axios.get('/api/competitors', { params: { limit: 1, myBrand: '__all__' } })
    myBrands.value = data?.brandScope?.myBrands || []
  } catch {
    myBrands.value = []
  }
}

/**
 * 账期：/smartsteps/months 免费（不扣配额），返回 { months: [{value:'202609', label:'2026年9月'}] }
 * ⚠️ 不要把 `data.months` 当字符串数组 —— 它是对象数组，直接塞给 el-option 会显示 `[object Object]`。
 */
async function loadMonths() {
  try {
    const { data } = await axios.get('/api/smartsteps/months')
    months.value = (data?.months || []).slice(0, 12)
  } catch {
    months.value = []
  }
}

/**
 * 🔴 配额必须查**物理池**（/api/site-select/quota），不能查 /api/purchase/quota。
 *    后者是 `users.quota`（账号被分配的额度）；本功能仅管理员可用，而 admin 走
 *    `checkQuota` 时只校验物理池 ⇒ 管理员很可能「账号额度 0 次、池里还有 1200 次」。
 *    拿账号额度当门禁会让按钮永久禁用。
 */
async function loadQuota() {
  try {
    const { data } = await axios.get('/api/site-select/quota')
    remaining.value = Number(data?.data?.remaining ?? 0) || 0
  } catch {
    remaining.value = 0
  }
}

/** 选城市 ⇒ 用该城 bbox 中心铺一个默认框（用户可改） */
function applyCityBox() {
  const hit = cities.value.find((c) => c.city === form.city)
  if (!hit || !hit.bbox) return
  const [w, s, e, n] = hit.bbox
  const cx = (w + e) / 2
  const cy = (s + n) / 2
  const halfLat = DEFAULT_BOX_KM / 2 / 111.32
  const halfLng = DEFAULT_BOX_KM / 2 / (111.32 * Math.cos((cy * Math.PI) / 180))
  form.west = +(cx - halfLng).toFixed(4)
  form.east = +(cx + halfLng).toFixed(4)
  form.south = +(cy - halfLat).toFixed(4)
  form.north = +(cy + halfLat).toFixed(4)
}

function payload(confirmBurn) {
  const body = {
    bbox: bbox.value,
    stepM: form.stepM,
    city: form.city,
    myBrand: form.myBrand,
    radius: form.radius,
    cityMonth: form.cityMonth,
    topN: form.topN,
    preciseTopK: form.preciseTopK,
    minGapM: form.minGapM,
    saturation: { enabled: form.satEnabled, radiusM: form.satRadiusM, maxOwn: form.satMaxOwn }
  }
  // 🔴 只在用户亲手确认过大额消耗时才带 —— 这是后端的执行口令，⛔ 不要默认塞个值。
  if (confirmBurn) body.confirmBurn = confirmBurn
  return body
}

function fmtErr(e) {
  const d = e?.response?.data
  if (d?.errors?.length) return d.errors.map((x) => x.message).join('；')
  return d?.message || e?.message || '请求失败'
}

/**
 * 第一步：只算不查（0 消耗）。
 * 注意这里**不直接开跑**，而是把数字摆给用户看，确认后才调 rank。
 */
async function runEstimate() {
  if (!canRun.value) return
  estimating.value = true
  estimateInfo.value = null
  try {
    const { data } = await axios.post('/api/site-select/estimate', payload())
    const d = data?.data || {}
    estimateInfo.value = d

    const parts = [
      `框选内将铺出 ${d.gridTotal} 个候选点`,
      `饱和保护剔除 ${d.saturatedDropped} 个`,
      `最终精算 ${d.preciseCount} 个`
    ]
    // 批次 373：框内已购点会被并入候选并**免费**评估，精算数可能因此多于你设的「精算点数」。
    // 不说清楚用户会以为「我设 30 怎么算了 45」，所以单独一行解释。
    if (Number(d.purchasedInBox) > 0) {
      parts.push(`其中 ${d.purchasedInBox} 个是你在框内买过的位置（不额外消耗配额）`)
    }
    parts.push(
      `预计消耗 ${Math.max(0, d.quotaEstimate - d.cacheHitGuess)} 次（${d.cacheHitGuess} 点可复用已购数据）`,
      `当前剩余 ${d.remaining} 次`
    )
    if (d.belowTopN) parts.push(`⚠️ 剩余候选不足 ${form.topN} 条，推荐数会少于目标`)
    if ((d.warnings || []).length) parts.push(...d.warnings)

    // 🔴 余额不足 ⇒ 明确告诉「还差几次」，⛔ 不要让用户点完「确认生成」才吃一个 400。
    //    `estimate` 是 0 消耗的，所以走到这里一分钱没花，正好用来算缺口。
    const needPool = Math.max(0, Number(d.quotaEstimate || 0) - Number(d.cacheHitGuess || 0))
    const left = Number(d.remaining || 0)
    if (needPool > left) {
      await ElMessageBox.alert(
        `本次需要 ${needPool} 次联通人口，当前剩余 ${left} 次，还差 ${needPool - left} 次。\n请先采购联通人口次数后再生成推荐（本次预估未扣费）。`,
        '配额不足',
        { type: 'warning', confirmButtonText: '知道了', customStyle: { whiteSpace: 'pre-line', lineHeight: '1.7' } }
      )
      return
    }

    // 🔴🔴 高消耗熔断：超过默认精算点数 ⇒ 必须**亲手输入次数**（业主 2026-11-17 要求）。
    //    走这里时不再弹普通 confirm —— 一个输入框本身就是确认，叠两个弹窗只会让人盲点。
    if (d.burnRequired) {
      const burned = await askBurnConfirm(parts, d, left)
      if (burned === null) return
      await runRank(burned)
      return
    }

    await ElMessageBox.confirm(parts.join('\n'), '确认生成推荐', {
      confirmButtonText: '确认生成',
      cancelButtonText: '取消',
      type: 'warning',
      customStyle: { whiteSpace: 'pre-line', lineHeight: '1.7' }
    })

    await runRank()
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(fmtErr(e))
  } finally {
    estimating.value = false
  }
}

/**
 * 🔴🔴 高消耗确认（「熔断」的交互层）。
 *
 * 规则一句话：**默认精算点数（30）以内照常确认；超过就必须亲手敲出本次消耗次数。**
 * 目的是把「手滑把 30 拖到 50」从一个无阻力的动作，变成一次需要念出数字的动作。
 *
 * ⚠️ 阈值与次数**一律来自 `/estimate`**（`burnConfirm` / `burnCount`），
 *    ⛔ 前端不硬编码 30 —— 后端调阈值而前端没跟，会变成「前端不弹、后端 400」的
 *    假死（用户点确认 → 后端拒绝 → 界面只报一句"需二次确认"，无从下手）。
 *
 * @returns {Promise<number|null>} 确认成功返回本次消耗次数；取消/输错返回 null
 */
async function askBurnConfirm(parts, d, left) {
  const need = Number(d.burnCount || 0)
  const limit = Number(d.burnConfirm || 0)
  const pct = left > 0 ? Math.round((need / left) * 100) : 100
  const msg = [
    ...parts,
    '',
    `⚠️ 本次消耗 ${need} 次，超过默认精算点数 ${limit} 次（占当前剩余 ${left} 次的 ${pct}%）。`,
    `确认无误解后，请输入 ${need} 继续：`
  ].join('\n')
  try {
    const { value } = await ElMessageBox.prompt(msg, '高消耗确认', {
      confirmButtonText: '确认生成',
      cancelButtonText: '取消',
      inputPattern: /^\d+$/,
      inputErrorMessage: '请输入整数',
      inputPlaceholder: `输入 ${need}`,
      type: 'warning',
      customStyle: { whiteSpace: 'pre-line', lineHeight: '1.7' }
    })
    // 输错就是取消 —— ⛔ 不要"帮用户改正后继续"，那等于没有确认
    if (Number(value) !== need) {
      ElMessage.warning(`输入的「${value}」与本次消耗 ${need} 次不一致，已取消（未消耗配额）`)
      return null
    }
    return need
  } catch (e) {
    if (e === 'cancel' || e === 'close') return null
    throw e
  }
}

/** 第二步：真正执行（会扣配额） */
async function runRank(confirmBurn) {
  ranking.value = true
  result.value = null
  try {
    const { data } = await axios.post('/api/site-select/rank', payload(confirmBurn))
    if (!data?.success) throw new Error(data?.message || '生成失败')
    result.value = data.data
    remaining.value = Number(data.data?.quota?.remaining ?? remaining.value) || 0
    ElMessage.success(`已生成 ${data.data.returned} 条推荐，消耗 ${data.data.quota.used} 次`)
  } catch (e) {
    // 🔴 后端算出实际消耗与前端预估不同（参数变了 / 缓存被别的请求写入）⇒ 不能用旧数字重试，
    //    让用户回去重新预估一次，看到的是新的数字。⛔ 不要在这里自动带新值重发。
    const res = e?.response?.data
    if (res?.code === 'burn_confirm_required') {
      ElMessage.warning(`实际消耗为 ${res.confirmBurn ?? res.need} 次，与预估不一致，请重新点「预估消耗」后再确认`)
      return
    }
    ElMessage.error(fmtErr(e))
  } finally {
    ranking.value = false
  }
}

async function saveCandidate(row) {
  try {
    await axios.post('/api/candidates', {
      name: `选址推荐 #${row.rank}（${form.city || '框选区域'}）`,
      brand: form.myBrand || '',
      city: form.city || '',
      latitude: row.center[1],
      longitude: row.center[0],
      radius: row.radius,
      stage: '待评估',
      source: 'site-select'
    })
    ElMessage.success('已存为候选点位，可在「选址工作台 → 候选点位」跟进')
  } catch (e) {
    ElMessage.error(fmtErr(e))
  }
}

function fmtWan(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)} 万`
  return `${Math.round(v)} 人`
}

function fmtKm(m) {
  const km = (Number(m) || 0) / 1000
  return `${km >= 10 ? km.toFixed(1) : km.toFixed(2)}km`
}

/**
 * 到访人次：null ⇒ '—'（未评），⛔ 不能走 fmtWan —— 那会把 null 显示成「0 人」，
 * 看起来像"这里没人来"，实际是"联通没返回该字段"。
 * 注意 0 是有效值（真实无到访），必须显示「0 人次」而不是「—」。
 * 单位统一带「人次」：到访是**累计流量**，写成「人」会被误读成时点存量。
 */
function fmtVisit(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v) || 0
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)} 万人次`
  return `${Math.round(n)} 人次`
}

function fmtDim(v) {
  return Number.isFinite(v) ? v : '—'
}

function brandText(byBrand) {
  // byBrand 形如 `{ 星巴克: 3, 瑞幸咖啡: 2 }`（后端 countWithin 的产物）。
  // ⚠️ 必须显式排除数组：`typeof [] === 'object'`，只判 object 的话，
  //    万一接口改传 `['星巴克','瑞幸']`，Object.entries 会给出 `['0','星巴克']`，
  //    页面就渲染成「0 星巴克 / 1 瑞幸」—— 数字变成了下标，看着像数据、其实是假的。
  if (!byBrand || typeof byBrand !== 'object' || Array.isArray(byBrand)) return ''
  return Object.entries(byBrand)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([b, n]) => `${b} ${n}`)
    .join(' / ')
}

// 选城市后自动填框。用 watch 而不是 @change：el-select 清空时不触发 change。
watch(() => form.city, () => applyCityBox())
</script>

<style scoped>
.ss-page {
  padding: 20px 24px 40px;
  max-width: 1400px;
  margin: 0 auto;
}
.ss-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.ss-head h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-size: 20px;
}
.ss-sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary, #5a6270);
}
.ss-quota {
  margin-bottom: 12px;
}
.ss-card {
  background: #fff;
  border: 1px solid var(--el-border-color-lighter, #e6e8eb);
  border-radius: 10px;
  padding: 16px 18px;
  margin-bottom: 14px;
}
.ss-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px 20px;
}
.ss-span-2 {
  grid-column: span 2;
}
.ss-w-full {
  width: 100%;
}
.ss-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ss-num {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-color-primary, #2563eb);
}
/* 到访人次参与 A2 打分（v1.13.371 起）⇒ 与居住/工作区分开，避免"三个数一样重"的误读 */
.ss-visit {
  font-weight: 600;
  color: var(--el-color-primary, #2563eb);
}
.ss-muted {
  font-size: 12px;
  color: var(--text-secondary, #5a6270);
}
.ss-warn {
  color: var(--el-color-warning, #b88230);
}
.ss-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #5a6270);
  margin-top: 2px;
}
.ss-bbox {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ss-bbox-f {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-regular, #3d4450);
}
.ss-bbox-f :deep(.el-input-number) {
  width: 86px;
}
.ss-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-lighter, #e6e8eb);
  margin-top: 8px;
}
.ss-notes {
  margin-bottom: 12px;
}
.ss-note-item {
  margin-bottom: 6px;
}
.ss-quota-used {
  font-size: 13px;
  color: var(--text-regular, #3d4450);
  padding: 4px 2px;
}
.ss-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  font-size: 13px;
}
.ss-score {
  font-size: 18px;
  font-weight: 700;
  color: var(--el-color-primary, #2563eb);
  line-height: 1.1;
}
.ss-dims {
  display: flex;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary, #5a6270);
  margin-top: 2px;
}
.ss-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ss-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.ss-reason {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-regular, #3d4450);
}
.ss-foot-note {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary, #5a6270);
}

/* 窄屏：三列塌成一列（与全站 `@media (max-width: 900px)` 断点一致） */
@media (max-width: 900px) {
  .ss-page {
    padding: 14px 12px 32px;
  }
  .ss-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .ss-span-2 {
    grid-column: span 1;
  }
  .ss-head {
    flex-direction: column;
  }
  .ss-bbox-f :deep(.el-input-number) {
    width: 74px;
  }
}
</style>
