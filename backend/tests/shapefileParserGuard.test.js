/**
 * shapefile 解析脚本的结构守卫 —— v1.13.331
 *
 * 起因（2026-11-09 商圈换版实测）：
 *   业主上传上海商圈新数据时，脚本报 `NameError: name 'bbox' is not defined`。
 *   根因：v1.13.308 给解析脚本加 bbox 时，把初始化写进了 `emit()` **内部**，
 *   而 `return {...'bbox': bbox}` 在**外层作用域** ⇒ 只要走「写文件」分支就抛异常。
 *
 * 🔴 影响面比看上去大：v1.13.194 起 upload 路由**固定传 --out**（为了不 OOM），
 *   ⇒ `/api/shapefiles/upload` 从 308 到 330 **一直是坏的**（上传任何 shapefile 都 500）。
 *   之所以三个月没人发现：这期间**没有人再上传过** shapefile，测试里也没有一条覆盖这条链路。
 *
 * 本守卫钉的是「变量必须同时对 emit() 与 return 可见」，不是某个具体写法：
 *   ⛔ 不要把初始化挪回 `def emit(` 之后（那正是本次故障）。
 *
 * ⚠️ 为什么不直接跑 Python 验证：CI/本机不一定装了 pyshp，装了也不保证与生产同版本
 *   （生产 pyshp 3.0.3 / 本机 3.1.7）。真正的一致性验证靠「同一份 zip 本地产物 md5 == 生产线产物 md5」，
 *   本次实测两者同为 246562b0df99e078938438accd64532b。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const RAW = fs.readFileSync(path.join(REPO, 'backend/src/utils/shapefile_parser.py'), 'utf8')
// 扫源码必须先剥注释 —— 本文件的说明里就写着 `bbox = [None, None, None, None]` 这句
const SRC = RAW.replace(/#[^\n]*/g, '')

const idxEmit = SRC.indexOf('def emit(')
const idxReturn = SRC.indexOf("'bbox': bbox")

describe('shapefile_parser.py 结构守卫（v1.13.331 上传 500 事故）', () => {
  it('emit() 与 return 都要能找到（定位失败说明脚本被大改，需重写本守卫）', () => {
    expect(idxEmit, '找不到 def emit(').toBeGreaterThan(-1)
    expect(idxReturn, "找不到 'bbox': bbox").toBeGreaterThan(-1)
  })

  it('🔴 bbox 初始化必须在 emit() 之外/之前（写进闭包 ⇒ 外层 return 拿不到 ⇒ 上传 500）', () => {
    const idxInit = SRC.indexOf('bbox = [None, None, None, None]')
    expect(idxInit, '找不到 bbox 初始化').toBeGreaterThan(-1)
    expect(idxInit, 'bbox 被定义在 emit() 内部——这正是 v1.13.308~330 上传必 500 的原因')
      .toBeLessThan(idxEmit)
  })

  it('bbox 确实被回传给 Node（否则落库 minx..maxy 恒 NULL，人口预筛失效）', () => {
    // Node 侧 routes/shapefiles.js 读的是 meta.bbox 四元组
    expect(SRC).toContain("'bbox': bbox")
    const router = fs.readFileSync(path.join(REPO, 'backend/src/routes/shapefiles.js'), 'utf8')
    expect(router).toContain('meta.bbox')
  })

  it('upload 路由仍然走 --out（⛔ 改回 stdout 会让 250m 网格解析峰值冲到 1GB+）', () => {
    const router = fs.readFileSync(path.join(REPO, 'backend/src/routes/shapefiles.js'), 'utf8')
    expect(router).toContain("'--out'")
  })
})
