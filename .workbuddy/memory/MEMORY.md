# GeoManager 项目长期记忆

## 服务器信息
- IP: 8.136.207.172 / 用户: root / 密码: ZhenXia1984
- 项目路径: /var/www/geomanger
- PM2进程: geomanger-api（ecosystem.config.cjs 持久化环境变量）
- 数据库: /var/www/geomanger/backend/database/webgis.db

## 项目结构
- 前端: Vue3 + Element Plus + Leaflet + Vite
- 后端: Node.js + Express + SQLite（sql.js 内存数据库）
- 域名: mka-online.cn（HTTPS，Let's Encrypt 证书，到期 2026-06-30）
- 部署: vite build → paramiko SFTP 上传 dist → PM2 restart

## 已完成功能列表
1. 地图标记管理（增删改查、分类筛选）
2. 门店管理表格（筛选、导出、CSV导入）
3. 用户管理（增删改、重置密码）
4. 地图图标按门店类型区分颜色
5. 左上角地址检索框（Nominatim API）
6. 个人中心页面（修改邮箱/密码）
7. 地图工具栏（测量距离/面积、绘制圆形、热力图、聚合）
8. IP自动定位（ip-api.com，左下角城市名显示）
9. 竞品门店（独立表，彩色品牌圆点图标）
10. 品牌门店（独立表，管理员完整权限/普通用户只读）
11. 品牌图标上传（用户隔离，管理员共享）
12. 购物中心页面（独立表，星级/评论数/榜单字段）
13. Shapefile上传与数值字段检索（地图高亮显示）
14. 底图切换（高德/腾讯/影像）
15. Shapefile文件名重命名（内联编辑）
16. **AI 助手（豆包 1.5 Pro，自然语言操作地图）**

## AI 助手功能 (2026-04-04)
- **模型**：豆包 Seed 2.0 Pro（火山引擎，doubao-seed-2-0-pro）
- **API Key**：f92f55af-7642-49d8-94f5-d1492b7b4e19（已写入 ecosystem.config.cjs）
- **后端**：`/api/ai/chat` 接口，支持 Function Calling（backend/src/routes/ai.js）
- **前端**：AiAssistant.vue（悬浮紫色按钮 + 对话气泡），挂载在 MapView.vue
- **支持操作**：筛选门店/竞品、定位城市、图层开关、激活工具、清除筛选、统计查询
- **执行链路**：前端 → 后端调用豆包 → 返回 tool_calls → 前端 handleAiExecute 执行

## Git备份
- v1.0.0: 2026-03-26，基础功能
- v1.1.0: 2026-03-27，竞品门店
- v1.1.1: 2026-03-29，品牌图标+品牌门店+分类字段
- v1.2.0: 2026-03-30，Shapefile上传展示
- v1.2.1: 2026-03-31，购物中心功能完善
- v1.3.0: 2026-04-02，底图切换+地图样式优化

## 技术规则
- **数据隔离**：所有门店查询必须 `WHERE user_id = ?`
- **路由顺序**：静态路由（`/me`）放在动态路由（`/:id`）之前
- **vite build 命令**：`/Users/xuchaodian/.workbuddy/binaries/node/versions/22.12.0/bin/node node_modules/vite/bin/vite.js build`
- **腾讯地图 TMS Y轴翻转**：重写 getTileUrl，y = 2^z - 1 - leaflet_y
- **Vue SFC 限制**：不在 `<script setup>` 中用 `L.TileLayer.extend()` 或 `<<` 运算符
- **坐标系**：系统数据均为 GCJ-02，只能用国内地图服务底图
- **sql.js 内存数据库**：PM2 重启后数据丢失，需从 SQLite 文件重新初始化

## 测试账号
- 管理员：admin / admin123
- 普通用户：xucd / 123456

## 腾讯地图
- Key: PL5BZ-HGV6J-MC2FC-DXNCT-EF6W3-EWFKU
- 瓦片URL: `https://rt{s}.map.gtimg.com/realtimerender?z={z}&x={x}&y={y}&type=vector&style=0&key=KEY`
- SVG图标：只用ASCII，用encodeURIComponent编码，避免btoa中文报错

## Shapefile功能
- 上传表：shapefiles（id, name, geojson, field_names, feature_count, user_id, created_at）
- 坐标转换：上传时 WGS84 → GCJ-02
- Python解析脚本：backend/src/utils/shapefile_parser.py（pyshp库）
- 检索：POST /api/shapefiles/:id/query，数值字段多条件AND组合
- 地图高亮：橙色边框+黄色填充，分批渲染避免卡死
