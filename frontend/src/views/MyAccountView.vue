<template>
  <div class="account-container">
    <el-card class="account-card">
      <template #header>
        <div class="card-header">
          <span>我的账户</span>
        </div>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="100px"
        class="account-form"
      >
        <el-form-item label="用户名">
          <el-input v-model="userStore.username" disabled />
        </el-form-item>

        <el-form-item label="公司">
          <el-input v-model="form.company" placeholder="请输入公司名称" />
        </el-form-item>

        <el-form-item label="报告Logo">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div v-if="form.logoPreview" style="width: 56px; height: 56px; border: 1px solid #ebeef5; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #fff; flex-shrink: 0;">
              <img :src="form.logoPreview" style="max-width: 100%; max-height: 100%; object-fit: contain;" alt="Logo预览" />
            </div>
            <div v-else style="width: 56px; height: 56px; border: 1px dashed #dcdfe6; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #c0c4cc; font-size: 11px; flex-shrink: 0;">无Logo</div>
            <div>
              <el-upload
                :show-file-list="false"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                :before-upload="handleLogoUpload"
              >
                <el-button size="small">上传 Logo</el-button>
              </el-upload>
              <div style="font-size: 11px; color: #999; margin-top: 4px;">PNG/JPG/WEBP/SVG，建议正方形（≤500KB）。用于 PDF 速览 / 导出报表头部</div>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="请输入新邮箱" />
        </el-form-item>

        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            placeholder="请输入新密码（不修改请留空）"
            show-password
          />
        </el-form-item>

        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            show-password
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="loading" @click="handleSubmit">
            保存修改
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 剩余次数卡片 -->
    <el-card class="quota-card">
      <template #header>
        <div class="card-header">
          <span>📊 联通人口数据配额</span>
        </div>
      </template>
      <div class="quota-content">
        <div class="quota-item">
          <span class="quota-label">剩余次数</span>
          <span class="quota-value available">{{ userStore.availableQuota }}</span>
          <span class="quota-unit">次</span>
        </div>
        <div class="quota-info">
          <p>• 1个位置 + 1个半径 + 1个年月 = 1次</p>
          <p>• 每次查询扣减1次配额</p>
          <p v-if="userStore.quota">• 当前配额: {{ userStore.quota.total }} 次（累计配额: {{ userStore.quota.cumulativeTotal }} 次）</p>
          <p v-if="userStore.quota">• 当前已使用: {{ userStore.quota.used }} 次（累计使用: {{ userStore.quota.cumulativeUsed }} 次）</p>
        </div>
        <div class="quota-actions">
          <el-button type="text" @click="refreshQuota" :loading="quotaLoading">
            🔄 刷新配额
          </el-button>
          <el-button type="text" @click="showQuotaHistoryDialog">
            📜 充值履历
          </el-button>
          <el-button type="text" @click="showHistoryDialog">
            📋 购买履历
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- 购买履历对话框 -->
    <el-dialog
      v-model="historyDialogVisible"
      width="1360px"
      :close-on-click-modal="false"
      class="history-dialog dialog-fancy"
    >
      <template #header>
        <div class="dialog-header-fancy">
          <span class="dhf-icon" style="background:#e6f1fb;">📋</span>
          <div>
            <div class="dhf-title">购买履历</div>
            <div class="dhf-sub">历史查询订单与配额消耗记录</div>
          </div>
        </div>
      </template>
      <!-- 筛选表单 -->
      <div class="history-filter">
        <el-input
          v-model="filterKeywords"
          placeholder="搜索门店名称"
          style="width: 180px"
          clearable
          @input="handleFilterChange"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select v-model="filterStoreType" placeholder="门店类型" style="width: 120px" clearable @change="handleFilterChange">
          <el-option label="已开业" value="已开业" />
          <el-option label="重点候选" value="重点候选" />
          <el-option label="一般候选" value="一般候选" />
        </el-select>
        <el-select v-model="filterCity" placeholder="城市" style="width: 120px" clearable @change="handleFilterChange">
          <el-option v-for="city in cityOptions" :key="city" :label="city" :value="city" />
        </el-select>
        <el-select v-model="filterDistrict" placeholder="区县" style="width: 120px" clearable @change="handleFilterChange">
          <el-option v-for="d in districtOptions" :key="d" :label="d" :value="d" />
        </el-select>
        <el-select v-model="filterRadius" placeholder="半径" style="width: 120px" clearable @change="handleFilterChange">
          <el-option v-for="r in radiusOptions" :key="r" :label="r" :value="r" />
        </el-select>
        <el-select v-model="filterCityMonth" placeholder="数据年月" style="width: 130px" clearable @change="handleFilterChange">
          <el-option v-for="m in cityMonthOptions" :key="m" :label="m" :value="m" />
        </el-select>
        <el-button v-if="hasActiveFilters" type="warning" plain @click="resetFilters">
          <el-icon><Close /></el-icon>清除筛选
        </el-button>
        <span class="filter-count">共 {{ filteredHistoryList.length }} 条</span>
        <el-button type="primary" size="small" style="margin-left: 12px;" :disabled="compareSelected.length < 2" @click="openCompareDialog">
          📊 对比分析{{ compareSelected.length > 0 ? ` (${compareSelected.length})` : '' }}
        </el-button>
        <el-button v-if="compareSelected.length > 0" size="small" @click="clearCompareSelection">
          清空选择
        </el-button>
      </div>

      <div v-if="historyLoading" class="history-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载中...</span>
      </div>
      <el-table
        v-else
        :data="filteredHistoryList"
        stripe
        border
        style="width: 100%"
        @selection-change="handleCompareSelectionChange"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column label="订单ID" width="130" fixed>
          <template #default="{ row }">
            <span style="font-size:12px;white-space:nowrap;">{{ row.order_no || row.id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="购买时间" width="120">
          <template #default="{ row }">
            {{ row.created_at ? formatDate(row.created_at) : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="门店名称" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.store_name || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="门店类型" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.store_type" size="small">{{ row.store_type }}</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="城市" width="80">
          <template #default="{ row }">
            <span>{{ row.city || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="区县" width="80">
          <template #default="{ row }">
            <span>{{ row.district || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="半径" width="90">
          <template #default="{ row }">
            {{ row.radius_display || (row.radius ? row.radius + '米' : '-') }}
          </template>
        </el-table-column>
        <el-table-column label="数据年月" width="100" align="center">
          <template #default="{ row }">
            <template v-if="row.city_month">
              <el-tooltip :content="isCityMonthExpired(row.city_month) ? '数据距今超过12个月，建议更新' : '数据年月'" placement="top">
                <span :style="isCityMonthExpired(row.city_month) ? { color: '#f56c6c', fontWeight: 'bold', cursor: 'pointer' } : { color: '#67c23a', cursor: 'pointer' }">
                  <span v-if="isCityMonthExpired(row.city_month)" style="margin-right: 2px;">⏰</span>{{ row.city_month }}
                </span>
              </el-tooltip>
            </template>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="扣除次数" width="80" align="center">
          <template #default="{ row }">
            <span class="quota-used">{{ row.quota_used ? '-' + row.quota_used : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="剩余次数" width="80" align="center">
          <template #default="{ row }">
            <span class="quota-remaining">{{ row.remaining ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="75" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="viewPurchaseDetail(row)">
              查看结果
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 查询结果对比对话框（多订单同图对比） -->
    <el-dialog v-model="compareDialogVisible" width="960px" class="dialog-fancy" :close-on-click-modal="false" @closed="disposeCompareCharts">
      <template #header>
        <div class="dialog-header-fancy">
          <span class="dhf-icon" style="background:#e1f5ee;">📊</span>
          <div>
            <div class="dhf-title">查询结果对比</div>
            <div class="dhf-sub">最多 5 笔订单同图对比 · 人口 / 客流 / 消费</div>
          </div>
        </div>
      </template>
      <div v-if="compareLoading" style="text-align:center;padding:40px;color:#909399;">
        <el-icon class="is-loading"><Loading /></el-icon>
        <p style="margin-top:8px;">正在加载对比数据...</p>
      </div>
      <template v-else>
        <!-- 对比订单信息 -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
          <el-tag v-for="(item, idx) in compareOrders" :key="item.id" :type="['primary','success','warning','danger','info'][idx % 5]" effect="light" closable @close="removeCompareOrder(item.id)">
            {{ item.store_name || '订单' + item.id }}（{{ item.radius_display || item.radius + '米' }}）
          </el-tag>
        </div>

        <div v-if="compareOrders.length < 2" style="text-align:center;padding:30px;color:#999;">
          请至少选择 2 笔订单进行对比（在购买履历列表勾选）
        </div>

        <template v-else>
          <!-- 人口规模对比 -->
          <div class="compare-chart-block">
            <h4 style="margin:0 0 8px;font-size:14px;color:#333;">👥 人口规模对比（到访/居住/工作）</h4>
            <div ref="comparePopEl" class="compare-chart-box"></div>
          </div>
          <!-- 客流活跃度对比 -->
          <div class="compare-chart-block">
            <h4 style="margin:16px 0 8px;font-size:14px;color:#333;">⏰ 客流活跃度对比（小时段到访）</h4>
            <div ref="compareFlowEl" class="compare-chart-box"></div>
          </div>
          <!-- 消费能力对比 -->
          <div class="compare-chart-block">
            <h4 style="margin:16px 0 8px;font-size:14px;color:#333;">💰 消费水平对比（居住+工作）</h4>
            <div ref="compareConsumeEl" class="compare-chart-box"></div>
          </div>
        </template>
      </template>
      <template #footer>
        <el-button @click="compareDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 充值履历对话框（管理员分配配额历史） -->
    <el-dialog v-model="quotaHistoryDialogVisible" width="700px" class="dialog-fancy" :close-on-click-modal="false">
      <template #header>
        <div class="dialog-header-fancy">
          <span class="dhf-icon" style="background:#faeeda;">📜</span>
          <div>
            <div class="dhf-title">充值履历</div>
            <div class="dhf-sub">管理员分配 / 退款配额记录</div>
          </div>
        </div>
      </template>
      <div v-if="quotaHistoryLoading" style="text-align:center;padding:30px;color:#909399;">加载中...</div>
      <template v-else>
        <el-table :data="quotaHistoryList" stripe border style="width:100%" :max-height="420">
          <el-table-column label="时间" width="160">
            <template #default="{ row }">
              {{ row.created_at ? formatDate(row.created_at) : '-' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.change_amount >= 0 ? 'success' : 'danger'" size="small">
                {{ row.change_amount >= 0 ? '分配' : '退款' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="变化量" width="100" align="center">
            <template #default="{ row }">
              <span :style="{ color: row.change_amount >= 0 ? '#67c23a' : '#f56c6c', fontWeight: 600 }">
                {{ row.change_amount >= 0 ? '+' : '' }}{{ row.change_amount }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="变化前" width="90" align="center">
            <template #default="{ row }">{{ row.old_quota }}</template>
          </el-table-column>
          <el-table-column label="变化后" width="90" align="center">
            <template #default="{ row }">{{ row.new_quota }}</template>
          </el-table-column>
        </el-table>
        <div v-if="quotaHistoryList.length === 0" style="text-align:center;padding:30px;color:#909399;">暂无配额分配记录</div>
      </template>
    </el-dialog>

    <!-- 查看结果对话框 -->
    <el-dialog
      v-model="detailDialogVisible"
      width="95%"
      style="max-width:1400px"
      top="2vh"
      draggable
      class="detail-dialog"
    >
      <template #header>
        <div class="dialog-header-flex">
          <span>📊 查询结果详情 - {{ currentDetail?.store_name || '订单' + currentDetail?.id }}</span>
          <div class="dialog-header-actions">
            <el-button type="danger" size="small" @click="handleStoreScore" :disabled="detailLoading || !currentDetail">
              ⭐ 商圈评分
            </el-button>
            <el-button type="primary" size="small" class="btn-insight" @click="handleDataInsight" :disabled="!resultData || insightLoading">
              {{ insightLoading ? '分析中...' : (insights.length > 0 ? '🔄 重新分析' : '📋 数据洞察') }}
            </el-button>
            <el-button type="primary" size="small" @click="handleExportPDF" :disabled="detailLoading || !currentDetail">
              📄 PDF速览
            </el-button>
            <el-button type="warning" size="small" @click="handleShareToWeChat" :disabled="detailLoading || !currentDetail">
              💬 微信分享
            </el-button>
            <el-dropdown @command="handleExportDropdown" :disabled="detailLoading || !currentDetail" trigger="click">
              <el-button type="success" size="small">
                📊 导出报表<el-icon><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="excel">📊 导出Excel</el-dropdown-item>
                  <el-dropdown-item command="pdf">📄 导出PDF</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </template>
      <div v-if="detailLoading" class="detail-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载中...</span>
      </div>
      <div v-else-if="currentDetail" class="detail-horizontal-layout" ref="pdfContentRef">
        <!-- 左栏：信息 + 表格 -->
        <div class="detail-left">
          <div class="detail-info">
            <p><strong>订单ID:</strong> {{ currentDetail.id }}</p>
            <p><strong>查询时间:</strong> {{ formatDate(currentDetail.created_at) }}</p>
            <p><strong>位置:</strong> {{ currentDetail.center_lat?.toFixed(6) }}, {{ currentDetail.center_lng?.toFixed(6) }}</p>
            <p><strong>半径:</strong> {{ currentDetail.radii?.join(', ') }}米</p>
            <p><strong>数据年月:</strong> {{ currentDetail.city_month }}</p>
          </div>
          <!-- 商圈评分（横向 5 指标评分卡，点击「商圈评分」按钮后显示） -->
          <div v-if="storeScoreVisible && storeScoreItems.length > 0" class="score-section">
            <h4 style="margin:0 0 10px;font-size:14px;color:#333;">⭐ 商圈评分</h4>
            <div v-if="storeScoreInsufficient" class="score-insufficient">
              <span>⚠️</span>
              <span>评分用数据不足（所在城市、不同位置、相同半径的订单少于 10 次），评分结果仅供参考</span>
            </div>
            <div class="score-grid">
              <div v-for="(item, idx) in storeScoreItems" :key="idx" class="score-card">
                <div class="score-label">{{ item.label }}</div>
                <div class="score-stars">
                  <span v-for="n in 5" :key="n" class="star" :class="{ 'star-on': n <= item.stars, 'star-off': n > item.stars }">★</span>
                </div>
                <div class="score-value">{{ item.value }}</div>
              </div>
            </div>
          </div>
          <!-- 数据洞察 -->
          <div v-if="insights.length > 0" class="insight-section">
            <h4 style="margin:0 0 10px;font-size:14px;color:#333;">📋 数据洞察</h4>
            <div v-for="(item, idx) in insights" :key="idx" :class="['insight-item', 'insight-' + item.type]">
              <span class="insight-icon">{{ item.type === 'positive' ? '✅' : item.type === 'warning' ? '⚠️' : '💡' }}</span>
              <span class="insight-text">{{ item.text }}</span>
            </div>
          </div>
          <div v-if="resultData" class="detail-result">
            <div class="result-grid" v-html="formatResultData(resultData)"></div>
          </div>
          <div v-else class="no-result">
            <p>暂无数据（该订单配额已返还）</p>
          </div>
        </div>
        <!-- 右栏：图表列表 -->
        <div class="detail-right" v-if="chartList.length > 0">
          <h4 style="margin:0 0 12px;font-size:15px;color:#333;">📈 数据可视化</h4>
          <div v-for="item in chartList" :key="item.serviceCode" class="chart-card">
            <h5 class="chart-title">{{ item.title }}</h5>
            <div :ref="el => registerChartEl(el, item.chartKey)" class="chart-box"></div>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- 微信分享预览对话框 -->
    <el-dialog
      v-model="shareDialogVisible"
      width="420px"
      :close-on-click-modal="true"
      class="share-dialog dialog-fancy"
    >
      <template #header>
        <div class="dialog-header-fancy">
          <span class="dhf-icon" style="background:#e1f5ee;">💬</span>
          <div>
            <div class="dhf-title">微信分享</div>
            <div class="dhf-sub">生成分享卡片发送给好友</div>
          </div>
        </div>
      </template>
      <div class="share-preview" v-if="shareImageData">
        <img :src="shareImageData" alt="分享图片" style="width: 100%; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
      </div>
      <p class="share-hint">
        📌 长按图片保存到相册，即可分享到微信
      </p>
      <template #footer>
        <div class="share-actions">
          <el-button type="primary" @click="copyImageToClipboard">
            📋 复制图片
          </el-button>
          <el-button @click="downloadShareImage">
            📥 保存图片
          </el-button>
        </div>
        <p class="share-tip">电脑端：复制图片后到微信按 Ctrl+V 粘贴发送</p>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import echarts from '@/utils/echarts'
import { captureMapToCanvas, captureMapOnlyCanvas, captureShoppingCenterMap } from '@/utils/mapCapture'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { Loading, Location, Search, Close, ArrowDown } from '@element-plus/icons-vue'
import axios from 'axios'
import { FIELD_LABELS } from './field_labels'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const formRef = ref(null)
const loading = ref(false)
const quotaLoading = ref(false)

// 购买履历相关
const historyDialogVisible = ref(false)
const historyLoading = ref(false)
const historyList = ref([])

// 充值履历（配额分配历史）相关
const quotaHistoryDialogVisible = ref(false)
const quotaHistoryLoading = ref(false)
const quotaHistoryList = ref([])

// 筛选相关
const filterKeywords = ref('')
const filterStoreType = ref('')
const filterCity = ref('')
const filterDistrict = ref('')
const filterRadius = ref('')
const filterCityMonth = ref('')

// 筛选选项（从历史数据中提取）
const storeTypeOptions = ['已开业', '重点候选', '一般候选']
const cityOptions = computed(() => [...new Set(historyList.value.map(h => h.city).filter(Boolean))])
const districtOptions = computed(() => [...new Set(historyList.value.map(h => h.district).filter(Boolean))])
const radiusOptions = computed(() => [...new Set(historyList.value.map(h => h.radius_display || h.radius).filter(Boolean))])
const cityMonthOptions = computed(() => [...new Set(historyList.value.map(h => h.city_month).filter(Boolean))])

// 是否有激活的筛选条件
const hasActiveFilters = computed(() => {
  return filterKeywords.value || filterStoreType.value || filterCity.value || filterDistrict.value || filterRadius.value || filterCityMonth.value
})

// 筛选后的历史列表
const filteredHistoryList = computed(() => {
  return historyList.value.filter(h => {
    // 关键词搜索（门店名称）
    if (filterKeywords.value && !h.store_name?.toLowerCase().includes(filterKeywords.value.toLowerCase())) {
      return false
    }
    // 门店类型
    if (filterStoreType.value && h.store_type !== filterStoreType.value) {
      return false
    }
    // 城市
    if (filterCity.value && h.city !== filterCity.value) {
      return false
    }
    // 区县
    if (filterDistrict.value && h.district !== filterDistrict.value) {
      return false
    }
    // 半径
    if (filterRadius.value && h.radius_display !== filterRadius.value && h.radius !== filterRadius.value) {
      return false
    }
    // 数据年月
    if (filterCityMonth.value && h.city_month !== filterCityMonth.value) {
      return false
    }
    return true
  })
})

// 筛选变化时重置页码
const handleFilterChange = () => {
  // 如果有筛选条件，自动定位到第一页
}

// 重置筛选
const resetFilters = () => {
  filterKeywords.value = ''
  filterStoreType.value = ''
  filterCity.value = ''
  filterDistrict.value = ''
  filterRadius.value = ''
  filterCityMonth.value = ''
}

// 查看详情相关
const detailDialogVisible = ref(false)
const detailLoading = ref(false)
const currentDetail = ref(null)
const resultData = ref(null)

// 商圈评分：点击「商圈评分」按钮后显示评分卡片；storeScoreInsufficient 标记同城同半径订单 <10
const storeScoreVisible = ref(false)
const storeScoreItems = ref([])
const storeScoreInsufficient = ref(false)

// 点击「商圈评分」：提示 → 统计同城同半径订单数 → 显示评分卡（<10 笔标记数据不足）
const handleStoreScore = async () => {
  if (!currentDetail.value) return
  // 提示文案（用户确认）
  let confirmed = false
  try {
    await ElMessageBox.confirm(
      '建议所在城市、不同位置、相同半径数据查询 10 次以上使用。是否继续？',
      '⭐ 商圈评分',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'info' }
    )
    confirmed = true
  } catch (e) {
    // 用户取消
  }
  if (!confirmed) return

  // 统计同城、不同位置、相同半径的订单数（含当前订单）
  const cur = currentDetail.value
  const curCity = cur.city || cur.district || ''
  const curRadius = parseOrderRadius(cur) || []
  const curRadiusKey = [...curRadius].sort((a, b) => a - b).join(',')
  let sameCount = 0
  for (const h of historyList.value) {
    if (h.id === cur.id) continue
    const hCity = h.city || h.district || ''
    if (curCity && hCity && hCity !== curCity) continue
    const hR = parseOrderRadius(h) || []
    const hKey = [...hR].sort((a, b) => a - b).join(',')
    if (curRadiusKey && hKey !== curRadiusKey) continue
    sameCount++
  }
  sameCount += 1 // 加当前订单本身
  storeScoreInsufficient.value = sameCount < 10

  // 生成评分卡片数据（星级算法：简版——数据充足时后续可升级为相对分位法）
  try {
    storeScoreItems.value = await buildStoreScoreItems(cur.result_data, sameCount, cur.center_lat, cur.center_lng)
  } catch (e) {
    console.error('生成商圈评分失败:', e)
    storeScoreItems.value = []
  }
  storeScoreVisible.value = true
  ElMessage.success(storeScoreInsufficient.value ? '评分用数据不足，结果仅供参考' : `基于 ${sameCount} 笔同城同半径订单评分`)
}

// Haversine 距离（米）
const calcDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000
  const rad = d => d * Math.PI / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// 简版评分生成：人口/客流/消费基于本单 result_data 分档；竞争压力基于本地门店+竞品（2km范围）；商业成熟度需 POI（暂占位）
const buildStoreScoreItems = async (resultData, orderCount, centerLat, centerLng) => {
  const api = extractApiResult(resultData)
  const items = []

  // 1. 人口规模：居住+工作
  const pops = extractPopSums(api)
  const rwPop = pops ? (pops.live || 0) + (pops.work || 0) : 0
  const popStars = rwPop >= 20000 ? 5 : rwPop >= 10000 ? 4 : rwPop >= 5000 ? 3 : rwPop >= 2000 ? 2 : 1
  items.push({ label: '人口规模', stars: popStars, value: rwPop > 0 ? (rwPop / 10000).toFixed(1) + '万(居住+工作)' : '暂无数据' })

  // 2. 客流活跃度：工作日午晚餐时段(11-13 + 17-19 点)到访合计
  const flow = extractFlowData(api)
  const lunchDinner = (flow?.values || []).reduce((acc, v, i) => {
    const h = parseInt(flow.hours[i])
    if ((h >= 11 && h <= 13) || (h >= 17 && h <= 19)) return acc + v
    return acc
  }, 0)
  const flowStars = lunchDinner >= 8000 ? 5 : lunchDinner >= 4000 ? 4 : lunchDinner >= 2000 ? 3 : lunchDinner >= 800 ? 2 : 1
  items.push({ label: '客流活跃度', stars: flowStars, value: lunchDinner > 0 ? '午晚餐时段 ' + lunchDinner.toLocaleString() + ' 人次' : '暂无数据' })

  // 3. 消费能力：1009 spendpower 高消费段占比（spendpower ≥6）
  const cons = extractConsumeData(api)
  const totalCons = cons ? cons.low + cons.mid + cons.high : 0
  const highRatio = cons && totalCons > 0 ? cons.high / totalCons : 0
  const consStars = highRatio >= 0.5 ? 5 : highRatio >= 0.35 ? 4 : highRatio >= 0.2 ? 3 : highRatio >= 0.1 ? 2 : 1
  items.push({ label: '消费能力', stars: consStars, value: cons ? '高消费占比 ' + Math.round(highRatio * 100) + '%' : '暂无数据' })

  // 4. 商业成熟度：0.5km 内 商场/写字楼/学校/医院/酒店 POI 计数（后端高德代理）
  // 5. 竞争压力：0.5km 范围内 同品牌门店数 + 竞品门店数（反向指标，压力越大星越少）
  let poiCounts = null
  let sameBrand = 0
  let competitorCnt = 0
  try {
    const [poiRes, markersRes, competitorsRes] = await Promise.all([
      centerLat != null && centerLng != null
        ? axios.post('/api/poi/business-count', { lng: centerLng, lat: centerLat, radius: 500 })
        : Promise.resolve({ data: null }),
      axios.get('/api/markers'),
      axios.get('/api/competitors')
    ])
    if (poiRes.data && poiRes.data.success) {
      poiCounts = poiRes.data.counts
    }
    const curStoreName = currentDetail.value?.store_name || ''
    const markers = markersRes.data.markers || []
    // 先找当前订单对应的门店 marker，取其品牌
    const curMarker = markers.find(m => m.name === curStoreName)
    const curBrand = curMarker?.brand || ''
    // 我的门店：同品牌（brand 相同）且在 0.5km 内
    for (const m of markers) {
      if (!m || typeof m.latitude !== 'number' || typeof m.longitude !== 'number') continue
      if (m.name === curStoreName) continue
      if (centerLat != null && centerLng != null && calcDistance(centerLat, centerLng, m.latitude, m.longitude) <= 500) {
        // 同品牌判断：品牌字段一致（markers 有 brand 字段）
        if (curBrand && m.brand && m.brand === curBrand) sameBrand++
      }
    }
    // 竞品：0.5km 内全部计为竞争（竞品本身代表竞争压力）
    for (const c of competitorsRes.data.competitors || []) {
      if (!c || typeof c.latitude !== 'number' || typeof c.longitude !== 'number') continue
      if (centerLat != null && centerLng != null && calcDistance(centerLat, centerLng, c.latitude, c.longitude) <= 500) {
        competitorCnt++
      }
    }
  } catch (e) {
    console.error('获取POI/门店/竞品失败:', e)
  }

  // 商业成熟度星级：POI 总数分档
  if (poiCounts) {
    const poiTotal = (poiCounts.mall || 0) + (poiCounts.office || 0) + (poiCounts.school || 0) + (poiCounts.hospital || 0) + (poiCounts.hotel || 0)
    const poiStars = poiTotal >= 10 ? 5 : poiTotal >= 6 ? 4 : poiTotal >= 3 ? 3 : poiTotal >= 1 ? 2 : 1
    const detail = []
    if (poiCounts.mall) detail.push(`商场${poiCounts.mall}`)
    if (poiCounts.office) detail.push(`写字楼${poiCounts.office}`)
    if (poiCounts.school) detail.push(`学校${poiCounts.school}`)
    if (poiCounts.hospital) detail.push(`医院${poiCounts.hospital}`)
    if (poiCounts.hotel) detail.push(`酒店${poiCounts.hotel}`)
    items.push({ label: '商业成熟度', stars: poiStars, value: `0.5km内 ${detail.join(' ')}` })
  } else {
    items.push({ label: '商业成熟度', stars: 0, value: '暂无数据' })
  }

  const pressureScore = sameBrand + competitorCnt * 2 // 竞品权重更高
  const pressureStars = pressureScore <= 0 ? 5 : pressureScore <= 2 ? 4 : pressureScore <= 4 ? 3 : pressureScore <= 6 ? 2 : 1
  items.push({
    label: '竞争压力',
    stars: pressureStars,
    value: `0.5km内 同品牌${sameBrand}家 + 竞品${competitorCnt}家`
  })

  return items
}

// 图表相关
const chartList = ref([])
const chartElMap = ref({})
const chartInst = ref({})
const pdfContentRef = ref(null)
const insights = ref([])
const insightLoading = ref(false)
let chartResizeHandler = null

// ====== 查询结果对比（多订单同图对比） ======
const compareDialogVisible = ref(false)
const compareLoading = ref(false)
const compareSelected = ref([])     // 履历列表勾选的订单（用于计数/按钮状态）
const compareOrders = ref([])       // 实际参与对比的订单（含完整数据）
const compareCharts = {}            // {key: echarts实例}
const comparePopEl = ref(null)
const compareFlowEl = ref(null)
const compareConsumeEl = ref(null)

// 勾选变化
const handleCompareSelectionChange = (rows) => {
  compareSelected.value = rows
}

const clearCompareSelection = () => {
  compareSelected.value = []
  compareOrders.value = []
}

// 打开对比对话框：加载所选订单的 result_data
// 解析订单半径（兼容 JSON 数组字符串/数字/radius_display）→ 返回归一化后的半径数组
const parseOrderRadius = (row) => {
  let raw = row.radius
  if (raw === undefined || raw === null || raw === '') {
    const rd = row.radius_display || ''
    const m = rd.match(/(\d+(?:\.\d+)?)/g)
    return m ? m.map(Number) : null
  }
  if (Array.isArray(raw)) return raw.map(Number)
  if (typeof raw === 'number') return [raw]
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map(Number)
    const n = Number(parsed)
    if (!isNaN(n)) return [n]
  } catch (e) {}
  const n = Number(raw)
  if (!isNaN(n)) return [n]
  return null
}

// 半径是否一致：归一化后数组排序 join 比较
const isSameRadius = (a, b) => {
  const ra = parseOrderRadius(a)
  const rb = parseOrderRadius(b)
  if (!ra || !rb) return false
  return [...ra].sort((x, y) => x - y).join(',') === [...rb].sort((x, y) => x - y).join(',')
}

const openCompareDialog = async () => {
  if (compareSelected.value.length < 2) {
    ElMessage.warning('请至少选择 2 笔订单进行对比')
    return
  }
  // 半径一致性检查：不同半径的数据口径不同，直接对比会误导
  const firstRow = compareSelected.value[0]
  const inconsistent = compareSelected.value.slice(1).filter(r => !isSameRadius(firstRow, r))
  if (inconsistent.length > 0) {
    const firstR = parseOrderRadius(firstRow) || []
    const badR = parseOrderRadius(inconsistent[0]) || []
    ElMessage.warning(`所选订单半径不一致（${firstR.join('/')}米 vs ${badR.join('/')}米），请选择相同半径的订单进行对比`)
    return
  }
  compareDialogVisible.value = true
  compareLoading.value = true
  compareOrders.value = []
  try {
    const loaded = []
    for (const row of compareSelected.value) {
      try {
        const { data } = await axios.get(`/api/purchase/${row.id}`)
        // 半径：后端返回 radii 数组（兼容旧的 radius 单值）
        let radiusText = '-'
        if (Array.isArray(data.radii) && data.radii.length > 0) {
          radiusText = data.radii.join('/') + '米'
        } else if (data.radius) {
          radiusText = data.radius + '米'
        } else if (row.radius_display) {
          radiusText = row.radius_display
        } else if (row.radius) {
          radiusText = row.radius + '米'
        }
        loaded.push({
          id: data.id,
          store_name: data.store_name || row.store_name || '订单' + data.id,
          radius_display: radiusText,
          city_month: data.city_month,
          result_data: data.result_data
        })
      } catch (e) {
        console.error('加载对比订单失败:', row.id, e)
      }
    }
    compareOrders.value = loaded
    if (loaded.length < 2) {
      ElMessage.warning('加载成功的订单不足 2 笔，无法对比')
      compareLoading.value = false
      return
    }
    // 调试：输出首个订单的 result_data 结构便于排查
    if (loaded[0]?.result_data) {
      console.log('[Compare] 首单 result_data 类型:', typeof loaded[0].result_data, 'keys:', loaded[0].result_data ? Object.keys(loaded[0].result_data).slice(0,8) : 'null')
      const api = extractApiResult(loaded[0].result_data)
      console.log('[Compare] 提取的服务数据 keys:', api ? Object.keys(api) : 'null')
      console.log('[Compare] 人口提取:', extractPopSums(api))
      console.log('[Compare] 客流提取:', extractFlowData(api))
      console.log('[Compare] 消费提取:', extractConsumeData(api))
    }
  } catch (e) {
    console.error('对比加载失败:', e)
    ElMessage.error('对比加载失败: ' + e.message)
  } finally {
    compareLoading.value = false
  }
  // 等待 loading 关闭、图表 DOM 渲染完成后再绘图
  await nextTick()
  await nextTick()
  renderCompareCharts()
}

const removeCompareOrder = (id) => {
  compareOrders.value = compareOrders.value.filter(o => o.id !== id)
  compareSelected.value = compareSelected.value.filter(s => s.id !== id)
  if (compareOrders.value.length < 2) {
    disposeCompareCharts()
    return
  }
  nextTick(() => renderCompareCharts())
}

// 提取 result_data 服务数据 —— 兼容多种格式
// 格式1: {apiResult: {1001:...,1005:...}}（完整结构）
// 格式2: {1001:...,1005:...}（直接服务号字典）
// 格式3: 字符串 JSON（自动 parse）
const extractApiResult = (resultData) => {
  if (!resultData) return null
  let api = resultData
  if (typeof api === 'string') { try { api = JSON.parse(api) } catch (e) { return null } }
  if (!api || typeof api !== 'object') return null
  if (api.apiResult && typeof api.apiResult === 'object') return api.apiResult
  // 检查是否直接含服务号键（如 1001/1005/1009/1010/1011/1013/1015 等）
  const serviceKeys = Object.keys(api).filter(k => /^(100[0-9]|101[0-9]|102[0-9])$/.test(k))
  if (serviceKeys.length > 0) return api
  return null
}

// 1001 人口汇总提取：P0_SUM/到访 P1_SUM/居住 P2_SUM/工作
const extractPopSums = (apiResult) => {
  const d = apiResult && apiResult['1001']
  if (!d || typeof d !== 'object') return null
  const find = (pattern) => {
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === 'number' && pattern.test(k)) return v
    }
    return null
  }
  return {
    visit: find(/^P0_SUM\d*$/i),
    live: find(/^P1_SUM\d*$/i),
    work: find(/^P2_SUM\d*$/i)
  }
}

// 1005 小时段到访提取：day_type + hour_period + hour_visit
const extractFlowData = (apiResult) => {
  const arr = apiResult && apiResult['1005']
  if (!Array.isArray(arr) || arr.length === 0) return null
  const hourMap = new Map()
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const hour = item.hour_period
    if (item.day_type === 0 && typeof item.hour_visit === 'number') {
      if (!hourMap.has(hour)) hourMap.set(hour, 0)
      hourMap.set(hour, hourMap.get(hour) + item.hour_visit)
    }
  }
  if (hourMap.size === 0) return null
  const sorted = [...hourMap.entries()].sort((a, b) => a[0] - b[0])
  return { hours: sorted.map(([h]) => h + '点'), values: sorted.map(([, v]) => v) }
}

// 1009 消费水平提取：兼容两种格式
// 格式A（旧）: {consume_1: n, consume_2: n, consume_3: n} → 低/中/高
// 格式B（联通实际）: [{popu_type, spendpower:"1"~"8", spendpower_value}, ...] → 高消费=spendpower≥5 人数，低消费=spendpower≤3
const extractConsumeData = (apiResult) => {
  const d = apiResult && apiResult['1009']
  if (!d) return null

  // 格式B：spendpower 数组（popu_type 0/1/2 全人群合计）
  if (Array.isArray(d) && d.length > 0 && typeof d[0] === 'object' && d[0].spendpower !== undefined) {
    let low = 0, mid = 0, high = 0
    for (const item of d) {
      const v = Number(item.spendpower_value)
      if (isNaN(v)) continue
      const level = Number(item.spendpower)
      if (level <= 3) low += v
      else if (level <= 5) mid += v
      else high += v
    }
    if (low === 0 && mid === 0 && high === 0) return null
    return { low, mid, high }
  }

  // 格式A：consume_1/2/3 或 低/中/高 文本键
  if (typeof d === 'object') {
    let c1 = 0, c2 = 0, c3 = 0
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== 'number') continue
      if (/consume_1|低/i.test(k)) c1 += v
      else if (/consume_2|中/i.test(k)) c2 += v
      else if (/consume_3|高/i.test(k)) c3 += v
    }
    if (c1 === 0 && c2 === 0 && c3 === 0) return null
    return { low: c1, mid: c2, high: c3 }
  }
  return null
}

// 渲染3张对比图
const renderCompareCharts = async () => {
  disposeCompareCharts()
  const orders = compareOrders.value
  if (orders.length < 2) return

  const colorPalette = ['#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399']

  // 1. 人口规模对比（分组柱状图）
  const popEl = comparePopEl.value
  if (popEl) {
    const series = []
    const dims = [
      { key: 'visit', name: '到访' },
      { key: 'live', name: '居住' },
      { key: 'work', name: '工作' }
    ]
    dims.forEach((dim, di) => {
      series.push({
        name: dim.name,
        type: 'bar',
        data: orders.map(o => {
          const p = extractPopSums(extractApiResult(o.result_data))
          return p ? (p[dim.key] || 0) : 0
        }),
        itemStyle: { color: colorPalette[di] }
      })
    })
    const chart = echarts.init(popEl)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: dims.map(d => d.name) },
      grid: { left: 80, right: 20, top: 40, bottom: 70 },
      xAxis: { type: 'category', data: orders.map(o => o.store_name), axisLabel: { interval: 0, rotate: 30, margin: 14, fontSize: 12 } },
      yAxis: { type: 'value', name: '人数' },
      series
    })
    compareCharts.pop = chart
  }

  // 2. 客流活跃度对比（多折线）
  const flowEl = compareFlowEl.value
  if (flowEl) {
    // 取第一个有客流数据的订单作为 x 轴（保护：首个订单无 1005 时）
    let flowX = []
    for (const o of orders) {
      const f = extractFlowData(extractApiResult(o.result_data))
      if (f && f.hours.length > 0) { flowX = f.hours; break }
    }
    const series = []
    orders.forEach((o, oi) => {
      const f = extractFlowData(extractApiResult(o.result_data))
      series.push({
        name: o.store_name,
        type: 'line',
        smooth: true,
        data: f ? f.values : [],
        itemStyle: { color: colorPalette[oi % 5] },
        lineStyle: { width: 2 }
      })
    })
    const chart = echarts.init(flowEl)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: orders.map(o => o.store_name), type: 'scroll' },
      grid: { left: 80, right: 20, top: 40, bottom: 60 },
      xAxis: { type: 'category', data: flowX, axisLabel: { fontSize: 11 } },
      yAxis: { type: 'value', name: '到访人次' },
      series
    })
    compareCharts.flow = chart
  }

  // 3. 消费水平对比（分组柱状图 低/中/高）
  const consumeEl = compareConsumeEl.value
  if (consumeEl) {
    const levels = [
      { key: 'low', name: '低消费' },
      { key: 'mid', name: '中消费' },
      { key: 'high', name: '高消费' }
    ]
    const series = levels.map((lv, li) => ({
      name: lv.name,
      type: 'bar',
      data: orders.map(o => {
        const c = extractConsumeData(extractApiResult(o.result_data))
        return c ? (c[lv.key] || 0) : 0
      }),
      itemStyle: { color: colorPalette[li] }
    }))
    const chart = echarts.init(consumeEl)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: levels.map(l => l.name) },
      grid: { left: 80, right: 20, top: 40, bottom: 70 },
      xAxis: { type: 'category', data: orders.map(o => o.store_name), axisLabel: { interval: 0, rotate: 30, margin: 14, fontSize: 12 } },
      yAxis: { type: 'value', name: '人数' },
      series
    })
    compareCharts.consume = chart
  }
}

const disposeCompareCharts = () => {
  Object.values(compareCharts).forEach(c => c?.dispose())
  for (const k of Object.keys(compareCharts)) delete compareCharts[k]
}


// Canvas 地图截图缓存参数（用于导出竞品地图）
const lastMapParams = ref(null)

// 注册图表DOM元素
const registerChartEl = (el, serviceCode) => {
  if (el) {
    chartElMap.value[serviceCode] = el
  }
}

const form = reactive({
  email: '',
  company: '',
  logo: '',          // 存储 base64 data URL（提交用）
  logoPreview: '',   // 预览用（可能带缩放压缩）
  newPassword: '',
  confirmPassword: ''
})

const validateConfirmPassword = (rule, value, callback) => {
  if (form.newPassword && value !== form.newPassword) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const rules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入有效的邮箱地址', trigger: 'blur' }
  ],
  newPassword: [
    { min: 6, message: '密码至少6个字符', trigger: 'blur' }
  ],
  confirmPassword: [
    { validator: validateConfirmPassword, trigger: 'blur' }
  ]
}

