const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { isVideoFile, CODEC_MAP, FFMPEG_PATH, FFPROBE_PATH } = require('./constants')
const { pathToFileURL } = require('url')
const service = require('./recordingService')
const { preCacheWaveform, setWaveformResolution } = require('./waveformPreCache')

const execFileAsync = promisify(execFile)

// Move a file safely across devices or past transient system locks.
// Strategy: rename with retry on EBUSY/EPERM (Windows indexer/AV/thumbnail gen hold files
// briefly but don't block reads), then fall back to copy+delete for EXDEV or
// persistent EBUSY/EPERM.
async function moveFileSafe(src, dest) {
  // Try rename up to 3 times; back off on transient EBUSY or EPERM
  let renameErr = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.renameSync(src, dest)
      return // success
    } catch (err) {
      if (err.code !== 'EXDEV' && err.code !== 'EBUSY' && err.code !== 'EPERM') throw err
      renameErr = err
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

// Try to open the file for writing to check if it's still held by another process
function isFileLocked(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r+')
    fs.closeSync(fd)
    return false
  } catch (err) {
    return err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES'
  }
}

// Wait until the file is not locked, checking every delayMs up to maxAttempts times
async function waitForUnlock(filePath, maxAttempts = 5, delayMs = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    if (!isFileLocked(filePath)) return
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs))
  }
  throw new Error(`File is still locked after ${maxAttempts} attempts — try again in a moment`)
}

// Retry fs.statSync until it succeeds or the file remains inaccessible after maxAttempts.
// Returns the Stats object, or null if timed out (EPERM/EBUSY/EACCES from OBS still holding the file).
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

// Retry fs.unlinkSync to handle transient EPERM/EBUSY (AV scanning newly created files,
// Windows indexer, OBS briefly reopening the source after ffmpeg finishes).
// Throws only if still locked after all attempts.
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

function getWeekFolder(date) {
  const d = new Date(date)
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((day + 6) % 7))
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `Week of ${months[monday.getMonth()]} ${monday.getDate()} ${monday.getFullYear()}`
}

