const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.flv', '.mov', '.avi', '.ts'];

function getWeekFolder(date) {
  const d = new Date(date);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Week of ${months[monday.getMonth()]} ${monday.getDate()} ${monday.getFullYear()}`;
}

function organizeRecordings(store, gameName) {
  const obsPath = store.get('settings.obsRecordingPath');
  const destPath = store.get('settings.destinationPath');
  if (!obsPath || !destPath || !fs.existsSync(obsPath)) return;

  const files = fs.readdirSync(obsPath).filter(f =>
    VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase())
  );

  const now = new Date();
  const weekFolder = `${gameName} - ${getWeekFolder(now)}`;
  const targetDir = path.join(destPath, weekFolder);

  for (const file of files) {
    const src = path.join(obsPath, file);
    const stat = fs.statSync(src);
    // Only process files modified in the last 10 minutes
    if (now - stat.mtime > 10 * 60 * 1000) continue;

    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const dateStr = now.toISOString().slice(0, 10);
    const existing = fs.readdirSync(targetDir).filter(f => f.includes(dateStr));
    const sessionNum = existing.length + 1;
    const ext = path.extname(file);
    const newName = `${gameName} Session ${dateStr} #${sessionNum}.mp4`;
    const dest = path.join(targetDir, newName);

    if (ext.toLowerCase() !== '.mp4') {
      // Remux to MP4
      try {
        execSync(`ffmpeg -i "${src}" -c copy "${dest}" -y`, { timeout: 120000 });
        fs.unlinkSync(src);
      } catch {
        // Fallback: just move the file
        fs.renameSync(src, path.join(targetDir, `${gameName} Session ${dateStr} #${sessionNum}${ext}`));
      }
    } else {
      fs.renameSync(src, dest);
    }
  }

  // Auto-clip from markers
  const autoClip = store.get('settings.autoClip');
  if (autoClip?.enabled) {
    processAutoClips(store, gameName, targetDir);
  }
}

