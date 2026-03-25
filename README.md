# GeoManager - WebGIS 地理信息管理系统

🌐 基于 Vue 3 + Node.js 的企业级WebGIS系统

## 功能特性

- 🗺️ **地图功能**: 高德地图底图、缩放平移、图层切换
- 📍 **标注管理**: 添加、编辑、删除、拖拽定位点位
- ✏️ **绘制工具**: 折线、多边形、矩形、圆形绘制
- 📊 **数据可视化**: 热力图、聚合显示、颜色编码
- 📏 **空间分析**: 距离量算、面积量算、范围查询
- 👥 **用户管理**: 多用户、角色权限、数据隔离
- 📁 **数据管理**: 批量导入导出、分页筛选

## 快速开始

### 环境要求
- Node.js 18+
- npm 9+

### 安装

```bash
# 克隆项目
git clone <your-repo>
cd webgis-system

# 安装后端依赖
cd backend
npm install

# 安装前端依赖
cd ../frontend
npm install
```

### 启动开发服务器

```bash
# 终端1: 启动后端
cd backend
npm run dev

# 终端2: 启动前端
cd frontend
npm run dev
```

访问 http://localhost:5173

### 默认账号
- 用户名: `admin`
- 密码: `admin123`

## 技术栈

| 前端 | 后端 |
|------|------|
| Vue 3 | Node.js |
| Vite | Express |
| Element Plus | SQLite |
| Leaflet | JWT |
| Pinia | bcrypt |

## 项目结构

```
webgis-system/
├── frontend/           # Vue 3 前端
│   ├── src/
│   │   ├── views/     # 页面视图
│   │   ├── components/# 组件
│   │   ├── stores/    # Pinia状态
│   │   └── utils/     # 工具函数
│   └── package.json
│
├── backend/           # Node.js 后端
│   ├── src/
│   │   ├── routes/    # API路由
│   │   ├── models/    # 数据模型
│   │   └── middleware/# 中间件
│   └── package.json
│
├── docs/              # 文档
│   └── deployment.md # 部署指南
│
└── SPEC.md           # 项目规范
```

## 部署到阿里云

详见 [部署指南](docs/deployment.md)

## 许可证

MIT License
