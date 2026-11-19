<!--
  候选点位「升级取数」面板（v1.13.379 · P2）

  ── 定位 ────────────────────────────────────────────────────────────────
  初步分析给的是**免费结论**；这个面板负责「值不值得花钱把它看清楚」这一跳：
    ① 挂载 / 换半径 ⇒ `probeOnly: true` 探测（**0 消耗**，只查 purchases + smartsteps_cache）
    ② 明示真实成本：**本人已购** ⇒ 免费复用；只有平台缓存 / 都没有 ⇒ 消耗 1 次 / 当前剩余 N 次
    ③ 用户点按钮 + 二次确认后才真正取数（POST /api/smartsteps/population）
    ④ 取到后就在本页展示「到访 / 居住 / 工作」与年龄、话费分档

  ── 🔴 四条边界（改这个文件前必读）────────────────────────────────────────
  ① **自动探测只能 `probeOnly: true`** —— 在 onMounted / watch 里发非 probe 的取数＝
     用户只是换了半径就被扣一次配额。守卫 `candidateBriefUpgradeGuard.test.js` 钉死。
  ② **取数只能由按钮点击触发**，且必须先弹确认框，文案里必须出现「消耗」「剩余」。
  ③ 配额不足必须走 `utils/quotaContact.js::requireQuota` —— ⛔ 在这里另写一套联系方式。
  ④ 半径只认后端 `plan.radiusM`（联通只有 1/3/5km 三档）——
     ⛔ 前端自己定档：报告可以选 500/1500，拿这些值直接打联通会被 400 顶回来。
  ⑤ 初步分析（`CandidateBriefReport.vue`）必须保持 0 消耗 ⇒ 付费代码只放在本文件，
     ⛔ 不要把那边的守卫放宽来「顺手」加个自动取数。
  ⑥ 🔴🔴 **缓存命中 ≠ 免单**（v1.13.381，业主 11-19 拍板）：`source === 'cache'` 只说明
     平台有这份数据、取数不用再调联通，**费用照扣 1 次**并写本账号履历。
     `reusable` 只认 `source === 'purchase'` —— 把 cache 也算进来就会「界面说免费、点下去扣钱」。
     守卫 `cacheNotFreeGuard.test.js` 钉死这条。
