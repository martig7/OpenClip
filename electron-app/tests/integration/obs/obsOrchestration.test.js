/**
 * OBS Orchestration Integration Tests
 *
 * These tests exercise the production obsWebSocket.js helpers
 * (getOBSScenes, createSceneFromTemplate, testOBSConnection) against a real
 * headless OBS Studio process started with a test-specific configuration.
 *
 * The entire test suite is skipped automatically when OBS is not installed,
 * so it is safe to run `npm test` on machines without OBS.  In CI, the
 * `obs-integration` workflow job installs OBS from the official PPA first.
 *
 * OBS process lifecycle:
 *   beforeAll  — start one OBS process shared by all tests in this file
 *   afterEach  — remove any scenes added during the test (keep seed 'Scene')
 *   afterAll   — kill the OBS process and delete the temp config directory
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { isOBSAvailable, startOBS, findFreePort } from './obsHelper.mjs'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  getOBSScenes,
  createSceneFromTemplate,
  testOBSConnection,
} from '../../../electron/obsPlugin.js'

async function withPluginPort(port, fn) {
  const prev = process.env.OPENCLIP_PLUGIN_HTTP_PORT
  process.env.OPENCLIP_PLUGIN_HTTP_PORT = String(port)
  try {
    return await fn()
  } finally {
    if (prev == null) delete process.env.OPENCLIP_PLUGIN_HTTP_PORT
    else process.env.OPENCLIP_PLUGIN_HTTP_PORT = prev
  }
}

// ─── Skip the whole suite when OBS is not installed ───────────────────────
const obsAvailable = isOBSAvailable()

if (!obsAvailable) {
  console.warn(
    '\n[OBS Integration] OBS Studio binary not found — all tests in this suite are ' +
      'being skipped.\n' +
      'To run these tests locally, install OBS Studio 28+ with the obs-websocket plugin:\n' +
      '  Ubuntu/Debian: sudo apt-get install obs-studio\n' +
      '  macOS:         brew install --cask obs\n' +
      '  Windows:       https://obsproject.com/download\n' +
      'Set $OBS_BINARY if the obs binary is not named "obs" on your system.\n'
  )
}

describe.skipIf(!obsAvailable)('OBS Orchestration – live OBS instance', () => {
  /** @type {{ wsSettings: object, stop: () => void }} */
  let obsInstance
  let ws // shorthand alias used in every test
  let pluginPortFile
  let prevPluginPortFile
  let prevPluginHttpPort
  /** A free port with nothing listening on it, used for "unreachable OBS" tests. */
  let unusedPort
  /** Snapshots for SetInputAudioTracks tests — restored in afterEach. */
  const _audioTrackRestore = new Map()

  // Start a single OBS process for the entire test file.
  // We allow up to 60 s for OBS to boot and the WebSocket server to become
  // reachable — this covers slow CI runners.
  // If OBS fails to start the error propagates from beforeAll so that Vitest
  // marks the whole suite as failed rather than silently skipping all tests.
  beforeAll(async () => {
    unusedPort = await findFreePort()
    pluginPortFile = join(
      tmpdir(),
      `openclip-vitest-plugin-port-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    )
    prevPluginPortFile = process.env.OPENCLIP_PLUGIN_PORT_FILE
    prevPluginHttpPort = process.env.OPENCLIP_PLUGIN_HTTP_PORT

    obsInstance = await startOBS({
      initialScenes: ['Scene'],
      installOpenClipPlugin: true,
      openClipPluginPortFilePath: pluginPortFile,
    })
    ws = obsInstance.wsSettings

    const deadline = Date.now() + 45_000
    let pluginHttpPort = null
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
    process.env.OPENCLIP_PLUGIN_PORT_FILE = pluginPortFile
    process.env.OPENCLIP_PLUGIN_HTTP_PORT = String(pluginHttpPort)
  }, 60_000)

  afterAll(() => {
    obsInstance?.stop()
    try {
      rmSync(pluginPortFile, { force: true })
    } catch {}
    if (prevPluginPortFile == null) delete process.env.OPENCLIP_PLUGIN_PORT_FILE
    else process.env.OPENCLIP_PLUGIN_PORT_FILE = prevPluginPortFile
    if (prevPluginHttpPort == null) delete process.env.OPENCLIP_PLUGIN_HTTP_PORT
    else process.env.OPENCLIP_PLUGIN_HTTP_PORT = prevPluginHttpPort
  })

  // After each test: restore any tweaked audio tracks, then delete every scene
  // except the seed 'Scene'.
  afterEach(async () => {
    if (ws && _audioTrackRestore.size > 0) {
      const { default: OBSWebSocket } = await import('obs-websocket-js')
      const obs = new OBSWebSocket()
      try {
        const url = `ws://${ws.host}:${ws.port}`
        await obs.connect(url, ws.password)
        for (const [inputName, tracks] of _audioTrackRestore.entries()) {
          await obs
            .call('SetInputAudioTracks', { inputName, inputAudioTracks: tracks })
            .catch(() => {})
        }
      } finally {
        _audioTrackRestore.clear()
        obs.disconnect().catch(() => {})
      }
    }
    if (ws) await _cleanupScenes(ws, 'Scene')
  })

  // ── testOBSConnection ────────────────────────────────────────────────────

  describe('testOBSConnection', () => {
    it('returns success and version info from real OBS', async () => {
      const result = await testOBSConnection(ws)

      expect(result.success).toBe(true)
      // OBS reports its own version; just confirm the shape is correct.
      expect(typeof result.version).toBe('string')
      expect(result.version).toMatch(/^OBS .+ \(plugin v.+\)$/)
    })

    it('returns failure when nothing is listening on the port', async () => {
      // obsPlugin ignores wsSettings; force an unreachable plugin port via env.
      const result = await withPluginPort(unusedPort, async () => testOBSConnection({}))

      expect(result.success).toBe(false)
      expect(typeof result.message).toBe('string')
      expect(result.message.length).toBeGreaterThan(0)
    })
  })

  // ── getOBSScenes ─────────────────────────────────────────────────────────

  describe('getOBSScenes', () => {
    it('returns the seed scene from the real OBS instance', async () => {
      const scenes = await getOBSScenes(ws)

      expect(Array.isArray(scenes)).toBe(true)
      expect(scenes).toContain('Scene')
    })

    it('returns an array of strings', async () => {
      const scenes = await getOBSScenes(ws)

      expect(scenes.every((s) => typeof s === 'string')).toBe(true)
    })

    it('throws with a user-friendly message when OBS is unreachable', async () => {
      await expect(withPluginPort(unusedPort, async () => getOBSScenes({}))).rejects.toThrow()
    })
  })

  // ── createSceneFromTemplate ───────────────────────────────────────────────

  describe('createSceneFromTemplate', () => {
    it('creates an empty scene when no template is given', async () => {
      const result = await createSceneFromTemplate(ws, 'NewScene', null)

      expect(result.success).toBe(true)
      expect(result.message).toContain('NewScene')

      const scenes = await getOBSScenes(ws)
      expect(scenes).toContain('NewScene')
    })

    it('the created scene appears in the scene list immediately', async () => {
      await createSceneFromTemplate(ws, 'Immediate', null)
      const scenes = await getOBSScenes(ws)

      expect(scenes).toContain('Immediate')
    })

    it('creates multiple distinct scenes in sequence', async () => {
      await createSceneFromTemplate(ws, 'Alpha', null)
      await createSceneFromTemplate(ws, 'Beta', null)
      await createSceneFromTemplate(ws, 'Gamma', null)

      const scenes = await getOBSScenes(ws)
      expect(scenes).toContain('Alpha')
      expect(scenes).toContain('Beta')
      expect(scenes).toContain('Gamma')
    })

    it('preserves whitespace in scene names (plugin behavior)', async () => {
      const result = await createSceneFromTemplate(ws, '  Trimmed  ', null)

      expect(result.success).toBe(true)
      const scenes = await getOBSScenes(ws)
      expect(scenes).toContain('  Trimmed  ')
    })

    it('allows whitespace-only scene names (plugin behavior)', async () => {
      const result = await createSceneFromTemplate(ws, '   ', null)

      expect(result.success).toBe(true)
      expect(result.message).toBeTruthy()
    })

    it('returns failure when a scene with that name already exists', async () => {
      // 'Scene' was seeded at startup — attempting to create it again must fail.
      const result = await createSceneFromTemplate(ws, 'Scene', null)

      expect(result.success).toBe(false)
      expect(result.message).toContain('Scene')
    })

    it('returns failure when the template name does not exist in OBS', async () => {
      const result = await createSceneFromTemplate(ws, 'Orphan', 'NoSuchTemplate')

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/template|not found|scene/i)
    })

    it('creates an empty scene when the template has no items', async () => {
      // First create a template scene (it will be empty — OBS scenes start empty)
      await createSceneFromTemplate(ws, 'EmptyTemplate', null)

      const result = await createSceneFromTemplate(ws, 'ClonedEmpty', 'EmptyTemplate')

      expect(result.success).toBe(true)
      const scenes = await getOBSScenes(ws)
      expect(scenes).toContain('ClonedEmpty')
    })

    it('returns failure when OBS is unreachable', async () => {
      const result = await withPluginPort(unusedPort, async () =>
        createSceneFromTemplate({}, 'Unreachable', null)
      )

      expect(result.success).toBe(false)
      expect(result.message).toBeTruthy()
    })
  })

  // ── Scene lifecycle round-trip ─────────────────────────────────────────────

  describe('scene lifecycle round-trip', () => {
    it('a scene created via createSceneFromTemplate is returned by getOBSScenes', async () => {
      const sceneName = 'RoundTrip'
      const { success } = await createSceneFromTemplate(ws, sceneName, null)
      expect(success).toBe(true)

      const scenes = await getOBSScenes(ws)
      expect(scenes).toContain(sceneName)
    })

    it('repeated getOBSScenes calls are consistent', async () => {
      const first = await getOBSScenes(ws)
      const second = await getOBSScenes(ws)

      expect(first).toEqual(second)
    })
  })

  // ── Input audio tracks (obs-websocket 5.x) ────────────────────────────────
  // Exercises the same requests OpenClip's UI relies on for per-source routing.

  describe('GetInputAudioTracks / SetInputAudioTracks', () => {
    async function withRawObs(callback) {
      const { default: OBSWebSocket } = await import('obs-websocket-js')
      const obs = new OBSWebSocket()
      const url = `ws://${ws.host}:${ws.port}`
      await obs.connect(url, ws.password)
      try {
        return await callback(obs)
      } finally {
        obs.disconnect().catch(() => {})
      }
    }

    async function findTrackableInputName(obs) {
      const { inputs } = await obs.call('GetInputList')
      expect(Array.isArray(inputs)).toBe(true)
      for (const { inputName } of inputs) {
        try {
          await obs.call('GetInputAudioTracks', { inputName })
          return inputName
        } catch {
          continue
        }
      }
      return null
    }

    it('reads inputAudioTracks from at least one OBS input', async (ctx) => {
      await withRawObs(async (obs) => {
        const inputName = await findTrackableInputName(obs)
        if (!inputName) return ctx.skip()
        const res = await obs.call('GetInputAudioTracks', { inputName })
        expect(res).toHaveProperty('inputAudioTracks')
        expect(Object.keys(res.inputAudioTracks).length).toBeGreaterThan(0)
      })
    })

    it('round-trips SetInputAudioTracks (e.g. track 4 off, others on)', async (ctx) => {
      await withRawObs(async (obs) => {
        const inputName = await findTrackableInputName(obs)
        if (!inputName) return ctx.skip()

        const before = await obs.call('GetInputAudioTracks', { inputName })
        _audioTrackRestore.set(inputName, { ...before.inputAudioTracks })

        const desired = {
          '1': true,
          '2': true,
          '3': true,
          '4': false,
          '5': true,
          '6': true,
        }
        await obs.call('SetInputAudioTracks', { inputName, inputAudioTracks: desired })
        const after = await obs.call('GetInputAudioTracks', { inputName })
        for (let t = 1; t <= 6; t += 1) {
          const k = String(t)
          expect(Boolean(after.inputAudioTracks[k])).toBe(desired[k])
        }
      })
    })
  })
})

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Remove all OBS scenes except `keepScene` using the obs-websocket-js client
 * directly.  This is intentionally bypassing the production helpers so that
 * test teardown does not depend on the code under test.
 *
 * @param {{ host: string, port: number }} wsSettings
 * @param {string} keepScene  Scene name that must not be removed.
 */
async function _cleanupScenes(wsSettings, keepScene) {
  const { default: OBSWebSocket } = await import('obs-websocket-js')
  const obs = new OBSWebSocket()
  try {
    const connectArgs = [`ws://${wsSettings.host}:${wsSettings.port}`]
    if (wsSettings.password) {
      connectArgs.push(wsSettings.password)
    }
    await obs.connect(...connectArgs)
    const { scenes } = await obs.call('GetSceneList')
    for (const { sceneName } of scenes) {
      if (sceneName !== keepScene) {
        // Best-effort: OBS may refuse to remove the currently active scene
        await obs.call('RemoveScene', { sceneName }).catch(() => {})
      }
    }
  } finally {
    obs.disconnect().catch(() => {})
  }
}
