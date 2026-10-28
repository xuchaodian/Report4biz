/**
 * 高德代理接口的鉴权/限速守卫（v1.13.281）
 *
 * 背景：`/api/geocode/*` 与 `/api/poi/*` 原先**既无鉴权也无任何速度上限**，
 *   直接用服务端的 `AMAP_KEY` 调高德。任何人都能 curl 循环刷，
 *   而 `batch-geocode` 一次可解析上百条地址、`business-count` 每次真实烧 POI 配额。
 *
 * 本文件钉住三件事：
 *   ① geocode 路由组必须挂 authenticate + 限速；
 *   ② 真正烧钱的两个 poi 端点必须登录，且 batch-geocode 有更严的独立限速；
 *   ③ 前端那两处**裸 fetch** 必须带 Authorization —— 否则挂上鉴权就会 401
 *      （这是本类改动最容易漏的一步，漏了只有真实浏览器才暴露）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8')

const geocodeSrc = read('backend/src/routes/geocode.js')
const poiSrc = read('backend/src/routes/poi.js')
const rateLimitSrc = read('backend/src/utils/rateLimit.js')
const mapViewSrc = read('frontend/src/views/MapView.vue')

describe('geocode 路由组：必须登录 + 限速', () => {
  it('挂了 authenticate', () => {
    expect(geocodeSrc).toContain("import { authenticate } from '../middleware/auth.js'")
    expect(geocodeSrc).toContain('router.use(authenticate)')
  })

  it('挂了限速中间件', () => {
    expect(rateLimitSrc.includes('export function rateLimit(')).toBe(true)
    expect(
      /router\.use\(rateLimit\(\{\s*max:\s*\d+/.test(geocodeSrc),
      'geocode 路由组未挂 rateLimit —— 高德配额可被无限刷'
    ).toBe(true)
  })
})

describe('poi 路由组：烧钱的端点必须登录', () => {
  it('路由组有限速兜底', () => {
    expect(/router\.use\(rateLimit\(\{\s*max:\s*\d+/.test(poiSrc)).toBe(true)
  })

  it('batch-geocode 必须登录 + 更严限速', () => {
    const line = poiSrc.split('\n').find(l => l.includes("'/batch-geocode'")) || ''
    expect(line, '未找到 /batch-geocode 定义').not.toBe('')
    expect(line.includes('authenticate'), 'batch-geocode 未挂 authenticate').toBe(true)
    expect(line.includes("name: 'batchgeo'"), 'batch-geocode 未挂独立限速').toBe(true)
  })

  it('business-count 必须登录（每次真实消耗高德 POI 配额）', () => {
    const line = poiSrc.split('\n').find(l => l.includes("'/business-count'")) || ''
    expect(line, '未找到 /business-count 定义').not.toBe('')
    expect(line.includes('authenticate'), 'business-count 未挂 authenticate').toBe(true)
  })
})

describe('前端裸 fetch：必须自带 Authorization（否则挂鉴权即 401）', () => {
  it('/api/geocode/ip-location 带 token', () => {
    const idx = mapViewSrc.indexOf("fetch('/api/geocode/ip-location'")
    expect(idx, '未找到 ip-location 调用').toBeGreaterThan(-1)
    const snippet = mapViewSrc.slice(idx, idx + 260)
    expect(snippet.includes("'Authorization'"), 'ip-location 的 fetch 没带 Authorization —— 地图页定位会 401').toBe(true)
  })

  it('/api/geocode/suggest 带 token', () => {
    const idx = mapViewSrc.indexOf('fetch(`/api/geocode/suggest')
    expect(idx, '未找到 suggest 调用').toBeGreaterThan(-1)
    const snippet = mapViewSrc.slice(idx, idx + 260)
    expect(snippet.includes("'Authorization'"), 'suggest 的 fetch 没带 Authorization —— 地址搜索会 401').toBe(true)
  })
})

describe('限流器自身：不给默认 max，避免"随手一挂等于没限"', () => {
  it('max 缺失时抛错', () => {
    expect(rateLimitSrc.includes("throw new Error('rateLimit 必须先给一个正数 max')")).toBe(true)
  })

  it('复用既有 overLimit 桶，不另建计数器', () => {
    expect(rateLimitSrc.includes('if (overLimit(key, max, windowMs))')).toBe(true)
  })
})
