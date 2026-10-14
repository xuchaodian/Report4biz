/**
 * 半径展示文本测试 —— v1.13.183
 *
 * 立项背景（2026-09-28 徐工提问引出）：
 *   门店弹窗「已购报表」列表的半径列直接渲染 `purchases.radius` 原始值
 *   ⇒ 显示成 `[2000]`（该列存的是 `JSON.stringify([2000])`）。
 *
 * 修法（遵守「派生/解析算法必须抽成单一函数共用」铁律）：
 *   把原先**只内联在 `GET /history`** 的解析逻辑抽成 `formatRadiusDisplay()`，
 *   并让 `GET /by-store/:storeName` 也产出 `radius_display` —— 两个接口共用同一实现。
 *
 * 本文件钉死该函数的存量形态与边界，防回归（最后一条直接针对本 bug）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 🔴 临时库隔离（v1.13.225 补齐）——
//   本文件只测一个**纯函数**，但 `../src/routes/purchase.js` 顶层
//   `import { getDb } from '../models/database.js'`，而 database.js **末尾**有
//   `await initDatabase()` ⇒ 模块加载即建表 / 播种 / 整库落盘。
//   不设 R4B_DB_PATH 时该副作用会落到**真实开发库** `backend/database/webgis.db`
//   （实测：跑本文件会把该文件重写一次；v1.13.225 播种修复后还会真的插入默认模板 ——
//    若开发库尚无模板，跑一次测试就凭空多出 1 模板 + 10 项）。
//   ⚠️ ESM 静态 import 会被**提升**到模块体代码之前 ⇒ env 必须在动态 import 前设好，
//      故 `formatRadiusDisplay` 改在 beforeAll 里 `await import()` 取得（与 database.test.js 同款）。
const tmpDb = path.join(os.tmpdir(), `r4b-radius-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let formatRadiusDisplay

beforeAll(async () => {
  vi.resetModules()
  ;({ formatRadiusDisplay } = await import('../src/routes/purchase.js'))
})

afterAll(() => {
  fs.rmSync(tmpDb, { force: true })
  fs.rmSync(tmpDb + '.tmp', { force: true }) // 原子写残留
})

describe('formatRadiusDisplay（v1.13.183 抽取共用）', () => {
  it('JSON 数组串（两条 INSERT 路径的真实落库形态）→ 带单位', () => {
    expect(formatRadiusDisplay('[2000]')).toBe('2000米')
  })

  it('多半径 JSON 串 → 逗号分隔且各带单位（保持 /history 原口径不变）', () => {
    expect(formatRadiusDisplay('[500,1000]')).toBe('500米, 1000米')
  })

  it('JSON 数字串 → 带单位', () => {
    expect(formatRadiusDisplay('2000')).toBe('2000米')
  })

  it('已是 number（历史/内存态）→ 带单位', () => {
    expect(formatRadiusDisplay(2000)).toBe('2000米')
  })

  it('非 JSON 串 → 原样返回（不抛错、不吞值）', () => {
    expect(formatRadiusDisplay('abc')).toBe('abc')
  })

  it('空值 → 空串（不能是 undefined，否则模板会渲染出 "undefined"）', () => {
    expect(formatRadiusDisplay(null)).toBe('')
    expect(formatRadiusDisplay(undefined)).toBe('')
    expect(formatRadiusDisplay('')).toBe('')
  })

  it('回归钉子：输出永不含 JSON 方括号（本 bug 的直接症状）', () => {
    for (const v of ['[2000]', '[500,1000]', '[1500]', '[2000,3000,5000]']) {
      const out = formatRadiusDisplay(v)
      expect(out).not.toContain('[')
      expect(out).not.toContain(']')
    }
  })
})
