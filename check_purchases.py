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

# 查询购买记录
stdin, stdout, stderr = client.exec_command(
    'cd /var/www/geomanger/backend && node -e "'
    'const db=require(\"better-sqlite3\")(\"database/webgis.db\");'
    'const rows=db.prepare(\"SELECT id, store_name, user_id, status FROM purchases WHERE status=\\'active\\'\").all();'
    'console.log(JSON.stringify({count: rows.length, records: rows}));'
    '"'
)

result = stdout.read().decode()
print("购买记录:", result)

# 查询门店列表中的名称
stdin2, stdout2, stderr2 = client.exec_command(
    'cd /var/www/geomanger/backend && node -e "'
    'const db=require(\"better-sqlite3\")(\"database/webgis.db\");'
    'const rows=db.prepare(\"SELECT name FROM brand_stores WHERE name LIKE \\'%天安%\\'\").all();'
    'console.log(JSON.stringify(rows));'
    '"'
)

result2 = stdout2.read().decode()
print("门店名称:", result2)

client.close()