onMounted(async () => {
  // 填充当前邮箱和公司
  if (userStore.user?.email) {
    form.email = userStore.user.email
  }
  if (userStore.user?.company) {
    form.company = userStore.user.company
  }
  if (userStore.user?.logo) {
    form.logo = userStore.user.logo
    form.logoPreview = userStore.user.logo
  }
  // 获取配额信息
  if (!userStore.quota) {
    await userStore.fetchQuota()
  }

  // 检查 URL 参数：如果有 storeName 或 openHistory，自动打开购买履历
  const storeName = route.query.storeName
  const openHistory = route.query.openHistory
  if (storeName || openHistory) {
    // 延迟打开对话框，确保 UI 已渲染
    setTimeout(async () => {
      await showHistoryDialog()
      // 如果有该门店的记录，高亮显示
      if (storeName && historyList.value.length > 0) {
        const targetStore = historyList.value.find(h => h.store_name === storeName)
        if (targetStore) {
          viewPurchaseDetail(targetStore)
        }
      }
      // 如果只是打开购买履历（无特定门店），不自动打开详情
      // 清除 URL 参数（避免刷新后又打开）
      router.replace({ query: {} })
    }, 500)
  }
})

// 刷新配额
const refreshQuota = async () => {
  quotaLoading.value = true
  try {
    await userStore.fetchQuota()
    ElMessage.success('配额已刷新')
  } catch {
    ElMessage.error('刷新失败')
  } finally {
    quotaLoading.value = false
  }
}