-->
<template>
  <div class="bu-panel" :class="'is-' + (plan?.tier || 'optional')">
    <div class="bu-hd">
      <div class="bu-hd-l">
        <span class="bu-tag" :class="'is-' + (plan?.tier || 'optional')">{{ tierTag }}</span>
        <b class="bu-title">{{ plan?.title || '要不要花钱深入' }}</b>
      </div>
      <span class="bu-hd-note">联通智慧足迹 · 按半径圆取数</span>
    </div>

    <ul v-if="plan?.why?.length" class="bu-why">
      <li v-for="(w, i) in plan.why" :key="i">{{ w }}</li>
    </ul>

    <div v-if="plan?.buys?.length" class="bu-buys">
      <span class="bu-buys-l">花 1 次配额能买到（本地网格没有的）</span>
      <span v-for="b in plan.buys" :key="b" class="bu-chip">{{ b }}</span>
    </div>

    <p v-if="plan?.radiusNote" class="bu-radius">口径：{{ plan.radiusNote }}</p>

    <!-- 成本行：先探测再说话，⛔ 不许默认「要花钱」也不许默认「免费」 -->
    <div class="bu-cost">
      <div class="bu-cost-l">
        <template v-if="!hasCoord">
          <span class="bu-warn">该点位没有有效坐标，无法取联通人口</span>
        </template>
        <template v-else-if="probing">
          <span class="bu-muted">正在查这个位置是否已有可复用数据…（免费，不消耗配额）</span>
        </template>
        <template v-else-if="reusable">
          <span class="bu-ok">✅ {{ probeText }}，可免费复用</span>
          <span class="bu-muted">点右侧按钮只读回这份已购数据，本次不消耗配额</span>
        </template>
        <!-- v1.13.381：数据在库里 ≠ 本账号买过。取数照扣 1 次，但不用等上游、即时返回。 -->
        <template v-else-if="cacheReady">
          <span class="bu-warn">{{ probeText }}，但你的账号没有购买记录</span>
          <span class="bu-muted">
            取数仍消耗 {{ plan?.quotaPerFetch || 1 }} 次配额（命中已有数据，不再调用联通，即时返回）
            <template v-if="quota.loaded">· 当前剩余 {{ quota.available }} 次</template>
            <template v-else>· 配额读取失败，取数前请先确认</template>
          </span>
        </template>
        <template v-else>
          <span class="bu-warn">该位置尚未购买</span>
          <span class="bu-muted">
            将消耗 {{ plan?.quotaPerFetch || 1 }} 次联通人口配额
            <template v-if="quota.loaded">· 当前剩余 {{ quota.available }} 次</template>
            <template v-else>· 配额读取失败，取数前请先确认</template>
          </span>
        </template>
      </div>
      <div class="bu-cost-r">
        <el-button
          v-if="!evidence"
          type="primary"
          size="small"
          :plain="plan?.tier !== 'recommend'"
          :loading="fetching"
          :disabled="!hasCoord || probing"
          @click="fetchPopulation"
        >{{ buttonText }}</el-button>
        <el-button v-else size="small" :loading="fetching" :disabled="!hasCoord" @click="fetchPopulation">
          刷新（期内已购不再扣费）
        </el-button>
      </div>
    </div>

    <!-- v1.13.380：同一位置买过**别的**半径（复用要求同半径 ⇒ 本次仍要另买 1 次）。
         ⚠️ 只在「不能复用」时显示：若已命中可复用档，成本行已经写明「可免费复用」，
            再出现这句会自相矛盾。 -->
    <p v-if="!reusable && plan?.reuseHint" class="bu-reuse">{{ plan.reuseHint }}</p>

    <p v-if="plan?.tier === 'not_now'" class="bu-hold">
      规则结论是「先别买」，但按钮仍然保留 —— 如果这是「关一家开一家」的替换计划，由你自己决定要不要取数。
    </p>

    <!-- 取到的证据 -->
    <div v-if="evidence" class="bu-ev">
      <div class="bu-ev-hd">
        <b>联通人口证据（{{ radiusText(plan?.radiusM) }} 圆）</b>
        <span class="bu-muted">
          {{ evidenceNote }}
          <template v-if="dataMonth"> · 期次 {{ dataMonth }}</template>
        </span>
      </div>
      <div class="bu-kpis">
        <div class="bu-kpi">
          <div class="bu-kpi-n">{{ fmtNum(evidence.visit) }}<em>人</em></div>
          <div class="bu-kpi-l">到访人口</div>
        </div>
        <div class="bu-kpi">
          <div class="bu-kpi-n">{{ fmtNum(evidence.live) }}<em>人</em></div>
          <div class="bu-kpi-l">居住人口</div>
        </div>
        <div class="bu-kpi">
          <div class="bu-kpi-n">{{ fmtNum(evidence.work) }}<em>人</em></div>
          <div class="bu-kpi-l">工作人口</div>
        </div>
      </div>
      <p v-if="workLive" class="bu-ev-note">{{ workLive }}</p>

      <div v-if="ageTop.length" class="bu-ev-sec">
        <div class="bu-ev-t">居住人口年龄结构（前 3 档）</div>
        <div v-for="a in ageTop" :key="a.label" class="bu-row">
          <span class="bu-row-l">{{ a.label }}</span>
          <span class="bu-row-track"><i :style="{ width: a.pct + '%' }"></i></span>
          <span class="bu-row-v">{{ a.pct }}%</span>
        </div>
      </div>
      <div v-if="arpuTop.length" class="bu-ev-sec">
        <div class="bu-ev-t">居住人口月话费分档（前 3 档 · 消费能力代理，不是收入）</div>
        <div v-for="a in arpuTop" :key="a.label" class="bu-row">
          <span class="bu-row-l">{{ a.label }}</span>
          <span class="bu-row-track"><i :style="{ width: a.pct + '%' }"></i></span>
          <span class="bu-row-v">{{ a.pct }}%</span>
        </div>
      </div>
      <p class="bu-ev-foot">
        口径：联通 1001 按「点位 + 半径」的圆取数，与商圈面人口不是一回事；本地 1km 网格的常住人口也只作参考。
      </p>
    </div>

    <p v-if="errorMsg" class="bu-err">{{ errorMsg }}</p>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { requireQuota, QUOTA_REASON } from '@/utils/quotaContact.js'
import { radiusText } from '@/utils/candidateReport.js'

const props = defineProps({
  // 后端 brief.upgrade：{ tier, title, why[], buys[], radiusM, radiusNote, quotaPerFetch, service }
  plan: { type: Object, default: null },
  // brief.point：{ name, lat, lng, city, radius }
  point: { type: Object, default: null },
  // 本次报告口径（用于确认框里说清「报告 1.5km / 联通按 3km」的差别）
  reportRadius: { type: Number, default: 1000 }
})

