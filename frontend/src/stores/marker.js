import { defineStore } from 'pinia'
import axios from 'axios'

const API_URL = '/api'

export const useMarkerStore = defineStore('marker', {
  state: () => ({
    markers: [],
    loading: false,
    categories: ['门店', '设备', '人员', '仓库', '站点'],
    statuses: ['正常', '告警', '维护', '停用']
  }),
  
  actions: {
    async fetchMarkers() {
      this.loading = true
      try {
        const { data } = await axios.get(`${API_URL}/markers`)
        this.markers = data.markers
      } catch (error) {
        console.error('获取点位失败:', error)
      } finally {
        this.loading = false
      }
    },
    
    async addMarker(marker) {
      try {
        const { data } = await axios.post(`${API_URL}/markers`, marker)
        this.markers.push(data.marker)
        return { success: true }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '添加失败' }
      }
    },
    
    async updateMarker(id, marker) {
      try {
        const { data } = await axios.put(`${API_URL}/markers/${id}`, marker)
        const index = this.markers.findIndex(m => m.id === id)
        if (index !== -1) {
          this.markers[index] = data.marker
        }
        return { success: true }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '更新失败' }
      }
    },
    
    async deleteMarker(id) {
      try {
        await axios.delete(`${API_URL}/markers/${id}`)
        this.markers = this.markers.filter(m => m.id !== id)
        return { success: true }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '删除失败' }
      }
    },
    
    async importMarkers(file) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        const { data } = await axios.post(`${API_URL}/markers/import`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
        this.markers = [...this.markers, ...data.imported]
        return { success: true, count: data.count }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '导入失败' }
      }
    },
    
    async exportMarkers() {
      try {
        const { data } = await axios.get(`${API_URL}/markers/export`)
        return { success: true, data: data }
      } catch (error) {
        return { success: false, message: '导出失败' }
      }
    }
  }
})