// Format a Date as YYYY-MM-DD using the local calendar (not UTC).
function localDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Sanitize a game name for use in file/folder names: remove characters invalid
// on Windows/macOS/Linux, collapse consecutive dots, strip leading/trailing whitespace, cap length.
function sanitizeGameName(name) {
  return (
    (name || '')
      .replace(/[:/\\?*|"<>]/g, '-')
      .replace(/\.{2,}/g, '.')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, 80) || 'Unknown'
  )
}

async function organizeRecordings(store, gameName, onProgress = () => {}) {
  const obsPath = store.get('settings.obsRecordingPath')
  const destPath = store.get('settings.destinationPath')
  if (!obsPath || !destPath || !fs.existsSync(obsPath)) return

  const files = fs.readdirSync(obsPath).filter((f) => isVideoFile(f))

  const now = new Date()
  const sanitizedName = sanitizeGameName(gameName)
  const weekFolder = `${sanitizedName} - ${getWeekFolder(now)}`
  const targetDir = path.join(destPath, weekFolder)

  const autoClipSettings = store.get('settings.autoClip')
  const autoClipEnabled = autoClipSettings?.enabled

  for (const file of files) {
    const src = path.join(obsPath, file)
    // Wait for OBS to release its handle — EPERM on stat means the file isn't accessible yet
    const stat = await waitForStat(src)
    if (!stat) {
      console.warn(`[organize] Skipping ${file} — file inaccessible after retries`)
      continue
    }
    // Only process files modified in the last 10 minutes
    if (now - stat.mtime > 10 * 60 * 1000) continue

    onProgress({ phase: 'recording', stage: 'checking', label: 'Verifying recording…', gameName })

    // Wait for file to stabilize — OBS may still be writing/finalizing
    await new Promise((r) => setTimeout(r, 2000))
    const statCheck = await waitForStat(src)
    if (!statCheck) {
      console.warn(`[organize] Skipping ${file} — file inaccessible after stabilization wait`)
      continue
    }
    if (stat.size !== statCheck.size) {
      console.warn(`[organize] Skipping ${file} — file size changed, still being written`)
      continue
    }

    onProgress({
      phase: 'recording',
      stage: 'waiting',
      label: 'Waiting for OBS to unlock…',
      gameName,
    })
    try {
      await waitForUnlock(src)
    } catch {
      console.warn(`[organize] Skipping ${file} — file is still held open after retries`)
      continue
    }

    // Create clips from the source file before renaming or moving it
    let processedMarkers = []
    if (autoClipEnabled) {
      processedMarkers = await processAutoClipsFromFile(store, gameName, src, statCheck, onProgress)
    }

    fs.mkdirSync(targetDir, { recursive: true })

    const dateStr = localDateStr(now)
    const existing = fs.readdirSync(targetDir).filter((f) => isVideoFile(f) && f.includes(dateStr))
    const sessionNum = existing.length + 1
    const ext = path.extname(file)
    const moveOnly = store.get('settings.organizeRemux') === false
    const newName = `${sanitizedName} Session ${dateStr} #${sessionNum}${moveOnly ? ext : '.mp4'}`
    const dest = path.join(targetDir, newName)

    let movedTo = null
    let preCachePromise = null
    if (!moveOnly && ext.toLowerCase() !== '.mp4') {
      onProgress({ phase: 'recording', stage: 'remuxing', label: 'Remuxing to MP4…', gameName })
      // Mark both paths as in-progress so scans skip them during remux
      service.markRemuxing(src, dest)
      let remuxDone = false
      try {
        // Probe source for audio stream titles before remux (MKV titles don't survive MP4 remux)
        let trackNames = null
        try {
          const { stdout: probeOut } = await execFileAsync(
            FFPROBE_PATH,
            ['-v', 'error', '-show_streams', '-select_streams', 'a', '-of', 'json', src],
            { encoding: 'utf-8', timeout: 10000 }
          )
          const streams = JSON.parse(probeOut).streams || []
          const names = streams.map((s) => s.tags?.title || s.tags?.TITLE || null)
          if (names.some(Boolean)) trackNames = names
        } catch {}

        await execFileAsync(
          FFMPEG_PATH,
          ['-i', src, '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-y', dest],
          { timeout: 10 * 60 * 1000 }
        )
        remuxDone = true

        // Save track names in a sidecar file so they survive the container conversion
        if (trackNames) {
          fs.writeFileSync(dest + '.tracks.json', JSON.stringify(trackNames))
        }

        // Retry unlink: AV software may scan the new MP4 and briefly re-lock the source
        await unlinkWithRetry(src)
        movedTo = dest
      } catch (remuxErr) {
        if (remuxDone) {
          // ffmpeg succeeded; only the source deletion failed — keep the output and log
          console.warn(
            `[organize] Remux succeeded but source could not be deleted: ${remuxErr.message}`
          )
          movedTo = dest
        } else {
          // ffmpeg itself failed — remove any partial output so no duplicate is left behind
          try {
            if (fs.existsSync(dest)) fs.unlinkSync(dest)
          } catch {}
          // Fallback: just move the file
          const fallbackDest = path.join(
            targetDir,
            `${sanitizedName} Session ${dateStr} #${sessionNum}${ext}`
          )
          try {
            onProgress({ phase: 'recording', stage: 'moving', label: 'Moving file…', gameName })
            await moveFileSafe(src, fallbackDest)
            movedTo = fallbackDest
          } catch {
            onProgress({
              phase: 'error',
              gameName,
              error: `Could not process recording for ${gameName}: ${remuxErr.message}`,
            })
          }
        }
      } finally {
        service.unmarkRemuxing(src, dest)
        service.invalidateRecordingsCache()
        // Pre-cache waveform for the moved file
        if (movedTo) {
          preCachePromise = preCacheWaveform(movedTo)
          preCachePromise.catch(console.error)
        }
      }
    } else {
      onProgress({ phase: 'recording', stage: 'moving', label: 'Moving file…', gameName })
      await moveFileSafe(src, dest)
      service.invalidateRecordingsCache()
      movedTo = dest
      // Pre-cache waveform for the moved file
      preCachePromise = preCacheWaveform(dest)
      preCachePromise.catch(console.error)
    }

    // Post-move: clean up processed markers and optionally delete the organized recording
    if (autoClipEnabled && processedMarkers.length > 0) {
      if (autoClipSettings.removeMarkers) {
        const processedTimestamps = new Set(processedMarkers.map((m) => m.timestamp))
        const remaining = (store.get('clipMarkers') || []).filter(
          (m) => !(m.game === gameName && processedTimestamps.has(m.timestamp))
        )
        store.set('clipMarkers', remaining)
      }
      if (autoClipSettings.deleteFullRecording && movedTo) {
        // Await the in-progress waveform pre-cache (started above) before deleting the file
        try {
          await (preCachePromise || preCacheWaveform(movedTo))
        } catch (error) {
          console.error('Waveform pre-caching failed before delete:', error)
        }
        try {
          fs.unlinkSync(movedTo)
        } catch {}
      }
    }
  }

  onProgress({ phase: 'complete', gameName })
}

async function getVideoDuration(filePath) {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_PATH,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { encoding: 'utf-8', timeout: 10000 }
    )
    return parseFloat(stdout.trim()) || null
  } catch {
    return null
  }
}