function processAutoClips(store, gameName, recordingDir) {
  const markers = (store.get('clipMarkers') || []).filter(m => m.game === gameName);
  if (markers.length === 0) return;

  const destPath = store.get('settings.destinationPath');
  const clipsDir = path.join(destPath, 'Clips');
  if (!fs.existsSync(clipsDir)) fs.mkdirSync(clipsDir, { recursive: true });

  const autoClip = store.get('settings.autoClip');
  const bufferBefore = autoClip.bufferBefore || 15;
  const bufferAfter = autoClip.bufferAfter || 15;

  // Find the most recent recording file
  const recordings = fs.readdirSync(recordingDir)
    .filter(f => f.endsWith('.mp4'))
    .map(f => ({ name: f, path: path.join(recordingDir, f), mtime: fs.statSync(path.join(recordingDir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  if (recordings.length === 0) return;
  const recording = recordings[0];

  const dateStr = new Date().toISOString().slice(0, 10);
  let clipNum = 1;

  for (const marker of markers) {
    const start = Math.max(0, marker.timestamp - bufferBefore);
    const duration = bufferBefore + bufferAfter;
    const clipPath = path.join(clipsDir, `${gameName} Clip ${dateStr} #${clipNum}.mp4`);

    try {
      execSync(`ffmpeg -ss ${start} -i "${recording.path}" -t ${duration} -c copy "${clipPath}" -y`, { timeout: 60000 });
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

function scanRecordings(destPath) {
  if (!destPath || !fs.existsSync(destPath)) return [];

  const recordings = [];
  const entries = fs.readdirSync(destPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'Clips') continue;
    const dirPath = path.join(destPath, entry.name);
    // Extract game name from folder (e.g., "GameName - Week of ...")
    const gameMatch = entry.name.match(/^(.+?)\s*-\s*Week of/);
    const gameName = gameMatch ? gameMatch[1].trim() : entry.name;

    const files = fs.readdirSync(dirPath).filter(f =>
      VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase())
    );

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      recordings.push({
        name: file,
        path: filePath,
        game: gameName,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        folder: entry.name,
      });
    }
  }

  return recordings.sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

function scanClips(destPath) {
  const clipsDir = path.join(destPath, 'Clips');
  if (!fs.existsSync(clipsDir)) return [];

  return fs.readdirSync(clipsDir)
    .filter(f => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map(f => {
      const filePath = path.join(clipsDir, f);
      const stat = fs.statSync(filePath);
      const gameMatch = f.match(/^(.+?)\s+Clip/);
      return {
        name: f,
        path: filePath,
        game: gameMatch ? gameMatch[1] : 'Unknown',
        size: stat.size,
        modified: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

function getStorageStats(destPath) {
  if (!destPath || !fs.existsSync(destPath)) {
    return { totalSize: 0, recordingCount: 0, clipCount: 0, byGame: {} };
  }

  const recordings = scanRecordings(destPath);
  const clips = scanClips(destPath);
  const all = [...recordings, ...clips];

  const byGame = {};
  for (const item of all) {
    byGame[item.game] = (byGame[item.game] || 0) + item.size;
  }

  return {
    totalSize: all.reduce((sum, i) => sum + i.size, 0),
    recordingCount: recordings.length,
    clipCount: clips.length,
    byGame,
  };
}

function setupFileManager(ipcMain, store) {
  ipcMain.handle('recordings:list', () => {
    return scanRecordings(store.get('settings.destinationPath'));
  });

  ipcMain.handle('recordings:delete', (_event, filePath) => {
    const destPath = store.get('settings.destinationPath');
    if (!filePath.startsWith(destPath)) throw new Error('Invalid path');
    fs.unlinkSync(filePath);
    return true;
  });

  ipcMain.handle('video:getURL', (_event, filePath) => {
    // Return a file:// URL for the video
    return `file:///${filePath.replace(/\\/g, '/')}`;
  });

  ipcMain.handle('clips:list', () => {
    return scanClips(store.get('settings.destinationPath'));
  });

  ipcMain.handle('clips:create', async (_event, { sourcePath, startTime, endTime }) => {
    const destPath = store.get('settings.destinationPath');
    const clipsDir = path.join(destPath, 'Clips');
    if (!fs.existsSync(clipsDir)) fs.mkdirSync(clipsDir, { recursive: true });

    const baseName = path.basename(sourcePath, path.extname(sourcePath));
    const dateStr = new Date().toISOString().slice(0, 10);
    const existing = fs.readdirSync(clipsDir).filter(f => f.includes(dateStr));
    const num = existing.length + 1;
    const clipPath = path.join(clipsDir, `${baseName} Clip ${dateStr} #${num}.mp4`);
    const duration = endTime - startTime;

    return new Promise((resolve, reject) => {
      exec(
        `ffmpeg -ss ${startTime} -i "${sourcePath}" -t ${duration} -c copy "${clipPath}" -y`,
        { timeout: 120000 },
        (error) => {
          if (error) reject(error);
          else resolve({ path: clipPath, name: path.basename(clipPath) });
        }
      );
    });
  });

  ipcMain.handle('clips:delete', (_event, filePath) => {
    const destPath = store.get('settings.destinationPath');
    if (!filePath.startsWith(destPath)) throw new Error('Invalid path');
    fs.unlinkSync(filePath);
    return true;
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
    return getStorageStats(store.get('settings.destinationPath'));
  });

  ipcMain.handle('video:reencode', async (_event, { filePath, codec, crf, preset, replace }) => {
    const codecMap = {
      h264: 'libx264',
      h265: 'libx265',
      av1: 'libsvtav1',
    };
    const encoder = codecMap[codec] || 'libx264';
    const outPath = replace ? filePath + '.tmp.mp4' : filePath.replace('.mp4', `_${codec}.mp4`);

    return new Promise((resolve, reject) => {
      exec(
        `ffmpeg -i "${filePath}" -c:v ${encoder} -crf ${crf} -preset ${preset} -c:a copy "${outPath}" -y`,
        { timeout: 600000 },
        (error) => {
          if (error) return reject(error);
          if (replace) {
            fs.unlinkSync(filePath);
            fs.renameSync(outPath, filePath);
          }
          resolve(true);
        }
      );
    });
  });
}

module.exports = { setupFileManager, organizeRecordings };
