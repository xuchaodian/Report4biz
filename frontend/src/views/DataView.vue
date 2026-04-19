<template>
  <div class="data-view">
    <div class="data-header">
      <h2>门店管理</h2>
      <div class="header-actions">
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>添加门店
        </el-button>
        <el-button type="warning" @click="showPopulationCompareDialog">
          <el-icon><DataAnalysis /></el-icon>人口对比
        </el-button>
        <el-button @click="showGeocodeDialog">
          <el-icon><MapLocation /></el-icon>地址解析
        </el-button>
        <el-button @click="handleImport">
          <el-icon><Upload /></el-icon>导入
        </el-button>
        <el-button @click="handleExport">
          <el-icon><Download /></el-icon>导出
        </el-button>
        <el-button
          v-if="selectedRows.length > 0"
          type="danger"
          @click="handleBatchDelete"
        >
          <el-icon><Delete /></el-icon>批量删除({{ selectedRows.length }})
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
        <el-table-column prop="area_manager" label="区域经理" width="100" show-overflow-tooltip />
        <el-table-column prop="phone1" label="电话1" width="120" />
        <el-table-column prop="store_manager" label="店长" width="80" />
        <el-table-column prop="area" label="面积" width="80" align="right">
          <template #default="{ row }">{{ row.area ? row.area + '㎡' : '-' }}</template>
        </el-table-column>
        <el-table-column prop="seats" label="座位" width="70" align="right">
          <template #default="{ row }">{{ row.seats || '-' }}</template>
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

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="区域经理" prop="area_manager">
              <el-input v-model="form.area_manager" placeholder="区域经理姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="电话1" prop="phone1">
              <el-input v-model="form.phone1" placeholder="区域经理电话" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="店长" prop="store_manager">
              <el-input v-model="form.store_manager" placeholder="店长姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="电话2" prop="phone2">
              <el-input v-model="form.phone2" placeholder="店长电话" />
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
            <el-form-item label="面积(㎡)" prop="area">
              <el-input-number v-model="form.area" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="座位数" prop="seats">
              <el-input-number v-model="form.seats" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="租金(元/月)" prop="rent">
              <el-input-number v-model="form.rent" :min="0" style="width: 100%" />
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
            <el-form-item label="联系人" prop="contact_person">
              <el-input v-model="form.contact_person" placeholder="业主/联系人" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="联系电话" prop="contact_phone">
              <el-input v-model="form.contact_phone" placeholder="联系电话" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="经度" prop="longitude">
              <el-input-number v-model="form.longitude" :precision="6" :step="0.001" :min="-180" :max="180" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
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
          <li>area_manager - 区域经理</li>
          <li>phone1 - 电话1</li>
          <li>store_manager - 店长</li>
          <li>phone2 - 电话2</li>
          <li>address - 地址</li>
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

    <!-- 人口对比对话框 -->
    <el-dialog v-model="populationCompareVisible" title="人口对比分析" width="900px" draggable>
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
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Download, Search, Edit, Delete, Location, Close, MapLocation, DataAnalysis } from '@element-plus/icons-vue'
import axios from 'axios'
import Papa from 'papaparse'
import * as echarts from 'echarts'
import { calculatePopulationByRadius, formatNumber } from '@/utils/populationStats'
import { useMarkerStore } from '@/stores/marker'

const router = useRouter()
const markerStore = useMarkerStore()

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
const currentPage = ref(1)
const pageSize = ref(20)

// 监听 store 中 filters 的外部变化
watch(() => markerStore.filters, (newFilters) => {
  searchKeyword.value = newFilters.searchKeyword
  filterStoreType.value = newFilters.filterStoreType
  filterCity.value = newFilters.filterCity
  filterDistrict.value = newFilters.filterDistrict
  filterStoreCategory.value = newFilters.filterStoreCategory
  filterBrand.value = newFilters.filterBrand
}, { deep: true })

// 同步筛选条件到 store（持久化）
const syncFiltersToStore = () => {
  markerStore.setFilters({
    searchKeyword: searchKeyword.value,
    filterStoreType: filterStoreType.value,
    filterCity: filterCity.value,
    filterDistrict: filterDistrict.value,
    filterStoreCategory: filterStoreCategory.value,
    filterBrand: filterBrand.value
  })
}

// 是否有激活的筛选条件
const hasActiveFilters = computed(() => {
  return searchKeyword.value || filterStoreType.value || filterCity.value || filterDistrict.value || filterStoreCategory.value || filterBrand.value
})

