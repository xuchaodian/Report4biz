import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import authRoutes from './routes/auth.js'
import markerRoutes from './routes/markers.js'
import userRoutes from './routes/users.js'
import { initDatabase } from './models/database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

// 中间件
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// 初始化数据库并启动服务器
async function start() {
  try {
    // 初始化数据库
    await initDatabase()

    // API路由
    app.use('/api/auth', authRoutes)
    app.use('/api/markers', markerRoutes)
    app.use('/api/users', userRoutes)

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
