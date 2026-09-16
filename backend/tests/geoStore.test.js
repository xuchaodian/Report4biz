/**
 * 外置 GeoJSON 存储单测（v1.13.143 库瘦身）
 *
 * 覆盖：写入/读回逐字节一致（含多字节）、原子写不留 .tmp、覆盖写、
 * 缓存命中与淘汰、缺失文件的降级语义（attachGeo 三级回退）、
 * 大文件不缓存解析对象（1.6GB 机器的内存保护）。
 *
 * 通过 R4B_GEO_DIR 指向临时目录，绝不触碰 backend/uploads 真实数据。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r4b-geo-test-'))
process.env.R4B_GEO_DIR = TMP

let geo
const FC = (n) => JSON.stringify({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, (_, i) => ({
    type: 'Feature',
    properties: { 名称: `商圈${i}`, 人口: 1000 + i },
    geometry: { type: 'Point', coordinates: [121.4 + i * 0.001, 31.2] }
  }))
})

beforeAll(async () => {
  geo = await import('../src/models/geoStore.js')
})

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) { /* ignore */ }
})

beforeEach(() => {
  // 每个用例前清干净：目录内容 + 内存缓存
  for (const f of fs.readdirSync(TMP)) {
    geo.clearGeoCache(f.replace(/\.geojson(\.tmp)?$/, ''))
    try { fs.unlinkSync(path.join(TMP, f)) } catch (e) { /* ignore */ }
  }
})

describe('geoStore：写入与读回', () => {
  it('写入后读回与原文逐字节一致（含中文/emoji 多字节）', () => {
    const text = FC(3) + '// 中文注释 ✅ ①②③'
    const n = geo.writeGeoText(7, text)
    expect(n).toBe(Buffer.byteLength(text, 'utf8'))
    expect(fs.statSync(geo.geoFilePath(7)).size).toBe(n)
    expect(geo.readGeoText(7)).toBe(text)
  })

  it('写入是原子的：不留 .tmp 残留', () => {
    geo.writeGeoText(8, FC(2))
    const leftovers = fs.readdirSync(TMP).filter(f => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('覆盖写：旧内容不残留，缓存同步失效', () => {
    geo.writeGeoText(9, FC(1))
    const first = geo.readGeoText(9)
    geo.writeGeoText(9, FC(5))
    const second = geo.readGeoText(9)
    expect(second).not.toBe(first)
    expect(JSON.parse(second).features.length).toBe(5)
    expect(fs.readFileSync(geo.geoFilePath(9), 'utf8')).toBe(second)
  })

  it('id 以字符串/数字混用时指向同一文件', () => {
    geo.writeGeoText(10, FC(1))
    expect(geo.readGeoText('10')).toBe(geo.readGeoText(10))
    expect(geo.hasGeoFile('10')).toBe(true)
  })
})

describe('geoStore：缺失文件的降级语义', () => {
  it('文件不存在 → readGeoText 返回 null，hasGeoFile false', () => {
    expect(geo.readGeoText(999)).toBe(null)
    expect(geo.hasGeoFile(999)).toBe(false)
  })

  it('attachGeo 三级回退：文件 > 主库残留列 > 空 FeatureCollection', () => {
    // ① 有文件
    geo.writeGeoText(21, FC(2))
    expect(JSON.parse(geo.attachGeo({ id: 21 }).geojson).features.length).toBe(2)

    // ② 无文件但有主库残留列（迁移中途/手工误删的兜底）
    const legacy = FC(4)
    const row2 = geo.attachGeo({ id: 22, geojson: legacy })
    expect(row2.geojson).toBe(legacy)

    // ③ 两者都没有 → 空 FeatureCollection（避免调用方 JSON.parse(undefined) 抛 500）
    const row3 = geo.attachGeo({ id: 23 })
    expect(() => JSON.parse(row3.geojson)).not.toThrow()
    expect(JSON.parse(row3.geojson).features).toEqual([])
  })

  it('attachGeo(null) 原样返回，不抛错', () => {
    expect(geo.attachGeo(null)).toBe(null)
    expect(geo.attachGeo(undefined)).toBeUndefined()
  })

  it('getGeoObject：文件缺失返回 null；删除文件后不再返回旧对象', () => {
    geo.writeGeoText(24, FC(2))
    const a = geo.getGeoObject(24)
    expect(a.features.length).toBe(2)

    geo.removeGeoFile(24)
    expect(geo.getGeoObject(24)).toBe(null)
    expect(geo.readGeoText(24)).toBe(null)
  })

  it('removeGeoFile 幂等，二次调用不抛错', () => {
    geo.writeGeoText(25, FC(1))
    expect(geo.removeGeoFile(25)).toBe(true)
    expect(geo.removeGeoFile(25)).toBe(false)
  })
})

describe('geoStore：缓存预算', () => {
  it('小文件（≤4MB）的解析对象进缓存，同一请求内复用同一引用', () => {
    geo.writeGeoText(31, FC(3))
    expect(geo.getGeoObject(31)).toBe(geo.getGeoObject(31))
    expect(geo.geoCacheStats().objEntries).toBeGreaterThan(0)
  })

  it('大文件（>4MB）不缓存解析对象 —— 保护 1.6GB 机器的内存', () => {
    // 造一个 >4MB 的原文
    const big = JSON.stringify({ type: 'FeatureCollection', features: [{ pad: 'x'.repeat(4 * 1024 * 1024 + 1024) }] })
    expect(Buffer.byteLength(big, 'utf8')).toBeGreaterThan(4 * 1024 * 1024)
    geo.clearGeoCache(32)
    const before = geo.geoCacheStats().objEntries
    geo.writeGeoText(32, big)
    const obj = geo.getGeoObject(32)
    expect(obj.features.length).toBe(1)
    expect(geo.geoCacheStats().objEntries).toBe(before)   // 未新增
  })

  it('文本缓存有条目上限，且至少保留 1 条（避免超大文件把缓存清空）', () => {
    for (let i = 0; i < 30; i++) geo.writeGeoText(100 + i, FC(1))
    const st = geo.geoCacheStats()
    expect(st.textEntries).toBeGreaterThanOrEqual(1)
    expect(st.textEntries).toBeLessThanOrEqual(24)
    // 缓存淘汰不应影响「从磁盘重新读回」的正确性
    expect(geo.readGeoText(100)).toBe(fs.readFileSync(geo.geoFilePath(100), 'utf8'))
  })

  it('clearGeoCache 清掉缺失告警去重集合', () => {
    geo.readGeoText(777)
    expect(geo.geoCacheStats().missingWarned).toContain('777')
    geo.clearGeoCache(777)
    expect(geo.geoCacheStats().missingWarned).not.toContain('777')
  })
})

describe('geoStore：诊断助手', () => {
  it('missingGeoFiles 只报缺文件的 id', () => {
    geo.writeGeoText(41, FC(1))
    expect(geo.missingGeoFiles([41, 42])).toEqual([42])
    expect(geo.missingGeoFiles(null)).toEqual([])
  })
})
