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
  ④ **视觉分段**（v1.13.405）：六节大标题（一、二、三…）用灰底标题条，业主 2026-11-23
     反馈「全是文字看起来不是很清楚」。灰底的色值被导出工具的切页扫描判据约束住，
     改浅会让 PDF 把标题条切成两半 ⇒ 动之前先读样式里 `.bf-sec-hd` 的三条约束。

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
          设置分析半径
          <!--
            v1.13.411：由「本次分析半径」改名「设置分析半径」，并支持**手动输入**。
            🔴 用法：点开下拉直接敲公里数（`2` / `1.5` / `2km`）回车即用；
               也认米（`800m`）；超出 0.35~5km 会提示并回退到上一个有效半径。
            🔴 刻意用 `:model-value` + `@change` 而不是 `v-model`：
               `allow-create` 会把用户敲的字**原样**当成值（字符串 `'2'`）→ 直接当米用就成了 2 米。
               这里接住 change、解析成米、再回写 ⇒ 模型里永远是数字（米）。
            🔴 `:key="radiusKey"`：`allow-create` 会把临时输入项留在下拉里（`2` 与 `2km` 并存），
               改完 key 强制重建一次下拉，列表只留我们认可的那几档。
          -->
          <el-select
            :key="radiusKey"
            :model-value="radius"
            size="small"
            class="bf-radius-sel"
            :disabled="loading"
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            placeholder="输入公里数"
            aria-label="设置分析半径"
            @change="onRadiusChange"
          >
            <el-option v-for="r in radiusOptions" :key="r" :value="r" :label="radiusText(r)" />
          </el-select>
        </span>
        <el-button :loading="loading" @click="load">重新分析</el-button>
        <el-button type="primary" :loading="exporting" :disabled="!brief" @click="exportPdf">下载 PDF</el-button>
      </div>
    </div>
    <!-- 🔴 v1.13.386：原句尾「（要改请点「编辑信息」）」已删 —— 门店来源的点位不再有那个按钮，
         留着就是把用户指向一个不存在的入口。这里只说「不写回」，不指路。 -->
    <p class="bf-bar-note">换半径（含手动输入 0.35~5 公里）只改这份报告的口径，不会写回点位的评估半径。</p>

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

        <!--
          多半径对比（v1.13.403）
          业主 2026-11-23 拍板：形态 A（保留完整报告，顶部加这张表）、只比联通能买到的
          三档 1/3/5km、表要进 PDF。
          🔴 三列的数字**全部由后端一次请求算出来**（`compare.rows`），前端只负责摆：
             ⛔ 不许在前端自己按半径算人口/竞品 —— 那会和正文的六节变成两套算法。
          🔴 放在 `.bf-paper` 里面 ⇒ 导出 PDF 自动带上（`exportPaperPdf(paper)` 截的是纸面 DOM）。
          🔴 **脚注分工**（v1.13.406）：这张表的脚注只说「免费估算 + 0 消耗 + 口径限制」，
             计费口径（一档一次、换档另买、同半径才复用）统一说在第六节「成本」行 ——
             同一件事在两张纸各写一遍，读者会当成互相矛盾。
        -->
        <div v-if="compareRows.length > 1" class="bf-sec bf-cmp">
          <div class="bf-sec-hd">
            <h2>多半径对比</h2>
            <span class="bf-sec-note">同一圆心各算一次 · 点半径可切换主报告</span>
          </div>

          <table class="bf-cmp-t">
            <thead>
              <tr>
                <th scope="col" class="bf-cmp-k">指标</th>
                <th
                  v-for="r in compareRows"
                  :key="r.radiusM"
                  scope="col"
                  :class="{ 'is-main': r.isMain }"
                >
                  <button
                    type="button"
                    class="bf-cmp-go"
                    :disabled="loading"
                    :aria-current="r.isMain ? 'true' : undefined"
                    :aria-label="r.isMain ? `当前按 ${radiusText(r.radiusM)} 分析` : `切换到 ${radiusText(r.radiusM)} 重新分析`"
                    @click="switchRadius(r)"
                  >{{ radiusText(r.radiusM) }}</button>
                  <span v-if="r.isMain" class="bf-cmp-cur">本次</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">半径内常住人口</th>
                <td v-for="r in compareRows" :key="r.radiusM" :class="{ 'is-main': r.isMain }">
                  <template v-if="r.population.covered">
                    {{ fmtNum(r.population.circlePop) }} 人
                    <em v-if="popRatio(r)" class="bf-cmp-x">{{ popRatio(r) }}</em>
                  </template>
                  <span v-else class="bf-cmp-na">未评</span>
                </td>
              </tr>
              <tr>
                <th scope="row">人口密度</th>
                <td v-for="r in compareRows" :key="r.radiusM" :class="{ 'is-main': r.isMain }">
                  <template v-if="r.population.covered && r.population.density !== null">
                    {{ fmtNum(r.population.density) }} 人/km²
                    <span v-if="r.population.level" class="bf-chip" :class="'lv-' + r.population.level.key">
                      {{ r.population.level.label }}
                    </span>
                  </template>
                  <span v-else class="bf-cmp-na">未评</span>
                </td>
              </tr>
              <tr>
                <th scope="row">半径内竞品</th>
                <td v-for="r in compareRows" :key="r.radiusM" :class="{ 'is-main': r.isMain }">
                  <template v-if="r.competition.count !== null">
                    {{ r.competition.count }} 家
                    <span v-if="r.competition.level" class="bf-cmp-lv">{{ r.competition.level.label }}</span>
                  </template>
                  <span v-else class="bf-cmp-na">未评</span>
                </td>
              </tr>
              <tr>
                <th scope="row">判定结论</th>
                <td v-for="r in compareRows" :key="r.radiusM" :class="{ 'is-main': r.isMain }">
                  <span v-if="r.verdict" class="bf-cmp-tag" :class="'is-' + r.verdict.level">
                    {{ verdictTagOf(r.verdict.level) }}
                  </span>
                  <span v-else class="bf-cmp-na">—</span>
                </td>
              </tr>
              <tr>
                <th scope="row">购买状态</th>
                <td v-for="r in compareRows" :key="r.radiusM" :class="{ 'is-main': r.isMain }">
                  <!-- v1.13.407：删掉「联通无此档，按 X 取」——
                       门店弹窗本来就支持任意半径（v1.13.409 起 0.35~5km）（默认 0.5/1/1.5/2km），
                       500m / 1.5km / 800m 都能原样买。那半句是「报告替用户取整」时代的说法，
                       前提没了就得撤掉，否则表格在说一件不会发生的事。 -->
                  <span v-if="r.purchased" class="bf-cmp-own">已购 · 可复用</span>
                  <span v-else class="bf-cmp-na">未购</span>
                </td>
              </tr>
            </tbody>
          </table>

          <p v-if="verdictShift" class="bf-cmp-flip">
            ⚠ 结论随半径变化：本次「{{ verdictTagOf(mainCompare?.verdict?.level) }}」，
            {{ verdictShift }} —— 这个点位对半径敏感，取数前先定下该按哪个圆判断。
          </p>
          <!-- v1.13.406（业主 2026-11-23 拍板 A）：脚注**只讲估算与 0 消耗**。
               ⛔ 别再把「各档各买一次 / 消耗配额」写回这里 —— 那是第六节「成本」行的活。
               上一版两句挨着写（「各消耗 1 次配额」+「本次分析 0 消耗」），主语不同却挤在
               同一段，业主第一反应就是「到底花不花钱」；而且「三档都是…」写死了列数，
               主半径是 500/1500 时表会变 4 列、旁边那格明写「联通无此档」，自相矛盾。 -->
          <p class="bf-cmp-foot">
            同一圆心各档的免费估算，用来看该按哪个圆向联通取数。
            人口按圆内网格加权，圆超出本市网格范围的部分不计（该档人口会偏低）。
            数据来自站内本地 1km 网格 + 竞品库，本次分析 0 消耗。
          </p>
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
                一次取数 {{ brief.upgrade.quotaPerFetch }} 次配额，
                <b>一档一次、换档另买</b>（5km 不顶 3km）；
                同一位置<b>同半径</b>买过的自动复用，不重复扣费
              </dd>
            </div>
          </dl>
          <!-- v1.13.380：同位置买过**别的**半径时，明说「复用要同半径、本次要另买」。
               没有这句时，用户刚为该点位花过钱，会把「尚未购买」读成重复扣费（P3 实测）。 -->
          <p v-if="brief.upgrade.reuseHint" class="bf-reuse">{{ brief.upgrade.reuseHint }}</p>
          <p class="bf-gap">
            ⚠ 本报告没有购买联通人口 —— 所有数字都是站内免费数据。
            纸张下方的操作区会打开联通人口查询，取数前会明示「消耗几次 / 剩余几次」。
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
import { radiusText, parseRadiusInput, CUSTOM_RADIUS_MIN_M, CUSTOM_RADIUS_MAX_M } from '@/utils/candidateReport.js'
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
// 多半径对比（v1.13.403）：整块由后端一次算好，前端只摆（⛔ 不在前端自己按半径算）
const compare = ref(null)
const consts = ref(null)
const generatedAt = ref(null)
const paper = ref(null)

