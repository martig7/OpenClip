/**
 * Selectors for the compact Games table + caption bar (see GamesTable.jsx).
 */

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
