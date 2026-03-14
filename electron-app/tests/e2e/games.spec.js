import { test, expect } from '@playwright/test';

// GamesPage uses window.api, which falls back to mockApi in browser/test mode.
// mockApi returns mockGames (Valorant + CS2) from src/mockData.js.

test.describe('Games Page', () => {
  test('games page loads with correct heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Games');
  });

  test('add game button is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button:has-text("Add Game")')).toBeVisible();
  });

  test('displays mock games from store', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    await expect(page.locator('.list-item-title:has-text("Counter-Strike 2")')).toBeVisible();
  });

  test('mock games start enabled', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    const enabledToggles = page.locator('.list-item .toggle.on');
    await expect(enabledToggles).toHaveCount(2);
  });

  test('toggling a game disables it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    // First game toggle starts ON (enabled: true in mockGames)
    const firstToggle = page.locator('.list-item .toggle').first();
    await expect(firstToggle).toHaveClass(/\bon\b/);
    await firstToggle.click();
    await expect(firstToggle).not.toHaveClass(/\bon\b/);
  });

  test('re-toggling a game re-enables it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    const firstToggle = page.locator('.list-item .toggle').first();
    await firstToggle.click(); // disable
    await expect(firstToggle).not.toHaveClass(/\bon\b/);
    await firstToggle.click(); // re-enable
    await expect(firstToggle).toHaveClass(/\bon\b/);
  });

  test('clicking delete on game with scene shows confirm dialog', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    // Valorant has scene: 'Valorant' in mockGames
    const valorantItem = page.locator('.list-item', {
      has: page.locator('.list-item-title:has-text("Valorant")'),
    });
    await valorantItem.locator('[title="Remove game"]').click();
    await expect(page.locator('h2:has-text("Remove Game")')).toBeVisible();
    await expect(page.locator('.modal strong:has-text("Valorant")').first()).toBeVisible();
  });

  test('cancel on delete dialog keeps game in list', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    const valorantItem = page.locator('.list-item', {
      has: page.locator('.list-item-title:has-text("Valorant")'),
    });
    await valorantItem.locator('[title="Remove game"]').click();
    await expect(page.locator('h2:has-text("Remove Game")')).toBeVisible();
    await page.locator('button:has-text("Cancel")').click();
    await expect(page.locator('h2:has-text("Remove Game")')).not.toBeVisible();
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
  });

  test('delete dialog shows OBS scene option when game has scene', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    const valorantItem = page.locator('.list-item', {
      has: page.locator('.list-item-title:has-text("Valorant")'),
    });
    await valorantItem.locator('[title="Remove game"]').click();
    // Should show "Game + OBS Scene" button since Valorant has a scene
    await expect(page.locator('button:has-text("Game + OBS Scene")')).toBeVisible();
    await expect(page.locator('button:has-text("Game only")')).toBeVisible();
  });

  test('can open add game modal', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    await expect(page.locator('h2:has-text("Add Game")')).toBeVisible();
    await expect(page.locator('input[placeholder="e.g. Valorant"]')).toBeVisible();
  });

  test('add game modal closes on cancel', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    await expect(page.locator('h2:has-text("Add Game")')).toBeVisible();
    await page.locator('.modal button:has-text("Cancel")').click();
    await expect(page.locator('h2:has-text("Add Game")')).not.toBeVisible();
  });

  test('can type a game name in add game modal', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    const nameInput = page.locator('input[placeholder="e.g. Valorant"]');
    await nameInput.fill('Minecraft');
    await expect(nameInput).toHaveValue('Minecraft');
  });

  test('add game button is disabled when scene field is empty', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    await page.locator('input[placeholder="e.g. Valorant"]').fill('Minecraft');
    // Scene is required — button should remain disabled until scene is filled
    const addBtn = page.locator('.modal button:has-text("Add Game")');
    await expect(addBtn).toBeDisabled();
  });
});

test.describe('Games Page - Modal Edge Cases', () => {
  test('add game modal has all required fields', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    await expect(page.locator('h2:has-text("Add Game")')).toBeVisible();
    await expect(page.locator('input[placeholder="e.g. Valorant"]')).toBeVisible();
    await expect(page.locator('input[placeholder="e.g. VALORANT or valorant.exe"]')).toBeVisible();
    await expect(page.locator('input[placeholder="e.g. Gaming Scene (required)"]')).toBeVisible();
  });

  test('remove game modal closes on cancel button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    const valorantItem = page.locator('.list-item', {
      has: page.locator('.list-item-title:has-text("Valorant")'),
    });
    await valorantItem.locator('[title="Remove game"]').click();
    await expect(page.locator('h2:has-text("Remove Game")')).toBeVisible();
    await page.locator('button:has-text("Cancel")').click();
    await expect(page.locator('h2:has-text("Remove Game")')).not.toBeVisible();
  });

  test('modal can be opened and closed multiple times', async ({ page }) => {
    await page.goto('/');
    for (let i = 0; i < 2; i++) {
      await page.click('button:has-text("Add Game")');
      await expect(page.locator('h2:has-text("Add Game")')).toBeVisible();
      await page.locator('.modal button:has-text("Cancel")').click();
      await expect(page.locator('h2:has-text("Add Game")')).not.toBeVisible();
    }
  });
});

test.describe('Games Page - Form Validation Edge Cases', () => {
  test('add game with whitespace-only name accepts input', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    await page.locator('input[placeholder="e.g. Valorant"]').fill('   ');
    await expect(page.locator('input[placeholder="e.g. Valorant"]')).toHaveValue('   ');
  });

  test('add game button requires scene field', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    await page.locator('input[placeholder="e.g. Valorant"]').fill('Test Game');
    const addBtn = page.locator('.modal button:has-text("Add Game")');
    await expect(addBtn).toBeDisabled();
  });

  test('add game form validates required fields before submission', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    await page.locator('input[placeholder="e.g. Valorant"]').fill('Test Game');
    await page.locator('input[placeholder="e.g. Gaming Scene (required)"]').fill('Test Scene');
    const addBtn = page.locator('.modal button:has-text("Add Game")');
    await expect(addBtn).toBeEnabled();
  });
});

test.describe('Games Page - Interaction Edge Cases', () => {
  test('toggle state toggles correctly on multiple clicks', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    const firstToggle = page.locator('.list-item .toggle').first();
    await expect(firstToggle).toHaveClass(/\bon\b/);
    await firstToggle.click();
    await expect(firstToggle).not.toHaveClass(/\bon\b/);
    await firstToggle.click();
    await expect(firstToggle).toHaveClass(/\bon\b/);
  });

  test('single click on toggle works correctly', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.list-item-title:has-text("Valorant")')).toBeVisible();
    const firstToggle = page.locator('.list-item .toggle').first();
    await expect(firstToggle).toHaveClass(/\bon\b/);
    await firstToggle.click();
    await expect(firstToggle).not.toHaveClass(/\bon\b/);
  });
});

test.describe('Games Page - Input Edge Cases', () => {
  test('game name field accepts long text', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    const longName = 'A'.repeat(100);
    await page.locator('input[placeholder="e.g. Valorant"]').fill(longName);
    await expect(page.locator('input[placeholder="e.g. Valorant"]')).toHaveValue(longName);
  });

  test('exe field accepts long text', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Add Game")');
    const longExe = 'a'.repeat(200) + '.exe';
    await page.locator('input[placeholder="e.g. VALORANT or valorant.exe"]').fill(longExe);
    await expect(page.locator('input[placeholder="e.g. VALORANT or valorant.exe"]')).toHaveValue(longExe);
  });
});