// Create clips from a specific source file before it is renamed or moved.
// Returns the array of markers that were successfully clipped.
// Caller is responsible for marker removal, deleteFullRecording, and emitting 'complete'.
async function processAutoClipsFromFile(store, gameName, srcPath, srcStat, onProgress = () => {}) {
  const markers = (store.get('clipMarkers') || []).filter((m) => m.game === gameName)
  if (markers.length === 0) return []

  const destPath = store.get('settings.destinationPath')
  const clipsDir = path.join(destPath, 'Clips')
  fs.mkdirSync(clipsDir, { recursive: true })

  const autoClip = store.get('settings.autoClip') || {}
  const bufferBefore = autoClip.bufferBefore || 15
  const bufferAfter = autoClip.bufferAfter || 15

  const duration = await getVideoDuration(srcPath)
  if (!duration) return []

  // Use the file's mtime to determine when the recording started
  const recordingStartUnix = srcStat.mtime.getTime() / 1000 - duration

  const sanitizedName = sanitizeGameName(gameName)
  const dateStr = localDateStr(new Date())
  let clipNum = service.countClipsForDate(clipsDir, gameName, dateStr) + 1

  const clipTotal = markers.length
  let clipIndex = 0
  const processedMarkers = []

  for (const marker of markers) {
    // Convert absolute Unix timestamp to position within the video
    const videoPosition = marker.timestamp - recordingStartUnix
    if (videoPosition < 0 || videoPosition > duration) continue // marker outside this recording

    clipIndex++
    onProgress({
      phase: 'clipping',
      stage: 'clipping',
      label: `Creating clip ${clipIndex} of ${clipTotal}…`,
      gameName,
      clipIndex,
      clipTotal,
    })

    const start = Math.max(0, videoPosition - bufferBefore)
    const clipDuration = bufferBefore + bufferAfter
    const clipPath = path.join(clipsDir, `${sanitizedName} Clip ${dateStr} #${clipNum}.mp4`)

    try {
      await execFileAsync(
        FFMPEG_PATH,
        [
          '-ss',
          String(start),
          '-i',
          srcPath,
          '-t',
          String(clipDuration),
          '-c',
          'copy',
          '-avoid_negative_ts',
          'make_zero',
          clipPath,
          '-y',
        ],
        { timeout: 5 * 60 * 1000, killSignal: 'SIGKILL' }
      )
      clipNum++
      service.invalidateClipsCache()
      processedMarkers.push(marker)
    } catch {
      // Skip failed clips
    }
  }

  return processedMarkers
}

