# GeoManager WebGIS 系统 - 阿里云部署指南

## 一、服务器准备

### 1.1 推荐配置
- **实例规格**: 2核2G及以上
- **操作系统**: Ubuntu 20.04 LTS / 22.04 LTS
- **带宽**: 至少1Mbps
- **存储**: 40GB SSD

### 1.2 安全组配置
需要开放以下端口：
- **22**: SSH远程连接
- **80**: HTTP访问
- **443**: HTTPS访问（可选）
- **3000**: 后端API（仅对内开放）

---

## 二、环境安装

### 2.1 更新系统
```bash
sudo apt update && sudo apt upgrade -y
```

### 2.2 安装Node.js 18
```bash
# 使用NodeSource安装
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node -v  # 应显示 v18.x.x
npm -v
```

### 2.3 安装Nginx
```bash
sudo apt install -y nginx
```

### 2.4 安装PM2（进程管理器）
```bash
sudo npm install -g pm2
```

---

## 三、项目部署

### 3.1 创建项目目录
```bash
sudo mkdir -p /var/www/geomanger
cd /var/www/geomanger
sudo chown -R $USER:$USER /var/www/geomanger
```

### 3.2 上传项目文件
可以使用以下方式之一：

**方式一：Git拉取**
```bash
git clone <your-repo-url> /var/www/geomanger
```

**方式二：SCP上传**
```bash
scp -r ./webgis-system user@your-server-ip:/var/www/geomanger
```

### 3.3 安装依赖

**安装后端依赖**
```bash
cd /var/www/geomanger/backend
npm install --production
```

**安装前端依赖**
```bash
cd /var/www/geomanger/frontend
npm install
```

### 3.4 配置环境变量
```bash
cd /var/www/geomanger/backend
cp .env.example .env
nano .env
```

修改以下配置：
```env
PORT=3000
JWT_SECRET=your-very-long-and-secure-secret-key-here
JWT_EXPIRES_IN=7d
```

---

## 四、构建前端

### 4.1 构建生产版本
```bash
cd /var/www/geomanger/frontend
npm run build
```

构建完成后，会生成 `dist` 目录。

### 4.2 创建上传目录
```bash
sudo mkdir -p /var/www/geomanger/uploads
sudo chmod 755 /var/www/geomanger/uploads
```

---

## 五、Nginx配置

### 5.1 创建Nginx配置文件
```bash
sudo nano /etc/nginx/sites-available/geomanger
```

添加以下内容：

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名或IP

    # 前端静态文件
    root /var/www/geomanger/frontend/dist;
    index index.html;

    # Gzip压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # 前端路由
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # API代理
    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # 阻止访问隐藏文件
    location ~ /\. {
        deny all;
    }
}
```

### 5.2 启用站点
```bash
sudo ln -s /etc/nginx/sites-available/geomanger /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # 删除默认站点
sudo nginx -t  # 测试配置
sudo systemctl reload nginx
```

---

## 六、PM2配置

### 6.1 创建PM2配置文件
```bash
cd /var/www/geomanger/backend
nano ecosystem.config.js
```

添加以下内容：

```javascript
module.exports = {
  apps: [{
    name: 'geomanger-api',
    script: 'src/app.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
}
```

### 6.2 创建日志目录
```bash
mkdir -p /var/www/geomanger/backend/logs
```

### 6.3 启动服务
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # 设置开机自启
```

### 6.4 PM2常用命令
```bash
pm2 status              # 查看状态
pm2 logs geomanger-api  # 查看日志
pm2 restart geomanger-api  # 重启
pm2 stop geomanger-api     # 停止
```

---

## 七、SSL证书（可选但推荐）

### 7.1 安装Certbot
```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 7.2 获取证书
```bash
sudo certbot --nginx -d your-domain.com
```

按照提示完成证书申请。

### 7.3 自动续期
Certbot会自动设置续期任务，可以通过以下命令测试：
```bash
sudo certbot renew --dry-run
```

---

## 八、防火墙配置

```bash
# 启用UFW
sudo ufw enable

# 允许SSH（重要！先允许，否则可能断开连接）
sudo ufw allow 22/tcp

# 允许HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 查看状态
sudo ufw status
```

---

## 九、验证部署

### 9.1 检查服务状态
```bash
# 检查Nginx
sudo systemctl status nginx

# 检查PM2
pm2 status

# 检查端口监听
sudo lsof -i :3000
sudo lsof -i :80
```

### 9.2 访问测试
在浏览器中访问：
- `http://your-server-ip` - 应显示登录页面

### 9.3 默认账号
- **用户名**: admin
- **密码**: admin123

---

## 十、故障排查

### 10.1 查看日志
```bash
# Nginx错误日志
sudo tail -f /var/log/nginx/error.log

# PM2日志
pm2 logs geomanger-api

# 后端应用日志
cat /var/www/geomanger/backend/logs/error.log
```

### 10.2 常见问题

**问题1: 前端无法访问API**
- 检查Nginx代理配置
- 检查后端是否正常运行: `pm2 status`
- 检查端口: `lsof -i :3000`

**问题2: 数据库错误**
- 检查数据库文件权限
- 检查SQLite文件是否存在

**问题3: 502 Bad Gateway**
- Nginx无法连接到后端
- 重启服务: `pm2 restart geomanger-api`

---

## 十一、日常维护

### 11.1 备份数据
```bash
# 备份数据库
cp /var/www/geomanger/backend/database/webgis.db /path/to/backup/webgis.db.$(date +%Y%m%d)

# 备份配置文件
tar -czf config-backup.tar.gz /var/www/geomanger/backend/.env
```

### 11.2 更新部署
```bash
cd /var/www/geomanger

# 拉取最新代码
git pull

# 更新后端
cd backend && npm install && pm2 restart geomanger-api

# 更新前端
cd ../frontend && npm install && npm run build
```

---

## 十二、性能优化建议

1. **数据库**: 生产环境建议迁移到PostgreSQL + PostGIS
2. **CDN**: 使用CDN加速静态资源
3. **缓存**: 配置Redis缓存热点数据
4. **监控**: 使用PM2 Plus或New Relic监控应用

---

**部署完成后，你的WebGIS系统就可以通过域名或IP访问了！** 🎉
