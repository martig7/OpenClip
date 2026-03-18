/**
 * Waveform Utility Functions
 * Shared utilities for waveform generation across different modules
 */
const { spawn } = require('child_process')
const { FFMPEG_PATH } = require('./constants')

/**
 * Create an FFmpeg process for waveform generation
 * @param {string} filePath - Path to video file
 * @param {number} trackIndex - Audio track index
 * @param {number} sampleRate - Sample rate for audio extraction
 * @returns {ChildProcess} - Spawned FFmpeg process
 */
function createWaveformFFmpegProcess(filePath, trackIndex, sampleRate) {
  return spawn(FFMPEG_PATH, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    filePath,
    '-map',
    `0:a:${trackIndex}`,
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    '-f',
    'f32le',
    'pipe:1',
  ])
}

/**
 * Calculate waveform peaks from audio samples
 * @param {Float32Array} samples - Audio samples from FFmpeg output
 * @param {number} numPeaks - Number of peaks to generate
 * @returns {number[]} - Normalized peaks
 */
function calculatePeaks(samples, numPeaks) {
  if (!samples.length) {
    return []
  }

  const chunkSize = Math.max(1, Math.ceil(samples.length / numPeaks))
  const peaks = []

  for (let i = 0; i < samples.length && peaks.length < numPeaks; i += chunkSize) {
    let max = 0
    for (let j = i; j < Math.min(i + chunkSize, samples.length); j++) {
      const v = Math.abs(samples[j])
      if (v > max) max = v
    }
    peaks.push(max)
  }

  const maxPeak = peaks.reduce((m, p) => (p > m ? p : m), 0.001)
  return peaks.map((p) => p / maxPeak)
}

/**
 * Map resolution string to number of peaks
 * @param {string} resolution - 'low', 'default', or 'high'
 * @returns {number} - Number of peaks to generate
 */
function getNumPeaks(resolution = 'default') {
  switch (resolution) {
    case 'low':
      return 1000
    case 'high':
      return 4000
    default:
      return 2000
  }
}

/**
 * Setup process timeout and cleanup
 * @param {ChildProcess} process - Child process to manage
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns {Function} - Cleanup function to clear timeout
 */
function setupProcessTimeout(process, timeoutMs = 30000) {
  const killTimer = setTimeout(() => {
    try {
      process.kill('SIGKILL')
    } catch {}
  }, timeoutMs)

  if (typeof killTimer.unref === 'function') killTimer.unref()

  const clearTimer = () => clearTimeout(killTimer)
  process.on('close', clearTimer)
  process.on('error', clearTimer)

  return clearTimer
}

/**
 * Convert FFmpeg output buffer to audio samples
 * @param {Buffer} buffer - FFmpeg output buffer
 * @returns {Float32Array} - Audio samples
 */
function bufferToSamples(buffer) {
  return new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    Math.floor(buffer.length / 4)
  )
}

/**
 * Generate waveform peaks for a specific track in a video file
 * @param {string} filePath - Path to video file
 * @param {number} trackIndex - Audio track index
 * @param {number} numPeaks - Number of peaks to generate
 * @param {Function} getDuration - Function to get video duration (filePath => Promise<number|null>)
 * @returns {Promise<{peaks: number[], duration: number}|null>}
 */
async function generateWaveform(filePath, trackIndex, numPeaks, getDuration) {
  try {
    const duration = await getDuration(filePath)
    if (!duration) {
      return null
    }

    const sampleRate = Math.max(2, Math.round(numPeaks / duration))
    const ffmpegProc = createWaveformFFmpegProcess(filePath, trackIndex, sampleRate)
    setupProcessTimeout(ffmpegProc, 30_000)

    const chunks = []
    ffmpegProc.stdout.on('data', (chunk) => chunks.push(chunk))

    return new Promise((resolve) => {
      ffmpegProc.on('close', () => {
        try {
          const buffer = Buffer.concat(chunks)
          const samples = bufferToSamples(buffer)

          if (!samples.length) {
            resolve(null)
            return
          }

          const normalizedPeaks = calculatePeaks(samples, numPeaks)
          resolve({ peaks: normalizedPeaks, duration })
        } catch {
          resolve(null)
        }
      })

      ffmpegProc.on('error', () => {
        resolve(null)
      })
    })
  } catch (error) {
    return null
  }
}

module.exports = {
  createWaveformFFmpegProcess,
  calculatePeaks,
  getNumPeaks,
  setupProcessTimeout,
  bufferToSamples,
  generateWaveform,
}
