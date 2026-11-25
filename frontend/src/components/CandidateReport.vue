<template>
  <!-- 🔴 v1.13.391：弹窗宽度 880 → 912。880 时 `.rp-scroll` 内宽只剩 770px，
       而 A4 纸张固定 794px ⇒ 纵向滚动条一出现就同时冒出**横向**滚动条（溢出 24px）。
       391 起报告内容明显变长、纵向滚动成为常态，这个老缺陷就每次都会出现。 -->
  <el-dialog
    :model-value="modelValue"
    title="选址立项报告"
    width="912px"
    append-to-body
    class="cand-report-dialog"
    @update:model-value="$emit('update:modelValue', $event)"
    @opened="onOpened"
  >
    <!-- ── 空态：该位置还没有买过联通人口 ────────────────────────────────────
         🔴 v1.13.413（业主 2026-11-24）：「大前提是在『初步分析』中购买了联通配额之后
            才使用『生成立项报告』」。⇒ 没买过就**不出纸**，也不给 PDF / 分享按钮。
            护栏有两层：① 进入弹窗前 `CandidateView.openReport` 已经查过一次并拦下；
            ② 这里再兜一层（数据可能在弹窗打开期间被作废），⛔ 不要因为"上面已经拦过"就删掉。 -->
    <div v-if="tiersReady && !hasTiers" class="rp-empty">
      <div class="rp-empty-t">该点位还没有可用的联通人口数据</div>
      <p class="rp-empty-p">
        立项报告的人口分析必须基于「初步分析」中购买的联通人口（按次配额）。
        报告本身不发起任何取数，因此不会消耗配额。
      </p>
      <el-button type="primary" @click="goBrief">去「初步分析」购买联通人口</el-button>
    </div>

    <template v-if="!tiersReady || hasTiers">
      <div class="rp-bar">
        <div class="rp-bar-l">
          <!-- 🔴 不做 disabled：禁用的勾选框点不动，用户根本看不到「为什么」。
               现在允许点击，点了再明确告诉他「仅限 VIP + 怎么申请」（业主 2026-11-09 要求）。 -->
          <el-checkbox :model-value="wantAi" :disabled="aiLoading" @change="onWantAiChange">
            加入 AI 选址建议
          </el-checkbox>
          <span class="rp-hint">
            <template v-if="!isVip">🔒 仅限 VIP 用户 · 点击勾选可查看申请方式</template>
            <template v-else>勾选后消耗 1 次 AI 调用（约 ¥0.02），需额外等待十几秒；默认不包含</template>
          </span>
        </div>
        <el-button
          v-if="wantAi && !aiText"
          type="primary"
          size="small"
          :loading="aiLoading"
          @click="genAi"
        >{{ aiLoading ? 'AI 生成中…' : '生成 AI 建议' }}</el-button>
        <el-button v-else-if="aiText" size="small" :loading="aiLoading" @click="genAi">重新生成</el-button>
      </div>

      <!-- 人口数据条（**纸外**，不会进 PDF）
           🔴 v1.13.413：这里只**读**该位置已购的档位，没有「获取人口数据」按钮了 ——
              报告侧的取数链路已整条删除（旧实现走 POST /smartsteps/population，能自己花钱）。
              下拉里的档位＝用户真正买过的半径，⛔ 不再固定 1/3/5km。 -->
      <div v-if="candidate" class="rp-popbar">
        <span class="rp-popbar-l">
          <b>联通人口</b>
          <el-select
            v-model="popRadius"
            size="small"
            style="width: 132px"
            :disabled="tiersLoading || !hasTiers"
            aria-label="选择已购人口半径"
          >
            <el-option v-for="t in tiers" :key="t.radius" :value="t.radius" :label="`半径 ${radiusText(t.radius)}`" />
          </el-select>
          <template v-if="popData">
            <!-- ⚠️ v1.13.413 起这里**恒为不消耗**：报告侧只有一条 GET 只读请求，
                 没有配额闸门、没有缓存扣费、没有上游调用 ⇒ 再做「本次消耗 N 次」的
                 条件渲染等于给一个不可能发生的事留分支。 -->
            <span class="rp-popbar-ok">
              已购数据 · 不消耗配额
              <template v-if="popMonth"> · 期次 {{ popMonth }}</template>
              <template v-if="tiers.length > 1"> · 共 {{ tiers.length }} 档可对比</template>
            </span>
            <span v-if="curTier && curTier.storeName" class="rp-popbar-note">（{{ curTier.storeName }}）</span>
          </template>
          <!-- ⚠️ 加载中与"确实没买过"必须分开写：把加载态显示成「尚未购买」，
               用户会以为白买了又去买一次。 -->
          <span v-else-if="tiersLoading" class="rp-popbar-note">正在读取该位置已购的人口档位…</span>
          <span v-else class="rp-popbar-miss">尚未购买（先去初步分析买人口）</span>
        </span>
        <span class="rp-popbar-r">
          <!-- 🔴 v1.13.400：纸面只放 8~9 项研判指标（76 个标签的摘要），逐项明细在
               「购买履历」里本来就看得全 ⇒ 这里给一个跳转入口。
               ⚠️ 这个按钮**必须在纸外**（纸面组件 ReportPaper 是纯展示，⛔ 不许有路由跳转，
                  否则 392 的免登录分享页就没法复用它）。 -->
          <el-button
            v-if="popData && popPurchaseId"
            size="small"
            link
            type="primary"
            @click="openAllTags"
          >查看全部标签</el-button>
        </span>
      </div>

      <!-- AI 业态未知时先问一句（⛔ 不让模型猜业态，与 AI 选址建议同口径） -->
      <div v-if="wantAi && needCategory" class="rp-cat">
        <span>该品牌未收录业态，请先填写：</span>
        <el-input v-model="categoryInput" size="small" style="width: 240px" maxlength="30" placeholder="例：日式牛肉盖饭快餐" />
      </div>

      <div v-loading="loading" class="rp-scroll">
        <!-- 纸面本身抽成 ReportPaper（v1.13.392）：分享出去的免登录页用的是同一个组件，
             两处渲染同源 ⇒ 同事看到的与作者看到的必然一致。 -->
        <ReportPaper
          ref="paperRef"
          :model="model"
          :map-img="mapImg"
          :ai-text="aiText"
          :author-name="username"
          detail-hint="完整清单见购买履历"
        />
      </div>
    </template>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      <!-- v1.13.392：分享放在「下载 PDF」左边 —— 业主定的顺序是先判值不值得、
           再发给同事及领导；PDF 是留档，分享是沟通，沟通先于留档。
           🔴 v1.13.413：两份产物都要求「买过人口」—— 没有人口的分析报告不能外发。 -->
      <el-button :disabled="!hasTiers || !model" @click="shareVisible = true">分享给同事</el-button>
      <el-button type="primary" :disabled="!hasTiers" :loading="exporting" @click="exportPdf">下载 PDF</el-button>
    </template>
  </el-dialog>

  <!-- 分享面板（链接 + 邮件发链接）；挂在这里而不是嵌在弹窗内，避免两层 dialog 的 z-index 打架 -->
  <ReportShareDialog
    v-model="shareVisible"
    :candidate-id="candidate ? candidate.id : null"
    :model="model"
    :map-img="mapImg"
    :ai-text="aiText"
  />
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { pickDistrictForPoint, buildReportModel, fmtM, radiusText } from '@/utils/candidateReport.js'
import { resolveBrandCategory } from '@/utils/storeBrand.js'
import { captureMapOnlyCanvas } from '@/utils/mapCapture'
import ReportPaper from '@/components/ReportPaper.vue'
import ReportShareDialog from '@/components/ReportShareDialog.vue'
import { exportPaperPdf, fileStamp, safeFileName } from '@/utils/exportPaperPdf.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  candidate: { type: Object, default: null }
})
// `gobrief`：空态里「去初步分析」——由父组件切视图（它才持有 briefRow / 抽屉状态）
const emit = defineEmits(['update:modelValue', 'gobrief'])

