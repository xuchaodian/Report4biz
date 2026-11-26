/**
 * 守卫：门店名近似匹配（v1.13.425）
 *
 * 背景：联通 Excel 导入原来只做 SQL 精确等值匹配，文件名「星空广场」撞不上门店
 * 「星空广场店」就整文件零导入。本批加「候选识别 + 用户确认」。
 *
 * 本文件钉三件事：
 *  ① 打分档位不许乱动 —— 尤其包含档**不能**给 ≥90，否则「星空广场」会把
 *     「星空广场二期店」判成高置信并默认选中（二期是另一家店）；
 *  ② 归一化必须复用 competitorSnapshotCore，⛔ 不许 fork 第二份；
 *  ③ LIKE 通配符转义（门店名本身可含下划线）。
 *
 * ⚠️ 这是纯函数测试：不打 DB、不起服务。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  scoreName,
  normalizeForMatch,
  rankCandidates,
  escapeLike,
  CANDIDATE_MIN_SCORE,
  CANDIDATE_LIMIT,
  SUGGEST_SCORE
} from '../src/utils/storeNameMatcher.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.resolve(HERE, '../src/utils/storeNameMatcher.js'), 'utf8')

describe('A. 归一化后相等 → 100 分（只差店缀/空格/全半角）', () => {
  const cases = [
    ['星空广场店', '星空广场'],
    ['星空广场门店', '星空广场'],
    ['星空广场分店', '星空广场'],
    ['星空 广场', '星空广场'],
    ['（星空广场）', '星空广场'],
    ['ＳＴＡＲ星空广场', 'star星空广场']
  ]
  for (const [a, b] of cases) {
    it(`「${a}」=「${b}」→ 100`, () => {
      expect(scoreName(a, b)).toBe(100)
    })
  }

  it('「门店」后缀要去干净（⛔ 只去掉一个「店」留下「门」）', () => {
    expect(normalizeForMatch('星空广场门店')).toBe('星空广场')
  })
})

describe('B. 包含档最高 80：🔴 前缀不许给 ≥90', () => {
  it('星空广场 vs 星空广场二期店 → 80（二期是另一家店）', () => {
    expect(scoreName('星空广场', '星空广场二期店')).toBe(80)
  })

  it('星空广场 vs 星空广场连锁店 → 80（共享后缀表没收录「连锁店」，靠包含档兜住）', () => {
    expect(scoreName('星空广场', '星空广场连锁店')).toBe(80)
  })

  it('🔴 包含档不得达到 SUGGEST_SCORE，否则「二期」会被预置选中', () => {
    for (const other of ['星空广场二期店', '星空广场东区店', '星空广场B座店']) {
      expect(scoreName('星空广场', other)).toBeLessThan(SUGGEST_SCORE)
    }
  })

  it('短名占比过低不算包含（星空 vs 星空广场二期 → 0）', () => {
    expect(scoreName('星空', '星空广场二期')).toBe(0)
  })
})

describe('C. 编辑距离档', () => {
  it('差一个字（短名 ≥4）→ 92，但**不预置**', () => {
    expect(scoreName('星空广场', '星空广城')).toBe(92)
    const { candidates } = rankCandidates('星空广场', [{ id: 1, name: '星空广城' }])
    expect(candidates[0].score).toBe(92)
    expect(candidates[0].suggest).toBe(false)
  })

  it('差两个字 → 70', () => {
    expect(scoreName('星巴克万象城店', '星巴克万向成店')).toBe(70)
  })

  it('短名不给编辑距离分（<4 字时差一个字就是另一家）', () => {
    expect(scoreName('万达', '万大')).toBe(0)
  })
})

describe('D. 短名保护与空值容错', () => {
  it('单字名不参与打分', () => {
    expect(scoreName('星', '星空广场')).toBe(0)
  })

  it('🔴 归一化后只剩一个字时，**即便完全相同也不入选**（「星店」vs「星」）', () => {
    // 这条是短名保护的真实判据：去掉长度门槛后它们会变 100 分，
    // 而 1 个字的店名跟谁都可能撞，宁可让用户去搜全部门店。
    expect(scoreName('星', '星')).toBe(0)
    expect(scoreName('星店', '星')).toBe(0)
  })

  it('只有店缀的名字归一化后为空 → 0', () => {
    expect(scoreName('店', '门店')).toBe(0)
  })

  it('null / undefined / 空串 → 0，且不抛错', () => {
    expect(scoreName(null, '星空广场')).toBe(0)
    expect(scoreName('星空广场', undefined)).toBe(0)
    expect(scoreName('', '')).toBe(0)
  })
})

describe('E. 候选排序 / 上限 / 预置规则', () => {
  const pool = [
    { id: 1, name: '星空广场店' },
    { id: 2, name: '星空广场二期店' },
    { id: 3, name: '星空广城' },
    { id: 4, name: '完全不相干的店' }
  ]

  it('按分数降序，<70 不入选', () => {
    const { candidates, matched } = rankCandidates('星空广场', pool)
    expect(matched).toBe(3)
    expect(candidates.map((c) => c.id)).toEqual([1, 3, 2])
    expect(candidates.map((c) => c.score)).toEqual([100, 92, 80])
  })

  it('归一化相等的那家被预置选中，其余不预置', () => {
    const { candidates } = rankCandidates('星空广场', pool)
    expect(candidates.find((c) => c.id === 1).suggest).toBe(true)
    expect(candidates.find((c) => c.id === 2).suggest).toBe(false)
    expect(candidates.find((c) => c.id === 3).suggest).toBe(false)
  })

  it(`最多返回 ${CANDIDATE_LIMIT} 个`, () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `星空广场${i + 1}店` }))
    const { candidates, matched } = rankCandidates('星空广场', many)
    expect(matched).toBe(8)
    expect(candidates).toHaveLength(CANDIDATE_LIMIT)
  })

  it('同分时按名称排序，结果可重复', () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, name: `星空广场${i + 1}店` }))
    const a = rankCandidates('星空广场', many).candidates.map((c) => c.name)
    const b = rankCandidates('星空广场', many).candidates.map((c) => c.name)
    expect(a).toEqual(b)
    expect(a).toEqual([...a].sort((x, y) => x.localeCompare(y, 'zh')))
  })

  it('空池 / 非法入参 → 空结果，不抛错', () => {
    expect(rankCandidates('星空广场', [])).toEqual({ candidates: [], ambiguous: false, matched: 0 })
    expect(rankCandidates('星空广场', null).candidates).toEqual([])
  })

  it('不修改传入的候选池（池会被多个文件复用，污染了就会串数据）', () => {
    const snapshot = JSON.stringify(pool)
    rankCandidates('星空广场', pool)
    expect(JSON.stringify(pool)).toBe(snapshot)
  })
})

describe('F. 歧义：两个相近门店不许预置任何一个', () => {
  it('两家 92 分 → ambiguous，且都不预置', () => {
    const { candidates, ambiguous } = rankCandidates('星空广场', [
      { id: 1, name: '星空广城' },
      { id: 2, name: '星空广坊' }
    ])
    expect(ambiguous).toBe(true)
    expect(candidates.every((c) => c.suggest === false)).toBe(true)
  })

  it('同名两家（不同城市）都 100 分 → ambiguous，用户必须按地址选', () => {
    const { ambiguous } = rankCandidates('星空广场', [
      { id: 1, name: '星空广场店', city: '上海市' },
      { id: 2, name: '星空广场店', city: '苏州市' }
    ])
    expect(ambiguous).toBe(true)
  })

  it('100 与 80 并存 → 不算歧义，100 仍可预置', () => {
    const { candidates, ambiguous } = rankCandidates('星空广场', [
      { id: 1, name: '星空广场店' },
      { id: 2, name: '星空广场二期店' }
    ])
    expect(ambiguous).toBe(false)
    expect(candidates.find((c) => c.id === 1).suggest).toBe(true)
  })
})

describe('G. LIKE 转义（门店名本身可含下划线）', () => {
  it('下划线 / 百分号 / 反斜杠都要转义', () => {
    expect(escapeLike('星空_广场')).toBe('星空\\_广场')
    expect(escapeLike('50%店')).toBe('50\\%店')
    expect(escapeLike('a\\b')).toBe('a\\\\b')
  })

  it('反斜杠先转义，不会被二次转义', () => {
    expect(escapeLike('a_b\\c')).toBe('a\\_b\\\\c')
  })

  it('null / undefined → 空串', () => {
    expect(escapeLike(null)).toBe('')
    expect(escapeLike(undefined)).toBe('')
  })
})

describe('H. 结构约束：⛔ 不许 fork 归一化、⛔ 不许碰 DB', () => {
  it('必须 import competitorSnapshotCore 的归一化与编辑距离', () => {
    expect(SRC).toMatch(/from '\.\/competitorSnapshotCore\.js'/)
    expect(SRC).toMatch(/normalizeStoreName/)
    expect(SRC).toMatch(/levenshtein/)
  })

  it('本文件不许自带 normalizeStoreName / levenshtein 实现', () => {
    // 只允许 thin wrapper，⛔ 出现 function normalizeStoreName / function levenshtein 就是 fork
    expect(SRC).not.toMatch(/function\s+normalizeStoreName/)
    expect(SRC).not.toMatch(/function\s+levenshtein/)
  })

  it('纯函数：不引 DB、不引 fs', () => {
    expect(SRC).not.toMatch(/getDb\(/)
    expect(SRC).not.toMatch(/\.prepare\(/)
    expect(SRC).not.toMatch(/from 'fs'/)
  })

  it('阈值常量都在（改阈值必须改这里，别散落在路由里）', () => {
    expect(CANDIDATE_MIN_SCORE).toBe(70)
    expect(CANDIDATE_LIMIT).toBe(5)
    expect(SUGGEST_SCORE).toBe(100)
  })
})