async function finalizeDirectRecording(store, gameName, recordingDir, onProgress = () => {}) {
  if (!recordingDir || !fs.existsSync(recordingDir)) return

  const files = fs.readdirSync(recordingDir).filter((f) => isVideoFile(f))
  const now = new Date()
  const sanitizedName = sanitizeGameName(gameName)

  const autoClipSettings = store.get('settings.autoClip')
  const autoClipEnabled = autoClipSettings?.enabled

  for (const file of files) {
    // Skip files already in session format (from a previous finalize call)
    if (file.startsWith(`${sanitizedName} Session`)) continue

    const src = path.join(recordingDir, file)
    // Wait for OBS to release its handle — EPERM on stat means the file isn't accessible yet
    const stat = await waitForStat(src)
    if (!stat) {
      console.warn(`[finalize] Skipping ${file} — file inaccessible after retries`)
      continue
    }
    // Only process files modified in the last 10 minutes
    if (now - stat.mtime > 10 * 60 * 1000) continue

    onProgress({ phase: 'recording', stage: 'checking', label: 'Verifying recording…', gameName })

    // Wait for file to stabilize — OBS may still be writing/finalizing
    await new Promise((r) => setTimeout(r, 2000))
    const statCheck = await waitForStat(src)
    if (!statCheck) {
      console.warn(`[finalize] Skipping ${file} — file inaccessible after stabilization wait`)
      continue
    }
    if (stat.size !== statCheck.size) {
      console.warn(`[finalize] Skipping ${file} — file size changed, still being written`)
      continue
    }

    try {
      await waitForUnlock(src)
    } catch {
      console.warn(`[finalize] Skipping ${file} — file is still held open after retries`)
      continue
    }

    // Create clips from the source file before renaming or remuxing it
    let processedMarkers = []
    if (autoClipEnabled) {
      processedMarkers = await processAutoClipsFromFile(store, gameName, src, statCheck, onProgress)
    }

    const dateStr = localDateStr(now)
    const existing = fs
      .readdirSync(recordingDir)
      .filter((f) => isVideoFile(f) && f.includes(dateStr) && f !== file)
    const sessionNum = existing.length + 1
    const ext = path.extname(file)
    const newName = `${sanitizedName} Session ${dateStr} #${sessionNum}.mp4`
    const dest = path.join(recordingDir, newName)

    let movedTo = null
    let preCachePromise = null
    if (ext.toLowerCase() !== '.mp4') {
      onProgress({ phase: 'recording', stage: 'remuxing', label: 'Remuxing to MP4…', gameName })
      service.markRemuxing(src, dest)
      let remuxDone = false
      try {
        let trackNames = null
        try {
          const { stdout: probeOut } = await execFileAsync(
            FFPROBE_PATH,
            ['-v', 'error', '-show_streams', '-select_streams', 'a', '-of', 'json', src],
            { encoding: 'utf-8', timeout: 10000 }
          )
          const streams = JSON.parse(probeOut).streams || []
          const names = streams.map((s) => s.tags?.title || s.tags?.TITLE || null)
          if (names.some(Boolean)) trackNames = names
        } catch {}

        await execFileAsync(
          FFMPEG_PATH,
          ['-i', src, '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-y', dest],
          { timeout: 10 * 60 * 1000 }
        )
        remuxDone = true

        if (trackNames) {
          fs.writeFileSync(dest + '.tracks.json', JSON.stringify(trackNames))
        }

        // Retry unlink: AV software may scan the new MP4 and briefly re-lock the source
        await unlinkWithRetry(src)
        movedTo = dest
      } catch (remuxErr) {
        if (remuxDone) {
          // ffmpeg succeeded; only the source deletion failed — keep the output and log
          console.warn(
            `[finalize] Remux succeeded but source could not be deleted: ${remuxErr.message}`
          )
          movedTo = dest
        } else {
          // ffmpeg itself failed — remove any partial output, keep original with session name
          try {
            if (fs.existsSync(dest)) fs.unlinkSync(dest)
          } catch {}
          const fallbackDest = path.join(
            recordingDir,
            `${sanitizedName} Session ${dateStr} #${sessionNum}${ext}`
          )
          try {
            onProgress({ phase: 'recording', stage: 'moving', label: 'Renaming file…', gameName })
            await moveFileSafe(src, fallbackDest)
            movedTo = fallbackDest
          } catch {
            onProgress({
              phase: 'error',
              gameName,
              error: `Could not process recording for ${gameName}: ${remuxErr.message}`,
            })
          }
        }
      } finally {
        service.unmarkRemuxing(src, dest)
        service.invalidateRecordingsCache()
        // Pre-cache waveform for the finalized file
        if (movedTo) {
          preCachePromise = preCacheWaveform(movedTo)
          preCachePromise.catch(console.error)
        }
      }
    } else {
      onProgress({ phase: 'recording', stage: 'moving', label: 'Renaming file…', gameName })
      await moveFileSafe(src, dest)
      service.invalidateRecordingsCache()
      movedTo = dest
      // Pre-cache waveform for the finalized file
      preCachePromise = preCacheWaveform(dest)
      preCachePromise.catch(console.error)
    }

    // Post-rename: clean up processed markers and optionally delete the organized recording
    if (autoClipEnabled && processedMarkers.length > 0) {
      if (autoClipSettings.removeMarkers) {
        const processedTimestamps = new Set(processedMarkers.map((m) => m.timestamp))
        const remaining = (store.get('clipMarkers') || []).filter(
          (m) => !(m.game === gameName && processedTimestamps.has(m.timestamp))
        )
        store.set('clipMarkers', remaining)
      }
      if (autoClipSettings.deleteFullRecording && movedTo) {
        // Await the in-progress waveform pre-cache (started above) before deleting the file
        try {
          await (preCachePromise || preCacheWaveform(movedTo))
        } catch (error) {
          console.error('Waveform pre-caching failed before delete:', error)
        }
        try {
          fs.unlinkSync(movedTo)
        } catch {}
      }
    }
  }

  onProgress({ phase: 'complete', gameName })
}

