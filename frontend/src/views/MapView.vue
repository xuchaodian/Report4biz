<template>
  <div class="map-view">
    <!-- 左上角地址检索框 -->
    <AddressSearchPanel
      :results="searchResults"
      @search="searchAddress"
      @search-enter="handleEnterSearch"
      @select-result="goToLocation"
    />

    <!-- 周边检索面板 -->
    <PoiSearchPanel
      v-model:expanded="poiSearchExpanded"
      v-model:keyword="poiKeywords"
      @circle-search="startCircleSearch"
      @polygon-search="startPolygonSearch"
      @viewport-search="startViewportSearch"
      @clear-search="clearPoiSearch"
    />

    <!-- 商圈工具面板 -->
    <BusinessCirclePanel
      v-model:expanded="businessCircleExpanded"
      :active-tool="activeTool"
      :potential-visible="potentialVisible"
      :env-score-active="envScorePickMode"
      @set-tool="setTool"
      @env-score="startEnvScore"
      @population-dist="openPopulationDistribution"
      @population-compare="openPopulationCompare"
      @toggle-smartsteps="smartstepsVisible = !smartstepsVisible"
      @toggle-potential="potentialVisible = !potentialVisible"
    />



    <!-- 显示门店 + 门店工具 -->
    <StoreControlPanel
      v-model:toggle-expanded="storeToggleExpanded"
      v-model:tools-expanded="storeToolsExpanded"
      v-model:show-business="showBusinessLayer"
      v-model:show-competitor="showCompetitorLayer"
      v-model:show-brand="showBrandStoreLayer"
      v-model:show-center="showShoppingCenterLayer"
      v-model:store-status-filter="myStoreStatusFilter"
      :active-tool="activeTool"
      :store-search-visible="storeSearchVisible"
      :district-visible="districtVisible"
      :commerce-visible="commerceVisible"
      :show-store-circles="showStoreCircles"
      :show-heatmap="showHeatmap"
      :show-cluster="showCluster"
      @set-tool="setTool"
      @toggle-store-search="storeSearchVisible = !storeSearchVisible"
      @toggle-district="districtVisible = !districtVisible"
      @toggle-commerce="commerceVisible = !commerceVisible"
      @toggle-store-circles="toggleStoreCircles"
      @toggle-heatmap="toggleHeatmap"
      @toggle-cluster="toggleCluster"
    />

    <!-- 工具栏 - 右上角收起/展开 -->
    <MapToolbar
      v-model:expanded="toolbarExpanded"
      :active-tool="activeTool"
      :city-trade-area-layer-active="cityTradeAreaLayer !== null"
      :measurement-result="measurementResult"
      @set-tool="setTool"
      @open-city-trade-area="openCityTradeArea"
      @clear-drawings="clearDrawings"
    />

    <!-- 城市商圈选择对话框 -->
    <CityTradeAreaDialog
      v-model:visible="cityTradeAreaVisible"
      :loading="cityTradeAreaLoading"
      :grouped-cities="groupedTradeAreaCities"
      @confirm="onCityTradeAreaConfirm"
    />

    <!-- 网点优化模式选择对话框 -->
    <el-dialog v-model="storeCircleModeDialogVisible" title="网点优化" width="380px" :close-on-click-modal="false">
      <div style="padding: 10px 0; display: flex; flex-direction: column; gap: 12px;">
        <el-button size="large" style="height:48px; font-size:15px;" @click="selectStoreCircleMode('overlap')">
          <el-icon style="margin-right:6px;"><Connection /></el-icon>自家相互蚕食
        </el-button>
        <el-button size="large" style="height:48px; font-size:15px;" @click="selectStoreCircleMode('competition')">
          <el-icon style="margin-right:6px;"><DataLine /></el-icon>周边竞争强度
        </el-button>
        <el-button size="large" style="height:48px; font-size:15px;" @click="selectStoreCircleMode('track')">
          <el-icon style="margin-right:6px;"><Aim /></el-icon>竞争门店追踪
        </el-button>
        <!-- 机会区分析（v1.7.36 开发后暂隐藏，保留代码便于恢复） -->
        <!--
        <el-button size="large" style="height:48px; font-size:15px;" @click="selectStoreCircleMode('opportunity')">
          <el-icon style="margin-right:6px;"><MapLocation /></el-icon>机会区分析
        </el-button>
        -->
      </div>
    </el-dialog>

    <!-- 门店商圈半径设置对话框 -->
    <el-dialog v-model="storeCircleDialogVisible" :title="storeCircleDialogTitle" width="420px" :close-on-click-modal="false">
      <div style="padding: 10px 0;">
        <p style="margin-bottom:12px;font-size:14px;color:#606266;">
          {{ storeCircleMode === 'overlap'
            ? '为地图上所有可见门店生成半径圆，按重叠率着色'
            : storeCircleMode === 'track'
              ? '以指定竞争品牌的门店为中心，分析半径内的我的门店与其他竞品情况'
              : storeCircleMode === 'opportunity'
                ? '在当前地图视野内扫描竞品密度，识别竞品稀疏的机会区（0 成本）'
              : '为地图上所有可见门店生成半径圆，按竞争关系着色' }}
        </p>
        <el-form label-width="80px">
          <el-form-item :label="storeCircleMode === 'opportunity' ? '网格大小(km)' : '半径(km)'">
            <el-input-number v-model="storeCircleRadius" :min="0.5" :max="10" :step="0.5" :precision="1" style="width:200px" />
          </el-form-item>
          <template v-if="storeCircleMode === 'opportunity'">
            <el-form-item label="密度阈值">
              <el-input-number v-model="opportunityDensityThreshold" :min="1" :max="20" :step="1" style="width:200px" />
              <span style="margin-left:8px;font-size:12px;color:#909399;">网格内竞品≤该值视为机会区</span>
            </el-form-item>
            <el-form-item label="数据范围">
              <el-radio-group v-model="opportunityScope">
                <el-radio value="viewport">当前视野</el-radio>
                <el-radio value="city">全城</el-radio>
              </el-radio-group>
            </el-form-item>
          </template>
          <template v-if="storeCircleMode === 'overlap'">
            <el-form-item label="高阈值(%)">
              <el-input-number v-model="overlapHighThreshold" :min="10" :max="100" :step="5" style="width:200px" />
            </el-form-item>
            <el-form-item label="低阈值(%)">
              <el-input-number v-model="overlapLowThreshold" :min="1" :max="95" :step="5" style="width:200px" />
            </el-form-item>
          </template>
          <template v-if="storeCircleMode === 'track'">
            <el-form-item label="竞争品牌">
              <el-select v-model="trackBrand" placeholder="请选择要追踪的竞争品牌" style="width:200px" clearable filterable>
                <el-option v-for="b in competitionBrandList" :key="b" :label="b" :value="b" />
              </el-select>
            </el-form-item>
          </template>
        </el-form>
        <!-- 分类筛选勾选框 -->
        <div style="margin-top:12px;padding:0 10px;">
          <div style="font-size:13px;font-weight:600;color:#333;margin-bottom:8px;">显示分类</div>
          <template v-if="storeCircleMode === 'overlap'">
            <el-checkbox v-model="storeCircleFilters.overlap.overlapHigh" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#f56c6c;"></span>
                重叠率 ≥{{ overlapHighThreshold }}%
              </span>
            </el-checkbox>
            <el-checkbox v-model="storeCircleFilters.overlap.overlapMid" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#e6a23c;"></span>
                {{ overlapLowThreshold }}% ≤ 重叠率 &lt; {{ overlapHighThreshold }}%
              </span>
            </el-checkbox>
            <el-checkbox v-model="storeCircleFilters.overlap.overlapLow" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#409eff;"></span>
                0 &lt; 重叠率 &lt; {{ overlapLowThreshold }}%
              </span>
            </el-checkbox>
            <el-checkbox v-model="storeCircleFilters.overlap.overlapNone" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#909399;"></span>
                无重叠
              </span>
            </el-checkbox>
          </template>
          <template v-else-if="storeCircleMode === 'competition'">
            <!-- 竞争品牌多选 -->
            <div style="margin-bottom:10px;">
              <div style="font-size:13px;font-weight:600;color:#333;margin-bottom:8px;">竞争品牌（可多选）</div>
              <el-select v-model="competitionBrands" placeholder="不选 = 统计全部竞品" style="width:100%" multiple collapse-tags collapse-tags-tooltip clearable>
                <el-option v-for="b in competitionBrandList" :key="b" :label="b" :value="b" />
              </el-select>
              <div style="font-size:12px;color:#909399;margin-top:4px;">仅统计所选品牌的竞品门店，不选则统计全部</div>
            </div>
            <el-checkbox v-model="storeCircleFilters.competition.noMyNoComp" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#f59e0b;"></span>
                无我的门店 + 无竞品
              </span>
            </el-checkbox>
            <el-checkbox v-model="storeCircleFilters.competition.hasMyNoComp" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#409eff;"></span>
                有我的门店 + 无竞品
              </span>
            </el-checkbox>
            <el-checkbox v-model="storeCircleFilters.competition.noMyHasComp" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#ff69b4;"></span>
                无我的门店 + 有竞品
              </span>
            </el-checkbox>
            <el-checkbox v-model="storeCircleFilters.competition.hasMyHasComp" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#67c23a;"></span>
                有我的门店 + 有竞品
              </span>
            </el-checkbox>
          </template>
          <template v-else-if="storeCircleMode === 'track'">
            <!-- 竞争追踪：4分类 -->
            <el-checkbox v-model="storeCircleFilters.track.noMyNoOther" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#f59e0b;"></span>
                无我的门店 + 无其他竞品
              </span>
            </el-checkbox>
            <el-checkbox v-model="storeCircleFilters.track.hasMyNoOther" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#409eff;"></span>
                有我的门店 + 无其他竞品
              </span>
            </el-checkbox>
            <el-checkbox v-model="storeCircleFilters.track.noMyHasOther" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#ff69b4;"></span>
                无我的门店 + 有其他竞品
              </span>
            </el-checkbox>
            <el-checkbox v-model="storeCircleFilters.track.hasMyHasOther" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#67c23a;"></span>
                有我的门店 + 有其他竞品
              </span>
            </el-checkbox>
          </template>
          <template v-else-if="storeCircleMode === 'opportunity'">
            <!-- 机会区分析：3 个密度分级 -->
            <el-checkbox v-model="storeCircleFilters.opportunity.lowDensity" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#67c23a;"></span>
                机会区（竞品≤{{ opportunityDensityThreshold }}）
              </span>
            </el-checkbox>
            <el-checkbox v-model="storeCircleFilters.opportunity.mediumDensity" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#e6a23c;"></span>
                中密度区
              </span>
            </el-checkbox>
            <el-checkbox v-model="storeCircleFilters.opportunity.highDensity" style="display:block;margin-bottom:6px;font-size:13px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#f56c6c;"></span>
                高密度区
              </span>
            </el-checkbox>
            <div style="font-size:12px;color:#909399;margin-top:6px;">密度分级基于当前竞品数据相对分位，纯本地计算 0 成本</div>
          </template>
        </div>
      </div>
      <template #footer>
        <el-button @click="storeCircleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="applyStoreCircles">生成</el-button>
      </template>
    </el-dialog>

    <!-- 竞品雷达下钻（周边竞争强度增强）：点击竞争强度圆圈弹出 -->
    <el-dialog v-model="competitionRadarVisible" title="📡 竞品雷达" width="720px" :close-on-click-modal="false" @closed="disposeRadarCharts">
      <template #default>
        <div v-if="competitionRadarData" class="radar-drilldown">
          <div class="radar-head">
            <div>
              <b style="font-size:15px;">{{ competitionRadarData.name }}</b>
              <el-tag size="small" style="margin-left:8px;">{{ competitionRadarData.type || '门店' }}</el-tag>
            </div>
            <div class="radar-head-meta">
              <span>半径 <b>{{ competitionRadarData.radiusKm }}km</b></span>
              <span>圈内竞品 <b :style="{ color: '#f56c6c' }">{{ competitionRadarData.total }}</b> 家</span>
              <span>品牌 <b>{{ competitionRadarData.brandCount }}</b> 个</span>
              <span>平均距离 <b>{{ competitionRadarData.avgDist }}m</b></span>
              <span>最密集方向 <b>{{ competitionRadarData.mostDenseDir }}</b></span>
              <span class="radar-threat" :style="{ background: competitionRadarData.threatColor }">
                威胁等级：{{ competitionRadarData.threatLevel }}
              </span>
            </div>
          </div>
          <div class="radar-charts">
            <div class="radar-chart-box">
              <div class="radar-chart-title">品牌构成（雷达图）</div>
              <div ref="radarChartRef" style="width:100%;height:300px;"></div>
            </div>
            <div class="radar-chart-box">
              <div class="radar-chart-title">8 方向分布（最密红色）</div>
              <div ref="directionChartRef" style="width:100%;height:300px;"></div>
            </div>
          </div>
        </div>
      </template>
    </el-dialog>

    <!-- 门店商圈图例（可拖拽面板，内联样式绕过 scoped CSS） -->
    <div v-if="storeCircleLegendVisible && storeCircleLegendItems.length > 0"
      :style="{
        position: 'absolute',
        top: legendPanelPos.top + 'px',
        left: legendPanelPos.left + 'px',
        background: '#fff',
        borderRadius: '8px',
        border: '1px solid #ddd',
        boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
        zIndex: 10000,
        minWidth: '150px',
        pointerEvents: 'auto',
        display: 'block'
      }"
    >
      <div
        @mousedown="onLegendDragStart"
        :style="{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px 4px',
          fontSize: '13px',
          fontWeight: 600,
          color: '#333',
          cursor: 'move',
          userSelect: 'none'
        }"
      >
        <span>{{ storeCircleMode === 'overlap' ? '重合度图例' : storeCircleMode === 'track' ? '竞争门店追踪图例' : storeCircleMode === 'opportunity' ? '机会区分析图例' : '竞争关系图例' }}</span>
        <el-button link size="small" @click="onStoreCircleLegendClose">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
      <div :style="{ padding: '4px 10px 10px' }">
        <template v-if="storeCircleMode === 'competition' || storeCircleMode === 'track'">
          <!-- 竞争关系/追踪模式：可展开城市分布 -->
          <div v-for="(item, idx) in storeCircleLegendItems" :key="idx">
            <div
              :style="{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', cursor: 'pointer', userSelect: 'none' }"
              @click="toggleLegendCategory(item.key)"
            >
              <span
                :style="{
                  background: item.color,
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  flexShrink: 0,
                  border: '1px solid rgba(0,0,0,0.1)',
                  display: 'inline-block'
                }"
              ></span>
              <span :style="{ color: '#555', fontSize: '12px', lineHeight: 1.6 }">{{ item.label }}</span>
              <span :style="{ marginLeft: 'auto', color: '#909399', fontSize: '11px' }">{{ getCategoryTotal(item.key) }}家</span>
              <span :style="{ color: '#c0c4cc', fontSize: '10px', transform: expandedLegendCategory === item.key ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }">▶</span>
            </div>
            <div v-if="expandedLegendCategory === item.key" :style="{ padding: '2px 0 6px 22px' }">
              <div
                v-for="(count, city) in competitionCityStats[item.key] || {}"
                :key="city"
                :style="{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 6px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', color: '#606266' }"
                @mouseover="$event.currentTarget.style.background = '#f5f7fa'"
                @mouseout="$event.currentTarget.style.background = 'transparent'"
                @click="locateCompetitionCity(item.key, city)"
              >
                <el-icon style="font-size:12px;color:#409eff;"><Location /></el-icon>
                <span>{{ city }}</span>
                <span :style="{ marginLeft: 'auto', color: '#909399' }">{{ count }}家</span>
                <el-icon style="font-size:11px;color:#c0c4cc;"><ArrowRight /></el-icon>
              </div>
              <div v-if="Object.keys(competitionCityStats[item.key] || {}).length === 0" :style="{ fontSize: '12px', color: '#c0c4cc', padding: '2px 0' }">暂无</div>
            </div>
          </div>
        </template>
        <template v-else>
          <!-- 相互蚕食（重叠度）模式：可折叠展开门店列表，支持复制 -->
          <div v-for="(item, idx) in storeCircleLegendItems" :key="idx">
            <div
              :style="{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', cursor: 'pointer', userSelect: 'none' }"
              @click="toggleLegendCategory(item.key)"
            >
              <span
                :style="{
                  background: item.color,
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  flexShrink: 0,
                  border: '1px solid rgba(0,0,0,0.1)',
                  display: 'inline-block'
                }"
              ></span>
              <span :style="{ color: '#555', fontSize: '12px', lineHeight: 1.6 }">{{ item.label }}</span>
              <span :style="{ marginLeft: 'auto', color: '#909399', fontSize: '11px' }">{{ item.count !== undefined ? item.count + '格' : (item.stores ? item.stores.length : 0) + '家' }}</span>
              <span :style="{ color: '#c0c4cc', fontSize: '10px', transform: expandedLegendCategory === item.key ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }">▶</span>
            </div>
            <div v-if="expandedLegendCategory === item.key" :style="{ padding: '2px 0 6px 22px' }">
              <div :style="{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }">
                <span :style="{ fontSize: '11px', color: '#909399' }">门店列表（{{ (item.stores || []).length }}家）</span>
                <el-button link size="small" type="primary" :style="{ fontSize: '11px' }" @click="copyOverlapStores(item)">
                  <el-icon style="margin-right:2px;"><CopyDocument /></el-icon>复制
                </el-button>
              </div>
              <div
                v-for="(sname, si) in item.stores"
                :key="si"
                :style="{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0', fontSize: '12px', color: '#606266' }"
              >
                <span :style="{ width: '4px', height: '4px', borderRadius: '50%', background: item.color, flexShrink: 0 }"></span>
                <span :style="{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }">{{ sname }}</span>
              </div>
              <div v-if="!item.stores || item.stores.length === 0" :style="{ fontSize: '12px', color: '#c0c4cc', padding: '2px 0' }">暂无</div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 定位门店面板（4种门店类型，可拖拽） -->
    <div v-if="storeSearchVisible" class="store-search-panel" :style="{ top: searchPanelPos.top + 'px', right: searchPanelPos.right + 'px' }">
      <div class="store-search-header" @mousedown="onDragStart">
        <span class="store-search-title">
          <el-icon><Search /></el-icon>
          定位门店
        </span>
        <el-button link @click="storeSearchVisible = false">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
      <div class="store-search-input-wrap">
        <el-input
          v-model="storeSearchKeyword"
          placeholder="输入名称、地址、品牌关键词…"
          clearable
          @input="onStoreSearch"
          @clear="onStoreSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
      </div>
      <el-tabs v-model="searchTabActive" class="store-search-tabs">
        <el-tab-pane label="我的门店" name="marker">
          <div class="store-search-filters">
            <el-select v-model="markerFilterStoreType" placeholder="门店类型" style="width:90px" size="small" clearable @change="onStoreSearch">
              <el-option label="已开业" value="已开业" /><el-option label="重点候选" value="重点候选" /><el-option label="一般候选" value="一般候选" />
            </el-select>
            <el-select v-model="markerFilterCity" placeholder="城市" style="width:100px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="c in markerCityList" :key="c" :label="c" :value="c" />
            </el-select>
            <el-select v-model="markerFilterDistrict" placeholder="区县" style="width:100px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="d in markerDistrictList" :key="d" :label="d" :value="d" />
            </el-select>
            <el-select v-model="markerFilterBrand" placeholder="品牌" style="width:90px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="b in markerBrandList" :key="b" :label="b" :value="b" />
            </el-select>
            <el-select v-model="markerFilterStoreStatus" placeholder="状态" style="width:80px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="s in markerStoreStatusList" :key="s" :label="s" :value="s" />
            </el-select>
          </div>
          <div class="store-search-list">
            <div v-if="locateResults.marker.length === 0" class="store-search-empty">{{ storeSearchKeyword ? '未找到相关门店' : '请输入关键词搜索' }}</div>
            <div v-for="s in locateResults.marker" :key="'m'+s.id" class="store-search-item" @click="locateStore(s, 'marker')">
              <div class="store-search-name">{{ s.name }}</div>
              <div class="store-search-sub"><span v-if="s.brand">{{ s.brand }}</span><span v-if="s.city">{{ s.city }}</span><span v-if="s.district">{{ s.district }}</span></div>
              <div v-if="s.address" class="store-search-addr">{{ s.address }}</div>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="竞品门店" name="competitor">
          <div class="store-search-filters">
            <el-select v-model="compFilterCity" placeholder="城市" style="width:120px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="c in compCityList" :key="c" :label="c" :value="c" />
            </el-select>
            <el-select v-model="compFilterDistrict" placeholder="区县" style="width:120px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="d in compDistrictList" :key="d" :label="d" :value="d" />
            </el-select>
            <el-select v-model="compFilterBrand" placeholder="品牌" style="width:100px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="b in compBrandList" :key="b" :label="b" :value="b" />
            </el-select>
            <el-select v-model="compFilterReviews" placeholder="评论数" style="width:100px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="r in reviewRangeOptions" :key="r.value" :label="r.label" :value="r.value" />
            </el-select>
          </div>
          <div class="store-search-list">
            <div v-if="locateResults.competitor.length === 0" class="store-search-empty">{{ storeSearchKeyword ? '未找到相关门店' : '请输入关键词搜索' }}</div>
            <div v-for="s in locateResults.competitor" :key="'c'+s.id" class="store-search-item" @click="locateStore(s, 'competitor')">
              <div class="store-search-name">{{ s.name }}</div>
              <div class="store-search-sub"><span v-if="s.brand">{{ s.brand }}</span><span v-if="s.city">{{ s.city }}</span><span v-if="s.district">{{ s.district }}</span></div>
              <div v-if="s.address" class="store-search-addr">{{ s.address }}</div>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="品牌门店" name="brand">
          <div class="store-search-filters">
            <el-select v-model="brandFilterCity" placeholder="城市" style="width:120px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="c in brandCityList" :key="c" :label="c" :value="c" />
            </el-select>
            <el-select v-model="brandFilterDistrict" placeholder="区县" style="width:120px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="d in brandDistrictList" :key="d" :label="d" :value="d" />
            </el-select>
            <el-select v-model="brandFilterBrand" placeholder="品牌" style="width:100px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="b in brandBrandList" :key="b" :label="b" :value="b" />
            </el-select>
          </div>
          <div class="store-search-list">
            <div v-if="locateResults.brand.length === 0" class="store-search-empty">{{ storeSearchKeyword ? '未找到相关门店' : '请输入关键词搜索' }}</div>
            <div v-for="s in locateResults.brand" :key="'b'+s.id" class="store-search-item" @click="locateStore(s, 'brand')">
              <div class="store-search-name">{{ s.name }}</div>
              <div class="store-search-sub"><span v-if="s.brand">{{ s.brand }}</span><span v-if="s.city">{{ s.city }}</span><span v-if="s.district">{{ s.district }}</span></div>
              <div v-if="s.address" class="store-search-addr">{{ s.address }}</div>
            </div>
          </div>
        </el-tab-pane>
        <el-tab-pane label="购物中心" name="shopping">
          <div class="store-search-filters">
            <el-select v-model="shopFilterCity" placeholder="城市" style="width:140px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="c in shopCityList" :key="c" :label="c" :value="c" />
            </el-select>
            <el-select v-model="shopFilterDistrict" placeholder="区县" style="width:140px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="d in shopDistrictList" :key="d" :label="d" :value="d" />
            </el-select>
            <el-select v-model="shopFilterReviews" placeholder="评论数" style="width:100px" size="small" clearable @change="onStoreSearch">
              <el-option v-for="r in reviewRangeOptions" :key="r.value" :label="r.label" :value="r.value" />
            </el-select>
          </div>
          <div class="store-search-list">
            <div v-if="locateResults.shopping.length === 0" class="store-search-empty">{{ storeSearchKeyword ? '未找到相关门店' : '请输入关键词搜索' }}</div>
            <div v-for="s in locateResults.shopping" :key="'s'+s.id" class="store-search-item" @click="locateStore(s, 'shopping')">
              <div class="store-search-name">{{ s.name }}</div>
              <div class="store-search-sub"><span v-if="s.city">{{ s.city }}</span><span v-if="s.district">{{ s.district }}</span></div>
              <div v-if="s.address" class="store-search-addr">{{ s.address }}</div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 查询行政界面板（可拖拽，样式同定位门店） -->
    <div v-if="districtVisible" class="store-search-panel" :style="{ top: searchPanelPos.top + 'px', right: searchPanelPos.right + 'px' }">
      <div class="store-search-header" @mousedown="onDragStart">
        <span class="store-search-title">
          <el-icon><Flag /></el-icon>
          查询行政界
        </span>
        <el-button link @click="districtVisible = false">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
      <div class="store-search-input-wrap">
        <el-input
          v-model="districtKeyword"
          placeholder="输入城市或区县名称（如 上海）"
          clearable
          @keyup.enter="searchDistrict"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button type="primary" :loading="districtLoading" @click="searchDistrict" style="margin-top:8px; width:100%">
          查询边界
        </el-button>
      </div>
      <div class="store-search-list">
        <div v-if="districtResult" class="district-info">
          <div class="district-info-header">
            <el-icon><Flag /></el-icon>
            <strong>{{ districtResult.cityName ? districtResult.cityName + districtResult.name : districtResult.name }}</strong>
            <span v-if="!districtResult.cityName" class="district-level-tag">{{ districtResult.level === 'city' ? '市' : districtResult.level === 'district' ? '区' : '省' }}</span>
          </div>
          <div class="district-info-meta">
            行政面积: {{ districtResult.area || '-' }} 平方公里
          </div>
          <div v-if="districtStoreCounts" class="district-store-counts">
            <div class="district-count-row">
              <span class="district-count-label">我的门店：</span>
              <span class="district-count-num">{{ districtStoreCounts.myStores.total }}家<template v-if="districtStoreCounts.myStores.closed > 0">（其中停业：{{ districtStoreCounts.myStores.closed }}家）</template></span>
            </div>
            <div class="district-count-row">
              <span class="district-count-label">竞品门店：</span>
              <span class="district-count-num">{{ Object.values(districtStoreCounts.competitors).reduce((a, b) => a + b, 0) }}家</span>
            </div>
            <div v-for="(count, brand) in districtStoreCounts.competitors" :key="brand" class="district-count-row district-count-sub">
              <span class="district-count-label">&nbsp;&nbsp;* {{ brand }}</span>
              <span class="district-count-num">{{ count }}家</span>
            </div>
            <div class="district-count-row">
              <span class="district-count-label">购物中心：</span>
              <span class="district-count-num">{{ districtStoreCounts.shoppingCenters }}家</span>
            </div>
          </div>
        </div>
        <div v-if="districtResult && districtResult.boundaries.length > 0" class="district-actions-row">
          <el-button size="small" type="danger" plain @click="clearDistrictBoundary" style="flex:1">清除边界</el-button>
        </div>
        <div v-if="districtError" class="district-error">{{ districtError }}</div>
      </div>
    </div>

    <!-- 按商圈查询面板 -->
    <div v-if="commerceVisible" class="store-search-panel" :style="{ top: searchPanelPos.top + 'px', right: searchPanelPos.right + 'px' }">
      <div class="store-search-header" @mousedown="onDragStart">
        <span class="store-search-title">
          <el-icon><Shop /></el-icon>
          按商圈查询
        </span>
        <el-button link @click="commerceVisible = false">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
      <div class="store-search-input-wrap">
        <el-input
          v-model="commerceKeyword"
          placeholder="输入商圈名称（如 徐家汇）"
          clearable
          @keyup.enter="searchCommerce"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button type="primary" :loading="commerceLoading" @click="searchCommerce" style="margin-top:8px; width:100%">
          查询
        </el-button>
      </div>
      <div class="store-search-list">
        <!-- 查询结果 -->
        <div v-if="commerceResult" class="district-info">
          <div class="district-info-header">
            <el-icon><Shop /></el-icon>
            <strong>{{ commerceResult.keyword }}</strong>
            <span class="commerce-match-count">匹配 {{ commerceResult.total }} 个</span>
          </div>
          <!-- 面积 -->
          <div v-if="commerceArea" class="district-info-meta">
            面积: {{ commerceArea }} 平方公里
          </div>
          <!-- 门店统计 -->
          <div v-if="commerceStoreCounts" class="district-store-counts">
            <div class="district-count-row">
              <span class="district-count-label">我的门店：</span>
              <span class="district-count-num">{{ commerceStoreCounts.myStores.total }}家
                <template v-if="commerceStoreCounts.myStores.closed > 0">
                  （其中停业：{{ commerceStoreCounts.myStores.closed }}家）
                </template>
              </span>
            </div>
            <div class="district-count-row">
              <span class="district-count-label">竞品门店：</span>
              <span class="district-count-num">{{ Object.values(commerceStoreCounts.competitors).reduce((a, b) => a + b, 0) }}家</span>
            </div>
            <div v-for="(count, brand) in commerceStoreCounts.competitors" :key="brand" class="district-count-row district-count-sub">
              <span class="district-count-label">&nbsp;&nbsp;* {{ brand }}</span>
              <span class="district-count-num">{{ count }}家</span>
            </div>
            <div class="district-count-row">
              <span class="district-count-label">购物中心：</span>
              <span class="district-count-num">{{ commerceStoreCounts.shoppingCenters }}家</span>
            </div>
          </div>
        </div>
        <div v-if="commerceNoResult" class="district-error">未找到匹配的商圈</div>
        <!-- 清除图层按钮 -->
        <div v-if="commerceLayerItems.length > 0" class="district-actions-row">
          <el-button size="small" type="danger" plain @click="clearCommerceLayer" style="flex:1">清除图层</el-button>
        </div>
        <div v-if="commerceError" class="district-error">{{ commerceError }}</div>
      </div>
    </div>


    <!-- 开店余地对话框 -->
    <el-dialog v-model="potentialVisible" width="600px" class="dialog-fancy" :close-on-click-modal="false" draggable @opened="loadPotentialCities">
      <template #header>
        <div class="dialog-header-fancy">
          <span class="dhf-icon" style="background:#faeeda;">🗺️</span>
          <div>
            <div class="dhf-title">开店余地分析</div>
            <div class="dhf-sub">按门店 / 竞品 / 人口条件筛选区域</div>
          </div>
        </div>
      </template>
      <el-form label-width="120px">
        <el-form-item label="选择城市">
          <el-select v-model="potentialCity" placeholder="请选择城市" style="width:100%" filterable>
            <el-option-group v-for="group in groupedPotentialCities" :key="group.letter" :label="group.letter">
              <el-option v-for="c in group.cities" :key="c" :label="c" :value="c" />
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item label="半径(km)">
          <el-input-number v-model="potentialRadius" :min="0.1" :max="10" :step="0.1" :controls="false" style="width:100%" />
        </el-form-item>
        <el-form-item label="我的门店数">
          <div style="display:flex;gap:8px;width:100%">
            <el-select v-model="potentialMyStoreOp" placeholder="运算符" style="width:78px;flex-shrink:0">
              <el-option label=">" value=">" />
              <el-option label=">=" value=">=" />
              <el-option label="<" value="<" />
              <el-option label="<=" value="<=" />
              <el-option label="=" value="=" />
            </el-select>
            <el-input v-model="potentialMyStoreVal" type="number" placeholder="数量" style="flex:1;min-width:0" />
            <el-select v-model="potentialMyBrands" multiple collapse-tags collapse-tags-tooltip placeholder="品牌(可多选)" style="width:130px;flex-shrink:0" clearable>
              <el-option v-for="b in potentialMyBrandOptions" :key="b" :label="b" :value="b" />
            </el-select>
          </div>
        </el-form-item>
        <el-form-item label="竞品门店数">
          <div style="display:flex;gap:8px;width:100%">
            <el-select v-model="potentialCompOp" placeholder="运算符" style="width:78px;flex-shrink:0">
              <el-option label=">" value=">" />
              <el-option label=">=" value=">=" />
              <el-option label="<" value="<" />
              <el-option label="<=" value="<=" />
              <el-option label="=" value="=" />
            </el-select>
            <el-input v-model="potentialCompVal" type="number" placeholder="数量" style="flex:1;min-width:0" />
            <el-select v-model="potentialCompBrands" multiple collapse-tags collapse-tags-tooltip placeholder="品牌(可多选)" style="width:130px;flex-shrink:0" clearable>
              <el-option v-for="b in potentialCompBrandOptions" :key="b" :label="b" :value="b" />
            </el-select>
          </div>
        </el-form-item>
        <el-form-item label="其他品牌1">
          <div style="display:flex;gap:8px;width:100%">
            <el-input v-model="potentialOther1Name" placeholder="品牌名(如肯德基)" clearable style="flex:1;min-width:0" />
            <el-select v-model="potentialOther1Op" placeholder="运算符" style="width:78px;flex-shrink:0">
              <el-option label=">" value=">" />
              <el-option label=">=" value=">=" />
              <el-option label="<" value="<" />
              <el-option label="<=" value="<=" />
              <el-option label="=" value="=" />
            </el-select>
            <el-input v-model="potentialOther1Val" type="number" placeholder="数量" style="width:70px;flex-shrink:0" />
          </div>
        </el-form-item>
        <el-form-item label="其他品牌2">
          <div style="display:flex;gap:8px;width:100%">
            <el-input v-model="potentialOther2Name" placeholder="品牌名(如麦当劳)" clearable style="flex:1;min-width:0" />
            <el-select v-model="potentialOther2Op" placeholder="运算符" style="width:78px;flex-shrink:0">
              <el-option label=">" value=">" />
              <el-option label=">=" value=">=" />
              <el-option label="<" value="<" />
              <el-option label="<=" value="<=" />
              <el-option label="=" value="=" />
            </el-select>
            <el-input v-model="potentialOther2Val" type="number" placeholder="数量" style="width:70px;flex-shrink:0" />
          </div>
        </el-form-item>
        <el-form-item label="人口数量1">
          <div style="display:flex;gap:8px;width:100%">
            <el-select v-model="potentialCond1Field" placeholder="字段" style="flex:1;min-width:0" @change="onPotentialFieldChange(1)" @click="loadPotentialFields">
              <el-option v-for="f in potentialNumericFields" :key="f" :label="f" :value="f" />
            </el-select>
            <el-select v-model="potentialCond1Op" placeholder="运算符" style="width:78px;flex-shrink:0">
              <el-option label=">" value=">" />
              <el-option label=">=" value=">=" />
              <el-option label="<" value="<" />
              <el-option label="<=" value="<=" />
              <el-option label="=" value="=" />
            </el-select>
            <el-input v-model="potentialCond1Val" type="number" placeholder="值" style="flex:1;min-width:0" />
          </div>
        </el-form-item>
                <el-form-item label="人口数量2">
          <div style="display:flex;gap:8px;width:100%">
            <el-select v-model="potentialCond2Field" placeholder="字段" style="flex:1;min-width:0" clearable @click="loadPotentialFields">
              <el-option v-for="f in potentialNumericFields" :key="f" :label="f" :value="f" />
            </el-select>
            <el-select v-model="potentialCond2Op" placeholder="运算符" style="width:78px;flex-shrink:0" :disabled="!potentialCond2Field">
              <el-option label=">" value=">" />
              <el-option label=">=" value=">=" />
              <el-option label="<" value="<" />
              <el-option label="<=" value="<=" />
              <el-option label="=" value="=" />
            </el-select>
            <el-input v-model="potentialCond2Val" type="number" placeholder="值" style="flex:1;min-width:0" :disabled="!potentialCond2Field" />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="potentialVisible = false">取消</el-button>
        <el-button type="primary" :loading="potentialLoading" @click="calculatePotential">开始分析</el-button>
      </template>
    </el-dialog>
    
    <!-- 地图容器 -->
    <div id="map" class="map-container" />

    <!-- 地图加载骨架屏 -->
    <div v-if="mapLoading" class="map-loading-overlay">
      <div class="map-loading-content">
        <div class="map-loading-spinner"></div>
        <div class="map-loading-text">地图加载中...</div>
        <div class="map-loading-skeleton">
          <div class="skeleton-bar skeleton-bar-1"></div>
          <div class="skeleton-bar skeleton-bar-2"></div>
          <div class="skeleton-bar skeleton-bar-3"></div>
        </div>
      </div>
    </div>

    <!-- 坐标显示 -->
    <div class="coordinate-display">
      <span v-if="currentCityName" class="city-name">
        <el-icon><Location /></el-icon>
        {{ currentCityName }}
      </span>
      <span v-if="currentCoords">
        &nbsp;|&nbsp;经度: {{ currentCoords.lng.toFixed(6) }}&nbsp;&nbsp;
        纬度: {{ currentCoords.lat.toFixed(6) }}
      </span>
    </div>

    <!-- 图层控制面板 - 右下角 -->
    <div class="layer-switcher">
      <div class="layer-switcher-title">图层</div>
      <div class="layer-options">
        <div
          class="layer-option"
          :class="{ active: baseMapType === 'vec' }"
          @click="baseMapType = 'vec'"
        >
          <img src="/高德地图.jpeg" alt="高德" style="filter:grayscale(1);" />
          <span>黑白</span>
        </div>
        <div
          class="layer-option"
          :class="{ active: baseMapType === 'tencent' }"
          @click="baseMapType = 'tencent'"
        >
          <img src="/腾讯地图.jpeg" alt="腾讯" />
          <span>标准</span>
        </div>
        <div
          class="layer-option"
          :class="{ active: baseMapType === 'img' }"
          @click="baseMapType = 'img'"
        >
          <img src="/影像地图.jpeg" alt="影像" />
          <span>影像</span>
        </div>
      </div>
    </div>

    <!-- AI 助手 -->
    <AiAssistant
      ref="aiAssistantRef"
      :context="aiContext"
      @execute="handleAiExecute"
    />

    <!-- POI搜索结果 -->
    <PoiResultPanel
      :visible="poiResultVisible"
      :pois="poiResults"
      :map="map"
      @close="closePoiResults"
    />

    <!-- 智慧足迹面板 -->
    <SmartstepsPanel
      :visible="smartstepsVisible"
      :map="map"
      @update:visible="smartstepsVisible = $event"
    />

    <!-- 门店联通人口对话框 -->
    <StoreSmartstepsDialog
      :visible="storeSmartstepsVisible"
      :store="selectedStoreForSmartsteps"
      @update:visible="storeSmartstepsVisible = $event"
    />

    <!-- 相似店对话框（从门店弹窗进入，基准门店固定） -->
    <el-dialog v-model="storeSimilarVisible" width="760px" class="dialog-fancy" draggable :show-close="true" @close="resetStoreSimilarDialog">
      <template #header>
        <div class="dialog-header-fancy">
          <span class="dhf-icon" style="background:#eeedfe;">🔍</span>
          <div>
            <div class="dhf-title">相似店</div>
            <div class="dhf-sub">同商圈同类型的相似门店</div>
          </div>
        </div>
      </template>
      <template v-if="!storeSimilarDone">
        <div style="margin-bottom: 14px; padding: 10px 14px; background: #f5f7fa; border-radius: 6px; font-size: 13px; color: #666;">
          基准门店：<b style="color: #e64545;">{{ storeSimilarBaseName }}</b>
        </div>
        <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 13px; color: #666;">分析半径：</span>
          <el-select v-model="storeSimilarRadius" placeholder="请选择分析半径" style="width: 180px;">
            <el-option v-for="r in storeSimilarRadiusOptions" :key="r" :label="r + '公里'" :value="r" />
          </el-select>
          <span style="font-size: 12px; color: #999;">从购买履历中读取</span>
        </div>
        <div v-if="storeSimilarLoading" style="text-align: center; padding: 30px;">
          <el-icon class="is-loading" style="font-size: 28px;"><Loading /></el-icon>
          <p style="margin-top: 10px; color: #666;">正在寻找相似门店...</p>
        </div>
      </template>

      <template v-if="storeSimilarDone">
        <div style="max-height: 480px; overflow-y: auto;">
          <div v-if="storeSimilarResults.length === 0" style="text-align:center;padding:40px;color:#999;">
            未找到相似门店
          </div>
          <div v-else>
            <div style="margin-bottom: 12px; padding: 10px 14px; background: #f5f7fa; border-radius: 6px; font-size: 13px; color: #666;">
              基准门店：<b style="color: #e64545;">{{ storeSimilarBaseName }}</b>（半径 {{ storeSimilarRadius }} 公里），共 {{ storeSimilarResults.length }} 家相似门店
            </div>
            <div v-for="(r, rIdx) in storeSimilarResults" :key="r.name"
              style="display: flex; align-items: center; padding: 10px 14px; border-bottom: 1px solid #f0f0f0;"
              :style="{ background: rIdx === 0 ? '#fdf6ec' : 'white' }">
              <span style="width: 28px; font-size: 15px; font-weight: bold; color: #e64545;">{{ rIdx + 1 }}</span>
              <div style="flex: 1;">
                <div style="font-size: 14px; font-weight: 500;">{{ r.name }}</div>
                <div style="font-size: 12px; color: #999;">
                  到访 {{ (r.visit || 0).toLocaleString() }} · 居住 {{ (r.live || 0).toLocaleString() }} · 工作 {{ (r.work || 0).toLocaleString() }}
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 16px; font-weight: bold; color: #e64545;">{{ r.similarity }}%</div>
                <div style="font-size: 11px; color: #999;">相似度</div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <el-button @click="storeSimilarVisible = false">关闭</el-button>
        <el-button v-if="!storeSimilarDone" type="primary" :disabled="!storeSimilarRadius || storeSimilarLoading" :loading="storeSimilarLoading" @click="startStoreSimilarFromMap">寻找</el-button>
        <el-button v-if="storeSimilarDone" @click="resetStoreSimilarDialog">重新选择</el-button>
      </template>
    </el-dialog>

    <!-- POI位置选择提示 -->
    <div v-if="poiPickLocationMode" class="poi-pick-location-overlay">
      <div class="poi-pick-location-hint">
        <el-icon><LocationFilled /></el-icon>
        <span>请在地图上点击选择搜索中心点</span>
        <el-button size="small" text @click="cancelPoiPickLocation">取消</el-button>
      </div>
    </div>

    <!-- 环境打分卡选点提示 -->
    <div v-if="envScorePickMode" class="poi-pick-location-overlay">
      <div class="poi-pick-location-hint">
        <el-icon><Star /></el-icon>
        <span>请在地图上点击要评估的位置</span>
        <el-button size="small" text @click="cancelEnvScorePick">取消</el-button>
      </div>
    </div>

    <!-- 地图右键菜单 -->
    <div v-if="contextMenu.visible" class="map-context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @click.stop>
      <div class="map-context-menu-item" @click="contextMenuAction('addstore')">
        <el-icon><Location /></el-icon>
        <span>添加门店</span>
      </div>
      <div class="map-context-menu-item" @click="contextMenuAction('locate')">
        <el-icon><Search /></el-icon>
        <span>定位门店</span>
      </div>
      <div class="map-context-menu-divider"></div>
      <div class="map-context-menu-item" @click="contextMenuAction('clear')">
        <el-icon><Delete /></el-icon>
        <span>清除绘制</span>
      </div>
      <div class="map-context-menu-item" @click="contextMenuAction('circle')">
        <el-icon><Coordinate /></el-icon>
        <span>商圈内点位</span>
      </div>
      <div class="map-context-menu-item" @click="contextMenuAction('envscore')">
        <el-icon><Star /></el-icon>
        <span>周边商业配套</span>
      </div>
      <div class="map-context-menu-item" @click="contextMenuAction('population')">
        <el-icon><DataAnalysis /></el-icon>
        <span>常住人口分布</span>
      </div>
      <div class="map-context-menu-item" @click="contextMenuAction('smartsteps')">
        <el-icon><DataAnalysis /></el-icon>
        <span>联通人口</span>
      </div>
      <div class="map-context-menu-divider"></div>
      <div class="map-context-menu-item" @click="contextMenuAction('lockmap')">
        <el-icon><Lock v-if="!mapLocked" /><Unlock v-else /></el-icon>
        <span>{{ mapLocked ? '🔓 解锁地图（图标可移动）' : '🔒 锁定地图（拖动不误触图标）' }}</span>
      </div>
    </div>

    <!-- 周边环境打分卡弹窗 -->
    <el-dialog v-model="envScoreDialogVisible" width="560px" class="dialog-fancy" :close-on-click-modal="false" draggable @closed="clearEnvScoreLayer">
      <template #header>
        <div class="dialog-header-fancy">
          <span class="dhf-icon" style="background:#e6f1fb;">🏙️</span>
          <div>
            <div class="dhf-title">周边环境打分卡</div>
            <div class="dhf-sub">8 类商业配套 · 高德 POI 免费评估</div>
          </div>
        </div>
      </template>
      <div v-if="envScoreLoading" style="text-align:center;padding:40px;color:#909399;">
        <el-icon class="is-loading"><Loading /></el-icon>
        <p style="margin-top:8px;">正在评估周边环境...</p>
      </div>
      <template v-else-if="envScoreData">
        <!-- 综合分 -->
        <div style="display:flex;align-items:center;gap:16px;padding:14px;background:#f5f7fa;border-radius:8px;margin-bottom:14px;">
          <div style="text-align:center;flex-shrink:0;">
            <div style="font-size:32px;font-weight:600;color:#409eff;line-height:1;">{{ envScoreTotal.toFixed(1) }}</div>
            <div style="font-size:11px;color:#909399;margin-top:4px;">综合分 / 5.0</div>
          </div>
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:600;color:#333;">{{ envScoreLevel }}</div>
            <div style="font-size:12px;color:#909399;margin-top:4px;">
              位置：{{ envScorePoint?.lat?.toFixed(5) }}, {{ envScorePoint?.lng?.toFixed(5) }} · 半径 {{ envScoreRadius }}m
            </div>
          </div>
          <el-radio-group v-model="envScoreRadius" size="small" @change="fetchEnvScore">
            <el-radio-button :value="500">500m</el-radio-button>
            <el-radio-button :value="1000">1km</el-radio-button>
            <el-radio-button :value="2000">2km</el-radio-button>
          </el-radio-group>
        </div>
        <!-- 8 项指标 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div v-for="item in envScoreItems" :key="item.key" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fafafa;border:0.5px solid #ebeef5;border-radius:6px;">
            <span style="width:52px;font-size:12px;color:#606266;flex-shrink:0;">{{ item.label }}</span>
            <span style="color:#ba7517;font-size:13px;letter-spacing:1px;white-space:nowrap;">{{ '★'.repeat(item.stars) }}<span style="color:#ddd;">{{ '★'.repeat(5 - item.stars) }}</span></span>
            <span style="margin-left:auto;font-size:12px;color:#909399;">{{ item.count }}个</span>
          </div>
        </div>
        <div style="font-size:11px;color:#c0c4cc;margin-top:10px;">数据来源：高德地图 POI · 免费 · 已缓存 24h</div>
      </template>
      <template v-else>
        <div style="text-align:center;padding:30px;color:#999;">暂无数据</div>
      </template>
    </el-dialog>

    <!-- 缩放控件容器 -->
    <div class="zoom-control-container">
      <div class="zoom-in" @click="zoomIn">+</div>
      <div class="zoom-line"></div>
      <div class="zoom-out" @click="zoomOut">−</div>
    </div>

    <!-- 添加/编辑门店对话框 -->
    <el-dialog
      v-model="markerDialogVisible"
      :title="editingMarker ? '编辑门店' : '添加门店'"
      width="700px"
      draggable :show-close="true"
      @close="onMarkerDialogClose"
    >
      <el-form ref="markerFormRef" :model="markerForm" :rules="markerRules" label-width="90px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="门店编号" prop="store_code">
              <el-input v-model="markerForm.store_code" placeholder="如: BJ001" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="品牌" prop="brand">
              <el-input v-model="markerForm.brand" placeholder="品牌名称" />
            </el-form-item>
          </el-col>
        </el-row>
        
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="门店名称" prop="name">
              <el-input v-model="markerForm.name" placeholder="门店名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="门店类型" prop="store_type">
              <el-select v-model="markerForm.store_type" placeholder="请选择" style="width: 100%">
                <el-option label="已开业" value="已开业" />
                <el-option label="重点候选" value="重点候选" />
                <el-option label="一般候选" value="一般候选" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">地址信息</el-divider>
        
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="城市" prop="city">
              <el-input v-model="markerForm.city" placeholder="如: 北京市" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="区县" prop="district">
              <el-input v-model="markerForm.district" placeholder="如: 朝阳区" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="地址" prop="address">
          <el-input v-model="markerForm.address" placeholder="详细地址" />
        </el-form-item>

        <el-divider content-position="left">经营信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="开店日期" prop="open_date">
              <el-input v-model="markerForm.open_date" placeholder="如: 2024-01-01" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="营业时间" prop="business_hours">
              <el-input v-model="markerForm.business_hours" placeholder="如: 08:00-22:00" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="面积(㎡)" prop="store_area">
              <el-input-number v-model="markerForm.store_area" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="座位数" prop="seats">
              <el-input-number v-model="markerForm.seats" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="门幅面积" prop="frontage">
              <el-input-number v-model="markerForm.frontage" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="门店区分" prop="store_category">
              <el-select v-model="markerForm.store_category" placeholder="请选择" style="width: 100%">
                <el-option v-for="c in markerStore.storeCategories" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="门店状态" prop="store_status">
              <el-input v-model="markerForm.store_status" placeholder="门店状态" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="商场类型" prop="mall_type">
              <el-input v-model="markerForm.mall_type" placeholder="商场类型" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="商圈类型" prop="trade_area_type">
              <el-input v-model="markerForm.trade_area_type" placeholder="商圈类型" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="坐标">
          <el-input :model-value="`${markerForm.latitude?.toFixed(6)}, ${markerForm.longitude?.toFixed(6)}`" disabled />
        </el-form-item>

        <el-form-item label="备注" prop="description">
          <el-input v-model="markerForm.description" type="textarea" :rows="2" placeholder="备注信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="markerDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveMarker">确定</el-button>
      </template>
    </el-dialog>

    <!-- 绘制圆形对话框 -->
    <el-dialog
      v-model="circleDialogVisible"
      :title="circleDialogMode === 'population' ? '商圈人口分布' : '设置圆形半径'"
      :width="circleDialogWidth"
      :show-close="true"
      draggable
      @close="closeCircleDialog"
    >
      <el-form :model="circleForm" label-width="80px">
        <el-form-item label="圆心坐标">
          <el-input v-model="circleForm.centerText" disabled />
        </el-form-item>
        <el-form-item label="半径1">
          <el-input-number
            v-model="circleForm.radius"
            :min="1"
            :max="50000"
            style="width: 100%;"
            placeholder="第一圈半径"
          />
        </el-form-item>
        <el-form-item label="半径2">
          <el-input-number
            v-model="circleForm.radius2"
            :min="1"
            :max="50000"
            style="width: 100%;"
            placeholder="留空则不显示"
            clearable
          />
        </el-form-item>
        <el-form-item label="半径3">
          <el-input-number
            v-model="circleForm.radius3"
            :min="1"
            :max="50000"
            style="width: 100%;"
            placeholder="留空则不显示"
            clearable
          />
        </el-form-item>
        <el-form-item label="单位">
          <el-radio-group v-model="circleForm.unit">
            <el-radio value="km" checked>公里</el-radio>
            <el-radio value="m">米</el-radio>
          </el-radio-group>
        </el-form-item>
        <!-- 统计字段选择（仅商圈人口分布模式显示） -->
        <el-form-item v-if="circleDialogMode === 'population'" label="统计字段">
          <el-select
            v-model="selectedPopulationField"
            placeholder="选择统计字段"
            style="width: 100%;"
            :disabled="populationFieldOptions.length === 0"
          >
            <el-option
              v-for="field in populationFieldOptions"
              :key="field"
              :label="field"
              :value="field"
            />
          </el-select>
          <div v-if="populationFieldOptions.length === 0" style="font-size: 12px; color: #999; margin-top: 4px;">
            {{ populationFieldLoading ? `正在扫描数据文件... (已用 ${loadingElapsedSeconds} 秒)` : '正在扫描数据文件...' }}
          </div>
        </el-form-item>
        <!-- 色块方案选择（仅商圈人口分布模式显示） -->
        <el-form-item v-if="circleDialogMode === 'population'" label="设置色块">
          <el-select v-model="populationColorScheme" placeholder="选择色块方案" style="width: 100%;">
            <el-option
              v-for="(scheme, key) in POPULATION_COLOR_SCHEMES"
              :key="key"
              :label="scheme.name"
              :value="key"
            >
              <span style="display:flex;align-items:center;gap:8px;">
                <span>{{ scheme.name }}</span>
                <span style="display:inline-flex;gap:2px;margin-left:auto;">
                  <span v-for="(c, ci) in scheme.colors" :key="ci"
                    :style="{ display:'inline-block', width:'14px', height:'14px', borderRadius:'2px', background:c, flexShrink:0 }"
                  ></span>
                </span>
              </span>
            </el-option>
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeCircleDialog">取消</el-button>
        <el-button type="primary" @click="circleDialogMode === 'population' ? analyzePopulationDistribution() : analyzeCircleStores()">
          {{ circleDialogMode === 'population' ? '分析' : '确定' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 圆形内门店分析结果对话框 -->
    <el-dialog
      v-model="circleAnalysisVisible"
      :title="circleAnalysisTitle"
      width="600px" :show-close="true"
    >
      <div v-if="circleAnalysisData.myStores.length === 0 && circleAnalysisData.competitorStores.length === 0" class="analysis-empty">
        <el-empty description="圆形范围内没有门店" />
      </div>
      <div v-else class="analysis-content">
        <div v-if="circleAnalysisData.myStores.length > 0" class="analysis-section">
          <div class="analysis-section-title">
            <el-icon><Location /></el-icon>
            我的门店
            <template v-if="circleAnalysisData.myStoresByRadius.length > 1">
              <span v-for="(item, idx) in circleAnalysisData.myStoresByRadius" :key="idx" style="margin-left:4px;">
                <el-tag size="small">{{ item.radius }}{{ item.unit === 'km' ? 'km' : 'm' }}:{{ item.count }}家</el-tag>
              </span>
            </template>
            <template v-else>
              ({{ circleAnalysisData.myStores.length }}家)
            </template>
          </div>
          <el-table :data="circleAnalysisData.myStores" size="small" max-height="200">
            <el-table-column prop="name" label="门店名称" />
            <el-table-column prop="brand" label="品牌" />
            <el-table-column prop="distance" label="到圆心距离" width="120">
              <template #default="{ row }">
                {{ row.distance < 1000 ? `${row.distance.toFixed(0)}米` : `${(row.distance / 1000).toFixed(2)}公里` }}
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div v-if="circleAnalysisData.competitorStores.length > 0" class="analysis-section">
          <div class="analysis-section-title">
            <el-icon><DataLine /></el-icon>
            竞品门店
            <template v-if="circleAnalysisData.competitorStoresByRadius.length > 1">
              <span v-for="(item, idx) in circleAnalysisData.competitorStoresByRadius" :key="idx" style="margin-left:4px;">
                <el-tag size="small">{{ item.radius }}{{ item.unit === 'km' ? 'km' : 'm' }}:{{ item.count }}家</el-tag>
              </span>
            </template>
            <template v-else>
              ({{ circleAnalysisData.competitorStores.length }}家)
            </template>
          </div>
          <el-table :data="circleAnalysisData.competitorStores" size="small" max-height="200">
            <el-table-column prop="name" label="门店名称" />
            <el-table-column prop="brand" label="品牌" />
            <el-table-column prop="distance" label="到圆心距离" width="120">
              <template #default="{ row }">
                {{ row.distance < 1000 ? `${row.distance.toFixed(0)}米` : `${(row.distance / 1000).toFixed(2)}公里` }}
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="closeAnalysisDialog">关闭</el-button>
        <el-button type="primary" @click="showCircleOnMap">显示地图</el-button>
        <el-button type="danger" plain @click="clearCircleAnalysisOnMap">清除地图显示</el-button>
      </template>    </el-dialog>

    <!-- 人口对比对话框 -->
    <el-dialog v-model="populationCompareVisible" width="900px" class="dialog-fancy" draggable :show-close="true">
      <template #header>
        <div class="dialog-header-fancy">
          <span class="dhf-icon" style="background:#e6f1fb;">👥</span>
          <div>
            <div class="dhf-title">人口对比分析</div>
            <div class="dhf-sub">多门店人口指标横向对比</div>
          </div>
        </div>
      </template>
      <!-- 步骤1：选择门店和设置参数 -->
      <div v-if="compareStep === 1">
        <el-form label-width="100px" style="margin-bottom: 16px;">
          <el-form-item label="分析半径">
            <el-input-number v-model="compareRadius" :min="0.5" :max="10" :step="0.5" />
            <span style="margin-left: 8px;">公里</span>
          </el-form-item>
        </el-form>

        <el-alert type="info" :closable="false" style="margin-bottom: 12px">
          <template #title>
            请选择 2-5 家门店进行人口对比分析
          </template>
        </el-alert>

        <div style="display: flex; gap: 16px; margin-bottom: 16px;">
          <el-input
            v-model="compareSearchKeyword"
            placeholder="输入门店名称搜索"
            style="width: 300px;"
            clearable
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>

        <!-- 已选择的门店（始终渲染，只是隐藏） -->
        <div v-show="selectedCompareStoresState.list.length > 0" style="margin-bottom: 12px;">
          <div style="font-size: 12px; color: #666; margin-bottom: 6px;">已选择 ({{ selectedCompareStoresState.list.length }}/5)：</div>
          <el-tag
            v-for="store in selectedCompareStoresState.list"
            :key="store.id"
            closable
            @close="removeCompareStore(store)"
            style="margin-right: 8px; margin-bottom: 4px;"
          >
            {{ store.name }}
          </el-tag>
        </div>

        <!-- 门店列表 -->
        <div style="max-height: 280px; overflow-y: auto; border: 1px solid #ebeef5; border-radius: 4px;">
          <div
            v-for="store in filteredCompareStores"
            :key="store.id"
            style="display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid #ebeef5; cursor: pointer;"
            :style="{ background: selectedCompareStoresState.list.some(s => s.id === store.id) ? '#ecf5ff' : 'white' }"
            @click="toggleCompareStore(store)"
          >
            <el-button
              :type="selectedCompareStoresState.list.some(s => s.id === store.id) ? 'primary' : 'default'"
              size="small"
              style="margin-right: 12px;"
              @click.stop="toggleCompareStore(store)"
            >
              {{ selectedCompareStoresState.list.some(s => s.id === store.id) ? '已选' : '选择' }}
            </el-button>
            <div style="flex: 1;">
              <div style="font-weight: 500;">{{ store.name }}</div>
              <div style="font-size: 12px; color: #999;">{{ store.brand }} | {{ store.city }} {{ store.district }}</div>
            </div>
          </div>
        </div>

        <div style="margin-top: 8px; font-size: 12px; color: #999;">
          共 {{ filteredCompareStores.length }} 家门店
        </div>
      </div>

      <!-- 步骤2：显示对比结果 -->
      <div v-if="compareStep === 2" style="max-height: 600px; overflow-y: auto;">
        <!-- 2家门店：表格 + 柱状图 -->
        <div v-if="compareResults.length === 2" style="display: flex; gap: 16px; margin-bottom: 16px;">
          <div style="flex: 1;">
            <el-table
              :data="compareTableData"
              border
              stripe
              size="small"
              max-height="400"
            >
              <el-table-column prop="field" label="字段" width="120" fixed />
              <el-table-column
                v-for="(store, idx) in compareResults"
                :key="store.id"
                :label="store.name"
                align="right"
              >
                <template #default="{ row }">
                  <span :style="{ color: row.maxIndex === idx ? '#f56c6c' : '#333', fontWeight: row.maxIndex === idx ? 'bold' : 'normal' }">
                    {{ row.values[idx] }}
                  </span>
                  <span v-if="row.diffs[idx]" style="color: #909399; font-size: 11px; margin-left: 4px;">
                    {{ row.diffs[idx] }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:13px;color:#909399;">对比柱状图</span>
            <el-button size="small" text @click="exportBarChart">
              <el-icon><Download /></el-icon> 导出图片
            </el-button>
          </div>
          <div style="width: 450px; height: 400px;" ref="barChartRef"></div>
        </div>

        <!-- 3家及以上门店：表格热力图 -->
        <div v-else style="margin-bottom: 16px;">
          <div style="display: flex; gap: 16px;">
            <div style="flex: 1;">
              <el-table
                :data="compareTableData"
                border
                stripe
                size="small"
                max-height="400"
              >
                <el-table-column prop="field" label="字段" width="120" fixed />
                <el-table-column
                  v-for="(store, idx) in compareResults"
                  :key="store.id"
                  :label="store.name"
                  align="center"
                >
                  <template #default="{ row }">
                    <div
                      :style="getHeatmapCellStyle(row.nums, idx)"
                      style="padding: 4px 8px; border-radius: 4px; font-weight: 500;"
                    >
                      {{ row.values[idx] }}
                    </div>
                  </template>
                </el-table-column>
              </el-table>
            </div>
            <div style="width: 120px; padding: 20px 10px;">
              <div style="font-size: 12px; color: #666; margin-bottom: 8px; text-align: center;">数值大小</div>
              <div
                style="width: 100%; height: 200px; border-radius: 4px; overflow: hidden;"
                :style="{ background: 'linear-gradient(to bottom, #d7191c, #fdae61, #ffffbf, #abdda4, #2b83f6)' }"
              ></div>
              <div style="display: flex; justify-content: space-between; font-size: 11px; color: #666; margin-top: 4px;">
                <span>高</span>
                <span>低</span>
              </div>
            </div>
          </div>
          <div style="margin-top: 12px; padding: 8px 12px; background: #f5f7fa; border-radius: 4px; font-size: 12px; color: #666;">
            <div style="display: flex; gap: 16px;">
              <span><span style="display: inline-block; width: 16px; height: 16px; background: #2b83f6; border-radius: 2px; vertical-align: middle; margin-right: 4px;"></span>数值较低</span>
              <span><span style="display: inline-block; width: 16px; height: 16px; background: #ffffbf; border-radius: 2px; vertical-align: middle; margin-right: 4px;"></span>数值中等</span>
              <span><span style="display: inline-block; width: 16px; height: 16px; background: #d7191c; border-radius: 2px; vertical-align: middle; margin-right: 4px;"></span>数值最高</span>
            </div>
          </div>
        </div>

        <div v-if="compareResults.length === 2" style="margin-top: 16px; text-align: center;">
          <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px;">
            {{ compareResults[0].name }} vs {{ compareResults[1].name }}
          </div>
          <div style="font-size: 12px; color: #666;">
            <span :style="{ color: compareResults[0].total > compareResults[1].total ? '#f56c6c' : '#67c23a', fontWeight: 'bold' }">
              {{ compareResults[0].total > compareResults[1].total ? compareResults[0].name : compareResults[1].name }}
            </span>
            总体人口优势
            <span style="color: #f56c6c; font-weight: bold;">
              {{ Math.abs(compareResults[0].total - compareResults[1].total).toLocaleString() }}
            </span>
            人
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="populationCompareVisible = false">关闭</el-button>
        <el-button v-if="compareStep === 1" type="primary" :disabled="selectedCompareStoresState.list.length < 2" :loading="compareLoading" @click="startPopulationCompare">
          开始分析
        </el-button>
        <el-button v-if="compareStep === 2" @click="compareStep = 1">
          重新选择
        </el-button>
      </template>
    </el-dialog>


  </div>
</template>

<script setup>
import { ref, shallowRef, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
// 按需导入：ElMessage/ElMessageBox 通过JS调用，需显式加载CSS
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import {
  Location, Connection, Coordinate, Crop, FullScreen,
  Delete, View, Grid, DataLine, DataAnalysis, Aim, Search, Flag, Shop, ArrowLeft, Collection, LocationFilled, Edit, Close, CopyDocument, Loading, MapLocation, Lock, Unlock
} from '@element-plus/icons-vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import 'leaflet.heat'
import { useMarkerStore } from '@/stores/marker'
import { useCompetitorStore } from '@/stores/competitor'
import { useBrandIconStore } from '@/stores/brandIcon'
import { useBrandStoreStore } from '@/stores/brandStore'
import { useShoppingCenterStore } from '@/stores/shoppingCenterStore'
import { useUserStore } from '@/stores/user'
import AiAssistant from '@/components/AiAssistant.vue'
import PoiResultPanel from '@/components/PoiResultPanel.vue'
import PoiSearchPanel from '@/components/map/PoiSearchPanel.vue'
import BusinessCirclePanel from '@/components/map/BusinessCirclePanel.vue'
import SmartstepsPanel from '@/components/SmartstepsPanel.vue'
import StoreSmartstepsDialog from '@/components/StoreSmartstepsDialog.vue'
import MapToolbar from '@/components/map/MapToolbar.vue'
import AddressSearchPanel from '@/components/map/AddressSearchPanel.vue'
import StoreControlPanel from '@/components/map/StoreControlPanel.vue'
import CityTradeAreaDialog from '@/components/map/dialogs/CityTradeAreaDialog.vue'
import { executeTool } from '@/utils/aiExecutor'
import {
  createCustomIcon, createSvgIcon, createBrandImageIcon, svgMarkerStyles, getCategoryIcon, getStatusColor, getStoreTypeColor, getStoreTypeBorderColor, isStoreClosed,
  calculateDistance, formatDistance, calculateArea, formatArea
} from '@/utils/map'
import axios from 'axios'
import echarts from '@/utils/echarts'
import * as turf from '@turf/turf'
import { formatNumber } from '@/utils/populationStats'
import { handleApiError } from '@/utils/errorHandler'
import { exportChartImage } from '@/utils/chartExport'
// 注意：public目录的中文名图片会被Vite直接复制到dist根目录

const markerStore = useMarkerStore()
const competitorStore = useCompetitorStore()
const brandIconStore = useBrandIconStore()
const brandStoreStore = useBrandStoreStore()
const shoppingCenterStore = useShoppingCenterStore()
const userStore = useUserStore()
const route = useRoute()

// AI 助手
const aiAssistantRef = ref(null)

// 性能优化：内存泄漏预防
const cleanupResources = {
  timers: new Set(),
  abortControllers: new Set(),
  eventListeners: []
}

// 安全的定时器封装
const createSafeTimeout = (callback, delay) => {
  const timer = setTimeout(() => {
    callback()
    cleanupResources.timers.delete(timer)
  }, delay)
  cleanupResources.timers.add(timer)
  return timer
}

const clearAllTimers = () => {
  cleanupResources.timers.forEach(timer => {
    clearTimeout(timer)
    clearInterval(timer)
  })
  cleanupResources.timers.clear()
}

const aiContext = computed(() => ({
  markers_count: markerStore.markers.length,
  competitors_count: competitorStore.competitors.length,
  cities: [...new Set(markerStore.markers.map(m => m.city).filter(Boolean))].slice(0, 10),
  brands: [...new Set(markerStore.markers.map(m => m.brand).filter(Boolean))].slice(0, 10)
}))

// 品牌图标映射 brand -> iconUrl
const brandIconMap = computed(() => {
  const map = {}
  brandIconStore.icons.forEach(icon => {
    map[icon.brand] = `/uploads/brand-icons/${icon.filename}`
  })
  return map
})

// 地图实例
let map = null
let tileLayer = null
let businessLayer = null
let competitorLayer = null  // 竞品门店图层
let brandStoreLayer = null  // 品牌门店图层
let brandMarkerMap = {}     // 品牌门店ID到marker的映射
let shoppingCenterLayer = null  // 购物中心图层
let shoppingCenterMarkerMap = {}  // 购物中心ID到marker的映射
let allStoreClusterGroup = null  // 所有门店统一聚合图层
let heatmapLayer = null
let drawnItems = null
let analysisCircleLayer = null  // 圆形分析专用图层
let storeCircleLayer = null     // 门店商圈圆形图层
let shapefileQueryLayer = null  // Shapefile检索高亮图层
let measureLine = null
let measureArea = null
let measurePoints = []
let measureAreaPoints = []      // 测面专用点数组
let measureAreaPolygon = null   // 测面 polygon
let measureAreaLabel = null     // 测面面积标签
let circleSearchActive = false  // 防止重复触发半径搜索

// 测量工具专用图层
let measureLayerGroup = null     // 所有测量元素的容器
let measurePreviewLine = null    // 鼠标移动时的预览线
let measureDotMarkers = []       // 各点的圆点标记
let measureLabelMarkers = []     // 各点的距离标签

// 状态变量
const activeTool = ref('')
const toolbarExpanded = ref(false) // 默认收起
// 城市商圈
const cityTradeAreaVisible = ref(false)
const cityTradeAreaLoading = ref(false)
const cityTradeAreaList = ref([])       // [{ name, ids: [], count }]
let cityTradeAreaLayer = null           // Leaflet 图层组
const CITY_TRADE_AREA_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9']

// 城市分级（与 ShapefileView 保持一致）
const CITY_TIERS = {
  '一线城市': ['北京', '上海', '广州', '深圳'],
  '新一线城市': ['成都', '杭州', '重庆', '武汉', '苏州', '西安', '南京', '长沙', '郑州', '天津', '合肥', '青岛', '东莞', '宁波', '佛山']
}
function getCityTier(name) {
  if (!name) return '二三线城市'
  for (const [tier, cities] of Object.entries(CITY_TIERS)) {
    if (cities.some(city => name.includes(city))) return tier
  }
  return '二三线城市'
}
// 按城市等级分组的商圈城市列表
const groupedTradeAreaCities = computed(() => {
  const groups = { '一线城市': [], '新一线城市': [], '二三线城市': [] }
  cityTradeAreaList.value.forEach(city => {
    const tier = getCityTier(city.name)
    groups[tier].push(city)
  })
  return groups
})
const showHeatmap = ref(false)
const showCluster = ref(false)
const showStoreCircles = ref(false)
const storeCircleMode = ref('overlap')     // 'overlap'=门店重合度, 'competition'=门店竞争数
const storeCircleRadius = ref(1)
const overlapHighThreshold = ref(60)   // 高重叠阈值(%)，可手动设置
const overlapLowThreshold = ref(30)    // 低重叠阈值(%)，可手动设置
const storeCircleDialogVisible = ref(false)
const storeCircleModeDialogVisible = ref(false)
const storeCircleLegendItems = ref([])   // 门店商圈图例
const storeCircleLegendVisible = ref(false)  // 图例弹窗可见性
// 门店商圈分类筛选（默认全选）
const storeCircleFilters = ref({
  overlap: { overlapHigh: true, overlapMid: true, overlapLow: true, overlapNone: true },
  competition: { noMyNoComp: true, hasMyNoComp: true, noMyHasComp: true, hasMyHasComp: true },
  track: { noMyNoOther: true, hasMyNoOther: true, noMyHasOther: true, hasMyHasOther: true },
  opportunity: { lowDensity: true, mediumDensity: true, highDensity: true }
})
// 机会区分析参数
const opportunityDensityThreshold = ref(2)   // 网格内竞品 ≤ 该值 → 机会区
const opportunityScope = ref('viewport')     // 'viewport'=当前视野, 'city'=全城
let opportunityLayer = null                  // 机会区网格图层
// 竞争追踪：指定竞争品牌（单选）
const trackBrand = ref('')
const storeCircleDialogTitle = computed(() => {
  if (storeCircleMode.value === 'overlap') return '我的门店重叠度'
  if (storeCircleMode.value === 'track') return '设置竞争门店追踪半径'
  if (storeCircleMode.value === 'opportunity') return '机会区分析设置'
  return '设置竞争分析半径'
})
// 竞争品牌多选（空数组 = 统计全部竞品）
const competitionBrands = ref([])
const competitionBrandList = computed(() => {
  const brands = new Set()
  competitorStore.competitors.forEach(c => { if (c.brand) brands.add(c.brand) })
  return [...brands].sort()
})
// 竞争数结果：城市分布统计 + 门店坐标（用于图例展开定位）
const competitionCityStats = ref({})       // { filterKey: { city: count } }
const competitionStoreResults = ref([])    // [{ lat, lng, city, filterKey, name, _type }]
const expandedLegendCategory = ref(null)   // 当前展开的图例分类 key
const toggleLegendCategory = (key) => {
  expandedLegendCategory.value = expandedLegendCategory.value === key ? null : key
}

// ===== 周边竞争强度增强：竞品雷达下钻 =====
const competitionRadarVisible = ref(false)
const competitionRadarData = ref(null)
const radarChartRef = ref(null)
const directionChartRef = ref(null)
let radarChart = null
let directionChart = null

const DIRECTION_NAMES = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']

// 点击竞争强度圆圈 → 计算该店半径内的竞品雷达数据（品牌构成/8方向/威胁评级）
function openCompetitionRadar(lat, lng, radiusM, store) {
  let allComps = []
  if (competitorStore.competitors) {
    allComps = competitorStore.competitors
    if (competitorStore.visibleIds !== null && competitorStore.visibleIds !== undefined) {
      allComps = allComps.filter(c => competitorStore.visibleIds.includes(c.id))
    }
    // 按选择的竞争品牌过滤（与竞争强度画圈口径一致）
    if (competitionBrands.value.length > 0) {
      allComps = allComps.filter(c => competitionBrands.value.includes(c.brand))
    }
  }
  const compPoints = allComps.filter(s => s.latitude && s.longitude)

  const brands = {}
  const dirs = [0, 0, 0, 0, 0, 0, 0, 0]
  let total = 0
  let distSum = 0
  for (const p of compPoints) {
    const d = calculateDistance(lat, lng, p.latitude, p.longitude)
    if (d > 0 && d <= radiusM) {
      total++
      const brand = p.brand || '未知品牌'
      brands[brand] = (brands[brand] || 0) + 1
      // 方位角：0°=正北，顺时针
      const dLat = p.latitude - lat
      const dLng = (p.longitude - lng) * Math.cos(lat * Math.PI / 180)
      let angle = Math.atan2(dLng, dLat) * 180 / Math.PI
      if (angle < 0) angle += 360
      dirs[Math.round(angle / 45) % 8]++
      distSum += d
    }
  }
  const brandCount = Object.keys(brands).length
  const avgDist = total > 0 ? Math.round(distSum / total) : 0

  // 威胁评级：数量 × 品牌数 × 距离加权
  let threatLevel = '低'
  let threatColor = '#67c23a'
  if (total >= 8 || (brandCount >= 3 && total >= 5)) { threatLevel = '高'; threatColor = '#f56c6c' }
  else if (total >= 3 || (brandCount >= 2 && total >= 2)) { threatLevel = '中'; threatColor = '#e6a23c' }

  const brandData = Object.entries(brands).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
  const mostDenseDir = total > 0 ? DIRECTION_NAMES[dirs.indexOf(Math.max(...dirs))] : '-'

  competitionRadarData.value = {
    name: store.name || '未知门店',
    type: store._type || '',
    lat, lng,
    radiusKm: (radiusM / 1000).toFixed(1),
    brands: brandData,
    directions: dirs,
    total, brandCount, avgDist,
    threatLevel, threatColor,
    mostDenseDir
  }
  competitionRadarVisible.value = true
  // el-dialog 默认懒挂载，body 在 visible=true 后才渲染，echarts init 时容器尺寸为 0
  // 必须 nextTick 等容器完成布局，再渲染 + resize 自适应真实尺寸
  nextTick(() => {
    renderRadarCharts()
    radarChart && radarChart.resize()
    directionChart && directionChart.resize()
  })
}

// 渲染竞品雷达图（品牌雷达 + 8方向玫瑰）
function renderRadarCharts() {
  const data = competitionRadarData.value
  if (!data) return
  if (radarChartRef.value) {
    if (radarChart) radarChart.dispose()
    radarChart = echarts.init(radarChartRef.value)
    const brands = data.brands.length > 0 ? data.brands : [{ name: '无竞品', value: 0 }]
    const maxV = Math.max(...brands.map(b => b.value), 1)
    // 品牌名截断（>2 字符取前 2 字，避免雷达图轴标签重叠/裁切）
    const shortName = (s) => String(s || '').replace(/品牌$/, '').slice(0, 2) || '?'
    radarChart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      radar: {
        indicator: brands.map(b => ({ name: `${shortName(b.name)} ${b.value}`, max: maxV })),
        radius: '65%',
        center: ['50%', '52%'],
        splitArea: { areaStyle: { color: ['rgba(64,158,255,0.03)', 'rgba(64,158,255,0.08)'] } },
        axisName: { color: '#303133', fontSize: 11, lineHeight: 14 }
      },
      series: [{
        type: 'radar',
        symbol: 'circle',
        symbolSize: 5,
        data: [{ value: brands.map(b => b.value), name: '竞品数量', areaStyle: { color: 'rgba(64,158,255,0.35)' }, lineStyle: { color: '#409eff', width: 2 }, itemStyle: { color: '#409eff' } }]
      }]
    })
  }
  if (directionChartRef.value) {
    if (directionChart) directionChart.dispose()
    directionChart = echarts.init(directionChartRef.value)
    const maxDir = Math.max(...data.directions, 1)
    // 8 方向玫瑰图：angleAxis=类目(8 方向围成圆) / radiusAxis=数值轴(数量)
    // 数据按"8 方向"顺序保证顺时针排列（北→东北→东→...）
    const seriesData = data.directions.map((v, i) => ({ value: v, name: DIRECTION_NAMES[i] }))
    const maxV = Math.max(...data.directions, 1)
    directionChart.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', formatter: '{b}: {c} 家' },
      angleAxis: {
        type: 'category',
        data: DIRECTION_NAMES,
        startAngle: 90,  // 0°=北（顶部）
        axisLabel: { color: '#606266', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      radiusAxis: { type: 'value', max: maxV, axisLabel: { color: '#909399', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } } },
      polar: { radius: '60%' },
      series: [{
        type: 'bar',
        data: seriesData,
        coordinateSystem: 'polar',
        barWidth: 18,
        itemStyle: { color: (params) => params.value > 0 && params.value === maxV ? '#f56c6c' : '#409eff' }
      }]
    })
  }
}
// ===== 周边竞争强度增强 END =====
// 竞品雷达弹窗关闭时销毁图表
function disposeRadarCharts() {
  if (radarChart) { radarChart.dispose(); radarChart = null }
  if (directionChart) { directionChart.dispose(); directionChart = null }
}
// 复制相互蚕食（重叠度）分类下的门店列表
const copyOverlapStores = async (item) => {
  const stores = item.stores || []
  if (stores.length === 0) {
    ElMessage.info('该分类下暂无门店')
    return
  }
  const text = stores.join('\n')
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制 ${stores.length} 家门店名称`)
  } catch (e) {
    // 剪贴板 API 不可用时降级：创建临时 textarea
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      ElMessage.success(`已复制 ${stores.length} 家门店名称`)
    } catch (e2) {
      ElMessage.error('复制失败，请手动选择复制')
    }
  }
}
const getCategoryTotal = (key) => {
  const cities = competitionCityStats.value[key]
  if (!cities) return 0
  return Object.values(cities).reduce((a, b) => a + b, 0)
}
// 定位到某分类某城市的门店
const locateCompetitionCity = (filterKey, city) => {
  const matched = competitionStoreResults.value.filter(r => r.filterKey === filterKey && r.city === city)
  if (matched.length === 0) { ElMessage.warning('该城市暂无此分类的门店'); return }
  const bounds = L.latLngBounds(matched.map(r => [r.lat, r.lng]))
  try { map.fitBounds(bounds, { padding: [80, 80], maxZoom: 13 }) } catch (_) {
    map.setView([matched[0].lat, matched[0].lng], 12)
  }
  ElMessage.success(`${city} 有 ${matched.length} 家「${filterKeyLabel(filterKey)}」`)
}
const filterKeyLabel = (key) => {
  const map = {
    noMyNoComp: '无我的门店+无竞品',
    hasMyNoComp: '有我的门店+无竞品',
    noMyHasComp: '无我的门店+有竞品',
    hasMyHasComp: '有我的门店+有竞品',
    noMyNoOther: '无我的门店+无其他竞品',
    hasMyNoOther: '有我的门店+无其他竞品',
    noMyHasOther: '无我的门店+有其他竞品',
    hasMyHasOther: '有我的门店+有其他竞品'
  }
  return map[key] || key
}

// 重叠率阈值持久化（localStorage，按用户隔离）
const OVERLAP_THRESHOLD_KEY = () => `overlapThresholds_${userStore.user?.id || 'anon'}`
const saveOverlapThresholds = () => {
  try {
    localStorage.setItem(OVERLAP_THRESHOLD_KEY(), JSON.stringify({
      high: overlapHighThreshold.value,
      low: overlapLowThreshold.value
    }))
  } catch (_) {}
}
const restoreOverlapThresholds = () => {
  try {
    const saved = localStorage.getItem(OVERLAP_THRESHOLD_KEY())
    if (!saved) return
    const t = JSON.parse(saved)
    if (t.high && t.low) {
      overlapHighThreshold.value = t.high
      overlapLowThreshold.value = t.low
    }
  } catch (_) {}
}

const showBusinessLayer = ref(true)
// 我的门店状态筛选（all/open/closed，localStorage 持久化）
const myStoreStatusFilter = ref(localStorage.getItem('myStoreStatusFilter') || 'all')
watch(myStoreStatusFilter, () => {
  localStorage.setItem('myStoreStatusFilter', myStoreStatusFilter.value)
  loadMarkers()
})
const showStoreLayers = ref(true)       // 总开关：控制竞品+品牌图层整体显示
const showCompetitorLayer = ref(false)  // 竞品图层显示控制（默认隐藏）
const showBrandStoreLayer = ref(false)  // 品牌门店图层显示控制（默认隐藏）
const showShoppingCenterLayer = ref(false)  // 购物中心图层显示控制（默认隐藏）
const storeToggleExpanded = ref(false) // 显示门店面板展开/收起
const storeToolsExpanded = ref(false) // 门店工具面板展开/收起
const layerOpacity = ref(1)
const baseMapType = ref('vec')
const currentCoords = ref(null)
const measurementResult = ref('')
const districtVisible = ref(false)
const districtKeyword = ref('')
const districtLoading = ref(false)
const districtResult = ref(null)
const districtError = ref('')
const districtStoreCounts = ref(null)
let districtLayer = null  // Leaflet polygon layer

// 按商圈查询
const commerceVisible = ref(false)
const commerceKeyword = ref('')
const commerceLoading = ref(false)
const commerceResult = ref(null)
const commerceNoResult = ref(false)
const commerceError = ref('')
const commerceLayerItems = ref([])

// 开店余地
const potentialVisible = ref(false)
const populationCities = ref([])
const potentialCity = ref('')
const potentialRadius = ref(1.0)
const potentialMyStoreOp = ref('>')
const potentialMyStoreVal = ref(1)
const potentialCompOp = ref('>')
const potentialCompVal = ref(1)
// 品牌筛选（我的门店/竞品，可多选）
const potentialMyBrands = ref([])
const potentialCompBrands = ref([])
const potentialMyBrandOptions = computed(() => [...new Set(markerStore.markers.map(m => m.brand).filter(Boolean))])
const potentialCompBrandOptions = computed(() => [...new Set(competitorStore.competitors.map(c => c.brand).filter(Boolean))])
// 其他品牌（高德关键词检索）
const potentialOther1Name = ref('')
const potentialOther1Op = ref('>')
const potentialOther1Val = ref(1)
const potentialOther2Name = ref('')
const potentialOther2Op = ref('>')
const potentialOther2Val = ref(1)
const potentialNumericFields = ref([])
const potentialCond1Field = ref('')
const potentialCond1Op = ref('>')
const potentialCond1Val = ref(null)
const potentialCond2Field = ref('')
const potentialCond2Op = ref('>')
const potentialCond2Val = ref(null)
const potentialLoading = ref(false)
const potentialResults = ref([])
let potentialLayer = null

// 常用汉字拼音首字母映射表
const pinyinMap = {
  '上': 'S', '北': 'B', '广': 'G', '深': 'S', '成': 'C',
  '杭': 'H', '重': 'C', '武': 'W', '苏': 'S', '西': 'X',
  '南': 'N', '长': 'C', '郑': 'Z', '天': 'T', '合': 'H',
  '青': 'Q', '东': 'D', '宁': 'N', '佛': 'F', '昆': 'K',
  '福': 'F', '厦': 'X', '海': 'H', '贵': 'G', '太': 'T',
  '济': 'J', '哈': 'H', '沈': 'S', '大': 'D', '兰': 'L',
  '拉': 'L', '银': 'Y', '乌': 'W', '桂': 'G',
  '珠': 'Z', '中': 'Z', '浦': 'P', '月': 'Y', '彭': 'P',
  '桃': 'T', '周': 'Z',
  // 补充缺失的城市首字
  '咸': 'X', '宜': 'Y', '绵': 'M',
  '潍': 'W', '淄': 'Z', '芜': 'W', '蚌': 'B', '邯': 'H',
  '洛': 'L', '襄': 'X', '岳': 'Y',
  '泉': 'Q', '绍': 'S', '温': 'W', '嘉': 'J', '盐': 'Y',
  '镇': 'Z', '扬': 'Y', '徐': 'X', '连': 'L', '赣': 'G',
  '莞': 'D', '惠': 'H', '肇': 'Z', '汕': 'S', '湛': 'Z',
  '茂': 'M', '椰': 'Y', '遵': 'Z'
}
// 获取汉字拼音首字母
function getFirstLetter(char) {
  return pinyinMap[char] || char
}
// 按拼音首字母分组的城市列表
const groupedPotentialCities = computed(() => {
  const groups = {}
  for (const city of populationCities.value) {
    const firstLetter = getFirstLetter(city[0])
    if (!groups[firstLetter]) groups[firstLetter] = []
    groups[firstLetter].push(city)
  }
  return Object.keys(groups).sort().map(letter => ({
    letter,
    cities: groups[letter]
  }))
})

const commerceArea = ref(null)
const commerceStoreCounts = ref(null)
let commerceLayer = null

const markerDialogVisible = ref(false)
const editingMarker = ref(null)
const markerFormRef = ref(null)
const currentMarkerStyle = ref('store') // 当前图标样式

// 绘制圆形相关
const circleDialogVisible = ref(false)
const circleDialogMode = ref('stores') // 'stores'=商圈内点位, 'population'=商圈人口分布
const circleForm = reactive({
  center: null,
  centerText: '',
  radius: 2,
  radius2: null,
  radius3: null,
  unit: 'km'
})

// 色块方案预设
const POPULATION_COLOR_SCHEMES = {
  'blue-green-yellow-orange-red': {
    name: '蓝-绿-黄-橙-红（默认）',
    colors: ['#2b83f6', '#abdda4', '#ffffbf', '#fdae61', '#d7191c'],
    gradient: 'to bottom, #d7191c, #fdae61, #ffffbf, #abdda4, #2b83f6'
  },
  'blue-tone': {
    name: '蓝色调',
    colors: ['#deebf7', '#9ecae1', '#6baed6', '#3182bd', '#08519c'],
    gradient: 'to bottom, #08519c, #3182bd, #6baed6, #9ecae1, #deebf7'
  },
  'purple-tone': {
    name: '紫色调',
    colors: ['#efedf5', '#dadaeb', '#bcbddc', '#807dba', '#54278f'],
    gradient: 'to bottom, #54278f, #807dba, #bcbddc, #dadaeb, #efedf5'
  },
  'mono-orange': {
    name: '橙色调',
    colors: ['#fef0d9', '#fdd49e', '#fdbb84', '#fc8d59', '#d7301f'],
    gradient: 'to bottom, #d7301f, #fc8d59, #fdbb84, #fdd49e, #fef0d9'
  },
  'green-tone': {
    name: '绿色调',
    colors: ['#e5f5e0', '#a1d99b', '#74c476', '#31a354', '#006d2c'],
    gradient: 'to bottom, #006d2c, #31a354, #74c476, #a1d99b, #e5f5e0'
  }
}
const populationColorScheme = ref('blue-green-yellow-orange-red')

// 多半径时自动加宽对话框
const circleDialogWidth = computed(() => {
  if (circleDialogMode.value !== 'population') return '420px'
  const count = [circleForm.radius, circleForm.radius2, circleForm.radius3].filter(r => r != null).length
  return count >= 2 ? '580px' : '420px'
})

// 圆形内门店分析相关
const circleAnalysisVisible = ref(false)
const circleAnalysisData = reactive({
  myStores: [],
  competitorStores: [],
  myStoresFull: [],  // 完整数据（含经纬度）
  competitorStoresFull: [],
  myStoresByRadius: [],  // 各半径内门店数
  competitorStoresByRadius: []  // 各半径内竞品数
})
const circleAnalysisTitle = ref('圆形内门店分析')

// 商圈人口分布相关
let populationLayerGroup = null  // 人口分布图层组
let tempPopulationMarker = null   // 人口分布临时圆心标记
let currentStatsPanelMarker = null  // 当前统计面板标记
const populationFieldOptions = ref([])  // 可选的统计字段列表
const selectedPopulationField = ref('')  // 用户选择的统计字段
const populationAnalysisCompleted = ref(false)  // 标记分析是否已完成
const populationFieldLoading = ref(false)  // 是否正在加载字段
const loadingElapsedSeconds = ref(0)      // 加载已用时间（秒）

// UI增强：地图加载状态
const mapLoading = ref(true)

// UI增强：键盘快捷键
const handleKeyDown = (e) => {
  const key = e.key
  const isCtrlOrCmd = e.ctrlKey || e.metaKey

  // Escape：关闭弹出面板
  if (key === 'Escape') {
    storeSearchVisible.value = false
    districtVisible.value = false
    commerceVisible.value = false
    storeCircleDialogVisible.value = false
    storeCircleModeDialogVisible.value = false
    cityTradeAreaVisible.value = false
    potentialVisible.value = false
    return
  }

  // Ctrl+F / Cmd+F：聚焦搜索
  if ((isCtrlOrCmd && key === 'f') || (isCtrlOrCmd && key === 'F')) {
    e.preventDefault()
    const searchInput = document.querySelector('.search-body input')
    if (searchInput) searchInput.focus()
    return
  }

  // Ctrl+K / Cmd+K：切换工具箱
  if (isCtrlOrCmd && key === 'k') {
    e.preventDefault()
    toolbarExpanded.value = !toolbarExpanded.value
    return
  }

  // R：半径圆搜索（需已输入关键词）
  if (key === 'r' || key === 'R') {
    if (document.activeElement?.tagName === 'INPUT') return // 不在输入框中触发
    startCircleSearch()
    return
  }

  // Q：清除绘制
  if (key === 'q' || key === 'Q') {
    if (document.activeElement?.tagName === 'INPUT') return
    clearDrawings()
  }
}

// 商圈内点位相关
let tempCircleMarker = null  // 商圈内点位临时圆心标记

// POI搜索结果
const poiResultVisible = ref(false)
const poiResults = ref([])
const poiMarkers = shallowRef([])
let poiCenterMarker = null    // POI中心点标记
let poiRadiusCircle = null   // POI搜索半径圆
let poiCenterPoint = null     // POI中心点坐标

// 智慧足迹面板
const smartstepsVisible = ref(false)

// 门店联通人口对话框
const storeSmartstepsVisible = ref(false)
const selectedStoreForSmartsteps = ref(null)

// 周边检索面板
const poiSearchExpanded = ref(false)
const poiKeywords = ref('')

// 商圈工具面板
const businessCircleExpanded = ref(false)

// 半径圆搜索状态
const pendingCircleSearch = ref(null) // { lat, lng }

// 多边形搜索状态
const pendingPolygonSearch = ref(false)
let tempPolygonLayer = null
let tempPolygonPoints = []
let tempPolygonMarker = null
let poiSearchRadius = 2000    // POI搜索半径（米）
let updateMarkers = null      // 标记更新函数

// 多边形点击处理函数（全局定义，以便在 finishPolygonSearch 中正确移除监听）
const addPolygonPoint = (e) => {
  tempPolygonPoints.push(e.latlng)
  tempPolygonLayer.setLatLngs(tempPolygonPoints)
  if (updateMarkers) updateMarkers()
  // 每次点击后更新按钮位置
  if (completeBtnElement) {
    const bounds = L.latLngBounds(tempPolygonPoints)
    const center = bounds.getCenter()
    const point = map.latLngToContainerPoint(center)
    completeBtnElement.style.top = `${Math.max(80, point.y - 100)}px`
    completeBtnElement.style.left = `${Math.min(point.x - 50, window.innerWidth - 150)}px`
    completeBtnElement.style.right = 'auto'
  }
}

// 地图右键菜单状态
const contextMenu = reactive({ visible: false, x: 0, y: 0, latlng: null })
let onMapContextMenuRef = null  // document 捕获级右键监听引用（用于卸载时移除）
const hideContextMenu = () => { contextMenu.visible = false }
// 🔒 地图锁定：开启后拖动地图时即使碰到图标也无视（图标不可拖动，地图正常拖动）
const mapLocked = ref(localStorage.getItem('mapLocked') === '1')
// 切换所有 marker 的可拖动状态（锁定 → 全部 disable，拖动地图碰到图标也无视）
const applyMapLockToMarkers = () => {
  const layers = [businessLayer, competitorLayer, brandStoreLayer, shoppingCenterLayer, allStoreClusterGroup]
  layers.forEach(layer => {
    if (!layer || typeof layer.eachLayer !== 'function') return
    layer.eachLayer((m) => {
      if (m && m.dragging) {
        if (mapLocked.value) m.dragging.disable()
        else m.dragging.enable()
      }
    })
  })
}
const toggleMapLock = () => {
  mapLocked.value = !mapLocked.value
  localStorage.setItem('mapLocked', mapLocked.value ? '1' : '0')
  applyMapLockToMarkers()
  ElMessage.success(mapLocked.value ? '🔒 地图已锁定：拖动地图碰到图标也无视，可正常拖动地图' : '🔓 地图已解锁：图标可正常拖动')
}
// 右键菜单动作分发
const contextMenuAction = (action) => {
  hideContextMenu()
  switch (action) {
    case 'addstore': setTool('marker'); break  // 与门店工具面板「添加门店」一致：进入选点模式
    case 'locate': storeSearchVisible.value = !storeSearchVisible.value; break  // 与门店工具面板「定位门店」一致：切换定位门店搜索面板
    case 'clear': clearDrawings(); break
    case 'circle': setTool('circle'); break
    case 'envscore': startEnvScore(); break
    case 'population': openPopulationDistribution(); break
    case 'smartsteps': smartstepsVisible.value = !smartstepsVisible.value; break
    case 'lockmap': toggleMapLock(); break
  }
}

// POI位置选择模式（用户需点击地图）
const poiPickLocationMode = ref(false)
const poiPendingSearch = ref(null) // 待执行的搜索参数

// 周边环境打分卡：选点模式 + 结果弹窗
const envScorePickMode = ref(false)
const envScoreDialogVisible = ref(false)
const envScoreLoading = ref(false)
const envScoreRadius = ref(500)
const envScoreData = ref(null)          // { counts, total }
const envScorePoint = ref(null)         // { lat, lng }
let envScoreLayer = null                // 地图图标 + 半径圆图层

const circleAnalysisParams = reactive({
  center: null,
  radius: 0
})

// 分析圆形内的门店
const analyzeCircleStores = () => {
  if (!circleForm.center) return
  
  // 计算所有半径（米）
  const radii = [circleForm.radius]
  if (circleForm.radius2 !== null && circleForm.radius2 !== undefined && circleForm.radius2 !== '') {
    radii.push(circleForm.radius2)
  }
  if (circleForm.radius3 !== null && circleForm.radius3 !== undefined && circleForm.radius3 !== '') {
    radii.push(circleForm.radius3)
  }
  
  const radiiMeters = radii.map(r => circleForm.unit === 'km' ? r * 1000 : r)
  const maxRadius = Math.max(...radiiMeters)

  const centerLat = circleForm.center.lat
  const centerLng = circleForm.center.lng

  // 获取可见的我的门店数据
  let myStoresData = markerStore.markers
  if (markerStore.visibleIds !== null && markerStore.visibleIds !== undefined) {
    myStoresData = markerStore.markers.filter(m => markerStore.visibleIds.includes(m.id))
  }

  // 分析我的门店（按最大半径过滤，包含所有圈内门店）
  const filteredMyStores = myStoresData
    .filter(store => {
      const distance = calculateDistance(centerLat, centerLng, store.latitude, store.longitude)
      return distance <= maxRadius
    })
  circleAnalysisData.myStoresFull = filteredMyStores
  circleAnalysisData.myStores = filteredMyStores
    .map(store => ({
      name: store.name,
      brand: store.brand || '-',
      distance: calculateDistance(centerLat, centerLng, store.latitude, store.longitude)
    }))
    .sort((a, b) => a.distance - b.distance)

  // 获取可见的竞品门店数据
  let competitorData = competitorStore.competitors
  if (competitorStore.visibleIds !== null && competitorStore.visibleIds !== undefined) {
    competitorData = competitorStore.competitors.filter(c => competitorStore.visibleIds.includes(c.id))
  }

  // 分析竞品门店（按最大半径过滤）
  const filteredCompetitorStores = competitorData
    .filter(store => {
      const distance = calculateDistance(centerLat, centerLng, store.latitude, store.longitude)
      return distance <= maxRadius
    })
  circleAnalysisData.competitorStoresFull = filteredCompetitorStores
  circleAnalysisData.competitorStores = filteredCompetitorStores
    .map(store => ({
      name: store.name,
      brand: store.brand || '-',
      distance: calculateDistance(centerLat, centerLng, store.latitude, store.longitude)
    }))
    .sort((a, b) => a.distance - b.distance)

  // 设置分析结果对话框标题
  const radiusText = radii.map(r => circleForm.unit === 'km' ? `${r}公里` : `${r}米`).join('/')
  circleAnalysisTitle.value = `半径${radiusText}圆形内门店分析`

  // 按各半径分别统计数量
  const myCounts = radiiMeters.map(r =>
    filteredMyStores.filter(s => calculateDistance(centerLat, centerLng, s.latitude, s.longitude) <= r).length
  )
  circleAnalysisData.myStoresByRadius = radii.map((r, i) => ({
    radius: r,
    unit: circleForm.unit,
    count: myCounts[i]
  }))
  const compCounts = radiiMeters.map(r =>
    filteredCompetitorStores.filter(s => calculateDistance(centerLat, centerLng, s.latitude, s.longitude) <= r).length
  )
  circleAnalysisData.competitorStoresByRadius = radii.map((r, i) => ({
    radius: r,
    unit: circleForm.unit,
    count: compCounts[i]
  }))

  // 保存分析参数（所有半径）
  circleAnalysisParams.center = { lat: centerLat, lng: centerLng }
  circleAnalysisParams.radii = radiiMeters
  circleAnalysisParams.radius = maxRadius  // 保持向后兼容

  // 关闭圆形设置对话框
  circleDialogVisible.value = false
  
  circleAnalysisVisible.value = true
}

// 关闭圆形对话框
const closeCircleDialog = () => {
  circleDialogVisible.value = false
  // 清除临时图钉标记
  if (tempPopulationMarker) {
    map.removeLayer(tempPopulationMarker)
    tempPopulationMarker = null
  }
  // 如果人口分析已完成，则不清除图层组（由分析函数处理）
  if (populationAnalysisCompleted.value) {
    populationAnalysisCompleted.value = false
    console.log('分析已完成，跳过清除人口分布图层')
    return
  }
  // 清除人口分布图层（半径圆、多边形、统计面板等）
  if (map && populationLayerGroup) {
    map.removeLayer(populationLayerGroup)
    populationLayerGroup = null
  }
}

// 商圈人口分布 - 打开对话框
const openPopulationDistribution = async () => {
  console.log('openPopulationDistribution开始执行')
  let loadingTimer = null
  if (!map) {
    console.error('地图对象未初始化')
    return
  }
  
  // 关闭商圈工具面板
  businessCircleExpanded.value = false
  
  // 设置为人口分布模式
  circleDialogMode.value = 'population'
  
  // 重置表单
  circleForm.center = null
  circleForm.centerText = ''
  circleForm.radius = 2
  circleForm.radius2 = null
  circleForm.radius3 = null
  circleForm.unit = 'km'
  
  // 重置字段选项
  populationFieldOptions.value = []
  selectedPopulationField.value = ''
  
  // 清除之前的人口分布图层
  if (populationLayerGroup) {
    map.removeLayer(populationLayerGroup)
    populationLayerGroup = null
  }
  
  // 立即显示提示和设置光标，不等待字段加载
  console.log('立即显示用户提示')
  ElMessage.info('请在地图上点击选择圆心位置')
  
  // 设置鼠标为十字光标
  const originalCursor = map.getContainer().style.cursor
  map.getContainer().style.cursor = 'crosshair'
  
  // 开始加载字段，显示加载进度
  // 清除之前的定时器（如果有）
  if (loadingTimer) {
    clearInterval(loadingTimer)
    loadingTimer = null
  }
  populationFieldLoading.value = true
  loadingElapsedSeconds.value = 0
  loadingTimer = setInterval(() => {
    loadingElapsedSeconds.value++
  }, 1000)

  // 异步加载统计字段选项（不阻塞用户界面）
  console.log('开始异步加载字段选项')
  setTimeout(async () => {
    try {
      const userId = localStorage.getItem('userId') || 1
      const listRes = await fetch(`/api/shapefiles?category=population`, {
        headers: { 'x-user-id': userId }
      })
      const listData = await listRes.json()
      const shapefiles = Array.isArray(listData) ? listData : (listData.data || [])

      const allFields = new Set()

      // 并行加载最多5个shapefile的字段（使用轻量级字段端点），每个请求2秒超时
      const maxFiles = Math.min(shapefiles.length, 5)
      const filePromises = shapefiles.slice(0, maxFiles).map(async (sf) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 2000)
        
        try {
          // 使用字段端点，只获取字段列表，不获取完整GeoJSON
          const sfRes = await fetch(`/api/shapefiles/${sf.id}/fields`, {
            headers: { 'x-user-id': userId },
            signal: controller.signal
          })
          clearTimeout(timeoutId)
          const sfData = await sfRes.json()
          if (sfData.success && sfData.data) {
            // 使用numericFields（数值字段），这些字段包含整数和浮点数
            const numericFields = sfData.data.numericFields || []
            return numericFields
          }
          return []
        } catch (e) {
          clearTimeout(timeoutId)
          console.warn(`获取 ${sf.name} 字段列表失败:`, e)
          return []
        }
      })
      
      // 等待所有请求完成
      const results = await Promise.allSettled(filePromises)
      results.forEach(result => {
        if (result.status === 'fulfilled') {
          result.value.forEach(f => allFields.add(f))
        }
      })
      
      // 过滤掉 RecID，并按优先级排序
      const filteredFields = Array.from(allFields)
        .filter(f => f !== 'RecID')
        .sort((a, b) => {
          // 优先选择 常住人口
          if (a === '常住人口') return -1
          if (b === '常住人口') return 1
          return 0
        })
      
      populationFieldOptions.value = filteredFields
      if (populationFieldOptions.value.length > 0) {
        // 默认选择 常住人口，如果不存在则选择第一个
        const defaultField = populationFieldOptions.value.find(f => f === '常住人口') 
          || populationFieldOptions.value[0]
        selectedPopulationField.value = defaultField
        console.log('字段加载完成，共', filteredFields.length, '个字段，默认选择:', defaultField)
      } else {
        console.log('字段加载完成，未找到可用字段')
      }
      // 加载完成，清除定时器
      populationFieldLoading.value = false
      if (loadingTimer) {
        clearInterval(loadingTimer)
        loadingTimer = null
      }
    } catch (e) {
      console.error('加载统计字段失败:', e)
      // 加载失败，清除定时器
      populationFieldLoading.value = false
      if (loadingTimer) {
        clearInterval(loadingTimer)
        loadingTimer = null
      }
    }
  }, 0)
  
  // 清除之前的临时标记
  if (tempPopulationMarker) {
    map.removeLayer(tempPopulationMarker)
    tempPopulationMarker = null
  }
  
  // 添加一次性地图点击监听
  map.once('click', (e) => {
    // 恢复原始光标
    map.getContainer().style.cursor = originalCursor
    
    circleForm.center = e.latlng
    circleForm.centerText = `${e.latlng.lng.toFixed(6)}, ${e.latlng.lat.toFixed(6)}`
    ElMessage.success(`已选择位置：${circleForm.centerText}`)
    
    // 在点击位置显示小图钉标记
    const pinIcon = L.divIcon({
      html: `<div style="
        width: 16px;
        height: 22px;
        position: relative;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
      ">
        <svg viewBox="0 0 24 40" width="16" height="22" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 28 12 28s12-19 12-28c0-6.6-5.4-12-12-12z" fill="#ef4444"/>
          <circle cx="12" cy="12" r="4" fill="white"/>
        </svg>
      </div>`,
      className: '',
      iconSize: [16, 22],
      iconAnchor: [8, 22],
      popupAnchor: [0, -22]
    })
    
    tempPopulationMarker = L.marker([e.latlng.lat, e.latlng.lng], {
      icon: pinIcon,
      zIndexOffset: 1000,
      isCenterMarker: true  // 自定义属性，用于识别圆心标记
    }).addTo(map)
    
    // 用户点击地图后，才打开对话框
    circleDialogVisible.value = true
  })
}

// 门店popup"人口分布"按钮 - 直接以门店坐标为圆心打开对话框
const openStorePopulationDistribution = async (lat, lng, radius = 2) => {
  if (!map) return

  // 关闭商圈工具面板
  businessCircleExpanded.value = false

  // 设置为人口分布模式
  circleDialogMode.value = 'population'

  // 直接使用门店坐标作为圆心（不需要点击地图）
  circleForm.center = { lat, lng }
  circleForm.centerText = `${lng.toFixed(6)}, ${lat.toFixed(6)}`
  circleForm.radius = typeof radius === 'number' && radius > 0 ? radius : 2
  circleForm.radius2 = null
  circleForm.radius3 = null
  circleForm.unit = 'km'

  // 重置字段选项
  populationFieldOptions.value = []
  selectedPopulationField.value = ''
  populationFieldLoading.value = false
  loadingElapsedSeconds.value = 0

  // 清除之前的人口分布图层
  if (populationLayerGroup) {
    map.removeLayer(populationLayerGroup)
    populationLayerGroup = null
  }

  // 清除之前的临时标记
  if (tempPopulationMarker) {
    map.removeLayer(tempPopulationMarker)
    tempPopulationMarker = null
  }

  // 加载统计字段选项（使用轻量级字段端点）
  try {
    const userId = localStorage.getItem('userId') || 1
    const listRes = await fetch(`/api/shapefiles?category=population`, {
      headers: { 'x-user-id': userId }
    })
    const listData = await listRes.json()
    const shapefiles = Array.isArray(listData) ? listData : (listData.data || [])

    const allFields = new Set()
    // 并行加载最多5个shapefile的字段（使用轻量级字段端点）
    const maxFiles = Math.min(shapefiles.length, 5)
    const filePromises = shapefiles.slice(0, maxFiles).map(async (sf) => {
      try {
        const sfRes = await fetch(`/api/shapefiles/${sf.id}/fields`, {
          headers: { 'x-user-id': userId }
        })
        const sfData = await sfRes.json()
        if (sfData.success && sfData.data) {
          // 使用numericFields（数值字段）
          const numericFields = sfData.data.numericFields || []
          return numericFields
        }
        return []
      } catch (e) {
        console.warn(`获取 ${sf.name} 字段列表失败:`, e)
        return []
      }
    })
    
    // 等待所有请求完成
    const results = await Promise.allSettled(filePromises)
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        result.value.forEach(f => allFields.add(f))
      }
    })

    const filteredFields = Array.from(allFields)
      .filter(f => f !== 'RecID')
      .sort((a, b) => {
        if (a === '常住人口') return -1
        if (b === '常住人口') return 1
        return 0
      })

    populationFieldOptions.value = filteredFields
    if (filteredFields.length > 0) {
      selectedPopulationField.value =
        filteredFields.find(f => f === '常住人口') || filteredFields[0]
    }
  } catch (e) {
    console.error('加载统计字段失败:', e)
  }

  // 直接打开对话框（无需点击地图）
  circleDialogVisible.value = true
}

// 门店popup"联通人口"按钮 - 打开联通人口对话框
const openStoreSmartsteps = (storeId) => {
  // 关闭其他面板
  smartstepsVisible.value = false
  businessCircleExpanded.value = false

  // 查找门店数据
  const store = markerStore.markers.find(m => m.id === storeId)
  if (!store) {
    ElMessage.error('未找到门店信息')
    return
  }

  // 设置选中的门店并打开对话框
  selectedStoreForSmartsteps.value = {
    id: store.id,
    name: store.name,
    latitude: store.latitude,
    longitude: store.longitude
  }
  storeSmartstepsVisible.value = true
}

// ====== 相似店（从门店弹窗进入，基准门店固定为当前门店） ======
const storeSimilarVisible = ref(false)
const storeSimilarBaseId = ref(null)
const storeSimilarBaseName = ref('')
const storeSimilarRadius = ref(null)
const storeSimilarRadiusOptions = ref([])
const storeSimilarLoading = ref(false)
const storeSimilarDone = ref(false)
const storeSimilarResults = ref([])

// 从购买履历读取所有可用半径（与 /data 相似店一致）
const loadStoreSimilarRadiusOptions = async () => {
  try {
    const res = await axios.get('/api/purchase/store-counts')
    const counts = res.data.counts || {}
    const storeNames = Object.keys(counts)
    const radiusSet = new Set()
    for (const name of storeNames.slice(0, 50)) {
      try {
        const r = await axios.get(`/api/purchase/by-store/${encodeURIComponent(name)}`)
        for (const p of (r.data?.purchases || [])) {
          let pr = p.radius
          try { pr = JSON.parse(pr) } catch (e) {}
          const radii = Array.isArray(pr) ? pr : [pr]
          radii.forEach(rd => { const n = Number(rd); if (n > 0) radiusSet.add(n) })
        }
      } catch (e) {}
    }
    storeSimilarRadiusOptions.value = [...radiusSet].sort((a, b) => a - b).map(r => Math.round(r / 100) / 10)
  } catch (e) {
    console.error('获取半径选项失败:', e)
  }
}

// 从 result_data 提取 1001 人口字段（与 /data 一致）
const extractPopDataFromMap = (resultData) => {
  if (!resultData) return null
  let apiResult = resultData
  if (typeof apiResult === 'string') { try { apiResult = JSON.parse(apiResult) } catch (e) { return null } }
  if (apiResult?.apiResult) apiResult = apiResult.apiResult
  const d = apiResult?.['1001']
  if (!d || typeof d !== 'object') return null
  const findField = (pattern) => {
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === 'number' && pattern.test(k)) return v
    }
    return null
  }
  return {
    visit: findField(/^P0_SUM\d*$/i),
    live: findField(/^P1_SUM\d*$/i),
    work: findField(/^P2_SUM\d*$/i),
    out: findField(/^P3_SUM\d*$/i),
    entertain: findField(/^P4_SUM\d*$/i)
  }
}

// 获取指定门店在指定半径下的人口数据
const fetchStorePopDataFromMap = async (storeName, radiusM) => {
  try {
    const res = await axios.get(`/api/purchase/by-store/${encodeURIComponent(storeName)}`)
    const purchases = res.data?.purchases || []
    let matched = null
    for (const p of purchases) {
      let pr = p.radius
      try { pr = JSON.parse(pr) } catch (e) {}
      const radii = Array.isArray(pr) ? pr : [pr]
      if (radii.some(r => Math.abs(Number(r) - radiusM) <= 500)) { matched = p; break }
    }
    if (!matched) return null
    const detailRes = await axios.get(`/api/purchase/${matched.id}`)
    const resultData = detailRes.data?.result_data
    if (!resultData) return null
    const pop = extractPopDataFromMap(resultData)
    if (!pop) return null
    return { visit: pop.visit || 0, live: pop.live || 0, work: pop.work || 0, out: pop.out || 0, entertain: pop.entertain || 0 }
  } catch (e) { return null }
}

// 相似度计算（欧氏距离归一化）
const calcStoreSimilarityFromMap = (base, other) => {
  const keys = ['visit', 'live', 'work', 'out', 'entertain']
  let sqSum = 0
  let weightSum = 0
  for (const k of keys) {
    const b = base[k] || 0
    const o = other[k] || 0
    const maxV = Math.max(b, o)
    if (maxV <= 0) continue
    const diff = Math.abs(b - o) / maxV
    sqSum += diff * diff
    weightSum += 1
  }
  if (weightSum === 0) return 0
  const dist = Math.sqrt(sqSum / weightSum)
  return Math.max(0, Math.round((1 - dist) * 100))
}

// 门店popup"相似店"按钮 - 以当前门店为基准，寻找数据相似的门店
const openStoreSimilarStores = (storeId) => {
  const store = markerStore.markers.find(m => m.id === storeId)
  if (!store) {
    ElMessage.error('未找到门店信息')
    return
  }
  storeSimilarBaseId.value = store.id
  storeSimilarBaseName.value = store.name
  storeSimilarRadius.value = null
  storeSimilarRadiusOptions.value = []
  storeSimilarLoading.value = false
  storeSimilarDone.value = false
  storeSimilarResults.value = []
  storeSimilarVisible.value = true
  loadStoreSimilarRadiusOptions()
}

const startStoreSimilarFromMap = async () => {
  if (!storeSimilarRadius.value) { ElMessage.warning('请选择分析半径'); return }
  storeSimilarLoading.value = true
  storeSimilarDone.value = false

  try {
    const radiusM = storeSimilarRadius.value * 1000
    const baseStore = markerStore.markers.find(m => m.id === storeSimilarBaseId.value)
    if (!baseStore) { ElMessage.error('未找到基准门店'); return }

    const basePop = await fetchStorePopDataFromMap(baseStore.name, radiusM)
    if (!basePop) {
      ElMessage.warning(`基准门店「${baseStore.name}」在该半径下无购买履历数据`)
      storeSimilarLoading.value = false
      return
    }

    const candidates = markerStore.markers.filter(s => s.id !== baseStore.id)
    const results = []
    const batchSize = 5
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize)
      const batchResults = await Promise.all(batch.map(async (store) => {
        const pop = await fetchStorePopDataFromMap(store.name, radiusM)
        if (!pop) return null
        return {
          name: store.name,
          brand: store.brand || '-',
          visit: pop.visit, live: pop.live, work: pop.work,
          similarity: calcStoreSimilarityFromMap(basePop, pop)
        }
      }))
      results.push(...batchResults.filter(Boolean))
    }

    results.sort((a, b) => b.similarity - a.similarity)
    storeSimilarResults.value = results.slice(0, 15)
    storeSimilarDone.value = true
    if (results.length === 0) {
      ElMessage.info('未找到在相同半径下有购买履历的其他门店')
    }
  } catch (e) {
    console.error('寻找相似店失败:', e)
    ElMessage.error('寻找相似店失败: ' + (e.response?.data?.message || e.message))
  } finally {
    storeSimilarLoading.value = false
  }
}

const resetStoreSimilarDialog = () => {
  storeSimilarVisible.value = false
  storeSimilarDone.value = false
  storeSimilarResults.value = []
}

// 门店popup"竞品分布"按钮 - 以门店坐标为圆心分析周边竞品
const openStoreCompetitors = (lat, lng) => {
  if (!map) return
  businessCircleExpanded.value = false
  circleDialogMode.value = 'stores'
  circleForm.center = { lat, lng }
  circleForm.centerText = `${lng.toFixed(6)}, ${lat.toFixed(6)}`
  circleForm.radius = 2
  circleForm.radius2 = null
  circleForm.radius3 = null
  circleForm.unit = 'km'
  circleDialogVisible.value = true
}

// 门店popup"周边检索"按钮 - 以门店坐标为圆心进行POI检索
const openStorePoiSearch = async (lat, lng) => {
  if (!map) return
  try {
    const { value: keyword } = await ElMessageBox.prompt('请输入搜索关键词', '周边检索', {
      confirmButtonText: '下一步',
      cancelButtonText: '取消',
      inputValue: '餐饮',
      inputPlaceholder: '如：咖啡厅、餐厅'
    })
    if (!keyword || !keyword.trim()) return

    const { value: radiusKm } = await ElMessageBox.prompt('请输入搜索半径（公里）', '设置半径', {
      confirmButtonText: '搜索',
      cancelButtonText: '取消',
      inputValue: '2',
      inputPattern: /^\d+(\.\d+)?$/,
      inputErrorMessage: '请输入有效的数字'
    })
    if (!radiusKm) return

    const radiusM = Math.round(parseFloat(radiusKm) * 1000)

    // 清除之前的POI标记
    poiResultVisible.value = false
    poiMarkers.value.forEach(m => map.removeLayer(m))
    poiMarkers.value = []
    if (poiCenterMarker) { map.removeLayer(poiCenterMarker); poiCenterMarker = null }
    if (poiRadiusCircle) { map.removeLayer(poiRadiusCircle); poiRadiusCircle = null }
    if (tempCircleMarker) { map.removeLayer(tempCircleMarker); tempCircleMarker = null }

    // 绘制半径圆（紫色虚线）
    poiRadiusCircle = L.circle([lat, lng], {
      radius: radiusM,
      color: '#6366f1',
      fillColor: '#6366f1',
      fillOpacity: 0.1,
      weight: 2,
      dashArray: '5, 5'
    }).addTo(map)
    poiRadiusCircle.on('click', () => { poiResultVisible.value = true })

    // 执行API搜索
    const loadingMsg = ElMessage({ type: 'loading', message: '搜索中...', duration: 0 })
    const response = await fetch('/api/poi/around', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lng, lat, radius: radiusM, keywords: keyword.trim() })
    })
    const result = await response.json()
    loadingMsg.close()

    if (result.error) { ElMessage.error(result.error); return }

    poiResults.value = result.pois || []
    poiResultVisible.value = true
    showPoiOnMap(result.pois, lat, lng, radiusM)
    ElMessage.success(`找到 ${result.pois ? result.pois.length : 0} 个结果`)
  } catch (err) {
    if (err === 'cancel') return
    console.error('[Store PoiSearch]', err)
    const errMsg = err.message || (typeof err === 'string' ? err : '请检查网络连接或稍后重试')
    ElMessage.error(`搜索失败：${errMsg}`)
  }
}

// 门店评分表（从门店popup调用）
// ====== 共用门店弹窗HTML（三处统一，改一处即全部生效） ======
function getStorePopupHtml(markerData) {
  const isClosed = isStoreClosed(markerData.store_status)
  return `
    <div style="min-width: 232px; font-size: 13px;${isClosed ? ' opacity: 0.6;' : ''}">
      <h4 style="margin: 0 0 8px 0; color: #333;">${markerData.brand || ''} ${markerData.name}</h4>
      <p style="margin: 4px 0;"><strong>编号:</strong> ${markerData.store_code || '-'}</p>
      <p style="margin: 4px 0;"><strong>类型:</strong> <span style="color: ${markerData.store_type === '已开业' ? '#67c23a' : markerData.store_type === '重点候选' ? '#f56c6c' : '#e6a23c'}">${markerData.store_type || '-'}</span></p>
      <p style="margin: 4px 0;"><strong>门店状态:</strong> ${markerData.store_status || '-'}</p>
      <p style="margin: 4px 0;"><strong>商场类型:</strong> ${markerData.mall_type || '-'}</p>
      <p style="margin: 4px 0;"><strong>商圈类型:</strong> ${markerData.trade_area_type || '-'}</p>
      ${markerData.store_area ? `<p style="margin: 4px 0;"><strong>面积:</strong> ${markerData.store_area}㎡</p>` : ''}
      ${markerData.seats ? `<p style="margin: 4px 0;"><strong>座位:</strong> ${markerData.seats}个</p>` : ''}
      ${markerData.frontage ? `<p style="margin: 4px 0;"><strong>门幅面积:</strong> ${markerData.frontage}㎡</p>` : ''}
      ${markerData.open_date ? `<p style="margin: 4px 0;"><strong>开业:</strong> ${markerData.open_date}</p>` : ''}
      ${markerData.business_hours ? `<p style="margin: 4px 0;"><strong>营业:</strong> ${markerData.business_hours}</p>` : ''}
      ${markerData.description ? `<p style="margin: 4px 0;"><strong>备注:</strong> ${markerData.description}</p>` : ''}
      <div id="store-sales-${markerData.id}" style="margin: 8px 0 2px; padding: 6px 8px; background: #f5f7fa; border-radius: 6px; font-size: 12px; color: #909399;">销售数据加载中…</div>
      <div style="margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap;">
        <button onclick="window.editMarkerExternal(${markerData.id})" style="padding: 4px 10px; cursor: pointer; background: #409eff; color: white; border: none; border-radius: 4px; font-size: 12px;">编辑</button>
        <button onclick="window.deleteMarkerExternal(${markerData.id})" style="padding: 4px 10px; cursor: pointer; background: #b0b0b0; color: white; border: none; border-radius: 4px; font-size: 12px;">删除</button>
        <button onclick="window.openStoreSmartsteps(${markerData.id})" style="padding: 4px 10px; cursor: pointer; background: #e07070; color: white; border: none; border-radius: 4px; font-size: 12px;">联通人口</button>
        <button onclick="window.openStoreSimilarStores(${markerData.id})" style="padding: 4px 10px; cursor: pointer; background: #e6a23c; color: white; border: none; border-radius: 4px; font-size: 12px;">相似店</button>
        <button onclick="window.openStorePopulationDistribution(${markerData.latitude}, ${markerData.longitude})" style="padding: 4px 10px; cursor: pointer; background: #1abc9c; color: white; border: none; border-radius: 4px; font-size: 12px;">人口分布</button>
        <button onclick="window.openStoreCompetitors(${markerData.latitude}, ${markerData.longitude})" style="padding: 4px 10px; cursor: pointer; background: #1abc9c; color: white; border: none; border-radius: 4px; font-size: 12px;">竞品分布</button>
        <button onclick="window.openStorePoiSearch(${markerData.latitude}, ${markerData.longitude})" style="padding: 4px 10px; cursor: pointer; background: #6366f1; color: white; border: none; border-radius: 4px; font-size: 12px;">周边检索</button>
      </div>
      </div>
    </div>`
}

// 为门店 popup 异步加载月度销售数据（本年累计 + 近12月迷你条形 + 坪效）
async function loadStoreSalesIntoPopup(storeId) {
  try {
    const res = await axios.get(`/api/store-sales/stores/${storeId}/history?months=12`)
    const d = res.data
    const el = document.getElementById(`store-sales-${storeId}`)
    if (!el) return
    if (!d || !d.success) { el.innerHTML = '📊 销售数据加载失败'; return }
    const has = (d.series || []).filter(s => s.salesAmount != null)
    // 仅有年度记录（month=0 按年录入）：直接显示年度销售额
    if (has.length === 0) {
      if (d.annual && d.annual.salesAmount) {
        const a = d.annual
        let html = `<div style="font-weight:500;color:#333;">📊 ${a.year} 年销售额 ¥${(a.salesAmount / 10000).toFixed(1)}万</div>`
        if (a.storeArea) {
          html += `<div style="margin-top:5px;color:#666;">坪效：¥${(a.salesAmount / a.storeArea).toFixed(0)}/㎡/年</div>`
        }
        el.innerHTML = html
      } else {
        el.innerHTML = '📊 暂无销售记录'
      }
      return
    }
    const max = Math.max(...has.map(s => s.salesAmount), 1)
    let html = `<div style="font-weight:500;color:#333;">📊 本年累计 ¥${(d.yearTotal / 10000).toFixed(1)}万</div>`
    html += `<div style="display:flex;align-items:flex-end;gap:3px;height:34px;margin-top:6px;">`
    d.series.forEach(s => {
      const filled = s.salesAmount != null
      const h = filled ? Math.max(5, Math.round(s.salesAmount / max * 30)) : 2
      const tip = `${s.year}-${String(s.month).padStart(2, '0')}：${filled ? '¥' + Number(s.salesAmount).toLocaleString() : '无'}`
      html += `<div title="${tip}" style="width:14px;height:${h}px;background:${filled ? '#409eff' : '#e3e6ea'};border-radius:2px;flex-shrink:0;"></div>`
    })
    html += `</div>`
    // 坪效（最近一个有面积且有销售额的月份）
    const lastWithArea = [...has].reverse().find(s => s.storeArea)
    if (lastWithArea) {
      const eff = lastWithArea.salesAmount / lastWithArea.storeArea
      html += `<div style="margin-top:5px;color:#666;">坪效（${lastWithArea.year}-${String(lastWithArea.month).padStart(2, '0')}）：¥${eff.toFixed(0)}/㎡</div>`
    }
    el.innerHTML = html
  } catch (e) {
    const el = document.getElementById(`store-sales-${storeId}`)
    if (el) el.innerHTML = '📊 暂无月度销售记录'
  }
}

// 为门店标记添加购买履历检查
function addStorePopupHistoryCheck(marker, storeName) {
  marker.on('popupopen', async () => {
    try {
      const res = await axios.get(`/api/purchase/by-store/${encodeURIComponent(storeName)}`)
      const hasHistory = (res.data?.purchases || []).length > 0
      if (hasHistory) {
        const titleEl = marker.getPopup().getElement()?.querySelector('h4')
        if (titleEl && !titleEl.querySelector('.star-icon')) {
          titleEl.innerHTML = `<span class="star-icon" title="该门店有购买记录">⭐</span> ` + titleEl.innerHTML
        }
      }
    } catch (e) {
      // 忽略购买履历查询失败
    }
  })
}

// 检查门店是否有购买履历
const storeHasPurchaseHistory = async (storeName) => {
  try {
    const res = await axios.get(`/api/purchase/by-store/${encodeURIComponent(storeName)}`)
    return (res.data?.purchases || []).length > 0
  } catch (e) {
    return false
  }
}

// 识别多边形要素的中心点
const getFeatureCenter = (feature) => {
  const geom = feature.geometry
  if (!geom) return null
  
  let coords = []
  if (geom.type === 'Polygon') {
    coords = geom.coordinates[0]
  } else if (geom.type === 'MultiPolygon') {
    coords = geom.coordinates[0][0]
  } else {
    return null
  }
  
  if (!coords || coords.length === 0) return null
  
  const lng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length
  const lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length
  return { lat, lng }
}

// 自动识别整数型统计字段（返回所有符合条件的字段列表）
const findAllIntegerFields = (features) => {
  if (!features || features.length === 0) return []
  
  const fieldCount = {}  // 统计每个字段出现整数值的次数
  
  // 检查前20个要素
  const sampleSize = Math.min(20, features.length)
  for (let i = 0; i < sampleSize; i++) {
    const props = features[i].properties || {}
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === '') continue
      
      // 检查是否为整数（允许0和负数）
      const num = parseFloat(value)
      if (!isNaN(num) && Number.isInteger(num)) {
        fieldCount[key] = (fieldCount[key] || 0) + 1
      }
    }
  }
  
  // 找到所有出现次数>=50%的整数型字段
  const validFields = []
  for (const [field, count] of Object.entries(fieldCount)) {
    if (count >= sampleSize * 0.5) {
      validFields.push(field)
    }
  }
  
  return validFields
}

// 获取单个整数型字段（兼容旧函数）
const findIntegerField = (features) => {
  const fields = findAllIntegerFields(features)
  return fields.length > 0 ? fields[0] : null
}

// WGS84转GCJ-02 (标准算法)
const wgs84ToGcj02 = (lng, lat) => {
  const PI = 3.1415926535897932384626
  const a = 6378245.0
  const ee = 0.00669342162296594323
  
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  
  const radLat = lat / 180.0 * PI
  let magic = Math.sin(radLat)
  magic = 1 - ee * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI)
  dLat = (dLat * 180.0) / (a * (1 - ee) / (magic * sqrtMagic) * PI)
  
  const mgLat = lat + dLat
  const mgLng = lng + dLng
  
  return [mgLng, mgLat]
}

const transformLat = (x, y) => {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0
  return ret
}

const transformLng = (x, y) => {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0
  return ret
}

// 转换坐标数组
const transformCoords = (coords) => {
  if (typeof coords[0] === 'number') {
    const [gcjLng, gcjLat] = wgs84ToGcj02(coords[0], coords[1])
    return [gcjLng, gcjLat]
  } else {
    return coords.map(c => transformCoords(c))
  }
}

// 分析人口分布 - 调用后端API（统一使用按面积比例计算）
const analyzePopulationDistribution = async () => {
  console.log('analyzePopulationDistribution开始执行')
  console.log('地图对象:', !!map, '地图ID:', map?._leaflet_id)
  console.log('圆心位置:', circleForm.center)
  console.log('选定字段:', selectedPopulationField.value)
  
  if (!circleForm.center) {
    ElMessage.warning('请先在地图上点击选择位置')
    return
  }

  if (!selectedPopulationField.value) {
    ElMessage.warning('请等待数据文件扫描完成')
    return
  }

  // 检查地图对象是否有效
  if (!map || !map.getCenter) {
    console.error('地图对象无效，无法进行分析')
    ElMessage.error('地图未初始化，请刷新页面重试')
    return
  }

  try {
    const userId = localStorage.getItem('userId') || 1
    const panelId = 'panel-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9) // 唯一ID用于关闭按钮
    
    // 添加超时控制（总超时30秒）
    const globalTimeout = 30000
    const startGlobalTime = Date.now()
    const checkTimeout = () => {
      if (Date.now() - startGlobalTime > globalTimeout) {
        throw new Error('分析超时，请缩小范围或减少半径数量')
      }
    }

    // 收集所有有效半径（米）
    const allRadiiMeters = []
    if (circleForm.radius) {
      allRadiiMeters.push(circleForm.unit === 'km' ? circleForm.radius * 1000 : circleForm.radius)
    }
    if (circleForm.radius2) {
      allRadiiMeters.push(circleForm.unit === 'km' ? circleForm.radius2 * 1000 : circleForm.radius2)
    }
    if (circleForm.radius3) {
      allRadiiMeters.push(circleForm.unit === 'km' ? circleForm.radius3 * 1000 : circleForm.radius3)
    }

    if (allRadiiMeters.length === 0) {
      ElMessage.warning('请至少设置一个半径')
      return
    }

    const maxRadiusMeters = Math.max(...allRadiiMeters)
    const centerLat = circleForm.center.lat
    const centerLng = circleForm.center.lng
    const fieldName = selectedPopulationField.value

    ElMessage.info('正在计算人口分布...')

    // 获取所有shapefile
    const listRes = await fetch(`/api/shapefiles?category=population`, {
      headers: { 'x-user-id': userId }
    })
    const listData = await listRes.json()
    const shapefiles = Array.isArray(listData) ? listData : (listData.data || [])
    console.log(`获取到${shapefiles.length}个shapefile:`, shapefiles.map(s => ({ id: s.id, name: s.name, city: s.city })))

    if (shapefiles.length === 0) {
      ElMessage.warning('没有找到上传的数据文件')
      return
    }

    // 每个半径的匹配结果
    const radiusResults = {}  // key: radiusInMeters

    // 并行调用所有半径的API（优化性能）
    const allMatchingFeatures = []  // 存储所有匹配的特征（用于绘制）
    console.log(`开始并行调用${allRadiiMeters.length}个半径的API`)
    
    // 为每个半径创建API调用Promise
    const apiPromises = allRadiiMeters.map(async (r) => {
      checkTimeout() // 检查超时
      console.log(`调用API: radius=${r}m, field=${fieldName}`)
      const startTime = Date.now()
      
      try {
        // 使用AbortController添加超时控制（15秒）
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000)
        
        const response = await fetch('/api/shapefiles/calculate-population', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': userId
          },
          body: JSON.stringify({
            lat: centerLat,
            lng: centerLng,
            radius: r,
            fieldName: fieldName
            // 不再传递city参数，后端自动处理
          }),
          signal: controller.signal
        })
        
        clearTimeout(timeoutId)
        const apiTime = Date.now() - startTime
        console.log(`半径${r}m API响应时间: ${apiTime}ms, 状态: ${response.status}`)

        if (!response.ok) {
          console.warn(`半径${r}m API调用失败: ${response.status} ${response.statusText}`)
          return { radius: r, success: false }
        }

        const apiResult = await response.json()
        console.log(`半径${r}m API结果:`, apiResult)
        
        if (apiResult.success && apiResult.data) {
          return { radius: r, success: true, data: apiResult.data }
        } else {
          return { radius: r, success: false, error: apiResult.error }
        }
      } catch (error) {
        const apiTime = Date.now() - startTime
        if (error.name === 'AbortError') {
          console.warn(`半径${r}m API调用超时 (${apiTime}ms)`)
        } else {
          console.error(`半径${r}m API调用异常:`, error)
        }
        return { radius: r, success: false, error: error.message }
      }
    })
    
    // 并行执行所有API调用
    const apiResults = await Promise.all(apiPromises)
    console.log('所有API调用完成:', apiResults)
    
    // 处理API结果
    apiResults.forEach(result => {
      if (result.success && result.data) {
        const r = result.radius
        const data = result.data
        
        if (!radiusResults[r]) {
          radiusResults[r] = { matchingData: [], allFields: {}, apiTotal: 0, apiAllFields: {} }
        }
        
        // 使用API返回的总计（与常住人口对比一致）
        radiusResults[r].apiTotal = data.total || 0
        
        // 使用API返回的其他字段总计
        if (data.allFields) {
          for (const [key, val] of Object.entries(data.allFields)) {
            radiusResults[r].apiAllFields[key] = val
          }
        }
        
        // 注意：这里不再加载和绘制多边形，因为API已经返回了总计
        // 如果需要绘制多边形，需要单独加载shapefile数据
        console.log(`半径${r}m: API总计=${data.total || 0}, 字段数=${Object.keys(data.allFields || {}).length}`)
        // 如果API返回了匹配的要素，直接使用它们
        if (data.matchedFeatures && data.matchedFeatures.length > 0) {
          console.log(`半径${r}m: API返回了${data.matchedFeatures.length}个匹配要素，直接用于绘制`)
          radiusResults[r].matchingData = data.matchedFeatures.map(mf => ({
            feature: mf.feature,
            value: mf.value,
            originalValue: mf.value,
            intersectionRatio: mf.coverageRatio,
            fieldName: fieldName,
            shapefileName: mf.feature.properties?.shapefileName || '未知',
            geom: mf.geom
          }))
        }
      }
    })
    
    // 对于最大半径，如果需要绘制多边形，则加载shapefile数据
    if (maxRadiusMeters > 0 && radiusResults[maxRadiusMeters]?.apiTotal > 0 && 
        (!radiusResults[maxRadiusMeters].matchingData || radiusResults[maxRadiusMeters].matchingData.length === 0)) {
      console.log('加载最大半径的shapefile数据用于绘制多边形')
      try {
        // 只加载第一个shapefile用于绘制（简化）
        const sf = shapefiles[0]
        if (sf) {
          const sfRes = await fetch(`/api/shapefiles/${sf.id}`, {
            headers: { 'x-user-id': userId }
          })
          const sfData = await sfRes.json()
          const geojson = sfData.data?.geojson || sfData.geojson
          
          if (geojson && geojson.features) {
            const features = geojson.features || []
            console.log(`加载了${features.length}个特征用于绘制`)
            
            // 为绘制收集匹配的特征
            features.forEach(feature => {
              const geom = feature.geometry
              const props = feature.properties || {}
              const rawValue = parseInt(props[fieldName]) || 0
              
              if (rawValue > 0 && isPolygonIntersectsCircle(geom, centerLat, centerLng, maxRadiusMeters)) {
                allMatchingFeatures.push({
                  feature, value: rawValue, geom, props
                })
                
                // 添加到matchingData用于绘制
                if (!radiusResults[maxRadiusMeters].matchingData) {
                  radiusResults[maxRadiusMeters].matchingData = []
                }
                radiusResults[maxRadiusMeters].matchingData.push({
                  feature, value: rawValue, originalValue: rawValue,
                  intersectionRatio: 1, fieldName, shapefileName: sf.name, geom
                })
                
                // 仅在无API字段数据时收集原始值（用于回退显示）
                const hasApiFields = radiusResults[maxRadiusMeters].apiAllFields && Object.keys(radiusResults[maxRadiusMeters].apiAllFields).length > 0
                if (!hasApiFields) {
                  for (const [key, val] of Object.entries(props)) {
                    if (val !== null && val !== undefined && Number.isInteger(Number(val))) {
                      if (!radiusResults[maxRadiusMeters].allFields[key]) {
                        radiusResults[maxRadiusMeters].allFields[key] = { total: 0, originalTotal: 0 }
                      }
                      const numVal = Number(val)
                      radiusResults[maxRadiusMeters].allFields[key].total += numVal
                      radiusResults[maxRadiusMeters].allFields[key].originalTotal += numVal
                    }
                  }
                }
              }
            })
          }
        }
      } catch (e) {
        console.error('加载shapefile用于绘制失败:', e)
        // 即使绘制失败，仍然可以使用API数据
      }
    }

    // 检查是否有数据
    console.log('半径结果统计:', Object.entries(radiusResults).map(([r, data]) => ({
      radius: r,
      matchingCount: data.matchingData?.length || 0,
      apiTotal: data.apiTotal || 0,
      hasApiFields: !!data.apiAllFields && Object.keys(data.apiAllFields).length > 0
    })))
    const hasData = Object.values(radiusResults).some(r => (r.matchingData?.length || 0) > 0 || (r.apiTotal || 0) > 0)
    if (!hasData) {
      console.warn('在所有设置的范围内没有找到有效数据')
      ElMessage.warning('在所有设置的范围内没有找到有效数据')
      return
    }
    console.log('找到数据，准备绘制图层')

    // 清除之前的人口分布图层
    console.log('清除之前的人口分布图层，populationLayerGroup:', !!populationLayerGroup)
    // 清除统计面板标记
    if (currentStatsPanelMarker && map.hasLayer(currentStatsPanelMarker)) {
      map.removeLayer(currentStatsPanelMarker)
      console.log('已移除旧统计面板')
    }
    currentStatsPanelMarker = null
    if (populationLayerGroup) {
      map.removeLayer(populationLayerGroup)
      console.log('已移除旧图层组')
    }
    console.log('创建新图层组，地图对象:', !!map)
    populationLayerGroup = L.featureGroup().addTo(map)
    console.log('图层组创建成功:', !!populationLayerGroup)
    console.log('图层组已添加到地图:', map.hasLayer(populationLayerGroup))

    // 绘制多边形（基于最大半径数据做颜色分级）
    const maxRadiusData = radiusResults[maxRadiusMeters] || { matchingData: [], allFields: {} }
    const scheme = POPULATION_COLOR_SCHEMES[populationColorScheme.value] || POPULATION_COLOR_SCHEMES['blue-green-yellow-orange-red']
    const colors = scheme.colors
    const allValues = maxRadiusData.matchingData.map(d => d.value)

    const getQuantile = (arr, q) => {
      if (arr.length === 0) return 0
      const sorted = [...arr].sort((a, b) => a - b)
      const pos = (sorted.length - 1) * q
      const base = Math.floor(pos)
      const rest = pos - base
      if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base])
      return sorted[base]
    }

    const thresholds = [
      getQuantile(allValues, 0), getQuantile(allValues, 0.2), getQuantile(allValues, 0.4),
      getQuantile(allValues, 0.6), getQuantile(allValues, 0.8), getQuantile(allValues, 1)
    ]

    const getColorByValue = (value) => {
      if (value <= thresholds[1]) return colors[0]
      if (value <= thresholds[2]) return colors[1]
      if (value <= thresholds[3]) return colors[2]
      if (value <= thresholds[4]) return colors[3]
      return colors[4]
    }

    // 使用API返回的总计（与常住人口对比一致），回退到前端总计
    const apiGrandTotal = maxRadiusData.apiTotal || 0
    const frontendGrandTotal = allValues.reduce((s, v) => s + v, 0)
    const grandTotal = apiGrandTotal > 0 ? apiGrandTotal : frontendGrandTotal

    // 绘制多边形
    console.log(`开始绘制多边形，共${maxRadiusData.matchingData.length}个`)
    let polygonCount = 0
    let labelCount = 0
    if (maxRadiusData.matchingData.length > 0) {
      maxRadiusData.matchingData.forEach((data, index) => {
      const { feature, value, geom } = data
      const props = feature.properties || {}
      const rawValue = parseInt(props[fieldName]) || 0  // 原始shapefile值
      const color = getColorByValue(rawValue)

      let latlngs = []
      if (geom.type === 'Polygon') {
        latlngs = geom.coordinates[0].map(c => [c[1], c[0]])
      } else if (geom.type === 'MultiPolygon') {
        latlngs = geom.coordinates[0][0].map(c => [c[1], c[0]])
      }

      if (latlngs.length > 0) {
        const polygon = L.polygon(latlngs, {
          color: '#888', weight: 1, fillColor: color, fillOpacity: 0.7
        })
        polygon.bindPopup(`
          <div style="font-size: 12px; min-width: 140px;">
            <strong>${props.name || props.NAME || `区域 ${index + 1}`}</strong><br/>
            <span style="color: #666;">${fieldName}:</span>
            <strong style="color: #e6a23c;">${rawValue.toLocaleString()}</strong><br/>
            <span style="color: #999; font-size: 11px;">
              占比: ${(value / (grandTotal || 1) * 100).toFixed(1)}%
            </span>
          </div>
        `)
        populationLayerGroup.addLayer(polygon)
        polygonCount++

        // 添加标签
        const polyCenter = getFeatureCenter(feature)
        if (polyCenter) {
          let displayValue = rawValue
          if (displayValue >= 10000) displayValue = (displayValue / 10000).toFixed(1) + '万'
          else if (rawValue >= 1000) displayValue = rawValue.toLocaleString()

          const labelMarker = L.marker([polyCenter.lat, polyCenter.lng], {
            icon: L.divIcon({
              className: 'population-label',
              html: `<div style="
                background: rgba(255,255,255,0.9);
                border: 1px solid ${color};
                border-radius: 4px;
                padding: 2px 6px;
                font-size: 11px;
                font-weight: bold;
                color: #333;
                white-space: nowrap;
                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                text-align: center;
              ">${displayValue}</div>`,
              iconSize: [60, 20],
              iconAnchor: [30, 10]
            })
          })
          populationLayerGroup.addLayer(labelMarker)
          labelCount++
        }
      }
    }) }
    console.log(`多边形绘制完成: ${polygonCount}个多边形, ${labelCount}个标签`)

    // 绘制所有半径圆（黑色加粗实线边框）
    const sortedRadii = [...allRadiiMeters].sort((a, b) => b - a)
    sortedRadii.forEach((r) => {
      const circle = L.circle([centerLat, centerLng], {
        radius: r,
        color: '#333333',
        fillColor: 'transparent',
        fillOpacity: 0,
        weight: 4,
        dashArray: null
      })
      populationLayerGroup.addLayer(circle)
    })

    // 圆心标记 - 创建更显眼的永久标记
    console.log('处理圆心标记，tempPopulationMarker:', !!tempPopulationMarker)
    // 不移除临时标记，让它保持在地图上
    // if (tempPopulationMarker) {
    //   console.log('移除临时人口分布标记，替换为永久圆心标记')
    //   map.removeLayer(tempPopulationMarker)
    //   tempPopulationMarker = null
    // }
    
    // 圆心标记处理：如果临时标记存在，使用临时标记（图钉图标）；否则创建图钉标记
    if (tempPopulationMarker) {
      // 将临时标记从地图移除，然后添加到图层组中
      map.removeLayer(tempPopulationMarker)
      populationLayerGroup.addLayer(tempPopulationMarker)
      tempPopulationMarker = null
      console.log('临时标记（图钉图标）已转移到图层组中')
    } else {
      // 创建图钉图标作为圆心标记（使用与临时标记相同的样式）
      const pinIcon = L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      })
      const centerMarker = L.marker([centerLat, centerLng], {
        icon: pinIcon,
        zIndexOffset: 1000,
        isCenterMarker: true  // 自定义属性，用于识别圆心标记
      })
      populationLayerGroup.addLayer(centerMarker)
      console.log('创建图钉图标作为圆心标记')
    }

    // 格式化数字（显示完整数值，不缩写万）
    const formatNumber = (num) => {
      return Math.round(num).toLocaleString()
    }

    // 计算面板位置（多边形最右边的点，如果无多边形则使用圆心右侧）
    let panelLatLng
    if (maxRadiusData.matchingData.length > 0) {
      const allPoints = []
      maxRadiusData.matchingData.forEach(data => {
        const geom = data.geom
        if (geom.type === 'Polygon') {
          geom.coordinates[0].forEach(c => allPoints.push([c[1], c[0]]))
        } else if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach(poly => poly[0].forEach(c => allPoints.push([c[1], c[0]])))
        }
      })
      let rightMostLng = centerLng
      let rightMostLat = centerLat
      allPoints.forEach(p => {
        if (p[1] > rightMostLng) {
          rightMostLng = p[1]
          rightMostLat = p[0]
        }
      })
      panelLatLng = [rightMostLat, rightMostLng + 0.003]
      console.log('基于多边形计算面板位置:', panelLatLng)
    } else {
      // 无多边形，将面板放在圆心右侧
      panelLatLng = [centerLat, centerLng + 0.01]
      console.log('无多边形，使用圆心右侧面板位置:', panelLatLng)
    }
    // 确保坐标有效
    if (isNaN(panelLatLng[0]) || isNaN(panelLatLng[1])) {
      console.warn('面板坐标无效，使用默认位置')
      panelLatLng = [centerLat, centerLng + 0.01]
    }

    // 收集所有字段（排除RecID和fieldName），优先使用API返回的字段
    const allFieldNames = new Set()
    sortedRadii.forEach(r => {
      const data = radiusResults[r]
      if (data && data.apiAllFields) {
        Object.keys(data.apiAllFields).forEach(k => {
          if (k !== 'RecID' && k !== fieldName) {
            allFieldNames.add(k)
          }
        })
      }
      // 如果API字段为空，回退到原始字段（用于绘制）
      if (data && data.allFields && Object.keys(data.apiAllFields || {}).length === 0) {
        Object.keys(data.allFields).forEach(k => {
          if (k !== 'RecID' && k !== fieldName) {
            allFieldNames.add(k)
          }
        })
      }
    })
    const fieldList = Array.from(allFieldNames).sort()

    // 构建统计面板HTML
    let statsHtml = `<div style="background:rgba(255,255,255,0.95);border:2px solid #333;border-radius:8px;padding:8px;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:grab;user-select:none;position:relative;">`
    statsHtml += `<div style="font-size:12px;font-weight:bold;color:#333;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:4px;display:flex;justify-content:space-between;align-items:center;">`
    statsHtml += `<span>📊 人口分布分析</span>`
    // 在标题下方显示设置的半径
    const radiiLabels = [circleForm.radius, circleForm.radius2, circleForm.radius3]
      .filter(r => r && r > 0)
      .map(r => r + circleForm.unit)
      .join(' / ')
    if (radiiLabels) {
      statsHtml += `<div style="font-size:10px;color:#909399;margin-top:1px;">半径: ${radiiLabels}</div>`
    }
    statsHtml += `<button id="close-stats-panel-${panelId}" style="background:none;border:none;cursor:pointer;font-size:14px;color:#999;padding:0;width:16px;height:16px;display:flex;align-items:center;justify-content:center;" title="关闭">×</button>`
    statsHtml += `</div>`

    // 表头
    statsHtml += `<table style="width:100%;border-collapse:collapse;font-size:10px;white-space:nowrap;">`
    statsHtml += `<tr style="background:#f5f7fa;">`
    statsHtml += `<th style="padding:4px 6px;text-align:left;border:1px solid #dcdfe6;">字段</th>`
    sortedRadii.forEach(r => {
      statsHtml += `<th style="padding:4px 6px;text-align:right;border:1px solid #dcdfe6;color:#666;">${(r / 1000).toFixed(1)}km</th>`
    })
    statsHtml += `</tr>`

    // 选定字段行（使用API返回的总计，与常住人口对比一致）
    statsHtml += `<tr style="background:#ecf5ff;">`
    statsHtml += `<td style="padding:4px 6px;border:1px solid #dcdfe6;font-weight:bold;">${fieldName}</td>`
    sortedRadii.forEach(r => {
      const data = radiusResults[r]
      // 优先使用API返回的总计，回退到前端计算的总计
      const apiTotal = data?.apiTotal || 0
      const frontendTotal = data ? data.matchingData.map(d => d.value).reduce((s, v) => s + v, 0) : 0
      console.log(`[dialog] radius=${r}m field=${fieldName} apiTotal=${apiTotal} frontendTotal=${frontendTotal}`)
      const displayTotal = apiTotal > 0 ? apiTotal : frontendTotal
      statsHtml += `<td style="padding:4px 6px;text-align:right;border:1px solid #dcdfe6;font-weight:bold;">${formatNumber(displayTotal)}</td>`
    })
    statsHtml += `</tr>`

    // 其他字段行（优先使用API返回的字段总计，与常住人口对比一致）
    fieldList.forEach(field => {
      statsHtml += `<tr>`
      statsHtml += `<td style="padding:4px 6px;border:1px solid #dcdfe6;color:#606266;">${field}</td>`
      sortedRadii.forEach(r => {
        const data = radiusResults[r]
        // 优先使用API返回的字段值，回退到前端计算的字段值
        const apiVal = data?.apiAllFields?.[field] || 0
        const frontendVal = data?.allFields?.[field]?.total || 0
        console.log(`[dialog] radius=${r}m field=${field} apiVal=${apiVal} frontendVal=${frontendVal}`)
        const displayVal = apiVal > 0 ? apiVal : frontendVal
        statsHtml += `<td style="padding:4px 6px;text-align:right;border:1px solid #dcdfe6;">${formatNumber(displayVal)}</td>`
      })
      statsHtml += `</tr>`
    })

    statsHtml += `</table>`
    statsHtml += `<div style="margin-top:6px;padding-top:4px;border-top:1px dashed #eee;font-size:9px;color:#909399;text-align:center;">📋 可拖动调整位置</div>`
    statsHtml += `</div>`

    // 添加可拖动的统计面板
    const radiusCount = sortedRadii.length
    const panelWidth = radiusCount >= 3 ? 380 : radiusCount >= 2 ? 320 : 220
    const panelMarker = L.marker([panelLatLng[0], panelLatLng[1]], {
      icon: L.divIcon({
        className: 'draggable-panel',
        html: statsHtml,
        iconSize: [panelWidth, 'auto'],
        iconAnchor: [0, 0]
      }),
      draggable: true
    })
    panelMarker.on('dragend', (e) => {
      console.log('面板拖动到:', e.target.getLatLng())
    })
    // 面板置顶：提高 zIndexOffset，避免门店图标多时遮挡面板
    panelMarker.setZIndexOffset(10000)
    populationLayerGroup.addLayer(panelMarker)
    currentStatsPanelMarker = panelMarker

    // 绑定关闭按钮事件
    setTimeout(() => {
      const closeBtn = document.getElementById(`close-stats-panel-${panelId}`)
      if (closeBtn) {
        closeBtn.onclick = (event) => {
          event.stopPropagation() // 防止事件冒泡触发地图点击
          // 恢复地图光标样式
          if (map) map.getContainer().style.cursor = ''
          // 确保商圈人口分布对话框关闭
          circleDialogVisible.value = false
          console.log('关闭按钮点击，隐藏统计面板和网格，保留圆心标记和半径圆')
          // 1. 统计面板将随图层组一起隐藏，无需单独移除
          // 注意：panelMarker已在populationLayerGroup中，隐藏图层组即可隐藏面板
          // currentStatsPanelMarker 保持不变，以便后续引用
          
          // 2. 隐藏网格和统计面板，但保留圆心标记和半径圆
          if (populationLayerGroup && map.hasLayer(populationLayerGroup)) {
            // 找到圆心标记图层（通过自定义属性 isCenterMarker）
            let centerMarker = null
            // 找到所有半径圆图层（L.circle实例）
            const radiusCircles = []
            const layers = populationLayerGroup.getLayers ? populationLayerGroup.getLayers() : []
            layers.forEach(layer => {
              // 检查是否为圆心标记（通过自定义属性）
              if (layer.options && layer.options.isCenterMarker === true) {
                centerMarker = layer
              }
              // 检查是否为半径圆（L.circle实例）
              if (layer instanceof L.Circle) {
                radiusCircles.push(layer)
              }
            })
            
            // 将圆心标记从图层组中移除，并单独添加到地图上
            if (centerMarker) {
              populationLayerGroup.removeLayer(centerMarker)
              centerMarker.addTo(map)
              // 绑定点击事件：点击时重新显示网格和统计面板
              centerMarker.off('click') // 移除之前的点击事件
              centerMarker.on('click', () => {
                console.log('圆心标记被点击，重新显示网格和统计面板')
                // 将图层组添加到地图（显示网格和统计面板）
                if (populationLayerGroup && !map.hasLayer(populationLayerGroup)) {
                  populationLayerGroup.addTo(map)
                }
                // 恢复地图光标样式
                if (map) map.getContainer().style.cursor = ''
                // 确保对话框关闭
                circleDialogVisible.value = false
              })
            }
            
            // 将半径圆从图层组中移除，并单独添加到地图上（始终显示）
            radiusCircles.forEach(circle => {
              populationLayerGroup.removeLayer(circle)
              circle.addTo(map)
            })
            
            // 从地图上移除图层组（隐藏网格和统计面板）
            map.removeLayer(populationLayerGroup)
          }
          
          // 3. 重置分析完成标志，以便后续操作
          populationAnalysisCompleted.value = false
        }
      } else {
        console.warn('未找到关闭按钮')
      }
    }, 100)

    // 关闭对话框
    populationAnalysisCompleted.value = true  // 标记分析已完成，防止closeCircleDialog清除图层组
    circleDialogVisible.value = false
    businessCircleExpanded.value = false

    // 调整视图到覆盖区域
    console.log('调整地图视图')
    try {
      const circleBounds = L.circle([centerLat, centerLng], { radius: maxRadiusMeters }).getBounds()
      console.log('圆形边界:', circleBounds)
      
      // 如果多边形数量为0，直接使用圆形边界，避免图层边界计算错误
      if (maxRadiusData.matchingData.length === 0) {
        console.log('多边形数量为0，直接使用圆形边界调整视图')
        map.fitBounds(circleBounds, { padding: [50, 50] })
      } else {
        // 安全获取图层边界：检查populationLayerGroup是否存在且有图层
        let layerBounds = null
        if (populationLayerGroup && typeof populationLayerGroup.getBounds === 'function') {
          console.log('图层组存在，检查图层...')
          const layers = populationLayerGroup.getLayers ? populationLayerGroup.getLayers() : []
          console.log('图层组中的图层数量:', layers.length)
          if (layers && layers.length > 0) {
            console.log('尝试获取图层组边界...')
            try {
              layerBounds = populationLayerGroup.getBounds()
              console.log('图层组边界获取成功:', layerBounds)
            } catch (e) {
              console.warn('获取图层边界失败:', e)
              // 尝试手动计算边界
              console.log('尝试手动计算边界...')
              try {
                let bounds = null
                layers.forEach(layer => {
                  if (layer && typeof layer.getBounds === 'function') {
                    const layerBound = layer.getBounds()
                    if (layerBound && layerBound.isValid && layerBound.isValid()) {
                      if (!bounds) bounds = layerBound
                      else bounds.extend(layerBound)
                    }
                  }
                })
                if (bounds) {
                  layerBounds = bounds
                  console.log('手动计算边界成功:', layerBounds)
                }
              } catch (e2) {
                console.warn('手动计算边界也失败:', e2)
              }
            }
          } else {
            console.log('图层组中没有图层，跳过获取边界')
          }
        }
        console.log('图层边界:', layerBounds)
        console.log('图层边界是否有效:', layerBounds && layerBounds.isValid && layerBounds.isValid())
        console.log('地图当前视图:', map.getCenter(), '缩放级别:', map.getZoom())
        
        if (layerBounds && layerBounds.isValid && layerBounds.isValid()) {
          console.log('调整视图到图层边界')
          map.fitBounds(layerBounds, { padding: [50, 50] })
        } else {
          console.log('调整视图到圆形边界')
          map.fitBounds(circleBounds, { padding: [50, 50] })
        }
      }
      console.log('视图调整后:', map.getCenter(), '缩放级别:', map.getZoom())
    } catch (e) {
      console.error('视图调整失败:', e)
      console.log('回退到默认视图')
      map.setView([centerLat, centerLng], 12)
    }

    console.log(`分析完成: 找到 ${grandTotal.toLocaleString()}（${fieldName}），共 ${allValues.length} 个多边形`)
    ElMessage.success(`找到 ${grandTotal.toLocaleString()}（${fieldName}），共 ${allValues.length} 个多边形`)

  } catch (error) {
    console.error('分析人口分布失败:', error)
    ElMessage.error('分析失败：' + error.message)
  }
  console.log('analyzePopulationDistribution函数执行结束')
}

// 计算两点之间的距离（米）- 使用Haversine公式
const getDistanceFromLatLng = (lat1, lng1, lat2, lng2) => {
  const R = 6371000 // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// 检测点是否在圆形内（使用球面距离）
const isPointInCircle = (pointLat, pointLng, centerLat, centerLng, radius) => {
  return getDistanceFromLatLng(centerLat, centerLng, pointLat, pointLng) <= radius
}

// 检测多边形是否与圆相交
const isPolygonIntersectsCircle = (geom, centerLat, centerLng, radius) => {
  let polygons = []
  
  if (geom.type === 'Polygon') {
    polygons = geom.coordinates
  } else if (geom.type === 'MultiPolygon') {
    polygons = geom.coordinates.flat()
  } else {
    return false
  }
  
  for (const ring of polygons) {
    for (const coord of ring) {
      // 检查多边形的每个顶点是否在圆内
      const [lng, lat] = coord
      if (isPointInCircle(lat, lng, centerLat, centerLng, radius)) {
        return true
      }
    }
    
    // 检查圆心是否在多边形内（射线法）
    if (isPointInPolygon(centerLng, centerLat, ring)) {
      return true
    }
  }
  
  // 检查多边形边是否与圆相交
  for (const ring of polygons) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [lng1, lat1] = ring[i]
      const [lng2, lat2] = ring[i + 1]
      if (isLineIntersectsCircle(lat1, lng1, lat2, lng2, centerLat, centerLng, radius)) {
        return true
      }
    }
  }
  
  return false
}

// 检测圆心是否在多边形内（射线法）
const isPointInPolygon = (x, y, ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

// 检测线段是否与圆相交
const isLineIntersectsCircle = (lat1, lng1, lat2, lng2, centerLat, centerLng, radius) => {
  // Haversine距离函数内联
  const dist = (p1lat, p1lng, p2lat, p2lng) => {
    const R = 6371000
    const dLat = (p2lat - p1lat) * Math.PI / 180
    const dLng = (p2lng - p1lng) * Math.PI / 180
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(p1lat * Math.PI / 180) * Math.cos(p2lat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2)
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
  
  // 检查线段两个端点是否在圆内
  if (dist(lat1, lng1, centerLat, centerLng) <= radius) return true
  if (dist(lat2, lng2, centerLat, centerLng) <= radius) return true
  
  // 检查线段是否穿过圆的边界
  const d = dist(lat1, lng1, lat2, lng2)
  if (d === 0) return false
  
  // 计算线段到圆心的最近点
  const t = Math.max(0, Math.min(1, 
    ((centerLat - lat1) * (lat2 - lat1) + (centerLng - lng1) * (lng2 - lng1)) / 
    (Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2))
  ))
  const closestLat = lat1 + t * (lat2 - lat1)
  const closestLng = lng1 + t * (lng2 - lng1)
  
  return dist(closestLat, closestLng, centerLat, centerLng) <= radius
}

// 计算多边形面积（平方米）- 使用球面近似公式
const calculatePolygonArea = (ring) => {
  if (!ring || ring.length < 3) return 0
  
  let area = 0
  const n = ring.length
  const R = 6371000  // 地球半径（米）
  
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[(i + 1) % n]
    
    const lat1Rad = lat1 * Math.PI / 180
    const lat2Rad = lat2 * Math.PI / 180
    const lng1Rad = lng1 * Math.PI / 180
    const lng2Rad = lng2 * Math.PI / 180
    
    area += (lng2Rad - lng1Rad) * (2 + Math.sin(lat1Rad) + Math.sin(lat2Rad))
  }
  
  area = Math.abs(area * R * R / 2)
  return area
}

// 计算多边形与圆的交集面积比例（使用Turf.js精确几何计算）
const calculateIntersectionRatio = (geom, centerLat, centerLng, radius) => {
  // 如果几何体无效，直接返回0
  if (!geom || !geom.coordinates || geom.coordinates.length === 0) return 0
  
  try {
    // 将GeoJSON几何体转换为Turf多边形
    let turfPolygon
    if (geom.type === 'Polygon') {
      turfPolygon = turf.polygon(geom.coordinates)
    } else if (geom.type === 'MultiPolygon') {
      // 使用第一个多边形（通常只有一个）
      turfPolygon = turf.polygon(geom.coordinates[0])
    } else {
      return 0
    }
    
    // 计算多边形面积（平方米）
    const polygonArea = turf.area(turfPolygon)
    if (polygonArea === 0) return 0
    
    // 创建圆形（Turf.circle半径单位为公里，需要从米转换）
    const radiusKm = radius / 1000
    const turfCircle = turf.circle([centerLng, centerLat], radiusKm, { steps: 64 })
    
    // 计算交集
    const intersection = turf.intersect(turfPolygon, turfCircle)
    
    // 如果没有交集，返回0
    if (!intersection) return 0
    
    // 计算交集面积（平方米）
    const intersectionArea = turf.area(intersection)
    
    // 返回交集面积占多边形面积的比例
    return intersectionArea / polygonArea
  } catch (error) {
    console.error('Turf.js计算交集面积失败:', error)
    // 出错时返回保守估计0.5，避免影响整体计算
    return 0.5
  }
}

// 关闭分析对话框（同时关闭圆形设置对话框）
const closeAnalysisDialog = () => {
  circleAnalysisVisible.value = false
  circleDialogVisible.value = false
}

// 在地图上显示分析圆形和门店
const showCircleOnMap = () => {
  if (!map || !circleAnalysisParams.center || !circleAnalysisParams.radius) return

  // 关闭对话框
  circleAnalysisVisible.value = false

  // 清除之前的分析图层
  if (analysisCircleLayer) {
    map.removeLayer(analysisCircleLayer)
  }
  analysisCircleLayer = new L.LayerGroup()
  analysisCircleLayer.addTo(map)

  // 绘制所有半径圆
  const radii = circleAnalysisParams.radii || [circleAnalysisParams.radius]
  radii.forEach((r, idx) => {
    const circle = L.circle([circleAnalysisParams.center.lat, circleAnalysisParams.center.lng], {
      radius: r,
      color: '#f56c6c',
      fillColor: '#f56c6c',
      fillOpacity: 0.1 + idx * 0.05,
      weight: 2
    })
    circle.bindTooltip(`半径${r >= 1000 ? (r / 1000) + 'km' : r + 'm'}`, { sticky: true })
    analysisCircleLayer.addLayer(circle)
  })

  // 绘制圆心标记
  const centerMarker = L.marker([circleAnalysisParams.center.lat, circleAnalysisParams.center.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div style="background:#fff;color:#f56c6c;width:14px;height:14px;border:2px solid #f56c6c;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    })
  })
  analysisCircleLayer.addLayer(centerMarker)

  // 如果"我的门店"图层已开启，则不重复显示（避免标记重叠）
  const showMyStores = !showBusinessLayer.value
  
  // 添加圆形内的我的门店标记（如果图层未开启则显示）
  if (showMyStores) {
    circleAnalysisData.myStoresFull.forEach((store, index) => {
      // 优先使用品牌图标，否则使用当前图标样式
      const brandIconUrl = brandIconMap.value[store.brand]
      const icon = brandIconUrl 
        ? createBrandImageIcon(brandIconUrl, false, null, null, store.brand) 
        : createCustomIcon(getStatusColor(store.store_type), currentMarkerStyle.value)
      const marker = L.marker([store.latitude, store.longitude], { icon })
      marker.bindPopup(`<b>${store.name}</b><br>品牌: ${store.brand || '-'}<br>距圆心: ${store.distance < 1000 ? `${store.distance.toFixed(0)}米` : `${(store.distance / 1000).toFixed(2)}公里`}`)
      analysisCircleLayer.addLayer(marker)
    })
  }

  // 添加圆形内的竞品门店标记
  const competitorBrandColors = {
    '大米先生': '#e6a23c',
    '谷田稻香': '#f56c6c',
    '吉野家': '#409eff',
    '老乡鸡': '#67c23a',
    '米村拌饭': '#9c27b0',
    '其他': '#ff9800'
  }
  const getCompBrandColor = (brand) => {
    if (!brand) return competitorBrandColors['其他']
    for (const key in competitorBrandColors) {
      if (brand.includes(key) || key.includes(brand)) {
        return competitorBrandColors[key]
      }
    }
    return competitorBrandColors['其他']
  }

  circleAnalysisData.competitorStoresFull.forEach((store) => {
    const brandColor = getCompBrandColor(store.brand)
    // 优先使用品牌图标，否则使用颜色圆点图标
    const brandIconUrl = brandIconMap.value[store.brand]
    const icon = brandIconUrl ? createBrandImageIcon(brandIconUrl, false, null, null, store.brand) : createSvgIcon(brandColor, 'dot', 1.2)
    const marker = L.marker([store.latitude, store.longitude], { icon })
    marker.bindPopup(`<b>${store.name}</b><br>品牌: ${store.brand || '-'}<br>距圆心: ${store.distance < 1000 ? `${store.distance.toFixed(0)}米` : `${(store.distance / 1000).toFixed(2)}公里`}`)
    analysisCircleLayer.addLayer(marker)
  })

  // 调整视图以包含所有元素（根据是否显示我的门店来决定）
  const myStorePoints = showMyStores 
    ? circleAnalysisData.myStoresFull.map(s => [s.latitude, s.longitude])
    : []
  const allPoints = [
    [circleAnalysisParams.center.lat, circleAnalysisParams.center.lng],
    ...myStorePoints,
    ...circleAnalysisData.competitorStoresFull.map(s => [s.latitude, s.longitude])
  ]
  if (allPoints.length > 1) {
    map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] })
  } else {
    map.setView([circleAnalysisParams.center.lat, circleAnalysisParams.center.lng], 14)
  }

  ElMessage.success('已在地图上显示分析结果')
}

// 清除地图上的分析圆形、圆心与门店标记
const clearCircleAnalysisOnMap = () => {
  if (!map) return
  if (analysisCircleLayer) {
    try { map.removeLayer(analysisCircleLayer) } catch(e) {}
    analysisCircleLayer = null
  }
  circleAnalysisVisible.value = false
  circleDialogVisible.value = false
  ElMessage.success('已清除地图上的分析圆形与标记')
}

// 图标样式选项
const markerStyleOptions = [
  { value: 'store', label: '店铺', icon: '🏪' },
  { value: 'pin', label: '图钉', icon: '📍' },
  { value: 'dot', label: '圆点', icon: '🔵' },
  { value: 'diamond', label: '菱形', icon: '🔷' },
  { value: 'flag', label: '旗帜', icon: '🚩' },
  { value: 'star', label: '星形', icon: '⭐' }
]

// 地址搜索结果
const searchResults = ref([])
let searchMarkersLayer = null  // 地址搜索结果标记图层

// 当前城市名称
const currentCityName = ref('')

// 点位表单 - 门店管理
const markerForm = reactive({
  // 基础信息
  store_code: '',
  brand: '',
  name: '',
  store_type: '',
  // 地址信息
  city: '',
  district: '',
  area_manager: '',
  phone1: '',
  store_manager: '',
  phone2: '',
  address: '',
  // 经营信息
  open_date: '',
  business_hours: '',
  store_area: null,
  seats: null,
  frontage: null,
  store_category: '',
  store_status: '',
  mall_type: '',
  trade_area_type: '',
  description: '',
  // 系统字段
  latitude: 0,
  longitude: 0,
  status: '正常'
})

const markerRules = {
  name: [{ required: true, message: '请输入门店名称', trigger: 'blur' }],
  store_type: [{ required: true, message: '请选择门店类型', trigger: 'change' }]
}

// 底图瓦片配置
const baseMapTiles = {
  vec: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',
    subdomains: [1, 2, 3, 4]
  },
  img: {
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: [1, 2, 3, 4]
  },
  tencent: {
    url: 'https://rt{s}.map.gtimg.com/realtimerender?z={z}&x={x}&y={y}&type=vector&style=0',
    subdomains: ['0', '1', '2', '3']
  }
}

// 腾讯地图专用TileLayer（处理Y轴转换：TMS坐标系 y = 2^z - 1 - leaflet_y）
L.TencentTileLayer = L.TileLayer.extend({
  getTileUrl: function(tilePoint) {
    const z = tilePoint.z
    const x = tilePoint.x
    const y = Math.pow(2, z) - 1 - tilePoint.y
    const s = this._getSubdomain(tilePoint)
    const url = this._url
      .replace('{s}', s)
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y)
    return url
  }
})

L.tencentTileLayer = function(url, options) {
  return new L.TencentTileLayer(url, options)
}

// 默认位置（北京）
const DEFAULT_LAT = 39.9042
const DEFAULT_LNG = 116.4074
const DEFAULT_CITY = '北京市'

// 获取IP位置 - 通过后端接口（避免浏览器混合内容限制）
// PC端固定场所使用，localStorage 缓存30天，避免每次登录都定位
const IP_LOC_CACHE_KEY = '__ip_location'
const IP_LOC_CACHE_TTL = 30 * 24 * 60 * 60 * 1000 // 30天

const getLocationByIP = async () => {
  // 长期缓存：30天内不重复请求定位（使用场所固定）
  try {
    const cached = localStorage.getItem(IP_LOC_CACHE_KEY)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed.lat && parsed.lng && parsed.expireAt > Date.now()) {
        console.log('[IP定位] 使用长期缓存:', parsed.city)
        return parsed
      }
    }
  } catch (_) {}

  try {
    // 通过后端 /api/geocode/ip-location 获取位置
    // 后端会调用 HTTP 版本的 ip-api.com，不受浏览器 HTTPS 限制
    const response = await fetch('/api/geocode/ip-location')
    const data = await response.json()
    
    if (data.success && data.lat && data.lng) {
      console.log('[IP定位] 成功，位置:', data.city, '坐标:', data.lat, data.lng)
      const result = {
        lat: data.lat,
        lng: data.lng,
        city: data.city || DEFAULT_CITY,
        expireAt: Date.now() + IP_LOC_CACHE_TTL
      }
      // 写入长期缓存（30天）
      localStorage.setItem(IP_LOC_CACHE_KEY, JSON.stringify(result))
      return result
    } else {
      console.log('[IP定位] 后端返回失败:', data.message)
    }
  } catch (error) {
    console.log('[IP定位] 后端接口失败:', error.message)
  }
  
  console.log('[IP定位] 失败，使用默认位置')
  return null
}

// 浏览器定位（HTML5 Geolocation，更精准）
const getLocationByBrowser = () => {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        console.log('[浏览器定位] 成功:', latitude, longitude)
        resolve({ lat: latitude, lng: longitude, city: '' })
      },
      () => {
        console.log('[浏览器定位] 被拒绝或失败')
        resolve(null)
      },
      { timeout: 5000, enableHighAccuracy: false }
    )
  })
}

// 初始化地图
const initMap = async () => {
  // IP定位（有sessionStorage缓存，通常很快；城市名从IP获取）
  const ipLocation = await getLocationByIP()

  // 初始中心：IP定位坐标（无缓存时后端可能耗时，但比浏览器定位快）
  const centerLat = ipLocation ? ipLocation.lat : DEFAULT_LAT
  const centerLng = ipLocation ? ipLocation.lng : DEFAULT_LNG
  const currentCity = ipLocation ? ipLocation.city : DEFAULT_CITY

  // 更新城市显示
  currentCityName.value = currentCity

  // 主地图 - 使用简化的投影（适合国内地图）
  // 高德/腾讯/影像地图都使用GCJ-02坐标系
  // 检查 DOM 容器是否存在（组件可能已卸载）
  const mapContainer = document.getElementById('map')
  if (!mapContainer) {
    console.warn('[MapView] #map 容器不存在，跳过地图初始化')
    return
  }
  map = L.map('map', {
    center: [centerLat, centerLng],
    zoom: 12,
    zoomControl: false,
    // 关键：设置适合中国地图的坐标系统
    zoomSnap: 0.5,
    worldCopyJump: false
  })

  // 加载底图
  loadBaseMap()

  // 浏览器定位（后台执行，不阻塞地图初始化；授权后自动平移地图到精确位置）
  getLocationByBrowser().then((browserLocation) => {
    if (browserLocation && map) {
      map.setView([browserLocation.lat, browserLocation.lng], Math.max(map.getZoom(), 12))
      console.log('[浏览器定位] 地图已平移到精确位置')
    }
  })

  // 初始化绘制层
  drawnItems = new L.FeatureGroup()
  map.addLayer(drawnItems)

  // 鼠标移动显示坐标
  map.on('mousemove', (e) => {
    currentCoords.value = e.latlng
  })

      // 地图点击事件（在map创建完成后立即绑定，避免async竞态问题）
  map.on('click', handleMapClick)
  // 地图右键菜单：document 捕获阶段监听（捕获先于任何 stopPropagation 执行，
  // 彻底规避 Leaflet 内部元素对 contextmenu 的 stopPropagation 拦截）
  const mapContainerEl = map.getContainer()
  const onMapContextMenu = (ev) => {
    // 只响应地图区域内的右键（含地图内部 panes/marker）
    if (!mapContainerEl.contains(ev.target) && ev.target !== mapContainerEl) return
    ev.preventDefault()
    ev.stopPropagation()
    // 用 clientX/Y 减去容器左上角，精确换算容器内坐标（不依赖 offsetX，避免子元素偏移误差）
    const rect = mapContainerEl.getBoundingClientRect()
    contextMenu.latlng = map.containerPointToLatLng([ev.clientX - rect.left, ev.clientY - rect.top])
    // 菜单 fixed 定位（相对浏览器窗口），直接用 clientX/clientY
    let x = ev.clientX
    let y = ev.clientY
    // 边界修正：菜单宽约 140px 高约 170px
    const winW = window.innerWidth
    const winH = window.innerHeight
    if (x + 145 > winW) x = winW - 150
    if (y + 180 > winH) y = winH - 185
    contextMenu.x = x
    contextMenu.y = y
    contextMenu.visible = true
  }
  document.addEventListener('contextmenu', onMapContextMenu, true)
  onMapContextMenuRef = onMapContextMenu
  // 点击地图任意处隐藏右键菜单（用 click 而非 mousedown，避免右键自身触发）
  map.on('click', hideContextMenu)
  // 双击通过两次click间隔自己判断（Leaflet的dblclick事件不可靠）

  // 地图加载完成后修正尺寸（解决容器隐藏后显示的定位问题）
  setTimeout(() => {
    if (map) map.invalidateSize({ pan: false })
  }, 100)

  // 【性能优化】并行拉取所有数据 + 品牌图标
  await Promise.all([
    markerStore.fetchMarkers(),
    competitorStore.fetchCompetitors(),
    brandStoreStore.fetchBrandStores(),
    shoppingCenterStore.fetchShoppingCenters(),
    brandIconStore.fetchBrandIcons()
  ])

  // 只渲染我的门店（默认可见），其余图层懒加载
  await loadMarkers(true)  // true = 跳过 fetch（数据已并行拉取）
  // 竞品、品牌门店、购物中心由用户切换开关时懒加载
  
  // 如果初始状态是聚合模式，需要构建聚合图层
  if (showCluster.value) {
    buildAllStoreCluster()
  }
}

// 地址搜索（使用高德地图API，支持模糊检索）
const searchTimerRef = ref(null)
const searchAddress = async (keyword) => {
  if (!keyword || !keyword.trim()) {
    searchResults.value = []
    clearSearchMarkers()
    return
  }

  // 清除之前的定时器，实现防抖
  if (searchTimerRef.value) {
    clearTimeout(searchTimerRef.value)
    cleanupResources.timers.delete(searchTimerRef.value)
  }

  searchTimerRef.value = createSafeTimeout(async () => {
    try {
      const kw = keyword.trim()
      // 使用后端高德搜索建议API
      const response = await fetch(`/api/geocode/suggest?keyword=${encodeURIComponent(kw)}`)
      const data = await response.json()
      if (data.success && data.results && data.results.length > 0) {
        searchResults.value = data.results
        // 在地图上绘制搜索结果标记
        drawSearchMarkers(data.results)
      } else {
        searchResults.value = []
        clearSearchMarkers()
      }
    } catch (error) {
      console.error('搜索错误:', error)
      searchResults.value = []
      clearSearchMarkers()
    }
  }, 300) // 300ms 防抖
}

// 在地图上绘制搜索结果标记
const drawSearchMarkers = (results) => {
  clearSearchMarkers()
  // 清除旧的高亮标记
  if (window._searchHighlightMarker && map) {
    map.removeLayer(window._searchHighlightMarker)
    window._searchHighlightMarker = null
  }
  if (!map || !results || results.length === 0) return

  searchMarkersLayer = L.featureGroup().addTo(map)

  results.forEach((result, idx) => {
    if (!result.lat || !result.lon) return
    const lat = parseFloat(result.lat)
    const lon = parseFloat(result.lon)
    if (isNaN(lat) || isNaN(lon)) return

    const marker = L.marker([lat, lon], {
      title: result.name || result.display_name || '',
      icon: L.divIcon({
        className: 'search-result-marker',
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:#409eff;color:#fff;
          display:flex;align-items:center;justify-content:center;
          font-size:12px;font-weight:bold;
          box-shadow:0 2px 6px rgba(64,158,255,0.4);
          border:2px solid #fff;
          cursor:pointer;
        ">${idx + 1}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })
    })
      .bindTooltip(result.name || result.display_name || '', {
        direction: 'top',
        offset: [0, -14],
        className: 'search-tooltip'
      })
      .on('click', () => {
        goToLocation(result)
      })

    searchMarkersLayer.addLayer(marker)
  })

  // 将所有搜索结果缩放到视野内
  if (results.length > 0) {
    try {
      const bounds = searchMarkersLayer.getBounds()
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 })
      }
    } catch (_) {}
  }
}

// 清除搜索结果标记
const clearSearchMarkers = () => {
  if (searchMarkersLayer && map) {
    map.removeLayer(searchMarkersLayer)
    searchMarkersLayer = null
  }
}

// 回车键直接跳转到第一个结果
const handleEnterSearch = () => {
  if (searchResults.value.length > 0) {
    goToLocation(searchResults.value[0])
  }
}

// 跳转到搜索位置（高亮目标标记）
const goToLocation = (result) => {
  if (map && result.lat && result.lon) {
    map.setView([parseFloat(result.lat), parseFloat(result.lon)], 16)
    // 在目标位置添加高亮标记（始终显示，不自动移除）
    const marker = L.marker([parseFloat(result.lat), parseFloat(result.lon)], {
      icon: L.divIcon({
        className: 'search-highlight-marker',
        html: '<div style="background:#f56c6c;color:white;padding:6px 12px;border-radius:6px;font-size:13px;font-weight:600;box-shadow:0 3px 10px rgba(245,108,108,0.5);border:2px solid #fff;white-space:nowrap;">📍 ' + (result.name || result.display_name || '搜索结果') + '</div>',
        iconSize: ['auto', 34],
        iconAnchor: ['auto', 17]
      })
    }).addTo(map)
    // map操作不移除，搜索了新地点后自动覆盖
    window._searchHighlightMarker = marker
  }
}

// 缩放控制
const zoomIn = () => {
  if (map) map.zoomIn()
}

const zoomOut = () => {
  if (map) map.zoomOut()
}

// 加载底图
const loadBaseMap = () => {
  if (!map) return
  try {
    if (tileLayer) {
      map.removeLayer(tileLayer)
    }
    const config = baseMapTiles[baseMapType.value]
    
    // 腾讯地图使用自定义TileLayer处理Y轴转换
    // 高德地图添加className用于CSS灰度处理
    const tileClassName = baseMapType.value === 'vec' ? 'gaode-gray-tiles' : ''
    if (baseMapType.value === 'tencent') {
      tileLayer = L.tencentTileLayer(config.url, {
        subdomains: config.subdomains,
        maxZoom: 18,
        minZoom: 3,
        className: tileClassName
      })
    } else {
      tileLayer = L.tileLayer(config.url, {
        subdomains: config.subdomains,
        maxZoom: 18,
        minZoom: 3,
        className: tileClassName
      })
    }
    map.addLayer(tileLayer)
    
    // 底图切换后修正地图尺寸
    setTimeout(() => {
      if (map) map.invalidateSize({ pan: false })
    }, 100)
  } catch (e) {
    console.error('[loadBaseMap] 加载底图失败:', e)
  }
}

// 监控底图切换
watch(baseMapType, loadBaseMap)

// 加载点位
const loadMarkers = async (skipFetch = false) => {
  // 确保地图已初始化
  if (!map) {
    console.log('[loadMarkers] 地图未初始化，跳过')
    return
  }
  
  console.log('=== loadMarkers 开始 ===')
  if (!skipFetch) {
    await markerStore.fetchMarkers()
  }
  console.log('门店数据:', markerStore.markers)

  // 清除原有图层
  if (businessLayer) {
    try { map.removeLayer(businessLayer) } catch(e) {}
  }
  if (heatmapLayer) {
    try { map.removeLayer(heatmapLayer) } catch(e) {}
  }

  // 根据 visibleIds 过滤可见数据
  const visibleIds = markerStore.visibleIds
  let dataToShow = (visibleIds === null || visibleIds === undefined)
    ? markerStore.markers
    : markerStore.markers.filter(m => visibleIds.includes(m.id))

  // 门店状态筛选（在营/候选/在营+候选/停业）——统一走 filterStoreByStatus（与网点优化一致）
  if (myStoreStatusFilter.value !== 'all') {
    dataToShow = dataToShow.filter(filterStoreByStatus)
  }

  // 创建点位图层
  businessLayer = L.layerGroup()

  console.log('开始创建标记点, 数量:', dataToShow.length)

  dataToShow.forEach(markerData => {
    console.log('创建标记:', markerData.name, '坐标:', markerData.latitude, markerData.longitude)
    // 闭店门店图标变灰色
    const isClosed = isStoreClosed(markerData.store_status)
    // 候选门店（重点候选/一般候选）半透明虚线显示，便于与已开业区分
    const isCandidate = markerData.store_type === '重点候选' || markerData.store_type === '一般候选'
    const brandIconUrl = brandIconMap.value[markerData.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl, isClosed, getStoreTypeBorderColor(markerData.store_type), null, markerData.brand)
      : createSvgIcon(isClosed ? '#909399' : getStoreTypeColor(markerData.store_type), currentMarkerStyle.value)
    icon.options.className = 'custom-svg-marker' + (isCandidate && !isClosed ? ' candidate-marker' : '')

    const marker = L.marker([markerData.latitude, markerData.longitude], {
      icon,
      draggable: !mapLocked.value
    })

    marker.bindPopup(getStorePopupHtml(markerData))

    // popup打开时检查是否有购买履历并更新显示
    addStorePopupHistoryCheck(marker, markerData.name)

    // popup打开时加载月度销售数据（本年累计 + 近12月趋势 + 坪效）
    marker.on('popupopen', () => { loadStoreSalesIntoPopup(markerData.id) })

    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      // 停止事件传播，防止触发地图拖动
      L.DomEvent.stopPropagation(e)
    })

    // 拖拽结束更新坐标
    marker.on('dragend', async (e) => {
      
            // 🔒 地图锁定：锁定时恢复原位置并忽略（避免拖动地图时误触图标移动）
            if (mapLocked.value) {
              e.target.setLatLng([markerData.latitude, markerData.longitude])
              ElMessage.info('🔒 地图已锁定，已忽略图标拖动（地图右键菜单可解锁）')
              return
            }
      const latlng = e.target.getLatLng()
      // 检查位置是否真的变化了（阈值约11米）
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - markerData.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - markerData.longitude) > threshold

      if (latChanged || lngChanged) {
        // 位置有变化，询问用户确认
        const confirmed = await ElMessageBox.confirm(
          `确定要移动 "${markerData.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await markerStore.updateMarker(markerData.id, {
            latitude: latlng.lat,
            longitude: latlng.lng
          })
          ElMessage.success('坐标已更新')
        } else {
          // 用户取消，恢复原位置
          marker.setLatLng([markerData.latitude, markerData.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })

    marker._storeId = markerData.id
    businessLayer.addLayer(marker)
  })

  // 热力图（经典样式：蓝→红）
  const heatmapData = dataToShow.map(m => [m.latitude, m.longitude, 1])
  heatmapLayer = L.heatLayer(heatmapData, { radius: 40, blur: 10, maxZoom: 17, max: 1.0, minOpacity: 0.5, gradient: { 0.2: '#0066ff', 0.4: '#00ddff', 0.6: '#44dd44', 0.8: '#ffcc00', 1.0: '#ff3300' } })

  // 根据显示模式添加图层
  updateLayerDisplay()

  // 确保竞品图层在门店图层下方（如果竞品图层已创建）
  if (competitorLayer && map.hasLayer(competitorLayer)) {
    updateCompetitorDisplay()
  }
}

// 构建所有门店统一聚合图层
const buildAllStoreCluster = () => {
  console.log('[聚合] buildAllStoreCluster 开始')
  console.log('[聚合] 当前选择: 我的门店=', showBusinessLayer.value, '竞品=', showCompetitorLayer.value, '品牌门店=', showBrandStoreLayer.value, '购物中心=', showShoppingCenterLayer.value)
  if (!map) return
  
  if (allStoreClusterGroup) {
    try { map.removeLayer(allStoreClusterGroup) } catch(e) {}
  }
  
  allStoreClusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false
  })
  
  let totalCount = 0
  
  // 1. 我的门店（只有开关开启时才聚合）
  if (showBusinessLayer.value && markerStore.markers && markerStore.markers.length > 0) {
    const visibleIds = markerStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? markerStore.markers.filter(m => visibleIds.includes(m.id))
      : markerStore.markers
    console.log('[聚合] 我的门店:', data.length)
    data.forEach(m => {
      if (m.latitude && m.longitude) {
        const isClosed = isStoreClosed(m.store_status)
        const brandIconUrl = brandIconMap.value[m.brand]
        const icon = brandIconUrl ? createBrandImageIcon(brandIconUrl, isClosed, getStoreTypeBorderColor(m.store_type), null, m.brand) : createSvgIcon(isClosed ? '#909399' : getStoreTypeColor(m.store_type), 'dot', 1.2)
        const marker = L.marker([m.latitude, m.longitude], { icon })
        marker.bindPopup(`
          <div style="min-width: 200px; font-size: 13px;">
            <h4 style="margin: 0 0 6px 0; color: #333;">${m.brand || ''} ${m.name}</h4>
            <p style="margin: 3px 0;"><strong>类型:</strong> ${m.store_type || '-'}</p>
            <p style="margin: 3px 0;"><strong>门店状态:</strong> ${m.store_status || '-'}</p>
            <p style="margin: 3px 0;"><strong>商场类型:</strong> ${m.mall_type || '-'}</p>
            <p style="margin: 3px 0;"><strong>商圈类型:</strong> ${m.trade_area_type || '-'}</p>
            ${m.store_area ? `<p style="margin: 3px 0;"><strong>面积:</strong> ${m.store_area}㎡</p>` : ''}
            ${m.seats ? `<p style="margin: 3px 0;"><strong>座位:</strong> ${m.seats}个</p>` : ''}
          </div>
        `)
        allStoreClusterGroup.addLayer(marker)
        totalCount++
      }
    })
  }
  
  // 2. 竞品门店（只有开关开启时才聚合）
  if (showCompetitorLayer.value && competitorStore.competitors && competitorStore.competitors.length > 0) {
    const brandColors = { '大米先生': '#e6a23c', '谷田稻香': '#f56c6c', '吉野家': '#409eff', '老乡鸡': '#67c23a', '米村拌饭': '#9c27b0', '其他': '#ff9800' }
    const getBrandColor = (brand) => {
      if (!brand) return brandColors['其他']
      for (const key in brandColors) { if (brand.includes(key) || key.includes(brand)) return brandColors[key] }
      return brandColors['其他']
    }
    const visibleIds = competitorStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? competitorStore.competitors.filter(c => visibleIds.includes(c.id))
      : competitorStore.competitors
    console.log('[聚合] 竞品门店:', data.length)
    data.forEach(c => {
      if (c.latitude && c.longitude) {
        const brandIconUrl = brandIconMap.value[c.brand]
        const icon = brandIconUrl ? createBrandImageIcon(brandIconUrl, false, null, null, c.brand) : createSvgIcon(getBrandColor(c.brand), 'dot', 1.2)
        const marker = L.marker([c.latitude, c.longitude], { icon })
        marker.bindPopup(`<div style="color:${getBrandColor(c.brand)}"><b>竞品</b><br/>${c.brand || ''} ${c.name}<br/>${(c.city || '') + (c.district || '') + (c.address || '-')}</div>`)
        allStoreClusterGroup.addLayer(marker)
        totalCount++
      }
    })
  }
  
  // 3. 品牌门店（只有开关开启时才聚合）
  if (showBrandStoreLayer.value && brandStoreStore.brandStores && brandStoreStore.brandStores.length > 0) {
    console.log('[聚合] 品牌门店原始:', brandStoreStore.brandStores?.length || 0)
    const visibleIds = brandStoreStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? brandStoreStore.brandStores.filter(s => visibleIds.includes(s.id))
      : brandStoreStore.brandStores
    console.log('[聚合] 品牌门店:', data.length)
    data.forEach(s => {
      if (s.latitude && s.longitude) {
        const brandColor = s.icon_color || '#888888'
        const brandIconUrl = brandIconMap.value[s.brand]
        const icon = brandIconUrl ? createBrandImageIcon(brandIconUrl, false, null, null, store.brand) : createSvgIcon(brandColor, 'dot', 1.2)
        const marker = L.marker([s.latitude, s.longitude], { icon })
        marker.bindPopup(`<div style="color:${brandColor}"><b>品牌门店</b><br/>${s.brand || ''} ${s.name}<br/>${(s.city || '') + (s.district || '') + (s.address || '-')}</div>`)
        allStoreClusterGroup.addLayer(marker)
        totalCount++
      }
    })
  }
  
  // 4. 购物中心（只有开关开启时才聚合）
  if (showShoppingCenterLayer.value && shoppingCenterStore.shoppingCenters && shoppingCenterStore.shoppingCenters.length > 0) {
    const visibleIds = shoppingCenterStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? shoppingCenterStore.shoppingCenters.filter(s => visibleIds.includes(s.id))
      : shoppingCenterStore.shoppingCenters
    console.log('[聚合] 购物中心:', data.length)
    data.forEach(s => {
      if (s.latitude && s.longitude) {
        const icon = createSvgIcon('#9370db', 'star', 1.5)
        const marker = L.marker([s.latitude, s.longitude], { icon })
        marker.bindPopup(`<div style="color:#9370db"><b>购物中心</b><br/>${s.name}<br/>${s.grade || ''} ${s.address || ''}</div>`)
        allStoreClusterGroup.addLayer(marker)
        totalCount++
      }
    })
  }
  
  console.log('[聚合] 总计:', totalCount)
}

// 重载门店图层（供 watcher 调用）
const reloadBusinessLayer = () => {
  if (!map) {
    console.log('[reloadBusinessLayer] 地图未初始化，跳过')
    return
  }
  if (!businessLayer) return
  const wasOnMap = map.hasLayer(businessLayer)
  try { map.removeLayer(businessLayer) } catch(e) {}
  // 重新构建图层（从 store 取最新数据+过滤）
  const visibleIds = markerStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? markerStore.markers
    : markerStore.markers.filter(m => visibleIds.includes(m.id))

  businessLayer = L.layerGroup()
  dataToShow.forEach(markerData => {
    const isClosed = isStoreClosed(markerData.store_status)
    const brandIconUrl = brandIconMap.value[markerData.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl, isClosed, getStoreTypeBorderColor(markerData.store_type), null, markerData.brand)
      : createSvgIcon(isClosed ? '#909399' : getStoreTypeColor(markerData.store_type), currentMarkerStyle.value)
    const marker = L.marker([markerData.latitude, markerData.longitude], { icon, draggable: !mapLocked.value })
    marker.bindPopup(getStorePopupHtml(markerData))
    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })
    marker.on('dragend', async (e) => {
      
            // 🔒 地图锁定：锁定时恢复原位置并忽略（避免拖动地图时误触图标移动）
            if (mapLocked.value) {
              e.target.setLatLng([markerData.latitude, markerData.longitude])
              ElMessage.info('🔒 地图已锁定，已忽略图标拖动（地图右键菜单可解锁）')
              return
            }
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - markerData.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - markerData.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动 "${markerData.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await markerStore.updateMarker(markerData.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('坐标已更新')
        } else {
          marker.setLatLng([markerData.latitude, markerData.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })
    marker._storeId = markerData.id
    businessLayer.addLayer(marker)
  })

  // 热力图模式下重新构建（统一由buildAllStoreHeatmap处理）
  if (showHeatmap.value) {
    buildAllStoreHeatmap()
  }
  
  if (wasOnMap) {
    if (showHeatmap.value && heatmapLayer) {
      map.addLayer(heatmapLayer)
    } else {
      map.addLayer(businessLayer)
    }
  }
  updateLayerDisplay()
}

// 加载竞品门店
const loadCompetitors = async (skipFetch = false) => {
  // 确保地图已初始化
  if (!map) {
    console.log('[loadCompetitors] 地图未初始化，跳过')
    return
  }
  
  if (!skipFetch) {
    await competitorStore.fetchCompetitors()
  }
  console.log('竞品数据:', competitorStore.competitors)
  console.log('竞品数量:', competitorStore.competitors?.length || 0)

  // 清除原有竞品图层
  if (competitorLayer) {
    map.removeLayer(competitorLayer)
    competitorLayer = null
  }

  // 如果没有竞品数据，跳过
  if (!competitorStore.competitors || competitorStore.competitors.length === 0) {
    console.log('没有竞品数据')
    return
  }

  // 根据 visibleIds 过滤
  const visibleIds = competitorStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? competitorStore.competitors
    : competitorStore.competitors.filter(c => visibleIds.includes(c.id))

  // 创建竞品图层（超过 500 条自动聚合，避免大量 marker 导致卡顿）
  competitorLayer = dataToShow.length > 500
    ? L.markerClusterGroup({ chunkedLoading: true, spiderfyOnMaxZoom: true, showCoverageOnHover: false, maxClusterRadius: 50 })
    : L.layerGroup()

  // 竞品品牌颜色映射（避免暗色系，使用鲜艳颜色）
  const brandColors = {
    '大米先生': '#e6a23c',   // 橙色
    '谷田稻香': '#f56c6c',   // 红色
    '吉野家': '#409eff',     // 蓝色
    '老乡鸡': '#67c23a',     // 绿色
    '米村拌饭': '#9c27b0',   // 紫色
    '其他': '#ff9800'        // 橙色
  }

  // 根据品牌获取颜色
  const getBrandColor = (brand) => {
    if (!brand) return brandColors['其他']
    // 遍历品牌映射查找匹配
    for (const key in brandColors) {
      if (brand.includes(key) || key.includes(brand)) {
        return brandColors[key]
      }
    }
    return brandColors['其他']
  }

  dataToShow.forEach(comp => {
    console.log('创建竞品标记:', comp.name, comp.latitude, comp.longitude)
    // 有品牌图标优先用图片图标，否则用颜色圆点
    const brandColor = getBrandColor(comp.brand)
    const brandIconUrl = brandIconMap.value[comp.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl, false, null, null, comp.brand)
      : createSvgIcon(brandColor, 'dot', 1.2)

    const marker = L.marker([comp.latitude, comp.longitude], {
      icon,
      draggable: !mapLocked.value
    })

    marker.bindPopup(`
      <div style="min-width: 200px; font-size: 13px;">
        <h4 style="margin: 0 0 8px 0; color: ${brandColor};">🏪 ${comp.brand || ''} ${comp.name}</h4>
        <p style="margin: 4px 0;"><strong>类型:</strong> <span style="color: ${brandColor};">竞品</span></p>
        <p style="margin: 4px 0;"><strong>编号:</strong> ${comp.store_code || '-'}</p>
        <p style="margin: 4px 0;"><strong>地址:</strong> ${(comp.city || '') + (comp.district || '') + (comp.address || '-')}</p>
        ${comp.contact_person ? `<p style="margin: 4px 0;"><strong>联系人:</strong> ${comp.contact_person} ${comp.contact_phone || ''}</p>` : ''}
        ${comp.description ? `<p style="margin: 4px 0;"><strong>备注:</strong> ${comp.description}</p>` : ''}
      </div>
    `)

    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })

    // 拖拽结束更新坐标
    marker.on('dragend', async (e) => {
      
            // 🔒 地图锁定：锁定时恢复原位置并忽略（避免拖动地图时误触图标移动）
            if (mapLocked.value) {
              e.target.setLatLng([comp.latitude, comp.longitude])
              ElMessage.info('🔒 地图已锁定，已忽略图标拖动（地图右键菜单可解锁）')
              return
            }
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - comp.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - comp.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动竞品 "${comp.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await competitorStore.updateCompetitor(comp.id, {
            latitude: latlng.lat,
            longitude: latlng.lng
          })
          ElMessage.success('竞品坐标已更新')
        } else {
          marker.setLatLng([comp.latitude, comp.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })

    competitorLayer.addLayer(marker)
  })

  console.log('竞品图层创建完成, competitorLayer:', !!competitorLayer)
  // 根据显示模式添加竞品图层
  updateCompetitorDisplay()
}

// 重载竞品图层（供 watcher 调用）
const reloadCompetitorLayer = () => {
  if (!map || !competitorStore.competitors || competitorStore.competitors.length === 0) return
  const visibleIds = competitorStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? competitorStore.competitors
    : competitorStore.competitors.filter(c => visibleIds.includes(c.id))

  const wasOnMap = map.hasLayer(competitorLayer)
  if (competitorLayer) { try { map.removeLayer(competitorLayer) } catch(e) {} }

  competitorLayer = dataToShow.length > 500
    ? L.markerClusterGroup({ chunkedLoading: true, spiderfyOnMaxZoom: true, showCoverageOnHover: false, maxClusterRadius: 50 })
    : L.layerGroup()
  const brandColors = {
    '大米先生': '#e6a23c', '谷田稻香': '#f56c6c', '吉野家': '#409eff',
    '老乡鸡': '#67c23a', '米村拌饭': '#9c27b0', '其他': '#ff9800'
  }
  const getBrandColor = (brand) => {
    if (!brand) return brandColors['其他']
    for (const key in brandColors) {
      if (brand.includes(key) || key.includes(brand)) return brandColors[key]
    }
    return brandColors['其他']
  }

  dataToShow.forEach(comp => {
    const brandColor = getBrandColor(comp.brand)
    const brandIconUrl = brandIconMap.value[comp.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl, false, null, null, comp.brand)
      : createSvgIcon(brandColor, 'dot', 1.2)
    const marker = L.marker([comp.latitude, comp.longitude], { icon, draggable: !mapLocked.value })
    marker.bindPopup(`<div style="min-width:200px;font-size:13px;"><h4 style="margin:0 0 8px 0;color:${brandColor};">🏪 ${comp.brand || ''} ${comp.name}</h4><p style="margin:4px 0;"><strong>类型:</strong> <span style="color:${brandColor};">竞品</span></p><p style="margin:4px 0;"><strong>地址:</strong> ${(comp.city || '') + (comp.district || '') + (comp.address || '-')}</p></div>`)
    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })
    marker.on('dragend', async (e) => {
      
            // 🔒 地图锁定：锁定时恢复原位置并忽略（避免拖动地图时误触图标移动）
            if (mapLocked.value) {
              e.target.setLatLng([comp.latitude, comp.longitude])
              ElMessage.info('🔒 地图已锁定，已忽略图标拖动（地图右键菜单可解锁）')
              return
            }
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - comp.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - comp.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动竞品 "${comp.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await competitorStore.updateCompetitor(comp.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('竞品坐标已更新')
        } else {
          marker.setLatLng([comp.latitude, comp.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })
    competitorLayer.addLayer(marker)
  })

  if (wasOnMap && showCompetitorLayer.value) {
    map.addLayer(competitorLayer)
    competitorLayer.bringToBack()
  }
}

// 竞品开关切换处理
const onCompetitorToggleChange = (value) => {
  console.log('竞品开关切换:', value)
  updateCompetitorDisplay()
}

// 更新竞品图层显示
const updateCompetitorDisplay = () => {
  console.log('updateCompetitorDisplay called, showCompetitorLayer:', showCompetitorLayer.value)
  
  if (!map) {
    console.log('地图未初始化')
    return
  }
  
  if (!competitorLayer) {
    console.log('竞品图层未创建，跳过')
    return
  }

  if (showCompetitorLayer.value) {
    // 直接添加图层，不管之前状态如何
    try {
      map.addLayer(competitorLayer)
      console.log('竞品图层已添加')
      
      // 确保竞品在门店下方
      if (businessLayer && map.hasLayer(businessLayer)) {
        try {
          competitorLayer.bringToBack()
        } catch (e) {
          console.log('bringToBack 失败（非致命）:', e.message)
        }
      }
    } catch (e) {
      console.log('添加图层失败:', e.message)
    }
  } else {
    // 直接移除图层
    try {
      map.removeLayer(competitorLayer)
      console.log('竞品图层已移除')
    } catch (e) {
      console.log('移除图层失败:', e.message)
    }
  }
  
  // 聚合模式下同步更新聚合图层
  if (showCluster.value) buildAllStoreCluster()
}

// 加载品牌门店
const loadBrandStores = async (skipFetch = false) => {
  // 确保地图已初始化
  if (!map) {
    console.log('[loadBrandStores] 地图未初始化，跳过')
    return
  }
  
  if (!skipFetch) {
    await brandStoreStore.fetchBrandStores()
  }
  console.log('品牌门店数据:', brandStoreStore.brandStores)

  if (brandStoreLayer) {
    map.removeLayer(brandStoreLayer)
    brandStoreLayer = null
  }

  if (!brandStoreStore.brandStores || brandStoreStore.brandStores.length === 0) {
    console.log('没有品牌门店数据')
    return
  }

  // 根据 visibleIds 过滤
  const visibleIds = brandStoreStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? brandStoreStore.brandStores
    : brandStoreStore.brandStores.filter(s => visibleIds.includes(s.id))

  brandStoreLayer = dataToShow.length > 500
    ? L.markerClusterGroup({ chunkedLoading: true, spiderfyOnMaxZoom: true, showCoverageOnHover: false, maxClusterRadius: 50 })
    : L.layerGroup()
  brandMarkerMap = {}  // 清空映射表

  dataToShow.forEach(store => {
    const brandIconUrl = brandIconMap.value[store.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl, false, null, null, store.brand)
      : createSvgIcon(store.icon_color || '#409eff', 'diamond', 1)

    const marker = L.marker([store.latitude, store.longitude], { icon, draggable: !mapLocked.value })

    marker.bindPopup(`
      <div style="min-width: 200px; font-size: 13px;">
        <h4 style="margin: 0 0 8px 0; color: ${store.icon_color || '#409eff'};">🏪 ${store.brand || ''} ${store.name}</h4>
        <p style="margin: 4px 0;"><strong>类型:</strong> <span style="color: ${store.icon_color || '#409eff'};">品牌门店</span></p>
        <p style="margin: 4px 0;"><strong>编号:</strong> ${store.store_code || '-'}</p>
        <p style="margin: 4px 0;"><strong>地址:</strong> ${(store.city || '') + (store.district || '') + (store.address || '-')}</p>
        ${store.contact_person ? `<p style="margin: 4px 0;"><strong>联系人:</strong> ${store.contact_person} ${store.contact_phone || ''}</p>` : ''}
        ${store.description ? `<p style="margin: 4px 0;"><strong>备注:</strong> ${store.description}</p>` : ''}
      </div>
    `)

    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })

    marker.on('dragend', async (e) => {
      
            // 🔒 地图锁定：锁定时恢复原位置并忽略（避免拖动地图时误触图标移动）
            if (mapLocked.value) {
              e.target.setLatLng([store.latitude, store.longitude])
              ElMessage.info('🔒 地图已锁定，已忽略图标拖动（地图右键菜单可解锁）')
              return
            }
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - store.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - store.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动品牌门店 "${store.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await brandStoreStore.updateBrandStore(store.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('品牌门店坐标已更新')
        } else {
          marker.setLatLng([store.latitude, store.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })

    brandStoreLayer.addLayer(marker)
    brandMarkerMap[store.id] = marker  // 保存到映射表
  })

  updateBrandStoreDisplay()
}

// 重载品牌门店图层（供 watcher 调用）
const reloadBrandStoreLayer = () => {
  if (!map || !brandStoreStore.brandStores || brandStoreStore.brandStores.length === 0) return
  const visibleIds = brandStoreStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? brandStoreStore.brandStores
    : brandStoreStore.brandStores.filter(s => visibleIds.includes(s.id))

  const wasOnMap = map.hasLayer(brandStoreLayer)
  if (brandStoreLayer) { try { map.removeLayer(brandStoreLayer) } catch(e) {} }

  brandStoreLayer = dataToShow.length > 500
    ? L.markerClusterGroup({ chunkedLoading: true, spiderfyOnMaxZoom: true, showCoverageOnHover: false, maxClusterRadius: 50 })
    : L.layerGroup()
  brandMarkerMap = {}

  dataToShow.forEach(store => {
    const brandIconUrl = brandIconMap.value[store.brand]
    const icon = brandIconUrl
      ? createBrandImageIcon(brandIconUrl, false, null, null, store.brand)
      : createSvgIcon(store.icon_color || '#409eff', 'diamond', 1)
    const marker = L.marker([store.latitude, store.longitude], { icon, draggable: !mapLocked.value })
    marker.bindPopup(`<div style="min-width:200px;font-size:13px;"><h4 style="margin:0 0 8px 0;color:${store.icon_color || '#409eff'};">🏪 ${store.brand || ''} ${store.name}</h4><p style="margin:4px 0;"><strong>类型:</strong> <span style="color:${store.icon_color || '#409eff'};">品牌门店</span></p><p style="margin:4px 0;"><strong>地址:</strong> ${(store.city || '') + (store.district || '') + (store.address || '-')}</p></div>`)
    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })
    marker.on('dragend', async (e) => {
      
            // 🔒 地图锁定：锁定时恢复原位置并忽略（避免拖动地图时误触图标移动）
            if (mapLocked.value) {
              e.target.setLatLng([store.latitude, store.longitude])
              ElMessage.info('🔒 地图已锁定，已忽略图标拖动（地图右键菜单可解锁）')
              return
            }
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - store.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - store.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动品牌门店 "${store.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await brandStoreStore.updateBrandStore(store.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('品牌门店坐标已更新')
        } else {
          marker.setLatLng([store.latitude, store.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })
    brandStoreLayer.addLayer(marker)
    brandMarkerMap[store.id] = marker
  })

  if (wasOnMap && showBrandStoreLayer.value) {
    map.addLayer(brandStoreLayer)
    brandStoreLayer.bringToBack()
  }
}

// 品牌门店开关切换处理
const onBrandStoreToggleChange = () => {
  updateBrandStoreDisplay()
}

// 更新品牌门店图层显示
const updateBrandStoreDisplay = () => {
  if (!map) return
  if (!brandStoreLayer) return

  if (showBrandStoreLayer.value) {
    try { map.addLayer(brandStoreLayer) } catch(e) {}
    try { brandStoreLayer.bringToBack() } catch(e) {}
  } else {
    try { map.removeLayer(brandStoreLayer) } catch(e) {}
  }
  
  // 聚合模式下同步更新聚合图层
  if (showCluster.value) buildAllStoreCluster()
}

// 加载购物中心
const loadShoppingCenters = async (skipFetch = false) => {
  if (!map) {
    console.log('[loadShoppingCenters] 地图未初始化，跳过')
    return
  }
  
  if (!skipFetch) {
    await shoppingCenterStore.fetchShoppingCenters()
  }
  console.log('购物中心数据:', shoppingCenterStore.shoppingCenters)

  if (shoppingCenterLayer) {
    map.removeLayer(shoppingCenterLayer)
    shoppingCenterLayer = null
  }

  if (!shoppingCenterStore.shoppingCenters || shoppingCenterStore.shoppingCenters.length === 0) {
    console.log('没有购物中心数据')
    return
  }

  const visibleIds = shoppingCenterStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? shoppingCenterStore.shoppingCenters
    : shoppingCenterStore.shoppingCenters.filter(s => visibleIds.includes(s.id))

  shoppingCenterLayer = dataToShow.length > 500
    ? L.markerClusterGroup({ chunkedLoading: true, spiderfyOnMaxZoom: true, showCoverageOnHover: false, maxClusterRadius: 50 })
    : L.layerGroup()
  shoppingCenterMarkerMap = {}

  dataToShow.forEach(store => {
    const icon = createSvgIcon(store.icon_color || '#e6a23c', 'pin', 1.0)

    const popupContent = `
      <div style="min-width: 200px; font-size: 13px;">
        <h4 style="margin: 0 0 8px 0; color: ${store.icon_color || '#e6a23c'};">🏬 ${store.name}</h4>
        <p style="margin: 4px 0;"><strong>类型:</strong> <span style="color: ${store.icon_color || '#e6a23c'};">购物中心</span></p>
        <p style="margin: 4px 0;"><strong>编号:</strong> ${store.store_code || '-'}</p>
        <p style="margin: 4px 0;"><strong>分类:</strong> ${store.store_category || '-'}</p>
        <p style="margin: 4px 0;"><strong>地址:</strong> ${(store.city || '') + (store.district || '') + (store.address || '-')}</p>
        ${store.stars ? `<p style="margin: 4px 0;"><strong>星级:</strong> ⭐ ${store.stars}</p>` : ''}
        ${store.comments ? `<p style="margin: 4px 0;"><strong>评论数:</strong> ${store.comments.toLocaleString()}</p>` : ''}
        ${store.rank_info ? `<p style="margin: 4px 0;"><strong>榜单:</strong> ${store.rank_info}</p>` : ''}
      </div>
    `

    const marker = L.marker([store.latitude, store.longitude], { icon, draggable: !mapLocked.value })
    marker.bindPopup(popupContent)

    // 拖拽开始 - 阻止地图拖动
    marker.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
    })

    marker.on('dragend', async (e) => {
      
            // 🔒 地图锁定：锁定时恢复原位置并忽略（避免拖动地图时误触图标移动）
            if (mapLocked.value) {
              e.target.setLatLng([store.latitude, store.longitude])
              ElMessage.info('🔒 地图已锁定，已忽略图标拖动（地图右键菜单可解锁）')
              return
            }
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - store.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - store.longitude) > threshold

      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动购物中心 "${store.name}" 到新位置吗？`,
          '确认移动',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        ).then(() => true).catch(() => false)

        if (confirmed) {
          await shoppingCenterStore.updateShoppingCenter(store.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('购物中心坐标已更新')
        } else {
          marker.setLatLng([store.latitude, store.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })

    shoppingCenterLayer.addLayer(marker)
    shoppingCenterMarkerMap[store.id] = marker
  })

  updateShoppingCenterDisplay()
}

// 重载购物中心图层
const reloadShoppingCenterLayer = () => {
  if (!map || !shoppingCenterStore.shoppingCenters || shoppingCenterStore.shoppingCenters.length === 0) return
  const visibleIds = shoppingCenterStore.visibleIds
  const dataToShow = (visibleIds === null || visibleIds === undefined)
    ? shoppingCenterStore.shoppingCenters
    : shoppingCenterStore.shoppingCenters.filter(s => visibleIds.includes(s.id))

  const wasOnMap = map.hasLayer(shoppingCenterLayer)
  if (shoppingCenterLayer) { try { map.removeLayer(shoppingCenterLayer) } catch(e) {} }

  shoppingCenterLayer = dataToShow.length > 500
    ? L.markerClusterGroup({ chunkedLoading: true, spiderfyOnMaxZoom: true, showCoverageOnHover: false, maxClusterRadius: 50 })
    : L.layerGroup()
  shoppingCenterMarkerMap = {}

  dataToShow.forEach(store => {
    const icon = createSvgIcon(store.icon_color || '#e6a23c', 'pin', 1.0)
    const marker = L.marker([store.latitude, store.longitude], { icon, draggable: !mapLocked.value })
    marker.bindPopup(`<div style="min-width:200px;font-size:13px;"><h4 style="margin:0 0 8px 0;color:${store.icon_color || '#e6a23c'};">🏬 ${store.name}</h4><p style="margin:4px 0;"><strong>地址:</strong> ${(store.city || '') + (store.district || '') + (store.address || '-')}</p>${store.stars ? `<p style="margin:4px 0;"><strong>星级:</strong> ⭐ ${store.stars}</p>` : ''}${store.comments ? `<p style="margin:4px 0;"><strong>评论数:</strong> ${store.comments.toLocaleString()}</p>` : ''}</div>`)
    marker.on('mousedown', (e) => { L.DomEvent.stopPropagation(e) })
    marker.on('dragend', async (e) => {
      
            // 🔒 地图锁定：锁定时恢复原位置并忽略（避免拖动地图时误触图标移动）
            if (mapLocked.value) {
              e.target.setLatLng([store.latitude, store.longitude])
              ElMessage.info('🔒 地图已锁定，已忽略图标拖动（地图右键菜单可解锁）')
              return
            }
      const latlng = e.target.getLatLng()
      const threshold = 0.0001
      const latChanged = Math.abs(latlng.lat - store.latitude) > threshold
      const lngChanged = Math.abs(latlng.lng - store.longitude) > threshold
      if (latChanged || lngChanged) {
        const confirmed = await ElMessageBox.confirm(
          `确定要移动购物中心 "${store.name}" 到新位置吗？`,
          '确认移动', { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
        ).then(() => true).catch(() => false)
        if (confirmed) {
          await shoppingCenterStore.updateShoppingCenter(store.id, { latitude: latlng.lat, longitude: latlng.lng })
          ElMessage.success('购物中心坐标已更新')
        } else {
          marker.setLatLng([store.latitude, store.longitude])
          ElMessage.info('已取消移动')
        }
      }
    })
    shoppingCenterLayer.addLayer(marker)
    shoppingCenterMarkerMap[store.id] = marker
  })

  if (wasOnMap && showShoppingCenterLayer.value) {
    map.addLayer(shoppingCenterLayer)
    shoppingCenterLayer.bringToBack()
  }
}

// 更新购物中心图层显示
const updateShoppingCenterDisplay = () => {
  if (!map || !shoppingCenterLayer) return

  if (showShoppingCenterLayer.value) {
    try { map.addLayer(shoppingCenterLayer) } catch(e) {}
    try { shoppingCenterLayer.bringToBack() } catch(e) {}
  } else {
    try { map.removeLayer(shoppingCenterLayer) } catch(e) {}
  }
  
  // 聚合模式下同步更新聚合图层
  if (showCluster.value) buildAllStoreCluster()
}

const updateLayerDisplay = () => {
  if (!map) return

  console.log('[updateLayerDisplay] showCluster:', showCluster.value, 'showHeatmap:', showHeatmap.value)

  // 移除所有业务图层
  try {
    if (businessLayer && map.hasLayer(businessLayer)) map.removeLayer(businessLayer)
    if (allStoreClusterGroup && map.hasLayer(allStoreClusterGroup)) map.removeLayer(allStoreClusterGroup)
    if (heatmapLayer && map.hasLayer(heatmapLayer)) map.removeLayer(heatmapLayer)
    // 聚合或热力图模式下隐藏其他门店图层
    if (showCluster.value || showHeatmap.value) {
      if (competitorLayer && map.hasLayer(competitorLayer)) map.removeLayer(competitorLayer)
      if (brandStoreLayer && map.hasLayer(brandStoreLayer)) map.removeLayer(brandStoreLayer)
      if (shoppingCenterLayer && map.hasLayer(shoppingCenterLayer)) map.removeLayer(shoppingCenterLayer)
    }
  } catch(e) {}

  // 聚合模式优先显示聚合图层
  if (showCluster.value && allStoreClusterGroup) {
    console.log('[updateLayerDisplay] 显示聚合图层')
    try { map.addLayer(allStoreClusterGroup) } catch(e) {}
    return
  }

  // 热力图模式显示热力图
  if (showHeatmap.value && heatmapLayer) {
    console.log('[updateLayerDisplay] 显示热力图')
    try { map.addLayer(heatmapLayer) } catch(e) {}
    return
  }

  // 关闭聚合/热力图模式后，重新添加独立图层
  if (showCompetitorLayer.value && competitorLayer) {
    try { map.addLayer(competitorLayer) } catch(e) {}
  }
  if (showBrandStoreLayer.value && brandStoreLayer) {
    try { map.addLayer(brandStoreLayer) } catch(e) {}
  }
  if (showShoppingCenterLayer.value && shoppingCenterLayer) {
    try { map.addLayer(shoppingCenterLayer) } catch(e) {}
  }

  if (!showBusinessLayer.value) {
    console.log('[updateLayerDisplay] showBusinessLayer为false，直接返回')
    return
  }

  if (businessLayer) {
    console.log('[updateLayerDisplay] 显示普通门店图层')
    try { map.addLayer(businessLayer) } catch(e) {}
  }

  // 确保图层顺序正确
  try {
    if (competitorLayer && map.hasLayer(competitorLayer)) competitorLayer.bringToBack()
    if (brandStoreLayer && map.hasLayer(brandStoreLayer)) brandStoreLayer.bringToBack()
    if (shoppingCenterLayer && map.hasLayer(shoppingCenterLayer)) shoppingCenterLayer.bringToBack()
  } catch(e) {}
}

// 监控竞品图层开关（懒加载）
watch(showCompetitorLayer, async (newVal) => {
  if (newVal && !competitorLayer) {
    console.log('[懒加载] 竞品图层未创建，开始渲染...')
    await loadCompetitors(true)
  }
  updateCompetitorDisplay()
})

// 监控品牌门店图层开关（懒加载）
watch(showBrandStoreLayer, async (newVal) => {
  if (newVal && !brandStoreLayer) {
    console.log('[懒加载] 品牌门店图层未创建，开始渲染...')
    await loadBrandStores(true)
  }
  updateBrandStoreDisplay()
})

// 监控购物中心图层开关（懒加载）
watch(showShoppingCenterLayer, async (newVal) => {
  if (newVal && !shoppingCenterLayer) {
    console.log('[懒加载] 购物中心图层未创建，开始渲染...')
    await loadShoppingCenters(true)
  }
  updateShoppingCenterDisplay()
})

// 监听各 store 的 visibleIds 变化，联动地图筛选显示
watch(() => markerStore.visibleIds, () => {
  if (map) reloadBusinessLayer()
})
watch(() => competitorStore.visibleIds, () => {
  if (map) reloadCompetitorLayer()
  if (showCluster.value) buildAllStoreCluster()
})
watch(() => brandStoreStore.visibleIds, () => {
  if (map) reloadBrandStoreLayer()
  if (showCluster.value) buildAllStoreCluster()
})
watch(() => shoppingCenterStore.visibleIds, () => {
  if (map) reloadShoppingCenterLayer()
  if (showCluster.value) buildAllStoreCluster()
})

// 监听门店开关变化，聚合/热力图模式下重新构建
watch([showBusinessLayer, showCompetitorLayer, showBrandStoreLayer, showShoppingCenterLayer], () => {
  if (showCluster.value) {
    buildAllStoreCluster()
    updateLayerDisplay()
  } else if (showHeatmap.value) {
    buildAllStoreHeatmap()
    updateLayerDisplay()
  }
})

// 监控图层显示状态（不包括竞品开关，由 @change 事件处理）
watch([showBusinessLayer, showHeatmap, showCluster, layerOpacity], () => {
  if (showCluster.value) buildAllStoreCluster()
  else if (showHeatmap.value) buildAllStoreHeatmap()
  updateLayerDisplay()
  // 只在非聚合模式下对 businessLayer 调用 setStyle（markerClusterGroup 不支持此方法）
  if (businessLayer && !showCluster.value && businessLayer.setStyle) {
    businessLayer.setStyle({ opacity: layerOpacity.value, fillOpacity: layerOpacity.value * 0.3 })
  }
})

// 设置工具
const setTool = (tool) => {
  if (activeTool.value === tool) {
    // 再次点击同一工具 → 取消当前测量，不清空 drawnItems（保留已完成的结果）
    activeTool.value = ''
    if (map) map.getContainer().style.cursor = ''
    if (tool === 'measure') stopMeasure()
    if (tool === 'area') stopAreaMeasure()
    measurePoints = []
    measurementResult.value = ''
    return
  }
  // 切换工具时清理上一个测量状态
  if (activeTool.value === 'measure') stopMeasure()
  if (activeTool.value === 'area') stopAreaMeasure()
  // 重新选择同一工具时不清空 drawnItems（drawnItems 由 clearDrawings 统一清空）
  activeTool.value = tool

  // 提示用户下一步操作
  if (tool === 'circle') {
    ElMessage.info('请在地图上点击选择圆心位置')
  }

  // 设置光标
  if (['marker', 'polyline', 'polygon', 'rectangle', 'circle', 'measure', 'area'].includes(tool)) {
    map.getContainer().style.cursor = 'crosshair'
  }
}

// 地图点击处理（通过两次click间隔自己判断双击，绕过Leaflet的dblclick限制）
let lastClickTime = 0
const handleMapClick = (e) => {
  // 环境打分卡选点模式
  if (envScorePickMode.value) {
    envScorePoint.value = { lat: e.latlng.lat, lng: e.latlng.lng }
    envScorePickMode.value = false
    if (map) map.getContainer().style.cursor = ''
    drawEnvScoreLayer()
    fetchEnvScore()
    return
  }

  // POI位置选择模式
  if (poiPickLocationMode.value && poiPendingSearch.value) {
    cancelPoiPickLocation()
    executePoiSearchAtLocation(e.latlng.lat, e.latlng.lng)
    return
  }
  
  if (!activeTool.value || !map) return

  const now = Date.now()
  const isDoubleClick = (now - lastClickTime) < 300  // 300ms内连续点击视为双击
  lastClickTime = now

  console.log('DEBUG click 触发, activeTool=', activeTool.value, 'isDoubleClick=', isDoubleClick)

  if (isDoubleClick && (activeTool.value === 'measure' || activeTool.value === 'area')) {
    // 双击 → 结束测量
    if (activeTool.value === 'measure') {
      finishMeasure()
    } else if (activeTool.value === 'area') {
      // 直接把图层从map移到drawnItems，不要调用stopAreaMeasure（它会清null）
      if (measureAreaPolygon) {
        map.removeLayer(measureAreaPolygon)
        drawnItems.addLayer(measureAreaPolygon)
        measureAreaPolygon = null  // 必须设为null，否则下次测量会错误移除drawnItems中的面
      }
      if (measureAreaLabel) {
        map.removeLayer(measureAreaLabel)
        drawnItems.addLayer(measureAreaLabel)
        measureAreaLabel = null  // 必须设为null
      }
      measureAreaPoints = []
      activeTool.value = ''
      measurementResult.value = ''
    }
    return
  }

  // 单击 → 执行对应工具
  if (activeTool.value !== 'measure') {
    executeClick(e)
  } else {
    // 测距工具也用延迟防止意外
    handleMeasure(e.latlng.lat, e.latlng.lng)
  }
}

const executeClick = (e) => {
  const { lat, lng } = e.latlng

  switch (activeTool.value) {
    case 'marker':
      markerForm.latitude = lat
      markerForm.longitude = lng
      showAddMarkerPin(lat, lng)
      markerDialogVisible.value = true
      break

    case 'measure':
      handleMeasure(lat, lng)
      break

    case 'area':
      handleAreaMeasure(lat, lng)
      break

    case 'polyline':
      handleDrawPolyline(lat, lng)
      break

    case 'polygon':
      handleDrawPolygon(lat, lng)
      break

    case 'rectangle':
      handleDrawRectangle(e)
      break

    case 'circle':
      handleDrawCircle(e)
      break
  }
}

// ============ 测量距离（仿高德地图多段累计测距）============

// 计算累计总距离（米）
const getTotalDistance = (points) => {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += calculateDistance(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
  }
  return total
}

// 清空测量图层
const clearMeasureLayers = () => {
  if (measureLayerGroup) {
    measureLayerGroup.clearLayers()
  }
  if (measurePreviewLine) {
    map.removeLayer(measurePreviewLine)
    measurePreviewLine = null
  }
  measureDotMarkers = []
  measureLabelMarkers = []
}

// 停止测量（取消，不保留结果）
const stopMeasure = () => {
  map.off('mousemove', onMeasureMouseMove)
  if (measureLayerGroup) map.removeLayer(measureLayerGroup)
  if (measurePreviewLine) { map.removeLayer(measurePreviewLine); measurePreviewLine = null }
  measurePoints = []
  measureDotMarkers = []
  measureLabelMarkers = []
  measureLayerGroup = null
  measurementResult.value = ''
  if (map) map.getContainer().style.cursor = ''
}

// 停止测面
const stopAreaMeasure = () => {
  if (measureAreaPolygon) { map.removeLayer(measureAreaPolygon); measureAreaPolygon = null }
  if (measureAreaLabel) { map.removeLayer(measureAreaLabel); measureAreaLabel = null }
  measureAreaPoints = []
  measurementResult.value = ''
}

// 鼠标移动预览线
const onMeasureMouseMove = (e) => {
  if (measurePoints.length === 0) return
  const last = measurePoints[measurePoints.length - 1]
  const cur = [e.latlng.lat, e.latlng.lng]

  if (measurePreviewLine) map.removeLayer(measurePreviewLine)
  measurePreviewLine = L.polyline([last, cur], {
    color: '#3388ff',
    weight: 2,
    dashArray: '6, 6',
    opacity: 0.8
  }).addTo(map)

  // 更新提示
  const dist = calculateDistance(last[0], last[1], cur[0], cur[1])
  const total = getTotalDistance(measurePoints) + dist
  measurementResult.value = `当前段: ${formatDistance(dist)} | 总计: ${formatDistance(total)} | 双击结束`
}

// 点击添加测量点
const handleMeasure = (lat, lng) => {
  // 初始化图层组
  if (!measureLayerGroup) {
    measureLayerGroup = L.layerGroup().addTo(map)
  }

  measurePoints.push([lat, lng])
  const idx = measurePoints.length - 1

  // 画点（圆点）
  const dot = L.circleMarker([lat, lng], {
    radius: idx === 0 ? 6 : 5,
    color: '#fff',
    weight: 2,
    fillColor: idx === 0 ? '#3388ff' : '#ff6b6b',
    fillOpacity: 1
  }).addTo(measureLayerGroup)
  measureDotMarkers.push(dot)

  if (idx === 0) {
    // 第一个点：仅提示
    measurementResult.value = '单击添加点，双击结束测量'
    // 注册鼠标移动预览
    map.on('mousemove', onMeasureMouseMove)

    // 起点标签
    const startLabel = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#fff;color:#333;padding:3px 7px;border-radius:3px;font-size:11px;white-space:nowrap;border:1px solid #ccc;box-shadow:0 1px 4px rgba(0,0,0,0.2);display:inline-block;">起点</div>`,
        iconSize: null,
        iconAnchor: [-8, 10]
      }),
      interactive: false
    }).addTo(measureLayerGroup)
    measureLabelMarkers.push(startLabel)
  } else {
    // 画线段
    const segment = L.polyline([measurePoints[idx - 1], measurePoints[idx]], {
      color: '#3388ff',
      weight: 3,
      opacity: 0.9
    }).addTo(measureLayerGroup)

    // 本段距离 & 累计
    const segDist = calculateDistance(
      measurePoints[idx - 1][0], measurePoints[idx - 1][1],
      lat, lng
    )
    const totalDist = getTotalDistance(measurePoints)

    // 节点标签
    const label = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#fff;color:#333;padding:3px 7px;border-radius:3px;font-size:11px;white-space:nowrap;border:1px solid #ccc;box-shadow:0 1px 4px rgba(0,0,0,0.2);line-height:1.6;display:inline-block;">
          <div>${formatDistance(segDist)}</div>
          <div style="color:#555;font-size:10px;">累计 ${formatDistance(totalDist)}</div>
        </div>`,
        iconSize: null,
        iconAnchor: [-8, 10]
      }),
      interactive: false
    }).addTo(measureLayerGroup)
    measureLabelMarkers.push(label)

    measurementResult.value = `已量 ${formatDistance(totalDist)} | 单击继续添加点 | 双击结束`
  }
}

// 双击结束测量
const finishMeasure = () => {
  if (measurePoints.length < 2) {
    stopMeasure()
    activeTool.value = ''
    return
  }

  // 停止预览
  map.off('mousemove', onMeasureMouseMove)
  if (measurePreviewLine) { map.removeLayer(measurePreviewLine); measurePreviewLine = null }

  const totalDist = getTotalDistance(measurePoints)

  // 终点标记
  if (measureLayerGroup) {
    const last = measurePoints[measurePoints.length - 1]
    L.circleMarker(last, {
      radius: 7,
      color: '#fff',
      weight: 2,
      fillColor: '#ff4500',
      fillOpacity: 1
    }).addTo(measureLayerGroup)

    L.marker(last, {
      icon: L.divIcon({
        className: '',
        html: `<div style="display:flex;align-items:center;gap:6px;background:#fff;color:#333;padding:4px 10px;border-radius:3px;font-size:12px;font-weight:bold;white-space:nowrap;border:1px solid #409eff;box-shadow:0 1px 4px rgba(0,0,0,0.2);">
          总计: ${formatDistance(totalDist)}
          <span onclick="window.clearMeasureResult()" style="cursor:pointer;color:#f56c6c;font-weight:bold;line-height:1;" title="清除测量结果">❌</span>
        </div>`,
        iconSize: null,
        // 总计标签显示在终点右上方，避免与终点右下角的"段距离/累计"节点标签重叠
        iconAnchor: [16, -32]
      }),
      interactive: true
    }).addTo(measureLayerGroup)
  }

  measurementResult.value = `测量完成，总距离: ${formatDistance(totalDist)}`

  // drawnItems 保留测量结果
  if (drawnItems && measureLayerGroup) {
    // 将测量图层移入 drawnItems（清除时统一清）
    drawnItems.addLayer(measureLayerGroup)
    measureLayerGroup = null
  }

  measurePoints = []
  measureDotMarkers = []
  measureLabelMarkers = []
  activeTool.value = ''
  map.getContainer().style.cursor = ''

  setTimeout(() => { measurementResult.value = '' }, 4000)
}

// 测量面积
const handleAreaMeasure = (lat, lng) => {
  console.log('DEBUG handleAreaMeasure clicked, lat=', lat, 'lng=', lng, 'areaPoints=', measureAreaPoints.length)
  measureAreaPoints.push([lat, lng])
  const n = measureAreaPoints.length

  if (n < 3) {
    measurementResult.value = `已选择 ${n} 个点，还需 ${3 - n} 个`
    return
  }

  // 双击结束逻辑在 handleMapClick 内通过300ms间隔判断，不再单独绑定

  // 计算面积
  const area = calculateArea(measureAreaPoints.map(p => ({ lat: p[0], lng: p[1] })))
  const areaStr = formatArea(area)
  measurementResult.value = `面积: ${areaStr} | 单击继续加点 | 双击结束`

  // 绘制 polygon
  if (measureAreaPolygon) map.removeLayer(measureAreaPolygon)
  measureAreaPolygon = L.polygon(measureAreaPoints, {
    color: '#409eff',
    fillColor: '#409eff',
    fillOpacity: 0.2,
    weight: 2
  }).addTo(map)

  // 在 polygon 中心显示面积标签
  if (measureAreaLabel) map.removeLayer(measureAreaLabel)
  const center = measureAreaPolygon.getBounds().getCenter()
  measureAreaLabel = L.marker(center, {
    icon: L.divIcon({
      className: '',
      html: `<div style="background:#fff;color:#333;padding:5px 12px;border-radius:4px;font-size:13px;font-weight:bold;white-space:nowrap;border:1px solid #409eff;box-shadow:0 2px 6px rgba(0,0,0,0.2);display:inline-block;">
        面积: ${areaStr}
      </div>`,
      iconSize: null,
      iconAnchor: [0, 0]
    }),
    interactive: false
  }).addTo(map)
}

// 绘制折线
const handleDrawPolyline = (lat, lng) => {
  measurePoints.push([lat, lng])

  if (measurePoints.length === 1) {
    measurementResult.value = '继续点击添加点，右键结束'
  }

  if (measurePoints.length >= 2) {
    if (measureLine) map.removeLayer(measureLine)
    measureLine = L.polyline(measurePoints, {
      color: '#409eff',
      weight: 3
    }).addTo(map)

    drawnItems.addLayer(measureLine)
  }

  map.once('contextmenu', () => {
    measurePoints = []
    measurementResult.value = ''
    activeTool.value = ''
  })
}

// 绘制多边形
const handleDrawPolygon = (lat, lng) => {
  measurePoints.push([lat, lng])

  if (measurePoints.length < 3) {
    measurementResult.value = `已选择 ${measurePoints.length} 个点，还需 ${3 - measurePoints.length} 个`
  }

  if (measurePoints.length >= 3) {
    if (measureArea) map.removeLayer(measureArea)
    measureArea = L.polygon(measurePoints, {
      color: '#409eff',
      fillColor: '#409eff',
      fillOpacity: 0.3
    }).addTo(map)

    drawnItems.addLayer(measureArea)
    measurePoints = []
    measurementResult.value = ''
    activeTool.value = ''
  }
}

// 绘制矩形
const handleDrawRectangle = (e) => {
  if (!map) return
  const bounds = L.latLngBounds(e.latlng, e.latlng)
  const rect = L.rectangle(bounds, {
    color: '#409eff',
    fillColor: '#409eff',
    fillOpacity: 0.3
  }).addTo(map)
  drawnItems.addLayer(rect)
  activeTool.value = ''
  measurementResult.value = ''
}

// 绘制圆形
const handleDrawCircle = (e) => {
  if (!map) return
  
  // 清除之前的临时标记
  if (tempCircleMarker) {
    map.removeLayer(tempCircleMarker)
    tempCircleMarker = null
  }
  
  // 记录圆心，打开对话框让用户设置半径
  circleForm.center = e.latlng
  circleForm.centerText = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`
  circleForm.radius = 2
  circleForm.radius2 = null
  circleForm.radius3 = null
  circleForm.unit = 'km'
  
  // 显示小图钉标记
  const pinIcon = L.divIcon({
    html: `<div style="
      width: 16px;
      height: 22px;
      position: relative;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
    ">
      <svg viewBox="0 0 24 40" width="16" height="22" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 28 12 28s12-19 12-28c0-6.6-5.4-12-12-12z" fill="#409eff"/>
        <circle cx="12" cy="12" r="4" fill="white"/>
      </svg>
    </div>`,
    className: '',
    iconSize: [16, 22],
    iconAnchor: [8, 22],
    popupAnchor: [0, -22]
  })
  
  tempCircleMarker = L.marker([e.latlng.lat, e.latlng.lng], {
    icon: pinIcon,
    zIndexOffset: 1000
  }).addTo(map)
  
  circleDialogVisible.value = true
}

// 确认绘制圆形
const confirmDrawCircle = () => {
  if (!circleForm.center) return
  // 转换半径单位
  let radius = circleForm.radius
  if (circleForm.unit === 'km') {
    radius = radius * 1000  // 公里转米
  }
  // 绘制圆形
  const circle = L.circle(circleForm.center, {
    radius: radius,
    color: '#409eff',
    fillColor: '#409eff',
    fillOpacity: 0.3
  }).addTo(map)
  drawnItems.addLayer(circle)
  
  // 移除蓝色小图钉，用黑色圆圈替代圆心
  if (tempCircleMarker) {
    map.removeLayer(tempCircleMarker)
    tempCircleMarker = null
  }
  
  // 在圆心添加黑色圆圈
  const centerIcon = L.circleMarker(circleForm.center, {
    radius: 8,
    color: '#000',
    fillColor: '#fff',
    fillOpacity: 1,
    weight: 3
  }).addTo(map)
  drawnItems.addLayer(centerIcon)
  
  circleDialogVisible.value = false
  activeTool.value = ''
  measurementResult.value = ''
  ElMessage.success(`已绘制圆形，半径 ${circleForm.radius}${circleForm.unit === 'm' ? '米' : '公里'}`)
}

// 构建所有门店热力图
const buildAllStoreHeatmap = () => {
  console.log('[热力图] buildAllStoreHeatmap 开始')
  console.log('[热力图] 当前选择: 我的门店=', showBusinessLayer.value, '竞品=', showCompetitorLayer.value, '品牌门店=', showBrandStoreLayer.value, '购物中心=', showShoppingCenterLayer.value)
  
  if (!map) return
  
  // 移除旧热力图
  if (heatmapLayer) {
    try { map.removeLayer(heatmapLayer) } catch(e) {}
  }
  
  const hmData = []
  
  // 1. 我的门店（只有开关开启时才包含）
  if (showBusinessLayer.value && markerStore.markers && markerStore.markers.length > 0) {
    const visibleIds = markerStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? markerStore.markers.filter(m => visibleIds.includes(m.id))
      : markerStore.markers
    data.forEach(m => {
      if (m.latitude && m.longitude) {
        hmData.push([m.latitude, m.longitude, 1])
      }
    })
    console.log('[热力图] 我的门店:', data.length)
  }
  
  // 2. 竞品门店（只有开关开启时才包含）
  if (showCompetitorLayer.value && competitorStore.competitors && competitorStore.competitors.length > 0) {
    const visibleIds = competitorStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? competitorStore.competitors.filter(c => visibleIds.includes(c.id))
      : competitorStore.competitors
    data.forEach(c => {
      if (c.latitude && c.longitude) {
        hmData.push([c.latitude, c.longitude, 1])
      }
    })
    console.log('[热力图] 竞品门店:', data.length)
  }
  
  // 3. 品牌门店（只有开关开启时才包含）
  if (showBrandStoreLayer.value && brandStoreStore.brandStores && brandStoreStore.brandStores.length > 0) {
    const visibleIds = brandStoreStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? brandStoreStore.brandStores.filter(s => visibleIds.includes(s.id))
      : brandStoreStore.brandStores
    data.forEach(s => {
      if (s.latitude && s.longitude) {
        hmData.push([s.latitude, s.longitude, 1])
      }
    })
    console.log('[热力图] 品牌门店:', data.length)
  }
  
  // 4. 购物中心（只有开关开启时才包含）
  if (showShoppingCenterLayer.value && shoppingCenterStore.shoppingCenters && shoppingCenterStore.shoppingCenters.length > 0) {
    const visibleIds = shoppingCenterStore.visibleIds
    const data = (visibleIds && Array.isArray(visibleIds) && visibleIds.length > 0)
      ? shoppingCenterStore.shoppingCenters.filter(s => visibleIds.includes(s.id))
      : shoppingCenterStore.shoppingCenters
    data.forEach(s => {
      if (s.latitude && s.longitude) {
        hmData.push([s.latitude, s.longitude, 1])
      }
    })
    console.log('[热力图] 购物中心:', data.length)
  }
  
  console.log('[热力图] 总计:', hmData.length)
  
  if (hmData.length > 0) {
    heatmapLayer = L.heatLayer(hmData, { radius: 40, blur: 10, maxZoom: 17, max: 1.0, minOpacity: 0.5, gradient: { 0.2: '#0066ff', 0.4: '#00ddff', 0.6: '#44dd44', 0.8: '#ffcc00', 1.0: '#ff3300' } })
  }
}

// 切换热力图
const toggleHeatmap = () => {
  if (!map) return
  showHeatmap.value = !showHeatmap.value
  console.log('[toggleHeatmap] showHeatmap:', showHeatmap.value)
  
  if (showHeatmap.value) {
    showCluster.value = false
    console.log('[toggleHeatmap] 构建热力图')
    buildAllStoreHeatmap()
    if (heatmapLayer) {
      try { map.addLayer(heatmapLayer) } catch(e) {}
    }
    try {
      if (businessLayer && map.hasLayer(businessLayer)) {
        heatmapLayer.bringToBack()
      }
    } catch(e) {}
  } else {
    try {
      if (heatmapLayer && map.hasLayer(heatmapLayer)) map.removeLayer(heatmapLayer)
    } catch(e) {}
  }
  
  // 更新图层显示
  updateLayerDisplay()
}

// 切换聚合
const toggleCluster = () => {
  console.log('[toggleCluster] 开始, 当前showCluster:', showCluster.value)
  showCluster.value = !showCluster.value
  console.log('[toggleCluster] 切换后showCluster:', showCluster.value)
  if (showCluster.value) {
    showHeatmap.value = false
    console.log('[toggleCluster] 开始构建聚合图层')
    buildAllStoreCluster()
  }
  // 无论开启还是关闭聚合，都需要更新图层显示
  console.log('[toggleCluster] 调用updateLayerDisplay')
  updateLayerDisplay()
}

// 门店商圈：点击切换显示
const toggleStoreCircles = () => {
  if (showStoreCircles.value) {
    showStoreCircles.value = false
    storeCircleLegendItems.value = []
    storeCircleLegendVisible.value = false
    if (storeCircleLayer) {
      try { map.removeLayer(storeCircleLayer) } catch(e) {}
      storeCircleLayer = null
    }
  } else {
    storeCircleMode.value = 'overlap'
    storeCircleRadius.value = 1
    storeCircleModeDialogVisible.value = true
  }
}

// 选择门店商圈模式
const selectStoreCircleMode = (mode) => {
  storeCircleMode.value = mode
  storeCircleModeDialogVisible.value = false
  // 重置筛选为全选
  if (mode === 'overlap') {
    storeCircleFilters.value.overlap = { overlapHigh: true, overlapMid: true, overlapLow: true, overlapNone: true }
    restoreOverlapThresholds()  // 恢复上次设置的重叠率阈值
  } else if (mode === 'track') {
    storeCircleFilters.value.track = { noMyNoOther: true, hasMyNoOther: true, noMyHasOther: true, hasMyHasOther: true }
  } else if (mode === 'opportunity') {
    storeCircleFilters.value.opportunity = { lowDensity: true, mediumDensity: true, highDensity: true }
    opportunityDensityThreshold.value = 2
    opportunityScope.value = 'viewport'
  } else {
    storeCircleFilters.value.competition = { noMyNoComp: true, hasMyNoComp: true, noMyHasComp: true, hasMyHasComp: true }
  }
  storeCircleDialogVisible.value = true
}

// 门店状态筛选（与地图渲染/网点优化统一口径）：在营=已开业非候选；候选=重点候选/一般候选；在营+候选=非闭店；停业=闭店类
const filterStoreByStatus = (m) => {
  const f = myStoreStatusFilter.value
  if (f === 'all') return true
  const closed = isStoreClosed(m.store_status)
  const isCandidate = m.store_type === '重点候选' || m.store_type === '一般候选'
  if (f === 'closed') return closed
  if (f === 'candidate') return !closed && isCandidate
  if (f === 'open_candidate') return !closed
  return !closed && !isCandidate // 在营
}

// 应用门店商圈（生成圆形）
const applyStoreCircles = () => {
  storeCircleDialogVisible.value = false
  if (!map) { ElMessage.warning('地图未初始化'); return }
  if (storeCircleLayer) {
    try { map.removeLayer(storeCircleLayer) } catch(e) {}
    storeCircleLayer = null
  }
  let allStores = []

  // 1. 我的门店（开关开启且可见 + 门店状态筛选：与地图显示一致，停业/未显示门店不参与计算）
  if (showBusinessLayer.value && markerStore.markers) {
    let ms = markerStore.markers
    if (markerStore.visibleIds !== null && markerStore.visibleIds !== undefined) {
      ms = ms.filter(m => markerStore.visibleIds.includes(m.id))
    }
    ms = ms.filter(filterStoreByStatus)
    ms.forEach(m => {
      if (m.latitude && m.longitude) {
        allStores.push({ latitude: m.latitude, longitude: m.longitude, name: m.name, _type: '我的门店', city: m.city || '' })
      }
    })
  }

  // 2. 竞品门店（开关开启且可见）
  if (showCompetitorLayer.value && competitorStore.competitors) {
    let cs = competitorStore.competitors
    if (competitorStore.visibleIds !== null && competitorStore.visibleIds !== undefined) {
      cs = cs.filter(c => competitorStore.visibleIds.includes(c.id))
    }
    cs.forEach(c => {
      if (c.latitude && c.longitude) {
        allStores.push({ latitude: c.latitude, longitude: c.longitude, name: c.name, _type: '竞品', city: c.city || '' })
      }
    })
  }

  // 3. 品牌门店（开关开启且可见）
  if (showBrandStoreLayer.value && brandStoreStore.brandStores) {
    let bs = brandStoreStore.brandStores
    if (brandStoreStore.visibleIds !== null && brandStoreStore.visibleIds !== undefined) {
      bs = bs.filter(b => brandStoreStore.visibleIds.includes(b.id))
    }
    bs.forEach(b => {
      if (b.latitude && b.longitude) {
        allStores.push({ latitude: b.latitude, longitude: b.longitude, name: b.name, _type: '品牌门店', city: b.city || '' })
      }
    })
  }

  // 4. 购物中心（开关开启且可见）
  if (showShoppingCenterLayer.value && shoppingCenterStore.shoppingCenters) {
    let sc = shoppingCenterStore.shoppingCenters
    if (shoppingCenterStore.visibleIds !== null && shoppingCenterStore.visibleIds !== undefined) {
      sc = sc.filter(s => shoppingCenterStore.visibleIds.includes(s.id))
    }
    sc.forEach(s => {
      if (s.latitude && s.longitude) {
        allStores.push({ latitude: s.latitude, longitude: s.longitude, name: s.name, _type: '购物中心', city: s.city || '' })
      }
    })
  }

  const validStores = allStores
  if (validStores.length === 0) {
    ElMessage.warning('没有可见的门店数据')
    return
  }
  const radiusM = storeCircleRadius.value * 1000
  const R = radiusM
  const R2 = R * R

  if (storeCircleMode.value === 'opportunity') {
    // ==== 机会区分析模式：网格扫描竞品密度（0 成本，纯本地计算） ====
    // 竞品数据（不受显示开关影响，确保分析完整；按可见过滤）
    let allComps = []
    if (competitorStore.competitors) {
      allComps = competitorStore.competitors
      if (competitorStore.visibleIds !== null && competitorStore.visibleIds !== undefined) {
        allComps = allComps.filter(c => competitorStore.visibleIds.includes(c.id))
      }
    }
    const compPoints = allComps.filter(c => c.latitude && c.longitude)
    if (compPoints.length === 0) {
      ElMessage.warning('没有竞品门店数据，无法分析机会区')
      return
    }

    // 确定扫描范围：当前视野（默认）或全部竞品外扩
    let bounds
    if (opportunityScope.value === 'viewport') {
      const b = map.getBounds()
      bounds = { minLat: b.getSouth(), maxLat: b.getNorth(), minLng: b.getWest(), maxLng: b.getEast() }
    } else {
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
      compPoints.forEach(c => {
        if (c.latitude < minLat) minLat = c.latitude
        if (c.latitude > maxLat) maxLat = c.latitude
        if (c.longitude < minLng) minLng = c.longitude
        if (c.longitude > maxLng) maxLng = c.longitude
      })
      const pad = 0.05
      bounds = { minLat: minLat - pad, maxLat: maxLat + pad, minLng: minLng - pad, maxLng: maxLng + pad }
    }

    // 网格化：1 度经度 ≈ 111km×cos(lat)，1 度纬度 ≈ 111km
    const gridKm = storeCircleRadius.value || 1
    const avgLat = (bounds.minLat + bounds.maxLat) / 2
    const latStep = gridKm / 111
    const lngStep = gridKm / (111 * Math.cos(avgLat * Math.PI / 180))

    // 统计每个网格的竞品数
    const gridCounts = {}
    compPoints.forEach(c => {
      const gi = Math.floor(c.latitude / latStep)
      const gj = Math.floor(c.longitude / lngStep)
      const key = gi + '_' + gj
      gridCounts[key] = (gridCounts[key] || 0) + 1
    })

    // 计算全部网格的竞品数（含 0 竞品网格），用于分位分级
    const allCounts = []
    for (let gi = Math.floor(bounds.minLat / latStep); gi <= Math.floor(bounds.maxLat / latStep); gi++) {
      for (let gj = Math.floor(bounds.minLng / lngStep); gj <= Math.floor(bounds.maxLng / lngStep); gj++) {
        const key = gi + '_' + gj
        allCounts.push({ gi, gj, count: gridCounts[key] || 0 })
      }
    }
    if (allCounts.length > 400) {
      ElMessage.warning(`扫描区域过大（${allCounts.length} 个网格），请缩小视野或调大网格大小`)
      return
    }

    // 密度分级：0=机会区(≤阈值)，1=中密度(≤2×阈值)，2=高密度(>2×阈值)
    const threshold = opportunityDensityThreshold.value || 2
    const layer = L.layerGroup().addTo(map)
    const oppFilters = storeCircleFilters.value.opportunity
    let oppCount = 0, midCount = 0, highCount = 0

    allCounts.forEach(({ gi, gj, count }) => {
      const lat = (gi + 0.5) * latStep
      const lng = (gj + 0.5) * lngStep
      // 网格中心在视野外跳过（避免边缘半格）
      if (opportunityScope.value === 'viewport') {
        if (lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng) return
      }
      let color, level
      if (count <= threshold) {
        color = '#67c23a'; level = 'lowDensity'; oppCount++
      } else if (count <= threshold * 2) {
        color = '#e6a23c'; level = 'mediumDensity'; midCount++
      } else {
        color = '#f56c6c'; level = 'highDensity'; highCount++
      }
      if (!oppFilters[level]) return
      const rect = L.rectangle([[lat - latStep / 2, lng - lngStep / 2], [lat + latStep / 2, lng + lngStep / 2]], {
        color: color,
        weight: 1,
        fillColor: color,
        fillOpacity: count === 0 ? 0.25 : 0.4,
        interactive: false
      })
      rect.bindTooltip(`竞品 ${count} 家`, { permanent: false, direction: 'center' })
      layer.addLayer(rect)
    })

    // 图例
    const legendMap = [
      { key: 'lowDensity', color: '#67c23a', label: `机会区（竞品≤${threshold}）`, count: oppCount },
      { key: 'mediumDensity', color: '#e6a23c', label: `中密度区（${threshold}~${threshold * 2}）`, count: midCount },
      { key: 'highDensity', color: '#f56c6c', label: `高密度区（>${threshold * 2}）`, count: highCount }
    ]
    storeCircleLegendItems.value = legendMap
      .filter(item => oppFilters[item.key])
      .map(item => ({ key: item.key, color: item.color, label: item.label, stores: [], count: item.count }))
    storeCircleLegendVisible.value = true
    storeCircleLayer = layer
    expandedLegendCategory.value = null
    ElMessage.success(`分析完成：机会区 ${oppCount} 个网格、中密度 ${midCount} 个、高密度 ${highCount} 个（0 成本）`)
    return
  }

  if (storeCircleMode.value === 'competition') {
    // ==== 门店竞争数模式 ====
    // 竞争计算使用全量"我的门店"和"竞品"数据（不受显示开关影响，确保分析完整）
    let allMyStores = []
    if (markerStore.markers) {
      allMyStores = markerStore.markers
      if (markerStore.visibleIds !== null && markerStore.visibleIds !== undefined) {
        allMyStores = allMyStores.filter(m => markerStore.visibleIds.includes(m.id))
      }
    }
    let allComps = []
    if (competitorStore.competitors) {
      allComps = competitorStore.competitors
      if (competitorStore.visibleIds !== null && competitorStore.visibleIds !== undefined) {
        allComps = allComps.filter(c => competitorStore.visibleIds.includes(c.id))
      }
      // 按选择的竞争品牌过滤（空 = 全部）
      if (competitionBrands.value.length > 0) {
        allComps = allComps.filter(c => competitionBrands.value.includes(c.brand))
      }
    }
    const myStorePoints = allMyStores.filter(s => s.latitude && s.longitude).map(s => ({ lat: s.latitude, lng: s.longitude }))
    const compPoints = allComps.filter(s => s.latitude && s.longitude).map(s => ({ lat: s.latitude, lng: s.longitude }))

    storeCircleLayer = L.layerGroup().addTo(map)
    const compFilters = storeCircleFilters.value.competition
    let drawnCount = 0
    // 重置城市分布统计
    const stats = { noMyNoComp: {}, hasMyNoComp: {}, noMyHasComp: {}, hasMyHasComp: {} }
    const results = []
    validStores.forEach((store) => {
      // 计算该店半径内有多少"其他"我的门店和竞品（排除圆心门店自身，d>0）
      let myCount = 0
      let compCount = 0
      for (const p of myStorePoints) {
        const d = calculateDistance(store.latitude, store.longitude, p.lat, p.lng)
        if (d > 0 && d <= radiusM) myCount++
      }
      for (const p of compPoints) {
        const d = calculateDistance(store.latitude, store.longitude, p.lat, p.lng)
        if (d > 0 && d <= radiusM) compCount++
      }

      let color
      let label
      let filterKey
      if (myCount === 0 && compCount === 0) {
        color = '#f59e0b'    // 橙色：无门店无竞品
        label = `我的:${myCount} 竞品:${compCount}`
        filterKey = 'noMyNoComp'
      } else if (myCount > 0 && compCount === 0) {
        color = '#409eff'    // 蓝色：有门店无竞品
        label = `我的:${myCount} 竞品:${compCount}`
        filterKey = 'hasMyNoComp'
      } else if (myCount === 0 && compCount > 0) {
        color = '#ff69b4'    // 粉色：无门店有竞品
        label = `我的:${myCount} 竞品:${compCount}`
        filterKey = 'noMyHasComp'
      } else {
        color = '#67c23a'    // 绿色：既有门店又有竞品
        label = `我的:${myCount} 竞品:${compCount}`
        filterKey = 'hasMyHasComp'
      }

      // 记录分类+城市（供图例城市分布统计与定位）
      const city = store.city || '未知'
      results.push({ lat: store.latitude, lng: store.longitude, city, filterKey, name: store.name, _type: store._type })
      stats[filterKey][city] = (stats[filterKey][city] || 0) + 1

      // 根据筛选条件决定是否绘制
      if (!compFilters[filterKey]) return
      drawnCount++

      const circle = L.circle([store.latitude, store.longitude], {
        radius: radiusM,
        color: color,
        fillColor: color,
        fillOpacity: 0.12,
        weight: 2
      })
      circle.bindTooltip(`[${store._type}] ${store.name || '未知'} - ${label}`, { sticky: true })
      circle.on('click', () => openCompetitionRadar(store.latitude, store.longitude, radiusM, store))
      storeCircleLayer.addLayer(circle)
    })
    competitionCityStats.value = stats
    competitionStoreResults.value = results
    expandedLegendCategory.value = null
    showStoreCircles.value = true
    // 构建图例——只显示已勾选的项
    const compLegendMap = [
      { key: 'noMyNoComp', color: '#f59e0b', label: '无我的门店 + 无竞品' },
      { key: 'hasMyNoComp', color: '#409eff', label: '有我的门店 + 无竞品' },
      { key: 'noMyHasComp', color: '#ff69b4', label: '无我的门店 + 有竞品' },
      { key: 'hasMyHasComp', color: '#67c23a', label: '有我的门店 + 有竞品' }
    ]
    storeCircleLegendItems.value = compLegendMap.filter(item => compFilters[item.key]).map(item => ({ key: item.key, color: item.color, label: item.label }))
    storeCircleLegendVisible.value = true
    console.log('[legend] competition mode - visibility set to', storeCircleLegendVisible.value, 'items:', storeCircleLegendItems.value.length)
    const totalInFilter = drawnCount
    ElMessage.success(`已为 ${totalInFilter} 家门店生成 ${storeCircleRadius.value}km 竞争分析${drawnCount < validStores.length ? `（${validStores.length - drawnCount} 家因筛选未显示）` : ''}`)
    return
  }

  if (storeCircleMode.value === 'track') {
    // ==== 竞争追踪模式：以指定竞争品牌门店为中心 ====
    if (!trackBrand.value) {
      ElMessage.warning('请选择要追踪的竞争品牌')
      storeCircleDialogVisible.value = true
      return
    }

    // 圆心：指定品牌的竞品门店（可见过滤）
    let trackStores = []
    if (competitorStore.competitors) {
      trackStores = competitorStore.competitors.filter(c => c.brand === trackBrand.value)
      if (competitorStore.visibleIds !== null && competitorStore.visibleIds !== undefined) {
        trackStores = trackStores.filter(c => competitorStore.visibleIds.includes(c.id))
      }
    }
    trackStores = trackStores.filter(c => c.latitude && c.longitude)
    if (trackStores.length === 0) {
      ElMessage.warning(`没有找到品牌「${trackBrand.value}」的门店`)
      storeCircleDialogVisible.value = true
      return
    }

    // 我的门店（可见过滤）
    let allMyStores = []
    if (markerStore.markers) {
      allMyStores = markerStore.markers
      if (markerStore.visibleIds !== null && markerStore.visibleIds !== undefined) {
        allMyStores = allMyStores.filter(m => markerStore.visibleIds.includes(m.id))
      }
    }
    const myStorePoints = allMyStores.filter(s => s.latitude && s.longitude).map(s => ({ lat: s.latitude, lng: s.longitude }))

    // 其他竞品（排除指定品牌，可见过滤）
    let otherComps = []
    if (competitorStore.competitors) {
      otherComps = competitorStore.competitors.filter(c => c.brand !== trackBrand.value)
      if (competitorStore.visibleIds !== null && competitorStore.visibleIds !== undefined) {
        otherComps = otherComps.filter(c => competitorStore.visibleIds.includes(c.id))
      }
    }
    const otherCompPoints = otherComps.filter(s => s.latitude && s.longitude).map(s => ({ lat: s.latitude, lng: s.longitude }))

    storeCircleLayer = L.layerGroup().addTo(map)
    const trackFilters = storeCircleFilters.value.track
    let drawnCount = 0
    const stats = { noMyNoOther: {}, hasMyNoOther: {}, noMyHasOther: {}, hasMyHasOther: {} }
    const results = []
    trackStores.forEach((store) => {
      // 半径内我的门店数（排除自身，自身是竞品不在myStorePoints）
      let myCount = 0
      let compCount = 0
      for (const p of myStorePoints) {
        const d = calculateDistance(store.latitude, store.longitude, p.lat, p.lng)
        if (d > 0 && d <= radiusM) myCount++
      }
      for (const p of otherCompPoints) {
        const d = calculateDistance(store.latitude, store.longitude, p.lat, p.lng)
        if (d > 0 && d <= radiusM) compCount++
      }

      let color
      let label
      let filterKey
      if (myCount === 0 && compCount === 0) {
        color = '#f59e0b'    // 橙色：无我的门店无其他竞品
        label = `我的:${myCount} 其他竞品:${compCount}`
        filterKey = 'noMyNoOther'
      } else if (myCount > 0 && compCount === 0) {
        color = '#409eff'    // 蓝色：有我的门店无其他竞品
        label = `我的:${myCount} 其他竞品:${compCount}`
        filterKey = 'hasMyNoOther'
      } else if (myCount === 0 && compCount > 0) {
        color = '#ff69b4'    // 粉色：无我的门店有其他竞品
        label = `我的:${myCount} 其他竞品:${compCount}`
        filterKey = 'noMyHasOther'
      } else {
        color = '#67c23a'    // 绿色：有我的门店有其他竞品
        label = `我的:${myCount} 其他竞品:${compCount}`
        filterKey = 'hasMyHasOther'
      }

      const city = store.city || '未知'
      results.push({ lat: store.latitude, lng: store.longitude, city, filterKey, name: store.name, _type: store._type })
      stats[filterKey][city] = (stats[filterKey][city] || 0) + 1

      // 根据筛选条件决定是否绘制
      if (!trackFilters[filterKey]) return
      drawnCount++
      const circle = L.circle([store.latitude, store.longitude], {
        radius: radiusM,
        color: color,
        fillColor: color,
        fillOpacity: 0.12,
        weight: 2
      })
      circle.bindTooltip(`[${store._type}] ${store.name || '未知'} - ${label}`, { sticky: true })
      storeCircleLayer.addLayer(circle)
    })
    competitionCityStats.value = stats
    competitionStoreResults.value = results
    expandedLegendCategory.value = null
    showStoreCircles.value = true
    const trackLegendMap = [
      { key: 'noMyNoOther', color: '#f59e0b', label: '无我的门店 + 无其他竞品' },
      { key: 'hasMyNoOther', color: '#409eff', label: '有我的门店 + 无其他竞品' },
      { key: 'noMyHasOther', color: '#ff69b4', label: '无我的门店 + 有其他竞品' },
      { key: 'hasMyHasOther', color: '#67c23a', label: '有我的门店 + 有其他竞品' }
    ]
    storeCircleLegendItems.value = trackLegendMap.filter(item => trackFilters[item.key]).map(item => ({ key: item.key, color: item.color, label: item.label }))
    storeCircleLegendVisible.value = true
    ElMessage.success(`已为 ${trackBrand.value} 的 ${drawnCount} 家门店生成 ${storeCircleRadius.value}km 竞争门店追踪${drawnCount < trackStores.length ? `（${trackStores.length - drawnCount} 家因筛选未显示）` : ''}`)
    return
  }

  // ==== 门店重合度模式（4档分类，阈值可手动设置） ====
  // 阈值校验：高阈值必须大于低阈值
  const highPct = overlapHighThreshold.value
  const lowPct = overlapLowThreshold.value
  if (highPct <= lowPct) {
    ElMessage.warning('高阈值必须大于低阈值')
    storeCircleDialogVisible.value = true
    return
  }
  const highRatio = highPct / 100
  const lowRatio = lowPct / 100

  // 计算任意两个门店之间的距离
  const distMatrix = validStores.map((a, i) =>
    validStores.map((b, j) => {
      if (i === j) return Infinity
      const dlat = (a.latitude - b.latitude) * Math.PI / 180
      const dlon = (a.longitude - b.longitude) * Math.PI / 180
      const lat1 = a.latitude * Math.PI / 180
      const lat2 = b.latitude * Math.PI / 180
      const aa = Math.sin(dlat/2) * Math.sin(dlat/2) +
                 Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon/2) * Math.sin(dlon/2)
      return 2 * 6371000 * Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa))
    })
  )

  // 计算每个门店的最大重叠百分比（4档着色）
  const circleColors = validStores.map((store, idx) => {
    let maxOverlap = 0
    for (let j = 0; j < validStores.length; j++) {
      if (idx === j) continue
      const d = distMatrix[idx][j]
      if (d >= 2 * R) continue // 不重叠
      const overlapArea = 2 * R2 * Math.acos(d / (2 * R)) - (d / 2) * Math.sqrt(4 * R2 - d * d)
      const overlapPct = overlapArea / (Math.PI * R2)
      if (overlapPct > maxOverlap) maxOverlap = overlapPct
    }
    if (maxOverlap >= highRatio) return '#f56c6c'  // 高重叠：≥高阈值
    if (maxOverlap >= lowRatio) return '#e6a23c'   // 中重叠：低阈值~高阈值
    if (maxOverlap > 0) return '#409eff'           // 低重叠：0~低阈值
    return '#909399'                               // 无重叠
  })

  storeCircleLayer = L.layerGroup().addTo(map)
  const overlapFilters = storeCircleFilters.value.overlap
  let drawnCount = 0
  validStores.forEach((store, idx) => {
    const color = circleColors[idx]
    // 根据筛选条件决定是否绘制
    let filterKey
    if (color === '#f56c6c') filterKey = 'overlapHigh'
    else if (color === '#e6a23c') filterKey = 'overlapMid'
    else if (color === '#409eff') filterKey = 'overlapLow'
    else filterKey = 'overlapNone'
    if (!overlapFilters[filterKey]) return
    drawnCount++

    const circle = L.circle([store.latitude, store.longitude], {
      radius: radiusM,
      color: color,
      fillColor: color,
      fillOpacity: 0.12,
      weight: 2
    })
    circle.bindTooltip(`[${store._type}] ${store.name || '未知'} - ${storeCircleRadius.value}km`, { sticky: true })
    storeCircleLayer.addLayer(circle)
  })
  showStoreCircles.value = true
  // 构建图例——只显示已勾选的项，并附带各分类下的门店列表（供展开/复制）
  const overlapLegendMap = [
    { key: 'overlapHigh', color: '#f56c6c', label: `重叠率 ≥${highPct}%` },
    { key: 'overlapMid', color: '#e6a23c', label: `${lowPct}% ≤ 重叠率 < ${highPct}%` },
    { key: 'overlapLow', color: '#409eff', label: `0 < 重叠率 < ${lowPct}%` },
    { key: 'overlapNone', color: '#909399', label: '无重叠' }
  ]
  // 将门店按重叠档位分组（使用 validStores 与 circleColors 一一对应）
  const overlapGroups = {}
  validStores.forEach((store, idx) => {
    const color = circleColors[idx]
    const key = overlapLegendMap.find(m => m.color === color)?.key || 'overlapNone'
    if (!overlapGroups[key]) overlapGroups[key] = []
    overlapGroups[key].push(store.name || '未知门店')
  })
  storeCircleLegendItems.value = overlapLegendMap
    .filter(item => overlapFilters[item.key])
    .map(item => ({ key: item.key, color: item.color, label: item.label, stores: overlapGroups[item.key] || [] }))
  storeCircleLegendVisible.value = true
  saveOverlapThresholds()  // 保存本次设置的重叠率阈值
  console.log('[legend] overlap mode - visibility set to', storeCircleLegendVisible.value, 'items:', storeCircleLegendItems.value.length)
  ElMessage.success(`已为 ${drawnCount} 家门店生成 ${storeCircleRadius.value}km 商圈${drawnCount < validStores.length ? `（${validStores.length - drawnCount} 家因筛选未显示）` : ''}`)
}

// 城市商圈
const openCityTradeArea = async () => {
  if (cityTradeAreaLayer) {
    // 已显示，点击时清除
    map.removeLayer(cityTradeAreaLayer)
    cityTradeAreaLayer = null
    return
  }
  cityTradeAreaVisible.value = true
  cityTradeAreaLoading.value = true
  cityTradeAreaList.value = []
  try {
    const userId = userStore.user?.id || 1
    const res = await fetch(`/api/shapefiles?category=other`, {
      headers: { 'x-user-id': userId }
    })
    const json = await res.json()
    const files = json.data || []
    // 按城市分组：从文件名提取城市名（如"上海商圈"->"上海"）
    const cityMap = {}
    files.forEach(f => {
      // 用 shapefile name 中的城市名
      let cityName = f.name.replace(/商圈/g, '').replace(/区域/g, '').trim()
      if (!cityName) cityName = f.name
      if (!cityMap[cityName]) {
        cityMap[cityName] = { name: cityName, ids: [], count: 0 }
      }
      cityMap[cityName].ids.push(f.id)
      cityMap[cityName].count++
    })
    cityTradeAreaList.value = Object.values(cityMap)
  } catch (e) {
    console.error('[cityTradeArea] 获取城市列表失败:', e)
    ElMessage.error('获取城市商圈数据失败')
  } finally {
    cityTradeAreaLoading.value = false
  }
}

// 城市商圈 - 对话框确认
const onCityTradeAreaConfirm = (selectedCities) => {
  loadCityTradeArea(selectedCities)
}

const loadCityTradeArea = async (selectedCities) => {
  if (!map) { ElMessage.warning('地图未初始化'); return }
  cityTradeAreaVisible.value = false
  cityTradeAreaLoading.value = true
  // 清除已有图层
  if (cityTradeAreaLayer) {
    map.removeLayer(cityTradeAreaLayer)
    cityTradeAreaLayer = null
  }
  try {
    const userId = userStore.user?.id || 1
    // 先获取所有 other 类 shapefile
    const listRes = await fetch(`/api/shapefiles?category=other`, {
      headers: { 'x-user-id': userId }
    })
    const listJson = await listRes.json()
    const allFiles = listJson.data || []
    // 筛选出选中城市对应的文件
    const cityFileIds = []
    cityTradeAreaList.value.forEach(city => {
      if (selectedCities.includes(city.name)) {
        cityFileIds.push(...city.ids)
      }
    })
    if (cityFileIds.length === 0) {
      ElMessage.warning('请选择至少一个城市')
      return
    }
    // 逐个获取完整 GeoJSON
    cityTradeAreaLayer = L.layerGroup().addTo(map)
    let totalFeatures = 0
    for (let i = 0; i < cityFileIds.length; i++) {
      const fid = cityFileIds[i]
      const res = await fetch(`/api/shapefiles/${fid}`, {
        headers: { 'x-user-id': userId }
      })
      const json = await res.json()
      const geojson = json.data?.geojson
      if (!geojson || !geojson.features) continue
      const colorIdx = i % CITY_TRADE_AREA_COLORS.length
      const fillColor = CITY_TRADE_AREA_COLORS[colorIdx]
      const borderColor = fillColor
      const NAME_FIELDS = ['名称', 'name', 'Name', 'NAME']
      const layer = L.geoJSON(geojson, {
        style: {
          color: borderColor,
          weight: 2,
          fillColor: fillColor,
          fillOpacity: 0.15
        },
        onEachFeature: (feature, featureLayer) => {
          let name = ''
          for (const field of NAME_FIELDS) {
            if (feature.properties && feature.properties[field]) {
              name = feature.properties[field]
              break
            }
          }
          if (name) {
            featureLayer.bindTooltip(name, { sticky: true })
          }
        }
      })
      cityTradeAreaLayer.addLayer(layer)
      totalFeatures += geojson.features.length
    }
    ElMessage.success(`已显示 ${selectedCities.length} 个城市的 ${totalFeatures} 个商圈面`)
  } catch (e) {
    console.error('[cityTradeArea] 加载商圈数据失败:', e)
    handleApiError(e, { context: '加载商圈数据' })
  } finally {
    cityTradeAreaLoading.value = false
  }
}

// 图例弹窗关闭时同步清除商圈圆形
const onStoreCircleLegendClose = () => {
  showStoreCircles.value = false
  storeCircleLegendItems.value = []
  storeCircleLegendVisible.value = false
  if (storeCircleLayer) {
    try { map.removeLayer(storeCircleLayer) } catch(e) {}
    storeCircleLayer = null
  }
}

// 清除绘制
const clearDrawings = () => {
  if (!map) {
    console.log('[clearDrawings] 地图未初始化')
    return
  }
  if (activeTool.value === 'measure') stopMeasure()
  if (activeTool.value === 'area') stopAreaMeasure()
  try {
    if (measureLine) { map.removeLayer(measureLine); measureLine = null }
    if (measureArea) { map.removeLayer(measureArea); measureArea = null }
    if (measureLayerGroup) { map.removeLayer(measureLayerGroup); measureLayerGroup = null }
    if (drawnItems) drawnItems.clearLayers()
    // 清除临时圆心图钉（商圈内点位/商圈人口分布选点后未确认留下的）
    if (tempCircleMarker) {
      map.removeLayer(tempCircleMarker)
      tempCircleMarker = null
    }
    if (tempPopulationMarker) {
      map.removeLayer(tempPopulationMarker)
      tempPopulationMarker = null
    }
    // 清除分析圆形图层
    if (analysisCircleLayer) {
      map.removeLayer(analysisCircleLayer)
      analysisCircleLayer = null
    }
    // 清除门店商圈圆形
    if (storeCircleLayer) {
      map.removeLayer(storeCircleLayer)
      storeCircleLayer = null
    }
    showStoreCircles.value = false
    storeCircleLegendItems.value = []
    storeCircleLegendVisible.value = false
    // 清除Shapefile检索高亮图层
    if (shapefileQueryLayer) {
      map.removeLayer(shapefileQueryLayer)
      shapefileQueryLayer = null
    }
    // 清除行政边界图层
    if (districtLayer) {
      map.removeLayer(districtLayer)
      districtLayer = null
    }
    // 清除商圈查询图层
    if (potentialLayer) {
      map.removeLayer(potentialLayer)
      potentialLayer = null
    }
    if (commerceLayer) {
      map.removeLayer(commerceLayer)
      commerceLayer = null
    }
    // 清除城市商圈图层
    if (cityTradeAreaLayer) {
      map.removeLayer(cityTradeAreaLayer)
      cityTradeAreaLayer = null
    }
    // 清除多边形图层
    if (tempPolygonLayer) {
      map.removeLayer(tempPolygonLayer)
      tempPolygonLayer = null
    }
    if (tempPolygonMarker) {
      map.removeLayer(tempPolygonMarker)
      tempPolygonMarker = null
    }
    tempPolygonPoints = []
  } catch (e) {
    console.error('[clearDrawings] 清除图层失败:', e)
  }
  measurePoints = []
  measureAreaPoints = []
  measurementResult.value = ''
  districtResult.value = null
  districtError.value = ''
  districtStoreCounts.value = null
  commerceLayerItems.value = []
  commerceResult.value = null
  commerceNoResult.value = false
  commerceError.value = ''
  commerceArea.value = null
  commerceStoreCounts.value = null
  potentialResults.value = []
  activeTool.value = ''
  ElMessage.success('已清除')
}

// 查询行政边界
const searchDistrict = async () => {
  if (!districtKeyword.value.trim()) {
    ElMessage.warning('请输入城市或区县名称')
    return
  }
  districtLoading.value = true
  districtResult.value = null
  districtError.value = ''
  try {
    const res = await fetch(`/api/district/boundary?keywords=${encodeURIComponent(districtKeyword.value.trim())}`)
    const data = await res.json()
    if (data.success && data.data && data.data.boundaries.length > 0) {
      districtResult.value = data.data

      // 清除旧的行政边界图层
      if (districtLayer) {
        map.removeLayer(districtLayer)
        districtLayer = null
      }

      // 在地图上绘制边界
      const polygons = data.data.boundaries.map(coords =>
        L.polygon(coords, {
          color: '#e74c3c',
          weight: 2.5,
          opacity: 0.8,
          fillColor: '#e74c3c',
          fillOpacity: 0.08
        })
      )
      districtLayer = L.featureGroup(polygons).addTo(map)

      // 缩放到边界范围
      const bounds = districtLayer.getBounds()
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40] })
      }

      ElMessage.success(`已显示「${data.data.name}」行政边界`)
      
      // 如果是从城市数据页跳转来，额外显示统计数据弹窗
      if (window._pendingCityStats) {
        var cityN = window._pendingCityStats; delete window._pendingCityStats
        fetch('/api/city-data/' + encodeURIComponent(cityN)).then(function(r){return r.json()}).then(function(cd){
          if (!cd.success || !cd.data) return
          var d = cd.data
          var html = '<div style="font-size:13px;line-height:1.8;min-width:200px"><h3 style="margin:0 0 8px;font-size:15px;border-bottom:1px solid #eee;padding-bottom:6px">' + (d['城市']||'') + ' ' + (d['年份']||'') + '</h3>'
          if (d['GDP(亿元)']) html += '<div>GDP: ' + d['GDP(亿元)'].toLocaleString() + ' 亿</div>'
          if (d['增速(%)']) html += '<div>增速: ' + d['增速(%)'] + '%</div>'
          if (d['人均GDP(元)']) html += '<div>人均GDP: ' + d['人均GDP(元)'].toLocaleString() + ' 元</div>'
          if (d['年末常住人口(万人)']) html += '<div>常住人口: ' + d['年末常住人口(万人)'].toLocaleString() + ' 万</div>'
          if (d['城镇居民人均可支配收入(元)']) html += '<div>人均可支配收入: ' + d['城镇居民人均可支配收入(元)'].toLocaleString() + ' 元</div>'
          if (d['社会消费品零售总额(亿元)']) html += '<div>社零总额: ' + d['社会消费品零售总额(亿元)'].toLocaleString() + ' 亿</div>'
          html += '</div>'
          L.popup({maxWidth:360}).setLatLng(districtLayer.getBounds().getCenter()).setContent(html).openOn(map)
          // 绑定到边界图层，点击可重新打开
          window._cityStatsHtml = html
          districtLayer.eachLayer(function(layer){
            layer.off('click')
            layer.on('click', function(){
              L.popup({maxWidth:360}).setLatLng(layer.getBounds().getCenter()).setContent(window._cityStatsHtml).openOn(map)
            })
          })
        }).catch(function(e){console.error('[CityData] 弹窗失败:',e)})
      }

      // 从后端统计边界内门店数量
      try {
        const countRes = await fetch('/api/district/store-counts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionStorage.getItem('token')}` },
          body: JSON.stringify({ boundaries: data.data.boundaries })
        })
        const countData = await countRes.json()
        if (countData.success) districtStoreCounts.value = countData.data
      } catch (e) {
        console.error('[District] 门店统计请求失败:', e)
      }
    } else {
      districtError.value = data.error || '未找到该行政区划的边界数据'
      ElMessage.warning(districtError.value)
    }
  } catch (e) {
    console.error('[District] 查询失败:', e)
    districtError.value = '查询失败: ' + e.message
    handleApiError(e, { context: '行政边界查询' })
  } finally {
    districtLoading.value = false
  }
}


// 清除行政边界
const clearDistrictBoundary = () => {
  if (districtLayer && map) {
    map.removeLayer(districtLayer)
    districtLayer = null
  }
  districtResult.value = null
  districtError.value = ''
}

// 按商圈查询
const searchCommerce = async () => {
  if (!commerceKeyword.value.trim()) {
    ElMessage.warning('请输入商圈名称')
    return
  }
  commerceLoading.value = true
  commerceResult.value = null
  commerceNoResult.value = false
  commerceError.value = ''
  try {
    // 先清除旧图层
    if (commerceLayer && map) {
      map.removeLayer(commerceLayer)
      commerceLayer = null
    }
    commerceLayerItems.value = []

    const res = await fetch('/api/shapefiles/search-commerce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: commerceKeyword.value.trim() })
    })
    const data = await res.json()
    if (data.success && data.data.features.length > 0) {
      commerceResult.value = data.data
      commerceLoading.value = false

      // 在地图上绘制商圈多边形
      const polygons = []
      commerceLayerItems.value = data.data.features

      for (const item of data.data.features) {
        const feature = item.feature
        const props = feature.properties || {}
        const name = props[item.shapefileField] || '未知'
        const coords = feature.geometry.coordinates

        if (feature.geometry.type === 'Polygon') {
          const latlngs = coords[0].map(c => [c[1], c[0]])
          const poly = L.polygon(latlngs, {
            color: '#ff6600',
            weight: 3,
            opacity: 0.8,
            fillColor: '#ff6600',
            fillOpacity: 0.1,
            interactive: false
          })
          poly.bindTooltip(name, { permanent: false, direction: 'center', className: 'commerce-tooltip' })
          polygons.push(poly)
        } else if (feature.geometry.type === 'MultiPolygon') {
          for (const polyCoords of coords) {
            const latlngs = polyCoords[0].map(c => [c[1], c[0]])
            const poly = L.polygon(latlngs, {
              color: '#ff6600',
              weight: 3,
              opacity: 0.8,
              fillColor: '#ff6600',
              fillOpacity: 0.1,
              interactive: false
            })
            poly.bindTooltip(name, { permanent: false, direction: 'center', className: 'commerce-tooltip' })
            polygons.push(poly)
          }
        }
      }

      if (polygons.length > 0 && map) {
        commerceLayer = L.featureGroup(polygons).addTo(map)
        const bounds = commerceLayer.getBounds()
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40] })
        }

        // 提取边界坐标用于门店统计（Leaflet格式 [[lat,lng],...]）
        const boundaries = []
        for (const item of data.data.features) {
          const feature = item.feature
          const coords = feature.geometry.coordinates
          if (feature.geometry.type === 'Polygon') {
            boundaries.push(coords[0].map(c => [c[1], c[0]]))
          } else if (feature.geometry.type === 'MultiPolygon') {
            for (const polyCoords of coords) {
              boundaries.push(polyCoords[0].map(c => [c[1], c[0]]))
            }
          }
        }

        // 计算面积（球面近似）
        if (boundaries.length > 0) {
          const flatCoords = boundaries.flat()
          if (flatCoords.length >= 3) {
            // calculatePolygonArea 需要 [lng, lat] 格式
            const lngLatCoords = flatCoords.map(p => [p[1], p[0]])
            const areaSqm = calculatePolygonArea(lngLatCoords)
            commerceArea.value = Math.round(areaSqm / 10000) / 100  // 平方米 → 平方公里，保留2位
          }
        }

        // 查询商圈内门店统计（使用前端 Turf.js 精确计算）
        try {
          const token = sessionStorage.getItem('token')
          const authHeaders = { 'Authorization': `Bearer ${token}` }

          // 获取所有门店、竞品、购物中心数据
          const [markersRes, compRes, shopRes] = await Promise.all([
            fetch('/api/markers', { headers: authHeaders }).catch(() => null),
            fetch('/api/competitors', { headers: authHeaders }).catch(() => null),
            fetch('/api/shopping-centers', { headers: authHeaders }).catch(() => null)
          ])

          // 将边界转为 turf Polygon（需要 [lng,lat] 格式）
          const turfPolygon = turf.polygon(boundaries.map(ring =>
            ring.map(p => [p[1], p[0]])  // [lat,lng] -> [lng,lat]
          ))

          // 统计我的门店
          let myTotal = 0, closed = 0
          const closedKeywords = ['闭店', '停业', '歇业', '休业', '结业', '暂停营业']
          if (markersRes && markersRes.ok) {
            const md = await markersRes.json()
            const allMarkers = md.markers || md.data || md || []
            if (Array.isArray(allMarkers)) for (const m of allMarkers) {
              if (m.latitude && m.longitude) {
                const pt = turf.point([m.longitude, m.latitude])
                if (turf.booleanPointInPolygon(pt, turfPolygon)) {
                  myTotal++
                  if (m.store_status && closedKeywords.some(kw => m.store_status.includes(kw))) closed++
                }
              }
            }
          }

          // 统计竞品门店（按品牌分组）
          const brandCounts = {}
          if (compRes && compRes.ok) {
            const cd = await compRes.json()
            const competitors = cd.competitors || cd.data || cd || []
            if (Array.isArray(competitors)) for (const c of competitors) {
              if (c.latitude && c.longitude) {
                const pt = turf.point([c.longitude, c.latitude])
                if (turf.booleanPointInPolygon(pt, turfPolygon)) {
                  const brand = c.brand || '未知品牌'
                  brandCounts[brand] = (brandCounts[brand] || 0) + 1
                }
              }
            }
          }

          // 统计购物中心
          let shoppingTotal = 0
          if (shopRes && shopRes.ok) {
            const sd = await shopRes.json()
            const centers = sd.shoppingCenters || sd.data || sd || []
            if (Array.isArray(centers)) for (const s of centers) {
              if (s.latitude && s.longitude) {
                const pt = turf.point([s.longitude, s.latitude])
                if (turf.booleanPointInPolygon(pt, turfPolygon)) {
                  shoppingTotal++
                }
              }
            }
          }

          commerceStoreCounts.value = {
            myStores: { total: myTotal, closed },
            competitors: brandCounts,
            shoppingCenters: shoppingTotal
          }
        } catch (e) {
          console.error('[Commerce] 门店统计请求失败:', e)
        }
      }
      ElMessage.success(`找到 ${data.data.total} 个匹配商圈`)
    } else {
      commerceNoResult.value = true
      ElMessage.info('未找到匹配的商圈')
    }
  } catch (e) {
    console.error('[Commerce] 查询失败:', e)
    commerceError.value = '查询失败: ' + e.message
    handleApiError(e, { context: '商圈查询' })
  } finally {
    commerceLoading.value = false
  }
}

// 清除商圈图层
const clearCommerceLayer = () => {
  if (commerceLayer && map) {
    map.removeLayer(commerceLayer)
    commerceLayer = null
  }
  commerceLayerItems.value = []
  commerceResult.value = null
  commerceNoResult.value = false
  commerceError.value = ''
  commerceArea.value = null
  commerceStoreCounts.value = null
}




// 开店余地：加载城市列表
const loadPotentialCities = async () => {
  try {
    const res = await fetch('/api/shapefiles?category=population')
    const data = await res.json()
    if (data && data.data) {
      let cities = data.data.map(f => {
        const name = f.name || ''
        return name.replace('1km网格人口.zip', '').replace('.zip', '')
      }).filter(c => c && /[\u4e00-\u9fa5]/.test(c))
      cities = [...new Set(cities)]
      // 按拼音排序
      cities.sort((a, b) => a.localeCompare(b, 'zh-CN'))
      populationCities.value = cities
    }
  } catch(e) {
    console.error('[Potential] 加载城市列表失败:', e)
  }
}

// 开店余地：加载字段列表（点击下拉时触发）
const loadPotentialFields = async () => {
  if (!potentialCity.value || potentialNumericFields.value.length > 0) return
  try {
    const res = await fetch('/api/shapefiles?category=population')
    const data = await res.json()
    const file = (data.data || []).find(f => (f.name || '').includes(potentialCity.value))
    if (file) {
      const fieldsRes = await fetch('/api/shapefiles/' + file.id + '/fields')
      const fieldsData = await fieldsRes.json()
      if (fieldsData.success) {
        potentialNumericFields.value = fieldsData.data.numericFields || []
      }
    }
  } catch(e) {
    console.error('[Potential] 加载字段失败:', e)
  }
}

// 开店余地：城市切换时加载字段
const onPotentialFieldChange = async (idx) => {
  if (!potentialCity.value) return
  try {
    const res = await fetch('/api/shapefiles?category=population')
    const data = await res.json()
    const file = (data.data || []).find(f => (f.name || '').includes(potentialCity.value))
    if (file) {
      const fieldsRes = await fetch('/api/shapefiles/' + file.id + '/fields')
      const fieldsData = await fieldsRes.json()
      if (fieldsData.success) {
        potentialNumericFields.value = fieldsData.data.numericFields || []
      }
    }
  } catch(e) {
    console.error('[Potential] 加载字段失败:', e)
  }
}

// 开店余地：开始分析
const calculatePotential = async () => {
  if (!potentialCity.value) { ElMessage.warning('请选择城市'); return }
  potentialLoading.value = true
  try {
    // 清除旧图层
    if (potentialLayer && map) {
      map.removeLayer(potentialLayer)
      potentialLayer = null
    }
    const conditions = []
    if (potentialCond1Field.value && potentialCond1Val.value !== null) {
      conditions.push({ field: potentialCond1Field.value, operator: potentialCond1Op.value || '>', value: potentialCond1Val.value })
    }
    if (potentialCond2Field.value && potentialCond2Val.value !== null) {
      conditions.push({ field: potentialCond2Field.value, operator: potentialCond2Op.value || '>', value: potentialCond2Val.value })
    }
    const res = await fetch('/api/shapefiles/calculate-potential', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cityName: potentialCity.value,
        radius: potentialRadius.value,
        myStoreOp: potentialMyStoreOp.value || '>',
        myStoreVal: potentialMyStoreVal.value,
        competitorOp: potentialCompOp.value || '>',
        competitorVal: potentialCompVal.value,
        myStoreBrands: potentialMyBrands.value,
        compBrands: potentialCompBrands.value,
        otherBrand1: potentialOther1Name.value ? { name: potentialOther1Name.value.trim(), op: potentialOther1Op.value || '>', val: potentialOther1Val.value || 1 } : null,
        otherBrand2: potentialOther2Name.value ? { name: potentialOther2Name.value.trim(), op: potentialOther2Op.value || '>', val: potentialOther2Val.value || 1 } : null,
        conditions
      })
    })
    const data = await res.json()
    if (data.success && data.data.matched > 0) {
      potentialResults.value = data.data.results
      // 在地图上显示符合条件的圆
      const circles = []
      for (const r of data.data.results) {
        const circle = L.circle([r.center[1], r.center[0]], {
          radius: r.radius * 1000,
          color: '#67c23a',
          weight: 2,
          opacity: 0.7,
          fillColor: '#67c23a',
          fillOpacity: 0.12,
          interactive: false
        })
        const otherText = (r.otherStores || []).map(o => o.name + ':' + o.count).join(' ')
        circle.bindTooltip('门店:' + r.myStores + ' 竞品:' + r.competitors + (otherText ? ' ' + otherText : ''), {
          permanent: false, direction: 'center', className: 'potential-tooltip'
        })
        circles.push(circle)
      }
      if (circles.length > 0 && map) {
        potentialLayer = L.featureGroup(circles).addTo(map)
        map.fitBounds(potentialLayer.getBounds(), { padding: [40, 40] })
      }
      ElMessage.success('找到 ' + data.data.matched + ' 个符合条件的区域')
    } else {
      ElMessage.info('未找到符合条件的区域')
    }
  } catch(e) {
    console.error('[Potential] 计算失败:', e)
    ElMessage.error('分析失败: ' + e.message)
  } finally {
    potentialLoading.value = false
  }
}

// 清除开店余地图层
const clearPotentialLayer = () => {
  if (potentialLayer && map) {
    map.removeLayer(potentialLayer)
    potentialLayer = null
  }
  potentialResults.value = []
}

// 切换图标样式
const changeMarkerStyle = (style) => {
  currentMarkerStyle.value = style
  loadMarkers() // 重新加载标记以应用新样式
  ElMessage.success(`已切换为${markerStyleOptions.find(s => s.value === style)?.label}样式`)
}

// 处理Shapefile检索结果高亮显示（稳定版）
let shapefileProcessing = false  // 防止重复处理

const handleShapefileQuery = (event) => {
  try {
    const { id, name, geojson, matched, displayFields } = event.detail

    console.log('[Shapefile Query] 收到请求:', { name, matched, displayFields, mapReady: !!map })

    // 首先检查 map 是否存在
    if (!map) {
      console.log('[Shapefile Query] 地图未初始化，等待...')
      setTimeout(() => {
        if (map) {
          handleShapefileQuery(event)
        } else {
          ElMessage.warning('地图初始化失败，请刷新页面')
        }
      }, 2000)
      return
    }

    // 防止重复处理
    if (shapefileProcessing) {
      console.log('[Shapefile Query] 正在处理中，跳过')
      return
    }

    // 检查数据
    if (!geojson || typeof geojson !== 'object') {
      ElMessage.error('Shapefile 数据格式错误')
      return
    }

    const features = geojson.features || []
    if (features.length === 0) {
      ElMessage.warning('没有匹配的要素')
      return
    }

    // 清除之前的高亮图层
    if (shapefileQueryLayer) {
      try {
        map.removeLayer(shapefileQueryLayer)
      } catch (e) {
        console.error('[Shapefile Query] 清除旧图层失败:', e)
      }
      shapefileQueryLayer = null
    }

    console.log('[Shapefile Query] 开始处理，共', features.length, '个要素')

    // 标记开始处理
    shapefileProcessing = true
    ElMessage.info(`正在加载 ${features.length} 个要素...`)

    // 创建图层组（必须用 featureGroup 才能调用 getBounds）
    shapefileQueryLayer = L.featureGroup()

    // 使用递归分批处理，每批10个，避免阻塞
    const BATCH_SIZE = 10
    let currentIndex = 0

    const processBatch = () => {
      // 确保 map 仍然存在
      if (!map) {
        console.log('[Shapefile Query] 地图已失效，停止处理')
        shapefileProcessing = false
        return
      }

      if (currentIndex >= features.length) {
        // 全部处理完成，调整视图
        console.log('[Shapefile Query] 处理完成')
        shapefileProcessing = false

        // 确保图层已添加到地图
        try {
          if (!map.hasLayer(shapefileQueryLayer)) {
            shapefileQueryLayer.addTo(map)
          }
        } catch (e) {
          console.error('[Shapefile Query] 添加图层失败:', e)
        }

        // 调整视图
        setTimeout(() => {
          try {
            if (map && shapefileQueryLayer) {
              const bounds = shapefileQueryLayer.getBounds()
              if (bounds && bounds.isValid && bounds.isValid()) {
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 })
              } else {
                console.warn('[Shapefile Query] bounds无效')
              }
            }
          } catch (e) {
            console.error('[Shapefile Query] 调整视图失败:', e)
          }
        }, 100)

        ElMessage.success(`已高亮显示 "${name}" 中的 ${matched} 个匹配要素（橙色边界线）`)
        return
      }

      // 处理当前批次
      const endIndex = Math.min(currentIndex + BATCH_SIZE, features.length)
      console.log(`[Shapefile Query] 处理批次 ${currentIndex + 1}-${endIndex}/${features.length}`)

      for (let i = currentIndex; i < endIndex; i++) {
        const feature = features[i]
        const geometry = feature.geometry
        if (!geometry) continue

        try {
          const coords = geometry.coordinates
          const geomType = geometry.type
          const props = feature.properties || {}

          // 构建属性显示文本
          const propsText = Object.entries(props)
            .filter(([_, v]) => v !== null && v !== undefined && v !== '')
            .slice(0, 8)
            .map(([k, v]) => `<b>${k}</b>: ${v}`)
            .join('<br>')

          const addPolygon = (ring, featureProps) => {
            try {
              const latlngs = ring.map(coord => L.latLng(coord[1], coord[0]))
              if (latlngs.length < 3) return

              // 加粗边界线：weight 从 2 改为 5
              const polyline = L.polyline(latlngs, {
                color: '#ff6600',
                weight: 5,
                opacity: 0.9
              })

              polyline.bindPopup(`
                <div style="font-size:12px; max-width: 280px;">
                  <b style="color:#e6a23c;">${name}</b><br>
                  <hr style="margin: 6px 0;">
                  ${propsText}
                </div>
              `)

              shapefileQueryLayer.addLayer(polyline)

              // 在 Polygon 中心位置显示数值
              const polygon = L.polygon(latlngs)
              const center = polygon.getBounds().getCenter()

              // 只显示检索条件中指定的字段（displayFields）
              let displayValues = []

              if (displayFields && displayFields.length > 0) {
                // 用户指定了显示字段，只显示这些字段
                displayValues = displayFields
                  .filter(field => field in (featureProps || {}))
                  .map(field => {
                    const v = featureProps[field]
                    if (v === null || v === undefined || v === '') return null
                    // 显示文本字段（名称等）原文
                    if (typeof v === 'string' && isNaN(Number(v))) {
                      return `${field}: ${v}`
                    }
                    // 显示数字字段
                    const num = typeof v === 'number' ? v : Number(v)
                    if (isNaN(num)) return null
                    return `${field}: ${Math.round(num)}`
                  })
                  .filter(v => v !== null)
              } else {
                // 没有指定字段，回退到显示所有数值字段
                displayValues = Object.entries(featureProps || {})
                  .filter(([_, v]) => {
                    if (v === null || v === undefined || v === '') return false
                    if (typeof v === 'number' && !isNaN(v)) return true
                    if (typeof v === 'string') {
                      const num = Number(v)
                      return !isNaN(num) && v.trim() !== ''
                    }
                    return false
                  })
                  .slice(0, 3)
                  .map(([k, v]) => {
                    const num = typeof v === 'number' ? v : Number(v)
                    return `${k}: ${Math.round(num)}`
                  })
              }

              if (displayValues.length > 0) {
                const numericValue = displayValues.join('<br>')
                const labelIcon = L.divIcon({
                  className: 'shapefile-query-label',
                  html: `<div style="
                    background: rgba(255, 102, 0, 0.85);
                    color: white;
                    padding: 6px 10px;
                    border-radius: 4px;
                    font-size: 13px;
                    font-weight: bold;
                    text-align: center;
                    white-space: nowrap;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                    line-height: 1.5;
                    min-width: 80px;
                  ">${numericValue}</div>`,
                  iconSize: [140, 50],
                  iconAnchor: [70, 25]
                })
                const labelMarker = L.marker(center, { icon: labelIcon })
                shapefileQueryLayer.addLayer(labelMarker)
              }
            } catch (e) {
              console.error('[Shapefile Query] 添加多边形失败:', e)
            }
          }

          if (geomType === 'Polygon') {
            coords.forEach(ring => addPolygon(ring, props))
          } else if (geomType === 'MultiPolygon') {
            coords.forEach(polygon => polygon.forEach(ring => addPolygon(ring, props)))
          }
        } catch (e) {
          console.error('[Shapefile Query] 处理 feature 失败:', e)
        }
      }

      currentIndex = endIndex

      // 使用 requestAnimationFrame 让浏览器喘口气，然后继续下一批
      if (currentIndex < features.length) {
        requestAnimationFrame(() => {
          setTimeout(processBatch, 50)
        })
      } else {
        // 最后一帧
        requestAnimationFrame(() => {
          processBatch()
        })
      }
    }

    // 延迟开始处理，确保地图已准备好
    setTimeout(processBatch, 500)

  } catch (error) {
    shapefileProcessing = false
    console.error('[Shapefile Query] 显示失败:', error)
    ElMessage.error('显示失败: ' + error.message)
  }
}

// ===== 定位门店检索 =====
const storeSearchVisible = ref(false)
const storeSearchKeyword = ref('')
const searchTabActive = ref('marker')  // marker | competitor | brand | shopping
const locateResults = ref({ marker: [], competitor: [], brand: [], shopping: [] })
// 拖拽
const searchPanelPos = ref({ top: 60, right: 180 })
let isDragging = false
let dragStart = { x: 0, y: 0, top: 0, right: 0 }

const onDragStart = (e) => {
  isDragging = true
  dragStart = { x: e.clientX, y: e.clientY, top: searchPanelPos.value.top, right: searchPanelPos.value.right }
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}
const onDragMove = (e) => {
  if (!isDragging) return
  searchPanelPos.value = {
    top: dragStart.top + (e.clientY - dragStart.y),
    right: dragStart.right - (e.clientX - dragStart.x)
  }
}
const onDragEnd = () => {
  isDragging = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

// 门店商圈图例拖拽
const legendPanelPos = ref({ top: 100, left: 14 })
let isLegendDragging = false
let legendDragStart = { x: 0, y: 0, bottom: 0, left: 0 }

const onLegendDragStart = (e) => {
  isLegendDragging = true
  legendDragStart = { x: e.clientX, y: e.clientY, top: legendPanelPos.value.top, left: legendPanelPos.value.left }
  document.addEventListener('mousemove', onLegendDragMove)
  document.addEventListener('mouseup', onLegendDragEnd)
}
const onLegendDragMove = (e) => {
  if (!isLegendDragging) return
  legendPanelPos.value = {
    top: legendDragStart.top + (e.clientY - legendDragStart.y),
    left: legendDragStart.left + (e.clientX - legendDragStart.x)
  }
}
const onLegendDragEnd = () => {
  isLegendDragging = false
  document.removeEventListener('mousemove', onLegendDragMove)
  document.removeEventListener('mouseup', onLegendDragEnd)
}

// 各标签页独立筛选条件
// 我的门店
const markerFilterStoreType = ref('')
const markerFilterCity = ref('')
const markerFilterDistrict = ref('')
const markerFilterBrand = ref('')
const markerFilterStoreStatus = ref('')
// 竞品门店
const compFilterCity = ref('')
const compFilterDistrict = ref('')
const compFilterBrand = ref('')
const compFilterReviews = ref('')
// 品牌门店
const brandFilterCity = ref('')
const brandFilterDistrict = ref('')
const brandFilterBrand = ref('')
// 购物中心
const shopFilterCity = ref('')
const shopFilterDistrict = ref('')
const shopFilterReviews = ref('')

// 评论数筛选范围
const reviewRangeOptions = [
  { label: '< 100', value: '<100' },
  { label: '100-500', value: '100-500' },
  { label: '500-1000', value: '500-1000' },
  { label: '1000-5000', value: '1000-5000' },
  { label: '5000+', value: '5000+' },
]

// 各门店筛选列表
const markerCityList = computed(() => [...new Set(markerStore.markers.map(m => m.city).filter(Boolean))].sort())
const markerDistrictList = computed(() => {
  const city = markerFilterCity.value
  return [...new Set(markerStore.markers.filter(m => !city || m.city === city).map(m => m.district).filter(Boolean))].sort()
})
const markerBrandList = computed(() => [...new Set(markerStore.markers.map(m => m.brand).filter(Boolean))].sort())
const markerStoreStatusList = computed(() => [...new Set(markerStore.markers.map(m => m.store_status).filter(Boolean))].sort())

const compCityList = computed(() => [...new Set(competitorStore.competitors.map(m => m.city).filter(Boolean))].sort())
const compDistrictList = computed(() => {
  const city = compFilterCity.value
  return [...new Set(competitorStore.competitors.filter(m => !city || m.city === city).map(m => m.district).filter(Boolean))].sort()
})
const compBrandList = computed(() => [...new Set(competitorStore.competitors.map(m => m.brand).filter(Boolean))].sort())

const brandCityList = computed(() => [...new Set(brandStoreStore.brandStores.map(m => m.city).filter(Boolean))].sort())
const brandDistrictList = computed(() => {
  const city = brandFilterCity.value
  return [...new Set(brandStoreStore.brandStores.filter(m => !city || m.city === city).map(m => m.district).filter(Boolean))].sort()
})
const brandBrandList = computed(() => [...new Set(brandStoreStore.brandStores.map(m => m.brand).filter(Boolean))].sort())

const shopCityList = computed(() => [...new Set(shoppingCenterStore.shoppingCenters.map(m => m.city).filter(Boolean))].sort())
const shopDistrictList = computed(() => {
  const city = shopFilterCity.value
  return [...new Set(shoppingCenterStore.shoppingCenters.filter(m => !city || m.city === city).map(m => m.district).filter(Boolean))].sort()
})

// 城市切换时清理区县（每个标签页独立）
watch(markerFilterCity, (nc) => { if (nc && markerFilterDistrict.value && !markerDistrictList.value.includes(markerFilterDistrict.value)) markerFilterDistrict.value = '' })
watch(compFilterCity, (nc) => { if (nc && compFilterDistrict.value && !compDistrictList.value.includes(compFilterDistrict.value)) compFilterDistrict.value = '' })
watch(brandFilterCity, (nc) => { if (nc && brandFilterDistrict.value && !brandDistrictList.value.includes(brandFilterDistrict.value)) brandFilterDistrict.value = '' })
watch(shopFilterCity, (nc) => { if (nc && shopFilterDistrict.value && !shopDistrictList.value.includes(shopFilterDistrict.value)) shopFilterDistrict.value = '' })

// ===== 通用搜索函数 =====
const filterByKw = (items, kw) => {
  if (!kw) return items.slice(0, 50)
  return items.filter(m => (
    m.name?.toLowerCase().includes(kw) ||
    m.brand?.toLowerCase().includes(kw) ||
    m.address?.toLowerCase().includes(kw) ||
    m.city?.toLowerCase().includes(kw) ||
    m.district?.toLowerCase().includes(kw) ||
    m.store_code?.toLowerCase().includes(kw)
  )).slice(0, 50)
}

// 评论数范围过滤（兼容竞品的 reviews 字段和购物中心的 comments 字段）
const filterByReviews = (items, range) => {
  if (!range) return items
  const [min, max] = range.split('-').map(Number)
  return items.filter(i => {
    // 竞品用 reviews，购物中心用 comments
    const v = Number(i.reviews ?? i.comments) || 0
    if (range === '<100') return v < 100
    if (range === '5000+') return v >= 5000
    return v >= min && v <= max
  })
}

// 模糊检索：并行搜索4种门店类型（各自独立筛选）
const onStoreSearch = () => {
  const kw = storeSearchKeyword.value.trim().toLowerCase()

  // 我的门店（独立筛选）
  let m = markerStore.markers
  if (markerFilterStoreType.value) m = m.filter(i => i.store_type === markerFilterStoreType.value)
  if (markerFilterCity.value) m = m.filter(i => i.city === markerFilterCity.value)
  if (markerFilterDistrict.value) m = m.filter(i => i.district === markerFilterDistrict.value)
  if (markerFilterBrand.value) m = m.filter(i => i.brand === markerFilterBrand.value)
  if (markerFilterStoreStatus.value) m = m.filter(i => i.store_status === markerFilterStoreStatus.value)
  locateResults.value.marker = filterByKw(m, kw)

  // 竞品门店（独立筛选）
  let c = competitorStore.competitors
  if (compFilterCity.value) c = c.filter(i => i.city === compFilterCity.value)
  if (compFilterDistrict.value) c = c.filter(i => i.district === compFilterDistrict.value)
  if (compFilterBrand.value) c = c.filter(i => i.brand === compFilterBrand.value)
  if (compFilterReviews.value) c = filterByReviews(c, compFilterReviews.value)
  locateResults.value.competitor = filterByKw(c, kw)

  // 品牌门店（独立筛选）
  let b = brandStoreStore.brandStores
  if (brandFilterCity.value) b = b.filter(i => i.city === brandFilterCity.value)
  if (brandFilterDistrict.value) b = b.filter(i => i.district === brandFilterDistrict.value)
  if (brandFilterBrand.value) b = b.filter(i => i.brand === brandFilterBrand.value)
  locateResults.value.brand = filterByKw(b, kw)

  // 购物中心（独立筛选）
  let s = shoppingCenterStore.shoppingCenters
  if (shopFilterCity.value) s = s.filter(i => i.city === shopFilterCity.value)
  if (shopFilterDistrict.value) s = s.filter(i => i.district === shopFilterDistrict.value)
  if (shopFilterReviews.value) s = filterByReviews(s, shopFilterReviews.value)
  locateResults.value.shopping = filterByKw(s, kw)

  // 同步地图显示（仅我的门店）
  const hasFilters = kw || markerFilterStoreType.value || markerFilterCity.value || markerFilterDistrict.value ||
    markerFilterBrand.value || markerFilterStoreStatus.value
  if (hasFilters) {
    const allFiltered = markerStore.markers.filter(i => {
      if (kw && !(i.name?.toLowerCase().includes(kw) || i.brand?.toLowerCase().includes(kw) ||
        i.address?.toLowerCase().includes(kw) || i.city?.toLowerCase().includes(kw) ||
        i.district?.toLowerCase().includes(kw) || i.store_code?.toLowerCase().includes(kw))) return false
      if (markerFilterStoreType.value && i.store_type !== markerFilterStoreType.value) return false
      if (markerFilterCity.value && i.city !== markerFilterCity.value) return false
      if (markerFilterDistrict.value && i.district !== markerFilterDistrict.value) return false
      if (markerFilterBrand.value && i.brand !== markerFilterBrand.value) return false
      if (markerFilterStoreStatus.value && i.store_status !== markerFilterStoreStatus.value) return false
      return true
    })
    markerStore.setVisibleIds(allFiltered.map(m => m.id))
  } else {
    markerStore.setVisibleIds(null)
  }

  // 同步地图显示 - 竞品门店
  const compFilterActive = kw || compFilterCity.value || compFilterDistrict.value || compFilterBrand.value || compFilterReviews.value
  if (compFilterActive) {
    competitorStore.setVisibleIds(competitorStore.competitors.filter(i => {
      if (kw && !(i.name?.toLowerCase().includes(kw) || i.brand?.toLowerCase().includes(kw) ||
        i.address?.toLowerCase().includes(kw) || i.city?.toLowerCase().includes(kw) ||
        i.district?.toLowerCase().includes(kw) || i.store_code?.toLowerCase().includes(kw))) return false
      if (compFilterCity.value && i.city !== compFilterCity.value) return false
      if (compFilterDistrict.value && i.district !== compFilterDistrict.value) return false
      if (compFilterBrand.value && i.brand !== compFilterBrand.value) return false
      if (compFilterReviews.value && !filterByReviews([i], compFilterReviews.value).length) return false
      return true
    }).map(m => m.id))
    if (map && showCompetitorLayer.value) reloadCompetitorLayer()
  } else {
    competitorStore.setVisibleIds(null)
    if (map && showCompetitorLayer.value) reloadCompetitorLayer()
  }

  // 同步地图显示 - 品牌门店
  const brandFilterActive = kw || brandFilterCity.value || brandFilterDistrict.value || brandFilterBrand.value
  if (brandFilterActive) {
    brandStoreStore.setVisibleIds(brandStoreStore.brandStores.filter(i => {
      if (kw && !(i.name?.toLowerCase().includes(kw) || i.brand?.toLowerCase().includes(kw) ||
        i.address?.toLowerCase().includes(kw) || i.city?.toLowerCase().includes(kw) ||
        i.district?.toLowerCase().includes(kw) || i.store_code?.toLowerCase().includes(kw))) return false
      if (brandFilterCity.value && i.city !== brandFilterCity.value) return false
      if (brandFilterDistrict.value && i.district !== brandFilterDistrict.value) return false
      if (brandFilterBrand.value && i.brand !== brandFilterBrand.value) return false
      return true
    }).map(m => m.id))
  } else {
    brandStoreStore.setVisibleIds(null)
  }

  // 同步地图显示 - 购物中心
  const shopFilterActive = kw || shopFilterCity.value || shopFilterDistrict.value || shopFilterReviews.value
  if (shopFilterActive) {
    shoppingCenterStore.setVisibleIds(shoppingCenterStore.shoppingCenters.filter(i => {
      if (kw && !(i.name?.toLowerCase().includes(kw) || i.address?.toLowerCase().includes(kw) ||
        i.city?.toLowerCase().includes(kw) || i.district?.toLowerCase().includes(kw))) return false
      if (shopFilterCity.value && i.city !== shopFilterCity.value) return false
      if (shopFilterDistrict.value && i.district !== shopFilterDistrict.value) return false
      if (shopFilterReviews.value && !filterByReviews([i], shopFilterReviews.value).length) return false
      return true
    }).map(m => m.id))
    if (map && showShoppingCenterLayer.value) reloadShoppingCenterLayer()
  } else {
    shoppingCenterStore.setVisibleIds(null)
    if (map && showShoppingCenterLayer.value) reloadShoppingCenterLayer()
  }
}

// 点击门店跳转到地图（支持4种类型）
const locateStore = (store, type) => {
  if (!store.latitude || !store.longitude) {
    ElMessage.warning('该门店没有坐标信息')
    return
  }
  map.flyTo([store.latitude, store.longitude], 16, { animate: true, duration: 0.8 })
  // 根据类型找到对应 marker 打开 popup
  if (type === 'marker' && businessLayer) {
    businessLayer.eachLayer(layer => {
      if (layer._storeId === store.id) layer.openPopup()
    })
  } else if (type === 'brand' && brandMarkerMap[store.id]) {
    brandMarkerMap[store.id].openPopup()
  } else if (type === 'shopping' && shoppingCenterMarkerMap[store.id]) {
    shoppingCenterMarkerMap[store.id].openPopup()
  }
  // 竞品门店没有 marker map，先跳转位置即可
}

// 定位数据范围（保留供 AI 助手使用）
const fitBounds = () => {
  if (markerStore.markers.length === 0) {
    ElMessage.warning('暂无点位数据')
    return
  }

  const bounds = L.latLngBounds(
    markerStore.markers.map(m => [m.latitude, m.longitude])
  )
  map.fitBounds(bounds, { padding: [50, 50] })
}

// ===== AI 助手 Function Calling 执行器（委托给 aiExecutor.js） =====
const handleAiExecute = async (toolCall) => {
  try {
    const result = await executeTool(toolCall.name, toolCall.args, {
      map,
      markerStore, competitorStore, brandStoreStore, shoppingCenterStore,
      showCompetitorLayer, showBrandStoreLayer, showShoppingCenterLayer, showBusinessLayer,
      showHeatmap, showCluster,
      toggleHeatmap, toggleCluster, clearDrawings, setTool
    })
    
    // 需要用户选择位置
    if (result?.require_user_location) {
      poiPendingSearch.value = {
        keywords: result.keywords,
        radius: result.radius
      }
      poiPickLocationMode.value = true
      
      // 在AI对话框中显示提示
      if (aiAssistantRef.value) {
        const hintMsg = result.location_hint 
          ? `无法定位"${result.location_hint}"，请在地图上点击选择搜索中心点`
          : '请在地图上点击选择搜索中心点'
        aiAssistantRef.value.addFeedback(hintMsg)
      }
      
      // 显示提示消息
      if (result.location_hint) {
        ElMessage.warning(`无法定位"${result.location_hint}"，请在地图上点击选择搜索中心点`)
      } else {
        ElMessage.info('请在地图上点击选择搜索中心点')
      }
      return
    }
    
    if (result?.message) {
      ElMessage.success(result.message)
    }
    
    // 处理POI搜索结果
    if (result?.type === 'poi') {
      poiResults.value = result.pois || []
      poiResultVisible.value = true
      
      // 如果有搜索中心点，先 flyTo 过去让用户感知到"已定位到目标地点"
      if (result.centerLat && result.centerLng) {
        map.flyTo([result.centerLat, result.centerLng], 15, { animate: true, duration: 1.2 })
        // 短暂延迟后再展示完整范围（含所有POI结果）
        setTimeout(() => {
          showPoiOnMap(result.pois, result.centerLat, result.centerLng, result.radius)
        }, 1300)
      } else {
        showPoiOnMap(result.pois, result.centerLat, result.centerLng, result.radius)
      }
    }
  } catch (err) {
    console.error('[AI Execute]', err)
    // 静默失败：只打印日志，不弹出 toast，避免与成功的工具调用产生混乱提示
  }
}

// 在地图上显示POI标记
const showPoiOnMap = (pois, centerLat, centerLng, radius) => {
  try {
    console.log('[showPoiOnMap] 调用参数:', { pois: pois?.length, centerLat, centerLng, radius })
  
  // 清除之前的POI标记
  console.log('[showPoiOnMap] 清除旧标记，当前数量:', poiMarkers.value.length)
  poiMarkers.value.forEach(m => {
    try {
      map.removeLayer(m)
    } catch (e) {
      console.warn('[showPoiOnMap] 移除标记失败:', e)
    }
  })
  poiMarkers.value = []
  
  // 清除之前的中心点标记和半径圆
  if (poiCenterMarker) {
    try {
      map.removeLayer(poiCenterMarker)
    } catch (e) {
      console.warn('[showPoiOnMap] 移除中心点标记失败:', e)
    }
    poiCenterMarker = null
  }
  if (poiRadiusCircle) {
    try {
      map.removeLayer(poiRadiusCircle)
    } catch (e) {
      console.warn('[showPoiOnMap] 移除半径圆失败:', e)
    }
    poiRadiusCircle = null
  }
  
  if (!pois || pois.length === 0) {
    console.log('[showPoiOnMap] 没有POI数据')
    return
  }
  
  const bounds = []
  
  // 如果提供了中心点，绘制中心点标记和半径圆
  console.log('[showPoiOnMap v3] 检查中心点条件:', { centerLat, centerLng, condition: !!(centerLat && centerLng) })
  if (centerLat && centerLng) {
    poiCenterPoint = { lat: centerLat, lng: centerLng }
    poiSearchRadius = radius || 2000
    console.log('[showPoiOnMap v3] 绘制紫色虚线大圆，半径:', poiSearchRadius, '米')
    
    // 绘制搜索半径圆（紫色虚线大圆）
    poiRadiusCircle = L.circle([centerLat, centerLng], {
      radius: poiSearchRadius,
      color: '#6366f1',
      fillColor: '#6366f1',
      fillOpacity: 0.1,
      weight: 2,
      dashArray: '5, 5'
    }).addTo(map)
    
    // 点击半径圆显示POI结果面板
    poiRadiusCircle.on('click', () => {
      poiResultVisible.value = true
    })
    
    // 绘制中心点标记（红色图钉）
    poiCenterMarker = L.marker([centerLat, centerLng], {
      icon: L.divIcon({
        className: 'poi-center-icon',
        html: `<div style="position:relative;width:32px;height:40px;">
          <svg width="32" height="40" viewBox="0 0 32 40" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
            <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 24 16 24s16-12 16-24C32 7.163 24.837 0 16 0z" fill="#ef4444" stroke="#fff" stroke-width="2"/>
            <circle cx="16" cy="16" r="6" fill="#fff"/>
          </svg>
        </div>`,
        iconSize: [32, 40],
        iconAnchor: [16, 40]
      })
    }).addTo(map)
    
    // 点击圆心标记显示POI结果面板
    poiCenterMarker.on('click', () => {
      poiResultVisible.value = true
    })
    
    bounds.push([centerLat, centerLng])
  }
  
  pois.forEach((poi, index) => {
    if (!poi.location) return
    const [lng, lat] = poi.location.split(',').map(Number)
    if (isNaN(lat) || isNaN(lng)) return
    
    bounds.push([lat, lng])
    
    const icon = L.divIcon({
      html: `<div style="background:#6366f1;color:#fff;padding:4px 8px;border-radius:12px;font-size:11px;font-weight:500;box-shadow:0 2px 8px rgba(0,0,0,0.2);white-space:nowrap;">${index + 1}</div>`,
      className: 'poi-marker-icon',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    })
    
    const marker = L.marker([lat, lng], { icon }).addTo(map)
    marker.bindPopup(`
      <div style="min-width:180px;">
        <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${poi.name}</div>
        <div style="color:#666;font-size:12px;margin-bottom:2px;">${poi.address || ''}</div>
        <div style="color:#999;font-size:11px;">${poi.city}${poi.district}</div>
        ${poi.distance ? `<div style="color:#f56c6c;font-size:11px;margin-top:4px;">距中心: ${poi.distance}米</div>` : ''}
        ${poi.tel ? `<div style="color:#409eff;font-size:11px;margin-top:2px;">电话：${poi.tel}</div>` : ''}
      </div>
    `)
    
    poiMarkers.value.push(marker)
  })
  
  // 调整视野（包含中心点和所有POI，同时确保显示完整的圆）
  if (bounds.length > 0) {
    let targetBounds
    
    // 如果有圆心，创建包含圆范围的边界框
    if (centerLat && centerLng && radius) {
      const circleBounds = L.circle([centerLat, centerLng], { radius }).getBounds()
      if (bounds.length === 1) {
        // 只有圆心一个点，直接使用圆的范围
        try { map.fitBounds(circleBounds, { padding: [50, 50] }) } catch (_) {}
        return
      } else {
        // 合并 POI 边界和圆的边界
        const poiBounds = L.latLngBounds(bounds)
        targetBounds = circleBounds.extend(poiBounds)
      }
    } else {
      targetBounds = L.latLngBounds(bounds)
    }
    
    if (bounds.length === 1 && !radius) {
      try { map.setView(bounds[0], 15) } catch (_) {}
    } else {
      try { map.fitBounds(targetBounds, { padding: [50, 50] }) } catch (_) {}
    }
  }
  } catch (e) {
    console.warn('[showPoiOnMap] 显示POI标记时出错:', e)
  }
}

// ===== 周边环境打分卡 =====
const ENV_DIMENSIONS = [
  { key: 'mall', label: '购物中心', weight: 0.25 },
  { key: 'restaurant', label: '餐饮', weight: 0.25 },
  { key: 'office', label: '写字楼', weight: 0.15 },
  { key: 'school', label: '学校', weight: 0.10 },
  { key: 'hospital', label: '医院', weight: 0.10 },
  { key: 'hotel', label: '酒店', weight: 0.05 },
  { key: 'bank', label: '银行', weight: 0.05 },
  { key: 'transit', label: '地铁/公交', weight: 0.05 }
]

// 各维度星级分档（500m 基准；radius 越大阈值按比例放大）
const envStarRule = (key, count, radius) => {
  const k = radius / 500
  const t = (n) => Math.max(1, Math.round(n * k))
  switch (key) {
    case 'mall': return count >= t(5) ? 5 : count >= t(3) ? 4 : count >= t(2) ? 3 : count >= t(1) ? 2 : 1
    case 'restaurant': return count >= t(30) ? 5 : count >= t(15) ? 4 : count >= t(5) ? 3 : count >= t(1) ? 2 : 1
    case 'office': return count >= t(10) ? 5 : count >= t(5) ? 4 : count >= t(2) ? 3 : count >= t(1) ? 2 : 1
    case 'school': return count >= t(5) ? 5 : count >= t(3) ? 4 : count >= t(2) ? 3 : count >= t(1) ? 2 : 1
    case 'hospital': return count >= t(2) ? 5 : count >= t(1) ? 4 : 1
    case 'hotel': return count >= t(5) ? 5 : count >= t(3) ? 4 : count >= t(1) ? 3 : 1
    case 'bank': return count >= t(5) ? 5 : count >= t(3) ? 4 : count >= t(1) ? 3 : 1
    case 'transit': return count >= t(2) ? 5 : count >= t(1) ? 4 : 1
    default: return 1
  }
}

// 开始周边商业配套：进入选点模式（十字光标）
const startEnvScore = () => {
  if (!map) { ElMessage.warning('地图未初始化'); return }
  // 清除旧图层
  if (envScoreLayer) {
    try { map.removeLayer(envScoreLayer) } catch(e) {}
    envScoreLayer = null
  }
  envScoreData.value = null
  envScorePoint.value = null
  envScorePickMode.value = true
  envScoreDialogVisible.value = false
  map.getContainer().style.cursor = 'crosshair'
  ElMessage.info('请在地图上点击要评估的位置')
}

// 取消选点模式（恢复光标，清理图层）
const cancelEnvScorePick = () => {
  envScorePickMode.value = false
  envScorePoint.value = null
  if (map) map.getContainer().style.cursor = ''
  if (envScoreLayer) {
    try { map.removeLayer(envScoreLayer) } catch(e) {}
    envScoreLayer = null
  }
}

// 关闭打分卡弹窗后清理地图上的位置图标与半径圆
const clearEnvScoreLayer = () => {
  if (envScoreLayer) {
    try { map.removeLayer(envScoreLayer) } catch(e) {}
    envScoreLayer = null
  }
  envScoreData.value = null
  envScorePoint.value = null
}

// 绘制地图图标 + 半径圆
const drawEnvScoreLayer = () => {
  if (!map || !envScorePoint.value) return
  if (envScoreLayer) {
    try { map.removeLayer(envScoreLayer) } catch(e) {}
    envScoreLayer = null
  }
  const { lat, lng } = envScorePoint.value
  const group = L.layerGroup().addTo(map)
  // 地图图标（红色定位点）
  const icon = L.divIcon({
    className: 'env-score-icon',
    html: '<div style="width:22px;height:22px;background:#409eff;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  })
  L.marker([lat, lng], { icon }).addTo(group)
  // 半径圆
  L.circle([lat, lng], {
    radius: envScoreRadius.value,
    color: '#409eff',
    weight: 1.5,
    fillColor: '#409eff',
    fillOpacity: 0.08,
    interactive: false
  }).addTo(group)
  envScoreLayer = group
}

// 获取打分数据
const fetchEnvScore = async () => {
  if (!envScorePoint.value) return
  drawEnvScoreLayer()  // 半径切换时同步重绘圆
  envScoreLoading.value = true
  envScoreDialogVisible.value = true
  try {
    const { data } = await axios.post('/api/poi/environment-score', {
      lng: envScorePoint.value.lng,
      lat: envScorePoint.value.lat,
      radius: envScoreRadius.value
    })
    if (data.success) {
      envScoreData.value = data
    } else {
      envScoreData.value = null
      ElMessage.error(data.error || '评估失败')
    }
  } catch (e) {
    envScoreData.value = null
    ElMessage.error('评估失败: ' + (e.response?.data?.error || e.message))
  } finally {
    envScoreLoading.value = false
  }
}

// 打分卡各项（含星级）
const envScoreItems = computed(() => {
  if (!envScoreData.value?.counts) return []
  return ENV_DIMENSIONS.map(d => ({
    key: d.key,
    label: d.label,
    count: envScoreData.value.counts[d.key] || 0,
    stars: envStarRule(d.key, envScoreData.value.counts[d.key] || 0, envScoreRadius.value)
  }))
})

// 综合分（星级×权重加权）
const envScoreTotal = computed(() => {
  const items = envScoreItems.value
  if (items.length === 0) return 0
  let sum = 0
  items.forEach(item => {
    const dim = ENV_DIMENSIONS.find(d => d.key === item.key)
    sum += item.stars * (dim?.weight || 0)
  })
  return sum
})

// 综合评语
const envScoreLevel = computed(() => {
  const s = envScoreTotal.value
  if (s >= 4.5) return '优秀 · 商业配套非常完善'
  if (s >= 3.5) return '良好 · 商业配套较完善'
  if (s >= 2.5) return '中等 · 商业配套一般'
  return '较差 · 商业配套不足'
})

// 开始半径圆搜索
const startCircleSearch = () => {
  if (circleSearchActive) {
    ElMessage.warning('搜索正在进行中，请稍候')
    return
  }
  if (!poiKeywords.value.trim()) {
    ElMessage.warning('请输入搜索关键词')
    return
  }
  
  // 清除之前的搜索结果（地图上的标记）
  poiResultVisible.value = false
  poiMarkers.value.forEach(m => map.removeLayer(m))
  poiMarkers.value = []
  if (poiCenterMarker) {
    map.removeLayer(poiCenterMarker)
    poiCenterMarker = null
  }
  if (poiRadiusCircle) {
    map.removeLayer(poiRadiusCircle)
    poiRadiusCircle = null
  }
  
  circleSearchActive = true
  
  // 关闭面板
  poiSearchExpanded.value = false
  
  // 提示用户点击地图
  ElMessage.info('请在地图上点击选择圆心位置')
  
  // 设置鼠标为十字光标
  const originalCursor = map.getContainer().style.cursor
  map.getContainer().style.cursor = 'crosshair'
  
  // 清除之前的临时标记
  if (tempCircleMarker) {
    map.removeLayer(tempCircleMarker)
    tempCircleMarker = null
  }
  
  // =============================================
  // 半径圆搜索功能 - 2026-04-04 FIX v3
  // =============================================
  // 监听地图点击
  map.once('click', async (e) => {
    // 恢复原始光标
    map.getContainer().style.cursor = originalCursor
    
    const { lat, lng } = e.latlng
    console.log('[Circle Search v3] 点击地图, 坐标:', lat, lng)
    
    // 临时标记圆心
    tempCircleMarker = L.circle([lat, lng], {
      radius: 50,
      color: '#f59e0b',
      fillColor: '#fbbf24',
      fillOpacity: 0.3,
      weight: 2
    }).addTo(map)
    
    // 弹出半径输入框
    let radiusKm = null
    try {
      const { value } = await ElMessageBox.prompt('请输入搜索半径（公里）', '设置半径', {
        confirmButtonText: '搜索',
        cancelButtonText: '取消',
        inputValue: '2',
        inputPattern: /^\d+(\.\d+)?$/,
        inputErrorMessage: '请输入有效的数字'
      })
      console.log('[Circle Search] ElMessageBox 确认, value:', value)
      radiusKm = parseFloat(value) || 2
    } catch (err) {
      console.log('[Circle Search] ElMessageBox 取消或错误:', err)
      radiusKm = null
    }
    
    // 清除临时标记
    if (tempCircleMarker) {
      map.removeLayer(tempCircleMarker)
      tempCircleMarker = null
    }
    
    if (radiusKm === null) {
      circleSearchActive = false
      return
    }
    
    const radiusM = Math.round(radiusKm * 1000)
    console.log('[Circle Search v2] 用户输入半径:', radiusKm, '公里 =', radiusM, '米')
    
    // 清除临时圆
    if (tempCircleMarker) {
      map.removeLayer(tempCircleMarker)
      tempCircleMarker = null
    }
    
    // 立即绘制正确的搜索范围圆（紫色虚线），使用全局变量
    if (poiRadiusCircle) {
      map.removeLayer(poiRadiusCircle)
    }
    poiRadiusCircle = L.circle([lat, lng], {
      radius: radiusM,
      color: '#6366f1',
      fillColor: '#6366f1',
      fillOpacity: 0.1,
      weight: 2,
      dashArray: '5, 5'
    }).addTo(map)
    console.log('[Circle Search] 已绘制搜索圆，半径:', radiusM, '米')
    
    // 执行周边搜索
    try {
      console.log('[Circle Search] 开始请求 API, 关键词:', poiKeywords.value.trim())
      const loadingMsg = ElMessage({ type: 'loading', message: '搜索中...', duration: 0 })
      const response = await fetch('/api/poi/around', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lng,
          lat,
          radius: radiusM,
          keywords: poiKeywords.value.trim()
        })
      })
      const result = await response.json()
      loadingMsg.close()
      
      if (result.error) {
        ElMessage.error(result.error)
        circleSearchActive = false
        return
      }
      
      poiResults.value = result.pois || []
      poiResultVisible.value = true
      // 显示结果，包含中心点和半径
      showPoiOnMap(result.pois, lat, lng, radiusM)
      ElMessage.success(`找到 ${result.pois ? result.pois.length : 0} 个结果`)
      circleSearchActive = false
    } catch (err) {
      loadingMsg.close()
      console.error('[Circle Search]', err)
      const errMsg = err.message || (typeof err === 'string' ? err : '请检查网络连接或稍后重试')
      ElMessage.error(`搜索失败：${errMsg}`)
      circleSearchActive = false
    }
  })
}

// 开始多边形搜索
const startPolygonSearch = () => {
  if (!poiKeywords.value.trim()) {
    ElMessage.warning('请输入搜索关键词')
    return
  }
  
  // 清除之前的搜索结果（地图上的标记）
  poiResultVisible.value = false
  poiMarkers.value.forEach(m => map.removeLayer(m))
  poiMarkers.value = []
  if (poiCenterMarker) {
    map.removeLayer(poiCenterMarker)
    poiCenterMarker = null
  }
  if (poiRadiusCircle) {
    map.removeLayer(poiRadiusCircle)
    poiRadiusCircle = null
  }
  
  // 关闭面板
  poiSearchExpanded.value = false
  
  // 清除之前的临时元素
  if (tempPolygonLayer) {
    map.removeLayer(tempPolygonLayer)
    tempPolygonLayer = null
  }
  if (tempPolygonMarker) {
    map.removeLayer(tempPolygonMarker)
    tempPolygonMarker = null
  }
  tempPolygonPoints = []
  
  // 提示用户
  ElMessage.info('请在地图上点击绘制多边形（至少3个点），完成后点击确定')
  
  // 创建临时多边形层
  tempPolygonLayer = L.polygon([], {
    color: '#10b981',
    fillColor: '#34d399',
    fillOpacity: 0.2,
    weight: 2,
    dashArray: '5, 5'
  }).addTo(map)
  
  // 点击已绘制的多边形可重新显示POI结果面板
  tempPolygonLayer.on('click', () => {
    poiResultVisible.value = true
  })
  
  // 设置十字光标
  map.getContainer().style.cursor = 'crosshair'
  
  // 临时标记点
  updateMarkers = () => {
    if (tempPolygonMarker) {
      map.removeLayer(tempPolygonMarker)
      tempPolygonMarker = null
    }
    if (tempPolygonPoints.length > 0) {
      const markers = tempPolygonPoints.map((p, i) => 
        L.circleMarker(p, { radius: 6, color: '#10b981', fillColor: '#fff', fillOpacity: 1 })
          .bindPopup(`点${i + 1}`)
      )
      tempPolygonMarker = L.layerGroup(markers).addTo(map)
    }
  }
  
  // 监听地图点击
  map.on('click', addPolygonPoint)
  
  // 显示完成按钮
  showPolygonCompleteButton()
}

let completeBtn = null
let completeBtnElement = null
const showPolygonCompleteButton = () => {
  console.log('[Polygon Search] 显示完成按钮')
  // 先移除旧的按钮
  if (completeBtn) {
    map.removeControl(completeBtn)
    completeBtn = null
  }
  if (completeBtnElement && completeBtnElement.parentNode) {
    completeBtnElement.parentNode.removeChild(completeBtnElement)
    completeBtnElement = null
  }
  
  // 创建按钮
  completeBtnElement = document.createElement('button')
  completeBtnElement.id = 'polygon-complete-btn'
  completeBtnElement.textContent = '完成绘制'
  completeBtnElement.style.cssText = `
    position: fixed !important;
    background: #10b981 !important;
    color: white !important;
    border: none !important;
    padding: 12px 24px !important;
    border-radius: 6px !important;
    cursor: pointer !important;
    font-size: 15px !important;
    font-weight: bold !important;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.5) !important;
    z-index: 999999 !important;
  `
  
  // 使用 addEventListener 确保点击有效
  completeBtnElement.addEventListener('click', (e) => {
    console.log('[Polygon Search] 按钮被点击')
    e.stopPropagation()
    e.preventDefault()
    finishPolygonSearch()
  })
  
  document.body.appendChild(completeBtnElement)
  
  // 计算多边形中心，动态定位按钮
  if (tempPolygonPoints.length >= 2) {
    // 计算多边形边界
    const bounds = L.latLngBounds(tempPolygonPoints)
    const center = bounds.getCenter()
    // 将地图中心坐标转换为屏幕像素位置
    const point = map.latLngToContainerPoint(center)
    // 按钮放在中心点偏上，避免遮挡多边形
    completeBtnElement.style.top = `${Math.max(80, point.y - 100)}px`
    completeBtnElement.style.left = `${Math.min(point.x - 50, window.innerWidth - 150)}px`
    completeBtnElement.style.right = 'auto'
  } else {
    // 默认位置
    completeBtnElement.style.top = '80px'
    completeBtnElement.style.right = '20px'
    completeBtnElement.style.left = 'auto'
  }
  
  console.log('[Polygon Search] 按钮已添加到body')
}

const finishPolygonSearch = async () => {
  // 移除点击监听
  map.off('click', addPolygonPoint)
  
  // 恢复光标
  map.getContainer().style.cursor = ''
  
  // 移除完成按钮
  if (completeBtn) {
    map.removeControl(completeBtn)
    completeBtn = null
  }
  if (completeBtnElement) {
    document.body.removeChild(completeBtnElement)
    completeBtnElement = null
  }
  
  if (tempPolygonPoints.length < 3) {
    ElMessage.warning('多边形至少需要3个点')
    // 清除临时元素
    if (tempPolygonLayer) { map.removeLayer(tempPolygonLayer); tempPolygonLayer = null }
    if (tempPolygonMarker) { map.removeLayer(tempPolygonMarker); tempPolygonMarker = null }
    tempPolygonPoints = []
    return
  }
  
  // 清除临时标记
  if (tempPolygonMarker) {
    map.removeLayer(tempPolygonMarker)
    tempPolygonMarker = null
  }
  
  // 构建多边形坐标数组（后端期望 [{lng, lat}, ...] 格式）
  const polygonCoords = tempPolygonPoints.map(p => ({ lng: p.lng, lat: p.lat }))
  
  // 执行多边形搜索
  let loadingMsg = null
  try {
    loadingMsg = ElMessage({ type: 'loading', message: '搜索中...', duration: 0 })
    const response = await fetch('/api/poi/polygon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: polygonCoords,
        keywords: poiKeywords.value.trim()
      })
    })
    const result = await response.json()
    loadingMsg.close()
    
    if (result.error) {
      ElMessage.error(result.error)
      return
    }
    
    poiResults.value = result.pois || []
    poiResultVisible.value = true
    // 多边形搜索不在地图上显示中心点和半径圆
    showPoiOnMap(result.pois, null, null, null)
    ElMessage.success(`找到 ${result.pois ? result.pois.length : 0} 个结果`)
  } catch (err) {
    if (loadingMsg) loadingMsg.close()
    console.error('[Polygon Search]', err)
    const errMsg = err.message || (typeof err === 'string' ? err : '请检查网络连接或稍后重试')
    ElMessage.error(`搜索失败：${errMsg}`)
  }
}

// 关闭POI结果面板（只隐藏面板，保留地图上的显示）
const closePoiResults = () => {
  poiResultVisible.value = false
}

// 清除POI搜索结果（清除地图上的所有显示）
const clearPoiSearch = () => {
  // 隐藏结果面板
  poiResultVisible.value = false
  poiResults.value = []
  
  // 清除地图上的POI标记
  poiMarkers.value.forEach(m => map.removeLayer(m))
  poiMarkers.value = []
  
  // 清除中心点标记和半径圆
  if (poiCenterMarker) {
    map.removeLayer(poiCenterMarker)
    poiCenterMarker = null
  }
  if (poiRadiusCircle) {
    map.removeLayer(poiRadiusCircle)
    poiRadiusCircle = null
  }
  
  // 清除多边形图层
  if (tempPolygonLayer) {
    map.removeLayer(tempPolygonLayer)
    tempPolygonLayer = null
  }
  if (tempPolygonMarker) {
    map.removeLayer(tempPolygonMarker)
    tempPolygonMarker = null
  }
  tempPolygonPoints = []
  
  poiCenterPoint = null
  poiSearchRadius = 2000
  
  // 重置搜索状态
  circleSearchActive = false
  polygonSearchActive = false
}

// 视野内搜索：将当前地图视口四角转为多边形，调 polygon API
const startViewportSearch = () => {
  if (!poiKeywords.value.trim()) {
    ElMessage.warning('请输入搜索关键词')
    return
  }
  if (!map) {
    ElMessage.warning('地图未加载')
    return
  }

  // 获取当前视口边界
  const bounds = map.getBounds()
  const sw = bounds.getSouthWest()
  const nw = { lat: bounds.getNorth(), lng: bounds.getWest() }
  const ne = bounds.getNorthEast()
  const se = { lat: bounds.getSouth(), lng: bounds.getEast() }

  // 构建多边形：西北→东北→东南→西南（高德要求逆时针或顺时针闭合）
  const coords = [nw, ne, se, sw]

  // 关闭面板
  poiSearchExpanded.value = false

  // 清除旧结果
  poiResultVisible.value = false
  poiResults.value = []
  poiMarkers.value.forEach(m => map.removeLayer(m))
  poiMarkers.value = []
  if (poiCenterMarker) { map.removeLayer(poiCenterMarker); poiCenterMarker = null }
  if (poiRadiusCircle) { map.removeLayer(poiRadiusCircle); poiRadiusCircle = null }
  if (tempPolygonLayer) { map.removeLayer(tempPolygonLayer); tempPolygonLayer = null }
  if (tempPolygonMarker) { map.removeLayer(tempPolygonMarker); tempPolygonMarker = null }
  tempPolygonPoints = []

  // 在视口边缘画个虚线框提示用户搜索范围
  const viewportLayer = L.polygon(coords, {
    color: '#6366f1', fillColor: '#6366f1', fillOpacity: 0.08, weight: 2, dashArray: '5, 5'
  }).addTo(map)
  viewportLayer.on('click', () => { poiResultVisible.value = true })
  tempPolygonLayer = viewportLayer

  // 执行搜索
  executeViewportSearch(coords)
}

const executeViewportSearch = async (coords) => {
  let loadingMsg = null
  try {
    loadingMsg = ElMessage({ type: 'loading', message: '视野内搜索中...', duration: 0 })
    const response = await fetch('/api/poi/polygon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: coords.map(p => ({ lng: p.lng, lat: p.lat })),
        keywords: poiKeywords.value.trim()
      })
    })
    const result = await response.json()
    loadingMsg.close()

    if (result.error) {
      ElMessage.error(result.error)
      return
    }

    poiResults.value = result.pois || []
    poiResultVisible.value = true
    showPoiOnMap(result.pois, null, null, null)
    ElMessage.success(`找到 ${result.pois ? result.pois.length : 0} 个结果`)
  } catch (err) {
    if (loadingMsg) loadingMsg.close()
    const errMsg = err.message || '请检查网络连接或稍后重试'
    ElMessage.error(`搜索失败：${errMsg}`)
  }
}

// POI位置选择模式：在地图上选点后执行搜索
const executePoiSearchAtLocation = async (lat, lng) => {
  const pending = poiPendingSearch.value
  if (!pending) return
  
  try {
    const response = await fetch('/api/poi/around', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lng,
        lat,
        radius: pending.radius || 2000,
        keywords: pending.keywords
      })
    })
    const result = await response.json()
    
    if (result.error) {
      ElMessage.error(result.error)
      return
    }
    
    poiResults.value = result.pois || []
    poiResultVisible.value = true
    showPoiOnMap(result.pois, lat, lng, pending.radius || 2000)
    ElMessage.success(`在指定位置周边找到 ${result.count} 个POI`)
  } catch (err) {
    console.error('[POI Search]', err)
    ElMessage.error('POI搜索失败')
  } finally {
    poiPendingSearch.value = null
    poiPickLocationMode.value = false
  }
}

// 取消POI位置选择模式
const cancelPoiPickLocation = () => {
  poiPickLocationMode.value = false
  poiPendingSearch.value = null
  if (map) map.getContainer().style.cursor = ''
}

// 保存点位
const saveMarker = async () => {
  const valid = await markerFormRef.value.validate().catch(() => false)
  if (!valid) return

  let result
  if (editingMarker.value) {
    result = await markerStore.updateMarker(editingMarker.value, { ...markerForm })
  } else {
    result = await markerStore.addMarker({ ...markerForm })
  }

  if (result.success) {
    ElMessage.success(editingMarker.value ? '更新成功' : '添加成功')
    removeAddMarkerPin()
    markerDialogVisible.value = false
    loadMarkers()
    resetMarkerForm()
  } else {
    ElMessage.error(result.message)
  }
}

// ===== 添加门店图钉预览 =====
let addMarkerPin = null  // 预览图钉 marker

const showAddMarkerPin = (lat, lng) => {
  // 清除旧的预览图钉
  removeAddMarkerPin()

  // SVG 图钉图标（红色）
  const pinSvg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <defs>
      <filter id="pshadow">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.35)"/>
      </filter>
    </defs>
    <path d="M16 2C9.37 2 4 7.37 4 14c0 9 12 24 12 24S28 23 28 14C28 7.37 22.63 2 16 2z"
      fill="#ff4444" stroke="#cc0000" stroke-width="1.5" filter="url(#pshadow)"/>
    <circle cx="16" cy="14" r="5" fill="white" opacity="0.9"/>
  </svg>`)

  const icon = L.divIcon({
    html: `<div class="add-marker-pin-wrapper"><img src="data:image/svg+xml,${pinSvg}" width="32" height="40" /></div>`,
    className: '',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
  })

  addMarkerPin = L.marker([lat, lng], { icon, zIndexOffset: 9999 }).addTo(map)
}

const removeAddMarkerPin = () => {
  if (addMarkerPin && map) {
    map.removeLayer(addMarkerPin)
    addMarkerPin = null
  }
}

// 对话框关闭（取消/×）时移除预览图钉
const onMarkerDialogClose = () => {
  if (!editingMarker.value) {
    removeAddMarkerPin()
  }
}

// 重置表单
const resetMarkerForm = () => {
  editingMarker.value = null
  Object.assign(markerForm, {
    store_code: '',
    brand: '',
    name: '',
    store_type: '',
    city: '',
    district: '',
    area_manager: '',
    phone1: '',
    store_manager: '',
    phone2: '',
    address: '',
    open_date: '',
    business_hours: '',
    area: null,
    seats: null,
    rent: null,
    store_category: '',
    store_status: '',
    mall_type: '',
    trade_area_type: '',
    contact_person: '',
    contact_phone: '',
    description: '',
    latitude: 0,
    longitude: 0,
    status: '正常'
  })
}

// 编辑门店
const editMarker = async (id) => {
  const marker = markerStore.markers.find(m => m.id === id)
  if (!marker) return

  editingMarker.value = id
  Object.assign(markerForm, {
    store_code: marker.store_code || '',
    brand: marker.brand || '',
    name: marker.name,
    store_type: marker.store_type || '',
    city: marker.city || '',
    district: marker.district || '',
    area_manager: marker.area_manager || '',
    phone1: marker.phone1 || '',
    store_manager: marker.store_manager || '',
    phone2: marker.phone2 || '',
    address: marker.address || '',
    open_date: marker.open_date || '',
    business_hours: marker.business_hours || '',
    area: marker.area || null,
    seats: marker.seats || null,
    rent: marker.rent || null,
    store_category: marker.store_category || '',
    store_status: marker.store_status || '',
    mall_type: marker.mall_type || '',
    trade_area_type: marker.trade_area_type || '',
    contact_person: marker.contact_person || '',
    contact_phone: marker.contact_phone || '',
    description: marker.description || '',
    latitude: marker.latitude,
    longitude: marker.longitude,
    status: marker.status || '正常'
  })
  markerDialogVisible.value = true
}

// 删除点位
const deleteMarker = async (id) => {
  const result = await markerStore.deleteMarker(id)
  if (result.success) {
    ElMessage.success('删除成功')
    loadMarkers()
  } else {
    ElMessage.error(result.message)
  }
}


// 人口对比相关
const populationCompareVisible = ref(false)
const compareStep = ref(1)
const compareSearchKeyword = ref('')
const compareRadius = ref(2)
const compareLoading = ref(false)
const compareResults = ref([])
const compareTableData = ref([])
const barChartRef = ref(null)
let barChart = null
// 直接存储选中的门店对象
const selectedCompareStoresState = reactive({ list: [] })
const selectedCompareStores = computed(() => selectedCompareStoresState.list)

// 调试 watch（开发时启用）
// watch(() => selectedCompareStoresState.list.length, (newLen, oldLen) => {
  // console.log('list length changed:', oldLen, '->', newLen)
// })

// 人口对比 - 筛选门店
const filteredCompareStores = computed(() => {
  const kw = compareSearchKeyword.value.toLowerCase()
  const selectedIds = new Set(selectedCompareStoresState.list.map(s => s.id))
  
  // 先把已选门店放进去
  const result = [...selectedCompareStoresState.list]
  
  // 再添加匹配的门店（去重）
  markerStore.markers.forEach(m => {
    if (!selectedIds.has(m.id)) {
      if (!kw || m.name?.toLowerCase().includes(kw) || m.brand?.toLowerCase().includes(kw)) {
        result.push(m)
      }
    }
  })
  
  return result
})

// 移除已选门店
const removeCompareStore = (store) => {
  selectedCompareStoresState.list = selectedCompareStoresState.list.filter(s => s.id !== store.id)
}

// 切换门店选择状态
const toggleCompareStore = (store) => {
  const idx = selectedCompareStoresState.list.findIndex(s => s.id === store.id)
  if (idx >= 0) {
    // 已选中，取消选择
    selectedCompareStoresState.list = selectedCompareStoresState.list.filter((_, i) => i !== idx)
  } else {
    // 未选中，添加到已选（最多5家）
    if (selectedCompareStoresState.list.length < 5) {
      selectedCompareStoresState.list = [...selectedCompareStoresState.list, { ...store }]
    }
  }
}

// 显示人口对比对话框
const showPopulationCompareDialog = () => {
  compareStep.value = 1
  compareSearchKeyword.value = ''
  compareRadius.value = 2
  selectedCompareStoresState.list = []
  compareResults.value = []
  compareTableData.value = []
  populationCompareVisible.value = true
}

// 打开人口对比对话框
const openPopulationCompare = () => {
  showPopulationCompareDialog()
}

// 开始人口对比分析
const startPopulationCompare = async () => {
  if (selectedCompareStoresState.list.length < 2) {
    ElMessage.warning('请至少选择2家门店')
    return
  }
  const storesToCompare = [...selectedCompareStoresState.list]

  compareLoading.value = true
  compareResults.value = []
  compareTableData.value = []

  try {
    // 获取所有shapefile
    const userId = localStorage.getItem('userId') || 1
    const listRes = await fetch(`/api/shapefiles?category=population`, {
      headers: { 'x-user-id': userId }
    })
    const listData = await listRes.json()
    const shapefiles = Array.isArray(listData) ? listData : (listData.data || [])

    if (shapefiles.length === 0) {
      ElMessage.warning('没有找到上传的数据文件，请先上传shp文件')
      compareLoading.value = false
      return
    }

    // 简化：从门店对象提取城市名
    const extractCityFromStore = (store) => {
      // 优先使用city字段
      if (store.city && store.city.trim()) {
        return store.city.trim()
      }
      // 尝试从name或其他字段提取城市
      const cityMatch = store.name?.match(/^([\u4e00-\u9fa5]+)/)
      if (cityMatch) return cityMatch[1]
      return null
    }

    // 根据城市选择对应的shapefile（优先精确匹配，其次模糊匹配）
    const findShapefileForCity = (city, allShapefiles) => {
      if (!city) return allShapefiles[0] // 没有城市信息时使用第一个

      // 从 shapefile 名称中提取城市名（"杭州1km网格人口.zip" → "杭州"）
      const shapefileCityMap = allShapefiles.map(sf => {
        const nameCity = sf.name?.replace(/1km网格人口.*$/i, '').trim()
        return { ...sf, _cityName: nameCity }
      })

      // 标准化门店城市名（去掉"市""省"后缀，如 "杭州市" → "杭州"）
      const normalizeCity = (c) => c.replace(/[市县区省]$/, '').trim()

      const normalizedStoreCity = normalizeCity(city)

      // 1. 精确匹配 shapefile 名称中的城市名
      let matched = shapefileCityMap.find(sf =>
        sf._cityName && normalizeCity(sf._cityName) === normalizedStoreCity
      )
      if (matched) return matched

      // 2. 模糊匹配：门店城市包含在shapefile城市中，或反过来
      matched = shapefileCityMap.find(sf =>
        sf._cityName && (sf._cityName.includes(city) || city.includes(sf._cityName))
      )
      if (matched) return matched

      // 3. 使用第一个（兜底）
      console.warn(`未找到城市[${city}]对应的shapefile，使用第一个: ${allShapefiles[0].name}`)
      return allShapefiles[0]
    }

    const radiusMeters = compareRadius.value * 1000

    // 并行处理各门店
    const storePromises = storesToCompare
      .filter(store => {
        if (!store.latitude || !store.longitude) {
          ElMessage.warning(`门店 "${store.name}" 缺少坐标信息`)
          return false
        }
        return true
      })
      .map(async (store) => {
        const lat = store.latitude
        const lng = store.longitude

        // 提取门店城市名
        const storeCity = extractCityFromStore(store)
        
        // 根据城市选择shapefile
        const targetShapefile = findShapefileForCity(storeCity, shapefiles)
        const sfId = targetShapefile.id
        
        // 从 shapefile 元数据中读取字段名（避免下载全量 GeoJSON，节省 6MB+）
        const fieldNames = targetShapefile.field_names || []
        // 选择第一个非 RecID 的字段作为统计字段
        const statField = fieldNames.find(f => f !== 'RecID' && f !== 'recid' && f !== 'FID') || fieldNames[0]
        
        if (!statField) {
          console.warn(`门店 "${store.name}" 未找到有效统计字段，跳过`)
          return null
        }
        
        console.log(`计算人口: 门店=${store.name}, 城市=${storeCity}, 使用shapefile=${targetShapefile.name}, 字段=${statField}`)
        
        // 调用后端计算API
        const response = await fetch('/api/shapefiles/calculate-population', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': userId
          },
          body: JSON.stringify({
            lat,
            lng,
            radius: radiusMeters,
            fieldName: statField,
            shapefileId: sfId // 传给后端过滤，只处理此shapefile
          })
        })
        
        if (!response.ok) {
          throw new Error(`后端计算API错误: ${response.status}`)
        }
        
        const apiResult = await response.json()
        const result = apiResult.data
        console.log(`  -> 结果: total=${result.total}, count=${result.count}`)
        return {
          ...store,
          city: storeCity,
          shapefileName: targetShapefile.name,
          total: result.total,
          statField,
          allFields: result.allFields
        }
      })

    const allResults = (await Promise.all(storePromises)).filter(r => r !== null)

    if (allResults.length < 2) {
      ElMessage.warning('有效门店数量不足，请检查门店坐标')
      compareLoading.value = false
      return
    }

    compareResults.value = allResults

    // 获取第一个结果使用的统计字段名（用于表格显示）
    const primaryStatField = allResults[0].statField

    // 构建对比表格数据（排除RecID字段）
    const excludeFields = ['RecID', 'recid', 'FID', 'fid', 'id', 'ID', 'OBJECTID', 'Shape_Area', 'Shape_Length']
    const fieldNames = [primaryStatField, ...Object.keys(allResults[0].allFields || {}).filter(k => 
      k !== primaryStatField && !excludeFields.includes(k)
    )]
    compareTableData.value = fieldNames.map(field => {
      const values = allResults.map(r => {
        if (field === r.statField) return formatNumber(r.total)
        return formatNumber(r.allFields?.[field] || 0)
      })

      const nums = allResults.map(r => {
        if (field === r.statField) return r.total
        return r.allFields?.[field] || 0
      })

      const maxVal = Math.max(...nums)
      const maxIndex = nums.indexOf(maxVal)
      // 差值：最高值显示为空，其他显示与最高值的差距
      const diffs = nums.map((v, i) => {
        if (i === maxIndex) return ''  // 最高值不显示差值
        return '-' + formatNumber(Math.abs(v - maxVal))
      })

      return {
        field,
        values,
        nums,
        maxIndex,
        diffs
      }
    })

    compareStep.value = 2

    // 仅2家门店时渲染柱状图
    if (allResults.length === 2) {
      await nextTick()
      renderBarChart()
    }

  } catch (e) {
    console.error('人口对比分析失败:', e)
    ElMessage.error('分析失败：' + e.message)
  } finally {
    compareLoading.value = false
  }
}


// 渲染柱状图（仅2家门店时使用）
const renderBarChart = () => {
  if (!barChartRef.value || compareResults.value.length !== 2) return

  if (barChart) {
    barChart.dispose()
  }

  barChart = echarts.init(barChartRef.value)

  const [r1, r2] = compareResults.value
  const uniqueFields = compareResults.value.flatMap(r => [r.statField, ...Object.keys(r.allFields || {})])
  const fields = [...new Set(uniqueFields)].filter(f => f !== 'RecID')

  const option = {
    title: {
      text: `${r1.name} vs ${r2.name}`,
      left: 'center',
      textStyle: { fontSize: 14, fontWeight: 'bold' }
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        let result = `<b>${params[0].axisValue}</b><br/>`
        params.forEach(p => {
          result += `${p.marker} ${p.seriesName}: <b>${formatNumber(p.value)}</b><br/>`
        })
        // 计算差值
        if (params.length === 2) {
          const diff = params[0].value - params[1].value
          const pct = params[1].value ? ((diff / params[1].value) * 100).toFixed(1) : '∞'
          const sign = diff >= 0 ? '+' : ''
          result += `<hr style="margin:4px 0;border:none;border-top:1px solid #eee;"/>`
          result += `<span style="color:#909399;font-size:12px;">差值: ${sign}${formatNumber(Math.abs(diff))}</span><br/>`
          result += `<span style="color:#909399;font-size:12px;">差异率: ${pct}%</span>`
        }
        return result
      }
    },
    legend: {
      data: [r1.name, r2.name],
      bottom: 0
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      top: '15%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: fields,
      axisLabel: { rotate: 15, fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (val) => {
          if (val >= 10000) return (val / 10000) + '万'
          return val
        }
      }
    },
    series: [
      {
        name: r1.name,
        type: 'bar',
        barGap: '5%',
        itemStyle: {
          color: '#409EFF',
          emphasis: { color: '#66b1ff' }
        },
        data: fields.map(f => f === r1.statField ? r1.total : (r1.allFields?.[f] || 0)),
        label: { show: true, position: 'top', formatter: (p) => formatNumber(p.value), fontSize: 10 },
        emphasis: { itemStyle: { color: '#66b1ff' } },
        markLine: {
          silent: true,
          lineStyle: { type: 'dashed', color: '#409EFF', width: 1.5 },
          data: [{ type: 'average', name: '平均值' }],
          label: { formatter: '均值: {c}', fontSize: 10, color: '#409EFF' }
        }
      },
      {
        name: r2.name,
        type: 'bar',
        barGap: '5%',
        itemStyle: {
          color: '#67C23A',
          emphasis: { color: '#85ce61' }
        },
        data: fields.map(f => f === r2.statField ? r2.total : (r2.allFields?.[f] || 0)),
        label: { show: true, position: 'top', formatter: (p) => formatNumber(p.value), fontSize: 10 },
        emphasis: { itemStyle: { color: '#85ce61' } },
        markLine: {
          silent: true,
          lineStyle: { type: 'dashed', color: '#67C23A', width: 1.5 },
          data: [{ type: 'average', name: '平均值' }],
          label: { formatter: '均值: {c}', fontSize: 10, color: '#67C23A' }
        }
      }
    ]
  }

  barChart.setOption(option)
}

// 导出对比图表为图片
const exportBarChart = () => {
  if (compareResults.value.length === 2) {
    const [r1, r2] = compareResults.value
    exportChartImage(barChart, `${r1.name}_vs_${r2.name}_对比`)
  } else {
    exportChartImage(barChart, '门店对比图表')
  }
}

// 窗口大小变化时重绘柱状图
const handleResize = () => {
  if (barChart) {
    barChart.resize()
  }
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
  // 注册键盘快捷键
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('keydown', handleKeyDown)
  if (onMapContextMenuRef) {
    document.removeEventListener('contextmenu', onMapContextMenuRef, true)
    onMapContextMenuRef = null
  }
})

// 暴露给window供弹窗调用
// 强制引用POI搜索函数，确保打包时不被移除
window.__poiSearchDebug = { startCircleSearch, startPolygonSearch, poiSearchExpanded, poiKeywords }

// 导出POI搜索函数供模板使用
const _poiFunctions = { startCircleSearch, startPolygonSearch }

onMounted(() => {
  // 测量结果标签上的 ❌：一键清除距离线段与测量结果
  window.clearMeasureResult = () => {
    clearDrawings()
    measurementResult.value = ''
    activeTool.value = ''
  }
  window.editMarkerExternal = editMarker
  window.deleteMarkerExternal = deleteMarker
  window.openStorePopulationDistribution = openStorePopulationDistribution
  window.openStoreSmartsteps = openStoreSmartsteps
  window.openStoreSimilarStores = openStoreSimilarStores
  window.openStoreCompetitors = openStoreCompetitors
  window.openStorePoiSearch = openStorePoiSearch
  window.storeHasPurchaseHistory = storeHasPurchaseHistory

  // 暴露Shapefile检索结果显示函数
  window.handleShapefileQueryFromGlobal = () => {
    if (window.shapefileQueryResult) {
      console.log('[Shapefile Query] 全局触发, map存在:', !!map)
      if (map) {
        handleShapefileQuery({ detail: window.shapefileQueryResult })
        delete window.shapefileQueryResult
        return true
      } else {
        console.log('[Shapefile Query] 地图未就绪，等待...')
        return false
      }
    }
    return false
  }

  // 等待DOM渲染完成后初始化地图
  nextTick(async () => {
    // 确保 initMap 完成（使用 await）
    await initMap()
    mapLoading.value = false  // 地图加载完成

    console.log('[MapView] 地图初始化完成')

    // 检查是否有门店跳转参数
    const { lat, lng, id, type } = route.query

    // 延迟处理，等待点位数据加载
    setTimeout(() => {
      if (!map) {
        console.error('[MapView] 地图未初始化')
        return
      }
      
      if (lat && lng) {
        // 跳转到指定位置
        try {
          map.setView([parseFloat(lat), parseFloat(lng)], 16)
          ElMessage.success('已跳转到门店位置')

          // 如果是品牌门店，打开 popup
          if (type === 'brandStore' && id && brandMarkerMap[id]) {
            brandMarkerMap[id].openPopup()
          }
        } catch (e) {
          console.error('[MapView] 跳转位置失败:', e)
        }
      }

      // 检查是否有Shapefile检索结果需要显示
      // 只有在地图完全准备好后才处理
      if (window.shapefileQueryResult && map) {
        console.log('[MapView] 检测到Shapefile检索结果，开始处理')
        try {
          handleShapefileQuery({ detail: window.shapefileQueryResult })
        } catch (e) {
          console.error('[MapView] 处理Shapefile结果失败:', e)
          ElMessage.error('显示检索结果失败')
        }
        // 清除全局变量避免重复显示
        delete window.shapefileQueryResult
      }
      
      // 从城市数据页跳转，自动显示城市行政边界及统计数据
      var cityToShow = sessionStorage.getItem('cityData_target')
      if (cityToShow) {
        sessionStorage.removeItem('cityData_target')
        window._pendingCityStats = cityToShow
        // 用已有的按行政界查询功能
        districtKeyword.value = cityToShow
        searchDistrict()
      }
    }, 500)  // 减少等待时间，因为 initMap 已经 await 了
  })
})

onUnmounted(() => {
  // 清理地图资源
  if (map) map.remove()
  
  // 清理 ECharts 实例
  if (barChart) {
    barChart.dispose()
    barChart = null
  }
  
  // 清理所有定时器
  clearAllTimers()
  
  // 清理所有 AbortController
  cleanupResources.abortControllers.forEach(controller => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  })
  cleanupResources.abortControllers.clear()
  
  // 清理拖拽事件监听器
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.removeEventListener('mousemove', onLegendDragMove)
  document.removeEventListener('mouseup', onLegendDragEnd)
  
  // 清理动态创建的 DOM 元素事件监听器
  if (completeBtnClickHandler && completeBtnElement) {
    completeBtnElement.removeEventListener('click', completeBtnClickHandler)
  }
  
  // 清理全局变量
  delete window.editMarkerExternal
  delete window.deleteMarkerExternal
  delete window.openStorePopulationDistribution
  delete window.openStoreSmartsteps
  delete window.openStoreSimilarStores
  delete window.openStoreCompetitors
  delete window.openStorePoiSearch
  delete window.handleShapefileQueryFromGlobal
  delete window.__poiSearchDebug
  
  shapefileProcessing = false
  
  // 清理存储的临时数据
  sessionStorage.removeItem('cityData_target')
})

// 热力图单元格样式（常住人口对比使用）
function getHeatmapCellStyle(nums, idx) {
  if (!nums || nums.length === 0) return { background: '#f5f5f5', color: '#333' }
  const validNums = nums.map(n => Math.abs(Number(n) || 0))
  const maxVal = Math.max(...validNums)
  const minVal = Math.min(...validNums)
  const range = maxVal - minVal
  if (range === 0) return { background: '#e0e0e0', color: '#333' }
  const normalized = (validNums[idx] - minVal) / range
  const r = Math.round(43 + (215 - 43) * normalized)
  const g = Math.round(131 + (25 - 131) * normalized)
  const b = Math.round(246 + (28 - 246) * normalized)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return { background: `rgb(${r}, ${g}, ${b})`, color: brightness > 150 ? '#333' : '#fff' }
}
</script>

<style lang="scss" scoped>
// 全局面板展开/收起过渡
:global(.panel-slide-enter-active),
:global(.panel-slide-leave-active) {
  transition: opacity 0.2s ease, max-height 0.25s ease;
  max-height: 400px;
  overflow: hidden;
}
:global(.panel-slide-enter-from),
:global(.panel-slide-leave-to) {
  opacity: 0;
  max-height: 0;
}

// 地图加载骨架屏
.map-loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #f0f2f5;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.map-loading-content {
  text-align: center;
}

.map-loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e0e0e0;
  border-top-color: #409eff;
  border-radius: 50%;
  animation: map-loading-spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes map-loading-spin {
  to { transform: rotate(360deg); }
}

.map-loading-text {
  font-size: 14px;
  color: #909399;
  margin-bottom: 20px;
}

.map-loading-skeleton {
  width: 240px;
  margin: 0 auto;
}

.skeleton-bar {
  height: 12px;
  background: linear-gradient(90deg, #e8e8e8 25%, #f5f5f5 50%, #e8e8e8 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: 4px;
  margin-bottom: 10px;
}

.skeleton-bar-1 { width: 80%; }
.skeleton-bar-2 { width: 60%; }
.skeleton-bar-3 { width: 70%; }

@keyframes skeleton-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.map-view {
  width: 100%;
  height: 100%;
  position: relative;
}

// 圆形内门店分析
.analysis-empty {
  padding: 20px 0;
}

.analysis-content {
  .analysis-section {
    margin-bottom: 16px;

    &:last-child {
      margin-bottom: 0;
    }

    .analysis-section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      color: #409eff;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #eee;
    }
  }
}

// 图标样式选择器
.marker-style-selector {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  
  .style-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 4px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    border: 1px solid #eee;
    
    &:hover {
      background: #f5f7fa;
      border-color: #409eff;
    }
    
    &.active {
      background: #ecf5ff;
      border-color: #409eff;
      color: #409eff;
    }
    
    .style-icon {
      font-size: 20px;
      margin-bottom: 4px;
    }
    
    span:last-child {
      font-size: 12px;
    }
  }
}

// SVG 图标容器样式
:deep(.custom-svg-marker) {
  background: transparent !important;
  border: none !important;
}

.custom-marker-svg {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
  transition: transform 0.2s;
  
  &:hover {
    transform: scale(1.1);
  }
}

.map-container {
  width: 100%;
  height: 100%;
}

.coordinate-display {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: rgba(255, 255, 255, 0.9);
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  color: #666;
  z-index: 1000;
  display: flex;
  align-items: center;

  .city-name {
    color: #409eff;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

.layer-switcher {
  position: absolute;
  bottom: 10px;
  right: 10px;
  background: white;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;

  .layer-switcher-title {
    padding: 6px 10px;
    font-size: 12px;
    color: #666;
    border-bottom: 1px solid #eee;
  }

  .layer-options {
    display: flex;
    padding: 6px;

    .layer-option {
      width: 52px;
      height: 52px;
      margin-right: 6px;
      border-radius: 4px;
      overflow: hidden;
      cursor: pointer;
      border: 2px solid transparent;
      position: relative;

      &:last-child {
        margin-right: 0;
      }

      &:hover {
        border-color: #409eff;
      }

      &.active {
        border-color: #409eff;
      }

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      span {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.5);
        color: white;
        font-size: 10px;
        text-align: center;
        padding: 2px 0;
      }
    }
  }
}

// 周边检索面板样式
// 商圈工具面板样式
// 智慧足迹浮动按钮样式 - 绝对定位右上角（商圈工具左侧）
.smartsteps-float-btn {
  position: absolute;
  top: 10px;
  right: 560px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 10px 16px;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
  cursor: pointer;
  z-index: 1002;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s;
  border: 2px solid transparent;
  min-width: 110px;
  justify-content: center;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
  }

  &.active {
    background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
    border-color: #fff;
    box-shadow: 0 6px 20px rgba(118, 75, 162, 0.5);
  }

  .smartsteps-btn-icon {
    font-size: 18px;
  }

  .smartsteps-btn-text {
    font-size: 13px;
    font-weight: 600;
  }
}

// 显示门店开关 - 样式参考地图工具箱
// 自定义缩放控件 - 在图层控制上方
.zoom-control-container {
  position: absolute;
  bottom: 110px;
  right: 10px;
  background: white;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  z-index: 1001;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  .zoom-in,
  .zoom-out {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 18px;
    color: #333;
    font-weight: bold;
    background: white;
    transition: background 0.2s;

    &:hover {
      background: #f5f5f5;
    }
  }

  .zoom-line {
    width: 32px;
    height: 1px;
    background: #eee;
  }
}

:deep(.custom-div-icon) {
  background: transparent;
  border: none;
}

// Shapefile 检索结果数值标签
:global(.shapefile-query-label) {
  background: transparent !important;
  border: none !important;
}

// 地图瓦片灰度效果（只针对高德地图，保留marker图标）
:deep(.gaode-gray-tiles) {
  img {
    filter: grayscale(100%) brightness(1.05);
  }
}

/* 门店检索浮层 */
.store-search-panel {
  position: absolute;
  width: 360px;
  max-height: 520px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  z-index: 1200;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.store-search-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  :deep(.el-tabs__header) {
    margin: 0;
    padding: 0 12px;
  }

  :deep(.el-tabs__content) {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;

    .el-tab-pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
  }

  .store-search-filters {
    padding: 4px 12px 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    border-bottom: 1px solid #f0f0f0;
  }

  .store-search-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 8px;
  }
}

.store-search-header {
  display: flex;
  align-items: center;
  padding: 12px 14px 10px;
  border-bottom: 1px solid #eee;
  gap: 6px;
  cursor: grab;
  user-select: none;
}

.store-search-title {
  flex: 1;
  font-weight: 600;
  font-size: 14px;
  color: #333;
  display: flex;
  align-items: center;
  gap: 5px;
}

.store-search-input-wrap {
  padding: 10px 12px 4px;
}

.store-search-filters {
  padding: 4px 12px 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border-bottom: 1px solid #f0f0f0;
}

.store-search-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.store-search-empty {
  text-align: center;
  color: #999;
  font-size: 13px;
  padding: 24px 0;
}

.store-search-item {
  padding: 10px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  border-bottom: 1px solid #f5f5f5;
}

.store-search-item:last-child {
  border-bottom: none;
}

.store-search-item:hover {
  background: #f0f7ff;
}

.store-search-name {
  font-weight: 500;
  font-size: 13px;
  color: #222;
  margin-bottom: 3px;
}

.store-search-sub {
  font-size: 12px;
  color: #888;
  display: flex;
  gap: 6px;
}

.store-search-sub span::after {
  content: '·';
  margin-left: 6px;
  color: #ccc;
}

.store-search-sub span:last-child::after {
  content: '';
}

.store-search-addr {
  font-size: 11px;
  color: #aaa;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 添加门店图钉预览动画 */
.add-marker-pin-wrapper {
  animation: pin-drop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform-origin: bottom center;
  display: block;
}

@keyframes pin-drop {
  0%   { transform: translateY(-28px) scale(0.7); opacity: 0.4; }
  60%  { transform: translateY(4px) scale(1.05); opacity: 1; }
  80%  { transform: translateY(-3px) scale(0.97); }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
</style>

// POI位置选择提示
.poi-pick-location-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1002;
  pointer-events: none;
}

.poi-pick-location-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(64, 158, 255, 0.95);
  color: white;
  border-radius: 8px;
  font-size: 14px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  pointer-events: auto;

  .el-icon {
    font-size: 18px;
    animation: poi-pulse 1.5s ease-in-out infinite;
  }

  span {
    flex: 1;
  }

  .el-button {
    color: white;
    padding: 2px 8px;

    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  }
}

@keyframes poi-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.1); }
}

/* 查询行政界 - 结果信息 */
.district-info {
  padding: 10px 12px;
}
.district-info-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  margin-bottom: 6px;
}
.district-level-tag {
  font-size: 11px;
  color: #fff;
  background: #e74c3c;
  padding: 1px 6px;
  border-radius: 3px;
  margin-left: auto;
}
.district-info-meta {
  font-size: 12px;
  color: #888;
  line-height: 1.6;
  padding-left: 22px;
}
.district-actions-row {
  display: flex;
  gap: 8px;
  padding: 0 12px 10px;
}
.district-store-counts {
  padding: 6px 12px 10px;
  border-top: 1px solid #f0f0f0;
}
.district-count-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}
.district-count-label {
  color: #666;
}
.district-count-num {
  font-weight: 600;
  color: #409eff;
}
.district-count-sub {
  font-size: 12px;
  padding: 2px 0;
}
.district-count-sub .district-count-num {
  color: #666;
}
.district-error {
  padding: 10px 12px;
  color: #dc2626;
  font-size: 13px;
}

/* 商圈查询样式 */
.commerce-match-count {
  font-size: 12px;
  color: #909399;
  margin-left: 8px;
  font-weight: normal;
}
.commerce-list {
  margin-top: 8px;
  max-height: 300px;
  overflow-y: auto;
}
.commerce-item {
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 13px;
}
.commerce-item:last-child {
  border-bottom: none;
}
.commerce-item-name {
  font-weight: 500;
  color: #303133;
}
.commerce-item-source {
  color: #909399;
  font-size: 12px;
  margin-top: 2px;
}

/* 门店商圈图例 - 自定义可拖拽面板（参照 store-search-panel 模式） */
.store-circle-legend-panel {
  position: absolute;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  z-index: 10000;
  min-width: 150px;
  pointer-events: auto;
}
.store-circle-legend-panel .legend-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px 4px;
  font-size: 13px;
  font-weight: 600;
  color: #333;
  cursor: move;
  user-select: none;
}
.store-circle-legend-panel .legend-panel-body {
  padding: 4px 10px 10px;
}
.store-circle-legend-panel .legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}
.store-circle-legend-panel .legend-color {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid rgba(0,0,0,0.1);
}
.store-circle-legend-panel .legend-label {
  color: #555;
  font-size: 12px;
  line-height: 1.6;
}

