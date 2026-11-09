/**
 * 候选点位「轻量工作流」守卫 —— v1.13.333（P1-6）
 *
 * 业主 2026-11-09 拍板的两件事，本文件把它们钉死：
 *   ① **候选点位是独立表**（`store_candidates`），⛔ 不进 `markers`。
 *   ② 推进四档用「待评估 / 已勘踏 / 立项 / 放弃」。
 *
 * 为什么独立表（写在这里防后人"顺手合并"）：
 *   `markers` 被门店体检 / 销售预测 / 台账去重 / 集团同步 / 各类统计**全都在读**，
 *   往里塞候选点等于把「读路径铁律」逐条重改（每条统计都得再加一个"非候选"过滤），
 *   成本与风险远大于收益。候选点独立成表、地图上单独一层，计算复用**函数**不复用**表**。
 *
 * 🔴 另有一条容易搞混的：`markers.status` 是**经营状态**（正常/关注/暂停/关闭），
 *   与推进阶段是两套语义。⛔ 不要为了"少一张表"把阶段塞进 status。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGES as FE_STAGES, stageMeta, isValidStage, requiresDropReason } from '../../frontend/src/utils/candidateStage.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
/** 扫源码前必剥注释 —— 否则文件头注释里的字面量会喂出假绿灯（本项目踩过多次） */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const ROUTE_RAW = read('backend/src/routes/candidates.js')
const ROUTE = strip(ROUTE_RAW)
const DB = strip(read('backend/src/models/database.js'))
const VIEW_RAW = read('frontend/src/views/CandidateView.vue')
const VIEW = strip(VIEW_RAW)

describe('A. 四档是单一来源，三处必须一致', () => {
  it('后端 STAGES 与前端 candidateStage.js 完全一致（改一处就红）', () => {
    const m = /const STAGES = \[([^\]]+)\]/.exec(ROUTE)
    expect(m, '后端找不到 STAGES 定义').toBeTruthy()
    const be = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    expect(be).toEqual(FE_STAGES)
  })

  it('建表默认值与 STAGES 首项一致', () => {
    expect(DB).toContain("stage TEXT NOT NULL DEFAULT '待评估'")
    expect(FE_STAGES[0]).toBe('待评估')
  })

  it('四档就是这四档（⛔ 不要偷偷加"已签约/已开业"之类）', () => {
    expect(FE_STAGES).toEqual(['待评估', '已勘踏', '立项', '放弃'])
  })

  it('每档都有展示元数据，且「放弃」必须填原因', () => {
    for (const s of FE_STAGES) {
      const meta = stageMeta(s)
      expect(meta.color, `${s} 缺颜色`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(meta.desc, `${s} 缺说明`).toBeTruthy()
    }
    expect(requiresDropReason('放弃')).toBe(true)
    expect(requiresDropReason('立项')).toBe(false)
  })

  it('未知阶段不假装成"待评估"（脏数据要看得见）', () => {
    expect(isValidStage('已签约')).toBe(false)
    expect(stageMeta('已签约').desc).toContain('未知')
  })
})

