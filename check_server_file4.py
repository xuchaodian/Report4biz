#!/usr/bin/env python3
import paramiko
import re

HOST = '8.136.207.172'
PORT = 22
USER = 'root'
PASSWORD = 'ZhenXia1984'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD)

sftp = client.open_sftp()
try:
    with sftp.open('/var/www/geomanger/frontend/dist/assets/MyAccountView-CuiMBQgK.js', 'r') as f:
        content = f.read().decode('utf-8', errors='ignore')
        
        # 查找 reachFields.sort 相关代码
        print("查找 reachFields.sort 的上下文:")
        match = re.search(r'reach[^;]{0,50}sort[^;]{0,100}', content)
        if match:
            print(match.group(0))
        else:
            print("未找到直接匹配")
            
        # 查找所有排序相关代码
        print("\n所有排序调用:")
        for m in re.finditer(r'\.sort\([^)]+\)', content):
            start = max(0, m.start() - 50)
            end = min(len(content), m.end() + 100)
            context = content[start:end]
            if 'reach' in context.lower() or 'num' in context.lower():
                print(f"位置 {m.start()}: ...{context}...")
                
except Exception as e:
    print(f"错误: {e}")

sftp.close()
client.close()
