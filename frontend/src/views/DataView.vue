<template>
  <div class="data-view">
    <div class="data-header">
      <h2>门店管理</h2>
      <div class="header-actions">
        <el-button type="warning" @click="showStoreSimilarDialog">
          <el-icon><Aim /></el-icon>相似店
        </el-button>
        <el-button type="warning" @click="showStoreRankingDialog">
          <el-icon><TrendCharts /></el-icon>门店排名
        </el-button>
        <el-button type="success" @click="showStoreCompareDialog">
          <el-icon><DataAnalysis /></el-icon>门店对比
        </el-button>
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>添加门店
        </el-button>
        <el-dropdown @command="handleImportMenuCommand">
          <el-button>
            <el-icon><Upload /></el-icon>导入门店
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="import"><el-icon><Upload /></el-icon>导入</el-dropdown-item>
              <el-dropdown-item command="geocode"><el-icon><MapLocation /></el-icon>地址解析</el-dropdown-item>
              <el-dropdown-item command="export"><el-icon><Download /></el-icon>导出</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button
          v-if="selectedRows.length > 0"
          type="danger"
          @click="handleBatchDelete"
        >
          <el-icon><Delete /></el-icon>批量删除({{ selectedRows.length }})
        </el-button>
        <el-button
          v-if="selectedRows.length > 0"
          type="primary"
          @click="showBatchSmartstepsDialog = true"
        >
          <el-icon><DataAnalysis /></el-icon>批量购买({{ selectedRows.length }})
        </el-button>
        <el-button type="danger" plain @click="handleClearAll">
          <el-icon><Delete /></el-icon>全清除
        </el-button>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索门店名称/地址"
        style="width: 200px"
        clearable
        @input="handleSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>

      <el-select v-model="filterStoreType" placeholder="按门店类型" style="width: 120px" clearable @change="handleSearch">
        <el-option label="已开业" value="已开业" />
        <el-option label="重点候选" value="重点候选" />
        <el-option label="一般候选" value="一般候选" />
      </el-select>

      <el-select v-model="filterCity" placeholder="按城市" style="width: 120px" clearable @change="handleSearch">
        <el-option v-for="city in cityList" :key="city" :label="city" :value="city" />
      </el-select>

      <el-select v-model="filterDistrict" placeholder="按区县" style="width: 120px" clearable @change="handleSearch">
        <el-option v-for="d in districtList" :key="d" :label="d" :value="d" />
      </el-select>

      <el-select v-model="filterStoreCategory" placeholder="按门店区分" style="width: 130px" clearable @change="handleSearch">
        <el-option v-for="c in categoryList" :key="c" :label="c" :value="c" />
      </el-select>

      <el-select v-model="filterBrand" placeholder="按品牌" style="width: 130px" clearable @change="handleSearch">
        <el-option v-for="b in brandList" :key="b" :label="b" :value="b" />
      </el-select>

      <el-select v-model="filterStoreStatus" placeholder="按门店状态" style="width: 190px" multiple collapse-tags collapse-tags-tooltip clearable @change="handleSearch">
        <el-option v-for="s in storeStatusList" :key="s" :label="s" :value="s" />
      </el-select>

      <el-select v-model="filterMallType" placeholder="按商场类型" style="width: 130px" clearable @change="handleSearch">
        <el-option v-for="m in mallTypeList" :key="m" :label="m" :value="m" />
      </el-select>

      <span class="统计">共 {{ filteredMarkers.length }} 条数据</span>
      <el-button v-if="hasActiveFilters" type="warning" plain @click="handleClearFilters">
        <el-icon><Close /></el-icon>清除筛选
      </el-button>
    </div>

    <!-- 数据表格 -->
    <div class="data-table">
      <el-table
        ref="tableRef"
        :data="paginatedMarkers"
        v-loading="markerStore.loading"
        border
        stripe
        row-key="id"
        style="width: 100%"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="45" reserve-selection />
        <el-table-column prop="store_code" label="编号" width="90" />
        <el-table-column prop="brand" label="品牌" width="100" />
        <el-table-column prop="name" label="门店名称" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.name }}
            <template v-if="getStoreStars(row.name) > 0">
              <span class="store-stars">{{ '⭐'.repeat(getStoreStars(row.name)) }}</span>
            </template>
          </template>
        </el-table-column>
        <el-table-column prop="store_type" label="类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="getStoreTypeTag(row.store_type)">{{ row.store_type || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="city" label="城市" width="90" />
        <el-table-column prop="district" label="区县" width="90" />
        <el-table-column prop="store_status" label="门店状态" width="90" align="center">
          <template #default="{ row }">{{ row.store_status || '-' }}</template>
        </el-table-column>
        <el-table-column prop="store_area" label="面积" width="80" align="right">
          <template #default="{ row }">{{ row.store_area ? row.store_area + '㎡' : '-' }}</template>
        </el-table-column>
        <el-table-column prop="seats" label="座位" width="70" align="right">
          <template #default="{ row }">{{ row.seats || '-' }}</template>
        </el-table-column>
        <el-table-column prop="mall_type" label="商场类型" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.mall_type || '-' }}</template>
        </el-table-column>
        <el-table-column prop="trade_area_type" label="商圈类型" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.trade_area_type || '-' }}</template>
        </el-table-column>
        <el-table-column prop="store_category" label="门店区分" width="100" align="center">
          <template #default="{ row }">{{ row.store_category || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleEdit(row)">
              <el-icon><Edit /></el-icon>
            </el-button>
            <el-button type="success" link @click="handleLocate(row)">
              <el-icon><Location /></el-icon>
            </el-button>
            <el-button type="warning" link @click="handleViewPurchase(row)">
              📋
            </el-button>
            <el-button type="danger" link @click="handleDelete(row)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 分页 -->
    <div class="pagination-container">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="filteredMarkers.length"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
      />
    </div>

    <!-- 添加/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑门店' : '添加门店'"
      width="700px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="门店编号" prop="store_code">
              <el-input v-model="form.store_code" placeholder="如: BJ001" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="品牌" prop="brand">
              <el-input v-model="form.brand" placeholder="品牌名称" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="门店名称" prop="name">
              <el-input v-model="form.name" placeholder="门店名称" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="门店类型" prop="store_type">
              <el-select v-model="form.store_type" placeholder="请选择" style="width: 100%">
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
              <el-input v-model="form.city" placeholder="如: 北京市" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="区县" prop="district">
              <el-input v-model="form.district" placeholder="如: 朝阳区" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="地址" prop="address">
          <el-input v-model="form.address" placeholder="详细地址" />
        </el-form-item>

        <el-divider content-position="left">经营信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="开店日期" prop="open_date">
              <el-input v-model="form.open_date" placeholder="如: 2024-01-01" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="营业时间" prop="business_hours">
              <el-input v-model="form.business_hours" placeholder="如: 08:00-22:00" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="面积(㎡)" prop="store_area">
              <el-input-number v-model="form.store_area" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="座位数" prop="seats">
              <el-input-number v-model="form.seats" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="门幅面积" prop="frontage">
              <el-input-number v-model="form.frontage" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="门店区分" prop="store_category">
              <el-select v-model="form.store_category" placeholder="请选择" style="width: 100%">
                <el-option v-for="c in markerStore.storeCategories" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="门店状态" prop="store_status">
              <el-input v-model="form.store_status" placeholder="门店状态" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="商场类型" prop="mall_type">
              <el-input v-model="form.mall_type" placeholder="商场类型" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="商圈类型" prop="trade_area_type">
              <el-input v-model="form.trade_area_type" placeholder="商圈类型" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="经度" prop="longitude">
              <el-input-number v-model="form.longitude" :precision="6" :step="0.001" :min="-180" :max="180" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="纬度" prop="latitude">
              <el-input-number v-model="form.latitude" :precision="6" :step="0.001" :min="-90" :max="90" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="备注" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="备注信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>

    <!-- 导入对话框 -->
    <el-dialog v-model="importDialogVisible" title="导入门店数据" width="500px">
      <div class="import-tips">
        <p>请上传CSV格式文件，支持以下字段：</p>
        <ul>
          <li>store_code - 门店编号</li>
          <li>brand - 品牌</li>
          <li>name - 门店名称（必填）</li>
          <li>store_type - 门店类型（已开业/重点候选/一般候选）</li>
          <li>city - 城市</li>
          <li>district - 区县</li>
          <li>address - 地址</li>
          <li>open_date - 开店日期</li>
          <li>business_hours - 营业时间</li>
          <li>store_area - 门店面积</li>
          <li>seats - 座位数</li>
          <li>frontage - 门幅面积</li>
          <li>store_category - 门店区分</li>
          <li>store_status - 门店状态（正常/闭店/停业）</li>
          <li>mall_type - 商场类型</li>
          <li>trade_area_type - 商圈类型</li>
          <li>latitude - 纬度（必填）</li>
          <li>longitude - 经度（必填）</li>
        </ul>
        <el-link type="primary" @click="downloadTemplate">下载模板</el-link>
      </div>
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        :limit="1"
        accept=".csv"
        :on-change="handleFileChange"
        drag
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
      </el-upload>
      <el-progress v-if="importing" :percentage="importProgress" :stroke-width="16" style="margin: 16px 0" :status="importProgress >= 100 ? 'success' : undefined" />
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="handleImportConfirm">确定导入</el-button>
      </template>
    </el-dialog>

    <!-- 地址解析对话框 -->
    <el-dialog v-model="geocodeDialogVisible" title="地址解析" width="900px" draggable>
      <!-- 步骤1：上传CSV -->
      <div v-if="geocodeStep === 1">
        <el-alert type="info" :closable="false" style="margin-bottom: 16px">
          <template #title>
            请上传含地址信息的 CSV 文件，每行一条记录，支持字段：
            <b>name（门店名称）</b>、<b>address（地址）</b>、city（城市）、district（区县）
          </template>
        </el-alert>
        <el-upload
          ref="geocodeUploadRef"
          :auto-upload="false"
          :limit="1"
          accept=".csv"
          :on-change="handleGeocodeFileChange"
          drag
        >
          <el-icon class="el-icon--upload"><Upload /></el-icon>
          <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
          <template #tip>
            <div class="el-upload__tip">
              CSV 文件需包含 <b>name</b> 和 <b>address</b> 列，其他列将原样保留
            </div>
          </template>
        </el-upload>
      </div>

      <!-- 步骤2：预览解析结果 -->
      <div v-if="geocodeStep === 2">
        <el-alert type="success" :closable="false" style="margin-bottom: 12px">
          共 {{ geocodeResults.length }} 条记录，解析成功 <b>{{ geocodeSuccessCount }}</b> 条，失败 <b>{{ geocodeResults.length - geocodeSuccessCount }}</b> 条
        </el-alert>
        <el-table :data="geocodeResults" max-height="350" border stripe size="small">
          <el-table-column prop="name" label="门店名称" min-width="120" show-overflow-tooltip />
          <el-table-column prop="address" label="原始地址" min-width="180" show-overflow-tooltip />
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.success" type="success" size="small">✓ 成功</el-tag>
              <el-tooltip v-else :content="row.error" placement="top">
                <el-tag type="danger" size="small">✗ 失败</el-tag>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="解析结果" min-width="200">
            <template #default="{ row }">
              <span v-if="row.success" style="color: #67c23a">
                {{ row.formatted_address || '' }}<br>
                <span style="font-size: 12px; color: #999">
                  坐标: {{ row.longitude?.toFixed(6) }}, {{ row.latitude?.toFixed(6) }}
                </span>
              </span>
              <span v-else style="color: #f56c6c; font-size: 12px">{{ row.error }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <template #footer>
        <el-button v-if="geocodeStep === 1" @click="geocodeDialogVisible = false">取消</el-button>
        <el-button v-if="geocodeStep === 1" type="primary" :disabled="!geocodeCsvFile" :loading="geocodeParsing" @click="handleParseGeocode">
          解析地址
        </el-button>
        <template v-if="geocodeStep === 2">
          <el-button @click="handleGeocodeExport">导出CSV</el-button>
          <el-button type="success" :loading="geocodeImporting" @click="handleGeocodeImport">
            导入到门店库
          </el-button>
        </template>
      </template>
    </el-dialog>

    <!-- 门店对比对话框 -->
    <el-dialog v-model="storeCompareVisible" :title="'半径' + storeCompareRadius + '公里门店对比'" width="900px" draggable :show-close="true" @close="storeCompareVisible = false">
      <template v-if="storeCompareStep === 1">
        <div style="margin-bottom: 15px; display: flex; align-items: center; gap: 15px;">
          <span style="font-size: 13px; color: #666;">分析半径：</span>
          <el-input-number v-model="storeCompareRadius" :min="0.5" :max="10" :step="0.5" size="small" />
          <span style="font-size: 12px; color: #999;">公里</span>
          <span style="font-size: 12px; color: #999; margin-left: 5px;">（用于计算圆内门店与竞品数量）</span>
        </div>
        <div style="margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
          <el-input v-model="storeCompareKeyword" placeholder="输入门店名称搜索" style="width: 300px;" clearable>
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <span style="font-size: 12px; color: #999;">请选择 2-5 家门店进行对比</span>
        </div>
        <div v-show="storeCompareSelected.length > 0" style="margin-bottom: 12px;">
          <div style="font-size: 12px; color: #666; margin-bottom: 6px;">已选择 ({{ storeCompareSelected.length }}/5)：</div>
          <el-tag v-for="store in storeCompareSelected" :key="store.id" closable @close="removeStoreCompare(store)" style="margin-right: 8px; margin-bottom: 4px;">
            {{ store.name }}
          </el-tag>
        </div>
        <div style="max-height: 300px; overflow-y: auto; border: 1px solid #ebeef5; border-radius: 4px;">
          <div v-for="store in storeCompareFiltered" :key="store.id"
            style="display: flex; align-items: center; padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0;"
            :style="{ background: storeCompareSelected.some(s => s.id === store.id) ? '#ecf5ff' : 'white' }"
            @click="toggleStoreCompare(store)">
            <el-button :type="storeCompareSelected.some(s => s.id === store.id) ? 'primary' : 'default'" size="small" style="margin-right: 12px;" @click.stop="toggleStoreCompare(store)">
              {{ storeCompareSelected.some(s => s.id === store.id) ? '已选' : '选择' }}
            </el-button>
            <div>
              <div style="font-size: 14px; font-weight: 500;">{{ store.name }}</div>
              <div style="font-size: 12px; color: #999;">
                {{ store.brand || '-' }} | {{ store.city || '-' }}{{ store.district ? ' ' + store.district : '' }}
              </div>
            </div>
          </div>
        </div>
        <div style="margin-top: 8px; font-size: 12px; color: #999;">共 {{ storeCompareFiltered.length }} 家门店</div>
      </template>

      <template v-if="storeCompareStep === 2">
        <div style="max-height: 550px; overflow-y: auto;">
          <div v-if="storeCompareResults.length === 0" style="text-align:center;padding:40px;color:#999;">
            暂无对比数据
          </div>
          <el-table v-else :data="storeCompareTableData" border stripe size="small" max-height="450" :header-cell-style="{ fontWeight: 'bold', color: '#333', background: '#fdf6ec', fontSize: '14px' }">
            <el-table-column label="指标" width="140" align="right">
              <template #default="{ row }">
                <span style="font-weight: bold; font-size: 14px;">{{ row.field }}</span>
              </template>
            </el-table-column>
            <el-table-column v-for="(r, idx) in storeCompareResults" :key="r.id" :label="r.name" align="right">
              <template #default="{ row }">
                <span v-if="!r.exactRadiusMatch && row.field !== '圆内门店数' && row.field !== '圆内竞品数'" style="color: #f56c6c; font-size: 12px;">未购买</span>
                <span v-else-if="row.values[idx] === '—'" style="color: #ccc;">—</span>
                <span v-else :style="{ color: getCompareCellStyle(row.nums, idx), fontWeight: 'bold', fontSize: '14px' }">
                  {{ row.values[idx] }}<span v-if="isTwoStoreCompare && row.maxIndex === idx && row.maxPct !== null && row.field !== '圆内门店数' && row.field !== '圆内竞品数'" style="color: #e64545; font-size: 12px; font-weight: bold;">（{{ row.maxPct }}%）</span>
                </span>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="storeCompareRadiusMismatch" style="margin-top: 10px; padding: 12px; background: #fef0f0; border-radius: 4px; font-size: 13px; color: #f56c6c; border: 1px solid #fde2e2;">
            <el-icon><WarningFilled /></el-icon> 您未购买设置半径（{{ storeCompareRadius }}公里）的联通人口数据，请重新选择半径或购买数据服务。
          </div>
          <div v-else-if="storeCompareHasMissing" style="margin-top: 10px; padding: 10px; background: #fdf6ec; border-radius: 4px; font-size: 12px; color: #e6a23c;">
            <el-icon><WarningFilled /></el-icon> 部分门店缺少购买履历数据，显示为"—"。
          </div>
        </div>
      </template>

      <template #footer>
        <el-button @click="storeCompareVisible = false">关闭</el-button>
        <el-button v-if="storeCompareStep === 1" type="primary" :disabled="storeCompareSelected.length < 2" :loading="storeCompareLoading" @click="startStoreCompare">开始分析</el-button>
        <el-button v-if="storeCompareStep === 2" @click="storeCompareStep = 1; storeCompareResults = []; storeCompareTableData = []">重新选择</el-button>
      </template>
    </el-dialog>

    <!-- 相似店对话框 -->
    <el-dialog v-model="storeSimilarVisible" title="相似店" width="800px" draggable :show-close="true" @close="storeSimilarVisible = false">
      <template v-if="!storeSimilarDone">
        <el-form label-width="120px" style="margin-bottom: 12px;">
          <el-form-item label="选择半径">
            <el-select v-model="storeSimilarRadius" placeholder="请选择分析半径" style="width: 200px;">
              <el-option v-for="r in storeSimilarRadiusOptions" :key="r" :label="r + '公里'" :value="r" />
            </el-select>
            <span style="margin-left: 10px; font-size: 12px; color: #999;">从购买履历中读取</span>
          </el-form-item>
          <el-form-item label="基准门店">
            <el-input v-model="storeSimilarKeyword" placeholder="输入门店名称搜索" style="width: 260px;" clearable>
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <span style="margin-left: 10px; font-size: 12px; color: #999;">选择一家门店作为相似度基准</span>
          </el-form-item>
        </el-form>
        <div style="max-height: 260px; overflow-y: auto; border: 1px solid #ebeef5; border-radius: 4px; margin-bottom: 12px;">
          <div v-for="store in storeSimilarFiltered" :key="store.id"
            style="display: flex; align-items: center; padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0;"
            :style="{ background: storeSimilarSelected?.id === store.id ? '#ecf5ff' : 'white' }"
            @click="storeSimilarSelected = store">
            <el-button :type="storeSimilarSelected?.id === store.id ? 'primary' : 'default'" size="small" style="margin-right: 12px;">
              {{ storeSimilarSelected?.id === store.id ? '已选' : '选择' }}
            </el-button>
            <div>
              <div style="font-size: 14px; font-weight: 500;">{{ store.name }}</div>
              <div style="font-size: 12px; color: #999;">
                {{ store.brand || '-' }} | {{ store.city || '-' }}{{ store.district ? ' ' + store.district : '' }}
              </div>
            </div>
          </div>
          <div v-if="storeSimilarFiltered.length === 0" style="text-align:center;padding:24px;color:#999;font-size:13px;">无匹配门店</div>
        </div>
        <div style="font-size: 12px; color: #999;">共 {{ storeSimilarFiltered.length }} 家门店</div>
        <div v-if="storeSimilarLoading" style="text-align: center; padding: 30px;">
          <el-icon class="is-loading" style="font-size: 28px;"><Loading /></el-icon>
          <p style="margin-top: 10px; color: #666;">正在寻找相似门店...</p>
        </div>
      </template>

      <template v-if="storeSimilarDone">
        <div style="max-height: 500px; overflow-y: auto;">
          <div v-if="storeSimilarResults.length === 0" style="text-align:center;padding:40px;color:#999;">
            未找到相似门店
          </div>
          <div v-else>
            <div style="margin-bottom: 12px; padding: 10px 14px; background: #f5f7fa; border-radius: 6px; font-size: 13px; color: #666;">
              基准门店：<b style="color: #e64545;">{{ storeSimilarSelected?.name }}</b>（半径 {{ storeSimilarRadius }} 公里），按数据相似度排序
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
        <el-button v-if="!storeSimilarDone" type="primary" :disabled="!storeSimilarRadius || !storeSimilarSelected || storeSimilarLoading" :loading="storeSimilarLoading" @click="startStoreSimilar">寻找</el-button>
        <el-button v-if="storeSimilarDone" @click="resetStoreSimilar">重新选择</el-button>
      </template>
    </el-dialog>

    <!-- 门店排名对话框 -->
    <el-dialog v-model="rankingVisible" title="门店排名" width="750px" draggable :show-close="true" @close="rankingVisible = false">
      <div v-if="!rankingDone">
        <el-form label-width="120px" style="margin-bottom: 16px;">
          <el-form-item label="选择半径">
            <el-select v-model="rankingRadius" placeholder="请选择分析半径" style="width: 200px;">
              <el-option v-for="r in rankingRadiusOptions" :key="r" :label="r + '公里'" :value="r" />
            </el-select>
            <span style="margin-left: 10px; font-size: 12px; color: #999;">从购买履历中读取</span>
          </el-form-item>
        </el-form>
        <div v-if="rankingLoading" style="text-align: center; padding: 40px;">
          <el-icon class="is-loading" style="font-size: 32px;"><Loading /></el-icon>
          <p style="margin-top: 12px; color: #666;">正在计算门店排名...</p>
        </div>
      </div>

      <div v-if="rankingDone" style="max-height: 550px; overflow-y: auto;">
        <div v-for="(group, gIdx) in rankingResults" :key="gIdx" style="margin-bottom: 20px;">
          <div style="font-size: 15px; font-weight: bold; color: #333; margin-bottom: 10px; padding: 8px 12px; background: #f5f7fa; border-radius: 4px;">
            {{ group.title }}
          </div>
          <div style="display: flex; gap: 16px;">
            <div style="flex: 1;">
              <div style="font-size: 13px; font-weight: bold; color: #e64545; margin-bottom: 6px; text-align: center;">前10</div>
              <div v-for="(s, sIdx) in group.top10" :key="s.name" style="display: flex; justify-content: space-between; padding: 4px 8px; border-bottom: 1px solid #f0f0f0; font-size: 13px;">
                <span><span style="color: #999; margin-right: 6px;">{{ sIdx + 1 }}</span>{{ s.name }}</span>
                <span style="font-weight: bold; color: #e64545;">{{ s.value.toLocaleString() }}</span>
              </div>
            </div>
            <div style="flex: 1;">
              <div style="font-size: 13px; font-weight: bold; color: #409eff; margin-bottom: 6px; text-align: center;">后10</div>
              <div v-for="(s, sIdx) in group.bottom10" :key="s.name" style="display: flex; justify-content: space-between; padding: 4px 8px; border-bottom: 1px solid #f0f0f0; font-size: 13px;">
                <span><span style="color: #999; margin-right: 6px;">{{ sIdx + 1 }}</span>{{ s.name }}</span>
                <span style="font-weight: bold; color: #409eff;">{{ s.value.toLocaleString() }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="rankingVisible = false">关闭</el-button>
        <el-button v-if="!rankingDone" type="primary" :disabled="!rankingRadius || rankingLoading" :loading="rankingLoading" @click="startRanking">开始排名</el-button>
        <el-button v-if="rankingDone" @click="resetRanking">重新选择</el-button>
      </template>
    </el-dialog>

    <!-- 批量购买对话框 -->
    <BatchSmartstepsDialog
      :visible="showBatchSmartstepsDialog"
      :stores="selectedRows"
      @update:visible="showBatchSmartstepsDialog = $event"
      @close="showBatchSmartstepsDialog = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import BatchSmartstepsDialog from '@/components/BatchSmartstepsDialog.vue'
import { Plus, Upload, Download, Search, Edit, Delete, Location, Close, MapLocation, DataAnalysis, TrendCharts, Loading, Aim } from '@element-plus/icons-vue'
import axios from 'axios'
import Papa from 'papaparse'

import { useMarkerStore } from '@/stores/marker'
import { useCompetitorStore } from '@/stores/competitor'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const markerStore = useMarkerStore()
const competitorStore = useCompetitorStore()
const userStore = useUserStore()

// 门店购买次数映射 {门店名称: 购买次数}
const storePurchaseCount = ref({})

// 筛选和分页 - 使用 store 中的筛选条件（持久化）
// 使用 ref 包装 store 中的 filters，确保响应式
const searchKeyword = ref('')
const filterStoreType = ref('')
const filterCity = ref('')
const filterDistrict = ref('')
const filterStoreCategory = ref('')
const filterBrand = ref('')
const filterStoreStatus = ref([])
const filterMallType = ref('')
const currentPage = ref(1)
const pageSize = ref(20)

// localStorage 持久化（按用户隔离，userId 从 localStorage 读取保证跨刷新稳定）
const LS_KEY = () => `markerFilters_${localStorage.getItem('userId') || 'anon'}`
const SAVE_FIELDS = () => ({
  searchKeyword: searchKeyword.value,
  filterStoreType: filterStoreType.value,
  filterCity: filterCity.value,
  filterDistrict: filterDistrict.value,
  filterStoreCategory: filterStoreCategory.value,
  filterBrand: filterBrand.value,
  filterStoreStatus: filterStoreStatus.value,
  filterMallType: filterMallType.value,
  currentPage: currentPage.value
})
const saveFiltersToLS = () => localStorage.setItem(LS_KEY(), JSON.stringify(SAVE_FIELDS()))

const restoreFiltersFromLS = () => {
  const saved = localStorage.getItem(LS_KEY())
  if (!saved) return false
  try {
    const f = JSON.parse(saved)
    searchKeyword.value = f.searchKeyword || ''
    filterStoreType.value = f.filterStoreType || ''
    filterCity.value = f.filterCity || ''
    filterDistrict.value = f.filterDistrict || ''
    filterStoreCategory.value = f.filterStoreCategory || ''
    filterBrand.value = f.filterBrand || ''
    filterStoreStatus.value = Array.isArray(f.filterStoreStatus) ? f.filterStoreStatus : (f.filterStoreStatus ? [f.filterStoreStatus] : [])
    filterMallType.value = f.filterMallType || ''
    currentPage.value = f.currentPage || 1
    return true
  } catch { return false }
}

const clearFiltersFromLS = () => localStorage.removeItem(LS_KEY())

// 监听 store 中 filters 的外部变化
watch(() => markerStore.filters, (newFilters) => {
  searchKeyword.value = newFilters.searchKeyword
  filterStoreType.value = newFilters.filterStoreType
  filterCity.value = newFilters.filterCity
  filterDistrict.value = newFilters.filterDistrict
  filterStoreCategory.value = newFilters.filterStoreCategory
  filterBrand.value = newFilters.filterBrand
  filterStoreStatus.value = Array.isArray(newFilters.filterStoreStatus) ? newFilters.filterStoreStatus : (newFilters.filterStoreStatus ? [newFilters.filterStoreStatus] : [])
  filterMallType.value = newFilters.filterMallType
}, { deep: true })

// 同步筛选条件到 store + localStorage（持久化）
const syncFiltersToStore = () => {
  markerStore.setFilters({
    searchKeyword: searchKeyword.value,
    filterStoreType: filterStoreType.value,
    filterCity: filterCity.value,
    filterDistrict: filterDistrict.value,
    filterStoreCategory: filterStoreCategory.value,
    filterBrand: filterBrand.value,
    filterStoreStatus: filterStoreStatus.value,
    filterMallType: filterMallType.value
  })
  saveFiltersToLS()
}

// 是否有激活的筛选条件
const hasActiveFilters = computed(() => {
  return searchKeyword.value || filterStoreType.value || filterCity.value || filterDistrict.value || filterStoreCategory.value || filterBrand.value || filterStoreStatus.value.length || filterMallType.value
})

// 弹窗状态
const dialogVisible = ref(false)
const importDialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const importing = ref(false)
const importProgress = ref(0)
const editingId = ref(null)
const uploadRef = ref(null)
const uploadFile = ref(null)
const tableRef = ref(null)
const selectedRows = ref([])
const showBatchSmartstepsDialog = ref(false)













// 表单数据
const formRef = ref(null)
const form = reactive({
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
  store_area: null,
  seats: null,
  frontage: null,
  store_category: '',
  store_status: '',
  mall_type: '',
  trade_area_type: '',
  description: '',
  latitude: 39.9042,
  longitude: 116.4074
})

const rules = {
  name: [{ required: true, message: '请输入门店名称', trigger: 'blur' }],
  latitude: [{ required: true, message: '请输入纬度', trigger: 'blur' }],
  longitude: [{ required: true, message: '请输入经度', trigger: 'blur' }]
}

// 城市列表
const cityList = computed(() => {
  const cities = [...new Set(markerStore.markers.map(m => m.city).filter(Boolean))]
  return cities.sort()
})

// 区县列表
const districtList = computed(() => {
  const city = filterCity.value
  const districts = [...new Set(markerStore.markers.filter(m => !city || m.city === city).map(m => m.district).filter(Boolean))]
  return districts.sort()
})

// 城市切换时，清空不属于该城市的区县
watch(filterCity, (newCity) => {
  if (newCity && filterDistrict.value) {
    const districts = [...new Set(markerStore.markers.filter(m => m.city === newCity).map(m => m.district).filter(Boolean))]
    if (!districts.includes(filterDistrict.value)) {
      filterDistrict.value = ''
    }
  }
})

// 门店区分列表
const categoryList = computed(() => {
  const categories = [...new Set(markerStore.markers.map(m => m.store_category).filter(Boolean))]
  return categories.sort()
})

// 品牌列表
const brandList = computed(() => {
  const brands = [...new Set(markerStore.markers.map(m => m.brand).filter(Boolean))]
  return brands.sort()
})

// 门店状态列表
const storeStatusList = computed(() => {
  return [...new Set(markerStore.markers.map(m => m.store_status).filter(Boolean))]
})

// 商场类型列表
const mallTypeList = computed(() => {
  return [...new Set(markerStore.markers.map(m => m.mall_type).filter(Boolean))]
})

// 筛选后的数据
const filteredMarkers = computed(() => {
  return markerStore.markers.filter(marker => {
    const matchKeyword = !searchKeyword.value ||
      marker.name.toLowerCase().includes(searchKeyword.value.toLowerCase()) ||
      (marker.address && marker.address.toLowerCase().includes(searchKeyword.value.toLowerCase())) ||
      (marker.store_code && marker.store_code.toLowerCase().includes(searchKeyword.value.toLowerCase()))
    const matchType = !filterStoreType.value || marker.store_type === filterStoreType.value
    const matchCity = !filterCity.value || marker.city === filterCity.value
    const matchDistrict = !filterDistrict.value || marker.district === filterDistrict.value
    const matchCategory = !filterStoreCategory.value || marker.store_category === filterStoreCategory.value
    const matchBrand = !filterBrand.value || marker.brand === filterBrand.value
    const matchStoreStatus = !filterStoreStatus.value.length || filterStoreStatus.value.includes(marker.store_status)
    const matchMallType = !filterMallType.value || marker.mall_type === filterMallType.value
    return matchKeyword && matchType && matchCity && matchDistrict && matchCategory && matchBrand && matchStoreStatus && matchMallType
  })
})

// 分页数据
const paginatedMarkers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredMarkers.value.slice(start, end)
})

