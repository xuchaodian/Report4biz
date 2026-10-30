import express from 'express'
import multer from 'multer'
import Papa from 'papaparse'
import fs from 'fs'
import { readCsvText } from '../utils/csvEncoding.js'
import { getDb } from '../models/database.js'
import { authenticate } from '../middleware/auth.js'
import { parsePaging } from '../utils/paging.js'
import { buildStoreCheckup } from '../utils/storeCheckup.js'
// v1.13.297 红黄绿灯：几何/计数/评分一律复用商圈洞察那三份 util（⛔ 不许自写第二套）
import { buildStoreLights } from '../utils/storeLights.js'
import { getGeoObject } from '../models/geoStore.js'
import { normalizeDistrictProps, dstr } from '../utils/districtProps.js'
import { readableUserIds } from '../utils/visibleScope.js'
import { computeScore } from '../utils/districtScore.js'
import { countCompetitorsInDistrict, countMyStoresInDistrict } from '../utils/districtCount.js'
import { fillCityFallback, loadCityReferencePool } from '../utils/syncCore.js'
// 只读锁已抽到 utils/syncLock.js（批次 E 供 competitors 复用，避免两处漂移）
import { blockedBySyncLock } from '../utils/syncLock.js'
import { findStoreDuplicates, distanceMeters, normalizeBrand, looksLikeDualFormat, storeCodeOf, storeAreaOf } from '../utils/storeDedup.js'

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// 获取所有门店（只看自己的数据）
// M4（v1.13.107）：支持可选分页（?limit=&offset=&total=1）；不传 limit 时维持原「全量返回」语义
// ——地图图层依赖全量坐标，管理端表格可显式传 limit 分页。
router.get('/', authenticate, (req, res) => {
  try {
    const db = getDb()
    const { limit, offset, wantTotal } = parsePaging(req.query)

    // 每个用户只看自己的门店数据
    // v1.13.283：排除已被合并的重复行（merged_into 非空）—— 否则"合并"等于没合并
    let sql = `SELECT * FROM markers WHERE user_id = ? AND merged_into IS NULL ORDER BY created_at DESC`
    const params = [req.user.id]
    if (limit) {
      sql += ` LIMIT ? OFFSET ?`
      params.push(limit, offset)
    }
    const markers = db.prepare(sql).all(...params)

    const payload = { markers }
    if (wantTotal) {
      payload.total = db.prepare(`SELECT COUNT(*) AS c FROM markers WHERE user_id = ? AND merged_into IS NULL`).get(req.user.id)?.c || 0
    }
    res.json(payload)
  } catch (error) {
    console.error('获取门店列表错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// ============================================================================
// 门店清洗 · 重复组检查（v1.13.282 立，v1.13.288 更名「门店清洗」）
// GET /api/markers/duplicates?epsM=50&nearM=300
//
// ⚠️ 必须定义在 `GET /:id` **之前** —— 否则 `/api/markers/duplicates` 会被
//    `/:id` 抢先匹配，把 "duplicates" 当成 id 去查，直接 404。这是本文件最经典的坑。
//
// 口径：只扫**自己名下**的门店（清洗要落到写操作，而写路径恒为 WHERE user_id = 自己）。
//      集团 owner 看子公司台账的清洗不在本接口范围。
// 🔴 去重与蚕食**只在同一品牌内判定**（同账号多品牌、同商场双品牌同址是常态），
//    详见 utils/storeDedup.js 顶部说明。
// 🔴🔴 「同品牌 ≤50m」**不等于重复**（v1.13.289）：youshi 233 条里 13 组同址门店编码全不同、
//    面积比 2.3~6.3 倍 ⇒ 是同一商场的大店 + 小店。为此每组带 `kind` 与 `mergeable`，
//    双店型 `mergeable=false`，/merge 侧另有二次拦截（见下）。
// 纯本地几何计算，**不消耗联通配额**。
// ============================================================================
router.get('/duplicates', authenticate, (req, res) => {
  try {
    const db = getDb()
    const epsM = Number(req.query.epsM)
    const nearM = Number(req.query.nearM)
    const rows = db.prepare(`
      SELECT id, name, brand, store_code, city, district, address,
             longitude, latitude, status, store_area
        FROM markers
       WHERE user_id = ? AND merged_into IS NULL
    `).all(req.user.id)

    const result = findStoreDuplicates(rows, {
      epsM: Number.isFinite(epsM) ? epsM : undefined,
      nearM: Number.isFinite(nearM) ? nearM : undefined
    })

    res.json({
      success: true,
      ...result,
      note: result.stats.truncated
        ? `门店数超过 ${50000} 条，已跳过计算（请按城市分批）`
        : '仅在同一品牌内判定；跨品牌同址不报。候选组已定性：duplicate=编码相同（可合并）/ dualFormat=大店+小店（禁合并）/ suspected=需人工'
    })
  } catch (error) {
    console.error('[Markers] 门店清洗（重复检查）失败:', error)
    res.status(500).json({ message: '门店清洗检查失败，请稍后重试' })
  }
})

// ============================================================================
// 门店位置体检（v1.13.291）
// GET /api/markers/checkup?nearM=300&page=1&pageSize=50
//
// 只算**本人**门店（WHERE user_id）—— ⛔ 刻意不走集团可见域放大：
//   体检是「我这批门店布局有没有问题」的自我检查，混进子公司的店会让人误判自己的结构。
//   与「门店清洗」同口径（那里也只扫 WHERE user_id）。
//
// 🔴 统计口径：⛔ 必须 `merged_into IS NULL`（已合并的行不算独立门店）。
// 🔴 路由**必须定义在 `GET /:id` 之前**，否则 '/checkup' 会被当成 id 命中。
// ⭐ 纯本地几何计算 + 一次聚合查询，**不消耗联通/高德任何配额** ⇒ 可全免费。
// ============================================================================
router.get('/checkup', authenticate, (req, res) => {
  try {
    const db = getDb()
    const userId = req.user.id
    const nearM = Math.min(Math.max(Number(req.query.nearM) || 300, 10), 5000)
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 10), 200)

    // ⚠️ `sync_readonly` 必须一起取：完备度里要把「集团下发只读、本账号改不了」的家数单独数出来
    const stores = db.prepare(
      `SELECT id, name, brand, store_code, store_area, latitude, longitude,
              city, address, store_type, store_category, sync_readonly
         FROM markers
        WHERE user_id = ? AND merged_into IS NULL`
    ).all(userId)

    const result = buildStoreCheckup(stores, { nearM })

    // 完备度：销售记录数决定「上面这些结构结论能推多远」
    const salesRows = db.prepare(
      `SELECT COUNT(*) c FROM store_sales s
         JOIN markers m ON s.store_id = m.id AND m.merged_into IS NULL
        WHERE m.user_id = ?`
    ).get(userId).c

    const categoryEmpty = stores.filter((s) => !String(s.store_category || '').trim()).length
    // 🔴 品类为空的店里，集团下发的只读镜像行**本账号改不了**（要在集团侧补）。
    //   不单独计数的话，体检页说「11 家为空」、批量补品类弹窗说「待补 10 家」——
    //   客户会以为少了 1 家、反复找（v1.13.294 真机对出来的口径差）。
    const categoryEmptyReadonly = stores.filter(
      (s) => !String(s.store_category || '').trim() && Number(s.sync_readonly) === 1
    ).length

    const start = (page - 1) * pageSize
    res.json({
      success: true,
      nearM,
      counts: result.counts,
      bucketCounts: result.bucketCounts,
      medianNearestM: result.medianNearestM,
      medianBasis: result.medianBasis,
      noNeighbor: result.noNeighbor,
      areaBuckets: result.areaBuckets,
      completeness: {
        salesRows,
        categoryEmpty,
        categoryEmptyReadonly,
        areaMissing: result.counts.noArea,
        coordMissing: result.counts.noCoord
      },
      pairsTotal: result.pairs.length,
      page,
      pageSize,
      pairs: result.pairs.slice(start, start + pageSize),
      note: '仅本人门店；跨品牌同址不参与判定；同址组可能是「同一商场两套店型」，不构成合并建议'
    })
  } catch (error) {
    console.error('[Markers] 门店体检失败:', error)
    res.status(500).json({ message: '门店体检计算失败，请稍后重试' })
  }
})

// ============================================================================
// 门店体检 · 商圈信号灯（v1.13.297）
// GET /api/markers/checkup/lights?top=200
//
// 四条规则（阈值与实测见 `Report4biz_免费门店体检_规则与实测_20261028.md`）：
//   ① 竞争密集 = 所在商圈竞争宽松度 ≤35                +3
//   ② 自我蚕食 = 同一商圈内**本人**门店 2~3 家 +2 / ≥4 家 +3
//   ③ 客群偏离 = 所在商圈客群占本品牌门店客群构成 <20%  +2
//   ④ 覆盖盲区 = 城市有商圈面但门店不在面内 ⇒ **无法评估**（不评分、不算低风险）
//
// 🔴 口径同源（⛔ 不许在本文件重写一份）：
//   · 落圈判定 = utils/geoPoint.js（与商圈洞察同一套射线法）
//   · 竞争宽松度 = utils/districtScore.js::computeScore（同一份评分）
//   · 竞品/自有计数 = utils/districtCount.js（同一份 SQL + 同一个 60s 缓存）
//   ⇒ 否则会出现「商圈洞察显示 55 分、体检说竞争密集」，客户第一反应就是系统乱算。
//
// 🔴 城市没有商圈面数据 ⇒ 归 noCityData，**不算盲区** ——
//   那是我们的数据覆盖问题，不是客户的选址问题（混进去就等于自证平台没用）。
//
// ⚠️ 只算本人门店（WHERE user_id），与 /checkup、门店清洗同口径。
// ============================================================================
router.get('/checkup/lights', authenticate, (req, res) => {
  try {
    const db = getDb()
    const userId = req.user.id
    const top = Math.min(Math.max(parseInt(req.query.top, 10) || 200, 10), 1000)

    const stores = db.prepare(
      `SELECT id, name, brand, city, store_type, store_category,
              latitude, longitude
         FROM markers
        WHERE user_id = ? AND merged_into IS NULL`
    ).all(userId)

    // 有商圈面的城市（shapefiles 文件名形如「上海商圈」）
    const cityOf = (v) => String(v || '').replace(/市$/, '').replace(/商圈|区域|\.zip/g, '').trim()
    const files = db.prepare(`SELECT id, name FROM shapefiles WHERE category = 'other'`).all()
    const fileByCity = new Map()
    for (const f of files) {
      const c = cityOf(f.name)
      if (!c) continue
      if (!fileByCity.has(c)) fileByCity.set(c, [])
      fileByCity.get(c).push(f.id)
    }

    // 只加载「我有门店的城市」的商圈面（⛔ 不要全量加载 20 城 2394 个面）
    const myCities = Array.from(new Set(stores.map(s => cityOf(s.city)).filter(Boolean)))
    const coveredCities = myCities.filter(c => fileByCity.has(c))
    const uncoveredCities = myCities.filter(c => !fileByCity.has(c))

    const districts = []
    if (coveredCities.length) {
      const scopeIds = readableUserIds(db, userId)
      for (const city of coveredCities) {
        for (const fileId of fileByCity.get(city)) {
          const geojson = getGeoObject(fileId)
          if (!geojson || !Array.isArray(geojson.features)) continue
          for (const feature of geojson.features) {
            if (!feature.geometry) continue
            // 276 起字段名整代更换：必须先归一再取数，否则评分静默归零
            const props = normalizeDistrictProps(feature.properties || {})
            const compCount = countCompetitorsInDistrict(feature.geometry, scopeIds)
            const myCount = countMyStoresInDistrict(feature.geometry, scopeIds)
            const scores = computeScore(props, compCount, myCount)
            districts.push({
              name: props['名称'] || '未命名商圈',
              city,
              level: dstr(props, '能级'),
              crowd: dstr(props, '客群'),
              geometry: feature.geometry,
              scoreCompetition: scores.scoreCompetition
            })
          }
        }
      }
    }

    const result = buildStoreLights({
      stores,
      districts,
      opts: { coveredCities: new Set(coveredCities) }
    })

    res.json({
      success: true,
      total: result.total,
      evaluated: result.evaluated,
      blind: result.blind,
      noCityData: result.noCityData,
      noCoord: result.noCoord,
      byLevel: result.byLevel,
      rules: result.rules,
      crowdBaseline: result.crowdBaseline,
      thresholds: result.thresholds,
      districtCount: result.districtCount,
      cityCoverage: { covered: coveredCities, uncovered: uncoveredCities },
      // 🔴 两类**分别**截断：已评估的按风险排、未评估的也各自占 top 额度。
      //   若统一 slice(0, top)，233 家店里前 200 全是已评估 ⇒ 界面上勾了「含无法评估（37 家）」
      //   却只冒出 4 家，等于说了个数却拿不出名单（v1.13.297 真机发现）。
      lightsTotal: result.lights.length,
      top,
      lights: [
        ...result.lights.filter(l => l.status === 'evaluated').slice(0, top),
        ...result.lights.filter(l => l.status !== 'evaluated').slice(0, top)
      ],
      note: '仅本人门店；盲区＝无法评估（⛔ 不等于低风险）；城市无商圈面数据的不计入盲区；本次未消耗任何配额'
    })
  } catch (error) {
    console.error('[Markers] 门店体检信号灯失败:', error)
    res.status(500).json({ message: '门店体检信号灯计算失败，请稍后重试' })
  }
})

// ============================================================================
// 合并重复门店（v1.13.283）
// POST /api/markers/merge { keepId, mergeIds:[...], epsM?:50 }
// POST /api/markers/unmerge { ids:[...] }   ← 撤销合并（回滚）
//
// 🔴 软删：只写 merged_into 指向保留行，**不删行** ⇒ 可撤销。
//    ⇒ 因此所有统计/分析类查询都要加 `merged_into IS NULL`（见各路由），
//      而单行读取/更新/删除**不能加**，否则撤销不了。
// 🔴 拒绝跨品牌合并：同账号多品牌、同商场双品牌同址是常态，合并掉就是删了客户真实的一家店。
// 🔴 有销售记录的门店**拒绝合并**（409）：合并后它的销售会挂在一个隐藏行上，
//    等于让客户的历史数据再也录不进去。宁可不合并，也不做隐性数据丢失。
// ============================================================================
router.post('/merge', authenticate, (req, res) => {
  try {
    const db = getDb()
    const keepId = Number(req.body?.keepId)
    const mergeIds = [...new Set((Array.isArray(req.body?.mergeIds) ? req.body.mergeIds : [])
      .map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    const epsM = Number(req.body?.epsM) > 0 ? Number(req.body.epsM) : 50

    if (!Number.isInteger(keepId) || keepId <= 0) return res.status(400).json({ message: '缺少 keepId' })
    if (mergeIds.length === 0) return res.status(400).json({ message: '缺少 mergeIds' })
    if (mergeIds.includes(keepId)) return res.status(400).json({ message: 'keepId 不能同时出现在 mergeIds 里' })

    const ids = [keepId, ...mergeIds]
    const ph = ids.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT id, name, brand, store_code, store_area, longitude, latitude, merged_into
        FROM markers WHERE user_id = ? AND id IN (${ph})
    `).all(req.user.id, ...ids)
    if (rows.length !== ids.length) {
      return res.status(404).json({ message: '部分门店不存在，或不属于当前账号' })
    }

    const keep = rows.find((r) => r.id === keepId)
    if (keep.merged_into) {
      return res.status(400).json({ message: '要保留的这条门店本身已被合并到别处，请先撤销' })
    }
    const keepBrand = normalizeBrand(keep.brand)
    if (!keepBrand) {
      return res.status(400).json({ message: '要保留的门店品牌为空，无法确认同品牌，请先补品牌' })
    }

    const problems = []
    for (const id of mergeIds) {
      const s = rows.find((r) => r.id === id)
      if (s.merged_into) { problems.push(`「${s.name}」已被合并过`); continue }
      if (normalizeBrand(s.brand) !== keepBrand) {
        problems.push(`「${s.name}」品牌不同（${s.brand || '空'} ≠ ${keep.brand || '空'}）`)
        continue
      }
      const dist = distanceMeters(keep, s)
      if (dist > epsM) problems.push(`「${s.name}」距离 ${Math.round(dist)}m，超过 ${epsM}m 阈值`)

      // 🔴🔴 双店型二次拦截（v1.13.289）：UI 已不给这类组合并入口，但接口必须自己拒绝 ——
      //   编码不同 + 面积比 ≥2 ⇒ 同一商场的大店 + 小店，合并掉就是删掉客户真实一家店。
      if (looksLikeDualFormat(keep, s)) {
        const kc = storeCodeOf(keep) || '空'
        const sc = storeCodeOf(s) || '空'
        const ka = storeAreaOf(keep)
        const sa = storeAreaOf(s)
        problems.push(
          `「${s.name}」与「${keep.name}」是同一商场的两个店型（编码 ${kc} / ${sc}，面积 ${ka}㎡ / ${sa}㎡），` +
          '不是重复录入；如确认是同一家店，请先核对编码与面积再合并'
        )
      }
    }
    if (problems.length) {
      return res.status(400).json({ message: '合并被拒绝：' + problems.join('；'), problems })
    }

    // 销售记录保护：有销售行 ⇒ 拒绝（避免隐性数据丢失）
    const salesPh = mergeIds.map(() => '?').join(',')
    const sales = db.prepare(`
      SELECT store_id, COUNT(*) AS n FROM store_sales
       WHERE user_id = ? AND store_id IN (${salesPh}) GROUP BY store_id
    `).all(req.user.id, ...mergeIds)
    if (sales.length) {
      const detail = sales.map((s) => `id ${s.store_id}（${s.n} 条）`).join('、')
      return res.status(409).json({
        message: `这些门店已有销售记录，合并后其历史销售将挂在隐藏行上、无法再录入：${detail}。请先处理销售记录再合并。`
      })
    }

    db.beginTx()
    try {
      const upd = db.prepare(`
        UPDATE markers SET merged_into = ?, merged_at = datetime('now'), updated_at = datetime('now')
         WHERE user_id = ? AND id = ?
      `)
      for (const id of mergeIds) upd.run(keepId, req.user.id, id)
      // 🔴 必须 touch 保留行：商圈计数的缓存版本取自 MAX(updated_at) FROM markers，
      //    不 touch 就会命中旧缓存，合并后竞争分仍是旧值
      db.prepare(`UPDATE markers SET updated_at = datetime('now') WHERE id = ?`).run(keepId)
      db.commitTx()
    } catch (txErr) {
      try { db.rollbackTx() } catch (_) { /* 忽略 */ }
      throw txErr
    }

    res.json({
      success: true,
      keepId,
      keepName: keep.name,
      mergedCount: mergeIds.length,
      message: `已把 ${mergeIds.length} 条重复门店合并到「${keep.name}」（可撤销）`
    })
  } catch (error) {
    console.error('[Markers] 合并门店失败:', error)
    res.status(500).json({ message: '合并门店失败' })
  }
})

router.post('/unmerge', authenticate, (req, res) => {
  try {
    const db = getDb()
    const raw = Array.isArray(req.body?.ids) ? req.body.ids : (req.body?.id ? [req.body.id] : [])
    const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    if (ids.length === 0) return res.status(400).json({ message: '缺少 ids' })

    const ph = ids.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT id, name, merged_into FROM markers
       WHERE user_id = ? AND merged_into IS NOT NULL AND id IN (${ph})
    `).all(req.user.id, ...ids)
    if (rows.length === 0) {
      return res.status(404).json({ message: '这些门店没有处于合并状态，或不属于当前账号' })
    }

    const parentIds = [...new Set(rows.map((r) => r.merged_into).filter(Boolean))]
    db.beginTx()
    try {
      const clear = db.prepare(`
        UPDATE markers SET merged_into = NULL, merged_at = NULL, updated_at = datetime('now')
         WHERE user_id = ? AND id = ?
      `)
      for (const r of rows) clear.run(req.user.id, r.id)
      const touch = db.prepare(`UPDATE markers SET updated_at = datetime('now') WHERE id = ?`)
      for (const pid of parentIds) touch.run(pid)
      db.commitTx()
    } catch (txErr) {
      try { db.rollbackTx() } catch (_) { /* 忽略 */ }
      throw txErr
    }

    res.json({ success: true, restored: rows.length, message: `已撤销 ${rows.length} 条合并` })
  } catch (error) {
    console.error('[Markers] 撤销合并失败:', error)
    res.status(500).json({ message: '撤销合并失败' })
  }
})

// ============================================================================
// 批量补「门店区分」（v1.13.294）
//
// 起因：体检页的「门店区分」一栏常年 232/233 为空 —— 单店编辑弹窗里的下拉**选项来自
//   已有数据的去重**（stores/marker.js::storeCategories 是写死的 8 个选址形态，
//   但真正填过的店极少），客户要补 200 多家只能一家一家点。
//
// 语义：store_category 是**选址形态**（社区店/临街店/商场店/写字楼店/交通枢纽店/
//   校园店/景区店/专业市场店），⛔ 不是「业态」（菜系品类）。它只在销售预测的
//   typeMatchScore 里作为一个加分项参与 L3/L4 参照店匹配，填了更准、不填也能算。
//
// 🔴 三条约束：
//   ① 只能改自己名下的行（`user_id = ?`），且必须 `merged_into IS NULL`；
//   ② 集团下发的**只读镜像行**（`sync_readonly = 1`）跳过并在结果里报数，
//      ⛔ 不整批 403 —— 批量里混着几十家镜像行，一刀切拒绝用户会无从下手；
//      但若目标**全是**只读行，则按单店语义返回 403；
//   ③ 品类值**不允许为空**：本接口只用于「补」，不做清空
//      （清空走单店编辑，避免一次误操作把 200 家刷成空）。
// ============================================================================
router.post('/bulk-category', authenticate, (req, res) => {
  try {
    const { ids, storeCategory } = req.body || {}
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: '请先选择门店' })
    }
    if (ids.length > 500) {
      return res.status(400).json({ message: `一次最多 500 家（当前 ${ids.length} 家），请分批提交` })
    }
    const cat = String(storeCategory ?? '').trim()
    if (!cat) return res.status(400).json({ message: '门店区分不能为空' })
    if (cat.length > 20) return res.status(400).json({ message: '门店区分名称过长（最多 20 字）' })

    const uniq = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    if (uniq.length === 0) return res.status(400).json({ message: '门店 ID 无效' })

    const db = getDb()
    const ph = uniq.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT id, name, store_category, sync_readonly, origin_owner, origin_user_id
         FROM markers
        WHERE id IN (${ph}) AND user_id = ? AND merged_into IS NULL`
    ).all(...uniq, req.user.id)

    const readonlyRows = rows.filter((r) => Number(r.sync_readonly) === 1)
    const writableIds = rows.filter((r) => Number(r.sync_readonly) !== 1).map((r) => r.id)
    const untouched = uniq.filter((id) => !rows.some((r) => r.id === id))   // 不存在/非本人/已合并

    if (writableIds.length === 0) {
      if (readonlyRows.length > 0) {
        const owner = String(readonlyRows[0].origin_owner || '').trim() || `账号 #${readonlyRows[0].origin_user_id}`
        return res.status(403).json({
          code: 'sync_readonly',
          message: `所选门店均由「${owner}」同步维护，不能在此修改。如需本地改动，请先「脱离同步」。`,
          readonly: true
        })
      }
      return res.status(404).json({ message: '所选门店不存在或无权修改' })
    }

    // 只改差异行：已经是目标值的跳过，避免无意义地刷新 updated_at（会让增量同步误报变更）
    const needIds = rows
      .filter((r) => Number(r.sync_readonly) !== 1 && String(r.store_category || '').trim() !== cat)
      .map((r) => r.id)
    let updated = 0
    if (needIds.length > 0) {
      const ph2 = needIds.map(() => '?').join(',')
      // 单个写点，无需事务
      const info = db.prepare(
        `UPDATE markers SET store_category = ?, updated_at = datetime('now')
          WHERE id IN (${ph2}) AND user_id = ? AND merged_into IS NULL
            AND (sync_readonly IS NULL OR sync_readonly <> 1)`
      ).run(cat, ...needIds, req.user.id)
      updated = info.changes || 0
      db.saveNow && db.saveNow()
    }

    res.json({
      success: true,
      storeCategory: cat,
      updated,
      unchanged: writableIds.length - needIds.length,
      skippedReadonly: readonlyRows.length,
      notFound: untouched.length,
      message: updated > 0
        ? `已把 ${updated} 家门店的门店区分设为「${cat}」`
        : '所选门店的门店区分已经是该值，无需修改'
    })
  } catch (error) {
    console.error('[Markers] 批量补门店区分失败:', error)
    res.status(500).json({ message: '批量修改失败' })
  }
})