/**
 * 可选分析半径（v1.13.402 起补 5km）。
 *
 * 前三档与「智能选址」同源（`SITE_RADIUS_CHOICES`），同一点位在两处的圆必须一样大。
 * 5km 是**后加的**：它等于联通 1001 的**最大档**（`UNICOM_REPORT_RADII` 上界），
 * 而立项报告的半径选项里本来就有 5000 ⇒ 初步分析不给 5km，就等于「能买的档买不到」，
 * 5km 的立项报告也就没法从初步分析直接生成。
 * ⚠️ 智能选址目前仍只有前四档 —— 那是另一个开销模型（网格估算，`MAX_GRIDS` 有限），
 *    要一起放开得单独评估，⛔ 别顺手改。
 */
const STANDARD_RADII = [500, 1000, 1500, 3000, 5000]
const radius = ref(Number(props.row?.radius) || 1000)

/**
 * 手动输入半径的允许区间与解析规则都在 `utils/candidateReport.js`
 * （纯函数 ⇒ 可被 `candidateBriefCustomRadius.test.js` 直接 import 断言，
 *   也能和后端 `UNICOM_RADIUS_RANGE_KM` 对账，⛔ 别在组件里再写一份）。
 *
 * 🔴 为什么卡在 0.35~5km 而不是后端 `/brief` 的 100m~50km：
 *    · 上界 5km ＝ 联通 1001 最大档。报告圆再大，升级也只能按 5km 取数
 *      （`pickUnicomRadius` 的 `covers:false` 分支就会写「范围小于本报告、人口会偏少」）
 *      ⇒ 纸上摆一个买不到证据的圆，纯属自找解释成本。
 *    · 下界 0.35km ＝ 门店弹窗可买下限（409 起四处同源）；再小的圆算得出、买不到。
 */