const userStore = useUserStore()
const router = useRouter()

const loading = ref(false)
const exporting = ref(false)
const paperRef = ref(null)   // ReportPaper 组件实例；导出 PDF 时取它的 $el
const shareVisible = ref(false)
const districts = ref([])
// v1.13.346：`/api/districts?brand=` 返回的竞品品牌口径，用来在报告里写清「竞品数是怎么数出来的」。
//   三态：null/undefined＝后端未返回（拿不到口径，注记按「未指定品牌」处理）；
//        { configured:false }＝该自有品牌没配映射 ⇒ 全量；{ configured:true, brands:[…] }＝已收窄。
const brandScope = ref(null)
const mapImg = ref('')

// ── 联通人口（1001）────────────────────────────────────────
// 🔴🔴 v1.13.413（业主 2026-11-24 拍板）：报告的联通人口**只读已购数据**，
//   报告侧一条取数请求都不发。
//   业主原话：「大前提是在『初步分析』中购买了联通配额之后才使用『生成立项报告』」。
//   旧实现（341~412）在这里 POST `/api/smartsteps/population` 按 1/3/5km 现取：
//     · 报告能**自己花钱**（护栏只剩"用户点了按钮"这种前端自觉）；
//     · 半径写死 1/3/5km，而初步分析里能买 0.35~5km 任意档 ⇒ 用户买的 1.5km 选不出来。
//   现在档位来自 `GET /api/candidates/purchased-population`（只读、毫秒级、0 消耗），
//   ⇒ 「以实际购买的半径为基础」和「不可能产生费用」两件事同时成立。
//
// 🔴 守卫 `candidateReportPurchasedGuard.test.js` 钉死：本文件⛔ 不许再出现
//   `/smartsteps/population`、`probeOnly`、`获取人口数据` 这些字样 —— 加回去就是回退。
const tiers = ref([])            // [{ radius, cityMonth, purchaseId, purchasedAt, storeName, population }]
const tiersLoading = ref(false)
const tiersReady = ref(false)    // 拉取已结束（无论有没有），用于区分「加载中」与「空态」
/** 当前选中档的半径（米）—— 报告正文与纸面主档都跟它走 */
const popRadius = ref(null)
// ⭐ radiusText 只用 utils/candidateReport.js 那一份（⛔ 组件里不许另写，否则标签与纸面口径会分叉）