// 门店类型标签
const getStoreTypeTag = (type) => {
  const typeMap = {
    '已开业': 'success',
    '重点候选': 'warning',
    '一般候选': 'info'
  }
  return typeMap[type] || ''
}

// 搜索（同步筛选结果到地图）
const handleSearch = () => {
  currentPage.value = 1
  // 同步筛选条件到 store（持久化）
  syncFiltersToStore()
  // 计算可见ID
  syncVisibleIds()
}

// 同步可见ID到地图
const syncVisibleIds = () => {
  const hasFilter = searchKeyword.value || filterStoreType.value || filterCity.value ||
    filterDistrict.value || filterStoreCategory.value || filterBrand.value ||
    filterStoreStatus.value.length || filterMallType.value
  if (!hasFilter) {
    markerStore.setVisibleIds(null)  // 无筛选 → 显示全部
  } else {
    const ids = filteredMarkers.value.map(m => m.id)
    markerStore.setVisibleIds(ids)
  }
}

// 清除筛选条件
const handleClearFilters = () => {
  searchKeyword.value = ''
  filterStoreType.value = ''
  filterCity.value = ''
  filterDistrict.value = ''
  filterStoreCategory.value = ''
  filterBrand.value = ''
  filterStoreStatus.value = []
  filterMallType.value = ''
  markerStore.clearFilters()
  clearFiltersFromLS()
  currentPage.value = 1
}

