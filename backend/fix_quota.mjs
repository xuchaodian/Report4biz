
import initSqlJs from 'sql.js';
import fs from 'fs';

const SQL = await initSqlJs();
const dbPath = '/var/www/Report4biz/backend/database/webgis.db';
const fileBuffer = fs.readFileSync(dbPath);
const db = new SQL.Database(fileBuffer);

// 重置总配额为10
db.run("UPDATE admin_quota SET remaining_quota = 10 WHERE id = 1");
console.log("重置 admin_quota.remaining_quota = 10");

// 给admin用户分配配额5次
db.run("UPDATE users SET quota = 5 WHERE username = 'admin'");
console.log("设置 admin quota = 5");

// 保存数据库
const data = db.export();
const buffer = Buffer.from(data);
fs.writeFileSync(dbPath, buffer);
console.log("数据库已保存");

db.close();