// 获取单个门店（只看自己的）
router.get('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()
    const marker = db.prepare('SELECT * FROM markers WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)

    if (!marker) {
      return res.status(404).json({ message: '门店不存在' })
    }

    res.json({ marker })
  } catch (error) {
    console.error('获取门店详情错误:', error)
    res.status(500).json({ message: '获取数据失败' })
  }
})

// 创建门店
router.post('/', authenticate, (req, res) => {
  try {
    const {
      store_code, brand, name, store_type,
      city, district, address,
      open_date, business_hours, store_area, seats, frontage,
      store_category, store_status, mall_type, trade_area_type, description,
      latitude, longitude, icon_color
    } = req.body

    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: '门店名称和坐标不能为空' })
    }

    const db = getDb()

    // 城市兜底（规则 13）：city 留空 → 按坐标反查补全，否则该行无法被管辖范围圈定
    const cityFix = fillCityFallback(db, { city, latitude, longitude })

    const result = db.prepare(`
      INSERT INTO markers (
        store_code, brand, name, store_type,
        city, district, address,
        open_date, business_hours, store_area, seats, frontage,
        store_category, store_status, mall_type, trade_area_type, description,
        latitude, longitude, status, icon_color, user_id, city_source,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      store_code || '', brand || '', name, store_type || '已开业',
      cityFix.city || '', district || '', address || '',
      open_date || '', business_hours || '', store_area || null, seats || null, frontage || null,
      store_category || '', store_status || '', mall_type || '', trade_area_type || '', description || '',
      latitude, longitude, '正常', icon_color || '#409eff', req.user.id, cityFix.city_source || null
    )

    const marker = db.prepare('SELECT * FROM markers WHERE id = ?').get(result.lastInsertRowid)

    res.status(201).json({
      message: '添加成功',
      marker
    })
  } catch (error) {
    console.error('创建门店错误:', error)
    res.status(500).json({ message: '添加失败' })
  }
})

// 更新门店
router.put('/:id', authenticate, (req, res) => {
  try {
    const {
      store_code, brand, name, store_type,
      city, district, address,
      open_date, business_hours, store_area, seats, frontage,
      store_category, store_status, mall_type, trade_area_type, description,
      latitude, longitude, icon_color
    } = req.body

    const db = getDb()

    // 检查门店是否存在且属于当前用户
    const existingMarker = db.prepare('SELECT * FROM markers WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
    if (!existingMarker) {
      return res.status(404).json({ message: '门店不存在' })
    }

    // 只读锁（规则 4）：镜像行由源账号维护，本账号须先「脱离同步」
    if (blockedBySyncLock(res, existingMarker)) return

    // 城市兜底（规则 13）：改了坐标却没给 city（或把 city 清空）→ 重新反查补全
    const nextLat = latitude ?? existingMarker.latitude
    const nextLng = longitude ?? existingMarker.longitude
    const rawCity = (city === undefined || city === null) ? existingMarker.city : city
    const cityFix = fillCityFallback(db, { city: rawCity, latitude: nextLat, longitude: nextLng })
    const citySource = cityFix.city_source || existingMarker.city_source || null

    db.prepare(`
      UPDATE markers SET
        store_code = ?, brand = ?, name = ?, store_type = ?,
        city = ?, district = ?, address = ?, 
        open_date = ?, business_hours = ?, store_area = ?, seats = ?, frontage = ?,
        store_category = ?, store_status = ?, mall_type = ?, trade_area_type = ?, description = ?,
        latitude = ?, longitude = ?, icon_color = ?, city_source = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      store_code ?? existingMarker.store_code,
      brand ?? existingMarker.brand,
      name ?? existingMarker.name,
      store_type ?? existingMarker.store_type,
      cityFix.city ?? existingMarker.city,
      district ?? existingMarker.district,
      
      address ?? existingMarker.address,
      open_date ?? existingMarker.open_date,
      business_hours ?? existingMarker.business_hours,
      store_area ?? existingMarker.store_area,
      seats ?? existingMarker.seats,
      frontage ?? existingMarker.frontage,
      store_category ?? existingMarker.store_category,
      store_status ?? existingMarker.store_status,
      mall_type ?? existingMarker.mall_type,
      trade_area_type ?? existingMarker.trade_area_type,
      description ?? existingMarker.description,
      latitude ?? existingMarker.latitude,
      longitude ?? existingMarker.longitude,
      icon_color ?? existingMarker.icon_color,
      citySource,
      req.params.id
    )

    const marker = db.prepare('SELECT * FROM markers WHERE id = ?').get(req.params.id)

    res.json({
      message: '更新成功',
      marker
    })
  } catch (error) {
    console.error('更新门店错误:', error)
    res.status(500).json({ message: '更新失败' })
  }
})

