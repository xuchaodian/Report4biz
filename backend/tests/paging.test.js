/**
 * M4 可选分页解析单测（v1.13.107）
 * 关键不变量：**不传 limit 必须解析为 0（=全量）**，否则地图图层会因缺数据而画不全。
 */
import { describe, it, expect } from 'vitest'
import { parsePaging } from '../src/utils/paging.js'

describe('parsePaging：向后兼容（默认全量）', () => {
  it('无任何参数 → limit=0（全量语义）', () => {
    expect(parsePaging({})).toEqual({ limit: 0, offset: 0, wantTotal: false })
    expect(parsePaging()).toEqual({ limit: 0, offset: 0, wantTotal: false })
  })

  it('limit 非法（非数字 / 0 / 负数）一律回退 0', () => {
    expect(parsePaging({ limit: 'abc' }).limit).toBe(0)
    expect(parsePaging({ limit: '0' }).limit).toBe(0)
    expect(parsePaging({ limit: '-5' }).limit).toBe(0)
    expect(parsePaging({ limit: '' }).limit).toBe(0)
  })

  it('offset 非法回退 0；offset 无 limit 时不影响全量语义', () => {
    expect(parsePaging({ offset: 'abc' }).offset).toBe(0)
    expect(parsePaging({ offset: '-3' }).offset).toBe(0)
    expect(parsePaging({ offset: '50' })).toEqual({ limit: 0, offset: 50, wantTotal: false })
  })
})

describe('parsePaging：有效分页与上限', () => {
  it('正常 limit/offset 透传', () => {
    expect(parsePaging({ limit: '20', offset: '40' })).toEqual({ limit: 20, offset: 40, wantTotal: false })
  })

  it('limit 超上限被截断（默认 2000）', () => {
    expect(parsePaging({ limit: '99999' }).limit).toBe(2000)
    expect(parsePaging({ limit: '99999' }, { maxLimit: 500 }).limit).toBe(500)
  })

  it('total 标记支持 1 / true / withTotal=1', () => {
    expect(parsePaging({ total: '1' }).wantTotal).toBe(true)
    expect(parsePaging({ total: 'true' }).wantTotal).toBe(true)
    expect(parsePaging({ withTotal: '1' }).wantTotal).toBe(true)
    expect(parsePaging({ total: '0' }).wantTotal).toBe(false)
  })
})
