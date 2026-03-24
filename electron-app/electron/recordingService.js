/**
 * Canonical implementation of recording/clip scanning, clip creation,
 * deletion, and reencoding. Both apiServer.js and fileManager.js delegate here.
 */
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { isVideoFile, formatFileSize, CODEC_MAP, FFMPEG_PATH } = require('./constants')

let store // set via init()

function init(appStore) {
  store = appStore
}

// --- FFmpeg process tracking (item 6) ---

// Map<ChildProcess, outputPath|null> — outputPath is deleted on kill if it exists
const activeFFmpeg = new Map()

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n)
}

function shouldLogClipPerf() {
  return (
    process.env.OPENCLIP_CLIP_PERF === '1' ||
    process.env.OPENCLIP_CLIP_PERF === 'true' ||
    process.env.OPENCLIP_TEST_MODE === 'true' ||
    process.env.NODE_ENV !== 'production'
  )
}

function logClipPerf(message, fields = {}) {
  if (!shouldLogClipPerf()) return
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${v}`)
  const suffix = parts.length > 0 ? ` ${parts.join(' ')}` : ''
  console.log(`[clip-perf] ${message}${suffix}`)
}

function killAllProcesses() {
  for (const [proc, outPath] of activeFFmpeg) {
    try {
      proc.kill()
    } catch (e) {
      console.warn('[clip] SIGTERM failed:', e)
    }
    const sigkillTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {}
    }, 3000)
    if (typeof sigkillTimer.unref === 'function') sigkillTimer.unref()
    proc.once('close', () => clearTimeout(sigkillTimer))
    if (outPath)
      try {
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
      } catch {}
  }
  activeFFmpeg.clear()
}

// --- In-progress remux tracking ---
// Paths currently being read or written by organizeRecordings are hidden from scans
// to prevent file-access errors and duplicate entries while ffmpeg is running.
const activeRemuxPaths = new Set()

function markRemuxing(srcPath, destPath) {
  activeRemuxPaths.add(path.normalize(srcPath).toLowerCase())
  if (destPath) activeRemuxPaths.add(path.normalize(destPath).toLowerCase())
}

function unmarkRemuxing(srcPath, destPath) {
  activeRemuxPaths.delete(path.normalize(srcPath).toLowerCase())
  if (destPath) activeRemuxPaths.delete(path.normalize(destPath).toLowerCase())
}

// --- File operation helpers ---

// Retry fs.renameSync on transient EPERM/EBUSY (video player or AV may hold file briefly).
async function renameWithRetry(src, dest, maxAttempts = 3, delayMs = 500) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs.renameSync(src, dest)
      return
    } catch (err) {
      if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err
      if (attempt < maxAttempts - 1)
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)))
    }
  }
  throw new Error(`Cannot rename file after ${maxAttempts} attempts — file may still be held open`)
}

// Remove characters invalid on Windows/macOS/Linux; mirrors fileManager.sanitizeGameName.
function sanitizeGameName(name) {
  return (
    (name || '')
      .replace(/[:/\\?*|"<>]/g, '-')
      .replace(/\.{2,}/g, '.')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, 80) || 'Unknown'
  )
}

// Format a Date as YYYY-MM-DD using the local calendar (not UTC); mirrors fileManager.localDateStr.
function localDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// --- Helpers ---

function parseRecordingInfo(filePath, gameName) {
  try {
    const stat = fs.statSync(filePath)
    const filename = path.basename(filePath)
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/)
    const sessionDate = dateMatch ? dateMatch[1] : new Date(stat.mtime).toISOString().slice(0, 10)
    return {
      path: filePath,
      filename,
      game_name: gameName,
      date: sessionDate,
      size_bytes: stat.size,
      size_formatted: formatFileSize(stat.size),
      mtime: stat.mtimeMs / 1000,
    }
  } catch {
    return null
  }
}

function getOrganizedPath() {
  return store.get('settings.destinationPath') || ''
}

function getObsPath() {
  const configured = store.get('settings.obsRecordingPath')
  if (configured) return configured
  const { readOBSRecordingPath } = require('./obsIntegration')
  return readOBSRecordingPath()
}

function getClipsPath() {
  const org = getOrganizedPath() || getObsPath()
  return org ? path.join(org, 'Clips') : null
}

// --- Scan limits ---

const MAX_FILES_PER_FOLDER = 500

// --- Cache ---

const CACHE_TTL_MS = 5000 // 5 seconds
const cache = {
  recordings: { data: null, time: 0 },
  clips: { data: null, time: 0 },
}

// Per-date clip count cache: key = JSON.stringify([clipsPath, gameName, dateStr]) → maxClipNum.
// Cleared whenever a clip is added or deleted.
const clipsDateCache = new Map()

function invalidateRecordingsCache() {
  cache.recordings.data = null
  cache.recordings.time = 0
}

function invalidateClipsCache() {
  cache.clips.data = null
  cache.clips.time = 0
  clipsDateCache.clear()
}

function invalidateCache() {
  invalidateRecordingsCache()
  invalidateClipsCache()
}

function isCacheValid(entry) {
  return entry.data !== null && Date.now() - entry.time < CACHE_TTL_MS
}

function normalizePathForComparison(p) {
  if (!p) return ''
  let normalized = path.normalize(path.resolve(p))
  if (process.platform === 'win32') normalized = normalized.toLowerCase()
  return normalized
}

// Returns true when filePath lives inside the Clips directory.
function isClipPath(filePath) {
  const clipsPath = getClipsPath()
  if (!clipsPath || !filePath) return false
  const normClips = normalizePathForComparison(clipsPath)
  const normFile = normalizePathForComparison(filePath)
  const rel = path.relative(normClips, normFile)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

// --- Scanning ---

function scanRecordings() {
  if (isCacheValid(cache.recordings)) return cache.recordings.data
  const organizedPath = getOrganizedPath()
  const obsPath = getObsPath()
  const recordings = []
  const seenPaths = new Set()

  if (organizedPath && fs.existsSync(organizedPath)) {
    try {
      for (const entry of fs.readdirSync(organizedPath, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.toLowerCase() === 'clips') continue
        const folderPath = path.join(organizedPath, entry.name)
        const gameName = entry.name.includes(' - Week of')
          ? entry.name.split(' - Week of')[0]
          : entry.name
        try {
          const folderFiles = fs.readdirSync(folderPath)
          if (folderFiles.length > MAX_FILES_PER_FOLDER) {
            console.warn(
              `[recordingService] Folder "${entry.name}" has ${folderFiles.length} files; capping scan at ${MAX_FILES_PER_FOLDER}.`
            )
          }
          for (const file of folderFiles.slice(0, MAX_FILES_PER_FOLDER)) {
            if (!isVideoFile(file)) continue
            const fp = path.join(folderPath, file)
            if (activeRemuxPaths.has(path.normalize(fp).toLowerCase())) continue
            const info = parseRecordingInfo(fp, gameName)
            if (info) {
              recordings.push(info)
              seenPaths.add(fp.toLowerCase())
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Only include files that match OBS naming patterns, to avoid listing unrelated videos
  const obsFilenamePattern =
    /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}|^Replay \d{4}-\d{2}-\d{2}|.+ Session \d{4}-\d{2}-\d{2} #\d+/

  if (obsPath && fs.existsSync(obsPath)) {
    try {
      for (const file of fs.readdirSync(obsPath)) {
        if (!isVideoFile(file)) continue
        const nameNoExt = file.replace(/\.[^.]+$/, '')
        if (!obsFilenamePattern.test(nameNoExt)) continue
        const fp = path.join(obsPath, file)
        if (seenPaths.has(fp.toLowerCase())) continue
        if (activeRemuxPaths.has(path.normalize(fp).toLowerCase())) continue
        const info = parseRecordingInfo(fp, '(Unorganized)')
        if (info) recordings.push(info)
      }
    } catch {}
  }

  recordings.sort((a, b) => b.mtime - a.mtime)
  cache.recordings.data = recordings
  cache.recordings.time = Date.now()
  return recordings
}

function scanClips() {
  if (isCacheValid(cache.clips)) return cache.clips.data
  const clipsPath = getClipsPath()
  if (!clipsPath || !fs.existsSync(clipsPath)) return []
  const clips = []
  try {
    for (const file of fs.readdirSync(clipsPath)) {
      if (!isVideoFile(file)) continue
      const fp = path.join(clipsPath, file)
      const gameMatch = file.match(/^(.+?) Clip \d{4}-\d{2}-\d{2}/)
      const gameName = gameMatch ? gameMatch[1] : 'Unknown'
      const info = parseRecordingInfo(fp, gameName)
      if (info) clips.push(info)
    }
  } catch {}
  clips.sort((a, b) => b.mtime - a.mtime)
  cache.clips.data = clips
  cache.clips.time = Date.now()
  return clips
}

function countClipsForDate(clipsPath, gameName, dateStr) {
  const cacheKey = JSON.stringify([clipsPath, gameName, dateStr])
  if (clipsDateCache.has(cacheKey)) return clipsDateCache.get(cacheKey)

  const pattern = `${gameName} Clip ${dateStr} #`
  let count = 0
  try {
    for (const f of fs.readdirSync(clipsPath)) {
      if (f.startsWith(pattern)) {
        const m = f.match(/#(\d+)/)
        if (m) count = Math.max(count, parseInt(m[1]))
      }
    }
  } catch {}
  clipsDateCache.set(cacheKey, count)
  return count
}

// --- Mutations ---

function buildAudioMapArgs(audioTracks) {
  // Returns FFmpeg args array for selective audio track mapping.
  // audioTracks: array of 0-based audio stream indices, or null/undefined for all.
  if (!Array.isArray(audioTracks) || audioTracks.length === 0) return []
  return ['-map', '0:v:0', ...audioTracks.map((i) => ['-map', `0:a:${i}`]).flat()]
}

function createClip(sourcePath, startTime, endTime, gameName = 'Unknown', audioTracks = null) {
  return new Promise((resolve, reject) => {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return reject(new Error('Source not found'))
    }
    if (endTime <= startTime) {
      return reject(new Error('End time must be > start time'))
    }

    const clipsPath = getClipsPath()
    if (!clipsPath) return reject(new Error('No clips folder'))
    fs.mkdirSync(clipsPath, { recursive: true })

    const sanitizedName = sanitizeGameName(gameName)
    const dateStr = localDateStr(new Date())
    let clipNum = countClipsForDate(clipsPath, sanitizedName, dateStr) + 1
    let outputFilename = `${sanitizedName} Clip ${dateStr} #${clipNum}.mp4`
    let outputPath = path.join(clipsPath, outputFilename)
    while (fs.existsSync(outputPath)) {
      clipNum++
      outputFilename = `${sanitizedName} Clip ${dateStr} #${clipNum}.mp4`
      outputPath = path.join(clipsPath, outputFilename)
    }
    const duration = endTime - startTime

    const usingExplicitAudioSelection = Array.isArray(audioTracks) && audioTracks.length > 0

    const runFfmpeg = (args, outPathToTrack) =>
      new Promise((res, rej) => {
        const proc = execFile(FFMPEG_PATH, args, { timeout: 120000 }, (error, _stdout, stderr) => {
          activeFFmpeg.delete(proc)
          if (error) return rej(new Error(stderr || error.message))
          res()
        })
        activeFFmpeg.set(proc, outPathToTrack || null)
      })

    ;(async () => {
      const totalStartMs = nowMs()
      try {
        if (!usingExplicitAudioSelection) {
          const cutStartMs = nowMs()
          const args = [
            '-y',
            '-ss',
            String(startTime),
            '-i',
            sourcePath,
            '-t',
            String(duration),
            '-map',
            '0',
            '-c',
            'copy',
            '-avoid_negative_ts',
            'make_zero',
            outputPath,
          ]
          await runFfmpeg(args, outputPath)
          logClipPerf('createClip-simple-cut', {
            duration_ms: nowMs() - cutStartMs,
            clip_seconds: duration.toFixed(3),
          })
        } else {
          // Fast selected-track path:
          // 1) copy-cut full segment once (fast seek),
          // 2) split out video copy + selected-track audio build from that same segment,
          // 3) mux copy.
          // Using the same intermediate source for both streams keeps A/V aligned.
          const tmpBase = `${outputPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
          const tempBasePath = `${tmpBase}.base.mp4`
          const tempVideoPath = `${tmpBase}.video.mp4`
          const tempAudioPath = `${tmpBase}.audio.m4a`

          try {
            const baseStepStartMs = nowMs()
            const baseArgs = [
              '-y',
              '-ss',
              String(startTime),
              '-i',
              sourcePath,
              '-t',
              String(duration),
              '-map',
              '0',
              '-c',
              'copy',
              '-avoid_negative_ts',
              'make_zero',
              tempBasePath,
            ]
            await runFfmpeg(baseArgs, tempBasePath)
            logClipPerf('createClip-step-base-cut', {
              duration_ms: nowMs() - baseStepStartMs,
              clip_seconds: duration.toFixed(3),
            })

            const videoStepStartMs = nowMs()
            const videoArgs = [
              '-y',
              '-i',
              tempBasePath,
              '-map',
              '0:v:0',
              '-c:v',
              'copy',
              '-an',
              '-avoid_negative_ts',
              'make_zero',
              tempVideoPath,
            ]
            await runFfmpeg(videoArgs, tempVideoPath)
            logClipPerf('createClip-step-video-cut', {
              duration_ms: nowMs() - videoStepStartMs,
              clip_seconds: duration.toFixed(3),
            })

            let audioArgs
            if (audioTracks.length === 1) {
              const audioFilter = `[0:a:${audioTracks[0]}]asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0[a0]`
              audioArgs = [
                '-y',
                '-i',
                tempBasePath,
                '-filter_complex',
                audioFilter,
                '-map',
                '[a0]',
                '-c:a',
                'aac',
                '-b:a',
                '192k',
                tempAudioPath,
              ]
            } else {
              const trimmed = audioTracks.map((i, idx) => ({
                source: `[0:a:${i}]`,
                trimmed: `[t${idx}]`,
                mix: `[m${idx}]`,
                indiv: `[a${idx}]`,
              }))
              const trimFilters = trimmed
                .map(
                  ({ source, trimmed: t }) =>
                    `${source}asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0${t}`
                )
                .join(';')
              const splitFilters = trimmed
                .map(({ trimmed: t, mix, indiv }) => `${t}asplit=2${mix}${indiv}`)
                .join(';')
              const mixInputs = trimmed.map(({ mix }) => mix).join('')
              const filterComplex = `${trimFilters};${splitFilters};${mixInputs}amix=inputs=${audioTracks.length}:duration=longest:normalize=0[mixed]`
              const individualMaps = trimmed.map(({ indiv }) => ['-map', indiv]).flat()
              audioArgs = [
                '-y',
                '-i',
                tempBasePath,
                '-filter_complex',
                filterComplex,
                '-map',
                '[mixed]',
                ...individualMaps,
                '-c:a',
                'aac',
                '-b:a',
                '192k',
                tempAudioPath,
              ]
            }
            const audioStepStartMs = nowMs()
            await runFfmpeg(audioArgs, tempAudioPath)
            logClipPerf('createClip-step-audio-build', {
              duration_ms: nowMs() - audioStepStartMs,
              tracks: audioTracks.length,
            })

            const muxStepStartMs = nowMs()
            const muxArgs = [
              '-y',
              '-i',
              tempVideoPath,
              '-i',
              tempAudioPath,
              '-map',
              '0:v:0',
              '-map',
              '1:a',
              '-c',
              'copy',
              '-movflags',
              '+faststart',
              outputPath,
            ]
            await runFfmpeg(muxArgs, outputPath)
            logClipPerf('createClip-step-mux', {
              duration_ms: nowMs() - muxStepStartMs,
            })
          } finally {
            try {
              if (fs.existsSync(tempBasePath)) fs.unlinkSync(tempBasePath)
            } catch {}
            try {
              if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath)
            } catch {}
            try {
              if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath)
            } catch {}
          }
        }

        logClipPerf('createClip-total', {
          duration_ms: nowMs() - totalStartMs,
          clip_seconds: duration.toFixed(3),
          selected_tracks: usingExplicitAudioSelection ? audioTracks.length : 0,
        })
        invalidateClipsCache()
        const info = parseRecordingInfo(outputPath, gameName)
        resolve(info || { filename: outputFilename, path: outputPath })
      } catch (err) {
        try {
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
        } catch {}
        reject(new Error(`FFmpeg error: ${err.message}`))
      }
    })()
  })
}

function deleteFile(filePath) {
  try {
    fs.unlinkSync(filePath)
    try {
      fs.unlinkSync(filePath + '.tracks.json')
    } catch {}
    if (isClipPath(filePath)) {
      invalidateClipsCache()
    } else {
      invalidateRecordingsCache()
    }
    return { success: true }
  } catch (e) {
    if (e.code === 'ENOENT') return { error: 'Not found', status: 404 }
    return { error: e.message, status: 500 }
  }
}

const VALID_PRESETS = new Set([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
])

function reencodeVideo(
  sourcePath,
  {
    codec = 'h265',
    crf = 23,
    preset = 'medium',
    replaceOriginal = false,
    originalSize = 0,
    audioTracks = null,
  } = {}
) {
  return new Promise((resolve, reject) => {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return reject(new Error('Not found'))
    }

    const encoder = CODEC_MAP[codec] || 'libx265'
    const safeCrf = Math.max(0, Math.min(51, Math.round(Number(crf) || 23)))
    const safePreset = VALID_PRESETS.has(preset) ? preset : 'medium'
    const base = sourcePath.replace(/\.[^.]+$/, '')
    const outPath = replaceOriginal ? `${base}_temp.mp4` : `${base}_reencoded_${codec}.mp4`
    const mapArgsList = buildAudioMapArgs(audioTracks)

    const args = [
      '-y',
      '-i',
      sourcePath,
      ...mapArgsList,
      '-c:v',
      encoder,
      '-crf',
      String(safeCrf),
      '-preset',
      safePreset,
      '-c:a',
      'copy',
      outPath,
    ]

    // 'let' instead of 'const' avoids TDZ if a synchronous mock calls the callback
    // before the execFile call returns and proc is assigned.
    let proc
    proc = execFile(FFMPEG_PATH, args, { timeout: 600000 }, async (error, _stdout, stderr) => {
      activeFFmpeg.delete(proc)
      if (error) {
        try {
          if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
        } catch {}
        return reject(new Error(`FFmpeg error: ${stderr}`))
      }

      let finalPath = outPath
      if (replaceOriginal) {
        const bakPath = `${sourcePath}.bak`
        try {
          // Retry on EPERM/EBUSY: video player may briefly hold the file open
          await renameWithRetry(sourcePath, bakPath)
        } catch (err) {
          // Clean up the temp encode; original is still intact at sourcePath
          try {
            fs.unlinkSync(outPath)
          } catch {}
          return reject(new Error(`Failed to back up original: ${err.message}`))
        }
        try {
          await renameWithRetry(outPath, sourcePath)
          finalPath = sourcePath
          // Backup is no longer needed; ignore failure — it can be cleaned up later
          try {
            fs.unlinkSync(bakPath)
          } catch {}
        } catch (err) {
          // Restore the backup so the user does not lose their original file
          try {
            await renameWithRetry(bakPath, sourcePath)
          } catch (restoreErr) {
            return reject(
              new Error(
                `Failed to replace original: ${err.message}. ` +
                  `Original is backed up at ${bakPath} — please restore it manually.`
              )
            )
          }
          return reject(new Error(`Failed to replace original: ${err.message}`))
        }
      }

      if (isClipPath(sourcePath)) {
        invalidateClipsCache()
      } else {
        invalidateRecordingsCache()
      }
      const stat = fs.statSync(finalPath)
      const savings = originalSize > 0 ? originalSize - stat.size : 0
      resolve({
        success: true,
        output_path: finalPath,
        size_bytes: stat.size,
        size_formatted: formatFileSize(stat.size),
        original_size: originalSize,
        savings: Math.max(0, savings),
        savings_formatted: formatFileSize(Math.max(0, savings)),
      })
    })
    activeFFmpeg.set(proc, outPath)
  })
}

/**
 * Run the auto-delete pass. Called on watcher start.
 * Deletes unlocked recordings (and clips if not excluded) that are:
 *   1. Older than max_age_days, OR
 *   2. Pushing total storage over max_storage_gb (oldest deleted first).
 * Returns a summary { deleted, skipped, errors }.
 */
function runAutoDelete() {
  const settings = store.get('storageSettings') || {}
  if (!settings.auto_delete_enabled) return { deleted: 0, skipped: 0, errors: 0 }

  const maxBytes = (settings.max_storage_gb ?? 100) * 1024 ** 3
  const maxAgeMs = (settings.max_age_days ?? 30) * 24 * 60 * 60 * 1000
  const excClips = settings.exclude_clips !== false
  const locked = new Set(
    (store.get('lockedRecordings') || []).map((p) => path.normalize(p).toLowerCase())
  )

  // Gather candidates — recordings always included, clips only if not excluded
  let candidates = [...scanRecordings()]
  if (!excClips) candidates = candidates.concat(scanClips())

  // Remove locked files
  candidates = candidates.filter((f) => !locked.has(path.normalize(f.path).toLowerCase()))

  // Sort oldest first for size-based trimming
  candidates.sort((a, b) => a.mtime - b.mtime)

  const nowMs = Date.now()
  const toDelete = new Set()

  // Pass 1: age-based — mark anything older than max_age_days
  for (const f of candidates) {
    if (nowMs - f.mtime * 1000 > maxAgeMs) toDelete.add(f.path)
  }

  // Pass 2: size-based — if still over limit after age deletions, trim oldest first
  const remaining = candidates.filter((f) => !toDelete.has(f.path))
  let totalBytes = remaining.reduce((s, f) => s + f.size_bytes, 0)
  for (const f of remaining) {
    if (totalBytes <= maxBytes) break
    toDelete.add(f.path)
    totalBytes -= f.size_bytes
  }

  let deleted = 0,
    errors = 0
  for (const filePath of toDelete) {
    const result = deleteFile(filePath)
    if (result.success) deleted++
    else errors++
  }

  return { deleted, skipped: locked.size, errors }
}

module.exports = {
  init,
  invalidateCache,
  invalidateRecordingsCache,
  invalidateClipsCache,
  parseRecordingInfo,
  getOrganizedPath,
  getObsPath,
  getClipsPath,
  isClipPath,
  scanRecordings,
  scanClips,
  countClipsForDate,
  createClip,
  deleteFile,
  reencodeVideo,
  runAutoDelete,
  killAllProcesses,
  markRemuxing,
  unmarkRemuxing,
}
