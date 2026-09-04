import express from 'express'
import crypto from 'crypto'
import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { buildSummaryValues, summaryValue } from '../utils/unicomSummaryValues.js'
import { UNICOM_SUMMARY_COLS } from '../utils/unicomSummaryCols.js'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const router = express.Router()
const SHARE_SECRET = 'Report4biz_share_2026'

// 封装 child_process.exec 为 Promise（批量导出复用）
const runExec = (cmd, timeout = 30000) => new Promise((resolve, reject) => {
  exec(cmd, { timeout, maxBuffer: 1024 * 1024 * 100 }, (err, stdout, stderr) => {
    if (err) return reject(err)
    resolve({ stdout, stderr })
  })
})

/**
 * 获取用户配额信息
 */
router.get('/quota', authenticate, (req, res) => {
  try {
    const db = getDb()
    const user = db.prepare('SELECT id, username, quota FROM users WHERE id = ?').get(req.user.id)
    
    if (!user) {
      return res.status(404).json({ message: '用户不存在' })
    }
    
    // 计算已使用的配额（当前，仅 active）
    const usedResult = db.prepare(`
      SELECT COALESCE(SUM(quota_used), 0) as used
      FROM purchases
      WHERE user_id = ? AND status = 'active'
    `).get(req.user.id)

    // 累计已使用（含软删除的 inactive 记录）
    const cumUsedResult = db.prepare(`
      SELECT COALESCE(SUM(quota_used), 0) as used
      FROM purchases
      WHERE user_id = ?
    `).get(req.user.id)

    // 累计分配（净购买 = 所有变化的代数和：购买+，退款-）
    const cumResult = db.prepare(`
      SELECT COALESCE(SUM(change_amount), 0) as cum
      FROM quota_history WHERE user_id = ?
    `).get(req.user.id)
    const cumulativeTotal = cumResult?.cum || (user.quota || 0)

    // 获取运营商当前剩余配额
    const quotaRecord = db.prepare(`SELECT initial_quota, remaining_quota FROM admin_quota WHERE id = 1`).get()
    const initialQuota = quotaRecord?.initial_quota || 0
    const remainingQuota = quotaRecord?.remaining_quota || 0
    
    res.json({
      total: user.quota || 0,  // 当前配额（管理员最近一次设定值）
      cumulativeTotal,  // 累计分配（净购买：购买+，退款-）
      used: usedResult?.used || 0,  // 当前已使用（active）
      cumulativeUsed: cumUsedResult?.used || 0,  // 累计已使用（含软删除）
      available: (user.quota || 0) - (usedResult?.used || 0),  // 用户剩余次数（仅展示用）
      initialQuota,  // 初始总配额
      remainingQuota  // 运营商当前剩余配额
    })
  } catch (error) {
    console.error('获取配额失败:', error)
    res.status(500).json({ message: '获取配额失败' })
  }
})

/**
 * 获取用户配额分配履历（管理员分配/退款记录）
 */
