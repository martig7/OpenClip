const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { isVideoFile, FFMPEG_PATH, FFPROBE_PATH } = require('./constants')
const { pathToFileURL } = require('url')
const service = require('./recordingService')
const { preCacheWaveform, setWaveformResolution } = require('./waveformPreCache')
const {
  moveFileSafe,
  isFileLocked,
  waitForUnlock,
  waitForStat,
  unlinkWithRetry,
} = require('./fileOperations')
const { migrateToGameFolders } = require('./migrations')

const execFileAsync = promisify(execFile)

// File-operation helpers are in fileOperations.js (imported above).

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

// OBS filename pattern — only these get treated as recordings that belong to OpenClip.
// Matches: "2024-01-15 20-30-00", "Replay 2024-01-15 20-30-00", "GameName Session 2024-01-15 #1"
const OBS_FILENAME_PATTERN =
  /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}|^Replay \d{4}-\d{2}-\d{2}|.+ Session \d{4}-\d{2}-\d{2} #\d+/

async function organizeRecordings(store, gameName, onProgress = () => {}) {
  const obsPath = store.get('settings.obsRecordingPath')
  const destPath = store.get('settings.destinationPath')
  if (!obsPath || !destPath || !fs.existsSync(obsPath)) return

  const files = fs.readdirSync(obsPath).filter((f) => isVideoFile(f))

  const now = new Date()
  const isUnorganized = gameName === '(Unorganized)'
  const sanitizedName = isUnorganized ? 'Unorganized' : sanitizeGameName(gameName)
  const weekFolders = store.get('settings.weekFolders')
  const targetDir = weekFolders
    ? path.join(destPath, sanitizedName, getWeekFolder(now))
    : path.join(destPath, sanitizedName)

  const autoClipSettings = store.get('settings.autoClip')
  const autoClipEnabled = autoClipSettings?.enabled

  for (const file of files) {
    // For (Unorganized) sessions, only move files that match OBS naming patterns.
    // This prevents picking up unrelated videos the user may have placed in their OBS folder.
    if (isUnorganized) {
      const nameNoExt = file.replace(/\.[^.]+$/, '')
      if (!OBS_FILENAME_PATTERN.test(nameNoExt)) continue
    }
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

// Returns FFmpeg -map args to selectively copy audio streams.
// audioTracks: 1-based array (matching UI), e.g. [1, 3] → ['-map','0:v:0','-map','0:a:0','-map','0:a:2']
// Empty / null / undefined → [] (no explicit maps = all streams copied)
function buildAutoClipMapArgs(audioTracks) {
  if (!Array.isArray(audioTracks) || audioTracks.length === 0) return []
  return ['-map', '0:v:0', ...audioTracks.flatMap((t) => ['-map', `0:a:${t - 1}`])]
}

// Create clips from a specific source file before it is renamed or moved.
// Returns the array of markers that were successfully clipped.
// Caller is responsible for marker removal, deleteFullRecording, and emitting 'complete'.
async function processAutoClipsFromFile(store, gameName, srcPath, srcStat, onProgress = () => {}) {
  const markers = (store.get('clipMarkers') || []).filter((m) => m.game === gameName)
  if (markers.length === 0) return []

  const destPath = store.get('settings.destinationPath')
  const clipsDir = path.join(destPath, sanitizeGameName(gameName), 'Clips')
  fs.mkdirSync(clipsDir, { recursive: true })

  const autoClip = store.get('settings.autoClip') || {}
  const bufferBefore = autoClip.bufferBefore || 15
  const bufferAfter = autoClip.bufferAfter || 15
  const mapArgs = buildAutoClipMapArgs(autoClip.audioTracks)

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
          ...mapArgs,
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
  const weekFolders = store.get('settings.weekFolders')
  const targetDir = weekFolders
    ? path.join(destPath, sanitizedName, getWeekFolder(recordingDate))
    : path.join(destPath, sanitizedName)
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

// migrateToGameFolders is in migrations.js (imported above, re-exported below).

// Reorganize already-organized recordings to match the current weekFolders setting.
// - weekFolders OFF (flatten): move files from "Week of *" subdirs up to the game folder
// - weekFolders ON  (expand):  move files sitting in the game folder into the correct week subdir
// Naming conflicts are resolved by appending -2, -3, … before the extension.
// Returns { moved, renamed: [{ from, to }] }
async function reorganizeWeekFolders(store, onProgress = () => {}) {
  const destPath = store.get('settings.destinationPath')
  if (!destPath || !fs.existsSync(destPath)) return { moved: 0, renamed: [] }

  const weekFolders = store.get('settings.weekFolders')
  let moved = 0
  const renamed = []

  // Helper: resolve a safe destination path, appending -2/-3/… on conflict
  function safeDest(dir, filename) {
    const ext = path.extname(filename)
    const base = path.basename(filename, ext)
    let dest = path.join(dir, filename)
    let counter = 2
    while (fs.existsSync(dest)) {
      dest = path.join(dir, `${base}-${counter}${ext}`)
      counter++
    }
    return dest
  }

  // Helper: move the companion .tracks.json if it exists alongside src → dest
  async function moveTracksJson(src, dest) {
    const srcJson = src + '.tracks.json'
    if (!fs.existsSync(srcJson)) return
    try {
      await moveFileSafe(srcJson, dest + '.tracks.json')
    } catch (err) {
      console.warn(`[reorganize] Could not move tracks json for ${src}: ${err.message}`)
    }
  }

  // --- Step 1: Move unorganized recordings from OBS folder → {destPath}/Unorganized/ ---
  const obsPath = store.get('settings.obsRecordingPath')
  if (obsPath && fs.existsSync(obsPath)) {
    onProgress('Moving unorganized recordings…')
    try {
      const obsFiles = fs.readdirSync(obsPath).filter((f) => isVideoFile(f))
      for (const file of obsFiles) {
        // Only move files that match OBS naming patterns — skip unrelated videos
        const nameNoExt = file.replace(/\.[^.]+$/, '')
        if (!OBS_FILENAME_PATTERN.test(nameNoExt)) continue
        const src = path.join(obsPath, file)
        // Determine the destination date from the filename or mtime
        let recordingDate
        const dateMatch = nameNoExt.match(/(\d{4}-\d{2}-\d{2})/)
        if (dateMatch) {
          recordingDate = new Date(dateMatch[1] + 'T12:00:00')
        } else {
          try {
            recordingDate = new Date(fs.statSync(src).mtime)
          } catch {
            continue
          }
        }
        const unorganizedDir = weekFolders
          ? path.join(destPath, 'Unorganized', getWeekFolder(recordingDate))
          : path.join(destPath, 'Unorganized')
        try {
          fs.mkdirSync(unorganizedDir, { recursive: true })
        } catch {
          continue
        }
        const dest = safeDest(unorganizedDir, file)
        const wasRenamed = path.basename(dest) !== file
        try {
          await moveFileSafe(src, dest)
          await moveTracksJson(src, dest)
          moved++
          if (wasRenamed) renamed.push({ from: file, to: path.basename(dest) })
        } catch (err) {
          console.warn(`[reorganize] Could not move unorganized ${src}: ${err.message}`)
        }
      }
    } catch (err) {
      console.warn(`[reorganize] Could not read OBS path for unorganized files: ${err.message}`)
    }
  }

  // --- Step 2: Reorganize existing game folders by week-folder setting ---
  let gameDirs
  try {
    gameDirs = fs.readdirSync(destPath, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch {
    service.invalidateRecordingsCache()
    return { moved, renamed }
  }

  const total = gameDirs.length
  for (let i = 0; i < gameDirs.length; i++) {
    const gameDir = gameDirs[i]
    const gamePath = path.join(destPath, gameDir.name)
    onProgress(`Reorganizing ${gameDir.name}… (${i + 1}/${total})`)

    if (!weekFolders) {
      // FLATTEN: find "Week of *" subdirs and move their video files up
      let subdirs
      try {
        subdirs = fs.readdirSync(gamePath, { withFileTypes: true }).filter((e) => e.isDirectory())
      } catch {
        continue
      }
      for (const subdir of subdirs) {
        if (!subdir.name.startsWith('Week of ')) continue
        const weekPath = path.join(gamePath, subdir.name)
        let weekFiles
        try {
          weekFiles = fs.readdirSync(weekPath).filter((f) => isVideoFile(f))
        } catch {
          continue
        }
        for (const file of weekFiles) {
          const src = path.join(weekPath, file)
          const dest = safeDest(gamePath, file)
          const wasRenamed = path.basename(dest) !== file
          try {
            await moveFileSafe(src, dest)
            await moveTracksJson(src, dest)
            moved++
            if (wasRenamed) renamed.push({ from: file, to: path.basename(dest) })
          } catch (err) {
            console.warn(`[reorganize] Could not move ${src}: ${err.message}`)
          }
        }
        // Delete the week subdir if now empty (ignore errors)
        try {
          const remaining = fs.readdirSync(weekPath)
          if (remaining.length === 0) fs.rmdirSync(weekPath)
        } catch {}
      }
    } else {
      // EXPAND: move video files in the game folder root into the appropriate week subdir
      let gameFiles
      try {
        gameFiles = fs.readdirSync(gamePath).filter((f) => isVideoFile(f))
      } catch {
        continue
      }
      for (const file of gameFiles) {
        const match = file.match(/Session (\d{4}-\d{2}-\d{2})/)
        if (!match) continue
        const recordingDate = new Date(match[1] + 'T12:00:00') // noon local avoids UTC offset issues
        const weekFolderName = getWeekFolder(recordingDate)
        const weekPath = path.join(gamePath, weekFolderName)
        try {
          fs.mkdirSync(weekPath, { recursive: true })
        } catch {
          continue
        }
        const src = path.join(gamePath, file)
        const dest = safeDest(weekPath, file)
        const wasRenamed = path.basename(dest) !== file
        try {
          await moveFileSafe(src, dest)
          await moveTracksJson(src, dest)
          moved++
          if (wasRenamed) renamed.push({ from: file, to: path.basename(dest) })
        } catch (err) {
          console.warn(`[reorganize] Could not move ${src}: ${err.message}`)
        }
      }
    }
  }

  service.invalidateRecordingsCache()
  return { moved, renamed }
}

module.exports = {
  setupFileManager,
  organizeRecordings,
  organizeSpecificRecording,
  finalizeDirectRecording,
  getWeekFolder,
  migrateToGameFolders, // re-exported from migrations.js for backwards-compat
  reorganizeWeekFolders,
  buildAutoClipMapArgs,
  // Re-export file-op helpers so tests that import them from fileManager.js still work
  moveFileSafe,
  isFileLocked,
  waitForUnlock,
  waitForStat,
  unlinkWithRetry,
}
