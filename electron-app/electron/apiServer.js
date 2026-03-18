/**
 * Local HTTP API server that replicates the Flask recordings_viewer.pyw endpoints.
 * Runs inside Electron's main process on a random port.
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { exec, execFile, spawn } = require('child_process')
const { shell } = require('electron')
const url = require('url')

const { MIME_TYPES, formatFileSize, FFMPEG_PATH, FFPROBE_PATH, CODEC_MAP } = require('./constants')
const service = require('./recordingService')
const { loadMarkers, saveMarkers } = require('./markerService')
const { getVideoDuration, getDiskUsage } = require('./videoMetadata')
const waveformCache = require('./waveformCache')
const waveformQueue = require('./waveformQueue')

let store // set in startApiServer

const MAX_BODY_SIZE = 1024 * 1024 // 1 MB

function isAllowedPath(filePath) {
  if (!filePath) return false
  const resolved = path.resolve(filePath)
  const roots = [store.get('settings.obsRecordingPath'), store.get('settings.destinationPath')]
    .filter(Boolean)
    .map((p) => path.resolve(p))
  return roots.some((base) => resolved === base || resolved.startsWith(base + path.sep))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) {
        req.destroy()
        reject(new Error('Payload too large'))
        return
      }
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        resolve({})
      }
    })
  })
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

async function readWaveformFromCache(datFilePath, trackIndex = 0) {
  const buffer = fs.readFileSync(datFilePath)

  const version = buffer.readInt32LE(0)

  let offset = 4
  let flags, sampleRate, samplesPerPixel, length, channels

  if (version === 1) {
    flags = buffer.readUInt32LE(4)
    sampleRate = buffer.readInt32LE(8)
    samplesPerPixel = buffer.readInt32LE(12)
    length = buffer.readUInt32LE(16)
    channels = 1
    offset = 20
  } else if (version === 2) {
    flags = buffer.readUInt32LE(4)
    sampleRate = buffer.readInt32LE(8)
    samplesPerPixel = buffer.readInt32LE(12)
    length = buffer.readUInt32LE(16)
    channels = buffer.readInt32LE(20)
    offset = 24
  } else {
    throw new Error(`Unsupported waveform format version: ${version}`)
  }

  const is8Bit = (flags & 1) === 1

  const peaks = []
  for (let i = 0; i < length; i++) {
    if (trackIndex < channels) {
      const channelOffset = trackIndex * (is8Bit ? 1 : 2)
      let minVal, maxVal

      if (is8Bit) {
        minVal = buffer.readInt8(offset + i * 2 * channels + channelOffset)
        maxVal = buffer.readInt8(offset + i * 2 * channels + channelOffset + 1)
      } else {
        minVal = buffer.readInt16LE(offset + i * 2 * channels * 2 + channelOffset * 2)
        maxVal = buffer.readInt16LE(
          offset + i * 2 * channels * 2 + channelOffset * 2 + (is8Bit ? 1 : 2)
        )
      }

      const amplitude = Math.max(Math.abs(minVal), Math.abs(maxVal))
      const normalized = is8Bit ? (amplitude + 128) / 255 : (amplitude + 32768) / 65535
      peaks.push(Math.min(1, Math.max(0, normalized)))
    }
  }

  return peaks
}

function startApiServer(appStore) {
  store = appStore
  service.init(appStore)

  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      return res.end()
    }

    const parsed = url.parse(req.url, true)
    const pathname = parsed.pathname
    const query = parsed.query

    try {
      // GET /api/recordings
      if (pathname === '/api/recordings' && req.method === 'GET') {
        return json(res, service.scanRecordings())
      }

      // GET /api/clips
      if (pathname === '/api/clips' && req.method === 'GET') {
        return json(res, service.scanClips())
      }

      // GET /api/video?path=...
      if (pathname === '/api/video' && req.method === 'GET') {
        const filePath = query.path
        if (!filePath) return json(res, { error: 'File not found' }, 404)
        if (!isAllowedPath(filePath)) return json(res, { error: 'Forbidden' }, 403)

        let stat
        try {
          stat = fs.statSync(filePath)
        } catch {
          return json(res, { error: 'File not found' }, 404)
        }

        const ext = path.extname(filePath).toLowerCase()
        const mimeType = MIME_TYPES[ext] || 'video/mp4'
        const fileSize = stat.size
        const range = req.headers.range

        if (range) {
          const match = range.match(/bytes=(\d+)-(\d*)/)
          const start = parseInt(match[1])
          const end = match[2] ? parseInt(match[2]) : fileSize - 1
          const contentLength = end - start + 1
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': contentLength,
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
        } else {
          res.writeHead(200, {
            'Accept-Ranges': 'bytes',
            'Content-Length': fileSize,
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
          })
          fs.createReadStream(filePath).pipe(res)
        }
        return
      }

      // POST /api/clips/create
      if (pathname === '/api/clips/create' && req.method === 'POST') {
        const data = await readBody(req)
        const {
          source_path,
          start_time,
          end_time,
          game_name = 'Unknown',
          audio_tracks = null,
        } = data
        try {
          const result = await service.createClip(
            source_path,
            start_time,
            end_time,
            game_name,
            audio_tracks
          )
          return json(res, result)
        } catch (e) {
          const status = e.message.includes('not found')
            ? 404
            : e.message.includes('End time')
              ? 400
              : 500
          return json(res, { error: e.message }, status)
        }
      }

      // POST /api/clips/delete or /api/delete
      if (
        (pathname === '/api/clips/delete' || pathname === '/api/delete') &&
        req.method === 'POST'
      ) {
        const data = await readBody(req)
        if (!data.path) return json(res, { error: 'Not found' }, 404)
        if (!isAllowedPath(data.path)) return json(res, { error: 'Forbidden' }, 403)
        const result = service.deleteFile(data.path)
        return json(res, result, result.status || 200)
      }

      // POST /api/open-external
      if (pathname === '/api/open-external' && req.method === 'POST') {
        const data = await readBody(req)
        if (data.path) shell.openPath(data.path)
        return json(res, { success: true })
      }

      // POST /api/show-in-explorer
      if (pathname === '/api/show-in-explorer' && req.method === 'POST') {
        const data = await readBody(req)
        if (data.path) shell.showItemInFolder(data.path)
        return json(res, { success: true })
      }

      // GET /api/markers
      if (pathname === '/api/markers' && req.method === 'GET') {
        const filePath = query.path
        const gameName = query.game_name
        if (!filePath) return json(res, { error: 'Not found' }, 404)

        let stat
        try {
          stat = fs.statSync(filePath)
        } catch {
          return json(res, { error: 'Not found' }, 404)
        }

        const duration = await getVideoDuration(filePath)
        if (!duration) return json(res, { markers: [], error: 'Could not get duration' })
        const fileMtime = stat.mtimeMs / 1000
        const recordingStart = fileMtime - duration
        const markersData = loadMarkers()
        const matching = []
        for (const m of markersData.markers || []) {
          if (m.game_name === gameName) {
            const mt = m.timestamp || 0
            if (mt >= recordingStart && mt <= fileMtime) {
              matching.push({
                position: mt - recordingStart,
                timestamp: mt,
                created_at: m.created_at || '',
              })
            }
          }
        }
        matching.sort((a, b) => a.position - b.position)
        return json(res, { markers: matching, duration })
      }

      // POST /api/markers/delete
      if (pathname === '/api/markers/delete' && req.method === 'POST') {
        const data = await readBody(req)
        const markersData = loadMarkers()
        const before = markersData.markers.length
        markersData.markers = markersData.markers.filter((m) => m.timestamp !== data.timestamp)
        if (markersData.markers.length < before) {
          saveMarkers(markersData)
          return json(res, { success: true })
        }
        return json(res, { error: 'Not found' }, 404)
      }

      // GET /api/storage/stats
      if (pathname === '/api/storage/stats' && req.method === 'GET') {
        const recordings = service.scanRecordings()
        const clips = service.scanClips()
        const lockedRecordings = store.get('lockedRecordings') || []
        const totalRecSize = recordings.reduce((s, r) => s + r.size_bytes, 0)
        const totalClipSize = clips.reduce((s, c) => s + c.size_bytes, 0)
        const totalSize = totalRecSize + totalClipSize
        const games = {}
        for (const r of recordings) {
          if (!games[r.game_name]) games[r.game_name] = { recordings: [], clips: [], total_size: 0 }
          games[r.game_name].recordings.push(r)
          games[r.game_name].total_size += r.size_bytes
        }
        for (const c of clips) {
          if (!games[c.game_name]) games[c.game_name] = { recordings: [], clips: [], total_size: 0 }
          games[c.game_name].clips.push(c)
          games[c.game_name].total_size += c.size_bytes
        }
        let diskUsage = null
        const orgPath = service.getOrganizedPath()
        if (orgPath && fs.existsSync(orgPath)) {
          diskUsage = await getDiskUsage(orgPath)
        }
        return json(res, {
          recordings,
          clips,
          total_size: totalSize,
          total_size_formatted: formatFileSize(totalSize),
          recording_size: totalRecSize,
          recording_size_formatted: formatFileSize(totalRecSize),
          clip_size: totalClipSize,
          clip_size_formatted: formatFileSize(totalClipSize),
          recording_count: recordings.length,
          clip_count: clips.length,
          games,
          disk_usage: diskUsage,
          locked_recordings: lockedRecordings,
        })
      }

      // GET/POST /api/storage/settings
      if (pathname === '/api/storage/settings') {
        if (req.method === 'POST') {
          const data = await readBody(req)
          if (data.storage_settings) store.set('storageSettings', data.storage_settings)
          return json(res, { success: true, settings: store.get('storageSettings') || {} })
        }
        return json(
          res,
          store.get('storageSettings') || {
            auto_delete_enabled: false,
            max_storage_gb: 100,
            max_age_days: 30,
            exclude_clips: true,
          }
        )
      }

      // POST /api/storage/lock
      if (pathname === '/api/storage/lock' && req.method === 'POST') {
        const data = await readBody(req)
        const locked = store.get('lockedRecordings') || []
        const normalized = path.normalize(data.path)
        if (data.locked) {
          if (!locked.includes(normalized)) locked.push(normalized)
        } else {
          const idx = locked.indexOf(normalized)
          if (idx >= 0) locked.splice(idx, 1)
        }
        store.set('lockedRecordings', locked)
        return json(res, { success: true, locked: data.locked })
      }

      // POST /api/storage/delete-batch
      if (pathname === '/api/storage/delete-batch' && req.method === 'POST') {
        const data = await readBody(req)
        const paths = data.paths || []
        const locked = (store.get('lockedRecordings') || []).map((p) => path.normalize(p))
        const deleted = [],
          failed = [],
          skippedLocked = []
        for (const p of paths) {
          if (locked.includes(path.normalize(p))) {
            skippedLocked.push(p)
            continue
          }
          const result = service.deleteFile(p)
          if (result.success) deleted.push(p)
          else failed.push({ path: p, error: result.error })
        }
        return json(res, {
          success: true,
          deleted,
          deleted_count: deleted.length,
          failed,
          failed_count: failed.length,
          skipped_locked: skippedLocked,
          skipped_locked_count: skippedLocked.length,
        })
      }

      // POST /api/reencode
      if (pathname === '/api/reencode' && req.method === 'POST') {
        const data = await readBody(req)
        const {
          source_path,
          codec = 'h265',
          crf = 23,
          preset = 'medium',
          replace_original = false,
          original_size = 0,
          audio_tracks = null,
        } = data
        if (!isAllowedPath(source_path)) return json(res, { error: 'Forbidden' }, 403)
        if (!CODEC_MAP[codec]) return json(res, { error: `Unsupported codec: ${codec}` }, 400)
        const locked = (store.get('lockedRecordings') || []).map((p) => path.normalize(p))
        if (locked.includes(path.normalize(source_path)))
          return json(res, { error: 'Forbidden' }, 403)
        try {
          const result = await service.reencodeVideo(source_path, {
            codec,
            crf,
            preset,
            replaceOriginal: replace_original,
            originalSize: original_size,
            audioTracks: audio_tracks,
          })
          return json(res, result)
        } catch (e) {
          const status = e.message.includes('Not found') ? 404 : 500
          return json(res, { error: e.message }, status)
        }
      }

      // GET /api/video/tracks?path=...
      if (pathname === '/api/video/tracks' && req.method === 'GET') {
        const filePath = query.path
        if (!filePath || !isAllowedPath(filePath)) return json(res, { error: 'Forbidden' }, 403)
        if (!fs.existsSync(filePath)) return json(res, { error: 'File not found' }, 404)
        // Load sidecar track names if present (written during MKV→MP4 remux)
        let sidecarNames = null
        try {
          sidecarNames = JSON.parse(fs.readFileSync(filePath + '.tracks.json', 'utf-8'))
        } catch {}
        return new Promise((resolve) => {
          execFile(
            FFPROBE_PATH,
            ['-v', 'error', '-show_streams', '-select_streams', 'a', '-of', 'json', filePath],
            { encoding: 'utf-8', timeout: 10000 },
            (error, stdout) => {
              if (error) {
                resolve(json(res, { tracks: [] }))
                return
              }
              try {
                const data = JSON.parse(stdout)
                const tracks = (data.streams || []).map((s, i) => ({
                  index: i,
                  stream_index: s.index ?? i,
                  codec_name: s.codec_name || 'unknown',
                  channels: s.channels || 0,
                  channel_layout: s.channel_layout || '',
                  sample_rate: s.sample_rate || '',
                  title: sidecarNames?.[i] || s.tags?.title || s.tags?.TITLE || `Track ${i + 1}`,
                }))
                resolve(json(res, { tracks }))
              } catch {
                resolve(json(res, { tracks: [] }))
              }
            }
          )
        })
      }

      // GET /api/video/waveform?path=...&track=0
      if (pathname === '/api/video/waveform' && req.method === 'GET') {
        const filePath = query.path
        const rawTrack = parseInt(query.track, 10)
        const zoomLevel = parseInt(query.zoom, 10) || waveformCache.ZOOM_LEVEL_DEFAULT
        if (isNaN(rawTrack) || rawTrack < 0) return json(res, { error: 'Invalid track index' }, 400)
        const trackIndex = rawTrack
        if (!filePath || !isAllowedPath(filePath)) return json(res, { error: 'Forbidden' }, 403)
        if (!fs.existsSync(filePath)) return json(res, { error: 'File not found' }, 404)

        const cachedWaveformPath = waveformCache.getWaveformPath(filePath, zoomLevel)
        if (fs.existsSync(cachedWaveformPath)) {
          try {
            const peaks = await readWaveformFromCache(cachedWaveformPath, trackIndex)
            const duration = await getVideoDuration(filePath)
            return json(res, { peaks, duration, fromCache: true })
          } catch {
            // Fall through to ffmpeg if cache read fails
          }
        }

        return new Promise((resolve) => {
          getVideoDuration(filePath).then((duration) => {
            if (!duration) {
              resolve(json(res, { peaks: [] }))
              return
            }

            const NUM_PEAKS = 2000
            const sampleRate = Math.max(2, Math.round(NUM_PEAKS / duration))

            const ffmpegProc = spawn(FFMPEG_PATH, [
              '-hide_banner',
              '-loglevel',
              'error',
              '-i',
              filePath,
              '-map',
              `0:a:${trackIndex}`,
              '-ac',
              '1',
              '-ar',
              String(sampleRate),
              '-f',
              'f32le',
              'pipe:1',
            ])

            req.on('close', () => ffmpegProc.kill())
            const killTimer = setTimeout(() => {
              try {
                ffmpegProc.kill('SIGKILL')
              } catch {}
            }, 30_000)
            if (typeof killTimer.unref === 'function') killTimer.unref()
            const clearKillTimer = () => clearTimeout(killTimer)
            ffmpegProc.on('close', clearKillTimer)
            ffmpegProc.on('error', clearKillTimer)
            ffmpegProc.stderr.resume()

            const chunks = []
            ffmpegProc.stdout.on('data', (chunk) => chunks.push(chunk))
            ffmpegProc.on('close', () => {
              try {
                const buffer = Buffer.concat(chunks)
                const samples = new Float32Array(
                  buffer.buffer,
                  buffer.byteOffset,
                  Math.floor(buffer.length / 4)
                )
                if (!samples.length) {
                  resolve(json(res, { peaks: [] }))
                  return
                }

                const chunkSize = Math.max(1, Math.ceil(samples.length / NUM_PEAKS))
                const peaks = []
                for (let i = 0; i < samples.length && peaks.length < NUM_PEAKS; i += chunkSize) {
                  let max = 0
                  for (let j = i; j < Math.min(i + chunkSize, samples.length); j++) {
                    const v = Math.abs(samples[j])
                    if (v > max) max = v
                  }
                  peaks.push(max)
                }
                const maxPeak = peaks.reduce((m, p) => (p > m ? p : m), 0.001)
                resolve(json(res, { peaks: peaks.map((p) => p / maxPeak), duration }))
              } catch {
                resolve(json(res, { peaks: [] }))
              }
            })
            ffmpegProc.on('error', () => resolve(json(res, { peaks: [] })))
          })
        })
      }

      // GET /api/waveform/status?path=...&resolution=medium
      if (pathname === '/api/waveform/status' && req.method === 'GET') {
        const filePath = query.path
        const resolution = query.resolution || 'medium'
        if (!filePath) return json(res, { error: 'Missing path' }, 400)
        if (!isAllowedPath(filePath)) return json(res, { error: 'Forbidden' }, 403)

        const status = waveformCache.getWaveformStatus(filePath, resolution)
        const queueStatus = waveformQueue.getStatus()
        const queueJob = queueStatus.jobs.find(
          (j) => j.videoPath.toLowerCase() === filePath.toLowerCase()
        )

        return json(res, {
          ...status,
          queueJob: queueJob || null,
        })
      }

      // GET /api/waveform/cache-size
      if (pathname === '/api/waveform/cache-size' && req.method === 'GET') {
        const size = await waveformCache.getCacheSize()
        return json(res, {
          size,
          formatted: waveformCache.formatBytes(size),
        })
      }

      // POST /api/waveform/clear-cache
      if (pathname === '/api/waveform/clear-cache' && req.method === 'POST') {
        waveformCache.clearCache()
        return json(res, { success: true })
      }

      // GET /api/waveform/queue-status
      if (pathname === '/api/waveform/queue-status' && req.method === 'GET') {
        return json(res, waveformQueue.getStatus())
      }

      // POST /api/waveform/generate?path=...&resolution=medium
      if (pathname === '/api/waveform/generate' && req.method === 'POST') {
        const filePath = query.path
        const resolution = query.resolution || 'medium'
        if (!filePath) return json(res, { error: 'Missing path' }, 400)
        if (!isAllowedPath(filePath)) return json(res, { error: 'Forbidden' }, 403)

        const status = waveformCache.getWaveformStatus(filePath, resolution)
        if (status.isComplete) {
          return json(res, {
            success: true,
            alreadyComplete: true,
            status,
          })
        }

        const result = waveformQueue.enqueue(filePath, { resolution })
        return json(res, {
          success: result.success,
          reason: result.reason,
          jobId: result.jobId,
        })
      }

      // POST /api/waveform/cancel?jobId=...
      if (pathname === '/api/waveform/cancel' && req.method === 'POST') {
        const jobId = query.jobId
        if (!jobId) return json(res, { error: 'Missing jobId' }, 400)
        return json(res, waveformQueue.cancel(jobId))
      }

      // GET /api/audiowaveform-check
      if (pathname === '/api/audiowaveform-check' && req.method === 'GET') {
        const available = await waveformCache.checkAudiowaveformAvailable()
        return json(res, { available })
      }

      // GET /api/ffmpeg-check
      if (pathname === '/api/ffmpeg-check' && req.method === 'GET') {
        execFile('ffmpeg', ['-version'], { timeout: 5000 }, (err) => {
          json(res, { available: !err })
        })
        return
      }

      // 404
      json(res, { error: 'Not found' }, 404)
    } catch (e) {
      if (e.message === 'Payload too large') {
        json(res, { error: 'Payload too large' }, 413)
      } else {
        json(res, { error: e.message }, 500)
      }
    }
  })

  // In dev mode use a fixed port so vite proxy can reach us; otherwise random
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')
  const listenPort = isDev ? 47531 : 0
  server.listen(listenPort, '127.0.0.1', () => {
    const port = server.address().port
    console.log(`API server listening on http://127.0.0.1:${port}`)
  })

  return server
}

module.exports = { startApiServer }
