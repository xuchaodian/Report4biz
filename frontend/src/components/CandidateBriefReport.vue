<!--
  候选点位「初步分析」报告（v1.13.378 · P1）

  ── 定位 ────────────────────────────────────────────────────────────────
  业主 2026-11-18：「把地图页的『常住人口分布』『竞品分布』这些免费能力整合进来，
  生成一份初步分析报告」，用途是**先免费判断值不值得花钱买联通人口**。

  ── 🔴 三条边界（改这个文件前必读）────────────────────────────────────────
  ① **0 消耗**：只用 `GET /api/candidates/brief`（本地网格 + 站内竞品 + 我的门店 + 商圈面）。
     ⛔ 不许在这个文件里调联通取数、⛔ 不许调高德代理、⛔ 不许写库。
     v1.13.379（P2）起，「花钱深入」的入口是本文件下方的 `CandidateBriefUpgrade.vue`：
     付费代码全部在那边（探测 + 确认 + 取数），本文件连它的内部都不碰 ⇒ 0 消耗的
     源码守卫（`candidateBriefGuard.test.js` G6）继续有效，⛔ 不许为了加功能把它放宽。
  ② **页面内嵌，不是弹窗**：业主拍板「页面内嵌 + 可导出 PDF」。弹窗会遮住地图、
     长内容在 62vh 里滚两层；这里直接占满页面主体，由 `.cand-page` 统一滚动。
  ③ **切页锚点**：纸张内的区块必须带 `.bf-sec`、页脚带 `.bf-foot` ——
     `utils/exportPaperPdf.js` 靠这些类名找「安全切页点」，⛔ 改类名会让 PDF 把一行字切成两半。

  ── 文案纪律 ────────────────────────────────────────────────────────────
  · 「商圈综合评分」是**商圈面**的分，⛔ 不能说成「这个点位的评分」
  · 「竞争宽松度」**分越高＝竞争越少**（项目里已经因此更名过一次）
  · 未评必须写「未评」，⛔ 不许写 0 分 / 满分，也不许用「—」糊过去
