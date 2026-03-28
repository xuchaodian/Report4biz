import { defineStore } from 'pinia'
import axios from 'axios'

const API_URL = '/api'

export const useBrandIconStore = defineStore('brandIcon', {
  state: () => ({
    icons: [],         // [{id, user_id, brand, filename, original_name, created_at}]
    loading: false
  }),

  // 根据品牌名快速查找图标
  getIconByBrand: (brand) => {
    return (state) => state.icons.find(icon => icon.brand === brand)
  },

  actions: {
    async fetchBrandIcons() {
      this.loading = true
      try {
        const { data } = await axios.get(`${API_URL}/brand-icons`)
        this.icons = data.icons || []
      } catch (error) {
        console.error('获取品牌图标失败:', error)
        this.icons = []
      } finally {
        this.loading = false
      }
    },

    async uploadBrandIcon(brand, file) {
      const formData = new FormData()
      formData.append('brand', brand)
      formData.append('icon', file)

      const { data } = await axios.post(`${API_URL}/brand-icons`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      if (data.success) {
        // 更新本地数据
        const idx = this.icons.findIndex(i => i.brand === brand)
        if (idx >= 0) {
          this.icons[idx] = data.icon
        } else {
          this.icons.push(data.icon)
        }
        this.icons.sort((a, b) => a.brand.localeCompare(b.brand))
      }

      return data
    },

    async deleteBrandIcon(id) {
      const { data } = await axios.delete(`${API_URL}/brand-icons/${id}`)
      if (data.success) {
        this.icons = this.icons.filter(i => i.id !== id)
      }
      return data
    }
  }
})
