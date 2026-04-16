#!/usr/bin/env python3
import paramiko

HOST = '8.136.207.172'
PORT = 22
USER = 'root'
PASSWORD = 'ZhenXia1984'

NGINX_CONFIG = '''server {
    server_name mka-online.cn www.mka-online.cn;
    root /var/www/geomanger/frontend/dist;
    index index.html;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    location /assets/ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        # 增加超时时间，支持智慧足迹API长时间响应
        proxy_read_timeout 300;
        proxy_connect_timeout 60;
        proxy_send_timeout 300;
    }

    location /uploads {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/mka-online.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mka-online.cn/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = www.mka-online.cn) {
        return 301 https://$host$request_uri;
    }

    if ($host = mka-online.cn) {
        return 301 https://$host$request_uri;
    }

    listen 80;
    server_name mka-online.cn www.mka-online.cn;
    return 404;
}
'''

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, port=PORT, username=USER, password=PASSWORD)

# 写入新配置
print("写入新的 Nginx 配置...")
sftp = client.open_sftp()
with sftp.file('/etc/nginx/sites-enabled/geomanger', 'w') as f:
    f.write(NGINX_CONFIG)
sftp.close()

# 测试配置并重载
print("测试 Nginx 配置...")
stdin, stdout, stderr = client.exec_command('nginx -t')
print(stdout.read().decode())
if stderr.read().decode():
    print("错误:", stderr.read().decode())

print("重载 Nginx...")
stdin, stdout, stderr = client.exec_command('nginx -s reload')
print(stdout.read().decode() or "重载成功")
if stderr.read().decode():
    print("错误:", stderr.read().decode())

client.close()
print("\n✅ Nginx 超时配置已更新为 300 秒")
