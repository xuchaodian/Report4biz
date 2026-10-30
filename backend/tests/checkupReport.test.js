/**
 * 门店体检报告 · 表格行构造（v1.13.298）
 *
 * 只钉「导出的表与页面同口径」这件事：
 * 盲区不能显示成 0 分、双店型必须写不建议合并、每行长度必须等于表头长度（否则 xlsx 会错位）。
 */
import { describe, it, expect } from 'vitest'
import { buildReportSheets } from '../src/utils/checkupReport.js'

const geo = {
  counts: {
    total: 3, withCoord: 3, withArea: 2, noArea: 1, noCoord: 0,
    sameAddrPairs: 1, sameAddrStores: 2, pairs: 2, dualFormatPairs: 1, suspectedPairs: 1
  },
  medianNearestM: 961, medianBasis: 3, noNeighbor: 0,
  pairs: [
    {
      aId: 1, bId: 2, aName: '大店A', bName: '小店B', aCode: '8011', bCode: '2025',
      aArea: 345.6, bArea: 203.5, city: '上海', address: '娄山关路',
      distance: 12, dualFormat: true
    },
    {
      aId: 3, bId: 4, aName: '甲店', bName: '乙店', aCode: '', bCode: '',
      aArea: 0, bArea: 0, city: '上海', address: '百联嘉定',
      distance: 40, dualFormat: false
    }
  ]
}

const lights = {
  byLevel: { high: 1, mid: 1, low: 0, none: 0 },
  blind: 1,
  noCityData: 1,
  noCoord: 0,
  rules: { competition: 1, cannibal: 1, cannibalDistricts: 1, cannibalTop: [], crowd: 0 },
  thresholds: { competitionMax: 35, crowdShareMin: 0.2, riskHigh: 6, riskMid: 3 },
  lights: [
    {
      storeId: 1, name: '红店', brand: '优事', city: '上海', lat: 31.2, lng: 121.4,
      status: 'evaluated', district: '北外滩', districtLevel: '核心级', crowd: '商务主导',
      competitionScore: 35, ownInDistrict: 4, riskScore: 6, riskLevel: 'high',
      flags: ['competition', 'cannibal']
    },
    {
      storeId: 2, name: '盲区店', brand: '优事', city: '上海', lat: 31.5, lng: 121.9,
      status: 'blind', district: '', crowd: '',
      competitionScore: null, ownInDistrict: null, riskScore: null, riskLevel: null, flags: []
    },
    {
      storeId: 3, name: '外地店', brand: '优事', city: '乌鲁木齐', lat: 43.8, lng: 87.6,
      status: 'no_city_data', district: '', crowd: '',
      competitionScore: null, ownInDistrict: null, riskScore: null, riskLevel: null, flags: []
    }
  ]
}

const completeness = { salesRows: 5, categoryEmpty: 232, categoryEmptyReadonly: 1, areaMissing: 3, coordMissing: 0 }

const sheets = buildReportSheets({ geo, lights, completeness, nearM: 300, generatedAt: '2026-10-30 10:00:00' })
const byName = Object.fromEntries(sheets.map(s => [s.name, s]))

describe('工作表结构', () => {
  it('四张表齐全且顺序固定', () => {
    expect(sheets.map(s => s.name)).toEqual(['概览', '信号灯明细', '需复核清单', '说明'])
  })

  it('每张表每行长度都等于表头长度（不等会在 xlsx 里错列）', () => {
    for (const s of sheets) {
      const width = s.aoa[0].length
      const bad = s.aoa.map((r, i) => (r.length === width ? null : i + 1)).filter(Boolean)
      expect(bad, `${s.name} 第 ${bad.join(',')} 行列数不等于 ${width}`).toEqual([])
    }
  })

  it('列宽数量与列数一致', () => {
    for (const s of sheets) {
      expect(s.cols.length, `${s.name} 列宽数量与列数不符`).toBe(s.aoa[0].length)
    }
  })
})

describe('信号灯明细：口径不能走样', () => {
  const rows = byName['信号灯明细'].aoa
  const head = rows[0]
  const idx = (name) => head.indexOf(name)

  it('盲区门的风险分留空，⛔ 不是 0', () => {
    const row = rows.find(r => r[idx('门店')] === '盲区店')
    expect(row).toBeTruthy()
    expect(row[idx('风险分')]).toBe('')            // 留空
    expect(row[idx('风险分')]).not.toBe(0)          // 绝不能是 0（会被读成「零风险」）
    expect(row[idx('灯')]).toBe('灰灯·无法评估')
    expect(row[idx('状态')]).toContain('不在已覆盖商圈面内')
    // ⛔ 不能写「未命中」：那会被读成「查过了、没问题」
    expect(row[idx('命中规则')]).toBe('—')
  })

  it('城市无商圈面数据与盲区分开表述（⛔ 不并进盲区）', () => {
    const row = rows.find(r => r[idx('门店')] === '外地店')
    expect(row[idx('状态')]).toContain('该城市暂无商圈面数据')
    expect(row[idx('状态')]).not.toContain('不在已覆盖商圈面内')
  })

  it('命中规则翻成人话（不出现 competition / cannibal 这种字段名）', () => {
    const row = rows.find(r => r[idx('门店')] === '红店')
    expect(row[idx('命中规则')]).toBe('竞争密集、自我蚕食')
    expect(row[idx('灯')]).toBe('红灯·高风险')
    expect(row[idx('风险分')]).toBe(6)
  })

  it('导出是全量，不按 top 截断', () => {
    expect(rows.length).toBe(lights.lights.length + 1)
  })
})

describe('需复核清单', () => {
  const rows = byName['需复核清单'].aoa
  const head = rows[1]                          // 第 1 行是阈值说明
  const body = rows.slice(2)

  it('双店型必须写明不建议合并（否则客户会去合并真店）', () => {
    const r = body[0]
    expect(r[head.indexOf('判定')]).toContain('双店型')
    expect(r[head.indexOf('处理建议')]).toContain('不建议合并')
  })

  it('疑似给「人工看一眼」的建议，不诱导合并', () => {
    const r = body[1]
    expect(r[head.indexOf('判定')]).toContain('疑似')
    expect(r[head.indexOf('处理建议')]).toContain('人工看一眼')
  })
})

describe('概览页', () => {
  const aoa = byName['概览'].aoa
  const find = (label) => aoa.find(r => r[0] === label)

  it('结构指标与入参一致', () => {
    expect(find('门店总数')[1]).toBe(3)
    expect(find('中位最近同品牌距离')[1]).toBe('961m')
    expect(find('红灯·高风险')[1]).toBe(1)
    expect(find('灰灯·无法评估')[1]).toBe(1)
  })

  it('城市无商圈面数据单独一行，说明是平台覆盖问题', () => {
    const r = find('城市无商圈面数据')
    expect(r[1]).toBe(1)
    expect(r[2]).toContain('平台数据覆盖问题')
  })

  it('品类空值带出「集团下发门店需在集团侧补」', () => {
    expect(find('门店区分（选址形态）为空')[2]).toContain('集团侧补')
  })

  it('写明未消耗配额', () => {
    const r = find('口径说明')
    expect(r.join(' ')).toContain('未消耗')
  })
})