function setupFileManager(ipcMain, store) {
  service.init(store)
  
  // Initialize waveform resolution from settings
  const settings = store.get('settings')
  if (settings?.waveformResolution) {
    setWaveformResolution(settings.waveformResolution)
  }
  


  ipcMain.handle('recordings:list', () => {
    return service.scanRecordings()
  })

  ipcMain.handle('recordings:delete', (_event, filePath) => {
    const destPath = store.get('settings.destinationPath')
    const resolvedFile = path.resolve(filePath)
    const resolvedDest = path.resolve(destPath)
    if (!resolvedFile.startsWith(resolvedDest + path.sep)) throw new Error('Invalid path')
    return service.deleteFile(resolvedFile)
  })

  ipcMain.handle('video:getURL', (_event, filePath) => {
    return pathToFileURL(filePath).href
  })

  ipcMain.handle('clips:list', () => {
    return service.scanClips()
  })

  ipcMain.handle('clips:create', async (_event, { sourcePath, startTime, endTime, gameName }) => {
    return service.createClip(sourcePath, startTime, endTime, gameName)
  })

  ipcMain.handle('clips:delete', (_event, filePath) => {
    const destPath = store.get('settings.destinationPath')
    const resolvedFile = path.resolve(filePath)
    const resolvedDest = path.resolve(destPath)
    if (!resolvedFile.startsWith(resolvedDest + path.sep)) throw new Error('Invalid path')
    return service.deleteFile(resolvedFile)
  })

  ipcMain.handle('markers:list', () => {
    return store.get('clipMarkers') || []
  })

  ipcMain.handle('markers:delete', (_event, index) => {
    const markers = store.get('clipMarkers') || []
    markers.splice(index, 1)
    store.set('clipMarkers', markers)
    return markers
  })

  ipcMain.handle('storage:stats', () => {
    const recordings = service.scanRecordings()
    const clips = service.scanClips()
    const all = [...recordings, ...clips]
    const byGame = {}
    for (const item of all) {
      byGame[item.game_name] = (byGame[item.game_name] || 0) + item.size_bytes
    }
    return {
      totalSize: all.reduce((sum, i) => sum + i.size_bytes, 0),
      recordingCount: recordings.length,
      clipCount: clips.length,
      byGame,
    }
  })

  ipcMain.handle('video:reencode', async (_event, { filePath, codec, crf, preset, replace }) => {
    return service.reencodeVideo(filePath, {
      codec,
      crf,
      preset,
      replaceOriginal: replace,
    })
  })
}

