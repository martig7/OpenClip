/**
 * Low-level file operation helpers with retry logic for Windows-specific
 * transient errors (EBUSY, EPERM, EACCES from AV scanners, indexers, OBS).
 *
 * These are pure filesystem utilities with no dependency on the application
 * store, IPC, or Electron.
 */
const fs = require('fs')

/**
 * Move a file safely across devices or past transient system locks.
 * Strategy: rename with retry on EBUSY/EPERM, then fall back to copy+delete
 * for EXDEV or persistent EBUSY/EPERM.
 */
async function moveFileSafe(src, dest) {
  // Try rename up to 3 times; back off on transient EBUSY or EPERM
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.renameSync(src, dest)
      return // success
    } catch (err) {
      if (err.code !== 'EXDEV' && err.code !== 'EBUSY' && err.code !== 'EPERM') throw err
      if (err.code === 'EXDEV') break // cross-device: go straight to copy
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }

  // Rename failed (cross-device or persistent EBUSY) — copy then delete
  await fs.promises.copyFile(src, dest)

  // Retry unlink to handle transient system holds
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.promises.unlink(src)
      return // success
    } catch (unlinkErr) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        continue
      }
      // Unlink failed after retries — roll back the copy so no duplicate is left
      try {
        await fs.promises.unlink(dest)
      } catch {}
      throw unlinkErr
    }
  }
}

/**
 * Check whether a file exists and is currently locked by another process.
 *
 * Contract:
 *   - Returns `true`  if the file exists but is locked (EBUSY / EPERM / EACCES).
 *   - Returns `false` if the file exists and is not locked.
 *   - Throws the original error for any other condition, including ENOENT
 *     (file does not exist). Callers must handle ENOENT explicitly if the
 *     file's existence is uncertain.
 *
 * @param {string} filePath
 * @returns {boolean}
 * @throws {NodeJS.ErrnoException} ENOENT or other unexpected fs errors
 */
function isFileLocked(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r+')
    fs.closeSync(fd)
    return false
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') return true
    // Re-throw ENOENT and any other unexpected error so the caller knows
    // the query failed for a reason other than a lock.
    throw err
  }
}

/**
 * Wait until the file is not locked, checking every delayMs up to maxAttempts times.
 */
async function waitForUnlock(filePath, maxAttempts = 5, delayMs = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    if (!isFileLocked(filePath)) return
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs))
  }
  throw new Error(`File is still locked after ${maxAttempts} attempts — try again in a moment`)
}

/**
 * Retry fs.statSync until it succeeds or the file remains inaccessible after maxAttempts.
 * Returns the Stats object, or null if timed out (EPERM/EBUSY/EACCES from OBS still holding).
 */
async function waitForStat(filePath, maxAttempts = 10, delayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return fs.statSync(filePath)
    } catch (err) {
      if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') throw err
      if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  return null // timed out — caller should skip this file
}

/**
 * Retry fs.unlinkSync to handle transient EPERM/EBUSY.
 * Throws only if still locked after all attempts.
 */
async function unlinkWithRetry(filePath, maxAttempts = 4, delayMs = 750) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      fs.unlinkSync(filePath)
      return
    } catch (err) {
      if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') throw err
      if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw new Error(`Cannot delete source file — it is still held open by another process`)
}

module.exports = {
  moveFileSafe,
  isFileLocked,
  waitForUnlock,
  waitForStat,
  unlinkWithRetry,
}
