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

test.describe('Recordings Page - Edge Cases', () => {
  test('handles empty API response', async ({ page }) => {
    await page.route('**/api/recordings', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
  });

  test('handles network error gracefully', async ({ page }) => {
    await page.route('**/api/recordings', route => route.abort('failed'));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 5000 });
  });

  test('search returns no results for non-existent query', async ({ page }) => {
    await page.route('**/api/recordings', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { filename: 'Valorant_2024-01-15_20-30-45.mp4', path: 'test.mp4', game_name: 'Valorant', date: '2024-01-15', size_formatted: '1.40 GB', size_bytes: 1500000000, mtime: 1705349445000 },
    ])}));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await page.locator('.search-box input').fill('NonExistentGame123');
    await expect(page.locator('.item-card')).not.toBeVisible();
  });

  test('search with special characters does not crash', async ({ page }) => {
    await page.route('**/api/recordings', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { filename: 'Valorant_2024-01-15_20-30-45.mp4', path: 'test.mp4', game_name: 'Valorant', date: '2024-01-15', size_formatted: '1.40 GB', size_bytes: 1500000000, mtime: 1705349445000 },
    ])}));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await page.locator('.search-box input').fill("'; DROP TABLE users;--");
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('search with empty string shows all results', async ({ page }) => {
    await page.route('**/api/recordings', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { filename: 'Valorant_2024-01-15_20-30-45.mp4', path: 'test.mp4', game_name: 'Valorant', date: '2024-01-15', size_formatted: '1.40 GB', size_bytes: 1500000000, mtime: 1705349445000 },
      { filename: 'CS2_2024-01-14_18-22-10.mp4', path: 'test2.mp4', game_name: 'Counter-Strike 2', date: '2024-01-14', size_formatted: '2.98 GB', size_bytes: 3200000000, mtime: 1705256530000 },
    ])}));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    await page.locator('.search-box input').fill('');
    await expect(page.locator('.item-card')).toHaveCount(2);
  });

  test('can select different recordings sequentially', async ({ page }) => {
    await page.route('**/api/recordings', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { filename: 'Valorant_2024-01-15_20-30-45.mp4', path: 'test.mp4', game_name: 'Valorant', date: '2024-01-15', size_formatted: '1.40 GB', size_bytes: 1500000000, mtime: 1705349445000 },
      { filename: 'CS2_2024-01-14_18-22-10.mp4', path: 'test2.mp4', game_name: 'Counter-Strike 2', date: '2024-01-14', size_formatted: '2.98 GB', size_bytes: 3200000000, mtime: 1705256530000 },
    ])}));
    await page.goto('/#/recordings');
    await expect(page.locator('.sidebar h2:has-text("Recordings")')).toBeVisible({ timeout: 5000 });
    const firstCard = page.locator('.item-card').first();
    await firstCard.click();
    await expect(firstCard).toHaveClass(/active/);
    const secondCard = page.locator('.item-card').nth(1);
    await secondCard.click();
    await expect(secondCard).toHaveClass(/active/);
  });
});

test.describe('Clips Page - Edge Cases', () => {
  test('handles empty API response', async ({ page }) => {
    await page.route('**/api/clips', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
  });

  test('handles network error gracefully', async ({ page }) => {
    await page.route('**/api/clips', route => route.abort('failed'));
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 5000 });
  });

  test('search returns no results for non-existent query', async ({ page }) => {
    await page.route('**/api/clips', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { filename: 'Valorant_highlight_001.mp4', path: 'test.mp4', game_name: 'Valorant', date: '2024-01-15', size_formatted: '47.68 MB', size_bytes: 50000000, mtime: 1705350300000 },
    ])}));
    await page.goto('/#/clips');
    await expect(page.locator('.sidebar h2:has-text("Clips")')).toBeVisible({ timeout: 5000 });
    await page.locator('.search-box input').fill('NonExistentClip');
    await expect(page.locator('.item-card')).not.toBeVisible();
  });
});

test.describe('Storage Page - Edge Cases', () => {
  test('handles empty API response', async ({ page }) => {
    await page.route('**/api/storage/stats', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      total_size_formatted: '0 B',
      recording_count: 0,
      clip_count: 0,
      recordings: [],
      clips: [],
      locked_recordings: [],
    })}));
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
  });

  test('handles network error gracefully', async ({ page }) => {
    await page.route('**/api/storage/stats', route => route.abort('failed'));
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title')).toBeVisible({ timeout: 10000 });
  });

  test('multiple file selection shows correct count', async ({ page }) => {
    await page.route('**/api/storage/stats', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      total_size_formatted: '4.43 GB',
      recording_count: 3,
      clip_count: 0,
      recordings: [
        { filename: 'test1.mp4', path: 'test1.mp4', game_name: 'Valorant', date: '2024-01-15', size_formatted: '1 GB', size_bytes: 1000000000, mtime: 1705349445000, type: 'recording' },
        { filename: 'test2.mp4', path: 'test2.mp4', game_name: 'Valorant', date: '2024-01-14', size_formatted: '1 GB', size_bytes: 1000000000, mtime: 1705349445000, type: 'recording' },
        { filename: 'test3.mp4', path: 'test3.mp4', game_name: 'CS2', date: '2024-01-13', size_formatted: '1 GB', size_bytes: 1000000000, mtime: 1705349445000, type: 'recording' },
      ],
      clips: [],
      locked_recordings: [],
    })}));
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
    await page.locator('.sv2-list-row').first().click();
    await page.locator('.sv2-list-row').nth(1).click();
    await expect(page.locator('.sv2-sel-pill:has-text("2 selected")')).toBeVisible();
  });

  test('deselecting all files hides selection pill', async ({ page }) => {
    await page.route('**/api/storage/stats', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      total_size_formatted: '4.43 GB',
      recording_count: 2,
      clip_count: 0,
      recordings: [
        { filename: 'test1.mp4', path: 'test1.mp4', game_name: 'Valorant', date: '2024-01-15', size_formatted: '1 GB', size_bytes: 1000000000, mtime: 1705349445000, type: 'recording' },
        { filename: 'test2.mp4', path: 'test2.mp4', game_name: 'CS2', date: '2024-01-14', size_formatted: '1 GB', size_bytes: 1000000000, mtime: 1705349445000, type: 'recording' },
      ],
      clips: [],
      locked_recordings: [],
    })}));
    await page.goto('/#/storage');
    await expect(page.locator('.sv2-title:has-text("Storage")')).toBeVisible({ timeout: 10000 });
    await page.locator('.sv2-list-row').first().click();
    await expect(page.locator('.sv2-sel-pill:has-text("1 selected")')).toBeVisible();
    await page.locator('.sv2-list-row').first().click();
    await expect(page.locator('.sv2-sel-pill')).not.toBeVisible();
  });
});
