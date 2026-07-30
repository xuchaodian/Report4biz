import express from 'express'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { scoreLocation } from '../utils/scoringEngine.js'

const router = express.Router()

// === 评分模板管理 ===

// 获取所有模板
router.get('/templates', authenticate, (req, res) => {
  try {
    const db = getDb()
    const templates = db.prepare('SELECT * FROM scoring_templates ORDER BY id').all()
    res.json({ templates })
  } catch (error) {
    res.status(500).json({ message: '获取模板失败' })
  }
})

// 获取模板详情（含评分项）
router.get('/templates/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const template = db.prepare('SELECT * FROM scoring_templates WHERE id = ?').get(req.params.id)
    if (!template) return res.status(404).json({ message: '模板不存在' })
    const items = db.prepare('SELECT * FROM scoring_items WHERE template_id = ? ORDER BY sort_order').all(req.params.id)
    res.json({ template, items })
  } catch (error) {
    res.status(500).json({ message: '获取模板详情失败' })
  }
})

// === 门店评分 ===

// 创建评分（自动填充商圈特征）
router.post('/scores', authenticate, async (req, res) => {
  try {
    const { templateId, storeId, lng, lat, address, premium } = req.body
    if (!lng || lat === undefined) {
      return res.status(400).json({ message: '缺少坐标参数' })
    }

    const db = getDb()
    const template = db.prepare('SELECT * FROM scoring_templates WHERE id = ?').get(templateId || 1)
    if (!template) return res.status(404).json({ message: '模板不存在' })

    // 创建评分记录
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ message: '用户未认证' })

    // 直接使用 db.exec 插入（避免prepare/run的参���传递问题）
    const insertSql = `INSERT INTO store_scores (template_id, user_id, store_id, lng, lat, address, premium, status) VALUES (${template.id}, ${userId}, ${storeId || 'NULL'}, ${lng}, ${lat}, '${(address || '').replace(/'/g, "''")}', ${premium ? 1 : 0}, 'draft')`
    db.exec(insertSql)
    const lastIdResult = db.exec('SELECT last_insert_rowid() as id')
    const scoreId = lastIdResult[0]?.values?.[0]?.[0]
    console.log('[StoreScores] inserted id:', scoreId)

    // 获取评分���
    const items = db.prepare('SELECT * FROM scoring_items WHERE template_id = ? ORDER BY sort_order').all(template.id)

    // 自动计算商圈特征项
    const autoScores = await calcAutoScores(db, lng, lat, premium, req.user.id)

    // 创建评分明细（直接拼SQL避免参数传递问题）
    let totalScore = 0
    for (const item of items) {
      let autoVal = 'NULL'
      let finalScore = 0

      if (item.input_type === 'auto') {
        const aVal = autoScores[item.name]?.value
        autoVal = aVal !== null && aVal !== undefined ? aVal : 'NULL'
        finalScore = autoScores[item.name]?.score ?? 0
      }

      db.exec(`INSERT INTO score_details (score_id, item_id, auto_value, manual_value, final_score) VALUES (${scoreId}, ${item.id}, ${autoVal}, NULL, ${finalScore})`)
      totalScore += finalScore
    }

    // 更新总分
    db.exec(`UPDATE store_scores SET total_score = ${Math.round(totalScore)} WHERE id = ${scoreId}`)

    // 返回完整评分
    const details = db.prepare('SELECT * FROM score_details WHERE score_id = ?').all(scoreId)
    const score = db.prepare('SELECT * FROM store_scores WHERE id = ?').get(scoreId)

    res.status(201).json({ score, details, items })
  } catch (error) {
    console.error('创建评分失败:', error)
    res.status(500).json({ message: '创建评分失败: ' + error.message })
  }
})

