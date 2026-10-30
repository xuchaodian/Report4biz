<template>
  <div class="checkup-page">
    <div class="ck-head">
      <div class="ck-head-l">
        <el-button link @click="goBack"><el-icon><ArrowLeft /></el-icon>返回门店管理</el-button>
        <h2>门店体检</h2>
        <p class="ck-sub">
          两块内容：<b>几何结构</b>（坐标、间距、店型 —— 只看「密不密、有没有贴在一起」）
          与<b>门店信号灯</b>（以门店坐标为圆心按半径判自我蚕食 / 竞争密度 —— 给「先看哪几家」）。
          两者都<b>看不出「赚不赚钱」</b>，那要客户录销售数据。
        </p>
      </div>
      <div class="ck-head-r">
        <span class="ck-label">复核阈值</span>
        <el-select v-model="nearM" size="default" style="width: 148px" @change="reload">
          <el-option :value="300" label="300m（默认）" />
          <el-option :value="500" label="500m" />
          <el-option :value="1000" label="1km" />
        </el-select>
        <el-button :loading="loading" @click="reload">重新计算</el-button>
        <el-dropdown trigger="click" @command="onExport">
          <el-button :loading="exporting">
            <el-icon><Download /></el-icon>导出报告
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="xlsx">Excel · 全量明细</el-dropdown-item>
              <el-dropdown-item command="print">打印版 · 可另存为 PDF</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div v-if="errorMsg" class="ck-error">
      <el-icon><WarningFilled /></el-icon>{{ errorMsg }}
    </div>

    <div v-else-if="loading && !data" class="ck-loading">正在计算门店间距…</div>

    <template v-else-if="data">
      <!-- 空态：没有门店 / 没有坐标 -->
      <el-empty v-if="data.counts.total === 0" description="还没有门店，先导入门店再来体检">
        <el-button type="primary" @click="goBack">去导入门店</el-button>
      </el-empty>
      <el-empty
        v-else-if="data.counts.withCoord === 0"
        :description="`${data.counts.total} 家门店都缺经纬度，无法做几何体检（请先用「地址解析」补坐标）`"
      >
        <el-button type="primary" @click="goBack">去地址解析</el-button>
      </el-empty>

      <template v-else>
        <!-- KPI -->
        <div class="ck-kpis">
          <div class="ck-kpi">
            <div class="ck-kpi-n">{{ data.counts.total }}</div>
            <div class="ck-kpi-l">门店总数</div>
            <div class="ck-kpi-h">可判定 {{ data.counts.withCoord }} 家</div>
          </div>
          <div class="ck-kpi" :class="{ warn: data.counts.sameAddrPairs > 0 }">
            <div class="ck-kpi-n">{{ data.counts.sameAddrPairs }}</div>
            <div class="ck-kpi-l">同址组（&lt;50m 同品牌）</div>
            <div class="ck-kpi-h">{{ data.counts.sameAddrStores }} 家门店落在其中</div>
          </div>
          <div class="ck-kpi">
            <div class="ck-kpi-n">{{ data.counts.pairs }}</div>
            <div class="ck-kpi-l">需复核（≤{{ data.nearM }}m）</div>
            <div class="ck-kpi-h">双店型 {{ data.counts.dualFormatPairs }} · 疑似 {{ data.counts.suspectedPairs }}</div>
          </div>
          <div class="ck-kpi">
            <div class="ck-kpi-n">{{ data.medianNearestM == null ? '—' : fmtDist(data.medianNearestM) }}</div>
            <div class="ck-kpi-l">中位最近同品牌距离</div>
            <div class="ck-kpi-h">
              基于 {{ data.medianBasis }} 家{{ data.noNeighbor ? `；另 ${data.noNeighbor} 家 20km 内无同品牌` : '' }}
            </div>
          </div>
          <div class="ck-kpi" :class="{ warn: data.completeness.salesRows === 0 }">
            <div class="ck-kpi-n">{{ data.completeness.salesRows }}</div>
            <div class="ck-kpi-l">销售记录（行）</div>
            <div class="ck-kpi-h">{{ salesHint }}</div>
          </div>
        </div>


        <!-- 门店信号灯（v1.13.299 半径骨架）：先看哪几家，不消耗任何配额 -->
        <section class="ck-card">
          <h3>
            门店信号灯
            <span class="ck-count">先看哪几家 · 本次未消耗配额</span>
          </h3>
          <p class="ck-card-sub">
            以<b>每家门店坐标为圆心</b>按半径判定，<b>不调用任何实时人口接口</b>。
            红 = 自我蚕食（同品牌贴身）与竞争密集（半径内竞品多）同时命中；
            黄 = 命中其中一条；绿 = 未命中。商圈名只作<b>定位参考</b>，不参与打分。
          </p>

          <div v-if="lightsLoading" class="ck-lights-loading">正在计算门店间距…</div>
          <div v-else-if="lightsErrorMsg" class="ck-hint-warn">{{ lightsErrorMsg }}</div>
          <template v-else-if="lights">
            <div class="ck-lights">
              <div class="ck-light l-red">
                <div class="ck-light-n">{{ lights.byLevel.high }}</div>
                <div class="ck-light-l">红灯 · 高风险</div>
                <div class="ck-light-h">贴身 + 半径内竞品密集</div>
              </div>
              <div class="ck-light l-yellow">
                <div class="ck-light-n">{{ lights.byLevel.mid }}</div>
                <div class="ck-light-l">黄灯 · 中风险</div>
                <div class="ck-light-h">命中其中一条</div>
              </div>
              <div class="ck-light l-green">
                <div class="ck-light-n">{{ lights.byLevel.low + lights.byLevel.none }}</div>
                <div class="ck-light-l">绿灯 · 低风险</div>
                <div class="ck-light-h">其中 {{ lights.byLevel.none }} 家未发现问题</div>
              </div>
              <div class="ck-light l-gray" :class="{ 'is-warn': lights.noCoord > 0 }">
                <div class="ck-light-n">{{ lights.noCoord }}</div>
                <div class="ck-light-l">未评估 · 缺经纬度</div>
                <div class="ck-light-h">没坐标就算不了距离</div>
              </div>
            </div>

            <ul class="ck-rule-list">
              <li>
                <span class="ck-rule-name">自我蚕食</span>
                <span class="ck-rule-sub">
                  最近同品牌 ≤{{ lights.thresholds.closeM }}m 记 +3、≤{{ lights.thresholds.overlapM }}m 记 +2；
                  同址双店型不计分
                </span>
                <span class="ck-rule-n">{{ lights.rules.cannibal }} 家</span>
                <span class="ck-rule-more">
                  同址 {{ lights.rules.selfDetail.same }} · 贴身 {{ lights.rules.selfDetail.close }} ·
                  部分重叠 {{ lights.rules.selfDetail.overlap }}；另有 {{ lights.rules.selfDetail.sameDual }} 家为同址双店型（不计分）
                </span>
              </li>
              <li>
                <span class="ck-rule-name">竞争密度</span>
                <span class="ck-rule-sub">
                  门店 {{ lights.thresholds.compRadiusM }}m 内同业态竞品 ≥{{ lights.thresholds.compHigh }} 家记 +3、≥{{ lights.thresholds.compMid }} 家记 +2
                </span>
                <span class="ck-rule-n">{{ lights.rules.competition }} 家</span>
                <span class="ck-rule-more">
                  已评 {{ lights.rules.competitionEvaluated }} 家<template v-if="lights.rules.competitionNoData + lights.rules.competitionNoCity > 0"> ·
                    未评 {{ lights.rules.competitionNoData + lights.rules.competitionNoCity }} 家（该城市无竞品点位，<b>不等于竞争宽松</b>）
                  </template>
                </span>
              </li>
              <li v-if="lights.rules.cannibalDistricts">
                <span class="ck-rule-name">扎堆组</span>
                <span class="ck-rule-sub">同品牌两两 ≤{{ lights.thresholds.overlapM }}m 连通成一团</span>
                <span class="ck-rule-n">{{ lights.rules.cannibalDistricts }} 组</span>
                <span class="ck-rule-more">
                  最挤：{{ lights.rules.clusters.map(c => c.names[0] + '一带 ' + c.count + ' 家').join('、') }}
                </span>
              </li>
            </ul>

            <p v-if="lights.noCoord" class="ck-hint-warn">
              {{ lights.noCoord }} 家门店缺经纬度 —— 这是<b>「没评估」，不是「没问题」</b>，先做地址解析补坐标。
            </p>
            <p v-if="lights.rules.competitionNoData" class="ck-hint-warn">
              {{ lights.rules.competitionNoData }} 家门店所在城市还没有竞品点位 —— 竞争密度这几个字<b>没算过</b>，
              在「竞品管理」里导入竞品后重跑即可。当前账号竞品点位共 {{ lights.competitorPoints }} 个。
            </p>

            <div v-if="topLights.length" class="ck-lights-table">
              <div class="ck-lights-bar">
                <span class="ck-lights-bar-t">
                  按风险排序 · 可评估 <b>{{ lights.evaluated }}</b> 家{{ lights.evaluated > topLights.length ? `，下表先列 ${topLights.length} 家` : '' }}
                </span>
                <div class="ck-lights-switch">
                  <el-checkbox v-model="showBlind" size="small">含未评估（{{ lights.noCoord }} 家）</el-checkbox>
                  <el-checkbox v-model="onlyLit" size="small">只看红黄灯</el-checkbox>
                </div>
              </div>
              <el-table :data="pagedLights" size="small" class="ck-table">
                <el-table-column label="灯" width="72">
                  <template #default="{ row }">
                    <span class="ck-dot" :class="'d-' + row.riskLevel"></span>{{ levelText(row.riskLevel) }}
                  </template>
                </el-table-column>
                <el-table-column label="门店" min-width="160">
                  <template #default="{ row }">
                    <button
                      type="button"
                      class="ck-store-link"
                      :title="'在地图上定位「' + (row.name || '未命名') + '」'"
                      @click="locate(row.lat, row.lng)"
                    >{{ row.name || '（未命名）' }}</button>
                    <div class="ck-store-meta">{{ row.riskScore == null ? '未评分' : row.riskScore + ' 分' }} · {{ flagsText(row.flags) }}</div>
                  </template>
                </el-table-column>
                <el-table-column label="最近同品牌" width="150">
                  <template #default="{ row }">
                    <template v-if="row.status === 'evaluated'">
                      <span :class="{ 'ck-bad-num': row.nearestM != null && row.nearestM <= lights.thresholds.overlapM }">
                        {{ fmtDist(row.nearestM) }}
                      </span>
                      <div class="ck-store-meta">{{ row.nearestName || (row.nearestM == null ? '20km 内无同品牌' : '') }}</div>
                    </template>
                    <span v-else class="ck-store-meta">{{ statusText(row.status) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="同品牌 800m 内" width="126">
                  <template #default="{ row }">
                    <span :class="{ 'ck-bad-num': row.peers800 >= 2 }">{{ row.status === 'evaluated' ? row.peers800 + ' 家' : '—' }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="竞品 800m 内" width="116">
                  <template #default="{ row }">
                    <template v-if="row.compStatus === 'evaluated'">
                      <span :class="{ 'ck-bad-num': row.compRing >= lights.thresholds.compMid }">{{ row.compRing }} 家</span>
                    </template>
                    <span v-else class="ck-store-meta" :title="compStatusText(row.compStatus)">未评</span>
                  </template>
                </el-table-column>
                <el-table-column label="所在商圈（仅展示）" min-width="150">
                  <template #default="{ row }">
                    <div>{{ row.district || '—' }}</div>
                    <div class="ck-store-meta">{{ row.district ? (row.crowd || '客群未知') : '不在已导入商圈面内' }}</div>
                  </template>
                </el-table-column>
              </el-table>
              <div v-if="!visibleLights.length" class="ck-empty-row">
                没有符合条件的门店 —— 这批门店既没有同品牌贴身，半径内也没有竞品密集。
              </div>
              <!-- 🔴 必须分页：196 行全铺开会把整页拉到 1.4 万像素高，
                   下面的「需复核清单」要滚很久才看得到（v1.13.297 真机实测） -->
              <div v-else-if="visibleLights.length > lightsPageSize" class="ck-pager">
                <el-button size="small" :disabled="lightsPage === 1" @click="lightsPage--">上一页</el-button>
                <span class="ck-pager-t">第 {{ lightsPage }} / {{ lightsPageCount }} 页（共 {{ visibleLights.length }} 家）</span>
                <el-button size="small" :disabled="lightsPage >= lightsPageCount" @click="lightsPage++">下一页</el-button>
              </div>
              <p v-else class="ck-foot-note">共 {{ visibleLights.length }} 家，已全部列出。</p>
            </div>
          </template>
        </section>

        <!-- 分布 -->
        <div class="ck-grid">
          <section class="ck-card">
            <h3>最近同品牌距离分布</h3>
            <p class="ck-card-sub">每家门店取「最近的一家同品牌门店」，跨品牌不参与。</p>
            <div v-for="b in distBuckets" :key="b.key" class="ck-bar-row">
              <span class="ck-bar-label">{{ b.label }}<em>{{ b.hint }}</em></span>
              <div class="ck-bar-track">
                <div class="ck-bar-fill" :class="'k-' + b.key" :style="{ width: pct(data.bucketCounts[b.key]) }"></div>
              </div>
              <span class="ck-bar-num">{{ data.bucketCounts[b.key] }}</span>
            </div>
          </section>

          <section class="ck-card">
            <h3>面积分档（{{ data.counts.withArea }} 家有值）</h3>
            <p class="ck-card-sub">两套店型叠在一起时，面积是最快的分辨线索。</p>
            <div v-for="b in areaBucketList" :key="b.key" class="ck-bar-row">
              <span class="ck-bar-label">{{ b.label }}</span>
              <div class="ck-bar-track">
                <div class="ck-bar-fill k-area" :style="{ width: pctArea(data.areaBuckets[b.key]) }"></div>
              </div>
              <span class="ck-bar-num">{{ data.areaBuckets[b.key] }}</span>
            </div>
            <p v-if="data.counts.noArea" class="ck-hint-warn">
              {{ data.counts.noArea }} 家缺面积 ⇒ 无法判断店型，也进不了销售预测
            </p>
          </section>
        </div>

        <!-- 复核清单 -->
        <section class="ck-card">
          <h3>
            需复核清单
            <span class="ck-count">共 {{ data.pairsTotal }} 对</span>
          </h3>
          <p class="ck-card-sub">
            <b>双店型</b> = 编码不同且面积差 2 倍以上，通常是同一商场「旗下不同品牌门店」，
            <b class="ck-strong">不建议合并</b>；<b>疑似</b> = 面积缺失或面积接近，请人工看一眼。
            点门店名可在地图上定位该店（复核「是同一个门还是隔壁门」最直观）。
          </p>

          <div v-if="data.pairsTotal === 0" class="ck-empty-row">
            在 {{ fmtDist(data.nearM) }} 内没有同品牌贴邻门店 —— 这批门店布局是分散的。
          </div>

          <template v-else>
          <div class="ck-tools">
            <el-checkbox v-model="onlySuspected" size="small">
              只看「疑似」（当前页 {{ suspectedInPage }} 对）
            </el-checkbox>
            <span v-if="onlySuspected && data.pairsTotal > data.pairs.length" class="ck-tip">
              仅筛选当前页，疑似可能分布在其它页
            </span>
          </div>

          <el-table v-if="visiblePairs.length" :data="visiblePairs" size="small" class="ck-table">
            <el-table-column label="距离" width="86">
              <template #default="{ row }">
                <span :class="['ck-dist', row.distance < 50 ? 'is-same' : '']">{{ fmtDist(row.distance) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="门店 A" min-width="160">
              <template #default="{ row }">
                <div class="ck-store">
                  <button
                    type="button"
                    class="ck-store-link"
                    :class="{ 'is-static': row.aLat == null }"
                    :disabled="row.aLat == null"
                    :title="row.aLat == null ? '该店缺经纬度，无法定位' : '在地图上定位「' + (row.aName || '未命名') + '」'"
                    @click="locate(row.aLat, row.aLng)"
                  >{{ row.aName || '（未命名）' }}</button>
                </div>
                <div class="ck-store-meta">{{ row.aCode || '无编码' }} · {{ row.aArea ? row.aArea + '㎡' : '无面积' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="门店 B" min-width="160">
              <template #default="{ row }">
                <div class="ck-store">
                  <button
                    type="button"
                    class="ck-store-link"
                    :class="{ 'is-static': row.bLat == null }"
                    :disabled="row.bLat == null"
                    :title="row.bLat == null ? '该店缺经纬度，无法定位' : '在地图上定位「' + (row.bName || '未命名') + '」'"
                    @click="locate(row.bLat, row.bLng)"
                  >{{ row.bName || '（未命名）' }}</button>
                </div>
                <div class="ck-store-meta">{{ row.bCode || '无编码' }} · {{ row.bArea ? row.bArea + '㎡' : '无面积' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="判定" width="110">
              <template #default="{ row }">
                <el-tag v-if="row.dualFormat" size="small" type="info">双店型</el-tag>
                <el-tag v-else size="small" type="warning">疑似</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="位置" min-width="160">
              <template #default="{ row }">
                <span class="ck-addr">{{ [row.city, row.address].filter(Boolean).join(' · ') || '—' }}</span>
              </template>
            </el-table-column>
          </el-table>

          <div v-else class="ck-empty-row">
            当前页没有需要人工判断的「疑似」记录；其余都是双店型（同集团多品牌门店），可不处理。
          </div>
          </template>

          <div v-if="data.pairsTotal > data.pageSize" class="ck-pager">
            <el-pagination
              layout="prev, pager, next, total"
              :total="data.pairsTotal"
              :page-size="data.pageSize"
              :current-page="data.page"
              @current-change="turnPage"
            />
          </div>

          <p class="ck-foot-note">
            要合并或标记「确认是两家」，请到
            <button type="button" class="ck-link" @click="goBack">门店管理 → 导入门店 → 门店清洗</button>。
          </p>
        </section>

        <!-- 完备度 -->
        <section class="ck-card">
          <h3>数据完备度<span class="ck-count">决定上面结论能推多远</span></h3>
          <p class="ck-card-sub">这一节不讲我们收录了多少数据，只讲<b>哪些结论现在下不了</b>。</p>
          <table class="ck-comp">
            <thead>
              <tr><th>检查项</th><th>现状</th><th>对结论的影响</th><th>怎么补</th></tr>
            </thead>
            <tbody>
              <tr :class="{ bad: data.completeness.salesRows === 0 }">
                <td>销售记录</td>
                <td>{{ data.completeness.salesRows }} 行</td>
                <td>
                  <template v-if="data.completeness.salesRows === 0">
                    无法判断任何一家店赚不赚钱，也无法回答「贴在一起的两家到底互补还是互抢」。
                    本页只能给结构，不能给优劣。
                  </template>
                  <template v-else-if="data.completeness.salesRows < 50">
                    只有 {{ data.completeness.salesRows }} 行，不足以支撑经营结论
                    （销售预测需 ≥50 行门店×年样本才启用 L2）
                  </template>
                  <template v-else>可结合销售做经营判断（本页仍只展示结构）</template>
                </td>
                <td class="ck-fix">
                  <el-button link type="primary" size="small" @click="openGuide('sales')">看字段说明</el-button>
                  <el-button link type="primary" size="small" @click="downloadSales">下载模板</el-button>
                </td>
              </tr>
              <tr :class="{ bad: data.completeness.categoryEmpty > 0 }">
                <td>门店区分</td>
                <td>{{ data.completeness.categoryEmpty }} 家为空</td>
                <td>
                  选址形态（商场店/临街店/写字楼店…）未填。<b>不影响本页任何数字</b>；
                  销售预测仍能出结果，只是参照店的「类型匹配」少一个加分项。
                  <template v-if="data.completeness.categoryEmptyReadonly">
                    <br/>其中 <b>{{ data.completeness.categoryEmptyReadonly }} 家</b>是集团下发门店，需在集团侧补。
                  </template>
                </td>
                <td class="ck-fix">
                  <el-button link type="primary" size="small" @click="goCategory">批量补门店区分</el-button>
                  <el-button link type="primary" size="small" @click="openGuide('store', 'store_category')">看字段</el-button>
                </td>
              </tr>
              <tr :class="{ bad: data.completeness.areaMissing > 0 }">
                <td>营业面积</td>
                <td>{{ data.completeness.areaMissing }} 家缺</td>
                <td>缺面积的店无法判店型（大店/小店），也进不了销售预测</td>
                <td class="ck-fix">
                  <el-button link type="primary" size="small" @click="openGuide('store', 'store_area')">补「门店面积」</el-button>
                </td>
              </tr>
              <tr :class="{ bad: data.completeness.coordMissing > 0 }">
                <td>经纬度</td>
                <td>{{ data.completeness.coordMissing }} 家缺</td>
                <td>没有坐标的店不参与任何间距计算，本页所有数字都不含它们</td>
                <td class="ck-fix">
                  <el-button link type="primary" size="small" @click="goGeocode">去地址解析</el-button>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="ck-foot-note">
            字段含义与示例值见弹窗里的「导入字段说明」（与系统实际解析的列同源）。
            销售记录可只填<b>档位区间</b>，不必暴露精确营业额。
          </p>
        </section>

        <ImportGuideDialog
          v-model="guideVisible"
          :tab="guideTab"
          :highlight="guideHighlight"
          @go="onGuideGo"
        />

        <p class="ck-disclaimer">{{ data.note }}｜本页不消耗任何第三方数据配额。</p>
      </template>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { ArrowLeft, WarningFilled, Download } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import ImportGuideDialog from '@/components/ImportGuideDialog.vue'
import { downloadSalesTemplate } from '@/utils/importTemplates.js'
import { buildCheckupPrintHtml } from '@/utils/checkupPrintReport.js'

const router = useRouter()
const loading = ref(false)
const errorMsg = ref('')
const data = ref(null)
const nearM = ref(300)
// 只看「疑似」：26 对里 9 对要人工判断，混在双店型里不好找（v1.13.295）
const onlySuspected = ref(false)
const suspectedInPage = computed(() => (data.value?.pairs || []).filter(p => !p.dualFormat).length)
const visiblePairs = computed(() => {
  const list = data.value?.pairs || []
  return onlySuspected.value ? list.filter(p => !p.dualFormat) : list
})

/** 跳到地图并定位到该店（MapView 认 ?lat=&lng=，会 setView z16） */
function locate(lat, lng) {
  if (lat == null || lng == null) return
  router.push({ path: '/', query: { lat, lng } })
}

// 「怎么补」：所有字段说明都指向同一个弹窗，⛔ 不在本页另写一份字段清单
const guideVisible = ref(false)
const guideTab = ref('store')
const guideHighlight = ref('')

function openGuide(tab, highlight = '') {
  guideTab.value = tab
  guideHighlight.value = highlight
  guideVisible.value = true
}

async function downloadSales() {
  const ok = await downloadSalesTemplate()
  if (!ok) ElMessage.error('模板下载失败，请稍后重试')
}

/** 补门店区分同样是成批的活：直达 /data 的批量弹窗（单店编辑一次只能改一家） */
function goCategory() { router.push({ path: '/data', query: { category: '1' } }) }

/** 补坐标要成批做，直接把人送到「地址解析」并自动打开它 */
function goGeocode() { router.push({ path: '/data', query: { geocode: '1' } }) }

/** 弹窗里的「去录入」：销售要落到具体的录入弹窗，别只丢到列表页 */
function onGuideGo(kind) {
  guideVisible.value = false
  if (kind === 'sales') router.push({ path: '/data', query: { sale: '1' } })
  else router.push('/data')
}

// 分档顺序与后端 utils/storeCheckup.js 的 DISTANCE_BUCKETS 一一对应
// ⚠️ 两边改一处必须同改，否则条形图会错位（数值对不上标签）
// 🔴 销售记录「能不能支撑经营判断」要分档：后端 L2 训练门槛是 50 行（门店×年），
//    ⛔ 不能写成「非 0 就能判断」—— 实测 youshi 只有 5 行，说「可做经营判断」是误导。
const salesHint = computed(() => {
  const n = data.value?.completeness?.salesRows ?? 0
  if (n === 0) return '无销售数据 ⇒ 只能看结构'
  if (n < 50) return `样本不足（L2 需 ≥50 行）⇒ 仅能粗看`
  return '可结合销售做经营判断'
})

const distBuckets = [
  { key: 'same', label: '同址', hint: '<50m' },
  { key: 'close', label: '贴身', hint: '50–300m' },
  { key: 'overlap', label: '部分重叠', hint: '300–800m' },
  { key: 'weak', label: '弱重叠', hint: '0.8–2km' },
  { key: 'alone', label: '基本独立', hint: '>2km' }
]
const areaBucketList = [
  { key: 'xs', label: '<120㎡' },
  { key: 's', label: '120–200㎡' },
  { key: 'm', label: '200–350㎡' },
  { key: 'l', label: '≥350㎡' }
]

const maxBucket = computed(() => {
  if (!data.value) return 1
  return Math.max(1, ...Object.values(data.value.bucketCounts))
})
const maxArea = computed(() => {
  if (!data.value) return 1
  return Math.max(1, ...Object.values(data.value.areaBuckets))
})
const pct = (n) => Math.round((n / maxBucket.value) * 100) + '%'
const pctArea = (n) => Math.round((n / maxArea.value) * 100) + '%'

function fmtDist(m) {
  if (m == null) return '—'
  if (m >= 1000) return (m / 1000).toFixed(2) + 'km'
  return Math.round(m) + 'm'
}


// ===== 门店信号灯（v1.13.299 半径骨架）=====
const lights = ref(null)
const lightsLoading = ref(false)
const lightsErrorMsg = ref('')
const onlyLit = ref(false)
// 默认只列已评估的；勾「含未评估」才把缺坐标的店列出来
// —— 客户最想知道「哪些店看不出问题」，只给个数字不给出名单等于没回答。
const showBlind = ref(false)

const topLights = computed(() => (lights.value?.lights || []).filter(l => l.status === 'evaluated'))
const visibleLights = computed(() => {
  let list = lights.value?.lights || []
  if (!showBlind.value) list = list.filter(l => l.status === 'evaluated')
  if (onlyLit.value) list = list.filter(l => l.riskLevel === 'high' || l.riskLevel === 'mid')
  return list
})
// 分页（页大小 20）：一屏看完前 20 家高风险，比滚 196 行有用
const lightsPageSize = 20
const lightsPage = ref(1)
const lightsPageCount = computed(() => Math.max(1, Math.ceil(visibleLights.value.length / lightsPageSize)))
const pagedLights = computed(() => {
  const start = (lightsPage.value - 1) * lightsPageSize
  return visibleLights.value.slice(start, start + lightsPageSize)
})
// 换筛选条件后回到第 1 页，否则会停在一个不存在的页码上显示空表
watch([showBlind, onlyLit], () => { lightsPage.value = 1 })

function statusText(s) {
  return { no_coord: '缺经纬度', evaluated: '已评估' }[s] || '未评估'
}
/** 竞争维度为什么没评 —— 鼠标悬停看原因，⛔ 别让「未评」被读成「很宽松」 */
function compStatusText(s) {
  return {
    no_data: '该城市没有竞品点位：本维度未评，不等于竞争宽松',
    no_city: '门店城市为空，无法判断竞品覆盖'
  }[s] || '未评'
}
function levelText(l) {
  return { high: '红', mid: '黄', low: '绿', none: '绿' }[l] || '灰'
}
/** 命中规则 → 人话（⛔ 别把 competition/cannibal 这种字段名直接摆给客户） */
function flagsText(flags) {
  const map = { competition: '竞争密集', cannibal: '自我蚕食' }
  return (flags || []).map(f => map[f] || f).join(' / ') || '未命中'
}

async function loadLights() {
  lightsLoading.value = true
  lightsErrorMsg.value = ''
  try {
    const { data: res } = await axios.get('/api/markers/checkup/lights', { params: { top: 200 } })
    lights.value = res
  } catch (e) {
    // 信号灯失败不该拖垮整页几何体检 —— 单独降级
    lightsErrorMsg.value = e?.response?.data?.message || '商圈信号灯计算失败（几何部分不受影响）'
  } finally {
    lightsLoading.value = false
  }
}

// ===== 报告导出（v1.13.298）=====
const exporting = ref(false)

/** 从 Content-Disposition 取中文文件名（后端给了 filename*=UTF-8''…） */
function filenameFromDisposition(cd) {
  if (!cd) return ''
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  if (m) { try { return decodeURIComponent(m[1]) } catch (e) { /* 落回下一分支 */ } }
  const m2 = /filename="([^"]+)"/i.exec(cd)
  return m2 ? m2[1] : ''
}

async function onExport(kind) {
  if (kind === 'print') return openPrintReport()
  exporting.value = true
  try {
    const res = await axios.get('/api/markers/checkup/report', {
      params: { nearM: nearM.value },
      responseType: 'blob'
    })
    const name = filenameFromDisposition(res.headers['content-disposition']) || '门店体检报告.xlsx'
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    // 🔴 responseType=blob 时错误体也是 Blob，必须读出来才能显示后端的中文提示
    let msg = '报告导出失败，请稍后重试'
    const d = e?.response?.data
    if (d instanceof Blob) {
      try { const j = JSON.parse(await d.text()); if (j?.message) msg = j.message } catch (_) { /* 用默认文案 */ }
    } else if (d?.message) {
      msg = d.message
    }
    ElMessage.error(msg)
  } finally {
    exporting.value = false
  }
}

/**
 * 打印版：客户端生成 HTML（无脚本，合规 CSP）→ 新窗口 → 唤起系统打印（可另存为 PDF）。
 * ⛔ 不让服务器生成 PDF：本机只装了 LibreOffice，中文分页难看且要起一个几百 MB 的进程。
 */
function openPrintReport() {
  if (!data.value) return ElMessage.warning('体检数据还在加载，请稍候再导出')
  const html = buildCheckupPrintHtml({ data: data.value, lights: lights.value })
  const w = window.open('', '_blank')
  if (!w) return ElMessage.warning('浏览器拦截了新窗口，请允许弹窗后重试')
  w.document.open()
  w.document.write(html)
  w.document.close()
  // 等排版完成再唤起打印；报告页本身没有脚本，只能由打开方调用
  setTimeout(() => {
    try { w.focus(); w.print() } catch (e) { /* 用户也可手动 Cmd/Ctrl+P */ }
  }, 400)
}

async function load(page = 1) {
  loading.value = true
  errorMsg.value = ''
  try {
    const { data: res } = await axios.get('/api/markers/checkup', {
      params: { nearM: nearM.value, page, pageSize: 50 }
    })
    data.value = res
  } catch (e) {
    errorMsg.value = e?.response?.data?.message || '门店体检计算失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function reload() { load(1); loadLights() }
function turnPage(p) { load(p) }
function goBack() { router.push('/data') }

onMounted(() => {
  load(1)
  // 信号灯单独请求：要跑商圈匹配，比几何慢，⛔ 不要阻塞首屏
  loadLights()
})
</script>

<style scoped>
/* 🔴 v1.13.295：外层 `.main-content{overflow:hidden}` 不会滚，
   本页不自带滚动条就永远只能看到首屏（复核清单只露 5 行、后面的既看不到也滚不到）。 */
.checkup-page { padding: 4px 2px 40px; height: 100%; overflow-y: auto; box-sizing: border-box; }
.ck-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
.ck-head h2 { margin: 6px 0 4px; font-size: 20px; }
.ck-sub { margin: 0; font-size: 13px; color: #6b7280; max-width: 720px; line-height: 1.6; }
.ck-head-r { display: flex; align-items: center; gap: 8px; }
.ck-label { font-size: 13px; color: #6b7280; }

.ck-error { display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 8px; font-size: 13px; }
.ck-loading { padding: 40px; text-align: center; color: #6b7280; font-size: 13px; }

.ck-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 14px; }
.ck-kpi { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; }
.ck-kpi.warn { border-color: #fcd34d; background: #fffbeb; }
.ck-kpi-n { font-size: 24px; font-weight: 700; line-height: 1.2; color: #111827; }
.ck-kpi-l { font-size: 13px; color: #374151; margin-top: 2px; }
.ck-kpi-h { font-size: 12px; color: #6b7280; margin-top: 4px; }

.ck-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
@media (max-width: 900px) { .ck-grid { grid-template-columns: 1fr; } }

.ck-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
.ck-card h3 { margin: 0 0 4px; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.ck-card-sub { margin: 0 0 12px; font-size: 12px; color: #6b7280; line-height: 1.6; }
.ck-count { font-size: 12px; font-weight: 400; color: #6b7280; }
.ck-strong { color: #b45309; }

.ck-bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
.ck-bar-label { width: 108px; flex: none; color: #374151; }
.ck-bar-label em { font-style: normal; color: #9ca3af; font-size: 11px; margin-left: 4px; }
.ck-bar-track { flex: 1; height: 14px; background: #f3f4f6; border-radius: 7px; overflow: hidden; }
.ck-bar-fill { height: 100%; border-radius: 7px; background: #93c5fd; transition: width .25s; }
.ck-bar-fill.k-same { background: #ef4444; }
.ck-bar-fill.k-close { background: #f59e0b; }
.ck-bar-fill.k-overlap { background: #fbbf24; }
.ck-bar-fill.k-weak { background: #a3a3a3; }
.ck-bar-fill.k-alone { background: #86efac; }
.ck-bar-fill.k-area { background: #7dd3fc; }
.ck-bar-num { width: 44px; flex: none; text-align: right; color: #111827; font-variant-numeric: tabular-nums; }

.ck-lights { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 12px; }
.ck-light { border-radius: 10px; padding: 12px 14px; border: 1px solid #e5e7eb; background: #fafafa; }
.ck-light-n { font-size: 24px; font-weight: 700; line-height: 1.2; }
.ck-light-l { font-size: 13px; color: #374151; margin-top: 2px; }
.ck-light-h { font-size: 11px; color: #6b7280; margin-top: 3px; }
.ck-light.l-red { background: #fef2f2; border-color: #fecaca; }
.ck-light.l-red .ck-light-n { color: #b91c1c; }
.ck-light.l-yellow { background: #fffbeb; border-color: #fcd34d; }
.ck-light.l-yellow .ck-light-n { color: #b45309; }
.ck-light.l-green { background: #f0fdf4; border-color: #bbf7d0; }
.ck-light.l-green .ck-light-n { color: #15803d; }
.ck-light.l-gray.is-warn { background: #f3f4f6; border-style: dashed; border-color: #d1d5db; }

.ck-rule-list { list-style: none; margin: 0 0 4px; padding: 0; }
.ck-rule-list li { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; padding: 7px 0; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
.ck-rule-list li:last-child { border-bottom: 0; }
.ck-rule-name { font-weight: 600; color: #111827; min-width: 72px; }
.ck-rule-sub { color: #6b7280; font-size: 12px; flex: 1; min-width: 220px; }
.ck-rule-n { font-variant-numeric: tabular-nums; color: #111827; font-weight: 600; }
.ck-rule-more { flex-basis: 100%; font-size: 11px; color: #9ca3af; padding-left: 80px; }

.ck-lights-table { margin-top: 10px; }
.ck-lights-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.ck-lights-bar-t { font-size: 12px; color: #6b7280; }
.ck-lights-switch { display: flex; align-items: center; gap: 14px; }
.ck-pager-t { font-size: 12px; color: #6b7280; }
.ck-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; background: #d1d5db; }
.ck-dot.d-high { background: #dc2626; }
.ck-dot.d-mid { background: #f59e0b; }
.ck-dot.d-low, .ck-dot.d-none { background: #22c55e; }
.ck-bad-num { color: #b91c1c; font-weight: 600; }
.ck-lights-loading { padding: 24px; text-align: center; color: #6b7280; font-size: 13px; }

.ck-hint-warn { margin: 10px 0 0; font-size: 12px; color: #b45309; }
.ck-empty-row { padding: 18px 0; font-size: 13px; color: #6b7280; }
.ck-dist { font-variant-numeric: tabular-nums; color: #374151; }
.ck-dist.is-same { color: #b91c1c; font-weight: 600; }
.ck-store { font-size: 13px; color: #111827; }
/* 门店名做成按钮：⛔ 不用 `<a href>` 的伪协议链接（CSP script-src 会拦，见 §6.22） */
.ck-store-link { background: none; border: 0; padding: 0; font: inherit; color: #2563eb; cursor: pointer; text-align: left; }
.ck-store-link:hover { text-decoration: underline; }
.ck-store-link.is-static { color: #111827; cursor: default; }
.ck-store-link.is-static:hover { text-decoration: none; }
.ck-tools { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.ck-tip { font-size: 12px; color: #b45309; }
.ck-store-meta { font-size: 11px; color: #6b7280; margin-top: 1px; }
.ck-addr { font-size: 12px; color: #4b5563; }
.ck-pager { margin-top: 12px; display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.ck-foot-note { margin: 12px 0 0; font-size: 12px; color: #6b7280; }
.ck-link { background: none; border: 0; padding: 0; font: inherit; color: #2563eb; cursor: pointer; }
.ck-link:hover { text-decoration: underline; }

.ck-comp { width: 100%; border-collapse: collapse; font-size: 13px; }
.ck-comp th, .ck-comp td { border-bottom: 1px solid #eef0f3; padding: 9px 10px; text-align: left; vertical-align: top; }
.ck-comp th { font-weight: 600; color: #374151; background: #fafafa; }
.ck-comp td:nth-child(2) { white-space: nowrap; color: #111827; }
.ck-comp tr.bad td:nth-child(2) { color: #b91c1c; font-weight: 600; }
.ck-comp td:last-child { color: #4b5563; line-height: 1.6; }
.ck-comp td.ck-fix { white-space: nowrap; }
.ck-comp td.ck-fix .el-button + .el-button { margin-left: 4px; }

.ck-disclaimer { font-size: 12px; color: #9ca3af; margin: 0; }
</style>
