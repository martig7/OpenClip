import { test, expect } from '@playwright/test';
import { setupApiRoutes } from './fixtures/routes.js';

// Interaction tests verify user flows across pages.
// GamesPage / SettingsPage use window.api → mockApi (no route mock needed).
// RecordingsPage / ClipsPage / StoragePage use apiFetch → need setupApiRoutes().

test.describe('Games Page Interactions', () => {
  test('displays games list from mock data', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Games');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    await expect(page.locator('.list-item-title:has-text("Counter-Strike 2")')).toBeVisible();
  });

  test('can open add game modal', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    await expect(page.locator('h2:has-text("Add Game")')).toBeVisible();
    await expect(page.locator('input[placeholder="e.g. Valorant"]')).toBeVisible();
  });

  test('can fill and submit add game form', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    await page.click('button:has-text("Add Game")');
    await page.locator('input[placeholder="e.g. Valorant"]').fill('Minecraft');
    await page.locator('input[placeholder="e.g. VALORANT or valorant.exe"]').fill('javaw.exe');
    await page.locator('input[placeholder="e.g. Gaming Scene (required)"]').fill('Minecraft Scene');
    // Add Game button should now be enabled (scene is filled)
    const addBtn = page.locator('.modal button:has-text("Add Game")');
    await expect(addBtn).toBeEnabled();
    await addBtn.click();
    // Modal closes and new game appears in the list
    await expect(page.locator('h2:has-text("Add Game")')).not.toBeVisible();
    await expect(page.locator('.list-item-title:has-text("Minecraft")')).toBeVisible();
  });

  test('removing a game removes it from the list', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Counter-Strike 2")')).toBeVisible();
    // CS2 has a scene, so confirm dialog will appear
    const cs2Item = page.locator('.list-item', {
      has: page.locator('.list-item-title:has-text("Counter-Strike 2")'),
    });
    await cs2Item.locator('[title="Remove game"]').click();
    await expect(page.locator('h2:has-text("Remove Game")')).toBeVisible();
    // Remove game only (no scene deletion)
    await page.locator('button:has-text("Game only")').click();
    await expect(page.locator('.list-item-title:has-text("Counter-Strike 2")')).not.toBeVisible();
  });
});

test.describe('Settings Page Interactions', () => {
  test('displays hotkey from mock settings', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.hotkey-capture-btn:has-text("F9")')).toBeVisible();
  });

  test('watcher startup toggle changes state', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    // startWatcherOnStartup starts false in defaultSettings
    const watcherToggle = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
    }).locator('.toggle');
    await expect(watcherToggle).not.toHaveClass(/\bon\b/);
    await watcherToggle.click();
    await expect(watcherToggle).toHaveClass(/\bon\b/);
  });

  test('changing a setting enables the save button', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Save Settings")')).not.toBeEnabled();
    const watcherToggle = page.locator('.toggle-row', {
      has: page.locator('.toggle-label:has-text("Start Watcher on Startup")'),
    }).locator('.toggle');
    await watcherToggle.click();
    await expect(page.locator('button:has-text("Save Settings")')).toBeEnabled();
  });
});

test.describe('Recordings Page Interactions', () => {
  test('recordings page loads with mock data', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.item-name:has-text("Valorant_2024-01-15_20-30-45.mp4")')).toBeVisible();
  });

  test('clicking a recording selects it', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await page.locator('.item-card').first().click();
    await expect(page.locator('.item-card.active')).toBeVisible();
  });
});

test.describe('Clips Page Interactions', () => {
  test('clips page loads with mock data', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.item-name:has-text("Valorant_highlight_001.mp4")')).toBeVisible();
  });
});

test.describe('Storage Page Interactions', () => {
  test('storage page loads with mock data', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.sv2-pill:has-text("4.43 GB")')).toBeVisible();
  });

  test('selecting a file enables action buttons', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
    await page.locator('.sv2-list-row').first().click();
    await expect(page.locator('.sv2-sel-pill:has-text("1 selected")')).toBeVisible();
  });
});
