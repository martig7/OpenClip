import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';
import { configDefaults } from 'vitest/config';

const electronMockPath = fileURLToPath(new URL('./tests/mocks/electron.js', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
  },
  resolve: {
    // Redirect 'electron' to our mock when running tests; harmless in browser builds
    // since electron is never imported by React source files.
    alias: mode === 'test' ? { electron: electronMockPath } : {},
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:47531',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    exclude: [...configDefaults.exclude, 'tests/integration/**'],
    server: {
      deps: {
        // Force 'electron' npm package through Vite's transform so the
        // resolve.alias (electron → tests/mocks/electron.js) applies.
        inline: ['electron'],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['electron/**/*.js', 'src/**/*.{js,jsx}'],
      exclude: ['electron/main.js'],
    },
  },
}));
