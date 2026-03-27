#!/usr/bin/env python3
import paramiko
import os

HOST = '8.136.207.172'
USER = 'root'
PASS = 'ZhenXia1984'
LOCAL_DIST = '/Users/xuchaodian/WorkBuddy/20260325092251/frontend/dist'
REMOTE_DIR = '/var/www/geomanger/frontend/dist'

def upload_dir(sftp, local_path, remote_path):
    try:
        sftp.stat(remote_path)
    except FileNotFoundError:
        sftp.mkdir(remote_path)
    
    for item in os.listdir(local_path):
        local_item = os.path.join(local_path, item)
        remote_item = remote_path + '/' + item
        if os.path.isdir(local_item):
            upload_dir(sftp, local_item, remote_item)
        else:
            sftp.put(local_item, remote_item)
            print(f'  上传: {remote_item}')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS)

# 清空远端 dist
stdin, stdout, stderr = ssh.exec_command(f'rm -rf {REMOTE_DIR} && mkdir -p {REMOTE_DIR}')
stdout.channel.recv_exit_status()
print('远端目录已清空')

sftp = ssh.open_sftp()
upload_dir(sftp, LOCAL_DIST, REMOTE_DIR)
sftp.close()
ssh.close()
print('\n部署完成！')
