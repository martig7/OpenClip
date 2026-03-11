const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { isVideoFile, CODEC_MAP, FFMPEG_PATH, FFPROBE_PATH } = require('./constants');
const service = require('./recordingService');

const execFileAsync = promisify(execFile);

function getWeekFolder(date) {
  const d = new Date(date);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Week of ${months[monday.getMonth()]} ${monday.getDate()} ${monday.getFullYear()}`;
}

async function organizeRecordings(store, gameName) {
  const obsPath = store.get('settings.obsRecordingPath');
  const destPath = store.get('settings.destinationPath');
  if (!obsPath || !destPath || !fs.existsSync(obsPath)) return;

  const files = fs.readdirSync(obsPath).filter(f => isVideoFile(f));

  const now = new Date();
  const weekFolder = `${gameName} - ${getWeekFolder(now)}`;
  const targetDir = path.join(destPath, weekFolder);

  for (const file of files) {
    const src = path.join(obsPath, file);
    const stat = fs.statSync(src);
    // Only process files modified in the last 10 minutes
    if (now - stat.mtime > 10 * 60 * 1000) continue;

    // Wait for file to stabilize — OBS may still be writing/finalizing
    await new Promise(r => setTimeout(r, 2000));
    let statCheck;
    try { statCheck = fs.statSync(src); } catch { continue; }
    if (stat.size !== statCheck.size) {
      console.warn(`[organize] Skipping ${file} — file size changed, still being written`);
      continue;
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const dateStr = now.toISOString().slice(0, 10);
    const existing = fs.readdirSync(targetDir).filter(f => f.includes(dateStr));
    const sessionNum = existing.length + 1;
    const ext = path.extname(file);
    const newName = `${gameName} Session ${dateStr} #${sessionNum}.mp4`;
    const dest = path.join(targetDir, newName);

    if (ext.toLowerCase() !== '.mp4') {
      // Mark both paths as in-progress so scans skip them during remux
      service.markRemuxing(src, dest);
      try {
        // Probe source for audio stream titles before remux (MKV titles don't survive MP4 remux)
        let trackNames = null;
        try {
          const { stdout: probeOut } = await execFileAsync(FFPROBE_PATH, [
            '-v', 'error', '-show_streams', '-select_streams', 'a', '-of', 'json', src,
          ], { encoding: 'utf-8', timeout: 10000 });
          const streams = JSON.parse(probeOut).streams || [];
          const names = streams.map(s => s.tags?.title || s.tags?.TITLE || null);
          if (names.some(Boolean)) trackNames = names;
        } catch {}

        await execFileAsync(FFMPEG_PATH, [
          '-i', src, '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-y', dest,
        ], { timeout: 120000 });

        // Save track names in a sidecar file so they survive the container conversion
        if (trackNames) {
          fs.writeFileSync(dest + '.tracks.json', JSON.stringify(trackNames));
        }

        fs.unlinkSync(src);
      } catch {
        // Remux failed — remove any partial output so no duplicate is left behind
        try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
        // Fallback: just move the file
        try {
          fs.renameSync(src, path.join(targetDir, `${gameName} Session ${dateStr} #${sessionNum}${ext}`));
        } catch {}
      } finally {
        service.unmarkRemuxing(src, dest);
        service.invalidateCache();
      }
    } else {
      fs.renameSync(src, dest);
      service.invalidateCache();
    }
  }

  // Auto-clip from markers when auto-clip is enabled
  const autoClipSettings = store.get('settings.autoClip');
  if (autoClipSettings && autoClipSettings.enabled) {
    await processAutoClips(store, gameName, targetDir);
  }
}

async function getVideoDuration(filePath) {
  try {
    const { stdout } = await execFileAsync(FFPROBE_PATH, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { encoding: 'utf-8', timeout: 10000 });
    return parseFloat(stdout.trim()) || null;
  } catch {
    return null;
  }
}