router.get('/quota-history', authenticate, (req, res) => {
  try {
    const db = getDb()
    const history = db.prepare(`
      SELECT id, old_quota, new_quota, change_amount, action, created_at
      FROM quota_history
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(req.user.id)
    res.json({ history })
  } catch (error) {
    console.error('获取配额履历失败:', error)
    res.status(500).json({ message: '获取配额履历失败' })
  }
})

/**
 * 购买配额（此接口已停用，配额需通过管理员从联通购买）
 */
router.post('/buy', authenticate, (req, res) => {
  try {
    // 此接口已停用，用户配额需通过管理员分配
    res.status(403).json({ 
      message: '配额购买功能已停用，请联系管理员从运营商购买配额后分配给您' 
    })
  } catch (error) {
    console.error('购买配额失败:', error)
    res.status(500).json({ message: '操作失败' })
  }
})

/**
 * 使用配额查询
 * 请求体: {
 *   centerLng, centerLat, radius,
 *   services: string[],
 *   cityMonth: string,
 *   quotaUsed: number  // 本次消耗的配额
 * }
 */
router.post('/use', authenticate, (req, res) => {
  try {
    const { centerLng, centerLat, radius, services, cityMonth, quotaUsed, resultData } = req.body
    
    if (quotaUsed === undefined || quotaUsed < 0) {
      return res.status(400).json({ message: '请提供正确的配额消耗数量' })
    }
    
    const db = getDb()
    
    // 检查运营商当前剩余配额是否足够
    const quotaRecord = db.prepare(`SELECT remaining_quota FROM admin_quota WHERE id = 1`).get()
    const available = quotaRecord?.remaining_quota || 0
    
    if (available < quotaUsed) {
      return res.status(400).json({
        message: `运营商剩余配额不足，需要 ${quotaUsed} 次，当前剩余 ${available} 次。请联系管理员追加配额。`
      })
    }
    
    // 创建购买记录
    const result = db.prepare(`
      INSERT INTO purchases (
        user_id, center_lng, center_lat, radius,
        city_month, services, quota_used, status, result_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      req.user.id,
      centerLng,
      centerLat,
      radius,
      cityMonth || '',
      JSON.stringify(services),
      quotaUsed,
      resultData ? JSON.stringify(resultData) : null
    )
    
    // 扣减运营商当前剩余配额
    db.prepare(`UPDATE admin_quota SET remaining_quota = remaining_quota - ? WHERE id = 1`).run(quotaUsed)
    
    // 获取更新后的配额
    const newQuotaRecord = db.prepare(`SELECT initial_quota, remaining_quota FROM admin_quota WHERE id = 1`).get()
    
    res.json({
      message: '查询成功',
      purchaseId: result.lastInsertRowid,
      quotaUsed,
      initialQuota: newQuotaRecord?.initial_quota || 0,
      remainingQuota: newQuotaRecord?.remaining_quota || 0
    })
  } catch (error) {
    console.error('使用配额失败:', error)
    res.status(500).json({ message: '操作失败' })
  }
})

/**
 * 获取购买历史（静态路由必须在 /:id 之前）
 */
router.get('/history', authenticate, (req, res) => {
  try {
    const db = getDb()

    // 获取用户总配额
    const user = db.prepare('SELECT quota FROM users WHERE id = ?').get(req.user.id)
    const totalQuota = user?.quota || 0

    // 查询购买记录，关联门店表获取城市/区县/门店编号，并计算当日流水号
    const purchases = db.prepare(`
      SELECT
        p.id,
        p.store_name,
        p.store_type,
        p.center_lng,
        p.center_lat,
        p.radius,
        p.city_month,
        p.quota_used,
        p.created_at,
        m.city,
        m.district,
        m.store_code,
        substr(p.created_at, 1, 10) as order_date,
        (SELECT COUNT(*) FROM purchases p2
          WHERE p2.user_id = p.user_id AND p2.status = 'active'
            AND substr(p2.created_at, 1, 10) = substr(p.created_at, 1, 10)
            AND p2.id <= p.id) as day_seq
      FROM purchases p
      LEFT JOIN markers m ON m.name = p.store_name AND m.user_id = p.user_id
      WHERE p.user_id = ? AND p.status = 'active'
      ORDER BY p.created_at DESC
      LIMIT 500
    `).all(req.user.id)

    // 计算每笔订单购买后的剩余配额
    // SQL 是 ORDER BY created_at DESC（倒序），需要按时间正序计算后再反转
    const orderedPurchases = [...purchases].reverse()
    let cumulativeUsed = 0
    const orderedRemaining = orderedPurchases.map(p => {
      cumulativeUsed += p.quota_used || 0
      return totalQuota - cumulativeUsed
    })
    // 反转回来，与 SQL 倒序一致
    orderedRemaining.reverse()

    const formatted = purchases.map((p, idx) => {
      // 订单编号 = 门店编号 + 日期(YYYYMMDD) + 当日流水(3位)
      const dateStr = String(p.order_date || '').replace(/-/g, '')
      const seqStr = String(p.day_seq || 0).padStart(3, '0')
      const order_no = `${p.store_code || p.store_name || 'XXXX'}${dateStr}${seqStr}`
      return {
        id: p.id,
        order_no,
        store_name: p.store_name || '-',
        store_type: p.store_type || '-',
        center_lng: p.center_lng,
        center_lat: p.center_lat,
        radius: p.radius,
        city_month: p.city_month,
        quota_used: p.quota_used || 0,
        remaining: orderedRemaining[idx],  // 该订单购买后的剩余配额
        created_at: p.created_at,
        // 优先使用门店表的地址，如果没有则显示坐标
        city: p.city || '-',
        district: p.district || '-',
        location: (p.city || p.district) ? `${p.city || ''}${p.district || ''}`.replace(/^,|,$/g, '') : '-'
      }
    })

    // 解析半径显示
    const enriched = formatted.map(p => {
      let radiusDisplay = p.radius
      try {
        const radii = JSON.parse(p.radius)
        if (Array.isArray(radii)) {
          radiusDisplay = radii.map(r => r + '米').join(', ')
        }
      } catch (e) {}
      if (typeof radiusDisplay === 'number') {
        radiusDisplay = radiusDisplay + ' 米'
      }
      return {
        ...p,
        radius_display: radiusDisplay
      }
    })

    res.json({ purchases: enriched })
  } catch (error) {
    console.error('获取历史失败:', error)
    res.status(500).json({ message: '获取历史失败' })
  }
})

/**
 * 批量获取门店购买次数（一次查询所有门店）
 */
router.get('/store-counts', authenticate, (req, res) => {
  try {
    const db = getDb()

    // 查询所有门店的购买次数与最近数据年月（按 store_name 分组，city_month 为 YYYYMM 字符串可排序取 MAX）
    const counts = db.prepare(`
      SELECT 
        store_name,
        COUNT(*) as count,
        MAX(city_month) as latest_city_month
      FROM purchases
      WHERE user_id = ? AND status = 'active' AND store_name IS NOT NULL AND store_name != ''
      GROUP BY store_name
    `).all(req.user.id)

    // 转换为 {门店名称: {count, latest_city_month}} 的格式
    const result = {}
    counts.forEach(item => {
      result[item.store_name] = {
        count: item.count,
        latest_city_month: item.latest_city_month || null
      }
    })

    res.json({ counts: result })
  } catch (error) {
    console.error('获取门店购买次数失败:', error)
    res.status(500).json({ message: '获取失败' })
  }
})

/**
 * 按门店名称查询购买履历
 */
router.get('/by-store/:storeName', authenticate, (req, res) => {
  try {
    const { storeName } = req.params
    const db = getDb()

    const purchases = db.prepare(`
      SELECT
        p.id,
        p.store_name,
        p.store_type,
        p.center_lng,
        p.center_lat,
        p.radius,
        p.city_month,
        p.quota_used,
        p.created_at,
        m.city,
        m.district
      FROM purchases p
      LEFT JOIN markers m ON m.name = p.store_name AND m.user_id = p.user_id
      WHERE p.user_id = ? AND p.store_name = ? AND p.status = 'active'
      ORDER BY p.created_at DESC
    `).all(req.user.id, storeName)

    res.json({ purchases })
  } catch (error) {
    console.error('获取门店购买履历失败:', error)
    res.status(500).json({ message: '获取失败' })
  }
})

/**
 * 批量导出为 ZIP 压缩包（无地图截图，单文件下载，避免浏览器多下载拦截）
 * GET /api/purchase/export-batch?ids=1,2,3&type=excel|pdf|both
 * 复用 export_excel.py 逐条生成 xlsx；type 含 pdf 时再 libreoffice 转 PDF；最后 python zipfile 打包成 zip 一次返回
 */
router.get('/export-batch', authenticate, async (req, res) => {
  const rawIds = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean)
  const ids = rawIds.filter(id => /^\d+$/.test(id))
  const type = ['excel', 'pdf', 'both'].includes(req.query.type) ? req.query.type : 'excel'

  if (ids.length === 0) {
    return res.status(400).json({ message: '未提供有效的记录 ID' })
  }
  if (ids.length > 200) {
    return res.status(400).json({ message: '单次批量导出上限 200 条' })
  }

  const templatePath = join(__dirname, '../../uploads/templates/report_template.xlsx')
  const dbPath = join(__dirname, '../../database/webgis.db')
  const scriptPath = join(__dirname, '../../export_excel.py')
  if (!fs.existsSync(templatePath)) {
    return res.status(400).json({ message: '报表模板不存在，请联系管理员上传模板' })
  }

  const db = getDb()
  const tmpDir = join(__dirname, '../../uploads/screenshots', `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  const loProfile = `/tmp/lo_${process.pid}_${Date.now()}`
  const outFiles = []
  let skipped = 0

  try {
    for (const id of ids) {
      const row = db.prepare('SELECT store_name, radii, city_month FROM purchases WHERE id = ? AND user_id = ?').get(Number(id), req.user.id)
      if (!row) { skipped++; continue }
      const safeName = String(row.store_name || '门店').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
      let radiiStr = '未知'
      try {
        const arr = JSON.parse(row.radii)
        radiiStr = (Array.isArray(arr) ? arr : [arr]).map(Number).filter(Number.isFinite).join('_')
      } catch (e) { /* 保持默认 */ }
      const cityMonth = row.city_month || ''
      const base = `${safeName}_${radiiStr}米_${cityMonth}`.slice(0, 120)
      const xlsxPath = join(tmpDir, `${base}.xlsx`)

      try {
        await runExec(`python3 "${scriptPath}" "${templatePath}" "${xlsxPath}" "${dbPath}" ${id} ${req.user.id}`, 40000)
      } catch (e) {
        console.error(`[批量导出] id=${id} Excel 生成失败:`, e.message)
        skipped++
        continue
      }
      if (!fs.existsSync(xlsxPath)) { skipped++; continue }
      outFiles.push(xlsxPath)

      if (type === 'pdf' || type === 'both') {
        const pdfPath = join(tmpDir, `${base}.pdf`)
        try {
          await runExec(`libreoffice --headless --convert-to pdf --outdir "${tmpDir}" -env:UserInstallation=file://${loProfile} "${xlsxPath}"`, 60000)
        } catch (e) {
          console.error(`[批量导出] id=${id} PDF 转换失败:`, e.message)
        }
        if (fs.existsSync(pdfPath)) outFiles.push(pdfPath)
      }
    }

    if (outFiles.length === 0) {
      return res.status(500).json({ message: '导出失败：未生成任何文件' })
    }

    const zipName = `导出报表_${ids.length}条_${new Date().toISOString().slice(0, 10)}.zip`
    const zipPath = join(tmpDir, zipName)
    const pyCmd = `python3 -c "import zipfile,os,sys; z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED); [z.write(f, os.path.basename(f)) for f in sys.argv[2:]]; z.close(); print('ZIP_OK')" "${zipPath}" ${outFiles.map(f => `"${f}"`).join(' ')}`
    await runExec(pyCmd, 120000)

    if (!fs.existsSync(zipPath)) {
      return res.status(500).json({ message: '打包失败：压缩文件未生成' })
    }

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`)
    const stream = fs.createReadStream(zipPath)
    stream.pipe(res)
    stream.on('end', () => fs.rm(tmpDir, { recursive: true, force: true }, () => {}))
    stream.on('error', () => fs.rm(tmpDir, { recursive: true, force: true }, () => {}))
  } catch (e) {
    fs.rm(tmpDir, { recursive: true, force: true }, () => {})
    console.error('[批量导出] 异常:', e)
    if (!res.headersSent) res.status(500).json({ message: '批量导出失败: ' + e.message })
  }
})

/**
 * 获取单个购买记录详情（包含查询结果）
 */
router.get('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDb()

    const purchase = db.prepare(`
      SELECT
        p.*,
        m.city,
        m.district
      FROM purchases p
      LEFT JOIN markers m ON m.name = p.store_name AND m.user_id = p.user_id
      WHERE p.id = ? AND p.user_id = ? AND p.status = 'active'
    `).get(id, req.user.id)

    if (!purchase) {
      return res.status(404).json({ message: '记录不存在' })
    }

    // 解析 result_data
    let resultData = null
    if (purchase.result_data) {
      try {
        resultData = JSON.parse(purchase.result_data)
        // 过滤掉 1016 服务的条目
        if (Array.isArray(resultData)) {
          resultData = resultData.filter(item => item.service_code !== '1016' && item.service_code !== 1016)
        } else if (resultData && typeof resultData === 'object') {
          delete resultData['1016']
        }
      } catch (e) {
        resultData = purchase.result_data
      }
    }

    // 解析半径
    let radii = []
    try {
      radii = JSON.parse(purchase.radius)
    } catch (e) {
      radii = [purchase.radius]
    }

    res.json({
      id: purchase.id,
      store_name: purchase.store_name,
      store_type: purchase.store_type,
      center_lng: purchase.center_lng,
      center_lat: purchase.center_lat,
      radii: radii,
      city_month: purchase.city_month,
      quota_used: purchase.quota_used,
      created_at: purchase.created_at,
      city: purchase.city,
      district: purchase.district,
      result_data: resultData
    })
  } catch (error) {
    console.error('获取详情失败:', error)
    res.status(500).json({ message: '获取详情失败' })
  }
})

/**
 * 生成分享Token（需登录）
 */
router.get('/:id/share-token', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDb()
    const purchase = db.prepare(`SELECT id FROM purchases WHERE id = ? AND user_id = ?`).get(id, req.user.id)
    if (!purchase) return res.status(404).json({ message: '记录不存在' })
    
    const hash = crypto.createHmac('sha256', SHARE_SECRET).update(String(id)).digest('hex').slice(0, 16)
    const shareUrl = `${req.protocol}://${req.get('host')}/shared/purchase?id=${id}&token=${hash}`
    res.json({ shareUrl, token: hash })
  } catch (error) {
    console.error('生成分享token失败:', error)
    res.status(500).json({ message: '生成分享链接失败' })
  }
})

