/**
 * 写接口鉴权守卫 —— v1.13.319
 *
 * 修的漏洞（2026-11-06 安全审计坐实）：
 *   `routes/city-data.js` **整个文件零鉴权**，4 个写接口谁都能调：
 *     POST /            新增/覆盖任一城市
 *     POST /import      上传 CSV 覆盖
 *     PUT  /:city       改任一城市
 *     DELETE /          清空全部（写成 []）
 *   其中 DELETE 的注释一直写着「仅管理员调用」，但**代码里没有任何校验**。
 *
 *   线上实测（不带 token）：
 *     PUT  /api/city-data/__probe__  → 404「未找到该城市」
 *     POST /api/city-data (空 body)  → 400「城市名不能为空」
 *   若挂了鉴权，两者都应先返回 401「请先登录」。
 *   ⇒ 任何人不登录、一条 curl 即可清空或篡改 51 个城市的宏观数据；
 *     而 city_data.json 是**文件不是数据库**，不在 webgis.db 的备份链里。
 *
 * 本守卫钉住的不变量：
 *   A. city-data 的 4 个写接口必须挂 `authenticate, requireAdmin`。
 *   B. city-data 的 2 个 GET 必须**保持公开**（地图页在用它，加了会白屏）。
 *   C. `/import` 的鉴权必须排在 `upload.single()` **之前**（否则未授权也能往 /tmp 落文件）。
 *   D. **通用**：routes/ 下任何写接口要么挂鉴权，要么在下方白名单里（带理由）。
 *   E. **通用**：注释写着「仅管理员」但实际无校验的写接口 ⇒ 报警。
 *      这条正是本次漏洞的成因 —— 一句注释让审计时误以为已受保护。
 *      ⇒ 注释不是防护，判据永远看中间件链。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROUTES_DIR = path.resolve(HERE, '..', 'src', 'routes')

/** 认作「有鉴权」的中间件名 */
const AUTH_MIDDLEWARES = ['authenticate', 'requireApiKey', 'requireOrgOwner', 'requireVip', 'requireAdmin']

/**
 * 允许「未挂鉴权」的写接口白名单。
 * ⚠️ 每一条都必须写清理由；没有理由就不要往这里加 —— 加白名单比改代码更危险，
 *    因为它是**永久豁免**，而改代码至少会在 review 时被人看到。
 */
const PUBLIC_WRITE_WHITELIST = {
  'auth.js': {
    paths: ['/register', '/login', '/logout', '/forgot-password', '/reset-password'],
    reason:
      '认证前置接口：登录/注册/找回密码必须在**未登录**时可调。' +
      'logout 刻意不挂 authenticate（文件头有说明）：它按 token 自身的 jti 撤销，' +
      '必须幂等，多标签页重复点击时若先被 401 挡下，前端拦截器会跳登录页 + 弹「登录已过期」。',
  },
  'smartsteps.js': {
    paths: ['/convert'],
    reason:
      '纯坐标系换算（GCJ-02 → WGS84），不读写任何数据、不调外部付费接口、不落库 ⇒ 无数据面风险。' +
      '（若将来给它加了批量/落盘能力，必须同步从这里移除。）',
  },
}

/**
 * 剥注释后再做判断。
 * 🔴 必须剥：本批给 city-data 加的注释里就写着「authenticate, requireAdmin」，
 *    不剥注释会让守卫**看到自己的说明文字就判通过**（典型的假绿灯）。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')   // [^:] 保护 https:// 这类
}

/** 取某个 `router.xxx(` 的「中间件链」部分（到 => 为止），已剥注释 */
function middlewareChainOf(src, startIdx) {
  const seg = src.slice(startIdx, startIdx + 500)
  const arrow = seg.indexOf('=>')
  const chain = arrow > 0 ? seg.slice(0, arrow) : seg.slice(0, 250)
  return stripComments(chain)
}

/** 取 handler 开头一段（用于识别「没有 requireAdmin 但 handler 内自己判了 role」的写法） */
function handlerPrologueOf(src, startIdx) {
  const seg = src.slice(startIdx, startIdx + 1200)
  return stripComments(seg)
}

function hasAuth(src, startIdx) {
  const chain = middlewareChainOf(src, startIdx)
  return AUTH_MIDDLEWARES.some((m) => chain.includes(m))
}

