#!/usr/bin/env python3
import paramiko

HOST = '8.136.207.172'
PORT = 22
USER = 'root'
PASSWORD = 'ZhenXia1984'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD)

# 检查服务器上的文件
sftp = client.open_sftp()
try:
    with sftp.open('/var/www/geomanger/frontend/dist/assets/MyAccountView-CuiMBQgK.js', 'r') as f:
        content = f.read().decode('utf-8', errors='ignore')
        import re
        matches = re.findall(r'月驻留[\u4e00-\u9fa5\d\-次]+', content)
        print("服务器上的列名:", matches[:10] if matches else "未找到")
except Exception as e:
    print(f"错误: {e}")

sftp.close()
client.close()
