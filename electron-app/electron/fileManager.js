const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { isVideoFile, CODEC_MAP, FFMPEG_PATH, FFPROBE_PATH, MARKERS_FILE } = require('./constants');
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

    // Use the file's own mtime for the date so the session lands in the correct week folder
    const fileDate = statCheck.mtime;
    const weekFolder = `${gameName} - ${getWeekFolder(fileDate)}`;
    const targetDir = path.join(destPath, weekFolder);
    fs.mkdirSync(targetDir, { recursive: true });

    const dateStr = fileDate.toISOString().slice(0, 10);
    const existing = fs.readdirSync(targetDir).filter(f => isVideoFile(f) && f.includes(dateStr));
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
        service.invalidateRecordingsCache();
      }
    } else {
      fs.renameSync(src, dest);
      service.invalidateRecordingsCache();
    }
  }

  // Auto-clip from markers when auto-clip is enabled
  const autoClipSettings = store.get('settings.autoClip');
  if (autoClipSettings && autoClipSettings.enabled) {
    await processAutoClips(store, gameName, destPath);
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

function loadMarkersFile() {
  try {
    return JSON.parse(fs.readFileSync(MARKERS_FILE, 'utf-8'));
  } catch {
    return { markers: [] };
  }
}

function saveMarkersFile(data) {
  try {
    const dir = path.dirname(MARKERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MARKERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[markers] Failed to save markers file:', e.message);
    return false;
  }
}

async function processAutoClips(store, gameName, destPath) {
  // Read markers from the canonical JSON file (same source as the HTTP API)
  const markersData = loadMarkersFile();
  const markers = (markersData.markers || []).filter(m => m.game_name === gameName);
  if (markers.length === 0) return;

  const clipsDir = path.join(destPath, 'Clips');
  fs.mkdirSync(clipsDir, { recursive: true });

  const autoClip = store.get('settings.autoClip') || {};
  const bufferBefore = autoClip.bufferBefore || 15;
  const bufferAfter = autoClip.bufferAfter || 15;

  // Find the most recent recording for this game across all week folders in destPath
  const allRecordings = [];
  if (fs.existsSync(destPath)) {
    for (const entry of fs.readdirSync(destPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith(gameName + ' - ')) continue;
      const folderPath = path.join(destPath, entry.name);
      try {
        for (const f of fs.readdirSync(folderPath)) {
          if (!f.endsWith('.mp4')) continue;
          const fp = path.join(folderPath, f);
          const stat = fs.statSync(fp);
          allRecordings.push({ path: fp, mtime: stat.mtime });
        }
      } catch {}
    }
  }

  if (allRecordings.length === 0) return;
  allRecordings.sort((a, b) => b.mtime - a.mtime);
  const recording = allRecordings[0];

  // Determine recording time window to convert absolute marker timestamps → video positions
  const duration = await getVideoDuration(recording.path);
  if (!duration) return;
  const recordingStartUnix = recording.mtime.getTime() / 1000 - duration;

  const dateStr = recording.mtime.toISOString().slice(0, 10);
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
      service.invalidateClipsCache();
    } catch (e) {
      console.warn(`[autoClip] Failed to create clip for marker at ${marker.timestamp}:`, e.message);
    }
  }

  if (autoClip.removeMarkers) {
    markersData.markers = markersData.markers.filter(m => m.game_name !== gameName);
    saveMarkersFile(markersData);
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
    return loadMarkersFile().markers;
  });

  ipcMain.handle('markers:delete', (_event, timestamp) => {
    const data = loadMarkersFile();
    const before = data.markers.length;
    data.markers = data.markers.filter(m => m.timestamp !== timestamp);
    if (data.markers.length < before) saveMarkersFile(data);
    return data.markers;
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
      service.invalidateRecordingsCache();
    }
    return { success: true, path: finalPath, filename: path.basename(finalPath) };
  } else {
    try {
      fs.renameSync(filePath, dest);
    } catch (err) {
      throw new Error(`Could not move file (it may still be open by OBS): ${err.message}`);
    }
    service.invalidateRecordingsCache();
    return { success: true, path: dest, filename: destFilename };
  }
}

module.exports = { setupFileManager, organizeRecordings, organizeSpecificRecording };
