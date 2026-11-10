/**
 * 竞品导入后「品牌竞品映射」提示判据守卫 —— v1.13.348
 *
 * 背景：344 起竞品按「自有品牌 → 竞品品牌集合」分池统计。未配置映射的品牌会退回**全量**，
 *   于是多品牌账号（生产实测：滨寿司 + 食其家）的竞品被加在一起 ⇒ 竞争分/信号灯偏红。
 *   入口放在「导入竞品门店成功」之后：那是用户刚灌进新品牌竞品的时刻，也是他最可能顺手配置的时刻。
 *
 * 本文件钉四件事：
 *   A. 只在「≥2 个自有品牌 且 存在未配置品牌」时提示 —— 单品牌、全配好，一律闭嘴
 *   B. 「已配置」以 **key 是否存在** 为准，配成空数组也算已配置（⛔ 不能用「值非空」判断）
 *   C. 归一（大小写/空白）必须与后端 normalizeBrand 一致
 *   D. CompetitorView 真的在导入成功回调里接了这个判据（⛔ 防以后被顺手删掉）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideBrandMapPrompt, buildBrandMapPromptText } from '../../frontend/src/utils/brandMapPrompt.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

describe('A. 什么时候该提示', () => {
  it('单品牌账号：不提示（不存在多品牌竞品混算）', () => {
    const d = decideBrandMapPrompt({ myBrands: ['滨寿司'], scopes: {} })
    expect(d.prompt).toBe(false)
    expect(d.reason).toBe('single-brand')
  })

  it('一个品牌都没有（新账号还没导门店）：不提示', () => {
    const d = decideBrandMapPrompt({ myBrands: [], scopes: {} })
    expect(d.prompt).toBe(false)
    expect(d.total).toBe(0)
  })

  it('双品牌且都没配置：提示，missing 列出两个品牌', () => {
    const d = decideBrandMapPrompt({ myBrands: ['滨寿司', '食其家'], scopes: {} })
    expect(d.prompt).toBe(true)
    expect(d.missing).toEqual(['滨寿司', '食其家'])
    expect(d.total).toBe(2)
    expect(d.reason).toBe('missing-scope')
  })

  it('双品牌、只配了一个：提示，且只列没配的那个', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家'],
      scopes: { 滨寿司: ['寿司郎'] }
    })
    expect(d.prompt).toBe(true)
    expect(d.missing).toEqual(['食其家'])
  })

  it('两个品牌都配过了：不提示（纯噪音）', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家'],
      scopes: { 滨寿司: ['寿司郎'], 食其家: ['吉野家'] }
    })
    expect(d.prompt).toBe(false)
    expect(d.reason).toBe('all-configured')
  })

  it('🔴 配成空数组也算「已配置」——⛔ 不许当成未配置反复骚扰', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家'],
      scopes: { 滨寿司: [], 食其家: [] }
    })
    expect(d.prompt).toBe(false)
    expect(d.reason).toBe('all-configured')
  })

  it('一个配空数组、一个配了竞品：都不提示', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家'],
      scopes: { 滨寿司: [], 食其家: ['吉野家'] }
    })
    expect(d.prompt).toBe(false)
  })
})

describe('B. 本次导入的品牌优先', () => {
  it('本次导入的品牌恰好未配置 ⇒ 优先选它，并标记 justImportedMissing', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家'],
      scopes: { 滨寿司: ['寿司郎'] },
      justImportedBrand: '食其家'
    })
    expect(d.preferred).toBe('食其家')
    expect(d.justImportedMissing).toBe(true)
  })

  it('本次导入的品牌已配置 ⇒ preferred 落到另一个未配置品牌，justImportedMissing=false', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家'],
      scopes: { 滨寿司: ['寿司郎'] },
      justImportedBrand: '滨寿司'
    })
    expect(d.preferred).toBe('食其家')
    expect(d.justImportedMissing).toBe(false)
  })

  it('没传 justImportedBrand ⇒ preferred 取 missing 第一个（按 myBrands 顺序）', () => {
    const d = decideBrandMapPrompt({ myBrands: ['食其家', '滨寿司'], scopes: {} })
    expect(d.preferred).toBe('食其家')
  })

  it('justImportedBrand 传了不在 myBrands 里的值 ⇒ 不误判为本次导入缺失', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家'],
      scopes: {},
      justImportedBrand: '某个不存在的品牌'
    })
    expect(d.justImportedMissing).toBe(false)
    expect(d.preferred).toBe('滨寿司')
  })
})

describe('C. 归一化（与后端 normalizeBrand 一致）', () => {
  it('映射 key 带空格/小写，仍能与门店品牌对上', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家'],
      scopes: { ' 滨寿司 ': ['寿司郎'] }
    })
    expect(d.missing).toEqual(['食其家'])
  })

  it('英文品牌大小写不一致算同一个', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['sushiro', 'SUKIYA'],
      scopes: { Sushiro: ['kura'] }
    })
    expect(d.missing).toEqual(['SUKIYA'])
  })

  it('品牌去重 + 过滤空串/纯空白，避免虚增品牌数触发误提示', () => {
    const d = decideBrandMapPrompt({ myBrands: ['滨寿司', '滨寿司', '', '   ', null], scopes: {} })
    expect(d.total).toBe(1)
    expect(d.prompt).toBe(false)
  })

  it('判据不修改入参（scopes / myBrands 原样）', () => {
    const myBrands = ['滨寿司', '食其家']
    const scopes = { 滨寿司: ['寿司郎'] }
    decideBrandMapPrompt({ myBrands, scopes, justImportedBrand: '食其家' })
    expect(myBrands).toEqual(['滨寿司', '食其家'])
    expect(scopes).toEqual({ 滨寿司: ['寿司郎'] })
  })
})

describe('D. 文案', () => {
  it('本次导入品牌缺配置 ⇒ 文案点名它，且带「本次导入」', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家'],
      scopes: {},
      justImportedBrand: '食其家'
    })
    const text = buildBrandMapPromptText(d)
    expect(text).toContain('本次导入')
    expect(text).toContain('食其家')
    expect(text).toContain('全部竞品')
  })

  it('本次导入品牌不缺 ⇒ 文案给出品牌总数与缺失清单', () => {
    const d = decideBrandMapPrompt({
      myBrands: ['滨寿司', '食其家', '吉野家'],
      scopes: { 滨寿司: ['寿司郎'] },
      justImportedBrand: '滨寿司'
    })
    const text = buildBrandMapPromptText(d)
    expect(text).toContain('3 个自有品牌')
    expect(text).toContain('食其家、吉野家')
  })

  it('⛔ 文案不出现业绩承诺/预测类措辞', () => {
    const d = decideBrandMapPrompt({ myBrands: ['A1', 'B1'], scopes: {}, justImportedBrand: 'A1' })
    const text = buildBrandMapPromptText(d)
    for (const bad of ['预计', '预估', '保证', '一定', '提升%']) {
      expect(text).not.toContain(bad)
    }
  })
})

describe('E. 组件接线守卫（⛔ 防提示被顺手删掉）', () => {
  const view = read('frontend/src/views/CompetitorView.vue')

  it('CompetitorView 引用了判据与文案', () => {
    expect(view).toMatch(/from '@\/utils\/brandMapPrompt(\.js)?'/)
    expect(view).toContain('decideBrandMapPrompt')
    expect(view).toContain('buildBrandMapPromptText')
  })

  it('提示挂在「期次导入成功」回调链路内，而不是页面加载时', () => {
    const m = view.match(/const handleSnapshotImported\s*=\s*async\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n\}/)
    expect(m, 'handleSnapshotImported 的函数体没找到').toBeTruthy()
    expect(m[0]).toContain('maybePromptBrandMap')
  })

  it('配置接口读失败时不许弹（scopeMetaLoaded 为假直接 return）', () => {
    const m = view.match(/async function maybePromptBrandMap\([\s\S]*?\n\}/)
    expect(m, 'maybePromptBrandMap 的实现没找到').toBeTruthy()
    expect(m[0]).toMatch(/scopeMetaLoaded\.value\)\s*return/)
  })

  it('「立即设置」会把 preferred 品牌预选进映射弹窗', () => {
    const m = view.match(/async function maybePromptBrandMap\([\s\S]*?\n\}/)
    expect(m[0]).toContain('mapMyBrand.value = d.preferred')
    expect(m[0]).toContain('onMapBrandChange()')
    expect(m[0]).toContain('mapDialogVisible.value = true')
  })
})
