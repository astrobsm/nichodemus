import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  // sql.js ships a prebuilt asm/wasm loader; keep it out of dep pre-bundling
  // so the runtime can resolve the .wasm from our own origin.
  optimizeDeps: { exclude: ['sql.js'] },
  server: { port: 5173, host: true },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
} as any)
