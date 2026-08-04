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
          if (id.includes('StoreSmartstepsDialog')) {
            return 'store-dialog'
          }
          if (id.includes('SmartstepsPanel')) {
            return 'smartsteps-panel'
          }
          // MapView 单独分组（9074行大文件）
          if (id.includes('MapView.vue')) {
            return 'mapview-main'
          }
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