const probing = ref(false)
const fetching = ref(false)
const errorMsg = ref('')
const probe = ref({ source: 'none', population: null, dataMonth: '', reused: null })
const quota = ref({ available: 0, remaining: 0, loaded: false })
const evidence = ref(null)
const evidenceSource = ref('')
const evidenceQuotaUsed = ref(0)
const dataMonth = ref('')

const hasCoord = computed(() => {
  const lat = Number(props.point?.lat)
  const lng = Number(props.point?.lng)
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
})

// 🔴 v1.13.381：只有「**本人买过**」才叫可复用。缓存命中（source==='cache'）不是免单 ——
//    它只证明平台有这份数据、取数不用再调上游，费用照扣。把 cache 也算进来的后果是
//    「界面说免费、点下去扣 1 次」，用户会认为系统骗人。
const reusable = computed(() => probe.value.source === 'purchase' && !!probe.value.population)
// 有现成数据可查（别人买过 / 平台缓存），取数即时返回但要计费
const cacheReady = computed(() => probe.value.source === 'cache')

const probeText = computed(() => {
  const p = probe.value
  if (p.source === 'purchase') {
    const who = p.reused?.storeName ? `「${p.reused.storeName}」已购` : '该位置已购'
    return `${who}${p.dataMonth ? `（期次 ${p.dataMonth}）` : ''}`
  }
  if (p.source === 'cache') return `该位置已有可查数据${p.dataMonth ? `（期次 ${p.dataMonth}）` : ''}`
  return ''
})

const tierTag = computed(() => {
  const t = props.plan?.tier
  return t === 'recommend' ? '建议深入' : t === 'not_now' ? '不建议深入' : '可以先核验'
})

const buttonText = computed(() => {
  const n = props.plan?.quotaPerFetch || 1
  if (reusable.value) return '读取已购人口（0 配额）'
  if (cacheReady.value) return `读取该位置人口（${n} 次配额）`
  return props.plan?.tier === 'recommend' ? `取联通人口（${n} 次配额）` : `仍要取数（${n} 次配额）`
})

const evidenceNote = computed(() => {
  if (evidenceSource.value === 'purchase') return '复用已购数据，本次未消耗配额'
  // 🔴 缓存命中≠免费：数据在库里，但这次是记在本账号名下的 1 次消耗
  if (evidenceSource.value === 'cache') {
    return evidenceQuotaUsed.value
      ? '命中同位置已有数据（未重复调用联通），本次消耗 1 次配额'
      : '命中同位置已有数据，本次未消耗配额'
  }
  return `本次消耗 ${evidenceQuotaUsed.value || (props.plan?.quotaPerFetch || 1)} 次配额`
})

const workLive = computed(() => {
  const live = Number(evidence.value?.live)
  const work = Number(evidence.value?.work)
  if (!Number.isFinite(live) || !Number.isFinite(work) || live <= 0) return ''
  const pct = Math.round((work / live) * 100)
  return `工作人口是居住人口的 ${pct}% —— ${pct >= 60 ? '职住相对均衡，通勤客与常住客都能做' : '以居住为主，工作日白天人流要看商圈能级'}`
})

function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

/** 取前 3 档并折成百分比（与后端 toPercents 同算法，只保留前 3 条给面板用） */
function topSeries(series) {
  const list = Array.isArray(series) ? series : []
  const total = list.reduce((s, x) => s + (Number(x.value) || 0), 0)
  if (!total) return []
  return list
    .map((x) => ({ label: x.label, pct: Math.round(((Number(x.value) || 0) / total) * 1000) / 10 }))
    .filter((x) => x.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3)
}

const ageTop = computed(() => topSeries(evidence.value?.ages?.live))
const arpuTop = computed(() => topSeries(evidence.value?.arpu?.live))

/**
 * 免费探测：只查「有没有**本人的**已购 / 平台缓存」。
 * 🔴 必须 `probeOnly: true` —— 少了这个字段，后端就会走配额闸门并真的取数（扣钱）。
 * 🔴 v1.13.381：`source === 'cache'` 时后端**不回 population**（回了就是白拿数据），
 *    只回「有数据可查 + 期次」。所以这里不能用 `population` 是否存在来判「可免费复用」。
 */
