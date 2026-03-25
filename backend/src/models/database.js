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

  // 创建点位表
  db.run(`
    CREATE TABLE IF NOT EXISTS markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT DEFAULT '门店',
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      description TEXT,
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
    db.run(`CREATE INDEX IF NOT EXISTS idx_markers_category ON markers(category)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_markers_status ON markers(status)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_markers_user ON markers(user_id)`)
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

  // 插入示例数据
  const markerCount = db.exec("SELECT COUNT(*) as count FROM markers")
  if (markerCount.length === 0 || markerCount[0].values[0][0] === 0) {
    const sampleMarkers = [
      { name: '北京天安门', category: '门店', lat: 39.9072, lng: 116.3910, status: '正常', desc: '首都标志性建筑' },
      { name: '故宫博物院', category: '门店', lat: 39.9163, lng: 116.3972, status: '正常', desc: '中国古代皇家宫殿' },
      { name: '北京站', category: '站点', lat: 39.9046, lng: 116.4273, status: '正常', desc: '北京火车站' },
      { name: '朝阳区某设备', category: '设备', lat: 39.9288, lng: 116.4564, status: '告警', desc: '需要维护' },
      { name: '海淀区仓库', category: '仓库', lat: 39.9890, lng: 116.3063, status: '正常', desc: '主要存储中心' },
      { name: '国贸大厦', category: '门店', lat: 39.9088, lng: 116.4610, status: '正常', desc: 'CBD核心区' },
      { name: '中关村', category: '门店', lat: 39.9830, lng: 116.3120, status: '正常', desc: '中国硅谷' },
      { name: '三里屯', category: '门店', lat: 39.9358, lng: 116.4475, status: '维护', desc: '时尚购物区' },
      { name: '望京SOHO', category: '门店', lat: 39.9965, lng: 116.4710, status: '正常', desc: '现代化办公区' },
      { name: '北京南站', category: '站点', lat: 39.8653, lng: 116.3785, status: '正常', desc: '高铁站' }
    ]

    for (const m of sampleMarkers) {
      db.run(`
        INSERT INTO markers (name, category, latitude, longitude, status, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [m.name, m.category, m.lat, m.lng, m.status, m.desc])
    }
    console.log(`已插入 ${sampleMarkers.length} 条示例点位数据`)
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
