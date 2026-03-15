/**
 * Video metadata helpers: ffprobe-backed duration cache and disk usage via PowerShell.
 */
const fs = require('fs');
const { execFile, exec } = require('child_process');
const path = require('path');
const { FFPROBE_PATH, formatFileSize } = require('./constants');

// Cache for getVideoDuration keyed by "filePath:mtime"; bounded to prevent unbounded memory growth
const _videoDurationCache = new Map();
const VIDEO_DURATION_CACHE_MAX = 500;

function getVideoDuration(filePath) {
  let mtime = 0;
  try { mtime = fs.statSync(filePath).mtimeMs; } catch { /* file may not exist */ }
  const cacheKey = `${filePath}:${mtime}`;
  if (_videoDurationCache.has(cacheKey)) return Promise.resolve(_videoDurationCache.get(cacheKey));

  return new Promise((resolve) => {
    execFile(
      FFPROBE_PATH,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { encoding: 'utf-8', timeout: 10000 },
      (error, stdout) => {
        if (error) return resolve(null);
        const duration = parseFloat(stdout.trim()) || null;
        if (duration !== null) {
          if (_videoDurationCache.size >= VIDEO_DURATION_CACHE_MAX) {
            _videoDurationCache.delete(_videoDurationCache.keys().next().value);
          }
          _videoDurationCache.set(cacheKey, duration);
        }
        resolve(duration);
      }
    );
  });
}

// Cache for getDiskUsage: keyed by drive letter (supports multiple drives), 30-second TTL
const _diskUsageCache = new Map();
const DISK_USAGE_TTL_MS = 30000;

function getDiskUsage(dirPath) {
  const parsed = path.win32.parse(dirPath);
  const driveKey = (parsed.root || dirPath).toLowerCase();
  const now = Date.now();
  const cached = _diskUsageCache.get(driveKey);
  if (cached && now - cached.ts < DISK_USAGE_TTL_MS) return Promise.resolve(cached.data);

  return new Promise((resolve) => {
    exec(
      `powershell -Command "(Get-PSDrive -Name (Split-Path '${dirPath.replace(/'/g, "''")}' -Qualifier).TrimEnd(':')) | Select-Object Used, Free | ConvertTo-Json"`,
      { encoding: 'utf-8', timeout: 5000 },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          const d = JSON.parse(stdout);
          if (typeof d !== 'object' || d === null || !Number.isFinite(d.Used) || !Number.isFinite(d.Free)) {
            console.error('[videoMetadata] Invalid disk usage data:', d);
            return resolve(null);
          }
          const total = d.Used + d.Free;
          const result = {
            total, used: d.Used, free: d.Free,
            total_formatted: formatFileSize(total),
            used_formatted: formatFileSize(d.Used),
            free_formatted: formatFileSize(d.Free),
            percent_used: total > 0 ? (d.Used / total * 100) : 0,
          };
          _diskUsageCache.set(driveKey, { data: result, ts: Date.now() });
          resolve(result);
        } catch { resolve(null); }
      }
    );
  });
}

module.exports = { getVideoDuration, getDiskUsage };
