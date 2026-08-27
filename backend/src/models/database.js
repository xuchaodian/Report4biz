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
      vip_until TEXT,
      company TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 为已有数据库添加 company 字段（如果不存在）
  try {
    db.run(`ALTER TABLE users ADD COLUMN company TEXT`)
  } catch (e) {
    // 字段已存在，忽略
  }

  // 为已有数据库添加 delivery_ratio 字段（如果不存在）——门店外卖占比（0-100，NULL=未填，销售预测坪效修正用）
  try {
    db.run(`ALTER TABLE store_sales ADD COLUMN delivery_ratio INTEGER`)
  } catch (e) {
    // 字段已存在，忽略
  }

  // 为已有数据库添加 vip_until 字段（如果不存在）——VIP 到期时间（YYYY-MM-DD）
  try {
    db.run(`ALTER TABLE users ADD COLUMN vip_until TEXT`)
  } catch (e) {
    // 字段已存在，忽略
  }

  // 为已有数据库添加 logo 字段（如果不存在）——自定义报告 Logo（base64 data URL 或路径）
  try {
    db.run(`ALTER TABLE users ADD COLUMN logo TEXT`)
  } catch (e) {
    // 字段已存在，忽略
  }

  // 为已有数据库添加 quota 字段（如果不存在）
  try {
    db.run(`ALTER TABLE users ADD COLUMN quota INTEGER DEFAULT 0`)
  } catch (e) {
    // 字段已存在，忽略
  }

  // 创建管理员总配额表
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_quota (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      initial_quota INTEGER DEFAULT 0,
      remaining_quota INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 确保有一条配额记录
  try {
    db.run(`INSERT INTO admin_quota (id, initial_quota, remaining_quota) VALUES (1, 0, 0)`)
  } catch (e) {
    // 已存在，忽略
  }

  // 市场地图（城市洞察）评分权重配置
  db.run(`
    CREATE TABLE IF NOT EXISTS market_map_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      weights TEXT DEFAULT '{"marketSize":0.30,"competition":0.25,"brandGap":0.25,"consumption":0.20}',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  try {
    db.run(`INSERT INTO market_map_config (id) VALUES (1)`)
  } catch (e) {
    // 已存在，忽略
  }

  // 转售 API 客户表（第三方调用联通人口数据）
  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      balance INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      mock INTEGER DEFAULT 0
    )
  `)

  // 兼容迁移：老库 api_keys 缺 mock 列时补上（测试模式）
  try {
    const keyCols = db.exec(`PRAGMA table_info(api_keys)`)
    const hasMock = keyCols[0]?.values?.some(v => v[1] === 'mock')
    if (!hasMock) {
      db.run(`ALTER TABLE api_keys ADD COLUMN mock INTEGER DEFAULT 0`)
    }
  } catch (e) {
    console.warn('api_keys mock 列迁移失败:', e.message)
  }

  // 转售 API 调用记录表
  db.run(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id INTEGER NOT NULL,
      services TEXT,
      center_lng REAL,
      center_lat REAL,
      radius INTEGER,
      city_month TEXT,
      from_cache INTEGER DEFAULT 0,
      cost INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_api_usage_key ON api_usage(api_key_id, created_at)`)

  // 创建配额分配历史表（记录管理员每次设定/追加配额的变更）
  db.run(`
    CREATE TABLE IF NOT EXISTS quota_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      old_quota INTEGER DEFAULT 0,
      new_quota INTEGER DEFAULT 0,
      change_amount INTEGER DEFAULT 0,
      action TEXT DEFAULT 'set',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)
  // 为已有用户写入基线历史记录（累计配额以当前配额为起点）
  try {
    db.run(`
      INSERT INTO quota_history (user_id, old_quota, new_quota, change_amount, action)
      SELECT id, 0, quota, quota, 'set' FROM users
      WHERE quota > 0 AND id NOT IN (SELECT DISTINCT user_id FROM quota_history)
    `)
  } catch (e) {
    // 忽略
  }

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
  // 迁移：添加竞品评分字段
  try { db.run(`ALTER TABLE competitors ADD COLUMN industry TEXT`) } catch (e) {}
  try { db.run(`ALTER TABLE competitors ADD COLUMN price REAL DEFAULT 0`) } catch (e) {}
  try { db.run(`ALTER TABLE competitors ADD COLUMN rating REAL DEFAULT 0`) } catch (e) {}
  try { db.run(`ALTER TABLE competitors ADD COLUMN reviews INTEGER DEFAULT 0`) } catch (e) {}
  try { db.run(`ALTER TABLE competitors ADD COLUMN taste_score REAL DEFAULT 0`) } catch (e) {}
  try { db.run(`ALTER TABLE competitors ADD COLUMN environment_score REAL DEFAULT 0`) } catch (e) {}
  try { db.run(`ALTER TABLE competitors ADD COLUMN service_score REAL DEFAULT 0`) } catch (e) {}
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

  // 创建购物中心表
  db.run(`
    CREATE TABLE IF NOT EXISTS shopping_centers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      store_code TEXT,
      name TEXT NOT NULL,
      store_category TEXT,
      city TEXT,
      district TEXT,
      address TEXT,
      rank_info TEXT,
      comments INTEGER DEFAULT 0,
      stars REAL DEFAULT 0,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      status TEXT DEFAULT '正常',
      icon_color TEXT DEFAULT '#67c23a',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // 创建购物中心索引
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_shopping_centers_user ON shopping_centers(user_id)`)
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

  // 兼容迁移：添加 category 列（用于区分七普人口和其他类型）
  try {
    db.run(`ALTER TABLE shapefiles ADD COLUMN category TEXT DEFAULT 'population'`)
    console.log('[数据库] shapefiles 表已添加 category 列')
  } catch (e) {
    // 列已存在则忽略
  }

  // 创建智慧足迹购买记录表
  db.run(`
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      store_name TEXT,
      store_type TEXT,
      center_lng REAL,
      center_lat REAL,
      radius INTEGER,
      city_month TEXT,
      quota_used INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      result_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // 创建购买记录索引
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id)`)
  } catch (e) {
    // 索引可能已存在
  }

  // 为已有数据库添加门店相关字段
  try {
    db.run(`ALTER TABLE purchases ADD COLUMN store_name TEXT`)
  } catch (e) {
    // 字段已存在，忽略
  }
  try {
    db.run(`ALTER TABLE purchases ADD COLUMN store_type TEXT`)
  } catch (e) {
    // 字段已存在，忽略
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

  // 创建 AI 用量记录表
  try {
    // 门店月度销售（销售预测数据地基，按用户隔离，同店同月幂等覆盖）
    db.run(`CREATE TABLE IF NOT EXISTS store_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      store_name TEXT,
      brand TEXT,
      city TEXT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      sales_amount REAL NOT NULL DEFAULT 0,
      store_area REAL,
      delivery_ratio INTEGER,
      customer_count INTEGER,
      remark TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, store_id, year, month)
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)
  } catch (e) {
    console.warn('创建 ai_usage 表失败:', e.message)
  }

  // 门店潜力评分相关表
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS scoring_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        weight_population REAL DEFAULT 0.40,
        weight_competition REAL DEFAULT 0.25,
        weight_support REAL DEFAULT 0.20,
        weight_transport REAL DEFAULT 0.15,
        radius_km REAL DEFAULT 1.0,
        competition_threshold INTEGER DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS site_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_id INTEGER REFERENCES scoring_configs(id),
        user_id INTEGER NOT NULL,
        city TEXT NOT NULL,
        district TEXT,
        grid_id TEXT,
        lng REAL NOT NULL,
        lat REAL NOT NULL,
        score REAL NOT NULL,
        score_population REAL,
        score_competition REAL,
        score_support REAL,
        score_transport REAL,
        population_density REAL,
        competitor_count INTEGER,
        poi_count INTEGER,
        address TEXT,
        status TEXT DEFAULT 'candidate',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    db.run(`CREATE INDEX IF NOT EXISTS idx_sc_city ON site_candidates(city)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_sc_score ON site_candidates(score DESC)`)
  } catch (e) {
    console.warn('创建评分相关表失败:', e.message)
  }

  // 门店评分表相关表
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS scoring_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS scoring_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER REFERENCES scoring_templates(id),
        dimension TEXT NOT NULL,
        name TEXT NOT NULL,
        data_source TEXT DEFAULT 'manual',
        max_score REAL NOT NULL DEFAULT 10,
        input_type TEXT DEFAULT 'score',
        options TEXT,
        sort_order INTEGER DEFAULT 0
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS store_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER REFERENCES scoring_templates(id),
        user_id INTEGER NOT NULL,
        store_id INTEGER,
        lng REAL NOT NULL,
        lat REAL NOT NULL,
        address TEXT,
        total_score REAL DEFAULT 0,
        premium INTEGER DEFAULT 0,
        status TEXT DEFAULT 'draft',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS score_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        score_id INTEGER REFERENCES store_scores(id),
        item_id INTEGER REFERENCES scoring_items(id),
        auto_value REAL,
        manual_value REAL,
        final_score REAL DEFAULT 0,
        remark TEXT
      )
    `)
    db.run(`CREATE INDEX IF NOT EXISTS idx_ss_user ON store_scores(user_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_sd_score ON score_details(score_id)`)

    // 插入默认餐饮模板
    const templateExists = db.prepare('SELECT id FROM scoring_templates WHERE name = ?').get('餐饮通用')
    if (!templateExists) {
      const insertTpl = db.prepare('INSERT INTO scoring_templates (name, category) VALUES (?, ?)')
      insertTpl.run(['餐饮通用', '餐饮'])
      const lastIdResult = db.exec('SELECT last_insert_rowid() as id')
      const templateId = lastIdResult[0]?.values[0]?.[0] || 1

      const items = [
        ['trade_area', '人口密度', 'smartsteps', 15, 'auto', null,  1],
        ['trade_area', '竞争强度', 'competitors', 15, 'auto', null,  2],
        ['trade_area', '配套丰富度', 'poi', 10, 'auto', null,  3],
        ['trade_area', '交通便利度', 'poi', 10, 'auto', null,  4],
        ['site', '可达性', 'manual', 10, 'score', null,  5],
        ['site', '可视性', 'manual', 10, 'score', null,  6],
        ['site', '门前客流(人/天)', 'manual', 10, 'number', null,  7],
        ['site', '月租金(元)', 'manual', 10, 'number', null,  8],
        ['site', '楼层位置', 'manual', 5, 'select', JSON.stringify([{label:'一楼',value:5},{label:'负一层',value:3},{label:'其他',value:1}]), 9],
        ['site', '停车便利度', 'manual', 5, 'select', JSON.stringify([{label:'方便',value:5},{label:'一般',value:3},{label:'困难',value:1}]), 10],
      ]

      const insertItem = db.prepare('INSERT INTO scoring_items (template_id, dimension, name, data_source, max_score, input_type, options, sort_order) VALUES (?,?,?,?,?,?,?,?)')
      items.forEach(item => insertItem.run([templateId, ...item]))
    }
  } catch (e) {
    console.warn('创建门店评分表失败:', e.message)
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
    
    // 执行SQL但不触发磁盘保存（用于批量操作）
    execNoSave: (sql) => {
      return db.exec(sql)
    },
    
    // 强制保存到磁盘
    saveNow: () => {
      saveDatabase()
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
