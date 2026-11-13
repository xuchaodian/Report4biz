/**
 * ICP 备案号展示位守卫（v1.13.359）。
 *
 * 背景：产品要求「登录界面不显示备案号」。备案号原在 AuthCard.vue 里硬写，而这张卡片被
 * 5 个页面共用（登录/注册/忘记密码/重置密码/404），所以这里钉的不是「删掉那一行」，而是：
 *   ① 只能按页开关（showIcp），⛔ 不能把整段删掉 ⇒ 否则注册/找回/重置/404 一起丢
 *   ② 登录页必须显式关闭 ⇒ 光加 prop 不传值 = 默认 true，改动等于没做（假绿）
 *   ③ 官网首页页脚**必须仍然有**备案号 ⇒ 那才是工信部要求的「网站主页底部展示」的合规位；
 *      登录页是可选加固位，两处都删就是合规风险，不是清理
 *   ④ 备案号字面量只许出现在 AuthCard.vue（组件内单点）与 homepage/index.html（合规位）
 *      ⇒ 防止各处复制粘贴后，改一处漏三处、或某个页面偷偷渲染出来
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../..')
const CARD = path.join(REPO, 'frontend/src/components/AuthCard.vue')
const LOGIN = path.join(REPO, 'frontend/src/views/LoginView.vue')
const HOME = path.join(REPO, 'homepage/index.html')

const read = (p) => fs.readFileSync(p, 'utf8')
/** 剥 HTML 注释 —— 注释里写着备案号，不剥会把注释当渲染内容。 */
const stripHtml = (src) => src.replace(/<!--[\s\S]*?-->/g, '')

const ICP_NO = '沪ICP备2026010607号-1'

describe('ICP 备案号展示位', () => {
  const card = stripHtml(read(CARD))
  const login = stripHtml(read(LOGIN))
  const home = stripHtml(read(HOME))

  it('① AuthCard 提供 showIcp 开关且默认 true（其余认证页保持原样）', () => {
    expect(card, 'AuthCard 缺少 showIcp prop').toMatch(
      /showIcp\s*:\s*\{\s*type:\s*Boolean\s*,\s*default:\s*true/
    )
  })

  it('② 备案号节点受 v-if="showIcp" 控制（不是被删掉）', () => {
    // 取出那个 <a ...> 开标签本身再断言，避免误配到别处
    const tag = card.match(/<a\b[^>]*class="auth-card__icp"[^>]*>/)
    expect(tag, 'AuthCard 里找不到备案号链接节点（被删了？应改为按页开关）').toBeTruthy()
    expect(tag[0], '备案号节点没有 v-if="showIcp" ⇒ 开关无效').toMatch(
      /v-if="showIcp"/
    )
    // 防「绑定写成字符串」的假开关：v-if="'showIcp'" 恒真
    expect(tag[0]).not.toMatch(/v-if="'showIcp'"/)
  })

  it('③ 登录页显式关闭（:show-icp="false"），否则默认 true 等于没改', () => {
    const tag = login.match(/<AuthCard\b[\s\S]{0,220}?>/)
    expect(tag, 'LoginView 里找不到 AuthCard').toBeTruthy()
    expect(tag[0], 'LoginView 未传 :show-icp="false" ⇒ 登录页仍会显示备案号').toMatch(
      /:show-icp="false"/
    )
    // 大写/连字符写法都算同一属性；这里只防「传了 true」这种自我反转
    expect(tag[0]).not.toMatch(/:show-icp="true"/)
  })

  it('④ 官网首页页脚仍保留备案号 + 指向工信部（合规位，⛔ 不许删）', () => {
    expect(home, '官网首页页脚丢了备案号 —— 那是工信部要求的展示位').toContain(ICP_NO)
    const link = home.match(/<a\b[^>]*href="https:\/\/beian\.miit\.gov\.cn\/?"[^>]*>/)
    expect(link, '官网首页备案号未链到 beian.miit.gov.cn').toBeTruthy()
    expect(link[0], '外链缺 rel="noopener noreferrer"').toMatch(/rel="noopener noreferrer"/)
  })

  it('⑤ 备案号字面量只许出现在 AuthCard 与官网首页（防复制到各处）', () => {
    const srcDir = path.join(REPO, 'frontend/src')
    const hits = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(vue|js|ts|scss|css)$/.test(e.name) && read(p).includes(ICP_NO)) {
          hits.push(path.relative(REPO, p))
        }
      }
    }
    walk(srcDir)
    expect(hits, `备案号被复制到了多处：${hits.join(', ')}`).toEqual([
      path.join('frontend/src/components/AuthCard.vue')
    ])
  })
})