/**
 * 公开分享接口（使用Token验证，免登录）
 */
router.get('/shared/:id', (req, res) => {
  try {
    const { id } = req.params
    const { token } = req.query
    if (!token) return res.status(403).json({ message: '缺少访问令牌' })
    
    const hash = crypto.createHmac('sha256', SHARE_SECRET).update(String(id)).digest('hex').slice(0, 16)
    if (hash !== token) return res.status(403).json({ message: '访问令牌无效' })
    
    const db = getDb()
    const purchase = db.prepare(`
      SELECT id, store_name, store_type, center_lng, center_lat, radius, city_month, quota_used, created_at, result_data, status
      FROM purchases WHERE id = ? AND status = 'active'
    `).get(id)
    
    if (!purchase) return res.status(404).json({ message: '记录不存在或已失效' })
    
    // 解析半径
    let radii = []
    try { radii = JSON.parse(purchase.radius) } catch (e) { radii = [purchase.radius] }
    
    // 解析result_data(脱敏处理 - 只保留聚合数据)
    let resultData = null
    if (purchase.result_data) {
      try { resultData = JSON.parse(purchase.result_data) } catch (e) { resultData = null }
    }
    
    res.json({
      purchase: {
        id: purchase.id,
        store_name: purchase.store_name,
        store_type: purchase.store_type,
        radii,
        city_month: purchase.city_month,
        created_at: purchase.created_at,
        result_data: resultData
      }
    })
  } catch (error) {
    console.error('获取分享数据失败:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

/**
 * 删除购买记录（释放配额）
 */
router.delete('/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDb()
    
    // 检查记录是否存在且属于当前用户
    const purchase = db.prepare(`
      SELECT * FROM purchases WHERE id = ? AND user_id = ?
    `).get(id, req.user.id)
    
    if (!purchase) {
      return res.status(404).json({ message: '记录不存在' })
    }
    
    // 软删除（改为inactive状态）
    db.prepare(`
      UPDATE purchases SET status = 'inactive' WHERE id = ?
    `).run(id)
    
    res.json({ message: '已删除' })
  } catch (error) {
    console.error('删除记录失败:', error)
    res.status(500).json({ message: '删除失败' })
  }
})

/**
 * 获取购买记录周边的竞品门店（用于导出地图截图）
 * GET /api/purchase/:id/competitors-for-map
 */
router.get('/:id/competitors-for-map', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDb()
    const purchase = db.prepare(`SELECT center_lng, center_lat FROM purchases WHERE id = ? AND user_id = ?`).get(id, req.user.id)
    if (!purchase) return res.status(404).json({ message: '记录不存在' })

    const competitors = db.prepare(`SELECT id, name, brand, latitude, longitude, address FROM competitors WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND user_id = ? AND (status IS NULL OR status NOT IN ('店铺已关','尚未营业'))`).all(req.user.id)

    res.json({
      center: { lat: purchase.center_lat, lng: purchase.center_lng },
      radius: 3000,
      competitors: competitors.map(c => ({
        id: c.id, name: c.name, brand: c.brand || '',
        latitude: c.latitude, longitude: c.longitude, address: c.address || ''
      }))
    })
  } catch (error) {
    console.error('获取竞品地图数据失败:', error)
    res.status(500).json({ message: error.message })
  }
})

