import { defineStore } from 'pinia'
import api from '../utils/api.js'

const API_URL = '/api'

// v1.13.103 H2：会话内去重——60s 新鲜期内不重复拉全量（品牌门店 9000+ 条）；在途合并；force=true 强制刷新
const FRESH_MS = 60 * 1000
let brandStoresInFlight = null

export const useBrandStoreStore = defineStore('brandStore', {
  state: () => ({
    brandStores: [],
    loading: false,
    loaded: false,
    loadedAt: 0,
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
    async fetchBrandStores(force = false) {
      if (!force && this.loaded && this.loadedAt && Date.now() - this.loadedAt < FRESH_MS) return
      if (brandStoresInFlight) return brandStoresInFlight
      this.loading = true
      brandStoresInFlight = this._fetchBrandStores()
      try {
        await brandStoresInFlight
      } finally {
        brandStoresInFlight = null
      }
    },

    async _fetchBrandStores() {
      try {
        const data = await api.get('/brand-stores')
        this.brandStores = data.brandStores || []
        this.loaded = true
        this.loadedAt = Date.now()
      } catch (error) {
        console.error('获取品牌门店列表失败:', error)
        this.brandStores = []
      } finally {
        this.loading = false
      }
    },

    async addBrandStore(store) {
      const data = await api.post('/brand-stores', store)
      if (data.success !== false) {
        this.brandStores.unshift(data.brandStore)
      }
      return data
    },

    async updateBrandStore(id, store) {
      const data = await api.put(`/brand-stores/${id}`, store)
      if (data.success !== false) {
        const idx = this.brandStores.findIndex(s => s.id === id)
        if (idx >= 0) this.brandStores[idx] = data.brandStore
      }
      return data
    },

    async deleteBrandStore(id) {
      const data = await api.delete(`/brand-stores/${id}`)
      if (data.success !== false) {
        this.brandStores = this.brandStores.filter(s => s.id !== id)
      }
      return data
    },

    async batchDeleteBrandStores(ids) {
      try {
        await api.post('/brand-stores/batch-delete', { ids })
        this.brandStores = this.brandStores.filter(s => !ids.includes(s.id))
        return { success: true, count: ids.length }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '批量删除失败' }
      }
    },

    async clearAllBrandStores() {
      try {
        const data = await api.delete('/brand-stores/clear-all')
        this.brandStores = []
        return { success: true, count: data.count }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '清空失败' }
      }
    },

    async importBrandStores(file, onProgress) {
      const formData = new FormData()
      formData.append('file', file)
      const data = await api.post('/brand-stores/import', formData, { timeout: 300000, onUploadProgress: onProgress })
      return data
    },

    async exportBrandStores() {
      const data = await api.get('/brand-stores/export')
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
