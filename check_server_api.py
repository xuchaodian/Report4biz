#!/usr/bin/env python3
import paramiko
import json

HOST = '8.136.207.172'
PORT = 22
USER = 'root'
PASSWORD = 'ZhenXia1984'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD)

# 查看 API 返回的数据格式
stdin, stdout, stderr = client.exec_command('''cd /var/www/geomanger/backend && node -e "
const db = require('sql.js');
const fs = require('fs');
const initSqlJs = db.default || db;
initSqlJs({locateFile: f => 'https://sql.js.org/dist/'+f}).then(SQL => {
  const file = fs.readFileSync('database/webgis.db');
  const db = new SQL.Database(file);
  const results = db.exec('SELECT id, result_data FROM purchases WHERE result_data IS NOT NULL AND result_data != \\\"\\\" ORDER BY id DESC LIMIT 1');
  if (results.length > 0 && results[0].values.length > 0) {
    try {
      const data = JSON.parse(results[0].values[0][1]);
      if (data.monthly_reach_count) {
        console.log(JSON.stringify(data.monthly_reach_count, null, 2));
      } else {
        console.log('Keys:', Object.keys(data));
        console.log('Sample:', JSON.stringify(data).substring(0, 500));
      }
    } catch(e) {
      console.log('Parse error:', e.message);
      console.log('Raw:', results[0].values[0][1].substring(0, 500));
    }
  } else {
    console.log('No data found');
  }
});
" 2>&1''')

print(stdout.read().decode())
client.close()
