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

    <!-- 人口取数条（**纸外**，不会进 PDF）：按「点位 + 半径」取联通 1001，可复用「我的门店」已购数据 -->
    <div v-if="candidate" class="rp-popbar">
      <span class="rp-popbar-l">
        <b>人口数据</b>
        <el-select v-model="popRadius" size="small" style="width: 108px" :disabled="popLoading" @change="onRadiusChange">
          <el-option v-for="r in RADIUS_OPTIONS" :key="r" :value="r" :label="`半径 ${radiusText(r)}`" />
        </el-select>
        <template v-if="popData">
          <span class="rp-popbar-ok">
            <template v-if="popSource === 'purchase'">已复用「我的门店」已购数据</template>
            <template v-else-if="popSource === 'cache'">命中同位置已有数据（未重复调用联通）</template>
            <template v-else>已获取联通数据</template>
            <template v-if="popMonth"> · 期次 {{ popMonth }}</template>
            · {{ popQuotaUsed ? `本次消耗 ${popQuotaUsed} 次配额` : '本次未消耗配额' }}
          </span>
          <span v-if="popReused && popReused.storeName" class="rp-popbar-note">（{{ popReused.storeName }}）</span>
        </template>
        <template v-else>
          <span class="rp-popbar-miss">尚未获取</span>
          <!-- v1.13.381：平台有数据 ≠ 本账号买过 ⇒ 只提示「有数据可查」，取数照样计费 -->
          <span v-if="popCachedMonth" class="rp-popbar-note">该位置已有数据可查（期次 {{ popCachedMonth }}），取数消耗 1 次配额</span>
          <span v-else class="rp-popbar-note">联通智慧足迹 · 点位半径口径 · 同半径已购自动复用</span>
        </template>
      </span>
      <span class="rp-popbar-r">
        <el-button v-if="!popData" size="small" type="primary" plain :loading="popLoading" @click="fetchPopulation">
          获取人口数据（剩余 {{ quotaInfo.available }} 次）
        </el-button>
        <el-button v-else size="small" :loading="popLoading" @click="fetchPopulation">刷新</el-button>
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
      />
    </div>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      <!-- v1.13.392：分享放在「下载 PDF」左边 —— 业主定的顺序是先判值不值得、
           再发给同事及领导；PDF 是留档，分享是沟通，沟通先于留档。 -->
      <el-button :disabled="!model" @click="shareVisible = true">分享给同事</el-button>
      <el-button type="primary" :loading="exporting" @click="exportPdf">下载 PDF</el-button>
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
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { pickDistrictForPoint, buildReportModel, fmtM, radiusText } from '@/utils/candidateReport.js'
import { resolveBrandCategory } from '@/utils/storeBrand.js'
import { captureMapOnlyCanvas } from '@/utils/mapCapture'
import ReportPaper from '@/components/ReportPaper.vue'
import ReportShareDialog from '@/components/ReportShareDialog.vue'
import { requireQuota, QUOTA_REASON } from '@/utils/quotaContact.js'
import { exportPaperPdf, fileStamp, safeFileName } from '@/utils/exportPaperPdf.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  candidate: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue'])

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
// 🔴 业主 2026-11-09 定：报告人口**不再用商圈边界面属性**，改用按次计费的联通人口配额。
//    ⇒ 打开报告只做免费探测，要花钱必须用户点按钮明确确认。
const popData = ref(null)                       // 联通 1001 解析结果
const popMonth = ref('')                        // 期次，如 202510
const popLoading = ref(false)
const popSource = ref('')                       // purchase（本人已购）| cache（平台有数据，仍计费）| fresh
const popQuotaUsed = ref(0)                     // 本次实际扣了几次（0 = 复用本人已购）
const popCachedMonth = ref('')                  // 探测到「有缓存可查」时的期次（仅提示，不展示数据）
const popReused = ref(null)                     // { storeName, purchasedAt }
const quotaInfo = ref({ available: 0, remaining: 0, loaded: false })

