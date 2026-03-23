#!/usr/bin/env node
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function run(cmd, cwd) {
  execSync(cmd, { stdio: 'inherit', cwd })
}

function buildObsPlugin() {
  const electronAppRoot = path.join(__dirname, '..')
  const obsPluginRoot = path.join(electronAppRoot, '..', 'obs-plugin')
  const releaseDll = path.join(obsPluginRoot, 'build', 'Release', 'openclip-obs.dll')
  const stagingDir = path.join(electronAppRoot, 'resources', 'obs-plugin')
  const stagedDll = path.join(stagingDir, 'openclip-obs.dll')

  run('cmake -S . -B build -G "Visual Studio 17 2022" -A x64', obsPluginRoot)
  run('cmake --build build --config Release', obsPluginRoot)

  if (!fs.existsSync(releaseDll)) {
    throw new Error(`Plugin DLL not found after build: ${releaseDll}`)
  }

  fs.mkdirSync(stagingDir, { recursive: true })
  fs.copyFileSync(releaseDll, stagedDll)
}

if (require.main === module) {
  buildObsPlugin()
}

module.exports = { buildObsPlugin }