/**
 * 获取购买记录周边的购物中心（用于导出地图截图）
 * GET /api/purchase/:id/shopping-centers-for-map
 */
router.get('/:id/shopping-centers-for-map', authenticate, (req, res) => {
  try {
    const { id } = req.params
    const db = getDb()
    const purchase = db.prepare(`SELECT center_lng, center_lat FROM purchases WHERE id = ? AND user_id = ?`).get(id, req.user.id)
    if (!purchase) return res.status(404).json({ message: '记录不存在' })

    const centers = db.prepare(`SELECT id, name, latitude, longitude, address FROM shopping_centers WHERE latitude IS NOT NULL AND longitude IS NOT NULL`).all()

    res.json({
      center: { lat: purchase.center_lat, lng: purchase.center_lng },
      centers: centers.map(c => ({
        id: c.id, name: c.name,
        latitude: c.latitude, longitude: c.longitude, address: c.address || ''
      }))
    })
  } catch (error) {
    console.error('获取购物中心地图数据失败:', error)
    res.status(500).json({ message: error.message })
  }
})

// 导出Excel报表（不带截图，回退方案）
router.get('/:id/export-excel', authenticate, (req, res) => {
  const dbPath = join(__dirname, '../../database/webgis.db')
  const templatePath = join(__dirname, '../../uploads/templates/report_template.xlsx')
  const outputPath = join(__dirname, '../../uploads/screenshots', `export_${req.params.id}_${Date.now()}.xlsx`)

  if (!fs.existsSync(templatePath)) {
    return res.status(400).json({ message: '报表模板不存在，请联系管理员上传模板' })
  }

  const scriptPath = join(__dirname, '../../export_excel.py')
  const cmd = `python3 "${scriptPath}" "${templatePath}" "${outputPath}" "${dbPath}" ${req.params.id} ${req.user.id}`

  exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
    if (error) {
      console.error('导出Excel执行错误:', error.message)
      return res.status(500).json({ message: '导出失败: ' + error.message })
    }

    try {
      const lines = stdout.trim().split('\n')
      const jsonLine = lines.filter(l => l.trim().startsWith('{')).pop() || '{}'
      const result = JSON.parse(jsonLine)
      if (result.error) {
        return res.status(500).json({ message: result.error })
      }

      if (!fs.existsSync(outputPath)) {
        return res.status(500).json({ message: '导出失败: 输出文件未生成' })
      }

      const fileName = result.filename || `${req.params.id}.xlsx`
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)

      const fileStream = fs.createReadStream(outputPath)
      fileStream.pipe(res)
      fileStream.on('end', () => {
        fs.unlink(outputPath, () => {})
      })
    } catch (e) {
      console.error('解析Python输出失败:', stdout)
      res.status(500).json({ message: '导出失败: ' + e.message })
    }
  })
})

