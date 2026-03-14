import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('app loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/OpenClip/i);
  });

  test('sidebar navigation renders all menu items', async ({ page }) => {
    await page.goto('/');
    
    // Use force: true to bypass overlay issues
    await expect(page.locator('.nav-brand')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Games' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Recordings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clips' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Storage' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Encoding' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  });
});

test.describe('Navigation - Edge Cases', () => {
  test('direct navigation to invalid route shows main content', async ({ page }) => {
    await page.goto('/#/nonexistent-page');
    await expect(page.locator('.nav-brand')).toBeVisible();
  });

  test('page refresh maintains route', async ({ page }) => {
    await page.goto('/#/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
    await page.reload();
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible({ timeout: 5000 });
  });

  test('navigation via browser back/forward works', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    await expect(page.locator('h2:has-text("Add Game")')).toBeVisible();
    await page.goBack();
    await expect(page.locator('h2:has-text("Add Game")')).not.toBeVisible();
  });
});
