import { defineStore } from 'pinia'
import axios from 'axios'

const API_URL = '/api'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: sessionStorage.getItem('token') || '',
    user: null,
    loading: false,
    quota: null, // 配额信息 { total, used, available }
    // 组织归属：null=尚未查询；''=已确认不属于任何集团（含集团被解散）；'owner' | 'member'
    orgRole: null,
    orgRoleLoaded: false
  }),
  
  getters: {
    isLoggedIn: (state) => !!state.token,
    isAdmin: (state) => state.user?.role === 'admin',
    username: (state) => state.user?.username || '',
    availableQuota: (state) => state.quota?.available ?? 0,
    // 是否属于某个集团（总部 owner / 子公司 member）。
    // ⚠️ 必须带上 orgRoleLoaded：未确认前一律 false，避免菜单项「先闪现再消失」。
    hasOrg: (state) => state.orgRoleLoaded && (state.orgRole === 'owner' || state.orgRole === 'member')
  },
  
  actions: {
    async login(username, password) {
      this.loading = true
      try {
        const { data } = await axios.post(`${API_URL}/auth/login`, { username, password })
        this.token = data.token
        this.user = data.user
        sessionStorage.setItem('token', data.token)
        localStorage.setItem('userId', String(data.user.id || ''))  // 持久化 userId，供筛选隔离key使用
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
    
    /**
     * 查询当前账号的组织归属（集团总部 owner / 子公司 member / 不属于任何集团）。
     * 后端 GET /api/orgs/me 对无组织账号返回 200 + { role: null }，不报错。
     * 用途：右上角个人下拉里的「数据同步」入口仅对集团账号显示。
     * @param {boolean} force 已加载过是否也重新查询（下拉打开时用 true，实时反映绑定/解绑）
     */
    async fetchOrgRole(force = false) {
      if (!this.token) return
      if (this.orgRoleLoaded && !force) return
      try {
        const { data } = await axios.get(`${API_URL}/orgs/me`)
        this.orgRole = data?.role || ''
        this.orgRoleLoaded = true
      } catch (error) {
        // ⚠️ 接口异常（网络/5xx）时不擅自判定「无集团」——保持未加载态，
        //    否则一次抖动就会让集团账号的入口消失。下次打开下拉会自动重试。
        console.error('获取组织归属失败:', error)
      }
    },

    // 供页面（如数据同步页）回写已查到的归属，保证菜单与页面判定一致
    setOrgRole(role) {
      this.orgRole = role || ''
      this.orgRoleLoaded = true
    },
    
    // 更新配额（外部调用，用于同步）
    updateQuota(newQuota) {
      this.quota = newQuota
    },
    
    logout() {
      this.token = ''
      this.user = null
      this.quota = null
      this.orgRole = null
      this.orgRoleLoaded = false
      sessionStorage.removeItem('token')
      localStorage.removeItem('userId')
      delete axios.defaults.headers.common['Authorization']
    }
  }
})
