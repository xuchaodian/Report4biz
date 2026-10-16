<template>
  <div class="users-view">
    <!-- v0.9 P0-B：顶部 TAB —— 用户列表 / 集团·子公司绑定（本页路由 requiresAdmin，仅平台管理员可达）
         注意：下方「用户列表」为原有内容，为保持 review diff 最小**未重排缩进**，勿按 TAB 层级重新缩进。 -->
    <el-tabs v-model="activeTab" class="users-tabs">
      <el-tab-pane label="用户列表" name="users">
    <div class="users-header">
      <h2>用户管理</h2>
      <div class="header-actions">
        <!-- 配额信息卡片 -->
        <div class="quota-cards">
          <div class="quota-card total">
            <el-tooltip content="从联通采购的累计总次数（含历史采购），不是本次/本批采购量" placement="top">
              <span class="label">累计总配额</span>
            </el-tooltip>
            <span class="value">{{ quotaInfo.initialQuota }}</span>
            <el-button type="primary" link size="small" @click="showQuotaDialog" title="编辑累计总配额" aria-label="编辑累计总配额">
              <el-icon><Edit /></el-icon>
            </el-button>
            <el-tooltip content="查看历次向联通采购的明细" placement="top">
              <el-button type="primary" link size="small" class="purchase-link" @click="showPurchaseDialog">采购履历</el-button>
            </el-tooltip>
          </div>
          <div class="quota-card remaining">
            <span class="label">当前剩余配额</span>
            <span class="value">{{ quotaInfo.remainingQuota }}</span>
          </div>
          <div class="quota-card api">
            <span class="label">API开放页已占</span>
            <span class="value">{{ quotaInfo.apiAllocatedQuota }}</span>
          </div>
          <div class="quota-card pool">
            <span class="label">全池剩余可分配</span>
            <span class="value">{{ quotaInfo.poolAvailableQuota }}</span>
          </div>
          <div class="quota-card consumed">
            <span class="label">消费总次数</span>
            <span class="value">{{ totalConsumed }}</span>
          </div>
        </div>
        <el-button type="info" @click="showMonthlyStatsDialog">
          <AppIcon class="icon-text"><DataAnalysis /></AppIcon>月度统计
        </el-button>
        <el-button type="info" plain @click="showOverviewDialog">
          <AppIcon class="icon-text"><Odometer /></AppIcon>配额总览
        </el-button>
        <!-- 公司筛选：下拉可浏览现有公司，也可直接输入关键词做模糊匹配
             （后端 GET /users 的 company 参数本就是 LIKE '%关键词%'，
              故输入「泉盛」可一次筛出全部泉盛系公司 —— 勿改成精确匹配） -->
        <el-select
          v-model="filterCompany"
          placeholder="按公司筛选（可输入关键词，如：泉盛）"
          aria-label="按公司筛选"
          clearable
          filterable
          allow-create
          :reserve-keyword="false"
          style="width: 260px; margin-right: 12px"
          @change="handleFilterChange"
        >
          <el-option
            v-for="company in companyList"
            :key="company"
            :label="company"
            :value="company"
          />
        </el-select>
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>添加用户
        </el-button>
      </div>
    </div>

    <!-- v1.13.205：VIP 试用申请待处理提示条（管理端）—— 与右上角个人下拉里的入口红点同一数据源
         ★ v1.13.210：入口改为**常驻**。旧版整条写 `v-if="vipPendingCount > 0"`，
           而「去审核」按钮是打开审核弹窗的**全局唯一入口**（openVipReview 仅此一处被调用）
           ⇒ pending=0 时整条消失 ⇒ 历史申请单在 UI 上**永久不可达**（2026-10-12 真机取证）。
           现拆两支：有待处理＝原橙色提示条；无待处理＝低饱和常驻入口，仍可查历史记录。 -->
    <div v-if="vipPendingCount > 0" class="vip-pending-bar" role="status">
      <el-icon class="vip-pending-icon"><BellFilled /></el-icon>
      <span>有 <b>{{ vipPendingCount }}</b> 条 VIP 试用申请待处理</span>
      <el-button type="warning" size="small" @click="openVipReview">去审核</el-button>
    </div>
    <div v-else class="vip-pending-bar vip-pending-bar--quiet">
      <el-icon class="vip-pending-icon"><Document /></el-icon>
      <span>VIP 试用申请记录</span>
      <el-button size="small" plain @click="openVipReview">查看记录</el-button>
    </div>

    <!-- v1.13.218：配额采购申请待处理提示条（管理端）—— 与 VIP 条**同样是两支常驻**。
         🔴 210 教训：整条写 `v-if="quotaPendingCount > 0"` 会让「去受理」成为**全局唯一入口**
           却在无待办时彻底消失 ⇒ 历史采购申请单在 UI 上永久不可达。 -->
    <div v-if="quotaPendingCount > 0" class="vip-pending-bar quota-pending-bar" role="status">
      <el-icon class="vip-pending-icon"><ShoppingCart /></el-icon>
      <span>有 <b>{{ quotaPendingCount }}</b> 条配额采购申请待处理</span>
      <el-button type="warning" size="small" @click="openQuotaReview">去受理</el-button>
    </div>
    <div v-else class="vip-pending-bar vip-pending-bar--quiet">
      <el-icon class="vip-pending-icon"><Document /></el-icon>
      <span>配额采购申请记录</span>
      <el-button size="small" plain @click="openQuotaReview">查看记录</el-button>
    </div>

    <!-- 用户表格 -->
    <div class="users-table">
      <div class="table-title">用户列表</div>
      <el-table
        :data="users"
        v-loading="loading"
        border
        stripe
        style="width: 100%"
      >
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="username" label="用户名" min-width="140">
          <template #default="{ row }">
            <!-- 👑 纯装饰：「角色」列已有 el-tag「VIP用户」表达同一语义 ⇒ 读屏忽略，避免念两遍 -->
            <span v-if="row.role === 'vip'" aria-hidden="true">👑 </span>
            <!-- v1.13.216：停用行回显**原用户名**（库内已改写为 __disabled_<id> 以便释放同名
                 供重新注册）；裸行（有 disabled_at 却无 prev 记录）退回显示当前值，不掩盖事实 -->
            <span v-if="row.disabled_at">{{ row.disabled_prev_username || row.username }}</span>
            <span v-else>{{ row.username }}</span>
            <el-tag v-if="row.disabled_at" type="info" size="small" style="margin-left: 6px;">已停用</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱" min-width="200">
          <template #default="{ row }">
            <!-- v1.13.216：停用行的邮箱已被改写为 __disabled_<id>@disabled.invalid（为释放原邮箱
                 供重新注册）⇒ 展示**原邮箱**；裸行退回显示当前值 -->
            <span>{{ row.disabled_at ? (row.disabled_prev_email || row.email) : row.email }}</span>
          </template>
        </el-table-column>
        <!-- 公司列：可点表头按拼音升/降序（同一前缀的公司会相邻，如「泉盛」系）；
             空公司名固定排最后（默认码位排序会把空值顶到最前，故用 sort-method 兜住） -->
        <el-table-column prop="company" label="公司" min-width="150" sortable :sort-method="sortByCompany" />
        <el-table-column prop="role" label="角色" width="100" align="center">
          <template #default="{ row }">
            <!-- v1.13.212：VIP 家族配色统一到金 —— trial 也纳入 .vip-role-tag（原为 el-tag primary 蓝） -->
            <el-tag :type="row.role === 'admin' ? 'danger' : row.role === 'vip' ? undefined : row.role === 'trial' ? 'primary' : 'info'" :class="{ 'vip-role-tag': row.role === 'vip' || row.role === 'trial' }">
              {{ row.role === 'admin' ? '管理员' : row.role === 'vip' ? 'VIP用户' : row.role === 'trial' ? 'VIP试用' : '普通用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="usedQuota" label="消费次数" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="warning">{{ row.usedQuota ?? 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remainingQuota" label="剩余次数" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="info">{{ row.remainingQuota ?? 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="cumulativeTotal" label="累计配额" width="100" align="center">
          <template #header>
            <el-tooltip content="该账号累计被分配的配额（净购买：分配 +，退款 −），与个人中心「累计配额」同口径" placement="top">
              <span class="th-help">累计配额</span>
            </el-tooltip>
          </template>
          <template #default="{ row }">
            <el-tag effect="plain">{{ row.cumulativeTotal ?? 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="cumulativeUsed" label="累计使用" width="100" align="center">
          <template #header>
            <el-tooltip content="该账号累计消耗的次数（含已删除的历史记录），与个人中心「累计使用」同口径" placement="top">
              <span class="th-help">累计使用</span>
            </el-tooltip>
          </template>
          <template #default="{ row }">
            <el-tag type="warning" effect="plain">{{ row.cumulativeUsed ?? 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="注册时间" width="110">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column prop="vip_until" label="VIP到期日" width="110" align="center">
          <template #default="{ row }">
            <template v-if="row.role === 'vip' || row.role === 'trial'">
              <span v-if="row.vip_until" :class="{ 'vip-expiring': isVipExpiring(row), 'vip-expired': isVipExpired(row) }">
                {{ isVipExpiring(row) ? '⏰ ' : isVipExpired(row) ? '❌ ' : '' }}{{ formatDate(row.vip_until) }}
              </span>
              <!-- v1.13.158：vip_until 为空 = 不过期（与后端 ai.js 的 VIP 门禁判定一致），不再显示「—」 -->
              <span v-else style="color: #909399;">长期有效</span>
            </template>
            <span v-else style="color: #c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <!-- v1.13.216：已停用账号**只给「恢复」** —— 停用期间用户名/邮箱已被改写为占位值，
                 编辑它们没有意义（恢复时会整体还原）；密码也不该重置（人都进不来）。
                 这同时避免了"改名后恢复失败"这一类歧义状态。 -->
            <template v-if="row.disabled_at">
              <el-button
                type="success"
                link
                title="恢复该账号（还原原用户名/邮箱，恢复后可重新登录）"
                aria-label="恢复该用户"
                @click="handleRestore(row)"
              >
                <el-icon><RefreshLeft /></el-icon>
              </el-button>
            </template>
            <template v-else>
              <!-- v1.13.177 A 档：操作列三个图标按钮此前零可访问名 -->
              <el-button type="primary" link @click="handleEdit(row)" title="编辑" aria-label="编辑该用户">
                <el-icon><Edit /></el-icon>
              </el-button>
              <el-button type="warning" link @click="handleResetPassword(row)" title="重置密码" aria-label="重置该用户密码">
                <el-icon><RefreshRight /></el-icon>
              </el-button>
              <!-- v1.13.216：「删除」改为「停用」。停用是可逆冻结：不动任何数据 ⇒ 不再产生孤儿行
                   （本批起因就是生产库 1253 行孤儿）。⛔ UI 刻意**不暴露「彻底删除」**：
                   DELETE 尚无级联（S3 批次），暴露它等于继续制造孤儿。 -->
              <el-button
                type="danger"
                link
                :disabled="row.id === currentUserId || isLastAdminRow(row)"
                :title="disableDisabledReason(row) || '停用'"
                aria-label="停用该用户"
                @click="handleDisable(row)"
              >
                <el-icon><CircleClose /></el-icon>
              </el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </div>
      </el-tab-pane>

      <!-- 集团 / 子公司绑定（v0.9 P0-B） -->
      <el-tab-pane label="集团 / 子公司" name="orgs" lazy>
        <OrgBindingPanel v-if="activeTab === 'orgs'" />
      </el-tab-pane>
    </el-tabs>

    <!-- 添加/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑用户' : '添加用户'"
      width="500px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" :disabled="isEdit" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="请输入邮箱" />
        </el-form-item>
        <el-form-item label="公司" prop="company">
          <el-input v-model="form.company" placeholder="请输入公司名称" />
        </el-form-item>
        <el-form-item v-if="!isEdit" label="密码" prop="password">
          <el-input v-model="form.password" :type="pwdShow.password ? 'text' : 'password'" placeholder="请输入密码">
            <template #suffix>
              <button
                type="button"
                class="pwd-toggle"
                :aria-label="pwdShow.password ? $t('common.hidePassword') : $t('common.showPassword')"
                :aria-pressed="pwdShow.password"
                :title="pwdShow.password ? $t('common.hidePassword') : $t('common.showPassword')"
                @click="pwdShow.password = !pwdShow.password"
              >
                <el-icon><View v-if="!pwdShow.password" /><Hide v-else /></el-icon>
              </button>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" placeholder="请选择角色" style="width: 100%">
            <el-option label="普通用户" value="user" :disabled="isLastAdminTarget" />
            <el-option label="VIP试用" value="trial" :disabled="isLastAdminTarget" />
            <el-option label="VIP用户" value="vip" :disabled="isLastAdminTarget" />
            <el-option label="管理员" value="admin" />
          </el-select>
          <!-- v1.13.202：「最后一个管理员」保护（前端侧；后端 PUT /users/:id 才是权威）。
               缘由：requireAdmin 判的是 JWT 载荷（req.user = decoded，读 token 不读库）⇒ 把唯一
               管理员改成非 admin 后当前会话仍可用，但下次登录即 403 ⇒ 永久失去后台入口。 -->
          <div v-if="isLastAdminTarget" class="quota-tip" style="color: #e6a23c;">
            该账号是系统唯一的管理员，不能改为其他角色（否则下次登录将无法再进入后台）。如需降级，请先新建一个管理员。
          </div>
        </el-form-item>
        <el-form-item v-if="form.role === 'vip' || form.role === 'trial'" label="VIP到期">
          <div style="width: 100%;">
            <div class="quota-tip" style="color: #e6a23c;">{{ form.role === 'trial' ? 'VIP 试用自保存之日起 30 天，到期后自动恢复为普通用户' : '自保存之日起自动续期 1 年（管理员未将其改为普通用户则持续有效）' }}</div>
            <div v-if="form.vipUntilText" style="font-size: 12px; color: #909399; margin-top: 4px;">当前 VIP 到期：{{ form.vipUntilText }}</div>
          </div>
        </el-form-item>
        <el-form-item v-if="isEdit" label="剩余次数">
          <el-input-number v-model="form.remaining" :min="0" :max="9999" placeholder="输入用户新的剩余次数" style="width: 100%" />
          <div class="quota-tip">
            <div>当前剩余次数: {{ form.remaining }}</div>
            <div>已使用次数: {{ form.usedQuota }}</div>
            <div>系统剩余可分配(全池): {{ quotaInfo.poolAvailableQuota }} <span style="color:#909399;">（已扣除 API 开放页占用 {{ quotaInfo.apiAllocatedQuota }} 次）</span></div>
            <div style="color: #67c23a; margin-top: 4px;">输入新的剩余次数，系统将自动换算为配额总数</div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>

    <!-- 编辑总配额对话框 -->
    <el-dialog v-model="quotaDialogVisible" title="设置累计总配额" width="460px">
      <el-form>
        <el-form-item label="累计总配额">
          <el-input-number v-model="editTotalQuota" :min="0" :max="999999" style="width: 100%" />
          <div class="quota-tip">从联通公司采购的<b>累计</b>总次数（含历史采购）。本次若新买了 N 次，请填「原值 + N」</div>
        </el-form-item>
        <div class="quota-preview" :class="previewDeltaState">
          <div class="qp-row">
            <span class="qp-label">保存后「当前剩余配额」</span>
            <span class="qp-value">{{ previewRemaining }}</span>
            <span class="qp-delta">{{ previewDeltaText }}</span>
          </div>
          <div class="qp-hint">{{ previewHint }}</div>
        </div>
        <el-form-item label="采购备注" v-if="previewDelta > 0" style="margin-top: 14px;">
          <el-input v-model="purchaseNote" maxlength="60" show-word-limit placeholder="选填，如「第 2 批 · 2400 次 · 单价 xx 元」" />
          <div class="quota-tip">本次将记入「采购履历」，便于日后对账</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quotaDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="quotaSaving" @click="handleSaveQuota">确定</el-button>
      </template>
    </el-dialog>

    <!-- 配额采购履历对话框（v1.13.115） -->
    <el-dialog v-model="purchaseDialogVisible" title="配额采购履历" width="760px">
      <div class="purchase-summary" v-if="purchaseSummary">
        <div class="ps-item">
          <span class="ps-label">累计总配额</span>
          <span class="ps-value">{{ purchaseSummary.initialQuota }}</span>
        </div>
        <div class="ps-item">
          <span class="ps-label">已记录采购</span>
          <span class="ps-value">{{ purchaseSummary.totalAmount }}</span>
        </div>
        <div class="ps-item">
          <span class="ps-label">采购笔数</span>
          <span class="ps-value">{{ purchaseSummary.count }}</span>
        </div>
        <div class="ps-item baseline" v-if="purchaseSummary.baselineAmount > 0">
          <el-tooltip content="累计总配额中，早于「采购履历」功能上线、无明细记录的部分" placement="top">
            <span class="ps-label">上线前已有</span>
          </el-tooltip>
          <span class="ps-value">{{ purchaseSummary.baselineAmount }}</span>
        </div>
      </div>

      <div class="purchase-table-wrap" v-loading="purchaseLoading">
        <el-table v-if="purchaseRows.length > 0" :data="purchaseRows" size="small" max-height="380" border>
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column prop="created_at" label="时间" width="160" />
          <el-table-column prop="amount" label="本次采购" width="110" align="center">
            <template #default="{ row }">
              <el-tag type="success">+{{ row.amount }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="剩余变化" width="150" align="center">
            <template #default="{ row }">
              <span class="qrange">{{ row.quota_before }}</span>
              <span class="qarrow">→</span>
              <span class="qrange after">{{ row.quota_after }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="note" label="备注" min-width="140">
            <template #default="{ row }">
              <span v-if="row.note">{{ row.note }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column prop="created_by_name" label="操作人" width="110" align="center">
            <template #default="{ row }">
              {{ row.created_by_name || '—' }}
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else :description="purchaseLoading ? '加载中…' : '暂无采购记录（功能上线前的采购无明细）'" style="margin: 24px 0" />
      </div>

      <template #footer>
        <el-button @click="purchaseDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 月度使用统计对话框 -->
    <el-dialog v-model="monthlyStatsDialogVisible" width="800px" class="dialog-fancy">
      <template #header>
        <div class="dialog-header-fancy">
          <span class="dhf-icon" style="background:#e6f1fb;color:#0d579c;"><AppIcon><DataAnalysis /></AppIcon></span>
          <div>
            <div class="dhf-title">月度使用统计</div>
            <div class="dhf-sub">用户月度 token 与配额使用</div>
          </div>
        </div>
      </template>
      <div class="stats-filters">
        <el-date-picker
          v-model="statsMonth"
          type="month"
          placeholder="选择月份"
          format="YYYY-MM"
          value-format="YYYY-MM"
          style="width: 140px; margin-right: 12px"
        />
        <el-select
          v-model="statsCompany"
          placeholder="选择公司"
          clearable
          filterable
          style="width: 180px; margin-right: 12px"
        >
          <el-option
            v-for="company in companyList"
            :key="company"
            :label="company"
            :value="company"
          />
        </el-select>
        <el-button type="primary" @click="fetchMonthlyStats" :loading="statsLoading">
          查询
        </el-button>
      </div>
      <div class="stats-summary" v-if="monthlyStats.length > 0" style="margin-top: 16px">
        <div class="summary-item">
          <span class="label">用户总数：</span>
          <span class="value">{{ statsSummary.totalUsers }}</span>
        </div>
        <div class="summary-item highlight">
          <span class="label">当月使用总次数：</span>
          <span class="value">{{ statsSummary.totalMonthlyUsed }}</span>
        </div>
      </div>
      <el-table
        v-if="monthlyStats.length > 0"
        :data="monthlyStats"
        v-loading="statsLoading"
        border
        stripe
        style="width: 100%; margin-top: 16px"
      >
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="company" label="公司" min-width="150" />
        <el-table-column prop="total_quota" label="已分配次数" width="110" align="center">
          <template #default="{ row }">
            {{ row.total_quota ?? 0 }}
          </template>
        </el-table-column>
        <el-table-column prop="monthly_used" label="当月使用次数" width="120" align="center">
          <template #default="{ row }">
            <el-tag type="warning">{{ row.monthly_used ?? 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="monthly_remaining" label="当月剩余次数" width="120" align="center">
          <template #default="{ row }">
            <el-tag type="info">{{ row.monthly_remaining ?? 0 }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="!statsLoading" description="请选择月份后点击查询" style="margin: 40px 0" />
    </el-dialog>

    <!-- 配额总览（跨组织 · 仅平台管理员）—— v0.11 P1.5 F4 -->
    <el-drawer v-model="overviewVisible" title="配额总览（全平台）" size="760px" append-to-body>
      <div v-loading="overviewLoading" class="ov-wrap">
        <template v-if="overview">
          <div class="ov-cards">
            <div class="ov-card">
              <span class="ov-label">上游总配额</span>
              <b class="ov-num">{{ overview.pool.poolTotal }}</b>
            </div>
            <div class="ov-card">
              <span class="ov-label">当前剩余</span>
              <b class="ov-num">{{ overview.pool.remaining }}</b>
            </div>
            <div class="ov-card ov-hl">
              <span class="ov-label">已分配未消耗</span>
              <b class="ov-num">{{ overview.pool.unconsumedTotal }}</b>
            </div>
            <div class="ov-card">
              <span class="ov-label">全池剩余可分配</span>
              <b class="ov-num">{{ overview.pool.allocatable }}</b>
            </div>
          </div>
          <div class="ov-note">
            ⓘ「当前剩余」= 与联通结算的真实余额，<b>不因分配而变化</b>；「已占用」= 用户页已分配
            {{ overview.pool.allocatedUsers }} + API开放页已占 {{ overview.pool.allocatedApi }} = {{ overview.pool.occupied }}。
          </div>

          <el-table
            :data="overviewRows"
            row-key="rowKey"
            :tree-props="{ children: 'children' }"
            default-expand-all
            size="small"
            border
            style="width: 100%; margin-top: 12px;"
          >
            <el-table-column prop="label" label="组织 / 账号" min-width="210">
              <template #default="{ row }">
                <span :class="{ 'ov-org': row.level === 0, 'ov-member': row.level === 1 }">{{ row.label }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="quota" label="已分配" width="82" align="right" />
            <el-table-column prop="used" label="已消耗" width="82" align="right" />
            <el-table-column prop="unconsumed" label="未消耗" width="82" align="right" />
            <el-table-column label="台账分配" width="118" align="right">
              <template #default="{ row }">
                <span v-if="row.level === 0">{{ row.grantedTotal }}</span>
                <span v-else>
                  <el-tooltip content="一级分配（池 → 成员）" placement="top">
                    <span class="ov-g-pool">{{ row.grantedPool }}</span>
                  </el-tooltip>
                  <span class="ov-g-sep">/</span>
                  <el-tooltip content="二级再分配（成员 → 成员）" placement="top">
                    <span class="ov-g-move">{{ row.grantedMove }}</span>
                  </el-tooltip>
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="lastGrantAt" label="最近分配" width="140" />
          </el-table>

          <div class="ov-reconcile" :class="overview.reconcile.ok ? 'ov-ok' : 'ov-bad'">
            恒等式自检：已分配 {{ overview.reconcile.allocatedUsers }} = Σ组织 {{ overview.reconcile.sumOrgQuota }}
            + 平台直配 {{ overview.reconcile.directAllocated }}
            <span v-if="overview.reconcile.ok">✅ 通过</span>
            <span v-else>❌ 差额 {{ overview.reconcile.diff }}（数据异常，需排查）</span>
          </div>
          <div class="ov-tip">
            ⓘ 本页<b>只读</b>：不提供「调低 / 收回」入口（避免绕过「只增不减」铁律）。
            真需兜底请走「用户列表 → 编辑 → 累计总配额」（有独立审计）。
          </div>
        </template>
        <el-empty v-else-if="!overviewLoading" description="暂无数据" style="margin: 60px 0" />
      </div>
    </el-drawer>

    <!-- v1.13.205：VIP 试用申请审核（管理员）—— 通过 ⇒ 该账号变为 30 天 VIP 试用 -->
    <el-dialog
      v-model="vipReviewVisible"
      title="VIP 试用申请审核"
      width="94%"
      style="max-width:1280px"
      top="5vh"
      draggable
      class="vip-review-dialog"
    >
      <div class="vip-review-toolbar">
        <el-radio-group v-model="vipReviewStatus" size="small" @change="fetchVipApplications">
          <el-radio-button :value="'pending'">待处理</el-radio-button>
          <el-radio-button :value="'approved'">已通过</el-radio-button>
          <el-radio-button :value="'rejected'">已驳回</el-radio-button>
          <el-radio-button :value="'all'">全部</el-radio-button>
        </el-radio-group>
        <span class="vip-review-count">待处理 <b>{{ vipPendingCount }}</b> 条</span>
        <el-button size="small" :loading="vipReviewLoading" @click="fetchVipApplications">
          <el-icon><RefreshRight /></el-icon>刷新
        </el-button>
      </div>

      <!-- v1.13.177 既定做法：给表格区域定名供读屏跳转。
           ⛔ 不写 <caption> —— el-table 默认插槽会被 EP 渲进 display:none 的
              <div class="hidden-columns">，并不在 <table> 内，caption 完全无效 -->
      <div class="vip-review-table" role="region" :aria-label="`VIP 试用申请列表，共 ${vipApplications.length} 条`">
        <el-table :data="vipApplications" v-loading="vipReviewLoading" border size="small" row-key="id">
          <el-table-column prop="id" label="#" width="58" align="center" />
          <el-table-column label="账号" min-width="120">
            <template #default="{ row }">{{ row.current_username || row.username || '—' }}</template>
          </el-table-column>
          <el-table-column prop="company" label="公司名" min-width="170" show-overflow-tooltip />
          <el-table-column prop="department" label="所在部门" min-width="110" show-overflow-tooltip />
          <el-table-column prop="contact_name" label="联系人" width="96" />
          <el-table-column prop="contact_email" label="电子邮箱" min-width="190" show-overflow-tooltip />
          <el-table-column prop="contact_phone" label="联系电话" width="136" />
          <el-table-column label="提交时间" width="150">
            <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="当前身份" width="104" align="center">
            <template #default="{ row }">
              <!-- v1.13.212：审核弹窗的「当前角色」标签也走同一套金色（否则 vip/trial 仍显示为 EP primary 蓝） -->
              <el-tag size="small" :type="vipRoleTag(row.current_role)" :class="{ 'vip-role-tag': row.current_role === 'vip' || row.current_role === 'trial' }">{{ vipRoleLabel(row.current_role) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="96" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="vipStatusTag(row.status)">{{ vipStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="审核" min-width="190">
            <template #default="{ row }">
              <span v-if="row.status === 'pending'" class="vip-review-none">—</span>
              <template v-else>
                <div>{{ row.reviewed_by_name || '—' }} · {{ formatDateTime(row.reviewed_at) }}</div>
                <div v-if="row.review_note" class="vip-review-note">审核意见：{{ row.review_note }}</div>
              </template>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="158" fixed="right" align="center">
            <template #default="{ row }">
              <template v-if="row.status === 'pending'">
                <el-button type="success" size="small" :loading="vipReviewingId === row.id" @click="approveVipApplication(row)">
                  <el-icon><Check /></el-icon>通过
                </el-button>
                <el-button type="danger" size="small" plain :disabled="vipReviewingId === row.id" @click="rejectVipApplication(row)">
                  <el-icon><CloseBold /></el-icon>驳回
                </el-button>
              </template>
              <span v-else class="vip-review-none">已处理</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-if="!vipReviewLoading && vipApplications.length === 0" class="vip-review-empty">暂无申请记录</div>
    </el-dialog>

    <!-- v1.13.218：配额采购申请受理（管理员）—— 受理 ⇒ **仅标记已受理，不充值**（决策 3） -->
    <el-dialog
      v-model="quotaReviewVisible"
      title="配额采购申请受理"
      width="94%"
      style="max-width:1360px"
      top="5vh"
      draggable
      class="vip-review-dialog"
    >
      <div class="vip-review-toolbar">
        <el-radio-group v-model="quotaReviewStatus" size="small" @change="fetchQuotaApplications">
          <el-radio-button :value="'pending'">待处理</el-radio-button>
          <el-radio-button :value="'accepted'">已受理</el-radio-button>
          <el-radio-button :value="'rejected'">已驳回</el-radio-button>
          <el-radio-button :value="'all'">全部</el-radio-button>
        </el-radio-group>
        <span class="vip-review-count">待处理 <b>{{ quotaPendingCount }}</b> 条</span>
        <el-button size="small" :loading="quotaReviewLoading" @click="fetchQuotaApplications">
          <el-icon><RefreshRight /></el-icon>刷新
        </el-button>
      </div>

      <div class="vip-review-alert" role="note">
        <el-icon><WarningFilled /></el-icon>
        <span>受理<b>不等于</b>到账：签约/回款核对完成后，请在「用户列表」用「设置配额」为对方单独充值。</span>
      </div>

      <div class="vip-review-table" role="region" :aria-label="`配额采购申请列表，共 ${quotaRequests.length} 条`">
        <el-table :data="quotaRequests" v-loading="quotaReviewLoading" border size="small" row-key="id">
          <el-table-column prop="id" label="#" width="58" align="center" />
          <el-table-column label="账号" min-width="110">
            <template #default="{ row }">{{ row.current_username || row.username || '—' }}</template>
          </el-table-column>
          <el-table-column prop="company" label="公司名" min-width="150" show-overflow-tooltip />
          <el-table-column prop="department" label="所在部门" min-width="100" show-overflow-tooltip />
          <el-table-column prop="contact_name" label="联系人" width="90" />
          <el-table-column prop="contact_phone" label="联系电话" width="130" />
          <el-table-column prop="contact_email" label="电子邮箱" min-width="180" show-overflow-tooltip />
          <el-table-column label="采购次数" width="96" align="center">
            <template #default="{ row }"><b class="quota-want">{{ row.want_amount }}</b> 次</template>
          </el-table-column>
          <el-table-column prop="purpose" label="用途说明" min-width="140" show-overflow-tooltip />
          <el-table-column prop="expect_date" label="期望到货" width="110" align="center">
            <template #default="{ row }">{{ row.expect_date || '—' }}</template>
          </el-table-column>
          <el-table-column label="提交时间" width="140">
            <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="当前剩余" width="96" align="center">
            <template #default="{ row }">{{ row.current_quota ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="quotaStatusTag(row.status)">{{ quotaStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="受理" min-width="180">
            <template #default="{ row }">
              <span v-if="row.status === 'pending'" class="vip-review-none">—</span>
              <template v-else>
                <div>{{ row.reviewed_by_name || '—' }} · {{ formatDateTime(row.reviewed_at) }}</div>
                <div v-if="row.review_note" class="vip-review-note">受理意见：{{ row.review_note }}</div>
              </template>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="152" fixed="right" align="center">
            <template #default="{ row }">
              <template v-if="row.status === 'pending'">
                <el-button type="success" size="small" :loading="quotaReviewingId === row.id" @click="acceptQuotaRequest(row)">
                  <el-icon><Check /></el-icon>受理
                </el-button>
                <el-button type="danger" size="small" plain :disabled="quotaReviewingId === row.id" @click="rejectQuotaRequest(row)">
                  <el-icon><CloseBold /></el-icon>驳回
                </el-button>
              </template>
              <span v-else class="vip-review-none">已处理</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-if="!quotaReviewLoading && quotaRequests.length === 0" class="vip-review-empty">暂无采购申请记录</div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, CircleClose, RefreshLeft, RefreshRight, DataAnalysis, Odometer, Check, CloseBold, BellFilled, Document, ShoppingCart, WarningFilled } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import { useUserStore } from '@/stores/user'
import api from '@/utils/api'
import { formatVipUntil, isVipExpiredByRole, isVipExpiringByRole } from '@/utils/vipUntil'
import OrgBindingPanel from '@/components/org/OrgBindingPanel.vue'

const userStore = useUserStore()

// 顶部 TAB（v0.9 P0-B）：users = 用户列表（原有）/ orgs = 集团·子公司绑定
const activeTab = ref('users')

// ===== v1.13.205：VIP 试用申请审核（管理端）=====
// 普通用户在 /account 提交「体验 VIP 用户」申请 → 此处提示条 + 个人下拉入口红点 → 通过/驳回
const vipPendingCount = ref(0)
const vipReviewVisible = ref(false)
const vipReviewLoading = ref(false)
const vipReviewStatus = ref('pending')
const vipApplications = ref([])
/** 正在处理中的申请 id（防重复点击；只作用于当前行） */
const vipReviewingId = ref(null)

const users = ref([])
// v1.13.202：「最后一个管理员」保护所需 —— 库内管理员总数（来自 GET /users，**不受公司筛选影响**）。
// ⚠️ 权威校验在后端 PUT /users/:id，这里只用于禁用非 admin 选项 + 说明原因。
// 默认 0（＝不拦截）⇒ 请求异常/字段缺失时退回改动前行为，绝不误禁用。
const adminCount = ref(0)
const loading = ref(false)
const dialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const editingId = ref(null)
const originalRemaining = ref(0) // 编辑前原始剩余次数
const formRef = ref(null)
const filterCompany = ref('')

// 配额相关
const quotaInfo = ref({
  initialQuota: 0,        // 初始总配额
  remainingQuota: 0,      // 当前剩余配额（读 admin_quota.remaining_quota 列，全口径实时）
  allocatedQuota: 0,      // 已分配给用户页的额度
  availableQuota: 0,      // 仅用户页口径剩余可分配（保留字段）
  apiAllocatedQuota: 0,   // API 开放页已分配（真实模式余额合计，mock 不占池）
  poolAvailableQuota: 0   // 全池剩余可分配 = 总配额 − 用户页已分配 − API页已分配（分配校验权威）
})
// 所有用户消费次数的总和
const totalConsumed = computed(() =>
  users.value.reduce((sum, u) => sum + (u.usedQuota || 0), 0)
)
const quotaDialogVisible = ref(false)
const quotaSaving = ref(false)
const editTotalQuota = ref(0)
const purchaseNote = ref('')

// 采购履历（v1.13.115）—— 池级采购台账 quota_purchases 的只读视图
const purchaseDialogVisible = ref(false)
const purchaseLoading = ref(false)
const purchaseRows = ref([])
const purchaseSummary = ref(null)

// 弹窗实时预览：与后端 PUT /users/quota 完全同一算法（避免"前端允许提交、后端结果不符"的割裂）
//   后端 users.js：newRemaining = max(0, currentRemaining + (输入值 − currentInitial))
const previewDelta = computed(() =>
  (Number(editTotalQuota.value) || 0) - (quotaInfo.value.initialQuota || 0)
)
const previewRemaining = computed(() =>
  Math.max(0, (quotaInfo.value.remainingQuota || 0) + previewDelta.value)
)
const previewDeltaState = computed(() =>
  previewDelta.value > 0 ? 'up' : (previewDelta.value < 0 ? 'down' : 'flat')
)
const previewDeltaText = computed(() => {
  const d = previewDelta.value
  if (d > 0) return `+${d}`
  if (d < 0) return `${d}`
  return '不变'
})
const previewHint = computed(() => {
  const d = previewDelta.value
  if (d > 0) return `本次新增 ${d} 次，剩余同步 +${d}`
  if (d < 0) return `输入值小于当前累计值，保存后剩余将减少 ${Math.abs(d)} 次`
  return '输入值等于当前累计值，保存后剩余不变；若刚采购了新配额，请填「原值 + 本次采购量」'
})

// v1.13.133：新建用户弹窗的密码显隐开关状态（替代 EP 的 show-password，详见 main.scss .pwd-toggle）
const pwdShow = reactive({ password: false })

const form = reactive({
  username: '',
  email: '',
  company: '',
  password: '',
  role: 'user',
  quota: 0,
  usedQuota: 0,
  remaining: 0,
  vipUntilText: null
})


const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度为 3-20 个字符', trigger: 'blur' }
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 个字符', trigger: 'blur' }
  ],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }]
}

const currentUserId = computed(() => userStore.user?.id)

// v1.13.202：正在编辑的账号是否为「当前唯一的管理员」。
// 唯一 ⇒ 禁止改成其他角色（下拉禁用 + 提示），缘由见 adminCount 注释与后端 PUT 的同名守卫。
// ⚠️ 判据是 `=== 1`（不是 `<= 1`）：异常态退回「不拦截」＝改动前行为（后端始终是权威）。
const isLastAdminTarget = computed(() => {
  if (!isEdit.value) return false
  const target = users.value.find(u => u.id === editingId.value)
  return !!target && target.role === 'admin' && adminCount.value === 1
})

// v1.13.203 起：操作按钮的禁用判据与原因（与后端守卫同口径）。
// ① 不能删/停用自己；② 系统唯一的管理员不可删/停用 —— 后端才是权威，前端同口径禁用并**写出原因**，
//    免得用户对着灰按钮猜（此前「不能删自己」是**静默**禁用、无任何提示）。
// ⚠️ isLastAdminRow 用 `=== 1`（不是 `<= 1`）：异常态退回「不拦截」＝改动前行为，后端始终兜底。
// v1.13.216：文案由「删除」改为「停用」（按钮语义已变，判据本身与后端 PATCH /:id/status 一致）。
const isLastAdminRow = (row) => !!row && row.role === 'admin' && adminCount.value === 1

const disableDisabledReason = (row) => {
  if (!row) return ''
  if (row.id === currentUserId.value) return '不能停用自己的账号'
  if (isLastAdminRow(row)) return '该账号是系统唯一的管理员，不能停用（否则将永久失去后台入口）'
  return ''
}

// 公司列表（去重）
const companyList = computed(() => {
  const companies = users.value
    .map(u => u.company)
    .filter(c => c && c.trim())
  const set = new Set(companies)
  // 关键词模糊筛选（如输入「泉盛」）后，结果集里已不含该关键词本身，
  // 会导致 el-select 选中项回显为空 ⇒ 把当前筛选值补回选项，保证回显正常。
  // 注意：用 users 而非依赖整个列表，筛选后列表缩窄也不会把选中词冲掉。
  if (filterCompany.value && !set.has(filterCompany.value)) {
    set.add(filterCompany.value)
  }
  return [...set]
})

// 公司列排序（el-table sortable 的 sort-method）
// ① 用 localeCompare('zh-Hans-CN') 走**拼音**序（Element Plus 默认是按 UTF-16 码位排，
//    顺序与直觉不符：MKA → 北京 → 泉盛 → 波司登 → 阿里巴巴）；
//    同一前缀的公司无论哪种排法都会相邻，配拼音后整体顺序才自然。
// ② 空公司名恒排最后 —— 默认码位排序会把空字符串排到最前，顶掉有名字的公司。
const sortByCompany = (a, b) => {
  const pick = (v) => String((v && typeof v === 'object' ? v.company : v) ?? '').trim()
  const x = pick(a)
  const y = pick(b)
  if (!x && !y) return 0
  if (!x) return 1
  if (!y) return -1
  return x.localeCompare(y, 'zh-Hans-CN')
}

// 月度统计相关
const monthlyStatsDialogVisible = ref(false)
const statsMonth = ref('')
const statsCompany = ref('')
const statsLoading = ref(false)
const monthlyStats = ref([])
const statsSummary = ref({
  totalUsers: 0,
  totalMonthlyUsed: 0
})

// ---- 配额总览（跨组织 · 仅平台管理员）—— P1.5 F4 ----
const overviewVisible = ref(false)
const overviewLoading = ref(false)
const overview = ref(null)

/** 展平成 el-table 树：组织(level0) → 账号(level1)，末尾追加「平台直配」行 */
const overviewRows = computed(() => {
  if (!overview.value) return []
  const fmt = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '—')
  const rows = (overview.value.orgs || []).map(o => ({
    rowKey: `org-${o.orgId}`,
    level: 0,
    label: o.name,
    quota: o.quotaTotal,
    used: o.consumed,
    unconsumed: o.unconsumed,
    grantedTotal: o.grantedTotal,
    lastGrantAt: fmt(o.lastGrantAt),
    children: (o.members || []).map(m => ({
      rowKey: `m-${o.orgId}-${m.userId}`,
      level: 1,
      label: m.isOwner ? `🏢 ${m.name}（总部）` : `　${m.name}`,
      quota: m.quota,
      used: m.used,
      unconsumed: m.unconsumed,
      grantedTotal: m.grantedTotal,
      grantedPool: m.grantedPool,
      grantedMove: m.grantedMove,
      lastGrantAt: ''
    }))
  }))
  const d = overview.value.direct || {}
  rows.push({
    rowKey: 'direct',
    level: 0,
    label: '平台直配（非组织账号）',
    quota: d.allocated || 0,
    used: d.consumed || 0,
    unconsumed: d.unconsumed || 0,
    grantedTotal: 0,
    lastGrantAt: '—'
  })
  return rows
})

// 打开配额总览抽屉
const showOverviewDialog = async () => {
  overviewVisible.value = true
  overviewLoading.value = true
  try {
    overview.value = await api.get('/orgs/quota/overview')
  } catch (e) {
    console.error('读取跨组织配额总览失败:', e)
    ElMessage.error(e?.response?.data?.message || '读取配额总览失败')
    overview.value = null
  } finally {
    overviewLoading.value = false
  }
}

// ===== v1.13.205：VIP 试用申请（管理端）=====
const VIP_ROLE_LABEL = { admin: '管理员', vip: 'VIP用户', trial: 'VIP试用', user: '普通用户' }
const VIP_ROLE_TAG = { admin: 'danger', vip: undefined, trial: 'primary', user: 'info' }
const VIP_STATUS_LABEL = { pending: '待处理', approved: '已通过', rejected: '已驳回' }
const VIP_STATUS_TAG = { pending: 'warning', approved: 'success', rejected: 'danger' }
const vipRoleLabel = (r) => VIP_ROLE_LABEL[r] || '—'
const vipRoleTag = (r) => VIP_ROLE_TAG[r] ?? 'info'
const vipStatusLabel = (s) => VIP_STATUS_LABEL[s] || s || '—'
const vipStatusTag = (s) => VIP_STATUS_TAG[s] || 'info'

// ⚠️ 后端 created_at / reviewed_at 来自 SQLite `CURRENT_TIMESTAMP`，是 **UTC** 的
// 「YYYY-MM-DD HH:MM:SS」。直接 new Date('2026-10-12 00:57:48') 在 Safari 上是
// Invalid Date、在 Chrome 上会被当**本地时间**解析（比真实时间早 8 小时）。
// 故此处显式补 'Z' 按 UTC 解析，再由 toLocale 系列输出本地时间。
const formatDateTime = (raw) => {
  if (!raw) return '—'
  const t = String(raw).trim()
  const d = new Date(t.includes('T') ? t : t.replace(' ', 'T') + 'Z')
  if (isNaN(d.getTime())) return t.slice(0, 16)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 入口红点/提示条的数据源（轻量接口，只回一个数） */
const fetchVipPendingCount = async () => {
  try {
    const data = await api.get('/vip-applications/pending-count')
    vipPendingCount.value = Number(data?.pendingCount) || 0
  } catch (e) {
    // 红点与提示条是辅助信息，读不到就当作 0，绝不打扰管理员的正常操作
    vipPendingCount.value = 0
  }
}

const fetchVipApplications = async () => {
  vipReviewLoading.value = true
  try {
    const data = await api.get('/vip-applications', { params: { status: vipReviewStatus.value } })
    vipApplications.value = data?.applications || []
    vipPendingCount.value = Number(data?.pendingCount) || 0
  } catch (e) {
    console.error('读取 VIP 试用申请失败:', e)
    ElMessage.error(e?.response?.data?.message || '读取 VIP 试用申请失败')
    vipApplications.value = []
  } finally {
    vipReviewLoading.value = false
  }
}

/**
 * 打开「VIP 试用申请审核」弹窗 —— 全站唯一入口（提示条 / 常驻记录入口共用）。
 * ★ v1.13.210：默认页签改为「有 pending 就看 pending，没有就看全部」。
 *   ⛔ 旧版恒置 'pending' ⇒ 从常驻入口进来（此时 pending=0）只会显示「暂无申请记录」，
 *      用户依旧拿不到历史申请 —— 等于把本次要修的病灶留在弹窗里。
 */
const openVipReview = async () => {
  vipReviewStatus.value = vipPendingCount.value > 0 ? 'pending' : 'all'
  vipReviewVisible.value = true
  await fetchVipApplications()
}

// 🔴 写操作一律先二次确认（本项目铁律：生产上不点无确认的写入口）
const approveVipApplication = async (row) => {
  const name = row.current_username || row.username || `#${row.user_id}`
  try {
    await ElMessageBox.confirm(
      `确认通过「${name}」的 VIP 试用申请？通过后该账号将变为「VIP 试用」，有效期 30 天。`,
      '通过 VIP 试用申请',
      { confirmButtonText: '确认通过', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return // 取消 / 关闭
  }
  vipReviewingId.value = row.id
  try {
    const data = await api.post(`/vip-applications/${row.id}/approve`)
    ElMessage.success(data?.message || '已通过')
    // 用户列表的角色列也要跟着变 ⇒ 一并刷新
    await Promise.all([fetchVipApplications(), fetchUsers()])
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '通过申请失败')
  } finally {
    vipReviewingId.value = null
  }
}

const rejectVipApplication = async (row) => {
  const name = row.current_username || row.username || `#${row.user_id}`
  let note = ''
  try {
    const r = await ElMessageBox.prompt(
      '驳回理由会展示给申请人，便于其修改后重新申请（可留空）',
      `驳回「${name}」的 VIP 试用申请`,
      {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '驳回理由（可留空）',
        inputValidator: () => true, // 允许留空
        type: 'warning'
      }
    )
    note = r?.value || ''
  } catch (e) {
    return // 取消 / 关闭
  }
  vipReviewingId.value = row.id
  try {
    const data = await api.post(`/vip-applications/${row.id}/reject`, { review_note: note })
    ElMessage.success(data?.message || '已驳回')
    await fetchVipApplications()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '驳回申请失败')
  } finally {
    vipReviewingId.value = null
  }
}

// ===== v1.13.218：配额采购申请受理（管理端）=====
const quotaPendingCount = ref(0)
const quotaReviewVisible = ref(false)
const quotaReviewLoading = ref(false)
const quotaReviewStatus = ref('pending')
const quotaRequests = ref([])
const quotaReviewingId = ref(null)

const QUOTA_STATUS_LABEL = { pending: '待处理', accepted: '已受理', rejected: '已驳回' }
const QUOTA_STATUS_TAG = { pending: 'warning', accepted: 'success', rejected: 'danger' }
const quotaStatusLabel = (s) => QUOTA_STATUS_LABEL[s] || s || '—'
const quotaStatusTag = (s) => QUOTA_STATUS_TAG[s] || 'info'

/** 入口红点/提示条的数据源（轻量接口，只回一个数） */
const fetchQuotaPendingCount = async () => {
  try {
    const data = await api.get('/quota-requests/pending-count')
    quotaPendingCount.value = Number(data?.pendingCount) || 0
  } catch (e) {
    // 红点与提示条是辅助信息，读不到就当作 0，绝不打扰管理员正常操作
    quotaPendingCount.value = 0
  }
}

const fetchQuotaApplications = async () => {
  quotaReviewLoading.value = true
  try {
    const data = await api.get('/quota-requests', { params: { status: quotaReviewStatus.value } })
    quotaRequests.value = data?.requests || []
    quotaPendingCount.value = Number(data?.pendingCount) || 0
  } catch (e) {
    console.error('读取配额采购申请失败:', e)
    ElMessage.error(e?.response?.data?.message || '读取配额采购申请失败')
    quotaRequests.value = []
  } finally {
    quotaReviewLoading.value = false
  }
}

/**
 * 打开「配额采购申请受理」弹窗 —— 全站唯一入口（提示条 / 常驻记录入口共用）。
 * ★ 同 v1.13.210 教训：默认页签＝「有 pending 就看 pending，没有就看全部」。
 *   ⛔ 恒置 'pending' ⇒ 从常驻入口进来只会显示「暂无采购申请记录」，历史单依旧拿不到。
 */
const openQuotaReview = async () => {
  quotaReviewStatus.value = quotaPendingCount.value > 0 ? 'pending' : 'all'
  quotaReviewVisible.value = true
  await fetchQuotaApplications()
}

// 🔴 写操作一律先二次确认；确认文案必须点明「受理 ≠ 到账」（决策 3）
const acceptQuotaRequest = async (row) => {
  const name = row.current_username || row.username || `#${row.user_id}`
  try {
    await ElMessageBox.confirm(
      `确认受理「${name}」的配额采购申请（采购次数 ${row.want_amount} 次）？` +
      '受理只表示我方已接下这一单，不会自动充值到账；请在签约/回款核对完成后，' +
      '到「用户列表」用「设置配额」为其单独充值。',
      '受理配额采购申请',
      { confirmButtonText: '确认受理', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return // 取消 / 关闭
  }
  quotaReviewingId.value = row.id
  try {
    const data = await api.post(`/quota-requests/${row.id}/accept`)
    ElMessage.success(data?.message || '已受理；充值请在用户管理页单独执行')
    // 用户列表的「剩余次数」也要跟着变（若管理员随后充值）⇒ 一并刷新
    await Promise.all([fetchQuotaApplications(), fetchUsers()])
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '受理失败')
  } finally {
    quotaReviewingId.value = null
  }
}

const rejectQuotaRequest = async (row) => {
  const name = row.current_username || row.username || `#${row.user_id}`
  let note = ''
  try {
    const r = await ElMessageBox.prompt(
      '驳回理由会展示给申请人，便于其修改后重新申请（可留空）',
      `驳回「${name}」的配额采购申请`,
      {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '驳回理由（可留空）',
        inputValidator: () => true, // 允许留空
        type: 'warning'
      }
    )
    note = r?.value || ''
  } catch (e) {
    return // 取消 / 关闭
  }
  quotaReviewingId.value = row.id
  try {
    const data = await api.post(`/quota-requests/${row.id}/reject`, { review_note: note })
    ElMessage.success(data?.message || '已驳回')
    await fetchQuotaApplications()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '驳回失败')
  } finally {
    quotaReviewingId.value = null
  }
}

const handleFilterChange = () => {
  fetchUsers()
}

// 打开月度统计对话框
const showMonthlyStatsDialog = () => {
  statsMonth.value = ''
  statsCompany.value = ''
  monthlyStats.value = []
  monthlyStatsDialogVisible.value = true
}

// 获取月度统计
const fetchMonthlyStats = async () => {
  if (!statsMonth.value) {
    ElMessage.warning('请先选择月份')
    return
  }
  statsLoading.value = true
  try {
    const params = { month: statsMonth.value }
    if (statsCompany.value) {
      params.company = statsCompany.value
    }
    const data = await api.get('/users/monthly-stats', { params })
    monthlyStats.value = data.users || []
    statsSummary.value = data.summary || { totalUsers: 0, totalMonthlyUsed: 0 }
  } catch (error) {
    ElMessage.error('获取月度统计失败')
    monthlyStats.value = []
  } finally {
    statsLoading.value = false
  }
}


const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return String(dateStr).slice(0, 10)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// VIP 是否即将到期（30 天内；含 VIP 试用）
// v1.13.215：收敛到 utils/vipUntil.js 单一入口。⛔ 勿再就地实现 —— 旧版缺 !expired 守卫，
//   而 days 用 Math.ceil ⇒「到期日次日」整整一天 days 仍为 0 ⇒ 该行会同时标「⏰ 临期」与「❌ 已过期」。
const isVipExpiring = (row) => isVipExpiringByRole(row)
const isVipExpired = (row) => isVipExpiredByRole(row)

const fetchUsers = async () => {
  loading.value = true
  try {
    const params = {}
    if (filterCompany.value) {
      params.company = filterCompany.value
    }
    const data = await api.get('/users', { params })
    users.value = data.users
    // v1.13.202：库内管理员总数（不受公司筛选影响）——「最后一个管理员」保护用
    if (typeof data.adminCount === 'number') {
      adminCount.value = data.adminCount
    }
    // 更新配额信息
    if (data.quotaInfo) {
      quotaInfo.value = data.quotaInfo
    }
  } catch (error) {
    ElMessage.error('获取用户列表失败')
  } finally {
    loading.value = false
  }
}

// 显示编辑总配额对话框
const showQuotaDialog = () => {
  editTotalQuota.value = quotaInfo.value.initialQuota
  purchaseNote.value = ''
  quotaDialogVisible.value = true
}

// 保存总配额
const handleSaveQuota = async () => {
  quotaSaving.value = true
  try {
    const data = await api.put('/users/quota', {
      totalQuota: editTotalQuota.value,
      note: purchaseNote.value
    })
    quotaInfo.value = data.quotaInfo
    quotaDialogVisible.value = false
    const added = data.purchaseRecorded || 0
    ElMessage.success(added > 0 ? `总配额已更新，本次采购 ${added} 次已记入履历` : '总配额已更新')
    // 若弹窗开着，同步刷新履历列表
    if (purchaseDialogVisible.value) loadPurchases()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '更新失败')
  } finally {
    quotaSaving.value = false
  }
}

// 加载采购履历
const loadPurchases = async () => {
  purchaseLoading.value = true
  try {
    const data = await api.get('/users/quota/purchases')
    purchaseRows.value = data.purchases || []
    purchaseSummary.value = data.summary || null
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '获取采购履历失败')
    purchaseRows.value = []
    purchaseSummary.value = null
  } finally {
    purchaseLoading.value = false
  }
}

// 显示采购履历对话框
const showPurchaseDialog = () => {
  purchaseDialogVisible.value = true
  loadPurchases()
}

const showAddDialog = () => {
  isEdit.value = false
  editingId.value = null
  pwdShow.password = false   // 每次开弹窗把密码开关复位为「隐藏」
  Object.assign(form, {
    username: '',
    email: '',
    company: '',
    password: '',
    role: 'user',
    quota: 0
  })
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  editingId.value = row.id
  pwdShow.password = false   // 每次开弹窗把密码开关复位为「隐藏」
  // 显示剩余次数（admin 显示 0）
  const editRemaining = row.role === 'admin' ? 0 : (row.remainingQuota ?? 0)
  Object.assign(form, {
    username: row.username,
    email: row.email,
    company: row.company || '',
    password: '',
    role: row.role,
    quota: row.quota || 0,
    usedQuota: row.usedQuota || 0,
    remaining: editRemaining,
    vipUntilText: formatVipUntil(row.vip_until)
  })
  originalRemaining.value = editRemaining
  dialogVisible.value = true
}

const handleSave = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  if (isEdit.value) {
    const newRemaining = form.remaining || 0
    const oldRemaining = originalRemaining.value
    const diff = newRemaining - oldRemaining
    if (diff !== 0) {
      const action = diff > 0 ? '增加' : '减少'
      try {
        await ElMessageBox.confirm(
          `本次${action} ${Math.abs(diff)} 次，是否继续？`,
          '确认修改',
          { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
        )
      } catch {
        return // 用户取消
      }
    }
  }

  saving.value = true
  try {
    if (isEdit.value) {
      // 将输入"剩余次数"作为配额总数提交（usedQuota已在purchases表中独立记录，不重复计算）
      const totalQuota = (form.remaining || 0)
      const updateData = { email: form.email, role: form.role, company: form.company, quota: totalQuota }
      // VIP 到期时间由后端自动计算（设为 VIP → 自保存日起续期 1 年；改为非 VIP → 清除）
      if (form.password) {
        updateData.password = form.password
      }
      const data = await api.put(`/users/${editingId.value}`, updateData)
      // v1.13.211：后端若因「降权 / 改密」撤销了该账号的全部 token，且改的正是**自己**时，
      // 会回签一枚新 token（载荷已是新角色）⇒ 必须立刻替换本地凭据并同步自身角色，
      // 否则下一次请求即 401 被踢（自锁）。改别人时后端不返回 token，此处天然跳过。
      if (data.token) {
        userStore.applyToken(data.token)
        await userStore.fetchUser()   // GET /auth/me 读库 ⇒ 导航立刻切为普通用户视图
      }
      ElMessage.success('更新成功')
      // 更新配额信息
      if (data.quotaInfo) {
        quotaInfo.value = data.quotaInfo
      }
    } else {
      await api.post('/users', { ...form })
      ElMessage.success('添加成功')
    }
    dialogVisible.value = false
    // v1.13.211：自降权后本页已无权访问（GET /users 会 403）⇒ 不再刷新列表，
    // 免得弹出误导性的「获取用户列表失败」。isAdmin 由上面的 fetchUser 同步。
    if (userStore.isAdmin) fetchUsers()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '操作失败')
  } finally {
    saving.value = false
  }
}

// v1.13.216：原「删除」处理函数拆为「停用 / 恢复」两个可逆动作。
// ⛔ 前端**不再调用物理删除接口** —— 后端该端点现在要求「账号已停用」，
//    且**尚无级联**（S3 批次）；UI 不暴露它，避免继续制造孤儿行。
const handleDisable = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定要停用用户「${row.username}」吗？停用后该账号无法登录、已有登录状态立即失效，` +
      `且用户名与邮箱会被释放（同名可重新注册）。数据全部保留，可随时恢复。`,
      '停用账号',
      { type: 'warning', confirmButtonText: '确认停用', cancelButtonText: '取消' }
    )
    const { data } = await api.patch(`/users/${row.id}/status`, { disabled: true })
    ElMessage.success(data?.message || '已停用')
    fetchUsers()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '停用失败')
    }
  }
}

const handleRestore = async (row) => {
  const name = row.disabled_prev_username || row.username
  try {
    await ElMessageBox.confirm(
      `确定要恢复账号「${name}」吗？恢复后该账号可重新登录，用户名与原邮箱会被还原。`,
      '恢复账号',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' }
    )
    const { data } = await api.patch(`/users/${row.id}/status`, { disabled: false })
    ElMessage.success(data?.message || '已恢复')
    fetchUsers()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '恢复失败')
    }
  }
}

const handleResetPassword = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要重置用户「${row.username}」的密码吗？重置后密码为「123456」。`, '重置密码', {
      type: 'warning',
      confirmButtonText: '确定重置',
      cancelButtonText: '取消'
    })
    await api.post(`/users/${row.id}/reset-password`)
    ElMessage.success('密码已重置为 123456')
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '重置失败')
    }
  }
}

onMounted(() => {
  fetchUsers()
  // v1.13.205：待处理提示条 + 入口红点（管理员专属接口，非管理员会 403 并被静默吞掉）
  fetchVipPendingCount()
  // v1.13.218：配额采购申请的待处理条（同构，独立数据源）
  fetchQuotaPendingCount()
})
</script>

<style lang="scss" scoped>
.users-view {
  height: 100%;
  padding: 20px;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
  /* ★ 修复（v1.13.127）：本页原先缺 overflow-y:auto，而父级 .main-content 是 overflow:hidden
     ⇒ 内容一旦超出视口就被裁掉，全页无法上下滚动。
     补上后与 ShapefileView / MarketMapView / MyAccountView 等 7 个页面的根容器惯例一致。 */
  overflow-y: auto;
}

/* 顶部 TAB（v0.9 P0-B）：让「用户列表」内容区不被 TAB 头部挤压 */
.users-tabs {
  /* ★ 修复（v1.13.127）：原为 flex:1（=1 1 0%），会被压成外层可视高度，
     导致内容从被压瘪的盒子里外溢、TAB 背景与白卡片高度对不上。
     改 flex-shrink:0，让 TAB 按内容自然增高，由外层 .users-view 统一滚动。 */
  flex: 1 0 auto;
  min-height: 0;

  :deep(.el-tabs__header) {
    margin-bottom: 14px;
  }
  :deep(.el-tabs__content) {
    overflow: visible;
  }
}

.users-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;

  h2 {
    margin: 0;
    font-size: 18px;
    color: #333;
  }

  .header-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .quota-cards {
    display: flex;
    gap: 16px;
    margin-right: auto;

    .quota-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 8px;
      background: white;
      border: 1px solid #dcdfe6;

      &.total {
        border-color: #409eff;
        background: linear-gradient(135deg, #ecf5ff 0%, #f0f7ff 100%);

        .label { color: #409eff; cursor: help; border-bottom: 1px dashed currentColor; }
        .value { color: #409eff; font-weight: bold; font-size: 18px; }
      }

      &.api {
        border-color: #b37feb;
        background: linear-gradient(135deg, #f5f0ff 0%, #efe8ff 100%);

        .label { color: #8a5cd6; }
        .value { color: #8a5cd6; font-weight: bold; font-size: 18px; }
      }

      &.pool {
        border-color: #67c23a;
        background: linear-gradient(135deg, #f0f9eb 0%, #e8f5e0 100%);

        .label { color: #67c23a; }
        .value { color: #67c23a; font-weight: bold; font-size: 18px; }
      }

      &.remaining {
        border-color: #909399;
        background: linear-gradient(135deg, #f4f4f5 0%, #f9f9fa 100%);

        .label { color: #909399; }
        .value { color: #909399; font-weight: bold; font-size: 18px; }
      }

      &.consumed {
        border-color: #e6a23c;
        background: linear-gradient(135deg, #fdf6ec 0%, #fef0e0 100%);

        .label { color: #e6a23c; }
        .value { color: #e6a23c; font-weight: bold; font-size: 18px; }
      }

      .label {
        font-size: 13px;
        white-space: nowrap;
      }

      .value {
        min-width: 40px;
        text-align: center;
      }
    }
  }
}

.users-table {
  flex: 1;
  background: white;
  border-radius: 8px;
  padding: 15px;
  overflow: auto;

  .table-title {
    font-size: 15px;
    font-weight: 600;
    color: #333;
    margin-bottom: 12px;
  }
}

.stats-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.stats-summary {
  display: flex;
  gap: 24px;
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 6px;

  .summary-item {
    display: flex;
    align-items: center;
    font-size: 14px;

    .label {
      color: #606266;
    }

    .value {
      font-weight: 600;
      color: #303133;
    }

    &.highlight .value {
      color: #e6a23c;
      font-size: 16px;
    }
  }
}

.quota-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;

  b { color: #606266; }
}

/* 累计总配额弹窗：保存后的剩余配额实时预览（A+B 改动） */
.quota-preview {
  padding: 10px 12px;
  border-radius: 8px;
  background: #f4f4f5;
  border: 1px solid #dcdfe6;
  line-height: 1.5;

  .qp-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }

  .qp-label { font-size: 13px; color: #606266; }
  .qp-value { font-size: 20px; font-weight: bold; color: #303133; }
  .qp-delta { font-size: 13px; color: #909399; }
  .qp-hint { margin-top: 4px; font-size: 12px; color: #909399; }

  &.up {
    background: #f0f9eb;
    border-color: #67c23a;

    .qp-value { color: #67c23a; }
    .qp-delta { color: #529b2e; }
    .qp-hint { color: #529b2e; }
  }

  &.down {
    background: #fef0f0;
    border-color: #f56c6c;

    .qp-value { color: #f56c6c; }
    .qp-delta { color: #c45656; }
    .qp-hint { color: #c45656; }
  }

  &.flat {
    background: #fdf6ec;
    border-color: #e6a23c;

    .qp-delta { color: #e6a23c; }
    .qp-hint { color: #b88230; }
  }
}

/* VIP 到期提醒：30 天内橙、已过期红。
   v1.13.212：改用与个人中心徽章**同一口径**的达标值 —— 原 #e6a23c on #fff
   仅 2.19:1、#f56c6c on #fff 仅 2.90:1，都不过 WCAG AA(4.5:1)。
   新值 = main.scss a11y B 档给 el-tag 定的同款（#916012 5.40:1 / #b91c1c 6.47:1）。 */
.vip-expiring { color: #916012; font-weight: 600; }
.vip-expired { color: #b91c1c; font-weight: 600; }

/* VIP 家族统一金色（v1.13.212；原为紫 #7c3aed on #f3e8ff）。
   文字取深金 #8a5e00：on #fff7e6 = 5.35:1 ✅ 过 WCAG AA(4.5:1)，
   与个人中心 `.vip-badge` 同色 ⇒ 全站 VIP 家族一个颜色。
   ⛔ 勿改成 #b8860b（徽章旧色）—— on #fff7e6 仅 3.05:1 ❌，会引入对比度回归。
   ⚠️ 选择器**刻意不写** `.el-tag` 前缀：scoped 会补 `[data-v-x]` ⇒ (0,2,0)，
      恒高于 EP 的 `.el-tag`(0,1,0)。main.scss 那 6 条只改 `--el-tag-text-color`
      变量、不声明 `color`，故与此处无冲突，也不受打包顺序影响。 */
.vip-role-tag {
  background: #fff7e6;
  border-color: #f5d78e;
  color: #8a5e00;
}

/* ===== 配额采购履历（v1.13.115）===== */
.purchase-link {
  font-size: 12px !important;
  padding: 0 2px !important;
  height: auto !important;
}

/* ===== 表头可悬停提示（v1.13.116：累计配额/累计使用）===== */
.th-help {
  cursor: help;
  border-bottom: 1px dashed currentColor;
}

.purchase-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.purchase-summary .ps-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 96px;
  padding: 8px 14px;
  border-radius: 8px;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
}

.purchase-summary .ps-item.baseline {
  background: #fdf6ec;
  border-color: #f3d19e;
}

.purchase-summary .ps-label {
  font-size: 12px;
  color: #909399;
}

.purchase-summary .ps-item.baseline .ps-label {
  color: #b88230;
  cursor: help;
  border-bottom: 1px dashed currentColor;
}

.purchase-summary .ps-value {
  font-size: 18px;
  font-weight: bold;
  color: #303133;
}

.purchase-summary .ps-item.baseline .ps-value {
  color: #b88230;
}

.purchase-table-wrap {
  min-height: 120px;
}

.qrange {
  color: #909399;
}

.qrange.after {
  color: #67c23a;
  font-weight: 600;
}

.qarrow {
  margin: 0 6px;
  color: #c0c4cc;
}

.muted {
  color: #c0c4cc;
}

/* ---- 配额总览抽屉（P1.5 F4）---- */
.ov-wrap { min-height: 200px; }
.ov-cards { display: flex; gap: 12px; flex-wrap: wrap; }
.ov-card {
  flex: 1; min-width: 130px; padding: 12px 14px;
  background: #f5f7fa; border-radius: 8px;
  display: flex; flex-direction: column; gap: 4px;
}
.ov-card.ov-hl { background: #ecf5ff; border: 1px solid #d9ecff; }
.ov-label { font-size: 12px; color: #909399; }
.ov-num { font-size: 20px; color: #303133; font-weight: 600; }
.ov-hl .ov-num { color: #409eff; }
.ov-note {
  font-size: 12px; color: #606266; line-height: 1.8;
  margin-top: 10px; padding: 8px 12px;
  background: #fafafa; border-radius: 6px;
}
.ov-org { font-weight: 600; color: #303133; }
.ov-member { color: #606266; }
.ov-g-pool { color: #409eff; }
.ov-g-move { color: #e6a23c; }
.ov-g-sep { color: #c0c4cc; margin: 0 4px; }
.ov-reconcile {
  margin-top: 14px; padding: 10px 12px; border-radius: 6px;
  font-size: 12px; line-height: 1.8;
}
.ov-reconcile.ov-ok { background: #f0f9eb; color: #529b2e; border: 1px solid #e1f3d8; }
.ov-reconcile.ov-bad { background: #fef0f0; color: #f56c6c; border: 1px solid #fbc4c4; }
.ov-tip { margin-top: 10px; font-size: 12px; color: #909399; line-height: 1.8; }

/* ===== v1.13.205：VIP 试用申请（管理端）===== */
.vip-pending-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 14px;
  background: #fdf6ec;
  border: 1px solid #f5dab1;
  border-radius: 6px;
  color: #b88230;
  font-size: 13px;
}
.vip-pending-bar .vip-pending-icon { color: #e6a23c; font-size: 16px; }
.vip-pending-bar b { color: #e6a23c; font-size: 15px; }
/* margin-left:auto ⇒ 按钮靠右，与左侧文案拉开 */
.vip-pending-bar .el-button { margin-left: auto; }
/* ★ v1.13.210：无待处理时的常驻入口 —— 保持可点，但刻意低饱和，不与真正待办抢注意力 */
.vip-pending-bar--quiet {
  background: #fafafa;
  border-color: #ebeef5;
  color: #909399;
}
.vip-pending-bar--quiet .vip-pending-icon { color: #c0c4cc; }

.vip-review-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.vip-review-count { font-size: 13px; color: #909399; }
.vip-review-count b { color: #e6a23c; }
.vip-review-toolbar .el-button { margin-left: auto; }
.vip-review-table { width: 100%; }
.vip-review-none { color: #c0c4cc; font-size: 12px; }
.vip-review-note { margin-top: 2px; font-size: 12px; color: #f56c6c; line-height: 1.5; }
.vip-review-empty { padding: 24px; text-align: center; color: #909399; font-size: 13px; }

/* v1.13.218：配额采购申请条 —— 蓝色底与 VIP 橙色条区分（同一 .vip-pending-bar 骨架）。
   ⚠️ 必须各写一条覆盖规则：骨架上的无条件规则会赢过「只继承」的期望（212 教训）。 */
.quota-pending-bar { background: #ecf5ff; border-color: #b3d8ff; }
.quota-pending-bar .vip-pending-icon { color: #0d579c; }
.quota-pending-bar b { color: #0d579c; }
/* 收款提示条（弹窗内，模板直写 ⇒ teleport 不影响 scopeId，单类选择器命中） */
.vip-review-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 9px 12px;
  border-radius: 6px;
  background: #fdf6ec;
  border: 1px solid #f5dab1;
  color: #b88230;
  font-size: 12px;
  line-height: 1.6;
}
.vip-review-alert b { font-weight: 600; }
/* 弹窗内「采购次数」加粗（表格里唯一需要抢眼的数字） */
.quota-want { color: #0d579c; font-size: 14px; }
</style>