const hasTiers = computed(() => tiers.value.length > 0)
const curTier = computed(() => tiers.value.find((t) => t.radius === popRadius.value) || null)
/** 联通 1001 解析结果（给 buildReportModel 用的**原始结构**） */
const popData = computed(() => curTier.value?.population || null)
const popMonth = computed(() => curTier.value?.cityMonth || '')
/**
 * 本次真正用在报告上的那条购买记录 id（v1.13.400）。
 * 🔴 v1.13.413 起只有一种来源：该档被复用的那条购买记录（可能是门店买的多服务码套餐）。
 *   ⛔ 不要按门店名去履历里猜 —— 同名会有多条。
 */
const popPurchaseId = computed(() => curTier.value?.purchaseId || null)

const wantAi = ref(false)      // 🔴 默认 false：不勾就不花钱（业主 2026-11-09 定）
const aiText = ref('')
const aiLoading = ref(false)
const categoryInput = ref('')

const isVip = computed(() => !!userStore.isVipActive)
const username = computed(() => userStore.user?.username || '—')

/** 点位命中的商圈（供取数用；模板里也用得到商圈名） */
const hitInfo = computed(() => {
  const c = props.candidate || {}
  return pickDistrictForPoint(districts.value, Number(c.latitude), Number(c.longitude))
})
const districtName = computed(() => hitInfo.value.district?.name || '')

const model = computed(() => {
  const c = props.candidate || {}
  return buildReportModel(c, hitInfo.value, {
    population: popData.value,
    popMonth: popMonth.value,
    popRadius: popRadius.value,
    // v1.13.346：把后端返回的竞品口径一起交给报告 —— 否则报告只能说「N 家竞品」，
    //   说不出这 N 家是「全量」还是「按本品牌映射收窄后」的，口径不可追溯。
    brandScope: brandScope.value,
    // v1.13.413：多档并列对比（纸面那张表）。⚠️ 只传已购档，⛔ 不要塞 1/3/5km 默认档 ——
    //   表里出现一个没买过的半径，等于纸上摆了一份没有证据的结论。
    tiers: tiers.value
  })
})

/** 业态：白名单能命中就用，命中不了要用户填（⛔ 不让模型猜） */
const resolvedCat = computed(() => {
  const c = props.candidate || {}
  return resolveBrandCategory(c.brand || c.name || '', c.city || '')
})
const needCategory = computed(() => !resolvedCat.value.mapped && !categoryInput.value.trim())

/**
 * AI 勾选拦截：非 VIP 时**不允许勾上**，并把「仅限 VIP + 去哪申请」说清楚。
 * ⚠️ 不用 `:disabled`：禁用的勾选框点不动，用户只看到灰色框，不知道原因也没有出路。
 */
