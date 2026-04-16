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

# 查看PM2日志
print("=== PM2日志 ===")
stdin, stdout, stderr = client.exec_command('pm2 logs geomanger-api --lines 5 --nostream')
print(stdout.read().decode())

# 测试智慧足迹API可达性
print("\n=== 测试智慧足迹API ===")
stdin, stdout, stderr = client.exec_command('curl -s --max-time 30 "https://jm-odp.smartsteps.com/server/openApi/getAuthorization?key=bdca5013c9a66ab882dc6b82be93e3a8de3"')
result = stdout.read().decode()
print(f"响应: {result[:300]}")

client.close()
