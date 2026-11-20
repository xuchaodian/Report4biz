<template>
  <!-- A4 纸面：**纯展示**，不含任何取数 / 扣费 / 弹窗逻辑。
       v1.13.392 从 CandidateReport.vue 抽出来，因为分享出去的那张纸必须与
       作者当时看到的一模一样 —— 两处渲染同一个组件，是唯一能保证"看起来一样"的做法。
       ⚠️ 根元素必须是 `.rp-paper`：PDF 导出用它当截图根（utils/exportPaperPdf.js）。 -->
  <div class="rp-paper">
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

    <!-- 商圈画像：有就展示，没有就明说。
         🔴 v1.13.342 起**只放商圈面基线**（评分 / 竞品 / 自家门店），⛔ 不掺人口：
         人口是「点位 + 半径圆」口径，与商圈面无关，已独立成下面的人口区块。 -->
    <div v-if="model.district" class="rp-sec">
      <div class="rp-sec-hd">
        <h2>商圈画像</h2>
        <span class="rp-sec-note">
          {{ model.district.name }}
          <template v-if="!model.district.contained">（最近商圈，直线约 {{ fmtM(model.district.distanceM) }}）</template>
          · 商圈面基线口径
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
        <div><dt>客群 / 能级</dt><dd>{{ [model.district.crowd, model.district.level].filter(Boolean).join(' · ') || '无标签' }}</dd></div>
        <div><dt>商圈内竞品</dt><dd>{{ model.district.competitorCount }} 家</dd></div>
        <div><dt>商圈内自家门店</dt><dd>{{ model.district.myStoreCount }} 家</dd></div>
      </div>
    </div>

    <!-- 人口数据（点位 + 半径圆，联通 1001）：**不依赖商圈面**（v1.13.342 解耦）。
         ⛔ 这个块不能包在 v-if="model.district" 里：城市没有商圈面数据时，
         买了联通人口也必须能在纸面看到。用 .rp-sec 起头 ⇒ 自动纳入安全切页点。 -->
    <div class="rp-sec rp-pop">
      <div class="rp-sec-hd">
        <h2>人口数据（点位半径）</h2>
        <span class="rp-sec-note">
          联通智慧足迹 1001 · 半径 {{ radiusText(model.population.popRadius) }} 内
          <template v-if="model.population.popMonth"> · 期次 {{ model.population.popMonth }}</template>
        </span>
      </div>
      <template v-if="model.population.hasPop">
        <!-- 量级四项。⚠️ 到访是**人次**（统计期累计），⛔ 与另三项不同量纲、不可相加 -->
        <div class="rp-kv rp-kv-4">
          <div><dt>{{ radiusText(model.population.popRadius) }} 内居住</dt><dd>{{ num(model.population.population) }}</dd></div>
          <div><dt>{{ radiusText(model.population.popRadius) }} 内工作</dt><dd>{{ num(model.population.work) }}</dd></div>
          <div><dt>{{ radiusText(model.population.popRadius) }} 内到访</dt><dd>{{ numVisit(model.population.visit) }}</dd></div>
          <div><dt>联通全量人口</dt><dd>{{ num(model.population.popTotal) }}</dd></div>
        </div>

        <!-- 性别构成：到访 / 居住 / 工作 三套口径**各自独立**，⛔ 不加总 -->
        <div v-if="genderRows.length" class="rp-pop-blk">
          <div class="rp-pop-t">性别构成（各口径独立统计，不可相加）</div>
          <table class="rp-pop-gt">
            <thead>
              <tr><th>口径</th><th>男</th><th>女</th><th>合计</th></tr>
            </thead>
            <tbody>
              <tr v-for="g in genderRows" :key="g.key">
                <th>{{ g.name }}</th>
                <td>{{ g.malePct.toFixed(1) }}%</td>
                <td>{{ g.femalePct.toFixed(1) }}%</td>
                <td>{{ g.total.toLocaleString('zh-CN') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 年龄结构：居住 / 工作 双列全 15 档（组内占比，跨列可直接比） -->
        <div v-if="ageCols.length" class="rp-pop-blk">
          <div class="rp-pop-t">年龄结构（15 档全量 · 各口径组内占比）</div>
          <div class="rp-pop-cols">
            <div v-for="c in ageCols" :key="c.key" class="rp-pop-col">
              <div class="rp-pop-ch">{{ c.name }}</div>
              <div v-for="r in c.rows" :key="r.label" class="rp-pb-row">
                <span class="rp-pb-l">{{ r.label }}</span>
                <span class="rp-pb-track"><i :style="{ width: Math.min(100, r.pct) + '%' }"></i></span>
                <span class="rp-pb-v">{{ r.pct.toFixed(1) }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 月话费档：居住 / 工作 双列全 6 档。⛔ 消费能力代理，不是客单价 -->
        <div v-if="arpuCols.length" class="rp-pop-blk">
          <div class="rp-pop-t">月话费档（6 档全量 · 消费能力代理，非客单价）</div>
          <div class="rp-pop-cols">
            <div v-for="c in arpuCols" :key="c.key" class="rp-pop-col">
              <div class="rp-pop-ch">{{ c.name }}</div>
              <div v-for="r in c.rows" :key="r.label" class="rp-pb-row">
                <span class="rp-pb-l">{{ r.label }}</span>
                <span class="rp-pb-track"><i :style="{ width: Math.min(100, r.pct) + '%' }"></i></span>
                <span class="rp-pb-v">{{ r.pct.toFixed(1) }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 小结：只陈述分布事实，⛔ 不推导营业额 / 客流预测 -->
        <ul v-if="model.population.summary && model.population.summary.length" class="rp-pop-sum">
          <li v-for="(s, i) in model.population.summary" :key="i">{{ s }}</li>
        </ul>
      </template>
      <div v-else class="rp-pop-empty">
        <b>尚未获取联通人口数据</b>
        <span>人口规模、性别、年龄与消费档位均为空。点上方「获取人口数据」按点位半径向联通取数 —— 若该位置在「我的门店」里同半径买过，会自动复用、不重复扣费。</span>
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
    <div v-if="model.risks && model.risks.length" class="rp-sec">
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
        本报告由「选址赢家Online」生成 · {{ fmtTime(model.generatedAt) }} · 生成人 {{ authorName || '—' }}
        · 不含销售预测，营业额需以实际经营数据为准
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * 立项报告 · A4 纸面（纯展示组件，v1.13.392）
 *
 * 🔴 为什么单独抽出来：这份纸在**两个地方**要一模一样地出现 ——
 *   ① 应用内弹窗（CandidateReport.vue，作者本人看，旁边有取数条）；
 *   ② 分享出去的免登录页（SharedReportView.vue，同事/领导看，没有取数条）。
 *   两处各写一遍模板 ⇒ 改一处忘一处，纸面必然分叉；抽成一个组件是唯一可靠做法。
 *
 * ⛔ 这个组件里**不许**出现：取数、扣配额、axios、ElMessage、路由跳转。
 *    一旦混进来，匿名页就没法复用它（既没有登录态，也不该给访客任何"花钱"的入口）。
 *
 * ⚠️ 版式派生（哪几列并排）留在这里、口径派生（数值怎么算）留在 utils/candidateReport.js：
 *    改版式不该动数据层，改口径不该动版式。
 */
import { computed } from 'vue'
import { fmtM, radiusText } from '@/utils/candidateReport.js'

const props = defineProps({
  /** buildReportModel() 的输出（或快照里还原出来的同结构对象） */
  model: { type: Object, required: true },
  /** 位置示意图 dataURL；快照页从后端拿，应用内由 mapCapture 现画 */
  mapImg: { type: String, default: '' },
  /** AI 建议正文（可空） */
  aiText: { type: String, default: '' },
  /** 生成人显示名 */
  authorName: { type: String, default: '' }
})

/** 性别三行（到访 / 居住 / 工作）；某套口径为空则不画那一行 */
const genderRows = computed(() => {
  const g = props.model?.population?.gender
  if (!g) return []
  return [['visit', '到访人次'], ['live', '居住'], ['work', '工作']]
    .filter(([k]) => g[k])
    .map(([k, name]) => ({ key: k, name, ...g[k] }))
})

/** 年龄双列（居住 / 工作），空列直接过滤 */
const ageCols = computed(() => {
  const a = props.model?.population?.ages
  if (!a) return []
  return [['live', '居住人口'], ['work', '工作人口']]
    .filter(([k]) => Array.isArray(a[k]) && a[k].length)
    .map(([k, name]) => ({ key: k, name, rows: a[k] }))
})

/** 月话费双列（居住 / 工作） */
const arpuCols = computed(() => {
  const a = props.model?.population?.arpu
  if (!a) return []
  return [['live', '居住人口'], ['work', '工作人口']]
    .filter(([k]) => Array.isArray(a[k]) && a[k].length)
    .map(([k, name]) => ({ key: k, name, rows: a[k] }))
})

function num(v) {
  const n = Number(v) || 0
  return n ? n.toLocaleString('zh-CN') + ' 人' : '无数据'
}

/** 到访是**人次**，与居住/工作不同量纲 —— ⛔ 别复用 num() 让人误读成"人" */
function numVisit(v) {
  const n = Number(v) || 0
  return n ? n.toLocaleString('zh-CN') + ' 人次' : '无数据'
}

function fmtTime(d) {
  const t = d instanceof Date ? d : new Date(d)
  if (isNaN(t.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
}
</script>

<style scoped>
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

/* 纸内「人口未获取」提示：导出后也要能看见，所以写在报告里而不是弹提示 */
.rp-pop-empty {
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px 12px; margin-top: 6px;
  background: #fff8e6; border: 1px dashed #e8c07d; border-radius: 6px;
  font-size: 12px; line-height: 1.6; color: #7a5b1e;
}
.rp-pop-empty b { font-size: 13px; color: #a15c00; }

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

.rp-kv-4 { grid-template-columns: repeat(4, 1fr); }

/* ── 人口结构（v1.13.387）────────────────────────────────────────────
   双列条形是**纯 CSS** 比例条，宽度直接等于组内占比 ⇒ 左列（居住）与右列（工作）
   的条长可以直接横向比较。⛔ 不要改成「按列内最大值归一」——那会让两列都撑满，
   看上去分布一样，实际完全不同。
   ⚠️ PDF 走 html2canvas 截 DOM，所以这里必须是真实背景色而不是伪元素。 */
.rp-pop-blk { margin-top: 10px; }
.rp-pop-t { font-size: 12px; color: #646a73; margin-bottom: 6px; }

.rp-pop-gt { width: 100%; border-collapse: collapse; }
.rp-pop-gt th, .rp-pop-gt td { font-size: 11.5px; padding: 3px 0; border-bottom: 1px solid #f0f1f3; text-align: right; }
.rp-pop-gt thead th { font-weight: 500; font-size: 11px; color: #8a9099; }
.rp-pop-gt tbody th { width: 96px; text-align: left; font-weight: 500; color: #1f2329; }
.rp-pop-gt td:first-of-type { width: 72px; }
.rp-pop-gt td:last-child { width: 96px; color: #646a73; }

.rp-pop-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; }
.rp-pop-col { min-width: 0; }
.rp-pop-ch { font-size: 11px; font-weight: 600; color: #1f2329; margin-bottom: 3px; }
.rp-pb-row { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.rp-pb-l { width: 54px; font-size: 10.5px; color: #646a73; flex: none; }
.rp-pb-track { flex: 1; height: 7px; background: #eef0f3; border-radius: 4px; overflow: hidden; }
.rp-pb-track i { display: block; height: 100%; background: #5b8def; border-radius: 4px; }
.rp-pb-v { width: 40px; text-align: right; font-size: 10.5px; color: #646a73; flex: none; }

.rp-pop-sum { margin: 9px 0 0; padding-left: 16px; }
.rp-pop-sum li { font-size: 11.5px; line-height: 1.6; color: #1f2329; margin-bottom: 2px; }

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
