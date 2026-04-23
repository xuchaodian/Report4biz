
import initSqlJs from 'sql.js';
import https from 'https';
import http from 'http';

const SQL = await initSqlJs();
const dbPath = '/var/www/Report4biz/backend/database/webgis.db';
const fileBuffer = require('fs').readFileSync(dbPath);
const db = new SQL.Database(fileBuffer);

// 获取token
const getToken = () => {
  return new Promise((resolve, reject) => {
    const req = http.get('http://ip-api.com/json/?fields=status,country,countryCode,region,regionName,city,lat,lon', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('ip-api响应:', data);
        resolve('test');
      });
    });
    req.on('error', reject);
  });
};

// 模拟查询上海附近的数据
const lat = 31.22;
const lng = 121.46;
const radius = 1000;

console.log('模拟查询: lat=' + lat + ', lng=' + lng + ', radius=' + radius);
console.log('返回数据格式应该是: { 1006: { day_avg_visit: number, ... } }');