// 显示添加弹窗
const showAddDialog = () => {
  isEdit.value = false
  editingId.value = null
  Object.assign(form, {
    store_code: '',
    brand: '',
    name: '',
    store_type: '已开业',
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
    contact_person: '',
    contact_phone: '',
    description: '',
    latitude: 39.9042,
    longitude: 116.4074
  })
  dialogVisible.value = true
}

// 编辑
const handleEdit = (row) => {
  isEdit.value = true
  editingId.value = row.id
  Object.assign(form, {
    store_code: row.store_code || '',
    brand: row.brand || '',
    name: row.name,
    store_type: row.store_type || '',
    city: row.city || '',
    district: row.district || '',
    area_manager: row.area_manager || '',
    phone1: row.phone1 || '',
    store_manager: row.store_manager || '',
    phone2: row.phone2 || '',
    address: row.address || '',
    open_date: row.open_date || '',
    business_hours: row.business_hours || '',
    area: row.area || null,
    seats: row.seats || null,
    rent: row.rent || null,
    store_category: row.store_category || '',
    contact_person: row.contact_person || '',
    contact_phone: row.contact_phone || '',
    description: row.description || '',
    latitude: row.latitude,
    longitude: row.longitude
  })
  dialogVisible.value = true
}

// 保存
const handleSave = async () => {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    let result
    if (isEdit.value) {
      result = await markerStore.updateMarker(editingId.value, { ...form })
    } else {
      result = await markerStore.addMarker({ ...form })
    }

    if (result.success) {
      ElMessage.success(isEdit.value ? '更新成功' : '添加成功')
      dialogVisible.value = false
    } else {
      ElMessage.error(result.message)
    }
  } finally {
    saving.value = false
  }
}

