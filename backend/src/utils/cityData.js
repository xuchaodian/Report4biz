/**
 * cityData.js — 城市宏观数据（city_data.json）统一加载器
 *
 * M6：原先 dashboard.js / market-map.js / city-data.js 各自在每个请求里
 * `readFileSync + JSON.parse` 整个 JSON 文件。改为模块级缓存 + mtime 感知：
 *   - 命中时只做一次 statSync（微秒级），不再重复读盘/解析
 *   - 文件被改写（API 写入或外部编辑）后 mtime 变化 → 自动重载，无需手动清缓存
 *
 * @returns {Array|Object} 解析后的 JSON 原值（本文件为数组）
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CITY_DATA_PATH = path.join(__dirname, '../data/city_data.json')

let _cached = null
let _cachedMtime = 0

export function getCityData() {
  try {
    const mtime = fs.statSync(CITY_DATA_PATH).mtimeMs
    if (_cached && mtime === _cachedMtime) return _cached
    const parsed = JSON.parse(fs.readFileSync(CITY_DATA_PATH, 'utf-8'))
    _cached = parsed
    _cachedMtime = mtime
    return _cached
  } catch (e) {
    console.warn('[cityData] 读取失败:', e.message)
    return _cached || []
  }
}

/** 归一化为数组（兼容 {cities:[...]} 包装） */
export function getCityDataArray() {
  const parsed = getCityData()
  return Array.isArray(parsed) ? parsed : (parsed && parsed.cities) || []
}

/** 主动失效（一般不需要——mtime 感知已覆盖；供写入后立即刷新用） */
export function invalidateCityData() {
  _cached = null
  _cachedMtime = 0
}

export default { getCityData, getCityDataArray, invalidateCityData }
