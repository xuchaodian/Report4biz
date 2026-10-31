/**
 * 驾车耗时探测（v1.13.302）
 *
 * 钉的是「分片与对齐」这两件最容易静默出错的事：
 *   · 高德单次只回 100 个起点，传 150 个不报错、直接截断 ⇒ 必须自己分片；
 *   · 一旦返回顺序/条数对不上，A 点的耗时会被算到 B 点头上 —— 图上正常、数字全错。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/config.js', () => ({ AMAP_KEY: 'test-key' }))

const { probeDriveDuration, DriveProbeError, MAX_ORIGINS_PER_CALL } = await import('../src/utils/amapDrive.js')

const origin = { lng: 121.4737, lat: 31.2304 }
const pts = (n) => Array.from({ length: n }, (_, i) => ({ lng: 121.4 + i * 0.0001, lat: 31.2 + i * 0.0001 }))

/** 造一个「按请求起点顺序回 duration」的假 fetch */
function mockAmap(responder) {
  const calls = []
  global.fetch = vi.fn(async (url) => {
    calls.push(url)
    const originsPart = /origins=([^&]+)/.exec(url)[1]
    const list = decodeURIComponent(originsPart).split('|')
    const results = responder(list, calls.length)
    return { json: async () => results }
  })
  return calls
}

describe('分片', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('150 个点 ⇒ 切成 2 次调用（100 + 50）', async () => {
    const calls = mockAmap((list) => ({
      status: '1',
      results: list.map((_, i) => ({ origin_id: String(i + 1), duration: '600', distance: '3000' }))
    }))
    const r = await probeDriveDuration({ origin, points: pts(150) })
    expect(calls.length).toBe(2)
    expect(r.calls).toBe(2)
    expect(r.durations.length).toBe(150)
    expect(r.durations.every(d => d === 600)).toBe(true)
    expect(MAX_ORIGINS_PER_CALL).toBe(100)
  })

  it('空输入不发起任何请求', async () => {
    const calls = mockAmap(() => ({ status: '1', results: [] }))
    const r = await probeDriveDuration({ origin, points: [] })
    expect(calls.length).toBe(0)
    expect(r.durations).toEqual([])
  })
})

describe('对齐', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('上游乱序返回时按 origin_id 归位，不会错配', async () => {
    mockAmap((list) => ({
      status: '1',
      // 故意倒序：第 1 个起点对应 duration=30
      results: list.map((_, i) => ({
        origin_id: String(i + 1),
        duration: String(30 + i * 10),
        distance: '1000'
      })).reverse()
    }))
    const r = await probeDriveDuration({ origin, points: pts(5) })
    expect(r.durations).toEqual([30, 40, 50, 60, 70])
  })

  it('🔴 返回条数少于本片起点数 ⇒ 整片判失败（宁可留空，不许错位）', async () => {
    mockAmap((list) => ({
      status: '1',
      results: list.slice(0, list.length - 1).map((_, i) => ({ origin_id: String(i + 1), duration: '100', distance: '500' }))
    }))
    const r = await probeDriveDuration({ origin, points: pts(5) })
    expect(r.durations).toEqual([null, null, null, null, null])
    expect(r.failed).toBe(5)
  })

  it('某点 duration 非法 ⇒ 该点留 null，其余不受影响', async () => {
    mockAmap((list) => ({
      status: '1',
      results: list.map((_, i) => ({
        origin_id: String(i + 1),
        duration: i === 2 ? '' : '120',
        distance: '800'
      }))
    }))
    const r = await probeDriveDuration({ origin, points: pts(4) })
    expect(r.durations).toEqual([120, 120, null, 120])
  })
})

describe('上游错误', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('配额超限 ⇒ 抛 OVER_QUOTA（⛔ 不能降级成 0 秒）', async () => {
    mockAmap(() => ({ status: '0', info: 'DAILY_QUERY_OVER_LIMIT', infocode: '10003' }))
    await expect(probeDriveDuration({ origin, points: pts(3) })).rejects.toMatchObject({ code: 'OVER_QUOTA' })
  })

  it('参数错误 ⇒ 抛 UPSTREAM，并带上高德的 info 便于排查', async () => {
    mockAmap(() => ({ status: '0', info: 'INVALID_PARAMS', infocode: '20000' }))
    const err = await probeDriveDuration({ origin, points: pts(3) }).catch(e => e)
    expect(err).toBeInstanceOf(DriveProbeError)
    expect(err.code).toBe('UPSTREAM')
    expect(err.message).toContain('INVALID_PARAMS')
  })

  it('网络异常 ⇒ 抛 UPSTREAM', async () => {
    global.fetch = vi.fn(async () => { throw new Error('boom') })
    await expect(probeDriveDuration({ origin, points: pts(2) })).rejects.toMatchObject({ code: 'UPSTREAM' })
  })
})
