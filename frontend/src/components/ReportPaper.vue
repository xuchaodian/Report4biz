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

    <!-- 人口数据（点位 + 半径圆，联通人口）：**不依赖商圈面**（v1.13.342 解耦）。
         🔴 v1.13.418：纸面是给业主/领导看的，⛔ 不出现联通服务码（1001 / 1013 之类）——
            码是内部计费标识，读者看到只会问"1001 是什么"。
         ⛔ 这个块不能包在 v-if="model.district" 里：城市没有商圈面数据时，
         买了联通人口也必须能在纸面看到。用 .rp-sec 起头 ⇒ 自动纳入安全切页点。 -->
    <div class="rp-sec rp-pop">
      <div class="rp-sec-hd">
        <h2>人口数据（点位半径）</h2>
        <span class="rp-sec-note">
          联通人口 · 半径 {{ radiusText(model.population.popRadius) }} 内
          <template v-if="model.population.popMonth"> · 期次 {{ model.population.popMonth }}</template>
          <template v-if="role.label"> · {{ role.label }}</template>
        </span>
      </div>
      <template v-if="model.population.hasPop">
        <!-- 量级四项。⚠️ 到访是**人次**（统计期累计），⛔ 与另三项不同量纲、不可相加 -->
        <!-- 角色说明（417）：这一档按业主口径「小半径看动线、大半径看静态」，先把"这档该看什么"讲清楚 -->
        <div v-if="role.label" class="rp-role">
          <b>{{ role.label }}</b>
          <span class="rp-role-focus">{{ role.focus }}口径</span>
          <span class="rp-role-hint">{{ role.hint }}</span>
          <span v-if="role.basis" class="rp-role-basis">判定依据：{{ role.basis }}</span>
        </div>
        <!-- 量级四项：动线档把「到访」提到首位，静态档按居住/工作/到访/全量排 -->
        <div class="rp-kv rp-kv-4">
          <div v-for="it in magnitudeItems" :key="it.key"><dt>{{ it.label }}</dt><dd>{{ it.value }}</dd></div>
        </div>

        <!-- 选址研判指标：把 1001 的 76 个标签浓缩成 8~9 行（v1.13.400）。
             🔴 业主 2026-11-22 定：逐档明细（15 档年龄 / 6 档话费）在「购买履历」里看得全，
                报告里再画 44 行比例条只是把纸拉长一页半，对"要不要拿这个点"没有增量信息。
             ⛔ 不要按"387 画过"就加回来：387 的全量分档已被本批取代。
             ⚠️ indicators 为空（旧快照 / 1001 只有总量）时整块不渲染，只留上面 4 栏量级。 -->
        <div v-if="indicators.length" class="rp-pop-blk">
          <div class="rp-pop-t">
            选址研判指标
            <span class="rp-pop-tx">（{{ indicators.length }} 项摘要 · 联通人口共 {{ labelTotal }} 项标签<template v-if="detailHint">，{{ detailHint }}</template>）</span>
          </div>
          <table class="rp-ind">
            <thead>
              <tr><th>指标</th><th>数值</th><th>判读</th></tr>
            </thead>
            <tbody>
              <tr v-for="it in indicatorsMain" :key="it.key">
                <th>{{ it.label }}</th>
                <td class="rp-ind-v">{{ it.value }}</td>
                <td class="rp-ind-n">{{ it.note }}</td>
              </tr>
            </tbody>
          </table>
          <!-- 副组：另一口径的指标压成一行，说明「这些也有，但不是这一档该看的重点」 -->
          <p v-if="sideText" class="rp-ind-side">
            另见（{{ role.view === 'visit' ? '静态' : '流动' }}口径，仅作参考）：{{ sideText }}
          </p>
        </div>

        <!-- 居民画像（417）：消费水平/消费力/教育/职业/人生阶段/收入资产/月驻留频次。
             ⛔ 只买了 1001 的位置没有这些码 ⇒ profileRows 为空，整块不渲染（不拿话费冒充收入）。 -->
        <div v-if="profileRows.length" class="rp-pop-blk">
          <div class="rp-pop-t">
            居民画像
            <span class="rp-pop-tx">（{{ profileScope }}口径 · 来自已购画像数据）</span>
          </div>
          <table class="rp-ind">
            <thead>
              <tr><th>维度</th><th>数值</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr v-for="(p, i) in profileRows" :key="i">
                <th>{{ p.label }}</th>
                <td class="rp-ind-v">{{ p.value }}</td>
                <td class="rp-ind-n">{{ p.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <div v-else class="rp-pop-empty">
        <b>尚未获取联通人口数据</b>
        <span>人口规模、职住结构、年龄与消费档位均无法计算。请先到「初步分析」按点位半径购买联通人口（按次配额）—— 同一位置同一半径买过的档会自动复用、不重复扣费。</span>
      </div>
    </div>

    <!-- 多档半径对比（v1.13.413）
         🔴 数据全部来自该位置**已购**的联通人口档位（`GET /api/candidates/purchased-population`），
            ⛔ 不是按 1/3/5km 现取的 —— 用户买过 1.5km 就只会有 1.5km 这一列。
         🔴 只比「人口类」指标：竞品数 / 商圈评分是**商圈面**口径（面数据没法按圆重算），
            摆进这张按半径排的表里，读者会以为换半径它们也会跟着变 ⇒ 与正文自相矛盾。
         🔴 密度用同一份联通人口算（`live ÷ 圆面积`），⛔ 不掺本地 1km 网格的常住人口。
         ⚠️ `.rp-sec` 起头 ⇒ 自动成为 PDF 的安全切页点，⛔ 别塞进上面的人口块里。 -->
    <div v-if="tiers.has" class="rp-sec">
      <div class="rp-sec-hd">
        <h2>多档半径对比</h2>
        <span class="rp-sec-note">已购 {{ tiers.count }} 档 · 每列按自己那档半径单独取数（联通人口）</span>
      </div>
      <table class="rp-tiers">
        <thead>
          <tr>
            <th>半径</th>
            <th>角色</th>
            <th>居住人口</th>
            <th>工作人口</th>
            <th>职住比</th>
            <th>到访人次</th>
            <th>人口密度</th>
            <th>期次</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in tiers.rows" :key="r.radius" :class="{ 'is-main': r.isMain }">
            <th>
              {{ r.radiusText }}
              <span v-if="r.isMain" class="rp-tiers-main">主档</span>
            </th>
            <td class="rp-tiers-role">{{ r.roleLabel || '—' }}</td>
            <td>{{ withUnit(r.live, ' 人') }}</td>
            <td>{{ withUnit(r.work, ' 人') }}</td>
            <td>{{ ratioText(r.workLiveRatio) }}</td>
            <td>{{ withUnit(r.visit, ' 人次') }}</td>
            <td>{{ withUnit(r.density, ' 人/km²') }}</td>
            <td class="rp-tiers-m">{{ r.popMonth || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="tiers.note" class="rp-tiers-compare">{{ tiers.note }}</p>
      <p v-for="(s, i) in tiers.summary" :key="i" class="rp-tiers-sum">{{ s }}</p>
      <p class="rp-tiers-note">
        人口密度＝该档圆内居住人口 ÷ 圆面积，与上方「居住人口」同源（不是本地 1km 网格口径）。
        职住比＝工作人口 ÷ 居住人口；到访是「人次」（统计期累计），不与人数通约。
      </p>
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
import { fmtM, radiusText, POP_LABEL_TOTAL } from '@/utils/candidateReport.js'

const props = defineProps({
  /** buildReportModel() 的输出（或快照里还原出来的同结构对象） */
  model: { type: Object, required: true },
  /** 位置示意图 dataURL；快照页从后端拿，应用内由 mapCapture 现画 */
  mapImg: { type: String, default: '' },
  /** AI 建议正文（可空） */
  aiText: { type: String, default: '' },
  /** 生成人显示名 */
  authorName: { type: String, default: '' },
  /**
   * 「明细在哪看」的补充说明（v1.13.400）。
   * ⚠️ **只能由调用方决定**：应用内弹窗传「完整清单见购买履历」；
   *    免登录分享页必须传空 —— 访客没有账号、打不开购买履历，
   *    纸上写「见购买履历」等于承诺一件他做不到的事。
   */
  detailHint: { type: String, default: '' }
})

/** 选址研判指标（8~9 行摘要）；旧快照里没有这个字段 ⇒ 空数组，整块不渲染 */
const indicators = computed(() => {
  const list = props.model?.population?.indicators
  return Array.isArray(list) ? list : []
})

/**
 * 该档角色（v1.13.417）：近场动线 / 步行客群 / 片区基本盘。
 * ⚠️ 旧快照（417 之前分享/下载的）没有这些字段 ⇒ 全部兜底成空，纸面按「未标注角色」渲染，
 *    ⛔ 不能因为缺字段就整块不渲染（人口数据本身还在）。
 */
const role = computed(() => {
  const p = props.model?.population || {}
  return {
    key: p.role || '',
    label: p.roleLabel || '',
    hint: p.roleHint || '',
    basis: p.roleBasis || '',
    focus: p.roleFocus || '',
    view: p.role === 'flow' || p.role === 'near' ? 'visit' : 'live'
  }
})

/**
 * 研判指标按角色分组：主组（该角色该看的）展全表，副组压成一行文字。
 * 动线档 ⇒ 流动类展开；静态档 ⇒ 静态类展开。
 * 🔴 为什么不让 9 行全展开：小半径档的"家庭客群/居住性别比"其实是从很小的基数算的，
 *    摆一整张表会让人以为那几行和小半径同样可信 —— 那正是业主说的"要按半径语义侧重"。
 */
const indicatorsMain = computed(() => {
  const want = role.value.view === 'visit' ? 'flow' : 'static'
  const main = indicators.value.filter((it) => (it.cat || 'static') === want)
  // 旧快照没有 cat ⇒ 全归 static；若主组为空则退回全量，避免整块消失
  return main.length ? main : indicators.value
})
const indicatorsSide = computed(() => {
  const mainKeys = new Set(indicatorsMain.value.map((it) => it.key))
  return indicators.value.filter((it) => !mainKeys.has(it.key))
})
const sideText = computed(() =>
  indicatorsSide.value.map((it) => `${it.label} ${it.value}`).join(' · ')
)

/** 居民画像（1009/1010/1011/1012/1013/1015）—— 没买这些码时为 null ⇒ 整块不渲染 */
const profileRows = computed(() => {
  const p = props.model?.population?.profile
  if (!p || typeof p !== 'object') return []
  const pct = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—'
  }
  const rows = []
  const sl = p.spendLevel
  if (sl && sl.total > 0) {
    rows.push({
      label: '消费水平',
      value: `高 ${pct(sl.high)} · 中 ${pct(sl.mid)} · 低 ${pct(sl.low)}`,
      note: '联通消费水平三档，占比按该口径可分档人口计'
    })
  }
  if (p.spendIndex && Number.isFinite(Number(p.spendIndex.avg))) {
    rows.push({
      label: '消费力指数',
      value: `${Number(p.spendIndex.avg).toFixed(1)} / 8`,
      note: '1~8 档加权均值，越高消费力越强；与上面的高中低三档是两套口径'
    })
  }
  if (p.education && p.education.total > 0 && p.education.bachelorPlusPct !== null) {
    rows.push({
      label: '教育',
      value: `本科及以上 ${pct(p.education.bachelorPlusPct)}`,
      note: '本科 + 硕士 + 博士 占可分档人口'
    })
  }
  if (p.occupation && p.occupation.top && p.occupation.top.length) {
    rows.push({
      label: '职业',
      value: p.occupation.top.map((x) => `${x.label} ${pct(x.pct)}`).join(' · '),
      note: '占比最高的前 3 类职业'
    })
  }
  if (p.lifeStage && p.lifeStage.total > 0 && p.lifeStage.marriedWithKidsPct !== null) {
    rows.push({
      label: '人生阶段',
      value: `已婚已育 ${pct(p.lifeStage.marriedWithKidsPct)}`,
      note: '家庭型客群占比，与「家庭客群占比」互为正交参考'
    })
  }
  if (p.income && p.income.total > 0 && p.income.highPlusPct !== null) {
    rows.push({
      label: '收入预测',
      value: `高 + 中高 ${pct(p.income.highPlusPct)}`,
      note: '联通收入预测概率档，⚠️ 是模型概率档不是实际收入金额'
    })
  }
  const assets = []
  if (p.car && p.car.highPlusPct !== null) assets.push(`有车（高+中高）${pct(p.car.highPlusPct)}`)
  if (p.house && p.house.highPlusPct !== null) assets.push(`有房（高+中高）${pct(p.house.highPlusPct)}`)
  if (assets.length) {
    rows.push({ label: '资产预测', value: assets.join(' · '), note: '同为概率档，只作量级参考' })
  }
  const reach = props.model?.population?.reach
  if (reach && reach.total > 0 && reach.heavyPct !== null) {
    rows.push({
      label: '月驻留频次',
      value: `月到访 5 次以上 ${pct(reach.heavyPct)}`,
      note: '高频回头客占比 —— 越高越说明这个点是「目的地」而不只是路过'
    })
  }
  return rows
})

/**
 * 量级四项的顺序（417）：动线档把「到访（人次）」提到首位 —— 那一档的主要问题是"多少人经过"，
 * 把居住人口放第一会让人误以为要看常住规模。静态档维持「居住/工作/到访/全量」。
 */
const magnitudeItems = computed(() => {
  const p = props.model?.population || {}
  const r = radiusText(p.popRadius)
  const items = [
    { key: 'live', label: `${r} 内居住`, value: num(p.population) },
    { key: 'work', label: `${r} 内工作`, value: num(p.work) },
    { key: 'visit', label: `${r} 内到访`, value: numVisit(p.visit) },
    { key: 'total', label: '联通全量人口', value: num(p.popTotal) }
  ]
  return role.value.view === 'visit' ? [items[2], items[0], items[1], items[3]] : items
})

/** 画像来源口径：动线档读到访、静态档读居住 */
const profileScope = computed(() => (role.value.view === 'visit' ? '到访人口' : '居住人口'))

/** 1001 标签总数（纸面用来声明「这里只是摘要」）；旧快照没这个字段 ⇒ 用常量兜底 */
const labelTotal = computed(() => Number(props.model?.population?.labelTotal) || POP_LABEL_TOTAL)

/**
 * 多档对比表（v1.13.413）。
 * ⚠️ 旧快照（413 之前分享出去的）里没有 `model.tiers` ⇒ 必须兜底成 `has:false`，
 *    否则老链接一打开就报 `Cannot read properties of undefined`。
 */
const tiers = computed(() => {
  const t = props.model?.tiers
  const rows = Array.isArray(t?.rows) ? t.rows : []
  return {
    has: !!t?.has && rows.length >= 2,
    count: Number(t?.count) || rows.length,
    rows,
    /** 可比性说明（417）：绝对值随半径膨胀，只有密度/职住比/到访强度能横向比 */
    note: String(t?.note || ''),
    summary: Array.isArray(t?.summary) ? t.summary.filter(Boolean) : []
  }
})

/** 对比表里「有数就带单位、没数就 —」—— ⛔ 不写 0，「未评」和「这里是零」是两件事 */
function withUnit(v, unit) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN') + unit
}

/** 职住比两位小数；null 表示该档没有居住人口数据 */
function ratioText(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '—'
}

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

/* ── 选址研判指标（v1.13.400）────────────────────────────────────────
   取代 387 的双列比例条：1001 的逐档明细去「购买履历」看，纸面只留能直接
   拿来做判断的 8~9 行。三列＝指标 / 数值 / 判读，判读独占剩余宽度。
   ⚠️ PDF 走 html2canvas 截 DOM，所以表格必须是真实 border 而非伪元素。
   🔴 类名一律 `.rp-ind-*` 前缀：391 的教训是比例条最初叫 `.rp-bar`、
      与顶部工具条同名，把工具条布局挤坏了 —— 新块别再用通用名。 */
.rp-pop-blk { margin-top: 10px; }
.rp-pop-t { font-size: 12px; color: #646a73; margin-bottom: 6px; }
.rp-pop-tx { font-size: 10.5px; color: #a0a5ad; }

.rp-ind { width: 100%; border-collapse: collapse; }
.rp-ind th, .rp-ind td { font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f0f1f3; vertical-align: top; }
.rp-ind thead th { font-size: 10.5px; font-weight: 500; color: #8a9099; text-align: left; padding-bottom: 3px; }
.rp-ind tbody th { width: 92px; text-align: left; font-weight: 500; color: #1f2329; }
.rp-ind-v { width: 148px; font-weight: 600; color: #1f2329; }
.rp-ind-n { color: #646a73; line-height: 1.5; }

/* ── 多档半径对比（v1.13.413）────────────────────────────────────────
   与 `.rp-ind` 同款窄磅值表格，但列更多（7 列）⇒ 单独一组类名，
   ⛔ 不要复用 `.rp-ind-*`：那张表是三列布局（指标/数值/判读），
      宽度假设完全不同，混用会让某一列被挤成一字一行。 */
.rp-tiers { width: 100%; border-collapse: collapse; }
.rp-tiers th, .rp-tiers td { font-size: 11px; padding: 4px 6px; border-bottom: 1px solid #f0f1f3; text-align: right; vertical-align: top; }
.rp-tiers thead th { font-size: 10.5px; font-weight: 500; color: #8a9099; padding-bottom: 3px; }
/* 首列（半径）左对齐，其余数值列右对齐 —— 数字右对齐才看得出量级差 */
.rp-tiers thead th:first-child, .rp-tiers tbody th { text-align: left; }
.rp-tiers tbody th { font-weight: 600; color: #1f2329; white-space: nowrap; }
.rp-tiers tbody tr.is-main { background: #f4f8ff; }
.rp-tiers-main {
  display: inline-block; margin-left: 4px; padding: 0 5px;
  font-size: 9.5px; font-weight: 400; line-height: 15px; color: #fff;
  background: var(--brand-primary, #2563eb); border-radius: 3px;
}
.rp-tiers-m { color: #8a9099; font-variant-numeric: tabular-nums; }
.rp-tiers-sum { margin: 7px 0 0; font-size: 11.5px; line-height: 1.6; color: #1f2329; }
.rp-tiers-note { margin: 5px 0 0; font-size: 10px; line-height: 1.55; color: #8a9099; }
/* ── 档位角色 / 副组 / 可比性（v1.13.417）────────────────────────── */
.rp-role { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin: 2px 0 8px; font-size: 11px; line-height: 1.6; color: #333; }
.rp-role b { font-size: 12px; color: #1f2329; }
.rp-role-focus { padding: 1px 6px; border-radius: 3px; background: #eef4ff; color: #2563eb; font-size: 10.5px; }
.rp-role-hint { color: #4e5969; }
.rp-role-basis { width: 100%; font-size: 10px; color: #8a9099; }
.rp-ind-side { margin: 6px 0 0; font-size: 10px; line-height: 1.6; color: #8a9099; }
.rp-tiers-role { font-size: 10.5px; color: #4e5969; white-space: nowrap; }
.rp-tiers-compare { margin: 6px 0 0; padding: 5px 8px; background: #f7f8fa; border-left: 2px solid #c9cdd4; font-size: 10px; line-height: 1.6; color: #4e5969; }

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
