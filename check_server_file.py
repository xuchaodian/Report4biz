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
    # 列出 assets 目录下的 MyAccountView 文件
    stdin, stdout, stderr = client.exec_command('ls -la /var/www/geomanger/frontend/dist/assets/ | grep -i myaccount')
    print("服务器上的 MyAccountView 文件:")
    print(stdout.read().decode())
    
    # 检查文件内容
    with sftp.open('/var/www/geomanger/frontend/dist/assets/MyAccountView-CuiMBQgK.js', 'r') as f:
        content = f.read().decode('utf-8', errors='ignore')
        # 查找 reachLabels 相关代码
        import re
        # 查找 reachLabels 定义
        match = re.search(r'reachLabels\s*=\s*\{[^}]+\}', content)
        if match:
            print("\n找到 reachLabels 定义:")
            print(match.group(0))
        else:
            print("\n未找到 reachLabels 定义，查找旧的 fieldLabels:")
            match2 = re.search(r'fieldLabels\s*=\s*\{[^}]+\}', content)
            if match2:
                print(match2.group(0))
            else:
                print("也未找到 fieldLabels")
                
        # 查找列名生成逻辑
        match3 = re.search(r'for\s*\([^)]+reachFields[^)]+\)\s*\{[^}]+html\s*\+=\s*`<th>[^<]+</th>`', content, re.DOTALL)
        if match3:
            print("\n找到列名生成代码片段:")
            print(match3.group(0)[:500])
                
except Exception as e:
    print(f"错误: {e}")
    import traceback
    traceback.print_exc()

sftp.close()
client.close()