-->
<template>
  <div class="bf-page">
    <div class="bf-bar">
      <div class="bf-bar-l">
        <el-button link @click="$emit('close')">
          <el-icon><ArrowLeft /></el-icon>返回候选点位
        </el-button>
        <span class="bf-bar-title">初步分析</span>
        <span class="bf-bar-hint">0 消耗 · 不调联通/高德</span>
      </div>
      <div class="bf-bar-r">
        <span class="bf-radius">
          本次分析半径
          <el-select
            v-model="radius"
            size="small"
            style="width: 104px"
            :disabled="loading"
            aria-label="本次分析半径"
            @change="load"
          >
            <el-option v-for="r in radiusOptions" :key="r" :value="r" :label="radiusText(r)" />
          </el-select>
        </span>
        <el-button :loading="loading" @click="load">重新分析</el-button>
        <el-button type="primary" :loading="exporting" :disabled="!brief" @click="exportPdf">下载 PDF</el-button>
      </div>
    </div>
    <p class="bf-bar-note">换半径只改这份报告的口径，不改点位自身的评估半径（要改请点「编辑信息」）。</p>

    <div v-if="errorMsg" class="bf-error">
      <el-icon><WarningFilled /></el-icon>{{ errorMsg }}
    </div>

    <div v-loading="loading" class="bf-wrap">
      <div v-if="brief" ref="paper" class="bf-paper">
        <!-- 抬头 -->
        <div class="bf-hd">
          <div class="bf-hd-l">
            <div class="bf-kicker">选址赢家Online · 点位初步分析</div>
            <h1>{{ brief.point.name || '未命名点位' }}</h1>
            <div class="bf-hd-sub">
              <span v-if="brief.point.brand">品牌 {{ brief.point.brand }}</span>
              <span v-if="brief.point.city">{{ [brief.point.city, brief.point.district].filter(Boolean).join(' · ') }}</span>
              <span v-if="brief.point.address">{{ brief.point.address }}</span>
              <span>分析半径 {{ radiusText(brief.point.radius) }}</span>
            </div>
          </div>
          <div class="bf-hd-r">
            <div class="bf-badge">初步分析</div>
            <div class="bf-badge-note">0 消耗</div>
          </div>
        </div>

        <!-- 结论（固定规则，可回溯） -->
        <div class="bf-verdict" :class="'is-' + brief.verdict.level">
          <div class="bf-verdict-hd">
            <span class="bf-verdict-tag">{{ verdictTag }}</span>
            <h2>{{ brief.verdict.title }}</h2>
          </div>
          <p class="bf-verdict-text">{{ brief.verdict.detail }}</p>
          <ul v-if="brief.verdict.reasons.length" class="bf-verdict-reasons">
            <li v-for="(r, i) in brief.verdict.reasons" :key="i">{{ r }}</li>
          </ul>
        </div>

        <!-- 一、客群 -->
        <div class="bf-sec">
          <div class="bf-sec-hd">
            <h2>一、客群（本地 1km 网格）</h2>
            <span class="bf-sec-note">数据来源：本地网格「常住人口」，免费</span>
          </div>

          <template v-if="brief.population.covered">
            <div class="bf-kpi">
              <div class="bf-kpi-main">
                <div class="bf-kpi-num">{{ fmtNum(brief.population.circlePop) }}<em>人</em></div>
                <div class="bf-kpi-label">{{ radiusText(brief.population.radiusM) }} 内常住人口</div>
              </div>
              <div class="bf-kpi-side">
                <div v-if="brief.population.level" class="bf-chip" :class="'lv-' + brief.population.level.key">
                  {{ brief.population.level.label }}
                </div>
                <div v-if="brief.population.level" class="bf-kpi-note">{{ brief.population.level.note }}</div>
              </div>
            </div>
            <dl class="bf-kv">
              <div><dt>圆面积</dt><dd>{{ brief.population.circleAreaKm2 }} km²</dd></div>
              <div><dt>人口密度</dt><dd>{{ fmtNum(brief.population.density) }} 人/km²</dd></div>
              <div>
                <!-- v1.13.378：原写「格的参与方式」，缺主语读起来像被截断（真机验证发现） -->
                <dt>参与计算的人口格</dt>
                <dd>整格 {{ brief.population.whole }} 个 + 边界格 {{ brief.population.partial }} 个（按交叠面积加权）</dd>
              </div>
            </dl>
          </template>

          <div v-else class="bf-miss">
            <b>客群未评：{{ popMissReason }}</b>
            <span>「未评」不是 0 人 —— 这里没有本地网格数据，无法判断人多不多。要评估客群只能按半径向联通取人口（付费）。</span>
          </div>

          <p class="bf-gap">
            ⚠ 本地 1km 网格只有「常住人口」：没有工作人数、没有到访人次、没有收入分档。
            客流活性与消费能力需要购买联通人口后才能看。
          </p>
        </div>

        <!-- 二、竞争 -->
        <div class="bf-sec">
          <div class="bf-sec-hd">
            <h2>二、竞争（{{ radiusText(brief.competition.radiusM) }} 内竞品）</h2>
            <span class="bf-sec-note">数据来源：站内竞品库，免费</span>
          </div>
          <div class="bf-kpi">
            <div class="bf-kpi-main">
              <div class="bf-kpi-num">{{ brief.competition.count === null ? '—' : brief.competition.count }}<em>家</em></div>
              <div class="bf-kpi-label">同级竞品</div>
            </div>
            <div class="bf-kpi-side">
              <div v-if="brief.competition.level" class="bf-chip" :class="'lv-' + brief.competition.level.key">
                {{ brief.competition.level.label }}
              </div>
              <div v-if="brief.competition.level" class="bf-kpi-note">
                竞争宽松度 {{ brief.competition.score }} 分 · {{ brief.competition.level.note }}
              </div>
            </div>
          </div>
          <p v-if="brief.competition.scopeText" class="bf-scope">口径：{{ brief.competition.scopeText }}</p>
          <div v-if="brief.competition.byBrand.length" class="bf-bars">
            <div v-for="b in brief.competition.byBrand" :key="b.brand" class="bf-bar-row">
              <span class="bf-bar-l">{{ b.brand }}</span>
              <span class="bf-bar-track"><i :style="{ width: barWidth(b.count) }"></i></span>
              <span class="bf-bar-v">{{ b.count }}</span>
            </div>
          </div>
        </div>

        <!-- 三、自有门店 -->
        <div class="bf-sec">
          <div class="bf-sec-hd">
            <h2>三、自有门店（{{ brief.own.hasBrand ? '同品牌' : '全部品牌' }} · 已开业）</h2>
            <span class="bf-sec-note">数据来源：我的门店，免费</span>
          </div>
          <dl class="bf-kv">
            <div>
              <dt>最近{{ brief.own.hasBrand ? '同品牌门店' : '自有门店' }}</dt>
              <dd v-if="brief.own.nearestM !== null">
                {{ brief.own.nearestName || '未命名' }}
                <span class="bf-muted">（{{ fmtM(brief.own.nearestM) }}<template v-if="brief.own.nearestCode"> · {{ brief.own.nearestCode }}</template>）</span>
              </dd>
              <dd v-else>20km 内没有{{ brief.own.hasBrand ? '同品牌' : '自有' }}门店</dd>
            </div>
            <div>
              <dt>{{ radiusText(brief.saturation.radiusM) }} 内{{ brief.own.hasBrand ? '同品牌' : '自有' }}门店</dt>
              <dd>
                {{ brief.own.withinR }} 家
                <span class="bf-muted">（同址双店型已合并计 1 家）</span>
              </dd>
            </div>
            <div>
              <dt>饱和判定</dt>
              <dd>
                <span v-if="!brief.own.hasBrand" class="bf-muted">未评：点位没填品牌，「饱和」是品牌概念</span>
                <span v-else-if="brief.own.saturated" class="bf-danger">
                  已饱和（≥ {{ brief.saturation.maxOwn }} 家）
                </span>
                <span v-else>未饱和（门限 ≥ {{ brief.saturation.maxOwn }} 家）</span>
              </dd>
            </div>
          </dl>
          <p v-if="!brief.own.hasBrand" class="bf-scope">
            点位没有品牌信息，所以「最近门店」退化成「任意自有门店」，也不做饱和判定 ——
            拿别的品牌门店算作自己的饱和，会把合理扩张误判成内耗。
          </p>
        </div>

        <!-- 四、商圈 -->
        <div class="bf-sec">
          <div class="bf-sec-hd">
            <h2>四、商圈覆盖</h2>
            <span class="bf-sec-note">数据来源：商圈面图层，免费</span>
          </div>
          <template v-if="brief.district && brief.district.contained">
            <dl class="bf-kv">
              <div><dt>所在商圈</dt><dd>{{ brief.district.name || '未命名商圈' }}</dd></div>
              <div>
                <dt>商圈综合评分</dt>
                <dd>
                  <b>{{ brief.district.score === null ? '—' : brief.district.score }}</b>
                  <span class="bf-muted"> / 100（商圈面口径，⛔ 不是本点位评分）</span>
                </dd>
              </div>
              <div>
                <dt>客群 / 能级</dt>
                <dd>{{ [brief.district.crowd, brief.district.level].filter(Boolean).join(' · ') || '无标签' }}</dd>
              </div>
            </dl>
          </template>
          <div v-else-if="brief.district && brief.district.covered" class="bf-miss is-soft">
            <b>不在任何商圈面内</b>
            <span>本市有商圈面图层，但这个点位没有落在其中任何一个面里。商圈面只覆盖部分陆域，<b>不代表这里没有商圈</b>，只是系统没有它的画像数据。</span>
          </div>
          <div v-else class="bf-miss is-soft">
            <b>本市未上传商圈面图层</b>
            <span>商圈维度未评。要补齐请到「基础数据」上传该城市的商圈面。</span>
          </div>
        </div>

        <!-- 五、风险与待确认 -->
        <div v-if="brief.risks.length" class="bf-sec">
          <div class="bf-sec-hd"><h2>五、风险与待确认</h2></div>
          <ul class="bf-risks">
            <li v-for="(r, i) in brief.risks" :key="i">{{ r }}</li>
          </ul>
        </div>

        <!-- 六、下一步：规则判定「要不要花钱深入」（v1.13.379 · P2）
             🔴 这一段是**结论**，不是操作：花钱的按钮在纸张外（打印出来不该有按钮） -->
        <div v-if="brief.upgrade" class="bf-sec">
          <div class="bf-sec-hd">
            <h2>六、下一步：要不要花钱深入</h2>
            <span class="bf-sec-note">固定规则判定 · 可回溯</span>
          </div>
          <div class="bf-next" :class="'is-' + brief.upgrade.tier">
            <b>{{ brief.upgrade.title }}</b>
            <ul v-if="brief.upgrade.why.length">
              <li v-for="(w, i) in brief.upgrade.why" :key="i">{{ w }}</li>
            </ul>
          </div>
          <dl class="bf-kv is-flow">
            <div>
              <dt>能买到</dt>
              <dd>{{ brief.upgrade.buys.join('、') }}</dd>
            </div>
            <div>
              <dt>取数口径</dt>
              <dd>{{ brief.upgrade.radiusNote }}</dd>
            </div>
            <div>
              <dt>成本</dt>
              <dd>
                一次取数 {{ brief.upgrade.quotaPerFetch }} 次联通人口配额；
                已在「我的门店」买过的位置自动复用，不重复扣费
              </dd>
            </div>
          </dl>
          <p class="bf-gap">
            ⚠ 本报告没有购买联通人口 —— 所有数字都是站内免费数据。
            纸张下方的操作区才会真正取数，且取数前会明示「消耗几次 / 剩余几次」。
          </p>
        </div>

        <!-- 口径页脚 -->
        <div class="bf-foot">
          <div class="bf-foot-t">数据口径</div>
          <div class="bf-foot-r"><b>来源</b>{{ brief.provenance.source }}</div>
          <div class="bf-foot-r"><b>成本</b>{{ brief.provenance.cost }}</div>
          <div class="bf-foot-r"><b>人口字段</b>{{ brief.provenance.populationField }}（无工作/到访/收入分档）</div>
          <div class="bf-foot-x">
            本报告由「选址赢家Online」生成 · {{ fmtTime(generatedAt) }} · 生成人 {{ username }}
            · 初步分析只用于判断「值不值得深入」，不构成开店决策依据；营业额需以实际经营数据为准
          </div>
        </div>
      </div>

      <div v-else-if="!loading && !errorMsg" class="bf-empty">没有可展示的分析结果</div>
    </div>

    <!-- 升级取数面板（纸张外 ⇒ ⛔ 不进 PDF；付费逻辑全在子组件里，本文件保持 0 消耗） -->
    <CandidateBriefUpgrade
      v-if="brief && brief.upgrade"
      :plan="brief.upgrade"
      :point="brief.point"
      :report-radius="brief.point.radius"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { ArrowLeft, WarningFilled } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import { radiusText } from '@/utils/candidateReport.js'
