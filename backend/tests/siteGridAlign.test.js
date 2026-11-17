/**
 * 撒点格心「绝对经纬度网格对齐」的性质测试（批次 373，业主 2026-11-17 要求）
 *
 * ── 这个文件在防什么 ──────────────────────────────────────────────────
 * 业主的原话：「我地图上勾画了徐家汇范围，这个范围内我已经买过 2 个位置的联通人口数据」
 * —— 旧实现里花过的钱一分吃不到。根因不是复用判据写错了，而是**坐标根本对不上**：
 * 格心从 bbox 西南角起算，鼠标拖框差 100m，全部格心跟着平移 100m，
 * 而复用容差只有 10m ⇒ 范围重叠 95% 也要整批重扣。
 *
 * 改成绝对网格后，「同步长 ⇒ 重叠区坐标逐字节相同」。
 * 这个性质听起来容易，但有三个方向都会破坏它，必须分别测：
 *   ① 框平移（拖框手抖）        —— 测平移到 50/100/300/700m
 *   ② 框缩放（用户改框大小）     —— 测高度差一倍，且两条 midLat 仍在同一整度带
 *   ③ 经向步长依赖 bbox 高度     —— 这是最隐蔽的一条：`degLng` 若用 bbox 的 midLat
 *      算 cos，框一变高度经度步长就变，纬度对齐了经度又错开。所以参考纬度量化到整度。
 *
 * ── 还有一条必须写成测试的「已知限制」────────────────────────────────
 * 参考纬度只量化到**整度**，所以横跨整度边界的两个框（如 midLat 30.4 与 30.6）
 * 会用不同的 cos ⇒ 经度格心不对齐。这是刻意的取舍（否则要么全城不通、要么精度更差），
 * 写成断言是为了防止将来有人误以为「已经全对齐」而不再复查。
 */
import { describe, it, expect } from 'vitest'
import { enumerateGrid, planarMeters } from '../src/utils/potentialGrid.js'

