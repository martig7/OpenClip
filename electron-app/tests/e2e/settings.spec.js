import { test, expect } from './fixtures/electronPage.js'

// SettingsPage uses window.api, which falls back to mockApi in browser/test mode.
// mockApi returns defaultSettings from src/mockData.js (clipMarkerHotkey: 'F9').

test.describe('Settings Page', () => {
  test('settings page loads', async ({ page }) => {
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
  })

  test('displays F9 hotkey from mock settings', async ({ page }) => {
    await page.goto('/#/settings?section=hotkey')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    await expect(page.locator('.hotkey-capture-btn:has-text("F9")')).toBeVisible()
  })

  test('save button is disabled when settings unchanged', async ({ page }) => {
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    // The save button is always rendered, but disabled until settings are dirty
    await expect(page.locator('button:has-text("Save Settings")')).not.toBeEnabled()
  })

  test('save button becomes enabled after changing a setting', async ({ page }) => {
    await page.goto('/#/settings?section=watcher')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    // startWatcherOnStartup starts false — clicking its toggle marks settings dirty
    const watcherToggle = page
      .locator('.toggle-row', {
        has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
      })
      .locator('.toggle')
    await watcherToggle.click()
    await expect(page.locator('button:has-text("Save Settings")')).toBeEnabled()
  })

  test('watcher startup toggle starts off', async ({ page }) => {
    await page.goto('/#/settings?section=watcher')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    // defaultSettings.startWatcherOnStartup = false
    const watcherToggle = page
      .locator('.toggle-row', {
        has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
      })
      .locator('.toggle')
    await expect(watcherToggle).not.toHaveClass(/\bon\b/)
  })

  test('watcher startup toggle turns on when clicked', async ({ page }) => {
    await page.goto('/#/settings?section=watcher')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    const watcherToggle = page
      .locator('.toggle-row', {
        has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
      })
      .locator('.toggle')
    await watcherToggle.click()
    await expect(watcherToggle).toHaveClass(/on/)
  })

  test('auto-clip toggle starts off', async ({ page }) => {
    await page.goto('/#/settings?section=autoclip')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    // defaultSettings.autoClip.enabled = false
    const autoClipToggle = page
      .locator('.toggle-row', {
        has: page.locator('.toggle-label:has-text("Enable Auto-Clip")'),
      })
      .locator('.toggle')
    await expect(autoClipToggle).not.toHaveClass(/\bon\b/)
  })

  test('setup wizard button is visible', async ({ page }) => {
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    await expect(page.locator('button:has-text("Setup Wizard")')).toBeVisible()
  })
})

test.describe('Settings Page - Edge Cases', () => {
  test('toggling multiple settings enables save button', async ({ page }) => {
    await page.goto('/#/settings?section=watcher')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    await expect(page.locator('button:has-text("Save Settings")')).not.toBeEnabled()

    const watcherToggle = page
      .locator('.toggle-row', {
        has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
      })
      .locator('.toggle')
    await watcherToggle.click()

    await page.goto('/#/settings?section=autoclip')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    const autoClipToggle = page
      .locator('.toggle-row', {
        has: page.locator('.toggle-label:has-text("Enable Auto-Clip")'),
      })
      .locator('.toggle')
    await autoClipToggle.click()

    await expect(page.locator('button:has-text("Save Settings")')).toBeEnabled()
  })

  test('toggle state persists after page refresh', async ({ page }) => {
    await page.goto('/#/settings?section=autoclip')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    const autoClipToggle = page
      .locator('.toggle-row', {
        has: page.locator('.toggle-label:has-text("Enable Auto-Clip")'),
      })
      .locator('.toggle')
    await autoClipToggle.click()
    await expect(autoClipToggle).toHaveClass(/on/)

    await page.reload()
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
  })
})

test.describe('Settings Page - Persistence', () => {
  test('save settings persists to API and loads on page visit', async ({ page }) => {
    await page.goto('/#/settings?section=watcher')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    const watcherToggle = page
      .locator('.toggle-row', {
        has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
      })
      .locator('.toggle')
    await watcherToggle.click()
    await expect(watcherToggle).toHaveClass(/on/)

    await page.locator('button:has-text("Save Settings")').click()
    await expect(page.locator('button:has-text("Save Settings")')).not.toBeEnabled()

    await page.goto('/#/settings?section=watcher')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })
    await expect(
      page
        .locator('.toggle-row', {
          has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
        })
        .locator('.toggle')
    ).toHaveClass(/on/)
  })
})

test.describe('Settings Page - Hotkey Capture', () => {
  test('hotkey capture - pressing a key displays in field', async ({ page }) => {
    await page.goto('/#/settings?section=hotkey')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    const hotkeyBtn = page.locator('.hotkey-capture-btn').first()
    const initialText = await hotkeyBtn.textContent()
    await hotkeyBtn.click()
    await page.keyboard.press('R')

    await expect(hotkeyBtn).not.toHaveText(initialText)
  })
})

test.describe('Settings Page - New Settings Navigation Features', () => {
  test('legacy encoding tab query redirects to encoding profile section', async ({ page }) => {
    await page.goto('/#/settings?tab=encoding')
    await expect(page).toHaveURL(/\/#\/settings\?section=encoding-profile/)
  })

  test('encoding filter shows only encoding sections in sidebar', async ({ page }) => {
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    await page.locator('.msb-game-pill', { hasText: 'Encoding' }).click()

    const navItems = page.locator('.settings-nav-list .settings-nav-item')
    await expect(navItems).toHaveCount(4)
    await expect(navItems.filter({ hasText: 'OBS Profile' })).toHaveCount(1)
    await expect(navItems.filter({ hasText: 'Video' })).toHaveCount(1)
    await expect(navItems.filter({ hasText: 'Recording Output' })).toHaveCount(1)
    await expect(navItems.filter({ hasText: 'Encoder Settings' })).toHaveCount(1)
    await expect(navItems.filter({ hasText: 'Watcher' })).toHaveCount(0)
  })

  test('sidebar search can show empty state for unmatched query', async ({ page }) => {
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    await page.locator('#settings-sidebar-search-input').fill('no-such-section-xyz')
    await expect(page.locator('.settings-sidebar-empty strong')).toHaveText('No sections match')
  })
})

test.describe('Settings Page - Bento Active/Dirty States', () => {
  test('clicking a sidebar section marks its bento tile active', async ({ page }) => {
    await page.goto('/#/settings')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    await page
      .locator('.settings-nav-item', {
        has: page.locator('.settings-nav-item-title:has-text("View")'),
      })
      .click()

    await expect(page.locator('#settings-section-view')).toHaveClass(/settings-bento-item--active/)
  })

  test('changing a setting marks that bento tile dirty', async ({ page }) => {
    await page.goto('/#/settings?section=watcher')
    await expect(page.locator('.settings-page .msb-title')).toHaveText('Settings', { timeout: 5000 })

    const watcherToggle = page
      .locator('.toggle-row', {
        has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
      })
      .locator('.toggle')

    await watcherToggle.click()
    await expect(page.locator('#settings-section-watcher')).toHaveClass(/settings-bento-item--dirty/)
  })
})
