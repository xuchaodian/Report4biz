const fs = require('fs');
const filePath = 'populationStats.js';
let content = fs.readFileSync(filePath, 'utf8');

// 在 calculatePopulationByRadius 函数开头添加调试信息
const searchStr = 'export const calculatePopulationByRadius = async (centerLat, centerLng, radiusMeters, shapefiles) => {';
const insertStr = 'export const calculatePopulationByRadius = async (centerLat, centerLng, radiusMeters, shapefiles) => {
  console.log("=== calculatePopulationByRadius 被调用 ===");
  console.log("中心点:", centerLat, centerLng, "半径:", radiusMeters, "m");
  console.log("shapefiles 数量:", shapefiles ? shapefiles.length : 0);';

if (content.includes(searchStr)) {
  content = content.replace(searchStr, insertStr);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('调试信息添加成功');
} else {
  console.log('未找到目标函数');
}