// 删除
const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm(`确定要删除门店「${row.name}」吗？`, '提示', {
      type: 'warning'
    })
    const result = await markerStore.deleteMarker(row.id)
    if (result.success) {
      ElMessage.success('删除成功')
    } else {
      ElMessage.error(result.message)
    }
  } catch {
    // 用户取消
  }
}

// 查看该门店的购买履历
const handleViewPurchase = (row) => {
  // 跳转到个人中心，并传递门店名称参数
  router.push({ path: '/account', query: { storeName: row.name } })
}

// 表格选择变化
const handleSelectionChange = (selection) => {
  selectedRows.value = selection
}

// 批量删除
const handleBatchDelete = async () => {
  if (selectedRows.value.length === 0) return
  try {
    await ElMessageBox.confirm(`确定要删除选中的 ${selectedRows.value.length} 条门店数据吗？`, '提示', {
      type: 'warning'
    })
    const ids = selectedRows.value.map(row => row.id)
    const result = await markerStore.batchDeleteMarkers(ids)
    if (result.success) {
      ElMessage.success(`成功删除 ${result.count} 条数据`)
      tableRef.value?.clearSelection()
      selectedRows.value = []
      // 重置筛选条件
      markerStore.clearFilters()
    } else {
      ElMessage.error(result.message)
    }
  } catch {
    // 用户取消
  }
}

