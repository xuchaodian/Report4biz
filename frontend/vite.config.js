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
          // L（v1.13.109）：Vite 的 __vitePreload 助手是虚拟模块 `\0vite/preload-helper.js`，
          // 所有做动态 import 的 chunk 都要静态引用它。若不显式归组，Rollup 会把它塞进
          // 某个 vendor chunk（实测为 vendor-pdf）→ 于是每个含动态 import 的 chunk 都静态
          // 依赖 vendor-pdf，index.html 被迫预加载 539KB 的 jspdf/html2canvas。
          // 归入始终预加载的 vendor-core，可彻底消除这一「假依赖」。
          if (id.includes('preload-helper')) {
            return 'vendor-core'
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
