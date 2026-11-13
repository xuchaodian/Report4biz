/**
 * 表单字段级错误的可访问性支持（v1.13.361）
 *
 * ── 解决的到底是什么问题（别和 toast 搞混）────────────────────────────────
 * Element Plus 2.13.7 的 `.el-message` 外层 div **自带 `role="alert"`**
 * （`element-plus/es/components/message/src/message.vue…lang.mjs:114`），
 * 所以 `ElMessage.error()` 这类 toast 本来就会被读屏播报 ⛔ 不需要另外修。
 *
 * 真正的缺口在**字段级校验**：
 *   EP 的 `.el-form-item__error` 既没有 `role` 也没有 `aria-live`，
 *   输入框也没有 `aria-invalid` / `aria-describedby`。而认证四页的提交函数
 *   统一写成 `const valid = await validate().catch(() => false); if (!valid) return`
 *   ⇒ 对读屏用户来说，「点了提交按钮什么都没发生」，既不知道有字段错了，也不知道错在哪。
 *   这是 WCAG 3.3.1 Error Identification（A 级）的实打实缺口。
 *
 * ── 三件事，缺一不可 ─────────────────────────────────────────────────────
 * ① `fieldErr`：从 EP 的 `@validate` 事件把**它自己的**校验文案收下来
 *    （⛔ 绝不自己另编一套文案：两套必然与可视错误漂移，且 EP 的文案已走 i18n）
 * ② `fieldAria(prop)`：给输入框挂 `aria-invalid` + `aria-describedby`
 *    ⇒ 「聚焦到出错的框时能听到原因」，而不是只在出错那一瞬间响一下
 * ③ `liveErr`：一个视觉隐藏但**留在无障碍树里**的 `role="alert"` 活区
 *    ⇒ 「出错瞬间主动播报」；用户点提交时焦点还在按钮上，光有 ② 没人听得见
 *
 * ── 为什么 liveErr 不是简单的 computed ───────────────────────────────────
 * 活区只在**文本发生变化**时播报。用户连续两次点提交、两次都是同一句
 * 「请输入邮箱」时，computed 值没变 ⇒ DOM 没变 ⇒ 读屏一声不响，
 * 而这恰恰是我们最想解决的场景（「点了没反应」）。
 * 所以这里做成「先清空、再写回」强制重播；同一轮 validate 内的多字段报错
 * （EP 逐字段 emit、且跨微任务）用 60ms 宏任务窗口合并成一句，避免同一句话被念两遍。
 * ⚠️ 这两个时长都是实测出来的，不是随手拍的，改动前先看 announce() 上方的注释。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *   const { liveErr, onValidate, errId, fieldAria } = useFormErrorA11y(['email'], 'forgot')
 *   <el-form @validate="onValidate">
 *     <div class="sr-only" role="alert" aria-live="assertive">{{ liveErr }}</div>
 *     <el-form-item prop="email">
 *       <el-input v-bind="fieldAria('email')" />
 *       <template #error="{ error }">
 *         <div :id="errId('email')" class="el-form-item__error">{{ error }}</div>
 *       </template>
 *     </el-form-item>
 *
 * ⚠️ 模板里必须用 `#error` 插槽**接管** EP 的默认错误节点（给了插槽 EP 就不再渲染
 *    自己那个），否则读屏会把同一句错误念两遍 —— 358 在登录页实测踩过这个坑。
 * ⚠️ 活区的 `.sr-only` 必须用 clip 隐藏，⛔ 不能 `display:none` / `visibility:hidden`
 *    （那样元素会一起被移出无障碍树，活区等于没加，比不加更糟）。
 */
import { reactive, ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * @param {string[]} fields  本表单参与校验的 prop 名（必须与 el-form-item 的 prop 一致）
 * @param {string} prefix    id 前缀，须全站唯一（避免同页多表单时 id 撞车）
 */
export function useFormErrorA11y(fields, prefix) {
  const fieldErr = reactive(Object.fromEntries(fields.map((f) => [f, ''])))
  // 活区文本刻意用 ref 而非 computed：需要「清空再写回」来强制重播，computed 做不到
  const liveErr = ref('')

  const { locale } = useI18n()

  /** 多字段同时报错时的连接符：跟随当前语言，别让英文界面出现中文分号 */
  const joiner = () => (locale.value === 'ja' ? '。' : locale.value === 'en' ? '; ' : '；')

  let scheduled = false

  /**
   * 合并窗口。⛔ 不要改回 nextTick —— 实测（2026-11-13，生产 /login）：
   * EP 的 `validate()` 是**逐字段** emit `@validate` 的，两次 emit 相隔 0.4ms，
   * 但落在**不同的微任务**里。用 nextTick 做窗口时，第一个字段排的回调会抢在
   * 第二个字段 emit 之前执行 ⇒ 分两轮播报 ⇒ 读屏把同一句话念两遍
   * （MutationObserver 实测到 4 次变更：清空/写入 × 2）。
   * 60ms 是宏任务窗口：一轮 validate 的所有微任务都已跑完，而人手连点最快也要
   * 150ms 以上，不会把两次独立操作误合并。
   */
  const MERGE_MS = 60
  /** 清空后到写回之间的停顿时长：给读屏留一个能感知的「中间空态」，否则重播不生效 */
  const REPLAY_MS = 30

  /**
   * 把当前所有字段错误合并成一句并播报。
   */
  function announce() {
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      const text = fields.map((f) => fieldErr[f]).filter(Boolean).join(joiner())
      if (!text) {
        liveErr.value = ''
        return
      }
      // 同一句文案重复出现时，先清空再写回 —— role="alert" 只播报内容变化，
      // 值不变就等于没播（用户连点两次提交时，这正是「点了没反应」的场景）。
      if (liveErr.value === text) {
        liveErr.value = ''
        setTimeout(() => {
          liveErr.value = text
        }, REPLAY_MS)
        return
      }
      liveErr.value = text
    }, MERGE_MS)
  }

  /** EP `@validate` 签名：(prop, isValid, message)。不认识的字段直接忽略（表单里可能有非校验项）。 */
  function onValidate(prop, isValid, message) {
    if (!(prop in fieldErr)) return
    fieldErr[prop] = isValid ? '' : message || ''
    if (!isValid) announce()
    else if (!fields.some((f) => fieldErr[f])) liveErr.value = ''
  }

  /** 稳定的错误节点 id —— aria-describedby 要指过去，必须与模板里的 :id 由同一函数产出 */
  const errId = (prop) => `${prefix}-err-${prop}`

  /** 一次性产出 aria-invalid + aria-describedby，模板里 `v-bind` 展开即可 */
  const fieldAria = (prop) => ({
    'aria-invalid': fieldErr[prop] ? 'true' : undefined,
    'aria-describedby': fieldErr[prop] ? errId(prop) : undefined
  })

  return { fieldErr, liveErr, onValidate, errId, fieldAria }
}

export default useFormErrorA11y
