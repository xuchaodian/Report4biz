/**
 * 联通配额「不足」的统一引导入口 —— 全部配额类提示与跳转的唯一出口。
 *
 * 立档背景（v1.13.217 · 批次 217 P0）：
 *   「配额不足」的提示文案此前散在 4 处前端 + 1 处后端，且**已经出现措辞分叉** ——
 *     · SmartstepsPanel.vue（当时 L120/435）说「配额不足，请联系管理员**分配**配额」
 *     · SiteEvaluationView.vue（当时 L51/334）却写「**余额**不足…」
 *       （⚠️ v1.13.231：该文件已随两族隐藏资产整体清理删除，此处仅存历史证据）
 *     · 两处都**没有给任何联系途径**，`ElMessage` 弹完即走
 *
 *   ⚠️ 上列两个行号**已失效**（⛔ 别去那里找 —— 已分别指向 `el-option` 与 `L.divIcon`）：
 *     这两处文案**已于 v1.13.217 同批收敛进本模块**（`QUOTA_INLINE` / `requireQuota`），
 *     实测两文件现已**不含**「分配配额」「余额不足」字样。
 *     ⇒ 此段保留的是**病根现场的历史快照**（同一语义多处硬编码 ⇒ 必然分叉），不是导航指针。
 *       要复核现状，直接看本文件的导出即可。
 *   更有害的是**语义混用**：把「平台池空」和「自己额度空」混成同一句话 ——
 *     前者用户**买也没用**（上游调不动，只能我方补充上游额度），后者才是「可采购」。
 *   混在一起会出现「平台没货时用户去找人买、买了也调不动」→ 白跑一趟还会怀疑系统坏了。
 *
 *   ⇒ 与 v1.13.208（4 份 VIP 门禁拷贝全漏 trial）／v1.13.214（引导入口收敛）
 *     **同构的病根**：同一语义多处硬编码，必然分叉。
 *
 * ★ 判据不由本模块持有 —— 是否「配额不足」由调用点（前端预检 `available < 1`）
 *   或后端闸门（`code = own_quota_exhausted | pool_quota_exhausted`）决定，
 *   本模块只负责**给出口**。⛔ 不要在此复制一份「够不够」的判断。
 *
 * ★ 对外联系方式只在本文件的 `QUOTA_CONTACT`：
 *   ⛔ 任何调用点不得就地硬编码电话/邮箱（回归钉子 tests/quotaContactGuard.test.js ⑤）。
 *
 * ⚠️ 打包约束（⛔ 改本文件前必读）：本模块被多个路由 chunk 共用。
 *   **不得**把下面的 router 改成静态 import —— `@/router` 位于**入口** chunk，
 *   静态引用会让 Rollup 把共用 chunk 反向提升进入口，
 *   实测把 vendor-maps（53 KB gz）/ store-dialog / smartsteps-panel 一起拖进首屏
 *   （入口静态依赖 6 → 10 个 chunk，见 v1.13.214 的立档）。
 *   故此处**必须**用动态 `import()`。
 *
 * 回归钉子：tests/quotaContactGuard.test.js
 */
import { ElMessage, ElMessageBox } from 'element-plus'

/** 个人中心路径：配额卡片（含「申请采购配额」入口）就在该页 */
const ACCOUNT_PATH = '/account'

/**
 * 路由实例**延迟**加载（并缓存）。
 * ⚠️ 必须动态 `import()` —— 理由见文件头「打包约束」。`requireQuota` 本就是 async，零额外成本。
 */
let routerPromise = null
function getRouter() {
  if (!routerPromise) routerPromise = import('@/router').then((m) => m.default)
  return routerPromise
}

/**
 * ★ 对外商务联系方式（业主 2026-10-13 确认）—— **单一来源**，改号码只动这里。
 *   「平台池空」引导与「账号额度不足」引导共用。
 */
export const QUOTA_CONTACT = {
  name: '徐经理',
  phone: '138 1779 1741',
  email: 'jyo@youshi-tech.com'
}

/** 渲染联系方式为一行纯文本（避免各处自行拼串导致格式漂移） */
export function quotaContactText() {
  return `${QUOTA_CONTACT.name} ${QUOTA_CONTACT.phone} ／ ${QUOTA_CONTACT.email}`
}

/**
 * 触发原因 —— 与后端 `quotaGate.js::buildGateError` 返回的 `code` **同值**，
 * 以便 catch 分支直接 `requireQuota(e.response.data.code, …)` 而无需再做映射。
 */