/** 报告里可选的三档半径（与后端 REPORT_RADII 一致） */
const RADIUS_OPTIONS = [1000, 3000, 5000]
/** 把候选点位自带的半径归到最接近的一档（它可能是 800/1500 之类） */
function nearestRadius(m) {
  const n = Number(m) || 1000
  return RADIUS_OPTIONS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a))
}
const popRadius = ref(1000)
// ⭐ radiusText 只用 utils/candidateReport.js 那一份（⛔ 组件里不许另写，否则标签与纸面口径会分叉）

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
    brandScope: brandScope.value
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
 * 读取「已缓存的」联通人口（免费）+ 剩余配额。
 * 🔴 打开报告**绝不自动扣配额** —— 只查缓存；要花钱必须用户点按钮（v1.13.340）。
 */
/**
 * 探测「该位置是否已有可复用的人口数据」—— 打开报告就调，**免费**。
 * 走 `probeOnly`：后端只查 purchases / smartsteps_cache，⛔ 不查闸门、不调上游、不扣费。
 * （原先调的是商圈面端点，v1.13.341 改为半径口径后才能与「我的门店」打通）
 */
let probeSeq = 0
async function probePopulation() {
  const seq = ++probeSeq
  popData.value = null
  popMonth.value = ''
  popSource.value = ''
  popQuotaUsed.value = 0
  popCachedMonth.value = ''
  popReused.value = null
  const c = props.candidate
  if (!c || !Number(c.latitude) || !Number(c.longitude)) return
  try {
    const { data } = await axios.post('/api/smartsteps/population', {
      lng: Number(c.longitude),
      lat: Number(c.latitude),
      radius: popRadius.value,
      probeOnly: true
    })
    if (seq !== probeSeq) return        // 半径已改 ⇒ 丢弃旧请求的结果
    if (data?.population) {
      popData.value = data.population
      popMonth.value = data.dataMonth || ''
      popSource.value = data.source
      popReused.value = data.reused
    } else if (data?.source === 'cache') {
      // 🔴 后端按新规**不回 population**（回了就是白拿），只告知「有数据可查」
      popCachedMonth.value = data.dataMonth || '未知'
    }
  } catch (e) {
    console.warn('[立项报告] 探测人口数据失败:', e?.message || e)
  }
}

/**
 * 用户换了半径 ⇒ 旧数据作废（watch 已清空），并**免费**重新探测一次。
 * 🔴 这一步是「已购数据自动复用」的关键：不重探的话，明明 3km 买过也要用户再点一次
 *    「确认取数」，甚至误以为要重新付费。probeOnly 不查闸门、不调上游、零费用。
 * ⚠️ 等 nextTick：el-select 的 change 早于 v-model 的 watch(flush:'pre')，
 *    先让清空跑完再发请求，否则旧请求回来会把清空后的状态又填回去。
 */
async function onRadiusChange() {
  await nextTick()
  probePopulation()
}

/** 剩余配额（用于「消耗 1 次 / 剩余 N 次」的明示，⛔ 不做成隐藏成本） */
async function loadQuota() {
  try {
    const { data } = await axios.get('/api/purchase/quota')
    quotaInfo.value = {
      available: Number(data?.available) || 0,
      remaining: Number(data?.remainingQuota) || 0,
      loaded: true
    }
  } catch {
    quotaInfo.value = { available: 0, remaining: 0, loaded: false }
  }
}

/**
 * 取联通人口数据（按「点位 + 半径」；**本人同半径买过才免费**）。
 *
 * 🔴 这里**不做前端配额预检**：本人已购复用的 0 费用路径不该被「剩余 0」拦掉；
 *   🔴 v1.13.381 起「命中平台缓存」不再免费（只省上游调用、仍扣 1 次），
 *   预检放在前端只会误导 —— 闸门统一交给后端：先查本人已购 → 再查缓存（计费）→ 最后判配额。
 */