async function processAutoClips(store, gameName, recordingDir) {
  const markers = (store.get('clipMarkers') || []).filter(m => m.game === gameName);
  if (markers.length === 0) return;

  const destPath = store.get('settings.destinationPath');
  const clipsDir = path.join(destPath, 'Clips');
  fs.mkdirSync(clipsDir, { recursive: true });

  const autoClip = store.get('settings.autoClip') || {};
  const bufferBefore = autoClip.bufferBefore || 15;
  const bufferAfter = autoClip.bufferAfter || 15;

  // Find the most recent recording file
  const recordings = fs.readdirSync(recordingDir)
    .filter(f => f.endsWith('.mp4'))
    .map(f => {
      const fp = path.join(recordingDir, f);
      return { name: f, path: fp, mtime: fs.statSync(fp).mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (recordings.length === 0) return;
  const recording = recordings[0];

  // Determine recording time window to convert absolute marker timestamps → video positions
  const duration = await getVideoDuration(recording.path);
  if (!duration) return;
  const recordingStartUnix = recording.mtime.getTime() / 1000 - duration;

  const dateStr = new Date().toISOString().slice(0, 10);
  let clipNum = service.countClipsForDate(clipsDir, gameName, dateStr) + 1;

  for (const marker of markers) {
    // Convert absolute Unix timestamp to position within the video
    const videoPosition = marker.timestamp - recordingStartUnix;
    if (videoPosition < 0 || videoPosition > duration) continue; // marker outside this recording

    const start = Math.max(0, videoPosition - bufferBefore);
    const clipDuration = bufferBefore + bufferAfter;
    const clipPath = path.join(clipsDir, `${gameName} Clip ${dateStr} #${clipNum}.mp4`);

    try {
      await execFileAsync(FFMPEG_PATH, [
        '-ss', String(start),
        '-i', recording.path,
        '-t', String(clipDuration),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        clipPath,
        '-y',
      ], { timeout: 5 * 60 * 1000, killSignal: 'SIGKILL' });
      clipNum++;
    } catch {
      // Skip failed clips
    }
  }

  if (autoClip.removeMarkers) {
    const remaining = (store.get('clipMarkers') || []).filter(m => m.game !== gameName);
    store.set('clipMarkers', remaining);
  }

  if (autoClip.deleteFullRecording) {
    try { fs.unlinkSync(recording.path); } catch {}
  }
}

function setupFileManager(ipcMain, store) {
  service.init(store);

  ipcMain.handle('recordings:list', () => {
    return service.scanRecordings();
  });

  ipcMain.handle('recordings:delete', (_event, filePath) => {
    const destPath = store.get('settings.destinationPath');
    const resolvedFile = path.resolve(filePath);
    const resolvedDest = path.resolve(destPath);
    if (!resolvedFile.startsWith(resolvedDest + path.sep)) throw new Error('Invalid path');
    return service.deleteFile(resolvedFile);
  });

  ipcMain.handle('video:getURL', (_event, filePath) => {
    return `file:///${filePath.replace(/\\/g, '/')}`;
  });

  ipcMain.handle('clips:list', () => {
    return service.scanClips();
  });

  ipcMain.handle('clips:create', async (_event, { sourcePath, startTime, endTime, gameName }) => {
    return service.createClip(sourcePath, startTime, endTime, gameName);
  });

  ipcMain.handle('clips:delete', (_event, filePath) => {
    const destPath = store.get('settings.destinationPath');
    const resolvedFile = path.resolve(filePath);
    const resolvedDest = path.resolve(destPath);
    if (!resolvedFile.startsWith(resolvedDest + path.sep)) throw new Error('Invalid path');
    return service.deleteFile(resolvedFile);
  });

  ipcMain.handle('markers:list', () => {
    return store.get('clipMarkers') || [];
  });

  ipcMain.handle('markers:delete', (_event, index) => {
    const markers = store.get('clipMarkers') || [];
    markers.splice(index, 1);
    store.set('clipMarkers', markers);
    return markers;
  });

  ipcMain.handle('storage:stats', () => {
    const recordings = service.scanRecordings();
    const clips = service.scanClips();
    const all = [...recordings, ...clips];
    const byGame = {};
    for (const item of all) {
      byGame[item.game_name] = (byGame[item.game_name] || 0) + item.size_bytes;
    }
    return {
      totalSize: all.reduce((sum, i) => sum + i.size_bytes, 0),
      recordingCount: recordings.length,
      clipCount: clips.length,
      byGame,
    };
  });

  ipcMain.handle('video:reencode', async (_event, { filePath, codec, crf, preset, replace }) => {
    return service.reencodeVideo(filePath, {
      codec, crf, preset,
      replaceOriginal: replace,
    });
  });
}

async function organizeSpecificRecording(store, filePath, gameName) {
  const destPath = store.get('settings.destinationPath');
  if (!destPath) throw new Error('No destination path configured');
  if (!fs.existsSync(filePath)) throw new Error('Recording file not found');

  // Verify file is stable (not still being written)
  const stat1 = fs.statSync(filePath);
  await new Promise(r => setTimeout(r, 1500));
  let stat2;
  try { stat2 = fs.statSync(filePath); } catch { throw new Error('Cannot access file'); }
  if (stat1.size !== stat2.size) throw new Error('File is still being written — please wait a moment and try again');

  // Use the file's mtime as the reference date so the recording lands in the correct week
  const recordingDate = stat2.mtime;
  const weekFolder = `${gameName} - ${getWeekFolder(recordingDate)}`;
  const targetDir = path.join(destPath, weekFolder);
  fs.mkdirSync(targetDir, { recursive: true });

  const dateStr = recordingDate.toISOString().slice(0, 10);
  const existing = fs.readdirSync(targetDir).filter(f => isVideoFile(f) && f.includes(dateStr));
  const sessionNum = existing.length + 1;
  const ext = path.extname(filePath);
  const destFilename = `${gameName} Session ${dateStr} #${sessionNum}.mp4`;
  const dest = path.join(targetDir, destFilename);

  if (ext.toLowerCase() !== '.mp4') {
    service.markRemuxing(filePath, dest);
    let finalPath = dest;
    try {
      let trackNames = null;
      try {
        const { stdout } = await execFileAsync(FFPROBE_PATH, [
          '-v', 'error', '-show_streams', '-select_streams', 'a', '-of', 'json', filePath,
        ], { encoding: 'utf-8', timeout: 10000 });
        const streams = JSON.parse(stdout).streams || [];
        const names = streams.map(s => s.tags?.title || s.tags?.TITLE || null);
        if (names.some(Boolean)) trackNames = names;
      } catch {}

      await execFileAsync(FFMPEG_PATH, [
        '-i', filePath, '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-y', dest,
      ], { timeout: 120000 });

      if (trackNames) fs.writeFileSync(dest + '.tracks.json', JSON.stringify(trackNames));
      fs.unlinkSync(filePath);
    } catch (err) {
      try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
      // Fallback: move with original extension
      const fallbackName = `${gameName} Session ${dateStr} #${sessionNum}${ext}`;
      finalPath = path.join(targetDir, fallbackName);
      try {
        fs.renameSync(filePath, finalPath);
      } catch (renameErr) {
        service.unmarkRemuxing(filePath, dest);
        throw new Error(`Could not move file (it may still be open by OBS): ${renameErr.message}`);
      }
    } finally {
      service.unmarkRemuxing(filePath, dest);
      service.invalidateCache();
    }
    return { success: true, path: finalPath, filename: path.basename(finalPath) };
  } else {
    try {
      fs.renameSync(filePath, dest);
    } catch (err) {
      throw new Error(`Could not move file (it may still be open by OBS): ${err.message}`);
    }
    service.invalidateCache();
    return { success: true, path: dest, filename: destFilename };
  }
}

module.exports = { setupFileManager, organizeRecordings, organizeSpecificRecording };
