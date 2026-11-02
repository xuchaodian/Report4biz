/**
 * 「沿用上次圆心」源码守卫 —— v1.13.311（方案 A）
 *
 * 修的 bug（310 真机结论，附录 §6.84.9）：
 *   客户手调了 10 分钟那档 → 想把 15 改成 20 再看 → 点「高精人口分布」→ 必须重新点地图
 *   （旧入口是「进入选点模式 → 点地图 → 才出表单」）→ 而**分析会移动地图**（缩放/平移）
 *   ⇒ 同像素落点坐标变了 ⇒ sameCenter（1e-7 度 ≈ 1cm）恒 false ⇒ 手调形状作废。
 *   根因不在「改档位」，而在**入口强制重新选点**。
 *
 * 本守卫钉住的不变量（都属于「改回去不报错、只是体验退化」的类型）：
 *   A. 两个入口都存在「有上次圆心就直接开弹窗」的分支，且该分支必须早退（不能继续等地图点击）。
 *   B. 「开弹窗」只有一份实现（openCircleDialogAt），且必须打圆心图钉 —— 否则沿用打开时地图上没有标记。
 *   C. 「重新选点」必须走 forcePick，⛔ 不能又落回沿用分支（否则按钮点了没反应）。
 *   D. 门店 popup 那条入口必须清掉沿用标记（它的圆心来自门店坐标，不是「沿用上次」）。
 *   E. 成功分析后必须记 popBandsCenter，**圆模式也记** —— 否则「同位置换个半径再看」仍被逼重选点。
 *   F. 字段加载只剩一份实现（原来三份拷贝各自漂移）。
 *   G. hd 沿用时要还原上次选的数据文件（hd 有多个城市文件，选错 = 换了座城）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const MAP = path.join(REPO_ROOT, 'frontend/src/views/MapView.vue')
const src = fs.readFileSync(MAP, 'utf8')

describe('A. 两个入口都能沿用上次圆心，且必须早退', () => {
  const blocks = [...src.matchAll(/if \(!opts\.forcePick && canReusePopCenter\(\)\) \{([\s\S]*?)\n  \}\n/g)].map(m => m[1])

  it('常住人口 + 高精人口各有一个沿用分支', () => {
    expect(blocks.length, '沿用分支数量不对（应为 2：常住 + 高精）').toBe(2)
  })

  it('分支里直接开弹窗，并用上次圆心', () => {
    for (const b of blocks) {
      expect(b).toContain('openCircleDialogAt(popBandsCenter, true)')
    }
  })

  it('🔴 分支必须 return —— 否则还会继续走「等地图点击」，客户不点就卡住', () => {
    for (const b of blocks) {
      expect(b, '沿用分支少了 return：客户不点地图就永远出不来表单').toContain('return')
    }
  })

  it('两个 open 函数都接受 opts 参数（否则 forcePick 传不进来）', () => {
    expect(src).toContain('const openCirclePopulationDistribution = async (opts = {}) => {')
    expect(src).toContain('const openHdPopulationDistribution = async (opts = {}) => {')
  })

  it('沿用判定依赖 popBandsCenter，且坐标必须是有限数', () => {
    expect(src).toContain('const canReusePopCenter = () => !!(map && popBandsCenter &&')
    expect(src).toContain('Number.isFinite(Number(popBandsCenter.lat))')
  })
})

describe('B. 开弹窗只有一份实现，且必须打图钉', () => {
  it('openCircleDialogAt 只定义一次', () => {
    expect((src.match(/const openCircleDialogAt = /g) || []).length).toBe(1)
  })

  it('传圆心打图钉（沿用打开时地图上要看得出圆心在哪）', () => {
    const m = src.match(/const openCircleDialogAt = [\s\S]{0,900}?\n\}/)
    expect(m, '找不到 openCircleDialogAt 函数体').toBeTruthy()
    expect(m[0]).toContain('showTempCenterMarker(circleForm.center)')
    expect(m[0]).toContain('popCenterReused.value = !!reused')
    expect(m[0]).toContain('circleDialogVisible.value = true')
  })

  it('🔴 不再有「手写坐标 + 直接开弹窗」的第二份拷贝', () => {
    // 两个入口各自的 map.once 回调都必须走 openCircleDialogAt，而不是自己拼 centerText
    expect((src.match(/openCircleDialogAt\(e\.latlng, false\)/g) || []).length, '两处入口都应调用它').toBe(2)
  })
})

describe('C. 「重新选点」必须回到选点模式', () => {
  const m = src.match(/const repickPopCenter = [\s\S]{0,700}?\n\}/)

  it('函数体存在', () => {
    expect(m).toBeTruthy()
  })

  it('两个入口都用 forcePick: true', () => {
    expect(m[0]).toContain('openHdPopulationDistribution({ forcePick: true })')
    expect(m[0]).toContain('openCirclePopulationDistribution({ forcePick: true })')
  })

  it('点之前先清沿用标记（否则弹窗会先闪一下「沿用上次」）', () => {
    expect(m[0]).toContain('popCenterReused.value = false')
  })
})

describe('D. 门店 popup 入口清掉沿用标记', () => {
  const m = src.match(/const openStorePopulationDistribution = [\s\S]*?\n\}\n/)

  it('函数体存在', () => {
    expect(m).toBeTruthy()
  })

  it('设置 popCenterReused.value = false（它的圆心来自门店坐标）', () => {
    expect(
      m[0],
      '门店入口没清沿用标记 ⇒ 弹窗会写「沿用上次分析的圆心」，而实际用的是这家店'
    ).toContain('popCenterReused.value = false')
  })
})

describe('E. 成功分析后记圆心 —— 圆模式也要记', () => {
  it('按「至少一档成功」判断，不是按 !failedBands.length（一档失败但其余成功时也该记）', () => {
    expect(src).toContain('if (apiResults.some(x => x.success)) {')
  })

  it('记录赋值紧随其后', () => {
    expect(src).toMatch(/if \(apiResults\.some\(x => x\.success\)\) \{\s*\n\s*popBandsCenter = \{ lat: centerLat, lng: centerLng \}/)
  })
})

describe('F. 字段加载只剩一份实现', () => {
  it('numericFields 只在共用函数里出现（不再有第二份逐文件拷贝）', () => {
    expect(
      (src.match(/\$\{sf\.id\}\/fields/g) || []).length,
      '又出现第二处「逐个文件取字段」的拷贝了 —— 三份拷贝各自漂移过一次'
    ).toBe(1)
  })

  it('两类优先字段各用各的表（⛔ 合并会把 population 的默认字段改掉）', () => {
    expect(src).toContain("const priority = isHd ? ['居住人数', '常住人口'] : ['常住人口']")
  })

  it('沿用时可带上上次选的字段', () => {
    expect(src).toContain('const preferField = opts.preferField ||')
    expect(src).toContain('(preferField && filteredFields.includes(preferField) ? preferField : \'\')')
  })
})

describe('G. hd 沿用时还原上次的数据文件', () => {
  it('记下 prevHdId 并在列表回来后还原', () => {
    expect(src).toContain('const prevHdId = selectedHdShapefileId.value')
    expect(src).toContain('if (prevHdId && hdShapefileOptions.value.some(o => o.id === prevHdId))')
  })

  it('只在该文件仍存在时才还原（文件被删了不能留一个不存在的 id）', () => {
    const m = src.match(/if \(prevHdId && hdShapefileOptions\.value\.some[^)]*\)\) \{([\s\S]{0,120}?)\}/)
    expect(m).toBeTruthy()
    expect(m[1]).toContain('selectedHdShapefileId.value = prevHdId')
  })
})
