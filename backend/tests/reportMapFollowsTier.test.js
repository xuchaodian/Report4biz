/**
 * 立项报告「位置示意」必须跟当前人口档走（批次 420）
 *
 * ── 业主 2026-11-26 ──────────────────────────────────────────────────────
 *   问「『位置示意』的图片不会随着选择半径切换而变化的是吗」，实测确认：**确实不变**。
 *   授权修复：「按方案改，重画也按当前档只画圈」。
 *
 * ── 改前的真实行为（生产实测）────────────────────────────────────────────
 *   默认 1km 档：位置示意「半径 1.0 km」、人口块「半径 1km 内」、`img.src` 111043 字符；
 *   切到 3km 档：人口块变「半径 3km 内」，位置示意**仍是 1.0 km**、`img.src` **一字节未变**。
 *   ⇒ 纸面同时存在两套半径，读图的人会拿 1km 的圈当 3km 数据的证据。
 *
 * ── 根因（三处都固定用候选点位的评估半径 `candidate.radius`）──────────────
 *   ① `CandidateReport.vue::renderMap()` 传给 `captureMapOnlyCanvas` 的是 `c.radius`；
 *      而该函数的 zoom 由半径算出（圈恒占短边 30%）⇒ 半径不变必然出同一张图。
 *   ② `renderMap()` 只在 `onOpened()` 调一次，切档没有 watch 触发重画。
 *   ③ `buildReportModel()` 的 `coordinate.radius` 也固定 `c.radius`，
 *      而纸面「位置示意」的标题就渲染它。
 *
 * 🔴 本守卫钉三件事：数据层跟档位、渲染层跟档位且有竞态保护、切档时不拿旧图冒充。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReportModel } from '../../frontend/src/utils/candidateReport.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
const CMP = 'frontend/src/components/CandidateReport.vue'

/** 一个最小可用候选点位：评估半径 1km（与生产 demo 同形） */
function candidate() {
  return {
    name: '测试点位', brand: '优事', city: '上海市',
    latitude: 31.077159, longitude: 121.496987,
    radius: 1000, address: '浦锦路 309 弄'
  }
}

describe('A. 数据层：coordinate.radius 必须＝当前人口档（纸面标题直接渲染它）', () => {
  it('A1 传了 popRadius ⇒ 用它，⛔ 不再用候选点位的评估半径', () => {
    const m = buildReportModel(candidate(), {}, { popRadius: 3000, population: null, tiers: [] })
    expect(m.coordinate.radius).toBe(3000)
  })

  it('A2 档位与评估半径相同时也一样（防止把回退顺序写反）', () => {
    const m = buildReportModel(candidate(), {}, { popRadius: 1000, population: null, tiers: [] })
    expect(m.coordinate.radius).toBe(1000)
  })

  it('A3 没传档位（旧调用/无已购）⇒ 回退候选评估半径，行为不变', () => {
    const m = buildReportModel(candidate(), {}, { population: null, tiers: [] })
    expect(m.coordinate.radius).toBe(1000)
  })

  it('A4 popRadius 为 0 / null ⇒ 回退，⛔ 不能把半径算成 0', () => {
    for (const bad of [0, null, undefined, '']) {
      const m = buildReportModel(candidate(), {}, { popRadius: bad, population: null, tiers: [] })
      expect(m.coordinate.radius).toBe(1000)
    }
  })

  it('A5 候选点位没填 radius ⇒ 仍给 1000 兜底（不出现 0 米）', () => {
    const c = candidate()
    delete c.radius
    const m = buildReportModel(c, {}, { population: null, tiers: [] })
    expect(m.coordinate.radius).toBe(1000)
  })
})

describe('B. 渲染层：renderMap 用当前档半径，且能丢弃过期结果', () => {
  const src = read(CMP)
  /** 只截 renderMap 函数体（到下一个函数定义为止） */
  const seg = (() => {
    const start = src.indexOf('async function renderMap')
    expect(start).toBeGreaterThan(-1)
    const end = src.indexOf('async function genAi', start)
    expect(end).toBeGreaterThan(start)
    return src.slice(start, end)
  })()

  it('B1 半径来自 popRadius（候选半径只作回退）', () => {
    expect(seg).toContain('popRadius.value')
    // 旧写法：直接 Number(c.radius) || 1000 —— 出现即回退到「图不跟档位」
    expect(seg).not.toMatch(/captureMapOnlyCanvas\([^)]*Number\(c\.radius\)\s*\|\|\s*1000\s*\)/)
  })

  it('B2 有竞态保护（连点切档时只认最后一次）', () => {
    expect(seg).toContain('mapSeq')
    expect(seg).toMatch(/seq\s*!==\s*mapSeq/)
  })

  it('B3 切档会触发重画（watch popRadius）', () => {
    expect(src).toMatch(/watch\(popRadius\s*,/)
  })

  it('B4 切档先清图，⛔ 不让上一档的圈继续冒充当前档', () => {
    const start = src.indexOf('watch(popRadius')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('})', start) + 2)
    expect(body).toContain("mapImg.value = ''")
  })

  it('B5 关窗时掐掉待重画的定时器（否则关了还在抓瓦片）', () => {
    const start = src.indexOf('watch(() => props.modelValue')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('})', start) + 2)
    expect(body).toContain('clearTimeout(mapTimer)')
  })
})
