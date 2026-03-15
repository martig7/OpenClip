/**
 * Vitest config for ffmpeg integration tests.
 *
 * These tests exercise fileManager.js (organizeRecordings, organizeSpecificRecording)
 * with the real ffmpeg/ffprobe binaries from ffmpeg-static/ffprobe-static.
 * child_process is NOT mocked — actual encode/probe operations run.
 * Only `electron` is stubbed so constants.js can resolve app paths.
 */
import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'

const electronMockPath = fileURLToPath(new URL('./tests/mocks/electron.js', import.meta.url))

export default defineConfig({
  resolve: {
    alias: { electron: electronMockPath },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/ffmpeg/**/*.test.{js,ts}'],
    setupFiles: ['./tests/integration/ffmpeg/setup.js'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: {
      deps: {
        inline: ['electron'],
      },
    },
  },
})
