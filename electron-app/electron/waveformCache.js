const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { promisify } = require('util')
const execFile = require('util').promisify ? require('child_process').execFile : { default: require('child_process').execFile }
const execFileAsync = execFile.default || execFile

const { USER_DATA } = require('./constants')

const WAVEFORM_CACHE_DIR = path.join(USER_DATA, 'waveform_cache')

const ZOOM_LEVELS = {
  low: [256],
  medium: [256, 512],
  high: [256, 512, 1024],
}

const ZOOM_LEVEL_DEFAULT = 256

let audiowaveformPath = null

function getAudiowaveformPath() {
  if (audiowaveformPath) return audiowaveformPath

  if (!app.isPackaged) {
    audiowaveformPath = 'audiowaveform'
    return audiowaveformPath
  }

  const bundledPath = path.join(process.resourcesPath, 'audiowaveform', 'audiowaveform.exe')
  if (fs.existsSync(bundledPath)) {
    audiowaveformPath = bundledPath
  } else {
    audiowaveformPath = null
  }
  return audiowaveformPath
}

function isAvailable() {
  return getAudiowaveformPath() !== null
}

function getCacheDir() {
  return WAVEFORM_CACHE_DIR
}

function getCacheDirForVideo(videoPath) {
  const videoHash = Buffer.from(videoPath.toLowerCase()).toString('base64').replace(/[/+=]/g, '_')
  return path.join(WAVEFORM_CACHE_DIR, videoHash)
}

function getWaveformPath(videoPath, zoomLevel) {
  const cacheDir = getCacheDirForVideo(videoPath)
  const ext = path.extname(videoPath)
  const baseName = path.basename(videoPath, ext)
  return path.join(cacheDir, `${baseName}.z${zoomLevel}.dat`)
}

function getAllWaveformPaths(videoPath) {
  const paths = []
  for (const zoom of Object.values(ZOOM_LEVELS).flat()) {
    paths.push(getWaveformPath(videoPath, zoom))
  }
  return paths
}

async function checkAudiowaveformAvailable() {
  try {
    const awPath = getAudiowaveformPath()
    if (awPath === 'audiowaveform') {
      const { stdout } = await execFileAsync('audiowaveform', ['--version'], { timeout: 5000 })
      return stdout.includes('audiowaveform') || stdout.includes('Audio Waveform')
    }
    return fs.existsSync(awPath)
  } catch {
    return false
  }
}

async function generateWaveformForZoom(videoPath, zoomLevel, numTracks = 1) {
  const outputPath = getWaveformPath(videoPath, zoomLevel)
  const cacheDir = path.dirname(outputPath)

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true })
  }

  const awPath = getAudiowaveformPath()

  const args = [
    '-i', videoPath,
    '-o', outputPath,
    '-z', String(zoomLevel),
    '-b', '8',
  ]

  return new Promise((resolve, reject) => {
    const proc = spawn(awPath, args)

    let stderr = ''
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    const killTimer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch {}
      reject(new Error('Waveform generation timed out'))
    }, 5 * 60 * 1000)

    proc.on('close', (code) => {
      clearTimeout(killTimer)
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({ success: true, path: outputPath, zoomLevel })
      } else {
        reject(new Error(`audiowaveform exited with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      clearTimeout(killTimer)
      reject(err)
    })
  })
}

async function generateWaveforms(videoPath, resolution = 'medium', numTracks = 1) {
  const zoomLevels = ZOOM_LEVELS[resolution] || ZOOM_LEVELS.medium
  const results = []

  for (const zoom of zoomLevels) {
    try {
      const result = await generateWaveformForZoom(videoPath, zoom, numTracks)
      results.push(result)
    } catch (err) {
      console.error(`Failed to generate waveform at zoom ${zoom}:`, err.message)
      throw err
    }
  }

  return results
}

function getWaveformStatus(videoPath, resolution = 'medium') {
  const zoomLevels = ZOOM_LEVELS[resolution] || ZOOM_LEVELS.medium
  const existing = []
  const missing = []

  for (const zoom of zoomLevels) {
    const wfPath = getWaveformPath(videoPath, zoom)
    if (fs.existsSync(wfPath)) {
      const stats = fs.statSync(wfPath)
      existing.push({
        zoom,
        path: wfPath,
        size: stats.size,
        mtime: stats.mtime.toISOString(),
      })
    } else {
      missing.push(zoom)
    }
  }

  return {
    videoPath,
    resolution,
    zoomLevels,
    existing,
    missing,
    isComplete: missing.length === 0,
  }
}

async function getCacheSize() {
  if (!fs.existsSync(WAVEFORM_CACHE_DIR)) {
    return 0
  }

  let totalSize = 0

  function calculateSize(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        calculateSize(fullPath)
      } else if (entry.name.endsWith('.dat')) {
        const stats = fs.statSync(fullPath)
        totalSize += stats.size
      }
    }
  }

  calculateSize(WAVEFORM_CACHE_DIR)
  return totalSize
}

function clearCache() {
  if (fs.existsSync(WAVEFORM_CACHE_DIR)) {
    fs.rmSync(WAVEFORM_CACHE_DIR, { recursive: true, force: true })
  }
}

function pruneOrphanedWaveforms(validVideoPaths) {
  if (!fs.existsSync(WAVEFORM_CACHE_DIR)) {
    return { deleted: 0, freedBytes: 0 }
  }

  const validSet = new Set(validVideoPaths.map((p) => p.toLowerCase()))
  let deleted = 0
  let freedBytes = 0

  const entries = fs.readdirSync(WAVEFORM_CACHE_DIR, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const fullPath = path.join(WAVEFORM_CACHE_DIR, entry.name)
    const decodedPath = Buffer.from(entry.name.replace(/_/g, '/').replace(/-/g, '='), 'base64').toString()

    if (!validSet.has(decodedPath.toLowerCase())) {
      const dirSize = getDirSize(fullPath)
      fs.rmSync(fullPath, { recursive: true, force: true })
      deleted++
      freedBytes += dirSize
    }
  }

  return { deleted, freedBytes }
}

function getDirSize(dir) {
  let size = 0
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        size += getDirSize(fullPath)
      } else {
        const stats = fs.statSync(fullPath)
        size += stats.size
      }
    }
  } catch {}
  return size
}

function formatBytes(bytes) {
  for (const unit of ['B', 'KB', 'MB', 'GB']) {
    if (bytes < 1024) return `${bytes.toFixed(1)} ${unit}`
    bytes /= 1024
  }
  return `${bytes.toFixed(1)} TB`
}

module.exports = {
  WAVEFORM_CACHE_DIR,
  ZOOM_LEVELS,
  ZOOM_LEVEL_DEFAULT,
  getCacheDir,
  getCacheDirForVideo,
  getWaveformPath,
  getAllWaveformPaths,
  checkAudiowaveformAvailable,
  isAvailable,
  generateWaveformForZoom,
  generateWaveforms,
  getWaveformStatus,
  getCacheSize,
  clearCache,
  pruneOrphanedWaveforms,
  formatBytes,
}
