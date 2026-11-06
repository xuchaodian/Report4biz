/**
 * 全局 UI 偏好（v1.13.322）
 *
 * 目前只有一项：地图页「收起顶部导航、全屏看地图」。
 *
 * 🔴 为什么必须按 uid 存：这是**个人偏好**，同一台机器上多账号切换时
 *    不该互相影响。（本项目已因「按 uid 命名的本地存储取错 uid」出过串档事故，
 *    v1.13.198/§6.36 有完整记录。）所以统一走 utils/currentUser.js，⛔ 别直接读
 *    localStorage.getItem('userId')。
 *
 * ⚠️ 状态只在**地图页**生效（`MainLayout` 用 `isMapPage && navCollapsed` 组合判断）。
 *    表格页/管理页即使这个值为 true 也不收起 —— 那里收起导航只会让人迷失。
 */
import { defineStore } from 'pinia'
import { currentUidOr } from '@/utils/currentUser.js'

const KEY_PREFIX = 'map_nav_collapsed_'

/** 取当前账号的存储键；未登录时落到 `_anon`（无副作用，登录后会读真实键） */
function storageKey() {
  return KEY_PREFIX + currentUidOr('')
}

export const useUiStore = defineStore('ui', {
  state: () => ({
    /** 地图页是否收起顶部导航 */
    navCollapsed: false,
    /** 是否已从 localStorage 读过（避免重复读盘 / 未登录时读到 anon 键） */
    navPrefLoaded: false,
  }),

  actions: {
    /**
     * 读取偏好。**必须在 user 信息就绪后调用**（MainLayout 里 watch 用户名/uid 触发），
     * 否则读到的会是 `_anon` 键 —— 表现是「切了账号，全屏设置没跟着变」。
     */
    loadNavPref() {
      try {
        this.navCollapsed = localStorage.getItem(storageKey()) === '1'
      } catch (e) {
        this.navCollapsed = false
      }
      this.navPrefLoaded = true
    },

    setNavCollapsed(v) {
      this.navCollapsed = !!v
      try {
        localStorage.setItem(storageKey(), v ? '1' : '0')
      } catch (e) {
        // 隐私模式/配额满：记不住就算了，不影响本次会话的切换
      }
    },

    toggleNav() {
      this.setNavCollapsed(!this.navCollapsed)
    },
  },
})
