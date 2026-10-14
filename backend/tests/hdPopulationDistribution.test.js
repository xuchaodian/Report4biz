/**
 * 高精人口分布（population_hd）护栏守卫 —— v1.13.227
 *
 * 为什么必须有它：「高精度人口」250m 网格生产实测**单文件 95MB / 107,960 要素 / 35 字段**，
 * 而 backend `calculate-population` 每次请求都要重新 `JSON.parse` 整个文件
 * （geoStore 对 >4MB 不缓存解析对象、>64MB 不缓存文本）——本机实测该文件 **parse 增量 rss ≈ 372MB**。
 * 生产 available 仅 ~518MB（常驻 webgis-backend 已占 ~422MB）
 * ⇒ **两个并发请求就 ~1.4GB ⇒ OOM，而 OOM 波及的是整个后端、所有用户（不只管理员）**。
 *
 * ⇒ 以下都是**硬约束，不是优化项**，退化任意一条都可能打挂生产：
 *   ① 前端 hd 模式必须**串行**（⛔ 不得回到 Promise.all）
 *   ② 前端 hd 模式必须传 shapefileId（后端护栏①依赖它来锁定单文件）
 *   ③ 后端三条护栏码必须都在：shapefile_required / calc_busy / server_memory_pressure
 *   ④ 两个入口（商圈工具面板 + 地图右键菜单）必须 admin-only
 *
 * ⚠️ 反向验证（防假绿灯）：把 MapView 里 hd 分支改回 `Promise.all` ⇒ ② 必红；
 *    去掉任一处 `v-if="userStore.isAdmin"` ⇒ ④ 必红；删后端任一护栏码 ⇒ ③ 必红。
 *
 * 前端无独立测试框架，故与 vipGateGuard / quotaContactGuard 一致，挂在 backend 的 vitest 下。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * ⚠️ 必须用 fileURLToPath 而不是 `new URL(...).pathname` —— 本项目路径含中文与空格，
 *    pathname 会留下百分号编码，导致 fs 报 ENOENT。
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MAPVIEW = path.join(REPO_ROOT, 'frontend/src/views/MapView.vue')
const PANEL = path.join(REPO_ROOT, 'frontend/src/components/map/BusinessCirclePanel.vue')
const ROUTE = path.join(REPO_ROOT, 'backend/src/routes/shapefiles.js')

/**
 * 剥离注释后再判 —— 否则「注释里写明了为什么不能用 Promise.all」反而会被判成违规。
 * 只去整行的 `//`（避免误伤 URL 里的 `//`）、块注释与 Vue 模板注释。
 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

function readOrEmpty(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}

const mapSrc = stripComments(readOrEmpty(MAPVIEW))
const panelSrc = stripComments(readOrEmpty(PANEL))
const routeSrc = stripComments(readOrEmpty(ROUTE))

describe('高精人口分布（population_hd）：内存护栏与入口可见性', () => {
  it('① 后端四条护栏码齐全，且 category 走白名单参数化', () => {
    expect(routeSrc, '缺少「hd 仅管理员」护栏（API 层未拦 ⇒ 普通用户可绕过 UI 直调）').toContain("code: 'admin_only'")
    expect(routeSrc, '缺少「hd 必须指定单文件」护栏').toContain("code: 'shapefile_required'")
    expect(routeSrc, '缺少「同文件串行」护栏').toContain("code: 'calc_busy'")
    expect(routeSrc, '缺少「解析前 RSS 自检」护栏').toContain("code: 'server_memory_pressure'")
    expect(routeSrc, '并发锁容器缺失').toContain('popCalcInFlight')
    expect(
      routeSrc,
      'calculate-population 的 category 必须走白名单（⛔ 别写成任意字符串）'
    ).toMatch(/ALLOWED_CATEGORIES\.has\(\s*req\.body\.category\s*\)/)
    expect(
      routeSrc,
      'hd 被纳入白名单是前置条件（否则前端传 population_hd 会被静默降级成 population）'
    ).toMatch(/ALLOWED_CATEGORIES\s*=\s*new Set\(\[[^\]]*'population_hd'[^\]]*\]\)/)
  })

  it('② hd 分支必须串行；常规分支保持并行（切片断言 + 双向对照）', () => {
    const m = mapSrc.match(
      /if\s*\(isHd\)\s*\{([\s\S]*?)\}\s*else\s*\{([\s\S]*?)\}\s*console\.log\('所有API调用完成/
    )
    expect(
      m,
      '未找到 `if (isHd) { ... } else { ... }` 执行分支 —— 结构被改写了，本守卫已失锚，请同步更新'
    ).toBeTruthy()

    const [, hdBranch, normalBranch] = m
    expect(
      hdBranch,
      'hd 分支出现了 Promise.all —— 95MB × 并发会直接 OOM，必须逐半径串行 await'
    ).not.toContain('Promise.all')
    expect(hdBranch, 'hd 分支应逐个半径 await').toMatch(/for\s*\(const r of allRadiiMeters\)/)
    expect(hdBranch, 'hd 分支每个半径前应做超时自检').toContain('checkTimeout()')

    // 反向对照：常规（1km 网格，多文件但体积小）必须**仍然并行**，
    // 否则说明切片锚点写错（例如把两个分支都吞了），守卫在骗人。
    expect(normalBranch, '常规分支不应被本批改动（应仍为并行）').toContain('Promise.all')
  })

  it('③ hd 模式必须传 shapefileId（后端护栏①依赖它锁定单文件）', () => {
    expect(
      mapSrc,
      '缺少 hd 单文件 id 的取值'
    ).toContain('const hdShapefileId = isHd ? selectedHdShapefileId.value : null')
    expect(
      mapSrc,
      'calculate-population 请求体必须带上 shapefileId（否则后端走全 category 兜底、被护栏①拒绝）'
    ).toContain('...(hdShapefileId ? { shapefileId: hdShapefileId } : {})')
    expect(
      mapSrc,
      '请求体必须带 category（否则后端默认 population，hd 数据永远查不到）'
    ).toContain('category: calcCategory')
  })

  it('④ 两个入口都必须是 admin-only', () => {
    expect(
      panelSrc,
      '商圈工具面板的「高精人口分布」按钮缺少 v-if="userStore.isAdmin"'
    ).toMatch(/v-if="userStore\.isAdmin"[\s\S]{0,160}population-hd-dist/)
    expect(
      panelSrc,
      '面板未声明 population-hd-dist 事件'
    ).toContain("'population-hd-dist'")

    expect(
      mapSrc,
      '地图右键菜单的「高精人口分布」缺少 v-if="userStore.isAdmin"'
    ).toMatch(/v-if="userStore\.isAdmin"[\s\S]{0,200}contextMenuAction\('populationHd'\)/)
    expect(
      mapSrc,
      '右键菜单未接线到 openHdPopulationDistribution'
    ).toContain("case 'populationHd': openHdPopulationDistribution(); break")
  })

  it('⑤ 人口类模式判据已收敛为单一 computed（⛔ 不许散写 === \'population\'）', () => {
    expect(mapSrc, '缺少 isPopulationMode 单一判据').toContain('const isPopulationMode = computed(')
    // 模板里不许再出现 `circleDialogMode === 'population'`（hd 会被漏掉）
    const templatePart = mapSrc.slice(0, mapSrc.indexOf('<script setup>'))
    expect(
      templatePart.includes("circleDialogMode === 'population'"),
      '模板里仍有 `circleDialogMode === \'population\'` —— hd 模式下对应表单项会被静默隐藏'
    ).toBe(false)
  })

  it('⑥ 守卫自检：stripComments 只剥注释、不吞代码（211 教训）', () => {
    const sample = [
      '// Promise.all=apiPromises',
      '/* Promise.all=apiPromises */',
      "const keep = 'Promise.all=x'",
    ].join('\n')
    const out = stripComments(sample)
    expect(out.includes('// Promise.all'), 'stripComments 未剥掉行注释').toBe(false)
    expect(
      (out.match(/Promise\.all/g) || []).length,
      'stripComments 自检失败：注释未被剥净，或把真实代码一起剥掉了'
    ).toBe(1)
  })

  it('⑦ hd 不得在扫描字段阶段调 /:id/fields（该接口会 JSON.parse 整个 95MB）', () => {
    const m = mapSrc.match(/const openHdPopulationDistribution[\s\S]*?\n\}\n/)
    expect(m, '未找到 openHdPopulationDistribution 函数（守卫已失锚，请同步更新）').toBeTruthy()
    const body = m[0]
    expect(
      body,
      'openHdPopulationDistribution 里出现了 /fields —— 该接口内部会 JSON.parse 整个 geojson，' +
        '对 95MB 的 hd 文件会在「扫描字段」阶段再吃 ~372MB 内存；应改用列表接口已返回的 field_names'
    ).not.toMatch(/\/fields/)
    expect(body, 'hd 应直接使用列表接口返回的 field_names').toContain('sf.fieldNames')
  })

  it('⑧ 「人口分布分析」面板不展示分年龄字段（判据来自 utils/ageField.js，行为断言）', async () => {
    const { isAgeGroupField } = await import('../../frontend/src/utils/ageField.js')

    // 生产 hd 文件的真实 35 字段（PRAGMA 查得）
    const HD_FIELDS = [
      '到访人次', '居住人数', '工作人数', '低收入', '中等收入', '小康', '中产', '富裕', '富人',
      '男性人数', '女性人数',
      '男0_18', '男19_24', '男25_29', '男30_34', '男35_39', '男40_44', '男45_49', '男50_54',
      '男55_59', '男60_64', '男65_69', '男70以上',
      '女0_18', '女19_24', '女25_29', '女30_34', '女35_39', '女40_44', '女45_49', '女50_54',
      '女55_59', '女60_64', '女65_69', '女70以上'
    ]
    expect(HD_FIELDS.length, 'hd 字段数应为 35（若数据换了，请同步更新本守卫）').toBe(35)

    const ageFields = HD_FIELDS.filter(isAgeGroupField)
    const kept = HD_FIELDS.filter((f) => !isAgeGroupField(f))

    expect(ageFields.length, '应恰好识别出 24 个分年龄字段').toBe(24)
    expect(kept.length, '面板应保留 11 个量类字段（面板行数 11 + 表头 1）').toBe(11)

    // 🔴 反向对照：量类字段必须**全部保留** —— 尤其「男性人数」「女性人数」不能被误杀
    for (const must of [
      '到访人次', '居住人数', '工作人数', '低收入', '中等收入', '小康', '中产', '富裕', '富人',
      '男性人数', '女性人数'
    ]) {
      expect(kept, `「${must}」被误判为分年龄字段而丢弃`).toContain(must)
    }
    // 抽样：年龄字段必须命中（含边界「男0_18」与「男70以上」）
    for (const must of ['男0_18', '男70以上', '女19_24', '女65_69']) {
      expect(ageFields, `「${must}」未被识别为分年龄字段`).toContain(must)
    }

    // 接线断言：MapView 必须真的用了这个判据（否则 util 写了也没人调）
    expect(mapSrc, 'MapView 未从 utils/ageField 引入判据').toContain(
      "import { isAgeGroupField } from '@/utils/ageField'"
    )
    expect(
      mapSrc,
      '统计面板未对字段列表做分年龄过滤（hd 会渲染 35 行 ⇒ 弹窗显示不全）'
    ).toMatch(/Array\.from\(allFieldNames\)\.filter\(f => !isAgeGroupField\(f\)\)/)
  })

  it('⑨ 面板字段按业务优先级排序（顺序表 utils/populationFieldOrder.js，行为断言）', async () => {
    const { sortByPopulationPriority, POPULATION_FIELD_ORDER } = await import(
      '../../frontend/src/utils/populationFieldOrder.js'
    )
    const { isAgeGroupField } = await import('../../frontend/src/utils/ageField.js')

    // 业主 2026-10-14 指定的顺序
    expect(POPULATION_FIELD_ORDER).toEqual([
      '居住人数', '工作人数', '到访人次', '男性人数', '女性人数',
      '低收入', '中等收入', '中产', '小康', '富裕', '富人'
    ])

    // 真实链路复现：hd 的 35 字段 → 过滤分年龄 → 排序
    const HD_FIELDS = [
      '到访人次', '居住人数', '工作人数', '低收入', '中等收入', '小康', '中产', '富裕', '富人',
      '男性人数', '女性人数',
      '男0_18', '男19_24', '男25_29', '男30_34', '男35_39', '男40_44', '男45_49', '男50_54',
      '男55_59', '男60_64', '男65_69', '男70以上',
      '女0_18', '女19_24', '女25_29', '女30_34', '女35_39', '女40_44', '女45_49', '女50_54',
      '女55_59', '女60_64', '女65_69', '女70以上'
    ]
    const got = sortByPopulationPriority(HD_FIELDS.filter((f) => !isAgeGroupField(f)))

    expect(
      got,
      '面板字段顺序与业主指定不符（顺序表被改动或排序逻辑退化）'
    ).toEqual([
      '居住人数', '工作人数', '到访人次', '男性人数', '女性人数',
      '低收入', '中等收入', '中产', '小康', '富裕', '富人'
    ])

    // 不修改入参（避免调用方拿到被排序过的原数组）
    const src = ['富人', '居住人数']
    const copy = src.slice()
    sortByPopulationPriority(src)
    expect(src, 'sortByPopulationPriority 不应修改入参').toEqual(copy)

    // 未列出的字段：排在最后，且不打乱已确认顺序
    const withExtra = sortByPopulationPriority(['新增字段B', '居住人数', '新增字段A'])
    expect(withExtra[0], '未列出的字段应排在最后').toBe('居住人数')
    expect(withExtra.slice(1).sort(), '未列出的字段之间按中文拼音序兜底').toEqual(['新增字段A', '新增字段B'])

    // 接线断言：MapView 必须真的用了它（否则 util 写了也没人调）
    expect(mapSrc, 'MapView 未从 utils/populationFieldOrder 引入排序').toContain(
      "import { sortByPopulationPriority } from '@/utils/populationFieldOrder'"
    )
    expect(
      mapSrc,
      '统计面板未用业务顺序排序（仍是字母序）'
    ).toContain('sortByPopulationPriority(')
  })
})
