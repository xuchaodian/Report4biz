/**
 * competitorSnapshotCore.js 纯函数测试（S4 测试基建——后端纯函数层）
 * 竞品期次核心逻辑：状态文案归一 / 期次解析 / 名址相似度 / 坐标距离。
 * 该文件是竞品状态文案的唯一权威（open正常营业/paused暂停/closed已关/pending未营业/unknown未知）。
 */
import { describe, it, expect } from 'vitest'
import {
  textToStatus,
  enumToDisplayText,
  parsePeriod,
  toMonthPeriod,
  monthToQuarterIfEdge,
  normalizeStoreName,
  levenshtein,
  nameSimilarity,
  haversineMeters
} from '../src/utils/competitorSnapshotCore.js'

describe('竞品状态文案（唯一权威映射）', () => {
  it('textToStatus：精确匹配优先，杜绝子串串组（暂停营业 不被 营业/停业 误伤）', () => {
    expect(textToStatus('正常营业')).toBe('open')
    expect(textToStatus('营业中')).toBe('open')
    expect(textToStatus('暂停营业')).toBe('paused')   // 含「营业」子串但须精确命中 paused
    expect(textToStatus('装修中')).toBe('paused')
    expect(textToStatus('店铺已关')).toBe('closed')
    expect(textToStatus('停业')).toBe('closed')
    expect(textToStatus('尚未营业')).toBe('pending')
    expect(textToStatus('即将开业')).toBe('pending')
    expect(textToStatus('不知道啥状态')).toBe('unknown')
    expect(textToStatus('')).toBe('unknown')
    expect(textToStatus(null)).toBe('unknown')
  })

  it('enumToDisplayText 与 textToStatus 往返一致', () => {
    expect(enumToDisplayText('open')).toBe('正常营业')
    expect(enumToDisplayText('paused')).toBe('暂停营业')
    expect(enumToDisplayText('closed')).toBe('店铺已关')
    expect(enumToDisplayText('pending')).toBe('尚未营业')
    expect(enumToDisplayText('unknown')).toBe('未知')
    expect(enumToDisplayText('nope')).toBe('')
    for (const en of ['open', 'paused', 'closed', 'pending', 'unknown']) {
      expect(textToStatus(enumToDisplayText(en))).toBe(en)
    }
  })
})

describe('期次解析（月/季双粒度）', () => {
  it('parsePeriod：季度与月度均解析，非法拒绝', () => {
    expect(parsePeriod('2026Q3')).toMatchObject({ valid: true, year: 2026, month: 9, seq: 202609, label: '2026Q3', kind: 'quarter' })
    expect(parsePeriod('2026-09')).toMatchObject({ valid: true, seq: 202609, kind: 'month' })
    expect(parsePeriod('2026-9')).toMatchObject({ valid: true, seq: 202609, month: 9 })
    expect(parsePeriod('2026-13').valid).toBe(false)
    expect(parsePeriod('abc').valid).toBe(false)
    expect(parsePeriod('2026Q5').valid).toBe(false)
    expect(parsePeriod('').valid).toBe(false)
  })

  it('toMonthPeriod / monthToQuarterIfEdge', () => {
    expect(toMonthPeriod(2026, 9)).toBe('2026-09')
    expect(monthToQuarterIfEdge(2026, 9)).toBe('2026Q3')
    expect(monthToQuarterIfEdge(2026, 3)).toBe('2026Q1')
    expect(monthToQuarterIfEdge(2026, 5)).toBeNull()
  })
})

describe('门店名归一化与相似度（名址对齐）', () => {
  it('normalizeStoreName：去空格/全角转半角/去尾部店缀，保留括号内分店名', () => {
    expect(normalizeStoreName(' 大米先生（南京路店） ')).toBe('大米先生南京路')
    expect(normalizeStoreName('老乡鸡直营店')).toBe('老乡鸡')
    expect(normalizeStoreName('STARBUCKS 店')).toBe('starbucks')
    expect(normalizeStoreName('ＡＢＣ店')).toBe('abc') // 全角 ABC → abc
  })

  it('levenshtein 基础距离', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('abc', 'abc')).toBe(0)
    expect(levenshtein('', 'abc')).toBe(3)
  })

  it('nameSimilarity：相同=1、包含=短/长、不相关→0', () => {
    expect(nameSimilarity('大米先生南京路店', '大米先生(南京路店)')).toBe(1)
    expect(nameSimilarity('老乡鸡', '老乡鸡')).toBe(1)
    const partial = nameSimilarity('老乡鸡上海店', '老乡鸡')
    expect(partial).toBeGreaterThan(0.5)
    expect(partial).toBeLessThanOrEqual(1)
    expect(nameSimilarity('大米先生', '西塔老太太')).toBeLessThan(0.4)
    expect(nameSimilarity('', '老乡鸡')).toBe(0)
  })
})

describe('Haversine 坐标距离', () => {
  it('同点 0 米；上海—北京约 1067km（±1%）；非法参数 Infinity', () => {
    expect(haversineMeters(31.23, 121.47, 31.23, 121.47)).toBe(0)
    const d = haversineMeters(39.9042, 116.4074, 31.2304, 121.4737) // 北京→上海
    expect(d).toBeGreaterThan(1050000)
    expect(d).toBeLessThan(1080000)
    expect(haversineMeters(null, 121.47, 31.23, 121.47)).toBe(Infinity)
    expect(haversineMeters(NaN, 121.47, 31.23, 121.47)).toBe(Infinity)
  })
})
