#!/usr/bin/env python3
import paramiko

HOST = '8.136.207.172'
PORT = 22
USER = 'root'
PASSWORD = 'ZhenXia1984'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD)

# 直接测试智慧足迹API
print("=== 直接测试智慧足迹API ===")
cmd = '''curl -s -X POST "https://jm-odp.smartsteps.com/febs/server/openApi/getData" \\
  -H "Content-Type: application/json" \\
  -d '{"codes":"1001,1002,1003","cityMonth":"202603","polygons":"point(121.50652 31.090825)","radius":1000}' '''
stdin, stdout, stderr = client.exec_command(cmd)
result = stdout.read().decode()
print(f"响应: {result[:2000]}")

# 查看PM2日志
print("\n=== PM2日志 ===")
stdin, stdout, stderr = client.exec_command('pm2 logs geomanger-api --lines 10 --nostream')
print(stdout.read().decode())

client.close()
