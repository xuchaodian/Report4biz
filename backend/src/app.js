import express from 'express'
import cors from 'cors'
import compression from 'compression'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import authRoutes from './routes/auth.js'
import markerRoutes from './routes/markers.js'
import competitorRoutes from './routes/competitors.js'
// 竞品期次快照（开关店监测）：必须先于 competitorRoutes 注册（/api/competitors 的 GET /:id 会吞掉 snapshots）
import competitorSnapshotRoutes from './routes/competitorSnapshots.js'
import userRoutes from './routes/users.js'
// VIP 试用申请与审批（v1.13.205）：/account「体验 VIP 用户」→ 管理员审核 → 30 天 trial
import vipApplicationRoutes from './routes/vipApplications.js'
// 配额采购申请单（v1.13.218）：配额不足 → 提交采购意向 → 内部邮件通知 ＋ 管理员受理
import quotaRequestRoutes from './routes/quotaRequests.js'
import feedbackRoutes from './routes/feedbacks.js'
import brandIconRoutes from './routes/brand-icons.js'
import brandStoreRoutes from './routes/brand-stores.js'
import shapefileRoutes from './routes/shapefiles.js'
import shoppingCenterRoutes from './routes/shopping-centers.js'
import { initDatabase, getDb, createTxScope } from './models/database.js'
import geocodeRoutes from './routes/geocode.js'
import aiRoutes from './routes/ai.js'
import poiRoutes from './routes/poi.js'
import smartstepsRoutes from './routes/smartsteps.js'
import purchaseRoutes from './routes/purchase.js'
import purchaseImportRoutes from './routes/purchase-import.js'
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
import districtsRoutes from './routes/districts.js'
import templateRoutes from './routes/template.js'
import orgsRoutes from './routes/orgs.js'
import syncRoutes from './routes/sync.js'
// v1.13.211：trial 到期自动降级属于「降权」⇒ 必须同时撤销该账号已签发 token，
// 否则旧 token 里的 role='trial' 还能按旧身份放行最长 7 天（详见 utils/vipRole.js）
import { bumpTokenVersion } from './utils/tokenAuth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

// 信任代理（获取真实客户端IP）
app.set('trust proxy', true)

// 响应压缩（v1.13.107 M4）：列表接口全量返回（markers 1900+ / competitors 8900+ / brand-stores 9200+ 行 JSON）
// 未压缩时单响应可达数 MB；gzip 后通常降到 ~10-15%，显著缩短弱网下的首屏拉取时间。
// 注意：必须排除 SSE（AI 流式 text/event-stream），否则压缩中间件会缓冲分块、破坏流式输出。
app.use(compression({
  filter: (req, res) => {
    const ct = res.getHeader('Content-Type')
    if (ct && String(ct).includes('text/event-stream')) return false
    return compression.filter(req, res)
  }
}))

