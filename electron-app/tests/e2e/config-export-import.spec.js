import { test, expect } from '@playwright/test'

// SettingsPage uses window.api, which falls back to mockApi when unset.
// These tests that need controlled export/import results inject a custom
// window.api via addInitScript (runs before React initialises, so
// `const api = window.api || mockApi` in src/api.js picks it up).

/**
 * Inject a window.api replacement that provides controlled results for
 * exportConfig and importConfig, plus all the methods SettingsPage needs
 * on mount. Call before page.goto().
 *
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   exportResult?: object,
 *   importResult?: object,
 *   importedSettings?: object,
 *   initialSettings?: object,
 * }} opts
 */
async function injectApi(page, opts = {}) {
  await page.addInitScript((options) => {
    const defaultSettings = {
      obsRecordingPath: '',
      destinationPath: '',
      startWatcherOnStartup: false,
      clipMarkerHotkey: options.initialSettings?.clipMarkerHotkey ?? 'F9',
      listView: true,
      organizeRemux: true,
      advancedGameAddition: false,
      weekFolders: false,
      autoClip: {
        enabled: false,
        bufferBefore: 30,
        bufferAfter: 5,
        removeMarkers: true,
        deleteFullRecording: false,
        audioTracks: [],
      },
      autoDelete: {
        enabled: false,
        maxStorageGB: 100,
        maxAgeDays: 30,
        excludeClips: true,
      },
      obsWebSocket: { host: 'localhost', port: 4455, password: '' },
      waveformResolution: 'default',
      shareHost: 'gofile',
      shareLitterboxExpiry: '24h',
      ...options.initialSettings,
    }

    let settings = { ...defaultSettings }
    const noop = () => {}
    const asyncNoop = async () => null
    const trackNames = ['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6']

    window.api = {
      testMode: true,
      setTitleBarOverlay: noop,

      getStore: async (key) => {
        if (key === 'settings') return { ...settings }
        if (key === 'trackNames') return [...trackNames]
        if (key === 'games') return []
        if (key === 'shareLinks') return {}
        return null
      },
      setStore: async (key, value) => {
        if (key === 'settings') settings = { ...settings, ...value }
      },

      isOBSPluginRegistered: async () => false,
      getOBSInstallPath: async () => '',
      getTrackNamesLive: async () => [...trackNames],
      registerHotkey: asyncNoop,

      exportConfig: async () => {
        return options.exportResult ?? { success: true, path: '/tmp/openclip-config.json' }
      },
      importConfig: async () => {
        const result = options.importResult ?? { success: true }
        if (result.success && options.importedSettings) {
          settings = { ...settings, ...options.importedSettings }
        }
        return result
      },

      // Remaining methods SettingsPage references (optional-chained or called on interaction only)
      onUpdateAvailable: () => noop,
      onUpdateProgress: () => noop,
      onUpdateDownloaded: () => noop,
      onUpdateError: () => noop,
      checkForUpdate: asyncNoop,
      installUpdate: asyncNoop,
      detectOBSPath: asyncNoop,
      detectOBSInstallPath: asyncNoop,
      setOBSInstallPath: asyncNoop,
      installOBSPlugin: asyncNoop,
      removeOBSPlugin: asyncNoop,
      getOBSProfiles: async () => [],
      getEncodingSettings: asyncNoop,
      setEncodingSettings: asyncNoop,
      isOBSRunning: async () => false,
      onOrganizeProgress: () => noop,
      onSessionProgress: () => noop,
      clearSessionProgress: noop,
    }
  }, opts)
}

// ---------------------------------------------------------------------------
// Button visibility (no injection needed — default mockApi suffices)
// ---------------------------------------------------------------------------

test.describe('Config Export / Import — Button Visibility', () => {
  test('Export Config button is visible on settings page', async ({ page }) => {
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    await expect(page.locator('button:has-text("Export Config")')).toBeVisible()
  })

  test('Import Config button is visible on settings page', async ({ page }) => {
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    await expect(page.locator('button:has-text("Import Config")')).toBeVisible()
  })

  test('Export Config and Import Config buttons appear before Setup Wizard', async ({ page }) => {
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    const actions = page.locator('.settings-detail-actions')
    const buttons = actions.locator('button')
    await expect(buttons.nth(0)).toHaveText(/Export Config/)
    await expect(buttons.nth(1)).toHaveText(/Import Config/)
    await expect(buttons.nth(2)).toHaveText(/Setup Wizard/)
  })
})

// ---------------------------------------------------------------------------
// Export Config behaviour
// ---------------------------------------------------------------------------

