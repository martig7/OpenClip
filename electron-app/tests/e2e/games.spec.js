import { test, expect } from './fixtures/electronPage.js'
import {
  gamesCaptionTitle,
  gameRow,
  gameNameCell,
  gameRowToggle,
  openAdvancedAddGameModal,
  fillNewObsSceneNameInAddGameModal,
} from './fixtures/gamesUi.js'

// GamesPage uses window.api, which falls back to mockApi in browser/test mode.
// mockApi returns mockGames (Valorant + CS2) from src/browserMockData.js.

test.describe('Games Page', () => {
  test('games page loads with correct heading', async ({ page }) => {
    await page.goto('/')
    await expect(gamesCaptionTitle(page)).toHaveText('Games')
  })

  test('add game button is present', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('button:has-text("Add Game")')).toBeVisible()
  })

  test('displays mock games from store', async ({ page }) => {
    await page.goto('/')
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
    await expect(gameNameCell(page, 'Counter-Strike 2')).toBeVisible()
  })

  test('mock games start enabled', async ({ page }) => {
    await page.goto('/')
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
    const enabledGameToggles = page.locator(
      '.games-table tbody tr:not(.games-table-fullscreen-row) .toggle.on'
    )
    await expect(enabledGameToggles).toHaveCount(2)
  })

  test('toggling a game disables it', async ({ page }) => {
    await page.goto('/')
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
    const toggle = gameRowToggle(page, 'Valorant')
    await expect(toggle).toHaveClass(/\bon\b/)
    await toggle.click()
    await expect(toggle).not.toHaveClass(/\bon\b/)
  })

  test('re-toggling a game re-enables it', async ({ page }) => {
    await page.goto('/')
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
    const toggle = gameRowToggle(page, 'Valorant')
    await toggle.click() // disable
    await expect(toggle).not.toHaveClass(/\bon\b/)
    await toggle.click() // re-enable
    await expect(toggle).toHaveClass(/\bon\b/)
  })

  test('clicking delete on game with scene shows confirm dialog', async ({ page }) => {
    await page.goto('/')
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
    // Valorant has scene: 'Valorant' in mockGames
    await gameRow(page, 'Valorant').locator('[title="Remove game"]').click()
    await expect(page.locator('h2:has-text("Remove Game")')).toBeVisible()
    await expect(page.locator('.modal strong:has-text("Valorant")').first()).toBeVisible()
  })

  test('cancel on delete dialog keeps game in list', async ({ page }) => {
    await page.goto('/')
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
    await gameRow(page, 'Valorant').locator('[title="Remove game"]').click()
    await expect(page.locator('h2:has-text("Remove Game")')).toBeVisible()
    await page.locator('button:has-text("Cancel")').click()
    await expect(page.locator('h2:has-text("Remove Game")')).not.toBeVisible()
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
  })

  test('delete dialog shows OBS scene option when game has scene', async ({ page }) => {
    await page.goto('/')
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
    await gameRow(page, 'Valorant').locator('[title="Remove game"]').click()
    // Should show "Game + OBS Scene" button since Valorant has a scene
    await expect(page.locator('button:has-text("Game + OBS Scene")')).toBeVisible()
    await expect(page.locator('button:has-text("Game only")')).toBeVisible()
  })

  test('can open add game modal', async ({ page }) => {
    await page.goto('/')
    await openAdvancedAddGameModal(page)
  })

  test('add game modal closes on cancel', async ({ page }) => {
    await page.goto('/')
    await openAdvancedAddGameModal(page)
    await page.locator('.modal button:has-text("Cancel")').click()
    await expect(page.locator('h2:has-text("Add Game")')).not.toBeVisible()
  })

  test('can type a game name in add game modal', async ({ page }) => {
    await page.goto('/')
    await openAdvancedAddGameModal(page)
    const nameInput = page.locator('input[placeholder="e.g. Valorant"]')
    await nameInput.fill('Minecraft')
    await expect(nameInput).toHaveValue('Minecraft')
  })

  test('add game button is disabled when scene field is empty', async ({ page }) => {
    await page.goto('/')
    await openAdvancedAddGameModal(page)
    await page.locator('input[placeholder="e.g. Valorant"]').fill('Minecraft')
    // Scene is required — button should remain disabled until scene is filled
    const addBtn = page.locator('.modal button:has-text("Add Game")')
    await expect(addBtn).toBeDisabled()
  })
})

