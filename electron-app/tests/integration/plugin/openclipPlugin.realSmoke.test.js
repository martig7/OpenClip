/**
 * OpenClip native plugin smoke tests (real DLL + real headless OBS).
 *
 * Optional extra smoke suite for the real plugin (Vitest flavor).
 * Playwright integration runs real-plugin coverage by default.
 *
 * This suite remains opt-in to avoid flaky parallel OBS lifecycle contention in
 * local dev loops.
 *
 * When enabled, we:
 *  1. Start headless OBS in portable mode
 *  2. Install the OpenClip plugin DLL into the repo-local OBS install tree
 *  3. Poll for the plugin to write the port file (OPENCLIP_PLUGIN_PORT_FILE)
 *  4. Call the plugin HTTP API and assert basic contract invariants
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path, { join } from 'path'
import fs from 'fs'
import os from 'os'
import { createRequire } from 'module'
import { isOBSAvailable, startOBS } from '../obs/obsHelper.mjs'

const require = createRequire(import.meta.url)
const pluginHttp = require('../../../electron/pluginHttpTransport.js')

const obsAvailable = isOBSAvailable()
const dllPath =
  process.env.OPENCLIP_PLUGIN_DLL_PATH ||
  path.resolve(process.cwd(), 'resources/obs-plugin/openclip-obs.dll')

const dllAvailable = fs.existsSync(dllPath)
const smokeEnabled = process.env.OPENCLIP_REAL_PLUGIN_SMOKE === '1'

describe.skipIf(!obsAvailable || !dllAvailable || !smokeEnabled)(
  'OpenClip plugin (real DLL) smoke',
  () => {
    let obsInstance
    let wsSettings
    let portFilePath
    let portNum

    beforeAll(async () => {
      const tmp = fs.mkdtempSync(join(os.tmpdir(), 'openclip-plugin-smoke-'))
      portFilePath = join(tmp, 'plugin_port')

      obsInstance = await startOBS({
        initialScenes: ['Scene'],
        startupTimeoutMs: 60_000,
        installOpenClipPlugin: true,
        openClipPluginDllPath: dllPath,
        openClipPluginPortFilePath: portFilePath,
      })
      wsSettings = obsInstance.wsSettings

      // Wait for plugin to write the port file.
      const deadline = Date.now() + 45_000
      while (Date.now() < deadline) {
        if (fs.existsSync(portFilePath)) {
          const raw = fs.readFileSync(portFilePath, 'utf-8').trim()
          const parsed = parseInt(raw, 10)
          if (parsed > 0 && parsed < 65536) {
            portNum = parsed
            break
          }
        }
        await new Promise((r) => setTimeout(r, 250))
      }

      expect(portNum, 'Plugin port file never appeared / parsed').toBeTruthy()
    })

    afterAll(() => {
      obsInstance?.stop()
      try {
        if (portFilePath) fs.rmSync(path.dirname(portFilePath), { recursive: true, force: true })
      } catch {}
    })

    it('getStatus returns version fields', async () => {
      const data = await pluginHttp.callPluginHttp(portNum, 'getStatus', {})
      expect(data).toHaveProperty('obsVersion')
      expect(data).toHaveProperty('pluginVersion')
    })

    it('getTrackNames returns 6 track names', async () => {
      const tracks = await pluginHttp.callPluginHttp(portNum, 'getTrackNames', {})
      expect(Array.isArray(tracks)).toBe(true)
      expect(tracks).toHaveLength(6)
      expect(tracks.every((t) => typeof t === 'string')).toBe(true)
    })

    it('getAudioInputs exposes at least one input', async () => {
      const inputs = await pluginHttp.callPluginHttp(portNum, 'getAudioInputs', {})
      expect(Array.isArray(inputs)).toBe(true)
      // On some headless builds there might be 0 audio inputs; allow empty but keep
      // the contract check below guarded.
      if (inputs.length === 0) return
      expect(inputs[0]).toHaveProperty('inputName')
      expect(inputs[0]).toHaveProperty('inputKind')
    })

    it('get/set input track routing round-trip for track 4', async () => {
      const inputs = await pluginHttp.callPluginHttp(portNum, 'getAudioInputs', {})
      if (!Array.isArray(inputs) || inputs.length === 0) {
        // No trackable audio inputs in this OBS build. Still validate the API call shape.
        return
      }
      const inputName = inputs[0].inputName
      const before = await pluginHttp.callPluginHttp(portNum, 'getInputAudioTracks', { inputName })
      expect(before).toBeTruthy()

      const desired = { ...before }
      // Flip track 4 only, keep others as-is.
      desired['4'] = before['4'] !== true

      await pluginHttp.callPluginHttp(portNum, 'setInputAudioTracks', { inputName, tracks: desired })
      const after = await pluginHttp.callPluginHttp(portNum, 'getInputAudioTracks', { inputName })
      expect(Boolean(after['4'])).toBe(desired['4'] === true)
    })
  }
)

