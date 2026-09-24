<script setup>
// 极薄版图标封装：只管三件事 —— 尺寸 token、颜色 token、无障碍标记。
//
// ⛔ 刻意【不做】「字符串名查表」（如 <AppIcon name="search" />）：
//    那需要 `import * as EpIcons` 把全部 294 个图标打进 bundle，
//    会直接抵消 v1.13.108（L3）做的「按需命名导入 + 白名单」优化。
//    ⇒ 图标本体由调用方按需 import，经默认插槽传入。
//
// 用法：
//   <AppIcon size="md" tone="brand"><Search /></AppIcon>
//
// 无障碍默认值（故意的：想出错就得主动传 label）：
//   图标旁有文字（装饰性）  ⇒ 不传 label ⇒ role/aria 都不输出（读屏不念图标）
//   图标独立承担语义        ⇒ 传 label="刷新配额" ⇒ role="img" + aria-label
defineProps({
  size:  { type: String, default: 'md' },      // sm | md | lg | xl
  tone:  { type: String, default: 'inherit' }, // inherit | brand | muted | danger | warning | success
  label: { type: String, default: '' },        // 有值＝有语义；空＝装饰性
  spin:  { type: Boolean, default: false },
})
</script>

<template>
  <el-icon
    class="app-icon"
    :class="[`app-icon--${size}`, `app-icon--${tone}`, { 'is-spin': spin }]"
    :aria-hidden="label ? undefined : 'true'"
    :aria-label="label || undefined"
    :role="label ? 'img' : undefined"
  >
    <slot />
  </el-icon>
</template>
