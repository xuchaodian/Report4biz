/**
 * 竞品存量基线化脚本（一次性 · 幂等 · 独立运行，见实施计划 §8）
 *
 * 背景：现有 competitors 表（6 品牌 ~8941 家）是"当前列表"，无季度档案。
 * 基线化 = 只建档不搬移：把每个 (user_id, brand) 的现存行按品牌复制为一份基线快照，
 * 并把 competitors 行标记 period/snapshot_id（纳入快照体系 → 下次上传新期会被正确替换）。
 *
 * 运行（sql.js 内存库三步之一：停 pm2 → 编辑磁盘 db → 重启加载）：
 *   cd backend
 *   node scripts/competitor-baseline.js                          # 默认基线期 2026-08
 *   node scripts/competitor-baseline.js --period 2026-08 --dry-run  # 只看不动
 *
 * 幂等：已存在 (user,brand,period) 快照 → 不新建，但会重建快照行并刷新 competitors 标记。
 */
import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { textToStatus, normalizeStoreName } from '../src/utils/competitorSnapshotCore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const getArg = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def }
const DB_PATH = getArg('--db', path.join(__dirname, '../database/webgis.db'))
const PERIOD = getArg('--period', '2026-08')              // 基线期（按存量数据实际月份调整）
const DATA_VERSION = getArg('--version', '存量基线（历史数据建档）')
const DRY_RUN = args.includes('--dry-run')

/** '2026Q3' / '2026-08' → {label, seq} */
function parsePeriod(p) {
  let m = p.match(/^(\d{4})Q([1-4])$/)
  if (m) return { label: p, seq: +m[1] * 100 + +m[2] * 3 }
  m = p.match(/^(\d{4})-(\d{1,2})$/)
  if (m && +m[2] >= 1 && +m[2] <= 12) {
    return { label: `${m[1]}-${String(+m[2]).padStart(2, '0')}`, seq: +m[1] * 100 + +m[2] }
  }
  return null
}
const fp = parsePeriod(PERIOD)
if (!fp) { console.error(`❌ 基线期无效: ${PERIOD}（支持 2026-08 或 2026Q3）`); process.exit(1) }

/* ---------- DDL（与 database.js 保持一致，脚本可独立建表） ---------- */
const DDL = `
  CREATE TABLE IF NOT EXISTS competitor_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    brand TEXT NOT NULL,
    period TEXT NOT NULL,
    period_seq INTEGER NOT NULL,
    source_file TEXT,
    data_version TEXT,
    total_count INTEGER DEFAULT 0,
    open_count INTEGER DEFAULT 0,
    file_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, brand, period)
  );
  CREATE INDEX IF NOT EXISTS idx_cs_user_brand ON competitor_snapshots(user_id, brand);
  CREATE TABLE IF NOT EXISTS competitor_snapshot_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL,
    store_key TEXT NOT NULL,
    name TEXT NOT NULL,
    city TEXT,
    district TEXT,
    address TEXT,
    latitude REAL,
    longitude REAL,
    status TEXT NOT NULL DEFAULT 'unknown',
    extra TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(snapshot_id, store_key),
    FOREIGN KEY (snapshot_id) REFERENCES competitor_snapshots(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_csr_snapshot ON competitor_snapshot_rows(snapshot_id);
  CREATE INDEX IF NOT EXISTS idx_csr_key ON competitor_snapshot_rows(store_key);
`

const esc = v => v === null || v === undefined || v === '' ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'"
const escNum = v => v === null || v === undefined || isNaN(v) ? 'NULL' : String(v)
const hashKey = s => 'h' + crypto.createHash('md5').update(s).digest('hex').slice(0, 14)

