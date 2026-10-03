import { defineStore } from 'pinia'
import axios from 'axios'
import { buildIconMap, currentSelfId, resolveSource } from '@/utils/brandIcons'

const API_URL = '/api'

export const useBrandIconStore = defineStore('brandIcon', {
  state: () => ({
    icons: [],         // [{id, brand, filename, original_name, created_at, user_id}]
    loading: false
  }),

  getters: {
    /**
     * ⭐ 品牌 → **生效的**那一行图标（`{ [brand]: icon }`）。
     *
     * v1.13.191 起这是全站**唯一口径**：`我(self) > 集团(group) > admin`。
     * 加集团继承前，同一品牌的两处取法不一致（设置图标页 `.find()`＝第一条胜、
     * 地图 `forEach`＝最后一条胜），且后端对并列行未定序 ⇒「谁生效」原本碰运气。
     * 地图渲染 / 设置图标页 / 截图导出**都必须**走它，⛔ 别再用 icons.find / forEach。
     * 详见 `utils/brandIcons.js` 文件头。
     */
    byBrand: (state) => buildIconMap(state.icons, currentSelfId()),

    // 按品牌名取「生效」的图标（无 ⇒ null）
    getIconByBrand() {
      return (brand) => this.byBrand[brand] || null
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
        // ⚠️ v1.13.191：定位必须带上「是我自己的那一行」（source==='self'）。
        //    集团继承后同一品牌可能并列着 集团/ admin 的行，只按 brand 找会**顶掉集团那行**
        //    （表现为：上传后集团图标凭空消失、删自己的也回退不回去，直到刷新页面）。
        if (data.success && data.icon) {
          const selfId = currentSelfId()
          const idx = this.icons.findIndex(
            i => i.brand === brand && resolveSource(i, selfId) === 'self'
          )
          if (idx >= 0) {
            // 使用 splice 替换元素，确保响应式更新
            this.icons.splice(idx, 1, data.icon)
          } else {
            // 自己没有该品牌的图标（可能只有集团/ admin 的）⇒ 追加，别动别人的行
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
