/**
 * OBS Orchestration Integration Tests
 *
 * These tests start a real (in-process) mock OBS WebSocket server that speaks
 * the OBS WebSocket v5 protocol, then exercise the production obsWebSocket.js
 * helpers against it.  No module mocking is used — the full network stack
 * (WebSocket handshake, JSON encoding, request/response cycle) runs end-to-end.
 *
 * The mock server is lightweight enough to run in any CI environment without
 * requiring an actual OBS installation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockObsServer } from './mockObsServer.js';

// Reset the obs-websocket-js ESM import cache between tests so each test
// gets a fresh OBSWebSocket instance (mirrors how the module reloads in prod).
async function getObsModule() {
  vi.resetModules();
  return await import('../../../electron/obsWebSocket.js');
}

describe('OBS Orchestration Integration Tests', () => {
  let server;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  // ── testOBSConnection ──────────────────────────────────────────────────────

  describe('testOBSConnection', () => {
    it('returns success and OBS version when server is reachable', async () => {
      server = await createMockObsServer();
      const { testOBSConnection } = await getObsModule();

      const result = await testOBSConnection(server.wsSettings);

      expect(result.success).toBe(true);
      expect(result.version).toMatch(/OBS 30\.0\.0/);
      expect(result.version).toMatch(/ws 5\.1\.0/);
    });

    it('returns failure when nothing is listening on the given port', async () => {
      const { testOBSConnection } = await getObsModule();

      // Port 1 is almost certainly not in use
      const result = await testOBSConnection({ host: '127.0.0.1', port: 1 });

      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
    });

    it('returns failure with a user-friendly message on connection refused', async () => {
      const { testOBSConnection } = await getObsModule();

      const result = await testOBSConnection({ host: '127.0.0.1', port: 1 });

      expect(result.success).toBe(false);
      // The error message should reference connection issues, not raw stack traces
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  // ── getOBSScenes ───────────────────────────────────────────────────────────

  describe('getOBSScenes', () => {
    it('returns the initial scene list from OBS', async () => {
      server = await createMockObsServer({ initialScenes: ['Game', 'Desktop', 'AFK'] });
      const { getOBSScenes } = await getObsModule();

      const scenes = await getOBSScenes(server.wsSettings);

      expect(scenes).toEqual(['Game', 'Desktop', 'AFK']);
    });

    it('returns an empty list when OBS has no scenes', async () => {
      server = await createMockObsServer({ initialScenes: [] });
      const { getOBSScenes } = await getObsModule();

      const scenes = await getOBSScenes(server.wsSettings);

      expect(scenes).toEqual([]);
    });

    it('returns a single scene', async () => {
      server = await createMockObsServer({ initialScenes: ['Scene'] });
      const { getOBSScenes } = await getObsModule();

      const scenes = await getOBSScenes(server.wsSettings);

      expect(scenes).toHaveLength(1);
      expect(scenes[0]).toBe('Scene');
    });

    it('throws when OBS is unreachable', async () => {
      const { getOBSScenes } = await getObsModule();

      await expect(getOBSScenes({ host: '127.0.0.1', port: 1 })).rejects.toThrow();
    });
  });

  // ── createSceneFromTemplate ────────────────────────────────────────────────

  describe('createSceneFromTemplate', () => {
    beforeEach(async () => {
      server = await createMockObsServer({ initialScenes: ['Template', 'Other'] });
    });

    it('creates an empty scene when no template is specified', async () => {
      const { createSceneFromTemplate } = await getObsModule();

      const result = await createSceneFromTemplate(server.wsSettings, 'NewScene', null);

      expect(result.success).toBe(true);
      expect(result.message).toContain('NewScene');
      expect(server.scenes.map(s => s.name)).toContain('NewScene');
    });

    it('creates a scene and copies sources from the template', async () => {
      // Add items to the template scene
      server.addSceneItem('Template', 'GameCapture');
      server.addSceneItem('Template', 'Microphone');
      const { createSceneFromTemplate } = await getObsModule();

      const result = await createSceneFromTemplate(server.wsSettings, 'GameScene', 'Template');

      expect(result.success).toBe(true);
      // Both sources should have been duplicated into the new scene
      const newScene = server.scenes.find(s => s.name === 'GameScene');
      expect(newScene).toBeDefined();
      expect(newScene.items).toHaveLength(2);
      expect(newScene.items.map(i => i.sourceName)).toEqual(
        expect.arrayContaining(['GameCapture', 'Microphone'])
      );
    });

    it('creates an empty scene when the template exists but has no items', async () => {
      // 'Template' scene is present but has no items
      const { createSceneFromTemplate } = await getObsModule();

      const result = await createSceneFromTemplate(server.wsSettings, 'EmptyClone', 'Template');

      expect(result.success).toBe(true);
      const newScene = server.scenes.find(s => s.name === 'EmptyClone');
      expect(newScene).toBeDefined();
      expect(newScene.items).toHaveLength(0);
    });

    it('creates an empty scene when the template name does not exist in OBS', async () => {
      const { createSceneFromTemplate } = await getObsModule();

      const result = await createSceneFromTemplate(
        server.wsSettings,
        'NewScene',
        'NonExistentTemplate'
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('NonExistentTemplate');
      expect(server.scenes.map(s => s.name)).toContain('NewScene');
    });

    it('returns failure when the new scene name is empty', async () => {
      const { createSceneFromTemplate } = await getObsModule();

      const result = await createSceneFromTemplate(server.wsSettings, '  ', null);

      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
    });

    it('returns failure when the scene already exists in OBS', async () => {
      const { createSceneFromTemplate } = await getObsModule();

      const result = await createSceneFromTemplate(server.wsSettings, 'Template', null);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Template');
    });

    it('trims whitespace from the scene name', async () => {
      const { createSceneFromTemplate } = await getObsModule();

      const result = await createSceneFromTemplate(server.wsSettings, '  Trimmed  ', null);

      expect(result.success).toBe(true);
      expect(server.scenes.map(s => s.name)).toContain('Trimmed');
    });

    it('the new scene is visible in getOBSScenes after creation', async () => {
      const { createSceneFromTemplate, getOBSScenes } = await getObsModule();

      await createSceneFromTemplate(server.wsSettings, 'BrandNew', null);
      const scenes = await getOBSScenes(server.wsSettings);

      expect(scenes).toContain('BrandNew');
    });

    it('returns failure when OBS is unreachable', async () => {
      const { createSceneFromTemplate } = await getObsModule();

      const result = await createSceneFromTemplate(
        { host: '127.0.0.1', port: 1 },
        'SomeScene',
        null
      );

      expect(result.success).toBe(false);
      expect(result.message).toBeTruthy();
    });

    it('copies multiple sources from a template into the new scene', async () => {
      server.addSceneItem('Template', 'Source1');
      server.addSceneItem('Template', 'Source2');
      server.addSceneItem('Template', 'Source3');
      const { createSceneFromTemplate } = await getObsModule();

      const result = await createSceneFromTemplate(
        server.wsSettings,
        'MultiSourceScene',
        'Template'
      );

      expect(result.success).toBe(true);
      const newScene = server.scenes.find(s => s.name === 'MultiSourceScene');
      expect(newScene.items).toHaveLength(3);
    });
  });

  // ── Concurrent operations ─────────────────────────────────────────────────

  describe('concurrent operations', () => {
    it('handles multiple simultaneous connections', async () => {
      server = await createMockObsServer({ initialScenes: ['Scene1', 'Scene2'] });
      const { getOBSScenes } = await getObsModule();

      // Fire three simultaneous scene-list requests
      const [r1, r2, r3] = await Promise.all([
        getOBSScenes(server.wsSettings),
        getOBSScenes(server.wsSettings),
        getOBSScenes(server.wsSettings),
      ]);

      expect(r1).toEqual(['Scene1', 'Scene2']);
      expect(r2).toEqual(['Scene1', 'Scene2']);
      expect(r3).toEqual(['Scene1', 'Scene2']);
    });

    it('creates scenes sequentially without collision', async () => {
      server = await createMockObsServer({ initialScenes: [] });
      const { createSceneFromTemplate } = await getObsModule();

      // Sequential creates (each call opens a new WebSocket connection)
      await createSceneFromTemplate(server.wsSettings, 'A', null);
      await createSceneFromTemplate(server.wsSettings, 'B', null);
      await createSceneFromTemplate(server.wsSettings, 'C', null);

      const names = server.scenes.map(s => s.name);
      expect(names).toContain('A');
      expect(names).toContain('B');
      expect(names).toContain('C');
    });
  });
});
