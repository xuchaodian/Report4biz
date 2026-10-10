import { defineStore } from 'pinia'
import api from '../utils/api.js'

const API_URL = '/api'

// v1.13.103 H2：会话内去重——60s 新鲜期内不重复拉全量（品牌门店 9000+ 条）；在途合并；force=true 强制刷新
const FRESH_MS = 60 * 1000
let brandStoresInFlight = null

// v1.13.193：地图「显示门店 → 品牌门店 → 显示品牌」的图层品牌勾选。
// 按 userId 命名，换账号不串档（与 markerFilters_ / competitorFilters_ 同惯例）。
const LAYER_KEY = () => `brandLayerFilter_${localStorage.getItem('userId') || 'anon'}`

export const useBrandStoreStore = defineStore('brandStore', {
  state: () => ({
    brandStores: [],
    loading: false,
    loaded: false,
    loadedAt: 0,
    // visibleIds: null = 显示全部；数组 = 仅显示这些ID（空数组 = 0 条）
    visibleIds: null,
    // v1.13.193 layerBrands: null = 全部品牌；数组 = 仅显示这些品牌（空数组 = 0 条）
    // ⚠️ 与 visibleIds 刻意分离：「定位门店」面板的单选筛选走 visibleIds，
    //    本面板的复选走 layerBrands，两者做 AND —— 若共用 visibleIds 会互相覆盖。
    layerBrands: null,
    // v1.13.196：是否「已选择过」——用于区分「从未选过」（首次打开开关时弹层让用户勾选、不默认全量）
    // 与「选满 ⇒ 存 null（= 全部）」。仅凭 layerBrands === null 无法区分这两者。
    layerBrandsInitialized: false,
    // 筛选条件（持久化，切换页面后保留）
    filters: {
      searchKeyword: '',
      filterCity: '',
      filterDistrict: '',
      filterBrand: '',
      filterCategory: ''
    }
  }),

  getters: {
    // v1.13.193：地图图层 / 统一聚合 / 热力图 / 网点优化 / 截图导出的**唯一**可见域口径。
    // 原实现 5 处各写一遍三元过滤，且两套口径不一致（聚合与热力图把「空数组」当
    // 「无筛选 ⇒ 显示全部」，建图层却当「0 条」）—— 收成单一函数后口径统一为：
    // visibleIds 为 null/undefined ⇒ 不限；否则按数组过滤（空数组 = 0 条）。品牌维度同理。
    visibleStores(state) {
      let list = state.brandStores
      const vids = state.visibleIds
      if (vids !== null && vids !== undefined) {
        const idSet = new Set(vids)
        list = list.filter(s => idSet.has(s.id))
      }
      const brands = state.layerBrands
      if (brands !== null && brands !== undefined) {
        const brandSet = new Set(brands)
        list = list.filter(s => brandSet.has(s.brand))
      }
      return list
    }
  },

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

    // v1.13.193：从 localStorage 恢复图层品牌勾选（按 userId 命名）。
    // 刻意不在 state 初始化时读——store 可能先于登录创建，那时 uid 还是空的。
    initLayerBrands() {
      try {
        const raw = localStorage.getItem(LAYER_KEY())
        if (!raw) return
        const arr = JSON.parse(raw)
        this.layerBrands = Array.isArray(arr) ? arr : null
        this.layerBrandsInitialized = true   // v1.13.196：key 存在即代表「用户选择过」（存 null 亦算）
      } catch (e) {
        this.layerBrands = null
      }
    },

    // v1.13.193：设置图层品牌勾选。选满当前全部品牌 ⇒ 存 null（=「全部」不再是一次性快照，
    // 将来新增品牌会自动纳入）；未选满 ⇒ 存数组（空数组 = 全不选）。
    setLayerBrands(brands) {
      const all = [...new Set(this.brandStores.map(s => s.brand).filter(Boolean))]
      const arr = Array.isArray(brands) ? [...new Set(brands)] : []
      const value = (all.length > 0 && arr.length >= all.length) ? null : arr
      this.layerBrands = value
      this.layerBrandsInitialized = true    // v1.13.196：写过即算「已选择过」
      try {
        localStorage.setItem(LAYER_KEY(), JSON.stringify(value))
      } catch (e) {
        // localStorage 不可用（隐私模式/配额满）⇒ 仅本次会话生效
      }
    },

    // 设置筛选条件
    setFilters(filters) {
      this.filters = { ...this.filters, ...filters }
    },

    // 清除所有筛选条件
    // ⚠️ 刻意不动 layerBrands：那是「图层显示哪些品牌」的独立维度，与内容筛选无关
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
