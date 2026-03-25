#!/bin/bash

# GeoManager 启动脚本

echo "=========================================="
echo "   GeoManager WebGIS 系统"
echo "=========================================="

# 设置Node.js路径
export PATH="/Users/xuchaodian/.workbuddy/binaries/node/versions/22.12.0/bin:$PATH"

# 先关闭已有进程
echo "清理旧进程..."
pkill -f "node src/app.js" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

# 创建数据库目录
mkdir -p "$(dirname "$0")/backend/database"

# 启动后端
echo "[1/2] 启动后端服务..."
cd "$(dirname "$0")/backend"
node src/app.js > /tmp/geomanger-backend.log 2>&1 &
BACKEND_PID=$!

# 等待后端启动
sleep 3

# 检查后端是否启动成功
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "❌ 后端启动失败！"
    echo "错误日志:"
    cat /tmp/geomanger-backend.log
    exit 1
fi

# 检查端口
if ! lsof -i :3000 > /dev/null 2>&1; then
    echo "❌ 后端端口3000未监听"
    cat /tmp/geomanger-backend.log
    exit 1
fi

echo "✅ 后端服务已启动 (PID: $BACKEND_PID)"

# 启动前端开发服务器
echo "[2/2] 启动前端服务..."
cd "$(dirname "$0")/frontend"
npm run dev > /tmp/geomanger-frontend.log 2>&1 &
FRONTEND_PID=$!

sleep 3

# 检查前端是否启动成功
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "❌ 前端启动失败！"
    echo "错误日志:"
    cat /tmp/geomanger-frontend.log
    exit 1
fi

echo "✅ 前端服务已启动 (PID: $FRONTEND_PID)"

echo ""
echo "=========================================="
echo "   ✅ 所有服务已成功启动！"
echo "=========================================="
echo ""
echo "   🌐 前端: http://localhost:5173"
echo "   🔌 后端: http://localhost:3000"
echo ""
echo "   默认账号: admin / admin123"
echo ""
echo "   日志文件:"
echo "   - 后端: /tmp/geomanger-backend.log"
echo "   - 前端: /tmp/geomanger-frontend.log"
echo ""
echo "   按 Ctrl+C 停止所有服务"
echo "=========================================="

# 保存PID到文件
echo "$BACKEND_PID $FRONTEND_PID" > /tmp/geomanger.pids

# 等待退出
wait
