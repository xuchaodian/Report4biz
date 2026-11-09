/**
 * 用户管理页「剩余次数 → 授权额度」换算守卫 —— v1.13.332（2026-11-09）
 *
 * 背景 bug（2026-07-24 `5a2f6ba` 引入，潜伏 3.5 个月）：
 *   该提交把 `totalQuota = form.remaining + form.usedQuota` 故意改成 `form.remaining`，
 *   commit 写「修复编辑用户时配额重复计算」，但**只改了这一个 Vue 文件、无后端配套**。
 *   后端从来是口径 A：`users.quota` = 累计授权额度，`remaining = max(0, quota − used)`
 *   （users.js:69 / purchase.js:147 / quotaGate.js / quotaPool.js:85 / orgs.js 增量写法）。
 *   ⇒ 前端把「剩余」当「授权」写回，后果三条：
 *     ① 只改邮箱/角色也会静默削掉一个已用量（diff=0 不弹确认、还写 decrease 履历）；
 *     ② 「增加配额」因 quotaDiff=0 变成**彻底空操作**，UI 却提示「更新成功」；
 *     ③ quota_history 被污染、全池虚增、集团可转出上限缩水，组织成员被 quotaGate 403 挡住。
 *
 * 修法：**基准值 + 差值** —— `form.quota + (form.remaining − originalRemaining.value)`。
 *   ⛔ 不用 `remaining + usedQuota`：admin 行 remainingQuota 为 null、历史账号 quota<used
 *      时 remaining 被 clamp 到 0，两者都会凭空「回补」额度并触发池校验。
 *
 * ⚠️ 铁律（本项目踩过）：**扫源码必先剥注释**，否则注释里讲解的旧写法会造成假绿灯；
 *    切片锚点必须自检，锚点消失要**响亮失败**而不是静默切到文件尾；
 *    只做字面量匹配＝假绿灯（208）⇒ 另配等价算术断言，验「行为」而非只验「字符串」。
 * （前端无独立测试框架，故与 quotaPurchaseGuard / vipGateGuard 一致，挂在 backend vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (...seg) => fs.readFileSync(path.join(REPO_ROOT, ...seg), 'utf-8')
const VIEW = () => read('frontend', 'src', 'views', 'UsersView.vue')

/** 去注释（Vue HTML 注释 + JS 块注释 + 整行/行尾 JS 注释），保留字符串与代码 */
function stripAll(src) {
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/[ \t]\/\/[^\n"'`]*$/gm, '')
}

/** 取 [from, to) 切片并自检：起点/终点必须命中，否则抛（让锚点改动变成响亮失败） */
function slice(src, from, to) {
  const i = src.indexOf(from)
  if (i === -1) throw new Error(`切片起点未命中: ${from}`)
  const j = to ? src.indexOf(to, i + from.length) : -1
  if (to && j === -1) throw new Error(`切片终点未命中: ${to}`)
  const out = to ? src.slice(i, j) : src.slice(i)
  if (!out.trim()) throw new Error(`切片为空: ${from}`)
  return out
}

describe('① 🔴 提交公式：基准值 + 差值，⛔ 绝不把「剩余」直接当「授权」', () => {
  const save = () => stripAll(slice(VIEW(), 'const handleSave = async () => {', 'const handleDisable = async (row) => {'))

  it('totalQuota 必须同时含 form.quota 基准与 originalRemaining 差值', () => {
    const seg = save()
    expect(seg).toMatch(/const\s+totalQuota\s*=\s*\(form\.quota\s*\|\|\s*0\)\s*\+\s*\(\(form\.remaining\s*\|\|\s*0\)\s*-\s*originalRemaining\.value\)/)
    expect(seg, 'updateData 必须真的用 totalQuota，不能留在原地没接上').toMatch(/quota:\s*totalQuota/)
  })

  it('⛔ 反例：退回「剩余即授权」必须报红', () => {
    const seg = save()
    expect(seg).not.toMatch(/const\s+totalQuota\s*=\s*\(form\.remaining\s*\|\|\s*0\)\s*$/m)
    expect(seg).not.toContain('不重复计算')
  })

  it('⛔ 反例：退回 remaining + usedQuota 必须报红（admin / quota<used 会凭空回补）', () => {
    const seg = save()
    expect(seg).not.toMatch(/totalQuota[\s\S]{0,120}\+\s*\(form\.usedQuota\s*\|\|\s*0\)/)
  })

  it('确认框的 diff 与提交公式同源（originalRemaining 在两处都出现）', () => {
    const seg = save()
    expect(seg).toContain("const diff = newRemaining - oldRemaining")
    expect((seg.match(/originalRemaining\.value/g) || []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('② 🔴 基准值不能丢：handleEdit 必须回显 row.quota，弹窗要显示授权额度', () => {
  it('handleEdit 给 form.quota 赋值（漏了 ⇒ 基准恒 0，公式静默退化回 bug）', () => {
    const seg = stripAll(slice(VIEW(), 'const handleEdit = (row) => {', 'const handleSave = async () => {'))
    expect(seg).toMatch(/quota:\s*row\.quota\s*\|\|\s*0/)
    expect(seg).toContain('usedQuota: row.usedQuota || 0')
    expect(seg).toContain('originalRemaining.value = editRemaining')
  })

  it('弹窗显示「当前授权额度」且不再承诺「自动换算为配额总数」', () => {
    const seg = stripAll(slice(VIEW(), '<el-form-item v-if="isEdit" label="剩余次数">', '</el-form-item>'))
    expect(seg).toContain('{{ form.quota }}')
    expect(seg).toContain('按剩余次数的增减量调整授权额度')
    expect(seg, '旧文案与实现不符，不得回潮').not.toContain('系统将自动换算为配额总数')
  })
})

describe('③ 等价算术：不改数字 ⇒ quota 不变；改 N 次 ⇒ quotaDiff 恰为 N', () => {
  // 与 UsersView.vue 的 totalQuota 表达式逐项对应；后端 quotaDiff = totalQuota − currentQuota
  const submit = (quota, remaining, originalRemaining) =>
    (quota || 0) + ((remaining || 0) - originalRemaining)

  it('S1 只改邮箱（quota=100/used=30/剩余70）⇒ 提交 100，零写入', () => {
    expect(submit(100, 70, 70)).toBe(100)
    expect(submit(100, 70, 70) - 100).toBe(0)   // backend users.js:446 quotaChanged=false
  })

  it('S2 想再加 30 次（填 100）⇒ 提交 130，quotaDiff=+30（修复前是空操作）', () => {
    expect(submit(100, 100, 70)).toBe(130)
    expect(submit(100, 100, 70) - 100).toBe(30)
  })

  it('S3 想减到剩 50 次（填 50）⇒ 提交 80，quotaDiff=−20，与确认框一致', () => {
    expect(submit(100, 50, 70)).toBe(80)
    expect(submit(100, 50, 70) - 100).toBe(-20)
  })

  it('🔴 S4 admin 行（quota=0、弹窗填 0）⇒ 提交 0，⛔ 不得凭空写成 usedQuota', () => {
    expect(submit(0, 0, 0)).toBe(0)
  })

  it('🔴 S5 历史账号 quota<used（quota=40/used=60/剩余被 clamp 成 0）⇒ 提交 40，⛔ 不得回补', () => {
    expect(submit(40, 0, 0)).toBe(40)
  })

  it('S6 生产当前（quota=0/used=0）⇒ 与修复前行为一致（零回归窗口）', () => {
    expect(submit(0, 0, 0)).toBe(0)
  })
})

describe('④ 后端口径 A 不许被动（改前端时顺手改后端 = 全链路分叉）', () => {
  it('GET /users 仍是 remaining = max(0, quota − used)', () => {
    const seg = stripAll(read('backend', 'src', 'routes', 'users.js'))
    expect(seg).toMatch(/const\s+remainingQuota\s*=\s*Math\.max\(0,\s*\(user\.quota\s*\|\|\s*0\)\s*-\s*usedQuota\)/)
  })

  it('PUT /:id 仍只在 quotaChanged 时写 users 与 quota_history', () => {
    const seg = stripAll(read('backend', 'src', 'routes', 'users.js'))
    expect(seg).toMatch(/const\s+quotaDiff\s*=\s*newQuota\s*-\s*currentUserQuota/)
    expect(seg).toMatch(/const\s+quotaChanged\s*=\s*quotaProvided\s*&&\s*quotaDiff\s*!==\s*0/)
    expect(seg).toContain('if (quotaChanged) {')
  })
})
