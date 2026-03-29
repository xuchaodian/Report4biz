import { defineStore } from 'pinia'
import axios from 'axios'

const API_URL = '/api'

export const useCompetitorStore = defineStore('competitor', {
  state: () => ({
    competitors: [],
    loading: false,
    statuses: ['正常', '关闭', '装修中', '未知'],
    storeTypes: ['竞品', '其他']
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
    
    async importCompetitors(file) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        const { data } = await axios.post(`${API_URL}/competitors/import`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
        this.competitors = [...this.competitors, ...data.imported]
        return { success: true, count: data.count }
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
    }
  }
})