// 显示充值履历对话框（管理员分配配额历史）
const showQuotaHistoryDialog = async () => {
  quotaHistoryDialogVisible.value = true
  quotaHistoryLoading.value = true
  quotaHistoryList.value = []
  try {
    const { data } = await axios.get('/api/purchase/quota-history')
    quotaHistoryList.value = data.history || []
  } catch (e) {
    console.error('加载充值履历失败:', e)
    ElMessage.error('加载充值履历失败')
    quotaHistoryList.value = []
  } finally {
    quotaHistoryLoading.value = false
  }
}

// 显示购买履历对话框
const showHistoryDialog = async () => {
  historyDialogVisible.value = true
  historyLoading.value = true
  try {
    const { data } = await axios.get('/api/purchase/history')
    historyList.value = data.purchases || []
  } catch (e) {
    console.error('加载购买履历失败:', e)
    ElMessage.error('加载购买履历失败')
    historyList.value = []
  } finally {
    historyLoading.value = false
  }
}

// 判断数据年月是否过期（YYYYMM 格式，距今 >12 个月）
const isCityMonthExpired = (cityMonth) => {
  if (!cityMonth) return false
  const m = String(cityMonth)
  if (m.length !== 6 || !/^\d{6}$/.test(m)) return false
  const year = parseInt(m.slice(0, 4), 10)
  const month = parseInt(m.slice(4), 10)
  if (year < 2000 || month < 1 || month > 12) return false
  const now = new Date()
  const monthsDiff = (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month)
  return monthsDiff > 12
}

// 格式化日期
const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 查看购买详情
const viewPurchaseDetail = async (row) => {
  detailDialogVisible.value = true
  detailLoading.value = true
  currentDetail.value = null
  resultData.value = null
  chartList.value = []
  disposeAllCharts()
  
  try {
    const { data } = await axios.get(`/api/purchase/${row.id}`)
    currentDetail.value = data
    resultData.value = data.result_data
    // 填充图表列表
    buildChartList(data.result_data)
    // 调试：输出 monthly_reach_count 的结构
    console.log('result_data keys:', data.result_data ? Object.keys(data.result_data) : 'null')
    if (data.result_data?.apiResult) {
      const apiResult = data.result_data.apiResult
      for (const key of Object.keys(apiResult)) {
        const val = apiResult[key]
        if (Array.isArray(val) && val.length > 0) {
          console.log(`apiResult.${key} 第一条数据 keys:`, Object.keys(val[0]))
        }
      }
    }
  } catch (e) {
    console.error('加载详情失败:', e)
    ElMessage.error('加载详情失败: ' + (e.response?.data?.message || e.message))
    // 关闭对话框而不是让它显示空白内容
    detailDialogVisible.value = false
    return
  } finally {
    detailLoading.value = false
  }
}

// 构建图表列表
const buildChartList = (data) => {
  if (!data) return
  let apiResult = data
  if (typeof apiResult === 'string') {
    try { apiResult = JSON.parse(data) } catch (e) { return }
  }
  if (apiResult && apiResult.apiResult) {
    apiResult = apiResult.apiResult
  }
  if (!apiResult || typeof apiResult !== 'object') return
  
  const list = []
  for (const [key, value] of Object.entries(apiResult)) {
    if (key === 'error') continue
    if (excludeServices.includes(key)) continue
    // 跳过空数据
    if (value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    
    // 1001 全量人口拆分为3张子图表
    if (key === '1001') {
      list.push({ serviceCode: '1001', chartKey: '1001-a', title: '全量人口 - 人口总数' })
      list.push({ serviceCode: '1001', chartKey: '1001-b', title: '全量人口 - 居住+工作年龄分布' })
      list.push({ serviceCode: '1001', chartKey: '1001-c', title: '全量人口 - 到访年龄分布' })
      list.push({ serviceCode: '1001', chartKey: '1001-d', title: '全量人口 - 居住+工作性别分布' })
    } else if (key === '1005') {
      // 1005 每小时段流量拆分为2张子图表
      list.push({ serviceCode: '1005', chartKey: '1005-a', title: '每小时段流量 - 到访' })
      list.push({ serviceCode: '1005', chartKey: '1005-b', title: '每小时段流量 - 全量' })
    } else if (key === '1006') {
      // 1006 每日人流量拆分为2张子图表
      list.push({ serviceCode: '1006', chartKey: '1006-a', title: '每日人流量 - 日均值' })
      list.push({ serviceCode: '1006', chartKey: '1006-b', title: '每日人流量 - 月度累计' })
    } else if (key === '1009') {
      // 1009 消费水平拆分为2张子图表
      list.push({ serviceCode: '1009', chartKey: '1009-a', title: '消费水平 - 居住+工作' })
      list.push({ serviceCode: '1009', chartKey: '1009-b', title: '消费水平 - 到访' })
    } else if (key === '1010') {
      // 1010 教育水平拆分为2张子图表
      list.push({ serviceCode: '1010', chartKey: '1010-a', title: '教育水平 - 居住+工作' })
      list.push({ serviceCode: '1010', chartKey: '1010-b', title: '教育水平 - 到访' })
    } else if (key === '1011') {
      // 1011 行业分布拆分为2张子图表
      list.push({ serviceCode: '1011', chartKey: '1011-a', title: '行业分布 - 居住+工作' })
      list.push({ serviceCode: '1011', chartKey: '1011-b', title: '行业分布 - 到访' })
    } else if (key === '1014') {
      // 1014 网购能力预测 - 隐藏
      continue
    } else if (key === '1015') {
      // 1015 资产预测拆分为3张子图表（到访/居住/工作）
      list.push({ serviceCode: '1015', chartKey: '1015-a', title: '资产预测 - 到访' })
      list.push({ serviceCode: '1015', chartKey: '1015-b', title: '资产预测 - 居住' })
      list.push({ serviceCode: '1015', chartKey: '1015-c', title: '资产预测 - 工作' })
    } else if (key === '1002') {
      // 1002 上网标签分布拆分为3张子图表（到访/居住/工作）
      list.push({ serviceCode: '1002', chartKey: '1002-a', title: '上网标签分布 - 到访' })
      list.push({ serviceCode: '1002', chartKey: '1002-b', title: '上网标签分布 - 居住' })
      list.push({ serviceCode: '1002', chartKey: '1002-c', title: '上网标签分布 - 工作' })
    } else {
      list.push({ serviceCode: key, chartKey: key, title: getServiceName(key) })
    }
  }
  chartList.value = list
}

// 排除的服务列表（不显示在结果中）
const excludeServices = ['1003', '1004', '1008', '1016', '1017', '1018', '1019', '1020', '1021', '1022', '1023']

// 服务名称映射
const getServiceName = (code) => {
  const names = {
    '1001': '全量人口',
    '1002': '上网标签分布',
    '1003': '手机品牌分布',
    '1005': '每小时段人口流量',
    '1006': '每日人流量及停留时长',
    '1007': '每月到达次数分布',
    '1008': 'APP使用人数分布',
    '1009': '消费水平（富裕指数）',
    '1010': '人口教育水平',
    '1011': '人口行业分布',
    '1012': '人生阶段分布',
    '1013': '综合消费能力预测',
    '1014': '网购能力预测',
    '1015': '资产预测（收入/有车/有房）',

  }
  return names[code] || code
}

// 根据服务代码和字段名获取中文标签
const getFieldLabel = (serviceCode, fieldName) => {
  if (!FIELD_LABELS[serviceCode]) return fieldName
  const serviceFields = FIELD_LABELS[serviceCode]
  // 1. 精确匹配（区分大小写）
  if (serviceFields[fieldName]) {
    return serviceFields[fieldName]
  }
  // 2. 大小写不敏感匹配
  const upperField = fieldName.toUpperCase()
  const lowerField = fieldName.toLowerCase()
  for (const [key, label] of Object.entries(serviceFields)) {
    if (key.toUpperCase() === upperField || key.toLowerCase() === lowerField) {
      return label
    }
  }
  return fieldName // 返回原始字段名
}

// 人群类型映射（用于分组显示）
const getPopTypeLabel = (key) => {
  if (key.includes('_0') || key.startsWith('P0') || key.includes('Visit')) return '到访'
  if (key.includes('_1') || key.startsWith('P1') || key.includes('Live')) return '居住'
  if (key.includes('_2') || key.startsWith('P2') || key.includes('Work')) return '工作'
  if (key.includes('_3')) return '外省到访'
  if (key.includes('_4')) return '娱乐'
  if (key.includes('_5')) return '重合'
  return ''
}

// 格式化单个字段值
const formatDetailValue = (value) => {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0]
      if (Array.isArray(first) && first.length >= 3) {
        return `[网格数据: ${value.length}个点]`
      }
    }
    return '<详情>'
  }
  return String(value)
}

