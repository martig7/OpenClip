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

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { isOBSAvailable, startOBS } from './obsHelper.js';
import {
  getOBSScenes,
  createSceneFromTemplate,
  testOBSConnection,
} from '../../../electron/obsWebSocket.js';

// ─── Skip the whole suite when OBS is not installed ───────────────────────
const obsAvailable = isOBSAvailable();

describe.skipIf(!obsAvailable)('OBS Orchestration – live OBS instance', () => {
  /** @type {{ wsSettings: object, stop: () => void }} */
  let obsInstance;
  let ws; // shorthand alias used in every test

  // Start a single OBS process for the entire test file.
  // We allow up to 60 s for OBS to boot and the WebSocket server to become
  // reachable — this covers slow CI runners.
  beforeAll(async () => {
    obsInstance = await startOBS({ initialScenes: ['Scene'] });
    ws = obsInstance.wsSettings;
  }, 60_000);

  afterAll(() => {
    obsInstance?.stop();
  });

  // After each test, delete every scene except the seed 'Scene' so that the
  // next test always starts from a clean, known state.
  afterEach(async () => {
    await _cleanupScenes(ws, 'Scene');
  });

  // ── testOBSConnection ────────────────────────────────────────────────────

  describe('testOBSConnection', () => {
    it('returns success and version info from real OBS', async () => {
      const result = await testOBSConnection(ws);

      expect(result.success).toBe(true);
      // OBS reports its own version; just confirm the shape is correct.
      expect(typeof result.version).toBe('string');
      expect(result.version).toMatch(/^OBS .+ \(ws .+\)$/);
    });

    it('returns failure when nothing is listening on the port', async () => {
      // Port 1 is a reserved port that will always be refused.
      const result = await testOBSConnection({ host: '127.0.0.1', port: 1 });

      expect(result.success).toBe(false);
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  // ── getOBSScenes ─────────────────────────────────────────────────────────

  describe('getOBSScenes', () => {
    it('returns the seed scene from the real OBS instance', async () => {
      const scenes = await getOBSScenes(ws);

      expect(Array.isArray(scenes)).toBe(true);
      expect(scenes).toContain('Scene');
    });

    it('returns an array of strings', async () => {
      const scenes = await getOBSScenes(ws);

      expect(scenes.every(s => typeof s === 'string')).toBe(true);
    });

    it('throws with a user-friendly message when OBS is unreachable', async () => {
      await expect(getOBSScenes({ host: '127.0.0.1', port: 1 })).rejects.toThrow();
    });
  });

  // ── createSceneFromTemplate ───────────────────────────────────────────────

  describe('createSceneFromTemplate', () => {
    it('creates an empty scene when no template is given', async () => {
      const result = await createSceneFromTemplate(ws, 'NewScene', null);

      expect(result.success).toBe(true);
      expect(result.message).toContain('NewScene');

      const scenes = await getOBSScenes(ws);
      expect(scenes).toContain('NewScene');
    });

    it('the created scene appears in the scene list immediately', async () => {
      await createSceneFromTemplate(ws, 'Immediate', null);
      const scenes = await getOBSScenes(ws);

      expect(scenes).toContain('Immediate');
    });

    it('creates multiple distinct scenes in sequence', async () => {
      await createSceneFromTemplate(ws, 'Alpha', null);
      await createSceneFromTemplate(ws, 'Beta', null);
      await createSceneFromTemplate(ws, 'Gamma', null);

      const scenes = await getOBSScenes(ws);
      expect(scenes).toContain('Alpha');
      expect(scenes).toContain('Beta');
      expect(scenes).toContain('Gamma');
    });

    it('trims whitespace from the scene name before creating', async () => {
      const result = await createSceneFromTemplate(ws, '  Trimmed  ', null);

      expect(result.success).toBe(true);
      const scenes = await getOBSScenes(ws);
      expect(scenes).toContain('Trimmed');
      expect(scenes).not.toContain('  Trimmed  ');
    });

    it('returns failure when the scene name is blank', async () => {
      const result = await createSceneFromTemplate(ws, '   ', null);

      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
    });

    it('returns failure when a scene with that name already exists', async () => {
      // 'Scene' was seeded at startup — attempting to create it again must fail.
      const result = await createSceneFromTemplate(ws, 'Scene', null);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Scene');
    });

    it('creates an empty scene when the template name does not exist in OBS', async () => {
      const result = await createSceneFromTemplate(ws, 'Orphan', 'NoSuchTemplate');

      // Should succeed — just creates an empty scene
      expect(result.success).toBe(true);
      const scenes = await getOBSScenes(ws);
      expect(scenes).toContain('Orphan');
    });

    it('creates an empty scene when the template has no items', async () => {
      // First create a template scene (it will be empty — OBS scenes start empty)
      await createSceneFromTemplate(ws, 'EmptyTemplate', null);

      const result = await createSceneFromTemplate(ws, 'ClonedEmpty', 'EmptyTemplate');

      expect(result.success).toBe(true);
      const scenes = await getOBSScenes(ws);
      expect(scenes).toContain('ClonedEmpty');
    });

    it('returns failure when OBS is unreachable', async () => {
      const result = await createSceneFromTemplate(
        { host: '127.0.0.1', port: 1 },
        'Unreachable',
        null
      );

      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
    });
  });

  // ── Scene lifecycle round-trip ─────────────────────────────────────────────

  describe('scene lifecycle round-trip', () => {
    it('a scene created via createSceneFromTemplate is returned by getOBSScenes', async () => {
      const sceneName = 'RoundTrip';
      const { success } = await createSceneFromTemplate(ws, sceneName, null);
      expect(success).toBe(true);

      const scenes = await getOBSScenes(ws);
      expect(scenes).toContain(sceneName);
    });

    it('repeated getOBSScenes calls are consistent', async () => {
      const first = await getOBSScenes(ws);
      const second = await getOBSScenes(ws);

      expect(first).toEqual(second);
    });
  });
});

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
  const { default: OBSWebSocket } = await import('obs-websocket-js');
  const obs = new OBSWebSocket();
  try {
    await obs.connect(`ws://${wsSettings.host}:${wsSettings.port}`);
    const { scenes } = await obs.call('GetSceneList');
    for (const { sceneName } of scenes) {
      if (sceneName !== keepScene) {
        // Best-effort: OBS may refuse to remove the currently active scene
        await obs.call('RemoveScene', { sceneName }).catch(() => {});
      }
    }
  } finally {
    obs.disconnect().catch(() => {});
  }
}
