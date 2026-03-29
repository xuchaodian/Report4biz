import { defineStore } from 'pinia'
import axios from 'axios'

const API_URL = '/api'

export const useBrandIconStore = defineStore('brandIcon', {
  state: () => ({
    icons: [],         // [{id, brand, filename, original_name, created_at, user_id}]
    loading: false
  }),

  getters: {
    // 根据品牌名快速查找图标
    getIconByBrand: (state) => (brand) => {
      return state.icons.find(icon => icon.brand === brand)
    }
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
      try {
        const formData = new FormData()
        formData.append('brand', brand)
        formData.append('icon', file)

        // 不设置 Content-Type，让 axios 自动处理 multipart/form-data 的 boundary
        const { data } = await axios.post(`${API_URL}/brand-icons`, formData)

        // 更新本地数据（使用 splice 触发响应式更新）
        if (data.success && data.icon) {
          const idx = this.icons.findIndex(i => i.brand === brand)
          if (idx >= 0) {
            // 使用 splice 替换元素，确保响应式更新
            this.icons.splice(idx, 1, data.icon)
          } else {
            this.icons.push(data.icon)
          }
          // 排序
          this.icons.sort((a, b) => a.brand.localeCompare(b.brand))
        }

        return data
      } catch (error) {
        console.error('上传品牌图标失败:', error)
        // 返回统一格式的错误信息
        return {
          success: false,
          message: error.response?.data?.message || error.message || '上传失败，请重试'
        }
      }
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