test.describe('Config Export', () => {
  test('successful export shows success toast', async ({ page }) => {
    await injectApi(page, {
      exportResult: { success: true, path: '/tmp/openclip-config.json' },
    })
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    await page.locator('button:has-text("Export Config")').click()

    await expect(page.locator('.toast')).toHaveText('Config exported successfully')
  })

  test('canceled export dialog shows no toast', async ({ page }) => {
    await injectApi(page, {
      exportResult: { success: false, canceled: true },
    })
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    await page.locator('button:has-text("Export Config")').click()

    await expect(page.locator('.toast')).not.toBeVisible()
  })

  test('failed export shows error toast with message', async ({ page }) => {
    await injectApi(page, {
      exportResult: { success: false, error: 'Disk full' },
    })
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    await page.locator('button:has-text("Export Config")').click()

    await expect(page.locator('.toast')).toHaveText('Export failed: Disk full')
  })

  test('failed export with no error message shows generic error toast', async ({ page }) => {
    await injectApi(page, {
      exportResult: { success: false },
    })
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    await page.locator('button:has-text("Export Config")').click()

    await expect(page.locator('.toast')).toHaveText('Export failed')
  })

  test('export does not dirty the save button', async ({ page }) => {
    await injectApi(page, {
      exportResult: { success: true, path: '/tmp/openclip-config.json' },
    })
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    await expect(page.locator('button:has-text("Save Settings")')).not.toBeEnabled()

    await page.locator('button:has-text("Export Config")').click()
    await expect(page.locator('.toast')).toHaveText('Config exported successfully')

    await expect(page.locator('button:has-text("Save Settings")')).not.toBeEnabled()
  })
})

// ---------------------------------------------------------------------------
// Import Config behaviour
// ---------------------------------------------------------------------------

test.describe('Config Import', () => {
  test('successful import shows success toast', async ({ page }) => {
    await injectApi(page, {
      importResult: { success: true },
    })
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    await page.locator('button:has-text("Import Config")').click()

    await expect(page.locator('.toast')).toHaveText('Config imported — settings reloaded')
  })

  test('canceled import dialog shows no toast', async ({ page }) => {
    await injectApi(page, {
      importResult: { success: false, canceled: true },
    })
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    await page.locator('button:has-text("Import Config")').click()

    await expect(page.locator('.toast')).not.toBeVisible()
  })

  test('failed import shows error toast with message', async ({ page }) => {
    await injectApi(page, {
      importResult: { success: false, error: 'File is not an OpenClip config.' },
    })
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    await page.locator('button:has-text("Import Config")').click()

    await expect(page.locator('.toast')).toHaveText('Import failed: File is not an OpenClip config.')
  })

  test('failed import with no error message shows generic error toast', async ({ page }) => {
    await injectApi(page, {
      importResult: { success: false },
    })
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    await page.locator('button:has-text("Import Config")').click()

    await expect(page.locator('.toast')).toHaveText('Import failed')
  })

  test('successful import reloads settings — updated hotkey visible immediately', async ({
    page,
  }) => {
    // Page initially shows F9; import changes clipMarkerHotkey to F10
    await injectApi(page, {
      importResult: { success: true },
      importedSettings: { clipMarkerHotkey: 'F10' },
      initialSettings: { clipMarkerHotkey: 'F9' },
    })
    await page.goto('/#/settings?section=hotkey')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    await expect(page.locator('.hotkey-capture-btn:has-text("F9")')).toBeVisible()

    await page.locator('button:has-text("Import Config")').click()
    await expect(page.locator('.toast')).toHaveText('Config imported — settings reloaded')

    await expect(page.locator('.hotkey-capture-btn:has-text("F10")')).toBeVisible()
  })

  test('successful import clears dirty state', async ({ page }) => {
    // Dirty the form first, then import — dirty indicator should be gone after reload
    await injectApi(page, {
      importResult: { success: true },
    })
    await page.goto('/#/settings?section=watcher')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    const watcherToggle = page
      .locator('.toggle-row', {
        has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
      })
      .locator('.toggle')
    await watcherToggle.click()
    await expect(page.locator('button:has-text("Save Settings")')).toBeEnabled()

    await page.locator('button:has-text("Import Config")').click()
    await expect(page.locator('.toast')).toHaveText('Config imported — settings reloaded')

    // loadSettings() resets isDirty — save button should be disabled again
    await expect(page.locator('button:has-text("Save Settings")')).not.toBeEnabled()
  })
})
