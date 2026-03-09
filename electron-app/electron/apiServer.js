/**
 * Local HTTP API server that replicates the Flask recordings_viewer.pyw endpoints.
 * Runs inside Electron's main process on a random port.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, execSync, spawn } = require('child_process');
const { shell } = require('electron');
const url = require('url');

const { MIME_TYPES, MARKERS_FILE, formatFileSize } = require('./constants');
const service = require('./recordingService');

let store; // set in startApiServer

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
  return new Promise((resolve) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 },
      (error, stdout) => {
        if (error) return resolve(null);
        resolve(parseFloat(stdout.trim()) || null);
      }
    );
  });
}

function getDiskUsage(dirPath) {
  return new Promise((resolve) => {
    exec(
      `powershell -Command "(Get-PSDrive -Name (Split-Path '${dirPath.replace(/'/g, "''")}' -Qualifier).TrimEnd(':')) | Select-Object Used, Free | ConvertTo-Json"`,
      { encoding: 'utf-8', timeout: 5000 },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          const d = JSON.parse(stdout);
          const total = d.Used + d.Free;
          resolve({
            total, used: d.Used, free: d.Free,
            total_formatted: formatFileSize(total),
            used_formatted: formatFileSize(d.Used),
            free_formatted: formatFileSize(d.Free),
            percent_used: total > 0 ? (d.Used / total * 100) : 0,
          });
        } catch { resolve(null); }
      }
    );
  });
}

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

function isAllowedPath(filePath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  const roots = [
    store.get('settings.obsRecordingPath'),
    store.get('settings.destinationPath'),
  ].filter(Boolean).map(p => path.resolve(p));
  return roots.some(base => resolved === base || resolved.startsWith(base + path.sep));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      body += chunk;
    });
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
  service.init(appStore);

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
        return json(res, service.scanRecordings());
      }

      // GET /api/clips
      if (pathname === '/api/clips' && req.method === 'GET') {
        return json(res, service.scanClips());
      }

      // GET /api/video?path=...
      if (pathname === '/api/video' && req.method === 'GET') {
        const filePath = query.path;
        if (!filePath) return json(res, { error: 'File not found' }, 404);
        if (!isAllowedPath(filePath)) return json(res, { error: 'Forbidden' }, 403);

        let stat;
        try { stat = fs.statSync(filePath); }
        catch { return json(res, { error: 'File not found' }, 404); }

        const ext = path.extname(filePath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || 'video/mp4';
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
        const { source_path, start_time, end_time, game_name = 'Unknown', audio_tracks = null } = data;
        try {
          const result = await service.createClip(source_path, start_time, end_time, game_name, audio_tracks);
          return json(res, result);
        } catch (e) {
          const status = e.message.includes('not found') ? 404 : e.message.includes('End time') ? 400 : 500;
          return json(res, { error: e.message }, status);
        }
      }

      // POST /api/clips/delete or /api/delete
      if ((pathname === '/api/clips/delete' || pathname === '/api/delete') && req.method === 'POST') {
        const data = await readBody(req);
        if (!data.path) return json(res, { error: 'Not found' }, 404);
        if (!isAllowedPath(data.path)) return json(res, { error: 'Forbidden' }, 403);
        const result = service.deleteFile(data.path);
        return json(res, result, result.status || 200);
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
        if (!filePath) return json(res, { error: 'Not found' }, 404);

        let stat;
        try { stat = fs.statSync(filePath); }
        catch { return json(res, { error: 'Not found' }, 404); }

        const duration = await getVideoDuration(filePath);
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
        const recordings = service.scanRecordings();
        const clips = service.scanClips();
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
        const orgPath = service.getOrganizedPath();
        if (orgPath && fs.existsSync(orgPath)) {
          diskUsage = await getDiskUsage(orgPath);
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
          const result = service.deleteFile(p);
          if (result.success) deleted.push(p);
          else failed.push({ path: p, error: result.error });
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
        const { source_path, codec = 'h265', crf = 23, preset = 'medium', replace_original = false, original_size = 0, audio_tracks = null } = data;
        if (!isAllowedPath(source_path)) return json(res, { error: 'Forbidden' }, 403);
        try {
          const result = await service.reencodeVideo(source_path, {
            codec, crf, preset,
            replaceOriginal: replace_original,
            originalSize: original_size,
            audioTracks: audio_tracks,
          });
          return json(res, result);
        } catch (e) {
          const status = e.message.includes('Not found') ? 404 : 500;
          return json(res, { error: e.message }, status);
        }
      }

      // GET /api/video/tracks?path=...
      if (pathname === '/api/video/tracks' && req.method === 'GET') {
        const filePath = query.path;
        if (!filePath || !isAllowedPath(filePath)) return json(res, { error: 'Forbidden' }, 403);
        if (!fs.existsSync(filePath)) return json(res, { error: 'File not found' }, 404);
        // Load sidecar track names if present (written during MKV→MP4 remux)
        let sidecarNames = null;
        try {
          sidecarNames = JSON.parse(fs.readFileSync(filePath + '.tracks.json', 'utf-8'));
        } catch {}
        return new Promise((resolve) => {
          exec(
            `ffprobe -v error -show_streams -select_streams a -of json "${filePath}"`,
            { encoding: 'utf-8', timeout: 10000 },
            (error, stdout) => {
              if (error) { resolve(json(res, { tracks: [] })); return; }
              try {
                const data = JSON.parse(stdout);
                const tracks = (data.streams || []).map((s, i) => ({
                  index: i,
                  stream_index: s.index ?? i,
                  codec_name: s.codec_name || 'unknown',
                  channels: s.channels || 0,
                  channel_layout: s.channel_layout || '',
                  sample_rate: s.sample_rate || '',
                  title: sidecarNames?.[i] || s.tags?.title || s.tags?.TITLE || `Track ${i + 1}`,
                }));
                resolve(json(res, { tracks }));
              } catch { resolve(json(res, { tracks: [] })); }
            }
          );
        });
      }

      // GET /api/video/waveform?path=...&track=0
      if (pathname === '/api/video/waveform' && req.method === 'GET') {
        const filePath = query.path;
        const rawTrack = parseInt(query.track, 10);
        if (isNaN(rawTrack) || rawTrack < 0) return json(res, { error: 'Invalid track index' }, 400);
        const trackIndex = rawTrack;
        if (!filePath || !isAllowedPath(filePath)) return json(res, { error: 'Forbidden' }, 403);
        if (!fs.existsSync(filePath)) return json(res, { error: 'File not found' }, 404);

        return new Promise((resolve) => {
          getVideoDuration(filePath).then(duration => {
            if (!duration) { resolve(json(res, { peaks: [] })); return; }

            const NUM_PEAKS = 2000;
            const sampleRate = Math.max(2, Math.round(NUM_PEAKS / duration));

            const ffmpegProc = spawn('ffmpeg', [
              '-hide_banner', '-loglevel', 'error',
              '-i', filePath,
              '-map', `0:a:${trackIndex}`,
              '-ac', '1',
              '-ar', String(sampleRate),
              '-f', 'f32le',
              'pipe:1'
            ]);

            req.on('close', () => ffmpegProc.kill());
            ffmpegProc.stderr.resume(); // drain stderr so the pipe buffer never fills

            const chunks = [];
            ffmpegProc.stdout.on('data', chunk => chunks.push(chunk));
            ffmpegProc.on('close', () => {
              try {
                const buffer = Buffer.concat(chunks);
                const samples = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 4));
                if (!samples.length) { resolve(json(res, { peaks: [] })); return; }

                const chunkSize = Math.max(1, Math.ceil(samples.length / NUM_PEAKS));
                const peaks = [];
                for (let i = 0; i < samples.length && peaks.length < NUM_PEAKS; i += chunkSize) {
                  let max = 0;
                  for (let j = i; j < Math.min(i + chunkSize, samples.length); j++) {
                    const v = Math.abs(samples[j]);
                    if (v > max) max = v;
                  }
                  peaks.push(max);
                }
                const maxPeak = peaks.reduce((m, p) => p > m ? p : m, 0.001);
                resolve(json(res, { peaks: peaks.map(p => p / maxPeak), duration }));
              } catch { resolve(json(res, { peaks: [] })); }
            });
            ffmpegProc.on('error', () => resolve(json(res, { peaks: [] })));
          });
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
      if (e.message === 'Payload too large') {
        json(res, { error: 'Payload too large' }, 413);
      } else {
        json(res, { error: e.message }, 500);
      }
    }
  });

  // In dev mode use a fixed port so vite proxy can reach us; otherwise random
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  const listenPort = isDev ? 47531 : 0;
  server.listen(listenPort, '127.0.0.1', () => {
    const port = server.address().port;
    console.log(`API server listening on http://127.0.0.1:${port}`);
  });

  return server;
}

module.exports = { startApiServer };
