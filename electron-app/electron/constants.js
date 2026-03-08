const path = require('path');

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

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'runtime');
const STATE_FILE = path.join(RUNTIME_DIR, 'game_state');
const MARKERS_FILE = path.join(RUNTIME_DIR, 'clip_markers.json');
const PID_FILE = path.join(RUNTIME_DIR, 'watcher.pid');
const LOG_FILE = path.join(RUNTIME_DIR, 'watcher.log');
const GAMES_CONFIG_FILE = path.join(PROJECT_ROOT, 'games_config.json');
const MANAGER_SETTINGS_FILE = path.join(PROJECT_ROOT, 'manager_settings.json');

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
  PROJECT_ROOT,
  RUNTIME_DIR,
  STATE_FILE,
  MARKERS_FILE,
  PID_FILE,
  LOG_FILE,
  GAMES_CONFIG_FILE,
  MANAGER_SETTINGS_FILE,
  formatFileSize,
  isVideoFile,
};
