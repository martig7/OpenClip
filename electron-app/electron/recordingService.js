/**
 * Canonical implementation of recording/clip scanning, clip creation,
 * deletion, and reencoding. Both apiServer.js and fileManager.js delegate here.
 */
const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');
const { isVideoFile, formatFileSize, CODEC_MAP, FFMPEG_PATH } = require('./constants');

let store; // set via init()

function init(appStore) {
  store = appStore;
}

// --- FFmpeg process tracking (item 6) ---

// Map<ChildProcess, outputPath|null> — outputPath is deleted on kill if it exists
const activeFFmpeg = new Map();

function killAllProcesses() {
  for (const [proc, outPath] of activeFFmpeg) {
    try { proc.kill(); } catch {}
    if (outPath) try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
  }
  activeFFmpeg.clear();
}

// --- In-progress remux tracking ---
// Paths currently being read or written by organizeRecordings are hidden from scans
// to prevent file-access errors and duplicate entries while ffmpeg is running.
const activeRemuxPaths = new Set();

function markRemuxing(srcPath, destPath) {
  activeRemuxPaths.add(path.normalize(srcPath).toLowerCase());
  if (destPath) activeRemuxPaths.add(path.normalize(destPath).toLowerCase());
}

function unmarkRemuxing(srcPath, destPath) {
  activeRemuxPaths.delete(path.normalize(srcPath).toLowerCase());
  if (destPath) activeRemuxPaths.delete(path.normalize(destPath).toLowerCase());
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
            if (activeRemuxPaths.has(path.normalize(fp).toLowerCase())) continue;
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
        if (activeRemuxPaths.has(path.normalize(fp).toLowerCase())) continue;
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

function buildAudioMapArgs(audioTracks) {
  // Returns FFmpeg args array for selective audio track mapping.
  // audioTracks: array of 0-based audio stream indices, or null/undefined for all.
  if (!Array.isArray(audioTracks) || audioTracks.length === 0) return [];
  return ['-map', '0:v:0', ...audioTracks.map(i => ['-map', `0:a:${i}`]).flat()];
}

function createClip(sourcePath, startTime, endTime, gameName = 'Unknown', audioTracks = null) {
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

    // Build audio args: when multiple specific tracks are selected, produce:
    //   Track 1: amix of all selected tracks (for universal playback)
    //   Track 2+: each selected track individually (preserving original order/titles)
    let audioArgs, codecArgs;
    if (!Array.isArray(audioTracks) || audioTracks.length === 0) {
      // No specific tracks requested – explicitly map all streams to preserve them all
      audioArgs = ['-map', '0'];
      codecArgs = ['-c', 'copy'];
    } else if (audioTracks.length === 1) {
      // Single track – map it directly, stream copy is fine
      audioArgs = ['-map', '0:v:0', '-map', `0:a:${audioTracks[0]}`];
      codecArgs = ['-c', 'copy'];
    } else {
      // Multiple tracks – mix into one combined track, then keep individual tracks
      const filterInputs = audioTracks.map(i => `[0:a:${i}]`).join('');
      const filterComplex = `${filterInputs}amix=inputs=${audioTracks.length}:duration=longest:normalize=0[mixed]`;
      const individualMaps = audioTracks.map(i => ['-map', `0:a:${i}`]).flat();
      audioArgs = ['-map', '0:v:0', '-filter_complex', filterComplex, '-map', '[mixed]', ...individualMaps];
      codecArgs = ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k'];
    }

    const args = [
      '-y', '-ss', String(startTime), '-i', sourcePath,
      '-t', String(duration), ...audioArgs, ...codecArgs,
      '-avoid_negative_ts', 'make_zero', outputPath,
    ];

    const proc = execFile(FFMPEG_PATH, args, { timeout: 120000 },
      (error, _stdout, stderr) => {
        activeFFmpeg.delete(proc);
        if (error) return reject(new Error(`FFmpeg error: ${stderr || error.message}`));
        cache.clips.data = null;
        cache.clips.time = 0;
        const info = parseRecordingInfo(outputPath, gameName);
        resolve(info || { filename: outputFilename, path: outputPath });
      }
    );
    activeFFmpeg.set(proc, outputPath);
  });
}

function deleteFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    try { fs.unlinkSync(filePath + '.tracks.json'); } catch {}
    invalidateCache();
    return { success: true };
  } catch (e) {
    if (e.code === 'ENOENT') return { error: 'Not found', status: 404 };
    return { error: e.message, status: 500 };
  }
}

const VALID_PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']);

function reencodeVideo(sourcePath, { codec = 'h265', crf = 23, preset = 'medium', replaceOriginal = false, originalSize = 0, audioTracks = null } = {}) {
  return new Promise((resolve, reject) => {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return reject(new Error('Not found'));
    }

    const encoder = CODEC_MAP[codec] || 'libx265';
    const safeCrf = Math.max(0, Math.min(51, Math.round(Number(crf) || 23)));
    const safePreset = VALID_PRESETS.has(preset) ? preset : 'medium';
    const base = sourcePath.replace(/\.[^.]+$/, '');
    const outPath = replaceOriginal ? `${base}_temp.mp4` : `${base}_reencoded_${codec}.mp4`;
    const mapArgsList = buildAudioMapArgs(audioTracks);

    const args = [
      '-y', '-i', sourcePath,
      ...mapArgsList,
      '-c:v', encoder, '-crf', String(safeCrf), '-preset', safePreset,
      '-c:a', 'copy', outPath,
    ];

    const proc = execFile(FFMPEG_PATH, args, { timeout: 600000 },
      (error, _stdout, stderr) => {
        activeFFmpeg.delete(proc);
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
    activeFFmpeg.set(proc, outPath);
  });
}

/**
 * Run the auto-delete pass. Called on watcher start.
 * Deletes unlocked recordings (and clips if not excluded) that are:
 *   1. Older than max_age_days, OR
 *   2. Pushing total storage over max_storage_gb (oldest deleted first).
 * Returns a summary { deleted, skipped, errors }.
 */
function runAutoDelete() {
  const settings = store.get('storageSettings') || {};
  if (!settings.auto_delete_enabled) return { deleted: 0, skipped: 0, errors: 0 };

  const maxBytes   = (settings.max_storage_gb ?? 100) * 1024 ** 3;
  const maxAgeMs   = (settings.max_age_days   ?? 30)  * 24 * 60 * 60 * 1000;
  const excClips   = settings.exclude_clips !== false;
  const locked     = new Set(
    (store.get('lockedRecordings') || []).map(p => path.normalize(p).toLowerCase())
  );

  // Gather candidates — recordings always included, clips only if not excluded
  let candidates = [...scanRecordings()];
  if (!excClips) candidates = candidates.concat(scanClips());

  // Remove locked files
  candidates = candidates.filter(f => !locked.has(path.normalize(f.path).toLowerCase()));

  // Sort oldest first for size-based trimming
  candidates.sort((a, b) => a.mtime - b.mtime);

  const nowMs     = Date.now();
  const toDelete  = new Set();

  // Pass 1: age-based — mark anything older than max_age_days
  for (const f of candidates) {
    if (nowMs - f.mtime * 1000 > maxAgeMs) toDelete.add(f.path);
  }

  // Pass 2: size-based — if still over limit after age deletions, trim oldest first
  const remaining = candidates.filter(f => !toDelete.has(f.path));
  let totalBytes  = remaining.reduce((s, f) => s + f.size_bytes, 0);
  for (const f of remaining) {
    if (totalBytes <= maxBytes) break;
    toDelete.add(f.path);
    totalBytes -= f.size_bytes;
  }

  let deleted = 0, errors = 0;
  for (const filePath of toDelete) {
    const result = deleteFile(filePath);
    if (result.success) deleted++;
    else errors++;
  }

  return { deleted, skipped: locked.size, errors };
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
  runAutoDelete,
  killAllProcesses,
  markRemuxing,
  unmarkRemuxing,
};
