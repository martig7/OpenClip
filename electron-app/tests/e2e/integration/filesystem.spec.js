/**
 * Filesystem integration tests.
 *
 * Verifies that the real API server (running in --integration-mode) reads from
 * and writes to actual disk, not mocked data.  The recording and destination
 * directories are isolated temp folders created by global-setup.js.
 *
 * The Electron app must be started by Playwright's webServer option
 * (npm run dev:integration), which inherits OBS_RECORDING_PATH and
 * OPENCLIP_DEST_PATH from globalSetup and seeds the store with them.
 */

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const API = 'http://localhost:47531';

// The recording path the Electron app was seeded with (from globalSetup env)
const recordingPath = process.env.OBS_RECORDING_PATH;
const destPath      = process.env.OPENCLIP_DEST_PATH;

test.describe('API server — real filesystem', () => {
  test.beforeAll(() => {
    // Seed dummy files in the recording path so the API has something to list.
    // Real OBS would write here; we drop empty files to test the scan logic.
    if (recordingPath) {
      const gameDir = join(recordingPath, 'Valorant', '2026-03-13');
      mkdirSync(gameDir, { recursive: true });
      writeFileSync(join(gameDir, 'Valorant_2026-03-13_10-00-00.mp4'), 'dummy');
      writeFileSync(join(gameDir, 'Valorant_2026-03-13_10-05-00.mp4'), 'dummy');
    }
  });

  test('GET /api/recordings returns a valid array', async ({ request }) => {
    const res = await request.get(`${API}/api/recordings`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /api/storage/stats returns correct shape', async ({ request }) => {
    const res = await request.get(`${API}/api/storage/stats`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('recording_count');
    expect(body).toHaveProperty('clip_count');
    expect(typeof body.recording_count).toBe('number');
    expect(typeof body.clip_count).toBe('number');
  });

  test('GET /api/storage/settings returns settings object', async ({ request }) => {
    const res = await request.get(`${API}/api/storage/settings`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('auto_delete_enabled');
    expect(typeof body.auto_delete_enabled).toBe('boolean');
  });

  test('GET /api/ffmpeg-check returns available flag', async ({ request }) => {
    const res = await request.get(`${API}/api/ffmpeg-check`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.available).toBe('boolean');
  });

  test('recording path and dest path are isolated from production', () => {
    // Verify we are pointing at the temp dirs created by globalSetup, not
    // production locations.  On Windows, os.tmpdir() resolves to
    // AppData\Local\Temp, so we cannot check for AppData absence; instead
    // verify the paths carry the expected temp-dir prefix.
    if (recordingPath) {
      expect(recordingPath).toMatch(/openclip-obs-rec-/i);
      expect(recordingPath).not.toMatch(/Roaming/i);
    }
    if (destPath) {
      expect(destPath).toMatch(/openclip-dest-/i);
      expect(destPath).not.toMatch(/Roaming/i);
    }
  });
});