async function onWantAiChange(val) {
  if (!val) { wantAi.value = false; return }
  if (isVip.value) { wantAi.value = true; return }

  wantAi.value = false   // 非 VIP 一律勾不上
  let go = false
  try {
    await ElMessageBox.confirm(
      '「AI 选址建议」为 VIP 专属功能，当前账号未开通。\n\n' +
      '可在「我的账户」页提交 VIP 申请，通过后即可使用。报告不含 AI 建议也可正常导出。',
      'VIP 专属功能',
      { confirmButtonText: '去我的账户申请', cancelButtonText: '暂不需要', type: 'warning' }
    )
    go = true
  } catch {
    return
  }
  if (go) {
    try {
      router.push('/account')
    } catch {
      window.location.href = '/account'
    }
  }
}


/**
 * 拉取该位置**已购**的联通人口档位（只读、0 消耗、0 写入）。
 *
 * 🔴🔴 这是报告唯一的人口数据来源（v1.13.413）。它只 `GET`，不 POST、不传 months、
 *   不碰配额闸门 ⇒ 无论用户怎么点，都不可能产生费用。
 * 🔴 档位来自「用户真正买过的半径」，⛔ 不再是固定的 1/3/5km：
 *   初步分析里能买 0.35~5km 任意档，写死三档就等于「买得到的档在报告里选不出来」。
 *
 * ⚠️ 入参与 `GET /brief` 完全同源：优先 `markerId`（门店驱动的候选点位可能还没有
 *   推进记录、`id === null`，用 id 会直接 404），没有再退回 `id`。
 *   ⛔ 不要在这里调 `POST /ensure` 去"补一个 id"：看一眼买没买过不该在库里建行。
 */
async function loadTiers() {
  tiersLoading.value = true
  tiersReady.value = false
  tiers.value = []
  popRadius.value = null
  const c = props.candidate
  const params = c?.markerId ? { markerId: c.markerId } : (c?.id ? { id: c.id } : null)
  if (!params) {
    tiersLoading.value = false
    tiersReady.value = true
    return
  }
  try {
    const { data } = await axios.get('/api/candidates/purchased-population', { params })
    const list = Array.isArray(data?.tiers) ? data.tiers : []
    tiers.value = list
    if (list.length) popRadius.value = pickNearestTier(list, Number(c.radius) || 1000)
  } catch (e) {
    // 读失败就按「没买过」处理：宁可让用户去初步分析看一眼，也不能谎称有数据可用
    console.warn('[立项报告] 读取已购人口失败:', e?.response?.data?.message || e?.message || e)
    tiers.value = []
  } finally {
    tiersLoading.value = false
    tiersReady.value = true
  }
}

/**
 * 默认选中哪一档：取候选点位评估半径**最近**的一档。
 * 🔴 为什么是最近而不是最大：报告正文要回答的是「这个点位按它的评估半径看怎么样」，
 *   评估半径是用户当初填的那个判断尺度。买过更大档只是"顺便能对比"，
 *   ⛔ 不要拿最大档当默认 —— 那会让正文凭空放大成 5km 的结论。
 */
function pickNearestTier(list, wantM) {
  const want = Number(wantM) || 0
  let best = list[0]
  for (const t of list) {
    if (Math.abs(t.radius - want) < Math.abs(best.radius - want)) best = t
  }
  return best.radius
}


/**
 * 跳「购买履历」看这份人口数据的**全部标签**（v1.13.400）。
 *
 * 🔴 为什么是跳转而不是在报告里展开：1001 一次返回 76 个字段，纸面只摘 8~9 项；
 *   而「我的门店」买的套餐里可能还有 1005 时段人流 / 1006 停留 / 1007 到达频次 /
 *   1009 消费水平 / 1010 教育 / 1011 行业 / 1012 人生阶段 / 1013 综合消费 / 1015 资产 ——
 *   那些只有履历详情页能完整呈现，报告里再做一个只读抽屉必然缺一半。
 *
 * ⚠️ 携带 `purchase` 精确到记录 id：按门店名猜会命中同名多条（见 MyAccountView 的 openHistory 分支）。
 * ⚠️ 本入口只在**登录态**存在（CandidateReport 本身就在路由守卫之后）；
 *   392 的免登录分享页不渲染它 —— 访客没有履历可看，点了只会撞登录页。
 */
function openAllTags() {
  const id = popPurchaseId.value
  if (!id) return ElMessage.warning('未找到对应的购买记录，请到「我的账户 → 购买履历」查看')
  emit('update:modelValue', false)     // 先关报告弹窗，避免跳转后残留在上一页
  router.push({ path: '/account', query: { openHistory: 'true', purchase: String(id) } })
}

