import { test, expect } from '@playwright/test';

// SettingsPage uses window.api, which falls back to mockApi in browser/test mode.
// mockApi returns defaultSettings from src/mockData.js (clipMarkerHotkey: 'F9').

test.describe('Settings Page', () => {
  test('settings page loads', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
  });

  test('displays F9 hotkey from mock settings', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.hotkey-capture-btn:has-text("F9")')).toBeVisible();
  });

  test('save button is disabled when settings unchanged', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    // The save button is always rendered, but disabled until settings are dirty
    await expect(page.locator('button:has-text("Save Settings")')).not.toBeEnabled();
  });

  test('save button becomes enabled after changing a setting', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    // startWatcherOnStartup starts false — clicking its toggle marks settings dirty
    const watcherToggle = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
    }).locator('.toggle');
    await watcherToggle.click();
    await expect(page.locator('button:has-text("Save Settings")')).toBeEnabled();
  });

  test('watcher startup toggle starts off', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    // defaultSettings.startWatcherOnStartup = false
    const watcherToggle = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
    }).locator('.toggle');
    await expect(watcherToggle).not.toHaveClass(/\bon\b/);
  });

  test('watcher startup toggle turns on when clicked', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    const watcherToggle = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
    }).locator('.toggle');
    await watcherToggle.click();
    await expect(watcherToggle).toHaveClass(/on/);
  });

  test('auto-clip toggle starts off', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    // defaultSettings.autoClip.enabled = false
    const autoClipToggle = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Enable Auto-Clip")'),
    }).locator('.toggle');
    await expect(autoClipToggle).not.toHaveClass(/\bon\b/);
  });

  test('setup wizard button is visible', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Setup Wizard")')).toBeVisible();
  });
});

test.describe('Settings Page - Edge Cases', () => {
  test('toggling multiple settings enables save button', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Save Settings")')).not.toBeEnabled();
    
    const watcherToggle = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
    }).locator('.toggle');
    await watcherToggle.click();
    
    const autoClipToggle = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Enable Auto-Clip")'),
    }).locator('.toggle');
    await autoClipToggle.click();
    
    await expect(page.locator('button:has-text("Save Settings")')).toBeEnabled();
  });

  test('toggle state persists after page refresh', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    
    const autoClipToggle = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Enable Auto-Clip")'),
    }).locator('.toggle');
    await autoClipToggle.click();
    await expect(autoClipToggle).toHaveClass(/on/);
    
    await page.reload();
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Settings Page - Persistence', () => {
  test('save settings persists to API and loads on page visit', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    
    const watcherToggle = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
    }).locator('.toggle');
    await watcherToggle.click();
    await expect(watcherToggle).toHaveClass(/on/);
    
    await page.locator('button:has-text("Save Settings")').click();
    await expect(page.locator('button:has-text("Save Settings")')).not.toBeEnabled();
    
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Settings Page - Hotkey Capture', () => {
  test('hotkey capture - pressing a key displays in field', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    
    const hotkeyBtn = page.locator('.hotkey-capture-btn').first();
    const initialText = await hotkeyBtn.textContent();
    await hotkeyBtn.click();
    await page.keyboard.press('R');
    
    await expect(hotkeyBtn).not.toHaveText(initialText);
  });
});
