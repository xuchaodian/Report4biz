/**
 * 可达范围「改档位不冲掉手调」源码守卫 —— v1.13.310
 *
 * 修的 bug：
 *   客户手调了 10 分钟那一档 → 觉得 20 分钟也想看 → 把第三档从 15 改成 20 → 点分析。
 *   原实现只要新增/修改一档（missing 非空）就走探测分支，而**探测请求传的是 allRadiiMeters
 *   （全部档）**，返回后逐档覆盖 ⇒ 手调好的 10 分钟被机器版替换，
 *   同时 `popBandsEdited = false` 把标记也清了，**全程没有任何提示**。
 *
 * 本守卫钉住四条不变量（都是「改回去也不会报错、只会静默算错」的类型）：
 *   A. 探测请求只能带 toProbe（缺的档），⛔ 不能带全量。
 *   B. 探测后不得无条件清手调标记 —— 要按「本轮仍有效的手调档」重算。
 *   C. 档位减少时必须裁掉 bandPolygons / bandAreas 里多余的键（否则画出多余轮廓）。
 *   D. 换圆心 / 换出行方式时必须清空手调记录（否则 A 点的标记套到 B 点）。
 *
 * 说明：这是前端链路，直接跑浏览器代价太大，故用源码断言 + 真机验证各一半。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const MAP = path.join(REPO_ROOT, 'frontend/src/views/MapView.vue')

const src = fs.readFileSync(MAP, 'utf8')

describe('A. 探测只请求「缺的档」', () => {
  it('先算出 toProbe', () => {
    expect(src, 'toProbe 不见了 —— 探测又会退化成全量重探').toContain(
      'const toProbe = allRadiiMeters.filter(m => !bandPolygons[m])'
    )
  })

  it('请求体带 minutes: toProbe', () => {
    expect(src).toMatch(/minutes:\s*toProbe/)
  })

  it('🔴 全代码不再出现 minutes: allRadiiMeters', () => {
    expect(
      /minutes:\s*allRadiiMeters/.test(src),
      '探测请求又传全量档位了 —— 手调过的档会被机器版覆盖，且客户不会收到任何提示'
    ).toBe(false)
  })

  it('全部档都有形状时不再发探测（省高德调用）', () => {
    expect(src).toMatch(/if\s*\(!toProbe\.length\)/)
  })
})

describe('B. 手调标记按「本轮仍有效的档」重算', () => {
  it('有 editedBandsInScope', () => {
    expect(src).toContain('const editedBandsInScope = popEditedBands.filter')
  })

  it('探测后由列表派生布尔值，而不是写死 false', () => {
    expect(src).toMatch(/popEditedBands = editedBandsInScope\s*\n\s*popBandsEdited = popEditedBands\.length > 0/)
  })

  it('🔴 不再有「无条件 popBandsEdited = false」后紧跟快照赋值的老写法', () => {
    expect(
      /popBandPolygons = \{ \.\.\.bandPolygons \}\s*\n\s*popBandsEdited = false/.test(src),
      '这行组合是老 bug 的核心：探测完直接把手调标记清掉，客户看不出来自己的修改已失效'
    ).toBe(false)
  })
})

describe('C. 档位减少时裁掉多余键', () => {
  it('bandPolygons 与 bandAreas 都要删', () => {
    expect(src).toContain('delete bandPolygons[k]')
    expect(src).toContain('delete bandAreas[k]')
  })

  it('裁剪依据是 allRadiiMeters', () => {
    expect(src).toMatch(/if\s*\(!allRadiiMeters\.includes\(Number\(k\)\)\)\s*delete bandPolygons\[k\]/)
  })
})

describe('D. 换圆心 / 换方式时手调记录作废', () => {
  it('有 !reuseEdited 的清空分支', () => {
    expect(src).toContain('if (!reuseEdited && popBandsEdited)')
  })

  it('清空时三样一起清（列表 / 布尔 / 来源）', () => {
    const m = src.match(/if\s*\(!reuseEdited && popBandsEdited\)\s*\{([\s\S]{0,200}?)\}/)
    expect(m, '找不到清空块').toBeTruthy()
    const body = m[1]
    expect(body).toContain('popEditedBands = []')
    expect(body).toContain('popBandsEdited = false')
    expect(body).toContain("popBandsSource = ''")
  })
})

describe('E. 面板文案区分「部分手调」', () => {
  it('bandSourceText 三态：载入 / 全部 / 部分点名', () => {
    expect(src).toContain('const bandSourceText = () =>')
    expect(src).toContain("if (popBandsSource === 'loaded') return '（自定义范围）'")
    expect(src).toContain('`（${edited.map(bandLabel).join')
  })
})