let probeSeq = 0
async function probeReuse() {
  if (!hasCoord.value) return
  const seq = ++probeSeq
  probing.value = true
  probe.value = { source: 'none', population: null, dataMonth: '', reused: null }
  try {
    const { data } = await axios.post('/api/smartsteps/population', {
      lng: Number(props.point.lng),
      lat: Number(props.point.lat),
      radius: Number(props.plan?.radiusM) || 1000,
      probeOnly: true
    })
    if (seq !== probeSeq) return           // 半径已变 ⇒ 丢弃旧结果
    probe.value = {
      source: data?.source || 'none',
      population: data?.population || null,
      dataMonth: data?.dataMonth || '',
      reused: data?.reused || null
    }
  } catch (e) {
    // 探测失败不影响「花钱取数」这条路，只是成本提示会退化成「未购买」
    console.warn('[升级取数] 探测已购数据失败:', e?.message || e)
  } finally {
    if (seq === probeSeq) probing.value = false
  }
}

/** 剩余配额只用于「消耗 X / 剩余 Y」的明示，⛔ 不做前端预检（已购复用是 0 费用的） */
async function loadQuota() {
  try {
    const { data } = await axios.get('/api/purchase/quota')
    quota.value = {
      available: Number(data?.available) || 0,
      remaining: Number(data?.remainingQuota) || 0,
      loaded: true
    }
  } catch {
    quota.value = { available: 0, remaining: 0, loaded: false }
  }
}

/**
 * 真正取数（**可能免费**）：点按钮 → 确认 → 取最新可用月份 → POST。
 * ⚠️ 不做前端配额预检：已购复用与同位置缓存都是 0 费用，先拦「剩余 0」会让免费数据也拿不到。
 */