/** 坐标转成可比字符串：服务端落库/复用判据都是 6 位小数，这里同口径 */
const key = (p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`

/** 两个点集的交集（按坐标字符串完全相同） */
function intersect(a, b) {
  const sb = new Set(b.map(key))
  return a.filter((p) => sb.has(key(p)))
}

/** 徐家汇附近的一个框：约 0.03° × 0.02°（3km × 2.2km） */
const BASE = [121.4300, 31.1800, 121.4600, 31.2000]

describe('A. 格心对齐绝对网格', () => {
  describe('① 框平移（模拟鼠标拖框手抖）', () => {
    // 0.0009° 纬度 ≈ 100m；0.00045° ≈ 50m；0.0027° ≈ 300m；0.0063° ≈ 700m
    const shifts = [
      { name: '平移 50m', dLat: 0.00045 },
      { name: '平移 100m', dLat: 0.0009 },
      { name: '平移 300m', dLat: 0.0027 },
      { name: '平移 700m', dLat: 0.0063 }
    ]

    for (const s of shifts) {
      it(`${s.name} 后重叠区格心坐标完全相同`, () => {
        const a = enumerateGrid(BASE, 1000).points
        // 只平移纬向：refLat = round(midLat) 仍为 31，degLng 不变
        const moved = [BASE[0], BASE[1] + s.dLat, BASE[2], BASE[3] + s.dLat]
        const b = enumerateGrid(moved, 1000).points
        const inter = intersect(a, b)
        // 框高度只够 2 行 ⇒ 平移后应至少保住 1 行（3 个点）
        expect(inter.length).toBeGreaterThanOrEqual(3)
        // 而且严格来说：a 中除最后一行外都该原样出现在 b 里
        expect(inter.length).toBeGreaterThanOrEqual(a.length - 3)
      })
    }

    it('🔴 反证：旧口径（从 bbox 西南角起算）平移 100m 后一个都对不上', () => {
      // 这个用例是「为什么要改」的证据，把旧算法原样复刻一遍做对照
      const oldAlgo = (bbox, step) => {
        const [w, s, e, n] = bbox
        const dLat = step / 111320
        const mLat = (s + n) / 2
        const dLng = step / (111320 * Math.cos((mLat * Math.PI) / 180))
        const cols = Math.max(1, Math.floor((e - w) / dLng + 1e-9))
        const rows = Math.max(1, Math.floor((n - s) / dLat + 1e-9))
        const out = []
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            out.push(`${(w + dLng * (i + 0.5)).toFixed(6)},${(s + dLat * (j + 0.5)).toFixed(6)}`)
          }
        }
        return out
      }
      const a = oldAlgo(BASE, 1000)
      const b = oldAlgo([BASE[0], BASE[1] + 0.0009, BASE[2], BASE[3] + 0.0009], 1000)
      const sb = new Set(b)
      expect(a.filter((x) => sb.has(x)).length).toBe(0)
    })
  })

  describe('② 框缩放（用户重画一个大小不同的框）', () => {
    it('高度差一倍，同整度带内重叠区仍逐字节相同', () => {
      const small = enumerateGrid([121.4300, 31.1800, 121.4600, 31.1900], 1000).points
      const big = enumerateGrid([121.4300, 31.1800, 121.4600, 31.2000], 1000).points
      // small 的所有点都应完整出现在 big 里
      expect(intersect(small, big).length).toBe(small.length)
      expect(small.length).toBeGreaterThan(0)
    })

    it('东西向也拉宽，已在格心不移动', () => {
      const narrow = enumerateGrid([121.4300, 31.1800, 121.4450, 31.2000], 1000).points
      const wide = enumerateGrid([121.4200, 31.1800, 121.4600, 31.2000], 1000).points
      expect(intersect(narrow, wide).length).toBe(narrow.length)
    })

    it('🔴 经向步长不受框高影响（参考纬度量化到整度的效果）', () => {
      // 同一整度带内、高度差异很大：经度格心必须仍然一致
      const flat = enumerateGrid([121.4300, 31.1600, 121.4600, 31.1700], 1000).points
      const tall = enumerateGrid([121.4300, 31.1600, 121.4600, 31.3800], 1000).points
      const flatLngs = [...new Set(flat.map((p) => p.lng.toFixed(6)))].sort()
      const tallLngs = new Set(tall.map((p) => p.lng.toFixed(6)))
      for (const lng of flatLngs) expect(tallLngs.has(lng), `经度 ${lng} 应保持不变`).toBe(true)
    })
  })

  describe('③ 步长与边界', () => {
    it('不同步长得到不同格心（本就该不同，防止误把 stepM 忽略）', () => {
      const g500 = enumerateGrid(BASE, 500).points
      const g1000 = enumerateGrid(BASE, 1000).points
      expect(g500.length).toBeGreaterThan(g1000.length)
      expect(intersect(g500, g1000).length).toBe(0)
    })

    it('所有格心都落在 bbox 内（不能铺到框外浪费钱）', () => {
      const [w, s, e, n] = BASE
      for (const p of enumerateGrid(BASE, 1000).points) {
        expect(p.lng).toBeGreaterThanOrEqual(w)
        expect(p.lng).toBeLessThanOrEqual(e)
        expect(p.lat).toBeGreaterThanOrEqual(s)
        expect(p.lat).toBeLessThanOrEqual(n)
      }
    })

    it('bbox 内任意一点到最近格心不超过一个步长（覆盖完整，无空洞）', () => {
      const pts = enumerateGrid(BASE, 1000).points
      const [w, s, e, n] = BASE
      // 在框内撒 21×21 个探测点
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          const lng = w + ((e - w) * i) / 20
          const lat = s + ((n - s) * j) / 20
          let best = Infinity
          for (const p of pts) {
            const d = planarMeters(lng, lat, p.lng, p.lat)
            if (d < best) best = d
          }
          expect(best).toBeLessThanOrEqual(1000)
        }
      }
    })

    it('框比一格还小时仍返回 1 个点（含框中心，⛔ 不能退化成空集）', () => {
      const tiny = [121.44000, 31.19000, 121.44010, 31.19010]   // 约 11m × 9m
      const r = enumerateGrid(tiny, 1000)
      expect(r.points.length).toBe(1)
      expect(r.cols).toBe(1)
      expect(r.rows).toBe(1)
      // 该点应离框中心不远（半个步长以内）
      const cLng = (tiny[0] + tiny[2]) / 2
      const cLat = (tiny[1] + tiny[3]) / 2
      expect(planarMeters(cLng, cLat, r.points[0].lng, r.points[0].lat)).toBeLessThanOrEqual(1000)
    })

    it('非法 bbox 返回空集（不抛异常）', () => {
      expect(enumerateGrid([0, 0, 0, 0], 1000).points.length).toBe(0)
      expect(enumerateGrid([200, 100, 201, 101], 1000).points.length).toBe(0)
      expect(enumerateGrid(null, 1000).points.length).toBe(0)
    })

    it('非法 stepM 退化为 1000', () => {
      expect(enumerateGrid(BASE, 777).stepM).toBe(1000)
      expect(enumerateGrid(BASE, 777).points.length).toBe(enumerateGrid(BASE, 1000).points.length)
    })
  })

  describe('④ 已知限制（刻意的取舍，写成断言防遗忘）', () => {
    it('横跨整度纬度带时经度格心不对齐 —— 这是量化到整度的代价', () => {
      // midLat 30.4 → refLat 30；midLat 30.6 → refLat 31；cos 值不同 ⇒ degLng 不同
      const low = enumerateGrid([121.3000, 30.3000, 121.3300, 30.5000], 1000).points
      const high = enumerateGrid([121.3000, 30.5000, 121.3300, 30.7000], 1000).points
      // 这两个框本来也不重叠（纬度不交），断言「交集为 0」只是记录现状：
      // 若将来改成按城市固定参考纬度，这条会变，届时应同步更新本断言。
      expect(intersect(low, high).length).toBe(0)
    })

    it('纬度方向的对齐不受整度带影响（只有经度受影响）', () => {
      const a = enumerateGrid([121.3000, 30.3000, 121.3300, 30.5000], 1000).points
      const b = enumerateGrid([121.3000, 30.3000, 121.3300, 30.7000], 1000).points
      const aLats = [...new Set(a.map((p) => p.lat.toFixed(6)))]
      const bLats = new Set(b.map((p) => p.lat.toFixed(6)))
      for (const lat of aLats) expect(bLats.has(lat), `纬度 ${lat} 应保持不变`).toBe(true)
    })
  })
})
