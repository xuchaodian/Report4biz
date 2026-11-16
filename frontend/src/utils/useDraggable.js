/**
 * useDraggable —— 浮层拖拽（鼠标 / 触屏统一，自动夹在容器内）
 *
 * 为什么要有这个文件（v1.13.367）：
 *   MapView 里原本有**三套独立的拖拽**（检索面板 onDragStart、门店商圈图例
 *   onLegendDragStart、网格图例 onGridLegendDragStart），前两套是 `mousedown + document`
 *   监听：①触屏完全拖不动（手机上没有 mouse 事件）②不夹边界，用户能把它拖出屏幕外，
 *   之后再也抓不回来 ③鼠标移出面板就丢事件。第三套（v1.13.268）已经用 pointer + 夹边界，
 *   但代码是复制出来的。三套逻辑等价却各写一遍，正是「漂移」的高发区。
 *
 * 设计要点（改之前先读）：
 *   · **容器坐标**：位置相对 offsetParent 保存，⛔ 不存 clientX/Y —— 后者把「视口」和
 *     「容器」两套坐标混在一起，导航栏收起/展开（地图变高变矮）后就飘。
 *   · **pointer 事件**：一套代码同时覆盖鼠标、触屏、触控笔；`setPointerCapture` 保证
 *     拖出面板边界也不丢事件。
 *   · **夹边界**：始终留 EDGE px，防止拖到贴边后抓不回来。
 *   · **窄屏禁用**：≤900px 下面板改为「铺满宽度 + 纵向堆叠」（见 MapView 的
 *     --narrow-stack-* 变量与各面板 @media），此时位置由 CSS 决定，拖拽会与 CSS 打架
 *     ⇒ 直接禁用。断点值必须与 CSS 那边一致（NARROW_QUERY 是唯一来源）。
 *
 * 用法：
 *   const panelRef = ref(null)
 *   const { style, onPointerDown } = useDraggable({ mode: 'right', initial: { top: 60, right: 180 }, panelRef })
 *   <div ref="panelRef" :style="style">
 *     <div class="header" @pointerdown="onPointerDown">…</div>
 *
 * ⚠️ 拖拽把手的 CSS 必须写 `touch-action: none`，否则移动端浏览器会把 pointermove
 *    当成页面滚动而 cancel 掉。
 */
import { computed, ref } from 'vue'

/** 窄屏断点 —— 与各组件 @media (max-width: 900px) 必须一致 */
export const NARROW_QUERY = '(max-width: 900px)'

/** 当前是否为窄屏（位置由 CSS 接管，拖拽禁用） */
export function isNarrowScreen() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(NARROW_QUERY).matches
}

// 断点变化的**响应式**镜像：窄屏时 useDraggable 直接不输出内联位置，
// 把位置完全让给 CSS（@media 里的 top/left/right）。否则内联 style 会赢过 @media，
// 出现「CSS 里明明改了，页面上纹丝不动」——这个坑在 365/366 已经踩过一次。
// ⚠️ 模块级只注册一次（HMR 重复执行会把监听叠加成 N 份）。
const narrow = ref(isNarrowScreen())
if (typeof window !== 'undefined' && window.matchMedia) {
  const G = globalThis
  if (!G.__r4bNarrowMq) {
    const mq = window.matchMedia(NARROW_QUERY)
    G.__r4bNarrowMq = mq
    mq.addEventListener('change', (e) => { narrow.value = e.matches })
  } else {
    narrow.value = G.__r4bNarrowMq.matches
  }
}

/** 窄屏响应式判据（模板/CSS 不用它，供 JS 侧判断） */
export const useNarrowScreen = () => narrow

const EDGE = 4        // 贴边留白，避免拖到边缘后抓不回来
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi))

/**
 * @param {object}   opts
 * @param {'left'|'right'} [opts.mode='left'] 水平锚点用哪一侧（right 模式适合「靠右对齐」的面板，
 *        窗口变宽时它继续贴右；left 模式适合靠左/自由摆放的面板）
 * @param {object|null} [opts.initial] 初始位置，键与 mode 对应（right 模式用 { top, right }）
 * @param {import('vue').Ref<HTMLElement|null>} [opts.panelRef] 被拖动的面板根元素；
 *        多个面板共用同一份位置时**不要**传它（一个 ref 只能挂一个元素），改用 panelSelector
 * @param {string} [opts.panelSelector] 从把手向上找面板根的选择器（与 panelRef 二选一）
 * @param {() => boolean} [opts.disabled] 额外的禁用判据
 */
export function useDraggable({ mode = 'left', initial = null, panelRef = null, panelSelector = '', disabled = null } = {}) {
  // null = 还没拖过，位置交给 CSS（保留「默认右下角」这类初始形态）
  const pos = ref(initial ? { ...initial } : null)
  const dragging = ref(false)
  let drag = null

  const style = computed(() => {
    // 窄屏：位置交给 CSS（@media），内联一律不输出 —— 内联会赢过 @media
    if (narrow.value) return {}
    const p = pos.value
    if (!p) return {}
    if (mode === 'right') return { top: `${p.top}px`, right: `${p.right}px` }
    // 自由摆放：钉成 left/top 的同时把可能存在的 right/bottom 关掉，否则两者打架
    return { left: `${p.left}px`, top: `${p.top}px`, right: 'auto', bottom: 'auto' }
  })

  const isDisabled = () => (disabled ? disabled() : narrow.value)

  const resolvePanel = (e) => {
    const pinned = panelRef && panelRef.value
    if (pinned) return pinned
    if (panelSelector && e.currentTarget && e.currentTarget.closest) {
      return e.currentTarget.closest(panelSelector)
    }
    return null
  }

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return   // 只接主键/触摸
    if (isDisabled()) return
    const panel = resolvePanel(e)
    if (!panel) return
    const host = panel.offsetParent || panel.parentElement
    if (!host) return

    const hostRect = host.getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    drag = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      hostRect,
      w: rect.width,
      h: rect.height
    }
    // 先把当前位置钉成显式坐标，再接管移动
    const left = rect.left - hostRect.left
    const top = rect.top - hostRect.top
    pos.value = mode === 'right'
      ? { top, right: hostRect.width - left - rect.width }
      : { left, top }

    dragging.value = true
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) { /* 老浏览器忽略 */ }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    e.preventDefault()
  }

  const onPointerMove = (e) => {
    if (!drag) return
    const { offsetX, offsetY, hostRect, w, h } = drag
    const x = clamp(e.clientX - hostRect.left - offsetX, EDGE, Math.max(EDGE, hostRect.width - w - EDGE))
    const y = clamp(e.clientY - hostRect.top - offsetY, EDGE, Math.max(EDGE, hostRect.height - h - EDGE))
    pos.value = mode === 'right'
      ? { top: y, right: hostRect.width - x - w }
      : { left: x, top: y }
  }

  const onPointerUp = () => {
    drag = null
    dragging.value = false
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  }

  return { pos, style, dragging, onPointerDown, onPointerUp }
}