import { exportPaperPdf, fileStamp, safeFileName } from '@/utils/exportPaperPdf.js'
// 付费入口单独一个组件：这里只负责「免费结论」，两份职责不混（见文件头 ①）
import CandidateBriefUpgrade from '@/components/CandidateBriefUpgrade.vue'

const props = defineProps({
  // 列表行：{ id, markerId, name, origin, radius, ... }；id 可能为 null（门店还没推进记录）
  row: { type: Object, required: true }
})
defineEmits(['close'])

const userStore = useUserStore()
const username = computed(() => userStore.user?.username || '—')

const loading = ref(false)
const exporting = ref(false)
const errorMsg = ref('')
const brief = ref(null)
const consts = ref(null)
const generatedAt = ref(null)
const paper = ref(null)

/** 与智能选址同一组可选半径（⛔ 别另立一套：同一点位在两处的圆必须一样大） */
const STANDARD_RADII = [500, 1000, 1500, 3000]
const radius = ref(Number(props.row?.radius) || 1000)

/** 点位自身的半径可能不在四档里（800/1200 之类）⇒ 插进去并默认选中，⛔ 不偷偷改掉 */
const radiusOptions = computed(() => {
  const base = Number(props.row?.radius) || 1000
  return STANDARD_RADII.includes(base) ? STANDARD_RADII : [...new Set([base, ...STANDARD_RADII])].sort((a, b) => a - b)
})

