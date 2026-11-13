/**
 * 认证四页「字段级校验错误」可访问性守卫（v1.13.361）
 *
 * ── 这份守卫取代了 v1.13.358 的 loginA11yGuard.test.js ────────────────────
 * 旧的 9 条里有 6 条是对着 LoginView **具体写法**的白盒断言（`:aria-invalid` 出现 2 次、
 * `.login-sr-only` 存在、`fieldErr = reactive(` 在 LoginView 里……）。361 把这套逻辑抽成
 * `utils/useFormErrorA11y.js` 后，这些断言全部失效 —— 但被保护的行为一条都没变少，
 * 所以这里是**等价替换而非放宽**：从「单页白盒」升级为「四页 + 逐字段配对」。
 *
 * ── 为什么钉这些点 ───────────────────────────────────────────────────────
 * 每个断言都对应一种「代码看着对、读屏用户依然一片沉默」的失效方式：
 *   ① 表单没接 @validate   ⇒ 拿不到 EP 的校验消息，只能自己编文案（两套必然漂移）
 *   ② 没登记进 composable 数组 ⇒ 该字段的错误被**静默忽略**（我最早写漏 email 就是这个）
 *   ③ 漏一个 v-bind         ⇒ 输入框没有 aria-invalid/describedby，聚焦时听不到原因
 *   ④ 漏一个 #error 插槽    ⇒ EP 默认节点回来，和我们那份并存 ⇒ 同一句念两遍
 *   ⑤ id 由两处手写        ⇒ errId() 与模板 :id 一旦漂移，aria-describedby 指向空节点
 *   ⑥ 活区用 display:none  ⇒ 元素一起被移出无障碍树，role=alert 彻底失效（比不加更糟）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const VIEWS = path.join(REPO, 'frontend/src/views')
const UTILS = path.join(REPO, 'frontend/src/utils')
const SCSS = path.join(REPO, 'frontend/src/assets/main.scss')

const read = (p) => fs.readFileSync(p, 'utf8')
const stripHtml = (src) => src.replace(/<!--[\s\S]*?-->/g, '')
function stripJs(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 四个认证页：prefix 必须与各页 useFormErrorA11y 的第二个参数一致 */
const PAGES = [
  { file: 'LoginView.vue', prefix: 'login', fields: ['username', 'password'] },
  { file: 'RegisterView.vue', prefix: 'reg', fields: ['username', 'email', 'password', 'confirmPassword'] },
  { file: 'ForgotPasswordView.vue', prefix: 'forgot', fields: ['email'] },
  { file: 'ResetPasswordView.vue', prefix: 'reset', fields: ['password', 'confirmPassword'] }
]

/** 只截 <template>…<script setup>，避免脚本里的字符串（如 errId('email') 的调用）撞上模板断言 */
function loadPage(file) {
  const raw = read(path.join(VIEWS, file))
  return {
    raw,
    tpl: stripHtml(raw).split('<script setup>')[0],
    script: stripJs(raw.split('<script setup>')[1] || '')
  }
}