// 格式化1001服务数据（人口汇总）- 分列对比表格
const formatP0SData = (data) => {
  // 字段名格式: prefix + digit + _ + suffix
  // 如 AGE0_0006, AGE1_6569, AGE2_70up
  // digit: 0=到访, 1=居住, 2=工作
  const typeNames = ['到访', '居住', '工作']
  
  // 定义指标排序顺序
  const sortOrder = [
    'PALL_SUM', 'P0_SUM', 'P1_SUM', 'P2_SUM', 'P3_SUM', 'P4_SUM', 'P5_SUM',
    '总人口规模', '到访人口数', '居住人口数', '工作人口数', '外省到访人口数', '娱乐人数', '居住工作重合人数',
    'MALE_SUM', 'FEMALE_SUM', '男性人数', '女性人数',
    'AGE_0006', 'AGE_0612', 'AGE_1215', 'AGE_1518', 'AGE_1924',
    '6岁以下人数', '7-12岁人数', '13-15岁人数', '16-18岁人数', '19-24岁人数',
    'AGE_2529', 'AGE_3034', 'AGE_3539', 'AGE_4044', 'AGE_4549',
    '25-29岁人数', '30-34岁人数', '35-39岁人数', '40-44岁人数', '45-49岁人数',
    'AGE_5054', 'AGE_5559', 'AGE_6064', 'AGE_6569', 'AGE_70up',
    '50-54岁人数', '55-59岁人数', '60-64岁人数', '65-69岁人数', '70岁以上人数',
    'consume_1', 'consume_2', 'consume_3',
    '月出帐金额50元以下人数', '月出帐金额50-100元人数', '月出帐金额100-150元人数',
    '月出帐金额150-200元人数', '月出帐金额200-250元人数', '月出帐金额250元以上人数'
  ]
  
  // P+数字+SUM 字段的映射（可能带数字后缀，如 P0_SUM0）
  const pSumFields = {
    'PALL_SUM': { label: '总人口规模', isSingleColumn: true },
    'P0_SUM': { label: '到访人口数', showIn: '到访' },
    'P1_SUM': { label: '居住人口数', showIn: '居住' },
    'P2_SUM': { label: '工作人口数', showIn: '工作' },
    'P3_SUM': { label: '外省到访人口数', showIn: '到访' },
    'P4_SUM': { label: '娱乐人数', showIn: '到访' },
    'P5_SUM': { label: '居住工作重合人数', isSingleColumn: true }
  }
  
  // 存储所有行: [{ baseKey, label, values: {到访, 居住, 工作}, isSingleColumn, singleValue }]
  const allRows = []
  const rowMap = new Map()  // 用于快速查找已存在的行
  
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== 'number') continue
    
    // 检查是否是 P+数字+SUM 字段（可能带后缀数字，如 P0_SUM0）
    const pSumMatch = key.match(/^(P\d_SUM)\d*$/i)
    if (pSumMatch) {
      const baseName = pSumMatch[1].toUpperCase()
      const fieldInfo = pSumFields[baseName]
      if (fieldInfo) {
        let row = rowMap.get(baseName)
        if (!row) {
          row = {
            baseKey: baseName,
            label: fieldInfo.label,
            values: { '到访': null, '居住': null, '工作': null },
            isSingleColumn: fieldInfo.isSingleColumn || false,
            singleValue: fieldInfo.isSingleColumn ? 0 : null
          }
          rowMap.set(baseName, row)
          allRows.push(row)
        }
        if (fieldInfo.isSingleColumn) {
          row.singleValue = val  // 更新为真实值
        } else {
          row.values[fieldInfo.showIn] = val  // 更新为真实值
        }
        continue
      }
    }
    
    // 检查是否是单列字段（如 PALL_SUM）
    if (key.toUpperCase() === 'PALL_SUM' || key.toUpperCase().startsWith('PALL_SUM')) {
      let row = rowMap.get('PALL_SUM')
      if (!row) {
        const label = getFieldLabel('1001', key)
        row = { 
          baseKey: 'PALL_SUM', 
          label, 
          values: { '到访': null, '居住': null, '工作': null }, 
          isSingleColumn: true,
          singleValue: val
        }
        rowMap.set('PALL_SUM', row)
        allRows.push(row)
      } else {
        row.singleValue = val
      }
      continue
    }
    
    // 直接用正则匹配 prefix + digit + _ + suffix
    const match = key.match(/^([a-zA-Z]+)(\d)_(.+)$/)
    if (match) {
      const [, prefix, digitStr, suffix] = match
      const digit = parseInt(digitStr)
      const typeName = typeNames[digit]
      if (!typeName) continue
      
      const baseKey = `${prefix}_${suffix}`
      // 查找是否已存在该 baseKey
      let row = rowMap.get(baseKey)
      if (!row) {
        const fullLabel = getFieldLabel('1001', key)
        // 去掉人群类型前缀
        let label = fullLabel
          .replace(/^(到访|居住|工作)人口/, '')
          .replace(/^(到访|居住|工作)/, '')
        if (label === '数') continue  // 过滤掉单个"数"字
        
        row = { baseKey, label, values: { '到访': null, '居住': null, '工作': null }, isSingleColumn: false }
        rowMap.set(baseKey, row)
        allRows.push(row)
      }
      row.values[typeName] = val
    } else {
      // 不是 prefix+digit+suffix 格式的字段
      let row = rowMap.get(key)
      if (!row) {
        const label = getFieldLabel('1001', key)
        if (label === key || label === '数') continue
        
        row = { baseKey: key, label, values: { '到访': null, '居住': null, '工作': null }, isSingleColumn: false }
        rowMap.set(key, row)
        allRows.push(row)
      }
      row.values['到访'] = val
    }
  }
  
  // 补充必填字段（如果API没有返回）
  for (const [key, fieldInfo] of Object.entries(pSumFields)) {
    if (!rowMap.has(key)) {
      const row = {
        baseKey: key,
        label: fieldInfo.label,
        values: { '到访': null, '居住': null, '工作': null },
        isSingleColumn: fieldInfo.isSingleColumn || false,
        singleValue: fieldInfo.isSingleColumn ? 0 : null
      }
      if (!fieldInfo.isSingleColumn) {
        row.values[fieldInfo.showIn] = 0
      }
      allRows.push(row)
      rowMap.set(key, row)
    }
  }
  
  // 按 sortOrder 排序
  const sortedRows = allRows.sort((a, b) => {
    let idxA = sortOrder.indexOf(a.baseKey)
    let idxB = sortOrder.indexOf(b.baseKey)
    if (idxA === -1) idxA = sortOrder.indexOf(a.label)
    if (idxB === -1) idxB = sortOrder.indexOf(b.label)
    if (idxA === -1 && idxB === -1) return 0
    if (idxA === -1) return 1
    if (idxB === -1) return -1
    return idxA - idxB
  })
  
  // 生成表格
  let html = `<table class="data-table cross-table">
    <thead>
      <tr>
        <th>指标名称</th>
        <th>到访</th>
        <th>居住</th>
        <th>工作</th>
      </tr>
    </thead>
    <tbody>`
  
  for (const row of sortedRows) {
    if (row.isSingleColumn) {
      // 单列显示：合并三个单元格
      html += `<tr>
        <td>${row.label}</td>
        <td colspan="3" class="num single-value">${row.singleValue !== null ? row.singleValue.toLocaleString() : '-'}</td>
      </tr>`
    } else {
      html += `<tr>
        <td>${row.label}</td>
        <td class="num">${row.values['到访'] !== null ? row.values['到访'].toLocaleString() : '-'}</td>
        <td class="num">${row.values['居住'] !== null ? row.values['居住'].toLocaleString() : '-'}</td>
        <td class="num">${row.values['工作'] !== null ? row.values['工作'].toLocaleString() : '-'}</td>
      </tr>`
    }
  }
  
  html += '</tbody></table>'
  return html
}

