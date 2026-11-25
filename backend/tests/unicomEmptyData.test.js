/**
 * 416 守卫：联通「空数据」判据（决定扣不扣费）
 *
 * 这个函数直接等于钱：返回 true ⇒ 不扣配额。历史上两处实现（smartsteps / resale）
 * 都有两个漏网，实测能「扣了配额却没拿到数据」：
 *   ① `{error:'…'}` 被判「有数据」（旧代码 `if (data.error) return false`）
 *   ② 数组元素里的 `hour`/`day_type`/`date` 被当成数据（`{1005:[{hour:1,visit:0}]}` 判非空）
 *
 * 本测试同时钉住两件事：
 *   · 判据本身的边界（空/非空各若干）
 *   · **只有一个实现**（两个路由不许再各自写一份，漂移会导致「后台退款、对外照扣」）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { checkIfDataIsEmpty } from '../src/utils/unicomEmpty.js'

const SMARTSTEPS = path.resolve(__dirname, '../src/routes/smartsteps.js')
const RESALE = path.resolve(__dirname, '../src/routes/resale.js')

describe('空数据判据：基础空值', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['空对象', {}],
    ['空数组', []],
    ['数字 0', 0],
    ['空字符串', ''],
    ['字符串 "0"', '0'],
    ['全 0 字符串 "0.00"', '0.00']
  ])('%s ⇒ 判空（不扣费）', (_n, v) => {
    expect(checkIfDataIsEmpty(v)).toBe(true)
  })

  it.each([
    ['数字 5（非 0 即数据）', 5, false],
    ['数字字符串 "12"', '12', false],
    ['布尔 true（非数据）', true, true],
    ['日期字符串不算数据', '2026-06-01', true],
    ['中文名称不算数据', '浦东新区', true]
  ])('%s', (_n, v, expected) => {
    expect(checkIfDataIsEmpty(v)).toBe(expected)
  })
})

describe('修复点①：上游带 error ⇒ 判空，不再扣费', () => {
  it('{error} 整包报错', () => {
    expect(checkIfDataIsEmpty({ error: '上游返回错误码: 500' })).toBe(true)
  })
  it('服务码内层带 error', () => {
    expect(checkIfDataIsEmpty({ '1001': { error: 'no data' } })).toBe(true)
  })
  it('error + 其他正常字段，仍判空（宁可少收，不可白扣）', () => {
    expect(checkIfDataIsEmpty({ error: 'x', '1001': { p1_sum: 0 } })).toBe(true)
  })
})

describe('修复点②：数组元素里的序号/日期不算数据', () => {
  it('🔴 {1005:[{day_type,hour,visit:0}]} ⇒ 判空（旧实现扣费）', () => {
    expect(checkIfDataIsEmpty({ '1005': [{ day_type: 0, hour: 1, visit: 0 }] })).toBe(true)
  })
  it('多元素、hour 各不相同、visit 全 0 ⇒ 判空', () => {
    expect(checkIfDataIsEmpty({
      '1005': [{ day_type: 0, hour: 0, visit: 0 }, { day_type: 1, hour: 23, visit: 0 }]
    })).toBe(true)
  })
  it('任一元素的业务值非 0 ⇒ 判非空（正常扣费）', () => {
    expect(checkIfDataIsEmpty({
      '1005': [{ hour: 0, visit: 0 }, { hour: 1, visit: 5 }]
    })).toBe(false)
  })
  it('🔴 date 字符串不被 parseFloat 误判（旧实现 2026-06-01 → 2026）', () => {
    expect(checkIfDataIsEmpty({ '1006': [{ date: '2026-06-01', day_visit: 0, stay1: 0 }] })).toBe(true)
    expect(checkIfDataIsEmpty({ '1006': [{ date: '2026-06-01', day_visit: 37 }] })).toBe(false)
  })
})

describe('度量键优先 + 元数据键忽略', () => {
  it('1001 全 0 ⇒ 判空', () => {
    expect(checkIfDataIsEmpty({
      '1001': { p0_sum: 0, p1_sum: 0, p2_sum: 0, pall_sum: 0, male1_sum: 0, age1_2529: 0 }
    })).toBe(true)
  })
  it('1001 有非 0 ⇒ 判非空', () => {
    expect(checkIfDataIsEmpty({ '1001': { p0_sum: 0, p1_sum: 8600 } })).toBe(false)
  })
  it('🔴 只有元数据、没有任何度量 ⇒ 判空', () => {
    expect(checkIfDataIsEmpty({ '1005': { day_type: 0, hour: 1 } })).toBe(true)
  })
  it('无度量键时退化：非元数据键的 0 值 ⇒ 判空', () => {
    expect(checkIfDataIsEmpty({ '1022': { lt_30min: 0, '30_60min': 0, '1_2h': 0 } })).toBe(true)
  })
  it('无度量键时退化：非元数据键有值 ⇒ 判非空', () => {
    expect(checkIfDataIsEmpty({ '1022': { lt_30min: 500, '30_60min': 0 } })).toBe(false)
  })
})

describe('真实整包形态', () => {
  it('1001 全 0 + 1005 全 0 带 hour ⇒ 整包判空（不扣费）', () => {
    expect(checkIfDataIsEmpty({
      '1001': { p0_sum: 0, p1_sum: 0, pall_sum: 0 },
      '1005': [{ day_type: 0, hour: 1, visit: 0 }, { day_type: 0, hour: 2, visit: 0 }]
    })).toBe(true)
  })
  it('1001 有数 + 1005 全 0 ⇒ 整包判非空（有数据就该扣）', () => {
    expect(checkIfDataIsEmpty({
      '1001': { p0_sum: 0, p1_sum: 12 },
      '1005': [{ hour: 1, visit: 0 }]
    })).toBe(false)
  })
})

describe('单一实现（不许在路由里再写一份）', () => {
  const stripComment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it.each([['smartsteps', SMARTSTEPS], ['resale', RESALE]])('%s.js 只 import，不自建判据', (_n, file) => {
    const src = stripComment(fs.readFileSync(file, 'utf8'))
    expect(src, '又出现了本地实现 ⇒ 两份判据会漂移').not.toMatch(/function\s+checkIfDataIsEmpty\s*\(/)
    expect(src).toContain("from '../utils/unicomEmpty.js'")
  })
})
