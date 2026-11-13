/**
 * 登录页表单错误可访问性守卫（E1 / v1.13.358）。
 *
 * 背景：第三方 a11y 审计报「校验错误无 role=alert / aria-live，输入框无 aria-invalid /
 * aria-describedby」。实测（Chrome 无障碍树）确认成立：EP 2.13.7 的 form-item **根本不写
 * role**，`role` 也不能靠 CSS 加 —— 只能在 Vue 侧自己补。
 *
 * 这里钉的每一条，都对应一个「改了不会报错、但读屏用户依然什么也听不到」的坑：
 *   ① 不接 @validate ⇒ 拿不到 EP 的校验消息，只能自己编文案（两套文案必然漂移）
 *   ② aria-describedby 指向一个模板里不存在的 id ⇒ 属性看着有，读屏读到空
 *   ③ 活区用 display:none 隐藏 ⇒ 元素同时被移出无障碍树，role=alert 彻底失效
 *   ④ 只加 role=alert 不给输入框 aria-invalid ⇒ 聚焦时不知道这个框是错的
 *   ⑤ 只加 aria-invalid 不给 describedby ⇒ 知道错了，不知道为什么错
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const LOGIN = path.join(REPO, 'frontend/src/views/LoginView.vue')

const read = (p) => fs.readFileSync(p, 'utf8')
/** 剥 HTML 注释（.vue 模板）。 */
const stripHtml = (src) => src.replace(/<!--[\s\S]*?-->/g, '')
/** 剥 JS 注释 —— 否则注释里的示例代码会被当成真代码（本项目踩过多次）。 */
function stripJs(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const raw = read(LOGIN)
const src = stripJs(stripHtml(raw))
/** 模板片段：只截 <template>…<script setup>，避免脚本里的字符串撞上模板断言。 */
const tpl = stripHtml(raw).split('<script setup>')[0]
const styleTag = (raw.match(/<style[\s\S]*?<\/style>/) || [''])[0]

describe('登录页表单错误可访问性（E1）', () => {
  it('① 表单用 @validate 收口 —— 消息必须来自 EP，不许自己编', () => {
    expect(tpl, '缺少 @validate，拿不到 EP 的校验消息').toMatch(/@validate\s*=\s*"/)
    // 回调必须真的用第三个参数（EP 签名：prop, isValid, message）
    expect(src, 'onValidate 没用 EP 给的 message 参数').toMatch(
      /onValidate\s*=\s*\([^)]*message[^)]*\)\s*=>/
    )
  })

  it('② 两个输入框都绑 aria-invalid（缺一个就是半个修复）', () => {
    const n = (tpl.match(/:aria-invalid=/g) || []).length
    expect(n, '用户名/密码两个 el-input 都要绑 :aria-invalid').toBe(2)
  })

  it('③ aria-describedby 指向的 id 必须在模板里真实存在', () => {
    const ids = [...tpl.matchAll(/:aria-describedby="[^"]*?'([A-Za-z0-9_-]+)'[^"]*"/g)].map(
      (m) => m[1]
    )
    expect(ids.length, '没找到 aria-describedby 绑定').toBeGreaterThan(0)
    for (const id of ids) {
      expect(tpl, `aria-describedby 指向 "${id}"，但模板里没有 id="${id}" 的节点`).toContain(
        `id="${id}"`
      )
    }
  })

  it('④ 存在 role="alert" 活区，且 sr-only 类不能是 display:none', () => {
    expect(tpl, '缺少 role="alert" 活区').toMatch(/role="alert"/)
    // 🔴 display:none / visibility:hidden 会把元素移出无障碍树 ⇒ 活区失效
    expect(styleTag, 'sr-only 类缺失').toMatch(/\.login-sr-only\s*\{/)
    expect(styleTag, 'sr-only 用 display:none 会让 role=alert 失效').not.toMatch(
      /\.login-sr-only\s*\{[^}]*display\s*:\s*none/
    )
    expect(styleTag, 'sr-only 用 visibility:hidden 同样会失效活区').not.toMatch(
      /\.login-sr-only\s*\{[^}]*visibility\s*:\s*hidden/
    )
    // 视觉隐藏的唯一正确姿势：clip / clip-path
    expect(styleTag, 'sr-only 缺少 clip 隐藏').toMatch(/\.login-sr-only\s*\{[\s\S]{0,400}?clip\s*:/)
  })

  it('⑤ 活区文案与字段描述同源（同一份 fieldErr），不许两套文案', () => {
    expect(src, '缺少 fieldErr 状态').toMatch(/fieldErr\s*=\s*reactive\(/)
    // 活区必须是 computed 且**从 fieldErr 取值**（多行函数体也要覆盖，故不用 [^)]*）
    expect(src, '活区文案没取 fieldErr，出现了第二套文案').toMatch(
      /liveErr\s*=\s*computed\([\s\S]{0,400}?fieldErr\.(?:username|password)/
    )
  })

  it('⑥ 校验通过时必须清空错误（否则错误播报永远挂着）', () => {
    // 三元式写法：fieldErr[prop] = isValid ? '' : message
    expect(src, '校验通过未清空对应字段的错误').toMatch(
      /fieldErr\[[^\]]+\]\s*=\s*isValid\s*\?\s*''/
    )
  })

  it('⑦ 不许用 CSS content 伪造 role（伪方案，role 不是可继承属性）', () => {
    expect(styleTag).not.toMatch(/content\s*:\s*['"]alert['"]/)
  })

  it('⑧ 用 #error 插槽接管默认错误节点，且保留 el-form-item__error 类', () => {
    const slots = (tpl.match(/#error=/g) || []).length
    expect(slots, '两个字段都要用 #error 插槽接管').toBe(2)
    // 给了插槽后 EP 不再渲染默认节点 ⇒ 类名必须由我们带上，否则红字样式/定位全丢
    const cls = (tpl.match(/class="el-form-item__error"/g) || []).length
    expect(cls, '#error 插槽内的节点必须带 class="el-form-item__error"').toBe(2)
  })

  it('⑨ 模板不许再渲染一份 fieldErr 文本（否则同一句错误念两遍）', () => {
    // 实测踩过：EP 默认节点 + 自建 sr-only 节点并存 ⇒ 无障碍树里两句一模一样的文本
    expect(tpl, '模板里出现了第二份错误文案').not.toMatch(/\{\{\s*fieldErr\./)
  })
})
