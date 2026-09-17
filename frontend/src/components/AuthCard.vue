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
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' }
})
</script>

<style lang="scss" scoped>
.auth-card {
  position: relative;   /* 卡片内绝对定位元素（如注册页蜜罐 .hp-field）的定位锚点 */
  z-index: 2;
  width: 420px;
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

/* 副标题：四页统一 14px/#999；1px 字距 —— 兼顾「智能选址分析平台」这类短标语的通透感
   与「输入注册邮箱，我们将发送重置链接」这类长句不显松散 */
.auth-card__subtitle {
  font-size: 14px;
  line-height: 1.5;
  color: #999;
  letter-spacing: 1px;
}

.auth-card__footer {
  text-align: center;
  margin-top: 20px;
  color: #999;
  font-size: 14px;

  /* 页脚内容由调用方以插槽传入 ⇒ 属于父组件作用域，必须用 :deep() 才能命中 */
  :deep(a) {
    color: #409eff;
    margin-left: 5px;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
