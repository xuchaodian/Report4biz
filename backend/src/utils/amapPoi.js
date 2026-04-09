/**
 * 高德地图 POI 搜索工具
 * https://lbs.amap.com/api/webservice/guide/api/newpoisearch
 */
import axios from 'axios'

// 高德地图 Web服务 API Key
const AMAP_KEY = '8e22ba2cec83bc554753a47842383949';
const AMAP_PLACE_URL = 'https://restapi.amap.com/v3/place';
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

/**
 * 地理编码：将地址转换为坐标
 * @param {string} address - 地址字符串
 * @returns {Promise<{lng: number, lat: number, province: string, city: string, district: string}>}
 */
async function geocode(address) {
  const params = {
    key: AMAP_KEY,
    address: address
  };
  
  const response = await axios.get(`${AMAP_GEO_URL}/geo`, { params });
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
  
  const response = await axios.get(`${AMAP_PLACE_URL}/around`, { params });
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
  
  const response = await axios.get(`${AMAP_PLACE_URL}/polygon`, { params });
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
  
  const response = await axios.get(`${AMAP_PLACE_URL}/text`, { params });
  return parseResponse(response.data);
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
  geocode,
  wgs84ToGcj02
}