// 清空所有门店（必须放在 /:id 之前，避免 clear-all 被 :id 捕获）
// ★ 保留镜像行（sync_readonly=1）：它们由源账号维护，清空本账号自有门店不应
//   连带销毁「集团下发给我的门店」。要一并清掉请走「移除外来副本」。
router.delete('/clear-all', authenticate, (req, res) => {
  try {
    const db = getDb()
    const kept = db.prepare('SELECT COUNT(*) AS n FROM markers WHERE user_id = ? AND sync_readonly = 1').get(req.user.id)
    const result = db.prepare('DELETE FROM markers WHERE user_id = ? AND (sync_readonly IS NULL OR sync_readonly != 1)').run(req.user.id)
    const keptN = (kept && kept.n) || 0
    res.json({
      message: keptN > 0
        ? `已清空 ${result.changes} 条自有门店；保留了 ${keptN} 条同步镜像（如需清除请用「移除外来副本」）`
        : `已清空 ${result.changes} 条门店数据`,
      count: result.changes,
      keptSynced: keptN
    })
  } catch (error) {
    console.error('清空门店错误:', error)
    res.status(500).json({ message: '清空失败' })
  }
})

// 删除门店
router.delete('/:id', authenticate, (req, res) => {
  try {
    const db = getDb()

    // 检查门店是否存在
    const existingMarker = db.prepare('SELECT * FROM markers WHERE id = ?').get(req.params.id)
    if (!existingMarker) {
      return res.status(404).json({ message: '门店不存在' })
    }

    // 普通用户只能删除自己的门店，管理员可以删除所有门店
    if (req.user.role !== 'admin' && existingMarker.user_id !== req.user.id) {
      return res.status(403).json({ message: '无权删除该门店' })
    }

    // 只读锁（规则 4）
    if (blockedBySyncLock(res, existingMarker)) return

    db.prepare('DELETE FROM markers WHERE id = ?').run(req.params.id)

    res.json({ message: '删除成功' })
  } catch (error) {
    console.error('删除门店错误:', error)
    res.status(500).json({ message: '删除失败' })
  }
})

