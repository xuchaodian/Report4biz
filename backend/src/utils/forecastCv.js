/**
 * 销售预测 · L2 岭回归与交叉验证（v1.13.290 从 routes/sales-forecast.js 抽出）
 *
 * 为什么单独成文件：
 *   ① 原 `loocvL2` 是**逐行留一**，同一门店的多年样本仍留在训练集里 —— 同店各年
 *      只有 `yearCode` 不同、其余特征几乎一样，模型等于「抄答案」。实测 r=0.9984、
 *      「去年值」基线 MAPE 仅 3.4% ⇒ CV 指标严重偏乐观，`cv.mape < 0.35` 这道
 *      L2 门禁形同虚设。改法必须能被单测钉住，而路由文件 import 了 turf/geoStore
 *      （会加载商圈矢量），不适合被测试直接 import。
 *   ② 顺带统一「派生算法只写一份」的约定（见 utils/vipRole.js 的同类教训）。
 *
 * 🔴 分组口径：`row.store.id` 为组键；**同一门店的所有行（多年 / 月汇总行）整组留出**。
 *    ⚠️ 组数 < 2（只剩一家店的样本）⇒ 无法验证，`mape` 返回 `Infinity`，
 *    让上层 `cv.mape < 0.35`、`l3m.mape <= cvL2.mape` 自然判负、回退 L1。
 *    ⛔ 绝不能返回 0 或「跳过检查」—— 那等于「样本越少越自信」。
 */

// ===== 最小矩阵运算 =====
function matMul(A, B) {
  const m = A.length, n = A[0].length, p = B[0].length
  const C = Array.from({ length: m }, () => new Array(p).fill(0))
  for (let i = 0; i < m; i++) for (let k = 0; k < n; k++) { const a = A[i][k]; if (!a) continue; for (let j = 0; j < p; j++) C[i][j] += a * B[k][j] }
  return C
}
function matTrans(A) { return A[0].map((_, j) => A.map(r => r[j])) }
function matInv(A) {
  const n = A.length
  const aug = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col; r < n; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r
    if (Math.abs(aug[pivot][col]) < 1e-12) throw new Error('矩阵奇异')
    ;[aug[col], aug[pivot]] = [aug[pivot], aug[col]]
    const pv = aug[col][col]
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pv
    for (let r = 0; r < n; r++) { if (r === col) continue; const f = aug[r][col]; for (let j = 0; j < 2 * n; j++) aug[r][j] -= f * aug[col][j] }
  }
  return aug.map(row => row.slice(n))
}

/** Ridge 回归（特征 z-score 标准化 + 截距列 + L2 正则），返回可预测模型 */
export function ridgeFitStd(Xraw, y, lambda = 1) {
  const n = Xraw.length, d = Xraw[0].length
  const mean = new Array(d).fill(0), std = new Array(d).fill(1)
  for (let j = 0; j < d; j++) { let s = 0; for (let i = 0; i < n; i++) s += Xraw[i][j]; mean[j] = s / n }
  for (let j = 0; j < d; j++) { let s = 0; for (let i = 0; i < n; i++) s += (Xraw[i][j] - mean[j]) ** 2; std[j] = Math.sqrt(s / n) || 1 }
  const X = Xraw.map(r => [1, ...r.map((v, j) => (v - mean[j]) / std[j])])
  const Xt = matTrans(X)
  const XtX = matMul(Xt, X)
  for (let i = 1; i < XtX.length; i++) XtX[i][i] += lambda
  const Xty = Xt.map(row => [row.reduce((s, v, k) => s + v * y[k], 0)])
  const beta = matMul(matInv(XtX), Xty).map(r => r[0])
  return {
    mean, std, beta,
    predictRaw(x) { const xs = x.map((v, j) => (v - this.mean[j]) / this.std[j]); return this.beta[0] + xs.reduce((s, v, i) => s + v * this.beta[i + 1], 0) }
  }
}

/** 取分组键：优先门店 id；无 store 对象时才退回行号（等价逐行，仅测试用） */
function groupKeyOf(row, i) {
  const id = row && row.store ? row.store.id : null
  return id == null ? `_row${i}` : `store${id}`
}

/**
 * 按**门店分组**留一交叉验证（GroupKFold by store）→ MAPE + 残差百分比 std（置信度）
 * @param {Array<{store:{id:number}, X:number[], y:number}>} rows
 * @returns {{mape:number, residStd:number, groups:number, folds:number, n:number, reason?:string}}
 */
export function loocvL2(rows, lambda = 1) {
  const groups = new Map()
  rows.forEach((r, i) => {
    const k = groupKeyOf(r, i)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(i)
  })
  if (groups.size < 2) {
    // 只有一家店 ⇒ 无独立验证集，指标无意义
    return { mape: Infinity, residStd: Infinity, groups: groups.size, folds: 0, n: 0, reason: 'single_group' }
  }
  const errs = []
  let folds = 0
  for (const held of groups.values()) {
    const out = new Set(held)
    const train = rows.filter((_, j) => !out.has(j))
    if (train.length < 2) continue // 留出这组后没样本可学，该折无意义（不记入）
    const model = ridgeFitStd(train.map(r => r.X), train.map(r => r.y), lambda)
    for (const i of held) {
      const predEff = Math.exp(model.predictRaw(rows[i].X))
      const actEff = Math.exp(rows[i].y)
      errs.push(Math.abs(predEff - actEff) / actEff)
    }
    folds++
  }
  if (!errs.length) {
    return { mape: Infinity, residStd: Infinity, groups: groups.size, folds: 0, n: 0, reason: 'no_fold' }
  }
  const mape = errs.reduce((a, b) => a + b, 0) / errs.length
  const sd = Math.sqrt(errs.reduce((a, b) => a + (b - mape) ** 2, 0) / errs.length)
  return { mape, residStd: sd, groups: groups.size, folds, n: errs.length }
}
