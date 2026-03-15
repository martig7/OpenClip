import { test, expect } from '@playwright/test';

/**
 * Injects a window.api stub before page scripts load.
 *
 * In the Playwright browser there is no Electron preload, so api.js falls back to
 * mockApi. By setting window.api via addInitScript we get a controlled stub that
 * stores the onSessionProgress callback in window.__sessionProgressCb so tests
 * can fire events with page.evaluate().
 */
async function injectProgressApi(page) {
  await page.addInitScript(() => {
    const noop = () => {};
    const asyncNoop = async () => null;
    const asyncArr = async () => [];

    window.__sessionProgressCbs = [];

    window.api = {
      // Store
      getStore: async (key) => {
        if (key === 'settings') return { organizeRemux: true };
        return null;
      },
      setStore: asyncNoop,

      // Games — return empty list so pages don't crash
      getGames: asyncArr,
      addGame: asyncArr,
      removeGame: asyncArr,
      toggleGame: asyncArr,
      updateGame: asyncArr,

      // Windows
      getVisibleWindows: asyncArr,
      extractWindowIcon: asyncNoop,

      // Watcher
      startWatcher: asyncNoop,
      stopWatcher: asyncNoop,
      getWatcherStatus: async () => ({ running: false }),
      onWatcherState: () => noop,
      onWatcherStatusPush: () => noop,

      // OBS (needed by Settings/Games pages; no-ops are fine here)
      detectOBSPath: asyncNoop,
      getOBSProfiles: asyncArr,
      getEncodingSettings: asyncNoop,
      setEncodingSettings: asyncNoop,
      isOBSRunning: async () => false,
      launchOBS: asyncNoop,
      isOBSScriptLoaded: async () => false,
      getOBSWSScenes: asyncArr,
      getOBSAudioInputs: asyncArr,
      getSceneAudioSources: asyncArr,
      getInputAudioTracks: asyncNoop,
      setInputAudioTracks: asyncNoop,
      getTrackNames: asyncNoop,
      setTrackNames: asyncNoop,
      listWindowsAudioDevices: asyncArr,
      listRunningApps: asyncArr,

      // Dialogs / shell
      openDirectoryDialog: asyncNoop,
      openFileDialog: asyncNoop,
      showInExplorer: asyncNoop,
      openExternal: asyncNoop,

      // Recordings
      getRecordings: asyncArr,
      deleteRecording: asyncNoop,
      getVideoURL: async (p) => `file:///${p}`,
      organizeRecording: asyncNoop,
      onOrganizeProgress: () => noop,

      // Session progress — mirrors preload.js replay logic for mid-session mounts
      // Supports multiple subscribers (App.jsx + page components both subscribe).
      onSessionProgress: (cb) => {
        window.__sessionProgressCbs = window.__sessionProgressCbs || [];
        window.__sessionProgressCbs.push(cb);
        if (window.__lastSessionProgress) {
          const p = window.__lastSessionProgress;
          Promise.resolve().then(() => cb(p));
        }
        return () => {
          window.__sessionProgressCbs = (window.__sessionProgressCbs || []).filter(fn => fn !== cb);
        };
      },

      // Clips
      getClips: asyncArr,
      createClip: asyncNoop,
      deleteClip: asyncNoop,

      // Markers
      getMarkers: asyncArr,
      deleteMarker: asyncArr,
      onMarkerAdded: () => noop,

      // Storage
      getStorageStats: async () => ({ totalSize: 0, byGame: {} }),

      // Hotkey
      registerHotkey: asyncNoop,

      // Re-encode
      reencodeVideo: asyncNoop,

      // Onboarding
      isOnboardingComplete: async () => true,
      setOnboardingComplete: asyncNoop,
      installOBSPlugin: asyncNoop,
      removeOBSPlugin: asyncNoop,
      detectOBSInstallPath: asyncNoop,
      detectOBSPath: asyncNoop,
      setOBSInstallPath: asyncNoop,
      getOBSInstallPath: asyncNoop,
      isOBSPluginRegistered: async () => false,

      // API server port
      getApiPort: asyncNoop,

      // Auto-updater
      checkForUpdate: asyncNoop,
      installUpdate: asyncNoop,
      onUpdateAvailable: () => noop,
      onUpdateProgress: () => noop,
      onUpdateDownloaded: () => noop,
      onUpdateError: () => noop,
    };
  });
}

