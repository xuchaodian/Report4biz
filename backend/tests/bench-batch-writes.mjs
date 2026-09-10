// 万行批量导入落盘计数基准（H3/S1-A 验收）：事务收敛前 N 行=N 次整库 export 落盘 → 收敛后 1 次
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDb = path.join(os.tmpdir(), `r4b-bench-${process.pid}-${Date.now()}.db`)
process.env.R4B_DB_PATH = tmpDb

let dbWrites = 0
const origWrite = fs.writeFileSync
fs.writeFileSync = (...args) => {
  if (String(args[0]).endsWith('.db')) dbWrites++
  return origWrite.apply(fs, args)
}

const { getDb } = await import('../src/models/database.js')
// 注意：fs.writeFileSync 的 patch 保持到脚本末尾，仅在统计间隙清零计数（initDatabase 的写盘已计入 import 阶段）

const db = getDb()
db.exec('CREATE TABLE IF NOT EXISTS bench (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)')
db.exec('DELETE FROM bench')

// —— 场景 1：事务内批量写 10000 行（H3 收敛后形态）——
dbWrites = 0
const t0 = Date.now()
db.beginTx()
for (let i = 0; i < 10000; i++) db.prepare('INSERT INTO bench (v) VALUES (?)').run('tx-' + i)
db.commitTx()
const txMs = Date.now() - t0
const txWrites = dbWrites
const txCount = db.prepare('SELECT COUNT(*) AS c FROM bench').all()[0].c

// —— 场景 2：无事务逐条写 200 行（收敛前形态；1 万行会 ~1 万次 export 过慢，仅用小样本证明"每行落盘"）——
dbWrites = 0
const t1 = Date.now()
for (let i = 0; i < 200; i++) db.prepare('INSERT INTO bench (v) VALUES (?)').run('raw-' + i)
const rawMs = Date.now() - t1
const rawWrites = dbWrites

console.log(JSON.stringify({
  tx: { rows: 10000, writes: txWrites, elapsedMs: txMs, countInDb: txCount },
  raw: { rows: 200, writes: rawWrites, elapsedMs: rawMs }
}, null, 2))

try { fs.unlinkSync(tmpDb) } catch (e) {}