// CORS 白名单（v1.13.105 S-M2）：仅放行前端站点与本地开发地址，杜绝任意站点在已登录态向 API 发跨域请求。
// 说明：非浏览器请求（curl / 服务端直连，无 Origin 头）不受 CORS 约束，正常放行（第三方 API 转售即此类）。
const ALLOWED_ORIGINS = [
  'https://mka-online.cn',
  'http://mka-online.cn',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true) // 无 Origin（非浏览器）放行
    cb(null, ALLOWED_ORIGINS.includes(origin)) // 非白名单 → 不带 CORS 头，浏览器拦截
  },
  credentials: true
}))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// 请求级事务上下文（S2/A3, v1.13.106）：ALS 隔离每请求 inTransaction，
// 防 async handler 的 await 间隙被并发请求覆盖事务标志；
// 请求结束若有未决事务（异常逃逸）自动回滚，杜绝毒化全局写盘抑制
app.use((req, res, next) => {
  const scope = createTxScope()
  res.on('close', () => scope.rollbackIfPending())
  scope.run(next)
})

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
    app.use('/api/competitors/snapshots', competitorSnapshotRoutes)
    app.use('/api/competitors', competitorRoutes)
    app.use('/api/users', userRoutes)
    // VIP 试用申请（普通用户提交 / 管理员审核）。⚠️ 独立前缀，避免与 /api/users/:id 的动态段相互吞并
    app.use('/api/vip-applications', vipApplicationRoutes)
    // 配额采购申请（用户提交 / 管理员受理）。⚠️ 同样独立前缀，避免与 /api/users/:id 动态段互吞
    app.use('/api/quota-requests', quotaRequestRoutes)
    app.use('/api/feedbacks', feedbackRoutes)
    app.use('/api/brand-icons', brandIconRoutes)
    app.use('/api/brand-stores', brandStoreRoutes)
    app.use('/api/shapefiles', shapefileRoutes)
    app.use('/api/shopping-centers', shoppingCenterRoutes)
    app.use('/api/geocode', geocodeRoutes)
    app.use('/api/ai', aiRoutes)
    app.use('/api/poi', poiRoutes)
    app.use('/api/smartsteps', smartstepsRoutes)
    // 外部联通 Excel 批量导入须先于 /api/purchase 注册（/import/* 不被 purchase 子路由吞）
    app.use('/api/purchase/import', purchaseImportRoutes)
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
    // v1.13.231（批次 231）：两族「隐藏功能」路由（/api/scoring、/api/store-scores）已
    //   **整体清理** —— v1.13.223 曾在此处把它们收紧为 admin-only，现连路由本身一并删除。
    //   依据：workbuddy过程文件/Report4biz_隐藏资产清理方案_20261016.md（重叠评审 ≈80%）
    //   ＋ 记忆附录①§6.61。
    //   ⛔ 恢复前必读该方案：恢复即重新暴露 R1（score-batch 单请求最坏 ¥1200），
    //      且前端 4 组件 / 后端 2 路由 / 引擎 / 6 张表均须从 git 历史取回。
    app.use('/api/districts', districtsRoutes)
    app.use('/api/template', templateRoutes)
    // 集团/子公司组织管理（v0.9 P0-B）：建集团、绑成员、我的组织（不含 quota 增减）
    // v0.10 批次 C：+ 管辖范围读写 + 城市互斥校验（scopeGuard）
    app.use('/api/orgs', orgsRoutes)
    // 数据同步（v0.10 批次 C 起：scope-options；批次 D 补 candidates/preview/commit/history）
    app.use('/api/sync', syncRoutes)

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
        // v1.13.211：降权必须同时撤销 token。先取出受影响账号（通常 0～几个）——
        // UPDATE 之后 role 已变，就再也无从知道该 bump 谁了。
        // 不做的话：到期用户库内 role='user'，但旧 token 里的 role='trial' 仍会在
        // TOKEN_TTL(7d) 内被按试用身份放行（与 PUT /:id 的降权漏洞同源）。
        const expired = db.prepare(`SELECT id FROM users WHERE role = 'trial' AND vip_until IS NOT NULL AND vip_until < ?`).all(today)
        if (expired.length === 0) return
        // ≥2 次写（1 次 UPDATE + N 次 bump）⇒ 包事务压成一次落盘（落盘铁律）
        db.beginTx()
        try {
          db.prepare(`UPDATE users SET role = 'user', vip_until = NULL WHERE role = 'trial' AND vip_until IS NOT NULL AND vip_until < ?`).run(today)
          for (const u of expired) bumpTokenVersion(db, u.id)
          db.commitTx()
        } catch (e) {
          try { db.rollbackTx() } catch (e2) { /* 事务已结束等情况忽略 */ }
          throw e
        }
        console.log(`[TrialExpire] ${expired.length} 个 VIP 试用已到期，自动降级为普通用户（并已撤销其登录态）`)
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