/** handler 里自己判角色的写法（brand-stores / shopping-centers 就是这种） */
function hasInlineRoleCheck(src, startIdx) {
  const body = handlerPrologueOf(src, startIdx)
  return /req\.user\??\.role\s*!==\s*'admin'/.test(body) || /isAdmin\(/.test(body)
}

function routeFiles() {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort()
}

/** 扫出所有写接口：[{file, method, routePath, startIdx, hasAuth, inlineRole}] */
function scanWriteRoutes() {
  const out = []
  for (const file of routeFiles()) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8')
    const groupGuarded = /router\.use\(\s*(authenticate|require)/.test(stripComments(src))
    const re = /router\.(post|put|delete|patch)\(\s*'([^']*)'/g
    let m
    while ((m = re.exec(src)) !== null) {
      out.push({
        file,
        method: m[1].toUpperCase(),
        routePath: m[2],
        startIdx: m.index,
        groupGuarded,
        hasAuth: hasAuth(src, m.index),
        inlineRole: hasInlineRoleCheck(src, m.index),
      })
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
describe('A. city-data 写接口必须仅管理员可调', () => {
  const SRC_PATH = path.join(ROUTES_DIR, 'city-data.js')
  const src = fs.readFileSync(SRC_PATH, 'utf8')

  const cases = [
    ['post', '/'],
    ['post', '/import'],
    ['put', '/:city'],
    ['delete', '/'],
  ]

  for (const [method, routePath] of cases) {
    it(`${method.toUpperCase()} ${routePath} 挂了 authenticate + requireAdmin`, () => {
      const needle = `router.${method}('${routePath}'`
      const idx = src.indexOf(needle)
      expect(idx, `找不到 ${needle}（守卫已失锚，请同步更新）`).toBeGreaterThan(-1)
      const chain = middlewareChainOf(src, idx)
      expect(chain, `${needle} 没有 authenticate —— 未登录即可调用`).toContain('authenticate')
      expect(chain, `${needle} 没有 requireAdmin —— 任何登录用户都能改城市数据`).toContain('requireAdmin')
    })
  }

  it('🔴 反向断言：不得改成 router.use(authenticate) 组级挂载', () => {
    // 组级挂载会把两个 GET 一起关掉 ⇒ 地图页读不到城市宏观数据
    const code = stripComments(src)
    expect(code, '出现了 router.use(authenticate) 组级挂载：那两个 GET 也会要求登录，地图页会失效')
      .not.toMatch(/router\.use\(\s*authenticate/)
  })
})

describe('B. city-data 的 GET 必须保持公开', () => {
  const src = fs.readFileSync(path.join(ROUTES_DIR, 'city-data.js'), 'utf8')

  for (const routePath of ['/', '/:city']) {
    it(`GET ${routePath} 不得挂 requireAdmin（地图页在用）`, () => {
      const needle = `router.get('${routePath}'`
      const idx = src.indexOf(needle)
      expect(idx, `找不到 ${needle}`).toBeGreaterThan(-1)
      const chain = middlewareChainOf(src, idx)
      expect(chain, `GET ${routePath} 挂了鉴权 —— 未登录访客的地图页会取不到城市数据`).not.toContain('requireAdmin')
      expect(chain, `GET ${routePath} 挂了 authenticate —— 同上`).not.toContain('authenticate')
    })
  }
})

describe('C. /import 的鉴权必须排在 multer 之前', () => {
  const src = fs.readFileSync(path.join(ROUTES_DIR, 'city-data.js'), 'utf8')

  it('authenticate 在 upload.single() 前面', () => {
    const idx = src.indexOf("router.post('/import'")
    expect(idx).toBeGreaterThan(-1)
    const chain = middlewareChainOf(src, idx)
    const ai = chain.indexOf('authenticate')
    const ui = chain.indexOf('upload')
    expect(ai, 'authenticate 不在中间件链上').toBeGreaterThan(-1)
    expect(ui, 'upload.single 不在中间件链上').toBeGreaterThan(-1)
    expect(
      ai,
      'authenticate 排在 upload 之后 —— multer 会先把文件落到 /tmp 再进 handler，' +
        '等于允许未授权请求填盘（功能看起来一样，攻击面完全不同）'
    ).toBeLessThan(ui)
  })
})

describe('D. 通用：routes/ 下每个写接口都要有鉴权或白名单理由', () => {
  const routes = scanWriteRoutes()

  it('扫描器自身有效（能扫到写接口，且白名单里的文件真实存在）', () => {
    expect(routes.length, '一个写接口都没扫到 ⇒ 正则已失效').toBeGreaterThan(20)
    for (const file of Object.keys(PUBLIC_WRITE_WHITELIST)) {
      expect(routeFiles(), `白名单里的 ${file} 已不存在，请清理白名单`).toContain(file)
    }
  })

  it('不存在「未鉴权、且不在白名单」的写接口', () => {
    const offenders = []
    for (const r of routes) {
      if (r.groupGuarded || r.hasAuth || r.inlineRole) continue
      const wl = PUBLIC_WRITE_WHITELIST[r.file]
      if (wl && wl.paths.includes(r.routePath)) continue
      offenders.push(`${r.file}  ${r.method} ${r.routePath}`)
    }
    expect(
      offenders,
      '以下写接口既没有鉴权中间件、也不在白名单里 —— 未登录即可调用：\n  ' +
        offenders.join('\n  ') +
        '\n（加鉴权，或在 PUBLIC_WRITE_WHITELIST 里写明理由）'
    ).toEqual([])
  })

  it('白名单里没有多余条目（改回鉴权后要同步清理）', () => {
    const stale = []
    for (const [file, wl] of Object.entries(PUBLIC_WRITE_WHITELIST)) {
      const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8')
      for (const p of wl.paths) {
        const m = [...src.matchAll(/router\.(post|put|delete|patch)\(\s*'([^']*)'/g)].find(
          (x) => x[2] === p
        )
        if (!m) continue
        const idx = m.index
        if (hasAuth(src, idx) || hasInlineRoleCheck(src, idx)) {
          stale.push(`${file} ${p}`)
        }
      }
    }
    expect(stale, '这些接口已经有鉴权了，应从白名单移除（否则它们将来被改回裸奔也不会报警）').toEqual([])
  })
})

describe('E. 通用：注释说「仅管理员」但实际无校验 ⇒ 报警', () => {
  /**
   * 本次漏洞的成因：DELETE / 的注释写着「仅管理员调用」，
   * 而代码里连 authenticate 都没有。审计时看到这句话很容易跳过。
   * ⚠️ 这条刻意做成「只在真的没有任何校验时报警」：
   *    brand-stores / shopping-centers 的注释也算「仅管理员」，但它们在 handler
   *    里用 `if (req.user.role !== 'admin') return 403` 兜住了，属正常写法。
   */
  const routes = scanWriteRoutes()

  it('没有「声称仅管理员、实际谁都能调」的写接口', () => {
    const liars = []
    for (const r of routes) {
      if (r.hasAuth || r.inlineRole) continue
      const wl = PUBLIC_WRITE_WHITELIST[r.file]
      if (wl && wl.paths.includes(r.routePath)) continue

      // 取该路由**上方 3 行**注释（只看紧邻的，不看全文件）
      const src = fs.readFileSync(path.join(ROUTES_DIR, r.file), 'utf8')
      const before = src.slice(Math.max(0, r.startIdx - 260), r.startIdx)
      const comment = (before.match(/\/\/[^\n]*/g) || []).slice(-3).join(' ')
      if (/仅管理员|仅平台\s*admin|只有管理员/.test(comment)) {
        liars.push(`${r.file}  ${r.method} ${r.routePath}  —— 注释声称仅管理员，实际无任何校验`)
      }
    }
    expect(
      liars,
      '以下接口的注释声称「仅管理员」，但代码里没有任何鉴权（注释不是防护）：\n  ' + liars.join('\n  ')
    ).toEqual([])
  })
})

describe('F. 前端调用 city-data 写接口必须自带 token', () => {
  /**
   * 后端收紧权限时最容易踩的坑：前端那几处**裸 fetch** 不带 Authorization ⇒ 一挂就 401。
   * 项目铁律「收紧权限＝先前端」就是为此（先后端会让线上功能当场不可用）。
   * 本组把这个耦合钉住：以后谁把 headers 删了，这里立刻红。
   */
  const REPO_ROOT = path.resolve(HERE, '..', '..')
  const CITY_VIEW = path.join(REPO_ROOT, 'frontend/src/views/CityDataView.vue')
  const SHAPE_VIEW = path.join(REPO_ROOT, 'frontend/src/views/ShapefileView.vue')

  it('CityDataView 引入了统一的 authHeaders（⛔ 不要手写 Bearer）', () => {
    const src = fs.readFileSync(CITY_VIEW, 'utf8')
    expect(src).toContain("import { authHeaders } from '@/utils/authHeaders.js'")
  })

  it('CityDataView 的 DELETE 带鉴权头', () => {
    const src = fs.readFileSync(CITY_VIEW, 'utf8')
    const m = src.match(/fetch\('\/api\/city-data',\s*\{\s*method:\s*'DELETE'[^}]*\}/)
    expect(m, '找不到「一键清除」的 DELETE 调用').toBeTruthy()
    expect(m[0], 'DELETE 没带 authHeaders ⇒ 收紧后这里会 401').toContain('authHeaders()')
  })

  it('CityDataView 的新增/编辑带鉴权头', () => {
    const src = fs.readFileSync(CITY_VIEW, 'utf8')
    expect(src, 'saveEdit 的 headers 没走 authHeaders ⇒ 保存会 401').toContain(
      "authHeaders({ 'Content-Type': 'application/json' })"
    )
  })

  it('两处 el-upload 都注入了 :headers（组件自己发请求，不走 fetch）', () => {
    for (const [view, binding] of [
      [CITY_VIEW, 'uploadHeaders'],
      [SHAPE_VIEW, 'cityDataUploadHeaders'],
    ]) {
      const src = fs.readFileSync(view, 'utf8')
      const idx = src.indexOf('action="/api/city-data/import"')
      expect(idx, `${path.basename(view)} 找不到 city-data 的上传配置`).toBeGreaterThan(-1)
      const tag = src.slice(idx, idx + 400)
      expect(tag, `${path.basename(view)} 的 el-upload 没加 :headers ⇒ 导入会 401`).toContain(
        `:headers="${binding}"`
      )
    }
  })

  it('GET 仍是不带 token 的裸 fetch（保持公开，别顺手加上）', () => {
    const src = fs.readFileSync(CITY_VIEW, 'utf8')
    // loadData 的 GET 必须保持原样：加了 token 反而会让未登录访客看不到数据
    expect(src).toMatch(/fetch\('\/api\/city-data'\)/)
  })
})
