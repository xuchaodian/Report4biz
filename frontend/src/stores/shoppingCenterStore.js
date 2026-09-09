import { defineStore } from 'pinia'
import api from '../utils/api.js'

// v1.13.103 H2：会话内去重——60s 新鲜期内不重复拉全量；在途合并；force=true 强制刷新
const FRESH_MS = 60 * 1000
let shoppingCentersInFlight = null

export const useShoppingCenterStore = defineStore('shoppingCenter', {
  state: () => ({
    shoppingCenters: [],
    loading: false,
    loaded: false,
    loadedAt: 0,
    // visibleIds: null = 显示全部；数组 = 仅显示这些ID
    visibleIds: null,
    filters: {
      searchKeyword: '',
      filterCity: '',
      filterDistrict: '',
      filterCategory: ''
    }
  }),

  actions: {
    async fetchShoppingCenters(force = false) {
      if (!force && this.loaded && this.loadedAt && Date.now() - this.loadedAt < FRESH_MS) return
      if (shoppingCentersInFlight) return shoppingCentersInFlight
      this.loading = true
      shoppingCentersInFlight = this._fetchShoppingCenters()
      try {
        await shoppingCentersInFlight
      } finally {
        shoppingCentersInFlight = null
      }
    },

    async _fetchShoppingCenters() {
      try {
        const data = await api.get('/shopping-centers')
        this.shoppingCenters = data.shoppingCenters || []
        this.loaded = true
        this.loadedAt = Date.now()
      } catch (error) {
        console.error('获取购物中心列表失败:', error)
        this.shoppingCenters = []
      } finally {
        this.loading = false
      }
    },

    async addShoppingCenter(item) {
      const data = await api.post('/shopping-centers', item)
      if (data.success !== false) {
        this.shoppingCenters.unshift(data.shoppingCenter)
      }
      return data
    },

    async updateShoppingCenter(id, item) {
      const data = await api.put(`/shopping-centers/${id}`, item)
      if (data.success !== false) {
        const idx = this.shoppingCenters.findIndex(s => s.id === id)
        if (idx >= 0) this.shoppingCenters[idx] = data.shoppingCenter
      }
      return data
    },

    async deleteShoppingCenter(id) {
      const data = await api.delete(`/shopping-centers/${id}`)
      if (data.success !== false) {
        this.shoppingCenters = this.shoppingCenters.filter(s => s.id !== id)
      }
      return data
    },

    async batchDeleteShoppingCenters(ids) {
      try {
        await api.post('/shopping-centers/batch-delete', { ids })
        this.shoppingCenters = this.shoppingCenters.filter(s => !ids.includes(s.id))
        return { success: true, count: ids.length }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '批量删除失败' }
      }
    },

    async clearAllShoppingCenters() {
      try {
        const data = await api.delete('/shopping-centers/clear-all')
        this.shoppingCenters = []
        return { success: true, count: data.count }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '清空失败' }
      }
    },

    async importShoppingCenters(file, onProgress) {
      const formData = new FormData()
      formData.append('file', file)
      const data = await api.post('/shopping-centers/import', formData, { timeout: 300000, onUploadProgress: onProgress })
      return data
    },

    async exportShoppingCenters() {
      const data = await api.get('/shopping-centers/export')
      return data
    },

    setFilters(filters) {
      this.filters = { ...this.filters, ...filters }
    },

    clearFilters() {
      this.filters = {
        searchKeyword: '',
        filterCity: '',
        filterDistrict: '',
        filterCategory: ''
      }
    },

    setVisibleIds(ids) {
      this.visibleIds = ids
    }
  }
})