/** 打开时按城市拉商圈面（一次），并把地图截图渲出来 */
async function onOpened() {
  if (!props.candidate) return
  loading.value = true
  mapImg.value = ''
  try {
    const city = String(props.candidate.city || '').replace(/市$/, '')
    if (city) {
      // v1.13.346：把候选点位自己的品牌传下去，后端据此把「商圈内竞品」收窄到该品牌的竞品集合。
      //   🔴 这个调用用的是**裸 axios**（不是 utils/api.js 的包装），响应**没有**被解包 ⇒ `const { data }` 是对的，
      //      千万不要照 344 那个坑改成直接取 body。
      //   brand 为空 ⇒ 传 undefined，axios 会省略该参数 ⇒ 后端回退全量（与 345 的三态语义一致）。
      const { data } = await axios.get('/api/districts', {
        params: { city, brand: props.candidate.brand || undefined }
      })
      districts.value = data.districts || []
      brandScope.value = data.brandScope || null
    } else {
      districts.value = []
      brandScope.value = null
    }
  } catch (e) {
    districts.value = []
    brandScope.value = null
    ElMessage.warning('商圈数据读取失败，报告将只包含登记信息')
  } finally {
    loading.value = false
  }
  // v1.13.413：人口改为「读已购档位」（0 消耗）。与商圈面并行，谁快谁先到都不影响渲染。
  await loadTiers()
  renderMap()
}

/**
 * 空态里的「去初步分析」。
 * ⚠️ 本组件**不改路由、不调父组件方法名**：只 emit 一个意图，由 `CandidateView` 决定
 *   怎么切视图（它还要顺手关掉抽屉/弹窗）。⛔ 不要在这里 `router.push` ——
 *   初步分析是候选点位页内的视图状态（`briefRow`），不是一条独立路由。
 */
function goBrief() {
  emit('update:modelValue', false)
  emit('gobrief')
}

/** 地图截图：复用已有的纯 Canvas 渲染（只画点位与半径圈，不画竞品/购物中心） */
async function renderMap() {
  const c = props.candidate
  if (!c) return
  try {
    const res = await captureMapOnlyCanvas(Number(c.latitude), Number(c.longitude), Number(c.radius) || 1000)
    // ⚠️ `captureMapOnlyCanvas` 返回的是 **dataURL 字符串**（不是 canvas）；
    //    另外两个 capture* 的返回类型不同 ⇒ 两种都接住，别假设。
    //    （踩过：当成 canvas 用 `res.toDataURL` ⇒ undefined ⇒ 被 if 静默跳过，报告里地图空白且无报错）
    if (typeof res === 'string' && res) mapImg.value = res
    else if (res && typeof res.toDataURL === 'function') mapImg.value = res.toDataURL('image/jpeg', 0.82)
  } catch (e) {
    console.warn('[立项报告] 地图截图失败:', e?.message || e)
  }
}

/** 生成 AI 建议（可选，默认不调 —— 调一次花一次钱） */
async function genAi() {
  if (!isVip.value) return ElMessage.warning('AI 选址建议仅限 VIP 用户，请在「我的账户」申请开通')
  // v1.13.413：没有已购人口 ⇒ 报告本身就是空的，⛔ 不要再花一次 AI 调用去评论一份不存在的报告
  if (!hasTiers.value) return ElMessage.warning('该点位还没有联通人口数据，请先到「初步分析」购买')
  if (!popData.value) {
    // 不阻断（用户可能就想要竞争/地铁维度的建议），但必须说清楚少了一半依据
    ElMessage.warning('当前档位缺少人口结构数据 —— AI 建议将缺少人口依据')
  }
  const cat = resolvedCat.value.mapped ? resolvedCat.value.category : categoryInput.value.trim()
  if (!cat) return ElMessage.warning('该品牌未收录业态，请先填写业态')

  aiLoading.value = true
  aiText.value = ''
  try {
    const m = model.value
    const c = props.candidate
    // dataSummary 只喂已有事实，⛔ 不塞预测值（模型会把预测当已知继续推）
    const summary = m.facts.map((f) => `${f.label}：${f.value}${f.note ? '（' + f.note + '）' : ''}`).join('\n')
    const token = sessionStorage.getItem('token')
    const res = await axios.post('/api/ai/site-advice', {
      storeName: c.name || '',
      brand: c.brand || c.name || '',
      category: cat,
      city: c.city || '',
      radius: `半径 ${fmtM(m.coordinate.radius)}`,
      dataSummary: summary,
      lat: m.coordinate.lat,
      lng: m.coordinate.lng,
      radiusMeters: m.coordinate.radius,
      radii: [m.coordinate.radius],
      stream: false
    }, { headers: { Authorization: 'Bearer ' + token }, timeout: 120000 })
    aiText.value = res.data?.reply || '（AI 未返回内容）'
  } catch (e) {
    const msg = e?.response?.data?.message || 'AI 服务不可用'
    ElMessage.error(msg)
  } finally {
    aiLoading.value = false
  }
}