/** 用户手动输入过、且校验通过的半径（米）。会并进下拉，方便下次直接选 */
const customRadii = ref([])
/** 下拉重建计数：见模板里 `:key="radiusKey"` 的说明（清掉 allow-create 的临时项） */
const radiusKey = ref(0)

/**
 * 下拉里显示哪些档：固定档 ∪ 点位自带半径 ∪ 手动输入过的值，升序去重。
 * ⚠️ 固定档必须来自 `STANDARD_RADII`（守卫 `candidateBriefRadius.test.js` 解析这一行），
 *    ⛔ 别把 `customRadii` 混进那个字面量数组，否则「最大档＝联通最大档」的断言会失效。
 */
const radiusOptions = computed(() => {
  const base = Number(props.row?.radius) || 1000
  const all = [...STANDARD_RADII, base, ...customRadii.value]
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
  return [...new Set(all)].sort((a, b) => a - b)
})

/**
 * 下拉变更（选档 或 手动输入）。
 *
 * 🔴 必须区分来源：`allow-create` 让用户敲的字以**字符串**形式进来（`'2'`），
 *    而选项是数字（`2000`）。只看 `typeof` 就能分辨，⛔ 别用"有没有小数点"之类的猜法。
 * 🔴 无效输入**必须回退**：`el-select` 内部已把显示值改成了用户敲的字，
 *    此时只提示不回写，框里会留着一个不存在的半径（看着像选中了，其实没生效）。
 */
