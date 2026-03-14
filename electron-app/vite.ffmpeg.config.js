/**
 * Vitest config for ffmpeg integration tests.
 *
 * These tests exercise fileManager.js (organizeRecordings, organizeSpecificRecording)
 * with the real ffmpeg/ffprobe binaries from ffmpeg-static/ffprobe-static.
 * child_process is NOT mocked — actual encode/probe operations run.
 * Only `electron` is stubbed so constants.js can resolve app paths.
 */
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/ffmpeg/**/*.test.{js,ts}'],
    setupFiles: ['./tests/integration/ffmpeg/setup.js'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