// 格式化其他服务数据（数组格式）- 处理 popu_type/tag_value/tag_name 格式
const formatArrayData = (data, serviceCode) => {
  if (!data) return '<p>暂无数据</p>'
  if (!Array.isArray(data) || data.length === 0) return '<p>暂无数据</p>'
  
  const firstItem = data[0]
  if (!firstItem || typeof firstItem !== 'object') return '<p>暂无数据</p>'
  
  // 如果是消费水平格式 {popu_type, spendpower, spendpower_value} - 合并为交叉表
  if (firstItem.popu_type !== undefined && firstItem.spendpower !== undefined && firstItem.spendpower_value !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    
    // 创建 spendpower 到数值的映射，按 popu_type 分列
    const spendMap = new Map()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const spendLevel = item.spendpower
      if (!spendMap.has(spendLevel)) {
        spendMap.set(spendLevel, { '到访': 0, '居住': 0, '工作': 0 })
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        spendMap.get(spendLevel)[type] = item.spendpower_value || 0
      }
    }
    
    // 按消费力等级排序
    const sortedSpend = [...spendMap.entries()].sort((a, b) => a[0] - b[0])
    
    // 消费力等级标签
    const spendLabels = {
      1: '消费力指数1（最低）',
      2: '消费力指数2',
      3: '消费力指数3',
      4: '消费力指数4',
      5: '消费力指数5',
      6: '消费力指数6',
      7: '消费力指数7',
      8: '消费力指数8（最高）'
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>消费力指数</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const [level, values] of sortedSpend) {
      const label = spendLabels[level] || `消费力指数${level}`
      html += `<tr><td>${label}</td><td class="num">${values['到访'].toLocaleString()}</td><td class="num">${values['居住'].toLocaleString()}</td><td class="num">${values['工作'].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 如果是人口教育水平格式 {popu_type, fname, p0, p1, p2, p3, p4} - 合并为交叉表
  if (firstItem.popu_type !== undefined && firstItem.p0 !== undefined && firstItem.fname !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p0': '高中及以下', 'p1': '大专', 'p2': '本科', 'p3': '硕士', 'p4': '博士' }
    const pKeys = ['p0', 'p1', 'p2', 'p3', 'p4']
    
    // 创建 fname 到数值的映射，按 popu_type 分列
    const eduMap = new Map()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const fname = item.fname || '-'
      if (!eduMap.has(fname)) {
        eduMap.set(fname, { '到访': {}, '居住': {}, '工作': {} })
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            eduMap.get(fname)[type][pKey] = item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>学历</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    
    // 遍历所有教育等级
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      let toVisit = 0, residence = 0, work = 0
      
      // 汇总所有 fname 下的该教育等级数据
      for (const [fname, values] of eduMap) {
        toVisit += values['到访'][pKey] || 0
        residence += values['居住'][pKey] || 0
        work += values['工作'][pKey] || 0
      }
      
      html += `<tr><td>${label}</td><td class="num">${toVisit.toLocaleString()}</td><td class="num">${residence.toLocaleString()}</td><td class="num">${work.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 根据 serviceCode 精确匹配各服务的数据格式
  // 1012: 人生阶段分布 {popu_type, p1, p2, p3}
  if (serviceCode === '1012' && firstItem.popu_type !== undefined && firstItem.p1 !== undefined && firstItem.p3 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '已婚已育', 'p2': '已婚未育', 'p3': '未婚未育' }
    const pKeys = ['p1', 'p2', 'p3']
    
    const totals = { '到访': {}, '居住': {}, '工作': {} }
    for (const pKey of pKeys) {
      totals['到访'][pKey] = 0
      totals['居住'][pKey] = 0
      totals['工作'][pKey] = 0
    }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            totals[type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>人生阶段</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      html += `<tr><td>${label}</td><td class="num">${totals['到访'][pKey].toLocaleString()}</td><td class="num">${totals['居住'][pKey].toLocaleString()}</td><td class="num">${totals['工作'][pKey].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 1013: 综合消费能力预测 {popu_type, p1, p2, p3}
  if (serviceCode === '1013' && firstItem.popu_type !== undefined && firstItem.p1 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '消费水平高', 'p2': '消费水平中', 'p3': '消费水平低' }
    const pKeys = ['p1', 'p2', 'p3']
    
    const totals = { '到访': {}, '居住': {}, '工作': {} }
    for (const pKey of pKeys) {
      totals['到访'][pKey] = 0
      totals['居住'][pKey] = 0
      totals['工作'][pKey] = 0
    }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            totals[type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>消费能力</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      html += `<tr><td>${label}</td><td class="num">${totals['到访'][pKey].toLocaleString()}</td><td class="num">${totals['居住'][pKey].toLocaleString()}</td><td class="num">${totals['工作'][pKey].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 1014: 网购能力预测 {popu_type, p1, p2, p3, p4, p5}
  if (serviceCode === '1014' && firstItem.popu_type !== undefined && firstItem.p1 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '网购能力高', 'p2': '网购能力中高', 'p3': '网购能力中', 'p4': '网购能力中低', 'p5': '网购能力低' }
    const pKeys = ['p1', 'p2', 'p3', 'p4', 'p5']
    
    const totals = { '到访': {}, '居住': {}, '工作': {} }
    for (const pKey of pKeys) {
      totals['到访'][pKey] = 0
      totals['居住'][pKey] = 0
      totals['工作'][pKey] = 0
    }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            totals[type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>网购能力</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      html += `<tr><td>${label}</td><td class="num">${totals['到访'][pKey].toLocaleString()}</td><td class="num">${totals['居住'][pKey].toLocaleString()}</td><td class="num">${totals['工作'][pKey].toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 1015: 资产预测（收入/有车/有房）{popu_type, fname, p1, p2, p3, p4, p5}
  if (serviceCode === '1015' && firstItem.popu_type !== undefined && firstItem.fname !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = { 'p1': '预测概率高', 'p2': '预测概率中高', 'p3': '预测概率中', 'p4': '预测概率中低', 'p5': '预测概率低' }
    const pKeys = ['p1', 'p2', 'p3', 'p4', 'p5']
    
    const fnameGroups = {}
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const fname = item.fname || '-'
      if (!fnameGroups[fname]) {
        fnameGroups[fname] = { '到访': {}, '居住': {}, '工作': {} }
        for (const pKey of pKeys) {
          fnameGroups[fname]['到访'][pKey] = 0
          fnameGroups[fname]['居住'][pKey] = 0
          fnameGroups[fname]['工作'][pKey] = 0
        }
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            fnameGroups[fname][type][pKey] += item[pKey] || 0
          }
        }
      }
    }
    
    const fnameConfig = {
      '收入预测': { title: '收入预测', bgClass: 'asset-income' },
      '有车预测': { title: '有车预测', bgClass: 'asset-car' },
      '有房预测': { title: '有房预测', bgClass: 'asset-house' }
    }
    
    let html = `<div class="pop-group">`
    for (const [fname, values] of Object.entries(fnameGroups)) {
      const config = fnameConfig[fname] || { title: fname, bgClass: '' }
      html += `<div class="asset-section ${config.bgClass}">
        <div class="group-header">${config.title}</div>
        <table class="data-table cross-table"><thead><tr><th>概率等级</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
      for (const pKey of pKeys) {
        const label = pLabels[pKey] || pKey
        html += `<tr><td>${label}</td><td class="num">${values['到访'][pKey].toLocaleString()}</td><td class="num">${values['居住'][pKey].toLocaleString()}</td><td class="num">${values['工作'][pKey].toLocaleString()}</td></tr>`
      }
      html += '</tbody></table></div>'
    }
    html += '</div>'
    return html
  }
  
  // 如果是人口行业分布格式 {popu_type, fname, p1, p2, ..., p10} - 合并为交叉表
  if (firstItem.popu_type !== undefined && firstItem.p1 !== undefined && firstItem.p10 !== undefined) {
    const typeNames = ['到访', '居住', '工作']
    const pLabels = {
      'p1': '金融从业者',
      'p2': '医务人员',
      'p3': '公务员&事业单位',
      'p4': '白领及一般职员',
      'p5': '工人及服务业人员',
      'p6': '教师',
      'p7': '农民及其他',
      'p8': '网约车司机',
      'p9': '外卖员',
      'p10': '快递员'
    }
    const pKeys = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']
    
    // 创建 fname 到数值的映射，按 popu_type 分列
    const jobMap = new Map()
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const fname = item.fname || '-'
      if (!jobMap.has(fname)) {
        jobMap.set(fname, { '到访': {}, '居住': {}, '工作': {} })
      }
      const typeIdx = typeof item.popu_type === 'number' ? item.popu_type : -1
      const type = typeNames[typeIdx] || '其他'
      if (type !== '其他') {
        for (const pKey of pKeys) {
          if (item[pKey] !== undefined) {
            jobMap.get(fname)[type][pKey] = item[pKey] || 0
          }
        }
      }
    }
    
    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>行业</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    
    // 遍历所有行业
    for (const pKey of pKeys) {
      const label = pLabels[pKey] || pKey
      let toVisit = 0, residence = 0, work = 0
      
      // 汇总所有 fname 下的该行业数据
      for (const [fname, values] of jobMap) {
        toVisit += values['到访'][pKey] || 0
        residence += values['居住'][pKey] || 0
        work += values['工作'][pKey] || 0
      }
      
      html += `<tr><td>${label}</td><td class="num">${toVisit.toLocaleString()}</td><td class="num">${residence.toLocaleString()}</td><td class="num">${work.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
    // 1002: 上网标签分布格式 {popu_type, tag_value, tag_name} - 按人群类型分别显示前10
  if (firstItem.tag_value !== undefined && firstItem.tag_name !== undefined) {
    // 按 popu_type 分组（0=到访 1=居住 2=工作）
    const byPop = { 0: {}, 1: {}, 2: {} }
    for (const item of data) {
      if (item && typeof item === 'object' && item.tag_name && item.tag_value !== undefined && byPop[item.popu_type]) {
        byPop[item.popu_type][item.tag_name] = Number(item.tag_value)
      }
    }
    // 标签并集，按"到访"值降序取前10
    const tagNames = [...new Set(data.filter(d => d && d.tag_name).map(d => d.tag_name))]
    const rows = tagNames
      .map(name => ({ name, v0: byPop[0][name] || 0, v1: byPop[1][name] || 0, v2: byPop[2][name] || 0 }))
      .sort((a, b) => b.v0 - a.v0)
      .slice(0, 10)

    let html = `<div class="pop-group">
      <table class="data-table cross-table"><thead><tr><th>标签</th><th>到访</th><th>居住</th><th>工作</th></tr></thead><tbody>`
    for (const row of rows) {
      html += `<tr><td>${row.name}</td><td class="num">${row.v0.toLocaleString()}</td><td class="num">${row.v1.toLocaleString()}</td><td class="num">${row.v2.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  // 如果是每日人流量及停留时长格式 {day_type, day_visit, day_all, stay1, stay2, ...}
  if (firstItem.day_visit !== undefined && firstItem.day_all !== undefined && firstItem.stay1 !== undefined) {
    const dayTypes = { 0: '工作日', 1: '周末' }
    const groups = { '工作日': [], '周末': [], '其他': [] }
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const dayType = dayTypes[item.day_type] || '其他'
      if (!groups[dayType]) groups[dayType] = []
      groups[dayType].push(item)
    }
    
    // 定义正确的字段顺序
    const fieldOrder = ['day_visit', 'day_all', 'stay1', 'stay2', 'stay3', 'stay4', 'stay5', 'stay6']
    const fieldLabels = {
      'day_visit': '日均到访人次',
      'day_all': '日均全量人次',
      'stay1': '停留<30分钟',
      'stay2': '停留30-60分钟',
      'stay3': '停留1-2小时',
      'stay4': '停留2-4小时',
      'stay5': '停留4-8小时',
      'stay6': '停留>8小时'
    }
    
    let html = ''
    for (const [dayType, items] of Object.entries(groups)) {
      // 跳过空数据
      if (items.length === 0) continue
      
      // 只显示工作日和周末，不显示"其他"的标题
      const showHeader = dayType !== '其他'
      
      const totalVisit = items.reduce((sum, item) => sum + (item.day_visit || 0), 0)
      const totalAll = items.reduce((sum, item) => sum + (item.day_all || 0), 0)
      
      html += `<div class="pop-group">`
      if (showHeader) {
        html += `<div class="group-header">${dayType} <span class="group-total">到访${totalVisit.toLocaleString()} / 全量${totalAll.toLocaleString()}</span></div>`
      }
      html += `<table class="data-table"><thead><tr><th>指标</th><th>数值</th></tr></thead><tbody>`
      
      for (const field of fieldOrder) {
        if (field in items[0]) {
          const values = items.map(item => item[field] || 0)
          const total = values.reduce((a, b) => a + b, 0)
          html += `<tr><td>${fieldLabels[field] || field}</td><td class="num">${total.toLocaleString()}</td></tr>`
        }
      }
      html += '</tbody></table></div>'
    }
    return html || '<p>暂无数据</p>'
  }
  
  // 如果是每月到达次数分布格式 {month, reach1/reach6, ...}
  // 检测：month 字段 + reach 开头的数字字段
  const hasReachFields = (obj) => {
    if (!obj || typeof obj !== 'object') return false
    const keys = Object.keys(obj)
    // 检查是否有 reach1-6 或 Reach1-6 等变体
    const reachNums = []
    for (const key of keys) {
      const match = key.match(/^reach(\d+)$/i)
      if (match) reachNums.push(parseInt(match[1]))
    }
    return reachNums.length > 0
  }
  
  if (hasReachFields(firstItem)) {
    // 动态检测 reach 字段并按数字排序
    const reachFields = []
    for (const key of Object.keys(firstItem)) {
      const match = key.match(/^reach(\d+)$/i)
      if (match) {
        reachFields.push({ key, num: parseInt(match[1]) })
      }
    }
    reachFields.sort((a, b) => a.num - b.num)
    
    // reach 字段名称映射（按序号）
    const reachLabels = {
      1: '月驻留1次',
      2: '月驻留2-4次',
      3: '月驻留5-10次',
      4: '月驻留11-20次',
      5: '月驻留20次以上'
    }
    
    // 按月排序（如果有 month 字段）
    const hasMonth = data.some(item => item.month !== undefined)
    const sorted = hasMonth ? [...data].sort((a, b) => (a.month || '').localeCompare(b.month || '')) : data
    
    let html = `<div class="pop-group">
      <table class="data-table"><thead><tr>`
    if (hasMonth) {
      html += `<th>月份</th>`
    }
    for (const { key, num } of reachFields) {
      html += `<th>${reachLabels[num] || key}</th>`
    }
    html += `</tr></thead><tbody>`
    
    for (const item of sorted) {
      if (hasMonth) {
        html += `<tr><td>${item.month || '-'}</td>`
      } else {
        html += `<tr>`
      }
      for (const { key } of reachFields) {
        html += `<td class="num">${(item[key] || 0).toLocaleString()}</td>`
      }
      html += '</tr>'
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 如果是小时段格式 {day_type, hour_period, hour_all, hour_visit} - 合并工作日和周末
  if (firstItem.day_type !== undefined && firstItem.hour_period !== undefined) {
    // 按小时分组
    const hourMap = new Map()
    
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const hour = item.hour_period
      if (!hourMap.has(hour)) {
        hourMap.set(hour, { 工作日: null, 周末: null })
      }
      const entry = hourMap.get(hour)
      if (item.day_type === 0) {
        entry.工作日 = item
      } else if (item.day_type === 1) {
        entry.周末 = item
      }
    }
    
    // 按小时排序
    const sortedHours = [...hourMap.entries()].sort((a, b) => a[0] - b[0])
    
    let html = `<div class="pop-group">
      <table class="data-table"><thead><tr><th>时段</th><th>工作日到访人次</th><th>周末到访人次</th><th>工作日全量人次</th><th>周末全量人次</th></tr></thead><tbody>`
    for (const [hour, entries] of sortedHours) {
      const weekday = entries.工作日
      const weekend = entries.周末
      html += `<tr>
        <td>${hour}点</td>
        <td class="num">${(weekday?.hour_visit || 0).toLocaleString()}</td>
        <td class="num">${(weekend?.hour_visit || 0).toLocaleString()}</td>
        <td class="num">${(weekday?.hour_all || 0).toLocaleString()}</td>
        <td class="num">${(weekend?.hour_all || 0).toLocaleString()}</td>
      </tr>`
    }
    html += '</tbody></table></div>'
    return html
  }
  
  // 默认数组格式 - 直接显示表格
  let html = `<table class="data-table"><thead><tr>`
  const headers = Object.keys(firstItem)
  for (const h of headers) {
    html += `<th>${h}</th>`
  }
  html += `</tr></thead><tbody>`
  
  for (const item of data.slice(0, 20)) {  // 限制前20行
    html += '<tr>'
    for (const h of headers) {
      const val = item[h]
      const display = typeof val === 'number' ? val.toLocaleString() : (val ?? '-')
      html += `<td class="num">${display}</td>`
    }
    html += '</tr>'
  }
  html += '</tbody></table>'
  return html
}

// 格式化其他服务数据（按人群类型分组）- 使用完整字段映射，表格形式
const formatOtherData = (data, serviceCode) => {
  // 按人群类型分组
  const groups = { '到访': {}, '居住': {}, '工作': {}, '其他': {} }
  
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== 'number') continue
    const type = getPopTypeLabel(key)
    if (type && groups[type]) {
      groups[type][key] = val
    } else {
      groups['其他'][key] = val
    }
  }
  
  let html = ''
  // 显示每个分组
  for (const [type, items] of Object.entries(groups)) {
    if (Object.keys(items).length === 0) continue
    const total = Object.values(items).reduce((a, b) => a + b, 0)
    
    // 按字段名排序
    const sortedItems = Object.entries(items).sort((a, b) => a[0].localeCompare(b[0]))
    
    html += `<div class="pop-group">
      <div class="group-header">${type}人口 <span class="group-total">${total.toLocaleString()}</span></div>
      <table class="data-table"><thead><tr><th>指标名称</th><th>数值</th></tr></thead><tbody>`
    for (const [key, val] of sortedItems) {
      const label = getFieldLabel(serviceCode, key)
      html += `<tr><td>${label}</td><td class="num">${val.toLocaleString()}</td></tr>`
    }
    html += '</tbody></table></div>'
  }
  return html
}

// 格式化结果显示
const formatResultData = (data) => {
  if (!data) return '<p>暂无数据</p>'
  
  // 如果 data 是字符串，尝试解析
  let apiResult = data
  if (typeof data === 'string') {
    try {
      apiResult = JSON.parse(data)
    } catch (e) {
      console.error('JSON解析失败:', e)
      return '<p>暂无数据</p>'
    }
  }
  
  // 如果 data 是 { apiResult: {...} } 格式
  if (apiResult && apiResult.apiResult) {
    apiResult = apiResult.apiResult
  }
  
  if (!apiResult || typeof apiResult !== 'object') return '<p>暂无数据</p>'
  if (apiResult.error) return `<p style="color:red;">❌ ${apiResult.error}</p>`

  let html = ''
  
  for (const [key, value] of Object.entries(apiResult)) {
    if (key === 'error') continue
    // 跳过排除列表中的服务
    if (excludeServices.includes(key)) continue
    const serviceName = getServiceName(key)
    
    // 1001 服务特殊处理 - 分列对比表格
    if (key === '1001' && typeof value === 'object' && !Array.isArray(value)) {
      html += `<div class="detail-result">
        ${formatP0SData(value)}
      </div>`
      continue
    }
    
    // 1006 每日人流量及停留时长 - 数组格式处理
    if (key === '1006' && Array.isArray(value)) {
      const stayLabelMap = {
        'stay1': '停留<30分钟',
        'stay2': '停留30-60分钟',
        'stay3': '停留1-2小时',
        'stay4': '停留2-4小时',
        'stay5': '停留4小时以上'
      };
      
      // 计算汇总数据
      let totalDayVisit = 0, totalDayAll = 0;
      let totalStay1 = 0, totalStay2 = 0, totalStay3 = 0, totalStay4 = 0, totalStay5 = 0;
      let dayCount = value.length;
      
      value.forEach(item => {
        totalDayVisit += item.day_visit || 0;
        totalDayAll += item.day_all || 0;
        totalStay1 += item.stay1 || 0;
        totalStay2 += item.stay2 || 0;
        totalStay3 += item.stay3 || 0;
        totalStay4 += item.stay4 || 0;
        totalStay5 += item.stay5 || 0;
      });
      
      const avgLabelMap = {
        'day_visit': '日均到访人次',
        'day_all': '日均全量人次',
        'stay1': '日均停留<30分钟',
        'stay2': '日均停留30-60分钟',
        'stay3': '日均停留1-2小时',
        'stay4': '日均停留2-4小时',
        'stay5': '日均停留4小时以上'
      };
      
      const avgData = {
        'day_visit': Math.round(totalDayVisit / dayCount),
        'day_all': Math.round(totalDayAll / dayCount),
        'stay1': Math.round(totalStay1 / dayCount),
        'stay2': Math.round(totalStay2 / dayCount),
        'stay3': Math.round(totalStay3 / dayCount),
        'stay4': Math.round(totalStay4 / dayCount),
        'stay5': Math.round(totalStay5 / dayCount)
      };
      
      let summaryHtml = '<table class="data-table"><thead><tr><th>指标</th><th class="num">日均值</th><th class="num">月度累计</th></tr></thead><tbody>';
      for (const [k, v] of Object.entries(avgData)) {
        const label = avgLabelMap[k] || k;
        const total = k === 'day_visit' ? totalDayVisit : 
                      k === 'day_all' ? totalDayAll :
                      k === 'stay1' ? totalStay1 :
                      k === 'stay2' ? totalStay2 :
                      k === 'stay3' ? totalStay3 :
                      k === 'stay4' ? totalStay4 : totalStay5;
        summaryHtml += `<tr><td>${label}</td><td class="num">${v.toLocaleString()}</td><td class="num">${total.toLocaleString()}</td></tr>`;
      }
      summaryHtml += '</tbody></table>';
      
      let detailHtml = '<table class="data-table" style="margin-top:10px;"><thead><tr><th>日期</th><th class="num">到访人次</th><th class="num">全量人次</th><th class="num">停留&lt;30m</th><th class="num">30-60m</th><th class="num">1-2h</th><th class="num">2-4h</th><th class="num">4h+</th></tr></thead><tbody>';
      value.forEach(item => {
        const dateStr = item.date ? `${item.date.slice(0,4)}-${item.date.slice(4,6)}-${item.date.slice(6,8)}` : '';
        detailHtml += `<tr>
          <td>${dateStr}</td>
          <td class="num">${(item.day_visit || 0).toLocaleString()}</td>
          <td class="num">${(item.day_all || 0).toLocaleString()}</td>
          <td class="num">${(item.stay1 || 0).toLocaleString()}</td>
          <td class="num">${(item.stay2 || 0).toLocaleString()}</td>
          <td class="num">${(item.stay3 || 0).toLocaleString()}</td>
          <td class="num">${(item.stay4 || 0).toLocaleString()}</td>
          <td class="num">${(item.stay5 || 0).toLocaleString()}</td>
        </tr>`;
      });
      detailHtml += '</tbody></table>';
      
      html += `<div class="detail-result">
        <h4>📊 ${serviceName}（${dayCount}天）</h4>
        <div style="font-size:11px;color:#909399;margin-bottom:8px;">数据范围：${value[0]?.date?.slice(0,4)}-${value[0]?.date?.slice(4,6)}-${value[0]?.date?.slice(6,8)} 至 ${value[value.length-1]?.date?.slice(0,4)}-${value[value.length-1]?.date?.slice(4,6)}-${value[value.length-1]?.date?.slice(6,8)}</div>
        <h5 style="margin:8px 0 4px;">📈 日均汇总</h5>
        ${summaryHtml}
        <h5 style="margin:12px 0 4px;">📅 每日明细</h5>
        ${detailHtml}
      </div>`
      continue
    }
    
    // 数组格式数据（如 1002, 1005 等）
    if (Array.isArray(value)) {
      html += `<div class="detail-result">
        <h4>📊 ${serviceName}</h4>
        ${formatArrayData(value, key)}
      </div>`
      continue
    }
    
    // 其他服务 - 传递服务代码以获取正确的中文标签
    if (typeof value === 'object' && !Array.isArray(value)) {
      html += `<div class="detail-result">
        <h4>📊 ${serviceName}</h4>
        ${formatOtherData(value, key)}
      </div>`
    } else if (typeof value === 'number') {
      html += `<div class="result-item">
        <span class="result-label">${serviceName}</span>
        <span class="result-value">${value.toLocaleString()}</span>
      </div>`
    }
  }
  
  return html || '<p>暂无数据</p>'
}

// Logo 上传处理：读取文件 → 压缩到 ≤400px → base64 data URL
const handleLogoUpload = (file) => {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
    ElMessage.warning('仅支持 PNG/JPG/WEBP/SVG 图片')
    return false
  }
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.warning('图片不能超过 2MB')
    return false
  }

  const reader = new FileReader()
  reader.onload = (e) => {
    const img = new Image()
    img.onload = () => {
      // 压缩：最长边 ≤ 400px，保持比例
      const MAX = 400
      let { width, height } = img
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/png')
      form.logo = dataUrl
      form.logoPreview = dataUrl
    }
    img.onerror = () => ElMessage.error('图片读取失败')
    img.src = e.target.result
  }
  reader.onerror = () => ElMessage.error('文件读取失败')
  reader.readAsDataURL(file)
  return false
}

const handleSubmit = async () => {
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  if (!form.email && !form.newPassword && form.company === userStore.user?.company && form.logo === (userStore.user?.logo || '')) {
    ElMessage.warning('请至少修改一项信息')
    return
  }

  loading.value = true

  try {
    const updateData = {}
    if (form.email) {
      updateData.email = form.email
    }
    if (form.newPassword) {
      updateData.password = form.newPassword
    }
    if (form.company !== undefined) {
      updateData.company = form.company
    }
    if (form.logo !== (userStore.user?.logo || '')) {
      updateData.logo = form.logo
    }

    const { data } = await axios.put('/api/users/me', updateData)

    // 更新本地用户信息
    await userStore.fetchUser()

    ElMessage.success(data.message || '修改成功')

    // 清空密码字段
    form.newPassword = ''
    form.confirmPassword = ''
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '修改失败')
  } finally {
    loading.value = false
  }
}

// ====== 图表相关函数 ======

// 监听图表列表变化，初始化图表
watch(chartList, (newList) => {
  if (newList.length > 0) {
    nextTick(() => initAllCharts())
  }
})

// 弹窗关闭时销毁图表
watch(detailDialogVisible, (visible) => {
  if (!visible) {
    disposeAllCharts()
    if (chartResizeHandler) {
      window.removeEventListener('resize', chartResizeHandler)
      chartResizeHandler = null
    }
  } else {
    // 弹窗打开时注册 resize 监听
    chartResizeHandler = () => {
      Object.values(chartInst.value).forEach(c => c?.resize())
    }
    window.addEventListener('resize', chartResizeHandler)
  }
})

// 销毁所有图表实例
const disposeAllCharts = () => {
  Object.values(chartInst.value).forEach(c => c?.dispose())
  chartInst.value = {}
  chartElMap.value = {}
}

// 初始化所有图表
const initAllCharts = () => {
  if (!resultData.value) return
  
  let apiResult = resultData.value
  if (typeof apiResult === 'string') {
    try { apiResult = JSON.parse(apiResult) } catch (e) { return }
  }
  if (apiResult && apiResult.apiResult) {
    apiResult = apiResult.apiResult
  }
  if (!apiResult || typeof apiResult !== 'object') return

  for (const item of chartList.value) {
    const dom = chartElMap.value[item.chartKey]
    if (!dom) continue
    const rawData = apiResult[item.serviceCode]
    if (!rawData) continue
    
    // 单个图表渲染失败不影响其他图表（防止未注册类型等异常中断循环）
    try {
      const option = buildChartOption(item.serviceCode, rawData, item.chartKey)
      if (!option) continue
      
      const chart = echarts.init(dom)
      chart.setOption(option)
      chartInst.value[item.chartKey] = chart
    } catch (e) {
      console.warn(`[图表渲染失败] ${item.title}:`, e)
    }
  }
}

// 生成 ECharts 配置
const buildChartOption = (code, data, chartKey) => {
  // 1001 子图分发
  if (code === '1001') {
    if (chartKey === '1001-a') return buildOption1001_Totals(data)
    if (chartKey === '1001-b') return buildOption1001_AgeLW(data)
    if (chartKey === '1001-c') return buildOption1001_AgeV(data)
    if (chartKey === '1001-d') return buildOption1001_Gender(data)
    return null
  }
  // 1005 子图分发
  if (code === '1005') {
    if (chartKey === '1005-a') return buildOption1005_Visit(data)
    if (chartKey === '1005-b') return buildOption1005_All(data)
    return null
  }
  // 1006 子图分发
  if (code === '1006') {
    if (chartKey === '1006-a') return buildOption1006_Daily(data)
    if (chartKey === '1006-b') return buildOption1006_Monthly(data)
    return null
  }
  // 1009 子图分发
  if (code === '1009') {
    if (chartKey === '1009-a') return buildOption1009_LW(data)
    if (chartKey === '1009-b') return buildOption1009_V(data)
    return null
  }
  // 1010 子图分发
  if (code === '1010') {
    if (chartKey === '1010-a') return buildOption1010_LW(data)
    if (chartKey === '1010-b') return buildOption1010_V(data)
    return null
  }
  // 1011 子图分发
  if (code === '1011') {
    if (chartKey === '1011-a') return buildOption1011_LW(data)
    if (chartKey === '1011-b') return buildOption1011_V(data)
    return null
  }
  // 1015 子图分发
  if (code === '1015') {
    if (chartKey === '1015-a') return buildOption1015_Pop(data, 0, '到访')
    if (chartKey === '1015-b') return buildOption1015_Pop(data, 1, '居住')
    if (chartKey === '1015-c') return buildOption1015_Pop(data, 2, '工作')
    return null
  }
  switch (code) {
    case '1001': return null // 已在上面通过子图分发
    case '1002': return buildOption1002ByPop(data, chartKey)
    case '1005': return null // 已在上面通过子图分发
    case '1006': return null // 已在上面通过子图分发
    case '1007': return buildOption1007(data)
    case '1009': return null // 已在上面通过子图分发
    case '1010': return null // 已在上面通过子图分发
    case '1011': return null // 已在上面通过子图分发
    case '1012': return buildOption1012(data)
    case '1013': return buildOption1013(data)
    case '1014': return null // 已隐藏
    case '1015': return null // 已在上面通过子图分发
    default: return null
  }
}

