# GeoManager 项目长期记忆

## 服务器信息
- IP: 8.136.207.172
- 用户: root
- 密码: ZhenXia1984
- 项目路径: /var/www/geomanger
- PM2进程: geomanger-api
- 数据库: /var/www/geomanger/backend/database/webgis.db

## 项目结构
- 前端: Vue3 + Element Plus + Leaflet + Vite
- 后端: Node.js + Express + SQLite
- 部署: 前端 vite build → 同步到 /var/www/geomanger/frontend/dist/
- 后端: PM2 管理

## 地图界面布局 (2026-03-26)
1. 左上角：地址检索框（Nominatim API，支持输入地址搜索定位）
2. 左上角工具栏下方：图层控制面板
3. 右侧：门店对话框
4. 右下角：坐标显示

## 已完成功能
1. 地图标记管理（增删改查、分类筛选）
2. 门店管理（数据表格、筛选、导出）
3. 用户管理（增删改、重置密码）
4. 地图图标按门店类型区分颜色（已开业/重点候选/一般候选）
5. 门店管理跳转地图定位
6. 左上角地址检索框（Nominatim API）
7. 个人中心页面（修改邮箱、修改密码）
8. 地图工具栏（测量、绘制、热力图、聚合）

## 技术备忘
- 使用 Python paramiko + SFTP 部署前端到服务器
- 用户修改个人信息接口: `PUT /api/users/me`
- **数据隔离**：所有门店查询必须添加 `WHERE user_id = ?` 过滤，否则用户会看到所有数据
- **Express 路由顺序**：静态路由（如 `/me`）必须放在动态路由（如 `/:id`）之前
