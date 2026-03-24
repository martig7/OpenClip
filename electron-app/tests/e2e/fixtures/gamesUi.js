/**
 * Selectors for the compact Games table + caption bar (see GamesTable.jsx).
 */

import { expect } from '@playwright/test'

export function gamesCaptionTitle(page) {
  return page.locator('.games-caption-bar .msb-title')
}

/** Table row for a game (excludes the trailing "add" row). */
export function gameRow(page, name) {
  return page.locator('.games-table tbody tr').filter({
    has: page.locator('.games-table-name', { hasText: name }),
  })
}

export function gameNameCell(page, name) {
  return page.locator('.games-table-name', { hasText: name })
}

/** Enabled / scene toggle on a specific game row (not the pinned fullscreen row). */
export function gameRowToggle(page, name) {
  return gameRow(page, name).locator('.col-toggle .toggle')
}

/**
 * Simple add modal is the default; advanced form fields live in AddGameModal.
 * Clicks "Advanced" when the simple modal is shown; if the user already switched
 * to advanced in-session, the advanced form opens directly (no Advanced button).
 */
export async function openAdvancedAddGameModal(page) {
  await page.click('button:has-text("Add Game")')
  await expect(page.locator('h2:has-text("Add Game")')).toBeVisible()
  const advancedBtn = page.locator('.modal').getByRole('button', { name: 'Advanced' })
  if (await advancedBtn.isVisible().catch(() => false)) {
    await advancedBtn.click()
  }
  await expect(page.locator('input[placeholder="e.g. Valorant"]')).toBeVisible()
}

/**
 * OBS scenes list is often empty in browser mock mode — use "Create new scene…"
 * so the scene name text field appears.
 */
export async function fillNewObsSceneNameInAddGameModal(page, sceneName) {
  await page.locator('.modal').getByRole('button', { name: 'Select scene…' }).click()
  await page.getByRole('button', { name: 'Create new scene…' }).click()
  const sceneInput = page.locator('input[placeholder="e.g. Gaming Scene (required)"]')
  await expect(sceneInput).toBeVisible()
  await sceneInput.fill(sceneName)
}
