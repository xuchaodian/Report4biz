#!/usr/bin/env python3
import paramiko
import os

HOST = '8.136.207.172'
PORT = 22
USER = 'root'
PASSWORD = 'ZhenXia1984'
REMOTE_PATH = '/var/www/geomanger/frontend'
LOCAL_PATH = '/Users/xuchaodian/WorkBuddy/20260325092251/frontend/dist'

try:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD)
    
    # 确保目录结构存在
    print("创建目录结构...")
    client.exec_command(f'mkdir -p {REMOTE_PATH}/dist/assets')
    
    sftp = client.open_sftp()
    
    # 删除旧文件（保留目录）
    print("删除旧文件...")
    stdin, stdout, stderr = client.exec_command(f'rm -f {REMOTE_PATH}/dist/*')
    stdout.channel.recv_exit_status()
    stdin, stdout, stderr = client.exec_command(f'rm -f {REMOTE_PATH}/dist/assets/*')
    stdout.channel.recv_exit_status()

    # 上传新文件
    print("上传新文件...")
    count = 0
    for root, dirs, files in os.walk(LOCAL_PATH):
        for file in files:
            local_file = os.path.join(root, file)
            rel_path = os.path.relpath(local_file, LOCAL_PATH)
            remote_file = os.path.join(REMOTE_PATH, 'dist', rel_path)
            
            # 确保远程子目录存在
            remote_dir = os.path.dirname(remote_file)
            try:
                sftp.stat(remote_dir)
            except:
                # 创建目录
                parts = rel_path.split(os.sep)
                for i in range(1, len(parts)):
                    try:
                        subdir = os.path.join(REMOTE_PATH, 'dist', *parts[:i])
                        try:
                            sftp.stat(subdir)
                        except:
                            sftp.mkdir(subdir)
                    except:
                        pass
            
            print(f"上传 {rel_path}...")
            try:
                sftp.put(local_file, remote_file)
                count += 1
            except Exception as e:
                print(f"  ⚠️ 上传失败: {e}")
                continue

    sftp.close()
    client.close()
    print(f"✅ 前端部署完成，共上传 {count} 个文件")
except Exception as e:
    import traceback
    print(f"错误: {e}")
    traceback.print_exc()