describe('认证四页字段级错误可访问性（v1.13.361）', () => {
  for (const p of PAGES) {
    describe(p.file, () => {
      const { tpl, script } = loadPage(p.file)

      it('① 表单接了 @validate，且处理函数叫 onValidate', () => {
        expect(tpl, `${p.file} 缺少 @validate="onValidate"，拿不到 EP 的校验消息`).toContain(
          '@validate="onValidate"'
        )
      })

      it('② 存在留在无障碍树里的 role="alert" 活区', () => {
        expect(tpl, `${p.file} 缺少活区节点`).toMatch(
          /<div\s+class="sr-only"\s+role="alert"\s+aria-live="assertive"\s*>\s*\{\{\s*liveErr\s*\}\}\s*<\/div>/
        )
      })

      it('③ composable 登记的字段与 el-form-item 的 prop 完全一致', () => {
        // 少登记一个 ⇒ 该字段错误被静默忽略；多登记一个 ⇒ 永远拿不到值
        const m = script.match(/useFormErrorA11y\(\s*\[([^\]]*)\]\s*,\s*'([^']+)'\s*\)/)
        expect(m, `${p.file} 没有调用 useFormErrorA11y([...], 'prefix')`).toBeTruthy()
        const registered = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
        expect(registered, `${p.file} 登记字段与期望不符`).toEqual(p.fields)
        expect(m[2], `${p.file} 的 id 前缀必须是 '${p.prefix}'`).toBe(p.prefix)

        const props = [...tpl.matchAll(/<el-form-item[^>]*\bprop="([^"]+)"/g)].map((x) => x[1])
        expect(props, `${p.file} 模板里的 prop 与登记字段不一致（新增字段时漏改一处）`).toEqual(
          p.fields
        )
      })

      it('④ 每个字段都绑了 fieldAria（缺一个就是半个修复）', () => {
        const bound = [...tpl.matchAll(/v-bind="fieldAria\('([^']+)'\)"/g)].map((x) => x[1])
        expect(bound.sort(), `${p.file} 的 fieldAria 绑定与字段不匹配`).toEqual(
          [...p.fields].sort()
        )
      })

      it('⑤ 每个字段的错误节点都用自己的 errId()，不许手写 id', () => {
        const ids = [...tpl.matchAll(/:id="errId\('([^']+)'\)"/g)].map((x) => x[1])
        expect(ids.sort(), `${p.file} 的 errId 与字段不匹配`).toEqual([...p.fields].sort())
        // 手写 id="xxx-err-yyy" 会与 errId() 的产出脱钩 ⇒ describedby 指向空节点
        const hard = tpl.match(/\bid="[a-z]+-err-[A-Za-z]+"/g) || []
        expect(hard, `${p.file} 出现了手写的错误节点 id：${hard.join(', ')}`).toEqual([])
      })

      it('⑥ #error 插槽数与 prop 数一致（漏一个 ⇒ 同一句错误念两遍）', () => {
        const slots = (tpl.match(/#error=/g) || []).length
        expect(slots, `${p.file} 的 #error 插槽数量应为 ${p.fields.length}`).toBe(p.fields.length)
        const cls = (tpl.match(/class="el-form-item__error"/g) || []).length
        expect(cls, `${p.file} 接管后必须自己带上 el-form-item__error 类，否则红字样式全丢`).toBe(
          p.fields.length
        )
      })

      it('⑦ 模板里不许再渲染一份 fieldErr（双份文案）', () => {
        expect(tpl).not.toMatch(/\{\{\s*fieldErr\./)
      })

      it('⑧ 不许绕过 fieldAria 手写 aria-invalid（会让 describedby 与 id 脱钩）', () => {
        expect(tpl, `${p.file} 直接绑了 :aria-invalid，应改用 v-bind="fieldAria(...)"`).not.toMatch(
          /:aria-invalid=/
        )
        expect(tpl, `${p.file} 直接绑了 :aria-describedby，应改用 v-bind="fieldAria(...)"`).not.toMatch(
          /:aria-describedby=/
        )
      })
    })
  }
})

describe('useFormErrorA11y 实现（单一来源）', () => {
  const src = stripJs(read(path.join(UTILS, 'useFormErrorA11y.js')))

  it('① 全项目只有这一份实现', () => {
    const files = fs
      .readdirSync(UTILS)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => read(path.join(UTILS, f)).includes('export function useFormErrorA11y'))
    expect(files, `useFormErrorA11y 出现了多份实现：${files.join(', ')}`).toEqual([
      'useFormErrorA11y.js'
    ])
  })

  it('② 校验通过时必须清空该字段错误', () => {
    expect(src).toMatch(/fieldErr\[prop\]\s*=\s*isValid\s*\?\s*''\s*:\s*message/)
  })

  it('③ aria-describedby 必须由 errId() 产出（不能另拼一套 id）', () => {
    expect(src).toMatch(/'aria-describedby':\s*fieldErr\[prop\]\s*\?\s*errId\(prop\)/)
    expect(src).toMatch(/const errId = \(prop\) =>/)
  })

  it('④ 同一句错误重复出现时要有强制重播（否则第二次点提交一片沉默）', () => {
    expect(src, '缺少「同文案先清空再写回」的重播逻辑').toMatch(
      /liveErr\.value\s*===\s*text[\s\S]{0,120}?liveErr\.value\s*=\s*''/
    )
  })

  it('⑤ 多字段报错合并成一句，且文案**取自 fieldErr**（不许第二套文案）', () => {
    // 继承自 358 旧守卫⑤：活区文本必须与字段状态同源，否则两套文案必然漂移
    expect(src, '活区文案没从 fieldErr 取值').toMatch(/fields\.map\(\(f\)\s*=>\s*fieldErr\[f\]\)/)
    expect(src, '多字段没合并成一句，读屏会连念 N 遍').toMatch(/\.join\(joiner\(\)\)/)
  })
})

describe('全局 .sr-only（视觉隐藏但留在无障碍树里）', () => {
  const scss = read(SCSS)
  const block = (scss.match(/\.sr-only\s*\{[^}]*\}/) || [''])[0]

  it('① 全局类存在', () => {
    expect(block, 'main.scss 缺少 .sr-only 定义').not.toBe('')
  })

  it('② 绝不能用 display:none / visibility:hidden', () => {
    expect(block, 'display:none 会让 role=alert 活区一起失效').not.toMatch(/display\s*:\s*none/)
    expect(block, 'visibility:hidden 同样会失效活区').not.toMatch(/visibility\s*:\s*hidden/)
  })

  it('③ 用 clip + clip-path 隐藏', () => {
    expect(block).toMatch(/clip\s*:\s*rect/)
    expect(block).toMatch(/clip-path\s*:\s*inset/)
  })

  it('④ 认证四页不许再各自造一套局部 sr-only', () => {
    for (const p of PAGES) {
      const raw = read(path.join(VIEWS, p.file))
      expect(raw, `${p.file} 又定义了局部 sr-only 类`).not.toMatch(/\.[a-z-]*sr-only\s*\{/)
    }
  })

  it('⑤ 不许用 CSS content 伪造 role（role 不是可继承属性，纯伪方案）', () => {
    // 继承自 358 旧守卫⑦：这条看着无聊，但它防的是「加个 ✕ 前缀就当活区」这类伪修复
    for (const p of PAGES) {
      const raw = read(path.join(VIEWS, p.file))
      const style = (raw.match(/<style[\s\S]*?<\/style>/) || [''])[0]
      expect(style, `${p.file} 里出现了用 content 伪造 role 的写法`).not.toMatch(
        /content\s*:\s*['"]alert['"]/
      )
    }
  })
})

describe('EP 自带 role=alert 的组件 —— 不要重复补活区', () => {
  it('el-message / el-alert 的 role=alert 确实存在（本批结论的前提）', () => {
    const EP = path.join(REPO, 'frontend/node_modules/element-plus/es/components')
    const msg = read(path.join(EP, 'message/src/message.vue_vue_type_script_setup_true_lang.mjs'))
    const alert = read(path.join(EP, 'alert/src/alert.vue_vue_type_script_setup_true_lang.mjs'))
    expect(msg, 'EP 换了 Message 实现 ⇒ 需重新评估「toast 已可访问」这个前提').toMatch(
      /role:\s*"alert"/
    )
    expect(alert, 'EP 换了 Alert 实现 ⇒ 需重新评估状态切换播报').toMatch(/role:\s*"alert"/)
  })
})
