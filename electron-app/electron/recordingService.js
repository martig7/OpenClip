/**
 * Canonical implementation of recording/clip scanning, clip creation,
 * deletion, and reencoding. Both apiServer.js and fileManager.js delegate here.
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { isVideoFile, formatFileSize, CODEC_MAP } = require('./constants');

let store; // set via init()

function init(appStore) {
  store = appStore;
}

// --- Helpers ---

function parseRecordingInfo(filePath, gameName) {
  try {
    const stat = fs.statSync(filePath);
    const filename = path.basename(filePath);
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    const sessionDate = dateMatch ? dateMatch[1] : new Date(stat.mtime).toISOString().slice(0, 10);
    return {
      path: filePath,
      filename,
      game_name: gameName,
      date: sessionDate,
      size_bytes: stat.size,
      size_formatted: formatFileSize(stat.size),
      mtime: stat.mtimeMs / 1000,
    };
  } catch { return null; }
}

function getOrganizedPath() {
  return store.get('settings.destinationPath') || '';
}

function getObsPath() {
  const configured = store.get('settings.obsRecordingPath');
  if (configured) return configured;
  const { readOBSRecordingPath } = require('./obsIntegration');
  return readOBSRecordingPath();
}

function getClipsPath() {
  const org = getOrganizedPath() || getObsPath();
  return org ? path.join(org, 'Clips') : null;
}

// --- Cache ---

const CACHE_TTL_MS = 5000; // 5 seconds
const cache = {
  recordings: { data: null, time: 0 },
  clips: { data: null, time: 0 },
};

function invalidateCache() {
  cache.recordings.data = null;
  cache.recordings.time = 0;
  cache.clips.data = null;
  cache.clips.time = 0;
}

function isCacheValid(entry) {
  return entry.data !== null && (Date.now() - entry.time) < CACHE_TTL_MS;
}

// --- Scanning ---

function scanRecordings() {
  if (isCacheValid(cache.recordings)) return cache.recordings.data;
  const organizedPath = getOrganizedPath();
  const obsPath = getObsPath();
  const recordings = [];
  const seenPaths = new Set();

  if (organizedPath && fs.existsSync(organizedPath)) {
    try {
      for (const entry of fs.readdirSync(organizedPath, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.toLowerCase() === 'clips') continue;
        const folderPath = path.join(organizedPath, entry.name);
        const gameName = entry.name.includes(' - Week of')
          ? entry.name.split(' - Week of')[0]
          : entry.name;
        try {
          for (const file of fs.readdirSync(folderPath)) {
            if (!isVideoFile(file)) continue;
            const fp = path.join(folderPath, file);
            const info = parseRecordingInfo(fp, gameName);
            if (info) { recordings.push(info); seenPaths.add(fp.toLowerCase()); }
          }
        } catch {}
      }
    } catch {}
  }

  // Only include files that match OBS naming patterns, to avoid listing unrelated videos
  const obsFilenamePattern = /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}|^Replay \d{4}-\d{2}-\d{2}|.+ Session \d{4}-\d{2}-\d{2} #\d+/;

  if (obsPath && fs.existsSync(obsPath)) {
    try {
      for (const file of fs.readdirSync(obsPath)) {
        if (!isVideoFile(file)) continue;
        const nameNoExt = file.replace(/\.[^.]+$/, '');
        if (!obsFilenamePattern.test(nameNoExt)) continue;
        const fp = path.join(obsPath, file);
        if (seenPaths.has(fp.toLowerCase())) continue;
        const info = parseRecordingInfo(fp, '(Unorganized)');
        if (info) recordings.push(info);
      }
    } catch {}
  }

  recordings.sort((a, b) => b.mtime - a.mtime);
  cache.recordings.data = recordings;
  cache.recordings.time = Date.now();
  return recordings;
}

function scanClips() {
  if (isCacheValid(cache.clips)) return cache.clips.data;
  const clipsPath = getClipsPath();
  if (!clipsPath || !fs.existsSync(clipsPath)) return [];
  const clips = [];
  try {
    for (const file of fs.readdirSync(clipsPath)) {
      if (!isVideoFile(file)) continue;
      const fp = path.join(clipsPath, file);
      const gameMatch = file.match(/^(.+?) Clip \d{4}-\d{2}-\d{2}/);
      const gameName = gameMatch ? gameMatch[1] : 'Unknown';
      const info = parseRecordingInfo(fp, gameName);
      if (info) clips.push(info);
    }
  } catch {}
  clips.sort((a, b) => b.mtime - a.mtime);
  cache.clips.data = clips;
  cache.clips.time = Date.now();
  return clips;
}

function countClipsForDate(clipsPath, gameName, dateStr) {
  const pattern = `${gameName} Clip ${dateStr} #`;
  let count = 0;
  try {
    for (const f of fs.readdirSync(clipsPath)) {
      if (f.startsWith(pattern)) {
        const m = f.match(/#(\d+)/);
        if (m) count = Math.max(count, parseInt(m[1]));
      }
    }
  } catch {}
  return count;
}

// --- Mutations ---

function createClip(sourcePath, startTime, endTime, gameName = 'Unknown') {
  return new Promise((resolve, reject) => {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return reject(new Error('Source not found'));
    }
    if (endTime <= startTime) {
      return reject(new Error('End time must be > start time'));
    }

    const clipsPath = getClipsPath();
    if (!clipsPath) return reject(new Error('No clips folder'));
    fs.mkdirSync(clipsPath, { recursive: true });

    const dateStr = new Date().toISOString().slice(0, 10);
    const clipNum = countClipsForDate(clipsPath, gameName, dateStr) + 1;
    const outputFilename = `${gameName} Clip ${dateStr} #${clipNum}.mp4`;
    const outputPath = path.join(clipsPath, outputFilename);
    const duration = endTime - startTime;

    exec(
      `ffmpeg -y -ss ${startTime} -i "${sourcePath}" -t ${duration} -c copy -avoid_negative_ts make_zero "${outputPath}"`,
      { timeout: 120000 },
      (error, _stdout, stderr) => {
        if (error) return reject(new Error(`FFmpeg error: ${stderr}`));
        invalidateCache();
        const info = parseRecordingInfo(outputPath, gameName);
        resolve(info || { filename: outputFilename, path: outputPath });
      }
    );
  });
}

function deleteFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    invalidateCache();
    return { success: true };
  } catch (e) {
    if (e.code === 'ENOENT') return { error: 'Not found', status: 404 };
    return { error: e.message, status: 500 };
  }
}

function reencodeVideo(sourcePath, { codec = 'h265', crf = 23, preset = 'medium', replaceOriginal = false, originalSize = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return reject(new Error('Not found'));
    }

    const encoder = CODEC_MAP[codec] || 'libx265';
    const base = sourcePath.replace(/\.[^.]+$/, '');
    const outPath = replaceOriginal ? `${base}_temp.mp4` : `${base}_reencoded_${codec}.mp4`;

    exec(
      `ffmpeg -y -i "${sourcePath}" -c:v ${encoder} -crf ${crf} -preset ${preset} -c:a copy "${outPath}"`,
      { timeout: 600000 },
      (error, _stdout, stderr) => {
        if (error) {
          try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
          return reject(new Error(`FFmpeg error: ${stderr}`));
        }

        let finalPath = outPath;
        if (replaceOriginal) {
          try {
            fs.unlinkSync(sourcePath);
            fs.renameSync(outPath, sourcePath);
            finalPath = sourcePath;
          } catch {}
        }

        invalidateCache();
        const stat = fs.statSync(finalPath);
        const savings = originalSize > 0 ? originalSize - stat.size : 0;
        resolve({
          success: true,
          output_path: finalPath,
          size_bytes: stat.size,
          size_formatted: formatFileSize(stat.size),
          original_size: originalSize,
          savings: Math.max(0, savings),
          savings_formatted: formatFileSize(Math.max(0, savings)),
        });
      }
    );
  });
}

module.exports = {
  init,
  invalidateCache,
  parseRecordingInfo,
  getOrganizedPath,
  getObsPath,
  getClipsPath,
  scanRecordings,
  scanClips,
  countClipsForDate,
  createClip,
  deleteFile,
  reencodeVideo,
};
