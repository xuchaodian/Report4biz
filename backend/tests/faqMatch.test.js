import { describe, it, expect } from 'vitest'
import { matchFaq, listFaqs } from '../../frontend/src/utils/faqMatch.js'

/**
 * 操作指引（FAQ）本机匹配 —— 单测
 *
 * 为什么放在 backend/tests：
 *   前端没有测试框架（frontend/package.json 里没有 vitest/jest），而 `faqMatch.js`
 *   是**纯 ESM、无 Vue 依赖**的模块，可被后端这条既有回归流水线（`npm test`）直接 import。
 *   放这里能让「🔴 宁可漏拦、不可误伤真指令」这条红线**有测试钉住**。
 *
 * v1.13.164：条目由 2 条扩到 6 条（导入门店 / 销售录入 / 查配额 / 个人中心）。
 *   新增条目的口径与老条目一致：疑问形态 ＋ 主题词分组命中 ＋ 无动作意图/排除词。
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

describe('G. 正例：批量导入门店类问法必须命中（v1.13.164 新增）', () => {
  const cases = [
    '怎么导入门店',
    '怎么导入门店数据',
    '怎么批量导入门店',
    '如何上传门店清单',
    '怎么用excel导入门店',
    '门店怎么导入',
    'csv怎么导入门店',
    '怎么把地址解析成门店'
  ]
  for (const q of cases) {
    it(`命中 import-stores：${q}`, () => {
      const r = matchFaq(q)
      expect(r, `「${q}」应命中`).toBeTruthy()
      expect(r.id).toBe('import-stores')
    })
  }
})

describe('H. 正例：销售录入类问法必须命中（v1.13.164 新增）', () => {
  const cases = [
    '怎么录入销售额',
    '怎么上传销售数据',
    '销售数据怎么填',
    '如何维护门店业绩',
    '门店营业额在哪录入',
    '怎么补录销售'
  ]
  for (const q of cases) {
    it(`命中 sales-entry：${q}`, () => {
      const r = matchFaq(q)
      expect(r, `「${q}」应命中`).toBeTruthy()
      expect(r.id).toBe('sales-entry')
    })
  }
})

describe('I. 正例：查询剩余次数（配额）类问法必须命中（v1.13.164 新增）', () => {
  const cases = [
    '怎么查看剩余次数',
    '还剩多少次',
    '还有多少次',
    '配额在哪看',
    '我的余额在哪里',
    '怎么查看购买履历',
    '怎么查看充值履历',
    '剩余额度怎么查'
  ]
  for (const q of cases) {
    it(`命中 check-quota：${q}`, () => {
      const r = matchFaq(q)
      expect(r, `「${q}」应命中`).toBeTruthy()
      expect(r.id).toBe('check-quota')
    })
  }
})

describe('J. 正例：个人中心（改密码 / 邮箱 / Logo）类问法必须命中（v1.13.164 新增）', () => {
  const cases = [
    '怎么修改密码',
    '怎么改密码',
    '密码怎么换',
    '怎么改邮箱',
    '邮箱在哪里修改',
    '怎么修改公司名称',
    '怎么换公司logo',
    '怎么上传公司logo'
  ]
  for (const q of cases) {
    it(`命中 account-settings：${q}`, () => {
      const r = matchFaq(q)
      expect(r, `「${q}」应命中`).toBeTruthy()
      expect(r.id).toBe('account-settings')
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
    '导入北京的门店',
    '帮我导入门店',
    '帮我录入上海的销售数据',
    '帮我改密码',
    // 其他能力/无关问法
    '显示北京的已开业门店',
    '对比星巴克国贸店和望京店的人口',
    '开启热力图',
    '清除所有筛选条件',
    '今天上海天气怎么样',
    '帮我写一首关于春天的小诗',
    // 排除词：竞品 / 品牌 / 购物中心 / 销售 / 预测
    '怎么添加竞品门店',
    '怎么添加品牌门店',
    '怎么在购物中心里添加门店',
    '怎么导入竞品门店',
    '怎么上传竞品数据',
    '怎么做销售预测',
    '怎么查看销售预测',
    // 其它模块（不该被任一新条目抢答）
    '怎么查看门店排名',
    '怎么使用相似店',
    '怎么设置品牌图标',
    '怎么购买门店',
    '怎么删除门店',
    '怎么导出竞品数据',
    '怎么导出shp矢量文件'
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
    expect(matchFaq(' 门 店 怎 么 导 入 ')?.id).toBe('import-stores')
  })

  it('只有疑问词、没有主题词 ⇒ null', () => {
    expect(matchFaq('怎么办')).toBeNull()
    expect(matchFaq('这个怎么弄')).toBeNull()
  })

  it('⭐ 设计上刻意漏拦：缺宾语 ⇒ 交给 AI，不猜', () => {
    // 「怎么导出」没有「报表/报告/pdf/excel」⇒ 不猜
    expect(matchFaq('怎么导出')).toBeNull()
    // 「怎么导入」没有「门店/csv/表格」⇒ 不猜
    expect(matchFaq('怎么导入')).toBeNull()
    // 「怎么录入」没有「销售/业绩/班效」⇒ 不猜
    expect(matchFaq('怎么录入')).toBeNull()
  })

  it('⭐ 名词短语无疑问词 ⇒ 一律不拦（与「导出上海的报表」同形，边界划清）', () => {
    for (const q of ['导入门店', '批量导入门店', '销售录入', '剩余次数', '修改密码']) {
      expect(matchFaq(q), `「${q}」不该命中`).toBeNull()
    }
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

  it('新增的 4 条均不受组织身份影响（member 与 owner 文案一致）', () => {
    for (const q of ['怎么导入门店', '怎么录入销售额', '还剩多少次', '怎么修改密码']) {
      const asMember = matchFaq(q, { orgRole: 'member' })
      const asOwner = matchFaq(q, { orgRole: 'owner' })
      expect(asMember?.id).toBe(asOwner?.id)
      expect(asMember?.note).toBe(asOwner?.note)
    }
  })
})

describe('F. 返回结构完整性（前端模板依赖这些字段）', () => {
  const ALL = ['怎么导出报表', '怎么添加门店', '怎么导入门店', '怎么录入销售额', '还剩多少次', '怎么修改密码']

  it('每条的字段齐备且 steps 非空', () => {
    for (const q of ALL) {
      const r = matchFaq(q)
      expect(typeof r.id).toBe('string')
      expect(typeof r.icon).toBe('string')
      expect(typeof r.title).toBe('string')
      expect(Array.isArray(r.steps)).toBe(true)
      expect(r.steps.length).toBeGreaterThanOrEqual(3)
      expect(typeof r.note).toBe('string')
    }
  })

  it('id 唯一', () => {
    const ids = ALL.map(q => matchFaq(q).id)
    expect(new Set(ids).size).toBe(ALL.length)
  })

  it('🔴 文案里的路径必须与源码一致（防改坏成「幻觉路径」）—— 163 的立命之本', () => {
    // 导出报告：右上角用户名 →「导出报表」→ 购买履历 →「导出PDF」  (MainLayout.vue:96-98/236-238)
    const exp = matchFaq('怎么导出报表').steps.join(' ')
    expect(exp).toContain('用户名')
    expect(exp).toContain('导出报表')
    expect(exp).toContain('导出PDF')
    expect(exp).toContain('购买履历')

    // 添加门店：地图左下「门店工具」面板 →「添加门店」→ 地图上点一下  (StoreControlPanel.vue)
    const add = matchFaq('怎么添加门店').steps.join(' ')
    expect(add).toContain('门店工具')
    expect(add).toContain('添加门店')
    expect(add).toContain('地图')

    // 导入门店：「我的门店」页 →「导入门店」→ CSV（name/latitude/longitude 必填）→「确定导入」
    //           (DataView.vue:19-30 / 346-387)；只有地址走「地址解析」(390-455)
    const imp = matchFaq('怎么导入门店').steps.join(' ')
    expect(imp).toContain('我的门店')
    expect(imp).toContain('导入门店')
    expect(imp).toContain('CSV')
    expect(imp).toContain('latitude')
    expect(imp).toContain('longitude')
    expect(imp).toContain('确定导入')
    expect(matchFaq('怎么导入门店').note).toContain('地址解析')

    // 销售录入：「我的门店」页 →「销售录入」→「门店年度销售录入」→ 年销售(万元)/面积(㎡)
    //           ＋「下载模板」「上传 Excel」                            (DataView.vue:45-47 / 662-674)
    const sale = matchFaq('怎么录入销售额').steps.join(' ')
    expect(sale).toContain('我的门店')
    expect(sale).toContain('销售录入')
    expect(sale).toContain('门店年度销售录入')
    expect(sale).toContain('年销售')
    expect(sale).toContain('下载模板')
    expect(sale).toContain('上传 Excel')

    // 剩余次数：右上角用户名下拉底部「剩余 N 次」(MainLayout.vue:103-110)
    //           ＋「个人中心」→「联通人口数据配额」卡片 (MyAccountView.vue:104-134)
    const quota = matchFaq('还剩多少次').steps.join(' ')
    expect(quota).toContain('用户名')
    expect(quota).toContain('剩余')
    expect(quota).toContain('个人中心')
    expect(quota).toContain('联通人口数据配额')
    expect(quota).toContain('购买履历')

    // 个人中心：用户名 →「个人中心」→ 新密码/确认密码 →「保存修改」 (MyAccountView.vue:19-99)
    const acc = matchFaq('怎么修改密码').steps.join(' ')
    expect(acc).toContain('用户名')
    expect(acc).toContain('个人中心')
    expect(acc).toContain('新密码')
    expect(acc).toContain('确认密码')
    expect(acc).toContain('保存修改')
    expect(acc).toContain('上传 Logo')
  })

  it('🔴 不得出现系统里不存在的入口名（历史幻觉案例）', () => {
    const all = ALL.map(q => {
      const r = matchFaq(q)
      return [r.title, ...r.steps, r.note].join(' ')
    }).join(' ')
    for (const ghost of ['数据报告模块', '新建门店', '报表中心', '导出中心', '系统设置页']) {
      expect(all, `文案里不该出现「${ghost}」`).not.toContain(ghost)
    }
  })

  it('listFaqs() 供快捷问句使用，且生成的问题自身能命中', () => {
    const list = listFaqs()
    expect(list.length).toBeGreaterThanOrEqual(6)
    for (const item of list) {
      expect(matchFaq(item.question)?.id, `「${item.question}」应命中 ${item.id}`).toBe(item.id)
    }
    // 问句不重复
    expect(new Set(list.map(i => i.question)).size).toBe(list.length)
  })
})
