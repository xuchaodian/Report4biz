/**
 * 商圈属性归一化守卫（v1.13.276）
 *
 * 背景：商圈面数据从「2022 年度版」换成「联通人口版」，字段名**整代更换**：
 *   名称→商圈名、居住人数→居住、工作人数→工作、到访人次→到访、
 *   低收入人数→低收入、中等收入人→中等、小康/中产/富裕/富人各减「人数」、
 *   RecID→biz_id。
 *
 * 危险点：下游全部按**旧名精确匹配**取数（`Number(props['居住人数'])`）。若漏了归一化，
 * 拿到的就是 `undefined` ⇒ 评分的「人口规模」恒 22 分、销售预测的环境向量全 0、
 * 商圈详情按名称查永远 404 —— **全程不报错，只是结果错**。这类故障在生产上极难发现，
 * 所以这里用「单测 + 源码扫描」两道钉子钉住：
 *   ① 归一化函数本身对两代字段名都成立；
 *   ② districts.js / sales-forecast.js 不得再把 `feature.properties` 直接当 props 用。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { normalizeDistrictProps, dstr, dnum } from '../src/utils/districtProps.js'

/**
 * ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，
 *    `new URL(...).pathname` 会留下百分号编码，导致 fs 报 ENOENT。
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DISTRICTS_ROUTE = fs.readFileSync(path.join(REPO_ROOT, 'backend/src/routes/districts.js'), 'utf8')
const FORECAST_ROUTE = fs.readFileSync(path.join(REPO_ROOT, 'backend/src/routes/sales-forecast.js'), 'utf8')
const SEARCH_ROUTE = fs.readFileSync(path.join(REPO_ROOT, 'backend/src/routes/shapefiles.js'), 'utf8')

// 联通人口版的真实一条（上海·滴水湖临港地区，截取关键列）
const V2 = {
  商圈名: '滴水湖临港地区',
  biz_id: '0db68fd6e4',
  省份: '上海市',
  城市: '上海市',
  区县: '浦东新区',
  居住: '159334',
  工作: '73400',
  到访: '12637584',
  低收入: '15305',
  中等: '30857',
  小康: '63306',
  中产: '39963',
  富裕: '8554',
  富人: '725',
  男总: '84097',
  女总: '83380',
  A25_29: '17641',
  客群: '居住主导',
  能级: '城市级',
  居民类: '青年-中产'
}

// 2022 年度版（旧名）
const V1 = {
  名称: '动物园',
  居住人数: '32856',
  工作人数: '18180',
  到访人次: '2626062',
  低收入人数: '100',
  中等收入人: '200',
  小康人数: '300',
  中产人数: '400',
  富裕人数: '500',
  富人人数: '600',
  省份: '上海市',
  城市: '上海市',
  区县: '浦东新区',
  RecID: '12345'
}

describe('normalizeDistrictProps：两代字段名都能归一', () => {
  it('联通人口版（新名）归一后，旧名全部取得到值', () => {
    const p = normalizeDistrictProps(V2)
    expect(p['名称']).toBe('滴水湖临港地区')
    expect(p['居住人数']).toBe('159334')
    expect(p['工作人数']).toBe('73400')
    expect(p['到访人次']).toBe('12637584')
    expect(p['中等收入人']).toBe('30857')
    expect(p['中产人数']).toBe('39963')
    expect(p['RecID']).toBe('0db68fd6e4')
    expect(p['客群']).toBe('居住主导')
    expect(p['能级']).toBe('城市级')
    expect(p['居民类']).toBe('青年-中产')
  })

  it('2022 年度版（旧名）归一后原值不变（幂等、不误伤）', () => {
    const p = normalizeDistrictProps(V1)
    expect(p['名称']).toBe('动物园')
    expect(p['居住人数']).toBe('32856')
    expect(p['中等收入人']).toBe('200')
    expect(p['中产人数']).toBe('400')
    expect(p['RecID']).toBe('12345')
  })

  it('「中等」与「中产」不得互相顶替（两个不同收入档位）', () => {
    const p = normalizeDistrictProps({ 中等: '11' })
    expect(p['中等收入人']).toBe('11')
    expect(p['中产人数']).toBeUndefined()
  })

  it('已用作别名的源字段不再重复保留（避免 payload 里两份居住人数）', () => {
    const p = normalizeDistrictProps(V2)
    expect(p['居住']).toBeUndefined()
    expect(p['商圈名']).toBeUndefined()
    expect(p['biz_id']).toBeUndefined()
  })

  it('未映射的新字段（性别/年龄段）原样透传', () => {
    const p = normalizeDistrictProps(V2)
    expect(p['男总']).toBe('84097')
    expect(p['A25_29']).toBe('17641')
  })

  it('缺失字段不写 key，也不补 0（缺数据 ≠ 0）', () => {
    const p = normalizeDistrictProps({ 商圈名: 'x' })
    expect('居住人数' in p).toBe(false)
    expect(dnum(p, '居住人数')).toBe(null)
    expect(dstr(p, '客群')).toBe('')
  })

  it('不修改入参（feature.properties 会被多处复用）', () => {
    const raw = { 商圈名: 'x', 居住: '1' }
    normalizeDistrictProps(raw)
    expect(raw['居住']).toBe('1')
    expect(raw['名称']).toBeUndefined()
  })
})

describe('消费点必须走归一化（源码扫描）', () => {
  it('districts.js 不再把 feature.properties 直接当 props', () => {
    expect(
      DISTRICTS_ROUTE.includes('const props = feature.properties || {}'),
      'districts.js 又直接取了 feature.properties —— 新数据下评分/画像会静默归零'
    ).toBe(false)
    expect(
      DISTRICTS_ROUTE.includes('normalizeDistrictProps('),
      'districts.js 未使用 normalizeDistrictProps'
    ).toBe(true)
  })

  it('sales-forecast.js 不再把 feature.properties 直接当 props', () => {
    expect(
      FORECAST_ROUTE.includes('const p = ft.properties || {}'),
      'sales-forecast.js 又直接取了 ft.properties —— 环境向量会全 0'
    ).toBe(false)
    expect(
      FORECAST_ROUTE.includes('normalizeDistrictProps('),
      'sales-forecast.js 未使用 normalizeDistrictProps'
    ).toBe(true)
  })

  it('商圈搜索的名称字段候选里包含「商圈名」', () => {
    expect(
      SEARCH_ROUTE.includes("'商圈名'"),
      'search-commerce 的名称字段候选缺少「商圈名」—— 新数据整城搜不到'
    ).toBe(true)
  })
})
