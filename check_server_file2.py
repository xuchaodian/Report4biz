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
        
        # 查找月驻留相关的列名
        print("查找中文列名:")
        matches = re.findall(r'[\u4e00-\u9fa5]+', content)
        unique_chinese = []
        for m in matches:
            if m not in unique_chinese and len(m) > 2:
                unique_chinese.append(m)
        print("唯一的中文字符串(长度>2):", unique_chinese[:30])
        
        # 查找包含"月"和"次"的模式
        print("\n查找包含'月'和'次'的短语:")
        pattern = re.compile(r'[\u4e00-\u9fa5]*月[\u4e00-\u9fa5]*?次[\u4e00-\u9fa5]*')
        matches2 = pattern.findall(content)
        print(matches2[:20])
                
except Exception as e:
    print(f"错误: {e}")

sftp.close()
client.close()
