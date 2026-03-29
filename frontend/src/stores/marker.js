import { defineStore } from 'pinia'
import axios from 'axios'

const API_URL = '/api'

export const useMarkerStore = defineStore('marker', {
  state: () => ({
    markers: [],
    loading: false,
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
      filterBrand: ''
    }
  }),
  
  actions: {
    async fetchMarkers() {
      this.loading = true
      try {
        const { data } = await axios.get(`${API_URL}/markers`)
        this.markers = data.markers
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
    
    async importMarkers(file) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        const { data } = await axios.post(`${API_URL}/markers/import`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
        this.markers = [...this.markers, ...data.imported]
        return { success: true, count: data.count }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '导入失败' }
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
        filterBrand: ''
      }
      this.visibleIds = null
    }
  }
})
