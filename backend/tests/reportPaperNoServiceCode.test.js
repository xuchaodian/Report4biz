/**
 * 立项报告纸面「不出现联通服务码」守卫（批次 418）
 *
 * ── 业主诉求（2026-11-26）────────────────────────────────────────────────
 *   ①「『联通人口 1001』这样的描述统一去掉 1001，只需要剩下『联通人口』」
 *   ②「『维度』指标中的『（1013）』这样的描述也全部去掉」
 *
 * ── 为什么值得一条守卫 ────────────────────────────────────────────────────
 *   1001 / 1009 / 1013 是联通的**计费服务码**，纸面读者是业主与领导 ——
 *   码对他们不是信息，只是要追问一句"1001 是什么"。而这些码全写死在字符串里，
 *   散在模板备注、表头、画像 label、口径页脚四处，下次改文案极易漏一处。
 *
 * 🔴 守卫自身规范：断言前**先剥注释** —— 本文件头部就写着这些码，
 *   不剥的话文件自己把自己判红（同 smartstepsBrandHidden.test.js 的做法）。
 * ⚠️ 只扫「纸面可见」的两处文件：ReportPaper.vue（模板 + 版式派生的 label）
 *   与 candidateReport.js 的 provenance 段（口径页脚）。
 *    后端日志、注释、`utils/smartsteps1001.js` 这类解析器不在范围内 ——
 *    它们不渲染到纸上，扫它们只会逼人写错注释。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

/** 剥 HTML 注释 → JS 块注释 → 行注释（HTML 必须先剥，模板里 `<!-- -->` 内含 `//` 会误伤） */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 联通服务码形态：1001 / 1007 / 1009 / 1013 / 1015…（10 开头的四位） */
const CODE = /10\d{2}/

const PAPER = 'frontend/src/components/ReportPaper.vue'
const MODEL = 'frontend/src/utils/candidateReport.js'

describe('A. 纸面模板与版式文案不许出现服务码', () => {
  const src = strip(read(PAPER))

  it('A0 扫描对象不是空文件（防路径写错导致假绿灯）', () => {
    expect(src.length).toBeGreaterThan(6000)
  })

  it('A1 ReportPaper.vue 剥离注释后零命中', () => {
    const hits = src
      .split('\n')
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter((x) => CODE.test(x.line))
    expect(hits).toEqual([])
  })

  it('A2 反向：来源主体「联通人口」仍在（摘码 ≠ 摘来源）', () => {
    expect(src).toContain('联通人口 · 半径')
    expect(src).toContain('联通人口共')
  })
})

describe('B. 口径页脚（provenance）不许出现服务码', () => {
  /** 只截 provenance 对象那一段 —— 文件里 110540 / 1000 这类数字是换算常量，不是服务码 */
  function provenanceSeg() {
    const s = read(MODEL)
    const start = s.indexOf('provenance: {')
    expect(start).toBeGreaterThan(-1)
    // ⚠️ 必须精确停在 provenance 的收尾 `}`：多切一段就会把 fmtM 里的 `n >= 1000` 扫进来
    const conf = s.indexOf('confidence:', start)
    const end = s.indexOf('}', conf)
    expect(conf).toBeGreaterThan(start)
    return strip(s.slice(start, end + 1))
  }

  it('B1 provenance 段零命中', () => {
    const seg = provenanceSeg()
    expect(seg.match(CODE)).toBeNull()
  })

  it('B2 但仍写明「人口：联通人口（点位半径…）」', () => {
    expect(provenanceSeg()).toContain('人口：联通人口（点位半径')
  })
})

describe('C. 居民画像的「维度」列逐行都在，只是不带码', () => {
  const src = read(PAPER)
  const labels = ['消费水平', '消费力指数', '教育', '职业', '人生阶段', '收入预测', '资产预测', '月驻留频次']

  it('C1 八个维度 label 全部存在', () => {
    const missing = labels.filter((l) => !src.includes(`label: '${l}'`))
    expect(missing).toEqual([])
  })

  it('C2 没有一个 label 带「（10xx）」后缀', () => {
    const bad = (src.match(/label: '[^']*（10\d{2}）'/g) || [])
    expect(bad).toEqual([])
  })
})
