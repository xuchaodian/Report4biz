/**
 * 「品牌 → 业态」用户记忆 + 弹窗补业态体验 守卫 —— v1.13.422
 *
 * 起因（业主 2026-11-26）：
 *   点「选址立项报告」里的「生成 AI 建议」被拦下，提示「该品牌未收录业态」，
 *   业主的问题是「我该在哪里补充业态？」—— 说明界面上**没让人看见**那个输入框。
 *
 * 本批三条改动，逐条钉住：
 *   ① 拦截时聚焦 + 高亮输入框，文案指明「在下方输入框」；
 *   ② 用户填过的业态按品牌记在本机，下次开报告自动带出（关窗仍要清空，⛔ 不许串点位）；
 *   ③ 未收录品牌**一直显示**该行（带记忆值时变成「可直接修改」），
 *      旧写法 `!mapped && !categoryInput.trim()` 会在填完后把框藏掉 ⇒ 无法确认也无法改。
 *
 * 两类用例：
 *   【运行时】真的 import `brandCategoryMemory.js` 跑读写/隔离/裁剪；
 *   【源码】钉住组件里的四条行为判据（⛔ 只断言"有这行代码"不够，要断言退回旧写法会红）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

const COMP = read('frontend/src/components/CandidateReport.vue')
const MEM = read('frontend/src/utils/brandCategoryMemory.js')

/** 剥注释：断言"不许出现某写法"前必须做，否则注释里的反面教材会把自己判红 */
function strip(s) {
  return String(s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const COMP_CODE = strip(COMP)
const MEM_CODE = strip(MEM)

/** 取一段源码（从 start 标记到 end 标记），找不到直接失败 —— 防止改名后守卫静默失效 */
function seg(src, startMark, endMark, span = 3000) {
  const a = src.indexOf(startMark)
  expect(a, `找不到起始标记：${startMark}`).toBeGreaterThan(-1)
  const b = endMark ? src.indexOf(endMark, a) : -1
  return b > a ? src.slice(a, b) : src.slice(a, a + span)
}

// ── 运行时要一个最小的 localStorage/sessionStorage（Node 默认没有） ──────────
class FakeStorage {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(String(k)) ? this.m.get(String(k)) : null }
  setItem(k, v) { this.m.set(String(k), String(v)) }
  removeItem(k) { this.m.delete(String(k)) }
  clear() { this.m.clear() }
}
const ls = new FakeStorage()
const ss = new FakeStorage()
globalThis.localStorage = ls
globalThis.sessionStorage = ss

const { loadBrandCategories, getSavedCategory, saveCategory, forgetCategory } =
  await import('../../frontend/src/utils/brandCategoryMemory.js')

beforeEach(() => {
  ls.clear()
  ss.clear()
})

describe('A. 记忆读写（运行时：真实函数）', () => {
  it('A1 取不到 uid ⇒ 不读不写（⛔ 绝不落到别人的档）', () => {
    ss.clear()                                  // 未登录：sessionStorage 无 userId / token
    expect(saveCategory('优事', '日式简餐')).toBe(false)
    expect(getSavedCategory('优事')).toBe('')
    // 整盘没有任何 key 被写出来
    expect(ls.m.size).toBe(0)
  })

  it('A2 有 uid ⇒ 存了能读回，key 带 uid', () => {
    ss.setItem('userId', '7')
    expect(saveCategory('优事', '日式简餐')).toBe(true)
    expect(getSavedCategory('优事')).toBe('日式简餐')
    expect([...ls.m.keys()]).toEqual(['brandCategory_7'])
  })

  it('A3 不同账号互不可见（198 串档事故的同族防线）', () => {
    ss.setItem('userId', '7')
    saveCategory('优事', '日式简餐')
    ss.setItem('userId', '8')
    expect(getSavedCategory('优事')).toBe('')
    saveCategory('优事', '便利店')
    expect(getSavedCategory('优事')).toBe('便利店')
    ss.setItem('userId', '7')
    expect(getSavedCategory('优事')).toBe('日式简餐')
  })

  it('A4 同品牌再填 ⇒ 覆盖（不是追加第二个名字）', () => {
    ss.setItem('userId', '7')
    saveCategory('优事', '日式简餐')
    saveCategory('优事', '日式牛肉饭快餐')
    expect(getSavedCategory('优事')).toBe('日式牛肉饭快餐')
    expect(Object.keys(loadBrandCategories())).toEqual(['优事'])
  })

  it('A5 超过 30 字截断（与输入框 maxlength 同口径）', () => {
    ss.setItem('userId', '7')
    saveCategory('优事', '日'.repeat(50))
    expect(getSavedCategory('优事').length).toBe(30)
  })

  it('A6 上限 80 条，超出丢最早写入的（防本地存储无限增长）', () => {
    ss.setItem('userId', '7')
    for (let i = 0; i < 85; i++) saveCategory(`品牌${i}`, `业态${i}`)
    const m = loadBrandCategories()
    expect(Object.keys(m).length).toBe(80)
    expect(m['品牌0']).toBeUndefined()          // 最早 5 条被挤掉
    expect(m['品牌84']).toBe('业态84')          // 最新的还在
  })

  it('A7 脏数据（非 JSON / 数组 / 空值）不炸，按空处理', () => {
    ss.setItem('userId', '7')
    ls.setItem('brandCategory_7', 'not-json{{{')
    expect(loadBrandCategories()).toEqual({})
    ls.setItem('brandCategory_7', '[1,2,3]')
    expect(loadBrandCategories()).toEqual({})
    ls.setItem('brandCategory_7', '{"优事":""}')
    expect(getSavedCategory('优事')).toBe('')    // 空业态等于没记
  })

  it('A8 forgetCategory 能删掉一条，删不存在的返回 false', () => {
    ss.setItem('userId', '7')
    saveCategory('优事', '日式简餐')
    expect(forgetCategory('优事')).toBe(true)
    expect(getSavedCategory('优事')).toBe('')
    expect(forgetCategory('优事')).toBe(false)
  })
})

describe('B. 源码守卫：组件行为判据', () => {
  it('B1 记忆模块必须走 currentUser 取 uid，⛔ 不许自己读 localStorage.userId', () => {
    expect(MEM_CODE).toContain("from './currentUser.js'")
    expect(MEM_CODE).toContain('getCurrentUserId')
    expect(MEM_CODE).not.toMatch(/localStorage\.getItem\(\s*['"]userId['"]\s*\)/)
    // 也不许兜底成 admin(1)
    expect(MEM_CODE).not.toMatch(/\|\|\s*['"]1['"]/)
  })

  it('B2 输入框判据只看「白名单有无命中」，⛔ 不许再看 categoryInput 是否为空', () => {
    expect(COMP_CODE).toMatch(/const needCategory = computed\(\(\) => !resolvedCat\.value\.mapped\)/)
    expect(COMP_CODE, '又回退成「填完就藏框」').not.toMatch(/needCategory[\s\S]{0,80}categoryInput\.value\.trim\(\)/)
  })

  it('B3 业态为空被拦下时：聚焦/高亮 + 文案指明「下方输入框」', () => {
    const g = seg(COMP_CODE, 'async function genAi', 'async function exportPdf')
    expect(g).toContain('flashCategoryInput()')
    expect(g).toMatch(/请在下方输入框填写/)
    // ⛔ 旧文案只喊一句「请先填写业态」，用户会去找系统配置
    expect(g).not.toContain("'该品牌未收录业态，请先填写业态'")
    // 聚焦函数本身要真的 focus 那个 ref
    const f = seg(COMP_CODE, 'function flashCategoryInput', 'function genAi')
    expect(f).toContain('catInputRef')
    expect(f).toContain('focus')
  })

  it('B4 打开报告时按品牌带出上次填的业态（仅未收录品牌）', () => {
    const o = seg(COMP_CODE, 'async function onOpened', 'loading.value = true')
    expect(o).toContain('getSavedCategory(')
    expect(o).toMatch(/if \(!resolvedCat\.value\.mapped\)/)
  })

  it('B5 🔴 关窗仍要清空 categoryInput（记忆值靠 onOpened 重新带，⛔ 不靠"不清空"）', () => {
    // 这段是「上一个点位的业态串到下一个点位」的唯一防线，删了就是一个跨点位脏数据 bug
    const w = seg(COMP_CODE, 'watch(() => props.modelValue', 'catFlash.value = false')
    expect(w).toContain("categoryInput.value = ''")
  })

  it('B6 只有用户自己填的业态才入记忆（⛔ 拿记忆值覆盖白名单）', () => {
    const g = seg(COMP_CODE, 'async function genAi', 'async function exportPdf')
    // 调用点必须被 !mapped 包着
    expect(g).toMatch(/if \(!resolvedCat\.value\.mapped\)\s*saveCategory\(/)
  })
})
