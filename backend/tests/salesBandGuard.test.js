/**
 * 销售档位口径一致性守卫（v1.13.186）
 *
 * 背景：为降低「不愿把营业额录进第三方平台」的心理门槛，销售录入新增
 * **档位录入**（只填金额区间，系统按区间中点参与测算）。
 *
 * 档位定义必须前后端各存一份（前端要渲染下拉、后端要换算金额，跨语言无法共用），
 * 这就有「两边漂移」的风险 —— 前端出了新档位、后端不认识，用户点了保存直接报错；
 * 或后端改了区间中点、前端还按老区间展示 ⇒ 展示与落库不一致。
 *   158 的教训：派生/解析算法必须抽成单一函数共用；
 *   183 的教训：同字段两接口口径不一致会出「假值」。
 * 跨语言做不到共用，就用**本守卫把一致性钉死**：直接 import 两侧模块逐项比对。
 *
 * 另含「写入语义」钉子：未知档位必须**报错**，⛔ 不得静默落回精确值。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import {
  SALES_BANDS as BE_BANDS,
  bandMidYuan,
  parseBandInput as beParse
} from '../src/utils/salesBand.js'
import {
  SALES_BANDS as FE_BANDS,
  bandLabel as feBandLabel,
  parseBandInput as feParse
} from '../../frontend/src/utils/salesBand.js'

/** ⚠️ 用 fileURLToPath，不用 new URL().pathname（本项目路径含中文与空格，会留 %E5… 编码） */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const STORE_SALES_SRC = fs.readFileSync(
  path.join(REPO_ROOT, 'backend/src/routes/store-sales.js'), 'utf8'
)

describe('档位定义：前后端逐项一致', () => {
  it('档位数量相同', () => {
    expect(FE_BANDS.length).toBe(BE_BANDS.length)
    expect(FE_BANDS.length).toBeGreaterThanOrEqual(5)
  })

  it('key / label / min / max / mid 五项完全一致', () => {
    expect(FE_BANDS.map(b => ({ ...b }))).toEqual(BE_BANDS.map(b => ({ ...b })))
  })

  it('key 唯一', () => {
    const keys = BE_BANDS.map(b => b.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('区间首尾相接：无空隙、无重叠，且仅最后一档开上界', () => {
    for (let i = 1; i < BE_BANDS.length; i += 1) {
      expect(BE_BANDS[i].min).toBe(BE_BANDS[i - 1].max)
    }
    BE_BANDS.slice(0, -1).forEach(b => expect(b.max).not.toBeNull())
    expect(BE_BANDS[BE_BANDS.length - 1].max).toBeNull()
  })

  it('mid 落在区间内（供下游算量级，不能越界）', () => {
    for (const b of BE_BANDS) {
      expect(b.mid).toBeGreaterThanOrEqual(b.min)
      if (b.max !== null) expect(b.mid).toBeLessThanOrEqual(b.max)
      // 开上界的最后一档：mid 必须高于下界（否则等于把「>2000万」算成 2000 万）
      if (b.max === null) expect(b.mid).toBeGreaterThan(b.min)
    }
  })
})

describe('parseBandInput：两侧行为一致且不猜', () => {
  const cases = [
    ['lt200', 'lt200'],
    ['b400_600', 'b400_600'],
    ['400 – 600 万', 'b400_600'],
    ['400-600', 'b400_600'],
    ['400~600万', 'b400_600'],
    ['400 — 600万元', 'b400_600'],
    ['< 200 万', 'lt200'],
    ['> 2000 万', 'gt2000'],
    [' 1000 – 2000 万 ', 'b1000_2000'],
    ['', null],
    [null, null],
    ['不知道', null],
    // ⛔ 单个数字不猜：边界值（如 200）会落到相邻档，宁可报错让用户重填
    ['500', null],
    ['200', null],
    // 非标准区间（区间端点必须与定义表完全吻合）
    ['300-700', null]
  ]

  it.each(cases)('解析 %s → %s', (input, want) => {
    expect(beParse(input)).toBe(want)
    expect(feParse(input)).toBe(want)
  })

  it('bandMidYuan 未知 key 返回 null（⛔ 不静默降级成精确值）', () => {
    expect(bandMidYuan('nope')).toBeNull()
    expect(bandMidYuan(null)).toBeNull()
    expect(bandMidYuan(undefined)).toBeNull()
    expect(bandMidYuan('')).toBeNull()
  })

  it('bandMidYuan 正常换算（万元 → 元）', () => {
    expect(bandMidYuan('b400_600')).toBe(500 * 10000)
    expect(bandMidYuan('lt200')).toBe(100 * 10000)
  })

  it('bandLabel 与后端定义同源（前端展示走它，不自己拼字符串）', () => {
    for (const b of BE_BANDS) expect(feBandLabel(b.key)).toBe(b.label)
    expect(feBandLabel('nope')).toBeNull()
  })
})

describe('写入语义：未知档位必须报错，不得静默漂移', () => {
  it('接口录入：未知档位直接判失败', () => {
    expect(STORE_SALES_SRC).toMatch(/未知档位：/)
  })

  it('Excel 导入：无法识别的档位文本直接判失败', () => {
    expect(STORE_SALES_SRC).toMatch(/销售档位无法识别/)
  })

  it('档位优先于精确值（填了档位就忽略年销售额）', () => {
    expect(STORE_SALES_SRC).toMatch(/bandKey \? bandMidYuan\(bandKey\) : Math\.round\(amountW \* 10000\)/)
    expect(STORE_SALES_SRC).toMatch(/band \? bandMidYuan\(band\.key\) : Number\(it\.salesAmount\)/)
  })

  it('sales_band 写进 INSERT 且在 ON CONFLICT 里一并更新', () => {
    const upserts = STORE_SALES_SRC.match(/ON CONFLICT\(user_id, store_id, year, month\) DO UPDATE SET[\s\S]*?CURRENT_TIMESTAMP`\)/g) || []
    expect(upserts.length).toBe(2)
    for (const u of upserts) expect(u).toMatch(/sales_band = excluded\.sales_band/)
  })
})
