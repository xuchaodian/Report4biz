<template>
  <div class="sales-forecast-view">
    <!-- v1.13.209：VIP 功能门禁 —— 非 VIP 只渲染专属空态，且**不发起任何数据请求** -->
    <el-card v-if="!isVip" shadow="never" class="fc-card fc-locked-card">
      <div class="fc-locked">
        <div class="fc-locked-icon"><AppIcon size="xl" tone="muted"><Lock /></AppIcon></div>
        <div class="fc-locked-title">销售预测为 VIP 用户专属功能</div>
        <div class="fc-locked-desc">
          基于已开业门店的真实销售，按样本量自动升级预测引擎（L1 类比 → L2 回归 → L3 机器学习），
          预测候选门店的年销售额与置信区间，并模拟新店开业对周边门店的蚕食影响。
        </div>
        <div class="fc-locked-desc">
          普通用户可在「个人中心」提交申请，通过后可开通 30 天 VIP 试用。
        </div>
        <el-button type="warning" @click="$router.push('/account')">
          <AppIcon class="icon-text"><GoldMedal /></AppIcon>前往个人中心申请试用
        </el-button>
      </div>
    </el-card>

    <el-card v-else shadow="never" class="fc-card">
      <template #header>
        <div class="fc-header">
          <span><AppIcon class="icon-text"><TrendCharts /></AppIcon>销售预测</span>
          <span class="fc-sub">基于已开业门店真实销售，预测候选门店年销售额（引擎按样本量自动升级：L1 类比 → L2 回归 → L3 机器学习）</span>
        </div>
      </template>

      <!-- 样本量提示条 -->
      <el-alert v-if="stats && stats.samples < stats.l2" type="info" :closable="false" style="margin-bottom: 12px;">
        <template #title>
          <AppIcon class="icon-text"><DataAnalysis /></AppIcon>当前销售样本 {{ stats.samples }} 行（已开业店 {{ stats.stores }} 家）——距离 <b>L2 回归</b>（{{ stats.l2 }} 行）还差 <b>{{ stats.l2Gap }}</b> 行，录满后自动升级（预测更准）
          <div class="fc-guide-links">
            <el-button size="small" type="primary" link @click="goSale">去录入销售<AppIcon style="margin-left:2px;"><ArrowRight /></AppIcon></el-button>
            <el-button size="small" type="primary" link @click="downloadSales">下载模板</el-button>
            <el-button size="small" type="primary" link @click="openGuide()">字段说明</el-button>
          </div>
        </template>
      </el-alert>
      <el-alert v-else-if="stats && stats.samples >= stats.l2 && stats.samples < stats.l3" type="success" :closable="false" style="margin-bottom: 12px;">
        <template #title>
          <AppIcon class="icon-text"><CircleCheck /></AppIcon>L2 回归已启用（{{ stats.samples }} 行样本）——距离 <b>L3 机器学习</b>（{{ stats.l3 }} 行）还差 {{ stats.l3Gap }} 行，持续录入可解锁开店影响模拟
          <div class="fc-guide-links">
            <el-button size="small" type="primary" link @click="goSale">去录入销售<AppIcon style="margin-left:2px;"><ArrowRight /></AppIcon></el-button>
            <el-button size="small" type="primary" link @click="downloadSales">下载模板</el-button>
            <el-button size="small" type="primary" link @click="openGuide()">字段说明</el-button>
          </div>
        </template>
      </el-alert>

      <el-alert v-if="stats && stats.bandSamples > 0" type="warning" :closable="false" style="margin-bottom: 12px;">
        <template #title>
          <AppIcon class="icon-text"><WarningFilled /></AppIcon>其中 <b>{{ stats.bandSamples }}</b> 行是「档位估值」（只填了金额区间，系统按区间中点参与测算）——预测误差范围会比纯精确样本更大
        </template>
      </el-alert>

      <!-- v1.13.332 / P0 ②：数据口径卡，进页即显示（不依赖是否出过预测结果）。
           文案统一来自 utils/dataProvenance.js，与商圈洞察页同结构。 -->
      <div class="fc-prov">
        <div class="prov-hd">
          <span class="prov-title">数据口径</span>
          <span class="prov-sub">预测值建立在什么数据上</span>
        </div>
        <dl class="prov-grid">
          <div v-for="it in forecastProv.items" :key="it.label" class="prov-item">
            <dt>{{ it.label }}</dt>
            <dd :class="{ 'prov-warn': it.tone === 'warn', 'prov-ok': it.tone === 'ok' }">{{ it.value }}</dd>
          </div>
        </dl>
        <p class="prov-note">{{ forecastProv.note }}</p>
      </div>

      <!-- 候选门店选择 -->
      <div class="fc-toolbar">
        <el-input v-model="keyword" placeholder="搜索候选门店" aria-label="搜索候选门店" style="width: 220px" clearable>
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="filterCity" placeholder="按城市" aria-label="按城市筛选" style="width: 150px" clearable>
          <el-option v-for="c in cityList" :key="c" :label="c" :value="c" />
        </el-select>
        <el-select v-model="filterBought" placeholder="已购联通人口" aria-label="已购联通人口筛选" style="width: 160px" clearable>
          <el-option label="已购联通人口" value="1" />
          <el-option label="未购买" value="0" />
        </el-select>
        <span class="fc-tip">{{ filteredCandidates.length }} 个候选门店（重点候选/一般候选）</span>
        <el-button size="small" @click="openGuide()" title="销售记录该填哪些列、怎么只填档位">
          <AppIcon class="icon-text"><Document /></AppIcon>录入字段说明
        </el-button>
      </div>

      <el-table :data="filteredCandidates" v-loading="loading" max-height="380" size="small">
        <el-table-column prop="storeCode" label="编号" width="90" />
        <el-table-column prop="name" label="门店名称" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.name }}
            <el-tag v-if="row.hasProfile && row.radii.length" size="small" type="success" style="margin-left: 6px;">已购联通人口（{{ row.radii.map(r => r + 'm').join('、') }}）</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="city" label="城市" width="90" />
        <el-table-column prop="storeType" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.storeType === '重点候选' ? 'danger' : 'warning'">{{ row.storeType }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="storeArea" label="面积(㎡)" width="90" align="right">
          <template #default="{ row }">{{ row.storeArea || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button type="primary" size="small" :loading="predictingId === row.id" @click="handlePredict(row)">预测</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 参照店圈定（可选精调，双轨：不圈定 = 系统全自动） -->
      <div class="fc-ref-panel">
        <div class="fc-ref-head" @click="openRefPanel">
          <span class="fc-ref-title"><AppIcon class="icon-text"><Tools /></AppIcon>参照店圈定</span>
          <el-tag size="small" :type="refMode === 'custom' ? 'warning' : 'info'" style="margin-left: 8px;">
            {{ refMode === 'custom' ? '自定义（已圈定 ' + refSelected.length + ' 家）' : '系统自动推荐' }}
          </el-tag>
          <span class="fc-tip">类比基准人工化：勾选想用的参照店，预测时只在这些店里类比（不勾 = 全自动）</span>
        </div>
        <div v-if="refOpen" class="fc-ref-body">
          <div class="fc-toolbar">
            <el-input v-model="refKeyword" placeholder="搜索参照店" aria-label="搜索参照店" style="width: 200px" size="small" clearable>
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button size="small" @click="resetRefSelection">恢复系统推荐</el-button>
            <span class="fc-tip">{{ refPool.length }} 家参照店（已开业 + 有年度销售记录）· 勾选即保存到本机</span>
          </div>
          <el-table ref="refTable" :data="filteredRefPool" size="small" max-height="240" @selection-change="onRefSelect">
            <el-table-column type="selection" width="40" />
            <el-table-column prop="name" label="门店" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.name }}
                <el-tag v-if="refAutoIds.includes(row.storeId)" size="small" type="success" style="margin-left: 6px;">推荐</el-tag>
                <el-tag v-if="row.hasProfile" size="small" type="warning" style="margin-left: 4px;">联通</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="brand" label="品牌" width="90" />
            <el-table-column prop="city" label="城市" width="80" />
            <el-table-column label="坪效(元/㎡)" width="110" align="right">
              <template #default="{ row }">{{ row.pingxiao.toLocaleString() }}</template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <!-- 预测结果 -->
      <div v-if="result" class="fc-result">
        <div class="fc-result-card">
          <div class="fc-result-title">
            {{ result.candName }} · 年销售额预测
            <el-tag size="small" :type="result.engine === 'L3' ? 'warning' : result.engine === 'L2' ? 'success' : 'info'" style="margin-left: 8px;">{{ result.engine === 'L3' ? 'L3 机器学习' : result.engine === 'L2' ? 'L2 回归' : 'L1 类比' }}</el-tag>
          </div>
          <div class="fc-result-main">
            <span class="fc-amount">{{ result.predictCompWan }}</span>
            <span class="fc-unit">万元 / 年</span>
            <el-tag size="small" type="warning" style="margin-left: 10px;">置信度 ±{{ result.conf }}%</el-tag>
          </div>
          <div class="fc-result-range">参考区间：{{ result.rangeWan[0] }} ~ {{ result.rangeWan[1] }} 万元（含外卖口径）</div>
          <div class="fc-result-meta">
            <div>匹配方式：{{ result.levelName }}</div>
            <div v-if="predictRefMode">参照店：{{ predictRefMode === 'custom' ? '自定义（已圈定 ' + predictRefCount + ' 家）' : '系统自动' }}</div>
            <div v-if="result.candDistrict">商圈归属：{{ result.candDistrict.city }} · {{ result.candDistrict.name }}</div>
            <div v-if="result.radiusPopulation">常住人口：{{ fmtPop(result.radiusPopulation) }}</div>
            <div v-if="result.radiusPoints">点位环境：{{ fmtPoints(result.radiusPoints) }}</div>
            <div>参考门店 {{ result.refCount }} 家</div>
          </div>
        </div>

        <!-- ===== 开店测算（v1.13.357）=====
             营业额直接取上方预测的 predictComp，⛔ 不另做预测（两处各算一套 = 同一家店两个数字）。
             成本为用户输入，界面上必须标明「不是平台数据」。
             展开头用原生 <button>：div + @click 键盘不可达（356 批次的教训）。 -->
        <div class="fc-sim">
          <button type="button" class="fc-sim-head" :aria-expanded="simOpen" @click="simOpen = !simOpen">
            <span class="fc-sim-title"><AppIcon class="icon-text"><Money /></AppIcon>开店测算</span>
            <span class="fc-sim-sub">投多少、多久回本（成本按你填的算）</span>
            <el-tag size="small" :type="simPayback.type" class="fc-sim-badge">{{ simPayback.text }}</el-tag>
            <el-icon class="fc-sim-arrow" :class="{ 'is-open': simOpen }"><ArrowDown /></el-icon>
          </button>

          <div v-if="simOpen" class="fc-sim-body">
            <p class="fc-sim-note">
              营业额取自上方预测（<b>{{ result.predictCompWan }} 万元 / 年</b>，含外卖口径，置信度 ±{{ result.conf }}%）；
              成本项是<b>你填的估算值</b>，不是平台实测数据 —— 改数字，回本周期会跟着变。
            </p>

            <el-alert v-if="simResult.warnings.includes('no_rent')" type="warning" :closable="false" show-icon class="fc-sim-alert">
              还没填租金 —— 固定成本偏低，<b>回本周期会显得比实际短</b>。填「元/㎡/月」的月租单价。
            </el-alert>
            <el-alert v-if="simResult.warnings.includes('negative_contribution')" type="error" :closable="false" show-icon class="fc-sim-alert">
              变动成本率 + 外卖佣金已 ≥ 100% —— 每卖 1 元都在亏，<b>不存在盈亏平衡点</b>，请先检查这两项比例。
            </el-alert>
            <el-alert v-else-if="simResult.warnings.includes('negative_net')" type="error" :closable="false" show-icon class="fc-sim-alert">
              按当前成本，年净利为负 —— 这个点位在这套假设下<b>回不了本</b>。可试着下调租金单价或面积。
            </el-alert>

            <!-- 成本输入 -->
            <div class="fc-sim-grid">
              <div class="fc-sim-col">
                <div class="fc-sim-col-title">一次性投入</div>
                <label class="fc-sim-field">
                  <span>装修单价（元/㎡）</span>
                  <el-input-number v-model="simForm.decorPerSqm" :min="0" :step="100" size="small" controls-position="right" />
                </label>
                <label class="fc-sim-field">
                  <span>设备 + 家具（万元）</span>
                  <el-input-number v-model="simForm.equipWan" :min="0" :step="1" size="small" controls-position="right" />
                </label>
                <label class="fc-sim-field">
                  <span>加盟费 / 保证金（万元）</span>
                  <el-input-number v-model="simForm.franchiseWan" :min="0" :step="1" size="small" controls-position="right" />
                </label>
                <label class="fc-sim-field">
                  <span>开办费（万元）</span>
                  <el-input-number v-model="simForm.setupWan" :min="0" :step="0.5" size="small" controls-position="right" />
                </label>
              </div>

              <div class="fc-sim-col">
                <div class="fc-sim-col-title">每月固定成本</div>
                <label class="fc-sim-field">
                  <span>租金单价（元/㎡/月）<i class="fc-req">必填</i></span>
                  <el-input-number v-model="simForm.rentPerSqmMonth" :min="0" :step="10" size="small" controls-position="right" aria-label="租金单价 元每平方米每月" />
                </label>
                <label class="fc-sim-field">
                  <span>用工人数（人）</span>
                  <el-input-number v-model="simForm.staffCount" :min="1" :step="1" size="small" controls-position="right" />
                </label>
                <label class="fc-sim-field">
                  <span>人均月薪（元）</span>
                  <el-input-number v-model="simForm.salaryMonth" :min="0" :step="500" size="small" controls-position="right" />
                </label>
                <label class="fc-sim-field">
                  <span>水电物业（元/㎡/月）</span>
                  <el-input-number v-model="simForm.utilityPerSqmMonth" :min="0" :step="5" size="small" controls-position="right" />
                </label>
              </div>

              <div class="fc-sim-col">
                <div class="fc-sim-col-title">比例假设</div>
                <label class="fc-sim-field">
                  <span>变动成本率（%）</span>
                  <el-input-number v-model="simForm.variablePct" :min="0" :max="100" :step="1" size="small" controls-position="right" />
                </label>
                <label class="fc-sim-field">
                  <span>外卖佣金率（%）</span>
                  <el-input-number v-model="simForm.commissionPct" :min="0" :max="100" :step="1" size="small" controls-position="right" />
                </label>
                <label class="fc-sim-field">
                  <span>外卖占比（%）</span>
                  <el-input-number v-model="simDeliveryShare" :min="0" :max="100" :step="5" size="small" controls-position="right" />
                </label>
                <div class="fc-sim-hint">
                  变动成本 = 餐饮的食材 / 零售的进货，占营业额比重；外卖佣金只对外卖那部分计。
                </div>
              </div>
            </div>

            <!-- 测算结果 -->
            <div class="fc-sim-out">
              <div class="fc-sim-main">
                <div class="fc-sim-main-label">回本周期</div>
                <div class="fc-sim-main-val" :class="'tone-' + simPayback.tone">{{ simPayback.text }}</div>
                <div class="fc-sim-main-sub">
                  一次性投入 {{ wan(simResult.oneTimeTotal) }} 万元 ÷ 月净利 {{ wan(simResult.monthlyNet) }} 万元
                </div>
              </div>
              <dl class="fc-sim-kv">
                <div><dt>一次性投入</dt><dd>{{ wan(simResult.oneTimeTotal) }} 万元</dd></div>
                <div><dt>月固定成本</dt><dd>{{ wan(simResult.monthlyFixed) }} 万元</dd></div>
                <div><dt>年净利</dt><dd :class="{ 'is-neg': simResult.annualNet < 0 }">{{ wan(simResult.annualNet) }} 万元</dd></div>
                <div><dt>月净利</dt><dd :class="{ 'is-neg': simResult.monthlyNet < 0 }">{{ wan(simResult.monthlyNet) }} 万元</dd></div>
                <div><dt>盈亏平衡月营业额</dt><dd>{{ Number.isFinite(simResult.breakEvenMonthlyRevenue) ? wan(simResult.breakEvenMonthlyRevenue) + ' 万元' : '不存在' }}</dd></div>
                <div><dt>安全边际</dt><dd>{{ simMarginPct }}</dd></div>
              </dl>
            </div>

            <!-- 三档情形 -->
            <div class="fc-sim-scen">
              <div class="fc-sim-scen-title">三档情形（按预测置信区间 ±{{ result.conf }}% 推算）</div>
              <div class="fc-sim-scen-row">
                <div v-for="s in simScenarios" :key="s.key" class="fc-sim-scen-item" :class="'tone-' + s.payback.tone">
                  <div class="scen-label">{{ s.label }}</div>
                  <div class="scen-rev">年营收 {{ wan(s.rev) }} 万</div>
                  <div class="scen-pay">{{ s.payback.text }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="fc-refs">
          <div class="fc-refs-title">{{ result.engine === 'L2' || result.engine === 'L3' ? '特征相似样本门店（真实销售）' : '类比参照门店（真实销售）' }}</div>

          <!-- L3：对周边门店影响模拟 -->
          <div v-if="result.impacts && result.impacts.length" class="fc-impact" style="margin-top: 14px;">
            <div class="fc-refs-title">对周边 {{ result.impacts.length }} 家店影响（3km 内，新店开业蚕食模拟）</div>
            <el-table :data="result.impacts" size="small" max-height="180">
              <el-table-column prop="name" label="周边门店" min-width="150" show-overflow-tooltip />
              <el-table-column prop="brand" label="品牌" width="110" />
              <el-table-column label="原坪效(元/㎡/年)" width="130" align="right">
                <template #default="{ row }">{{ row.origEff.toLocaleString() }}</template>
              </el-table-column>
              <el-table-column label="开业后坪效" width="120" align="right">
                <template #default="{ row }"><span style="color:#f56c6c;">{{ row.newEff.toLocaleString() }}</span></template>
              </el-table-column>
              <el-table-column label="下降" width="80" align="right">
                <template #default="{ row }"><span style="color:#f56c6c;font-weight:500;">-{{ row.dropPct }}%</span></template>
              </el-table-column>
            </el-table>
          </div>

          <!-- L3：预测归因（SHAP/特征重要性） -->
          <div v-if="result.importance && result.importance.length" style="margin-top: 12px; font-size: 12px; color: #666;">
            预测归因（特征重要性 Top{{ Math.min(result.importance.length, 4) }}）：{{ fmtImportance(result.importance) }}
          </div>
          <el-table :data="result.refs" size="small" max-height="220">
            <el-table-column prop="name" label="门店" min-width="160" show-overflow-tooltip />
            <el-table-column prop="city" label="城市" width="80" />
            <el-table-column prop="area" label="面积(㎡)" width="90" align="right" />
            <el-table-column prop="year" label="年份" width="70" align="center" />
            <el-table-column label="年销售(万)" width="110" align="right">
              <template #default="{ row }">{{ (row.salesAmount / 10000).toFixed(1) }}</template>
            </el-table-column>
            <el-table-column label="坪效(元/㎡)" width="110" align="right">
              <template #default="{ row }">{{ row.pingxiao.toLocaleString() }}</template>
            </el-table-column>
            <el-table-column v-if="result.refs.some(r => r.sim != null)" label="相似度" width="80" align="center">
              <template #default="{ row }">{{ row.sim != null ? row.sim + '%' : '-' }}</template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <el-empty v-else-if="!loading && filteredCandidates.length === 0" description="暂无候选门店（重点候选/一般候选）" />
    </el-card>
  </div>

  <!-- 销售录入字段说明（与体检页共用同一份，字段清单来自 utils/importSpecs.js） -->
  <ImportGuideDialog v-model="guideVisible" tab="sales" @go="onGuideGo" />
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api from '../utils/api.js'
import { currentUidOr } from '../utils/currentUser.js'
import { ElMessage } from 'element-plus'
import { Search, ArrowRight, ArrowDown, DataAnalysis, CircleCheck, TrendCharts, Tools, WarningFilled, Lock, GoldMedal, Document, Money } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import ImportGuideDialog from '@/components/ImportGuideDialog.vue'
import { downloadSalesTemplate } from '@/utils/importTemplates.js'
import { forecastProvenance as buildForecastProvenance } from '@/utils/dataProvenance'
// 开店测算（v1.13.357）：成本模型全部在 utils/storeSim.js，视图只负责收集输入与展示
import { computeSim, defaultSimForm, toComputeCosts, formatPayback, simCategoryOf } from '@/utils/storeSim'
import { resolveBrandCategory, DELIVERY_RATIO_MAP, DELIVERY_RATIO_FALLBACK } from '@/utils/storeBrand'
import { useUserStore } from '@/stores/user'
import { useRouter } from 'vue-router'

const userStore = useUserStore()
// ★ v1.13.209 VIP 功能门禁判据：与「AI 选址建议 / 开店余地 / 网点优化」共用
//   stores/user.js::isVipActive（vip 正式 / trial 试用 / admin 三者均放行）。
//   ⛔ 不得就地写 role === 'vip' || role === 'admin' —— 那会漏掉 trial 试用用户，
//      正是 v1.13.208 线上 bug 的成因；backend/tests/vipGateGuard.test.js 会判红。
const isVip = computed(() => userStore.isVipActive)

// ===== 录入引导（v1.13.292）=====
// 字段清单与模板统一来自 utils/importSpecs.js / importTemplates.js，
// 与「门店体检」页共用同一个弹窗，⛔ 不在这里另写一份列名。
const router = useRouter()
const guideVisible = ref(false)

function openGuide() {
  guideVisible.value = true
}
async function downloadSales() {
  const ok = await downloadSalesTemplate()
  if (!ok) ElMessage.error('模板下载失败，请稍后重试')
}
/** 直接落到「录入销售」弹窗，而不是只把人丢到门店列表页 */
function goSale() { router.push({ path: '/data', query: { sale: '1' } }) }
function onGuideGo(kind) {
  guideVisible.value = false
  if (kind === 'sales') goSale()
  else router.push('/data')
}

const loading = ref(false)
const candidates = ref([])
const keyword = ref('')
const filterCity = ref('')
const filterBought = ref('')
const predictingId = ref(null)
const result = ref(null)

// ===== 开店测算（v1.13.357）=====
// 🔴 营业额唯一来源 = 上方 result.predictComp（⛔ 本视图不做任何预测）。
//    成本模型全在 utils/storeSim.js；这里只收集输入、展示结果。
const simOpen = ref(false)
const simForm = reactive(defaultSimForm({}))
const simDeliveryShare = ref(DELIVERY_RATIO_FALLBACK)

/** 每次预测成功后按该门店重算默认成本（面积 / 业态 / 外卖占比都跟着门店变） */
function initSim(row, d) {
  const { brand, category } = resolveBrandCategory(row.name || '', row.city || '')
  const cat = simCategoryOf(category)
  Object.assign(simForm, defaultSimForm({ area: d.candArea, category: cat }))
  // 外卖占比兜底与后端训练特征同值（?? 35）：预测模型本身就是按这个假设算的，
  // 测算沿用同一假设才能与营业额自洽。用户可改。
  const b = brand || row.brand
  simDeliveryShare.value = DELIVERY_RATIO_MAP[b] ?? DELIVERY_RATIO_FALLBACK
  simOpen.value = false // 默认收起：结果卡已有信息量，避免一屏塞满
}

const simResult = computed(() => computeSim({
  annualRevenue: result.value?.predictComp || 0,
  area: result.value?.candArea || 0,
  deliveryShare: simDeliveryShare.value,
  conf: result.value?.conf || 0,
  costs: toComputeCosts(simForm)
}))
const simPayback = computed(() => {
  const p = formatPayback(simResult.value.paybackMonths)
  const type = p.tone === 'good' ? 'success' : p.tone === 'warn' ? 'warning' : 'danger'
  return { ...p, type }
})
const simMarginPct = computed(() => {
  const v = simResult.value.safetyMargin
  if (!Number.isFinite(v)) return '—'
  if (v <= -1) return '不存在'
  return (v * 100).toFixed(1) + '%'
})
const simScenarios = computed(() => {
  const s = simResult.value.scenarios
  return [
    { key: 'low', label: '悲观（−置信区间）', rev: s.low.annualRevenue, payback: formatPayback(s.low.paybackMonths) },
    { key: 'mid', label: '中性（预测值）', rev: s.mid.annualRevenue, payback: formatPayback(s.mid.paybackMonths) },
    { key: 'high', label: '乐观（+置信区间）', rev: s.high.annualRevenue, payback: formatPayback(s.high.paybackMonths) }
  ]
})
/** 元 → 万元（1 位小数）。非有限值给「—」，⛔ 不显示 NaN。 */
const wan = (v) => (Number.isFinite(Number(v)) ? (Number(v) / 10000).toFixed(1) : '—')

// 格式化三档常住人口：1km 12.3万 / 3km 45.6万 / 5km 89.0万
const fmtPop = (pop) => {
  if (!pop) return ''
  const w = (v) => (v / 10000).toFixed(1) + '万'
  const parts = []
  if (pop['1000']) parts.push('1km ' + w(pop['1000']))
  if (pop['3000']) parts.push('3km ' + w(pop['3000']))
  if (pop['5000']) parts.push('5km ' + w(pop['5000']))
  return parts.join(' / ')
}
// 格式化点位环境：竞品500 X家/我的门店500 X家/写字楼 500/1k/3k X家/大学 1k/3k X家/医院 X/地铁500 X站/购物中心500 X家
const fmtPoints = (p) => {
  if (!p) return ''
  const parts = []
  parts.push(`竞品500m ${p.competitors500 || 0}家`)
  if (p.myStores500) parts.push(`我的门店500m ${p.myStores500}家`)
  if (p.offices) parts.push(`写字楼 ${[500, 1000, 3000].filter(r => p.offices[r] != null).map(r => (r >= 1000 ? r / 1000 + 'km' : r + 'm') + ' ' + p.offices[r] + '栋').join('/')}`)
  if (p.universities) parts.push(`大学 ${[1000, 3000].filter(r => p.universities[r] != null).map(r => r / 1000 + 'km ' + p.universities[r] + '所').join('/')}`)
  if (p.hospitals) parts.push(`医院 ${[1000, 3000].filter(r => p.hospitals[r] != null).map(r => r / 1000 + 'km ' + p.hospitals[r] + '家').join('/')}`)
  if (p.metro500 != null) parts.push(`地铁500m ${p.metro500}站`)
  if (p.malls500 != null) parts.push(`购物中心500m ${p.malls500}家`)
  return parts.join('；')
}
// 特征归因展示：面积 58% · 商圈人口 20% · 竞争 12% ...
const FEATURE_CN = { logArea: '面积', deliveryRatio: '外卖占比', dLive: '商圈居住', dWork: '商圈工作', dVisit: '商圈客流', dRich: '高消费人群', pop1km: '1km人口', pop3km: '3km人口', pop5km: '5km人口', comp500: '竞品500m', my500: '我的门店500m', yearCode: '年份', mallCode: '商场类型', tradeCode: '商圈类型', uniPop: '联通人口', uniMale: '联通男性', uniFemale: '联通女性', uniGuest: '联通客流', uniRich: '联通富裕', uniSpend: '联通消费', hasUnicom: '联通画像' }
const fmtImportance = (imp) => {
  const total = imp.reduce((s, i) => s + (i.gain || 0), 0) || 1
  return imp.slice(0, 4).map(i => (FEATURE_CN[i.feature] || i.feature) + ' ' + Math.round((i.gain / total) * 100) + '%').join(' · ')
}

const cityList = computed(() => [...new Set(candidates.value.map(c => c.city).filter(Boolean))])

const filteredCandidates = computed(() => {
  let list = candidates.value
  if (keyword.value) {
    const k = keyword.value.trim()
    list = list.filter(c => (c.name || '').includes(k) || (c.storeCode || '').includes(k))
  }
  if (filterCity.value) list = list.filter(c => c.city === filterCity.value)
  if (filterBought.value === '1') list = list.filter(c => c.hasProfile)
  if (filterBought.value === '0') list = list.filter(c => !c.hasProfile)
  return list
})

const stats = ref(null)
const loadStats = async () => {
  try {
    const d = await api.get('/sales-forecast/stats')
    if (d && d.success) stats.value = d
  } catch (e) { /* 忽略统计失败 */ }
}
// v1.13.332 / P0 ②：口径卡随 stats / result 实时变化，⛔ 不写死样本量。
const forecastProv = computed(() => buildForecastProvenance({ stats: stats.value, result: result.value }))
const loadCandidates = async () => {
  loading.value = true
  try {
    const d = await api.get('/sales-forecast/candidates')
    candidates.value = d?.candidates || []
  } catch (e) {
    ElMessage.error('加载候选门店失败：' + (e.response?.data?.message || e.message))
  } finally {
    loading.value = false
  }
}

const handlePredict = async (row) => {
  predictingId.value = row.id
  result.value = null
  // 记录本次预测的参照模式（结果卡展示用）
  predictRefMode.value = (refMode.value === 'custom' && refSelected.value.length) ? 'custom' : 'auto'
  predictRefCount.value = refSelected.value.length
  try {
    const payload = { storeId: row.id }
    // 自定义圈定集：传入选中的参照店；自动模式不带（后端全自动）
    if (refMode.value === 'custom' && refSelected.value.length) payload.refSelection = refSelected.value
    const d = await api.post('/sales-forecast/predict', payload)
    // 用该候选店刷新面板推荐集（不改变已保存的自定义勾选）
    if (refPool.value.length) loadRefStores(row.id)
    if (d.success && d.status === 'ok') {
      result.value = d
      initSim(row, d) // 开店测算：按该门店的面积/业态/外卖占比重算默认成本
    } else {
      ElMessage.warning(d.message || '暂时无法预测')
    }
  } catch (e) {
    ElMessage.error('预测失败：' + (e.response?.data?.message || e.message))
  } finally {
    predictingId.value = null
  }
}

// ===== 参照店圈定（双轨：自动 = 系统推荐；自定义 = 用户勾选集） =====
const refOpen = ref(false)
const refPool = ref([])
const refAutoIds = ref([])
const refKeyword = ref('')
const refSelected = ref([])
const refMode = ref('auto')
const refTable = ref(null)
const predictRefMode = ref('auto')
const predictRefCount = ref(0)
let refRestoring = false
const savedKey = () => 'refSelection_' + currentUidOr('0')

const filteredRefPool = computed(() => {
  let list = refPool.value
  if (refKeyword.value) {
    const k = refKeyword.value.trim()
    list = list.filter(r => (r.name || '').includes(k) || (r.brand || '').includes(k) || (r.city || '').includes(k))
  }
  return list
})

const loadRefStores = async (storeId) => {
  try {
    const d = await api.get('/sales-forecast/ref-stores', { params: { storeId: storeId || undefined } })
    if (d && d.success) {
      refPool.value = d.pool || []
      refAutoIds.value = d.auto || []
      restoreRefSelection()
    }
  } catch (e) {
    ElMessage.error('加载参照店失败：' + (e.response?.data?.message || e.message))
  }
}

// 恢复勾选态：有已保存自定义集则恢复；否则按系统推荐勾选（不保存，仍为自动模式）
const restoreRefSelection = () => {
  refRestoring = true
  try {
    const saved = JSON.parse(localStorage.getItem(savedKey()) || 'null')
    if (saved && saved.mode === 'custom' && Array.isArray(saved.selected)) {
      refMode.value = 'custom'
      refSelected.value = saved.selected.filter(id => refPool.value.some(p => p.storeId === id))
    } else {
      refMode.value = 'auto'
      refSelected.value = [...refAutoIds.value]
    }
  } catch (e) {
    refMode.value = 'auto'
    refSelected.value = [...refAutoIds.value]
  }
  refPool.value.forEach(p => {
    refTable.value?.toggleRowSelection(p, refSelected.value.includes(p.storeId))
  })
  refRestoring = false
}

const onRefSelect = (rows) => {
  refSelected.value = rows.map(r => r.storeId)
  if (refRestoring) return
  if (refSelected.value.length) {
    refMode.value = 'custom'
    localStorage.setItem(savedKey(), JSON.stringify({ mode: 'custom', selected: refSelected.value }))
  } else {
    // 全不选 = 回到系统自动
    refMode.value = 'auto'
    localStorage.removeItem(savedKey())
  }
}

const resetRefSelection = () => {
  localStorage.removeItem(savedKey())
  refMode.value = 'auto'
  refSelected.value = []
  restoreRefSelection()
}

const openRefPanel = () => {
  refOpen.value = !refOpen.value
  if (refOpen.value && refPool.value.length === 0) loadRefStores()
}

// ⛔ 非 VIP 不发起任何请求（页面此时只渲染专属空态，避免无谓后端开销与 403 噪音）
onMounted(() => {
  if (!isVip.value) return
  loadStats()
  loadCandidates()
  loadRefStores()
})
</script>

<style scoped>
.sales-forecast-view {
  padding: 16px;
  max-width: 1080px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
}
.fc-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 16px;
  font-weight: 500;
}
.fc-sub {
  font-size: 12px;
  color: #909399;
  font-weight: 400;
}
.fc-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.fc-guide-links { display: flex; align-items: center; gap: 4px; margin-top: 6px; flex-wrap: wrap; }

