import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import authRoutes from './routes/auth.js'
import markerRoutes from './routes/markers.js'
import competitorRoutes from './routes/competitors.js'
import userRoutes from './routes/users.js'
import brandIconRoutes from './routes/brand-icons.js'
import brandStoreRoutes from './routes/brand-stores.js'
import shapefileRoutes from './routes/shapefiles.js'
import shoppingCenterRoutes from './routes/shopping-centers.js'
import { initDatabase, getDb } from './models/database.js'
import geocodeRoutes from './routes/geocode.js'
import aiRoutes from './routes/ai.js'
import poiRoutes from './routes/poi.js'
import smartstepsRoutes from './routes/smartsteps.js'
import purchaseRoutes from './routes/purchase.js'
import streetviewRoutes from './routes/streetview.js'
import districtRoutes from './routes/district.js'
import tileProxyRoutes from './routes/tile-proxy.js'
import resaleRoutes, { adminRouter as resaleAdminRouter } from './routes/resale.js'
import dashboardRoutes from './routes/dashboard.js'
import cityDataRoutes from './routes/city-data.js'
import marketMapRoutes from './routes/market-map.js'
import storeSalesRoutes from './routes/store-sales.js'
import salesForecastRoutes from './routes/sales-forecast.js'
import mallTenantsRoutes from './routes/mall-tenants.js'
import scoringRoutes from './routes/scoring.js'
import districtsRoutes from './routes/districts.js'
import storeScoresRoutes from './routes/store-scores.js'
import templateRoutes from './routes/template.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

// 信任代理（获取真实客户端IP）
app.set('trust proxy', true)

// 中间件
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// 静态文件服务 - 品牌图标上传目录
app.use('/uploads/brand-icons', express.static(join(__dirname, '../uploads/brand-icons')))

// 初始化数据库并启动服务器
async function start() {
  try {
    // 初始化数据库
    await initDatabase()

    // API路由
    app.use('/api/auth', authRoutes)
    app.use('/api/markers', markerRoutes)
    app.use('/api/competitors', competitorRoutes)
    app.use('/api/users', userRoutes)
    app.use('/api/brand-icons', brandIconRoutes)
    app.use('/api/brand-stores', brandStoreRoutes)
    app.use('/api/shapefiles', shapefileRoutes)
    app.use('/api/shopping-centers', shoppingCenterRoutes)
    app.use('/api/geocode', geocodeRoutes)
    app.use('/api/ai', aiRoutes)
    app.use('/api/poi', poiRoutes)
    app.use('/api/smartsteps', smartstepsRoutes)
    app.use('/api/purchase', purchaseRoutes)
    app.use('/api/streetview', streetviewRoutes)
    app.use('/api/district', districtRoutes)
    app.use('/api/tile-proxy', tileProxyRoutes)
    // 转售 API（第三方调用联通人口数据，X-Api-Key 认证）
    app.use('/api/v1/population', resaleRoutes)
    app.use('/api/v1/resale', resaleAdminRouter)
    app.use('/api/dashboard', dashboardRoutes)
    app.use('/api/city-data', cityDataRoutes)
    app.use('/api/market-map', marketMapRoutes)
    app.use('/api/store-sales', storeSalesRoutes)
    app.use('/api/sales-forecast', salesForecastRoutes)
    app.use('/api/mall-tenants', mallTenantsRoutes)
    app.use('/api/scoring', scoringRoutes)
    app.use('/api/districts', districtsRoutes)
    app.use('/api/store-scores', storeScoresRoutes)
    app.use('/api/template', templateRoutes)

    // 健康检查
    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', message: 'GeoManager API is running' })
    })

    // 错误处理中间件
    app.use((err, req, res, next) => {
      console.error('Error:', err)
      // multer 文件大小超限
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: '文件大小超过限制（最大 5MB），请拆分后上传' })
      }
      res.status(err.status || 500).json({
        message: err.message || '服务器内部错误'
      })
    })

    // 启动服务器
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════╗
║   选址赢家Online Backend Server          ║
║   运行在 http://localhost:${PORT}             ║
╚════════════════════════════════════════════╝
      `)
    })

    // ===== VIP 试用到期自动降级（每 6 小时检查一次）=====
    // 角色为 trial 且 vip_until 已过 → 自动切换为普通用户（role=user, vip_until 清空）
    setInterval(() => {
      try {
        const db = getDb()
        const today = new Date().toISOString().slice(0, 10)
        const r = db.prepare(`UPDATE users SET role = 'user', vip_until = NULL WHERE role = 'trial' AND vip_until IS NOT NULL AND vip_until < ?`).run(today)
        if (r.changes > 0) {
          console.log(`[TrialExpire] ${r.changes} 个 VIP 试用已到期，自动降级为普通用户`)
        }
      } catch (e) {
        console.error('[TrialExpire] 检查失败:', e.message)
      }
    }, 6 * 3600 * 1000)
  } catch (error) {
    console.error('启动服务器失败:', error)
    process.exit(1)
  }
}

start()
