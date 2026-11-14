/**
 * 地图首屏预取顺序守卫（v1.13.365 / 批次 365）
 *
 * ── 这一批改了什么 ────────────────────────────────────────────────────────
 * `initMap()` 原来把 5 个全量请求一起 await，其中最慢的是购物中心
 * （7208 条 / 485KB / 外部冒烟报告实测 3.3s，全站最重的一个 GET）。
 * 结果是：**默认只渲染「我的门店」这一层，却要等 3.3s 才出图**。
 * 本批把购物中心摘出首屏 await，改成 `loadMarkers` 之后后台拉。
 *
 * ── 🔴🔴 为什么只摘购物中心，不把三个一起摘掉 ─────────────────────────────
 * 这是本守卫存在的**唯一理由**，别当成「顺手」：
 * `competitorStore.competitors` / `brandStoreStore.brandStores` 在**图层开关打开之前**
 * 就被 20 余处读取，其中两处读到空数组**不是空态，是反向的业务结论**：
 *   · `aiContext.competitors_count` → 送 AI 选址 ⇒ 「周边无竞品」，建议直接反过来
 *   · 圆分析的竞争强度          ⇒ 「圈内 0 家竞品」
 * 而 `shoppingCenterStore` 不参与任何分析链路（不进 aiContext、不进圆分析、
 * 不进竞争强度），只喂图层渲染与筛选下拉 ⇒ 它是**最贵的那个，恰好也是最安全的那个**。
 * 所以：⛔ 不要把竞品/品牌门店也挪出 await；⛔ 也不要把购物中心 await 回去。
 *
 * ── 第二条要钉死的：toggle 不能再用 skipFetch ─────────────────────────────
 * 数据既然不再保证「首屏已就绪」，watch 里 `loadShoppingCenters(true)`（skipFetch）
 * 就会在数据未到时渲染 0 条，且**没有任何后续触发点**把它补回来。
 * 改成不传参后靠 store 的 in-flight 合并 + 60s 新鲜期去重保证幂等
 * ⇒ F 组把这两个前提也钉住，否则哪天 store 去掉去重，C 组的修法会静默失效。
 *
 * （前端无独立测试框架，故与 brandTokenGuard / touchTargetGuard / textTierContrastGuard
 *   一致挂在 backend vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/** ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，pathname 会留下百分号编码导致 ENOENT */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MAP_VIEW = path.join(REPO_ROOT, 'frontend/src/views/MapView.vue')
const SHOP_STORE = path.join(REPO_ROOT, 'frontend/src/stores/shoppingCenterStore.js')

const mapSrc = fs.readFileSync(MAP_VIEW, 'utf8')
const storeSrc = fs.readFileSync(SHOP_STORE, 'utf8')

/** 取 initMap 里「拉数据」之后的区域：从 initLayerBrands() 到文件里下一个段落注释 */
function initMapTail() {
  const anchor = mapSrc.indexOf('brandStoreStore.initLayerBrands()')
  expect(anchor, 'initMap 里找不到 initLayerBrands() —— 定位锚点失效').toBeGreaterThan(-1)
  const end = mapSrc.indexOf('// 地址搜索（使用高德地图API', anchor)
  expect(end, '找不到 initMap 结束的段落注释 —— 定位锚点失效').toBeGreaterThan(anchor)
  return mapSrc.slice(anchor, end)
}

/** 取首屏那个 await Promise.all([...]) 的完整实参块（含括号） */
function firstPaintPromiseAll(tail) {
  const start = tail.indexOf('await Promise.all([')
  expect(start, '首屏的 await Promise.all([ 不见了').toBeGreaterThan(-1)
  const close = tail.indexOf('])', start)
  expect(close, '首屏的 await Promise.all 没有闭合 —— 锚点失效').toBeGreaterThan(start)
  return tail.slice(start, close + 2)
}

/** 取某个 watch 的整块（从 watch(xxx 到下一个 `\n})`） */
function watchBlock(name) {
  const start = mapSrc.indexOf(`watch(${name}`)
  expect(start, `找不到 watch(${name} —— 定位锚点失效`).toBeGreaterThan(-1)
  const close = mapSrc.indexOf('\n})', start)
  expect(close, `watch(${name} 没有闭合`).toBeGreaterThan(start)
  return mapSrc.slice(start, close + 3)
}

const countOf = (hay, needle) => hay.split(needle).length - 1

describe('A. 首屏 await 的成员（竞品与品牌门店必须在内）', () => {
  it('首屏仍有 await Promise.all([...]) 且包含 markers / 品牌图标', () => {
    const block = firstPaintPromiseAll(initMapTail())
    expect(block).toContain('markerStore.fetchMarkers()')
    expect(block).toContain('brandIconStore.fetchBrandIcons()')
  })

  it('🔴🔴 竞品必须在首屏 await 内（否则 aiContext / 圆分析读空数组）', () => {
    const block = firstPaintPromiseAll(initMapTail())
    expect(block).toContain('competitorStore.fetchCompetitors()')
  })

  it('🔴🔴 品牌门店必须在首屏 await 内（否则 visibleStores / 筛选下拉读空数组）', () => {
    const block = firstPaintPromiseAll(initMapTail())
    expect(block).toContain('brandStoreStore.fetchBrandStores()')
  })

  it('购物中心**不得**在首屏 await 内', () => {
    const block = firstPaintPromiseAll(initMapTail())
    expect(block).not.toContain('shoppingCenterStore.fetchShoppingCenters()')
  })
})