export const QUOTA_REASON = {
  /** 账号自身额度不足 ⇒ **可采购** */
  OWN: 'own_quota_exhausted',
  /** 平台物理池耗尽 ⇒ ⛔ 用户买也没用，只能我方补充上游额度 */
  POOL: 'pool_quota_exhausted'
}

/**
 * 剩余次数的「低额度」阈值：≤ 此值即开始软提醒（= 0 时升级为危险色）。
 * ⚠️ 这是**展示层软提醒**的判据，与闸门（quotaGate.js）无关 —— 不碰闸门是本批的硬约束。
 */
export const QUOTA_WARN_THRESHOLD = 5

/**
 * 行内短提示（模板绑定用）。
 * 调用点形如：`{{ QUOTA_INLINE.prefix }}<a @click.prevent="…">{{ QUOTA_INLINE.action }}</a>{{ QUOTA_INLINE.suffix }}`
 * ⛔ 不要在模板里就地写这几段中文 —— 那样又会分叉。
 */
export const QUOTA_INLINE = {
  prefix: '剩余次数不足，',
  action: '申请采购配额',
  suffix: '（或联系管理员分配）'
}

/**
 * 生成「（需要 N 次，<label> M 次）」括注。
 * ⚠️ N 非法时返回**空串**（整段省略）—— 不能留下半截括号渲染成「（）。」。
 */
function needNote(need, label, value) {
  const n = Number(need)
  if (!Number.isFinite(n) || n <= 0) return ''
  const v = Number.isFinite(Number(value)) ? Number(value) : 0
  return `（需要 ${n} 次，${label} ${v} 次）`
}

/**
 * 统一入口：配额不足时的引导。
 *
 * @param {string} reason  QUOTA_REASON.OWN | QUOTA_REASON.POOL
 * @param {Object} [ctx]
 * @param {number} [ctx.need]  本次需要消耗的次数
 * @param {number} [ctx.own]   账号可用次数（OWN 分支用）
 * @param {number} [ctx.pool]  平台池剩余次数（POOL 分支用）
 * @returns {Promise<boolean>} 恒 false —— 本模块**从不放行**，
 *   调用点统一写 `if (!(await requireQuota(…))) return`，读起来与 `requireVip` 一致。
 */
export async function requireQuota(reason, ctx = {}) {
  const contact = quotaContactText()

  // ── ① 平台池空：⛔ **不给采购入口**（用户买了也调不动，只能我方补上游额度）──
  if (reason === QUOTA_REASON.POOL) {
    const body =
      `平台上游「联通人口数据」额度已用尽${needNote(ctx.need, '当前剩余', ctx.pool)}。` +
      `本项需我方补充上游额度后方可使用。如需协助请联系：${contact}`
    try {
      await ElMessageBox.alert(body, '平台额度已用尽', {
        confirmButtonText: '我知道了',
        type: 'warning'
      })
    } catch (e) {
      // ESC / 右上角关闭 ⇒ reject('close')，必须吞掉，否则控制台留 unhandled rejection
    }
    return false
  }

  // ── ② 账号额度不足：可采购（P1 起为自助申请单；本阶段先给联系方式 + 个人中心入口）──
  const body =
    `本账号「联通人口数据」可用次数不足${needNote(ctx.need, '当前可用', ctx.own)}。` +
    `可提交采购申请，我方将与您联系；也可直接联系商务：${contact}`

  const router = await getRouter()

  // 已在个人中心：申请入口就在本页（配额卡片），再 push 一次 /account 等于「跳到自己」
  // ＝ 用户以为点了没反应。⇒ 改为就地指路（与 vipGate.js::requireVip 同款处理）。
  if (router.currentRoute.value.path === ACCOUNT_PATH) {
    ElMessage.warning('本账号联通人口数据配额不足，请在下方「联通人口数据配额」卡片提交采购申请')
    return false
  }

  try {
    await ElMessageBox.confirm(body, '联通人口数据配额不足', {
      confirmButtonText: '前往个人中心',
      cancelButtonText: '暂不',
      type: 'warning'
    })
  } catch (e) {
    // 点「暂不」/ 右上角关闭 ⇒ reject('cancel' | 'close')，必须吞掉
    return false
  }

  router.push(ACCOUNT_PATH)
  return false
}
