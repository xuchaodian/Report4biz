/**
 * 高德地图 POI 搜索工具
 * https://lbs.amap.com/api/webservice/guide/api/newpoisearch
 */
import axios from 'axios'
import { AMAP_KEY as CONFIG_AMAP_KEY } from '../config.js'
import { geocodeByTencent, isTencentMapEnabled } from './tencentMap.js'

// L6：统一 10s 超时，避免高德挂起导致请求永久 pending
const http = axios.create({ timeout: 10000 })

// 高德地图 Web服务 API Key（来自环境变量）
const AMAP_KEY = CONFIG_AMAP_KEY;
const AMAP_PLACE_URL = 'https://restapi.amap.com/v3/place';

/**
 * 高德 v3 `count` 的**封顶值**：>= 800 一律返回 800，不代表真实门店数。
 * 2026-10-20 实测：上海/北京/广州/深圳/杭州的「肯德基」全部 800；
 * 上海「麦当劳」652（未封顶，可当真）⇒ 800 是 cap。
 * ⚠️ 调用方展示时必须写成「已达上限 800 家（实际可能更多）」，⛔ 不可直接说「共 800 家」。
 */
const COUNT_CAP = 800;

/**
 * 翻页间隔：高德 QPS 限制很紧 —— 实测连续快速请求第 10 次即返回
 * CUQPS_HAS_EXCEEDED_THE_LIMIT（此前 8 页连发无节流，偶发整个品牌被降级）。
 * 400ms ≈ 2.5 次/秒，8 页共约 +2.8s。
 */
const PAGE_DELAY_MS = 400;
/** 命中限频后的重试等待（只重试一次，避免拖长整体耗时） */
const RATE_LIMIT_WAIT_MS = 1000;

/** 简易延时（仅用于翻页节流，无外部依赖） */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const AMAP_GEO_URL = 'https://restapi.amap.com/v3/geocode';