// 导出Excel报表（带竞品地图截图 + 购物中心地图截图）
router.post('/:id/export-map-excel', authenticate, async (req, res) => {
  const { competitorScreenshot, shoppingCenterScreenshot, mapScreenshot } = req.body
  const dbPath = join(__dirname, '../../database/webgis.db')
  const templatePath = join(__dirname, '../../uploads/templates/report_template.xlsx')
  const outputPath = join(__dirname, '../../uploads/screenshots', `export_${req.params.id}_${Date.now()}.xlsx`)

  if (!fs.existsSync(templatePath)) {
    return res.status(400).json({ message: '报表模板不存在，请联系管理员上传模板' })
  }

  const screenshotDir = join(__dirname, '../../uploads/screenshots')
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true })

  const saveScreenshot = (base64Str, prefix) => {
    if (!base64Str) return null
    try {
      const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, '')
      const buf = Buffer.from(base64Data, 'base64')
      if (buf.length < 100) return null
      const fpath = join(screenshotDir, `${prefix}_${req.params.id}_${Date.now()}.png`)
      fs.writeFileSync(fpath, buf)
      console.log(`[导出截图] 已保存 ${prefix}: ${fpath} (${buf.length}字节)`)
      return fpath
    } catch (e) {
      console.error(`[导出截图] 保存${prefix}失败:`, e)
      return null
    }
  }

  const compPath = saveScreenshot(competitorScreenshot, 'competitor')
  const shopPath = saveScreenshot(shoppingCenterScreenshot, 'shopping')
  const mapPath = saveScreenshot(mapScreenshot, 'map')

  const scriptPath = join(__dirname, '../../export_excel.py')
  let cmd = `python3 "${scriptPath}" "${templatePath}" "${outputPath}" "${dbPath}" ${req.params.id} ${req.user.id}`
  if (compPath) cmd += ` "${compPath}"`
  if (shopPath) cmd += ` "${shopPath}"`
  if (mapPath) cmd += ` "${mapPath}"`

  exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
    const cleanUp = (fp) => { if (fp) try { fs.unlinkSync(fp) } catch (e) {} }
    cleanUp(compPath)
    cleanUp(shopPath)
    cleanUp(mapPath)

    if (error) {
      console.error('导出Excel执行错误:', error.message)
      return res.status(500).json({ message: '导出失败: ' + error.message })
    }

    try {
      const lines = stdout.trim().split('\n')
      const jsonLine = lines.filter(l => l.trim().startsWith('{')).pop() || '{}'
      const result = JSON.parse(jsonLine)
      if (result.error) {
        return res.status(500).json({ message: result.error })
      }

      if (!fs.existsSync(outputPath)) {
        return res.status(500).json({ message: '导出失败: 输出文件未生成' })
      }

      const fileName = result.filename || `${req.params.id}.xlsx`
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)

      const fileStream = fs.createReadStream(outputPath)
      fileStream.pipe(res)
      fileStream.on('end', () => {
        fs.unlink(outputPath, () => {})
      })
    } catch (e) {
      console.error('解析Python输出失败:', stdout)
      res.status(500).json({ message: '导出失败: ' + e.message })
    }
  })
})

