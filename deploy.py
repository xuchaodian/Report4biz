#!/usr/bin/env python3
import paramiko
import os

HOST = '8.136.207.172'
PORT = 22
USER = 'root'
PASSWORD = 'ZhenXia1984'
REMOTE_PATH = '/var/www/geomanger/backend'
LOCAL_PATH = '/Users/xuchaodian/WorkBuddy/20260325092251/backend'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD)
sftp = client.open_sftp()

# 上传后端 routes 目录
local_routes = f"{LOCAL_PATH}/src/routes"
remote_routes = f"{REMOTE_PATH}/src/routes"

for file in ['smartsteps.js', 'users.js', 'purchase.js']:
    local_file = f"{local_routes}/{file}"
    remote_file = f"{remote_routes}/{file}"
    print(f"上传 {file}...")
    sftp.put(local_file, remote_file)

sftp.close()

# 重启 PM2
stdin, stdout, stderr = client.exec_command('pm2 restart geomanger-api && sleep 2 && pm2 status')
print(stdout.read().decode())

client.close()
print("✅ 后端更新完成")
