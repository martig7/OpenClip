/**
 * Local HTTP API server that replicates the Flask recordings_viewer.pyw endpoints.
 * Runs inside Electron's main process on a random port.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const { shell } = require('electron');
const url = require('url');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.flv', '.mov', '.avi', '.ts']);
const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.flv': 'video/x-flv',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
};

const SCRIPT_DIR = path.join(__dirname, '..', '..');
const RUNTIME_DIR = path.join(SCRIPT_DIR, 'runtime');
const MARKERS_FILE = path.join(RUNTIME_DIR, 'clip_markers.json');

let store; // set in startApiServer

function formatFileSize(bytes) {
  for (const unit of ['B', 'KB', 'MB', 'GB']) {
    if (bytes < 1024) return `${bytes.toFixed(1)} ${unit}`;
    bytes /= 1024;
  }
  return `${bytes.toFixed(1)} TB`;
}

function loadMarkers() {
  try {
    return JSON.parse(fs.readFileSync(MARKERS_FILE, 'utf-8'));
  } catch {}
  return { markers: [] };
}

function saveMarkers(data) {
  try {
    fs.writeFileSync(MARKERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch { return false; }
}

function getVideoDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    return parseFloat(result.trim());
  } catch { return null; }
}

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

function getObsRecordingPath() {
  const { readOBSRecordingPath } = require('./obsIntegration');
  return readOBSRecordingPath();
}

function getOrganizedPath() {
  return store.get('settings.destinationPath') || '';
}

function getClipsPath() {
  const org = getOrganizedPath() || getObsRecordingPath();
  return org ? path.join(org, 'Clips') : null;
}

function scanRecordings() {
  const organizedPath = getOrganizedPath();
  const obsPath = store.get('settings.obsRecordingPath') || getObsRecordingPath();
  const recordings = [];
  const seenPaths = new Set();

  if (organizedPath && fs.existsSync(organizedPath)) {
    try {
      for (const folder of fs.readdirSync(organizedPath)) {
        if (folder.toLowerCase() === 'clips') continue;
        const folderPath = path.join(organizedPath, folder);
        if (!fs.statSync(folderPath).isDirectory()) continue;
        const gameName = folder.includes(' - Week of') ? folder.split(' - Week of')[0] : folder;
        try {
          for (const file of fs.readdirSync(folderPath)) {
            if (!VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
            const fp = path.join(folderPath, file);
            const info = parseRecordingInfo(fp, gameName);
            if (info) { recordings.push(info); seenPaths.add(fp.toLowerCase()); }
          }
        } catch {}
      }
    } catch {}
  }

  if (obsPath && fs.existsSync(obsPath)) {
    try {
      for (const file of fs.readdirSync(obsPath)) {
        if (!VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
        const fp = path.join(obsPath, file);
        if (seenPaths.has(fp.toLowerCase())) continue;
        const info = parseRecordingInfo(fp, '(Unorganized)');
        if (info) recordings.push(info);
      }
    } catch {}
  }

  recordings.sort((a, b) => b.mtime - a.mtime);
  return recordings;
}

function scanClips() {
  const clipsPath = getClipsPath();
  if (!clipsPath || !fs.existsSync(clipsPath)) return [];
  const clips = [];
  try {
    for (const file of fs.readdirSync(clipsPath)) {
      if (!VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      const fp = path.join(clipsPath, file);
      const gameMatch = file.match(/^(.+?) Clip \d{4}-\d{2}-\d{2}/);
      const gameName = gameMatch ? gameMatch[1] : 'Unknown';
      const info = parseRecordingInfo(fp, gameName);
      if (info) clips.push(info);
    }
  } catch {}
  clips.sort((a, b) => b.mtime - a.mtime);
  return clips;
}

function countClipsForDate(clipsPath, gameName, dateStr) {
  const pattern = `${gameName} Clip ${dateStr} #`;
  let count = 0;
  if (fs.existsSync(clipsPath)) {
    for (const f of fs.readdirSync(clipsPath)) {
      if (f.startsWith(pattern)) {
        const m = f.match(/#(\d+)/);
        if (m) count = Math.max(count, parseInt(m[1]));
      }
    }
  }
  return count;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function startApiServer(appStore) {
  store = appStore;

  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const query = parsed.query;

    try {
      // GET /api/recordings
      if (pathname === '/api/recordings' && req.method === 'GET') {
        return json(res, scanRecordings());
      }

      // GET /api/clips
      if (pathname === '/api/clips' && req.method === 'GET') {
        return json(res, scanClips());
      }

      // GET /api/video?path=...
      if (pathname === '/api/video' && req.method === 'GET') {
        const filePath = query.path;
        if (!filePath || !fs.existsSync(filePath)) {
          return json(res, { error: 'File not found' }, 404);
        }
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || 'video/mp4';
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
          const match = range.match(/bytes=(\d+)-(\d*)/);
          const start = parseInt(match[1]);
          const end = match[2] ? parseInt(match[2]) : fileSize - 1;
          const contentLength = end - start + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': contentLength,
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            'Accept-Ranges': 'bytes',
            'Content-Length': fileSize,
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
          });
          fs.createReadStream(filePath).pipe(res);
        }
        return;
      }

      // POST /api/clips/create
      if (pathname === '/api/clips/create' && req.method === 'POST') {
        const data = await readBody(req);
        const { source_path, start_time, end_time, game_name = 'Unknown' } = data;
        if (!source_path || !fs.existsSync(source_path)) return json(res, { error: 'Source not found' }, 404);
        if (end_time <= start_time) return json(res, { error: 'End time must be > start time' }, 400);

        const clipsPath = getClipsPath();
        if (!clipsPath) return json(res, { error: 'No clips folder' }, 500);
        if (!fs.existsSync(clipsPath)) fs.mkdirSync(clipsPath, { recursive: true });

        const dateStr = new Date().toISOString().slice(0, 10);
        const clipNum = countClipsForDate(clipsPath, game_name, dateStr) + 1;
        const outputFilename = `${game_name} Clip ${dateStr} #${clipNum}.mp4`;
        const outputPath = path.join(clipsPath, outputFilename);
        const duration = end_time - start_time;

        return new Promise((resolve) => {
          exec(
            `ffmpeg -y -ss ${start_time} -i "${source_path}" -t ${duration} -c copy -avoid_negative_ts make_zero "${outputPath}"`,
            { timeout: 120000 },
            (error, stdout, stderr) => {
              if (error) { json(res, { error: `FFmpeg error: ${stderr}` }, 500); }
              else {
                const info = parseRecordingInfo(outputPath, game_name);
                json(res, info || { filename: outputFilename, path: outputPath });
              }
              resolve();
            }
          );
        });
      }

      // POST /api/clips/delete or /api/delete
      if ((pathname === '/api/clips/delete' || pathname === '/api/delete') && req.method === 'POST') {
        const data = await readBody(req);
        if (!data.path) return json(res, { error: 'Not found' }, 404);
        try { fs.unlinkSync(data.path); return json(res, { success: true }); }
        catch (e) {
          if (e.code === 'ENOENT') return json(res, { error: 'Not found' }, 404);
          return json(res, { error: e.message }, 500);
        }
      }

      // POST /api/open-external
      if (pathname === '/api/open-external' && req.method === 'POST') {
        const data = await readBody(req);
        if (data.path) shell.openPath(data.path);
        return json(res, { success: true });
      }

      // POST /api/show-in-explorer
      if (pathname === '/api/show-in-explorer' && req.method === 'POST') {
        const data = await readBody(req);
        if (data.path) shell.showItemInFolder(data.path);
        return json(res, { success: true });
      }

      // GET /api/markers
      if (pathname === '/api/markers' && req.method === 'GET') {
        const filePath = query.path;
        const gameName = query.game_name;
        if (!filePath || !fs.existsSync(filePath)) return json(res, { error: 'Not found' }, 404);
        const stat = fs.statSync(filePath);
        const duration = getVideoDuration(filePath);
        if (!duration) return json(res, { markers: [], error: 'Could not get duration' });
        const fileMtime = stat.mtimeMs / 1000;
        const recordingStart = fileMtime - duration;
        const markersData = loadMarkers();
        const matching = [];
        for (const m of markersData.markers || []) {
          if (m.game_name === gameName) {
            const mt = m.timestamp || 0;
            if (mt >= recordingStart && mt <= fileMtime) {
              matching.push({ position: mt - recordingStart, timestamp: mt, created_at: m.created_at || '' });
            }
          }
        }
        matching.sort((a, b) => a.position - b.position);
        return json(res, { markers: matching, duration });
      }

      // POST /api/markers/delete
      if (pathname === '/api/markers/delete' && req.method === 'POST') {
        const data = await readBody(req);
        const markersData = loadMarkers();
        const before = markersData.markers.length;
        markersData.markers = markersData.markers.filter(m => m.timestamp !== data.timestamp);
        if (markersData.markers.length < before) { saveMarkers(markersData); return json(res, { success: true }); }
        return json(res, { error: 'Not found' }, 404);
      }

      // GET /api/storage/stats
      if (pathname === '/api/storage/stats' && req.method === 'GET') {
        const recordings = scanRecordings();
        const clips = scanClips();
        const lockedRecordings = store.get('lockedRecordings') || [];
        const totalRecSize = recordings.reduce((s, r) => s + r.size_bytes, 0);
        const totalClipSize = clips.reduce((s, c) => s + c.size_bytes, 0);
        const totalSize = totalRecSize + totalClipSize;
        const games = {};
        for (const r of recordings) {
          if (!games[r.game_name]) games[r.game_name] = { recordings: [], clips: [], total_size: 0 };
          games[r.game_name].recordings.push(r);
          games[r.game_name].total_size += r.size_bytes;
        }
        for (const c of clips) {
          if (!games[c.game_name]) games[c.game_name] = { recordings: [], clips: [], total_size: 0 };
          games[c.game_name].clips.push(c);
          games[c.game_name].total_size += c.size_bytes;
        }
        let diskUsage = null;
        const orgPath = getOrganizedPath();
        if (orgPath && fs.existsSync(orgPath)) {
          try {
            const out = execSync(`powershell -Command "(Get-PSDrive -Name (Split-Path '${orgPath.replace(/'/g, "''")}' -Qualifier).TrimEnd(':')) | Select-Object Used, Free | ConvertTo-Json"`, { encoding: 'utf-8', timeout: 5000 });
            const d = JSON.parse(out);
            const total = d.Used + d.Free;
            diskUsage = {
              total, used: d.Used, free: d.Free,
              total_formatted: formatFileSize(total), used_formatted: formatFileSize(d.Used), free_formatted: formatFileSize(d.Free),
              percent_used: total > 0 ? (d.Used / total * 100) : 0,
            };
          } catch {}
        }
        return json(res, {
          recordings, clips, total_size: totalSize, total_size_formatted: formatFileSize(totalSize),
          recording_size: totalRecSize, recording_size_formatted: formatFileSize(totalRecSize),
          clip_size: totalClipSize, clip_size_formatted: formatFileSize(totalClipSize),
          recording_count: recordings.length, clip_count: clips.length,
          games, disk_usage: diskUsage, locked_recordings: lockedRecordings,
        });
      }

      // GET/POST /api/storage/settings
      if (pathname === '/api/storage/settings') {
        if (req.method === 'POST') {
          const data = await readBody(req);
          if (data.storage_settings) store.set('storageSettings', data.storage_settings);
          return json(res, { success: true, settings: store.get('storageSettings') || {} });
        }
        return json(res, store.get('storageSettings') || {
          auto_delete_enabled: false, max_storage_gb: 100, max_age_days: 30, exclude_clips: true,
        });
      }

      // POST /api/storage/lock
      if (pathname === '/api/storage/lock' && req.method === 'POST') {
        const data = await readBody(req);
        const locked = store.get('lockedRecordings') || [];
        const normalized = path.normalize(data.path);
        if (data.locked) {
          if (!locked.includes(normalized)) locked.push(normalized);
        } else {
          const idx = locked.indexOf(normalized);
          if (idx >= 0) locked.splice(idx, 1);
        }
        store.set('lockedRecordings', locked);
        return json(res, { success: true, locked: data.locked });
      }

      // POST /api/storage/delete-batch
      if (pathname === '/api/storage/delete-batch' && req.method === 'POST') {
        const data = await readBody(req);
        const paths = data.paths || [];
        const locked = (store.get('lockedRecordings') || []).map(p => path.normalize(p));
        const deleted = [], failed = [], skippedLocked = [];
        for (const p of paths) {
          if (locked.includes(path.normalize(p))) { skippedLocked.push(p); continue; }
          try {
            if (fs.existsSync(p)) { fs.unlinkSync(p); deleted.push(p); }
            else failed.push({ path: p, error: 'Not found' });
          } catch (e) { failed.push({ path: p, error: e.message }); }
        }
        return json(res, {
          success: true, deleted, deleted_count: deleted.length,
          failed, failed_count: failed.length,
          skipped_locked: skippedLocked, skipped_locked_count: skippedLocked.length,
        });
      }

      // POST /api/reencode
      if (pathname === '/api/reencode' && req.method === 'POST') {
        const data = await readBody(req);
        const { source_path, codec = 'h265', crf = 23, preset = 'medium', replace_original = false, original_size = 0 } = data;
        if (!source_path || !fs.existsSync(source_path)) return json(res, { error: 'Not found' }, 404);
        const codecMap = { h264: 'libx264', h265: 'libx265', av1: 'libsvtav1' };
        const encoder = codecMap[codec] || 'libx265';
        const base = source_path.replace(/\.[^.]+$/, '');
        const outPath = replace_original ? `${base}_temp.mp4` : `${base}_reencoded_${codec}.mp4`;
        return new Promise((resolve) => {
          exec(
            `ffmpeg -y -i "${source_path}" -c:v ${encoder} -crf ${crf} -preset ${preset} -c:a copy "${outPath}"`,
            { timeout: 600000 },
            (error, stdout, stderr) => {
              if (error) {
                try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
                json(res, { error: `FFmpeg error: ${stderr}` }, 500);
              } else {
                let finalPath = outPath;
                if (replace_original) {
                  try { fs.unlinkSync(source_path); fs.renameSync(outPath, source_path); finalPath = source_path; } catch {}
                }
                const stat = fs.statSync(finalPath);
                const savings = original_size > 0 ? original_size - stat.size : 0;
                json(res, {
                  success: true, output_path: finalPath,
                  size_bytes: stat.size, size_formatted: formatFileSize(stat.size),
                  original_size, savings: Math.max(0, savings),
                  savings_formatted: formatFileSize(Math.max(0, savings)),
                });
              }
              resolve();
            }
          );
        });
      }

      // GET /api/ffmpeg-check
      if (pathname === '/api/ffmpeg-check' && req.method === 'GET') {
        try { execSync('ffmpeg -version', { timeout: 5000 }); return json(res, { available: true }); }
        catch { return json(res, { available: false }); }
      }

      // 404
      json(res, { error: 'Not found' }, 404);

    } catch (e) {
      json(res, { error: e.message }, 500);
    }
  });

  // Listen on random port
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    console.log(`API server listening on http://127.0.0.1:${port}`);
  });

  return server;
}

module.exports = { startApiServer };
