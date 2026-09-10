#!/usr/bin/env node
/**
 * 坐标转换工具 CLI（与后端 smartsteps.js / resale.js 中 gcj02ToWgs84 完全一致）
 *
 * 用途：核对提交给联通智慧足迹(WGS84)的坐标值。
 *   GCJ02(系统内/高德/腾讯瓦片) -> WGS84(联通) = gcj02ToWgs84
 *   WGS84 -> GCJ02 = wgs84ToGcj02（验证用）
 *
 * 用法（两种模式）：
 *   node coord-convert.mjs 116.397428 39.90923          # 默认 GCJ02->WGS84
 *   node coord-convert.mjs 116.397428 39.90923 --to-gcj  # WGS84->GCJ02
 *   node coord-convert.mjs "116.397428,39.90923"         # 逗号分隔一组
 */
const PI = 3.1415926535897932384626;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}
function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}
/** GCJ02 -> WGS84，返回6位小数（与后端 smartsteps.js 实现逐字一致，不做 outOfChina 特判） */
export function gcj02ToWgs84(lng, lat) {
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return {
    lng: Math.round((lng - dLng) * 1e6) / 1e6,
    lat: Math.round((lat - dLat) * 1e6) / 1e6,
  };
}

/** WGS84 -> GCJ02，返回6位小数 */
export function wgs84ToGcj02(lng, lat) {
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
  return {
    lng: Math.round((lng + dLng) * 1e6) / 1e6,
    lat: Math.round((lat + dLat) * 1e6) / 1e6,
  };
}

// ---- CLI ----
const args = process.argv.slice(2);
const toGcj = args.includes('--to-gcj') || args.includes('-g');
const nums = args.filter(a => a !== '--to-gcj' && a !== '-g');
let pairs = [];
nums.forEach(a => { if (a.includes(',')) pairs.push(...a.split(',').map(s=>parseFloat(s.trim()))); else pairs.push(parseFloat(a)); });

if (pairs.length < 2 || pairs.length % 2 !== 0 || pairs.some(isNaN)) {
  console.log('用法: node coord-convert.mjs <lng> <lat> [--to-gcj]');
  console.log('     或 node coord-convert.mjs <lng1,lat1,lng2,lat2,...>');
  process.exit(1);
}

pairs.forEach((_, i) => {
  if (i % 2 !== 0) return;
  const lng = pairs[i], lat = pairs[i+1];
  const out = toGcj ? wgs84ToGcj02(lng, lat) : gcj02ToWgs84(lng, lat);
  const mode = toGcj ? 'WGS84 -> GCJ02' : 'GCJ02(系统内) -> WGS84(提交联通)';
  console.log(`[${mode}]`);
  console.log(`  输入 : lng=${lng}  lat=${lat}`);
  console.log(`  输出 : lng=${out.lng}  lat=${out.lat}`);
  console.log(`  --- 提交联通的 point 格式: point(${out.lng} ${out.lat})`);
});