// 批量删除门店
router.post('/batch-delete', authenticate, (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: '请提供要删除的ID列表' })
    }

    const db = getDb()
    const placeholders = ids.map(() => '?').join(',')

    // 只读锁（规则 4）：镜像行不参与批量删除，单独统计提示
    const locked = db.prepare(`
      SELECT COUNT(*) AS n FROM markers
       WHERE id IN (${placeholders}) AND sync_readonly = 1
         ${req.user.role !== 'admin' ? 'AND user_id = ?' : ''}
    `).get(...(req.user.role !== 'admin' ? [...ids, req.user.id] : ids))

    // 普通用户只能删除自己的门店数据
    if (req.user.role !== 'admin') {
      db.prepare(`DELETE FROM markers WHERE id IN (${placeholders}) AND user_id = ? AND (sync_readonly IS NULL OR sync_readonly != 1)`).run(...ids, req.user.id)
    } else {
      db.prepare(`DELETE FROM markers WHERE id IN (${placeholders}) AND (sync_readonly IS NULL OR sync_readonly != 1)`).run(...ids)
    }

    const lockedN = (locked && locked.n) || 0
    res.json({
      message: lockedN > 0
        ? `批量删除成功；其中 ${lockedN} 条为同步镜像已跳过（需先「脱离同步」）`
        : '批量删除成功',
      count: ids.length - lockedN,
      skippedSynced: lockedN
    })
  } catch (error) {
    console.error('批量删除门店错误:', error)
    res.status(500).json({ message: '批量删除失败' })
  }
})