// 弹窗状态
const dialogVisible = ref(false)
const importDialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const importing = ref(false)
const editingId = ref(null)
const uploadRef = ref(null)
const uploadFile = ref(null)
const tableRef = ref(null)
const selectedRows = ref([])

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
    const listRes = await fetch(`/api/shapefiles`, {
      headers: { 'x-user-id': userId }
    })
    const listData = await listRes.json()
    const shapefiles = Array.isArray(listData) ? listData : (listData.data || [])

    if (shapefiles.length === 0) {
      ElMessage.warning('没有找到上传的数据文件，请先上传shp文件')
      compareLoading.value = false
      return
    }

    // 获取第一个整数字段作为统计字段
    const firstSf = shapefiles[0]
    const sfRes = await fetch(`/api/shapefiles/${firstSf.id}`, {
      headers: { 'x-user-id': userId }
    })
    const sfData = await sfRes.json()
    const geojson = sfData.data?.geojson || sfData.geojson

    let statField = null
    if (geojson?.features?.length > 0) {
      const props = geojson.features[0].properties || {}
      for (const [key, val] of Object.entries(props)) {
        if (key !== 'RecID' && Number.isInteger(Number(val))) {
          statField = key
          break
        }
      }
    }

    if (!statField) {
      ElMessage.warning('数据文件中未找到有效的统计字段')
      compareLoading.value = false
      return
    }

    // 获取shapefile数据的回调
    const getShapefiles = async () => {
      const results = []
      for (const sf of shapefiles) {
        try {
          const res = await fetch(`/api/shapefiles/${sf.id}`, {
            headers: { 'x-user-id': userId }
          })
          const data = await res.json()
          results.push({
            id: sf.id,
            name: sf.name,
            geojson: data.data?.geojson || data.geojson
          })
        } catch (e) {
          console.error(`获取 ${sf.name} 失败:`, e)
        }
      }
      return results
    }

    const radiusMeters = compareRadius.value * 1000
    const allResults = []

    for (const store of storesToCompare) {
      const lat = store.latitude
      const lng = store.longitude

      if (!lat || !lng) {
        ElMessage.warning(`门店 "${store.name}" 缺少坐标信息`)
        continue
      }

      const result = await calculatePopulationByRadius(lat, lng, radiusMeters, statField, getShapefiles)
      allResults.push({
        ...store,
        total: result.total,
        statField,
        allFields: result.allFields
      })
    }

    if (allResults.length < 2) {
      ElMessage.warning('有效门店数量不足，请检查门店坐标')
      compareLoading.value = false
      return
    }

    compareResults.value = allResults

    // 构建对比表格数据
    const fieldNames = [statField, ...Object.keys(allResults[0].allFields || {}).filter(k => k !== statField)]
    compareTableData.value = fieldNames.map(field => {
      const values = allResults.map(r => {
        if (field === statField) return formatNumber(r.total)
        return formatNumber(r.allFields?.[field] || 0)
      })

      const nums = allResults.map(r => {
        if (field === statField) return r.total
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

// 计算热力图单元格颜色（使用分位数分级，确保颜色分布均匀）
const getHeatmapCellStyle = (nums, idx, maxIdx) => {
  if (!nums || nums.length === 0) {
    return { background: '#f5f5f5', color: '#333' }
  }

  // 过滤无效值
  const validNums = nums.map(n => Math.abs(Number(n) || 0))
  const maxVal = Math.max(...validNums)
  const minVal = Math.min(...validNums)
  const range = maxVal - minVal

  if (range === 0) {
    // 所有值相同，返回中等颜色
    return { background: '#ffffbf', color: '#333' }
  }

  // 归一化到 0-1
  const normalized = (validNums[idx] - minVal) / range

  // 使用蓝-绿-黄-橙-红 配色方案
  // #2b83f6 (蓝) → #abdda4 (绿) → #ffffbf (黄) → #fdae61 (橙) → #d7191c (红)
  const colors = [
    { pos: 0, r: 43, g: 131, b: 246 },    // 蓝
    { pos: 0.25, r: 171, g: 221, b: 164 }, // 绿
    { pos: 0.5, r: 255, g: 255, b: 191 },  // 黄
    { pos: 0.75, r: 253, g: 174, b: 97 },  // 橙
    { pos: 1, r: 215, g: 25, b: 28 }       // 红
  ]

  // 找到对应的颜色区间
  let c1, c2, t
  for (let i = 0; i < colors.length - 1; i++) {
    if (normalized >= colors[i].pos && normalized <= colors[i + 1].pos) {
      c1 = colors[i]
      c2 = colors[i + 1]
      t = (normalized - c1.pos) / (c2.pos - c1.pos)
      break
    }
  }

  if (!c1) {
    c1 = colors[0]
    c2 = colors[0]
    t = 0
  }

  // 线性插值
  const r = Math.round(c1.r + (c2.r - c1.r) * t)
  const g = Math.round(c1.g + (c2.g - c1.g) * t)
  const b = Math.round(c1.b + (c2.b - c1.b) * t)

  // 文字颜色：浅色背景用深色字，深色背景用白色字
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  const textColor = brightness > 150 ? '#333' : '#fff'

  return {
    background: `rgb(${r}, ${g}, ${b})`,
    color: textColor
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
        itemStyle: { color: '#409EFF' },
        data: fields.map(f => f === r1.statField ? r1.total : (r1.allFields?.[f] || 0)),
        label: { show: true, position: 'top', formatter: (p) => formatNumber(p.value), fontSize: 10 }
      },
      {
        name: r2.name,
        type: 'bar',
        barGap: '5%',
        itemStyle: { color: '#67C23A' },
        data: fields.map(f => f === r2.statField ? r2.total : (r2.allFields?.[f] || 0)),
        label: { show: true, position: 'top', formatter: (p) => formatNumber(p.value), fontSize: 10 }
      }
    ]
  }

  barChart.setOption(option)
}

// 窗口大小变化时重绘柱状图
window.addEventListener('resize', () => {
  if (barChart) {
    barChart.resize()
  }
})

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
  const districts = [...new Set(markerStore.markers.map(m => m.district).filter(Boolean))]
  return districts.sort()
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
    return matchKeyword && matchType && matchCity && matchDistrict && matchCategory && matchBrand
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
    filterDistrict.value || filterStoreCategory.value || filterBrand.value
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
  markerStore.clearFilters()
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

// 全清除
const handleClearAll = async () => {
  try {
    await ElMessageBox.confirm(
      '此操作将清空您所有的门店数据，不可恢复！确定继续吗？',
      '危险操作',
      { type: 'warning', confirmButtonText: '确定清空', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
    const result = await markerStore.clearAllMarkers()
    if (result.success) {
      ElMessage.success(`已清空 ${result.count} 条门店数据`)
      tableRef.value?.clearSelection()
      selectedRows.value = []
      // 重置筛选条件
      markerStore.clearFilters()
    } else {
      ElMessage.error(result.message)
    }
  } catch {}
}

// 定位
const handleLocate = (row) => {
  router.push({ path: '/', query: { lat: row.latitude, lng: row.longitude, id: row.id } })
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
  try {
    const result = await markerStore.importMarkers(uploadFile.value)
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
  const template = `store_code,brand,name,store_type,city,district,area_manager,phone1,store_manager,phone2,address,open_date,business_hours,area,seats,rent,store_category,contact_person,contact_phone,latitude,longitude,description
BJ001,星巴克,星巴克国贸店,已开业,北京市,朝阳区,李明,13800138001,王芳,13800138002,国贸大厦一层,2023-01-15,07:00-22:00,200,80,50000,直营,张总,13900139001,39.9088,116.4610,CBD核心区
BJ002,星巴克,星巴克望京候选,重点候选,北京市,朝阳区,李明,13800138001,,,,,180,70,42000,加盟,陈总,13900139003,39.9965,116.4710,重点跟进`
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
  // 从 store 恢复筛选条件
  searchKeyword.value = markerStore.filters.searchKeyword
  filterStoreType.value = markerStore.filters.filterStoreType
  filterCity.value = markerStore.filters.filterCity
  filterDistrict.value = markerStore.filters.filterDistrict
  filterStoreCategory.value = markerStore.filters.filterStoreCategory
  filterBrand.value = markerStore.filters.filterBrand
  // 获取门店购买次数
  await fetchStorePurchaseCounts()
  console.log('✅ 购买次数获取完成')

  // 注册全局函数：AI助手调用人口对比
  window.openPopulationCompare = (storeIds, radius) => {
    if (!storeIds || storeIds.length < 2) return

    // 预选门店
    const storesToSelect = storeIds
      .map(id => markerStore.markers.find(m => m.id === id))
      .filter(Boolean)

    if (storesToSelect.length < 2) {
      ElMessage.warning('有效门店不足2家，无法进行对比')
      return
    }

    // 设置半径
    compareRadius.value = radius || 2

    // 预选门店
    selectedCompareStoresState.list = storesToSelect.map(s => ({ ...s }))

    // 打开对话框
    showPopulationCompareDialog()
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
