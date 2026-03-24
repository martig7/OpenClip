#!/usr/bin/env node
/**
 * Rebuild and stage openclip-obs.dll whenever obs-plugin sources change.
 * Run alongside dev: `npm run build:plugin:watch` (separate terminal).
 * Windows only (same toolchain as build-plugin.js).
 */
const path = require('path')
const chokidar = require('chokidar')
const { buildObsPlugin } = require('./build-plugin.js')

if (process.platform !== 'win32') {
  console.error('[watch-obs-plugin] Windows only (MSVC + CMake).')
  process.exit(1)
}

const electronAppRoot = path.join(__dirname, '..')
const obsPluginRoot = path.join(electronAppRoot, '..', 'obs-plugin')

const globs = [
  path.join(obsPluginRoot, 'CMakeLists.txt'),
  path.join(obsPluginRoot, 'src', '**', '*'),
  path.join(obsPluginRoot, 'include', '**', '*'),
]

let timer = null
function scheduleBuild() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    console.log('\n[watch-obs-plugin] Rebuilding…')
    try {
      buildObsPlugin()
      console.log('[watch-obs-plugin] OK\n')
    } catch (e) {
      console.error('[watch-obs-plugin] Build failed:', e.message)
    }
  }, 400)
}

if (!require('fs').existsSync(obsPluginRoot)) {
  console.error('obs-plugin directory not found:', obsPluginRoot)
  process.exit(1)
}

console.log('[watch-obs-plugin] Watching', obsPluginRoot)
chokidar
  .watch(globs, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 200 } })
  .on('all', (_evt, filePath) => {
    console.log('[watch-obs-plugin]', _evt, filePath)
    scheduleBuild()
  })
