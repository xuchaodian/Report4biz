/**
 * v1.13.345：前端品牌集合口径 utils/brandScope.js 的三态语义（纯函数）
 *
 * 只钉死三件事，与后端 competitorScope.js 严格对齐：
 *   · 未配置（scopes 里没有该品牌）      ⇒ null ⇒ 调用方沿用全量
 *   · 已配置且非空                        ⇒ 数组 ⇒ 只算这些竞品品牌
 *   · 已配置但空集                        ⇒ []   ⇒ 真 0 家（⛔ 不得被当成 null）
 * 另外钉死归一：大小写 / 首尾空格 / 内部多空格 都必须命中同一条配置。
 */
import { describe, it, expect } from 'vitest'
import {
  normBrand,
  scopeBrandsFor,
  brandAllowed,
  groupByBrand,
  compPointsForBrand
} from '../../frontend/src/utils/brandScope.js'

const SCOPES = {
  优事: ['老乡鸡', '大米先生'],
  测试空集: []
}

describe('A. 三态语义', () => {
  it('A1 未配置 / 空品牌 ⇒ null（全量）', () => {
    expect(scopeBrandsFor(SCOPES, '不存在的品牌')).toBe(null)
    expect(scopeBrandsFor(SCOPES, '')).toBe(null)
    expect(scopeBrandsFor(null, '优事')).toBe(null)
  })

  it('A2 已配置 ⇒ 返回集合；显式空集 ⇒ []（⛔ 不是 null）', () => {
    expect(scopeBrandsFor(SCOPES, '优事')).toEqual(['老乡鸡', '大米先生'])
    expect(scopeBrandsFor(SCOPES, '测试空集')).toEqual([])
  })

  it('A3 brandAllowed：未配置一律 true；空集一律 false', () => {
    expect(brandAllowed(SCOPES, '不存在', '任意品牌')).toBe(true)
    expect(brandAllowed(SCOPES, '测试空集', '老乡鸡')).toBe(false)
    expect(brandAllowed(SCOPES, '优事', '老乡鸡')).toBe(true)
    expect(brandAllowed(SCOPES, '优事', '大米先生')).toBe(true)
    expect(brandAllowed(SCOPES, '优事', '鱼跃')).toBe(false)
  })
})

describe('B. 归一规则', () => {
  it('B1 大小写 / 首尾空格 / 内部多空格 命中同一条配置', () => {
    expect(normBrand('  优 事 ')).toBe('优 事')
    expect(scopeBrandsFor(SCOPES, ' 优事 ')).toEqual(['老乡鸡', '大米先生'])
    expect(scopeBrandsFor(SCOPES, '优事')).toEqual(['老乡鸡', '大米先生'])
    const upper = { 'ABC 店': ['X'] }
    expect(scopeBrandsFor(upper, 'abc  店')).toEqual(['X'])
  })

  it('B2 竞品品牌比较同样归一（" 老乡鸡 " 命中 老乡鸡）', () => {
    expect(brandAllowed(SCOPES, '优事', ' 老乡鸡 ')).toBe(true)
    expect(brandAllowed(SCOPES, '优事', '老乡鸡')).toBe(true)
  })
})

describe('C. 按店分池的点位取用', () => {
  const pts = [
    { brand: '老乡鸡', name: 'a' },
    { brand: ' 老乡鸡 ', name: 'b' },
    { brand: '大米先生', name: 'c' },
    { brand: '鱼跃', name: 'd' }
  ]

  it('C1 未配置 ⇒ null（调用方应继续用全量数组，不做无谓复制）', () => {
    expect(compPointsForBrand(groupByBrand(pts), SCOPES, '不存在')).toBe(null)
  })

  it('C2 已配置 ⇒ 只取集合内品牌（含空格变体）', () => {
    const got = compPointsForBrand(groupByBrand(pts), SCOPES, '优事')
    expect(got.map((p) => p.name).sort()).toEqual(['a', 'b', 'c'])
  })

  it('C3 显式空集 ⇒ 空数组（⛔ 不得回退全量）', () => {
    expect(compPointsForBrand(groupByBrand(pts), SCOPES, '测试空集')).toEqual([])
  })
})
