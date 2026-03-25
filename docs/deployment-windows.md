# GeoManager WebGIS 系统 - Windows Server 2022 部署指南

## 一、准备工作

### 1.1 服务器要求
- Windows Server 2022
- 2核2G及以上配置
- 安全组开放端口：80, 443, 3000

### 1.2 需要安装的软件
- Node.js 18 LTS
- PM2 (Node.js进程管理器)
- Nginx for Windows

---

## 二、安装 Node.js

### 2.1 下载安装

在服务器上打开 PowerShell（管理员）：

```powershell
# 下载 Node.js 18 LTS
Invoke-WebRequest -Uri "https://nodejs.org/dist/v18.20.0/node-v18.20.0-x64.msi" -OutFile "node-v18.20.0-x64.msi"

# 安装（无提示模式）
Start-Process msiexec.exe -ArgumentList "/i node-v18.20.0-x64.msi /quiet" -Wait

# 验证安装
node -v
npm -v
```

### 2.2 配置npm全局目录（可选）

```powershell
npm config set prefix "C:\nodejs\global"
npm config set cache "C:\nodejs\cache"
```

---

## 三、安装 PM2

```powershell
npm install -g pm2

# 验证
pm2 -v
```

---

## 四、安装 Nginx for Windows

### 4.1 下载

1. 访问：https://nginx.org/en/download.html
2. 下载 `nginx-1.24.0.zip`（或最新稳定版）
3. 解压到 `C:\nginx`

### 4.2 配置环境变量

在 PowerShell（管理员）中：

```powershell
# 添加 到系统 PATH
$env:PATH += ";C:\nginx"
[Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";C:\nginx", "Machine")
```

### 4.3 测试 Nginx

```powershell
cd C:\nginx
start nginx
nginx -v
```

访问 `http://服务器IP` 应该看到 Nginx 欢迎页面。

---

## 五、上传项目代码

### 5.1 本地打包

在本地项目中执行：

```bash
cd /Users/xuchaodian/WorkBuddy/20260325092251

# 打包整个项目（排除node_modules）
tar -czvf webgis-deploy.tar.gz \
  --exclude='frontend/node_modules' \
  --exclude='backend/node_modules' \
  --exclude='frontend/dist' \
  frontend backend docs README.md SPEC.md
```

### 5.2 上传到服务器

使用以下方式之一：

**方式1：SCP（本地执行）**
```bash
scp webgis-deploy.tar.gz user@your-server-ip:C:\
```

**方式2：直接复制粘贴**
- 解压后通过远程桌面复制文件

### 5.3 在服务器解压

```powershell
# 解压
tar -xzvf C:\webgis-deploy.tar.gz -C C:\

# 或用 7-Zip GUI 解压
```

---

## 六、部署后端服务

### 6.1 安装后端依赖

打开 PowerShell（管理员）：

```powershell
cd C:\webgis-system\backend
npm install --production
```

### 6.2 配置环境变量

创建 `C:\webgis-system\backend\.env`：

```env
PORT=3000
JWT_SECRET=your-very-long-and-secure-secret-key-change-in-production
JWT_EXPIRES_IN=7d
```

### 6.3 创建启动脚本

创建 `C:\webgis-system\backend\start.bat`：

```bat
@echo off
cd /d %~dp0
node src/app.js
```

### 6.4 使用 PM2 启动

```powershell
cd C:\webgis-system\backend

# 启动服务
pm2 start start.bat --name "geomanger-api"

# 保存PM2进程列表
pm2 save

# 设置开机自启
pm2 startup
```

### 6.5 测试后端

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health"
```

应该返回：
```json
{"status":"ok","message":"GeoManager API is running"}
```

---

## 七、构建前端

### 7.1 安装前端依赖

```powershell
cd C:\webgis-system\frontend
npm install
```

### 7.2 构建生产版本

```powershell
npm run build
```

构建完成后会生成 `C:\webgis-system\frontend\dist` 目录。

---

## 八、配置 Nginx

### 8.1 编辑配置文件

编辑 `C:\nginx\conf\nginx.conf`：

```nginx
worker_processes  1;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    sendfile        on;
    keepalive_timeout  65;

    # Gzip压缩
    gzip  on;
    gzip_types text/plain text/css application/json application/javascript;

    server {
        listen       80;
        server_name  localhost;

        # 前端静态文件
        root C:/webgis-system/frontend/dist;
        index index.html;

        # 前端路由支持
        location / {
            try_files $uri $uri/ /index.html;
        }

        # API代理
        location /api {
            proxy_pass http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }

        # 静态资源缓存
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 30d;
        }

        # 阻止访问隐藏文件
        location ~ /\. {
            deny all;
        }
    }
}
```

### 8.2 检查并重启 Nginx

```powershell
# 检查配置语法
nginx -t

# 重启 Nginx
nginx -s reload
```

---

## 九、开机自启动配置

### 9.1 PM2 开机自启

```powershell
pm2 startup
# 按照提示执行生成的命令
pm2 save
```

### 9.2 创建 Windows 计划任务

打开 "任务计划程序" → 创建基本任务：

- 名称：`Start GeoManager`
- 触发器：启动时
- 操作：启动程序
- 程序：`C:\nodejs\pm2-runtime.cmd`
- 参数：`C:\webgis-system\backend\pm2.json`

或使用 PowerShell 创建：

```powershell
$action = New-ScheduledTaskAction -Execute "C:\nodejs\node.exe" -Argument "C:\nodejs\node_modules\pm2\pm2-runtime C:\webgis-system\backend\pm2.config.js"
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName "GeoManager" -Action $action -Trigger $trigger -RunLevel Highest
```

---

## 十、验证部署

打开浏览器访问：

```
http://服务器IP
```

应该看到登录页面。

### 默认账号
- 用户名：`admin`
- 密码：`admin123`

---

## 十一、故障排查

### 11.1 查看PM2日志
```powershell
pm2 logs geomanger-api
```

### 11.2 查看Nginx日志
```powershell
Get-Content C:\nginx\logs\error.log -Tail 50
Get-Content C:\nginx\logs\access.log -Tail 50
```

### 11.3 重启服务

```powershell
# 重启后端
pm2 restart geomanger-api

# 重启Nginx
nginx -s reload
```

### 11.4 常见问题

**问题1：页面打不开**
- 检查防火墙是否开放80端口
- 检查Nginx是否运行：`tasklist | findstr nginx`

**问题2：API请求失败**
- 检查后端是否运行：`pm2 status`
- 检查端口3000：`netstat -ano | findstr 3000`

**问题3：CORS跨域问题**
- 确保Nginx配置了正确的代理头

---

## 十二、后续维护

### 12.1 更新代码
```powershell
# 停止服务
pm2 stop geomanger-api

# 更新代码后重新构建前端
cd C:\webgis-system\frontend
npm install
npm run build

# 重启服务
pm2 restart geomanger-api
```

### 12.2 备份数据
```powershell
# 备份数据库
Copy-Item C:\webgis-system\backend\database\webgis.db C:\backups\webgis.db.$(Get-Date -Format "yyyyMMdd")
```

---

**部署完成！有问题随时联系我。** 🎉
