import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { scoreLocation, scoreBatch } from '../utils/scoringEngine.js'

const router = express.Router()

// 获取默认评分配置
router.get('/configs', authenticate, (req, res) => {
  try {
    const db = getDb()
    const configs = db.prepare('SELECT * FROM scoring_configs ORDER BY id').all()
    // 如果没有配置，创建默认配置
    if (configs.length === 0) {
      db.prepare(`
        INSERT INTO scoring_configs (name) VALUES ('默认配置')
      `).run()
      const defaultConfig = db.prepare('SELECT * FROM scoring_configs WHERE id = 1').get()
      return res.json({ configs: [defaultConfig] })
    }
    res.json({ configs })
  } catch (error) {
    console.error('获取评分配置失败:', error)
    res.status(500).json({ message: '获取配置失败' })
  }
})

// 保存评分配置
router.post('/configs', authenticate, (req, res) => {
  try {
    const { name, weightPopulation, weightCompetition, weightSupport, weightTransport, radiusKm, competitionThreshold } = req.body
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO scoring_configs (name, weight_population, weight_competition, weight_support, weight_transport, radius_km, competition_threshold)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name || '自定义配置',
      weightPopulation ?? 0.40,
      weightCompetition ?? 0.25,
      weightSupport ?? 0.20,
      weightTransport ?? 0.15,
      radiusKm ?? 1.0,
      competitionThreshold ?? 10
    )
    const config = db.prepare('SELECT * FROM scoring_configs WHERE id = ?').get(result)
    res.status(201).json({ config })
  } catch (error) {
    console.error('保存评分配置失败:', error)
    res.status(500).json({ message: '保存配置失败' })
  }
})

// 执行单点评分
router.post('/score-point', authenticate, async (req, res) => {
  try {
    const { lng, lat, radius, configId, city } = req.body
    if (!lng || lat === undefined) {
      return res.status(400).json({ message: '缺少坐标参数' })
    }

    // 获取评分配置
    let weights = { population: 0.40, competition: 0.25, support: 0.20, transport: 0.15 }
    let compThreshold = 10
    let radiusM = (radius || 1) * 1000

    if (configId) {
      const db = getDb()
      const config = db.prepare('SELECT * FROM scoring_configs WHERE id = ?').get(configId)
      if (config) {
        weights = {
          population: config.weight_population,
          competition: config.weight_competition,
          support: config.weight_support,
          transport: config.weight_transport
        }
        compThreshold = config.competition_threshold
        radiusM = Math.round((config.radius_km || 1) * 1000)
      }
    }

    const result = await scoreLocation({
      lng: parseFloat(lng),
      lat: parseFloat(lat),
      radius: radiusM,
      weights,
      competitionThreshold: compThreshold,
      city: city || '',
      user: req.user
    })

    res.json({ success: true, ...result })
  } catch (error) {
    console.error('评分失败:', error)
    res.status(500).json({ message: '评分失败: ' + error.message })
  }
})

// 批量评分
router.post('/score-batch', authenticate, async (req, res) => {
  try {
    const { grids, configId } = req.body
    if (!grids || !Array.isArray(grids) || grids.length === 0) {
      return res.status(400).json({ message: '缺少网格数据' })
    }

    let config = {
      weight_population: 0.40,
      weight_competition: 0.25,
      weight_support: 0.20,
      weight_transport: 0.15,
      radius_km: 1.0,
      competition_threshold: 10
    }

    if (configId) {
      const db = getDb()
      const saved = db.prepare('SELECT * FROM scoring_configs WHERE id = ?').get(configId)
      if (saved) config = saved
    }

    const results = await scoreBatch(grids, config, req.user)
    res.json({ success: true, total: results.length, candidates: results.slice(0, 50) })
  } catch (error) {
    console.error('批量评分失败:', error)
    res.status(500).json({ message: '评分失败: ' + error.message })
  }
})

// 保存候选点位
router.post('/candidates', authenticate, (req, res) => {
  try {
    const { candidates, configId } = req.body
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ message: '缺少候选数据' })
    }

    const db = getDb()
    const insert = db.prepare(`
      INSERT INTO site_candidates (config_id, user_id, city, district, grid_id, lng, lat, score,
        score_population, score_competition, score_support, score_transport,
        population_density, competitor_count, poi_count, address, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate')
    `)

    let saved = 0
    for (const c of candidates) {
      insert.run(
        configId || null, req.user.id,
        c.city || '', c.district || '', c.gridId || '',
        c.lng, c.lat, c.score || 0,
        c.scorePopulation, c.scoreCompetition, c.scoreSupport, c.scoreTransport,
        c.populationDensity, c.competitorCount, c.poiCount, c.address || ''
      )
      saved++
    }

    res.status(201).json({ message: `已保存 ${saved} 个候选点位` })
  } catch (error) {
    console.error('保存候选失败:', error)
    res.status(500).json({ message: '保存失败' })
  }
})

// 获取候选列表
router.get('/candidates', authenticate, (req, res) => {
  try {
    const { city, page = 1, size = 20, status } = req.query
    const db = getDb()

    let sql = 'SELECT * FROM site_candidates WHERE user_id = ?'
    const params = [req.user.id]

    if (city) { sql += ' AND city = ?'; params.push(city) }
    if (status) { sql += ' AND status = ?'; params.push(status) }

    // 总数
    const countResult = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) as total')).get(...params)
    const total = countResult?.total || 0

    // 分页
    const offset = (parseInt(page) - 1) * parseInt(size)
    sql += ' ORDER BY score DESC LIMIT ? OFFSET ?'
    params.push(parseInt(size), offset)

    const candidates = db.prepare(sql).all(...params)

    res.json({ candidates, total, page: parseInt(page), size: parseInt(size) })
  } catch (error) {
    console.error('获取候选列表失败:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 更新候选状态
router.put('/candidates/:id/status', authenticate, (req, res) => {
  try {
    const { status } = req.body
    if (!['candidate', 'saved', 'discarded'].includes(status)) {
      return res.status(400).json({ message: '无效的状态值' })
    }
    const db = getDb()
    db.prepare('UPDATE site_candidates SET status = ? WHERE id = ? AND user_id = ?').run(status, req.params.id, req.user.id)
    res.json({ message: '更新成功' })
  } catch (error) {
    console.error('更新候选状态失败:', error)
    res.status(500).json({ message: '更新失败' })
  }
})

// 删除候选
router.delete('/candidates/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    db.prepare('DELETE FROM site_candidates WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
    res.json({ message: '已删除' })
  } catch (error) {
    console.error('删除候选失败:', error)
    res.status(500).json({ message: '删除失败' })
  }
})

export default router
