const fs = require('fs')

const cache = new Map()
const MAX_ENTRIES = 100

function getCacheKey(filePath, mtime, trackIndex, numPeaks) {
  return `${filePath}:${mtime}:${trackIndex}:${numPeaks}`
}

function getWaveform(filePath, trackIndex, numPeaks) {
  try {
    const mtime = fs.statSync(filePath).mtimeMs
    const key = getCacheKey(filePath, mtime, trackIndex, numPeaks)
    const entry = cache.get(key)
    if (entry) {
      // Move to end (most recently used)
      cache.delete(key)
      cache.set(key, entry)
      return { peaks: entry.peaks, duration: entry.duration }
    }
  } catch {
    // File doesn't exist or stat failed
  }
  return null
}

function setWaveform(filePath, trackIndex, numPeaks, peaks, duration) {
  try {
    const mtime = fs.statSync(filePath).mtimeMs
    const key = getCacheKey(filePath, mtime, trackIndex, numPeaks)
    cache.set(key, { peaks, duration })

    // Evict oldest entries if over limit
    while (cache.size > MAX_ENTRIES) {
      const firstKey = cache.keys().next().value
      cache.delete(firstKey)
    }
  } catch {
    // File doesn't exist or stat failed
  }
}

function clearCache() {
  cache.clear()
}

module.exports = { getWaveform, setWaveform, clearCache }
