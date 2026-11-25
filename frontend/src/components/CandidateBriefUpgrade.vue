<!--
  候选点位「是否购买联通人口」面板（v1.13.379 · P2；**v1.13.407 改为交给弹窗取数**）

  ── 定位 ────────────────────────────────────────────────────────────────
  初步分析给的是**免费结论**；这个面板只回答一件事：
    「这个点位值不值得花钱取联通人口」—— 给出 tier / why / buys，
    然后**把购买动作交给地图页同一个「联通人口数据」弹窗**（`StoreSmartstepsDialog`）。

  ── 🔴 为什么不再自己取数（v1.13.407，业主 2026-11-23 拍板）────────────
  379~406 曾在本组件内直接打 `/api/smartsteps/population`：只能取 1001 一个服务码、
  半径要按 1/3/5km 向上取整、结果只能内联展示。而门店弹窗走 `/query`，**一次请求**
  就能带 15 个服务码（联通按请求次数计费，服务码多少同价）、半径可自选 0.35~5km、
  还能导 Excel/PDF。同一笔钱买到的东西差几倍，没必要维护第二套取数实现。
  ⇒ 本组件只保留「判断」，取数一律走 `StoreSmartstepsDialog`。

  ── 🔴 三条边界（改本文件前必读）────────────────────────────────────────
  ① **本文件 ⛔ 不许出现任何取数请求** —— 0 消耗是初步分析能免费给人看的前提。
     守卫 `candidateBriefUpgradeGuard.test.js` 钉死。
  ② **弹窗必须 `defineAsyncComponent` 懒加载** —— 那个组件 2800+ 行，
     同步 import 会把候选点位页的首屏 chunk 撑大一截。
  ③ **面板在 `.bf-paper` 之外** ⇒ 按钮⛔ 不进 PDF。初步分析只导出结论，
     不导出付费操作（业主 11-23 明确：取数结果本来就不属于初步分析）。
-->
<template>
  <div class="bu-panel" :class="'is-' + (plan?.tier || 'optional')">
    <div class="bu-hd">
      <div class="bu-hd-l">
        <span class="bu-tag" :class="'is-' + (plan?.tier || 'optional')">{{ tierTag }}</span>
        <b class="bu-title">{{ plan?.title || '要不要花钱深入' }}</b>
      </div>
      <span class="bu-hd-note">联通人口 · 按半径圆取数</span>
    </div>

    <ul v-if="plan?.why?.length" class="bu-why">
      <li v-for="(w, i) in plan.why" :key="i">{{ w }}</li>
    </ul>

    <div v-if="plan?.buys?.length" class="bu-buys">
      <span class="bu-buys-l">花 1 次配额能买到（本地网格没有的）</span>
      <span v-for="b in plan.buys" :key="b" class="bu-chip">{{ b }}</span>
    </div>

    <!-- 操作区：只负责「打开弹窗」，消耗与剩余由弹窗自己明示（⛔ 这里不许承诺次数） -->
    <div class="bu-act">
      <span v-if="!hasCoord" class="bu-warn">该点位没有有效坐标，无法取联通人口</span>
      <span v-else class="bu-muted">在弹窗里选半径与月份；取数前会明示消耗几次、剩余几次</span>
      <el-button
        type="primary"
        size="small"
        :plain="plan?.tier !== 'recommend'"
        :disabled="!hasCoord"
        @click="upOpen = true"
      >打开联通人口查询</el-button>
    </div>

    <p v-if="plan?.tier === 'not_now'" class="bu-hold">
      规则结论是「先别买」，但按钮仍然保留 —— 如果这是「关一家开一家」的替换计划，由你自己决定要不要取数。
    </p>

    <!-- v1.13.407：取数（购买）走地图页同一个弹窗。v-if 保证每次打开都重建，
         半径预填才不会覆盖用户上一次改过的值。 -->
    <StoreSmartstepsDialog
      v-if="upOpen"
      :visible="upOpen"
      :store="dialogStore"
      :preset-radius="reportRadius"
      @update:visible="upOpen = $event"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, defineAsyncComponent } from 'vue'

