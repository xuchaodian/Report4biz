/**
 * 销售预测交叉验证口径守卫（v1.13.290）
 *
 * 背景：`loocvL2` 原实现是**逐行留一**。真实训练集里同一门店同一年往往有两条记录
 *   （`month=0` 的年汇总行 + `month>0` 的月明细聚合行），且同店多年只有 `yearCode` 不同
 *   ⇒ 「留出一行」时，它的孪生行永远还留在训练集里，模型等于抄答案。
 *   实测 r=0.9984、「去年值」基线 MAPE 仅 3.4%，`cv.mape < 0.35` 这道 L2 门禁形同虚设。
 *
 * 本文件钉住的是**结构性**保证（不是某个固定数值，数值随数据变）：
 *   ① 分组键＝门店 id，同店所有行只算一个组；② 留出时整组移出训练集；
 *   ③ 同一份数据下，分组口径的 MAPE 必须**大于**逐行口径（方向性：只可能更保守）；
 *   ④ 只剩一家店 ⇒ 指标无意义 ⇒ `Infinity`（⛔ 不能返回 0 冒充「很准」）。
 */
import { describe, it, expect } from 'vitest'
import { loocvL2, ridgeFitStd } from '../src/utils/forecastCv.js'

const STORE_EFF = [1000, 1200, 900, 2000, 1500, 1100]

/**
 * 造 6 家店 × 2 年 × 每年 2 条重复记录（模仿 month=0 行 + 月明细聚合行）
 * @param {boolean} uniqueStorePerRow true ⇒ 每行当独立门店（等价于旧的逐行留一）
 */
function buildRows({ uniqueStorePerRow = false } = {}) {
  const rows = []
  STORE_EFF.forEach((eff, si) => {
    for (let yi = 0; yi < 2; yi++) {
      const e = eff * (1 + yi * 0.01) // 第二年只涨 1%
      for (let dup = 0; dup < 2; dup++) {
        rows.push({
          store: { id: uniqueStorePerRow ? `row${rows.length}` : si },
          year: 2023 + yi,
          X: [si * 3, eff / 100, yi], // 特征：门店档位 + 坪效量级 + 年份
          y: Math.log(e)
        })
      }
    }
  })
  return rows
}

describe('loocvL2：必须按门店分组留一（GroupKFold by store）', () => {
  it('同店所有行（多年 + 重复行）只算一个分组', () => {
    const rows = buildRows()
    expect(rows.length).toBe(24)
    const cv = loocvL2(rows, 1)
    expect(cv.groups, '6 家店应被识别为 6 个分组').toBe(6)
    expect(cv.folds, '每个分组都应留出一次').toBe(6)
    expect(cv.n, '误差样本数＝全量行数（留出组内每一行都算误差）').toBe(24)
  })

  it('同一份数据：分组口径的 MAPE 必须严格大于逐行口径（只可能更保守）', () => {
    const cvGroup = loocvL2(buildRows(), 1)
    const cvRow = loocvL2(buildRows({ uniqueStorePerRow: true }), 1)
    expect(cvRow.groups, '对照组：每行一个组').toBe(24)
    // 🔴 核心断言：把孪生行漏在训练集里，指标一定更好看。若这条不再成立，
    //    说明分组逻辑没生效（例如被改回逐行），必须立刻发现。
    expect(
      cvGroup.mape,
      `分组 MAPE(${cvGroup.mape.toFixed(4)}) 未大于逐行 MAPE(${cvRow.mape.toFixed(4)}) —— 分组留一没生效`
    ).toBeGreaterThan(cvRow.mape)
    // ⚠️ 两者具体倍数随数据分布而变（ridge 是全局线性模型，泄漏幅度有限），
    //    ⛔ 不要在这里钉死"必须差 N 倍"，否则换个数据集就红。
    expect(Number.isFinite(cvGroup.residStd)).toBe(true)
  })

  it('只有一家店时无法验证 ⇒ mape=Infinity（⛔ 不能返回 0 冒充「很准」）', () => {
    const rows = buildRows().filter(r => r.store.id === 0) // 只剩 store 0 的行
    const cv = loocvL2(rows, 1)
    expect(cv.groups).toBe(1)
    expect(cv.mape).toBe(Infinity)
    expect(cv.reason).toBe('single_group')
    // 上层写法 `cv.mape < 0.35` 必须判负 ⇒ 自动回退 L1
    expect(cv.mape < 0.35).toBe(false)
  })

  it('缺 store 对象时按行号兜底分组（⛔ 不能静默并成一组）', () => {
    const rows = buildRows().map(r => ({ year: r.year, X: r.X, y: r.y }))
    const cv = loocvL2(rows, 1)
    expect(cv.groups).toBe(24)
  })
})

describe('ridgeFitStd：抽取到 utils 后行为不变', () => {
  it('权重维度正确且可预测', () => {
    const rows = buildRows()
    const m = ridgeFitStd(rows.map(r => r.X), rows.map(r => r.y), 1)
    expect(m.beta.length).toBe(4) // 截距 + 3 个特征
    expect(Number.isFinite(m.predictRaw(rows[0].X))).toBe(true)
  })
})
