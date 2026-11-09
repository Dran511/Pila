import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = `http://localhost:${process.env.API_PORT ?? 3001}`

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
})