describe('B. 购物中心必须走「后台补齐」而不是 await', () => {
  it('initMap 区域里有 fetchShoppingCenters().then( 的后台链', () => {
    expect(initMapTail()).toContain('shoppingCenterStore.fetchShoppingCenters().then(')
  })

  it('⛔ initMap 里不得出现 await ... fetchShoppingCenters()（会被 await 回阻塞）', () => {
    const tail = initMapTail()
    // 只允许「.then(」形态；显式 await 就是回退
    expect(tail).not.toMatch(/await\s+shoppingCenterStore\.fetchShoppingCenters\(/)
  })

  it('后台链带 .catch( 兜底（fire-and-forget 不能留 unhandled rejection）', () => {
    const tail = initMapTail()
    const at = tail.indexOf('shoppingCenterStore.fetchShoppingCenters().then(')
    expect(at).toBeGreaterThan(-1)
    // 取这段链的头部 900 字符，断言里面有 .catch(
    expect(tail.slice(at, at + 900)).toContain('.catch(')
  })

  it('后台回调同时处理「图层已开」与「聚合模式」两种重建', () => {
    const tail = initMapTail()
    const at = tail.indexOf('shoppingCenterStore.fetchShoppingCenters().then(')
    const chunk = tail.slice(at, at + 900)
    // ⚠️ 两条都必须断言**完整条件**，不能只断言出现了函数名：
    //    变异测试 M8 证明「只查 buildAllStoreCluster」会被
    //    `else if (false) buildAllStoreCluster()` 骗过（名字还在、条件没了＝不重建）。
    expect(chunk).toContain('if (showShoppingCenterLayer.value && shoppingCenterLayer) updateShoppingCenterDisplay()')
    expect(chunk).toContain('else if (showCluster.value) buildAllStoreCluster()')
  })
})

describe('C. 图层开关不得再传 skipFetch', () => {
  it('全文件 0 处 loadShoppingCenters(true)', () => {
    expect(countOf(mapSrc, 'loadShoppingCenters(true)')).toBe(0)
  })

  it('watch(showShoppingCenterLayer) 用的是无参调用', () => {
    const block = watchBlock('showShoppingCenterLayer')
    expect(block).toContain('await loadShoppingCenters()')
  })

  it('loadShoppingCenters 保留 skipFetch 形参默认值（签名不能被删）', () => {
    expect(mapSrc).toContain('const loadShoppingCenters = async (skipFetch = false) => {')
  })

  it('无参调用时 loadShoppingCenters 真的会 await 拉数据（否则 C 组修法空转）', () => {
    const at = mapSrc.indexOf('const loadShoppingCenters = async (skipFetch = false) => {')
    const body = mapSrc.slice(at, at + 600)
    expect(body).toContain('if (!skipFetch) {')
    expect(body).toContain('await shoppingCenterStore.fetchShoppingCenters()')
  })
})

describe('D. 反向断言：竞品 / 品牌门店的 watch 仍传 true', () => {
  it('loadCompetitors(true) 仍存在（数据在首屏 await 内，传参是为免重复请求）', () => {
    expect(countOf(mapSrc, 'loadCompetitors(true)')).toBe(1)
  })

  it('loadBrandStores(true) 仍存在', () => {
    expect(countOf(mapSrc, 'loadBrandStores(true)')).toBe(1)
  })

  it('⚠️ 三处调用形态**刻意不一致**，别「统一风格」批量改', () => {
    // 竞品/品牌门店 = true（数据已就绪，跳过 fetch）；购物中心 = 无参（可能还在路上）
    expect(mapSrc).toContain('await loadCompetitors(true)')
    expect(mapSrc).toContain('await loadBrandStores(true)')
    expect(mapSrc).toContain('await loadShoppingCenters()')
  })
})

describe('E. 「为什么竞品必须 await」的证据链（消费点仍在，不许删）', () => {
  it('aiContext 仍把竞品数量送 AI 选址', () => {
    expect(mapSrc).toContain('competitors_count: competitorStore.activeCompetitors.length')
  })

  it('圆分析仍直接读 activeCompetitors', () => {
    expect(mapSrc).toContain('let competitorData = competitorStore.activeCompetitors')
  })

  it('竞品 / 品牌门店 / 购物中心的筛选下拉仍从 store 计算', () => {
    expect(mapSrc).toContain('const compCityList = computed(()')
    expect(mapSrc).toContain('const brandCityList = computed(()')
    expect(mapSrc).toContain('const shopCityList = computed(()')
  })
})

describe('F. C 组依赖的幂等前提（store 里还在不在）', () => {
  it('in-flight 合并仍在', () => {
    expect(storeSrc).toContain('if (shoppingCentersInFlight) return shoppingCentersInFlight')
  })

  it('60s 新鲜期去重仍在', () => {
    expect(storeSrc).toContain('const FRESH_MS = 60 * 1000')
    expect(storeSrc).toMatch(/this\.loadedAt && Date\.now\(\) - this\.loadedAt < FRESH_MS/)
  })

  it('拉取异常自己兜底成空数组（否则后台链会打出 unhandled rejection）', () => {
    expect(storeSrc).toContain('this.shoppingCenters = []')
  })
})