// 导出PDF报表：生成Excel后转换为PDF
router.post('/:id/export-pdf-report', authenticate, async (req, res) => {
  const { competitorScreenshot, shoppingCenterScreenshot, mapScreenshot } = req.body
  const dbPath = join(__dirname, '../../database/webgis.db')
  const templatePath = join(__dirname, '../../uploads/templates/report_template.xlsx')
  const ts = Date.now()
  const excelPath = join(__dirname, '../../uploads/screenshots', `pdf_export_${req.params.id}_${ts}.xlsx`)
  const pdfPath = join(__dirname, '../../uploads/screenshots', `pdf_export_${req.params.id}_${ts}.pdf`)

  if (!fs.existsSync(templatePath)) {
    return res.status(400).json({ message: '报表模板不存在' })
  }

  const screenshotDir = join(__dirname, '../../uploads/screenshots')
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true })

  const saveScreenshot = (base64Str, prefix) => {
    if (!base64Str) return null
    try {
      const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, '')
      const buf = Buffer.from(base64Data, 'base64')
      if (buf.length < 100) return null
      const fpath = join(screenshotDir, `${prefix}_${req.params.id}_${ts}.png`)
      fs.writeFileSync(fpath, buf)
      return fpath
    } catch (e) {
      return null
    }
  }

  const compPath = saveScreenshot(competitorScreenshot, 'competitor')
  const shopPath = saveScreenshot(shoppingCenterScreenshot, 'shopping')
  const mapPath = saveScreenshot(mapScreenshot, 'map')

  const scriptPath = join(__dirname, '../../export_excel.py')
  let cmd = `python3 "${scriptPath}" "${templatePath}" "${excelPath}" "${dbPath}" ${req.params.id} ${req.user.id}`
  if (compPath) cmd += ` "${compPath}"`
  if (shopPath) cmd += ` "${shopPath}"`
  if (mapPath) cmd += ` "${mapPath}"`

  const cleanUp = (fp) => { if (fp) try { fs.unlinkSync(fp) } catch (e) {} }

  exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
    cleanUp(compPath)
    cleanUp(shopPath)
    cleanUp(mapPath)

    if (error) {
      cleanUp(excelPath)
      return res.status(500).json({ message: 'Excel生成失败: ' + error.message })
    }

    // 用LibreOffice将Excel转为PDF
    const pdfCmd = `libreoffice --headless --convert-to pdf --outdir "${screenshotDir}" "${excelPath}"`
    exec(pdfCmd, { timeout: 30000 }, (pdfErr, pdfStdout, pdfStderr) => {
      cleanUp(excelPath)

      if (pdfErr) {
        console.error('PDF转换失败:', pdfErr.message)
        return res.status(500).json({ message: 'PDF转换失败: ' + pdfErr.message })
      }

      if (!fs.existsSync(pdfPath)) {
        return res.status(500).json({ message: 'PDF文件未生成' })
      }

      const storeName = req.body.filename || '报表'
      const fileName = `${storeName}.pdf`
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)

      const fileStream = fs.createReadStream(pdfPath)
      fileStream.pipe(res)
      fileStream.on('end', () => {
        cleanUp(pdfPath)
      })
    })
  })
})

