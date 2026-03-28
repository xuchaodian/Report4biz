import { defineStore } from 'pinia'
import axios from 'axios'

const API_URL = '/api'

export const useBrandStoreStore = defineStore('brandStore', {
  state: () => ({
    brandStores: [],
    loading: false
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
    }
  }
})
