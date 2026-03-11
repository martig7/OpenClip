/**
 * Read and write OBS encoder settings.
 * Mirrors the read_obs_encoding_settings / save_obs_encoding_settings
 * logic from game_manager.pyw, using line-by-line INI replacement to
 * preserve the original file formatting that OBS expects.
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ini = require('./iniParser');

// ── helpers ──────────────────────────────────────────────────────────────────

function getProfilesDir() {
  const appdata = process.env.APPDATA;
  if (!appdata) return null;
  return path.join(appdata, 'obs-studio', 'basic', 'profiles');
}

/** Strip UTF-8 BOM if present. */
function stripBOM(str) {
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}

/**
 * Replace a key's value in an INI file's line array, case-insensitive key match.
 * Returns true if a replacement was made.
 */
function iniReplaceValue(lines, section, key, value) {
  let inSection = false;
  const keyLower = key.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inSection = trimmed.slice(1, -1) === section;
      continue;
    }
    if (inSection && trimmed.includes('=')) {
      const lineKey = trimmed.split('=')[0].trim();
      if (lineKey.toLowerCase() === keyLower) {
        lines[i] = `${lineKey}=${value}\n`;
        return true;
      }
    }
  }
  return false;
}

function isOBSRunning() {
  return new Promise((resolve) => {
    exec('tasklist /FO CSV /NH', { encoding: 'utf-8', timeout: 5000 }, (err, out) => {
      resolve(!err && !!out && out.toLowerCase().includes('obs64.exe'));
    });
  });
}

// ── public API ────────────────────────────────────────────────────────────────

function getProfiles() {
  const dir = getProfilesDir();
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(name => fs.statSync(path.join(dir, name)).isDirectory() &&
                      fs.existsSync(path.join(dir, name, 'basic.ini')))
      .map(name => ({ name, dir: path.join(dir, name) }));
  } catch {
    return [];
  }
}

function readEncodingSettings(profileDir) {
  const basicIni = path.join(profileDir, 'basic.ini');
  if (!fs.existsSync(basicIni)) return null;

  const raw = stripBOM(fs.readFileSync(basicIni, 'utf-8'));
  const config = ini.parse(raw);

  const settings = {};

  // Video section — try PascalCase then lowercase
  const video = config.Video || {};
  settings.output_cx = video.OutputCX || video.outputcx || '1920';
  settings.output_cy = video.OutputCY || video.outputcy || '1080';
  settings.fps_common = video.FPSCommon || video.fpscommon || '60';

  // Output mode
  const output = config.Output || {};
  settings.output_mode = output.Mode || output.mode || 'Simple';

  if (settings.output_mode.toLowerCase() === 'advanced') {
    const adv = config.AdvOut || {};
    settings.rec_encoder = adv.RecEncoder || adv.recencoder || '';
    settings.rec_format  = adv.RecFormat2 || adv.recformat2 || 'mkv';
  } else {
    const simple = config.SimpleOutput || {};
    settings.rec_encoder = simple.RecEncoder || simple.recencoder || '';
    settings.rec_format  = simple.RecFormat2 || simple.RecFormat || simple.recformat2 || simple.recformat || 'mp4';
  }

  // recordEncoder.json
  const encJson = path.join(profileDir, 'recordEncoder.json');
  if (fs.existsSync(encJson)) {
    try {
      const enc = JSON.parse(fs.readFileSync(encJson, 'utf-8'));
      settings.rate_control   = enc.rate_control   ?? '';
      settings.bitrate        = enc.bitrate        != null ? String(enc.bitrate)        : '';
      settings.max_bitrate    = enc.max_bitrate    != null ? String(enc.max_bitrate)    : '';
      settings.cqp            = enc.cqp            != null ? String(enc.cqp)            : '';
      settings.target_quality = enc.target_quality != null ? String(enc.target_quality) : '';
      settings.preset         = enc.preset         ?? '';
    } catch {}
  }

  return settings;
}

function writeEncodingSettings(profileDir, settings) {
  const basicIni = path.join(profileDir, 'basic.ini');
  const rawWithBOM = fs.readFileSync(basicIni, 'utf-8');
  const hasBOM = rawWithBOM.charCodeAt(0) === 0xFEFF;
  const raw = hasBOM ? rawWithBOM.slice(1) : rawWithBOM;
  const lines = raw.split(/(?<=\n)/); // split keeping line endings

  const config = ini.parse(raw);
  const outputMode = (config.Output?.Mode || config.Output?.mode || 'Simple').toLowerCase();

  // Video
  iniReplaceValue(lines, 'Video', 'OutputCX', settings.output_cx);
  iniReplaceValue(lines, 'Video', 'OutputCY', settings.output_cy);
  iniReplaceValue(lines, 'Video', 'FPSCommon', settings.fps_common);

  // Recording encoder + format
  if (outputMode === 'advanced') {
    iniReplaceValue(lines, 'AdvOut', 'RecEncoder', settings.rec_encoder);
    iniReplaceValue(lines, 'AdvOut', 'RecFormat2', settings.rec_format);
  } else {
    iniReplaceValue(lines, 'SimpleOutput', 'RecEncoder', settings.rec_encoder);
    iniReplaceValue(lines, 'SimpleOutput', 'RecFormat2', settings.rec_format);
    iniReplaceValue(lines, 'SimpleOutput', 'RecFormat',  settings.rec_format);
  }

  const out = (hasBOM ? '\uFEFF' : '') + lines.join('');
  fs.writeFileSync(basicIni, out, 'utf-8');

  // recordEncoder.json — merge into existing object
  const encJson = path.join(profileDir, 'recordEncoder.json');
  let enc = {};
  if (fs.existsSync(encJson)) {
    try { enc = JSON.parse(fs.readFileSync(encJson, 'utf-8')); } catch {}
  }

  if (settings.rate_control) enc.rate_control = settings.rate_control;
  if (settings.preset)       enc.preset       = settings.preset;

  for (const key of ['bitrate', 'max_bitrate', 'cqp', 'target_quality']) {
    const val = String(settings[key] ?? '').trim();
    if (val !== '') {
      const n = parseInt(val, 10);
      if (!isNaN(n)) enc[key] = n;
    }
  }

  fs.writeFileSync(encJson, JSON.stringify(enc, null, 2), 'utf-8');
}

module.exports = { getProfiles, readEncodingSettings, writeEncodingSettings, isOBSRunning };
