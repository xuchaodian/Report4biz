#!/usr/bin/env python3
import paramiko

HOST = '8.136.207.172'
PORT = 22
USER = 'root'
PASSWORD = 'ZhenXia1984'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD)

# 检查服务器上的smartsteps.js内容
print("=== 服务器上的 smartsteps.js 第180-190行 ===")
stdin, stdout, stderr = client.exec_command('sed -n "180,190p" /var/www/geomanger/backend/src/routes/smartsteps.js')
print(stdout.read().decode())

# 清空日志并重启
print("\n=== 清空日志并重启 ===")
stdin, stdout, stderr = client.exec_command('pm2 flush && pm2 restart geomanger-api && sleep 2')
print(stdout.read().decode())

# 查看新日志
print("\n=== 新日志 ===")
stdin, stdout, stderr = client.exec_command('pm2 logs geomanger-api --lines 5 --nostream')
print(stdout.read().decode())

client.close()
