/**
 * shapefile 上传链路守卫（v1.13.194）
 *
 * 背景：新增「高精度人口」250m 网格（category=population_hd）时，实测出三个**必然**故障：
 *
 *  ① 单城产物 JSON 实测 99,981,206 B（95.35 MiB）。原实现让它走 Python stdout，
 *     Node 侧随即 JSON.parse + JSON.stringify —— 实测该链路进程峰值 RSS **1.13 GiB**
 *     （parse 后 606MB，stringify 后 1156MB）。而生产服务器总内存 1.6GB、
 *     `free` 显示 available 仅 609MB ⇒ 必然 OOM 拉挂进程。
 *     现已改为：Python **流式**直接写文件（--out），stdout 只回元信息；Node 用
 *     adoptGeoFile 一次 rename 转正。Python 峰值内存同时从 734MB 降到 34.5MB。
 *
 *  ② calculate-population 有一条兜底分支：**不传 shapefileId ⇒ 查全部可见 shapefile**，
 *     而 MapView「商圈人口分布」按半径批量调用那次（MapView.vue 约 3412 行）恰好不传 shapefileId。
 *     若不锁 category，新数据一上线就会被 getGeoObject 全量加载 + 逐要素 turf.intersect
 *     ⇒ 单次请求数百 MB 内存，同样 OOM。
 *
 *  ③ 类别无白名单：category 决定数据被哪些消费点读到，写错一个值就可能让几十万网格
 *     混进逐要素求交的计算里。
 *
 * 本文件是**回归钉子**：谁把 geojson 放回 stdout、把 maxBuffer 调大、把兜底分支的
 * category 去掉、或放开 category 白名单，测试立刻红。
 * （与 cspInlineHandlerGuard / destructiveActionConfirmGuard 一致，挂在 backend 的 vitest 下。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * ⚠️ 必须用 fileURLToPath —— 本项目路径含中文与空格，
 *    `new URL(...).pathname` 会留下 %E5%BE%AE… 百分号编码，导致 fs 报 ENOENT。
 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ROUTE_FILE = path.join(REPO_ROOT, 'backend/src/routes/shapefiles.js')
const PARSER_FILE = path.join(REPO_ROOT, 'backend/src/utils/shapefile_parser.py')

const src = fs.readFileSync(ROUTE_FILE, 'utf8')
const py = fs.readFileSync(PARSER_FILE, 'utf8')

/** 按大括号配平截出函数体（本用途下模板字符串里的 ${…} 是配平的，朴素计数即可） */
function extractFnBody(source, signature) {
  const start = source.indexOf(signature)
  if (start === -1) return null
  const braceStart = source.indexOf('{', start)
  if (braceStart === -1) return null
  let depth = 0
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(braceStart, i + 1)
    }
  }
  return null
}

describe('shapefile 上传：内存安全的落盘链路', () => {
  const body = extractFnBody(src, "router.post('/upload'")

  it('upload 让 Python 直接写盘（传 --out），而不是把 geojson 回传 stdout', () => {
    expect(body, "未找到 upload 路由 —— 断言失效，请更新守卫").toBeTruthy()
    expect(
      body.includes("'--out'"),
      'upload 未传 --out：Python 会把整份 geojson 写进 stdout，Node 侧 JSON.parse 峰值 1.13GiB ⇒ OOM'
    ).toBe(true)
  })

  it('upload 用 adoptGeoFile 转正文件，而不是 writeGeoText 承接整份文本', () => {
    expect(body.includes('adoptGeoFile('), 'upload 未使用 adoptGeoFile 转正文件').toBe(true)
    expect(
      body.includes('writeGeoText('),
      'upload 又用回了 writeGeoText —— 那意味着 95MiB 文本重新回到 Node 内存里'
    ).toBe(false)
  })

  it('maxBuffer 保持在「只装元信息」的量级（≤ 32MiB）', () => {
    const m = src.match(/maxBuffer:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/)
    expect(m, '未找到 execFile 的 maxBuffer —— 断言失效，请更新守卫').toBeTruthy()

    const mb = Number(m[1])
    expect(
      mb,
      `maxBuffer 现为 ${mb}MiB。若有人把整份 geojson 放回 stdout，必须同时重新评估 Node 内存（实测峰值 1.13GiB，本机总内存 1.6GB）`
    ).toBeLessThanOrEqual(32)
  })
})

