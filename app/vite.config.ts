import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The renderer is loaded from file:// inside Electron, so every asset path is relative.
export default defineConfig({
  root: 'src',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, target: 'chrome130', sourcemap: false },
})
