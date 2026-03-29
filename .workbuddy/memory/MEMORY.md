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
9. 门店区分颜色区分（popup 和下拉列表）
10. IP自动定位功能（ip-api.com，左下角城市名显示）
11. 测量距离重写（仿高德：多段累计、鼠标预览线、每点距离标注、双击结束）

## Git备份
- v1.0.0: 2026-03-26，基础功能完成
- v1.0.1: 2026-03-26（df5deb0），门店区分颜色显示优化
- v1.1.0: 2026-03-27（66efe48），竞品门店功能

## 常见问题
- **修改代码后服务器没变化**：必须先 vite build，再用 paramiko SFTP 部署 dist 到服务器（每次修改都要执行这两步）

## 技术备忘
- 使用 Python paramiko + SFTP 部署前端到服务器
- 用户修改个人信息接口: `PUT /api/users/me`
- **数据隔离**：所有门店查询必须添加 `WHERE user_id = ?` 过滤，否则用户会看到所有数据
- **Express 路由顺序**：静态路由（如 `/me`）必须放在动态路由（如 `/:id`）之前
- **vite build**：使用 `/Users/xuchaodian/.workbuddy/binaries/node/versions/22.12.0/bin/node node_modules/vite/bin/vite.js build`
- **Leaflet双击测量防冲突**：单击用setTimeout 200ms延迟，dblclick时cancel掉单击timer
- **事件绑定必须在map创建后立即绑定**：`initMap` 是 async 函数（含 await getLocationByIP），map.on('click'/'dblclick') 必须写在 initMap 内部 map 创建之后，不能用 setTimeout 延迟绑定（会产生竞态导致绑定失败）
- **门店区分列表**：在 marker.js store 的 storeCategories 数组中维护
- **测量面积面消失bug (2026-03-27)**：双击结束面积测量后，下次测量时之前保存的面会消失。原因是双击结束后 `measureAreaPolygon`/`measureAreaLabel` 没有设为 null，下次 `handleAreaMeasure` 会执行 `map.removeLayer(measureAreaPolygon)` 把已保存的面从 drawnItems 中移除。修复：在双击结束时添加 `measureAreaPolygon = null` 和 `measureAreaLabel = null`

## 品牌门店功能 (2026-03-28)
- **品牌门店表**：`brand_stores` 表（独立于 `markers` 和 `competitors`）
- **品牌门店字段**：同竞品门店（store_code, brand, name, store_type, city, district, address, contact_person, contact_phone, description, latitude, longitude, status, icon_color）
- **品牌门店 API**：`/api/brand-stores`（GET/POST/PUT/DELETE + import/export）
- **品牌门店页面**：`/brand-stores` 路由，BrandStoreView.vue（与竞品门店功能相同的管理界面）
- **品牌门店图层**：地图右下角独立开关控制，显示菱形图标（diamond样式），支持拖拽更新坐标

## 品牌图标功能 (2026-03-28，更新)
- **品牌图标表**：`brand_icons` 表（id, brand, filename, original_name, created_at, user_id）
- **品牌图标 API**：`/api/brand-icons`（GET/POST/DELETE）
- **品牌图标上传目录**：`/var/www/geomanger/backend/uploads/brand-icons/`
- **品牌图标管理页面**：`/brands` 路由，BrandIconView.vue（左侧品牌列表，右侧图标上传/预览/删除）
- **图标渲染**：地图上优先显示品牌自定义图标（32×32px 圆形），无品牌图标则回退到门店类型/竞品颜色 SVG
- **地图集成**：MapView.vue onMounted 中调用 brandIconStore.fetchBrandIcons()，brandIconMap computed 提供品牌→图标URL映射
- **用户隔离模式 (2026-03-28)**：
  - **GET API**：返回用户自己上传的 + 所有管理员上传的图标（通过子查询）
  - **POST API**：普通用户只能上传"我的门店"和"竞品门店"的品牌；同一品牌如果已存在管理员上传的图标，普通用户无法替换
  - **DELETE API**：普通用户只能删除自己上传的图标
- **前端显示**：
  - 图标标签显示"我的"（绿色）或"共享"（灰色）区分来源
  - 普通用户可以上传/更换/删除自己上传的图标
  - 管理员可以操作所有品牌的图标
- **数据库初始化**：init-db.mjs 中定义 brand_icons 表结构（带 user_id 列）
- **注意**：后端使用 sql.js 内存数据库，每次 PM2 重启会重新初始化，需要确保 init-db.mjs 中包含所有表结构

## 竞品门店功能 (2026-03-27, 更新 2026-03-28)
- **竞品门店表**：`competitors` 表（独立于 `markers` 表）
- **竞品门店字段**：store_code, brand, name, store_type, city, district, address, contact_person, contact_phone, description, latitude, longitude, status, icon_color
- **竞品门店 API**：`/api/competitors`（GET/POST/PUT/DELETE + import/export）
- **竞品管理页面**：`/competitors` 路由，CompetitorView.vue
- **竞品图层控制**：右下角开关控制显示/隐藏，左侧显示"竞品"文字
- **竞品图标样式**：圆点（dot），大小 1.2 倍
- **竞品品牌颜色**：
  - 大米先生：橙色 #e6a23c
  - 谷田稻香：红色 #f56c6c
  - 吉野家：蓝色 #409eff
  - 老乡鸡：绿色 #67c23a
  - 米村拌饭：紫色 #9c27b0
  - 其他：橙色 #ff9800
- **竞品管理筛选**：支持关键词/城市/区县/品牌四维筛选，品牌列和筛选下拉均带彩色圆点
- **图层优先级**：门店图标显示在竞品图标上方（使用 bringToBack）

## 品牌门店权限控制 (2026-03-28)
- **权限判断**：使用 `userStore.isAdmin` 判断是否为管理员
- **普通用户**：仅能浏览品牌门店数据，无导入、导出、添加、删除权限
- **管理员**：拥有全部操作权限
- **隐藏功能**：批量选择列、添加/导入/导出/批量删除按钮、编辑/删除操作按钮
- **数据库**：brand_stores 表包含 user_id 字段，INSERT 语句需要包含此字段
- **Bug修复 (2026-03-28)**：brand-stores.js 的 INSERT 语句缺少 user_id 字段，导致导入/添加失败

## 测试账号
- 管理员：admin / admin123
- 普通用户：xucd / 123456
