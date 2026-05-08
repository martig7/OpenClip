/**
 * Vite config for the browser demo build.
 * Identical to the main config but outputs to dist-demo/ instead of dist/,
 * so it doesn't collide with the Electron installer artifacts.
 * Used by `npm run release` to produce the GitHub Pages demo.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
  },
})
