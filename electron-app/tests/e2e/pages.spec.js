import { test, expect } from '@playwright/test';
import { setupApiRoutes } from './fixtures/routes.js';

// RecordingsPage, ClipsPage, and StoragePage fetch from /api/* via apiFetch().
// We use page.route() to intercept these requests and return test data,
// so tests run without needing a real API server.

test.describe('Recordings Page', () => {
  test('recordings page loads', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
  });

  test('displays recording game groups from mock data', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.group-header:has-text("Valorant")')).toBeVisible();
    await expect(page.locator('.group-header:has-text("Counter-Strike 2")')).toBeVisible();
  });

  test('displays recording filenames from mock data', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.item-name:has-text("Valorant_2024-01-15_20-30-45.mp4")')).toBeVisible();
    await expect(page.locator('.item-name:has-text("CS2_2024-01-14_18-22-10.mp4")')).toBeVisible();
  });

  test('shows correct recording count in group header', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    // Each game has 1 recording, shown as "Valorant (1)"
    await expect(page.locator('.group-header:has-text("Valorant (1)")')).toBeVisible();
    await expect(page.locator('.group-header:has-text("Counter-Strike 2 (1)")')).toBeVisible();
  });

  test('selecting a recording highlights it', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    const card = page.locator('.item-card').first();
    await card.click();
    await expect(card).toHaveClass(/active/);
  });

  test('search filters recordings by filename', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await page.locator('.search-box input').fill('CS2');
    await expect(page.locator('.item-name:has-text("CS2_2024-01-14_18-22-10.mp4")')).toBeVisible();
    await expect(page.locator('.item-name:has-text("Valorant_2024-01-15_20-30-45.mp4")')).not.toBeVisible();
  });
});

test.describe('Clips Page', () => {
  test('clips page loads', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
  });

  test('displays clip game group from mock data', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.group-header:has-text("Valorant")')).toBeVisible();
  });

  test('displays clip filename from mock data', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.item-name:has-text("Valorant_highlight_001.mp4")')).toBeVisible();
  });

  test('search filters clips by filename', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
    await page.locator('.search-box input').fill('highlight');
    await expect(page.locator('.item-name:has-text("Valorant_highlight_001.mp4")')).toBeVisible();
  });
});

test.describe('Storage Page', () => {
  test('storage page loads', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
  });

  test('displays total size from mock data', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.sv2-pill:has-text("4.43 GB")')).toBeVisible();
  });

  test('displays recording and clip counts', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.sv2-pill:has-text("2 rec")')).toBeVisible();
    await expect(page.locator('.sv2-pill:has-text("1 clips")')).toBeVisible();
  });

  test('displays game legend buttons from mock data', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.sv2-legend-item:has-text("Valorant")')).toBeVisible();
    await expect(page.locator('.sv2-legend-item:has-text("Counter-Strike 2")')).toBeVisible();
  });

  test('displays filenames in file list', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.sv2-list-name:has-text("Valorant_2024-01-15_20-30-45.mp4")')).toBeVisible();
    await expect(page.locator('.sv2-list-name:has-text("CS2_2024-01-14_18-22-10.mp4")')).toBeVisible();
    await expect(page.locator('.sv2-list-name:has-text("Valorant_highlight_001.mp4")')).toBeVisible();
  });

  test('filtering by game hides other games files', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
    await page.locator('.sv2-legend-item:has-text("Valorant")').click();
    await expect(page.locator('.sv2-list-name:has-text("Valorant_2024-01-15_20-30-45.mp4")')).toBeVisible();
    await expect(page.locator('.sv2-list-name:has-text("CS2_2024-01-14_18-22-10.mp4")')).not.toBeVisible();
  });

  test('clicking all button shows all files', async ({ page }) => {
    await setupApiRoutes(page);
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
    await page.locator('.sv2-legend-item:has-text("Valorant")').click();
    await page.locator('.sv2-legend-all:has-text("All")').click();
    await expect(page.locator('.sv2-list-name:has-text("CS2_2024-01-14_18-22-10.mp4")')).toBeVisible();
  });
});

test.describe('Encoding Page', () => {
  test('encoding page loads with correct heading', async ({ page }) => {
    await page.goto('/#/encoding');
    await expect(page.locator('h1:has-text("OBS Encoding")')).toBeVisible({ timeout: 5000 });
  });

  test('encoding page has encoder selector', async ({ page }) => {
    await page.goto('/#/encoding');
    await expect(page.locator('label:has-text("Encoder")').first()).toBeVisible({ timeout: 5000 });
  });
});
