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
    /**
     * ★ v1.13.160 集团品牌 Logo 读时继承 —— **全站展示 Logo 的唯一入口**。
     *
     * 后端在 login / GET /auth/me / PUT /users/me 三处回带：
     *   logo           本人上传的 logo（**原义不变**，仅用于「有没有改动」比对与提交）
     *   logo_effective 实际应展示的（自有优先，否则继承所属集团总部账号的）
     *   logo_source    'self' | 'group' | null
     *   logo_group_name 集团名（继承时用于提示语）
     *
     * ⚠️ 任何地方**展示** Logo 都必须走本 getter，不要直接用 user.logo ——
     *    否则子公司账号会看不到集团品牌 Logo（父级需求：子公司无需重复上传）。
     *    反之，**写回**（PUT /users/me 的 logo 字段）必须用 user.logo 原值。
     * `??` 兜底旧版后端回包（无 logo_effective 字段）时不至于把头像变空。
     */
    effectiveLogo: (state) => state.user?.logo_effective ?? state.user?.logo ?? null,
    /** 当前展示的 Logo 是否来自集团继承（设置页据此显示提示，不显示"可清除"） */
    logoInherited: (state) => state.user?.logo_source === 'group',
    logoGroupName: (state) => state.user?.logo_group_name || '',
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
    
    // v1.13.149：extra = { ticket, hp_note }（注册防护票据 + 蜜罐，见 utils/registerGuard.js）
    async register(username, email, password, extra = {}) {
      this.loading = true
      try {
        await axios.post(`${API_URL}/auth/register`, { username, email, password, ...extra })
        return { success: true }
      } catch (error) {
        return {
          success: false,
          message: error.response?.data?.message || '注册失败',
          code: error.response?.data?.code || ''
        }
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
        // token 已失效（过期 / 被登出撤销 / 账号改密致版本失配）⇒ 只需清本地：
        // 服务端那边它本就已无效，没必要再发一次 /logout。用 clearSession 而非 logout。
        this.clearSession()
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
    
    /**
     * 退出登录（v1.13.150：服务端**真的**会撤销本设备的 token）
     *
     * 顺序刻意如此，勿调换：
     *   1) 先带 token 调 POST /api/auth/logout ⇒ 服务端把该 token 的 jti 拉黑。
     *      这是「共享设备」场景的核心价值：即便 token 已被人抄走，登出后也立即失效。
     *   2) 无论成功 / 失败 / 超时，都继续清本地 —— 登出**绝不能**被网络问题卡住。
     * 该接口刻意设计为「幂等 + 不挂认证中间件」，故不会出现 401 弹窗；此处仍全量兜底。
     */
    async logout() {
      const token = this.token || sessionStorage.getItem('token')
      if (token) {
        try {
          await axios.post(`${API_URL}/auth/logout`, {}, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 5000   // 登出要快：慢网络下不拖住跳转
          })
        } catch (error) {
          // 服务端不可达 / token 已失效：忽略，本地清理照常（宁可本地先断）
          console.warn('服务端登出未成功（本地仍会清理）:', error?.message || error)
        }
      }
      this.clearSession()
    },

    /** 仅清本地会话（登出 / token 失效 / 换账号共用） */
    clearSession() {
      this.token = ''
      this.user = null
      this.quota = null
      this.orgRole = null
      this.orgRoleLoaded = false
      sessionStorage.removeItem('token')
      localStorage.removeItem('userId')
      delete axios.defaults.headers.common['Authorization']
    },

    /**
     * v1.13.150：应用服务端重签的 token。
     * 场景：本人修改密码 —— 服务端会让该账号**全部**旧 token 失效（改密码踢所有设备
     * 是安全必需），同时回一枚新版本号的 token 给「当前这台设备」，用它替换本地凭据，
     * 避免本人刚改完密码就被自己踢下线。
     */
    applyToken(token) {
      if (!token) return
      this.token = token
      sessionStorage.setItem('token', token)
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    }
  }
})
