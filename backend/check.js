
const initSqlJs = require('sql.js');
const fs = require('fs');

async function check() {
  const SQL = await initSqlJs();
  const dbPath = '/var/www/Report4biz/backend/database/webgis.db';
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);
  
  // 检查admin_quota
  try {
    const result = db.exec("SELECT * FROM admin_quota");
    console.log("admin_quota:", JSON.stringify(result, null, 2));
  } catch(e) {
    console.log("admin_quota error:", e.message);
  }
  
  // 检查users表
  try {
    const users = db.exec("SELECT id, username, role, quota FROM users");
    console.log("users:", JSON.stringify(users, null, 2));
  } catch(e) {
    console.log("users error:", e.message);
  }
  
  db.close();
}
check();
