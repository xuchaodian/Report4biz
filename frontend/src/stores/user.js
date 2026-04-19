import { defineStore } from 'pinia'
import axios from 'axios'

const API_URL = '/api'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: sessionStorage.getItem('token') || '',
    user: null,
    loading: false,
    quota: null // 配额信息 { total, used, available }
  }),
  
  getters: {
    isLoggedIn: (state) => !!state.token,
    isAdmin: (state) => state.user?.role === 'admin',
    username: (state) => state.user?.username || '',
    availableQuota: (state) => state.quota?.available ?? 0
  },
  
  actions: {
    async login(username, password) {
      this.loading = true
      try {
        const { data } = await axios.post(`${API_URL}/auth/login`, { username, password })
        this.token = data.token
        this.user = data.user
        sessionStorage.setItem('token', data.token)
        axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
        // 登录后获取配额
        await this.fetchQuota()
        return { success: true }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '登录失败' }
      } finally {
        this.loading = false
      }
    },
    
    async register(username, email, password) {
      this.loading = true
      try {
        await axios.post(`${API_URL}/auth/register`, { username, email, password })
        return { success: true }
      } catch (error) {
        return { success: false, message: error.response?.data?.message || '注册失败' }
      } finally {
        this.loading = false
      }
    },
    
    async fetchUser() {
      if (!this.token) return
      try {
        axios.defaults.headers.common['Authorization'] = `Bearer ${this.token}`
        const { data } = await axios.get(`${API_URL}/auth/me`)
        this.user = data.user
      } catch (error) {
        this.logout()
      }
    },
    
    // 获取配额信息
    async fetchQuota() {
      if (!this.token) return
      try {
        const { data } = await axios.get(`${API_URL}/purchase/quota`)
        this.quota = data
      } catch (error) {
        console.error('获取配额失败:', error)
        this.quota = { total: 0, used: 0, available: 0 }
      }
    },
    
    // 更新配额（外部调用，用于同步）
    updateQuota(newQuota) {
      this.quota = newQuota
    },
    
    logout() {
      this.token = ''
      this.user = null
      this.quota = null
      sessionStorage.removeItem('token')
      delete axios.defaults.headers.common['Authorization']
    }
  }
})
