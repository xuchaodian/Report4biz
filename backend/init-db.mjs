import initSqlJs from 'sql.js';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const SQL = await initSqlJs();
const db = new SQL.Database();

// 创建用户表
db.run(`CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// 创建门店表
db.run(`CREATE TABLE markers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_code TEXT,
  brand TEXT,
  name TEXT NOT NULL,
  store_type TEXT DEFAULT '已开业',
  city TEXT,
  district TEXT,
  area_manager TEXT,
  phone1 TEXT,
  store_manager TEXT,
  phone2 TEXT,
  address TEXT,
  open_date TEXT,
  business_hours TEXT,
  area REAL,
  seats INTEGER,
  rent REAL,
  store_category TEXT,
  contact_person TEXT,
  contact_phone TEXT,
  description TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  status TEXT DEFAULT '正常',
  icon_color TEXT DEFAULT '#409eff',
  user_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// 创建管理员
const hashedPassword = bcrypt.hashSync('admin123', 10);
db.run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
  ['admin', 'admin@geomanger.local', hashedPassword, 'admin']);

// 创建品牌图标表
db.run(`CREATE TABLE brand_icons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_id INTEGER DEFAULT 1
)`);

// 插入示例数据 - 使用带字段名的INSERT语句
const stores = [
  `INSERT INTO markers (store_code,brand,name,store_type,city,district,area_manager,phone1,store_manager,phone2,address,open_date,business_hours,area,seats,rent,store_category,contact_person,contact_phone,description,latitude,longitude,status,icon_color,created_at,updated_at) VALUES ('BJ001','星巴克','星巴克国贸店','已开业','北京市','朝阳区','李明','13800138001','王芳','13800138002','国贸大厦一层','2023-01-15','07:00-22:00',200,80,50000,'直营','张总','13900139001','CBD核心区门店，业绩良好',39.9088,116.4610,'正常','#67c23a',datetime('now'),datetime('now'))`,
  `INSERT INTO markers (store_code,brand,name,store_type,city,district,area_manager,phone1,store_manager,phone2,address,open_date,business_hours,area,seats,rent,store_category,contact_person,contact_phone,description,latitude,longitude,status,icon_color,created_at,updated_at) VALUES ('BJ002','星巴克','星巴克中关村店','已开业','北京市','海淀区','李明','13800138001','赵雪','13800138003','中关村大街1号','2022-06-20','08:00-21:00',150,60,45000,'直营','刘总','13900139002','中国硅谷核心区域',39.9830,116.3120,'正常','#67c23a',datetime('now'),datetime('now'))`,
  `INSERT INTO markers (store_code,brand,name,store_type,city,district,area_manager,phone1,address,area,seats,rent,store_category,contact_person,contact_phone,description,latitude,longitude,status,icon_color,created_at,updated_at) VALUES ('BJ003','星巴克','星巴克望京候选点','重点候选','北京市','朝阳区','李明','13800138001','望京SOHO T2',180,70,42000,'加盟','陈总','13900139003','写字楼密集区，人流量大，重点跟进',39.9965,116.4710,'正常','#f56c6c',datetime('now'),datetime('now'))`,
  `INSERT INTO markers (store_code,brand,name,store_type,city,district,area_manager,phone1,store_manager,phone2,address,open_date,business_hours,area,seats,rent,store_category,contact_person,contact_phone,description,latitude,longitude,status,icon_color,created_at,updated_at) VALUES ('BJ004','星巴克','星巴克三里屯店','已开业','北京市','朝阳区','李明','13800138001','周丽','13800138004','三里屯太古里','2021-09-10','09:00-23:00',250,100,80000,'直营','吴总','13900139004','时尚地标，年轻人聚集地',39.9358,116.4475,'正常','#67c23a',datetime('now'),datetime('now'))`,
  `INSERT INTO markers (store_code,brand,name,store_type,city,district,area_manager,phone1,address,area,seats,rent,store_category,contact_person,contact_phone,description,latitude,longitude,status,icon_color,created_at,updated_at) VALUES ('BJ005','星巴克','星巴克通州候选A','一般候选','北京市','通州区','李明','13800138001','通州万达广场',160,50,28000,'加盟','孙总','13900139005','新城区，发展潜力一般',39.9072,116.6560,'正常','#e6a23c',datetime('now'),datetime('now'))`,
  `INSERT INTO markers (store_code,brand,name,store_type,city,district,area_manager,phone1,store_manager,phone2,address,open_date,business_hours,area,seats,rent,store_category,contact_person,contact_phone,description,latitude,longitude,status,icon_color,created_at,updated_at) VALUES ('SH001','星巴克','星巴克陆家嘴店','已开业','上海市','浦东新区','王强','13800138005','李娜','13800138006','陆家嘴环路1000号','2023-03-01','07:30-22:00',300,120,120000,'直营','郑总','13900139006','金融核心区，高端客群',31.2399,121.4998,'正常','#67c23a',datetime('now'),datetime('now'))`,
  `INSERT INTO markers (store_code,brand,name,store_type,city,district,area_manager,phone1,address,area,seats,rent,store_category,contact_person,contact_phone,description,latitude,longitude,status,icon_color,created_at,updated_at) VALUES ('SH002','星巴克','星巴克静安候选','重点候选','上海市','静安区','王强','13800138005','静安寺商圈',200,80,90000,'直营','钱总','13900139007','老牌商业区，客流稳定',31.2299,121.4476,'正常','#f56c6c',datetime('now'),datetime('now'))`,
  `INSERT INTO markers (store_code,brand,name,store_type,city,district,area_manager,phone1,store_manager,phone2,address,open_date,business_hours,area,seats,rent,store_category,contact_person,contact_phone,description,latitude,longitude,status,icon_color,created_at,updated_at) VALUES ('GZ001','星巴克','星巴克天河城店','已开业','广州市','天河区','陈静','13800138007','林美','13800138008','天河路208号','2022-11-20','08:00-22:00',180,70,60000,'直营','黄总','13900139008','华南第一商圈',23.1392,113.3192,'正常','#67c23a',datetime('now'),datetime('now'))`
];

for (const sql of stores) {
  db.run(sql);
}

// 保存数据库
fs.writeFileSync('./database/webgis.db', Buffer.from(db.export()));
console.log('数据库创建成功！共', stores.length, '条门店数据');
console.log('管理员账户: admin / admin123');
