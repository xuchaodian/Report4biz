/**
 * 搜索建议坐标参数守卫（v1.13.287）
 *
 * 背景（真实反馈）：地图在上海，搜「寿司郎」却跳到宁波。
 * 根因不在前端排序，而在**查询阶段没有偏置** —— 实测高德无 location 时
 * 前 10 条是北京/武汉/深圳/宁波，一条上海都没有。
 * ⇒ /suggest 必须把「当前地图中心」透传给上游做就近排序。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalizeLngLat } from '../src/utils/geocodeParams.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '../src')

describe('normalizeLngLat：坐标校验', () => {
  it('正常坐标原样返回（数值化）', () => {
    expect(normalizeLngLat('121.4737', '31.2304')).toEqual({ lng: 121.4737, lat: 31.2304 })
    expect(normalizeLngLat('-73.98', '40.75')).toEqual({ lng: -73.98, lat: 40.75 })
  })

  it('空串/缺参返回 null（⛔ Number("") === 0，不显式拦会被当成经纬度 0）', () => {
    expect(normalizeLngLat('', '31.2')).toBeNull()
    expect(normalizeLngLat('121.4', '')).toBeNull()
    expect(normalizeLngLat(undefined, undefined)).toBeNull()
    expect(normalizeLngLat(null, null)).toBeNull()
    expect(normalizeLngLat('   ', '31.2')).toBeNull()
  })

  it('非数字返回 null', () => {
    expect(normalizeLngLat('abc', '31.2')).toBeNull()
    expect(normalizeLngLat('NaN', 'NaN')).toBeNull()
    expect(normalizeLngLat('Infinity', '31.2')).toBeNull()
  })

  it('超范围返回 null（经度 ±180 / 纬度 ±90）', () => {
    expect(normalizeLngLat('181', '31.2')).toBeNull()
    expect(normalizeLngLat('-181', '31.2')).toBeNull()
    expect(normalizeLngLat('121.4', '91')).toBeNull()
    expect(normalizeLngLat('121.4', '-91')).toBeNull()
  })

  it('(0,0) 视为未定位的脏数据 ⇒ null（否则会把搜索偏到几内亚湾）', () => {
    expect(normalizeLngLat('0', '0')).toBeNull()
  })
})

describe('路由接线：/suggest 必须把偏置传给上游', () => {
  const code = fs.readFileSync(path.join(SRC, 'routes/geocode.js'), 'utf8')

  it('读取 req.query.lng / lat 并归一化', () => {
    expect(code).toContain('normalizeLngLat(req.query.lng, req.query.lat)')
  })

  it('高德 URL 必须拼 location，且是「经度在前」', () => {
    // 高德 location 参数顺序是 lng,lat —— 写反会让偏置落到地球另一端（且不报错）
    expect(code).toMatch(/&location=\$\{bias\.lng\},\$\{bias\.lat\}/)
  })

  it('腾讯侧也传偏置（否则腾讯先返回时偏置等于没做）', () => {
    const t = fs.readFileSync(path.join(SRC, 'utils/tencentMap.js'), 'utf8')
    expect(t).toContain('suggestByTencent(keyword, city, bias)')
    expect(t).toContain('params.location =')
    expect(t).toContain('region_fix')
  })
})

describe('城市优先：/suggest 传 city 但绝不用 citylimit', () => {
  const code = fs.readFileSync(path.join(SRC, 'routes/geocode.js'), 'utf8')

  it('读取 req.query.city 并拼进高德 URL', () => {
    expect(code).toContain("req.query.city")
    expect(code).toContain('&city=${encodeURIComponent(city)}')
  })

  it('🔴 绝不出现 citylimit —— 实测会把没有行政区字段的连锁 POI 整类误杀', () => {
    // 证据：寿司郎在上海，city=上海&citylimit=true 返回 0 条；去掉 citylimit 后前 6 条全是上海门店。
    // ⚠️ 必须先剥注释再断言：注释里正是在解释「为什么不用 citylimit」，不剥会自己把自己判红。
    const codeNoComments = code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(codeNoComments.includes('citylimit')).toBe(false)
  })

  it('腾讯侧也带 region（否则腾讯先返回时城市优先等于没做）', () => {
    const t = fs.readFileSync(path.join(SRC, 'utils/tencentMap.js'), 'utf8')
    expect(t).toContain('if (city) params.region = city')
  })
})

describe('逆地理编码 /regeo：给前端反查当前城市用', () => {
  const code = fs.readFileSync(path.join(SRC, 'routes/geocode.js'), 'utf8')

  it('路由存在，且复用 normalizeLngLat 校验坐标', () => {
    expect(code).toContain("router.get('/regeo'")
    const start = code.indexOf("router.get('/regeo'")
    const body = code.slice(start, start + 600)
    expect(body).toContain('normalizeLngLat(req.query.lng, req.query.lat)')
  })

  it('鉴权在路由组上（router.use(authenticate) 出现在 /regeo 之前）', () => {
    const authIdx = code.indexOf('router.use(authenticate)')
    const regeoIdx = code.indexOf("router.get('/regeo'")
    expect(authIdx).toBeGreaterThan(-1)
    expect(authIdx < regeoIdx).toBe(true)
  })

  it('有缓存（反查按 0.02° 网格 + 24h，不该每次搜索都打上游）', () => {
    const start = code.indexOf("router.get('/regeo'")
    const body = code.slice(start, start + 1600)
    expect(body).toContain('regeoCache')
    expect(body).toContain('toFixed(2)')
  })
})
