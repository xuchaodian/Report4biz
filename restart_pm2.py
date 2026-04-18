#!/usr/bin/env python3
import paramiko
import time

HOST = '8.136.207.172'
PORT = 22
USER = 'root'
PASSWORD = 'ZhenXia1984'

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD)

# 重启 PM2
stdin, stdout, stderr = client.exec_command('pm2 restart geomanger-api && sleep 2 && pm2 status')
print(stdout.read().decode())

client.close()
print("PM2 重启完成")
