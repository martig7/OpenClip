/**
 * Waveform Pre-caching Module
 * Automatically generates and caches waveforms for recordings when they are organized.
 */
const fs = require('fs')
const path = require('path')
const { FFMPEG_PATH, FFPROBE_PATH } = require('./constants')
const { getWaveform, setWaveform } = require('./waveformCache')
const { getVideoDuration } = require('./videoMetadata')
const { getNumPeaks, generateWaveform } = require('./waveformUtils')
const { promisify } = require('util')
const { execFile } = require('child_process')

const execFileAsync = promisify(execFile)

// Cache resolution settings - will be loaded from store
let waveformResolution = 'default'

/**
 * Pre-cache waveform for a recording file
 * This is called automatically when recordings are organized/finalized
 * @param {string} filePath - Path to recording file
 * @param {Object} options - Options
 * @param {number} options.maxTracks - Maximum number of tracks to cache (default: 4)
 * @param {boolean} options.skipIfCached - Skip generation if already cached (default: true)
 */
async function preCacheWaveform(filePath, options = {}) {
  const { maxTracks = 4, skipIfCached = true } = options

  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'File not found' }
  }

  const numPeaks = getNumPeaks(waveformResolution)

  // Get number of audio tracks using ffprobe
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_PATH,
      [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=index',
        '-of',
        'csv=p=0',
        filePath,
      ],
      { encoding: 'utf-8', timeout: 10000 }
    )

    const trackIndices = stdout
      .trim()
      .split('\n')
      .map((line) => parseInt(line, 10))
      .filter((i) => !isNaN(i) && i >= 0)

    const tracksToCache = trackIndices.slice(0, maxTracks)

    const results = []
    for (const trackIndex of tracksToCache) {
      // Check cache first if skipIfCached is true
      if (skipIfCached) {
        const cached = getWaveform(filePath, trackIndex, numPeaks)
        if (cached && cached.peaks?.length) {
          results.push({ trackIndex, cached: true, peaksLength: cached.peaks.length })
          continue
        }
      }

      // Generate waveform using shared generator
      const waveform = await generateWaveform(filePath, trackIndex, numPeaks, getVideoDuration)
      if (waveform && waveform.peaks?.length) {
        setWaveform(filePath, trackIndex, numPeaks, waveform.peaks, waveform.duration)
        results.push({ trackIndex, cached: false, peaksLength: waveform.peaks.length })
      } else {
        results.push({ trackIndex, error: 'Generation failed' })
      }
    }

    return { success: true, results }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Update waveform resolution setting
 * @param {string} resolution - 'low', 'default', or 'high'
 */
function setWaveformResolution(resolution) {
  waveformResolution = resolution || 'default'
}

/**
 * Get current waveform resolution
 * @returns {string}
 */
function getWaveformResolution() {
  return waveformResolution
}

module.exports = {
  preCacheWaveform,
  setWaveformResolution,
  getWaveformResolution,
}
