/**
 * 腾讯位置服务（WebServiceAPI）封装 —— v1.13.263
 * ---------------------------------------------------------------------------
 * 用途：**仅为分流高德配额**，只接两个接口，⛔ 不要顺手把 POI 检索也搬过来。
 *
 *   ① `ws/geocoder/v1/`        地址 → 坐标（导入门店的批量地理编码走这里）
 *   ② `ws/place/v1/suggestion` 关键词提示（左上角地址搜索框走这里）
 *
 * 🔴 为什么**不**接「地点检索 place/v1/search」做 POI 分类计数：
 *    两家分类体系完全不同。2026-10-23 实测人民广场 500m：
 *      腾讯 keyword=「商场」→ count 58
 *      高德 types=060100（购物中心）→ mall 9
 *    同一地点差 6 倍。换源会让环境评分、商业成熟度、销售预测的特征值整体漂移，
 *    ⛔ 历史评分不可比、用户会问「昨天 4.6 今天怎么 3.8」。
 *    ⇒ POI 计数类**永远走高德**，不走这里。
 *
 * 🔴 Key 要求（踩过坑，务必照做）：
 *    · 必须是 **WebServiceAPI 类型**的 key；
 *    · 验证方式必须选「**授权IP**」并填服务器公网 IP，⛔ 不能选「域名白名单」——
 *      那个模式校验 Referer，服务端调用没有 Referer，会直接 `status:110 来源域名未被授权`；
 *    · ⛔ 不要复用街景那个 key：街景是 302 跳转、由**用户浏览器**发起，
 *      改成 IP 授权会让街景全挂（来源 IP 是用户自己的）。两个 key 各管一边。
 *
 * 配额生效有延迟：控制台改完配额后约 1 分钟才生效，期间仍返回
 * `status:121 此key每日调用量已达到上限`，别误判成"没配上"。
 *
 * QPS 实测：约 2~3 次/秒（第 3 次连发即 `status:120 每秒请求量超限`），
 * 所以批量场景**必须节流**，见的 TENCENT_GAP_MS。
 */
import axios from 'axios'
import { TENCENT_WEBSERVICE_KEY } from '../config.js'

/** 统一 10s 超时（与 amapPoi 同口径，避免挂起导致请求永久 pending） */
const http = axios.create({ timeout: 10000 })

const TENCENT_WS = 'https://apis.map.qq.com/ws'

// 批量地理编码的间隔参考：腾讯 QPS 约 2~3 次/秒 ⇒ 至少 400ms，建议 600ms。
// ⚠️ 但 routes/poi.js 的 batch-geocode 目前仍沿用 1.1s（对两家都安全）；
//    若要提速到 600ms，需先确认腾讯配额够用 —— 中途 120 会让部分行解析失败。

/** 腾讯是否可用（key 未配置时整体降级为纯高德） */
export function isTencentMapEnabled() {
  return !!TENCENT_WEBSERVICE_KEY
}

/**
 * 腾讯配额类错误码：命中后**不要重试**，直接回退高德。
 *   110 来源未授权 / 111 签名错误 / 112 IP 未授权
 *   120 每秒超限 / 121 每日超限 / 122 每日超限 / 123 未开通
 */
const QUOTA_CODES = new Set([110, 111, 112, 120, 121, 122, 123])

/**
 * 用 address_components 拼出标准地址。
 * 🔴 背景：腾讯 geocoder 对「POI 级匹配」的 result **没有 address 字段**
 *    （实测「南京东路200号」→ 只有 title「悦荟广场餐厅(宏伊国际广场店)」）。
 *    若直接拿 title 当 formatted_address，门店记录里会出现一家餐厅名，非常误导。
 *    ⇒ 用 province/city/district/street/street_number 拼，并**去重**
 *      （直辖市 province 与 city 都叫「上海市」，不去重会拼成「上海市上海市…」）。
 */
function composeAddress(ac) {
  if (!ac) return ''
  const parts = []
  const add = (v) => {
    const s = String(v || '').trim()
    if (s && !parts.includes(s)) parts.push(s)
  }
  add(ac.province)
  add(ac.city)
  add(ac.district)
  add(ac.street)
  // 腾讯的 street_number 是裸数字（"200"），不带「号」⇒ 纯数字时补上，
  // 已有「号」的（少数情况）不重复加
  let sn = String(ac.street_number || '').trim()
  if (/^\d+$/.test(sn)) sn += '号'
  add(sn)
  return parts.join('')
}