// 从数据中通过正则匹配取值（大小写不敏感，兼容后缀数字）
const findFieldValue = (data, pattern) => {
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== 'number') continue
    if (pattern.test(key)) return val
  }
  return 0
}

// 1001-a 全量人口 - 人口总数水平柱状图（到访/居住/工作/外省到访/娱乐）
const buildOption1001_Totals = (data) => {
  if (!data || typeof data !== 'object') return null
  const items = [
    { label: '到访人口数', pattern: /^P0_SUM\d*$/i },
    { label: '居住人口数', pattern: /^P1_SUM\d*$/i },
    { label: '工作人口数', pattern: /^P2_SUM\d*$/i },
    { label: '外省到访人口数', pattern: /^P3_SUM\d*$/i },
    { label: '娱乐人数', pattern: /^P4_SUM\d*$/i }
  ]
  const values = items.map(item => findFieldValue(data, item.pattern))
  if (values.every(v => v === 0)) return null
  
  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de']
  const labels = items.map(i => i.label)
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '20%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: labels.reverse(), axisLabel: { fontSize: 12 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar',
      data: values.reverse().map((v, i) => ({ 
        value: v, 
        itemStyle: { color: colors[labels.length - 1 - i] } 
      })),
      barMaxWidth: 36,
      label: { 
        show: true, position: 'right', 
        formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(),
        fontSize: 11, fontWeight: 'bold'
      }
    }]
  }
}

// 年龄分组定义（复用）
const ageGroups = [
  { label: '6-15岁', keys: ['0006', '0612', '1215'] },
  { label: '16-18岁', keys: ['1518'] },
  { label: '19-24岁', keys: ['1924'] },
  { label: '25-29岁', keys: ['2529'] },
  { label: '30-34岁', keys: ['3034'] },
  { label: '35-39岁', keys: ['3539'] },
  { label: '40-44岁', keys: ['4044'] },
  { label: '45-49岁', keys: ['4549'] },
  { label: '50-54岁', keys: ['5054'] },
  { label: '55-59岁', keys: ['5559'] },
  { label: '60-64岁', keys: ['6064'] },
  { label: '65-69岁', keys: ['6569'] },
  { label: '70岁以上', keys: ['70up'] }
]

// 从数据中获取年龄字段值（兼容多种命名格式）
const getAgeValue = (data, prefix, suffix) => {
  const pattern = new RegExp(`^AGE${prefix}_${suffix}$`, 'i')
  return findFieldValue(data, pattern)
}

// 1001-b 全量人口 - 居住+工作年龄分布（柱状图）
const buildOption1001_AgeLW = (data) => {
  if (!data || typeof data !== 'object') return null
  const calcAge = (prefix) => ageGroups.map(g => {
    return g.keys.reduce((sum, k) => sum + getAgeValue(data, prefix, k), 0)
  })
  const liveData = calcAge('1')
  const workData = calcAge('2')
  const labels = ageGroups.map(g => g.label)
  if (liveData.every(v => v === 0) && workData.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['居住', '工作'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '16%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [
      { name: '居住', type: 'bar', data: liveData, itemStyle: { color: '#5470c6' }, barMaxWidth: 24 },
      { name: '工作', type: 'bar', data: workData, itemStyle: { color: '#91cc75' }, barMaxWidth: 24 }
    ]
  }
}

// 1001-c 全量人口 - 到访年龄分布（柱状图）
const buildOption1001_AgeV = (data) => {
  if (!data || typeof data !== 'object') return null
  const visitData = ageGroups.map(g => {
    return g.keys.reduce((sum, k) => sum + getAgeValue(data, '0', k), 0)
  })
  const labels = ageGroups.map(g => g.label)
  if (visitData.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '12%', bottom: '8%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 35, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      name: '到访', type: 'bar', data: visitData,
      itemStyle: { color: '#fac858' }, barMaxWidth: 40,
      label: { show: true, position: 'top', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 9, rotate: 0 }
    }]
  }
}

// 1001-d 全量人口 - 居住+工作性别分布（垂直分组柱状图）
const buildOption1001_Gender = (data) => {
  if (!data || typeof data !== 'object') return null
  const maleLive = findFieldValue(data, /^MALE1_SUM\d*$/i)
  const maleWork = findFieldValue(data, /^MALE2_SUM\d*$/i)
  const femaleLive = findFieldValue(data, /^FEMALE1_SUM\d*$/i)
  const femaleWork = findFieldValue(data, /^FEMALE2_SUM\d*$/i)
  if (maleLive === 0 && maleWork === 0 && femaleLive === 0 && femaleWork === 0) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['男', '女'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '14%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: ['居住', '工作'], axisLabel: { fontSize: 12 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [
      { name: '男', type: 'bar', data: [maleLive, maleWork], itemStyle: { color: '#5470c6' }, barMaxWidth: 36,
        label: { show: true, position: 'top', formatter: (p) => p.value.toLocaleString(), fontSize: 10 } },
      { name: '女', type: 'bar', data: [femaleLive, femaleWork], itemStyle: { color: '#ee6666' }, barMaxWidth: 36,
        label: { show: true, position: 'top', formatter: (p) => p.value.toLocaleString(), fontSize: 10 } }
    ]
  }
}

// 1002 上网标签分布 - 按人群类型(popu_type)拆分的水平柱状图 Top10
const buildOption1002ByPop = (data, chartKey) => {
  if (!Array.isArray(data) || data.length === 0) return null
  // chartKey: 1002-a=到访(0) 1002-b=居住(1) 1002-c=工作(2)
  const popMap = { '1002-a': 0, '1002-b': 1, '1002-c': 2 }
  const popType = popMap[chartKey]
  if (popType === undefined) return null
  const filtered = data.filter(d => d && d.popu_type === popType && d.tag_name !== undefined)
  if (filtered.length === 0) return null
  const sorted = [...filtered].sort((a, b) => (b.tag_value || 0) - (a.tag_value || 0)).slice(0, 10)
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '8%', bottom: '3%', top: '3%', containLabel: true },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: sorted.map(d => d.tag_name || '').reverse(), axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar',
      data: sorted.map(d => d.tag_value || 0).reverse(),
      itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
        { offset: 0, color: '#667eea' },
        { offset: 1, color: '#764ba2' }
      ]) }
    }]
  }
}

// 1005-a 每小时段人口流量 - 到访（双折线）
const buildOption1005_Visit = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const weekdays = data.filter(d => d.day_type === 0)
  const weekends = data.filter(d => d.day_type === 1)
  const periods = [...new Set(data.map(d => d.hour_period))].sort((a, b) => Number(a) - Number(b))
  const getData = (arr) => periods.map(p => {
    const found = arr.find(d => d.hour_period === p)
    return found ? (found.hour_visit || 0) : 0
  })
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['工作日到访', '周末到访'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '18%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: periods.map(p => p + '点'), axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value' },
    series: [
      { name: '工作日到访', type: 'line', smooth: true, data: getData(weekdays), itemStyle: { color: '#5470c6' }, areaStyle: { color: 'rgba(84,112,198,0.1)' } },
      { name: '周末到访', type: 'line', smooth: true, data: getData(weekends), itemStyle: { color: '#91cc75' }, areaStyle: { color: 'rgba(145,204,117,0.1)' } }
    ]
  }
}

// 1005-b 每小时段人口流量 - 全量（双折线）
const buildOption1005_All = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const weekdays = data.filter(d => d.day_type === 0)
  const weekends = data.filter(d => d.day_type === 1)
  const periods = [...new Set(data.map(d => d.hour_period))].sort((a, b) => Number(a) - Number(b))
  const getData = (arr) => periods.map(p => {
    const found = arr.find(d => d.hour_period === p)
    return found ? (found.hour_all || 0) : 0
  })
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['工作日全量', '周末全量'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '18%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: periods.map(p => p + '点'), axisLabel: { rotate: 45, fontSize: 10 } },
    yAxis: { type: 'value' },
    series: [
      { name: '工作日全量', type: 'line', smooth: true, data: getData(weekdays), itemStyle: { color: '#ee6666' }, areaStyle: { color: 'rgba(238,102,102,0.1)' } },
      { name: '周末全量', type: 'line', smooth: true, data: getData(weekends), itemStyle: { color: '#73c0de' }, areaStyle: { color: 'rgba(115,192,222,0.1)' } }
    ]
  }
}

// 1006-a 每日人流量 - 日均值（水平柱状图）
const buildOption1006_Daily = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const dayCount = data.length
  // 计算汇总
  let totalDayVisit = 0, totalDayAll = 0;
  let totalStay1 = 0, totalStay2 = 0, totalStay3 = 0, totalStay4 = 0, totalStay5 = 0;
  data.forEach(item => {
    totalDayVisit += item.day_visit || 0;
    totalDayAll += item.day_all || 0;
    totalStay1 += item.stay1 || 0;
    totalStay2 += item.stay2 || 0;
    totalStay3 += item.stay3 || 0;
    totalStay4 += item.stay4 || 0;
    totalStay5 += item.stay5 || 0;
  });
  const avgData = {
    '日均到访人次': Math.round(totalDayVisit / dayCount),
    '日均全量人次': Math.round(totalDayAll / dayCount),
    '日均停留<30分钟': Math.round(totalStay1 / dayCount),
    '日均停留30-60分钟': Math.round(totalStay2 / dayCount),
    '日均停留1-2小时': Math.round(totalStay3 / dayCount),
    '日均停留2-4小时': Math.round(totalStay4 / dayCount),
    '日均停留4小时以上': Math.round(totalStay5 / dayCount)
  };
  if (Object.values(avgData).every(v => v === 0)) return null
  
  const labels = Object.keys(avgData).reverse()
  const values = Object.values(avgData).reverse()
  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452']
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '20%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i % colors.length] } })),
      barMaxWidth: 30,
      label: { show: true, position: 'right', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 10 }
    }]
  }
}

// 1006-b 每日人流量 - 月度累计（垂直柱状图）
const buildOption1006_Monthly = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  let totalDayVisit = 0, totalDayAll = 0;
  let totalStay1 = 0, totalStay2 = 0, totalStay3 = 0, totalStay4 = 0, totalStay5 = 0;
  data.forEach(item => {
    totalDayVisit += item.day_visit || 0;
    totalDayAll += item.day_all || 0;
    totalStay1 += item.stay1 || 0;
    totalStay2 += item.stay2 || 0;
    totalStay3 += item.stay3 || 0;
    totalStay4 += item.stay4 || 0;
    totalStay5 += item.stay5 || 0;
  });
  const monthData = {
    '月度到访人次': totalDayVisit,
    '月度全量人次': totalDayAll,
    '停留<30分钟': totalStay1,
    '停留30-60分钟': totalStay2,
    '停留1-2小时': totalStay3,
    '停留2-4小时': totalStay4,
    '停留4小时以上': totalStay5
  };
  if (Object.values(monthData).every(v => v === 0)) return null
  
  const labels = Object.keys(monthData)
  const values = Object.values(monthData)
  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452']
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '4%', bottom: '14%', top: '5%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 25, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar',
      data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i % colors.length] } })),
      barMaxWidth: 40,
      label: { show: true, position: 'top', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 9 }
    }]
  }
}

// 1007 每月到达次数分布 - 水平柱状图
const buildOption1007 = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  // 按数字排序 reach 字段
  const reachKeys = Object.keys(data[0])
    .filter(k => /^reach\d+$/i.test(k))
    .sort((a, b) => {
      const numA = parseInt(a.match(/reach(\d+)/i)[1])
      const numB = parseInt(b.match(/reach(\d+)/i)[1])
      return numA - numB
    })
  if (reachKeys.length === 0) return null
  
  // reach 标签映射（与 formatArrayData 一致）
  const reachLabels = {
    1: '月驻留1次', 2: '月驻留2-4次', 3: '月驻留5-10次',
    4: '月驻留11-20次', 5: '月驻留20次以上'
  }
  const categories = reachKeys.map(k => {
    const num = parseInt(k.match(/reach(\d+)/i)[1])
    return reachLabels[num] || k
  })
  const values = reachKeys.map(k => data.reduce((s, d) => s + (d[k] || 0), 0))
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '18%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: categories.reverse(), axisLabel: { fontSize: 11 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar', data: values.reverse(),
      barMaxWidth: 30,
      label: { show: true, position: 'right', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 10 },
      itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
        { offset: 0, color: '#667eea' },
        { offset: 1, color: '#764ba2' }
      ]) }
    }]
  }
}

// 通用: 人群画像分组柱状图 (popu_type = 1/2 到访/居住，多个数值字段)
const buildPopBarOption = (data, fieldLabels, fieldKeys, title) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const popTypes = ['1', '2']
  const popLabels = ['到访', '居住']
  
  const series = popTypes.map((pt, idx) => ({
    name: popLabels[idx],
    type: 'bar',
    data: fieldKeys.map(k => {
      const found = data.find(d => String(d.popu_type) === pt)
      return found ? (found[k] || 0) : 0
    })
  }))
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: popLabels, bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '18%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: fieldLabels, axisLabel: { rotate: 20, fontSize: 10 } },
    yAxis: { type: 'value' },
    series
  }
}

// 1009-a 消费水平 - 居住+工作（垂直分组柱状图）
const buildOption1009_LW = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  // popu_type: 0=到访, 1=居住, 2=工作（formatArrayData 第820-821行）
  const spendLabels = { 1: '极低', 2: '低', 3: '中低', 4: '中等', 5: '中高', 6: '高', 7: '极高', 8: '超高' }
  const levels = [...new Set(data.map(d => d.spendpower))].filter(v => v != null).sort((a, b) => a - b)
  const getPopData = (popType) => levels.map(level => {
    const found = data.find(d => d.popu_type === popType && d.spendpower === level)
    return found ? (found.spendpower_value || 0) : 0
  })
  const liveData = getPopData(1) // 居住
  const workData = getPopData(2) // 工作
  const labels = levels.map(l => spendLabels[l] || `等级${l}`)
  if (liveData.every(v => v === 0) && workData.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['居住', '工作'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '16%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [
      { name: '居住', type: 'bar', data: liveData, itemStyle: { color: '#5470c6' }, barMaxWidth: 24 },
      { name: '工作', type: 'bar', data: workData, itemStyle: { color: '#91cc75' }, barMaxWidth: 24 }
    ]
  }
}

// 1009-b 消费水平 - 到访（水平柱状图，单色浅橙黄）
const buildOption1009_V = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const spendLabels = { 1: '极低', 2: '低', 3: '中低', 4: '中等', 5: '中高', 6: '高', 7: '极高', 8: '超高' }
  const visitItems = data.filter(d => d.popu_type === 0).sort((a, b) => (a.spendpower || 0) - (b.spendpower || 0))
  if (visitItems.length === 0) return null
  
  const reversed = [...visitItems].reverse()
  const labels = reversed.map(d => spendLabels[d.spendpower] || `等级${d.spendpower}`)
  const values = reversed.map(d => d.spendpower_value || 0)
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '20%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: labels, axisLabel: { fontSize: 11 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar', data: values.map(v => ({ value: v })),
      itemStyle: { color: '#e8a838' },
      barMaxWidth: 30,
      label: { show: true, position: 'right', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 10 }
    }]
  }
}

// 1010-a 教育水平 - 居住+工作（垂直分组柱状图）
const buildOption1010_LW = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  // popu_type: 0=到访, 1=居住, 2=工作
  const eduKeys = ['p0', 'p1', 'p2', 'p3', 'p4']
  const eduLabels = ['高中及以下', '大专', '本科', '硕士', '博士']
  const getPopData = (popType) => eduKeys.map(k => {
    const found = data.find(d => d.popu_type === popType)
    return found ? (found[k] || 0) : 0
  })
  const liveData = getPopData(1)
  const workData = getPopData(2)
  if (liveData.every(v => v === 0) && workData.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['居住', '工作'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '16%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: eduLabels, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [
      { name: '居住', type: 'bar', data: liveData, itemStyle: { color: '#5470c6' }, barMaxWidth: 28 },
      { name: '工作', type: 'bar', data: workData, itemStyle: { color: '#91cc75' }, barMaxWidth: 28 }
    ]
  }
}

// 1010-b 教育水平 - 到访（水平柱状图，珊瑚粉单色）
const buildOption1010_V = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const eduKeys = ['p0', 'p1', 'p2', 'p3', 'p4']
  const eduLabels = ['高中及以下', '大专', '本科', '硕士', '博士']
  const visitItem = data.find(d => d.popu_type === 0)
  if (!visitItem) return null
  const values = eduKeys.map(k => visitItem[k] || 0).reverse()
  const labels = [...eduLabels].reverse()
  if (values.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '20%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: labels, axisLabel: { fontSize: 11 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar', data: values.map(v => ({ value: v })),
      itemStyle: { color: '#f08080' },
      barMaxWidth: 30,
      label: { show: true, position: 'right', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 10 }
    }]
  }
}

// 1011-a 行业分布 - 居住+工作（垂直分组柱状图）
const buildOption1011_LW = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const pLabels = { p1:'金融从业者', p2:'医务人员', p3:'公务员&事业单位', p4:'白领及一般职员',
    p5:'工人及服务业人员', p6:'教师', p7:'农民及其他', p8:'网约车司机', p9:'外卖员', p10:'快递员' }
  const pKeys = ['p1','p2','p3','p4','p5','p6','p7','p8','p9','p10']
  const labels = pKeys.map(k => pLabels[k])
  const calcPop = (popType) => pKeys.map(k => {
    return data.filter(d => d.popu_type === popType).reduce((s, d) => s + (d[k] || 0), 0)
  })
  const liveData = calcPop(1)
  const workData = calcPop(2)
  if (liveData.every(v => v === 0) && workData.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['居住', '工作'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '16%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 25, fontSize: 9 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [
      { name: '居住', type: 'bar', data: liveData, itemStyle: { color: '#5470c6' }, barMaxWidth: 20 },
      { name: '工作', type: 'bar', data: workData, itemStyle: { color: '#91cc75' }, barMaxWidth: 20 }
    ]
  }
}

