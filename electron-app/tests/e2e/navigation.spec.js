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