async function main() {
  if (!fs.existsSync(DB_PATH)) { console.error(`❌ 数据库不存在: ${DB_PATH}`); process.exit(1) }
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(DB_PATH))
  // competitors 迁移列（幂等）
  for (const stmt of ['ALTER TABLE competitors ADD COLUMN period TEXT', 'ALTER TABLE competitors ADD COLUMN snapshot_id INTEGER']) {
    try { db.run(stmt) } catch (e) { /* 已存在 */ }
  }
  db.run(DDL)
  console.log('✅ 表结构就绪（competitor_snapshots / competitor_snapshot_rows + competitors 迁移列）')

  // 汇总 (user, brand)
  const groups = db.exec(`SELECT user_id, brand, COUNT(*) c FROM competitors WHERE brand IS NOT NULL AND brand != '' GROUP BY user_id, brand ORDER BY user_id, brand`)[0]
  if (!groups || !groups.values.length) { console.log('ℹ️ 无可建档数据（competitors 为空或无品牌）'); return }
  const gIdx = Object.fromEntries(groups.columns.map((c, i) => [c, i]))
  console.log(`\n发现 ${groups.values.length} 个 (用户, 品牌) 组，基线期 ${PERIOD}（period_seq=${fp.seq}）${DRY_RUN ? '【DRY-RUN 仅预览】' : ''}\n`)

  let totalStores = 0, newSnapshots = 0, refreshed = 0
  for (const row of groups.values) {
    const userId = row[gIdx.user_id], brand = row[gIdx.brand]
    totalStores += row[gIdx.c]
    const existingRes = db.exec(`SELECT id FROM competitor_snapshots WHERE user_id=${userId} AND brand=${esc(brand)} AND period=${esc(fp.label)}`)
    const existingId = existingRes[0]?.values?.[0]?.[0] ?? null

    // 该组现有 competitors 行
    const rowsRes = db.exec(`SELECT store_code, name, city, district, address, latitude, longitude, status FROM competitors WHERE user_id=${userId} AND brand=${esc(brand)} ORDER BY id`)
    if (!rowsRes[0]) continue
    const rc = Object.fromEntries(rowsRes[0].columns.map((c, i) => [c, i]))
    // 去重键（同快照内 store_key 唯一）
    const used = new Set()
    const snapRows = []
    for (const r of rowsRes[0].values) {
      const storeCode = String(r[rc.store_code] ?? '').trim()
      const nm = String(r[rc.name] ?? '').trim()
      let key = storeCode || ''
      if (!key || used.has(key)) {
        key = hashKey(`${nm}|${r[rc.city] ?? ''}|${r[rc.district] ?? ''}|${r[rc.address] ?? ''}|${normalizeStoreName(nm)}`)
        if (used.has(key)) key = `${key}_${used.size}`
      }
      used.add(key)
      snapRows.push({
        key, nm,
        city: String(r[rc.city] ?? ''), district: String(r[rc.district] ?? ''),
        addr: String(r[rc.address] ?? ''), lat: r[rc.latitude], lng: r[rc.longitude],
        st: textToStatus(r[rc.status])
      })
    }
    const openCount = snapRows.filter(x => x.st === 'open').length

    if (DRY_RUN) {
      console.log(`[预览] user=${userId} brand=${brand}: ${row[gIdx.c]} 行 → 快照 ${snapRows.length} 行（在营 ${openCount}）${existingId ? '（已有基线，将刷新）' : '（将新建）'}`)
      continue
    }

    // upsert 快照批次
    let snapshotId = existingId
    if (existingId) {
      refreshed++
    } else {
      db.run(`INSERT INTO competitor_snapshots (user_id, brand, period, period_seq, source_file, data_version, total_count, open_count, created_at, updated_at)
              VALUES (${userId}, ${esc(brand)}, ${esc(fp.label)}, ${fp.seq}, '存量基线化', ${esc(DATA_VERSION)}, ${snapRows.length}, ${openCount}, datetime('now'), datetime('now'))`)
      snapshotId = db.exec('SELECT last_insert_rowid()')[0].values[0][0]
      newSnapshots++
    }
    // 重建快照行（保持与当前 competitors 一致）
    db.run(`DELETE FROM competitor_snapshot_rows WHERE snapshot_id=${snapshotId}`)
    const stmt = db.prepare(`INSERT INTO competitor_snapshot_rows (snapshot_id, store_key, name, city, district, address, latitude, longitude, status, created_at)
                             VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))`)
    for (const x of snapRows) stmt.run([snapshotId, x.key, x.nm, x.city, x.district, x.addr, x.lat, x.lng, x.st])
    stmt.free()
    // 标记现有 competitors 行（纳入快照体系，下次上传会被替换）
    db.run(`UPDATE competitors SET period=${esc(fp.label)}, snapshot_id=${snapshotId} WHERE user_id=${userId} AND brand=${esc(brand)}`)
    console.log(`✅ user=${userId} brand=${brand}: ${row[gIdx.c]} 行 → 快照 ${snapRows.length} 行（在营 ${openCount}）${existingId ? '（刷新）' : '（新建）'}`)
  }

  if (DRY_RUN) { console.log('\nDRY-RUN 完成，未写盘。确认无误后去掉 --dry-run 正式执行。'); return }
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()))
  console.log(`\n✅ 基线化完成并写盘: ${DB_PATH}`)
  console.log(`   合计: ${totalStores} 行竞品数据 | 新建 ${newSnapshots} 期快照 | 刷新 ${refreshed} 组已有快照`)
  console.log(`   基线期: ${PERIOD} ｜ 数据版本: ${DATA_VERSION}`)
  console.log('\n下一步: 启动/重启后端，快照表即生效。')
}

main().catch(e => { console.error('❌ 基线化失败:', e); process.exit(1) })
