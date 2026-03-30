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

## Shapefile 功能 (2026-03-30)
- **Shapefile上传表**：`shapefiles` 表（id, name, geojson, field_names, feature_count, user_id, created_at）
- **Shapefile API**：`/api/shapefiles`（POST upload/GET/GET/:id/DELETE/:id）
- **Shapefile管理页面**：`/shapefiles` 路由，ShapefileView.vue
- **坐标转换**：上传时自动将 WGS84 转换为 GCJ-02（高德坐标）
- **Python解析脚本**：`backend/src/utils/shapefile_parser.py`（使用 pyshp 库）
- **上传目录**：`/var/www/geomanger/backend/uploads/shapefiles/`
- **地图显示**：紫色 Polygon 面图层，支持点击查看属性
- **服务器依赖**：需要 `pip3 install pyshp`

## Git备份
- v1.0.0: 2026-03-26，基础功能完成
- v1.0.1: 2026-03-26（df5deb0），门店区分颜色显示优化
- v1.1.0: 2026-03-27（66efe48），竞品门店功能
- v1.1.1: 2026-03-29（98e3fc8），品牌图标+品牌门店+分类字段+store_type默认值修复
- v1.2.0: 2026-03-30（5a08369），Shapefile上传与展示功能

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

## 地图筛选联动 (2026-03-29)
- **筛选条件持久化**：筛选条件存储在 Pinia store 的 `filters` 对象中，切换页面后保留
- **清除筛选按钮**：筛选栏右侧显示"清除筛选"按钮（仅在有筛选条件时显示），点击后恢复全部显示
- **Store 新增方法**：`setFilters()` 设置筛选条件，`clearFilters()` 清除所有筛选并重置 visibleIds
- **三个 store 均已修改**：marker.js, competitor.js, brandStore.js

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

## 默认显示设置 (2026-03-29)
- 地图默认只显示"我的门店"图层
- 竞品门店和品牌门店图层默认隐藏
- 用户需手动在地图右下角开启

## 测试账号
- 管理员：admin / admin123
- 普通用户：xucd / 123456

## Bug修复记录 (2026-03-30)
- **品牌门店 API 401 问题 (2026-03-30 晚)**：
  - **问题**：品牌门店列表获取失败：401 Unauthorized
  - **根本原因**：brandStore.js 使用原始 axios 实例，没有配置 token 拦截器
  - **修复**：修改 brandStore.js 使用 utils/api.js 中的 axios 实例（已配置请求拦截器）
- **ElTable row-key 缺失 (2026-03-30 晚)**：
  - **问题**：Element Plus 表格报错：prop row-key is required
  - **修复**：给 DataView.vue、BrandStoreView.vue、CompetitorView.vue、ShapefileView.vue 添加 row-key="id"
- **Shapefile上传失败问题**：
  - **原因**：ShapefileView.vue 中 API 地址使用 `http://localhost:3000`（绝对路径），导致生产环境请求无法到达服务器
  - **修复**：改为空字符串（相对路径），通过 nginx 代理转发到后端
  - **部署**：前端修改后必须重新 vite build 并用 SFTP 部署到服务器
- **sql.js API 修复**：使用 `db.prepare().run()` / `.all()` / `.get()` 代替 `db.run()` / `db.exec()`
- **变量名冲突**：将 `result` 重命名为 `pythonResult` 和 `insertResult`
- **Shapefile 显示白屏问题 (2026-03-30)**：
  - **问题**：上传 Shapefile 后点击显示，浏览器白屏死机
  - **根本原因**：Python 脚本 shapefile_parser.py 中 Polygon 坐标解析逻辑错误，每个 part 从起始索引遍历到 `len(shape.points)` 导致坐标嵌套错误
  - **修复**：正确使用 `parts[i + 1]` 作为每个 part 的结束索引
  - **前端**：MapView.vue 添加 GeoJSON 格式验证和 try-catch 错误处理
  - **分批渲染**：新增 `renderGeoJSONInBatches` 函数，每批30个要素，避免浏览器卡死
  - **优化阈值**：要素数>50 或 GeoJSON大小>500KB 时启用分批渲染
  - **部署**：前端需重新 vite build 并 SFTP 部署到服务器

## Shapefile 功能简化 (2026-03-30)
- **移除显示功能**：用户反馈浏览器白屏问题，移除地图上显示 Shapefile 的功能
- **列表简化**：ShapefileView.vue 移除"显示"按钮和"字段"列，只保留文件信息、要素数量、上传时间和删除操作
- **清理代码**：移除 MapView.vue 中的 Shapefile 图层加载、显示、事件监听相关代码
- **API 保留**：后端 API 仍支持上传、查询、删除操作，仅前端移除地图显示功能

## Shapefile 数据检索功能 (2026-03-30)
- **检索按钮**：ShapefileView.vue 列表中每行添加"检索"按钮
- **检索对话框**：
  - 自动识别数值字段
  - 支持多条件组合（AND 关系）
  - 支持运算符：>、>=、<、<=、=、!=
- **后端API**：
  - `POST /api/shapefiles/:id/query` - 执行条件检索
  - `GET /api/shapefiles/:id/fields` - 获取数值字段列表
- **地图高亮**：
  - 橙色边框（weight: 5，加粗显示）+ 黄色半透明填充高亮显示匹配要素
  - 在 Polygon 中心位置显示数值标签（最多3个数值字段，保留2位小数）
  - 点击高亮区域显示属性信息
  - 自动调整视图到高亮区域
  - 清除绘制时同步清除高亮图层
- **分批渲染**：handleShapefileQuery 函数使用 L.canvas() 渲染器，100+要素只渲染边界线不渲染填充面，避免浏览器卡死