function onRadiusChange(v) {
  const typed = typeof v === 'string'
  const prev = radius.value
  const next = typed ? parseRadiusInput(v) : Number(v)

  if (!Number.isFinite(next) || next <= 0) {
    ElMessage.warning('没看懂这个半径，请输入公里数，如 2 或 1.5（0.35~5）')
  } else if (next < CUSTOM_RADIUS_MIN_M || next > CUSTOM_RADIUS_MAX_M) {
    // 「填 2000 想要 2000 米」是最常见的误填 ⇒ 单独给一句更对症的话，⛔ 别只说"越界"。
    // ⚠️ 判据要用**用户敲的原始数字**（不是 `next`）：`next` 已经 ×1000 成米，
    //    2,000,000m 永远 >50000，拿它判「像米数」恒为 false（本批第一版就这么漏了）。
    const rawNum = typed ? Number(String(v).replace(/[^\d.]/g, '')) : NaN
    const looksLikeMeters = Number.isFinite(rawNum)
      && rawNum >= CUSTOM_RADIUS_MIN_M && rawNum <= CUSTOM_RADIUS_MAX_M
    ElMessage.warning(
      looksLikeMeters
        ? `这里按「公里」算：${rawNum} 公里超出可买区间。要 ${rawNum} 米请输入 ${rawNum}m`
        : `半径需在 ${CUSTOM_RADIUS_MIN_M / 1000}~${CUSTOM_RADIUS_MAX_M / 1000} 公里之间` +
          '（超出这个区间的圆，联通买不到数据）'
    )
  } else {
    radius.value = next
    if (typed && !radiusOptions.value.includes(next)) customRadii.value = [...customRadii.value, next]
  }

  // 无论成败都重建下拉：成功是清掉临时的字符串项，失败是清掉用户敲的无效项
  radiusKey.value += 1

  // 半径确实变了才重新取数（`/brief` 每次都要解析整城网格，重庆约 1.5s）
  if (radius.value !== prev) load()
}

/** 三档结论的统一措辞（正文结论区与对比表必须用同一套词，⛔ 各写一份） */
function verdictTagOf(level) {
  return level === 'go' ? '值得深入' : level === 'hold' ? '不建议深入' : level === 'watch' ? '需核验' : '—'
}

const verdictTag = computed(() => verdictTagOf(brief.value?.verdict?.level))

// ── 多半径对比（v1.13.403）──────────────────────────────────────────────
const compareRows = computed(() => compare.value?.rows || [])
const mainCompare = computed(() => compareRows.value.find((r) => r.isMain) || null)

/** 切换主报告到某一档（表头点击）。已在该档就什么都不做，⛔ 别白跑一次请求 */
function switchRadius(r) {
  const target = Number(r?.radiusM)
  if (!Number.isFinite(target) || loading.value) return
  if (Number(radius.value) === target) return
  radius.value = target
  load()
}

/**
 * 相对本次半径的人口倍数（「放大到 3km 人口 ×3.2」比单看两个绝对值有用）。
 * 🔴 只在**两档都有有效人口**时给；差 5% 以内不给（否则会出现「×1.0」这种废话）。
 */
function popRatio(r) {
  const base = Number(mainCompare.value?.population?.circlePop)
  const v = Number(r?.population?.circlePop)
  if (r?.isMain) return ''
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(v) || v <= 0) return ''
  const k = v / base
  if (k >= 0.95 && k <= 1.05) return ''
  if (k > 1) return `×${k >= 10 ? k.toFixed(0) : k.toFixed(1)}`
  return `÷${(1 / k).toFixed(1)}`
}