async function organizeSpecificRecording(store, filePath, gameName, opts = {}) {
  const { moveOnly = false, onProgress = () => {}, forceReorganize = false } = opts

  const destPath = store.get('settings.destinationPath')
  if (!destPath) throw new Error('No destination path configured')
  if (!fs.existsSync(filePath)) throw new Error('Recording file not found')

  // Skip files already inside the organized destination (no double-move)
  const resolvedFile = path.resolve(filePath)
  const resolvedDest = path.resolve(destPath)
  if (!forceReorganize && resolvedFile.startsWith(resolvedDest + path.sep)) {
    return {
      success: true,
      alreadyOrganized: true,
      path: filePath,
      filename: path.basename(filePath),
    }
  }

  // Verify file is stable (size not changing) and not locked by OBS.
  // Use waitForStat so transient EPERM (OBS still finalizing) is retried gracefully.
  onProgress('checking', 'Verifying file…')
  const stat1 = await waitForStat(filePath)
  if (!stat1)
    throw new Error('File is not accessible — it may still be held open by another process')
  await new Promise((r) => setTimeout(r, 1500))
  const stat2 = await waitForStat(filePath)
  if (!stat2)
    throw new Error('File is not accessible — it may still be held open by another process')
  if (stat1.size !== stat2.size)
    throw new Error('File is still being written — please wait a moment and try again')
  await waitForUnlock(filePath)

  // Use the file's mtime as the reference date so the recording lands in the correct week
  const recordingDate = stat2.mtime
  const sanitizedName = sanitizeGameName(gameName)
  const weekFolder = `${sanitizedName} - ${getWeekFolder(recordingDate)}`
  const targetDir = path.join(destPath, weekFolder)
  try {
    fs.mkdirSync(targetDir, { recursive: true })
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      throw new Error(
        'Permission denied: cannot create folder at destination. Check your folder permissions.'
      )
    }
    if (err.code === 'ENOSPC') {
      throw new Error('Not enough disk space to create the destination folder.')
    }
    throw err
  }

  const dateStr = localDateStr(recordingDate)
  const existing = fs.readdirSync(targetDir).filter((f) => isVideoFile(f) && f.includes(dateStr))
  const sessionNum = existing.length + 1
  const ext = path.extname(filePath)
  const shouldRemux = ext.toLowerCase() !== '.mp4' && !moveOnly
  const destExt = shouldRemux ? '.mp4' : ext
  const destFilename = `${sanitizedName} Session ${dateStr} #${sessionNum}${destExt}`
  const dest = path.join(targetDir, destFilename)

  if (shouldRemux) {
    onProgress('remuxing', 'Remuxing to MP4…')
    service.markRemuxing(filePath, dest)
    let finalPath = dest
    let remuxDone = false
    try {
      let trackNames = null
      try {
        const { stdout } = await execFileAsync(
          FFPROBE_PATH,
          ['-v', 'error', '-show_streams', '-select_streams', 'a', '-of', 'json', filePath],
          { encoding: 'utf-8', timeout: 10000 }
        )
        const streams = JSON.parse(stdout).streams || []
        const names = streams.map((s) => s.tags?.title || s.tags?.TITLE || null)
        if (names.some(Boolean)) trackNames = names
      } catch {}

      await execFileAsync(
        FFMPEG_PATH,
        ['-i', filePath, '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-y', dest],
        { timeout: 120000 }
      )
      remuxDone = true

      if (trackNames) fs.writeFileSync(dest + '.tracks.json', JSON.stringify(trackNames))
      // Retry unlink: AV software may scan the new MP4 and briefly re-lock the source
      await unlinkWithRetry(filePath)
    } catch (err) {
      if (remuxDone) {
        // ffmpeg succeeded; only the source deletion failed — keep the output and log
        console.warn(`[organize] Remux succeeded but source could not be deleted: ${err.message}`)
      } else {
        // ffmpeg itself failed — move with original extension as fallback
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest)
        } catch {}
        const fallbackName = `${sanitizedName} Session ${dateStr} #${sessionNum}${ext}`
        finalPath = path.join(targetDir, fallbackName)
        try {
          await moveFileSafe(filePath, finalPath)
        } catch (renameErr) {
          service.unmarkRemuxing(filePath, dest)
          throw new Error(`Could not move file: ${renameErr.message}`)
        }
      }
    } finally {
      service.unmarkRemuxing(filePath, dest)
      service.invalidateRecordingsCache()
    }
    return { success: true, path: finalPath, filename: path.basename(finalPath) }
  } else {
    onProgress('moving', 'Moving file…')
    try {
      await moveFileSafe(filePath, dest)
    } catch (err) {
      if (err.code === 'ENOSPC') {
        throw new Error('Not enough disk space to move the recording.')
      }
      throw new Error(`Could not move file: ${err.message}`)
    }
    service.invalidateRecordingsCache()
    return { success: true, path: dest, filename: destFilename }
  }
}

module.exports = {
  setupFileManager,
  organizeRecordings,
  organizeSpecificRecording,
  finalizeDirectRecording,
  getWeekFolder,
}
