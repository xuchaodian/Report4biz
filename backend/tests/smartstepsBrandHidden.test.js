/**
 * 「智慧足迹」品牌名隐藏守卫（批次 404）
 *
 * ── 业主诉求（2026-11-23）──────────────────────────────────────────────
 * 「初步分析页面下方有『联通智慧足迹』的数据出处描述，帮我把『智慧足迹』隐藏掉，
 *   关联到联通人口的地方都不要出现『智慧足迹』。同时复核系统其他地方是否有该字样。」
 *
 * ── 口径（改文案前想清楚的三件事）────────────────────────────────────────
 *   ① **只摘品牌名，不摘来源主体**：「联通」必须留着 —— 数据来源声明摘掉主体
 *      就成了「无来源」，比多写一个品牌名更糟。所以每条断言都是「不含品牌名」+「仍含联通」成对出现。
 *   ② 前端**零例外**：`frontend/src` 下任何字符串都可能被渲染（模板、props 默认值、
 *      title 悬浮提示、导出 PDF 的 facts），所以不区分「注释 / 文案」一刀切 ——
 *      留注释里的漏网之鱼，下一个人复制粘贴就又带回去了。
 *   ③ 后端**只放行注释与运行日志**：`console.error('智慧足迹API错误')` 是给运维定位
 *      「哪个上游挂了」用的，删了反而更难排查；但任何会进 `res.json()` 或进 AI prompt
 *      的字符串一律不许出现 —— prompt 里写了，模型就会在回复里复述给用户看。
 *
 * 🔴 守卫自身规范：断言文案时必须**先剥注释**，否则本文件头部注释里的品牌名自己就把自己判红了。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const WORD = '智慧足迹'

/** 递归列出目录下指定扩展名的文件（跳过 node_modules / dist*） */
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name.startsWith('dist')) continue
      walk(p, exts, out)
    } else if (exts.some((e) => ent.name.endsWith(e))) {
      out.push(p)
    }
  }
  return out
}

const rel = (p) => path.relative(REPO, p).split(path.sep).join('/')

/** 剥 HTML 注释 → JS 块注释 → 行注释（HTML 必须最先剥，Vue 模板里 `<!-- -->` 内含 `//` 会误伤） */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('A. 前端：frontend/src 全目录不许出现「智慧足迹」', () => {
  const files = walk(path.join(REPO, 'frontend/src'), ['.vue', '.js', '.md'])

  it('扫描范围不为空（防止路径写错导致假绿灯）', () => {
    expect(files.length).toBeGreaterThan(80)
  })

  it('A1 零命中 —— 注释也算（注释会被复制粘贴回到文案里）', () => {
    const hits = files
      .filter((f) => fs.readFileSync(f, 'utf8').includes(WORD))
      .map(rel)
    expect(hits).toEqual([])
  })
})