async function fetchPopulation() {
  if (fetching.value || !hasCoord.value) return
  const n = props.plan?.quotaPerFetch || 1
  const avail = quota.value.loaded ? `${quota.value.available} 次` : '未知'
  const cost = reusable.value
    ? `该位置已有可复用的已购数据（${probeText.value}），本次预计不消耗配额。`
    : cacheReady.value
    // ⚠️ `probeText` 本身已含「该位置已有可查数据（期次 X）」，这里⛔ 不要再包一层前缀
      ? `${probeText.value}，但你的账号没有购买记录 ⇒ 本次将消耗 ${n} 次配额（命中已有数据，不再重复调用联通，即时返回；当前剩余 ${avail}）。`
      : `该位置尚未购买 ⇒ 将消耗 ${n} 次联通人口配额（当前剩余 ${avail}）。`
  try {
    await ElMessageBox.confirm(
      `${cost}\n\n`
      + `取数口径：${radiusText(props.plan?.radiusM)}\n`
      + `报告口径：${radiusText(props.reportRadius)}${Number(props.plan?.radiusM) === Number(props.reportRadius) ? '' : '（联通只支持 1/3/5km，已自动换算，见上方口径说明）'}\n`
      + '取到的是到访 / 居住 / 工作人口与年龄、话费分档；同一位置同半径已经买过的数据会自动复用，不会重复扣费。',
      '确认取联通人口',
      { confirmButtonText: '确认取数', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return
  }

  fetching.value = true
  errorMsg.value = ''
  // 先拿最新可用月份（免费接口）：避免选到无数据月份换来一次无效的付费调用
  let cityMonth = ''
  try {
    const { data } = await axios.get('/api/smartsteps/months')
    cityMonth = data?.months?.[0]?.value || ''
  } catch { /* 拿不到就不传，后端用本地推算兜底 */ }

  try {
    const { data } = await axios.post('/api/smartsteps/population', {
      lng: Number(props.point.lng),
      lat: Number(props.point.lat),
      radius: Number(props.plan?.radiusM) || 1000,
      cityMonth,
      storeName: String(props.point?.name || '').slice(0, 100)
    })
    if (data?.population) {
      evidence.value = data.population
      evidenceSource.value = data.source || ''
      evidenceQuotaUsed.value = Number(data.quotaUsed) || 0
      dataMonth.value = data.dataMonth || ''
      ElMessage.success(data.quotaUsed ? (data.message || '已取到人口数据（消耗 1 次配额）') : (data.message || '已复用已购数据，未消耗配额'))
      // 取完再探一次：让成本行立刻变成「已购可复用」，避免用户以为每次都要花钱
      probeReuse()
      loadQuota()
    } else {
      errorMsg.value = '联通未返回可用人口数据（本次未消耗配额），请稍后重试'
    }
  } catch (e) {
    const code = e?.response?.data?.code
    if (code === QUOTA_REASON.OWN || code === QUOTA_REASON.POOL) {
      await requireQuota(code, {
        need: e.response.data.need || 1,
        own: e.response.data.own,
        pool: e.response.data.pool
      })
    } else {
      errorMsg.value = e?.response?.data?.message || e?.message || '取数失败，请稍后重试'
    }
  } finally {
    fetching.value = false
  }
}

onMounted(() => {
  probeReuse()
  loadQuota()
})

// 报告换了半径 ⇒ 联通档位可能跟着变（1km↔3km），旧的「已购/未购」结论作废，免费重探
watch(() => props.plan?.radiusM, () => {
  evidence.value = null
  evidenceSource.value = ''
  evidenceQuotaUsed.value = 0
  dataMonth.value = ''
  probeReuse()
})
</script>

<style scoped>
.bu-panel {
  /* 与纸张同宽同轴（.bf-paper 是 794px + margin auto）—— 错开会让「操作区」看起来不属于这份报告 */
  width: 794px;
  max-width: 100%;
  box-sizing: border-box;
  margin: 14px auto 0;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-left: 4px solid #8a9099;
  border-radius: 8px;
}
.bu-panel.is-recommend { border-left-color: #2563eb; }
.bu-panel.is-not_now { border-left-color: #e6a23c; }

.bu-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.bu-hd-l { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bu-title { font-size: 15px; color: #1f2329; }
.bu-hd-note { font-size: 12px; color: var(--text-secondary); }
.bu-tag { font-size: 11px; padding: 2px 8px; border-radius: 3px; color: #fff; background: #8a9099; }
.bu-tag.is-recommend { background: #2563eb; }
.bu-tag.is-not_now { background: #e6a23c; }

.bu-why { margin: 10px 0 0; padding-left: 18px; color: #4b5563; font-size: 13px; line-height: 1.9; }
.bu-buys { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.bu-buys-l { font-size: 12px; color: var(--text-secondary); margin-right: 2px; }
.bu-chip { font-size: 12px; color: #1f2329; background: #eef2f7; border-radius: 10px; padding: 2px 9px; }
.bu-radius { margin: 10px 0 0; font-size: 12px; color: #6b7280; }

.bu-cost {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e4e7ed;
}
.bu-cost-l { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.bu-ok { color: #16794a; font-weight: 500; }
.bu-warn { color: #b45309; font-weight: 500; }
.bu-muted { color: var(--text-secondary); font-size: 12px; }
.bu-hold { margin: 10px 0 0; font-size: 12px; color: #b45309; background: #fdf6ec; border-radius: 6px; padding: 7px 10px; }
/* v1.13.380：同位置买过别的半径 ⇒ 与 bu-hold 同视觉层级（都是「先看这句再决定」），
   但用左竖线区分：hold 是规则结论，这条是计费口径说明 */
.bu-reuse { margin: 10px 0 0; font-size: 12px; line-height: 1.65; color: #8a5a00;
  background: #fff8e6; border-left: 3px solid #e6a23c; border-radius: 4px; padding: 7px 10px; }
.bu-err { margin: 10px 0 0; font-size: 13px; color: #f56c6c; }

.bu-ev { margin-top: 14px; padding-top: 12px; border-top: 1px solid #e4e7ed; }
.bu-ev-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.bu-ev-hd b { font-size: 14px; color: #1f2329; }
.bu-kpis { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.bu-kpi { flex: 1 1 140px; background: #f7f9fc; border-radius: 8px; padding: 10px 12px; }
.bu-kpi-n { font-size: 22px; color: #1f2329; font-variant-numeric: tabular-nums; }
.bu-kpi-n em { font-size: 12px; font-style: normal; color: var(--text-secondary); margin-left: 3px; }
.bu-kpi-l { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.bu-ev-note { margin: 8px 0 0; font-size: 12px; color: #4b5563; }
.bu-ev-sec { margin-top: 12px; }
.bu-ev-t { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
.bu-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.bu-row-l { width: 92px; font-size: 12px; color: #4b5563; flex: none; }
.bu-row-track { flex: 1; height: 6px; background: #eef2f7; border-radius: 3px; overflow: hidden; }
.bu-row-track i { display: block; height: 100%; background: #2563eb; }
.bu-row-v { width: 48px; text-align: right; font-size: 12px; color: #4b5563; font-variant-numeric: tabular-nums; }
.bu-ev-foot { margin: 10px 0 0; font-size: 11px; color: #8a9099; line-height: 1.7; }
</style>
