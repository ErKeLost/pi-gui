import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
// Tauri 2 official Vite guide: docs/SOURCES.md (T1).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
    dedupe: ['react', 'react-dom'],
  },
  clearScreen: false,
  // Second entry for the native Tauri splashscreen window.
  build: { rollupOptions: { input: { main: path.resolve(import.meta.dirname, 'index.html'), splashscreen: path.resolve(import.meta.dirname, 'splashscreen.html') } } },
  server: { port: 5173, strictPort: true, host: '127.0.0.1', watch: { ignored: ['**/src-tauri/**', path.join(import.meta.dirname, 'work', '**')] } },
})
