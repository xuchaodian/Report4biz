<template>
  <!-- ==========================================================================
       404 视图（v1.13.221）
       背景：nginx 的 `location /` 对所有未命中静态文件的路径 try_files 回落 index.html，
             而路由表里没有 catch-all ⇒ 未知路径被渲染成「空白的 SPA 壳」并返回 HTTP 200
             （软 404：用户看到白屏、搜索引擎收进索引）。
       做法：给路由表补 catch-all 指向本页 ⇒ 用户得到一个可读、可离开的错误页；
             并由 router 按 meta.noindex 注入 <meta name="robots" content="noindex, follow">
             告知爬虫「此 URL 不该被收录」（SPA 无法在不做 SSR 的前提下改 HTTP 状态码，
             客户端 noindex 是这一形态下的标准解法）。

       ⚠️ 本页刻意**不**套 MainLayout：未知路径可能是任何人（含未登录）访问的，
          不该假设存在登录态，也不该拉起整套导航。视觉沿用认证四页的「照片背景 + 悬浮白卡」。
       ========================================================================== -->
  <div class="auth-container">
    <AuthBackground />

    <!-- 语言切换（右上角）—— 与登录/注册/忘记/重置四页同一位置与规格 -->
    <div class="nf-lang">
      <el-dropdown trigger="click" @command="(lang) => setAppLocale(lang)">
        <span class="nf-lang-trigger" :aria-label="$t('common.switchLanguage')">
          <el-icon><ChatLineRound /></el-icon>
          <span>{{ langShort }}</span>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="zh">中文</el-dropdown-item>
            <el-dropdown-item command="ja">日本語</el-dropdown-item>
            <el-dropdown-item command="en">English</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <AuthCard :title="$t('notFound.code')" :subtitle="$t('notFound.subtitle')">
      <p class="nf-desc">{{ $t('notFound.desc') }}</p>

      <!-- 回显用户实际访问的路径，帮助其自查是否输错（Vue 插值自动转义，无 XSS 面） -->
      <p v-if="attempted" class="nf-path">
        {{ $t('notFound.attempted') }}
        <code>{{ attempted }}</code>
      </p>

      <div class="nf-actions">
        <el-button
          type="primary"
          size="large"
          class="auth-submit"
          @click="goPrimary"
        >
          {{ userStore.isLoggedIn ? $t('notFound.backHome') : $t('notFound.toLogin') }}
        </el-button>
      </div>

      <template #footer>
        <!-- ⛔ 必须是原生 <a> 而非 <router-link>：/home/ 是 nginx alias 出的**独立静态页**
             （不在 SPA 路由表内）。用 router-link 会被 vue-router 拦截后落回 catch-all
             ⇒ 在 404 页里套娃出 404 页。此处必须走浏览器原生跳转。 -->
        <a href="/home/">{{ $t('notFound.toHomepage') }}</a>
      </template>
    </AuthCard>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChatLineRound } from '@element-plus/icons-vue'
import { setAppLocale } from '@/i18n'
import { useUserStore } from '@/stores/user'
import AuthBackground from '@/components/AuthBackground.vue'
import AuthCard from '@/components/AuthCard.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const { locale } = useI18n()

// 语言按钮缩写：中 / 日 / EN（与 LoginView 同款；四页目前均内联此三行，
// 若将来要统一收敛成 utils，需五页一起改 —— 本批不扩大变更面）
const langShort = computed(() => {
  if (locale.value === 'ja') return '日'
  if (locale.value === 'en') return 'EN'
  return '中'
})

// 只取 path（丢弃 query/hash，避免把用户输入的长串整段铺在页面上），并截断防换行撑破卡片
const attempted = computed(() => {
  const p = route.path || ''
  return p.length > 80 ? p.slice(0, 77) + '…' : p
})

const goPrimary = () => {
  // 已登录 ⇒ 回工作台；未登录 ⇒ 回登录页（直接 push '/' 会被守卫再弹到 /login，
  // 这里提前分流，路径语义更直白）
  router.push(userStore.isLoggedIn ? '/' : '/login')
}
</script>

<style lang="scss" scoped>
/* 容器（.auth-container）与主按钮（.auth-submit）样式在 assets/main.scss —— 认证四页共用 */

.nf-lang {
  position: fixed;
  top: 20px;
  right: 24px;
  z-index: 20;
}
.nf-lang-trigger {
  display: flex;
  align-items: center;
  gap: 5px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.nf-lang-trigger:hover {
  background: rgba(0, 0, 0, 0.4);
  border-color: rgba(255, 255, 255, 0.5);
}

.nf-desc {
  text-align: center;
  font-size: 14px;
  line-height: 1.7;
  /* 同 AuthCard 副标题：项目内硬编码色（不读 EP 变量），#6b7280 对白底 4.83:1 达 WCAG AA */
  color: #6b7280;
  margin-bottom: 10px;
}

.nf-path {
  text-align: center;
  font-size: 13px;
  color: #6b7280;
  margin-bottom: 22px;
  word-break: break-all;

  code {
    display: inline-block;
    max-width: 100%;
    padding: 2px 6px;
    border-radius: 4px;
    background: #f3f4f6;
    color: #374151;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
}

.nf-actions {
  margin-top: 4px;
}
</style>