// ================= 批量购买结果合并导出 Excel（内容 = 查询结果详情页） =================
// ===== 批量购买结果 → 单 sheet 汇总宽表（纵向=门店×半径，横向=模板「商圈数据」343 指标） =====
// 入参 { stores:[{name,lng,lat}], radii:[米], cityMonth } → xlsx：
//   A1=「门店 / 半径」标签列头；B1.. = 343 指标含义（模板顺序）；数据行 A 列=「门店名半径Xm/km」
// 数值口径 = 按「成品服务码」分区精确取值（unicomSummaryValues），修正 export_excel.py 同字段名覆盖 BUG：
//   1009 消费力/1010 教育/1011 行业/1012 人生/1013 综合消费各区取各自真实数据（旧报表四区被 1013 污染）
// 数据源 = 购买履历 purchases.result_data（不重新调联通 API，不消耗配额）
const parseStoredRadii = (raw) => {
  try {
    const p = JSON.parse(raw)
    return Array.isArray(p) ? p.map(Number) : [Number(p)]
  } catch (e) {
    return [Number(raw)].filter(n => Number.isFinite(n))
  }
}

// 行标签：与用户参照样式一致（500m / 1.5km / 3km 式）
const radiusLabel = (name, R) => {
  const r = Number(R)
  const unit = r >= 1000 ? `${r % 1000 === 0 ? String(r / 1000) : String(Number((r / 1000).toFixed(2)))}km` : `${r}m`
  return `${name}半径${unit}`
}

