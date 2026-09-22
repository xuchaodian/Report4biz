import { describe, it, expect } from 'vitest'
import { matchFaq, listFaqs } from '../../frontend/src/utils/faqMatch.js'

/**
 * 操作指引（FAQ）本机匹配 —— 单测
 *
 * 为什么放在 backend/tests：
 *   前端没有测试框架（frontend/package.json 里没有 vitest/jest），而 `faqMatch.js`
 *   是**纯 ESM、无 Vue 依赖**的模块，可被后端这条既有回归流水线（`npm test`）直接 import。
 *   放这里能让「🔴 宁可漏拦、不可误伤真指令」这条红线**有测试钉住**。
 */

describe('A. 正例：导出报表类问法必须命中', () => {
  const cases = [
    '怎么导出PDF报告',
    '怎么导出报表',
    '导出报表在哪',
    'PDF怎么导出',
    '如何导出excel',
    '报表怎么下载',
    '在哪里可以导出报告',
    '怎么导出 Excel 报表'
  ]
  for (const q of cases) {
    it(`命中 export-report：${q}`, () => {
      const r = matchFaq(q)
      expect(r, `「${q}」应命中`).toBeTruthy()
      expect(r.id).toBe('export-report')
    })
  }
})

describe('B. 正例：添加门店类问法必须命中', () => {
  const cases = [
    '怎么添加门店',
    '怎么添加一家新门店',
    '新增门店在哪',
    '如何录入门店',
    '怎么开店',
    '怎样新增店铺'
  ]
  for (const q of cases) {
    it(`命中 add-store：${q}`, () => {
      const r = matchFaq(q)
      expect(r, `「${q}」应命中`).toBeTruthy()
      expect(r.id).toBe('add-store')
    })
  }
})

describe('C. 🔴 反例：真指令与无关问题**绝不能**命中（误伤＝用户操作失败）', () => {
  const mustMiss = [
    // 动作意图 ⇒ 必须走 AI
    '帮我导出北京的报表',
    '给我导出上海的报表',
    '麻烦导出一下报表',
    '我要导出报表',
    '请帮我导出PDF',
    '直接导出一份报表给我',
    // 无疑是问方法（含具体限定）⇒ 属于指令
    '导出上海的报表',
    '导出报表',
    // 其他能力/无关问法
    '显示北京的已开业门店',
    '对比星巴克国贸店和望京店的人口',
    '开启热力图',
    '清除所有筛选条件',
    '今天上海天气怎么样',
    '帮我写一首关于春天的小诗',
    // 排除词：竞品 / 品牌 / 购物中心
    '怎么添加竞品门店',
    '怎么添加品牌门店',
    '怎么在购物中心里添加门店'
  ]
  for (const q of mustMiss) {
    it(`不命中：${q}`, () => {
      expect(matchFaq(q), `「${q}」不该命中`).toBeNull()
    })
  }
})

describe('D. 边界输入', () => {
  it('空串 / null / undefined / 纯空白 ⇒ null', () => {
    expect(matchFaq('')).toBeNull()
    expect(matchFaq(null)).toBeNull()
    expect(matchFaq(undefined)).toBeNull()
    expect(matchFaq('   ')).toBeNull()
  })

  it('大小写与空格不影响匹配', () => {
    expect(matchFaq('  PDF 怎么 导出 ? ')?.id).toBe('export-report')
    expect(matchFaq('EXCEL报表如何导出')?.id).toBe('export-report')
  })

  it('只有疑问词、没有主题词 ⇒ null', () => {
    expect(matchFaq('怎么办')).toBeNull()
    expect(matchFaq('这个怎么弄')).toBeNull()
  })

  it('⭐ 设计上刻意漏拦：「怎么导出」缺宾语 ⇒ 交给 AI，不猜', () => {
    expect(matchFaq('怎么导出')).toBeNull()
  })
})

describe('E. 身份分流（子公司成员）', () => {
  it('member 问添加门店 ⇒ 提示门店由集团下发，但**仍给步骤**（不改变可达性）', () => {
    const r = matchFaq('怎么添加门店', { orgRole: 'member' })
    expect(r).toBeTruthy()
    expect(r.id).toBe('add-store')
    expect(r.steps.length).toBeGreaterThan(0)
    expect(r.note).toContain('集团统一下发')
  })

  it('owner / 未登录身份 ⇒ 不带该提示', () => {
    for (const orgRole of ['owner', '', null, undefined]) {
      const r = matchFaq('怎么添加门店', { orgRole })
      expect(r).toBeTruthy()
      expect(r.note || '').not.toContain('集团统一下发')
    }
  })

  it('导出报表不受组织身份影响', () => {
    const r = matchFaq('怎么导出报表', { orgRole: 'member' })
    expect(r.id).toBe('export-report')
    expect(r.note || '').not.toContain('集团统一下发')
  })
})

describe('F. 返回结构完整性（前端模板依赖这些字段）', () => {
  it('两条 FAQ 的字段齐备且 steps 非空', () => {
    for (const q of ['怎么导出报表', '怎么添加门店']) {
      const r = matchFaq(q)
      expect(typeof r.id).toBe('string')
      expect(typeof r.icon).toBe('string')
      expect(typeof r.title).toBe('string')
      expect(Array.isArray(r.steps)).toBe(true)
      expect(r.steps.length).toBeGreaterThanOrEqual(3)
      expect(typeof r.note).toBe('string')
    }
  })

  it('🔴 文案里的路径必须与源码一致（防改坏成「幻觉路径」）', () => {
    const exp = matchFaq('怎么导出报表').steps.join(' ')
    expect(exp).toContain('用户名')
    expect(exp).toContain('导出报表')
    expect(exp).toContain('导出PDF')
    expect(exp).toContain('购买履历')

    const add = matchFaq('怎么添加门店').steps.join(' ')
    expect(add).toContain('门店工具')
    expect(add).toContain('添加门店')
    expect(add).toContain('地图')
  })

  it('listFaqs() 供快捷问句使用，且生成的问题自身能命中', () => {
    const list = listFaqs()
    expect(list.length).toBeGreaterThanOrEqual(2)
    for (const item of list) {
      expect(matchFaq(item.question)?.id).toBe(item.id)
    }
  })
})