.fc-tip {
  font-size: 12px;
  color: #909399;
  margin-left: auto;
}
.fc-result {
  margin-top: 16px;
  border-top: 1px dashed #e0e0e0;
  padding-top: 16px;
}
.fc-result-card {
  background: #f5f7fa;
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 14px;
}
.fc-result-title {
  font-size: 14px;
  color: #555;
  margin-bottom: 8px;
}
.fc-result-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.fc-amount {
  font-size: 32px;
  font-weight: 500;
  color: var(--brand-primary);
}
.fc-unit {
  font-size: 14px;
  color: #666;
}
.fc-result-range {
  font-size: 13px;
  color: #666;
  margin-top: 4px;
}
.fc-result-meta {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: 12px;
  color: #909399;
}
.fc-refs-title {
  font-size: 13px;
  color: #333;
  margin-bottom: 8px;
  font-weight: 500;
}
.fc-ref-panel {
  margin-top: 12px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
}
.fc-ref-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
}
.fc-ref-title {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}
.fc-ref-body {
  border-top: 1px dashed #e4e7ed;
  padding: 12px 14px;
}

/* ===== v1.13.209：VIP 专属空态（非 VIP 仅渲染此卡片，不发任何请求） ===== */
.fc-locked-card {
  border: 1px solid #f0e2c8;
  background: linear-gradient(180deg, #fffdf8 0%, #ffffff 100%);
}
.fc-locked {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 44px 24px 36px;
}
.fc-locked-icon {
  margin-bottom: 14px;
  line-height: 1;
}
.fc-locked-title {
  font-size: 16px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 12px;
}
.fc-locked-desc {
  font-size: 13px;
  color: #909399;
  line-height: 1.9;
  max-width: 560px;
  margin-bottom: 6px;
}
.fc-locked .el-button {
  margin-top: 14px;
}
.fc-prov{margin:0 0 12px;padding:10px 14px;border:1px solid #e4e7ed;border-radius:6px;background:#fafbfc}

/* v1.13.332 / P0 ②：数据口径卡。两页同结构，文案统一来自 utils/dataProvenance.js */
.prov-hd{display:flex;align-items:baseline;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.prov-title{font-size:13px;font-weight:700;color:#303133}
.prov-sub{font-size:11.5px;color:#909399}
.prov-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 16px;margin:0}
.prov-item{min-width:0}
.prov-item dt{font-size:11.5px;color:#909399;margin-bottom:2px}
.prov-item dd{margin:0;font-size:12.5px;color:#303133;line-height:1.45;word-break:break-word}
.prov-item dd.prov-warn{color:#b88230}
.prov-item dd.prov-ok{color:#1d9e75}
.prov-note{margin:8px 0 0;font-size:11.5px;line-height:1.6;color:#6b7280;border-top:1px dashed #e4e7ed;padding-top:7px}
@media (max-width:900px){.prov-grid{grid-template-columns:repeat(2,1fr)}}

/* ===== 开店测算（v1.13.357）===== */
.fc-sim{margin:0 0 14px;border:1px solid #e4e7ed;border-radius:10px;background:#fff;overflow:hidden}
/* 展开头是原生 <button>（键盘可达），故需重置默认外观 */
.fc-sim-head{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:11px 14px;
  background:#fafbfc;border:0;border-bottom:1px solid transparent;font:inherit;text-align:left;cursor:pointer;
  transition:background .15s}
.fc-sim-head:hover{background:#f2f5f9}
.fc-sim-head:focus-visible{outline:2px solid var(--brand-primary);outline-offset:-2px}
.fc-sim-title{display:inline-flex;align-items:center;gap:4px;font-size:13.5px;font-weight:600;color:#303133}
.fc-sim-sub{font-size:11.5px;color:#909399}
.fc-sim-badge{margin-left:auto}
.fc-sim-arrow{transition:transform .2s;color:#909399;font-size:13px}
.fc-sim-arrow.is-open{transform:rotate(180deg)}

.fc-sim-body{padding:12px 14px 14px;border-top:1px solid #ebeef5}
.fc-sim-note{margin:0 0 10px;font-size:12px;line-height:1.6;color:#6b7280}
.fc-sim-note b{color:#303133}
.fc-sim-alert{margin-bottom:10px}
.fc-sim-alert :deep(.el-alert__title){font-size:12px;line-height:1.55}

.fc-sim-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 18px;margin-bottom:14px}
.fc-sim-col{min-width:0}
.fc-sim-col-title{font-size:12px;font-weight:600;color:#303133;margin-bottom:7px;
  padding-bottom:5px;border-bottom:1px solid #ebeef5}
.fc-sim-field{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
.fc-sim-field>span{font-size:12px;color:#606266;line-height:1.3;min-width:0}
.fc-sim-field :deep(.el-input-number){width:118px;flex:0 0 118px}
.fc-req{font-style:normal;font-size:10px;color:var(--el-color-danger);margin-left:3px}
.fc-sim-hint{font-size:11px;line-height:1.55;color:#909399;margin-top:8px}

.fc-sim-out{display:flex;gap:20px;align-items:center;flex-wrap:wrap;
  background:#f5f7fa;border-radius:8px;padding:12px 16px;margin-bottom:12px}
.fc-sim-main{min-width:170px}
.fc-sim-main-label{font-size:11.5px;color:#909399;margin-bottom:2px}
.fc-sim-main-val{font-size:22px;font-weight:600;line-height:1.25}
.fc-sim-main-val.tone-good{color:var(--el-color-success)}
.fc-sim-main-val.tone-warn{color:var(--el-color-warning)}
.fc-sim-main-val.tone-bad{color:var(--el-color-danger)}
.fc-sim-main-sub{font-size:11.5px;color:#909399;margin-top:3px}
.fc-sim-kv{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:8px 18px;margin:0;flex:1}
.fc-sim-kv>div{min-width:0}
.fc-sim-kv dt{font-size:11.5px;color:#909399;margin-bottom:2px}
.fc-sim-kv dd{margin:0;font-size:13px;font-weight:500;color:#303133}
.fc-sim-kv dd.is-neg{color:var(--el-color-danger)}

.fc-sim-scen{border-top:1px dashed #e4e7ed;padding-top:10px}
.fc-sim-scen-title{font-size:11.5px;color:#909399;margin-bottom:8px}
.fc-sim-scen-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.fc-sim-scen-item{border:1px solid #ebeef5;border-radius:7px;padding:8px 10px;background:#fff}
.fc-sim-scen-item .scen-label{font-size:11.5px;color:#909399;margin-bottom:3px}
.fc-sim-scen-item .scen-rev{font-size:12px;color:#606266;margin-bottom:2px}
.fc-sim-scen-item .scen-pay{font-size:13px;font-weight:600}
.fc-sim-scen-item.tone-good .scen-pay{color:var(--el-color-success)}
.fc-sim-scen-item.tone-warn .scen-pay{color:var(--el-color-warning)}
.fc-sim-scen-item.tone-bad .scen-pay{color:var(--el-color-danger)}
@media (max-width:900px){
  .fc-sim-grid{grid-template-columns:1fr}
  .fc-sim-kv{grid-template-columns:repeat(2,1fr)}
  .fc-sim-scen-row{grid-template-columns:1fr}
}
</style>