test.describe('Games Page - Modal Edge Cases', () => {
  test('add game modal has all required fields', async ({ page }) => {
    await page.goto('/')
    await openAdvancedAddGameModal(page)
    await expect(page.locator('input[placeholder="e.g. Valorant"]')).toBeVisible()
    await expect(page.locator('input[placeholder="e.g. VALORANT or valorant.exe"]')).toBeVisible()
    await expect(page.locator('.modal').getByRole('button', { name: 'Select scene…' })).toBeVisible()
  })

  test('remove game modal closes on cancel button', async ({ page }) => {
    await page.goto('/')
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
    await gameRow(page, 'Valorant').locator('[title="Remove game"]').click()
    await expect(page.locator('h2:has-text("Remove Game")')).toBeVisible()
    await page.locator('button:has-text("Cancel")').click()
    await expect(page.locator('h2:has-text("Remove Game")')).not.toBeVisible()
  })

  test('modal can be opened and closed multiple times', async ({ page }) => {
    await page.goto('/')
    for (let i = 0; i < 2; i++) {
      await openAdvancedAddGameModal(page)
      await page.locator('.modal button:has-text("Cancel")').click()
      await expect(page.locator('h2:has-text("Add Game")')).not.toBeVisible()
    }
  })
})

test.describe('Games Page - Form Validation Edge Cases', () => {
  test('add game with whitespace-only name accepts input', async ({ page }) => {
    await page.goto('/')
    await openAdvancedAddGameModal(page)
    await page.locator('input[placeholder="e.g. Valorant"]').fill('   ')
    await expect(page.locator('input[placeholder="e.g. Valorant"]')).toHaveValue('   ')
  })

  test('add game button requires scene field', async ({ page }) => {
    await page.goto('/')
    await openAdvancedAddGameModal(page)
    await page.locator('input[placeholder="e.g. Valorant"]').fill('Test Game')
    const addBtn = page.locator('.modal button:has-text("Add Game")')
    await expect(addBtn).toBeDisabled()
  })

  test('add game form validates required fields before submission', async ({ page }) => {
    await page.goto('/')
    await openAdvancedAddGameModal(page)
    await page.locator('input[placeholder="e.g. Valorant"]').fill('Test Game')
    await fillNewObsSceneNameInAddGameModal(page, 'Test Scene')
    const addBtn = page.locator('.modal button:has-text("Add Game")')
    await expect(addBtn).toBeEnabled()
  })
})

test.describe('Games Page - Interaction Edge Cases', () => {
  test('toggle state toggles correctly on multiple clicks', async ({ page }) => {
    await page.goto('/')
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
    const toggle = gameRowToggle(page, 'Valorant')
    await expect(toggle).toHaveClass(/\bon\b/)
    await toggle.click()
    await expect(toggle).not.toHaveClass(/\bon\b/)
    await toggle.click()
    await expect(toggle).toHaveClass(/\bon\b/)
  })

  test('single click on toggle works correctly', async ({ page }) => {
    await page.goto('/')
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
    const toggle = gameRowToggle(page, 'Valorant')
    await expect(toggle).toHaveClass(/\bon\b/)
    await toggle.click()
    await expect(toggle).not.toHaveClass(/\bon\b/)
  })
})

test.describe('Games Page - Input Edge Cases', () => {
  test('game name field accepts long text', async ({ page }) => {
    await page.goto('/')
    await openAdvancedAddGameModal(page)
    const longName = 'A'.repeat(100)
    await page.locator('input[placeholder="e.g. Valorant"]').fill(longName)
    await expect(page.locator('input[placeholder="e.g. Valorant"]')).toHaveValue(longName)
  })

  test('exe field accepts long text', async ({ page }) => {
    await page.goto('/')
    await openAdvancedAddGameModal(page)
    const longExe = 'a'.repeat(200) + '.exe'
    await page.locator('input[placeholder="e.g. VALORANT or valorant.exe"]').fill(longExe)
    await expect(page.locator('input[placeholder="e.g. VALORANT or valorant.exe"]')).toHaveValue(
      longExe
    )
  })
})

test.describe('Games Page - Validation', () => {
  test('renaming a game to an existing name is allowed (no duplicate validation)', async ({
    page,
  }) => {
    // No duplicate game name validation exists — games can share names without an error
    await page.goto('/')
    await gameRow(page, 'Valorant').locator('[title="Edit game"]').click()
    await expect(page.locator('h2:has-text("Edit Game")')).toBeVisible()
    const nameInput = page.locator('input[placeholder="e.g. Valorant"]')
    await nameInput.fill('Counter-Strike 2')
    await page.locator('button:has-text("Save")').click()
    // Save goes through with no validation error
    await expect(gameNameCell(page, 'Counter-Strike 2').first()).toBeVisible()
    await expect(page.locator('.toast-error, [role="alert"]')).not.toBeVisible()
  })

  test('edit game modal updates game name', async ({ page }) => {
    await page.goto('/')
    await expect(gameNameCell(page, 'Valorant')).toBeVisible()
    await gameRow(page, 'Valorant').locator('[title="Edit game"]').click()
    await expect(page.locator('h2:has-text("Edit Game")')).toBeVisible()
    const nameInput = page.locator('input[placeholder="e.g. Valorant"]')
    await nameInput.fill('Valorant Updated')
    await page.locator('button:has-text("Save")').click()
    await expect(gameNameCell(page, 'Valorant Updated')).toBeVisible()
  })
})
