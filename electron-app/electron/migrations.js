/**
 * One-time data migration helpers.
 * These run once to bring older on-disk layouts up to the current format.
 */
const fs = require('fs')
const path = require('path')
const { isVideoFile } = require('./constants')
const { moveFileSafe } = require('./fileOperations')

/**
 * Migrate old-format game-week folders ("GameName - Week of ...") and the
 * legacy root Clips folder into the current per-game layout.
 *
 * Returns { migrated: number }
 */
async function migrateToGameFolders(store) {
  const destPath = store.get('settings.destinationPath')
  if (!destPath || !fs.existsSync(destPath)) return { migrated: 0 }

  const weekFolders = store.get('settings.weekFolders')
  let migrated = 0

  let entries
  try {
    entries = fs.readdirSync(destPath, { withFileTypes: true })
  } catch {
    return { migrated: 0 }
  }

  // Migrate old-format game-week folders: "GameName - Week of ..."
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.includes(' - Week of ')) continue
    const dashIdx = entry.name.indexOf(' - Week of ')
    const gameName = entry.name.slice(0, dashIdx)
    const weekStr = entry.name.slice(dashIdx + 3) // "Week of ..."
    const oldDir = path.join(destPath, entry.name)
    const newTarget = weekFolders
      ? path.join(destPath, gameName, weekStr)
      : path.join(destPath, gameName)
    try {
      fs.mkdirSync(newTarget, { recursive: true })
      const files = fs.readdirSync(oldDir)
      for (const file of files) {
        const src = path.join(oldDir, file)
        const dest = path.join(newTarget, file)
        if (!fs.existsSync(dest)) {
          await moveFileSafe(src, dest)
          migrated++
        }
      }
      try {
        fs.rmdirSync(oldDir)
      } catch {}
    } catch (err) {
      console.error(`[migrate] Failed to migrate "${entry.name}":`, err.message)
    }
  }

  // Migrate legacy root Clips folder: move per-game clips into {game}/Clips/
  const legacyClipsDir = path.join(destPath, 'Clips')
  if (fs.existsSync(legacyClipsDir)) {
    try {
      const clipFiles = fs.readdirSync(legacyClipsDir)
      for (const file of clipFiles) {
        const gameMatch = file.match(/^(.+?) Clip \d{4}-\d{2}-\d{2}/)
        if (!gameMatch) continue
        const gameName = gameMatch[1]
        const gameClipsDir = path.join(destPath, gameName, 'Clips')
        fs.mkdirSync(gameClipsDir, { recursive: true })
        const src = path.join(legacyClipsDir, file)
        const dest = path.join(gameClipsDir, file)
        if (!fs.existsSync(dest)) {
          await moveFileSafe(src, dest)
          migrated++
        }
      }
      try {
        fs.rmdirSync(legacyClipsDir)
      } catch {}
    } catch (err) {
      console.error('[migrate] Failed to migrate legacy Clips folder:', err.message)
    }
  }

  return { migrated }
}

module.exports = { migrateToGameFolders }