describe('B. 鉴权：每个端点都必须登录，且只能碰自己的点位', () => {
  const endpoints = [...ROUTE.matchAll(/router\.(get|post|patch|delete)\(\s*'([^']+)'\s*,\s*([A-Za-z]+)/g)]

  it('端点数量与预期一致（漏一个就说明有人加了没挂鉴权的接口）', () => {
    expect(endpoints.length).toBe(7)
  })

  it('全部挂在 authenticate 之后', () => {
    const bad = endpoints.filter((e) => e[3] !== 'authenticate').map((e) => `${e[1].toUpperCase()} ${e[2]}`)
    expect(bad, `这些端点没挂 authenticate：${bad.join('、')}`).toEqual([])
  })

  it('🔴 每条按 id 取数据的查询都带 user_id（⛔ admin 不放大 —— 与 /api/markers 同口径）', () => {
    // ownCandidate 是唯一的"取单条"入口，必须同时判 id 与 user_id
    expect(ROUTE).toContain('SELECT * FROM store_candidates WHERE id = ? AND user_id = ?')
    // 列表必带 user_id 过滤
    expect(ROUTE).toContain("'SELECT * FROM store_candidates WHERE user_id = ?'")
    // ⛔ 不要顺手接集团可见域：候选点位是"我这批点位"的自我管理
    expect(ROUTE).not.toContain('visibleScope')
    expect(ROUTE).not.toContain('readableUserIds')
  })

  it('删除与更新都带 user_id 二次兜底（防"取到就一定能改"）', () => {
    expect(ROUTE).toMatch(/DELETE FROM store_candidates WHERE id = \? AND user_id = \?/)
    expect(ROUTE).toMatch(/UPDATE store_candidates SET[\s\S]{0,200}WHERE id = \? AND user_id = \?/)
  })
})

describe('C. 流水的三条不变式', () => {
  it('阶段变更必须走 /stage 专用入口；PATCH /:id 显式拒绝 stage 字段', () => {
    expect(ROUTE).toContain("if (b.stage !== undefined) return res.status(400)")
    // 普通 PATCH 里不允许出现给 stage 赋值的 SQL 片段
    expect(ROUTE).not.toMatch(/put\('stage'/)
  })

  it('流转是两次写（主表 + 流水）⇒ 必须包事务', () => {
    const block = ROUTE.slice(ROUTE.indexOf("router.patch('/:id/stage'"), ROUTE.indexOf("router.post('/:id/notes'"))
    expect(block).toContain('beginTx()')
    expect(block).toContain('commitTx()')
    expect(block).toContain('rollbackTx()')
  })

  it('新建点位也要留一条建档流水（否则半年后没人知道点从哪来）', () => {
    const block = ROUTE.slice(ROUTE.indexOf("router.post('/'"), ROUTE.indexOf("router.patch('/:id'"))
    expect(block).toContain('candidate_notes')
  })

  it('🔴 标记「放弃」必须给原因（前端也拦一次）', () => {
    expect(ROUTE).toContain("if (to === '放弃' && !dropReason && !note)")
    expect(VIEW).toContain("stage === '放弃'")
  })

  it('备注只追加：⛔ 不提供改/删单条备注的端点', () => {
    expect(ROUTE).not.toMatch(/router\.(patch|put|delete)\(\s*'\/:id\/notes/)
  })
})

describe('D. 表结构与索引（幂等零迁移）', () => {
  it('两张表都由 CREATE TABLE IF NOT EXISTS 建（生产重启即生效）', () => {
    expect(DB).toContain('CREATE TABLE IF NOT EXISTS store_candidates')
    expect(DB).toContain('CREATE TABLE IF NOT EXISTS candidate_notes')
  })

  it('列表与图层所需的索引都在', () => {
    expect(DB).toContain('idx_cand_user_stage')
    expect(DB).toContain('idx_cand_user_city')
    expect(DB).toContain('idx_cand_note_cand')
  })

  it('🔴 候选点位的数据一行都不许落进 markers（这是本功能的立身之本）', () => {
    expect(ROUTE).not.toMatch(/INSERT\s+INTO\s+markers/i)
    expect(ROUTE).not.toMatch(/UPDATE\s+markers/i)
    expect(ROUTE).not.toMatch(/DELETE\s+FROM\s+markers/i)
  })
})

describe('E. 前端不另写一套（防两份常量漂移）', () => {
  it('页面引用统一 util，⛔ 不在组件里内联 STAGES 数组', () => {
    expect(VIEW_RAW).toContain("from '@/utils/candidateStage.js'")
    expect(VIEW).not.toMatch(/const STAGES = \[/)
  })

  it('阶段配色走内联 style，不用 el-tag 的 type（EP 全局色被覆盖过，type 出来对不上设计稿）', () => {
    expect(VIEW).toContain('stageMeta(row.stage).color')
    expect(VIEW).not.toMatch(/el-tag[^>]*type="(success|warning|info|danger)"[^>]*>\s*\{\{\s*row\.stage/)
  })

  it('路由与导航入口都在', () => {
    expect(read('frontend/src/router/index.js')).toContain("path: 'candidates'")
    const layout = read('frontend/src/views/MainLayout.vue')
    expect(layout).toContain("$route.path === '/candidates'")
    // 三语都要有键，否则切语言会显示 raw key
    for (const lang of ['zh', 'ja', 'en']) {
      expect(read(`frontend/src/i18n/locales/${lang}.js`), `${lang} 缺 candidates 文案`).toContain('candidates:')
    }
  })
})

describe('F. 时间口径：库里存 UTC，展示转本地', () => {
  it('★ 不带时区的 "YYYY-MM-DD HH:MM:SS" 必须按 UTC 解析（⛔ 不能当本地时间）', async () => {
    const { parseUtc } = await import('../../frontend/src/utils/datetime.js')
    const d = parseUtc('2026-11-09 06:57:00')
    // 用 getUTC* 断言 ⇒ 与运行机器的时区无关
    expect(d.getUTCFullYear()).toBe(2026)
    expect(d.getUTCHours()).toBe(6)
    expect(d.getUTCMinutes()).toBe(57)
  })

  it('已带 Z / 偏移量的串不重复补 Z', async () => {
    const { parseUtc } = await import('../../frontend/src/utils/datetime.js')
    expect(parseUtc('2026-11-09T06:57:00Z').getUTCHours()).toBe(6)
    expect(parseUtc('2026-11-09T06:57:00+08:00').getUTCHours()).toBe(22) // 前一天 22:57 UTC
  })

  it('空值给 —，脏值退回原串前 16 位（⛔ 不显示 Invalid Date）', async () => {
    const { formatUtcDateTime } = await import('../../frontend/src/utils/datetime.js')
    expect(formatUtcDateTime(null)).toBe('—')
    expect(formatUtcDateTime('')).toBe('—')
    expect(formatUtcDateTime('not-a-date-0123456789')).toBe('not-a-date-01234')
  })

  it('🔴 后端不许再写 localtime 到 updated_at（否则同表两种时区，显示多 8 小时）', () => {
    expect(ROUTE).not.toMatch(/updated_at\s*=\s*datetime\('now',\s*'localtime'\)/)
    expect(ROUTE).toContain('updated_at = CURRENT_TIMESTAMP')
  })
})

describe('G. 地图选点入口（v1.13.335）', () => {
  const MAP_RAW = read('frontend/src/views/MapView.vue')
  const MAP = strip(MAP_RAW)

  it('右键菜单里有「加入候选点位」，并接到 addCandidateFromMap', () => {
    expect(MAP_RAW).toContain("contextMenuAction('candidate')")
    expect(MAP_RAW).toContain('加入候选点位')
    expect(MAP).toContain('case \'candidate\': addCandidateFromMap()')
  })

  it('跳转带 lat / lng / source=map（坐标按 6 位小数收敛，⛔ 不传 20 位双精度）', () => {
    const block = MAP.slice(MAP.indexOf('const addCandidateFromMap'), MAP.indexOf('const addCandidateFromMap') + 600)
    expect(block).toContain("path: '/candidates'")
    expect(block).toContain('toFixed(6)')
    expect(block).toContain("source: 'map'")
  })

  it('🔴 MapView 只做跳转，⛔ 不复制一份新建表单/接口调用（校验与流水必须只有一处）', () => {
    expect(MAP).not.toContain('/api/candidates')
    expect(MAP).not.toContain('store_candidates')
  })

  it('🔴 预填后必须清 query（否则关掉弹窗一刷新又弹一次）', () => {
    const i = VIEW.indexOf('const q = route.query')
    const block = VIEW.slice(i, i + 600)
    expect(block).toContain("router.replace({ path: '/candidates' })")
  })

  it('🔴 来源必须在清 query 之前捕获（踩过：先 replace 再读 query ⇒ source 全落 manual）', () => {
    // 提交时用 entrySource，⛔ 不再实时读 route.query
    expect(VIEW).toContain("source: entrySource.value")
    expect(VIEW).not.toContain("route.query.source")
    // 捕获必须发生在 router.replace 之前
    const iCap = VIEW.indexOf('entrySource.value = String(q.source')
    const iReplace = VIEW.indexOf("router.replace({ path: '/candidates' })")
    expect(iCap).toBeGreaterThan(-1)
    expect(iReplace).toBeGreaterThan(-1)
    expect(iCap, '先清 query 再捕获来源 ⇒ 永远读不到 map').toBeLessThan(iReplace)
  })

  it('地图选点会给一个默认点位名（必填项不空着进去）', () => {
    expect(VIEW).toContain('defaultMapName()')
    expect(VIEW).toContain('地图选点')
  })
})
