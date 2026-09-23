/**
 * 工具调用折叠守卫单测 —— v1.13.169
 *
 * 被测：src/utils/toolCallGuard.js（纯函数，无任何 IO / 无网络）
 *
 * 🔴 本文件最重要的用例是「同名不同参**不得**折叠」——
 *    「对比上海和北京的人口」会合法地产生两次 `query_city_data`（两次 city 不同），
 *    一旦被误折叠，用户就拿不到正确结果（错折叠比不折叠严重得多）。
 *
 * 端到端的接线验证（payload 去重 / 续轮 tool 消息 1:1）在 aiCostControl.test.js §H。
 */
import { describe, it, expect } from 'vitest'
import { dedupeToolCalls, canonicalArgs } from '../src/utils/toolCallGuard.js'

/** 造一条上游形状的 tool_call（arguments 为 JSON **字符串**，与上游一致） */
const tc = (id, name, args) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
})

describe('工具调用折叠守卫（v1.13.169）', () => {
  it('1 同名 + 同参 ×2 ⇒ 折叠为 1 条，aliasOf 指向首条', () => {
    const { unique, aliasOf, collapsed } = dedupeToolCalls([
      tc('tc1', 'query_city_data', { city: '上海' }),
      tc('tc2', 'query_city_data', { city: '上海' })
    ])
    expect(collapsed).toBe(1)
    expect(unique.length).toBe(1)
    expect(unique[0].id).toBe('tc1')
    expect(aliasOf.get('tc2')).toBe('tc1')
    expect(aliasOf.has('tc1')).toBe(false)   // 首条不是「别名」
  })

  it('2 🔴 同名 + 不同参（上海 / 北京）⇒ 必须全部保留（合法多城用法）', () => {
    const { unique, aliasOf, collapsed } = dedupeToolCalls([
      tc('tc1', 'query_city_data', { city: '上海' }),
      tc('tc2', 'query_city_data', { city: '北京' })
    ])
    expect(collapsed).toBe(0)
    expect(unique.length).toBe(2)
    expect(unique.map(t => t.id)).toEqual(['tc1', 'tc2'])
    expect(aliasOf.size).toBe(0)
  })

  it('3 仅 JSON key 顺序不同 ⇒ 视为相同（canonical 生效）', () => {
    const a = { city: '上海', field: 'population' }
    const b = { field: 'population', city: '上海' }
    expect(canonicalArgs(a)).toBe(canonicalArgs(b))
    const { collapsed } = dedupeToolCalls([
      { id: 'tc1', function: { name: 'query_city_data', arguments: JSON.stringify(a) } },
      { id: 'tc2', function: { name: 'query_city_data', arguments: JSON.stringify(b) } }
    ])
    expect(collapsed).toBe(1)
  })

  it('4 不同工具 + 同参 ⇒ 不折叠', () => {
    const { unique, collapsed } = dedupeToolCalls([
      tc('tc1', 'filter_markers', { city: '上海' }),
      tc('tc2', 'filter_competitors', { city: '上海' })
    ])
    expect(collapsed).toBe(0)
    expect(unique.length).toBe(2)
  })

  it('5 三条重复 ⇒ unique=1、collapsed=2、两条别名都指向首条', () => {
    const { unique, aliasOf, collapsed } = dedupeToolCalls([
      tc('tc1', 'query_stats', { group_by: 'city' }),
      tc('tc2', 'query_stats', { group_by: 'city' }),
      tc('tc3', 'query_stats', { group_by: 'city' })
    ])
    expect(collapsed).toBe(2)
    expect(unique.length).toBe(1)
    expect(aliasOf.get('tc2')).toBe('tc1')
    expect(aliasOf.get('tc3')).toBe('tc1')
  })

  it('6 unique 保持「首次出现顺序」，对象原样返回', () => {
    const first = tc('tc1', 'a_tool', { x: 1 })
    const { unique } = dedupeToolCalls([
      first,
      tc('tc2', 'b_tool', { x: 1 }),
      tc('tc3', 'a_tool', { x: 1 })          // a_tool 重复
    ])
    expect(unique.map(t => t.id)).toEqual(['tc1', 'tc2'])
    expect(unique[0]).toBe(first)            // 同一个对象引用，未被改造
  })

  it('7 嵌套对象 / 数组也做 canonical', () => {
    const { collapsed } = dedupeToolCalls([
      tc('tc1', 'compare_population', { store_keywords: ['A', 'B'], opts: { radius: 2, deep: { a: 1, b: 2 } } }),
      tc('tc2', 'compare_population', { opts: { deep: { b: 2, a: 1 }, radius: 2 }, store_keywords: ['A', 'B'] })
    ])
    expect(collapsed).toBe(1)
  })

  it('8 对象形参（内部流转）与 JSON 字符串形参等价 ⇒ 可折叠', () => {
    const asObj = { id: 'tc2', function: { name: 'query_stats', arguments: { group_by: 'city' } } }
    const { collapsed } = dedupeToolCalls([tc('tc1', 'query_stats', { group_by: 'city' }), asObj])
    expect(collapsed).toBe(1)
  })

  it('9 非法 JSON 字符串不抛异常，退化为原文比较', () => {
    const bad = (id, raw) => ({ id, function: { name: 'x_tool', arguments: raw } })
    expect(() => dedupeToolCalls([bad('tc1', '{broken'), bad('tc2', '{broken')])).not.toThrow()
    expect(dedupeToolCalls([bad('tc1', '{broken'), bad('tc2', '{broken')]).collapsed).toBe(1)
    expect(dedupeToolCalls([bad('tc1', '{broken'), bad('tc2', '{broken2')]).collapsed).toBe(0)
  })

  it('10 空 / null / 非数组入参 ⇒ 安全返回空结果', () => {
    for (const input of [[], null, undefined, 'not-an-array', 42, {}]) {
      const r = dedupeToolCalls(input)
      expect(r.unique).toEqual([])
      expect(r.collapsed).toBe(0)
      expect(r.aliasOf instanceof Map).toBe(true)
    }
  })

  it('11 含中文 / 特殊字符的参数不误折叠', () => {
    const { collapsed } = dedupeToolCalls([
      tc('tc1', 'poi_around_search', { keywords: '咖啡厅', location: '上海闵行浦江欢乐颂' }),
      tc('tc2', 'poi_around_search', { keywords: '咖啡', location: '上海闵行浦江欢乐颂' })
    ])
    expect(collapsed).toBe(0)
  })

  it('12 参数是子集关系 ⇒ 不折叠（只认严格等价）', () => {
    const { collapsed } = dedupeToolCalls([
      tc('tc1', 'filter_markers', { city: '上海', status: '在营' }),
      tc('tc2', 'filter_markers', { city: '上海' })
    ])
    expect(collapsed).toBe(0)
  })

  it('13 不做类型归一：数字 2 与字符串 "2" 视为不同', () => {
    const { collapsed } = dedupeToolCalls([
      { id: 'tc1', function: { name: 'x', arguments: JSON.stringify({ radius: 2 }) } },
      { id: 'tc2', function: { name: 'x', arguments: JSON.stringify({ radius: '2' }) } }
    ])
    expect(collapsed).toBe(0)
  })
})