describe('shapefile_parser.py：流式落盘（单一实现）', () => {
  it('parse_shapefile_from_zip 接受 out_path 参数', () => {
    expect(
      py.includes('def parse_shapefile_from_zip(zip_path, out_path=None)'),
      'Python 解析函数缺少 out_path 参数'
    ).toBe(true)
  })

  it('生成逻辑只有一份 emit(write) —— 两种落地共用，避免实现漂移', () => {
    expect(py.includes('def emit(write)'), '未找到 emit(write) 单一生成逻辑').toBe(true)
    expect(
      (py.match(/def emit\(/g) || []).length,
      'emit 被定义了多次 —— 两套生成逻辑必然漂移'
    ).toBe(1)
  })

  it('逐要素 dumps 必须显式 ensure_ascii=False（否则中文退化成 \\uXXXX 且体积膨胀）', () => {
    expect(
      py.includes('json.dumps(feature, ensure_ascii=False)'),
      '逐要素 dumps 缺少 ensure_ascii=False'
    ).toBe(true)
  })

  it('CLI 支持 --out', () => {
    expect(py.includes("'--out'"), 'CLI 未支持 --out').toBe(true)
  })
})

describe('shapefile 上传：category 白名单', () => {
  it('存在白名单常量，且包含 population / other / population_hd', () => {
    const m = src.match(/const ALLOWED_CATEGORIES = new Set\(\[([^\]]*)\]\)/)
    expect(m, '未找到 ALLOWED_CATEGORIES 白名单 —— 断言失效，请更新守卫').toBeTruthy()

    const list = m[1]
    for (const c of ['population', 'other', 'population_hd']) {
      expect(list, `白名单缺少 ${c}`).toContain(`'${c}'`)
    }
  })

  it('upload 路由在调用解析脚本之前做白名单校验', () => {
    const body = extractFnBody(src, "router.post('/upload'")
    expect(body, "未找到 upload 路由 —— 断言失效，请更新守卫").toBeTruthy()

    const iCheck = body.indexOf('ALLOWED_CATEGORIES.has(category)')
    const iParse = body.indexOf('execFile(')
    expect(iCheck, 'upload 缺少 category 白名单校验').toBeGreaterThan(-1)
    expect(iParse).toBeGreaterThan(-1)
    expect(iCheck, '白名单校验必须在【调用解析脚本之前】').toBeLessThan(iParse)
  })
})

describe('calculate-population：兜底分支必须锁定 category', () => {
  const BARE_QUERY = 'FROM shapefiles WHERE ${vis.clause}'

  it('不存在「不锁 category 就查全部 shapefile」的裸查询', () => {
    const body = extractFnBody(src, "router.post('/calculate-population'")
    expect(body, "未找到 calculate-population 路由 —— 断言失效，请更新守卫").toBeTruthy()

    // 一旦出现这种裸查询，population_hd（单城 95MB / 10.8 万格）就会被全量加载逐要素求交 ⇒ OOM
    expect(
      body.includes(BARE_QUERY),
      `calculate-population 兜底分支出现未锁 category 的裸查询：${BARE_QUERY}`
    ).toBe(false)
  })

  it("兜底分支显式限定 category = 'population'", () => {
    const body = extractFnBody(src, "router.post('/calculate-population'")
    expect(
      body.includes("category = 'population' AND ${vis.clause}"),
      "calculate-population 兜底分支缺少 category='population' 限定（新数据会被误加载）"
    ).toBe(true)
  })
})