// 1011-b 行业分布 - 到访（水平柱状图，珊瑚橙单色）
const buildOption1011_V = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const pLabels = { p1:'金融从业者', p2:'医务人员', p3:'公务员&事业单位', p4:'白领及一般职员',
    p5:'工人及服务业人员', p6:'教师', p7:'农民及其他', p8:'网约车司机', p9:'外卖员', p10:'快递员' }
  const pKeys = ['p1','p2','p3','p4','p5','p6','p7','p8','p9','p10']
  const values = pKeys.map(k => data.filter(d => d.popu_type === 0).reduce((s, d) => s + (d[k] || 0), 0))
  const labels = pKeys.map(k => pLabels[k]).reverse()
  if (values.every(v => v === 0)) return null
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      return `${p.name}<br/>${p.value.toLocaleString()} 人`
    }},
    grid: { left: '3%', right: '20%', bottom: '3%', top: '3%', containLabel: true },
    yAxis: { type: 'category', data: labels.reverse(), axisLabel: { fontSize: 10 } },
    xAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series: [{
      type: 'bar', data: values.reverse().map(v => ({ value: v })),
      itemStyle: { color: '#ff8c69' },
      barMaxWidth: 24,
      label: { show: true, position: 'right', formatter: (p) => p.value >= 10000 ? (p.value/10000).toFixed(1) + '万' : p.value.toLocaleString(), fontSize: 9 }
    }]
  }
}

// 1012 人生阶段分布 - 三饼并排（到访/居住/工作）
const buildOption1012 = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const stageLabels = ['未婚单身', '未婚恋爱', '已婚']
  const stageKeys = ['p1', 'p2', 'p3']
  const colors = ['#5470c6', '#91cc75', '#fac858']
  const typeLabels = ['到访', '居住', '工作']
  
  const getPieData = (popType) => {
    const item = data.find(d => d.popu_type === popType)
    if (!item) return null
    const vals = stageKeys.map(k => item[k] || 0)
    if (vals.every(v => v === 0)) return null
    return stageKeys.map((k, i) => ({ name: stageLabels[i], value: item[k] || 0, itemStyle: { color: colors[i] } }))
  }
  const validTypes = [0, 1, 2].filter(pt => getPieData(pt) !== null)
  if (validTypes.length === 0) return null
  
  // 根据有效饼图数量动态分配位置
  const positions = validTypes.length === 1 ? [['50%', '50%']] :
    validTypes.length === 2 ? [['30%', '50%'], ['70%', '50%']] :
    [['18%', '50%'], ['50%', '50%'], ['82%', '50%']]
  
  return {
    tooltip: { trigger: 'item', formatter: (p) => `${p.seriesName}<br/>${p.name}: ${p.value} (${(p.percent || 0).toFixed(1)}%)` },
    title: validTypes.map((pt, idx) => ({
      text: typeLabels[pt],
      left: positions[idx][0],
      top: '6%',
      textAlign: 'center',
      textStyle: { fontSize: 13, fontWeight: 'bold', color: '#333' }
    })),
    series: validTypes.map((pt, idx) => ({
      name: typeLabels[pt],
      type: 'pie', radius: ['20%', '40%'], center: positions[idx],
      data: getPieData(pt),
      label: { fontSize: 10, formatter: (p) => `${p.name}\n${(p.percent || 0).toFixed(1)}%` },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } }
    }))
  }
}

// 1013 综合消费能力预测 - 三饼并排（到访/居住/工作）
const buildOption1013 = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const consumeLabels = ['低', '中', '高']
  const consumeKeys = ['p1', 'p2', 'p3']
  const colors = ['#ee6666', '#fac858', '#91cc75']
  const typeLabels = ['到访', '居住', '工作']
  
  const getPieData = (popType) => {
    const item = data.find(d => d.popu_type === popType)
    if (!item) return null
    const vals = consumeKeys.map(k => item[k] || 0)
    if (vals.every(v => v === 0)) return null
    return consumeKeys.map((k, i) => ({ name: consumeLabels[i], value: item[k] || 0, itemStyle: { color: colors[i] } }))
  }
  const validTypes = [0, 1, 2].filter(pt => getPieData(pt) !== null)
  if (validTypes.length === 0) return null
  
  const positions = validTypes.length === 1 ? [['50%', '50%']] :
    validTypes.length === 2 ? [['30%', '50%'], ['70%', '50%']] :
    [['18%', '50%'], ['50%', '50%'], ['82%', '50%']]
  
  return {
    tooltip: { trigger: 'item', formatter: (p) => `${p.seriesName}<br/>${p.name}: ${p.value} (${(p.percent || 0).toFixed(1)}%)` },
    title: validTypes.map((pt, idx) => ({
      text: typeLabels[pt],
      left: positions[idx][0],
      top: '6%',
      textAlign: 'center',
      textStyle: { fontSize: 13, fontWeight: 'bold', color: '#333' }
    })),
    series: validTypes.map((pt, idx) => ({
      name: typeLabels[pt],
      type: 'pie', radius: ['20%', '40%'], center: positions[idx],
      data: getPieData(pt),
      label: { fontSize: 10, formatter: (p) => `${p.name}\n${(p.percent || 0).toFixed(1)}%` },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } }
    }))
  }
}

// 1014 网购能力预测 - 已隐藏

// 1015 资产预测 - 按人群类型生成3张图表
const buildOption1015_Pop = (data, popType, popLabel) => {
  if (!Array.isArray(data) || data.length === 0) return null
  const pLabels = { p1: '预测概率高', p2: '预测概率中高', p3: '预测概率中', p4: '预测概率中低', p5: '预测概率低' }
  const pKeys = ['p1', 'p2', 'p3', 'p4', 'p5']
  const assetLabels = ['收入预测', '有车预测', '有房预测']
  
  // 获取该人群的 fname 数据
  const popItems = data.filter(d => d.popu_type === popType)
  if (popItems.length === 0) return null
  const fnames = [...new Set(popItems.map(d => d.fname))].filter(Boolean)
  // 按标准顺序排列
  const orderedFnames = assetLabels.filter(l => fnames.includes(l))
  if (orderedFnames.length === 0) return null
  
  const series = orderedFnames.map((fname, idx) => {
    const colors = ['#5470c6', '#91cc75', '#fac858']
    const found = popItems.find(d => d.fname === fname)
    return {
      name: fname,
      type: 'bar',
      data: pKeys.map(k => (found ? (found[k] || 0) : 0)),
      itemStyle: { color: colors[idx % colors.length] }
    }
  })
  const xLabels = pKeys.map(k => pLabels[k])
  
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: orderedFnames, bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '18%', top: '3%', containLabel: true },
    xAxis: { type: 'category', data: xLabels, axisLabel: { rotate: 15, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v >= 10000 ? (v/10000).toFixed(0) + '万' : v.toLocaleString() } },
    series
  }
}

// ====== 数据洞察 ======

const handleDataInsight = async () => {
  if (!resultData.value) return
  insightLoading.value = true
  insights.value = []
  await nextTick()
  
  try {
    let apiResult = resultData.value
    if (typeof apiResult === 'string') apiResult = JSON.parse(apiResult)
    if (apiResult?.apiResult) apiResult = apiResult.apiResult
    if (!apiResult || typeof apiResult !== 'object') {
      insights.value = [{ type: 'info', text: '暂无足够数据进行分析' }]
      return
    }
    
    const result = []
    
    // 1001 全量人口分析
    if (apiResult['1001'] && typeof apiResult['1001'] === 'object') {
      const d = apiResult['1001']
      const v = (k) => findFieldValue(d, new RegExp('^' + k + '\\d*$', 'i'))
      const visitPop = v('P0_SUM')
      const livePop = v('P1_SUM')
      const workPop = v('P2_SUM')
      const outPop = v('P3_SUM')
      
      if (livePop > 0 || workPop > 0) {
        const ratio = livePop / (workPop || 1)
        if (ratio > 3) result.push({ type: 'positive', text: `🏠 商圈类型识别：居住人口是工作人口的${ratio.toFixed(1)}倍，属于居住型商圈，适合社区服务、生活配套类业态` })
        else if (ratio < 0.5) result.push({ type: 'warning', text: `💼 商圈类型识别：工作人口是居住人口的${(1/ratio).toFixed(1)}倍，属于商务型商圈，适合快餐、便利类业态` })
        else result.push({ type: 'info', text: `⚖️ 商圈类型识别：居住与工作人口相对均衡（${livePop.toLocaleString()} : ${workPop.toLocaleString()}），属于混合型商圈` })
      }
      if (outPop > livePop * 0.3) {
        result.push({ type: 'info', text: `🚶 外部吸引力：外省到访人口占居住人口${(outPop/livePop*100).toFixed(0)}%，该区域有较强的跨区域吸引力` })
      }
      // 性别分析
      const maleV = v('MALE0_SUM') + v('MALE1_SUM')
      const femV = v('FEMALE0_SUM') + v('FEMALE1_SUM')
      if (maleV + femV > 0) {
        const mp = (maleV / (maleV + femV) * 100).toFixed(0)
        result.push({ type: 'info', text: `👫 性别比例：男性 ${mp}% / 女性 ${(100-parseInt(mp))}%` })
      }
    }
    
    // 1005 小时段分析
    if (Array.isArray(apiResult['1005']) && apiResult['1005'].length > 0) {
      const data = apiResult['1005']
      const weekdays = data.filter(d => d.day_type === 0)
      if (weekdays.length > 0) {
        const peak = [...weekdays].sort((a, b) => (b.hour_visit || 0) - (a.hour_visit || 0))[0]
        if (peak) result.push({ type: 'positive', text: `⏰ 客流高峰：工作日的 ${peak.hour_period}点 到访人次最高（${peak.hour_visit?.toLocaleString() || 0}人），适合在此时段重点运营` })
      }
    }
    
    // 1010 教育水平
    if (Array.isArray(apiResult['1010']) && apiResult['1010'].length > 0) {
      const visit = apiResult['1010'].find(d => d.popu_type === 0)
      if (visit) {
        const total = (visit.p0||0)+(visit.p1||0)+(visit.p2||0)+(visit.p3||0)+(visit.p4||0)
        if (total > 0) {
          const college = ((visit.p2||0)+(visit.p3||0)+(visit.p4||0))/total*100
          result.push({ type: college > 50 ? 'positive' : 'info',
            text: `🎓 学历分析：本科及以上占比 ${college.toFixed(0)}%，客群${college > 50 ? '素质较高，适合中高端定位' : '以基础学历为主'}` })
        }
      }
    }
    
    // 1009 消费水平
    if (Array.isArray(apiResult['1009']) && apiResult['1009'].length > 0) {
      const visit = apiResult['1009'].filter(d => d.popu_type === 0)
      if (visit.length > 0) {
        const total = visit.reduce((s, d) => s + (d.spendpower_value || 0), 0)
        const high = visit.filter(d => d.spendpower >= 5).reduce((s, d) => s + (d.spendpower_value || 0), 0)
        if (total > 0) {
          const hp = high/total*100
          result.push({ type: hp > 40 ? 'positive' : 'info',
            text: `💰 消费力分析：中高消费人群占比 ${hp.toFixed(0)}%${hp > 40 ? '，消费潜力充足' : '，消费力偏保守'}` })
        }
      }
    }
    
    // 1006 停留时长
    if (Array.isArray(apiResult['1006']) && apiResult['1006'].length > 0) {
      const data = apiResult['1006']
      const totalStay = data.reduce((s, d) => s + (d.stay1||0)+(d.stay2||0)+(d.stay3||0)+(d.stay4||0)+(d.stay5||0), 0)
      const longStay = data.reduce((s, d) => s + (d.stay4||0)+(d.stay5||0), 0)
      if (totalStay > 0) {
        const lp = longStay/totalStay*100
        result.push({ type: lp > 30 ? 'positive' : 'info',
          text: `⏳ 停留时长：${lp > 30 ? `${lp.toFixed(0)}%的顾客停留超过2小时，适合体验式消费业态` : '顾客以短时停留为主，适合快节奏消费业态'}` })
      }
    }
    
    // 1011 行业分布
    if (Array.isArray(apiResult['1011']) && apiResult['1011'].length > 0) {
      const visit = apiResult['1011'].filter(d => d.popu_type === 0)
      if (visit.length > 0) {
        const sectors = ['p1','p2','p3','p4','p5','p6','p7','p8','p9','p10']
        const maxS = sectors.map(k => ({ key: k, val: visit.reduce((s,d) => s+(d[k]||0), 0) }))
          .sort((a,b) => b.val - a.val)[0]
        if (maxS && maxS.val > 0) {
          const pLabels = {p1:'金融',p2:'医疗',p3:'公务员',p4:'白领',p5:'工人',p6:'教师',p7:'农民',p8:'网约车',p9:'外卖',p10:'快递'}
          result.push({ type: 'info', text: `🧑‍💼 从业分析：到访人群中占比最高的行业是「${pLabels[maxS.key] || maxS.key}」` })
        }
      }
    }
    
    if (result.length === 0) {
      result.push({ type: 'info', text: '当前数据维度有限，无法生成有意义的分析建议' })
    }
    insights.value = result
  } catch (e) {
    console.error('数据分析失败:', e)
    insights.value = [{ type: 'warning', text: '数据分析失败: ' + e.message }]
  } finally {
    insightLoading.value = false
  }
}

// 导出报表下拉菜单处理
const handleExportDropdown = (command) => {
  if (command === 'excel') {
    handleExportExcel()
  } else if (command === 'pdf') {
    handleExportPDFAsReport()
  }
}

// 导出报表PDF：后端生成Excel后再用LibreOffice转为PDF
const handleExportPDFAsReport = async () => {
  if (!currentDetail.value) {
    ElMessage.info('暂无数据可导出')
    return
  }
  try {
    ElMessage.info('正在生成报表PDF，请稍候...')
    const id = currentDetail.value.id

    // 1. 获取地图数据和截图（同导出Excel）
    let competitorScreenshot = null
    let shoppingCenterScreenshot = null
    let mapScreenshot = null
    let centerLat = null
    let centerLng = null
    let actualRadius = 3000

    try {
      const [compResp, shopResp] = await Promise.all([
        axios.get(`/api/purchase/${id}/competitors-for-map`),
        axios.get(`/api/purchase/${id}/shopping-centers-for-map`)
      ])
      const mapData = compResp.data
      const shopData = shopResp.data
      centerLat = mapData.center.lat
      centerLng = mapData.center.lng
      actualRadius = Array.isArray(currentDetail.value.radii) ? currentDetail.value.radii[0] : 3000

      if (mapData.competitors && mapData.competitors.length > 0) {
        competitorScreenshot = await captureMapToCanvas(centerLat, centerLng, 3000, mapData.competitors, 14)
      } else {
        competitorScreenshot = await captureMapToCanvas(centerLat, centerLng, 3000, [], 14)
      }

      try {
        const centerList = (shopData.centers && Array.isArray(shopData.centers)) ? shopData.centers : []
        shoppingCenterScreenshot = await captureShoppingCenterMap(centerLat, centerLng, centerList, 14)
      } catch (scErr) { console.warn('购物中心截图失败:', scErr) }

      try {
        mapScreenshot = await captureMapOnlyCanvas(centerLat, centerLng, actualRadius)
      } catch (mErr) { console.warn('地图截图失败:', mErr) }
    } catch (mapErr) {
      console.warn('地图数据获取失败:', mapErr)
    }

    // 生成文件名用半径字符串
    const radiiStr = Array.isArray(currentDetail.value?.radii) 
      ? currentDetail.value.radii.join('_') + '米' 
      : (currentDetail.value?.radii || '未知') + '米'

    // 2. 调用PDF导出API（后端生成Excel后转为PDF）
    const response = await axios.post(`/api/purchase/${id}/export-pdf-report`, {
      competitorScreenshot,
      shoppingCenterScreenshot,
      mapScreenshot,
      filename: `${currentDetail.value.store_name || '门店'}_${radiiStr}_${currentDetail.value.city_month || ''}_报表`
    }, { responseType: 'blob' })

    // 3. 下载PDF
    const disposition = response.headers['content-disposition']
    let pdfName = `${currentDetail.value.store_name || '门店'}_${radiiStr}_${currentDetail.value.city_month || ''}_报表.pdf`
    if (disposition) {
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
      if (match) pdfName = decodeURIComponent(match[1])
    }
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.download = pdfName
    link.click()
    window.URL.revokeObjectURL(url)

    ElMessage.success('报表PDF导出成功')
  } catch (e) {
    console.error('报表PDF导出失败:', e)
    ElMessage.error('报表PDF导出失败: ' + (e.response?.data?.message || e.message))
  }
}

// ====== PDF 导出 ======
// 生成 PDF 报告 Logo 区：插入到「订单信息」右侧，与订单信息并排显示
// 返回 { host, infoEl, hostOriginalDisplay, infoElOriginalFlex } 用于 finally 还原
const buildPdfReportHeader = () => {
  const container = pdfContentRef.value
  if (!container) return null
  const infoEl = container.querySelector('.detail-info')
  if (!infoEl) return null
  const logo = form.logo || userStore.user?.logo
  const company = form.company || userStore.user?.company || ''
  // 既无 Logo 也无公司名，则不插入
  if (!logo && !company) return null

  // 给 .detail-info 临时加 position:relative，让 logoWrap 绝对定位锚定其右上角
  const infoElOriginalPosition = infoEl.style.position
  infoEl.style.position = 'relative'

  // logoWrap 用绝对定位：top:12px right:12px 与 .detail-info 内边距对齐，垂直居中于 infoEl 上半区
  const logoWrap = document.createElement('div')
  logoWrap.id = 'pdf-report-logo-wrap'
  logoWrap.style.cssText = 'position:absolute;top:12px;right:12px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:0;min-width:120px;max-width:160px;'
  if (logo) {
    const img = document.createElement('img')
    img.src = logo
    img.alt = 'Logo'
    img.style.cssText = 'max-height:60px;max-width:140px;object-fit:contain;'
    logoWrap.appendChild(img)
  }
  if (company) {
    const name = document.createElement('span')
    name.style.cssText = 'font-size:13px;font-weight:bold;color:#333;margin-top:6px;text-align:center;'
    name.textContent = company
    logoWrap.appendChild(name)
  }
  infoEl.appendChild(logoWrap)

  // 返回还原所需句柄
  return { infoEl, infoElOriginalPosition }
}

