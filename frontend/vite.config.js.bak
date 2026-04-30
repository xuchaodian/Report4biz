import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  optimizeDeps: {
    include: [
      'vue',
      'element-plus',
      '@/components/StoreSmartstepsDialog.vue',
      '@/components/SmartstepsPanel.vue'
    ]
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /StoreSmartstepsDialog/, /SmartstepsPanel/]
    },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('StoreSmartstepsDialog')) {
            return 'vendor-store-dialog'
          }
          if (id.includes('SmartstepsPanel')) {
            return 'vendor-smartsteps'
          }
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
