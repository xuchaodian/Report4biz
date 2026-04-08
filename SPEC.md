# WebGIS 地理信息管理系统 - 项目规范

## 1. 项目概述

**项目名称**: 选址赢家Online - 智能选址分析平台
**项目类型**: PC端Web应用
**核心功能**: 基于WebGIS的业务数据点位管理平台
**目标用户**: 企业运维人员、数据分析师、管理层

## 2. 技术架构

### 前端技术栈
- **框架**: Vue 3 (Composition API) + Vite
- **UI组件**: Element Plus
- **地图库**: Leaflet + leaflet-gaode (高德地图插件)
- **状态管理**: Pinia
- **HTTP客户端**: Axios
- **图表库**: ECharts

### 后端技术栈
- **运行时**: Node.js 18+
- **框架**: Express.js
- **数据库**: SQLite (开发) / PostgreSQL (生产)
- **认证**: JWT (JSON Web Token)
- **密码加密**: bcrypt

### 数据存储
- 用户数据、点位数据存储在后端数据库
- 地图瓦片使用高德地图服务

## 3. 功能模块

### 3.1 用户认证模块
- [x] 用户注册 (用户名、密码、邮箱)
- [x] 用户登录 (JWT Token)
- [x] 密码加密存储
- [x] 登录状态保持
- [x] 登出功能

### 3.2 地图基础功能
- [x] 地图加载与显示 (高德底图)
- [x] 缩放控制 (鼠标滚轮、按钮、触控)
- [x] 平移操作
- [x] 比例尺显示
- [x] 坐标显示 (鼠标悬停位置)
- [x] 鹰眼图 (小地图)

### 3.3 图层管理
- [x] 底图切换 (矢量/影像)
- [x] 业务图层显示/隐藏
- [x] 图层透明度调节
- [x] 图层顺序调整

### 3.4 标注与绘制
- [x] 标注点 (Marker) - 拖拽定位
- [x] 绘制折线 (Polyline)
- [x] 绘制多边形 (Polygon)
- [x] 绘制矩形 (Rectangle)
- [x] 绘制圆形 (Circle)
- [x] 绘制清除
- [x] 绘制样式自定义 (颜色、线宽)

### 3.5 数据可视化
- [x] 点位聚合 (MarkerCluster)
- [x] 热力图 (Heatmap Layer)
- [x] 点位图标自定义
- [x] 点位弹窗信息 (Popup)
- [x] 点位颜色编码 (按类别/状态)

### 3.6 空间查询与分析
- [x] 范围查询 (矩形/圆形/多边形内)
- [x] 距离量算
- [x] 面积量算
- [x] 点位数量统计

### 3.7 业务数据管理
- [x] 数据列表展示 (分页、搜索)
- [x] 新增点位
- [x] 编辑点位
- [x] 删除点位
- [x] 批量导入 (CSV)
- [x] 数据导出 (JSON/CSV)

### 3.8 用户管理 (管理员)
- [x] 用户列表
- [x] 添加用户
- [x] 编辑用户
- [x] 删除用户
- [x] 角色权限 (普通用户/管理员)

## 4. 数据库设计

### 用户表 (users)
```
id: INTEGER PRIMARY KEY
username: VARCHAR(50) UNIQUE
password: VARCHAR(255)  -- bcrypt加密
email: VARCHAR(100)
role: VARCHAR(20)  -- 'user' | 'admin'
created_at: DATETIME
```

### 点位表 (markers)
```
id: INTEGER PRIMARY KEY
name: VARCHAR(100)
category: VARCHAR(50)
latitude: DECIMAL(10, 7)
longitude: DECIMAL(10, 7)
description: TEXT
status: VARCHAR(20)
icon_color: VARCHAR(20)
user_id: INTEGER FK
created_at: DATETIME
updated_at: DATETIME
```

## 5. API 接口设计

### 认证接口
- `POST /api/auth/register` - 注册
- `POST /api/auth/login` - 登录
- `GET /api/auth/me` - 获取当前用户

### 点位接口
- `GET /api/markers` - 获取所有点位
- `POST /api/markers` - 创建点位
- `PUT /api/markers/:id` - 更新点位
- `DELETE /api/markers/:id` - 删除点位
- `POST /api/markers/import` - 批量导入
- `GET /api/markers/export` - 数据导出