router.post('/export-merged', authenticate, (req, res) => {
  try {
    const { stores, radii, cityMonth } = req.body || {}
    if (!Array.isArray(stores) || stores.length === 0) return res.status(400).json({ message: '缺少门店列表' })
    if (!Array.isArray(radii) || radii.length === 0) return res.status(400).json({ message: '缺少半径档位' })
    if (!cityMonth) return res.status(400).json({ message: '缺少数据年月' })

    const db = getDb()
    const colCount = UNICOM_SUMMARY_COLS.length
    const rows = [['门店 / 半径', ...UNICOM_SUMMARY_COLS.map(c => c.m)]]
    let combos = 0, matched = 0, empty = 0

    for (const store of stores) {
      const name = String(store?.name || '').trim()
      if (!name) continue
      const purchases = db.prepare(`
        SELECT id, store_name, center_lng, center_lat, radius, city_month, created_at, result_data
        FROM purchases
        WHERE user_id = ? AND store_name = ? AND status = 'active'
        ORDER BY created_at DESC
      `).all(req.user.id, name)

      for (const r of radii) {
        const R = Number(r)
        if (!Number.isFinite(R) || R <= 0) continue
        combos++
        // 半径 + 月份匹配（radius 存 JSON 数组，如 '[500]'；旧版可能逗号串/多半径）
        const match = purchases.find(p =>
          p.city_month === cityMonth && parseStoredRadii(p.radius).some(x => Math.abs(x - R) <= 1)
        )

        if (!match) {
          empty++
          rows.push([`${radiusLabel(name, R)}(无购买记录)`, ...new Array(colCount).fill(null)])
          continue
        }
        const byCode = buildSummaryValues(match.result_data)
        const hasAny = Object.keys(byCode).some(k => Object.keys(byCode[k]).length > 0)
        if (!hasAny) {
          empty++
          rows.push([`${radiusLabel(name, R)}(无数据)`, ...new Array(colCount).fill(null)])
          continue
        }
        matched++
        rows.push([radiusLabel(name, R), ...UNICOM_SUMMARY_COLS.map(c => summaryValue(byCode, c.c, c.f))])
      }
    }

    if (rows.length === 1) return res.status(400).json({ message: '没有可导出的门店组合' })

    // SheetJS 组装（表头灰底粗体居中，指标列定宽 12；A 列行标签 20）
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const headerStyle = {
      font: { name: '微软雅黑', bold: true, sz: 10 },
      fill: { patternType: 'solid', fgColor: { rgb: 'D9E1F2' } },
      alignment: { vertical: 'center', horizontal: 'center', wrapText: true }
    }
    for (let c = 0; c < rows[0].length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c })
      if (ws[addr]) ws[addr].s = headerStyle
    }
    ws['!cols'] = [{ wch: 20 }, ...UNICOM_SUMMARY_COLS.map(() => ({ wch: 12 }))]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '门店×指标汇总')
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true })

    const fileName = `批量购买_${cityMonth}_${stores.length}店${radii.length}半径_汇总.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    res.end(buffer)
    console.log(`[purchase] export-merged OK combos=${combos} matched=${matched} empty=${empty} cols=${colCount + 1} buffer=${(buffer.length / 1024 / 1024).toFixed(2)}MB`)
  } catch (error) {
    console.error('批量导出失败:', error)
    res.status(500).json({ message: '批量导出失败: ' + error.message })
  }
})

export default router