/**
 * 导出 PDF。
 * 🔴 v1.13.377：截图 + 分页逻辑抽到 utils/exportPaperPdf.js（初步分析报告共用同一份）。
 *    版本规则（A4 纵向 / ≥72% 才单页 / 最多 3 页）全部在那边，⛔ 不要在这里重新实现一遍。
 *    这里只保留**业务副作用**：导出成功后给候选点位写一条留痕流水。
 * 🔴 v1.13.413：没有已购人口就 ⛔ 不出 PDF —— 按钮已 disabled，这里再兜一次，
 *    防止「用键盘/脚本触发 click」绕过按钮状态。
 */
async function exportPdf() {
  if (!hasTiers.value) return ElMessage.warning('该点位还没有联通人口数据，请先到「初步分析」购买')
  // 🔴 纸面在 ReportPaper 里 ⇒ 必须取组件根元素（它的根就是 `.rp-paper`）。
  //    ⛔ 不要写成 `paperRef.value`：那是个组件实例，html2canvas 拿到它会直接报错。
  const paperEl = paperRef.value?.$el
  if (!paperEl) return
  exporting.value = true
  try {
    await exportPaperPdf(paperEl, `立项报告_${safeFileName(model.value.projectName)}_${fileStamp()}.pdf`)
    // 留一条生成记录（谁在什么时候给哪个点位出了报告），失败不打断导出
    if (props.candidate?.id) {
      axios.post(`/api/candidates/${props.candidate.id}/report`, { withAi: !!aiText.value }).catch(() => {})
    }
  } catch (e) {
    ElMessage.error('生成 PDF 失败：' + (e?.message || '未知错误'))
  } finally {
    exporting.value = false
  }
}

/**
 * 关掉弹窗时清掉 AI 文本与已购档，避免下次打开看到上一个点位的数据。
 * ⚠️ v1.13.413 起**没有** `watch(popRadius)` 了：`popData` 已改成从 `curTier` 派生的
 *   computed，换档自动跟着变，不需要（也不许）手工清空 —— 手工清空反而会和 computed 打架。
 */
watch(() => props.modelValue, (v) => {
  if (!v) {
    aiText.value = ''
    wantAi.value = false
    categoryInput.value = ''
    // 已购档也清掉：下次打开重新读（用户可能刚在初步分析里买过新档）
    tiers.value = []
    tiersReady.value = false
    popRadius.value = null
  }
})
</script>

<style scoped>
.rp-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.rp-bar-l { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.rp-hint { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }

/* 空态（纸外）：该点位没买过联通人口 —— 不出纸、不给 PDF/分享（v1.13.413） */
.rp-empty {
  padding: 28px 22px; text-align: center;
  background: #fbfdff; border: 1px dashed #b9d4f5; border-radius: 8px;
}
.rp-empty-t { font-size: 15px; font-weight: 600; color: #1f2329; margin-bottom: 8px; }
.rp-empty-p { margin: 0 auto 16px; max-width: 520px; font-size: 13px; line-height: 1.7; color: #646a73; }

/* 人口条：在**纸外**（不进 PDF），只做「读哪一档」的选择与状态提示 */
.rp-popbar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 8px 12px; margin-bottom: 10px;
  background: #f4f8ff; border: 1px solid #d9e6fb; border-radius: 6px; font-size: 13px;
}
.rp-popbar-l { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.rp-popbar-ok { color: #16794a; }
.rp-popbar-miss { color: #b26a00; font-weight: 600; }
.rp-popbar-note { color: #8a9099; font-size: 12px; }
.rp-popbar-r { display: flex; align-items: center; gap: 8px; }

.rp-cat { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-regular); margin-bottom: 10px; }
.rp-scroll { max-height: 62vh; overflow: auto; background: #f2f3f5; padding: 16px; }

/* ⚠️ 纸内样式（.rp-paper / .rp-sec / .rp-pop-* / .rp-map / .rp-table / .rp-foot …）
   全部住在 components/ReportPaper.vue 里 —— v1.13.392 抽成共用组件后，
   ⛔ 不要在这里再写一份：两份样式一旦分叉，弹窗与分享页就会长得不一样。 */
</style>
