/**
 * VIP 试用申请「审核入口常驻」守卫（v1.13.210 立）
 *
 * 背景缺陷（2026-10-12 真机取证发现）：
 *   205 把审核弹窗的两个入口都写成了 `v-if="vipPendingCount > 0"`：
 *     · views/UsersView.vue  「/users 页顶部橙色提示条」→ 其上的「去审核」按钮
 *     · views/MainLayout.vue 「个人下拉『用户管理』旁的红点」（且它只计数、不可点）
 *   而 `openVipReview()` 的调用点**全局只有提示条那一处** ⇒
 *     **待处理数 = 0 时，两个入口同时消失 ⇒ 弹窗无路可进 ⇒ 历史申请单在 UI 上永久不可达。**
 *   数据其实都在库里（`GET /api/vip-applications?status=all` 照常返回全字段），
 *   纯粹是「入口被计数绑死」的结构性缺陷 —— 管理员批准完一条后，连自己刚批的公司名都查不回来。
 *
 * 修法（方案 A）：
 *   ① `UsersView.vue` 提示条**常驻**：有待处理＝原橙色提示条；无待处理＝低饱和
 *      「VIP 试用申请记录 / 查看记录」入口，仍可进弹窗查历史；
 *   ② `openVipReview()` 默认页签条件化：有 pending 看 `pending`，没有看 `all`
 *      （否则从常驻入口进来仍是「暂无申请记录」，等于白修）；
 *   ③ `MainLayout.vue` 红点刷新时机修复：旧版只在 onMounted 拉一次 ⇒
 *      用户提交申请后管理员不刷新页面看不到红点。补 60s 轮询 + 恢复可见补拉 + 卸载清理。
 *
 * 本文件是**回归钉子**：
 *   ① 谁把提示条改回 `v-if="vipPendingCount > 0"` 单支（入口又消失）→ 立刻红；
 *   ② 谁把 `openVipReview` 的默认页签改回恒 `'pending'` → 立刻红；
 *   ③ 谁把红点的定时器/监听清理删掉（内存泄漏）→ 立刻红。
 * （前端无独立测试框架，故与 cspInlineHandlerGuard / destructiveActionConfirmGuard
 *   一致，挂在 backend 的 vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/** ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，pathname 会留下百分号编码导致 ENOENT */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src')

const read = (rel) => fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8')

/** 剥离注释后再判 —— 否则本文件头注释里的「旧写法举例」会自伤（208 守卫同款教训） */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/** 按大括号配平截出函数体（本用途下模板字符串里的 ${…} 是配平的，朴素计数即可） */
function extractFnBody(src, signature) {
  const start = src.indexOf(signature)
  if (start === -1) return null
  const braceStart = src.indexOf('{', start)
  if (braceStart === -1) return null
  let depth = 0
  for (let i = braceStart; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return src.slice(braceStart, i + 1)
    }
  }
  return null
}

describe('VIP 审核入口：管理员必须随时能查到申请记录', () => {
  const usersView = stripComments(read('views/UsersView.vue'))
  const iTpl = usersView.indexOf('<template>')
  const iScript = usersView.indexOf('<script setup>')
  // ⚠️ 模板断言必须只截 <template> … <script setup> 这一段。两个坑：
  //    ① ⛔ 不能用 indexOf('</template>') —— 模板里有大量内层 <template #default>，
  //       它们的闭合会先命中，切片被截早。
  //    ② ⛔ 更不能拿整份 .vue 判模板断言 —— SCSS 里的 `.vip-pending-bar--quiet`
  //       选择器会让「模板常驻支已删除」的负向样本**假绿**（本守卫首版即踩此坑，
  //       2026-10-12 负向验证抓出）。
  const tpl = iTpl > -1 && iScript > iTpl ? usersView.slice(iTpl, iScript) : ''

  it('模板切片成功（防止切片失败导致后续断言静默失效）', () => {
    expect(iTpl, '未找到 <template>').toBeGreaterThan(-1)
    expect(iScript, '未找到 <script setup>').toBeGreaterThan(iTpl)
    expect(tpl.length, '模板切片过短，疑似切片位置算错').toBeGreaterThan(1000)
  })

  it('UsersView 存在常驻的「记录」支（入口不被待处理数绑死）', () => {
    expect(
      tpl,
      '模板里缺少 vip-pending-bar--quiet 常驻支 —— 待处理数归零后入口会再次消失'
    ).toMatch(/vip-pending-bar--quiet/)
    // 常驻支必须排在 v-if 支之后，构成 v-if / v-else 两支
    const iIf = tpl.indexOf('v-if="vipPendingCount > 0"')
    const iElse = tpl.indexOf('vip-pending-bar--quiet')
    expect(iIf, '提示条的 v-if 支不见了，断言失效').toBeGreaterThan(-1)
    expect(iElse, '常驻支必须在 v-if 支之后（v-else）').toBeGreaterThan(iIf)
  })

  it('两个入口支都调用 openVipReview（弹窗的打开路径不被删掉）', () => {
    const calls = tpl.match(/@click="openVipReview"/g) || []
    expect(
      calls.length,
      `模板里 openVipReview 的调用点应恰为 2 处（有待处理「去审核」+ 常驻「查看记录」），实际 ${calls.length}`
    ).toBe(2)
  })

  it('弹窗可见性只由 openVipReview 开启（不存在第二条旁路）', () => {
    const opens = usersView.match(/vipReviewVisible\.value\s*=\s*true/g) || []
    expect(opens.length, 'vipReviewVisible 应只在一处被置 true（openVipReview）').toBe(1)
  })

  it('openVipReview 默认页签条件化：无 pending 时看「全部」而非空的「待处理」', () => {
    const body = extractFnBody(usersView, 'const openVipReview =')
    expect(body, '未找到 openVipReview —— 断言失效，请更新守卫').toBeTruthy()
    expect(
      body,
      "openVipReview 必须写成 vipPendingCount > 0 ? 'pending' : 'all'；" +
        "⛔ 恒置 'pending' 会让常驻入口点进去只看到「暂无申请记录」"
    ).toMatch(/vipPendingCount\.value\s*>\s*0\s*\?\s*'pending'\s*:\s*'all'/)
  })
})

describe('VIP 红点刷新时机：不得只在挂载时拉一次', () => {
  const main = stripComments(read('views/MainLayout.vue'))

  it('存在周期性刷新（轮询兜底）', () => {
    expect(main, 'MainLayout 缺少 setInterval —— 红点又变成「不刷新页面就看不到」').toMatch(/setInterval\(/)
    expect(main).toMatch(/fetchVipPendingCount\(\)/)
  })

  it('页面隐藏期间不发请求（避免后台标签页空转）', () => {
    expect(main, '轮询 tick 应有 document.hidden 早退').toMatch(/document\.hidden/)
  })

  it('组件卸载清理定时器与 visibilitychange 监听（防泄漏）', () => {
    expect(main, '缺少 onBeforeUnmount').toMatch(/onBeforeUnmount\(/)
    expect(main).toMatch(/clearInterval\(/)
    expect(main, 'visibilitychange 监听必须成对移除').toMatch(/removeEventListener\(\s*'visibilitychange'/)
  })

  it('红点仍按「有待处理才显示」渲染（常驻化只针对审核入口，不针对红点）', () => {
    expect(main).toMatch(/v-if="vipPendingCount > 0"/)
  })
})