// 🔴 懒加载：前面头部注释 ② —— 2800+ 行的重型弹窗，⛔ 同步 import
const StoreSmartstepsDialog = defineAsyncComponent(() => import('@/components/StoreSmartstepsDialog.vue'))

const props = defineProps({
  // 后端 brief.upgrade：{ tier, title, why[], buys[], radiusNote, quotaPerFetch, service }
  plan: { type: Object, default: null },
  // brief.point：{ name, lat, lng, city, radius }
  point: { type: Object, default: null },
  // 本次报告口径半径（米）—— 打开弹窗时预填到「半径1」，让用户看到的圆跟报告一致
  reportRadius: { type: Number, default: 1000 }
})

const upOpen = ref(false)
/**
 * v1.13.413：弹窗关掉就通知父组件重取一次 `/brief`。
 * 🔴 为什么必须这样：用户刚在弹窗里**买了人口**，而「生成立项报告」按钮亮不亮，
 *   是靠 `/brief` 回传的 `purchasedRadii` 判的 ⇒ 不重取，买完了按钮还是灰的
 *   （用户会以为没买成功，然后再买一次）。
 * ⚠️ 只重取**只读**的 `/brief`（0 消耗），⛔ 不要在这里做任何计费动作。
 */
const emit = defineEmits(['refresh'])
watch(upOpen, (v) => {
  if (!v) emit('refresh')
})

const hasCoord = computed(() => {
  const lat = Number(props.point?.lat)
  const lng = Number(props.point?.lng)
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
})

/**
 * 传给弹窗的「门店」对象。
 * ⚠️ 字段名必须是 `latitude` / `longitude`（弹窗内部这么读），⛔ 直接传 lat/lng。
 * ⚠️ 候选点位可能没名字 ⇒ 兜一个占位名，否则弹窗标题是空的。
 */
const dialogStore = computed(() => ({
  name: String(props.point?.name || '').trim() || '候选点位',
  latitude: Number(props.point?.lat),
  longitude: Number(props.point?.lng)
}))

const tierTag = computed(() => {
  const t = props.plan?.tier
  return t === 'recommend' ? '建议深入' : t === 'not_now' ? '不建议深入' : '可以先核验'
})
</script>

<style scoped>
.bu-panel {
  /* 与纸张同宽同轴（.bf-paper 是 794px + margin auto）—— 错开会让「操作区」看起来不属于这份报告 */
  width: 794px;
  max-width: 100%;
  box-sizing: border-box;
  margin: 14px auto 0;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-left: 4px solid #8a9099;
  border-radius: 8px;
}
.bu-panel.is-recommend { border-left-color: #2563eb; }
.bu-panel.is-not_now { border-left-color: #e6a23c; }

.bu-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.bu-hd-l { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bu-title { font-size: 15px; color: #1f2329; }
.bu-hd-note { font-size: 12px; color: var(--text-secondary); }
.bu-tag { font-size: 11px; padding: 2px 8px; border-radius: 3px; color: #fff; background: #8a9099; }
.bu-tag.is-recommend { background: #2563eb; }
.bu-tag.is-not_now { background: #e6a23c; }

.bu-why { margin: 10px 0 0; padding-left: 18px; color: #4b5563; font-size: 13px; line-height: 1.9; }
.bu-buys { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.bu-buys-l { font-size: 12px; color: var(--text-secondary); margin-right: 2px; }
.bu-chip { font-size: 12px; color: #1f2329; background: #eef2f7; border-radius: 10px; padding: 2px 9px; }

.bu-act {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e4e7ed;
}
.bu-warn { color: #b45309; font-weight: 500; font-size: 13px; }
.bu-muted { color: var(--text-secondary); font-size: 12px; }
.bu-hold { margin: 10px 0 0; font-size: 12px; color: #b45309; background: #fdf6ec; border-radius: 6px; padding: 7px 10px; }
</style>