// GCJ-02 坐标转换为高德坐标（高德API使用GCJ-02，直接返回）
// WGS-84 转 GCJ-02（用于支持WGS坐标输入）
function wgs84ToGcj02(lng, lat) {
  // 简化的转换公式
  const PI = 3.1415926535897932384626;
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (a / magic * sqrtMagic * PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

function transformLat(x, y) {
  const PI = 3.1415926535897932384626;
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  const PI = 3.1415926535897932384626;
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

// GCJ-02 转 WGS-84（高德 POI 返回 GCJ-02，转回 WGS-84 用于与数据库门店坐标统一）
function gcj02ToWgs84(lng, lat) {
  const PI = 3.1415926535897932384626;
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (a / magic * sqrtMagic * PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  return [lng - dLng, lat - dLat];
}

/**
 * 地理编码：将地址转换为坐标
 * @param {string} address - 地址字符串
 * @returns {Promise<{lng: number, lat: number, province: string, city: string, district: string}>}
 */
async function geocode(address) {
  // ===== v1.13.263：优先腾讯（分流高德配额）=====
  // 为什么改这里而不是别处：`geocode` 是**所有地址解析的唯一入口**
  //   （`routes/poi.js` 的 /geocode 与 /batch-geocode 都调它），改一处两处受益。
  // 回退策略：腾讯抛错（含配额/未授权）或返回 null（明确无结果）⇒ 都继续走原高德逻辑。
  //   ⚠️ 「腾讯无结果」也要试高德 —— 两家 POI 库不同，高德可能命中，不能直接放弃。
  if (isTencentMapEnabled()) {
    try {
      const viaTencent = await geocodeByTencent(address)
      if (viaTencent) return viaTencent
    } catch (e) {
      console.warn('[geocode] 腾讯失败，回退高德:', e.message)
    }
  }

  const params = {
    key: AMAP_KEY,
    address: address
  };
  
  const response = await http.get(`${AMAP_GEO_URL}/geo`, { params });
  const data = response.data;
  
  if (data.status !== '1') {
    // 保留高德错误码，便于调用方重试判断
    throw new Error(`${data.info || '地理编码失败'}(${data.infocode || 'N/A'})`);
  }
  
  if (!data.geocodes || data.geocodes.length === 0) {
    return null;
  }
  
  const first = data.geocodes[0];
  const location = first.location.split(',');
  
  return {
    lng: parseFloat(location[0]),
    lat: parseFloat(location[1]),
    province: first.province || '',
    city: first.city || '',
    district: first.district || '',
    formatted_address: first.formatted_address || ''
  };
}

/**
 * 周边搜索
 * @param {number} locationLng - 中心点经度
 * @param {number} locationLat - 中心点纬度
 * @param {number} radius - 搜索半径（米）
 * @param {string} keywords - 关键词
 * @param {string} types - POI类型
 */
async function aroundSearch(locationLng, locationLat, radius, keywords, types) {
  const params = {
    key: AMAP_KEY,
    location: `${locationLng},${locationLat}`,
    radius: radius || 1000,
    keywords: keywords || '',
    types: types || '',
    offset: 20,
    page: 1,
    extensions: 'all'
  };
  
  // 高德要求 location 的逗号不能被 URL 编码（%2C 会返回 400），需禁用 axios 参数编码
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/gi, ',')}`)
    .join('&')
  const response = await http.get(`${AMAP_PLACE_URL}/around?${query}`);
  return parseResponse(response.data);
}

/**
 * 多边形搜索
 * @param {string} polygon - 多边形坐标串，格式：lng1,lat1;lng2,lat2;...
 * @param {string} keywords - 关键词
 * @param {string} types - POI类型
 */
async function polygonSearch(polygon, keywords, types) {
  const params = {
    key: AMAP_KEY,
    polygon: polygon,
    keywords: keywords || '',
    types: types || '',
    offset: 20,
    page: 1,
    extensions: 'all'
  };
  
  const response = await http.get(`${AMAP_PLACE_URL}/polygon`, { params });
  return parseResponse(response.data);
}

/**
 * 关键词搜索
 * @param {string} city - 城市名称
 * @param {string} keywords - 关键词
 * @param {string} types - POI类型
 */
async function textSearch(city, keywords, types) {
  const params = {
    key: AMAP_KEY,
    city: city || '全国',
    keywords: keywords || '',
    types: types || '',
    offset: 20,
    page: 1,
    extensions: 'all'
  };
  
  const response = await http.get(`${AMAP_PLACE_URL}/text`, { params });
  return parseResponse(response.data);
}

/**
 * 关键词全量检索（分页收集，最多 maxPages×20 个点）
 * 高德 POI 返回 GCJ-02；系统内人口网格（上传时 WGS84→GCJ-02）、
 * 门店坐标均为 GCJ-02，三者坐标系一致，POI 坐标直接使用、无需转换。
 * @param {string} city - 城市名称
 * @param {string} keywords - 品牌关键词
 * @param {number} maxPages - 最多翻页数（默认 8 页 = 160 个点）
 * @returns {Promise<{count: number, pois: Array<{name, lng, lat}>, error: string|null, truncated: boolean}>}
 *   ⚠️ v1.13.239：高德返回 status≠1 时**不再静默 break**，改为带回 error；count>已取点数 记 truncated。
 *   调用方据此把「条件未生效」告知用户（⛔ 不允许静默放行）。
 */
async function textSearchAll(city, keywords, maxPages = 8) {
  const all = []
  let count = 0
  let error = null
  for (let page = 1; page <= maxPages; page++) {
    // v1.13.254：翻页节流 —— 8 连发会偶发 CUQPS，导致整个品牌被判「检索失败」
    if (page > 1) await sleep(PAGE_DELAY_MS)
    const params = {
      key: AMAP_KEY,
      city: city || '全国',
      keywords: keywords || '',
      types: '',
      offset: 20,
      page,
      extensions: 'all'
    }
    let resp
    try {
      resp = await http.get(`${AMAP_PLACE_URL}/text`, { params })
    } catch (e) {
      error = e.message
      break
    }
    // 命中限频 → 等 1s 重试一次（仍失败才判 error，交给调用方降级）
    if (resp.data.status !== '1' && /CUQPS|LIMIT|FREQUENT|TOO_MANY/i.test(resp.data.info || '')) {
      await sleep(RATE_LIMIT_WAIT_MS)
      try {
        resp = await http.get(`${AMAP_PLACE_URL}/text`, { params })
      } catch (e) {
        error = e.message
        break
      }
    }
    if (resp.data.status !== '1') { error = resp.data.info || ('status=' + resp.data.status); break }
    const pois = (resp.data.pois || []).map(p => {
      const parts = (p.location || '0,0').split(',')
      return { name: p.name || '', lng: parseFloat(parts[0]), lat: parseFloat(parts[1]) }
    })
    count = parseInt(resp.data.count || 0)
    all.push(...pois)
    if (pois.length < 20 || all.length >= count || all.length >= maxPages * 20) break
  }
  return {
    count,
    pois: all,
    error,
    truncated: count > all.length,
    // 调用方据此把文案写成「已达上限 N 家（实际可能更多）」而不是「共 N 家」
    countCapped: count >= COUNT_CAP
  }
}

/**
 * 解析高德API响应
 */
function parseResponse(data) {
  if (data.status !== '1') {
    throw new Error(data.info || '高德API调用失败');
  }
  
  const pois = (data.pois || []).map(poi => ({
    id: poi.id,
    name: poi.name,
    location: poi.location,
    address: poi.address || '',
    province: poi.pname || '',
    city: poi.cityname || '',
    district: poi.adname || '',
    type: poi.type || '',
    typecode: poi.typecode || '',
    distance: poi.distance ? parseInt(poi.distance) : null,
    tel: poi.tel || ''
  }));
  
  return {
    count: parseInt(data.count || 0),
    pois: pois
  };
}

export {
  aroundSearch,
  polygonSearch,
  textSearch,
  textSearchAll,
  geocode,
  wgs84ToGcj02,
  gcj02ToWgs84
}
