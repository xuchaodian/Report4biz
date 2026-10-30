/**
 * 门店体检报告 · 表格行构造（v1.13.298 起，v1.13.299 改半径口径）
 *
 * 只钉「导出的表与页面同口径」这件事：
 * 未评的不能显示成 0 分、未评 ≠ 低风险、双店型必须写不建议合并、每行长度必须等于表头长度。
 */
import { describe, it, expect } from 'vitest'
import { buildReportSheets } from '../src/utils/checkupReport.js'

const geo = {
  counts: {
    total: 3, withCoord: 2, withArea: 2, noArea: 1, noCoord: 1,
    sameAddrPairs: 1, sameAddrStores: 2, pairs: 2, dualFormatPairs: 1, suspectedPairs: 1
  },
  medianNearestM: 961, medianBasis: 2, noNeighbor: 0,
  pairs: [
    {
      aId: 1, bId: 2, aName: '大店A', bName: '小店B', aCode: '8011', bCode: '2025',
      aArea: 345.6, bArea: 120.5, city: '上海', address: '娄山关路',
      distance: 12, dualFormat: true
    },
    {
      aId: 3, bId: 4, aName: '甲店', bName: '乙店', aCode: '', bCode: '',
      aArea: 0, bArea: 0, city: '上海', address: '百联嘉定',
      distance: 240, dualFormat: false
    }
  ]
}

const lights = {
  byLevel: { high: 1, mid: 0, low: 0, none: 1 },
  evaluated: 2,
  noCoord: 1,
  blind: 0,
  noCityData: 0,
  rules: {
    cannibal: 1,
    selfDetail: { same: 0, sameDual: 0, close: 1, overlap: 0, far: 1 },
    competition: 1,
    competitionEvaluated: 1,
    competitionNoData: 1,
    competitionNoCity: 0,
    competitionPartial: 1,
    cannibalDistricts: 1,
    clusters: [{ count: 2, city: '上海', names: ['红店', '邻店'], centerLat: 31.2, centerLng: 121.4 }],
    cannibalTop: [{ district: '红店', count: 2 }],
    crowd: 0
  },
  thresholds: {
    sameAddrM: 50, closeM: 300, overlapM: 800,
    compRadiusM: 800, compMid: 3, compHigh: 6, riskHigh: 5, riskMid: 3,
    competitionMax: null, crowdShareMin: null
  },
  lights: [
    {
      storeId: 1, name: '红店', brand: '优事', city: '上海', lat: 31.2, lng: 121.4,
      status: 'evaluated', nearestM: 70, nearestName: '邻店', peers800: 1,
      selfBucket: 'close', dualFormat: false,
      compRing: 6, compStatus: 'evaluated', partial: false,
      riskScore: 6, riskLevel: 'high', flags: ['cannibal', 'competition'],
      district: '北外滩', districtLevel: '核心级', crowd: '商务主导'
    },
    {
      storeId: 2, name: '无竞品店', brand: '优事', city: '乌鲁木齐', lat: 43.8, lng: 87.6,
      status: 'evaluated', nearestM: null, nearestName: '', peers800: 0,
      selfBucket: 'far', dualFormat: false,
      compRing: null, compStatus: 'no_data', partial: true,
      riskScore: 0, riskLevel: 'none', flags: [],
      district: '', districtLevel: '', crowd: ''
    },
    {
      storeId: 3, name: '缺坐标店', brand: '优事', city: '上海', lat: null, lng: null,
      status: 'no_coord', nearestM: null, nearestName: '', peers800: 0,
      selfBucket: '', dualFormat: false,
      compRing: null, compStatus: 'no_data', partial: false,
      riskScore: null, riskLevel: null, flags: [],
      district: '', districtLevel: '', crowd: ''
    }
  ]
}

const completeness = { salesRows: 5, categoryEmpty: 232, categoryEmptyReadonly: 1, areaMissing: 3, coordMissing: 1 }

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

  it('表头带出半径口径的列（最近同品牌 / 同品牌800m / 竞品800m）', () => {
    expect(head).toContain('最近同品牌(m)')
    expect(head).toContain('同品牌800m内(家)')
    expect(head).toContain('竞品800m内(家)')
    expect(head).toContain('竞争维度')
  })

  it('缺坐标门店：风险分留空、灯写未评估、命中规则写「—」', () => {
    const row = rows.find(r => r[idx('门店')] === '缺坐标店')
    expect(row).toBeTruthy()
    expect(row[idx('风险分')]).toBe('')            // 留空
    expect(row[idx('风险分')]).not.toBe(0)          // 绝不能是 0（会被读成「零风险」）
    expect(row[idx('灯')]).toBe('未评估')
    expect(row[idx('状态')]).toContain('缺经纬度')
    // ⛔ 不能写「未命中」：那会被读成「查过了、没问题」
    expect(row[idx('命中规则')]).toBe('—')
  })

  it('🔴 绿灯但竞争未评 ⇒ 灯这一格必须自己说出来', () => {
    const row = rows.find(r => r[idx('门店')] === '无竞品店')
    expect(row[idx('灯')]).toContain('竞争未评')
    expect(row[idx('竞争维度')]).toContain('未评')
    expect(row[idx('竞品800m内(家)')]).toBe('')
  })

  it('命中规则翻成人话（不出现 competition / cannibal 这种字段名）', () => {
    const row = rows.find(r => r[idx('门店')] === '红店')
    expect(row[idx('命中规则')]).toContain('竞争密集')
    expect(row[idx('命中规则')]).toContain('自我蚕食')
    expect(row[idx('命中规则')]).not.toContain('cannibal')
    expect(row[idx('灯')]).toBe('红灯·高风险')
    expect(row[idx('风险分')]).toBe(6)
    expect(row[idx('最近同品牌(m)')]).toBe('70m')
    expect(row[idx('竞品800m内(家)')]).toBe(6)
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
    expect(find('未评估·缺经纬度')[1]).toBe(1)
  })

  it('自我蚕食按半径分档写清（同址/贴身/部分重叠/双店型不计分）', () => {
    const r = find('规则①自我蚕食')
    expect(r[1]).toBe(1)
    expect(r[2]).toContain('贴身 1')
    expect(r[2]).toContain('同址双店型 0 家不计分')
  })

  it('🔴 竞争未评单独一行，且写明「未评 ≠ 竞争宽松」', () => {
    const r = find('竞争维度未评')
    expect(r[1]).toBe(1)
    expect(r[2]).toContain('未评 ≠ 竞争宽松')
  })

  it('绿灯行带出「竞争维度未评」家数，避免被读成全都查过了', () => {
    const r = find('绿灯')
    expect(r[2]).toContain('竞争维度未评')
  })

  it('品类空值带出「集团下发门店需在集团侧补」', () => {
    expect(find('门店区分（选址形态）为空')[2]).toContain('集团侧补')
  })

  it('说明书里写清判定单位是门店、不是商圈', () => {
    const notes = byName['说明'].aoa
    const row = notes.find(r => String(r[0]).startsWith('1.'))
    expect(row[1]).toContain('以门店坐标')
    expect(row[1]).toContain('不用「在不在商圈面里」')
  })

  it('写明未消耗配额', () => {
    const r = find('口径说明')
    expect(r.join(' ')).toContain('未消耗')
  })
})
