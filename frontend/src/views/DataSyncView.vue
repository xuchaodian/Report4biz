<template>
  <div class="data-sync-view">
    <el-card shadow="never" class="ds-card">
      <template #header>
        <div class="ds-header">
          <span class="ds-title"><AppIcon class="icon-text"><Connection /></AppIcon>数据同步</span>
          <span class="ds-sub">
            集团 ↔ 子公司「按需手动同步」：先预览、后确认，每次留痕可审计。
            管辖范围由各子公司自行设置（集团亦可代设或改派），同步过来的门店为只读镜像。
          </span>
        </div>
      </template>

      <div v-if="loadingOrg" class="ds-loading">正在读取组织信息…</div>

      <el-empty
        v-else-if="!role"
        :image-size="90"
        description="当前账号不属于任何集团"
      >
        <div class="ds-empty-tip">
          数据同步用于「集团总部 ↔ 子公司」之间按管辖范围同步门店数据。<br>
          账号归属由平台管理员在「用户管理 → 集团 / 子公司」中绑定。
        </div>
      </el-empty>

      <template v-else>
        <!-- 组织信息条 -->
        <div class="ds-orgbar">
          <span class="ds-orgname">{{ orgName }}</span>
          <el-tag size="small" :type="isMember ? 'info' : 'success'" effect="plain">
            {{ isMember ? '子公司' : '集团总部' }}
          </el-tag>
          <span v-if="!isMember" class="ds-orgmeta">成员 {{ members.length }} 个</span>
          <span v-else class="ds-orgmeta">
            管辖范围 {{ scopeCities.length ? scopeCities.join(' / ') : '未设置' }}
          </span>
          <el-tooltip
            v-if="isMember && consented"
            :content="`本人确认于 ${myMember.consentedAt}（合规留痕，集团不可代签）`"
            placement="top"
          >
            <el-tag size="small" type="success" effect="plain">已知情确认</el-tag>
          </el-tooltip>
          <el-button size="small" text type="primary" style="margin-left:auto" @click="loadAll">刷新</el-button>
        </div>

        <!--
          知情确认提示条（v1.13.152，仅未确认的子公司成员可见）
          ★ 与后端闸门配套：成员未确认时 `POST /api/sync/commit` 返回 403 `consent_required`，
            但**预览不拦** —— 成员可以先看清「会同步哪些数据」再确认。
          ★ 页面内常驻而非弹窗：不打断浏览；且入口位置与管理端「用户管理 → 集团/子公司」
            那列「待确认」的提示文案指向同一处（成员本人在此页自助确认，集团不可代签）。
        -->
        <el-alert
          v-if="isMember && !consented"
          type="warning"
          :closable="false"
          show-icon
          class="ds-consent-bar"
        >
          <template #title>
            <div class="ds-consent-head">
              <span>需你本人知情确认 —— 确认后才能接收集团下发的数据</span>
              <el-button
                type="primary"
                size="small"
                :loading="consenting"
                style="margin-left:auto;"
                @click="doConsent"
              >我已了解，确认</el-button>
            </div>
          </template>
          <div class="ds-consent-body">
            <div>· 集团可查看并维护<b>你管辖范围内</b>的门店数据（按城市，范围外的行看不到）</div>
            <div>· 集团可查看你账号<b>已购买的联通人口数据（购买履历）</b>并做跨公司汇总与报表导出 —— 用的是<b>你已经买过</b>的数据，<b>不会额外消耗你的配额</b>（<span class="ds-muted">2026-09-18 起生效，可在下方开关关闭</span>）</div>
            <div>· 集团下发给你的<b>门店与竞品</b>是<b>只读镜像</b>：本地不能改、不能删（仍可录入销售），只能由集团更新或撤回；如需本地自管，可在「④ 我已同步到的数据」里脱离同步</div>
            <div>· 你随时可在本页关闭「接收集团下发」与「允许集团拉取」</div>
            <div>· 确认会记录你的账号与时间；此确认<b>不能由集团代签</b></div>
          </div>
        </el-alert>

        <!-- ① 从集团同步（仅子公司） -->
        <div v-if="isMember" class="ds-block">
          <div class="ds-block-head">
            <span class="ds-block-title">① 从集团同步</span>
            <span class="ds-block-note">
              把集团授权给你的门店 / 竞品同步到本账号（只读镜像，由集团维护）
              <b v-if="!consented" class="ds-need-consent">（需先完成知情确认）</b>
            </span>
            <el-button
              size="small"
              type="primary"
              plain
              style="margin-left:auto;"
              :disabled="!consented"
              @click="selfScope.open = true"
            >
              设置我的管辖范围
            </el-button>
          </div>

          <el-alert
            v-if="!scopeCities.length"
            type="warning"
            :closable="false"
            show-icon
            style="margin-bottom:12px;"
          >
            <template #title>
              尚未设置管辖范围 —— 没有任何数据可同步。点右上角「设置我的管辖范围」自选城市即可
              （城市只能选集团确有门店的城市；一城一家、先到先得）。
            </template>
          </el-alert>

          <el-alert
            v-else-if="!canReceive"
            type="warning"
            :closable="false"
            show-icon
            style="margin-bottom:12px;"
          >
            <template #title>你已关闭「接收集团下发」，集团无法向你下发数据。</template>
          </el-alert>

          <template v-else>
            <div class="ds-filter">
              <span class="ds-label">数据范围</span>
              <el-checkbox v-model="kinds.markers" :disabled="!consented">我的门店</el-checkbox>
              <el-checkbox v-model="kinds.competitors" :disabled="!consented">竞品门店</el-checkbox>
              <el-checkbox v-model="kinds.competitor_snapshots" :disabled="!consented">竞品期次快照</el-checkbox>
              <el-tooltip
                content="集团按季上传的竞品期次档案（含已闭店的行）。勾选后仅同步「你管辖城市」的明细；由集团统一维护，同步下来只读。"
                placement="top"
              >
                <span class="ds-muted" style="cursor:help;">（开关店监测用）</span>
              </el-tooltip>

              <span class="ds-label" style="margin-left:16px;">本次筛选</span>
              <el-select
                v-model="filter.cities"
                multiple
                collapse-tags
                collapse-tags-tooltip
                clearable
                placeholder="全部管辖城市"
                size="small"
                style="width:220px;"
                :disabled="!consented"
              >
                <el-option
                  v-for="c in filterCityOptions"
                  :key="c.key"
                  :label="`${c.name}（${c.count}）`"
                  :value="c.name"
                />
              </el-select>
              <el-select
                v-model="filter.brands"
                multiple
                collapse-tags
                collapse-tags-tooltip
                clearable
                placeholder="全部品牌"
                size="small"
                style="width:170px;"
                :disabled="!consented"
              >
                <el-option v-for="b in scopeBrandOptions" :key="b" :label="b" :value="b" />
              </el-select>
              <el-input
                v-model="filter.keyword"
                placeholder="门店名 / 编号 / 地址"
                clearable
                size="small"
                style="width:190px;"
                :disabled="!consented"
              />
              <el-button size="small" :disabled="!consented" @click="loadCandidates">查候选</el-button>
            </div>

            <div class="ds-candbar">
              <span>候选 <b class="ds-num">{{ candidateSummary.inScope }}</b> {{ candidateUnit }}</span>
              <span v-if="candidateSummary.detailRows" class="ds-muted">
                · 快照明细 {{ candidateSummary.detailRows }} 行
              </span>
              <span v-if="candidateSummary.outOfScope" class="ds-muted">
                · 范围外丢弃 {{ candidateSummary.outOfScope }} 条
              </span>
              <span v-if="candidateSummary.outOfFilter" class="ds-muted">
                · 筛选外丢弃 {{ candidateSummary.outOfFilter }} 条
              </span>
              <span v-if="candidateSummary.selfOrigin" class="ds-muted">
                · 防回环跳过 {{ candidateSummary.selfOrigin }} 条
              </span>
              <span v-if="lastSync" class="ds-muted" style="margin-left:auto;">上次同步：{{ lastSync }}</span>
            </div>

            <div class="ds-actions">
              <el-button
                type="primary"
                size="small"
                :disabled="!consented"
                :loading="previewing"
                @click="doPreview"
              >预览</el-button>
              <span class="ds-muted">预览不会写入数据；确认同步才真正落地</span>
              <span v-if="!consented" class="ds-need-consent" style="margin-left:auto;">
                需先完成上方「知情确认」
              </span>
            </div>
          </template>

          <!--
            我的接收设置（v1.13.152）：成员「否决权」的自助入口。
            ★ 后端 `PATCH /api/orgs/me/settings` 自 v0.9 起就存在且限定成员本人可调，
              但前端一直没有调用点 ⇒ 成员只能被集团改，自己关不掉、也开不回来。
            ★ 刻意放在 v-if/v-else 链**之外**：`canReceive` 关掉后上面整段筛选区会消失，
              若设置行也放在里面，成员就再也找不到开回来的开关（只能去求集团）。
          -->
          <div class="ds-mysettings">
            <span class="ds-label">我的接收设置</span>
            <div class="ds-myswitch">
              <el-switch
                :model-value="canReceive"
                :loading="savingSettings"
                @change="(v) => saveMySettings({ canReceive: v })"
              />
              <span class="ds-myswitch-text">
                <b>接收集团下发</b>
                <span class="ds-muted">关闭后集团无法把门店同步给你</span>
              </span>
            </div>
            <div class="ds-myswitch">
              <el-switch
                :model-value="canPull(myMember)"
                :loading="savingSettings"
                @change="(v) => saveMySettings({ allowGroupPull: v })"
              />
              <span class="ds-myswitch-text">
                <b>允许集团拉取</b>
                <span class="ds-muted">关闭后集团既看不到你已购买的联通人口数据，也无法把你的门店同步上去</span>
              </span>
            </div>
          </div>
        </div>

        <!-- ② 从子公司同步（仅集团/管理员） -->
        <div v-if="!isMember" class="ds-block">
          <div class="ds-block-head">
            <span class="ds-block-title">② 从子公司同步</span>
            <span class="ds-block-note">集团主动拉取子公司数据（子公司可自行关闭「允许集团拉取」）</span>
          </div>

          <!-- ★ v1.13.156：子公司的「联通人口购买履历」不需要在此同步 —— 集团侧读时即可见。
               不写这句，集团会到处找"从哪拉子公司的联通数据"（历史上已发生过一次）。 -->
          <div class="ds-muted" style="padding:2px 0 8px;line-height:1.7;">
            子公司的<b>「联通人口购买履历」无需在此同步</b>：集团在「导出报表 / 我的门店 / 数据洞察」里可直接查看、按来源筛选并汇总导出（用的是子公司<b>已买过</b>的数据，不额外消耗配额）。
          </div>

          <div v-if="!members.length" class="ds-muted" style="padding:6px 0;">
            本集团还没有成员。请先在「用户管理 → 集团 / 子公司」里绑定子公司账号。
          </div>

          <template v-else>
            <div class="ds-filter">
              <span class="ds-label">选择子公司</span>
              <el-select v-model="targetMember" placeholder="请选择要拉取的子公司" size="small" style="width:260px;">
                <el-option
                  v-for="m in members"
                  :key="m.userId"
                  :label="memberLabel(m)"
                  :value="m.userId"
                  :disabled="!canPull(m)"
                />
              </el-select>
              <span class="ds-label" style="margin-left:16px;">数据范围</span>
              <el-checkbox v-model="kinds.markers">我的门店</el-checkbox>
              <span class="ds-muted">（竞品门店与竞品期次快照仅支持集团下发，不参与此方向）</span>
            </div>

            <el-alert
              v-if="targetMember && !targetScopeCities.length"
              type="warning"
              :closable="false"
              show-icon
              style="margin-bottom:12px;"
            >
              <template #title>
                该子公司尚未设置管辖范围 —— 无可拉取的行。请先点「设置范围」勾选城市。
              </template>
            </el-alert>

            <div v-if="targetMember && targetScopeCities.length" class="ds-candbar">
              <span>该子公司管辖范围：{{ targetScopeCities.join(' / ') }}</span>
              <span class="ds-muted">· 仅该范围内的行会被同步（越界自动丢弃）</span>
            </div>

            <div class="ds-actions">
              <el-button
                type="primary"
                size="small"
                :loading="previewing"
                :disabled="!targetMember"
                @click="doPreview"
              >预览</el-button>
              <span class="ds-muted">一次只预览一个子公司；集团总部账号自己的数据不会被改动</span>
            </div>
          </template>
        </div>

        <!-- ③ 预览明细 -->
        <div v-if="preview" class="ds-block ds-preview">
          <div class="ds-block-head">
            <span class="ds-block-title">③ 预览明细</span>
            <span class="ds-block-note">
              批次 #{{ preview.batchId }} ·
              {{ preview.direction === 'group_to_member' ? '集团 → 子公司' : '子公司 → 集团' }} ·
              {{ previewPath }}
            </span>
          </div>

          <div class="ds-counts">
            <el-tag type="success" effect="dark" size="small">新增 {{ preview.counts.added }}</el-tag>
            <el-tag type="primary" effect="dark" size="small">更新 {{ preview.counts.updated }}</el-tag>
            <el-tag type="danger" effect="dark" size="small">删除 {{ preview.counts.deleted }}</el-tag>
            <el-tag type="info" size="small">跳过 {{ preview.counts.skipped }}</el-tag>
            <el-tag v-if="preview.counts.duplicate" type="warning" size="small">
              疑似重复 {{ preview.counts.duplicate }}
            </el-tag>
            <!-- 快照是「两表一起搬」：头表按「期」计、明细按「行」计，两者要分开说，
                 否则用户看到「同步 3 期」不知道后台写了 2000 行 -->
            <el-tag v-if="preview.counts.detailRows" type="info" size="small" effect="plain">
              含快照明细 {{ preview.counts.detailRows }} 行
            </el-tag>
            <span v-if="preview.counts.outOfScope" class="ds-muted">
              范围外静默丢弃 {{ preview.counts.outOfScope }} 条
            </span>
            <span v-if="preview.counts.truncated" class="ds-warn">
              超出单批上限 {{ preview.counts.truncated }} 条被截断，请缩小范围或按期次分批同步
            </span>
          </div>

          <el-alert
            v-if="preview.counts.deleted"
            type="error"
            :closable="false"
            show-icon
            style="margin-bottom:10px;"
          >
            <template #title>
              有 {{ preview.counts.deleted }} 行「源侧已删除」的镜像将被一并删除（删除传播）。
              如不希望删除，请在下方取消勾选对应行。
            </template>
          </el-alert>

          <el-alert
            v-if="preview.counts.duplicate"
            type="warning"
            :closable="false"
            show-icon
            style="margin-bottom:10px;"
          >
            <template #title>
              有 {{ preview.counts.duplicate }} 条「疑似重复」：本账号里已经存在同一家门店
              （门店编号相同，或名称+城市+地址相同），按「先到先得」不再写入。
              这些行不会出现在下面的可勾选列表里 —— 若要以源侧为准，请先处理本账号里已有的那一行。
            </template>
          </el-alert>

          <el-table
            v-if="previewRows.length"
            ref="previewTableRef"
            :data="previewRows"
            size="small"
            max-height="360"
            style="width:100%;"
            row-key="key"
            @selection-change="onPreviewSelection"
          >
            <el-table-column type="selection" width="42" :selectable="selectableRow" />
            <el-table-column label="动作" width="82">
              <template #default="{ row }">
                <el-tag :type="actionTagType(row.action)" size="small" effect="plain">{{ actionLabel(row.action) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="90">
              <template #default="{ row }">{{ kindLabel(row.kind) }}</template>
            </el-table-column>
            <el-table-column prop="name" label="门店名称 / 期次" min-width="150" show-overflow-tooltip />
            <el-table-column label="编号 / 明细行数" width="120" show-overflow-tooltip>
              <template #default="{ row }">
                <!-- 快照行代表一期档案（不是一家店）：编号列改显明细行数 -->
                <span v-if="isSnapshotRow(row)" class="ds-muted">{{ row.detailRows ?? 0 }} 行</span>
                <span v-else>{{ row.store_code }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="city" label="城市" width="90" show-overflow-tooltip />
            <el-table-column label="说明" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.action === 'deleted'" class="ds-danger">源侧已删除</span>
                <span v-else-if="row.action === 'updated'" class="ds-changes">{{ changeText(row) }}</span>
                <span v-else-if="row.action === 'duplicate'" class="ds-warn">{{ dupText(row) }}</span>
                <span v-else-if="isSnapshotRow(row)" class="ds-changes">{{ snapshotAddText(row) }}</span>
                <span v-else class="ds-muted">新增到目标账号</span>
              </template>
            </el-table-column>
          </el-table>
          <div v-else class="ds-muted" style="padding:8px 0;">
            本批次没有需要写入的变更（全部为「无变化」「防回环跳过」或「疑似重复」）。
          </div>

          <div class="ds-actions" style="margin-top:12px;">
            <el-button size="small" @click="preview = null">取消</el-button>
            <el-button
              type="primary"
              size="small"
              :loading="committing"
              :disabled="!writableRows.length"
              @click="doCommit"
            >确认同步（{{ checkedCount }} 行）</el-button>
          </div>
        </div>

        <!-- ④ 我已同步的数据（外来副本） -->
        <div class="ds-block">
          <div class="ds-block-head">
            <span class="ds-block-title">④ 我已同步到的数据</span>
            <span class="ds-block-note">来自其他账号的只读镜像；本账号不能直接改/删</span>
          </div>
          <div v-if="!mirrors.length" class="ds-muted" style="padding:6px 0;">
            本账号名下暂无外来数据。
          </div>
          <template v-else>
            <div class="ds-candbar">
              <span>共 <b class="ds-num">{{ mirrors.length }}</b> 行</span>
              <span v-for="g in mirrorBySource" :key="g.name" class="ds-muted">· {{ g.name }} {{ g.count }}</span>
            </div>
            <el-table :data="mirrors" size="small" max-height="240" style="width:100%">
              <el-table-column label="类型" width="90">
                <template #default="{ row }">{{ kindLabel(row.kind) }}</template>
              </el-table-column>
              <el-table-column prop="name" label="门店名称" min-width="150" show-overflow-tooltip />
              <el-table-column prop="city" label="城市" width="90" show-overflow-tooltip />
              <el-table-column prop="origin_owner" label="来源账号" width="150" show-overflow-tooltip />
              <el-table-column label="操作" width="190">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="doDetach(row)">脱离同步</el-button>
                  <el-button link type="danger" size="small" @click="doRemoveForeign(row)">移除副本</el-button>
                </template>
              </el-table-column>
            </el-table>
            <div class="ds-muted" style="margin-top:6px;">
              「脱离同步」→ 转为本账号自有行，此后不再被来源覆盖；「移除副本」→ 只删本账号这一份，来源数据不受影响。
            </div>
          </template>
        </div>

        <!-- ⑤ 同步历史 -->
        <div class="ds-block">
          <div class="ds-block-head">
            <span class="ds-block-title">⑤ 同步历史</span>
            <span class="ds-block-note">每次确认同步 / 辖区划拨都会留痕（含操作人 / IP / 逐行明细），成功批次可回滚</span>
          </div>
          <div v-if="!history.length" class="ds-muted" style="padding:6px 0;">暂无同步记录。</div>
          <el-table v-else :data="history" size="small" max-height="300" style="width:100%">
            <el-table-column prop="createdAt" label="时间" width="160" />
            <el-table-column label="方向" width="120">
              <template #default="{ row }">
                <el-tag v-if="row.direction === 'transfer'" type="warning" size="small" effect="plain">辖区划拨</el-tag>
                <el-tag v-else-if="row.direction === 'scope_change'" type="info" size="small" effect="plain">范围变更</el-tag>
                <span v-else>{{ directionLabel(row.direction) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="增 / 改 / 删" width="130">
              <template #default="{ row }">
                <span v-if="row.direction === 'transfer'" class="ds-warn">迁移 {{ row.inserted }} 行</span>
                <template v-else>
                  <span class="ds-ok">+{{ row.inserted }}</span> /
                  <span class="ds-warn">{{ row.updated }}</span> /
                  <span class="ds-danger">-{{ row.deleted }}</span>
                </template>
              </template>
            </el-table-column>
            <el-table-column prop="skipped" label="跳过" width="70" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="statusTagType(row.status)" size="small" effect="plain">{{ statusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="130">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="showBatch(row)">详情</el-button>
                <el-button
                  v-if="canRollback(row)"
                  link
                  type="danger"
                  size="small"
                  @click="doRollback(row)"
                >
                  回滚
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- ⑥ 配额分配（仅集团总部） -->
        <div v-if="!isMember" class="ds-block">
          <div class="ds-block-head">
            <span class="ds-block-title">⑥ 配额分配</span>
            <span class="ds-block-note">一级分配：从「全池可分配」分给子公司（不扣自己的额度）</span>
            <el-tooltip
              :content="canReallocate ? '把你名下已持有的额度转给子公司（二级再分配，不占用全池可分配）' : '你当前没有可转出的额度（= 额度 − 已消耗）'"
              placement="top"
            >
              <span class="ds-block-btn-wrap">
                <el-button
                  size="small" type="warning" plain
                  :disabled="!canReallocate"
                  @click="openReallocate"
                >我的额度转给子公司</el-button>
              </span>
            </el-tooltip>
          </div>
          <div v-if="quota && quota.self" class="ds-mine-line">
            <span class="ds-muted">我的额度</span> <b>{{ quota.self.quota }}</b>
            <span class="ds-muted">· 已消耗</span> <b>{{ quota.self.used }}</b>
            <span class="ds-muted">· 可转出上限</span> <b class="ds-ok">{{ quota.self.transferable }}</b>
            <span class="ds-muted">（二级再分配不占用「全池可分配」、不动组织总授权）</span>
          </div>
          <div v-if="loadingQuota" class="ds-muted" style="padding:6px 0;">正在读取配额…</div>
          <template v-else-if="quota">
            <div class="ds-quota-pool">
              <div class="ds-quota-card">
                <span class="ds-quota-label">上游总配额</span>
                <b class="ds-quota-num">{{ quota.poolTotal }}</b>
              </div>
              <div class="ds-quota-card">
                <span class="ds-quota-label">当前剩余</span>
                <b class="ds-quota-num">{{ quota.remaining }}</b>
              </div>
              <div class="ds-quota-card ds-quota-hl">
                <span class="ds-quota-label">可分配</span>
                <b class="ds-quota-num">{{ quota.allocatable }}</b>
              </div>
              <div class="ds-quota-card">
                <span class="ds-quota-label">已占用</span>
                <b class="ds-quota-num">{{ quota.occupied }}</b>
              </div>
            </div>
            <div v-if="!quota.members.length" class="ds-muted" style="padding:6px 0;">
              本集团还没有成员，无法分配。请先在「用户管理 → 集团 / 子公司」绑定子公司账号。
            </div>
            <el-table v-else :data="quota.members" size="small" max-height="300" style="width:100%; margin-top:10px;">
              <el-table-column prop="name" label="子公司" min-width="160" show-overflow-tooltip />
              <el-table-column prop="quota" label="当前配额" width="90" />
              <el-table-column prop="used" label="已消耗" width="80" />
              <el-table-column prop="remain" label="剩余" width="80" />
              <el-table-column label="累计获赠" width="120">
                <template #default="{ row }">
                  <el-tooltip content="一级分配（池 → 成员）" placement="top">
                    <span class="ds-tag-pool">{{ row.grantedPool }}</span>
                  </el-tooltip>
                  <el-tooltip content="二级再分配（成员 → 成员）" placement="top">
                    <span class="ds-tag-move">{{ row.grantedMove }}</span>
                  </el-tooltip>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="80">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="openAllocate(row)">分配</el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
          <div v-else class="ds-muted" style="padding:6px 0;">暂无配额信息。</div>
        </div>
      </template>
    </el-card>

    <!-- 配额分配弹窗（一级分配 · 只增不减） -->
    <el-dialog v-model="allocateDialog.visible" title="分配配额" width="440px" append-to-body>
      <div class="ds-allocate-head">
        向 <b>{{ allocateDialog.memberName }}</b> 分配联通配额
        <span class="ds-muted">（一级分配 · 只增不减 · 双写台账）</span>
      </div>
      <el-form label-width="86px" style="margin-top:14px;">
        <el-form-item label="可分配余额">
          <b class="ds-quota-num">{{ quota?.allocatable ?? 0 }}</b>
          <span class="ds-muted" style="margin-left:8px;">全池可分配上限</span>
        </el-form-item>
        <el-form-item label="分配额度">
          <el-input-number
            v-model="allocateDialog.amount"
            :min="1"
            :max="Math.max(1, quota?.allocatable ?? 1)"
            :step="1"
            step-strictly
            controls-position="right"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="allocateDialog.note" placeholder="可选，如「华东区 Q3 配额」" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="allocateDialog.visible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="allocating" @click="doAllocate">确认分配</el-button>
      </template>
    </el-dialog>

    <!-- 二级再分配弹窗（我的额度 → 子公司 · 不占用全池可分配） -->
    <el-dialog v-model="reallocateDialog.visible" title="我的额度 · 转给子公司" width="470px" append-to-body>
      <div class="ds-allocate-head">
        把<b>我名下已持有</b>的额度转给本集团子公司
        <span class="ds-muted">（二级再分配）</span>
      </div>
      <el-form label-width="100px" style="margin-top:14px;">
        <el-form-item label="我的额度">
          <b class="ds-quota-num">{{ quota?.self?.quota ?? 0 }}</b>
          <span class="ds-muted" style="margin-left:8px;">已消耗 {{ quota?.self?.used ?? 0 }}</span>
        </el-form-item>
        <el-form-item label="可转出上限">
          <b class="ds-quota-num ds-ok">{{ quota?.self?.transferable ?? 0 }}</b>
          <span class="ds-muted" style="margin-left:8px;">= 额度 − 已消耗（已花掉的不算）</span>
        </el-form-item>
        <el-form-item label="转入方">
          <el-select v-model="reallocateDialog.toUserId" placeholder="请选择子公司" style="width: 100%;">
            <el-option
              v-for="m in (quota?.members || [])"
              :key="m.userId"
              :label="m.name"
              :value="m.userId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="转出数量">
          <el-input-number
            v-model="reallocateDialog.amount"
            :min="1"
            :max="reallocatableMax"
            :step="1"
            step-strictly
            controls-position="right"
          />
          <span class="ds-muted" style="margin-left:8px;">上限 {{ reallocatableMax }}</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="reallocateDialog.note" placeholder="可选，如「Q3 一线补充」" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <div class="ds-move-tip">
        <div>· 额度来自<b>你自己名下</b>，<b>不占用</b>「全池可分配」</div>
        <div>· 只在你与所选子公司之间移动，<b>组织总授权额度不变</b></div>
        <div>· 出资方恒为你本人 —— 无法从其他子公司扣额度</div>
        <div v-if="isSelfEmptying" class="ds-danger">转出后你的可用额度为 0，将无法发起查询</div>
      </div>
      <template #footer>
        <el-button size="small" @click="reallocateDialog.visible = false">取消</el-button>
        <el-button
          size="small"
          :type="isSelfEmptying ? 'danger' : 'primary'"
          :loading="reallocating"
          @click="doReallocate"
        >确认转出</el-button>
      </template>
    </el-dialog>

    <!--
      子公司「自助设置管辖范围」（v0.13 R1）
      ★ 传 self-mode：隐藏划拨入口与「强制保存」，并把冲突提示改为「先到先得，请改选」——
        成员没有 force 权限（后端 403 force_not_allowed），也不是划拨发起方（仅集团 owner）。
    -->
    <ScopeEditor
      v-if="isMember && myMember"
      v-model="selfScope.open"
      :org-id="orgId"
      :member="selfMember"
      self-mode
      @saved="onSelfScopeSaved"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Connection } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import api from '@/utils/api'
import { useUserStore } from '@/stores/user'
import ScopeEditor from '@/components/org/ScopeEditor.vue'

const userStore = useUserStore()
const loadingOrg = ref(true)
const role = ref(null)          // 'owner' | 'member' | null
const orgId = ref(null)
const orgName = ref('')
const members = ref([])
const myMember = ref(null)

const scopeCities = ref([])
const scopeBrands = ref([])
const cityOptions = ref([])     // [{name, key, count}]
const brandOptions = ref([])

const filter = ref({ cities: [], brands: [], keyword: '' })
// 快照默认不勾：与「竞品门店」保持一致的显式选择习惯（一次可能写入上千行明细）
const kinds = ref({ markers: true, competitors: false, competitor_snapshots: false })
const selectedKinds = computed(() => Object.keys(kinds.value).filter(k => kinds.value[k]))
/**
 * 只支持「集团下发」的对象（规则 35）。
 * ★ 方向②是「从子公司同步到集团」—— 该方向携带快照会被后端 400 拒绝，
 *   故前端在构造请求前就把它摘掉，而不是让用户点了预览才看到报错。
 */
const DOWNLOAD_ONLY_KINDS = ['competitor_snapshots']
/**
 * 各方向「前端不携带」的对象。
 * · member_to_group 额外摘掉 competitors —— 业务口径（2026-09-18 确认）：
 *   竞品一律按季期次由集团下发，子公司不自行上传 ⇒ ② 方向不再提供该选项。
 *   ⚠️ 后端 member_to_group **仍支持** competitors（能力保留），这里只收窄前端入口；
 *      如需回退，把 'competitors' 移出本表即可（模板上也要恢复复选框）。
 */
const DIRECTION_EXCLUDED = { member_to_group: ['competitors', ...DOWNLOAD_ONLY_KINDS] }
const kindsForDirection = (dir) => selectedKinds.value.filter(
  k => !(DIRECTION_EXCLUDED[dir] || []).includes(k)
)
const kindsParam = computed(() => kindsForDirection('group_to_member').join(','))
const candidateSummary = ref({ inScope: 0, outOfScope: 0, outOfFilter: 0, selfOrigin: 0, detailRows: 0 })
const targetMember = ref(null)
const targetScopeCities = ref([])

const previewTableRef = ref(null)
const preview = ref(null)
const checkedKeys = ref([])
const previewing = ref(false)
const committing = ref(false)

const mirrors = ref([])
const mirrorBySource = ref([])
const history = ref([])
const lastSync = ref('')

const quota = ref(null)
const loadingQuota = ref(false)
const allocateDialog = ref({ visible: false, userId: null, memberName: '', amount: 1, note: '' })
const allocating = ref(false)

// 二级再分配（我的额度 → 子公司）
const reallocateDialog = ref({ visible: false, toUserId: null, amount: 1, note: '' })
const reallocating = ref(false)
// ★ 上限一律取后端 summary.self.transferable（= 额度 − 已消耗），前端**不自行推导**（规则 30 同口径）
const reallocatableMax = computed(() => Math.max(1, quota.value?.self?.transferable ?? 1))
const canReallocate = computed(() => Number(quota.value?.self?.transferable ?? 0) > 0)
// 转后为 0 → 危险态提示（P11 / 规则 31：允许转空，仅提示不设限）
const isSelfEmptying = computed(() => {
  const limit = Number(quota.value?.self?.transferable ?? 0)
  return limit > 0 && Number(reallocateDialog.value.amount) >= limit
})

const isMember = computed(() => role.value === 'member')
const canReceive = computed(() => Number(myMember.value?.canReceive ?? 1) !== 0)
const canPull = (m) => Number(m?.allowGroupPull ?? 1) !== 0

/**
 * 成员本人「知情确认」（v1.13.152）
 *
 * ★ 后端 `POST /api/orgs/me/consent` 自 v0.9 起就存在、也有单测，
 *   但前端**从未有过调用点** ⇒ `org_members.consented_at` 永远是 NULL，
 *   管理端「用户管理 → 集团/子公司」那列「知情确认」的「待确认」成了死状态
 *   （提示文案还写着"等待成员本人在「数据同步」页点击确认"，指向一个不存在的按钮）。
 *   本函数补上这个入口。
 * ★ 与后端闸门配套：未确认时 `POST /api/sync/commit` 返回 403 `consent_required`；
 *   但**预览刻意放开** —— 成员可以先看清「会同步哪些数据」再决定是否确认。
 * ★ 确认只写一次（后端幂等：已确认再调返回 alreadyConsented）。
 */
const consented = computed(() => !!myMember.value?.consented)
const consenting = ref(false)
const savingSettings = ref(false)

async function doConsent () {
  try {
    await ElMessageBox.confirm(
      '确认后：\n' +
      '· 集团可查看并维护「你管辖范围内」的门店数据（范围外的行看不到）；\n' +
      '· 集团可查看你「已购买的联通人口数据（购买履历）」并做跨公司汇总与报表导出 —— 不额外消耗你的配额；\n' +
      '· 集团下发给你的门店与竞品是只读镜像，本地不能改、不能删（仍可录入销售），只能由集团更新或撤回；\n' +
      '· 如需本地自管，可在「④ 我已同步到的数据」里脱离同步，脱离后即为自有数据；\n' +
      '· 你随时可在本页关闭「接收集团下发」与「允许集团拉取」。\n\n' +
      '确认会记录你的账号与时间，不可由集团代签。',
      '知情确认',
      { type: 'info', confirmButtonText: '我已了解，确认', cancelButtonText: '再看看' }
    )
  } catch (e) { return }   // 用户取消

  consenting.value = true
  try {
    const d = await api.post('/orgs/me/consent')
    ElMessage.success(d?.alreadyConsented ? '你已完成过知情确认' : '知情确认已记录')
    // 整页重载：未确认时「① 从集团同步」的控件是禁用的，确认后要立刻解开
    await loadAll()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '知情确认失败')
  } finally {
    consenting.value = false
  }
}

/**
 * 成员自改「可接收下发 / 可被集团拉取」（否决权自助入口）
 * ★ 乐观更新：EP 的 el-switch 是受控组件，只传 `:model-value` 时不先行落地会「弹回」再跳，
 *   视觉上像失败。这里先改本地、再用服务端回执校正，失败则整页重载回真实态。
 */
async function saveMySettings (patch) {
  if (!myMember.value) return
  const backup = { canReceive: myMember.value.canReceive, allowGroupPull: myMember.value.allowGroupPull }
  myMember.value = { ...myMember.value, ...patch }
  savingSettings.value = true
  try {
    const d = await api.patch('/orgs/me/settings', patch)
    if (d?.member) myMember.value = d.member
    ElMessage.success('已更新接收设置')
  } catch (e) {
    myMember.value = { ...myMember.value, ...backup }
    ElMessage.error(e?.response?.data?.message || '更新接收设置失败')
  } finally {
    savingSettings.value = false
  }
}

/**
 * 子公司自助设管辖范围（v0.13 R1）
 * 复用组件 `components/org/ScopeEditor.vue` —— 集团侧（UsersView）已用它做「代设」，
 * 这里以 `self-mode` 挂载同一组件（隐藏划拨入口 / 强制保存，只改自己的城市）。
 */
const selfScope = ref({ open: false })
const selfMember = computed(() => ({
  userId: myMember.value?.userId ?? null,
  username: myMember.value?.username || '本账号',
  company: myMember.value?.company || null
}))

/** 范围保存后必须整页重载：候选数 / 城市下拉 / 预计可同步都会随之变化 */
async function onSelfScopeSaved () {
  await loadAll()
}

const filterCityOptions = computed(() => {
  const allow = new Set(scopeCities.value)
  const opts = cityOptions.value.filter(c => allow.has(c.name))
  return opts.length ? opts : cityOptions.value.filter(c => allow.has(c.key) || allow.has(c.name))
})
const scopeBrandOptions = computed(() => {
  if (!scopeBrands.value.length) return brandOptions.value
  const allow = new Set(scopeBrands.value)
  return brandOptions.value.filter(b => allow.has(b))
})

/**
 * 候选计数单位：勾了快照 ⇒ 一个候选可能是「一期」而不是「一家店」，
 * 统一说「家」会把人误导（1 期含上千行）。
 */
const candidateUnit = computed(
  () => (selectedKinds.value.includes('competitor_snapshots') ? '项' : '家')
)

const previewRows = computed(() => {
  if (!preview.value) return []
  const { added, updated, deleted, duplicate } = preview.value.items
  return [
    ...added.map(i => ({ ...i, action: 'added' })),
    ...updated.map(i => ({ ...i, action: 'updated' })),
    ...deleted.map(i => ({ ...i, action: 'deleted' })),
    // 疑似重复（规则 34）：只展示、不可勾选 —— 它们本来就不会被写入
    ...(duplicate || []).map(i => ({ ...i, action: 'duplicate' }))
  ]
})
/** 真正会被写入的行（疑似重复不算）—— 确认按钮的启用条件 */
const writableRows = computed(() => previewRows.value.filter(r => r.action !== 'duplicate'))
const checkedCount = computed(() => checkedKeys.value.length)

// 预览标题的「源 → 目标」路径（按方向取名字，避免 member_to_group 时显示成「子公司 → 子公司」）
const previewPath = computed(() => {
  const p = preview.value
  if (!p) return ''
  return p.direction === 'group_to_member'
    ? `${p.sourceName} → ${p.memberName}`
    : `${p.sourceName} → ${p.targetName || '集团'}`
})

function memberLabel (m) {
  const n = m.company || m.username || `#${m.userId}`
  const tag = canPull(m) ? '' : '（已关闭集团拉取）'
  const scope = (m.scope?.cities || []).length ? ` · ${m.scope.cities.length} 城` : ' · 未设范围'
  return `${n}${scope}${tag}`
}

function changeText (row) {
  return (row.changes || []).map(c => `${c.field}: ${fmt(c.from)} → ${fmt(c.to)}`).join('；')
}
const fmt = (v) => (v === null || v === undefined || v === '') ? '空' : String(v)

const actionLabel = (a) => ({ added: '新增', updated: '更新', deleted: '删除', duplicate: '疑似重复' }[a] || a)
const actionTagType = (a) => ({
  added: 'success', updated: 'primary', deleted: 'danger', duplicate: 'warning'
}[a] || 'info')
/** 疑似重复行不可勾选（它本就不会写入） */
const selectableRow = (row) => row.action !== 'duplicate'
/** 疑似重复的命中理由（让用户知道"为什么算重复"） */
const DUP_REASON = {
  store_code: '门店编号相同',
  name_city_address: '名称+城市+地址相同',
  // 快照的判重键 = 头表 UNIQUE(user_id,brand,period)：一期一条
  brand_period: '品牌+期次相同'
}
function dupText (row) {
  const why = DUP_REASON[row.by] || '业务键相同'
  if (row.by === 'brand_period') {
    const no = row.matchedRowId ? ` #${row.matchedRowId}` : ''
    return `本账号已有「${row.brand} ${row.period}」这一期${no}；先到先得，本次不写入（如需以集团为准请先删掉本账号那一期）`
  }
  const where = row.matchedIsLocal ? '本账号自建行' : '本账号已有行'
  const no = row.matchedRowId ? ` #${row.matchedRowId}` : ''
  return `${why} → 命中${where}${no}；先到先得，本次不写入`
}

// ---- 竞品期次快照（v0.13 P2/R3）----
const SNAPSHOT_KIND = 'competitor_snapshots'
const isSnapshotRow = (row) => row?.kind === SNAPSHOT_KIND
/** 快照新增行的说明：本辖区 N 行 / 全国 M 行（让用户知道自己拿到的是**过滤后**的一份） */
function snapshotAddText (row) {
  const local = row.detailRows ?? 0
  const total = row.originTotalCount
  if (total === null || total === undefined) return `本辖区 ${local} 行`
  return `本辖区 ${local} 行 / 全国 ${total} 行（按你的管辖城市过滤）`
}
const statusLabel = (s) => ({
  success: '成功', partial: '部分成功', failed: '失败', preview: '预览', rolled_back: '已回滚'
}[s] || s)
const statusTagType = (s) => ({ success: 'success', partial: 'warning', failed: 'danger' }[s] || 'info')
const KIND_LABEL = {
  markers: '我的门店',
  competitors: '竞品门店',
  competitor_snapshots: '竞品期次快照'
}
const kindLabel = (k) => KIND_LABEL[k] || '未知'
const directionLabel = (d) => ({
  group_to_member: '集团 → 子公司',
  member_to_group: '子公司 → 集团',
  transfer: '辖区划拨',
  scope_change: '范围变更'
}[d] || d)

/**
 * 可回滚的批次：仅数据类批次（transfer / 双向同步）且已成功。
 * 范围变更（scope_change）是配置留痕，不可回滚；preview 批次没写过数据，无需回滚。
 */
const canRollback = (row) => !!row
  && ['transfer', 'group_to_member', 'member_to_group'].includes(row.direction)
  && ['success', 'partial'].includes(row.status)

// ⚠️ utils/api.js 的响应拦截器已经返回 `response.data`，
//    所以 api.get/post 的返回值**就是响应体**，不能再取 `.data`（曾因此整页空态）
async function safeGet (url, params) {
  return api.get(url, params ? { params } : undefined)
}

async function loadAll () {
  loadingOrg.value = true
  try {
    const me = await safeGet('/orgs/me')
    role.value = me.role || null
    // 回写全局归属，保证右上角菜单入口与页面判定始终一致
    userStore.setOrgRole(me.role)
    if (!role.value) return

    orgId.value = me.org.id
    orgName.value = me.org.name
    // ⚠️ 集团视角的成员表挂在 org.members 下（不是顶层 me.members）——批次 D 踩过：
    //    读错层级会让集团页显示「成员 0 个 / 本集团还没有成员」，从而根本没入口拉取子公司
    members.value = me.role === 'owner' ? (me.org?.members || []) : []
    myMember.value = me.role === 'member' ? me.member : null
    if (me.role === 'member') {
      scopeCities.value = me.member?.scope?.cities || []
      scopeBrands.value = me.member?.scope?.brands || []
    }

    // 下拉选项是「锦上添花」——单独 try，避免它失败把后面的候选/历史一起带崩
    try {
      const opts = await safeGet('/sync/scope-options', { orgId: orgId.value, userId: isMember.value ? undefined : targetMember.value })
      cityOptions.value = opts.cities || []
      brandOptions.value = opts.brands || []
    } catch (e) {
      console.error('读取下拉选项失败:', e)
      ElMessage.warning('读取管辖范围选项失败，下拉可能为空')
    }

    if (isMember.value) await loadCandidates()
    await Promise.all([loadMirrors(), loadHistory()])
    if (!isMember.value) await loadQuota()
  } catch (e) {
    console.error('读取组织信息失败:', e)
    ElMessage.error('读取组织信息失败')
  } finally {
    loadingOrg.value = false
  }
}

async function loadCandidates () {
  if (isMember.value) {
    try {
      const d = await safeGet('/sync/candidates', { kind: kindsParam.value, direction: 'group_to_member', cities: filter.value.cities.join(','), brands: filter.value.brands.join(','), keyword: filter.value.keyword })
      candidateSummary.value = {
        inScope: d.inScope.length,
        outOfScope: d.outOfScope,
        outOfFilter: d.outOfFilter,
        selfOrigin: d.selfOrigin,
        // 快照：候选的「期数」与「明细行数」是两回事（1 期可能上千行）
        detailRows: d.detailRows || 0
      }
    } catch (e) {
      console.error('查询候选失败:', e)
    }
  }
}

async function loadTargetScope () {
  targetScopeCities.value = []
  if (!targetMember.value) return
  try {
    const d = await safeGet(`/orgs/${orgId.value}/members/${targetMember.value}/scope`)
    targetScopeCities.value = d.scope?.cities || []
  } catch (e) {
    console.error('读取子公司管辖范围失败:', e)
  }
}

async function doPreview () {
  previewing.value = true
  try {
    const body = isMember.value
      ? { userId: myMember.value.userId, direction: 'group_to_member', kinds: kindsForDirection('group_to_member'), filter: filter.value }
      : { userId: targetMember.value, direction: 'member_to_group', kinds: kindsForDirection('member_to_group'), filter: { keyword: '' } }
    const d = await api.post('/sync/preview', body)
    preview.value = d
    checkedKeys.value = [
      ...d.items.added.map(i => i.key),
      ...d.items.updated.map(i => i.key),
      ...d.items.deleted.map(i => i.key)
    ]
    // ★ 让表格自身的勾选态与 checkedKeys 一致（默认全选）。
    //   只设 checkedKeys 不动表格 → 复选框全显示未勾选，但按钮写「N 行」；
    //   用户随手点一行会瞬间掉到「1 行」（UI 验证时实际踩到）。
    await nextTick()
    previewTableRef.value?.toggleAllSelection?.()
    if (!previewRows.value.length) {
      ElMessage.info('没有需要同步的变更（数据已是最新）')
    } else {
      ElMessage.success(`已生成预览：批次 #${d.batchId}`)
    }
  } catch (e) {
    const msg = e?.response?.data?.message || '生成预览失败'
    ElMessage.error(msg)
  } finally {
    previewing.value = false
  }
}

function onPreviewSelection (rows) {
  checkedKeys.value = rows.map(r => r.key)
}

async function doCommit () {
  try {
    await ElMessageBox.confirm(
      `将按预览结果写入 ${checkedCount.value} 行变更（其中删除 ${preview.value.counts.deleted} 行）。` +
      (preview.value.counts.detailRows
        ? `其中快照明细 ${preview.value.counts.detailRows} 行会随期次一并写入。`
        : '') +
      (preview.value.counts.duplicate
        ? `另有 ${preview.value.counts.duplicate} 条疑似重复不会写入（先到先得）。`
        : '') +
      '写入在同一事务内完成，任一步失败整体回滚。确认继续？',
      '确认同步', { type: 'warning' }
    )
  } catch (e) { return }   // 用户取消

  committing.value = true
  try {
    const all = [...preview.value.items.added, ...preview.value.items.updated, ...preview.value.items.deleted].map(i => i.key)
    const excluded = all.filter(k => !checkedKeys.value.includes(k))
    const d = await api.post('/sync/commit', { batchId: preview.value.batchId, excluded })
    ElMessage.success(
      `同步完成：新增 ${d.applied.inserted} / 更新 ${d.applied.updated} / 删除 ${d.applied.deleted}` +
      (d.applied.snapshotRows ? ` / 快照明细 ${d.applied.snapshotRows} 行` : '') +
      (d.applied.duplicate ? ` / 疑似重复未写入 ${d.applied.duplicate}` : '') +
      (d.applied.failed ? ` / 失败 ${d.applied.failed}` : '')
    )
    preview.value = null
    await refreshAndReload()
  } catch (e) {
    const msg = e?.response?.data?.message || '提交同步失败（已整体回滚）'
    ElMessage.error(msg)
  } finally {
    committing.value = false
  }
}

async function refreshAndReload () {
  await Promise.all([loadCandidates(), loadMirrors(), loadHistory()])
  return role.value
}

async function loadMirrors () {
  try {
    const d = await safeGet('/sync/mirrors', { kind: 'all', limit: 500 })
    mirrors.value = d.mirrors || []
    mirrorBySource.value = d.bySource || []
  } catch (e) {
    console.error('读取外来副本失败:', e)
  }
}

async function loadHistory () {
  try {
    const d = await safeGet('/sync/batches', { limit: 30 })
    history.value = d.batches || []
    if (history.value.length) {
      const b = history.value[0]
      lastSync.value = `${b.createdAt} · 新增 ${b.inserted} / 更新 ${b.updated}`
    }
  } catch (e) {
    console.error('读取同步历史失败:', e)
  }
}

async function doDetach (row) {
  try {
    await ElMessageBox.confirm(
      `「${row.name}」将脱离同步，成为本账号自有门店，此后不再被「${row.origin_owner}」覆盖。确认？`,
      '脱离同步', { type: 'warning' }
    )
  } catch (e) { return }
  try {
    const d = await api.post('/sync/detach', { kind: row.kind || 'markers', ids: [row.id] })
    ElMessage.success(d.message || '已脱离同步')
    await Promise.all([loadMirrors(), loadHistory()])
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '脱离同步失败')
  }
}

async function doRemoveForeign (row) {
  try {
    await ElMessageBox.confirm(
      `将从本账号移除副本「${row.name}」。来源账号「${row.origin_owner}」的数据不受影响，但下次同步会再次下发。确认？`,
      '移除副本', { type: 'warning' }
    )
  } catch (e) { return }
  try {
    const d = await api.post('/sync/foreign/remove', { kind: row.kind || 'markers', ids: [row.id] })
    ElMessage.success(d.message || '已移除')
    await loadMirrors()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '移除失败')
  }
}

async function showBatch (row) {
  try {
    const d = await safeGet(`/sync/batches/${row.id}`)
    const p = d.batch?.planned
    const isTransfer = d.batch?.direction === 'transfer'
    const lines = [
      `批次 #${d.batch.id}`,
      `方向：${directionLabel(d.batch.direction)}`,
      `${d.sourceName} → ${d.targetName}`,
      `状态：${statusLabel(d.batch.status)}`,
      p ? `计划：新增 ${p.added} / 更新 ${p.updated} / 删除 ${p.deleted} / 跳过 ${p.skipped}` : '',
      isTransfer
        ? `迁移：门店 ${d.batch.inserted} 行（行 ID 不变，销售记录同事务跟随）`
        : `结果：新增 ${d.batch.inserted} / 更新 ${d.batch.updated} / 删除 ${d.batch.deleted} / 失败 ${d.batch.failed}`,
      d.batch.applied?.length ? `明细样本：${d.batch.applied.length} 条` : '',
      `操作人 ID：${d.batch.createdBy}　IP：${d.batch.ip || '-'}`,
      `时间：${d.batch.createdAt} → ${d.batch.finishedAt || '-'}`
    ].filter(Boolean)
    await ElMessageBox.alert(lines.join('<br>'), '批次详情', { dangerouslyUseHTMLString: true })
  } catch (e) {
    ElMessage.error('读取批次详情失败')
  }
}

/**
 * 回滚批次（P2）。
 *   · 划拨批次：完整可逆（归属 + 销售 + 集团镜像 + 双方 scope 一并还原）。
 *     若新持有方已维护过这批数据，后端返回 409 `target_edited` → 二次确认后再 force 重试。
 *   · 普通同步批次：只删除本批新增的镜像；「更新/删除」无历史快照，后端会在 message 里说明。
 */
async function doRollback (row) {
  const isTransfer = row.direction === 'transfer'
  const tip = isTransfer
    ? `将把本批划拨的 ${row.inserted} 行门店及其销售记录的所有权改回原持有方，并还原双方管辖范围。<br>`
      + '<b>若新持有方已开始维护这批数据，回滚会覆盖其修改。</b>'
    : `将删除本批新增的 ${row.inserted} 行镜像（源账号的数据不受影响）。<br>`
      + '本批的「更新 / 删除」没有历史快照，无法一并还原（需让源账号重新同步）。'
  try {
    await ElMessageBox.confirm(tip, isTransfer ? '回滚划拨' : '回滚同步批次', {
      type: 'warning',
      dangerouslyUseHTMLString: true,
      confirmButtonText: '确认回滚',
      cancelButtonText: '取消'
    })
  } catch (e) { return }

  try {
    const d = await api.post(`/sync/batches/${row.id}/rollback`)
    ElMessage.success(d.message || '已回滚')
    await loadHistory()
    await loadMirrors()
  } catch (e) {
    const res = e?.response
    const body = res?.data
    if (res?.status === 409 && body?.code === 'target_edited') {
      try {
        await ElMessageBox.confirm(body.message || '新持有方已修改过这批数据，回滚会覆盖其修改。', '新持有方已编辑', {
          type: 'error', confirmButtonText: '仍然回滚', cancelButtonText: '取消'
        })
      } catch (e2) { return }
      try {
        const d2 = await api.post(`/sync/batches/${row.id}/rollback`, { force: true })
        ElMessage.success(d2.message || '已回滚')
        await loadHistory()
        await loadMirrors()
      } catch (e3) {
        ElMessage.error(e3?.response?.data?.message || '回滚失败')
      }
      return
    }
    ElMessage.error(body?.message || '回滚失败')
  }
}

// ---- 配额分配（仅集团总部）----
async function loadQuota () {
  if (isMember.value) return
  loadingQuota.value = true
  try {
    quota.value = await safeGet(`/orgs/${orgId.value}/quota/summary`)
  } catch (e) {
    console.error('读取配额总览失败:', e)
    quota.value = null
  } finally {
    loadingQuota.value = false
  }
}

function openAllocate (m) {
  allocateDialog.value = {
    visible: true,
    userId: m.userId,
    memberName: m.name,
    amount: 1,
    note: ''
  }
}

async function doAllocate () {
  const amount = Number(allocateDialog.value.amount)
  const allocatable = quota.value?.allocatable ?? 0
  if (!Number.isInteger(amount) || amount <= 0) {
    ElMessage.warning('分配额度必须是正整数')
    return
  }
  if (amount > allocatable) {
    ElMessage.warning(`可分配余额不足：当前可分配 ${allocatable} 次`)
    return
  }
  try {
    await ElMessageBox.confirm(
      `向「${allocateDialog.value.memberName}」分配 ${amount} 次配额（只增不减 · 双写台账 · 不动物理池）。确认？`,
      '确认分配', { type: 'warning' }
    )
  } catch (e) { return }   // 用户取消

  allocating.value = true
  try {
    const d = await api.post(`/orgs/${orgId.value}/quota/allocate`, {
      toUserId: allocateDialog.value.userId,
      amount,
      note: allocateDialog.value.note || undefined
    })
    ElMessage.success(`已向「${allocateDialog.value.memberName}」分配 ${d.amount} 次配额`)
    allocateDialog.value.visible = false
    await loadQuota()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '分配配额失败')
  } finally {
    allocating.value = false
  }
}

// ---- 二级再分配（我的额度 → 子公司）----
function openReallocate () {
  reallocateDialog.value = {
    visible: true,
    toUserId: (quota.value?.members || [])[0]?.userId ?? null,
    amount: 1,
    note: ''
  }
}

async function doReallocate () {
  const toUserId = reallocateDialog.value.toUserId
  if (!toUserId) {
    ElMessage.warning('请选择转入的子公司')
    return
  }
  const amount = Number(reallocateDialog.value.amount)
  // ★ 与后端同口径：上限 = summary.self.transferable
  const limit = Number(quota.value?.self?.transferable ?? 0)
  if (!Number.isInteger(amount) || amount <= 0) {
    ElMessage.warning('转出额度必须是正整数')
    return
  }
  if (amount > limit) {
    ElMessage.warning(`超出可转出上限：当前可转 ${limit} 次（= 额度 − 已消耗）`)
    return
  }
  const target = (quota.value?.members || []).find(m => m.userId === toUserId)
  const name = target?.name || `#${toUserId}`
  const emptying = amount >= limit
  try {
    await ElMessageBox.confirm(
      emptying
        ? `将你名下 ${amount} 次额度转给「${name}」。转出后你的可用额度为 0，将无法发起查询。确认？`
        : `把你名下 ${amount} 次额度转给「${name}」（二级再分配 · 不占用「全池可分配」· 组织总授权不变）。确认？`,
      emptying ? '转空自己的额度' : '确认转出',
      { type: emptying ? 'error' : 'warning' }
    )
  } catch (e) { return }   // 用户取消

  reallocating.value = true
  try {
    const d = await api.post(`/orgs/${orgId.value}/quota/reallocate`, {
      toUserId,
      amount,
      note: reallocateDialog.value.note || undefined
    })
    ElMessage.success(`已把 ${d.amount} 次额度转给「${name}」（你现有 ${d.from.after} 次）`)
    reallocateDialog.value.visible = false
    await loadQuota()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '组内再分配失败')
  } finally {
    reallocating.value = false
  }
}

onMounted(loadAll)

// 切换子公司 → 读它的管辖范围（决定「可拉取范围」提示与越界丢弃口径）
watch(targetMember, () => { preview.value = null; loadTargetScope() })
</script>

<style scoped>
.data-sync-view { padding: 16px; height: 100%; overflow-y: auto; box-sizing: border-box; }
.ds-card { max-width: 1180px; margin: 0 auto; }
.ds-header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.ds-title { font-size: 16px; font-weight: 500; }
.ds-sub { font-size: 12px; color: #909399; }
.ds-loading { padding: 24px; color: #909399; text-align: center; }
.ds-empty-tip { font-size: 12px; color: #909399; line-height: 1.8; }

.ds-orgbar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; margin-bottom: 16px;
  background: #f5f7fa; border-radius: 8px;
}
.ds-orgname { font-size: 14px; font-weight: 500; }
.ds-orgmeta { font-size: 12px; color: #606266; }

.ds-block { border-top: 1px solid #ebeef5; padding: 14px 0 4px; }
.ds-block:first-of-type { border-top: none; }
.ds-block-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.ds-block-title { font-size: 14px; font-weight: 500; }
.ds-block-note { font-size: 12px; color: #909399; }

.ds-filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.ds-label { font-size: 12px; color: #606266; }

.ds-candbar { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #303133; margin-bottom: 10px; flex-wrap: wrap; }
.ds-num { color: #409eff; }
.ds-muted { font-size: 12px; color: #909399; }
.ds-ok { color: #67c23a; }
.ds-warn { color: #e6a23c; }
.ds-danger { color: #f56c6c; }
.ds-changes { font-size: 12px; color: #606266; }
.ds-actions { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }

/* ==== 知情确认（v1.13.152）==== */
/* 提示条与「① 从集团同步」之间留白：它虽在区块之外，但语义上是该区块的前置条件 */
.ds-consent-bar { margin-bottom: 14px; }
.ds-consent-head { display: flex; align-items: center; gap: 12px; }
.ds-consent-body { font-size: 12px; line-height: 1.9; color: #606266; }
/* 未确认时禁用区块内的提示字：用橙色与 .ds-muted 区分，避免"看起来只是灰说明" */
.ds-need-consent { font-size: 12px; color: #e6a23c; font-weight: 500; }

/* 我的接收设置：成员自助开关。放在 v-if/v-else 链之外，任何状态下都在。 */
.ds-mysettings {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  margin-top: 12px; padding-top: 12px;
  border-top: 1px dashed #ebeef5;
}
.ds-myswitch { display: inline-flex; align-items: center; gap: 8px; }
.ds-myswitch-text { display: inline-flex; flex-direction: column; line-height: 1.4; }
.ds-myswitch-text b { font-size: 12px; font-weight: 500; color: #303133; }
.ds-preview { background: #fafcff; border-radius: 8px; padding: 14px 12px; }
.ds-counts { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }

.ds-quota-pool { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.ds-quota-card {
  flex: 1; min-width: 120px; padding: 12px 14px;
  background: #f5f7fa; border-radius: 8px;
  display: flex; flex-direction: column; gap: 4px;
}
.ds-quota-card.ds-quota-hl { background: #ecf5ff; border: 1px solid #d9ecff; }
.ds-quota-label { font-size: 12px; color: #909399; }
.ds-quota-num { font-size: 20px; color: #303133; font-weight: 600; }
.ds-quota-hl .ds-quota-num { color: #409eff; }
.ds-allocate-head { font-size: 14px; color: #303133; }

/* 二级再分配：⑥ 区块头部按钮 + 我的额度一行 */
.ds-block-btn-wrap { margin-left: auto; display: inline-flex; }
.ds-mine-line {
  display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
  font-size: 12px; color: #303133;
  padding: 8px 12px; margin-bottom: 10px;
  background: #fdf6ec; border: 1px solid #faecd8; border-radius: 6px;
}
.ds-mine-line b { font-size: 13px; }
.ds-tag-pool,
.ds-tag-move {
  display: inline-block; min-width: 34px; padding: 1px 6px; margin-right: 4px;
  border-radius: 4px; font-size: 12px; text-align: center;
}
.ds-tag-pool { background: #ecf5ff; color: #409eff; border: 1px solid #d9ecff; }
.ds-tag-move { background: #fdf6ec; color: #e6a23c; border: 1px solid #faecd8; }
.ds-move-tip {
  font-size: 12px; color: #606266; line-height: 1.9;
  background: #f5f7fa; border-radius: 6px; padding: 8px 12px;
}

</style>
