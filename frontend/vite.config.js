import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5800,
    proxy: {
      // For local dev against the docker stack on :8800
      '/api': { target: 'http://localhost:8800', changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
})
