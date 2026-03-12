const path = require('path');
const { app } = require('electron');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.flv', '.mov', '.avi', '.ts']);

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.flv': 'video/x-flv',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
};

const CODEC_MAP = {
  h264: 'libx264',
  h265: 'libx265',
  av1: 'libsvtav1',
};

// All mutable user data lives in %APPDATA%\open-clip (or the dev equivalent)
const USER_DATA = app.getPath('userData');
const RUNTIME_DIR = path.join(USER_DATA, 'runtime');
const STATE_FILE = path.join(RUNTIME_DIR, 'game_state');
const MARKERS_FILE = path.join(RUNTIME_DIR, 'clip_markers.json');
const PID_FILE = path.join(RUNTIME_DIR, 'watcher.pid');
const LOG_FILE = path.join(RUNTIME_DIR, 'watcher.log');
const SCRIPT_MARKER_FILE = path.join(RUNTIME_DIR, 'script_loaded');
const PLUGIN_PORT_FILE = path.join(RUNTIME_DIR, 'plugin_port');
const PLUGIN_MARKER_FILE = path.join(RUNTIME_DIR, 'plugin_loaded');
const PLUGIN_DLL_NAME = process.platform === 'win32' ? 'openclip-obs.dll' : 'openclip-obs.so';
const GAMES_CONFIG_FILE = path.join(USER_DATA, 'games_config.json');
const MANAGER_SETTINGS_FILE = path.join(USER_DATA, 'manager_settings.json');
const ICONS_DIR = path.join(USER_DATA, 'icons');

// FFmpeg: use bundled binaries in production, dev falls back to ffmpeg-static or system PATH
let FFMPEG_PATH = 'ffmpeg';
let FFPROBE_PATH = 'ffprobe';

if (!app.isPackaged) {
  // Development mode — try npm-installed static binaries, fall back to system PATH
  try { FFMPEG_PATH = require('ffmpeg-static'); } catch {}
  try { FFPROBE_PATH = require('ffprobe-static').path; } catch {}
} else {
  // Production mode — use binaries bundled alongside the app via electron-builder extraResources
  FFMPEG_PATH = path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  FFPROBE_PATH = path.join(process.resourcesPath, 'ffmpeg', 'ffprobe.exe');
}

function formatFileSize(bytes) {
  for (const unit of ['B', 'KB', 'MB', 'GB']) {
    if (bytes < 1024) return `${bytes.toFixed(1)} ${unit}`;
    bytes /= 1024;
  }
  return `${bytes.toFixed(1)} TB`;
}

function isVideoFile(filename) {
  return VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

module.exports = {
  VIDEO_EXTENSIONS,
  MIME_TYPES,
  CODEC_MAP,
  USER_DATA,
  RUNTIME_DIR,
  STATE_FILE,
  MARKERS_FILE,
  PID_FILE,
  LOG_FILE,
  SCRIPT_MARKER_FILE,
  PLUGIN_PORT_FILE,
  PLUGIN_MARKER_FILE,
  PLUGIN_DLL_NAME,
  GAMES_CONFIG_FILE,
  MANAGER_SETTINGS_FILE,
  ICONS_DIR,
  FFMPEG_PATH,
  FFPROBE_PATH,
  formatFileSize,
  isVideoFile,
};
