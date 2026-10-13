/**
 * 配额「采购申请单」前端契约守卫 —— v1.13.218
 *
 * 锁定的东西（都是「改坏了不会报错、只会静默失效」的那类）：
 *   ① 联系方式**只有一个落点**：QuotaPurchaseDialog 的 `<script>` 必须真正调用 `quotaContactText()`，
 *      ⛔ 源码不得再出现硬编码的「徐经理 / 138 1779 1741 / jyo@youshi-tech.com」
 *      （否则改号码要改 N 处 —— 与 208「4 份拷贝全漏 trial」同构病根）。
 *   ② 提醒阈值**只有一个落点**：MyAccountView 判据必须用 `QUOTA_WARN_THRESHOLD`，
 *      ⛔ 不得出现裸 `availableQuota <= 5`。
 *   ③ 管理端配额条**必须两支常驻**（210 教训：整条 v-if="count>0" ⇒ 无待办时入口彻底消失
 *      ⇒ 历史申请单永久不可达）。
 *   ④ 受理弹窗默认页签**必须** `count > 0 ? 'pending' : 'all'`（⛔ 恒 'pending' ⇒ 白修）。
 *   ⑤ 受理二次确认文案必须点明「**不会自动充值到账**」（决策 3 的对外口径）。
 *   ⑥ 入口红点**合并计数**（VIP ＋ 采购），title 分开描述。
 *   ⑦ 个人中心提示条**排除 admin**（admin 走「平台池兜底」、不被自己额度拦截，
 *      且=平台方 ⇒ 不引导采购；见设计文档身份表「—（池兜底）」）。
 *
 * ⚠️ 三条铁律（都是本项目踩过的坑）：
 *   - 只做字面量匹配＝**假绿灯**（208）⇒ 断言必须落在**使用点/切片**；
 *   - **扫源码必先剥注释**（211 的镜像）：本文件曾用 RAW 源码断言，结果被
 *     注释里的代码样例（HTML 注释里写着 `v-if="quotaPendingCount > 0"`、`quotaContactText()`）
 *     满足了 ⇒ 变异测试 2/7 漏检。现全部走 `stripAll()`，且切片锚点只用**代码锚点**。
 *   - 切片自检必须让「锚点消失」变成**响亮失败**，而不是静默切到文件尾（211）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC = path.join(REPO_ROOT, 'frontend', 'src')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf-8')

/**
 * 去注释（HTML ＋ JS 块 ＋ JS 行），**保留字符串与代码**。
 * ⚠️ 行注释只认「行首(可缩进)」与「空白后的 // 且注释里不含引号」两种形态，
 *    避免把 `'https://…'` 这类字符串从中间切断。
 */
