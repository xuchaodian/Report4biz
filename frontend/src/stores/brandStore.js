import { defineStore } from 'pinia'
import axios from 'axios'

const API_URL = '/api'

export const useBrandStoreStore = defineStore('brandStore', {
  state: () => ({
    brandStores: [],
    loading: false,
    // visibleIds: null = 显示全部；数组 = 仅显示这些ID
    visibleIds: null,
    // 筛选条件（持久化，切换页面后保留）
    filters: {
      searchKeyword: '',
      filterCity: '',
      filterDistrict: '',
      filterBrand: '',
      filterCategory: ''
    }
  }),

  actions: {
    async fetchBrandStores() {
      this.loading = true
      try {
        const { data } = await axios.get(`${API_URL}/brand-stores`)
        this.brandStores = data.brandStores || []
      } catch (error) {
        console.error('获取品牌门店列表失败:', error)
        this.brandStores = []
      } finally {
        this.loading = false
      }
    },

    async addBrandStore(store) {
      const { data } = await axios.post(`${API_URL}/brand-stores`, store)
      if (data.success !== false) {
        this.brandStores.unshift(data.brandStore)
      }
      return data
    },

    async updateBrandStore(id, store) {
      const { data } = await axios.put(`${API_URL}/brand-stores/${id}`, store)
      if (data.success !== false) {
        const idx = this.brandStores.findIndex(s => s.id === id)
        if (idx >= 0) this.brandStores[idx] = data.brandStore
      }
      return data
    },

    async deleteBrandStore(id) {
      const { data } = await axios.delete(`${API_URL}/brand-stores/${id}`)
      if (data.success !== false) {
        this.brandStores = this.brandStores.filter(s => s.id !== id)
      }
      return data
    },

    async batchDeleteBrandStores(ids) {
      try {
        await axios.post(`${API_URL}/brand-stores/batch-delete`, { ids })
        this.brandStores = this.brandStores.filter(s => !ids.includes(s.id))
        return { success: true, count: ids.length }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '批量删除失败' }
      }
    },

    async clearAllBrandStores() {
      try {
        const { data } = await axios.delete(`${API_URL}/brand-stores/clear-all`)
        this.brandStores = []
        return { success: true, count: data.count }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '清空失败' }
      }
    },

    async importBrandStores(file) {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await axios.post(`${API_URL}/brand-stores/import`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      return data
    },

    async exportBrandStores() {
      const { data } = await axios.get(`${API_URL}/brand-stores/export`)
      return data
    },

    // 设置地图可见ID列表
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
        filterCity: '',
        filterDistrict: '',
        filterBrand: '',
        filterCategory: ''
      }
      this.visibleIds = null
    }
  }
})
