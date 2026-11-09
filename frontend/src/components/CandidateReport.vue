<template>
  <el-dialog
    :model-value="modelValue"
    title="选址立项报告"
    width="880px"
    append-to-body
    class="cand-report-dialog"
    @update:model-value="$emit('update:modelValue', $event)"
    @opened="onOpened"
  >
    <div class="rp-bar">
      <div class="rp-bar-l">
        <el-checkbox v-model="wantAi" :disabled="!isVip || aiLoading">
          加入 AI 选址建议
        </el-checkbox>
        <span class="rp-hint">
          <template v-if="!isVip">🔒 AI 选址建议为 VIP 功能，报告仍可正常导出</template>
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

    <!-- AI 业态未知时先问一句（⛔ 不让模型猜业态，与 AI 选址建议同口径） -->
    <div v-if="wantAi && needCategory" class="rp-cat">
      <span>该品牌未收录业态，请先填写：</span>
      <el-input v-model="categoryInput" size="small" style="width: 240px" maxlength="30" placeholder="例：日式牛肉盖饭快餐" />
    </div>

    <div v-loading="loading" class="rp-scroll">
      <div ref="paper" class="rp-paper">
        <!-- 抬头 -->
        <div class="rp-hd">
          <div class="rp-hd-l">
            <div class="rp-hd-kicker">选址赢家Online · 选址立项</div>
            <h1>{{ model.projectName }}</h1>
            <div class="rp-hd-sub">
              <span v-if="model.brand">品牌 {{ model.brand }}</span>
              <span v-if="model.stage">阶段 {{ model.stage }}</span>
              <span>{{ fmtTime(model.generatedAt) }}</span>
            </div>
          </div>
          <div class="rp-hd-r">
            <div class="rp-badge">立项报告</div>
          </div>
        </div>

        <!-- 商圈画像：有就展示，没有就明说 -->
        <div v-if="model.district" class="rp-sec">
          <div class="rp-sec-hd">
            <h2>商圈画像</h2>
            <span class="rp-sec-note">
              {{ model.district.name }}
              <template v-if="!model.district.contained">（最近商圈，直线约 {{ fmtM(model.district.distanceM) }}）</template>
            </span>
          </div>
          <div class="rp-stars">
            <span class="rp-stars-num">{{ model.district.score }}</span>
            <span class="rp-stars-icons" :aria-label="`商圈评分 ${model.district.score} 分（满分 100）`">
              <i v-for="n in 5" :key="n" :class="n <= model.district.stars ? 'on' : (n - 0.5 === model.district.stars ? 'half' : '')">★</i>
            </span>
            <span class="rp-stars-note">商圈面综合评分（满分 100）· 非该点位自身评分</span>
          </div>
          <div class="rp-kv">
            <div><dt>居住人口</dt><dd>{{ num(model.district.population) }}</dd></div>
            <div><dt>工作人口</dt><dd>{{ num(model.district.work) }}</dd></div>
            <div><dt>到访人次</dt><dd>{{ num(model.district.visit) }}</dd></div>
            <div><dt>客群 / 能级</dt><dd>{{ [model.district.crowd, model.district.level].filter(Boolean).join(' · ') || '无标签' }}</dd></div>
            <div><dt>商圈内竞品</dt><dd>{{ model.district.competitorCount }} 家</dd></div>
            <div><dt>商圈内自家门店</dt><dd>{{ model.district.myStoreCount }} 家</dd></div>
          </div>

          <!-- 收入结构：纯 CSS 条，不引 echarts -->
          <div v-if="incomeRows.length" class="rp-income">
            <div class="rp-income-t">收入结构（商圈面占比）</div>
            <div v-for="r in incomeRows" :key="r.label" class="rp-income-row">
              <span class="rp-income-l">{{ r.label }}</span>
              <span class="rp-income-bar"><i :style="{ width: r.pct + '%' }"></i></span>
              <span class="rp-income-v">{{ r.pct.toFixed(1) }}%</span>
            </div>
          </div>
        </div>

        <!-- 地图 -->
        <div class="rp-sec">
          <div class="rp-sec-hd">
            <h2>位置示意</h2>
            <span class="rp-sec-note">半径 {{ fmtM(model.coordinate.radius) }} · 坐标 {{ model.coordinate.lat.toFixed(6) }}, {{ model.coordinate.lng.toFixed(6) }}</span>
          </div>
          <div class="rp-map">
            <img v-if="mapImg" :src="mapImg" alt="点位与评估半径示意" />
            <div v-else class="rp-map-ph">地图截图生成中…（若长时间为空，多为底图服务不可用，不影响其余内容）</div>
          </div>
        </div>

        <!-- 关键信息 -->
        <div class="rp-sec">
          <div class="rp-sec-hd"><h2>关键信息</h2></div>
          <table class="rp-table">
            <tbody>
              <tr v-for="(f, i) in model.facts" :key="i">
                <th>{{ f.label }}</th>
                <td>
                  <span class="rp-table-v">{{ f.value }}</span>
                  <span v-if="f.note" class="rp-table-n">{{ f.note }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 风险与待补 -->
        <div v-if="model.risks.length" class="rp-sec">
          <div class="rp-sec-hd"><h2>风险与待确认</h2></div>
          <ul class="rp-risks">
            <li v-for="(r, i) in model.risks" :key="i">{{ r }}</li>
          </ul>
        </div>

        <!-- AI 建议（可选） -->
        <div v-if="aiText" class="rp-sec rp-ai">
          <div class="rp-sec-hd">
            <h2>AI 选址建议</h2>
            <span class="rp-sec-note">由大模型生成，仅供参考，不构成本系统的测算结论</span>
          </div>
          <div class="rp-ai-body">{{ aiText }}</div>
        </div>

        <!-- 口径页脚 -->
        <div class="rp-foot">
          <div class="rp-foot-t">数据口径</div>
          <div class="rp-foot-r"><b>来源</b>{{ model.provenance.source }}</div>
          <div class="rp-foot-r"><b>期次</b>{{ model.provenance.period }}</div>
          <div class="rp-foot-r"><b>样本</b>{{ model.provenance.sample }}</div>
          <div class="rp-foot-r"><b>置信</b>{{ model.provenance.confidence }}</div>
          <div class="rp-foot-r"><b>完备</b>{{ model.completeness }}</div>
          <div class="rp-foot-x">
            本报告由「选址赢家Online」生成 · {{ fmtTime(model.generatedAt) }} · 生成人 {{ username }}
            · 不含销售预测，营业额需以实际经营数据为准
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
      <el-button type="primary" :loading="exporting" @click="exportPdf">下载 PDF</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { pickDistrictForPoint, buildReportModel, fmtM } from '@/utils/candidateReport.js'
import { resolveBrandCategory } from '@/utils/storeBrand.js'
import { captureMapOnlyCanvas } from '@/utils/mapCapture'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  candidate: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue'])

const userStore = useUserStore()

const loading = ref(false)
const exporting = ref(false)
const paper = ref(null)
const districts = ref([])
const mapImg = ref('')

const wantAi = ref(false)      // 🔴 默认 false：不勾就不花钱（业主 2026-11-09 定）
const aiText = ref('')
const aiLoading = ref(false)
const categoryInput = ref('')

const isVip = computed(() => !!userStore.isVipActive)
const username = computed(() => userStore.user?.username || '—')

const model = computed(() => {
  const c = props.candidate || {}
  const hit = pickDistrictForPoint(districts.value, Number(c.latitude), Number(c.longitude))
  return buildReportModel(c, hit)
})

/** 业态：白名单能命中就用，命中不了要用户填（⛔ 不让模型猜） */
const resolvedCat = computed(() => {
  const c = props.candidate || {}
  return resolveBrandCategory(c.brand || c.name || '', c.city || '')
})
const needCategory = computed(() => !resolvedCat.value.mapped && !categoryInput.value.trim())

const incomeRows = computed(() => {
  const inc = model.value.district?.income
  if (!inc) return []
  const rows = [
    ['低收入', inc.low], ['中等偏下', inc.midLow], ['小康', inc.wellOff],
    ['中产', inc.mid], ['富裕', inc.affluent], ['富人', inc.rich]
  ].map(([label, v]) => [label, Number(v) || 0])
  const total = rows.reduce((s, r) => s + r[1], 0)
  if (!total) return []
  return rows.map(([label, v]) => ({ label, pct: (v / total) * 100 }))
})

function num(v) {
  const n = Number(v) || 0
  return n ? n.toLocaleString('zh-CN') + ' 人' : '无数据'
}

function fmtTime(d) {
  const t = d instanceof Date ? d : new Date(d)
  if (isNaN(t.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
}

/** 打开时按城市拉商圈面（一次），并把地图截图渲出来 */
async function onOpened() {
  if (!props.candidate) return
  loading.value = true
  mapImg.value = ''
  try {
    const city = String(props.candidate.city || '').replace(/市$/, '')
    if (city) {
      const { data } = await axios.get('/api/districts', { params: { city } })
      districts.value = data.districts || []
    } else {
      districts.value = []
    }
  } catch (e) {
    districts.value = []
    ElMessage.warning('商圈数据读取失败，报告将只包含登记信息')
  } finally {
    loading.value = false
  }
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
  if (!isVip.value) return ElMessage.warning('AI 选址建议为 VIP 功能')
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
 * 收集「安全的切页点」：把 DOM 里每个可切元素的上/下边界换算成 canvas 像素。
 * 优先用 DOM 边界而不是像素扫描 —— 因为表格行、段落之间常有 1px 边框线
 * （#f0f1f3 ≈ 240），像素扫描判不出「纯白」，于是退回均分点，正好把一行字切成两半。
 * ⭐ 2026-11-09 实测踩到：第 2 页顶部从「按当前可见范围统计」这半行开始。
 */
function collectCutCandidates(paperEl, canvas) {
  try {
    const box = paperEl.getBoundingClientRect()
    if (!box.height) return []
    const ratio = canvas.height / box.height
    const out = []
    // ⚠️ 只收「区块级 + 行级」边界，**不收 `.rp-ai-body`** ——
    //    收了会把切点落在「AI 选址建议」标题与正文之间，标题留在上页、内容翻到下页（实测踩到）。
    //    整块一起走，才是人读得懂的翻页。
    paperEl.querySelectorAll('.rp-sec, .rp-table tr, .rp-risks li, .rp-foot').forEach((el) => {
      const r = el.getBoundingClientRect()
      out.push(Math.round((r.top - box.top) * ratio))
      out.push(Math.round((r.bottom - box.top) * ratio))
    })
    return out.filter((v) => v > 0 && v < canvas.height).sort((a, b) => a - b)
  } catch {
    return []
  }
}

/**
 * 在 idealY 附近找一行「几乎全白」的像素作切页点 —— 避免把一行字切成两半。
 * 只在 ±8% 页高范围内找，越界就退回理想位置（宁可切到内容，也不让两页高度失衡）。
 * ⚠️ `getImageData` 在画布被跨域图片污染时会抛（地图截图若走了外链就可能）⇒ 直接退回理想位置。
 */
function findCutY(canvas, fromY, idealH, pageHpx) {
  try {
    const ctx = canvas.getContext('2d')
    const target = fromY + idealH
    const win = Math.floor(pageHpx * 0.08)
    const lo = Math.max(fromY + Math.floor(pageHpx * 0.55), target - win)
    const hi = Math.min(canvas.height, target + win)
    if (hi - lo < 8) return idealH
    const W = canvas.width
    const data = ctx.getImageData(0, lo, W, hi - lo).data
    const step = 4                       // 每 4 像素抽一格，够判断且快 4 倍
    const samples = Math.ceil(W / step)
    let bestRow = -1
    let bestScore = -1
    for (let row = 0; row < hi - lo; row++) {
      let white = 0
      const base = row * W * 4
      for (let x = 0; x < W; x += step) {
        const i = base + x * 4
        if (data[i] > 236 && data[i + 1] > 236 && data[i + 2] > 236) white++
      }
      const score = white / samples
      if (score > bestScore) { bestScore = score; bestRow = row }
      if (score >= 0.999) break          // 已找到纯白行，不必再往下扫
    }
    // 只有「够白」才调位，否则不如按均分切
    if (bestRow >= 0 && bestScore >= 0.9) return lo - fromY + bestRow
    return idealH
  } catch {
    return idealH
  }
}

/**
 * 决定这一页切在哪：①优先 DOM 区块/行边界（最安全）②退一步找纯白像素行 ③再退就均分。
 * 三种都限制在「本页至少装 55%」以内，避免把内容挤到下一页。
 */
function pickCutY(canvas, fromY, idealH, pageHpx, cuts) {
  const headroom = Math.floor(fromY + pageHpx * 0.55)
  const limit = fromY + idealH + Math.floor(pageHpx * 0.15)
  // ① DOM 边界：取「不早于最低填充量、不晚于容差」里最靠后的一个（尽量填满本页）
  const domCut = cuts.filter((c) => c > headroom && c <= limit).pop()
  if (domCut !== undefined) return domCut - fromY
  // ② 像素白行
  return findCutY(canvas, fromY, idealH, pageHpx)
}

/**
 * 导出 PDF：html2canvas 截图 → jsPDF。
 * 版式规则（业主 2026-11-09 两次拍板）：
 *   ① 纸张**固定 A4 纵向**（⛔ 不再按内容高度自定义纸张）
 *   ② 能缩到 ≥72% 装进一页 ⇒ 一页（无 AI 时约 77%）
 *   ③ 再缩就不可读了（含 AI 时约 58%）⇒ **分页**，不在小字上一路缩下去
 *      —— 分页时先「均分缩放」到每页刚好占满，再在均分点附近找空白行切，避免切到字
 */
async function exportPdf() {
  if (!paper.value) return
  exporting.value = true
  try {
    const { default: html2canvas } = await import('html2canvas')
    const { jsPDF } = await import('jspdf')
    const canvas = await html2canvas(paper.value, {
      useCORS: true,
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false
    })
    const A4_W = 210
    const A4_H = 297
    const PAD = 6                        // 上下留白（mm）
    const availH = A4_H - PAD * 2        // 285mm
    const MIN_READABLE = 0.72            // 低于此比例正文字号 ≈4~5pt，宁可分页
    const MAX_PAGES = 3                  // 兜底：超过 3 页就不再增加，改为缩到 3 页
    const rawH = (canvas.height * A4_W) / canvas.width   // 1:1 下的纸高（mm）

    // 一页装得下就一页；装不下但缩一页仍可读就缩；否则分页
    const onePageScale = availH / rawH
    const pages = onePageScale >= MIN_READABLE
      ? 1
      : Math.min(MAX_PAGES, Math.max(2, Math.ceil(rawH / availH)))
    // 分页时均分：每页装 rawH/pages，缩放到正好铺满可用高度（≤1，不放大）
    const scale = pages === 1 ? Math.min(1, onePageScale) : Math.min(1, (rawH / pages) / availH)

    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [A4_W, A4_H] })

    if (pages === 1) {
      // 单页：整图一次性放上去，水平居中（缩放后左右对称留白）
      const drawW = A4_W * scale
      const drawH = rawH * scale
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.72), 'JPEG', (A4_W - drawW) / 2, PAD, drawW, drawH)
      if (scale < 0.9) {
        ElMessage.warning(`内容较多，已自动缩小到约 ${Math.round(scale * 100)}% 才装进一页 A4`)
      }
    } else {
      // 多页：每页取原图的一段，等比铺满页宽
      const pxPerMm = canvas.width / A4_W
      const pageHpx = Math.floor((availH * pxPerMm) / scale)   // 每页对应原图多少 px
      const cuts = collectCutCandidates(paper.value, canvas)
      let fromY = 0
      for (let i = 0; i < pages; i++) {
        let h = Math.min(pageHpx, canvas.height - fromY)
        // 最后一页之外，切点按「DOM 边界优先」挑，避免把表格行/段落切成两半
        if (i < pages - 1) h = pickCutY(canvas, fromY, h, pageHpx, cuts)
        const slice = document.createElement('canvas')
        slice.width = canvas.width
        slice.height = h
        slice.getContext('2d').drawImage(canvas, 0, fromY, canvas.width, h, 0, 0, canvas.width, h)
        if (i > 0) pdf.addPage([A4_W, A4_H], 'p')
        const hMm = (h * scale) / pxPerMm
        pdf.addImage(slice.toDataURL('image/jpeg', 0.78), 'JPEG', 0, PAD, A4_W, hMm)
        fromY += h
      }
      ElMessage.info(`内容较多，已自动排成 ${pages} 页 A4（未压缩字号）`)
    }

    const safe = String(model.value.projectName || '点位').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    pdf.save(`立项报告_${safe}_${stamp}.pdf`)
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

// 关掉弹窗时清掉 AI 文本，避免下次打开看到上一个点位的建议
watch(() => props.modelValue, (v) => {
  if (!v) {
    aiText.value = ''
    wantAi.value = false
    categoryInput.value = ''
  }
})
</script>

<style scoped>
.rp-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.rp-bar-l { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.rp-hint { font-size: 12px; color: #909399; line-height: 1.5; }
.rp-cat { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #606266; margin-bottom: 10px; }
.rp-scroll { max-height: 62vh; overflow: auto; background: #f2f3f5; padding: 16px; }

/* A4 纸张：794px ≈ 210mm @96dpi */
.rp-paper {
  width: 794px; margin: 0 auto; background: #fff; padding: 26px 34px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .08);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #1f2329;
}
.rp-hd { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 2px solid #1f2329; padding-bottom: 10px; }
.rp-hd-kicker { font-size: 11px; letter-spacing: .12em; color: #646a73; margin-bottom: 4px; }
.rp-hd h1 { margin: 0 0 6px; font-size: 22px; font-weight: 600; letter-spacing: -.01em; }
.rp-hd-sub { display: flex; gap: 14px; font-size: 12px; color: #646a73; flex-wrap: wrap; }
.rp-badge { border: 1px solid #1f2329; border-radius: 4px; padding: 4px 10px; font-size: 12px; letter-spacing: .1em; }

.rp-sec { margin-top: 13px; }
.rp-sec-hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 7px; }
.rp-sec-hd h2 { margin: 0; font-size: 14px; font-weight: 600; }
.rp-sec-note { font-size: 12px; color: #8a9099; }

.rp-stars { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.rp-stars-num { font-size: 26px; font-weight: 600; line-height: 1; }
.rp-stars-icons { font-size: 17px; letter-spacing: 2px; color: #d8dbe0; }
.rp-stars-icons i { font-style: normal; }
.rp-stars-icons i.on, .rp-stars-icons i.half { color: #f0a020; }
.rp-stars-icons i.half { opacity: .55; }
.rp-stars-note { font-size: 12px; color: #8a9099; }

.rp-kv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px 14px; }
.rp-kv dt { font-size: 11px; color: #8a9099; margin-bottom: 3px; }
.rp-kv dd { margin: 0; font-size: 12.5px; }

.rp-income { margin-top: 8px; }
.rp-income-t { font-size: 12px; color: #646a73; margin-bottom: 6px; }
.rp-income-row { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.rp-income-l { width: 62px; font-size: 11px; color: #646a73; flex: none; }
.rp-income-bar { flex: 1; height: 8px; background: #eef0f3; border-radius: 4px; overflow: hidden; }
.rp-income-bar i { display: block; height: 100%; background: #5b8def; }
.rp-income-v { width: 48px; text-align: right; font-size: 11px; color: #646a73; flex: none; }

.rp-map { border: 1px solid #e6e8eb; border-radius: 6px; overflow: hidden; background: #fafbfc; }
/* 🔴 必须同时给 width:100% 和**固定 height**，`object-fit` 才起作用。
   写成 `width:100%; height:auto; max-height:330px; object-fit:cover` 是错的：
   高度被 max-height 压到 330、宽度仍 100% ⇒ **图片被横向拉伸**，
   半径圈从正圆变成椭圆（2026-11-09 真机截图才发现）。 */
.rp-map img { display: block; width: 100%; height: 330px; object-fit: cover; object-position: center; }
.rp-map-ph { padding: 28px 12px; text-align: center; font-size: 12px; color: #a0a5ad; }

.rp-table { width: 100%; border-collapse: collapse; }
.rp-table th { width: 120px; text-align: left; font-weight: 500; font-size: 12px; color: #646a73; padding: 5px 0; vertical-align: top; border-bottom: 1px solid #f0f1f3; }
.rp-table td { padding: 5px 0; font-size: 12.5px; border-bottom: 1px solid #f0f1f3; }
.rp-table-v { font-weight: 500; }
.rp-table-n { display: block; font-size: 11px; color: #8a9099; margin-top: 2px; }

.rp-risks { margin: 0; padding-left: 18px; }
.rp-risks li { font-size: 12.5px; line-height: 1.55; margin-bottom: 3px; color: #1f2329; }

.rp-ai .rp-ai-body { font-size: 11.5px; line-height: 1.6; white-space: pre-wrap; background: #f7f9fc; border-left: 3px solid #5b8def; padding: 9px 11px; border-radius: 0 6px 6px 0; }

.rp-foot { margin-top: 14px; padding-top: 9px; border-top: 1px solid #dcdfe6; }
.rp-foot-t { font-size: 11px; font-weight: 600; margin-bottom: 4px; }
.rp-foot-r { font-size: 10px; color: #646a73; line-height: 1.6; }
.rp-foot-r b { display: inline-block; width: 34px; color: #1f2329; }
.rp-foot-x { margin-top: 6px; font-size: 9.5px; color: #a0a5ad; line-height: 1.5; }
</style>
