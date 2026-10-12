/**
 * VIP 功能门禁的「单一入口」—— 非 VIP 点击 VIP 专属功能时的统一引导。
 *
 * 立档背景（v1.13.214）：全站 5 个 VIP 门禁点里**只有「销售预测」**做了引导
 *   （SalesForecastView 的 `.fc-locked` 锁定卡 + 「前往个人中心申请试用」按钮 → /account），
 *   其余 3 个功能（AI 选址建议 / 开店余地 / 网点优化，共 4 处调用点）**只弹一句**
 *   `ElMessage.warning('…为 VIP 用户专属功能，请联系管理员开通 VIP')` ——
 *   那是 **v1.13.205 之前**的老流程。
 *   205 已上线自助申请（个人中心「体验 VIP 用户」→ 填表 → 管理员审核 → 30 天试用），
 *   这 4 处却仍把人往「找管理员」这条人工渠道引 ⇒ 同一站点两套话术、自相矛盾。
 *
 * ⚠️ 为什么必须收敛成一个模块：同一形态的门禁**此前已经分叉过一次**——
 *   v1.13.208 的「四个拷贝全判 vip/admin、全漏 trial」让试用用户被误拦
 *   （立档见 tests/vipGateGuard.test.js）。4 份提示文案若各自维护，同样会漂移。
 *
 * 判据：复用 `stores/user.js::isVipActive`（v1.13.213 起它已收敛到
 *   `utils/vipUntil.js::isVipRoleActive`，含 `vip_until` 有效期判定）。
 *   ⛔ 本模块**不得**再复制一份角色白名单 —— 那正是 208 的病根。
 *
 * 打包约束（⛔ 改本文件前必读）：本模块被 4 个路由 chunk 共用，
 *   且 `vite.config.js` 已把它显式分组进 `app-shared`（见那里的 ⚠️ 注释）。
 *   **不得**把下面的 router 改成静态 `import router from '@/router'` ——
 *   `@/router` 位于**入口** chunk，静态引用会让 Rollup 把共用 chunk 反向提升进入口，
 *   实测把 vendor-maps（53 KB gz）/ store-dialog / smartsteps-panel 一起拖进首屏
 *   （入口静态依赖 6 → 10 个 chunk）。故此处**必须**用动态 `import()`。
 *
 * 回归钉子：tests/vipGateGuideGuard.test.js
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'

/** 个人中心路径：自助申请入口（「体验 VIP 用户」按钮）就在该页 */
const ACCOUNT_PATH = '/account'

/**
 * 路由实例**延迟**加载（并缓存）。
 * ⚠️ 必须动态 `import()` —— 理由见文件头「打包约束」：静态引用会把
 *    vendor-maps 等 chunk 拖进首屏。`requireVip` 本就是 async，此处零额外成本。
 */
let routerPromise = null
function getRouter() {
  if (!routerPromise) routerPromise = import('@/router').then((m) => m.default)
  return routerPromise
}

/**
 * 受门禁功能的展示名（key → 文案）。
 * 调用点只传 key，**文案集中在此** —— 将来改口径只动一处。
 */
export const VIP_FEATURE_LABELS = {
  aiAdvice: 'AI 选址建议',
  openingRoom: '开店余地',
  storeCircles: '网点优化',
  salesForecast: '销售预测'
}

/** 取展示名；未登记的 key 会被守卫测试判红，此处兜底避免渲染成 undefined */
export function vipFeatureLabel(key) {
  const label = VIP_FEATURE_LABELS[key]
  if (!label) console.warn('[VIP 门禁] 未登记的功能 key：' + key)
  return label || '该功能'
}

/**
 * VIP 门禁统一入口（异步）。
 *
 * @param {string} key VIP_FEATURE_LABELS 的键
 * @returns {Promise<boolean>} true = 放行；false = 已拦截（并已给出引导）
 *
 * 用法：`if (!(await requireVip('aiAdvice'))) return`（handler 须为 async）
 */
export async function requireVip(key) {
  const userStore = useUserStore()
  if (userStore.isVipActive) return true

  const label = vipFeatureLabel(key)
  const router = await getRouter()

  // 已在个人中心：申请按钮就在本页，再 push 一次 /account 等于「跳到自己」＝无操作
  // （用户会以为点了没反应）⇒ 改为就地指路。
  if (router.currentRoute.value.path === ACCOUNT_PATH) {
    ElMessage.warning(`${label}为 VIP 用户专属功能，请点击本页「体验 VIP 用户」提交试用申请`)
    return false
  }

  try {
    await ElMessageBox.confirm(
      `${label}为 VIP 用户专属功能。普通用户可在「个人中心」提交申请，通过后可开通 30 天 VIP 试用。`,
      'VIP 专属功能',
      {
        confirmButtonText: '前往个人中心申请',
        cancelButtonText: '暂不',
        type: 'warning'
      }
    )
  } catch (e) {
    // 点「暂不」/ 右上角关闭 ⇒ reject('cancel' | 'close')，必须吞掉，
    // 否则控制台留 unhandled rejection（与 MainLayout 退出确认同款处理）。
    return false
  }

  router.push(ACCOUNT_PATH)
  return false
}
