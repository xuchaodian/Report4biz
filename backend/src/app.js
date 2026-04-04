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
import { initDatabase } from './models/database.js'
import geocodeRoutes from './routes/geocode.js'
import aiRoutes from './routes/ai.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

// 中间件
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

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

    // 健康检查
    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', message: 'GeoManager API is running' })
    })

    // 错误处理中间件
    app.use((err, req, res, next) => {
      console.error('Error:', err)
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
  } catch (error) {
    console.error('启动服务器失败:', error)
    process.exit(1)
  }
}

start()