describe('B. 后端：除注释与运行日志外不许出现', () => {
  const files = walk(path.join(REPO, 'backend/src'), ['.js'])

  /** 把「纯注释行」与「console 行」挖成空行，保留行号方便报错定位 */
  function mask(src) {
    return src
      .split('\n')
      .map((line, i) => {
        const t = line.trim()
        const isComment = t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
        const isLog = line.includes('console.')
        return isComment || isLog ? `${i + 1}: ` : `${i + 1}: ${line}`
      })
      .join('\n')
  }

  it('B1 非注释非日志的代码行零命中（会进 res.json / prompt 的就在这里）', () => {
    const hits = []
    for (const f of files) {
      const masked = mask(fs.readFileSync(f, 'utf8'))
      for (const line of masked.split('\n')) {
        if (line.includes(WORD)) hits.push(`${rel(f)}: ${line.trim().slice(0, 120)}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('B2 放行的那两类确实还在（说明 B1 的过滤是「有意放行」而不是「整个文件被跳过」）', () => {
    const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
    // 上游 API 名在注释/日志里保留，供运维排查
    expect(all.includes(WORD)).toBe(true)
  })
})

describe('C. 用户可见文案必须是「联通人口」', () => {
  const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')

  it('C1 立项报告纸面人口块小标题', () => {
    const s = read('frontend/src/components/ReportPaper.vue')
    expect(s).toContain('联通人口 1001 · 半径')
  })

  it('C2 立项报告人口条说明', () => {
    // v1.13.413：取数条改成「只选已购档」，原来的「联通人口 · 点位半径口径 · 同半径已购自动复用」
    // 那句随取数按钮一起撤了。用户可见文案仍必须是「联通人口」（⛔ 不许写上游厂商名）。
    const s = read('frontend/src/components/CandidateReport.vue')
    expect(s).toContain('<b>联通人口</b>')
    expect(s, '必须如实写明不消耗配额').toContain('已购数据 · 不消耗配额')
  })

  it('C3 初步分析「要不要花钱深入」面板表头', () => {
    expect(read('frontend/src/components/CandidateBriefUpgrade.vue')).toContain('联通人口 · 按半径圆取数')
  })

  it('C4 纸面 facts 的来源串（居住/工作人口 note）', () => {
    const s = read('frontend/src/utils/candidateReport.js')
    expect(s).toContain('联通人口${b.popMonth ?')
    expect(s).toContain("'联通人口 · 居住人口口径'")
    expect(s).toContain('人口：联通人口 1001（点位半径')
  })

  it('C5 商圈洞察数据口径卡', () => {
    expect(read('frontend/src/utils/dataProvenance.js')).toContain('联通人口 1001 接口（当期人口）')
  })

  it('C6 地图左侧按钮悬浮提示', () => {
    expect(read('frontend/src/components/map/BusinessCirclePanel.vue')).toContain('title="联通人口分析"')
  })
})

describe('D. AI 提示词：不写品牌名，模型才不会复述给用户', () => {
  const s = fs.readFileSync(path.join(REPO, 'backend/src/routes/ai.js'), 'utf8')

  it('D1 systemPrompt 与 userContent 都不含品牌名', () => {
    const start = s.indexOf('const systemPrompt =')
    const end = s.indexOf('const surroundings')
    expect(start).toBeGreaterThan(-1)
    const seg = s.slice(start, end > start ? end : start + 4000)
    expect(seg.includes(WORD)).toBe(false)
  })

  it('D2 摘要小标题改成了「【联通人口数据摘要】」', () => {
    expect(s).toContain('【联通人口数据摘要】')
  })
})

describe('E. 来源主体不能一起删掉', () => {
  it('E1 六处文案仍必须写明「联通」（摘品牌名 ≠ 摘来源）', () => {
    const cases = [
      ['frontend/src/components/ReportPaper.vue', '联通人口 1001'],
      ['frontend/src/components/CandidateReport.vue', '联通人口'],
      ['frontend/src/components/CandidateBriefUpgrade.vue', '联通人口'],
      ['frontend/src/utils/candidateReport.js', '联通人口 1001'],
      ['frontend/src/utils/dataProvenance.js', '联通人口 1001'],
      ['frontend/src/components/map/BusinessCirclePanel.vue', '联通人口']
    ]
    for (const [f, needle] of cases) {
      expect(fs.readFileSync(path.join(REPO, f), 'utf8')).toContain(needle)
    }
  })
})

describe('F. 帮助页（docx 源重建产物）', () => {
  const HTML = path.join(REPO, 'help/index.html')

  it('F1 零命中', () => {
    expect(fs.readFileSync(HTML, 'utf8').includes(WORD)).toBe(false)
  })

  it('F2 第 8 章标题是「8. 联通人口分析」', () => {
    const s = fs.readFileSync(HTML, 'utf8')
    expect(s).toContain('8. 联通人口分析')
    // ⚠️ 这里是生成物：源是 `5. 使用方法技巧/#选址赢家Online用户手册.docx`，
    //    重跑 build_help.py 会覆盖。改文案必须改 docx，⛔ 不许只改这份 HTML。
    expect(s).not.toContain('智慧足迹联通人口')
  })
})
