import { defineStore } from 'pinia'
import axios from 'axios'

const API_URL = '/api'

// v1.13.103 H2：会话内去重——60s 新鲜期内不重复拉全量（地图进出/切页高频触发会重复下 1900+ 门店）；
// 在途请求合并（并发调用共用同一 Promise）；force=true 强制刷新（导入/上传/显式刷新按钮）
const FRESH_MS = 60 * 1000
let markersInFlight = null

export const useMarkerStore = defineStore('marker', {
  state: () => ({
    markers: [],
    loading: false,
    loaded: false,       // 是否已成功加载过
    loadedAt: 0,         // 最近成功加载时间戳（新鲜期判断）
    categories: ['门店', '设备', '人员', '仓库', '站点'],
    statuses: ['正常', '告警', '维护', '停用'],
    storeTypes: ['已开业', '重点候选', '一般候选'],
    storeCategories: ['社区店', '临街店', '商场店', '写字楼店', '交通枢纽店', '校园店', '景区店', '专业市场店'],
    // visibleIds: null = 显示全部；数组 = 仅显示这些ID（用于地图联动筛选）
    visibleIds: null,
    // 筛选条件（持久化，切换页面后保留）
    filters: {
      searchKeyword: '',
      filterStoreType: '',
      filterCity: '',
      filterDistrict: '',
      filterStoreCategory: '',
      filterBrand: '',
      filterStoreStatus: [],
      filterMallType: ''
    }
  }),
  
  actions: {
    async fetchMarkers(force = false) {
      if (!force && this.loaded && this.loadedAt && Date.now() - this.loadedAt < FRESH_MS) return
      if (markersInFlight) return markersInFlight
      this.loading = true
      markersInFlight = this._fetchMarkers()
      try {
        await markersInFlight
      } finally {
        markersInFlight = null
      }
    },

    async _fetchMarkers() {
      try {
        const { data } = await axios.get(`${API_URL}/markers`)
        this.markers = data.markers
        this.loaded = true
        this.loadedAt = Date.now()
      } catch (error) {
        console.error('获取点位失败:', error)
      } finally {
        this.loading = false
      }
    },
    
    async addMarker(marker) {
      try {
        const { data } = await axios.post(`${API_URL}/markers`, marker)
        this.markers.push(data.marker)
        return { success: true }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '添加失败' }
      }
    },
    
    async updateMarker(id, marker) {
      try {
        const { data } = await axios.put(`${API_URL}/markers/${id}`, marker)
        const index = this.markers.findIndex(m => m.id === id)
        if (index !== -1) {
          this.markers[index] = data.marker
        }
        return { success: true }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '更新失败' }
      }
    },
    
    async deleteMarker(id) {
      try {
        await axios.delete(`${API_URL}/markers/${id}`)
        this.markers = this.markers.filter(m => m.id !== id)
        return { success: true }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '删除失败' }
      }
    },

    async batchDeleteMarkers(ids) {
      try {
        await axios.post(`${API_URL}/markers/batch-delete`, { ids })
        this.markers = this.markers.filter(m => !ids.includes(m.id))
        return { success: true, count: ids.length }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '批量删除失败' }
      }
    },

    async clearAllMarkers() {
      try {
        const { data } = await axios.delete(`${API_URL}/markers/clear-all`)
        this.markers = []
        return { success: true, count: data.count }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '清空失败' }
      }
    },
    
    async importMarkers(file, onProgress) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        const response = await axios.post(`${API_URL}/markers/import`, formData, { timeout: 300000, onUploadProgress: onProgress })
        const { data } = response
        // 重新从服务器拉取完整列表（后端不返回 imported 数组）；导入后强制刷新，绕过新鲜期
        await this.fetchMarkers(true)
        return { success: true, count: data.count || 0 }
      } catch (error) {
        console.error('[导入] 捕获异常:', error.message, error.response?.data || error.code)
        if (error.code === 'ECONNABORTED') {
          return { success: false, message: '导入超时，请重试（数据可能已导入，刷新页面查看）' }
        }
        return { success: false, message: error.response?.data?.message || error.message || '导入失败' }
      }
    },
    
    async exportMarkers() {
      try {
        const { data } = await axios.get(`${API_URL}/markers/export`)
        return { success: true, data: data }
      } catch (error) {
        return { success: false, message: '导出失败' }
      }
    },

    // 批量地理编码（调用高德API，将地址转换为坐标）
    async batchGeocode(addresses) {
      try {
        const { data } = await axios.post(`${API_URL}/poi/batch-geocode`, { addresses })
        return { success: true, ...data }
      } catch (error) {
        return { success: false, message: error.response?.data?.error || '地理编码失败' }
      }
    },

    // 设置地图可见ID列表（null=全部，数组=仅这些ID）
    setVisibleIds(ids) {
      this.visibleIds = ids
    },

    // 设置筛选条件
    setFilters(filters) {
      this.filters = { ...this.filters, ...filters }
    },

    // 清除所有筛选条件
    clearFilters() {
      this.filters = {
        searchKeyword: '',
        filterStoreType: '',
        filterCity: '',
        filterDistrict: '',
        filterStoreCategory: '',
        filterBrand: '',
        filterStoreStatus: [],
        filterMallType: ''
      }
      this.visibleIds = null
    }
  }
})