// 全清除（有筛选时只清筛选结果，无筛选时清全部）
const handleClearAll = async () => {
  try {
    const hasFilter = hasActiveFilters.value
    const targetIds = hasFilter ? filteredMarkers.value.map(m => m.id) : null
    const count = targetIds?.length || markerStore.markers.length
    const msg = hasFilter
      ? `将删除当前筛选条件下的 ${count} 条门店数据，不可恢复！确定继续吗？`
      : `此操作将清空您所有的 ${count} 条门店数据，不可恢复！确定继续吗？`

    await ElMessageBox.confirm(msg, '危险操作',
      { type: 'warning', confirmButtonText: '确定清空', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )

    let result
    if (hasFilter && targetIds.length > 0) {
      result = await markerStore.batchDeleteMarkers(targetIds)
    } else {
      result = await markerStore.clearAllMarkers()
    }

    if (result.success) {
      ElMessage.success(`已清除 ${result.count} 条门店数据`)
      tableRef.value?.clearSelection()
      selectedRows.value = []
      if (!hasFilter) markerStore.clearFilters()
    } else {
      ElMessage.error(result.message)
    }
  } catch {}
}

// 定位
const handleLocate = (row) => {
  router.push({ path: '/', query: { lat: row.latitude, lng: row.longitude, id: row.id } })
}

// 导入菜单命令
const handleImportMenuCommand = (command) => {
  if (command === 'import') {
    handleImport()
  } else if (command === 'geocode') {
    showGeocodeDialog()
  } else if (command === 'export') {
    handleExport()
  }
}

// 导入
const handleImport = () => {
  uploadFile.value = null
  importDialogVisible.value = true
}

// 文件变化
const handleFileChange = (file) => {
  uploadFile.value = file.raw
}

// 确认导入
const handleImportConfirm = async () => {
  if (!uploadFile.value) {
    ElMessage.warning('请选择文件')
    return
  }

  importing.value = true
  importProgress.value = 0
  try {
    const onProgress = (event) => {
      importProgress.value = Math.round((event.loaded / event.total) * 100)
    }
    const result = await markerStore.importMarkers(uploadFile.value, onProgress)
    if (result.success) {
      ElMessage.success(`成功导入 ${result.count} 条数据`)
      importDialogVisible.value = false
    } else {
      ElMessage.error(result.message)
    }
  } finally {
    importing.value = false
  }
}

// 导出
const handleExport = async () => {
  const result = await markerStore.exportMarkers()
  if (result.success) {
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stores_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  }
}

// 下载模板
const downloadTemplate = () => {
  const template = `store_code,brand,name,store_type,city,district,address,open_date,business_hours,store_area,seats,frontage,store_category,store_status,mall_type,trade_area_type,latitude,longitude,description
BJ001,星巴克,星巴克国贸店,已开业,北京市,朝阳区,国贸大厦一层,2023-01-15,07:00-22:00,200,80,,直营,正常,,,39.9088,116.4610,CBD核心区
BJ002,星巴克,星巴克望京候选,重点候选,北京市,朝阳区,,,,,,,加盟,正常,,,39.9965,116.4710,重点跟进`
  const blob = new Blob(['\ufeff' + template], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'store_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ===== 地址解析 =====
// 对话框控制
const geocodeDialogVisible = ref(false)
const geocodeStep = ref(1)           // 1=上传 2=结果
const geocodeCsvFile = ref(null)      // 上传的CSV文件
const geocodeUploadRef = ref(null)
const geocodeParsing = ref(false)
const geocodeImporting = ref(false)
const geocodeResults = ref([])        // 解析结果列表
const geocodeSuccessCount = computed(() => geocodeResults.value.filter(r => r.success).length)

// 原始CSV数据（保留所有列，用于导入）
let geocodeRawData = []

const showGeocodeDialog = () => {
  geocodeDialogVisible.value = true
  geocodeStep.value = 1
  geocodeCsvFile.value = null
  geocodeResults.value = []
  geocodeRawData = []
}

const handleGeocodeFileChange = (file) => {
  geocodeCsvFile.value = file.raw
}

// 解析CSV并批量调用地理编码
const handleParseGeocode = async () => {
  if (!geocodeCsvFile.value) {
    ElMessage.warning('请先上传CSV文件')
    return
  }

  geocodeParsing.value = true
  geocodeResults.value = []
  geocodeRawData = []

  try {
    // 1. 自动识别编码：先尝试 UTF-8，若检测到乱码则改用 GBK
    const buffer = await geocodeCsvFile.value.arrayBuffer()
    let text = new TextDecoder('utf-8').decode(buffer)
    // 检测 UTF-8 乱码：U+FFFD 是 UTF-8 解码失败的替换字符，连续出现说明原本是 GBK
    // 注意：不要用 /[\x80-\xff]{3,}/ 检测连续高字节，因为中文 UTF-8 本身就是连续高字节
    const seemsGarbled = (text.match(/\ufffd/g) || []).length >= 2
    if (seemsGarbled) {
      text = new TextDecoder('gbk').decode(buffer)
    }
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })

    if (!parsed.data || parsed.data.length === 0) {
      ElMessage.error('CSV 文件为空或格式错误')
      geocodeParsing.value = false
      return
    }

    geocodeRawData = parsed.data

    // 2. 构造地址列表
    const addresses = geocodeRawData.map((row, i) => ({
      name: row.name || row.门店名称 || `门店${i + 1}`,
      address: row.address || row.地址 || '',
      city: row.city || row.城市 || '',
      district: row.district || row.区县 || ''
    })).filter(a => a.address)

    if (addresses.length === 0) {
      ElMessage.error('未找到有效的地址数据（需包含 address 列）')
      geocodeParsing.value = false
      return
    }

    // 3. 批量调用地理编码
    const result = await markerStore.batchGeocode(addresses)

    if (!result.success) {
      ElMessage.error(result.message)
      geocodeParsing.value = false
      return
    }

    // 4. 合并结果：将地理编码结果与原始数据合并
    geocodeResults.value = result.results.map((r, i) => ({
      ...r,
      // 保留原始CSV的其他字段
      ...Object.fromEntries(
        Object.entries(geocodeRawData[i] || {})
          .filter(([k]) => !['name', 'address', 'city', 'district'].includes(k))
      )
    }))

    geocodeStep.value = 2
    ElMessage.success(`解析完成！成功 ${geocodeSuccessCount.value} 条`)
  } catch (err) {
    console.error(err)
    ElMessage.error('解析失败：' + err.message)
  } finally {
    geocodeParsing.value = false
  }
}

// 导出解析结果为CSV
const handleGeocodeExport = () => {
  if (geocodeResults.value.length === 0) return

  // 构造CSV字段
  const sample = geocodeResults.value[0]
  const fields = ['name', 'address', 'city', 'district', 'longitude', 'latitude',
    'formatted_address', ...Object.keys(sample).filter(k => !['name','address','city','district','longitude','latitude','formatted_address','success','error'].includes(k))
  ]

  const csv = Papa.unparse(geocodeResults.value.filter(r => r.success), { fields })
  // 添加 UTF-8 BOM，确保 Excel 正确识别中文
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `geocode_result_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('导出成功')
}

// 将解析成功的记录导入门店库
const handleGeocodeImport = async () => {
  const successItems = geocodeResults.value.filter(r => r.success)
  if (successItems.length === 0) {
    ElMessage.warning('没有可导入的记录')
    return
  }

  geocodeImporting.value = true
  let importCount = 0
  let failCount = 0

  try {
    for (const item of successItems) {
      const marker = {
        name: item.name,
        address: item.address || item.formatted_address || '',
        city: item.city || '',
        district: item.district || '',
        latitude: item.latitude,
        longitude: item.longitude,
        // 从原始数据中取其他字段
        store_code: item.store_code || '',
        brand: item.brand || '',
        store_type: item.store_type || '',
        area_manager: item.area_manager || '',
        phone1: item.phone1 || '',
        store_manager: item.store_manager || '',
        phone2: item.phone2 || '',
        area: item.area ? Number(item.area) : null,
        seats: item.seats ? Number(item.seats) : null,
        rent: item.rent ? Number(item.rent) : null,
        store_category: item.store_category || '',
        contact_person: item.contact_person || '',
        contact_phone: item.contact_phone || '',
        open_date: item.open_date || '',
        business_hours: item.business_hours || '',
        description: item.description || ''
      }
      const result = await markerStore.addMarker(marker)
      if (result.success) importCount++
      else failCount++
    }
    ElMessage.success(`成功导入 ${importCount} 条${failCount > 0 ? `，失败 ${failCount} 条` : ''}`)
    geocodeDialogVisible.value = false
    markerStore.fetchMarkers()
  } catch (err) {
    ElMessage.error('导入出错：' + err.message)
  } finally {
    geocodeImporting.value = false
  }
}

// 监听对话框关闭，重置状态
watch(geocodeDialogVisible, (val) => {
  if (!val) {
    setTimeout(() => {
      geocodeStep.value = 1
      geocodeCsvFile.value = null
      geocodeResults.value = []
      geocodeRawData = []
    }, 300)
  }
})

onMounted(async () => {
  console.log('🏪 DataView 已加载！', new Date().toISOString())
  await markerStore.fetchMarkers()
  console.log('✅ 门店列表加载完成，准备获取购买次数', markerStore.markers.length, '条')
  // 恢复筛选条件：优先 localStorage（跨登录会话），否则从 store 恢复
  const restored = restoreFiltersFromLS()
  if (!restored) {
    searchKeyword.value = markerStore.filters.searchKeyword
    filterStoreType.value = markerStore.filters.filterStoreType
    filterCity.value = markerStore.filters.filterCity
    filterDistrict.value = markerStore.filters.filterDistrict
    filterStoreCategory.value = markerStore.filters.filterStoreCategory
    filterBrand.value = markerStore.filters.filterBrand
    filterStoreStatus.value = Array.isArray(markerStore.filters.filterStoreStatus) ? markerStore.filters.filterStoreStatus : (markerStore.filters.filterStoreStatus ? [markerStore.filters.filterStoreStatus] : [])
    filterMallType.value = markerStore.filters.filterMallType || ''
  }
  syncFiltersToStore()
  // 获取门店购买次数
  await fetchStorePurchaseCounts()
  console.log('✅ 购买次数获取完成')
  // 获取竞品数据（用于门店对比中的圆内竞品统计）
  await competitorStore.fetchCompetitors()
  console.log('✅ 竞品数据加载完成')

  // 检测 AI 助手传递的门店对比请求
  if (window.__pendingCompareStores) {
    const { storeIds, radius } = window.__pendingCompareStores
    window.__pendingCompareStores = null
    // 查找门店并打开对比
    const stores = markerStore.markers.filter(m => storeIds.includes(m.id))
    if (stores.length >= 2) {
      storeCompareSelected.value = stores
      storeCompareRadius.value = radius || 2
      // 短暂延迟后打开对话框，确保DOM已渲染
      setTimeout(() => {
        storeCompareVisible.value = true
        storeCompareStep.value = 1
      }, 500)
    }
  }

  // 检测 AI 助手传递的门店排名请求
  if (window.__pendingStoreRanking) {
    const { radius } = window.__pendingStoreRanking
    window.__pendingStoreRanking = null
    setTimeout(() => {
      showStoreRankingDialog()
      if (radius) rankingRadius.value = radius
    }, 500)
  }
})

// 获取所有门店的购买次数（批量查询，一次API调用）
async function fetchStorePurchaseCounts() {
  try {
    console.log('开始获取购买次数...')
    const res = await axios.get('/api/purchase/store-counts')
    console.log('购买次数结果:', res.data.counts)
    storePurchaseCount.value = res.data.counts || {}
  } catch (e) {
    console.error('获取购买次数失败:', e)
  }
}

// 获取门店名称的星星数量
function getStoreStars(storeName) {
  return storePurchaseCount.value[storeName] || 0
}

// ====== 门店对比 ======
const storeCompareVisible = ref(false)
const storeCompareStep = ref(1)
const storeCompareKeyword = ref('')
const storeCompareRadius = ref(2)
const storeCompareLoading = ref(false)
const storeCompareResults = ref([])
const storeCompareTableData = ref([])
const storeCompareSelected = ref([])

// 筛选门店列表
const storeCompareFiltered = computed(() => {
  const kw = storeCompareKeyword.value.toLowerCase()
  const selectedIds = new Set(storeCompareSelected.value.map(s => s.id))
  const result = [...storeCompareSelected.value]
  markerStore.markers.forEach(s => {
    if (!selectedIds.has(s.id)) {
      if (!kw || s.name?.toLowerCase().includes(kw) || s.brand?.toLowerCase().includes(kw)) {
        result.push(s)
      }
    }
  })
  return result
})

const removeStoreCompare = (store) => {
  storeCompareSelected.value = storeCompareSelected.value.filter(s => s.id !== store.id)
}

const toggleStoreCompare = (store) => {
  const idx = storeCompareSelected.value.findIndex(s => s.id === store.id)
  if (idx >= 0) {
    storeCompareSelected.value = storeCompareSelected.value.filter((_, i) => i !== idx)
  } else if (storeCompareSelected.value.length < 5) {
    storeCompareSelected.value = [...storeCompareSelected.value, { ...store }]
  }
}

const showStoreCompareDialog = () => {
  storeCompareStep.value = 1
  storeCompareKeyword.value = ''
  storeCompareRadius.value = 2
  storeCompareSelected.value = []
  storeCompareResults.value = []
  storeCompareTableData.value = []
  storeCompareVisible.value = true
}

// 是否有门店缺少数据或半径不匹配
const storeCompareHasMissing = computed(() => {
  return storeCompareResults.value.some(r => r.pop === null && !r.exactRadiusMatch)
})
const storeCompareRadiusMismatch = computed(() => {
  return storeCompareResults.value.some(r => r.exactRadiusMatch === false)
})

// 计算两点距离（Haversine公式）
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// 从 result_data 提取 1001 人口字段
function extractPopData(resultData) {
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

// 计算圆内门店数（排除当前门店）和竞品数
function countStoresInCircle(centerLat, centerLng, radiusM, excludeStoreId) {
  const myCount = markerStore.markers.filter(s => {
    if (s.latitude == null || s.longitude == null) return false
    if (s.id === excludeStoreId) return false // 排除当前门店自身
    return calculateDistance(centerLat, centerLng, s.latitude, s.longitude) <= radiusM
  }).length

  const compCount = competitorStore.competitors.filter(c => {
    if (c.latitude == null || c.longitude == null) return false
    return calculateDistance(centerLat, centerLng, c.latitude, c.longitude) <= radiusM
  }).length

  return { myCount, compCount }
}

// 开始门店对比
const startStoreCompare = async () => {
  if (storeCompareSelected.value.length < 2) {
    ElMessage.warning('请至少选择2家门店')
    return
  }
  const stores = [...storeCompareSelected.value]
  storeCompareLoading.value = true
  storeCompareResults.value = []
  storeCompareTableData.value = []

  try {
    const radiusM = storeCompareRadius.value * 1000
    const results = []

    for (const store of stores) {
      const res = await axios.get(`/api/purchase/by-store/${encodeURIComponent(store.name)}`)
      const purchases = res.data?.purchases || []

      let matched = null
      let exactRadiusMatch = false
      for (const p of purchases) {
        let pRadius = p.radius
        try { pRadius = JSON.parse(p.radius) } catch (e) { }
        const radii = Array.isArray(pRadius) ? pRadius : [pRadius]
        const maxR = Math.max(...radii.map(r => Number(r) || 0))
        // 先尝试精确匹配半径（容差500米）
        if (Math.abs(maxR - radiusM) <= 500 || radii.some(r => Math.abs(Number(r) - radiusM) <= 500)) {
          matched = p
          exactRadiusMatch = true
          break
        }
      }
      console.log(`[门店对比] ${store.name}: 半径匹配=${exactRadiusMatch}, 购买记录数=${purchases.length}, radiusM=${radiusM}`)

      const result = { id: store.id, name: store.name, brand: store.brand || '-', exactRadiusMatch }

      // 不论是否有购买记录匹配，都先计算圆内门店/竞品数量（排除当前门店自身）
      const counts = countStoresInCircle(store.latitude, store.longitude, radiusM, store.id)
      result.myStoreCount = counts.myCount
      result.compStoreCount = counts.compCount

      // 获取 result_data：列表接口不返回该字段，需要调详情接口
      let resultData = null
      if (matched) {
        try {
          const detailRes = await axios.get(`/api/purchase/${matched.id}`)
          resultData = detailRes.data?.result_data || null
        } catch (e) {
          console.warn('获取购买记录详情失败:', matched.id, e)
        }
      }

      if (resultData) {
        const popData = extractPopData(resultData)
        result.pop = popData || {}
      } else {
        result.pop = null
      }
      console.log(`[门店对比] ${store.name}: pop=${JSON.stringify(result.pop)}, exactRadiusMatch=${result.exactRadiusMatch}, myCount=${result.myStoreCount}`)

      results.push(result)
    }

    storeCompareResults.value = results
    console.log(`[门店对比] 结果数=${results.length}, useHeatmapStyle应当是 ${results.length >= 3}`)

    const fieldKeys = [
      { key: 'visit', label: '到访人口数' },
      { key: 'live', label: '居住人口数' },
      { key: 'work', label: '工作人口数' },
      { key: 'out', label: '外省到访人口数' },
      { key: 'entertain', label: '娱乐人数' },
      { key: '_myCount', label: '圆内门店数' },
      { key: '_compCount', label: '圆内竞品数' },
    ]

    const rows = fieldKeys.map(fk => {
      const values = results.map(r => {
        if (fk.key === '_myCount') return r.myStoreCount?.toLocaleString() || '0'
        if (fk.key === '_compCount') return r.compStoreCount?.toLocaleString() || '0'
        return r.pop ? (r.pop[fk.key]?.toLocaleString() || '—') : '—'
      })
      const nums = values.map(v => {
        const n = Number(String(v).replace(/,/g, ''))
        return isNaN(n) ? null : n
      })
      const nonNull = nums.filter(n => n !== null)
      const maxVal = nonNull.length > 0 ? Math.max(...nonNull) : null
      const maxIndex = maxVal !== null ? nums.indexOf(maxVal) : -1
      // 计算最高值比第二名高出的百分比
      let maxPct = null
      if (maxVal !== null) {
        const sorted = [...nonNull].sort((a, b) => b - a)
        const secondVal = sorted.length > 1 ? sorted[1] : null
        if (secondVal !== null && secondVal > 0) {
          maxPct = Math.round(((maxVal - secondVal) / secondVal) * 100)
        }
      }
      return { field: fk.label, values, maxIndex, nums, maxPct }
    })

    storeCompareTableData.value = rows
    storeCompareStep.value = 2
  } catch (e) {
    console.error('门店对比分析失败:', e)
    ElMessage.error('对比分析失败: ' + (e.response?.data?.message || e.message))
  } finally {
    storeCompareLoading.value = false
  }
}

// 单元格字体颜色：数值最高用红色，其余默认黑色（仅2家门店时使用）
function getCompareCellStyle(nums, idx) {
  if (!nums || nums.length === 0) return '#333'
  const validNums = nums.map(n => Math.abs(Number(n) || 0))
  const maxVal = Math.max(...validNums)
  const minVal = Math.min(...validNums)
  if (maxVal === minVal) return '#333'
  return validNums[idx] >= maxVal ? '#e64545' : '#333'
}
const isTwoStoreCompare = computed(() => storeCompareResults.value.length === 2)

// ====== 相似店 ======
const storeSimilarVisible = ref(false)
const storeSimilarRadius = ref(null)
const storeSimilarRadiusOptions = ref([])
const storeSimilarKeyword = ref('')
const storeSimilarSelected = ref(null)
const storeSimilarLoading = ref(false)
const storeSimilarDone = ref(false)
const storeSimilarResults = ref([])

// 筛选门店列表（单选）
const storeSimilarFiltered = computed(() => {
  const kw = storeSimilarKeyword.value?.toLowerCase() || ''
  return markerStore.markers.filter(s => {
    if (!kw) return true
    return (s.name || '').toLowerCase().includes(kw) || (s.brand || '').toLowerCase().includes(kw)
  })
})

const showStoreSimilarDialog = () => {
  storeSimilarRadius.value = null
  storeSimilarRadiusOptions.value = []
  storeSimilarKeyword.value = ''
  storeSimilarSelected.value = null
  storeSimilarLoading.value = false
  storeSimilarDone.value = false
  storeSimilarResults.value = []
  storeSimilarVisible.value = true
  nextTick(() => loadStoreSimilarRadiusOptions())
}

// 从购买履历读取所有可用半径（与门店排名共用逻辑）
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

// 获取指定门店在指定半径下的人口数据（无购买记录返回 null）
const fetchStorePopData = async (store, radiusM) => {
  try {
    const res = await axios.get(`/api/purchase/by-store/${encodeURIComponent(store.name)}`)
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
    const pop = extractPopData(resultData)
    if (!pop) return null
    return { visit: pop.visit || 0, live: pop.live || 0, work: pop.work || 0, out: pop.out || 0, entertain: pop.entertain || 0 }
  } catch (e) { return null }
}

// 计算两门店数据向量的相似度（欧氏距离 → 百分比）
const calcStoreSimilarity = (base, other) => {
  const keys = ['visit', 'live', 'work', 'out', 'entertain']
  // 欧氏距离（按比例缩放）
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
  const dist = Math.sqrt(sqSum / weightSum) // 0~1
  return Math.max(0, Math.round((1 - dist) * 100))
}

// 开始寻找相似店
const startStoreSimilar = async () => {
  if (!storeSimilarRadius.value) { ElMessage.warning('请选择分析半径'); return }
  if (!storeSimilarSelected.value) { ElMessage.warning('请选择基准门店'); return }
  storeSimilarLoading.value = true
  storeSimilarDone.value = false

  try {
    const radiusM = storeSimilarRadius.value * 1000
    const baseStore = storeSimilarSelected.value
    // 获取基准门店数据
    const basePop = await fetchStorePopData(baseStore, radiusM)
    if (!basePop) {
      ElMessage.warning(`基准门店「${baseStore.name}」在该半径下无购买履历数据`)
      storeSimilarLoading.value = false
      return
    }

    // 遍历其他门店（排除基准门店自身），分批并发
    const candidates = markerStore.markers.filter(s => s.id !== baseStore.id)
    const results = []
    const batchSize = 5
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize)
      const batchResults = await Promise.all(batch.map(async (store) => {
        const pop = await fetchStorePopData(store, radiusM)
        if (!pop) return null
        return {
          name: store.name,
          brand: store.brand || '-',
          city: store.city || '',
          district: store.district || '',
          visit: pop.visit, live: pop.live, work: pop.work,
          similarity: calcStoreSimilarity(basePop, pop)
        }
      }))
      results.push(...batchResults.filter(Boolean))
    }

    // 按相似度降序，取前 15
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

const resetStoreSimilar = () => {
  storeSimilarDone.value = false
  storeSimilarResults.value = []
}

// ====== 门店排名 ======
const rankingVisible = ref(false)
const rankingRadius = ref(null)
const rankingRadiusOptions = ref([])
const rankingLoading = ref(false)
const rankingDone = ref(false)
const rankingResults = ref([])

const showStoreRankingDialog = () => {
  rankingRadius.value = null
  rankingRadiusOptions.value = []
  rankingLoading.value = false
  rankingDone.value = false
  rankingResults.value = []
  rankingVisible.value = true
  // 异步读取半径选项
  nextTick(() => loadRankingRadiusOptions())
}

// 从购买履历中读取所有可用半径
const loadRankingRadiusOptions = async () => {
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
    rankingRadiusOptions.value = [...radiusSet].sort((a, b) => a - b).map(r => Math.round(r / 100) / 10)
  } catch (e) {
    console.error('获取半径选项失败:', e)
  }
}

const startRanking = async () => {
  if (!rankingRadius.value) { ElMessage.warning('请选择分析半径'); return }
  rankingLoading.value = true
  rankingDone.value = false

  try {
    const radiusM = rankingRadius.value * 1000
    const allMarkers = markerStore.markers
    const results = []

    // 并发获取所有门店的购买数据
    const batchSize = 5
    for (let i = 0; i < allMarkers.length; i += batchSize) {
      const batch = allMarkers.slice(i, i + batchSize)
      const batchResults = await Promise.all(batch.map(async (store) => {
        try {
          const res = await axios.get(`/api/purchase/by-store/${encodeURIComponent(store.name)}`)
          const purchases = res.data?.purchases || []
          // 匹配半径
          let matched = null
          for (const p of purchases) {
            let pr = p.radius
            try { pr = JSON.parse(pr) } catch (e) {}
            const radii = Array.isArray(pr) ? pr : [pr]
            if (radii.some(r => Math.abs(Number(r) - radiusM) <= 500)) { matched = p; break }
          }
          if (!matched) return null
          // 获取详情（含 result_data）
          const detailRes = await axios.get(`/api/purchase/${matched.id}`)
          const resultData = detailRes.data?.result_data
          if (!resultData) return null
          const pop = extractPopData(resultData)
          if (!pop) return null
          return { name: store.name, visit: pop.visit || 0, live: pop.live || 0, work: pop.work || 0 }
        } catch (e) { return null }
      }))
      results.push(...batchResults.filter(Boolean))
    }

    if (results.length === 0) {
      ElMessage.warning('未找到有有效人口数据的门店')
      rankingLoading.value = false
      return
    }

    // 排序并取前10/后10
    const sortBy = (field) => [...results].sort((a, b) => b[field] - a[field])

    const top10 = (arr) => arr.slice(0, Math.min(10, arr.length))
    const bottom10 = (arr) => arr.slice(-Math.min(10, arr.length)).reverse()

    const rankVisit = sortBy('visit')
    const rankLive = sortBy('live')
    const rankWork = sortBy('work')

    rankingResults.value = [
      { title: '到访人口数', top10: top10(rankVisit).map(s => ({ name: s.name, value: s.visit })), bottom10: bottom10(rankVisit).map(s => ({ name: s.name, value: s.visit })) },
      { title: '居住人口数', top10: top10(rankLive).map(s => ({ name: s.name, value: s.live })), bottom10: bottom10(rankLive).map(s => ({ name: s.name, value: s.live })) },
      { title: '工作人口数', top10: top10(rankWork).map(s => ({ name: s.name, value: s.work })), bottom10: bottom10(rankWork).map(s => ({ name: s.name, value: s.work })) }
    ]
    rankingDone.value = true
  } catch (e) {
    console.error('门店排名失败:', e)
    ElMessage.error('排名失败: ' + (e.response?.data?.message || e.message))
  } finally {
    rankingLoading.value = false
  }
}

const resetRanking = () => {
  rankingDone.value = false
  rankingResults.value = []
}
// cache-bust: v1
</script>

<style lang="scss" scoped>
.data-view {
  height: 100%;
  padding: 20px;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.data-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;

  h2 {
    margin: 0;
    font-size: 18px;
    color: #333;
  }

  .header-actions {
    display: flex;
    gap: 10px;
  }
}

.filter-bar {
  background: white;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 15px;
  display: flex;
  align-items: center;
  gap: 15px;

  .统计 {
    margin-left: auto;
    color: #666;
    font-size: 14px;
  }
}

.data-table {
  flex: 1;
  background: white;
  border-radius: 8px;
  padding: 15px;
  overflow: auto;
}

.pagination-container {
  margin-top: 15px;
  display: flex;
  justify-content: flex-end;
}

.import-tips {
  margin-bottom: 20px;
  padding: 15px;
  background: #f5f7fa;
  border-radius: 4px;

  p {
    margin: 0 0 10px 0;
    font-weight: bold;
  }

  ul {
    margin: 0;
    padding-left: 20px;
    font-size: 13px;
    color: #666;
  }
}

.store-stars {
  margin-left: 4px;
  font-size: 12px;
}
</style>
