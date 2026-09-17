<template>
  <!-- 认证页共用背景（v1.13.151）：登录 / 注册 / 忘记密码 / 重置密码 四页同一套视觉。
       纯装饰，不进无障碍树；pointer-events:none 保证不拦截卡片与语言切换的点击。 -->
  <div class="auth-bg" aria-hidden="true">
    <div
      v-for="(src, i) in images"
      :key="src"
      class="auth-bg__slide"
      :class="{ 'is-active': currentIndex === i }"
      :style="unlocked.includes(i) ? { backgroundImage: `url(${src})` } : null"
    />
    <div class="auth-bg__overlay" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  // 背景图放在 public/ 下（非构建期资源，字符串直接给 CSS url）
  images: {
    type: Array,
    default: () => ['/bg1.webp', '/bg2.webp', '/bg3.webp', '/bg4.webp', '/bg5.webp']
  },
  // 轮播间隔（ms）
  interval: { type: Number, default: 6000 },
  // 首帧稳定后预热下一帧的延迟（ms）
  warmDelay: { type: Number, default: 1500 }
})

const currentIndex = ref(0)

// v1.13.137：惰性加载。原先 5 张 background-image 全部写在 DOM 上，浏览器首屏就把 1.9MB
// 全量拉下来；而轮播 6s 才切一张，后 4 张纯属浪费带宽（实测首屏图片占登录页载荷 76%）。
// 改为只解锁「当前帧 + 下一帧」：首屏仅下载 1 张（~131KB），warmDelay 后再补下一帧，
// 之后每轮转时解锁更下一帧 → 切换时刻永远提前就绪，不闪白。
// ⚠️ 该优化随组件一起复用：注册 / 忘记 / 重置页同样只付一张图的代价。
const unlocked = ref([0])
const unlock = (i) => {
  if (!unlocked.value.includes(i)) unlocked.value = [...unlocked.value, i]
}

let rotateTimer = null
let warmTimer = null

onMounted(() => {
  if (props.images.length < 2) return
  // 尊重系统「减少动态效果」：静态停在第 1 帧，不做旋转（CSS transition 同步由媒体查询关掉）
  const reduceMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) return

  warmTimer = setTimeout(() => unlock(1 % props.images.length), props.warmDelay)
  rotateTimer = setInterval(() => {
    currentIndex.value = (currentIndex.value + 1) % props.images.length
    unlock((currentIndex.value + 1) % props.images.length)
  }, props.interval)
})

onUnmounted(() => {
  if (rotateTimer) clearInterval(rotateTimer)
  if (warmTimer) clearTimeout(warmTimer)
})
</script>

<style lang="scss" scoped>
.auth-bg {
  /* fixed 而非 absolute：容器在矮视口下是可滚动容器，absolute 会随内容一起被滚出视口，
     露出底部的纯色；fixed 始终铺满视口。#app 的唯一子节点就是 .auth-container 且无
     transform/filter 祖先，故 fixed 相对视口生效。 */
  position: fixed;
  inset: 0;
  z-index: 0;           /* 卡片为 z-index 2，蒙层 1 —— 保持既有层序 */
  overflow: hidden;
  pointer-events: none; /* 装饰层不参与命中测试 */
}

.auth-bg__slide {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  opacity: 0;
  transition: opacity 1.5s ease-in-out;

  &.is-active {
    opacity: 1;
  }
}

.auth-bg__overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(26, 26, 46, 0.85) 0%, rgba(22, 34, 78, 0.75) 50%, rgba(26, 26, 46, 0.85) 100%);
}

@media (prefers-reduced-motion: reduce) {
  .auth-bg__slide {
    transition: none;
  }
}
</style>
