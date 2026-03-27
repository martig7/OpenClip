/**
 * Playwright global setup for integration tests (CommonJS).
 *
 * Playwright require()s this file directly — it must be CJS.
 * obsHelper.mjs is ESM, so we load it via dynamic import().
 *
 * Execution order:
 *   1. This runs (starts OBS, sets env vars)
 *   2. Playwright starts the webServer (electron --integration-mode),
 *      which inherits the env vars set here
 *   3. Tests run
 *   4. The returned function runs (stops OBS, removes temp dirs)
 */

'use strict'

const { mkdtempSync, rmSync, existsSync, readFileSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')

const { waitForPluginHttpReady } = require('../../../electron/pluginHttpTransport')

module.exports = async function globalSetup() {
  // Dynamic import of the ESM obsHelper
  const { startOBS, isOBSAvailable } = await import('../../integration/obs/obsHelper.mjs')

  if (!isOBSAvailable()) {
    throw new Error(
      'OBS Studio binary not found — cannot run integration tests.\n' +
        'Install OBS 28+ or set the OBS_BINARY environment variable to the\n' +
        'full path of obs64.exe (Windows) or obs (Linux/macOS).\n' +
        'On Windows the repo-local install at obs-studio/bin/64bit/obs64.exe\n' +
        'is auto-detected if downloaded via the CI workflow.'
    )
  }

  // Isolated temp directories — never touch production data
  const obsRecordingsDir = mkdtempSync(join(tmpdir(), 'openclip-obs-rec-'))
  const openclipDestDir = mkdtempSync(join(tmpdir(), 'openclip-dest-'))

  // Start a fully isolated headless OBS:
  //   --headless --portable  keeps OBS from touching the developer's real config
  //   random free port       avoids conflicts with any running OBS
  const pluginPortFile = join(
    tmpdir(),
    `openclip-plugin-port-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  )

  const obs = await startOBS({
    initialScenes: ['Scene'],
    installOpenClipPlugin: true,
    openClipPluginPortFilePath: pluginPortFile,
  })

  // Wait for native plugin to publish its HTTP port.
  let pluginHttpPort = null
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (existsSync(pluginPortFile)) {
      const raw = String(readFileSync(pluginPortFile, 'utf-8')).trim()
      const parsed = parseInt(raw, 10)
      if (parsed > 0 && parsed < 65536) {
        pluginHttpPort = parsed
        break
      }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!pluginHttpPort) {
    throw new Error(`OpenClip plugin did not publish a valid port file at ${pluginPortFile}`)
  }

  // Port file can appear before the HTTP server accepts connections — wait for a real response.
  await waitForPluginHttpReady(pluginHttpPort)

  // Set env vars BEFORE Playwright spawns the webServer subprocess and test
  // workers — both inherit the current process environment.
  process.env.OBS_HOST = obs.wsSettings.host
  process.env.OBS_PORT = String(obs.wsSettings.port)
  process.env.OBS_RECORDING_PATH = obsRecordingsDir
  process.env.OPENCLIP_DEST_PATH = openclipDestDir
  process.env.OPENCLIP_INTEGRATION_TEST = 'true'
  process.env.OPENCLIP_PLUGIN_PORT_FILE = pluginPortFile
  process.env.OPENCLIP_PLUGIN_HTTP_PORT = String(pluginHttpPort)

  console.log(
    `\n[integration] OBS WebSocket → ws://${obs.wsSettings.host}:${obs.wsSettings.port}` +
      `\n[integration] OpenClip plugin HTTP → http://127.0.0.1:${pluginHttpPort}` +
      `\n[integration] OpenClip plugin port file → ${pluginPortFile}` +
      `\n[integration] OBS recordings → ${obsRecordingsDir}` +
      `\n[integration] OpenClip dest  → ${openclipDestDir}\n`
  )

  // Playwright calls the returned function as teardown after all tests.
  return async function globalTeardown() {
    obs.stop()
    try {
      rmSync(pluginPortFile, { force: true })
    } catch {}
    rmSync(obsRecordingsDir, { recursive: true, force: true })
    rmSync(openclipDestDir, { recursive: true, force: true })
  }
}
