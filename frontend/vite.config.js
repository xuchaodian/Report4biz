import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'

import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    // Element Plus 按需导入
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // C（v1.13.139）：vue-i18n 消息编译默认走 AOT —— 生成代码字符串后 `new Function('return ' + code)()`。
  // 这与严格 CSP（script-src 'self'，无 'unsafe-eval'）冲突：浏览器抛 EvalError，
  // 而首屏每次 `$t()` 都要编译 ⇒ render 抛错 ⇒ 页面渲染成 <!----> 空白（实测整站白屏）。
  // 开启 JIT 编译后，message compiler 输出 AST 解释执行，不再使用 new Function，
  // 从而保住最严格的 script-src 'self'（无需为 i18n 妥协加 'unsafe-eval'）。
  // 注：__INTLIFY_DROP_MESSAGE_COMPILER__ 必须一并显式定义为 false —— JIT 分支条件里会读它，
  //     若留作裸标识符会在运行时 ReferenceError。
  define: {
    __INTLIFY_JIT_COMPILATION__: 'true',
    __INTLIFY_DROP_MESSAGE_COMPILER__: 'false',
  },
  build: {
    // 启用压缩和摇树优化
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    // 开启源映射
    sourcemap: false,
    
    // 更好的代码分割策略
    rollupOptions: {
      output: {
        // 手动代码分割
        manualChunks: (id) => {
          // 纯虚拟模块（id 中不含 node_modules 路径）—— Vite / 插件注入的全局助手：
          //   `\0commonjsHelpers.js`（CJS 互操作）、`\0plugin-vue:export-helper`（SFC 包装）、
          //   `\0vite/preload-helper.js`、`\0vite/modulepreload-polyfill.js`
          // 它们被「几乎每个 chunk」静态引用。若不显式归组，Rollup 会把它们塞进某个业务
          // chunk —— 即「假依赖/共享桶」：
          //   ① preload-helper 曾被塞进 vendor-pdf ⇒ index.html 被迫预加载 539KB 的
          //      jspdf/html2canvas（v1.13.109 修）
          //   ② export-helper 被塞进 smartsteps-panel ⇒ 23 个路由 chunk + 登录页全部静态
          //      依赖该 chunk，连带白载其 leaflet 依赖（vendor-maps 52KB gz）—— 登录页
          //      凭空多出 ~61KB gz（v1.13.138 修）
          // ⚠️ 必须独立成块，不可并入任何 vendor-*：这些助手被 vendor-other / vendor-maps
          //    自身引用，并入 vendor-core 会形成 `vendor-core ⇄ vendor-other` 循环 chunk
          //    依赖，运行时抛 `TypeError: Cannot set properties of undefined (setting
          //    'exports')`（2026-09-15 实测：整站白屏、app 不挂载）。
          // ⚠️ 必须排除带 node_modules 路径的虚拟模块 —— CJS 包会为内部模块生成大量
          //    `?commonjs-proxy / ?commonjs-module / ?commonjs-exports` 代理（实测数百个，
          //    如 core-js、dayjs、leaflet），它们必须跟随宿主包归属；一旦被一并归入本 chunk，
          //    会把宿主包本体也拖进来，反而再次形成循环。
          if (id.startsWith('\0') && !id.includes('node_modules')) {
            return 'vite-runtime'
          }
          // 第三方库分组
          if (id.includes('node_modules')) {
            // Element Plus 和 Vue 生态
            if (id.includes('element-plus') || id.includes('@element-plus')) {
              return 'vendor-element-plus'
            }
            // Vue 核心库
            if (id.includes('vue') && !id.includes('vue-echarts')) {
              return 'vendor-vue'
            }
            // 地图相关库
            if (id.includes('leaflet') || id.includes('turf') || id.includes('gcoord') || id.includes('amap')) {
              return 'vendor-maps'
            }
            // ECharts 相关
            if (id.includes('echarts') || id.includes('vue-echarts')) {
              return 'vendor-echarts'
            }
            // PDF/Canvas 相关
            if (id.includes('jspdf') || id.includes('html2canvas')) {
              return 'vendor-pdf'
            }
            // 核心工具库
            if (id.includes('axios') || id.includes('pinia') || id.includes('vue-router')) {
              return 'vendor-core'
            }
            // 其他第三方库
            return 'vendor-other'
          }
          
          // 业务组件分组
          // M1（v1.13.107）：Pinia stores 必须显式分组。
          // 否则 Rollup 会把 stores/user.js 合并进「某个动态 chunk」（实测为 smartsteps-panel），
          // 使入口被迫静态引用该 chunk（router 守卫里 useUserStore()）→ 整块被提前加载，
          // 异步组件懒加载失效。显式分组后 stores 独立成块，动态组件才真正按需加载。
          if (id.includes('/src/stores/')) {
            return 'app-stores'
          }
          // S（v1.13.138）：被 3~5 个不同路由共用的工具模块（合计仅 8KB 源码）。
          // 不显式分组时 Rollup 会把它们塞进 smartsteps-panel chunk（实测如此），
          // 而该 chunk 又静态依赖 leaflet ⇒ store-dialog / SharedPurchaseView 等
          // 无地图页面反向把这 8KB 工具连同 52KB gz 的地图库一起拖进首屏。
          if (
            id.includes('/src/utils/smartsteps1001') ||
            id.includes('/src/utils/smartstepsMonths') ||
            id.includes('/src/utils/sanitizeHtml')
          ) {
            return 'app-shared'
          }
          if (id.includes('StoreSmartstepsDialog')) {
            return 'store-dialog'
          }
          if (id.includes('SmartstepsPanel')) {
            return 'smartsteps-panel'
          }
          // 注: 不再手动分组 MapView.vue —— 子串匹配会误伤 MarketMapView.vue(含'MapView.vue'),
          // 使该 chunk 同时被入口静态引用(i18n)+路由动态引用, Rollup 生成 {default:组件} Module 包装,
          // Vue Router 拿不到组件导致 /map 白屏(v1.13.78 起). 交给 Vite 默认按路由动态拆分(同 DataView).
        },
        
        // 更好的文件名格式
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // 后端目标可通过环境变量覆盖（如本地验收时指向测试实例）
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
