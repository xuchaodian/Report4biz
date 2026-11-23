/**
 * 测试临时库 / 临时 geo 目录（⚠️ 必须**第一个 import**）
 *
 * ── 为什么需要这个文件 ──────────────────────────────────────────────────
 * ESM 的**静态 import 全部在模块体之前求值**，所以在测试文件里写
 *
 *     process.env.R4B_DB_PATH = tmpDb      // ← 这一行跑得比 import 晚
 *     import { buildBriefModel } from '../src/utils/candidateBrief.js'
 *
 * 根本不管用：`models/database.js` 在**模块顶层**就把 dbPath 定死了
 * （`const dbPath = process.env.R4B_DB_PATH || join(dbDir,'webgis.db')`），
 * 等那行赋值执行时，真库路径早被捕获 ⇒ `beforeEach(clearAll)` 直接
 * `DELETE FROM markers` 删在 **仓库里的 database/webgis.db** 上。
 *
 * 🔴 实测后果（2026-11-23 发现）：本机开发库被写进了 `brief_admin` / `brief_other` /
 *    `cmp_admin` 三个测试用户与若干「测试候选门店」，而原有的门店被人删空。
 *    这类「测试跑一遍、本地数据没一半」是最难回溯的事故，所以固化成一个模块：
 *    **谁要临时库，就第一行 import 这里**，别再各自写 env。
 *
 * 用法（顺序不能变）：
 *     import { tmpDb, tmpGeo } from './_tmpDbEnv.mjs'   // ← 第一行
 *     import { buildBriefModel } from '../src/utils/candidateBrief.js'
 *
 * 每进程/每文件一份（vitest 默认按文件隔离 worker，随机后缀防同进程撞车）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const tmpDb = path.join(os.tmpdir(), `r4b-test-${stamp}.db`)
export const tmpGeo = path.join(os.tmpdir(), `r4b-test-geo-${stamp}`)

// 只在调用方**没有**指定时兜底：已经显式设过的（如 data-*.test）保持原样
if (!process.env.R4B_DB_PATH) process.env.R4B_DB_PATH = tmpDb
if (!process.env.R4B_GEO_DIR) process.env.R4B_GEO_DIR = tmpGeo

/** 收尾：删临时库与临时目录（不存在也不报错） */
export function cleanupTmpEnv() {
  try { fs.rmSync(tmpDb, { force: true }) } catch { /* 忽略 */ }
  try { fs.rmSync(tmpGeo, { recursive: true, force: true }) } catch { /* 忽略 */ }
}
