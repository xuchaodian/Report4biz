
import initSqlJs from 'sql.js';
import fs from 'fs';

const SQL = await initSqlJs();
const dbPath = '/var/www/Report4biz/backend/database/webgis.db';
const fileBuffer = fs.readFileSync(dbPath);
const db = new SQL.Database(fileBuffer);

// 检查购买履历的result_data
try {
  const result = db.exec("SELECT id, store_name, quota_used, substr(result_data, 1, 500) as data_preview FROM purchases ORDER BY id DESC LIMIT 3");
  console.log("购买履历:", JSON.stringify(result, null, 2));
} catch(e) {
  console.log("查询失败:", e.message);
}

db.close();
