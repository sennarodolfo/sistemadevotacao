import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  },
  optimizeDeps: {
    // tesseract.js carrega worker + WASM próprios em tempo de execução;
    // excluir do pre-bundling evita conflitos comuns com o dev server do Vite.
    exclude: ['tesseract.js']
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500
  }
})
