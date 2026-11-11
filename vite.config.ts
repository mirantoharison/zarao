import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { defineConfig } from 'vite'

// IMPORTANT : port fixe + strictPort, Tauri (devUrl) doit savoir où pointer.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
})