/** Fire a session progress event in the browser (also updates the replay cache). */
async function fireProgress(page, progress) {
  await page.evaluate((p) => {
    window.__lastSessionProgress = p.phase === 'complete' ? null : p;
    (window.__sessionProgressCbs || []).forEach(cb => cb(p));
  }, progress);
}

// ──────────────────────────────────────────────────────────────────────────────
// Recordings Page
// ──────────────────────────────────────────────────────────────────────────────

test.describe('Session Progress — Recordings Page', () => {
  test.beforeEach(async ({ page }) => {
    await injectProgressApi(page);
  });

  test('banner appears when a recording-phase event fires', async ({ page }) => {
    await page.route('**/api/recordings', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });

    await fireProgress(page, { phase: 'recording', stage: 'checking', label: 'Verifying recording…', gameName: 'Halo' });

    await expect(page.locator('.session-progress-banner')).toBeVisible();
    await expect(page.locator('.session-progress-banner')).toContainText('Verifying recording…');
  });

  test('banner does not appear for clipping-phase events', async ({ page }) => {
    await page.route('**/api/recordings', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });

    await fireProgress(page, { phase: 'clipping', stage: 'clipping', label: 'Creating clip 1 of 3…', gameName: 'Halo', clipIndex: 1, clipTotal: 3 });

    await expect(page.locator('.session-progress-banner')).not.toBeVisible();
  });

  test('banner disappears and recordings list refreshes on complete', async ({ page }) => {
    await page.route('**/api/recordings', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });

    await fireProgress(page, { phase: 'recording', stage: 'remuxing', label: 'Remuxing to MP4…', gameName: 'Halo' });
    await expect(page.locator('.session-progress-banner')).toBeVisible();

    // Fire complete and wait for the list-refresh request
    const refreshRequest = page.waitForRequest('**/api/recordings', { timeout: 5000 });
    await fireProgress(page, { phase: 'complete', gameName: 'Halo' });
    await refreshRequest;

    await expect(page.locator('.session-progress-banner')).not.toBeVisible();
  });

  test('progress fill is 20% for checking, 65% for remuxing, 90% for moving', async ({ page }) => {
    await page.route('**/api/recordings', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });

    // checking → 20%
    await fireProgress(page, { phase: 'recording', stage: 'checking', label: 'Verifying recording…', gameName: 'Halo' });
    let width = await page.locator('.session-progress-fill').evaluate(el => el.style.width);
    expect(width).toBe('20%');

    // remuxing → 65%
    await fireProgress(page, { phase: 'recording', stage: 'remuxing', label: 'Remuxing to MP4…', gameName: 'Halo' });
    width = await page.locator('.session-progress-fill').evaluate(el => el.style.width);
    expect(width).toBe('65%');

    // moving → 90%
    await fireProgress(page, { phase: 'recording', stage: 'moving', label: 'Moving file…', gameName: 'Halo' });
    width = await page.locator('.session-progress-fill').evaluate(el => el.style.width);
    expect(width).toBe('90%');
  });

  test('banner updates label as stages progress from checking to moving', async ({ page }) => {
    await page.route('**/api/recordings', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });

    await fireProgress(page, { phase: 'recording', stage: 'checking', label: 'Verifying recording…', gameName: 'Halo' });
    await expect(page.locator('.session-progress-banner')).toContainText('Verifying recording…');

    await fireProgress(page, { phase: 'recording', stage: 'moving', label: 'Moving file…', gameName: 'Halo' });
    await expect(page.locator('.session-progress-banner')).toContainText('Moving file…');
  });

  test('new recording appears in list after complete fires', async ({ page }) => {
    const newRecording = {
      filename: 'Halo Session 2026-03-15 #1.mp4',
      path: 'C:/Videos/Halo/Halo Session 2026-03-15 #1.mp4',
      game_name: 'Halo',
      date: '2026-03-15',
      size_formatted: '2.0 GB',
      size_bytes: 2147483648,
      mtime: Date.now(),
    };

    // Initial fetch returns empty list
    await page.route('**/api/recordings', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.item-card')).not.toBeVisible();

    // Before complete fires, override the route to return the new recording
    await page.unroute('**/api/recordings');
    await page.route('**/api/recordings', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([newRecording]),
    }));

    await fireProgress(page, { phase: 'complete', gameName: 'Halo' });

    await expect(page.locator('.item-name:has-text("Halo Session 2026-03-15 #1.mp4")')).toBeVisible({ timeout: 5000 });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Clips Page
// ──────────────────────────────────────────────────────────────────────────────

test.describe('Session Progress — Clips Page', () => {
  test.beforeEach(async ({ page }) => {
    await injectProgressApi(page);
  });

  test('banner appears for recording-phase events with "Processing session" prefix', async ({ page }) => {
    await page.route('**/api/clips', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });

    await fireProgress(page, { phase: 'recording', stage: 'checking', label: 'Verifying recording…', gameName: 'Halo' });

    await expect(page.locator('.session-progress-banner')).toBeVisible();
    await expect(page.locator('.session-progress-banner')).toContainText('Processing session');
    await expect(page.locator('.session-progress-banner')).toContainText('Verifying recording…');
  });

  test('banner appears for clipping-phase events with clip label', async ({ page }) => {
    await page.route('**/api/clips', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });

    await fireProgress(page, { phase: 'clipping', stage: 'clipping', label: 'Creating clip 2 of 5…', gameName: 'Halo', clipIndex: 2, clipTotal: 5 });

    await expect(page.locator('.session-progress-banner')).toBeVisible();
    await expect(page.locator('.session-progress-banner')).toContainText('Creating clip 2 of 5…');
  });

  test('banner disappears and clips list refreshes on complete', async ({ page }) => {
    await page.route('**/api/clips', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });

    await fireProgress(page, { phase: 'clipping', stage: 'clipping', label: 'Creating clip 1 of 1…', gameName: 'Halo', clipIndex: 1, clipTotal: 1 });
    await expect(page.locator('.session-progress-banner')).toBeVisible();

    const refreshRequest = page.waitForRequest('**/api/clips', { timeout: 5000 });
    await fireProgress(page, { phase: 'complete', gameName: 'Halo' });
    await refreshRequest;

    await expect(page.locator('.session-progress-banner')).not.toBeVisible();
  });

  test('progress fill is wider for clipping phase than for recording checking phase', async ({ page }) => {
    await page.route('**/api/clips', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });

    await fireProgress(page, { phase: 'recording', stage: 'checking', label: 'Verifying recording…', gameName: 'Halo' });
    const checkingWidth = parseFloat(
      await page.locator('.session-progress-fill').evaluate(el => el.style.width)
    );

    await fireProgress(page, { phase: 'clipping', stage: 'clipping', label: 'Creating clip 1 of 2…', gameName: 'Halo', clipIndex: 1, clipTotal: 2 });
    const clippingWidth = parseFloat(
      await page.locator('.session-progress-fill').evaluate(el => el.style.width)
    );

    expect(clippingWidth).toBeGreaterThan(checkingWidth);
  });

  test('progress fill advances as clip index increases', async ({ page }) => {
    await page.route('**/api/clips', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });

    await fireProgress(page, { phase: 'clipping', stage: 'clipping', label: 'Creating clip 1 of 5…', gameName: 'Halo', clipIndex: 1, clipTotal: 5 });
    const width1 = parseFloat(
      await page.locator('.session-progress-fill').evaluate(el => el.style.width)
    );

    await fireProgress(page, { phase: 'clipping', stage: 'clipping', label: 'Creating clip 5 of 5…', gameName: 'Halo', clipIndex: 5, clipTotal: 5 });
    const width5 = parseFloat(
      await page.locator('.session-progress-fill').evaluate(el => el.style.width)
    );

    expect(width5).toBeGreaterThan(width1);
  });

  test('banner transitions from recording phase to clipping phase', async ({ page }) => {
    await page.route('**/api/clips', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });

    // Recording phase
    await fireProgress(page, { phase: 'recording', stage: 'moving', label: 'Moving file…', gameName: 'Halo' });
    await expect(page.locator('.session-progress-banner')).toContainText('Processing session');

    // Clips phase follows
    await fireProgress(page, { phase: 'clipping', stage: 'clipping', label: 'Creating clip 1 of 2…', gameName: 'Halo', clipIndex: 1, clipTotal: 2 });
    await expect(page.locator('.session-progress-banner')).toContainText('Creating clip 1 of 2…');
    // "Processing session" prefix should NOT appear for clipping phase
    await expect(page.locator('.session-progress-banner')).not.toContainText('Processing session');
  });

  test('new clip appears in list after complete fires', async ({ page }) => {
    const newClip = {
      filename: 'Halo Clip 2026-03-15 #1.mp4',
      path: 'C:/Videos/Clips/Halo Clip 2026-03-15 #1.mp4',
      game_name: 'Halo',
      date: '2026-03-15',
      size_formatted: '50.0 MB',
      size_bytes: 52428800,
      mtime: Date.now(),
    };

    // Initial fetch returns empty list
    await page.route('**/api/clips', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.item-card')).not.toBeVisible();

    // Override route before complete fires to return the new clip
    await page.unroute('**/api/clips');
    await page.route('**/api/clips', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([newClip]),
    }));

    await fireProgress(page, { phase: 'complete', gameName: 'Halo' });

    await expect(page.locator('.item-name:has-text("Halo Clip 2026-03-15 #1.mp4")')).toBeVisible({ timeout: 5000 });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Mid-session navigation — the scenario the user reported
// ──────────────────────────────────────────────────────────────────────────────

test.describe('Session Progress — Mid-session Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await injectProgressApi(page);
    await page.route('**/api/recordings', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
    await page.route('**/api/clips', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
  });

  test('recordings banner appears when navigating to page mid-session', async ({ page }) => {
    // Start on Clips page and fire a recording-phase event
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
    await fireProgress(page, { phase: 'recording', stage: 'remuxing', label: 'Remuxing to MP4…', gameName: 'Halo' });

    // Navigate to Recordings — banner should appear immediately on mount
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.session-progress-banner')).toBeVisible();
    await expect(page.locator('.session-progress-banner')).toContainText('Remuxing to MP4…');
  });

  test('clips banner appears when navigating to page mid-session', async ({ page }) => {
    // Start on Recordings page and fire a clipping-phase event
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await fireProgress(page, { phase: 'clipping', stage: 'clipping', label: 'Creating clip 1 of 3…', gameName: 'Halo', clipIndex: 1, clipTotal: 3 });

    // Navigate to Clips — banner should appear immediately on mount
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.session-progress-banner')).toBeVisible();
    await expect(page.locator('.session-progress-banner')).toContainText('Creating clip 1 of 3…');
  });

  test('banner is absent when navigating to recordings after session completes', async ({ page }) => {
    // Fire progress then complete while on Clips page
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
    await fireProgress(page, { phase: 'recording', stage: 'checking', label: 'Verifying recording…', gameName: 'Halo' });
    await fireProgress(page, { phase: 'complete', gameName: 'Halo' });

    // Navigate to Recordings — no banner should appear
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.session-progress-banner')).not.toBeVisible();
  });

  test('recordings banner reflects latest stage when navigating mid-session', async ({ page }) => {
    // Fire multiple stage updates while on another page
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
    await fireProgress(page, { phase: 'recording', stage: 'checking', label: 'Verifying recording…', gameName: 'Halo' });
    await fireProgress(page, { phase: 'recording', stage: 'remuxing', label: 'Remuxing to MP4…', gameName: 'Halo' });

    // Navigate to Recordings — should show the latest stage (remuxing), not the first (checking)
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.session-progress-banner')).toContainText('Remuxing to MP4…');
    const width = await page.locator('.session-progress-fill').evaluate(el => el.style.width);
    expect(width).toBe('65%');
  });
});