const verdictTag = computed(() => {
  const lv = brief.value?.verdict?.level
  return lv === 'go' ? '值得深入' : lv === 'hold' ? '不建议深入' : '需核验'
})

const popMissReason = computed(() => {
  const r = brief.value?.population?.reason
  const city = brief.value?.point?.city
  if (r === 'no_city') return '点位没有填城市'
  if (r === 'no_field') return '该城市的网格缺少「常住人口」字段'
  if (r === 'empty') return '该城市的网格全部为 0'
  if (r === 'no_grid_row') return city ? `「${city}」暂无本地 1km 网格人口` : '无法确定城市'
  return '暂无数据'
})

function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: n >= 100 ? 0 : 1 })
}

function fmtM(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)} km` : `${Math.round(n)} m`
}

function fmtTime(d) {
  if (!d) return '—'
  const t = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(t.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
}

/** 品牌条形图宽度：以最多的一组为 100%，最少留 6% 可见 */
function barWidth(n) {
  const list = brief.value?.competition?.byBrand || []
  const max = Math.max(...list.map((x) => Number(x.count) || 0), 1)
  return `${Math.max(6, Math.round(((Number(n) || 0) / max) * 100))}%`
}

/**
 * 取数。
 * 🔴 门店驱动的行 `id` 为 null ⇒ 用 markerId 直接分析，**不调 /ensure**（看一眼不该建行）。
 */
async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const params = { radius: radius.value }
    if (props.row?.markerId) params.markerId = props.row.markerId
    else if (props.row?.id) params.id = props.row.id
    else throw new Error('缺少点位标识，请返回列表刷新后重试')

    const { data } = await axios.get('/api/candidates/brief', { params })
    brief.value = data.brief
    consts.value = data.consts || null
    generatedAt.value = data.generatedAt
  } catch (e) {
    brief.value = null
    errorMsg.value = e?.response?.data?.message || e?.message || '生成初步分析失败'
  } finally {
    loading.value = false
  }
}

async function exportPdf() {
  if (!paper.value || !brief.value) return
  exporting.value = true
  try {
    // 🔴 不留痕：初步分析全是免费数据，没有「数据外泄」风险；
    //    而写流水需要 store_candidates.id，门店行还没有它（那会把浏览变写操作）。
    await exportPaperPdf(paper.value, `初步分析_${safeFileName(brief.value.point.name)}_${fileStamp()}.pdf`)
  } catch (e) {
    ElMessage.error('生成 PDF 失败：' + (e?.message || '未知错误'))
  } finally {
    exporting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.bf-page { padding-bottom: 8px; }
.bf-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.bf-bar-l { display: flex; align-items: center; gap: 10px; }
.bf-bar-title { font-size: 16px; font-weight: 500; color: #303133; }
.bf-bar-hint { font-size: 12px; color: #16794a; background: #eaf7f0; border-radius: 10px; padding: 1px 8px; }
.bf-bar-r { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bf-radius { font-size: 13px; color: var(--text-regular); display: flex; align-items: center; gap: 6px; }
.bf-bar-note { margin: 6px 0 12px; font-size: 12px; color: var(--text-secondary); }

.bf-error { display: flex; align-items: center; gap: 6px; padding: 10px 12px; background: #fef0f0; color: #f56c6c; border-radius: 6px; font-size: 13px; }
/* A4 纸张固定 794px：窄屏（笔记本分屏 / 平板竖屏）放不下时**横向滚动**，
   ⛔ 不要让纸张压缩或撑破 .cand-page 的布局（375c 的滚动缺陷同理，超出去就不可达） */
.bf-wrap { background: #f2f3f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
.bf-empty { padding: 48px 0; text-align: center; color: var(--text-secondary); font-size: 13px; }

/* A4 纸张：794px ≈ 210mm @96dpi（与立项报告同宽，↔ 两份报告看起来是一套东西） */
.bf-paper {
  width: 794px; margin: 0 auto; background: #fff; padding: 26px 34px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .08);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #1f2329;
}

.bf-hd { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 2px solid #1f2329; padding-bottom: 10px; }
.bf-kicker { font-size: 11px; letter-spacing: .12em; color: #646a73; margin-bottom: 4px; }
.bf-hd h1 { margin: 0 0 6px; font-size: 22px; font-weight: 600; letter-spacing: -.01em; }
.bf-hd-sub { display: flex; gap: 14px; font-size: 12px; color: #646a73; flex-wrap: wrap; }
.bf-hd-r { text-align: right; }
.bf-badge { border: 1px solid #1f2329; border-radius: 4px; padding: 4px 10px; font-size: 12px; letter-spacing: .1em; }
.bf-badge-note { margin-top: 4px; font-size: 10px; color: #16794a; }

/* 结论：三档只有颜色不同，⛔ 文案里必须也写明档位（不能只靠颜色区分） */
.bf-verdict { margin-top: 13px; padding: 10px 13px; border-left: 4px solid #8a9099; background: #f7f9fc; border-radius: 0 6px 6px 0; }
.bf-verdict.is-go { border-left-color: #16794a; background: #f1f9f5; }
.bf-verdict.is-watch { border-left-color: #b26a00; background: #fff8e6; }
.bf-verdict.is-hold { border-left-color: #c0392b; background: #fdf2f1; }
.bf-verdict-hd { display: flex; align-items: center; gap: 8px; }
.bf-verdict-tag { font-size: 11px; padding: 1px 7px; border-radius: 3px; background: #1f2329; color: #fff; flex: none; }
.bf-verdict.is-go .bf-verdict-tag { background: #16794a; }
.bf-verdict.is-watch .bf-verdict-tag { background: #b26a00; }
.bf-verdict.is-hold .bf-verdict-tag { background: #c0392b; }
.bf-verdict-hd h2 { margin: 0; font-size: 14px; font-weight: 600; }
.bf-verdict-text { margin: 6px 0 0; font-size: 12.5px; line-height: 1.7; color: #303133; }
.bf-verdict-reasons { margin: 6px 0 0; padding-left: 18px; }
.bf-verdict-reasons li { font-size: 12px; line-height: 1.65; color: #504f57; }

.bf-sec { margin-top: 14px; }
.bf-sec-hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 7px; }
.bf-sec-hd h2 { margin: 0; font-size: 14px; font-weight: 600; }
.bf-sec-note { font-size: 11.5px; color: #8a9099; }

/* 六、下一步（v1.13.379）：三档与结论同一套配色，扫一眼就知道「该不该花钱」 */
.bf-next { padding: 9px 12px; background: #f7f9fc; border-left: 3px solid #8a9099; border-radius: 0 6px 6px 0; }
.bf-next.is-recommend { background: #f2f7fd; border-left-color: #2563eb; }
.bf-next.is-not_now { background: #fdf6ec; border-left-color: #e6a23c; }
.bf-next b { font-size: 13px; color: #1f2329; }
.bf-next ul { margin: 5px 0 0; padding-left: 18px; }
.bf-next li { font-size: 12px; line-height: 1.65; color: #504f57; }

.bf-kpi { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.bf-kpi-num { font-size: 26px; font-weight: 600; line-height: 1.1; letter-spacing: -.01em; }
.bf-kpi-num em { font-size: 13px; font-weight: 400; font-style: normal; color: #646a73; margin-left: 3px; }
.bf-kpi-label { font-size: 11.5px; color: #8a9099; margin-top: 3px; }
.bf-kpi-side { text-align: right; }
.bf-kpi-note { font-size: 11.5px; color: #646a73; margin-top: 4px; line-height: 1.5; }

.bf-chip { display: inline-block; font-size: 11.5px; padding: 2px 9px; border-radius: 10px; background: #eef0f3; color: #303133; }
.bf-chip.lv-p90 { background: #e7f4ec; color: #16794a; }
.bf-chip.lv-p70 { background: #eef7f2; color: #1d7f52; }
.bf-chip.lv-p50 { background: #eef2fb; color: #2563eb; }
.bf-chip.lv-p25 { background: #fff4e8; color: #a15c00; }
.bf-chip.lv-low { background: #f4f4f5; color: #8a9099; }
.bf-chip.lv-dense { background: #fdf2f1; color: #c0392b; }
.bf-chip.lv-busy { background: #fff4e8; color: #a15c00; }
.bf-chip.lv-normal { background: #eef2fb; color: #2563eb; }
.bf-chip.lv-sparse { background: #e7f4ec; color: #16794a; }

.bf-kv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px 14px; margin: 9px 0 0; }
/* v1.13.379：「能买到」是 5 个词条，挤在 1/3 列里会折成五行 ⇒ 首行整宽、后两行两列 */
.bf-kv.is-flow { grid-template-columns: 1fr 1fr; }
.bf-kv.is-flow > div:first-child { grid-column: 1 / -1; }
.bf-kv dt { font-size: 11px; color: #8a9099; margin-bottom: 3px; }
.bf-kv dd { margin: 0; font-size: 12.5px; line-height: 1.5; }
.bf-muted { color: #8a9099; font-size: 11px; }
.bf-danger { color: #c0392b; font-weight: 600; }

.bf-scope { margin: 7px 0 0; font-size: 11.5px; color: #646a73; line-height: 1.6; }

.bf-bars { margin-top: 8px; }
.bf-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.bf-bar-l { width: 96px; flex: none; font-size: 11px; color: #646a73; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bf-bar-track { flex: 1; height: 8px; background: #eef0f3; border-radius: 4px; overflow: hidden; }
.bf-bar-track i { display: block; height: 100%; background: #5b8def; }
.bf-bar-v { width: 28px; text-align: right; font-size: 11px; color: #646a73; flex: none; }

/* 未评：黄框 + 说清「未评 ≠ 0」 */
.bf-miss { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; margin-top: 6px; background: #fff8e6; border: 1px dashed #e8c07d; border-radius: 6px; font-size: 12px; line-height: 1.6; color: #7a5b1e; }
.bf-miss b { font-size: 13px; color: #a15c00; }
.bf-miss.is-soft { background: #f7f9fc; border-color: #d9e0ea; color: #504f57; }
.bf-miss.is-soft b { color: #303133; }

.bf-gap { margin: 8px 0 0; font-size: 11.5px; line-height: 1.6; color: #8a9099; }
.bf-risks { margin: 0; padding-left: 18px; }
.bf-risks li { font-size: 12.5px; line-height: 1.6; margin-bottom: 3px; color: #1f2329; }

.bf-foot { margin-top: 14px; padding-top: 9px; border-top: 1px solid #dcdfe6; }
.bf-foot-t { font-size: 11px; font-weight: 600; margin-bottom: 4px; }
.bf-foot-r { font-size: 10px; color: #646a73; line-height: 1.6; }
.bf-foot-r b { display: inline-block; width: 56px; color: #1f2329; }
.bf-foot-x { margin-top: 6px; font-size: 9.5px; color: #a0a5ad; line-height: 1.5; }
</style>