### 用户接口
- `GET /api/users` - 获取用户列表 (admin)
- `POST /api/users` - 创建用户 (admin)
- `PUT /api/users/:id` - 更新用户 (admin)
- `DELETE /api/users/:id` - 删除用户 (admin)

## 6. 部署架构

### 开发环境
- 前端: `http://localhost:5173`
- 后端: `http://localhost:3000`

### 生产环境 (阿里云)
- 服务器: Ubuntu 20.04 / 22.04
- Nginx: 反向代理 + 静态文件服务
- PM2: Node.js 进程管理
- HTTPS: SSL证书

## 7. 项目目录结构

```
webgis-system/
├── frontend/                 # Vue 3 前端项目
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   │   ├── map/         # 地图相关组件
│   │   │   ├── layout/      # 布局组件
│   │   │   └── ui/          # 通用UI组件
│   │   ├── composables/     # 组合式函数
│   │   ├── router/
│   │   ├── stores/          # Pinia状态
│   │   ├── utils/
│   │   ├── views/           # 页面视图
│   │   ├── App.vue
│   │   └── main.js
│   ├── package.json
│   └── vite.config.js
│
├── backend/                  # Node.js 后端项目
│   ├── src/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── utils/
│   │   └── app.js
│   ├── database/
│   ├── package.json
│   └── .env.example
│
├── docs/                     # 文档
│   ├── deployment.md        # 部署指南
│   └── api.md              # API文档
│
└── README.md
```

## 8. 验收标准

1. ✅ 用户可以注册、登录、登出
2. ✅ 地图正常加载，缩放平移流畅
3. ✅ 可以添加、编辑、删除点位
4. ✅ 绘制工具正常工作
5. ✅ 热力图和聚合功能正常
6. ✅ 空间查询返回正确结果
7. ✅ 管理员可以管理用户
8. ✅ 可以在阿里云服务器部署运行

## 9. 注意事项

- 高德地图需要申请 Web API Key (免费额度足够测试)
- 部署时需配置环境变量
- 生产环境建议使用 PostgreSQL + PostGIS

## 10. AI 助手开发规范

### Token 消耗控制原则

AI 助手基于豆包 Seed 2.0 Pro（Function Calling），每次对话涉及两次 API 调用：
1. **第一次调用**：用户消息 + 历史 → 返回 tool_calls
2. **第二次调用**（仅服务端工具）：用户消息 + 历史 + 工具执行结果 → 返回文字

**核心原则：工具执行结果会作为第二次调用的输入 token，必须严格控制大小。**

### 工具分类与 Token 策略

| 分类 | 说明 | Token 策略 |
|------|------|-----------|
| **客户端工具** | 在前端直接执行，结果不上报 AI | ✅ 随意，不计 AI token |
| **服务端工具** | 后端执行，结果传入第二次 AI 调用 | ⚠️ **必须控制返回数据量** |

**当前分类**：
- 客户端工具：`filter_markers`、`filter_competitors`、`filter_brand_stores`、`filter_shopping_centers`、`locate_city`、`toggle_layer`、`activate_tool`、`poi_around_search`、`poi_text_search`、`poi_polygon_search`
- 服务端工具：`query_stats`（已优化：LIMIT 20 + 摘要压缩）

### 新增 AI 工具的 Token 规范

1. **优先选择客户端执行**：能前端完成的工具（如筛选、图层切换）不要走后端
2. **服务端口必须限制**：后端 SQL 查询加 `LIMIT 20`，POI 接口已默认 `offset: 20`
3. **返回摘要而非原始数据**：如 `query_stats` 返回 `{ data: [], summary: "共5个分组..." }`，让 AI 直接用摘要
4. **禁止返回大量 geometry**：GeoJSON 坐标数据严禁传回 AI
5. **对话历史注意累积**：连续对话时历史消息会累积，后续可考虑压缩策略

### 文件位置

- 工具定义：`backend/src/ai/tools.js`
- 后端路由：`backend/src/routes/ai.js`
- 前端执行器：`frontend/src/utils/aiExecutor.js`
- 对话组件：`frontend/src/components/AiAssistant.vue`