/** 哪几档的结论与本次不同 —— 差异本身就是结论，必须写出来，⛔ 不许让读者自己对表 */
const verdictShift = computed(() => {
  const main = mainCompare.value
  if (!main?.verdict) return ''
  const diff = compareRows.value.filter(
    (r) => !r.isMain && r.verdict && r.verdict.level !== main.verdict.level
  )
  if (!diff.length) return ''
  return diff.map((r) => `${radiusText(r.radiusM)} 为「${verdictTagOf(r.verdict.level)}」`).join('、')
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
    // 多半径对比（后端在同一个请求里算完，⛔ 不要前端再发两次请求：
    // /brief 每次都重建全城网格索引，重庆一次就要 1.5s）
    compare.value = data.compare || null
    consts.value = data.consts || null
    generatedAt.value = data.generatedAt
  } catch (e) {
    brief.value = null
    compare.value = null
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
/* 132px 是量出来的：EP 下拉项左右 padding 共 52px，`1.5km` / `手动输入` 这类 5 字标签
   需要 ≥108px ⇒ 再留 24px 余量。⛔ 别压回 104px（选项文字会被截成「1.5…」） */
.bf-radius-sel { width: 132px; }
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

/* ── 多半径对比（v1.13.403）───────────────────────────────────────────────
   🔴 导出 PDF 走 html2canvas 截 DOM ⇒ 表格线必须是**真实 border**，
      ⛔ 不能用伪元素画（391 的比例条踩过：屏幕上有、PDF 里消失）。 */
.bf-cmp-t {
  width: 100%; border-collapse: collapse; margin-top: 2px;
  font-size: 12.5px; table-layout: fixed;
}
.bf-cmp-t th, .bf-cmp-t td {
  border-bottom: 1px solid #e6e8eb; padding: 7px 8px;
  text-align: left; vertical-align: middle; word-break: break-word;
}
.bf-cmp-t thead th { border-bottom: 1px solid #c9ced6; padding-bottom: 5px; }
.bf-cmp-t tbody th { width: 118px; font-weight: 400; color: var(--text-regular, #606266); }
.bf-cmp-k { width: 118px; font-weight: 400; color: #8a9099; font-size: 12px; }
/* 当前半径那一列淡蓝底（不是高亮全部，只标「你正在看的圆」） */
.bf-cmp-t .is-main { background: #f2f7ff; }
.bf-cmp-go {
  border: 0; background: transparent; padding: 0; cursor: pointer;
  font: inherit; font-size: 13px; font-weight: 500; color: #2563eb;
}
.bf-cmp-go:disabled { color: #1f2329; cursor: default; }
.bf-cmp-cur {
  margin-left: 3px; font-size: 10.5px; color: #2563eb;
  background: #eaf0fd; border-radius: 3px; padding: 0 4px; vertical-align: 1px;
}
.bf-cmp-x { font-style: normal; margin-left: 4px; color: #8a9099; }
.bf-cmp-lv { margin-left: 4px; font-size: 11.5px; color: #8a9099; }
.bf-cmp-na { color: #8a9099; }
.bf-cmp-own { font-size: 11.5px; color: #16794a; background: #f1f9f5; border-radius: 3px; padding: 1px 5px; }
.bf-cmp-tag { font-size: 11px; padding: 1px 6px; border-radius: 3px; color: #fff; background: #8a9099; }
.bf-cmp-tag.is-go { background: #16794a; }
.bf-cmp-tag.is-watch { background: #b26a00; }
.bf-cmp-tag.is-hold { background: #c0392b; }
.bf-cmp-flip {
  margin: 8px 0 0; padding: 6px 9px; font-size: 12px; line-height: 1.65;
  color: #7a5b1e; background: #fff8e6; border: 1px solid #e8c07d; border-radius: 5px;
}
.bf-cmp-foot { margin: 7px 0 0; font-size: 11.5px; line-height: 1.7; color: #8a9099; }
.bf-cmp-foot b { color: var(--text-regular); font-weight: 500; }

/* 🔴 纵向预算（v1.13.405 实测，v1.13.407 再压一次）：
   导出 PDF 的「能缩到 ≥72% 就塞进一页」是按**纸面总高**算的 —— A4 可用高 285mm
   ÷ 0.72 = 395.8mm，而 794px 宽纸面 1px = 0.26455mm ⇒ **纸面高必须 ≤ 1496px** 才是一页。
   405 第一版只加 padding（1455→1531）就越过 1496，导出变「一张正文 + 一张纯白 40px 尾页」，
   所以灰条的高度是拿「节间距」换来的：`.bf-sec` 14→10px。
   407 把「取数口径」改成通用句后纸面涨到 **1495（零余量）** ⇒ 10→7px，回到 1477。
   **再加 padding / 加长文案前先量纸面高，否则业主会多收到一张白纸。** */
.bf-sec { margin-top: 7px; }
/* 节标题条（v1.13.405）：六节大标题「一、二、三…」加灰底 + 左侧竖条 ——
   初版六节只有 14px 间距、全是正文，客户翻到底部找不回「这是第几节」。
   🔴 三条硬约束，改之前先读：
     ① 只用真实 background / border，⛔ 不用伪元素（导出 PDF 走 html2canvas，伪元素会整个丢掉）
     ② 灰底取 #e8eaed，⛔ 别换成更浅的 #f2f3f5 / #eef0f3：导出工具的 findCutY 把
        「RGB 三通道都 >236」的像素行当成空白行去切页，#f2f3f5(242,243,245) 正好命中 ⇒
        万一切在标题条中间，PDF 上就是一条被劈开的灰线。#e8eaed(232,234,237) 判不成空白行。
     ③ 左右各外扩 10px（负 margin）、padding-left 7px 抵掉 3px 边框 ⇒ 标题文字仍与正文
        左边缘对齐（34-10+3+7=34），条宽比内容宽 20px 但不会撑破纸张，也不会挤窄文字区。
   对比度实算：标题 #1f2329 on #e8eaed = 13.09:1；说明文字见下一条。 */
.bf-sec-hd {
  display: flex; align-items: baseline; gap: 10px;
  margin: 0 -10px 6px; padding: 4px 10px 4px 7px;
  background: #e8eaed; border-left: 3px solid #8a9099; border-radius: 0 4px 4px 0;
}
.bf-sec-hd h2 { margin: 0; font-size: 14px; font-weight: 600; color: #1f2329; }
/* 原来的 #8a9099 在灰底上只有 2.67:1（连 AA 的 4.5 都不到）⇒ 加深到 #646a73（灰底 4.52 / 白底 5.45） */
.bf-sec-note { font-size: 11.5px; color: #646a73; }

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
/* v1.13.380：同位置买过别的半径 ⇒ 紧贴在成本说明下方，用警示色避免被当成普通脚注 */
.bf-reuse { margin: 8px 0 0; padding: 6px 10px; border-left: 3px solid #e6a23c; background: #fff8e6;
  border-radius: 4px; font-size: 11.5px; line-height: 1.65; color: #8a5a00; }
.bf-risks { margin: 0; padding-left: 18px; }
.bf-risks li { font-size: 12.5px; line-height: 1.6; margin-bottom: 3px; color: #1f2329; }

.bf-foot { margin-top: 14px; padding-top: 9px; border-top: 1px solid #dcdfe6; }
.bf-foot-t { font-size: 11px; font-weight: 600; margin-bottom: 4px; }
.bf-foot-r { font-size: 10px; color: #646a73; line-height: 1.6; }
.bf-foot-r b { display: inline-block; width: 56px; color: #1f2329; }
.bf-foot-x { margin-top: 6px; font-size: 9.5px; color: #a0a5ad; line-height: 1.5; }
</style>
