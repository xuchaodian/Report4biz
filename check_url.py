#!/usr/bin/env python3
import paramiko

HOST = '8.136.207.172'
PORT = 22
USER = 'root'
PASSWORD = 'ZhenXia1984'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD)

# 检查API地址
print("=== 检查智慧足迹API地址 ===")
stdin, stdout, stderr = client.exec_command('''curl -s --max-time 10 -I "https://jm-odp.smartsteps.com" 2>&1 | head -5''')
print(stdout.read().decode())

print("\n=== 尝试获取Token ===")
stdin, stdout, stderr = client.exec_command('''curl -s --max-time 30 "https://jm-odp.smartsteps.com/server/openApi/getAuthorization?key=bdca5013c9a66ab882dc6b82be93e3a8de3"''')
result = stdout.read().decode()
print(result[:500])

# 检查是否能解析域名
print("\n=== DNS解析 ===")
stdin, stdout, stderr = client.exec_command('nslookup jm-odp.smartsteps.com 2>&1')
print(stdout.read().decode())

client.close()
