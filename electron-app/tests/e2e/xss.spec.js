import { test, expect } from '@playwright/test';

test.describe('XSS Security', () => {
  test('game name with script tags is escaped in UI output', async ({ page }) => {
    await page.goto('/');
    // Edit an existing game to have a name containing script tags
    const valorantItem = page.locator('.list-item', {
      has: page.locator('.list-item-title:has-text("Valorant")'),
    });
    await valorantItem.locator('[title="Edit game"]').click();
    await expect(page.locator('h2:has-text("Edit Game")')).toBeVisible();
    const nameInput = page.locator('input[placeholder="e.g. Valorant"]');
    await nameInput.fill('<script>window.__xss_triggered=true</script>EvilGame');
    await page.locator('button:has-text("Save")').click();
    // Script should not have executed
    const xssTriggered = await page.evaluate(() => window.__xss_triggered);
    expect(xssTriggered).toBeUndefined();
    // The text content should be visible as plain text (React escapes by default)
    await expect(page.locator('.list-item-title').filter({ hasText: 'EvilGame' })).toBeVisible();
    // No <script> element should exist inside a game title
    await expect(page.locator('.list-item-title script')).toHaveCount(0);
  });

  test('game name with HTML entities renders as plain text', async ({ page }) => {
    await page.goto('/');
    const cs2Item = page.locator('.list-item', {
      has: page.locator('.list-item-title:has-text("Counter-Strike 2")'),
    });
    await cs2Item.locator('[title="Edit game"]').click();
    await expect(page.locator('h2:has-text("Edit Game")')).toBeVisible();
    const nameInput = page.locator('input[placeholder="e.g. Valorant"]');
    await nameInput.fill('Game <b>Bold</b> &amp; "Quoted"');
    await page.locator('button:has-text("Save")').click();
    // No <b> element should be injected inside a game title
    await expect(page.locator('.list-item-title b')).toHaveCount(0);
    // The text should appear as-is (React renders it as a text node, not HTML)
    await expect(page.locator('.list-item-title').filter({ hasText: 'Bold' })).toBeVisible();
  });
});
