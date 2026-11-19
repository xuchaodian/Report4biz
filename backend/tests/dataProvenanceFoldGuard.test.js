/**
 * 数据口径卡「默认折叠」守卫（v1.13.377 / 2026-11-19）
 *
 * 背景：商圈洞察页（/district-insight）与销售预测页（/sales-forecast）各有一张
 * 结构相同的「数据口径」卡（文案统一来自 utils/dataProvenance.js）。原先进页即
 * 全部展开，占据首屏。本批改为：默认折叠，点标题展开。
 *
 * ── 钉死的不变量 ──────────────────────────────────────────────────────────
 * ① 展开头必须是原生 <button>（键盘可达）。历史教训（356 批次）：div + @click
 *    键盘永远进不去 —— ⛔ 不许把 .prov-toggle 改回 div/span。
 * ② 必须有 :aria-expanded="provOpen"，读屏才知道当前是展开还是收起。
 * ③ provOpen 默认必须为 false（每次进页折叠，不记忆状态）。
 * ④ 卡片内容用 v-if="provOpen" 包裹（折叠时连 DOM 都不渲染）。
 * ⑤ 箭头图标 .prov-arrow 随 provOpen 旋转（is-open），给用户视觉反馈。
 * ⑥ 两页都要改（结构本就相同），不许只改一页造成表现不一致。
 *
 * ⚠️ 剥注释再断言：模板里写了「原进页即显示」「照搬 fc-sim」等溯源注释，
 *    不剥注释会把注释里的旧写法当成真代码误报（§6.41 同类坑）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PAGES = [
  { name: '商圈洞察页', file: 'frontend/src/views/DistrictInsightView.vue' },
  { name: '销售预测页', file: 'frontend/src/views/SalesForecastView.vue' }
]
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 去掉 HTML 注释 `<!-- ... -->` 与 JS 整行 // 注释（保留字符串内 // 不影响本守卫） */
function stripComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
}

/** 取 <template> 段（模板断言只截 template，避免 script 里的同名 class 干扰） */
function templateOf(src) {
  const s = src.indexOf('<template>')
  const e = src.lastIndexOf('</template>')
  return s >= 0 && e > s ? src.slice(s, e) : ''
}

describe('数据口径卡默认折叠（v1.13.377）', () => {
  for (const page of PAGES) {
    const raw = read(page.file)
    const src = stripComments(raw)
    const tpl = templateOf(src)

    it(`${page.name}：展开头是原生 button 且带 aria-expanded`, () => {
      const m = tpl.match(/<button[^>]*class="prov-toggle"[^>]*>/)
      expect(m, `${page.name} 的 .prov-toggle 展开头缺失`).toBeTruthy()
      expect(m[0], '折叠头必须是原生 <button type="button">（键盘可达）')
        .toMatch(/<button\s+type="button"/)
      expect(m[0], '展开头必须绑定 :aria-expanded="provOpen"')
        .toMatch(/:aria-expanded="provOpen"/)
      expect(m[0], '点击必须切换 provOpen').toMatch(/@click="provOpen\s*=\s*!provOpen"/)
    })

    it(`${page.name}：provOpen 默认 false，内容用 v-if 包裹`, () => {
      expect(src, 'provOpen 必须声明为 ref(false)（默认折叠）')
        .toMatch(/const\s+provOpen\s*=\s*ref\(false\)/)
      expect(tpl, '口径内容必须用 v-if="provOpen" 包裹')
        .toMatch(/v-if="provOpen"\s+class="prov-body"/)
    })

    it(`${page.name}：箭头随状态旋转，且 CSS 有作用域样式`, () => {
      expect(tpl, '箭头图标需按 provOpen 加 is-open 类')
        .toMatch(/class="prov-arrow"\s+:class="\{\s*'is-open':\s*provOpen\s*\}"/)
      expect(src, '.prov-arrow.is-open 旋转样式不能丢').toMatch(/\.prov-arrow\.is-open\{transform:rotate\(180deg\)\}/)
      expect(src, '展开头键盘焦点样式 :focus-visible 不能丢').toMatch(/\.prov-toggle:focus-visible\{/)
    })

    it(`${page.name}：不得残留旧的静态标题结构`, () => {
      expect(tpl, '⛔ 旧 .prov-hd 静态标题头应已被 button 替换').not.toMatch(/class="prov-hd"/)
      // prov-grid 必须位于 v-if="provOpen" 的 prov-body 之后（即被折叠块包裹），
      // ⛔ 不能只判断它「不存在」——它仍然存在，只是位置在折叠块内。
      const bodyPos = tpl.indexOf('v-if="provOpen" class="prov-body"')
      const gridPos = tpl.indexOf('<dl class="prov-grid">')
      expect(bodyPos, 'prov-body 折叠块必须存在').toBeGreaterThan(-1)
      expect(gridPos, 'prov-grid 口径网格必须存在').toBeGreaterThan(-1)
      expect(gridPos, '⛔ prov-grid 必须落在 v-if 折叠块之后，不得无条件渲染')
        .toBeGreaterThan(bodyPos)
    })
  }
})
