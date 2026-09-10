#!/usr/bin/env node
// 一次性迁移：api_keys.api_key 明文 → sha256(明文)（S-M3 / v1.13.105）
// 幂等：已是 64 位 hex 则跳过。
// 用法：node scripts/hash_api_keys.cjs [db路径]（默认 backend/database/webgis.db）
// 生产执行顺序：pm2 stop webgis-backend → 本脚本 → pm2 start（内存库会加载迁移后的磁盘库）
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

let initSqlJs
try {
  initSqlJs = require('sql.js')
} catch (e) {
  initSqlJs = require(path.join(__dirname, '..', 'node_modules', 'sql.js'))
}

const dbPath = process.argv[2] || path.join(__dirname, '..', 'database', 'webgis.db')
console.log('目标库:', dbPath)
if (!fs.existsSync(dbPath)) {
  console.error('db 不存在:', dbPath)
  process.exit(1)
}

;(async () => {
  const SQL = await initSqlJs()
  const buf = fs.readFileSync(dbPath)
  const db = new SQL.Database(buf)
  const hasTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'")
  if (!hasTable.length || !hasTable[0].values.length) {
    console.log('无 api_keys 表，跳过')
    db.close()
    process.exit(0)
  }
  const rows = db.exec('SELECT id, api_key FROM api_keys')[0]?.values || []
  let changed = 0
  let skipped = 0
  const stmt = db.prepare('UPDATE api_keys SET api_key = ? WHERE id = ?')
  for (const row of rows) {
    const id = row[0]
    const key = row[1]
    if (!key) continue
    if (/^[0-9a-f]{64}$/.test(String(key))) {
      skipped++
      continue
    }
    const h = crypto.createHash('sha256').update(String(key)).digest('hex')
    stmt.run([h, id])
    changed++
  }
  stmt.free()
  console.log(`api_keys 共 ${rows.length} 条：已哈希 ${changed}，跳过(已哈希) ${skipped}`)
  if (changed > 0) {
    const out = db.export()
    fs.writeFileSync(dbPath, Buffer.from(out))
    console.log('已写回:', dbPath)
  } else {
    console.log('无变更')
  }
  db.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
