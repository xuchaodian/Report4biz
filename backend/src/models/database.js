import initSqlJs from 'sql.js'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbDir = join(__dirname, '../../database')
const dbPath = join(dbDir, 'webgis.db')

let db = null
let SQL = null

// 确保数据库目录存在
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

export async function initDatabase() {
  SQL = await initSqlJs()

  // 加载已有数据库或创建新数据库
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  // 创建用户表
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 创建点位表 - 门店管理
  db.run(`
    CREATE TABLE IF NOT EXISTS markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- 基础信息
      store_code TEXT,
      brand TEXT,
      name TEXT NOT NULL,
      store_type TEXT DEFAULT '社区店',
      -- 地址信息
      city TEXT,
      district TEXT,
      area_manager TEXT,
      phone1 TEXT,
      store_manager TEXT,
      phone2 TEXT,
      address TEXT,
      -- 经营信息
      open_date TEXT,
      business_hours TEXT,
      area REAL,
      seats INTEGER,
      rent REAL,
      store_category TEXT,
      -- 联系信息
      contact_person TEXT,
      contact_phone TEXT,
      description TEXT,
      -- 系统字段
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      status TEXT DEFAULT '正常',
      icon_color TEXT DEFAULT '#409eff',
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // 创建索引
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_markers_category ON markers(store_category)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_markers_status ON markers(status)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_markers_user ON markers(user_id)`)
  } catch (e) {
    // 索引可能已存在
  }

  // 创建竞品门店表
  db.run(`
    CREATE TABLE IF NOT EXISTS competitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- 基础信息
      store_code TEXT,
      brand TEXT,
      name TEXT NOT NULL,
      store_type TEXT DEFAULT '竞品',
      store_category TEXT,
      -- 地址信息
      city TEXT,
      district TEXT,
      address TEXT,
      -- 备注
      description TEXT,
      -- 系统字段
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      status TEXT DEFAULT '正常',
      icon_color TEXT DEFAULT '#f56c6c',
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // 迁移：给已存在的 competitors 表添加 store_category 列（如果不存在）
  try {
    db.run(`ALTER TABLE competitors ADD COLUMN store_category TEXT`)
  } catch (e) { /* 列已存在，忽略 */ }
  // 迁移：移除旧列（SQLite 不支持 DROP COLUMN，只忽略即可，不影响功能）

  // 创建竞品门店索引
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_competitors_user ON competitors(user_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_competitors_status ON competitors(status)`)
  } catch (e) {
    // 索引可能已存在
  }

  // 创建品牌图标表
  db.run(`
    CREATE TABLE IF NOT EXISTS brand_icons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      brand TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // 创建品牌图标索引
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_brand_icons_user ON brand_icons(user_id)`)
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_icons_unique ON brand_icons(user_id, brand)`)
  } catch (e) {
    // 索引可能已存在
  }

  // 创建品牌门店表
  db.run(`
    CREATE TABLE IF NOT EXISTS brand_stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      store_code TEXT,
      brand TEXT,
      name TEXT NOT NULL,
      store_type TEXT DEFAULT '品牌',
      store_category TEXT,
      city TEXT,
      district TEXT,
      address TEXT,
      description TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      status TEXT DEFAULT '正常',
      icon_color TEXT DEFAULT '#409eff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // 迁移：给已存在的 brand_stores 表添加 store_category 列（如果不存在）
  try {
    db.run(`ALTER TABLE brand_stores ADD COLUMN store_category TEXT`)
  } catch (e) { /* 列已存在，忽略 */ }

  // 创建品牌门店索引
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_brand_stores_user ON brand_stores(user_id)`)
  } catch (e) {
    // 索引可能已存在
  }

  // 创建 Shapefile 数据表
  db.run(`
    CREATE TABLE IF NOT EXISTS shapefiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      geojson TEXT NOT NULL,
      field_names TEXT,
      feature_count INTEGER DEFAULT 0,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // 创建 Shapefile 索引
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_shapefiles_user ON shapefiles(user_id)`)
  } catch (e) {
    // 索引可能已存在
  }

  // 创建默认管理员账户 (密码: admin123)
  const adminCheck = db.exec("SELECT id FROM users WHERE username = 'admin'")
  if (adminCheck.length === 0 || adminCheck[0].values.length === 0) {
    const hashedPassword = bcrypt.hashSync('admin123', 10)
    db.run(`
      INSERT INTO users (username, email, password, role)
      VALUES (?, ?, ?, ?)
    `, ['admin', 'admin@geomanger.local', hashedPassword, 'admin'])
    console.log('默认管理员账户已创建: admin / admin123')
  }

  // 插入示例门店数据
  const markerCount = db.exec("SELECT COUNT(*) as count FROM markers")
  if (markerCount.length === 0 || markerCount[0].values[0][0] === 0) {
    const sampleStores = [
      {
        store_code: 'BJ001', brand: '星巴克', name: '星巴克国贸店', store_type: '已开业',
        city: '北京市', district: '朝阳区', area_manager: '李明', phone1: '13800138001',
        store_manager: '王芳', phone2: '13800138002', address: '国贸大厦一层',
        open_date: '2023-01-15', business_hours: '07:00-22:00', area: 200, seats: 80,
        rent: 50000, store_category: '商场店', contact_person: '张总', contact_phone: '13900139001',
        description: 'CBD核心区门店，业绩良好', latitude: 39.9088, longitude: 116.4610, status: '正常', icon_color: '#67c23a'
      },
      {
        store_code: 'BJ002', brand: '星巴克', name: '星巴克中关村店', store_type: '已开业',
        city: '北京市', district: '海淀区', area_manager: '李明', phone1: '13800138001',
        store_manager: '赵雪', phone2: '13800138003', address: '中关村大街1号',
        open_date: '2022-06-20', business_hours: '08:00-21:00', area: 150, seats: 60,
        rent: 45000, store_category: '写字楼店', contact_person: '刘总', contact_phone: '13900139002',
        description: '中国硅谷核心区域', latitude: 39.9830, longitude: 116.3120, status: '正常', icon_color: '#67c23a'
      },
      {
        store_code: 'BJ003', brand: '星巴克', name: '星巴克望京候选点', store_type: '重点候选',
        city: '北京市', district: '朝阳区', area_manager: '李明', phone1: '13800138001',
        store_manager: '', phone2: '', address: '望京SOHO T2',
        open_date: '', business_hours: '', area: 180, seats: 70,
        rent: 42000, store_category: '写字楼店', contact_person: '陈总', contact_phone: '13900139003',
        description: '写字楼密集区，人流量大，重点跟进', latitude: 39.9965, longitude: 116.4710, status: '正常', icon_color: '#f56c6c'
      },
      {
        store_code: 'BJ004', brand: '星巴克', name: '星巴克三里屯店', store_type: '已开业',
        city: '北京市', district: '朝阳区', area_manager: '李明', phone1: '13800138001',
        store_manager: '周丽', phone2: '13800138004', address: '三里屯太古里',
        open_date: '2021-09-10', business_hours: '09:00-23:00', area: 250, seats: 100,
        rent: 80000, store_category: '临街店', contact_person: '吴总', contact_phone: '13900139004',
        description: '时尚地标，年轻人聚集地', latitude: 39.9358, longitude: 116.4475, status: '正常', icon_color: '#67c23a'
      },
      {
        store_code: 'BJ005', brand: '星巴克', name: '星巴克通州候选A', store_type: '一般候选',
        city: '北京市', district: '通州区', area_manager: '李明', phone1: '13800138001',
        store_manager: '', phone2: '', address: '通州万达广场',
        open_date: '', business_hours: '', area: 160, seats: 50,
        rent: 28000, store_category: '社区店', contact_person: '孙总', contact_phone: '13900139005',
        description: '新城区，发展潜力一般', latitude: 39.9072, longitude: 116.6560, status: '正常', icon_color: '#e6a23c'
      },
      {
        store_code: 'SH001', brand: '星巴克', name: '星巴克陆家嘴店', store_type: '已开业',
        city: '上海市', district: '浦东新区', area_manager: '王强', phone1: '13800138005',
        store_manager: '李娜', phone2: '13800138006', address: '陆家嘴环路1000号',
        open_date: '2023-03-01', business_hours: '07:30-22:00', area: 300, seats: 120,
        rent: 120000, store_category: '商场店', contact_person: '郑总', contact_phone: '13900139006',
        description: '金融核心区，高端客群', latitude: 31.2399, longitude: 121.4998, status: '正常', icon_color: '#67c23a'
      },
      {
        store_code: 'SH002', brand: '星巴克', name: '星巴克静安候选', store_type: '一般候选',
        city: '上海市', district: '静安区', area_manager: '王强', phone1: '13800138005',
        store_manager: '', phone2: '', address: '静安寺商圈',
        open_date: '', business_hours: '', area: 200, seats: 80,
        rent: 90000, store_category: '临街店', contact_person: '钱总', contact_phone: '13900139007',
        description: '老牌商业区，客流稳定', latitude: 31.2299, longitude: 121.4476, status: '正常', icon_color: '#f56c6c'
      },
      {
        store_code: 'GZ001', brand: '星巴克', name: '星巴克天河城店', store_type: '已开业',
        city: '广州市', district: '天河区', area_manager: '陈静', phone1: '13800138007',
        store_manager: '林美', phone2: '13800138008', address: '天河路208号',
        open_date: '2022-11-20', business_hours: '08:00-22:00', area: 180, seats: 70,
        rent: 60000, store_category: '商场店', contact_person: '黄总', contact_phone: '13900139008',
        description: '华南第一商圈', latitude: 23.1392, longitude: 113.3192, status: '正常', icon_color: '#67c23a'
      }
    ]

    for (const m of sampleStores) {
      db.run(`
        INSERT INTO markers (
          store_code, brand, name, store_type, city, district, area_manager, phone1,
          store_manager, phone2, address, open_date, business_hours, area, seats,
          rent, store_category, contact_person, contact_phone, description,
          latitude, longitude, status, icon_color
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        m.store_code, m.brand, m.name, m.store_type, m.city, m.district, m.area_manager, m.phone1,
        m.store_manager, m.phone2, m.address, m.open_date, m.business_hours, m.area, m.seats,
        m.rent, m.store_category, m.contact_person, m.contact_phone, m.description,
        m.latitude, m.longitude, m.status, m.icon_color
      ])
    }
    console.log(`已插入 ${sampleStores.length} 条示例门店数据`)
  }

  // 保存数据库
  saveDatabase()

  console.log('数据库初始化完成')
}

export function saveDatabase() {
  if (db) {
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(dbPath, buffer)
  }
}

export function getDb() {
  return {
    // 执行查询并返回结果
    exec: (sql) => {
      return db.exec(sql)
    },
    
    // 执行单行查询
    prepare: (sql) => ({
      get: (...params) => {
        const stmt = db.prepare(sql)
        stmt.bind(params)
        if (stmt.step()) {
          const row = stmt.getAsObject()
          stmt.free()
          return row
        }
        stmt.free()
        return undefined
      },
      
      // 执行插入/更新/删除
      run: (...params) => {
        db.run(sql, params)
        saveDatabase()
        return {
          lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] || 0,
          changes: db.getRowsModified()
        }
      },
      
      // 获取所有行
      all: (...params) => {
        const stmt = db.prepare(sql)
        stmt.bind(params)
        const results = []
        while (stmt.step()) {
          results.push(stmt.getAsObject())
        }
        stmt.free()
        return results
      }
    })
  }
}

// 初始化数据库
await initDatabase()
