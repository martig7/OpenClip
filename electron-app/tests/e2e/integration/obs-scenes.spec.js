/**
 * OBS WebSocket integration tests — Playwright E2E layer.
 *
 * These exercise obsWebSocket.js against the real headless OBS instance
 * started by global-setup.js.  Playwright test bodies run in Node.js (not
 * the browser), so direct Node.js imports work fine here.
 *
 * OBS is fully isolated:
 *   - Started with --headless --portable, isolated config in a temp dir
 *   - Recordings go to a temp folder set by OBS_RECORDING_PATH
 *   - Port is random (passed via OBS_PORT env var from globalSetup)
 *
 * For equivalent vitest-based OBS tests (same obsWebSocket.js, full lifecycle
 * control) see tests/integration/obs/obsOrchestration.test.js.
 */

import { test, expect } from '@playwright/test';
import {
  wsSettings,
  cleanupTestScenes,
  createTestScene,
  getScenes,
  TEST_PREFIX,
} from './helpers/obsClient.js';
import {
  testOBSConnection,
  getOBSScenes,
  createSceneFromScratch,
  createSceneFromTemplate,
  deleteOBSScene,
} from '../../../electron/obsWebSocket.js';
import {
  getOBSAudioInputs,
  getTrackNames,
  setTrackNames,
  getSceneAudioSources,
} from '../../../electron/obsWsAudio.js';

test.describe('obsWebSocket.js — real headless OBS', () => {
  const ws = wsSettings(); // reads OBS_HOST / OBS_PORT from env (set by globalSetup)

  test.beforeEach(async () => {
    await cleanupTestScenes();
  });

  test.afterAll(async () => {
    await cleanupTestScenes();
  });

  // ── Connection ────────────────────────────────────────────────────────────

  test('testOBSConnection succeeds against headless OBS', async () => {
    const result = await testOBSConnection(ws);
    expect(result.success).toBe(true);
    expect(result.version).toMatch(/^OBS .+ \(ws .+\)$/);
  });

  // ── Scene list ────────────────────────────────────────────────────────────

  test('getOBSScenes returns an array of strings', async () => {
    const scenes = await getOBSScenes(ws);
    expect(Array.isArray(scenes)).toBe(true);
    expect(scenes.length).toBeGreaterThan(0);
    for (const name of scenes) expect(typeof name).toBe('string');
  });

  test('getOBSScenes reflects scenes created via direct WebSocket', async () => {
    const name = await createTestScene('GetScenesVerify');
    const scenes = await getOBSScenes(ws);
    expect(scenes).toContain(name);
  });

  // ── Scene creation ────────────────────────────────────────────────────────

  test('createSceneFromScratch creates a real scene in OBS', async () => {
    const name = `${TEST_PREFIX}FromScratch`;
    const result = await createSceneFromScratch(ws, name);
    expect(result.success).toBe(true);
    expect(await getScenes()).toContain(name);
  });

  test('createSceneFromScratch rejects duplicate name', async () => {
    const name = `${TEST_PREFIX}Duplicate`;
    const first = await createSceneFromScratch(ws, name);
    expect(first.success).toBe(true);
    const result = await createSceneFromScratch(ws, name);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already exists/i);
  });

  test('createSceneFromTemplate copies into new scene', async () => {
    const template = await createTestScene('Template');
    const name = `${TEST_PREFIX}FromTemplate`;
    const result = await createSceneFromTemplate(ws, name, template);
    expect(result.success).toBe(true);
    expect(await getScenes()).toContain(name);
  });

  test('createSceneFromTemplate with missing template still creates empty scene', async () => {
    const name = `${TEST_PREFIX}MissingTemplate`;
    const result = await createSceneFromTemplate(ws, name, 'NoSuchScene_XYZ');
    expect(result.success).toBe(true);
    expect(await getScenes()).toContain(name);
  });

  // ── Scene deletion ────────────────────────────────────────────────────────

  test('deleteOBSScene removes scene from OBS', async () => {
    const name = await createTestScene('ToDelete');
    const result = await deleteOBSScene(ws, name);
    // result.success=false here means OBS refused removal even after switching
    // the active scene — check the result.message for the reason.
    expect(result.success).toBe(true);
    // Poll to handle any brief propagation delay between the removal and the
    // scene list settling on a fresh connection (observed on Windows GUI mode).
    await expect.poll(() => getScenes(), { timeout: 2000 }).not.toContain(name);
  });

  test('deleteOBSScene on non-existent scene returns failure', async () => {
    const result = await deleteOBSScene(ws, 'NoSuchScene_XYZ_999');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/does not exist/i);
  });

  // ── Audio inputs ──────────────────────────────────────────────────────────

  test('getOBSAudioInputs returns an array (may be empty on headless OBS)', async () => {
    const inputs = await getOBSAudioInputs(ws);
    expect(Array.isArray(inputs)).toBe(true);
    for (const inp of inputs) {
      expect(inp).toHaveProperty('inputName');
      expect(inp).toHaveProperty('inputKind');
    }
  });

  // ── Track names (profile parameters) ─────────────────────────────────────

  test('getTrackNames returns 6 track name strings', async () => {
    const names = await getTrackNames(ws);
    expect(names).toHaveLength(6);
    for (const name of names) expect(typeof name).toBe('string');
  });

  test('setTrackNames round-trips through OBS profile', async () => {
    const original = await getTrackNames(ws);
    const updated = ['Game Audio', 'Mic', 'Discord', 'Music', 'SFX', 'Spare'];
    try {
      await setTrackNames(ws, updated);
      expect(await getTrackNames(ws)).toEqual(updated);
    } finally {
      await setTrackNames(ws, original); // restore
    }
  });

  // ── Scene audio sources ───────────────────────────────────────────────────

  test('getSceneAudioSources returns empty array for scene with no audio', async () => {
    const name = await createTestScene('NoAudio');
    const sources = await getSceneAudioSources(ws, name);
    expect(Array.isArray(sources)).toBe(true);
    expect(sources).toHaveLength(0);
  });
});
