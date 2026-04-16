#!/usr/bin/env python3
import paramiko

HOST = '8.136.207.172'
PORT = 22
USER = 'root'
PASSWORD = 'ZhenXia1984'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD)

# 强制停止并重新启动
print("=== 重启 PM2 ===")
stdin, stdout, stderr = client.exec_command('pm2 stop geomanger-api && sleep 1 && pm2 start /var/www/geomanger/ecosystem.config.cjs && sleep 2 && pm2 logs geomanger-api --lines 10 --nostream')
print(stdout.read().decode())

client.close()