/**
 * 地址 → 坐标（正向地理编码）
 *
 * @param {string} address 完整地址
 * @returns {Promise<{lng:number, lat:number, province:string, city:string, district:string, formatted_address:string}|null>}
 *          `null` = 明确无结果（调用方可回退高德再试）
 * @throws  Error（带 `tencentStatus`）—— 调用方应 catch 后回退高德
 */
export async function geocodeByTencent(address) {
  const res = await http.get(`${TENCENT_WS}/geocoder/v1/`, {
    params: { address, key: TENCENT_WEBSERVICE_KEY }
  })
  const d = res.data || {}

  if (d.status !== 0) {
    const err = new Error(`腾讯地理编码失败: ${d.message || '未知'}(${d.status})`)
    err.tencentStatus = d.status
    err.tencentQuota = QUOTA_CODES.has(Number(d.status))
    throw err
  }

  const r = d.result
  // status=0 但没有 result/location（极少数）⇒ 视为无结果
  if (!r || !r.location || r.location.lng == null || r.location.lat == null) return null

  const ac = r.address_components || {}
  const ad = r.ad_info || {}
  return {
    lng: Number(r.location.lng),
    lat: Number(r.location.lat),
    province: ac.province || ad.province || '',
    city: ac.city || ad.city || '',
    district: ac.district || ad.district || '',
    // ⚠️ formatted_address 优先级：address → 拼装地址 → title（最后兜底）
    //    ⛔ 不要直接用 title：腾讯对「不存在的门牌号」会匹配到最近 POI，
    //    title 变成门店名（实测「南京东路200号」→「悦荟广场餐厅(宏伊国际广场店)」），
    //    而这个字段会被写进门店记录，显示成餐厅名会让人困惑。
    formatted_address: r.address || composeAddress(ac) || r.title || ''
  }
}

/**
 * 关键词提示（suggestion）
 *
 * 归一化后的结构与 `routes/geocode.js::/suggest` 的既有输出**完全一致**
 * （id/name/district/address/display_name/lat/lon），前端无需改动。
 *
 * @param {string} keyword
 * @param {string} [city] 可选，限定城市
 * @param {{lng:number,lat:number}} [bias] 可选，就近偏置（v1.13.287：地图当前中心）
 * @returns {Promise<Array<{id:string,name:string,district:string,address:string,display_name:string,lat:number,lon:number}>>}
 */
export async function suggestByTencent(keyword, city, bias) {
  const params = {
    keyword,
    key: TENCENT_WEBSERVICE_KEY,
    page_size: 10
  }
  // 腾讯用 region 限定城市（不传则全国）
  if (city) params.region = city
  // v1.13.287：就近偏置 —— 腾讯的 location 是「latitude,longitude」，且要 region_fix=0
  // 才表示「按距离优先、不强制限定区域」。不带这两个参数时它按全国相关度返回，
  // 会出现「在上海搜某连锁，全返回外地门店」的问题。
  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
    params.location = `${bias.lat},${bias.lng}`
    params.region_fix = 0
  }

  const res = await http.get(`${TENCENT_WS}/place/v1/suggestion`, { params })
  const d = res.data || {}

  if (d.status !== 0) {
    const err = new Error(`腾讯关键词提示失败: ${d.message || '未知'}(${d.status})`)
    err.tencentStatus = d.status
    err.tencentQuota = QUOTA_CODES.has(Number(d.status))
    throw err
  }

  const list = Array.isArray(d.data) ? d.data : []
  return list
    .filter(item => item && item.location && item.location.lat != null && item.location.lng != null)
    .map(item => {
      const district = item.district || ''
      const name = item.title || ''
      return {
        id: String(item.id || ''),
        name,
        district,
        address: item.address || '',
        display_name: district ? `${district}${name}` : name,
        lat: Number(item.location.lat),
        lon: Number(item.location.lng)
      }
    })
}

/** 简易延时（供调用方节流用） */
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
