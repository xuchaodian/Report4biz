import { defineStore } from 'pinia'
import axios from 'axios'
// 快照相关请求统一走共享 api 实例（含 token 拦截器 / 401 跳登录）——项目 HTTP 规范 v1.13.77
import api from '../utils/api.js'

const API_URL = '/api'

export const useCompetitorStore = defineStore('competitor', {
  state: () => ({
    competitors: [],
    loading: false,
    statuses: ['正常', '关闭', '装修中', '未知'],
    storeTypes: ['竞品', '其他'],
    // visibleIds: null = 显示全部；数组 = 仅显示这些ID
    visibleIds: null,
    // 筛选条件（持久化，切换页面后保留）
    filters: {
      searchKeyword: '',
      filterCity: '',
      filterDistrict: '',
      filterTradingArea: '',
      filterBrand: '',
      filterCategory: ''
    }
  }),
  
  actions: {
    async fetchCompetitors() {
      this.loading = true
      try {
        const { data } = await axios.get(`${API_URL}/competitors`)
        console.log('API返回数据:', data)
        this.competitors = data.competitors || []
        console.log('竞品列表已更新, 数量:', this.competitors.length)
      } catch (error) {
        console.error('获取竞品门店失败:', error)
        console.error('错误详情:', error.response?.data)
        this.competitors = []
      } finally {
        this.loading = false
      }
    },
    
    async addCompetitor(competitor) {
      try {
        const { data } = await axios.post(`${API_URL}/competitors`, competitor)
        this.competitors.push(data.competitor)
        return { success: true }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '添加失败' }
      }
    },
    
    async updateCompetitor(id, competitor) {
      try {
        const { data } = await axios.put(`${API_URL}/competitors/${id}`, competitor)
        const index = this.competitors.findIndex(c => c.id === id)
        if (index !== -1) {
          this.competitors[index] = data.competitor
        }
        return { success: true }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '更新失败' }
      }
    },
    
    async deleteCompetitor(id) {
      try {
        await axios.delete(`${API_URL}/competitors/${id}`)
        this.competitors = this.competitors.filter(c => c.id !== id)
        return { success: true }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '删除失败' }
      }
    },

    async batchDeleteCompetitors(ids) {
      try {
        await axios.post(`${API_URL}/competitors/batch-delete`, { ids })
        this.competitors = this.competitors.filter(c => !ids.includes(c.id))
        return { success: true, count: ids.length }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '批量删除失败' }
      }
    },

    async clearAllCompetitors() {
      try {
        const { data } = await axios.delete(`${API_URL}/competitors/clear-all`)
        this.competitors = []
        return { success: true, count: data.count }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '清空失败' }
      }
    },
    
    async importCompetitors(file, onProgress) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        const response = await axios.post(`${API_URL}/competitors/import`, formData, { timeout: 300000, onUploadProgress: onProgress })
        const { data } = response
        await this.fetchCompetitors()
        return { success: true, count: data.count || 0 }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '导入失败' }
      }
    },
    
    async exportCompetitors() {
      try {
        const { data } = await axios.get(`${API_URL}/competitors/export`)
        return { success: true, data: data }
      } catch (error) {
        return { success: false, message: '导出失败' }
      }
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
        filterTradingArea: '',
        filterBrand: '',
        filterCategory: ''
      }
      this.visibleIds = null
    },

    /* ================= 竞品期次快照（开关店监测 · P0） =================
     * 统一走共享 api 实例：响应拦截器已解包 response.data（成功直接返回 body），
     * 失败 reject → 调用方 try/catch 取 error.response.data.message。
     */
    // 快照品牌序列（含各期元信息）
    async listSnapshotBrands() {
      try {
        const data = await api.get('/competitors/snapshots')
        return { success: true, data }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '获取快照列表失败' }
      }
    },
    // 单品牌快照序列
    async listBrandSnapshots(brand) {
      try {
        const data = await api.get('/competitors/snapshots', { params: { brand } })
        return { success: true, data }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '获取品牌快照失败' }
      }
    },
    // 解析预览（不落库）
    async previewSnapshot({ brand, period, file }) {
      try {
        const fd = new FormData()
        fd.append('brand', brand)
        fd.append('period', period)
        fd.append('file', file)
        const data = await api.post('/competitors/snapshots/preview', fd, { timeout: 120000 })
        return { success: true, data }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '预览失败' }
      }
    },
    // 正式导入（含收编勾选）
    async importSnapshot({ brand, period, file, adoptIds, dataVersion }) {
      try {
        const fd = new FormData()
        fd.append('brand', brand)
        fd.append('period', period)
        fd.append('file', file)
        fd.append('adoptIds', JSON.stringify(adoptIds || []))
        if (dataVersion) fd.append('data_version', dataVersion)
        const data = await api.post('/competitors/snapshots/import', fd, { timeout: 300000 })
        return { success: true, data }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '导入失败' }
      }
    },
    // 两期 diff
    async diffSnapshots({ brand, target, base }) {
      try {
        const params = { brand, target }
        if (base) params.base = base
        const data = await api.get('/competitors/snapshots/diff', { params })
        return { success: true, data }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '对比失败' }
      }
    },
    // 下载某期全量 CSV（blob）
    async exportSnapshotCsv({ brand, period }) {
      try {
        const blob = await api.get('/competitors/snapshots/export', { params: { brand, period }, responseType: 'blob' })
        return { success: true, blob }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '导出失败' }
      }
    },
    // 下载变更明细 CSV（blob）
    async exportDiffCsv({ brand, target, base }) {
      try {
        const params = { brand, target }
        if (base) params.base = base
        const blob = await api.get('/competitors/snapshots/export-diff', { params, responseType: 'blob' })
        return { success: true, blob }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '导出失败' }
      }
    }
  }
})
