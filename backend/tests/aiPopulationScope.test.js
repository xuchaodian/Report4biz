/**
 * AI 助手 × 人口分析「口径串味」源码守卫 —— v1.13.312
 *
 * 修的 bug（2026-11-03 审计坐实）：
 *   `openStorePopulationDistribution` 只重置 `circleForm.radius`，**从不重置 `popScopeMode`**。
 *   而 `popScopeMode` 是弹窗级全局状态 —— 客户上次手动选过「驾车可达」就会一直留着。
 *   ⇒ 之后走这个入口（门店 popup / AI 助手）时，弹窗按**驾车口径**打开，
 *     传进来的 `radius` 只写进 `circleForm.radius`（圆模式字段，驾车下不显示也不生效）。
 *   ⇒ 结果：说「半径 2 公里」，实际跑的是「驾车 10 分钟」，数字对不上且**不报任何错**。
 *
 * 本守卫钉住的不变量（都属于「改回去不报错、只会静默算错口径」的类型）：
 *   A. 门店入口必须重置 `popScopeMode`（不传 opts 时回圆模式）。
 *   B. 门店入口必须能接收 opts.minutes 并写进 driveMinutes（否则 AI 说 5 分钟、跑的是 10 分钟）。
 *   C. AI 执行器必须把 scope/minutes 透传给入口，且 scope 要做兜底归一。
 *   D. 工具描述必须写清「radius 仅 round 生效」，否则模型会在可达模式下继续传半径。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const MAP = path.join(REPO_ROOT, 'frontend/src/views/MapView.vue')
const EXEC = path.join(REPO_ROOT, 'frontend/src/utils/aiExecutor.js')
const TOOLS = path.join(REPO_ROOT, 'backend/src/ai/tools.js')

const mapSrc = fs.readFileSync(MAP, 'utf8')
const execSrc = fs.readFileSync(EXEC, 'utf8')
const toolsSrc = fs.readFileSync(TOOLS, 'utf8')

/** 取 openStorePopulationDistribution 的函数体（到下一个顶层 const 定义为止） */
function storePopBody() {
  const start = mapSrc.indexOf('const openStorePopulationDistribution')
  expect(start, '找不到 openStorePopulationDistribution（守卫已失锚，请同步更新）').toBeGreaterThan(-1)
  const nextIdx = mapSrc.indexOf('// 门店popup"联通人口"按钮', start)
  return mapSrc.slice(start, nextIdx > start ? nextIdx : start + 4000)
}

describe('A. 门店入口必须重置范围口径', () => {
  it('🔴 函数体内必须出现 popScopeMode 赋值（0 次＝口径串味 bug 回来了）', () => {
    const body = storePopBody()
    const hits = body.match(/popScopeMode\.value\s*=/g) || []
    expect(
      hits.length,
      '门店入口没有重置 popScopeMode ⇒ 客户上次选的「驾车」会串到这次，' +
        '而传进来的 radius 在驾车口径下不生效（说半径 2 公里、跑的是驾车 10 分钟）'
    ).toBeGreaterThan(0)
  })

  it('不传 opts 时回圆模式（wantReach 判据 + 三选一）', () => {
    const body = storePopBody()
    expect(body).toMatch(/opts\.scope === 'drive' \|\| opts\.scope === 'walk'/)
    expect(body).toMatch(/popScopeMode\.value = wantReach \? opts\.scope : 'circle'/)
  })

  it('认不出的 scope 不允许落到可达口径（只有 drive/walk 才认）', () => {
    const body = storePopBody()
    const m = body.match(/const wantReach = (.+)/)
    expect(m, '找不到 wantReach 判据').toBeTruthy()
    expect(m[1]).not.toMatch(/else|!==/)
  })
})

describe('B. 可达时间档要写进 driveMinutes', () => {
  it('函数体接收 opts.minutes 并赋给 m1/m2/m3', () => {
    const body = storePopBody()
    expect(body).toContain('opts.minutes')
    expect(body).toContain('driveMinutes.m1 =')
    expect(body).toContain('driveMinutes.m2 =')
    expect(body).toContain('driveMinutes.m3 =')
  })

  it('⛔ 非法/超量档位要被过滤（最多 3 档、必须 >0）', () => {
    const body = storePopBody()
    expect(body).toMatch(/Number\.isFinite\(m\) && m > 0/)
    expect(body).toContain('.slice(0, 3)')
  })
})

describe('C. AI 执行器要透传 scope / minutes', () => {
  it('调用点带第 4 个参数（opts）', () => {
    expect(execSrc).toContain(
      'window.openStorePopulationDistribution(lat, lng, radius, { scope, minutes: useMins })'
    )
  })

  it('🔴 反向：不允许再出现只传三个参数的调用（那等于丢弃口径）', () => {
    expect(
      /window\.openStorePopulationDistribution\(lat, lng, radius\)/.test(execSrc),
      'AI 调用点退回三参数了 —— scope/minutes 会被静默丢弃，可达口径又用不了'
    ).toBe(false)
  })

  it('scope 兜底归一：只认 drive/walk，其余回 round', () => {
    expect(execSrc).toMatch(/const scope = \['drive', 'walk'\]\.includes\(rawScope\) \? rawScope : 'round'/)
  })

  it('可达口径但没给档位时默认 10 分钟（不静默留空）', () => {
    expect(execSrc).toContain("const useMins = scope === 'round' ? [] : (givenMins.length ? givenMins : [10])")
  })

  it('回复里写明口径（客户要能看出数字按什么范围算的）', () => {
    expect(execSrc).toContain('const scopeText = scope === \'round\'')
  })

  it('🔴 面板摘要也要按口径显示（真机踩到：弹窗跑驾车、摘要却写「半径 2公里」）', () => {
    expect(
      execSrc,
      'describeAction 的摘要固定写「半径 N 公里」⇒ 与弹窗实际口径自相矛盾'
    ).toContain("门店人口分布分析：${args.store_keyword}（${scope === 'walk' ? '步行' : '驾车'}")
  })
})

describe('D. 工具描述要约束模型别在可达模式下传半径', () => {
  const m = toolsSrc.match(/const storePopulationDistribution = \{[\s\S]*?\n\}\n/)
  it('工具定义存在', () => {
    expect(m, '找不到 storePopulationDistribution 工具定义').toBeTruthy()
  })

  it('声明了 scope 与 minutes 参数', () => {
    const body = m[0]
    expect(body).toContain('scope: {')
    expect(body).toContain('minutes: {')
    expect(body).toMatch(/round（半径圆，\*\*默认\*\*）/)
  })

  it('🔴 radius 的描述必须写明「仅 round 生效」', () => {
    expect(
      m[0],
      'radius 没写清生效范围 ⇒ 模型会在驾车模式下继续传半径，客户看到的口径与实际不符'
    ).toMatch(/仅 scope=round 时生效/)
  })

  it('minutes 要提示会消耗探测配额（付费红线）', () => {
    expect(m[0]).toContain('消耗一次可达范围探测配额')
  })
})