const handleExportPDF = async () => {
  if (!pdfContentRef.value) return
  const reportHeader = buildPdfReportHeader()
  try {
    ElMessage.info('正在生成PDF，请稍候...')
    // 确保所有图表已渲染
    Object.values(chartInst.value).forEach(c => c?.resize())
    await nextTick()
    
    const { default: html2canvas } = await import('html2canvas')
    const { jsPDF } = await import('jspdf')
    
    const canvas = await html2canvas(pdfContentRef.value, {
      useCORS: true,
      scale: 2,       // 2倍清晰度，配合JPEG压缩控制文件大小
      backgroundColor: '#ffffff',
      logging: false
    })
    
    // JPEG 6成质量 —— 图表/表格以纯色为主，压缩效率高
    const imgData = canvas.toDataURL('image/jpeg', 0.6)
    const imgWidth = 210 // A4 纵向宽度 210mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    
    // 纵向单页，按内容高度自定义页面尺寸
    const pdf = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: [imgWidth, imgHeight + 10] // +10mm 留白边
    })
    
    pdf.addImage(imgData, 'JPEG', 0, 5, imgWidth, imgHeight)
    
    // 文件名：门店名称_半径_数据年月
    const storeName = currentDetail.value?.store_name?.replace(/[/\\:]/g, '_') || '未知门店'
    const radii = Array.isArray(currentDetail.value?.radii) 
      ? currentDetail.value.radii.join('_') + '米' 
      : (currentDetail.value?.radii || '未知') + '米'
    const cityMonth = currentDetail.value?.city_month || '未知年月'
    pdf.save(`${storeName}_${radii}_${cityMonth}.pdf`)
    ElMessage.success('PDF 导出成功')
  } catch (e) {
    console.error('PDF导出失败:', e)
    ElMessage.error('PDF导出失败: ' + e.message)
  } finally {
    // 移除临时 Logo 区，还原 .detail-info 原 position
    const wrap = document.getElementById('pdf-report-logo-wrap')
    if (wrap && wrap.parentNode) {
      wrap.parentNode.removeChild(wrap)
    }
    if (reportHeader) {
      reportHeader.infoEl.style.position = reportHeader.infoElOriginalPosition
    }
  }
}

// ====== 微信分享 ======
const shareDialogVisible = ref(false)
const shareImageData = ref(null)

const handleShareToWeChat = async () => {
  if (!pdfContentRef.value) return
  ElMessage.info('正在生成分享图片...')
  try {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(pdfContentRef.value, {
      useCORS: true,
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false
    })
    shareImageData.value = canvas.toDataURL('image/png')
    shareDialogVisible.value = true
  } catch (e) {
    console.error('生成分享图片失败:', e)
    ElMessage.error('生成分享图片失败: ' + e.message)
  }
}

const copyImageToClipboard = async () => {
  if (!shareImageData.value) return
  try {
    // Base64 → Blob
    const res = await fetch(shareImageData.value)
    const blob = await res.blob()
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ])
    ElMessage.success({
      message: '✅ 图片已复制，请到微信电脑版按 Ctrl+V 粘贴发送',
      duration: 5000
    })
  } catch (e) {
    console.error('复制图片失败:', e)
    ElMessage.error('复制图片失败，请尝试保存后再分享')
  }
}

const downloadShareImage = () => {
  if (!shareImageData.value) return
  const link = document.createElement('a')
  const storeName = (currentDetail.value?.store_name || '数据').replace(/[/\\:]/g, '_')
  link.download = storeName + '_联通人口数据.png'
  link.href = shareImageData.value
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// ====== 纯 Canvas 绘制地图截图（替代 Leaflet + html2canvas） ======

// 经纬度 → 瓦片坐标（与 Leaflet/OSM 一致）
// 包装函数（兼容旧调用方式）
const captureHiddenMap = async () => {
  if (!lastMapParams.value) {
    console.warn('[导出截图] 无渲染参数')
    return null
  }
  const { centerLat, centerLng, radius, competitors } = lastMapParams.value
  return captureMapToCanvas(centerLat, centerLng, radius, competitors, 14)
}

// 挂载到全局，供其他组件（如门店联通人口结果框导出）复用截图能力
window.__captureMapToCanvas = captureMapToCanvas
window.__captureMapOnlyCanvas = captureMapOnlyCanvas
window.__captureShoppingCenterMap = captureShoppingCenterMap

// 导出Excel（含竞品地图截图）
const handleExportExcel = async () => {
  if (!currentDetail.value) {
    ElMessage.info('暂无数据可导出')
    return
  }
  try {
    ElMessage.info('正在生成Excel报表，请稍候...')
    const id = currentDetail.value.id

    // 1. 获取竞品和购物中心数据
    let competitorScreenshot = null
    let shoppingCenterScreenshot = null
    let mapScreenshot = null
    let centerLat = null
    let centerLng = null

    try {
      // 并发请求两个API
      const [compResp, shopResp] = await Promise.all([
        axios.get(`/api/purchase/${id}/competitors-for-map`),
        axios.get(`/api/purchase/${id}/shopping-centers-for-map`)
      ])
      const mapData = compResp.data
      const shopData = shopResp.data
      centerLat = mapData.center.lat
      centerLng = mapData.center.lng

      // 缓存竞品渲染参数
      lastMapParams.value = {
        centerLat, centerLng,
        radius: mapData.radius,
        competitors: mapData.competitors
      }

      // 渲染竞品地图截图
      if (mapData.competitors && mapData.competitors.length > 0) {
        competitorScreenshot = await captureMapToCanvas(centerLat, centerLng, 3000, mapData.competitors, 14)
      } else {
        competitorScreenshot = await captureMapToCanvas(centerLat, centerLng, 3000, [], 14)
      }
      console.log('✅ 竞品地图截图:', competitorScreenshot ? competitorScreenshot.length + '字节' : '失败')

      // 渲染购物中心地图截图（独立try-catch，不影响竞品）
      try {
        const centerList = (shopData.centers && Array.isArray(shopData.centers)) ? shopData.centers : []
        shoppingCenterScreenshot = await captureShoppingCenterMap(centerLat, centerLng, centerList, 14)
      } catch (scErr) {
        console.warn('购物中心截图失败:', scErr)
      }
      console.log('✅ 购物中心地图截图:', shoppingCenterScreenshot ? shoppingCenterScreenshot.length + '字节' : '无数据')

      // 渲染地图截图（仅门店位置+半径，使用购买履历的实际半径）
      try {
        const actualRadius = Array.isArray(currentDetail.value.radii) ? currentDetail.value.radii[0] : 3000
        mapScreenshot = await captureMapOnlyCanvas(centerLat, centerLng, actualRadius)
      } catch (mapErr) {
        console.warn('地图截图失败:', mapErr)
      }
      console.log('✅ 地图截图:', mapScreenshot ? mapScreenshot.length + '字节' : '无数据')
    } catch (mapErr) {
      console.warn('地图数据获取失败:', mapErr)
    }

    // 4. 调用导出API（带截图→新POST接口；回退→原GET接口）
    let response
    if (competitorScreenshot || shoppingCenterScreenshot) {
      console.log('[导出] 发送带截图的POST请求...')
      response = await axios.post(`/api/purchase/${id}/export-map-excel`, {
        competitorScreenshot,
        shoppingCenterScreenshot,
        mapScreenshot
      }, {
        responseType: 'blob'
      })
      console.log('[导出] POST请求成功')
    } else {
      console.log('[导出] 回退到普通GET导出')
      ElMessage.info('地图截图生成失败，将使用普通报表导出')
      response = await axios.get(`/api/purchase/${id}/export-excel`, {
        responseType: 'blob'
      })
    }

    // 5. 下载文件
    const disposition = response.headers['content-disposition']
    let fileName = `${currentDetail.value.store_name || '门店'}_${currentDetail.value.city_month || ''}_商圈数据.xlsx`
    if (disposition) {
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
      if (match) {
        fileName = decodeURIComponent(match[1])
      }
    }
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('Excel导出成功')
  } catch (e) {
    console.error('导出Excel失败:', e)
    ElMessage.error(e.response?.data?.message || '导出Excel失败')
  }
}
</script>

<style lang="scss" scoped>
.account-container {
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  background: #f5f7fa;
}

.account-card {
  max-width: 600px;
  margin: 0 auto 20px auto;

  .card-header {
    font-size: 18px;
    font-weight: 600;
  }
}

.account-form {
  padding: 20px 0;
}

.quota-card {
  max-width: 600px;
  margin: 0 auto;
  
  .card-header {
    font-size: 18px;
    font-weight: 600;
  }
}

.quota-content {
  padding: 10px 0;
}

.quota-item {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 16px;
  padding: 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  color: white;
}

.quota-label {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
}

.quota-value {
  font-size: 48px;
  font-weight: bold;
  
  &.available {
    color: #fff;
  }
}

.quota-unit {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.9);
}

.quota-info {
  margin-bottom: 16px;

  p {
    margin: 8px 0;
    font-size: 13px;
    color: #666;
  }
}

.quota-actions {
  display: flex;
  gap: 16px;
  align-items: center;
}

.history-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: #666;
}

.location-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.coord-icon {
  cursor: pointer;
  color: #909399;
  &:hover {
    color: #409eff;
  }
}

.quota-used {
  color: #f56c6c;
  font-weight: 600;
}

.quota-remaining {
  color: #67c23a;
  font-weight: 600;
}

.history-dialog {
  .el-dialog__body {
    padding: 16px 20px;
  }
}

.history-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 6px;
  align-items: center;

  .filter-count {
    margin-left: auto;
    color: #666;
    font-size: 13px;
  }
}

.detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: #666;
}

.detail-content {
  max-height: 60vh;
  overflow-y: auto;
}

.detail-info {
  padding: 12px;
  background: #f5f7fa;
  border-radius: 6px;
  margin-bottom: 16px;
  
  p {
    margin: 8px 0;
    font-size: 14px;
    color: #666;
  }
}

/* 商圈评分（方案A：订单信息下方横向评分卡） */
.score-section {
  margin-bottom: 16px;
  padding: 12px;
  background: #fffdf6;
  border: 1px solid #f0e6c8;
  border-radius: 8px;
}

.score-insufficient {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: #fdf0e3;
  border: 1px solid #f5d6a8;
  border-radius: 6px;
  font-size: 13px;
  color: #b07d2b;
}

/* 查询结果对比 */
.compare-chart-block {
  margin-bottom: 8px;
}

.compare-chart-box {
  width: 100%;
  height: 360px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
}

.score-grid {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.score-card {
  flex: 1;
  min-width: 100px;
  max-width: 180px;
  padding: 10px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  text-align: center;
}

.score-label {
  font-size: 13px;
  font-weight: bold;
  color: #333;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.score-stars {
  font-size: 16px;
  line-height: 1;
  margin-bottom: 6px;
  letter-spacing: 2px;
}

.star-on { color: #f7ba2a; }
.star-off { color: #e0e0e0; }

.score-value {
  font-size: 12px;
  color: #999;
}

.detail-result :deep(h4) {
  margin: 16px 0 12px 0;
  color: #333;
  font-size: 15px;
}

.result-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #eee;
  border-radius: 4px;
}

.result-label {
  color: #764ba2;
  font-weight: 600;
  font-size: 13px;
}

.result-value {
  color: #333;
  font-weight: 500;
}

.no-result {
  text-align: center;
  padding: 30px;
  color: #999;
}

.pop-group {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px dashed #eee;
}

.pop-group:last-child {
  border-bottom: none;
}

/* 表格样式 - 使用 :deep() 穿透 v-html */
.detail-result :deep(.data-table) {
  width: 100%;
  border-collapse: collapse !important;
  margin: 8px 0;
  font-size: 13px;
  border: 1px solid #ddd !important;
}

.detail-result :deep(.data-table th),
.detail-result :deep(.data-table td) {
  padding: 10px 12px;
  border: 1px solid #ddd !important;
}

.detail-result :deep(.data-table th) {
  background: #f8f5fa;
  color: #764ba2;
  font-weight: 600;
}

.detail-result :deep(.data-table td) {
  background: #fff;
  color: #333;
}

.detail-result :deep(.data-table tr:hover td) {
  background: #f9f9ff;
}

.detail-result :deep(.data-table td.num) {
  text-align: right;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* 横向对比表格样式 */
.detail-result :deep(.data-table.cross-table th),
.detail-result :deep(.data-table.cross-table td) {
  text-align: center;
  padding: 10px 16px;
  min-width: 80px;
}

/* 指标名称列右对齐 */
.detail-result :deep(.data-table.cross-table th:first-child),
.detail-result :deep(.data-table.cross-table td:first-child) {
  text-align: right;
  font-weight: 600;
  color: #764ba2;
  min-width: 180px;
}

/* 到访/居住/工作数据列宽度加大 */
.detail-result :deep(.data-table.cross-table th:not(:first-child)),
.detail-result :deep(.data-table.cross-table td:not(:first-child)) {
  min-width: 100px;
}

.detail-result :deep(.data-table.cross-table th) {
  background: linear-gradient(180deg, #f8f5fa, #f0e8f5);
}

.detail-result :deep(.data-table.cross-table .total-row td) {
  background: #f8f5fa;
  font-weight: 600;
  border-top: 2px solid #ddd;
}

/* 单列值样式（合并单元格） */
.detail-result :deep(.data-table td.single-value) {
  text-align: center !important;
  background: linear-gradient(90deg, #f8f5fa, #fff, #f8f5fa);
  font-weight: 600;
  color: #764ba2;
}

.detail-result :deep(.data-table tr.total-row td) {
  background: linear-gradient(90deg, #f8f0ff, #fff, #f8f0ff);
  font-weight: 600;
  color: #764ba2;
}

.group-header {
  font-weight: 600;
  color: #764ba2;
  margin-bottom: 8px;
  padding: 4px 8px;
  background: linear-gradient(90deg, #f8f0ff, #fff);
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
}

.group-total {
  color: #333;
  font-size: 14px;
}

/* 资产预测各部分背景色 */
.asset-section {
  margin-bottom: 12px;
  padding: 8px;
  border-radius: 6px;
}

.asset-section .data-table {
  margin-bottom: 0;
}

.asset-section .group-header {
  margin-bottom: 8px;
}

/* 收入预测 - 蓝色调 */
.asset-income {
  background: linear-gradient(135deg, #e6f3ff 0%, #b3d9ff 100%);
  border: 1px solid #8bc8ff;
}

/* 有车预测 - 浅绿色调 */
.asset-car {
  background: linear-gradient(135deg, #e6ffe6 0%, #b3ffb3 100%);
  border: 1px solid #8cff8c;
}

/* 有房预测 - 浅黄色调 */
.asset-house {
  background: linear-gradient(135deg, #fffbe6 0%, #fff3b3 100%);
  border: 1px solid #ffd966;
}

/* 资产表格表头颜色调整 */
.asset-section :deep(.data-table th) {
  background: rgba(255, 255, 255, 0.6);
}

/* ====== 图表双栏布局 ====== */

.detail-dialog {
  .el-dialog__header {
    padding-bottom: 8px;
  }
  .el-dialog__body {
    padding: 12px 20px;
  }
}

.dialog-header-flex {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding-right: 10px;
}

.dialog-header-actions {
  display: flex;
  gap: 8px;
}

/* 数据洞察按钮 - 珊瑚粉 */
.btn-insight {
  --el-button-bg-color: #f08080;
  --el-button-border-color: #f08080;
  --el-button-hover-bg-color: #e06060;
  --el-button-hover-border-color: #e06060;
  --el-button-active-bg-color: #d05050;
  --el-button-active-border-color: #d05050;
}

/* 数据洞察样式 */
.insight-section {
  margin-bottom: 16px;
  padding: 12px;
  background: #f9f8ff;
  border: 1px solid #e8e0f0;
  border-radius: 8px;
}

.insight-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}
.insight-item:last-child { margin-bottom: 0; }

.insight-positive {
  background: #f0f9eb;
  border-left: 3px solid #67c23a;
}
.insight-warning {
  background: #fef0f0;
  border-left: 3px solid #f56c6c;
}
.insight-info {
  background: #ecf5ff;
  border-left: 3px solid #409eff;
}

.insight-icon { flex-shrink: 0; font-size: 15px; }
.insight-text { color: #333; }

.detail-horizontal-layout {
  display: flex;
  gap: 20px;
  min-height: 400px;
}

.detail-left {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}
.detail-right {
  width: 520px;
  flex-shrink: 0;
  border-left: 1px solid #ebeef5;
  padding-left: 20px;
}

.chart-card {
  margin-bottom: 16px;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
  transition: box-shadow 0.2s;
  &:hover {
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
}

.chart-title {
  margin: 0 0 8px;
  font-size: 13px;
  color: #606266;
  font-weight: 600;
}

.chart-box {
  width: 100%;
  height: 280px;
}

@media (max-width: 1100px) {
  .detail-horizontal-layout {
    flex-direction: column;
  }
  .detail-right {
    width: 100%;
    border-left: none;
    padding-left: 0;
  }
}

/* ====== 微信分享弹窗 ====== */
.share-dialog {
  :deep(.el-dialog__body) {
    max-height: 70vh;
    overflow-y: auto;
  }
}
.share-preview {
  padding: 0;
  text-align: center;
}
.share-hint {
  text-align: center;
  color: #999;
  font-size: 13px;
  margin: 12px 0 0;
}
.share-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-bottom: 8px;
}
.share-tip {
  text-align: center;
  color: #bbb;
  font-size: 11px;
  margin: 0;
}
</style>
