<template>
  <!-- 认证页共用卡片（v1.13.151）：统一登录 / 注册 / 忘记密码 / 重置密码 的卡片规格与标题层级。
       规格取「登录页」为基准（最完整的门面页），其余页面向它看齐。 -->
  <div class="auth-card">
    <div class="auth-card__header">
      <!-- alt="" ：紧邻的 h1 已播报品牌名，logo 属重复信息，留空避免读屏念两遍 -->
      <img src="@/assets/logo.png" alt="" class="auth-card__logo">
      <h1 v-if="title" class="auth-card__title">{{ title }}</h1>
      <p v-if="subtitle" class="auth-card__subtitle">{{ subtitle }}</p>
    </div>

    <slot />

    <div v-if="$slots.footer" class="auth-card__footer">
      <slot name="footer" />
    </div>

    <!-- ICP 备案号：认证页共用的公开展示位（v1.13.359 起可用 showIcp 关闭）。
         工信部要求「网站主页底部展示 + 可点进 beian.miit.gov.cn」——**主页**指官网首页
         homepage/index.html 的页脚，那里恒常驻；此处属可选加固位，故登录页可按需隐藏。
         ⚠️ 只允许「本组件内按页开关」，⛔ 别把 homepage 页脚那处一起删（那是合规位）。
         常显下划线只在 hover 加粗，靠链接语义兜底 -->
    <a
      v-if="showIcp"
      class="auth-card__icp"
      href="https://beian.miit.gov.cn/"
      target="_blank"
      rel="noopener noreferrer"
    >沪ICP备2026010607号-1</a>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  /* 是否展示底部 ICP 备案号。默认 true（注册/找回密码/重置密码/404 保持原样）；
     登录页显式传 false —— 登录页是对外门面，备案号展示位改由官网首页承担。 */
  showIcp: { type: Boolean, default: true }
})
</script>

<style lang="scss" scoped>
.auth-card {
  position: relative;   /* 卡片内绝对定位元素（如注册页蜜罐 .hp-field）的定位锚点 */
  z-index: 2;
  width: 420px;
  /* v1.13.173：窄视口（375 手机等）留出左右 12px 边距，保住桌面端「照片背景上的悬浮白卡」层次感
     （原 375px 视口下卡片满宽=视口宽，左右贴边如普通表单页）。
     max-width 会压过 width ⇒ 桌面端仍是 420px。用 100%（非 100vw）以免把窄屏滚动条宽度算进去。 */
  max-width: calc(100% - 24px);
  /* 双轴居中由 margin:auto 承担（而非父级 align-items:center）：内容高于容器时可完整滚动。
     auto 的外边距同时会让 align-self 的默认 stretch 失效 ⇒ 卡片不会被拉满高度。 */
  margin: auto;
  padding: 44px 40px 36px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 16px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
}

.auth-card__header {
  text-align: center;
  margin-bottom: 30px;
}

.auth-card__logo {
  width: 64px;
  height: auto;
  margin-bottom: 12px;
}

.auth-card__title {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.3;
  color: #333;
  margin-bottom: 6px;
}

/* 副标题：四页统一 14px；1px 字距 —— 兼顾「智能选址分析平台」这类短标语的通透感
   与「输入注册邮箱，我们将发送重置链接」这类长句不显松散。
   ⚠️ v1.13.173：色值 #999 → #6b7280。原 #999 对白底仅 2.85:1，不达 WCAG AA 4.5:1；
   #6b7280 = 4.83:1 达标。注意此色是**页面自有硬编码**，不读 --el-text-color-secondary
   （实测该 EP 变量为 #909399）⇒ 想修这里只能直接改本行色值，改 EP 变量无效。 */
.auth-card__subtitle {
  font-size: 14px;
  line-height: 1.5;
  color: #6b7280;
  letter-spacing: 1px;
}

.auth-card__footer {
  text-align: center;
  margin-top: 20px;
  /* v1.13.173：同副标题，#999(2.85:1) → #6b7280(4.83:1) */
  color: #6b7280;
  font-size: 14px;

  /* 页脚内容由调用方以插槽传入 ⇒ 属于父组件作用域，必须用 :deep() 才能命中 */
  :deep(a) {
    color: var(--brand-primary);
    margin-left: 5px;
    /* v1.13.173（WCAG 1.4.1 不能仅靠颜色区分）：原静置态 text-decoration:none，
       与周围灰字仅靠「蓝 vs 灰」区分 ⇒ 改为常显 1px 下划线 + 3px 偏移（不离字太近），
       悬停把线加粗到 2px 作为反馈（原为 none→underline，现下划线已常显，故改用粗细变化）。 */
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;

    &:hover {
      text-decoration-thickness: 2px;
    }
  }
}

/* ICP 备案号：12px 小字，色值沿用页脚 #6b7280（4.83:1，过 WCAG AA），不用 #999 那类浅灰 */
.auth-card__icp {
  display: block;
  margin-top: 18px;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
  color: #6b7280;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;

  &:hover {
    text-decoration-thickness: 2px;
  }
}
</style>