function stripAll(src) {
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, '')          // HTML 注释
    .replace(/\/\*[\s\S]*?\*\//g, '')          // JS 块注释
    .replace(/^[ \t]*\/\/.*$/gm, '')           // 整行 JS 行注释
    .replace(/[ \t]\/\/[^\n"'`]*$/gm, '')      // 行尾 JS 行注释（// 前必须是空白）
}

/** 取 [from, to) 切片并自检：起点/终点必须命中、切片非空，否则抛（让锚点改动变成响亮失败） */
function slice(src, from, to) {
  const i = src.indexOf(from)
  if (i === -1) throw new Error(`切片起点未命中: ${from}`)
  const j = to ? src.indexOf(to, i + from.length) : -1
  if (to && j === -1) throw new Error(`切片终点未命中: ${to}`)
  const out = to ? src.slice(i, j) : src.slice(i)
  if (!out.trim()) throw new Error(`切片为空: ${from}`)
  return out
}

describe('① 采购弹窗：联系方式单点 ＋ 端点正确', () => {
  const file = 'components/QuotaPurchaseDialog.vue'

  it('script 里真正调用 quotaContactText()（不是只 import）', () => {
    // 🔴 只切 <script>：模板注释里也写着 quotaContactText()，用 RAW 源码会假绿灯
    const seg = stripAll(slice(read(file), '<script setup>', '</script>'))
    expect(seg).toContain("from '@/utils/quotaContact'")
    expect(seg).toMatch(/quotaContactText\(\)/)
    expect(seg).toContain('contactText')
  })

  it('⛔ 不就地硬编码联系方式', () => {
    const s = stripAll(read(file))
    expect(s).not.toContain('徐经理')
    expect(s).not.toContain('138 1779 1741')
    expect(s).not.toContain('jyo@youshi-tech.com')
  })

  it('提交打 /quota-requests', () => {
    expect(stripAll(read(file))).toContain("api.post('/quota-requests'")
  })

  it('必填字段齐全（与服务端同口径）＋ 不上屏单价', () => {
    const s = stripAll(read(file))
    for (const k of ['company', 'department', 'contact_name', 'contact_email', 'contact_phone', 'want_amount']) {
      expect(s).toContain(k)
    }
    expect(s).not.toMatch(/unit_price|unitPrice|单价/)
  })
})

describe('② 个人中心：阈值单点 ＋ 弹窗挂载 ＋ 状态回显', () => {
  const file = 'views/MyAccountView.vue'

  it('配额卡：阈值走常量，⛔ 无裸数字阈值', () => {
    const seg = stripAll(slice(read(file), 'class="quota-card"', 'class="history-dialog dialog-fancy"'))
    expect(seg).toMatch(/QUOTA_WARN_THRESHOLD/)
    expect(seg).toMatch(/availableQuota\s*<=\s*QUOTA_WARN_THRESHOLD/)
    // 反例：把阈值就地写死（≥1 的字面量）；`<= 0` 是「已用尽」的边界语义，合法
    expect(seg).not.toMatch(/availableQuota\s*<=\s*[1-9]\d*/)
    expect(seg).toContain('quota-warn')
  })

  it('🔴 提示条对 admin 不显示（admin 走池兜底，不引导采购）', () => {
    const seg = stripAll(slice(read(file), 'class="quota-card"', 'class="history-dialog dialog-fancy"'))
    // 判据必须同时含 userStore.user（防 user 未就位时 isAdmin 暂判 false ⇒ 提示条闪烁）＋ !isAdmin（排除平台方）
    expect(seg, '配额卡提示条必须排除 admin').toMatch(
      /quotaApplyLoaded\s*&&\s*userStore\.user\s*&&\s*!isAdmin\s*&&\s*userStore\.availableQuota\s*<=\s*QUOTA_WARN_THRESHOLD/
    )
    // 反例：去掉 !isAdmin（＝退回「所有账号都显示」的旧形态）⇒ 必须报红
    expect(seg, '⛔ 判据不得退回「不排除 admin」').not.toMatch(/quotaApplyLoaded\s*&&\s*userStore\.availableQuota/)
    // isAdmin 必须真的定义（否则模板里的 !isAdmin 恒 undefined ⇒ 静默不生效，白改）
    const script = stripAll(slice(read(file), '<script setup>', '</script>'))
    expect(script, 'isAdmin 必须是 computed').toMatch(/const\s+isAdmin\s*=\s*computed\(/)
  })

  it('配额卡：三态回显（pending / accepted / rejected）', () => {
    const seg = stripAll(slice(read(file), 'class="quota-card"', 'class="history-dialog dialog-fancy"'))
    expect(seg).toContain("quotaApply?.status === 'pending'")
    expect(seg).toContain("quotaApply?.status === 'accepted'")
    expect(seg).toContain("quotaApply?.status === 'rejected'")
  })

  it('挂载 QuotaPurchaseDialog 并接 submitted', () => {
    const seg = stripAll(slice(read(file), '<QuotaPurchaseDialog', '<PurchaseImportDialog'))
    expect(seg).toContain('quotaApplyDialogVisible')
    expect(seg).toContain('@submitted="onQuotaApplySubmitted"')
  })

  it('拉取 /api/quota-requests/mine（挂到 onMounted）', () => {
    const s = stripAll(read(file))
    expect(s).toContain("axios.get('/api/quota-requests/mine')")
    expect(s).toContain('fetchQuotaApply()')
  })
})

describe('③ 管理端：两支常驻 ＋ 默认页签 ＋ 受理只标记不充值', () => {
  const file = 'views/UsersView.vue'

  it('配额条两支常驻（v-if / v-else 成对）', () => {
    // 🔴 锚点在配额块**之外**：起始＝VIP 常驻条的按钮，终点＝用户表格容器。
    //    若起始锚点落在块内，`toContain('v-if="quotaPendingCount > 0"')` 就成了同义反复。
    const seg = stripAll(slice(read(file), 'openVipReview">查看记录</el-button>', 'class="users-table"'))
    expect(seg).toMatch(/v-if="quotaPendingCount > 0"/)
    expect(seg).toMatch(/v-else/)
    expect(seg).toContain('quota-pending-bar')
    expect(seg).toContain('openQuotaReview')
  })

  it('🔴 openQuotaReview 默认页签：pendingCount>0 ? pending : all', () => {
    const seg = stripAll(slice(read(file), 'const openQuotaReview = async () => {', 'const acceptQuotaRequest = async (row) => {'))
    expect(seg).toMatch(/quotaPendingCount\.value\s*>\s*0\s*\?\s*'pending'\s*:\s*'all'/)
    expect(seg).toContain('quotaReviewVisible.value = true')
  })

  it('🔴 受理确认文案点明「不会自动充值到账」＋ 打 accept 端点', () => {
    const seg = stripAll(slice(read(file), 'const acceptQuotaRequest = async (row) => {', 'const rejectQuotaRequest = async (row) => {'))
    expect(seg).toContain('不会自动充值到账')
    expect(seg).toMatch(/\/quota-requests\/\$\{row\.id\}\/accept/)
    expect(seg).toContain('ElMessageBox.confirm')     // 写操作必先二次确认
  })

  it('驳回打 reject 端点并带 review_note', () => {
    const seg = stripAll(slice(read(file), 'const rejectQuotaRequest = async (row) => {', 'const handleFilterChange = () => {'))
    expect(seg).toMatch(/\/quota-requests\/\$\{row\.id\}\/reject/)
    expect(seg).toContain('review_note')
  })

  it('onMounted 拉待处理计数', () => {
    expect(stripAll(read(file))).toContain('fetchQuotaPendingCount()')
  })
})

describe('④ 入口红点：合并计数 ＋ 分开描述', () => {
  const file = 'views/MainLayout.vue'

  it('pendingDotCount = vip + quota', () => {
    const seg = stripAll(slice(read(file), 'const pendingDotCount = computed(', 'const pendingDotTitle = computed('))
    expect(seg).toContain('vipPendingCount.value')
    expect(seg).toContain('quotaPendingCount.value')
    expect(seg).toMatch(/\+/)
  })

  it('红点判据用 pendingDotCount（⛔ 不再只看 VIP）', () => {
    const s = stripAll(read(file))
    expect(s).toMatch(/v-if="pendingDotCount > 0"/)
    expect(s).not.toMatch(/v-if="vipPendingCount > 0"/)
  })

  it('两路一起拉（onMounted / 轮询 / 可见性补拉 共用同一函数）', () => {
    const s = stripAll(read(file))
    expect(s).toContain('fetchPendingCounts')
    expect(s).toContain("axios.get('/api/quota-requests/pending-count')")
    expect(s).not.toMatch(/fetchUser\(\)\.then\(fetchVipPendingCount\)/)
  })
})