async function fetchPopulation() {
  if (popLoading.value) return
  const c = props.candidate
  if (!c) return
  const lng = Number(c.longitude)
  const lat = Number(c.latitude)
  if (!lng || !lat) return ElMessage.warning('该点位缺少有效坐标，无法取人口数据')

  // 先拿最新可用月份（免费接口）—— 避免选到无数据月份换来一次无效的付费调用
  let cityMonth = ''
  let monthLabel = ''
  try {
    const { data } = await axios.get('/api/smartsteps/months')
    cityMonth = data?.months?.[0]?.value || ''
    monthLabel = data?.months?.[0]?.label || ''
  } catch { /* 拿不到就不传，后端用本地推算兜底 */ }

  try {
    await ElMessageBox.confirm(
      `将按「点位半径 ${radiusText(popRadius.value)}」向联通取人口数据` +
      `${monthLabel ? '（期次 ' + monthLabel + '）' : ''}。\n\n` +
      `· 若该位置在「我的门店」里同半径买过 ⇒ 不消耗配额，直接复用\n` +
      `· 若平台上已有该位置数据（别人买过）⇒ 仍消耗 1 次配额，但不重复调用联通、即时返回\n` +
      `· 否则消耗 1 次联通人口配额（当前剩余 ${quotaInfo.value.available} 次）`,
      '确认取数',
      { confirmButtonText: '确认取数', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return   // 用户取消
  }

  popLoading.value = true
  try {
    const { data } = await axios.post('/api/smartsteps/population', {
      lng,
      lat,
      radius: popRadius.value,
      cityMonth,
      storeName: String(c.name || '').slice(0, 100)
    })
    if (data?.population) {
      popData.value = data.population
      popMonth.value = data.dataMonth || ''
      popSource.value = data.source
      popQuotaUsed.value = Number(data.quotaUsed) || 0
      popCachedMonth.value = ''
      popReused.value = data.reused
      ElMessage.success(data.message || '已获取联通人口数据')
      loadQuota()
    } else {
      ElMessage.warning('联通未返回可用人口数据，请稍后重试')
    }
  } catch (e) {
    const code = e?.response?.data?.code
    if (code === QUOTA_REASON.OWN || code === QUOTA_REASON.POOL) {
      // 统一走配额引导出口（内含联系方式，⛔ 不在这里另写文案）
      await requireQuota(code, {
        need: e.response.data.need || 1,
        own: e.response.data.own,
        pool: e.response.data.pool
      })
    } else {
      ElMessage.error(e?.response?.data?.message || '获取人口数据失败，请稍后重试')
    }
  } finally {
    popLoading.value = false
  }
}

/** 打开时按城市拉商圈面（一次），并把地图截图渲出来 */
async function onOpened() {
  if (!props.candidate) return
  // 半径默认取候选点位自带的（归到 1/3/5km 三档），用户可在弹窗里改
  popRadius.value = nearestRadius(props.candidate.radius)
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
  // 免费探测一次「有没有可复用的已购数据」，有就直接显示
  await Promise.all([probePopulation(), loadQuota()])
  renderMap()
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
  if (!popData.value) {
    // 不阻断（用户可能就想要竞争/地铁维度的建议），但必须说清楚少了一半依据
    ElMessage.warning('尚未获取联通人口数据 —— AI 建议将缺少人口依据，可先点上方「获取联通人口数据」')
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
 */
async function exportPdf() {
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

// 关掉弹窗时清掉 AI 文本与人口缓存，避免下次打开看到上一个点位的数据
/** 换半径 ⇒ 之前取的那份就作废（⛔ 不许把 1km 的数据挂在 3km 标签下） */
watch(popRadius, () => {
  popData.value = null
  popMonth.value = ''
  popSource.value = ''
  popReused.value = null
})

watch(() => props.modelValue, (v) => {
  if (!v) {
    aiText.value = ''
    wantAi.value = false
    categoryInput.value = ''
    popData.value = null
    popMonth.value = ''
    popSource.value = ''
    popReused.value = null
  }
})
</script>

<style scoped>
.rp-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.rp-bar-l { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.rp-hint { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }

/* 人口取数条：在**纸外**（不进 PDF），只做操作与状态提示 */
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