// 更新评分（保存立地特征）
router.put('/scores/:id', authenticate, (req, res) => {
  try {
    const { details } = req.body
    const db = getDb()

    const score = db.prepare('SELECT * FROM store_scores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
    if (!score) return res.status(404).json({ message: '评分记录不存在' })

    // 更新手动填写的评分项
    const updateDetail = db.prepare('UPDATE score_details SET manual_value = ?, final_score = ?, remark = ? WHERE id = ? AND score_id = ?')
    const getItem = db.prepare('SELECT * FROM scoring_items WHERE id = ?')

    let totalScore = 0
    if (details && Array.isArray(details)) {
      for (const d of details) {
        const item = getItem.get(d.itemId)
        if (!item) continue

        let finalScore = d.manualValue ?? d.finalScore ?? 0

        // 特殊处理：租金合理性
        if (item.name === '月租金(元)') {
          finalScore = calcRentScore(d.manualValue, item.max_score)
        }

        const escaped = (v) => { if (v === null || v === undefined) return 'NULL'; return `'${String(v).replace(/'/g, "''")}'` }
        db.exec(`UPDATE score_details SET auto_value = ${escaped(d.autoValue)}, manual_value = ${escaped(d.manualValue)}, final_score = ${finalScore}, remark = ${escaped(d.remark || '')} WHERE id = ${d.id} AND score_id = ${score.id}`)
        totalScore += finalScore
      }
    }

    // 加上自动项的分数
    const autoDetails = db.prepare('SELECT sd.*, si.input_type FROM score_details sd JOIN scoring_items si ON sd.item_id = si.id WHERE sd.score_id = ? AND si.input_type = ?').all(score.id, 'auto')
    for (const ad of autoDetails) {
      totalScore += ad.final_score || 0
    }

    db.exec(`UPDATE store_scores SET total_score = ${Math.round(totalScore)}, status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ${score.id}`)

    const updatedScore = db.prepare('SELECT * FROM store_scores WHERE id = ?').get(score.id)
    const updatedDetails = db.prepare('SELECT * FROM score_details WHERE score_id = ?').all(score.id)
    res.json({ score: updatedScore, details: updatedDetails })
  } catch (error) {
    res.status(500).json({ message: '更新评分失败: ' + error.message })
  }
})

// 获取评分记录列表
router.get('/scores', authenticate, (req, res) => {
  try {
    const db = getDb()
    const scores = db.prepare(`
      SELECT s.*, t.name as template_name
      FROM store_scores s
      LEFT JOIN scoring_templates t ON s.template_id = t.id
      WHERE s.user_id = ?
      ORDER BY s.updated_at DESC
    `).all(req.user.id)
    res.json({ scores })
  } catch (error) {
    res.status(500).json({ message: '获取评分列表失败' })
  }
})

// 获取单个评分详情
router.get('/scores/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const score = db.prepare('SELECT * FROM store_scores WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
    if (!score) return res.status(404).json({ message: '评分不存在' })

    const items = db.prepare('SELECT si.*, sd.id as detail_id, sd.auto_value, sd.manual_value, sd.final_score, sd.remark FROM scoring_items si LEFT JOIN score_details sd ON si.id = sd.item_id AND sd.score_id = ? WHERE si.template_id = ? ORDER BY si.sort_order').all(score.id, score.template_id)

    res.json({ score, items })
  } catch (error) {
    res.status(500).json({ message: '获取评分详情失败' })
  }
})

// 删除评分
router.delete('/scores/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    db.exec(`DELETE FROM score_details WHERE score_id = ${req.params.id}`)
    db.exec(`DELETE FROM store_scores WHERE id = ${req.params.id} AND user_id = ${req.user.id}`)
    res.json({ message: '已删除' })
  } catch (error) {
    res.status(500).json({ message: '删除失败' })
  }
})

// === 辅助函数 ===

async function calcAutoScores(db, lng, lat, premium, userId) {
  const result = {}

  // 1. 人口密度（统一使用联通精算数据）
  try {
    // 调用智慧足迹API获取人口数据
    const smartstepsRes = await fetch(
      `http://localhost:3000/api/smartsteps/query-population?lng=${lng}&lat=${lat}`
    ).then(r => r.json()).catch(() => ({ total: null }))

    const smartPop = smartstepsRes.total || null
    if (smartPop) {
      const smartScore = Math.min(15, smartPop / 300)
      result['人口密度'] = { value: Math.round(smartPop), score: Math.round(smartScore) }
    } else {
      // 如果联通API不可用，使用默认值
      result['人口密度'] = { value: null, score: 5 }
    }
  } catch (_) {
    result['人口密度'] = { value: null, score: 5 }
  }

  // 2. 竞争强度
  try {
    const compCount = (db.prepare('SELECT COUNT(*) as cnt FROM competitors').get())?.cnt || 0
    const compScore = Math.min(15, Math.max(0, 15 - compCount))
    result['竞争强度'] = { value: compCount, score: Math.round(compScore) }
  } catch (_) {
    result['竞争强度'] = { value: null, score: 7 }
  }

  // 4. 配套丰富度 + 交通便利度
  try {
    const apiKey = '8e22ba2cec83bc554753a47842383949'
    const officeRes = await fetch(
      `https://restapi.amap.com/v3/place/around?key=${apiKey}&location=${lng},${lat}&radius=1000&types=050000&offset=20&page=1`
    ).then(r => r.json()).catch(() => ({ count: 0 }))

    const metroRes = await fetch(
      `https://restapi.amap.com/v3/place/around?key=${apiKey}&location=${lng},${lat}&radius=1000&types=150500&offset=20&page=1`
    ).then(r => r.json()).catch(() => ({ count: 0 }))

    const officeCount = parseInt(officeRes.count || 0)
    const metroCount = parseInt(metroRes.count || 0)

    result['配套丰富度'] = { value: officeCount, score: Math.min(10, Math.round(officeCount)) }
    result['交通便利度'] = { value: metroCount, score: Math.min(10, metroCount * 2) }
  } catch (_) {
    result['配套丰富度'] = { value: null, score: 5 }
    result['交通便利度'] = { value: null, score: 5 }
  }

  return result
}

function calcRentScore(rent, maxScore) {
  if (!rent || rent <= 0) return 0
  // 默认以 20000 元/月为基准，租金越低分越高
  if (rent <= 5000) return maxScore
  if (rent <= 10000) return Math.round(maxScore * 0.8)
  if (rent <= 20000) return Math.round(maxScore * 0.6)
  if (rent <= 30000) return Math.round(maxScore * 0.4)
  return Math.round(maxScore * 0.2)
}

export default router