// 导入门店
router.post('/import', authenticate, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请上传文件' })
    }

    const fileContent = readCsvText(req.file.path)

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const db = getDb()
        let imported = 0
        let geocoded = 0
        let cityPool = null   // 懒加载：只有真的出现空 city 才建参照池（规则 13）

        // H3/S1-A（v1.13.106）：裸 exec BEGIN/COMMIT 收编为 wrapper 事务原语，
        // 任一行失败 ROLLBACK 整体回滚（原实现中途异常会悬挂 BEGIN、不落盘即丢半截数据）
        db.beginTx()
        try {
          const esc = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'NULL') : "'" + String(v).replace(/'/g, "''") + "'"

          for (const row of results.data) {
            if (!row.name || !row.latitude || !row.longitude) continue
            let cityVal = String(row.city || '').trim()
            let citySource = cityVal ? 'manual' : null
            if (!cityVal) {
              if (!cityPool) cityPool = loadCityReferencePool(db)
              const fix = fillCityFallback(db, {
                city: '', latitude: parseFloat(row.latitude), longitude: parseFloat(row.longitude)
              }, cityPool)
              if (fix.city) { cityVal = fix.city; citySource = fix.city_source; geocoded++ }
            }
            const vals = [
              esc(row.store_code || ''), esc(row.brand || ''), esc(row.name), esc(row.store_type || '已开业'),
              esc(cityVal), esc(row.district || ''), esc(row.address || ''),
              esc(row.open_date || ''), esc(row.business_hours || ''),
              row.store_area ? esc(parseFloat(row.store_area)) : 'NULL',
              row.seats ? esc(parseInt(row.seats)) : 'NULL',
              row.frontage ? esc(parseFloat(row.frontage)) : 'NULL',
              esc(row.store_category || ''), esc(row.store_status || ''), esc(row.mall_type || ''), esc(row.trade_area_type || ''), esc(row.description || ''),
              esc(parseFloat(row.latitude)), esc(parseFloat(row.longitude)),
              "'正常'",
              esc(row.icon_color || '#409eff'),
              String(req.user.id),
              esc(citySource),
              "datetime('now')", "datetime('now')"
            ].join(',')
            db.exec('INSERT INTO markers (store_code,brand,name,store_type,city,district,address,open_date,business_hours,store_area,seats,frontage,store_category,store_status,mall_type,trade_area_type,description,latitude,longitude,status,icon_color,user_id,city_source,created_at,updated_at) VALUES (' + vals + ')')
            imported++
          }
          db.commitTx() // 内含统一落盘
        } catch (txError) {
          try { db.rollbackTx() } catch (e) { /* 忽略 */ }
          throw txError
        }

        // 删除上传的文件（清理失败不影响导入结果）
        try { fs.unlinkSync(req.file.path) } catch (e) { console.warn('[Markers] 清理上传临时文件失败:', e.message) }

        res.json({
          message: geocoded > 0
            ? `成功导入 ${imported} 条数据（其中 ${geocoded} 条城市由坐标反查补全）`
            : `成功导入 ${imported} 条数据`,
          count: imported,
          geocodedCities: geocoded
        })
      }
    })
  } catch (error) {
    console.error('导入错误:', error)
    res.status(500).json({ message: '导入失败' })
  }
})

// 导出门店（按用户隔离）
router.get('/export', authenticate, (req, res) => {
  try {
    const db = getDb()
    // 导出排除已合并行：否则客户导出→再导入会把合并掉的重复记录重新灌回库
    const markers = db.prepare('SELECT * FROM markers WHERE user_id = ? AND merged_into IS NULL ORDER BY created_at DESC').all(req.user.id)

    res.json(markers)
  } catch (error) {
    console.error('导出错误:', error)
    res.status(500).json({ message: '导出失败' })
  }
})

// 空间查询 - 获取范围内的门店
router.get('/query/bounds', authenticate, (req, res) => {
  try {
    const { north, south, east, west } = req.query

    if (!north || !south || !east || !west) {
      return res.status(400).json({ message: '请提供范围参数' })
    }

    const db = getDb()
    const markers = db.prepare(`
      SELECT * FROM markers
      WHERE user_id = ?
      AND merged_into IS NULL
      AND latitude BETWEEN ? AND ?
      AND longitude BETWEEN ? AND ?
    `).all(req.user.id, south, north, west, east)

    res.json({ markers, count: markers.length })
  } catch (error) {
    console.error('空间查询错误:', error)
    res.status(500).json({ message: '查询失败' })
  }
})

export default router
