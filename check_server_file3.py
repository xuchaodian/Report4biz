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
        
        # 检查关键代码是否被压缩
        print("检查排序代码:")
        if 'a.num-b.num' in content or 'a.nu-b.nu' in content:
            print("找到排序代码: a.num - b.num")
        else:
            # 查找 sort 相关代码
            sort_matches = re.findall(r'\.sort\([^)]+\)', content)
            print("找到的 sort 调用:", sort_matches[:5])
        
        print("\n检查 reachLabels:")
        if 'reachLabels' in content:
            print("找到 reachLabels")
        else:
            print("未找到 reachLabels")
            
        print("\n检查中文列名:")
        if '月驻留1次' in content:
            print("找到 '月驻留1次'")
        else:
            print("未找到 '月驻留1次'")
            
        if '月驻留2-4次' in content:
            print("找到 '月驻留2-4次'")
        else:
            print("未找到 '月驻留2-4次'")
            
        # 查找所有包含 reach 的中文内容
        print("\n查找包含 reach 的上下文:")
        matches = re.findall(r'.{20}reach.{20}', content)
        print(matches[:5] if matches else "未找到")
                
except Exception as e:
    print(f"错误: {e}")

sftp.close()
client.close()
