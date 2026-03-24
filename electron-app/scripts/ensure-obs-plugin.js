#!/usr/bin/env node
/**
 * Rebuild and stage the OpenClip OBS plugin when sources are newer than the
 * bundled DLL (or when outputs are missing).
 *
 * Used before integration / E2E tests so tests always run against current C code.
 */
const fs = require('fs')
const path = require('path')
const { buildObsPlugin } = require('./build-plugin.js')

const electronAppRoot = path.join(__dirname, '..')
const obsPluginRoot = path.join(electronAppRoot, '..', 'obs-plugin')
const stagedDll = path.join(electronAppRoot, 'resources', 'obs-plugin', 'openclip-obs.dll')
const buildDll = path.join(obsPluginRoot, 'build', 'Release', 'openclip-obs.dll')

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walkFiles(p, acc)
    else acc.push(p)
  }
  return acc
}

function maxMtime(paths) {
  let max = 0
  for (const p of paths) {
    try {
      const t = fs.statSync(p).mtimeMs
      if (t > max) max = t
    } catch {
      // ignore
    }
  }
  return max
}

function pluginSourcePaths() {
  const paths = [path.join(obsPluginRoot, 'CMakeLists.txt')]
  walkFiles(path.join(obsPluginRoot, 'src'), paths)
  walkFiles(path.join(obsPluginRoot, 'include'), paths)
  return paths.filter((p) => fs.existsSync(p))
}

function needsRebuild() {
  const sources = pluginSourcePaths()
  if (sources.length === 0) {
    console.warn('[ensure-obs-plugin] No plugin sources found; forcing build.')
    return true
  }
  const sourceMax = maxMtime(sources)

  let artifactMax = 0
  if (fs.existsSync(stagedDll)) {
    try {
      artifactMax = Math.max(artifactMax, fs.statSync(stagedDll).mtimeMs)
    } catch {}
  }
  if (fs.existsSync(buildDll)) {
    try {
      artifactMax = Math.max(artifactMax, fs.statSync(buildDll).mtimeMs)
    } catch {}
  }

  if (artifactMax === 0) return true
  return sourceMax > artifactMax
}

function main() {
  if (process.env.OPENCLIP_SKIP_PLUGIN_BUILD === '1') {
    console.log('[ensure-obs-plugin] OPENCLIP_SKIP_PLUGIN_BUILD=1; skip.')
    process.exit(0)
  }
  if (process.platform !== 'win32') {
    console.log('[ensure-obs-plugin] Not Windows; skip native plugin build.')
    process.exit(0)
  }
  if (!fs.existsSync(obsPluginRoot)) {
    console.warn('[ensure-obs-plugin] obs-plugin directory missing; skip.')
    process.exit(0)
  }
  if (!needsRebuild()) {
    console.log('[ensure-obs-plugin] Plugin DLL is up to date; skip rebuild.')
    process.exit(0)
  }
  console.log('[ensure-obs-plugin] Plugin sources changed or artifacts missing; rebuilding…')
  buildObsPlugin()
  console.log('[ensure-obs-plugin] Done.')
}

if (require.main === module) {
  main()
}
