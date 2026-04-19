#!/usr/bin/env python3
import subprocess
import json

# SSH 到服务器检查数据库
cmd = [
    'ssh', '-o', 'StrictHostKeyChecking=no',
    '-o', 'PasswordAuthentication=yes',
    '-o', 'BatchMode=yes',
    'root@8.136.207.172',
    'cd /var/www/geomanger/backend && node -e "'
    'const db=require(\"better-sqlite3\")(\"database/webgis.db\");'
    'const rows=db.prepare(\"SELECT * FROM purchases WHERE status=\\'active\\'\").all();'
    'console.log(JSON.stringify({count: rows.length, stores: rows.map(r=>({name: r.store_name, id: r.id}))}));'
    '"'
]

try:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    print("stdout:", result.stdout)
    print("stderr:", result.stderr)
except Exception as e:
    print(f"Error: {e}")
