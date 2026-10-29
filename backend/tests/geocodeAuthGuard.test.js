/**
 * 高德代理接口的鉴权/限速守卫（v1.13.281）
 *
 * 背景：`/api/geocode/*` 与 `/api/poi/*` 原先**既无鉴权也无任何速度上限**，
 *   直接用服务端的 `AMAP_KEY` 调高德。任何人都能 curl 循环刷，
 *   而 `batch-geocode` 一次可解析上百条地址、`business-count` 每次真实烧 POI 配额。
 *
 * 本文件钉住三件事：
 *   ① geocode 路由组必须挂 authenticate + 限速；
 *   ② poi 路由组**整组**必须登录（v1.13.290 起），且 authenticate 必须排在 rateLimit 之前；
 *   ③ 前端凡是打这些端点的**裸 fetch** 必须带 Authorization —— 否则挂上鉴权就会 401
 *      （这是本类改动最容易漏的一步，漏了只有真实浏览器才暴露）。
 *
 * 📌 v1.13.290：`/around`、`/polygon` 从「裸 fetch 所以不敢挂鉴权」改为「整组登录 +
 *    前端统一走 utils/authHeaders.js」。本条测试随之从「抽查 2 处字面量」升级为
 *    「枚举 MapView 里所有 /api/poi fetch，逐个要求走 authHeaders、且禁止再手写字面量」。
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

describe('poi 路由组：整组必须登录（v1.13.290）', () => {
  it('路由组挂了 authenticate', () => {
    expect(poiSrc).toContain("import { authenticate } from '../middleware/auth.js'")
    expect(poiSrc).toContain('router.use(authenticate)')
  })

  it('authenticate 必须排在 rateLimit 之前（别人可以按 IP 换着刷）', () => {
    const iAuth = poiSrc.indexOf('router.use(authenticate)')
    const iRate = poiSrc.indexOf('router.use(rateLimit(')
    expect(iAuth, '未挂 router.use(authenticate)').toBeGreaterThan(-1)
    expect(iRate, '未挂 router.use(rateLimit(').toBeGreaterThan(-1)
    expect(iAuth < iRate, 'authenticate 必须在 rateLimit 之前 —— 否则限流桶按 IP 计，换 IP 即绕过').toBe(true)
  })

  it('路由组有限速兜底', () => {
    expect(/router\.use\(rateLimit\(\{\s*max:\s*\d+/.test(poiSrc)).toBe(true)
  })

  it('batch-geocode 保留更严的独立限速（整组已鉴权，不再重复挂）', () => {
    const line = poiSrc.split('\n').find(l => l.includes("'/batch-geocode'")) || ''
    expect(line, '未找到 /batch-geocode 定义').not.toBe('')
    expect(line.includes("name: 'batchgeo'"), 'batch-geocode 未挂独立限速').toBe(true)
    // 整组已 router.use(authenticate)，逐条再挂会白跑一次 jwt.verify + 库查询
    expect(line.includes('authenticate'), 'batch-geocode 重复挂了 authenticate').toBe(false)
  })

  it('business-count 同样不重复挂（组级已覆盖）', () => {
    const line = poiSrc.split('\n').find(l => l.includes("'/business-count'")) || ''
    expect(line, '未找到 /business-count 定义').not.toBe('')
    expect(line.includes('authenticate'), 'business-count 重复挂了 authenticate').toBe(false)
  })

  it('around / polygon 也被组级鉴权覆盖（历史上它们是裸的）', () => {
    for (const p of ["'/around'", "'/polygon'"]) {
      const line = poiSrc.split('\n').find(l => l.includes(`router.post(${p}`)) || ''
      expect(line, `未找到 ${p} 定义`).not.toBe('')
      expect(line.includes('authenticate'), `${p} 单独挂了 authenticate —— 组级已覆盖，重复`).toBe(false)
    }
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

  it('MapView 里 5 处 /api/poi 裸 fetch 全部走 authHeaders（v1.13.290）', () => {
    // ⚠️ 不能用「片段里有没有 Authorization 字样」判定：它们统一走 authHeaders()，
    //    字面量 Authorization 只出现在 utils/authHeaders.js 里一处。
    const idxs = []
    for (const ep of ['/api/poi/around', '/api/poi/polygon']) {
      let i = -1
      while ((i = mapViewSrc.indexOf(`fetch('${ep}'`, i + 1)) > -1) idxs.push(i)
    }
    expect(idxs.length, `MapView 里 /api/poi 裸 fetch 数量应≥5，实际 ${idxs.length}`).toBeGreaterThanOrEqual(5)
    for (const i of idxs) {
      const snippet = mapViewSrc.slice(i, i + 200)
      expect(snippet.includes('authHeaders('),
        'POI 的 fetch 没走 authHeaders —— /api/poi/* 已整组鉴权，会 401').toBe(true)
      expect(snippet.includes('Authorization'),
        '这里又手写了 Authorization —— 统一走 utils/authHeaders.js').toBe(false)
    }
    expect(mapViewSrc).toContain("import { authHeaders } from '@/utils/authHeaders.js'")
  })

  it('aiExecutor 的 callPoiApi 也带 token（AI 助手的 POI 检索）', () => {
    const aiSrc = read('frontend/src/utils/aiExecutor.js')
    const idx = aiSrc.indexOf('async function callPoiApi')
    expect(idx, '未找到 callPoiApi').toBeGreaterThan(-1)
    const snippet = aiSrc.slice(idx, idx + 320)
    expect(snippet.includes('authHeaders('), 'callPoiApi 未走 authHeaders —— AI 助手 POI 检索会 401').toBe(true)
  })

  it('authHeaders 取的是 sessionStorage.token（⛔ 不是 localStorage）', () => {
    const hSrc = read('frontend/src/utils/authHeaders.js')
    // 🔴 必先剥注释：本文件顶部的说明里就写着「⛔ 不是 localStorage」，
    //    不剥注释会把自己文档里的字面量当成违规（v1.13.290 实测踩到）
    const code = hSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).toContain("sessionStorage.getItem('token')")
    expect(code.includes('localStorage'), 'authHeaders 读了 localStorage —— 与 api.js 不一致，会串档').toBe(false)
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
